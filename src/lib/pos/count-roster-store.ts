/**
 * src/lib/pos/count-roster-store.ts — R74 S50: server side of count-roster-core.ts.
 *
 * Storage only (no migration): the rosters live as JSON in the same private bucket as the count
 * evidence (pos-raw), and every emailed-back workbook is kept byte for byte with its sha256.
 *
 *   pos-raw/count/roster/index.json                      the list of rosters (newest first)
 *   pos-raw/count/roster/<rosterId>.json                 one roster (sheets, assignments, events)
 *   pos-raw/count/roster/<rosterId>/<workbookId>/<sha16>.xlsx   each received workbook
 *   pos-raw/count/roster/checklist.json                  the owner's manual audit-day ticks
 *
 * The practice ("test") roster is built from the lots of a real import, but it NEVER writes
 * inventory: its reconciliation is computed in memory with no sales roll-forward, compared with the
 * lots' on-hand right now, and only the result summary is saved on the roster.
 */
import "server-only";
import crypto from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { isValidRunId, loadRunLotList } from "@/lib/pos/cultivera-fetch-client";
import { buildCountWorkbook, workbookCells } from "@/lib/pos/cultivera-count-workbook";
import { COUNT_BUCKET, loadCountLots, saveCountUpload, buildCountPreview } from "@/lib/pos/cultivera-count-store";
import {
  COUNT_WORKBOOK_SPEC,
  mergeCountWorkbooks,
  parseCountWorkbook,
  planCount,
  salesDayAfter,
  type CountLot,
  type ParsedCountWorkbook,
  type SalesRollup,
} from "@/lib/pos/cultivera-count-core";
import {
  ROSTER_LIMITS,
  matchUploads,
  newSheet,
  pickPracticeSample,
  practiceChecks,
  practiceFillPlan,
  pushEvent,
  splitAcross,
  uploadSentence,
  workbookFileName,
  type CountPlatform,
  type CountRoster,
  type ManualKey,
  type PracticeCheck,
  type RosterSheet,
  type UploadedBook,
} from "@/lib/pos/count-roster-core";
import { computeAuditStats, type AuditStats, type LotFact, type StatLine } from "@/lib/pos/count-audit-stats-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRosterId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const KEY = {
  index: "count/roster/index.json",
  roster: (id: string) => `count/roster/${id}.json`,
  book: (id: string, wb: string, h: string) => `count/roster/${id}/${wb}/${h.slice(0, 16)}.xlsx`,
  checklist: "count/roster/checklist.json",
};

async function put(admin: Admin, key: string, body: Buffer, contentType: string) {
  const { error } = await admin.storage.from(COUNT_BUCKET).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Could not save ${key} (${error.message}).`);
}
async function get(admin: Admin, key: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(COUNT_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
const putJson = (admin: Admin, key: string, v: unknown) => put(admin, key, Buffer.from(JSON.stringify(v), "utf8"), "application/json");
async function getJson<T>(admin: Admin, key: string): Promise<T | null> {
  const b = await get(admin, key);
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/* ---------------- index + roster I/O ---------------- */

export type RosterIndexRow = { rosterId: string; mode: CountRoster["mode"]; title: string; countDate: string; createdAt: string; archived: boolean };

export async function listRosters(admin: Admin): Promise<RosterIndexRow[]> {
  return (await getJson<RosterIndexRow[]>(admin, KEY.index)) ?? [];
}

export async function loadRoster(admin: Admin, rosterId: string): Promise<CountRoster | null> {
  if (!isRosterId(rosterId)) return null;
  const r = await getJson<CountRoster>(admin, KEY.roster(rosterId));
  return r && r.rosterId === rosterId ? r : null;
}

export async function saveRoster(admin: Admin, r: CountRoster): Promise<void> {
  await putJson(admin, KEY.roster(r.rosterId), r);
  const idx = (await listRosters(admin)).filter((x) => x.rosterId !== r.rosterId);
  idx.unshift({ rosterId: r.rosterId, mode: r.mode, title: r.title, countDate: r.countDate, createdAt: r.createdAt, archived: r.archived });
  idx.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  await putJson(admin, KEY.index, idx.slice(0, 60));
}

export type ManualTicks = Partial<Record<ManualKey, string | null>>;
export async function loadManualTicks(admin: Admin): Promise<ManualTicks> {
  return (await getJson<ManualTicks>(admin, KEY.checklist)) ?? {};
}
export async function saveManualTicks(admin: Admin, t: ManualTicks): Promise<void> {
  await putJson(admin, KEY.checklist, t);
}

/* ---------------- create ---------------- */

type Seed = { assignee: string; zone: string; email: string; platform: CountPlatform };

function blankRoster(input: { mode: CountRoster["mode"]; title: string; countDate: string; source: CountRoster["source"]; by: string }): CountRoster {
  const at = new Date().toISOString();
  return {
    version: 1,
    rosterId: crypto.randomUUID(),
    mode: input.mode,
    title: input.title,
    countDate: input.countDate,
    source: input.source,
    createdAt: at,
    createdBy: input.by,
    archived: false,
    sheets: [],
    events: [],
    combined: null,
    applied: null,
    practiceResult: null,
  };
}

export async function createLiveRoster(admin: Admin, input: { title: string; countDate: string; runId: string; seeds: Seed[]; extraBlank: number; by: string }): Promise<CountRoster> {
  if (!isValidRunId(input.runId)) throw new Error("Pick a finished harvest for the product list.");
  if (!salesDayAfter(input.countDate)) throw new Error("The count date is not a real date.");
  const n = input.seeds.length + Math.max(0, Math.floor(input.extraBlank));
  if (n < 1) throw new Error("Add at least one person (or one blank sheet).");
  if (n > ROSTER_LIMITS.maxSheets) throw new Error(`At most ${ROSTER_LIMITS.maxSheets} sheets per roster (the upload limit).`);
  const r = blankRoster({ mode: "live", title: input.title || `Count ${input.countDate}`, countDate: input.countDate, source: { kind: "harvest", runId: input.runId }, by: input.by });
  for (let i = 0; i < n; i++) r.sheets.push(newSheet(crypto.randomUUID(), i + 1, r.createdAt, input.seeds[i]));
  pushEvent(r, r.createdAt, input.by, `Roster made: ${n} sheet(s) from harvest ${input.runId}.`);
  await saveRoster(admin, r);
  return r;
}

type ImportLot = CountLot & { category: string | null };

/** The import's lots plus each lot's category (for a spread-out practice sample). */
async function importLotsWithCategory(admin: Admin, importId: string): Promise<ImportLot[]> {
  const load = await loadCountLots(admin, importId);
  const facts = await lotFacts(admin, load.lots.map((l) => l.lotId), false);
  return load.lots.map((l) => ({ ...l, category: facts.get(l.lotId)?.category ?? null }));
}

export async function createPracticeRoster(admin: Admin, input: { importId: string; lots: number; sheets: number; seeds: Seed[]; by: string }): Promise<CountRoster> {
  if (!isSafeImportId(input.importId)) throw new Error("Pick the import to practise with.");
  const k = Math.max(1, Math.min(ROSTER_LIMITS.maxPracticeSheets, Math.floor(input.sheets) || input.seeds.length || 1));
  const lots = await importLotsWithCategory(admin, input.importId);
  if (lots.length === 0) throw new Error("That import has no lots to practise with.");
  const today = new Date().toISOString().slice(0, 10);
  const sample = pickPracticeSample(
    lots.map((l) => ({ code: l.lotCode, productName: l.productName, onHand: l.currentOnHand ?? l.onHand, category: l.category })),
    input.lots,
    `${input.importId}:${Date.now()}`,
  );
  if (sample.length === 0) throw new Error("No lot in that import has stock on hand right now.");
  const r = blankRoster({
    mode: "test",
    title: `Practice ${today} · ${sample.length} lots`,
    countDate: today,
    source: { kind: "import", importId: input.importId, sampleCodes: sample.map((s) => s.code.toLowerCase()) },
    by: input.by,
  });
  const parts = splitAcross(sample, k);
  for (let i = 0; i < k; i++) {
    const s = newSheet(crypto.randomUUID(), i + 1, r.createdAt, input.seeds[i] ?? { assignee: i === 0 ? "Practice counter" : `Practice counter ${i + 1}` });
    s.zone = s.zone || `Practice list ${i + 1} (${parts[i].length} items)`;
    s.practiceCodes = parts[i].map((l) => l.code.toLowerCase());
    s.practice = null;
    r.sheets.push(s);
  }
  pushEvent(r, r.createdAt, input.by, `Practice roster made from import ${input.importId.slice(0, 8)}: ${sample.length} real lots over ${k} sheet(s). It never writes inventory.`);
  await saveRoster(admin, r);
  return r;
}

/* ---------------- building a sheet's workbook ---------------- */

export type RosterLots = { lots: { barcode: string; productName: string; storage: string }[]; source: string; importLots?: ImportLot[] };

export async function rosterLotList(admin: Admin, r: CountRoster): Promise<RosterLots> {
  if (r.source.kind === "harvest") {
    const list = await loadRunLotList(r.source.runId);
    return {
      lots: list.lots.map((l) => ({ barcode: String(l.Barcode ?? ""), productName: String(l.ProductName ?? ""), storage: String(l.StorageName ?? "") })),
      source: r.source.runId,
    };
  }
  const importLots = await importLotsWithCategory(admin, r.source.importId);
  return { lots: importLots.map((l) => ({ barcode: l.lotCode, productName: l.productName, storage: "" })), source: `import ${r.source.importId}`, importLots };
}

export async function buildRosterWorkbook(
  r: CountRoster,
  s: RosterSheet,
  platform: CountPlatform,
  lots: RosterLots,
  prefill: boolean,
): Promise<{ buffer: Buffer; fileName: string; practice: RosterSheet["practice"] }> {
  let fill: Parameters<typeof buildCountWorkbook>[0]["prefill"];
  let practice: RosterSheet["practice"] = null;
  if (prefill) {
    if (r.mode !== "test" || !lots.importLots) throw new Error("Only practice sheets can be pre-filled.");
    const mine = new Set(s.practiceCodes ?? []);
    const plan = practiceFillPlan(
      lots.importLots.filter((l) => mine.has(l.lotCode.toLowerCase())).map((l) => ({ code: l.lotCode, productName: l.productName, onHand: l.currentOnHand ?? l.onHand })),
      s.workbookId,
      { scanRowLimit: COUNT_WORKBOOK_SPEC.scanRows, handRowLimit: COUNT_WORKBOOK_SPEC.handRows },
    );
    fill = { scans: plan.scans, hand: plan.hand };
    practice = { filledAt: new Date().toISOString(), ...plan.expectation };
  }
  const fileName = workbookFileName(r, s, platform).replace(/\.xlsx$/, prefill ? "-PREFILLED.xlsx" : ".xlsx");
  const out = await buildCountWorkbook({
    counter: s.assignee || `Sheet ${s.number}`,
    countDate: r.countDate,
    lots: lots.lots,
    lotsSource: lots.source,
    workbookId: s.workbookId,
    platform,
    roster: { rosterId: r.rosterId, mode: r.mode, sheetNumber: s.number, zone: s.zone },
    prefill: fill,
    fileName,
  });
  return { buffer: out.buffer, fileName: out.fileName, practice };
}

/** A sheet's practice list as text (what to count), for the practice page. */
export function practiceListFor(s: RosterSheet, lots: ImportLot[]): { code: string; productName: string }[] {
  const mine = new Set(s.practiceCodes ?? []);
  return lots.filter((l) => mine.has(l.lotCode.toLowerCase())).map((l) => ({ code: l.lotCode, productName: l.productName }));
}

/* ---------------- receiving emailed-back workbooks ---------------- */

function toUploaded(p: ParsedCountWorkbook): UploadedBook {
  return {
    fileName: p.fileName,
    sha256: p.sha256,
    workbookId: p.meta?.workbookId ?? null,
    rosterId: p.meta?.rosterId ?? null,
    mode: p.meta?.rosterMode ?? null,
    counter: p.meta?.counter ?? "",
    countDate: p.meta?.countDate ?? "",
    scans: p.scanCount,
    handUnits: p.handUnits,
    blocking: p.problems.filter((x) => x.severity === "blocking").length,
    warnings: p.problems.filter((x) => x.severity === "warning").length,
  };
}

export async function receiveRosterUploads(admin: Admin, rosterId: string, files: { name: string; buffer: Buffer }[], by: string): Promise<{ sentence: string; stored: number }> {
  const r = await loadRoster(admin, rosterId);
  if (!r) throw new Error("That roster was not found.");
  if (files.length === 0) throw new Error("Choose the emailed-back workbooks first.");
  if (files.length > ROSTER_LIMITS.maxSheets) throw new Error(`At most ${ROSTER_LIMITS.maxSheets} files at once.`);
  const parsed: { p: ParsedCountWorkbook; buffer: Buffer }[] = [];
  for (const f of files) {
    if (f.buffer.length === 0 || f.buffer.length > 8 * 1024 * 1024) throw new Error(`${f.name} is empty or larger than 8 MB; it is not a count workbook.`);
    let cells;
    try {
      cells = await workbookCells(f.buffer);
    } catch {
      cells = { sheets: {} };
    }
    parsed.push({ p: parseCountWorkbook({ fileName: f.name.slice(0, 200), sha256: sha(f.buffer), cells }), buffer: f.buffer });
  }
  const matches = matchUploads(r, parsed.map((x) => toUploaded(x.p)));
  const at = new Date().toISOString();
  let stored = 0;
  for (const [i, m] of matches.entries()) {
    if (m.kind !== "new" && m.kind !== "replace") continue;
    const s = r.sheets.find((x) => x.number === m.sheetNumber)!;
    const key = KEY.book(r.rosterId, s.workbookId, m.book.sha256);
    await put(admin, key, parsed[i].buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    s.received = {
      fileName: m.book.fileName,
      sha256: m.book.sha256,
      bytes: parsed[i].buffer.length,
      key,
      at,
      scans: m.book.scans,
      handUnits: m.book.handUnits,
      counterInFile: m.book.counter,
      blocking: m.book.blocking,
      warnings: m.book.warnings,
      replaced: (s.received?.replaced ?? 0) + (m.kind === "replace" ? 1 : 0),
    };
    stored++;
    pushEvent(r, at, by, `Sheet ${s.number} (${s.assignee || "unassigned"}) ${m.kind === "replace" ? "replaced with a newer file" : "uploaded"}: ${m.book.scans} scans, ${m.book.handUnits} hand-counted${m.book.blocking ? `, ${m.book.blocking} blocking problem(s)` : ""}.`);
  }
  const sentence = uploadSentence(matches);
  if (matches.some((m) => m.kind === "refused")) pushEvent(r, at, by, sentence);
  if (stored > 0) r.combined = null; // a new file makes any earlier combined preview stale
  await saveRoster(admin, r);
  return { sentence, stored };
}

/** Every received book, re-read from storage with its sha re-checked. */
export async function loadReceivedBooks(admin: Admin, r: CountRoster): Promise<{ sheet: RosterSheet; name: string; sha256: string; buffer: Buffer; parsed: ParsedCountWorkbook }[]> {
  const out = [];
  for (const s of r.sheets) {
    if (s.voidedAt || !s.received) continue;
    const b = await get(admin, s.received.key);
    if (!b) throw new Error(`Sheet ${s.number}'s uploaded file is missing from storage. Upload it again.`);
    if (b.length !== s.received.bytes || sha(b) !== s.received.sha256) throw new Error(`Sheet ${s.number}'s uploaded file no longer matches its checksum. Upload it again.`);
    out.push({ sheet: s, name: s.received.fileName, sha256: s.received.sha256, buffer: b, parsed: parseCountWorkbook({ fileName: s.received.fileName, sha256: s.received.sha256, cells: await workbookCells(b) }) });
  }
  return out;
}

/** Live roster: every received sheet → one count upload on the import (the existing preview + apply). */
export async function combineRosterIntoImport(admin: Admin, rosterId: string, importId: string, by: string | null, byEmail: string): Promise<{ batchId: string; missing: string[] }> {
  const r = await loadRoster(admin, rosterId);
  if (!r) throw new Error("That roster was not found.");
  if (r.mode !== "live") throw new Error("A practice roster is checked with its own practice reconciliation; it is never combined into an import.");
  const books = await loadReceivedBooks(admin, r);
  if (books.length === 0) throw new Error("No sheet has been uploaded yet.");
  const index = await saveCountUpload(admin, importId, books.map((b) => ({ name: b.name, buffer: b.buffer })), by);
  const preview = await buildCountPreview(admin, importId, index.batchId, "leave");
  const missing = r.sheets.filter((s) => !s.voidedAt && !s.received).map((s) => `#${s.number} ${s.assignee || "(unassigned)"}`);
  const at = new Date().toISOString();
  r.combined = {
    importId,
    batchId: index.batchId,
    at,
    missing,
    canApply: preview.canApply && missing.length === 0,
    refusals: preview.refusals.length,
    blocking: preview.problems.filter((p) => p.severity === "blocking").length,
  };
  pushEvent(r, at, byEmail, `Combined ${books.length} sheet(s) into import ${importId.slice(0, 8)} (upload ${index.batchId.slice(0, 8)})${missing.length ? `, WITHOUT ${missing.join(", ")}` : ""}.`);
  await saveRoster(admin, r);
  return { batchId: index.batchId, missing };
}

/* ---------------- facts for the audit stats ---------------- */

type FactRow = { id: string; lot_code: string | null; category: string | null; vendor_id: string | null; unit_cost_minor_units: number | null; pos_product_key: string | null };

/** lotId → category / vendor / unit cost / published menu card. Every read is chunked + paged. */
export async function lotFacts(admin: Admin, lotIds: string[], withMenu = true): Promise<Map<string, LotFact & { lotCode: string }>> {
  const out = new Map<string, LotFact & { lotCode: string }>();
  if (lotIds.length === 0) return out;
  const rows = await chunkedIn<string, FactRow>(lotIds, async (chunk, from, to) => {
    const { data, error } = await admin.from("inventory_lots").select("id, lot_code, category, vendor_id, unit_cost_minor_units, pos_product_key").in("id", chunk).order("id", { ascending: true }).range(from, to);
    if (error) throw new Error(`Could not read lot details: ${error.message}`);
    return (data as FactRow[] | null) ?? [];
  });
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => !!v))];
  const vendors = new Map<string, string>();
  if (vendorIds.length) {
    const vs = await chunkedIn<string, { id: string; display_name: string }>(vendorIds, async (chunk, from, to) => {
      const { data, error } = await admin.from("vendors").select("id, display_name").in("id", chunk).order("id", { ascending: true }).range(from, to);
      if (error) throw new Error(`Could not read vendors: ${error.message}`);
      return (data as { id: string; display_name: string }[] | null) ?? [];
    });
    for (const v of vs) vendors.set(v.id, v.display_name);
  }
  const cards = new Map<string, NonNullable<LotFact["menu"]>>();
  if (withMenu) {
    const keys = [...new Set(rows.map((r) => r.pos_product_key).filter((k): k is string => !!k))];
    const { data: pub } = await admin.from("menu_versions").select("id").eq("status", "published").order("created_at", { ascending: false }).limit(1);
    const versionId = (pub as { id: string }[] | null)?.[0]?.id;
    if (versionId && keys.length) {
      const items = await chunkedIn<string, { id: string; source_item_id: string; name: string; category: string | null; hidden: boolean }>(keys, async (chunk, from, to) => {
        const { data, error } = await admin.from("menu_items").select("id, source_item_id, name, category, hidden").eq("menu_version_id", versionId).in("source_item_id", chunk).order("id", { ascending: true }).range(from, to);
        if (error) throw new Error(`Could not read the menu: ${error.message}`);
        return (data as { id: string; source_item_id: string; name: string; category: string | null; hidden: boolean }[] | null) ?? [];
      });
      const stock = new Map<string, number>();
      if (items.length) {
        const vars = await chunkedIn<string, { menu_item_id: string; inventory_level: number | null }>(items.map((i) => i.id), async (chunk, from, to) => {
          const { data, error } = await admin.from("menu_variants").select("menu_item_id, inventory_level").in("menu_item_id", chunk).order("id", { ascending: true }).range(from, to);
          if (error) throw new Error(`Could not read menu stock: ${error.message}`);
          return (data as { menu_item_id: string; inventory_level: number | null }[] | null) ?? [];
        });
        for (const v of vars) stock.set(v.menu_item_id, (stock.get(v.menu_item_id) ?? 0) + Number(v.inventory_level ?? 0));
      }
      for (const i of items) cards.set(i.source_item_id, { name: i.name, category: i.category, hidden: !!i.hidden, menuStock: stock.has(i.id) ? stock.get(i.id)! : null, cardId: i.id });
    }
  }
  for (const r of rows) {
    out.set(r.id, {
      lotCode: r.lot_code ?? "",
      category: r.category,
      vendor: r.vendor_id ? vendors.get(r.vendor_id) ?? null : null,
      unitCostCents: r.unit_cost_minor_units,
      menu: r.pos_product_key ? cards.get(r.pos_product_key) ?? null : null,
    });
  }
  return out;
}

/** Plan lines → audit stats, with the facts looked up by lot id. */
export async function auditStatsFor(admin: Admin, lines: StatLine[]): Promise<AuditStats> {
  const ids = lines.map((l) => l.lotId).filter((v): v is string => !!v);
  const facts = await lotFacts(admin, ids);
  const byCode = new Map<string, LotFact>();
  for (const l of lines) if (l.lotId && facts.has(l.lotId)) byCode.set(l.lotCode.toLowerCase(), facts.get(l.lotId)!);
  return computeAuditStats({ lines, facts: byCode });
}

/* ---------------- the practice reconciliation (dry run, never writes inventory) ---------------- */

export type PracticeReport = {
  books: { number: number; assignee: string; fileName: string; scans: number; handUnits: number; problems: string[] }[];
  problems: string[];
  stats: AuditStats;
  checks: PracticeCheck[];
  verified: boolean;
  lines: StatLine[];
};

const EMPTY_SALES: SalesRollup = {
  netSold: new Map(), linesInWindow: 0, linesBeforeDay: 0, linesAfterDay: 0, linesAfterSnapshot: 0, duplicateIds: 0, noBarcode: 0, unusable: [], unitsSold: 0, unitsReturned: 0, cogs: 0,
};

export async function practiceReport(admin: Admin, r: CountRoster): Promise<PracticeReport> {
  if (r.mode !== "test" || r.source.kind !== "import") throw new Error("Not a practice roster.");
  const received = await loadReceivedBooks(admin, r);
  const merged = mergeCountWorkbooks(received.map((b) => b.parsed));
  const load = await loadCountLots(admin, r.source.importId);
  // Compared with the system's on-hand RIGHT NOW (not the import snapshot), with no sales roll-forward.
  const lots: CountLot[] = load.lots.map((l) => ({ lotId: l.lotId, lotCode: l.lotCode, productName: l.productName, onHand: l.currentOnHand ?? l.onHand, priorCountDelta: 0 }));
  const plan = planCount({ lots, counted: merged.counted, sales: EMPTY_SALES, problems: merged.problems, uncountedPolicy: "leave", autocompleteRisk: merged.autocompleteRisk });
  const sample = new Set(r.source.sampleCodes);
  // Only the practice lots and anything actually counted are in scope (the rest of the store was not counted).
  const lines: StatLine[] = plan.lines.filter((l) => sample.has(l.lotCode.toLowerCase()) || l.counted > 0 || Object.keys(l.byCounter).length > 0);
  const stats = await auditStatsFor(admin, lines);
  const counted: Record<string, number> = {};
  for (const [k, v] of merged.counted) counted[k] = v.units;
  const lineMap: Record<string, { delta: number; exception: string | null; onHand: number | null; counted: number }> = {};
  for (const l of lines) lineMap[l.lotCode.toLowerCase()] = { delta: l.rolled - (l.onHand ?? 0), exception: l.exception, onHand: l.onHand, counted: l.counted };
  const accepted = new Set(merged.accepted.map((b) => b.sha256));
  const checks = practiceChecks({
    sheets: r.sheets.filter((s) => !s.voidedAt).map((s) => ({
      number: s.number,
      assignee: s.assignee,
      received: !!s.received,
      blocking: s.received ? (accepted.has(s.received.sha256) ? 0 : Math.max(1, s.received.blocking)) : 0,
      practice: s.practice && s.received ? s.practice : null,
    })),
    counted,
    lines: lineMap,
  });
  checks.push({
    label: "Nothing was written to inventory",
    ok: true,
    detail: "The practice reconciliation runs in memory only. No adjustment, no lot change, no menu change.",
  });
  return {
    books: received.map((b) => ({
      number: b.sheet.number,
      assignee: b.sheet.assignee,
      fileName: b.name,
      scans: b.parsed.scanCount,
      handUnits: b.parsed.handUnits,
      problems: b.parsed.problems.map((p) => `${p.severity === "warning" ? "(warning) " : ""}${p.message}`),
    })),
    problems: merged.problems.filter((p) => p.code === "duplicate_workbook" || p.code === "duplicate_file" || p.code === "mixed_count_date").map((p) => p.message),
    stats,
    checks,
    verified: checks.every((c) => c.ok),
    lines,
  };
}

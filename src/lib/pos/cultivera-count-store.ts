/**
 * src/lib/pos/cultivera-count-store.ts — R50 S11 server side of cultivera-count-core.ts (the Oct 30
 * count step of the Cultivera menu upload pipeline: harvest → assemble → import → lots → COUNT).
 *
 *   saveCountSales     at import time: the run's verified sales.jsonl + sales_summary.json, byte for
 *                      byte, to pos-raw/count/<import>/ with a run.json (shas + harvest snapshot time),
 *                      so the count works after the crawler prunes the run.
 *   loadCountSales     re-reads them and re-checks every sha against run.json.
 *   saveCountUpload    the counters' workbooks, byte for byte, to pos-raw/count/<import>/uploads/<batch>/.
 *   loadCountUpload    re-reads one batch (sha re-checked) for the preview and the apply.
 *   loadCountLots      the import's lots (lineage read, fail-closed) + earlier count adjustments.
 *   applyCountPlan     R15b shape: insert inventory_adjustments (reason "count" = CCRS Reconciliation
 *                      [G L1142]) then the STRICT atomic delta; the ledger row is removed when the
 *                      write is refused. Six workers. Every failure is returned, never hidden.
 *
 * No accounting writes. The Sage adjustments export leaves these rows out (migration-stock-core
 * isMigrationCountAdjustment): migrated stock is opening inventory (§1.4).
 */
import "server-only";
import crypto from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { applyLotDelta } from "@/lib/inventory/atomic-quantity";
import { loadMenuVersionsForStock, syncLotMenuStock } from "@/lib/inventory/lot-menu-stock";
import { parseJsonl } from "@/lib/pos/cultivera-fetch-button-core";
import type { SalesFiles } from "@/lib/pos/cultivera-fetch-client";
import { workbookCells } from "@/lib/pos/cultivera-count-workbook";
import {
  checkSalesSummary,
  countAdjustmentNote,
  countSessionPrefix,
  mergeCountWorkbooks,
  parseCountWorkbook,
  planCount,
  rollupSales,
  salesDayAfter,
  type CountLot,
  type CountPlan,
  type CountProblem,
  type SalesRollup,
  type UncountedPolicy,
} from "@/lib/pos/cultivera-count-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const COUNT_BUCKET = "pos-raw";
export const COUNT_REASON = "count";
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const salesKey = (importId: string, name: string) => `count/${importId}/${name}`;
const BATCH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCountBatchId(v: unknown): v is string {
  return typeof v === "string" && BATCH_RE.test(v);
}

function need(importId: string) {
  if (!isSafeImportId(importId)) throw new Error("That import id is not valid.");
}

async function put(admin: Admin, key: string, body: Buffer, contentType: string) {
  const { error } = await admin.storage.from(COUNT_BUCKET).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Could not save ${key} (${error.message}).`);
}

async function get(admin: Admin, key: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(COUNT_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/* ---------------- sales evidence (saved at import) ---------------- */

export type CountSalesRecord = {
  importId: string;
  runId: string;
  snapshotPacific: string | null;
  files: { name: string; bytes: number; sha256: string }[];
  savedAt: string;
};

export async function saveCountSales(
  admin: Admin,
  importId: string,
  runId: string,
  sales: SalesFiles,
  snapshotPacific: string | null,
): Promise<CountSalesRecord> {
  need(importId);
  if (!sales.lines || !sales.summary) throw new Error(sales.problem ?? "The run has no sales files.");
  await put(admin, salesKey(importId, "sales.jsonl"), sales.lines, "application/x-ndjson");
  await put(admin, salesKey(importId, "sales_summary.json"), sales.summary, "application/json");
  const rec: CountSalesRecord = {
    importId,
    runId,
    snapshotPacific,
    files: [
      { name: "sales.jsonl", bytes: sales.lines.length, sha256: sha(sales.lines) },
      { name: "sales_summary.json", bytes: sales.summary.length, sha256: sha(sales.summary) },
    ],
    savedAt: new Date().toISOString(),
  };
  await put(admin, salesKey(importId, "run.json"), Buffer.from(JSON.stringify(rec), "utf8"), "application/json");
  return rec;
}

export type LoadedCountSales =
  | { ok: true; record: CountSalesRecord; lines: Record<string, unknown>[]; badLines: number; summary: unknown }
  | { ok: false; problem: string };

export async function loadCountSales(admin: Admin, importId: string): Promise<LoadedCountSales> {
  need(importId);
  const runBuf = await get(admin, salesKey(importId, "run.json"));
  if (!runBuf) return { ok: false, problem: "This import has no saved Cultivera sales. Fetch again with the count date set, then stage that harvest." };
  let record: CountSalesRecord;
  try {
    record = JSON.parse(runBuf.toString("utf8")) as CountSalesRecord;
  } catch {
    return { ok: false, problem: "The saved sales record is not valid JSON." };
  }
  if (record.importId !== importId) return { ok: false, problem: "The saved sales record belongs to another import." };
  const bufs: Record<string, Buffer> = {};
  for (const f of record.files ?? []) {
    const b = await get(admin, salesKey(importId, f.name));
    if (!b) return { ok: false, problem: `${f.name} is missing from storage.` };
    if (b.length !== f.bytes || sha(b) !== f.sha256) return { ok: false, problem: `${f.name} no longer matches its checksum.` };
    bufs[f.name] = b;
  }
  if (!bufs["sales.jsonl"] || !bufs["sales_summary.json"]) return { ok: false, problem: "The saved sales record does not list both files." };
  let summary: unknown;
  try {
    summary = JSON.parse(bufs["sales_summary.json"].toString("utf8"));
  } catch {
    return { ok: false, problem: "sales_summary.json is not valid JSON." };
  }
  const pj = parseJsonl<Record<string, unknown>>(bufs["sales.jsonl"].toString("utf8"));
  return { ok: true, record, lines: pj.records, badLines: pj.bad, summary };
}

/* ---------------- uploaded workbooks ---------------- */

export type CountUploadIndex = {
  batchId: string;
  importId: string;
  uploadedBy: string | null;
  uploadedAt: string;
  files: { name: string; bytes: number; sha256: string; key: string }[];
};

const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
export const MAX_WORKBOOKS = 30;

export async function saveCountUpload(
  admin: Admin,
  importId: string,
  files: { name: string; buffer: Buffer }[],
  uploadedBy: string | null,
): Promise<CountUploadIndex> {
  need(importId);
  if (files.length === 0) throw new Error("Choose the counters' workbooks first.");
  if (files.length > MAX_WORKBOOKS) throw new Error(`At most ${MAX_WORKBOOKS} workbooks per upload.`);
  const batchId = crypto.randomUUID();
  const index: CountUploadIndex = { batchId, importId, uploadedBy, uploadedAt: new Date().toISOString(), files: [] };
  for (const [i, f] of files.entries()) {
    if (f.buffer.length === 0) throw new Error(`${f.name} is empty.`);
    if (f.buffer.length > MAX_WORKBOOK_BYTES) throw new Error(`${f.name} is larger than 8 MB; it is not a count workbook.`);
    const h = sha(f.buffer);
    const key = `count/${importId}/uploads/${batchId}/${String(i + 1).padStart(2, "0")}-${h.slice(0, 16)}.xlsx`;
    await put(admin, key, f.buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    index.files.push({ name: f.name.slice(0, 200), bytes: f.buffer.length, sha256: h, key });
  }
  await put(admin, `count/${importId}/uploads/${batchId}/index.json`, Buffer.from(JSON.stringify(index), "utf8"), "application/json");
  return index;
}

export async function loadCountUpload(
  admin: Admin,
  importId: string,
  batchId: string,
): Promise<{ index: CountUploadIndex; files: { name: string; sha256: string; buffer: Buffer }[] }> {
  need(importId);
  if (!isCountBatchId(batchId)) throw new Error("That upload id is not valid.");
  const ib = await get(admin, `count/${importId}/uploads/${batchId}/index.json`);
  if (!ib) throw new Error("That upload was not found. Upload the workbooks again.");
  const index = JSON.parse(ib.toString("utf8")) as CountUploadIndex;
  if (index.importId !== importId || index.batchId !== batchId) throw new Error("That upload belongs to another import.");
  const files: { name: string; sha256: string; buffer: Buffer }[] = [];
  for (const f of index.files) {
    const b = await get(admin, f.key);
    if (!b) throw new Error(`${f.name} is missing from storage.`);
    if (b.length !== f.bytes || sha(b) !== f.sha256) throw new Error(`${f.name} no longer matches its checksum.`);
    files.push({ name: f.name, sha256: f.sha256, buffer: b });
  }
  return { index, files };
}

/* ---------------- lots + earlier count adjustments ---------------- */

type LotRow = {
  id: string;
  lot_code: string | null;
  product_name: string | null;
  received_qty: number | string | null;
  on_hand_qty: number | string | null;
  status: string | null;
};

export type CountLotsLoad = { lots: CountLot[]; skipped: { lotId: string; reason: string }[]; manifests: number; priorAdjustments: number };

function wholeQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * The import's lots as count inputs. onHand = received_qty (the import writes received_qty =
 * on_hand_qty = Cultivera's units, import-service.ts), currentOnHand = on_hand_qty now. A lot whose
 * quantities are not whole numbers, or with no lot code, is skipped and listed (never guessed).
 * Destroyed lots are out of scope.
 */
export async function loadCountLots(admin: Admin, importId: string): Promise<CountLotsLoad> {
  need(importId);
  const manifestIds = await importManifestIds(admin, importId);
  if (manifestIds.length === 0) return { lots: [], skipped: [], manifests: 0, priorAdjustments: 0 };
  const rows = await readLotsOnManifests<LotRow>(admin, manifestIds, "id, lot_code, product_name, received_qty, on_hand_qty, status", { excludeDestroyed: true });

  // Earlier applies of THIS import's count (note prefix is written only by countAdjustmentNote).
  const prefix = countSessionPrefix(importId);
  const prior = await pagedAllChecked<{ id: string; lot_id: string; qty_delta: number | string }>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_adjustments")
      .select("id, lot_id, qty_delta")
      .eq("reason", COUNT_REASON)
      .like("note", `${prefix}%`)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as { id: string; lot_id: string; qty_delta: number | string }[] | null) ?? [] };
  });
  if (!prior.verdict.complete) throw new Error(`Could not read the earlier count adjustments. ${prior.verdict.message}`);
  const priorByLot = new Map<string, number>();
  for (const a of prior.rows) priorByLot.set(a.lot_id, (priorByLot.get(a.lot_id) ?? 0) + Number(a.qty_delta));

  const lots: CountLot[] = [];
  const skipped: CountLotsLoad["skipped"] = [];
  for (const r of rows) {
    const rec = wholeQty(r.received_qty);
    const cur = wholeQty(r.on_hand_qty);
    if (!r.lot_code || !r.lot_code.trim()) { skipped.push({ lotId: r.id, reason: "no lot code" }); continue; }
    if (rec == null || cur == null) { skipped.push({ lotId: r.id, reason: `quantity not a whole number (received ${String(r.received_qty)}, on hand ${String(r.on_hand_qty)})` }); continue; }
    lots.push({ lotId: r.id, lotCode: r.lot_code, productName: r.product_name ?? "", onHand: rec, priorCountDelta: priorByLot.get(r.id) ?? 0, currentOnHand: cur });
  }
  return { lots, skipped, manifests: manifestIds.length, priorAdjustments: prior.rows.length };
}

/** Fingerprint of exactly what will be written. The apply refuses when it differs from the preview. */
export function countPlanDigest(plan: CountPlan): string {
  const rows = plan.adjustments.map((a) => `${a.lotId}|${a.delta}|${a.onHand}|${a.counted}|${a.netSold}`).sort();
  return sha(Buffer.from(rows.join("\n"), "utf8")).slice(0, 32);
}

/* ---------------- apply ---------------- */

export type CountApplyResult = {
  applied: number;
  unitsUp: number;
  unitsDown: number;
  failed: { lotId: string; lotCode: string; error: string }[];
  /** R74 S32: lots whose menu stock could not follow the count (one sentence each). */
  menuStockProblems: string[];
};

export async function applyCountPlan(admin: Admin, importId: string, plan: CountPlan, actorId: string | null): Promise<CountApplyResult> {
  need(importId);
  if (plan.blocked) throw new Error("The count plan is blocked; nothing was written.");
  const out: CountApplyResult = { applied: 0, unitsUp: 0, unitsDown: 0, failed: [], menuStockProblems: [] };
  const queue = [...plan.adjustments];
  // R74 S32: the menu versions are loaded once; each counted lot's menu size
  // then moves by the same delta (Leafly and the website follow the count).
  const versions = queue.length > 0 ? await loadMenuVersionsForStock() : [];
  const worker = async () => {
    for (;;) {
      const a = queue.shift();
      if (!a) return;
      const note = countAdjustmentNote(importId, a);
      const { data: adj, error: insErr } = await admin
        .from("inventory_adjustments")
        .insert({ lot_id: a.lotId, qty_delta: a.delta, reason: COUNT_REASON, note, actor_id: actorId })
        .select("id")
        .single();
      if (insErr || !adj) { out.failed.push({ lotId: a.lotId, lotCode: a.lotCode, error: insErr?.message ?? "adjustment not saved" }); continue; }
      const written = await applyLotDelta(admin, {
        lotId: a.lotId,
        delta: a.delta,
        clamp: false, // STRICT: never below zero
        actorId,
        autoStatus: true, // active ↔ sold_out at zero
        fallbackAbsolute: { onHandQty: a.rolled, ...(a.rolled === 0 ? { status: "sold_out" } : {}), updatedBy: actorId },
      });
      if (!written.ok) {
        await admin.from("inventory_adjustments").delete().eq("id", (adj as { id: string }).id);
        out.failed.push({ lotId: a.lotId, lotCode: a.lotCode, error: written.error ?? "lot not updated" });
        continue;
      }
      out.applied += 1;
      if (a.delta > 0) out.unitsUp += a.delta;
      else out.unitsDown -= a.delta;
      const synced = await syncLotMenuStock(admin, a.lotId, a.delta, { versions });
      if (synced.sentence) out.menuStockProblems.push(synced.sentence);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, () => worker()));
  return out;
}

/* ---------------- preview (the page and the apply build the SAME thing) ---------------- */

export type CountPreview = {
  importId: string;
  batchId: string;
  countDate: string | null;
  salesDay: string | null;
  books: { fileName: string; counter: string; workbookId: string; scans: number; handUnits: number; harvest: string }[];
  problems: CountProblem[];
  sales: { ok: boolean; problems: string[]; runId: string | null; snapshotPacific: string | null; dateTo: string | null; fetchedAtPacific: string | null; rollup: SalesRollup | null };
  lotsLoad: { lots: number; skipped: CountLotsLoad["skipped"]; manifests: number; priorAdjustments: number };
  plan: CountPlan | null;
  /** Reasons the count cannot be applied (besides plan.blocked). */
  refusals: string[];
  canApply: boolean;
  digest: string | null;
};

export async function buildCountPreview(admin: Admin, importId: string, batchId: string, policy: UncountedPolicy): Promise<CountPreview> {
  const refusals: string[] = [];
  const { files } = await loadCountUpload(admin, importId, batchId);
  const parsed = [];
  for (const f of files) parsed.push(parseCountWorkbook({ fileName: f.name, sha256: f.sha256, cells: await workbookCells(f.buffer) }));
  const merged = mergeCountWorkbooks(parsed);
  const countDate = merged.accepted[0]?.meta?.countDate ?? null;
  const salesDay = countDate ? salesDayAfter(countDate) : null;
  if (merged.accepted.length === 0) refusals.push("No usable count workbook in this upload.");
  else if (!salesDay) refusals.push(`The workbooks' count date "${countDate}" is not a real date.`);

  const sales: CountPreview["sales"] = { ok: false, problems: [], runId: null, snapshotPacific: null, dateTo: null, fetchedAtPacific: null, rollup: null };
  const ls = await loadCountSales(admin, importId);
  if (!ls.ok) sales.problems.push(ls.problem);
  else {
    sales.runId = ls.record.runId;
    sales.snapshotPacific = ls.record.snapshotPacific;
    if (ls.badLines > 0) sales.problems.push(`sales.jsonl has ${ls.badLines} unreadable lines.`);
    if (!ls.record.snapshotPacific) sales.problems.push("The harvest has no stage start times (older crawler), so a sale after the quantities were read cannot be ruled out. Fetch again.");
    if (salesDay) {
      const chk = checkSalesSummary(ls.summary, salesDay, ls.lines.length);
      sales.problems.push(...chk.problems);
      sales.dateTo = chk.dateTo;
      sales.fetchedAtPacific = chk.fetchedAtPacific;
      sales.rollup = rollupSales(ls.lines, { salesDay, snapshotPacific: ls.record.snapshotPacific ?? undefined });
    }
    sales.ok = sales.problems.length === 0 && sales.rollup != null;
  }
  if (!sales.ok) refusals.push(...(sales.problems.length ? sales.problems : ["The Cultivera sales could not be checked."]));

  const lotsLoad = await loadCountLots(admin, importId);
  if (lotsLoad.lots.length === 0) refusals.push("This import has no Cultivera lots (a test import, or the wrong import).");
  if (lotsLoad.skipped.length > 0) refusals.push(`${lotsLoad.skipped.length} of this import's lots have no lot code or a fractional quantity; see the list.`);

  const plan =
    sales.rollup && merged.accepted.length > 0
      ? planCount({ lots: lotsLoad.lots, counted: merged.counted, sales: sales.rollup, problems: merged.problems, uncountedPolicy: policy, autocompleteRisk: merged.autocompleteRisk, listedBarcodes: merged.listed })
      : null;
  const canApply = plan != null && !plan.blocked && refusals.length === 0 && plan.adjustments.length > 0;
  return {
    importId,
    batchId,
    countDate,
    salesDay,
    books: merged.accepted.map((b) => ({
      fileName: b.fileName,
      counter: b.meta?.counter ?? "",
      workbookId: b.meta?.workbookId ?? "",
      scans: b.scanCount,
      handUnits: b.handUnits,
      harvest: b.meta?.lotsFromImport ?? "",
    })),
    problems: merged.problems,
    sales,
    lotsLoad: { lots: lotsLoad.lots.length, skipped: lotsLoad.skipped, manifests: lotsLoad.manifests, priorAdjustments: lotsLoad.priorAdjustments },
    plan,
    refusals,
    canApply,
    digest: plan ? countPlanDigest(plan) : null,
  };
}

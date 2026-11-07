/**
 * src/lib/inventory/coa-batch-cultivera-core.ts   (D202)
 *
 * Owner (D202, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md): the Fix later
 * "Fetch COAs from Cultivera" button "works for a few seconds then comes back saying it found
 * nothing ... 'done, 0 of 0 vendor files'".
 *
 * WHY (measured on the owner's run 20261107T063901Z-dd3e6ec8): Cultivera returned all 32
 * transfer details, and NONE of them carries a vendor WCIA file (`JsonFile` empty), so the
 * vendor-file stage had nothing to fetch. The COAs are still in Cultivera - on each BATCH:
 * `GET data-api/inventories/inventory-batch/{BatchId}` -> `HasCoaDocument` + `ImagePath` (the COA
 * PDF Cultivera shows as "COA Document"), `Lab`, `TestingDate` (bible R50 §1.6 / §1.8).
 *
 * The crawler now also writes `transfer_lots.json` (the live lots on the named transfers:
 * Id, Barcode, BatchId, IncomingTransferId) and `batches.jsonl` (their batch details). This
 * module plans, purely, which of our lots get which batch COA:
 *
 *   - exact barcode, and the Cultivera lot's transfer must be the lot's own rebuilt manifest's
 *     transfer (never a name, never a guess);
 *   - the batch must say HasCoaDocument and give an https COA link;
 *   - a barcode on two Cultivera lots whose batches give DIFFERENT COA links is left alone;
 *   - one lab result per COA link (lots of one batch share it); an existing lab result with the
 *     SAME coa_url is reused (the store looks it up);
 *   - fill-only is enforced by the store's guarded write (lab_result_id IS NULL, not destroyed).
 *
 * Cultivera's batch potency numbers are kept in raw_payload only: they are the POS columns
 * (percent for flower, mg for edibles), not a read certificate, so they never go into the *_pct
 * columns. The certificate's own facts come from reading the filed PDF.
 *
 * PURE - no I/O. Self-tests registered in scripts/compliance/run-pure-selftests.ts.
 */
import type { ParsedLab } from "@/lib/inventory/intake-parser";
import type { WciaLinkPlan, WciaLot, WciaLotOutcome } from "@/lib/inventory/cultivera-wcia-core";

export const BATCH_COA_SOURCE = "cultivera-batch-coa";

/** transfer_lots.json `data` rows (safe fields only). */
export type TransferLotRecord = { Id?: unknown; Barcode?: unknown; BatchId?: unknown; IncomingTransferId?: unknown };

/** batches.jsonl records (the fields this module reads). */
export type BatchCoaRecord = {
  Id?: unknown;
  HasCoaDocument?: unknown;
  ImagePath?: unknown;
  IsCannabis?: unknown;
  Lab?: unknown;
  LabId?: unknown;
  HasQaResult?: unknown;
  TestingDate?: unknown;
  BatchNumber?: unknown;
  Barcode?: unknown;
  Thc?: unknown;
  Thca?: unknown;
  Cbd?: unknown;
  Cbda?: unknown;
  Total?: unknown;
};

/** A lot to plan for: its own rebuilt manifest's Cultivera transfer id. */
export type BatchCoaLot = WciaLot & { transferId: number | null };

const posInt = (v: unknown): number | null => {
  if (typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Collapse a doubled origin (https://files.cultivera.com/https://files.cultivera.com/...). */
function undouble(u: string): string {
  const m = /^(https:\/\/[^/]+\/)(https?:\/\/.*)$/i.exec(u);
  return m ? m[2] : u;
}

/** The batch's COA link, when it is a usable absolute https URL. */
export function batchCoaUrl(b: BatchCoaRecord): { ok: true; url: string } | { ok: false; reason: "no-document" | "bad-link" } {
  if (b.HasCoaDocument !== true) return { ok: false, reason: "no-document" };
  const raw = text(b.ImagePath);
  if (!raw) return { ok: false, reason: "no-document" };
  let u: URL;
  try {
    u = new URL(undouble(raw));
  } catch {
    return { ok: false, reason: "bad-link" };
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return { ok: false, reason: "bad-link" };
  return { ok: true, url: u.toString() };
}

/** YYYY-MM-DD from Cultivera's TestingDate (date part only; no timezone arithmetic). */
export function testingDay(v: unknown): string | null {
  const s = text(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** The native lab row facts for a batch COA (no potency columns: see the header). */
export function batchLab(b: BatchCoaRecord, url: string, runId: string | null): ParsedLab {
  return {
    labtest_external_identifier: null,
    lab_name: text(b.Lab),
    tested_on: testingDay(b.TestingDate),
    thc_pct: null,
    cbd_pct: null,
    thca_pct: null,
    cbda_pct: null,
    total_thc_pct: null,
    total_cbd_pct: null,
    total_cannabinoids_pct: null,
    potency_json: null,
    terpenes_json: null,
    analytes_json: null,
    passed: null,
    coa_url: url,
    coa_release_date: null,
    coa_expire_date: null,
    raw: {
      source: BATCH_COA_SOURCE,
      cultivera_batch_id: posInt(b.Id),
      batch_number: text(b.BatchNumber),
      lab_id: b.LabId ?? null,
      has_qa_result: b.HasQaResult ?? null,
      pos_potency: { Thc: num(b.Thc), Thca: num(b.Thca), Cbd: num(b.Cbd), Cbda: num(b.Cbda), Total: num(b.Total) },
      run_id: runId,
    },
  };
}

export type BatchCoaPlan = {
  plan: WciaLinkPlan;
  /** labKey -> the COA url (for the coa_url reuse lookup and the PDF filing). */
  urlByKey: Map<string, string>;
  counts: {
    noBatch: number; // barcode not among the transfer's live Cultivera lots / no batch fetched
    noDocument: number; // the batch has no COA document in Cultivera
    badLink: number; // a COA link that is not a usable https URL
    ambiguous: number; // one barcode, two different COA links
    otherTransfer: number; // the barcode is on a different transfer than the lot's manifest
  };
  firstBadLink: string | null;
};

const emptyOutcomes = (): Record<WciaLotOutcome, number> => ({
  link: 0,
  "has-lab": 0,
  destroyed: 0,
  "no-barcode": 0,
  "not-on-transfer": 0,
  "no-lab": 0,
  ambiguous: 0,
});

/**
 * Plan the fill-only links from Cultivera batch COAs. `cvLots` / `batches` are the crawl's
 * transfer_lots.json rows and batches.jsonl records.
 */
export function planBatchCoaLinks(
  lots: readonly BatchCoaLot[],
  cvLots: readonly TransferLotRecord[],
  batches: readonly BatchCoaRecord[],
  runId: string | null = null,
): BatchCoaPlan {
  const batchById = new Map<number, BatchCoaRecord>();
  for (const b of batches) {
    const id = posInt(b.Id);
    if (id !== null && !batchById.has(id)) batchById.set(id, b);
  }
  // barcode -> the Cultivera lots carrying it (transfer + batch).
  const byBarcode = new Map<string, { transferId: number | null; batchId: number | null }[]>();
  for (const l of cvLots) {
    const bc = text(l.Barcode);
    if (!bc) continue;
    const list = byBarcode.get(bc) ?? [];
    list.push({ transferId: posInt(l.IncomingTransferId), batchId: posInt(l.BatchId) });
    byBarcode.set(bc, list);
  }

  const counts: BatchCoaPlan["counts"] = { noBatch: 0, noDocument: 0, badLink: 0, ambiguous: 0, otherTransfer: 0 };
  const outcomes = emptyOutcomes();
  const links: WciaLinkPlan["links"] = [];
  const needs = new Map<string, WciaLinkPlan["needs"][number]>();
  const urlByKey = new Map<string, string>();
  let firstBadLink: string | null = null;

  for (const lot of lots) {
    if (lot.status === "destroyed") {
      outcomes.destroyed += 1;
      continue;
    }
    if (lot.lab_result_id) {
      outcomes["has-lab"] += 1;
      continue;
    }
    const bc = (lot.lot_code ?? "").trim();
    if (!bc) {
      outcomes["no-barcode"] += 1;
      continue;
    }
    const all = byBarcode.get(bc) ?? [];
    const onMine = all.filter((x) => lot.transferId !== null && x.transferId === lot.transferId);
    if (onMine.length === 0) {
      if (all.length > 0 && lot.transferId !== null) counts.otherTransfer += 1;
      else counts.noBatch += 1;
      outcomes["not-on-transfer"] += 1;
      continue;
    }
    const urls = new Map<string, { batch: BatchCoaRecord; batchId: number }>();
    let sawBatch = false;
    let sawBad = false;
    for (const x of onMine) {
      const b = x.batchId !== null ? batchById.get(x.batchId) : undefined;
      if (!b || x.batchId === null) continue;
      sawBatch = true;
      const c = batchCoaUrl(b);
      if (c.ok) {
        if (!urls.has(c.url)) urls.set(c.url, { batch: b, batchId: x.batchId });
      } else if (c.reason === "bad-link") {
        sawBad = true;
        firstBadLink ??= String(b.ImagePath).slice(0, 160);
      }
    }
    if (urls.size > 1) {
      counts.ambiguous += 1;
      outcomes.ambiguous += 1;
      continue;
    }
    if (urls.size === 0) {
      if (!sawBatch) counts.noBatch += 1;
      else if (sawBad) counts.badLink += 1;
      else counts.noDocument += 1;
      outcomes["no-lab"] += 1;
      continue;
    }
    const [[url, hit]] = [...urls];
    const key = `cvcoa:${url}`;
    if (!needs.has(key)) needs.set(key, { key, externalId: null, lab: batchLab(hit.batch, url, runId) });
    urlByKey.set(key, url);
    links.push({ lotId: lot.id, labKey: key });
    outcomes.link += 1;
  }
  return { plan: { links, needs: [...needs.values()], outcomes, externalIds: [] }, urlByKey, counts, firstBadLink };
}

/** The crawl's batch-COA stage, as the Fix later status line says it. */
export type BatchCoaStage = { batches?: unknown; with_coa_document?: unknown; missing?: unknown; status?: unknown };
export type TransferLotsStage = { lots?: unknown; transfers_without_live_lots?: unknown };

/**
 * One honest status sentence for the last crawl (replaces the bare "0 of 0 vendor files").
 * `wcia` / `lotsStage` / `batchStage` are the state.json stages (any may be missing on an old run).
 */
export function coaCrawlStatusLine(args: {
  status: string | null;
  transfers: number;
  wcia: { wanted?: unknown; missing?: unknown } | null;
  lotsStage: TransferLotsStage | null;
  batchStage: BatchCoaStage | null;
  detailsMissing: number;
  error: string | null;
}): string {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const parts: string[] = [args.status ?? "unknown"];
  if (args.wcia) {
    const wanted = n(args.wcia.wanted);
    const missing = Array.isArray(args.wcia.missing) ? args.wcia.missing.length : 0;
    parts.push(
      wanted === 0
        ? `Cultivera has no vendor transfer file on ${args.transfers === 1 ? "this transfer" : `these ${args.transfers} transfers`}`
        : `${wanted - missing} of ${wanted} vendor transfer files`,
    );
  }
  if (args.batchStage) {
    const total = n(args.batchStage.batches);
    const withDoc = n(args.batchStage.with_coa_document);
    const missing = Array.isArray(args.batchStage.missing) ? args.batchStage.missing.length : 0;
    parts.push(`${withDoc} of ${total} batches have a COA document in Cultivera${missing > 0 ? ` (${missing} batch${missing === 1 ? "" : "es"} Cultivera did not return)` : ""}`);
  } else if (args.wcia && args.status && args.status !== "running") {
    parts.push("this crawl is from before the batch COA step: click Fetch again");
  }
  if (args.lotsStage) {
    const gone = Array.isArray(args.lotsStage.transfers_without_live_lots) ? args.lotsStage.transfers_without_live_lots.length : 0;
    if (gone > 0) parts.push(`${gone} transfer${gone === 1 ? " has" : "s have"} no live lots left in Cultivera`);
  }
  if (args.detailsMissing > 0) parts.push(`${args.detailsMissing} transfers Cultivera did not return`);
  return parts.join(", ") + (args.error ? ` (${args.error})` : "");
}

// --- Self-tests ----------------------------------------------------------------------------

export function __runCoaBatchCultiveraCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-batch-cultivera-core: " + m);
    passed += 1;
  };
  const U = (b: number) => `https://files.cultivera.com/435553542D5753313138/Coas/26/10/01/X/COA_${b}.pdf`;

  // Links.
  ok(batchCoaUrl({ HasCoaDocument: true, ImagePath: U(1) }).ok, "https link ok");
  ok(!batchCoaUrl({ HasCoaDocument: false, ImagePath: U(1) }).ok, "no document flag");
  ok(!batchCoaUrl({ HasCoaDocument: "true", ImagePath: U(1) }).ok, "flag must be true");
  ok((batchCoaUrl({ HasCoaDocument: true, ImagePath: " " }) as { reason: string }).reason === "no-document", "blank link");
  ok((batchCoaUrl({ HasCoaDocument: true, ImagePath: "http://files.cultivera.com/a.pdf" }) as { reason: string }).reason === "bad-link", "http refused");
  ok((batchCoaUrl({ HasCoaDocument: true, ImagePath: "Coas/a.pdf" }) as { reason: string }).reason === "bad-link", "relative refused");
  ok((batchCoaUrl({ HasCoaDocument: true, ImagePath: "https://u:p@files.cultivera.com/a.pdf" }) as { reason: string }).reason === "bad-link", "credentials refused");
  const dbl = batchCoaUrl({ HasCoaDocument: true, ImagePath: "https://files.cultivera.com/https://files.cultivera.com/a/COA.pdf" });
  ok(dbl.ok && dbl.url === "https://files.cultivera.com/a/COA.pdf", "doubled origin collapsed");

  // Dates.
  ok(testingDay("2026-10-01T00:00:00") === "2026-10-01" && testingDay("2026-10-01") === "2026-10-01", "date part");
  ok(testingDay("10/01/2026") === null && testingDay(null) === null && testingDay("1900-01-01") === null, "junk date");

  // Lab row.
  const lab = batchLab({ Id: 7, Lab: " Confidence Analytics ", TestingDate: "2026-09-30T12:00:00", Thc: 1.2, Total: 25, BatchNumber: "B-7" }, U(7), "r1");
  ok(lab.lab_name === "Confidence Analytics" && lab.tested_on === "2026-09-30" && lab.coa_url === U(7), "lab facts");
  ok(lab.thc_pct === null && lab.total_thc_pct === null && lab.passed === null && lab.labtest_external_identifier === null, "no potency columns, no verdict, no id");
  const raw = lab.raw as Record<string, unknown>;
  ok(raw.source === BATCH_COA_SOURCE && raw.cultivera_batch_id === 7 && (raw.pos_potency as Record<string, unknown>).Total === 25, "raw provenance");

  // Plan.
  const L = (id: string, bc: string | null, t: number | null, extra: Partial<BatchCoaLot> = {}): BatchCoaLot => ({ id, lot_code: bc, status: "active", lab_result_id: null, transferId: t, ...extra });
  const cv: TransferLotRecord[] = [
    { Id: 1, Barcode: "A1", BatchId: 101, IncomingTransferId: 1181 },
    { Id: 2, Barcode: "A2", BatchId: 101, IncomingTransferId: 1181 },
    { Id: 3, Barcode: "A3", BatchId: 102, IncomingTransferId: 1181 },
    { Id: 4, Barcode: "A4", BatchId: 103, IncomingTransferId: "1181" },
    { Id: 5, Barcode: "A5", BatchId: 104, IncomingTransferId: 1181 },
    { Id: 6, Barcode: "A5", BatchId: 105, IncomingTransferId: 1181 },
    { Id: 7, Barcode: "A6", BatchId: 106, IncomingTransferId: 1181 },
    { Id: 8, Barcode: "A6", BatchId: 107, IncomingTransferId: 1181 },
    { Id: 9, Barcode: "B1", BatchId: 108, IncomingTransferId: 1214 },
    { Id: 10, Barcode: "A7", BatchId: 999, IncomingTransferId: 1181 },
  ];
  const bs: BatchCoaRecord[] = [
    { Id: 101, HasCoaDocument: true, ImagePath: U(101), Lab: "Lab A" },
    { Id: 102, HasCoaDocument: false, ImagePath: null },
    { Id: 103, HasCoaDocument: true, ImagePath: "ftp://x/y.pdf" },
    { Id: 104, HasCoaDocument: true, ImagePath: U(104) },
    { Id: 105, HasCoaDocument: true, ImagePath: U(105) },
    { Id: 106, HasCoaDocument: true, ImagePath: U(106) },
    { Id: 107, HasCoaDocument: true, ImagePath: U(106) },
    { Id: 108, HasCoaDocument: true, ImagePath: U(108) },
    { Id: 101, HasCoaDocument: true, ImagePath: U(555) },
  ];
  const p = planBatchCoaLinks(
    [
      L("1", "A1", 1181),
      L("2", " A2 ", 1181),
      L("3", "A3", 1181),
      L("4", "A4", 1181),
      L("5", "A5", 1181),
      L("6", "A6", 1181),
      L("7", "B1", 1181), // B1 is on 1214 in Cultivera
      L("8", "A7", 1181), // batch not fetched
      L("9", "ZZ", 1181), // not on the transfer
      L("10", "A1", 1181, { lab_result_id: "keep" }),
      L("11", "A1", 1181, { status: "destroyed" }),
      L("12", null, 1181),
      L("13", "A1", null), // no transfer on our side
    ],
    cv,
    bs,
    "r9",
  );
  ok(p.plan.links.map((l) => l.lotId).join() === "1,2,6", "A1 + A2 share batch 101; A6's two batches give one link");
  ok(p.plan.needs.length === 2 && p.plan.needs.every((n) => n.externalId === null), "one lab per COA link, no invented id");
  ok(p.plan.links[0].labKey === p.plan.links[1].labKey && p.urlByKey.get(p.plan.links[0].labKey) === U(101), "first batch record wins; url kept");
  ok(p.counts.noDocument === 1 && p.counts.badLink === 1 && p.counts.ambiguous === 1, "no doc / bad link / ambiguous");
  ok(p.counts.otherTransfer === 1 && p.counts.noBatch === 3, "other transfer; unfetched batch + not on transfer + no transfer");
  ok(p.firstBadLink === "ftp://x/y.pdf", "first bad link reported");
  ok(p.plan.outcomes["has-lab"] === 1 && p.plan.outcomes.destroyed === 1 && p.plan.outcomes["no-barcode"] === 1, "fill-only outcomes");
  ok(p.plan.outcomes.link === 3 && p.plan.externalIds.length === 0, "link count");
  ok(planBatchCoaLinks([], [], []).plan.links.length === 0, "empty");

  // Status line.
  const line = coaCrawlStatusLine({ status: "done", transfers: 32, wcia: { wanted: 0, missing: [] }, lotsStage: { lots: 459, transfers_without_live_lots: [419] }, batchStage: { batches: 120, with_coa_document: 110, missing: [] }, detailsMissing: 0, error: null });
  ok(line === "done, Cultivera has no vendor transfer file on these 32 transfers, 110 of 120 batches have a COA document in Cultivera, 1 transfer has no live lots left in Cultivera", "status line, no vendor files");
  const old = coaCrawlStatusLine({ status: "done", transfers: 32, wcia: { wanted: 0, missing: [] }, lotsStage: null, batchStage: null, detailsMissing: 0, error: null });
  ok(old.includes("before the batch COA step: click Fetch again") && !old.includes("0 of 0"), "an old crawl says to fetch again");
  const some = coaCrawlStatusLine({ status: "done", transfers: 1, wcia: { wanted: 3, missing: [1] }, lotsStage: null, batchStage: { batches: 2, with_coa_document: 2, missing: [5] }, detailsMissing: 2, error: "x" });
  ok(some === "done, 2 of 3 vendor transfer files, 2 of 2 batches have a COA document in Cultivera (1 batch Cultivera did not return), 2 transfers Cultivera did not return (x)", "status line with gaps");
  return { passed, failed: 0 };
}

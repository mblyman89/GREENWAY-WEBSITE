/**
 * src/lib/inventory/coa-from-cultivera-core.ts   (D200, steps 1 + 2 of D199)
 *
 * The owner, verbatim: "let's get them directly from Cultivera ... give me a
 * simple crawl button ... Then a button to attach everything automatically."
 *
 * Pure decisions for the two buttons on Inventory > Fix later:
 *
 *   1. Fetch COAs from Cultivera: which lots still have stock and no COA, and
 *      which Cultivera transfers they came in on (only those ids are sent to
 *      the crawler, which fetches each transfer's vendor WCIA file).
 *   2. Attach all COAs: where each fetched file is kept (the manifest's own
 *      import key, so the existing attach reads it unchanged), and, for lots
 *      still without a COA afterwards, which lines of the WCIA JSONs already
 *      crawled from Gmail may fill them (barcode match, lab data only).
 *
 * Fill-only, like every COA path: a lot that already has a lab result is never
 * a target, a destroyed lot is never a target, and the store's write is the
 * guarded compare-and-set on `lab_result_id is null`.
 *
 * No I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import type { ParsedLine } from "@/lib/inventory/intake-parser";
import { isWciaDocumentText, parseTransferId, wciaStorageKey, type WciaRunRecord } from "@/lib/inventory/cultivera-wcia-core";

// --- 1. Which lots, which transfers ---------------------------------------------

export type CoaLotRow = {
  id: string;
  manifest_id: string | null;
  lot_code: string | null;
  status: string | null;
  lab_result_id: string | null;
  on_hand_qty: number | string | null;
};

export type CoaManifestRow = {
  id: string;
  manifest_number: string | null;
  import_id: string | null;
  cultivera_transfer_id: string | null;
  kind: string | null;
};

/** The Fix later "No COA" rule: stock on hand, no lab result, and not destroyed. */
export function isMissingCoaLot(lot: Pick<CoaLotRow, "status" | "lab_result_id" | "on_hand_qty">): boolean {
  if (lot.lab_result_id) return false;
  if (lot.status === "destroyed") return false;
  const q = typeof lot.on_hand_qty === "string" ? Number(lot.on_hand_qty) : lot.on_hand_qty;
  return typeof q === "number" && Number.isFinite(q) && q > 0;
}

export type CoaTargetManifest = {
  id: string;
  manifestNumber: string | null;
  importId: string;
  transferId: number;
  lotIds: string[];
};

export type CoaTargets = {
  /** Lots with stock and no COA. */
  missingLots: number;
  /** Their manifests that are rebuilt Cultivera transfers (have an import + transfer id). */
  manifests: CoaTargetManifest[];
  /** Sorted, unique: what the crawl button sends. */
  transferIds: number[];
  /** Missing lots NOT on a Cultivera transfer (only the Gmail match can help them). */
  lotsOffCultivera: number;
};

export function planCoaTargets(lots: readonly CoaLotRow[], manifests: readonly CoaManifestRow[], reconstructedKind: string): CoaTargets {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const groups = new Map<string, CoaTargetManifest>();
  let missingLots = 0;
  let lotsOffCultivera = 0;
  for (const lot of lots) {
    if (!isMissingCoaLot(lot)) continue;
    missingLots += 1;
    const m = lot.manifest_id ? byId.get(lot.manifest_id) : undefined;
    const tid = m ? parseTransferId(m.cultivera_transfer_id) : null;
    const key = m && tid !== null ? wciaStorageKey(m.import_id, tid) : null;
    if (!m || m.kind !== reconstructedKind || tid === null || !key || !m.import_id) {
      lotsOffCultivera += 1;
      continue;
    }
    const g = groups.get(m.id) ?? { id: m.id, manifestNumber: m.manifest_number, importId: m.import_id.toLowerCase(), transferId: tid, lotIds: [] };
    g.lotIds.push(lot.id);
    groups.set(m.id, g);
  }
  const list = [...groups.values()].sort((a, b) => a.transferId - b.transferId || a.id.localeCompare(b.id));
  const transferIds = [...new Set(list.map((g) => g.transferId))].sort((a, b) => a - b);
  return { missingLots, manifests: list, transferIds, lotsOffCultivera };
}

// --- 2. Fetched files -> where they are kept ---------------------------------------

export type FetchedFiles = {
  /** transfer id -> the vendor document text (only real WCIA documents). */
  byTransfer: Map<number, string>;
  /** import id -> the records to save under rehome/<import>/wcia/. */
  byImport: Map<string, WciaRunRecord[]>;
  /** Records that were not a WCIA document or had a bad id. */
  rejected: number;
  /** Good documents for a transfer none of the target manifests is on. */
  unmatched: number;
};

export function groupFetchedFiles(records: readonly WciaRunRecord[], manifests: readonly CoaTargetManifest[]): FetchedFiles {
  const byTransfer = new Map<number, string>();
  let rejected = 0;
  for (const r of records) {
    const tid = parseTransferId(typeof r.Id === "number" ? r.Id : typeof r.Id === "string" ? r.Id : null);
    if (tid === null || !isWciaDocumentText(r.JsonFile)) {
      rejected += 1;
      continue;
    }
    if (!byTransfer.has(tid)) byTransfer.set(tid, r.JsonFile);
  }
  const byImport = new Map<string, WciaRunRecord[]>();
  const used = new Set<number>();
  for (const m of manifests) {
    const text = byTransfer.get(m.transferId);
    if (text === undefined) continue;
    used.add(m.transferId);
    const list = byImport.get(m.importId) ?? [];
    if (!list.some((x) => x.Id === m.transferId)) list.push({ Id: m.transferId, JsonFile: text });
    byImport.set(m.importId, list);
  }
  const unmatched = [...byTransfer.keys()].filter((t) => !used.has(t)).length;
  return { byTransfer, byImport, rejected, unmatched };
}

// --- 3. Gmail WCIA JSONs (D199 step 1) ------------------------------------------------

/** Barcodes per `.overlaps()` read (URL length). */
export const MAIL_BARCODE_CHUNK = 100;

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Keep only `pos-raw` Gmail crawl keys (never another prefix). */
export function isMailHarvestKey(key: unknown): key is string {
  return typeof key === "string" && /^mail-harvest\/[A-Za-z0-9_.@-]+\/[A-Za-z0-9_-]+\/[^/]+\.json$/.test(key) && !key.includes("..");
}

/**
 * From the parsed lines of the crawled emails, the lines that may fill a
 * missing lot: its barcode is wanted AND the line carries lab data. A
 * lab-less line is no certificate (it can never conflict); two lines with
 * DIFFERENT lab ids for one barcode are left to planWciaLabLinks, which marks
 * them ambiguous and never guesses.
 */
export function mailLinesForBarcodes(docs: readonly (readonly ParsedLine[])[], barcodes: ReadonlySet<string>): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const lines of docs) {
    for (const line of lines) {
      const bc = (line.lot_code ?? "").trim();
      if (!bc || !barcodes.has(bc) || !line.lab) continue;
      // The same certificate sent in several emails: keep one line per barcode + lab id.
      const sig = `${bc}\u0000${line.lab.labtest_external_identifier ?? "?"}`;
      if (seen.has(sig) && line.lab.labtest_external_identifier) continue;
      seen.add(sig);
      out.push(line);
    }
  }
  return out;
}

// --- 4. The saved crawl run -------------------------------------------------------------

export const COA_RUN_SETTING_KEY = "coa_from_cultivera_run";
export const COA_RUN_SETTING_LABEL = "D200: the last 'Fetch COAs from Cultivera' crawl";
export const COA_FETCH_AUDIT = "inventory.coa_fetch_from_cultivera";
export const COA_ATTACH_AUDIT = "inventory.coa_attach_all";
/** Stop starting new Gmail documents after this much of the page's 300 s. */
export const COA_ATTACH_BUDGET_MS = 220_000;

const RUN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export type CoaRunSetting = { runId: string; transferIds: number[]; startedAt: string; savedAt: string | null };

export function parseCoaRunSetting(v: unknown): CoaRunSetting | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.runId !== "string" || !RUN_ID_RE.test(o.runId)) return null;
  const ids = Array.isArray(o.transferIds) ? o.transferIds.map(parseTransferId).filter((x): x is number => x !== null) : [];
  return {
    runId: o.runId,
    transferIds: ids,
    startedAt: typeof o.startedAt === "string" ? o.startedAt : "",
    savedAt: typeof o.savedAt === "string" && o.savedAt ? o.savedAt : null,
  };
}

// --- 5. Result -----------------------------------------------------------------------------

export type CoaAttachTotals = {
  dryRun: boolean;
  missingBefore: number;
  fetchedFiles: number;
  filesSaved: number;
  manifests: number;
  linkedFromCultivera: number;
  linkedFromMail: number;
  created: number;
  reused: number;
  mailDocsRead: number;
  ambiguous: number;
  noLabOnFile: number;
  skippedChanged: number;
  stillMissing: number;
  stoppedForTime: boolean;
  errors: string[];
};

export function emptyCoaTotals(dryRun: boolean): CoaAttachTotals {
  return {
    dryRun,
    missingBefore: 0,
    fetchedFiles: 0,
    filesSaved: 0,
    manifests: 0,
    linkedFromCultivera: 0,
    linkedFromMail: 0,
    created: 0,
    reused: 0,
    mailDocsRead: 0,
    ambiguous: 0,
    noLabOnFile: 0,
    skippedChanged: 0,
    stillMissing: 0,
    stoppedForTime: false,
    errors: [],
  };
}

export function pushError(t: CoaAttachTotals, e: string): void {
  if (t.errors.length < 5) t.errors.push(e.slice(0, 200));
}

const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;

export function coaAttachNote(t: CoaAttachTotals): string {
  const linked = t.linkedFromCultivera + t.linkedFromMail;
  const verb = t.dryRun ? "would link" : "linked";
  const parts = [
    `${verb} ${n(linked, "lot")} to its COA (${t.linkedFromCultivera} from the Cultivera transfer files, ${t.linkedFromMail} from the Gmail WCIA files)`,
    t.created + t.reused > 0 ? `${t.dryRun ? "would create" : "created"} ${n(t.created, "lab result")}, reused ${t.reused} already on file` : "",
    t.fetchedFiles > 0 ? `${n(t.fetchedFiles, "Cultivera file")} fetched${t.dryRun ? "" : `, ${t.filesSaved} saved`}` : "",
    t.mailDocsRead > 0 ? `${n(t.mailDocsRead, "Gmail file")} read` : "",
    t.ambiguous > 0 ? `${t.ambiguous} left alone (two different lab results for one barcode)` : "",
    t.skippedChanged > 0 ? `${t.skippedChanged} changed meanwhile (not touched)` : "",
  ].filter(Boolean);
  const head = t.dryRun ? "Preview (nothing was written): " : "";
  const still = t.dryRun
    ? ` ${t.missingBefore} lots have no COA today.`
    : ` ${n(t.stillMissing, "lot")} still ${t.stillMissing === 1 ? "has" : "have"} no COA (of ${t.missingBefore}).`;
  const time = t.stoppedForTime ? " Stopped before the page's time limit: click again to continue (it is safe to repeat)." : "";
  const err = t.errors.length > 0 ? ` Problems: ${t.errors.slice(0, 3).join("; ")}.` : "";
  return `${head}${parts.join("; ")}.${still}${time}${err}`;
}

export function coaAttachTone(t: CoaAttachTotals): "ok" | "warn" {
  return t.errors.length > 0 || t.stoppedForTime ? "warn" : "ok";
}

// --- 6. Self-tests ---------------------------------------------------------------------------

export function __runCoaFromCultiveraCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-from-cultivera-core: " + m);
    passed += 1;
  };
  const K = "cultivera-reconstructed";
  const IMP = "0F8FAD5B-D9CB-469F-A165-70867728950E";
  const imp = IMP.toLowerCase();

  // Missing rule.
  ok(isMissingCoaLot({ status: "active", lab_result_id: null, on_hand_qty: 3 }), "stock, no lab");
  ok(isMissingCoaLot({ status: "active", lab_result_id: null, on_hand_qty: "2.5" }), "numeric text qty");
  ok(isMissingCoaLot({ status: "quarantine", lab_result_id: null, on_hand_qty: 1 }), "quarantine still counts");
  ok(!isMissingCoaLot({ status: "active", lab_result_id: "x", on_hand_qty: 3 }), "has a lab");
  ok(!isMissingCoaLot({ status: "destroyed", lab_result_id: null, on_hand_qty: 3 }), "destroyed never");
  ok(!isMissingCoaLot({ status: "active", lab_result_id: null, on_hand_qty: 0 }), "no stock");
  ok(!isMissingCoaLot({ status: "active", lab_result_id: null, on_hand_qty: null }), "null stock");
  ok(!isMissingCoaLot({ status: "active", lab_result_id: null, on_hand_qty: "x" }), "junk stock");

  // Targets.
  const lot = (id: string, m: string | null, extra: Partial<CoaLotRow> = {}): CoaLotRow => ({ id, manifest_id: m, lot_code: "B" + id, status: "active", lab_result_id: null, on_hand_qty: 1, ...extra });
  const man = (id: string, tid: string | null, extra: Partial<CoaManifestRow> = {}): CoaManifestRow => ({ id, manifest_number: "M" + id, import_id: IMP, cultivera_transfer_id: tid, kind: K, ...extra });
  const t = planCoaTargets(
    [lot("1", "m2"), lot("2", "m2"), lot("3", "m1"), lot("4", "m3"), lot("5", "m4"), lot("6", null), lot("7", "m2", { lab_result_id: "L" }), lot("8", "m5"), lot("9", "m6"), lot("10", "zz")],
    [man("m1", "1214"), man("m2", "1181"), man("m3", null), man("m4", "1190", { kind: "native" }), man("m5", "1181"), man("m6", "77", { import_id: "../x" })],
    K,
  );
  ok(t.missingLots === 9, "9 missing (one has a lab)");
  ok(t.transferIds.join() === "1181,1214", "unique sorted transfer ids");
  ok(t.manifests.map((m) => m.id).join() === "m2,m5,m1", "manifests sorted by transfer then id");
  ok(t.manifests[0].lotIds.join() === "1,2" && t.manifests[0].importId === imp, "lots grouped, import lower-cased");
  ok(t.lotsOffCultivera === 5, "no transfer / not rebuilt / no manifest / bad import / unknown manifest");
  ok(planCoaTargets([], [], K).transferIds.length === 0, "empty");

  // Fetched files.
  const DOC = '{"inventory_transfer_items":[]}';
  const f = groupFetchedFiles(
    [{ Id: 1181, JsonFile: DOC }, { Id: "1214", JsonFile: DOC }, { Id: 1181, JsonFile: '{"inventory_transfer_items":[1]}' }, { Id: 5, JsonFile: DOC }, { Id: 0, JsonFile: DOC }, { Id: 9, JsonFile: "<html>" }, {}],
    t.manifests,
  );
  ok(f.byTransfer.size === 3 && f.byTransfer.get(1181) === DOC, "first document per transfer kept");
  ok(f.rejected === 3, "bad id / not WCIA / empty rejected");
  ok(f.unmatched === 1, "transfer 5 is on no target manifest");
  ok(f.byImport.size === 1 && (f.byImport.get(imp) ?? []).map((r) => r.Id).join() === "1181,1214", "one record per transfer per import (m2 + m5 share 1181)");

  // Mail keys.
  ok(isMailHarvestKey("mail-harvest/stephen_greenwaymarijuana.com/18f2a/1-transfer.json"), "mail key ok");
  ok(!isMailHarvestKey("rehome/x/wcia/1.json") && !isMailHarvestKey("mail-harvest/a/../b/c.json") && !isMailHarvestKey(null), "other keys refused");

  // Mail lines.
  type L = ParsedLine;
  const lab = (ext: string | null) => ({ labtest_external_identifier: ext }) as unknown as NonNullable<L["lab"]>;
  const line = (bc: string | null, l: NonNullable<L["lab"]> | null) => ({ lot_code: bc, lab: l }) as unknown as L;
  const want = new Set(["B1", "B2", "B3"]);
  const ml = mailLinesForBarcodes(
    [
      [line("B1", lab("L1")), line("B9", lab("L9")), line("B2", null), line(null, lab("L0"))],
      [line(" B1 ", lab("L1")), line("B3", lab("L3")), line("B3", lab("L4"))],
      [line("B2", lab(null)), line("B2", lab(null))],
    ],
    want,
  );
  ok(ml.map((x) => `${(x.lot_code ?? "").trim()}:${x.lab?.labtest_external_identifier ?? "-"}`).join() === "B1:L1,B3:L3,B3:L4,B2:-,B2:-", "wanted + lab only; same cert once; conflicts kept for the planner");

  // Chunks.
  ok(chunk([1, 2, 3, 4, 5], 2).map((c) => c.join("")).join() === "12,34,5" && chunk([], 3).length === 0, "chunks");

  // Run setting.
  const s = parseCoaRunSetting({ runId: "20261107T120000Z-deadbeef", transferIds: [1181, "1214", "x"], startedAt: "t" });
  ok(s !== null && s.transferIds.join() === "1181,1214" && s.savedAt === null, "setting parsed");
  ok(parseCoaRunSetting({ runId: "../x" }) === null && parseCoaRunSetting(null) === null && parseCoaRunSetting([]) === null, "bad setting");
  ok(parseCoaRunSetting({ runId: "20261107T120000Z-deadbeef", savedAt: "2026-11-07" })?.savedAt === "2026-11-07", "saved at");

  // Note.
  const tot = { ...emptyCoaTotals(false), missingBefore: 460, linkedFromCultivera: 300, linkedFromMail: 20, created: 40, reused: 2, fetchedFiles: 30, filesSaved: 30, mailDocsRead: 12, stillMissing: 140, ambiguous: 1 };
  const note = coaAttachNote(tot);
  ok(note.startsWith("linked 320 lots to its COA (300 from the Cultivera transfer files, 20 from the Gmail WCIA files)"), "note head");
  ok(note.includes("created 40 lab results, reused 2") && note.includes("30 Cultivera files fetched, 30 saved") && note.includes("12 Gmail files read"), "note counts");
  ok(note.includes("140 lots still have no COA (of 460)") && note.includes("1 left alone"), "note leftovers");
  ok(coaAttachTone(tot) === "ok", "ok tone");
  const pv = coaAttachNote({ ...emptyCoaTotals(true), missingBefore: 460, linkedFromCultivera: 1 });
  ok(pv.startsWith("Preview (nothing was written): would link 1 lot") && pv.includes("460 lots have no COA today"), "preview note");
  const st = { ...emptyCoaTotals(false), stoppedForTime: true };
  pushError(st, "e1");
  for (let i = 0; i < 9; i++) pushError(st, "e");
  ok(st.errors.length === 5 && coaAttachTone(st) === "warn" && coaAttachNote(st).includes("click again"), "warn + capped errors");
  return { passed, failed: 0 };
}

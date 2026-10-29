/**
 * src/lib/inventory/cultivera-wcia-core.ts   (R50 S3b, bible §1.5c)
 *
 * The vendor's own WCIA transfer document for each Cultivera transfer (the
 * file a vendor emails us on a native delivery; Cultivera keeps a copy per
 * transfer). This module only DECIDES:
 *
 *   - where a transfer's document is kept (private `pos-raw` bucket, next to
 *     the import's plan inputs) and whether a harvested record is usable;
 *   - which lots of a rebuilt manifest get which lab result, matching each
 *     lot to a line of ITS OWN transfer by barcode (lot_code = WCIA
 *     inventory_id; measured on 619 of 619 files, §1.5c);
 *   - the native lab_results row shape. `nativeLabRow` is the ONE builder
 *     shared with delivery intake (intake-store.ts), so a lab result from a
 *     Cultivera transfer is byte-for-byte the row a delivery would create.
 *
 * Sellable stays sellable: the plan only ever fills an EMPTY lab_result_id on
 * a lot that is not destroyed (the guarded compare-and-set of
 * linkLotLabResult). It never decides a lot's status, quantity, cost, CCRS
 * fields or a live card. A barcode that appears twice in one document with
 * two different lab results is ambiguous and is left alone (never guess).
 *
 * Pure: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import type { ParsedLab, ParsedManifest } from "@/lib/inventory/intake-parser";
import { EMAILED_COA_SOURCE } from "@/lib/inventory/coa-bundle-core";

// --- 1. Storage ----------------------------------------------------------------

export const WCIA_BUCKET = "pos-raw";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a Cultivera transfer id we will use in a storage key. */
export function isTransferId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * A transfer id read back from `raw_payload->>cultivera_transfer_id` (PostgREST
 * returns JSON-path selects as text) or as a number. Digits only; else null.
 */
export function parseTransferId(v: unknown): number | null {
  if (isTransferId(v)) return v;
  if (typeof v !== "string" || !/^[1-9][0-9]{0,15}$/.test(v)) return null;
  const n = Number(v);
  return isTransferId(n) ? n : null;
}

/** `rehome/<import>/wcia/<transferId>.json`, or null when either id is not safe for a key. */
export function wciaStorageKey(importId: unknown, transferId: unknown): string | null {
  if (typeof importId !== "string" || !UUID_RE.test(importId)) return null;
  if (!isTransferId(transferId)) return null;
  return `rehome/${importId.toLowerCase()}/wcia/${transferId}.json`;
}

/** Mirrors the crawler's wcia_text_ok: a JSON object with an inventory_transfer_items array. */
export function isWciaDocumentText(text: unknown): text is string {
  if (typeof text !== "string") return false;
  try {
    const doc = JSON.parse(text) as unknown;
    return (
      typeof doc === "object" &&
      doc !== null &&
      !Array.isArray(doc) &&
      Array.isArray((doc as { inventory_transfer_items?: unknown }).inventory_transfer_items)
    );
  } catch {
    return false;
  }
}

export type WciaRunRecord = { Id?: unknown; Url?: unknown; JsonFile?: unknown };

/**
 * The documents an import keeps, one per transfer. A record without a usable
 * id or document is counted, never saved. A transfer seen twice keeps the
 * first record (the crawler never writes two; a torn rerun might).
 */
export function wciaFilesToSave(
  importId: string,
  records: readonly WciaRunRecord[],
): { files: { transferId: number; key: string; text: string }[]; rejected: number; duplicates: number } {
  const files: { transferId: number; key: string; text: string }[] = [];
  const seen = new Set<number>();
  let rejected = 0;
  let duplicates = 0;
  for (const r of records) {
    const key = wciaStorageKey(importId, r?.Id);
    if (!key || !isWciaDocumentText(r?.JsonFile)) {
      rejected += 1;
      continue;
    }
    const id = r.Id as number;
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    files.push({ transferId: id, key, text: r.JsonFile as string });
  }
  return { files, rejected, duplicates };
}

// --- 2. The native lab_results row ---------------------------------------------------

export type LabSourceFormat = ParsedManifest["source_format"];

/** lab_results.source for a parsed document's format (unchanged from intake-store). */
export function labSourceFor(format: LabSourceFormat): string {
  return format === "wcia" ? "wcia-transfer" : format === "ccrs-csv" ? "ccrs-manifest-csv" : "vendor-json";
}

/** Fix Phase 3.1a: the source of ONE lab (an emailed certificate wins over the document format). */
export function labSourceForLab(lab: Pick<ParsedLab, "raw">, format: LabSourceFormat): string {
  const raw = lab.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).source === EMAILED_COA_SOURCE) {
    return EMAILED_COA_SOURCE;
  }
  return labSourceFor(format);
}

/**
 * The lab_results insert row delivery intake has always written. `wcia_json_url`
 * (migration 0252) is included only when the document gave one and the caller
 * has not learned that the column is missing.
 */
export function nativeLabRow(
  lab: ParsedLab,
  format: LabSourceFormat,
  actorId: string | null,
  opts: { withJsonUrl: boolean } = { withJsonUrl: true },
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    labtest_external_identifier: lab.labtest_external_identifier,
    lab_name: lab.lab_name,
    tested_on: lab.tested_on,
    thc_pct: lab.thc_pct,
    cbd_pct: lab.cbd_pct,
    thca_pct: lab.thca_pct,
    cbda_pct: lab.cbda_pct,
    total_thc_pct: lab.total_thc_pct,
    total_cbd_pct: lab.total_cbd_pct,
    total_cannabinoids_pct: lab.total_cannabinoids_pct,
    potency_json: lab.potency_json,
    terpenes_json: lab.terpenes_json,
    analytes_json: lab.analytes_json,
    passed: lab.passed,
    // Fix Phase 3.1a: a lab result read from an emailed certificate PDF says
    // so (lab_results.source is free text, 0023) - never "vendor-json".
    source: labSourceForLab(lab, format),
    coa_url: lab.coa_url,
    coa_release_date: lab.coa_release_date,
    coa_expire_date: lab.coa_expire_date,
    raw_payload: lab.raw,
    created_by: actorId,
    updated_by: actorId,
  };
  if (opts.withJsonUrl && lab.wcia_json_url) row.wcia_json_url = lab.wcia_json_url;
  return row;
}

// --- 3. The link plan ---------------------------------------------------------------

export type WciaLot = { id: string; lot_code: string | null; status: string | null; lab_result_id: string | null };

export type WciaLotOutcome =
  | "link" // gets a lab result (existing or new)
  | "has-lab" // already linked: never replaced
  | "destroyed" // never touched
  | "no-barcode"
  | "not-on-transfer" // the transfer's document has no line for this barcode
  | "no-lab" // the line carries no lab data
  | "ambiguous"; // the barcode is on two lines with different lab results

/** A lab result the plan needs: `key` is the lab test id, or `lot:<id>` when the document gave none. */
export type WciaLabNeed = { key: string; externalId: string | null; lab: ParsedLab };

export type WciaLinkPlan = {
  links: { lotId: string; labKey: string }[];
  needs: WciaLabNeed[];
  outcomes: Record<WciaLotOutcome, number>;
  /** Lab test ids to look up in lab_results before inserting (an exact id is the same certificate). */
  externalIds: string[];
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

const norm = (s: string | null | undefined) => (s ?? "").trim();

export function planWciaLabLinks(lots: readonly WciaLot[], manifest: Pick<ParsedManifest, "lines">): WciaLinkPlan {
  // barcode -> the line's lab (null = line without lab); a conflicting second line marks it ambiguous.
  const byBarcode = new Map<string, { lab: ParsedLab | null; ambiguous: boolean }>();
  for (const line of manifest.lines) {
    const bc = norm(line.lot_code);
    if (!bc) continue;
    const prev = byBarcode.get(bc);
    if (!prev) {
      byBarcode.set(bc, { lab: line.lab ?? null, ambiguous: false });
      continue;
    }
    const a = prev.lab?.labtest_external_identifier ?? null;
    const b = line.lab?.labtest_external_identifier ?? null;
    if (a !== b || (a === null && (prev.lab !== null || line.lab !== null))) prev.ambiguous = true;
  }

  const outcomes = emptyOutcomes();
  const links: WciaLinkPlan["links"] = [];
  const needs = new Map<string, WciaLabNeed>();
  for (const lot of lots) {
    if (lot.status === "destroyed") {
      outcomes.destroyed += 1;
      continue;
    }
    if (lot.lab_result_id) {
      outcomes["has-lab"] += 1;
      continue;
    }
    const bc = norm(lot.lot_code);
    if (!bc) {
      outcomes["no-barcode"] += 1;
      continue;
    }
    const hit = byBarcode.get(bc);
    if (!hit) {
      outcomes["not-on-transfer"] += 1;
      continue;
    }
    if (hit.ambiguous) {
      outcomes.ambiguous += 1;
      continue;
    }
    if (!hit.lab) {
      outcomes["no-lab"] += 1;
      continue;
    }
    const ext = norm(hit.lab.labtest_external_identifier) || null;
    const key = ext ?? `lot:${lot.id}`;
    if (!needs.has(key)) needs.set(key, { key, externalId: ext, lab: hit.lab });
    links.push({ lotId: lot.id, labKey: key });
    outcomes.link += 1;
  }
  const externalIds = [...new Set([...needs.values()].map((n) => n.externalId).filter((x): x is string => Boolean(x)))].sort();
  return { links, needs: [...needs.values()], outcomes, externalIds };
}

/**
 * Pick the existing lab_results row for each lab test id: the oldest one
 * (created_at, then id). Rows must be EXACT id matches (the store queries with
 * `.in`); anything else passed in is ignored.
 */
export function pickExistingLabs(
  rows: readonly { id: string; labtest_external_identifier: string | null; created_at: string | null }[],
  wanted: readonly string[],
): Map<string, string> {
  const want = new Set(wanted);
  const best = new Map<string, { id: string; at: string }>();
  for (const r of rows) {
    const ext = r.labtest_external_identifier;
    if (!ext || !want.has(ext)) continue;
    const at = r.created_at ?? "";
    const cur = best.get(ext);
    if (!cur || at < cur.at || (at === cur.at && r.id < cur.id)) best.set(ext, { id: r.id, at });
  }
  return new Map([...best].map(([k, v]) => [k, v.id]));
}

// --- 4. Result + note ---------------------------------------------------------

/** manifest_events.event_type of the vendor-lab-results note. */
export const CULTIVERA_WCIA_EVENT = "cultivera_vendor_lab_results";

export type WciaAttachStatus = "attached" | "no-transfer" | "no-document" | "unreadable" | "error";

export type WciaAttachResult = {
  status: WciaAttachStatus;
  /** Lots newly linked to a lab result (fill-only). */
  linked: number;
  /** Lab results created / reused by exact lab test id. */
  created: number;
  reused: number;
  /** Planned links the guarded write did not take (the lot changed meanwhile). */
  skippedChanged: number;
  outcomes: Record<WciaLotOutcome, number>;
  errors: string[];
};

export function emptyWciaResult(status: WciaAttachStatus, errors: string[] = []): WciaAttachResult {
  return { status, linked: 0, created: 0, reused: 0, skippedChanged: 0, outcomes: emptyOutcomes(), errors };
}

/** One timeline sentence. Empty string = nothing worth a note (no document for this manifest). */
export function wciaAttachNote(r: WciaAttachResult): string {
  if (r.status === "no-transfer" || r.status === "no-document") return "";
  if (r.status === "unreadable") return "The vendor's transfer file from Cultivera could not be read; no lab results were attached.";
  const o = r.outcomes;
  const parts = [
    `${r.linked} lot${r.linked === 1 ? "" : "s"} linked to the vendor's lab result`,
    r.created > 0 ? `${r.created} new lab result${r.created === 1 ? "" : "s"}` : "",
    r.reused > 0 ? `${r.reused} already on file` : "",
    o["has-lab"] > 0 ? `${o["has-lab"]} already had one (kept)` : "",
    o["not-on-transfer"] + o["no-lab"] > 0 ? `${o["not-on-transfer"] + o["no-lab"]} without lab data on the transfer` : "",
    o.ambiguous > 0 ? `${o.ambiguous} left alone (two different lab results on the transfer)` : "",
    r.skippedChanged > 0 ? `${r.skippedChanged} changed meanwhile (not touched)` : "",
  ].filter(Boolean);
  const err = r.errors.length > 0 ? ` Problems: ${r.errors.slice(0, 3).join("; ")}.` : "";
  return `Vendor lab results from the Cultivera transfer file: ${parts.join(", ")}.${err}`;
}

// --- 5. Self-tests -----------------------------------------------------------------

export function __runCultiveraWciaCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL cultivera-wcia-core: " + m);
    passed += 1;
  };
  const IMP = "0f8fad5b-d9cb-469f-a165-70867728950e";

  // Keys.
  ok(wciaStorageKey(IMP, 11) === `rehome/${IMP}/wcia/11.json`, "key");
  ok(wciaStorageKey(IMP.toUpperCase(), 11) === `rehome/${IMP}/wcia/11.json`, "key lower-cases the import");
  ok(wciaStorageKey("../x", 11) === null && wciaStorageKey(IMP, 0) === null && wciaStorageKey(IMP, -1) === null, "unsafe ids refused");
  ok(wciaStorageKey(IMP, 1.5) === null && wciaStorageKey(IMP, "11") === null && wciaStorageKey(null, 11) === null, "non-integer ids refused");
  ok(isTransferId(5) && !isTransferId(Number.MAX_SAFE_INTEGER + 1) && !isTransferId(NaN), "transfer id");
  ok(parseTransferId("4355") === 4355 && parseTransferId(4355) === 4355, "transfer id from text or number");
  ok(parseTransferId("0") === null && parseTransferId("012") === null && parseTransferId("1.5") === null && parseTransferId(" 1") === null, "junk text refused");
  ok(parseTransferId("99999999999999999") === null && parseTransferId(null) === null && parseTransferId("") === null, "too big / empty refused");

  // Document text.
  ok(isWciaDocumentText('{"inventory_transfer_items":[]}'), "doc ok");
  ok(!isWciaDocumentText("[]") && !isWciaDocumentText('{"x":1}') && !isWciaDocumentText("nope") && !isWciaDocumentText(5), "doc refused");
  ok(!isWciaDocumentText('{"inventory_transfer_items":null}') && !isWciaDocumentText("null"), "doc items must be an array");

  // Files to save.
  const doc = '{"inventory_transfer_items":[]}';
  const f = wciaFilesToSave(IMP, [{ Id: 12, JsonFile: doc }, { Id: 11, JsonFile: doc }, { Id: 12, JsonFile: doc }, { Id: "x", JsonFile: doc }, { Id: 13, JsonFile: "<html>" }, {}]);
  ok(f.files.map((x) => x.transferId).join() === "12,11" && f.duplicates === 1 && f.rejected === 3, "files to save");
  ok(f.files[0].key === `rehome/${IMP}/wcia/12.json` && f.files[0].text === doc, "file key + text");

  // Native row.
  const lab = (ext: string | null, extra: Partial<ParsedLab> = {}): ParsedLab => ({
    labtest_external_identifier: ext,
    lab_name: "Lab",
    tested_on: "2026-09-01",
    thc_pct: 1,
    cbd_pct: 0,
    thca_pct: 20,
    cbda_pct: 0,
    total_thc_pct: 18.5,
    total_cbd_pct: 0,
    total_cannabinoids_pct: 21,
    potency_json: { thca: 20 },
    terpenes_json: null,
    analytes_json: null,
    passed: true,
    coa_url: "https://certs.conflabs.com/x.pdf",
    coa_release_date: null,
    coa_expire_date: null,
    wcia_json_url: "https://certs.conflabs.com/x.json",
    raw: { a: 1 },
    ...extra,
  });
  const row = nativeLabRow(lab("L1"), "wcia", "u1");
  ok(row.source === "wcia-transfer" && row.labtest_external_identifier === "L1" && row.raw_payload !== undefined, "native row");
  ok(row.wcia_json_url === "https://certs.conflabs.com/x.json" && row.created_by === "u1" && row.updated_by === "u1", "json url + actor");
  ok(!("wcia_json_url" in nativeLabRow(lab("L1"), "wcia", null, { withJsonUrl: false })), "json url dropped when unmigrated");
  ok(!("wcia_json_url" in nativeLabRow(lab("L1", { wcia_json_url: null }), "wcia", null)), "json url only when given");
  ok(labSourceFor("ccrs-csv") === "ccrs-manifest-csv" && labSourceFor("generic") === "vendor-json" && labSourceFor("pdf-manifest") === "vendor-json", "sources");
  ok(Object.keys(row).length === 22, "row has the 21 native columns + wcia_json_url");

  // Plan.
  type L = ParsedManifest["lines"][number];
  const line = (bc: string | null, l: ParsedLab | null): L =>
    ({ product_name: "p", lot_code: bc, pos_product_key: bc, brand_name: null, category: null, strain_name: null, strain_type: null, received_qty: 1, lab: l }) as unknown as L;
  const lot = (id: string, bc: string | null, extra: Partial<WciaLot> = {}): WciaLot => ({ id, lot_code: bc, status: "active", lab_result_id: null, ...extra });
  const m = {
    lines: [
      line("B1", lab("L1")),
      line("B2", lab("L1")), // same certificate, second lot
      line("B3", lab(null)), // lab without id
      line("B4", null),
      line("B5", lab("L5")),
      line("B5", lab("L6")), // ambiguous
      line("B6", lab("L6")),
      line("B6", lab("L6")), // same lab twice = not ambiguous
      line(" B7 ", lab("L7")),
      line(null, lab("L9")),
    ],
  };
  const p = planWciaLabLinks(
    [
      lot("a", "B1"),
      lot("b", "B2"),
      lot("c", "B3"),
      lot("d", "B4"),
      lot("e", "B5"),
      lot("f", "B6"),
      lot("g", "B7"),
      lot("h", "B8"),
      lot("i", null),
      lot("j", "B1", { lab_result_id: "old" }),
      lot("k", "B1", { status: "destroyed" }),
    ],
    m,
  );
  ok(p.links.map((x) => `${x.lotId}:${x.labKey}`).join() === "a:L1,b:L1,c:lot:c,f:L6,g:L7", "links");
  ok(p.needs.map((n) => n.key).join() === "L1,lot:c,L6,L7", "needs deduped by lab id");
  ok(p.externalIds.join() === "L1,L6,L7", "external ids sorted, no null");
  const o = p.outcomes;
  ok(o.link === 5 && o["no-lab"] === 1 && o.ambiguous === 1 && o["not-on-transfer"] === 1 && o["no-barcode"] === 1 && o["has-lab"] === 1 && o.destroyed === 1, "outcomes");
  ok(planWciaLabLinks([lot("x", "B1", { status: "destroyed", lab_result_id: null })], m).links.length === 0, "destroyed never linked");
  ok(planWciaLabLinks([lot("x", "B1", { lab_result_id: "keep" })], m).links.length === 0, "a COA is never replaced");
  const amb2 = planWciaLabLinks([lot("x", "Z")], { lines: [line("Z", null), line("Z", lab("L1"))] });
  ok(amb2.outcomes.ambiguous === 1, "lab vs no-lab on the same barcode is ambiguous");
  const amb3 = planWciaLabLinks([lot("x", "Z")], { lines: [line("Z", lab(null)), line("Z", lab(null))] });
  ok(amb3.outcomes.ambiguous === 1, "two id-less labs on one barcode are ambiguous");
  const same0 = planWciaLabLinks([lot("x", "Z")], { lines: [line("Z", null), line("Z", null)] });
  ok(same0.outcomes["no-lab"] === 1, "two lab-less lines are just no-lab");

  // Existing labs.
  const ex = pickExistingLabs(
    [
      { id: "r2", labtest_external_identifier: "L1", created_at: "2026-02-01" },
      { id: "r1", labtest_external_identifier: "L1", created_at: "2026-01-01" },
      { id: "r0", labtest_external_identifier: "L6", created_at: "2026-01-01" },
      { id: "q0", labtest_external_identifier: "L6", created_at: "2026-01-01" },
      { id: "z", labtest_external_identifier: "OTHER", created_at: "2000-01-01" },
      { id: "n", labtest_external_identifier: null, created_at: "2000-01-01" },
    ],
    ["L1", "L6"],
  );
  ok(ex.get("L1") === "r1" && ex.get("L6") === "q0" && !ex.has("OTHER") && ex.size === 2, "oldest exact match, tie on id");

  // Note.
  ok(wciaAttachNote(emptyWciaResult("no-transfer")) === "" && wciaAttachNote(emptyWciaResult("no-document")) === "", "no note without a document");
  ok(wciaAttachNote(emptyWciaResult("unreadable")).includes("could not be read"), "unreadable note");
  const r = { ...emptyWciaResult("attached"), linked: 1, created: 1, reused: 2, skippedChanged: 1, outcomes: { ...o }, errors: ["e1", "e2", "e3", "e4"] };
  const note = wciaAttachNote(r);
  ok(note.startsWith("Vendor lab results from the Cultivera transfer file: 1 lot linked"), "note head");
  ok(note.includes("1 new lab result,") && note.includes("2 already on file") && note.includes("1 already had one (kept)"), "note counts");
  ok(note.includes("2 without lab data") && note.includes("1 left alone") && note.includes("1 changed meanwhile"), "note leftovers");
  ok(note.includes("e3") && !note.includes("e4"), "at most 3 problems");
  return { passed, failed: 0 };
}

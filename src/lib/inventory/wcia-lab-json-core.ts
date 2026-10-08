/**
 * src/lib/inventory/wcia-lab-json-core.ts  (Round 28)
 *
 * PURE. Reads a WCIA *Lab Result* document - the JSON behind every
 * `lab_result_link` in a WCIA transfer - into one typed lab profile.
 *
 * WHY (owner, R28): the transfer JSON carries only five potency numbers per
 * item (thc, cbd, total-thc, total-cbd, total-cannabinoids, all in percent).
 * The lab's own JSON - the link the transfer points at - carries the WHOLE
 * certificate: every cannabinoid, every terpene, every safety assay, the
 * release / expiry dates and the overall pass/fail. The transfer parser
 * never followed it. This module reads it.
 *
 * VERIFIED SHAPES (all 17 documents behind the owner's Firetree transfer were
 * downloaded and read field by field; fixtures in tests/fixtures/coa/):
 *   - Confidence Analytics, document_schema_version "2.1.0" (16 of 17):
 *       metric_list[] of { test_type: "cannabinoid assay" | "terpene assay" |
 *       "microbial assay" | ..., status, metrics[] { name, qom (a STRING),
 *       uom "pct" | "ppm" | "ppb" | "cfu" | "aw" | "unk", status } }.
 *       Cannabinoids use long chemical names ("delta(9)-tetrahydrocannabinolic
 *       acid") plus "total active ..." totals. Every cannabinoid assay also
 *       carries ONE metric whose name is the empty string with qom "0" - it is
 *       ignored (counted, never mapped: a nameless number is not a fact).
 *       Terpenes are in ppm and include "total terpenes".
 *   - Green Grower Labs, document_schema_version "1.3.0" (1 of 17):
 *       test_type "cannabinoids" with short names "d9-THC", "THCA",
 *       "total-thc", "CBD", "CBDA", "total-cbd", "total cannabinoids"; no
 *       dates, no terpene assay.
 *   Neither schema carries mg per serving - only the COA PDF does
 *   (coa-pdf-text-core.ts). Both carry the PDF url in `coa`.
 *
 * NEVER GUESS: an unknown cannabinoid name is kept in `unmapped` (shown to
 * staff), a non-numeric qom is a warning and no value, a cannabinoid in a unit
 * other than pct is never converted, and a document that does not call itself
 * a WCIA Lab Result is refused outright.
 *
 * Self-tests at the bottom run on the REAL documents (run-pure-selftests.ts
 * passes the fixture text in - this module never touches the filesystem).
 */

export type CannabinoidKey =
  | "d9-thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbga" | "cbc" | "cbca"
  | "cbn" | "cbna" | "cbdv" | "cbdva" | "thcv" | "thcva" | "d8-thc" | "cbl" | "cbt";

export type CannabinoidTotalKey =
  | "total-thc" | "total-cbd" | "total-cbg" | "total-cbn" | "total-cbc"
  | "total-cbt" | "total-d8-thc" | "total-cannabinoids";

/** Display order + labels for every canonical analyte (used by the panels). */
export const CANNABINOID_LABELS: Record<CannabinoidKey, string> = {
  "d9-thc": "Delta-9 THC",
  thca: "THCA",
  cbd: "CBD",
  cbda: "CBDA",
  cbg: "CBG",
  cbga: "CBGA",
  cbc: "CBC",
  cbca: "CBCA",
  cbn: "CBN",
  cbna: "CBNA",
  cbdv: "CBDV",
  cbdva: "CBDVA",
  thcv: "THCV",
  thcva: "THCVA",
  "d8-thc": "Delta-8 THC",
  cbl: "CBL",
  cbt: "CBT (cannabicitran)",
};

export const CANNABINOID_ORDER: CannabinoidKey[] = Object.keys(CANNABINOID_LABELS) as CannabinoidKey[];

/**
 * Every spelling seen in the real documents (and the short WCIA spellings),
 * lower-cased, mapped to ONE canonical key. Both labs plus the COA PDF table
 * ("d9-thca", "d9-thcv") resolve through this one table.
 */
const CANNABINOID_ALIASES: Record<string, CannabinoidKey> = {
  "delta(9)-tetrahydrocannabinol": "d9-thc",
  "d9-thc": "d9-thc",
  "\u03b49-thc": "d9-thc",
  "delta-9 thc": "d9-thc",
  "delta-9-thc": "d9-thc",
  thc: "d9-thc",
  "delta(9)-tetrahydrocannabinolic acid": "thca",
  thca: "thca",
  "d9-thca": "thca",
  cannabidiol: "cbd",
  cbd: "cbd",
  "cannabidiolic acid": "cbda",
  cbda: "cbda",
  cannabigerol: "cbg",
  cbg: "cbg",
  "cannabigerolic acid": "cbga",
  cbga: "cbga",
  cannabichromene: "cbc",
  cbc: "cbc",
  "cannabichromenic acid": "cbca",
  cbca: "cbca",
  cannabinol: "cbn",
  cbn: "cbn",
  "cannabinolic acid": "cbna",
  cbna: "cbna",
  cannabidivarin: "cbdv",
  cbdv: "cbdv",
  "cannabidivarinic acid": "cbdva",
  cbdva: "cbdva",
  "delta(9)-tetrahydrocannabivarin": "thcv",
  thcv: "thcv",
  "d9-thcv": "thcv",
  "delta(9)-tetrahydrocannabivarinic acid": "thcva",
  thcva: "thcva",
  "d9-thcva": "thcva",
  "delta(8)-tetrahydrocannabinol": "d8-thc",
  "d8-thc": "d8-thc",
  cannabicyclol: "cbl",
  cbl: "cbl",
  cannabicitran: "cbt",
  cbt: "cbt",
};

const TOTAL_ALIASES: Record<string, CannabinoidTotalKey> = {
  "total active delta(9)-tetrahydrocannabinol": "total-thc",
  "total-thc": "total-thc",
  "total thc": "total-thc",
  "total active cannabidiol": "total-cbd",
  "total-cbd": "total-cbd",
  "total cbd": "total-cbd",
  "total active cannabigerol": "total-cbg",
  "total active cannabinol": "total-cbn",
  "total active cannabichromene": "total-cbc",
  "total active cannabicitran": "total-cbt",
  "total active delta(8)-tetrahydrocannabinol": "total-d8-thc",
  "total cannabinoids": "total-cannabinoids",
  "total-cannabinoids": "total-cannabinoids",
};

/** Canonical key for a cannabinoid spelling, or null when unknown. */
export function cannabinoidKey(raw: string): CannabinoidKey | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return CANNABINOID_ALIASES[k] ?? null;
}

/** Canonical key for a cannabinoid TOTAL spelling, or null when unknown. */
export function cannabinoidTotalKey(raw: string): CannabinoidTotalKey | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return TOTAL_ALIASES[k] ?? null;
}

export type LabCannabinoid = { key: CannabinoidKey; name: string; pct: number };
export type LabTerpene = { name: string; ppm: number };
export type LabAssay = { type: string; status: "pass" | "fail" | null; metricCount: number };

export type WciaLabDoc = {
  schemaVersion: string;
  labName: string | null;
  labCcrsLicense: string | null;
  labResultId: string | null;
  coaUrl: string | null;
  documentOrigin: string | null;
  releaseDate: string | null;
  expireDate: string | null;
  amendedDate: string | null;
  status: "pass" | "fail" | null;
  sampleId: string | null;
  sampleSourceId: string | null;
  isMedical: boolean | null;
  /** Individual cannabinoids in percent, canonical order. */
  cannabinoids: LabCannabinoid[];
  /** Lab-reported totals in percent. */
  totals: Partial<Record<CannabinoidTotalKey, number>>;
  /** Individual terpenes in ppm (detected AND not-detected; ppm 0 = ND). */
  terpenes: LabTerpene[];
  totalTerpenesPpm: number | null;
  /** True when the document carries a terpene assay at all. */
  terpeneAssay: boolean;
  assays: LabAssay[];
  /** Cannabinoid names this reader does not know - shown, never dropped. */
  unmapped: string[];
  /** Nameless metrics skipped (Confidence emits one per cannabinoid assay). */
  namelessIgnored: number;
  warnings: string[];
};

export type WciaLabParse = { ok: true; doc: WciaLabDoc } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/** qom arrives as a string ("0.1206") in 2.1.0 and 1.3.0; numbers are accepted too. */
export function parseQom(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const passFail = (v: unknown): "pass" | "fail" | null => {
  const s = str(v)?.toLowerCase();
  return s === "pass" ? "pass" : s === "fail" ? "fail" : null;
};

const isCannabinoidAssay = (t: string) => t === "cannabinoid assay" || t === "cannabinoids" || t === "potency";
const isTerpeneAssay = (t: string) => t === "terpene assay" || t === "terpenes";

/**
 * Parse a WCIA Lab Result document (already JSON-parsed or as text).
 * Refuses anything that is not a WCIA Lab Result.
 */
export function parseWciaLabJson(input: unknown): WciaLabParse {
  let root: unknown = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch {
      return { ok: false, error: "The lab link did not return valid JSON." };
    }
  }
  if (!isObj(root)) return { ok: false, error: "The lab document is not a JSON object." };
  const docName = (str(root.document_name) ?? "").toLowerCase();
  if (!docName.includes("wcia") || !docName.includes("lab result")) {
    return { ok: false, error: `Not a WCIA Lab Result document (document_name "${str(root.document_name) ?? ""}").` };
  }
  const list = root.metric_list;
  if (!Array.isArray(list)) return { ok: false, error: "The lab document has no metric_list." };

  const warnings: string[] = [];
  const unmapped: string[] = [];
  const byKey = new Map<CannabinoidKey, LabCannabinoid>();
  const totals: Partial<Record<CannabinoidTotalKey, number>> = {};
  const terpenes: LabTerpene[] = [];
  const assays: LabAssay[] = [];
  let totalTerpenesPpm: number | null = null;
  let terpeneAssay = false;
  let namelessIgnored = 0;

  for (const assay of list) {
    if (!isObj(assay)) continue;
    const type = (str(assay.test_type) ?? "").toLowerCase();
    const metrics = Array.isArray(assay.metrics) ? assay.metrics : [];
    assays.push({ type, status: passFail(assay.status), metricCount: metrics.length });

    if (isCannabinoidAssay(type)) {
      for (const m of metrics) {
        if (!isObj(m)) continue;
        const name = typeof m.name === "string" ? m.name.trim() : "";
        if (!name) {
          namelessIgnored += 1;
          continue;
        }
        const uom = (str(m.uom) ?? "").toLowerCase();
        const value = parseQom(m.qom);
        if (value === null) {
          warnings.push(`Cannabinoid "${name}" has no readable value (${JSON.stringify(m.qom ?? null)}).`);
          continue;
        }
        if (uom !== "pct") {
          warnings.push(`Cannabinoid "${name}" is reported in "${uom || "no unit"}", not percent - not used.`);
          continue;
        }
        const tk = cannabinoidTotalKey(name);
        if (tk) {
          totals[tk] = value;
          continue;
        }
        const ck = cannabinoidKey(name);
        if (!ck) {
          unmapped.push(name);
          continue;
        }
        if (byKey.has(ck)) {
          warnings.push(`Cannabinoid ${ck} is listed twice; the first value is kept.`);
          continue;
        }
        byKey.set(ck, { key: ck, name, pct: value });
      }
    } else if (isTerpeneAssay(type)) {
      terpeneAssay = true;
      for (const m of metrics) {
        if (!isObj(m)) continue;
        const name = typeof m.name === "string" ? m.name.trim().toLowerCase().replace(/\s+/g, " ") : "";
        if (!name) {
          namelessIgnored += 1;
          continue;
        }
        const uom = (str(m.uom) ?? "").toLowerCase();
        const value = parseQom(m.qom);
        if (value === null) {
          warnings.push(`Terpene "${name}" has no readable value.`);
          continue;
        }
        // ppm is what both real labs use; pct converts exactly (1% = 10000 ppm).
        const ppm = uom === "ppm" ? value : uom === "pct" ? value * 10000 : null;
        if (ppm === null) {
          warnings.push(`Terpene "${name}" is reported in "${uom || "no unit"}" - not used.`);
          continue;
        }
        if (name === "total terpenes") totalTerpenesPpm = ppm;
        else terpenes.push({ name, ppm });
      }
    }
  }

  const cannabinoids = CANNABINOID_ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
  const sample = isObj(root.sample) ? root.sample : {};
  const med = root.is_medical;

  return {
    ok: true,
    doc: {
      schemaVersion: str(root.document_schema_version) ?? "unknown",
      labName: str(root.lab_name),
      labCcrsLicense: str(root.lab_ccrs_license),
      labResultId: str(root.labresult_id),
      coaUrl: str(root.coa),
      documentOrigin: str(root.document_origin),
      releaseDate: isoDate(root.release_date),
      expireDate: isoDate(root.expire_date),
      amendedDate: isoDate(root.amended_date),
      status: passFail(root.status),
      sampleId: str(sample.id),
      sampleSourceId: str(sample.sample_source_id),
      isMedical: med === 1 || med === "1" || med === true ? true : med === 0 || med === "0" || med === false ? false : null,
      cannabinoids,
      totals,
      terpenes,
      totalTerpenesPpm,
      terpeneAssay,
      assays,
      unmapped,
      namelessIgnored,
      warnings,
    },
  };
}

/** Detected terpenes (ppm > 0), strongest first; ties keep document order. */
export function detectedTerpenes(doc: Pick<WciaLabDoc, "terpenes">): LabTerpene[] {
  return doc.terpenes
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.ppm > 0)
    .sort((a, b) => b.t.ppm - a.t.ppm || a.i - b.i)
    .map(({ t }) => t);
}

/** Sum of the individual cannabinoids (the COA's "Total Cannabinoids" is this raw sum). */
export function cannabinoidSumPct(doc: Pick<WciaLabDoc, "cannabinoids">): number | null {
  if (doc.cannabinoids.length === 0) return null;
  return doc.cannabinoids.reduce((s, c) => s + c.pct, 0);
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// `fixtures` maps "itemNN" -> the raw text of tests/fixtures/coa/itemNN.wcia.json
// ---------------------------------------------------------------------------
export function __runWciaLabJsonCoreTests(fixtures: Record<string, string>): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL wcia-lab-json-core: " + msg);
    }
  };
  const get = (id: string): WciaLabDoc => {
    const r = parseWciaLabJson(fixtures[id] ?? "");
    if (!r.ok) throw new Error(`fixture ${id} did not parse: ${r.error}`);
    return r.doc;
  };
  const pct = (d: WciaLabDoc, k: CannabinoidKey) => d.cannabinoids.find((c) => c.key === k)?.pct ?? null;
  const ppm = (d: WciaLabDoc, n: string) => d.terpenes.find((t) => t.name === n)?.ppm ?? null;

  // ---- item00: Confidence 2.1.0, flower (LA Kush Cake) -----------------------
  const f = get("item00");
  ok(f.schemaVersion === "2.1.0", "00 schema");
  ok(f.labName === "Confidence Analytics", "00 lab");
  ok(f.labResultId === "WA-260902-019", "00 lab result id");
  ok(f.coaUrl === "https://certs.conflabs.com/full/WA-75Gf8fFPPAcx-WA-260902-019.pdf", "00 coa url");
  ok(f.releaseDate === "2026-09-04" && f.expireDate === "2027-09-04" && f.amendedDate === null, "00 dates");
  ok(f.status === "pass" && f.isMedical === true, "00 status + medical");
  ok(f.sampleId === "GF41852405692470" && f.sampleSourceId === "GF41852405692457", "00 sample ids");
  ok(pct(f, "thca") === 30.12, "00 THCA 30.12");
  ok(pct(f, "d9-thc") === 0.2603, "00 d9 0.2603");
  ok(f.totals["total-thc"] === 26.68, "00 total THC 26.68 (lab total active d9)");
  ok(f.totals["total-cbd"] === 0.05942, "00 total CBD");
  ok(f.cannabinoids.length === 17, "00 seventeen individual cannabinoids");
  ok(f.namelessIgnored === 1, "00 the nameless metric is ignored, counted once");
  ok(f.unmapped.length === 0 && f.warnings.length === 0, "00 nothing unmapped, no warnings");
  ok(ppm(f, "limonene") === 5139, "00 limonene 5139 ppm");
  ok(f.totalTerpenesPpm !== null && f.totalTerpenesPpm > 24000 && f.totalTerpenesPpm < 26000, "00 total terpenes ~25000 ppm");
  ok(f.terpeneAssay && f.terpenes.length === 45, "00 forty-five terpenes (46 metrics less the total)");
  ok(f.assays.length === 8 && f.assays.every((a) => a.status === "pass"), "00 eight assays, all pass");
  const top = detectedTerpenes(f).slice(0, 3).map((t) => t.name);
  ok(top[0] === "limonene" && top[1] === "myrcene" && top[2] === "linalool", "00 top three = the COA's own Top Three");
  // WAC 314-55-102: total = d9 + 0.877 x THCA, to the lab's rounding.
  ok(Math.abs(0.2603 + 0.877 * 30.12 - 26.68) < 0.01, "00 lab total follows the WAC rule");

  // ---- item12: Sour Mandarin edible -----------------------------------------
  const e = get("item12");
  ok(pct(e, "d9-thc") === 0.1206 && pct(e, "cbd") === 0.2219, "12 d9 + cbd");
  ok(pct(e, "cbc") === 0.2088 && pct(e, "cbg") === 0.2221, "12 cbc + cbg");
  ok(pct(e, "thca") === 0, "12 THCA 0 (not detected)");
  ok(e.terpeneAssay === false && e.terpenes.length === 0 && e.totalTerpenesPpm === null, "12 edible has no terpene assay");
  const sum = cannabinoidSumPct(e);
  ok(sum !== null && Math.abs(sum - 0.7734) < 1e-9, "12 raw cannabinoid sum 0.7734 (COA prints 0.77)");

  // ---- item01: Green Grower Labs 1.3.0 ---------------------------------------
  const g = get("item01");
  ok(g.schemaVersion === "1.3.0" && g.labName === "Green Grower Labs", "01 GGL 1.3.0");
  ok(pct(g, "d9-thc") === 1.1 && pct(g, "thca") === 86 && pct(g, "cbd") === 0 && pct(g, "cbda") === 0.22, "01 short names map");
  ok(g.totals["total-thc"] === 77 && g.totals["total-cbd"] === 0.19 && g.totals["total-cannabinoids"] === 87, "01 totals");
  ok(g.releaseDate === null && g.expireDate === null, "01 GGL carries no dates (null, never invented)");
  ok(g.coaUrl === "https://gglabs-j.github.io/2025/october/10.17.2025/buddyboy/GGL-GF41205305607131.pdf", "01 coa url");
  ok(g.terpeneAssay === false, "01 no terpene assay");
  ok(g.assays.find((a) => a.type === "cannabinoids")?.status === null, "01 cannabinoid assay status absent -> null");

  // ---- every fixture parses; every Confidence doc has the one nameless metric
  for (let i = 0; i <= 16; i++) {
    const id = `item${String(i).padStart(2, "0")}`;
    const r = parseWciaLabJson(fixtures[id] ?? "");
    ok(r.ok, `${id} parses`);
    if (r.ok && r.doc.labName === "Confidence Analytics") {
      ok(r.doc.namelessIgnored === 1 && r.doc.unmapped.length === 0, `${id} one nameless, none unmapped`);
      const t = r.doc.totals["total-thc"];
      const d9 = pct(r.doc, "d9-thc");
      const a = pct(r.doc, "thca");
      ok(t !== undefined && d9 !== null && a !== null && Math.abs(d9 + 0.877 * a - t) < 0.015, `${id} total THC = d9 + 0.877 x THCA`);
    }
  }

  // ---- refusals and edge cases ---------------------------------------------
  ok(!parseWciaLabJson("not json").ok, "garbage text refused");
  ok(!parseWciaLabJson({ document_name: "WCIA Transfer Schema", metric_list: [] }).ok, "a transfer is not a lab result");
  ok(!parseWciaLabJson({ document_name: "WCIA Lab Result Schema" }).ok, "no metric_list refused");
  ok(!parseWciaLabJson([]).ok, "array refused");
  const odd = parseWciaLabJson({
    document_name: "WCIA Lab Result Schema",
    metric_list: [
      {
        test_type: "cannabinoid assay",
        metrics: [
          { name: "mystery-cannabinoid", qom: "1.5", uom: "pct" },
          { name: "cannabidiol", qom: "ND", uom: "pct" },
          { name: "cannabinol", qom: "12", uom: "mg/g" },
          { name: "cannabigerol", qom: 0.5, uom: "pct" },
          { name: "cannabigerol", qom: "0.9", uom: "pct" },
          { name: "", qom: "0", uom: "pct" },
        ],
      },
      { test_type: "terpene assay", metrics: [{ name: "Limonene", qom: "0.5", uom: "pct" }, { name: "x", qom: "1", uom: "cfu" }] },
    ],
  });
  ok(odd.ok, "odd doc parses");
  if (odd.ok) {
    ok(odd.doc.unmapped.length === 1 && odd.doc.unmapped[0] === "mystery-cannabinoid", "unknown name kept in unmapped");
    ok(pct(odd.doc, "cbd") === null, "non-numeric qom -> no value");
    ok(pct(odd.doc, "cbn") === null, "mg/g never converted to percent");
    ok(pct(odd.doc, "cbg") === 0.5, "numeric qom accepted, first duplicate kept");
    ok(odd.doc.warnings.length === 4, "four warnings: ND, mg/g, duplicate, terpene in cfu");
    ok(odd.doc.warnings.some((w) => w.includes("\"x\"") && w.includes("cfu")), "terpene in cfu is warned, not used");
    ok(odd.doc.terpenes.length === 1, "only the readable terpene kept");
    ok(ppm(odd.doc, "limonene") === 5000, "terpene pct converts exactly to ppm (lower-cased name)");
    ok(odd.doc.namelessIgnored === 1, "nameless ignored");
    ok(odd.doc.status === null && odd.doc.schemaVersion === "unknown", "missing status/version -> null/unknown");
  }
  ok(parseQom("0.1206") === 0.1206 && parseQom(" 5 ") === 5 && parseQom("-1") === null && parseQom("<0.1") === null, "parseQom");
  ok(cannabinoidKey("Delta(9)-Tetrahydrocannabinol") === "d9-thc" && cannabinoidKey("THCa") === "thca", "aliases case-insensitive");
  ok(cannabinoidKey("total-thc") === null && cannabinoidTotalKey("total-thc") === "total-thc", "a total is never an individual");
  return { passed, failed };
}

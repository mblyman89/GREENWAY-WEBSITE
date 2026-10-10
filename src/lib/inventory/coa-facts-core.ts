/**
 * src/lib/inventory/coa-facts-core.ts  (Round 28)
 *
 * PURE. Turns the two lab documents behind a WCIA transfer line - the lab JSON
 * (`lab_result_link`, read by wcia-lab-json-core.ts) and the COA PDF (`coa`,
 * read by coa-pdf-text-core.ts) - into product facts the menu, the register
 * and the knowledge base can trust.
 *
 * Owner (R28): "I want our intelligent system to extract that data and use it
 * to fill the facts it doesn't get from the json text. So I only have to
 * manually fill the rare product that just doesn't make it through the parser."
 *
 * THREE STAGES, each a pure function:
 *   1. assembleCoaExtract  - both documents + IDENTITY checks (is the PDF the
 *      same certificate as the JSON and the transfer line?) + AGREEMENT checks
 *      (does every cannabinoid in the PDF match the JSON to the lab rounding?).
 *      The result is what lab_results.coa_extract_json stores (migration 0252).
 *   2. deriveCoaDraftFacts - for mg-dosed products (edibles, tinctures,
 *      topicals): mg per serving straight off the certificate, VERIFIED only
 *      when an independent percentage (the lab JSON, else the transfer line)
 *      times 10 times the lab's serving weight lands on the printed figure.
 *      Servings come from the NAME ("10pk") - the COA prints mg/package N/A on
 *      every owner document, so the package total is the printed per-serving
 *      figure times the written pack count, and says so.
 *   3. mergeCoaIntoExam    - folds those facts into the word-by-word engine's
 *      result (fact-extraction-core crossExamineRow). A verified name fact that
 *      the COA contradicts is a CONFLICT for a human, never an overwrite.
 *
 * WA LAW, checked on every certificate (verified on app.leg.wa.gov):
 *   WAC 314-55-095(1)(a): a single serving must not exceed 10 mg active
 *     delta-9 THC; any other single THC compound must not exceed 0.5 mg per
 *     serving and all of them together 1.0 mg.
 *   WAC 314-55-095(1)(b): a package meant to be eaten or swallowed must not
 *     exceed 100 mg active delta-9 THC.
 * The check uses the figures the certificate PRINTS (its certified, rounded
 * statement). No tolerance is applied - none was found in the rules - and the
 * exact arithmetic is disclosed beside it. A certificate over a limit HOLDS
 * the product for the owner with the reason in plain words; the facts are
 * still filled, so one click on the Product facts panel releases it.
 */

import { extractNameFacts, MG_FACT_TYPES, type Cannabinoid, type CrossExamResult, type Fact, type MinorFact } from "./fact-extraction-core";
import {
  parseWciaLabJson,
  type CannabinoidKey,
  type WciaLabDoc,
} from "./wcia-lab-json-core";
import { agreesPrinted, parseCoaPdfText, potencyRow, type CoaCheck, type CoaPdfDoc } from "./coa-pdf-text-core";
// R35: the WAC 314-55-095 limits live in ONE place, shared with the manual facts forms.
import {
  WA_OTHER_THC_EACH_MAX_MG,
  WA_OTHER_THC_TOTAL_MAX_MG,
  WA_PACKAGE_MAX_THC_MG,
  WA_SERVING_MAX_THC_MG,
} from "../compliance/serving-limit-warning-core";

export const COA_EXTRACT_VERSION = 1;
export type CoaExtractVia = "llamaparse" | "unpdf" | "none";
export type CoaExtractStatus = "ok" | "partial" | "failed";

export type CoaExtract = {
  version: number;
  jsonUrl: string | null;
  coaUrl: string | null;
  json: WciaLabDoc | null;
  jsonError: string | null;
  pdf: CoaPdfDoc | null;
  pdfError: string | null;
  pdfVia: CoaExtractVia | null;
  identity: CoaCheck[];
  agreement: CoaCheck[];
  status: CoaExtractStatus;
  /** One sentence for staff: what was read and what was not. */
  summary: string;
  extractedAt: string;
};

const sameUrl = (a: string | null, b: string | null): boolean => {
  if (!a || !b) return false;
  const n = (s: string) => s.trim().replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
  return n(a) === n(b);
};

/**
 * R36: proof that a PDF read from another host is the lab's own certificate.
 * The lab link (Confidence: /full/WA-<auth 12>-<WA-yymmdd-nnn>.pdf) carries
 * the start of the authentication code and the lab sample id; the PDF prints
 * the full code ("Auth: ...") and the sample id. Both must match. Anything
 * less (a link without the code, a PDF without an auth line) is no proof.
 */
export function rehostedCopyProof(
  labCoaUrl: string | null,
  pdf: Pick<CoaPdfDoc, "auth" | "labSampleId"> | null,
): { auth: string; sample: string } | null {
  if (!labCoaUrl || !pdf || !pdf.auth || !pdf.labSampleId) return null;
  const m = labCoaUrl.match(/WA-([A-Za-z0-9]{8,})-(WA-\d{6}-\d{3})(?:\.pdf)?(?:$|[?#])/);
  if (!m) return null;
  if (!pdf.auth.startsWith(m[1]) || pdf.labSampleId !== m[2]) return null;
  return { auth: pdf.auth, sample: pdf.labSampleId };
}

/** Stage 1: both documents, identity and agreement. */
export function assembleCoaExtract(input: {
  jsonUrl: string | null;
  coaUrl: string | null;
  /** The COA url the TRANSFER line carried (lab_results.coa_url). */
  transferCoaUrl: string | null;
  jsonText: string | null;
  jsonError?: string | null;
  pdfText: string | null;
  pdfError?: string | null;
  pdfVia: CoaExtractVia | null;
  extractedAt: string;
}): CoaExtract {
  let json: WciaLabDoc | null = null;
  let jsonError: string | null = input.jsonError ?? null;
  if (input.jsonText !== null && input.jsonText !== undefined) {
    const r = parseWciaLabJson(input.jsonText);
    if (r.ok) json = r.doc;
    else jsonError = r.error;
  }
  let pdf: CoaPdfDoc | null = null;
  let pdfError: string | null = input.pdfError ?? null;
  if (input.pdfText !== null && input.pdfText !== undefined) {
    const r = parseCoaPdfText(input.pdfText);
    if (r.ok) pdf = r.doc;
    else pdfError = r.reason;
  }

  // ---- identity: is everything the SAME certificate? -----------------------
  const identity: CoaCheck[] = [];
  if (json && input.transferCoaUrl) {
    const same = sameUrl(json.coaUrl, input.transferCoaUrl);
    // R36: a vendor's seed-to-sale system (Cultivera: files.cultivera.com) can
    // RE-HOST the lab's PDF, so the transfer link differs from the link the lab
    // JSON names. The copy is accepted only on proof, never on the host name:
    // the lab's own link carries the certificate's authentication code and lab
    // sample id (WA-<auth>-<WA-yymmdd-nnn>), and the PDF that was actually read
    // must print BOTH. Measured on 31 real re-hosted Confidence certificates.
    const rehost = same ? null : rehostedCopyProof(json.coaUrl, pdf);
    identity.push({
      what: "the lab JSON names the same COA as the transfer",
      ok: same || rehost !== null,
      detail: rehost
        ? `re-hosted copy of the lab's certificate: transfer coa ${input.transferCoaUrl}; the PDF prints auth ${rehost.auth} and sample ${rehost.sample}, the code and sample in the lab's link ${json.coaUrl}`
        : `JSON coa ${json.coaUrl ?? "(none)"}; transfer coa ${input.transferCoaUrl}`,
    });
  }
  if (pdf && json && pdf.labSampleId && json.labResultId && /^WA-\d{6}-\d{3}$/.test(json.labResultId)) {
    identity.push({
      what: "the PDF lab sample id matches the lab JSON",
      ok: pdf.labSampleId === json.labResultId,
      detail: `PDF ${pdf.labSampleId}; JSON ${json.labResultId}`,
    });
  }
  const pdfUrl = input.coaUrl ?? input.transferCoaUrl;
  const urlAuth = pdfUrl ? pdfUrl.match(/WA-([A-Za-z0-9]{8,})-(WA-\d{6}-\d{3})/) : null;
  if (pdf && urlAuth && pdf.auth) {
    identity.push({
      what: "the PDF authentication code matches its link",
      ok: pdf.auth.startsWith(urlAuth[1]) && (pdf.labSampleId === null || pdf.labSampleId === urlAuth[2]),
      detail: `link ${urlAuth[1]} / ${urlAuth[2]}; PDF auth ${pdf.auth} / ${pdf.labSampleId ?? "-"}`,
    });
  }

  // ---- agreement: every cannabinoid, PDF vs JSON ----------------------------
  const agreement: CoaCheck[] = [];
  if (pdf && json && pdf.potencyReadable) {
    for (const c of json.cannabinoids) {
      const row = potencyRow(pdf, c.key);
      if (!row || row.pct === null) continue;
      const ok = row.nd ? c.pct === 0 : agreesPrinted(row.pct, c.pct);
      agreement.push({ what: `${c.key} PDF = JSON`, ok, detail: `PDF ${row.nd ? "ND" : row.pct + "%"}; JSON ${c.pct}%` });
    }
    const t = json.totals["total-thc"];
    const pt = potencyRow(pdf, "total-thc");
    if (t !== undefined && pt && pt.pct !== null) {
      agreement.push({
        what: "Total THC PDF = JSON",
        ok: pt.nd ? t === 0 : agreesPrinted(pt.pct, t),
        detail: `PDF ${pt.nd ? "ND" : pt.pct + "%"}; JSON ${t}%`,
      });
    }
  }

  const failedChecks = [...identity, ...agreement, ...(pdf?.checks ?? [])].filter((c) => !c.ok);
  const pdfGood = pdf !== null && pdf.potencyReadable;
  let status: CoaExtractStatus;
  if (!json && !pdfGood) status = "failed";
  else if (failedChecks.length > 0 || !pdfGood || (input.jsonUrl && !json)) status = "partial";
  else status = "ok";

  const parts: string[] = [];
  if (json) parts.push(`lab JSON read (${json.cannabinoids.length} cannabinoids, ${json.terpenes.length} terpenes)`);
  else if (input.jsonUrl || jsonError) parts.push(`lab JSON not read: ${jsonError ?? "no document"}`);
  if (pdfGood) parts.push(`COA PDF read via ${input.pdfVia ?? "text"} (${pdf!.potency.length} potency rows, ${pdf!.terpenes.length} terpenes)`);
  else if (pdf) parts.push(`COA PDF opened but its potency numbers were not in the text`);
  else parts.push(`COA PDF not read: ${pdfError ?? "no document"}`);
  if (failedChecks.length > 0) parts.push(`${failedChecks.length} check(s) disagree: ${failedChecks.map((c) => c.what).join("; ")}`);

  return {
    version: COA_EXTRACT_VERSION,
    jsonUrl: input.jsonUrl,
    coaUrl: pdfUrl,
    json,
    jsonError,
    pdf,
    pdfError,
    pdfVia: input.pdfVia,
    identity,
    agreement,
    status,
    summary: parts.join(". ") + ".",
    extractedAt: input.extractedAt,
  };
}

/** A stored coa_extract_json read back (null when it is not one of ours). */
export function readStoredCoaExtract(v: unknown): CoaExtract | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== COA_EXTRACT_VERSION) return null;
  if (o.status !== "ok" && o.status !== "partial" && o.status !== "failed") return null;
  if (!Array.isArray(o.identity) || !Array.isArray(o.agreement)) return null;
  return v as CoaExtract;
}

// ---------------------------------------------------------------------------
// Stage 2: product facts for mg-dosed products
// ---------------------------------------------------------------------------

export type CoaFact = { value: number; confidence: "verified" | "single-source"; note: string };

export type CoaDraftFacts = {
  /** False = the extract cannot speak for this product (reasons say why). */
  usable: boolean;
  servingWeightG: number | null;
  thcMgPerServing: CoaFact | null;
  cbdMgPerServing: CoaFact | null;
  cbdNotDetected: boolean;
  servingsPerPack: number | null;
  packageThcMg: CoaFact | null;
  packageCbdMg: CoaFact | null;
  minors: { cannabinoid: Cannabinoid; mgPerServing: number; packageMg: number | null }[];
  ratioCheck: { label: string; agrees: boolean; detail: string } | null;
  /** Anything a human must look at - a non-empty list HOLDS the product. */
  reasons: string[];
  /** Plain disclosures shown beside the facts (never hold). */
  notes: string[];
};

const MINOR_KEYS: [CannabinoidKey, Cannabinoid][] = [
  ["cbg", "CBG"],
  ["cbn", "CBN"],
  ["cbc", "CBC"],
  ["cbdv", "CBDV"],
];
/** THC compounds other than delta-9 the WAC 314-55-095(1)(a) 0.5 mg / 1.0 mg rule covers. */
const OTHER_THC_KEYS: CannabinoidKey[] = ["d8-thc", "thcv"];

const r2 = (x: number) => Math.round(x * 100) / 100;
const approx = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.1 * Math.max(Math.abs(a), Math.abs(b)));

/** "(2:2:2:1)" written right after the cannabinoid list in the name. */
export function nameRatioParts(name: string, ratioLabel: string | null): number[] | null {
  if (!ratioLabel) return null;
  const esc = ratioLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = name.match(new RegExp(esc + String.raw`\s*\(\s*(\d+(?:\.\d+)?(?:\s*:\s*\d+(?:\.\d+)?)+)\s*\)`, "i"));
  return m ? m[1].split(":").map((s) => Number(s.trim())) : null;
}

export function deriveCoaDraftFacts(
  extract: CoaExtract | null,
  product: { name: string; inventoryType: string | null; transferTotalThcPct?: number | null; transferCbdPct?: number | null },
): CoaDraftFacts {
  const out: CoaDraftFacts = {
    usable: false,
    servingWeightG: null,
    thcMgPerServing: null,
    cbdMgPerServing: null,
    cbdNotDetected: false,
    servingsPerPack: null,
    packageThcMg: null,
    packageCbdMg: null,
    minors: [],
    ratioCheck: null,
    reasons: [],
    notes: [],
  };
  if (!MG_FACT_TYPES.has((product.inventoryType ?? "").trim())) {
    out.notes.push("Not an mg-dosed product - its potency stays in percent.");
    return out;
  }
  if (!extract) {
    out.reasons.push("The lab certificate has not been read for this product yet.");
    return out;
  }
  const badId = extract.identity.filter((c) => !c.ok);
  if (badId.length > 0) {
    out.reasons.push(`The lab documents do not describe the same sample (${badId.map((c) => c.detail).join("; ")}) - nothing was taken from them.`);
    return out;
  }
  const pdf = extract.pdf;
  if (!pdf || !pdf.potencyReadable) {
    out.reasons.push(
      pdf
        ? "The COA PDF opened, but its per-serving numbers were not readable as text."
        : `The COA PDF could not be read (${extract.pdfError ?? "no document"}).`,
    );
    return out;
  }
  const badPdf = pdf.checks.filter((c) => !c.ok);
  if (badPdf.length > 0) {
    out.reasons.push(`The certificate's own numbers do not agree with each other (${badPdf.map((c) => c.detail).join("; ")}).`);
    return out;
  }
  const sw = pdf.servingWeightG;
  out.servingWeightG = sw;
  const thcRow = potencyRow(pdf, "total-thc") ?? potencyRow(pdf, "d9-thc");
  if (!thcRow || thcRow.mgPerServing === null || sw === null) {
    out.reasons.push(
      sw === null
        ? "The certificate prints no serving weight, so it states no mg per serving."
        : "The certificate prints no THC mg per serving.",
    );
    return out;
  }
  out.usable = true;

  // ---- THC per serving: printed, verified against an independent percent ---
  const jsonThc = extract.json?.totals["total-thc"];
  const indepThc = jsonThc !== undefined ? { pct: jsonThc, from: "the lab JSON" } : product.transferTotalThcPct != null ? { pct: product.transferTotalThcPct, from: "the transfer" } : null;
  const printedThc = thcRow.nd ? 0 : thcRow.mgPerServing;
  if (indepThc) {
    const exact = indepThc.pct * 10 * sw;
    const ok = agreesPrinted(printedThc, exact);
    out.thcMgPerServing = {
      value: printedThc,
      confidence: ok ? "verified" : "single-source",
      note: ok
        ? `COA prints ${printedThc} mg THC per serving; ${indepThc.from} ${indepThc.pct}% x 10 x the lab's ${sw} g serving = ${r2(exact)} mg (agrees to the lab rounding)`
        : `COA prints ${printedThc} mg THC per serving, but ${indepThc.from} ${indepThc.pct}% x 10 x ${sw} g = ${r2(exact)} mg`,
    };
    if (!ok) out.reasons.push(`The COA's ${printedThc} mg THC per serving does not match ${indepThc.from} (${indepThc.pct}% of a ${sw} g serving is ${r2(exact)} mg) - confirm which is right.`);
  } else {
    out.thcMgPerServing = { value: printedThc, confidence: "single-source", note: `COA prints ${printedThc} mg THC per serving; no second document confirms it` };
    out.reasons.push(`Only the COA states ${printedThc} mg THC per serving; no second lab figure confirms it.`);
  }

  // ---- CBD per serving -----------------------------------------------------
  const cbdRow = potencyRow(pdf, "total-cbd") ?? potencyRow(pdf, "cbd");
  if (cbdRow && cbdRow.nd) out.cbdNotDetected = true;
  else if (cbdRow && cbdRow.mgPerServing !== null) {
    const jsonCbd = extract.json?.totals["total-cbd"];
    const indep = jsonCbd !== undefined ? jsonCbd : product.transferCbdPct ?? null;
    const ok = indep !== null && agreesPrinted(cbdRow.mgPerServing, indep * 10 * sw);
    out.cbdMgPerServing = {
      value: cbdRow.mgPerServing,
      confidence: ok ? "verified" : "single-source",
      note: ok
        ? `COA prints ${cbdRow.mgPerServing} mg CBD per serving; ${indep}% x 10 x ${sw} g = ${r2(indep! * 10 * sw)} mg`
        : `COA prints ${cbdRow.mgPerServing} mg CBD per serving; no second figure confirms it`,
    };
  }

  // ---- minor cannabinoids --------------------------------------------------
  for (const [key, label] of MINOR_KEYS) {
    const row = potencyRow(pdf, key);
    if (!row || row.nd || row.mgPerServing === null || row.mgPerServing <= 0) continue;
    const j = extract.json?.cannabinoids.find((c) => c.key === key);
    if (j && !agreesPrinted(row.mgPerServing, j.pct * 10 * sw)) {
      out.reasons.push(`The COA's ${row.mgPerServing} mg ${label} per serving does not match the lab JSON (${j.pct}%).`);
      continue;
    }
    out.minors.push({ cannabinoid: label, mgPerServing: row.mgPerServing, packageMg: null });
  }

  // ---- servings from the NAME; package totals ------------------------------
  const nf = extractNameFacts(product.name);
  const pack = nf.servingsTimesDose?.servings ?? nf.packCount;
  if (pack === null || pack <= 0) {
    out.reasons.push("The COA states mg per serving, but the product name does not say how many servings are in the package.");
  } else {
    out.servingsPerPack = pack;
    const conf = out.thcMgPerServing.confidence;
    out.packageThcMg = {
      value: r2(printedThc * pack),
      confidence: conf,
      note: `${printedThc} mg per serving (COA) x ${pack} servings (written in the name); the COA prints mg per package as N/A`,
    };
    if (out.cbdMgPerServing) {
      out.packageCbdMg = {
        value: r2(out.cbdMgPerServing.value * pack),
        confidence: out.cbdMgPerServing.confidence,
        note: `${out.cbdMgPerServing.value} mg per serving (COA) x ${pack} servings (name)`,
      };
    }
    for (const m of out.minors) m.packageMg = r2(m.mgPerServing * pack);
    // Disclosure: does the lab's serving weight fit the labelled net weight?
    const netG = nf.sizes.length === 1 && nf.sizes[0].unit === "g" ? nf.sizes[0].quantity : null;
    if (netG !== null) {
      const total = r2(pack * sw);
      if (approx(total, netG)) {
        out.notes.push(`${pack} servings x the lab's ${sw} g serving = ${total} g against the ${netG} g on the label (within 10%; the lab weighed one piece).`);
      } else {
        out.reasons.push(`${pack} servings x the lab's ${sw} g serving = ${total} g, but the name says ${netG} g - a serving may not be one piece. Confirm the serving count.`);
      }
    }
    // Name / COA agreement on a written mg dose ("10 x 10mg").
    if (nf.servingsTimesDose && !approx(nf.servingsTimesDose.mgPerServing, printedThc)) {
      out.reasons.push(`The name says ${nf.servingsTimesDose.mgPerServing} mg per serving; the COA prints ${printedThc} mg.`);
    }
  }

  // ---- ratio written in the name vs the COA ---------------------------------
  const parts = nameRatioParts(product.name, nf.ratioLabel);
  if (parts && nf.ratioCannabinoids && parts.length === nf.ratioCannabinoids.length) {
    const mgOf = (c: Cannabinoid): number | null => {
      if (c === "THC") return printedThc;
      if (c === "CBD") return out.cbdNotDetected ? 0 : out.cbdMgPerServing?.value ?? null;
      return out.minors.find((m) => m.cannabinoid === c)?.mgPerServing ?? (potencyRow(pdf, c.toLowerCase() as CannabinoidKey)?.nd ? 0 : null);
    };
    const thcIdx = nf.ratioCannabinoids.indexOf("THC");
    if (thcIdx >= 0 && printedThc > 0) {
      const unit = printedThc / parts[thcIdx];
      const rows = nf.ratioCannabinoids.map((c, i) => ({ c, want: r2(parts[i] * unit), got: mgOf(c) }));
      const agrees = rows.every((r) => r.got !== null && approx(r.got, r.want));
      const detail = rows.map((r) => `${r.c} ${r.got ?? "?"} mg (ratio says ${r.want})`).join(", ");
      out.ratioCheck = { label: `${nf.ratioLabel} (${parts.join(":")})`, agrees, detail };
      if (agrees) out.notes.push(`The ${nf.ratioLabel} ${parts.join(":")} ratio in the name matches the certificate: ${detail}.`);
      // The ratio in a name is the maker's nominal claim. No WAC tolerance
      // exists for it and the filled facts are the measured COA figures, so a
      // deviation is disclosed (shown on the panels), never a hold.
      else out.notes.push(`The name's ${nf.ratioLabel} ${parts.join(":")} ratio is nominal - the certificate measured: ${detail}. The facts use the measured figures.`);
    }
  }

  // ---- WA limits (printed figures; exact arithmetic disclosed) -------------
  if (printedThc > WA_SERVING_MAX_THC_MG) {
    const exact = indepThc ? ` (exact: ${indepThc.pct}% x 10 x ${sw} g = ${r2(indepThc.pct * 10 * sw)} mg)` : "";
    out.reasons.push(
      `The COA prints ${printedThc} mg THC per serving${exact} - above Washington's 10 mg single-serving limit (WAC 314-55-095(1)(a)). The facts are filled from the certificate; confirm before it is sold.`,
    );
  }
  if (out.packageThcMg && out.packageThcMg.value > WA_PACKAGE_MAX_THC_MG) {
    out.reasons.push(
      `${printedThc} mg x ${out.servingsPerPack} servings = ${out.packageThcMg.value} mg THC in the package - above Washington's 100 mg package limit (WAC 314-55-095(1)(b)). Confirm before it is sold.`,
    );
  }
  let otherThc = 0;
  for (const k of OTHER_THC_KEYS) {
    const row = potencyRow(pdf, k);
    if (!row || row.nd || row.mgPerServing === null) continue;
    otherThc += row.mgPerServing;
    if (row.mgPerServing > WA_OTHER_THC_EACH_MAX_MG) {
      out.reasons.push(`The COA prints ${row.mgPerServing} mg ${k} per serving - above the 0.5 mg limit for any THC compound other than delta-9 (WAC 314-55-095(1)(a)).`);
    }
  }
  if (otherThc > WA_OTHER_THC_TOTAL_MAX_MG) {
    out.reasons.push(`THC compounds other than delta-9 total ${r2(otherThc)} mg per serving - above the 1.0 mg combined limit (WAC 314-55-095(1)(a)).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 3: fold into the word-by-word engine's result
// ---------------------------------------------------------------------------

const coaFact = (f: CoaFact): Fact<number> => ({ value: f.value, source: "coa", confidence: f.confidence, note: f.note });

/**
 * The engine result with the certificate's facts folded in. A product the
 * certificate cannot speak for keeps the engine's result untouched. A
 * VERIFIED name fact is kept; when the COA disagrees with it, that is a
 * conflict for a human.
 */
export function mergeCoaIntoExam(exam: CrossExamResult, facts: CoaDraftFacts | null): CrossExamResult {
  if (!facts || !facts.usable || exam.percentMode) return exam;
  const nameVerified = exam.packageThcMg?.confidence === "verified";
  if (nameVerified && facts.packageThcMg) {
    if (approx(exam.packageThcMg!.value, facts.packageThcMg.value)) {
      const reasons = facts.reasons;
      return { ...exam, needsReview: exam.needsReview || reasons.length > 0, reviewReasons: [...exam.reviewReasons, ...reasons.filter((r) => !exam.reviewReasons.includes(r))] };
    }
    const reason = `The name gives ${exam.packageThcMg!.value} mg THC per package; the lab certificate gives ${facts.packageThcMg.value} mg - confirm which is right.`;
    return {
      ...exam,
      packageThcMg: { ...exam.packageThcMg!, confidence: "conflict", note: reason },
      needsReview: true,
      reviewReasons: [...exam.reviewReasons, reason],
    };
  }
  const minors: MinorFact[] = facts.minors.map((m) => ({
    cannabinoid: m.cannabinoid,
    mg: m.packageMg,
    source: "coa",
    confidence: m.packageMg !== null ? "verified" : "single-source",
    note: `${m.mgPerServing} mg per serving on the COA`,
  }));
  return {
    ...exam,
    servingsPerPack:
      facts.servingsPerPack !== null
        ? { value: facts.servingsPerPack, source: "name", confidence: "verified", note: "pack count written in the name" }
        : exam.servingsPerPack,
    mgPerServing: facts.thcMgPerServing ? coaFact(facts.thcMgPerServing) : exam.mgPerServing,
    packageThcMg: facts.packageThcMg ? coaFact(facts.packageThcMg) : null,
    packageCbdMg: facts.packageCbdMg ? coaFact(facts.packageCbdMg) : facts.cbdNotDetected ? null : exam.packageCbdMg,
    minorCannabinoids: minors,
    needsReview: facts.reasons.length > 0,
    reviewReasons: [...facts.reasons],
  };
}

// ---------------------------------------------------------------------------
// Knowledge-base profile
// ---------------------------------------------------------------------------

/** Lab terpene spelling -> the KB terpene slug (kb_terpenes seed). Others stay on the lab profile only. */
const TERPENE_TO_KB: Record<string, string> = {
  myrcene: "myrcene",
  "beta-myrcene": "myrcene",
  limonene: "limonene",
  "d-limonene": "limonene",
  caryophyllene: "caryophyllene",
  "beta-caryophyllene": "caryophyllene",
  "alpha-pinene": "pinene",
  "beta-pinene": "pinene",
  linalool: "linalool",
  terpinolene: "terpinolene",
  humulene: "humulene",
  "alpha-humulene": "humulene",
  "alpha-ocimene": "ocimene",
  "beta-ocimene": "ocimene",
  ocimene: "ocimene",
  bisabolol: "bisabolol",
  "alpha-bisabolol": "bisabolol",
  nerolidol: "nerolidol",
  "trans-nerolidol": "nerolidol",
  geraniol: "geraniol",
  valencene: "valencene",
  eucalyptol: "eucalyptol",
  camphene: "camphene",
  terpineol: "terpineol",
  "alpha-terpineol": "terpineol",
  borneol: "borneol",
  fenchol: "fenchol",
  sabinene: "sabinene",
  "alpha-phellandrene": "phellandrene",
  carene: "carene",
  "delta-3-carene": "carene",
  pulegone: "pulegone",
  guaiol: "guaiol",
};
/**
 * R30: a terpene name (lab spelling, or a web lookup's "Beta Myrcene" /
 * "β-caryophyllene") -> the KB terpene slug, or null when it is not one the
 * KB knows (never invented). A name that IS a KB slug maps to itself.
 */
export function kbTerpeneSlug(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name
    .trim()
    .toLowerCase()
    .replace(/β/g, "beta-")
    .replace(/α/g, "alpha-")
    .replace(/δ/g, "delta-")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    // Common lab / model abbreviations: "a-pinene", "b-caryophyllene".
    .replace(/^a-(?=[a-z]{3})/, "alpha-")
    .replace(/^b-(?=[a-z]{3})/, "beta-");
  if (!n) return null;
  if (Object.prototype.hasOwnProperty.call(TERPENE_TO_KB, n)) return TERPENE_TO_KB[n];
  const slugs = new Set(Object.values(TERPENE_TO_KB));
  return slugs.has(n) ? n : null;
}

const CANNABINOID_TO_KB: Partial<Record<CannabinoidKey, string>> = {
  "d9-thc": "thc",
  thca: "thca",
  cbd: "cbd",
  cbda: "cbda",
  cbg: "cbg",
  cbn: "cbn",
  cbc: "cbc",
  cbdv: "cbdv",
};

export type CoaProfile = {
  /** Every DETECTED terpene, strongest first, ppm (lab JSON, else PDF). */
  terpenes: { name: string; ppm: number }[];
  totalTerpenesPpm: number | null;
  /** Detected terpenes mapped to KB slugs, strongest first, de-duplicated. */
  kbTerpenes: string[];
  /** Detected cannabinoids in the KB vocabulary. */
  kbCannabinoids: string[];
  /** Every detected cannabinoid: % (and mg/serving when the COA prints it). */
  cannabinoids: { key: CannabinoidKey; pct: number; mgPerServing: number | null }[];
};

export function coaProfile(extract: CoaExtract | null): CoaProfile | null {
  if (!extract || extract.identity.some((c) => !c.ok)) return null;
  const j = extract.json;
  const p = extract.pdf;
  const terpSrc: { name: string; ppm: number }[] =
    j && j.terpeneAssay ? j.terpenes : p ? p.terpenes.map((t) => ({ name: t.name, ppm: t.ppm })) : [];
  const terpenes = terpSrc
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.ppm > 0)
    .sort((a, b) => b.t.ppm - a.t.ppm || a.i - b.i)
    .map(({ t }) => t);
  const kbTerpenes: string[] = [];
  for (const t of terpenes) {
    const slug = TERPENE_TO_KB[t.name];
    if (slug && !kbTerpenes.includes(slug)) kbTerpenes.push(slug);
  }
  const cannabinoids: CoaProfile["cannabinoids"] = [];
  if (j) {
    for (const c of j.cannabinoids) {
      if (c.pct <= 0) continue;
      const row = p ? potencyRow(p, c.key) : null;
      cannabinoids.push({ key: c.key, pct: c.pct, mgPerServing: row && !row.nd ? row.mgPerServing : null });
    }
  } else if (p) {
    for (const r of p.potency) {
      if (r.nd || r.pct === null || r.pct <= 0 || r.key.startsWith("total-")) continue;
      cannabinoids.push({ key: r.key as CannabinoidKey, pct: r.pct, mgPerServing: r.mgPerServing });
    }
  }
  const kbCannabinoids = cannabinoids
    .map((c) => CANNABINOID_TO_KB[c.key])
    .filter((s): s is string => Boolean(s))
    .filter((s, i, a) => a.indexOf(s) === i);
  const totalTerpenesPpm = j?.totalTerpenesPpm ?? p?.totalTerpenesPpm ?? null;
  return { terpenes, totalTerpenesPpm, kbTerpenes, kbCannabinoids, cannabinoids };
}

/** Fill-only union: existing KB entries stay first, new ones are appended. */
export function unionKbList(existing: readonly string[] | null | undefined, add: readonly string[]): { next: string[]; added: string[] } {
  const next = [...(existing ?? [])];
  const have = new Set(next.map((s) => s.trim().toLowerCase()));
  const added: string[] = [];
  for (const a of add) {
    const k = a.trim().toLowerCase();
    if (!k || have.has(k)) continue;
    have.add(k);
    next.push(k);
    added.push(k);
  }
  return { next, added };
}

// ---------------------------------------------------------------------------
// Self-tests. fixtures: "itemNN.wcia" / "itemNN.unpdf" / "itemNN.layout" / "transfer".
// ---------------------------------------------------------------------------
export function __runCoaFactsCoreTests(fixtures: Record<string, string>): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL coa-facts-core: " + msg);
    }
  };
  type Item = { product_name: string; inventory_type: string; lab_result_link: string; lab_result_data: { coa: string; potency: { type: string; value: number }[] } };
  const items = (JSON.parse(fixtures.transfer ?? "{}") as { inventory_transfer_items?: Item[] }).inventory_transfer_items ?? [];
  ok(items.length === 17, "transfer has 17 lines");
  const at = "2026-10-07T00:00:00.000Z";
  const extractFor = (i: number, shape: "unpdf" | "layout" = "unpdf", over: Partial<Parameters<typeof assembleCoaExtract>[0]> = {}) => {
    const id = `item${String(i).padStart(2, "0")}`;
    const it = items[i];
    return assembleCoaExtract({
      jsonUrl: it.lab_result_link,
      coaUrl: it.lab_result_data.coa,
      transferCoaUrl: it.lab_result_data.coa,
      jsonText: fixtures[`${id}.wcia`] ?? null,
      pdfText: fixtures[`${id}.${shape}`] ?? null,
      pdfVia: "unpdf",
      extractedAt: at,
      ...over,
    });
  };
  const pot = (i: number, t: string) => items[i].lab_result_data.potency.find((p) => p.type === t)?.value ?? null;
  const factsFor = (i: number, ex = extractFor(i)) =>
    deriveCoaDraftFacts(ex, { name: items[i].product_name, inventoryType: items[i].inventory_type, transferTotalThcPct: pot(i, "total-thc"), transferCbdPct: pot(i, "total-cbd") });

  // ---- stage 1 on every real line ------------------------------------------
  for (let i = 0; i < 17; i++) {
    const ex = extractFor(i);
    if (i === 1) {
      ok(ex.status === "partial" && ex.json !== null && ex.pdf?.template === "ggl" && !ex.pdf.potencyReadable, "01 GGL: JSON read, PDF numbers not in the unpdf text -> partial");
      continue;
    }
    ok(ex.status === "ok", `item ${i} extract ok: ${ex.summary}`);
    ok(ex.identity.length === 3 && ex.identity.every((c) => c.ok), `item ${i} three identity checks pass`);
    ok(ex.agreement.length >= 17 && ex.agreement.every((c) => c.ok), `item ${i} every cannabinoid PDF = JSON`);
  }
  ok(extractFor(1, "layout").status === "ok", "01 GGL layout text: numbers present -> ok");

  // ---- stage 2: the five edible holds resolve from the certificate ---------
  const EXPECT: Record<number, { thc: number; pack: number; cbd: number | null; minors: string; held: boolean; ratioAgrees: boolean }> = {
    12: { thc: 5.5, pack: 55, cbd: 100, minors: "CBG:100,CBC:95", held: false, ratioAgrees: false },
    13: { thc: 11, pack: 110, cbd: null, minors: "CBG:300", held: true, ratioAgrees: true },
    14: { thc: 11, pack: 110, cbd: 210, minors: "CBN:210", held: true, ratioAgrees: true },
    15: { thc: 10, pack: 100, cbd: 98, minors: "CBN:98", held: false, ratioAgrees: true },
    16: { thc: 10, pack: 100, cbd: 490, minors: "", held: false, ratioAgrees: true },
  };
  for (const [k, x] of Object.entries(EXPECT)) {
    const i = Number(k);
    for (const shape of ["unpdf", "layout"] as const) {
      const f = factsFor(i, extractFor(i, shape));
      const tag = `${i}.${shape}`;
      ok(f.usable, `${tag} usable`);
      ok(f.thcMgPerServing?.value === x.thc && f.thcMgPerServing.confidence === "verified", `${tag} ${x.thc} mg THC/serving verified`);
      ok(f.servingsPerPack === 10, `${tag} 10 servings from "10pk"`);
      ok(f.packageThcMg?.value === x.pack, `${tag} package THC ${x.pack}`);
      ok(x.cbd === null ? f.packageCbdMg === null && f.cbdNotDetected : f.packageCbdMg?.value === x.cbd && f.packageCbdMg.confidence === "verified", `${tag} package CBD`);
      ok(f.minors.map((m) => `${m.cannabinoid}:${m.packageMg}`).sort().join(",") === x.minors.split(",").filter(Boolean).sort().join(","), `${tag} minors ${x.minors}: ${f.minors.map((m) => `${m.cannabinoid}:${m.packageMg}`).join(",")}`);
      ok(f.ratioCheck?.agrees === x.ratioAgrees, `${tag} name ratio agrees=${x.ratioAgrees}: ${f.ratioCheck?.detail}`);
      ok((f.reasons.length > 0) === x.held, `${tag} held=${x.held}: ${f.reasons.join(" | ")}`);
      ok(f.notes.some((n) => n.includes("within 10%")), `${tag} serving weight vs label disclosed`);
    }
  }
  const f13 = factsFor(13);
  ok(f13.reasons.length === 2 && f13.reasons[0].includes("WAC 314-55-095(1)(a)") && f13.reasons[0].includes("10.62 mg"), "13: over 10 mg/serving, exact 10.62 disclosed");
  ok(f13.reasons[1].includes("110 mg") && f13.reasons[1].includes("WAC 314-55-095(1)(b)"), "13: over 100 mg/package");
  const f12 = factsFor(12);
  ok(f12.thcMgPerServing!.note.includes("0.1206% x 10 x the lab's 4.54 g serving = 5.48 mg"), "12 note shows the arithmetic");

  // stage 2 refusals
  const flower = factsFor(0);
  ok(!flower.usable && flower.reasons.length === 0 && flower.notes[0].includes("percent"), "flower: percent product, no mg facts, no hold");
  ok(deriveCoaDraftFacts(null, { name: items[12].product_name, inventoryType: "Solid Edible" }).reasons[0].includes("not been read"), "no extract -> reason");
  const swapped = assembleCoaExtract({
    jsonUrl: items[12].lab_result_link,
    coaUrl: items[12].lab_result_data.coa,
    transferCoaUrl: items[12].lab_result_data.coa,
    jsonText: fixtures["item12.wcia"],
    pdfText: fixtures["item13.unpdf"],
    pdfVia: "unpdf",
    extractedAt: at,
  });
  ok(swapped.identity.some((c) => !c.ok) && swapped.status === "partial", "the wrong PDF fails identity");
  const fs = deriveCoaDraftFacts(swapped, { name: items[12].product_name, inventoryType: "Solid Edible" });
  ok(!fs.usable && fs.reasons[0].includes("same sample"), "a wrong PDF never fills facts");
  const wrongJson = assembleCoaExtract({
    jsonUrl: items[12].lab_result_link,
    coaUrl: items[12].lab_result_data.coa,
    transferCoaUrl: items[12].lab_result_data.coa,
    jsonText: fixtures["item14.wcia"],
    pdfText: fixtures["item12.unpdf"],
    pdfVia: "unpdf",
    extractedAt: at,
  });
  ok(wrongJson.identity.filter((c) => !c.ok).length === 2, "the wrong JSON fails coa-url and sample-id identity");
  const pdfOnly = extractFor(12, "unpdf", { jsonText: null, jsonError: "timeout" });
  ok(pdfOnly.status === "partial" && pdfOnly.summary.includes("timeout"), "JSON fetch failed -> partial, reason kept");
  const fpo = deriveCoaDraftFacts(pdfOnly, { name: items[12].product_name, inventoryType: "Solid Edible", transferTotalThcPct: 0.1206, transferCbdPct: 0.2219 });
  ok(fpo.thcMgPerServing?.confidence === "verified" && fpo.thcMgPerServing.note.includes("the transfer"), "no JSON: the transfer percent verifies the COA");
  const fnone = deriveCoaDraftFacts(pdfOnly, { name: items[12].product_name, inventoryType: "Solid Edible" });
  ok(fnone.thcMgPerServing?.confidence === "single-source" && fnone.reasons.some((r) => r.includes("no second lab figure")), "no independent percent -> single-source, held");
  const fbad = deriveCoaDraftFacts(pdfOnly, { name: items[12].product_name, inventoryType: "Solid Edible", transferTotalThcPct: 0.3 });
  ok(fbad.thcMgPerServing?.confidence === "single-source" && fbad.reasons.some((r) => r.includes("does not match the transfer")), "a disagreeing transfer percent -> held");
  const nopack = deriveCoaDraftFacts(extractFor(12), { name: "bytes - Sour Mandarin - 50g", inventoryType: "Solid Edible" });
  ok(nopack.servingsPerPack === null && nopack.packageThcMg === null && nopack.reasons.some((r) => r.includes("how many servings")), "no pack count -> no package total, held");
  const wrongWeight = deriveCoaDraftFacts(extractFor(12), { name: "bytes - 10pk - Sour Mandarin - 100g", inventoryType: "Solid Edible" });
  ok(wrongWeight.reasons.some((r) => r.includes("a serving may not be one piece")), "10 x 4.54 g vs 100 g -> held");
  const nameDose = deriveCoaDraftFacts(extractFor(12), { name: "bytes - 10 x 10mg - Sour Mandarin - 50g", inventoryType: "Solid Edible" });
  ok(nameDose.reasons.some((r) => r.includes("name says 10 mg per serving")), "name dose vs COA dose disagreement -> held");
  const badRatio = deriveCoaDraftFacts(extractFor(12), { name: "bytes - CBG:CBC:CBD:THC (5:5:5:1) - 10pk - x - 50g", inventoryType: "Solid Edible" });
  ok(badRatio.ratioCheck?.agrees === false && badRatio.reasons.length === 0 && badRatio.notes.some((r) => r.includes("ratio is nominal")), "a wrong ratio claim -> disclosed, not held (no WAC tolerance)");
  ok(nameRatioParts("x CBG:THC (3:1) y", "CBG:THC")?.join(",") === "3,1" && nameRatioParts("x CBG:THC y", "CBG:THC") === null, "nameRatioParts");

  // ---- stage 3: merge into the engine result --------------------------------
  const exam: CrossExamResult = {
    name: extractNameFacts(items[12].product_name),
    percentMode: false,
    servingsPerPack: null,
    mgPerServing: null,
    packageThcMg: { value: 0.1206, source: "column", confidence: "single-source", note: "x" },
    packageCbdMg: null,
    minorCannabinoids: [],
    ratioLabel: { value: "CBG:CBC:CBD:THC", source: "name", confidence: "verified", note: null },
    needsReview: true,
    reviewReasons: ["The name carries no mg figures; ..."],
  };
  const merged = mergeCoaIntoExam(exam, f12);
  ok(!merged.needsReview && merged.reviewReasons.length === 0, "12 merged: the hold resolves");
  ok(merged.packageThcMg?.value === 55 && merged.packageThcMg.source === "coa" && merged.packageThcMg.confidence === "verified", "12 merged package THC 55 (coa, verified)");
  ok(merged.mgPerServing?.value === 5.5 && merged.servingsPerPack?.value === 10 && merged.packageCbdMg?.value === 100, "12 merged serving facts");
  ok(merged.minorCannabinoids.length === 2 && merged.minorCannabinoids.every((m) => m.source === "coa" && m.confidence === "verified"), "12 merged minors from the COA");
  ok(merged.ratioLabel?.value === "CBG:CBC:CBD:THC", "ratio label kept");
  const m13 = mergeCoaIntoExam({ ...exam, name: extractNameFacts(items[13].product_name) }, f13);
  ok(m13.needsReview && m13.reviewReasons.length === 2 && m13.packageThcMg?.value === 110, "13 merged: facts filled, held for the WA limit");
  ok(mergeCoaIntoExam(exam, null) === exam && mergeCoaIntoExam(exam, flower) === exam, "nothing usable -> the engine result unchanged");
  const verifiedName: CrossExamResult = { ...exam, packageThcMg: { value: 55, source: "name-internal", confidence: "verified", note: null }, needsReview: false, reviewReasons: [] };
  const agree = mergeCoaIntoExam(verifiedName, f12);
  ok(agree.packageThcMg?.source === "name-internal" && !agree.needsReview, "a verified name fact the COA agrees with is kept");
  const conflict = mergeCoaIntoExam({ ...verifiedName, packageThcMg: { value: 100, source: "name", confidence: "verified", note: null } }, f12);
  ok(conflict.needsReview && conflict.packageThcMg?.confidence === "conflict" && conflict.packageThcMg.value === 100, "a verified name fact the COA contradicts -> conflict, never overwritten");
  ok(mergeCoaIntoExam({ ...exam, percentMode: true }, f12).percentMode === true, "percent products are never merged");

  // ---- profile ---------------------------------------------------------------
  const p0 = coaProfile(extractFor(0))!;
  ok(p0.kbTerpenes.slice(0, 4).join(",") === "limonene,myrcene,linalool,caryophyllene", `00 KB terpenes strongest first: ${p0.kbTerpenes.join(",")}`);
  ok(p0.kbTerpenes.includes("pinene") && p0.kbTerpenes.filter((t) => t === "pinene").length === 1, "00 alpha+beta pinene -> one pinene");
  ok(!p0.kbTerpenes.includes("selinadiene") && p0.terpenes.some((t) => t.name === "selinadiene"), "00 non-KB terpenes stay on the lab profile only");
  ok(p0.terpenes[0].name === "limonene" && p0.terpenes[0].ppm === 5139 && p0.totalTerpenesPpm !== null, "00 lab profile from the JSON (exact ppm)");
  ok(p0.kbCannabinoids.join(",") === "thc,thca,cbda,cbg", `00 KB cannabinoids: ${p0.kbCannabinoids.join(",")}`);
  const p12 = coaProfile(extractFor(12))!;
  ok(p12.terpenes.length === 0 && p12.kbCannabinoids.join(",") === "thc,cbd,cbg,cbc", `12 edible: no terpenes, cannabinoids ${p12.kbCannabinoids.join(",")}`);
  ok(p12.cannabinoids.find((c) => c.key === "cbg")?.mgPerServing === 10, "12 profile carries mg/serving");
  ok(coaProfile(swapped) === null, "a failed identity yields no profile");
  const u = unionKbList(["Myrcene", "pinene"], ["myrcene", "limonene", "pinene", "linalool"]);
  ok(u.next.join(",") === "Myrcene,pinene,limonene,linalool" && u.added.join(",") === "limonene,linalool", "unionKbList fill-only");
  ok(readStoredCoaExtract(JSON.parse(JSON.stringify(extractFor(12))))?.status === "ok", "a stored extract reads back");
  ok(readStoredCoaExtract({ version: 99 }) === null && readStoredCoaExtract(null) === null && readStoredCoaExtract([]) === null, "foreign json refused");
  // R30: kbTerpeneSlug - Gemini / lab terpene names -> the strain library vocabulary.
  for (const [inp, want] of [
    ["Beta Myrcene", "myrcene"], ["β-caryophyllene", "caryophyllene"], ["b-Caryophyllene", "caryophyllene"],
    ["a-Pinene", "pinene"], ["alpha_pinene", "pinene"], ["d-Limonene", "limonene"], ["Limonene", "limonene"],
    ["trans-Nerolidol", "nerolidol"], ["myrcene", "myrcene"], [" Terpinolene ", "terpinolene"],
  ] as const) ok(kbTerpeneSlug(inp) === want, `kbTerpeneSlug(${inp}) -> ${want}`);
  for (const inp of ["alpha-bulnesene", "b-", "", "   ", "thca", null, 42, undefined]) ok(kbTerpeneSlug(inp) === null, `kbTerpeneSlug(${String(inp)}) -> null`);
  return { passed, failed };
}

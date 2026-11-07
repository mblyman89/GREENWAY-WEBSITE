/**
 * src/lib/inventory/coa-trust-all-core.ts   (D206 - "Re-read every COA and trust it")
 *
 * The owner, verbatim (D202): "we need all coa's regardless if we like them or
 * not to be read AND trusted. we have never, and will never accept illegal
 * products. every coa we have is legitimate and should be treated as such, no
 * exceptions. so I want to have a button that will reread all of them. it
 * should run on the server in the background ... accepting them regardless of
 * how it feels about them."
 *
 * PURE (no I/O). Three parts:
 *
 *   1. readAnyLayout(text, hintIds) - a lenient reader for ANY certificate
 *      layout the strict readers turn down ("This certificate layout is not
 *      one the reader knows yet"):
 *        a. a GrowFlow "QA Results" bundle (one PDF, many products: the
 *           owner's example GF41918900060579) -> the ONE block whose ids name
 *           this lab result or its lots; never a guessed block;
 *        b. any other layout -> every cannabinoid row printed as
 *           "<name> <value>" (THCa / THC-A / Tetrahydrocannabinolic Acid,
 *           "D9 THC-A: 96%", "d9-THC 0.93 9.3", nd / <LOQ ...);
 *        c. nothing readable -> a document with no potency rows (the lab,
 *           ids and the text were still read; nothing is invented).
 *   2. trustExtract(extract, ...) - the owner's policy applied to one read:
 *      a certificate that has a document is ACCEPTED. Its status becomes ok,
 *      every check the system did not like is kept (detail prefixed with
 *      "Accepted (owner trusts every COA)") and marked ok, and the original
 *      verdict is recorded in `trusted`. A row with no document at all stays
 *      as it was: there is nothing to trust.
 *   3. The overnight job's run state (site_settings value) and its words.
 */
import { normalizeCoaText, type CoaPdfDoc, type CoaPotencyRow, type CoaTotalRow } from "./coa-pdf-text-core";
import type { CannabinoidKey } from "./wcia-lab-json-core";
import { looksLikeGrowFlowQaResults, readGrowFlowQaResults, type CoaCertificate } from "./coa-bundle-core";
import { WA_TESTING_LABS } from "./testing-labs-core";
import type { CoaExtract } from "./coa-facts-core";

export const TRUST_POLICY = "D206";
export const TRUST_PREFIX = "Accepted (owner trusts every COA)";
export const TRUST_NOTE =
  "Read by the any-layout reader and accepted under the owner's policy: every COA we hold is legitimate. Numbers are as printed on the certificate.";

// ---------------------------------------------------------------------------
// 1. The any-layout reader
// ---------------------------------------------------------------------------

type Key = CannabinoidKey | CoaTotalRow;

/** Printed names -> canonical key. Matched longest first, whole tokens only. */
const LABELS: [string, Key][] = [
  ["tetrahydrocannabinolic acid", "thca"],
  ["delta 9 tetrahydrocannabinolic acid", "thca"],
  ["d9 thc-a", "thca"],
  ["d9-thca", "thca"],
  ["d9-thc-a", "thca"],
  ["delta 9 thca", "thca"],
  ["delta-9 thca", "thca"],
  ["thc-a", "thca"],
  ["thca", "thca"],
  ["delta 9 tetrahydrocannabinol", "d9-thc"],
  ["delta-9 tetrahydrocannabinol", "d9-thc"],
  ["delta 9 thc", "d9-thc"],
  ["delta-9 thc", "d9-thc"],
  ["d9 thc", "d9-thc"],
  ["d9-thc", "d9-thc"],
  ["Δ9-thc", "d9-thc"],
  ["thc", "d9-thc"],
  ["delta 8 tetrahydrocannabinol", "d8-thc"],
  ["delta 8 thc", "d8-thc"],
  ["d8 thc", "d8-thc"],
  ["d8-thc", "d8-thc"],
  ["cannabidiolic acid", "cbda"],
  ["cbd-a", "cbda"],
  ["cbda", "cbda"],
  ["cannabidiol", "cbd"],
  ["cbd", "cbd"],
  ["cannabigerolic acid", "cbga"],
  ["cbg-a", "cbga"],
  ["cbga", "cbga"],
  ["cannabigerol", "cbg"],
  ["cbg", "cbg"],
  ["cannabinol", "cbn"],
  ["cbn", "cbn"],
  ["cannabichromene", "cbc"],
  ["cbc", "cbc"],
  ["tetrahydrocannabivarin", "thcv"],
  ["thcv", "thcv"],
  ["cannabidivarin", "cbdv"],
  ["cbdv", "cbdv"],
  ["total tested cannabinoids", "total-cannabinoids"],
  ["total cannabinoids", "total-cannabinoids"],
  ["totals", "total-cannabinoids"],
  ["total thc", "total-thc"],
  ["thcmax", "total-thc"],
  ["total cbd", "total-cbd"],
  ["cbdmax", "total-cbd"],
];
const LABEL_TOKENS: { toks: string[]; key: Key; label: string }[] = LABELS.map(([l, key]) => ({ toks: l.split(" "), key, label: l }))
  .sort((a, b) => b.toks.length - a.toks.length || b.label.length - a.label.length);

/** Strip printing marks a label carries: "CBGA*", "THC-A:", "Cannabidiol," */
const cleanTok = (t: string) => t.toLowerCase().replace(/[:;,*^]+$/g, "").replace(/^[*^]+/, "");

type Cell = { kind: "num"; v: number; pctSign: boolean } | { kind: "nd" } | { kind: "nt" } | null;

function readCell(tok: string | undefined, next: string | undefined): { cell: Cell; used: number } {
  if (tok === undefined) return { cell: null, used: 0 };
  const t = tok.toLowerCase().replace(/[,;]$/, "");
  if (t === "<" && next !== undefined) return { cell: { kind: "nd" }, used: 2 };
  if (/^(?:nd|n\.d\.?|<loq|<lod|<mrl|not detected)$/.test(t)) return { cell: { kind: "nd" }, used: 1 };
  if (/^<\d*\.?\d+%?$/.test(t)) return { cell: { kind: "nd" }, used: 1 };
  if (/^(?:nt|n\/a|na|ne)$/.test(t)) return { cell: { kind: "nt" }, used: 1 };
  const m = t.match(/^(\d*\.?\d+)(%?)$/);
  if (m) return { cell: { kind: "num", v: Number(m[1]), pctSign: m[2] === "%" }, used: 1 };
  return { cell: null, used: 0 };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Remove printed formulas: "(D9 THC-A*.877)+D9 THC", nested parentheses. PURE. */
export function stripFormulas(text: string): string {
  let t = text;
  for (let i = 0; i < 6; i++) {
    const n = t.replace(/\([^()]*\)/g, " ");
    if (n === t) break;
    t = n;
  }
  return t.replace(/\s+/g, " ").trim();
}

/** Every "<cannabinoid> <value>" row in any layout. First printing wins. PURE. */
export function readLooseRows(text: string): CoaPotencyRow[] {
  const toks = stripFormulas(normalizeCoaText(text)).split(" ").filter(Boolean);
  const low = toks.map(cleanTok);
  const rows = new Map<Key, CoaPotencyRow>();
  for (let i = 0; i < toks.length; i++) {
    // A label right after a formula sign ("+CBD", "= THCA x") is not a row.
    const prev = i > 0 ? toks[i - 1] : "";
    if (/[+=x→]$/.test(prev) && prev.length <= 2) continue;
    if (/[+=*→]/.test(toks[i].replace(/\*+$/, ""))) continue;
    for (const L of LABEL_TOKENS) {
      if (i + L.toks.length > toks.length) continue;
      let hit = true;
      for (let k = 0; k < L.toks.length; k++) if (low[i + k] !== L.toks[k]) { hit = false; break; }
      if (!hit) continue;
      const at = i + L.toks.length;
      const { cell, used } = readCell(toks[at], toks[at + 1]);
      if (cell && cell.kind !== "nt" && !rows.has(L.key)) {
        if (cell.kind === "nd") {
          rows.set(L.key, { label: toks.slice(i, at).join(" ").replace(/[:*]+$/, ""), key: L.key, pct: 0, mgPerG: 0, mgPerServing: null, mgPerPackage: null, loqPct: null, nd: true });
        } else if (cell.v <= 100) {
          // "THCA 25 250": a second number 10x the first is mg/g.
          const n2 = readCell(toks[at + used], undefined).cell;
          const mg = n2 && n2.kind === "num" && Math.abs(n2.v - cell.v * 10) <= Math.max(0.6, cell.v * 0.11) ? n2.v : round3(cell.v * 10);
          rows.set(L.key, { label: toks.slice(i, at).join(" ").replace(/[:*]+$/, ""), key: L.key, pct: cell.v, mgPerG: mg, mgPerServing: null, mgPerPackage: null, loqPct: null, nd: false });
        }
      }
      if (cell) i = at + used - 1;
      else i = at - 1;
      break;
    }
  }
  return [...rows.values()];
}

/** The WA lab named in the text (known list), else null. PURE. */
export function knownLabIn(text: string): string | null {
  const up = normalizeCoaText(text).toUpperCase();
  let best: { name: string; at: number } | null = null;
  for (const l of WA_TESTING_LABS) {
    const name = l.name.replace(/,?\s*(?:LLC|Inc)\.?$/i, "").trim();
    const at = up.indexOf(name.toUpperCase());
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  return best?.name ?? null;
}

const SAMPLE_ID_RES = [
  /Laboratory Sample #:? ([A-Z0-9][A-Z0-9-]{4,})/i,
  /\bQA #:? ([A-Z0-9][A-Z0-9-]{4,})/i,
  /\b(?:Lab )?Sample ID#?:? ([A-Z0-9][A-Z0-9-]{4,})/i,
  /Certificate of Analysis ID:? (\d{4,})/i,
];

function idsIn(text: string): string[] {
  return [...new Set([...normalizeCoaText(text).matchAll(/\b(GF\d{14}|\d{16,})\b/gi)].map((m) => m[1].toUpperCase()))];
}

function emptyDoc(labName: string, potency: CoaPotencyRow[], meta: { labSampleId: string | null; batchId: string | null; sampleName: string | null }): CoaPdfDoc {
  const pct = (k: Key) => potency.find((r) => r.key === k)?.pct ?? null;
  return {
    template: "generic",
    labName,
    labSampleId: meta.labSampleId,
    batchId: meta.batchId,
    sampleName: meta.sampleName,
    productType: null,
    matrixType: null,
    servingWeightG: null,
    packageWeightG: null,
    batchPass: null,
    auth: null,
    templateVersion: null,
    documentCreated: null,
    potencyDate: null,
    amended: null,
    amendmentText: null,
    potency,
    summary: {
      totalThcPct: pct("total-thc"),
      totalThcMgPerServing: null,
      totalThcMgPerG: potency.find((r) => r.key === "total-thc")?.mgPerG ?? null,
      totalCbdPct: pct("total-cbd"),
      totalCbdMgPerServing: null,
      totalCbdMgPerG: potency.find((r) => r.key === "total-cbd")?.mgPerG ?? null,
      totalCannabinoidsPct: pct("total-cannabinoids"),
    },
    terpenes: [],
    totalTerpenesPpm: null,
    terpeneSummary: { totalPct: null, top: [] },
    potencyReadable: potency.some((r) => r.pct !== null),
    checks: [],
    warnings: [TRUST_NOTE],
  };
}

function certToDoc(c: CoaCertificate): CoaPdfDoc {
  const potency: CoaPotencyRow[] = Object.entries(c.potency).map(([k, v]) => ({
    label: k, key: k as Key, pct: v, mgPerG: round3(v * 10), mgPerServing: null, mgPerPackage: null, loqPct: null, nd: false,
  }));
  return emptyDoc(c.labName ?? "Unrecognised lab", potency, { labSampleId: c.labSampleId, batchId: c.ids.find((x) => x !== c.labSampleId) ?? null, sampleName: c.sampleName });
}

export type AnyLayoutRead = { doc: CoaPdfDoc; how: "bundle-block" | "loose-rows" | "no-potency" | "bundle-no-match" };

const GF_ID = /^GF\d{14}$/i;
const QA_HEADS = new Set(["THC", "THCA", "THCMAX", "CBD", "CBDA", "CBDMAX", "MOISTURE", "STEMS", "OTHER", "ABAC", "Y/M", "COL", "BT", "EC", "RS"]);
const QA_KEY: Record<string, Key> = { THC: "d9-thc", THCA: "thca", THCMAX: "total-thc", CBD: "cbd", CBDA: "cbda", CBDMAX: "total-cbd" };

/**
 * One product's row of a GrowFlow "QA Results" bundle, anchored on its OWN
 * ids: the run of consecutive GF ids that holds a hint id, then only the
 * tokens up to the next GF id. The text order of these PDFs differs by
 * reader (unpdf keeps the rows, pdftotext moves the headers between rows),
 * so a split on the header line could hand one product the next one's
 * numbers; this cannot. Null when no run names a hint, or two do. PURE.
 */
export function readQaRowById(text: string, hints: ReadonlySet<string>): CoaCertificate | null {
  const toks = normalizeCoaText(text).split(" ").filter(Boolean);
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!GF_ID.test(toks[i])) continue;
    let j = i;
    while (j + 1 < toks.length && GF_ID.test(toks[j + 1])) j++;
    runs.push({ start: i, end: j });
    i = j;
  }
  const mine = runs.filter((r) => toks.slice(r.start, r.end + 1).some((t) => hints.has(t.toUpperCase())));
  if (mine.length !== 1) return null;
  const r = mine[0];
  const next = runs.find((x) => x.start > r.end);
  const after = toks.slice(r.end + 1, next ? next.start : toks.length);
  const heads: { name: string; mgPerG: boolean }[] = [];
  const nums: number[] = [];
  for (const t of after) {
    const up = t.toUpperCase();
    if (/^-?\d*\.?\d+$/.test(t)) {
      if (heads.length > 0) nums.push(Number(t));
    } else if (up === "MGG" && heads.length > 0) heads[heads.length - 1].mgPerG = true;
    else if (QA_HEADS.has(up) && nums.length === 0 && !heads.some((h) => h.name === up)) heads.push({ name: up, mgPerG: false });
  }
  const potency: Record<string, number> = {};
  heads.forEach((h, k) => {
    const key = QA_KEY[h.name];
    if (!key || k >= nums.length) return;
    potency[key] = round3(h.mgPerG ? nums[k] / 10 : nums[k]);
  });
  // The strain and lab sit just before the ids: back to the previous number / header word.
  let s = r.start;
  while (s > 0 && r.start - s < 10 && !/^-?\d*\.?\d+$/.test(toks[s - 1]) && !QA_HEADS.has(toks[s - 1].toUpperCase()) && !/^(?:Details|ID#|Lab|Strain)$/i.test(toks[s - 1])) s--;
  const head = toks.slice(s, r.start).join(" ");
  const lab = knownLabIn(head);
  const strain = lab ? head.slice(0, head.toUpperCase().indexOf(lab.toUpperCase())).trim() || null : head || null;
  const ids = [...new Set(toks.slice(r.start, r.end + 1).map((t) => t.toUpperCase()))];
  return {
    key: "coa#1", docLabel: "coa", template: "growflow-qa", labName: lab ?? knownLabIn(text),
    labSampleId: ids[0] ?? null, ids, sampleName: strain, productType: null, passed: null,
    totalThcPct: potency["total-thc"] ?? null, totalCbdPct: potency["total-cbd"] ?? null, totalCannabinoidsPct: null,
    potency, testedOn: null, releasedOn: null, identifiable: true, reason: null,
  };
}

/**
 * Read any certificate layout. `hintIds` = this lab result's own ids (its
 * external identifier, its lots' codes): they pick the one block of a bundle,
 * and are preferred as the printed inventory id. PURE.
 */
export function readAnyLayout(text: string, hintIds: readonly string[]): AnyLayoutRead | null {
  if (typeof text !== "string" || text.trim().length < 40) return null;
  const hints = new Set(hintIds.map((h) => h.trim().toUpperCase()).filter((h) => h.length >= 6));
  if (looksLikeGrowFlowQaResults(text)) {
    const blocks = readGrowFlowQaResults(text, "coa");
    const row = readQaRowById(text, hints);
    if (row && Object.keys(row.potency).length > 0) return { doc: certToDoc(row), how: "bundle-block" };
    if (blocks.length === 1 && hints.size === 0) return { doc: certToDoc(blocks[0]), how: "bundle-block" };
    // A bundle whose blocks do not name this product: never borrow another product's numbers.
    return { doc: emptyDoc(blocks[0]?.labName ?? knownLabIn(text) ?? "Unrecognised lab", [], { labSampleId: null, batchId: null, sampleName: null }), how: "bundle-no-match" };
  }
  const potency = readLooseRows(text);
  const ids = idsIn(text);
  const batchId = ids.find((x) => hints.has(x)) ?? ids[0] ?? null;
  let labSampleId: string | null = null;
  for (const re of SAMPLE_ID_RES) {
    const m = normalizeCoaText(text).match(re);
    if (m) {
      labSampleId = m[1];
      break;
    }
  }
  const nameM = normalizeCoaText(text).match(/\b(?:Sample Name|Product Name|Sample):? (.{2,60}?)(?= Type| Sample| Matrix| Quantity| Inventory| Batch| Lot| Inv #| License|,)/i);
  const doc = emptyDoc(knownLabIn(text) ?? "Unrecognised lab", potency, { labSampleId, batchId, sampleName: nameM ? nameM[1].trim() : null });
  return { doc, how: potency.length > 0 ? "loose-rows" : "no-potency" };
}

/** The best any-layout reading among several texts (most potency rows). PURE. */
export function bestAnyLayout(texts: readonly (string | null)[], hintIds: readonly string[]): AnyLayoutRead | null {
  let best: AnyLayoutRead | null = null;
  for (const t of texts) {
    if (!t) continue;
    const r = readAnyLayout(t, hintIds);
    if (!r) continue;
    if (!best || r.doc.potency.length > best.doc.potency.length) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 2. The owner's policy on one read
// ---------------------------------------------------------------------------

export type TrustMark = {
  policy: typeof TRUST_POLICY;
  at: string;
  /** What the system said before the owner's policy accepted it. */
  originalStatus: CoaExtract["status"];
  originalSummary: string;
  /** How the any-layout reader read it (null = the strict reading stood). */
  reader: AnyLayoutRead["how"] | null;
  overriddenChecks: number;
};

const accept = <T extends { ok: boolean; detail: string }>(c: T): T => (c.ok ? c : { ...c, ok: true, detail: `${TRUST_PREFIX}: ${c.detail}` });

/**
 * The owner's policy: a certificate we hold is legitimate. Returns the read
 * unchanged when it is already ok, or when there is no document at all
 * (no lab JSON, no PDF text - nothing to trust). PURE.
 */
export function trustExtract(ex: CoaExtract, opts: { at: string; reread: AnyLayoutRead | null }): CoaExtract {
  if (ex.status === "ok") return ex;
  const strictPdfGood = ex.pdf !== null && ex.pdf.potencyReadable;
  const usePdf = strictPdfGood ? ex.pdf : opts.reread && (opts.reread.doc.potencyReadable || !ex.pdf) ? opts.reread.doc : ex.pdf;
  const hasDocument = ex.json !== null || usePdf !== null;
  if (!hasDocument) return ex;
  const pdfChecksBad = (usePdf?.checks ?? []).filter((c) => !c.ok).length;
  const overridden = ex.identity.filter((c) => !c.ok).length + ex.agreement.filter((c) => !c.ok).length + pdfChecksBad;
  const pdf = usePdf ? { ...usePdf, checks: usePdf.checks.map(accept) } : null;
  const parts: string[] = [];
  if (ex.json) parts.push(`lab JSON read (${ex.json.cannabinoids.length} cannabinoids)`);
  if (pdf && pdf.potencyReadable) parts.push(`COA PDF read (${pdf.potency.length} potency rows${strictPdfGood ? "" : ", any-layout reader"})`);
  else if (pdf) parts.push("COA PDF read; it prints no potency numbers the reader could find (accepted as it is)");
  if (overridden > 0) parts.push(`${overridden} check(s) the system did not like were accepted`);
  const trusted: TrustMark = {
    policy: TRUST_POLICY,
    at: opts.at,
    originalStatus: ex.status,
    originalSummary: ex.summary,
    reader: strictPdfGood ? null : opts.reread?.how ?? null,
    overriddenChecks: overridden,
  };
  return {
    ...ex,
    pdf,
    pdfError: pdf ? null : ex.pdfError,
    identity: ex.identity.map(accept),
    agreement: ex.agreement.map(accept),
    status: "ok",
    summary: `Trusted (owner policy): ${parts.join(". ")}.`,
    trusted,
  } as CoaExtract;
}

/**
 * The read to keep: the fresh one when the policy accepted it; else the
 * earlier stored read accepted (a link that died since keeps what was read
 * before); else the fresh one as it is. PURE.
 */
export function chooseTrusted(fresh: CoaExtract, stored: CoaExtract | null, at: string): CoaExtract {
  if (fresh.status === "ok") return fresh;
  if (stored) {
    const s = trustExtract(stored, { at, reread: null });
    if (s.status === "ok") return s;
  }
  return fresh;
}

/** The trust mark on a stored read, or null. PURE. */
export function trustMarkOf(ex: unknown): TrustMark | null {
  if (typeof ex !== "object" || ex === null) return null;
  const t = (ex as { trusted?: unknown }).trusted;
  if (typeof t !== "object" || t === null) return null;
  const o = t as Partial<TrustMark>;
  return o.policy === TRUST_POLICY && typeof o.at === "string" ? (o as TrustMark) : null;
}

// ---------------------------------------------------------------------------
// 3. The overnight job
// ---------------------------------------------------------------------------

export const TRUST_RUN_KEY = "coa_trust_all_run";
export const TRUST_RUN_LABEL = "D206: Re-read every COA and trust it (overnight job)";
export const TRUST_AUDIT_START = "coa.trust_all_started";
export const TRUST_AUDIT_STOP = "coa.trust_all_stopped";
export const TRUST_AUDIT_DONE = "coa.trust_all_done";
/** Lab rows scanned per page (rule 15: well under 1000). */
export const TRUST_PAGE = 200;
/** Certificates read at the same time. */
export const TRUST_CONCURRENCY = 4;
/** A batch is only started while this much of the tick is left (LlamaParse can take 90 s). */
export const TRUST_BATCH_RESERVE_MS = 100_000;
/** A lease outlives the cron's maxDuration (300 s). */
export const TRUST_LEASE_MS = 330_000;
export const FREE_LEASE = "free";

export type TrustTotals = { read: number; trusted: number; alreadyOk: number; stillFailed: number; nothingToRead: number; errors: number };
export type TrustRun = {
  version: 1;
  status: "running" | "done" | "stopped";
  startedAt: string;
  startedBy: string | null;
  /** Lab ids are walked in order; the last one handled. "" = from the start. */
  cursor: string;
  /** How many certificates needed reading when the run started. */
  target: number;
  totals: TrustTotals;
  leaseToken: string;
  leaseUntil: string | null;
  lastTickAt: string | null;
  finishedAt: string | null;
  recentErrors: string[];
};

export const emptyTrustTotals = (): TrustTotals => ({ read: 0, trusted: 0, alreadyOk: 0, stillFailed: 0, nothingToRead: 0, errors: 0 });

export function newTrustRun(at: string, by: string | null, target: number): TrustRun {
  return { version: 1, status: "running", startedAt: at, startedBy: by, cursor: "", target, totals: emptyTrustTotals(), leaseToken: FREE_LEASE, leaseUntil: null, lastTickAt: null, finishedAt: null, recentErrors: [] };
}

export function parseTrustRun(v: unknown): TrustRun | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Partial<TrustRun>;
  if (o.version !== 1 || (o.status !== "running" && o.status !== "done" && o.status !== "stopped")) return null;
  if (typeof o.cursor !== "string" || typeof o.leaseToken !== "string" || typeof o.startedAt !== "string") return null;
  return { ...newTrustRun(o.startedAt, o.startedBy ?? null, Number(o.target) || 0), ...o, totals: { ...emptyTrustTotals(), ...(o.totals ?? {}) }, recentErrors: Array.isArray(o.recentErrors) ? o.recentErrors.slice(0, 10) : [] } as TrustRun;
}

/** May this tick take the lease? PURE. */
export function leaseVerdict(run: TrustRun | null, nowMs: number): "idle" | "leased" | "take" {
  if (!run || run.status !== "running") return "idle";
  if (run.leaseToken !== FREE_LEASE && run.leaseUntil && Date.parse(run.leaseUntil) > nowMs) return "leased";
  return "take";
}

/** Does a lab row need the job? Not read yet, failed or partial, and not already trusted. PURE. */
export function needsTrustRead(row: { coa_extract_status: string | null }): boolean {
  return row.coa_extract_status !== "ok";
}

/** Is there anything to read on this row? PURE. */
export function hasCertificateSource(row: { coa_url: string | null; wcia_json_url: string | null; coa_storage_path: string | null }): boolean {
  return Boolean((row.coa_url ?? "").trim() || (row.wcia_json_url ?? "").trim() || (row.coa_storage_path ?? "").trim());
}

/** Fold one certificate's result into the totals. PURE. */
export function addOutcome(t: TrustTotals, outcome: "trusted" | "already-ok" | "still-failed" | "nothing" | "error"): TrustTotals {
  const n = { ...t };
  if (outcome === "nothing") n.nothingToRead += 1;
  else if (outcome === "error") n.errors += 1;
  else {
    n.read += 1;
    if (outcome === "trusted") n.trusted += 1;
    else if (outcome === "already-ok") n.alreadyOk += 1;
    else n.stillFailed += 1;
  }
  return n;
}

/** One line for the Fix later page. PURE. */
export function trustRunLine(run: TrustRun | null, nowMs: number): string {
  if (!run) return "Not run yet. Press the button before bed; the server reads every certificate in the background, a batch every 5 minutes.";
  const t = run.totals;
  const done = t.read + t.nothingToRead + t.errors;
  const bits = [
    `${done} of ${run.target} handled`,
    `${t.trusted} read and trusted`,
    t.alreadyOk ? `${t.alreadyOk} already fine` : null,
    t.stillFailed ? `${t.stillFailed} had no readable document (the link or file is gone - use Fetch or Gmail below)` : null,
    t.nothingToRead ? `${t.nothingToRead} have no certificate link or file at all` : null,
    t.errors ? `${t.errors} errors (they are tried again on the next run)` : null,
  ].filter(Boolean);
  if (run.status === "running") {
    const ago = run.lastTickAt ? Math.max(0, Math.round((nowMs - Date.parse(run.lastTickAt)) / 60000)) : null;
    return `Running since ${run.startedAt.slice(0, 16).replace("T", " ")} UTC: ${bits.join(", ")}.${ago === null ? " The first batch starts within 5 minutes." : ` Last batch ${ago} min ago.`}`;
  }
  if (run.status === "stopped") return `Stopped: ${bits.join(", ")}. Press Start to run it again from the beginning.`;
  return `Done ${run.finishedAt ? run.finishedAt.slice(0, 16).replace("T", " ") + " UTC" : ""}: ${bits.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runCoaTrustAllCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`coa-trust-all-core FAILED: ${msg}`);
    }
  };
  const row = (rows: CoaPotencyRow[], k: Key) => rows.find((r) => r.key === k);

  // Integrity Labs layout (measured: GrowFlow blob, sample 1171729).
  const integrity =
    "Total THC = THCA x .877 + D9 THC Total CBD = CBDA x .877 + CBD LOQ = Level Of Quantification nd = not detected CANNABINOID PROFILE HPLC Cannabinoids LOQ = 0.05% % by weight Cannabinoids Tetrahydrocannabinolic Acid (THCa) 86 Delta 9 Tetrahydrocannabinol (D9 THC) 5.5 Total THC 81 % by weight Cannabidiolic Acid (CBDa) 0.24 Cannabidiol (CBD) nd Total CBD 0.21 % by weight Total i502 81 Cannabinol (CBN) nd Cannabigerol (CBG) 0.43 Cannabigerolic Acid (CBGa) 1.7 Total Tested Cannabinoids 94 % by weight Integrity Labs, LLC External ID: GF42021300034719";
  const ir = readLooseRows(integrity);
  ok(row(ir, "thca")?.pct === 86, "Integrity THCa 86");
  ok(row(ir, "d9-thc")?.pct === 5.5, "Integrity D9 THC 5.5");
  ok(row(ir, "total-thc")?.pct === 81, "Integrity Total THC 81 (the formula line is not a row)");
  ok(row(ir, "cbd")?.nd === true && row(ir, "cbda")?.pct === 0.24, "Integrity CBD nd, CBDa 0.24");
  ok(row(ir, "total-cannabinoids")?.pct === 94 && row(ir, "cbga")?.pct === 1.7, "Integrity totals + CBGa");

  // Treeline layout (formulas in parentheses, "Total THC + CBD").
  const treeline =
    "Cannabinoid Profile HPLC Parameter Result LOQ D9 THC-A: 96% 0.5% D9 THC: 2.6% 0.5% D8 THC: <LOQ 0.5% CBD-A: <LOQ 0.5% CBD: <LOQ 0.5% Total THC: ((D9 THC-A*.877)+D9 THC) 87% 0.5% Total CBD: (CBD-A*.877)+CBD <LOQ 0.5% Total THC + CBD: ((D9 THC-A*.877)+D9 THC)+((CBD- A*.877)+CBD) 87% 0.5% Treeline Analytics Inventory ID: GF41261500041844";
  const tr = readLooseRows(treeline);
  ok(row(tr, "thca")?.pct === 96 && row(tr, "d9-thc")?.pct === 2.6, "Treeline D9 THC-A 96, D9 THC 2.6");
  ok(row(tr, "total-thc")?.pct === 87, "Treeline Total THC 87 behind its formula");
  ok(row(tr, "cbd")?.nd === true && row(tr, "cbda")?.nd === true && row(tr, "d8-thc")?.nd === true, "Treeline <LOQ = not detected");

  // Capitol Analysis layout (% then mg/g, NT = not tested, asterisks).
  const capitol = "Analyte % by Mass Mass (mg/g) CBDVA* NT NT CBDV* NT NT CBDA <0.001 <0.01 CBGA* 0.56 5.6 CBG* <0.001 <0.01 CBD <0.001 <0.01 THCV* NT NT CBN* <0.001 <0.01 d9-THC 0.93 9.3 d8-THC* <0.001 <0.01 THCA 25 250 TOTALS 26 260 Analysis Pass/Fail";
  const cr = readLooseRows(capitol);
  ok(row(cr, "thca")?.pct === 25 && row(cr, "thca")?.mgPerG === 250, "Capitol THCA 25% / 250 mg/g");
  ok(row(cr, "d9-thc")?.pct === 0.93 && row(cr, "cbga")?.pct === 0.56, "Capitol d9-THC 0.93, CBGA* 0.56");
  ok(row(cr, "cbdv") === undefined && row(cr, "thcv") === undefined, "NT (not tested) is not a row");
  ok(row(cr, "total-cannabinoids")?.pct === 26, "Capitol TOTALS 26");

  // The owner's example: GrowFlow QA Results bundle, Cherry OG = GF41918900060579.
  const bundle =
    "Order From: Canna Processing QA Results Strain Lab Sample ID# Parent ID# Child ID# Additional Details Banana Cake MEDICINE CREEK ANALYTICS GF41918900062114 GF41918900062100 GF41918905566988 MED THC THCA THCMax CBD CBDA CBDMax Moisture 5.63 24.94 27.5 .73 0 .73 Strain Lab Sample ID# Parent ID# Child ID# Additional Details Cherry OG MEDICINE CREEK ANALYTICS GF41918900060579 GF41918900060537 GF41918905566981 MED THC THCA THCMax CBD CBDA CBDMax Moisture 5.33 29.83 31.49 0 0 0";
  const b1 = readAnyLayout(bundle, ["GF41918900060579"]);
  ok(b1?.how === "bundle-block" && b1.doc.summary.totalThcPct === 31.49 && b1.doc.labName === "Medicine Creek Analytics", "owner's example: the Cherry OG block, Total THC 31.49");
  const b2 = readAnyLayout(bundle, ["GF41918905566981"]);
  ok(b2?.doc.summary.totalThcPct === 31.49, "the lot's own code (Child ID) picks the same block");
  const b3 = readAnyLayout(bundle, ["GF00000000000000"]);
  ok(b3?.how === "bundle-no-match" && b3.doc.potency.length === 0, "a bundle that does not name this product: no borrowed numbers");
  // pdftotext order (measured on the owner's PDF): the headers drift between rows.
  const drift =
    "QA Results Strain Lab Sample ID# Parent ID# Child ID# Additional Details Cherry OG MEDICINE CREEK ANALYTICS GF41918900060579 GF41918900060537 GF41918905566981 MED Strain Lab THC THCA THCMax CBD CBDA CBDMax 5.33 29.83 31.49 0 0 0 Sample ID# Parent ID# Moisture Stems Child ID# Other ABac Y/M Col BT Additional Details EC RS Drunken Hashplant MEDICINE CREEK ANALYTICS GF41918900062116 GF41918900062104 GF41918905566990 THC THCA THCMax CBD CBDA CBDMax 6.3 24.27 27.58 .85 0 .85 Moisture Stems MED Other Strain Lab Sample ID# Parent ID# Child ID# Additional Details Face Off OG MEDICINE CREEK ANALYTICS GF41918900057846 GF41918900057824 GF41918905566982 MED THC MgG THCA MgG THCMax CBD CBDA CBDMax 47 290 30.13 0 0 0";
  ok(readAnyLayout(drift, ["GF41918900060579"])?.doc.summary.totalThcPct === 31.49, "drifted headers: Cherry OG keeps its own 31.49, never the next row's 27.58");
  const fo = readAnyLayout(drift, ["GF41918905566982"])?.doc;
  ok(fo?.potency.find((p) => p.key === "thca")?.pct === 29 && fo?.potency.find((p) => p.key === "d9-thc")?.pct === 4.7, "MgG columns are divided by 10 (290 mg/g = 29%)");
  ok(readAnyLayout(drift, ["GF41918900062116"])?.doc.sampleName === "Drunken Hashplant", "the strain before the ids is kept");

  // Confidence "CANNABINOIDS NOT EXAMINED": nothing to read, still a document.
  const conf = "Official Test Results for Laboratory Sample # WA-240605-018 Origination: Cannasol Farms Sample Name: RSO - 1:1 CBD Type: EHO Inventory #: GF41224000079034 QA #: WA-240605-018 Cannabinoid Profile CANNABINOIDS NOT EXAMINED Confidence Analytics";
  const c1 = readAnyLayout(conf, ["GF41224000079034"]);
  ok(c1?.how === "no-potency" && c1.doc.labSampleId === "WA-240605-018" && c1.doc.batchId === "GF41224000079034" && c1.doc.labName === "Confidence Analytics", "no potency printed: lab, sample id and inventory id still read");
  ok(readAnyLayout("short", []) === null, "empty text: nothing");
  ok(stripFormulas("Total THC: ((D9 THC-A*.877)+D9 THC) 87%") === "Total THC: 87%", "formulas stripped");

  // trustExtract
  const base = {
    version: 1, jsonUrl: null, coaUrl: "https://x/c.pdf", json: null, jsonError: null, pdf: null,
    pdfError: "This certificate layout is not one the reader knows yet", pdfVia: "llamaparse", identity: [], agreement: [],
    status: "failed", summary: "COA PDF not read.", extractedAt: "2026-11-07T00:00:00Z",
  } as unknown as CoaExtract;
  const t1 = trustExtract(base, { at: "2026-11-08T00:00:00Z", reread: b1 });
  ok(t1.status === "ok" && t1.pdf?.summary.totalThcPct === 31.49 && t1.pdfError === null, "failed + any-layout reading -> ok, numbers kept");
  ok(trustMarkOf(t1)?.originalStatus === "failed" && trustMarkOf(t1)?.reader === "bundle-block", "the original verdict is recorded");
  ok(t1.summary.startsWith("Trusted (owner policy)"), "summary says it is trusted");
  const t2 = trustExtract(base, { at: "x", reread: null });
  ok(t2.status === "failed" && trustMarkOf(t2) === null, "no document at all -> nothing to trust, unchanged");
  const partial = { ...base, status: "partial", json: { cannabinoids: [{ key: "thca", pct: 20 }], terpenes: [], totals: {} }, identity: [{ what: "same COA", ok: false, detail: "JSON coa a; transfer coa b" }] } as unknown as CoaExtract;
  const t3 = trustExtract(partial, { at: "x", reread: c1 });
  ok(t3.status === "ok" && t3.identity.every((c) => c.ok) && t3.identity[0].detail.startsWith(TRUST_PREFIX), "a check the system did not like is accepted and says so");
  ok(trustMarkOf(t3)?.overriddenChecks === 1, "overridden checks counted");
  const okEx = { ...base, status: "ok" } as unknown as CoaExtract;
  ok(trustExtract(okEx, { at: "x", reread: null }) === okEx, "an ok read is untouched");

  // the job
  const run = newTrustRun("2026-11-08T06:00:00Z", "u1", 664);
  ok(leaseVerdict(run, Date.parse("2026-11-08T06:01:00Z")) === "take", "a running job with a free lease is taken");
  ok(leaseVerdict({ ...run, leaseToken: "abc", leaseUntil: "2026-11-08T06:05:00Z" }, Date.parse("2026-11-08T06:01:00Z")) === "leased", "a live lease is respected");
  ok(leaseVerdict({ ...run, leaseToken: "abc", leaseUntil: "2026-11-08T06:05:00Z" }, Date.parse("2026-11-08T06:06:00Z")) === "take", "an expired lease is taken over");
  ok(leaseVerdict({ ...run, status: "done" }, 0) === "idle" && leaseVerdict(null, 0) === "idle", "done / never started -> idle");
  ok(parseTrustRun(JSON.parse(JSON.stringify(run)))?.target === 664 && parseTrustRun({ version: 2 }) === null, "run state round-trips; foreign values refused");
  ok(needsTrustRead({ coa_extract_status: null }) && needsTrustRead({ coa_extract_status: "partial" }) && !needsTrustRead({ coa_extract_status: "ok" }), "unread, failed and partial need the job");
  ok(!hasCertificateSource({ coa_url: " ", wcia_json_url: null, coa_storage_path: null }) && hasCertificateSource({ coa_url: null, wcia_json_url: null, coa_storage_path: "a/a.pdf" }), "a row with no link or file has nothing to read");
  let tt = emptyTrustTotals();
  tt = addOutcome(addOutcome(addOutcome(tt, "trusted"), "nothing"), "error");
  ok(tt.read === 1 && tt.trusted === 1 && tt.nothingToRead === 1 && tt.errors === 1, "totals fold");
  ok(trustRunLine({ ...run, totals: tt }, Date.parse("2026-11-08T06:01:00Z")).includes("3 of 664 handled"), "page line counts progress");
  ok(trustRunLine(null, 0).includes("before bed"), "never run: tells the owner what it does");
  return { passed, failed };
}

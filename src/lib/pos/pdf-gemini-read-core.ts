/**
 * D247 (A) (owner: "yes lets have gemini batch read these pdfs ... I want this feature to be something
 * that I run from the back office, and runs on the server so it doesn't prevent me from continuing my
 * work. I want this to help with the merge vendor logic.")
 *
 * PURE half of the background Gemini reader for the vendor PDFs the layout readers could not parse
 * (cultivera_mail_docs status "unreadable", kind "pdf": 8,663 on 2026-11-16, almost all invoices).
 * Gemini reads the PDF itself (inlineData application/pdf) and returns only what is PRINTED: the
 * sender's name, 6-digit WA license, UBI, document type, invoice / manifest number and the package
 * barcodes. Those land on the same row (vendor_label, vendor_license, barcodes; the rest in the note),
 * and the vendor ledger (D246) then reads them like any parsed manifest, so "which license sent
 * which lot" and "these cards are one business" get the invoices' evidence too.
 *
 * NEVER-GUESS: a license must be exactly 6 digits and not ours (413541); a UBI 9+ digits; a barcode
 * 10-24 digits/letters; anything else is dropped. The row keeps status "unreadable" (it has no product
 * lines) and the note says "Gemini read" so it is never read twice and every value's source is plain.
 *
 * State (one site_settings row, CAS on updated_at, lease token) follows cultivera-mail-read-bg-core.
 */

export const PDF_READ_KEY = "pdf_gemini_read_bg";
export const PDF_READ_LABEL = "Vendor PDFs: Gemini reads the sender off unreadable invoices in the background (D247)";
export const PDF_READ_AUDIT = { armed: "vendor_pdf_read.armed", paused: "vendor_pdf_read.paused", ran: "vendor_pdf_read.ran" } as const;
/** The note prefix that marks a row as read (selection skips it). */
export const PDF_READ_NOTE_PREFIX = "Gemini read";
export const PDF_READ_MODEL_ENV = "AI_PDF_READ_MODEL";
/** Cheap, fast, reads PDFs natively; the owner can pin another Gemini id in AI_PDF_READ_MODEL. */
export const PDF_READ_DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const OUR_LICENSE = "413541";
/** Inline request bodies are limited (~20 MB); base64 adds a third, so 14 MB of PDF is the most we send. */
export const PDF_READ_MAX_BYTES = 14_000_000;
export const PDF_READ_CONCURRENCY = 4;
/** One run from the button (after the response) and one from the every-minute worker. */
export const PDF_READ_PRESS_BUDGET_MS = 200_000;
export const PDF_READ_CRON_BUDGET_MS = 300_000;
/** A document started at the end of the budget: one Gemini call (120 s timeout) + download + write. */
export const PDF_READ_LEASE_SLACK_MS = 160_000;
export const PDF_READ_PAGE = 40;
export const PDF_READ_MAX_FAILED_RUNS = 3;

export type PdfReadState = {
  v: 1;
  generation: number;
  armed: boolean;
  armedAt: string | null;
  armedBy: string | null;
  paused: boolean;
  pausedBy: "person" | "failures" | null;
  done: boolean;
  runs: number;
  read: number;
  found: number;
  nothing: number;
  tooBig: number;
  failed: number;
  failedRuns: number;
  lastError: string | null;
  left: number | null;
  lastRunAt: string | null;
  lastNote: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
};

export function emptyPdfRead(): PdfReadState {
  return { v: 1, generation: 0, armed: false, armedAt: null, armedBy: null, paused: false, pausedBy: null, done: false, runs: 0, read: 0, found: 0, nothing: 0, tooBig: 0, failed: 0, failedRuns: 0, lastError: null, left: null, lastRunAt: null, lastNote: null, leaseToken: null, leaseUntil: null };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function parsePdfRead(raw: unknown): PdfReadState {
  const e = emptyPdfRead();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e;
  const r = raw as Record<string, unknown>;
  return {
    v: 1,
    generation: nat(r.generation),
    armed: r.armed === true,
    armedAt: str(r.armedAt),
    armedBy: str(r.armedBy),
    paused: r.paused === true,
    pausedBy: r.pausedBy === "person" || r.pausedBy === "failures" ? r.pausedBy : null,
    done: r.done === true,
    runs: nat(r.runs),
    read: nat(r.read),
    found: nat(r.found),
    nothing: nat(r.nothing),
    tooBig: nat(r.tooBig),
    failed: nat(r.failed),
    failedRuns: nat(r.failedRuns),
    lastError: str(r.lastError),
    left: typeof r.left === "number" && Number.isFinite(r.left) && r.left >= 0 ? Math.floor(r.left) : null,
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
  };
}

export function armPdfRead(s: PdfReadState, actorId: string | null, nowIso: string): PdfReadState {
  return { ...s, generation: s.generation + 1, armed: true, armedAt: nowIso, armedBy: actorId, paused: false, pausedBy: null, done: false, read: 0, found: 0, nothing: 0, tooBig: 0, failed: 0, failedRuns: 0, lastError: null };
}

export function pausePdfRead(s: PdfReadState): PdfReadState {
  return { ...s, generation: s.generation + 1, paused: true, pausedBy: "person" };
}

export type PdfReadDecision = "idle" | "paused" | "finished" | "leased" | "go";

export function pdfReadLeaseLive(s: Pick<PdfReadState, "leaseToken" | "leaseUntil">, nowMs: number): boolean {
  if (!s.leaseToken || !s.leaseUntil) return false;
  const until = Date.parse(s.leaseUntil);
  return Number.isFinite(until) && until > nowMs;
}

export function pdfReadDecision(s: PdfReadState, nowMs: number): PdfReadDecision {
  if (!s.armed) return "idle";
  if (s.paused) return "paused";
  if (s.done) return "finished";
  if (pdfReadLeaseLive(s, nowMs)) return "leased";
  return "go";
}

export function takePdfReadLease(s: PdfReadState, token: string, nowMs: number, budgetMs: number): PdfReadState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + budgetMs + PDF_READ_LEASE_SLACK_MS).toISOString() };
}

export function releasePdfReadLease(s: PdfReadState, token: string): PdfReadState {
  return s.leaseToken === token ? { ...s, leaseToken: null, leaseUntil: null } : s;
}

export function ownsPdfRead(s: PdfReadState, token: string, generation: number): boolean {
  return s.leaseToken === token && s.generation === generation && !s.paused;
}

export type PdfReadRun = { read: number; found: number; nothing: number; tooBig: number; failed: number; left: number; stoppedBecause: string | null; serviceDown: boolean };

/** Add a run to the pass. A run that read nothing because the service failed counts toward the self-pause. */
export function recordPdfReadRun(s: PdfReadState, run: PdfReadRun, nowIso: string, note: string): PdfReadState {
  const badRun = run.serviceDown && run.found + run.nothing === 0;
  const failedRuns = badRun ? s.failedRuns + 1 : 0;
  const selfPause = failedRuns >= PDF_READ_MAX_FAILED_RUNS;
  return {
    ...s,
    runs: s.runs + 1,
    read: s.read + run.read,
    found: s.found + run.found,
    nothing: s.nothing + run.nothing,
    tooBig: s.tooBig + run.tooBig,
    failed: s.failed + run.failed,
    failedRuns,
    lastError: run.stoppedBecause ?? (badRun ? s.lastError : null),
    left: run.left,
    done: run.left === 0 && !run.serviceDown,
    paused: selfPause ? true : s.paused,
    pausedBy: selfPause ? "failures" : s.pausedBy,
    generation: selfPause ? s.generation + 1 : s.generation,
    lastRunAt: nowIso,
    lastNote: note,
  };
}

export function pdfReadRunNote(r: PdfReadRun): string {
  const parts = [`Read ${r.read} PDF${r.read === 1 ? "" : "s"}: ${r.found} with a sender license, ${r.nothing} without`];
  if (r.tooBig) parts.push(`${r.tooBig} too large to send`);
  if (r.failed) parts.push(`${r.failed} could not be read (reason in the note)`);
  let s = parts.join(", ") + `. ${r.left} waiting.`;
  if (r.stoppedBecause) s += ` Stopped: ${r.stoppedBecause}`;
  return s;
}

export type PdfReadTone = "ok" | "busy" | "warn";

export function pdfReadStatus(s: PdfReadState, waiting: number | null, nowMs: number): { tone: PdfReadTone; text: string; running: boolean; canStart: boolean; canPause: boolean } {
  const running = pdfReadLeaseLive(s, nowMs);
  const w = waiting ?? s.left;
  const tally = `${s.read} read this pass (${s.found} with a sender license${s.tooBig ? `, ${s.tooBig} too large` : ""}${s.failed ? `, ${s.failed} failed` : ""})`;
  if (!s.armed) return { tone: "ok", text: w === null ? "Not started." : `Not started. ${w} unreadable vendor PDF${w === 1 ? "" : "s"} waiting.`, running, canStart: true, canPause: false };
  if (s.paused) {
    const why = s.pausedBy === "failures" ? ` Paused by itself after ${PDF_READ_MAX_FAILED_RUNS} failed runs in a row: ${s.lastError ?? "the reader failed"}.` : " Paused.";
    return { tone: s.pausedBy === "failures" ? "warn" : "ok", text: `${tally}.${why}${w !== null ? ` ${w} waiting.` : ""}`, running, canStart: true, canPause: false };
  }
  if (s.done) return { tone: "ok", text: `Finished: ${tally}.`, running, canStart: true, canPause: false };
  return { tone: "busy", text: `${running ? "Reading now" : "Queued (runs every minute when the server is free)"}: ${tally}.${w !== null ? ` ${w} waiting.` : ""}`, running, canStart: false, canPause: true };
}

// ---------------------------------------------------------------------------
// What Gemini is asked, and how its answer is cleaned.
// ---------------------------------------------------------------------------

export const PDF_READ_PROMPT = [
  "You are reading a document a Washington State cannabis supplier emailed to the retailer Greenway Marijuana (license 413541).",
  "Copy ONLY what is printed. Never infer, never complete a partial number, never use the retailer's own details as the sender.",
  "sender_name: the business that SENT / SOLD (the vendor, producer or processor), exactly as printed; empty if not printed.",
  "sender_license: the sender's 6-digit WA cannabis license number exactly as printed; empty if not printed. Never 413541.",
  "sender_ubi: the sender's UBI number as printed; empty if not printed.",
  "document_type: one of invoice, manifest, credit_memo, statement, coa, other.",
  "document_number: the invoice or manifest number as printed; empty if none.",
  "document_date: the document date as YYYY-MM-DD if printed; empty if not.",
  "barcodes: every package / lot / inventory id printed on the document (the long numeric or alphanumeric ids, often 16 digits), copied exactly; empty list if none.",
].join("\n");

/** Gemini responseSchema (OpenAPI subset). */
export const PDF_READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    sender_name: { type: "STRING" },
    sender_license: { type: "STRING" },
    sender_ubi: { type: "STRING" },
    document_type: { type: "STRING", enum: ["invoice", "manifest", "credit_memo", "statement", "coa", "other"] },
    document_number: { type: "STRING" },
    document_date: { type: "STRING" },
    barcodes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sender_name", "sender_license", "document_type", "barcodes"],
} as const;

export function buildPdfReadRequest(pdfBase64: string): Record<string, unknown> {
  return {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: pdfBase64 } }, { text: PDF_READ_PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: PDF_READ_SCHEMA, maxOutputTokens: 8192, temperature: 0 },
  };
}

export type PdfReadFacts = {
  senderName: string | null;
  license: string | null;
  ubi: string | null;
  docType: string | null;
  docNumber: string | null;
  docDate: string | null;
  barcodes: string[];
};

const DOC_TYPES = new Set(["invoice", "manifest", "credit_memo", "statement", "coa", "other"]);

/** Clean the model's JSON. Anything not in the expected printed shape is dropped (never repaired). */
export function cleanPdfReadAnswer(raw: unknown): PdfReadFacts {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = (v: unknown, max: number) => {
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return t && t.length <= max ? t : null;
  };
  const lic = s(r.sender_license, 20)?.replace(/[\s-]/g, "") ?? null;
  const license = lic && /^\d{6}$/.test(lic) && lic !== OUR_LICENSE ? lic : null;
  const ubiDigits = (s(r.sender_ubi, 30) ?? "").replace(/[\s.-]/g, "");
  const ubi = /^\d{9,16}$/.test(ubiDigits) ? ubiDigits : null;
  let name = s(r.sender_name, 120);
  if (name && /greenway/i.test(name)) name = null;
  const dt = s(r.document_type, 20)?.toLowerCase() ?? null;
  const date = s(r.document_date, 10);
  const barcodes: string[] = [];
  for (const b of Array.isArray(r.barcodes) ? r.barcodes : []) {
    const t = typeof b === "string" ? b.replace(/\s+/g, "").trim() : "";
    if (/^[A-Za-z0-9]{10,24}$/.test(t) && /\d{6,}/.test(t) && !barcodes.includes(t)) barcodes.push(t);
    if (barcodes.length >= 500) break;
  }
  return {
    senderName: name,
    license,
    ubi,
    docType: dt && DOC_TYPES.has(dt) ? dt : null,
    docNumber: s(r.document_number, 60),
    docDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    barcodes,
  };
}

/** The row update: printed facts into the ledger's columns; the note says where they came from. */
export function pdfReadRowPatch(f: PdfReadFacts, oldNote: string | null, model: string, todayIso: string): { vendor_label: string | null; vendor_license: string | null; barcodes: string[] | null; note: string } {
  const bits = [
    f.docType ? f.docType.replace("_", " ") : "document",
    f.docNumber ? `no. ${f.docNumber}` : null,
    f.docDate ? `dated ${f.docDate}` : null,
    f.senderName ? `from ${f.senderName}` : "sender name not printed",
    f.license ? `license ${f.license}` : "no sender license printed",
    f.ubi ? `UBI ${f.ubi}` : null,
    f.barcodes.length ? `${f.barcodes.length} package id${f.barcodes.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const prev = (oldNote ?? "").trim();
  return {
    vendor_label: f.senderName,
    vendor_license: f.license,
    barcodes: f.barcodes.length ? f.barcodes : null,
    note: `${PDF_READ_NOTE_PREFIX} ${todayIso} (${model}): ${bits.join(", ")}.${prev ? ` | ${prev.slice(0, 400)}` : ""}`,
  };
}

/** The Gemini model to use (a pinned Gemini id wins). */
export function pdfReadModel(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim().replace(/^models\//, "") : "";
  return /^gemini-[a-z0-9.-]+$/i.test(t) ? t : PDF_READ_DEFAULT_MODEL;
}

export function __runPdfGeminiReadCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("pdf-gemini-read-core FAIL:", m);
    }
  };
  const T = Date.parse("2026-11-16T03:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  ok(PDF_READ_CRON_BUDGET_MS + PDF_READ_LEASE_SLACK_MS < 780_000, "cron run fits the 800 s route");
  ok(PDF_READ_LEASE_SLACK_MS > 120_000, "slack covers one Gemini call timeout");
  ok(Math.ceil((PDF_READ_MAX_BYTES * 4) / 3) < 20_000_000, "base64 under the inline limit");

  const e = parsePdfRead(null);
  ok(!e.armed && e.left === null, "missing row = idle");
  ok(parsePdfRead({ armed: "true" }).armed === false && parsePdfRead([1]).armed === false, "junk = idle");
  const a = armPdfRead({ ...emptyPdfRead(), read: 5, done: true, paused: true, pausedBy: "failures", leaseToken: "L", leaseUntil: iso(T + 1000) }, "u1", iso(T));
  ok(a.armed && !a.paused && !a.done && a.read === 0 && a.generation === 1 && a.leaseToken === "L", "arm resets, keeps lease");
  ok(pdfReadDecision(emptyPdfRead(), T) === "idle" && pdfReadDecision(a, T) === "leased" && pdfReadDecision(a, T + 1001) === "go", "decisions");
  const p = pausePdfRead(a);
  ok(p.paused && p.generation === 2 && pdfReadDecision(p, T + 5000) === "paused", "pause");
  ok(pdfReadDecision({ ...a, done: true, leaseToken: null }, T) === "finished", "finished");
  const l = takePdfReadLease(a, "tok", T, 1000);
  ok(Date.parse(l.leaseUntil!) === T + 1000 + PDF_READ_LEASE_SLACK_MS && ownsPdfRead(l, "tok", 1) && !ownsPdfRead(l, "x", 1) && !ownsPdfRead(l, "tok", 2), "lease + own");
  ok(releasePdfReadLease(l, "x").leaseToken === "tok" && releasePdfReadLease(l, "tok").leaseToken === null, "release only own");

  const run = (o: Partial<PdfReadRun> = {}): PdfReadRun => ({ read: 10, found: 7, nothing: 3, tooBig: 0, failed: 0, left: 5, stoppedBecause: null, serviceDown: false, ...o });
  let s = recordPdfReadRun(a, run(), iso(T), "n");
  ok(s.read === 10 && s.found === 7 && s.left === 5 && !s.done && s.runs === 1, "record");
  s = recordPdfReadRun(s, run({ left: 0 }), iso(T), "n");
  ok(s.done && s.read === 20, "done at zero left");
  let f = a;
  for (let i = 0; i < PDF_READ_MAX_FAILED_RUNS; i += 1) f = recordPdfReadRun(f, run({ read: 2, found: 0, nothing: 0, failed: 2, serviceDown: true, stoppedBecause: "Gemini 503" }), iso(T), "n");
  ok(f.paused && f.pausedBy === "failures" && f.generation === a.generation + 1 && !f.done, "self-pause after failed runs");
  ok(recordPdfReadRun({ ...a, failedRuns: 2 }, run(), iso(T), "n").failedRuns === 0, "good run resets");
  ok(!recordPdfReadRun(a, run({ left: 0, serviceDown: true, found: 1 }), iso(T), "n").done, "never done on an outage");

  ok(pdfReadRunNote(run({ tooBig: 1, failed: 2 })) === "Read 10 PDFs: 7 with a sender license, 3 without, 1 too large to send, 2 could not be read (reason in the note). 5 waiting.", "note");
  ok(pdfReadStatus(emptyPdfRead(), 8663, T).text === "Not started. 8663 unreadable vendor PDFs waiting." && pdfReadStatus(emptyPdfRead(), 8663, T).canStart, "status idle");
  ok(pdfReadStatus(l, 100, T).tone === "busy" && pdfReadStatus(l, 100, T).running && pdfReadStatus(l, 100, T).canPause, "status busy");
  ok(pdfReadStatus(f, 9, T).tone === "warn" && pdfReadStatus(f, 9, T).text.includes("Gemini 503"), "status self-paused");

  // cleaning
  const c = cleanPdfReadAnswer({ sender_name: " Sticky  Frog LLC ", sender_license: "412-345", sender_ubi: "603.123.456 001 0001", document_type: "Invoice", document_number: "INV-77", document_date: "2026-10-02", barcodes: ["1234567890123456", "1234567890123456", "abc", "GF41918905566988", " 9876 5432 1098 7654 "] });
  ok(c.senderName === "Sticky Frog LLC" && c.license === "412345" && c.ubi === "6031234560010001" && c.docType === "invoice" && c.docNumber === "INV-77" && c.docDate === "2026-10-02", "clean fields");
  ok(c.barcodes.join() === "1234567890123456,GF41918905566988,9876543210987654", "barcodes dedupe/validate");
  ok(cleanPdfReadAnswer({ sender_license: "413541" }).license === null, "never our license");
  ok(cleanPdfReadAnswer({ sender_license: "41234" }).license === null && cleanPdfReadAnswer({ sender_license: "4123456" }).license === null, "exactly 6 digits");
  ok(cleanPdfReadAnswer({ sender_name: "Greenway Marijuana" }).senderName === null, "never our name");
  ok(cleanPdfReadAnswer({ document_type: "receipt", document_date: "10/2/2026" }).docType === null && cleanPdfReadAnswer({ document_date: "10/2/2026" }).docDate === null, "closed doc type / iso date");
  ok(cleanPdfReadAnswer(null).barcodes.length === 0 && cleanPdfReadAnswer("x").license === null, "junk answer");

  const patch = pdfReadRowPatch(c, "read by LlamaParse; not a manifest", "gemini-3.5-flash-lite", "2026-11-16");
  ok(patch.vendor_license === "412345" && patch.vendor_label === "Sticky Frog LLC" && patch.barcodes?.length === 3, "patch columns");
  ok(patch.note.startsWith("Gemini read 2026-11-16 (gemini-3.5-flash-lite): invoice, no. INV-77, dated 2026-10-02, from Sticky Frog LLC, license 412345, UBI") && patch.note.endsWith("| read by LlamaParse; not a manifest"), "patch note keeps the old note");
  const none = pdfReadRowPatch(cleanPdfReadAnswer({}), null, "m", "2026-11-16");
  ok(none.vendor_license === null && none.barcodes === null && none.note === "Gemini read 2026-11-16 (m): document, sender name not printed, no sender license printed.", "nothing printed");

  const req = buildPdfReadRequest("QUJD") as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
  ok((req.contents[0]!.parts[0]!.inlineData as { mimeType: string }).mimeType === "application/pdf" && req.generationConfig.responseMimeType === "application/json", "request shape");
  ok(pdfReadModel(undefined) === PDF_READ_DEFAULT_MODEL && pdfReadModel("models/gemini-3.8-flash") === "gemini-3.8-flash" && pdfReadModel("gpt-4o") === PDF_READ_DEFAULT_MODEL, "model");
  return { passed, failed };
}

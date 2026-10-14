/**
 * src/lib/inventory/coa-archive-backfill-core.ts   (R50 S13)
 *
 * "Keep a copy of EVERY lab certificate (COA PDF) we know about" in one click.
 *
 * Owner: "Cultivera stores the JSON, not the COA, but the COA is embedded in
 * the JSON, so we can still get them all using the jsons we fetch."
 *
 * Verified on the stored files (tests/fixtures/coa/transfer.json and the
 * Cultivera WCIA files): each transfer line carries `lab_result_data.coa`, the
 * lab's own PDF link (e.g. https://certs.conflabs.com/full/WA-...pdf), plus the
 * full potency. The vendor-lab-results attach (R50 S3b / S12b) already saves
 * that link on the lab_results row as `coa_url`. This backfill downloads each
 * linked PDF ONCE into the private `coa` storage bucket (the same bucket and
 * path delivery intake has always used, POS Slice 9) so the certificate stays
 * on hand even if the lab's link dies - LCB can ask to see it.
 *
 * Same proven shape as S12b: keyset by lab_results.id, resumable checkpoint,
 * time-boxed per click, idempotent (a row that already has a stored copy is
 * never fetched again, and the write is a compare-and-set on an EMPTY
 * coa_storage_path).
 *
 * Stricter than the per-delivery archive, on purpose (bulk + unattended):
 *   - only https links; never a private/loopback host (no SSRF);
 *   - the bytes must really be a PDF (`%PDF-` in the first 1 KB) - an HTML
 *     "not found" page is never stored as a certificate;
 *   - 25 MB cap, same as delivery intake.
 *
 * Pure: URL checks, PDF sniff, storage path, totals, the page sentence.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COA_BACKFILL_PAGE = 40;
/** Certificates downloaded at the same time (polite to the labs' servers). */
export const COA_BACKFILL_PARALLEL = 4;
export const COA_BACKFILL_BUDGET_MS = 200_000;
/** One download may take up to the fetch timeout + upload; never start a batch with less left. */
export const COA_BACKFILL_FETCH_TIMEOUT_MS = 20_000;
export const COA_BACKFILL_MIN_LEFT_MS = 30_000;
export const COA_BACKFILL_MAX_BYTES = 25 * 1024 * 1024;
export const COA_BACKFILL_AUDIT = "lab.coa_archive_backfill_run";
export const COA_BUCKET = "coa";
export const COA_BACKFILL_MAX_PROBLEMS = 5;

export const COA_BACKFILL_HELP =
  "Downloads each lab certificate (PDF) linked in the vendors' transfer files and keeps a private copy, so it stays on hand " +
  "even if the lab's link stops working. It only adds the copy - never changes a lab result, a lot, stock, price or the menu - and is safe to run again.";

export function parseCoaCursor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

export function coaCanStartNext(elapsedMs: number, budgetMs: number = COA_BACKFILL_BUDGET_MS): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return budgetMs - elapsedMs >= COA_BACKFILL_MIN_LEFT_MS;
}

/** The same "doubled host" repair delivery intake uses (files.cultivera.com/https://...). */
function undouble(s: string): string {
  const m = s.match(/^(https?:\/\/[^/]+\/)(https?:\/\/.+)$/i);
  return m ? m[2] : s;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./];

/** True for hosts we must never fetch from a server (loopback, private, link-local, internal names). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return PRIVATE_V4.some((re) => re.test(h));
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  if (!h.includes(".")) return true; // single-label names resolve inside a network
  return false;
}

export type CoaUrlCheck = { ok: true; url: string } | { ok: false; reason: "blank" | "malformed" | "not-https" | "private-host" };

/** Decide whether a stored coa_url may be downloaded, and the exact URL to fetch. */
export function checkCoaUrl(raw: unknown): CoaUrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "blank" };
  let u: URL;
  try {
    u = new URL(undouble(raw.trim()));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not-https" };
  if (u.username || u.password) return { ok: false, reason: "malformed" };
  if (isPrivateHost(u.hostname)) return { ok: false, reason: "private-host" };
  return { ok: true, url: u.toString() };
}

/** A real PDF has `%PDF-` within its first 1024 bytes (ISO 32000-1 §7.5.2 tolerance). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < n; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80);
}

/** `<labId>/<lab test id or labId>.pdf` - byte-for-byte the path delivery intake writes. */
export function coaStoragePath(labId: string, externalId: string | null): string {
  return `${labId}/${safeName(externalId || labId)}.pdf`;
}

export type CoaOutcome = "archived" | "bad-link" | "fetch-failed" | "not-pdf" | "too-big" | "upload-failed" | "changed";

export type CoaBackfillTotals = {
  checked: number;
  outcomes: Record<CoaOutcome, number>;
  bytes: number;
  problems: string[];
};

export function emptyCoaTotals(): CoaBackfillTotals {
  return {
    checked: 0,
    outcomes: { archived: 0, "bad-link": 0, "fetch-failed": 0, "not-pdf": 0, "too-big": 0, "upload-failed": 0, changed: 0 },
    bytes: 0,
    problems: [],
  };
}

export function addCoaOutcome(t: CoaBackfillTotals, label: string, outcome: CoaOutcome, detail: string | null, bytes = 0): CoaBackfillTotals {
  const out: CoaBackfillTotals = { ...t, outcomes: { ...t.outcomes }, problems: [...t.problems] };
  out.checked += 1;
  out.outcomes[outcome] += 1;
  if (outcome === "archived" && bytes > 0) out.bytes += bytes;
  if (outcome !== "archived" && outcome !== "changed" && out.problems.length < COA_BACKFILL_MAX_PROBLEMS) {
    out.problems.push(`${label}: ${outcome}${detail ? ` (${detail})` : ""}`.slice(0, 200));
  }
  return out;
}

export type CoaBackfillRun =
  | { ok: true; done: boolean; next: string | null; totals: CoaBackfillTotals; elapsedMs: number }
  | { ok: false; error: string; next: string | null; totals: CoaBackfillTotals };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function coaBackfillNote(run: CoaBackfillRun): string {
  const t = run.totals;
  const o = t.outcomes;
  const mb = t.bytes > 0 ? ` (${(t.bytes / (1024 * 1024)).toFixed(1)} MB)` : "";
  const failed = o["fetch-failed"] + o["upload-failed"];
  const lines = [
    `${plural(t.checked, "certificate")} checked`,
    `${o.archived} saved${mb}`,
    o["bad-link"] > 0 ? `${o["bad-link"]} with an unusable link` : "",
    failed > 0 ? `${failed} could not be downloaded or saved (will be retried next run)` : "",
    o["not-pdf"] > 0 ? `${o["not-pdf"]} link(s) did not return a PDF` : "",
    o["too-big"] > 0 ? `${o["too-big"]} over 25 MB` : "",
    o.changed > 0 ? `${o.changed} saved by someone else meanwhile` : "",
  ].filter(Boolean);
  const probs = t.problems.length > 0 ? ` Problems: ${t.problems.slice(0, 3).join("; ")}.` : "";
  if (!run.ok) return `Stopped: ${run.error}. So far: ${lines.join(", ")}.${probs} Press Continue to resume.`;
  const head = run.done ? "Done - every linked certificate has been checked" : "Paused at the time limit";
  const tail = run.done ? "" : " Press Continue to carry on from where it stopped.";
  return `${head}: ${lines.join(", ")}.${probs}${tail}`;
}

export function coaBackfillTone(run: CoaBackfillRun): "ok" | "info" | "warn" {
  if (!run.ok) return "warn";
  const o = run.totals.outcomes;
  if (o["fetch-failed"] + o["upload-failed"] + o["not-pdf"] + o["too-big"] + o["bad-link"] > 0) return "warn";
  return run.done ? "ok" : "info";
}

// --- self-tests --------------------------------------------------------------------

export function __runCoaArchiveBackfillCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-archive-backfill-core: " + m);
    passed += 1;
  };
  const U = "0F8FAD5B-D9CB-469F-A165-70867728950E";
  ok(parseCoaCursor(U) === U.toLowerCase(), "cursor lower-cased");
  ok(parseCoaCursor(` ${U} `) === U.toLowerCase(), "cursor trimmed");
  ok(parseCoaCursor("x' or 1=1") === null && parseCoaCursor(5) === null && parseCoaCursor(`${U}0`) === null, "unsafe cursor refused");

  ok(coaCanStartNext(0) && coaCanStartNext(COA_BACKFILL_BUDGET_MS - COA_BACKFILL_MIN_LEFT_MS), "time left = start");
  ok(!coaCanStartNext(COA_BACKFILL_BUDGET_MS - COA_BACKFILL_MIN_LEFT_MS + 1), "too little left = stop");
  ok(!coaCanStartNext(-1) && !coaCanStartNext(Number.NaN), "bad clock = stop");
  ok(COA_BACKFILL_MIN_LEFT_MS > COA_BACKFILL_FETCH_TIMEOUT_MS, "a started batch always fits before the budget");

  // URL checks (real fixture links).
  const real = checkCoaUrl("https://certs.conflabs.com/full/WA-75Gf8fFPPAcx-WA-260902-019.pdf");
  ok(real.ok && real.url === "https://certs.conflabs.com/full/WA-75Gf8fFPPAcx-WA-260902-019.pdf", "real lab link accepted");
  const dbl = checkCoaUrl("https://files.cultivera.com/https://certs.conflabs.com/full/A.pdf");
  ok(dbl.ok && dbl.url === "https://certs.conflabs.com/full/A.pdf", "doubled host repaired");
  ok(!checkCoaUrl("").ok && (checkCoaUrl(null) as { reason: string }).reason === "blank", "blank link");
  ok((checkCoaUrl("not a url") as { reason: string }).reason === "malformed", "malformed link");
  ok((checkCoaUrl("http://certs.conflabs.com/a.pdf") as { reason: string }).reason === "not-https", "plain http refused");
  ok((checkCoaUrl("ftp://x.com/a.pdf") as { reason: string }).reason === "not-https", "ftp refused");
  ok((checkCoaUrl("https://user:pw@x.com/a.pdf") as { reason: string }).reason === "malformed", "credentials in link refused");
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "172.16.0.1", "172.31.255.1", "169.254.169.254", "100.64.0.1", "[::1]", "metadata.google.internal", "printer.local", "intranet"]) {
    ok((checkCoaUrl(`https://${h}/a.pdf`) as { reason: string }).reason === "private-host", `private host refused: ${h}`);
  }
  for (const h of ["172.15.0.1", "172.32.0.1", "8.8.8.8", "gglabs-j.github.io"]) {
    ok(checkCoaUrl(`https://${h}/a.pdf`).ok, `public host allowed: ${h}`);
  }

  // PDF sniff.
  const enc = (s: string) => new TextEncoder().encode(s);
  ok(looksLikePdf(enc("%PDF-1.7\n...")), "pdf header");
  ok(looksLikePdf(enc("\n\r junk %PDF-1.4")), "pdf header after leading junk");
  ok(!looksLikePdf(enc("<!DOCTYPE html><title>404</title>")), "html page is not a pdf");
  ok(!looksLikePdf(enc("%PDF")), "truncated header is not a pdf");
  ok(!looksLikePdf(enc(" ".repeat(1030) + "%PDF-1.4")), "header past 1 KB is not a pdf");
  ok(!looksLikePdf(new Uint8Array(0)), "empty is not a pdf");

  // Path = delivery intake's path.
  ok(coaStoragePath("lab-1", "WA-260902-019") === "lab-1/WA-260902-019.pdf", "path from lab test id");
  ok(coaStoragePath("lab-1", null) === "lab-1/lab-1.pdf", "path falls back to the lab id");
  ok(coaStoragePath("lab-1", "a/b c") === "lab-1/a-b-c.pdf", "path made safe");

  // Totals + note.
  let t = emptyCoaTotals();
  t = addCoaOutcome(t, "WA-1", "archived", null, 2 * 1024 * 1024);
  t = addCoaOutcome(t, "WA-2", "not-pdf", "text/html");
  t = addCoaOutcome(t, "WA-3", "changed", null);
  ok(t.checked === 3 && t.outcomes.archived === 1 && t.outcomes["not-pdf"] === 1 && t.outcomes.changed === 1, "outcomes counted");
  ok(t.bytes === 2 * 1024 * 1024, "bytes only for saved copies");
  ok(t.problems.length === 1 && t.problems[0] === "WA-2: not-pdf (text/html)", "only real problems listed");
  let many = emptyCoaTotals();
  for (let i = 0; i < 9; i++) many = addCoaOutcome(many, `L${i}`, "fetch-failed", null);
  ok(many.problems.length === COA_BACKFILL_MAX_PROBLEMS, "problems capped");
  const done: CoaBackfillRun = { ok: true, done: true, next: null, totals: t, elapsedMs: 5 };
  ok(coaBackfillNote(done).startsWith("Done - every linked certificate has been checked: 3 certificates checked, 1 saved (2.0 MB)"), "done note");
  ok(coaBackfillTone(done) === "warn", "a non-pdf makes it warn");
  const clean = addCoaOutcome(emptyCoaTotals(), "A", "archived", null, 10);
  ok(coaBackfillTone({ ok: true, done: true, next: null, totals: clean, elapsedMs: 1 }) === "ok", "clean done = ok");
  ok(coaBackfillTone({ ok: true, done: false, next: U, totals: clean, elapsedMs: 1 }) === "info", "paused = info");
  const paused = coaBackfillNote({ ok: true, done: false, next: U, totals: clean, elapsedMs: 1 });
  ok(paused.startsWith("Paused at the time limit") && paused.endsWith("Press Continue to carry on from where it stopped."), "paused note");
  const stop = coaBackfillNote({ ok: false, error: "db down", next: null, totals: clean });
  ok(stop.startsWith("Stopped: db down.") && coaBackfillTone({ ok: false, error: "x", next: null, totals: clean }) === "warn", "stopped note");
  ok(coaBackfillNote({ ok: true, done: true, next: null, totals: emptyCoaTotals(), elapsedMs: 1 }) === "Done - every linked certificate has been checked: 0 certificates checked, 0 saved.", "nothing to do");
  return { passed, failed: 0 };
}

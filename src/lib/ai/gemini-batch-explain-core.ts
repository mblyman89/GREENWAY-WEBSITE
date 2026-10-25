/**
 * R74 S41 - Batch Mission Control (pure). Google's own words, explained.
 *
 * Built from the official Gemini Batch API docs
 * (ai.google.dev/gemini-api/docs/batch-mode, /api/batch-api,
 * /docs/rate-limits, /docs/troubleshooting):
 *
 *   1. GOOGLE_STATES      every BatchState Google reports (BATCH_STATE_* /
 *                         JOB_STATE_*), with a plain-English meaning and what
 *                         to do. Our own steps (Queued here, Saving facts,
 *                         Facts saved) sit around Google's.
 *   2. pipelineFor        one batch -> the 7-step pipeline the page draws.
 *   3. explainGemini      any HTTP reply / error from Google -> a title, a
 *                         plain sentence and the fix (add funds, wait, cancel,
 *                         replace the key, ...).
 *   4. parseBatchStats    batchStats {requestCount, successfulRequestCount,
 *                         failedRequestCount, pendingRequestCount} (int64s
 *                         arrive as strings).
 *   5. parseBatchList     GET v1beta/batches -> rows + nextPageToken.
 *   6. sendDecision       may the engine send a batch right now? (pause,
 *                         manual budget, cap, back-off) with the reason.
 *   7. createBackoffMin   wait after a refused create (5, 10, 20, 40, 60).
 *   8. curlFor            the exact terminal command for a console action
 *                         (key shown as $GEMINI_API_KEY, never the real key).
 */

export const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com";
/** Our display names: greenway-lookups-<first 8 of our batch id>. */
export const OUR_BATCH_PREFIX = "greenway-lookups-";
/** Google keeps a batch at most 48 h before EXPIRED (no results). */
export const GOOGLE_EXPIRE_HOURS = 48;
/** Google's target turnaround. */
export const GOOGLE_TARGET_HOURS = 24;
/** Products a batch the owner stopped gives back (kept, not resent). */
export const BATCH_STOPPED_NOTE = "Stopped by you (the Gemini batch was cancelled). Press Re-run stopped products to send it again.";
/** Products of a batch Google no longer has. */
export const BATCH_LOST_NOTE = "Google no longer has this batch (it answered 404). Press Re-run stopped products to send it again.";

export type Severity = "ok" | "info" | "warn" | "bad";
export type Explained = { title: string; plain: string; fix: string; severity: Severity; googleWord: string };

// ─── 1. Google's states ─────────────────────────────────────────────────────

export type GoogleStateKey = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED" | "UNSPECIFIED";

export const GOOGLE_STATES: Record<GoogleStateKey, { plain: string; meaning: string; todo: string; severity: Severity }> = {
  PENDING: {
    plain: "Waiting in Google's line",
    meaning: "Google has the batch and is preparing to run it. Nothing has been answered yet. Google's target is to finish within 24 hours; most finish much sooner.",
    todo: "Nothing. Waiting here is normal. If it is still waiting after 24 hours, cancel it and send it again.",
    severity: "info",
  },
  RUNNING: {
    plain: "Google is working on it",
    meaning: "Google is answering the questions in this batch right now. The progress bar shows how many are done.",
    todo: "Nothing. The app checks every minute and saves the facts as soon as Google finishes.",
    severity: "info",
  },
  SUCCEEDED: {
    plain: "Google finished",
    meaning: "Google answered the batch. The app downloads the answers and saves the facts to your products (a big batch can take a few minutes to save).",
    todo: "Nothing. Watch the Saving facts bar fill up.",
    severity: "ok",
  },
  FAILED: {
    plain: "Google could not run it",
    meaning: "The whole batch failed on Google's side. Google's own error message is shown under the batch.",
    todo: "Read the message under the batch. Its products are put back in line (up to 3 tries in total).",
    severity: "bad",
  },
  CANCELLED: {
    plain: "Cancelled",
    meaning: "The batch was stopped before it finished (by you, or by Stop everything). Anything Google already answered is still saved.",
    todo: "Nothing. Its unanswered products are kept aside. Press Re-run stopped products when you want them sent again.",
    severity: "warn",
  },
  EXPIRED: {
    plain: "Expired after 48 hours",
    meaning: "Google could not finish this batch within 48 hours, so it gave up. An expired batch has no results and is not charged for unanswered questions.",
    todo: "Its products are put back in line automatically. Send fewer batches at a time.",
    severity: "bad",
  },
  UNSPECIFIED: {
    plain: "Google did not say",
    meaning: "Google's reply did not include a state.",
    todo: "Press Check now. If it keeps happening, copy the reply from Ask Google and send it to support.",
    severity: "warn",
  },
};

export function googleStateKey(raw: unknown): GoogleStateKey {
  const s = typeof raw === "string" ? raw.toUpperCase().replace(/^(JOB_STATE_|BATCH_STATE_)/, "") : "";
  if (s === "PENDING" || s === "QUEUED") return "PENDING";
  if (s === "RUNNING") return "RUNNING";
  if (s === "SUCCEEDED") return "SUCCEEDED";
  if (s === "FAILED") return "FAILED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "EXPIRED") return "EXPIRED";
  return "UNSPECIFIED";
}

/** Google's word for one of our ai_batches.state values. */
export function googleWordFor(ourState: string): string {
  const m: Record<string, string> = { pending: "PENDING", running: "RUNNING", succeeded: "SUCCEEDED", failed: "FAILED", canceled: "CANCELLED", expired: "EXPIRED" };
  return m[ourState] ? `BATCH_STATE_${m[ourState]}` : "";
}

// ─── 2. Pipeline ────────────────────────────────────────────────────────────

export const PIPELINE_STEPS = [
  { key: "queued", label: "Queued here", google: "", help: "The products are in our line, not sent yet." },
  { key: "sent", label: "Sent to Google", google: "batches.create", help: "We handed the batch to Google and got a batch name back." },
  { key: "pending", label: "Waiting in Google's line", google: "PENDING", help: "Google has it and will start soon." },
  { key: "running", label: "Google is working", google: "RUNNING", help: "Google is answering the questions." },
  { key: "succeeded", label: "Google finished", google: "SUCCEEDED", help: "The answers are ready to download." },
  { key: "saving", label: "Saving facts", google: "", help: "We are writing the answers onto your products." },
  { key: "saved", label: "Facts saved", google: "", help: "Done. Every answer is on its product." },
] as const;

export type PipelineView = { step: number; label: string; tone: Severity; ended: null | { word: string; plain: string } };

/** Where one batch is in the pipeline (0-6), or how it ended early. */
export function pipelineFor(b: { state: string; google_state?: string | null; finished_at?: string | null }): PipelineView {
  const g = b.google_state ? googleStateKey(b.google_state) : null;
  switch (b.state) {
    case "submitting":
      return { step: 1, label: "Sending to Google", tone: "info", ended: null };
    case "pending":
      return { step: 2, label: PIPELINE_STEPS[2].label, tone: "info", ended: null };
    case "running":
      return { step: 3, label: PIPELINE_STEPS[3].label, tone: "info", ended: null };
    case "succeeded":
      return { step: 4, label: PIPELINE_STEPS[4].label, tone: "ok", ended: null };
    case "ingesting":
      return g && g !== "SUCCEEDED"
        ? { step: 5, label: `Tidying up a ${GOOGLE_STATES[g].plain.toLowerCase()} batch`, tone: "warn", ended: null }
        : { step: 5, label: PIPELINE_STEPS[5].label, tone: "info", ended: null };
    case "ingested":
      if (g && g !== "SUCCEEDED") return { step: 6, label: GOOGLE_STATES[g].plain, tone: GOOGLE_STATES[g].severity, ended: { word: `BATCH_STATE_${g}`, plain: GOOGLE_STATES[g].plain } };
      return { step: 6, label: PIPELINE_STEPS[6].label, tone: "ok", ended: null };
    case "failed":
      return b.finished_at && !g
        ? { step: 1, label: "Google refused the batch", tone: "bad", ended: { word: "create refused", plain: "Google said no when we tried to send it" } }
        : { step: 4, label: GOOGLE_STATES.FAILED.plain, tone: "bad", ended: { word: "BATCH_STATE_FAILED", plain: GOOGLE_STATES.FAILED.plain } };
    case "canceled":
      return { step: 4, label: GOOGLE_STATES.CANCELLED.plain, tone: "warn", ended: { word: "BATCH_STATE_CANCELLED", plain: GOOGLE_STATES.CANCELLED.plain } };
    case "expired":
      return { step: 4, label: GOOGLE_STATES.EXPIRED.plain, tone: "bad", ended: { word: "BATCH_STATE_EXPIRED", plain: GOOGLE_STATES.EXPIRED.plain } };
    case "lost":
      return { step: 2, label: "Google no longer has it", tone: "bad", ended: { word: "404 NOT_FOUND", plain: "Google answered 'not found'" } };
    default:
      return { step: 0, label: b.state, tone: "warn", ended: null };
  }
}

/** Batches that still count against "at once": everything not finished saving. */
export const OPEN_BATCH_STATES = ["submitting", "pending", "running", "succeeded", "ingesting"] as const;
/** Batches the poller asks Google about. */
export const POLL_BATCH_STATES = ["pending", "running", "succeeded", "failed", "canceled", "expired", "ingesting"] as const;

// ─── 3. Google's replies, explained ─────────────────────────────────────────

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/**
 * One reply from Google -> plain English + the fix. `status` is the HTTP code
 * (0 = Google could not be reached), `body` the parsed JSON or text.
 */
export function explainGemini(status: number, body: unknown): Explained {
  const err = body && typeof body === "object" ? ((body as Record<string, unknown>).error as Record<string, unknown> | undefined) : undefined;
  const gStatus = String(err?.status ?? "").toUpperCase();
  const msg = String(err?.message ?? (typeof body === "string" ? body : "")).slice(0, 400);
  const low = msg.toLowerCase();
  const word = [status ? `HTTP ${status}` : "no connection", gStatus].filter(Boolean).join(" ");
  if (status >= 200 && status < 300) return { title: "Google answered OK", plain: "Google accepted the request and answered normally.", fix: "Nothing to do.", severity: "ok", googleWord: word };
  if (status === 0)
    return { title: "Could not reach Google", plain: `The app could not get an answer from Google at all (${msg || "network error or timeout"}).`, fix: "Usually a short internet hiccup. The app tries again every minute. If it lasts more than an hour, check status.cloud.google.com.", severity: "warn", googleWord: word };
  if (status === 429 || gStatus === "RESOURCE_EXHAUSTED") {
    if (has(low, "prepay", "credit", "billing", "balance", "payment", "spend", "budget", "cap"))
      return { title: "Out of funds or spend cap reached", plain: `Google refused because your Gemini account has no money left to spend, or your monthly spend cap is reached. Google said: "${msg}"`, fix: "Open aistudio.google.com, go to Billing, and add funds (or raise the spend cap). Then press Resume here. Nothing is lost; the products wait in line.", severity: "bad", googleWord: word };
    if (has(low, "enqueued", "batch"))
      return { title: "Google's batch line for this model is full", plain: `Google limits how much work can be waiting in batches at once for each model (the "enqueued tokens" limit). Your open batches already fill it. Google said: "${msg}"`, fix: "Wait for the open batches to finish (or cancel some), then send again. Sending one batch at a time avoids this. The app waits before trying again.", severity: "warn", googleWord: word };
    return { title: "Too many requests (rate limit)", plain: `Google asked us to slow down. Google said: "${msg}"`, fix: "Nothing. The app waits longer between tries by itself. If it keeps happening, check your tier and limits at aistudio.google.com (Usage / Rate limits).", severity: "warn", googleWord: word };
  }
  if (status === 401 || status === 403 || gStatus === "PERMISSION_DENIED" || gStatus === "UNAUTHENTICATED" || has(low, "api key not valid", "api_key_invalid"))
    return { title: "Google rejected the API key", plain: `The Gemini key the website uses is wrong, revoked or not allowed for this project. Google said: "${msg}"`, fix: "Open aistudio.google.com > API keys, copy a working key, paste it into Vercel > Settings > Environment Variables > GEMINI_API_KEY, and redeploy.", severity: "bad", googleWord: word };
  if (status === 404 || gStatus === "NOT_FOUND")
    return { title: "Google does not have that", plain: `Google answered "not found": the batch (or model) no longer exists there. It was deleted, or it is older than Google keeps. Google said: "${msg}"`, fix: "Nothing to do for an old batch. The app marks it lost and keeps its products aside; press Re-run stopped products to send them again.", severity: "warn", googleWord: word };
  if (gStatus === "FAILED_PRECONDITION" || has(low, "billing", "free tier", "not available in your country"))
    return { title: "Billing is not set up for this key", plain: `Google needs billing turned on for this project before it accepts the request. Google said: "${msg}"`, fix: "Open aistudio.google.com > Billing and set up (or re-link) billing for the project this key belongs to.", severity: "bad", googleWord: word };
  if (status === 400 || gStatus === "INVALID_ARGUMENT")
    return { title: "Google could not read the request", plain: `Google said the request was malformed or too big. Google said: "${msg}"`, fix: "Copy this message from Ask Google and send it to your developer; it is a code or size issue, not your account.", severity: "bad", googleWord: word };
  if (status === 503 || gStatus === "UNAVAILABLE")
    return { title: "Google is overloaded right now", plain: `Google's service is temporarily busy. Google said: "${msg}"`, fix: "Nothing. The app tries again by itself.", severity: "warn", googleWord: word };
  if (status === 504 || gStatus === "DEADLINE_EXCEEDED")
    return { title: "Google took too long to answer", plain: `Google timed out on this request. Google said: "${msg}"`, fix: "Nothing. The app tries again by itself.", severity: "warn", googleWord: word };
  if (status >= 500)
    return { title: "Google had an internal error", plain: `Something broke on Google's side. Google said: "${msg}"`, fix: "Nothing. The app tries again by itself. If it lasts more than an hour, check status.cloud.google.com.", severity: "warn", googleWord: word };
  return { title: `Google answered ${status}`, plain: `Google said: "${msg || "(no message)"}"`, fix: "Copy this from Ask Google and send it to your developer.", severity: "warn", googleWord: word };
}

// ─── 4-5. Stats + list ──────────────────────────────────────────────────────

export type BatchStats = { total: number; succeeded: number; failed: number; pending: number };

export function parseBatchStats(raw: unknown): BatchStats | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);
  const s = { total: n(o.requestCount), succeeded: n(o.successfulRequestCount), failed: n(o.failedRequestCount), pending: n(o.pendingRequestCount) };
  return s.total || s.succeeded || s.failed || s.pending ? s : null;
}

export type GoogleBatchRow = { name: string; displayName: string; state: GoogleStateKey; stats: BatchStats | null; createTime: string | null; updateTime: string | null; endTime: string | null; model: string; ours: boolean; error: string | null };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** One Operation / GenerateContentBatch (list item or GET) -> a row. */
export function googleBatchRow(op: unknown): GoogleBatchRow | null {
  if (!op || typeof op !== "object") return null;
  const p = op as Record<string, unknown>;
  const m = (p.metadata && typeof p.metadata === "object" ? p.metadata : p) as Record<string, unknown>;
  const name = str(p.name) ?? str(m.name);
  if (!name) return null;
  const displayName = str(m.displayName) ?? "";
  const e = p.error && typeof p.error === "object" ? String((p.error as Record<string, unknown>).message ?? "failed") : null;
  return {
    name,
    displayName,
    state: googleStateKey(m.state),
    stats: parseBatchStats(m.batchStats),
    createTime: str(m.createTime),
    updateTime: str(m.updateTime),
    endTime: str(m.endTime),
    model: (str(m.model) ?? "").replace(/^models\//, ""),
    ours: displayName.startsWith(OUR_BATCH_PREFIX),
    error: e,
  };
}

export function parseBatchList(json: unknown): { rows: GoogleBatchRow[]; nextPageToken: string | null } {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const ops = Array.isArray(o.operations) ? o.operations : Array.isArray(o.batches) ? o.batches : [];
  return { rows: ops.map(googleBatchRow).filter((r): r is GoogleBatchRow => r !== null), nextPageToken: str(o.nextPageToken) };
}

export function isGoogleOpen(s: GoogleStateKey): boolean {
  return s === "PENDING" || s === "RUNNING";
}

// ─── 6-7. May we send? ──────────────────────────────────────────────────────

export type SendDecision = { send: boolean; why: string };

export function sendDecision(x: { paused: boolean; mode: "manual" | "auto"; budget: number; open: number; cap: number; backoffUntil: string | null; now: number; queued: number }): SendDecision {
  if (x.paused) return { send: false, why: "Paused: nothing new goes to Google." };
  if (x.backoffUntil && Date.parse(x.backoffUntil) > x.now) return { send: false, why: `Waiting until ${x.backoffUntil} after Google refused the last send.` };
  if (x.mode === "manual" && x.budget <= 0) return { send: false, why: "Manual mode: no batches allowed right now. Press Send 1 test batch (or Allow more) to send." };
  if (x.open >= x.cap) return { send: false, why: `${x.open} batch${x.open === 1 ? " is" : "es are"} already open (limit ${x.cap}). The next one goes when one finishes saving.` };
  if (x.queued <= 0) return { send: false, why: "Nothing is queued to send." };
  return { send: true, why: x.mode === "auto" ? "Auto mode: sending the next batch." : `Sending (${x.budget} batch${x.budget === 1 ? "" : "es"} allowed).` };
}

/** Minutes to wait after the n-th refused create in a row (n >= 1). */
export function createBackoffMin(streak: number): number {
  return Math.min(60, 5 * 2 ** Math.max(0, Math.min(4, streak - 1)));
}

// ─── 8. Terminal equivalents ────────────────────────────────────────────────

export type ConsoleCommand = "list" | "get" | "cancel" | "delete" | "model";

export function curlFor(cmd: ConsoleCommand, arg: string): string {
  const h = '-H "x-goog-api-key: $GEMINI_API_KEY"';
  switch (cmd) {
    case "list":
      return `curl -s "${GEMINI_API_ROOT}/v1beta/batches?pageSize=100" ${h}`;
    case "get":
      return `curl -s "${GEMINI_API_ROOT}/v1beta/${arg}" ${h}`;
    case "cancel":
      return `curl -s -X POST "${GEMINI_API_ROOT}/v1beta/${arg}:cancel" ${h}`;
    case "delete":
      return `curl -s -X DELETE "${GEMINI_API_ROOT}/v1beta/${arg}" ${h}`;
    case "model":
      return `curl -s "${GEMINI_API_ROOT}/v1beta/models/${arg}" ${h}`;
  }
}

export function validBatchName(s: string): boolean {
  return /^batches\/[A-Za-z0-9_-]{1,128}$/.test(s);
}

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runGeminiBatchExplainTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("gemini-batch-explain-core FAIL:", m);
    }
  };
  ok(googleStateKey("BATCH_STATE_RUNNING") === "RUNNING" && googleStateKey("JOB_STATE_CANCELLED") === "CANCELLED" && googleStateKey(7) === "UNSPECIFIED", "states");
  ok(pipelineFor({ state: "pending" }).step === 2 && pipelineFor({ state: "ingested", google_state: "BATCH_STATE_CANCELLED" }).ended?.word === "BATCH_STATE_CANCELLED", "pipeline");
  ok(pipelineFor({ state: "failed", finished_at: "x" }).label === "Google refused the batch", "create refused");
  ok(explainGemini(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted" } }).title.startsWith("Out of funds"), "funds");
  ok(explainGemini(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Enqueued tokens limit exceeded for batch" } }).title.includes("line"), "enqueued");
  ok(explainGemini(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } }).title.includes("API key"), "bad key");
  ok(explainGemini(404, {}).severity === "warn" && explainGemini(0, "timeout").title === "Could not reach Google" && explainGemini(200, {}).severity === "ok", "404 / offline / ok");
  ok(explainGemini(503, {}).title.includes("overloaded") && explainGemini(500, {}).title.includes("internal"), "5xx");
  const st = parseBatchStats({ requestCount: "200", successfulRequestCount: "150", pendingRequestCount: "50" });
  ok(st?.total === 200 && st.succeeded === 150 && st.pending === 50 && st.failed === 0 && parseBatchStats({}) === null, "batchStats strings");
  const l = parseBatchList({ operations: [{ name: "batches/a", metadata: { displayName: "greenway-lookups-1234abcd", state: "BATCH_STATE_PENDING", model: "models/gemini-x" } }, { name: "batches/b", metadata: { displayName: "other", state: "BATCH_STATE_SUCCEEDED" }, done: true }, {}], nextPageToken: "t" });
  ok(l.rows.length === 2 && l.rows[0].ours && !l.rows[1].ours && l.rows[0].model === "gemini-x" && l.nextPageToken === "t" && isGoogleOpen(l.rows[0].state), "list");
  const base = { paused: false, mode: "manual" as const, budget: 1, open: 0, cap: 4, backoffUntil: null, now: 0, queued: 5 };
  ok(sendDecision(base).send && !sendDecision({ ...base, budget: 0 }).send && sendDecision({ ...base, budget: 0, mode: "auto" }).send, "manual budget vs auto");
  ok(!sendDecision({ ...base, paused: true }).send && !sendDecision({ ...base, open: 4 }).send && !sendDecision({ ...base, backoffUntil: "1970-01-02T00:00:00Z" }).send && !sendDecision({ ...base, queued: 0 }).send, "pause / cap / backoff / empty");
  ok(createBackoffMin(1) === 5 && createBackoffMin(3) === 20 && createBackoffMin(9) === 60, "backoff");
  ok(curlFor("cancel", "batches/x").includes("batches/x:cancel") && !curlFor("list", "").includes("AIza") && validBatchName("batches/abc_1") && !validBatchName("batches/../x"), "curl + name");
  return { passed, failed };
}

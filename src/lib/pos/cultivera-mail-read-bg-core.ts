/**
 * src/lib/pos/cultivera-mail-read-bg-core.ts   (R74 S20, owner round 10)
 *
 * Owner: "ideally, I would like to run it at night before bed, then wake up to all of them having
 * been read, so I dont have to camp on the button and press it 500 times to finish them all. is
 * there a way to click it, and it just runs in the background until all are done?"
 *
 * "Read everything in the background" on Menu Imports only ARMS this state. The existing
 * every-minute worker (/api/cron/lookup-jobs, no new cron) then runs the SAME reader as the press
 * (runReadBatch, S19: five at a time, newest email first) for up to MAIL_READ_BG_BUDGET_MS per run,
 * one run at a time (lease), until nothing is left to read.
 *
 * Decisions only (pure, self-tested). The store (cultivera-mail-read-bg.ts) does the I/O:
 *
 *   parseMailReadBg / emptyMailReadBg   the saved site_settings value <-> state (malformed = safe)
 *   armMailReadBg / pauseMailReadBg     the two buttons (each bumps the generation)
 *   mailReadBgDecision                  idle | paused | finished | leased | go
 *   takeMailReadBgLease / release...    one run at a time (lease outlives the route's 800 s)
 *   ownsMailReadBg                      a run stops starting documents once paused / re-armed
 *   recordMailReadBgRun                 add one run's counts; finish; or pause after repeated failures
 *   llamaOutage                         is this LlamaParse error the SERVICE (key, credits, outage)?
 *   mailReadBgStatus                    the one status sentence on the page
 *
 * Fail loud, never loop: a run that could not read (storage outage, LlamaParse down, nothing read
 * although documents wait) is counted; after MAIL_READ_BG_MAX_FAILED_RUNS such runs IN A ROW the
 * background reader pauses itself with the reason on the page, instead of retrying all night.
 * A LlamaParse SERVICE outage never lets the background reader fall back to the text layer for
 * hundreds of documents unattended: the document is left "stored" for LlamaParse later.
 *
 * No I/O. Self-tests at the bottom (scripts/compliance/run-pure-selftests.ts).
 */

export const MAIL_READ_BG_KEY = "cultivera_mail_read_bg";
export const MAIL_READ_BG_LABEL = "Cultivera email harvest: read every kept document in the background (R74 S20)";
export const MAIL_READ_BG_AUDIT = {
  armed: "cultivera_mail.read_bg_armed",
  paused: "cultivera_mail.read_bg_paused",
  ran: "cultivera_mail.read_bg_ran",
} as const;

/** A worker run stops STARTING documents after this long (the route lives 800 s; a started document still finishes). */
export const MAIL_READ_BG_BUDGET_MS = 560_000;
/** The lease = budget + this = 800 s, the route's maxDuration: a live run is never overtaken. */
export const MAIL_READ_BG_LEASE_SLACK_MS = 240_000;
/** Documents one worker run may pick up (about 15 a minute at five at a time). */
export const MAIL_READ_BG_MAX_DOCS = 400;
/** Failed runs in a row before the background reader pauses itself and says why. */
export const MAIL_READ_BG_MAX_FAILED_RUNS = 3;

export type MailReadBgState = {
  v: 1;
  /** Bumped by every arm / pause: a run that sees a new generation stops starting documents. */
  generation: number;
  armed: boolean;
  armedAt: string | null;
  armedBy: string | null;
  paused: boolean;
  /** Why it paused: a person pressed Pause, or it paused itself after repeated failures. */
  pausedBy: "person" | "failures" | null;
  done: boolean;
  runs: number;
  read: number;
  parsed: number;
  unreadable: number;
  llamaparse: number;
  unpdf: number;
  /** Failed runs in a row (reset by a run that read something). */
  failedRuns: number;
  lastError: string | null;
  /** Documents waiting after the last run (null = no run yet). */
  left: number | null;
  lastRunAt: string | null;
  lastNote: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
};

export function emptyMailReadBg(): MailReadBgState {
  return {
    v: 1,
    generation: 0,
    armed: false,
    armedAt: null,
    armedBy: null,
    paused: false,
    pausedBy: null,
    done: false,
    runs: 0,
    read: 0,
    parsed: 0,
    unreadable: 0,
    llamaparse: 0,
    unpdf: 0,
    failedRuns: 0,
    lastError: null,
    left: null,
    lastRunAt: null,
    lastNote: null,
    leaseToken: null,
    leaseUntil: null,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The saved value -> a state. Anything malformed falls back field by field; a non-object = not armed. */
export function parseMailReadBg(raw: unknown): MailReadBgState {
  const e = emptyMailReadBg();
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
    parsed: nat(r.parsed),
    unreadable: nat(r.unreadable),
    llamaparse: nat(r.llamaparse),
    unpdf: nat(r.unpdf),
    failedRuns: nat(r.failedRuns),
    lastError: str(r.lastError),
    left: typeof r.left === "number" && Number.isFinite(r.left) && r.left >= 0 ? Math.floor(r.left) : null,
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
  };
}

/** Start (or resume) reading everything. Counters start again; the lease is kept as it is. */
export function armMailReadBg(s: MailReadBgState, actorId: string | null, nowIso: string): MailReadBgState {
  return {
    ...s,
    generation: s.generation + 1,
    armed: true,
    armedAt: nowIso,
    armedBy: actorId,
    paused: false,
    pausedBy: null,
    done: false,
    runs: 0,
    read: 0,
    parsed: 0,
    unreadable: 0,
    llamaparse: 0,
    unpdf: 0,
    failedRuns: 0,
    lastError: null,
    lastNote: null,
  };
}

export function pauseMailReadBg(s: MailReadBgState): MailReadBgState {
  return { ...s, generation: s.generation + 1, paused: true, pausedBy: "person" };
}

export type MailReadBgDecision = "idle" | "paused" | "finished" | "leased" | "go";

export function mailReadBgLeaseLive(s: Pick<MailReadBgState, "leaseToken" | "leaseUntil">, nowMs: number): boolean {
  if (!s.leaseToken || !s.leaseUntil) return false;
  const until = Date.parse(s.leaseUntil);
  return Number.isFinite(until) && until > nowMs;
}

export function mailReadBgDecision(s: MailReadBgState, nowMs: number): MailReadBgDecision {
  if (!s.armed) return "idle";
  if (s.paused) return "paused";
  if (s.done) return "finished";
  if (mailReadBgLeaseLive(s, nowMs)) return "leased";
  return "go";
}

export function takeMailReadBgLease(s: MailReadBgState, token: string, nowMs: number, budgetMs: number): MailReadBgState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + budgetMs + MAIL_READ_BG_LEASE_SLACK_MS).toISOString() };
}

export function releaseMailReadBgLease(s: MailReadBgState, token: string): MailReadBgState {
  return s.leaseToken === token ? { ...s, leaseToken: null, leaseUntil: null } : s;
}

/** Does this run still own the pass it started (same lease, same generation, not paused)? */
export function ownsMailReadBg(s: MailReadBgState, token: string, generation: number): boolean {
  return s.leaseToken === token && s.generation === generation && !s.paused;
}

/** One worker run's result (the fields of ReadBatchResult the state keeps). */
export type MailReadBgRun = {
  ok: boolean;
  waiting: number;
  read: number;
  parsed: number;
  unreadable: number;
  llamaparse: number;
  unpdf: number;
  left: number;
  stoppedBecause: string | null;
};

/** Did this run fail to make progress? (an outage, LlamaParse down, or nothing read although documents waited) */
export function mailReadBgRunFailed(r: MailReadBgRun): boolean {
  if (!r.ok) return true;
  return r.read === 0 && r.left > 0;
}

/**
 * Add one run to the pass. Finished = nothing left and the run was fine. A failed run is counted;
 * MAIL_READ_BG_MAX_FAILED_RUNS in a row pauses the pass with the reason (never retried all night).
 */
export function recordMailReadBgRun(s: MailReadBgState, r: MailReadBgRun, nowIso: string, note: string): MailReadBgState {
  const failed = mailReadBgRunFailed(r);
  const failedRuns = failed ? s.failedRuns + 1 : 0;
  const why = failed ? (r.stoppedBecause ?? `no document could be read although ${r.left} wait`) : null;
  const next: MailReadBgState = {
    ...s,
    runs: s.runs + 1,
    read: s.read + r.read,
    parsed: s.parsed + r.parsed,
    unreadable: s.unreadable + r.unreadable,
    llamaparse: s.llamaparse + r.llamaparse,
    unpdf: s.unpdf + r.unpdf,
    failedRuns,
    lastError: failed ? why : s.lastError,
    left: r.left,
    lastRunAt: nowIso,
    lastNote: note.slice(0, 600),
    done: !failed && r.left === 0,
  };
  if (failedRuns >= MAIL_READ_BG_MAX_FAILED_RUNS) {
    return { ...next, paused: true, pausedBy: "failures", generation: s.generation + 1 };
  }
  return next;
}

/**
 * Is this LlamaParse error the SERVICE being unavailable (key unset, credits used up, rate limited,
 * LlamaCloud down or unreachable), as opposed to one document LlamaParse could not read? The strings
 * are the ones llamaparse-provider.ts writes. A service outage holds the document for LlamaParse;
 * a one-document failure is read from the text layer and passed (named on the row), never retried.
 */
export function llamaOutage(err: string | null | undefined): boolean {
  if (!err) return false;
  return /LLAMA_CLOUD_API_KEY not set|credits exhausted|HTTP 402|LlamaParse (?:upload|status|result) (?:401|403|429|5\d\d)\b|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network error/i.test(err);
}

export type MailReadBgTone = "good" | "warn" | "muted";

/** The status sentence. `stored` = documents waiting now (null = the count could not be read). */
export function mailReadBgStatus(s: MailReadBgState, stored: number | null, nowMs: number): { tone: MailReadBgTone; text: string; running: boolean; canPause: boolean; canStart: boolean } {
  const running = s.armed && mailReadBgLeaseLive(s, nowMs);
  const waiting = stored === null ? "an unknown number of documents (the count could not be read)" : `${stored} document${stored === 1 ? "" : "s"}`;
  const counts = `${s.read} read so far (${s.parsed} with barcodes, ${s.unreadable} without; LlamaParse ${s.llamaparse}, text layer ${s.unpdf}) in ${s.runs} run${s.runs === 1 ? "" : "s"}`;
  if (!s.armed) {
    return stored === 0
      ? { tone: "good", text: "Background reading: nothing waiting to be read.", running, canPause: false, canStart: false }
      : { tone: "muted", text: `Background reading is off. ${waiting} wait to be read.`, running, canPause: false, canStart: stored !== 0 };
  }
  if (s.paused) {
    const why = s.pausedBy === "failures" ? `It paused itself after ${s.failedRuns} failed runs in a row: ${s.lastError ?? "no reason was saved"}. Fix that, then press Read everything in the background again.` : "Paused by a person.";
    return { tone: "warn", text: `Background reading is paused. ${counts}. ${waiting} still wait. ${why}`, running, canPause: false, canStart: true };
  }
  if (s.done) {
    return stored === 0 || stored === null
      ? { tone: "good", text: `Background reading finished: ${counts}. Nothing is left to read.`, running, canPause: false, canStart: stored === null }
      : { tone: "warn", text: `Background reading finished its pass (${counts}), and ${waiting} arrived since (a newer harvest). Press Read everything in the background again.`, running, canPause: false, canStart: true };
  }
  const trouble = s.failedRuns > 0 ? ` The last run could not read: ${s.lastError ?? "no reason saved"} (${s.failedRuns} of ${MAIL_READ_BG_MAX_FAILED_RUNS} before it pauses itself).` : "";
  return {
    tone: s.failedRuns > 0 ? "warn" : "good",
    text: `${running ? "Reading now" : "Queued (the every-minute worker picks it up within a minute)"}: ${counts}; ${waiting} left. You can close this page.${trouble}`,
    running,
    canPause: true,
    canStart: false,
  };
}

/** The note saved for one run (also the audit line). */
export function mailReadBgRunNote(r: MailReadBgRun): string {
  const base = `Read ${r.read} (${r.parsed} with barcodes, ${r.unreadable} without); ${r.left} left.`;
  return r.stoppedBecause ? `${base} Stopped: ${r.stoppedBecause}.` : base;
}

/* ------------------------------------------------------------------ *
 *  Self-tests
 * ------------------------------------------------------------------ */

export function __runCultiveraMailReadBgCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL cultivera-mail-read-bg-core: ${name}`);
    }
  };
  const T = Date.parse("2026-10-20T03:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const run = (o: Partial<MailReadBgRun> = {}): MailReadBgRun => ({ ok: true, waiting: 10, read: 4, parsed: 3, unreadable: 1, llamaparse: 3, unpdf: 0, left: 6, stoppedBecause: null, ...o });

  // limits
  ok(MAIL_READ_BG_BUDGET_MS + MAIL_READ_BG_LEASE_SLACK_MS === 800_000, "lease = the route's 800 s");
  ok(MAIL_READ_BG_BUDGET_MS + 120_000 <= 800_000, "a document started at the budget ends inside 800 s");

  // parse
  const e = parseMailReadBg(null);
  ok(!e.armed && e.generation === 0 && e.left === null, "missing row = not armed");
  ok(!parseMailReadBg([1]).armed && !parseMailReadBg("x").armed, "junk = not armed");
  const p = parseMailReadBg({ armed: true, generation: 3.7, read: -2, pausedBy: "robot", left: 5, leaseToken: "  " });
  ok(p.armed && p.generation === 3 && p.read === 0 && p.pausedBy === null && p.left === 5 && p.leaseToken === null, "fields parsed safely");
  ok(parseMailReadBg({ armed: "true" }).armed === false, "armed must be the boolean true");

  // arm / pause / decision
  const a = armMailReadBg({ ...emptyMailReadBg(), read: 9, failedRuns: 2, paused: true, pausedBy: "failures", done: true, leaseToken: "L", leaseUntil: iso(T + 1000) }, "u1", iso(T));
  ok(a.armed && !a.paused && !a.done && a.read === 0 && a.failedRuns === 0 && a.generation === 1 && a.armedBy === "u1", "arm resets the pass");
  ok(a.leaseToken === "L", "arm keeps a live run's lease");
  ok(mailReadBgDecision(emptyMailReadBg(), T) === "idle", "not armed = idle");
  ok(mailReadBgDecision(a, T) === "leased", "live lease = leased");
  ok(mailReadBgDecision(a, T + 1001) === "go", "expired lease = go");
  const ps = pauseMailReadBg(a);
  ok(ps.paused && ps.pausedBy === "person" && ps.generation === 2 && mailReadBgDecision(ps, T + 5000) === "paused", "pause");
  ok(mailReadBgDecision({ ...a, done: true }, T + 5000) === "finished", "done = finished");

  // lease + ownership
  const l = takeMailReadBgLease(a, "tok", T, MAIL_READ_BG_BUDGET_MS);
  ok(l.leaseToken === "tok" && Date.parse(l.leaseUntil!) === T + 800_000, "lease until budget + slack");
  ok(ownsMailReadBg(l, "tok", l.generation), "owner");
  ok(!ownsMailReadBg(l, "other", l.generation), "another token does not own");
  ok(!ownsMailReadBg(pauseMailReadBg(l), "tok", l.generation), "a pause ends ownership");
  ok(!ownsMailReadBg({ ...l, paused: true }, "tok", l.generation), "paused (same generation) does not own");
  ok(releaseMailReadBgLease(l, "tok").leaseToken === null && releaseMailReadBgLease(l, "x").leaseToken === "tok", "only the owner releases");

  // record runs
  const r1 = recordMailReadBgRun(l, run(), iso(T), "n1");
  ok(r1.runs === 1 && r1.read === 4 && r1.parsed === 3 && r1.left === 6 && !r1.done && r1.failedRuns === 0, "a good run adds up");
  const r2 = recordMailReadBgRun(r1, run({ read: 6, parsed: 6, unreadable: 0, left: 0 }), iso(T), "n2");
  ok(r2.done && r2.read === 10 && r2.left === 0, "nothing left = finished");
  const f1 = recordMailReadBgRun(r1, run({ ok: false, read: 0, left: 6, stoppedBecause: "could not open a.pdf: storage: 503" }), iso(T), "x");
  ok(f1.failedRuns === 1 && !f1.paused && f1.lastError === "could not open a.pdf: storage: 503" && !f1.done, "one failed run counted");
  const f2 = recordMailReadBgRun(f1, run({ ok: true, read: 0, left: 6 }), iso(T), "x");
  ok(f2.failedRuns === 2 && /no document could be read although 6 wait/.test(f2.lastError ?? ""), "nothing read although documents wait = failed");
  const f3 = recordMailReadBgRun(f2, run({ ok: false, read: 0, left: 6, stoppedBecause: "LlamaParse could not run" }), iso(T), "x");
  ok(f3.paused && f3.pausedBy === "failures" && f3.generation === f2.generation + 1, "three failed runs in a row pause it");
  const ok2 = recordMailReadBgRun(f2, run(), iso(T), "x");
  ok(ok2.failedRuns === 0 && !ok2.paused && ok2.lastError === f2.lastError, "a good run resets the failure count");
  ok(!recordMailReadBgRun(r1, run({ ok: false, read: 3, left: 0, stoppedBecause: "s" }), iso(T), "x").done, "a failed run never marks finished");
  ok(recordMailReadBgRun(r1, run(), iso(T), "x".repeat(900)).lastNote!.length === 600, "note capped");

  // llamaOutage
  ok(llamaOutage("LLAMA_CLOUD_API_KEY not set") && llamaOutage("credits exhausted (HTTP 402)"), "key / credits = service");
  ok(llamaOutage("LlamaParse upload 503") && llamaOutage("LlamaParse status 429") && llamaOutage("LlamaParse upload 401"), "5xx / 429 / auth = service");
  ok(llamaOutage("fetch failed") && llamaOutage("connect ECONNREFUSED 1.2.3.4"), "network = service");
  ok(!llamaOutage("LlamaParse job timed out") && !llamaOutage("LlamaParse job error") && !llamaOutage("LlamaParse upload 400"), "one document's failure is not the service");
  ok(!llamaOutage(null) && !llamaOutage(""), "no error = no outage");

  // status
  ok(mailReadBgStatus(emptyMailReadBg(), 0, T).text === "Background reading: nothing waiting to be read.", "off + nothing");
  const off = mailReadBgStatus(emptyMailReadBg(), 12, T);
  ok(off.tone === "muted" && off.canStart && /12 documents wait/.test(off.text), "off + waiting");
  const lv = mailReadBgStatus(r1, 6, T + 1000);
  ok(lv.running && lv.canPause && !lv.canStart && /^Reading now: 4 read so far/.test(lv.text) && /You can close this page/.test(lv.text), "running");
  const q = mailReadBgStatus(releaseMailReadBgLease(r1, "tok"), 6, T);
  ok(!q.running && /^Queued/.test(q.text), "queued");
  const fs = mailReadBgStatus(f3, 6, T + 900_000);
  ok(fs.tone === "warn" && fs.canStart && /paused itself after 3 failed runs in a row: LlamaParse could not run/.test(fs.text), "self-pause names the reason");
  ok(/Paused by a person/.test(mailReadBgStatus(pauseMailReadBg(r1), 6, T).text), "person pause");
  ok(mailReadBgStatus(r2, 0, T).tone === "good" && /finished/.test(mailReadBgStatus(r2, 0, T).text), "finished");
  ok(mailReadBgStatus(r2, 3, T).canStart && /arrived since/.test(mailReadBgStatus(r2, 3, T).text), "finished but newer documents");
  ok(/unknown number/.test(mailReadBgStatus(r1, null, T).text), "unreadable count is said, never 0");
  ok(/1 of 3 before it pauses itself/.test(mailReadBgStatus(f1, 6, T).text), "a failing run is shown before it pauses");
  ok(mailReadBgRunNote(run({ stoppedBecause: "time budget reached" })) === "Read 4 (3 with barcodes, 1 without); 6 left. Stopped: time budget reached.", "run note");

  return { passed, failed };
}

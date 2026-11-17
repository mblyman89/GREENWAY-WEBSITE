/**
 * src/lib/pos/menu-restage-queue-core.ts   (D247, owner: "is there a way to click the apply or save
 * or whatever button, it goes onto the server or where ever, and then we move on? right now several
 * times it will get all the way to 300 seconds and then die.")
 *
 * PURE decisions for the background menu update after an onboarding Approve.
 *
 * WHY. Measured on the live database (D247 recon): every single Approve rebuilt and published the
 * WHOLE menu (~2,625 items, one menu version per click: 390 versions in 7 days) INSIDE the click,
 * then the 2,690-line onboarding page re-rendered. Next.js runs a browser's server actions one at a
 * time, so five quick Approves waited for five full menu rebuilds in a row - and two people (or two
 * tabs) rebuilt the menu at the same time, fighting over the same rows. That is how a click reached
 * the 300-second limit.
 *
 * NOW. The click saves the approval (every gate still runs, nothing about WHAT is approved changes)
 * and puts the delivery on this queue. After the response is sent, ONE worker at a time (a lease)
 * rebuilds the menu once for every delivery waiting. Approvals that land while it is rebuilding are
 * COALESCED: the delivery's `seq` goes up, and the worker rebuilds it once more afterwards - so ten
 * clicks in a minute cost two rebuilds, not ten. The every-minute worker (/api/cron/lookup-jobs)
 * finishes anything a cut-off run left behind. Nothing is ever dropped: an entry only leaves the queue
 * when a rebuild that STARTED AFTER its last approval has finished.
 *
 * State = one site_settings row (MENU_RESTAGE_KEY), every write a compare-and-swap (server half).
 */

export const MENU_RESTAGE_KEY = "menu_restage_queue";
export const MENU_RESTAGE_LABEL = "Onboarding: deliveries whose menu update runs in the background (D247)";
export const MENU_RESTAGE_ENV = "MENU_RESTAGE_BACKGROUND";
/** A run started by a click (after the response, inside the 300 s page function) stops STARTING rebuilds after this. */
export const MENU_RESTAGE_AFTER_BUDGET_MS = 60_000;
/** The every-minute worker's share. */
export const MENU_RESTAGE_CRON_BUDGET_MS = 120_000;
/**
 * The lease outlives one worst-case rebuild started at the very end of the budget (the slowest
 * measured delivery update was ~230 s end to end), so two rebuilds never overlap.
 */
export const MENU_RESTAGE_LEASE_SLACK_MS = 300_000;
/** A rebuild that failed this many times in a row is held (named on the page) instead of retried forever. */
export const MENU_RESTAGE_MAX_ATTEMPTS = 5;
/** Never more deliveries than this in the row (a bound, not an expected size). */
export const MENU_RESTAGE_MAX_ENTRIES = 200;

export type RestageEntry = {
  manifestId: string;
  /** Bumped by every approval; a rebuild clears the entry only if seq is unchanged. */
  seq: number;
  /** First approval waiting (ISO). */
  since: string;
  /** Last approval waiting (ISO). */
  lastAt: string;
  actorId: string | null;
  /** Approvals coalesced into this entry. */
  approvals: number;
  attempts: number;
  lastError: string | null;
};

export type RestageState = {
  v: 1;
  entries: RestageEntry[];
  leaseToken: string | null;
  leaseUntil: string | null;
  runs: number;
  rebuilt: number;
  lastRunAt: string | null;
  lastNote: string | null;
};

export function emptyRestage(): RestageState {
  return { v: 1, entries: [], leaseToken: null, leaseUntil: null, runs: 0, rebuilt: 0, lastRunAt: null, lastNote: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The flag: default ON; "off" / "0" / "false" = rebuild inside the click, as before D247. */
export function restageBackgroundOn(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

export function parseRestage(raw: unknown): RestageState {
  const e = emptyRestage();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return e;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const entries: RestageEntry[] = [];
  for (const x of Array.isArray(r.entries) ? r.entries : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = str(o.manifestId);
    if (!id || !UUID.test(id) || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const since = str(o.since) ?? new Date(0).toISOString();
    entries.push({
      manifestId: id,
      seq: nat(o.seq),
      since,
      lastAt: str(o.lastAt) ?? since,
      actorId: str(o.actorId),
      approvals: nat(o.approvals),
      attempts: nat(o.attempts),
      lastError: str(o.lastError),
    });
  }
  return {
    v: 1,
    entries: entries.slice(0, MENU_RESTAGE_MAX_ENTRIES),
    leaseToken: str(r.leaseToken),
    leaseUntil: str(r.leaseUntil),
    runs: nat(r.runs),
    rebuilt: nat(r.rebuilt),
    lastRunAt: str(r.lastRunAt),
    lastNote: str(r.lastNote),
  };
}

/** An approval on `manifestId`: add it, or bump the waiting entry (coalesce). Resets a held entry. */
export function enqueueRestage(s: RestageState, manifestId: string, actorId: string | null, nowIso: string): RestageState {
  if (!UUID.test(manifestId)) return s;
  const i = s.entries.findIndex((e) => e.manifestId.toLowerCase() === manifestId.toLowerCase());
  if (i >= 0) {
    const cur = s.entries[i]!;
    const next = { ...cur, seq: cur.seq + 1, lastAt: nowIso, actorId: actorId ?? cur.actorId, approvals: cur.approvals + 1, attempts: 0, lastError: null };
    return { ...s, entries: s.entries.map((e, k) => (k === i ? next : e)) };
  }
  if (s.entries.length >= MENU_RESTAGE_MAX_ENTRIES) return s;
  return { ...s, entries: [...s.entries, { manifestId, seq: 1, since: nowIso, lastAt: nowIso, actorId, approvals: 1, attempts: 0, lastError: null }] };
}

export function restageLeaseLive(s: Pick<RestageState, "leaseToken" | "leaseUntil">, nowMs: number): boolean {
  if (!s.leaseToken || !s.leaseUntil) return false;
  const until = Date.parse(s.leaseUntil);
  return Number.isFinite(until) && until > nowMs;
}

/** Entries a worker may rebuild (not held after too many failures), oldest first. */
export function runnableEntries(s: RestageState): RestageEntry[] {
  return s.entries
    .filter((e) => e.attempts < MENU_RESTAGE_MAX_ATTEMPTS)
    .slice()
    .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}

export type RestageDecision = "empty" | "leased" | "go";

export function restageDecision(s: RestageState, nowMs: number): RestageDecision {
  if (runnableEntries(s).length === 0) return "empty";
  if (restageLeaseLive(s, nowMs)) return "leased";
  return "go";
}

export function takeRestageLease(s: RestageState, token: string, nowMs: number, budgetMs: number): RestageState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + budgetMs + MENU_RESTAGE_LEASE_SLACK_MS).toISOString() };
}

export function releaseRestageLease(s: RestageState, token: string): RestageState {
  return s.leaseToken === token ? { ...s, leaseToken: null, leaseUntil: null } : s;
}

/** The next delivery to rebuild (null = nothing runnable). */
export function nextRestage(s: RestageState): RestageEntry | null {
  return runnableEntries(s)[0] ?? null;
}

/**
 * A rebuild of `manifestId` that STARTED at `seqAtStart` finished. ok: the entry leaves the queue
 * only when no approval arrived meanwhile (seq unchanged); otherwise it stays for one more rebuild.
 * Failed: the attempt is counted and the reason kept (held at MENU_RESTAGE_MAX_ATTEMPTS).
 */
export function finishRestage(s: RestageState, manifestId: string, seqAtStart: number, ok: boolean, error: string | null): RestageState {
  const id = manifestId.toLowerCase();
  const entries: RestageEntry[] = [];
  for (const e of s.entries) {
    if (e.manifestId.toLowerCase() !== id) {
      entries.push(e);
      continue;
    }
    if (ok && e.seq === seqAtStart) continue; // done, nothing new arrived
    if (ok) {
      entries.push({ ...e, attempts: 0, lastError: null });
      continue;
    }
    entries.push({ ...e, attempts: e.seq === seqAtStart ? e.attempts + 1 : 0, lastError: (error ?? "The menu update failed.").slice(0, 300) });
  }
  return { ...s, entries, rebuilt: ok ? s.rebuilt + 1 : s.rebuilt };
}

/** Does this run still hold the lease? */
export function ownsRestage(s: RestageState, token: string): boolean {
  return s.leaseToken === token;
}

export type RestageTone = "ok" | "busy" | "warn";

/** The one-line status on Product Onboarding. */
export function restageStatus(s: RestageState, nowMs: number): { tone: RestageTone; text: string; waiting: number; held: number } {
  const held = s.entries.filter((e) => e.attempts >= MENU_RESTAGE_MAX_ATTEMPTS);
  const waiting = s.entries.length - held.length;
  const approvals = s.entries.reduce((n, e) => n + (e.attempts >= MENU_RESTAGE_MAX_ATTEMPTS ? 0 : e.approvals), 0);
  if (held.length > 0) {
    return {
      tone: "warn",
      waiting,
      held: held.length,
      text: `The menu update for ${held.length === 1 ? "one delivery" : `${held.length} deliveries`} failed ${MENU_RESTAGE_MAX_ATTEMPTS} times and is on hold: ${held[0]!.lastError ?? "no reason recorded"}. Approve any product on it again to retry, or use Publish Menu.`,
    };
  }
  if (waiting > 0) {
    const running = restageLeaseLive(s, nowMs);
    const word = approvals === 1 ? "1 approval" : `${approvals} approvals`;
    return {
      tone: "busy",
      waiting,
      held: 0,
      text: running
        ? `Updating the live menu in the background (${word} on ${waiting === 1 ? "1 delivery" : `${waiting} deliveries`}). Keep working - nothing waits for it.`
        : `Menu update queued (${word}). It starts within a minute - keep working.`,
    };
  }
  return { tone: "ok", waiting: 0, held: 0, text: s.lastNote ?? "The live menu is up to date with every approval." };
}

export function restageRunNote(rebuilt: number, failed: number, left: number): string {
  const parts = [`Rebuilt the menu ${rebuilt === 1 ? "once" : `${rebuilt} times`}`];
  if (failed > 0) parts.push(`${failed} failed (retried on the next run)`);
  if (left > 0) parts.push(`${left} still waiting`);
  return `${parts.join("; ")}.`;
}

export function __runMenuRestageQueueCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL menu-restage-queue-core: ${name}`);
    }
  };
  const M1 = "00000000-0000-4000-8000-000000000001";
  const M2 = "00000000-0000-4000-8000-000000000002";
  const T = Date.parse("2026-11-16T20:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  // flag
  ok(restageBackgroundOn(undefined) && restageBackgroundOn("") && restageBackgroundOn("on"), "flag default on");
  ok(!restageBackgroundOn("off") && !restageBackgroundOn("FALSE") && !restageBackgroundOn("0"), "flag off spellings");

  // parse
  ok(parseRestage(null).entries.length === 0 && parseRestage("x").entries.length === 0 && parseRestage([1]).entries.length === 0, "junk = empty");
  const p = parseRestage({ entries: [{ manifestId: M1, seq: 2.6 }, { manifestId: "nope" }, { manifestId: M1.toUpperCase() }, null], leaseToken: " ", runs: -1 });
  ok(p.entries.length === 1 && p.entries[0]!.seq === 2 && p.leaseToken === null && p.runs === 0, "parse drops bad / duplicate ids and bad numbers");

  // enqueue + coalesce
  let s = enqueueRestage(emptyRestage(), M1, "u1", iso(T));
  ok(s.entries.length === 1 && s.entries[0]!.seq === 1 && s.entries[0]!.approvals === 1, "first approval queued");
  s = enqueueRestage(s, M1, "u2", iso(T + 1000));
  ok(s.entries.length === 1 && s.entries[0]!.seq === 2 && s.entries[0]!.approvals === 2 && s.entries[0]!.since === iso(T) && s.entries[0]!.actorId === "u2", "second approval coalesced");
  ok(enqueueRestage(s, "not-a-uuid", null, iso(T)) === s, "bad id ignored");
  s = enqueueRestage(s, M2, null, iso(T + 2000));
  ok(s.entries.length === 2, "second delivery queued");

  // decision + lease
  ok(restageDecision(emptyRestage(), T) === "empty", "empty");
  ok(restageDecision(s, T) === "go", "go");
  const leased = takeRestageLease(s, "L", T, 60_000);
  ok(restageDecision(leased, T + 1000) === "leased", "live lease = leased");
  ok(restageDecision(leased, T + 60_000 + MENU_RESTAGE_LEASE_SLACK_MS + 1) === "go", "expired lease = go");
  ok(ownsRestage(leased, "L") && !ownsRestage(leased, "X"), "ownership");
  ok(releaseRestageLease(leased, "X").leaseToken === "L" && releaseRestageLease(leased, "L").leaseToken === null, "only the owner releases");

  // order
  ok(nextRestage(s)!.manifestId === M1, "oldest first");

  // finish: unchanged seq leaves the queue
  const seq = s.entries[0]!.seq;
  let f = finishRestage(s, M1, seq, true, null);
  ok(f.entries.length === 1 && f.entries[0]!.manifestId === M2 && f.rebuilt === 1, "rebuilt entry leaves");
  // finish: an approval arrived meanwhile -> stays for one more rebuild
  const mid = enqueueRestage(s, M1, null, iso(T + 3000));
  f = finishRestage(mid, M1, seq, true, null);
  ok(f.entries.some((e) => e.manifestId === M1) && f.entries.find((e) => e.manifestId === M1)!.seq === seq + 1, "approval during rebuild keeps the entry");
  // failure counts, held at the max, re-approval resets
  let h = s;
  for (let i = 0; i < MENU_RESTAGE_MAX_ATTEMPTS; i += 1) h = finishRestage(h, M1, h.entries[0]!.seq, false, "boom");
  ok(h.entries[0]!.attempts === MENU_RESTAGE_MAX_ATTEMPTS && h.entries[0]!.lastError === "boom", "failures counted with the reason");
  ok(nextRestage(h)!.manifestId === M2, "held entry is skipped");
  ok(restageStatus(h, T).tone === "warn", "held = warn");
  const again = enqueueRestage(h, M1, null, iso(T + 9000));
  ok(again.entries[0]!.attempts === 0 && again.entries[0]!.lastError === null, "re-approval retries a held entry");
  // a failure on a seq that moved on does not count against the new approval
  const moved = enqueueRestage(s, M1, null, iso(T + 4000));
  ok(finishRestage(moved, M1, seq, false, "x").entries[0]!.attempts === 0, "failure of an older seq does not count");

  // status
  ok(restageStatus(emptyRestage(), T).tone === "ok", "nothing waiting = ok");
  ok(restageStatus(s, T).tone === "busy" && /queued/.test(restageStatus(s, T).text), "waiting, no run = queued");
  ok(/background/.test(restageStatus(leased, T + 1).text), "running text");
  ok(restageStatus(s, T).text.includes("3 approvals"), "counts approvals");
  ok(restageRunNote(2, 1, 1) === "Rebuilt the menu 2 times; 1 failed (retried on the next run); 1 still waiting.", "run note");

  // bound
  let big = emptyRestage();
  for (let i = 0; i < MENU_RESTAGE_MAX_ENTRIES + 5; i += 1) big = enqueueRestage(big, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, null, iso(T + i));
  ok(big.entries.length === MENU_RESTAGE_MAX_ENTRIES, "bounded");
  ok(MENU_RESTAGE_AFTER_BUDGET_MS + MENU_RESTAGE_LEASE_SLACK_MS >= 300_000, "a click's lease outlives the 300 s page");
  ok(MENU_RESTAGE_AFTER_BUDGET_MS + 230_000 < 300_000, "a click run starts its last rebuild early enough to finish inside the 300 s page (slowest measured ~230 s)");
  ok(MENU_RESTAGE_CRON_BUDGET_MS + MENU_RESTAGE_LEASE_SLACK_MS < 780_000, "cron share + one rebuild fits the 800 s route");

  return { passed, failed };
}

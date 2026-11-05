/**
 * src/lib/registers/count-integrity-core.ts — D180 (S3 "blind-count integrity"), PURE.
 *
 * Owner (2026-11-05): "I am making all of my employees manager types … I need
 * to trust my employees, which means we need a system that is very good at
 * beating the fraud triangle." Strategy (approved): "The closer's number stays
 * hidden everywhere until the second count is in. The closer's original count
 * is never overwritten."
 *
 * Audit 2026-11-04 found:
 *   - reconcile (D126) and the D127 correction REPLACED closing_count_minor,
 *     so History showed the second counter's figure under "Closed by <closer>
 *     (blind count)";
 *   - History / EOD / deposit-bag pages showed the closer's count before the
 *     second count existed (a second counter could peek);
 *   - d20a8039's second count was saved 54 s after close, every coin identical.
 *
 * This core holds the rules; the store, pages and migration 0343 apply them.
 *   • countedCashMinor: the count the drawer was RECONCILED on (new column
 *     reconciled_count_minor), falling back to the closer's count for drawers
 *     reconciled before 0343. Every money consumer (books, deposit, EOD) uses
 *     this; closing_count_minor is now only ever the closer's own blind count.
 *   • closerCountVisible: false while a closed drawer waits for its second count.
 *   • second-count "form opened" token: the server signs the moment the blind
 *     form was shown, so "saved 40 s after opening" is a fact, not a guess.
 *   • secondCountFlags: fast / identical-and-fast / entered from the closer's
 *     own login. Flags WARN (shown loud to the owner, audited, kept on the
 *     drawer); they never block — a real fast count by a pro is possible, and a
 *     refused count would just push people to skip the step.
 */
import type { DenomCounts } from "@/lib/registers/cash";

/** A second count saved sooner than this after the form opened (or the drawer closed) is flagged. */
export const FAST_SECOND_COUNT_SECONDS = 120;
/** A token older than this is treated as missing (a form left open overnight proves nothing). */
export const OPENED_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type SecondCountFlag = "fast" | "identical_and_fast" | "closer_login" | "no_timer";

export const DENOM_KEYS: readonly (keyof DenomCounts)[] = [
  "pennies", "nickels", "dimes", "quarters", "half_dollars", "dollar_coins",
  "ones", "twos", "fives", "tens", "twenties", "fifties", "hundreds",
];

/** The cash the drawer really held, as reconciled. Closer's count for pre-0343 drawers. */
export function countedCashMinor(s: {
  reconciled_count_minor?: number | null;
  closing_count_minor: number | null;
}): number | null {
  const r = s.reconciled_count_minor;
  if (typeof r === "number" && Number.isFinite(r)) return r;
  return s.closing_count_minor;
}

/** May anyone see the closer's blind count yet? Not while a closed drawer waits for its second count. */
export function closerCountVisible(s: { status: string; second_count_minor?: number | null }): boolean {
  return !(s.status === "closed" && (s.second_count_minor === null || s.second_count_minor === undefined));
}

/** What a page shows in place of a hidden closer count. */
export const CLOSER_COUNT_HIDDEN_TEXT = "Hidden until second count";

// ── the signed "form opened" token ──────────────────────────────────────────
// Format: `<sessionId>.<openedAtMs>.<hex hmac>`. The hasher is injected (keyed
// HMAC from keyed-hash.ts in production) so this stays pure and testable.

export function signOpenedToken(sessionId: string, openedAtMs: number, hasher: ((s: string) => string) | null): string {
  if (!hasher || !sessionId || !Number.isFinite(openedAtMs)) return "";
  const t = Math.floor(openedAtMs);
  return `${sessionId}.${t}.${hasher(`${sessionId}.${t}`)}`;
}

/** The ms the form was opened, or null when the token is missing, forged, for another drawer, future or stale. */
export function readOpenedToken(
  token: string | null | undefined,
  sessionId: string,
  nowMs: number,
  hasher: ((s: string) => string) | null,
): number | null {
  if (!token || !hasher) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sid, tRaw, mac] = parts;
  if (sid !== sessionId || !/^\d{1,15}$/.test(tRaw) || !/^[0-9a-f]{16,128}$/.test(mac)) return null;
  const expected = hasher(`${sid}.${tRaw}`);
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const t = Number(tRaw);
  if (t > nowMs + 5_000) return null; // from the future
  if (nowMs - t > OPENED_TOKEN_MAX_AGE_MS) return null; // stale
  return t;
}

function denomsEqual(a: DenomCounts, b: DenomCounts): boolean {
  return DENOM_KEYS.every((k) => Math.floor(Number(a[k] ?? 0)) === Math.floor(Number(b[k] ?? 0)));
}
function pieces(d: DenomCounts): number {
  return DENOM_KEYS.reduce((n, k) => n + Math.max(0, Math.floor(Number(d[k] ?? 0))), 0);
}

export type SecondCountFlagInput = {
  /** When the closer closed the drawer (ISO). */
  closedAtIso: string | null;
  /** When the blind form was shown (from a verified token), or null. */
  openedAtMs: number | null;
  /** When the second count is being saved. */
  savedAtMs: number;
  /** The closer's own denomination table, when it was saved. */
  closerDenoms: DenomCounts | null;
  secondDenoms: DenomCounts;
  /** Employee record of the signed-in login that entered the second count. */
  loginEmployeeId: string | null;
  /** Employee who closed the drawer. */
  closerEmployeeId: string | null;
};

export type SecondCountVerdict = { flags: SecondCountFlag[]; seconds: number | null };

export function secondCountFlags(i: SecondCountFlagInput): SecondCountVerdict {
  const flags: SecondCountFlag[] = [];
  let seconds: number | null = null;
  if (i.openedAtMs !== null && Number.isFinite(i.openedAtMs) && i.savedAtMs >= i.openedAtMs) {
    seconds = Math.floor((i.savedAtMs - i.openedAtMs) / 1000);
  }
  const closedMs = i.closedAtIso ? Date.parse(i.closedAtIso) : NaN;
  const sinceClose = Number.isFinite(closedMs) && i.savedAtMs >= closedMs ? Math.floor((i.savedAtMs - closedMs) / 1000) : null;
  // Fast: the form timer says so, or (no timer) the whole thing happened within
  // two minutes of the drawer closing — d20a8039 was 54 s.
  const fast =
    (seconds !== null && seconds < FAST_SECOND_COUNT_SECONDS) ||
    (sinceClose !== null && sinceClose < FAST_SECOND_COUNT_SECONDS);
  if (fast) flags.push("fast");
  if (fast && i.closerDenoms && pieces(i.secondDenoms) > 0 && denomsEqual(i.closerDenoms, i.secondDenoms)) {
    flags.push("identical_and_fast");
  }
  if (i.loginEmployeeId && i.closerEmployeeId && i.loginEmployeeId === i.closerEmployeeId) flags.push("closer_login");
  if (i.openedAtMs === null) flags.push("no_timer");
  return { flags, seconds };
}

/** Flags worth a loud warning (no_timer is a quiet note). */
export function loudFlags(flags: readonly string[] | null | undefined): SecondCountFlag[] {
  return ((flags ?? []) as SecondCountFlag[]).filter((f) => f === "fast" || f === "identical_and_fast" || f === "closer_login");
}

/** Plain-English sentence for one flag, for the owner. */
export function flagSentence(flag: string, seconds: number | null): string {
  switch (flag) {
    case "fast":
      return seconds !== null
        ? `Saved ${seconds} seconds after the count form was opened. A real drawer count takes longer than ${FAST_SECOND_COUNT_SECONDS / 60} minutes.`
        : `Saved within ${FAST_SECOND_COUNT_SECONDS / 60} minutes of the drawer closing. A real drawer count takes longer.`;
    case "identical_and_fast":
      return "Every bill and coin matches the closer's count exactly, and it was fast. It may have been copied, not counted.";
    case "closer_login":
      return "Entered while the closer was signed in to the back office. The second counter should use their own sign-in.";
    case "no_timer":
      return "The count form's timer was missing, so how long the count took is unknown.";
    default:
      return flag;
  }
}

/** Only the known flags survive a read (the column is free text[]). */
export function cleanFlags(raw: unknown): SecondCountFlag[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set<SecondCountFlag>(["fast", "identical_and_fast", "closer_login", "no_timer"]);
  return raw.filter((f): f is SecondCountFlag => typeof f === "string" && ok.has(f as SecondCountFlag));
}

/** Self-test (registered in scripts/compliance/run-pure-selftests.ts). */
export function __runCountIntegrityTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`count-integrity-core: ${m}`);
    passed += 1;
  };
  const Z: DenomCounts = {
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: 0, twos: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
  };
  const D = { ...Z, twenties: 93, quarters: 158 };

  // countedCashMinor
  ok(countedCashMinor({ reconciled_count_minor: 267810, closing_count_minor: 0 }) === 267810, "reconciled wins");
  ok(countedCashMinor({ reconciled_count_minor: null, closing_count_minor: 500 }) === 500, "pre-0343 falls back");
  ok(countedCashMinor({ closing_count_minor: null }) === null, "nothing counted stays null");
  ok(countedCashMinor({ reconciled_count_minor: 0, closing_count_minor: 900 }) === 0, "reconciled 0 is an answer");

  // closerCountVisible
  ok(!closerCountVisible({ status: "closed", second_count_minor: null }), "closed, no second → hidden");
  ok(!closerCountVisible({ status: "closed" }), "closed, unknown second → hidden");
  ok(closerCountVisible({ status: "closed", second_count_minor: 0 }), "second count 0 is in → visible");
  ok(closerCountVisible({ status: "reconciled", second_count_minor: null }), "reconciled legacy → visible");
  ok(closerCountVisible({ status: "open" }), "open has no close count to hide");

  // tokens
  const H = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16).padStart(8, "0").repeat(4);
  };
  const t0 = 1_793_800_000_000;
  const tok = signOpenedToken("sess-1", t0, H);
  ok(readOpenedToken(tok, "sess-1", t0 + 60_000, H) === t0, "valid token reads back");
  ok(readOpenedToken(tok, "sess-2", t0 + 60_000, H) === null, "other drawer refused");
  ok(readOpenedToken(tok.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "sess-1", t0 + 1, H) === null, "forged mac refused");
  ok(readOpenedToken(`sess-1.${t0 - 100_000}.${tok.split(".")[2]}`, "sess-1", t0, H) === null, "moved time refused");
  ok(readOpenedToken(tok, "sess-1", t0 - 60_000, H) === null, "future token refused");
  ok(readOpenedToken(tok, "sess-1", t0 + OPENED_TOKEN_MAX_AGE_MS + 1, H) === null, "stale token refused");
  ok(readOpenedToken("", "sess-1", t0, H) === null && readOpenedToken(tok, "sess-1", t0, null) === null, "missing token / key → null");
  ok(signOpenedToken("sess-1", t0, null) === "", "no key → no token");
  ok(readOpenedToken("a.b", "a", t0, H) === null, "malformed refused");

  // flags
  const closedAt = new Date(t0).toISOString();
  const base: SecondCountFlagInput = {
    closedAtIso: closedAt,
    openedAtMs: t0 + 3_600_000,
    savedAtMs: t0 + 3_600_000 + 6 * 60_000,
    closerDenoms: D,
    secondDenoms: D,
    loginEmployeeId: "mgr",
    closerEmployeeId: "closer",
  };
  ok(secondCountFlags(base).flags.length === 0, "6-minute independent count, identical: no flag");
  ok(secondCountFlags(base).seconds === 360, "seconds recorded");
  const fast = secondCountFlags({ ...base, savedAtMs: base.openedAtMs! + 40_000 });
  ok(fast.flags.includes("fast") && fast.flags.includes("identical_and_fast"), "40 s identical → fast + identical");
  const fastDiff = secondCountFlags({ ...base, savedAtMs: base.openedAtMs! + 40_000, secondDenoms: { ...D, quarters: 157 } });
  ok(fastDiff.flags.includes("fast") && !fastDiff.flags.includes("identical_and_fast"), "fast but different → fast only");
  const d20 = secondCountFlags({ ...base, openedAtMs: null, savedAtMs: t0 + 54_000 });
  ok(d20.flags.includes("fast") && d20.flags.includes("identical_and_fast"), "d20a8039: 54 s after close, identical");
  ok(d20.flags.includes("no_timer") && d20.seconds === null, "no token → no_timer");
  ok(!secondCountFlags({ ...base, openedAtMs: null, savedAtMs: t0 + 600_000 }).flags.includes("fast"), "10 min after close, no timer → not fast");
  ok(secondCountFlags({ ...base, loginEmployeeId: "closer" }).flags.includes("closer_login"), "closer's own login flagged");
  ok(!secondCountFlags({ ...base, loginEmployeeId: null }).flags.includes("closer_login"), "unknown login never flagged");
  ok(!secondCountFlags({ ...base, closerDenoms: null, savedAtMs: base.openedAtMs! + 1000 }).flags.includes("identical_and_fast"), "no closer table → no identical claim");
  ok(!secondCountFlags({ ...base, closerDenoms: Z, secondDenoms: Z, savedAtMs: base.openedAtMs! + 1000 }).flags.includes("identical_and_fast"), "two empty tables are not 'copied'");
  ok(secondCountFlags({ ...base, savedAtMs: base.openedAtMs! + FAST_SECOND_COUNT_SECONDS * 1000 }).flags.length === 0, "exactly 2 minutes is not fast");

  // display helpers
  ok(loudFlags(["no_timer"]).length === 0 && loudFlags(["fast", "no_timer"]).length === 1, "no_timer is quiet");
  ok(flagSentence("fast", 40).includes("40 seconds"), "fast sentence names seconds");
  ok(flagSentence("closer_login", null).includes("own sign-in"), "closer login sentence");
  ok(cleanFlags(["fast", "x", 3, "closer_login"]).join() === "fast,closer_login", "unknown flags dropped");
  ok(cleanFlags(null).length === 0, "null → []");
  ok(CLOSER_COUNT_HIDDEN_TEXT === "Hidden until second count", "hidden text");
  return { passed, failed: 0 };
}

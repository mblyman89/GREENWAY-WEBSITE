/**
 * src/lib/registers/second-count-core.ts  (Fix Phase 2.2 · G-01 · owner D2)
 *
 * PURE rules for the second-person count at till close. Zero I/O.
 *
 * The owner (D2, 00-OWNER-REQUEST-VERBATIM.md): "Q2- close only, and it can
 * be any second employee. It doesn't need to be a lead or manager."
 *
 * The rules this module holds:
 *   1. A close needs a second count by a DIFFERENT employee (any job role).
 *      The server checks it (here, then the 0314 database check as a
 *      backstop); the screen is only a convenience.
 *   2. Both counts are kept. Over / short still uses the CLOSER's count.
 *   3. If the two counts differ, the difference is shown as a WARNING.
 *      Nothing is blocked: the owner has not said a mismatch should block
 *      (05-GAP-REGISTER G-01 requirement 2), so the default is warn only.
 *   4. Count-in has no second count (D2 says close only).
 */

/** PIN throttle scope for the back-office close form (one shared pad). */
export const BACKOFFICE_TILL_THROTTLE_SCOPE = "backoffice-till";

/** Refusal text when the closer types their own PIN as the second counter. */
export const SAME_PERSON_ERROR =
  "The second count must be done by a different employee. Hand the count to someone else and have them enter their own PIN.";

/** Refusal text when the back-office close names no closer. */
export const CLOSER_REQUIRED_ERROR =
  "Pick who counted the drawer (Counted by) so the second count can be checked against them.";

export type SecondCountCheck = { ok: true } | { ok: false; error: string };

/**
 * Rule 1: the second counter must be a real employee and not the closer.
 * `closerId` null means nobody was named as the closer; the second count
 * cannot be checked against nobody, so that is refused too.
 */
export function checkSecondCounter(closerId: string | null | undefined, secondId: string | null | undefined): SecondCountCheck {
  if (!closerId) return { ok: false, error: CLOSER_REQUIRED_ERROR };
  if (!secondId) return { ok: false, error: "The second employee's PIN did not match an active employee." };
  if (closerId === secondId) return { ok: false, error: SAME_PERSON_ERROR };
  return { ok: true };
}

export type SecondCountState =
  /** Closed before migration 0314: no second count was asked for. */
  | "none"
  | "match"
  /** The second person counted MORE than the closer. */
  | "second_higher"
  /** The second person counted LESS than the closer. */
  | "second_lower";

export type SecondCountCompare = {
  state: SecondCountState;
  /** second − closer, cents. 0 when they match or there is no second count. */
  diffMinor: number;
};

/** Rule 3: compare the two counts. Never decides anything; it only describes. */
export function compareCounts(closerMinor: number | null | undefined, secondMinor: number | null | undefined): SecondCountCompare {
  if (secondMinor == null || closerMinor == null) return { state: "none", diffMinor: 0 };
  const diff = secondMinor - closerMinor;
  if (diff === 0) return { state: "match", diffMinor: 0 };
  return { state: diff > 0 ? "second_higher" : "second_lower", diffMinor: diff };
}

function dollars(minor: number): string {
  const abs = Math.abs(minor);
  return `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** One plain sentence for the reconcile card, the till summary and the register. */
export function secondCountSentence(cmp: SecondCountCompare): string {
  switch (cmp.state) {
    case "none":
      return "No second count (closed before the second-count rule).";
    case "match":
      return "Both counts agree.";
    case "second_higher":
      return `The counts differ by ${dollars(cmp.diffMinor)}: the second person counted ${dollars(cmp.diffMinor)} more. Over / short uses the closer's count.`;
    case "second_lower":
      return `The counts differ by ${dollars(cmp.diffMinor)}: the second person counted ${dollars(cmp.diffMinor)} less. Over / short uses the closer's count.`;
  }
}

/**
 * Turn a PostgREST error from the close update into plain words. A missing
 * 0314 column must not surface as a raw schema message.
 */
export function closeErrorMessage(raw: string | null | undefined): string {
  const msg = String(raw ?? "");
  if (/second_count|second_counted/i.test(msg)) {
    return "The second count cannot be saved yet: database migration 0314 has not been applied. Nothing was changed.";
  }
  if (/drawer_sessions_second_not_closer/i.test(msg)) return SAME_PERSON_ERROR;
  return msg || "Close failed.";
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runSecondCountCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`second-count-core FAIL: ${msg}`);
    }
  };

  // checkSecondCounter
  ok(checkSecondCounter("a", "b").ok, "different employees pass");
  const same = checkSecondCounter("a", "a");
  ok(!same.ok && same.error === SAME_PERSON_ERROR, "the closer cannot be their own second counter");
  const noCloser = checkSecondCounter(null, "b");
  ok(!noCloser.ok && noCloser.error === CLOSER_REQUIRED_ERROR, "no closer named is refused");
  ok(!checkSecondCounter("", "b").ok, "blank closer is refused");
  ok(!checkSecondCounter("a", null).ok, "no second employee is refused");
  ok(!checkSecondCounter("a", "").ok, "blank second employee is refused");

  // compareCounts
  ok(compareCounts(10000, 10000).state === "match", "equal counts match");
  ok(compareCounts(10000, 10000).diffMinor === 0, "match has zero diff");
  const hi = compareCounts(10000, 10500);
  ok(hi.state === "second_higher" && hi.diffMinor === 500, "second higher by $5");
  const lo = compareCounts(10000, 9925);
  ok(lo.state === "second_lower" && lo.diffMinor === -75, "second lower by 75 cents");
  ok(compareCounts(10000, null).state === "none", "no second count is none");
  ok(compareCounts(null, 100).state === "none", "no closer count is none");
  ok(compareCounts(0, 0).state === "match", "an all-dropped empty drawer can match at zero");

  // secondCountSentence
  ok(secondCountSentence({ state: "match", diffMinor: 0 }) === "Both counts agree.", "match sentence");
  ok(secondCountSentence(hi).includes("$5.00 more"), "higher sentence names the amount");
  ok(secondCountSentence(lo).includes("$0.75 less"), "lower sentence uses the absolute amount");
  ok(secondCountSentence(lo).includes("closer's count"), "sentence says which count is used");
  ok(secondCountSentence({ state: "none", diffMinor: 0 }).startsWith("No second count"), "legacy sentence");
  ok(secondCountSentence(compareCounts(0, 123456)).includes("$1,234.56"), "thousands separator");

  // closeErrorMessage
  ok(closeErrorMessage("column \"second_count_minor\" does not exist").includes("0314"), "missing column names the migration");
  ok(closeErrorMessage("Could not find the 'second_counted_by' column").includes("Nothing was changed"), "missing column says nothing changed");
  ok(closeErrorMessage("violates check constraint \"drawer_sessions_second_not_closer\"") === SAME_PERSON_ERROR, "db backstop maps to plain words");
  ok(closeErrorMessage("boom") === "boom", "other errors pass through");
  ok(closeErrorMessage(null) === "Close failed.", "empty error gets a default");

  ok(BACKOFFICE_TILL_THROTTLE_SCOPE === "backoffice-till", "throttle scope key");

  if (failed === 0) console.log(`second-count-core: PASSED ${passed} assertions`);
  return { passed, failed };
}

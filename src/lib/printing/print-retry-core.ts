/**
 * src/lib/printing/print-retry-core.ts
 *
 * PURE retry-cap policy for the CloudPRNT receipt queue (GW-026).
 *
 * Background: claimNextJob re-claims any stale `printing` job (claimed > 2 min
 * ago with no confirmation) so a dropped confirmation can't strand the queue.
 * That is good design, but before this module there was NO upper bound: a
 * poison job (e.g. a payload the printer rejects every time) was re-claimed
 * every 2 minutes forever, and because the queue serves the OLDEST job first,
 * it sat at the head of the line blocking every newer receipt behind it.
 *
 * Policy (all decisions live here so they are testable without a database):
 *  - A job gets at most MAX_PRINT_ATTEMPTS claims. `attempts` is incremented
 *    on every claim, so when a candidate ALREADY shows attempts >=
 *    MAX_PRINT_ATTEMPTS it has used up all its tries and must be marked
 *    `failed` (with a human-readable error_note) instead of re-claimed.
 *  - One printer poll may fail-and-skip at most MAX_FAILS_PER_CLAIM poisoned
 *    jobs while hunting for a printable one, so a pathological backlog can
 *    never spin a request forever.
 *
 * No imports; embedded self-tests follow the repo's pure-core pattern.
 */

/** Maximum print attempts (claims) before a job is marked `failed`. */
export const MAX_PRINT_ATTEMPTS = 5;

/**
 * Upper bound on how many over-cap jobs a single claim pass will mark failed
 * while searching for a printable job (guards against unbounded loops).
 */
export const MAX_FAILS_PER_CLAIM = 10;

/**
 * True when a candidate job has already used all of its print attempts and
 * must be marked `failed` instead of being claimed again. Non-finite or
 * negative counts (defensive: bad data) never trip the cap.
 */
export function hasExhaustedPrintAttempts(attempts: number): boolean {
  return Number.isFinite(attempts) && attempts >= MAX_PRINT_ATTEMPTS;
}

/** Human-readable error_note written when the retry cap fails a job. */
export function retryCapNote(attempts: number): string {
  const n = Number.isFinite(attempts) && attempts > 0 ? attempts : MAX_PRINT_ATTEMPTS;
  return `Gave up after ${n} print attempts \u2014 the printer never confirmed this job. Fix the printer (paper, lid, cutter, network), then re-queue or cancel this receipt.`;
}

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runPrintRetryCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`print-retry-core self-test failed: ${name}`);
  };

  // Pinned policy values — changing these is a deliberate policy decision.
  ok("cap is 5 attempts", MAX_PRINT_ATTEMPTS === 5);
  ok("fail-sweep bound is 10 per claim", MAX_FAILS_PER_CLAIM === 10);

  // Below the cap: keep retrying.
  ok("0 attempts -> retry", hasExhaustedPrintAttempts(0) === false);
  ok("1 attempt -> retry", hasExhaustedPrintAttempts(1) === false);
  ok("4 attempts -> retry (last allowed claim already made)", hasExhaustedPrintAttempts(4) === false);

  // At/over the cap: fail.
  ok("5 attempts -> exhausted", hasExhaustedPrintAttempts(5) === true);
  ok("6 attempts -> exhausted", hasExhaustedPrintAttempts(6) === true);
  ok("999 attempts -> exhausted", hasExhaustedPrintAttempts(999) === true);

  // Defensive: bad data never trips the cap (and never crashes).
  ok("NaN -> not exhausted", hasExhaustedPrintAttempts(Number.NaN) === false);
  ok("Infinity -> not exhausted", hasExhaustedPrintAttempts(Number.POSITIVE_INFINITY) === false);
  ok("negative -> not exhausted", hasExhaustedPrintAttempts(-3) === false);

  // Error note is human-readable and carries the real count.
  ok("note names the attempt count", retryCapNote(5).includes("after 5 print attempts"));
  ok("note carries larger counts too", retryCapNote(7).includes("after 7 print attempts"));
  ok("note tells staff what to do", retryCapNote(5).toLowerCase().includes("re-queue or cancel"));
  ok("bad count falls back to the cap", retryCapNote(Number.NaN).includes(`after ${MAX_PRINT_ATTEMPTS} print attempts`));
  ok("zero count falls back to the cap", retryCapNote(0).includes(`after ${MAX_PRINT_ATTEMPTS} print attempts`));
}

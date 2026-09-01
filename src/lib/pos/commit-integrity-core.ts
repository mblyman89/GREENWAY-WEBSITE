/**
 * src/lib/pos/commit-integrity-core.ts  (SLICE 4A)
 *
 * PURE evidence-integrity check for the publish commit gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * `import-commit-core.ts` answers "does the arithmetic balance?" -- but it
 * computes `rowsIn` from the very buckets it is validating:
 *
 *     rowsIn = buckets.totals.items + buckets.totals.standaloneFlags
 *
 * That is SELF-REFERENTIAL. If the database read that produced those items
 * came back short, the gate still balances perfectly -- it simply balances a
 * smaller universe. The equation cannot detect its own missing rows.
 *
 * Two concrete ways that bites (both verified in the live code, not assumed):
 *
 *   1. TRUNCATION. PostgREST caps a response at `db.max_rows` (1,000) and says
 *      nothing. Before SLICE 3 the item read was unpaged, so a 4,179-product
 *      import presented 1,000 rows to the gate and reconciled cleanly.
 *
 *   2. FAIL-OPEN ON EMPTY. `getVersionItems()` returns `[]` when a read fails
 *      (correct for the storefront: show nothing rather than a wrong price).
 *      Fed to the gate, `[]` becomes `rowsIn = 0`, and a zero-row import is
 *      "trivially balanced" -- so a total read failure reads as PERMISSION TO
 *      PUBLISH. The safe behaviour for the menu is the dangerous behaviour
 *      here.
 *
 * THE FIX: CORROBORATION, NOT ARITHMETIC
 * --------------------------------------
 * An invariant that reasons over one source can never catch that source being
 * wrong. So this module compares INDEPENDENT WITNESSES to the same fact --
 * "how many staged items does this version really have?":
 *
 *   observedItems     the paged read the gate is about to reason over
 *   recordedItemCount `menu_versions.item_count`, written by the PARSER from
 *                     the workbook (`result.items.length`) before any row was
 *                     read back. Never passes through db.max_rows.
 *   serverItemCount   `count: "exact", head: true` -- Postgres COUNT(*) done
 *                     server-side. Immune to the row cap by construction.
 *
 * Different failure modes, so they cannot all be wrong the same way. When they
 * disagree the honest answer is "I do not trust this evidence", and the gate
 * must refuse rather than publish on a number it cannot corroborate.
 *
 * THE DRIFT THAT IS REAL AND MUST NOT FALSE-ALARM
 * -----------------------------------------------
 * `item_count` is written at import-service.ts step 4, and step 6b then
 * appends APPROVED onboarding drafts via `injectApprovedDraftsIntoVersion`.
 * That injector DOES increment `item_count` (draft-injection.ts:290) -- but as
 * a read-modify-write inside best-effort error handling: import-service.ts
 * catches and logs an injector failure and continues, by design ("a failure
 * here never fails the import").
 *
 * So the observed row count can legitimately EXCEED the recorded counter when
 * items were inserted but the counter bump did not land. A naive equality test
 * would block publishes for a benign, documented reason. We therefore treat
 * "observed exceeds recorded" as REPORTABLE DRIFT, not as a truncation, while
 * "observed is BELOW a witness" stays a hard refusal -- missing rows are the
 * dangerous direction.
 *
 * PURE: plain data in, plain data out. No fs, no network, no Supabase. Self
 * tests run in the compliance pure-runner on every PR.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommitEvidenceInput = {
  /**
   * Number of staged item rows the gate actually received from the paged read.
   * This is the number `rowsIn` is built from.
   */
  observedItems: number;
  /**
   * `menu_versions.item_count` -- the parser's own tally, recorded at stage
   * time and incremented by draft injection. Uncapped and independent of the
   * read path. `null` when the caller could not read it (its absence is itself
   * untrustworthy, because it means a witness is missing).
   */
  recordedItemCount?: number | null;
  /**
   * Server-side `count: "exact"` of menu_items for this version. Immune to
   * db.max_rows. Optional: SLICE 4B supplies it. `null`/undefined simply means
   * "this witness was not available", never "zero".
   */
  serverItemCount?: number | null;
  /**
   * True when a read that feeds the gate reported an error. An explicit
   * failure signal outranks every count: we do not publish on data we know is
   * incomplete, even if the numbers happen to line up.
   */
  readFailed?: boolean;
  /**
   * Number of fact-review rows read. Present so a read failure on the reviews
   * list (which is what marks rows DECIDED) can be surfaced the same way.
   */
  observedReviews?: number;
  /** True when the fact-review read reported an error. */
  reviewsReadFailed?: boolean;
};

export type CommitEvidenceVerdict = {
  /** True only when every available witness corroborates the observed rows. */
  trustworthy: boolean;
  /**
   * Machine-readable reason. `null` when trustworthy.
   *   read_failed        -- a feeding read errored
   *   missing_witness    -- no independent witness available to corroborate
   *   empty_but_expected -- observed 0 while a witness says there are rows
   *   short_read         -- observed fewer rows than a witness reports
   */
  reason:
    | null
    | "read_failed"
    | "missing_witness"
    | "empty_but_expected"
    | "short_read";
  /** Highest row count any independent witness reported. */
  expectedItems: number | null;
  /** Rows the read actually produced (echoed for the audit trail). */
  observedItems: number;
  /**
   * Benign, documented overage (observed > recorded) attributable to draft
   * injection whose counter bump did not land. Reported, never fatal.
   */
  driftAbove: number;
  /** Plain-English sentence for the owner. Never blank. */
  message: string;
};

// ---------------------------------------------------------------------------
// Evidence integrity
// ---------------------------------------------------------------------------

/** Treat only real, finite, non-negative integers as usable witnesses. */
function usableWitness(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function evaluateEvidenceIntegrity(
  input: CommitEvidenceInput,
): CommitEvidenceVerdict {
  const observedItems = usableWitness(input.observedItems) ? input.observedItems : 0;

  const witnesses: number[] = [];
  if (usableWitness(input.recordedItemCount)) witnesses.push(input.recordedItemCount);
  if (usableWitness(input.serverItemCount)) witnesses.push(input.serverItemCount);

  const expectedItems = witnesses.length > 0 ? Math.max(...witnesses) : null;
  const recorded = usableWitness(input.recordedItemCount) ? input.recordedItemCount : null;
  const driftAbove = recorded !== null && observedItems > recorded ? observedItems - recorded : 0;

  const base = {
    expectedItems,
    observedItems,
    driftAbove,
  };

  // 1. An explicit read failure outranks every count. Numbers that happen to
  //    agree after a failed read are a coincidence, not corroboration.
  if (input.readFailed === true) {
    return {
      ...base,
      trustworthy: false,
      reason: "read_failed",
      message:
        "Cannot publish: reading this version's staged items failed, so the publish check " +
        "cannot see the full catalog. Nothing was published. Try again, and if it keeps " +
        "failing report it -- publishing on a partial read is how a truncated menu goes live.",
    };
  }
  if (input.reviewsReadFailed === true) {
    return {
      ...base,
      trustworthy: false,
      reason: "read_failed",
      message:
        "Cannot publish: reading the fact-review decisions failed. Those rows are what record " +
        "your approvals, so without them this check cannot tell a reviewed import from an " +
        "unreviewed one. Nothing was published.",
    };
  }

  // 2. No independent witness => nothing corroborates the read. We refuse
  //    rather than trust a single self-reported number.
  if (expectedItems === null) {
    return {
      ...base,
      trustworthy: false,
      reason: "missing_witness",
      message:
        "Cannot publish: this version's recorded item count is unavailable, so there is no " +
        "independent way to confirm every product was read. Nothing was published. Re-stage " +
        "the import and try again.",
    };
  }

  // 3. The fail-open case: zero rows observed while a witness insists rows
  //    exist. Previously this read as "empty import, trivially balanced".
  if (observedItems === 0 && expectedItems > 0) {
    return {
      ...base,
      trustworthy: false,
      reason: "empty_but_expected",
      message:
        `Cannot publish: this version should contain ${expectedItems} product(s) but the ` +
        "publish check received none. That points at a failed read rather than an empty " +
        "import, so nothing was published.",
    };
  }

  // 4. Short read -- the truncation this whole line of work exists to stop.
  if (observedItems < expectedItems) {
    const missing = expectedItems - observedItems;
    return {
      ...base,
      trustworthy: false,
      reason: "short_read",
      message:
        `Cannot publish: this version records ${expectedItems} product(s) but only ` +
        `${observedItems} were read back (${missing} missing). Publishing now would put an ` +
        "incomplete menu in front of customers, so nothing was published.",
    };
  }

  // 5. Trustworthy. Note benign draft-injection drift if present.
  if (driftAbove > 0) {
    return {
      ...base,
      trustworthy: true,
      reason: null,
      message:
        `Evidence check passed: ${observedItems} product(s) read, ${expectedItems} recorded ` +
        `(${driftAbove} more than recorded -- approved drafts added after the count was ` +
        "written; nothing is missing).",
    };
  }

  if (expectedItems === 0 && observedItems === 0) {
    return {
      ...base,
      trustworthy: true,
      reason: null,
      message: "Evidence check passed: this version genuinely contains no products.",
    };
  }

  return {
    ...base,
    trustworthy: true,
    reason: null,
    message: `Evidence check passed: all ${observedItems} recorded product(s) were read back.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCommitIntegrityCoreTests(): void {
  let failures = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      failures += 1;
      console.error(`  COMMIT-INTEGRITY FAIL: ${msg}`);
    }
  };

  // -- The headline regression: truncated read must be caught -----------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 1000, recordedItemCount: 4179 });
    ok(v.trustworthy === false, "1,000 read vs 4,179 recorded is refused");
    ok(v.reason === "short_read", "truncation is reported as short_read");
    ok(v.message.includes("3179 missing"), "refusal states exactly how many are missing");
  }

  // -- The fail-open: empty read while the version says it has rows -----------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 0, recordedItemCount: 4179 });
    ok(v.trustworthy === false, "zero rows against a non-zero witness is refused");
    ok(v.reason === "empty_but_expected", "empty-but-expected is its own reason");
  }

  // -- A genuinely empty import is still allowed ------------------------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 0, recordedItemCount: 0 });
    ok(v.trustworthy === true, "a truly empty version stays publishable");
    ok(v.reason === null, "no reason recorded when trustworthy");
  }

  // -- Exact agreement --------------------------------------------------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 4179, recordedItemCount: 4179 });
    ok(v.trustworthy === true, "matching counts are trustworthy");
    ok(v.expectedItems === 4179, "expected count echoed for the audit trail");
  }

  // -- Explicit read failure outranks agreeing numbers ------------------------
  {
    const v = evaluateEvidenceIntegrity({
      observedItems: 10,
      recordedItemCount: 10,
      readFailed: true,
    });
    ok(v.trustworthy === false, "an explicit read failure refuses even when counts agree");
    ok(v.reason === "read_failed", "read failure is reported as read_failed");
  }

  // -- Fact-review read failure is surfaced too -------------------------------
  {
    const v = evaluateEvidenceIntegrity({
      observedItems: 10,
      recordedItemCount: 10,
      reviewsReadFailed: true,
    });
    ok(v.trustworthy === false, "a failed fact-review read refuses the publish");
    ok(v.reason === "read_failed", "review read failure reported as read_failed");
    ok(v.message.includes("fact-review"), "message names the fact-review read");
  }

  // -- No witness at all ------------------------------------------------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 500, recordedItemCount: null });
    ok(v.trustworthy === false, "an uncorroborated read is refused");
    ok(v.reason === "missing_witness", "missing witness is its own reason");
    ok(v.expectedItems === null, "no expected count when no witness exists");
  }

  // -- Draft-injection drift is benign, reported, and NOT fatal ---------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 4185, recordedItemCount: 4179 });
    ok(v.trustworthy === true, "observed above recorded is tolerated (draft injection)");
    ok(v.driftAbove === 6, "drift amount is reported");
    ok(v.message.includes("approved drafts"), "drift message explains the benign cause");
  }

  // -- The server COUNT witness --------------------------------------------
  {
    // Recorded counter stale/undercounted, server count tells the truth.
    const v = evaluateEvidenceIntegrity({
      observedItems: 1000,
      recordedItemCount: 1000,
      serverItemCount: 4179,
    });
    ok(v.trustworthy === false, "server count catches truncation the stored counter missed");
    ok(v.expectedItems === 4179, "the strongest witness wins");
  }
  {
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: 4179,
      serverItemCount: 4179,
    });
    ok(v.trustworthy === true, "three agreeing witnesses are trustworthy");
  }
  {
    // Server witness alone is sufficient corroboration.
    const v = evaluateEvidenceIntegrity({
      observedItems: 4179,
      recordedItemCount: null,
      serverItemCount: 4179,
    });
    ok(v.trustworthy === true, "server count alone corroborates the read");
  }

  // -- Junk witnesses are ignored, never trusted ------------------------------
  {
    const v = evaluateEvidenceIntegrity({
      observedItems: 5,
      recordedItemCount: Number.NaN,
      serverItemCount: 5,
    });
    ok(v.trustworthy === true, "NaN witness ignored, valid witness still corroborates");
    ok(v.expectedItems === 5, "NaN never becomes an expected count");
  }
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 5, recordedItemCount: -3 });
    ok(v.reason === "missing_witness", "a negative witness is not a witness");
  }

  // -- Off-by-one truncation is still caught ----------------------------------
  {
    const v = evaluateEvidenceIntegrity({ observedItems: 4178, recordedItemCount: 4179 });
    ok(v.trustworthy === false, "even one missing product refuses the publish");
    ok(v.message.includes("1 missing"), "single-row shortfall is stated precisely");
  }

  // -- Every message is owner-readable ---------------------------------------
  {
    const cases: CommitEvidenceInput[] = [
      { observedItems: 0, recordedItemCount: 10 },
      { observedItems: 1, recordedItemCount: 10 },
      { observedItems: 10, recordedItemCount: 10, readFailed: true },
      { observedItems: 10, recordedItemCount: null },
      { observedItems: 10, recordedItemCount: 10 },
    ];
    for (const c of cases) {
      const v = evaluateEvidenceIntegrity(c);
      ok(v.message.trim().length > 0, "verdict always carries a message");
      ok(!v.message.includes("undefined"), "message never leaks undefined");
      ok(!v.message.includes("NaN"), "message never leaks NaN");
    }
  }

  if (failures > 0) {
    throw new Error(`commit-integrity-core: ${failures} self-test failure(s)`);
  }
}

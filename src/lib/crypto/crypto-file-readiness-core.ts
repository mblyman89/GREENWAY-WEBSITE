/**
 * src/lib/crypto/crypto-file-readiness-core.ts
 *
 * R1-F5b — FILE-READINESS guard-rail engine (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * Implements Michael's "bullet proof, hard blocking" mandate. Before a tax year
 * can be marked "ready to file," this engine checks a fixed set of hard-blocks
 * (bible §6) and refuses the "file-ready" badge while ANY unresolved BLOCKING
 * issue exists. Each issue carries a plain-English explanation and a plain-
 * English fix, so the Tax Center can show Michael exactly what to do.
 *
 * The seven checks (bible §6, IRS-anchored)
 * -----------------------------------------
 *   1. MISSING_BASIS       (blocking) — a disposal with units that have no known
 *                          cost basis. Never silently $0 (FAQ Q76 forces $0 only
 *                          on a documented, acknowledged choice).
 *   2. UNCLASSIFIED        (blocking) — a taxable-looking tx still "needs review".
 *   3. UNMATCHED_TRANSFER  (soft/warning) — a large OUT with no matching IN
 *                          suggests a missing wallet; warn so we don't tax a
 *                          self-move as a sale (FAQ Q81/Q53).
 *   4. NEGATIVE_BALANCE    (blocking) — disposed more than held ⇒ missing
 *                          acquisitions (reconciliation overdraw).
 *   5. METHOD_INCONSISTENCY(blocking) — LIFO/HIFO (Spec-ID) chosen without a
 *                          recorded identification, or method changed after
 *                          filing (FAQ Q82–Q85, Q88; consistency rule).
 *   6. UNPRICED_DISPOSAL   (blocking) — proceeds present but no USD price found;
 *                          block until priced or acknowledged (never $0).
 *   7. YEAR_LOCKED         (informational) — the year is filed/locked; editing
 *                          requires an explicit audited "amend" action.
 *
 * A year is "file-ready" ONLY when there are zero open BLOCKING issues. Warnings
 * do not block on their own but are surfaced. This is the provable-completeness
 * gate — the "golden ticket of supremacy."
 */

// ---------------------------------------------------------------------------
// Check identifiers + severity.
// ---------------------------------------------------------------------------

export type ReadinessCheck =
  | "MISSING_BASIS"
  | "UNCLASSIFIED"
  | "UNMATCHED_TRANSFER"
  | "NEGATIVE_BALANCE"
  | "METHOD_INCONSISTENCY"
  | "UNPRICED_DISPOSAL"
  | "YEAR_LOCKED";

/**
 *   - "blocking" : must be zero for the year to be file-ready.
 *   - "warning"  : surfaced, does NOT block on its own (may indicate a missing
 *                  wallet the user should connect).
 *   - "info"     : purely informational (e.g. a locked, already-filed year).
 */
export type ReadinessSeverity = "blocking" | "warning" | "info";

/** Static definition of each check: severity + plain-English fix template. */
export interface ReadinessCheckDef {
  check: ReadinessCheck;
  severity: ReadinessSeverity;
  title: string;
  /** Plain-English guidance shown to Michael for how to clear it. */
  fix: string;
}

export const READINESS_CHECK_DEFS: readonly ReadinessCheckDef[] = [
  {
    check: "MISSING_BASIS",
    severity: "blocking",
    title: "Missing cost basis on a sale",
    fix: "Connect the wallet these coins came from (or match the transfer) so we can carry the original cost. If you truly have no records, you can accept a $0 basis on the record — but only as a documented choice, never a silent guess.",
  },
  {
    check: "UNCLASSIFIED",
    severity: "blocking",
    title: "A taxable-looking transaction still needs review",
    fix: "Open the Classify screen and confirm what each flagged transaction is (a sale, income, a transfer, etc.) so it's counted correctly.",
  },
  {
    check: "UNMATCHED_TRANSFER",
    severity: "warning",
    title: "A transfer out with no matching transfer in",
    fix: "You may be missing a wallet. Connect it so we don't tax a move between your own wallets as a sale. If it really was a sale, classify it as one.",
  },
  {
    check: "NEGATIVE_BALANCE",
    severity: "blocking",
    title: "You sold more of a coin than the records show you held",
    fix: "There's a missing purchase or transfer-in somewhere. Add the missing acquisition (or connect the source wallet) so the balance can't go negative.",
  },
  {
    check: "METHOD_INCONSISTENCY",
    severity: "blocking",
    title: "The chosen method isn't backed by a recorded identification",
    fix: "LIFO or HIFO only count if you had a recorded standing order identifying the lots at the time of sale. Either switch this year to FIFO (always allowed) or attach the recorded identification. A year's method also can't change after it's filed.",
  },
  {
    check: "UNPRICED_DISPOSAL",
    severity: "blocking",
    title: "A sale has proceeds but no USD price",
    fix: "We need a dollar value for this sale. Let the pricing step fill it in, or enter/acknowledge a value — we will never just use $0.",
  },
  {
    check: "YEAR_LOCKED",
    severity: "info",
    title: "This year is filed and locked",
    fix: "This year has been filed. To change anything, use the audited 'amend' action — it keeps a record of what changed and why.",
  },
] as const;

const DEF_BY_CHECK: ReadonlyMap<ReadinessCheck, ReadinessCheckDef> = new Map(
  READINESS_CHECK_DEFS.map((d) => [d.check, d]),
);

export function readinessCheckDef(check: ReadinessCheck): ReadinessCheckDef {
  const d = DEF_BY_CHECK.get(check);
  if (!d) throw new Error(`crypto-file-readiness-core: unknown check "${check}"`);
  return d;
}

// ---------------------------------------------------------------------------
// Inputs — the observed counts/facts for a year (the caller gathers these from
// the R1-C ledger, R1-E review queue, R1-F1/2 transfer matcher, pricing, etc.).
// ---------------------------------------------------------------------------

export interface FileReadinessInput {
  taxYear: number;
  /** Number of disposals with unmatched (missing-basis) units. */
  missingBasisCount: number;
  /**
   * Of those, how many have an on-record zero-basis acknowledgment (they no
   * longer block). Must be <= missingBasisCount.
   */
  acknowledgedZeroBasisCount?: number;
  /** Taxable-looking transactions still in the "needs review" queue. */
  unclassifiedCount: number;
  /** Large OUT transfers with no matching IN (possible missing wallet). */
  unmatchedTransferCount: number;
  /** Assets whose reconciled balance went negative (overdraw). */
  negativeBalanceCount: number;
  /** Disposals with proceeds but no USD price. */
  unpricedDisposalCount: number;
  /**
   * Number of acknowledgments recorded for unpriced disposals (they no longer
   * block). Must be <= unpricedDisposalCount.
   */
  acknowledgedUnpricedCount?: number;
  /** The method chosen for this year. */
  method: "fifo" | "lifo" | "hifo" | "specid";
  /**
   * True when a contemporaneous Spec-ID / standing-order identification is on
   * record for this year (required to defend LIFO/HIFO/specid).
   */
  hasRecordedSpecId?: boolean;
  /** True when this year has already been filed and is locked. */
  yearFiled?: boolean;
}

/** One concrete open issue for a year. */
export interface ReadinessIssue {
  check: ReadinessCheck;
  severity: ReadinessSeverity;
  title: string;
  fix: string;
  /** How many items triggered this check (0 for pure info like YEAR_LOCKED). */
  count: number;
}

export interface FileReadinessResult {
  taxYear: number;
  issues: ReadinessIssue[];
  blockingCount: number;
  warningCount: number;
  /** True ONLY when there are zero open BLOCKING issues. */
  fileReady: boolean;
  yearLocked: boolean;
}

// ---------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------

function nonNegInt(v: number | undefined, what: string): number {
  const n = v ?? 0;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`crypto-file-readiness-core: ${what} must be a non-negative integer, got ${String(v)}`);
  }
  return n;
}

function issueFrom(check: ReadinessCheck, count: number): ReadinessIssue {
  const d = readinessCheckDef(check);
  return { check, severity: d.severity, title: d.title, fix: d.fix, count };
}

/**
 * Evaluate a year's file-readiness. Deterministic and side-effect-free. A year
 * is file-ready only when NO blocking issue remains open. Acknowledged missing-
 * basis and acknowledged unpriced items are netted out (documented choices).
 */
export function evaluateFileReadiness(input: FileReadinessInput): FileReadinessResult {
  const missingBasis = nonNegInt(input.missingBasisCount, "missingBasisCount");
  const ackZero = nonNegInt(input.acknowledgedZeroBasisCount, "acknowledgedZeroBasisCount");
  const unclassified = nonNegInt(input.unclassifiedCount, "unclassifiedCount");
  const unmatched = nonNegInt(input.unmatchedTransferCount, "unmatchedTransferCount");
  const negBalance = nonNegInt(input.negativeBalanceCount, "negativeBalanceCount");
  const unpriced = nonNegInt(input.unpricedDisposalCount, "unpricedDisposalCount");
  const ackUnpriced = nonNegInt(input.acknowledgedUnpricedCount, "acknowledgedUnpricedCount");

  if (ackZero > missingBasis) {
    throw new Error("crypto-file-readiness-core: acknowledgedZeroBasisCount exceeds missingBasisCount");
  }
  if (ackUnpriced > unpriced) {
    throw new Error("crypto-file-readiness-core: acknowledgedUnpricedCount exceeds unpricedDisposalCount");
  }

  const openMissingBasis = missingBasis - ackZero;
  const openUnpriced = unpriced - ackUnpriced;

  const issues: ReadinessIssue[] = [];

  if (openMissingBasis > 0) issues.push(issueFrom("MISSING_BASIS", openMissingBasis));
  if (unclassified > 0) issues.push(issueFrom("UNCLASSIFIED", unclassified));
  if (unmatched > 0) issues.push(issueFrom("UNMATCHED_TRANSFER", unmatched));
  if (negBalance > 0) issues.push(issueFrom("NEGATIVE_BALANCE", negBalance));

  // Method inconsistency: LIFO/HIFO/specid without a recorded Spec-ID.
  const needsSpecId = input.method === "lifo" || input.method === "hifo" || input.method === "specid";
  if (needsSpecId && !input.hasRecordedSpecId) {
    issues.push(issueFrom("METHOD_INCONSISTENCY", 1));
  }

  if (openUnpriced > 0) issues.push(issueFrom("UNPRICED_DISPOSAL", openUnpriced));

  const yearLocked = input.yearFiled === true;
  if (yearLocked) issues.push(issueFrom("YEAR_LOCKED", 0));

  let blockingCount = 0;
  let warningCount = 0;
  for (const iss of issues) {
    if (iss.severity === "blocking") blockingCount += 1;
    else if (iss.severity === "warning") warningCount += 1;
  }

  return {
    taxYear: input.taxYear,
    issues,
    blockingCount,
    warningCount,
    fileReady: blockingCount === 0,
    yearLocked,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-file-readiness-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function baseInput(over: Partial<FileReadinessInput>): FileReadinessInput {
  return {
    taxYear: over.taxYear ?? 2024,
    missingBasisCount: over.missingBasisCount ?? 0,
    acknowledgedZeroBasisCount: over.acknowledgedZeroBasisCount,
    unclassifiedCount: over.unclassifiedCount ?? 0,
    unmatchedTransferCount: over.unmatchedTransferCount ?? 0,
    negativeBalanceCount: over.negativeBalanceCount ?? 0,
    unpricedDisposalCount: over.unpricedDisposalCount ?? 0,
    acknowledgedUnpricedCount: over.acknowledgedUnpricedCount,
    method: over.method ?? "fifo",
    hasRecordedSpecId: over.hasRecordedSpecId,
    yearFiled: over.yearFiled,
  };
}

export function __runCryptoFileReadinessCoreTests(): void {
  // --- all seven check defs resolvable + correct severities ---
  eq(READINESS_CHECK_DEFS.length, 7, "seven checks defined");
  eq(readinessCheckDef("MISSING_BASIS").severity, "blocking", "missing basis blocks");
  eq(readinessCheckDef("UNCLASSIFIED").severity, "blocking", "unclassified blocks");
  eq(readinessCheckDef("UNMATCHED_TRANSFER").severity, "warning", "unmatched transfer warns");
  eq(readinessCheckDef("NEGATIVE_BALANCE").severity, "blocking", "negative balance blocks");
  eq(readinessCheckDef("METHOD_INCONSISTENCY").severity, "blocking", "method inconsistency blocks");
  eq(readinessCheckDef("UNPRICED_DISPOSAL").severity, "blocking", "unpriced blocks");
  eq(readinessCheckDef("YEAR_LOCKED").severity, "info", "year locked is info");

  // --- a clean year is file-ready ---
  const clean = evaluateFileReadiness(baseInput({}));
  eq(clean.fileReady, true, "clean year file-ready");
  eq(clean.blockingCount, 0, "no blocks");
  eq(clean.issues.length, 0, "no issues");

  // --- missing basis blocks; acknowledgment clears it ---
  const mb = evaluateFileReadiness(baseInput({ missingBasisCount: 3 }));
  eq(mb.fileReady, false, "missing basis blocks filing");
  eq(mb.blockingCount, 1, "one blocking issue");
  eq(mb.issues[0].check, "MISSING_BASIS", "issue is missing basis");
  eq(mb.issues[0].count, 3, "counts 3 disposals");

  const mbAck = evaluateFileReadiness(baseInput({ missingBasisCount: 3, acknowledgedZeroBasisCount: 3 }));
  eq(mbAck.fileReady, true, "acknowledged zero-basis clears the block");

  const mbPartial = evaluateFileReadiness(baseInput({ missingBasisCount: 3, acknowledgedZeroBasisCount: 1 }));
  eq(mbPartial.fileReady, false, "partial acknowledgment still blocks");
  eq(mbPartial.issues[0].count, 2, "two still open");

  // --- unclassified blocks ---
  const uc = evaluateFileReadiness(baseInput({ unclassifiedCount: 5 }));
  eq(uc.fileReady, false, "unclassified blocks");
  eq(uc.issues[0].check, "UNCLASSIFIED", "unclassified issue");

  // --- unmatched transfer WARNS but does not block on its own ---
  const ut = evaluateFileReadiness(baseInput({ unmatchedTransferCount: 2 }));
  eq(ut.fileReady, true, "warning alone does not block filing");
  eq(ut.warningCount, 1, "one warning surfaced");
  eq(ut.blockingCount, 0, "no blocking from a warning");

  // --- negative balance blocks ---
  const nb = evaluateFileReadiness(baseInput({ negativeBalanceCount: 1 }));
  eq(nb.fileReady, false, "negative balance blocks");

  // --- method inconsistency: LIFO without recorded Spec-ID blocks ---
  const lifoNoSpec = evaluateFileReadiness(baseInput({ method: "lifo" }));
  eq(lifoNoSpec.fileReady, false, "LIFO without Spec-ID blocks");
  eq(lifoNoSpec.issues[0].check, "METHOD_INCONSISTENCY", "method inconsistency issue");

  const lifoWithSpec = evaluateFileReadiness(baseInput({ method: "lifo", hasRecordedSpecId: true }));
  eq(lifoWithSpec.fileReady, true, "LIFO with recorded Spec-ID is OK");

  const hifoNoSpec = evaluateFileReadiness(baseInput({ method: "hifo" }));
  eq(hifoNoSpec.fileReady, false, "HIFO without Spec-ID blocks");

  const fifoAlwaysOk = evaluateFileReadiness(baseInput({ method: "fifo" }));
  eq(fifoAlwaysOk.fileReady, true, "FIFO never needs Spec-ID");

  const specidNoRecord = evaluateFileReadiness(baseInput({ method: "specid" }));
  eq(specidNoRecord.fileReady, false, "specid without record blocks");

  // --- unpriced disposal blocks; acknowledgment clears ---
  const up = evaluateFileReadiness(baseInput({ unpricedDisposalCount: 2 }));
  eq(up.fileReady, false, "unpriced blocks");
  const upAck = evaluateFileReadiness(baseInput({ unpricedDisposalCount: 2, acknowledgedUnpricedCount: 2 }));
  eq(upAck.fileReady, true, "acknowledged unpriced clears");

  // --- year locked is info, does not block a clean year ---
  const locked = evaluateFileReadiness(baseInput({ yearFiled: true }));
  eq(locked.yearLocked, true, "year locked flag set");
  eq(locked.fileReady, true, "a locked clean year is still 'ready' (nothing blocking)");
  eq(locked.issues.some((i) => i.check === "YEAR_LOCKED"), true, "year-locked surfaced");

  // --- multiple blocks stack and all surface ---
  const many = evaluateFileReadiness(
    baseInput({ missingBasisCount: 1, unclassifiedCount: 1, negativeBalanceCount: 1, unpricedDisposalCount: 1, method: "hifo" }),
  );
  eq(many.blockingCount, 5, "five blocking issues stack");
  eq(many.fileReady, false, "not file-ready with multiple blocks");

  // --- validation: over-acknowledgment rejected ---
  let threw = false;
  try {
    evaluateFileReadiness(baseInput({ missingBasisCount: 1, acknowledgedZeroBasisCount: 2 }));
  } catch {
    threw = true;
  }
  eq(threw, true, "over-acknowledged missing basis rejected");

  let threwNeg = false;
  try {
    evaluateFileReadiness(baseInput({ unclassifiedCount: -1 }));
  } catch {
    threwNeg = true;
  }
  eq(threwNeg, true, "negative count rejected");

  console.log("crypto-file-readiness-core self-tests: all passed");
}

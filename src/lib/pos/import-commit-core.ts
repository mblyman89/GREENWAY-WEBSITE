/**
 * src/lib/pos/import-commit-core.ts  (PROGRAM 3 / SLICE 58)
 *
 * PURE commit gate + reconciliation arithmetic for the golden-record import
 * (docs/data-governance.md Rules 3.1-3.3). Publishing is the moment staged
 * data becomes the live catalog, so this module answers two questions from
 * the SLICE 57 dry-run buckets:
 *
 *   1. MAY we commit? (evaluateCommitGate)
 *      Rule 3.1: never auto-commit uncertain data. If ANY fact-review row is
 *      still pending a human decision (approve / fix / reject), the gate
 *      REFUSES with a plain-English message pointing at the Fact Review
 *      screen. The import asks instead of guessing -- an unresolved
 *      cross-check failure can never slip into the live catalog.
 *
 *   2. Does the arithmetic balance? (buildCommitReconciliation)
 *      Rule 3.3: rows in = created + resolved exceptions + documented
 *      rejects. Every staged row and every standalone flag is accounted for
 *      in exactly one of four places:
 *        goingLive        -- auto-accepted rows plus review rows a human
 *                            approved or fixed (they become live catalog).
 *        documentedRejects -- hidden rows (transformer rejects with their
 *                            recorded reason) plus review rows a human
 *                            rejected (mirrored to hidden by the store).
 *        flagsResolved    -- standalone flags (no staged row behind them)
 *                            that a human decided; documented, nothing to
 *                            create.
 *        pending          -- review rows with no decision yet (must be ZERO
 *                            for the gate to open).
 *      `balanced` is a computed invariant, not an assumption -- if the sums
 *      ever disagree the caller refuses to publish and says so.
 *
 * Pure: plain data in, plain data out. No fs, no network, no Supabase. The
 * server publish path (import-service.ts) builds the SLICE 57 buckets from
 * fresh DB reads and feeds them here; self-tests run in the compliance
 * pure-runner on every PR.
 */

import {
  buildFactReviewBuckets,
  type FactReviewBuckets,
  type FactReviewRow,
  type FactReviewItemInput,
  type FactReviewDiagnosticInput,
} from "@/lib/pos/fact-review-core";
import {
  evaluateEvidenceIntegrity,
  type CommitEvidenceInput,
  type CommitEvidenceVerdict,
} from "@/lib/pos/commit-integrity-core";

// ---------------------------------------------------------------------------
// Reconciliation arithmetic (Rule 3.3)
// ---------------------------------------------------------------------------

export type CommitReconciliation = {
  /** Staged rows + standalone flags -- everything that entered the report. */
  rowsIn: number;
  /** Staged menu rows fed into the buckets. */
  stagedItems: number;
  /** Review flags that matched no staged row (synthetic "flag:*" ids). */
  standaloneFlags: number;
  /** Auto-accepted rows (no open flags; going live untouched). */
  autoAccepted: number;
  /** Item-backed review rows a human approved or fixed (going live). */
  reviewApprovedOrFixed: number;
  /** autoAccepted + reviewApprovedOrFixed -- rows the publish creates live. */
  goingLive: number;
  /** Hidden rows -- the transformer's documented rejects. */
  transformerRejected: number;
  /** Item-backed review rows a human rejected (store mirrors them hidden). */
  reviewerRejected: number;
  /** transformerRejected + reviewerRejected. */
  documentedRejects: number;
  /** Standalone flags with a recorded decision (documented; nothing created). */
  flagsResolved: number;
  /** Review rows with NO decision yet -- must be zero to commit. */
  pending: number;
  /** rowsIn === goingLive + documentedRejects + flagsResolved + pending. */
  balanced: boolean;
  /** Plain-English one-liner of the whole equation. */
  summaryLine: string;
};

function isStandalone(row: FactReviewRow): boolean {
  return row.sourceItemId.startsWith("flag:");
}

export function buildCommitReconciliation(buckets: FactReviewBuckets): CommitReconciliation {
  const stagedItems = buckets.totals.items;
  const standaloneFlags = buckets.totals.standaloneFlags;
  const rowsIn = stagedItems + standaloneFlags;

  let reviewApprovedOrFixed = 0;
  let reviewerRejected = 0;
  let flagsResolved = 0;
  let pending = 0;
  for (const row of buckets.needsReview) {
    if (row.resolution === null) {
      pending += 1;
    } else if (isStandalone(row)) {
      // A decided standalone flag is documented -- there is no staged row to
      // create or hide, so it reconciles in its own column.
      flagsResolved += 1;
    } else if (row.resolution === "reject") {
      reviewerRejected += 1;
    } else {
      reviewApprovedOrFixed += 1; // approve | fix
    }
  }

  const autoAccepted = buckets.totals.autoAccepted;
  const transformerRejected = buckets.totals.rejected;
  const goingLive = autoAccepted + reviewApprovedOrFixed;
  const documentedRejects = transformerRejected + reviewerRejected;
  const balanced = rowsIn === goingLive + documentedRejects + flagsResolved + pending;

  const parts = [
    `${goingLive} going live`,
    `${documentedRejects} documented reject(s)`,
    `${flagsResolved} resolved flag(s)`,
  ];
  if (pending > 0) parts.push(`${pending} still pending`);
  const summaryLine = `Reconciled: ${rowsIn} row(s) in = ${parts.join(" + ")}.`;

  return {
    rowsIn,
    stagedItems,
    standaloneFlags,
    autoAccepted,
    reviewApprovedOrFixed,
    goingLive,
    transformerRejected,
    reviewerRejected,
    documentedRejects,
    flagsResolved,
    pending,
    balanced,
    summaryLine,
  };
}

// ---------------------------------------------------------------------------
// Commit gate (Rule 3.1: refuse cross-check failures, ask instead of guess)
// ---------------------------------------------------------------------------

export type CommitGateVerdict = {
  /** True only when nothing is pending AND the arithmetic balances. */
  ready: boolean;
  reconciliation: CommitReconciliation;
  /** Plain-English verdict -- the exact refusal or the balanced equation. */
  message: string;
  /**
   * SLICE 4A: the evidence-integrity verdict, when the caller supplied
   * independent witnesses. `null` when no evidence was provided (pure
   * arithmetic callers and the existing self-tests).
   */
  evidence?: CommitEvidenceVerdict | null;
  /**
   * R14a: true when the ONLY thing keeping the gate shut is pending
   * fact-review rows -- the evidence is trustworthy (or not supplied) and the
   * Rule 3.3 arithmetic balances. This is the one refusal a human may choose
   * to publish over ("publish now, fix after"). A short read, a failed read or
   * an imbalance is never overridable.
   */
  blockedOnlyByPending: boolean;
  /**
   * R14a: how many pending rows the caller explicitly chose to publish with
   * (0 unless `acknowledgedPendingCount` was passed AND covers the fresh count). Those rows stay
   * PENDING -- nothing is approved on anyone's behalf.
   */
  openReviewsAcknowledged: number;
};

/**
 * R14a: options for evaluateCommitGate.
 *
 * `acknowledgedPendingCount` is the owner's explicit, attributed "publish now, fix
 * after" decision (the server action checks the permission and records the
 * audit row). It opens the gate ONLY over pending review rows: every
 * integrity refusal still refuses. The pending rows are not decided -- they
 * go live exactly as staged (uncertain facts were already withheld by the
 * transformer, which fills mg fields only from VERIFIED extraction) and stay
 * in the Fact Review queue until a human approves, fixes or rejects them.
 */
export type CommitGateOptions = {
  /**
   * The pending count the human SAW when they ticked the box. Honoured only
   * when it is a non-negative integer and the server's fresh pending count is
   * no larger: a tick given for 612 products never covers 900 (a re-stage or
   * a stale tab). A smaller fresh count is fine -- someone decided a few rows
   * in the meantime.
   */
  acknowledgedPendingCount?: number | null;
};

/** R14a: is this acknowledgement valid for `pending` fresh rows? (pure) */
export function acknowledgementCovers(ack: number | null | undefined, pending: number): boolean {
  // A negative ack can never cover: pending is a count (>= 0), so
  // `pending <= ack` already refuses it -- no separate sign check needed.
  return typeof ack === "number" && Number.isInteger(ack) && pending <= ack;
}

/** R14a: parse the form's seen-count field ("612"); anything else is null. */
export function parseAcknowledgedCount(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  return Number(t);
}

/** R14a: the plain-English line recorded when a publish goes out with open reviews. */
export function publishedWithOpenReviewsLine(pending: number, summaryLine: string): string {
  return (
    `Published now with ${pending} product(s) still awaiting a fact-review decision ` +
    `(explicit "publish now, fix after" decision -- nothing was approved on anyone's behalf). ` +
    summaryLine
  );
}

/**
 * SLICE 4A: evaluate the gate.
 *
 * `evidence` is OPTIONAL and checked FIRST. The reconciliation arithmetic
 * below is self-referential -- it is computed from the same buckets it
 * validates -- so it cannot detect that its own inputs came back short. When
 * the caller can supply independent witnesses (the parser's recorded
 * item_count, a server-side COUNT), we verify the evidence is trustworthy
 * BEFORE reasoning about it. Balanced arithmetic over missing rows is not a
 * pass; it is a smaller universe that happens to add up.
 *
 * Omitting `evidence` preserves the previous behaviour exactly.
 */
export function evaluateCommitGate(
  buckets: FactReviewBuckets,
  evidence?: CommitEvidenceInput,
  options: CommitGateOptions = {},
): CommitGateVerdict {
  const reconciliation = buildCommitReconciliation(buckets);
  const pendingRefusal =
    `Cannot publish: ${reconciliation.pending} fact-review row(s) still await a human decision. ` +
    `Open Fact Review and approve, fix, or reject each one -- this import never guesses.`;
  const imbalanceRefusal =
    `Cannot publish: the reconciliation arithmetic does not balance ` +
    `(${reconciliation.rowsIn} row(s) in vs ${reconciliation.goingLive} going live + ` +
    `${reconciliation.documentedRejects} reject(s) + ${reconciliation.flagsResolved} resolved flag(s) + ` +
    `${reconciliation.pending} pending). Re-stage the import and report this.`;

  let verdict: CommitEvidenceVerdict | undefined;
  if (evidence) {
    verdict = evaluateEvidenceIntegrity(evidence);
    if (!verdict.trustworthy) {
      return {
        ready: false,
        reconciliation,
        message: verdict.message,
        evidence: verdict,
        blockedOnlyByPending: false,
        openReviewsAcknowledged: 0,
      };
    }
  }
  const withEvidence = <T extends object>(v: T) => (evidence ? { ...v, evidence: verdict } : v);

  // Defensive: the SLICE 57 partition makes an imbalance unreachable, but the
  // gate verifies the invariant instead of assuming it (never guess). It is
  // checked BEFORE the pending branch so an imbalance can never be published
  // over with the "publish now, fix after" acknowledgement.
  if (!reconciliation.balanced) {
    return withEvidence({
      ready: false,
      reconciliation,
      message: imbalanceRefusal,
      blockedOnlyByPending: false,
      openReviewsAcknowledged: 0,
    });
  }
  if (reconciliation.pending > 0) {
    if (acknowledgementCovers(options.acknowledgedPendingCount, reconciliation.pending)) {
      return withEvidence({
        ready: true,
        reconciliation,
        message: publishedWithOpenReviewsLine(reconciliation.pending, reconciliation.summaryLine),
        blockedOnlyByPending: true,
        openReviewsAcknowledged: reconciliation.pending,
      });
    }
    return withEvidence({
      ready: false,
      reconciliation,
      message: pendingRefusal,
      blockedOnlyByPending: true,
      openReviewsAcknowledged: 0,
    });
  }
  return withEvidence({
    ready: true,
    reconciliation,
    message: reconciliation.summaryLine,
    blockedOnlyByPending: false,
    openReviewsAcknowledged: 0,
  });
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runImportCommitCoreTests(): void {
  let failures = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) {
      failures += 1;
      console.error(`  IMPORT-COMMIT FAIL: ${msg}`);
    }
  };

  const item = (over: Partial<FactReviewItemInput>): FactReviewItemInput => ({
    sourceItemId: "pos-x",
    name: "X",
    productName: null,
    brand: "B",
    category: "edible-solid",
    inventoryType: "Solid Edible",
    hidden: false,
    hiddenReason: null,
    thc: null,
    cbd: null,
    servingsPerPack: null,
    mgPerServing: null,
    packageThcMg: null,
    packageCbdMg: null,
    ratioLabel: null,
    netWeightGrams: null,
    netVolumeMl: null,
    // SLICE 16: must be listed BEFORE the spread, otherwise `...over` (a
    // Partial) widens the field to `boolean | null | undefined` and the
    // fixture no longer satisfies FactReviewItemInput.
    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: null,
    unitsPerPackage: null,
    factProvenance: {},
    ...over,
  });

  // Corpus-shaped fixture: mirrors the SLICE 57 self-test world so the two
  // cores are exercised against the same reality.
  const items = [
    item({
      sourceItemId: "pos-verified",
      name: "Const HRG Blueberry Gummy",
      factProvenance: { package_thc_mg: "name+column" },
    }),
    item({ sourceItemId: "pos-flagged", name: "Moxey Mints Energizing" }),
    item({ sourceItemId: "pos-flower", name: "Gorilla Glue #4", inventoryType: "Usable Marijuana" }),
    item({
      sourceItemId: "pos-hidden",
      name: "Mystery Topical",
      hidden: true,
      hiddenReason: "no_product_master",
    }),
    item({ sourceItemId: "pos-enrich", name: "Kellys Karamels" }),
  ];
  const diags: FactReviewDiagnosticInput[] = [
    {
      severity: "info",
      code: "fact_extraction_review",
      message: "Extraction needs review.",
      context: { displayName: "Moxey Mints Energizing", reasons: ["Thc column value 4.7 unexplained."] },
    },
    {
      severity: "info",
      code: "cannabinoid_missing",
      message: "No source THC potency.",
      context: { productName: "Kellys Karamels" },
    },
    {
      severity: "warning",
      code: "package_size_mg_garbage",
      message: "Package Size column carries a milligram figure beyond any sane potency.",
      context: { productName: "Jelly Gems Watermelon 25000mg", rawPackage: "25000.00 Milligrams" },
    },
  ];

  // -- All pending: gate REFUSES (Rule 3.1, ask instead of guess) -----------
  {
    const buckets = buildFactReviewBuckets(items, diags);
    const verdict = evaluateCommitGate(buckets);
    ok(verdict.ready === false, "gate refuses while decisions are pending");
    ok(verdict.reconciliation.pending === 3, "three pending (Moxey + Kelly's + standalone Jelly Gems)");
    ok(
      verdict.message.startsWith("Cannot publish: 3 fact-review row(s) still await a human decision."),
      "refusal message names the pending count in plain English",
    );
    ok(verdict.message.includes("this import never guesses"), "refusal states the never-guess rule");
    const r = verdict.reconciliation;
    ok(r.rowsIn === 6 && r.stagedItems === 5 && r.standaloneFlags === 1, "rows in = staged items + standalone flags");
    ok(r.goingLive === 2 && r.autoAccepted === 2 && r.reviewApprovedOrFixed === 0, "only auto-accepted going live before decisions");
    ok(r.documentedRejects === 1 && r.transformerRejected === 1 && r.reviewerRejected === 0, "hidden topical is the one documented reject");
    ok(r.flagsResolved === 0, "no flags resolved yet");
    ok(r.balanced === true, "arithmetic balances even while pending");
    ok(
      r.summaryLine === "Reconciled: 6 row(s) in = 2 going live + 1 documented reject(s) + 0 resolved flag(s) + 3 still pending.",
      "summary line spells out the whole equation",
    );
  }

  // -- Every exception decided: gate OPENS with balanced arithmetic ---------
  {
    const buckets = buildFactReviewBuckets(items, diags, [
      { sourceItemId: "pos-flagged", action: "fix", note: "Checked the jar: 100mg." },
      { sourceItemId: "pos-enrich", action: "approve", note: null },
      { sourceItemId: "flag:package_size_mg_garbage:jelly gems watermelon 25000mg", action: "reject", note: "Garbage package size." },
    ]);
    const verdict = evaluateCommitGate(buckets);
    ok(verdict.ready === true, "gate opens once every exception is decided");
    const r = verdict.reconciliation;
    ok(r.pending === 0, "nothing pending after all decisions");
    ok(r.reviewApprovedOrFixed === 2, "fix + approve both count toward going live");
    ok(r.goingLive === 4, "going live = 2 auto-accepted + 2 human-cleared");
    ok(r.flagsResolved === 1, "decided standalone flag reconciles in its own column");
    ok(r.documentedRejects === 1, "documented rejects unchanged (standalone reject is a flag, not a row)");
    ok(r.balanced === true, "rows in = going live + rejects + resolved flags");
    ok(
      verdict.message === "Reconciled: 6 row(s) in = 4 going live + 1 documented reject(s) + 1 resolved flag(s).",
      "ready message IS the balanced equation (no pending clause)",
    );
  }

  // -- Reviewer reject on an item-backed row counts as a documented reject --
  {
    const buckets = buildFactReviewBuckets(items, diags, [
      { sourceItemId: "pos-flagged", action: "reject", note: "Bad row." },
      { sourceItemId: "pos-enrich", action: "approve", note: null },
      { sourceItemId: "flag:package_size_mg_garbage:jelly gems watermelon 25000mg", action: "approve", note: null },
    ]);
    const r = buildCommitReconciliation(buckets);
    ok(r.reviewerRejected === 1, "item-backed reject counts as reviewer reject");
    ok(r.documentedRejects === 2, "documented rejects = transformer + reviewer");
    ok(r.goingLive === 3, "rejected row does not go live");
    ok(r.balanced === true, "arithmetic still balances with a reviewer reject");
  }

  // -- Clean import (no flags at all): gate opens immediately ----------------
  {
    const buckets = buildFactReviewBuckets(
      [item({ sourceItemId: "pos-a", name: "A" }), item({ sourceItemId: "pos-b", name: "B" })],
      [],
    );
    const verdict = evaluateCommitGate(buckets);
    ok(verdict.ready === true, "imports with no fact flags publish without ceremony");
    ok(verdict.reconciliation.rowsIn === 2 && verdict.reconciliation.goingLive === 2, "clean import: all rows go live");
    ok(
      verdict.message === "Reconciled: 2 row(s) in = 2 going live + 0 documented reject(s) + 0 resolved flag(s).",
      "clean-import equation pinned",
    );
  }

  // -- Empty import: trivially balanced --------------------------------------
  // Unchanged: with NO evidence supplied the gate behaves exactly as before.
  // This is precisely the hole SLICE 4A closes when evidence IS supplied --
  // see the evidence cases below.
  {
    const verdict = evaluateCommitGate(buildFactReviewBuckets([], []));
    ok(verdict.ready === true && verdict.reconciliation.rowsIn === 0, "empty import trivially passes");
    ok(verdict.evidence == null, "no evidence supplied => no evidence verdict");
  }

  // -- SLICE 4A: evidence integrity gates the arithmetic ----------------------
  {
    // The fail-open regression: a failed read yields zero items, which used to
    // reconcile as a trivially-balanced empty import and OPEN the gate.
    const verdict = evaluateCommitGate(buildFactReviewBuckets([], []), {
      observedItems: 0,
      recordedItemCount: 4179,
    });
    ok(verdict.ready === false, "empty read + non-empty version REFUSES (fail-open closed)");
    ok(verdict.evidence?.reason === "empty_but_expected", "refusal cites empty_but_expected");
  }
  {
    // Truncation: the arithmetic balances over 1,000 rows, but the version
    // records 4,179. Balanced-but-short must not publish.
    const items = Array.from({ length: 1000 }, (_, i) =>
      item({ sourceItemId: `pos-${i}`, name: `P${i}` }),
    );
    const buckets = buildFactReviewBuckets(items, []);
    const balancedOnly = evaluateCommitGate(buckets);
    ok(balancedOnly.ready === true, "arithmetic alone cannot see the truncation");
    const withEvidence = evaluateCommitGate(buckets, {
      observedItems: 1000,
      recordedItemCount: 4179,
    });
    ok(withEvidence.ready === false, "evidence check catches the truncated publish");
    ok(withEvidence.evidence?.reason === "short_read", "refusal cites short_read");
    ok(withEvidence.message.includes("3179 missing"), "owner is told how many are missing");
  }
  {
    // Healthy import with corroborating witnesses still publishes.
    const items = [item({ sourceItemId: "pos-a", name: "A" }), item({ sourceItemId: "pos-b", name: "B" })];
    const verdict = evaluateCommitGate(buildFactReviewBuckets(items, []), {
      observedItems: 2,
      recordedItemCount: 2,
      serverItemCount: 2,
    });
    ok(verdict.ready === true, "corroborated healthy import publishes");
    ok(verdict.evidence?.trustworthy === true, "evidence verdict recorded on success");
  }
  {
    // A genuinely empty import with corroborating witnesses is still fine.
    const verdict = evaluateCommitGate(buildFactReviewBuckets([], []), {
      observedItems: 0,
      recordedItemCount: 0,
      serverItemCount: 0,
    });
    ok(verdict.ready === true, "a truly empty version still publishes");
  }
  {
    // Evidence is checked BEFORE pending reviews: an untrustworthy read must
    // not be reported as a review problem.
    const verdict = evaluateCommitGate(buildFactReviewBuckets([], []), {
      observedItems: 0,
      recordedItemCount: 10,
      readFailed: true,
    });
    ok(verdict.ready === false, "read failure refuses");
    ok(verdict.evidence?.reason === "read_failed", "read failure reported as such");
  }

  // -- Defensive imbalance branch (hand-built impossible buckets) ------------
  {
    const buckets = buildFactReviewBuckets([item({ sourceItemId: "pos-a", name: "A" })], []);
    const broken: FactReviewBuckets = {
      ...buckets,
      totals: { ...buckets.totals, items: 99 }, // corrupt on purpose
    };
    const verdict = evaluateCommitGate(broken);
    ok(verdict.ready === false, "imbalanced arithmetic refuses the commit");
    ok(verdict.message.includes("does not balance"), "imbalance refusal says so in plain English");
    ok(verdict.reconciliation.balanced === false, "balanced flag reports the corruption");
  }

  // -- R14a: "publish now, fix after" -- the acknowledged override ----------
  {
    const buckets = buildFactReviewBuckets(items, diags);
    const shut = evaluateCommitGate(buckets);
    ok(shut.blockedOnlyByPending === true, "R14a: pending-only refusal is flagged overridable");
    ok(shut.openReviewsAcknowledged === 0, "R14a: nothing acknowledged without the option");
    const open = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: 3 });
    ok(open.ready === true, "R14a: acknowledged pending rows open the gate");
    ok(open.openReviewsAcknowledged === 3, "R14a: the acknowledged count is the pending count");
    ok(open.reconciliation.pending === 3, "R14a: the rows stay PENDING (nothing auto-decided)");
    ok(open.reconciliation.reviewApprovedOrFixed === 0, "R14a: no approval invented by the override");
    ok(
      open.message ===
        publishedWithOpenReviewsLine(3, open.reconciliation.summaryLine) &&
        open.message.startsWith("Published now with 3 product(s) still awaiting a fact-review decision"),
      "R14a: the recorded line names the open count",
    );
    const stale = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: 2 });
    ok(stale.ready === false, "R14a: a tick for 2 never covers 3 (stale page / re-stage)");
    ok(stale.openReviewsAcknowledged === 0, "R14a: stale tick acknowledges nothing");
    const fewer = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: 612 });
    ok(fewer.ready === true && fewer.openReviewsAcknowledged === 3, "R14a: fresh count smaller than seen is fine");
    const bogus = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: 3.5 });
    ok(bogus.ready === false, "R14a: a non-integer count acknowledges nothing");
    const neg = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: -1 });
    ok(neg.ready === false, "R14a: a negative count acknowledges nothing");
    const nul = evaluateCommitGate(buckets, undefined, { acknowledgedPendingCount: null });
    ok(nul.ready === false, "R14a: null acknowledges nothing");
    ok(parseAcknowledgedCount("612") === 612 && parseAcknowledgedCount(" 3 ") === 3, "R14a: seen-count parses digits");
    ok(
      parseAcknowledgedCount("") === null &&
        parseAcknowledgedCount("-1") === null &&
        parseAcknowledgedCount("3.5") === null &&
        parseAcknowledgedCount("1e3") === null &&
        parseAcknowledgedCount(null) === null &&
        parseAcknowledgedCount("12345678") === null,
      "R14a: anything but plain digits is refused",
    );
    ok(acknowledgementCovers(0, 0) && !acknowledgementCovers(0, 1), "R14a: covers is pending <= ack");
  }
  {
    // The override never reaches past integrity refusals.
    const shortRead = evaluateCommitGate(
      buildFactReviewBuckets(items, diags),
      { observedItems: 5, recordedItemCount: 4179 },
      { acknowledgedPendingCount: 3 },
    );
    ok(shortRead.ready === false, "R14a: a short read refuses even when acknowledged");
    ok(shortRead.blockedOnlyByPending === false, "R14a: a short read is not overridable");
    const failedReviews = evaluateCommitGate(
      buildFactReviewBuckets(items, diags),
      { observedItems: 5, recordedItemCount: 5, reviewsReadFailed: true, observedReviews: 0 },
      { acknowledgedPendingCount: 3 },
    );
    ok(failedReviews.ready === false, "R14a: a failed decisions read refuses even when acknowledged");
    const b = buildFactReviewBuckets(items, diags);
    const broken: FactReviewBuckets = { ...b, totals: { ...b.totals, items: 99 } };
    const imbalanced = evaluateCommitGate(broken, undefined, { acknowledgedPendingCount: 3 });
    ok(imbalanced.ready === false, "R14a: an imbalance refuses even when acknowledged");
    ok(imbalanced.message.includes("does not balance"), "R14a: imbalance is reported before pending");
    ok(imbalanced.blockedOnlyByPending === false, "R14a: an imbalance is not overridable");
    const healthy = evaluateCommitGate(
      buildFactReviewBuckets(items, diags),
      { observedItems: 5, recordedItemCount: 5, serverItemCount: 5 },
      { acknowledgedPendingCount: 3 },
    );
    ok(healthy.ready === true && healthy.evidence?.trustworthy === true, "R14a: trustworthy evidence + ack publishes");
  }
  {
    // Acknowledging with nothing pending changes nothing.
    const clean = evaluateCommitGate(
      buildFactReviewBuckets([item({ sourceItemId: "pos-a", name: "A" })], []),
      undefined,
      { acknowledgedPendingCount: 5 },
    );
    ok(clean.ready === true && clean.openReviewsAcknowledged === 0, "R14a: ack with 0 pending is a no-op");
    ok(clean.blockedOnlyByPending === false, "R14a: a clean import is not 'blocked'");
    ok(clean.message.startsWith("Reconciled:"), "R14a: clean message unchanged by ack");
  }

  if (failures > 0) throw new Error(`import-commit-core self-tests: ${failures} failed`);
  console.log("import-commit-core self-tests passed (67 assertions)");
}

/**
 * src/lib/pos/fact-review-bulk-core.ts  (PROGRAM 3 / SLICE 6A)
 *
 * PURE grouping + bulk-decision planning for the golden-record exception
 * queue.
 *
 * ═══ WHY THIS MODULE EXISTS (the Round 7 defect, measured) ═══
 *
 * The owner's Sep-1-2026 import staged 3,333 menu rows and emitted 6,603
 * diagnostics. 614 rows landed in needs-review. The publish gate refused with
 * "604 fact-review row(s) still await a human decision" and the owner could
 * not clear it, for TWO independent reasons:
 *
 *   1. VISIBILITY (fixed in menu-version.ts / the three screens): the display
 *      screens read `getImportDiagnostics(id, { limit: 5000 })`, which
 *      PostgREST silently truncates to `db.max_rows` = 1,000. Because
 *      `diagnostic_severity` is an ENUM declared ('error','warning','info')
 *      and the read orders by severity ASC, `info` sorts LAST -- and there
 *      were 4,160 warnings, more than the ceiling on their own. So the page
 *      received 1,000 rows that were 100% warnings and ZERO info rows. Both
 *      of the high-volume review codes (`fact_extraction_review` 488,
 *      `cannabinoid_missing` 257 = 745 of 764) are `info` severity, so 603 of
 *      the 614 pending rows were structurally unreachable on the very screen
 *      built to clear them.
 *
 *   2. THROUGHPUT (this module): even fully visible, the queue renders one
 *      card per row and each card posts ONE decision. Clearing 614 rows by
 *      hand is 614 form round-trips. That is not a workflow a human can
 *      complete, so the publish stays blocked and NO products reach the
 *      customer-facing website.
 *
 * ═══ WHAT THIS MODULE REFUSES TO DO ═══
 *
 * It does NOT auto-decide anything. Rule 3.1 stands: nothing uncertain goes
 * live without a named human decision. What it does is let ONE human decision
 * cover a GROUP of rows that share the same machine-stated reason, so the
 * decision is still explicit, still attributed, and still recorded per row --
 * a bulk decision expands into N individual audit rows, never a single blanket
 * flag. `planBulkDecision` returns the exact row ids that a decision would
 * touch so the caller writes one `pos_fact_reviews` row per product, exactly
 * as the single-row path does.
 *
 * Pure: plain data in, plain data out. No fs, no network, no Supabase.
 */

import type { FactResolutionAction, FactReviewRow } from "@/lib/pos/fact-review-core";

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * One group of pending review rows that share an identical machine reason.
 *
 * `reason` is the VERBATIM note the cross-examiner produced. It is the group
 * key precisely because it is the machine's own words -- grouping on anything
 * looser (a category, a brand, a guessed "kind of problem") would silently
 * merge rows the machine distinguished, which is guessing.
 */
export type FactReviewGroup = {
  /** Stable, URL-safe identity for this group (hash-free: derived from the reason). */
  key: string;
  /** The exact shared reason text. */
  reason: string;
  /** Row ids in this group, in stable order. */
  sourceItemIds: string[];
  /** Convenience: sourceItemIds.length. */
  count: number;
  /** A few product names, for the operator to eyeball what they are deciding. */
  sampleNames: string[];
};

const SAMPLE_LIMIT = 5;

/** Deterministic, URL-safe key for a reason string (no hashing, no collisions in practice). */
export function groupKeyForReason(reason: string): string {
  const slug = String(reason ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "unspecified";
}

/**
 * Group PENDING rows by their first (primary) reason.
 *
 * Rows with NO notes are grouped under an explicit "(no reason recorded)"
 * bucket rather than being dropped -- a flag with no explanation is still a
 * flag, and losing it silently is the exact failure mode this program exists
 * to prevent.
 *
 * Only rows whose `resolution` is null are considered: a decided row is not
 * pending and must never be swept back into a bulk action.
 */
export const NO_REASON_TEXT = "(no reason recorded)";

export function groupPendingReviews(rows: readonly FactReviewRow[]): FactReviewGroup[] {
  const byReason = new Map<string, FactReviewGroup>();

  for (const row of rows) {
    if (!row || row.resolution !== null) continue;
    const reason =
      Array.isArray(row.notes) && row.notes.length > 0 && String(row.notes[0]).trim() !== ""
        ? String(row.notes[0]).trim()
        : NO_REASON_TEXT;
    const key = groupKeyForReason(reason);
    const existing = byReason.get(key);
    if (existing) {
      existing.sourceItemIds.push(row.sourceItemId);
      existing.count = existing.sourceItemIds.length;
      if (existing.sampleNames.length < SAMPLE_LIMIT) existing.sampleNames.push(row.name);
    } else {
      byReason.set(key, {
        key,
        reason,
        sourceItemIds: [row.sourceItemId],
        count: 1,
        sampleNames: [row.name],
      });
    }
  }

  // Biggest group first -- that is the one blocking the publish hardest.
  // Ties broken by reason text so the order is deterministic across renders.
  return [...byReason.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

// ---------------------------------------------------------------------------
// Bulk decision planning
// ---------------------------------------------------------------------------

export type BulkDecisionPlan = {
  /** May the caller proceed? */
  ok: boolean;
  /** The rows this decision will write, one audit row each. */
  sourceItemIds: string[];
  /** Plain-English explanation -- the refusal reason, or what will happen. */
  message: string;
};

/**
 * Plan a bulk approve/reject over one reason-group.
 *
 * REFUSALS (each of these would otherwise be a silent guess):
 *   - unknown group key                -> nothing to decide; refuse.
 *   - empty group                      -> refuse rather than write zero rows
 *                                         and report success.
 *   - action "fix"                     -> REFUSED BY DESIGN. A fix supplies
 *                                         corrected VALUES, and corrected
 *                                         values are per-product facts. Applying
 *                                         one typed number to hundreds of
 *                                         different products would be inventing
 *                                         data (Rule 2). Fixes stay one-at-a-time.
 *   - missing/blank reviewer identity  -> refuse. Rule 3.1 requires a NAMED
 *                                         human decision; an anonymous bulk
 *                                         action is exactly what must not happen.
 */
export function planBulkDecision(input: {
  groups: readonly FactReviewGroup[];
  groupKey: string;
  action: FactResolutionAction;
  reviewedBy: string | null | undefined;
}): BulkDecisionPlan {
  const { groups, groupKey, action, reviewedBy } = input;

  if (action === "fix") {
    return {
      ok: false,
      sourceItemIds: [],
      message:
        "Bulk fix is not available: a fix supplies corrected values, and corrected values are " +
        "specific to one product. Approve or reject in bulk, or fix products one at a time.",
    };
  }

  if (typeof reviewedBy !== "string" || reviewedBy.trim() === "") {
    return {
      ok: false,
      sourceItemIds: [],
      message: "Refusing a bulk decision with no named reviewer -- every decision must be attributable.",
    };
  }

  const group = groups.find((g) => g.key === groupKey) ?? null;
  if (!group) {
    return {
      ok: false,
      sourceItemIds: [],
      message: `No pending group matches "${groupKey}". It may already have been decided -- reload Fact Review.`,
    };
  }
  if (group.count === 0 || group.sourceItemIds.length === 0) {
    return {
      ok: false,
      sourceItemIds: [],
      message: "That group has no pending rows left to decide.",
    };
  }

  const verb = action === "approve" ? "Approve" : "Reject";
  return {
    ok: true,
    sourceItemIds: [...group.sourceItemIds],
    message:
      `${verb} ${group.count} product(s) that share one reason: "${group.reason}". ` +
      `Each product gets its own recorded decision, attributed to ${reviewedBy.trim()}.`,
  };
}

/**
 * The note stored on every row a bulk decision writes.
 *
 * It states plainly that the decision was made in bulk, over which reason, and
 * how many rows it covered -- so an auditor reading ONE row can reconstruct
 * the whole action without needing the UI that produced it.
 */
export function bulkDecisionNote(group: FactReviewGroup, typedNote: string | null): string {
  const base = `Bulk decision over ${group.count} product(s) sharing: "${group.reason}".`;
  const extra = typeof typedNote === "string" && typedNote.trim() !== "" ? ` ${typedNote.trim()}` : "";
  return `${base}${extra}`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function mkRow(over: Partial<FactReviewRow> & { sourceItemId: string }): FactReviewRow {
  return {
    sourceItemId: over.sourceItemId,
    name: over.name ?? "Product",
    brand: over.brand ?? "",
    category: over.category ?? "",
    inventoryType: over.inventoryType ?? "",
    bucket: over.bucket ?? "needs-review",
    facts: over.facts ?? {
      thc: null,
      cbd: null,
      servingsPerPack: null,
      mgPerServing: null,
      packageThcMg: null,
      packageCbdMg: null,
      ratioLabel: null,
      netWeightGrams: null,
      netVolumeMl: null,
    },
    sources: over.sources ?? "",
    confidence: over.confidence ?? "needs-review",
    notes: over.notes ?? [],
    resolution: over.resolution ?? null,
    resolutionNote: over.resolutionNote ?? null,
  };
}

export function __runFactReviewBulkCoreTests(): void {
  let failures = 0;
  const check = (label: string, cond: boolean) => {
    if (!cond) {
      failures++;
      console.error(`  FAIL: ${label}`);
    }
  };

  // ---- groupKeyForReason -------------------------------------------------
  check("key is url-safe", groupKeyForReason("No THC potency -- hidden!") === "no-thc-potency-hidden");
  check("key of empty is unspecified", groupKeyForReason("") === "unspecified");
  check("key of junk is unspecified", groupKeyForReason("!!!") === "unspecified");
  check(
    "same reason -> same key",
    groupKeyForReason("Package Size says 25000.00") === groupKeyForReason("Package Size says 25000.00"),
  );

  // ---- groupPendingReviews ----------------------------------------------
  const rows: FactReviewRow[] = [
    mkRow({ sourceItemId: "a", name: "A", notes: ["No THC potency in the source columns."] }),
    mkRow({ sourceItemId: "b", name: "B", notes: ["No THC potency in the source columns."] }),
    mkRow({ sourceItemId: "c", name: "C", notes: ["Package Size says 25000."] }),
    mkRow({ sourceItemId: "d", name: "D", notes: [], resolution: "approve" }), // decided
    mkRow({ sourceItemId: "e", name: "E", notes: [] }), // pending, no reason
  ];
  const groups = groupPendingReviews(rows);
  check("three groups", groups.length === 3);
  check("largest first", groups[0].count === 2);
  check("largest is the THC reason", groups[0].reason.startsWith("No THC potency"));
  check("group carries its ids", groups[0].sourceItemIds.join(",") === "a,b");
  check(
    "decided rows are excluded",
    !groups.some((g) => g.sourceItemIds.includes("d")),
  );
  check(
    "reasonless pending row is kept, not dropped",
    groups.some((g) => g.reason === NO_REASON_TEXT && g.sourceItemIds.includes("e")),
  );
  check("sample names captured", groups[0].sampleNames.join(",") === "A,B");
  check("empty input -> no groups", groupPendingReviews([]).length === 0);
  check(
    "all-decided input -> no groups",
    groupPendingReviews([mkRow({ sourceItemId: "z", resolution: "reject" })]).length === 0,
  );

  // sample list is capped
  const many = Array.from({ length: 12 }, (_, i) =>
    mkRow({ sourceItemId: `m${i}`, name: `M${i}`, notes: ["same reason"] }),
  );
  const bigGroup = groupPendingReviews(many)[0];
  check("big group counts all rows", bigGroup.count === 12);
  check("samples capped at 5", bigGroup.sampleNames.length === SAMPLE_LIMIT);
  check("but every id is present", bigGroup.sourceItemIds.length === 12);

  // ---- planBulkDecision --------------------------------------------------
  const ok = planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: "michael" });
  check("valid plan is ok", ok.ok);
  check("plan carries exactly the group's ids", ok.sourceItemIds.join(",") === "a,b");
  check("plan message names the reviewer", ok.message.includes("michael"));
  check("plan message states the count", ok.message.includes("2 product(s)"));

  const rejectPlan = planBulkDecision({ groups, groupKey: groups[0].key, action: "reject", reviewedBy: "michael" });
  check("reject plans too", rejectPlan.ok && rejectPlan.message.startsWith("Reject"));

  check(
    "bulk FIX is refused",
    planBulkDecision({ groups, groupKey: groups[0].key, action: "fix", reviewedBy: "michael" }).ok === false,
  );
  check(
    "anonymous bulk is refused",
    planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: "" }).ok === false,
  );
  check(
    "null reviewer is refused",
    planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: null }).ok === false,
  );
  check(
    "whitespace reviewer is refused",
    planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: "   " }).ok === false,
  );
  check(
    "unknown group is refused",
    planBulkDecision({ groups, groupKey: "nope", action: "approve", reviewedBy: "michael" }).ok === false,
  );
  check(
    "refusals never return ids",
    planBulkDecision({ groups, groupKey: "nope", action: "approve", reviewedBy: "michael" }).sourceItemIds.length === 0,
  );
  check(
    "empty group is refused",
    planBulkDecision({
      groups: [{ key: "k", reason: "r", sourceItemIds: [], count: 0, sampleNames: [] }],
      groupKey: "k",
      action: "approve",
      reviewedBy: "michael",
    }).ok === false,
  );

  // ---- bulkDecisionNote --------------------------------------------------
  const note = bulkDecisionNote(groups[0], "checked against the COA binder");
  check("note states it was bulk", note.includes("Bulk decision over 2 product(s)"));
  check("note quotes the shared reason", note.includes("No THC potency"));
  check("note appends the typed text", note.includes("checked against the COA binder"));
  check("note without typed text still stands alone", bulkDecisionNote(groups[0], null).includes("Bulk decision over"));
  check("blank typed note adds nothing", !bulkDecisionNote(groups[0], "   ").endsWith(" "));

  if (failures > 0) {
    console.error(`fact-review-bulk-core: ${failures} FAILED`);
    process.exit(1);
  }
  console.log("fact-review-bulk-core: all assertions passed");
}

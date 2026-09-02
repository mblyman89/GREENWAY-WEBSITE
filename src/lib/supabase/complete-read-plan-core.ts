/**
 * src/lib/supabase/complete-read-plan-core.ts  (SLICE 5C)
 *
 * PURE module — no supabase / no "server-only" import — so it runs under
 * `npx tsx scripts/compliance/run-pure-selftests.ts`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * SLICE 5A built the *mechanism* for an honest read (`pagedAllChecked` +
 * `evaluateReadCompleteness`). SLICE 5C applies it to the last 13 call sites.
 * But "apply paging everywhere" is the WRONG instruction, and encoding that
 * mistake across 13 sites would be worse than leaving them alone.
 *
 * Re-measured on main @ 62ce1c61 (SLICE5C_DIAGNOSIS.md §1): a raw grep for
 * `.limit(N>=1000)` reports 38 sites. Only **13** are real. The other 25 are
 * SLICE 5A/5B comments that quote the old buggy code, plus the paging
 * primitives' own deliberate memory ceilings. This module exists partly so that
 * distinction is written down in code and cannot rot back into a grep.
 *
 * ── THE TWO SHAPES ─────────────────────────────────────────────────────────
 * Reading the 13 sites shows two genuinely different problems:
 *
 *   Shape A — the read exists ONLY to produce a count or an aggregate.
 *     e.g. catalog-drafts.ts:360 pulls up to 5,000 `status` strings across the
 *     wire and tallies them in a JS loop. The correct fix is NOT to page 5,000
 *     rows more politely — it is to stop transferring rows at all and ask the
 *     server for a COUNT. `count:"exact", head:true` is immune to
 *     `db.max_rows` because it returns no row payload (established in-repo:
 *     SLICE4_WORKPLAN.md:40-43, 15+ call sites e.g. vendors/store.ts:136).
 *
 *   Shape B — the caller genuinely needs every ROW.
 *     e.g. noncannabis/store.ts:121 needs every existing SKU to guarantee a
 *     new one does not collide. These must page with `pagedAllChecked`.
 *
 * Choosing paging for a Shape A site would be slower AND still read rows
 * nobody wants. Choosing a count for a Shape B site would lose the data. So
 * the choice is a real decision with a right answer, which makes it worth
 * testing — which is what this module is for.
 *
 * ── THE ASYMMETRY RULE (inherited, deliberately) ───────────────────────────
 * Mirrors read-completeness-core.ts:31-38 and recall-hold-store.ts:7-15: an
 * ADVISORY caller degrades softly (show the partial number, LABELLED), a
 * STATUTORY or DATA-INTEGRITY caller refuses. This module never decides which
 * a caller is; it reports what the shape of the evidence allows. The call site
 * owns the consequence.
 *
 * NEVER GUESS: an unusable count (null/NaN/negative/non-integer) is never
 * coerced to 0. Zero is a real answer ("no rows"); unusable is not.
 */

import {
  usableCount,
  type ReadCompletenessVerdict,
} from "./read-completeness-core";

// ---------------------------------------------------------------------------
// Read shapes
// ---------------------------------------------------------------------------

/**
 * Which strategy a cap-relevant read requires.
 *
 *  - `exact_count`  — the read only ever produced a number. Ask the server for
 *                     a COUNT (`count:"exact", head:true`); transfer no rows.
 *  - `paged_rows`   — the caller consumes the rows themselves. Page with
 *                     `pagedAllChecked` and carry the verdict.
 */
export type ReadStrategy = "exact_count" | "paged_rows";

/** What the caller does with the result — decides the failure posture. */
export type ReadPosture =
  /** A wrong number misleads, but nothing is written. Degrade + LABEL. */
  | "advisory"
  /** A short read causes a wrong WRITE (e.g. a duplicate SKU). Refuse. */
  | "data_integrity";

export type ReadPlanInput = {
  /** Does the caller consume rows, or only a derived number? */
  needsRows: boolean;
  /** Consequence of acting on a silently short read. */
  posture: ReadPosture;
};

export type ReadPlan = {
  strategy: ReadStrategy;
  posture: ReadPosture;
  /** May the caller act on a result that is NOT provably complete? */
  mayUsePartial: boolean;
};

/**
 * Decide how a cap-relevant read must be performed.
 *
 * A count-only read never needs paging: the server can count without sending
 * rows, and that count is not subject to `db.max_rows`.
 */
export function planRead(input: ReadPlanInput): ReadPlan {
  const strategy: ReadStrategy = input.needsRows ? "paged_rows" : "exact_count";
  return {
    strategy,
    posture: input.posture,
    // Data-integrity callers must never act on a partial read; an advisory
    // caller may, PROVIDED it labels the number (see describeIncompleteness).
    mayUsePartial: input.posture === "advisory",
  };
}

// ---------------------------------------------------------------------------
// Judging a completed read
// ---------------------------------------------------------------------------

export type TrustInput = {
  plan: ReadPlan;
  /** Verdict from `pagedAllChecked`. Omit for an `exact_count` read. */
  verdict?: ReadCompletenessVerdict | null;
  /** Server COUNT for an `exact_count` read. */
  count?: number | null;
};

export type TrustDecision = {
  /** True when the number/rows may be presented as authoritative. */
  trustworthy: boolean;
  /** True when the caller may still USE the value, but must label it. */
  usableWithLabel: boolean;
  /** Machine-readable reason when not trustworthy. */
  reason: "complete" | "incomplete_read" | "unusable_count" | "missing_evidence";
};

/**
 * Decide whether a finished read may be presented as fact.
 *
 * Deliberately conservative: MISSING evidence is never treated as good news.
 * A caller that forgets to pass a verdict gets `missing_evidence`, not a
 * cheerful `complete`.
 */
export function evaluateReadTrust(input: TrustInput): TrustDecision {
  const { plan } = input;

  if (plan.strategy === "exact_count") {
    if (!usableCount(input.count)) {
      // NEVER coerce an unusable count to 0 — that would report "no drafts"
      // when the truth is "we could not find out".
      return { trustworthy: false, usableWithLabel: false, reason: "unusable_count" };
    }
    return { trustworthy: true, usableWithLabel: true, reason: "complete" };
  }

  const verdict = input.verdict;
  if (!verdict) {
    return { trustworthy: false, usableWithLabel: false, reason: "missing_evidence" };
  }
  if (verdict.complete) {
    return { trustworthy: true, usableWithLabel: true, reason: "complete" };
  }
  return {
    trustworthy: false,
    // An advisory panel may still show the partial figure, labelled. A
    // data-integrity caller may not use it at all.
    usableWithLabel: plan.mayUsePartial,
    reason: "incomplete_read",
  };
}

// ---------------------------------------------------------------------------
// Plain-English disclosure
// ---------------------------------------------------------------------------

/**
 * One sentence the owner can act on. Never blames him, never hides the number,
 * never claims a total is final when it is not.
 */
export function describeIncompleteness(
  verdict: ReadCompletenessVerdict | null | undefined,
  subject: string,
): string | null {
  if (!verdict || verdict.complete) return null;
  const what = subject.trim() || "this list";
  const short =
    usableCount(verdict.missing) && verdict.missing > 0
      ? ` At least ${verdict.missing.toLocaleString("en-US")} more row(s) exist.`
      : "";
  if (verdict.reason === "read_failed") {
    return `Showing a partial total — the database read for ${what} failed part way through, so this number is lower than the real one.${short} Refresh to try again.`;
  }
  if (verdict.reason === "limit_reached") {
    return `Showing a partial total — ${what} is larger than this screen's safety ceiling, so this number is lower than the real one.${short}`;
  }
  return `Showing a partial total for ${what} — this number could not be proven complete.${short}`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`complete-read-plan-core: ${msg}`);
}

/**
 * Build a verdict in the REAL shape of `ReadCompletenessVerdict`
 * (read-completeness-core.ts:81-90): `reason` is the stop reason and `missing`
 * is the quantified shortfall or null. Written by reading that type, not by
 * assuming a shape.
 */
function verdictOf(
  complete: boolean,
  reason: ReadCompletenessVerdict["reason"],
  missing: number | null = null,
): ReadCompletenessVerdict {
  return {
    complete,
    reason,
    rowsRead: complete ? 10 : 1000,
    missing,
    message: complete ? "read complete" : `stopped: ${reason}`,
  };
}

export function __runCompleteReadPlanCoreTests(): string {
  // ── planRead picks the right strategy ────────────────────────────────────
  assert(
    planRead({ needsRows: false, posture: "advisory" }).strategy === "exact_count",
    "a count-only read must use an exact server-side count, not paging",
  );
  assert(
    planRead({ needsRows: true, posture: "advisory" }).strategy === "paged_rows",
    "a read whose rows are consumed must page",
  );

  // ── posture controls whether partial data may be used ────────────────────
  assert(
    planRead({ needsRows: true, posture: "advisory" }).mayUsePartial === true,
    "an advisory panel may show partial data (labelled)",
  );
  assert(
    planRead({ needsRows: true, posture: "data_integrity" }).mayUsePartial === false,
    "a data-integrity caller must NEVER act on a partial read",
  );

  // ── exact_count trust ────────────────────────────────────────────────────
  const countPlan = planRead({ needsRows: false, posture: "advisory" });
  assert(
    evaluateReadTrust({ plan: countPlan, count: 0 }).trustworthy,
    "zero is a real answer and must be trusted",
  );
  assert(
    evaluateReadTrust({ plan: countPlan, count: 4179 }).trustworthy,
    "a usable count is trustworthy regardless of size",
  );
  for (const bad of [null, undefined, Number.NaN, -1, 1.5]) {
    const d = evaluateReadTrust({ plan: countPlan, count: bad as number | null });
    assert(
      !d.trustworthy && d.reason === "unusable_count",
      `an unusable count (${String(bad)}) must never be trusted`,
    );
    assert(!d.usableWithLabel, "an unusable count must not be shown even with a label");
  }

  // ── paged_rows trust ─────────────────────────────────────────────────────
  const advisoryPlan = planRead({ needsRows: true, posture: "advisory" });
  const integrityPlan = planRead({ needsRows: true, posture: "data_integrity" });

  assert(
    evaluateReadTrust({ plan: advisoryPlan, verdict: verdictOf(true, "complete") }).trustworthy,
    "a complete paged read is trustworthy",
  );

  const advPartial = evaluateReadTrust({
    plan: advisoryPlan,
    verdict: verdictOf(false, "read_failed"),
  });
  assert(!advPartial.trustworthy, "a failed read is not trustworthy");
  assert(advPartial.usableWithLabel, "an advisory panel may still show it, labelled");
  assert(advPartial.reason === "incomplete_read", "reason must say the read was incomplete");

  const intPartial = evaluateReadTrust({
    plan: integrityPlan,
    verdict: verdictOf(false, "limit_reached"),
  });
  assert(!intPartial.trustworthy, "a truncated read is not trustworthy");
  assert(
    !intPartial.usableWithLabel,
    "a data-integrity caller may NOT use a truncated read (this is the duplicate-SKU guard)",
  );

  // ── missing evidence is never good news ──────────────────────────────────
  const missing = evaluateReadTrust({ plan: advisoryPlan });
  assert(
    !missing.trustworthy && missing.reason === "missing_evidence",
    "a missing verdict must never be treated as complete",
  );

  // ── disclosure text ──────────────────────────────────────────────────────
  assert(
    describeIncompleteness(verdictOf(true, "complete"), "drafts") === null,
    "a complete read produces no warning",
  );
  const failText = describeIncompleteness(verdictOf(false, "read_failed"), "AI usage");
  assert(!!failText && failText.includes("AI usage"), "the warning names the subject");
  assert(
    !!failText && failText.includes("lower than the real one"),
    "the warning must say the number is UNDER-stated, not merely 'unavailable'",
  );
  const ceilText = describeIncompleteness(verdictOf(false, "limit_reached"), "orders");
  assert(
    !!ceilText && ceilText.includes("safety ceiling"),
    "hitting our own ceiling must be described honestly",
  );
  assert(
    describeIncompleteness(null, "x") === null,
    "no verdict yields no claim",
  );

  // A quantified shortfall must be stated, not rounded away.
  const quantified = describeIncompleteness(verdictOf(false, "read_failed", 1234), "orders");
  assert(
    !!quantified && quantified.includes("1,234"),
    "when the shortfall is known it must be shown to the operator",
  );
  // ...but an unusable shortfall must not produce a bogus "0 more rows".
  const unquantified = describeIncompleteness(verdictOf(false, "read_failed", null), "orders");
  assert(
    !!unquantified && !unquantified.includes("more row(s) exist"),
    "an unquantified shortfall must not claim a number",
  );

  return "complete-read-plan-core: all assertions passed";
}

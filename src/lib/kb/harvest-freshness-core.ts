/**
 * src/lib/kb/harvest-freshness-core.ts — Slice H6 (trickle + cadence), PURE core.
 *
 * Staleness tracking + trickle-target selection from KB_HARVEST_STRATEGY.md:
 *  • "staleness tracking (re-harvest Tier 1 quarterly)" — a vendor's harvest
 *    freshness is derived from its newest crawl draft in ai_suggestions
 *    (source = "crawl:<url>"); rows persist after review, so the newest one
 *    IS the last harvest touch. No new table needed.
 *  • "whole-market shallow pass as a slow background job" — Tier-3 trickle
 *    selects never-harvested targets first, then the stalest, up to the job
 *    cap, so repeated clicks walk the whole market without redoing fresh work.
 *
 * NO server-only imports — pinned by tests/compliance/harvest-freshness.test.ts.
 */

/** Quarterly cadence (strategy §9: "re-harvest Tier 1 quarterly"). */
export const STALE_AFTER_DAYS = 90;

const MS_PER_DAY = 86_400_000;

export type Freshness = "never" | "fresh" | "stale";

/**
 * Classify a harvest timestamp against the quarterly cadence.
 * `lastIso` is the newest crawl-draft created_at for the entity (or null).
 * Unparseable timestamps fail CLOSED to "never" (eligible for re-harvest).
 */
export function classifyFreshness(
  lastIso: string | null | undefined,
  nowMs: number,
  staleAfterDays: number = STALE_AFTER_DAYS,
): Freshness {
  if (!lastIso) return "never";
  const t = Date.parse(lastIso);
  if (!Number.isFinite(t)) return "never";
  const ageDays = (nowMs - t) / MS_PER_DAY;
  return ageDays >= staleAfterDays ? "stale" : "fresh";
}

/** A harvestable target with its freshness facts. */
export type FreshnessTarget = {
  /** Entity id as the harvest job will key it (vendor id, or "lead:<id>"). */
  entityId: string;
  url: string;
  displayName: string;
  /** Newest crawl-draft created_at for this entity, or null. */
  lastHarvestAt: string | null;
};

/**
 * Select targets due for (re-)harvest: never-harvested first (never walk past
 * an unmapped site to re-polish a mapped one), then stalest-first by
 * lastHarvestAt ascending. Fresh targets are excluded entirely. Ties break on
 * displayName then entityId so selection is deterministic. Bounded by `cap`.
 */
export function selectDueTargets(
  targets: readonly FreshnessTarget[],
  nowMs: number,
  cap: number,
  staleAfterDays: number = STALE_AFTER_DAYS,
): FreshnessTarget[] {
  if (cap <= 0) return [];
  const never: FreshnessTarget[] = [];
  const stale: FreshnessTarget[] = [];
  for (const t of targets) {
    const f = classifyFreshness(t.lastHarvestAt, nowMs, staleAfterDays);
    if (f === "never") never.push(t);
    else if (f === "stale") stale.push(t);
  }
  const byName = (a: FreshnessTarget, b: FreshnessTarget) =>
    a.displayName.localeCompare(b.displayName) || a.entityId.localeCompare(b.entityId);
  never.sort(byName);
  stale.sort(
    (a, b) =>
      Date.parse(a.lastHarvestAt ?? "") - Date.parse(b.lastHarvestAt ?? "") || byName(a, b),
  );
  return [...never, ...stale].slice(0, cap);
}

/** Summary counts for the cadence cards. */
export function summarizeFreshness(
  targets: readonly FreshnessTarget[],
  nowMs: number,
  staleAfterDays: number = STALE_AFTER_DAYS,
): { never: number; stale: number; fresh: number; due: number } {
  let never = 0;
  let stale = 0;
  let fresh = 0;
  for (const t of targets) {
    const f = classifyFreshness(t.lastHarvestAt, nowMs, staleAfterDays);
    if (f === "never") never += 1;
    else if (f === "stale") stale += 1;
    else fresh += 1;
  }
  return { never, stale, fresh, due: never + stale };
}

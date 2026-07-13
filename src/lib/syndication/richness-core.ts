/**
 * src/lib/syndication/richness-core.ts  (Task X)
 *
 * PURE menu richness scoring + connection health classification.
 * No DB, no network, no "server-only" — unit-testable with tsx.
 *
 * Richness makes the owner's "information-rich menu" goal measurable: the score
 * is the percentage of enrichment fields (brand, strain, THC, CBD, description,
 * exact image) populated across the feed, per field and overall — shoppers on
 * Leafly/Weedmaps filter and rank by exactly these attributes
 * (docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md §2 enrichment ladder, §3.7).
 *
 * Health turns the syndication log history into a plain-language connection
 * status (connected / degraded / down / never_connected) with the facts staff
 * need to recover (§3.9, §4 runbook).
 */

import type { SyndicationItem } from "./menu-feed-core";

// ---------------------------------------------------------------------------
// Richness scoring
// ---------------------------------------------------------------------------

export type RichnessField = "brand" | "strain" | "thc" | "cbd" | "description" | "image";

export type RichnessReport = {
  itemCount: number;
  /** Per-field: how many items carry the field + percentage (0–100, rounded). */
  fields: Record<RichnessField, { count: number; pct: number }>;
  /** Overall 0–100: mean of the per-field percentages. */
  score: number;
  /** Fields sorted worst-first — the highest-impact fixes. */
  weakest: RichnessField[];
};

function has(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const RICHNESS_FIELDS: RichnessField[] = ["brand", "strain", "thc", "cbd", "description", "image"];

export function scoreRichness(items: SyndicationItem[]): RichnessReport {
  const counts: Record<RichnessField, number> = {
    brand: 0,
    strain: 0,
    thc: 0,
    cbd: 0,
    description: 0,
    image: 0,
  };
  for (const item of items) {
    if (has(item.brand)) counts.brand += 1;
    if (has(item.strainName)) counts.strain += 1;
    if (has(item.thc)) counts.thc += 1;
    if (has(item.cbd)) counts.cbd += 1;
    if (has(item.description)) counts.description += 1;
    if (has(item.imageUrl)) counts.image += 1;
  }
  const n = items.length;
  const fields = {} as RichnessReport["fields"];
  let total = 0;
  for (const f of RICHNESS_FIELDS) {
    const pct = n === 0 ? 0 : Math.round((counts[f] / n) * 100);
    fields[f] = { count: counts[f], pct };
    total += pct;
  }
  const score = n === 0 ? 0 : Math.round(total / RICHNESS_FIELDS.length);
  const weakest = [...RICHNESS_FIELDS].sort((a, b) => fields[a].pct - fields[b].pct);
  return { itemCount: n, fields, score, weakest };
}

// ---------------------------------------------------------------------------
// Connection health
// ---------------------------------------------------------------------------

export type HealthStatus = "connected" | "degraded" | "down" | "never_connected";

/** Minimal shape of a live-sync log entry the classifier needs (newest first). */
export type HealthLogEntry = {
  /** "success" | "error" (anything else treated as error). */
  status: string;
  /** ISO timestamp of the attempt. */
  at: string;
};

export type HealthReport = {
  status: HealthStatus;
  /** Consecutive failures at the head of the history (0 when latest succeeded). */
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** Hours since the last success, relative to `now` (null when never succeeded). */
  hoursSinceSuccess: number | null;
  /** Plain-language one-liner for the dashboard. */
  summary: string;
};

export const HEALTH_DEGRADED_AFTER_FAILURES = 1;
export const HEALTH_DOWN_AFTER_FAILURES = 3;
/** A connection with no successful sync in this window is stale ⇒ degraded. */
export const HEALTH_STALE_AFTER_HOURS = 48;

/**
 * Classify connection health from live-sync history (NEWEST FIRST) at time `now`.
 *  - no history at all → never_connected
 *  - ≥3 consecutive failures → down
 *  - 1–2 consecutive failures, or last success older than 48h → degraded
 *  - otherwise → connected
 */
export function classifyHealth(entriesNewestFirst: HealthLogEntry[], now: Date): HealthReport {
  if (entriesNewestFirst.length === 0) {
    return {
      status: "never_connected",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastAttemptAt: null,
      hoursSinceSuccess: null,
      summary: "No live sync has been attempted yet.",
    };
  }

  let consecutiveFailures = 0;
  for (const e of entriesNewestFirst) {
    if (e.status === "success") break;
    consecutiveFailures += 1;
  }
  const lastSuccess = entriesNewestFirst.find((e) => e.status === "success") ?? null;
  const lastAttemptAt = entriesNewestFirst[0].at;
  const lastSuccessAt = lastSuccess ? lastSuccess.at : null;
  const hoursSinceSuccess = lastSuccess
    ? Math.max(0, (now.getTime() - new Date(lastSuccess.at).getTime()) / 3_600_000)
    : null;

  let status: HealthStatus;
  if (!lastSuccess) {
    // Attempts exist but none ever succeeded.
    status = consecutiveFailures >= HEALTH_DOWN_AFTER_FAILURES ? "down" : "degraded";
  } else if (consecutiveFailures >= HEALTH_DOWN_AFTER_FAILURES) {
    status = "down";
  } else if (consecutiveFailures >= HEALTH_DEGRADED_AFTER_FAILURES) {
    status = "degraded";
  } else if (hoursSinceSuccess !== null && hoursSinceSuccess > HEALTH_STALE_AFTER_HOURS) {
    status = "degraded";
  } else {
    status = "connected";
  }

  const hrs = hoursSinceSuccess === null ? null : Math.round(hoursSinceSuccess);
  const summary =
    status === "connected"
      ? `Healthy — last successful sync ${hrs === 0 ? "under an hour" : `${hrs}h`} ago.`
      : status === "down"
        ? `${consecutiveFailures} consecutive failures — connection is down.`
        : consecutiveFailures > 0
          ? `${consecutiveFailures} recent failure${consecutiveFailures === 1 ? "" : "s"} — connection is degraded.`
          : `No successful sync in ${hrs}h — connection is stale.`;

  return { status, consecutiveFailures, lastSuccessAt, lastAttemptAt, hoursSinceSuccess, summary };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runRichnessTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  const full: SyndicationItem = {
    id: "p1",
    name: "Blue Dream",
    brand: "Acme",
    category: "flower",
    strainType: "sativa",
    strainName: "Blue Dream",
    thc: "22%",
    cbd: "0.1%",
    description: "Nice.",
    priceMinorUnits: 3500,
    inStock: true,
    variants: [{ id: "v1", label: "3.5g", priceMinorUnits: 3500, inStock: true, inventoryLevel: 3 }],
    imageUrl: "https://cdn.example.com/p1.jpg",
  };
  const bare: SyndicationItem = {
    ...full,
    id: "p2",
    brand: null,
    strainName: null,
    thc: null,
    cbd: null,
    description: "",
    imageUrl: undefined,
  };

  const rich = scoreRichness([full]);
  ok("full item scores 100", rich.score === 100);
  ok("full item per-field 100", rich.fields.brand.pct === 100 && rich.fields.image.pct === 100);

  const half = scoreRichness([full, bare]);
  ok("half feed scores 50", half.score === 50);
  ok("half feed brand count", half.fields.brand.count === 1 && half.fields.brand.pct === 50);
  ok("weakest sorted ascending", half.weakest.length === 6 && half.fields[half.weakest[0]].pct <= half.fields[half.weakest[5]].pct);

  const empty = scoreRichness([]);
  ok("empty feed scores 0", empty.score === 0 && empty.itemCount === 0);

  const bareOnly = scoreRichness([bare]);
  ok("bare item scores 0", bareOnly.score === 0);

  // Health
  const now = new Date("2026-07-13T12:00:00Z");
  const never = classifyHealth([], now);
  ok("never connected", never.status === "never_connected");

  const healthy = classifyHealth([{ status: "success", at: "2026-07-13T10:00:00Z" }], now);
  ok("healthy connected", healthy.status === "connected");
  ok("healthy hours", healthy.hoursSinceSuccess !== null && Math.round(healthy.hoursSinceSuccess) === 2);
  ok("healthy no failures", healthy.consecutiveFailures === 0);

  const oneFail = classifyHealth(
    [
      { status: "error", at: "2026-07-13T11:00:00Z" },
      { status: "success", at: "2026-07-13T09:00:00Z" },
    ],
    now,
  );
  ok("one failure degraded", oneFail.status === "degraded" && oneFail.consecutiveFailures === 1);
  ok("one failure keeps last success", oneFail.lastSuccessAt === "2026-07-13T09:00:00Z");

  const threeFails = classifyHealth(
    [
      { status: "error", at: "2026-07-13T11:00:00Z" },
      { status: "error", at: "2026-07-13T10:00:00Z" },
      { status: "error", at: "2026-07-13T09:00:00Z" },
      { status: "success", at: "2026-07-13T08:00:00Z" },
    ],
    now,
  );
  ok("three failures down", threeFails.status === "down" && threeFails.consecutiveFailures === 3);

  const stale = classifyHealth([{ status: "success", at: "2026-07-10T00:00:00Z" }], now);
  ok("stale success degraded", stale.status === "degraded");

  const neverSucceeded = classifyHealth(
    [
      { status: "error", at: "2026-07-13T11:00:00Z" },
      { status: "error", at: "2026-07-13T10:00:00Z" },
    ],
    now,
  );
  ok("attempts but never succeeded -> degraded", neverSucceeded.status === "degraded" && neverSucceeded.lastSuccessAt === null);

  const neverSucceededDown = classifyHealth(
    [
      { status: "error", at: "2026-07-13T11:00:00Z" },
      { status: "error", at: "2026-07-13T10:00:00Z" },
      { status: "error", at: "2026-07-13T09:00:00Z" },
    ],
    now,
  );
  ok("3 failures never succeeded -> down", neverSucceededDown.status === "down");

  console.log(`richness/health: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} richness/health test(s) failed`);
}

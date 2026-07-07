/**
 * src/lib/kb/harvest-settings-core.ts — Slice H7 (Harvest Tuning), PURE core.
 *
 * Single source of truth for every tunable knob of the KB harvest pipeline:
 *
 *   • DEFAULTS  — the vetted values that used to be hardcoded constants
 *                 (H4 tier presets, H5 fast-lane bars + caps, H6 cadence).
 *                 The DB row (kb_harvest_settings, migration 0098) seeds from
 *                 the same numbers; if the row/table is missing the app
 *                 FAILS OPEN to these defaults so nothing breaks before the
 *                 migration is applied.
 *   • CLAMPS    — hard server-side min/max per knob. Applied on every load
 *                 AND every save, so neither a UI typo nor a direct DB edit
 *                 can push the pipeline outside its safe envelope. The DB
 *                 mirrors these as CHECK constraints; the crawler worker
 *                 additionally enforces its own ceilings (pages 1..50,
 *                 delay 0..3600s — crawler/app/harvest.py).
 *   • clampHarvestSettings / mergeHarvestSettings — pure helpers pinned by
 *                 tests/compliance/harvest-settings.test.ts.
 *
 * NO server-only imports — this file must stay pure for the compliance suite.
 */

/** Every tunable knob. All numbers; confidence is a 0–1 fraction. */
export type HarvestSettings = {
  /** Min crawler confidence (0–1) for a draft to ride the fast lane. */
  fastLaneMinConfidence: number;
  /** Min trimmed characters for a fast-lane draft (thin-content bar). */
  fastLaneMinChars: number;
  /** Days after which a harvested site counts as stale (re-harvest due). */
  staleAfterDays: number;
  /** Vendor sites queued per Tier-1 "Refresh" click. */
  refreshBatch: number;
  /** Lead sites queued per Tier-3 "Trickle" click. */
  trickleBatch: number;
  /** Max drafts a single batch-accept click may apply. */
  batchAcceptCap: number;
  /** Pending drafts loaded per entity type into the review inbox. */
  pendingLimit: number;
  /** Tier-1 crawl depth (pages per site) — current vendors, deep. */
  tier1MaxPages: number;
  /** Tier-2 crawl depth — prospects, medium. */
  tier2MaxPages: number;
  /** Tier-3 crawl depth — whole-market shallow trickle. */
  tier3MaxPages: number;
  /** Pause between Tier-3 sites (seconds) — the "trickle" in the trickle. */
  tier3DelaySeconds: number;
};

/**
 * The vetted defaults. These MUST stay in sync with:
 *   - the column defaults in supabase/migrations/0098_kb_harvest_settings.sql
 *   - the strategy depths in KB_HARVEST_STRATEGY.md (§3, §5, §9)
 * "Reset to defaults" writes exactly these numbers.
 */
export const HARVEST_DEFAULTS: HarvestSettings = {
  fastLaneMinConfidence: 0.8,
  fastLaneMinChars: 40,
  staleAfterDays: 90,
  refreshBatch: 25,
  trickleBatch: 25,
  batchAcceptCap: 50,
  pendingLimit: 1000,
  tier1MaxPages: 25,
  tier2MaxPages: 10,
  tier3MaxPages: 3,
  tier3DelaySeconds: 60,
};

/** Hard clamp ranges (inclusive). Mirrored by the DB CHECK constraints. */
export const HARVEST_CLAMPS: Record<keyof HarvestSettings, { min: number; max: number }> = {
  fastLaneMinConfidence: { min: 0.5, max: 0.99 },
  fastLaneMinChars: { min: 10, max: 500 },
  staleAfterDays: { min: 7, max: 365 },
  refreshBatch: { min: 1, max: 100 },
  trickleBatch: { min: 1, max: 100 },
  batchAcceptCap: { min: 1, max: 200 },
  pendingLimit: { min: 100, max: 5000 },
  tier1MaxPages: { min: 1, max: 50 }, // crawler worker hard ceiling: 50
  tier2MaxPages: { min: 1, max: 50 },
  tier3MaxPages: { min: 1, max: 50 },
  tier3DelaySeconds: { min: 0, max: 3600 }, // crawler worker ceiling: 3600
};

/** Knobs that are whole numbers (everything except the confidence fraction). */
const INTEGER_KEYS: ReadonlySet<keyof HarvestSettings> = new Set([
  "fastLaneMinChars",
  "staleAfterDays",
  "refreshBatch",
  "trickleBatch",
  "batchAcceptCap",
  "pendingLimit",
  "tier1MaxPages",
  "tier2MaxPages",
  "tier3MaxPages",
  "tier3DelaySeconds",
]);

/**
 * Clamp ONE knob: non-finite / non-numeric input falls back to the DEFAULT
 * (never to a clamp edge — a garbled save must not silently loosen or
 * tighten a bar); finite input is clamped into [min, max] and integerized
 * where the knob is integral. Confidence keeps 2 decimal places.
 */
export function clampHarvestValue(key: keyof HarvestSettings, value: unknown): number {
  const { min, max } = HARVEST_CLAMPS[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return HARVEST_DEFAULTS[key];
  let v = Math.min(max, Math.max(min, n));
  v = INTEGER_KEYS.has(key) ? Math.round(v) : Math.round(v * 100) / 100;
  return v;
}

/** Clamp every knob of a full settings object. */
export function clampHarvestSettings(input: HarvestSettings): HarvestSettings {
  const out = {} as HarvestSettings;
  for (const key of Object.keys(HARVEST_CLAMPS) as (keyof HarvestSettings)[]) {
    out[key] = clampHarvestValue(key, input[key]);
  }
  return out;
}

/**
 * Merge a PARTIAL, possibly-untrusted patch over a base (usually the
 * defaults): unknown keys are ignored, missing keys keep the base value,
 * every provided value is clamped. This is the one path both the DB row
 * (snake_case mapped by the server wrapper) and the settings form go
 * through — the rules cannot drift between them.
 */
export function mergeHarvestSettings(
  base: HarvestSettings,
  patch: Partial<Record<keyof HarvestSettings, unknown>>,
): HarvestSettings {
  const out = { ...base };
  for (const key of Object.keys(HARVEST_CLAMPS) as (keyof HarvestSettings)[]) {
    if (patch[key] !== undefined && patch[key] !== null) {
      out[key] = clampHarvestValue(key, patch[key]);
    }
  }
  return out;
}

/** True when every knob equals the vetted default (drives the "Defaults" badge). */
export function isAllDefaults(s: HarvestSettings): boolean {
  return (Object.keys(HARVEST_CLAMPS) as (keyof HarvestSettings)[]).every(
    (k) => s[k] === HARVEST_DEFAULTS[k],
  );
}

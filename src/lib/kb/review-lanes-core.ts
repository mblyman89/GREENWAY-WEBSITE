/**
 * src/lib/kb/review-lanes-core.ts — Slice H5 (review economics), PURE core.
 *
 * Harvesting 200 vendors can dump thousands of drafts into ai_suggestions.
 * Raw firehose = nobody reviews anything. This module implements the triage
 * rules from KB_HARVEST_STRATEGY.md §5 so reviewer minutes are budgeted like
 * crawler budget:
 *
 *  • FAST lane      — writable profile field + high confidence + non-thin +
 *                     compliance-clean ⇒ eligible for per-vendor batch-accept.
 *  • STANDARD lane  — writable field that missed a fast-lane bar ⇒ individual
 *                     review.
 *  • REFERENCE lane — research_* drafts (products/images/logos). Read-only by
 *                     design: they can NEVER be accepted into a profile field.
 *  • PROSPECT lane  — drafts harvested for a discovery lead (entity_id
 *                     "lead:<uuid>"). There is no vendor row to write to, so
 *                     they sit as dark inventory until the lead is promoted.
 *
 * NO imports from server-only modules — this file must stay pure so the
 * compliance test suite (tests/compliance) can pin the routing rules. The
 * server wrapper (review-inbox.ts) supplies the live compliance-scan verdict
 * as a plain boolean.
 */

/** Minimal slice of an ai_suggestions row the lane router needs. */
export type LaneSuggestionInput = {
  id: string;
  entity_type: string; // "vendor" | "brand" (others pass through as standard)
  entity_id: string;
  field_key: string;
  suggested_value: string | null;
  confidence?: number | null;
  created_at: string; // ISO timestamp
};

export type ReviewLane = "fast" | "standard" | "reference" | "prospect";

/** Profile fields a human may accept, per entity type (mirrors the accept actions).
 * H9a: vendors gained product_philosophy (migration 0099) — the crawler finds
 * philosophy copy on producer/processor sites and the owner needs Accept, not
 * just Dismiss. If 0099 hasn't been applied yet the accept fails with the DB's
 * "column does not exist" message rather than silently writing nowhere. */
export const ACCEPTABLE_FIELDS: Record<string, ReadonlySet<string>> = {
  vendor: new Set(["about", "mission_statement", "product_philosophy"]),
  brand: new Set(["about", "mission_statement", "product_philosophy"]),
};

/** Reference-only field keys — never writable into a profile column. */
export const REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "research_products",
  "research_images",
  "research_logos",
]);

/**
 * Fast-lane bars (strategy §5: "confidence lanes") — the vetted DEFAULTS.
 * Since Slice H7 the effective bars are tunable on the Harvest Tuning page
 * (kb_harvest_settings); callers pass the loaded values via `opts`. These
 * constants remain the fail-open fallback and the "Reset to defaults" values.
 */
export const FAST_LANE_MIN_CONFIDENCE = 0.8;
export const FAST_LANE_MIN_CHARS = 40;

/** True when the draft targets a discovery lead rather than a real entity row. */
export function isProspectTarget(entityId: string): boolean {
  return entityId.startsWith("lead:");
}

/**
 * Route one draft into its review lane.
 *
 * `hasBlockingFlags` is the CURRENT compliance re-scan verdict, computed by
 * the caller (server wrapper) against the live rules — a blocking draft can
 * never ride the fast lane, though the S-4 accept gate re-checks at accept
 * time regardless (defense in depth).
 *
 * `minConfidence` / `minChars` override the fast-lane bars (Slice H7 tuning);
 * when omitted the vetted defaults apply, so existing behavior is unchanged.
 */
export function classifyLane(
  s: LaneSuggestionInput,
  opts?: { hasBlockingFlags?: boolean; minConfidence?: number; minChars?: number },
): ReviewLane {
  if (isProspectTarget(s.entity_id)) return "prospect";
  if (REFERENCE_FIELDS.has(s.field_key)) return "reference";

  const writable = ACCEPTABLE_FIELDS[s.entity_type]?.has(s.field_key) ?? false;
  if (!writable) return "reference"; // unknown fields are read-only, never writable

  if (opts?.hasBlockingFlags) return "standard";
  const minConfidence = opts?.minConfidence ?? FAST_LANE_MIN_CONFIDENCE;
  const minChars = opts?.minChars ?? FAST_LANE_MIN_CHARS;
  const conf = typeof s.confidence === "number" ? s.confidence : 0;
  if (conf < minConfidence) return "standard";
  const len = (s.suggested_value ?? "").trim().length;
  if (len < minChars) return "standard";
  return "fast";
}

/**
 * Re-harvests create duplicate pending drafts for the same field. Batch-accept
 * must apply exactly ONE value per (entity_type, entity_id, field_key): the
 * NEWEST. Older pending duplicates are returned as `superseded` so the caller
 * can close them out (audited) instead of leaving zombie drafts in the inbox.
 */
export function newestPerField<T extends LaneSuggestionInput>(
  suggestions: readonly T[],
): { primary: T[]; superseded: T[] } {
  const byKey = new Map<string, T[]>();
  for (const s of suggestions) {
    const key = `${s.entity_type}\u0000${s.entity_id}\u0000${s.field_key}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  const primary: T[] = [];
  const superseded: T[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    primary.push(list[0]);
    superseded.push(...list.slice(1));
  }
  return { primary, superseded };
}

/** One vendor's grouped review workload. */
export type VendorReviewGroup<T extends LaneSuggestionInput> = {
  /** vendors.id, or "lead:<uuid>" for prospect groups, or "unknown". */
  vendorKey: string;
  fast: T[];
  standard: T[];
  reference: T[];
  prospect: T[];
};

/**
 * Vendor-grouped review, not field-grouped (strategy §5.2): brand drafts roll
 * up to their parent vendor via `brandToVendor` (brands.id → vendors.id).
 * Returns groups sorted by fast-lane size desc (biggest one-click wins first),
 * then by total drafts desc.
 */
export function groupByVendor<T extends LaneSuggestionInput>(
  suggestions: readonly T[],
  brandToVendor: ReadonlyMap<string, string>,
  laneOf: (s: T) => ReviewLane,
): VendorReviewGroup<T>[] {
  const groups = new Map<string, VendorReviewGroup<T>>();
  for (const s of suggestions) {
    let key: string;
    if (isProspectTarget(s.entity_id)) key = s.entity_id;
    else if (s.entity_type === "vendor") key = s.entity_id;
    else if (s.entity_type === "brand") key = brandToVendor.get(s.entity_id) ?? "unknown";
    else key = "unknown";

    let g = groups.get(key);
    if (!g) {
      g = { vendorKey: key, fast: [], standard: [], reference: [], prospect: [] };
      groups.set(key, g);
    }
    g[laneOf(s)].push(s);
  }
  return [...groups.values()].sort((a, b) => {
    if (b.fast.length !== a.fast.length) return b.fast.length - a.fast.length;
    const at = a.fast.length + a.standard.length + a.reference.length + a.prospect.length;
    const bt = b.fast.length + b.standard.length + b.reference.length + b.prospect.length;
    return bt - at;
  });
}

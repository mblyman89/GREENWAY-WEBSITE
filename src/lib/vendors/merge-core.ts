/**
 * src/lib/vendors/merge-core.ts — Task F (combine duplicate vendors).
 *
 * Pure, dependency-free helpers for FINDING likely duplicate vendor cards and
 * PREVIEWING what a merge will do. Many WA producer-processors hold multiple
 * LCB licenses (producer + processor), so the statewide import created 2–3
 * cards for what is really one business.
 *
 * STANDING RULES honoured here:
 *   • Never guess — detection only ever SUGGESTS groups; a human picks the
 *     surviving card and confirms. Nothing merges automatically.
 *   • Drafts-only philosophy — the preview shows exactly which empty survivor
 *     fields will be filled and which licenses will be preserved BEFORE the
 *     owner commits.
 *   • No DB, no React — pure functions so they run anywhere and unit-test
 *     cleanly (mirrors reconcile.ts / list-state-core.ts).
 *
 * The actual merge is performed by the DB function public.merge_vendors()
 * (migration 0104) so the whole thing is one atomic transaction.
 */
import { normalizeName, normalizeLicense } from "@/lib/discovery/reconcile";
import type { Vendor } from "@/lib/vendors/types";

/** The vendor fields a caller must supply for detection/preview. */
export type MergeCandidate = Pick<
  Vendor,
  | "id"
  | "display_name"
  | "legal_name"
  | "license_number"
  | "website"
  | "status"
  | "product_count"
  | "brand_count"
> &
  Partial<Vendor>;

/** A suggested group of duplicate cards (same business, multiple licenses). */
export type DuplicateGroup = {
  /** Stable key for the group (normalized name or website host). */
  key: string;
  /** Why we think these are the same business. */
  reason: "same-name" | "same-website";
  /** The card we suggest keeping (most complete). Always in `vendors`. */
  suggestedSurvivorId: string;
  /** All cards in the group, suggested survivor first. */
  vendors: MergeCandidate[];
};

/** Normalize a website URL down to its host for equality (www stripped). */
export function normalizeWebsiteHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  if (!s) return "";
  // Tolerate bare hosts ("qualitygrowers.com") and full URLs.
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    // A bare TLD or empty host is not a usable signal.
    return host.includes(".") ? host : "";
  } catch {
    return "";
  }
}

/**
 * How "complete" a card is, for picking the suggested survivor. Counts filled
 * identity/profile fields; ties broken by published status, then product
 * count, then brand count. Pure and cheap — this is a SUGGESTION only.
 */
export function completenessScore(v: MergeCandidate): number {
  const filled = (x: unknown): number =>
    typeof x === "string" && x.trim().length > 0 ? 1 : x != null && typeof x !== "string" ? 1 : 0;
  let score = 0;
  score += v.logo_media_id ? 4 : 0; // a logo is the most curated signal
  score += filled(v.about) * 3;
  score += filled(v.mission_statement) * 2;
  score += filled(v.website) * 2;
  score += filled(v.email);
  score += filled(v.phone);
  score += filled(v.license_number);
  score += filled(v.legal_name);
  score += v.status === "published" ? 3 : 0;
  score += (v.product_count ?? 0) > 0 ? 2 : 0;
  score += (v.brand_count ?? 0) > 0 ? 1 : 0;
  return score;
}

/** Order a group's cards so the best survivor candidate comes first. */
function bySurvivorPreference(a: MergeCandidate, b: MergeCandidate): number {
  const diff = completenessScore(b) - completenessScore(a);
  if (diff !== 0) return diff;
  // Stable tie-break so the same input always yields the same suggestion.
  return a.id.localeCompare(b.id);
}

/**
 * Find likely duplicate groups among the given vendors.
 *
 * Signals (conservative — the same ones reconcile.ts trusts):
 *   1. same-name  — identical normalized business name (legal name preferred,
 *      display name otherwise). This is the producer/processor case: "Quality
 *      Growers LLC" appears 2–3× with different license numbers.
 *   2. same-website — identical website host (only when 2+ cards share it and
 *      they were NOT already grouped by name).
 *
 * Never groups archived cards (already-merged duplicates live there), and a
 * group is only suggested when it has 2–5 members — anything larger is almost
 * certainly a data problem a human should look at differently.
 */
export function findDuplicateGroups(vendors: MergeCandidate[]): DuplicateGroup[] {
  const eligible = vendors.filter((v) => v.status !== "archived");

  const groups: DuplicateGroup[] = [];
  const groupedIds = new Set<string>();

  // ── Signal 1: identical normalized name ────────────────────────────────────
  const byName = new Map<string, MergeCandidate[]>();
  for (const v of eligible) {
    const key = normalizeName(v.legal_name || v.display_name);
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(v);
    else byName.set(key, [v]);
  }
  for (const [key, list] of byName) {
    if (list.length < 2 || list.length > 5) continue;
    const sorted = [...list].sort(bySurvivorPreference);
    for (const v of sorted) groupedIds.add(v.id);
    groups.push({
      key: `name:${key}`,
      reason: "same-name",
      suggestedSurvivorId: sorted[0].id,
      vendors: sorted,
    });
  }

  // ── Signal 2: identical website host (cards not already grouped by name) ───
  const byHost = new Map<string, MergeCandidate[]>();
  for (const v of eligible) {
    if (groupedIds.has(v.id)) continue;
    const host = normalizeWebsiteHost(v.website);
    if (!host) continue;
    const list = byHost.get(host);
    if (list) list.push(v);
    else byHost.set(host, [v]);
  }
  for (const [host, list] of byHost) {
    if (list.length < 2 || list.length > 5) continue;
    const sorted = [...list].sort(bySurvivorPreference);
    groups.push({
      key: `site:${host}`,
      reason: "same-website",
      suggestedSurvivorId: sorted[0].id,
      vendors: sorted,
    });
  }

  // Biggest groups first, then alphabetically by key for a stable page.
  groups.sort((a, b) => b.vendors.length - a.vendors.length || a.key.localeCompare(b.key));
  return groups;
}

/** Fields the DB merge gap-fills, with the labels the preview shows. */
const GAP_FILL_FIELDS: { key: keyof Vendor; label: string }[] = [
  { key: "legal_name", label: "Legal name" },
  { key: "license_number", label: "License number" },
  { key: "mission_statement", label: "Mission statement" },
  { key: "about", label: "About" },
  { key: "product_philosophy", label: "Product philosophy" },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "vendor_day_notes", label: "Vendor day notes" },
  { key: "vendor_number", label: "Vendor number" },
  { key: "dba", label: "DBA" },
  { key: "shipping_address1", label: "Shipping address" },
  { key: "billing_address1", label: "Billing address" },
  { key: "sage_vendor_id", label: "Sage vendor ID" },
  { key: "logo_media_id", label: "Logo" },
  { key: "hero_media_id", label: "Hero image" },
];

export type MergePlan = {
  survivorId: string;
  duplicateIds: string[];
  /** Human-readable "Field ← from <card>" lines for empty fields being filled. */
  fills: { field: string; fromDisplayName: string }[];
  /** EVERY license involved (survivor's first) — proof none get lost. */
  licenses: string[];
  /** Duplicate display names that will be recorded as aliases + archived. */
  archived: string[];
};

/**
 * Preview what merge_vendors() will do, using the same gap-fill rule as the DB
 * function: only fields EMPTY on the survivor get filled, first duplicate (in
 * order) wins, curated survivor data is never overwritten.
 */
export function buildMergePlan(survivor: MergeCandidate, duplicates: MergeCandidate[]): MergePlan {
  const empty = (x: unknown): boolean => x == null || (typeof x === "string" && x.trim() === "");

  const fills: MergePlan["fills"] = [];
  // Track what earlier duplicates already filled so later ones don't re-claim.
  const claimed = new Set<string>();
  for (const dup of duplicates) {
    for (const f of GAP_FILL_FIELDS) {
      if (claimed.has(f.key as string)) continue;
      const sv = (survivor as Record<string, unknown>)[f.key as string];
      const dv = (dup as Record<string, unknown>)[f.key as string];
      if (empty(sv) && !empty(dv)) {
        claimed.add(f.key as string);
        fills.push({ field: f.label, fromDisplayName: dup.display_name });
      }
    }
  }

  const licenses: string[] = [];
  const seen = new Set<string>();
  for (const v of [survivor, ...duplicates]) {
    const norm = normalizeLicense(v.license_number);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    licenses.push((v.license_number ?? "").trim());
  }

  return {
    survivorId: survivor.id,
    duplicateIds: duplicates.map((d) => d.id),
    fills,
    licenses,
    archived: duplicates.map((d) => d.display_name),
  };
}

/**
 * Validate a merge selection before calling the DB. Returns a plain-language
 * error, or null when the selection is sound. Mirrors the DB guards so the
 * owner gets a friendly message instead of a raised exception.
 */
export function validateMergeSelection(
  survivorId: string,
  duplicateIds: string[],
): string | null {
  if (!survivorId) return "Pick which card to keep first.";
  const unique = [...new Set(duplicateIds.filter(Boolean))];
  if (unique.length === 0) return "Pick at least one duplicate card to merge in.";
  if (unique.includes(survivorId)) return "The card you keep can't also be a duplicate.";
  if (unique.length > 4) return "Merge at most 4 duplicates at a time (do a second merge for the rest).";
  return null;
}

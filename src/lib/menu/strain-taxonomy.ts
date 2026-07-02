/**
 * strain-taxonomy.ts — the single source of truth for WEBSITE + BACK-OFFICE
 * strain-type values and their customer-facing labels.
 *
 * Mirrors src/lib/pos/category-taxonomy.ts. Adds the two "leaning hybrid"
 * designations the owner introduced so customers can see whether a hybrid
 * leans indica or sativa.
 *
 * IMPORTANT — CCRS IS SEPARATE AND HARD-SET. Do not use this for CCRS. The CCRS
 * batch normalizer (src/lib/compliance/ccrs-batch-core.ts) already collapses
 * anything containing "hybrid" to the CCRS-valid `Hybrid`, so `indica-hybrid`
 * and `sativa-hybrid` export correctly as Hybrid. That file is untouched.
 *
 * Canonical machine values (owner-approved): compact hyphen tokens — safe as
 * URL/query-string filter values and consistent with the compact tokens the
 * website menu already used (indica/sativa/hybrid/cbd/unknown).
 */
import type { GreenwayStrainType } from "@/lib/leafly/types";

export type StrainTypeDefinition = {
  value: GreenwayStrainType;
  /** Customer-facing label (owner-approved wording). */
  label: string;
  /** True for the two leaning-hybrid designations. */
  leaning?: boolean;
};

export const strainTypeDefinitions = [
  { value: "indica", label: "Indica" },
  { value: "sativa", label: "Sativa" },
  { value: "hybrid", label: "Hybrid" },
  { value: "indica-hybrid", label: "Indica-Hybrid", leaning: true },
  { value: "sativa-hybrid", label: "Sativa-Hybrid", leaning: true },
  { value: "cbd", label: "CBD" },
  { value: "unknown", label: "Unknown" },
] as const satisfies readonly StrainTypeDefinition[];

/** All canonical strain-type machine values. */
export const strainTypeValues = strainTypeDefinitions.map((d) => d.value);

/** Machine value → customer-facing label. */
export const strainTypeLabels = Object.fromEntries(
  strainTypeDefinitions.map((d) => [d.value, d.label]),
) as Record<GreenwayStrainType, string>;

/** The two leaning-hybrid canonical values. */
export const LEANING_HYBRID_VALUES: ReadonlySet<GreenwayStrainType> = new Set<GreenwayStrainType>([
  "indica-hybrid",
  "sativa-hybrid",
]);

/** True when a value is one of the leaning-hybrid designations. */
export function isLeaningHybrid(value: string | null | undefined): boolean {
  return LEANING_HYBRID_VALUES.has((value ?? "") as GreenwayStrainType);
}

/**
 * Friendly label for a strain-type value. Unknown / non-canonical inputs get a
 * title-cased fallback (never crashes on unexpected data).
 */
export function strainTypeLabel(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (v === "") return strainTypeLabels.unknown;
  const known = strainTypeLabels[v as GreenwayStrainType];
  if (known) return known;
  // Fallback: title-case a hyphen/space separated value.
  return v
    .split(/[-\s]+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("-");
}

/**
 * Normalize ANY raw strain-type spelling seen across POS / legacy data / feeds
 * to a canonical GreenwayStrainType. This is the WEBSITE/BACK-OFFICE normalizer
 * (NOT CCRS). It intentionally recognizes the several historical spellings the
 * project accumulated so nothing already stored breaks:
 *
 *   "indica leaning hybrid" | "indica-leaning hybrid" | "indica dominant hybrid"
 *   | "indica dominant" (when clearly hybrid-y) | "indica-hybrid" | "indica hybrid"
 *   → "indica-hybrid"  (same pattern for sativa)
 *
 * Pure "indica" / "sativa" / "hybrid" / "cbd" pass through. Anything unknown →
 * "unknown". Does NOT default to hybrid (that is a CCRS behavior, kept separate).
 */
export function canonicalStrainType(raw: string | null | undefined): GreenwayStrainType {
  const s = (raw ?? "").trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (s === "") return "unknown";

  // Already-canonical hyphen tokens.
  if (s === "indica-hybrid") return "indica-hybrid";
  if (s === "sativa-hybrid") return "sativa-hybrid";

  const hasIndica = s.includes("indica");
  const hasSativa = s.includes("sativa");
  const hasHybrid = s.includes("hybrid") || s.includes("leaning") || s.includes("dominant") || s.includes("lean");

  // Leaning / dominant hybrids: one dominant terpene family + a hybrid signal.
  if (hasHybrid) {
    if (hasIndica && !hasSativa) return "indica-hybrid";
    if (hasSativa && !hasIndica) return "sativa-hybrid";
    // both present, or a plain hybrid ("50/50 hybrid", "hybrid", "blend")
    return "hybrid";
  }

  // Non-hybrid pures.
  if (s === "indica" || (hasIndica && !hasSativa)) return "indica";
  if (s === "sativa" || (hasSativa && !hasIndica)) return "sativa";
  if (s === "hybrid") return "hybrid";
  if (s === "cbd" || s.includes("cbd")) return "cbd";
  if (s === "unknown" || s === "n/a" || s === "na" || s === "none") return "unknown";

  return "unknown";
}

// ---------------------------------------------------------------------------
// Self-tests — run with: npx tsx src/lib/menu/strain-taxonomy.ts
// ---------------------------------------------------------------------------
function __runStrainTaxonomyTests() {
  let pass = 0;
  let fail = 0;
  const eq = (label: string, got: unknown, want: unknown) => {
    if (got === want) {
      pass++;
    } else {
      fail++;
      // eslint-disable-next-line no-console
      console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  };

  // canonicalStrainType — pures
  eq("indica", canonicalStrainType("indica"), "indica");
  eq("Sativa case", canonicalStrainType("Sativa"), "sativa");
  eq("hybrid", canonicalStrainType("hybrid"), "hybrid");
  eq("cbd", canonicalStrainType("CBD"), "cbd");
  eq("empty", canonicalStrainType(""), "unknown");
  eq("null", canonicalStrainType(null), "unknown");
  eq("na", canonicalStrainType("N/A"), "unknown");

  // Leaning hybrids — every legacy spelling → canonical token
  eq("indica leaning hybrid", canonicalStrainType("indica leaning hybrid"), "indica-hybrid");
  eq("sativa leaning hybrid", canonicalStrainType("sativa leaning hybrid"), "sativa-hybrid");
  eq("indica-leaning hybrid", canonicalStrainType("indica-leaning hybrid"), "indica-hybrid");
  eq("indica hybrid", canonicalStrainType("indica hybrid"), "indica-hybrid");
  eq("sativa hybrid", canonicalStrainType("sativa hybrid"), "sativa-hybrid");
  eq("indica-hybrid token", canonicalStrainType("indica-hybrid"), "indica-hybrid");
  eq("sativa-hybrid token", canonicalStrainType("sativa-hybrid"), "sativa-hybrid");
  eq("indica dominant hybrid", canonicalStrainType("Indica Dominant Hybrid"), "indica-hybrid");
  eq("sativa_dominant_hybrid underscores", canonicalStrainType("sativa_dominant_hybrid"), "sativa-hybrid");

  // Plain hybrids / both present → plain hybrid (NOT leaning)
  eq("50/50 hybrid", canonicalStrainType("50/50 hybrid"), "hybrid");
  eq("indica/sativa hybrid both", canonicalStrainType("indica sativa hybrid"), "hybrid");

  // Non-hybrid dominant → the pure lean (matches old website behavior for
  // "indica dominant" which had no hybrid word)
  eq("indica dominant (no hybrid word)", canonicalStrainType("indica dominant"), "indica-hybrid");

  // labels
  eq("label indica-hybrid", strainTypeLabel("indica-hybrid"), "Indica-Hybrid");
  eq("label sativa-hybrid", strainTypeLabel("sativa-hybrid"), "Sativa-Hybrid");
  eq("label hybrid", strainTypeLabel("hybrid"), "Hybrid");
  eq("label unknown blank", strainTypeLabel(""), "Unknown");
  eq("label fallback", strainTypeLabel("weird value"), "Weird-Value");

  // isLeaningHybrid
  eq("isLeaning indica-hybrid", isLeaningHybrid("indica-hybrid"), true);
  eq("isLeaning hybrid", isLeaningHybrid("hybrid"), false);

  // eslint-disable-next-line no-console
  console.log(`strain-taxonomy self-tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

// Node/tsx entrypoint guard (no-op in Next bundle).
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  __runStrainTaxonomyTests();
}

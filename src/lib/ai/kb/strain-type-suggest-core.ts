/**
 * src/lib/ai/kb/strain-type-suggest-core.ts
 *
 * PURE core for the "intelligent prefill" HINTS on the Strain Editor.
 *
 * Michael's idea: "cannabis isn't that different strain to strain — if the
 * system knows the type, it should offer what that profile probably looks like."
 * The honest, WA-safe way to do that (agreed with Michael): we do NOT silently
 * fill unverified facts. Instead, for a blank field, we compute the MOST COMMON
 * terpenes / aroma / flavor among the KNOWLEDGE BASE's own verified strains of
 * the SAME type (the 2,372-row STRAINS_RICH seed) and offer them as clearly
 * labeled, one-tap "house-suggested" chips. Nothing is pre-checked or saved
 * until the operator taps a chip; anything accepted is tagged in the strain's
 * `sources` as house-suggested so it stays auditable — a smart suggestion, never
 * a claimed fact about the specific strain.
 *
 * This module is PURE and deterministic (fixed dataset → fixed ranking, ties
 * broken alphabetically). No network, no server-only imports → unit-testable
 * and safe in the pure self-test harness.
 *
 * Design notes:
 *  • Leaning hybrids (indica-hybrid / sativa-hybrid) barely exist in the seed,
 *    so we widen the sampling POOL to the base types that make sense for the
 *    requested type (e.g. indica-hybrid → indica + hybrid). This grounds the
 *    suggestion in enough real rows instead of a single example.
 *  • We only ever SUGGEST from real KB data; if the pool is empty we return [].
 */
import { STRAINS_RICH } from "@/lib/ai/kb/strains-data";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** Which base seed types feed suggestions for a requested (possibly leaning) type. */
export function suggestionPoolFor(type: GreenwayStrainType): GreenwayStrainType[] {
  switch (type) {
    case "indica":
      return ["indica"];
    case "sativa":
      return ["sativa"];
    case "hybrid":
      return ["hybrid"];
    case "indica-hybrid":
      return ["indica-hybrid", "indica", "hybrid"];
    case "sativa-hybrid":
      return ["sativa-hybrid", "sativa", "hybrid"];
    case "cbd":
      // CBD is a cannabinoid designation, not a botanical lineage; the seed has
      // no meaningful CBD population, so we do not fabricate a profile for it.
      return [];
    default:
      return [];
  }
}

type Field = "terpenes" | "aroma_notes" | "flavor_notes";

/** Count occurrences of each value across the pool, then rank by frequency
 *  (desc), breaking ties alphabetically for a stable, deterministic order. */
function rankByFrequency(
  pool: readonly { [k in Field]: string[] | null | undefined }[],
  field: Field,
): string[] {
  const counts = new Map<string, number>();
  for (const row of pool) {
    const seen = new Set<string>();
    for (const raw of row[field] ?? []) {
      const t = String(raw ?? "").trim().toLowerCase();
      if (!t || seen.has(t)) continue; // count each strain at most once per value
      seen.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

/** The house-suggestion set for a strain type: top terpenes/aroma/flavor. */
export type StrainTypeSuggestion = {
  type: GreenwayStrainType;
  /** Human sentence for the UI label, e.g. "indica-hybrid". */
  poolLabel: string;
  /** Number of real KB strains the suggestion was computed from. */
  sampleSize: number;
  terpenes: string[];
  aromaNotes: string[];
  flavorNotes: string[];
};

/** Default number of chips to offer per field. */
export const STRAIN_SUGGEST_TOP_N = 6;

/**
 * Minimal row shape the suggestion math needs. Both the verified seed
 * (SeedStrainRich) and a live saved strain (KbStrainFull) can be mapped to this,
 * so the pure ranker can learn from the operator's own saved strains without
 * importing any server-only / DB code. `slug` is used to de-dupe seed vs live.
 */
export type SuggestPoolRow = {
  slug: string;
  strain_type: string | null | undefined;
  terpenes: string[] | null | undefined;
  aroma_notes: string[] | null | undefined;
  flavor_notes: string[] | null | undefined;
};

/** Options for buildStrainTypeSuggestion. */
export type BuildSuggestionOptions = {
  topN?: number;
  /**
   * Extra rows to fold into the pool alongside the verified seed — this is how
   * the suggestions LEARN OVER TIME. The page passes the operator's own ACTIVE
   * saved strains here. De-duped against the seed by slug (an extra row WINS so
   * an operator-corrected strain overrides its seed copy). Blank fields never
   * count (the ranker skips empty values), so a partially-filled saved strain
   * can't skew a field it hasn't been given.
   */
  extraRows?: SuggestPoolRow[];
};

/** Normalize any pool source (seed or live) to a SuggestPoolRow. */
function toPoolRow(r: {
  slug: string;
  strain_type: string | null | undefined;
  terpenes?: string[] | null;
  aroma_notes?: string[] | null;
  flavor_notes?: string[] | null;
}): SuggestPoolRow {
  return {
    slug: String(r.slug ?? "").trim().toLowerCase(),
    strain_type: r.strain_type,
    terpenes: r.terpenes ?? [],
    aroma_notes: r.aroma_notes ?? [],
    flavor_notes: r.flavor_notes ?? [],
  };
}

/**
 * Compute type-based house suggestions from the verified KB seed PLUS any extra
 * rows supplied (the operator's active saved strains). Deterministic given the
 * same inputs. Returns empty lists (sampleSize 0) when the type has no
 * meaningful pool.
 *
 * Backward compatible: called with just a type (or a bare topN number, the old
 * signature) it behaves exactly like the seed-only version.
 */
export function buildStrainTypeSuggestion(
  rawType: string | null | undefined,
  optsOrTopN: BuildSuggestionOptions | number = {},
): StrainTypeSuggestion {
  const opts: BuildSuggestionOptions =
    typeof optsOrTopN === "number" ? { topN: optsOrTopN } : optsOrTopN;
  const type = canonicalStrainType(rawType);
  const poolTypes = new Set(suggestionPoolFor(type));
  const n = Math.max(1, Math.floor(opts.topN ?? STRAIN_SUGGEST_TOP_N));

  // Merge seed + extra rows, de-duped by slug. Extra rows win over the seed so
  // an operator-corrected strain overrides its seed copy (never double-counted).
  const bySlug = new Map<string, SuggestPoolRow>();
  for (const s of STRAINS_RICH) {
    const row = toPoolRow(s);
    if (row.slug) bySlug.set(row.slug, row);
  }
  for (const e of opts.extraRows ?? []) {
    const row = toPoolRow(e);
    if (row.slug) bySlug.set(row.slug, row);
  }

  const pool = [...bySlug.values()].filter((s) =>
    poolTypes.has(canonicalStrainType(s.strain_type)),
  );

  const terpenes = rankByFrequency(pool, "terpenes").slice(0, n);
  const aromaNotes = rankByFrequency(pool, "aroma_notes").slice(0, n);
  const flavorNotes = rankByFrequency(pool, "flavor_notes").slice(0, n);

  return {
    type,
    poolLabel: type,
    sampleSize: pool.length,
    terpenes,
    aromaNotes,
    flavorNotes,
  };
}

/** The `sources` tag stamped when the operator accepts a house-suggested value,
 *  so future-you knows it was a grounded suggestion, not a cited fact. */
export function houseSuggestedSourceTag(type: GreenwayStrainType): string {
  return `house-suggested (${type} typical)`;
}

// ---------------------------------------------------------------------------
// Pure self-tests. Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runStrainTypeSuggestCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`strain-type-suggest-core self-test FAILED: ${msg}`);
    passed++;
  };

  // Pools resolve sensibly; CBD has no fabricated pool.
  assert(suggestionPoolFor("indica").join(",") === "indica", "indica pool");
  assert(
    suggestionPoolFor("indica-hybrid").join(",") === "indica-hybrid,indica,hybrid",
    "indica-hybrid widens the pool",
  );
  assert(suggestionPoolFor("cbd").length === 0, "cbd has no pool");

  // Indica suggestion is grounded in a real, sizeable sample and is non-empty.
  const indica = buildStrainTypeSuggestion("Indica");
  assert(indica.type === "indica", "canonicalizes requested type");
  assert(indica.sampleSize > 100, "indica sample is sizeable");
  assert(indica.terpenes.length > 0 && indica.terpenes.length <= 6, "indica terpenes 1..6");
  assert(
    indica.terpenes.every((t) => t === t.toLowerCase()),
    "suggested terpenes are lower-case",
  );

  // Determinism: two calls yield identical arrays.
  const a = buildStrainTypeSuggestion("hybrid");
  const b = buildStrainTypeSuggestion("hybrid");
  assert(JSON.stringify(a) === JSON.stringify(b), "deterministic output");

  // topN is respected.
  const three = buildStrainTypeSuggestion("sativa", 3);
  assert(three.terpenes.length <= 3, "topN caps terpene chips");

  // Leaning hybrid draws from a widened, non-empty pool (not just the 1 seed row).
  const lean = buildStrainTypeSuggestion("indica-hybrid");
  assert(lean.sampleSize > 100, "leaning hybrid uses widened pool");

  // CBD yields an empty (honest) suggestion — we never fabricate a CBD profile.
  const cbd = buildStrainTypeSuggestion("cbd");
  assert(cbd.sampleSize === 0 && cbd.terpenes.length === 0, "cbd suggestion is empty");

  // The source tag is honest + auditable.
  assert(
    houseSuggestedSourceTag("indica-hybrid") === "house-suggested (indica-hybrid typical)",
    "source tag format",
  );

  // --- Learns over time from active saved strains (extraRows) --------------
  // Baseline seed-only sample size for sativa.
  const seedSativa = buildStrainTypeSuggestion("sativa");
  // Feeding a brand-new active saved sativa (unique slug) grows the pool by 1
  // and surfaces its otherwise-rare terpene when repeated enough to rank.
  const withExtra = buildStrainTypeSuggestion("sativa", {
    extraRows: [
      {
        slug: "__test_new_sativa__",
        strain_type: "sativa",
        terpenes: ["myrcene"],
        aroma_notes: ["citrus"],
        flavor_notes: ["orange"],
      },
    ],
  });
  assert(
    withExtra.sampleSize === seedSativa.sampleSize + 1,
    "extraRows grow the pool by the number of new (unique-slug) strains",
  );

  // De-dupe by slug: an extra row that reuses a SEED slug must NOT grow the
  // count (it replaces the seed copy, so each strain is counted once).
  const seedSlug = STRAINS_RICH[0]?.slug ?? "afghani";
  const seedType = canonicalStrainType(STRAINS_RICH[0]?.strain_type);
  const dupe = buildStrainTypeSuggestion(seedType, {
    extraRows: [
      {
        slug: seedSlug,
        strain_type: seedType,
        terpenes: ["myrcene"],
        aroma_notes: ["earthy"],
        flavor_notes: ["pine"],
      },
    ],
  });
  const seedForType = buildStrainTypeSuggestion(seedType);
  assert(
    dupe.sampleSize === seedForType.sampleSize,
    "extra row reusing a seed slug does not double-count",
  );

  // No extraRows == seed-only baseline (backward compatible).
  const noExtra = buildStrainTypeSuggestion("hybrid", {});
  const bareType = buildStrainTypeSuggestion("hybrid");
  assert(
    JSON.stringify(noExtra) === JSON.stringify(bareType),
    "empty options equals seed-only baseline",
  );

  // Old numeric-topN signature still works via the union.
  const legacyTopN = buildStrainTypeSuggestion("hybrid", 2);
  assert(legacyTopN.terpenes.length <= 2, "legacy numeric topN signature still caps chips");

  console.log(`strain-type-suggest-core self-tests: ${passed} passed`);
  return { passed };
}

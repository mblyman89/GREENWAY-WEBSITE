/**
 * src/lib/ai/kb/ccrs-vocabulary-core.ts  (KB↔CCRS link, Slice 2)
 *
 * PURE brain that exposes the AUTHORITATIVE Washington CCRS inventory-type
 * vocabulary to the Knowledge Base, and checks that the KB's CCRS→category map
 * stays honest and non-contradictory.
 *
 * WHY THIS EXISTS (owner, Michael): every KB product category stores the exact
 * CCRS names it corresponds to in `wa_inventory_types[]` — that list is the
 * stable join key the intake→KB writeback now uses (Slice 1). But the editor
 * captured those names as FREE TEXT, so a typo ("Usible Cannabis") or a made-up
 * name would silently create a dead mapping the join could never hit. This
 * module makes the KB *authoritative*: the vocabulary is DERIVED from the one
 * regulator-grounded source of truth (`CCRS_INVENTORY_TYPES` +
 * `CCRS_LEGACY_TYPE_ALIASES` in compliance/ccrs-batch-core.ts, sourced from the
 * CCRS Upload User Guide Table 2 + the 2021 Data Model). We NEVER invent names.
 *
 * It also provides a consistency check so CI fails if the KB map ever drifts:
 *   • a KB category lists a CCRS name that isn't a real CCRS type, or
 *   • the same CCRS name is mapped to two different KB categories (a
 *     contradiction — one CCRS type can only derive one KB category).
 *
 * PURE + deterministic (no I/O, no server-only). ccrs-batch-core is itself pure
 * ("no server-only import so it is unit-testable with tsx and importable
 * anywhere"), so this stays safe in the pure self-test harness AND in a client
 * component (the editor).
 */

import {
  CCRS_INVENTORY_TYPES,
  CCRS_INVENTORY_CATEGORIES,
  CCRS_LEGACY_TYPE_ALIASES,
  type CcrsInventoryCategory,
} from "@/lib/compliance/ccrs-batch-core";

/** trim + lower-case + collapse internal whitespace (matches the CCRS core's own matcher). */
export function normalizeCcrsName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** One selectable CCRS type, tagged with its regulatory category + legacy flag. */
export type CcrsVocabularyEntry = {
  /** The exact CCRS spelling to store in wa_inventory_types[]. */
  name: string;
  /** The CCRS InventoryCategory this type belongs to (for grouping the picker). */
  category: CcrsInventoryCategory;
  /** True when this is a documented legacy spelling that canonicalizes to a modern name. */
  legacy: boolean;
  /** For a legacy entry, the modern name it maps to (else same as `name`). */
  canonical: string;
};

/**
 * Build the full, de-duped, deterministically-ordered CCRS type vocabulary from
 * the authoritative regulatory source. Modern names come first (grouped by CCRS
 * category, in the guide's category order, alphabetical within a category);
 * documented legacy spellings follow. PURE.
 */
export function buildCcrsTypeVocabulary(): CcrsVocabularyEntry[] {
  const out: CcrsVocabularyEntry[] = [];
  const seen = new Set<string>();

  // Modern names, grouped by CCRS category (guide order), sorted within a group.
  for (const category of CCRS_INVENTORY_CATEGORIES) {
    const types = [...(CCRS_INVENTORY_TYPES[category] ?? [])].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const name of types) {
      const key = normalizeCcrsName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, category, legacy: false, canonical: name });
    }
  }

  // Documented legacy spellings (2021 Data Model) that vendors still ship.
  // Each maps to a modern category+type from Table 2. We surface them so an
  // operator whose manifests carry the old vocabulary can still map them, but
  // we tag them legacy and carry the canonical modern name.
  const legacyEntries = Object.entries(CCRS_LEGACY_TYPE_ALIASES).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [, alias] of legacyEntries) {
    // The legacy KEY in the map is normalized; reconstruct a human label by
    // title-casing it is NOT safe (we must not invent spelling). Instead we
    // present the canonical modern name as the primary label and record that a
    // legacy alias exists — the operator picks the modern name and the intake
    // canonicalizer already accepts the legacy one on the wire.
    void alias;
  }

  return out;
}

/** Just the exact modern CCRS type names (what the picker offers by default). PURE. */
export function ccrsModernTypeNames(): string[] {
  return buildCcrsTypeVocabulary()
    .filter((e) => !e.legacy)
    .map((e) => e.name);
}

/**
 * The set of ALL names CCRS will accept (modern spellings + documented legacy
 * spellings), normalized, for membership checks. PURE.
 */
export function ccrsAcceptedNameSet(): Set<string> {
  const set = new Set<string>();
  for (const e of buildCcrsTypeVocabulary()) set.add(normalizeCcrsName(e.name));
  for (const legacyKey of Object.keys(CCRS_LEGACY_TYPE_ALIASES)) {
    set.add(normalizeCcrsName(legacyKey));
  }
  return set;
}

/** True when `name` is a real CCRS inventory type (modern or documented legacy). PURE. */
export function isKnownCcrsType(name: string | null | undefined): boolean {
  const key = normalizeCcrsName(name);
  if (!key) return false;
  return ccrsAcceptedNameSet().has(key);
}

/**
 * Canonicalize a CCRS name to its modern Table-2 spelling:
 *   • a documented legacy spelling → its modern name (via CCRS_LEGACY_TYPE_ALIASES)
 *   • an exact/normalized modern name → the exact modern spelling
 *   • otherwise → null (unknown; never invents a value)
 * PURE.
 */
export function canonicalizeCcrsTypeName(
  name: string | null | undefined,
): string | null {
  const key = normalizeCcrsName(name);
  if (!key) return null;
  const legacy = CCRS_LEGACY_TYPE_ALIASES[key];
  if (legacy) return legacy.type;
  for (const e of buildCcrsTypeVocabulary()) {
    if (!e.legacy && normalizeCcrsName(e.name) === key) return e.name;
  }
  return null;
}

/** Live-feedback partition of a set of typed/selected names, for the editor UI. */
export type CcrsNamePartition = {
  /** Names that are exact modern CCRS types (kept as-is). */
  known: string[];
  /** Legacy names + the modern name they canonicalize to (offer to upgrade). */
  legacy: { input: string; canonical: string }[];
  /** Names CCRS would not recognize (typos / invented). */
  unknown: string[];
};

/**
 * Partition a list of names into known / legacy / unknown for the editor's live
 * warnings. Order is preserved within each bucket; duplicates (normalized) are
 * collapsed. PURE.
 */
export function partitionCcrsNames(
  names: readonly (string | null | undefined)[],
): CcrsNamePartition {
  const known: string[] = [];
  const legacy: { input: string; canonical: string }[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const input = String(raw ?? "").trim();
    if (!input) continue;
    const key = normalizeCcrsName(input);
    if (seen.has(key)) continue;
    seen.add(key);

    const legacyAlias = CCRS_LEGACY_TYPE_ALIASES[key];
    if (legacyAlias) {
      legacy.push({ input, canonical: legacyAlias.type });
      continue;
    }
    const canonical = canonicalizeCcrsTypeName(input);
    if (canonical) {
      known.push(canonical);
    } else {
      unknown.push(input);
    }
  }

  return { known, legacy, unknown };
}

// ---------------------------------------------------------------------------
// KB map consistency check (fails CI on drift).
// ---------------------------------------------------------------------------

/** Minimal category shape the consistency check needs. */
export type KbCategoryForCheck = {
  id: string;
  slug: string;
  name: string;
  wa_inventory_types: string[] | null | undefined;
};

export type KbCcrsMapIssue =
  | {
      kind: "unknown-type";
      categorySlug: string;
      categoryName: string;
      /** The offending CCRS name that isn't a real CCRS type. */
      type: string;
    }
  | {
      kind: "duplicate-map";
      /** The CCRS name (canonicalized) that is claimed by 2+ KB categories. */
      type: string;
      /** The category slugs that all claim this CCRS name. */
      categorySlugs: string[];
    };

/**
 * Check the KB CCRS→category map for drift. Deterministic. PURE.
 *
 *  • "unknown-type": a KB category lists a CCRS name that CCRS wouldn't accept
 *    (typo / invented). Legacy spellings are NOT flagged (they're real).
 *  • "duplicate-map": the same CCRS type (canonicalized so a legacy + modern
 *    spelling count as one) is mapped to more than one KB category. A single
 *    CCRS type can only derive ONE website category, so this is a contradiction.
 *
 * Returns issues sorted for stable output. Empty array = healthy map.
 */
export function checkKbCcrsMapConsistency(
  categories: readonly KbCategoryForCheck[],
): KbCcrsMapIssue[] {
  const issues: KbCcrsMapIssue[] = [];

  // canonical CCRS type -> set of category slugs that claim it.
  const claimants = new Map<string, Set<string>>();

  for (const cat of categories) {
    const slug = String(cat.slug ?? cat.id);
    for (const rawType of cat.wa_inventory_types ?? []) {
      const type = String(rawType ?? "").trim();
      if (!type) continue;

      if (!isKnownCcrsType(type)) {
        issues.push({
          kind: "unknown-type",
          categorySlug: slug,
          categoryName: String(cat.name ?? ""),
          type,
        });
        continue;
      }

      // Canonicalize so legacy + modern spellings of the same type collapse to
      // one claimant key (they ARE the same regulatory type).
      const canonical = canonicalizeCcrsTypeName(type) ?? type;
      const key = normalizeCcrsName(canonical);
      if (!claimants.has(key)) claimants.set(key, new Set());
      claimants.get(key)!.add(slug);
    }
  }

  for (const [key, slugs] of claimants) {
    if (slugs.size > 1) {
      // Recover a display spelling for the type from the vocabulary.
      const display =
        buildCcrsTypeVocabulary().find((e) => normalizeCcrsName(e.name) === key)
          ?.name ?? key;
      issues.push({
        kind: "duplicate-map",
        type: display,
        categorySlugs: [...slugs].sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  // Stable ordering: unknown-type first (by slug, then type), then duplicates.
  return issues.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "unknown-type" ? -1 : 1;
    if (a.kind === "unknown-type" && b.kind === "unknown-type") {
      const s = a.categorySlug.localeCompare(b.categorySlug);
      return s !== 0 ? s : a.type.localeCompare(b.type);
    }
    if (a.kind === "duplicate-map" && b.kind === "duplicate-map") {
      return a.type.localeCompare(b.type);
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Pure self-tests. Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runCcrsVocabularyCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ccrs-vocabulary-core self-test FAILED: ${msg}`);
    passed++;
  };

  // Vocabulary is derived from the authoritative source (not hand-typed).
  const vocab = buildCcrsTypeVocabulary();
  assert(vocab.length > 0, "vocabulary is non-empty");
  const names = vocab.map((v) => v.name);
  assert(names.includes("Usable Cannabis"), "modern 'Usable Cannabis' present");
  assert(names.includes("Concentrate for Inhalation"), "'Concentrate for Inhalation' present");
  assert(names.includes("Solid Edible"), "'Solid Edible' present");
  assert(names.includes("Flower Lot"), "'Flower Lot' present");
  // No duplicates by normalized name.
  const normSet = new Set(names.map(normalizeCcrsName));
  assert(normSet.size === names.length, "no duplicate names in vocabulary");
  // Every modern entry carries a valid category.
  assert(
    vocab.every((e) => CCRS_INVENTORY_CATEGORIES.includes(e.category)),
    "every entry has a valid CCRS category",
  );

  // Known / unknown membership.
  assert(isKnownCcrsType("Usable Cannabis"), "known: Usable Cannabis");
  assert(isKnownCcrsType("  concentrate for inhalation "), "known is case/space-insensitive");
  assert(isKnownCcrsType("Usable Marijuana"), "known: documented legacy 'Usable Marijuana'");
  assert(!isKnownCcrsType("Usible Cannabis"), "typo is NOT known (never guess)");
  assert(!isKnownCcrsType(""), "empty is not known");

  // Canonicalization (legacy → modern; unknown → null).
  assert(canonicalizeCcrsTypeName("Usable Marijuana") === "Usable Cannabis", "legacy canonicalizes to modern");
  assert(canonicalizeCcrsTypeName("Marijuana Mix") === "Cannabis Mix", "legacy Marijuana Mix → Cannabis Mix");
  assert(canonicalizeCcrsTypeName("Solid Edible") === "Solid Edible", "modern canonicalizes to itself");
  assert(canonicalizeCcrsTypeName("solid edible") === "Solid Edible", "case-insensitive canonicalize");
  assert(canonicalizeCcrsTypeName("Not A Type") === null, "unknown → null (never invents)");

  // partitionCcrsNames buckets correctly and de-dupes.
  const part = partitionCcrsNames([
    "Solid Edible",
    "solid edible", // dup of the above (normalized)
    "Usable Marijuana", // legacy
    "Usible Cannabis", // typo → unknown
    "",
  ]);
  assert(part.known.length === 1 && part.known[0] === "Solid Edible", "partition known de-duped");
  assert(part.legacy.length === 1 && part.legacy[0].canonical === "Usable Cannabis", "partition legacy carries canonical");
  assert(part.unknown.length === 1 && part.unknown[0] === "Usible Cannabis", "partition unknown");

  // checkKbCcrsMapConsistency: healthy map → no issues.
  const healthy: KbCategoryForCheck[] = [
    { id: "flower", slug: "flower", name: "Flower", wa_inventory_types: ["Flower Lot"] },
    { id: "gummies", slug: "gummies", name: "Gummies", wa_inventory_types: ["Solid Edible"] },
    { id: "cart", slug: "vape-cartridge", name: "Vape Cartridge", wa_inventory_types: ["Concentrate for Inhalation"] },
  ];
  assert(checkKbCcrsMapConsistency(healthy).length === 0, "healthy map → no issues");

  // unknown-type is flagged.
  const withUnknown: KbCategoryForCheck[] = [
    { id: "x", slug: "x", name: "X", wa_inventory_types: ["Made Up Type"] },
  ];
  const un = checkKbCcrsMapConsistency(withUnknown);
  assert(un.length === 1 && un[0].kind === "unknown-type", "unknown-type flagged");

  // duplicate-map: same CCRS type on two categories (even legacy+modern spelling).
  const dup: KbCategoryForCheck[] = [
    { id: "a", slug: "a", name: "A", wa_inventory_types: ["Usable Cannabis"] },
    { id: "b", slug: "b", name: "B", wa_inventory_types: ["Usable Marijuana"] }, // legacy of the same type
  ];
  const dupIssues = checkKbCcrsMapConsistency(dup);
  assert(dupIssues.length === 1 && dupIssues[0].kind === "duplicate-map", "duplicate-map flagged across legacy+modern");
  if (dupIssues[0].kind === "duplicate-map") {
    assert(
      dupIssues[0].categorySlugs.join(",") === "a,b",
      "duplicate-map lists both category slugs, sorted",
    );
  }

  console.log(`ccrs-vocabulary-core self-tests: ${passed} passed`);
  return { passed };
}

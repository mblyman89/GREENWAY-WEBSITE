/**
 * src/lib/ai/kb/unmapped-ccrs-core.ts  (KB↔CCRS link, Slice 3 — self-growth)
 *
 * PURE brain that computes, ONCE, the list of CCRS inventory types intake has
 * actually SEEN but the KB does NOT yet map — so the operator can map each one
 * with a single click. Computed here (deterministic, never-guessing) and
 * surfaced in BOTH the KB Product-types area and the settings Types &
 * Categories page from the same result.
 *
 * WHY (owner, Michael): the KB is the source of truth for how a CCRS type
 * becomes a website category (Slice 1 links on the CCRS name; Slice 2 made the
 * name authoritative). As new products flow through receiving, brand-new CCRS
 * types (or older seed names that predate the current CCRS vocabulary) show up
 * that the KB hasn't mapped yet. This turns "the system silently doesn't know"
 * into "here's exactly what to map, newest/most-common first, one click each" —
 * so the map grows and stays compliant as CCRS evolves.
 *
 * NEVER GUESSES: a suggested KB category is offered ONLY when it is provable —
 * i.e. the canonical CCRS name is already mapped to EXACTLY ONE KB category
 * (e.g. a legacy spelling whose modern twin is already mapped). Otherwise the
 * suggestion is null and the operator chooses.
 *
 * PURE + deterministic (no I/O, no server-only). The DB loader lives in
 * unmapped-ccrs-server.ts and just feeds this the seen-types + KB categories.
 */

import {
  normalizeCcrsName,
  canonicalizeCcrsTypeName,
  isKnownCcrsType,
} from "@/lib/ai/kb/ccrs-vocabulary-core";
import { CCRS_LEGACY_TYPE_ALIASES } from "@/lib/compliance/ccrs-batch-core";

/** A distinct CCRS inventory type intake has seen, with how many lots carried it. */
export type SeenCcrsType = {
  /** The raw inventory_type string as it arrived (exact). */
  type: string;
  /** How many inventory lots carried this exact (normalized) type. */
  count: number;
};

/** Minimal KB category shape the computation needs. */
export type UnmappedKbCategory = {
  id: string;
  slug: string;
  name: string;
  group_key?: string | null;
  wa_inventory_types: string[] | null | undefined;
};

/** How a seen CCRS type relates to the authoritative CCRS vocabulary. */
export type CcrsTypeStatus =
  /** An exact current (Table-2) CCRS type. */
  | "known"
  /** A documented legacy spelling that canonicalizes to a modern name. */
  | "legacy"
  /** Not a name CCRS currently recognizes (older dialect / typo). */
  | "unrecognized";

/** One CCRS type the KB doesn't map yet — a review item. */
export type UnmappedCcrsItem = {
  /** The raw CCRS type as seen at intake (exact spelling). */
  rawType: string;
  /** Normalized key (trim/lower/collapse) used for de-dupe + matching. */
  normalized: string;
  /** How many lots carried it (drives ordering + urgency). */
  count: number;
  /** Relationship to the authoritative CCRS vocabulary. */
  status: CcrsTypeStatus;
  /** Modern CCRS spelling when resolvable (legacy→modern, or the exact modern), else null. */
  canonical: string | null;
  /**
   * A KB category slug to pre-select — ONLY when provable (the canonical name
   * is already mapped to exactly one KB category). null = operator must choose.
   * NEVER a guess.
   */
  suggestedCategorySlug: string | null;
  /** The value we recommend STORING when mapped: the canonical modern name if
   *  known, else the raw as-is (so we never invent, and prefer the current spelling). */
  storeAs: string;
};

/** Rollup for a headline badge. */
export type UnmappedCcrsSummary = {
  total: number;
  known: number;
  legacy: number;
  unrecognized: number;
  /** Total lot count across all unmapped types (how much stock is affected). */
  affectedLots: number;
};

/** Classify a raw CCRS type against the authoritative vocabulary. */
function classify(rawType: string): { status: CcrsTypeStatus; canonical: string | null } {
  const key = normalizeCcrsName(rawType);
  if (CCRS_LEGACY_TYPE_ALIASES[key]) {
    return { status: "legacy", canonical: CCRS_LEGACY_TYPE_ALIASES[key].type };
  }
  const canonical = canonicalizeCcrsTypeName(rawType);
  if (canonical && isKnownCcrsType(rawType)) {
    return { status: "known", canonical };
  }
  return { status: "unrecognized", canonical: null };
}

/**
 * Build the set of CCRS names the KB already maps, keyed by a stable identity:
 * the canonical modern name when resolvable (so a legacy spelling counts as
 * mapped when its modern twin is mapped), else the normalized raw name.
 * Returns a map key → set of category slugs that map it (to detect single vs.
 * ambiguous ownership for provable suggestions).
 */
export function buildMappedIndex(
  categories: readonly UnmappedKbCategory[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const cat of categories) {
    const slug = String(cat.slug ?? cat.id);
    for (const raw of cat.wa_inventory_types ?? []) {
      const name = String(raw ?? "").trim();
      if (!name) continue;
      const key = normalizeCcrsName(canonicalizeCcrsTypeName(name) ?? name);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(slug);
    }
  }
  return index;
}

/**
 * Compute the unmapped-CCRS review list. PURE + deterministic.
 *
 * A seen type is UNMAPPED when its stable identity (canonical modern name, or
 * normalized raw when unrecognized) is not present in the KB's mapped index.
 *
 * Ordering: most-seen first (count desc), then the raw name A→Z for stability.
 * De-dupe: two seen spellings that canonicalize to the same modern name collapse
 * into one item (their counts sum, the most-common raw spelling is shown).
 */
export function computeUnmappedCcrsTypes(
  seen: readonly SeenCcrsType[],
  categories: readonly UnmappedKbCategory[],
): UnmappedCcrsItem[] {
  const mapped = buildMappedIndex(categories);

  // Collapse seen spellings by stable identity, summing counts and keeping the
  // most-common raw spelling as the display label.
  type Agg = { rawByCount: Map<string, number>; count: number; identity: string };
  const byIdentity = new Map<string, Agg>();

  for (const s of seen) {
    const raw = String(s.type ?? "").trim();
    if (!raw) continue;
    const count = Number.isFinite(s.count) ? Math.max(0, Math.trunc(s.count)) : 0;
    const { canonical } = classify(raw);
    const identity = normalizeCcrsName(canonical ?? raw);
    if (!identity) continue;

    // Already mapped by the KB? Skip.
    if (mapped.has(identity)) continue;

    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, { rawByCount: new Map(), count: 0, identity });
    }
    const agg = byIdentity.get(identity)!;
    agg.count += count;
    agg.rawByCount.set(raw, (agg.rawByCount.get(raw) ?? 0) + count);
  }

  const items: UnmappedCcrsItem[] = [];
  for (const agg of byIdentity.values()) {
    // Pick the most-common raw spelling (tie → alpha) as the display label.
    const rawType = [...agg.rawByCount.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })[0][0];

    const { status, canonical } = classify(rawType);
    const normalized = normalizeCcrsName(rawType);

    // Provable suggestion: canonical name mapped to EXACTLY ONE KB category.
    let suggestedCategorySlug: string | null = null;
    const canonKey = normalizeCcrsName(canonical ?? rawType);
    const owners = mapped.get(canonKey);
    if (owners && owners.size === 1) {
      suggestedCategorySlug = [...owners][0];
    }

    items.push({
      rawType,
      normalized,
      count: agg.count,
      status,
      canonical,
      suggestedCategorySlug,
      storeAs: canonical ?? rawType,
    });
  }

  return items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.rawType.localeCompare(b.rawType);
  });
}

/** Roll up the review list for a headline badge. PURE. */
export function summarizeUnmapped(items: readonly UnmappedCcrsItem[]): UnmappedCcrsSummary {
  let known = 0;
  let legacy = 0;
  let unrecognized = 0;
  let affectedLots = 0;
  for (const it of items) {
    if (it.status === "known") known++;
    else if (it.status === "legacy") legacy++;
    else unrecognized++;
    affectedLots += it.count;
  }
  return { total: items.length, known, legacy, unrecognized, affectedLots };
}

// ---------------------------------------------------------------------------
// Pure self-tests. Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runUnmappedCcrsCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`unmapped-ccrs-core self-test FAILED: ${msg}`);
    passed++;
  };

  const kb: UnmappedKbCategory[] = [
    { id: "flower", slug: "flower", name: "Flower", group_key: "flower", wa_inventory_types: ["Flower Lot"] },
    { id: "gummies", slug: "gummies", name: "Gummies", group_key: "edible", wa_inventory_types: ["Solid Edible"] },
    // 'Usable Cannabis' mapped to exactly one category → provable suggestion for its legacy twin.
    { id: "usable", slug: "usable-cannabis", name: "Usable Cannabis", group_key: "flower", wa_inventory_types: ["Usable Cannabis"] },
  ];

  // A already-mapped type is NOT returned.
  const seen1: SeenCcrsType[] = [
    { type: "Flower Lot", count: 5 },
    { type: "Solid Edible", count: 3 },
  ];
  assert(computeUnmappedCcrsTypes(seen1, kb).length === 0, "all-mapped → empty");

  // An unrecognized older name IS returned, status unrecognized, no canonical.
  const seen2: SeenCcrsType[] = [{ type: "Hydrocarbon Wax", count: 4 }];
  const r2 = computeUnmappedCcrsTypes(seen2, kb);
  assert(r2.length === 1, "unrecognized returned");
  assert(r2[0].status === "unrecognized" && r2[0].canonical === null, "unrecognized has no canonical");
  assert(r2[0].storeAs === "Hydrocarbon Wax", "unrecognized stores raw as-is (never invents)");
  assert(r2[0].suggestedCategorySlug === null, "unrecognized → no guess");

  // A legacy spelling whose modern twin is ALREADY mapped → provable suggestion.
  const seen3: SeenCcrsType[] = [{ type: "Usable Marijuana", count: 7 }];
  const r3 = computeUnmappedCcrsTypes(seen3, kb);
  // 'Usable Marijuana' canonicalizes to 'Usable Cannabis', which IS mapped → so
  // by identity it's already mapped and should NOT appear as unmapped at all.
  assert(r3.length === 0, "legacy twin already mapped → not unmapped");

  // A modern KNOWN type not yet mapped → returned, status known, canonical set,
  // no suggestion (its canonical is not mapped anywhere).
  const seen4: SeenCcrsType[] = [{ type: "Tincture", count: 2 }];
  const r4 = computeUnmappedCcrsTypes(seen4, kb);
  assert(r4.length === 1 && r4[0].status === "known", "known-unmapped returned");
  assert(r4[0].canonical === "Tincture" && r4[0].storeAs === "Tincture", "known carries canonical");
  assert(r4[0].suggestedCategorySlug === null, "known-unmapped has no provable suggestion here");

  // De-dupe: two spellings of the same identity collapse, counts sum, most-common shown.
  const seen5: SeenCcrsType[] = [
    { type: "Concentrate for Inhalation", count: 2 },
    { type: "concentrate for inhalation", count: 9 }, // same identity, different case
  ];
  const r5 = computeUnmappedCcrsTypes(seen5, kb);
  assert(r5.length === 1, "case variants collapse to one");
  assert(r5[0].count === 11, "counts sum across spellings");
  assert(r5[0].rawType === "concentrate for inhalation", "most-common raw spelling shown");

  // Ordering: most-seen first.
  const seen6: SeenCcrsType[] = [
    { type: "Tincture", count: 2 },
    { type: "Suppository", count: 10 },
    { type: "Capsule", count: 5 },
  ];
  const r6 = computeUnmappedCcrsTypes(seen6, kb);
  assert(
    r6.map((x) => x.rawType).join(",") === "Suppository,Capsule,Tincture",
    "ordered by count desc",
  );

  // Summary rollup.
  const sum = summarizeUnmapped(r6);
  assert(sum.total === 3 && sum.known === 3 && sum.affectedLots === 17, "summary rollup");

  // Empty inputs → empty + zeroed summary.
  assert(computeUnmappedCcrsTypes([], kb).length === 0, "no seen → empty");
  const emptySum = summarizeUnmapped([]);
  assert(emptySum.total === 0 && emptySum.affectedLots === 0, "empty summary");

  console.log(`unmapped-ccrs-core self-tests: ${passed} passed`);
  return { passed };
}

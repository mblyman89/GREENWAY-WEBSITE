/**
 * src/lib/menu/kb-strain-overlay-core.ts — R16a
 *
 * PURE. The Knowledge Base half of the live menu's strain overlay: which keys
 * `buildMenuIndexes()` (strain-terpenes-server.ts) sets on top of the curated
 * static indexes, so a card's strain name finds its KB terpenes + type.
 *
 * WHAT THIS FIXES. The overlay used to key only on a KB row's `name` and
 * `slug` (strain-terpenes-server.ts, before R16a). But:
 *   - the strain matcher (ai/kb/strain-matcher.ts matchStrainToKb) calls an
 *     ALIAS hit, and a glue-insensitive hit ("GG #4" == "GG4", score 0.99),
 *     an exact match;
 *   - the R15b Cultivera strain fixer bulk-applies types on exactly that basis
 *     and, when the owner confirms a near-match, TEACHES the KB the Cultivera
 *     spelling as an alias (cultivera-strain-fix-store.ts saveStrainChoiceToKb).
 * Those cards got their strain TYPE written, but never their terpene profile
 * on the website, because aliases were never indexed here. The static index
 * (strain-terpenes.ts buildStaticStrainTypeIndex) always included aliases —
 * only the live KB overlay dropped them.
 *
 * Measured on the real INVENTORIES.xlsx + PRODUCTS.xlsx (3005 cards) against
 * the curated seed (2372 strains): 729 cards hit a strain by name, 50 more
 * ONLY by an alias, and 41 more ONLY by the glue-insensitive key (1 more is
 * ambiguous and is correctly left alone).
 *
 * PRIORITY (a nickname must never steal another strain's card):
 *   1. every active row's name + slug;
 *   2. aliases, only where no KB name/slug already owns that key, and only
 *      when ONE strain lists it (a shared alias is ambiguous — skipped);
 *   3. the glue-insensitive fallback key, only when ONE strain owns it.
 * Terpenes need a non-empty list; types need a canonical non-"unknown" value
 * (so a KB "unknown" can never clobber a curated type).
 */
import { alnumFallbackKey, cleanTerpenes, normalizeStrainKey } from "@/lib/menu/strain-terpenes";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import type { GreenwayStrainType } from "@/lib/leafly/types";

export type KbOverlayRow = {
  slug: string;
  name: string;
  aliases?: string[] | null;
  terpenes: string[] | null;
  strain_type: string | null;
};

export type KbOverlay = {
  terpenes: Map<string, string[]>;
  strainTypes: Map<string, GreenwayStrainType>;
  counts: { primary: number; alias: number; fallback: number; ambiguousSkipped: number };
};

export function planKbOverlay(rows: ReadonlyArray<KbOverlayRow>): KbOverlay {
  const terpenes = new Map<string, string[]>();
  const strainTypes = new Map<string, GreenwayStrainType>();
  const facts = rows.map((r) => {
    const canon = canonicalStrainType(r.strain_type);
    return {
      slug: r.slug,
      terps: cleanTerpenes(r.terpenes),
      type: canon === "unknown" ? null : canon,
      primary: [r.name, r.slug].map(normalizeStrainKey).filter((k) => k.length > 0),
      aliases: (r.aliases ?? []).map(normalizeStrainKey).filter((k) => k.length > 0),
      labels: [r.name, r.slug, ...(r.aliases ?? [])],
    };
  });
  const bySlug = new Map(facts.map((f) => [f.slug, f]));
  const put = (f: (typeof facts)[number], k: string) => {
    if (f.terps.length > 0) terpenes.set(k, f.terps);
    if (f.type) strainTypes.set(k, f.type);
  };
  const counts = { primary: 0, alias: 0, fallback: 0, ambiguousSkipped: 0 };

  // 1. names + slugs (same as before R16a: KB wins on its own name).
  const claimed = new Set<string>();
  for (const f of facts) {
    for (const k of f.primary) {
      claimed.add(k);
      put(f, k);
      counts.primary += 1;
    }
  }

  // 2. aliases — unique owner, never over a KB name.
  const uniqueOwners = (pairs: Iterable<[string, string]>): Map<string, string | null> => {
    const m = new Map<string, string | null>();
    for (const [k, slug] of pairs) {
      const prev = m.get(k);
      m.set(k, prev === undefined || prev === slug ? slug : null);
    }
    return m;
  };
  const aliasPairs: [string, string][] = [];
  for (const f of facts) for (const k of f.aliases) if (!claimed.has(k)) aliasPairs.push([k, f.slug]);
  for (const [k, slug] of uniqueOwners(aliasPairs)) {
    if (!slug) { counts.ambiguousSkipped += 1; continue; }
    put(bySlug.get(slug)!, k);
    counts.alias += 1;
  }

  // 3. glue-insensitive fallback (consulted only after an exact miss).
  const fbPairs: [string, string][] = [];
  for (const f of facts) {
    for (const l of f.labels) {
      const k = alnumFallbackKey(l);
      if (k) fbPairs.push([k, f.slug]);
    }
  }
  for (const [k, slug] of uniqueOwners(fbPairs)) {
    if (!slug) { counts.ambiguousSkipped += 1; continue; }
    put(bySlug.get(slug)!, k);
    counts.fallback += 1;
  }
  return { terpenes, strainTypes, counts };
}

// ── self-tests ─────────────────────────────────────────────────────────────
export function __runKbStrainOverlayCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL kb-strain-overlay-core: " + m);
    passed += 1;
  };
  const o = planKbOverlay([
    { slug: "gorilla glue #4", name: "Gorilla Glue #4", aliases: ["GG4", "Glue"], terpenes: ["Caryophyllene", "Myrcene"], strain_type: "hybrid" },
    { slug: "glue", name: "Glue", aliases: [], terpenes: ["limonene"], strain_type: "indica" },
    { slug: "a", name: "Alpha", aliases: ["Shared"], terpenes: ["pinene"], strain_type: "sativa" },
    { slug: "b", name: "Beta", aliases: ["Shared"], terpenes: ["linalool"], strain_type: "indica" },
    { slug: "u", name: "Mystery", aliases: ["Mys"], terpenes: [], strain_type: "unknown" },
  ]);
  ok(o.terpenes.get("gg4")?.[0] === "caryophyllene" && o.strainTypes.get("gg4") === "hybrid", "alias carries terpenes + type");
  ok(o.strainTypes.get("glue") === "indica", "an alias never steals another strain's NAME");
  ok(!o.terpenes.has("shared") && !o.strainTypes.has("shared"), "an alias two strains share is skipped");
  ok(o.strainTypes.get(alnumFallbackKey("GG #4")) === "hybrid", "glue-insensitive fallback key");
  ok(!o.strainTypes.has("mystery") && !o.terpenes.has("mys"), "unknown type / no terpenes never indexed");
  ok(o.counts.alias >= 1 && o.counts.ambiguousSkipped >= 1, "counts reported");
  return { passed, failed: 0 };
}

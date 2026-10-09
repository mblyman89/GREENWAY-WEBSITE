/**
 * strain-terpenes.ts — attach curated terpenes to menu items by strain.
 *
 * Request A (website terpene filter). Terpenes are a SENSORY/descriptive
 * attribute of the STRAIN (single source of truth = the knowledge base). We do
 * NOT track or report on them. This module resolves a menu item's dominant
 * terpene names from the matching KB strain so the website menu can offer a
 * terpene filter.
 *
 * Design (owner-approved, NO migration):
 *   - Pure core builds a name/alias -> terpenes[] index from the curated static
 *     dataset (STRAINS_RICH) so it works with zero DB (tests, preview menu).
 *   - The async variant overlays live kb_strains rows when Supabase is
 *     configured, so staff/AI-curated terpenes win. Degrades to the static
 *     index when the DB is empty / not set up.
 *
 * Matching is by normalized strain name / alias (lower + trimmed + squished).
 * No fuzzy guessing — only exact normalized matches attach terpenes. If nothing
 * matches, the item simply carries no terpenes (filter just won't include it).
 */

import type { GreenwayMenuItem, GreenwayStrainType } from "@/lib/leafly/types";
import { STRAINS_RICH } from "@/lib/ai/kb/strains-data";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";

/** Normalize a strain name/alias for matching: lower, trim, collapse whitespace. */
export function normalizeStrainKey(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Normalize a single terpene token (lower/trim). Keeps names human-readable. */
export function normalizeTerpene(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Dedupe + normalize a terpene list, preserving first-seen order. */
export function cleanTerpenes(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of list ?? []) {
    const n = normalizeTerpene(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export type TerpeneIndex = Map<string, string[]>;

/**
 * R16a — the glue-insensitive fallback key ("GG #4" == "GG4" == "gg-4").
 *
 * The strain matcher (ai/kb/strain-matcher.ts matchStrainToKb, step 2) already
 * calls an alnum-equal name an EXACT/ALIAS match (score 0.99), and the
 * Cultivera strain fixer bulk-applies types on that basis. The menu overlay
 * only looked up the whitespace-normalized key, so those same cards got the
 * type from the fixer but never their terpene profile. Fallback keys live in
 * the SAME map under a NUL prefix (a character no strain name contains), are
 * added only when ONE strain owns that alnum key (58 keys in the curated set
 * are shared by two strains and are skipped — never guess), and are consulted
 * only after the exact key misses. Keys shorter than 3 characters are never
 * indexed ("og" alone is too thin to be a fingerprint).
 */
export function alnumFallbackKey(raw: string | null | undefined): string {
  const a = (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return a.length >= 3 ? "\u0000" + a : "";
}

/**
 * Add fallback keys for many strains at once: each strain contributes the
 * alnum key of every label it has, and a key claimed by two different strains
 * is dropped. `existing` keys are never overwritten.
 */
export function addUniqueAlnumKeys<V>(
  index: Map<string, V>,
  entries: ReadonlyArray<{ id: string; labels: ReadonlyArray<string | null | undefined>; value: V }>,
): void {
  const owner = new Map<string, { id: string; value: V } | null>();
  for (const e of entries) {
    for (const l of e.labels) {
      const k = alnumFallbackKey(l);
      if (!k) continue;
      const prev = owner.get(k);
      if (prev === undefined) owner.set(k, { id: e.id, value: e.value });
      else if (prev && prev.id !== e.id) owner.set(k, null);
    }
  }
  for (const [k, v] of owner) if (v && !index.has(k)) index.set(k, v.value);
}

/** Exact key first, then the unique glue-insensitive fallback. */
function lookupStrain<V>(index: Map<string, V>, strainName: string | null | undefined): V | undefined {
  const key = normalizeStrainKey(strainName);
  if (!key) return undefined;
  const hit = index.get(key);
  if (hit !== undefined) return hit;
  const fk = alnumFallbackKey(strainName);
  return fk ? index.get(fk) : undefined;
}

/**
 * Build a normalized (name + alias) -> terpenes[] index from the curated static
 * strain dataset. Pure + dependency-light so it is unit-testable and safe on
 * the preview menu with no DB.
 */
export function buildStaticTerpeneIndex(): TerpeneIndex {
  const index: TerpeneIndex = new Map();
  for (const s of STRAINS_RICH) {
    const terps = cleanTerpenes(s.terpenes);
    if (terps.length === 0) continue;
    const keys = [s.name, s.slug, ...(s.aliases ?? [])];
    for (const k of keys) {
      const nk = normalizeStrainKey(k);
      if (!nk) continue;
      // First curated entry wins; do not clobber an existing richer mapping.
      if (!index.has(nk)) index.set(nk, terps);
    }
  }
  addUniqueAlnumKeys(
    index,
    STRAINS_RICH.filter((s) => cleanTerpenes(s.terpenes).length > 0).map((s) => ({
      id: s.slug,
      labels: [s.name, s.slug, ...(s.aliases ?? [])],
      value: cleanTerpenes(s.terpenes),
    })),
  );
  return index;
}

/** Look up terpenes for a strain name using a prebuilt index. */
export function terpenesForStrain(index: TerpeneIndex, strainName: string | null | undefined): string[] {
  return lookupStrain(index, strainName) ?? [];
}

/**
 * Attach terpenes to a list of menu items using a prebuilt index. Pure — returns
 * new item objects (does not mutate). Items with an existing non-empty
 * `terpenes` array are left as-is (respect explicit data).
 */
export function attachTerpenes(items: GreenwayMenuItem[], index: TerpeneIndex): GreenwayMenuItem[] {
  return items.map((item) => {
    if (item.terpenes && item.terpenes.length > 0) return item;
    const terps = terpenesForStrain(index, item.strainName);
    if (terps.length === 0) return item;
    return { ...item, terpenes: terps };
  });
}

// ---------------------------------------------------------------------------
// Strain TYPE overlay (Request B: leaning-hybrid filter).
//
// The public menu's `strainType` comes from a build-time static snapshot that
// never carries the website-only leaning-hybrid tokens (`indica-hybrid`,
// `sativa-hybrid`). The knowledge base (single source of truth) is where the
// owner curates a strain's type. This overlay corrects a menu item's
// `strainType` from the matching KB / curated strain so the leaning-hybrid
// values reach the menu and its (data-driven) strain-type filter.
//
// Guardrails (never guess, never lose data):
//   - Only override with a VALID, canonical type (via canonicalStrainType).
//   - NEVER downgrade a known item type to "unknown" (KB "unknown" is ignored).
//   - Only override when the KB value actually differs from the item's current
//     canonical type (otherwise leave the item untouched).
// ---------------------------------------------------------------------------

/** normalized strain key -> canonical GreenwayStrainType (never "unknown"). */
export type StrainTypeIndex = Map<string, GreenwayStrainType>;

/**
 * Build a normalized (name + slug + alias) -> canonical strain type index from
 * the curated static dataset. "unknown" canonical values are skipped so they
 * can never clobber a known menu type. First curated entry wins.
 */
export function buildStaticStrainTypeIndex(): StrainTypeIndex {
  const index: StrainTypeIndex = new Map();
  for (const s of STRAINS_RICH) {
    const canon = canonicalStrainType(s.strain_type);
    if (canon === "unknown") continue;
    const keys = [s.name, s.slug, ...(s.aliases ?? [])];
    for (const k of keys) {
      const nk = normalizeStrainKey(k);
      if (!nk) continue;
      if (!index.has(nk)) index.set(nk, canon);
    }
  }
  addUniqueAlnumKeys(
    index,
    STRAINS_RICH.flatMap((s) => {
      const canon = canonicalStrainType(s.strain_type);
      return canon === "unknown" ? [] : [{ id: s.slug, labels: [s.name, s.slug, ...(s.aliases ?? [])], value: canon }];
    }),
  );
  return index;
}

/** Look up a canonical strain type for a strain name; null if not indexed. */
export function strainTypeForStrain(
  index: StrainTypeIndex,
  strainName: string | null | undefined,
): GreenwayStrainType | null {
  return lookupStrain(index, strainName) ?? null;
}

/**
 * Attach a full strain profile (terpenes + corrected strainType) to menu items
 * using prebuilt indexes. Pure — returns new item objects (does not mutate).
 *
 *  - terpenes: same rules as attachTerpenes (respect an existing non-empty
 *    terpenes array; otherwise attach the indexed terpenes if any).
 *  - strainType: override ONLY when the KB has a valid canonical type that
 *    differs from the item's current canonical type. Never downgrade to
 *    "unknown". This is what surfaces leaning hybrids on the menu.
 */
export function attachStrainProfile(
  items: GreenwayMenuItem[],
  terpeneIndex: TerpeneIndex,
  strainTypeIndex: StrainTypeIndex,
): GreenwayMenuItem[] {
  return items.map((item) => {
    let next: GreenwayMenuItem | null = null;

    // Terpenes (respect explicit non-empty data).
    if (!(item.terpenes && item.terpenes.length > 0)) {
      const terps = terpenesForStrain(terpeneIndex, item.strainName);
      if (terps.length > 0) {
        next = { ...item, terpenes: terps };
      }
    }

    // Strain type (only a valid, different canonical type; never -> unknown).
    // R33: a person's answer for THIS product (reviewer provenance) is never
    // replaced by the strain library's value for the strain NAME.
    const kbType = item.strainTypeSource === "reviewer" ? null : strainTypeForStrain(strainTypeIndex, item.strainName);
    if (kbType && kbType !== "unknown") {
      const current = canonicalStrainType(item.strainType);
      if (kbType !== current) {
        next = { ...(next ?? item), strainType: kbType };
      }
    }

    return next ?? item;
  });
}

// ---------------------------------------------------------------------------
// Self-tests (run: npx tsx src/lib/menu/strain-terpenes.ts)
// ---------------------------------------------------------------------------
// SLICE 39: returns counts so the pure runner can assert failed === 0.
export function __runStrainTerpeneTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  const index = buildStaticTerpeneIndex();
  expect("index not empty", index.size > 0);
  // OG Kush is in the curated set with known terpenes.
  expect("og kush by name", terpenesForStrain(index, "OG Kush").length > 0);
  expect("og kush alias 'og'", terpenesForStrain(index, "og").length > 0);
  expect("case/space insensitive", terpenesForStrain(index, "  Og   Kush ").length > 0);
  expect("unknown strain -> empty", terpenesForStrain(index, "not a real strain").length === 0);
  expect("null strain -> empty", terpenesForStrain(index, null).length === 0);

  expect("cleanTerpenes dedupes", cleanTerpenes(["Myrcene", "myrcene", "Pinene"]).join(",") === "myrcene,pinene");

  const items = [
    { strainName: "OG Kush" },
    { strainName: "Totally Unknown" },
    { strainName: "Durban Poison", terpenes: ["preset"] },
  ] as unknown as GreenwayMenuItem[];
  const out = attachTerpenes(items, index);
  expect("attach adds terpenes to known", (out[0].terpenes ?? []).length > 0);
  expect("attach leaves unknown empty", !out[1].terpenes || out[1].terpenes.length === 0);
  expect("attach respects preset", out[2].terpenes?.[0] === "preset");

  // --- Strain-type overlay tests ---
  const typeIndex = buildStaticStrainTypeIndex();
  expect("type index not empty", typeIndex.size > 0);
  // Durban Poison is curated as sativa.
  expect("durban poison -> sativa", strainTypeForStrain(typeIndex, "Durban Poison") === "sativa");
  expect("unknown strain -> null type", strainTypeForStrain(typeIndex, "not a real strain") === null);

  // A synthetic index that maps a strain to a leaning hybrid proves the
  // override path surfaces leaning-hybrid values on the menu.
  const leanIndex: StrainTypeIndex = new Map([[normalizeStrainKey("Test Lean"), "indica-hybrid"]]);
  const profileItems = [
    { strainName: "Test Lean", strainType: "hybrid" },
    { strainName: "Durban Poison", strainType: "hybrid" }, // curated sativa -> should correct
    { strainName: "No Match", strainType: "indica" }, // untouched
  ] as unknown as GreenwayMenuItem[];
  const prof = attachStrainProfile(profileItems, index, typeIndex);
  // First item only in leanIndex, not typeIndex -> use leanIndex separately.
  const profLean = attachStrainProfile([profileItems[0]], index, leanIndex);
  expect("override to leaning hybrid", profLean[0].strainType === "indica-hybrid");
  expect("curated corrects hybrid->sativa", prof[1].strainType === "sativa");
  expect("no-match item untouched", prof[2].strainType === "indica");

  // Never downgrade a known type to unknown.
  const unknownIndex: StrainTypeIndex = new Map([[normalizeStrainKey("Keep Me"), "unknown" as GreenwayStrainType]]);
  const keepItems = [{ strainName: "Keep Me", strainType: "sativa" }] as unknown as GreenwayMenuItem[];
  const kept = attachStrainProfile(keepItems, index, unknownIndex);
  expect("never downgrade to unknown", kept[0].strainType === "sativa");

  // R16a: glue-insensitive fallback + ambiguity refusal.
  const fb: TerpeneIndex = new Map([[normalizeStrainKey("GG4"), ["caryophyllene"]]]);
  addUniqueAlnumKeys(fb, [
    { id: "gg4", labels: ["GG4"], value: ["caryophyllene"] },
    { id: "a", labels: ["Zed Kush"], value: ["myrcene"] },
    { id: "b", labels: ["Zed-Kush"], value: ["limonene"] },
  ]);
  expect("alnum fallback: 'GG #4' finds GG4", terpenesForStrain(fb, "GG #4")[0] === "caryophyllene");
  expect("alnum fallback: a key two strains share is refused", terpenesForStrain(fb, "zedkush").length === 0);
  expect("alnum fallback: exact key still wins", terpenesForStrain(fb, "gg4")[0] === "caryophyllene");
  expect("alnum fallback: < 3 chars never indexed", alnumFallbackKey("o g") === "");
  expect("alnum fallback key never collides with a normalized key", alnumFallbackKey("abc").startsWith("\u0000"));

  console.log(`strain-terpenes self-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
  return { passed, failed };
}

// SLICE 39: the standalone `require.main === module` entry guard was removed —
// this suite now runs in CI via scripts/compliance/run-pure-selftests.ts
// (which asserts failed === 0), and the guard tripped eslint's
// no-assign-module-variable rule.

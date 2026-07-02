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

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { STRAINS_RICH } from "@/lib/ai/kb/strains-data";

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
  return index;
}

/** Look up terpenes for a strain name using a prebuilt index. */
export function terpenesForStrain(index: TerpeneIndex, strainName: string | null | undefined): string[] {
  const key = normalizeStrainKey(strainName);
  if (!key) return [];
  return index.get(key) ?? [];
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
// Self-tests (run: npx tsx src/lib/menu/strain-terpenes.ts)
// ---------------------------------------------------------------------------
export function __runStrainTerpeneTests(): void {
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

  console.log(`strain-terpenes self-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
}

// Node ESM/tsx entry guard.
declare const require: { main?: unknown } | undefined;
declare const module: unknown;
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  __runStrainTerpeneTests();
}

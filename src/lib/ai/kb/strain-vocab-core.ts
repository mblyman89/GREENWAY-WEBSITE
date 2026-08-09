/**
 * src/lib/ai/kb/strain-vocab-core.ts
 *
 * PURE builder for the Strain Editor's SMART SELECTOR option lists.
 *
 * Michael asked for pick-from-a-list controls instead of free text, backed by
 * "every terpene and other ways to describe cannabis we already have." The most
 * grounded, canonical sources we have are:
 *   • terpene names            → the terpene multi-select options,
 *   • each terpene's aroma_notes/flavor_notes → the aroma/flavor options,
 *   • the verified STRAINS_RICH seed → any additional real aroma/flavor/terpene
 *     words actually used across the library (so the picker matches reality).
 *
 * We union these, de-dupe (case-insensitive), and sort alphabetically for a
 * stable, scannable list. PURE + deterministic → unit-testable, no network.
 * The server page supplies the live terpene rows; if the DB is empty we still
 * fall back to the seed so the pickers are never blank in preview/tests.
 */
import { STRAINS_RICH } from "@/lib/ai/kb/strains-data";

/** Minimal shape we need from a terpene reference row (matches KbTerpeneRow). */
export type TerpeneVocabRow = {
  name: string;
  aroma_notes?: string[] | null;
  flavor_notes?: string[] | null;
};

/** The three option lists the Strain Editor's multi-selects render. */
export type StrainVocab = {
  terpenes: string[];
  aromaNotes: string[];
  flavorNotes: string[];
};

/** De-dupe (case-insensitive) + sort a list of terms. Trims + drops blanks. */
function normalizeOptions(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const t = String(raw ?? "").trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Build the option lists. Terpene names come from the reference rows (falling
 * back to seed terpenes); aroma/flavor come from the terpene rows' notes PLUS
 * the real words used across the verified strain seed.
 */
export function buildStrainVocab(terpeneRows: readonly TerpeneVocabRow[]): StrainVocab {
  const terpeneNames: string[] = [];
  const aroma: string[] = [];
  const flavor: string[] = [];

  for (const row of terpeneRows) {
    if (row.name) terpeneNames.push(row.name);
    for (const a of row.aroma_notes ?? []) aroma.push(a);
    for (const f of row.flavor_notes ?? []) flavor.push(f);
  }

  // Ground in the verified strain seed too (this is the source of truth that
  // ships with the app, so the pickers work even before the DB is seeded).
  for (const s of STRAINS_RICH) {
    for (const t of s.terpenes ?? []) terpeneNames.push(t);
    for (const a of s.aroma_notes ?? []) aroma.push(a);
    for (const f of s.flavor_notes ?? []) flavor.push(f);
  }

  return {
    terpenes: normalizeOptions(terpeneNames),
    aromaNotes: normalizeOptions(aroma),
    flavorNotes: normalizeOptions(flavor),
  };
}

// ---------------------------------------------------------------------------
// Pure self-tests. Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runStrainVocabCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`strain-vocab-core self-test FAILED: ${msg}`);
    passed++;
  };

  // With no live terpene rows we still get grounded options from the seed.
  const seedOnly = buildStrainVocab([]);
  assert(seedOnly.terpenes.length > 0, "seed yields terpene options");
  assert(seedOnly.aromaNotes.length > 0, "seed yields aroma options");
  assert(seedOnly.flavorNotes.length > 0, "seed yields flavor options");
  assert(seedOnly.terpenes.includes("myrcene"), "seed includes myrcene");

  // Options are lower-cased, sorted, and de-duped.
  const withRows = buildStrainVocab([
    { name: "Myrcene", aroma_notes: ["Earthy", "earthy"], flavor_notes: ["Herbal"] },
    { name: "Limonene", aroma_notes: ["Citrus"], flavor_notes: ["Citrus"] },
  ]);
  assert(withRows.terpenes.includes("myrcene"), "row name lower-cased");
  assert(withRows.terpenes.includes("limonene"), "second row included");
  assert(
    withRows.aromaNotes.filter((x) => x === "earthy").length === 1,
    "aroma de-duped case-insensitively",
  );
  const sorted = [...withRows.terpenes].sort((a, b) => a.localeCompare(b));
  assert(JSON.stringify(sorted) === JSON.stringify(withRows.terpenes), "terpenes sorted");

  console.log(`strain-vocab-core self-tests: ${passed} passed`);
  return { passed };
}

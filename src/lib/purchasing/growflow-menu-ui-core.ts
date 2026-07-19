/**
 * src/lib/purchasing/growflow-menu-ui-core.ts
 *
 * GF-8 — PURE display + ordering helpers for the GrowFlow snapshot browser.
 * No I/O, no React, deterministic; self-tested in the pure runner and mirrored
 * in vitest.
 *
 * WHY THIS EXISTS (verified, not guessed):
 *   The GrowFlow card title was rendering the LISTING name (`name`, from
 *   GrowFlow's `o.Name`) which for Bot Farm is the generic package label
 *   "Flower 3.5g Bot" — the SAME string on every card. The real strain name
 *   ("Bowser", "Cherry Berry", "Jaws"…) lives in `o.StrainName`, which the
 *   normalizer captured but the DB row shape never surfaced as its own column
 *   (migration 0125 has no strain_name). It IS preserved verbatim in the
 *   row's `raw` jsonb, so we read it from there at render time — no migration,
 *   works on snapshots already fetched.
 *
 *   The owner also asked for the grid to be SORTED: cards alphabetically by the
 *   product/strain name, and where the same product has multiple sizes, those
 *   variants ordered smallest → largest (1g before 3.5g before 7g). This module
 *   provides the pure comparator so the server page can sort before rendering.
 */

import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";

/** The subset of a saved GrowFlow item row these helpers read (structural). */
export type GrowflowDisplayRowLike = {
  name: string | null;
  size_label: string | null;
  raw: Record<string, unknown> | null | undefined;
};

/** Case-insensitive read of a string field from a raw jsonb object. */
function rawText(raw: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>)[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * The name to show as the card TITLE. Prefers the real strain name
 * (`raw.StrainName`) — the thing printed on the product artwork — and falls
 * back to the listing `name` when no strain name was provided, and finally to
 * a safe placeholder. Never returns empty.
 */
export function growflowDisplayName(row: GrowflowDisplayRowLike): string {
  const strain = rawText(row.raw, "StrainName");
  if (strain) return strain;
  const name = (row.name ?? "").trim();
  if (name) return name;
  return "(unnamed item)";
}

/**
 * The secondary line under the title — the listing/package descriptor. When
 * the title is the strain name, this shows the listing `name` (e.g. the
 * "Flower 3.5g Bot" package label) so no information is lost; when the title
 * already fell back to `name`, this returns "" (nothing to repeat).
 */
export function growflowListingSubtitle(row: GrowflowDisplayRowLike): string {
  const strain = rawText(row.raw, "StrainName");
  if (!strain) return "";
  const name = (row.name ?? "").trim();
  // Don't repeat the strain if the listing name IS the strain.
  if (!name || name.toLowerCase() === strain.toLowerCase()) return "";
  return name;
}

/**
 * Sort key for one row: [displayNameLower, grams, sizeLabelLower, name].
 * Cards order alphabetically (case-insensitive) by display name; within the
 * same display name, smaller sizes come first (grams ascending; unknown-size
 * labels sort AFTER known weights, then alphabetically by their label). The
 * final `name` tie-breaker keeps the order stable and deterministic.
 */
export function growflowSortKey(row: GrowflowDisplayRowLike): [string, number, string, string] {
  const display = growflowDisplayName(row).toLowerCase();
  const grams = gramsFromVariantLabel(row.size_label);
  // Unknown grams sort last among same-name rows.
  const gramsKey = grams == null ? Number.POSITIVE_INFINITY : grams;
  const sizeKey = (row.size_label ?? "").trim().toLowerCase();
  const nameKey = (row.name ?? "").trim().toLowerCase();
  return [display, gramsKey, sizeKey, nameKey];
}

/**
 * Compare two rows for the sorted grid. Stable, total order using
 * growflowSortKey. Alphabetical by display name, then size ascending.
 */
export function compareGrowflowRows(a: GrowflowDisplayRowLike, b: GrowflowDisplayRowLike): number {
  const ka = growflowSortKey(a);
  const kb = growflowSortKey(b);
  // [0] display name
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  // [1] grams
  if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
  // [2] size label
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1;
  // [3] listing name
  if (ka[3] !== kb[3]) return ka[3] < kb[3] ? -1 : 1;
  return 0;
}

/**
 * Return a NEW array of rows sorted for the grid (alphabetical by display
 * name, then size ascending). Does not mutate the input.
 */
export function sortGrowflowRows<T extends GrowflowDisplayRowLike>(rows: T[]): T[] {
  return [...rows].sort(compareGrowflowRows);
}

/** The subset used for text search — adds the searchable listing fields. */
export type GrowflowSearchRowLike = GrowflowDisplayRowLike & {
  brand: string | null;
  category: string | null;
  strain_type: string | null;
};

/**
 * Text search for the GrowFlow grid. Unlike the shared Cultivera filter, this
 * ALSO matches the real strain name (raw.StrainName) — which is now the card
 * title — so typing "Bowser" finds the card even though the listing `name` is
 * the generic "Flower 3.5g Bot". Case-insensitive; empty query returns all.
 */
export function filterGrowflowRows<T extends GrowflowSearchRowLike>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const fields = [
      growflowDisplayName(r),
      r.name,
      r.brand,
      r.category,
      r.strain_type,
      r.size_label,
    ];
    return fields.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
  });
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`growflow-menu-ui-core self-test failed: ${msg}`);
}

function mk(over: Partial<GrowflowDisplayRowLike>): GrowflowDisplayRowLike {
  return { name: null, size_label: null, raw: {}, ...over };
}

export function __runGrowflowMenuUiCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // growflowDisplayName — strain name wins over listing name.
  ok(
    growflowDisplayName(mk({ name: "Flower 3.5g Bot", raw: { StrainName: "Bowser" } })) === "Bowser",
    "strain name preferred over listing name",
  );
  ok(
    growflowDisplayName(mk({ name: "Blue Dream Preroll", raw: {} })) === "Blue Dream Preroll",
    "falls back to listing name when no strain",
  );
  ok(
    growflowDisplayName(mk({ name: "  ", raw: { StrainName: "  Jaws  " } })) === "Jaws",
    "trims strain name",
  );
  ok(
    growflowDisplayName(mk({ name: null, raw: null })) === "(unnamed item)",
    "safe placeholder when nothing",
  );
  ok(
    growflowDisplayName(mk({ name: "X", raw: { StrainName: "" } })) === "X",
    "empty StrainName falls through to name",
  );

  // growflowListingSubtitle — shows listing name only when title is the strain.
  ok(
    growflowListingSubtitle(mk({ name: "Flower 3.5g Bot", raw: { StrainName: "Bowser" } })) ===
      "Flower 3.5g Bot",
    "subtitle is the listing name when strain is the title",
  );
  ok(
    growflowListingSubtitle(mk({ name: "Blue Dream", raw: {} })) === "",
    "no subtitle when title already is the listing name",
  );
  ok(
    growflowListingSubtitle(mk({ name: "Bowser", raw: { StrainName: "bowser" } })) === "",
    "no subtitle when listing name equals strain (case-insensitive)",
  );

  // growflowSortKey — grams parsed for ordering.
  const k1 = growflowSortKey(mk({ name: "L", size_label: "3.5g", raw: { StrainName: "Zeta" } }));
  ok(k1[0] === "zeta" && k1[1] === 3.5, "sort key display + grams");
  const kUnknown = growflowSortKey(mk({ size_label: "10pk", raw: { StrainName: "Zeta" } }));
  ok(kUnknown[1] === Number.POSITIVE_INFINITY, "unknown-size grams sort last");

  // sortGrowflowRows — alphabetical by strain, then size ascending.
  const rows = [
    mk({ name: "Flower 7g Bot", size_label: "7g", raw: { StrainName: "Bowser" } }),
    mk({ name: "Flower 1g Bot", size_label: "1g", raw: { StrainName: "Bowser" } }),
    mk({ name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Bowser" } }),
    mk({ name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Alpha" } }),
    mk({ name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "cherry berry" } }),
  ];
  const sorted = sortGrowflowRows(rows);
  ok(growflowDisplayName(sorted[0]) === "Alpha", "Alpha first (alphabetical)");
  ok(
    growflowDisplayName(sorted[1]) === "Bowser" && sorted[1].size_label === "1g",
    "Bowser 1g before its bigger sizes",
  );
  ok(sorted[2].size_label === "3.5g", "Bowser 3.5g second");
  ok(sorted[3].size_label === "7g", "Bowser 7g third");
  ok(growflowDisplayName(sorted[4]) === "cherry berry", "cherry berry last");
  // Does not mutate input.
  ok(rows[0].size_label === "7g", "sortGrowflowRows does not mutate input");

  // filterGrowflowRows — matches strain name (raw.StrainName) too.
  const searchRows = [
    { name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Bowser" }, brand: "Bot Farm", category: "Flower", strain_type: "indica" },
    { name: "Flower 3.5g Bot", size_label: "3.5g", raw: { StrainName: "Cherry Berry" }, brand: "Bot Farm", category: "Flower", strain_type: "indica" },
  ];
  ok(filterGrowflowRows(searchRows, "bowser").length === 1, "search matches strain name");
  ok(filterGrowflowRows(searchRows, "cherry").length === 1, "search matches other strain");
  ok(filterGrowflowRows(searchRows, "bot farm").length === 2, "search matches brand");
  ok(filterGrowflowRows(searchRows, "flower").length === 2, "search matches listing name");
  ok(filterGrowflowRows(searchRows, "").length === 2, "empty query returns all");
  ok(filterGrowflowRows(searchRows, "zzz").length === 0, "no match returns none");

  console.log(`growflow-menu-ui-core: ${n} self-tests passed`);
}

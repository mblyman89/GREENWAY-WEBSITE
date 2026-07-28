/**
 * SLICE 78 — the category REGISTRY core (pure, deterministic, no I/O).
 *
 * THE PROBLEM THIS SOLVES: the owner can add/rename/hide website categories at
 * /admin/settings/types (DB table website_category_types, migration 0035), but
 * the customer-facing menu, the product pages, the reports, and the intake
 * onboarding flow all kept using the HARDCODED taxonomy in
 * category-taxonomy.ts — so edits never propagated. This module is the single
 * pure brain that every surface now shares:
 *
 *   - buildCategoryLabelMap: DB rows → value→label map (serializable, so the
 *     server can hand it to client components).
 *   - labelForCategory: map lookup with the SAME title-case fallback the old
 *     formatWebsiteCategory used — unknown values still render readably.
 *   - validateCategoryDraft: create/edit gatekeeper (label required, URL-safe
 *     slug derivation, duplicate refusal, sort order) with plain-English errors.
 *   - buildReassignPlan: the bulk-reassign preview — validates the move and
 *     produces the plain-English "what will change" lines shown before, and
 *     recorded in the audit trail after, the move.
 *   - findOrphanCategoryValues: menu items whose category value is missing
 *     from the registry (deleted/typo'd) — surfaced instead of silently
 *     falling back.
 */

/** Minimal registry row shape (matches WebsiteCategoryType where it matters). */
export type CategoryRegistryRow = {
  value: string;
  label: string;
  is_active?: boolean;
};

/** value → label map. Serializable: safe to pass from server to client. */
export function buildCategoryLabelMap(
  rows: readonly CategoryRegistryRow[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const value = (r.value ?? "").trim();
    const label = (r.label ?? "").trim();
    if (value && label) map[value] = label;
  }
  return map;
}

/** Title-case fallback for unknown values ("popcorn-bud" → "Popcorn Bud"). */
function titleCaseSlug(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Resolve a category value to its display label: registry first, then the
 * readable title-case fallback (never a raw slug, never a crash).
 */
export function labelForCategory(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return map[v] ?? titleCaseSlug(v);
}

// ---------------------------------------------------------------------------
// Create / edit validation
// ---------------------------------------------------------------------------

const MAX_LABEL = 60;
const MAX_SLUG = 60;

/** URL-safe slug: lowercase, alphanumerics + single dashes, max 60 chars. */
export function slugifyCategoryValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG);
}

export type CategoryDraftParse =
  | { ok: true; value: string; label: string; sort_order: number }
  | { ok: false; error: string };

/**
 * Validate a create/edit submission for a website category.
 * existingValues = the registry's current values (duplicate refusal).
 */
export function validateCategoryDraft(raw: {
  label?: string | null;
  value?: string | null;
  sort_order?: string | number | null;
  existingValues: readonly string[];
}): CategoryDraftParse {
  const label = String(raw.label ?? "").trim();
  if (!label) return { ok: false, error: "A label is required — that's the name shoppers see." };
  if (label.length > MAX_LABEL) {
    return { ok: false, error: `The label is too long (max ${MAX_LABEL} characters).` };
  }

  const requested = String(raw.value ?? "").trim();
  const value = slugifyCategoryValue(requested || label);
  if (!value) {
    return { ok: false, error: "Could not derive a URL-safe value from that label — try letters and numbers." };
  }
  if (raw.existingValues.includes(value)) {
    return { ok: false, error: `A category with the value "${value}" already exists — edit that one instead.` };
  }

  const sortNum = Number(raw.sort_order);
  const sort_order = Number.isFinite(sortNum) && sortNum >= 0 ? Math.floor(sortNum) : 999;

  return { ok: true, value, label, sort_order };
}

// ---------------------------------------------------------------------------
// Bulk reassign
// ---------------------------------------------------------------------------

/** How many rows each surface would touch (all counted from REAL tables). */
export type ReassignCounts = {
  /** menu_items rows on the LIVE published menu version. */
  publishedItems: number;
  /** menu_items rows on staged (not yet published) versions. */
  stagedItems: number;
  /** catalog_product_drafts rows whose approver picked the source category. */
  draftPicks: number;
  /** inventory_types rows mapped to the source category (drives future intake). */
  typeMappings: number;
};

export type ReassignPlan =
  | {
      ok: true;
      /** Plain-English "what will change" lines (preview + audit trail). */
      lines: string[];
      /** Total rows across all surfaces. */
      total: number;
    }
  | { ok: false; error: string };

/**
 * Validate a bulk category move and describe it in plain English.
 * Rules: source ≠ target; both must exist in the registry; the target must be
 * ACTIVE (never bulk-move products INTO a hidden category).
 */
export function buildReassignPlan(input: {
  from: string;
  to: string;
  registry: readonly CategoryRegistryRow[];
  counts: ReassignCounts;
}): ReassignPlan {
  const from = input.from.trim();
  const to = input.to.trim();
  if (!from || !to) return { ok: false, error: "Pick both a source and a target category." };
  if (from === to) return { ok: false, error: "The source and target categories are the same — nothing to move." };

  const fromRow = input.registry.find((r) => r.value === from);
  const toRow = input.registry.find((r) => r.value === to);
  if (!fromRow) return { ok: false, error: `"${from}" isn't one of your categories.` };
  if (!toRow) return { ok: false, error: `"${to}" isn't one of your categories.` };
  if (toRow.is_active === false) {
    return {
      ok: false,
      error: `"${toRow.label}" is hidden — products can't be moved into a hidden category. Re-activate it first.`,
    };
  }

  const c = input.counts;
  const lines: string[] = [];
  if (c.publishedItems > 0) {
    lines.push(
      `${c.publishedItems} product${c.publishedItems === 1 ? "" : "s"} on the LIVE menu move from "${fromRow.label}" to "${toRow.label}" (the customer site updates immediately).`,
    );
  }
  if (c.stagedItems > 0) {
    lines.push(
      `${c.stagedItems} product${c.stagedItems === 1 ? "" : "s"} on staged (not yet published) menu drafts move too, so the next publish agrees.`,
    );
  }
  if (c.draftPicks > 0) {
    lines.push(
      `${c.draftPicks} onboarding draft pick${c.draftPicks === 1 ? "" : "s"} update from "${fromRow.label}" to "${toRow.label}".`,
    );
  }
  if (c.typeMappings > 0) {
    lines.push(
      `${c.typeMappings} inventory-type mapping${c.typeMappings === 1 ? "" : "s"} now point at "${toRow.label}", so FUTURE intake lands there as well.`,
    );
  }
  const total = c.publishedItems + c.stagedItems + c.draftPicks + c.typeMappings;
  if (total === 0) {
    lines.push(`Nothing currently uses "${fromRow.label}" — the move would change no rows.`);
  }
  return { ok: true, lines, total };
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

/**
 * Category values that appear on live data but are MISSING from the registry
 * (deleted rows, import typos). Unique, sorted, empty values ignored.
 */
export function findOrphanCategoryValues(
  itemValues: readonly (string | null | undefined)[],
  registryValues: readonly string[],
): string[] {
  const known = new Set(registryValues);
  const orphans = new Set<string>();
  for (const raw of itemValues) {
    const v = (raw ?? "").trim();
    if (v && !known.has(v)) orphans.add(v);
  }
  return [...orphans].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runCategoryRegistryCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL category-registry-core: " + msg);
    passed += 1;
  };

  const registry: CategoryRegistryRow[] = [
    { value: "flower", label: "Flower", is_active: true },
    { value: "preroll", label: "Preroll", is_active: true },
    { value: "trim", label: "Trim & Shake", is_active: false },
  ];

  // Label map + resolution.
  const map = buildCategoryLabelMap(registry);
  ok(map["flower"] === "Flower", "map carries DB label");
  ok(map["trim"] === "Trim & Shake", "map carries RENAMED label (propagation!)");
  ok(labelForCategory(map, "trim") === "Trim & Shake", "DB label wins");
  ok(labelForCategory(map, "popcorn-bud") === "Popcorn Bud", "unknown falls back to title case");
  ok(labelForCategory(map, null) === "", "null → empty string");
  ok(labelForCategory(map, "  ") === "", "blank → empty string");
  ok(buildCategoryLabelMap([{ value: " ", label: "x" }, { value: "a", label: " " }])["a"] === undefined,
    "blank values/labels skipped");

  // Slug rules.
  ok(slugifyCategoryValue("Live Resin!") === "live-resin", "slugify strips punctuation");
  ok(slugifyCategoryValue("--Weird -- Name--") === "weird-name", "slugify collapses dashes");
  ok(slugifyCategoryValue("x".repeat(80)).length === 60, "slug capped at 60");

  // Create/edit validation.
  const good = validateCategoryDraft({ label: "Live Resin", existingValues: ["flower"], sort_order: "40" });
  ok(good.ok, "valid draft accepted");
  if (good.ok) {
    ok(good.value === "live-resin", "value auto-derived from label");
    ok(good.sort_order === 40, "sort order parsed");
  }
  ok(!validateCategoryDraft({ label: "", existingValues: [] }).ok, "empty label refused");
  ok(!validateCategoryDraft({ label: "x".repeat(61), existingValues: [] }).ok, "over-long label refused");
  ok(!validateCategoryDraft({ label: "Flower", existingValues: ["flower"] }).ok, "duplicate value refused");
  ok(!validateCategoryDraft({ label: "!!!", existingValues: [] }).ok, "unsluggable label refused");
  const defSort = validateCategoryDraft({ label: "New", existingValues: [], sort_order: "junk" });
  ok(defSort.ok && defSort.sort_order === 999, "junk sort order defaults to 999");
  const explicit = validateCategoryDraft({ label: "New", value: "My Slug", existingValues: [] });
  ok(explicit.ok && explicit.value === "my-slug", "explicit value slugified");

  // Reassign plan.
  const counts: ReassignCounts = { publishedItems: 3, stagedItems: 2, draftPicks: 1, typeMappings: 4 };
  const plan = buildReassignPlan({ from: "preroll", to: "flower", registry, counts });
  ok(plan.ok, "valid move accepted");
  if (plan.ok) {
    ok(plan.total === 10, "total sums all four surfaces");
    ok(plan.lines.length === 4, "one line per touched surface");
    ok(plan.lines[0].includes("LIVE menu") && plan.lines[0].includes("3"), "live-menu line reads plainly");
    ok(plan.lines[3].includes("FUTURE intake"), "type-mapping line explains future intake");
  }
  const same = buildReassignPlan({ from: "flower", to: "flower", registry, counts });
  ok(!same.ok, "same source/target refused");
  const unknown = buildReassignPlan({ from: "nope", to: "flower", registry, counts });
  ok(!unknown.ok, "unknown source refused");
  const hidden = buildReassignPlan({ from: "flower", to: "trim", registry, counts });
  ok(!hidden.ok, "hidden target refused");
  if (!hidden.ok) ok(hidden.error.includes("hidden"), "hidden-target error reads plainly");
  const empty = buildReassignPlan({
    from: "preroll",
    to: "flower",
    registry,
    counts: { publishedItems: 0, stagedItems: 0, draftPicks: 0, typeMappings: 0 },
  });
  ok(empty.ok && empty.total === 0, "empty move allowed but total 0");
  if (empty.ok) ok(empty.lines[0].includes("no rows"), "empty move says so plainly");

  // Orphans.
  const orphans = findOrphanCategoryValues(
    ["flower", "mystery-cat", null, "", "zzz-old", "mystery-cat"],
    ["flower", "preroll", "trim"],
  );
  ok(orphans.length === 2, "two unique orphans found");
  ok(orphans[0] === "mystery-cat" && orphans[1] === "zzz-old", "orphans sorted");
  ok(findOrphanCategoryValues(["flower"], ["flower"]).length === 0, "no false orphans");

  return { passed };
}

/**
 * src/lib/pos/type-registry-core.ts  (SLICE 92)
 *
 * PURE brain for owner-created PRODUCT TYPES - the type-side twin of
 * category-registry-core.ts (SLICE 78). Vendors constantly invent new types;
 * the owner asked to create them WITHOUT leaving Product Onboarding, wired to
 * the same registry the Types & Categories settings page manages
 * (inventory_types, migration 0035 - no new migration needed).
 *
 *   - validateInventoryTypeDraft: the onboarding create gatekeeper (label
 *     required, length cap, canonical-key derivation, duplicate refusal
 *     against the hardcoded catalog AND the live DB rows) with plain-English
 *     errors. The settings page's own create keeps its optional custom-key
 *     path; both write the SAME inventory_types table with the SAME audit
 *     action, so everything stays in one registry.
 *   - mergeOwnerTypesIntoGroups: folds owner-created DB types into the
 *     grouped catalog picker (under their mapped website category, or an
 *     "Other types" group when unmapped) so a type created yesterday is a
 *     one-click pick today.
 *
 * PURE: no I/O, no React, no server-only imports. tsx-unit-testable.
 */
import {
  INVENTORY_TYPE_CATALOG,
  inventoryTypeKey,
  type CatalogGroup,
} from "@/lib/pos/inventory-type-catalog";

/** Same cap the category registry enforces - labels are UI-visible. */
const MAX_LABEL = 60;

/** Group key/label for owner types without a website-category mapping. */
export const UNGROUPED_TYPES_CATEGORY = "__owner_other__";
export const UNGROUPED_TYPES_LABEL = "Other types";

export type InventoryTypeDraftParse =
  | { ok: true; key: string; label: string }
  | { ok: false; error: string };

/**
 * Validate a new product-type submission against the LIVE vocabulary
 * (hardcoded catalog keys + DB registry keys, both passed in - stays pure).
 * The canonical key is the lowercase single-spaced form of the label, the
 * same convention inventoryTypeKey / types-store use for matching.
 */
export function validateInventoryTypeDraft(raw: {
  label?: string | null;
  /** Canonical keys already taken (DB rows; catalog keys are added here). */
  existingKeys: readonly string[];
}): InventoryTypeDraftParse {
  const label = String(raw.label ?? "").trim().replace(/\s+/g, " ");
  if (!label) {
    return { ok: false, error: "A type name is required - that's the label pickers show." };
  }
  if (label.length > MAX_LABEL) {
    return { ok: false, error: `The type name is too long (max ${MAX_LABEL} characters).` };
  }
  const key = inventoryTypeKey(label);
  if (!key) {
    return { ok: false, error: "Could not derive a matching key from that name - try letters and numbers." };
  }
  const taken = new Set<string>([
    ...INVENTORY_TYPE_CATALOG.map((e) => inventoryTypeKey(e.label)),
    ...raw.existingKeys.map((k) => String(k ?? "").trim().toLowerCase()),
  ]);
  if (taken.has(key)) {
    return { ok: false, error: `A product type named "${label}" already exists - pick it from the list instead.` };
  }
  return { ok: true, key, label };
}

/** Minimal owner-type row shape (matches InventoryType where it matters). */
export type OwnerTypeRow = {
  key: string;
  label: string;
  website_category: string | null;
  is_active?: boolean;
};

/**
 * Fold owner-created DB types into the grouped catalog picker. Catalog labels
 * always win (a DB copy of a built-in is skipped - it's the same pick);
 * owner types land in their mapped category's group (created on demand with
 * the supplied label) or the trailing "Other types" group when unmapped.
 * Inactive rows are skipped. Types stay alphabetized within each group.
 */
export function mergeOwnerTypesIntoGroups(
  groups: readonly CatalogGroup[],
  ownerTypes: readonly OwnerTypeRow[],
  categoryLabelOf: (value: string) => string,
): CatalogGroup[] {
  const catalogKeys = new Set(INVENTORY_TYPE_CATALOG.map((e) => inventoryTypeKey(e.label)));
  const out: CatalogGroup[] = groups.map((g) => ({ ...g, types: [...g.types] }));
  const byCategory = new Map(out.map((g) => [g.category, g] as const));
  const seen = new Set<string>(catalogKeys);
  let other: CatalogGroup | null = null;

  for (const t of ownerTypes) {
    if (t.is_active === false) continue;
    const label = String(t.label ?? "").trim();
    if (!label) continue;
    const key = inventoryTypeKey(label);
    if (seen.has(key)) continue; // catalog built-in or duplicate row
    seen.add(key);
    const cat = t.website_category?.trim() || null;
    if (cat) {
      let group = byCategory.get(cat);
      if (!group) {
        group = { category: cat, categoryLabel: categoryLabelOf(cat), types: [] };
        byCategory.set(cat, group);
        out.push(group);
      }
      group.types.push({ label, websiteCategory: cat });
    } else {
      if (!other) {
        other = {
          category: UNGROUPED_TYPES_CATEGORY,
          categoryLabel: UNGROUPED_TYPES_LABEL,
          types: [],
        };
      }
      other.types.push({ label, websiteCategory: UNGROUPED_TYPES_CATEGORY });
    }
  }
  if (other) out.push(other);
  for (const g of out) g.types.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runTypeRegistryCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL type-registry-core: " + msg);
    passed += 1;
  };

  // validateInventoryTypeDraft ------------------------------------------------
  {
    let r = validateInventoryTypeDraft({ label: "  Live  Hash   Rosin Cart ", existingKeys: [] });
    ok(r.ok && r.label === "Live Hash Rosin Cart" && r.key === "live hash rosin cart",
      "label whitespace collapsed; key lowercased");

    r = validateInventoryTypeDraft({ label: "", existingKeys: [] });
    ok(!r.ok && r.error.includes("required"), "empty label refused");

    r = validateInventoryTypeDraft({ label: "x".repeat(61), existingKeys: [] });
    ok(!r.ok && r.error.includes("too long"), "over-long label refused");

    // Catalog collision (built-in "Gummies") - case-insensitive.
    r = validateInventoryTypeDraft({ label: "gummies", existingKeys: [] });
    ok(!r.ok && r.error.includes("already exists"), "catalog duplicate refused");

    // DB collision.
    r = validateInventoryTypeDraft({ label: "Moon Sauce", existingKeys: ["moon sauce"] });
    ok(!r.ok && r.error.includes("already exists"), "DB duplicate refused");

    // Fresh name accepted.
    r = validateInventoryTypeDraft({ label: "Moon Sauce", existingKeys: ["space jam"] });
    ok(r.ok && r.key === "moon sauce", "fresh type accepted");
  }

  // mergeOwnerTypesIntoGroups -------------------------------------------------
  {
    const groups: CatalogGroup[] = [
      {
        category: "concentrate",
        categoryLabel: "Concentrate",
        types: [{ label: "Rosin", websiteCategory: "concentrate" }],
      },
    ];
    const labelOf = (v: string) => (v === "edible-solid" ? "Edible (Solid)" : v);

    // Mapped owner type joins its category group, alphabetized.
    let merged = mergeOwnerTypesIntoGroups(
      groups,
      [{ key: "moon sauce", label: "Moon Sauce", website_category: "concentrate" }],
      labelOf,
    );
    ok(merged.length === 1 && merged[0].types.map((t) => t.label).join(",") === "Moon Sauce,Rosin",
      "mapped owner type merged + sorted");

    // A category with no catalog group is created on demand with its label.
    merged = mergeOwnerTypesIntoGroups(
      groups,
      [{ key: "space chews", label: "Space Chews", website_category: "edible-solid" }],
      labelOf,
    );
    ok(merged.length === 2 && merged[1].categoryLabel === "Edible (Solid)" &&
      merged[1].types[0].label === "Space Chews", "new group created for unseen category");

    // Unmapped owner type lands in the trailing "Other types" group.
    merged = mergeOwnerTypesIntoGroups(
      groups,
      [{ key: "mystery goo", label: "Mystery Goo", website_category: null }],
      labelOf,
    );
    ok(merged[merged.length - 1].categoryLabel === UNGROUPED_TYPES_LABEL &&
      merged[merged.length - 1].types[0].label === "Mystery Goo", "unmapped type -> Other types");

    // Catalog built-ins and inactive rows are skipped; original groups untouched.
    merged = mergeOwnerTypesIntoGroups(
      groups,
      [
        { key: "rosin", label: "Rosin", website_category: "concentrate" },
        { key: "old thing", label: "Old Thing", website_category: "concentrate", is_active: false },
      ],
      labelOf,
    );
    ok(merged.length === 1 && merged[0].types.length === 1, "built-in copy + inactive row skipped");
    ok(groups[0].types.length === 1, "input groups not mutated");
  }

  return { passed };
}

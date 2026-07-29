/**
 * SLICE 92 — vitest mirror for type-registry-core: inline creation of NEW
 * product TYPES during Product Onboarding, wired to the SAME inventory_types
 * registry the Types & Categories settings page manages. Pins the create
 * gatekeeper (duplicate refusal against catalog + DB, canonical keys) and the
 * picker merge (owner types grouped under their category, unmapped ones under
 * "Other types", built-ins never duplicated).
 */
import { describe, it, expect } from "vitest";
import {
  validateInventoryTypeDraft,
  mergeOwnerTypesIntoGroups,
  UNGROUPED_TYPES_LABEL,
  __runTypeRegistryCoreTests,
} from "@/lib/pos/type-registry-core";
import { validateClassificationChoice } from "@/lib/inventory/draft-approval-gate-core";
import type { CatalogGroup } from "@/lib/pos/inventory-type-catalog";

describe("type-registry-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runTypeRegistryCoreTests()).not.toThrow();
  });

  it("gatekeeper refuses empty/duplicate labels and derives canonical keys", () => {
    const fresh = validateInventoryTypeDraft({ label: "  Moon   Sauce ", existingKeys: [] });
    expect(fresh).toEqual({ ok: true, key: "moon sauce", label: "Moon Sauce" });

    expect(validateInventoryTypeDraft({ label: "", existingKeys: [] }).ok).toBe(false);
    // Built-in catalog entry (case-insensitive).
    expect(validateInventoryTypeDraft({ label: "GUMMIES", existingKeys: [] }).ok).toBe(false);
    // Existing DB row.
    expect(validateInventoryTypeDraft({ label: "Moon Sauce", existingKeys: ["moon sauce"] }).ok).toBe(false);
  });

  it("merges owner types into the grouped picker without duplicating built-ins", () => {
    const groups: CatalogGroup[] = [
      {
        category: "concentrate",
        categoryLabel: "Concentrate",
        types: [{ label: "Rosin", websiteCategory: "concentrate" }],
      },
    ];
    const merged = mergeOwnerTypesIntoGroups(
      groups,
      [
        { key: "moon sauce", label: "Moon Sauce", website_category: "concentrate" },
        { key: "rosin", label: "Rosin", website_category: "concentrate" }, // built-in copy
        { key: "mystery goo", label: "Mystery Goo", website_category: null }, // unmapped
      ],
      (v) => v,
    );
    expect(merged[0].types.map((t) => t.label)).toEqual(["Moon Sauce", "Rosin"]);
    expect(merged[merged.length - 1].categoryLabel).toBe(UNGROUPED_TYPES_LABEL);
    expect(merged[merged.length - 1].types.map((t) => t.label)).toEqual(["Mystery Goo"]);
  });

  it("owner-created type labels are legal picks only when passed to the gate", () => {
    const none = { needsCategoryPick: false, needsTypePick: false };
    const withExtra = validateClassificationChoice({
      assessment: none,
      chosenHouseType: "Moon Sauce",
      extraTypeLabels: ["Moon Sauce"],
    });
    expect(withExtra.ok).toBe(true);
    const without = validateClassificationChoice({ assessment: none, chosenHouseType: "Moon Sauce" });
    expect(without.ok).toBe(false);
  });
});

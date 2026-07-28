/**
 * tests/compliance/category-registry-core.test.ts
 *
 * SLICE 78 — vitest mirror for the category registry brain. The stakes: the
 * owner manages website categories at /admin/settings/types, and those edits
 * must propagate everywhere (customer menu, onboarding, reports) without ever
 * corrupting data. These tests pin the label map + fallback, the create/edit
 * gatekeeper (slug derivation, duplicate refusal, junk sort order), the
 * bulk-reassign planner's refusals + plain-English preview lines, and orphan
 * detection on the live menu.
 */
import { describe, it, expect } from "vitest";
import {
  __runCategoryRegistryCoreTests,
  buildCategoryLabelMap,
  labelForCategory,
  slugifyCategoryValue,
  validateCategoryDraft,
  buildReassignPlan,
  findOrphanCategoryValues,
  type CategoryRegistryRow,
  type ReassignCounts,
} from "@/lib/pos/category-registry-core";

const REGISTRY: CategoryRegistryRow[] = [
  { value: "flower", label: "Flower", is_active: true },
  { value: "popcorn-bud", label: "Popcorn Bud", is_active: true },
  { value: "old-stuff", label: "Old Stuff", is_active: false },
];

const COUNTS: ReassignCounts = { publishedItems: 3, stagedItems: 2, draftPicks: 1, typeMappings: 4 };
const ZERO: ReassignCounts = { publishedItems: 0, stagedItems: 0, draftPicks: 0, typeMappings: 0 };

describe("category-registry-core (SLICE 78)", () => {
  it("embedded self-tests pass", () => {
    const { passed } = __runCategoryRegistryCoreTests();
    expect(passed).toBeGreaterThanOrEqual(30);
  });

  it("buildCategoryLabelMap keeps only rows with value AND label", () => {
    const map = buildCategoryLabelMap([
      { value: "flower", label: "Flower" },
      { value: "  ", label: "Blank Value" },
      { value: "no-label", label: "  " },
    ]);
    expect(map).toEqual({ flower: "Flower" });
  });

  it("labelForCategory prefers the DB label and title-cases unknowns", () => {
    const map = buildCategoryLabelMap(REGISTRY);
    expect(labelForCategory(map, "flower")).toBe("Flower");
    expect(labelForCategory(map, "mystery-slug")).toBe("Mystery Slug");
    expect(labelForCategory(map, null)).toBe("");
  });

  it("slugifyCategoryValue derives clean URL-safe slugs", () => {
    expect(slugifyCategoryValue("Live Resin!!")).toBe("live-resin");
    expect(slugifyCategoryValue("  Édible (Solid)  ")).toBe("dible-solid");
  });

  it("validateCategoryDraft: label required, duplicates refused, junk sort defaulted", () => {
    const existingValues = REGISTRY.map((r) => r.value);
    expect(validateCategoryDraft({ label: "", existingValues }).ok).toBe(false);
    expect(validateCategoryDraft({ label: "Flower", existingValues }).ok).toBe(false);
    const good = validateCategoryDraft({ label: "Live Resin", sort_order: "banana", existingValues });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value).toBe("live-resin");
      expect(good.sort_order).toBe(999);
    }
  });

  it("buildReassignPlan refuses same/unknown/hidden targets", () => {
    expect(buildReassignPlan({ from: "flower", to: "flower", registry: REGISTRY, counts: COUNTS }).ok).toBe(false);
    expect(buildReassignPlan({ from: "flower", to: "nope", registry: REGISTRY, counts: COUNTS }).ok).toBe(false);
    expect(buildReassignPlan({ from: "flower", to: "old-stuff", registry: REGISTRY, counts: COUNTS }).ok).toBe(false);
  });

  it("buildReassignPlan previews every touched surface in plain English", () => {
    const plan = buildReassignPlan({ from: "flower", to: "popcorn-bud", registry: REGISTRY, counts: COUNTS });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.total).toBe(10);
      expect(plan.lines.length).toBe(4);
      expect(plan.lines[0]).toContain("LIVE menu");
    }
  });

  it("buildReassignPlan discloses a zero-row move in plain English", () => {
    const plan = buildReassignPlan({ from: "flower", to: "popcorn-bud", registry: REGISTRY, counts: ZERO });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.total).toBe(0);
      expect(plan.lines.join(" ")).toContain("Nothing currently uses");
    }
  });

  it("findOrphanCategoryValues returns unique sorted unknowns", () => {
    const orphans = findOrphanCategoryValues(
      ["flower", "zombie", "alien", "zombie"],
      REGISTRY.map((r) => r.value),
    );
    expect(orphans).toEqual(["alien", "zombie"]);
  });
});

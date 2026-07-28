/**
 * src/lib/inventory/draft-approval-gate-core.ts  (INTAKE INTELLIGENCE / SLICE 64)
 *
 * The classification GATE on the Product Onboarding approval card. Owner bug
 * B3: the approval form accepted ONE field (price), and when the website-
 * category resolver could not map a product the approved draft was silently
 * refused at injection time ("draft_inject_unmapped_category") - the human was
 * never asked. Owner rule: >=90% confidence auto-assigns; below that a human
 * picks from OUR taxonomy BEFORE the price can be approved - no more silent
 * refusals, no guessing.
 *
 * Two pure steps, both vocabulary-closed:
 *
 *   1. assessDraftClassification - given the resolver's verdict (computed
 *      server-side, it needs the DB) plus the draft's name + LCB inventory
 *      type, decide what the human MUST pick:
 *        - needsCategoryPick: the resolver has NO website category. Without
 *          one the injection planner refuses the item, so approval requires a
 *          pick from the category taxonomy.
 *        - needsTypePick: the SLICE 63 house-type labeler could not auto-
 *          assign at >=90% confidence, so approval requires a product-type
 *          pick from the inventory-type catalog (the labeler's own best read,
 *          when it has one, is offered as the suggested default).
 *
 *   2. validateClassificationChoice - server-side validation of what the form
 *      submitted. Choices must come from the CLOSED vocabularies
 *      (category-taxonomy values / inventory-type-catalog labels); required
 *      picks must be present. Plain-English error messages for the banner.
 *
 * The raw LCB/CCRS values (category, inventory_type) are NEVER touched - the
 * human's choice lives in its own columns (migration 0141) with the raw
 * values kept under the hood, per the owner's standing rule.
 *
 * PURE: no I/O, no React, no server-only imports. tsx-unit-testable.
 */
import {
  websiteCategories,
  websiteCategoryLabels,
} from "@/lib/pos/category-taxonomy";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import {
  deriveHouseType,
  HOUSE_TYPE_MIN_AUTO_CONFIDENCE,
  type HouseTypeResult,
} from "@/lib/inventory/house-type-core";

/** The closed set of website-category values a human may pick from. */
const CATEGORY_VALUES = new Set<string>(websiteCategories as readonly string[]);

/** The closed set of house-type labels a human may pick from. */
const HOUSE_TYPE_LABELS = new Set<string>(INVENTORY_TYPE_CATALOG.map((e) => e.label));

export type DraftClassificationAssessment = {
  /** The resolver's website category (null = unmapped). */
  resolvedWebsiteCategory: string | null;
  /** The SLICE 63 labeler's full verdict (label + confidence + source). */
  house: HouseTypeResult;
  /** True when approval must include a website-category pick. */
  needsCategoryPick: boolean;
  /** True when approval must include a product-type pick. */
  needsTypePick: boolean;
  /**
   * The labeler's best read to preselect in the type picker (only when it has
   * one below the auto-assign bar; null means the picker starts blank).
   */
  suggestedHouseType: string | null;
};

/**
 * Decide what the human must pick before this draft can be approved. The
 * resolver runs server-side (it needs menu_items + inventory_types); its
 * verdict is passed in so this stays pure.
 */
export function assessDraftClassification(input: {
  productName?: string | null;
  inventoryType?: string | null;
  resolvedWebsiteCategory: string | null;
}): DraftClassificationAssessment {
  const resolved = input.resolvedWebsiteCategory?.trim() || null;
  const house = deriveHouseType({
    productName: input.productName ?? null,
    inventoryType: input.inventoryType ?? null,
    websiteCategory: resolved,
  });
  const autoAssigned = Boolean(
    house.houseType && house.confidence >= HOUSE_TYPE_MIN_AUTO_CONFIDENCE,
  );
  return {
    resolvedWebsiteCategory: resolved,
    house,
    needsCategoryPick: !resolved,
    needsTypePick: !autoAssigned,
    suggestedHouseType: autoAssigned ? null : house.houseType,
  };
}

export type ClassificationChoiceResult =
  | {
      ok: true;
      /** Normalized picks (null when not provided / not needed). */
      chosenWebsiteCategory: string | null;
      chosenHouseType: string | null;
    }
  | {
      ok: false;
      code: "category_required" | "category_invalid" | "type_required" | "type_invalid";
      error: string;
    };

/**
 * Validate the approval form's classification picks against the assessment.
 * NEVER trusts the form: values must come from the closed vocabularies, and
 * required picks must be present. Optional picks (submitted although not
 * required) are accepted when valid - the human always outranks the machine.
 */
export function validateClassificationChoice(input: {
  assessment: Pick<DraftClassificationAssessment, "needsCategoryPick" | "needsTypePick">;
  chosenWebsiteCategory?: string | null;
  chosenHouseType?: string | null;
  /**
   * SLICE 78: owner-created website categories (DB registry values) the server
   * loaded for this request. The closed set becomes hardcoded ∪ these, so a
   * category the owner just created at /admin/settings/types is a legal pick
   * during onboarding. Stays pure: values are passed IN, never fetched here.
   */
  extraCategoryValues?: readonly string[];
}): ClassificationChoiceResult {
  const cat = input.chosenWebsiteCategory?.trim() || null;
  const type = input.chosenHouseType?.trim() || null;
  const allowedCategories = input.extraCategoryValues?.length
    ? new Set<string>([...CATEGORY_VALUES, ...input.extraCategoryValues])
    : CATEGORY_VALUES;

  if (cat && !allowedCategories.has(cat)) {
    return {
      ok: false,
      code: "category_invalid",
      error: `"${cat}" is not one of our website categories. Pick one from the list.`,
    };
  }
  if (type && !HOUSE_TYPE_LABELS.has(type)) {
    return {
      ok: false,
      code: "type_invalid",
      error: `"${type}" is not one of our product types. Pick one from the list.`,
    };
  }
  if (input.assessment.needsCategoryPick && !cat) {
    return {
      ok: false,
      code: "category_required",
      error:
        "This product's inventory type doesn't map to a website category yet - pick the category it belongs in, then approve.",
    };
  }
  if (input.assessment.needsTypePick && !type) {
    return {
      ok: false,
      code: "type_required",
      error:
        "We couldn't type this product at 90% confidence or better - pick its product type, then approve.",
    };
  }
  return { ok: true, chosenWebsiteCategory: cat, chosenHouseType: type };
}

/** Human label for a website-category value (raw value when unknown). */
export function websiteCategoryLabel(value: string | null | undefined): string | null {
  const v = value?.trim() || null;
  if (!v) return null;
  return (websiteCategoryLabels as Record<string, string>)[v] ?? v;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runDraftApprovalGateTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL draft-approval-gate-core: " + msg);
    passed += 1;
  };

  // 1) Fully confident line: catalog-passthrough type + mapped category ->
  //    nothing to pick.
  {
    const a = assessDraftClassification({
      productName: "Cantina Gummies - Guava 10 Pack 400mg",
      inventoryType: "Gummies",
      resolvedWebsiteCategory: "edible-solid",
    });
    ok(!a.needsCategoryPick, "mapped category: no category pick");
    ok(!a.needsTypePick, "catalog type (100): no type pick");
    ok(a.house.houseType === "Gummies" && a.house.confidence === 100, "passthrough verdict kept");
    ok(a.suggestedHouseType === null, "no suggestion when auto-assigned");
  }

  // 2) Name-rule agreement (95): auto-assigned, no type pick.
  {
    const a = assessDraftClassification({
      productName: "2727 - Live Resin Cart - GG4 1g",
      inventoryType: "Concentrate for Inhalation",
      resolvedWebsiteCategory: "cartridge",
    });
    ok(!a.needsTypePick, "95% name match: no type pick");
    ok(a.house.houseType === "Live Resin Cartridge", "composite cart label");
  }

  // 3) Unmapped category: category pick REQUIRED (kills the silent refusal).
  {
    const a = assessDraftClassification({
      productName: "Mystery Widget",
      inventoryType: "Strange LCB Type",
      resolvedWebsiteCategory: null,
    });
    ok(a.needsCategoryPick, "unmapped: category pick required");
    ok(a.needsTypePick, "no type signal: type pick required");
    ok(a.suggestedHouseType === null, "no suggestion without a signal");
  }

  // 4) Name/category disagreement (60): type pick required WITH the labeler's
  //    best read offered as the suggested default.
  {
    const a = assessDraftClassification({
      productName: "Sunset Sherbet Gummies 100mg",
      inventoryType: "Concentrate for Inhalation",
      resolvedWebsiteCategory: "concentrate",
    });
    ok(a.needsTypePick, "60% disagreement: type pick required");
    ok(a.suggestedHouseType === "Gummies", "labeler's read suggested as default");
    ok(!a.needsCategoryPick, "category itself is mapped");
  }

  // 5) Plain strain name, no signal (0): type pick required, blank suggestion.
  {
    const a = assessDraftClassification({
      productName: "Blue Dream 3.5g",
      inventoryType: "Usable Marijuana",
      resolvedWebsiteCategory: "flower",
    });
    ok(a.needsTypePick, "no signal: type pick required");
    ok(a.suggestedHouseType === null, "no invented suggestion for a plain strain name");
  }

  // 6) Choice validation: closed vocabularies enforced.
  {
    const need = { needsCategoryPick: true, needsTypePick: true };
    const none = { needsCategoryPick: false, needsTypePick: false };

    let r = validateClassificationChoice({ assessment: need });
    ok(!r.ok && r.code === "category_required", "missing required category rejected");

    r = validateClassificationChoice({ assessment: need, chosenWebsiteCategory: "cartridge" });
    ok(!r.ok && r.code === "type_required", "missing required type rejected");

    r = validateClassificationChoice({
      assessment: need,
      chosenWebsiteCategory: "not-a-category",
      chosenHouseType: "Gummies",
    });
    ok(!r.ok && r.code === "category_invalid", "off-vocabulary category rejected");

    r = validateClassificationChoice({
      assessment: need,
      chosenWebsiteCategory: "cartridge",
      chosenHouseType: "Sour Gummy Worms",
    });
    ok(!r.ok && r.code === "type_invalid", "off-vocabulary type rejected");

    r = validateClassificationChoice({
      assessment: need,
      chosenWebsiteCategory: "cartridge",
      chosenHouseType: "Live Resin Cartridge",
    });
    ok(r.ok && r.chosenWebsiteCategory === "cartridge" && r.chosenHouseType === "Live Resin Cartridge",
      "valid required picks accepted");

    // Nothing needed, nothing sent -> ok with nulls.
    r = validateClassificationChoice({ assessment: none });
    ok(r.ok && r.chosenWebsiteCategory === null && r.chosenHouseType === null,
      "no picks needed, none sent");

    // Optional pick (human override) accepted when valid.
    r = validateClassificationChoice({ assessment: none, chosenHouseType: "Gummies" });
    ok(r.ok && r.chosenHouseType === "Gummies", "valid optional pick accepted");

    // Whitespace-only input treated as absent.
    r = validateClassificationChoice({ assessment: none, chosenWebsiteCategory: "   " });
    ok(r.ok && r.chosenWebsiteCategory === null, "whitespace normalized to null");

    // SLICE 78: owner-created DB categories widen the closed set when passed in.
    r = validateClassificationChoice({
      assessment: none,
      chosenWebsiteCategory: "owner-special",
      extraCategoryValues: ["owner-special"],
    });
    ok(r.ok && r.chosenWebsiteCategory === "owner-special", "owner-created category accepted");

    // ...but WITHOUT the extra list the same pick is still refused (closed set).
    r = validateClassificationChoice({ assessment: none, chosenWebsiteCategory: "owner-special" });
    ok(!r.ok && r.code === "category_invalid", "unknown category still refused without extras");

    // Extras never smuggle in an unrelated junk value.
    r = validateClassificationChoice({
      assessment: none,
      chosenWebsiteCategory: "junk-cat",
      extraCategoryValues: ["owner-special"],
    });
    ok(!r.ok && r.code === "category_invalid", "extras don't open the gate for junk");
  }

  // 7) Label helper stays on the taxonomy.
  ok(websiteCategoryLabel("edible-solid") === "Edible (Solid)", "label helper uses taxonomy");
  ok(websiteCategoryLabel("mystery-cat") === "mystery-cat", "unknown value passes through");
  ok(websiteCategoryLabel(null) === null, "null stays null");

  // 8) Vocabulary sanity: both closed sets are non-trivial and disjoint in kind.
  ok(CATEGORY_VALUES.size >= 20, "category vocabulary present");
  ok(HOUSE_TYPE_LABELS.size >= 50, "house-type vocabulary present");
  ok(CATEGORY_VALUES.has("disposable-cartridge"), "taxonomy value present");
  ok(HOUSE_TYPE_LABELS.has("Infused Blunt"), "catalog label present");

  return { passed };
}

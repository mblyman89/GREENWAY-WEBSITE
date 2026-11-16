/**
 * src/lib/inventory/register-limit-explain-core.ts   (D246)
 *
 * PURE. Explains, on a product's inventory page, exactly what the REGISTER
 * will do with it: which category it rings under, where that category came
 * from (your re-file, or the onboarding/menu row), which Washington legal
 * limit bucket that puts it in, and how much one unit counts against it.
 *
 * Why this exists (owner, D246): a full-flower 20 x 0.5 g pre-roll pack was
 * filed "Infused Pre-roll" at Product Onboarding. Infused pre-rolls count
 * against the 7 g concentrate limit (WAC 314-55-095, store policy in
 * sales-limits-core categoryToBucket), so the 10 g pack could never be sold.
 * The owner re-filed it to "Pre-roll" and the register kept refusing it,
 * because the re-file never reached the register. D246 makes the re-file
 * reach the register; this panel makes the outcome VISIBLE so the next one
 * can be found and fixed from the back office.
 *
 * It also raises a "looks wrong" flag: the LCB inventory type says Usable
 * Marijuana (plain flower) but the category puts it in the concentrate bucket
 * and the name does not mention an infusion. That combination is the exact
 * shape of the D246 mistake. It is a hint, never an automatic change.
 */
import {
  categoryToBucket,
  formatLimitAmount,
  LIMIT_BUCKET_LABELS,
  RECREATIONAL_LIMITS,
  type LimitBucket,
} from "@/lib/compliance/sales-limits-core";
import { registerCategoryFor, type RegisterCategorySource } from "@/lib/menu/menu-category-override-core";

export type RegisterLimitInput = {
  menuCategory: string | null | undefined;
  overrideCategory: string | null | undefined;
  /** LCB inventory type, e.g. "Usable Marijuana", "Infused Pre-roll". */
  inventoryType: string | null | undefined;
  productName: string | null | undefined;
  /** Net weight of ONE unit in grams when known (10 for a 20 x 0.5 g pack). */
  unitGrams: number | null | undefined;
};

export type RegisterLimitExplanation = {
  category: string | null;
  source: RegisterCategorySource;
  sourceText: string;
  bucket: LimitBucket | null;
  bucketLabel: string;
  limitText: string | null;
  /** True when ONE unit is over the recreational limit (can never be sold). */
  oneUnitOverLimit: boolean;
  looksLikeFlowerFiledAsInfused: boolean;
  advice: string[];
};

/** Words that genuinely signal an infused / concentrate inhalable. */
const INFUSION_WORDS =
  /\b(inf|infus\w*|diamond\w*|kief|hash\w*|caviar|moon ?rock\w*|rosin|resin|distillate|wax|shatter|sauce|badder|batter|crumble|dipped|coated|dusted|cart\w*|vape|concentrate|rso|terp\w*|liquid)\b/i;

export function looksLikeFlowerFiledAsInfused(input: {
  bucket: LimitBucket | null;
  inventoryType: string | null | undefined;
  productName: string | null | undefined;
}): boolean {
  if (input.bucket !== "concentrate") return false;
  const t = (input.inventoryType ?? "").trim().toLowerCase();
  if (t !== "usable marijuana" && t !== "usable cannabis") return false;
  const name = input.productName ?? "";
  if (INFUSION_WORDS.test(name)) return false;
  return true;
}

export function explainRegisterLimit(input: RegisterLimitInput): RegisterLimitExplanation {
  const { category, source } = registerCategoryFor({
    menuCategory: input.menuCategory,
    overrideCategory: input.overrideCategory,
  });
  const bucket = categoryToBucket(category);
  const limit = bucket ? RECREATIONAL_LIMITS[bucket] : null;
  const grams = typeof input.unitGrams === "number" && input.unitGrams > 0 ? input.unitGrams : null;
  const gramBucket = bucket === "usable" || bucket === "concentrate" || bucket === "solid_edible";
  const oneUnitOverLimit = Boolean(bucket && limit != null && gramBucket && grams != null && grams > limit);
  const flag = looksLikeFlowerFiledAsInfused({ bucket, inventoryType: input.inventoryType, productName: input.productName });

  const sourceText =
    source === "override"
      ? "your re-file on this page (Website type & category)"
      : source === "menu"
        ? "the published menu row (set at Product Onboarding)"
        : "nothing: this product is not on the published menu";

  const advice: string[] = [];
  if (flag) {
    advice.push(
      "The state record says plain flower (Usable Marijuana) and the name does not mention an infusion, " +
        "but the register counts it against the 7 g concentrate limit. If it is a full-flower pre-roll, " +
        "re-file it below as Pre-roll (or Pre-roll Pack).",
    );
  }
  if (oneUnitOverLimit && bucket) {
    advice.push(
      `One unit (${grams} g) is over the ${formatLimitAmount(bucket, limit as number)} legal limit for this bucket, so the register can never sell it as filed.`,
    );
  }
  if (source === "override") {
    advice.push(
      "Your re-file is what the register uses. After saving, tap Refresh menu on the register (or wait for its next menu sync) to pick it up.",
    );
  }

  return {
    category,
    source,
    sourceText,
    bucket,
    bucketLabel: bucket ? LIMIT_BUCKET_LABELS[bucket] : "Not limited (non-cannabis)",
    limitText: bucket && limit != null ? formatLimitAmount(bucket, limit) : null,
    oneUnitOverLimit,
    looksLikeFlowerFiledAsInfused: flag,
    advice,
  };
}

// ---------------------------------------------------------------------------
// self-tests (pure) — registered in scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runRegisterLimitExplainTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL register-limit-explain-core: " + msg);
    passed += 1;
  };

  // The D246 product before the fix: menu says infused-preroll, no override.
  const before = explainRegisterLimit({
    menuCategory: "infused-preroll",
    overrideCategory: null,
    inventoryType: "Usable Marijuana",
    productName: "Full Flower Little Snappers - Blueberry Jaeger - 20pk (20x0.5g)",
    unitGrams: 10,
  });
  ok(before.bucket === "concentrate", "before: concentrate bucket");
  ok(before.source === "menu", "before: from the menu row");
  ok(before.limitText === "7 g", "before: 7 g limit");
  ok(before.oneUnitOverLimit, "before: 10 g over 7 g");
  ok(before.looksLikeFlowerFiledAsInfused, "before: flagged as flower filed as infused");
  ok(before.advice.length >= 2, "before: advice given");

  // After the owner's re-file.
  const after = explainRegisterLimit({
    menuCategory: "infused-preroll",
    overrideCategory: "preroll",
    inventoryType: "Usable Marijuana",
    productName: "Full Flower Little Snappers - Blueberry Jaeger - 20pk (20x0.5g)",
    unitGrams: 10,
  });
  ok(after.category === "preroll" && after.source === "override", "after: override wins");
  ok(after.bucket === "usable", "after: usable bucket");
  ok(!after.oneUnitOverLimit, "after: 10 g under 1 oz");
  ok(!after.looksLikeFlowerFiledAsInfused, "after: no flag");

  // A real infused pre-roll is not flagged.
  ok(
    !looksLikeFlowerFiledAsInfused({ bucket: "concentrate", inventoryType: "Usable Marijuana", productName: "Diamond Infused Pre-roll 1g" }),
    "infused name not flagged",
  );
  ok(
    !looksLikeFlowerFiledAsInfused({ bucket: "concentrate", inventoryType: "Usable Marijuana", productName: "Const INF 14pk 7g - Gary Payton" }),
    "INF abbreviation counts as infused",
  );
  ok(
    !looksLikeFlowerFiledAsInfused({ bucket: "concentrate", inventoryType: "Infused Pre-roll", productName: "Jaeger 1g" }),
    "LCB infused type not flagged",
  );
  ok(
    !looksLikeFlowerFiledAsInfused({ bucket: "usable", inventoryType: "Usable Marijuana", productName: "Jaeger 1g" }),
    "usable bucket never flagged",
  );
  ok(
    looksLikeFlowerFiledAsInfused({ bucket: "concentrate", inventoryType: "usable cannabis", productName: "Jaeger 1g" }),
    "case-insensitive inventory type",
  );

  // Not on the menu, non-cannabis.
  const none = explainRegisterLimit({ menuCategory: null, overrideCategory: null, inventoryType: null, productName: null, unitGrams: null });
  ok(none.source === "none" && none.bucket === null && none.limitText === null, "nothing known");
  const acc = explainRegisterLimit({ menuCategory: "accessories", overrideCategory: null, inventoryType: null, productName: "Lighter", unitGrams: null });
  ok(acc.bucket === null && acc.bucketLabel.startsWith("Not limited"), "accessories not limited");

  // A 1 g cart is under the 7 g limit.
  const cart = explainRegisterLimit({ menuCategory: "cartridge", overrideCategory: null, inventoryType: "Concentrate for Inhalation", productName: "Cart 1g", unitGrams: 1 });
  ok(cart.bucket === "concentrate" && !cart.oneUnitOverLimit && !cart.looksLikeFlowerFiledAsInfused, "1 g cart fine");

  return { passed, failed: 0 };
}

/**
 * src/lib/promotions/promotion-guide-core.ts  (D136, owner 2026-11-02)
 *
 * The plain-English "which sections do I need" content for the promotion
 * builder, plus the per-field hover help (FIELD_HELP). One place, so the guide
 * table, the form's InfoHints and the tests can never disagree.
 *
 * Every statement here is checked against the engine (discount-engine-core
 * applyRule): which fields each discount type actually reads.
 *   percent         -> discount_percent
 *   fixed           -> discount_fixed (cents)
 *   multi_item_tier -> config.qtyTiers (or config.eitherOr); discount_percent unused
 *   weight_tier     -> config.weightTiers; discount_percent unused
 *   threshold_spend -> config.spendTiers; discount_percent unused
 *   bogo            -> config.bogo; discount_percent unused
 *   basket          -> config.basketTopItem OR config.basketNforM; discount_percent unused
 * multi_item_percent is only a badge label on menu cards (sample-discount.ts);
 * the engine never reads it.
 *
 * No React, no DB, no server-only.
 */
import type { DiscountType } from "./types";

export type DealTypeGuide = {
  type: DiscountType;
  typeLabel: string;
  example: string;
  fill: string;
  ignore: string;
  /** The config keys / columns the engine reads for this type. */
  reads: string[];
};

export const DEAL_TYPE_GUIDE: DealTypeGuide[] = [
  {
    type: "percent",
    typeLabel: "Percent off",
    example: "25% off edibles (Munchie Monday), 25% off chosen brands (Thursday)",
    fill: "Percent (%) in the Discount section.",
    ignore: "Fixed off, Multi-item %, and the whole Mechanics section.",
    reads: ["discount_percent"],
  },
  {
    type: "fixed",
    typeLabel: "Fixed amount off",
    example: "$3 off every cartridge",
    fill: "Fixed off, in cents (300 = $3.00).",
    ignore: "Percent, Multi-item %, and the Mechanics section.",
    reads: ["discount_fixed"],
  },
  {
    type: "multi_item_tier",
    typeLabel: "Multi-item tier",
    example: "Prerolls 20% off, 25% off when you buy 4+ (Doobie Tuesday)",
    fill: "Mechanics → Multi-item tier rows: \"Buy at least 1 → 20\", \"Buy at least 4 → 25\".",
    ignore: "Percent (not used for this type), and the Either/or box unless you really want \"one OR the other\".",
    reads: ["config.qtyTiers", "config.eitherOr"],
  },
  {
    type: "threshold_spend",
    typeLabel: "Spend threshold",
    example: "Vapes 20% off, 30% when you spend $150+ (Wax Wednesday)",
    fill: "Mechanics → Spend threshold rows in DOLLARS: \"$0 → 20\", \"$150 → 30\". Use $0 for the everyday rate.",
    ignore: "Percent (not used). If you leave the rows empty the register falls back to 15/20/30 at $50/$100/$150.",
    reads: ["config.spendTiers"],
  },
  {
    type: "weight_tier",
    typeLabel: "Weight tier",
    example: "Flower 15% at 7g, 20% at 14g, 30% at 28g (Ounce Friday)",
    fill: "Mechanics → Weight tier rows in grams.",
    ignore: "Percent (not used). Empty rows fall back to 7g 15%, 14g 20%, 28g 30%.",
    reads: ["config.weightTiers"],
  },
  {
    type: "bogo",
    typeLabel: "BOGO",
    example: "Buy 1, get 1 50% off",
    fill: "Mechanics → BOGO: Buy qty, Get qty, Get % off (99% max, never free).",
    ignore: "Percent and the other Mechanics blocks.",
    reads: ["config.bogo"],
  },
  {
    type: "basket",
    typeLabel: "Basket deal",
    example: "30% off one item + 15% off the rest (Super Saturday), or Buy 3 pay for 2 (Ice Cream Sunday)",
    fill: "Mechanics → Basket deal: pick ONE of the two options and fill its two boxes.",
    ignore: "Percent (not used), and the other Mechanics blocks.",
    reads: ["config.basketTopItem", "config.basketNforM"],
  },
];

export type SectionGuide = { section: string; need: string; what: string };

export const SECTION_GUIDE: SectionGuide[] = [
  { section: "Details", need: "always", what: "Title (required), description and the badge note customers see. Wording is checked as you type." },
  { section: "Discount", need: "always", what: "Pick the deal type. Fill Percent only for a Percent-off deal, and Fixed only for a Fixed-amount deal." },
  { section: "Clearance markdown", need: "rarely", what: "Tick only for clearance or vendor-day items. They keep this price and get no other deal." },
  { section: "Mechanics", need: "only for tier / BOGO / basket", what: "Fill only the block that matches your deal type. Everything else is ignored and cleared on save." },
  { section: "Schedule", need: "always", what: "A weekday for a weekly deal, OR start/end dates for a one-off. Not both." },
  { section: "What it applies to", need: "always", what: "Storewide, OR categories / brands / products. With nothing selected, the deal reaches nothing." },
  { section: "Exclusions", need: "optional", what: "Carve-outs. Exclusions always win, so never exclude a category you also target." },
];

/** Hover help for each field in the form (InfoHint text). */
export const FIELD_HELP = {
  title: "The deal's name, shown on the menu, Specials page and receipts. Keep it short and factual (e.g. \"Munchie Monday\").",
  promoKey: "Internal ID. The routine days use daily.monday … daily.sunday so the one-press setup can find them. Leave blank for one-off deals.",
  description: "One sentence customers read. Say exactly what the register does: the percent, what it covers and any minimum. Don't say \"free\", don't make health claims, nothing aimed at kids.",
  bonusNote: "Short badge on product cards (e.g. \"20% off · 30% at $150+\"). It must match the mechanics.",
  discountType: "What kind of deal this is. It decides which boxes below matter. See \"Which sections do I need?\" at the top.",
  percent: "Used ONLY by \"Percent off\". For tier, BOGO and basket deals the percent comes from the Mechanics section, so this box is ignored.",
  fixed: "Used ONLY by \"Fixed amount off\". In cents: 300 = $3.00 off each item.",
  multiItemPercent: "Optional badge text on menu cards (\"25% MULTI-BUY\"). It does not change the price the register charges.",
  perItemSale: "On: menu cards show a struck-through sale price. Turn it off for tier, spend and basket deals, where the final price depends on the whole cart.",
  markdown: "Clearance or vendor-day only. Items keep this price and are left out of every other deal, even a bigger one.",
  qtyTiers: "Count of matching items in the cart → percent. \"1 → 20\" and \"4 → 25\" means 20% on 1–3 items and 25% on 4 or more.",
  eitherOr: "Rarely needed. Gives a flat % OR buy-N-pay-M, whichever is better for the customer. Leave blank if you use tiers above.",
  weightTiers: "Total grams of matching product in the cart → percent (7 = quarter, 14 = half, 28 = ounce).",
  spendTiers: "Pre-tax dollars spent on matching items → percent. Use $0 for the everyday rate, e.g. $0 → 20 and $150 → 30.",
  bogo: "Buy X, get Y at Z% off. The cheapest items get the discount. 99% max (cannabis is never free).",
  basket: "Pick one option. \"Buy N pay for M\" spreads the savings across the basket. \"Headline + rest\" gives one item (the lowest-priced) the bigger percent and the rest the smaller one.",
  weekday: "Weekly deal: pick the day and leave the dates blank. The register uses the store's Pacific day.",
  window: "One-off deal: leave the weekday blank and set start/end (Pacific time). Leave both blank only if the deal should run every day.",
  priority: "Only breaks ties for which badge shows on a card. The customer always gets the single best deal.",
  storewide: "Everything except accessories and merch. Use it instead of ticking every category.",
  categories: "The product types the deal covers. Make sure they match the words in your description.",
  brands: "Brand names exactly as they appear on the menu. A product whose menu brand is spelled differently (e.g. a sub-brand) will NOT get the deal.",
  exclusions: "Things that never get this deal, even when they match above. Exclusions always win.",
} as const;

export function guideFor(type: DiscountType): DealTypeGuide | undefined {
  return DEAL_TYPE_GUIDE.find((g) => g.type === type);
}

export function __runPromotionGuideTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`promotion-guide FAIL: ${name}`);
    }
  };
  const types: DiscountType[] = ["percent", "fixed", "multi_item_tier", "threshold_spend", "weight_tier", "bogo", "basket"];
  for (const t of types) ok(`guide covers ${t}`, Boolean(guideFor(t)));
  ok("guide has no duplicates", new Set(DEAL_TYPE_GUIDE.map((g) => g.type)).size === DEAL_TYPE_GUIDE.length);
  ok("percent reads discount_percent", guideFor("percent")!.reads.includes("discount_percent"));
  ok("tier types don't read discount_percent", ["multi_item_tier", "threshold_spend", "weight_tier", "bogo", "basket"].every((t) => !guideFor(t as DiscountType)!.reads.includes("discount_percent")));
  ok("spend guide says dollars", guideFor("threshold_spend")!.fill.includes("DOLLARS"));
  ok("spend guide warns about fallback", guideFor("threshold_spend")!.ignore.includes("15/20/30"));
  ok("tuesday example uses tiers not either/or", guideFor("multi_item_tier")!.fill.includes("Buy at least 4"));
  ok("seven sections", SECTION_GUIDE.length === 7);
  ok("exclusions warn about cancelling targets", SECTION_GUIDE.find((s) => s.section === "Exclusions")!.what.includes("never exclude"));
  ok("percent help says ignored for tiers", FIELD_HELP.percent.includes("ignored"));
  ok("multi-item help says badge only", FIELD_HELP.multiItemPercent.includes("does not change"));
  ok("brands help warns about spelling", FIELD_HELP.brands.includes("NOT"));
  ok("no 'saves less' anywhere", !JSON.stringify({ DEAL_TYPE_GUIDE, SECTION_GUIDE, FIELD_HELP }).toLowerCase().includes("saves less"));
  return { passed, failed };
}

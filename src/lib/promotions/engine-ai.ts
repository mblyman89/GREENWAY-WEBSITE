/**
 * src/lib/promotions/engine-ai.ts
 *
 * AI DRAFT assist for the POS discount ENGINE config (Slice 39). Given a
 * discount type and a plain-English description of the mechanics (e.g. "buy 2
 * get 15% off, 4 or more get 25%"), it proposes the structured tier/bogo/basket
 * config the engine consumes.
 *
 * STANDING RULE: this is a DRAFT only. The structured config is shown for the
 * manager to review, edit in the simulator, and confirm before it is saved to a
 * promotion or published. Built on the existing generateStructured + schema
 * infrastructure; never invents product/brand names.
 *
 * The AI schema system supports flat field kinds (string / number / boolean /
 * enum / stringArray / single object) but NOT arrays-of-objects, so tiers are
 * requested as flat numeric fields (up to three breakpoints) and reassembled
 * into Tier[] here. This keeps the contract strict and validatable.
 *
 * Server-only.
 */
import "server-only";

import { generateStructured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import type { DiscountType, EngineConfig, Tier } from "./discount-engine-core";

export type EngineConfigDraft = {
  // Up to three quantity tiers (multi_item_tier): threshold + percent pairs.
  qty1At: number;
  qty1Pct: number;
  qty2At: number;
  qty2Pct: number;
  qty3At: number;
  qty3Pct: number;
  // Up to three weight tiers in GRAMS (weight_tier).
  wt1At: number;
  wt1Pct: number;
  wt2At: number;
  wt2Pct: number;
  wt3At: number;
  wt3Pct: number;
  // Up to three spend tiers in CENTS (threshold_spend).
  spend1At: number;
  spend1Pct: number;
  spend2At: number;
  spend2Pct: number;
  spend3At: number;
  spend3Pct: number;
  // BOGO.
  bogoBuyQty: number;
  bogoGetQty: number;
  bogoGetPercent: number;
  // Basket "buy N for M".
  basketN: number;
  basketM: number;
  // Basket top-item.
  basketTopPercent: number;
  basketRestPercent: number;
  stackable: boolean;
  summary: string;
};

const num = (description: string, max = 100000) =>
  ({ kind: "number" as const, description, min: 0, max });
const pct = (description: string) =>
  ({ kind: "number" as const, description, min: 0, max: 100 });

const draftSchema = defineSchema<EngineConfigDraft>("promo_engine_config", {
  qty1At: num("Quantity tier 1 threshold (item count). 0 if unused.", 100),
  qty1Pct: pct("Quantity tier 1 percent off."),
  qty2At: num("Quantity tier 2 threshold. 0 if unused.", 100),
  qty2Pct: pct("Quantity tier 2 percent off."),
  qty3At: num("Quantity tier 3 threshold. 0 if unused.", 100),
  qty3Pct: pct("Quantity tier 3 percent off."),
  wt1At: num("Weight tier 1 threshold in GRAMS (1oz=28). 0 if unused.", 1000),
  wt1Pct: pct("Weight tier 1 percent off."),
  wt2At: num("Weight tier 2 threshold in grams. 0 if unused.", 1000),
  wt2Pct: pct("Weight tier 2 percent off."),
  wt3At: num("Weight tier 3 threshold in grams. 0 if unused.", 1000),
  wt3Pct: pct("Weight tier 3 percent off."),
  spend1At: num("Spend tier 1 threshold in CENTS ($50=5000). 0 if unused."),
  spend1Pct: pct("Spend tier 1 percent off."),
  spend2At: num("Spend tier 2 threshold in cents. 0 if unused."),
  spend2Pct: pct("Spend tier 2 percent off."),
  spend3At: num("Spend tier 3 threshold in cents. 0 if unused."),
  spend3Pct: pct("Spend tier 3 percent off."),
  bogoBuyQty: num("BOGO buy quantity. 0 if not BOGO.", 12),
  bogoGetQty: num("BOGO discounted quantity. 0 if not BOGO.", 12),
  bogoGetPercent: pct("BOGO percent off the 'get' items (100 = free)."),
  basketN: num("Basket 'buy N for M': N. 0 if not applicable.", 24),
  basketM: num("Basket 'buy N for M': M. 0 if not applicable.", 24),
  basketTopPercent: pct("Basket top-item: percent off the single most expensive item. 0 if n/a."),
  basketRestPercent: pct("Basket top-item: percent off the remaining items. 0 if n/a."),
  stackable: { kind: "boolean", description: "Whether this promotion may stack on top of other promotions." },
  summary: { kind: "string", description: "One-sentence plain-English restatement for the manager to confirm.", maxLength: 240 },
});

function tiers(pairs: [number, number][]): Tier[] | undefined {
  const t = pairs
    .filter(([at, percent]) => at > 0 && percent > 0)
    .map(([at, percent]) => ({ at, percent }));
  return t.length ? t : undefined;
}

/** Turn the AI draft into the engine's EngineConfig. */
export function draftToEngineConfig(d: EngineConfigDraft): EngineConfig {
  const cfg: EngineConfig = {
    qtyTiers: tiers([[d.qty1At, d.qty1Pct], [d.qty2At, d.qty2Pct], [d.qty3At, d.qty3Pct]]),
    weightTiers: tiers([[d.wt1At, d.wt1Pct], [d.wt2At, d.wt2Pct], [d.wt3At, d.wt3Pct]]),
    spendTiers: tiers([[d.spend1At, d.spend1Pct], [d.spend2At, d.spend2Pct], [d.spend3At, d.spend3Pct]]),
    stackable: Boolean(d.stackable),
  };
  if (d.bogoBuyQty > 0 && d.bogoGetQty > 0) {
    cfg.bogo = { buyQty: d.bogoBuyQty, getQty: d.bogoGetQty, getPercent: d.bogoGetPercent || 100 };
  }
  if (d.basketN > 0 && d.basketM > 0) {
    cfg.basketNforM = { n: d.basketN, m: d.basketM };
  }
  if (d.basketTopPercent > 0) {
    cfg.basketTopItem = { topPercent: d.basketTopPercent, restPercent: d.basketRestPercent };
  }
  return cfg;
}

/**
 * Draft the engine config from plain English. Returns a DRAFT the manager
 * reviews/edits in the simulator before saving. Throws AiNotConfiguredError when
 * AI is not set up so the caller can show a friendly message.
 */
export async function draftEngineConfig(params: {
  discountType: DiscountType;
  request: string;
}): Promise<{ draft: EngineConfigDraft; config: EngineConfig }> {
  const system =
    "You configure point-of-sale discount mechanics for a licensed Washington State (21+) cannabis retailer. " +
    "Translate the manager's description into the structured numeric tiers/fields. " +
    "Use ONLY the fields relevant to the chosen discount type and set the rest to 0. " +
    "Quantity tiers use item counts; weight tiers use GRAMS (1oz = 28g); spend tiers use CENTS ($50 = 5000). " +
    "Never invent products or brands. Output a DRAFT for the manager to confirm.";

  const user = [
    `Discount type: ${params.discountType}`,
    `Manager description: ${params.request}`,
    "",
    "Mapping examples:",
    "- 'buy 2 save 15%, 4+ save 25%' -> qty1At 2 qty1Pct 15, qty2At 4 qty2Pct 25",
    "- 'quarter 15%, half 20%, ounce 30%' -> wt1At 7 wt1Pct 15, wt2At 14 wt2Pct 20, wt3At 28 wt3Pct 30",
    "- 'spend $50 15%, $100 20%, $150 30%' -> spend1At 5000 spend1Pct 15, spend2At 10000 spend2Pct 20, spend3At 15000 spend3Pct 30",
    "- 'buy one get one free' -> bogoBuyQty 1 bogoGetQty 1 bogoGetPercent 100",
    "- 'buy 3 for the price of 2' -> basketN 3 basketM 2",
    "- '30% off top item, 15% off the rest' -> basketTopPercent 30 basketRestPercent 15",
  ].join("\n");

  const draft = await generateStructured<EngineConfigDraft>({
    system,
    user,
    schema: draftSchema,
    tier: "light",
    temperature: 0.1,
    context: { feature: "promotion.engine_config", entityType: "promotion" },
  });

  return { draft, config: draftToEngineConfig(draft) };
}

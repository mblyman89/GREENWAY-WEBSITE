import "server-only";

/**
 * PR-P3 — AI Smart Selector (server wrapper).
 *
 * Layers a plain-English front door on top of PR-P2's deterministic selection
 * brain (promotion-selector-core.ts). The manager types "all indica eighths
 * under $30 that aren't already on sale" and the AI translates it into a typed
 * SelectionPredicate. That predicate is then resolved against the LIVE menu by
 * the deterministic resolveSelection() — so the manager reviews the EXACT
 * products before anything is applied.
 *
 * This module is `server-only` because it calls the AI provider. The pure,
 * unit-testable transform + schema + self-tests live in
 * promotion-selector-ai-core.ts (no server-only, no provider import).
 *
 * DRAFTS-ONLY: the result only pre-fills the manager's form. Nothing is saved
 * until they review the resolved product list and submit. The CCRS below-cost
 * hard block and the coupon/giveaway bans still run server-side on publish.
 *
 * Gated on AI_API_KEY: generateStructured throws AiNotConfiguredError when AI is
 * not set up, so the caller shows a friendly "add an AI_API_KEY" message and the
 * manager can still use the hand-built rule builder.
 */

import { generateStructured } from "@/lib/ai/provider";
import { describePredicate, type SelectionPredicate } from "@/lib/promotions/promotion-selector-core";
import {
  draftToPredicate,
  predicateDraftSchema,
  type MenuVocabulary,
  type PredicateDraft,
} from "@/lib/promotions/promotion-selector-ai-core";

export type { MenuVocabulary, PredicateDraft } from "@/lib/promotions/promotion-selector-ai-core";

/**
 * The system prompt. Anchored to WA compliance and the anti-hallucination
 * contract so the model never invents product identity or emits keys.
 */
const SYSTEM =
  "You translate a cannabis retail manager's plain-English product-selection request into a STRUCTURED predicate " +
  "for a licensed Washington State (21+) retailer. You describe WHICH products a promotion should cover, using " +
  "ONLY attributes: sizes, categories, strain types, brands, vendors, name words, cannabinoids, price/weight/THC/CBD " +
  "ranges, and stock flags. " +
  "NEVER invent or list individual product names, product keys, SKUs, or IDs — the store's own system resolves the " +
  "exact products from your predicate. " +
  "Sizes are by grams: gram=1g, eighth=3.5g, quarter=7g, half=14g, ounce=28g. " +
  "Use ONLY the allowed values for sizes, cannabinoids, strain types, and inventory statuses. " +
  "For brands, categories, and vendors, echo exactly what the manager typed (the store validates them against the " +
  "live menu and silently drops anything not in stock). " +
  "Set any range you were not told about to -1, and any flag you were not told about to false / 'any'. " +
  "If the request is vague or you cannot map it, return an EMPTY predicate (all arrays empty, all ranges -1) — it is " +
  "far better to select nothing than to over-select. Never guess.";

export type SelectionPredicateDraftResult = {
  draft: PredicateDraft;
  predicate: SelectionPredicate;
  warnings: string[];
  empty: boolean;
  summary: string;
  restatement: string;
};

/**
 * Draft a SelectionPredicate from plain English against the live menu vocabulary.
 * Throws AiNotConfiguredError when AI is not set up (caller shows a friendly
 * message). DRAFTS-ONLY: the returned predicate is meant to be resolved and
 * reviewed, never auto-applied.
 */
export async function draftSelectionPredicate(params: {
  request: string;
  vocab: MenuVocabulary;
}): Promise<SelectionPredicateDraftResult> {
  const { request, vocab } = params;

  const user = [
    `Manager request: ${request}`,
    "",
    "Live menu vocabulary you may reference (do NOT use anything outside these for brands/categories/vendors):",
    `- Categories: ${vocab.categories.slice(0, 60).join(", ") || "(none)"}`,
    `- Brands: ${vocab.brands.slice(0, 120).join(", ") || "(none)"}`,
    `- Vendors: ${vocab.vendors.slice(0, 120).join(", ") || "(none)"}`,
    `- Strain types: ${vocab.strainTypes.join(", ") || "(none)"}`,
    `- Inventory statuses: ${vocab.inventoryStatuses.join(", ") || "(none)"}`,
    "",
    "Mapping examples:",
    "- 'indica eighths under $30 not already on sale' -> sizes:[eighth] strainTypes:[indica] priceMaxDollars:30 onSaleFilter:only_not_on_sale",
    "- 'high THC flower over 25%' -> categories:[flower] thcMinPercent:25",
    "- 'anything with CBG or CBN' -> hasCannabinoid:[cbg,cbn]",
    "- '1:1 ratio edibles' -> categories:[edibles] ratioProducts:true",
    "- 'low stock prerolls' -> categories:[prerolls] lowStock:true",
    "- 'new arrivals' -> newArrival:true",
  ].join("\n");

  const draft = await generateStructured<PredicateDraft>({
    system: SYSTEM,
    user,
    schema: predicateDraftSchema,
    tier: "light",
    temperature: 0.1,
    context: { feature: "promotion.selection_predicate", entityType: "promotion" },
  });

  const { predicate, warnings, empty } = draftToPredicate(draft, vocab);
  const restatement = describePredicate(predicate);

  return {
    draft,
    predicate,
    warnings,
    empty,
    summary: (draft.summary ?? "").trim(),
    restatement,
  };
}

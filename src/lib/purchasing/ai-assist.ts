/**
 * src/lib/purchasing/ai-assist.ts
 *
 * AI assistance for the Purchase Order builder (Slice 38), built on the EXISTING
 * AI infrastructure (generateStructured + the schema system). STANDING RULE:
 * AI output is a DRAFT suggestion only — it produces a filter/plan that the
 * purchasing manager reviews and edits before any PO is created or sent.
 *
 * Two helpers:
 *   - interpretPlanRequest: turn a plain-English purchasing request (e.g.
 *     "reorder all flower from Acme except pre-rolls, cover 3 weeks") into a
 *     structured PoFilter + target days of supply that we feed to the reorder
 *     engine. Pure interpretation; it never invents products.
 *   - draftPoNote: write a short, professional note for the PO email.
 */
import "server-only";

import { generateStructured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import type { PoFilter } from "@/lib/purchasing/po-core";

export type PlanRequestResult = {
  includeBrands: string[];
  excludeBrands: string[];
  includeCategories: string[];
  excludeCategories: string[];
  includeVendorNames: string[];
  excludeVendorNames: string[];
  targetDaysOfSupply: number;
  summary: string;
};

const planSchema = defineSchema<PlanRequestResult>("po_plan_request", {
  includeBrands: { kind: "stringArray", description: "Brand names to include; empty for all.", maxItems: 30 },
  excludeBrands: { kind: "stringArray", description: "Brand names to exclude.", maxItems: 30 },
  includeCategories: { kind: "stringArray", description: "Categories to include (e.g. flower, edible, vape, preroll, concentrate).", maxItems: 20 },
  excludeCategories: { kind: "stringArray", description: "Categories to exclude.", maxItems: 20 },
  includeVendorNames: { kind: "stringArray", description: "Vendor names to include; empty for all.", maxItems: 30 },
  excludeVendorNames: { kind: "stringArray", description: "Vendor names to exclude.", maxItems: 30 },
  targetDaysOfSupply: { kind: "number", description: "How many days of supply the order should cover. Default 21 if unspecified.", min: 1, max: 120 },
  summary: { kind: "string", description: "One-sentence plain-English summary of the plan for the manager to confirm.", maxLength: 240 },
});

/**
 * Interpret a free-text purchasing request into a structured plan. The known
 * vendor/brand/category vocabularies are passed in so the model maps phrases to
 * real values rather than inventing them. Returns a DRAFT plan for review.
 */
export async function interpretPlanRequest(params: {
  request: string;
  vocab: { vendors: string[]; brands: string[]; categories: string[] };
}): Promise<PlanRequestResult> {
  const system =
    "You are a purchasing assistant for a cannabis retailer. Convert the manager's " +
    "request into an include/exclude plan using ONLY the provided vocabularies. " +
    "Never invent brand, vendor, or category names that are not in the lists. " +
    "If the request does not mention a dimension, leave that list empty (meaning 'all'). " +
    "Output a DRAFT plan; the manager will review it.";

  const user = [
    `Request: ${params.request}`,
    "",
    `Known vendors: ${params.vocab.vendors.slice(0, 100).join(", ") || "(none)"}`,
    `Known brands: ${params.vocab.brands.slice(0, 100).join(", ") || "(none)"}`,
    `Known categories: ${params.vocab.categories.join(", ") || "flower, edible, vape, preroll, concentrate, topical, accessory"}`,
  ].join("\n");

  return generateStructured<PlanRequestResult>({
    system,
    user,
    schema: planSchema,
    tier: "light",
    temperature: 0.1,
  });
}

/** Map an interpreted plan + resolved vendor-id lookup into a PoFilter. */
export function planToFilter(
  plan: PlanRequestResult,
  vendorNameToId: Map<string, string>,
): PoFilter {
  const resolve = (names: string[]) =>
    names
      .map((n) => vendorNameToId.get(n.toLowerCase()))
      .filter((x): x is string => Boolean(x));
  return {
    includeBrands: plan.includeBrands,
    excludeBrands: plan.excludeBrands,
    includeCategories: plan.includeCategories,
    excludeCategories: plan.excludeCategories,
    includeVendorIds: resolve(plan.includeVendorNames),
    excludeVendorIds: resolve(plan.excludeVendorNames),
  };
}

const noteSchema = defineSchema<{ note: string }>("po_note", {
  note: { kind: "string", description: "A short, polite purchase-order note to the vendor.", maxLength: 400 },
});

/** Draft a short professional PO note for the vendor email. */
export async function draftPoNote(params: {
  vendorName: string;
  itemCount: number;
  expectedDate?: string | null;
}): Promise<string> {
  const system =
    "You write brief, professional purchase-order notes from a cannabis retailer to a vendor. " +
    "One or two sentences. No prices. Friendly and clear.";
  const user = `Vendor: ${params.vendorName}. Items: ${params.itemCount}.${
    params.expectedDate ? ` Requested delivery: ${params.expectedDate}.` : ""
  }`;
  const result = await generateStructured<{ note: string }>({
    system,
    user,
    schema: noteSchema,
    tier: "trivial",
    temperature: 0.4,
  });
  return result.note;
}

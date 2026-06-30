/**
 * src/lib/ai/schemas/grouping.ts
 *
 * Schema for AI product-master grouping suggestions (Slice 24, Feature A).
 *
 * The AI is shown a small CANDIDATE CLUSTER of menu items (already pre-filtered
 * to the same brand + category, so the model only decides finer grouping) and
 * asked which of them are truly the SAME product sold at different sizes/forms.
 * It returns the proposed master display name, the member keys to group, a
 * one-line PII-free rationale, and a 0..1 confidence.
 *
 * Because the structured-output validator only supports string arrays (not
 * arrays of objects), members are returned as a list of the opaque key tokens
 * we hand to the model. Variant labels are derived deterministically afterwards
 * from each item's name/package size, so the AI never invents a size.
 */
import { defineSchema } from "../schema";

export type GroupingSuggestionResult = {
  /** True if these items really are one product at different sizes/forms. */
  should_group: boolean;
  /** Clean display name for the grouped product card. */
  display_name: string;
  /** The member key tokens (subset of the provided keys) to group together. */
  member_keys: string[];
  /** One short, PII-free sentence on why they belong together. */
  rationale: string;
  /** 0..1 confidence the grouping is correct. */
  confidence: number;
};

export const groupingSuggestionSchema = defineSchema<GroupingSuggestionResult>(
  "product_grouping",
  {
    should_group: {
      kind: "boolean",
      description:
        "True ONLY if two or more of the provided items are genuinely the SAME product (same strain/line/brand) sold at different sizes or forms. False if they are distinct products.",
    },
    display_name: {
      kind: "string",
      description:
        "A clean customer-facing product name for the grouped card (no size, no price, no stock). Empty string if should_group is false.",
      minLength: 0,
      maxLength: 120,
    },
    member_keys: {
      kind: "stringArray",
      description:
        "The exact key tokens (from the provided list) of the items that should be grouped together. Include only keys that truly belong to this one product. Empty if should_group is false.",
      maxItems: 40,
    },
    rationale: {
      kind: "string",
      description:
        "One short sentence explaining why these are the same product. No customer names, no health claims.",
      minLength: 0,
      maxLength: 240,
    },
    confidence: {
      kind: "number",
      description:
        "0 to 1. How confident you are that this grouping is correct (1 = certain).",
      min: 0,
      max: 1,
    },
  },
);

/**
 * src/lib/ai/schemas/product.ts
 *
 * Typed schemas for AI product enrichment. These drive BOTH the structured
 * output request (JSON Schema sent to the model) and the runtime validation of
 * what comes back, so a malformed/hallucinated response can never become a
 * draft. Each schema asks the model to be honest about CONFIDENCE and to flag
 * when it had to guess, which is how we keep the accept-rate high and avoid
 * paying for output that gets rejected.
 */
import { defineSchema } from "../schema";

/** The fixed merchandising tag vocabulary (mirrors enrichment ProductTag). */
export const ALLOWED_PRODUCT_TAGS = [
  "new-arrival",
  "best-seller",
  "staff-pick",
  "local",
  "high-cbd",
  "high-thc",
  "value",
  "limited",
] as const;

export type ProductDescriptionResult = {
  description: string;
  short_description: string;
  /** 0..1 — how grounded the copy is in the provided facts. */
  confidence: number;
  /** True if the model had to write generically due to missing facts. */
  used_generic_language: boolean;
};

export const productDescriptionSchema = defineSchema<ProductDescriptionResult>(
  "product_description",
  {
    description: {
      kind: "string",
      description: "2-3 sentence product description (~35-60 words). Aroma, flavor, format, strain character only. No price, no stock, no health/medical/effect claims.",
      minLength: 20,
      maxLength: 600,
    },
    short_description: {
      kind: "string",
      description: "A single punchy sentence (max ~120 chars) for cards/menus.",
      minLength: 8,
      maxLength: 160,
    },
    confidence: {
      kind: "number",
      description: "0 to 1. How well the copy is grounded in the provided facts (1 = fully grounded, 0 = mostly guessed).",
      min: 0,
      max: 1,
    },
    used_generic_language: {
      kind: "boolean",
      description: "True if facts were too thin and you had to write generically.",
    },
  },
);

export type ProductTagsResult = {
  tags: string[];
  confidence: number;
};

export const productTagsSchema = defineSchema<ProductTagsResult>("product_tags", {
  tags: {
    kind: "stringArray",
    description: "0-3 tags that genuinely fit, from the allowed list only.",
    allowed: ALLOWED_PRODUCT_TAGS,
    maxItems: 3,
  },
  confidence: {
    kind: "number",
    description: "0 to 1 confidence that these tags are correct.",
    min: 0,
    max: 1,
  },
});

export type ProductSensoryResult = {
  /** Comma-free aroma notes, e.g. ["citrus", "pine", "earthy"]. */
  aroma_notes: string[];
  flavor_notes: string[];
  /** Dominant terpenes if derivable from strain/brand facts (else empty). */
  terpenes: string[];
  confidence: number;
  used_generic_language: boolean;
};

export const productSensorySchema = defineSchema<ProductSensoryResult>("product_sensory", {
  aroma_notes: {
    kind: "stringArray",
    description: "Up to 5 single-word/short aroma descriptors (citrus, pine, earthy, floral, diesel, sweet, …). Sensory only — never effects/medical.",
    maxItems: 5,
  },
  flavor_notes: {
    kind: "stringArray",
    description: "Up to 5 short flavor descriptors.",
    maxItems: 5,
  },
  terpenes: {
    kind: "stringArray",
    description: "Dominant terpenes ONLY if supported by the provided strain/brand facts; otherwise empty. (myrcene, limonene, caryophyllene, pinene, linalool, terpinolene, humulene)",
    maxItems: 4,
  },
  confidence: { kind: "number", description: "0 to 1 grounding confidence.", min: 0, max: 1 },
  used_generic_language: { kind: "boolean", description: "True if facts were too thin." },
});

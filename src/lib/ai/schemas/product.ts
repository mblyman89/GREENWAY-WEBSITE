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
import { ALLOWED_EFFECTS } from "../compliance";
import { strainTypeValues } from "@/lib/menu/strain-taxonomy";

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

export type ProductEffectsResult = {
  /**
   * EXPERIENTIAL descriptors ONLY, from the allowed list. Never medical claims.
   * The app re-validates these with checkEffects() before anything is stored.
   */
  effects: string[];
  confidence: number;
  used_generic_language: boolean;
};

export const productEffectsSchema = defineSchema<ProductEffectsResult>("product_effects", {
  effects: {
    kind: "stringArray",
    description:
      "Up to 4 general experiential effect descriptors from the allowed list ONLY: [" +
      ALLOWED_EFFECTS.join(", ") +
      "]. Describe the general vibe/character, NOT medical benefits. NEVER say cure, treat, heal, relieve, or name any condition/symptom. If facts are thin, return an empty list.",
    allowed: ALLOWED_EFFECTS,
    maxItems: 4,
  },
  confidence: { kind: "number", description: "0 to 1 grounding confidence.", min: 0, max: 1 },
  used_generic_language: { kind: "boolean", description: "True if facts were too thin." },
});

// R23 (fix 4): product SEO title + meta description draft. The lengths are
// enforced again by seo-draft-core (cleanSeoTitle / cleanSeoMeta) after the
// reply, so a model that ignores maxLength can never store an over-long pair.
export type ProductSeoResult = {
  seo_title: string;
  seo_description: string;
  confidence: number;
};

export const productSeoSchema = defineSchema<ProductSeoResult>("product_seo", {
  seo_title: {
    kind: "string",
    description:
      "Search-result title for this product page, at most 39 characters. Product name first, then brand or format. Do NOT include the store name (it is appended automatically). No price, no stock, no trailing period.",
    minLength: 4,
    maxLength: 80,
  },
  seo_description: {
    kind: "string",
    description:
      "Meta description, 120-160 characters. Aroma, flavor, format, brand and that it is available for in-store pickup at a licensed 21+ Washington retailer. No price, no stock, no health, medical or effect claims.",
    minLength: 40,
    maxLength: 320,
  },
  confidence: {
    kind: "number",
    description: "0 to 1. How well the title and description are grounded in the provided facts.",
    min: 0,
    max: 1,
  },
});

// D244 E-4: ONE call drafts every field. Each field carries its own
// confidence, the evidence ids it rests on (from the list in the prompt) and
// a best_guess flag. ai-draft-v2-core.normalizeDraftField re-clamps all three
// (evidence filtered to ids we offered; best guesses capped) after the reply.
const draftMeta = {
  confidence: { kind: "number", description: "0 to 100. How sure you are THIS field is right for THIS product.", min: 0, max: 100 },
  evidence: {
    kind: "stringArray",
    description: "The evidence ids (exactly as written in square brackets in the prompt, e.g. pos, vendor, photo:1, kb:strain:blue dream) this field rests on.",
    maxItems: 6,
  },
  best_guess: {
    kind: "boolean",
    description: "True if this field is inferred from category or strain-family norms rather than stated by the evidence for this exact product.",
  },
} as const;

export type DraftMetaRaw = { confidence: number; evidence: string[]; best_guess: boolean };

export type ProductAllFieldsResult = {
  display_name: DraftMetaRaw & { value: string };
  description: DraftMetaRaw & { value: string };
  short_description: DraftMetaRaw & { value: string };
  seo: DraftMetaRaw & { title: string; meta: string };
  sensory: DraftMetaRaw & { aroma_notes: string[]; flavor_notes: string[]; terpenes: string[] };
  effects: DraftMetaRaw & { values: string[] };
  tags: DraftMetaRaw & { values: string[] };
  /** D244 R-2: from the lot / lab certificate / POS / strain library. */
  strain_type: DraftMetaRaw & { value: string };
  /** D244 R-2: copied from the lab certificate / lot / POS only ("" when none). */
  potency: DraftMetaRaw & { thc: string; cbd: string };
};

export const productAllFieldsSchema = defineSchema<ProductAllFieldsResult>("product_all_fields", {
  display_name: {
    kind: "object",
    fields: {
      value: { kind: "string", description: "Clean customer-facing product name (brand + strain/product + format/size). No price, no store name.", maxLength: 120 },
      ...draftMeta,
    },
  },
  description: {
    kind: "object",
    fields: {
      value: {
        kind: "string",
        description: "2-3 sentence product description (~35-60 words). Aroma, flavor, format, strain character only. No price, no stock, no health/medical/effect claims.",
        maxLength: 700,
      },
      ...draftMeta,
    },
  },
  short_description: {
    kind: "object",
    fields: {
      value: { kind: "string", description: "One punchy sentence (max ~120 chars) for cards/menus.", maxLength: 200 },
      ...draftMeta,
    },
  },
  seo: {
    kind: "object",
    fields: {
      title: { kind: "string", description: "Search-result title, at most 39 characters. Product name first. No store name, no price, no trailing period.", maxLength: 100 },
      meta: { kind: "string", description: "Meta description, 120-160 characters. Mentions in-store pickup. No price, stock, health, medical or effect claims.", maxLength: 340 },
      ...draftMeta,
    },
  },
  sensory: {
    kind: "object",
    fields: {
      aroma_notes: { kind: "stringArray", description: "Up to 5 short aroma descriptors. Sensory only.", maxItems: 5 },
      flavor_notes: { kind: "stringArray", description: "Up to 5 short flavor descriptors.", maxItems: 5 },
      terpenes: { kind: "stringArray", description: "Dominant terpenes ONLY if the evidence supports it; else empty.", maxItems: 4 },
      ...draftMeta,
    },
  },
  effects: {
    kind: "object",
    fields: {
      values: {
        kind: "stringArray",
        description: "Up to 4 experiential descriptors from the allowed list ONLY: [" + ALLOWED_EFFECTS.join(", ") + "]. Never medical.",
        allowed: ALLOWED_EFFECTS,
        maxItems: 4,
      },
      ...draftMeta,
    },
  },
  tags: {
    kind: "object",
    fields: {
      values: { kind: "stringArray", description: "0-3 merchandising tags from the allowed list only.", allowed: ALLOWED_PRODUCT_TAGS, maxItems: 3 },
      ...draftMeta,
    },
  },
  strain_type: {
    kind: "object",
    fields: {
      value: {
        kind: "enum",
        values: strainTypeValues,
        description:
          "The product's strain type. Prefer the lab certificate / lot ([coa:N] / [lot:N]), then [pos], then the strain library. Use unknown when nothing says.",
      },
      ...draftMeta,
    },
  },
  potency: {
    kind: "object",
    fields: {
      thc: {
        kind: "string",
        description: 'Total THC COPIED from [coa:N], [lot:N] or [pos], like "24.5%" (flower, carts, concentrates) or "100mg" (edibles, drinks, tinctures). "" when no evidence states it. Never estimate.',
        maxLength: 20,
      },
      cbd: { kind: "string", description: 'Total CBD, copied the same way. "" when no evidence states it.', maxLength: 20 },
      ...draftMeta,
    },
  },
});

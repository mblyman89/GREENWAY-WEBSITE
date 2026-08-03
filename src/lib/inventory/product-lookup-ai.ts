/**
 * src/lib/inventory/product-lookup-ai.ts
 *
 * The AI PRODUCT/STRAIN LOOKUP (T-314). Server-only wrapper that runs the
 * Google-style lookup the operator triggers from the Product Onboarding table.
 *
 * Flow:
 *   1. KB FIRST (free, instant): if we already know this strain, return it with
 *      full confidence \u2014 no spend, no network. (Handled by the caller via the
 *      SLICE 93 suggestion; this module focuses on the AI hop.)
 *   2. LIVE WEB SEARCH: GPT-4o + the OpenAI web_search tool (provider.generate\u2011
 *      WebSearch) reads the real internet and returns an answer + source URLs.
 *      If the web_search tool is unavailable it gracefully falls back to GPT-4o
 *      built-in knowledge (usedWebSearch=false, no live sources).
 *   3. SANITIZE via the pure core (postProcessLookup): compliance gate +
 *      >= 90% autofill bar. Medical/curative copy dropped; never guesses.
 *
 * Standing rules honored: no guessing (low confidence \u2192 honest miss), full
 * gpt-4o pinned by the provider's web-search path (not router-downshifted),
 * budget-guarded + usage-logged by the provider, compliance-baked.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import {
  generateWebSearch,
  isAiConfigured,
  aiWebSearchModelId,
  type AiContext,
} from "@/lib/ai/provider";
import { looseParseLookupJson } from "@/lib/inventory/product-lookup-parse";
import {
  PRODUCT_LOOKUP_SYSTEM,
  buildLookupUserPrompt,
  postProcessLookup,
  type ProductLookupResult,
  type RawProductLookup,
} from "@/lib/inventory/product-lookup-core";
import type { ExtraBannedPhrase } from "@/lib/ai/compliance";

export { isAiConfigured };

/** The model id the lookup uses (for provenance in the UI). */
export const productLookupModelId = aiWebSearchModelId;

/** The full outcome handed back to the server action / UI. */
export type ProductLookupOutcome = {
  /** The sanitized, compliance-gated result. */
  result: ProductLookupResult;
  /** Real source URLs the model consulted (may be []). */
  sources: string[];
  /** The model id that produced this. */
  model: string;
  /** True when the live web_search tool ran; false on built-in-knowledge fallback. */
  usedWebSearch: boolean;
};

/** JSON shape hint appended to the user prompt (the web_search path has no
 *  response_format, so we ask for the shape explicitly and parse tolerantly). */
const SHAPE_HINT = `

Respond with ONLY a JSON object (no prose, no code fences) with EXACTLY these keys:
{
  "strain_type": "indica|sativa|hybrid|indica-hybrid|sativa-hybrid|cbd|unknown",
  "strain_type_confidence": 0.0,
  "summary": "sensory/experiential description, or empty string",
  "effects": ["experiential words only"],
  "aroma_notes": ["..."],
  "flavor_notes": ["..."],
  "lineage": "parents if verified, else empty string",
  "found": true,
  "description": "full marketing description (sensory/experiential only), or empty string",
  "short_description": "one catchy line under ~120 chars, or empty string",
  "category": "flower|pre-roll|vape|concentrate|edible|beverage|tincture|topical|capsule|accessory|other or empty string",
  "potency_ratio": "printed cannabinoid ratio like 1:1 or 20:1, or empty string",
  "size": "printed net size like 12oz / 3.5g / 10pk, or empty string",
  "image_candidates": ["direct http(s) image URLs of THIS product; [] if unsure"]
}`;

/**
 * Run the AI lookup for a product. Returns a sanitized outcome. Throws only for
 * hard configuration/budget errors (AiNotConfiguredError / AiBudgetExceededError
 * from the provider) so the server action can surface a clear message; a plain
 * "not found" is a NORMAL result (result.found === false), never an exception.
 */
export async function lookupProduct(input: {
  query: string;
  productName?: string | null;
  vendorOrBrand?: string | null;
  extraBanned?: ExtraBannedPhrase[];
  context?: AiContext;
}): Promise<ProductLookupOutcome> {
  const user = buildLookupUserPrompt({
    query: input.query,
    productName: input.productName,
    vendorOrBrand: input.vendorOrBrand,
  });

  const ws = await generateWebSearch({
    system: PRODUCT_LOOKUP_SYSTEM,
    user: `${user}${SHAPE_HINT}`,
    temperature: 0.3,
    maxTokens: 900,
    context: {
      feature: "inventory.product_lookup",
      ...input.context,
    },
  });

  const raw = coerceRaw(looseParseLookupJson(ws.text));

  // Extra value: also mine the real web_search source URLs for anything that
  // looks like a product image, and offer them as ADDITIONAL candidates. This
  // means we can still surface images even when the model forgets the
  // image_candidates array. The pure core (cleanImageCandidates) then dedupes,
  // drops logos/icons/svg, and caps the list \u2014 nothing is auto-imported.
  const fromSources = ws.sources.filter((u) => IMAGE_URL_RE.test(u));
  raw.image_candidates = [...(raw.image_candidates ?? []), ...fromSources];

  const result = postProcessLookup(raw, input.extraBanned ?? []);

  return {
    result,
    sources: ws.sources,
    model: ws.model,
    usedWebSearch: ws.usedWebSearch,
  };
}

/** URLs that end in a common raster image extension (query string tolerated). */
const IMAGE_URL_RE = /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i;

/** Coerce a parsed unknown into a RawProductLookup with safe defaults. */
function coerceRaw(parsed: unknown): RawProductLookup {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    strain_type: String(o.strain_type ?? "unknown"),
    strain_type_confidence: num(o.strain_type_confidence),
    summary: String(o.summary ?? ""),
    effects: arr(o.effects),
    aroma_notes: arr(o.aroma_notes),
    flavor_notes: arr(o.flavor_notes),
    lineage: String(o.lineage ?? ""),
    found: Boolean(o.found),
    // T-315 all-inclusive fields.
    description: String(o.description ?? ""),
    short_description: String(o.short_description ?? ""),
    category: String(o.category ?? ""),
    potency_ratio: String(o.potency_ratio ?? ""),
    size: String(o.size ?? ""),
    image_candidates: arr(o.image_candidates),
  };
}

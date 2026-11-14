/**
 * src/lib/ai/all-fields-draft.ts  (D244 E-4 - AI drafting v2)
 *
 * "Enrich this product (all fields)": ONE structured call drafts display
 * name, description, short description, SEO, sensory, effects and tags. Every
 * fact in the prompt is tagged with an evidence id ([pos], [vendor],
 * [photo:N], [kb:...]) and the model cites ids per field. The reply is then
 * re-clamped by ai-draft-v2-core (evidence filtered to ids we offered, best
 * guesses capped, no-evidence capped), compliance-scanned, effects re-gated,
 * SEO re-cleaned, and stored as ONE pending ai_suggestions row per field.
 * D244 R-2: the product's own lots and lab certificates are evidence too
 * ([lot:N] / [coa:N], lot-evidence-core); strain type and potency are
 * drafted from them, and a potency number that matches no evidence number
 * is dropped before it is filed (checkPotencyDraft).
 * D244 R-3: split into buildAllFieldsRequest (prompt + evidence) and
 * storeAllFieldsResult (re-clamp + store) so the overnight Gemini batch
 * (enrich-batch-server) stores its replies through the same code.
 * Nothing is applied here - a person accepts (acceptWithComplianceGate).
 */
import "server-only";
import { generateStructured } from "./provider";
import { enrichModel } from "./enrich-model";
import { enrichMaxTokens } from "./enrich-model-core";
import { COMPLIANCE_SYSTEM, checkCompliance, checkEffects } from "./compliance";
import { productAllFieldsSchema, ALLOWED_PRODUCT_TAGS, type DraftMetaRaw, type ProductAllFieldsResult } from "./schemas/product";
import { buildGroundedFacts, loadBannedPhrases } from "./kb/retrieval";
import { persistSuggestion, type ProductFacts } from "./suggestions";
import { SEO_FIELD_KEY, SEO_TITLE_MAX, SEO_META_MAX, seoSuggestionValue } from "@/lib/enrichment/seo-draft-core";
import {
  ALL_FIELDS,
  encodeEvidenceSource,
  normalizeDraftField,
  photoFactLines,
  type DraftFieldKey,
  type PhotoFacts,
} from "@/lib/enrichment/ai-draft-v2-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  checkPotencyDraft,
  posPotencyNumbers,
  potencyText,
  type LotEvidence,
  type PotencyReading,
} from "@/lib/enrichment/lot-evidence-core";

export type AllFieldsCurrent = Partial<Record<DraftFieldKey, string | null>>;

export type AllFieldsOutcome = {
  saved: { field: DraftFieldKey; id: string; confidence: number; bestGuess: boolean; flags: string[] }[];
  skipped: { field: DraftFieldKey; reason: string }[];
};

function posLines(f: ProductFacts): string[] {
  return [
    `Product name (POS): ${f.name}`,
    f.brand ? `Brand (POS): ${f.brand}` : null,
    f.category ? `Category (POS): ${f.category}` : null,
    f.strainType && f.strainType !== "unknown" ? `Strain type (POS): ${f.strainType}` : null,
    f.strainName ? `Strain (POS): ${f.strainName}` : null,
    f.thc ? `THC (POS): ${f.thc}` : null,
    f.cbd ? `CBD (POS): ${f.cbd}` : null,
  ].filter(Boolean) as string[];
}

/** Build the evidence-tagged prompt; exported shape is pinned by the E-4 test. */
export function allFieldsPrompt(input: {
  facts: ProductFacts;
  photoLines: string[];
  groundedBlock: string;
  groundedSources: string[];
  current: AllFieldsCurrent;
  /** D244 R-2: [lot:N] / [coa:N] lines (lot-evidence-core). */
  lotLines?: string[];
}): string {
  const { facts } = input;
  const evidence: string[] = [];
  for (const l of posLines(facts)) evidence.push(`[pos] ${l}`);
  if (facts.vendor) evidence.push(`[vendor] Vendor (who we buy it from): ${facts.vendor}`);
  evidence.push(...input.photoLines);
  evidence.push(...(input.lotLines ?? []));
  const kb = input.groundedSources.length
    ? `KNOWLEDGE BASE (cite these ids: ${input.groundedSources.map((s) => `[${s}]`).join(" ")}):\n${input.groundedBlock}`
    : "";
  const onRecord = ALL_FIELDS.filter((k) => input.current[k])
    .map((k) => `- ${k}: ${String(input.current[k]).slice(0, 300)}`)
    .join("\n");
  return [
    "Draft EVERY field for this product page at a licensed 21+ Washington State cannabis retailer (Greenway Marijuana, Port Orchard). Use ONLY the evidence below.",
    "For each field: give the value, a confidence 0-100, the evidence ids (exactly as shown in square brackets) it rests on, and best_guess.",
    "You MAY infer from strain-family or category norms when the evidence for this exact product is thin, but then best_guess MUST be true and confidence low.",
    "CONFIDENCE CALIBRATION: confidence is how sure you are the value is CORRECT for this exact product, not how creative it is. When the value is stated directly by [pos], [vendor], a [photo:N] label or a [kb:product...] / [kb:brand] fact, say 90-100 - do not be modest about facts you copied from the evidence. 70-89 = well supported but partly worded by you. Below 50 only when you genuinely doubt it.",
    `SEO title at most ${SEO_TITLE_MAX} characters, product name first, no store name. Meta description 120-${SEO_META_MAX} characters, mentions in-store pickup.`,
    `Effects only from the allowed experiential list; tags only from: ${ALLOWED_PRODUCT_TAGS.join(", ")}. Return empty lists when nothing fits.`,
    "STRAIN TYPE: take it from a [coa:N] or [lot:N] line first, then [pos], then a [kb:strain:...] fact; unknown when none says. Cite the ids you used.",
    "POTENCY: copy total THC / CBD exactly as a [coa:N], [lot:N] or [pos] line states it, with its unit (% or mg); prefer the newest in-stock lot's lab certificate. Leave it empty when no line states it - never estimate a number.",
    "Never mention price, stock, discounts, health or medical claims, or anything that appeals to minors.",
    "",
    `EVIDENCE:\n${evidence.join("\n")}`,
    kb,
    onRecord ? `ALREADY ON RECORD (improve, don't contradict the evidence):\n${onRecord}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

/**
 * D244 R-3: everything a draft needs that is not the model's reply. Built
 * once per product; the live call sends it now, the overnight batch keeps
 * `offered` / `numbers` / `summary` on the queue row and stores the reply
 * hours later through the SAME storeAllFieldsResult. One code path.
 */
export type AllFieldsRequest = {
  system: string;
  user: string;
  /** Evidence ids offered in the prompt (ids the model invents are dropped). */
  offered: string[];
  /** Potency numbers any evidence line states (POS + lots + COAs). */
  numbers: { thc: PotencyReading[]; cbd: PotencyReading[] };
  /** The input_summary prefix stored on every suggestion. */
  summary: string;
};

export async function buildAllFieldsRequest(
  facts: ProductFacts,
  photos: PhotoFacts[],
  current: AllFieldsCurrent,
  lots: LotEvidence | null = null,
): Promise<AllFieldsRequest> {
  const grounded = await buildGroundedFacts(facts);
  const photo = photoFactLines(photos);
  const offered = ["pos", ...(facts.vendor ? ["vendor"] : []), ...photo.ids, ...(lots?.ids ?? []), ...grounded.sources];
  const user = allFieldsPrompt({
    facts,
    photoLines: photo.lines,
    groundedBlock: grounded.block,
    groundedSources: grounded.sources,
    current,
    lotLines: lots?.lines ?? [],
  });
  const pos = posPotencyNumbers(facts.thc, facts.cbd);
  return {
    system: COMPLIANCE_SYSTEM,
    user,
    offered,
    numbers: { thc: [...pos.thc, ...(lots?.numbers.thc ?? [])], cbd: [...pos.cbd, ...(lots?.numbers.cbd ?? [])] },
    summary: `all-fields v2 · ${facts.name}${facts.vendor ? ` · vendor ${facts.vendor}` : ""} · offered: ${offered.join(", ")}`,
  };
}

/** The answer budget (the Gemini floor is applied by the caller's model). */
export const ALL_FIELDS_ANSWER_TOKENS = 1300;

/**
 * Draft all fields in one call and store one pending suggestion per field.
 * Throws only on the model call itself (the caller turns that into a flash).
 */
export async function generateProductAllFields(
  posProductKey: string,
  facts: ProductFacts,
  photos: PhotoFacts[],
  current: AllFieldsCurrent,
  generatedBy: string | null,
  lots: LotEvidence | null = null,
): Promise<AllFieldsOutcome> {
  const req = await buildAllFieldsRequest(facts, photos, current, lots);
  const result = await generateStructured({
    system: req.system,
    user: req.user,
    schema: productAllFieldsSchema,
    tier: "heavy",
    // D244 round 2 (R-1): the dedicated enrichment model (AI_ENRICH_MODEL),
    // independent of AI_MODE, with its reasoning effort / Gemini 32K floor.
    model: enrichModel.model,
    reasoningEffort: enrichModel.effort,
    maxTokens: enrichMaxTokens(enrichModel, ALL_FIELDS_ANSWER_TOKENS),
    context: { feature: "product.all_fields", entityType: "product", entityId: posProductKey, actorId: generatedBy },
  });
  return storeAllFieldsResult(posProductKey, req, result, generatedBy, enrichModel.model);
}

/**
 * Re-clamp, re-gate and store a validated reply (live or batch). Nothing is
 * applied here - each field is one pending suggestion a person accepts.
 */
export async function storeAllFieldsResult(
  posProductKey: string,
  req: Pick<AllFieldsRequest, "offered" | "numbers" | "summary">,
  result: ProductAllFieldsResult,
  generatedBy: string | null,
  model: string,
  summaryNote = "",
): Promise<AllFieldsOutcome> {
  const banned = await loadBannedPhrases();
  const offered = req.offered;
  const summary = `${req.summary}${summaryNote}`;
  const out: AllFieldsOutcome = { saved: [], skipped: [] };

  const store = async (field: DraftFieldKey, value: string | null, raw: DraftMetaRaw, flags: string[], note = "") => {
    if (!value || !value.trim()) {
      out.skipped.push({ field, reason: "the reply had nothing usable for this field" });
      return;
    }
    const meta = normalizeDraftField(field, raw, offered);
    const s = await persistSuggestion({
      entity_type: "product",
      entity_id: posProductKey,
      field_key: field === "seo" ? SEO_FIELD_KEY : field,
      suggested_value: value,
      input_summary: `${summary}${note}`,
      generated_by: generatedBy,
      confidence: meta.confidence / 100,
      source: encodeEvidenceSource(meta),
      model,
    });
    out.saved.push({ field, id: s.id, confidence: meta.confidence, bestGuess: meta.bestGuess, flags });
  };
  const flagsOf = (text: string) => checkCompliance(text, banned).flags;

  const dn = result.display_name.value?.trim() ?? "";
  await store("display_name", dn, result.display_name, flagsOf(dn));
  const desc = result.description.value?.trim() ?? "";
  await store("description", desc, result.description, flagsOf(desc));
  const sd = result.short_description.value?.trim() ?? "";
  await store("short_description", sd, result.short_description, flagsOf(sd));

  const seo = seoSuggestionValue({ title: result.seo.title, description: result.seo.meta });
  await store("seo", seo, result.seo, seo ? flagsOf(`${result.seo.title} ${result.seo.meta}`) : []);

  const sens = result.sensory;
  const sensoryValue =
    sens.aroma_notes.length || sens.flavor_notes.length || sens.terpenes.length
      ? JSON.stringify({ aroma_notes: sens.aroma_notes, flavor_notes: sens.flavor_notes, terpenes: sens.terpenes })
      : null;
  await store("sensory", sensoryValue, sens, flagsOf([...sens.aroma_notes, ...sens.flavor_notes, ...sens.terpenes].join(" ")));

  const gate = checkEffects(result.effects.values, banned);
  await store(
    "effects",
    gate.allowed.join(", "),
    result.effects,
    gate.rejected.map((r) => `effect "${r.effect}": ${r.reason}`),
    gate.rejected.length ? ` | dropped: ${gate.rejected.map((r) => r.effect).join(", ")}` : "",
  );

  const tagSet = new Set<string>(ALLOWED_PRODUCT_TAGS);
  await store("tags", result.tags.values.filter((t) => tagSet.has(t)).join(", "), result.tags, []);

  // D244 R-2: strain type (canonical; "unknown" is not a draft).
  if (result.strain_type) {
    const t = canonicalStrainType(result.strain_type.value);
    await store("strain_type", t === "unknown" ? null : t, result.strain_type, []);
  }
  // D244 R-2: potency - only numbers an evidence line actually carries.
  if (result.potency) {
    const checked = checkPotencyDraft(result.potency, req.numbers);
    const text = potencyText(checked.value);
    await store(
      "potency",
      text,
      result.potency,
      checked.dropped.map((d) => `${d}: no lab, lot or POS number says so`),
      checked.dropped.length ? ` | dropped (no evidence number): ${checked.dropped.join(", ")}` : "",
    );
  }

  return out;
}

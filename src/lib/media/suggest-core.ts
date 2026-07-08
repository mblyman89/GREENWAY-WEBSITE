/**
 * src/lib/media/suggest-core.ts — Slice H10c (KB-grounded media suggestions).
 *
 * PURE helpers behind the "suggest ALL fields" media action: derive the
 * grounding query from the asset's own signals, build the single structured
 * prompt (vision verdict + title + description + alt in ONE call), and parse
 * the model's JSON defensively.
 *
 * WHY: the owner's screenshots showed the old suggester describing a Rosinade
 * product can as "a vendor logo … bright blue can" — literal pixels instead of
 * knowledge. These helpers make the model (a) say WHAT the image is from a
 * closed vocabulary so the classifier can act on it, and (b) write copy that
 * stays inside the KB facts we hand it (rosin/edible category vocabulary,
 * company about/mission/philosophy) instead of narrating colors.
 *
 * No server imports — everything here is deterministic and unit-tested.
 */

import { VISION_SUBJECTS, type VisionSubject } from "./classify-core";
import { isValidPurpose } from "./taxonomy";

// ---------------------------------------------------------------------------
// Signal derivation (what to ask the KB about)
// ---------------------------------------------------------------------------

/**
 * Harvested assets are titled "<Entity Name> (harvested)" by the importers.
 * Strip the marker (and any parenthetical suffix) to recover the entity name.
 */
export function entityNameFromTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  if (!t) return "";
  return t.replace(/\s*\((?:harvested|imported|crawl(?:ed)?)\)\s*$/i, "").trim();
}

/** Words that map to a KB category via normalizeCategory() in retrieval.ts. */
const CATEGORY_WORDS = [
  "edibles", "edible", "gummies", "gummy", "chocolate", "beverage", "drink",
  "rosin", "resin", "concentrate", "hash",
  "flower", "preroll", "pre-roll", "joint",
  "vape", "cartridge", "cart",
  "tincture", "topical",
];

/**
 * Find the first category word present in the crawl path + filename + tags.
 * The word is passed straight into ProductFacts.category — retrieval's
 * normalizeCategory() maps "edibles"→edible, "rosin"→concentrate, etc.
 */
export function deriveCategoryWord(input: {
  path?: string | null;
  filename?: string | null;
  tags?: string[] | null;
}): string {
  const hay = [input.path, input.filename, ...(input.tags ?? [])]
    .map((s) => (s ?? "").toLowerCase())
    .join(" ");
  for (const w of CATEGORY_WORDS) if (hay.includes(w)) return w;
  return "";
}

/**
 * Turn a crawl filename into a human product-ish name for the KB query:
 * strip extension, dimension suffixes (…-640x1156), separators → spaces.
 * "Constellation-Rosinade-Lemonade-640x1156.png" → "Constellation Rosinade Lemonade".
 */
export function nameFromFilename(filename: string | null | undefined): string {
  let s = (filename ?? "").trim();
  if (!s) return "";
  s = s.replace(/\.[a-z0-9]{2,5}$/i, "");           // extension
  s = s.replace(/[-_]?\d{2,5}x\d{2,5}(?:@\dx)?$/i, ""); // -640x1156 / @2x
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// ---------------------------------------------------------------------------
// Label facts (H12b) — what is PRINTED on the packaging.
//
// Owner: "a lot of constellation products are 1:1 THC:CBD or 2:1:1
// THC:CBG:CBN … adding these ratios in the name would be beneficial. Also …
// the shots specifically say what the strain is and even the strain type
// (hybrid, indica, sativa)."
//
// The model is asked to READ the label and report these as structured fields;
// everything is validated against closed vocabularies here so a hallucinated
// ratio or made-up strain type can never reach the form. Never-guess: a fact
// that isn't legible on the packaging stays "".
// ---------------------------------------------------------------------------

/** Cannabinoids that legitimately appear in on-label ratios. Closed set. */
export const RATIO_CANNABINOIDS = [
  "THC", "CBD", "CBG", "CBN", "CBC", "THCV", "CBDV", "THCA", "CBDA",
] as const;

/** On-label strain types. Closed set (dominant-hybrids normalize below). */
export const STRAIN_TYPES = ["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid"] as const;
export type StrainType = (typeof STRAIN_TYPES)[number];

/**
 * Normalize a model-reported strain type to the closed vocabulary; "" when it
 * isn't one ("energetic", "loud", …). "Indica-dominant hybrid" and friends
 * fold into indica-hybrid / sativa-hybrid.
 */
export function normalizeStrainType(raw: string | null | undefined): StrainType | "" {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  if ((STRAIN_TYPES as readonly string[]).includes(s)) return s as StrainType;
  if (/^indica[ -]dominant( hybrid)?$/.test(s) || s === "hybrid indica" || s === "hybrid-indica") return "indica-hybrid";
  if (/^sativa[ -]dominant( hybrid)?$/.test(s) || s === "hybrid sativa" || s === "hybrid-sativa") return "sativa-hybrid";
  return "";
}

/**
 * Validate + normalize a cannabinoid ratio as printed on packaging:
 * "1:1 THC:CBD", "2:1:1 THC:CBG:CBN", "10:1 CBD:THC". Rules:
 *  • the number list and the cannabinoid list must be the same length (2-4);
 *  • every compound must be in RATIO_CANNABINOIDS (uppercased);
 *  • numbers are 1-3 digits (no percentages, no mg — those aren't ratios).
 * Returns "" when anything is off — never a repaired guess.
 */
export function normalizeCannabinoidRatio(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /^(\d{1,3}(?::\d{1,3}){1,3})\s+([A-Za-z]{3,5}(?::[A-Za-z]{3,5}){1,3})$/.exec(s);
  if (!m) return "";
  const nums = m[1].split(":");
  const names = m[2].split(":").map((n) => n.toUpperCase());
  if (nums.length !== names.length) return "";
  const known = RATIO_CANNABINOIDS as readonly string[];
  if (!names.every((n) => known.includes(n))) return "";
  return `${nums.join(":")} ${names.join(":")}`;
}

/**
 * Put the on-label ratio into the suggested title (owner request). Appended,
 * not injected mid-phrase, and skipped when the title already carries the
 * same ratio digits so re-runs never produce "… 1:1 THC:CBD 1:1 THC:CBD".
 */
export function titleWithRatio(title: string, ratio: string): string {
  const t = title.trim();
  const r = ratio.trim();
  if (!r) return t;
  if (!t) return r;
  const digits = r.split(" ")[0]; // "1:1"
  if (t.includes(digits)) return t;
  return `${t} ${r}`;
}

/**
 * Append the strain facts to the description when the model read them off the
 * label and the description doesn't already mention them. Factual, no effects
 * language — compliance scanning still runs on the combined copy downstream.
 */
export function descriptionWithStrainFacts(
  description: string,
  strain: string,
  strainType: StrainType | "",
): string {
  const d = description.trim();
  const s = strain.trim();
  const parts: string[] = [];
  if (s && !d.toLowerCase().includes(s.toLowerCase())) parts.push(s);
  if (strainType && !d.toLowerCase().includes(strainType)) parts.push(strainType);
  if (parts.length === 0) return d;
  const sentence = `Label lists strain: ${parts.join(", ")}.`;
  return d ? `${d} ${sentence}` : sentence;
}

/** Sanitize a model-reported strain name: printable text only, no URLs/JSON. */
export function cleanStrainField(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 60) return "";
  if (/https?:\/\/|[{}[\]<>]/.test(s)) return "";
  // "unknown"/"n/a"/"none" style non-answers are not facts.
  if (/^(unknown|none|n\/?a|not (visible|legible|shown|printed)|null)$/i.test(s)) return "";
  return s;
}

// ---------------------------------------------------------------------------
// The single structured instruction
// ---------------------------------------------------------------------------

export type MediaSuggestPromptInput = {
  /** Prompt-ready KB facts block (category vocabulary, strain, brand notes). */
  groundedBlock?: string | null;
  /** Vendor/brand about / mission / product-philosophy lines (verified copy). */
  entityBlock?: string | null;
  /** The entity (vendor/brand) display name, when known. */
  entityName?: string | null;
  /** Cleaned product-ish name from the filename (may be ""). */
  derivedName?: string | null;
  filename?: string | null;
  /** Current usage_type prior (import-time stamp) for context only. */
  currentUsageType?: string | null;
};

/**
 * Build the ONE structured instruction. The model must return STRICT JSON:
 * { vision_subject, title, description, alt_text } — vision_subject from the
 * closed VISION_SUBJECTS vocabulary so the classifier can act on it, and the
 * three text fields grounded in the supplied facts (never literal-pixel prose).
 */
export function buildMediaSuggestInstruction(input: MediaSuggestPromptInput): string {
  const facts: string[] = [];
  if (input.entityName) facts.push(`Company: ${input.entityName}`);
  if (input.derivedName) facts.push(`Likely subject (from filename): ${input.derivedName}`);
  if (input.filename) facts.push(`Filename: ${input.filename}`);
  if (input.currentUsageType) facts.push(`Imported as: ${input.currentUsageType} (may be wrong — judge for yourself)`);
  const entityBlock = (input.entityBlock ?? "").trim();
  const groundedBlock = (input.groundedBlock ?? "").trim();

  return [
    `You are cataloguing one image for a licensed Washington cannabis retailer's media library.`,
    `Return STRICT JSON only — no markdown, no commentary:`,
    `{"vision_subject": "...", "title": "...", "description": "...", "alt_text": "...",`,
    ` "label_ratio": "...", "label_strain": "...", "label_strain_type": "..."}`,
    ``,
    `vision_subject — what the image ACTUALLY IS, exactly one of:`,
    VISION_SUBJECTS.map((s) => `  - ${s}`).join("\n"),
    `A can/jar/bag/box of product is "product-packaging" even if a brand name is printed on it.`,
    `Only flat wordmarks/monograms (usually on plain or transparent background) are "logo-wordmark".`,
    ``,
    `title — 2-6 words, Title Case, names the subject (product or company), never a filename.`,
    `description — 1-2 sentences saying what the asset IS and the product/company knowledge that matters,`,
    `grounded ONLY in the verified facts below. Do NOT narrate pixels ("a blue can", "bright colors");`,
    `mention appearance only when it identifies the item (e.g. the flavor on the label).`,
    `alt_text — one sentence, 8-16 words, for screen readers: name the subject specifically`,
    `(product name + form, or company + "logo"), no "image of"/"photo of" prefix.`,
    ``,
    `READ THE PACKAGING TEXT — three extra fields, "" when not clearly printed on the label:`,
    `label_ratio — the cannabinoid ratio EXACTLY as printed, digits then compounds,`,
    `e.g. "1:1 THC:CBD" or "2:1:1 THC:CBG:CBN". "" unless a ratio is legible. Never compute`,
    `one from mg amounts, never guess.`,
    `label_strain — the strain name printed on the label (e.g. "Blue Dream"), "" if none.`,
    `label_strain_type — exactly one of: indica, sativa, hybrid, indica-hybrid, sativa-hybrid`,
    `— only if the label itself says so; "" otherwise.`,
    `When label_ratio is present, include it in the title (e.g. "Constellation CBD Shot 1:1 THC:CBD")`,
    `and mention the ratio and any strain facts in the description.`,
    ``,
    `Known signals:`,
    facts.length ? facts.join("\n") : "(none)",
    entityBlock ? `\nVerified company facts (usable in the copy):\n${entityBlock}` : "",
    groundedBlock ? `\nVerified product/category knowledge (THE ONLY product facts you may use):\n${groundedBlock}` : "",
    ``,
    `Never invent facts, never make medical or health claims, keep it tasteful and adult-oriented.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Defensive response parsing
// ---------------------------------------------------------------------------

export type ParsedMediaSuggestion = {
  visionSubject: VisionSubject | null;
  title: string;
  description: string;
  altText: string;
  /** H12b: validated on-label cannabinoid ratio ("" when absent/invalid). */
  labelRatio: string;
  /** H12b: strain name printed on the label ("" when absent). */
  labelStrain: string;
  /** H12b: closed-vocabulary strain type from the label ("" when absent). */
  labelStrainType: StrainType | "";
};

/**
 * Parse the model's reply. Tolerates code fences / stray prose around the JSON.
 * Unknown vision_subject values are dropped (classifier then runs vision-less).
 * Never throws.
 */
export function parseMediaSuggestResponse(raw: string): ParsedMediaSuggestion {
  const out: ParsedMediaSuggestion = {
    visionSubject: null,
    title: "",
    description: "",
    altText: "",
    labelRatio: "",
    labelStrain: "",
    labelStrainType: "",
  };
  const s = (raw ?? "").trim();
  if (!s) return out;
  try {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    const parsed: unknown = JSON.parse(start >= 0 && end > start ? s.slice(start, end + 1) : s);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const vs = String(o.vision_subject ?? "").trim().toLowerCase();
      if ((VISION_SUBJECTS as readonly string[]).includes(vs)) out.visionSubject = vs as VisionSubject;
      out.title = clean(String(o.title ?? ""));
      out.description = clean(String(o.description ?? ""));
      out.altText = clean(String(o.alt_text ?? o.altText ?? ""));
      // H12b: label facts — each validated against a closed vocabulary so a
      // hallucinated ratio or invented strain type can never reach the form.
      out.labelRatio = normalizeCannabinoidRatio(clean(String(o.label_ratio ?? "")));
      out.labelStrain = cleanStrainField(clean(String(o.label_strain ?? "")));
      out.labelStrainType = normalizeStrainType(clean(String(o.label_strain_type ?? "")));
      // Belt & braces: even if the model ignored the "put the ratio in the
      // title" instruction, the validated facts are folded in here.
      out.title = titleWithRatio(out.title, out.labelRatio);
      out.description = descriptionWithStrainFacts(out.description, out.labelStrain, out.labelStrainType);
    }
  } catch {
    // Not JSON at all: salvage the text as a description so the human still
    // gets something to edit rather than a hard failure.
    out.description = clean(s);
  }
  return out;
}

function clean(v: string): string {
  return v.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
}

/** Guard for suggested usage types before they reach the form/DB. */
export function safeUsageType(id: string | null | undefined): string {
  return isValidPurpose(id) ? (id as string) : "";
}

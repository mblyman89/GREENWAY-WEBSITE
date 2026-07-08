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
    `{"vision_subject": "...", "title": "...", "description": "...", "alt_text": "..."}`,
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
};

/**
 * Parse the model's reply. Tolerates code fences / stray prose around the JSON.
 * Unknown vision_subject values are dropped (classifier then runs vision-less).
 * Never throws.
 */
export function parseMediaSuggestResponse(raw: string): ParsedMediaSuggestion {
  const out: ParsedMediaSuggestion = { visionSubject: null, title: "", description: "", altText: "" };
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

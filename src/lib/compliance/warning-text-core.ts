/**
 * src/lib/compliance/warning-text-core.ts
 *
 * PURE validation for the WA-mandated consumer warning language
 * (GAP LOW / S-19: the footer warning block is editable rich text — an editor
 * could delete a mandated sentence without noticing).
 *
 * The warning statements below mirror the required cannabis warning language
 * (RCW 69.50.357(2) / WAC 314-55-105(4) family) that the site footer has
 * carried since launch (see content-blocks-seed.ts — "Required WA compliance
 * language. Edit with care — keep all mandated wording."). Saving or
 * publishing the footer warning block now HARD-FAILS if any sentence is
 * missing, so a well-meaning copy edit can't silently strip a required line.
 *
 * Comparison is done on normalized text (tags stripped, whitespace collapsed,
 * case-insensitive) so formatting changes (bold, line breaks) stay legal.
 */

import { htmlToText } from "@/lib/security/html-sanitize";

/** The block key this rule applies to. */
export const WARNING_BLOCK_KEY = "footer.compliance.warning";

/** Mandated sentences that must all appear (verbatim, case-insensitive). */
export const MANDATED_WARNING_SENTENCES: readonly string[] = [
  "This product has intoxicating effects and may be habit forming.",
  "Marijuana can impair concentration, coordination, and judgment.",
  "Do not operate a vehicle or machinery under the influence of this drug.",
  "For use only by adults 21 and older.",
  "Keep out of the reach of children.",
];

export type WarningValidation = {
  ok: boolean;
  /** Sentences that could not be found in the candidate text. */
  missing: string[];
};

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Validate a candidate warning block (HTML or plain text). Every mandated
 * sentence must be present after normalization.
 */
export function validateWarningBlock(candidate: string): WarningValidation {
  const text = normalize(htmlToText(candidate ?? ""));
  const missing = MANDATED_WARNING_SENTENCES.filter((s) => !text.includes(normalize(s)));
  return { ok: missing.length === 0, missing };
}

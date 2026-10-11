/**
 * src/lib/compliance/warning-text-core.ts
 *
 * PURE validation for the WA-mandated consumer warning language
 * (GAP LOW / S-19: the footer warning block is editable rich text — an editor
 * could delete a mandated sentence without noticing).
 *
 * R42 (owner answer Q1, 2026-10-11): the website is age-gated and the owner's
 * LCB enforcement officer told him the advertising warnings do not have to sit
 * inside each banner on an age-gated site — the site carries them in the
 * footer on every page. That makes this footer block THE place the site meets
 * WAC 314-55-155(7), so it must carry the four statements EXACTLY as the rule
 * now words them. Verified against the adopted rule text (WSR 26-12-082,
 * filed 6/3/26, effective 7/4/26, read from app.leg.wa.gov and the LCB CR-103
 * PDF on 2026-10-11):
 *   (a) "This product has intoxicating effects and may be habit forming."
 *   (b) "Cannabis can impair concentration, coordination, and judgment. Do not
 *       operate a vehicle or machinery under the influence of this drug."
 *   (c) "There may be health risks associated with consumption of this product."
 *   (d) "For use only by adults 21 and older. Keep out of the reach of children."
 * The launch text said "Marijuana can impair…" and had no (c) sentence.
 *
 * Saving or publishing the footer warning block HARD-FAILS if any sentence is
 * missing, and the footer renders the canonical text instead of a stored value
 * that fails the check (resolveWarningForRender) — so the legally required
 * wording shows even before the owner re-publishes an older saved copy.
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
  "Cannabis can impair concentration, coordination, and judgment.",
  "Do not operate a vehicle or machinery under the influence of this drug.",
  "There may be health risks associated with consumption of this product.",
  "For use only by adults 21 and older.",
  "Keep out of the reach of children.",
];

/** The canonical footer text: every mandated sentence, in the rule's order. */
export const CANONICAL_WARNING_TEXT: string = MANDATED_WARNING_SENTENCES.join(" ");

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

/**
 * Render-time safety net: the stored value when it passes, otherwise the
 * canonical text. Never returns text that is missing a mandated sentence.
 */
export function resolveWarningForRender(stored: string | null | undefined): { value: string; usedCanonical: boolean } {
  const v = stored ?? "";
  if (v.trim() && validateWarningBlock(v).ok) return { value: v, usedCanonical: false };
  return { value: CANONICAL_WARNING_TEXT, usedCanonical: true };
}

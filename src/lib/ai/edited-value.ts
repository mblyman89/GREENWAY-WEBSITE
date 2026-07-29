/**
 * src/lib/ai/edited-value.ts
 *
 * SLICE 88: pure resolver for the "edit the draft right on the vendor page
 * before accepting" flow. The AiDraftCard renders the draft in an editable
 * textarea (name="editedValue") attached to the Accept form; the accept
 * actions call this to decide WHAT text actually gets saved and whether the
 * reviewer changed it (which flips the suggestion status to "edited" — a
 * status the ai_suggestions table has carried since migration 0004).
 *
 * Rules (deliberately conservative):
 *   • Empty / whitespace-only edit box  ⇒ the ORIGINAL draft is used
 *     (an accidental select-all-delete never accepts an empty profile field).
 *   • Text identical to the draft (after trim) ⇒ not an edit.
 *   • Anything else ⇒ the reviewer's text wins, marked edited.
 *   • Hard length cap so a paste accident can't write a megabyte into a
 *     profile column — callers refuse with a plain-English error.
 *
 * Pure and framework-free so vitest covers it directly.
 */

/** Longest edited draft we will accept (characters). */
export const MAX_EDITED_VALUE_CHARS = 20_000;

export type ResolvedEdit = {
  /** The text to gate + save (edited text when provided, else the draft). */
  value: string;
  /** True ⇒ the reviewer changed the text (audit + status "edited"). */
  edited: boolean;
  /** Non-empty ⇒ refuse the accept with this plain-English reason. */
  error: string;
};

/**
 * Decide the final value for an accept given the stored draft and the raw
 * `editedValue` form field (may be null when the form has no editor).
 */
export function resolveEditedValue(
  suggestedValue: string | null | undefined,
  editedRaw: FormDataEntryValue | null | undefined,
): ResolvedEdit {
  const original = String(suggestedValue ?? "").trim();
  const edited = typeof editedRaw === "string" ? editedRaw.trim() : "";

  if (edited.length > MAX_EDITED_VALUE_CHARS) {
    return {
      value: original,
      edited: false,
      error: `Edited text is too long (${edited.length.toLocaleString()} characters — the limit is ${MAX_EDITED_VALUE_CHARS.toLocaleString()}). Trim it down and accept again.`,
    };
  }

  if (!edited || edited === original) {
    return { value: original, edited: false, error: "" };
  }
  return { value: edited, edited: true, error: "" };
}

/**
 * tests/compliance/edited-value.test.ts
 *
 * SLICE 88 — "edit it right in the vendor page before accepting it".
 *
 * Covers the pure resolver the accept actions use to decide what text is
 * gated + saved (src/lib/ai/edited-value.ts), and pins the review-lane
 * classification of the new research_text reference draft.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_EDITED_VALUE_CHARS,
  resolveEditedValue,
} from "@/lib/ai/edited-value";
import { REFERENCE_FIELDS, classifyLane } from "@/lib/kb/review-lanes-core";

const DRAFT = "Family farm growing craft cannabis in the Okanogan highlands.";

describe("resolveEditedValue", () => {
  it("no editor field on the form → original draft, not edited", () => {
    const r = resolveEditedValue(DRAFT, null);
    expect(r).toEqual({ value: DRAFT, edited: false, error: "" });
  });

  it("empty / whitespace-only edit box → original draft (accidental clear never saves empty)", () => {
    expect(resolveEditedValue(DRAFT, "")).toEqual({ value: DRAFT, edited: false, error: "" });
    expect(resolveEditedValue(DRAFT, "   \n\t ")).toEqual({ value: DRAFT, edited: false, error: "" });
  });

  it("text identical to the draft (after trim) → not an edit", () => {
    const r = resolveEditedValue(DRAFT, `  ${DRAFT}  `);
    expect(r.edited).toBe(false);
    expect(r.value).toBe(DRAFT);
  });

  it("changed text wins and is marked edited", () => {
    const r = resolveEditedValue(DRAFT, "Our farm, rewritten by Mae.");
    expect(r).toEqual({ value: "Our farm, rewritten by Mae.", edited: true, error: "" });
  });

  it("edited text is trimmed before compare and save", () => {
    const r = resolveEditedValue(DRAFT, "  New text.  ");
    expect(r.value).toBe("New text.");
    expect(r.edited).toBe(true);
  });

  it("null draft + real edit → the edit wins", () => {
    const r = resolveEditedValue(null, "Written from scratch.");
    expect(r).toEqual({ value: "Written from scratch.", edited: true, error: "" });
  });

  it("null draft + no edit → empty value, no error (caller's gate handles empties)", () => {
    const r = resolveEditedValue(null, null);
    expect(r).toEqual({ value: "", edited: false, error: "" });
  });

  it("non-string form entry (File) is ignored → original draft", () => {
    const file = new File(["x"], "x.txt");
    const r = resolveEditedValue(DRAFT, file);
    expect(r).toEqual({ value: DRAFT, edited: false, error: "" });
  });

  it("paste accident beyond the cap refuses with a plain-English error and keeps the original", () => {
    const huge = "a".repeat(MAX_EDITED_VALUE_CHARS + 1);
    const r = resolveEditedValue(DRAFT, huge);
    expect(r.error).toContain("too long");
    expect(r.edited).toBe(false);
    expect(r.value).toBe(DRAFT);
  });

  it("text exactly at the cap is accepted", () => {
    const max = "b".repeat(MAX_EDITED_VALUE_CHARS);
    const r = resolveEditedValue(DRAFT, max);
    expect(r.error).toBe("");
    expect(r.edited).toBe(true);
    expect(r.value).toBe(max);
  });
});

describe("research_text review lane (SLICE 88)", () => {
  it("is reference-only — never writable into a profile column", () => {
    expect(REFERENCE_FIELDS.has("research_text")).toBe(true);
  });

  it("classifies as reference even at confidence 1.0", () => {
    expect(
      classifyLane({
        id: "s1",
        entity_type: "vendor",
        entity_id: "v1",
        field_key: "research_text",
        suggested_value: "TEXT FOUND ON THEIR SITE ...",
        confidence: 1.0,
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toBe("reference");
  });
});

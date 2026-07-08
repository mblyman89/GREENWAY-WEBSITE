/**
 * tests/compliance/social-draft.test.ts — Slice H12a.
 *
 * Pins the research_social draft → social_json accept path:
 *  • the crawler's format_social_links() line shape parses back losslessly;
 *  • gap-fill ONLY — the owner's hand-entered handles are never overwritten;
 *  • platforms without a profile field are surfaced, never half-saved;
 *  • research_social routes to the REFERENCE lane (it must never be accepted
 *    into a prose profile column by the generic accepts).
 */
import { describe, it, expect } from "vitest";
import {
  parseSocialDraft,
  mergeSocialLinks,
  summarizeSocialAccept,
  SOCIAL_DRAFT_PLATFORMS,
} from "@/lib/vendors/social-draft-core";
import { REFERENCE_FIELDS, classifyLane } from "@/lib/kb/review-lanes-core";

describe("parseSocialDraft", () => {
  it("parses the crawler's format_social_links line shape (with and without handle)", () => {
    // Mirrors crawler/app/social_links.py format_social_links():
    // "[{Label}]{ @handle} — {url}" — em dash separator.
    const body = [
      "[Instagram] @fairwinds_cannabis — https://www.instagram.com/fairwinds_cannabis",
      "[Facebook] — https://www.facebook.com/FairwindsCannabis",
      "[Youtube] — https://www.youtube.com/@fairwinds",
    ].join("\n");
    const out = parseSocialDraft(body);
    expect(out.links).toEqual({
      instagram: "https://www.instagram.com/fairwinds_cannabis",
      facebook: "https://www.facebook.com/FairwindsCannabis",
      youtube: "https://www.youtube.com/@fairwinds",
    });
    expect(out.unsupported).toEqual([]);
  });

  it("reports platforms with no profile field instead of half-saving them", () => {
    const body = [
      "[Linktree] @brand — https://linktr.ee/brand",
      "[Pinterest] — https://www.pinterest.com/brand",
      "[Instagram] @brand — https://www.instagram.com/brand",
    ].join("\n");
    const out = parseSocialDraft(body);
    expect(out.links).toEqual({ instagram: "https://www.instagram.com/brand" });
    expect(out.unsupported).toEqual(["Linktree", "Pinterest"]);
  });

  it("first occurrence wins; junk lines and empty bodies are ignored", () => {
    const out = parseSocialDraft(
      [
        "[Instagram] @first — https://www.instagram.com/first",
        "[Instagram] @second — https://www.instagram.com/second",
        "not a social line",
        "",
      ].join("\n"),
    );
    expect(out.links.instagram).toBe("https://www.instagram.com/first");
    expect(parseSocialDraft(null).links).toEqual({});
    expect(parseSocialDraft("").unsupported).toEqual([]);
  });

  it("tolerates en dash / hyphen separators defensively", () => {
    expect(parseSocialDraft("[Tiktok] @b – https://www.tiktok.com/@b").links.tiktok).toBe(
      "https://www.tiktok.com/@b",
    );
    expect(parseSocialDraft("[Twitter] - https://x.com/b").links.twitter).toBe("https://x.com/b");
  });
});

describe("mergeSocialLinks — gap-fill only", () => {
  it("fills empty platforms and NEVER overwrites the owner's values", () => {
    const existing = { instagram: "@my_hand_entered_handle" };
    const incoming = {
      instagram: "https://www.instagram.com/crawled",
      facebook: "https://www.facebook.com/crawled",
    };
    const res = mergeSocialLinks(existing, incoming);
    expect(res.merged.instagram).toBe("@my_hand_entered_handle"); // untouched
    expect(res.merged.facebook).toBe("https://www.facebook.com/crawled");
    expect(res.filled).toEqual(["facebook"]);
    expect(res.alreadySet).toEqual(["instagram"]);
  });

  it("handles null/undefined existing and whitespace-only current values", () => {
    const res = mergeSocialLinks(null, { tiktok: "https://www.tiktok.com/@b" });
    expect(res.merged.tiktok).toBe("https://www.tiktok.com/@b");
    const res2 = mergeSocialLinks({ tiktok: "  " }, { tiktok: "https://www.tiktok.com/@b" });
    expect(res2.filled).toEqual(["tiktok"]);
  });

  it("covers exactly the typed platform set (matches the vendor form inputs)", () => {
    expect([...SOCIAL_DRAFT_PLATFORMS].sort()).toEqual(
      ["facebook", "instagram", "linkedin", "tiktok", "twitter", "youtube"],
    );
  });
});

describe("summarizeSocialAccept", () => {
  it("names what was saved, kept, and unsupported", () => {
    const msg = summarizeSocialAccept(
      { merged: {}, filled: ["instagram", "tiktok"], alreadySet: ["facebook"] },
      ["Linktree"],
    );
    expect(msg).toContain("Instagram, Tiktok");
    expect(msg).toContain("Facebook");
    expect(msg).toContain("Linktree");
  });

  it("says so when nothing new was saved", () => {
    expect(summarizeSocialAccept({ merged: {}, filled: [], alreadySet: [] }, [])).toContain(
      "No new channels",
    );
  });
});

describe("lane routing — research_social is reference-only", () => {
  it("is in REFERENCE_FIELDS and classifies as reference even at confidence 1.0", () => {
    expect(REFERENCE_FIELDS.has("research_social")).toBe(true);
    expect(
      classifyLane({
        id: "s1",
        entity_type: "vendor",
        entity_id: "v1",
        field_key: "research_social",
        suggested_value: "[Instagram] @b — https://www.instagram.com/b",
        confidence: 1.0,
        created_at: "2026-01-01T00:00:00Z",
      }),
    ).toBe("reference");
  });
});

/**
 * tests/compliance/llamaparse-core.test.ts
 *
 * Pins the PURE LlamaParse helpers that shape requests and normalize results
 * for the vision-PDF pipeline. The point of this suite is the NEVER-GUESS
 * contract Michael cares about:
 *   - an empty / whitespace-only parse must report ok:false (so the intake can
 *     NEVER false-flag a scanned image with no text as a "success");
 *   - a low-confidence parse is surfaced (trusted:false), never hidden;
 *   - defaults match the owner's case (balanced tier for scanned manifests,
 *     caching ON because the docs are public record);
 *   - credit math is honest for the ai_usage ledger.
 */

import { describe, it, expect } from "vitest";
import {
  buildParseRequest,
  normalizeParseResult,
  gateConfidence,
  pickText,
  estimateCredits,
  parseModeForTier,
  creditsPerPage,
  __runLlamaparseCoreTests,
} from "@/lib/inbound-email/llamaparse-core";

describe("llamaparse-core: request shaping (owner defaults)", () => {
  it("defaults to the balanced tier for scanned manifests", () => {
    const req = buildParseRequest();
    expect(req.tier).toBe("balanced");
    expect(req.fields.parse_mode).toBe("parse_page_with_llm");
    expect(req.fields.result_type).toBe("markdown");
  });

  it("keeps caching ON by default because the docs are public record", () => {
    expect(buildParseRequest().fields.do_not_cache).toBe("false");
    expect(buildParseRequest({ doNotCache: true }).fields.do_not_cache).toBe("true");
  });

  it("trims the filename and only sends language when provided", () => {
    const req = buildParseRequest({ filename: "  manifest.pdf  ", language: "en" });
    expect(req.filename).toBe("manifest.pdf");
    expect(req.fields.language).toBe("en");
    expect("language" in buildParseRequest().fields).toBe(false);
  });

  it("maps every tier to a parse mode and a credit cost", () => {
    expect(parseModeForTier("fast")).toBe("parse_page_without_llm");
    expect(parseModeForTier("agentic_plus")).toBe("parse_document_with_agent");
    expect(creditsPerPage("balanced")).toBe(3);
    expect(creditsPerPage("agentic")).toBe(10);
  });
});

describe("llamaparse-core: normalize (never false-flag empty)", () => {
  it("real pages produce ok:true and joined text", () => {
    const n = normalizeParseResult({
      pages: [
        { page: 1, md: "Invoice #: 0000016167", confidence: 0.98 },
        { page: 2, markdown: "Driver Name: Jane Q", metadata: { confidence: 0.7 } },
      ],
    });
    expect(n.ok).toBe(true);
    expect(n.pageCount).toBe(2);
    expect(n.text).toContain("0000016167");
    expect(n.text).toContain("Jane Q");
    expect(n.confidence).toBe(0.7); // min of reported
    expect(n.note).toBeNull();
  });

  it("no pages -> ok:false with a note (Michael's exact worry)", () => {
    const n = normalizeParseResult({ pages: [] });
    expect(n.ok).toBe(false);
    expect(n.note).toMatch(/no pages/i);
  });

  it("whitespace-only pages -> ok:false (a scanned image is not a success)", () => {
    const n = normalizeParseResult({ pages: [{ page: 1, md: "   " }] });
    expect(n.ok).toBe(false);
    expect(n.note).toMatch(/no extractable/i);
  });

  it("null/garbage input -> ok:false, zero pages, never throws", () => {
    const n = normalizeParseResult(null);
    expect(n.ok).toBe(false);
    expect(n.pageCount).toBe(0);
  });

  it("accepts a top-level markdown fallback shape", () => {
    const n = normalizeParseResult({ markdown: "Order # 12345", confidence: 0.9 });
    expect(n.ok).toBe(true);
    expect(n.pageCount).toBe(1);
    expect(n.confidence).toBe(0.9);
  });

  it("rescales a percentage confidence but clamps a stray >1 fraction", () => {
    expect(normalizeParseResult({ pages: [{ page: 1, md: "x", confidence: 87 }] }).confidence).toBe(
      0.87,
    );
    expect(normalizeParseResult({ pages: [{ page: 1, md: "x", confidence: 1.5 }] }).confidence).toBe(
      1,
    );
  });
});

describe("llamaparse-core: confidence gate (surface, never hide)", () => {
  it("no text -> never trusted", () => {
    expect(gateConfidence({ ok: false, confidence: null }).trusted).toBe(false);
  });

  it("text with no confidence signal -> trusted on presence", () => {
    expect(gateConfidence({ ok: true, confidence: null }).trusted).toBe(true);
  });

  it("high confidence trusted, low confidence flagged for review", () => {
    expect(gateConfidence({ ok: true, confidence: 0.8 }).trusted).toBe(true);
    expect(gateConfidence({ ok: true, confidence: 0.3 }).trusted).toBe(false);
    expect(gateConfidence({ ok: true, confidence: 0.6 }, 0.7).trusted).toBe(false);
  });
});

describe("llamaparse-core: pickText + credits", () => {
  const n = normalizeParseResult({
    pages: [
      { page: 1, md: "page one" },
      { page: 2, md: "page two" },
    ],
  });

  it("pickText returns the whole doc, a single page, or '' — never null", () => {
    expect(pickText(n)).toContain("page one");
    expect(pickText(n, 2)).toBe("page two");
    expect(pickText(n, 99)).toBe("");
  });

  it("credit estimate is honest arithmetic", () => {
    expect(estimateCredits(4, "balanced")).toBe(12);
    expect(estimateCredits(3, "fast")).toBe(3);
    expect(estimateCredits(0, "agentic")).toBe(0);
  });
});

describe("llamaparse-core: bundled self-tests", () => {
  it("all pure self-tests pass", () => {
    const r = __runLlamaparseCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
});

/**
 * tests/compliance/d244-r14-cure-context.test.ts — D244 round 5, slice R-14.
 *
 * Owner (verbatim): "I need the word "cure", "cured", and others like it to be
 * a warn only, and the system should allow me to attach facts that use that
 * word. Why? because cannabis is dried and then cured. it is called the cure
 * process. … if we can make the system smarter by looking at the words before
 * and after the word cure, or any of the blocked words for that matter, so it
 * will allow the words if used not in a medical way."
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/kb/retrieval", () => ({
  loadBannedPhrases: async () => [
    { phrase: "cure", severity: "block", reason: "seeded" },
    { phrase: "cured", severity: "block", reason: "owner" },
    { phrase: "cures", severity: "block", reason: "seeded" },
  ],
}));

import { __runComplianceContextTests, CONTEXT_RULES, judgePattern } from "@/lib/ai/compliance-context-core";
import { checkCompliance, COMPLIANCE_PATTERNS_VERSION, lintCopy, MEDICAL_BANNED_PHRASES } from "@/lib/ai/compliance";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { therapeuticWords } from "@/lib/cms/culture-desk-core";
import { reviewProblems } from "@/lib/cms/curated-reviews-core";
import { checkAdText } from "@/lib/marketing/ad-check-core";
import { checkPromotionCopy } from "@/lib/promotions/promotion-copy-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("R-14 pure core", () => {
  it("self-tests pass and are registered", () => {
    const r = __runComplianceContextTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(76);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("compliance-context-core", __runComplianceContextTests(), 76)');
  });
  it("the rules live in the one shared fixture, byte-identical in the crawler, version 4", () => {
    expect(read("src/lib/ai/compliance-patterns.json")).toBe(read("crawler/app/compliance_patterns.json"));
    expect(COMPLIANCE_PATTERNS_VERSION).toBe(4);
    expect(CONTEXT_RULES.families.find((f) => f.id === "cure")?.default).toBe("allow");
    expect(CONTEXT_RULES.window).toEqual({ before: 4, after: 5 });
  });
  it("judgePattern on a non-family word keeps blocking", () => {
    expect(judgePattern("It heals.", /\bheals\b/i).blocked).toBe(true);
  });
});

describe("checkCompliance: the cure process is a heads-up, medical use blocks", () => {
  const banned = MEDICAL_BANNED_PHRASES; // includes "cure" and "cures" at block
  for (const t of [
    "Hang-dried and slow cured for 21 days in glass jars.",
    "Our cure process takes four weeks.",
    "Properly cured flower with a smooth, even burn.",
    "Small batch cured resin.",
    "We dry and cure every harvest by hand.",
    "About us: we grow, dry, cure and hand-trim every plant in Washington.",
  ]) {
    it(`allows: ${t}`, () => {
      const r = checkCompliance(t, banned);
      expect(r.ok, r.flags.join(" | ")).toBe(true);
      expect(r.blockingFlags).toEqual([]);
      expect(r.flags.some((f) => f.includes("allowed in context") && f.endsWith("(heads-up)"))).toBe(true);
    });
  }
  for (const t of [
    "This strain cures anxiety.",
    "The cure for insomnia.",
    "It cures your blues.",
    "A miracle cure.",
    "Cures everything.",
    "A cure-all.",
    "A cure for a bad day.",
    "Slow cured and great for chronic pain.",
  ]) {
    it(`blocks: ${t}`, () => {
      expect(checkCompliance(t, banned).ok).toBe(false);
    });
  }
  it("lintCopy shows the cure process publicly (warn), drops a claim", () => {
    expect(lintCopy("Slow cured for 3 weeks.").disposition).toBe("warn");
    expect(lintCopy("Slow cured for 3 weeks.").publicText).toBe("Slow cured for 3 weeks.");
    expect(lintCopy("Cures anxiety.").publicText).toBeNull();
  });
  it("other blocked words are read in context too", () => {
    expect(checkCompliance("A sweet treat. Keep out of reach of children. Store in a safe place.").ok).toBe(true);
    expect(checkCompliance("Grown in healthy living soil, sealed to prevent oxidation.").ok).toBe(true);
    expect(checkCompliance("Treats stress.").ok).toBe(false);
    expect(checkCompliance("Kids love it.").ok).toBe(false);
    expect(checkCompliance("It is safe and healthy.").ok).toBe(false);
  });
});

describe("Accept / Approve / Attach facts pass the cure process", () => {
  it("the accept gate (owner banned 'cured' included) accepts the cure process", async () => {
    const r = await acceptWithComplianceGate({ field_key: "description", suggested_value: "Slow cured for 21 days, then hand trimmed." } as never);
    expect(r.ok).toBe(true);
    expect(r.message).toBe("");
    expect(r.audit.compliance_rescan.patternsVersion).toBe(4);
    expect(r.flags.length).toBeGreaterThan(0);
  });
  it("the accept gate still refuses a cure claim", async () => {
    const r = await acceptWithComplianceGate({ field_key: "description", suggested_value: "This cures anxiety." } as never);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Blocked by the WA I-502 compliance re-scan");
  });
  it("the KB attach gate uses blockingFlags (so a heads-up passes)", () => {
    const src = read("src/lib/enrichment/kb-match-attach.ts");
    expect(src).toContain("termOk: (t) => checkCompliance(t, banned).blockingFlags.length === 0");
    expect(src).toContain("proseOk: (t) => checkCompliance(t, banned).blockingFlags.length === 0");
  });
});

describe("the other copy checks read context too", () => {
  it("culture desk and curated reviews", () => {
    expect(therapeuticWords("Slow cured for 21 days.")).toEqual([]);
    expect(therapeuticWords("It cures anxiety.")).toContain("cures");
    expect(reviewProblems({ permission: true, firstName: "Al", quote: "Perfectly cured, smooth smoke." } as never)).toEqual([]);
  });
  it("banner / ad check: the cure process is a second look, not a rule break", () => {
    expect(checkAdText(["Slow cured, hand trimmed"]).every((f) => f.kind === "review")).toBe(true);
    expect(checkAdText(["Cures your anxiety"]).some((f) => f.kind === "rule")).toBe(true);
  });
  it("deal copy", () => {
    const labels = (t: string) => checkPromotionCopy({ title: t }).map((f) => f.label);
    expect(labels("Slow cured flower Friday")).not.toContain("Health or medical claim");
    expect(labels("Cures your Monday")).toContain("Health or medical claim");
  });
  it("the AI prompt may describe the curing process", () => {
    expect(read("src/lib/ai/compliance.ts")).toContain("The CURING PROCESS is fine to describe");
  });
});

describe("the crawler mirrors it", () => {
  it("compliance.py runs the same context rules and its tests run the fixture examples", () => {
    const py = read("crawler/app/compliance.py");
    expect(py).toContain('CONTEXT_RULES: dict = json.loads(_PATTERNS_FILE.read_text("utf-8"))["contextRules"]');
    expect(py).toContain("def pattern_blocks(");
    expect(read("crawler/tests/test_compliance_parity.py")).toContain("def test_r14_fixture_examples_match_the_site");
  });
});

describe("docs", () => {
  it("SOP-10 v1.3 §4.15 quotes the owner; Help, Concierge, strategy row", () => {
    const sop = read("docs/sop/SOP-10-product-enrichment.md");
    expect(sop).toContain("| **Version** | 1.3 (D244 R-14");
    expect(sop).toContain("### 4.15");
    expect(sop).toContain("because cannabis is dried and then cured. it is called the cure process.");
    expect(read("src/lib/admin/help-content.ts")).toContain("Why is the word cured allowed now?");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Cure and cured are fine (D244 R-14");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-14 \| #(\d+|R14PR) \|/);
  });
});

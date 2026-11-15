/**
 * tests/compliance/d244-r23-guardrails.test.ts - D244 round 10, slice R-23.
 *
 * Owner (verbatim): "we have a "compliance guardrails" page in the knowledge
 * base. I want every banned and warning words and phrases to be in this page.
 * I keep getting blocked out right for things that are not disallowed. I need
 * to be in control, and if I choose something is ok to do, thats my choice.
 * please upgrade and enhance that compliance guardrails page to have any and
 * all things that block me from publishing text to be included here. so I can
 * fine tune them myself and enable and disable them as I see fit. please make
 * sure you find everything that blocks, and add it to the page."
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import patternsJson from "@/lib/ai/compliance-patterns.json";
import {
  __runGuardrailsStateTests,
  aiPatternKey,
  emptyGuardrails,
  normalizeGuardrails,
  setActiveGuardrails,
  withAllowWord,
  withRuleLevel,
  type GuardrailSettings,
} from "@/lib/ai/guardrails-state-core";
import { GUARDRAIL_RULES, __runGuardrailsCatalogTests, ruleByKey, testRules } from "@/lib/ai/guardrails-catalog-core";
import { checkCompliance, checkEffects } from "@/lib/ai/compliance";
import { checkAiCopy, checkImageAsk } from "@/lib/cms/newsletter-ai-core";
import { guardCultureText } from "@/lib/cms/culture-desk-core";
import { reviewProblems } from "@/lib/cms/curated-reviews-core";
import { checkPromotionCopy } from "@/lib/promotions/promotion-copy-core";
import { checkAdText } from "@/lib/marketing/ad-check-core";
import { themeHits } from "@/lib/merch-studio/print-rules-core";
import { checkDraft, getTemplate } from "@/lib/cms/post-templates-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const use = (s: Partial<GuardrailSettings>) => setActiveGuardrails({ ...emptyGuardrails(), ...s });

afterEach(() => setActiveGuardrails(null));

describe("D244 R-23 the owner's settings", () => {
  it("pure self-tests pass", () => {
    expect(__runGuardrailsStateTests().failed).toBe(0);
    expect(__runGuardrailsCatalogTests().failed).toBe(0);
  });

  it("bad stored values are ignored, never thrown", () => {
    const s = normalizeGuardrails({ rules: { "ai.x-y": "off", "BAD KEY": "off", "ai.z-z": "maybe" }, allow: ["  Relief ", "", 5, "relief"] });
    expect(s.rules).toEqual({ "ai.x-y": "off" });
    expect(s.allow).toEqual(["relief", "5"]);
    expect(normalizeGuardrails("nonsense")).toEqual(emptyGuardrails());
  });

  it("setting a rule to its built-in level clears the override", () => {
    const s = withRuleLevel(withRuleLevel(emptyGuardrails(), "ai.a-b", "off", "block"), "ai.a-b", "block", "block");
    expect(s.rules).toEqual({});
    expect(withAllowWord(emptyGuardrails(), "Best Seller").allow).toEqual(["best seller"]);
  });
});

describe("D244 R-23 the main AI check follows the owner", () => {
  const SAFE = aiPatternKey("safety/efficacy claim");

  it("built in: blocks", () => {
    expect(checkCompliance("It is totally safe.").ok).toBe(false);
  });

  it("Off: not checked at all", () => {
    use({ rules: { [SAFE]: "off" } });
    const r = checkCompliance("It is totally safe.");
    expect(r.ok).toBe(true);
    expect(r.flags.some((f) => f.includes("safety"))).toBe(false);
  });

  it("Warn: a heads-up, nothing stopped", () => {
    use({ rules: { [SAFE]: "warn" } });
    const r = checkCompliance("It is totally safe.");
    expect(r.ok).toBe(true);
    expect(r.flags.some((f) => f.includes("safety") && f.includes("heads-up"))).toBe(true);
  });

  it("allowed word: skipped, other words in the rule still checked", () => {
    use({ allow: ["safe"] });
    expect(checkCompliance("It is totally safe.").ok).toBe(true);
    expect(checkCompliance("It is totally harmless.").ok).toBe(false);
  });

  it("a warn-only rule can be turned up to Block", () => {
    const warnRule = (patternsJson as { patterns: { label: string; severity: string; pattern: string }[] }).patterns.find((p) => p.severity === "warn")!;
    const rule = ruleByKey(aiPatternKey(warnRule.label))!;
    expect(rule.builtIn).toBe("warn");
    expect(rule.levels).toContain("block");
  });

  it("owner phrases: an allowed word skips them too", () => {
    expect(checkCompliance("pure couch lock", [{ phrase: "couch lock", severity: "block" }]).ok).toBe(false);
    use({ allow: ["couch lock"] });
    expect(checkCompliance("pure couch lock", [{ phrase: "couch lock", severity: "block" }]).ok).toBe(true);
  });

  it("effects: the two effect rules can be turned off or a word allowed", () => {
    expect(checkEffects(["zonked"]).allowed).toEqual([]);
    use({ rules: { "effects.allow-list": "off" } });
    expect(checkEffects(["zonked"]).allowed).toEqual(["zonked"]);
    use({ allow: ["pain"] });
    const r = checkEffects(["pain"]);
    expect(r.rejected.some((x) => x.reason.toLowerCase().includes("medical"))).toBe(false);
  });
});

describe("D244 R-23 every other word rule follows the owner", () => {
  it("newsletter AI superlatives: Off and Warn", () => {
    expect(checkAiCopy("The best gummies.", "").some((i) => i.level === "must-fix")).toBe(true);
    use({ rules: { "newsletter.superlatives": "warn" } });
    const w = checkAiCopy("The best gummies.", "");
    expect(w.some((i) => i.level === "must-fix")).toBe(false);
    expect(w.some((i) => i.level === "heads-up")).toBe(true);
    use({ rules: { "newsletter.superlatives": "off" } });
    expect(checkAiCopy("The best gummies.", "")).toEqual([]);
  });

  it("newsletter picture ask words can be turned off", () => {
    expect(checkImageAsk("a cartoon of a kid").some((i) => i.level === "must-fix")).toBe(true);
    use({ rules: { "newsletter.picture-words": "off" } });
    expect(checkImageAsk("a cartoon of a kid").some((i) => i.level === "must-fix")).toBe(false);
  });

  it("culture therapeutic words follow the level and allowed words", () => {
    const text = "Study: cannabis relieves stress. https://example.org/study";
    const before = guardCultureText(text).blocking.length;
    expect(before).toBeGreaterThan(0);
    use({ rules: { "culture.therapeutic": "off", "culture.health-topic": "off" } });
    expect(guardCultureText(text).blocking).toEqual([]);
  });

  it("curated reviews: health words can be allowed", () => {
    const r = { id: "1", quote: "It relieves my anxiety.", firstName: "Sam", googleUrl: "", permission: true, permissionNote: "yes", addedAt: "2025-01-01" };
    expect(reviewProblems(r).length).toBeGreaterThan(0);
    use({ rules: { "reviews.health-words": "off" } });
    expect(reviewProblems(r)).toEqual([]);
  });

  it("promotion wording: Off removes the warning", () => {
    const has = () => checkPromotionCopy({ title: "Free gift with purchase" }).some((f) => f.kind === "legal" && /free/i.test(f.found));
    expect(has()).toBe(true);
    use({ rules: { "promo.free": "off" } });
    expect(has()).toBe(false);
  });

  it("banner ad check: Off skips, Warn turns it into a review", () => {
    expect(checkAdText(["Totally safe."]).some((f) => f.kind === "rule")).toBe(true);
    use({ rules: { [aiPatternKey("safety/efficacy claim")]: "warn" } });
    const w = checkAdText(["Totally safe."]);
    expect(w.some((f) => f.kind === "rule")).toBe(false);
    use({ rules: { [aiPatternKey("safety/efficacy claim")]: "off" } });
    expect(checkAdText(["Totally safe."]).length).toBe(0);
  });

  it("merch art theme words can be turned off", () => {
    const theme = GUARDRAIL_RULES.find((r) => r.key.startsWith("merch.") && r.list && r.list.length > 0)!;
    const word = theme.list![0];
    expect(themeHits(`a ${word} shirt`).length).toBeGreaterThan(0);
    use({ rules: { [theme.key]: "off" } });
    expect(themeHits(`a ${word} shirt`).some((h) => `merch.${h.theme}` === theme.key)).toBe(false);
  });

  it("blog template superlatives follow the level", () => {
    const t = getTemplate("fresh-drops")!;
    const item = { id: "a", label: "a", facts: ["Fresh flower"], vendorIds: [], searchWords: [] };
    const d = { headlines: ["The best flower"], excerpt: "x", sections: [{ heading: "h", paragraphs: ["p"] }], cta: "c" };
    expect(checkDraft(t, item, d).some((i) => i.level === "must-fix" && /best/i.test(i.text))).toBe(true);
    use({ rules: { "blog.superlatives": "off" } });
    expect(checkDraft(t, item, d).some((i) => /best/i.test(i.text))).toBe(false);
  });

  it("the page tester shows the owner's level", () => {
    use({ rules: { "ai.safety-efficacy-claim": "warn" } });
    const hit = testRules("It is safe.").find((h) => h.key === "ai.safety-efficacy-claim");
    expect(hit?.level).toBe("warn");
    use({ allow: ["safe"] });
    expect(testRules("It is safe.").some((h) => h.key === "ai.safety-efficacy-claim")).toBe(false);
  });
});

describe("D244 R-23 the page lists everything", () => {
  it("every shared AI pattern, every group, unique keys", () => {
    const pats = (patternsJson as { patterns: unknown[] }).patterns;
    expect(GUARDRAIL_RULES.filter((r) => r.group === "ai").length).toBe(pats.length);
    for (const g of ["ai", "effects", "newsletter", "blog", "culture", "promo", "merch"]) {
      expect(GUARDRAIL_RULES.some((r) => r.group === g)).toBe(true);
    }
    expect(new Set(GUARDRAIL_RULES.map((r) => r.key)).size).toBe(GUARDRAIL_RULES.length);
  });

  it("the page shows rules, levels, allowed words, owner phrases, tester, other checks, reset", () => {
    const src = read("src/app/admin/knowledge-base/compliance/page.tsx");
    for (const s of ["GUARDRAIL_RULES", "GUARDRAIL_GROUPS", "setGuardrailLevelAction", "addAllowedWordAction", "removeAllowedWordAction", "updateBannedPhraseAction", "deleteBannedPhraseAction", "toggleOwnerPhraseAction", "testRules", "checkCompliance", "NOT_WORD_RULES", "resetAllGuardrailsAction", 'requirePermission("products.enrich")']) {
      expect(src).toContain(s);
    }
  });

  it("every action checks permission and writes the audit log", () => {
    const src = read("src/app/admin/knowledge-base/compliance/guardrails-actions.ts");
    const actions = src.match(/export async function \w+Action\(/g) ?? [];
    expect(actions.length).toBe(9);
    expect((src.match(/requirePermission\("products\.enrich"\)/g) ?? []).length).toBe(9);
    expect((src.match(/recordAudit\(/g) ?? []).length).toBe(9);
  });

  it("settings live in one site_settings row (no migration) and every check path syncs them", () => {
    const server = read("src/lib/ai/guardrails-server.ts");
    expect(server).toContain('from("site_settings")');
    expect(read("src/lib/ai/kb/retrieval.ts")).toMatch(/loadBannedPhrases[\s\S]{0,400}syncGuardrails\(\)/);
    expect(read("src/app/admin/layout.tsx")).toContain("<GuardrailsSync settings={guardrails} />");
    for (const f of [
      "src/lib/cms/newsletter-ai-server.ts",
      "src/lib/cms/culture-desk-server.ts",
      "src/lib/cms/post-templates-server.ts",
      "src/lib/cms/newsletter-send-store.ts",
      "src/app/admin/blog/actions.ts",
      "src/app/admin/merch-studio/ad-actions.ts",
      "src/components/merch/MerchRedirectAd.tsx",
    ]) {
      expect(read(f), f).toContain("await syncGuardrails().catch(() => null);");
    }
  });

  it("the shared pattern file is untouched (crawler parity)", () => {
    expect(read("src/lib/ai/compliance-patterns.json")).toBe(read("crawler/app/compliance_patterns.json"));
    expect(read("crawler/app/compliance.py")).toContain("rule_level(ai_pattern_key(p.label), p.severity)");
    expect(read("crawler/app/store.py")).toContain("GUARDRAILS_SETTING_KEY");
  });
});

/**
 * src/lib/ai/guardrails-catalog-core.ts — D244 R-23: the list of EVERY word
 * rule in the site that can stop or flag text, for the Compliance guardrails
 * page (owner round 10: "please make sure you find everything that blocks,
 * and add it to the page. be methodical please").
 *
 * PURE. The words are read from the live rule sources (never copied), so the
 * page always shows exactly what the checks use:
 *   - the shared AI check (compliance-patterns.json, also the crawler),
 *   - the two effect lists (effects-lists-core.ts),
 *   - the newsletter AI checks (newsletter-ai-core.ts),
 *   - the blog template checks (post-templates-core.ts),
 *   - the culture desk + curated review checks (culture-desk-core.ts),
 *   - the promotion wording warnings (promotion-copy-core.ts),
 *   - the merch studio theme words (print-rules-core.ts),
 *   - the merch ad price / cart words (merch-ad-core.ts),
 *   - the newsletter design picture heads-ups (newsletter-design-core.ts).
 * Each rule has a stable key; guardrails-state-core.ts holds the owner's
 * level for it.
 */
import patternsJson from "./compliance-patterns.json";
import { ALLOWED_EFFECTS, EFFECT_MEDICAL_WORDS } from "./effects-lists-core";
import { aiPatternKey, isAllowedWord, ruleLevel, type GuardrailLevel } from "./guardrails-state-core";
import { NEWSLETTER_WORD_LISTS } from "@/lib/cms/newsletter-ai-core";
import { BLOG_SUPERLATIVES_SOURCE } from "@/lib/cms/post-templates-core";
import { CULTURE_WORD_LISTS } from "@/lib/cms/culture-desk-core";
import { PROMOTION_WORD_RULES } from "@/lib/promotions/promotion-copy-core";
import { THEME_KEYWORDS } from "@/lib/merch-studio/print-rules-core";
import { MERCH_AD_WORD_LISTS } from "@/lib/merch/merch-ad-core";

export type GuardrailGroupKey = "ai" | "effects" | "newsletter" | "blog" | "culture" | "promo" | "merch";

export type GuardrailGroup = { key: GuardrailGroupKey; title: string; where: string };

export const GUARDRAIL_GROUPS: readonly GuardrailGroup[] = [
  {
    key: "ai",
    title: "AI writing check (the main one)",
    where:
      "Every AI draft and every fact before it is accepted or published: product and vendor copy, the Copilot, Accept drafts, Bulk publish, the review inbox, the knowledge-base write-back, strain look-ups, SEO, the blog and newsletter AI, banner words, newsletter design pictures, and the crawler. A must-fix stops the accept or publish; on the public product page a must-fix text is not shown.",
  },
  {
    key: "effects",
    title: "Effect words (the Effects field)",
    where: "Every effect value before it is saved (Accept drafts, Copilot, knowledge-base write-back, product look-ups, the menu sensory panel).",
  },
  { key: "newsletter", title: "Newsletter AI", where: "The newsletter canvas AI (write, ask, picture asks) and design pictures." },
  { key: "blog", title: "Blog post templates", where: "Blog → New post from a template, and the culture desk drafts (save and Create draft)." },
  { key: "culture", title: "Culture desk and curated reviews", where: "Culture posts (before they are created and before they go live) and curated customer reviews." },
  { key: "promo", title: "Promotion wording (warnings only)", where: "The promotion editor and list. These never block saving or publishing; they warn and suggest." },
  { key: "merch", title: "Merch studio and merch ad", where: "Merch studio art check (review notes) and the merch ad shown on the website (price / cart words stop the ad showing)." },
];

export type GuardrailRule = {
  key: string;
  group: GuardrailGroupKey;
  name: string;
  /** The level the code uses when the owner has not changed it. */
  builtIn: GuardrailLevel;
  /** The levels that mean something for this rule. */
  levels: readonly GuardrailLevel[];
  /** The exact pattern the check uses (null = not a word list). */
  pattern: string | null;
  /** A plain word list (the effect lists, the merch themes). */
  list?: readonly string[];
  why: string;
  cite?: string;
};

const ALL: readonly GuardrailLevel[] = ["block", "warn", "off"];
const ON_OFF: readonly GuardrailLevel[] = ["block", "off"];
const WARN_OFF: readonly GuardrailLevel[] = ["warn", "off"];
const WAC = "WAC 314-55-155";

type RawPattern = { pattern: string; flags?: string; label: string; severity: string };

function aiRules(): GuardrailRule[] {
  return (patternsJson as { patterns: RawPattern[] }).patterns.map((p) => ({
    key: aiPatternKey(p.label),
    group: "ai" as const,
    name: p.label,
    builtIn: p.severity === "block" ? ("block" as const) : ("warn" as const),
    levels: ALL,
    pattern: p.pattern,
    why:
      p.severity === "block"
        ? "Must fix before accepting or publishing. A single everyday word (\u201cslow cured\u201d, \u201ca sweet treat\u201d) is read in context first and becomes a heads-up."
        : "A heads-up only: a person reads it, nothing is stopped.",
    cite: p.label.startsWith("price") || p.label.startsWith("empty hype") ? undefined : WAC,
  }));
}

export const GUARDRAIL_RULES: readonly GuardrailRule[] = [
  ...aiRules(),
  {
    key: "effects.allow-list",
    group: "effects",
    name: "Effect must be on the approved list",
    builtIn: "block",
    levels: ON_OFF,
    pattern: null,
    list: ALLOWED_EFFECTS,
    why: "An effect that is not one of these words is dropped. Off = any effect word is kept (the other rules still apply). Allowed words below also pass.",
    cite: WAC,
  },
  {
    key: "effects.medical-words",
    group: "effects",
    name: "Effect contains a medical word",
    builtIn: "block",
    levels: ON_OFF,
    pattern: null,
    list: EFFECT_MEDICAL_WORDS,
    why: "An effect containing one of these words is dropped. Allow a single word below to let it through.",
    cite: WAC,
  },
  { key: "newsletter.superlatives", group: "newsletter", name: "Superlatives", builtIn: "block", levels: ALL, pattern: NEWSLETTER_WORD_LISTS.superlatives, why: "Owner rule Q-22-9: no best / #1 style claims.", cite: "Q-22-9" },
  { key: "newsletter.health", group: "newsletter", name: "Health or medical wording", builtIn: "block", levels: ALL, pattern: NEWSLETTER_WORD_LISTS.health, why: "No health wording in the newsletter (read in context, like the AI check).", cite: WAC },
  { key: "newsletter.amounts", group: "newsletter", name: "Amounts not in this week's deals", builtIn: "block", levels: ALL, pattern: null, why: "A $ amount or % in the AI words that is not in this week's deals (Q-22-8).", cite: "Q-22-8" },
  { key: "newsletter.links", group: "newsletter", name: "Links the AI made up", builtIn: "block", levels: ALL, pattern: null, why: "A web link in the AI words that is not in the facts it was given." },
  { key: "newsletter.picture-words", group: "newsletter", name: "Picture ask: minors, use, cartoons, medical", builtIn: "block", levels: ALL, pattern: NEWSLETTER_WORD_LISTS.pictureWords, why: "Words in an AI picture request that would make a picture that cannot be used.", cite: WAC },
  { key: "newsletter.picture-superlatives", group: "newsletter", name: "Picture ask: superlatives", builtIn: "warn", levels: WARN_OFF, pattern: NEWSLETTER_WORD_LISTS.superlatives, why: "A heads-up if the picture would carry best / #1 style words." },
  { key: "newsletter.picture-price", group: "newsletter", name: "Design picture: price typed on it", builtIn: "warn", levels: WARN_OFF, pattern: null, why: "A heads-up: prices change, so they belong in live text." },
  { key: "newsletter.picture-date", group: "newsletter", name: "Design picture: date typed on it", builtIn: "warn", levels: WARN_OFF, pattern: null, why: "A heads-up: dates belong in live text so they can be corrected." },
  { key: "blog.superlatives", group: "blog", name: "Superlatives", builtIn: "block", levels: ALL, pattern: BLOG_SUPERLATIVES_SOURCE, why: "Owner rule Q-22-9: no best / #1 style claims.", cite: "Q-22-9" },
  { key: "blog.prices", group: "blog", name: "Prices outside Sale and Vendor-day posts", builtIn: "block", levels: ALL, pattern: null, why: "Owner rule Q-22-8: $ and % only in Sale and Vendor-day posts.", cite: "Q-22-8" },
  { key: "blog.amounts", group: "blog", name: "Amounts not in the promotion", builtIn: "block", levels: ALL, pattern: null, why: "A $ or % that the promotion does not give (Q-22-8).", cite: "Q-22-8" },
  { key: "blog.dates", group: "blog", name: "Dates outside Sale, Vendor-day and Holiday posts", builtIn: "warn", levels: ALL, pattern: null, why: "A heads-up: dates go stale." },
  { key: "blog.source-link", group: "blog", name: "Culture post missing its source link", builtIn: "warn", levels: ALL, pattern: null, why: "A heads-up so readers can check the news (Q-22-1).", cite: "Q-22-1" },
  { key: "blog.links", group: "blog", name: "Links not in the facts", builtIn: "block", levels: ALL, pattern: null, why: "A web link the AI added that was not in the facts." },
  { key: "culture.therapeutic", group: "culture", name: "Therapeutic wording", builtIn: "block", levels: ALL, pattern: CULTURE_WORD_LISTS.therapeutic, why: "Culture posts may report what a source said, never a benefit (read in context).", cite: "WAC 314-55-155(2)(a)(vii)" },
  { key: "culture.health-topic", group: "culture", name: "Health-topic words (turn on the three health rules below)", builtIn: "block", levels: ON_OFF, pattern: CULTURE_WORD_LISTS.health, why: "When a post uses one of these words it counts as a health post, and the three rules below apply. Off = no post counts as a health post.", cite: "Q-22-1" },
  { key: "culture.source-link", group: "culture", name: "Culture / health post needs a cited source link", builtIn: "block", levels: ALL, pattern: null, why: "A link to the study or news.", cite: "Q-22-1" },
  { key: "culture.health-selling-links", group: "culture", name: "Health post links to the menu, products or deals", builtIn: "block", levels: ALL, pattern: null, why: "A health post may not sell.", cite: "Q-22-1" },
  { key: "culture.provider-line", group: "culture", name: "Health post needs the healthcare-provider line", builtIn: "block", levels: ALL, pattern: null, why: "The \u201ctalk to your healthcare provider\u201d line.", cite: "Q-22-1" },
  { key: "reviews.health-words", group: "culture", name: "Curated review with health-benefit wording", builtIn: "block", levels: ON_OFF, pattern: CULTURE_WORD_LISTS.therapeutic, why: "A review quote with these words is held back from the newsletter and blog. Off = the review can be used.", cite: WAC },
  ...PROMOTION_WORD_RULES.map((r) => ({ key: r.key, group: "promo" as const, name: r.label, builtIn: "warn" as const, levels: WARN_OFF, pattern: r.words, why: r.why, cite: r.cite })),
  ...Object.entries(THEME_KEYWORDS).map(([theme, def]) => ({
    key: `merch.${theme}`,
    group: "merch" as const,
    name: `Merch art words that ${def.label}`,
    builtIn: "warn" as const,
    levels: WARN_OFF,
    pattern: null,
    list: def.words,
    why: "A review note in the merch studio art check; it never stops an order.",
    cite: "WAC 314-55-155(2)(a)",
  })),
  { key: "merch-ad.price-words", group: "merch", name: "Merch ad: price words", builtIn: "block", levels: ALL, pattern: MERCH_AD_WORD_LISTS.price, why: "Block = the merch ad is not shown on the website while it has a price. Prices live on the merch site." },
  { key: "merch-ad.cart-words", group: "merch", name: "Merch ad: cart / checkout words", builtIn: "block", levels: ALL, pattern: MERCH_AD_WORD_LISTS.cart, why: "Block = the merch ad is not shown while it reads like a shop listing." },
];

export function ruleByKey(key: string): GuardrailRule | null {
  return GUARDRAIL_RULES.find((r) => r.key === key) ?? null;
}

/** The checks that stop text but are not word rules (shown for completeness). */
export const NOT_WORD_RULES: readonly string[] = [
  "Newsletter send check: the four required warnings, the unsubscribe link, alt text, picture sizes, buttons and polls that are missing parts (WAC 314-55-155(7)). These check that something is present, not words.",
  "Promotion editor: the text versus the deal (percent, bundle, day, product type, brand). These are accuracy warnings and never block.",
  "Banner schedule: the tick \u201cI checked the picture for minors appeal\u201d. A word list cannot see a picture.",
  "Blog: below-cost deals are held back from Sale posts (Q-22-8). That is a price check, not a word.",
];

/**
 * A readable word list from a rule pattern, e.g. "\\b(cure|cures)\\b" →
 * ["cure", "cures"]. Best effort: alternatives at the top level are split,
 * spacing marks become spaces, optional "s" shows as "(s)". The page also
 * shows the exact pattern.
 */
export function readableWords(pattern: string): string[] {
  let p = pattern.trim();
  // only the simple shape "\b( ... )\b" (or with a trailing optional part) is split
  p = p.replace(/^\\b/, "").replace(/\\b$/, "");
  if (p.startsWith("(") && p.endsWith(")") && topLevelClose(p) === p.length - 1) p = p.slice(1, -1);
  const out: string[] = [];
  for (const alt of splitTop(p)) {
    const w = alt
      .replace(/^\\b|\\b$/g, "")
      .replace(/\(\?:/g, "(")
      .replace(/\\s\+|\\s\*|\\s\?|\\s/g, " ")
      .replace(/\[- \]\?/g, "-")
      .replace(/\[- \]/g, " ")
      .replace(/-\?/g, "-")
      .replace(/\\d\+|\\d/g, "#")
      .replace(/\\\$/g, "$")
      .replace(/\\b/g, "")
      .replace(/\\/g, "")
      .replace(/s\?/g, "(s)")
      .replace(/\s+/g, " ")
      .trim();
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

function topLevelClose(p: string): number {
  let depth = 0;
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTop(p: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === "\\") {
      cur += c + (p[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === "(" || c === "[") depth += 1;
    if (c === ")" || c === "]") depth -= 1;
    if (c === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export type RuleTestHit = { key: string; name: string; group: GuardrailGroupKey; level: GuardrailLevel; words: string[] };

/**
 * "Test some text": which word rules match, at the owner's current level,
 * minus the allowed words. A plain word match (the AI check also reads the
 * words around a hit; the page shows that verdict separately).
 */
export function testRules(text: string): RuleTestHit[] {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  const out: RuleTestHit[] = [];
  for (const r of GUARDRAIL_RULES) {
    const level = ruleLevel(r.key, r.builtIn);
    const words: string[] = [];
    const add = (w: string) => {
      const x = w.trim().toLowerCase();
      if (x && !isAllowedWord(x) && !words.includes(x)) words.push(x);
    };
    if (r.pattern) {
      let re: RegExp;
      try {
        re = new RegExp(r.pattern, "gi");
      } catch {
        continue;
      }
      for (const m of t.matchAll(re)) add(m[0]);
    } else if (r.list && r.group === "merch") {
      const padded = ` ${t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `;
      for (const w of r.list) if (padded.includes(` ${w} `)) add(w);
    } else if (r.key === "effects.medical-words" && r.list) {
      for (const tok of t.toLowerCase().split(/[,;\n]+/)) for (const w of r.list) if (tok.includes(w)) add(w);
    }
    if (words.length) out.push({ key: r.key, name: r.name, group: r.group, level, words });
  }
  return out;
}

// ── Self-tests ──────────────────────────────────────────────────────────────
export function __runGuardrailsCatalogTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ guardrails-catalog: ${name}`);
    }
  };
  const keys = GUARDRAIL_RULES.map((r) => r.key);
  ok(new Set(keys).size === keys.length, "rule keys are unique");
  ok(keys.every((k) => /^[a-z0-9_.-]{3,100}$/.test(k)), "rule keys are valid setting keys");
  const pats = (patternsJson as { patterns: RawPattern[] }).patterns;
  ok(GUARDRAIL_RULES.filter((r) => r.group === "ai").length === pats.length, "every shared AI pattern is listed");
  ok(GUARDRAIL_RULES.filter((r) => r.group === "promo").length === 11, "all 11 promotion wording rules listed");
  ok(GUARDRAIL_RULES.filter((r) => r.key.startsWith("merch.")).length === Object.keys(THEME_KEYWORDS).length, "every merch theme listed");
  ok(GUARDRAIL_RULES.every((r) => r.levels.includes(r.builtIn)), "built-in level is a choice");
  ok(GUARDRAIL_RULES.every((r) => GUARDRAIL_GROUPS.some((g) => g.key === r.group)), "every rule has a group");
  ok(GUARDRAIL_RULES.every((r) => r.pattern === null || (() => { try { new RegExp(r.pattern, "gi"); return true; } catch { return false; } })()), "every pattern compiles");
  ok(ruleByKey("ai.safety-efficacy-claim")?.builtIn === "block", "safety rule found by key");
  ok(ruleByKey("effects.medical-words")?.list?.includes("pain") === true, "medical words listed");
  const cure = readableWords("\\b(cure|cures|cured)\\b");
  ok(cure.join("|") === "cure|cures|cured", "readable words: simple list");
  ok(readableWords("\\b(gummy bears?|kid)\\b").join("|") === "gummy bear(s)|kid", "readable words: optional s");
  ok(readableWords("\\$\\s?\\d|\\bprice\\b").join("|") === "$ #|price", "readable words: top-level alternatives");
  ok(readableWords("\\b(world-?class|top[- ]rated)\\b").join("|") === "world-class|top-rated", "readable words: hyphen marks");
  const hits = testRules("Totally safe for kids, the best deal!");
  ok(hits.some((h) => h.key === "ai.safety-efficacy-claim" && h.words.includes("safe")), "tester finds safe");
  ok(hits.some((h) => h.key === "ai.appeal-to-minors-language" && h.words.includes("kids")), "tester finds kids");
  ok(hits.some((h) => h.key === "promo.minors"), "tester finds promo rule");
  ok(testRules("  ").length === 0, "blank text, no hits");
  return { passed, failed };
}

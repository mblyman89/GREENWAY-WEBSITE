/**
 * src/lib/ai/guardrails-state-core.ts — D244 R-23: the owner's settings for
 * every word rule that can stop or flag text.
 *
 * Owner (verbatim, round 10): "I want every banned and warning words and
 * phrases to be in this page. I keep getting blocked out right for things
 * that are not disallowed. I need to be in control, and if I choose something
 * is ok to do, thats my choice. please upgrade and enhance that compliance
 * guardrails page to have any and all things that block me from publishing
 * text to be included here. so I can fine tune them myself and enable and
 * disable them as I see fit."
 *
 * PURE: no I/O, no imports. Every rule site (compliance.ts, the newsletter,
 * blog, culture desk, reviews, promotion, banner, merch checks) asks this
 * module two questions:
 *   1. `ruleLevel(key, builtIn)` — the owner's level for one rule:
 *      "block" (must fix), "warn" (heads-up only) or "off" (not checked).
 *      With no setting the built-in level is used, so nothing changes until
 *      the owner changes it.
 *   2. `isAllowedWord(word)` — words the owner said are fine everywhere. A
 *      hit on an allowed word is skipped by every rule.
 *
 * The settings live in one site_settings row (`compliance_guardrails`). The
 * server loads it (guardrails-server.ts, cached) and calls
 * `setActiveGuardrails`; the admin layout passes the same settings to the
 * browser (GuardrailsSync) so the checks that run in the browser agree.
 */

export type GuardrailLevel = "block" | "warn" | "off";

export const GUARDRAIL_LEVELS: readonly GuardrailLevel[] = ["block", "warn", "off"];

export type GuardrailSettings = {
  v: 1;
  /** Rule key → the owner's level. Missing = the built-in level. */
  rules: Record<string, GuardrailLevel>;
  /** Words and phrases the owner allows everywhere (lower case). */
  allow: string[];
};

/** The site_settings key the settings are stored under. */
export const GUARDRAILS_SETTING_KEY = "compliance_guardrails";
export const GUARDRAILS_SETTING_LABEL = "Compliance guardrails (owner settings, D244 R-23)";
export const ALLOW_WORD_MAX = 80;
export const ALLOW_LIST_MAX = 500;
const RULE_KEY_RE = /^[a-z0-9_.-]{3,100}$/;

export function emptyGuardrails(): GuardrailSettings {
  return { v: 1, rules: {}, allow: [] };
}

export function isGuardrailLevel(v: unknown): v is GuardrailLevel {
  return v === "block" || v === "warn" || v === "off";
}

/** One allowed word as stored: trimmed, single spaces, lower case. "" = unusable. */
export function cleanAllowWord(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!s || s.length > ALLOW_WORD_MAX) return "";
  return s;
}

/** Any stored value → valid settings. Never throws. */
export function normalizeGuardrails(raw: unknown): GuardrailSettings {
  const out = emptyGuardrails();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.rules && typeof r.rules === "object") {
    for (const [k, v] of Object.entries(r.rules as Record<string, unknown>)) {
      if (RULE_KEY_RE.test(k) && isGuardrailLevel(v)) out.rules[k] = v;
    }
  }
  if (Array.isArray(r.allow)) {
    const seen = new Set<string>();
    for (const w of r.allow) {
      const c = cleanAllowWord(w);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.allow.push(c);
      if (out.allow.length >= ALLOW_LIST_MAX) break;
    }
  }
  return out;
}

// ── The active settings (one per server process / browser tab) ─────────────

let active: GuardrailSettings = emptyGuardrails();
let activeAllow: Set<string> = new Set();

/** Replace the active settings (server sync or the admin layout). */
export function setActiveGuardrails(s: GuardrailSettings | null | undefined): void {
  active = normalizeGuardrails(s ?? null);
  activeAllow = new Set(active.allow);
}

export function activeGuardrails(): GuardrailSettings {
  return active;
}

/** The owner's level for one rule, or the built-in level when unset. */
export function ruleLevel(key: string, builtIn: GuardrailLevel): GuardrailLevel {
  return active.rules[key] ?? builtIn;
}

/** True when the owner allowed this exact word or phrase everywhere. */
export function isAllowedWord(word: string): boolean {
  if (activeAllow.size === 0) return false;
  const c = cleanAllowWord(word);
  return c !== "" && activeAllow.has(c);
}

/** The hits the owner has not allowed (de-duplicated, lower case). */
export function notAllowed(hits: readonly string[]): string[] {
  const out: string[] = [];
  for (const h of hits) {
    const w = String(h ?? "").trim().toLowerCase();
    if (!w || isAllowedWord(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * The must-fix / heads-up level of an issue for the newsletter, blog and
 * culture checks: block → "must-fix", warn → "heads-up", off → null (skip).
 */
export function issueLevel(key: string, builtIn: GuardrailLevel): "must-fix" | "heads-up" | null {
  const l = ruleLevel(key, builtIn);
  return l === "block" ? "must-fix" : l === "warn" ? "heads-up" : null;
}

/** The rule key for one shared AI pattern (compliance-patterns.json label). */
export function aiPatternKey(label: string): string {
  const slug = String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return `ai.${slug}`;
}

// ── Editing helpers (pure; the server action saves the result) ──────────────

/** Set one rule's level. `null` (or the built-in level) clears the override. */
export function withRuleLevel(s: GuardrailSettings, key: string, level: GuardrailLevel | null, builtIn: GuardrailLevel): GuardrailSettings {
  const rules = { ...s.rules };
  if (level === null || level === builtIn) delete rules[key];
  else rules[key] = level;
  return { v: 1, rules, allow: [...s.allow] };
}

export function withAllowWord(s: GuardrailSettings, word: string): GuardrailSettings {
  const c = cleanAllowWord(word);
  if (!c || s.allow.includes(c) || s.allow.length >= ALLOW_LIST_MAX) return s;
  return { v: 1, rules: { ...s.rules }, allow: [...s.allow, c] };
}

export function withoutAllowWord(s: GuardrailSettings, word: string): GuardrailSettings {
  const c = cleanAllowWord(word);
  return { v: 1, rules: { ...s.rules }, allow: s.allow.filter((w) => w !== c) };
}

// ── Self-tests ──────────────────────────────────────────────────────────────
export function __runGuardrailsStateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ guardrails-state: ${name}`);
    }
  };
  const saved = activeGuardrails();
  try {
    ok(normalizeGuardrails(null).allow.length === 0 && Object.keys(normalizeGuardrails("x").rules).length === 0, "junk → empty");
    const n = normalizeGuardrails({ rules: { "ai.safe": "warn", "BAD KEY": "off", "x.y": "nope" }, allow: [" Safe ", "safe", "", "Kids", 5] });
    ok(n.rules["ai.safe"] === "warn" && Object.keys(n.rules).length === 1, "only valid keys and levels kept");
    ok(n.allow.join("|") === "safe|kids|5", "allow words cleaned + de-duplicated");
    ok(cleanAllowWord("x".repeat(81)) === "" && cleanAllowWord("Don\u2019t") === "don't", "allow word length + quotes");
    setActiveGuardrails(emptyGuardrails());
    ok(ruleLevel("ai.x", "block") === "block" && ruleLevel("ai.x", "warn") === "warn", "unset → built-in level");
    ok(!isAllowedWord("safe"), "nothing allowed by default");
    setActiveGuardrails({ v: 1, rules: { "ai.x": "off", "ai.y": "warn" }, allow: ["safe", "good for you"] });
    ok(ruleLevel("ai.x", "block") === "off" && ruleLevel("ai.y", "block") === "warn", "owner level wins");
    ok(isAllowedWord("SAFE") && isAllowedWord(" good  for you ") && !isAllowedWord("kids"), "allowed words, any case/spacing");
    ok(notAllowed(["Safe", "kids", "KIDS"]).join("|") === "kids", "notAllowed filters + de-dupes");
    ok(issueLevel("ai.x", "block") === null && issueLevel("ai.y", "block") === "heads-up" && issueLevel("ai.z", "block") === "must-fix", "issueLevel maps");
    ok(aiPatternKey("medical claim (cure/treat/heal/prevent)") === "ai.medical-claim-cure-treat-heal-prevent", "pattern key slug");
    ok(aiPatternKey("borderline therapeutic-leaning phrasing (review)") === "ai.borderline-therapeutic-leaning-phrasing-review", "pattern key slug 2");
    const e = emptyGuardrails();
    const a = withRuleLevel(e, "ai.x", "off", "block");
    ok(a.rules["ai.x"] === "off" && e.rules["ai.x"] === undefined, "withRuleLevel sets (pure)");
    ok(withRuleLevel(a, "ai.x", "block", "block").rules["ai.x"] === undefined, "back to built-in clears");
    ok(withRuleLevel(a, "ai.x", null, "block").rules["ai.x"] === undefined, "null clears");
    const w = withAllowWord(e, " Kids ");
    ok(w.allow.join() === "kids" && withAllowWord(w, "kids") === w, "withAllowWord adds once");
    ok(withoutAllowWord(w, "KIDS").allow.length === 0, "withoutAllowWord removes");
  } finally {
    setActiveGuardrails(saved);
  }
  return { passed, failed };
}

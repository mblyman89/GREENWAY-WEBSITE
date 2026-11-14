/**
 * src/lib/ai/compliance-context-core.ts — D244 R-14: read the words around a
 * blocked word before blocking it.
 *
 * Owner (verbatim): "I need the word "cure", "cured", and others like it to be
 * a warn only, and the system should allow me to attach facts that use that
 * word. Why? because cannabis is dried and then cured. it is called the cure
 * process. … if we can make the system smarter by looking at the words before
 * and after the word cure, or any of the blocked words for that matter, so it
 * will allow the words if used not in a medical way."
 *
 * PURE: no I/O, no server-only. The rules live in the shared fixture
 * (src/lib/ai/compliance-patterns.json → contextRules) so the Python crawler
 * (crawler/app/compliance.py) runs the SAME algorithm on the SAME words, and
 * the fixture's `examples` are run by both sides' tests.
 *
 * The algorithm, for one BLOCK-pattern hit:
 *   1. Only a hit that is exactly one word listed in a family is judged.
 *      Multi-word hits ("cures anxiety", "good for you") keep blocking.
 *   2. Medical window: the same sentence, `window.before` words before and
 *      `window.after` words after (commas ignored). Any medicalWords there
 *      keeps the block, except a medical word right after medicalNeutralBefore
 *      ("low-stress") or right before medicalNeutralAfter ("disease-free").
 *   3. Reach checks look only inside the same clause (a comma ends a clause).
 *   4. default "allow" (the cure family): allowed unless a medicalBefore /
 *      medicalAfter word is within reach, a medicalAfterAtEnd word ends the
 *      clause ("a cure-all"), or "for" follows without a length of time
 *      ("cured for 21 days" is fine, "a cure for a bad day" blocks).
 *   5. default "block": still blocks unless a benignBefore / benignAfter word
 *      is within reach ("keep out of reach of children", "a sweet treat").
 *   6. An allowed hit is NEVER silent: the caller turns it into a heads-up
 *      flag that names why it was allowed. A person still reads it.
 */
import patternsJson from "./compliance-patterns.json";

export type ReachList = { reach: number; words: string[] };
export type ContextFamily = {
  id: string;
  words: string[];
  default: "allow" | "block";
  why: string;
  medicalBefore?: ReachList;
  medicalAfter?: ReachList;
  medicalAfterAtEnd?: string[];
  forNeedsTime?: boolean;
  benignBefore?: ReachList;
  benignAfter?: ReachList;
};
export type ContextRules = {
  window: { before: number; after: number };
  medicalWords: string[];
  medicalNeutralBefore: string[];
  medicalNeutralAfter: string[];
  forSkipWords: string[];
  forTimeWords: string[];
  families: ContextFamily[];
  examples: { text: string; ok: boolean; warn?: boolean }[];
};

export const CONTEXT_RULES: ContextRules = (patternsJson as unknown as { contextRules: ContextRules }).contextRules;

type Tok = { t: string; start: number; kind: "w" | "c" | "s" };

/** Lower-case word tokens plus clause (,:;()—) and sentence (.!?\n) marks. */
export function contextTokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z0-9\u2019']+|[,:()\u2014\u2013]|[.!?;\n]/g;
  for (const m of String(text ?? "").matchAll(re)) {
    const raw = m[0];
    const start = m.index ?? 0;
    if (/^[.!?;\n]$/.test(raw)) {
      // a dot inside a number ("2.5") is not a sentence end
      const prev = text[start - 1] ?? "";
      const next = text[start + 1] ?? "";
      if (raw === "." && /\d/.test(prev) && /\d/.test(next)) continue;
      out.push({ t: raw, start, kind: "s" });
    } else if (/^[,:()\u2014\u2013]$/.test(raw)) out.push({ t: raw, start, kind: "c" });
    else out.push({ t: raw.toLowerCase().replace(/\u2019/g, "'").replace(/^'+|'+$/g, ""), start, kind: "w" });
  }
  return out;
}

export function familyFor(word: string, rules: ContextRules = CONTEXT_RULES): ContextFamily | null {
  const w = String(word ?? "").trim().toLowerCase();
  if (!w || /\s/.test(w)) return null;
  return rules.families.find((f) => f.words.includes(w)) ?? null;
}

/** Words on one side of token i: sentence-wide (commas skipped) or clause-only. */
function side(toks: Tok[], i: number, dir: -1 | 1, n: number, clauseOnly: boolean): string[] {
  const out: string[] = [];
  for (let j = i + dir; j >= 0 && j < toks.length && out.length < n; j += dir) {
    const k = toks[j];
    if (k.kind === "s") break;
    if (k.kind === "c") {
      if (clauseOnly) break;
      continue;
    }
    out.push(k.t);
  }
  return out;
}

function medicalNear(toks: Tok[], i: number, rules: ContextRules): string | null {
  const med = new Set(rules.medicalWords);
  const nb = new Set(rules.medicalNeutralBefore);
  const na = new Set(rules.medicalNeutralAfter);
  const before = side(toks, i, -1, rules.window.before + 1, false).reverse(); // +1 so the first word can see its neighbour
  const after = side(toks, i, 1, rules.window.after + 1, false);
  const check = (words: string[], from: number, to: number): string | null => {
    for (let k = from; k < to; k++) {
      const w = words[k];
      if (!med.has(w)) continue;
      if (k > 0 && nb.has(words[k - 1])) continue;
      if (k + 1 < words.length && na.has(words[k + 1])) continue;
      return w;
    }
    return null;
  };
  // before: the last `window.before` entries; after: the first `window.after`
  const b = check(before, Math.max(0, before.length - rules.window.before), before.length);
  if (b) return b;
  // the hit itself sits between before and after; neutral-after can apply to the last after word only via its own neighbour
  return check(after, 0, Math.min(after.length, rules.window.after));
}

export type ContextVerdict = { allowed: boolean; family: string | null; why: string };

/**
 * Judge one hit. `start` is the character offset of the hit inside `text`;
 * `word` is what the pattern matched. Returns allowed=false (keep the block)
 * whenever the word is not in a family or any medical sign is near.
 */
export function judgeHit(text: string, start: number, word: string, rules: ContextRules = CONTEXT_RULES): ContextVerdict {
  const fam = familyFor(word, rules);
  if (!fam) return { allowed: false, family: null, why: "not a context word" };
  const toks = contextTokens(text);
  const i = toks.findIndex((k) => k.kind === "w" && k.start === start);
  if (i < 0) return { allowed: false, family: fam.id, why: "hit not found" };
  const med = medicalNear(toks, i, rules);
  if (med) return { allowed: false, family: fam.id, why: `medical word nearby: "${med}"` };
  const before = side(toks, i, -1, 6, true);
  const after = side(toks, i, 1, 8, true);
  const within = (words: string[], r?: ReachList) => (r ? words.slice(0, r.reach).find((w) => r.words.includes(w)) ?? null : null);
  if (fam.default === "allow") {
    const mb = within(before, fam.medicalBefore);
    if (mb) return { allowed: false, family: fam.id, why: `"${mb} ${word.toLowerCase()}" reads as a claim` };
    const ma = within(after, fam.medicalAfter);
    if (ma) return { allowed: false, family: fam.id, why: `"${word.toLowerCase()} ${ma}" reads as a claim` };
    if (fam.medicalAfterAtEnd && after.length === 1 && fam.medicalAfterAtEnd.includes(after[0])) {
      return { allowed: false, family: fam.id, why: `"${word.toLowerCase()} ${after[0]}" reads as a claim` };
    }
    if (fam.forNeedsTime && after[0] === "for") {
      let k = 1;
      while (k < after.length && rules.forSkipWords.includes(after[k])) k += 1;
      const first = after[k];
      if (!first || !(rules.forTimeWords.includes(first) || /^\d+$/.test(first))) {
        return { allowed: false, family: fam.id, why: `"${word.toLowerCase()} for …" reads as a claim unless a length of time follows` };
      }
    }
    return { allowed: true, family: fam.id, why: fam.why };
  }
  const bb = within(before, fam.benignBefore);
  if (bb) return { allowed: true, family: fam.id, why: fam.why };
  const ba = within(after, fam.benignAfter);
  if (ba) return { allowed: true, family: fam.id, why: fam.why };
  return { allowed: false, family: fam.id, why: "no everyday meaning nearby" };
}

export type PatternJudgement = { blocked: boolean; allowedWhy: string[] };

/**
 * Judge every hit of one BLOCK pattern. Blocked if ANY hit stays blocked;
 * otherwise the pattern becomes a heads-up and `allowedWhy` names each reason.
 * `re` may be non-global; a global copy is made.
 */
export function judgePattern(text: string, re: RegExp, rules: ContextRules = CONTEXT_RULES): PatternJudgement {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const allowedWhy: string[] = [];
  for (const m of String(text ?? "").matchAll(g)) {
    const v = judgeHit(text, m.index ?? 0, m[0], rules);
    if (!v.allowed) return { blocked: true, allowedWhy: [] };
    const note = `"${m[0].toLowerCase()}" (${v.why})`;
    if (!allowedWhy.includes(note)) allowedWhy.push(note);
  }
  return { blocked: false, allowedWhy };
}

/**
 * Filter a list of regex matches down to the ones that still read as a
 * claim (used by the newsletter, culture-desk and review guards).
 */
export function claimHits(text: string, re: RegExp, rules: ContextRules = CONTEXT_RULES): string[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(g)) {
    const w = m[0].toLowerCase();
    if (familyFor(w, rules) && judgeHit(text, m.index ?? 0, m[0], rules).allowed) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// ── Self-tests ─────────────────────────────────────────────────────────────
export function __runComplianceContextTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`compliance-context-core FAIL: ${name}`);
    }
  };
  const CURE = /\b(cure|cures|cured|curing)\b/i;
  const allows = (t: string, re: RegExp = CURE) => {
    const j = judgePattern(t, re);
    return !j.blocked;
  };
  // the cure process: allowed
  ok(allows("Hang-dried and slow cured for 21 days."), "slow cured for 21 days");
  ok(allows("Our cure process takes four weeks."), "cure process");
  ok(allows("We dry and cure every harvest by hand."), "dry and cure");
  ok(allows("Cured for a minimum of 14 days."), "cured for a minimum");
  ok(allows("Cured for at least 3 weeks."), "cured for at least 3 weeks");
  ok(allows("Properly cured flower. Slow-cured again."), "two hits, both process");
  ok(allows("Cured, you can taste it."), "comma ends the clause before 'you'");
  ok(allows("We cured all of our flower."), "'all' mid-clause is fine");
  ok(allows("Low-stress trained and cured."), "low-stress is a grow method");
  // medical: still blocked
  ok(!allows("This strain cures anxiety."), "cures anxiety");
  ok(!allows("The cure for insomnia."), "cure for insomnia");
  ok(!allows("It cures your blues."), "cures your");
  ok(!allows("A miracle cure."), "miracle cure");
  ok(!allows("Cures everything."), "cures everything");
  ok(!allows("A cure-all."), "cure-all");
  ok(!allows("A cure for a bad day."), "cure for (no time)");
  ok(!allows("Slow cured and great for chronic pain."), "pain nearby keeps the block");
  ok(!allows("Slow cured. This cures anxiety."), "one bad hit blocks the pattern");
  ok(allows("Cures anxiety? No. Our flower is slow cured.", /\bcured\b/i), "sentence scope: other sentence does not taint");
  // other families
  const T = /\b(treat|treats)\b/i;
  ok(allows("A sweet treat for the weekend.", T), "a sweet treat");
  ok(allows("Treat yourself.", T), "treat yourself");
  ok(!allows("This strain treats stress.", T), "treats stress");
  ok(!allows("It treats it.", T), "treats with no everyday word");
  ok(allows("Keep out of reach of children.", /\bchildren\b/i), "reach of children");
  ok(!allows("Kids love it.", /\bkids\b/i), "kids love it");
  ok(allows("Store in a safe place.", /\bsafe\b/i), "safe place");
  ok(!allows("It is safe.", /\bsafe\b/i), "it is safe");
  ok(allows("Clean glass with isopropyl alcohol.", /\balcohol\b/i), "isopropyl alcohol");
  ok(allows("Don\u2019t mix with alcohol.", /\balcohol\b/i), "curly apostrophe don't");
  ok(!allows("Pairs well with alcohol.", /\balcohol\b/i), "pairs with alcohol");
  ok(allows("Sealed to prevent oxidation.", /\bprevent\b/i), "prevent oxidation");
  ok(!allows("Helps prevent migraines.", /\bprevent\b/i), "prevent migraines");
  ok(!allows("Cures anxiety", /\bcures anxiety\b/i), "multi-word hit never judged");
  ok(!allows("Heals you.", /\bheals\b/i), "word outside every family keeps blocking");
  ok(!judgePattern("nothing here", CURE).blocked && judgePattern("nothing here", CURE).allowedWhy.length === 0, "no hit, nothing");
  ok(judgePattern("Slow cured.", CURE).allowedWhy[0]?.includes("curing process") === true, "allowed hit names why");
  ok(claimHits("Slow cured. It cures your pain.", /\b(cures?|cured)\b/gi).join(",") === "cures", "claimHits keeps only the claim");
  ok(contextTokens("2.5 g. Cured")[3]?.kind === "s" && contextTokens("2.5 g. Cured")[1]?.t === "5" && contextTokens("2.5 g")[0].t === "2", "decimal dot is not a sentence end");
  ok(familyFor("Cured")?.id === "cure" && familyFor("cures anxiety") === null, "familyFor");
  // the fixture's own examples (the crawler runs the same list)
  const BLOCKS = (patternsJson as unknown as { patterns: { pattern: string; flags: string; severity: string }[] }).patterns
    .filter((p) => p.severity === "block")
    .map((p) => new RegExp(p.pattern, p.flags));
  for (const ex of CONTEXT_RULES.examples) {
    const blocked = BLOCKS.some((re) => re.test(ex.text) && judgePattern(ex.text, re).blocked);
    ok(blocked === !ex.ok, `fixture example: ${ex.text}`);
  }
  return { passed, failed };
}

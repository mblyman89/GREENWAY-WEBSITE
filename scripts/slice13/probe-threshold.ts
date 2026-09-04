/**
 * Slice 13 probe — measure the ACTUAL blended token similarity so the fuzzy
 * threshold is chosen from evidence, not taste.
 *
 * Prints, for real typo pairs (must match) and real distinct-word pairs (must
 * NOT match), the exact blend used by scoreTokenInField:
 *     0.5 * dice + 0.5 * levenshteinRatio
 *
 * Run: npx tsx scripts/slice13/probe-threshold.ts
 */
import { diceCoefficient, levenshteinRatio } from "../../src/lib/ai/kb/strain-matcher";

const blend = (a: string, b: string) =>
  0.5 * diceCoefficient(a, b) + 0.5 * levenshteinRatio(a, b);

// Real typos a budtender would make. These MUST match.
const SHOULD_MATCH: [string, string][] = [
  ["dreem", "dream"],
  ["weding", "wedding"],
  ["gorila", "gorilla"],
  ["chocolat", "chocolate"],
  ["gummies", "gummy"],
  ["cantna", "cantina"],
  ["rosn", "rosin"],
  ["blueberry", "bluberry"],
];

// Genuinely different words. These MUST NOT match, or the list becomes noise.
const SHOULD_NOT_MATCH: [string, string][] = [
  ["indica", "sativa"],
  ["resin", "rosin"], // real, distinct product forms — must stay separate
  ["mint", "mango"],
  ["grape", "grope"],
  ["cart", "cake"],
  ["live", "love"],
  ["kush", "hash"],
  ["lemon", "melon"],
];

let minMatch = 1;
let maxNonMatch = 0;

console.log("SHOULD MATCH (typos):");
for (const [a, b] of SHOULD_MATCH) {
  const s = blend(a, b);
  if (s < minMatch) minMatch = s;
  console.log(`  ${a.padEnd(12)} ~ ${b.padEnd(12)} = ${s.toFixed(4)}`);
}

console.log("\nSHOULD NOT MATCH (distinct words):");
for (const [a, b] of SHOULD_NOT_MATCH) {
  const s = blend(a, b);
  if (s > maxNonMatch) maxNonMatch = s;
  console.log(`  ${a.padEnd(12)} ~ ${b.padEnd(12)} = ${s.toFixed(4)}`);
}

console.log(`\nlowest  TRUE-positive score : ${minMatch.toFixed(4)}`);
console.log(`highest TRUE-negative score : ${maxNonMatch.toFixed(4)}`);
console.log(
  maxNonMatch < minMatch
    ? `SEPARABLE. Any threshold in (${maxNonMatch.toFixed(4)}, ${minMatch.toFixed(4)}] works.`
    : "NOT SEPARABLE with this blend — the threshold cannot satisfy both sets.",
);

/*
 * MEASURED RESULT AND THE CONCLUSION DRAWN FROM IT
 * ---------------------------------------------------------------------------
 * The sets are NOT separable, and the reason is not a weak metric — it is
 * information-theoretic:
 *
 *     dreem ~ dream = 0.6500      (a typo we MUST catch)
 *     resin ~ rosin = 0.6500      (two real, different products)
 *     grape ~ grope = 0.6500      (two real, different words)
 *
 * All three are a single character substitution. No string metric can tell
 * them apart, because there is nothing in the STRINGS to tell apart. The
 * difference is that "dreem" is not a word anyone stocks and "resin" is.
 *
 * Therefore a single global threshold is the wrong instrument. Picking 0.78
 * (the first draft) silently threw away real typos; picking 0.65 would have
 * quietly turned a search for "resin" into a search for "rosin" — showing the
 * owner the WRONG products with no indication anything had been substituted.
 * That is worse than showing nothing.
 *
 * The design this measurement forces instead is TIERING:
 *
 *   Tier 1 (strict)  exact / prefix / word-prefix / substring only.
 *                    "resin" finds resin. It can never drift to "rosin".
 *   Tier 2 (fuzzy)   entered ONLY when tier 1 matched nothing at all.
 *                    "dreem" finds nothing strictly, so the typo allowance
 *                    opens and "Blue Dream" is offered — labelled as a guess.
 *
 * In tier 2 the precision worry disappears by construction: if strict search
 * found no resin, then offering rosin is help rather than contamination.
 *
 * So the threshold only has to clear the TRUE-POSITIVE floor. Measured floor
 * is 0.5857 ("gummies" ~ "gummy"), and the nearest non-typo pair below it is
 * "live" ~ "love" at 0.5417. FUZZY_TOKEN_THRESHOLD = 0.58 sits between the
 * two: it admits every typo above, and excludes live/love, cart/cake,
 * kush/hash, lemon/melon, mint/mango and indica/sativa.
 */

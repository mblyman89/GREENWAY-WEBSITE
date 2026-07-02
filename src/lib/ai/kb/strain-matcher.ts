/**
 * src/lib/ai/kb/strain-matcher.ts
 *
 * INTELLIGENT inventory → Knowledge-Base matcher.
 *
 * When a vendor manifest comes in, each line carries a `strain_name` and/or a
 * `product_name` that is often a *variation* of a strain we already know:
 *   - a pack size / weight appended  ......  "Blue Dream 3.5g"
 *   - a brand added around the name  ......  "Fweedom - Blue Dream - Preroll"
 *   - punctuation / spacing differences ...  "GG#4", "G.G. #4", "gg 4"
 *   - an alternate/alias spelling  ........  "Gorilla Glue #4" == "GG4"
 *   - a small typo  .......................  "Blue Dreem"
 *
 * This module finds the KB strain that a line most likely refers to, returning
 * BOTH an auto-accept-quality best match (when confident) AND a ranked list of
 * near-exact candidates for a human to confirm. It NEVER mutates anything and
 * has no I/O — pure functions, unit-testable. Everything it produces is a
 * SUGGESTION a person reviews (standing rule: drafts-only).
 *
 * Scoring is deliberately conservative: we only call something an EXACT match
 * when the cleaned strings (or a known alias) are equal, and we require a fairly
 * high similarity for "near" matches so we don't confidently mislabel product.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The minimal KB strain shape the matcher needs (name + slug + aliases). */
export type MatchableStrain = {
  slug: string;
  name: string;
  aliases?: string[] | null;
  strain_type?: string | null;
};

export type MatchMethod = "exact" | "alias" | "contained" | "fuzzy";

export type StrainCandidate<T extends MatchableStrain = MatchableStrain> = {
  strain: T;
  /** 0..1 similarity/confidence. 1 = exact. */
  score: number;
  method: MatchMethod;
  /** Human-readable reason, e.g. "alias 'gg4' matched" or "92% similar to 'Blue Dream'". */
  reason: string;
};

export type StrainMatchResult<T extends MatchableStrain = MatchableStrain> = {
  /** The single best match IF we are confident enough to suggest it as primary. */
  best: StrainCandidate<T> | null;
  /** Ranked candidates (includes `best`), highest score first. */
  candidates: StrainCandidate<T>[];
  /** True when there is no confident single answer and a human should pick. */
  needsReview: boolean;
  /** The cleaned query we actually matched on (for display/debugging). */
  normalizedQuery: string;
};

export type MatchOptions = {
  /** Score at/above which `best` is auto-suggested as primary. Default 0.92. */
  autoAcceptScore?: number;
  /** Minimum score to include a fuzzy candidate at all. Default 0.72. */
  minCandidateScore?: number;
  /** Max candidates returned. Default 5. */
  maxCandidates?: number;
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// Noise tokens/phrases that vendors bolt onto a strain name. Removed before
// matching so "Blue Dream Pre-Roll 2x .5g" reduces to "blue dream".
const WEIGHT_RE =
  /\b\d+(?:\.\d+)?\s?(?:g|gram|grams|mg|oz|ounce|ounces|ml|kg|lb|lbs)\b/gi;
const PACK_RE = /\b\d+\s?(?:x|pk|pack|packs|ct|count|pc|pcs)\b/gi;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?%/g;

const FORM_WORDS = [
  "pre-roll",
  "preroll",
  "pre roll",
  "prerolls",
  "joint",
  "joints",
  "blunt",
  "blunts",
  "cartridge",
  "cart",
  "carts",
  "disposable",
  "vape",
  "vaporizer",
  "flower",
  "bud",
  "nug",
  "eighth",
  "ounce",
  "concentrate",
  "wax",
  "shatter",
  "budder",
  "badder",
  "crumble",
  "rosin",
  "resin",
  "live resin",
  "live rosin",
  "sauce",
  "diamonds",
  "diamond",
  "kief",
  "hash",
  "rso",
  "distillate",
  "gummy",
  "gummies",
  "chocolate",
  "edible",
  "edibles",
  "tincture",
  "topical",
  "salve",
  "balm",
  "lotion",
  "capsule",
  "capsules",
  "beverage",
  "drink",
  "infused",
  "indica",
  "sativa",
  "hybrid",
];

/**
 * Aggressively clean a product/strain string down to just the likely strain
 * name: lowercase, drop weights/packs/percentages, drop parentheticals, drop
 * common form/category words, and collapse punctuation to single spaces.
 *
 * NOTE: we intentionally KEEP alphanumerics like "gg4"/"ak47" glued so number
 * suffixes survive; a separate alnum-squash key handles "gg #4" == "gg4".
 */
export function normalizeStrainQuery(raw: string | null | undefined): string {
  let s = (raw ?? "").toLowerCase();
  // Strip anything in parentheses/brackets (often a brand or alt name).
  s = s.replace(/[([{][^)\]}]*[)\]}]/g, " ");
  s = s.replace(WEIGHT_RE, " ");
  s = s.replace(PACK_RE, " ");
  s = s.replace(PERCENT_RE, " ");
  // Turn separators into spaces, keep # for now (helps "gg #4").
  s = s.replace(/[_/|,.:;+*"'`~!?@$^&<>=\\-]+/g, " ");
  // Remove form/category words as whole words.
  const formSet = new Set(FORM_WORDS.map((w) => w.replace(/[^a-z0-9]+/g, " ").trim()));
  const kept = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !formSet.has(t));
  // Re-join, then also drop multi-word form phrases that survived tokenizing.
  let out = kept.join(" ");
  for (const w of FORM_WORDS) {
    if (w.includes(" ")) {
      out = out.replace(new RegExp(`\\b${w.replace(/[^a-z0-9 ]/g, "")}\\b`, "g"), " ");
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Collapse to bare alphanumerics for glue-insensitive equality ("gg #4"→"gg4"). */
export function alnumKey(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Token set (sorted, de-duped) for order-insensitive comparison. */
function tokenSet(s: string): string[] {
  return Array.from(new Set(s.split(/\s+/).filter(Boolean))).sort();
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** Levenshtein edit distance (iterative, O(n*m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Normalized Levenshtein similarity in 0..1. */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Dice coefficient over character bigrams (0..1), good for short names. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const n of A.values()) total += n;
  for (const n of B.values()) total += n;
  for (const [bg, n] of A) {
    const m = B.get(bg);
    if (m) overlap += Math.min(n, m);
  }
  return (2 * overlap) / total;
}

/** Jaccard over token sets (0..1) — order/duplication insensitive. */
export function tokenJaccard(a: string, b: string): number {
  const A = new Set(tokenSet(a));
  const B = new Set(tokenSet(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Fuzzy token alignment (0..1). For each token in the smaller set, find its
 * best-matching token in the other set by Dice-blended char similarity, then
 * average. This tolerates a per-WORD typo ("dreem"≈"dream") that exact-set
 * Jaccard would score as a total miss, while staying order-insensitive.
 */
export function tokenAlignment(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.length === 0 && B.length === 0) return 1;
  if (A.length === 0 || B.length === 0) return 0;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  let sum = 0;
  for (const t of small) {
    let best = 0;
    for (const u of large) {
      const sim = t === u ? 1 : 0.5 * diceCoefficient(t, u) + 0.5 * levenshteinRatio(t, u);
      if (sim > best) best = sim;
    }
    sum += best;
  }
  // Divide by the LARGER set so extra unmatched words in `large` cost score.
  return sum / large.length;
}

/**
 * Blended similarity between two ALREADY-normalized strings. Combines
 * token-set Jaccard (handles reordering + extra words), Dice bigrams (handles
 * short names / minor edits), and Levenshtein ratio (handles typos). We take a
 * weighted mix and also give credit for one string containing the other.
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Fuzzy token alignment replaces strict Jaccard so a single mistyped WORD
  // (e.g. "blue dreem") still scores high; keep Dice + Levenshtein for overall
  // character-level agreement.
  const align = tokenAlignment(a, b);
  const dice = diceCoefficient(a, b);
  const lev = levenshteinRatio(a, b);
  let score = 0.5 * align + 0.3 * dice + 0.2 * lev;
  // Containment bonus: "blue dream" fully inside "blue dream gelato".
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 3 && longer.includes(shorter)) {
    score = Math.max(score, 0.85 + 0.15 * (shorter.length / longer.length));
  }
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

const DEFAULTS: Required<MatchOptions> = {
  autoAcceptScore: 0.92,
  minCandidateScore: 0.72,
  maxCandidates: 5,
};

/** Build the list of normalized lookup keys for a strain (name + aliases). */
function strainKeys(s: MatchableStrain): { norm: string; alnum: string; label: string }[] {
  const labels = [s.name, s.slug, ...(s.aliases ?? [])].filter(Boolean) as string[];
  const seen = new Set<string>();
  const out: { norm: string; alnum: string; label: string }[] = [];
  for (const label of labels) {
    const n = normalizeStrainQuery(label);
    if (!n) continue;
    const key = n + "|" + alnumKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ norm: n, alnum: alnumKey(label), label });
  }
  return out;
}

/**
 * Match an incoming product/strain string against a KB strain list. Pass the
 * explicit `strainName` when the manifest has one, plus the full `productName`
 * as a fallback (the matcher will try the strain field first, then the product
 * name). Returns a ranked, review-friendly result.
 */
export function matchStrainToKb<T extends MatchableStrain>(
  input: { strainName?: string | null; productName?: string | null },
  strains: T[],
  options: MatchOptions = {},
): StrainMatchResult<T> {
  const opts = { ...DEFAULTS, ...options };
  // Prefer the explicit strain field; fall back to the product name.
  const rawQuery = (input.strainName && input.strainName.trim())
    ? input.strainName
    : (input.productName ?? "");
  const q = normalizeStrainQuery(rawQuery);
  const qAlnum = alnumKey(rawQuery);

  const empty: StrainMatchResult<T> = {
    best: null,
    candidates: [],
    needsReview: true,
    normalizedQuery: q,
  };
  if (!q && !qAlnum) return empty;

  const scored: StrainCandidate<T>[] = [];

  for (const s of strains) {
    const keys = strainKeys(s);
    let bestForStrain: StrainCandidate<T> | null = null;

    for (const k of keys) {
      // 1) Exact normalized equality (name) → 1.0
      if (q && k.norm === q) {
        bestForStrain = {
          strain: s,
          score: 1,
          method: k.label === s.name ? "exact" : "alias",
          reason:
            k.label === s.name
              ? `exact match on "${s.name}"`
              : `alias "${k.label}" matched exactly`,
        };
        break;
      }
      // 2) Glue-insensitive alnum equality ("gg #4" == "gg4") → 0.99
      if (qAlnum && k.alnum && k.alnum === qAlnum) {
        const cand: StrainCandidate<T> = {
          strain: s,
          score: 0.99,
          method: k.label === s.name ? "exact" : "alias",
          reason: `matched "${k.label}" ignoring spacing/punctuation`,
        };
        if (!bestForStrain || cand.score > bestForStrain.score) bestForStrain = cand;
        continue;
      }
      // 3) Fuzzy similarity
      if (q) {
        const sim = similarity(q, k.norm);
        if (!bestForStrain || sim > bestForStrain.score) {
          const contained =
            k.norm.length >= 3 && (q.includes(k.norm) || k.norm.includes(q));
          bestForStrain = {
            strain: s,
            score: sim,
            method: contained ? "contained" : "fuzzy",
            reason: contained
              ? `"${k.label}" found within the product name`
              : `${Math.round(sim * 100)}% similar to "${k.label}"`,
          };
        }
      }
    }

    if (bestForStrain && bestForStrain.score >= opts.minCandidateScore) {
      scored.push(bestForStrain);
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: prefer the shorter (more specific) strain name.
    return a.strain.name.length - b.strain.name.length;
  });

  const candidates = scored.slice(0, opts.maxCandidates);
  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;

  // Confident "best" when the top score clears the auto-accept bar AND it's
  // clearly ahead of the runner-up (avoid confidently picking between two
  // near-ties like "OG Kush" vs "OG Kush Breath").
  const clearlyAhead = !second || top!.score - second.score >= 0.06 || top!.score === 1;
  const best = top && top.score >= opts.autoAcceptScore && clearlyAhead ? top : null;

  return {
    best,
    candidates,
    needsReview: best === null,
    normalizedQuery: q,
  };
}

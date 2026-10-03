/**
 * src/lib/products/match-weights-core.ts   (bible S36 — Suggestions v2)
 *
 * PURE. No I/O, no server imports. Explainable "are these two menu cards the
 * same product at different sizes?" scoring for the Product Masters
 * Suggestions tab, replacing the old constant confidences (0.97 / 0.9).
 *
 * ═══ THE MODEL (Fellegi–Sunter, as documented by Splink) ═══
 *
 * Each field is a COMPARISON with mutually exclusive LEVELS (e.g. strain:
 * "same verified strain" / "same name, not verified" / "different"). Every
 * level carries two probabilities:
 *
 *   m = P(this level | the two cards ARE the same product)
 *   u = P(this level | the two cards are NOT the same product)
 *
 * and its match weight is  log2(m / u).  A level that is likelier for true
 * matches (m > u) ADDS evidence; a level that is likelier for non-matches
 * (m < u) SUBTRACTS it — negative evidence (the "different market" or "same
 * size twice" lines). Within one comparison the m's sum to 1 and the u's sum
 * to 1, so a two-level comparison has agree = log2(m/u) and
 * disagree = log2((1-m)/(1-u)).
 *
 * A missing value on either side is the NULL level: weight 0, it neither
 * helps nor hurts (Splink's "null level").
 *
 *   total match weight  M = PRIOR_WEIGHT + Σ field weights
 *   match probability   P = 2^M / (1 + 2^M)        (M = 0  ↔  P = 0.5)
 *
 * PRIOR_WEIGHT = log2(λ / (1-λ)) where λ is the share of candidate pairs
 * (inside one block) that really are the same product.
 *
 * Bands (bible S36): Strong ≥ 0.95 · Likely 0.80–0.95 · Review 0.50–0.80 ·
 * below 0.50 is not shown. P = 0.95 is Strong, P = 0.80 is Likely, P = 0.50
 * is Review (lower bounds inclusive).
 *
 * ═══ WHERE THE NUMBERS COME FROM (read this before tuning) ═══
 *
 * These m/u values are hand-set STARTING PRIORS, not estimates: Splink's
 * documentation allows manual m/u when there is no labelled data, and this
 * store has none yet (every Accept / Reject on the Suggestions tab is the
 * labelled data a later round can fit them to). Each value is written down
 * next to its reason, and the self-tests below pin the BEHAVIOUR the owner
 * asked for rather than the decimals, so a re-tune that keeps the behaviour
 * keeps the tests green:
 *   - a same-vendor, same-verified-strain card at a different size is Strong;
 *   - the SAME card name from two different vendors (different brands) is
 *     below Likely, and ANY vendor disagreement can never reach Strong;
 *   - the same size twice and a different market subtract;
 *   - a different market never groups at all (hard rule, not just weight).
 *
 * AI is never the source of the score (bible S36.8, Reltio R11-3: rules are
 * the most explainable); the store may only ask it to break a tie in the
 * Review band.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** One menu card, already resolved against the backbone (see masters-store). */
export type MatchRecord = {
  key: string;
  name: string;
  /** Normalised vendor identity ("" = unknown — legacy cards). */
  vendor: string;
  /** Canonical brand identity ("" = unknown). */
  brand: string;
  /** Canonical strain identity (kb_strains slug when verified). */
  strain: string;
  strainVerified: boolean;
  /** Category family (flower / vape / concentrate / edible / …). */
  family: string;
  market: "adult" | "medical";
  /** Canonical strain type, or null when unknown. */
  strainType: string | null;
  /** Normalised size labels this card is sold in (e.g. ["1g","3.5g"]). */
  sizes: string[];
  /** THC percent (only when the card states a % potency), else null. */
  thcPct: number | null;
  /** Lowest price per gram in minor units (weighed sizes only), else null. */
  pricePerGramMinor: number | null;
};

export type MatchField =
  | "vendor"
  | "brand"
  | "strain"
  | "family"
  | "market"
  | "strainType"
  | "sizes"
  | "thc"
  | "pricePerGram";

export type Contribution = {
  field: MatchField;
  /** true = agrees, false = disagrees, null = unknown on a side (weight 0). */
  agree: boolean | null;
  weight: number;
  /** The plain-English line the waterfall shows ("same vendor"). */
  note: string;
};

export type MatchBand = "strong" | "likely" | "review" | "hidden";

export type PairScore = {
  weight: number;
  probability: number;
  band: MatchBand;
  contributions: Contribution[];
};

type Level = { m: number; u: number; note: string };

// ─── The weights (documented m/u) ───────────────────────────────────────────

/** λ = 1%: inside a vendor/brand + family block, about 1 pair in 100 is the same product at another size. */
export const PRIOR_LAMBDA = 0.01;

/**
 * Per-field comparison levels. Within a field, Σm = 1 and Σu = 1 (checked by
 * the self-tests), so the weights are a proper Fellegi–Sunter comparison.
 */
export const FIELD_WEIGHTS = {
  vendor: {
    // Same product → nearly always the same licensee ships it (0.95). Two
    // unrelated cards inside a brand+family fallback block share a vendor ~30%.
    agree: { m: 0.95, u: 0.3, note: "same vendor" },
    disagree: { m: 0.05, u: 0.7, note: "different vendor" },
  },
  brand: {
    agree: { m: 0.97, u: 0.35, note: "same brand" },
    disagree: { m: 0.03, u: 0.65, note: "different brand" },
  },
  strain: {
    // Verified = both resolve to the same curated kb_strains row (alias-aware).
    verified: { m: 0.8, u: 0.01, note: "same strain (verified)" },
    // Same normalised name but not a curated strain (weaker: names repeat).
    unverified: { m: 0.15, u: 0.02, note: "same strain name (not verified)" },
    disagree: { m: 0.05, u: 0.97, note: "different strain" },
  },
  family: {
    agree: { m: 0.99, u: 0.5, note: "same product type" },
    disagree: { m: 0.01, u: 0.5, note: "different product type" },
  },
  market: {
    // Adult-use and medical never marry (also a hard rule in groupByScore).
    agree: { m: 0.999, u: 0.85, note: "same market" },
    disagree: { m: 0.001, u: 0.15, note: "different market" },
  },
  strainType: {
    agree: { m: 0.95, u: 0.4, note: "same strain type" },
    disagree: { m: 0.05, u: 0.6, note: "different strain type" },
  },
  sizes: {
    // The point of a master: one product, several sizes. Two cards of the
    // same product rarely both sell the same size; two different products
    // often do (every flower comes in 3.5g).
    distinct: { m: 0.9, u: 0.4, note: "different sizes" },
    shared: { m: 0.1, u: 0.6, note: "same size twice" },
  },
  thc: {
    // Lots of one cultivar from one grower test within a few points.
    agree: { m: 0.85, u: 0.45, note: "THC within 5 points" },
    disagree: { m: 0.15, u: 0.55, note: "THC more than 5 points apart" },
  },
  pricePerGram: {
    // Bigger sizes are cheaper per gram, but rarely by more than half.
    agree: { m: 0.9, u: 0.6, note: "similar price per gram" },
    disagree: { m: 0.1, u: 0.4, note: "very different price per gram" },
  },
} as const satisfies Record<MatchField, Record<string, Level>>;

/** THC agreement tolerance, in percentage points (inclusive). */
export const THC_BAND_POINTS = 5;
/** Price-per-gram agreement: the dearer is at most this multiple of the cheaper (inclusive). */
export const PRICE_PER_GRAM_MAX_RATIO = 2;

export const BAND_STRONG = 0.95;
export const BAND_LIKELY = 0.8;
export const BAND_REVIEW = 0.5;

export function log2(x: number): number {
  return Math.log(x) / Math.LN2;
}

/** A level's match weight: log2(m / u). Positive when m > u. */
export function levelWeight(level: { m: number; u: number }): number {
  return log2(level.m / level.u);
}

export const PRIOR_WEIGHT = log2(PRIOR_LAMBDA / (1 - PRIOR_LAMBDA));

/** P = 2^M / (1 + 2^M), computed stably for large |M|. */
export function probabilityFromWeight(weight: number): number {
  if (weight >= 0) return 1 / (1 + Math.pow(2, -weight));
  const t = Math.pow(2, weight);
  return t / (1 + t);
}

/** Lower bounds inclusive: 0.95 Strong, 0.80 Likely, 0.50 Review. */
export function bandFor(probability: number): MatchBand {
  if (probability >= BAND_STRONG) return "strong";
  if (probability >= BAND_LIKELY) return "likely";
  if (probability >= BAND_REVIEW) return "review";
  return "hidden";
}

export const BAND_LABEL: Record<MatchBand, string> = {
  strong: "Strong",
  likely: "Likely",
  review: "Review",
  hidden: "Not shown",
};

// ─── Field comparisons ──────────────────────────────────────────────────────

const blank = (s: string | null | undefined) => !s || !String(s).trim();

function from(field: MatchField, level: Level, agree: boolean): Contribution {
  return { field, agree, weight: levelWeight(level), note: level.note };
}
function unknown(field: MatchField, note: string): Contribution {
  return { field, agree: null, weight: 0, note };
}

function compareEq(field: "vendor" | "brand" | "family", a: string, b: string): Contribution {
  if (blank(a) || blank(b)) return unknown(field, `${field === "family" ? "product type" : field} unknown`);
  const w = FIELD_WEIGHTS[field];
  return a === b ? from(field, w.agree, true) : from(field, w.disagree, false);
}

function compareStrain(a: MatchRecord, b: MatchRecord): Contribution {
  if (blank(a.strain) || blank(b.strain)) return unknown("strain", "strain unknown");
  const w = FIELD_WEIGHTS.strain;
  if (a.strain !== b.strain) return from("strain", w.disagree, false);
  return a.strainVerified && b.strainVerified ? from("strain", w.verified, true) : from("strain", w.unverified, true);
}

function compareMarket(a: MatchRecord, b: MatchRecord): Contribution {
  const w = FIELD_WEIGHTS.market;
  return a.market === b.market ? from("market", w.agree, true) : from("market", w.disagree, false);
}

function compareStrainType(a: MatchRecord, b: MatchRecord): Contribution {
  if (blank(a.strainType) || blank(b.strainType)) return unknown("strainType", "strain type unknown");
  const w = FIELD_WEIGHTS.strainType;
  return a.strainType === b.strainType ? from("strainType", w.agree, true) : from("strainType", w.disagree, false);
}

function compareSizes(a: MatchRecord, b: MatchRecord): Contribution {
  if (a.sizes.length === 0 || b.sizes.length === 0) return unknown("sizes", "size unknown");
  const w = FIELD_WEIGHTS.sizes;
  const bs = new Set(b.sizes);
  const shared = a.sizes.some((s) => bs.has(s));
  // agree:false on "same size twice" — it is evidence AGAINST one master.
  return shared ? from("sizes", w.shared, false) : from("sizes", w.distinct, true);
}

function compareThc(a: MatchRecord, b: MatchRecord): Contribution {
  if (a.thcPct == null || b.thcPct == null) return unknown("thc", "THC unknown");
  const w = FIELD_WEIGHTS.thc;
  return Math.abs(a.thcPct - b.thcPct) <= THC_BAND_POINTS ? from("thc", w.agree, true) : from("thc", w.disagree, false);
}

function comparePricePerGram(a: MatchRecord, b: MatchRecord): Contribution {
  const x = a.pricePerGramMinor;
  const y = b.pricePerGramMinor;
  if (x == null || y == null || x <= 0 || y <= 0) return unknown("pricePerGram", "price per gram unknown");
  const w = FIELD_WEIGHTS.pricePerGram;
  const ratio = Math.max(x, y) / Math.min(x, y);
  return ratio <= PRICE_PER_GRAM_MAX_RATIO ? from("pricePerGram", w.agree, true) : from("pricePerGram", w.disagree, false);
}

/** Score one pair. Symmetric: scorePair(a,b) and scorePair(b,a) agree. */
export function scorePair(a: MatchRecord, b: MatchRecord): PairScore {
  const contributions: Contribution[] = [
    compareEq("vendor", a.vendor, b.vendor),
    compareEq("brand", a.brand, b.brand),
    compareStrain(a, b),
    compareEq("family", a.family, b.family),
    compareMarket(a, b),
    compareStrainType(a, b),
    compareSizes(a, b),
    compareThc(a, b),
    comparePricePerGram(a, b),
  ];
  const weight = contributions.reduce((s, c) => s + c.weight, PRIOR_WEIGHT);
  const probability = probabilityFromWeight(weight);
  return { weight, probability, band: bandFor(probability), contributions };
}

// ─── Fingerprints + pair keys ───────────────────────────────────────────────

/** Code-point order, matching Postgres `collate "C"` (the 0243 check). */
export function compareKeys(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** [key_a, key_b] with key_a < key_b, or null for a self-pair. */
export function orderPairKeys(a: string, b: string): [string, string] | null {
  const c = compareKeys(a, b);
  if (c === 0) return null;
  return c < 0 ? [a, b] : [b, a];
}

export const FINGERPRINT_VERSION = "fp1";

function side(r: MatchRecord): string {
  const sizes = Array.from(new Set(r.sizes)).sort(compareKeys).join(",");
  return [r.key, r.vendor, r.brand, r.strain, r.market, sizes].join("|");
}

/**
 * The critical attributes of BOTH cards (vendor, brand, strain, market,
 * sizes), in key order so (a,b) and (b,a) agree. A rejection is remembered
 * against this string; when either card changes one of these, the string
 * changes and the pair is proposed again (bible S36, R11-3).
 */
export function pairFingerprint(a: MatchRecord, b: MatchRecord): string {
  const [x, y] = compareKeys(a.key, b.key) <= 0 ? [a, b] : [b, a];
  return `${FINGERPRINT_VERSION}#${side(x)}#${side(y)}`;
}

/** Map key for a pair (order-free). */
export function pairId(a: string, b: string): string {
  const o = orderPairKeys(a, b);
  return o ? `${o[0]}\u0000${o[1]}` : `${a}\u0000${a}`;
}

// ─── Blocking ───────────────────────────────────────────────────────────────

/**
 * Candidate pairs (bible S36): block by vendor + family; cards with no vendor
 * (legacy) fall back to brand + family. The union of both rules is scored,
 * the Splink "multiple blocking rules" pattern, so a vendor-less card can
 * still meet a vendored card of its brand. Blocks bigger than `maxBlock` are
 * skipped (and counted) instead of exploding into n² pairs.
 */
export function candidatePairs(
  records: readonly MatchRecord[],
  maxBlock = 400,
): { pairs: Array<[MatchRecord, MatchRecord]>; skippedBlocks: number } {
  const blocks = new Map<string, MatchRecord[]>();
  const add = (k: string, r: MatchRecord) => {
    const list = blocks.get(k);
    if (list) list.push(r);
    else blocks.set(k, [r]);
  };
  for (const r of records) {
    if (!blank(r.vendor)) add(`v\u0000${r.vendor}\u0000${r.family}`, r);
    if (!blank(r.brand)) add(`b\u0000${r.brand}\u0000${r.family}`, r);
  }
  const seen = new Set<string>();
  const pairs: Array<[MatchRecord, MatchRecord]> = [];
  let skippedBlocks = 0;
  for (const block of blocks.values()) {
    if (block.length < 2) continue;
    if (block.length > maxBlock) {
      skippedBlocks += 1;
      continue;
    }
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const id = pairId(block[i].key, block[j].key);
        if (block[i].key === block[j].key || seen.has(id)) continue;
        seen.add(id);
        pairs.push([block[i], block[j]]);
      }
    }
  }
  return { pairs, skippedBlocks };
}

// ─── Grouping ───────────────────────────────────────────────────────────────

export type ScoredPair = { a: string; b: string; score: PairScore; fingerprint: string };

export type ScoredGroup = {
  keys: string[];
  /** The weakest member pair: a group is only as sure as its least-sure pair. */
  headline: ScoredPair;
  pairs: ScoredPair[];
  band: Exclude<MatchBand, "hidden">;
};

export type GroupOptions = {
  /** True when the owner rejected this pair and its fingerprint still matches. */
  isSuppressed?: (a: MatchRecord, b: MatchRecord, fingerprint: string) => boolean;
};

/**
 * Turn scored candidate pairs into suggestions.
 *
 *  1. STRONG pass — constrained single-link: Strong pairs are merged
 *     strongest-first, but two clusters only merge when EVERY cross pair is
 *     (a) the same market, (b) not a remembered rejection, and (c) shown
 *     (P ≥ 0.50). So a rejected pair can never be pulled into one group
 *     through a third card (cannot-link constraint).
 *  2. LIKELY / REVIEW pass — every card still alone may form ONE pair
 *     suggestion with its best remaining partner (P ≥ 0.50), best first.
 *
 * A different market never groups, at any weight.
 */
export function groupScoredPairs(
  records: readonly MatchRecord[],
  pairs: ReadonlyArray<[MatchRecord, MatchRecord]>,
  opts: GroupOptions = {},
): ScoredGroup[] {
  const byKey = new Map(records.map((r) => [r.key, r] as const));
  const scored = new Map<string, ScoredPair>();
  const blocked = new Set<string>();
  for (const [a, b] of pairs) {
    const fingerprint = pairFingerprint(a, b);
    const id = pairId(a.key, b.key);
    if (a.market !== b.market || opts.isSuppressed?.(a, b, fingerprint)) {
      blocked.add(id);
      continue;
    }
    scored.set(id, { a: a.key, b: b.key, score: scorePair(a, b), fingerprint });
  }
  // A cross pair is usable inside one group only if it was scored, not
  // blocked and shown. A pair outside every candidate block was never
  // compared: it is scored on demand (still pure) so the rule holds.
  const crossOk = (x: string, y: string): ScoredPair | null => {
    const id = pairId(x, y);
    if (blocked.has(id)) return null;
    let sp = scored.get(id);
    if (!sp) {
      const rx = byKey.get(x);
      const ry = byKey.get(y);
      if (!rx || !ry || rx.market !== ry.market) return null;
      const fingerprint = pairFingerprint(rx, ry);
      if (opts.isSuppressed?.(rx, ry, fingerprint)) return null;
      sp = { a: x, b: y, score: scorePair(rx, ry), fingerprint };
      scored.set(id, sp);
    }
    return sp.score.band === "hidden" ? null : sp;
  };

  const ordered = [...scored.values()].sort(
    (p, q) => q.score.weight - p.score.weight || compareKeys(pairId(p.a, p.b), pairId(q.a, q.b)),
  );

  // 1. Strong pass.
  const clusterOf = new Map<string, string[]>();
  for (const p of ordered) {
    if (p.score.band !== "strong") continue;
    const ca = clusterOf.get(p.a) ?? [p.a];
    const cb = clusterOf.get(p.b) ?? [p.b];
    if (ca === cb) continue;
    let ok = true;
    for (const x of ca) {
      for (const y of cb) {
        if (!crossOk(x, y)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    const merged = [...ca, ...cb];
    for (const k of merged) clusterOf.set(k, merged);
  }

  const groups: ScoredGroup[] = [];
  const emitted = new Set<string[]>();
  for (const cluster of clusterOf.values()) {
    if (emitted.has(cluster) || cluster.length < 2) continue;
    emitted.add(cluster);
    const keys = [...cluster].sort(compareKeys);
    const memberPairs: ScoredPair[] = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const sp = crossOk(keys[i], keys[j]);
        if (sp) memberPairs.push(sp);
      }
    }
    const headline = memberPairs.reduce((w, p) => (p.score.weight < w.score.weight ? p : w));
    groups.push({ keys, headline, pairs: memberPairs, band: headline.score.band as ScoredGroup["band"] });
  }

  // 2. Likely / Review pass for cards still alone.
  const used = new Set<string>(clusterOf.keys());
  for (const p of ordered) {
    if (p.score.band === "hidden" || p.score.band === "strong") continue;
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a);
    used.add(p.b);
    const keys = [p.a, p.b].sort(compareKeys);
    groups.push({ keys, headline: p, pairs: [p], band: p.score.band as ScoredGroup["band"] });
  }

  return groups.sort((g, h) => h.headline.score.weight - g.headline.score.weight || h.keys.length - g.keys.length);
}

/** Score every pair inside one block and group it (bible S36.2 signature). */
export function groupByScore(block: readonly MatchRecord[], opts: GroupOptions = {}): ScoredGroup[] {
  const pairs: Array<[MatchRecord, MatchRecord]> = [];
  for (let i = 0; i < block.length; i++) for (let j = i + 1; j < block.length; j++) pairs.push([block[i], block[j]]);
  return groupScoredPairs(block, pairs, opts);
}

// ─── Record building (pure parsing of what the menu already holds) ──────────

/** Normalise a size label: lower-case, no spaces ("3.5 G" → "3.5g", "1 OZ" → "1oz"). */
export function normalizeSizeLabel(label: string | null | undefined): string {
  return String(label ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

/** "24.5%" → 24.5. A mg value, a range or text → null (only % compares across sizes). */
export function parseThcPercent(raw: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(String(raw ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

const STRAIN_TYPES = new Set(["indica", "sativa", "hybrid", "indica-hybrid", "sativa-hybrid", "cbd"]);

/** Canonical strain type, or null for blank / "unknown" / anything unrecognised. */
export function canonicalStrainTypeForMatch(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  return STRAIN_TYPES.has(s) ? s : null;
}

export type SizedPrice = { label: string; priceMinor: number };

/**
 * Lowest price per gram over the weighed sizes. `gramsOf` is injected (the
 * store passes the shared weight-label parser) so this module stays free of
 * other imports. No weighed size → null.
 */
export function lowestPricePerGram(
  sizes: readonly SizedPrice[],
  gramsOf: (label: string) => number | null,
): number | null {
  let best: number | null = null;
  for (const s of sizes) {
    const g = gramsOf(s.label);
    if (g == null || !(g > 0) || !(s.priceMinor > 0)) continue;
    const ppg = s.priceMinor / g;
    if (best == null || ppg < best) best = ppg;
  }
  return best;
}

// ─── Evidence (what the store writes to evidence_json) ──────────────────────

export const EVIDENCE_VERSION = 1;

export type SuggestionEvidence = {
  v: typeof EVIDENCE_VERSION;
  band: Exclude<MatchBand, "hidden">;
  probability: number;
  weight: number;
  prior: number;
  /** The headline (weakest) pair's waterfall. */
  contributions: Contribution[];
  /** Every member pair's fingerprint, for "Reject" (remembered per pair). */
  pairs: Array<{ a: string; b: string; fingerprint: string; probability: number }>;
  /** Review-band only, optional: the AI tie-break note. Never changes the score. */
  ai?: { agrees: boolean; note: string } | null;
};

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function evidenceForGroup(g: ScoredGroup): SuggestionEvidence {
  return {
    v: EVIDENCE_VERSION,
    band: g.band,
    probability: round(g.headline.score.probability, 4),
    weight: round(g.headline.score.weight, 2),
    prior: round(PRIOR_WEIGHT, 2),
    contributions: g.headline.score.contributions.map((c) => ({ ...c, weight: round(c.weight, 2) })),
    pairs: g.pairs.map((p) => ({ a: p.a, b: p.b, fingerprint: p.fingerprint, probability: round(p.score.probability, 4) })),
    ai: null,
  };
}

/**
 * Read evidence_json defensively (old rows have none; a hand-edited row may
 * be malformed). Anything that is not a v1 object with a known band and a
 * contributions array reads as null, and the page falls back to the old
 * rationale text.
 */
export function readEvidence(raw: unknown): SuggestionEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<SuggestionEvidence>;
  if (e.v !== EVIDENCE_VERSION) return null;
  if (e.band !== "strong" && e.band !== "likely" && e.band !== "review") return null;
  if (typeof e.probability !== "number" || !Number.isFinite(e.probability)) return null;
  if (!Array.isArray(e.contributions)) return null;
  const contributions = e.contributions.filter(
    (c): c is Contribution => !!c && typeof c === "object" && typeof c.note === "string" && typeof c.weight === "number" && Number.isFinite(c.weight),
  );
  const pairs = Array.isArray(e.pairs)
    ? e.pairs.filter((p) => !!p && typeof p.a === "string" && typeof p.b === "string" && typeof p.fingerprint === "string")
    : [];
  return {
    v: EVIDENCE_VERSION,
    band: e.band,
    probability: e.probability,
    weight: typeof e.weight === "number" ? e.weight : 0,
    prior: typeof e.prior === "number" ? e.prior : round(PRIOR_WEIGHT, 2),
    contributions,
    pairs,
    ai: e.ai && typeof e.ai === "object" && typeof e.ai.agrees === "boolean" ? { agrees: e.ai.agrees, note: String(e.ai.note ?? "") } : null,
  };
}

/** "Strong · 97%" — the badge text (bible S36.4). */
export function bandBadgeText(band: Exclude<MatchBand, "hidden">, probability: number): string {
  return `${BAND_LABEL[band]} · ${Math.round(probability * 100)}%`;
}

/** "+3.1 same vendor" / "−4.0 different market" / "0 strain unknown". */
export function contributionText(c: Pick<Contribution, "weight" | "note">): string {
  const w = round(c.weight, 1);
  if (w === 0) return `±0 ${c.note}`;
  return `${w > 0 ? "+" : "\u2212"}${Math.abs(w).toFixed(1)} ${c.note}`;
}

/**
 * The plain-text reason saved in `rationale` (shown when evidence_json is
 * absent, e.g. before 0243): the agreeing lines, then "but" the opposing ones.
 */
export function rationaleFromScore(contributions: readonly Contribution[]): string {
  const plus = contributions.filter((c) => c.weight > 0).map((c) => c.note);
  const minus = contributions.filter((c) => c.weight < 0).map((c) => c.note);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (plus.length === 0 && minus.length === 0) return "Not enough facts to compare.";
  if (plus.length === 0) return `${cap(minus.join(", "))}.`;
  return `${cap(plus.join(", "))}${minus.length ? `; but ${minus.join(", ")}` : ""}.`;
}

// ─── "0243 not applied yet" ─────────────────────────────────────────────────

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const word = (msg: string, name: string) => new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`).test(msg);

/** True only when the error says product_master_pair_decisions does not exist. */
export function isMissingPairDecisionsTable(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const tableSignal = MISSING_TABLE_CODES.has(code) || /relation .* does not exist|could not find the table/.test(msg);
  return tableSignal && word(msg, "product_master_pair_decisions");
}

/** True only when the error says product_master_suggestions.evidence_json does not exist. */
export function isMissingEvidenceColumn(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  const colSignal = MISSING_COLUMN_CODES.has(code) || /column .* does not exist|could not find the .* column/.test(msg);
  return colSignal && word(msg, "evidence_json");
}

export const REJECT_HELP =
  "Rejected pairs stay hidden until one of them changes (vendor, brand, strain, market or size).";

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runMatchWeightsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[match-weights-core] FAIL: ${label}`);
    }
  };
  const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

  const base: MatchRecord = {
    key: "A",
    name: "Gelato 3.5g",
    vendor: "acme farms",
    brand: "acme",
    strain: "gelato",
    strainVerified: true,
    family: "flower",
    market: "adult",
    strainType: "hybrid",
    sizes: ["3.5g"],
    thcPct: 24,
    pricePerGramMinor: 1000,
  };
  const rec = (over: Partial<MatchRecord>): MatchRecord => ({ ...base, ...over });
  const field = (s: PairScore, f: MatchField) => s.contributions.find((c) => c.field === f)!;

  // 1. The comparisons are proper: Σm = 1 and Σu = 1 in every field.
  for (const [name, levels] of Object.entries(FIELD_WEIGHTS)) {
    const ls = Object.values(levels) as Level[];
    ok(near(ls.reduce((s, l) => s + l.m, 0), 1, 1e-9), `${name}: m sums to 1`);
    ok(near(ls.reduce((s, l) => s + l.u, 0), 1, 1e-9), `${name}: u sums to 1`);
  }

  // 2. The arithmetic (R11-1).
  ok(near(levelWeight({ m: 0.5, u: 0.25 }), 1), "log2(m/u): 0.5/0.25 = +1");
  ok(near(levelWeight({ m: 0.25, u: 0.5 }), -1), "log2(m/u): 0.25/0.5 = -1");
  ok(probabilityFromWeight(0) === 0.5, "weight 0 <-> probability 0.5");
  ok(near(probabilityFromWeight(2), 0.8), "weight 2 -> 0.8");
  ok(near(probabilityFromWeight(-2), 0.2), "weight -2 -> 0.2");
  ok(probabilityFromWeight(4) < 0.95 && probabilityFromWeight(4.25) > 0.95, "Strong begins between M=4 and M=4.25");
  ok(probabilityFromWeight(2000) === 1 && probabilityFromWeight(-2000) === 0, "stable at extremes (no NaN)");
  ok(near(PRIOR_WEIGHT, log2(0.01 / 0.99)), "prior = log2(λ/(1-λ))");
  ok(PRIOR_WEIGHT < 0, "prior is negative (most block pairs are different products)");

  // 3. Bands exact at their boundaries.
  ok(bandFor(0.95) === "strong", "0.95 is Strong");
  ok(bandFor(0.9499999) === "likely", "just under 0.95 is Likely");
  ok(bandFor(0.8) === "likely", "0.80 is Likely");
  ok(bandFor(0.7999999) === "review", "just under 0.80 is Review");
  ok(bandFor(0.5) === "review", "0.50 is Review");
  ok(bandFor(0.4999999) === "hidden", "just under 0.50 is not shown");
  ok(bandFor(1) === "strong" && bandFor(0) === "hidden", "1 Strong, 0 hidden");

  // 4. Every field: agreement adds, disagreement subtracts, unknown is 0.
  const same = scorePair(base, rec({ key: "B", sizes: ["1g"] }));
  for (const f of ["vendor", "brand", "strain", "family", "market", "strainType", "sizes", "thc", "pricePerGram"] as MatchField[]) {
    ok(field(same, f).weight > 0 && field(same, f).agree === true, `${f}: agreement adds`);
  }
  const diff = scorePair(
    base,
    rec({ key: "B", vendor: "other", brand: "other", strain: "zkittlez", family: "vape", market: "medical", strainType: "indica", sizes: ["3.5g"], thcPct: 12, pricePerGramMinor: 3000 }),
  );
  for (const f of ["vendor", "brand", "strain", "family", "market", "strainType", "sizes", "thc", "pricePerGram"] as MatchField[]) {
    ok(field(diff, f).weight < 0 && field(diff, f).agree === false, `${f}: disagreement subtracts`);
  }
  const unk = scorePair(
    rec({ vendor: "", brand: "", strain: "", family: "", strainType: null, sizes: [], thcPct: null, pricePerGramMinor: null }),
    rec({ key: "B" }),
  );
  for (const f of ["vendor", "brand", "strain", "family", "strainType", "sizes", "thc", "pricePerGram"] as MatchField[]) {
    ok(field(unk, f).weight === 0 && field(unk, f).agree === null, `${f}: unknown is 0`);
  }
  ok(near(unk.weight, PRIOR_WEIGHT + field(unk, "market").weight), "unknowns add nothing to the total");

  // 5. The total is the prior plus the contributions, and P follows from it.
  ok(near(same.weight, PRIOR_WEIGHT + same.contributions.reduce((s, c) => s + c.weight, 0)), "M = prior + Σ");
  ok(near(same.probability, probabilityFromWeight(same.weight)), "P from M");
  const swapped = scorePair(rec({ key: "B", sizes: ["1g"] }), base);
  ok(near(swapped.weight, same.weight), "symmetric");

  // 6. Owner behaviours (bible S36.5 / S36.6).
  ok(same.band === "strong", "same vendor + verified strain at another size is Strong");
  // A spelling variant ("Gelato #33" vs "gelato 33") that the alias-aware
  // resolver mapped to ONE kb_strains slug arrives here as the same strain.
  const variant = scorePair(rec({ name: "Gelato #33 3.5g", strain: "gelato-33" }), rec({ key: "B", name: "gelato 33 1g", strain: "gelato-33", sizes: ["1g"] }));
  ok(variant.band === "strong", "spelling variant resolved to one slug scores Strong");
  ok(field(variant, "strain").note === "same strain (verified)", "...and says so");
  // Boundaries are inclusive, and BOTH sides must be verified for the verified level.
  const oneVerified = scorePair(base, rec({ key: "B", strainVerified: false, sizes: ["1g"] }));
  ok(field(oneVerified, "strain").note === "same strain name (not verified)", "one unverified side scores the unverified level");
  ok(field(scorePair(base, rec({ key: "B", thcPct: 29, sizes: ["1g"] })), "thc").agree === true, "THC exactly 5 points apart agrees (inclusive)");
  ok(field(scorePair(base, rec({ key: "B", thcPct: 29.5, sizes: ["1g"] })), "thc").agree === false, "THC 5.5 points apart disagrees");
  ok(field(scorePair(base, rec({ key: "B", pricePerGramMinor: 2000, sizes: ["1g"] })), "pricePerGram").agree === true, "price per gram exactly 2x agrees (inclusive)");
  ok(field(scorePair(base, rec({ key: "B", pricePerGramMinor: 2001, sizes: ["1g"] })), "pricePerGram").agree === false, "price per gram over 2x disagrees");
  const twoVendors = scorePair(
    rec({ vendor: "acme farms", brand: "acme", strainVerified: false, strain: "blue dream" }),
    rec({ key: "B", vendor: "zen growers", brand: "zen", strainVerified: false, strain: "blue dream", sizes: ["1g"] }),
  );
  ok(twoVendors.probability < BAND_LIKELY, "two vendors, same card name: below Likely");
  const twoVendorsVerified = scorePair(rec({ vendor: "acme farms", brand: "acme" }), rec({ key: "B", vendor: "zen growers", brand: "zen", sizes: ["1g"] }));
  ok(twoVendorsVerified.probability < BAND_LIKELY, "two vendors + brands, same VERIFIED strain: below Likely");
  // Upper bound: every other field at its best agreeing level, vendor disagreeing.
  const best = (lv: Record<string, Level>) => Math.max(...Object.values(lv).map(levelWeight));
  const maxWithVendorDisagree =
    PRIOR_WEIGHT +
    levelWeight(FIELD_WEIGHTS.vendor.disagree) +
    (Object.keys(FIELD_WEIGHTS) as MatchField[]).filter((f) => f !== "vendor").reduce((s, f) => s + best(FIELD_WEIGHTS[f] as Record<string, Level>), 0);
  ok(probabilityFromWeight(maxWithVendorDisagree) < BAND_STRONG, "ANY vendor disagreement can never reach Strong");
  const sameSize = scorePair(base, rec({ key: "B" }));
  ok(field(sameSize, "sizes").weight < 0 && sameSize.weight < same.weight, "same size twice subtracts");
  ok(field(sameSize, "sizes").note === "same size twice", "...and says so");
  const otherMarket = scorePair(base, rec({ key: "B", market: "medical", sizes: ["1g"] }));
  ok(otherMarket.weight < same.weight - 7, "different market subtracts heavily");

  // 7. Grouping.
  const A = base;
  const B = rec({ key: "B", sizes: ["1g"] });
  const C = rec({ key: "C", sizes: ["7g"] });
  const g1 = groupByScore([A, B, C]);
  ok(g1.length === 1 && g1[0].keys.join() === "A,B,C" && g1[0].band === "strong", "three sizes of one product: one Strong group");
  ok(g1[0].pairs.length === 3, "a group carries every member pair");
  const M = rec({ key: "M", market: "medical", sizes: ["1g"] });
  const gm = groupByScore([A, M]);
  ok(gm.length === 0, "different market never groups");
  const gm3 = groupByScore([A, B, rec({ key: "M", market: "medical", sizes: ["7g"] })]);
  ok(gm3.length === 1 && !gm3[0].keys.includes("M"), "a medical card is never pulled into an adult group");
  // A rejected pair (A,C) is excluded from the larger group even though A-B and B-C are Strong.
  const rejected = new Map([[pairId("A", "C"), pairFingerprint(A, C)]]);
  const sup: GroupOptions = { isSuppressed: (x, y, fp) => rejected.get(pairId(x.key, y.key)) === fp };
  const g2 = groupByScore([A, B, C], sup);
  ok(g2.every((g) => !(g.keys.includes("A") && g.keys.includes("C"))), "a rejected pair is excluded from a larger group");
  ok(g2.length === 1 && g2[0].keys.length === 2, "...the rest still groups");
  // Changing one critical attribute (C's sizes) re-opens it.
  const C2 = rec({ key: "C", sizes: ["7g", "14g"] });
  ok(pairFingerprint(A, C2) !== pairFingerprint(A, C), "changing a size changes the fingerprint");
  const g3 = groupByScore([A, B, C2], sup);
  ok(g3.length === 1 && g3[0].keys.join() === "A,B,C", "changing one critical attribute re-opens it");
  for (const [f, v] of [["vendor", "x"], ["brand", "x"], ["strain", "x"], ["market", "medical"]] as const) {
    ok(pairFingerprint(A, rec({ key: "C", sizes: ["7g"], [f]: v })) !== pairFingerprint(A, C), `fingerprint covers ${f}`);
  }
  ok(pairFingerprint(A, rec({ key: "C", sizes: ["7g"], thcPct: 30, name: "renamed" })) === pairFingerprint(A, C), "non-critical changes keep the fingerprint");
  ok(pairFingerprint(A, C) === pairFingerprint(C, A), "fingerprint is order-free");
  ok(pairFingerprint(A, rec({ key: "C", sizes: ["7g", "7g"] })) === pairFingerprint(A, C), "duplicate sizes do not change the fingerprint");
  // Likely / Review pass: a card alone forms one pair with its best partner.
  const L1 = rec({ key: "L1", strainVerified: false, strain: "gmo", strainType: null, thcPct: null, pricePerGramMinor: null });
  const L2 = rec({ key: "L2", strainVerified: false, strain: "gmo", strainType: null, thcPct: null, pricePerGramMinor: null, sizes: ["1g"] });
  const gl = groupByScore([L1, L2]);
  ok(gl.length === 1 && gl[0].band !== "strong" && gl[0].band === bandFor(gl[0].headline.score.probability), "a non-Strong pair is still proposed with its band");
  const H1 = rec({ key: "H1", vendor: "a", brand: "a", strain: "x", strainVerified: false });
  const H2 = rec({ key: "H2", vendor: "b", brand: "b", strain: "y", strainVerified: false });
  ok(groupByScore([H1, H2]).length === 0, "a hidden pair (< 0.5) is not proposed");
  // Three cards that are all Review/Likely with each other: one pair only, never a card in two suggestions.
  const L3 = rec({ key: "L3", strainVerified: false, strain: "gmo", strainType: null, thcPct: null, pricePerGramMinor: null, sizes: ["7g"] });
  const gLR = groupByScore([L1, L2, L3]);
  const seenKeys = gLR.flatMap((g) => g.keys);
  ok(gLR.length === 1 && new Set(seenKeys).size === seenKeys.length, "Likely/Review pass: a card joins at most one suggestion");
  // The headline is the weakest member pair.
  const g4 = groupByScore([A, B, rec({ key: "C", sizes: ["7g"], thcPct: null })]);
  ok(g4[0].headline.score.weight === Math.min(...g4[0].pairs.map((p) => p.score.weight)), "headline is the weakest pair");

  // 8. Blocking.
  const cp = candidatePairs([
    rec({ key: "1", vendor: "v1", brand: "b1" }),
    rec({ key: "2", vendor: "v1", brand: "b2" }),
    rec({ key: "3", vendor: "", brand: "b1" }),
    rec({ key: "4", vendor: "v2", brand: "b3" }),
    rec({ key: "5", vendor: "v1", brand: "b1", family: "vape" }),
  ]);
  const ids = cp.pairs.map(([x, y]) => [x.key, y.key].sort().join("-")).sort();
  ok(ids.join() === "1-2,1-3", "blocks: vendor+family, plus brand+family fallback, deduped, never across family");
  ok(candidatePairs([rec({ key: "1" }), rec({ key: "2" }), rec({ key: "3" })], 2).skippedBlocks === 2, "oversized blocks skipped and counted");

  // 9. Keys, parsing, evidence.
  ok(orderPairKeys("b", "a")?.join() === "a,b" && orderPairKeys("a", "a") === null, "pair keys ordered; self-pair refused");
  ok(compareKeys("A-1", "a1") < 0 && compareKeys("ab", "a") > 0 && compareKeys("x", "x") === 0, "code-point order (collate C)");
  ok(compareKeys("B", "a") < 0 && compareKeys("Z", "a") < 0 && compareKeys("a", "B") > 0, "upper case sorts before lower case (byte order, not locale)");
  ok(parseThcPercent("24.5%") === 24.5 && parseThcPercent(" 9 % ") === 9, "THC % parsed");
  ok(parseThcPercent("100mg") === null && parseThcPercent("20-25%") === null && parseThcPercent("140%") === null && parseThcPercent(null) === null, "THC non-% refused");
  ok(canonicalStrainTypeForMatch("Indica Hybrid") === "indica-hybrid" && canonicalStrainTypeForMatch("unknown") === null && canonicalStrainTypeForMatch("") === null, "strain type canonicalised");
  ok(normalizeSizeLabel(" 3.5 G ") === "3.5g", "size label normalised");
  const grams = (l: string) => (l === "1g" ? 1 : l === "3.5g" ? 3.5 : null);
  ok(lowestPricePerGram([{ label: "1g", priceMinor: 1200 }, { label: "3.5g", priceMinor: 3500 }, { label: "each", priceMinor: 1 }], grams) === 1000, "lowest price per gram over weighed sizes");
  ok(lowestPricePerGram([{ label: "each", priceMinor: 500 }], grams) === null && lowestPricePerGram([{ label: "1g", priceMinor: 0 }], grams) === null, "no weighed priced size -> null");
  const ev = evidenceForGroup(g1[0]);
  ok(ev.v === 1 && ev.band === "strong" && ev.pairs.length === 3 && ev.contributions.length === 9, "evidence carries band, every pair, the waterfall");
  ok(JSON.stringify(readEvidence(JSON.parse(JSON.stringify(ev)))) === JSON.stringify(ev), "evidence round-trips");
  ok(readEvidence({ ...ev, v: 2 }) === null && readEvidence({ ...ev, v: undefined }) === null, "an unknown evidence version reads as null");
  ok(readEvidence(null) === null && readEvidence({ v: 2 }) === null && readEvidence({ ...ev, band: "hidden" }) === null && readEvidence({ ...ev, contributions: "x" }) === null, "bad evidence reads as null");
  ok(bandBadgeText("strong", 0.973) === "Strong · 97%" && bandBadgeText("review", 0.5) === "Review · 50%", "badge text");
  ok(contributionText({ weight: 3.14, note: "same vendor" }) === "+3.1 same vendor", "waterfall +");
  ok(contributionText({ weight: -4.04, note: "different market" }) === "\u22124.0 different market", "waterfall −");
  ok(contributionText({ weight: 0, note: "THC unknown" }) === "±0 THC unknown", "waterfall 0");

  // 10. Rationale + pre-0243 error detection.
  ok(rationaleFromScore(same.contributions).startsWith("Same vendor, same brand, same strain (verified)"), "rationale lists agreements");
  ok(rationaleFromScore(sameSize.contributions).endsWith("; but same size twice."), "rationale names the opposing evidence");
  ok(rationaleFromScore([]) === "Not enough facts to compare.", "rationale with nothing");
  ok(rationaleFromScore([{ field: "market", agree: false, weight: -7, note: "different market" }]) === "Different market.", "rationale with only opposing");
  ok(isMissingPairDecisionsTable({ code: "PGRST205", message: "Could not find the table 'public.product_master_pair_decisions' in the schema cache" }), "PGRST205 pair table");
  ok(isMissingPairDecisionsTable({ code: "42P01", message: 'relation "public.product_master_pair_decisions" does not exist' }), "42P01 pair table");
  ok(!isMissingPairDecisionsTable({ code: "42P01", message: 'relation "public.product_master_pair_decisions_v2" does not exist' }), "word-bounded table");
  ok(!isMissingPairDecisionsTable({ code: "23505", message: "duplicate key product_master_pair_decisions_pkey" }), "a real error is not 'missing'");
  ok(!isMissingPairDecisionsTable(null), "null error");
  ok(isMissingEvidenceColumn({ code: "PGRST204", message: "Could not find the 'evidence_json' column of 'product_master_suggestions' in the schema cache" }), "PGRST204 evidence column");
  ok(isMissingEvidenceColumn({ code: "42703", message: 'column "evidence_json" of relation "product_master_suggestions" does not exist' }), "42703 evidence column");
  ok(!isMissingEvidenceColumn({ code: "42703", message: 'column "evidence_json_old" does not exist' }), "word-bounded column");
  ok(!isMissingEvidenceColumn({ code: "42703", message: 'column "confidence" does not exist' }), "another column is not ours");
  ok(!isMissingEvidenceColumn(undefined), "undefined error");

  return { passed, failed };
}

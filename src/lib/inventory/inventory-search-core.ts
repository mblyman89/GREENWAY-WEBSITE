/**
 * src/lib/inventory/inventory-search-core.ts  (SLICE 13)
 *
 * FORGIVING search for the back-office inventory list.
 *
 * THE DEFECT THIS CLOSES (owner-reported)
 * -----------------------------------------------------------------------
 * "I tried typing something in and couldn't find it, and it only found it
 *  when I very specifically used the product's name exactly."
 *
 * The old search was one PostgREST predicate (store.ts, pre-slice-13):
 *
 *     product_name.ilike.%<the whole phrase>%,
 *     lot_code.ilike.%<the whole phrase>%,
 *     pos_product_key.ilike.%<the whole phrase>%
 *
 * Three separate reasons that finds nothing:
 *
 *   1. THE WHOLE PHRASE HAD TO APPEAR CONTIGUOUSLY. "gummies guava" cannot
 *      match "Cantina Gummies - Guava 10 Pack" because the characters
 *      "gummies guava" never appear in that order with nothing between them.
 *   2. ONLY THREE COLUMNS WERE SEARCHED. Strain, brand, vendor, category,
 *      inventory type and notes were invisible to search entirely, so typing
 *      a brand name returned zero rows even though the brand was on screen.
 *   3. NO TYPO TOLERANCE AT ALL. `ilike` is exact-substring; "blue dreem"
 *      matched nothing.
 *
 * WHAT THIS MODULE DOES INSTEAD
 * -----------------------------------------------------------------------
 *   • Splits the query into TOKENS and requires EVERY token to be satisfied
 *     by SOME field (an AND across tokens, an OR across fields). Word order
 *     stops mattering, and each extra word narrows the result the way a
 *     person expects.
 *   • Each token is satisfied by, in descending order of confidence:
 *     an exact field equality, a prefix, a substring, a per-word prefix
 *     (so "choc" finds "Chocolate"), or a fuzzy near-match for typos.
 *   • Scores the row so the best guesses sort to the top. The owner asked
 *     for "the system's best guess rather than showing me nothing".
 *
 * WHY NOT REUSE `normalizeStrainQuery` FROM ai/kb/strain-matcher.ts
 * -----------------------------------------------------------------------
 * Because it is deliberately DESTRUCTIVE, and measurably wrong for this job.
 * It exists to reduce a product name to a bare strain name, so it strips
 * weights, pack counts, percentages and a 50-word FORM_WORDS list that
 * includes "gummies", "chocolate", "preroll", "cart", "resin".
 *
 * Measured (scripts/slice13/probe-similarity.ts):
 *
 *     "Cantina Gummies - Guava 10 Pack 400mg"  ->  "cantina guava"
 *     query "400mg"    scores 0.000
 *     query "chocolat" scores 0.089
 *
 * Reusing it would have reproduced the owner's bug in a new place. So this
 * module reuses the pure METRICS from that file (`similarity`,
 * `diceCoefficient`, `levenshteinRatio`) — which are content-agnostic and
 * correct — behind a LOSSLESS normalizer that keeps every meaningful token.
 *
 * PURE: no I/O, no React, no server-only. Self-tests at the bottom are
 * registered in the pure self-test runner.
 */
import { diceCoefficient, levenshteinRatio } from "@/lib/ai/kb/strain-matcher";

/**
 * THE TYPO THRESHOLD, AND WHY SEARCH IS TWO-TIERED
 * -----------------------------------------------------------------------
 * Measured with scripts/slice13/probe-threshold.ts, using this module's own
 * blend (0.5*dice + 0.5*levenshteinRatio):
 *
 *     dreem ~ dream = 0.6500      <- a typo we MUST catch
 *     resin ~ rosin = 0.6500      <- two REAL, different products
 *     grape ~ grope = 0.6500      <- two real, different words
 *
 * Identical scores, because all three are one character substitution. No
 * string metric can separate them: the difference is not in the strings, it
 * is that "dreem" is not a thing anyone stocks and "rosin" is. A single
 * global threshold therefore cannot be correct. Set it high and real typos
 * are thrown away; set it low and a search for "resin" silently returns
 * ROSIN — the wrong product, with nothing on screen to say so. Quietly
 * showing the wrong product is worse than showing nothing.
 *
 * So the fuzzy allowance is not applied alongside strict matching; it is a
 * SECOND PASS that only runs when the strict pass found nothing at all
 * (see `searchInventoryRows`). That makes precision a non-issue by
 * construction: if there is no resin in the building, offering rosin is help,
 * not contamination — and the caller is told the result set is a guess so the
 * UI can label it.
 *
 * With that structure the threshold only has to clear the true-positive
 * floor. Measured floor is 0.5857 ("gummies" ~ "gummy"); the closest
 * non-typo pair underneath is "live" ~ "love" at 0.5417. 0.58 sits between
 * them, admitting every measured typo and excluding live/love, cart/cake,
 * kush/hash, lemon/melon, mint/mango and indica/sativa.
 */
export const FUZZY_TOKEN_THRESHOLD = 0.58;

/**
 * Tokens shorter than this are never fuzzy-matched. At 1-2 characters almost
 * every short word is within one edit of every other ("og" vs "oz"), so a
 * typo allowance there produces noise rather than help. Short tokens still
 * match exactly, by prefix and by substring.
 */
export const FUZZY_MIN_TOKEN_LENGTH = 4;

/** How a single query token was satisfied, best first. */
export type TokenMatchKind = "exact" | "prefix" | "word-prefix" | "substring" | "fuzzy";

/**
 * Score contributed by each kind of match. Ordering is what matters: an exact
 * field hit must always outrank a fuzzy one, so a budtender who types a lot
 * code in full sees that lot first and the near-misses underneath.
 */
export const TOKEN_MATCH_SCORE: Record<TokenMatchKind, number> = {
  exact: 1,
  prefix: 0.9,
  "word-prefix": 0.8,
  substring: 0.7,
  fuzzy: 0.5,
};

/**
 * Lossless normalization: lowercase, turn punctuation into spaces, collapse
 * runs of whitespace. NOTHING is removed — no weights, no pack counts, no
 * form words — because in a product list those ARE the things people search
 * for ("100mg", "10 pack", "gummies").
 *
 * Punctuation becomes a space rather than being deleted so that "GG#4" reads
 * as two tokens "gg" and "4", which is how someone typing "gg 4" expects it
 * to behave.
 */
export function normalizeSearchText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bare alphanumerics, no spaces. Lets "gg4" match "GG #4" and "3.5g" match
 * "3 5 g" — the glue-insensitive comparison.
 */
export function squashSearchText(raw: string | null | undefined): string {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Split a query into normalized tokens. Empty/blank input yields no tokens. */
export function searchTokens(raw: string | null | undefined): string[] {
  const norm = normalizeSearchText(raw);
  return norm ? norm.split(" ") : [];
}

/** One searchable field of a row: its text, and how much that field counts. */
export type SearchField = {
  /** Raw field text (normalized internally). */
  text: string | null | undefined;
  /**
   * Field importance. A hit in the product name should beat a hit in the
   * notes, so a rummage through free text never outranks the real thing.
   */
  weight: number;
};

/**
 * Decide whether ONE token is present in ONE field, and how strongly.
 * Returns null when the token is absent from this field.
 *
 * The ladder, strongest first. NOTE the order of the checks below must match
 * the order of TOKEN_MATCH_SCORE, or a weaker kind would shadow a stronger
 * one. In particular `word-prefix` is tested BEFORE `substring`: "choc" hits
 * the START of the word "chocolate", which is a better signal than a token
 * landing in the middle of a word, and it scores higher accordingly. Checking
 * substring first (the first draft of this function) silently classified every
 * word-prefix as a substring and the higher score was unreachable.
 *
 *   exact        — the whole field is the token ("indica")
 *   prefix       — the field starts with the token ("blue" in "blue dream")
 *   word-prefix  — some WORD starts with the token ("choc" -> "chocolate")
 *   substring    — the token appears anywhere ("ream" in "blue dream"), also
 *                  checked against the glue-free form so "gg4" hits "GG #4"
 *   fuzzy        — some word is within the typo threshold ("dreem" -> "dream")
 */
export function scoreTokenInField(
  token: string,
  fieldText: string,
  allowFuzzy = true,
): TokenMatchKind | null {
  // A blank token must never match. `!token` alone catches "" but NOT " ",
  // and a single-space token would otherwise sail through the substring rung
  // below and report a match against every field containing a space \u2014 i.e.
  // nearly the whole shelf. searchTokens() never emits a blank today
  // (measured: scripts/slice13/probe-token-whitespace.ts, 26 hostile inputs,
  // zero blank tokens), but this function is EXPORTED and must be safe for
  // callers that have not been written yet.
  if (!token.trim() || !fieldText) return null;
  if (fieldText === token) return "exact";
  if (fieldText.startsWith(token)) return "prefix";

  const words = fieldText.split(" ").filter(Boolean);
  for (const w of words) {
    if (w.startsWith(token)) return "word-prefix";
  }

  // NOTE ON MUTATION TESTING. Deleting the next line alone does not change
  // this function's output for ANY token containing a real character: the
  // glue-free check below subsumes it, because squashing spaces out of both
  // sides can only make the match easier. Verified exhaustively over every
  // (field, token) pair on the alphabet {a, b, space} up to lengths 5 and 4 \u2014
  // 44,044 pairs, 804 disagreements, ALL of them whitespace-only tokens,
  // which the guard above now refuses (scripts/slice13/probe-substring-
  // subsumption.ts). The line is kept because it states the plain intent and
  // avoids two string allocations on the common path, not because it is
  // load-bearing. Its mutant is EQUIVALENT, not a test gap \u2014 proven, not
  // assumed.
  if (fieldText.includes(token)) return "substring";
  // Glue-insensitive: "gg4" against "gg 4", "3.5g" against "3 5 g".
  const squashedField = fieldText.replace(/ /g, "");
  const squashedToken = token.replace(/ /g, "");
  if (squashedToken && squashedField.includes(squashedToken)) return "substring";

  // Typos last, and only in the fallback pass (see FUZZY_TOKEN_THRESHOLD),
  // and only for tokens long enough for a typo to be meaningful.
  if (allowFuzzy && token.length >= FUZZY_MIN_TOKEN_LENGTH) {
    for (const w of words) {
      if (w.length < FUZZY_MIN_TOKEN_LENGTH) continue;
      const sim = 0.5 * diceCoefficient(token, w) + 0.5 * levenshteinRatio(token, w);
      if (sim >= FUZZY_TOKEN_THRESHOLD) return "fuzzy";
    }
  }
  return null;
}

/** The outcome of scoring one row against one query. */
export type SearchVerdict = {
  /** True when EVERY token was satisfied by at least one field. */
  matched: boolean;
  /** Relevance, higher is better. 0 when `matched` is false. */
  score: number;
  /** True when no fuzzy allowance was needed for any token. */
  exactOnly: boolean;
};

/**
 * Score a row (given as its searchable fields) against a raw query.
 *
 * EVERY token must be found in SOME field. That AND-across-tokens rule is what
 * makes word order irrelevant while keeping extra words meaningful: "gummies
 * guava" matches "Cantina Gummies - Guava 10 Pack" because each word is found
 * somewhere, and "gummies zebra" does not, because "zebra" is nowhere.
 *
 * An empty query matches everything with score 0 — "no filter", not "no rows".
 */
export function scoreRowAgainstQuery(
  fields: SearchField[],
  rawQuery: string,
  allowFuzzy = true,
): SearchVerdict {
  const tokens = searchTokens(rawQuery);
  if (tokens.length === 0) return { matched: true, score: 0, exactOnly: true };

  const prepared = fields
    .map((f) => ({ text: normalizeSearchText(f.text), weight: f.weight }))
    .filter((f) => f.text.length > 0);
  if (prepared.length === 0) return { matched: false, score: 0, exactOnly: false };

  let total = 0;
  let usedFuzzy = false;
  for (const token of tokens) {
    let best = 0;
    let bestKind: TokenMatchKind | null = null;
    for (const field of prepared) {
      const kind = scoreTokenInField(token, field.text, allowFuzzy);
      if (!kind) continue;
      const value = TOKEN_MATCH_SCORE[kind] * field.weight;
      if (value > best) {
        best = value;
        bestKind = kind;
      }
    }
    // One unsatisfied token disqualifies the row. This is the AND.
    if (bestKind === null) return { matched: false, score: 0, exactOnly: false };
    if (bestKind === "fuzzy") usedFuzzy = true;
    total += best;
  }
  // Average per token so a long query is not automatically "more relevant"
  // than a short one; relevance is about quality of fit, not query length.
  return { matched: true, score: total / tokens.length, exactOnly: !usedFuzzy };
}

/** One row paired with the fields that should be searched on it. */
export type SearchableRow<T> = {
  row: T;
  fields: SearchField[];
};

/** The outcome of searching a whole list. */
export type SearchOutcome<T> = {
  /** Matching rows, most relevant first. */
  rows: T[];
  /**
   * True when the strict pass found nothing and these results come from the
   * typo-tolerant fallback. The UI MUST say so — the owner needs to know the
   * screen is showing a best guess rather than a literal match, otherwise a
   * search for "resin" that quietly returned rosin would be indistinguishable
   * from the truth.
   */
  didYouMean: boolean;
};

/**
 * THE TWO-TIER SEARCH.
 *
 * Pass 1 is strict: exact / prefix / word-prefix / substring. No typo
 * allowance, so a real word can never drift to a different real word
 * ("resin" stays resin, never rosin).
 *
 * Pass 2 runs ONLY if pass 1 matched nothing, and turns the typo allowance
 * on. This is the owner's "help me even if I make a mistake" requirement,
 * delivered in the one situation where a guess cannot displace a correct
 * answer: when there is no correct answer to displace.
 *
 * Stable ordering: rows are sorted by score descending, and ties keep their
 * original relative order (the caller's sort), so search relevance never
 * scrambles a deliberate column sort among equally-relevant rows.
 */
export function searchInventoryRows<T>(
  items: SearchableRow<T>[],
  rawQuery: string,
): SearchOutcome<T> {
  const tokens = searchTokens(rawQuery);
  if (tokens.length === 0) return { rows: items.map((i) => i.row), didYouMean: false };

  const run = (allowFuzzy: boolean) => {
    const hits: { row: T; score: number; index: number }[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item) continue;
      const verdict = scoreRowAgainstQuery(item.fields, rawQuery, allowFuzzy);
      if (verdict.matched) hits.push({ row: item.row, score: verdict.score, index: i });
    }
    // Descending score; original order breaks ties (stable).
    hits.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    return hits.map((h) => h.row);
  };

  const strict = run(false);
  if (strict.length > 0) return { rows: strict, didYouMean: false };

  const fuzzy = run(true);
  return { rows: fuzzy, didYouMean: fuzzy.length > 0 };
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runInventorySearchCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL inventory-search-core: " + msg);
    passed += 1;
  };

  // ---- normalization is LOSSLESS (the whole point vs normalizeStrainQuery)
  ok(normalizeSearchText("Blue Dream 3.5g") === "blue dream 3 5g", "normalize keeps the weight");
  ok(
    normalizeSearchText("Cantina Gummies - Guava 10 Pack 400mg") ===
      "cantina gummies guava 10 pack 400mg",
    "normalize keeps gummies/pack/mg — the words strain-matcher destroys",
  );
  ok(normalizeSearchText("  ") === "", "normalize blank yields empty");
  ok(normalizeSearchText(null) === "", "normalize null yields empty");
  ok(normalizeSearchText("GG#4") === "gg 4", "punctuation becomes a space");
  ok(squashSearchText("GG #4") === "gg4", "squash removes glue");

  ok(searchTokens("blue dream").length === 2, "tokens split on space");
  ok(searchTokens("").length === 0, "empty query yields no tokens");
  ok(searchTokens("  -- ").length === 0, "punctuation-only query yields no tokens");

  // ---- the token ladder
  ok(scoreTokenInField("indica", "indica") === "exact", "exact whole-field");
  ok(scoreTokenInField("blue", "blue dream") === "prefix", "prefix");
  // "dream" starts the SECOND word, so it is a word-prefix — a better signal
  // than a mid-word substring, and it must be reported as the stronger kind.
  ok(scoreTokenInField("dream", "blue dream") === "word-prefix", "second word start is a word-prefix");
  ok(scoreTokenInField("ream", "blue dream") === "substring", "mid-word hit is a substring");
  ok(scoreTokenInField("choc", "dark chocolate bar") === "word-prefix", "word-prefix finds chocolate");
  // Ordering guard: the ladder must be checked in score order, or a weaker
  // kind shadows a stronger one and the higher score becomes unreachable.
  ok(
    TOKEN_MATCH_SCORE["word-prefix"] > TOKEN_MATCH_SCORE.substring,
    "word-prefix must outscore substring",
  );
  ok(
    TOKEN_MATCH_SCORE.exact > TOKEN_MATCH_SCORE.prefix &&
      TOKEN_MATCH_SCORE.prefix > TOKEN_MATCH_SCORE["word-prefix"] &&
      TOKEN_MATCH_SCORE.substring > TOKEN_MATCH_SCORE.fuzzy,
    "the score ladder is strictly descending",
  );
  ok(scoreTokenInField("dreem", "blue dream") === "fuzzy", "typo tolerated when fuzzy allowed");
  ok(scoreTokenInField("dreem", "blue dream", false) === null, "strict pass refuses the typo");
  ok(scoreTokenInField("zebra", "blue dream") === null, "unrelated token absent");
  ok(scoreTokenInField("gg4", "gg 4 preroll") === "substring", "glue-insensitive gg4");
  ok(scoreTokenInField("", "blue dream") === null, "empty token matches nothing");
  ok(scoreTokenInField("blue", "") === null, "empty field matches nothing");
  // Short tokens never fuzzy-match: "og" must not become "oz".
  ok(scoreTokenInField("oz", "og kush") === null, "2-char token does not fuzzy match");

  const F = (text: string, weight = 1): SearchField => ({ text, weight });

  // ---- THE OWNER'S BUG: order-independent multi-word search
  const cantina = [F("Cantina Gummies - Guava 10 Pack 400mg", 1)];
  ok(scoreRowAgainstQuery(cantina, "gummies guava").matched, "reordered words match (the reported bug)");
  ok(scoreRowAgainstQuery(cantina, "guava gummies").matched, "either order matches");
  ok(scoreRowAgainstQuery(cantina, "guava").matched, "a middle word alone matches");
  ok(scoreRowAgainstQuery(cantina, "400mg").matched, "a weight token matches (strain-matcher scored 0)");
  ok(scoreRowAgainstQuery(cantina, "gummies zebra").matched === false, "every token must be found (AND)");

  // ---- typos
  ok(scoreRowAgainstQuery([F("Blue Dream 3.5g")], "blue dreem").matched, "typo still finds the lot");
  ok(scoreRowAgainstQuery([F("Wedding Cake Live Rosin")], "weding cake").matched, "missing letter tolerated");

  // ---- THE TWO-TIER GUARANTEE (see FUZZY_TOKEN_THRESHOLD)
  // "resin" and "rosin" are one edit apart and score exactly as high as the
  // real typo "dreem"/"dream" (measured 0.6500 for both). The tiering — not
  // the threshold — is what keeps them apart.
  const shelf: SearchableRow<string>[] = [
    { row: "live-resin", fields: [F("Live Resin Cartridge")] },
    { row: "live-rosin", fields: [F("Wedding Cake Live Rosin")] },
  ];
  const resinHit = searchInventoryRows(shelf, "resin");
  ok(resinHit.rows.length === 1, "searching resin returns exactly one row");
  ok(resinHit.rows[0] === "live-resin", "searching resin returns RESIN, never rosin");
  ok(resinHit.didYouMean === false, "a strict hit is not flagged as a guess");
  const rosinHit = searchInventoryRows(shelf, "rosin");
  ok(rosinHit.rows.length === 1 && rosinHit.rows[0] === "live-rosin", "rosin returns rosin");

  // The fallback opens only when strict found NOTHING, and says it is a guess.
  const typo = searchInventoryRows(
    [{ row: "blue", fields: [F("Blue Dream 3.5g")] }],
    "blue dreem",
  );
  ok(typo.rows.length === 1 && typo.rows[0] === "blue", "typo falls back to the near match");
  ok(typo.didYouMean === true, "the fallback is disclosed as a guess");

  // A query that matches nothing at all matches nothing — no desperate guess.
  const nothing = searchInventoryRows([{ row: "a", fields: [F("Blue Dream")] }], "xyzzy");
  ok(nothing.rows.length === 0, "an unrelated query returns no rows");
  ok(nothing.didYouMean === false, "no rows means no did-you-mean claim");

  // Empty query returns EVERY row, in the caller's order, unflagged.
  const all = searchInventoryRows(
    [{ row: 1, fields: [F("a")] }, { row: 2, fields: [F("b")] }],
    "",
  );
  ok(all.rows.length === 2 && all.rows[0] === 1, "empty query preserves order and keeps all rows");
  ok(all.didYouMean === false, "empty query is not a guess");

  // Relevance ordering: the better match comes first even when listed second.
  const ranked = searchInventoryRows(
    [
      { row: "partial", fields: [F("Dream Weaver Preroll")] },
      { row: "best", fields: [F("Blue Dream")] },
    ],
    "blue dream",
  );
  ok(ranked.rows[0] === "best", "the stronger match sorts first");
  ok(ranked.rows.length === 1, "a row missing a token is excluded, not merely ranked lower");

  // Ties keep the caller's order — search must not scramble a column sort.
  const tied = searchInventoryRows(
    [
      { row: "first", fields: [F("Blue Dream")] },
      { row: "second", fields: [F("Blue Dream")] },
    ],
    "blue dream",
  );
  ok(tied.rows[0] === "first" && tied.rows[1] === "second", "equal scores keep original order");

  // ---- empty query is "no filter", never "no rows"
  const empty = scoreRowAgainstQuery([F("anything")], "");
  ok(empty.matched && empty.score === 0, "empty query matches everything at score 0");
  ok(scoreRowAgainstQuery([F("anything")], "   ").matched, "whitespace query matches everything");

  // ---- a row with no searchable text cannot match a real query
  ok(scoreRowAgainstQuery([F(""), F(null as unknown as string)], "blue").matched === false, "no text, no match");

  // ---- a BLANK token matches nothing (found by mutation testing)
  // Before this guard, scoreTokenInField(" ", "blue dream") returned
  // "substring", because " " really is a substring of almost every product
  // name. Unreachable through searchTokens today, but this is exported.
  ok(scoreTokenInField(" ", "blue dream") === null, "a single-space token matches nothing");
  ok(scoreTokenInField("  ", "blue dream") === null, "a multi-space token matches nothing");
  ok(scoreTokenInField("\t", "blue dream") === null, "a tab token matches nothing");
  ok(scoreTokenInField("", "blue dream") === null, "an empty token matches nothing");
  // And the tokenizer genuinely never produces one, which is why the rung
  // below the guard is an equivalent mutant rather than an untested branch.
  for (const raw of ["", "   ", "\t\n", "---", ",,,", "blue   dream", "()[]{}"]) {
    ok(
      searchTokens(raw).every((t) => t.trim() !== ""),
      `searchTokens(${JSON.stringify(raw)}) emits no blank token`,
    );
  }
  ok(scoreRowAgainstQuery([], "blue").matched === false, "no fields, no match");

  // ---- ranking: exact beats fuzzy, and weight is respected
  const exact = scoreRowAgainstQuery([F("blue dream")], "blue dream");
  const fuzzy = scoreRowAgainstQuery([F("blue dreem")], "blue dream");
  ok(exact.score > fuzzy.score, "an exact hit outranks a typo hit");
  ok(exact.exactOnly === true, "exact match reports exactOnly");
  ok(fuzzy.exactOnly === false, "fuzzy match reports not-exactOnly");
  const heavy = scoreRowAgainstQuery([F("blue dream", 3)], "dream");
  const light = scoreRowAgainstQuery([F("blue dream", 1)], "dream");
  ok(heavy.score > light.score, "field weight raises the score");

  // ---- cross-field AND: one token from the name, one from the brand
  const twoFields = [F("Blue Dream 3.5g", 3), F("Fweedom Farms", 2)];
  ok(scoreRowAgainstQuery(twoFields, "dream fweedom").matched, "tokens may come from different fields");
  ok(scoreRowAgainstQuery(twoFields, "dream missing").matched === false, "a token in no field fails the row");

  // ---- score is an average, so adding a matching word does not inflate it
  const one = scoreRowAgainstQuery([F("blue dream")], "blue");
  const two = scoreRowAgainstQuery([F("blue dream")], "blue dream");
  ok(two.score <= 1.0001 && one.score <= 1.0001, "scores stay bounded by the best single-token value");

  console.log(`inventory-search-core: ${passed} assertions passed`);
}

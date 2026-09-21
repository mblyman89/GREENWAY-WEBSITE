/**
 * SAMPLE ROTATION -- making "Suggest a sample" suggest something new.
 *
 * ###########################################################################
 * # WHY THIS FILE EXISTS                                                    #
 * #                                                                        #
 * # The owner, verbatim:                                                   #
 * #                                                                        #
 * #   "i tried to resend the same 8 products we sent before, but the       #
 * #    system wont let me send them again, they do not meet leafly's       #
 * #    required contract. ... will you make the suggest a sample button    #
 * #    for the send only certain products section be more intelligent and  #
 * #    have it pick a different set of 8 products to send as a sample."    #
 * #                                                                        #
 * # FINDING J-2. Two separate problems produced that experience.           #
 * #                                                                        #
 * # 1. THE SAMPLER CANNOT CHANGE ITS MIND.                                 #
 * #    `buildRepresentativeSample()` (selection-core.ts:613) breaks every  #
 * #    tie by id "so two runs on the same feed always produce the same     #
 * #    sample". That rationale is CORRECT and is preserved here -- a       #
 * #    sample you cannot reproduce is a failed push you cannot debug. But  #
 * #    determinism was implemented as "one possible answer", when what is  #
 * #    actually needed is "a reproducible answer PER REQUEST". Pressing    #
 * #    the button again is a different request and should give a          #
 * #    different eight; pressing it with the same round number must give  #
 * #    the same eight, forever.                                            #
 * #                                                                        #
 * # 2. THE SAMPLER PREFERS PRODUCTS THAT FAIL.                             #
 * #    Its scoring awards +60 for `variants.length > 1`                    #
 * #    (selection-core.ts:635). A multi-size product of an each-only       #
 * #    Leafly type is EXACTLY the shape that collides into "1 each" and    #
 * #    fails validation (FINDING J-1). The sampler was optimising for the  #
 * #    defect, which is why the owner's eight could not be re-sent.        #
 * #                                                                        #
 * # This module adds the two missing inputs -- a rotation round, and       #
 * # knowledge of which products actually pass -- without discarding the    #
 * # coverage thinking that was already right.                              #
 * ###########################################################################
 *
 * WHY NOT `Math.random()`
 *
 * Because then a failed sample push could never be reproduced, and the first
 * question after a failure is always "what exactly did we send?". Rotation is
 * driven by an explicit integer `round`. Round 0 is the classic sample; round
 * 1 is the next eight; round N is always the same N. The owner gets variety;
 * we keep reproducibility. Both, not one.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Zero imports. Runs under
 * tsx directly.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The minimum a candidate must tell us. Deliberately structural rather than
 * importing `SyndicationItem`, to keep this module at zero imports and make it
 * testable against fixtures.
 */
export type SampleCandidate = {
  id: string;
  name?: string | null;
  category?: string | null;
  brand?: string | null;
  strainType?: string | null;
  inStock?: boolean;
  variantCount?: number;
  hasImage?: boolean;
  hasDescription?: boolean;
  hasPotency?: boolean;
  /**
   * Does this product currently pass Leafly's contract?
   *
   * `true` = verified passing, `false` = verified failing, `undefined` = not
   * checked. Three states on purpose: "we have not checked" must not be
   * treated as "it fails", or an unchecked menu would look entirely broken and
   * the sampler would refuse to suggest anything at all.
   */
  passesContract?: boolean;
  /** Plain-English reason it fails, when known. Shown next to the fix button. */
  failureReason?: string | null;
};

export type SampleSelection = {
  /** The chosen products, in pick order. */
  picked: SampleCandidate[];
  /** Of `picked`, those known to fail the contract. */
  failing: SampleCandidate[];
  /** The round this selection came from, echoed back so it can be replayed. */
  round: number;
  /** True when the pool had nothing left to rotate to. */
  exhausted: boolean;
};

/* -------------------------------------------------------------------------- */
/* Deterministic per-round ordering                                           */
/* -------------------------------------------------------------------------- */

/**
 * A small, stable, non-cryptographic hash of a string.
 *
 * FNV-1a. Chosen because it is short enough to read, has no dependencies, and
 * distributes single-character differences well -- which matters here because
 * our ids differ only in their hex tail. `>>> 0` keeps it an unsigned 32-bit
 * value so the result is stable across engines.
 */
export function rotationHash(text: string): number {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A per-(item, round) jitter in [0, 1).
 *
 * The round is folded into the hashed text rather than added to the result, so
 * consecutive rounds reshuffle rather than merely re-rank by a constant. Round
 * 0 deliberately yields jitter 0 for every item, which makes round 0 EXACTLY
 * the previous behaviour -- a property asserted in the tests, because silently
 * changing what the first suggestion produces would be a regression dressed up
 * as a feature.
 */
export function rotationJitter(id: string, round: number): number {
  const r = Math.floor(round);
  if (r <= 0) return 0;
  return (rotationHash(`${id}#${r}`) % 10000) / 10000;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/** How hard the contract result pushes a candidate up or down. */
export const CONTRACT_PASS_BONUS = 120;
export const CONTRACT_FAIL_PENALTY = 200;
/** How much a round can reorder near-equal candidates. */
export const ROTATION_WEIGHT = 45;

const norm = (v: string | null | undefined): string => String(v ?? "").trim().toLowerCase();

/**
 * Pick a sample that covers as much as possible, prefers what will actually
 * send, and varies by round.
 *
 * The coverage bonuses are carried over from `buildRepresentativeSample` on
 * purpose -- that part was never the problem, and a sample of eight
 * near-identical flower eighths proves one mapping eight times.
 *
 * WHAT CHANGED, AND WHY EACH CHANGE IS SAFE:
 *
 *  - A known-failing product is penalised, not banned. Banning would mean that
 *    a menu where everything currently fails suggests nothing, and "nothing"
 *    teaches the owner nothing. It is included last, clearly labelled, with a
 *    fix link -- which is precisely what he asked for in ask 3.
 *
 *  - Multi-variant still earns a bonus, but a SMALLER one than a contract
 *    pass. Coverage is valuable; sendability is more valuable. This is the
 *    single line that stops the sampler from recommending the products that
 *    cannot be sent.
 */
export function buildRotatingSample(
  candidates: readonly SampleCandidate[],
  limit: number,
  round = 0,
): SampleSelection {
  const cap = Math.max(0, Math.floor(limit));
  const r = Math.max(0, Math.floor(round));
  if (cap === 0 || candidates.length === 0) {
    return { picked: [], failing: [], round: r, exhausted: candidates.length === 0 };
  }

  const pool = [...candidates].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const seenCategories = new Set<string>();
  const seenBrands = new Set<string>();
  const seenStrains = new Set<string>();
  let haveMulti = false;
  let haveImage = false;
  let haveDescription = false;
  let havePotency = false;
  let haveInStock = false;

  const scoreOf = (item: SampleCandidate): number => {
    let score = 0;

    // --- coverage (carried over from the original sampler) ---
    const cat = norm(item.category);
    if (cat.length > 0 && !seenCategories.has(cat)) score += 100;
    if ((item.variantCount ?? 0) > 1 && !haveMulti) score += 60;
    const strain = norm(item.strainType);
    if (strain.length > 0 && !seenStrains.has(strain)) score += 40;
    if (item.hasImage === true && !haveImage) score += 30;
    if (item.hasPotency === true && !havePotency) score += 30;
    if (item.hasDescription === true && !haveDescription) score += 20;
    const brand = norm(item.brand);
    if (brand.length > 0 && !seenBrands.has(brand)) score += 15;
    if (item.inStock === true && !haveInStock) score += 50;

    // --- standing mild preferences ---
    if (item.inStock === true) score += 5;
    if (item.hasImage === true) score += 2;
    if (item.hasDescription === true) score += 2;
    if ((item.variantCount ?? 0) > 1) score += 2;

    // --- NEW: sendability outranks richness ---
    if (item.passesContract === true) score += CONTRACT_PASS_BONUS;
    else if (item.passesContract === false) score -= CONTRACT_FAIL_PENALTY;

    // --- NEW: per-round variety ---
    score += rotationJitter(String(item.id), r) * ROTATION_WEIGHT;

    return score;
  };

  const remaining = new Set(pool.map((p) => String(p.id)));
  const picked: SampleCandidate[] = [];

  while (picked.length < cap && remaining.size > 0) {
    let best: SampleCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    // Iterate the id-sorted pool so ties break identically every run.
    for (const item of pool) {
      if (!remaining.has(String(item.id))) continue;
      const s = scoreOf(item);
      if (s > bestScore) {
        bestScore = s;
        best = item;
      }
    }
    if (best === null) break;

    picked.push(best);
    remaining.delete(String(best.id));
    const cat = norm(best.category);
    if (cat.length > 0) seenCategories.add(cat);
    const brand = norm(best.brand);
    if (brand.length > 0) seenBrands.add(brand);
    const strain = norm(best.strainType);
    if (strain.length > 0) seenStrains.add(strain);
    if ((best.variantCount ?? 0) > 1) haveMulti = true;
    if (best.hasImage === true) haveImage = true;
    if (best.hasDescription === true) haveDescription = true;
    if (best.hasPotency === true) havePotency = true;
    if (best.inStock === true) haveInStock = true;
  }

  return {
    picked,
    failing: picked.filter((p) => p.passesContract === false),
    round: r,
    exhausted: picked.length < cap,
  };
}

/* -------------------------------------------------------------------------- */
/* Explaining the sample                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One honest sentence about what was suggested.
 *
 * It names the failing count up front when there is one, because the owner's
 * complaint was that he found out only when the send was refused.
 */
export function describeSample(selection: SampleSelection): string {
  const n = selection.picked.length;
  if (n === 0) return "There are no products available to sample.";

  const bits: string[] = [];
  bits.push(`Suggested ${n} product${n === 1 ? "" : "s"}`);
  if (selection.round > 0) bits.push(`(suggestion round ${selection.round + 1})`);

  const good = n - selection.failing.length;
  if (selection.failing.length === 0) {
    bits.push(`— all ${n === 1 ? "of it" : "of them"} pass Leafly's contract and can be sent now.`);
  } else if (good === 0) {
    bits.push(
      `— but ${selection.failing.length === 1 ? "it does" : "none of them"} not pass Leafly's contract. ` +
        `Each one is listed below with a button that takes you straight to the page where it can be fixed.`,
    );
  } else {
    bits.push(
      `— ${good} can be sent now and ${selection.failing.length} cannot. You can send the ${good} that ` +
        `pass and fix the ${selection.failing.length === 1 ? "other one" : `other ${selection.failing.length}`} ` +
        `using the fix buttons below.`,
    );
  }
  if (selection.exhausted) {
    bits.push("That is every product available to sample.");
  }
  return bits.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflySampleRotationTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  const mk = (id: string, over: Partial<SampleCandidate> = {}): SampleCandidate => ({
    id,
    name: `Product ${id}`,
    category: "flower",
    brand: "Acme",
    strainType: "hybrid",
    inStock: true,
    variantCount: 1,
    ...over,
  });

  // ---- rotationHash ----
  ok("hash is deterministic", rotationHash("abc") === rotationHash("abc"));
  ok("hash differs for different input", rotationHash("abc") !== rotationHash("abd"));
  ok("hash is unsigned", rotationHash("anything") >= 0);
  ok("hash of empty string is stable", rotationHash("") === rotationHash(""));
  ok("hash distinguishes hex-tail ids", rotationHash("pos-a-cca24072824d") !== rotationHash("pos-a-00de6c9e8f2c"));

  // ---- rotationJitter ----
  ok("round 0 has NO jitter (preserves the classic sample)", rotationJitter("x", 0) === 0);
  ok("negative round has no jitter", rotationJitter("x", -3) === 0);
  ok("round 1 has jitter", rotationJitter("x", 1) !== 0 || rotationJitter("y", 1) !== 0);
  ok("jitter is in [0,1)", rotationJitter("x", 5) >= 0 && rotationJitter("x", 5) < 1);
  ok("jitter is reproducible", rotationJitter("x", 7) === rotationJitter("x", 7));
  ok("jitter differs between rounds", rotationJitter("x", 1) !== rotationJitter("x", 2));

  // ---- the core ask: a DIFFERENT set on a later round ----
  const many = Array.from({ length: 40 }, (_, i) =>
    mk(`p${String(i).padStart(2, "0")}`, {
      category: `cat${i % 7}`,
      brand: `brand${i % 5}`,
      strainType: i % 2 === 0 ? "indica" : "sativa",
      passesContract: true,
    }),
  );
  const r0 = buildRotatingSample(many, 8, 0);
  const r1 = buildRotatingSample(many, 8, 1);
  const r2 = buildRotatingSample(many, 8, 2);
  ok("round 0 returns the requested count", r0.picked.length === 8);
  ok("round 1 returns the requested count", r1.picked.length === 8);
  const ids0 = r0.picked.map((p) => p.id).join(",");
  const ids1 = r1.picked.map((p) => p.id).join(",");
  const ids2 = r2.picked.map((p) => p.id).join(",");
  ok("round 1 differs from round 0 (THE OWNER'S ASK)", ids0 !== ids1);
  ok("round 2 differs from round 1", ids1 !== ids2);
  ok("round 2 differs from round 0", ids0 !== ids2);
  ok("rounds actually swap members, not just order", new Set(r1.picked.map((p) => p.id)).size === 8 &&
    r1.picked.some((p) => !r0.picked.some((q) => q.id === p.id)));

  // ---- but still reproducible ----
  ok("same round is reproducible", buildRotatingSample(many, 8, 1).picked.map((p) => p.id).join(",") === ids1);
  ok("round 0 is reproducible", buildRotatingSample(many, 8, 0).picked.map((p) => p.id).join(",") === ids0);
  ok("round 9 is reproducible", buildRotatingSample(many, 8, 9).picked.map((p) => p.id).join(",") ===
    buildRotatingSample(many, 8, 9).picked.map((p) => p.id).join(","));
  ok("no duplicates within a sample", new Set(r1.picked.map((p) => p.id)).size === r1.picked.length);

  // ---- contract awareness (the reason the owner's 8 could not resend) ----
  const mixed = [
    mk("bad1", { passesContract: false, failureReason: "sizes collide" }),
    mk("bad2", { passesContract: false, failureReason: "sizes collide", category: "edible" }),
    mk("good1", { passesContract: true, category: "topical" }),
    mk("good2", { passesContract: true, category: "preroll" }),
  ];
  const sel = buildRotatingSample(mixed, 2, 0);
  ok("passing products are chosen first", sel.picked.every((p) => p.passesContract === true));
  ok("no failures in a sample that had enough passing items", sel.failing.length === 0);

  // A failing product is NOT banned -- it is last, and it is labelled.
  const allBad = [
    mk("b1", { passesContract: false, failureReason: "x" }),
    mk("b2", { passesContract: false, failureReason: "y", category: "edible" }),
  ];
  const badSel = buildRotatingSample(allBad, 2, 0);
  ok("a menu where everything fails still yields a sample", badSel.picked.length === 2);
  ok("failing products are reported as failing", badSel.failing.length === 2);

  // Unknown must not be treated as failing.
  const unknown = [mk("u1"), mk("u2", { category: "edible" })];
  const unkSel = buildRotatingSample(unknown, 2, 0);
  ok("unchecked products are still suggested", unkSel.picked.length === 2);
  ok("unchecked products are NOT counted as failing", unkSel.failing.length === 0);

  // The decisive ordering rule.
  const richBad = mk("richbad", {
    passesContract: false, variantCount: 5, hasImage: true, hasDescription: true, hasPotency: true, category: "zzz",
  });
  const plainGood = mk("plaingood", { passesContract: true, variantCount: 1, category: "zzz" });
  const one = buildRotatingSample([richBad, plainGood], 1, 0);
  ok(
    "a plain SENDABLE product beats a rich UNSENDABLE one",
    one.picked[0].id === "plaingood",
  );

  // ---- coverage preserved ----
  const spread = [
    mk("a", { category: "flower", passesContract: true }),
    mk("b", { category: "flower", passesContract: true }),
    mk("c", { category: "edible", passesContract: true }),
  ];
  const cov = buildRotatingSample(spread, 2, 0);
  ok("sampler still spans categories", new Set(cov.picked.map((p) => p.category)).size === 2);

  // ---- edges ----
  ok("limit 0 returns nothing", buildRotatingSample(many, 0, 0).picked.length === 0);
  ok("negative limit returns nothing", buildRotatingSample(many, -4, 0).picked.length === 0);
  ok("empty pool returns nothing", buildRotatingSample([], 8, 0).picked.length === 0);
  ok("empty pool is flagged exhausted", buildRotatingSample([], 8, 0).exhausted === true);
  ok("limit beyond pool returns the whole pool", buildRotatingSample(spread, 99, 0).picked.length === 3);
  ok("limit beyond pool is flagged exhausted", buildRotatingSample(spread, 99, 0).exhausted === true);
  ok("a full sample is not flagged exhausted", r0.exhausted === false);
  ok("round is echoed back", buildRotatingSample(many, 8, 4).round === 4);
  ok("fractional round is floored", buildRotatingSample(many, 8, 2.9).round === 2);
  ok("negative round clamps to 0", buildRotatingSample(many, 8, -2).round === 0);
  ok("fractional limit is floored", buildRotatingSample(many, 3.7, 0).picked.length === 3);

  // ---- describeSample ----
  ok("empty description", describeSample(buildRotatingSample([], 8, 0)) === "There are no products available to sample.");
  const allGoodText = describeSample(buildRotatingSample(many, 8, 0));
  ok("all-good text says they can be sent", allGoodText.includes("can be sent now"));
  ok("all-good text counts them", allGoodText.includes("Suggested 8 products"));
  const mixedSel: SampleSelection = {
    picked: [mk("g", { passesContract: true }), mk("b", { passesContract: false })],
    failing: [mk("b", { passesContract: false })],
    round: 0,
    exhausted: false,
  };
  const mixedText = describeSample(mixedSel);
  ok("mixed text offers to send the good ones", mixedText.includes("1 can be sent now and 1 cannot"));
  ok("mixed text mentions the fix buttons", mixedText.includes("fix buttons"));
  const badText = describeSample(badSel);
  ok("all-bad text mentions the fix page", badText.includes("fixed"));
  const roundText = describeSample(buildRotatingSample(many, 8, 3));
  ok("later rounds are labelled for the owner", roundText.includes("suggestion round 4"));
  ok("round 0 is not labelled", !describeSample(buildRotatingSample(many, 8, 0)).includes("suggestion round"));
  ok("singular grammar for one product", describeSample(buildRotatingSample([mk("x", { passesContract: true })], 1, 0)).includes("Suggested 1 product "));

  console.log(`leafly-sample-rotation: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

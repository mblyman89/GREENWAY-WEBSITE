/**
 * src/lib/promotions/markdown-lock-core.ts
 *
 * SLICE C1 -- CLEARANCE / VENDOR-DAY MARKDOWNS (pure: no React, no DB).
 *
 * THE OWNER'S RULE, VERBATIM
 * --------------------------
 * "The only other sale we do that is not specific to the day is a 50% off
 *  products we have been sitting on for too long and things about to expire.
 *  Sometimes we will have a vendor day... Those items are excluded from any and
 *  all other sales/ daily deals... the general rule is, discounts don't stack."
 *
 * Read carefully, that is TWO statements, and the engine only implemented one.
 * "Discounts don't stack" was implemented (best-deal-wins, one promotion per
 * line). "Excluded from any and all other sales" was NOT: the engine had no way
 * to say "this item is on ITS markdown and is out of every other deal".
 *
 * WHAT WAS MEASURED BEFORE THIS MODULE EXISTED
 * ---------------------------------------------
 * Run against the real engine (scripts/probe-clearance.ts, a $40.00 flower line
 * with a clearance markdown on its product key, on a day Monday's 25% runs):
 *
 *   clearance 50% alone                    -> charged $20.00, 50% off   correct
 *   clearance 50% + Monday 25%             -> charged $20.00, 50% off   correct
 *   clearance 50% + vendor day 40%         -> charged $20.00, 50% off   correct
 *   clearance 10% + Monday 25%             -> charged $30.00, and the label
 *                                             read "Munchie Monday - 25% off"
 *   never-discount on the same key         -> charged $40.00, 0% off, no label
 *
 * The last two are the defects.
 *
 *   DEFECT D. A markdown SMALLER than the day's deal was silently overridden.
 *   Best-deal-wins is the right rule between two ordinary promotions, but a
 *   clearance markdown is not an offer competing for the customer -- it is a
 *   REPRICE of an item the store needs to move. The owner said those items are
 *   excluded from other deals; the engine instead gave the deeper deal. That is
 *   not merely a bookkeeping detail: an item marked down 10% because it is
 *   close to expiry was being sold at Monday's 25% instead, and the report
 *   attributed the money to Munchie Monday rather than to clearance.
 *
 *   DEFECT E. The only tool that existed -- the never-discount list -- destroys
 *   the markdown. It merges the key into EVERY rule's exclusions, so the item
 *   rings up at FULL price with no label at all. It means "never discount this,
 *   ever", which is the right tool for a doorbuster or a compliance hold, and
 *   exactly the wrong tool for "this item is 50% off and nothing else applies".
 *
 * WHAT THIS MODULE ADDS
 * ---------------------
 * A LOCK, not a discount. A rule flagged `config.markdownOnly` (a clearance
 * sweep, a vendor day) marks every line it touches as MARKED DOWN. A marked
 * down line is then invisible to every non-markdown rule -- it keeps its own
 * markdown whether that markdown is bigger or smaller than the day's deal.
 *
 * Deliberate design points, each with its reason:
 *
 *  - The lock REMOVES locked lines from other rules' inputs rather than merely
 *    discarding their results. This matters for basket mechanics: Super
 *    Saturday's "30% off one item" and Ice Cream Sunday's 3-for-2 SPREAD their
 *    savings across the eligible basket. A clearance item left in that basket
 *    would soak up part of the spread and quietly shrink everybody else's
 *    discount, even though it can never receive it.
 *
 *  - Between two markdown rules on the same line, the deeper markdown wins.
 *    That is the existing best-deal-wins rule, still applied, but now only
 *    among markdowns. It is NOT stacking: the line still receives exactly one.
 *
 *  - never-discount still outranks a markdown. It is the absolute protection
 *    ("no promotion, ever"), and a store that has listed a key there has said
 *    something stronger than "put it on clearance".
 *
 *  - A markdown rule that matches NOTHING locks nothing. Publishing an empty
 *    clearance sweep must never freeze the day's deals.
 *
 * This module owns the DECISION only (which lines are locked). It does no
 * pricing, so it cannot round a cent or breach a cost floor; the engine keeps
 * every existing clamp. It takes the match test as an argument rather than
 * importing the engine, so there is no import cycle and the lock can be tested
 * without building a full cart.
 */

/** Minimal shape the lock needs from a rule. Structural, so EngineRule fits. */
export type MarkdownRuleLike = {
  id: string;
  config?: { markdownOnly?: boolean } | null;
};

/** Minimal shape the lock needs from a cart line. Structural. */
export type MarkdownLineLike = {
  lineId: string;
};

/**
 * Is this rule a MARKDOWN (clearance / vendor day) rather than an ordinary
 * promotion? Strictly `=== true`: a missing config, a null config, or a
 * truthy-but-not-true value (the string "false" out of a jsonb column, say)
 * must NOT silently lock a line out of the day's deals.
 */
export function isMarkdownRule(rule: MarkdownRuleLike): boolean {
  return rule.config?.markdownOnly === true;
}

export type MarkdownLock = {
  /** Lines that carry a markdown and are therefore out of all other deals. */
  lockedLineIds: ReadonlySet<string>;
  /** Ids of the rules that are markdowns. */
  markdownRuleIds: ReadonlySet<string>;
  /** True when at least one line is locked (lets the engine skip all the work). */
  hasLock: boolean;
};

/**
 * Decide which lines are marked down.
 *
 * @param lines   the cart
 * @param rules   every rule under consideration
 * @param matches the engine's own target/exclusion test. Passed in so this
 *                module never has to duplicate ruleMatchesLine -- duplicating
 *                it is precisely the bug SLICE T1 spent its life removing.
 */
export function computeMarkdownLock<R extends MarkdownRuleLike, L extends MarkdownLineLike>(
  lines: readonly L[],
  rules: readonly R[],
  matches: (rule: R, line: L) => boolean,
): MarkdownLock {
  const markdownRuleIds = new Set<string>();
  const lockedLineIds = new Set<string>();
  for (const rule of rules) {
    if (!isMarkdownRule(rule)) continue;
    markdownRuleIds.add(rule.id);
    for (const line of lines) {
      // A markdown only locks the lines it actually reaches. Its own exclusions
      // and targets are honoured through `matches`, so an item the clearance
      // sweep explicitly excludes stays eligible for the day's deal.
      if (matches(rule, line)) lockedLineIds.add(line.lineId);
    }
  }
  return { lockedLineIds, markdownRuleIds, hasLock: lockedLineIds.size > 0 };
}

/**
 * The lines a given rule is allowed to see.
 *
 * A markdown rule sees everything (its own targeting still applies downstream).
 * Every other rule sees the cart with the marked-down lines REMOVED, so basket
 * and spread mechanics compute over the basket they can actually discount.
 *
 * Returns the original array reference when nothing is filtered, so the engine's
 * existing behaviour is bit-for-bit unchanged for carts with no markdowns.
 */
export function linesVisibleToRule<R extends MarkdownRuleLike, L extends MarkdownLineLike>(
  rule: R,
  lines: readonly L[],
  lock: MarkdownLock,
): readonly L[] {
  if (!lock.hasLock) return lines;
  if (isMarkdownRule(rule)) return lines;
  return lines.filter((l) => !lock.lockedLineIds.has(l.lineId));
}

// ---------------------------------------------------------------------------
// Self-tests (pure). Throws on the first failure.
// ---------------------------------------------------------------------------
export function __runMarkdownLockTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean): void {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      throw new Error(`markdown-lock-core self-test FAILED: ${name}`);
    }
  }

  type R = MarkdownRuleLike & { targets: string[] };
  type L = MarkdownLineLike & { key: string };

  const lines: L[] = [
    { lineId: "a", key: "CLEAR" },
    { lineId: "b", key: "NORMAL" },
    { lineId: "c", key: "CLEAR" },
  ];
  const matches = (r: R, l: L) => r.targets.includes(l.key);

  const clearance: R = { id: "clr", config: { markdownOnly: true }, targets: ["CLEAR"] };
  const monday: R = { id: "mon", config: {}, targets: ["CLEAR", "NORMAL"] };

  // 1. isMarkdownRule is strict.
  check("markdown flag true", isMarkdownRule(clearance));
  check("plain rule is not a markdown", !isMarkdownRule(monday));
  check("missing config is not a markdown", !isMarkdownRule({ id: "x" }));
  check("null config is not a markdown", !isMarkdownRule({ id: "x", config: null }));
  check("undefined flag is not a markdown", !isMarkdownRule({ id: "x", config: {} }));
  check(
    "non-boolean truthy does NOT lock",
    !isMarkdownRule({ id: "x", config: { markdownOnly: "true" as unknown as boolean } }),
  );
  check(
    "explicit false does not lock",
    !isMarkdownRule({ id: "x", config: { markdownOnly: false } }),
  );

  // 2. The lock covers exactly the lines the markdown reaches.
  const lock = computeMarkdownLock(lines, [clearance, monday], matches);
  check("locked a", lock.lockedLineIds.has("a"));
  check("locked c", lock.lockedLineIds.has("c"));
  check("did NOT lock b", !lock.lockedLineIds.has("b"));
  check("lock size 2", lock.lockedLineIds.size === 2);
  check("markdown rule id recorded", lock.markdownRuleIds.has("clr") && !lock.markdownRuleIds.has("mon"));
  check("hasLock", lock.hasLock);

  // 3. Visibility: the day's deal loses the locked lines; the markdown keeps all.
  const mondaySees = linesVisibleToRule(monday, lines, lock);
  check("monday sees only b", mondaySees.length === 1 && mondaySees[0].lineId === "b");
  const clearanceSees = linesVisibleToRule(clearance, lines, lock);
  check("clearance sees the whole cart", clearanceSees.length === 3);

  // 4. No markdown anywhere -> nothing changes, and the SAME array comes back
  //    (proves the no-markdown path cannot alter existing behaviour).
  const noLock = computeMarkdownLock(lines, [monday], matches);
  check("no markdown -> nothing locked", noLock.lockedLineIds.size === 0);
  check("no markdown -> hasLock false", !noLock.hasLock);
  check("no markdown -> identical array reference", linesVisibleToRule(monday, lines, noLock) === lines);

  // 5. A markdown that matches nothing must not freeze the day's deals.
  const emptySweep: R = { id: "empty", config: { markdownOnly: true }, targets: [] };
  const emptyLock = computeMarkdownLock(lines, [emptySweep, monday], matches);
  check("empty sweep locks nothing", !emptyLock.hasLock);
  check("empty sweep leaves monday whole", linesVisibleToRule(monday, lines, emptyLock).length === 3);
  check("empty sweep still recorded as a markdown", emptyLock.markdownRuleIds.has("empty"));

  // 6. Two markdowns union their locks.
  const vendorDay: R = { id: "ven", config: { markdownOnly: true }, targets: ["NORMAL"] };
  const bothLock = computeMarkdownLock(lines, [clearance, vendorDay, monday], matches);
  check("two markdowns lock everything they touch", bothLock.lockedLineIds.size === 3);
  check("monday sees nothing", linesVisibleToRule(monday, lines, bothLock).length === 0);
  check("clearance still sees all", linesVisibleToRule(clearance, lines, bothLock).length === 3);
  check("vendor day still sees all", linesVisibleToRule(vendorDay, lines, bothLock).length === 3);

  // 7. Empty inputs are safe.
  check("no rules", !computeMarkdownLock(lines, [], matches).hasLock);
  check("no lines", !computeMarkdownLock([], [clearance], matches).hasLock);

  // 8. Purity: the lock must not mutate its inputs.
  const before = JSON.stringify(lines);
  computeMarkdownLock(lines, [clearance, monday], matches);
  linesVisibleToRule(monday, lines, lock);
  check("inputs unmutated", JSON.stringify(lines) === before);

  if (failed > 0) throw new Error(`markdown-lock-core: ${failed} failure(s)`);
  return { passed, failed };
}

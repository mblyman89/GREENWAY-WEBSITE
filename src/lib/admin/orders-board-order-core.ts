/**
 * src/lib/admin/orders-board-order-core.ts
 *
 * SLICE L-22 — WHAT GOES FIRST, AND WHO GETS A LABEL.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION
 * ===========================================================================
 *   "Reorganize the dashboard: our orders first, Leafly below, then a
 *    combined order history table with origin labels."
 *
 * ===========================================================================
 * PART ONE — THE TENSION, STATED HONESTLY
 * ===========================================================================
 * Slice L-6 put the Leafly board ABOVE Greenway's own orders, and wrote down
 * why, in the page itself:
 *
 *   "A Leafly order is the only order in the building with a hard external
 *    deadline — Leafly auto-cancels anything not acknowledged within fifteen
 *    minutes — so it is the first thing on this page that can cost a real
 *    customer their order."
 *
 * That reasoning was not wrong. But it treated the WORST case as the ONLY
 * case, and the owner has now worked the screen for real and found it wrong
 * in the ordinary case: nearly every order is a Greenway order, so the thing
 * he needs nine times out of ten sits below a panel that is usually empty. A
 * dashboard optimised entirely for the emergency is a dashboard that is
 * slightly wrong all day, every day.
 *
 * Both are right about different moments, so this core does not choose once:
 *
 *   - NORMALLY the owner's order applies. Greenway orders first, Leafly
 *     below. This is the layout he asked for and it is correct whenever
 *     nothing is on fire.
 *
 *   - When a Leafly order is UNACKNOWLEDGED, the deadline is real and
 *     running, and the Leafly board is promoted above the Greenway cards for
 *     as long as that stays true. Not because of a setting; because of a
 *     fact about the world.
 *
 * The promotion is visible and explained on screen, never silent. A layout
 * that rearranges itself without saying why is a layout nobody trusts, and
 * an unexplained rearrangement is indistinguishable from a bug.
 *
 * ===========================================================================
 * WHY THIS IS A CORE AND NOT AN `if` IN THE PAGE
 * ===========================================================================
 * Because it is a JUDGEMENT, and judgements that live in JSX cannot be
 * executed by CI and drift the moment a second screen needs the same answer.
 * This file is run on every CI run, by name, with a floor.
 *
 * PURE. No I/O, no clock, no database, no React. Everything it needs arrives
 * as an argument.
 */

import {
  DEFAULT_ORDER_ORIGIN,
  toOrderOrigin,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";

/* ------------------------------------------------------------------------ *
 * 1. Section order
 * ------------------------------------------------------------------------ */

export const BOARD_SECTIONS = ["greenway", "leafly"] as const;
export type BoardSection = (typeof BOARD_SECTIONS)[number];

export type BoardOrderInput = {
  /**
   * Leafly orders that have arrived and NOT been acknowledged. Each one has a
   * 15-minute auto-cancel clock running against it.
   *
   * Three-valued on purpose. `null` means "we could not count" and is NOT the
   * same as zero — see `decideBoardLayout`.
   */
  leaflyPendingAck: number | null;
};

export type BoardLayout = {
  /** Top to bottom. Always contains every section exactly once. */
  sections: readonly BoardSection[];
  /**
   * True when the Leafly board has been promoted ABOVE the owner's requested
   * order because a deadline is running.
   */
  leaflyPromoted: boolean;
  /**
   * One sentence explaining a promotion, or "" when the layout is the
   * ordinary one. Never null, so a caller cannot render "null" by accident
   * and no call site needs its own empty check.
   */
  reason: string;
};

/**
 * Decide the section order.
 *
 * ── WHY A FAILED COUNT IS NOT ZERO ───────────────────────────────────────
 * `countLeaflyOrdersAwaitingAck()` returns `number | null`, where null means
 * the query failed. Reading that null as zero would be this core promising
 * "nothing is waiting" on the strength of a question it never got an answer
 * to. It is not entitled to make that promise.
 *
 * So an unknown count leaves the layout in the owner's requested order and
 * says nothing. That is the right way to be wrong here: inventing an
 * emergency trains the shop to ignore the promotion, which costs us the
 * promotion that mattered. The uncertainty is not swallowed — the Leafly
 * board reports its own load failures in its own `problem` line, which is
 * where a reader already looks for them. Two components reporting one fault
 * is how a screen starts contradicting itself.
 */
export function decideBoardLayout(input: BoardOrderInput): BoardLayout {
  const pending = input.leaflyPendingAck;

  if (typeof pending === "number" && Number.isFinite(pending) && pending > 0) {
    return {
      sections: ["leafly", "greenway"],
      leaflyPromoted: true,
      reason:
        pending === 1
          ? "1 Leafly order is waiting to be acknowledged — Leafly cancels it automatically after 15 minutes, so it is shown first."
          : `${pending} Leafly orders are waiting to be acknowledged — Leafly cancels them automatically after 15 minutes, so they are shown first.`,
    };
  }

  return { sections: ["greenway", "leafly"], leaflyPromoted: false, reason: "" };
}

/* ------------------------------------------------------------------------ *
 * 2. Origin labels in the combined history
 * ------------------------------------------------------------------------ */

/**
 * Should the combined history label a WEBSITE order, as well as a Leafly one?
 *
 * ── WHAT IS ALREADY TRUE, MEASURED NOT ASSUMED ───────────────────────────
 * The history list is ALREADY combined. `listOrdersPaged` selects from
 * `orders` with no origin filter (orders-store.ts:374), and Leafly orders are
 * written into that same table with `origin: "leafly"` (bridge-server.ts:215).
 * So the owner's "combined order history table" exists; what is missing is
 * the LABELS, because page.tsx passes `hideWebsite` unconditionally.
 *
 * ── THE JUDGEMENT L-12 MADE, AND WHY IT IS BEING NARROWED ────────────────
 * L-12 introduced `hideWebsite` with a good reason, written down at the time:
 *
 *   "On a screen where nearly every row is a website order, a 'Website' badge
 *    on all forty rows is pure noise and trains the eye to skip the column —
 *    taking the Leafly badge with it."
 *
 * That is still true for a shop that has never seen a Leafly order, and this
 * slice does not throw it away. But there is a real difference between:
 *
 *   - A shop where every order is a website order. Labelling every row says
 *     nothing, because nothing distinguishes anything.
 *   - A shop that genuinely receives both. There, labels belong on BOTH,
 *     because "unlabelled" is not a label. If only Leafly rows are badged, a
 *     website row is identified by the ABSENCE of a badge — indistinguishable
 *     from a row whose badge failed to render, and unreadable to anyone who
 *     has not been told the convention.
 *
 * So the rule is: label everything, or label nothing. Never label half.
 *
 * ── WHY THE SHOP, AND NOT THE ROWS ON SCREEN ─────────────────────────────
 * The obvious implementation looks at the rows currently rendered and turns
 * labels on when it sees a mix. It is wrong, and subtly: page 1 might be
 * mixed and page 2 all website, so the SAME table would change its labelling
 * convention as you page through it, and the reader would have to notice that
 * to avoid mis-reading page 2. A convention that changes under you is worse
 * than either convention.
 *
 * The signal therefore has to be shop-level and stable across pages and
 * filters: does this shop receive Leafly orders at all? That fact is already
 * loaded on the page as `readiness.anyOrderEverReceived` — no extra query.
 *
 * ── THE SAFETY VALVE ─────────────────────────────────────────────────────
 * The shop-level flag is derived from a count that can FAIL (it is set from
 * `everOrdered === true`, so a null degrades to false). If it is false and a
 * Leafly row is nevertheless on screen, the flag is the thing that is wrong,
 * and the page must not be half-labelled on the strength of it. Visible
 * evidence on the screen outranks a flag about the screen.
 */
export function shouldLabelWebsiteRows(input: {
  /**
   * Shop-level and stable: has a Leafly order ever arrived? Takes the
   * `anyOrderEverReceived` fact already computed by `assessOrderReadiness`,
   * echoed rather than re-derived (house rule 11).
   */
  shopReceivesLeaflyOrders: boolean;
  /** The raw `orders.origin` values of the rows being rendered right now. */
  originsOnScreen: readonly (string | null | undefined)[];
}): boolean {
  if (input.shopReceivesLeaflyOrders) return true;
  // Safety valve: evidence on the screen outranks the flag about the screen.
  return distinctOrigins(input.originsOnScreen).size > 1;
}

/**
 * Normalise a set of raw origin values through the ONE resolver that decides
 * what an origin means.
 *
 * `toOrderOrigin` is used rather than a local trim/lowercase because the badge
 * renders `toOrderOrigin(origin)`. If this core folded values any differently,
 * it could count "martian" as a distinct kind of order while the screen showed
 * it as "Website" — this file would be deciding to label a mix that the reader
 * cannot see. One fact, one resolver.
 */
function distinctOrigins(values: readonly (string | null | undefined)[]): Set<OrderOrigin> {
  const out = new Set<OrderOrigin>();
  for (const v of values) out.add(toOrderOrigin(v));
  return out;
}

/* ------------------------------------------------------------------------ *
 * 3. Telling the owner what he is looking at
 * ------------------------------------------------------------------------ */

export type OriginTally = {
  origin: OrderOrigin;
  count: number;
};

/**
 * Count the rows on screen by origin.
 *
 * Resolves through `toOrderOrigin`, so the tally counts what the reader can
 * actually SEE. A row with a null origin, or an origin written before
 * migration 0226 added the column, is a website order — that is the house-wide
 * default (`DEFAULT_ORDER_ORIGIN`) and re-deciding it here would be a second
 * opinion about a settled question.
 */
export function tallyOrigins(
  origins: readonly (string | null | undefined)[],
): OriginTally[] {
  const counts = new Map<OrderOrigin, number>();
  for (const raw of origins) {
    const key = toOrderOrigin(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Biggest first, then alphabetically. The alphabetical tiebreak matters:
  // without it the order would depend on Map insertion, so a table's summary
  // line would reshuffle between refreshes that returned the same rows in a
  // different sequence. A line that moves is a line people stop reading.
  return Array.from(counts.entries())
    .map(([origin, count]) => ({ origin, count }))
    .sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));
}

/**
 * The one-line summary above the combined history.
 *
 * ── WHY THE CORE OWNS THE SENTENCE AND NOT JUST THE NUMBERS ──────────────
 * Because the sentence contains a claim that is easy to get wrong and
 * impossible to test if it lives in JSX. These counts describe ONLY the rows
 * on the current page — at most one page-size worth — and the page is also
 * filtered by status, search and date. A line reading "24 Website · 6 Leafly"
 * above a filtered page 2 invites exactly one reading, and it is the wrong
 * one: that those are the shop's totals.
 *
 * So the wording is fixed here, is asserted here, and says "on this page".
 * Anyone tempted to reword it has to change a test that explains why.
 *
 * Returns "" when there is nothing worth saying — a single-origin page has no
 * mix to describe, and a count of one kind of thing is just the row count
 * again, which the pager already shows.
 */
export function describeOriginMix(
  tallies: readonly OriginTally[],
  label: (origin: OrderOrigin) => string,
): string {
  if (tallies.length < 2) return "";
  return `On this page: ${tallies.map((t) => `${t.count} ${label(t.origin)}`).join(" · ")}`;
}

/* ────────────────────────────── self-tests ────────────────────────────── */

export function __runBoardOrderTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (what: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[orders-board-order-core] FAIL: ${what}`);
    }
  };

  // ── The owner's requested order is the NORMAL case ──────────────────────
  const calm = decideBoardLayout({ leaflyPendingAck: 0 });
  ok("our orders come first, as asked", calm.sections[0] === "greenway");
  ok("Leafly sits below", calm.sections[1] === "leafly");
  ok("nothing is promoted", calm.leaflyPromoted === false);
  ok("and nothing is explained, because nothing changed", calm.reason === "");
  ok("both sections are always present", calm.sections.length === 2);

  // ── A running deadline outranks the layout ──────────────────────────────
  const urgent = decideBoardLayout({ leaflyPendingAck: 1 });
  ok("an unacknowledged Leafly order is promoted", urgent.sections[0] === "leafly");
  ok("greenway is still shown, just below", urgent.sections[1] === "greenway");
  ok("greenway is never dropped when leafly is promoted", urgent.sections.includes("greenway"));
  ok("the promotion is flagged", urgent.leaflyPromoted === true);
  ok("the promotion is explained", urgent.reason.length > 20);
  ok("the explanation names the clock", urgent.reason.includes("15 minutes"));
  ok("the explanation names Leafly", urgent.reason.includes("Leafly"));
  ok("one order reads as singular", urgent.reason.startsWith("1 Leafly order is"));
  ok("the singular sentence is not plural anywhere", !urgent.reason.includes("orders are"));

  const many = decideBoardLayout({ leaflyPendingAck: 3 });
  ok("three orders read as plural", many.reason.startsWith("3 Leafly orders are"));
  ok("the plural sentence carries the count", many.reason.includes("3 "));
  ok("a large count still promotes", decideBoardLayout({ leaflyPendingAck: 99 }).leaflyPromoted);

  // ── A failed count must not be read as "nothing waiting" ────────────────
  const unknown = decideBoardLayout({ leaflyPendingAck: null });
  ok("an unknown count does not invent an emergency", unknown.leaflyPromoted === false);
  ok("an unknown count keeps the requested order", unknown.sections[0] === "greenway");
  ok("an unknown count stays silent", unknown.reason === "");

  // Nonsense must not promote either: a negative or NaN count is a bug
  // upstream, and a layout that rearranges on a bug is a layout that teaches
  // the shop to distrust the rearrangement.
  ok("a negative count does not promote", decideBoardLayout({ leaflyPendingAck: -1 }).leaflyPromoted === false);
  ok("NaN does not promote", decideBoardLayout({ leaflyPendingAck: Number.NaN }).leaflyPromoted === false);
  ok(
    "Infinity does not promote",
    decideBoardLayout({ leaflyPendingAck: Number.POSITIVE_INFINITY }).leaflyPromoted === false,
  );

  const layouts = [calm, urgent, many, unknown];
  ok(
    "every layout contains each section exactly once",
    layouts.every((l) => new Set(l.sections).size === 2 && l.sections.length === 2),
  );
  ok(
    "a promoted layout always explains itself, and an unpromoted one never does",
    layouts.every((l) => (l.leaflyPromoted ? l.reason.length > 0 : l.reason === "")),
  );
  ok(
    "promotion happens if and only if leafly is on top",
    layouts.every((l) => l.leaflyPromoted === (l.sections[0] === "leafly")),
  );

  // ── Label everything, or label nothing. Never half. ─────────────────────
  const WEBSITE_ONLY = ["greenway", "greenway", "greenway"];
  ok(
    "a shop with no Leafly orders does not label its website rows",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: WEBSITE_ONLY }) === false,
  );
  ok(
    "an empty page for such a shop labels nothing",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: [] }) === false,
  );
  ok(
    "a shop that receives Leafly orders labels the website rows too",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: true, originsOnScreen: WEBSITE_ONLY }) === true,
  );
  ok(
    "...even on a page that happens to show no Leafly rows, so the convention holds across pages",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: true, originsOnScreen: ["greenway"] }) === true,
  );
  ok(
    "...and even on an empty page, so it does not flip when a filter matches nothing",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: true, originsOnScreen: [] }) === true,
  );
  ok(
    "the safety valve: a visible Leafly row labels both even when the flag says otherwise",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["greenway", "leafly"] }) === true,
  );
  ok(
    "an all-Leafly page for a flagless shop needs no labels either",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["leafly", "leafly"] }) === false,
  );
  ok(
    "case and whitespace do not fake a mix",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["Leafly", " leafly ", "LEAFLY"] }) ===
      false,
  );
  ok(
    "null origins are website orders, not a second kind",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["greenway", null, undefined] }) ===
      false,
  );
  ok(
    "an unrecognised origin renders as Website, so it does not fake a mix either",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["greenway", "martian"] }) === false,
  );
  ok(
    "a register sale IS a visible second kind",
    shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: false, originsOnScreen: ["greenway", "register"] }) === true,
  );

  // ── The tally counts what the reader can SEE ────────────────────────────
  const t = tallyOrigins(["leafly", "greenway", "greenway", null, undefined, "LEAFLY"]);
  ok("origins are tallied", t.length === 2);
  ok("the biggest group leads", t[0]?.count === 4);
  ok("null and undefined count as website orders", t[0]?.origin === "greenway");
  ok("case is folded together", t[1]?.origin === "leafly" && t[1]?.count === 2);
  ok("an empty list tallies to nothing", tallyOrigins([]).length === 0);
  ok("the total is preserved", tallyOrigins(["leafly", "greenway", "x"]).reduce((n, r) => n + r.count, 0) === 3);
  ok(
    "an unrecognised origin is counted as what the badge will show, not as itself",
    (() => {
      const r = tallyOrigins(["martian"]);
      return r.length === 1 && r[0]?.origin === DEFAULT_ORDER_ORIGIN && r[0]?.count === 1;
    })(),
  );
  ok(
    "the tally never invents an origin outside the closed set",
    tallyOrigins(["leafly", "martian", null, "register"]).every((r) =>
      (["greenway", "leafly", "register"] as string[]).includes(r.origin),
    ),
  );
  ok(
    "equal counts are ordered alphabetically, so the line never reshuffles",
    (() => {
      const r = tallyOrigins(["leafly", "greenway"]);
      return r[0]?.origin === "greenway" && r[1]?.origin === "leafly";
    })(),
  );
  ok(
    "the same rows in a different sequence give the same line",
    JSON.stringify(tallyOrigins(["leafly", "greenway", "greenway"])) ===
      JSON.stringify(tallyOrigins(["greenway", "leafly", "greenway"])),
  );

  // ── The sentence, including what it promises ────────────────────────────
  const LBL = (o: OrderOrigin) => ({ greenway: "Website", leafly: "Leafly", register: "Register" })[o];
  const mix = describeOriginMix(tallyOrigins(["greenway", "greenway", "leafly"]), LBL);
  ok("a mixed page is summarised", mix.length > 0);
  ok("the summary scopes itself to the page, and does not claim a shop total", mix.startsWith("On this page:"));
  ok("the summary names both kinds", mix.includes("Website") && mix.includes("Leafly"));
  ok("the summary carries both counts", mix.includes("2 Website") && mix.includes("1 Leafly"));
  ok("the biggest group is named first", mix.indexOf("Website") < mix.indexOf("Leafly"));
  ok(
    "a single-origin page says nothing, because there is no mix to describe",
    describeOriginMix(tallyOrigins(["greenway", "greenway"]), LBL) === "",
  );
  ok("an empty page says nothing", describeOriginMix([], LBL) === "");
  ok(
    "three kinds are all named",
    (() => {
      const s = describeOriginMix(tallyOrigins(["greenway", "leafly", "register"]), LBL);
      return s.includes("Website") && s.includes("Leafly") && s.includes("Register");
    })(),
  );
  ok(
    "the counts in the sentence add up to the rows given",
    (() => {
      const rows = ["greenway", "leafly", "leafly", null, "register"];
      const s = describeOriginMix(tallyOrigins(rows), LBL);
      const nums = (s.match(/\d+/g) ?? []).map(Number);
      return nums.reduce((a, b) => a + b, 0) === rows.length;
    })(),
  );
  ok(
    "the label function is actually consulted, so the wording cannot drift from the badge",
    describeOriginMix(tallyOrigins(["greenway", "leafly"]), () => "ZZZ").includes("ZZZ"),
  );

  return { passed, failed };
}

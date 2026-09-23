/**
 * tests/compliance/orders-board-order.test.ts
 *
 * SLICE L-22 — what goes first, and who gets an origin label.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR
 * ===========================================================================
 * Four slices running, the same lesson keeps arriving: a source-text
 * assertion proves only that a string appears in a file. It cannot tell a
 * section that MOVED from one that was COPIED, and it cannot tell markup that
 * renders from markup that is present but unreachable ({false && ...}, or a
 * value assigned an empty literal). L-21 shipped six mutation survivors of
 * exactly that shape on its first probe run.
 *
 * So the structural claims here are made against the PARSED page — matched
 * bracket depth — and against the FORM of expressions, not their presence.
 * Every judgement claim is made by EXECUTING the core. The render-level proof
 * lives in orders-board-order-render.test.tsx.
 *
 * ===========================================================================
 * THE LOAD-BEARING CLAIM OF THIS SLICE
 * ===========================================================================
 * The two order sections are rendered from a list the core returns, so their
 * ORDER is data. That is what makes the owner's layout testable. But it
 * introduces a failure mode worse than the bug it fixes: if someone "simplifies"
 * it back into two conditional blocks, the page can render the same Leafly
 * order TWICE, with two Acknowledge buttons, one of them stale — and
 * acknowledging is irreversible (it permanently ends our access to the
 * shopper's ID images).
 *
 * Hence the assertions below that each section is defined exactly ONCE, and
 * that the board is reached only through the core's list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BOARD_SECTIONS,
  decideBoardLayout,
  describeOriginMix,
  shouldLabelWebsiteRows,
  tallyOrigins,
  __runBoardOrderTests,
} from "../../src/lib/admin/orders-board-order-core";
import { orderOriginLabel, ORDER_ORIGINS } from "../../src/lib/orders/order-origin-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PAGE = read("src/app/admin/orders/page.tsx");
const CORE = read("src/lib/admin/orders-board-order-core.ts");
const HARNESS = read("scripts/compliance/run-pure-selftests.ts");
const STORE = read("src/lib/orders/orders-store.ts");
const BRIDGE = read("src/lib/leafly/bridge-server.ts");

/**
 * Strip comments before asserting on structure.
 *
 * Learned in L-20: an assertion that a file does NOT contain something matched
 * the doc comment explaining why the file does not contain it. A test that
 * fails on its own prose is a test nobody trusts. This one matters more than
 * usual here, because this slice deliberately KEEPS the old L-6 comment (with
 * a correction) rather than deleting it.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CODE = codeOnly(PAGE);

/**
 * Extract a balanced `const <name> = ( ... );` initialiser by counting paren
 * depth, so "what is inside this section?" is answered by parsing rather than
 * by hoping a substring lands within the right block.
 */
function constBlock(src: string, name: string): string {
  const needle = `const ${name} = (`;
  const start = src.indexOf(needle);
  expect(start, `${name} must be defined`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + needle.length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  throw new Error(`${name} initialiser is unbalanced`);
}

// ===========================================================================
describe("L-22 — the pure core is registered, green, and floored", () => {
  it("every self-test passes", () => {
    const r = __runBoardOrderTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(55);
  });

  it("is wired into the compliance harness with a floor", () => {
    expect(HARNESS).toContain("orders-board-order-core");
    expect(HARNESS).toMatch(
      /assertRan\("orders-board-order-core", __runBoardOrderTests\(\), \d+\)/,
    );
  });

  it("the floor is real — high enough to notice a gutted suite", () => {
    const m = HARNESS.match(
      /assertRan\("orders-board-order-core", __runBoardOrderTests\(\), (\d+)\)/,
    );
    expect(m).not.toBeNull();
    const floor = Number(m![1]);
    expect(floor).toBeGreaterThanOrEqual(40);
    expect(floor).toBeLessThanOrEqual(__runBoardOrderTests().passed);
  });

  it("the core is pure — it imports nothing that can do I/O", () => {
    // The one import it is allowed is the origin resolver, which is itself a
    // pure core. Anything else (a store, a client, react) would make the CI
    // self-test a lie about what it proved.
    // No `s` flag: the repo targets a baseline where it is unavailable, and
    // `[\s\S]` says the same thing everywhere. tsc caught this; vitest did not,
    // because vitest transpiles without type-checking.
    const imports = [...CORE.matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/orders/order-origin-core"]);
  });
});

// ===========================================================================
describe("L-22 — the owner's requested order, and the one thing that bends it", () => {
  it("normally shows our orders first and Leafly below, exactly as asked", () => {
    const l = decideBoardLayout({ leaflyPendingAck: 0 });
    expect(l.sections).toEqual(["greenway", "leafly"]);
    expect(l.leaflyPromoted).toBe(false);
  });

  it("promotes Leafly only while an acknowledgement is actually outstanding", () => {
    expect(decideBoardLayout({ leaflyPendingAck: 1 }).sections[0]).toBe("leafly");
    expect(decideBoardLayout({ leaflyPendingAck: 0 }).sections[0]).toBe("greenway");
  });

  it("never promotes on a FAILED count — a null is not a zero and not an emergency", () => {
    const l = decideBoardLayout({ leaflyPendingAck: null });
    expect(l.leaflyPromoted).toBe(false);
    expect(l.sections).toEqual(["greenway", "leafly"]);
    expect(l.reason).toBe("");
  });

  it("never loses a section, whatever the input", () => {
    for (const n of [null, -5, 0, 1, 2, 999, Number.NaN, Number.POSITIVE_INFINITY]) {
      const l = decideBoardLayout({ leaflyPendingAck: n });
      expect([...l.sections].sort()).toEqual([...BOARD_SECTIONS].sort());
    }
  });

  it("explains every promotion, and stays silent when it has not promoted", () => {
    for (const n of [null, 0, 1, 4]) {
      const l = decideBoardLayout({ leaflyPendingAck: n });
      if (l.leaflyPromoted) expect(l.reason.length).toBeGreaterThan(20);
      else expect(l.reason).toBe("");
    }
  });
});

// ===========================================================================
describe("L-22 — the page renders the sections from the core's order, once each", () => {
  it("asks the core for the layout", () => {
    // Pinned as an EXPRESSION, not a substring: `const boardLayout = ...`
    // assigned an empty object literal would leave every grep-style assertion
    // in this file passing while the page silently stopped reordering.
    expect(CODE).toMatch(
      /const boardLayout = decideBoardLayout\(\{\s*leaflyPendingAck\s*,?\s*\}\)/,
    );
  });

  it("feeds it the SAME count the Leafly board shows, not a second query", () => {
    // Two counts of one fact is how a screen starts contradicting itself: the
    // banner could claim an order is waiting while the board below shows none.
    expect(CODE).toContain("pendingAckCount={leaflyPendingAck}");
    expect((CODE.match(/countLeaflyOrdersAwaitingAck\(\)/g) ?? []).length).toBe(1);
  });

  it("renders both sections by mapping the core's list", () => {
    expect(CODE).toMatch(/\{boardLayout\.sections\.map\(\(section\) => \(/);
    expect(CODE).toMatch(/section === "leafly" \? leaflySection : greenwaySection/);
  });

  it("defines each section EXACTLY once — a copied board means two Acknowledge buttons", () => {
    expect((CODE.match(/const leaflySection = \(/g) ?? []).length).toBe(1);
    expect((CODE.match(/const greenwaySection = \(/g) ?? []).length).toBe(1);
    // The board component and the filter bar are the fingerprints of each
    // section. Exactly one of each in the whole file.
    expect((CODE.match(/<LeaflyOrdersPanel/g) ?? []).length).toBe(1);
    expect((CODE.match(/\{FILTERS\.map\(/g) ?? []).length).toBe(1);
  });

  it("puts the Leafly board inside the Leafly section and the order cards inside ours", () => {
    const leafly = constBlock(CODE, "leaflySection");
    const greenway = constBlock(CODE, "greenwaySection");
    expect(leafly).toContain("<LeaflyOrdersPanel");
    expect(leafly).not.toContain("{FILTERS.map(");
    expect(greenway).toContain("{FILTERS.map(");
    expect(greenway).not.toContain("<LeaflyOrdersPanel");
    // The order cards, the pager and the empty state all belong to our list.
    expect(greenway).toContain("{orders.map((order) =>");
    expect(greenway).toContain("<ListPager");
    expect(greenway).toContain("No orders match this view");
  });

  it("does not gate either section behind a dead condition", () => {
    // The L-21 mutants that survived all had this shape: markup still in the
    // file, but wired so it could never reach the screen.
    expect(CODE).not.toContain("{false &&");
    expect(CODE).not.toMatch(/const (leafly|greenway)Section = \(\s*<>\s*<\/>\s*\)/);
    expect(CODE).not.toMatch(/boardLayout\.sections\.slice\(/);
  });

  it("keeps the section list whole — nothing filters a board off the page", () => {
    expect(CODE).not.toMatch(/boardLayout\.sections\.filter\(/);
    expect(CODE).toMatch(/\{boardLayout\.sections\.map\(/);
  });
});

// ===========================================================================
describe("L-22 — a promotion is visible, never silent", () => {
  it("renders the core's explanation whenever the layout has been reordered", () => {
    expect(CODE).toMatch(/\{boardLayout\.leaflyPromoted \? \(/);
    expect(CODE).toContain("{boardLayout.reason}");
  });

  it("does not re-type the sentence in JSX, where it could drift from the rule", () => {
    // The wording belongs to the core, which owns the singular/plural and the
    // mention of the deadline and asserts both.
    expect(CODE).not.toContain("waiting to be acknowledged");
    expect(CODE).not.toMatch(/15 minutes/);
  });

  it("announces the banner to assistive tech", () => {
    const i = CODE.indexOf("{boardLayout.leaflyPromoted ? (");
    expect(i).toBeGreaterThan(-1);
    expect(CODE.slice(i, i + 700)).toContain('role="status"');
  });

  it("uses gold — the house attention colour — and not an invented token", () => {
    const i = CODE.indexOf("{boardLayout.leaflyPromoted ? (");
    const banner = CODE.slice(i, i + 700);
    expect(banner).toContain("--admin-gold");
    // There is no --admin-warning token in this codebase. Introducing one in a
    // banner is how a colour comes to mean two things on two screens.
    expect(banner).not.toContain("--admin-warning");
  });

  it("the banner appears if and only if the core promoted", () => {
    // Proven by execution, not by reading the JSX: the JSX is pinned above to
    // the same flag this exercises.
    expect(decideBoardLayout({ leaflyPendingAck: 2 }).leaflyPromoted).toBe(true);
    expect(decideBoardLayout({ leaflyPendingAck: 0 }).leaflyPromoted).toBe(false);
    expect(decideBoardLayout({ leaflyPendingAck: null }).leaflyPromoted).toBe(false);
  });
});

// ===========================================================================
describe("L-22 — the history is genuinely combined (verified, not assumed)", () => {
  it("the query has no origin filter, so Leafly rows are already in the list", () => {
    // This is the fact the whole 'combined history' request rests on. If a
    // future change adds an origin filter to this query, the owner's combined
    // table quietly stops being combined and nothing else would notice.
    const q = STORE.slice(
      STORE.indexOf("export async function listOrdersPaged"),
      STORE.indexOf("export async function listOrders("),
    );
    expect(q).toContain('admin.from("orders").select("*", { count: "exact" })');
    expect(q).not.toMatch(/\.eq\("origin"/);
    expect(q).not.toMatch(/\.in\("origin"/);
    expect(q).not.toMatch(/\.neq\("origin"/);
  });

  it("Leafly orders are written into that same table with their origin recorded", () => {
    expect(BRIDGE).toContain('origin: "leafly"');
  });

  it("our own orders are written with theirs", () => {
    expect(STORE).toContain('origin: "greenway"');
  });
});

// ===========================================================================
describe("L-22 — label everything, or label nothing, never half", () => {
  it("a shop that has never had a Leafly order keeps the quiet L-12 behaviour", () => {
    expect(
      shouldLabelWebsiteRows({
        shopReceivesLeaflyOrders: false,
        originsOnScreen: ["greenway", "greenway", null],
      }),
    ).toBe(false);
  });

  it("a shop that receives them labels BOTH kinds", () => {
    expect(
      shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: true, originsOnScreen: ["greenway"] }),
    ).toBe(true);
  });

  it("the decision is stable across pages — it does not depend on what this page happens to show", () => {
    // THE BUG THIS PREVENTS: page 1 mixed, page 2 all-website. If the rule read
    // the rows on screen, the same table would change its labelling convention
    // as the owner paged through it, and page 2 would be silently ambiguous.
    const mixedPage = ["greenway", "leafly", "greenway"];
    const websitePage = ["greenway", "greenway", "greenway"];
    const emptyPage: string[] = [];
    for (const rows of [mixedPage, websitePage, emptyPage]) {
      expect(
        shouldLabelWebsiteRows({ shopReceivesLeaflyOrders: true, originsOnScreen: rows }),
      ).toBe(true);
    }
  });

  it("the safety valve fires when the flag disagrees with the screen", () => {
    // anyOrderEverReceived degrades a failed count to false. If it is false but
    // a Leafly row is visibly on screen, the flag is what is wrong, and the page
    // must not be half-labelled on the strength of it.
    expect(
      shouldLabelWebsiteRows({
        shopReceivesLeaflyOrders: false,
        originsOnScreen: ["greenway", "leafly"],
      }),
    ).toBe(true);
  });

  it("the page passes the shop-level fact, not the rows, as the primary signal", () => {
    expect(CODE).toMatch(
      /shouldLabelWebsiteRows\(\{\s*shopReceivesLeaflyOrders: leaflySetup\.readiness\.anyOrderEverReceived,/,
    );
  });

  it("the page gives the core the real origins of the rows on screen", () => {
    expect(CODE).toMatch(/originsOnScreen: orders\.map\(\(o\) => o\.origin\)/);
    // An empty literal here would leave the safety valve permanently disarmed
    // while every other assertion still passed.
    expect(CODE).not.toMatch(/originsOnScreen: \[\]/);
  });

  it("the badge is driven by the core's answer, not hardcoded either way", () => {
    expect(CODE).toContain("<OrderOriginBadge origin={order.origin} hideWebsite={!labelWebsiteRows} />");
    // The unconditional L-12 form must be gone. `hideWebsite` with no value is
    // `true`, which is the bug this slice exists to fix.
    expect(CODE).not.toMatch(/<OrderOriginBadge origin=\{order\.origin\} hideWebsite \/>/);
  });

  it("the badge is never given a constant, which would silently re-freeze the rule", () => {
    expect(CODE).not.toMatch(/hideWebsite=\{(true|false)\}/);
  });
});

// ===========================================================================
describe("L-22 — the mix summary tells the truth about its own scope", () => {
  it("scopes itself to the current page rather than implying a shop total", () => {
    // The counts cover at most one page, after filters. Read as shop totals
    // they are simply wrong, and that is the reading a reader reaches for.
    const s = describeOriginMix(tallyOrigins(["greenway", "leafly"]), orderOriginLabel);
    expect(s.startsWith("On this page:")).toBe(true);
  });

  it("says nothing at all when every row came from the same place", () => {
    expect(describeOriginMix(tallyOrigins(["greenway", "greenway"]), orderOriginLabel)).toBe("");
    expect(describeOriginMix(tallyOrigins([]), orderOriginLabel)).toBe("");
  });

  it("counts what the reader can SEE — an unknown origin renders as Website", () => {
    // The badge renders toOrderOrigin(origin). If the tally folded values
    // differently it could report a mix the reader cannot see anywhere.
    const t = tallyOrigins(["martian", "greenway"]);
    expect(t).toEqual([{ origin: "greenway", count: 2 }]);
    expect(describeOriginMix(t, orderOriginLabel)).toBe("");
  });

  it("never names an origin outside the closed set", () => {
    const t = tallyOrigins(["leafly", "martian", null, undefined, "REGISTER", "greenway"]);
    for (const row of t) expect(ORDER_ORIGINS).toContain(row.origin);
  });

  it("its counts always add up to the rows it was given", () => {
    const rows = ["greenway", "leafly", null, "leafly", "register", "nonsense"];
    expect(tallyOrigins(rows).reduce((n, r) => n + r.count, 0)).toBe(rows.length);
  });

  it("uses the badge's own words, so the line and the badges cannot disagree", () => {
    const s = describeOriginMix(tallyOrigins(["greenway", "leafly"]), orderOriginLabel);
    expect(s).toContain(orderOriginLabel("greenway"));
    expect(s).toContain(orderOriginLabel("leafly"));
    // And the page must actually pass that function rather than re-typing words.
    expect(CODE).toMatch(/describeOriginMix\(\s*tallyOrigins\(orders\.map\(\(o\) => o\.origin\)\),\s*orderOriginLabel,?\s*\)/);
  });

  it("is rendered, and only when it has something to say", () => {
    expect(CODE).toMatch(/\{originMix \? \(/);
    expect(CODE).toContain("{originMix}");
  });

  it("does not hardcode the wording in the page", () => {
    expect(CODE).not.toContain("On this page:");
  });
});

// ===========================================================================
describe("L-22 — house rules", () => {
  it("does not re-derive a fact that already has a home (rule 11)", () => {
    // anyOrderEverReceived is echoed from assessOrderReadiness; the page must
    // not compute its own version from rows or evidence.
    expect(CODE).toContain("leaflySetup.readiness.anyOrderEverReceived");
    expect(CODE).not.toMatch(/orders\.some\(\(o\) => o\.origin === "leafly"\)/);
  });

  it("the core does not re-implement origin normalisation", () => {
    expect(CORE).toContain("toOrderOrigin");
    // A local fold would be a second opinion about what an origin means.
    expect(codeOnly(CORE)).not.toMatch(/\.trim\(\)\.toLowerCase\(\)/);
  });

  it("the L-6 reasoning is corrected in place rather than silently deleted", () => {
    // The 15-minute deadline is still why promotion exists. Anyone deleting the
    // promotion needs to find out what it was protecting.
    expect(PAGE).toContain("position revised by L-22");
    expect(PAGE).toContain("fifteen");
    // ...and the now-false claim must be gone.
    expect(PAGE).not.toContain("Placed here deliberately: directly under the status summary and");
  });

  it("the whole page still compiles as one component with balanced sections", () => {
    for (const name of ["leaflySection", "greenwaySection"]) {
      const b = constBlock(CODE, name);
      expect(b.length).toBeGreaterThan(200);
      // Balanced braces inside each extracted section.
      let depth = 0;
      for (const c of b) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    }
  });
});

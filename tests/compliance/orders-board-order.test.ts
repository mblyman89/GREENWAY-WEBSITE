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
 *
 * SLICE L-40 — the owner removed the promotion ("our system auto acknowledges
 * leafly orders, so there is no 15 minute limit … I want to remove the leafly
 * section moving above our section"). The order is now FIXED — Greenway, then
 * Leafly — and both panels render through one shared shell. The once-each
 * guarantee above is unchanged and still pinned; the promotion pins became
 * "the promotion is gone" pins.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BOARD_SECTIONS,
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
    // L-40: 57 → 35 when the 22 promotion self-tests were retired with
    // decideBoardLayout. Every label / tally / mix test is still here.
    expect(r.passed).toBeGreaterThanOrEqual(35);
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
    expect(floor).toBeGreaterThanOrEqual(30);
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
describe("L-40 — the owner's order, fixed: Greenway first, Leafly below", () => {
  it("the core's section list is exactly the owner's order", () => {
    expect([...BOARD_SECTIONS]).toEqual(["greenway", "leafly"]);
  });

  it("the promotion rule is gone from the core — nothing can reorder the page", () => {
    const code = codeOnly(CORE);
    expect(code).not.toMatch(/decideBoardLayout/);
    expect(code).not.toMatch(/leaflyPromoted/);
    expect(code).not.toMatch(/15 minutes/);
  });
});

// ===========================================================================
describe("L-22 / L-40 — the page renders each section once, in a fixed order", () => {
  it("renders Greenway then Leafly, by position, with nothing in between deciding", () => {
    const g = CODE.indexOf("{greenwaySection}");
    const l = CODE.indexOf("{leaflySection}");
    expect(g).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(g);
    expect((CODE.match(/\{greenwaySection\}/g) ?? []).length).toBe(1);
    expect((CODE.match(/\{leaflySection\}/g) ?? []).length).toBe(1);
  });

  it("no longer asks for a layout or reads the pending-ack count", () => {
    expect(CODE).not.toMatch(/boardLayout/);
    expect(CODE).not.toMatch(/decideBoardLayout/);
    expect(CODE).not.toMatch(/countLeaflyOrdersAwaitingAck\(/);
    expect(CODE).not.toMatch(/pendingAckCount=/);
  });

  it("defines each section EXACTLY once — a copied board means two Acknowledge buttons", () => {
    expect((CODE.match(/const leaflySection = \(/g) ?? []).length).toBe(1);
    expect((CODE.match(/const greenwaySection = \(/g) ?? []).length).toBe(1);
    // Each panel's fingerprint, exactly once in the whole file.
    expect((CODE.match(/<LeaflyOrdersPanel/g) ?? []).length).toBe(1);
    expect((CODE.match(/<OrdersPanel\s+panel="greenway"/g) ?? []).length).toBe(1);
  });

  it("puts the Leafly board inside the Leafly section and the order cards inside ours", () => {
    const leafly = constBlock(CODE, "leaflySection");
    const greenway = constBlock(CODE, "greenwaySection");
    expect(leafly).toContain("<LeaflyOrdersPanel");
    expect(leafly).not.toContain("<OrdersPanel");
    expect(greenway).toContain('<OrdersPanel\n      panel="greenway"');
    expect(greenway).toContain('title="Greenway orders"');
    expect(greenway).not.toContain("<LeaflyOrdersPanel");
    // The order cards belong to our list; the pager and empty state are the
    // shared shell's, so they are identical in both panels.
    expect(greenway).toContain("{orders.map((order) =>");
    expect(greenway).toContain("window={win}");
    expect(greenway).toContain("total={total}");
  });

  it("does not gate either section behind a dead condition", () => {
    // The L-21 mutants that survived all had this shape: markup still in the
    // file, but wired so it could never reach the screen.
    expect(CODE).not.toContain("{false &&");
    expect(CODE).not.toMatch(/const (leafly|greenway)Section = \(\s*<>\s*<\/>\s*\)/);
  });
});

// ===========================================================================
describe("L-40 — the promotion banner and its deadline copy are gone", () => {
  it("no banner, no gold 'shown first' notice", () => {
    expect(CODE).not.toContain("leaflyPromoted");
    expect(CODE).not.toContain("shown first");
    expect(CODE).not.toContain("waiting to be acknowledged");
  });

  it("no deadline copy anywhere a person reads it on this page", () => {
    expect(CODE).not.toMatch(/15 minutes/);
    expect(CODE).not.toMatch(/on the clock/);
    expect(CODE).not.toMatch(/arrive with a deadline/);
  });
});

// ===========================================================================
describe("L-22 — the history is genuinely combined (verified, not assumed)", () => {
  it("the query filters ONLY by an explicit, opt-in origin exclusion (L-38)", () => {
    // HISTORY. L-22 pinned "no origin filter at all", because the owner then
    // wanted one combined table. L-38 reversed that on his instruction: Leafly
    // orders now have their own section and must NOT appear in the online-
    // orders table (open, closed or searched). The exclusion is opt-in and
    // passed by the dashboard only, so every other reader of this query still
    // sees every origin — and it is the ONLY way an origin filter may enter.
    const q = STORE.slice(
      STORE.indexOf("export async function listOrdersPaged"),
      STORE.indexOf("export async function listOrders("),
    );
    expect(q).toContain('admin.from("orders").select("*", { count: "exact" })');
    expect(q).not.toMatch(/\.eq\("origin"/);
    expect(q).not.toMatch(/\.in\("origin"/);
    expect(q).not.toMatch(/\.neq\("origin"/);
    // Exactly one origin filter, guarded by the opt-in option.
    expect(q.match(/\.not\("origin"/g) ?? []).toHaveLength(1);
    expect(q).toMatch(/filter\.excludeOrigins\s*\?\s*excludedOriginsFilter\(filter\.excludeOrigins\)\s*:\s*null/);
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
    // L-40: passed to the shared panel as its `summary`, so no leading brace.
    expect(CODE).toMatch(/summary=\{\s*originMix \? \(/);
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
    // L-40 removed the promotion; the comment still says what it protected
    // (Leafly's fifteen-minute auto-cancel) and what covers that now.
    expect(PAGE).toContain("L-40: position fixed, below ours");
    expect(PAGE).toContain("fifteen");
    expect(PAGE).toContain("Not accepted automatically");
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

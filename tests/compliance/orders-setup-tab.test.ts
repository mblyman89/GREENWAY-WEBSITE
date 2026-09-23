/**
 * tests/compliance/orders-setup-tab.test.ts
 *
 * SLICE L-21 — the setup tab.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
 * ===========================================================================
 * Three slices running, the same lesson has bitten: a `grep` assertion proves
 * only that a string appears in a file. It cannot tell the difference between
 * a panel that MOVED and a panel that was COPIED, between a signal that is
 * rendered and one that is computed and dropped on the floor.
 *
 * So the structural claims here are made against the PARSED page — matched
 * brace/paren depth inside the JSX ternary — rather than against line numbers
 * or bare substrings, and every judgement claim is made by EXECUTING the core.
 * The render-level proof lives in orders-setup-tab-render.test.tsx.
 *
 * The bar for this slice: prove the panels moved, prove nothing that used to
 * shout has gone quiet, and prove that nothing links to a place that no longer
 * exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_ORDERS_TAB,
  ORDERS_TABS,
  announcerStartsOpen,
  leaflyBoardRendersNothing,
  ordersTabHref,
  ordersTabSignals,
  resolveOrdersTab,
  setupAnchorHref,
  setupTabNeedsAttention,
  urgentSignals,
  __runOrdersTabsTests,
  type OrdersTabInput,
} from "../../src/lib/admin/orders-tabs-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PAGE = read("src/app/admin/orders/page.tsx");
const ACTIONS = read("src/app/admin/orders/actions.ts");
const ANNOUNCER = read("src/components/admin/orders/AnnouncerPanel.tsx");
const LEAFLY_BOARD = read("src/components/admin/orders/LeaflyOrdersPanel.tsx");
const HARNESS = read("scripts/compliance/run-pure-selftests.ts");

/**
 * Strip comments and string literals before asserting on structure.
 *
 * Learned the hard way in L-20: an assertion that a file does NOT contain
 * something matched the doc comment explaining why the file does not contain
 * it. A test that fails on its own prose is a test nobody trusts.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Extract the two JSX branches of `{tab === "setup" ? ( ... ) : ( ... )}` by
 * counting bracket depth, so "which tab is this panel on?" is answered by
 * PARSING rather than by hoping a substring lands on the right side of a line.
 */
function tabBranches(src: string): { setup: string; orders: string } {
  const start = src.indexOf('{tab === "setup" ? (');
  expect(start, "the page must branch on the resolved tab").toBeGreaterThan(-1);

  let i = src.indexOf("(", start + '{tab === "setup" ?'.length);
  let depth = 0;
  let setupEnd = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        setupEnd = i;
        break;
      }
    }
  }
  expect(setupEnd, "the setup branch must be balanced").toBeGreaterThan(-1);
  const setup = src.slice(start, setupEnd);

  const colon = src.indexOf(":", setupEnd);
  const oStart = src.indexOf("(", colon);
  depth = 0;
  let ordersEnd = -1;
  for (i = oStart; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        ordersEnd = i;
        break;
      }
    }
  }
  expect(ordersEnd, "the orders branch must be balanced").toBeGreaterThan(-1);
  return { setup, orders: src.slice(oStart, ordersEnd) };
}

/**
 * Extract a balanced `const <name> = ( ... );` initialiser.
 *
 * SLICE L-22 restructured the orders tab: the two order sections are now built
 * into one const each and rendered from the order the pure core returns, so
 * the layout is data. That indirection is deliberate (it is what makes
 * "Greenway first, Leafly below" testable, and what guarantees each board is
 * defined exactly once) but it means the orders BRANCH no longer contains the
 * board markup literally — it contains a reference to it.
 *
 * The L-21 claim is unchanged and still worth pinning: the order boards are on
 * the orders tab and NOT on the setup tab. So rather than weaken the
 * assertions, the branch is EXPANDED by substituting the section bodies in.
 */
function constBlock(src: string, name: string): string {
  const needle = `const ${name} = (`;
  const start = src.indexOf(needle);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start + needle.length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return "";
}

const SECTION_CONSTS = ["leaflySection", "greenwaySection"] as const;

function expandSections(branch: string, src: string): string {
  let out = branch;
  for (const name of SECTION_CONSTS) {
    if (branch.includes(name)) out += "\n" + constBlock(src, name);
  }
  return out;
}

const RAW_BRANCHES = tabBranches(PAGE);
const BRANCHES = {
  // Expanding is only SAFE because the setup branch is proven below to
  // reference neither section. If it ever did, this would hide a real leak.
  orders: expandSections(RAW_BRANCHES.orders, PAGE),
  setup: RAW_BRANCHES.setup,
};

describe("L-22 — the section indirection does not smuggle order boards onto the setup tab", () => {
  it("the setup tab references neither order section", () => {
    for (const name of SECTION_CONSTS) {
      expect(RAW_BRANCHES.setup).not.toContain(name);
    }
  });

  it("the orders tab is what renders them", () => {
    for (const name of SECTION_CONSTS) {
      expect(RAW_BRANCHES.orders).toContain(name);
    }
  });

  it("each section is defined exactly once, so no board can be rendered twice", () => {
    const code = codeOnly(PAGE);
    for (const name of SECTION_CONSTS) {
      expect((code.match(new RegExp(`const ${name} = \\(`, "g")) ?? []).length).toBe(1);
    }
  });
});

describe("L-21 — the pure core is registered and green", () => {
  it("every self-test passes", () => {
    const r = __runOrdersTabsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("is wired into the compliance harness with a floor", () => {
    expect(HARNESS).toContain("orders-tabs-core");
    expect(HARNESS).toMatch(/assertRan\("orders-tabs-core", __runOrdersTabsTests\(\), \d+\)/);
  });

  it("the floor is real — it cannot pass with the suite gutted", () => {
    const m = HARNESS.match(/assertRan\("orders-tabs-core", __runOrdersTabsTests\(\), (\d+)\)/);
    expect(m).not.toBeNull();
    const floor = Number(m![1]);
    // High enough to notice deletions, low enough not to break on growth.
    expect(floor).toBeGreaterThanOrEqual(40);
    expect(floor).toBeLessThanOrEqual(__runOrdersTabsTests().passed);
  });
});

describe("L-21 — tab resolution never strands anybody on a settings screen", () => {
  it("defaults to the orders board", () => {
    expect(DEFAULT_ORDERS_TAB).toBe("orders");
    expect(resolveOrdersTab(undefined)).toBe("orders");
  });

  it.each([
    ["setupp", "orders"],
    ["", "orders"],
    ["SETUP", "setup"],
    ["  setup ", "setup"],
    ["orders", "orders"],
  ])("resolveOrdersTab(%j) -> %j", (raw, want) => {
    expect(resolveOrdersTab(raw)).toBe(want);
  });

  it.each([null, undefined, 0, 1, {}, [], ["setup"], true])(
    "non-string %j falls back to the orders board",
    (raw) => {
      expect(resolveOrdersTab(raw)).toBe("orders");
    },
  );

  it("every href round-trips back to its own tab", () => {
    for (const t of ORDERS_TABS) {
      const href = ordersTabHref(t);
      const q = href.includes("?tab=") ? href.split("?tab=")[1] : undefined;
      expect(resolveOrdersTab(q)).toBe(t);
    }
  });

  it("the orders tab is the clean, bookmarkable URL", () => {
    expect(ordersTabHref("orders")).toBe("/admin/orders");
  });
});

describe("L-21 — the panels actually MOVED (not copied)", () => {
  const onSetupOnly = (needle: string, what: string) => {
    it(`${what} is on the setup tab and nowhere else`, () => {
      expect(BRANCHES.setup, `${what} must be on the setup tab`).toContain(needle);
      expect(BRANCHES.orders, `${what} must NOT be left on the orders tab`).not.toContain(needle);
    });
  };

  onSetupOnly("<AnnouncerPanel />", "the announcer panel");
  onSetupOnly("<OrderNamePoolManager", "the order name pool");
  onSetupOnly("<LeaflyOrderSetupPanel", "the Leafly setup panel");
  onSetupOnly("Send test print", "the printer status bar");

  it("the orders board itself stays on the orders tab", () => {
    expect(BRANCHES.orders).toContain("<LeaflyOrdersPanel");
    expect(BRANCHES.setup).not.toContain("<LeaflyOrdersPanel");
  });

  it("the order history table stays on the orders tab", () => {
    expect(BRANCHES.orders).toContain("<OrderOriginBadge");
    expect(BRANCHES.setup).not.toContain("<OrderOriginBadge");
  });

  it("the stat cards stay on the orders tab", () => {
    expect(BRANCHES.orders).toContain("<StatCard");
    expect(BRANCHES.setup).not.toContain("<StatCard");
  });

  it("the new-order watcher stays on the orders tab — it is the thing that chimes", () => {
    expect(BRANCHES.orders).toContain("<NewOrderAlert />");
    expect(BRANCHES.setup).not.toContain("<NewOrderAlert />");
  });

  it("renders the panels in the order the owner asked for", () => {
    const s = BRANCHES.setup;
    const printer = s.indexOf("Send test print");
    const pool = s.indexOf("<OrderNamePoolManager");
    const announcer = s.indexOf("<AnnouncerPanel />");
    const leafly = s.indexOf("<LeaflyOrderSetupPanel");
    expect(printer).toBeGreaterThan(-1);
    expect(pool).toBeGreaterThan(printer);
    expect(announcer).toBeGreaterThan(pool);
    expect(leafly).toBeGreaterThan(announcer);
  });
});

describe("L-21 — the panel moves, the ALARM does not", () => {
  const CALM: OrdersTabInput = {
    printerNeedsAttention: false,
    announcerSilent: false,
    activeCount: 0,
    leaflyBlockingSteps: 0,
    leaflyEverReceived: true,
  };

  it("a healthy shop shows no strip at all — it cannot become furniture", () => {
    expect(ordersTabSignals(CALM)).toHaveLength(0);
    expect(urgentSignals(CALM)).toHaveLength(0);
    expect(setupTabNeedsAttention(CALM)).toBe(false);
  });

  it("a dead printer with live orders still reaches the orders board", () => {
    const input = { ...CALM, printerNeedsAttention: true, activeCount: 3 };
    const urgent = urgentSignals(input);
    expect(urgent).toHaveLength(1);
    expect(urgent[0].id).toBe("printer_offline");
    expect(urgent[0].message).toContain("3 live orders");
    expect(urgent[0].action.length).toBeGreaterThan(10);
  });

  it("a silent announcer still reaches the orders board", () => {
    const urgent = urgentSignals({ ...CALM, announcerSilent: true });
    expect(urgent).toHaveLength(1);
    expect(urgent[0].id).toBe("announcer_silent");
    expect(urgent[0].message).toContain("silently");
  });

  it("unfinished Leafly SETUP never reaches the orders board", () => {
    const input = { ...CALM, leaflyBlockingSteps: 4, leaflyEverReceived: false };
    expect(urgentSignals(input)).toHaveLength(0);
    // ...but it is not silently dropped either: it marks the tab.
    expect(setupTabNeedsAttention(input)).toBe(true);
    expect(ordersTabSignals(input)[0].severity).toBe("info");
  });

  it("a shop already taking Leafly orders is never nagged about setup", () => {
    expect(
      ordersTabSignals({ ...CALM, leaflyBlockingSteps: 3, leaflyEverReceived: true }),
    ).toHaveLength(0);
  });

  it("the printer leads when everything is wrong at once", () => {
    const all = ordersTabSignals({
      printerNeedsAttention: true,
      announcerSilent: true,
      activeCount: 2,
      leaflyBlockingSteps: 2,
      leaflyEverReceived: false,
    });
    expect(all.map((s) => s.id)).toEqual([
      "printer_offline",
      "announcer_silent",
      "leafly_incomplete",
    ]);
  });

  it("the PAGE renders the urgent signals, rather than computing and discarding them", () => {
    expect(BRANCHES.orders).toContain("orderBoardSignals.map");
    // The strip belongs on the orders tab, not on the tab that holds the panels.
    expect(BRANCHES.setup).not.toContain("orderBoardSignals.map");
  });

  /**
   * ── THE SIX MUTANTS THAT SURVIVED THE FIRST PROBE RUN ────────────────────
   * Every one of them was the same trick: leave the markup in the file, but
   * stop it ever reaching the screen — `{false && ...}`, or an assignment
   * replaced by a literal that still mentions the right function in its type.
   * The file still "contained" everything the greps looked for.
   *
   * These assertions pin the FORM of the expression, not its presence.
   */
  it("the alarm strip is actually reachable — no dead-code guard in front of it", () => {
    expect(BRANCHES.orders).toContain("{orderBoardSignals.length > 0 ? (");
  });

  it("the signals are assigned from a real call, not from an empty literal", () => {
    const code = codeOnly(PAGE);
    expect(code).toMatch(/const orderBoardSignals = urgentSignals\(\s*tabInput\s*\)/);
    expect(code).not.toMatch(/const orderBoardSignals[^=]*=\s*\[\s*\]/);
  });

  it("the tab is resolved from the URL, not pinned to a constant", () => {
    const code = codeOnly(PAGE);
    expect(code).toMatch(/const tab = resolveOrdersTab\(\s*sp\.tab\s*\)/);
    expect(code).not.toMatch(/const tab = ["']/);
  });

  it("the attention dot is actually reachable", () => {
    // The dot lives in the tab bar, which sits ABOVE the branch — it has to,
    // because it must be visible from whichever tab you are on.
    expect(PAGE).toContain("{setupNeedsAttention ? (");
    const nav = PAGE.slice(PAGE.indexOf('aria-label="Orders tabs"'), PAGE.indexOf('{tab === "setup" ? ('));
    expect(nav).toContain("setupNeedsAttention");
  });

  it("the M-2 pointer is actually reachable", () => {
    expect(BRANCHES.orders).toContain("{leaflyBoardRendersNothing({");
  });

  it("nothing on this page is disabled with a `false &&` guard", () => {
    // A guard like that renders nothing while leaving the markup in place —
    // invisible to every assertion that only asks whether a file mentions a
    // component. It is also, occasionally, how a debugging session ends.
    expect(codeOnly(PAGE)).not.toMatch(/\{\s*false\s*&&/);
  });

  it("the page reads the announcer verdict instead of re-deriving 'silent'", () => {
    const code = codeOnly(PAGE);
    expect(code).toContain("announcerData.verdict.willAnnounce");
    // A second opinion assembled from device rows is exactly the drift that
    // produced the L-19 email bug.
    expect(code).not.toContain("devices.filter");
  });

  it("a never-installed announcer is a setup state, not an alarm", () => {
    const code = codeOnly(PAGE);
    expect(code).toContain("announcerData.notInstalled");
  });
});

describe("L-21 — nothing links to a place that no longer exists", () => {
  it("the Leafly board's announcer jump crosses the tab boundary", () => {
    const code = codeOnly(LEAFLY_BOARD);
    expect(code).toContain("setupAnchorHref(ANNOUNCER_PANEL_ANCHOR)");
    // The old bare fragment would now scroll nowhere at all.
    expect(code).not.toContain("href={`#${ANNOUNCER_PANEL_ANCHOR}`}");
  });

  it("the cross-tab href actually names the setup tab", () => {
    expect(setupAnchorHref("order-announcer")).toBe("/admin/orders?tab=setup#order-announcer");
    expect(resolveOrdersTab("setup")).toBe("setup");
  });

  it("the announcer panel still carries the anchor it is linked by", () => {
    expect(ANNOUNCER).toContain("ANNOUNCER_PANEL_ANCHOR");
    expect(ANNOUNCER).toContain("id={ANNOUNCER_PANEL_ANCHOR}");
  });

  it("pool actions return to the tab that shows their banner", () => {
    const code = codeOnly(ACTIONS);
    expect(code).toContain("ORDERS_SETUP_BASE");
    // The old redirect landed on the orders board, where the confirmation
    // banner would have rendered on a tab nobody was looking at.
    expect(code).not.toContain("${ORDERS_BASE}?pool=1");
    expect(code).not.toContain("${ORDERS_BASE}?printTest=1");
  });

  it("the setup redirect target is a real setup URL", () => {
    const m = ACTIONS.match(/const ORDERS_SETUP_BASE = `\$\{ORDERS_BASE\}\?tab=(\w+)`/);
    expect(m).not.toBeNull();
    expect(resolveOrdersTab(m![1])).toBe("setup");
  });
});

describe("L-21 — the M-2 blank-space fix survived the move", () => {
  it("the orders tab explains an empty Leafly board", () => {
    expect(BRANCHES.orders).toContain("leaflyBoardRendersNothing(");
    expect(BRANCHES.orders).toContain('ordersTabHref("setup")');
  });

  it("the board and the page share ONE emptiness predicate", () => {
    const code = codeOnly(LEAFLY_BOARD);
    expect(code).toContain("leaflyBoardRendersNothing({");
    // The re-typed condition would drift from the page's copy.
    expect(code).not.toContain(
      "!hasOrders && !hasProblem && !hasOutcome && !board.orderIntegrationKeyPresent",
    );
  });

  it("the predicate is true only when the board really shows nothing", () => {
    const quiet = {
      hasOrders: false,
      hasProblem: false,
      hasOutcome: false,
      orderIntegrationKeyPresent: false,
    };
    expect(leaflyBoardRendersNothing(quiet)).toBe(true);
    for (const k of [
      "hasOrders",
      "hasProblem",
      "hasOutcome",
      "orderIntegrationKeyPresent",
    ] as const) {
      expect(leaflyBoardRendersNothing({ ...quiet, [k]: true })).toBe(false);
    }
  });
});

describe("L-21 — collapsed must never mean silent", () => {
  it("a healthy announcer collapses, as asked", () => {
    expect(announcerStartsOpen({ willAnnounce: true, notInstalled: false })).toBe(false);
  });

  it("a shop that will not announce gets the panel opened for it", () => {
    expect(announcerStartsOpen({ willAnnounce: false, notInstalled: false })).toBe(true);
  });

  it("a never-installed announcer stays collapsed", () => {
    expect(announcerStartsOpen({ willAnnounce: false, notInstalled: true })).toBe(false);
  });

  it("the panel asks the core rather than deciding for itself", () => {
    expect(ANNOUNCER).toContain("announcerStartsOpen(");
    expect(ANNOUNCER).toContain("defaultOpen={announcerStartsOpen(");
  });

  /**
   * SURVIVOR #6 from the first probe run: the speaker count was deleted from
   * the collapsed bar and nothing failed, because the render test builds its
   * own badge from the same props rather than reading the panel's.
   *
   * The count on the bar is the entire justification for collapsing the panel
   * — without it you have to open the thing to learn whether you will hear the
   * next order, which is worse than before the slice. So it is pinned here,
   * against the REAL component's badge prop.
   */
  it("the collapsed bar carries the live speaker count", () => {
    const code = codeOnly(ANNOUNCER);
    const badge = code.indexOf("badge={");
    expect(badge, "the announcer must pass a badge to the shared bar").toBeGreaterThan(-1);
    const close = code.indexOf("}\n    >", badge);
    const inside = code.slice(badge, close);

    expect(inside).toContain("verdict.onlineCount");
    expect(inside).toContain("verdict.totalCount");
    expect(inside).toContain("speaker");
    // Singular/plural, so the bar never reads "1 speakers online".
    expect(inside).toContain('verdict.totalCount === 1 ? "" : "s"');
  });

  it("the badge is not hidden from the page it is meant to inform", () => {
    const code = codeOnly(ANNOUNCER);
    const badge = code.indexOf("badge={");
    const inside = code.slice(badge, code.indexOf("}\n    >", badge));
    expect(inside).not.toContain("hidden");
    expect(inside).not.toContain("display:none");
    expect(inside).not.toContain("sr-only");
  });

  it("the badge is tinted by the verdict, so a bad count is visibly bad", () => {
    const code = codeOnly(ANNOUNCER);
    const badge = code.indexOf("badge={");
    const inside = code.slice(badge, code.indexOf("}\n    >", badge));
    expect(inside).toContain("verdict.willAnnounce");
    expect(inside).toContain("--admin-danger");
    expect(inside).toContain("--admin-accent");
  });

  it("the MAIN panel is the shared bar, not a hand-rolled one", () => {
    const code = codeOnly(ANNOUNCER);
    // The claim is specifically about the OUTERMOST element of the healthy
    // render path. The panel also contains several long-standing inner
    // <details> (the sound library, the activity log); those are nested
    // disclosures inside the body, not competitors to the bar, and this slice
    // deliberately does not churn them.
    expect(code).toContain("<DisclosurePanel");
    expect(code).toContain("</DisclosurePanel>");

    // The old hand-rolled outer shell is gone: the panel used to open with a
    // <section> carrying the anchor and its own border/background.
    expect(code).not.toContain(
      '<section\n      id={ANNOUNCER_PANEL_ANCHOR}\n      className="mt-4 rounded-',
    );

    // The anchor now rides on the shared primitive, which is what makes the
    // cross-tab jump land.
    expect(code).toContain("id={ANNOUNCER_PANEL_ANCHOR}");
    const open = code.indexOf("<DisclosurePanel");
    const anchor = code.indexOf("id={ANNOUNCER_PANEL_ANCHOR}", open);
    const close = code.indexOf(">", anchor);
    expect(anchor).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(anchor);
  });
});

describe("L-21 — one database read, one answer", () => {
  it("the announcer verdict is read through the cached reader", () => {
    const store = read("src/lib/announcer/announcer-admin-store.ts");
    expect(store).toContain("getAnnouncerPanelDataCached");
    expect(store).toContain('from "react"');
    expect(codeOnly(ANNOUNCER)).toContain("getAnnouncerPanelDataCached()");
    expect(codeOnly(PAGE)).toContain("getAnnouncerPanelDataCached()");
  });

  it("the page joins the existing Promise.all — no extra round trip", () => {
    const code = codeOnly(PAGE);
    const all = code.indexOf("await Promise.all([");
    const call = code.indexOf("getAnnouncerPanelDataCached()", all);
    const close = code.indexOf("]);", all);
    expect(all).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(all);
    expect(call).toBeLessThan(close);
  });

  it("the tab dot and the setup badge count the same steps", () => {
    const panel = read("src/components/admin/orders/LeaflyOrderSetupPanel.tsx");
    const expr = "steps.filter((s) => !s.done && s.blocking).length";
    expect(codeOnly(PAGE)).toContain(expr);
    expect(codeOnly(panel)).toContain("filter((s) => !s.done && s.blocking).length");
  });
});

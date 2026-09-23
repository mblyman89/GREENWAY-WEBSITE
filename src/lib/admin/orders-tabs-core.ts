/**
 * src/lib/admin/orders-tabs-core.ts
 *
 * SLICE L-21 — THE SETUP TAB, AND THE RULE THAT KEEPS IT SAFE.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION
 * ===========================================================================
 *   "A new tab at the top containing: receipt printer status bar → order name
 *    pool (collapsed) → order announcer panel (made collapsible, collapsed) →
 *    Leafly setup panel at the bottom."
 *
 * The orders dashboard has grown four equipment/configuration panels that sit
 * between the owner and the thing he actually opened the page for: the
 * orders. Moving them to their own tab is plainly right.
 *
 * ===========================================================================
 * THE TRAP, AND WHY THIS FILE EXISTS
 * ===========================================================================
 * A tab is a place things go to be forgotten. Three of these four panels are
 * pure configuration and can be forgotten safely. But they also carry LIVE
 * WARNINGS, and a warning on a tab nobody is looking at is not a warning:
 *
 *   - "auto-print is on, you have live orders, and the printer has not
 *      checked in" — receipts are silently not printing, RIGHT NOW.
 *   - "no speakers are online" — orders are arriving in silence, and a
 *      silent arrival is worse than no arrival: the order is real, the
 *      15-minute Leafly clock is running, and nobody has been told.
 *
 * Both of those were previously impossible to miss, because the panels were
 * bolted to the top of the orders page. Move them wholesale behind a tab and
 * this slice would make the shop QUIETER while appearing to tidy it up —
 * exactly the alert-fatigue failure mode L-19 was careful to avoid.
 *
 * So the rule is: the PANEL moves, the ALARM does not. `ordersTabSignals()`
 * decides which conditions are urgent enough to stay on the orders tab (as a
 * compact strip) and to mark the setup tab itself. Nothing is hidden that was
 * previously shouting.
 *
 * This file owns that judgement so no screen can disagree with it.
 */

/** The two tabs on /admin/orders. */
export const ORDERS_TABS = ["orders", "setup"] as const;
export type OrdersTab = (typeof ORDERS_TABS)[number];

export const DEFAULT_ORDERS_TAB: OrdersTab = "orders";

/**
 * Resolve `?tab=` into a tab.
 *
 * Anything unrecognised — a typo, a stale bookmark, a hand-edited URL —
 * resolves to the ORDERS tab, never to setup. The orders board is the one
 * with the 15-minute deadline on it; a bad query string must not be able to
 * land somebody on a configuration screen while a customer is waiting.
 */
export function resolveOrdersTab(raw: unknown): OrdersTab {
  if (typeof raw !== "string") return DEFAULT_ORDERS_TAB;
  const v = raw.trim().toLowerCase();
  return (ORDERS_TABS as readonly string[]).includes(v) ? (v as OrdersTab) : DEFAULT_ORDERS_TAB;
}

/** Build the href for a tab, preserving nothing else on purpose. */
export function ordersTabHref(tab: OrdersTab): string {
  // The orders tab is the canonical, parameterless URL so the page a person
  // bookmarks is the page they actually want. Carrying filters across a tab
  // switch would restore a filtered board from a settings screen, which is
  // confusing rather than helpful.
  return tab === DEFAULT_ORDERS_TAB ? "/admin/orders" : `/admin/orders?tab=${tab}`;
}

/**
 * The href for a panel that now lives on the SETUP tab, linked to from the
 * ORDERS tab.
 *
 * ── WHY THIS EXISTS (a bug this slice would otherwise have created) ────────
 * LeaflyOrdersPanel.tsx:640 links to `#order-announcer` as a bare fragment,
 * with a comment explaining that the announcer panel is "rendered ABOVE this
 * one on the same page". That was true. After this slice it is false: the
 * announcer moves to the setup tab, so the element is no longer in the
 * document and a bare `#order-announcer` scrolls nowhere at all — a link that
 * silently does nothing, which is the exact complaint that started this whole
 * round ("confirm the action, then it sits waiting forever").
 *
 * The link is shown when an order ARRIVED BUT NEVER ANNOUNCED, so it is the
 * one link on the page most likely to be clicked in a hurry by somebody who
 * has just been told a customer is waiting and nobody heard. It has to work.
 *
 * A full path plus fragment crosses the tab and still lands on the panel.
 */
export function setupAnchorHref(anchor: string): string {
  const clean = anchor.trim().replace(/^#+/, "");
  const base = ordersTabHref("setup");
  return clean ? `${base}#${clean}` : base;
}

/**
 * Should the ANNOUNCER panel start expanded?
 *
 * The owner asked for it collapsed, and collapsed is the answer whenever the
 * shop is healthy. But "collapsed" and "silent" must never happen at the same
 * time: if no speaker will play the next order, the panel that says so is the
 * only thing on the screen that can explain why the shop has gone quiet, and
 * a person who does not already know to open it will not open it.
 *
 * So the rule is the same one L-20 settled on for the Leafly setup panel:
 * collapse when there is nothing to say, open when hiding it would hide a
 * problem. The speaker count rides on the collapsed bar either way, so the
 * healthy case is still answerable without a click.
 */
export function announcerStartsOpen(input: {
  willAnnounce: boolean;
  notInstalled: boolean;
}): boolean {
  // Not installed is a setup state, not a fault: nothing is broken, the
  // feature was simply never switched on. That does not earn an open panel
  // every single page load.
  if (input.notInstalled) return false;
  return !input.willAnnounce;
}


/**
 * Will the Leafly board render nothing at all?
 *
 * ── WHY THE PAGE IS ALLOWED TO ASK THIS ───────────────────────────────────
 * This predicate lives in LeaflyOrdersPanel as its early `return null`, and
 * it is the exact line that produced the M-2 report: "there is nothing in the
 * online orders dashboard page that has a Leafly orders section". The fix was
 * LeaflyOrderSetupPanel, rendered directly above the board, explaining the
 * blank space.
 *
 * L-21 moves that setup panel to the setup tab — which would quietly undo the
 * M-2 fix, because the orders tab would go back to having an unexplained gap
 * where Leafly should be. So the orders tab keeps a one-line pointer instead
 * of the whole panel, and it must appear under EXACTLY the conditions in
 * which the board renders nothing.
 *
 * "Exactly" is the whole point. If the page re-typed the condition, the two
 * would drift and the pointer would appear over a populated board or, worse,
 * not appear over an empty one. So the predicate is stated once, here, and
 * both the panel and the page call it (house rule 11).
 */
export function leaflyBoardRendersNothing(input: {
  hasOrders: boolean;
  hasProblem: boolean;
  hasOutcome: boolean;
  orderIntegrationKeyPresent: boolean;
}): boolean {
  return (
    !input.hasOrders &&
    !input.hasProblem &&
    !input.hasOutcome &&
    !input.orderIntegrationKeyPresent
  );
}

/* ------------------------------------------------------------------------ *
 * What must never be hidden
 * ------------------------------------------------------------------------ */

export type OrdersTabInput = {
  /** Printer is set up AND auto-print is on AND it has not checked in AND orders are live. */
  printerNeedsAttention: boolean;
  /** The announcer is installed and configured, but no speaker is online. */
  announcerSilent: boolean;
  /** Orders that are live right now. */
  activeCount: number;
  /** Leafly setup has unfinished BLOCKING steps. */
  leaflyBlockingSteps: number;
  /** Any Leafly order has ever arrived. */
  leaflyEverReceived: boolean;
};

export type TabSignal = {
  id: "printer_offline" | "announcer_silent" | "leafly_incomplete";
  /** Short enough to sit in a strip above the orders board. */
  message: string;
  /** What to do, in plain language. */
  action: string;
  /**
   * `urgent` means something is going wrong RIGHT NOW and a person must see
   * it without opening a tab. `info` means it is worth flagging on the tab
   * label but does not belong on the orders board.
   */
  severity: "urgent" | "info";
};

/**
 * Which alarms survive the move to a tab.
 *
 * ── THE JUDGEMENT, STATED OPENLY ────────────────────────────────────────
 * Only two conditions are `urgent`, and both share one property: a customer
 * is affected right now and nobody in the building knows.
 *
 * Unfinished Leafly SETUP is deliberately NOT urgent, however many steps are
 * outstanding. Nothing is failing — a thing has simply not been switched on
 * yet, and it has been that way for days. Putting it on the orders board
 * every single page load is precisely how a shop learns to ignore the strip,
 * taking the two real alarms with it. It gets a dot on the tab instead.
 */
export function ordersTabSignals(input: OrdersTabInput): TabSignal[] {
  const out: TabSignal[] = [];

  if (input.printerNeedsAttention) {
    out.push({
      id: "printer_offline",
      message:
        `Receipts may not be printing. You have ${input.activeCount} live ` +
        `order${input.activeCount === 1 ? "" : "s"} and auto-print is on, but the printer ` +
        `has not checked in recently.`,
      action: "Check it is powered on and connected, then send a test print.",
      severity: "urgent",
    });
  }

  if (input.announcerSilent) {
    out.push({
      id: "announcer_silent",
      message: "No speaker is online, so new orders are arriving silently.",
      action: "Check the speaker is powered on and connected to the internet.",
      severity: "urgent",
    });
  }

  if (input.leaflyBlockingSteps > 0 && !input.leaflyEverReceived) {
    out.push({
      id: "leafly_incomplete",
      message:
        `Leafly orders are not set up yet — ${input.leaflyBlockingSteps} ` +
        `step${input.leaflyBlockingSteps === 1 ? "" : "s"} remaining.`,
      action: "Open the Setup & equipment tab to finish.",
      severity: "info",
    });
  }

  return out;
}

/** The signals that must appear on the ORDERS tab, not just the setup tab. */
export function urgentSignals(input: OrdersTabInput): TabSignal[] {
  return ordersTabSignals(input).filter((s) => s.severity === "urgent");
}

/**
 * Does the setup tab deserve a marker in the tab bar?
 *
 * True for anything worth knowing, urgent or not — the dot is the cheap,
 * always-visible hint that pays for the panels having moved out of sight.
 */
export function setupTabNeedsAttention(input: OrdersTabInput): boolean {
  return ordersTabSignals(input).length > 0;
}

/* ───────────────────────────── self-tests ───────────────────────────── */

const CALM: OrdersTabInput = {
  printerNeedsAttention: false,
  announcerSilent: false,
  activeCount: 0,
  leaflyBlockingSteps: 0,
  leaflyEverReceived: true,
};

export function __runOrdersTabsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (what: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[orders-tabs-core] FAIL: ${what}`);
    }
  };

  // ── resolveOrdersTab ───────────────────────────────────────────────────
  ok("the default is the orders board", resolveOrdersTab(undefined) === "orders");
  ok("an explicit setup tab is honoured", resolveOrdersTab("setup") === "setup");
  ok("an explicit orders tab is honoured", resolveOrdersTab("orders") === "orders");
  ok("case is ignored", resolveOrdersTab("SETUP") === "setup");
  ok("surrounding space is ignored", resolveOrdersTab("  setup  ") === "setup");
  // A typo must land on the ORDERS board, never on a settings screen.
  ok("a typo falls back to orders", resolveOrdersTab("setupp") === "orders");
  ok("an empty string falls back to orders", resolveOrdersTab("") === "orders");
  ok("null falls back to orders", resolveOrdersTab(null) === "orders");
  ok("a number falls back to orders", resolveOrdersTab(3) === "orders");
  ok("an object falls back to orders", resolveOrdersTab({}) === "orders");
  ok("an array falls back to orders", resolveOrdersTab(["setup"]) === "orders");
  ok(
    "every declared tab resolves to itself",
    ORDERS_TABS.every((t) => resolveOrdersTab(t) === t),
  );

  // ── ordersTabHref ──────────────────────────────────────────────────────
  ok("the orders tab is the clean URL", ordersTabHref("orders") === "/admin/orders");
  ok("the setup tab carries the param", ordersTabHref("setup") === "/admin/orders?tab=setup");
  ok(
    "every href round-trips through the resolver",
    ORDERS_TABS.every((t) => {
      const href = ordersTabHref(t);
      const q = href.includes("?tab=") ? href.split("?tab=")[1] : undefined;
      return resolveOrdersTab(q) === t;
    }),
  );

  // ── Cross-tab anchors ─────────────────────────────────────────────────
  // A bare "#order-announcer" would scroll nowhere once the panel moves.
  ok(
    "a setup anchor crosses the tab boundary",
    setupAnchorHref("order-announcer") === "/admin/orders?tab=setup#order-announcer",
  );
  ok(
    "it is never a bare fragment",
    setupAnchorHref("order-announcer").startsWith("#") === false,
  );
  ok(
    "it carries the tab param, so the panel is actually rendered",
    setupAnchorHref("order-announcer").includes("tab=setup"),
  );
  ok("a leading hash is tolerated", setupAnchorHref("#x") === "/admin/orders?tab=setup#x");
  ok("repeated hashes are tolerated", setupAnchorHref("##x") === "/admin/orders?tab=setup#x");
  ok("space is trimmed", setupAnchorHref("  x  ") === "/admin/orders?tab=setup#x");
  ok("an empty anchor degrades to the tab itself", setupAnchorHref("") === "/admin/orders?tab=setup");
  ok(
    "an empty anchor never emits a dangling hash",
    setupAnchorHref("   ").endsWith("#") === false,
  );
  ok(
    "the anchor href resolves back to the setup tab",
    resolveOrdersTab(setupAnchorHref("order-announcer").split("?tab=")[1]?.split("#")[0]) === "setup",
  );

  // ── The Leafly board's silence, shared with the page ──────────────────
  const QUIET = {
    hasOrders: false,
    hasProblem: false,
    hasOutcome: false,
    orderIntegrationKeyPresent: false,
  };
  ok("a shop not using Leafly renders no board", leaflyBoardRendersNothing(QUIET) === true);
  ok(
    "a real order makes the board render",
    leaflyBoardRendersNothing({ ...QUIET, hasOrders: true }) === false,
  );
  ok(
    "a problem makes the board render",
    leaflyBoardRendersNothing({ ...QUIET, hasProblem: true }) === false,
  );
  ok(
    "an action outcome makes the board render",
    leaflyBoardRendersNothing({ ...QUIET, hasOutcome: true }) === false,
  );
  ok(
    "a saved order key makes the board render",
    leaflyBoardRendersNothing({ ...QUIET, orderIntegrationKeyPresent: true }) === false,
  );
  ok(
    "ANY single reason is enough to render",
    (["hasOrders", "hasProblem", "hasOutcome", "orderIntegrationKeyPresent"] as const).every(
      (k) => leaflyBoardRendersNothing({ ...QUIET, [k]: true }) === false,
    ),
  );

  // ── Collapsed must never mean silent ──────────────────────────────────
  ok(
    "a healthy announcer collapses, as asked",
    announcerStartsOpen({ willAnnounce: true, notInstalled: false }) === false,
  );
  ok(
    "a shop that will NOT announce opens the panel",
    announcerStartsOpen({ willAnnounce: false, notInstalled: false }) === true,
  );
  ok(
    "a never-installed announcer stays collapsed",
    announcerStartsOpen({ willAnnounce: false, notInstalled: true }) === false,
  );
  ok(
    "not-installed wins over will-announce, both ways",
    announcerStartsOpen({ willAnnounce: true, notInstalled: true }) === false,
  );

  // ── Nothing is hidden that was shouting ───────────────────────────────
  ok("a calm shop shows no signals", ordersTabSignals(CALM).length === 0);
  ok("a calm shop puts no dot on the tab", setupTabNeedsAttention(CALM) === false);

  const printerDown = { ...CALM, printerNeedsAttention: true, activeCount: 3 };
  const p = ordersTabSignals(printerDown);
  ok("a dead printer with live orders raises a signal", p.length === 1);
  ok("it is urgent", p[0]?.severity === "urgent");
  ok("it survives onto the orders tab", urgentSignals(printerDown).length === 1);
  ok("it names the number of live orders", p[0]?.message.includes("3 live orders") === true);
  ok("it says what to do", (p[0]?.action.length ?? 0) > 10);
  ok("it marks the tab", setupTabNeedsAttention(printerDown) === true);

  const onePrinter = ordersTabSignals({ ...CALM, printerNeedsAttention: true, activeCount: 1 });
  ok("one order is singular", onePrinter[0]?.message.includes("1 live order,") === false);
  ok("one order does not say 'orders'", !onePrinter[0]?.message.includes("1 live orders"));

  const silent = { ...CALM, announcerSilent: true };
  const s = ordersTabSignals(silent);
  ok("a silent announcer raises a signal", s.length === 1);
  ok("it is urgent \u2014 a silent arrival is worse than no arrival", s[0]?.severity === "urgent");
  ok("it survives onto the orders tab", urgentSignals(silent).length === 1);
  ok("it explains the consequence", s[0]?.message.includes("silently") === true);

  // ── THE JUDGEMENT: setup is not an emergency ──────────────────────────
  const unset = { ...CALM, leaflyBlockingSteps: 4, leaflyEverReceived: false };
  const u = ordersTabSignals(unset);
  ok("unfinished Leafly setup is noticed", u.length === 1);
  ok("but it is NOT urgent", u[0]?.severity === "info");
  ok("so it never reaches the orders board", urgentSignals(unset).length === 0);
  ok("it still marks the tab", setupTabNeedsAttention(unset) === true);
  ok("it counts the steps", u[0]?.message.includes("4 steps") === true);
  ok(
    "one step is singular",
    ordersTabSignals({ ...unset, leaflyBlockingSteps: 1 })[0]?.message.includes("1 step ") === true,
  );

  // A shop already receiving Leafly orders is not "unset", whatever the
  // optional steps say.
  ok(
    "a working Leafly shop is not nagged",
    ordersTabSignals({ ...CALM, leaflyBlockingSteps: 3, leaflyEverReceived: true }).length === 0,
  );

  // ── Combinations ───────────────────────────────────────────────────────
  const everything = {
    printerNeedsAttention: true,
    announcerSilent: true,
    activeCount: 2,
    leaflyBlockingSteps: 2,
    leaflyEverReceived: false,
  };
  const all = ordersTabSignals(everything);
  ok("all three can coexist", all.length === 3);
  ok("only the two real alarms are urgent", urgentSignals(everything).length === 2);
  ok(
    "the printer leads, because money is already being lost",
    all[0]?.id === "printer_offline",
  );
  ok("ids are unique", new Set(all.map((x) => x.id)).size === all.length);
  ok(
    "every signal has a message and an action",
    all.every((x) => x.message.length > 0 && x.action.length > 0),
  );
  ok(
    "no signal shouts in capitals",
    all.every((x) => x.message !== x.message.toUpperCase()),
  );

  // A printer that is off but with NO live orders is not an emergency; the
  // page-level predicate already encodes that, and this core must not
  // second-guess it by inventing its own rule.
  ok(
    "the core trusts the caller's printer predicate",
    ordersTabSignals({ ...CALM, printerNeedsAttention: false, activeCount: 9 }).length === 0,
  );

  return { passed, failed };
}

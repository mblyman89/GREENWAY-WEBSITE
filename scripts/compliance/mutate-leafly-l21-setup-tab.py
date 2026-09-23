#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/compliance/mutate-leafly-l21-setup-tab.py

SLICE L-21 -- TESTING THE TESTS.

A passing suite proves nothing on its own. This script breaks the production
code on purpose, one change at a time, and demands that the suite NOTICE. A
mutation that survives is a hole: the tests describe that behaviour without
actually pinning it down.

Every mutation below is a plausible mistake, not a nonsense edit:
  - a panel left behind on the orders tab (a copy rather than a move)
  - an alarm downgraded, so the shop goes quiet behind a tab
  - a link that scrolls nowhere because its target moved
  - a redirect that lands on the tab without the banner
  - the collapsed bar losing the one number that justifies collapsing it

RULE 137: every anchor must match EXACTLY ONCE, verified by preflight before a
single mutation runs. An ambiguous anchor is not a probe -- it is a coin toss.

RULE 13c: the CONTROL mutant must SURVIVE. It rewrites a comment, which changes
nothing a user can observe. If the suite "catches" that, the suite is asserting
on prose and its other passes cannot be trusted either.
"""
from __future__ import annotations

import io
import subprocess
import sys
from dataclasses import dataclass

ROOT = "."
TESTS = [
    "tests/compliance/orders-setup-tab.test.ts",
    "tests/compliance/orders-setup-tab-render.test.tsx",
    "tests/compliance/disclosure-panel-render.test.tsx",
    "tests/compliance/leafly-setup-collapsible.test.ts",
]

PAGE = "src/app/admin/orders/page.tsx"
CORE = "src/lib/admin/orders-tabs-core.ts"
ACTIONS = "src/app/admin/orders/actions.ts"
ANNOUNCER = "src/components/admin/orders/AnnouncerPanel.tsx"
BOARD = "src/components/admin/orders/LeaflyOrdersPanel.tsx"
HARNESS = "scripts/compliance/run-pure-selftests.ts"


@dataclass
class Mutation:
    name: str
    path: str
    old: str
    new: str
    control: bool = False


M: list[Mutation] = []


def add(name, path, old, new, control=False):
    M.append(Mutation(name, path, old, new, control))


# ---------------------------------------------------------------------------
# 1. TAB RESOLUTION -- a bad URL must never strand somebody on a settings page
# ---------------------------------------------------------------------------
add(
    "a typo in ?tab= lands on the SETUP screen while a customer waits",
    CORE,
    'return (ORDERS_TABS as readonly string[]).includes(v) ? (v as OrdersTab) : DEFAULT_ORDERS_TAB;',
    'return (v as OrdersTab);',
)
add(
    "the default tab becomes setup, so /admin/orders opens on settings",
    CORE,
    'export const DEFAULT_ORDERS_TAB: OrdersTab = "orders";',
    'export const DEFAULT_ORDERS_TAB: OrdersTab = "setup";',
)
add(
    "tab matching becomes case-sensitive, so ?tab=Setup silently fails",
    CORE,
    "const v = raw.trim().toLowerCase();",
    "const v = raw.trim();",
)
add(
    "the orders tab grows a query string and stops being bookmarkable",
    CORE,
    'return tab === DEFAULT_ORDERS_TAB ? "/admin/orders" : `/admin/orders?tab=${tab}`;',
    'return `/admin/orders?tab=${tab}`;',
)

# ---------------------------------------------------------------------------
# 2. THE ALARMS THAT MAY NOT BE HIDDEN
# ---------------------------------------------------------------------------
add(
    "a dead printer is downgraded to info, so it never reaches the board",
    CORE,
    '''      action: "Check it is powered on and connected, then send a test print.",
      severity: "urgent",''',
    '''      action: "Check it is powered on and connected, then send a test print.",
      severity: "info",''',
)
add(
    "a silent announcer is downgraded to info -- the shop goes quiet",
    CORE,
    '''      action: "Check the speaker is powered on and connected to the internet.",
      severity: "urgent",''',
    '''      action: "Check the speaker is powered on and connected to the internet.",
      severity: "info",''',
)
add(
    "unfinished Leafly setup is promoted to urgent -- alert fatigue returns",
    CORE,
    '''      action: "Open the Setup & equipment tab to finish.",
      severity: "info",''',
    '''      action: "Open the Setup & equipment tab to finish.",
      severity: "urgent",''',
)
add(
    "urgentSignals returns everything, so info noise reaches the board",
    CORE,
    'return ordersTabSignals(input).filter((s) => s.severity === "urgent");',
    "return ordersTabSignals(input);",
)
add(
    "urgentSignals returns nothing -- both real alarms vanish",
    CORE,
    'return ordersTabSignals(input).filter((s) => s.severity === "urgent");',
    "return [];",
)
add(
    "the printer alarm stops firing entirely",
    CORE,
    "  if (input.printerNeedsAttention) {",
    "  if (false && input.printerNeedsAttention) {",
)
add(
    "the announcer alarm stops firing entirely",
    CORE,
    "  if (input.announcerSilent) {",
    "  if (false && input.announcerSilent) {",
)
add(
    "the tab dot never lights up, so the moved panels are truly forgotten",
    CORE,
    "  return ordersTabSignals(input).length > 0;",
    "  return false;",
)
add(
    "a working Leafly shop is nagged about optional steps forever",
    CORE,
    "  if (input.leaflyBlockingSteps > 0 && !input.leaflyEverReceived) {",
    "  if (input.leaflyBlockingSteps > 0) {",
)
add(
    "the printer alarm stops naming how many orders are at risk",
    CORE,
    "`Receipts may not be printing. You have ${input.activeCount} live ` +",
    "`Receipts may not be printing. You have some live ` +",
)
add(
    "the silent-announcer message stops saying orders arrive silently",
    CORE,
    '"No speaker is online, so new orders are arriving silently."',
    '"Speaker status changed."',
)

# ---------------------------------------------------------------------------
# 3. THE PAGE -- did the panels really move?
# ---------------------------------------------------------------------------
add(
    "the announcer is left behind on the orders tab as well (copy, not move)",
    PAGE,
    "        {/* New-order watcher (polls + chimes when new orders arrive) */}\n        <NewOrderAlert />",
    "        {/* New-order watcher (polls + chimes when new orders arrive) */}\n        <NewOrderAlert />\n        <AnnouncerPanel />",
)
add(
    "the alarm strip is computed and then dropped on the floor",
    PAGE,
    "        {orderBoardSignals.length > 0 ? (",
    "        {false && orderBoardSignals.length > 0 ? (",
)
add(
    "the alarm strip moves to the setup tab, where nobody is looking",
    PAGE,
    "  const orderBoardSignals = urgentSignals(tabInput);",
    "  const orderBoardSignals: ReturnType<typeof urgentSignals> = [];",
)
add(
    "the tab dot is never rendered",
    PAGE,
    "            {setupNeedsAttention ? (",
    "            {false && setupNeedsAttention ? (",
)
add(
    "a silent shop is no longer treated as silent by the page",
    PAGE,
    "    announcerSilent: !announcerData.notInstalled && !announcerData.verdict.willAnnounce,",
    "    announcerSilent: false,",
)
add(
    "a never-installed announcer starts raising false alarms",
    PAGE,
    "    announcerSilent: !announcerData.notInstalled && !announcerData.verdict.willAnnounce,",
    "    announcerSilent: !announcerData.verdict.willAnnounce,",
)
add(
    "the setup tab is never selectable -- the panels become unreachable",
    PAGE,
    '  const tab = resolveOrdersTab(sp.tab);',
    '  const tab = "orders" as ReturnType<typeof resolveOrdersTab>;',
)
add(
    "the Leafly step count is invented instead of derived from the steps",
    PAGE,
    "    leaflyBlockingSteps: leaflySetup.readiness.steps.filter((s) => !s.done && s.blocking).length,",
    "    leaflyBlockingSteps: 0,",
)
add(
    "the M-2 pointer disappears, so the empty board is unexplained again",
    PAGE,
    "        {leaflyBoardRendersNothing({",
    "        {false && leaflyBoardRendersNothing({",
)
add(
    "the panel order is scrambled -- Leafly setup jumps above the printer",
    PAGE,
    "          <AnnouncerPanel />",
    "          <LeaflyOrderSetupPanel setup={leaflySetup} compact={false} />",
)

# ---------------------------------------------------------------------------
# 4. LINKS AND REDIRECTS -- nothing may point at a place that is not rendered
# ---------------------------------------------------------------------------
add(
    "the announcer jump goes back to a bare fragment and scrolls nowhere",
    BOARD,
    "              href={setupAnchorHref(ANNOUNCER_PANEL_ANCHOR)}",
    "              href={`#${ANNOUNCER_PANEL_ANCHOR}`}",
)
add(
    "the cross-tab anchor drops the tab, so the target is never rendered",
    CORE,
    '  const base = ordersTabHref("setup");',
    '  const base = "";',
)
add(
    "the pool banner redirects to the orders board, where it cannot be seen",
    ACTIONS,
    "  redirect(`${ORDERS_SETUP_BASE}&pool=1&${key}=${encodeURIComponent(message.slice(0, 300))}`);",
    "  redirect(`${ORDERS_BASE}?pool=1&${key}=${encodeURIComponent(message.slice(0, 300))}`);",
)
add(
    "the test-print banner redirects to the orders board and is never seen",
    ACTIONS,
    "  redirect(`${ORDERS_SETUP_BASE}&printTest=1`);",
    "  redirect(`${ORDERS_BASE}?printTest=1`);",
)
add(
    "the setup redirect points at a tab that does not exist",
    ACTIONS,
    'const ORDERS_SETUP_BASE = `${ORDERS_BASE}?tab=setup`;',
    'const ORDERS_SETUP_BASE = `${ORDERS_BASE}?tab=settings`;',
)

# ---------------------------------------------------------------------------
# 5. THE COLLAPSED BAR -- the number that justifies collapsing it
# ---------------------------------------------------------------------------
add(
    "the announcer is forced open forever, undoing 'collapsed by default'",
    CORE,
    "  if (input.notInstalled) return false;\n  return !input.willAnnounce;",
    "  if (input.notInstalled) return false;\n  return true;",
)
add(
    "a silent shop collapses its own explanation -- collapsed AND silent",
    CORE,
    "  if (input.notInstalled) return false;\n  return !input.willAnnounce;",
    "  return false;",
)
add(
    "a never-installed announcer springs open on every page load",
    CORE,
    "  if (input.notInstalled) return false;",
    "  if (input.notInstalled) return true;",
)
add(
    "the speaker count is removed from the collapsed bar",
    ANNOUNCER,
    """      badge={
        <span""",
    """      badge={
        <span data-removed="1" hidden""",
)
add(
    "the panel stops asking the core and hardcodes collapsed",
    ANNOUNCER,
    """      defaultOpen={announcerStartsOpen({
        willAnnounce: verdict.willAnnounce,
        notInstalled: false,
      })}""",
    "      defaultOpen={false}",
)
add(
    "the announcer loses the anchor the cross-tab link targets",
    ANNOUNCER,
    "      id={ANNOUNCER_PANEL_ANCHOR}\n      icon=",
    "      icon=",
)

# ---------------------------------------------------------------------------
# 6. THE SHARED EMPTINESS PREDICATE -- two copies would drift
# ---------------------------------------------------------------------------
add(
    "the empty-board rule loosens, so the note shows over a working board",
    CORE,
    """  return (
    !input.hasOrders &&
    !input.hasProblem &&
    !input.hasOutcome &&
    !input.orderIntegrationKeyPresent
  );""",
    "  return !input.hasOrders;",
)
add(
    "the empty-board rule inverts entirely",
    CORE,
    """  return (
    !input.hasOrders &&
    !input.hasProblem &&
    !input.hasOutcome &&
    !input.orderIntegrationKeyPresent
  );""",
    "  return false;",
)
add(
    "the Leafly board re-types the condition instead of sharing it",
    BOARD,
    """  if (
    leaflyBoardRendersNothing({
      hasOrders,
      hasProblem,
      hasOutcome,
      orderIntegrationKeyPresent: board.orderIntegrationKeyPresent,
    })
  ) {""",
    "  if (!hasOrders && !hasProblem && !hasOutcome && !board.orderIntegrationKeyPresent) {",
)

# ---------------------------------------------------------------------------
# 7. THE HARNESS -- a floor that cannot fail is not a floor
# ---------------------------------------------------------------------------
add(
    "the self-test floor drops to zero, so a gutted suite still passes",
    HARNESS,
    'assertRan("orders-tabs-core", __runOrdersTabsTests(), 52);',
    'assertRan("orders-tabs-core", __runOrdersTabsTests(), 0);',
)

# ---------------------------------------------------------------------------
# CONTROL -- must SURVIVE
# ---------------------------------------------------------------------------
add(
    "CONTROL: reword a comment (no observable behaviour changes)",
    CORE,
    "/** The two tabs on /admin/orders. */",
    "/** The tabs available on the orders screen. */",
    control=True,
)


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(s)


def run_tests():
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if r.returncode != 0:
        return False
    # A self-test floor breach shows up in the pure harness, not vitest.
    h = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    return h.returncode == 0


def preflight():
    """RULE 137: every anchor must match exactly once. No guessing."""
    bad = []
    for m in M:
        src = read(m.path)
        n = src.count(m.old)
        if n != 1:
            bad.append("  [%d matches] %s\n      in %s\n      anchor: %r" % (n, m.name, m.path, m.old[:90]))
    if bad:
        print("PREFLIGHT FAILED -- ambiguous or missing anchors:\n" + "\n".join(bad))
        return False
    print("preflight OK -- %d mutations, every anchor unique" % len(M))
    return True


def main():
    if not preflight():
        return 2

    print("\nbaseline: the suite must be GREEN before we break anything...")
    if not run_tests():
        print("BASELINE IS RED. Fix the suite before probing it.")
        return 2
    print("baseline GREEN\n")

    caught, survived = [], []
    originals = {p: read(p) for p in {m.path for m in M}}

    try:
        for i, m in enumerate(M, 1):
            src = originals[m.path]
            write(m.path, src.replace(m.old, m.new, 1))
            green = run_tests()
            write(m.path, src)  # restore immediately

            if m.control:
                tag = "SURVIVED (correct)" if green else "CAUGHT (WRONG!)"
                (survived if green else caught).append(m.name)
            else:
                tag = "survived (HOLE)" if green else "caught"
                (survived if green else caught).append(m.name)
            print("[%2d/%2d] %-18s %s" % (i, len(M), tag, m.name))
    finally:
        for p, s in originals.items():
            write(p, s)

    real = [m for m in M if not m.control]
    ctrl = [m for m in M if m.control]
    real_survivors = [n for n in survived if n not in [c.name for c in ctrl]]
    ctrl_caught = [n for n in caught if n in [c.name for c in ctrl]]

    print("\n" + "=" * 72)
    print("%d real mutations: %d caught, %d survived"
          % (len(real), len(real) - len(real_survivors), len(real_survivors)))
    print("%d control mutations: %d wrongly caught" % (len(ctrl), len(ctrl_caught)))
    if real_survivors:
        print("\nHOLES -- behaviour the tests describe but do not pin down:")
        for n in real_survivors:
            print("  - %s" % n)
    if ctrl_caught:
        print("\nCONTROL WAS CAUGHT -- the suite is asserting on prose:")
        for n in ctrl_caught:
            print("  - %s" % n)
    print("=" * 72)

    return 0 if not real_survivors and not ctrl_caught else 1


if __name__ == "__main__":
    sys.exit(main())

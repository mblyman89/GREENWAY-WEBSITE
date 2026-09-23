#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/compliance/mutate-leafly-l22-board-order.py

SLICE L-22 -- TESTING THE TESTS.

A passing suite proves nothing on its own. This script breaks the production
code on purpose, one change at a time, and demands that the suite NOTICE. A
mutation that survives is a hole: the tests describe that behaviour without
actually pinning it down.

Every mutation below is a plausible mistake, not a nonsense edit. They fall
into five families, each one a real way this slice could go wrong in the shop:

  1. THE ORDER ITSELF -- the owner's requested layout quietly reverting, or
     the promotion firing when it should not (or never firing at all).
  2. THE FAILED COUNT -- a null read as zero, which is the page promising
     "nothing is waiting" on the strength of a question it never got an
     answer to.
  3. THE SILENT REARRANGEMENT -- the boards reorder but the banner explaining
     why does not render. A layout that moves without saying why is
     indistinguishable from a bug.
  4. THE DUPLICATED BOARD -- the worst outcome available here. Two copies of
     the Leafly board means two Acknowledge buttons for one order, and
     acknowledging is irreversible: it permanently ends our access to the
     shopper's ID images.
  5. THE HALF-LABELLED COLUMN -- labels on Leafly rows only, so a website row
     is identified by the ABSENCE of a badge. That is indistinguishable from
     a badge that failed to render, and it is the exact bug this slice was
     asked to fix.

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
    "tests/compliance/orders-board-order.test.ts",
    "tests/compliance/orders-board-order-render.test.tsx",
    # The L-21 suites are included on purpose: this slice restructures the very
    # page they assert about, so a regression there is a regression here.
    "tests/compliance/orders-setup-tab.test.ts",
    "tests/compliance/orders-setup-tab-render.test.tsx",
]

PAGE = "src/app/admin/orders/page.tsx"
CORE = "src/lib/admin/orders-board-order-core.ts"
ORIGIN = "src/lib/orders/order-origin-core.ts"
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
# 1. THE ORDER ITSELF
# ---------------------------------------------------------------------------
add(
    "the owner's requested order silently reverts to L-6's (Leafly always on top)",
    CORE,
    'return { sections: ["greenway", "leafly"], leaflyPromoted: false, reason: "" };',
    'return { sections: ["leafly", "greenway"], leaflyPromoted: false, reason: "" };',
)
add(
    "the promotion never fires, so a 15-minute deadline sits below the fold",
    CORE,
    "if (typeof pending === \"number\" && Number.isFinite(pending) && pending > 0) {",
    "if (false) {",
)
add(
    "the promotion fires on every render, so the owner's layout never applies",
    CORE,
    "if (typeof pending === \"number\" && Number.isFinite(pending) && pending > 0) {",
    "if (true) {",
)
add(
    "an off-by-one makes zero pending orders promote the board",
    CORE,
    "Number.isFinite(pending) && pending > 0",
    "Number.isFinite(pending) && pending >= 0",
)
add(
    "the promoted layout drops Greenway's own orders off the page entirely",
    CORE,
    'sections: ["leafly", "greenway"],',
    'sections: ["leafly"],',
)
add(
    "the flag says promoted while the sections stay in the ordinary order",
    CORE,
    '      sections: ["leafly", "greenway"],\n      leaflyPromoted: true,',
    '      sections: ["greenway", "leafly"],\n      leaflyPromoted: true,',
)
add(
    "the page stops asking the core and hardcodes the order",
    PAGE,
    "const boardLayout = decideBoardLayout({ leaflyPendingAck });",
    'const boardLayout = { sections: ["greenway", "leafly"] as const, leaflyPromoted: false, reason: "" };',
)
add(
    "the page renders only the first section, hiding the other board",
    PAGE,
    "{boardLayout.sections.map((section) => (",
    "{boardLayout.sections.slice(0, 1).map((section) => (",
)
add(
    "the section map inverts, so each marker renders the wrong board",
    PAGE,
    'section === "leafly" ? leaflySection : greenwaySection',
    'section === "leafly" ? greenwaySection : leaflySection',
)

# ---------------------------------------------------------------------------
# 2. THE FAILED COUNT -- null is not zero
# ---------------------------------------------------------------------------
add(
    "a failed pending-ack count is read as zero, inventing a promise nothing is waiting",
    CORE,
    'typeof pending === "number" && Number.isFinite(pending)',
    "(pending ?? 0) === (pending ?? 0)",
)
add(
    "a failed count is read as an emergency, promoting on a database error",
    CORE,
    "const pending = input.leaflyPendingAck;",
    "const pending = input.leaflyPendingAck ?? 1;",
)
add(
    "NaN slips through the finite check and promotes on nonsense",
    CORE,
    "Number.isFinite(pending) && pending > 0",
    "pending > 0",
)

# ---------------------------------------------------------------------------
# 3. THE SILENT REARRANGEMENT
# ---------------------------------------------------------------------------
add(
    "the boards reorder but the banner explaining why never renders",
    PAGE,
    "{boardLayout.leaflyPromoted ? (",
    "{false ? (",
)
add(
    "the banner renders with no text, so the page reorders and says nothing",
    PAGE,
    "<span>{boardLayout.reason}</span>",
    "<span>{null}</span>",
)
add(
    "the explanation loses the deadline, the one fact that justifies the move",
    CORE,
    "Leafly cancels it automatically after 15 minutes, so it is shown first.",
    "so it is shown first.",
)
add(
    "the reason is emptied, so a promoted layout explains nothing",
    CORE,
    '          ? "1 Leafly order is waiting to be acknowledged \u2014 Leafly cancels it automatically after 15 minutes, so it is shown first."',
    '          ? ""',
)
add(
    "the banner is hidden from assistive tech",
    PAGE,
    '            role="status"\n',
    "",
)
add(
    "the plural sentence reads as singular, so '3 Leafly order is waiting'",
    CORE,
    "? \"1 Leafly order is waiting to be acknowledged \u2014 Leafly cancels it automatically after 15 minutes, so it is shown first.\"\n          : `${pending} Leafly orders are waiting",
    "? \"1 Leafly order is waiting to be acknowledged \u2014 Leafly cancels it automatically after 15 minutes, so it is shown first.\"\n          : `${pending} Leafly order is waiting",
)

# ---------------------------------------------------------------------------
# 4. THE DUPLICATED BOARD -- two Acknowledge buttons for one order
# ---------------------------------------------------------------------------
add(
    "both slots render the Leafly board, giving one order two Acknowledge buttons",
    PAGE,
    'section === "leafly" ? leaflySection : greenwaySection',
    "leaflySection",
)
add(
    "both slots render our own orders, so the Leafly board vanishes",
    PAGE,
    'section === "leafly" ? leaflySection : greenwaySection',
    "greenwaySection",
)
add(
    "the core returns a duplicate section, rendering one board twice",
    CORE,
    'return { sections: ["greenway", "leafly"], leaflyPromoted: false, reason: "" };',
    'return { sections: ["greenway", "greenway"], leaflyPromoted: false, reason: "" };',
)

# ---------------------------------------------------------------------------
# 5. THE HALF-LABELLED COLUMN
# ---------------------------------------------------------------------------
add(
    "the L-12 unconditional hide comes back, so website rows are unlabelled again",
    PAGE,
    "<OrderOriginBadge origin={order.origin} hideWebsite={!labelWebsiteRows} />",
    "<OrderOriginBadge origin={order.origin} hideWebsite />",
)
add(
    "the badge is frozen on, so no row is ever labelled",
    PAGE,
    "hideWebsite={!labelWebsiteRows}",
    "hideWebsite={true}",
)
add(
    "the labelling flag inverts, labelling exactly the shops that should stay quiet",
    PAGE,
    "hideWebsite={!labelWebsiteRows}",
    "hideWebsite={labelWebsiteRows}",
)
add(
    "the shop-level signal is dropped, so labelling flickers page to page",
    CORE,
    "if (input.shopReceivesLeaflyOrders) return true;",
    "",
)
add(
    "the safety valve is removed, so a failed readiness count half-labels the list",
    CORE,
    "return distinctOrigins(input.originsOnScreen).size > 1;",
    "return false;",
)
add(
    "labelling is forced on for every shop, restoring the noise L-12 removed",
    CORE,
    "  if (input.shopReceivesLeaflyOrders) return true;\n  // Safety valve: evidence on the screen outranks the flag about the screen.\n  return distinctOrigins(input.originsOnScreen).size > 1;",
    "  return true;",
)
add(
    "the page feeds the core an empty row list, disarming the safety valve",
    PAGE,
    "originsOnScreen: orders.map((o) => o.origin),",
    "originsOnScreen: [],",
)
add(
    "the page derives 'does this shop use Leafly' itself instead of echoing readiness",
    PAGE,
    "shopReceivesLeaflyOrders: leaflySetup.readiness.anyOrderEverReceived,",
    'shopReceivesLeaflyOrders: orders.some((o) => o.origin === "leafly"),',
)
add(
    "a single distinct origin is treated as a mix, labelling an all-website list",
    CORE,
    "return distinctOrigins(input.originsOnScreen).size > 1;",
    "return distinctOrigins(input.originsOnScreen).size > 0;",
)
add(
    "origins stop being normalised, so 'Leafly' and 'leafly' fake a mix",
    CORE,
    "for (const v of values) out.add(toOrderOrigin(v));",
    "for (const v of values) out.add((v as never));",
)

# ---------------------------------------------------------------------------
# 6. THE MIX SUMMARY -- a sentence that overstates its own scope
# ---------------------------------------------------------------------------
add(
    "the summary drops 'On this page', so page counts read as shop totals",
    CORE,
    'return `On this page: ${tallies.map((t) => `${t.count} ${label(t.origin)}`).join(" \u00b7 ")}`;',
    'return `${tallies.map((t) => `${t.count} ${label(t.origin)}`).join(" \u00b7 ")}`;',
)
add(
    "the summary claims to be a shop total",
    CORE,
    "return `On this page: ",
    "return `Total, all time: ",
)
add(
    "the summary renders for a single-origin page, repeating the pager's number",
    CORE,
    "if (tallies.length < 2) return \"\";",
    "if (tallies.length < 0) return \"\";",
)
add(
    "the summary never renders at all",
    CORE,
    "if (tallies.length < 2) return \"\";",
    'return "";',
)
add(
    "the summary is computed and then dropped on the floor",
    PAGE,
    "{originMix ? (",
    "{false ? (",
)
add(
    "the summary stops using the badge's words and invents its own",
    CORE,
    "${t.count} ${label(t.origin)}",
    "${t.count} ${t.origin}",
)
add(
    "the tally drops rows it does not recognise, so the counts stop adding up",
    CORE,
    "const key = toOrderOrigin(raw);",
    'const key = (raw ?? "") as never;',
)
add(
    "the tally's tiebreak is removed, so the line reshuffles between refreshes",
    CORE,
    "sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));",
    "sort((a, b) => b.count - a.count);",
)
add(
    "the tally sorts smallest-first, burying the dominant origin",
    CORE,
    "sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));",
    "sort((a, b) => a.count - b.count || a.origin.localeCompare(b.origin));",
)

# ---------------------------------------------------------------------------
# 7. THE HARNESS -- a core that stops running proves nothing
# ---------------------------------------------------------------------------
add(
    "the core is unregistered from CI, so its self-tests stop running",
    HARNESS,
    'assertRan("orders-board-order-core", __runBoardOrderTests(), 48);',
    "",
)
add(
    "the floor drops to zero, so a gutted suite passes",
    HARNESS,
    'assertRan("orders-board-order-core", __runBoardOrderTests(), 48);',
    'assertRan("orders-board-order-core", __runBoardOrderTests(), 0);',
)

# ---------------------------------------------------------------------------
# 8. CONTROL -- must SURVIVE (rule 13c)
# ---------------------------------------------------------------------------
add(
    "CONTROL: a comment is reworded and nothing observable changes",
    CORE,
    " * PURE. No I/O, no clock, no database, no React. Everything it needs arrives",
    " * PURE. Nothing here touches the outside world; every input is a parameter",
    control=True,
)


# ---------------------------------------------------------------------------
def read(p):
    with io.open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


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
            bad.append(
                "  [%d matches] %s\n      in %s\n      anchor: %r"
                % (n, m.name, m.path, m.old[:90])
            )
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
            else:
                tag = "survived (HOLE)" if green else "caught"
            (survived if green else caught).append(m.name)
            print("[%2d/%2d] %-18s %s" % (i, len(M), tag, m.name))
    finally:
        for p, s in originals.items():
            write(p, s)

    real = [m for m in M if not m.control]
    ctrl = [m for m in M if m.control]
    ctrl_names = [c.name for c in ctrl]
    real_survivors = [n for n in survived if n not in ctrl_names]
    ctrl_caught = [n for n in caught if n in ctrl_names]

    print("\n" + "=" * 72)
    print(
        "%d real mutations: %d caught, %d survived"
        % (len(real), len(real) - len(real_survivors), len(real_survivors))
    )
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

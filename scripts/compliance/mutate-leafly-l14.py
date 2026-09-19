#!/usr/bin/env python3
"""
MUTATION TESTING FOR SLICE L-14 -- "test the tests".

A green suite is evidence of nothing until you have watched it go red. This
script re-introduces, one at a time, the EXACT defects this slice fixed (plus
the near misses that would be easy to reintroduce), runs the L-14 compliance
suite against each, and asserts the suite CATCHES it.

Every mutation below is a real bug that either existed in this codebase during
this slice or is one edit away from existing:

  1. hardcoded_registersaleopen  -- the literal `registerSaleOpen: false` that
     made every collision branch of decideCancelPlan dead code.
  2. stale_snapshot              -- passing the pre-acknowledgement order to
     setLeaflyOrderStatus, so RULE 1 refuses and `confirmed` is never sent.
  3. no_confirm_push             -- reverting the correction entirely.
  4. modal_close_button          -- giving the blocking modal a way out.
  5. poll_gated_on_home          -- only polling on the idle screen, so the
     mid-sale cashier never sees the cancellation.
  6. no_claim_on_load            -- never claiming the order at the register.
  7. no_release                  -- never releasing the claim.
  8. denylist_disposition        -- flipping the allowlist to a denylist.
  9. title_loses_order_number    -- the modal stops naming the sale.
 10. modal_swaps_under_finger    -- replacing the interrupt mid-decision.
 11. drop_unique_index           -- letting Leafly's retries raise N modals.
 12. no_double_tap_guard         -- two taps, two dispositions, one sale.
 13. board_hides_resolved        -- the board stops showing the ANSWER, so
     where the bagged product went becomes unknowable.
 14. board_swallows_error        -- an unreadable table reported as "no
     interrupts"; a stopped till goes invisible.
 15. board_fails_on_missing_migration -- the degrade ladder removed, so a
     hand-applied migration window takes the orders board down.
 16. board_keeps_blank_ids       -- a blank id widens the .in() filter and
     one order's cancellation appears on another order's card.
 17. page_rederives_ids          -- the page invents its own id set.
 18. panel_filters_to_blocking   -- the panel throws away resolved rows.
 19. panel_decides_for_itself    -- the panel classifies locally instead
     of asking the pure core (house rule 11).

A mutation that is NOT caught is reported as a SURVIVOR and exits non-zero:
that means the suite has a hole, and the hole is named.

The file is always restored, including on exception or Ctrl-C.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUITE = "tests/compliance/leafly-l14-register-interrupt.test.ts"

BRIDGE_SERVER = "src/lib/leafly/bridge-server.ts"
ACK_SERVER = "src/lib/leafly/order-ack-server.ts"
CLAIM_CORE = "src/lib/leafly/register-claim-core.ts"
MODAL = "src/app/pos/RegisterInterruptModal.tsx"
SHELL = "src/app/pos/RegisterShell.tsx"
PICKUP_ROUTE = "src/app/api/pos/pickup/route.ts"
SYNC_STORE = "src/lib/pos/sync-store.ts"
MIGRATION = "supabase/migrations/0229_leafly_register_claim.sql"
CLAIM_SERVER = "src/lib/leafly/register-claim-server.ts"
ORDERS_PAGE = "src/app/admin/orders/page.tsx"
ORDERS_PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx"

# (name, file, find, replace, why it matters)
MUTATIONS: list[tuple[str, str, str, str, str]] = [
    (
        "hardcoded_registersaleopen",
        BRIDGE_SERVER,
        "registerSaleOpen: claim.registerSaleOpen",
        "registerSaleOpen: false",
        "The original defect: kills every mid-sale collision branch silently.",
    ),
    (
        "stale_snapshot",
        ACK_SERVER,
        "acknowledged_at: acknowledgedAt.toISOString(),",
        "acknowledged_at: input.order.acknowledged_at,",
        "RULE 1 then refuses every confirm push; shopper sees pending forever.",
    ),
    (
        "no_confirm_push",
        ACK_SERVER,
        'nextStatus: "confirmed",',
        'nextStatus: "ready",',
        "Reverts the receipt-vs-acceptance correction.",
    ),
    (
        "modal_close_button",
        MODAL,
        'role="dialog"',
        'role="dialog" aria-label="Close"',
        "Any way out of the modal = a cancelled order handed to a customer.",
    ),
    (
        "poll_gated_on_home",
        SHELL,
        '    const pollInterrupts = async () => {',
        '    const pollInterrupts = async () => {\n      if (screen !== "home") return;',
        "The cancellation that matters most arrives mid-sale.",
    ),
    (
        "no_claim_on_load",
        PICKUP_ROUTE,
        "const claimed = await claimLeaflyOrderForRegister({",
        "const claimed = await __noClaim({",
        "Without a claim, nobody knows which till is holding the order.",
    ),
    (
        "no_release",
        SYNC_STORE,
        "await releaseLeaflyOrderClaim(sale.sourceOrderId);",
        "await __noRelease(sale.sourceOrderId);",
        "A dead till would hold an order hostage forever.",
    ),
    (
        "denylist_disposition",
        CLAIM_CORE,
        "if (VALID_DISPOSITIONS.has(raw)) return raw as CancelDisposition;",
        "if (raw !== \"delete\") return raw as CancelDisposition;",
        "Allowlist -> denylist: records a disposition nobody designed.",
    ),
    (
        "title_loses_order_number",
        CLAIM_CORE,
        """    title: input.plan.dispositionRequired
      ? text(input.orderNumber)
        ? `Leafly cancelled order ${text(input.orderNumber)}`
        : "Leafly cancelled this order"
      : text(input.orderNumber)
        ? `Leafly cancelled order ${text(input.orderNumber)}`
        : "A Leafly order was cancelled",""",
        """    title: input.plan.dispositionRequired
      ? "Leafly cancelled this order"
      : "A Leafly order was cancelled",""",
        "Cashier is asked to void a sale without being told which sale.",
    ),
    (
        "modal_swaps_under_finger",
        SHELL,
        "setInterrupt((current) => current ?? next);",
        "setInterrupt(next);",
        "Swaps the modal mid-decision; the wrong sale gets voided.",
    ),
    (
        "drop_unique_index",
        MIGRATION,
        "create unique index if not exists leafly_register_interrupts_one_open_per_order",
        "create index if not exists leafly_register_interrupts_one_open_per_order",
        "Leafly retries become N modals; staff learn to dismiss without reading.",
    ),
    (
        "no_double_tap_guard",
        MODAL,
        "if (busy !== null) return;",
        "if (false) return;",
        "Two taps file two dispositions for one sale.",
    ),
    # ---- THE DASHBOARD HALF ------------------------------------------------
    (
        "board_hides_resolved",
        CLAIM_SERVER,
        '.in("local_order_id", ids)',
        '.in("local_order_id", ids)\n      .is("resolved_at", null)',
        "The board stops being the record of where bagged product went.",
    ),
    (
        "board_swallows_error",
        CLAIM_SERVER,
        "problem: `Register cancellation alerts couldn\u2019t be read: ${error.message}`,",
        'problem: "",',
        "An unreadable table renders as a healthy, quiet shop.",
    ),
    (
        "board_fails_on_missing_migration",
        CLAIM_SERVER,
        "      if (isMissing0229(error)) {\n        return { byOrderId: new Map<string, InterruptRecord[]>(), degraded: true, problem: \"\" };\n      }\n",
        "",
        "A hand-applied-migration window takes the whole orders board down.",
    ),
    (
        "board_keeps_blank_ids",
        CLAIM_SERVER,
        '.filter((v) => v !== "")',
        "",
        "A blank id widens the .in() filter onto other orders' cancellations.",
    ),
    (
        "page_rederives_ids",
        ORDERS_PAGE,
        "leaflyBoard.orders.map((o) => o.local_order_id ?? \"\")",
        "orders.map((o) => o.id)",
        "The board and the interrupt read disagree about what is on screen.",
    ),
    (
        "panel_filters_to_blocking",
        ORDERS_PANEL,
        "{(interrupts ?? []).map((row) => {",
        "{(interrupts ?? []).filter((r) => r.resolvedAt === null).map((row) => {",
        "The answer is discarded; only the question is ever shown.",
    ),
    (
        "panel_decides_for_itself",
        ORDERS_PANEL,
        'const blocking = summary.state === "BLOCKING";',
        "const blocking = row.resolvedAt === null;",
        "House rule 11: the panel grows a second opinion about 'blocking'.",
    ),
]


def run_suite() -> bool:
    """True if the suite PASSES."""
    proc = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode == 0


def main() -> int:
    print("=" * 74)
    print("L-14 MUTATION TESTING -- re-breaking the code on purpose")
    print("=" * 74)

    # Baseline. A suite that is already red proves nothing about mutations.
    print("\n[baseline] the suite must be GREEN before we start...")
    if not run_suite():
        print("  FAIL: baseline suite is already failing. Fix that first.")
        return 1
    print("  OK: baseline green.\n")

    survivors: list[tuple[str, str]] = []
    caught = 0

    for name, rel, find, repl, why in MUTATIONS:
        path = os.path.join(ROOT, rel)
        with open(path, encoding="utf-8") as fh:
            original = fh.read()

        n = original.count(find)
        if n != 1:
            print(f"[{name}] SKIPPED-ERROR: anchor found {n} times in {rel}")
            survivors.append((name, f"anchor not unique in {rel} (found {n})"))
            continue

        backup = tempfile.NamedTemporaryFile(
            mode="w", suffix=".bak", delete=False, encoding="utf-8"
        )
        backup.write(original)
        backup.close()

        try:
            mutated = original.replace(find, repl)
            assert mutated != original
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(mutated)

            passed = run_suite()
            if passed:
                print(f"[{name}] *** SURVIVED *** -- {why}")
                survivors.append((name, why))
            else:
                caught += 1
                print(f"[{name}] caught.")
        finally:
            shutil.copyfile(backup.name, path)
            os.unlink(backup.name)

    print("\n" + "=" * 74)
    print(f"RESULT: {caught}/{len(MUTATIONS)} mutations caught.")

    # Prove the restore worked: the suite must be green again.
    print("\n[restore] the suite must be GREEN again...")
    if not run_suite():
        print("  FAIL: the suite is red after restore. A file may be damaged.")
        return 1
    print("  OK: fully restored.")

    if survivors:
        print("\nSURVIVORS -- these defects would ship unnoticed:")
        for name, why in survivors:
            print(f"  - {name}: {why}")
        return 1

    print("\nAll mutations caught. The tests test what they claim to.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

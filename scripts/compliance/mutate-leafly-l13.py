#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l13.py

TEST THE TESTS \u2014 mutation testing for the L-13 bridge wiring gate.

WHY
---
`tests/compliance/leafly-bridge-wiring.test.ts` claims to prove that every
seam of the Leafly bridge is connected. That claim is itself untested. A gate
that passes whether or not the bridge is attached is worse than no gate,
because it converts "nobody checked" into "CI says it is fine".

So this script DISCONNECTS the bridge, one seam at a time, and requires the
gate to notice. Each mutation is a real regression somebody could plausibly
introduce \u2014 a deleted call after a refactor, a comment left behind when the
code under it was removed, a `??` added to silence a type error.

Every mutation is applied to a COPY-ON-DISK of the real file and reverted in
a `finally`, so a crash cannot leave the tree mutated. The script refuses to
run at all if the working tree is dirty in a file it wants to touch, because
reverting would then destroy real work.

USAGE
-----
    python3 scripts/compliance/mutate-leafly-l13.py

Exit code 0 means every mutation was CAUGHT.
"""
import os
import subprocess
import sys

TEST = "tests/compliance/leafly-bridge-wiring.test.ts"

# (name, file, old, new, why this is a plausible real regression)
MUTATIONS = [
    (
        "M9: the webhook stops calling the bridge on arrival",
        "src/lib/leafly/webhook-server.ts",
        "const bridged = await onLeaflyOrderArrived(parsed.orderId);",
        "const bridged = { ok: true, announced: false, printed: false, localOrderId: null, summary: \"\" }; void onLeaflyOrderArrived;",
        "The single most expensive regression available: orders arrive, nothing "
        "is announced, nothing is printed, the shop never learns there is "
        "something to accept, and Leafly auto-cancels. Every unit test still "
        "passes because the bridge itself is untouched.",
    ),
    (
        "M10: the acceptance bridge failure is swallowed",
        "src/lib/leafly/order-ack-server.ts",
        "bridgeWarning = `Leafly has accepted this order",
        "bridgeWarning = null && `Leafly has accepted this order",
        "We tell Leafly 'yes', fail to create the local order, and say nothing "
        "to the human who pressed Accept. A customer is promised cannabis that "
        "no screen in the building knows about.",
    ),
    (
        "M11: the register forgets which marketplace an order came from",
        "src/lib/pos/pickup-core.ts",
        "    isMarketplace: isMarketplaceOrigin(origin),",
        "    isMarketplace: false,",
        "The exact defect this slice was written to fix, reintroduced. The "
        "counter sees no badge and a Leafly order becomes indistinguishable "
        "from a website order at the moment of handover.",
    ),
    (
        "M12: origin dropped at the hand-copied API boundary",
        "src/app/api/pos/pickup/route.ts",
        "        origin: loaded.origin,",
        "",
        "The classic silent loss: the store computes it, the type allows it, "
        "and the route simply never names it. Nothing anywhere fails.",
    ),
    (
        "M13: the board stops tolerating a pre-0228 database",
        "src/lib/leafly/order-board-server.ts",
        "      ({ data, error } = await runOne(BOARD_COLUMNS_LEGACY));",
        "      // fallback removed",
        "AGENTS rule 6 means the owner applies migrations by hand, so there is "
        "always a deploy-before-migration window. This drops the fallback on "
        "the SINGLE-ORDER read, which is the worst of the three: the Accept "
        "action then refuses, and Leafly auto-cancels a real order. Dropping "
        "one of three fallbacks in a refactor is far likelier than dropping "
        "all of them, and it is invisible in review.",
    ),
    (
        "M14: the three-state guarantee is broken with a single ??",
        "src/components/admin/orders/LeaflyOrdersPanel.tsx",
        "    announcedAt: order.announced_at,",
        "    announcedAt: order.announced_at ?? null,",
        "Two characters. Every order on a pre-0228 database is then accused of "
        "arriving silently, so the one REAL silent arrival hides among eleven "
        "false alarms and staff learn to ignore the warning.",
    ),
    (
        "M15: the cancel allowlist is inverted into a denylist",
        "src/lib/leafly/bridge-core.ts",
        "  if (SAFE_TO_AUTO_CANCEL_STATUSES.has(status)) {",
        "  if (!SAFE_TO_AUTO_CANCEL_STATUSES.has(status)) {",
        "Fails OPEN instead of closed. A status nobody anticipated is silently "
        "auto-cancelled instead of escalated \u2014 an order already bagged, or "
        "already in an open register sale, vanishes with no human told.",
    ),
    (
        "M16: the per-origin sound save stops clearing the other column",
        "src/app/admin/orders/announcer-actions.ts",
        '  const leafly = soundSelectionToColumns(field(form, "leaflySound"), isCustom);',
        '  const leafly = { soundId: field(form, "leaflySound") || null, customPath: null };',
        "Hand-rolling the column split for ONE origin. It looks harmless and "
        "it even works for built-ins, but it can never store a custom upload "
        "for Leafly - so the owner uploads a Leafly chime, saves, and keeps "
        "hearing the built-in bell with no error anywhere.",
    ),
    (
        "M17: the code-vs-comment trap \u2014 call deleted, comment left behind",
        "src/lib/leafly/webhook-server.ts",
        "      const { onLeaflyOrderCanceled } = await import(\"./bridge-server\");",
        "      const onLeaflyOrderCanceled = async (..._a: unknown[]) => ({ ok: true, announced: false, printed: false, localOrderId: null, summary: \"\" });",
        "This is the mutation that proves the comment-stripping in the gate is "
        "load-bearing. The words 'onLeaflyOrderCanceled' still appear in this "
        "file three times in PROSE, so a naive text search keeps passing "
        "forever after the real call is gone.",
    ),
]


def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def dirty(path):
    return run(f"git diff --quiet -- {path}").returncode != 0


def main():
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

    files = {m[1] for m in MUTATIONS}
    unstaged = [f for f in sorted(files) if dirty(f)]
    if unstaged:
        print("REFUSING TO RUN \u2014 these files have uncommitted changes:")
        for f in unstaged:
            print("   ", f)
        print("\nThis script reverts by restoring from git. Running it now would")
        print("destroy that work. Commit or stash first.")
        return 2

    # Baseline: the gate must PASS before any mutation, or the run proves nothing.
    print("=" * 78)
    print("BASELINE \u2014 the gate must pass on the real tree")
    print("=" * 78)
    base = run(f"npx vitest run {TEST} --no-file-parallelism --maxWorkers=1 --reporter=dot")
    if base.returncode != 0:
        print("BASELINE FAILED. Fix the suite before mutation testing.")
        print(base.stdout[-3000:])
        return 2
    print("baseline: PASS\n")

    caught, escaped = [], []

    for name, path, old, new, why in MUTATIONS:
        print("=" * 78)
        print(name)
        print("-" * 78)
        print(f"  file : {path}")
        print(f"  why  : {why}")

        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()

        count = original.count(old)
        if count != 1:
            print(f"  RESULT: SKIPPED \u2014 anchor appears {count} times (expected 1).")
            print("          The mutation could not be applied, so nothing was proven.")
            escaped.append((name, f"anchor appeared {count} times"))
            continue

        try:
            mutated = original.replace(old, new)
            assert mutated != original
            data = mutated.encode("utf-8")
            tmp = path + ".mutant.tmp"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)

            res = run(f"npx vitest run {TEST} --no-file-parallelism --maxWorkers=1 --reporter=dot")
            if res.returncode != 0:
                print("  RESULT: CAUGHT \u2705")
                # show which assertion did the catching - that is the useful part
                for line in res.stdout.splitlines():
                    if "FAIL" in line and ">" in line:
                        print("          " + line.strip()[:150])
                        break
                caught.append(name)
            else:
                print("  RESULT: ESCAPED \u274c \u2014 the bridge was cut and the gate said nothing.")
                escaped.append((name, "suite still green"))
        finally:
            # Always restore, even on KeyboardInterrupt or an exception above.
            with open(path, "wb") as fh:
                fh.write(original.encode("utf-8"))
            if dirty(path):
                print(f"  WARNING: {path} still differs from git after restore!")

    print()
    print("=" * 78)
    print(f"SUMMARY: {len(caught)} caught, {len(escaped)} escaped, of {len(MUTATIONS)}")
    print("=" * 78)
    for n, reason in escaped:
        print(f"  ESCAPED: {n}  ({reason})")

    return 0 if not escaped else 1


if __name__ == "__main__":
    sys.exit(main())

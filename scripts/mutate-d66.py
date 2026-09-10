#!/usr/bin/env python3
"""
scripts/mutate-d66.py — do the D-66/D-67 tests actually bite?

"Test it, test the tests." A green suite proves nothing on its own. This
deliberately reintroduces the defect (and its neighbours) one mutation at a
time and demands that the suite go RED. A mutant that survives is a test that
was decorative.

Every mutation below is a bug a real person could plausibly reintroduce:
someone "tidying up" an unused return value, someone deleting a query they
think is dead, someone simplifying rounding, someone editing pi-agent/ and
forgetting the served copy.

  python3 scripts/mutate-d66.py

Anchors are verified BEFORE anything is written; the original bytes are held in
memory and restored in a finally block, so an interrupted run cannot leave the
tree dirty.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

CORE = "src/lib/announcer/announcer-admin-core.ts"
STORE = "src/lib/announcer/announcer-admin-store.ts"
PANEL = "src/components/admin/orders/AnnouncerPanel.tsx"
SERVED_AGENT = "public/announcer/greenway_announcer.py"

TEST_CMD = [
    "npx",
    "vitest",
    "run",
    "tests/compliance/announcer-admin.test.ts",
]

# Self-tests live inside the core module, so the pure sweep is a second gate.
SELFTEST_CMD = ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]


# (id, description, file, [(old, new), ...], gate)
#   gate: "vitest" | "selftest"
MUTANTS: list[tuple[str, str, str, list[tuple[str, str]], str]] = [
    # ---------------------------------------------------------------- the defect
    (
        "M1",
        "THE ORIGINAL DEFECT: store stops reading pairings back (always empty)",
        STORE,
        [("pendingPairings: await getPendingPairings(admin, nowIso)", "pendingPairings: []")],
        "vitest",
    ),
    (
        "M2",
        "store queries the wrong table, so no code is ever found",
        STORE,
        [('.from("announcer_pairings")', '.from("announcer_devices")')],
        "vitest",
    ),
    (
        "M3",
        "panel no longer renders the code (created, still invisible)",
        PANEL,
        [("{p.display}", "{null}")],
        "vitest",
    ),
    (
        "M4",
        "install command reverts to a placeholder hostname",
        PANEL,
        [("--site {announcerSiteUrl()}", "--site https://YOUR-SITE.com")],
        "vitest",
    ),
    (
        "M5",
        "site URL hardcoded, ignoring the environment",
        PANEL,
        [
            (
                'return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://greenwaymarijuana.com").replace(/\\/$/, "");',
                'return "https://greenwaymarijuana.com";',
            )
        ],
        "vitest",
    ),
    # ------------------------------------------------- correctness of the filter
    (
        "M6",
        "consumed/expired codes leak onto the screen (validity check dropped)",
        CORE,
        [("if (!validity.valid) continue;", "if (false) continue;")],
        "selftest",
    ),
    (
        "M7",
        "only consumed codes filtered; expiry ignored",
        CORE,
        [
            (
                "if (!validity.valid) continue;",
                "if (row.consumed_at !== null) continue;",
            )
        ],
        "selftest",
    ),
    (
        "M8",
        "oldest code shown first, so a stale code is read aloud",
        CORE,
        [
            (
                "live.sort((a, b) => b.createdAt - a.createdAt);",
                "live.sort((a, b) => a.createdAt - b.createdAt);",
            )
        ],
        "selftest",
    ),
    (
        "M9",
        "sorting removed entirely (relies on database order)",
        CORE,
        [("live.sort((a, b) => b.createdAt - a.createdAt);", "")],
        "selftest",
    ),
    # -------------------------------------------------------- rounding / display
    (
        "M10",
        'rounding floor+no clamp: a live code reads "expires in 0 minutes"',
        CORE,
        [
            (
                "const minutesLeft = Math.max(1, Math.ceil(PAIRING_TTL_MINUTES - ageMinutes));",
                "const minutesLeft = Math.floor(PAIRING_TTL_MINUTES - ageMinutes);",
            )
        ],
        "selftest",
    ),
    (
        "M11",
        "clamp removed, so the last minute goes negative",
        CORE,
        [
            (
                "const minutesLeft = Math.max(1, Math.ceil(PAIRING_TTL_MINUTES - ageMinutes));",
                "const minutesLeft = Math.ceil(PAIRING_TTL_MINUTES - ageMinutes);",
            )
        ],
        "selftest",
    ),
    (
        "M12",
        "display shows the raw code, losing the XXXX-XXXX grouping",
        CORE,
        [("display: formatPairingCode(row.code),", "display: row.code,")],
        "selftest",
    ),
    (
        "M13",
        "raw not normalised, so the install command carries a dash",
        CORE,
        [("raw: normalizePairingCode(row.code),", "raw: formatPairingCode(row.code),")],
        "selftest",
    ),
    # ------------------------------------------------------------------ D-67 drift
    (
        "M15",
        "D-67: served agent drifts from pi-agent/ (stale install on the Pi)",
        SERVED_AGENT,
        [("#!/usr/bin/env python3", "#!/usr/bin/env python3\n# drifted copy")],
        "vitest",
    ),
]

# Mutations that are genuinely behaviour-preserving. Listed honestly rather than
# chased with a test that cannot actually tell the difference.
EQUIVALENT_MUTANTS: dict[str, str] = {
    "M14": (
        'Removing the `if (!Number.isFinite(now)) return [];` guard in '
        "pendingPairings() is UNTESTABLE from the outside, because it is a "
        "genuine equivalent mutant. With a garbage nowIso, pairingCodeValidity() "
        "independently does Date.parse(nowIso), gets NaN, fails its own "
        "!Number.isFinite(now) check and reports every row invalid — so each row "
        "hits `continue` and the function still returns []. The guard is kept as "
        "a cheap early exit and as documentation of intent, not because any "
        "observable behaviour depends on it. Attempted and rejected: asserting "
        "on it via source grep, which would test the text of the code rather "
        "than what the code does."
    ),
}


def run(cmd: list[str]) -> int:
    return subprocess.run(
        cmd, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    ).returncode


def main() -> int:
    # ---- 1. verify every anchor before touching anything -------------------
    print("Verifying anchors...")
    originals: dict[str, str] = {}
    problems: list[str] = []
    for mid, desc, rel, edits, _gate in MUTANTS:
        path = REPO / rel
        if not path.exists():
            problems.append(f"{mid}: missing file {rel}")
            continue
        text = originals.setdefault(rel, path.read_text(encoding="utf8"))
        for old, _new in edits:
            n = text.count(old)
            if n != 1:
                problems.append(f"{mid}: anchor found {n}x (need exactly 1) in {rel}: {old[:70]!r}")
    if problems:
        print("\nANCHOR VERIFICATION FAILED — nothing was modified:")
        for p in problems:
            print("  " + p)
        return 2
    print(f"  all {sum(len(m[3]) for m in MUTANTS)} anchors unique across {len(originals)} files\n")

    # ---- 2. baseline must be GREEN ----------------------------------------
    print("Baseline (unmutated) must pass...")
    if run(TEST_CMD) != 0:
        print("  BASELINE VITEST FAILED — fix the suite before mutating.")
        return 2
    if run(SELFTEST_CMD) != 0:
        print("  BASELINE SELF-TESTS FAILED — fix them before mutating.")
        return 2
    print("  baseline green\n")

    killed: list[str] = []
    survived: list[tuple[str, str]] = []

    try:
        for mid, desc, rel, edits, gate in MUTANTS:
            path = REPO / rel
            text = originals[rel]
            mutated = text
            for old, new in edits:
                mutated = mutated.replace(old, new, 1)
            path.write_text(mutated, encoding="utf8")

            cmd = TEST_CMD if gate == "vitest" else SELFTEST_CMD
            rc = run(cmd)
            path.write_text(text, encoding="utf8")  # restore immediately

            if rc != 0:
                killed.append(mid)
                print(f"  KILLED   {mid}  {desc}")
            else:
                survived.append((mid, desc))
                print(f"  SURVIVED {mid}  {desc}   <-- test gap ({gate})")
    finally:
        for rel, text in originals.items():
            (REPO / rel).write_text(text, encoding="utf8")
        print("\nAll files restored from in-memory snapshot.")

    total = len(MUTANTS)
    print(f"\n{'=' * 70}")
    print(f"MUTATION SCORE: {len(killed)}/{total} killed")
    if EQUIVALENT_MUTANTS:
        print(f"(documented equivalent mutants: {len(EQUIVALENT_MUTANTS)})")
    if survived:
        print("\nSURVIVORS — these defects would ship undetected:")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        return 1
    print("No survivors. Every reintroduced defect was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""SLICE L-24 — MUTATION TESTING for the order detail view and ID images.

"Test it, test the tests."

A green suite proves nothing by itself. This script breaks the implementation
in ways a real developer plausibly WOULD break it — an off-by-one, an AND that
becomes an OR, a flag that stops being passed — and checks the suite actually
fails each time. A mutant that SURVIVES is a hole in the tests.

RULE 137: every anchor is verified to match EXACTLY ONCE before any mutation
runs. An anchor that matches zero times mutates nothing and reports a false
"killed"; an anchor that matches twice changes more than intended.

RULE 13c: a CONTROL mutant is included that changes only a comment. It MUST
SURVIVE. If the control dies, the harness is reporting failures that have
nothing to do with the mutation and every other result is meaningless.

Every mutation is reverted in a `finally`, so an interrupt cannot leave a
mutant in the tree. An md5 check at the end proves every file was restored.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/leafly/order-detail-core.ts"
SERVER = "src/lib/leafly/order-detail-server.ts"
FETCH = "src/lib/leafly/deadline-fetch.ts"
DEADLINE = "src/lib/leafly/deadline-core.ts"
ROUTE = "src/app/api/admin/leafly-id-image/route.ts"
HARNESS = "scripts/compliance/run-pure-selftests.ts"

SUITES = [
    "tests/compliance/leafly-order-detail.test.ts",
    "tests/compliance/leafly-deadline.test.ts",
    "tests/compliance/leafly-deadline-body.test.ts",
    # Added for run two. The first run left EIGHT survivors, every one of them
    # in code the other three suites could only inspect as source text. This
    # file executes the route and the server function instead, so the probe
    # can now see behavioural kills rather than string matches.
    "tests/compliance/leafly-id-image-runtime.test.ts",
]

# (label, file, find, replace, why it matters)
MUTANTS: list[tuple[str, str, str, str, str]] = [
    # ---- The access window: the rules that decide whether a staff member
    # ---- can see a customer's ID at all. -----------------------------------
    (
        "access window becomes an OR (acknowledged check dropped)",
        CORE,
        '  const acked = typeof input.acknowledgedAt === "string" && input.acknowledgedAt.trim() !== "";',
        "  const acked = false;",
        "Would offer an ID-image button on an acknowledged order. Leafly has "
        "already revoked the media, so every press 404s and the operator "
        "concludes the software is broken rather than that the door shut.",
    ),
    (
        "pending check dropped (auto-cancelled orders look viewable)",
        CORE,
        "  if (status !== LEAFLY_MEDIA_REQUIRED_STATUS) {",
        "  if (false) {",
        "The 15-minute auto-cancel produces unacknowledged+canceled orders. "
        "Dropping this check offers ID images for every one of them.",
    ),
    (
        "required status changed to confirmed",
        CORE,
        'export const LEAFLY_MEDIA_REQUIRED_STATUS = "pending";',
        'export const LEAFLY_MEDIA_REQUIRED_STATUS = "confirmed";',
        "The spec says pending. Any other value inverts the whole window.",
    ),
    (
        "acknowledged refusal no longer reported as permanent",
        CORE,
        '        "again. Check the customer\'s physical ID at the counter as normal.",\n      permanentlyClosed: true,\n    };\n  }\n\n  const status =',
        '        "again. Check the customer\'s physical ID at the counter as normal.",\n      permanentlyClosed: false,\n    };\n  }\n\n  const status =',
        "Offers a retry button on a door that cannot reopen, wasting the "
        "operator's attention during the only fifteen minutes they have.",
    ),
    (
        "missing order id reported as permanently closed",
        CORE,
        "      // NOT permanent: a repaired row would have an id. Calling this permanent\n      // would tell the operator to give up on a recoverable data problem.\n      permanentlyClosed: false,",
        "      // NOT permanent: a repaired row would have an id. Calling this permanent\n      // would tell the operator to give up on a recoverable data problem.\n      permanentlyClosed: true,",
        "Tells the operator to give up on a recoverable data fault.",
    ),
    # ---- The URL shape: the 404-that-reads-as-missing-order trap. ----------
    (
        "media URL moved under /orders/ (the documented trap)",
        CORE,
        "  return `${baseUrl}/${encodeURIComponent(orderIntegrationKey)}/${segment}/${encodeURIComponent(leaflyOrderId)}`;",
        "  return `${baseUrl}/${encodeURIComponent(orderIntegrationKey)}/orders/${encodeURIComponent(leaflyOrderId)}/${segment}`;",
        "Media sits at the ROOT of the namespace. This shape 404s, and a 404 "
        "here reads as 'Leafly does not have that order'.",
    ),
    (
        "order id no longer percent-encoded",
        CORE,
        "/${segment}/${encodeURIComponent(leaflyOrderId)}`;",
        "/${segment}/${leaflyOrderId}`;",
        "The id arrives from a webhook. An unencoded slash retargets the "
        "request at a different endpoint.",
    ),
    # ---- Money: the IEEE 754 half-cent defect this slice already found once.
    (
        "toMinorUnits reverts to Math.round(value * 100)",
        CORE,
        "  const third = frac.length > 2 ? Number(frac[2]) : 0;\n  if (Number.isFinite(third) && third >= 5) minor += 1;",
        "  const third = frac.length > 2 ? Number(frac[2]) : 0;\n  if (Number.isFinite(third) && third > 5) minor += 1;",
        "Half-up becomes round-down at exactly .x5, losing a cent on any "
        "half-cent value. This is the defect the self-tests caught in "
        "development; it must not come back.",
    ),
    (
        "unreadable money becomes 0 instead of null",
        CORE,
        "  if (whole === \"\" && frac === \"\") return null;",
        "  if (whole === \"\" && frac === \"\") return 0;",
        "A missing total rendering as $0.00 is how a bag leaves the counter "
        "without payment.",
    ),
    (
        "formatDetailMoney renders a missing amount as $0.00",
        CORE,
        '  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return "—";',
        '  if (typeof minorUnits !== "number" || !Number.isFinite(minorUnits)) return "$0.00";',
        "Same defect at the display layer: 'missing' and 'free' must never "
        "render identically.",
    ),
    # ---- PII ---------------------------------------------------------------
    (
        "medical card number no longer masked",
        CORE,
        '  return `${"•".repeat(Math.min(t.length - 4, 8))}${t.slice(-4)}`;',
        "  return t;",
        "Renders a state-issued medical identifier in full on a screen in a "
        "shared back office.",
    ),
    (
        "short card numbers partially revealed",
        CORE,
        '  if (t.length <= 4) return "•".repeat(t.length);',
        '  if (t.length <= 0) return "•".repeat(t.length);',
        "Revealing the last four of a five-character value reveals almost "
        "all of it.",
    ),
    # ---- The binary body: the measured image-destroying defect. ------------
    (
        "binary flag ignored (images decoded as UTF-8 and destroyed)",
        FETCH,
        "  const binary = options?.binary === true;",
        "  const binary = false;",
        "MEASURED: a 52-byte JPEG becomes 68 bytes of U+FFFD and the magic "
        "number ffd8ffe0 becomes efbfbd. The operator sees a broken image "
        "and must choose between acknowledging blind and cancelling a real "
        "customer's order.",
    ),
    (
        "binary flag becomes truthy rather than strict",
        FETCH,
        "  const binary = options?.binary === true;",
        "  const binary = options?.binary !== false;",
        "Flips the DEFAULT for all six existing JSON call sites.",
    ),
    (
        "media fetch stops requesting binary",
        SERVER,
        "      { binary: true },",
        "      { binary: false },",
        "The call site half of the same defect.",
    ),
    # ---- The deadline: the five-minute hang, on a new path. ----------------
    (
        "media_fetch budget widened to 5 minutes",
        DEADLINE,
        "  media_fetch: 12_000,",
        "  media_fetch: 300_000,",
        "Reintroduces the owner's original complaint ('it thinks for 5 "
        "minutes, vercels max') on the one screen where a person is waiting.",
    ),
    (
        "media_fetch retries like a menu push",
        DEADLINE,
        "  media_fetch: 2,",
        "  media_fetch: 6,",
        "Six attempts plus six mints inside a fifteen-minute window.",
    ),
    # ---- The server: refusals and safety. ----------------------------------
    (
        "local access check skipped before calling Leafly",
        SERVER,
        "  if (!detail.mediaAccess.allowed) {",
        "  if (false) {",
        "Turns a readable 'this was acknowledged, the images are gone' into "
        "a bare 403/404 from Leafly, which reads as 'no such order'.",
    ),
    (
        "Leafly's 403/404 refusal treated as retryable",
        SERVER,
        "        retryable: false,\n        summary: `media: Leafly refused with HTTP ${res.status}`,",
        "        retryable: true,\n        summary: `media: Leafly refused with HTTP ${res.status}`,",
        "Offers a retry against a permanently closed window.",
    ),
    (
        "empty image body passed through as a success",
        SERVER,
        "    if (bytes.byteLength === 0) {",
        "    if (false) {",
        "A zero-byte 200 renders a broken-image icon with no explanation, "
        "which the operator reads as 'no ID on file'.",
    ),
    (
        "auth retry loops forever instead of once",
        SERVER,
        "    if (res.status === 401 && !didRetryAuth) {",
        "    if (res.status === 401) {",
        "An infinite retry loop on a path a person is waiting on.",
    ),
    # ---- The route: the compliance controls. -------------------------------
    (
        "ID images become cacheable",
        ROUTE,
        '  "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",',
        '  "Cache-Control": "public, max-age=3600",',
        "A government ID in a shared tablet's disk cache outlives the "
        "fifteen minutes Leafly grants. This is the compliance control of "
        "the slice.",
    ),
    (
        "permission check dropped from the image route",
        ROUTE,
        '    await requirePermission("orders.manage");',
        "    await Promise.resolve();",
        "Serves customer government IDs to any authenticated session.",
    ),
    (
        "media kind no longer validated",
        ROUTE,
        "  if (!isLeaflyMediaKind(kindRaw)) {",
        "  if (false) {",
        "An unvalidated segment goes into an outbound URL.",
    ),
    # ---- The harness: disarming the tests without touching the code. -------
    (
        "detail core unregistered from CI",
        HARNESS,
        '  assertRan("leafly-order-detail-core", __runLeaflyOrderDetailTests(), 140);',
        "  // unregistered",
        "186 assertions stop running and nothing reports it.",
    ),
    (
        "detail core floor dropped to zero",
        HARNESS,
        '  assertRan("leafly-order-detail-core", __runLeaflyOrderDetailTests(), 140);',
        '  assertRan("leafly-order-detail-core", __runLeaflyOrderDetailTests(), 0);',
        "Every assertion could be deleted and CI would still pass.",
    ),
    (
        "deadline core floor reverted below the ninth operation",
        HARNESS,
        '  assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 700);',
        '  assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 640);',
        "media_fetch could be deleted entirely without CI noticing.",
    ),
    # ---- RULE 13c: THE CONTROL. Comment-only. MUST SURVIVE. ----------------
    (
        "CONTROL (comment only — MUST SURVIVE)",
        CORE,
        "// 4. SELF-TESTS (house rule 5)",
        "// 4. SELF-TESTS (house rule 5) [control]",
        "Changes nothing executable. If this DIES the harness is reporting "
        "noise and every other result in this run is meaningless.",
    ),
]

CONTROL_LABEL = "CONTROL (comment only — MUST SURVIVE)"


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def run_suite() -> bool:
    """True when the suite PASSES."""
    r = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return False
    # The pure self-tests run in a separate harness, so a mutation that only
    # the self-tests catch would otherwise look like a survivor.
    r2 = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return r2.returncode == 0


def main() -> int:
    # ---- RULE 137 PREFLIGHT ------------------------------------------------
    print("=" * 72)
    print("PREFLIGHT (Rule 137): every anchor must match exactly once")
    print("=" * 72)
    bad = 0
    for label, rel, find, _replace, _why in MUTANTS:
        n = (ROOT / rel).read_text(encoding="utf-8").count(find)
        flag = "ok " if n == 1 else "BAD"
        if n != 1:
            bad += 1
        print(f"  [{flag}] {n}x  {label}")
    if bad:
        print(f"\nABORT: {bad} anchor(s) did not match exactly once.")
        return 2
    print(f"\nAll {len(MUTANTS)} anchors matched exactly once.\n")

    before = {rel: md5(ROOT / rel) for rel in {m[1] for m in MUTANTS}}

    killed: list[str] = []
    survived: list[tuple[str, str, str]] = []
    control_survived = False

    for i, (label, rel, find, replace, why) in enumerate(MUTANTS, 1):
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        print(f"[{i}/{len(MUTANTS)}] {label} ...", flush=True)
        try:
            path.write_text(original.replace(find, replace), encoding="utf-8")
            passed = run_suite()
            if label == CONTROL_LABEL:
                control_survived = passed
                print(
                    f"    CONTROL {'SURVIVED (correct)' if passed else 'DIED (HARNESS BROKEN)'}",
                    flush=True,
                )
            elif passed:
                print("    SURVIVED  <-- HOLE IN THE TESTS", flush=True)
                survived.append((label, rel, why))
            else:
                print("    killed", flush=True)
                killed.append(label)
        finally:
            path.write_text(original, encoding="utf-8")

    # ---- RESTORATION PROOF -------------------------------------------------
    after = {rel: md5(ROOT / rel) for rel in before}
    dirty = [rel for rel in before if before[rel] != after[rel]]

    real = len(MUTANTS) - 1
    print("\n" + "=" * 72)
    print(f"MUTATION SCORE: {len(killed)}/{real} killed")
    print(f"CONTROL: {'SURVIVED (harness sound)' if control_survived else 'DIED (HARNESS BROKEN)'}")
    print(f"RESTORATION: {'all files restored' if not dirty else 'DIRTY: ' + ', '.join(dirty)}")
    if survived:
        print("\nSURVIVORS (holes in the tests):")
        for label, rel, why in survived:
            print(f"  - {label} [{rel}]\n      {why}")
    if survived or not control_survived or dirty:
        return 1
    print("\nAll mutants killed, control survived, tree clean. The tests have teeth.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

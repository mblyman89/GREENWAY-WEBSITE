#!/usr/bin/env python3
"""
Mutation harness for Slice L-1b — "test the tests" for the Leafly ORDER contract.

A test that cannot fail is not a test (AGENTS.md CCRS protocol step 6, Part 05 D-10/D-11).
This script deliberately breaks the order contract one edit at a time and asserts that
`tests/compliance/leafly-order-contract.test.ts` goes RED. If a mutation SURVIVES (the suite
still passes), the tests have a hole and this script exits non-zero.

Three false greens this harness is specifically designed to catch, all three of which have
bitten this repo before:

  1. A broken harness that exits before any test runs — so we assert the BASELINE is green
     AND that it reports a plausible test count, not merely the word "passed".
  2. An ambiguous fragment that silently patches the wrong occurrence — so every mutation
     is rejected unless its fragment appears EXACTLY once.
  3. An "equivalent mutant" whose change is not observable. Every mutation below alters
     something an assertion reads directly.

The highest-value mutations here are the Q6 ones (M20-M24). The communications rule is
invisible in code: nothing about a missing `if` reads as wrong. Those five mutations are the
only mechanical proof that the rule is actually enforced and not merely commented about.

Target files are always restored from an in-memory copy in a finally-block, so an interrupted
run cannot leave a mutated file behind.

Usage:
    python3 scripts/leafly/mutate-order-contract-check.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

REPO = os.environ.get(
    "GREENWAY_REPO",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
)

CORE = "src/lib/leafly/order-contract-core.ts"
SPEC = "docs/leafly-specs/order-api-v1.openapi.json"
DOC = "docs/leafly-order-api-v1.md"
TESTS = "tests/compliance/leafly-order-contract.test.ts"

# Minimum tests the baseline must report. Guards false-green #1: a harness/flag that exits
# before the suite runs would report far fewer, or none.
MIN_EXPECTED_TESTS = 45

# (id, file, old_fragment, new_fragment, why_this_must_be_caught)
MUTATIONS: list[tuple[str, str, str, str, str]] = [
    # ---------------------------------------------------------------- #
    # Webhook events and paths
    # ---------------------------------------------------------------- #
    (
        "M1-drop-an-event",
        CORE,
        '  "order_cancel",\n  "order_status",\n] as const;',
        '  "order_status",\n] as const;',
        "losing an event must fail: Leafly declares six and we must serve six",
    ),
    (
        "M2-invent-an-event",
        CORE,
        '  "order_status",\n] as const;\n\nexport type LeaflyOrderEventType',
        '  "order_status",\n  "order_update",\n] as const;\n\nexport type LeaflyOrderEventType',
        "an event Leafly does not send must fail against the spec's EventType enum",
    ),
    (
        "M3-path-typo",
        CORE,
        '  order_submit: "/api/webhooks/leafly/order-submit",',
        '  order_submit: "/api/webhooks/leafly/order_submit",',
        "an underscore in a route path silently 404s every submitted order",
    ),
    (
        "M4-path-collision",
        CORE,
        '  order_cancel: "/api/webhooks/leafly/order-cancel",',
        '  order_cancel: "/api/webhooks/leafly/order-submit",',
        "two events sharing a route means one handler answers with the wrong shape",
    ),
    (
        "M5-path-off-namespace",
        CORE,
        '  order_status: "/api/webhooks/leafly/order-status",',
        '  order_status: "/api/leafly/order-status",',
        "a route outside the approved namespace was not what the owner approved",
    ),
    (
        "M6-preview-not-required-flipped",
        CORE,
        'export const LEAFLY_REQUIRED_ORDER_EVENTS = ["order_submit", "order_cancel"] as const;',
        'export const LEAFLY_REQUIRED_ORDER_EVENTS = ["order_submit", "order_preview"] as const;',
        "mis-marking which events gate certification misdirects triage",
    ),
    (
        "M7-wrong-body-returning-event",
        CORE,
        'export const LEAFLY_ORDER_EVENTS_RETURNING_A_BODY = ["order_preview"] as const;',
        'export const LEAFLY_ORDER_EVENTS_RETURNING_A_BODY = ["order_submit"] as const;',
        "order_preview is the ONLY webhook that answers with a body; swapping it "
        "means stale prices at checkout and a wrong-shaped submit reply",
    ),
    (
        "M8-two-body-returning-events",
        CORE,
        'export const LEAFLY_ORDER_EVENTS_RETURNING_A_BODY = ["order_preview"] as const;',
        'export const LEAFLY_ORDER_EVENTS_RETURNING_A_BODY = ["order_preview", "order_status"] as const;',
        "widening the body-returning set must fail; the rest must answer empty 200",
    ),
    # ---------------------------------------------------------------- #
    # Webhook response codes — the "never 4xx" rule
    # ---------------------------------------------------------------- #
    (
        "M9-accept-4xx",
        CORE,
        "export const LEAFLY_WEBHOOK_OK_STATUS_CODES = [200, 201] as const;",
        "export const LEAFLY_WEBHOOK_OK_STATUS_CODES = [200, 201, 400, 422] as const;",
        "answering 4xx on a business complaint makes Leafly retry then AUTO-CANCEL "
        "the customer's order",
    ),
    (
        "M10-accept-204",
        CORE,
        "export const LEAFLY_WEBHOOK_OK_STATUS_CODES = [200, 201] as const;",
        "export const LEAFLY_WEBHOOK_OK_STATUS_CODES = [200, 201, 204] as const;",
        "204 looks harmless and is not in Leafly's accepted set",
    ),
    # ---------------------------------------------------------------- #
    # Lifecycle
    # ---------------------------------------------------------------- #
    (
        "M11-status-enum-drift",
        CORE,
        '  "out_for_delivery",\n  "arrived_at_customer",',
        '  "out_for_delivery",\n  "arrived_at_store",',
        "a renamed status must fail against the spec's OrderStatus enum",
    ),
    (
        "M12-status-order-shuffled",
        CORE,
        'export const LEAFLY_ORDER_STATUSES = [\n  "pending",\n  "confirmed",',
        'export const LEAFLY_ORDER_STATUSES = [\n  "confirmed",\n  "pending",',
        "lifecycle ORDER is asserted, not just membership",
    ),
    (
        "M13-pending-becomes-settable",
        CORE,
        'export const LEAFLY_NON_SETTABLE_ORDER_STATUSES = ["pending", "expired"] as const;',
        'export const LEAFLY_NON_SETTABLE_ORDER_STATUSES = ["expired"] as const;',
        "the spec forbids SETTING pending; trying to is a rejected API call",
    ),
    (
        "M14-expired-becomes-settable",
        CORE,
        'export const LEAFLY_NON_SETTABLE_ORDER_STATUSES = ["pending", "expired"] as const;',
        'export const LEAFLY_NON_SETTABLE_ORDER_STATUSES = ["pending"] as const;',
        "expired belongs to Leafly, set when we blow the ack deadline",
    ),
    (
        "M15-terminal-widened",
        CORE,
        'export const LEAFLY_TERMINAL_ORDER_STATUSES = ["picked_up", "canceled"] as const;',
        'export const LEAFLY_TERMINAL_ORDER_STATUSES = ["picked_up", "canceled", "expired"] as const;',
        "the spec names exactly two terminal states for certification",
    ),
    (
        "M16-marketplace-drift",
        CORE,
        'export const LEAFLY_ORDER_MARKETPLACES = ["leafly", "uberEats"] as const;',
        'export const LEAFLY_ORDER_MARKETPLACES = ["leafly", "ubereats"] as const;',
        "uberEats is camelCase in Leafly's enum; a case slip breaks origin matching "
        "AND would silently un-suppress UberEats customer email",
    ),
    (
        "M17-cancel-reason-drift",
        CORE,
        '  "order_api_unacknowledged",\n] as const;',
        '  "order_api_unacknowledged_timeout",\n] as const;',
        "we must recognise the cancel reason WE cause by missing the deadline",
    ),
    # ---------------------------------------------------------------- #
    # Deadlines
    # ---------------------------------------------------------------- #
    (
        "M18-ack-deadline-wrong",
        CORE,
        "export const LEAFLY_ORDER_ACK_DEADLINE_MINUTES = 15;",
        "export const LEAFLY_ORDER_ACK_DEADLINE_MINUTES = 30;",
        "a too-generous deadline means orders auto-cancel while we think we have time",
    ),
    (
        "M19-media-window-ignored",
        CORE,
        "export const LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT = true;",
        "export const LEAFLY_ORDER_MEDIA_REQUIRES_PRE_ACKNOWLEDGEMENT = false;",
        "acknowledging before fetching ID media revokes access to it PERMANENTLY",
    ),
    # ---------------------------------------------------------------- #
    # THE COMMUNICATIONS RULE (owner's Q6) — the point of this slice
    # ---------------------------------------------------------------- #
    (
        "M20-unsuppress-customer-email",
        CORE,
        'export const LEAFLY_SUPPRESSED_EMAIL_AUDIENCES = ["customer"] as const;',
        "export const LEAFLY_SUPPRESSED_EMAIL_AUDIENCES = [] as const;",
        "THE breach: the Leafly shopper gets a second confirmation from us, which can "
        "disagree with Leafly's. Nothing else in CI would notice",
    ),
    (
        "M21-suppress-staff-too",
        CORE,
        'export const LEAFLY_SUPPRESSED_EMAIL_AUDIENCES = ["customer"] as const;',
        'export const LEAFLY_SUPPRESSED_EMAIL_AUDIENCES = ["customer", "staff"] as const;',
        "over-suppressing kills the staff alert, so a pickup order sits unnoticed "
        "until Leafly auto-cancels it at fifteen minutes",
    ),
    (
        "M22-blanket-suppression-hits-our-own-store",
        CORE,
        '  if (origin === "greenway") return true;',
        "  if (false) return true;",
        "the regression that would be easiest to ship: silencing our OWN storefront's "
        "confirmation email, undetectable until a customer complains",
    ),
    (
        "M23-suppression-inverted",
        CORE,
        "  return !(LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes(audience);",
        "  return (LEAFLY_SUPPRESSED_EMAIL_AUDIENCES as readonly string[]).includes(audience);",
        "an inverted predicate emails exactly the wrong audience in both directions",
    ),
    (
        "M24-suppression-reason-goes-silent",
        CORE,
        'export const LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON =\n  "suppressed: Leafly is the sole originator of consumer order communications";',
        'export const LEAFLY_CUSTOMER_EMAIL_SUPPRESSION_REASON = "";',
        "a skip with no reason is indistinguishable from a broken RESEND_API_KEY at 2am",
    ),
    (
        "M25-rule-quietly-dropped-from-the-spec",
        SPEC,
        "Leafly will be the sole originator of automated consumer facing communications",
        "Leafly may be an originator of automated consumer facing communications",
        "if a re-downloaded spec ever relaxes this rule the tests MUST go red so the "
        "decision is revisited deliberately, not by accident",
    ),
    (
        "M26-audience-vocabulary-diverges",
        CORE,
        'export const LEAFLY_EMAIL_AUDIENCES = ["customer", "staff"] as const;',
        'export const LEAFLY_EMAIL_AUDIENCES = ["customer", "staff", "driver"] as const;',
        "a new audience must not default to 'send'; it must be classified explicitly",
    ),
    # ---------------------------------------------------------------- #
    # Environment
    # ---------------------------------------------------------------- #
    (
        "M27-sandbox-points-at-production",
        CORE,
        '  sandbox: "https://reservations-api-sandbox.leafly.io/v1/order_integration",',
        '  sandbox: "https://reservations-api.leafly.com/v1/order_integration",',
        "a sandbox test that hits production would move REAL customer orders",
    ),
    (
        "M28-per-deployment-webhook-host",
        CORE,
        'export const LEAFLY_WEBHOOK_HOST = "greenwaywebsite1.vercel.app";',
        'export const LEAFLY_WEBHOOK_HOST = "greenwaywebsite1-a1b2c3d4-mblyman89.vercel.app";',
        "a per-deployment URL strands every webhook after the next push",
    ),
    (
        "M29-webhook-host-is-production-domain",
        CORE,
        'export const LEAFLY_WEBHOOK_HOST = "greenwaywebsite1.vercel.app";',
        'export const LEAFLY_WEBHOOK_HOST = "greenwaymarijuana.com";',
        "the owner was explicit: point Leafly at Vercel, NOT the production domain",
    ),
    (
        "M30-dynamic-metadata-assumed-supported",
        CORE,
        "export const LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA = false;",
        "export const LEAFLY_SUPPORTS_DYNAMIC_REQUEST_METADATA = true;",
        "assuming custom headers work leads to an auth scheme Leafly cannot use, so "
        "HMAC-over-body is the only option",
    ),
    (
        "M31-retailer-key-field-wrong",
        CORE,
        'export const LEAFLY_ORDER_RETAILER_KEY_FIELD = "orderIntegrationKey";',
        'export const LEAFLY_ORDER_RETAILER_KEY_FIELD = "order_integration_key";',
        "the JSON field is camelCase even though the URL segment is snake_case — "
        "exactly the class of error that caused the eight menu defects",
    ),
    # ---------------------------------------------------------------- #
    # Doc-rot guards (precedent: announcer-docs.test.ts)
    # ---------------------------------------------------------------- #
    (
        "M32-doc-contradicts-ack-deadline",
        DOC,
        "an order not\nacknowledged within fifteen minutes",
        "an order not\nacknowledged within 45 minutes",
        "the doc must not be allowed to state a deadline the code contradicts",
    ),
    (
        # This mutation SURVIVED on the first run. The assertion was
        # `/Question 6|sole originator/i`, and deleting the whole section still left
        # "sole originator" elsewhere in the doc, so the alternation was satisfied by
        # text that was never the thing being protected. The test now requires the
        # HEADING. Kept as a permanent regression guard for that hole.
        "M33-doc-loses-the-q6-explanation",
        DOC,
        "## 3. Question 6, explained properly",
        "## 3. Notes",
        "the owner explicitly asked for this explanation; it must not silently vanish",
    ),
    (
        "M33a-doc-loses-the-industry-standard-answer",
        DOC,
        "consistent enough to call it the\nindustry standard",
        "reasonably consistent",
        "the owner asked 'what is the professional industry standard' — that part of "
        "the answer must not decay away independently of the heading",
    ),
    (
        "M33b-doc-loses-the-cultivera-answer",
        DOC,
        "### 3.3 What Cultivera does",
        "### 3.3 Notes on other vendors",
        "the owner named Cultivera specifically; the section answering him must survive",
    ),
    (
        "M33c-doc-loses-the-posabit-evidence",
        DOC,
        "**POSaBIT** — a Washington company",
        "**A vendor** — a Washington company",
        "POSaBIT is the closest WA analogue and the clearest quoted evidence; losing "
        "the citation reduces the answer to an unsupported assertion",
    ),
    (
        "M33d-cultivera-finding-softened",
        DOC,
        "There is no Cultivera order-integration article",
        "There may be a Cultivera order-integration article",
        "the load-bearing fact is that Leafly orders never reach the Cultivera POS; "
        "softening it implies a precedent that does not exist",
    ),
    (
        "M34-doc-names-wrong-sandbox-host",
        DOC,
        "`https://reservations-api-sandbox.leafly.io/v1/order_integration` in sandbox",
        "`https://reservations-api-sandbox.leafly.com/v1/order_integration` in sandbox",
        "sandbox is .leafly.io, production is .leafly.com — different TLDs",
    ),
]


def run_tests() -> tuple[int, str]:
    proc = subprocess.run(
        ["npx", "vitest", "run", TESTS],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=900,
    )
    return proc.returncode, proc.stdout + proc.stderr


ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def baseline_test_count(out: str) -> int:
    """
    Parse the reported test count so a silent no-op run cannot pass as green.

    ANSI colour codes MUST be stripped first. They contain digits (`\\x1b[1m`, `\\x1b[32m`),
    and a naive digit scan reads the escape sequence instead of the count — which is exactly
    what happened on this harness's first run: a genuinely green 53-test suite was reported
    as "only 2 tests" and the run aborted. The guard was right to abort; the parser was wrong.
    """
    for line in out.splitlines():
        clean = ANSI_RE.sub("", line)
        m = re.search(r"\bTests\s+(\d+)\s+passed", clean)
        if m:
            return int(m.group(1))
    return 0


def main() -> int:
    print("=" * 74)
    print("Slice L-1b — mutation check for the Leafly ORDER contract")
    print("=" * 74)

    code, out = run_tests()
    if code != 0:
        print("BASELINE IS RED — fix the tests before mutating.")
        print(out[-4000:])
        return 1

    count = baseline_test_count(out)
    if count < MIN_EXPECTED_TESTS:
        print(
            f"BASELINE reported only {count} tests (expected >= {MIN_EXPECTED_TESTS}) "
            "— the harness is lying about what ran."
        )
        print(out[-4000:])
        return 1
    print(f"[baseline] GREEN — {count} tests passed")

    originals: dict[str, str] = {}
    for _, path, _, _, _ in MUTATIONS:
        if path not in originals:
            with open(os.path.join(REPO, path), encoding="utf-8") as fh:
                originals[path] = fh.read()

    survived: list[tuple[str, str]] = []
    not_applied: list[tuple[str, str]] = []
    killed = 0

    try:
        for mid, path, old, new, why in MUTATIONS:
            src = originals[path]
            if old not in src:
                not_applied.append((mid, f"fragment not found in {path}"))
                print(f"\n[{mid}] SKIPPED — fragment not found in {path}")
                continue
            if src.count(old) > 1:
                not_applied.append((mid, f"fragment ambiguous in {path}"))
                print(f"\n[{mid}] SKIPPED — fragment appears {src.count(old)}x in {path}")
                continue

            mutated = src.replace(old, new, 1)
            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(mutated)

            code, _ = run_tests()
            if code != 0:
                killed += 1
                print(f"\n[{mid}] KILLED   (tests went red as required)")
                print(f"          why: {why}")
            else:
                survived.append((mid, why))
                print(f"\n[{mid}] SURVIVED (TESTS STILL PASS — THIS IS A HOLE)")
                print(f"          why it matters: {why}")

            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(src)
    finally:
        for path, src in originals.items():
            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(src)
        print("\n[restore] all target files restored from memory")

    # --- Confirm we really are back to green (guards a botched restore).
    code, out = run_tests()
    print(f"[verify] post-restore suite: {'GREEN' if code == 0 else 'RED'}")
    if code != 0:
        print("RESTORE FAILED — working tree is dirty. Check `git diff`.")
        return 1

    print("\n" + "=" * 74)
    print(
        f"mutations: {len(MUTATIONS)}   killed: {killed}   "
        f"survived: {len(survived)}   skipped: {len(not_applied)}"
    )
    print("=" * 74)

    for mid, why in survived:
        print(f"SURVIVED {mid}: {why}")
    for mid, why in not_applied:
        print(f"SKIPPED  {mid}: {why}")

    if survived or not_applied:
        print("\nRESULT: FAIL — every mutation must be applied and killed.")
        return 1
    print("\nRESULT: PASS — 0 survived. The tests can genuinely fail.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

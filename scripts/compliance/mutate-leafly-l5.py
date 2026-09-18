#!/usr/bin/env python3
"""SLICE L-5 mutation harness -- "test the tests".

L-5 is the first slice where Leafly can reach INTO this system. Everything
before it pushed data outward, where a defect shows up as a bad menu someone
can look at. These four cores are different: three of the four fail in total
silence by design.

  * `hmac-core.ts` -- decides whether an inbound webhook is genuinely from
    Leafly. Broken one way it rejects real orders (revenue quietly lost, and
    Leafly auto-cancels the customer's order after its retries). Broken the
    other way it accepts forged ones. Neither appears in any UI.

  * `webhook-parse-core.ts` -- reads the order out of the body. It FAILS SOFT
    on purpose, because the spec documents exactly one response for every
    webhook: 200. There is no contractual way to say "your payload was
    malformed". That is correct, and it is precisely why a parsing bug here is
    invisible in production: Leafly is told 200 either way. Direct assertions
    are the only place a regression can surface at all.

  * `order-map-core.ts` -- the status vocabulary in both directions. Leafly
    spells it `canceled` (one l); Greenway spells it `cancelled` (two). A
    one-character slip strands an order in a status nothing can read, and the
    order simply stops moving.

  * `preview-core.ts` -- the money a shopper reads on Leafly's site before
    deciding to buy. Wrong here is wrong in public, and the tax-model question
    (decision D-2) means the arithmetic has two defensible readings; the
    invariant that both yield the same out-the-door total is the only thing
    keeping the unresolved question safe. If THAT invariant stops being
    checked, the slice's central safety argument evaporates.

A green suite is not evidence any of this works. The question here is the
harder one: IF SOMEBODY BROKE ONE, WOULD THE SUITE NOTICE?

Every mutation below is a real, plausible regression. Several are the exact
defect the slice exists to prevent, deliberately reintroduced -- above all the
ones that turn a fail-closed decision into a fail-OPEN one, because that is the
edit a well-meaning engineer makes while "fixing" webhooks that are being
rejected in the sandbox.

HARNESS LESSONS 1-7, carried verbatim from L-2/L-3/L-4 because each was learned
by being burned:

1. NEVER pipe vitest into sed/grep to read its result -- the pipeline's exit
   code becomes the last command's, so every failure reports as a pass.
2. Do the replacement in Python with plain `.replace`, never `perl -e`.
3. VERIFY THE MUTATION ACTUALLY CHANGED THE FILE. A pattern that no longer
   matches mutates nothing, the suite passes, and the harness scores it CAUGHT
   -- inflating the score exactly when the harness has stopped working.
4. Verify the baseline is GREEN before mutating. Mutation results are
   meaningless on a red baseline.
5. Ambiguity is an ERROR, not a coin flip. If a pattern appears more than once
   the harness refuses rather than mutating an arbitrary occurrence.
6. Cap the child Node heap and run vitest single-threaded; an uncapped heap
   took the whole tmux server down mid-sweep on this box, and a truncated log
   looks a lot like a finished one. Flush every line.
7. VERIFY FLAG NAMES against the installed vitest's `--help` before using them.
   An unrecognised flag exits non-zero, which the harness reads as CAUGHT -- so
   it would report a perfect score while never running a single test. The
   baseline check is what catches this, which is exactly why it exists.
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

HMAC = Path("src/lib/leafly/hmac-core.ts")
MAP = Path("src/lib/leafly/order-map-core.ts")
PARSE = Path("src/lib/leafly/webhook-parse-core.ts")
PREVIEW = Path("src/lib/leafly/preview-core.ts")

# The vitest files that must notice. The L-5 compliance file plus the registry
# that enforces the per-core assertion floors, because many mutations below are
# designed to be caught by an embedded self-test assertion rather than by a
# vitest case.
TESTS = [
    "tests/compliance/leafly-order-webhooks.test.ts",
    "tests/compliance/leafly-order-contract.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

# The pure self-tests also run through the standalone entry point, which THROWS
# rather than reporting, and enforces the per-core assertion floors.
SELFTEST_ENTRY = "scripts/compliance/run-pure-selftests.ts"

# (file, name, from, to)
MUTATIONS = [
    # ==================================================================== HMAC
    # ---- fail-closed -> fail-OPEN. The most dangerous class in the slice. ----
    (HMAC, "FAIL-OPEN: a missing HMAC key means 'skip verification'",
     '  if (!hmacKey) {',
     '  if (false) {'),
    (HMAC, "FAIL-OPEN: a missing signature header is accepted",
     '  if (headerValue === null || headerValue === undefined) {',
     '  if (false) {'),
    (HMAC, "FAIL-OPEN: an empty signature header is accepted",
     '  if (presented === "") {',
     '  if (false) {'),
    (HMAC, "FAIL-OPEN: an unusable digester is treated as a successful verification",
     '  if (!sawUsableDigest) {',
     '  if (false) {'),
    (HMAC, "FAIL-OPEN: the final verdict flips to accept on mismatch",
     '  return {\n    ok: false,\n    matchedEncoding: null,\n    reason: "mismatch",',
     '  return {\n    ok: true,\n    matchedEncoding: null,\n    reason: "mismatch",'),
    (HMAC, "FAIL-OPEN: an empty request body is accepted",
     '  if (rawBody === "") {',
     '  if (false) {'),

    # ---- the comparison itself ----
    (HMAC, "the timing-safe compare becomes a plain ===, leaking where digests diverge",
     "export function timingSafeStringEqual(a: string, b: string): boolean {\n  const len = Math.max(a.length, b.length);",
     "export function timingSafeStringEqual(a: string, b: string): boolean {\n  if (a !== b) return false;\n  const len = Math.max(a.length, b.length);"),
    (HMAC, "the compare short-circuits on length, reintroducing the early return",
     "  let diff = a.length ^ b.length;",
     "  if (a.length !== b.length) return false;\n  let diff = 0;"),
    (HMAC, "length stops being folded in, so a truncated digest can match",
     "  let diff = a.length ^ b.length;",
     "  let diff = 0;"),
    (HMAC, "the compare always returns true",
     "  return diff === 0;",
     "  return true;"),
    (HMAC, "the XOR accumulator stops accumulating (only the last char matters)",
     "    diff |= ca ^ cb;",
     "    diff = ca ^ cb;"),
    (HMAC, "the loop stops early, so only the first character is compared",
     "  for (let i = 0; i < len; i += 1) {",
     "  for (let i = 0; i < 1; i += 1) {"),

    # ---- base64 case-sensitivity: a real, subtle correctness trap ----
    (HMAC, "base64 is compared case-INSENSITIVELY, accepting genuinely wrong digests",
     '      encoding === "hex"\n        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())\n        : timingSafeStringEqual(computed, presented);',
     '      timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());'),
    (HMAC, "hex becomes case-SENSITIVE, so an upper-case digest is rejected",
     '      encoding === "hex"\n        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())\n        : timingSafeStringEqual(computed, presented);',
     '      timingSafeStringEqual(computed, presented);'),

    # ---- algorithm / header identity ----
    (HMAC, "the algorithm silently changes from sha256 to sha1",
     'export const LEAFLY_HMAC_ALGORITHM = "sha256";',
     'export const LEAFLY_HMAC_ALGORITHM = "sha1";'),
    (HMAC, "the signature header name is misspelled (every webhook loses its header)",
     'export const LEAFLY_SIGNATURE_HEADER = "X-Leafly-Signature";',
     'export const LEAFLY_SIGNATURE_HEADER = "X-Leafly-Signatures";'),
    (HMAC, "the lower-case header constant drifts out of sync with the real one",
     'export const LEAFLY_SIGNATURE_HEADER_LOWER = "x-leafly-signature";',
     'export const LEAFLY_SIGNATURE_HEADER_LOWER = "X-Leafly-Signature";'),

    # ---- header lookup ----
    (HMAC, "header lookup becomes case-sensitive (HTTP headers are not)",
     "    if (name.toLowerCase() !== LEAFLY_SIGNATURE_HEADER_LOWER) continue;",
     "    if (name !== LEAFLY_SIGNATURE_HEADER_LOWER) continue;"),
    (HMAC, "a repeated header array yields the raw array instead of a string",
     "    if (Array.isArray(value)) return value.length > 0 ? value[0] : null;",
     "    if (Array.isArray(value)) return value as unknown as string;"),

    # ---- structural screen ----
    (HMAC, "the digest screen accepts anything (malformed no longer distinguishable)",
     "export function looksLikeSha256Digest(value: string): boolean {\n  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;",
     "export function looksLikeSha256Digest(value: string): boolean {\n  if (value.length > 0) return true;\n  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;"),
    (HMAC, "the hex length is wrong (63 chars), rejecting every real hex digest",
     "  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;",
     "  if (/^[0-9a-fA-F]{63}$/.test(value)) return true;"),
    (HMAC, "the prefix stripper eats base64 padding, destroying valid signatures",
     '  if (/^[a-z0-9-]{1,12}$/.test(label) && label !== "") {',
     "  if (true) {"),
    (HMAC, "the prefix stripper stops stripping (a prefixed digest never verifies)",
     "    return trimmed.slice(eq + 1).trim();",
     "    return trimmed;"),

    # ---- local-fault triage ----
    (HMAC, "a missing local key is reported to Leafly as THEIR bad signature",
     '  return reason === "missing_key" || reason === "digest_unavailable";',
     '  return reason === "digest_unavailable";'),
    (HMAC, "every failure is blamed on ourselves, so real forgeries look like outages",
     '  return reason === "missing_key" || reason === "digest_unavailable";',
     "  return true;"),

    # =========================================================== STATUS MAPPING
    (MAP, "THE SPELLING TRAP: Leafly's 'canceled' is respelled with two ls",
     'export const LEAFLY_CANCELED_SPELLING = "canceled";',
     'export const LEAFLY_CANCELED_SPELLING = "cancelled";'),
    (MAP, "Greenway's 'cancelled' is respelled with one l",
     'export const GREENWAY_CANCELLED_SPELLING = "cancelled";',
     'export const GREENWAY_CANCELLED_SPELLING = "canceled";'),
    (MAP, "a status is dropped from Leafly's enum",
     '  "pending",\n  "confirmed",',
     '  "confirmed",'),
    (MAP, "the ack window is widened past Leafly's 15 minutes",
     "export const LEAFLY_ACK_WINDOW_MINUTES = 15;",
     "export const LEAFLY_ACK_WINDOW_MINUTES = 30;"),
    (MAP, "the ack window is zeroed (everything reads as already expired)",
     "export const LEAFLY_ACK_WINDOW_MINUTES = 15;",
     "export const LEAFLY_ACK_WINDOW_MINUTES = 0;"),
    (MAP, "the urgency threshold is zeroed, so nothing is ever urgent",
     "export const LEAFLY_ACK_URGENT_SECONDS = 300;",
     "export const LEAFLY_ACK_URGENT_SECONDS = 0;"),
    (MAP, "a cancel reason is dropped from the enum",
     '  "order_api_unacknowledged",',
     ""),
    (MAP, "the 'we missed the ack' reason points at the wrong enum member",
     'export const LEAFLY_CANCEL_REASON_WE_MISSED_ACK = "order_api_unacknowledged";',
     'export const LEAFLY_CANCEL_REASON_WE_MISSED_ACK = "store_closed";'),
    (MAP, "receive-only statuses become settable (we would push a status Leafly owns)",
     'export const LEAFLY_RECEIVE_ONLY_STATUSES = ["pending", "expired"] as const;',
     "export const LEAFLY_RECEIVE_ONLY_STATUSES = [] as const;"),
    (MAP, "delivery-only statuses become settable for a pickup-only shop",
     "export const LEAFLY_DELIVERY_ONLY_STATUSES = [",
     "export const LEAFLY_DELIVERY_ONLY_STATUSES: never[] = [] as never[];\nconst _LEAFLY_DELIVERY_ONLY_STATUSES_UNUSED = ["),
    (MAP, "terminal statuses are no longer terminal (an order could leave picked_up)",
     'export const LEAFLY_TERMINAL_STATUSES = ["picked_up", "canceled"] as const;',
     "export const LEAFLY_TERMINAL_STATUSES = [] as const;"),
    (MAP, "an unknown inbound status is silently mapped instead of refused",
     "export function leaflyToGreenwayStatus(status: string): InboundStatusMapping {",
     'export function leaflyToGreenwayStatus(status: string): InboundStatusMapping {\n  if (!isLeaflyStatus(status)) return { known: true, leaflyStatus: "pending" } as unknown as InboundStatusMapping;'),
    (MAP, "forward-transition checking accepts any direction (orders could go backwards)",
     "export function isForwardLeaflyTransition(from: string, to: string): boolean {",
     "export function isForwardLeaflyTransition(from: string, to: string): boolean {\n  return true;\n  // eslint-disable-next-line no-unreachable"),

    # =========================================================== WEBHOOK PARSE
    (PARSE, "an unknown event type is accepted as valid",
     "export function isLeaflyWebhookEventType(v: unknown): v is LeaflyWebhookEventType {",
     "export function isLeaflyWebhookEventType(v: unknown): v is LeaflyWebhookEventType {\n  return typeof v === \"string\";\n  // eslint-disable-next-line no-unreachable"),
    (PARSE, "activation events are treated as carrying an order (id hunted for in vain)",
     'export const LEAFLY_EVENTS_WITHOUT_AN_ORDER = ["order_activate", "order_deactivate"] as const;',
     "export const LEAFLY_EVENTS_WITHOUT_AN_ORDER = [] as const;"),
    (PARSE, "order_submit stops being the event with an ack deadline",
     'export const LEAFLY_EVENTS_WITH_ACK_DEADLINE = ["order_submit"] as const;',
     "export const LEAFLY_EVENTS_WITH_ACK_DEADLINE = [] as const;"),
    (PARSE, "a required order field is dropped from the required list",
     "export const LEAFLY_ORDER_WEBHOOK_REQUIRED_FIELDS = [",
     "export const LEAFLY_ORDER_WEBHOOK_REQUIRED_FIELDS: never[] = [] as never[];\nconst _LEAFLY_ORDER_WEBHOOK_REQUIRED_FIELDS_UNUSED = ["),
    (PARSE, "the problem cap is zeroed, suppressing every reported problem",
     "export const LEAFLY_WEBHOOK_MAX_PROBLEMS = 12;",
     "export const LEAFLY_WEBHOOK_MAX_PROBLEMS = 0;"),
    (PARSE, "the event-type list loses an event",
     '  "order_submit",\n  "order_preview",',
     '  "order_preview",'),

    # ================================================================= PREVIEW
    # ---- the schema floors: minimum:1 on quantity and packagePrice ----
    (PREVIEW, "SCHEMA BREACH: a zero-priced line is emitted as packagePrice 0",
     "    if (publishedPrice < 1) {",
     "    if (false) {"),
    (PREVIEW, "the zero-price floor is checked on the SHELF price, not the published one",
     "    if (publishedPrice < 1) {",
     "    if (shelfInclusive < 1 && false) {"),
    (PREVIEW, "a zero tax component is emitted, breaching TaxComponent.minimum:1",
     "  if (input.exciseMinor > 0) {",
     "  if (input.exciseMinor >= 0) {"),
    (PREVIEW, "a zero SALES tax component is emitted",
     "  if (input.salesMinor > 0) {",
     "  if (input.salesMinor >= 0) {"),

    # ---- quantity: downward only ----
    (PREVIEW, "quantity is RAISED to stock on hand instead of clamped down",
     "    const quantity = Math.min(wanted, onHand);",
     "    const quantity = Math.max(wanted, onHand);"),
    (PREVIEW, "quantity ignores stock entirely (we would promise units we lack)",
     "    const quantity = Math.min(wanted, onHand);",
     "    const quantity = wanted;"),
    (PREVIEW, "an out-of-stock item is kept in the cart",
     "    if (onHand <= 0) {",
     "    if (false) {"),
    (PREVIEW, "a non-orderable item is offered for sale anyway",
     "    if (!facts.orderable) {",
     "    if (false) {"),
    (PREVIEW, "an unknown variant is silently passed through instead of removed",
     "    if (!facts) {",
     "    if (false && !facts) {"),
    (PREVIEW, "a blank variant id is accepted",
     '    if (id === "") {',
     "    if (false) {"),

    # ---- the tax model: decision D-2's safety argument ----
    (PREVIEW, "D-2 BREACH: the default presentation becomes the one that can OVERCHARGE",
     'export const LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION: LeaflyPreviewTaxPresentation =\n  "tax_inclusive_no_tax_lines";',
     'export const LEAFLY_PREVIEW_DEFAULT_TAX_PRESENTATION: LeaflyPreviewTaxPresentation =\n  "tax_exclusive_with_tax_lines";'),
    (PREVIEW, "the unresolved tax question is quietly marked as confirmed (rule 3 breach)",
     "export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = true;",
     "export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = false;"),
    (PREVIEW, "tax lines are emitted ALONGSIDE inclusive prices -- the overcharge itself",
     '  const taxes =\n    presentation === "tax_exclusive_with_tax_lines"\n      ? buildTaxComponents({ exciseMinor, salesMinor })\n      : [];',
     "  const taxes = buildTaxComponents({ exciseMinor, salesMinor });"),
    (PREVIEW, "the published price ignores the presentation (inclusive prices sent as pre-tax)",
     '    const publishedPrice =\n      presentation === "tax_exclusive_with_tax_lines"\n        ? preTaxFromInclusive(shelfInclusive, facts.category)\n        : shelfInclusive;',
     "    const publishedPrice = shelfInclusive;"),
    (PREVIEW, "the out-the-door total is computed from the PUBLISHED price, so it drifts",
     "    const inclusiveLine = Math.max(0, Math.trunc(facts.priceMinorUnits)) * line.quantity;",
     "    const inclusiveLine = line.packagePrice * line.quantity;"),

    # ---- tax arithmetic ----
    (PREVIEW, "sales tax is computed independently, so the split stops reconciling",
     "  const salesMinor = totalTax - exciseMinor;",
     "  const salesMinor = Math.round((preTaxMinor * 1093) / 10000);"),
    (PREVIEW, "cannabis excise is applied to merch as well",
     "  if (isNonCannabisCategory(category)) {\n    // No excise on merch/accessories. All of the tax is sales tax.\n    return { preTaxMinor, exciseMinor: 0, salesMinor: totalTax };\n  }",
     ""),
    (PREVIEW, "the excise rate is halved",
     "  const exciseMinor = Math.round((preTaxMinor * CANNABIS_EXCISE_TAX_BPS) / 10000);",
     "  const exciseMinor = Math.round((preTaxMinor * CANNABIS_EXCISE_TAX_BPS) / 20000);"),
    (PREVIEW, "the cannabis divisor is used for merch too",
     "  const divisor = isNonCannabisCategory(category)\n    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR\n    : TAX_INCLUSIVE_DIVISOR;",
     "  const divisor = TAX_INCLUSIVE_DIVISOR;"),

    # ---- tax labels: what the shopper actually reads ----
    (PREVIEW, "the excise label is blanked (TaxComponent.label must be a real string)",
     'export const LEAFLY_TAX_LABEL_EXCISE = "WA Cannabis Excise Tax";',
     'export const LEAFLY_TAX_LABEL_EXCISE = "";'),
    (PREVIEW, "the two tax labels become identical, so the breakdown is meaningless",
     'export const LEAFLY_TAX_LABEL_SALES = "WA State & Local Sales Tax";',
     'export const LEAFLY_TAX_LABEL_SALES = "WA Cannabis Excise Tax";'),

    # ---- body shape ----
    (PREVIEW, "the required `taxes` key is omitted when empty (schema breach)",
     "      taxes,\n    },",
     "      ...(taxes.length > 0 ? { taxes } : {}),\n    } as LeaflyPreviewResponseBody,"),
    (PREVIEW, "removed lines are emitted in the body as zero-quantity items",
     "      cartItems: kept.map((l) => ({",
     "      cartItems: [...kept, ...removed].map((l) => ({"),
    (PREVIEW, "an extra field is added to the cart item, beyond the declared schema",
     "        integratorVariantId: l.integratorVariantId,\n        quantity: l.quantity,\n        packagePrice: l.packagePrice,\n      })),",
     "        integratorVariantId: l.integratorVariantId,\n        quantity: l.quantity,\n        packagePrice: l.packagePrice,\n        note: l.note,\n      })) as unknown as LeaflyPreviewResponseBody[\"cartItems\"],"),
]

CHILD_ENV = {
    "NODE_OPTIONS": "--max-old-space-size=1536",
}


def run(cmd: list[str]) -> int:
    """Run a command, capturing output. Returns the REAL exit code.

    Never piped -- see harness lesson 1.
    """
    env = {**os.environ, **CHILD_ENV}
    return subprocess.run(
        cmd,
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    ).returncode


def suite_fails() -> bool:
    """True when EITHER the vitest files OR the pure self-tests go red.

    `--no-file-parallelism --maxWorkers=1` keeps this to a single worker, and
    both flag names were CHECKED against this installed vitest's `--help`
    before use (harness lesson 7).
    """
    if run(
        [
            "npx",
            "vitest",
            "run",
            "--no-file-parallelism",
            "--maxWorkers=1",
            *TESTS,
        ]
    ) != 0:
        return True
    if run(["npx", "tsx", SELFTEST_ENTRY]) != 0:
        return True
    return False


def main() -> int:
    files = sorted({m[0] for m in MUTATIONS})
    originals = {f: (REPO / f).read_text() for f in files}

    print("=== SLICE L-5 mutation testing ===")
    print(f"    {len(MUTATIONS)} mutations across {len(files)} files\n", flush=True)

    print("--- baseline (must be GREEN before any mutation) ---", flush=True)
    if suite_fails():
        print("  BASELINE IS RED -- aborting. Fix the suite before mutating it.")
        for f in files:
            (REPO / f).write_text(originals[f])
        return 1
    print("  baseline GREEN\n", flush=True)

    caught = 0
    missed: list[str] = []
    harness_errors: list[str] = []

    try:
        for i, (path, name, frm, to) in enumerate(MUTATIONS, start=1):
            # Restore every file so mutations never stack.
            for f in files:
                (REPO / f).write_text(originals[f])

            src = originals[path]
            if frm not in src:
                print(f"  M{i:02d} HARNESS ERROR -- pattern not found: {name}", flush=True)
                harness_errors.append(name)
                continue
            if src.count(frm) > 1:
                print(
                    f"  M{i:02d} HARNESS ERROR -- pattern is ambiguous "
                    f"({src.count(frm)}x): {name}",
                    flush=True,
                )
                harness_errors.append(name)
                continue

            mutated = src.replace(frm, to, 1)
            if mutated == src:
                print(f"  M{i:02d} HARNESS ERROR -- mutation was a no-op: {name}", flush=True)
                harness_errors.append(name)
                continue

            (REPO / path).write_text(mutated)

            if suite_fails():
                caught += 1
                print(f"  M{i:02d} CAUGHT   [{path.name}] {name}", flush=True)
            else:
                print(f"  M{i:02d} *** SURVIVED *** [{path.name}] {name}", flush=True)
                missed.append(f"[{path.name}] {name}")
    finally:
        for f in files:
            (REPO / f).write_text(originals[f])
        for f in files:
            assert (REPO / f).read_text() == originals[f], f"RESTORE FAILED for {f}"
        print("\n  all sources restored byte-identical", flush=True)

    total = len(MUTATIONS)
    print(
        f"\n=== L-5: {caught}/{total} caught, {len(missed)} survived, "
        f"{len(harness_errors)} harness error(s) ==="
    )
    for m in missed:
        print(f"    SURVIVED: {m}")
    for h in harness_errors:
        print(f"    HARNESS ERROR: {h}")

    return 0 if (caught == total and not harness_errors) else 1


if __name__ == "__main__":
    sys.exit(main())

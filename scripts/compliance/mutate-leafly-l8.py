#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l8.py   (SLICE L-8)

MUTATION TESTING -- "test the tests".

A passing suite proves nothing about whether it would NOTICE a defect. This
script deliberately breaks `evidence-core.ts` one edit at a time and demands
that the self-tests CATCH each break. A mutation that survives is a hole in the
assertions, not a curiosity.

USAGE
    python3 scripts/compliance/mutate-leafly-l8.py --dry-run   # verify patterns
    python3 scripts/compliance/mutate-leafly-l8.py             # the real sweep

WHY --dry-run EXISTS (lesson learned in L-7)
    In L-7, nine mutation patterns were silently wrong -- some matched 2-3 times
    (so `replace` hit the wrong site), some matched zero times (so the mutation
    was a no-op that "survived" and was misrecorded as a missing test). That was
    discovered eight minutes into an expensive sweep. The dry run checks every
    pattern matches EXACTLY ONCE and actually changes the file, in seconds.

SAFETY
    The original file is read once into memory, every mutation is applied to a
    fresh copy of that string, and the original is rewritten and md5-verified at
    the end -- including on Ctrl-C or an exception.
"""

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile

CORE = "src/lib/leafly/evidence-core.ts"

# Each mutation: (id, description, from_text, to_text)
#
# Every one is a plausible edit: an inverted comparison, an off-by-one boundary,
# a swapped precedence, a weakened guard. Nothing here is a syntax error -- a
# mutation that does not compile proves only that tsc works.
MUTATIONS = [
    # ---- privacy guard: the highest-stakes logic in the file ----------------
    ("M01", "isForbiddenEvidenceKey always returns false (the guard disabled)",
     "  const n = normalizeEvidenceKey(key);\n  return EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));",
     "  const n = normalizeEvidenceKey(key);\n  return false && EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));"),
    ("M02", "isForbiddenEvidenceKey always returns true (over-blocks everything)",
     "  return EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));",
     "  return true || EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad));"),
    ("M03", "substring match weakened to exact equality (misses customer_phone_number)",
     "EVIDENCE_FORBIDDEN_KEYS.some((bad) => n.includes(bad))",
     "EVIDENCE_FORBIDDEN_KEYS.some((bad) => n === bad)"),
    ("M04", "normalizeEvidenceKey stops lowercasing",
     'return key.toLowerCase().replace(/[_\\-\\s]/g, "");',
     'return key.replace(/[_\\-\\s]/g, "");'),
    ("M05", "normalizeEvidenceKey stops stripping separators",
     'return key.toLowerCase().replace(/[_\\-\\s]/g, "");',
     "return key.toLowerCase();"),
    ("M06", "phoneNumber removed from the forbidden list",
     '  "phonenumber",\n  "phone",',
     '  "phone",'),
    ("M07", "raw_order removed from the forbidden list",
     '  "raworder",\n  "customername",',
     '  "customername",'),
    ("M08", "medicalCardNumber removed from the forbidden list",
     '  "medicalcardnumber",\n  "medicalcardstate",',
     '  "medicalcardstate",'),
    ("M09", "auditEvidenceKeys inverted (returns the SAFE keys)",
     "  return keys.filter((k) => isForbiddenEvidenceKey(k));",
     "  return keys.filter((k) => !isForbiddenEvidenceKey(k));"),
    ("M10", "auditEvidenceKeys always clean",
     "  return keys.filter((k) => isForbiddenEvidenceKey(k));",
     "  return [];"),
    ("M11", "bundle privacy audit never records a violation",
     "      violations.push(`${sheet.name}.${bad}`);",
     "      void bad;"),
    ("M12", "raw body exported instead of only the hash",
     '      { key: "bodySha256", header: "Body SHA-256" },',
     '      { key: "rawOrder", header: "Body" },'),

    # ---- delivery classification -------------------------------------------
    ("M13", "verified check inverted",
     "  if (row.signatureVerified) {\n    return row.processedAt ? \"accepted\" : \"accepted_unprocessed\";",
     "  if (!row.signatureVerified) {\n    return row.processedAt ? \"accepted\" : \"accepted_unprocessed\";"),
    ("M14", "processed/unprocessed split collapsed",
     '    return row.processedAt ? "accepted" : "accepted_unprocessed";',
     '    return "accepted";'),
    ("M15", "unprocessed reported as fully accepted's opposite",
     '    return row.processedAt ? "accepted" : "accepted_unprocessed";',
     '    return row.processedAt ? "accepted_unprocessed" : "accepted";'),
    ("M16", "our-fault / their-fault split inverted",
     '  return isLeaflyHmacLocalFault(reason as LeaflyHmacFailureReason)\n    ? "rejected_ours"\n    : "rejected_theirs";',
     '  return isLeaflyHmacLocalFault(reason as LeaflyHmacFailureReason)\n    ? "rejected_theirs"\n    : "rejected_ours";'),
    ("M17", "every rejection blamed on Leafly (our-fault bucket removed)",
     '  return isLeaflyHmacLocalFault(reason as LeaflyHmacFailureReason)\n    ? "rejected_ours"\n    : "rejected_theirs";',
     '  return "rejected_theirs";'),
    ("M18", "unrecognised-reason guard removed (unknown reasons silently bucketed)",
     '  if (!isRecognisedRejectionReason(reason)) return "rejected_unknown";',
     "  if (false) return \"rejected_unknown\";"),
    ("M19", "isRecognisedRejectionReason accepts anything non-empty",
     "  return (LEAFLY_HMAC_FAILURE_REASONS as readonly string[]).includes(value);",
     '  return value !== "";'),
    ("M20", "isRecognisedRejectionReason accepts the empty string too",
     "  return (LEAFLY_HMAC_FAILURE_REASONS as readonly string[]).includes(value);",
     "  return true;"),

    # ---- tones -------------------------------------------------------------
    ("M21", "our-fault rejection downgraded from bad to a warning",
     '    case "rejected_ours":\n      return "bad";',
     '    case "rejected_ours":\n      return "warn";'),
    ("M22", "accepted downgraded from good",
     '    case "accepted":\n      return "good";',
     '    case "accepted":\n      return "warn";'),
    ("M23", "unprocessed silently treated as good",
     '    case "accepted_unprocessed":\n      return "warn";',
     '    case "accepted_unprocessed":\n      return "good";'),

    # ---- anomalies ---------------------------------------------------------
    ("M24", "unknown event type no longer flagged",
     "  } else if (!isLeaflyWebhookEventType(rawType)) {",
     "  } else if (false && !isLeaflyWebhookEventType(rawType)) {"),
    ("M25", "missing event type no longer flagged",
     '  if (rawType === "") {\n    out.push({\n      code: "missing_event_type",',
     '  if (false) {\n    out.push({\n      code: "missing_event_type",'),
    ("M26", "whitespace event type no longer counts as missing (trim removed)",
     '  const rawType = (row.eventType ?? "").trim();',
     '  const rawType = row.eventType ?? "";'),
    ("M27", "order-id requirement applied to EVERY event (false alarm on activate)",
     '  if (rawType !== "" && isLeaflyWebhookEventType(rawType) && leaflyEventCarriesAnOrder(rawType)) {',
     '  if (rawType !== "") {'),
    ("M28", "order-id requirement inverted (only order-less events checked)",
     "&& leaflyEventCarriesAnOrder(rawType)) {",
     "&& !leaflyEventCarriesAnOrder(rawType)) {"),
    ("M29", "missing order id never flagged",
     '    if ((row.orderId ?? "").trim() === "") {',
     '    if (false) {'),
    ("M30", "blank order id no longer counts as missing (trim removed)",
     '    if ((row.orderId ?? "").trim() === "") {',
     '    if ((row.orderId ?? "") === "") {'),

    # ---- clock skew: arithmetically verified boundaries --------------------
    # The gate is `Math.abs(skew) > skewLimit` with skewLimit 60.
    # Fixtures assert: 60 -> NOT flagged, 61 -> flagged, -120 -> flagged.
    ("M31", "skew gate becomes >= (60 minutes now wrongly trips)",
     "  if (skew !== null && Math.abs(skew) > skewLimit) {",
     "  if (skew !== null && Math.abs(skew) >= skewLimit) {"),
    ("M32", "skew loses its absolute value (negative skew never caught)",
     "  if (skew !== null && Math.abs(skew) > skewLimit) {",
     "  if (skew !== null && skew > skewLimit) {"),
    ("M33", "skew threshold widened to 1440 (61 minutes no longer trips)",
     "export const EVIDENCE_CLOCK_SKEW_MINUTES = 60;",
     "export const EVIDENCE_CLOCK_SKEW_MINUTES = 1440;"),
    ("M34", "skew threshold narrowed to 0 (a clean 0-minute row now trips)",
     "export const EVIDENCE_CLOCK_SKEW_MINUTES = 60;",
     "export const EVIDENCE_CLOCK_SKEW_MINUTES = -1;"),
    ("M35", "skew sign reversed",
     "  return Math.round((got - claimed) / 60000);",
     "  return Math.round((claimed - got) / 60000);"),
    ("M36", "skew computed in seconds, not minutes",
     "  return Math.round((got - claimed) / 60000);",
     "  return Math.round((got - claimed) / 1000);"),
    ("M37", "unparseable timestamps yield 0 instead of null (invents a value)",
     "  if (!Number.isFinite(claimed) || !Number.isFinite(got)) return null;",
     "  if (!Number.isFinite(claimed) || !Number.isFinite(got)) return 0;"),

    # ---- response status ---------------------------------------------------
    ("M38", "401 on an UNVERIFIED delivery wrongly flagged (the load-bearing asymmetry)",
     "    row.signatureVerified &&\n    !LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(row.responseStatus)",
     "    !LEAFLY_EXPECTED_WEBHOOK_STATUSES.includes(row.responseStatus)"),
    ("M39", "bad response status never flagged",
     "  } else if (\n    row.signatureVerified &&",
     "  } else if (\n    false &&"),
    ("M40", "missing response status never flagged",
     "  if (row.responseStatus === null) {",
     "  if (false) {"),
    ("M41", "204 wrongly accepted as a webhook response",
     "export const LEAFLY_EXPECTED_WEBHOOK_STATUSES: readonly number[] = [200, 201] as const;",
     "export const LEAFLY_EXPECTED_WEBHOOK_STATUSES: readonly number[] = [200, 201, 204] as const;"),
    ("M42", "201 dropped from the approved statuses",
     "export const LEAFLY_EXPECTED_WEBHOOK_STATUSES: readonly number[] = [200, 201] as const;",
     "export const LEAFLY_EXPECTED_WEBHOOK_STATUSES: readonly number[] = [200] as const;"),

    # ---- summary -----------------------------------------------------------
    ("M43", "verified counter never increments",
     "    if (row.signatureVerified) verified += 1;",
     "    if (false) verified += 1;"),
    ("M44", "unverified computed as the same as verified",
     "    unverified: rows.length - verified,",
     "    unverified: verified,"),
    ("M45", "distinct orders counts duplicates (Set replaced by a counter)",
     '    if (oid !== "") orders.add(oid);',
     '    if (oid !== "") orders.add(oid + String(Math.random()));'),
    ("M46", "blank order ids counted as distinct orders",
     '    if (oid !== "") orders.add(oid);',
     "    orders.add(oid);"),
    ("M47", "earliest/latest received swapped",
     "      if (first === null || t < Date.parse(first)) first = row.receivedAt;\n      if (last === null || t > Date.parse(last)) last = row.receivedAt;",
     "      if (first === null || t > Date.parse(first)) first = row.receivedAt;\n      if (last === null || t < Date.parse(last)) last = row.receivedAt;"),
    ("M48", "null event type no longer bucketed as (none)",
     '    const key = (row.eventType ?? "").trim() === "" ? "(none)" : (row.eventType as string).trim();',
     '    const key = (row.eventType as string) ?? "x";'),
    ("M49", "anomalies never tallied into the summary",
     "    for (const a of findEvidenceAnomalies(row)) anomalyCounts[a.code] += 1;",
     "    for (const a of findEvidenceAnomalies(row)) void a;"),

    # ---- verdict: precedence is the crown jewel ---------------------------
    ("M50", "PRECEDENCE SWAP: all_rejected tested before misconfigured",
     "  if (summary.counts.rejected_ours > 0) {",
     "  if (summary.counts.rejected_ours > 0 && summary.verified > 0) {"),
    ("M51", "misconfigured branch removed entirely",
     "  if (summary.counts.rejected_ours > 0) {",
     "  if (false) {"),
    ("M52", "silent branch removed (empty log now reports healthy)",
     "  if (summary.total === 0) {",
     "  if (false) {"),
    ("M53", "some_rejected branch removed (partial failure rounded up to healthy)",
     "  if (summary.unverified > 0) {",
     "  if (false) {"),
    ("M54", "all_rejected branch removed",
     "  if (summary.verified === 0) {",
     "  if (false) {"),
    ("M55", "all_rejected fires whenever anything failed",
     "  if (summary.verified === 0) {",
     "  if (summary.unverified > 0) {"),
    ("M56", "silent verdict given a 'bad' tone (empty sandbox looks broken)",
     '      code: "silent",\n      tone: "info",',
     '      code: "silent",\n      tone: "bad",'),
    ("M57", "misconfigured next step stops naming the HMAC key",
     '        "Open Integrations → Leafly and paste the HMAC key Leafly issued alongside your client " +\n        "credentials. No redeploy is needed; the next delivery will verify.",',
     '        "Contact support.",'),
    ("M58", "all_rejected next step drops the hex/base64 question",
     '        "Re-copy the HMAC key from Leafly and save it again, watching for a truncated paste or a " +\n        "trailing space. If it still fails on every delivery, ask Leafly to confirm the key and " +\n        "whether the signature is hex or base64 encoded.",',
     '        "Re-copy the HMAC key from Leafly and save it again.",'),
    ("M59", "healthy verdict handed a next step it should not have",
     "    nextStep: null,\n  };\n}",
     '    nextStep: "Do something.",\n  };\n}'),

    # ---- acknowledgement evidence -----------------------------------------
    ("M60", "late test becomes >= (an on-deadline ack wrongly called late)",
     "      if (Number.isFinite(deadline) && ackedAt > deadline) lateAcknowledged += 1;",
     "      if (Number.isFinite(deadline) && ackedAt >= deadline) lateAcknowledged += 1;"),
    ("M61", "lateness inverted (early acks called late)",
     "      if (Number.isFinite(deadline) && ackedAt > deadline) lateAcknowledged += 1;",
     "      if (Number.isFinite(deadline) && ackedAt < deadline) lateAcknowledged += 1;"),
    ("M62", "lateness never detected",
     "      if (Number.isFinite(deadline) && ackedAt > deadline) lateAcknowledged += 1;",
     "      if (false) lateAcknowledged += 1;"),
    ("M63", "lateness asserted even without a readable deadline (invents a fact)",
     "      if (Number.isFinite(deadline) && ackedAt > deadline) lateAcknowledged += 1;",
     "      if (ackedAt > deadline || !Number.isFinite(deadline)) lateAcknowledged += 1;"),
    ("M64", "missed/pending inverted",
     "    if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) missed += 1;\n    else pending += 1;",
     "    if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) pending += 1;\n    else missed += 1;"),
    ("M65", "an unreadable deadline now counted as MISSED (house rule 3 violation)",
     "    if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) missed += 1;\n    else pending += 1;",
     "    if (!Number.isFinite(deadline) || now > deadline) missed += 1;\n    else pending += 1;"),
    ("M66", "fastest/slowest swapped",
     "        if (slowest === null || mins > slowest) slowest = mins;\n        if (fastest === null || mins < fastest) fastest = mins;",
     "        if (slowest === null || mins < slowest) slowest = mins;\n        if (fastest === null || mins > fastest) fastest = mins;"),
    ("M67", "ack latency measured in seconds",
     "        const mins = Math.round((ackedAt - seen) / 60000);",
     "        const mins = Math.round((ackedAt - seen) / 1000);"),
    ("M68", "acknowledged counter never increments",
     "      acknowledged += 1;",
     "      acknowledged += 0;"),
    ("M69", "Leafly's 15-minute window replaced with a local guess",
     "    windowMinutes: LEAFLY_ACK_WINDOW_MINUTES,",
     "    windowMinutes: 30,"),

    # ---- criteria ----------------------------------------------------------
    ("M70", "reachability claims a pass with an empty log",
     '    status: summary.total === 0 ? "unknown" : "pass",',
     '    status: "pass",'),
    ("M71", "signature criterion passes even with failures",
     "      summary.total === 0\n        ? \"unknown\"\n        : summary.unverified === 0\n          ? \"pass\"\n          : \"fail\",",
     '      summary.total === 0 ? "unknown" : "pass",'),
    ("M72", "ack criterion passes while orders are still pending",
     '          : ack.pending > 0\n            ? "unknown"\n            : "pass",',
     '          : "pass",'),
    ("M73", "a LATE ack no longer fails the window criterion",
     "        : ack.missed > 0 || ack.lateAcknowledged > 0\n          ? \"fail\"",
     "        : ack.missed > 0\n          ? \"fail\"",),
    ("M74", "a MISSED ack no longer fails the window criterion",
     "        : ack.missed > 0 || ack.lateAcknowledged > 0\n          ? \"fail\"",
     "        : ack.lateAcknowledged > 0\n          ? \"fail\"",),
    ("M75", "missing response status no longer fails the response criterion",
     "        : summary.anomalyCounts.bad_response_status === 0 &&\n            summary.anomalyCounts.no_response_status === 0\n          ? \"pass\"\n          : \"fail\",",
     '        : summary.anomalyCounts.bad_response_status === 0 ? "pass" : "fail",'),
    ("M76", "idempotency claims a measured pass instead of an attestation",
     '    status: "attest",',
     '    status: "pass",'),
    ("M77", "idempotency detail stops citing the real constraint",
     '      "Enforced structurally, not by review: leafly_webhook_events.body_sha256 is UNIQUE, so a " +',
     '      "Handled. " +'),
    ("M78", "a criterion is dropped (only four reported)",
     "  out.push({\n    id: \"idempotency\",",
     "  if (false) out.push({\n    id: \"idempotency\","),

    # ---- bundle ------------------------------------------------------------
    ("M79", "a sheet is dropped from the bundle",
     "  const sheets = [summarySheet, criteriaSheet, deliveriesSheet, ordersSheet];",
     "  const sheets = [summarySheet, criteriaSheet, deliveriesSheet];"),
    ("M80", "ack outcome late/on_time inverted in the export",
     '        outcome = Number.isFinite(deadline) && acked > deadline ? "late" : "on_time";',
     '        outcome = Number.isFinite(deadline) && acked > deadline ? "on_time" : "late";'),
    ("M81", "missed/pending inverted in the export",
     '      } else if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) {\n        outcome = "missed";\n      } else {\n        outcome = "pending";',
     '      } else if (Number.isFinite(deadline) && Number.isFinite(now) && now > deadline) {\n        outcome = "pending";\n      } else {\n        outcome = "missed";'),
    ("M82", "unacknowledged order reports 0 minutes instead of null (invents a value)",
     "        ackMinutes:\n          Number.isFinite(acked) && Number.isFinite(seen)\n            ? Math.round((acked - seen) / 60000)\n            : null,",
     "        ackMinutes:\n          Number.isFinite(acked) && Number.isFinite(seen)\n            ? Math.round((acked - seen) / 60000)\n            : 0,"),
    ("M83", "filename loses its colon-stripping (breaks on Windows/S3)",
     '    ? new Date(t).toISOString().slice(0, 19).replace(/[:T]/g, "-")',
     "    ? new Date(t).toISOString().slice(0, 19)"),
    ("M84", "unparseable clock silently yields a blank stem",
     '    : "unknown-time";',
     '    : "";'),
    ("M85", "delivery rows no longer carry their disposition",
     "      disposition: classifyEvidenceDelivery(e),",
     '      disposition: "",'),
    ("M86", "anomaly rows dropped from the summary sheet",
     "  for (const code of ALL_EVIDENCE_ANOMALY_CODES) {\n    summarySheet.rows.push({",
     "  for (const code of []) {\n    summarySheet.rows.push({"),
    ("M87", "the generated-at stamp is dropped from the summary sheet",
     '      { item: "Generated at (UTC)", value: input.nowIso },',
     '      { item: "Generated at (UTC)", value: "" },'),
]


def md5(path):
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def run_tests(repo):
    """Run the core's self-tests. Returns True if they PASS (mutation survived)."""
    runner = os.path.join(repo, "mutate-run-l8.tmp.ts")
    with open(runner, "w") as fh:
        fh.write(
            'import { __runLeaflyEvidenceTests } from "./src/lib/leafly/evidence-core";\n'
            "const r = __runLeaflyEvidenceTests();\n"
            "if (r.failed > 0) process.exit(1);\n"
            "process.exit(0);\n"
        )
    try:
        proc = subprocess.run(
            ["npx", "tsx", "mutate-run-l8.tmp.ts"],
            cwd=repo, capture_output=True, text=True, timeout=180,
        )
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        # A timeout is not a survival -- an infinite loop is itself a caught defect.
        return False
    finally:
        if os.path.exists(runner):
            os.remove(runner)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="verify every pattern matches exactly once; run no tests")
    args = ap.parse_args()

    repo = os.getcwd()
    target = os.path.join(repo, CORE)
    if not os.path.exists(target):
        print(f"FATAL: {CORE} not found. Run from the repo root.")
        return 2

    with open(target, "r") as fh:
        original = fh.read()
    original_md5 = md5(target)

    # ---- DRY RUN: the L-7 lesson ------------------------------------------
    ids = [m[0] for m in MUTATIONS]
    if len(ids) != len(set(ids)):
        print("FATAL: duplicate mutation ids")
        return 2

    errors = []
    for mid, desc, frm, to in MUTATIONS:
        n = original.count(frm)
        if n != 1:
            errors.append(f"{mid}: pattern matches {n} times (must be exactly 1) -- {desc}")
            continue
        if original.replace(frm, to) == original:
            errors.append(f"{mid}: replacement is a no-op -- {desc}")

    if errors:
        print(f"DRY RUN FAILED -- {len(errors)} bad pattern(s):\n")
        for e in errors:
            print("  " + e)
        print("\nFix these before sweeping; a no-op mutation 'survives' and would be")
        print("misrecorded as a missing test when the fault is in this harness.")
        return 1

    print(f"DRY RUN PASSED: all {len(MUTATIONS)} patterns match exactly once and change the file.")
    if args.dry_run:
        return 0

    # ---- Baseline: the suite must PASS unmutated -------------------------
    print("\nBaseline (unmutated) ...", end=" ", flush=True)
    if not run_tests(repo):
        print("FAIL")
        print("FATAL: the self-tests do not pass on the untouched file. Fix that first --")
        print("every mutation would be 'caught' for the wrong reason.")
        return 2
    print("pass")

    caught, survived = [], []
    try:
        for i, (mid, desc, frm, to) in enumerate(MUTATIONS, 1):
            with open(target, "w") as fh:
                fh.write(original.replace(frm, to))
            passed = run_tests(repo)
            if passed:
                survived.append((mid, desc))
                mark = "SURVIVED  <-- GAP IN THE TESTS"
            else:
                caught.append((mid, desc))
                mark = "caught"
            print(f"[{i:>2}/{len(MUTATIONS)}] {mid} {mark}: {desc}")
    finally:
        # ALWAYS restore, byte-identical, even on Ctrl-C or an exception.
        with open(target, "w") as fh:
            fh.write(original)
        restored = md5(target)
        print(f"\nRestored {CORE}: md5 {restored} "
              f"({'IDENTICAL' if restored == original_md5 else 'MISMATCH -- INVESTIGATE'})")
        if restored != original_md5:
            print("FATAL: the file was not restored byte-identically.")
            return 2

    print(f"\n{'='*70}")
    print(f"MUTATION RESULT: {len(caught)} caught, {len(survived)} survived, "
          f"{len(MUTATIONS)} total")
    print(f"{'='*70}")
    if survived:
        print("\nSURVIVORS -- each is a real hole in the assertions:")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        return 1
    print("\nEvery mutation was caught. The tests can fail, and they fail for the right reasons.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

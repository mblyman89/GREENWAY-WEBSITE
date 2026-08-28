#!/usr/bin/env python3
"""
books-83 mutation probe.

A passing test proves nothing until it has been shown to fail. Each mutation
below introduces ONE deliberate defect that a careless future edit could
plausibly make, and the harness records whether the suite caught it.

Usage: python3 scripts/compliance/mutate-slice-books-83.py
(Applies, reports, and ALWAYS restores. Verifies zero markers at the end.)
"""
import subprocess, shutil, sys, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST = "tests/compliance/vendor-bill-wiring.test.ts"

SVC = "src/lib/accounting/vendor-bill-service.ts"
EVID = "src/lib/accounting/receipt-evidence.ts"
ACTION = "src/app/admin/inventory/intake/actions.ts"
PAGE = "src/app/admin/inventory/intake/[id]/page.tsx"

MUTATIONS = [
    # M1: the defect this whole slice exists to prevent — treat an unreadable
    # ledger as "no receipt". Silently re-arms D-61 on every transient error.
    (SVC,
     'if (evidence.kind === "unknown") {',
     'if (false) {',
     "unknown evidence falls through to false (D-61 back door)"),

    # M2: derive the flag from the manifest instead of the ledger (books-79 N4).
    (SVC,
     'const goodsAlreadyReceived = evidence.kind === "raised";',
     'const goodsAlreadyReceived = true;',
     "flag hard-coded true instead of derived"),

    # M3: D-66 — require 'posted', which is what the obvious reading says and
    # which would answer "no receipt" for every real (draft) delivery.
    (EVID,
     'export const RECEIPT_EVIDENCE_STATUSES = ["draft", "posted"] as const;',
     'export const RECEIPT_EVIDENCE_STATUSES = ["posted"] as const;',
     "evidence requires 'posted', ignoring the drafts every receipt actually is"),

    # M4: bill a lot that was refused at the dock — invents a liability.
    (SVC,
     'export const BILL_EXCLUDED_LOT_STATUSES = new Set(["rejected"]);',
     'export const BILL_EXCLUDED_LOT_STATUSES = new Set<string>([]);',
     "rejected lots are billed anyway"),

    # M5: unwire the call entirely (leaving the import) — books-82's finding.
    (ACTION,
     "const billed = await postManifestVendorBill(manifestId, invoiceDate);",
     "const billed = { ok: true, code: 'BILL_OK', message: '' } as Awaited<ReturnType<typeof postManifestVendorBill>>;",
     "the call is removed but the import binding remains"),

    # M6: bill every finalize, including a wholly rejected manifest.
    (ACTION,
     "if (result.activated > 0) {",
     "if (true) {",
     "a fully rejected manifest is billed"),

    # M7: guess a category rather than refusing (D-64).
    (SVC,
     'if (mapping.kind === "refused") {',
     'if (false) {',
     "an unrecognised category is no longer refused"),

    # M8: stop rendering the refusal — a banner nobody draws.
    (PAGE,
     "{booksError && (",
     "{false && (",
     "the refusal banner is never rendered"),
]


def run_suite():
    p = subprocess.run(
        ["npx", "vitest", "run", TEST],
        cwd=ROOT, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(.*)", out)
    return m.group(1).strip() if m else "NO RESULT PARSED"


def main():
    caught = 0
    for path, old, new, label in MUTATIONS:
        full = os.path.join(ROOT, path)
        backup = "/tmp/books83-backup"
        shutil.copy(full, backup)
        s = open(full).read()
        if s.count(old) != 1:
            print(f"SKIP (anchor count {s.count(old)}): {label}")
            continue
        open(full, "w").write(s.replace(old, new))
        result = run_suite()
        shutil.copy(backup, full)
        failed = "failed" in result
        caught += 1 if failed else 0
        print(f"[{'CAUGHT' if failed else 'SURVIVED'}] {label}\n           -> {result}")

    print(f"\n{caught}/{len(MUTATIONS)} caught")

    # Restoration proof: no marker may remain anywhere.
    for path, _, new, _ in MUTATIONS:
        s = open(os.path.join(ROOT, path)).read()
        if new in s:
            print(f"!! NOT RESTORED: {path}")
            sys.exit(1)
    print("all files restored clean")


if __name__ == "__main__":
    main()

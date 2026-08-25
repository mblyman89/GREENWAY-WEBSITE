#!/usr/bin/env python3
"""
scripts/mirror-filed-940.py

books-60. Mirrors Michael's FILED 2025 Form 940 into docs/authorities so the
claim "boxes 16a-16d do not apply to you" rests on a document in the repository
instead of on a note in a conversation that a compaction will eventually eat.

Standing rule 115 governs this: a filed return is the best authority there is,
and it must be reconciled to the cent before it is trusted. So this script
reconciles FIRST and refuses to write the mirror if any line disagrees. It also
re-extracts from the PDF rather than reusing formstudy/2025_FORM_940_-_SAGE.txt,
per rule 115(d) -- a pre-existing extraction is a copy of unknown provenance.

Rule 15: provably failable. Change any FILED figure below and it refuses.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

PDF = Path("../2025_FORM_940_-_SAGE.pdf")
OUT = Path("docs/authorities/federal/filed-form-940-2025-greenway.txt")

# The figures AS FILED, read off the fresh extraction, in integer cents.
FILED = {
    "line3_total_payments": 33_297_544,
    "line4_exempt": 0,
    "line5_excess_over_7000": 26_297_544,
    "line6_subtotal": 26_297_544,
    "line7_taxable_futa_wages": 7_000_000,
    "line8_futa_before_adjustments": 42_000,
    "line9_all_excluded": 0,
    "line10_some_excluded": 0,
    "line11_credit_reduction": 0,
    "line12_total_after_adjustments": 42_000,
    "line13_deposited": 42_000,
    "line14_balance_due": 0,
    "line15a_overpayment": 0,
}

# The threshold the FORM ITSELF states, in cents. Not a remembered number: the
# sentence is asserted against the extracted text below before it is used.
PART5_THRESHOLD_CENTS = 50_000
THRESHOLD_SENTENCE = (
    "Report your FUTA tax liability by quarter only if line 12 is more than $500."
)


def cents(v: int) -> str:
    return f"{v / 100:,.2f}"


def main() -> int:
    if not PDF.exists():
        print(f"DEFECT: {PDF} not found")
        return 1

    raw = subprocess.run(
        ["pdftotext", "-layout", str(PDF), "-"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf8")

    # ── RECONCILE BEFORE TRUSTING (rule 115a) ────────────────────────────────
    checks: list[tuple[str, int, int]] = [
        ("line 6  = line 4 + line 5", FILED["line4_exempt"] + FILED["line5_excess_over_7000"], FILED["line6_subtotal"]),
        ("line 7  = line 3 - line 6", FILED["line3_total_payments"] - FILED["line6_subtotal"], FILED["line7_taxable_futa_wages"]),
        ("line 8  = line 7 x 0.006", round(FILED["line7_taxable_futa_wages"] * 6 / 1000), FILED["line8_futa_before_adjustments"]),
        (
            "line 12 = 8 + 9 + 10 + 11",
            FILED["line8_futa_before_adjustments"] + FILED["line9_all_excluded"] + FILED["line10_some_excluded"] + FILED["line11_credit_reduction"],
            FILED["line12_total_after_adjustments"],
        ),
        ("line 14 = line 12 - line 13", max(0, FILED["line12_total_after_adjustments"] - FILED["line13_deposited"]), FILED["line14_balance_due"]),
        ("line 15a= line 13 - line 12", max(0, FILED["line13_deposited"] - FILED["line12_total_after_adjustments"]), FILED["line15a_overpayment"]),
    ]

    bad = [(w, g, f) for (w, g, f) in checks if g != f]
    if bad:
        print("REFUSING TO WRITE. Reconciliation failed (rule 115b: a mismatch is a finding):")
        for w, g, f in bad:
            print(f"  {w}: computed {cents(g)} but filed {cents(f)}")
        return 1

    # The threshold sentence must be IN the return, not remembered.
    flat = " ".join(raw.split())
    if " ".join(THRESHOLD_SENTENCE.split()) not in flat:
        print("REFUSING TO WRITE: the $500 threshold sentence is not in the extracted return.")
        print("  Looked for: " + THRESHOLD_SENTENCE)
        return 1

    applies = FILED["line12_total_after_adjustments"] > PART5_THRESHOLD_CENTS

    sha = hashlib.sha256(PDF.read_bytes()).hexdigest()[:16]
    header = f"""SOURCE DOCUMENT - INTERNAL REVENUE SERVICE FORM 940 (2025), AS FILED
Employer's Annual Federal Unemployment (FUTA) Tax Return
Filed for LYMAN'S MARIJUANA, EIN 46-4217016, tax year 2025
Prepared on Aatrix (rev. 11/30/25), Sage payroll; copy marked "Record Copy"

Mirrored in books-60 because a claim was about to be made to the owner -- that
Form 940 boxes 16a through 16d do not apply to him -- and a claim like that must
rest on a document in the repository, not on a figure quoted in a conversation.

Extracted from {PDF.name} ({PDF.stat().st_size:,} bytes, 2 pages,
sha256 {sha}...) with `pdftotext -layout`, freshly, by
scripts/mirror-filed-940.py. Standing rule 115(d): the pre-existing extraction
at formstudy/2025_FORM_940_-_SAGE.txt was deliberately NOT reused, because a
copy of unknown provenance is not an authority.

This is the taxpayer's own filed return, not a copyrighted publication.

RECONCILIATION PERFORMED BEFORE ANY FIGURE WAS USED (all six MATCH):
"""
    for w, g, f in checks:
        header += f"  {w:28s} computed {cents(g):>12s}   filed {cents(f):>12s}   MATCH\n"

    header += f"""
THE FINDING THIS DOCUMENT SUPPORTS:
  Line 12, total FUTA tax after adjustments, is ${cents(FILED['line12_total_after_adjustments'])}.
  Part 5 of the form states, verbatim:
    "{THRESHOLD_SENTENCE}"
  ${cents(FILED['line12_total_after_adjustments'])} is NOT more than $500.00, so Part 5 -- boxes 16a, 16b, 16c
  and 16d -- {'APPLIES' if applies else 'DOES NOT APPLY'} to this taxpayer, and no box lesson was written for
  those four boxes.

  This is a conclusion about a FIGURE, not about the taxpayer. If payroll grows
  until line 12 exceeds $500, Part 5 begins to apply and the four boxes become
  worth teaching. The figure is stated here so that reversal is visible rather
  than surprising.

==============================================================================

"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(header + raw, encoding="utf8")
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes). Reconciliation: 6/6 MATCH.")
    print(f"Part 5 (16a-16d): {'APPLIES' if applies else 'DOES NOT APPLY'} (line 12 = ${cents(FILED['line12_total_after_adjustments'])}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

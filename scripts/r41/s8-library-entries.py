#!/usr/bin/env python3
"""One-shot R41 S8 edit: add the Timberland agreement entries to scripts/r40/gen-legal-library.py
and teach the generator the new kind "agreement". Refuses to run twice."""
from pathlib import Path

p = Path(__file__).resolve().parents[2] / "scripts/r40/gen-legal-library.py"
s = p.read_text(encoding="utf8")
if "timberland-s25-liability" in s:
    raise SystemExit("already applied")

TA = "ach/timberland-ach-agreement-2026-10-09.redacted.txt"
PRIVATE = "private: the owner's signed copy (not public); text mirrored, redacted, with its sha256"
COURT = "Timberland Bank ACH Origination Agreement (signed by Greenway 10/09/26)"

entries = f'''
    # ── R41 S8: Greenway's own contract with Timberland ──────────────────────────
    # kind="agreement": the source is the owner's signed copy, which is NOT public, so
    # `source` names that instead of a URL. The quote is still cut mechanically from the
    # redacted mirror, and the test checks the mirror carries the PDF's sha256.
    dict(
        id="timberland-s25-liability",
        kind="agreement",
        title="Section 25: Timberland is liable only for gross negligence or willful misconduct",
        citation="Timberland ACH Origination Agreement, section 25 (Liability), p.4",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="25. Liability. Financial Institution shall be responsible only",
        end="Company may incur or suffer in connection with this Agreement.",
        whatHappened="",
        plainEnglish=(
            "Under the contract you signed, Timberland pays for a loss only if it was grossly careless or did "
            "something wrong on purpose. An ordinary mistake by the bank, a delay, or a loss that follows from it "
            "(a late-fee, a lost sale) is yours. In practice: the bank is not your safety net, so the checks have to "
            "happen before a file leaves Greenway."
        ),
        howWeProtectYou=(
            "Before a file can be released, the app checks it against Timberland's limits, its deadlines and the "
            "first-file prenote gate. A released file's bytes never change (the database refuses), and the app only "
            "serves a file that still matches its SHA-256 fingerprint."
        ),
        appLink="/admin/settings/banking/operations#files",
    ),
    dict(
        id="timberland-s11-indemnity",
        kind="agreement",
        title="Section 11: Greenway pays Timberland's losses, including attorney's fees, if a warranty is broken",
        citation="Timberland ACH Origination Agreement, section 11 (Warranties), p.3",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="Company shall indemnify Financial Institution against any loss",
        end="any breach of any of the foregoing warranties or agreements.",
        whatHappened="",
        plainEnglish=(
            "Section 11 has Greenway promise that every payment is accurate, on time and authorized by the person "
            "being paid. If one is not, and Timberland loses money or is sued, Greenway pays the bank back, "
            "including its lawyers. A payment to the wrong person is not only lost money; it can also come with the "
            "bank's legal bill."
        ),
        howWeProtectYou=(
            "Only an active authorization is paid. For employees, only Michael (the owner) can make it active or mark "
            "an account verified (prenote, test credit, or voided check plus call-back). For vendors, the vault pays "
            "only an active record. Any bank change goes on hold until a call-back at a number on file 90+ days, or in person."
        ),
        appLink="/admin/settings/banking/operations#checks",
    ),
    dict(
        id="timberland-s18-no-cancel",
        kind="agreement",
        title="Section 18: once Timberland has the file, Greenway has no right to cancel it",
        citation="Timberland ACH Origination Agreement, section 18 (Cancellation or Amendment of Entries), p.4",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="18. Cancellation or Amendment of Entries.",
        end="shall have no liability if it fails to effect the cancellation.",
        whatHappened="",
        plainEnglish=(
            "After you upload a file, you cannot take it back. Timberland will try if you ask quickly, but it does "
            "not have to succeed and owes you nothing if it fails. The time to catch a mistake is before the upload."
        ),
        howWeProtectYou=(
            "Voiding a file in the app (owner only, with a written reason) keeps the record, but it cannot pull back a "
            "file already uploaded. If the file is at Timberland, phone 1-800-562-8761 at once: under this section "
            "Timberland is not liable if the cancellation fails."
        ),
        appLink="/admin/settings/banking/operations#files",
    ),
    dict(
        id="timberland-s21-reversals",
        kind="agreement",
        title="Section 21: a reversal must be within 5 banking days and 24 hours, and Greenway carries the risk",
        citation="Timberland ACH Origination Agreement, section 21 (Reversals), p.4",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="21. Reversals.",
        end="from and against any claim, demand, loss, liability, or expense.",
        whatHappened="",
        plainEnglish=(
            "If a payment was wrong or sent twice, a reversal must go out within 5 banking days of the payment AND "
            "within 24 hours of finding the mistake, and the person must be told why before it settles. Greenway "
            "promises all of that, and covers everyone's losses from the reversal. Brenda adds that a reversal does "
            "not mean you get the money back."
        ),
        howWeProtectYou=(
            "Greenway's debit limits at Timberland are $0, so the app never builds a reversal file. The answer is to "
            "call Timberland at 1-800-562-8761 inside both clocks (open question Q8 asks Brenda to confirm). The "
            "duplicate checks exist so this is rarely needed."
        ),
        appLink="/admin/settings/banking/guide",
    ),
    dict(
        id="timberland-s23-account-number",
        kind="agreement",
        title="Section 23: a payment can be made on the account number even if the name is different",
        citation="Timberland ACH Origination Agreement, section 23 (Name and Account Number Inconsistency), p.4",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="23. Name and Account Number Inconsistency.",
        end="even if it identifies a party different from the named receiver.",
        whatHappened="",
        plainEnglish=(
            "Your contract repeats the Washington rule (RCW 62A.4A-207, also in this library): the money follows the "
            "account number. If the number is wrong, the name will not save the payment."
        ),
        howWeProtectYou=(
            "Timberland pays by account number alone, so the app checks every routing number's check digit and pays only "
            "verified, active records: employee accounts by prenote, test credit, or voided check plus call-back; "
            "vendor records by a call-back at a number on file."
        ),
        appLink="/admin/settings/banking/operations#checks",
    ),
    dict(
        id="timberland-s17-thirty-days",
        kind="agreement",
        title="Section 17: report a statement problem within 30 calendar days",
        citation="Timberland ACH Origination Agreement, section 17 (Settlement Discrepancies), p.3",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="17. Settlement Discrepancies.",
        end="either party may be liable to the other for damages.",
        whatHappened="",
        plainEnglish=(
            "Timberland's contract is shorter than the Washington law in this library: tell the bank about anything "
            "wrong on a statement within a reasonable time, and never later than 30 days after you get the "
            "statement (60 where the law gives 60)."
        ),
        howWeProtectYou=(
            "The Calendar has a monthly task to check the statement against the ACH files by the 15th, well inside "
            "the 30 days, and the ACH Payments report lines each file up with the bank's debits."
        ),
        appLink="/admin/settings/banking/calendar",
    ),
    dict(
        id="timberland-schedule-f-notice",
        kind="agreement",
        title="Schedule F: a possibly stolen code means a phone call at once and writing within 1 calendar day",
        citation="Timberland ACH Origination Agreement, Schedule F (Security Procedures), p.11",
        court="{COURT}",
        sourceFile="{TA}",
        source="{PRIVATE}",
        start="If Company believes or suspects that any such information",
        end="within a reasonable time period to prevent unauthorized transfers.",
        whatHappened="",
        plainEnglish=(
            "If you think a password, text-code phone or token may be in the wrong hands, phone Timberland right "
            "away and send written confirmation within 1 calendar day. Payments the bank made in good faith before "
            "it heard from you still stand, so speed matters."
        ),
        howWeProtectYou=(
            "The Calendar's yearly Schedule F self-check walks through the computer, connection, phone and user "
            "list, and repeats the phone number and the 1-day rule."
        ),
        appLink="/admin/settings/banking/calendar",
    ),
'''

marker = "\n]\n\n\ndef ts_str"
assert s.count(marker) == 1
s = s.replace(marker, "\n" + entries + "]\n\n\ndef ts_str")

old = "# kind: case | statute | regulation\n"
assert s.count(old) == 1
s = s.replace(old, "# kind: case | statute | regulation | agreement (R41 S8: Greenway's own Timberland contract)\n")

old = """        'export type LegalEntryKind = "case" | "statute" | "regulation";',"""
assert s.count(old) == 1
s = s.replace(old, """        'export type LegalEntryKind = "case" | "statute" | "regulation" | "agreement";',""")

old = '''        "  /** Public URL of the original (the court's or legislature's own site). */",'''
assert s.count(old) == 1
s = s.replace(old, '''        "  /** Public URL of the original (the court's or legislature's own site). For kind \\"agreement\\" it says the source is private. */",''')

p.write_text(s, encoding="utf8")
print("applied")

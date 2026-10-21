#!/usr/bin/env python3
"""
R40 - generate src/lib/payments/ach-legal-library.ts.

Every `quote` is CUT MECHANICALLY out of a mirrored file under
docs/authorities/ between a start anchor and an end anchor (inclusive),
after collapsing whitespace. No quote is typed by hand. If an anchor is not
found exactly once, the script fails - it never guesses.

Run:  python3 scripts/r40/gen-legal-library.py
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUTH = ROOT / "docs" / "authorities"
import os
OUT = Path(os.environ["R40_LEGAL_OUT"]) if os.environ.get("R40_LEGAL_OUT") else ROOT / "src" / "lib" / "payments" / "ach-legal-library.ts"


def flat(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def cut(source_file: str, start: str, end: str) -> str:
    text = flat((AUTH / source_file).read_text(encoding="utf8"))
    i = text.find(start)
    if i < 0 or text.find(start, i + 1) >= 0:
        sys.exit(f"start anchor not found exactly once in {source_file}: {start!r}")
    j = text.find(end, i)
    if j < 0:
        sys.exit(f"end anchor not found after start in {source_file}: {end!r}")
    return text[i : j + len(end)]


# kind: case | statute | regulation | agreement (R41 S8: Greenway's own Timberland contract)
ENTRIES = [
    # ── Court cases ────────────────────────────────────────────────────────
    dict(
        id="case-apache-call-number-on-file",
        kind="case",
        title="Apache Corp. v. Great American Insurance Co.",
        citation="Apache Corp. v. Great American Ins. Co., No. 15-20499 (5th Cir. Oct. 18, 2016) (per curiam, unpublished)",
        court="U.S. Court of Appeals for the Fifth Circuit",
        sourceFile="cases/apache-v-great-american-5th-cir-2016.txt",
        source="https://www.ca5.uscourts.gov/opinions/unpub/15/15-20499.0.pdf",
        start="Once the email was received, an Apache employee called",
        end="would never have changed the vendor-payment account information.",
        whatHappened=(
            "Criminals phoned Apache pretending to be a vendor and asked it to change the vendor's bank account. "
            "Apache said it needed the request on letterhead. The criminals then emailed a letter on fake letterhead "
            "from a look-alike email domain. An Apache employee 'verified' it by calling the phone number printed on "
            "that fake letter, which reached the criminals. Apache sent about $7 million to the criminals' account. It got a substantial part back, but says it "
            "still lost about $2.4 million. Its insurer refused to pay, and the appeals court sided with the insurer."
        ),
        plainEnglish=(
            "A callback only protects you if you dial a number you ALREADY had. A number printed on the request itself "
            "is the criminal's number. The court pointed out that Apache would not have been fooled if it had called "
            "the vendor's pre-existing contact."
        ),
        howWeProtectYou=(
            "This is exactly why Greenway's vault only lets you verify a bank change with a phone number or email "
            "that has been on file for at least 90 days, and never one taken from the request. A change also puts the "
            "payee ON HOLD until Michael (the owner) releases it."
        ),
        appLink="/admin/settings/banking/operations#holds",
    ),
    dict(
        id="case-beau-townsend-best-position",
        kind="case",
        title="Beau Townsend Ford Lincoln, Inc. v. Don Hinds Ford, Inc.",
        citation="Beau Townsend Ford Lincoln, Inc. v. Don Hinds Ford, Inc., No. 17-4177 (6th Cir. Nov. 27, 2018) (unpublished)",
        court="U.S. Court of Appeals for the Sixth Circuit",
        sourceFile="cases/beau-townsend-v-don-hinds-6th-cir-2018.txt",
        source="https://www.govinfo.gov/content/pkg/USCOURTS-ca6-17-04177/pdf/USCOURTS-ca6-17-04177-0.pdf",
        start="Arrow and Bile illustrate the principle",
        end="So too here.",
        whatHappened=(
            "A car dealer's email was hacked. The criminal sent the buyer new wiring instructions, and the buyer "
            "wired $736,225 to the criminal. Both businesses said the other should take the loss. The appeals court "
            "sent the case back to decide which of them was in the better position to stop the fraud."
        ),
        plainEnglish=(
            "When an email scam diverts a payment between two businesses, a court may ask which side could most "
            "easily have stopped it. A business that skips a simple check, such as a phone call to a known number, "
            "can end up carrying the loss even though it was not the one hacked."
        ),
        howWeProtectYou=(
            "Greenway never changes where money goes because of an email alone. Emailed ACH forms are drafts until a "
            "person re-keys the numbers, a callback to a number already on file is required, and every step is logged "
            "with who did it and when. That record is your proof that you took ordinary care."
        ),
        appLink="/admin/settings/banking/documents",
    ),
    dict(
        id="case-patco-one-size-fits-all",
        kind="case",
        title="Patco Construction Co. v. People's United Bank",
        citation="Patco Construction Co. v. People's United Bank, 684 F.3d 197 (1st Cir. 2012)",
        court="U.S. Court of Appeals for the First Circuit",
        sourceFile="cases/patco-v-peoples-united-1st-cir-2012.txt",
        source="http://media.ca1.uscourts.gov/pdf.opinions/11-2031P-01A.pdf",
        start="These collective failures, taken as a whole,",
        end="rendered Ocean Bank's security procedures commercially unreasonable.",
        whatHappened=(
            "Over seven days, criminals using Patco's online-banking credentials made six withdrawals totaling "
            "$588,851.26. The bank's own system scored them far riskier than Patco's normal activity but let them "
            "through. The appeals court held the bank's security was not commercially reasonable and sent the case back."
        ),
        plainEnglish=(
            "Under the funds-transfer law (UCC Article 4A, in Washington RCW 62A.4A-202), a bank generally carries an "
            "unauthorized loss unless its security procedure was 'commercially reasonable' and it followed it. Patco "
            "won its appeal on that point, but it took years of litigation. The lesson for a small business is "
            "practical: use every security option your bank offers, because that is what courts look at."
        ),
        howWeProtectYou=(
            "Timberland's procedure is your login plus a token or text code for every file (Schedule F), and limits "
            "(Schedule C). Timberland does not do call-backs for ACH, so Greenway calls payees back before any bank "
            "change. Dual approval is offered and is off by the owner's choice. The year-end calendar task reviews it."
        ),
        appLink="/admin/settings/banking?tab=company",
    ),
    dict(
        id="case-choice-escrow-declined-dual-control",
        kind="case",
        title="Choice Escrow & Land Title, LLC v. BancorpSouth Bank",
        citation="Choice Escrow & Land Title, LLC v. BancorpSouth Bank, 754 F.3d 611 (8th Cir. 2014)",
        court="U.S. Court of Appeals for the Eighth Circuit",
        sourceFile="cases/choice-escrow-v-bancorpsouth-8th-cir-2014.txt",
        source="https://ecf.ca8.uscourts.gov/opndir/14/06/131879P.pdf",
        start="Rather, this appears to be a case where",
        end="the customer has voluntarily assumed the risk of failure of the procedure",
        whatHappened=(
            "A small title company declined its bank's offer of 'dual control' (a second person must approve each "
            "transfer) and signed a waiver, because often only one employee was in the office. Internet fraudsters "
            "then sent a $440,000 wire from its account. The court held the company had to bear the loss, because it had turned down the stronger "
            "protection."
        ),
        plainEnglish=(
            "If your bank offers a security feature and you refuse it because it is inconvenient, the loss from a "
            "fraud it would have stopped is likely yours. 'We are a small shop' did not help this company."
        ),
        howWeProtectYou=(
            "Timberland offers dual approval, and Greenway's owner has chosen to leave it off and be the only "
            "Timberland user, knowing this case. The protections instead: his login plus a token or text code for "
            "every file, receipts for every ACH action, holds and call-backs before any bank change, and limits. "
            "In Greenway's system Michael, the owner, makes and releases every ACH change himself; anything Stephen "
            "adds, changes, removes or releases waits for Michael's approval, and every change is logged."
        ),
        appLink="/admin/settings/banking/operations#holds",
    ),
    # ── Statutes / regulations ─────────────────────────────────────────────
    dict(
        id="rcw-62a-4a-202-b",
        kind="statute",
        title="RCW 62A.4A-202(b): when a fraudulent order is still charged to you",
        citation="RCW 62A.4A-202(b)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-202.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-202",
        start="(b) If a bank and its customer have agreed",
        end="restricting acceptance of payment orders issued in the name of the customer.",
        whatHappened="",
        plainEnglish=(
            "If you and the bank agreed on a security procedure, and the procedure is commercially reasonable and the "
            "bank followed it in good faith, then a payment order that passed it counts as yours even if a criminal "
            "sent it. This is the rule Patco and Choice Escrow were about."
        ),
        howWeProtectYou=(
            "Keep a copy of Timberland's ACH agreement and its security procedure in Banking → Documents. Read the "
            "security section once a year (the Calendar tab reminds you)."
        ),
        appLink="/admin/settings/banking/calendar",
    ),
    dict(
        id="rcw-62a-4a-202-c",
        kind="statute",
        title="RCW 62A.4A-202(c): what 'commercially reasonable' means",
        citation="RCW 62A.4A-202(c)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-202.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-202",
        start="(c) Commercial reasonableness of a security procedure",
        end="accepted by the bank in compliance with the bank's obligations under the security procedure chosen by the customer.",
        whatHappened="",
        plainEnglish=(
            "Whether security is good enough depends on your situation: your size, how often and how much you send, "
            "and what other options the bank offered. The second sentence is the trap from Choice Escrow. If the bank "
            "offered something better, you refused it, and you signed that you accept the risk, the weaker procedure "
            "counts as 'reasonable' and the loss is yours."
        ),
        howWeProtectYou="Never sign a bank waiver of a security feature without talking to your lawyer first.",
        appLink="/admin/settings/banking/guide",
    ),
    dict(
        id="rcw-62a-4a-203-a-2",
        kind="statute",
        title="RCW 62A.4A-203(a)(2): your way out, if the fraud did not come through you",
        citation="RCW 62A.4A-203(a)(2)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-203.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-203",
        start="(2) The receiving bank is not entitled to enforce",
        end="Information includes any access device, computer software, or the like.",
        whatHappened="",
        plainEnglish=(
            "Even when the security procedure was reasonable, you do not have to pay for the fraud if you can prove it "
            "did not come from your people or your systems: not an employee, not someone who got into your computers, "
            "not someone who got your passwords from you. That is very hard to prove if your logins leaked."
        ),
        howWeProtectYou=(
            "Protect the bank login like cash. Use passkeys on the Greenway admin, give only owners banking "
            "permission (already the case), never share passwords, and remove access the day someone leaves."
        ),
        appLink="/admin/users",
    ),
    dict(
        id="rcw-62a-4a-204-a-ninety-days",
        kind="statute",
        title="RCW 62A.4A-204(a): report unauthorized transfers fast (90 days)",
        citation="RCW 62A.4A-204(a)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-204.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-204",
        start="However, the customer is not entitled to interest",
        end="debited with respect to the order.",
        whatHappened="",
        plainEnglish=(
            "Check your bank statement. If you do not report a payment you did not authorize within a reasonable "
            "time (never more than 90 days after the bank told you about it), you lose the right to interest on the "
            "refund."
        ),
        howWeProtectYou=(
            "The Calendar tab adds a monthly 'reconcile the ACH account against the statement' task, so nothing "
            "sits unnoticed for 90 days."
        ),
        appLink="/admin/settings/banking/calendar",
    ),
    dict(
        id="rcw-62a-4a-505-one-year",
        kind="statute",
        title="RCW 62A.4A-505: one year, then it is final",
        citation="RCW 62A.4A-505",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-505.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-505",
        start="If a receiving bank has received payment",
        end="within one year after the notification was received by the customer.",
        whatHappened="",
        plainEnglish=(
            "After one year from the statement, you can no longer object to a payment at all, even a fraudulent one."
        ),
        howWeProtectYou="Same monthly reconciliation task. Report anything odd to Timberland the same day.",
        appLink="/admin/settings/banking/calendar",
    ),
    dict(
        id="rcw-62a-4a-207-b-1-number-wins",
        kind="statute",
        title="RCW 62A.4A-207(b)(1): the bank follows the NUMBER, not the name",
        citation="RCW 62A.4A-207(b)(1)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-207.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-207",
        start="(1) Except as otherwise provided in subsection (c) of this section, if the beneficiary's bank does not know",
        end="The beneficiary's bank need not determine whether the name and number refer to the same person.",
        whatHappened="",
        plainEnglish=(
            "If the name says 'Acme Farms' but the account number belongs to a criminal, the receiving bank may pay "
            "the criminal. Banks do not have to check that the name matches. One wrong digit, or one swapped number, "
            "and the money goes to whoever owns that account."
        ),
        howWeProtectYou=(
            "This is why Greenway re-keys bank numbers blind (a person types them without seeing the form's numbers), "
            "verifies every new account with a prenote or test credit, and holds every change."
        ),
        appLink="/admin/settings/banking/operations#checks",
    ),
    dict(
        id="rcw-62a-4a-108-consumer-carveout",
        kind="statute",
        title="RCW 62A.4A-108(a): payroll to employees is mostly NOT Article 4A",
        citation="RCW 62A.4A-108(a)",
        court="Washington State Legislature (Uniform Commercial Code Article 4A)",
        sourceFile="state-wa/rcw-62A.4A-108.txt",
        source="https://app.leg.wa.gov/RCW/default.aspx?cite=62A.4A-108",
        start="(a) Except as provided in subsection (b) of this section, this Article does not apply",
        end="15 U.S.C. Sec. 1693 et seq.).",
        whatHappened="",
        plainEnglish=(
            "Article 4A covers business-to-business transfers such as vendor payments. A transfer into a person's "
            "own consumer account, such as payroll direct deposit, is generally governed by the federal Electronic "
            "Fund Transfer Act and Regulation E instead. That is why the employee and vendor flows have slightly "
            "different rules."
        ),
        howWeProtectYou="The system already treats vendors and employees as separate payee types with their own rules.",
        appLink="/admin/settings/banking?tab=employees",
    ),
    dict(
        id="reg-e-1005-10-e-2-no-forced-bank",
        kind="regulation",
        title="12 CFR 1005.10(e)(2): you cannot force an employee to use a particular bank",
        citation="12 CFR 1005.10(e)(2) (Regulation E)",
        court="Consumer Financial Protection Bureau (federal regulation)",
        sourceFile="federal/cfr-12-1005.10-reg-e.txt",
        source="https://www.ecfr.gov/current/title-12/chapter-X/part-1005/subpart-A/section-1005.10",
        start="No financial institution or other person may require a consumer to establish an account",
        end="as a condition of employment or receipt of a government benefit.",
        whatHappened="",
        plainEnglish=(
            "You may offer direct deposit, but you cannot make an employee open an account at a bank you choose as a "
            "condition of the job. Let each employee pick their own bank, or take a paper check."
        ),
        howWeProtectYou=(
            "Greenway's employee form lets the employee name any bank (up to 3 accounts), and payroll falls back to "
            "a paper check when no signed authorization exists."
        ),
        appLink="/admin/settings/banking?tab=employees",
    ),
    dict(
        id="wac-296-128-035-7-on-payday",
        kind="regulation",
        title="WAC 296-128-035(7): direct deposit must be there ON payday",
        citation="WAC 296-128-035(7)",
        court="Washington Department of Labor & Industries (state rule)",
        sourceFile="state-wa/wac-296-128-035.txt",
        source="https://app.leg.wa.gov/WAC/default.aspx?cite=296-128-035",
        start="Employers that pay employees by direct deposit or other electronic means",
        end="made and available to employees on the established pay day.",
        whatHappened="",
        plainEnglish=(
            "If you pay by direct deposit, the money has to be in the employee's account on payday, not 'sent' on "
            "payday. A held or unverified account must not make an employee's pay late, so pay that person by check "
            "for that run."
        ),
        howWeProtectYou=(
            "The Guide's unblocker tells you to pay by check this run whenever a hold or verification would make "
            "direct deposit late, and the payroll run shows the fallback in plain words."
        ),
        appLink="/admin/payroll",
    ),

    # ── R41 S8: Greenway's own contract with Timberland ──────────────────────────
    # kind="agreement": the source is the owner's signed copy, which is NOT public, so
    # `source` names that instead of a URL. The quote is still cut mechanically from the
    # redacted mirror, and the test checks the mirror carries the PDF's sha256.
    dict(
        id="timberland-s25-liability",
        kind="agreement",
        title="Section 25: Timberland is liable only for gross negligence or willful misconduct",
        citation="Timberland ACH Origination Agreement, section 25 (Liability), p.4",
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
        court="Timberland Bank ACH Origination Agreement (countersigned copy: Greenway 10/13/26, Timberland 10/14/26)",
        sourceFile="ach/timberland-ach-agreement-2026-10-14.redacted.txt",
        source="private: the owner's signed copy (not public); text mirrored, redacted, with its sha256",
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
]


def ts_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def main() -> None:
    seen = set()
    rows = []
    for e in ENTRIES:
        if e["id"] in seen:
            sys.exit(f"duplicate id {e['id']}")
        seen.add(e["id"])
        q = cut(e["sourceFile"], e["start"], e["end"])
        if len(q) < 60:
            sys.exit(f"quote too short for {e['id']}")
        rows.append({**{k: v for k, v in e.items() if k not in ("start", "end")}, "quote": q})

    lines = [
        "/**",
        " * src/lib/payments/ach-legal-library.ts",
        " *",
        " * R40 - the Legal library tab: court cases, statutes and regulations that",
        " * bear on paying people by ACH, each with the VERBATIM text, what happened,",
        " * plain English, and how Greenway's system protects you.",
        " *",
        " * GENERATED by scripts/r40/gen-legal-library.py. Each quote was cut",
        " * mechanically out of the mirrored source under docs/authorities/ between",
        " * two anchors. Do not hand-edit a quote: tests/compliance/r40-legal-library",
        " * re-reads every source file and fails on a single character of drift.",
        " *",
        " * NOT LEGAL ADVICE. This is a reference written for a small business owner;",
        " * it is not a substitute for a Washington-licensed attorney.",
        " */",
        "",
        'export type LegalEntryKind = "case" | "statute" | "regulation" | "agreement";',
        "",
        "export type LegalEntry = {",
        "  readonly id: string;",
        "  readonly kind: LegalEntryKind;",
        "  readonly title: string;",
        "  readonly citation: string;",
        "  readonly court: string;",
        "  /** Mirrored file, relative to docs/authorities/. */",
        "  readonly sourceFile: string;",
        "  /** Public URL of the original (the court's or legislature's own site). For kind \"agreement\" it says the source is private. */",
        "  readonly source: string;",
        "  readonly quote: string;",
        '  /** Facts of the case in plain words ("" for statutes). */',
        "  readonly whatHappened: string;",
        "  readonly plainEnglish: string;",
        "  readonly howWeProtectYou: string;",
        "  /** Where in the back office the protection lives. */",
        "  readonly appLink: string;",
        "};",
        "",
        "export const ACH_LEGAL_LIBRARY: readonly LegalEntry[] = [",
    ]
    keys = ["id", "kind", "title", "citation", "court", "sourceFile", "source", "quote", "whatHappened", "plainEnglish", "howWeProtectYou", "appLink"]
    for r in rows:
        lines.append("  {")
        for k in keys:
            lines.append(f"    {k}: {ts_str(r[k])},")
        lines.append("  },")
    lines.append("];")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf8")
    print(f"wrote {OUT} with {len(rows)} entries")


if __name__ == "__main__":
    main()

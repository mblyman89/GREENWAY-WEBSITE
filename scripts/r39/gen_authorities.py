#!/usr/bin/env python3
"""R39: generate src/lib/payments/ach-authorities.ts from quotes.json + metadata.

The QUOTE field is never typed by hand: it is copied from the JSON produced by
r39_extract_quotes.py, which itself copies it from docs/authorities/.
"""
import json
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.join(REPO, "scripts", "r39")

Q = json.load(open(os.path.join(HERE, "quotes.json"), encoding="utf8"))

URL = {
    "ach/nacha-micro-entries-phase-1.txt": "https://www.nacha.org/micro-entries",
    "ach/nacha-fraud-monitoring-phase-2.txt": "https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2",
    "ach/nacha-meaningful-modernization.txt": "https://www.nacha.org/rules/meaningful-modernization",
    "ach/odfi-simmons-ach-origination-guidelines.txt": "https://www.simmonsbank.com/siteassets/pdfs/qrg-ach-origination-guidelines.pdf",
    "ach/odfi-campus-federal-originator-responsibilities-2024.txt": "https://www.campusfederal.org/uploads/docs/brochures/CFCU-Originator-Responsibilities-2024.pdf",
    "ach/odfi-access-united-nacha-updates-2024.txt": "https://www.accessunited.com/assets/files/84KFPs67",
    "ach/odfi-first-citizens-nacha-file-specs.txt": "https://www.firstcitizens.com/content/dam/firstcitizens/pdfs/commercial/commercial-advantage/nacha-file-specs.pdf",
    "ach/odfi-grand-valley-prenote-waiting-period.txt": "https://www.grandvalleybank.com/assets/files/ip5QIqAu",
    "ach/odfi-peoples-bank-2026-originators-newsletter.txt": "https://www.mypeoples.bank/uploads/userfiles/files/documents/2026%20Originators%20newsletter.pdf",
    "ach/frbservices-holiday-schedule.txt": "https://www.frbservices.org/about/holiday-schedules",
    "ach/plaid-auth-same-day-micro-deposits.txt": "https://plaid.com/docs/auth/coverage/same-day/",
    "ach/wa-sao-vendor-master-file.txt": "https://sao.wa.gov/the-audit-connection-blog/protect-your-vendor-master-file-fraudsters",
    "ach/disbursementcontrols-vendor-contact-change-risk.txt": "https://www.disbursementcontrols.com/vendor-contact-change-risk",
    "ach/unc-finance-safely-updating-vendor-bank-accounts.txt": "https://finance.unc.edu/news/2020/06/15/safely-updating-vendor-bank-accounts",
    "state-wa/wac-314-55-087.txt": "https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087",
    "state-wa/rcw-1.80.040.txt": "https://app.leg.wa.gov/RCW/default.aspx?cite=1.80.040",
    "state-wa/rcw-1.80.060.txt": "https://app.leg.wa.gov/RCW/default.aspx?cite=1.80.060",
    "state-wa/rcw-1.80.080.txt": "https://app.leg.wa.gov/RCW/default.aspx?cite=1.80.080",
    "federal/usc-15-7001.txt": "https://www.law.cornell.edu/uscode/text/15/7001",
    "federal/usc-15-7006.txt": "https://www.law.cornell.edu/uscode/text/15/7006",
}

# Citation prefixes. These exact strings are what scripts/verify-verbatim-quotes.ts
# routes to a mirrored file (ACH_PUBLICATION_FILES), so they must not be reworded
# without updating the router table in the same commit.
CITE = {
    "ach/nacha-micro-entries-phase-1.txt": "Nacha, Micro-Entries (Phase 1) rule summary",
    "ach/nacha-fraud-monitoring-phase-2.txt": "Nacha, Fraud Monitoring Phase 2 rule summary",
    "ach/nacha-meaningful-modernization.txt": "Nacha, Meaningful Modernization rule summary",
    "ach/odfi-simmons-ach-origination-guidelines.txt": "Simmons Bank, ACH Origination Guidelines (July 2024)",
    "ach/odfi-campus-federal-originator-responsibilities-2024.txt": "Campus Federal Credit Union, Originator's Responsibilities (2024 brochure)",
    "ach/odfi-access-united-nacha-updates-2024.txt": "United Bank, Nacha Operating Rules Updates and Reminders 2024",
    "ach/odfi-first-citizens-nacha-file-specs.txt": "First Citizens Bank, NACHA File Specifications (Rev 02/2024)",
    "ach/odfi-grand-valley-prenote-waiting-period.txt": "Grand Valley Bank, Prenotification Entries: Reduction in Waiting Period for Live Entries",
    "ach/odfi-peoples-bank-2026-originators-newsletter.txt": "mypeoples.bank, 2026 Originators newsletter (January 2026)",
    "ach/frbservices-holiday-schedule.txt": "Federal Reserve Financial Services, Holiday Schedules",
    "ach/plaid-auth-same-day-micro-deposits.txt": "Plaid Docs, Auth - Same Day Micro-deposits",
    "ach/wa-sao-vendor-master-file.txt": "Washington State Auditor's Office, Protect your vendor master file from fraudsters",
    "ach/disbursementcontrols-vendor-contact-change-risk.txt": "Disbursement Controls, Vendor Contact Change Risks",
    "ach/unc-finance-safely-updating-vendor-bank-accounts.txt": "UNC-Chapel Hill Finance, Safely Updating Vendor Bank Accounts (June 15, 2020)",
}

# id, kind, citation-suffix (appended to CITE prefix; for statutes the full cite), meaning
META = {
    "micro-entry-definition": ("industry_guidance", None,
        "This is what the \"$1 test credit\" Michael asked about actually is, in Nacha's own words: a small real deposit whose only job is to prove "
        "the account works and that the payee can see it. It is not a check and it is not a prenote. Greenway would only ever send the CREDIT half; "
        "this system never originates debits, so there is no offsetting pull-back."),
    "micro-entry-under-one-dollar": ("industry_guidance", None,
        "The test credit must be under one dollar, so the system refuses any verification credit of $1.00 or more. The second sentence is about "
        "offsetting debits, which Greenway never sends - it is quoted whole so nobody trims it into a sentence that sounds like it allows a debit. "
        "The vendor form already promises the test credit is not recoverable."),
    "micro-entry-acctverify": ("industry_guidance", None,
        "If Greenway ever sends a test credit, the batch description must read ACCTVERIFY, not VENDOR PAY or PAYROLL. The system stamps that word "
        "itself so nobody has to remember it, and so the payee's statement shows a line that obviously is a verification and not a short payment."),
    "micro-entry-no-simultaneous-live": ("industry_guidance", None,
        "The real payment must wait until the payee has confirmed the test amount. The system therefore keeps a payee in Pending Verification until "
        "the confirmed amount is recorded, and refuses to put a live payment in the same file as the test credit, even when that would be convenient."),
    "prenote-vs-micro-formatting": ("industry_guidance", None,
        "Nacha's own explanation of the difference Michael asked about. A prenote is identified by its special transaction code and a zero amount - "
        "no money moves and nothing posts. A test credit is a real deposit and is identified by the word ACCTVERIFY. Two different tools; the system "
        "treats them as two different verification methods."),
    "fraud-phase-2-all-originators": ("industry_guidance", None,
        "Greenway is a non-consumer Originator, so this applies to Greenway now - it took effect June 19, 2026, and practically June 22, 2026 because "
        "the 19th was Juneteenth. Size does not matter any more: a ten-employee shop is in scope exactly like a large one. That is why this round "
        "builds written, logged procedures instead of relying on memory."),
    "fraud-phase-2-change-controls": ("industry_guidance", None,
        "This is the sentence the whole vault design answers. A bank-detail change is the single most valuable thing a fraudster can achieve, so a "
        "change puts the payee ON HOLD, must be verified by a callback to a number already on file, and must be released by Michael or Stephen with "
        "a written record. Payments cannot go to new details until that happens."),
    "fraud-phase-2-annual-review": ("industry_guidance", None,
        "Two duties: have risk-based procedures, and review them at least once a year. The system records the last review date and flags the "
        "procedures as overdue after twelve months, so the annual review is something the screen asks for rather than something to remember."),
    "false-pretenses": ("industry_guidance", None,
        "This names the exact frauds this vault defends against: someone pretending to be a vendor or an employee and asking for payments to go to "
        "their account. A request that looks legitimate is the danger, which is why the callback uses the number on file and never the number in "
        "the request."),
    "only-consumer-debits-need-signed-writing": ("industry_guidance", None,
        "Greenway only sends credits, so strictly speaking the Rules do not demand a signed paper form for these payments. Greenway still collects "
        "one (paper or e-signed) because it is the evidence that the payee chose the account, and because the bank's origination agreement may "
        "demand more than the Rules do. The form is evidence, not a formality."),
    "prenote-zero-dollar-not-ownership": ("industry_guidance", None,
        "The plain-English answer to \"is a prenote a check?\": no. It is a zero-dollar electronic test message sent through the ACH network. "
        "Nothing is deposited, nothing is printed, and the payee usually never sees it. The second sentence matters most: a prenote that goes "
        "through proves the account EXISTS, not that it belongs to the payee. The callback is still required."),
    "prenote-three-banking-days": ("industry_guidance", None,
        "The waiting rule the system enforces. Once a prenote settles, the payee stays in Prenote Sent for three banking days; if a return or a "
        "Notification of Change arrives, the payee goes ON HOLD and the details are fixed first. Banking days are FedACH days, which is why the "
        "system uses the Federal Reserve holiday list and not the calendar."),
    "returns-second-banking-day": ("industry_guidance", None,
        "This is WHY the prenote wait is three banking days: a bank that is going to reject the account must do so by the opening of business on "
        "the second banking day after settlement. By the third banking day any timely rejection has already arrived, so the ready date is "
        "settlement plus three FedACH banking days."),
    "noc-six-banking-days": ("industry_guidance", None,
        "When a payee's bank sends a Notification of Change (it fixed a wrong digit or account type on its end), Greenway must update the vault "
        "before the next payment or within six banking days. Payroll is recurring, so the system computes that due date and blocks the next "
        "payroll file until the correction is recorded."),
    "reversal-five-banking-days": ("industry_guidance", None,
        "If a payment goes out twice, to the wrong account, or for the wrong amount, the only way to try to pull it back through the ACH network "
        "closes five banking days after settlement. The returns log shows that deadline as a date the moment an error is recorded, because it "
        "cannot be extended."),
    "reversal-description": ("industry_guidance", None,
        "A reversal must be labelled REVERSAL and the payee must be told before it settles. The vendor and employee forms already promise that "
        "notice; the system records who was notified and when, so the promise in the form and the record in the file say the same thing."),
    "authorization-two-years-campus": ("industry_guidance", None,
        "The ACH rule minimum: keep the authorization for two years after it ends, and be able to produce it within ten banking days. That is the "
        "shortest of the three clocks that apply to Greenway; the Washington cannabis five-year rule and Greenway's six-year policy are longer and "
        "win, so the system keeps the later date."),
    "authorization-two-years-united": ("industry_guidance", None,
        "A second, independent bank summary of the same two-year rule, quoted so the retention basis does not rest on one bank's brochure. It also "
        "says what to keep: the original signed form or a copy. That is why an uploaded paper form is stored as the file itself and never only as "
        "data keyed from it."),
    "prenotes-optional": ("industry_guidance", None,
        "Prenotes are optional under the Rules, and Michael is still confirming whether Timberland accepts them. So the system offers prenote OR a "
        "test credit OR callback-only (with a written reason), and records which one was used. Whichever Timberland supports, the payee cannot be "
        "paid until the chosen check is finished."),
    "prenote-codes": ("industry_guidance", None,
        "The transaction codes. Greenway only sends credits, so live payments use 22 (checking) and 32 (savings), and a prenote uses 23 (checking) "
        "or 33 (savings). The debit codes appear in the quote only because they share the sentence; the system has no code path that can produce "
        "27, 28, 37 or 38."),
    "prenote-wait-history": ("industry_guidance", None,
        "History, quoted so an older article or a long-serving bookkeeper saying \"six days\" does not cause confusion. The wait used to be six "
        "banking days; the Rules cut it to three. The system uses three, which matches the 2024 bank summaries quoted next to this one."),
    "payroll-description": ("industry_guidance", None,
        "From March 20, 2026 a payroll batch must say PAYROLL in capitals. The payroll file builder already defaults to PAYROLL; this authority is "
        "why it may not be changed to something friendlier like \"PAY\" or \"WAGES\", and why a test fails if it is."),
    "verify-with-contact-on-file": ("industry_guidance", None,
        "The callback rule in a bank's words: a change request is verified by calling the number already in Greenway's records, never a number in "
        "the email, text or fax asking for the change. The verification screen shows only numbers that were on file before the request, and "
        "never a number typed into the request."),
    "noc-no-new-authorization": ("industry_guidance", None,
        "Applying a Notification of Change does not require the payee to sign a new form. The system records the NOC as the reason for the "
        "corrected details, so the change has a paper trail without dragging the payee back in for a signature."),
    "fedach-saturday-sunday": ("industry_guidance", None,
        "The two rules that make FedACH banking days differ from the federal calendar. A Saturday holiday does NOT close the Fed on Friday; a "
        "Sunday holiday DOES close it on Monday. The existing payroll deposit calendar follows a different rule (DC holidays) and must not be "
        "reused for ACH timing; this engine has its own."),
    "plaid-same-day": ("industry_guidance", None,
        "Why Plaid is not the default. Greenway's Plaid plan is limited, and even same-day micro-deposits take one to two business days and need "
        "the payee to come back and confirm. A prenote from Greenway's own file needs nothing from the payee, so it is the easier route if "
        "Timberland accepts prenotes. Plaid stays available as a later option."),
    "sao-verify-by-phone": ("state_manual", None,
        "Washington's own auditor says the same thing as the bank summaries: call, using contact information already on file. The State Auditor "
        "audits public bodies, not Greenway, so this is persuasive and not binding - but it is the clearest Washington statement of the standard."),
    "sao-segregate-duties": ("state_manual", None,
        "The reason managers can upload a signed form but cannot open it, edit bank details or release a payee. Only Michael and Stephen can change "
        "the vendor or employee master file. With two people that is the strongest separation available, and the solo-release log covers the days "
        "only one of them is in."),
    "callback-manipulation": ("industry_guidance", None,
        "The trap a plain callback falls into: the fraudster first changes the phone number, then asks for the bank change, then answers the "
        "callback. That is why a contact change within the look-back window before a bank change raises the risk and forces the callback to an "
        "older number on file."),
    "unc-verbal-in-person-or-phone": ("industry_guidance", None,
        "A university accounts-payable policy that says what the release screen asks for: the payee confirms the bank details verbally, either "
        "face to face or on a phone call to a number found independently, never one from the email that asked for the change. That is why the "
        "release form offers two methods, phone or in person. A phone callback must use a number on file for the 90-day look-back; an in-person "
        "confirmation involves no phone number, so the look-back does not apply, but a written note of who confirmed it is still required."),
    "wac-087-five-years": ("state_law", "WAC 314-55-087(1)",
        "The Washington cannabis rule. Bank statements, financial transaction records and employee records must be kept on the licensed premises "
        "for five years and shown to the LCB on request. A signed ACH authorization is a record of a financial arrangement and part of the "
        "employee file, so it is kept at least five years."),
    "wac-087-employee-records": ("state_law", "WAC 314-55-087(1)(e)",
        "\"All employee records ... payroll\" - an employee's direct-deposit authorization is a payroll record, so it goes in the employee file and "
        "is kept for the WAC period. Greenway's policy keeps it six years after it ends, which is longer than both this rule and the ACH rule."),
    "rcw-1-80-040-agreement": ("state_law", "RCW 1.80.040(2)",
        "E-signing is only valid if the person agreed to do business electronically. That is why the e-sign page asks for an explicit consent "
        "click before the form is shown, records it with a timestamp, and offers paper instead. Declining e-sign never blocks someone from "
        "signing on paper."),
    "rcw-1-80-060-signature": ("state_law", "RCW 1.80.060",
        "Washington law: an e-signature counts as a signature, and an electronic record counts as a writing. That is what makes an e-signed ACH "
        "form exactly as good as a paper one - provided the attribution evidence in RCW 1.80.080 is kept with it."),
    "rcw-1-80-080-attribution": ("state_law", "RCW 1.80.080(1)",
        "If anyone ever disputes a signature, the question is whether it was that person's act, and a security procedure helps prove it. The "
        "e-sign flow therefore records a one-time code sent to contact details on file, the time, the IP address, the browser, and a hash of the "
        "exact document signed, and prints them on a certificate."),
    "usc-7001-a": ("statute", "15 U.S.C. \u00a77001(a)",
        "The federal E-SIGN Act says the same thing as Washington's UETA for interstate commerce: an electronic signature or record may not be "
        "refused legal effect just because it is electronic. Both are quoted so the e-signed form stands on federal and state law."),
    "usc-7006-5": ("statute", "15 U.S.C. \u00a77006(5)",
        "What an electronic signature legally is: a sound, symbol or process attached to the record and adopted WITH INTENT TO SIGN. That is why "
        "the e-sign page requires the signer to type their name and tick a statement that typing it is their signature, rather than treating a "
        "button click as a signature."),
}


def ts_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def wrap(s: str, width: int = 92) -> str:
    """Split a long string into concatenated TS literals at word boundaries."""
    words = s.split(" ")
    parts, cur = [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            parts.append(cur + " ")
            cur = w
        else:
            cur = w if not cur else cur + " " + w
    parts.append(cur)
    return " +\n    ".join(ts_str(p) for p in parts)


def main() -> None:
    ids = []
    entries = []
    for qid, (kind, cite_override, meaning) in META.items():
        q = Q[qid]
        f = q["file"]
        cite = cite_override if cite_override else CITE[f]
        tid = "ach-" + qid
        ids.append(tid)
        assert len(meaning) > 200, (qid, len(meaning))
        entries.append(
            "  {\n"
            f"    id: {ts_str(tid)},\n"
            f"    kind: {ts_str(kind)},\n"
            f"    citation: {ts_str(cite)},\n"
            f"    sourceFile: {ts_str(f)},\n"
            f"    source: {ts_str(URL[f])},\n"
            f"    quote:\n    {wrap(q['quote'])},\n"
            f"    whatItMeansHere:\n    {wrap(meaning)},\n"
            "  },"
        )
    union = "\n".join(f"  | {ts_str(i)}" for i in ids)
    lst = "\n".join(f"  {ts_str(i)}," for i in ids)
    pub_table = "\n".join(f"  {ts_str(v)}: {ts_str(k)}," for k, v in CITE.items())
    head = open(os.path.join(HERE, "authorities_header.ts.tpl"), encoding="utf8").read()
    body = (
        head
        + "export type AchAuthorityId =\n" + union + ";\n\n"
        + "/** Every id above, as a runtime list. Checked against the registry by test. */\n"
        + "export const ALL_ACH_AUTHORITY_IDS: readonly AchAuthorityId[] = [\n" + lst + "\n];\n\n"
        + "/**\n * Citation prefix -> mirrored file (relative to docs/authorities/). The verbatim\n"
        + " * verifier (scripts/verify-verbatim-quotes.ts) routes these publications through\n"
        + " * this table, so a reworded citation fails loudly instead of being skipped.\n */\n"
        + "export const ACH_PUBLICATION_FILES: Readonly<Record<string, string>> = {\n" + pub_table + "\n};\n\n"
        + "export const ACH_AUTHORITIES: readonly AchAuthority[] = [\n" + "\n".join(entries) + "\n];\n\n"
        + open(os.path.join(HERE, "authorities_footer.ts.tpl"), encoding="utf8").read()
    )
    open(os.path.join(REPO, "src", "lib", "payments", "ach-authorities.ts"), "w", encoding="utf8").write(body)
    print("wrote", len(ids), "authorities")


if __name__ == "__main__":
    main()

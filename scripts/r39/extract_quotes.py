#!/usr/bin/env python3
"""R39: extract verbatim quotes from the mirrored corpus by start/end marker.

Nothing is retyped: each quote is the whitespace-flattened corpus text from the
first occurrence of `start` through the end of the first following `end`.
Prints JSON {id: quote}. Fails loudly if a marker is missing.
"""
import json
import re
import sys

import os
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ROOT = os.path.join(REPO, "docs", "authorities") + "/"
SPECS = [
    ("micro-entry-definition", "ach/nacha-micro-entries-phase-1.txt",
     "A Micro-Entry will", "an account.\u201d"),
    ("micro-entry-under-one-dollar", "ach/nacha-micro-entries-phase-1.txt",
     "A credit Micro-Entry must be in the amount of less than $1.00", "nets the total verification practice to $0;"),
    ("micro-entry-acctverify", "ach/nacha-micro-entries-phase-1.txt",
     "In the Company Entry Description field, the Rule requires the use of", "the use of \u201cACCTVERIFY\u201d"),
    ("micro-entry-no-simultaneous-live", "ach/nacha-micro-entries-phase-1.txt",
     "An Originator using Micro-Entries may initiate future Entries", "risk management requirements will be applied to Originators."),
    ("prenote-vs-micro-formatting", "ach/nacha-micro-entries-phase-1.txt",
     "Prenotification Entries can be easily identified by a unique transaction code", "discretion over the content of the company entry description field."),
    ("fraud-phase-2-all-originators", "ach/nacha-fraud-monitoring-phase-2.txt",
     "(effective June 19, 2026) will eliminate the volume threshold and will require all non-consumer Originators", "to comply with the fraud monitoring rules."),
    ("fraud-phase-2-change-controls", "ach/nacha-fraud-monitoring-phase-2.txt",
     "Originators may be best placed to implement procedures to protect against account takeover", "instructions for vendor and payroll payments."),
    ("fraud-phase-2-annual-review", "ach/nacha-fraud-monitoring-phase-2.txt",
     "establish and implement risk-based processes and procedures, relevant to the role it plays", "make appropriate updates to address evolving risks."),
    ("false-pretenses", "ach/nacha-fraud-monitoring-phase-2.txt",
     "the inducement of a payment by a Person misrepresenting", "the ownership of an account to be credited.\u201d"),
    ("only-consumer-debits-need-signed-writing", "ach/nacha-meaningful-modernization.txt",
     "Explicitly states that authorization of an ACH payment", "require a writing that is signed or similarly authenticated"),
    ("prenote-zero-dollar-not-ownership", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "Prenotes are zero-dollar entries sent to a Receiver", "Prenotes do not validate ownership of the account."),
    ("prenote-three-banking-days", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "After three (3) banking days of the Settlement Date of the prenote", "reach out to the Receiver for updated account information."),
    ("returns-second-banking-day", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "The RDFI must return the entry in time for Simmons Bank (ODFI) to receive it", "following the settlement date."),
    ("noc-six-banking-days", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "If your company sends recurring payments", "within six banking days of receiving the Notification of Change information."),
    ("reversal-five-banking-days", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "An erroneous entry or file can contain the wrong amount", "from the Settlement Date of the erroneous or duplicate entry or file."),
    ("reversal-description", "ach/odfi-simmons-ach-origination-guidelines.txt",
     "As the Originator, you must make a reasonable attempt to notify the Receiver", "in the Company/Batch Header Record."),
    ("authorization-two-years-campus", "ach/odfi-campus-federal-originator-responsibilities-2024.txt",
     "Copies of authorizations are maintained for two years from the date the", "within ten banking days of the request."),
    ("authorization-two-years-united", "ach/odfi-access-united-nacha-updates-2024.txt",
     "Authorization must be retained by the Originator for a period of two years following the termination or revocation", "retain either the original or a copy of the signed authorization."),
    ("prenotes-optional", "ach/odfi-access-united-nacha-updates-2024.txt",
     "A prenotification is a zero-dollar entry generated to validate an account", "prior to initiating the live dollar transaction."),
    ("prenote-codes", "ach/odfi-first-citizens-nacha-file-specs.txt",
     "For Prenotes: 23 - Checking Credits; 33 - Savings Credits;", "32 - Savings Credits; 27 - Checking Debits; 37 - Savings Debits"),
    ("prenote-wait-history", "ach/odfi-grand-valley-prenote-waiting-period.txt",
     "In the past, Originators have had to wait six Banking Days", "the waiting period three banking days."),
    ("payroll-description", "ach/odfi-peoples-bank-2026-originators-newsletter.txt",
     "The Company Entry Description field must contain PAYROLL, all capitalized", "and other similar types of compensation."),
    ("verify-with-contact-on-file", "ach/odfi-peoples-bank-2026-originators-newsletter.txt",
     "If a long-time Receiver unexpectedly sends new account details", "without relying on the contact information included in the request."),
    ("noc-no-new-authorization", "ach/odfi-peoples-bank-2026-originators-newsletter.txt",
     "By complying with the NOC, your", "without having to obtain a new authorization."),
    ("fedach-saturday-sunday", "ach/frbservices-holiday-schedule.txt",
     "*For holidays falling on Saturday, Federal Reserve Banks and Branches will be open the preceding Friday.",
     "Federal Reserve Banks and Branches will be closed the following Monday."),
    ("plaid-same-day", "ach/plaid-auth-same-day-micro-deposits.txt",
     "Behind the scenes, Plaid sends a micro-deposit to the user's account", "post within one to two business days."),
    ("sao-verify-by-phone", "ach/wa-sao-vendor-master-file.txt",
     "It's critical to independently verify any requests to change vendor information", "known, reliable and already on file."),
    ("sao-segregate-duties", "ach/wa-sao-vendor-master-file.txt",
     "Just like payroll clerks should not be able to add new employees", "change vendor information in the vendor master file."),
    ("callback-manipulation", "ach/disbursementcontrols-vendor-contact-change-risk.txt",
     "Many organizations use callback procedures to validate banking changes", "may unknowingly validate fraudulent changes with the attackers themselves."),
    ("wac-087-five-years", "state-wa/wac-314-55-087.txt",
     "(1) Cannabis licensees are responsible to keep records", "if requested by an employee of the LCB:"),
    ("wac-087-employee-records", "state-wa/wac-314-55-087.txt",
     "(e) All employee records to include", "and date of hire;"),
    ("rcw-1-80-040-agreement", "state-wa/rcw-1.80.040.txt",
     "(2) This chapter applies only to transactions between parties", "including the parties' conduct."),
    ("rcw-1-80-060-signature", "state-wa/rcw-1.80.060.txt",
     "(1) A record or signature may not be denied legal effect", "an electronic signature satisfies the law."),
    ("rcw-1-80-080-attribution", "state-wa/rcw-1.80.080.txt",
     "(1) An electronic record or electronic signature is attributable to a person", "was attributable."),
    ("usc-7001-a", "federal/usc-15-7001.txt",
     "(1) a signature, contract, or other record relating to such transaction", "was used in its formation."),
    ("usc-7006-5", "federal/usc-15-7006.txt",
     "The term \u201c electronic signature \u201d means", "with the intent to sign the record."),
]


def flat(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main() -> None:
    out = {}
    bad = []
    for qid, f, start, end in SPECS:
        t = flat(open(ROOT + f, encoding="utf8").read())
        a = t.find(flat(start))
        if a < 0:
            bad.append(f"{qid}: start not found in {f}")
            continue
        b = t.find(flat(end), a)
        if b < 0:
            bad.append(f"{qid}: end not found in {f}")
            continue
        out[qid] = {"file": f, "quote": t[a : b + len(flat(end))]}
    if bad:
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

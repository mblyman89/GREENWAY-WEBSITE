#!/usr/bin/env python3
"""One-shot R41 S8 edit: add the four yearly Timberland tasks to ach-calendar-core.ts.
Idempotent (refuses to run twice). Kept for the record of how the edit was made."""
from pathlib import Path

p = Path(__file__).resolve().parents[2] / "src/lib/payments/ach-calendar-core.ts"
s = p.read_text(encoding="utf8")
if "timberland_schedule_f_selfcheck" in s:
    raise SystemExit("already applied")

old = '''  | "timberland_countersigned_copy";
'''
new = '''  | "timberland_countersigned_copy"
  // R41 S8: yearly Timberland re-checks (plan S8; the Schedule F self-check is plan S10 item 5, done early)
  | "timberland_agreement_reread"
  | "timberland_limits_reconfirm"
  | "timberland_name_id_reconfirm"
  | "timberland_schedule_f_selfcheck";
'''
assert s.count(old) == 1
s = s.replace(old, new)

A = "ach/timberland-ach-agreement-2026-10-09.redacted.txt"
B = "ach/timberland-brenda-2026-10.txt"
tasks = '''  // R41 S8: yearly Timberland re-checks. Each quote is checked against its mirror by tests.
  {
    id: "timberland_agreement_reread",
    cadence: "annual",
    title: "Year-end: re-read the Timberland ACH agreement",
    why: "Section 28 lets Timberland change the agreement by notice, and a change takes effect when you receive it. Once a year, make sure the copy you follow is the current one, and re-read the parts that decide who pays when something goes wrong (sections 11, 17, 18, 21, 23 and 25 and Schedule F are in the Legal library, word for word).",
    steps: [
      "Ask Timberland whether any amendment or fee notice was sent this year. Read any you find.",
      "Open the Legal library and re-read the Timberland agreement entries.",
      "If anything changed, tell your developer so the app follows the new terms. Then press \\"Done\\" for the year.",
    ],
    href: "/admin/settings/banking/library#timberland",
    hrefLabel: "Open the agreement entries",
    lawIds: ["timberland-s25-liability", "timberland-s11-indemnity"],
    quote: {
      text: "Such amendments shall become effective upon receipt of notice by Company or such later date as may be stated in Financial Institution's notice to Company.",
      file: "AFILE",
    },
  },
  {
    id: "timberland_limits_reconfirm",
    cadence: "annual",
    title: "Year-end: re-confirm the Timberland limits",
    why: "The app refuses any file over Timberland's limits (Schedule C): $50,000 per file and per day, $100,000 per month. If Timberland changed a limit and the app did not, a payroll could be refused at the bank on payday, or the app could hold back a file the bank would take.",
    steps: [
      "Ask Timberland to confirm the daily and monthly credit limits on file for Greenway.",
      "Compare them with the room-left card on the Guide.",
      "If they differ, tell your developer before the next payroll. Then press \\"Done\\" for the year.",
    ],
    href: "/admin/settings/banking/guide",
    hrefLabel: "Open the Guide (room left)",
    lawIds: [],
    quote: {
      text: "Maximum monthly aggregate limit of all credit files .......... $100,000.00",
      file: "AFILE",
    },
  },
  {
    id: "timberland_name_id_reconfirm",
    cadence: "annual",
    title: "Year-end: re-confirm the company name and ID Timberland matches",
    why: "Brenda matches fields in every file to her setup: the company name (GREENWAY MARIJUA, all that fits) and the Company ID (1 plus the EIN). If either changes on her side or ours, files stop matching.",
    steps: [
      "Open My banking and look at What Timberland sees.",
      "Ask Timberland to confirm the company name and Company ID on its side still match.",
      "Press \\"Done\\" for the year.",
    ],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
    quote: {
      text: "There are 3 parameters I need to have match my side.",
      file: "BFILE",
    },
  },
  {
    id: "timberland_schedule_f_selfcheck",
    cadence: "annual",
    title: "Year-end: Schedule F security self-check",
    why: "Schedule F makes Greenway responsible for its own computers and codes. If a password, phone or token may be stolen, phone Timberland at once and confirm in writing within 1 calendar day.",
    steps: [
      "The computer you upload from uses a private, secured internet connection (not public Wi-Fi).",
      "It has anti-virus, anti-spyware and a firewall turned on.",
      "Your phone for the text code (or the token) is safe and only yours. The Timberland user list is still Michael only.",
      "If a code may be stolen: phone Timberland at 1-800-562-8761 at once, then confirm in writing within 1 calendar day.",
      "Press \\"Done\\" for the year.",
    ],
    href: "/admin/settings/banking/library#law-timberland-schedule-f-notice",
    hrefLabel: "Read Schedule F",
    lawIds: ["timberland-schedule-f-notice"],
    quote: {
      text: "Timberland Bank requires companies\\u2019 use of a private secured internet connection and a network that is protected by Anti-virus, Anti-spyware, and a Firewall on all company computers that will be originating ACH files.",
      file: "AFILE",
    },
  },
];
'''.replace("AFILE", A).replace("BFILE", B)

marker = "\n];\n"
i = s.find(marker, s.find("export const ACH_CAL_TASKS"))
assert i > 0
s = s[:i] + "\n" + tasks + s[i + len(marker):]
p.write_text(s, encoding="utf8")
print("applied")

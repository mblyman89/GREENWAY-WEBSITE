# ACH authority mirror (R39)

Text mirrors fetched 2026-10-10 (UTC) for the R39 ACH integration. Each file
is the page's visible text (HTML stripped with BeautifulSoup, PDFs with
`pdftotext -layout`). Nothing was retyped by hand.

The Nacha Operating Rules book itself is copyrighted and sold by Nacha, and is
NOT mirrored here. Where a rule is cited, the source is Nacha's own public
rule pages or an ODFI's published summary of the Rules. A bank summary is
labelled as one; it is not the rule text.

| file | source URL | what it supports |
| --- | --- | --- |
| nacha-micro-entries-phase-1.txt | https://www.nacha.org/micro-entries | Micro-entry definition (< $1 credit), `ACCTVERIFY` description, fraud monitoring of micro-entries |
| nacha-fraud-monitoring-phase-2.txt | https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2 | June 19 / 22, 2026 fraud monitoring for all non-consumer Originators; "change controls regarding payment information and instructions for vendor and payroll payments"; annual review; False Pretenses |
| nacha-meaningful-modernization.txt | https://www.nacha.org/rules/meaningful-modernization | "Only consumer debit authorizations require a writing that is signed or similarly authenticated" |
| odfi-campus-federal-originator-responsibilities-2024.txt | https://www.campusfederal.org/uploads/docs/brochures/CFCU-Originator-Responsibilities-2024.pdf | ODFI summary: prenote wait 3 banking days; authorization kept 2 years from termination/revocation; NOC within 6 banking days |
| odfi-simmons-ach-origination-guidelines.txt | https://www.simmonsbank.com/siteassets/pdfs/qrg-ach-origination-guidelines.pdf | ODFI summary: prenotes are zero-dollar entries, do not validate ownership; NOC codes |
| odfi-access-united-nacha-updates-2024.txt | https://www.accessunited.com/assets/files/84KFPs67 | ODFI summary: prenotes optional; authorization retention 2 years following termination or revocation |
| odfi-tompkins-originator-requirements.txt | https://www.tompkinsbank.com/assets/files/Gdhq0onu | ODFI summary: retention, NOC 6 banking days |
| odfi-peoples-bank-2026-originators-newsletter.txt | https://www.mypeoples.bank/uploads/userfiles/files/documents/2026%20Originators%20newsletter.pdf | 2026 PAYROLL description; verify account changes by calling the number on file; return codes R23/R29 |
| frbservices-holiday-schedule.txt | https://www.frbservices.org/about/holiday-schedules | FedACH holidays 2026-2030 (banking-day math) |
| plaid-auth-same-day-micro-deposits.txt | https://plaid.com/docs/auth/coverage/same-day/ | Plaid same-day micro-deposits post in one to two business days |
| odfi-first-citizens-nacha-file-specs.txt | https://www.firstcitizens.com/content/dam/firstcitizens/pdfs/commercial/commercial-advantage/nacha-file-specs.pdf | ODFI file spec (Rev 02/2024): transaction codes 22/32 live credits, 23/33 prenote credits (cross-checked against Hancock Whitney's NACHA-FORMAT.pdf, same codes) |
| odfi-grand-valley-prenote-waiting-period.txt | https://www.grandvalleybank.com/assets/files/ip5QIqAu | ODFI summary of the 2014 rule that cut the prenote wait from six to three banking days; return/NOC by opening of business on the second banking day |
| wa-sao-vendor-master-file.txt | https://sao.wa.gov/the-audit-connection-blog/protect-your-vendor-master-file-fraudsters | WA State Auditor: verify changes by phone with contact info already on file |
| disbursementcontrols-vendor-contact-change-risk.txt | https://www.disbursementcontrols.com/vendor-contact-change-risk | Callback manipulation: a changed phone number redirects the callback |

Also mirrored in this round:

- `../state-wa/rcw-1.80-ueta.txt`: RCW 1.80 (WA Uniform Electronic Transactions Act), https://app.leg.wa.gov/RCW/default.aspx?cite=1.80&full=true
- `../state-wa/wac-314-55-087.txt`: WAC 314-55-087 (five-year records), https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087
- `../federal/usc-15-7001.txt` and `usc-15-7006.txt`: E-SIGN Act, https://www.law.cornell.edu/uscode/text/15/7001 and /7006

## Not found as a published standard (rule 2: said plainly, not invented)

- **A contact-change look-back window (Q13).** No regulator, Nacha page or
  ODFI summary found in this round publishes a number of days. IOFM's Vendor
  Master File expert answered the related question "hold payment for 30 days
  after a banking change?" with "There is no industry standard for holding
  payments" (member-only page; the visible part was read 2026-10-10:
  https://www.iofm.com/ask-the-expert/vendor-banking-change-safeguards-and-payment-hold-guidelines).
  The window chosen in R39 is therefore a Greenway POLICY, labelled as one,
  not a cited rule.

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
| nacha-micro-entries-phase-2.txt | https://www.nacha.org/rules/micro-entries-phase-2 | Micro-entry Phase 2 (fetched 2026-10-11 for R39 S7): Originators monitor micro-entry forward and return volumes; velocity of account-number reuse; no entry-by-entry review required |
| nacha-fraud-monitoring-phase-2.txt | https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2 | June 19 / 22, 2026 fraud monitoring for all non-consumer Originators; "change controls regarding payment information and instructions for vendor and payroll payments"; annual review; False Pretenses |
| nacha-meaningful-modernization.txt | https://www.nacha.org/rules/meaningful-modernization | "Only consumer debit authorizations require a writing that is signed or similarly authenticated" |
| odfi-campus-federal-originator-responsibilities-2024.txt | https://www.campusfederal.org/uploads/docs/brochures/CFCU-Originator-Responsibilities-2024.pdf | ODFI summary: prenote wait 3 banking days; authorization kept 2 years from termination/revocation; NOC within 6 banking days |
| odfi-simmons-ach-origination-guidelines.txt | https://www.simmonsbank.com/siteassets/pdfs/qrg-ach-origination-guidelines.pdf | ODFI summary: prenotes are zero-dollar entries, do not validate ownership; NOC codes |
| odfi-access-united-nacha-updates-2024.txt | https://www.accessunited.com/assets/files/84KFPs67 | ODFI summary: prenotes optional; authorization retention 2 years following termination or revocation |
| odfi-tompkins-originator-requirements.txt | https://www.tompkinsbank.com/assets/files/Gdhq0onu | ODFI summary: retention, NOC 6 banking days |
| odfi-peoples-bank-2026-originators-newsletter.txt | https://www.mypeoples.bank/uploads/userfiles/files/documents/2026%20Originators%20newsletter.pdf | 2026 PAYROLL description; verify account changes by calling the number on file; return codes R23/R29 |
| frbservices-holiday-schedule.txt | https://www.frbservices.org/about/holiday-schedules | FedACH holidays 2026-2030 (banking-day math) |
| frbservices-edi-encrypted-email-guide.txt | https://www.frbservices.org/wp-content/uploads/edi-use-guide.pdf | Federal Reserve "Payments Reporter Encrypted Email User Guide" (Revised 06/26/24; fetched 2026-10-21 for R41 S13; PDF 21 pages, 1579415 bytes, sha256 a4204295adaa5515fdb5146c3a65b4c399abb3ff1666d6039ac9783acbddc63e; text by `pdftotext -layout`): ACH reports reach achedi.com, "where they are retained for 60 calendar days", then "automatically deleted"; "If you need to retain reports longer than 60 calendar days, you will need to download and store them elsewhere." The basis for the S13 "download within 60 days" clock |
| nacha-r90-sanctions-return-code.txt | https://www.nacha.org/rules/new-return-reason-code-sanctions-compliance-obligations | Nacha's rule page (fetched for R41 S15; visible text by BeautifulSoup): "R90 (Entry Returned Due to RDFI's Sanctions Compliance Obligations) will be added to the return reason code table", effective March 17, 2028; R16 reverts to "Account Frozen"; the RDFI returns within two banking days of its sanctions determination. The source of the R90 label in `ACH_CODES` |
| plaid-auth-same-day-micro-deposits.txt | https://plaid.com/docs/auth/coverage/same-day/ | Plaid same-day micro-deposits post in one to two business days |
| odfi-first-citizens-nacha-file-specs.txt | https://www.firstcitizens.com/content/dam/firstcitizens/pdfs/commercial/commercial-advantage/nacha-file-specs.pdf | ODFI file spec (Rev 02/2024): transaction codes 22/32 live credits, 23/33 prenote credits (cross-checked against Hancock Whitney's NACHA-FORMAT.pdf, same codes) |
| odfi-hometrust-ach-format-2023.txt | https://htb.com/wp-content/uploads/2023/02/HomeTrust-Bank-ACH-Format-230207.pdf | ODFI file spec (fetched 2026-10-14 for R41 S3): File ID Modifier, "The first file of the day should have an upper case 'A' in this field. If a second file is submitted on the same day, the field should contain an upper case 'B', etc." (A-Z or 0-9). A bank summary, not the rule text |
| odfi-banc-of-california-nacha-file-format.txt | https://dam.bancofcal.com/m/5ec324636794be06/original/UG32-NACHA-File-Format-Specifications.pdf | ODFI file spec (fetched 2026-10-14 for R41 S3): File ID Modifier "Provides means for an originator to distinguish between files created on the same date. Format: Uppercase A-Z or the numbers 0-9. This field cannot be left blank." A bank summary, not the rule text |
| odfi-grand-valley-prenote-waiting-period.txt | https://www.grandvalleybank.com/assets/files/ip5QIqAu | ODFI summary of the 2014 rule that cut the prenote wait from six to three banking days; return/NOC by opening of business on the second banking day |
| wa-sao-vendor-master-file.txt | https://sao.wa.gov/the-audit-connection-blog/protect-your-vendor-master-file-fraudsters | WA State Auditor: verify changes by phone with contact info already on file |
| disbursementcontrols-vendor-contact-change-risk.txt | https://www.disbursementcontrols.com/vendor-contact-change-risk | Callback manipulation: a changed phone number redirects the callback |
| unc-finance-safely-updating-vendor-bank-accounts.txt | https://finance.unc.edu/news/2020/06/15/safely-updating-vendor-bank-accounts | University AP policy (fetched 2026-10-10 for R39 S3): validate bank details verbally, in person or by phone to an independently sourced number; the basis for the in-person release method |
| wa-sao-ach-best-practices.txt | https://sao.wa.gov/sites/default/files/2023-05/Best-practices-for-ACH-electronic-payments.pdf | WA State Auditor PDF (fetched 2026-10-14 for R41 S0; PDF sha256 0a40baa0...; metadata CreationDate 2026-06-10): "Management should review and approve verification documentation before anyone makes system changes"; "Require approvals or notifications of changes"; "Review all payee account changes"; the basis for the admin-request / owner-approval rule |
| timberland-ach-agreement-2026-10-09.redacted.txt | Provided by the owner on 2026-10-14 (not a public URL): Signed_ACH_Origination_Agreement.pdf, 12 pages, Epson ScanSmart scan, PDF sha256 302132a284ad0ebfc83c3bbf6aa77fe002141b7ec8646efa4fd2bea129158ce4 | R41 S1: Timberland Bank's ACH Origination Agreement, company-signed 10/09/26 (bank countersignature not on this copy). OCR (tesseract) at 200 and 400 dpi, every disagreement settled by viewing the page image; the form pages are a hand transcription read from the images. REDACTED for this public repo: account shown as [ACCOUNT ENDING 6048], personal phones and emails removed, signatures not reproduced. The PDF itself is NOT committed. Source of every contract quote in `src/lib/payments/timberland-profile-core.ts` |
| timberland-brenda-2026-10.txt | Provided by the owner (pasted into the developer chat, on or before 2026-10-13) | R41 S1: Brenda's (Timberland Cash Management) two emails, verbatim: Company Name `GREENWAY MARIJUA`, Company ID `1 + EIN`, routing 325170754, unbalanced batches, 4 pm upload and approval, 6 banking-day prenote wait, $50,000 per transaction / $100,000 per month, no call-backs, no duplicate-file check. Source of every Brenda quote in `timberland-profile-core.ts` |
| timberland-ach-agreement-2026-10-14.redacted.txt | Provided by the owner in R41 round 13 (not a public URL): ACH_Agreement_10-14-26.pdf, 12 pages, SAVIN MP C501 scan, PDF sha256 5cbcc523f766552c7d798ac85f87239ef79070688c6738d2bf416578ab63b0b3 | R41 S12: the COUNTERSIGNED agreement (company 10/13/26, Timberland Bank 10/14/26, signed for the bank by Brenda, Cash Management). Printed terms are the same as the 10/09 copy; the body was carried over from the proofread 10/09 mirror and diffed word by word against two fresh OCR passes (200 and 400 dpi) of this scan, every difference settled on the page image. REDACTED like the 10/09 mirror; signatures not reproduced; the bank signer's surname not used. The PDF itself is NOT committed. Source of every contract quote in `src/lib/payments/timberland-profile-core.ts` from S12 on (the 10/09 mirror is kept as history) |
| timberland-brenda-2026-10-19-email-3.txt | Provided by the owner (pasted into the developer chat, Round 13, 2026-10-19) | R41 S12: Brenda's (Timberland Cash Management) Email 3, her answers to our 21 remaining questions plus items A and B, verbatim (typos kept), with a numbering map to our Q ids. REDACTED: the Company ID (1 + EIN) and the two spellings of the email domain. Source of every answered-question quote in `timberland-profile-core.ts` |

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

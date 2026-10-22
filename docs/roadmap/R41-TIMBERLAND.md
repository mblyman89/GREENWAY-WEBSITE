# R41 - Timberland Bank ACH origination, built to the signed agreement

Plan: the R41 Timberland slice plan (v4), kept by the owner outside this public repository. Every term the code
enforces is quoted word for word in `src/lib/payments/timberland-profile-core.ts`, each quote with its page and section, from
two mirrors in `docs/authorities/ach/`. The first is the signed ACH Origination Agreement: a redacted text copy that carries the
sha256 of the owner's PDF. The second is Brenda's emails, also redacted.

## Owner request (summary)

Wire Greenway's ACH payroll and vendor payments to the agreement Michael signed with Timberland Bank on 10/09/26. Do not
guess anything: where the contract, Brenda's emails and Nacha disagree, use the strictest reading and ask Brenda (one email,
sent by Michael at the end of the build). The owner acts alone; an admin's request waits for the owner's approval.

## Status

| Slice | What | PR | Migration |
|---|---|---|---|
| S0 | Owner acts alone; admin requests need owner approval | #1372 | 0271 |
| S1 | Timberland profile: every term with its verbatim quote; redacted agreement and Brenda mirrors | #1373 | none |
| S2 | Originator validation, the SEC allowlist, "What Timberland sees" card | #1374 | 0272 |
| S3 | Released ACH file ledger: release once, stored bytes with SHA-256, File ID Modifier, void | #1375 | 0273 |
| S4 | Timberland limits as hard blocks (entry, file, daily in-process, monthly) and the room-left bars | #1377 | none |
| S5 | Deadline: 2 banking days before the effective date, 4 pm Pacific, holidays move earlier | #1378 | none |
| S6 | Owner-only "Mark uploaded" / "Mark approved" at Timberland; honest dual-approval wording | #1380 | 0274 |
| S7 | Section 6 prenote wait (6 banking days from settlement) and the first-file gate | #1381 | 0275 |
| S8 | Docs, help, concierge, test plan, yearly tasks, agreement entries in the Legal library | #1382 | none |
| S9 | Get rolling: go-live readiness board, file checker, funding helper (owner confirms funding; 8 am settlement-day reminder) | #1383 | 0276 |
| S10 | Obligation clocks: Timberland communications log, what is due to Timberland, STOP card on every banking page, fees card | #1384 | 0277 |
| S11 | Sanctions screening: daily OFAC check of every payee, possible-match review, never a payment gate; vendor follow-up list collapsible and searchable | #1385 | 0278 |
| S12 | Brenda's answers: countersigned agreement and Email 3 mirrored; the open questions became an answered record; D-3, D-5, D-7 built; wording | #1444 | none |
| S13 | Notices and corrections: wrong-NOC clock (15 days), OFAC notice from Timberland, bank report download clock (60 days); reversal call sheet from the stored file | #1445 | 0287 |
| S14 | Nacha yearly obligations: written fraud procedure tied to the Phase 2 text with a risk assessment, yearly review record (who and when), segregation-of-duties report, printable packet | #1446 | 0288 |
| S15 | Leftovers without guessing: R90 return code from a new Nacha mirror; stale mutation anchor re-anchored | #1447 | none |
| S16 | Bank watch: the Plaid feed on the Main account checked daily against ACH files, books, Timberland fees, known payees and reviews; possible returns; fee/notice gaps; feed health; daily email; Plaid balance hint on the funding box | #1448 | 0289 |
| S17 | Notice email: optional hourly watch (off by default) for the Fed's encrypted ACH notice emails in the Workspace mailbox the CCRS monitor reads; encrypted store, sender/DMARC/link checks, owner alert, mark once; daily portal checklist | #1449 | 0290 |
| S18 | Written ACH policies (8, each quoted to the State Auditor or the Timberland agreement), quarterly access review, yearly key checks, owner-only dated records, printable packet | #1450 | 0291 |
| S19 | Bank setup & glossary: the bank-side checklist for the meeting with Brenda (ask / owner decides / confirmed, each in her words; ACH debit block and ACH filter asked, not assumed), printable meeting sheet, 20-term sourced ACH glossary, glossary-backed hover help on Operations and Approvals | (this PR) | none |

Round 9 (between S5 and S6) added Reports, then ACH Payments (#1379).

## S8 in detail

- **Open questions.** `OPEN_QUESTIONS` gains:
  - Q15: one settlement debit per file, or one per payment.
  - Q18: do test credits under $1 count toward the limits? The strict default is that they count.
  - Q20: Timberland's 6 banking days, or Nacha's 3?

  Q16, Q17 and Q19 are not added because Brenda's second email already answers them (her answers 8, 9 and 7).
- **Q14 (PAYROLL in the discretionary data).**
  - `PAYROLL_BATCH_DISCRETIONARY_DATA` in `nacha-core.ts` is blank by default. Batch header positions 21-40 use it only for PPD batches whose entry description is `PAYROLL`.
  - If Brenda says yes, the change is one line, and a self-test pins the blank default.
- **Nacha's 3 vs Timberland's 6.** The 2014 Nacha rule change is quoted from the official Federal Register text: `docs/authorities/ach/fr-2017-19135-prenote-three-banking-days.txt` (82 FR 42597, FR Doc 2017-19135, govinfo.gov).
  - The govinfo page re-scrambles its e-mail links on every fetch. The mirror therefore records a reproducible fingerprint of the page text, not only the raw HTML hash.
  - The app keeps the signed contract's 6 days until Timberland answers Q20.
- **Calendar (`ach-calendar-core.ts`).** Four yearly tasks, each with a verbatim quote that is checked against its mirror:
  - re-read the agreement (section 28 lets Timberland amend it by notice);
  - re-confirm the Schedule C limits;
  - re-confirm the company name and ID Timberland matches;
  - the Schedule F security self-check.

  The self-test floor goes from 32 to 35.
- **Legal library.** It gains a new entry kind, `agreement`, with seven entries cut mechanically by `scripts/r40/gen-legal-library.py` from the redacted mirror:
  - section 25 (liability);
  - section 11 (indemnity);
  - section 18 (no right to cancel);
  - section 21 (reversals);
  - section 23 (paid by account number);
  - section 17 (30 days);
  - the Schedule F notice.

  The page has a `#timberland` section. These entries have no public URL. Their source says "private:" and is never rendered as a link. The test checks the mirror's PDF sha256 header instead of an official host.
- **"How Greenway protects you" lines** say only what the code does, checked against the code. Examples:
  - Voiding a file cannot pull back a file already at the bank (0273 allows voiding after upload), so the §18 entry says to phone Timberland.
  - Vendors are verified by a call-back, not a prenote (`vendor-ach-enrollment-core.ts`), and the §23 entry says so.
- **Help and concierge** describe the new section and the four tasks.
- **TEST-PLAN** T-359 to T-361; the manual is rebuilt.

## Honest limits

- The first-file gate (S7) is enforced in the app's release path, not by a database trigger. The 0275 floor in the database only guards the prenote record's dates.
- The signed PDF is not in this repository; the repository is public. Anyone holding the PDF can prove the mirror came from it with `sha256sum`.

## Held for the end of the build

Michael sent Brenda the questions (Q1, Q3 to Q15, Q18, Q20, Q21 to Q26). She answered them in Email 3 (10/19/26),
mirrored in `docs/authorities/ach/timberland-brenda-2026-10-19-email-3.txt`. S12 records each answer word for word.
Still to arrange: the testing session Brenda asked for.

## S9 in detail

- **Go-live readiness board** (Guide, `#go-live`). It has 14 gates, each green, red, information or "could not be read", with a deep link to the exact place to fix it.
  - `timberland-golive-core.ts` (43 self-tests) builds the board; `timberland-golive-store.ts` reads it.
  - A failed read is never green. The owner-inbox read is strict: the nav badge's reader turns errors into zero, so the board uses its own.
  - The access gate enforces only what code can know: exactly one active owner, and ACH roles exactly owner and admin. It lists every person with ACH access by name so Michael can check the list himself.
  - Dual approval at Timberland is information only.
  - The board never blocks paying by check.
- **File checker** (Banking > File checker). You pick the downloaded `.ach` file (read byte for byte) or paste it, and it runs the 98-rule `timberland-file-checker-core.ts` against the real company settings, the ledger fingerprint and the limits.
  - It stores nothing. The audit row `ach.file.checked` holds only the sha256 and the rule ids.
  - The practice run builds a $0 two-prenote file from the real settings, checks it, and never saves it.
- **Funding helper.**
  - Agreement section 14: "Company shall provide Financial Institution with immediately available funds not later than 9:00 a.m. PST on each Settlement Date".
  - `timberland-funding-core.ts` (64 self-tests) shows the file total and Timberland's $50.00 monthly fee (Schedule B) as fixed lines; any extra cushion is the owner's own choice.
  - Migration 0276 adds `ach_file_confirm_funding`, a new gated kind `ach_file.confirm_funding`:
    - owner only;
    - set once;
    - released or uploaded files only;
    - at least the file total.
  - A confirmation records what the owner saw; it never blocks an upload.
  - The cron `/api/cron/ach-funding-8am` (15:00 and 16:00 UTC) emails at 8:00 am Pacific on each file's settlement day, even for confirmed or bank-approved files ("still there at 9:00").
- **Tests.**
  - `tests/compliance/r41-s9-get-rolling.test.ts` covers:
    - quotes against the mirror;
    - the real stores and cron route over FakePostgrest;
    - every board deep link resolving to a real page and anchor.
  - Mutation runs: `mutate-s9-app.py` (19 of 19 killed) and `mutate-0276-sql.py` (12 of 12 killed).
  - Manual tests T-362 to T-364.

## S10 in detail

- **Timberland communications log** (migration 0277, `ach_timberland_comms`). It is append-only: Timberland's notices and Greenway's own calls are logged as rows, and an item is closed by adding a `done` row that names it.
  - The guard trigger enforces:
    - inserts only (no update or delete);
    - the owner as the writer;
    - a date no more than 400 days old and not in the future;
    - a time for calls and reversals, an amount for reserve and over-limit requests, and a second date where the clock needs one;
    - no run of 7 or more digits in the note, so no account numbers;
    - each item closed once, and never before it arrived.
  - Grants: the browser can only read; the server can read and insert. UPDATE, DELETE and TRUNCATE are revoked from service_role explicitly, because Supabase grants them on new public tables by default (supabase.com/docs/guides/api/securing-your-api).
  - Two new gated kinds: `timberland_comms.log` and `timberland_comms.done`. An admin's entry becomes a request that Michael approves; the done request goes stale once the item is closed.
- **What is due to Timberland** (Operations, `#clocks`). `timberland-obligations-core.ts` (69 self-tests) turns the log and the returns and corrections into clocks, each with the contract section and its words quoted verbatim from the mirror. Examples:
  - section 21 reversal (strict: the earlier of 24 hours and 4:00 pm Pacific on the 5th banking day after settlement; phone Timberland, because the setup has no debit files);
  - the Schedule F written confirmation within 1 calendar day of a compromise call;
  - section 7 bank corrections (strict "earlier" reading; Brenda question);
  - the 30 days in section 17 to report a statement problem;
  - reserve demands, amendment and fee notices, over-limit requests, pre-funding and termination.

  A failed read never says "Nothing is due to Timberland right now."
- **STOP card** on every banking page (banking/layout.tsx, ACH roles only). It has:
  - the agreement's phone number as a tel: link;
  - when to phone;
  - the contract words on no cancelling and reversals;
  - a ready-to-send written confirmation letter;
  - the $25.00 lost token fee.

  A termination notice in the log shows a red banner on every banking page.
- **Fees card** (Schedule B). It shows $50.00 a month plus $5.00 per return or correction logged this month, and the $24.00 yearly Nacha CD. If the count cannot be read, no total is shown.
- **Go-live board.** Logged facts (countersigned, Schedule G email corrected, access ready, dual approval on) count as well as the calendar. A failed log read adds nothing.
- **Tests.**
  - `tests/compliance/r41-s10-obligations.test.tsx`.
  - Mutation runs: `mutate-s10-app.py` (25 of 25 killed) and `mutate-0277-sql.py` (15 of 15 killed). The SQL run simulates Supabase's default privileges, so removing the revoke is caught.
  - Manual tests T-365 to T-367.

## S11 in detail

- **Why.** Timberland ACH agreement, section 3: "It shall be the responsibility of Company to obtain information regarding such OFAC enforced sanctions." The owner's rule: strict is fine, but it must never block paying vendors or employees.
- **Never a payment gate.** Payroll, the vendor file builder and the file checker never import the screening module or read its tables.
  - A vitest pins the full list of files that mention them.
  - The pg-check asserts that no other database function reads them.
  - A possible match is a review item and an email, nothing more.
- **Source data.** OFAC's own published data files (SDN.CSV, ALT.CSV, CONS_PRIM.CSV, CONS_ALT.CSV), downloaded each morning.
  - The download sends a User-Agent header, as OFAC's 2024-05-16 technical notice requires.
  - SDN.CSV is checked against OFAC's published SHA-256 Digest when it is present; a mismatch refuses.
  - All four files are checked by structure: exact field counts, ASCII only, and the 0x1A end-of-file mark. A cut-short file refuses.
  - OFAC FAQ 287 says the search website "should not be utilized by automated systems", so the website is not used.
- **Scoring.** `ofac-screening-core.ts` (96 self-tests) follows FAQ 249:
  - Jaro-Winkler on the whole name;
  - per name part, Jaro-Winkler and Soundex (the NARA rules, mirrored);
  - the higher score kept.

  The threshold is 0.85. OFAC sets none: "OFAC cannot make such a recommendation because each search has its own unique set of facts surrounding it." Weak aliases and vessel or aircraft entries are not screened (data specification).
- **Who is screened.** Every active employee (HR and W-2 names) and every active vendor (display, legal and DBA names), plus the account-holder name on bank records and the payee name on ACH authorizations.
  - Reads are paged by id past PostgREST's 1,000-row cap (SLICE 5C).
  - An unfinished read fails the run rather than screening part of the list.
  - Measured against the 2026-10 lists: 39,117 names, about 84 ms per payee name.
- **Migration 0278.** All three tables are append-only, including TRUNCATE.
  - `ofac_screening_runs` and `ofac_screening_results` are written in one call, `ofac_record_run`. Results must belong to a successful run.
  - `ofac_match_reviews` takes one owner-stamped review per result.
  - A review's note must be 20 to 2,000 characters with no run of 7 or more digits.
  - service_role gets select and insert only; nothing is security definer.
  - A new gated kind, `ofac_review.record`: an admin's review becomes a request for Michael.
- **Review rules (OFAC FAQ 5).**
  - A "not a match" covers later screens only when every current match key (list entry plus payee name) was in that review. A new list entry or a new name asks again.
  - A true match stays red on every later screen.
- **Daily cron.** `/api/cron/ofac-screening` runs at 13:30 UTC (6:30 am PDT).
  - When something needs review, it emails Michael once whenever the set of matches changes, and again weekly while matches wait.
  - When a screen fails, it emails once per Pacific day.
  - Each email is claimed in `compliance_reminder_log` first; a failed send removes the claim.
  - The page warns when the last successful screen is 3 or more days old.
- **Vendor follow-up list (owner request).** On Banking > Vendors, "Vendors to follow up" is now a collapsible section, closed by default so the vault records are right below it; the browser remembers open or closed on that device. A search box filters by vendor name, status, next step or warning (every word must match; accents, case and apostrophes ignored), keeps the most-urgent-first order and shows "X of N shown". The list scrolls inside a fixed height. Nothing is written to the server.
- **Tests.**
  - `tests/compliance/r41-s11-ofac.test.tsx`, using real-format OFAC fixtures (real public records).
  - Mutation runs: `mutate-s11-app.py` and `mutate-0278-sql.py` (Supabase default privileges simulated).
  - Manual tests T-368 to T-371.

## S12 in detail

- **Sources.** Two new mirrors in `docs/authorities/ach/`:
  - the countersigned agreement (Greenway 10/13/26, Timberland 10/14/26), with the sha256 of `ACH_Agreement_10-14-26.pdf`. Its printed terms are the same as the 10/09 copy. Every citation now points at this copy.
  - Brenda's Email 3, with her answers kept word for word.
- **Answered record.** `OPEN_QUESTIONS` in `timberland-profile-core.ts` keeps its name but now holds, for each question, Brenda's verbatim answer(s), what the app does and, where she left a choice, the owner decision it rests on (D-1 to D-8). The owner did not answer D-1 to D-10 in Round 14, so the recommended defaults from the Round 13 report are applied:
  - **D-1** the 6-banking-day prenote wait stays.
  - **D-2** the 2-banking-day lead stays strict. The optional 1-day late lane is not built.
  - **D-3** the daily $50,000.00 limit counts files by the day they are uploaded. A file not yet marked uploaded counts on every day it could still be uploaded. The monthly limit still counts a file in both months when its days span two.
  - **D-5** the funding helper asks for the money by 9:00 am Pacific on the settlement date, and never to let the account go negative.
  - **D-6** the prenote wait is counted to the upload day.
  - **D-7** the Fridays before Saturday holidays are usable days.
  - **D-8** per-file match first, per-payment as a labelled fallback.
  - **D-9** "Brenda, Cash Management", no surname.
  - **D-10** a 15-calendar-day wrong-NOC clock (built in S13).
- **Wording.** The go-live board, calendar and guide show the countersigned copy as received and quote Brenda on Schedule G: "I have this correct in the system.  No need to correct document." Calls go to Cash Management at 1-800-562-8761. A reversal is done by Timberland from the original uploaded file. Q11: keep GREENWAY MARIJUANA in the file header. Q14: PAYROLL stays out of the discretionary data.
- **No migration.** `ach_files.uploaded_at` (0274) already records the upload.
- **Tests.** Pure self-test floors: profile 44, deadline 74, limits 69, funding 65. Mutation scripts s1, s4, s5 and s8 are updated and rerun. Manual test T-372.

## S13 in detail

- **Three new log types (migration 0287).** On Operations, "Log a message from Timberland" now offers:
  - **"A bank correction (NOC) looks wrong"**: a clock 15 calendar days from the day the correction arrived (section 7; Brenda, Email 3 answer 18: "this would have to be rejected by the 15th day per the rules."). The site does not build a Refused NOC; the clock says to contact Cash Management (1-800-562-8761) and ask how they want it rejected (D-10). The refuse-by line under every bank correction now says the same, instead of "in writing".
  - **"Timberland told me about a possible OFAC match"**: Brenda, answer 21: "Yes we screen for OFAC for each person contained in a file.  Cash Management would let you know." No deadline in the agreement, so the item is red and stays open until Cash Management says it is resolved. Our own daily screening (S11) keeps running.
  - **"A return or correction report arrived"**: a clock 60 calendar days from arrival to download it. Source: the Federal Reserve's "Payments Reporter Encrypted Email User Guide" (Revised 06/26/24), newly mirrored as `docs/authorities/ach/frbservices-edi-encrypted-email-guide.txt`: "Reports are retained in the portal for 60 calendar days and then automatically deleted."
- **Reversal call sheet.** Each file marked uploaded or approved on Operations has a "Reversal call sheet" link (`/admin/settings/banking/files/[id]/reversal-sheet`). It is plain text built from the exact stored bytes, after the fingerprint and header facts are re-checked. It shows the file name, file date and File ID Modifier, effective and settlement dates, upload time, number of payments, total, SHA-256, and every payment with name, amount and trace number. It never shows an account or routing number. Brenda, answer 7: the reversal "will be completed using the original uploaded file". Owner or admin only, audited, never cached.
- **Not built (no guessing):**
  - **Upload receipt field.** Brenda has not said the portal shows a confirmation number.
  - **Attaching the downloaded report to its entry.** The download clock is built; storing the report file needs a format and a storage decision.
  - **Reading notices automatically.** Needs one real or sample notice.
- **Tests.**
  - `tests/compliance/r41-s13-notices.test.ts`.
  - Pure self-test floors: obligations 78 (was 69); new `ach-reversal-sheet-core` 15.
  - Mutation runs: `mutate-0287-sql.py` (14 mutants plus two probes: the check fails on the 0277 state, and the rollback refuses while a new-type row exists) and `mutate-s13-app.py`.
  - Manual test T-373.

## S14 in detail

- **Yearly review page** (`/admin/settings/banking/yearly-review`, new "Yearly review" tab). Owner or admin can open it; only the owner records.
  - **The rule.** Nacha Fraud Monitoring Phase 2 quoted word for word from `docs/authorities/ach/nacha-fraud-monitoring-phase-2.txt` (written, risk-based procedures; reviewed "at least annually"; False Pretenses).
  - **The written procedure.** The same 12 items as the Calendar (`ACH_FRAUD_PROCEDURE`), each with where the software enforces it.
  - **Risk assessment.** Seven kinds of payment or change, each marked higher, lower or very low risk, why, and which procedure items cover it. These levels are Greenway's own assessment (Nacha does not prescribe one); the owner confirms them each year.
  - **Who did what (segregation of duties).** Owner only, because it reads the Security Log (as /admin/audit). Who holds owner or admin and their last sign-in; every ACH action in the Pacific year by person; every approval request and its outcome; findings (no active owner, more than one owner, an inactive admin, unattributed actions, an action by someone without owner or admin, a request decided by the person who asked, apply errors, requests still waiting, stop actions not checked off). Every read is paged; a partial read shows an error, never a partial report.
  - **Record the review (migration 0288).** Outcome, summary, two confirmations. One per year; a second press records a correction. Recording this year's review marks the Calendar task "Year-end: review the ACH fraud procedure" done for the year, and that task now links here.
  - **Packet** (`yearly-review/packet?year=`): plain text, sections 1 to 5 (section 5, who did what, only for the owner). Audited, never cached, no account numbers.
- **Tests.**
  - `tests/compliance/r41-s14-yearly.test.ts`.
  - New pure self-test `ach-yearly-review-core` 47.
  - Mutation runs: `mutate-0288-sql.py` (22 mutants plus two probes) and `mutate-s14-app.py`.
  - Manual test T-374.

## S15 in detail

- **R90 return code.** Nacha's rule page is newly mirrored as `docs/authorities/ach/nacha-r90-sanctions-return-code.txt`. It says: "R90 (Entry Returned Due to RDFI’s Sanctions Compliance Obligations) will be added to the return reason code table." The rule takes effect March 17, 2028.
  - `ACH_CODES` gains R90 with that title. It is the first code whose label comes from a mirror other than the bank newsletter, so `ACH_CODE_SOURCE` names the file and a test re-finds the label there.
  - Logging an R90 holds the payee as a possible-fraud return. The plain text says not to resend and to call Cash Management (1-800-562-8761) and an attorney, because Nacha says the bank works out the next steps "working with its client".
  - The rule watch marks R90 as coded, so there is no more "code change" reminder.
  - R16 keeps the newsletter's "Account frozen", which matches what Nacha says R16 reverts to.
- **Stale mutation anchor.** In `scripts/r41/mutate-s3-app.py`, "key-check-removed" matched 0 times after `sealFile` started hashing before the fact check. The copy in `sealFile` turned out to be an equivalent mutant: the next line, `keyedHasher("achFileEntrySet")`, returns null without the key and gives the same LEDGER_NO_KEY. So the mutant now removes the `releaseLoop` key check, which the "without DATA_ENCRYPTION_KEY" test kills. The rerun kills 27/27. The new anchor test also found that its own decoder mis-read `\t` and `\\`; it now decodes like Python, in one pass. A new test checks that every app mutation script's anchors match exactly once.
- **Still blocked (no guessing):**
  - attaching achedi reports (format and storage unknown);
  - the upload receipt (Brenda has not said the portal shows one);
  - reading notices automatically (needs a real or sample notice);
  - the basis for the monthly limit;
  - the D-2 late lane.
- **No migration.**

## S16 in detail

- **Why Plaid here.** The owner's Plaid connection to the Timberland Main account (the account payroll and vendor payments come out of) refreshes daily and on demand. The Trial plan (mirrored as `docs/authorities/ach/plaid-trial-plan.txt`) allows 10 connections, and removing one does not free a slot, so the watch reuses the existing Main connection and never asks for another.
- **Bank watch page** (`/admin/settings/banking/bank-watch`, new "Bank watch" tab; gate `finances.view`, as Bank Feeds). Last 60 days of the Main account's lines:
  - *Is the feed working?* No Main account linked, a sync older than 2 days, last four digits that differ from the agreement's account, a connection error.
  - *Money out that nothing explains.* Each settled debit is checked in order: an ACH file settling (the ACH Payments report match), already in the books, a Timberland fee amount (Schedule B), a known payee within its limit, a recorded review. Pending lines are listed apart and not counted.
  - *Possible returned payments.* Money in for exactly the amount of a payment we sent on or before that day; each payment and logged return used once.
  - *Return/NOC fees vs notices logged*, per month.
  - *Known payees* (owner adds and retires) and the explained lines with the reason.
  - *What Plaid does (and doesn't) do for ACH here*: quoted from the Trial plan mirror. Statements and payee account checks are not turned on; the reasons are on the page (Timberland support for Statements not confirmed; a payee account check would need each payee to link through Plaid and use a slot, so prenotes and the call-back stay).
- **Daily cron** `/api/cron/ach-bank-watch` (14:15 UTC): syncs only the Main connection, rebuilds the watch, emails the owner once per new set of findings per week (or once a day if the feed could not be read). It never blocks a payment.
- **Funding box hint.** On ACH operations the owner (finances.view) sees the Plaid balance next to the "what I saw" box, marked stale if older than 24 hours. The owner still types what they saw; the hint is never the confirmation.
- **Migration 0289**: rules (retire-only) and reviews (append-only); see MIGRATIONS_TO_RUN.
- **Tests.** `tests/compliance/r41-s16-bank-watch.test.ts`; pure self-test `ach-bank-watch-core` 54; `mutate-0289-sql.py` (35 mutants plus two probes) and `mutate-s16-app.py`. Manual test T-375.

## S17 in detail

- **Why.** Brenda (Timberland, email 3, answer 9) says notices arrive two ways: a secure encrypted email from the Federal Reserve, and the Timberland portal under Reporting → Electronic Documents. The Fed's guide (mirrored as `docs/authorities/ach/frbservices-edi-encrypted-email-guide.txt`) names the sender domain `encryptedmail.achedi.com`, keeps reports 60 calendar days, and says not to rely on the email but to check the portal daily and make sure the link goes to achedi.com.
- **Reuse.** The Google Workspace sign-in built for the CCRS email monitor (`ccrs-mail-core` / `ccrs-mail-fetch`): same token, same list and get calls, no new keys. The Gmail `{ }` OR search and “includes Spam and Trash” are quoted from a new mirror, `docs/authorities/ach/gmail-search-operators.txt`.
- **Off by default.** What the notice email actually looks like is not known yet, so the site never parses it. Off = the hourly cron reads one setting and returns, with no Google call. Only the owner turns it on, and must type I STILL CHECK THE PORTAL.
- **When on** (`/api/cron/ach-notice-mail`, hourly at :50): each matching email is stored once, encrypted (refused if `DATA_ENCRYPTION_KEY` is missing), with sender match, DMARC, spam folder and link hosts; links not on achedi.com are flagged and shown as plain text. Michael gets one email per stored message, claimed in `compliance_reminder_log`, and the claim is removed if sending fails.
- **Page** (`/admin/settings/banking/notice-email`, new “Notice email” tab; gate `settings.manage`, email text only for `finances.view`): status and readiness, the daily portal checklist with reasons, waiting and marked emails, settings, the exact Gmail search, and every source quoted. ACH operations' Notices section links to it.
- **Backup plan.** None added: the owner already skips an ACH payroll and logs it as paid by written checks.
- **Migration 0290**: `ach_notice_mail` (append-only, encrypted, one mark per row); see MIGRATIONS_TO_RUN.
- **Tests.** `tests/compliance/r41-s17-notice-mail.test.ts`; pure self-test `ach-notice-mail-core` 57; `mutate-0290-sql.py` (29 mutants) and `mutate-s17-app.py`. Manual test T-376.

## S18 in detail

- **Why.** The WA State Auditor's Office ACH fraud guidance (mirrored in `docs/authorities/ach/`) starts with a written ACH policy, limited and reviewed access, training, passkeys and a dedicated banking computer; the Timberland agreement adds record keeping (1 year for entries, 2 years for authorizations), credential care, a private secured connection, and phone-then-writing within 1 calendar day (1-800-562-8761).
- **Page** (`/admin/settings/banking/policies`, new "Policies" tab; gate `settings.manage`, records owner only via `ach.act`): status and to-do, eight policies each with a hover hint and the source's exact words, yearly adoption (stores a SHA-256 of the wording; a wording change asks for a re-adopt), quarterly access review (owner/admin list, last sign-in, 90-day flag; fingerprint of the list so a change shows), six yearly key checks with an optional last-changed date, and a plain-text packet.
- **Backup plan.** Policy 8 is the owner's existing procedure (skip the ACH payroll, pay by written checks), quoted from his own Round 16 words; nothing new was built for it.
- **Migration 0291**: `ach_control_records` (append-only, never backdated, owner-only, period rules); see MIGRATIONS_TO_RUN.
- **Tests.** `tests/compliance/r41-s18-policies.test.ts`; pure self-test `ach-policies-core` 69; `mutate-0291-sql.py` (27 mutants) and `mutate-s18-app.py`. Manual test T-377.

## S19 in detail

- **Why.** The owner is waiting for Brenda (Timberland Cash Management) to set up the interview about testing. The S19 page puts everything for that meeting in one place so nothing is forgotten, and it never guesses: an item is "Confirmed" only when Brenda's words (`timberland-brenda-2026-10.txt`, `timberland-brenda-2026-10-19-email-3.txt`) or the signed agreement say so. Whether Timberland offers an ACH debit block or an ACH filter (ACH positive pay) is not in any mirror, so both are questions, backed by the State Auditor's words. No mirror mentions BAI2, so it is not on the list.
- **Page** (`/admin/settings/banking/bank-setup`, new "Bank setup & glossary" tab; gate `settings.manage`; reads and writes nothing): 11 items in meeting order (5 ask, 1 owner decides, 5 confirmed), each with a hover hint, what is on record and the source's own words; a printable plain-text meeting sheet (`bank-setup/sheet`, tick boxes and answer lines, audit line only); a 20-term ACH glossary, each term in plain words with the definition quoted from the Timberland agreement, Nacha, the Fed or the State Auditor, linking to where Greenway does it.
- **Hover help.** Every section heading on ACH operations and Banking approvals now has an InfoHint; the Returns, Account checks and ACH files hints come from the glossary (`glossaryHint`).
- **No migration.**
- **Tests.** `tests/compliance/r41-s19-bank-setup.test.ts`; pure self-test `ach-bank-setup-core` 44; `mutate-s19-app.py`. Manual test T-378.

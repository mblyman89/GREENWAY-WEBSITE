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
| S9 | Get rolling: go-live readiness board, file checker, funding helper (owner confirms funding; 8 am settlement-day reminder) | this branch | 0276 |

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

Michael sends Brenda one email at the end of the full build. It holds:
- Q1 (for information only; Q2 was removed by the owner in round 5);
- Q3 to Q15, Q18 and Q20;
- the small add-ons noted in the round reports.

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

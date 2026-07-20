# Bible Chapter 13 — Payroll & Banking (Manual Entry → NACHA, the S-10 Walls)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` plus this branch's docs-only commits
> (every file:line anchor re-checked on that tree — if a line looks off, the
> file changed after this chapter was written; re-verify before trusting).
> **Plain-English promise of this chapter:** the app NEVER moves money. You
> run payroll in Sage yourself, type the paystub numbers into the back office,
> and the app checks your math, enforces your own guardrails (a source
> document, once-per-two-weeks cadence), and produces a bank-format file you
> download and upload to Timberland by hand. Employee bank account numbers are
> encrypted at rest and masked on screen (S-10), and the same file builder
> pays vendors — but only against an accepted manifest, and never a penny more
> than what is actually owed.

---

## 1. The big idea in one paragraph

Payroll here is deliberately **manual-entry, drafts-only**. The pure core's
header says it plainly (`src/lib/payroll/payroll-core.ts:1–12`): "the owner
runs payroll in Sage MANUALLY, gets paystubs, then TYPES the amounts owed into
the back office. We are NOT importing from Sage — we give tidy input fields,
add up/verify the totals, and turn the net-pay amounts into a NACHA direct-
deposit file the owner uploads to Timberland (Jack Henry)." Nothing is ever
transmitted to a bank from the app; the deliverable is a text file. Around
that simple pipe sit three walls: **validation** (every line must have a
positive net pay, a real ABA routing number, and books that tie out),
**guardrails** (the owner's own verbatim rules — no file without a source
document, no employee paid twice in 14 days, no second file in a 14-day
window — plus Nacha-2026-style fraud red flags), and **S-10 secrecy**
(banking numbers AES-encrypted at rest, masked in every screen, with exactly
one decrypting read path). All money is integer cents.

---

## 2. The pure money brain (`src/lib/payroll/payroll-core.ts`)

Everything the owner types passes through pure, self-tested functions:

- `dollarsToCents` (:19) parses what a human types — `"$1,234.56"`, `"1500"`,
  `"1500.5"` — into integer cents; blank → `null`; garbage or a third decimal
  digit → `null` (never a crash, never a guess).
- `centsToDollars` (:29) formats cents back for display.
- `validateLine` (:67) checks one employee's row: name required, **net pay
  must be a positive integer** (net is the ACH amount), the routing number
  must pass the real ABA check-digit test (:73–75), the account number must
  be present (:76–78), and — when gross, taxes and deductions are all typed —
  **gross − taxes − deductions must equal net** (:92–100), with the exact
  dollar mismatch spelled out. Reconciliation is `null` (not failed) when the
  optional fields are left blank.
- `sumTotals` (:114) adds the run up; `validatePayrollRun` (:136) validates
  every line, refuses an empty run, and blocks the same employee appearing
  twice (:140–144).
- `linesToAchEntries` (:151) maps validated lines to bank entries — the ACH
  amount is exactly `netPayCents`, and the employee id rides along as the
  entry's identification number.
- Self-tests live in the module (`__runPayrollCoreTests` :165) and are run by
  `scripts/discovery/test_payroll_pure.ts` together with the guardrail and
  NACHA suites.

---

## 3. The owner's guardrails (`payroll-guardrails-core.ts`)

The module header records the owner's requirements **verbatim** (:10–16):
*(a)* "block payments unless there is a source document to tie it to,"
*(b)* "only one payment to one employee every two weeks," *(c)* "no more than
one check per two week period." Each becomes a **hard block** — a finding with
`overridable: false` that nothing in the app can bypass:

| Code | Severity | What it means |
| --- | --- | --- |
| `SOURCE_DOCUMENT` | **block** | No uploaded payroll document is tied to the run (:133–143). |
| `PERIOD_CADENCE` | **block** | Another file was already generated within 14 days of this pay date (:145–158). |
| `EMPLOYEE_CADENCE` | **block** | This employee was paid within the last 14 days (:164–176). |
| `DUPLICATE_PAYMENT` | warn | Same employee, same net, inside the window — looks like a re-run (:178–189). |
| `AMOUNT_CEILING_EMPLOYEE` | warn | A line exceeds the $20,000 sanity ceiling (:193–203; `DEFAULT_PER_EMPLOYEE_CEILING_CENTS` :33). |
| `BANK_ACCOUNT_CHANGED` | warn | The banking differs from the employee's last payment — verify out-of-band (:205–220). |
| `AMOUNT_CEILING_RUN` | warn | The run total exceeds the $200,000 ceiling (:223–231; :34). |
| `DUAL_CONTROL` | info | The creator is releasing their own file — self-approval is allowed but recorded (:233–243). |

The warn rows are research-backed additions (the header cites the Nacha 2026
Risk Management Rules' layered-fraud-monitoring expectation). The window
constant is `CADENCE_DAYS = 14` (:29), and `daysBetween` (:109) does the
calendar math in UTC whole days — an unparseable date counts as **infinitely
far apart**, which matters below. The verdict logic is two pure functions:
`evaluatePayrollGuardrails` (:126) produces the findings and `hasHardBlock`
(:245); `guardrailsPermitGeneration` (:252–259) is the actual gate — **a hard
block is NEVER bypassable; soft warnings require an explicit override**.
Self-tests: `__runPayrollGuardrailsCoreTests` (:264).

### 3a. Where the facts come from (`payroll-store.ts`, `evaluateRunGuardrails` :362)

The store gathers what the pure evaluator needs: each employee's **last
generated payment** — pay date, net amount, and banking, read from other runs
whose status is `file_generated`/`submitted` (:376–414) — plus every other
generated run's pay date for the period-cadence check (:416–427), plus
whether the run has a `source_document_id` (:438). Stored banking snapshots
are decrypted first (:403–408) so the bank-change red flag compares real
numbers, not ciphertexts.

**One honest caveat (deliberate posture):** the history gathering is
best-effort — if the guardrail tables/migration are absent, it "degrades to
'no history'" (:359–360, :412–414) and the evaluator treats everyone as
first-paid. The (a) source-document block never degrades (the run row itself
carries the column), but the cadence blocks depend on history being readable.
This is the pre-migration compatibility posture used across the app; once
migration 0094 is applied the facts are durable.

---

## 4. Generation: validate → guardrails → NACHA → stamp (`generatePayrollNacha` :457)

The single generation path (:457–546) runs in strict order:

1. **Re-validate everything** from the SAVED lines, not the form (:479–483) —
   the first validation error refuses generation.
2. **The guardrail gate** (:485–502): the comment names it "the compliance
   gate," and `guardrailsPermitGeneration` refuses when a hard block exists or
   warnings stand un-overridden. The refusal message is the specific finding.
3. **Build the file** with the pure NACHA builder (:513–522), PPD entries from
   the saved lines, the run's `file_id_modifier`.
4. **Stamp the run** (:525–543): status `file_generated`, the filename,
   `approved_by`/`approved_at` (**dual control** — who released it, :534–536),
   and — if soft warnings were overridden — `guardrail_override`,
   `guardrail_override_reason`, and `guardrail_override_by` (:537–540), so
   every conscious override is a permanent record.

The download route (`src/app/admin/payroll/[id]/download/route.ts`)
**regenerates** the file from the saved lines on every download (:20; header
:4–6 — "rebuilt from the saved lines so it always reflects the latest entries
+ company settings"), which means the
guardrails run again on every download too; it is `settings.manage`-gated
(:18) and serves the file with CRLF line endings for bank upload (:24–25).

---

## 5. The NACHA file itself (`src/lib/payments/nacha-core.ts`)

The builder is pure and **grounded against the published record layout** — the
header (:1–23) documents the source and the model: fixed-width 94-character
records, credit-only (Service Class Code 220 — money leaves the company; total
debit is always zero), suitable for both payroll (SEC `PPD`) and vendor
payments (SEC `CCD`).

- Field helpers do the spec's justification rules: `alpha` left-justifies and
  blank-pads (:30), `numeric` right-justifies and zero-pads (:37),
  `sanitizeAlpha` strips to the permitted ASCII subset (:44).
- `isValidRouting` (:53) is the real ABA mod-10 check-digit algorithm
  (weights 3-7-1) — a mistyped routing number is caught before any file
  exists, at line entry AND again inside the builder.
- `buildNachaFile` (:148) validates first (:151–167 — no entries, bad
  destination routing, bad entry routing, missing account, non-positive
  amount all refuse with plain messages), then emits the five record types in
  order: File Header (:175–190), Batch Header with SCC 220 (:192–208), one
  Entry Detail per receiver with transaction code 22 (checking) / 32
  (savings) (:139–142, :210–233), Batch Control with the entry hash —
  rightmost 10 digits of the summed receiving-DFI ids — and total credit
  (:238–251), File Control (:253–266), then 9-filled padding records to a
  multiple of ten lines (:268–270).
- Self-tests: `__runNachaCoreTests` (:279).

The originating-company settings the header needs (bank routing/name,
immediate origin, company name/id, originating DFI) live in the
`ach_company_settings` singleton, edited only on the Banking settings page
(section 7).

---

## 6. S-10: the secrecy walls around bank numbers

Employee and company bank details are the most stealable data in the system,
so S-10 builds four walls:

1. **Encrypted at rest** (`src/lib/security/at-rest-crypto.ts`). AES-256-GCM
   envelope encryption keyed from the `DATA_ENCRYPTION_KEY` env var (header
   :1–26). Ciphertexts are self-identifying (`encv1:` prefix, :29), so legacy
   plaintext rows keep working — `decryptSecret` passes anything without the
   prefix through unchanged (:85) and values become encrypted as they are
   next saved. **Without the key nothing breaks**: `encryptSecret` returns
   plaintext with a one-time warning (:59–68) and the admin dashboard nags
   the owner to set the key (`src/app/admin/page.tsx:136`) — the header calls
   this "fail-visible, not fail-broken; these are privacy/fraud protections,
   not LCB gates." An undecryptable ciphertext (rotated/lost key) returns
   `""` with a warning (:102–105) so callers treat it as "not on file"
   instead of using garbage. Self-tests (`__runAtRestCryptoTests` :119) run
   inside the pure self-test suite
   (`scripts/compliance/run-pure-selftests.ts:17`).
2. **One read path.** `listEmployeeBanking`
   (`src/lib/staffing/store.ts:149`) is documented as "the ONLY read path for
   employee direct-deposit banking. Used by the payroll editor + NACHA
   generation exclusively; nothing else may select the bank_* columns"
   (:143–147). Writes encrypt (`saveEmployeeBanking`,
   `payroll-store.ts:95`, encryption at :102–110); the per-run line snapshots
   encrypt on save (`savePayrollLines` :331–333) and decrypt only inside
   `getPayrollRun` (:196–204) for the editor and the builder.
3. **Masked on screen.** `maskAccountTail` (:109) renders `••••1234`
   everywhere an account number appears (payroll editor:
   `src/app/admin/payroll/[id]/page.tsx:107`; banking settings page:
   `src/app/admin/settings/banking/page.tsx:96`). A submitted value that is
   still masked means "keep the stored number" — resolved server-side in the
   save actions (`resolveAccount`, `src/app/admin/payroll/actions.ts:26–30`;
   the same convention for the company funding account in
   `src/app/admin/settings/banking/actions.ts:22–28`). The mask is never
   written to the database.
4. **Admin-only, audited.** Every payroll action requires `settings.manage`
   (actions at `src/app/admin/payroll/actions.ts:40/:56/:119/:168`; both
   pages: `page.tsx:29`, `[id]/page.tsx:53`; the download route :18) — a
   role held only by owner/admin (`src/lib/auth/roles.ts:93`). Every step
   writes an audit row: `payroll.run.create` (:46),
   `payroll.run.save_lines` (:106), `payroll.source_doc.upload` — including
   the file's SHA-256 content hash (:149–155) — and `payroll.run.generate` with
   the entry count, total cents, and any override + reason (:172–180).

The typed-in workflow itself lives in `saveRunLinesAction` (:55): employees
left entirely blank are skipped (:77–78), typed banking is re-saved to the
employee record so it prefills next run (:95–102), and masked submissions
resolve against this run's saved snapshot first, then the employee's stored
banking (:59–73).

---

## 7. The Banking settings page (one write path for shared ACH settings)

The originating bank / company ACH settings were moved off the payroll page
onto their own Banking settings page so they are **shared by payroll and
vendor ACH with a single write path** (the removal note:
`src/app/admin/payroll/actions.ts:32–36`). `saveBankingSettingsAction`
(`src/app/admin/settings/banking/actions.ts:19`) is `settings.manage`-gated
(:20), applies the masked leave-unchanged convention to the company funding
account (:22–28), and audits `banking.settings.save` (:44–48). In the store,
the funding account number is encrypted on save
(`saveAchCompanySettings`, `payroll-store.ts:80–85`) and decrypted on read
(:65–67); the field is explicitly NOT written into the NACHA header
(`AchCompanySettings` comment :36 — it exists for the owner's records).

---

## 8. Vendor payments: the same builder, married to a manifest (B6 / Task N / W8)

The vendor side reuses the identical NACHA core with SEC `CCD` and its own
pure guardrails (`src/lib/payments/vendor-ach-core.ts`, header :7–9:
"DRAFTS-ONLY … It NEVER transmits to a bank and NEVER moves money").

The organizing idea: an I-502 vendor "invoice" is an **accepted inbound
manifest**, and the amount owed is the CCRS cost basis — `SUM(received_qty ×
unit_cost_minor_units)` over its non-rejected lots — minus what has already
been paid (`vendor-payables-store.ts` header :1–14, `listVendorPayables`
:39, `recordManifestPayment` :188). `checkManifestPayment`
(`vendor-ach-core.ts:111`) then enforces a strict matrix (:104–109):

- manifest not accepted → **blocked**;
- nothing left to pay → **blocked**;
- **overpay (amount > remaining) → blocked** (:138–143, with the exact
  dollars owed/paid/remaining in the message);
- partial payment → **allowed with a warning** (:145–150);
- exact → clean.

The server action (`src/app/admin/vendor-payments/actions.ts`,
`buildVendorAchAction` :264) is gated by the scoped `payables.manage`
permission (:268) — owner/admin/**manager**, deliberately narrower than
settings.manage ("dragged in user management and store settings just to pay a
vendor," `roles.ts:79–83`). It refuses when the shared banking settings are
incomplete (:270–284), blocks the same invoice appearing twice in one batch
(:298–319), re-checks routing/account per row (:336–347), runs THE GUARDRAIL
per row (:349–355) and stops on any block (:358–360), builds the CCD file
(:392–395), records each payment against its source document so future
over/under math is correct (:404–443 — manifests via
`recordManifestPayment`, Task N paper invoices via the unified ledger, and
the W9 PO paid-stamp when a payment settles a linked purchase order), and
audits `vendor_ach.generate` with batch ref, entry count and total (:445–458).
W8 adds a read-only invoice↔PO comparison chip
(`invoice-po-match-core.ts` header :1–20 — the owner explicitly declined
three-way matching; `compareInvoiceToPo` :54).

---

## 9. Findings from this pass

No new formal findings. Three deliberate postures worth naming:

1. **Guardrail history is best-effort pre-migration.** Before migration 0094
   the cadence blocks can't see history and treat every payment as the first
   (`payroll-store.ts:359–360`). The source-document block still holds, and
   the posture matches the app-wide degrade-don't-fail convention — but it is
   one more reason the owner should apply 0094 promptly.
2. **Self-approval is allowed, recorded, and flagged — not blocked.** A
   one-person business can't require two humans; the DUAL_CONTROL finding is
   info-severity (:233–243) and `approved_by` stamps who released every file
   (:534–536). If staff grows, tightening this to a real two-person rule is a
   one-line severity change.
3. **At-rest encryption is opt-in by env key.** Until `DATA_ENCRYPTION_KEY`
   is set, banking is stored in plaintext with a visible dashboard nag — a
   conscious "fail-visible, not fail-broken" trade
   (`at-rest-crypto.ts:16–19`). Setting the key is a zero-migration flip;
   values encrypt as they are next saved.

---

## 10. What SHOULD never happen (watchlist)

1. The app transmitting money or talking to a bank — both pipelines are
   drafts-only by design (`payroll-core.ts:1–12`,
   `vendor-ach-core.ts:7–9`); the only outputs are downloadable files.
2. A payroll file generated with **no source document** — SOURCE_DOCUMENT is
   a non-overridable hard block (`payroll-guardrails-core.ts:133–143`),
   enforced inside `generatePayrollNacha` (:485–502), which the download
   route also passes through.
3. An employee paid twice inside 14 days, or two files generated in one
   14-day window — EMPLOYEE_CADENCE (:164–176) and PERIOD_CADENCE (:145–158)
   hard blocks.
4. A hard block bypassed by the override checkbox —
   `guardrailsPermitGeneration` returns false on any hard block regardless of
   the flag (:252–259).
5. A soft-warning override without a permanent record — the run row stores
   `guardrail_override`, the reason, and who (:537–540), and the
   `payroll.run.generate` audit repeats it
   (`payroll/actions.ts:172–180`).
6. A NACHA entry with an invalid routing number — the ABA check digit is
   verified at line validation (`payroll-core.ts:73–75`) and again inside the
   builder (`nacha-core.ts:156–160`).
7. A payroll line with zero/negative net pay, or the same employee twice in
   one run (`payroll-core.ts:67`, :140–144).
8. A bank account number rendered unmasked, or a mask written to the
   database — masking at render (`maskAccountTail`), resolve-on-save
   (`payroll/actions.ts:26–30`, `banking/actions.ts:22–28`).
9. Any code path other than `listEmployeeBanking` selecting the employees'
   `bank_*` columns (`staffing/store.ts:143–147`).
10. A vendor payment exceeding the remaining owed on its manifest — overpay
    is blocked in the pure check (`vendor-ach-core.ts:138–143`) and the
    action stops on any blocked row (:358–360).
11. A vendor payment not tied to an accepted payable, or the same invoice
    paid twice in one batch (`vendor-ach-core.ts:117–123`;
    `vendor-payments/actions.ts:298–319`).
12. The company funding account number appearing in a NACHA file header — it
    is stored for the owner's records only
    (`payroll-store.ts:36` comment).
13. A payroll screen or action reachable without `settings.manage`, or a
    vendor payment without `payables.manage` (section 6.4; `roles.ts:83/:93`).

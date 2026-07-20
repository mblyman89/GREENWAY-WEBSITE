# Bible Chapter 11 — CCRS Compliance (Weekly Files, Identifiers, Submit Gate, Corrections, Audit Trails)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** CCRS is the state's seed-to-sale
> reporting system, and it is unforgiving — CSV upload only, no API, no
> real-time validation, errors reported days later by email. This chapter shows
> how the app turns that fragile manual process into something that cannot
> quietly go wrong: the exact file spec is encoded in pure tested code, a hard
> gate physically refuses to produce a malformed batch, a deadline engine makes
> the Sunday due date impossible to miss, and every export leaves a paper trail.

---

## 1. The big idea in one paragraph

Washington's CCRS (Cannabis Central Reporting System) has no API — a retailer
logs into cannabisreporting.lcb.wa.gov with a SAW account and manually uploads
CSV files every week. If a file is malformed, the LCB does not tell you at
upload time; it emails you later. The app's answer is layered defense: **the
spec is code** (`src/lib/compliance/ccrs-batch-core.ts` — pure, self-tested,
encoding the exact columns, header shape, file names and upload order from the
CCRS Upload User Guide), **builders never invent data** (`ccrs-batch.ts`,
`ccrs-sales.ts` — every row comes from a real database column, drafts-only,
the owner validates before uploading), **a hard gate refuses bad output**
(`ccrs-submit-gate-core.ts` + the batch-export route — a batch with any
blocking error is never even written to disk), **a deadline engine that cannot
forget** (`ccrs-week-core.ts` + reminders — Sunday–Saturday weeks, due the next
Sunday, nagging escalates until the week is resolved), and **corrections and
audit trails** so returns get reported back to the LCB and every regulatory
export is logged with who/when/what.

The chapter walks the pipeline in that order: spec → builders → verification →
gate → deadlines → error handling → corrections → audit trail.

---

## 2. The spec, encoded as code (`ccrs-batch-core.ts` — pure, Slice 54)

Everything factual about the CCRS file format lives in ONE pure file so it can
be unit-tested and can never drift between builders.

- **Seven retailer file types** (`CcrsRetailerFileType`,
  `src/lib/compliance/ccrs-batch-core.ts:27`): Strain, Area, Product,
  Inventory, InventoryAdjustment, InventoryTransfer, Sale — Table 1 of the
  CCRS Upload User Guide.
- **Exact template columns** for every file (`CCRS_COLUMNS` :37). The
  column-header row of every generated file must match these strings exactly.
- **Sale types** (`CCRS_SALE_TYPES` :139) and the mapper `saleTypeForOrder`
  (:152): a medical order reports `RecreationalMedical`, everything else
  `RecreationalRetail`.
- **Strain types** (`CCRS_STRAIN_TYPES` :160 — Indica/Sativa/Hybrid) with a
  normalizer (`normalizeStrainType` :173).
- **Product classification** — valid `InventoryCategory` values (:212), the
  allowed `InventoryType` values per category (:225), and the cross-check
  `validateProductClassification` (:279) that flags an invalid pairing.
- **Text limits**: `clampText` (:332), product name max 75
  (`CCRS_PRODUCT_NAME_MAX` :342), description max 250 (:343).
- **Warning severity**: `classifyWarning` (:379) — a warning whose text starts
  with "ERROR" is blocking; everything else is advisory. The submit gate uses
  this exact same function (section 5).
- **Upload order** (`CCRS_UPLOAD_GROUPS` :395, `CCRS_UPLOAD_ORDER` :402,
  `uploadGroupOf` :405): Group 1 (Strain, Area, Product) → Group 2 (Inventory)
  → Group 3 (InventoryAdjustment, InventoryTransfer, Sale). The LCB validates
  dependencies in this order, so the app numbers the files in the zip so they
  sort correctly.
- **Cell/date/file-name formatting**: `ccrsCell` (:417), `ccrsDate` (:430 —
  MM/DD/YYYY on the Pacific business day), `ccrsFileStamp` (:437), and
  `ccrsFileName` (:450) which produces the required
  `UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv` name.
- **The assembler** (`assembleCcrsFile` :467): every file gets the 3-row
  common header (`SubmittedBy`, `SubmittedDate` MM/DD/YYYY, `NumberRecords`),
  then the exact template column row, then data rows — joined with CRLF, with
  `NumberRecords` equal to the data-row count and a pad/truncate guard so a
  row can never have the wrong number of cells.

Self-tests live at the bottom of the file (`__runCcrsBatchCoreTests` :765) and
run in both harnesses (the pure runner and vitest), covering the assembler,
the CSV splitter, the verifier, and the text limits (:881–885).

---

## 3. The builders — every row from a real database column

### 3a. The full weekly batch (`ccrs-batch.ts`, Slice 54)

`buildCcrsBatch(fromISO, toISO)` (`src/lib/compliance/ccrs-batch.ts:339`)
produces the complete, correctly-ordered batch. The header comment (:1–15)
states the posture: **DRAFTS-ONLY — "We never invent data — every row comes
from a real DB column."** How each file is built:

- **License identity** comes from `getCcrsLicenseSettings()` (:340); a missing
  license number is pushed as a blocking sync issue (:358) instead of
  producing a file the LCB would reject.
- **Strain + Product** rows come from the *published* menu snapshot (the same
  `menu_versions`/`menu_items` rows the register sells from — :374–391); no
  published version yields a warning that those files will be empty (:389).
- **Inventory** rows come from `inventory_lots` excluding destroyed lots
  (`.neq("status", "destroyed")` :399).
- **Area**: a quarantine area row is emitted only when a lot is actually in
  quarantine/recalled status (`hasQuarantine` :402, used by `buildAreaFile`
  :168–175).
- **InventoryAdjustment + Sale** reuse the mature dedicated builders
  (:418–420; sections 3b and 3c) — one implementation each, no duplication.
- **InventoryTransfer is deliberately an empty, correctly-shaped file**
  (:457–461): "InventoryTransfer is submitted by the receiving licensee;
  retail intake is reported via Inventory.csv." The note travels with the file
  so an employee understands why it's empty.
- Files are sorted into upload-group order (:474–476), and the whole batch
  carries a list of **sync issues** — data-integrity problems detected BEFORE
  upload, because the LCB only reports failures by email afterwards.

### 3b. Sale.csv (`ccrs-sales.ts`, Slice 17 + hardening)

`buildCcrsSaleCsv(fromISO, toISO)` (`src/lib/compliance/ccrs-sales.ts:182`)
builds the file that reports every retail sale. The header (:1–25) documents
the exact field spec and the money rule: **CCRS expects decimal dollars, no $,
no parentheses, no negatives — we store cents and convert at the boundary**
(`dollars()` :66).

The important decisions, in order:

1. **Which orders?** The S-8 canonical period basis (:219–223, and chapter
   10 §2): COMPLETED orders by `completed_at` Pacific (`.eq("status",
   "completed")` :228), paged with `pagedAll` so a busy filing week can never
   silently drop orders (S-7, :224).
2. **Medical sales** (B1, :237–247): there is no `orders.medical` column — an
   order is medical when it has WAC 314-55-090(2) exempt-sale records in
   `medical_exempt_sales` (`medicalOrderIds` :247). Additionally each exempt
   record is keyed by `(order_id, product_sku)` (`exemptByOrderSku` :248) so
   the matching sold LINE reports its exempted tax as **$0.00** in the file
   (:357–366) — the CSV then matches what the register actually charged and
   what the LIQ-1295 Box 2 deduction claims.
3. **Money per line** (:337–347): `UnitPrice` is the price of ONE unit
   BEFORE discount/tax (the regular price, :344); the markdown goes in the
   whole-line `Discount` column (:345); the taxable base is post-discount
   price × qty (:347); sales tax and the 37% excise (`OtherTax`) are computed
   with the same `applyBps` the register uses (:362–364), and excise only
   applies to cannabis categories (chapter 10 §3).
4. **Which inventory identifier?** (:368–381) The variant's own encoded lot
   key wins (`lotKeyForSaleLine` :373 — Mastering Slice 1, so each size on a
   mastered card reports ITS OWN lot), then
   `resolveSaleInventoryExternalId` (:375) applies the preference order from
   section 4.
5. **Sale identifiers** (:391–393): `SaleExternalIdentifier` = the order
   number; `SaleDetailExternalIdentifier` = order number + first 8 chars of
   the line id (unique per line); `SaleDate` = the Pacific business day of
   `completed_at`.
6. **Warnings, not silent fixes** (:421–459): missing inventory ids (:421),
   product-key fallbacks (:426), possibly-invalid ids (:431), lines
   referencing QUARANTINED inventory — which CCRS rejects outright (:436),
   skipped zero-qty/zero-price lines (:441), medical lines to confirm (:444),
   exempt-zeroed lines (:449), and the trap case: medical orders found but NO
   line matched an exempt record by SKU, meaning taxes were reported at full
   rates (:454). Every warning is written for a human to act on.

The file is assembled by the same shared assembler as everything else
(`buildFile` :483 → `assembleCcrsFile`), so it is byte-identical in shape to
the batch's other files.

### 3c. InventoryAdjustment.csv (`ccrs-inventory-adjustment*.ts`, Slice 30)

The pure core (`ccrs-inventory-adjustment-core.ts`) encodes the guide's exact
`AdjustmentReason` vocabulary (`CCRS_ADJUSTMENT_REASONS` :32 — Destruction,
Reconciliation, Lost, Seizure, Theft, ReturnedLabSample, Other) and the mapping
from the app's internal reasons (`mapAdjustmentReason` :58):

| internal reason | CCRS reason | why |
| --- | --- | --- |
| destruction | Destruction | direct |
| count | Reconciliation | cycle-count variance (chapter 9 §6) |
| shrink / damage | Lost | direct |
| sample | ReturnedLabSample | lab/QA pull |
| employee_sample | Other + detail naming the employee | Task K, LCB-confirmed shape (WAC 314-55-096) |
| recall | Destruction | recalled product is destroyed |
| return | Other + mandatory detail stating the ADD direction | Task Q — 'Return' is not a valid CCRS reason |
| theft / seizure | Theft / Seizure | direct |

`isReportableAdjustment` (:97) excludes `receive` (additions are reported via
Inventory.csv, not adjustments) and zero-delta rows. Quantity is always the
absolute magnitude (`adjustmentQuantity` :121); the free-form detail is
clamped to CCRS's 250-char limit (`adjustmentDetail` :127). A comment at
:131–134 records a real bug class this file fixed: the live LCB template is **12
columns** (a per-adjustment `ExternalIdentifier` between AdjustmentDate and
CreatedBy) — the earlier 11-column shape was rejected (`ADJUSTMENT_COLUMNS`
:135 now matches `CCRS_COLUMNS.InventoryAdjustment` exactly).

The server wrapper (`ccrs-inventory-adjustment.ts:51`,
`buildCcrsInventoryAdjustmentCsv`) reads `inventory_adjustments` joined to
each lot for the identifier, maps every row through the pure core, counts
skips, and assembles with the shared assembler.

---

## 4. One identifier, forever (`ccrs-identifiers.ts`, Slice 22 + 108)

CCRS keys every record by a licensee-assigned **ExternalIdentifier**
(Text 100, alphanumeric), and the SAME identifier must be reused across files:
a lot's `Inventory.ExternalIdentifier` must equal the
`InventoryExternalIdentifier` on its Sale and InventoryAdjustment rows. If the
identifier drifts, CCRS sees a different (nonexistent) record. The design
answer (file header, `src/lib/compliance/ccrs-identifiers.ts:1–27`): every lot
gets ONE canonical id persisted on `inventory_lots.ccrs_inventory_external_id`
so it is stable forever (chapter 9 §3a shows it being set at intake).

The pure functions:

- `sanitizeExternalId` (:41) — keep alphanumerics, collapse anything else to a
  single hyphen, clamp to 100 chars (`CCRS_EXTERNAL_ID_MAX` :29).
- `validateExternalId` (:53) — precise problems ("missing", "exceeds 100
  characters", …) surfaced as upload warnings.
- `validateLicenseNumber` (:75) — digits only, exactly 6 digits for a
  licensee (10 allowed for labs only when the caller opts in).
- `findExternalIdCollisions` (:115) — two records sharing one id inside a
  file would silently overwrite each other in CCRS.
- `checkSaleIdentifierIntegrity` (:146) — enforces the guide's Sale rules:
  detail ids unique within a sale, and one sale may not mix SaleTypes or
  SaleDates (:164–193).
- `deriveInventoryExternalId` (:221) — the canonical-id preference order:
  **stored id (never drift) → lot_code → pos_product_key → `LOT-` + DB id**.
- `resolveSaleInventoryExternalId` (:245) — per-sale-line preference:
  **the line's own stamped id → the matched lot's canonical id → a sanitized
  product key as a degraded fallback (warned upstream)**. Chapter 9 §4
  showed the B20 stamp that fills the line's id at sale time precisely so
  this resolution is stable even if the lot changes later.

Self-tests: `__runCcrsIdentifierTests` (:264).

---

## 5. Trust, then verify, then REFUSE (Slices 94/96/105/108)

Three independent layers stand between a data problem and a bad upload:

### 5a. Offline byte-level verification (Slice 94, `ccrs-batch-core.ts`)

`verifyCcrsFile` (:611) re-parses each ASSEMBLED file string — offline, no DB,
no network — and checks everything the LCB would: CRLF line endings (:625),
the 3-row header shape and MM/DD/YYYY SubmittedDate (:634–640), the exact
template column row (:643–647), `NumberRecords` equal to the data-row count
(:655), per-row cell counts, every `*Date` column in MM/DD/YYYY (dates are
found by header name, `dateColumnIndexes` :602), product classification
(:693–696), 6-digit license numbers on every row (:698–704, Slice 108),
cross-row Sale identifier integrity (:723–727) and in-file ExternalIdentifier
collisions for Strain/Product/Inventory (:731–735). It uses a real
RFC-4180-ish splitter (`splitCsvLine` :565) so quoted cells round-trip.
`verifyCcrsBatch` (:748) runs it over the whole batch; `ok` is true only with
zero errors.

### 5b. Numeric defense-in-depth on Sale rows (Slice 96)

`verifySaleNumericColumns` (:511) checks the assembled Sale rows directly:
Quantity (column index 6, :501) must be a positive number; the four money
columns (indexes 7–10 — UnitPrice, Discount, RetailSalesTax,
CannabisExciseTax; :502) must be non-negative with at most 2 decimals
(`MONEY_2DP_RE` :504 — this single regex also catches negatives, scientific
notation and letters). It **never rewrites a value** — drafts-only, flag and
stop.

### 5c. The hard gate (Slice 105, `ccrs-submit-gate-core.ts` + batch-export route)

`assertCcrsBatchSubmittable` (`src/lib/compliance/ccrs-submit-gate-core.ts:77`)
is the single pure decision point. It consolidates all three problem sources —
builder sync issues, offline verifier problems, and each file's own warnings
(classified with the SAME `classifyWarning` the app already trusts, so an
"ERROR"-prefixed warning blocks instead of being buried as advisory) — into
one verdict: `submittable` is true ONLY with zero blocking errors (:52–60).

The export route enforces it
(`src/app/admin/reports/compliance/batch-export/route.ts`): after building the
batch (:40) and running the offline verification (:51), it computes the
verdict (:61) and — if not submittable — **returns HTTP 409 with a precise
human-readable fix list and produces NO CSVs at all** (:79–105: "⛔ EXPORT
REFUSED … The malformed files were deliberately not created."). When the gate
passes, the zip contains the files numbered in upload order (:43) plus a
`00_README.txt` telling the employee exactly where to upload
(cannabisreporting.lcb.wa.gov), in what order, with any advisory warnings.
The route itself is double-gated: `requirePermission("reports.view")` (:27)
plus an explicit `settings.manage` check (:28–30) because it produces a
regulatory file.

An optional AI advisor (`ccrs-advisor.ts`, `generateCcrsAdvice` :72) can
explain the batch in plain language — it is fed ONLY aggregate counts and the
pre-computed issues (never raw rows), is drafts-only/advisory, and no-ops
without an AI key (:1–12).

---

## 6. The week that cannot slip (`ccrs-week-core.ts` + `ccrs-week-store.ts`, Task W)

**The rule (file header, `src/lib/compliance/ccrs-week-core.ts:1–30`):** the
CCRS reporting week runs **Sunday through Saturday**, and the upload is due
**the Sunday after the week ends** (weekEnd + 1). There is no "no change"
report in CCRS — a week with no new activity requires NO upload, so what makes
the ledger audit-defensible is recording that someone VERIFIED there was
nothing to report (`WeekResolution` :115: `submitted` | `nothing_to_report`).
Week keys are `W-YYYY-MM-DD` of the start Sunday, shared with the S-18
compliance calendar.

Pure date math (self-contained, no timezone traps — pure ISO day arithmetic):
`addDaysIso` :40, `isoWeekday` :46, `isoDayDiff` :53, `weekStartFor` :75,
`weekFromStart` :80 (start Sunday → end Saturday → due Sunday),
`weekContaining` :87, `lastCompletedWeek` :96 (the week whose report is owed
right now), `weekFromKey` :101 (rejects malformed keys and non-Sunday starts).

`weekDeadline` (:137) derives the status ladder: `in_progress` (week still
running) → `open` (completed, early-submission window) → `due_today` →
`overdue`, or the two resolved states. `weeklyDeadlineOverview` (:170) builds
the multi-week picture with the single most urgent unresolved week (oldest
overdue first).

**Reminders** (`planWeeklyReminders` :234 — pure, deterministic, idempotent
per day): Thursday heads-up (:243), Saturday "closes tonight" (:258), Sunday
"DUE TODAY" (critical, :275), and a **daily** overdue escalation whose dedupe
key includes the date so it repeats every day until resolved (:287–297).
Self-tests: `__runCcrsWeekTests` :306.

The store (`ccrs-week-store.ts`) persists resolutions in
`ccrs_week_submissions` (migration 0118) and **fails safe** (header :8–10):
when the DB is unreadable it returns an empty resolution map, so every week
shows unresolved — the command center "can only nag MORE, never less."
`resolveWeek` (:81) refuses to resolve a week still in progress (:95) and
records `on_time` honestly (`today <= week.due`, :110), upserting by week key
(:115) so re-recording is idempotent. `unresolveWeek` (:125) undoes a mistaken
sign-off; `setWeekErrorStatus` (:139) tracks whether the LCB later emailed
errors about a submitted week (`clean` / `errors_reported` / `resolved`).

**Who can touch it:** the Command Center page
(`src/app/admin/compliance/ccrs/page.tsx:84`) is readable with `reports.view`,
but resolving/unresolving weeks and flagging error status all require
`settings.manage` and write an audit row
(`src/app/admin/compliance/ccrs/actions.ts:28,68,83,90,105,124`).

---

## 7. The monthly deadline that carries a money penalty (`ccrs-deadline-core.ts` + `ccrs-filing-status.ts`, Slice 106)

Distinct from the weekly upload: the **LIQ-1295 monthly tax report + excise
payment** is due "on or before the 20th of the next month," even with no
sales, with a 2% late penalty (RCW 69.50.535, WAC 314-55-089/-092 — header,
`src/lib/compliance/ccrs-deadline-core.ts:1–29`). `dueDateForPeriod` (:84)
rolls a weekend 20th forward to the next business day and accepts an OPTIONAL
owner-supplied holiday set — the code deliberately does **not** hardcode a
guessed holiday list ("we never assert a holiday we can't verify").
`periodDeadline` (:109) produces the status ladder (filed / upcoming /
due_soon / due_today / overdue); `planMonthlyReminders` (:245) mirrors the
weekly reminder pattern.

`ccrs-filing-status.ts` (`getCcrsFilingOverview` :67) turns the
`ccrs_export_batches` log into the monthly picture. Its honesty note
(:20–23) matters: a full-month export on record is **evidence the owner
generated the file, NOT proof the LCB filing/payment was completed** — the
owner remains the source of truth. (The actual LIQ-1295 numbers are chapter
10 §7.)

Both engines feed one daily orchestrator
(`src/lib/notifications/compliance-reminders.ts`, `runComplianceReminders`
:178): it plans the day's weekly + monthly reminders with the pure planners,
dedupes against `compliance_reminder_log` so a re-run cron can never
double-send, and delivers via email (Resend) and/or web push — each channel
env-gated and failure-contained; if NEITHER channel is configured the reminder
is NOT logged, so it fires as soon as a channel comes online (header :1–26).
The cron route (`src/app/api/cron/compliance-reminders/route.ts`) requires the
`CRON_SECRET` bearer token, falls back to a staff session for the manual
trigger, and in production **refuses** unauthenticated calls when the secret
is unset (:32–58).

The broader **compliance calendar** (`compliance-calendar-core.ts`) tracks the
recurring obligations beyond CCRS as owner-checkable tasks with authorities
cited (`CALENDAR_TASKS` :70): LIQ-1295 monthly, CCRS weekly (WAC
314-55-083(4)), a monthly CCTV 45-day-retention spot-check (WAC 314-55-105),
annual scale calibration/WSDA registration (RCW 19.94), and a monthly employee
badge & visitor-log check (WAC 314-55-083(1)-(2)). Marking a period done is
`settings.manage`-gated (`src/app/admin/compliance/calendar/page.tsx:38`).

---

## 8. When the LCB emails an error (`ccrs-error-triage-core.ts`, Task W)

Because CCRS validates after the fact by email, the Command Center has a
paste-the-email triage panel
(`src/components/admin/compliance/ErrorTriagePanel.tsx:43–47`). The pure core
(`triageCcrsErrorEmail`, `src/lib/compliance/ccrs-error-triage-core.ts:164`)
classifies each recognized error line as `benign` / `fixable` / `escalate`
(:15) with plain-language meaning and ordered fix steps, grounded in the
Upload User Guide + FAQ. Unrecognized errors route to the LCB examiner
escalation path (`LCB_CONTACTS` :226) with a **drafts-only** email builder
(`buildExaminerDraft` :245) — the app writes the draft; a human sends it.
Self-tests: :280.

A submitted week that later gets an error email is flagged on the ledger row
(`setWeekErrorStatus`, section 6) so the history shows not just "we
submitted" but "we submitted, the LCB pushed back, and we resolved it."

---

## 9. Corrections: telling the LCB about returns (`ccrs-sale-correction-core.ts`, Task Q)

Per the LCB CCRS FAQ (quoted verbatim in the file header,
`src/lib/compliance/ccrs-sale-correction-core.ts:1–27`): a valid customer
return means the sale identifier is **deleted** from CCRS and the inventory
identifier reported on an InventoryAdjustment as a return. The encoding:

- **Full line return ⇒ Operation `Delete`** (the row restates the original
  values); **partial return ⇒ Operation `Update`** (the row reports the
  REMAINING quantity with taxes recomputed pro-rata from the original line —
  `prorateLineMinor` :78).
- Corrections must carry the ORIGINAL identifiers (required on
  Update/Delete), money is decimal dollars with no negatives, and
  `UpdatedBy`/`UpdatedDate` are filled ("Updated Date cannot be prior to
  Created Date"). `mapSaleCorrectionRow` :85 does the mapping; the file is
  assembled by the shared assembler (`buildSaleCorrectionFile` :139).

The data comes from the return flow in chapter 5/9: when a return is
accepted, `disposition.ts` snapshots the CCRS Sale-row data (ids, taxes)
needed for the correction (`src/lib/inventory/disposition.ts:436,563`) and
creates the `customer_returns` row with `correction_status: "pending"`
(:678–679). The export route
(`src/app/admin/inventory/disposition/sale-correction-export/route.ts`,
`inventory.manage`-gated :29) pulls all pending corrections (:38–44), maps
them through the pure core (:46), **marks them exported** (:80 →
`markCorrectionsExported`, `disposition.ts:699–706`) so the same correction
is never uploaded twice, and audits the download
(`ccrs.sale_correction_export` :82–89). The matching inventory add-back rides
the normal InventoryAdjustment.csv as `Other` + mandatory detail (section 3c).

---

## 10. The audit trail under everything (`src/lib/auth/audit.ts`)

`recordAudit` (`src/lib/auth/audit.ts:18`) is the single append-only logger:
it inserts into `audit_logs` with actor, action, entity, before/after JSON,
and the caller's IP + user agent (:21–39), using the service-role client so
inserts always succeed regardless of RLS while reads stay staff-gated
(header :1–2). One deliberate posture: **an audit failure never breaks the
user's action** (:41) — logging is best-effort by design.

Every regulatory touchpoint in this chapter writes to it:

- Sale.csv export → a `ccrs_export_batches` row (file name, range, record
  count, who generated it, warnings as notes) PLUS a `ccrs.export` audit row
  (`src/app/admin/reports/compliance/export/route.ts:33–48`) — both
  best-effort so a logging hiccup can't block the download (:49–51). That
  export route is `settings.manage`-gated (:18).
- Week resolutions / un-resolutions / error-status changes → audit rows
  (section 6).
- Sale-correction export → `ccrs.sale_correction_export` (section 9).
- License identity changes → `license_settings.update`
  (`src/app/admin/reports/compliance/actions.ts:40–46`), with input
  validation first: digits-only license number, SubmittedBy ≤ 35 chars
  (:21–26).

`ccrs_export_batches` doubles as the evidence store the monthly deadline
engine reads (section 7), and `compliance-health.ts` (`getComplianceHealth`
:38) uses the latest batch age to flag a stale upload cadence — the same
export log serving compliance, deadlines and health monitoring.

---

## 11. Findings from this pass

No new formal findings. Three deliberate postures worth naming so a future
reader doesn't mistake them for oversights:

1. **The full batch export (zip) is not itself logged to
   `ccrs_export_batches`** — only the Sale.csv export route writes that row.
   The monthly filing evidence and the health check both read that table, and
   the batch zip includes a Sale file generated by the same builder, so
   coverage is adequate in practice — but if the owner switches to using the
   zip exclusively, the "export on record" evidence would come only from the
   Sale.csv route. 🔵 Hardening thought (not a formal finding): have the
   batch-export route also insert a `ccrs_export_batches` row on success.
2. **"Filed" is honestly modeled as "export on record," not "LCB accepted."**
   `ccrs-filing-status.ts:20–23` says so explicitly. This is the right
   humility for a system with no API — the owner is the source of truth, and
   the weekly ledger's `error_status` field captures the LCB's after-the-fact
   verdict.
3. **Audit logging is best-effort everywhere** (`audit.ts:41`, export route
   :49–51). A broken logger can never block a sale, an export, or a
   resolution. The trade-off (a lost audit row under DB failure) is accepted
   deliberately; the regulatory files themselves are never silently altered.

---

## 12. What SHOULD never happen (watchlist)

If any of these is ever observed, something in this chapter's machinery broke:

1. A generated CCRS file whose `NumberRecords` does not equal its data-row
   count, or with bare-LF line endings (assembler :467 + verifier :625/:655
   both prevent it).
2. A downloaded batch zip containing a file with a blocking error — the gate
   returns 409 and creates no CSVs (`batch-export/route.ts:79–105`).
3. A lot whose `ccrs_inventory_external_id` CHANGES after it has been
   reported — the canonical id must never drift (`ccrs-identifiers.ts:17–21`).
4. A Sale row with a negative money value or zero/negative quantity
   (`verifySaleNumericColumns` :511 blocks the batch).
5. Two Strain/Product/Inventory records sharing one ExternalIdentifier inside
   a file (`findExternalIdCollisions` via verifier :731–735).
6. One sale mixing SaleTypes or SaleDates, or reusing a detail id
   (`checkSaleIdentifierIntegrity` :146).
7. A cancelled or non-completed order appearing in Sale.csv (S-8 basis,
   `ccrs-sales.ts:228,279`).
8. A medical line reported with full tax when a matching exempt record exists
   — or the reverse, an exempt-zeroed line without a `RecreationalMedical`
   SaleType (both surfaced as warnings :448–459).
9. A completed week older than the lookback that is neither `submitted` nor
   `nothing_to_report` and NOT nagging daily (`planWeeklyReminders`
   :286–297 escalates overdue weeks every day).
10. A week resolved while still in progress (`resolveWeek` refuses,
    `ccrs-week-store.ts:95`).
11. The same customer-return correction exported twice
    (`markCorrectionsExported` flips status to `exported`,
    `disposition.ts:699–706`).
12. A `receive` adjustment appearing in InventoryAdjustment.csv (additions
    belong in Inventory.csv — `isReportableAdjustment` :97).
13. An unauthenticated production call to the compliance-reminders cron
    succeeding with `CRON_SECRET` unset (route refuses with 503, :38–46).
14. A regulatory export happening with no audit row AND no
    `ccrs_export_batches` row when the database was healthy (both are written
    on the Sale.csv route :33–48).

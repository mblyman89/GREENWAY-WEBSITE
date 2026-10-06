# CCRS Compliance Audit — Greenway Back Office

> **Purpose.** A full-scope, fact-grounded audit of every place the back office
> produces or consumes WA LCB **CCRS** data, to guarantee the POS/back-office
> strictly adheres to the CCRS Upload spec so we remain compliant.
>
> **Method (standing rules).** Every finding below is grounded against a VERIFIED
> authoritative source — never a guess:
> - LCB CCRS Resources: https://lcb.wa.gov/ccrs/resources
> - The **live current .CSV templates** downloaded during this audit (compared
>   byte-for-byte against `docs/ccrs-templates/`; they matched).
> - `docs/ccrs-data-model.md` (our verified source-of-truth, CIB 133 / Upload
>   User Guide 2-26).
> - LCB Manifests page: https://lcb.wa.gov/ccrs/manifests
>
> Severity: **CRITICAL** = would cause a CCRS upload to be REJECTED or produce a
> materially wrong report; **HIGH** = correctness/consistency risk; **MEDIUM** =
> robustness/clarity; **LOW** = cosmetic/nice-to-have.

Audit started against local `main` @ `55e16d1` (post Slice 84/85/86).

---

## Scope inventory (CCRS surface area)

Files that produce/consume CCRS data (verified by tree walk + grep):

**Generators (produce CCRS CSVs):**
- `src/lib/compliance/ccrs-batch-core.ts` — PURE spec: column sets, 3-row header
  assembler (`assembleCcrsFile`), file naming, upload-order groups.
- `src/lib/compliance/ccrs-batch.ts` — server: builds the full retailer batch
  (Strain/Area/Product/Inventory + reuses Adjustment/Sale builders) + sync checks.
- `src/lib/compliance/ccrs-sales.ts` — server: standalone **Sale.csv** builder.
- `src/lib/compliance/ccrs-inventory-adjustment-core.ts` — PURE: **InventoryAdjustment.csv**
  mapping + file assembly.
- `src/lib/compliance/ccrs-inventory-adjustment.ts` — server wrapper for the above.
- `src/lib/compliance/ccrs-identifiers.ts` — PURE: external-identifier derivation/validation.

**Consumers (parse CCRS data in):**
- `src/lib/inventory/ccrs-manifest-csv-core.ts` — PURE: parse an inbound CCRS
  manifest.csv (Slice 84).

**Adjacent compliance (tax/limits — reported to LCB, not via CCRS upload):**
- `src/lib/compliance/excise-*.ts`, `sales-limits-*.ts`, `trade-samples-*.ts`,
  `ccrs-advisor.ts`.

**Routes/UI that expose the above:**
- `src/app/admin/reports/compliance/page.tsx` (+ `export/route.ts`,
  `adjustment-export/route.ts`) — Sale.csv & InventoryAdjustment.csv downloads.
- `src/app/admin/inventory/intake/*` — CCRS manifest.csv import (Slice 84).

**Verified spec docs:** `docs/ccrs-data-model.md`, `docs/ccrs-templates/*.csv`,
`docs/CCRS_DATA_ACCESS.md`, `docs/ccrs-rejection-and-returns.md`,
`docs/ccrs-manifest-csv-import.md`.

---

## FINDINGS

### GROUP A — CCRS file generators (Sale.csv / InventoryAdjustment.csv)

#### A1 — CRITICAL — Sale.csv uses wrong tax column names
- **Where:** `ccrs-sales.ts` `COLUMNS` (cols 10–11) and `ccrs-batch-core.ts`
  `CCRS_COLUMNS.Sale` (cols 10–11).
- **What:** Emits `SalesTax` and `OtherTax`.
- **Spec (live template, verified):** the current LCB `Sales.csv` column row is
  `...Quantity,UnitPrice,Discount,`**`RetailSalesTax`**`,`**`CannabisExciseTax`**`,SaleExternalIdentifier,...`
- **Impact:** Column header mismatch → CCRS rejects the upload.
- **Fix:** Rename to `RetailSalesTax` and `CannabisExciseTax` in BOTH files (the
  data mapping is already correct: state+local sales tax → RetailSalesTax; 37%
  excise → CannabisExciseTax).

#### A2 — CRITICAL — Sale.csv writes a 2-row header, not the 3-row header
- **Where:** `ccrs-sales.ts` `buildFile()`.
- **What:** Writes ONE label row `SubmittedBy,SubmittedDate,NumberRecords` then a
  values row — a 2-row header.
- **Spec (verified):** every template + our own `assembleCcrsFile` use a **3-row**
  header, one labeled attribute per row:
  `SubmittedBy,<v>` / `SubmittedDate,<v>` / `NumberRecords,<v>`, THEN the column row.
- **Impact:** Malformed header → CCRS parse failure / rejection. This is the file
  the "⬇ Download CCRS Sale.csv" button emits (`reports/compliance/export/route.ts`),
  and the batch reuses it verbatim.
- **Fix:** Route Sale.csv assembly through `assembleCcrsFile` (or replicate its
  3-row header) so it is identical to the master-data files.

#### A3 — HIGH — Sale.csv uses `\n` line endings (templates use `\r\n`)
- **Where:** `ccrs-sales.ts` `buildFile()` (`out.join("\n")`).
- **Spec:** templates + `assembleCcrsFile` use `\r\n`.
- **Fix:** Use `\r\n` (folded into the A2 fix by using `assembleCcrsFile`).

#### A4 — CRITICAL — InventoryAdjustment.csv writes a 2-row header + `\n`
- **Where:** `ccrs-inventory-adjustment-core.ts` `buildAdjustmentFile()`
  (and its self-test asserts the wrong 2-row shape).
- **Same defect as A2/A3**, for the InventoryAdjustment file. Used by the
  "⬇ Download CCRS InventoryAdjustment.csv" button and reused by the batch.
- **Fix:** Emit the 3-row header + `\r\n` (route through `assembleCcrsFile` with
  a new `"InventoryAdjustment"` type, or replicate). Update the self-test.

#### A5 — CRITICAL — InventoryAdjustment.csv is MISSING the `ExternalIdentifier` column
- **Where:** `ccrs-inventory-adjustment-core.ts` `ADJUSTMENT_COLUMNS` (11 cols).
- **Spec (live template, verified — 12 cols):**
  `LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,`**`ExternalIdentifier`**`,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation`
  The per-adjustment **`ExternalIdentifier`** (unique id for the adjustment row
  itself) sits between `AdjustmentDate` and `CreatedBy` and is absent from the code.
  (Note: `ccrs-batch-core.CCRS_COLUMNS.InventoryAdjustment` DOES list all 12 — so
  the two column definitions disagree with each other.)
- **Impact:** Wrong column count/order → CCRS rejection.
- **Fix:** Add `ExternalIdentifier` to `ADJUSTMENT_COLUMNS` and populate it with a
  deterministic unique id per adjustment (e.g. `ADJ-<adjustment.id>` sanitized).
  Reconcile the two column definitions to one source of truth.

#### A6 — HIGH — Two disagreeing column definitions for the same files
- **Where:** `ccrs-batch-core.CCRS_COLUMNS` vs `ccrs-sales.COLUMNS` /
  `ccrs-inventory-adjustment-core.ADJUSTMENT_COLUMNS`.
- **What:** `CCRS_COLUMNS.Sale` and the standalone `COLUMNS` differ (A1); the
  adjustment column sets differ (A5). A single spec must be authoritative.
- **Fix:** Make `ccrs-batch-core.CCRS_COLUMNS` the ONE source of truth (after
  correcting A1 there too) and have the standalone builders import from it.

---

### GROUP B — Sale.csv / date data semantics

> Verified against the **CCRS Data Model File Specifications Manual** (26-page PDF,
> downloaded from lcb.wa.gov) + the live templates.

#### B0 — NOTE — Tax column-name tension between two LCB docs (confirms A1 fix)
- The **Data Model Manual** field list still calls the Sale tax fields `SalesTax`
  and `OtherTax`. The **current .CSV template header row** (what CCRS parses on
  upload) uses `RetailSalesTax` and `CannabisExciseTax`.
- **Resolution:** the CSV is validated against the template's header row, so the
  file MUST use the template names (`RetailSalesTax`, `CannabisExciseTax`).
  A1's fix stands. Documented here so the discrepancy isn't "fixed back" later.

#### B1 — HIGH — Medical sales are mis-typed as RecreationalRetail
- **Where:** `ccrs-sales.ts` — `SaleType` is hardcoded `"RecreationalRetail"`.
- **Spec (Data Model Manual, verified):** `SaleType` valid values are
  `RecreationalRetail`, `RecreationalMedical`, `Wholesale`.
- **Impact:** Greenway is medical-endorsed (Slice 85 built DOH authorization
  intake). Medical-exempt sales exist and are being reported with the WRONG sale
  type. Compliance/tax-exemption mis-report.
- **Fix:** Determine per-order whether it was a qualifying medical (tax-exempt)
  sale and emit `RecreationalMedical` for those lines, else `RecreationalRetail`.
  Requires a medical/tax-exempt flag on the order (verify what the schema has;
  if none exists, surface a warning rather than guess — see Group G).

#### B2 — HIGH — StrainType can emit invalid enum values
- **Where:** `ccrs-batch.ts` `buildStrainFile` — passes `strain_type` through
  as-is and falls back to `"NotApplicable"`.
- **Spec (Data Model Manual, verified):** `StrainType` valid values are strictly
  `Indica`, `Sativa`, `Hybrid`.
- **Impact:** Any other value (including `NotApplicable`) → CCRS rejection of the
  Strain file (a Group-1 prerequisite; its failure blocks the whole batch).
- **Fix:** Normalize to the three valid values; when unknown, default to `Hybrid`
  (the safe superset) and warn, rather than emit an invalid token.

#### B3 — HIGH — CCRS dates use UTC, not Pacific (wrong calendar day near midnight)
- **Where:** `ccrs-sales.ts` `mmddyyyy()`, `ccrs-inventory-adjustment-core.ts`
  `mmddyyyy()`, `ccrs-batch-core.ts` `ccrsDate()` — ALL use `getUTCMonth/getUTCDate`.
- **Problem:** Greenway operates in Pacific time. A sale completed after ~4–5 PM
  Pacific is the NEXT day in UTC, so `SaleDate` (and `AdjustmentDate`,
  `CreatedDate`, header `SubmittedDate`) can report the WRONG Pacific calendar
  day. CCRS weeks run Sun–Sat, so a Saturday-evening sale can slip into the next
  week's file — a reporting-period error.
- **Contrast:** the reporting RANGE is already correctly Pacific-anchored
  (`src/lib/reports/range.ts` + `src/lib/reports/timezone.ts` with
  `pacificDayKey`, `pacificToday`). Only the CSV cell formatters were missed.
- **Fix:** Format CCRS dates from `pacificDayKey(instant)` (YYYY-MM-DD) → MM/DD/YYYY
  so every date is the Pacific calendar day. Centralize in one helper.

#### B4 — OK (verified correct) — Strain.csv shape
- `buildStrainFile` emits exactly `[License, Strain, StrainType, CreatedBy,
  CreatedDate]` (5 cols, no Operation/Updated*). Matches the manual (Strain is
  Insert-only, no Operation column). ✓ No change.

#### B5 — OK (verified correct) — AdjustmentReason mapping
- `mapAdjustmentReason` maps only to the 7 valid values
  (`Destruction/Reconciliation/Lost/Seizure/Theft/ReturnedLabSample/Other`). ✓

#### B6 — OK (verified correct) — Sale discount/tax math + UnitPrice semantics
- UnitPrice = pre-discount unit price; Discount = whole-line markdown; tax = on
  post-discount base; excise only for cannabis categories. Matches the manual's
  field definitions (UnitPrice one unit; Discount whole-line dollars; taxes total
  dollars). Money handled in minor units, converted at the boundary. ✓

---

## STATUS

- [x] Group A: CCRS Sale.csv + InventoryAdjustment.csv generators — **6 findings (4 CRITICAL)**
- [x] Group B: Sale.csv/date data semantics — **3 actionable (B1/B2/B3 HIGH) + 3 verified-OK**
- [x] Group C: Master-data files — **2 actionable (C1 HIGH, C2 MEDIUM) + verified-OK items**
- [x] Group D: External-identifier cross-file consistency — **verified OK (well-designed)**
- [x] Group E: Inbound CCRS manifest.csv parser (Slice 84) — **verified OK (well-grounded)**
- [x] Group F: Adjacent compliance (sales limits, excise) — **verified OK (grounded in WAC/RCW)**
- [ ] Group G: Fix implementation + unit tests + verification + PR (IN PROGRESS)

---

### GROUP E — Inbound CCRS manifest.csv parser (Slice 84) — VERIFIED OK

`ccrs-manifest-csv-core.ts` correctly models the hybrid header-block + item-table
format, validates UOM (Each/Gram), reconciles NumberRecords vs item count, and is
honest about the sparse-draft limitation (no name/strain/price/COA in a manifest).
Drafts-only; staff enrich on review. 53/53 pure tests. No change needed.

### GROUP F — Adjacent compliance — VERIFIED OK

`sales-limits-core.ts` is grounded in WAC 314-55-095 / RCW 69.50.360 (1 oz usable
= 28 g, 7 g concentrate, 16 oz solid, 72 oz liquid; medical 3×). Correctly framed
as an in-transaction guardrail, not a CCRS upload. Excise rates (37%/6.5%/2.8%)
match WA. No CCRS-file conformance risk here.

---

## REMEDIATION PLAN (Group G)

**One source of truth.** Make `ccrs-batch-core.ts` `CCRS_COLUMNS` the single
authoritative column spec (fix A1 there), add `InventoryAdjustment` column set with
the missing `ExternalIdentifier` (A5), and have `ccrs-sales.ts` +
`ccrs-inventory-adjustment-core.ts` import their columns from it (A6).

1. **A1** — `CCRS_COLUMNS.Sale`: `SalesTax→RetailSalesTax`, `OtherTax→CannabisExciseTax`.
2. **A2/A3** — `ccrs-sales.ts buildFile` → produce the 3-row header + `\r\n`
   (reuse `assembleCcrsFile` from batch-core with a `"Sale"` type).
3. **A4/A5** — `ccrs-inventory-adjustment-core.ts`: add `ExternalIdentifier` column,
   populate `ADJ-<id>`; emit 3-row header + `\r\n`; fix the self-test assertion.
4. **B1** — Sale `SaleType`: emit `RecreationalMedical` for qualifying medical
   (tax-exempt) sales; verify the order schema has a medical/exempt flag, else warn.
5. **B2** — `buildStrainFile`: normalize `StrainType` → {Indica,Sativa,Hybrid};
   unknown → `Hybrid` + warn (via a PURE helper, unit-tested).
6. **B3** — All CCRS date formatters → Pacific calendar day (`pacificDayKey`).
7. **C1** — PURE normalize/validate for `InventoryCategory`/`InventoryType`
   against the CCRS enums; unknown → keep value + emit an ERROR-level sync issue.
8. **C2** — Clamp master-data text fields to their documented lengths + warn.

Each change lands in a PURE `*-core.ts` with `__run…Tests()`, verified via tsx,
then tsc/eslint/build, then branch + PR + squash-merge into protected `main`.
Everything remains DRAFTS-ONLY: unknowns raise precise warnings for the employee;
we never invent a CCRS value.

## SUMMARY OF ACTIONABLE FINDINGS

| ID | Sev | File | Fix |
|----|-----|------|-----|
| A1 | CRITICAL | Sale tax column names | RetailSalesTax / CannabisExciseTax |
| A2 | CRITICAL | Sale.csv 2-row header | 3-row header via assembleCcrsFile |
| A3 | HIGH | Sale.csv `\n` endings | `\r\n` |
| A4 | CRITICAL | Adjustment 2-row header + `\n` | 3-row header + `\r\n` |
| A5 | CRITICAL | Adjustment missing ExternalIdentifier col | add 12th column |
| A6 | HIGH | Two disagreeing column defs | single source of truth |
| B1 | HIGH | Medical sale mis-typed | RecreationalMedical |
| B2 | HIGH | StrainType invalid values | normalize to Indica/Sativa/Hybrid |
| B3 | HIGH | UTC dates (wrong Pacific day) | pacificDayKey |
| C1 | HIGH | Product category/type not enum-validated | normalize + warn | ✅ Slice 92 |
| C2 | MEDIUM | Text length clamps | clamp + warn | ✅ Slice 92 |

**11 actionable findings (4 CRITICAL, 6 HIGH, 1 MEDIUM).** Groups D/E/F verified OK.

---

### GROUP C — Master-data files (Strain / Area / Product / Inventory)

> **RESOLVED — Slice 92 (PR pending).** Added PURE `CCRS_INVENTORY_CATEGORIES`
> (4) + `CCRS_INVENTORY_TYPES` (category→valid-type map) + `validateProductClassification`
> + `clampText`/`CCRS_PRODUCT_NAME_MAX`/`CCRS_PRODUCT_DESCRIPTION_MAX` in
> `ccrs-batch-core.ts`; wired into `buildProductFile`.
> **GROUNDING CORRECTION:** the enum table was re-grounded on the CURRENT
> **CCRS Upload User Guide (2026-02), Table 2** (the v2023+ enum), NOT the older
> Data Model Manual quoted below. The current names are `Clones`, `Cannabis Mix`,
> `Usable Cannabis`, and concentrates (`CO2`, `Ethanol`, `Hydrocarbon`,
> `Non-Solvent Based`) are now **EndProduct**. Legacy names (`Marijuana Mix`,
> `Usable Marijuana`, `Packaged Marijuana Mix`) are intentionally rejected so the
> employee re-maps them. Values are kept verbatim + an ERROR-level warning is raised
> — never invented (drafts-only).

#### C1 — HIGH — Product.csv emits un-normalized InventoryCategory / InventoryType
- **Where:** `ccrs-batch.ts` `buildProductFile` — passes `pos_inventory_category`
  and `pos_inventory_type` through RAW (POS/Cultivera free-text labels), with only
  a "missing" warning.
- **Spec (Data Model Manual, verified):**
  - `InventoryCategory` ∈ { `PropagationMaterial`, `HarvestedMaterial`,
    `IntermediateProduct`, `EndProduct` } (exactly 4).
  - `InventoryType` ∈ a **category-dependent** valid set (e.g. for `EndProduct`:
    Capsule, Solid Edible, Tincture, Liquid Edible, Transdermal, Topical Ointment,
    Suppository, Usable Marijuana, Sample Jar, Waste, Packaged Marijuana Mix,
    Marijuana Mix Infused, CBD; for `HarvestedMaterial`: Flower Lot, Flower Unlotted,
    Wet Flower, Other Material Lot, Waste, …).
- **Impact:** If the POS labels don't exactly match a CCRS enum value, the Product
  file (a Group-1 prerequisite) is rejected, blocking the entire batch.
- **Fix (no guessing):** Add a PURE normalization/validation layer that maps common
  POS category/type strings → the valid CCRS enum and, when a value is NOT in the
  valid set, emits the value unchanged but raises a precise `error`-level sync issue
  ("Product X has InventoryType 'Vape Cartridge' which is not a valid CCRS
  InventoryType for category EndProduct — map it before uploading"). Drafts-only:
  the employee resolves it; we never silently invent a category.

> **RESOLVED — Slice 92 (PR pending).** `clampText` clamps Product.Name→75 and
> Description→250 with a truncation warning; verified against the 2026-02 Upload
> User Guide field limits.

#### C2 — MEDIUM — Text length clamps not enforced on master-data fields
- **Spec:** Strain (50), Area (75), Product.Name (75), Description (250),
  InventoryCategory/Type (50).
- **Where:** master-data builders do not clamp to these lengths (Adjustment
  already clamps Detail to 250). An over-length value is rejected.
- **Fix:** Clamp each field to its documented length in the PURE mapping layer and
  warn when truncation occurs.

#### C2b — CRITICAL — FIXED 2026-10-06 (Bible v2 S-09) — the cell encoder deleted double quotes
- `ccrsCell` (and a separate copy in the adjustment core) removed every `"`
  from every value. 14 live Inventory rows reference Product names CCRS holds
  with a literal `"`; names match only in the "same format and spelling"
  `[G L0580-L0583]`, so those rows could never be addressed.
- Fixed: one lossless RFC 4180 encoder (quotes doubled, edge spaces protected,
  TAB / non-ASCII / inner spacing byte-for-byte). A value with CR/LF is never
  emitted; its row is withheld with blocking `E38_FIELD_HAS_LINE_BREAK`
  `[G L0167-L0169]` and listed. See `docs/ccrs-bible/04-current-state-and-gap-matrix.md` §A.4.

- Correction 2026-10-06 (S-11 recon): the 14 rows are quote-wrapped in the
  LCB's Inventory *report* only; the Product report stores those names with
  0 `"` (U-42). The fix stands on its own (lossless for every character).

#### C2d — CRITICAL — FIXED 2026-10-06 (S-09b) — CCRS does not honour CSV quoting
- PREprod run P20261005A: a comma inside an RFC 4180-quoted cell was split by
  CCRS, shifting the row; rejected `Operation is invalid must be Insert,
  Update or Delete`. Our S-09 encoder (and the legacy one before it) relied on
  quoting, so ANY comma in a Description, AdjustmentDetail, name or
  SubmittedBy would have failed the whole file in production.
- Fixed: the encoder never adds quotes; `,`/`"` in free text are rewritten
  (`E44`, advisory); in any other column the row is withheld (`E42`/`E43`,
  blocking, `[G L0167-L0169]`); the verifier counts columns the way CCRS does.
  Evidence `docs/ccrs-bible/evidence/P20261005A/`. Open: U-44, U-17 note.

#### C2c — HIGH — FIXED 2026-10-06 (Bible v2 S-11) — strain casing split across files; no ledger routing
- The Strain file deduped case-insensitively but each Inventory row kept its
  own casing, so `Dutch Treat` + `Dutch treat` sent one Strain row and an
  Inventory row naming a strain CCRS never received (`Invalid Strain`;
  Valid Values `Strain.Strain` `[G L0552]`; Brian A16).
- Fixed: one pure plan (`ccrs-ledger-core.ts`) writes one spelling in both
  files and raises advisory `E39_STRAIN_CASE_VARIANT` `[G L0359]`. With a
  ledger (S-12) the same plan routes Insert/Update/withhold per Part 03 §D.3,
  names filed lots by their filed product Name (`E40`, `[G L0580-L0583]`) and
  withholds the unprovable (`E41`, `[G L0246-L0248]`). See
  `docs/ccrs-bible/04-current-state-and-gap-matrix.md` §A.5.

#### C3 — OK (verified) — Boolean columns
- `IsQuarantine` (Area) and `IsMedical` (Inventory) emit `TRUE`/`FALSE`. Manual:
  Boolean, valid values TRUE/FALSE. ✓
#### C4 — OK (verified) — Area strategy
- Emitting `Sales Floor` (non-quarantine) + `Quarantine` (when needed) with stable
  `AREA-SALES-FLOOR` / `AREA-QUARANTINE` external ids, and Inventory.Area references
  those exact names. Internally consistent. ✓
#### C5 — OK (verified) — Product.UnitWeightGrams
- Converts unit_weight+uom → grams. ✓

---

### GROUP D — External-identifier cross-file consistency

**Verified OK — this is well-designed.** `ccrs-identifiers.ts`:
- ONE canonical inventory external id per lot, persisted on
  `inventory_lots.ccrs_inventory_external_id`, never drifts (preference order:
  stored → lot_code → pos_product_key → `LOT-<id>`).
- `sanitizeExternalId` enforces alnum+hyphen, ≤100 chars; `validateExternalId`
  surfaces precise problems.
- Sale lines resolve the SAME id (`resolveSaleInventoryExternalId`) and warn on
  the degraded product-key fallback; quarantine lots are flagged (CCRS rejects
  sales of quarantined inventory).
- The batch's sync analysis flags lots with no id (error) and lots whose product
  isn't in the published-menu Product.csv (warning) BEFORE upload.
- **One consistency risk to fix (folds into A5/A6):** the standalone
  InventoryAdjustment path and the batch's Product/Inventory paths must all use the
  identical derivation — they do call `deriveInventoryExternalId`, so the KEYS are
  consistent; the only defects are the file-shape/column ones (A4/A5). ✓

#### D1 — CORRECTED 2026-10-05 (Bible v2 S-10) — the "well-designed" verdict above was wrong in two places
- `deriveInventoryExternalId` re-sanitized the **stored** id, so a filed id such
  as `WAR413541.IN132IB0` was sent as `WAR413541-IN132IB0` — a different,
  nonexistent CCRS lot. 4,295 of our 62,744 filed ids are dotted.
- The InventoryAdjustment and sale-correction paths did not read the stored id
  at all; they re-derived from `lot_code`, so their id could differ from the one
  on Inventory.csv.
- Fixed: stored ids pass through (trim only); exports read only the assigned id
  and withhold an unassigned lot (`E3_EXTERNAL_ID_UNASSIGNED`); migration 0246
  restores the dotted ids 0034 rewrote. See `docs/ccrs-bible/04-current-state-and-gap-matrix.md` §A.3.

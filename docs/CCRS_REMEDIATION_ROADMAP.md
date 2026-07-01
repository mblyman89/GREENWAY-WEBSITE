# CCRS Compliance Remediation — Roadmap & Task List

> Fixes for the 11 actionable findings in `docs/CCRS_COMPLIANCE_AUDIT.md`.
> Owner directive: *"We need to fix them all… Be methodical, go slow and make
> certain CCRS is respected and adhered to strictly with all the necessary
> guardrails set up to protect me."* Standing rules apply; new binding rule
> added: **🔴 CCRS COMPLIANCE — ALWAYS CHECK AND SATISFY** (see AGENTS.md).
>
> Every slice: ground → PURE `*-core.ts` + `__run…Tests()` → verify (tsc 0,
> eslint 0, next build ok) → branch → PR → squash-merge → sync main.
> Everything stays DRAFTS-ONLY: unknown/invalid values raise precise employee
> warnings; we never invent a CCRS value.

## Guiding architecture decision
`src/lib/compliance/ccrs-batch-core.ts` becomes the **single source of truth**
for column specs, the 3-row header assembler, file naming, and (new) the valid
enums + normalize/validate helpers. The standalone Sale + InventoryAdjustment
builders import from it (no divergent copies).

Owner decision on B1: use the existing **`orders.medical`** flag as the source of
truth for `RecreationalMedical` (option a — cleanest, schema-backed signal).

---

## SLICES

### Slice 87 — Sale.csv conformance (A1 + A2 + A3 + A6)  [CRITICAL]
Fix the standalone Sale.csv generator + reconcile the column source of truth.
- `CCRS_COLUMNS.Sale`: `SalesTax→RetailSalesTax`, `OtherTax→CannabisExciseTax` (A1).
- `ccrs-sales.ts`: import columns from `ccrs-batch-core`; assemble via the shared
  3-row-header assembler with `\r\n` (A2, A3); delete the divergent local `COLUMNS`
  and `buildFile` (A6).
- Keep the mature data mapping (UnitPrice/Discount/tax math) unchanged.
- Tests: assert header shape, column names, NumberRecords == rows.

### Slice 88 — InventoryAdjustment.csv conformance (A4 + A5)  [CRITICAL]
- Add the missing 12th column `ExternalIdentifier` to `ADJUSTMENT_COLUMNS`,
  populated deterministically as `ADJ-<adjustment.id>` (sanitized, unique) (A5).
- Emit the 3-row header + `\r\n` (reuse the shared assembler) (A4); fix the
  self-test to assert the correct 3-row shape.
- Reconcile with `ccrs-batch-core.CCRS_COLUMNS.InventoryAdjustment`.
- Tests: 12 columns in order; header shape; ExternalIdentifier present + unique.

### Slice 89 — Pacific-time CCRS dates (B3)  [HIGH]
- New PURE helper `ccrsPacificDate(instant)` → `MM/DD/YYYY` from `pacificDayKey`.
- Replace UTC `mmddyyyy`/`ccrsDate` usages in `ccrs-sales.ts`,
  `ccrs-inventory-adjustment-core.ts`, `ccrs-batch-core.ts` (SubmittedDate,
  CreatedDate, SaleDate, AdjustmentDate).
- Tests: a 2025-06-15 23:30 Pacific instant formats as `06/15/2025` (not `06/16`).

### Slice 90 — SaleType RecreationalMedical (B1)  [HIGH]
- `ccrs-sales.ts`: SELECT `orders.medical`; emit `RecreationalMedical` when true,
  else `RecreationalRetail`. Validate against the SaleType enum in a PURE helper.
- Warn if a medical order is detected but the store lacks a DOH endorsement flag
  (surface, don't guess).
- Tests: medical order → RecreationalMedical; rec → RecreationalRetail; enum valid.

### Slice 91 — StrainType enum guardrail (B2)  [HIGH]
- PURE `normalizeStrainType(raw)` → `Indica|Sativa|Hybrid` (+ common synonyms:
  indica-dominant→Hybrid, S/I ratios→Hybrid, CBD→Hybrid); unknown → `Hybrid` +
  a warning collected upstream (never emit `NotApplicable`).
- Wire into `ccrs-batch.ts buildStrainFile`; add a sync issue listing any strains
  whose type had to be defaulted.
- Tests: valid passthrough; synonyms; unknown → Hybrid + flagged.

### Slice 92 — Product Category/Type enum + text-length guardrails (C1 + C2)  [HIGH/MED]
- PURE `CCRS_INVENTORY_CATEGORIES` (4) + category→valid-type table from the Data
  Model Manual; `validateProductClassification(category, type)` → normalized value
  or a precise error; `clampText(value, len)` helper.
- Wire into `ccrs-batch.ts buildProductFile`: keep the value, but raise an
  **error-level** sync issue when category/type isn't a valid CCRS enum, and clamp
  Name(75)/Description(250)/etc. with a warning on truncation.
- Tests: valid combos pass; invalid category/type flagged; clamp + warn.

---

## STATUS
- [x] Slice 87 — Sale.csv conformance (A1/A2/A3/A6) — CRITICAL
- [x] Slice 88 — InventoryAdjustment.csv conformance (A4/A5) — CRITICAL
- [x] Slice 89 — Pacific-time CCRS dates (B3) — HIGH
- [ ] Slice 90 — SaleType RecreationalMedical (B1) — HIGH
- [ ] Slice 91 — StrainType enum guardrail (B2) — HIGH
- [ ] Slice 92 — Product Category/Type + text-length guardrails (C1/C2) — HIGH/MED

All 11 findings covered across these 6 slices.

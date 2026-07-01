# Compliance Hardening — Roadmap (Slices 105–110)

**Owner intent (verbatim, this round):** "at this point I want to harden the ccrs
functions, and make sure every compliance related thing is baked in to protect me from
making a violation." + "please do the expert professional standard way, even if its the
hard way."

**Theme.** Turn compliance from *validates-on-demand* into *blocks-the-dangerous-action-
at-the-gate*. No new features — every slice makes an existing capability refuse to let the
owner commit a violation. Grounded in the WA LCB CCRS retailer file spec, WAC 314-55, and
the DOH medical rules already documented. Drafts-only for machine output; idempotent
migrations (owner runs manually); branch → PR → squash-merge; money in cents.

Standing rules respected: CCRS compliance + 🔴 DOH MEDICAL CANNABIS COMPLIANCE (binding).

---

## Slice 105 — CCRS pre-submission HARD GATE [HIGH] ✅ DONE
- PURE `ccrs-submit-gate-core.ts` `assertCcrsBatchSubmittable({syncIssues, verifierProblems,
  files, classifyWarning})` → `{ submittable, errors, warnings, issues }`. Consolidates
  builder sync issues + offline verifier problems + per-file warnings (classified with the
  REAL `classifyWarning`, so ERROR-prefixed file warnings are blocking, not buried).
- Export route `/admin/reports/compliance/batch-export` now **REFUSES (409)** to emit the
  .zip when any blocking error exists — the malformed CSVs are never created. Previously it
  wrote a DO-NOT-UPLOAD note into the README but still handed over the bad files.
- Report page uses the SAME verdict: the download button is **disabled** with the error
  count until the batch is clean, so the UI and the route agree exactly.
- Tests: 10 tsx assertions (clean/ sync-error / verifier-error / ERROR-file-warning /
  dedup / ordering / summary / injected classifier).

## Slice 106 — CCRS reporting-deadline guard [HIGH] ✅ DONE
- **VERIFIED FACT (two DISTINCT obligations — do not conflate):**
  1. **CCRS file uploads = WEEKLY.** LCB "CCRS Upload User Guide" (June 2025) states
     Inventory / InventoryAdjustment / InventoryTransfer "is required weekly by any licensed
     facility ... only when [there are changes]. No report is needed if there are no changes."
     The guide prescribes *weekly* cadence but does NOT publish a fixed weekday due date, so we
     must NOT assert "due Sunday" (that was an unverifiable claim in old UI copy — corrected).
     Grounded in WAC 314-55-083(4) (seed-to-sale traceability "kept completely up-to-date").
  2. **LIQ-1295 Retailer Sales & Tax report + excise payment = MONTHLY, by the 20th of the
     next month** (even with no sales); weekend/holiday rolls to next business day; 2% late
     penalty after due date. Grounded in RCW 69.50.535, WAC 314-55-089 / 314-55-092.
- Slice 106 models obligation #2 (the monthly LIQ-1295 deadline — the one with a hard statutory
  date and a money penalty). PURE `ccrs-deadline-core.ts`: `dueDateForPeriod`, `periodDeadline`,
  `reportingDeadlineOverview` (newest-first, most-urgent = OLDEST overdue = max penalty exposure),
  injectable holiday set (never guess a holiday list), UTC math, 17 tsx tests.
- Server reader `ccrs-filing-status.ts` derives which sales MONTHS have a full-month export on
  record from `ccrs_export_batches` (range_from/range_to) — labeled honestly as "export on
  record", NOT proof of a completed LCB filing. Surfaced read-only on the compliance page.
- Also corrected the compliance page's inaccurate "weekly Sale.csv ... due the following Sunday"
  copy to state the verified weekly-upload + monthly-LIQ-1295-by-the-20th facts.

## Slice 107 — Inventory "cannot go live dirty" gate [HIGH] ✅ DONE
- PURE `lot-activation-gate-core.ts`: `evaluateLotActivation(facts)` +
  `evaluateLotBatchActivation(lots)` → hard-blocks a lot from going ACTIVE when it is
  missing its CCRS `ccrs_inventory_external_id`, has NO lab result / COA on record, or
  carries a FAILED lab result (`labPassed === false`). Reason codes: `missing_ccrs_id`,
  `missing_lab_result`, `failed_lab_result`. A present-but-pending COA is allowed (soft,
  surfaced elsewhere) to avoid guessing intent. 15 tsx tests. Grounded in WAC 314-55-102,
  WAC 246-70-050, CCRS Upload Guide, WAC 314-55-083(4).
- Wired into `finalizeManifestDispositions`: the select now joins `lab_results(passed)` and
  reads `ccrs_inventory_external_id` / `lab_result_id`; every ACCEPTED lot runs the gate.
  Dirty lots are HELD in quarantine (status NOT flipped to active), the reasons are written
  to the lot notes + manifest event log, and the count is returned as `blocked[]`.
  derivedStatus falls to `partially_accepted` when lots are held. Nothing dirty reaches the
  floor. Intake detail page shows a red "N lots held in quarantine" banner (`?held=N`).

## Slice 108 — CCRS identifier integrity assertions [MED] ✅ DONE
- Extended PURE `ccrs-identifiers.ts` with: `validateLicenseNumber` (strict 6-digit retail
  licensee number; optional 10-digit lab), `findExternalIdCollisions` (distinct owners → same
  id), and `checkSaleIdentifierIntegrity` (SaleDetailExternalIdentifier unique within a sale;
  SaleType + SaleDate consistent per SaleExternalIdentifier — the CCRS "Duplicate Sale detail"
  rule). 27 tsx tests. Grounded in the CCRS Upload User Guide field spec.
- WIRED into `verifyCcrsFile` so they BLOCK through the Slice-105 gate: every file's
  `LicenseNumber` column is format-checked per row; Sale files run the sale-identifier
  integrity check; Strain/Product/Inventory files run ExternalIdentifier collision detection
  (Strain has no ExternalIdentifier per spec — correctly skipped; InventoryAdjustment reuses
  one inventory id across adjustments — correctly skipped). Verified firing via targeted tsx.

## Slice 109 — Sales-limit enforcement at POS (hard block + logged override) [HIGH] ✅ DONE
- OWNER DECISION (recorded): HARD BLOCK by default + permission-gated, LOGGED manager override.
- PURE `sales-limit-gate-core.ts`: `decideSalesLimitGate({blocked, enforce, hardBlock, reasons,
  override})` → `{decision: allow|override_applied|block, allowed, overLimit, overrideApplied,
  overrideAvailable, messages, reasons}`. enforce-off → allow; within → allow; soft over → allow
  flagged; hard over → BLOCK unless override is BOTH `permitted` (caller's permission check) AND
  carries a written reason. 13 tsx tests.
- Server gate `enforceSalesLimitForSale(lines, customerType, {actorId, override})` in
  `sales-limits.ts`: runs `evaluateCartWithSettings` + `decideSalesLimitGate`, ALWAYS logs the
  over-limit outcome (blocked or overridden) to `sales_limit_events`, returns the verdict. Sale
  paths must refuse to commit when `verdict.allowed === false`. Never trusts a client flag — the
  caller passes the RESULT of the permission check as `override.permitted`.
- New permission `sales_limit.override` (owner/admin/manager) in roles.ts (type, MATRIX, labels,
  ALL_PERMISSIONS). `logSalesLimitEvent` extended with override_applied/override_by/override_reason.
- Migration `0063_sales_limit_override.sql` (IDEMPOTENT — OWNER RUNS MANUALLY): adds
  override_applied/override_by/override_reason + an index to `sales_limit_events`.
- Sales-limits admin page: "Over-limit override log" audit card via
  `listRecentSalesLimitOverrides()` so the owner can see every authorized over-limit sale.
- NOTE: existing persisted sale path is the online reservation (`createOrder`, no category/
  customer-type data); the gate is the callable authority any register/POS sale path invokes.
  Wiring the live register UI to call it is a UI task, not a new capability.

## Slice 110 — "Compliance Health" panel [MED] ✅ DONE
- One read-only screen running every gate into a single "am I safe?" verdict.
- PURE aggregator `compliance-health-core.ts` (`buildComplianceHealth(facts)` → 6 checks +
  worst-level roll-up: critical > warning > unknown > ok). 18 tsx tests pass.
- SERVER reader `compliance-health.ts` (`getComplianceHealth(todayIso, opts)`) gathers live
  facts: CCRS upload cadence, monthly LIQ-1295 deadline, held dirty lots, medical-card expiry,
  exempt-record completeness, sales-limit posture + recent overrides. Any unreadable subsystem
  is reported honestly as `unknown` (never a false all-clear).
- Read-only page `src/app/admin/compliance/health/page.tsx` (permission `reports.view`),
  linked in the Insights nav group.
- NOTE (verified against migration 0031): `ccrs_export_batches` has NO error/warning verdict
  columns — it records only that an export was generated. So the CCRS check honestly measures
  upload CADENCE (weekly obligation: LCB CCRS Upload User Guide; WAC 314-55-083(4)) from
  `created_at`, rather than fabricating a submittable verdict. The Slice-105 hard gate at export
  time is what guarantees any emitted batch is well-formed.

---

## STATUS
- [x] Slice 105 — CCRS pre-submission hard gate — HIGH
- [x] Slice 106 — CCRS reporting-deadline guard — HIGH
- [x] Slice 107 — Inventory can't-go-live-dirty gate — HIGH
- [x] Slice 108 — CCRS identifier integrity assertions — MED
- [x] Slice 109 — Sales-limit enforcement at POS — HIGH
- [x] Slice 110 — Compliance Health panel — MED

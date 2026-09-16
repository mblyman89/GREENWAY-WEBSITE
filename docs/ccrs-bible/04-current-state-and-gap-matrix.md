# 04 — Current State and Gap Matrix

Every row: what the LCB says (pin into Part 02), what the code does (pin into Part 03 / the tree at the Part 03 commit), the gap, and the slice in Part 09 that closes it. Status values: `OPEN`, `PARTIAL`, `DONE`, `DEFERRED (owner)`, `UNVERIFIED → Part 12`.

## A. What exists today (the honest baseline)

**Nothing has ever been uploaded to CCRS from this system** (owner, Part 05 Q1/Q2). Cultivera is the assigned integrator and files weekly today. Therefore every "works" claim below means "produces a file the code's own verifier accepts", never "accepted by CCRS". `docs/BATTLE_TESTING_GUIDE.md` L25/L179 already records "The CCRS upload path end to end against the real portal" as untested.

### A.1 Generation pipeline (all present, all unit-tested, none portal-tested)

| Piece | Anchor | Notes |
|---|---|---|
| Column spec (7 files) | `ccrs-batch-core.ts` L37 `CCRS_COLUMNS` | Matches row 4 of each live template (Part 02 §8) and `docs/ccrs-templates/*.csv` (md5-identical to live, verified 2026-09-15). |
| File assembly | `ccrs-batch-core.ts` L632 `assembleCcrsFile`; header rows L641-L643 | Emits `SubmittedBy,<v>` / `SubmittedDate,<MM/DD/YYYY>` / `NumberRecords,<n>` with **no trailing-comma padding**; CRLF. Template header rows ARE padded to the column count (`[TPL Inventory R1]` = `SubmittedBy,,,,,,,,,,,,,`). Whether CCRS cares is **U-03**. |
| File naming | `ccrs-batch-core.ts` L602 `ccrsFileStamp` (UTC), L615 `ccrsFileName` | Guide names per file: `area_`, `strain_`, `product_`, `inventory_`, `inventoryAdjustment_`, `inventoryTransfer_`, `sale_` + `_LicenseNumber_YYYYMMDDHHMMSS` `[G L0267 L0337 L0397 L0538 L1066 L1173 L1276]`. FAQ: "the file name should be referenced in PST" `[FAQ L0075]`; code stamps **UTC** → **gap G-01**. Case-sensitivity of the prefix is unstated → **U-02**. |
| Upload groups | `ccrs-batch-core.ts` L560 `CCRS_UPLOAD_GROUPS`, L570 `uploadGroupOf` | Group 1 Strain/Area/Product → Group 2 Inventory → Group 3 Adjustment/Transfer/Sale; "at least 10 minutes" `[G L0530]`. Matches `[G]` p.4. |
| Strain builder | `ccrs-batch.ts` L160-L193 | Defaults unknown type to Hybrid (warning W7 L185). **No guard** for names Unknown/THC/Other `[G L0358]`, `[FAQ L0014]` → **E11**. |
| Area builder | `ccrs-batch.ts` L201-L213 | Always emits `Sales Floor`/FALSE/`AREA-SALES-FLOOR`; emits `Quarantine`/TRUE/`AREA-QUARANTINE` when any lot status is quarantine/recalled (L495). See **N-01**. |
| Product builder | `ccrs-batch.ts` L215-L349 | Name via `composeCcrsProductName`, disambiguation, clamps 75/250, classification via `deriveCcrsClassificationFromType` (L287); blocking E4 message L301 when mapping fails. `UnitWeightGrams` = lot weight or `""` (L249) → **E9**. Description not checked non-empty for Usable/Mix Packaged → **E10**. |
| Inventory builder | `ccrs-batch.ts` L351-L417 | Area L383 (`quarantine`/`recalled` → Quarantine); TotalCost L384 `(unit_cost_minor_units ?? 0) * received_qty` → can be `0.00` → **E7** `[G L0614]`; no `QuantityOnHand ≤ InitialQuantity` check → **E8** `[G L0597]`; IsMedical hard `"FALSE"` L393 (owner decision, Part 05 Q4 — correct for now); Operation always `Insert` L411 → **N-03**. |
| InventoryTransfer | `ccrs-batch.ts` L551-L555 | **Emitted empty on purpose** with a note saying retail intake is covered by Inventory.csv. Guide: "InventoryTransfer.CSV is required weekly by any licensed facility that receives inventory." `[G L1162]`; "Only the receiving licensee should submit an inventory transfer report" `[G L0126-L0128]`; retailer workflow step 9 "The retailer uploads a product to create a product, inventory and inventory transfer files." `[G L0143-L0144]` → **E14 (was F1), OPEN, REQUIRED**. Owner: "if it is required by the lcb or ccrs, then yes i want InventoryTransfer.csv populated from those manifests". |
| Sale builder | `ccrs-sales.ts` L183-L497 | Orders by completed_at/placed_at in range; medical exemptions from `medical_exempt_sales`; per-line pre-tax UnitPrice (L366), base (L374), Discount (L386), sales tax / excise (L388-L390); ids L416-L417; row L420-L440; warnings W1–W6 L443-L489. Excise identity vs LCB's "CannabisExciseTax must equal 37% of unit price" `[G L1374]` — our computation is 37% of the *post-discount base* which matches the FAQ worked example (`QTY=3, $5, disc $3 → Other Tax $4.44` = 37% × $12) `[FAQ L0155-L0160]`. No per-row self-check → **E12**. |
| Adjustment builder | `ccrs-inventory-adjustment-core.ts` L58 `mapAdjustmentReason`, L127 `adjustmentDetail`, L173 `mapAdjustmentRow`; `ccrs-inventory-adjustment.ts` L51 | Internal `return` → CCRS `Other` (comment L53 says detail REQUIRED). `adjustmentDetail(null)` returns `""` → **E13** `[G L1111]` "Inventory AdjustmentDetail missing". |
| Sale correction builder | `ccrs-sale-correction-core.ts` L85 `mapSaleCorrectionRow`, L139 `buildSaleCorrectionFile` | Delete for full-line return / Update for partial. FAQ: "the sale identifier should be deleted from CCRS, and the inventory identifier reported on an Inventory Adjustment as a return" `[FAQ L0039]`. Partial-return **Update** vs FAQ's **delete** → **U-09**. |
| Verifier | `ccrs-batch-core.ts` L776 `verifyCcrsFile`, L913 `verifyCcrsBatch`, L676 `verifySaleNumericColumns` | Checks header rows, NumberRecords, column row, enums, MMDDYYYY, numeric columns. Does not know about the template padding (U-03). |
| Submit gate | `ccrs-submit-gate-core.ts` L77 `assertCcrsBatchSubmittable`, L68 `defaultClassifyWarning` | Error iff message starts with "error" (case-insensitive). Zip refused on any error (`batch-export/route.ts` L58-L61). `__runCcrsSubmitGateTests` (L149) is **never imported by a test file** → **T-01 gap**. |
| Zip export | `batch-export/route.ts` L26-L145 | `CCRS_batch_<license>_<from>_<to>.zip` containing the 7 files. |
| Week model | `ccrs-week-core.ts` L80 `weekFromStart` (due = end + 1 day), L96, L117, L137, L170, L215, L234 | Sunday–Saturday, due Sunday — matches `[FAQ L0041]`. |
| Ledger | `0118` `ccrs_week_submissions`; `ccrs-week-store.ts` L81 `resolveWeek`, L125, L139 `setWeekErrorStatus`; `actions.ts` L27/L82/L104 | `resolution ∈ {submitted, nothing_to_report}`; `error_status ∈ {clean, errors_reported, resolved}`; `error_notes` free text. No place for the **pasted LCB email body**, per-file verdict, or the re-upload filename → **E15**. |
| Error triage | `ccrs-error-triage-core.ts` L54-L159 RULES (10 rules), L164 `triageCcrsErrorEmail`, L245 `buildExaminerDraft` | Needle-substring match; first wins. Rules cover 10 of the ~60 error strings in Part 02 §1 → **E16** (coverage table in §C below). Not wired to the ledger (E15). |
| Walkthrough | `UploadWalkthrough.tsx` L144-L256 (8 steps), `PORTAL_URL` L30, `WAIT_MINUTES` L31, localStorage L54-L64 | Human steps encoded correctly per `[G]` p.4-6. Progress in **localStorage** only → lost across devices → **E17**. |
| Reminders | `ccrs-week-core.ts` L215 `ReminderStage`, `PushRemindersPanel.tsx`, `compliance_reminder_log`, `push_subscriptions` (0118) | Present. |
| License settings | `0031` `license_settings` singleton; `LicenseSettingsForm.tsx` (Reports tab only) | Hub cannot edit license number / SubmittedBy → **E1-UI** (owner Q6). |
| Hub page | `compliance/ccrs/page.tsx` — Step 1 L282, Step 2 L313, Advisor L378, Walkthrough L382, Step 3 L397, DOH L532, LIQ-1295 L587, ledger L626 | Two pages exist (`/admin/compliance/ccrs` and `/admin/reports/compliance`, 477 L, 13 blocks). Owner: one hub → **E18**. |

### A.2 Identity lineage (why Part 07 exists)

- Cultivera CSV import: `import-lot-core.ts` L17-L19 "Barcode is ALWAYS populated … and is the [identifier]"; L47-L48 "Cultivera Barcode — the CCRS-filed inventory identifier"; L420 `ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode`.
- `import-service.ts` L446-L455: imported lots are `active` (not quarantine) because they were "already received, tested, and reported to CCRS by the previous POS (Cultivera is a WSLCB integrator; the Barcode column is the identifier it filed)".
- Receiving intake: `intake-store.ts` L659 writes `ccrs_inventory_external_id = deriveInventoryExternalId({pos_product_key, lot_code})`; `intake-parser.ts` L371 `lot_code ← item.inventory_id` (WCIA JSON — this is the **vendor's** CCRS InventoryExternalIdentifier), L414 `pos_product_key ← sku ?? lot_code`; CCRS manifest.csv path `ccrs-manifest-csv-core.ts` L492-L498 `lot_code ← InventoryExternalIdentifier`.
- `deriveInventoryExternalId` (`ccrs-identifiers.ts` L221-L236): explicit → lot_code → pos_product_key → `LOT-<uuid>`. `sanitizeExternalId` (L41-L47) replaces every non-alphanumeric run with `-`. **Consequence:** a vendor id like `WCIA_00123.4` becomes `WCIA-00123-4`; if we then Insert that as our Inventory ExternalIdentifier it differs from the vendor's `FromInventoryExternalIdentifier`, which is exactly the case the guide says demands an InventoryTransfer row with both ids `[G L0124-L0128]`, `[FAQ L0058-L0059]`. See **N-02**.
- Sale.csv uses `resolveSaleInventoryExternalId` (L245): line override → lot canonical → sanitized pos key (degraded, W2).

## B. Gap matrix — errors (blocking) and warnings

Legend: **Spec** = LCB text pin; **Code** = current behaviour pin; **Fix** = what the slice must do; **Slice** = Part 09 id.

| ID | Status | Spec | Code (today) | Fix | Slice |
|---|---|---|---|---|---|
| E1 | PARTIAL | Header `SubmittedBy` required `[G L0209-L0253]`; filename needs license `[G L0046]` | `ccrs-batch.ts` L444 blocks when `license_settings.license_number` empty; editor only on Reports tab | Move `LicenseSettingsForm` into hub Step 0 "Licence & identity"; block-with-link instead of dead end | S-08 |
| E2 | DONE | — | L452 Supabase not configured | none | — |
| E3 | DONE | ExternalIdentifier required `[G L0224]` | L572-L587 counts lots with no id (practically unreachable given LOT-uuid fallback) | keep; add row list (see W12) | S-03 |
| E4 | DONE | Product category/type enums `[G]` p.13-15 | L287/L301 blocking message | keep; add fix-link to type mapping UI | S-08 |
| E5 | DONE | header/NumberRecords/enums | `verifyCcrsFile` | keep | — |
| E6 | DONE | numeric columns | `verifySaleNumericColumns` L676 | keep | — |
| E7 | OPEN | "TotalCost cannot equal 0" `[G L0614]`; trade samples $0.01 `[FAQ L0035]` | L384 emits `0.00` when `unit_cost_minor_units` null | Pre-flight error per lot: TotalCost ≤ 0 → blocking, with link to the lot cost editor; samples (`is_sample`, 0024 L32) → emit `0.01` and require name/description "Trade Sample" `[FAQ L0035]` | S-02 |
| E8 | OPEN | "QuanityOnHand is greater than InitialQuantity" `[G L0597]` (sic) | no comparison | Pre-flight error when `on_hand_qty > received_qty`; link to lot | S-02 |
| E9 | OPEN | UnitWeightGrams required; "If Useable Cannabis is selected, Unit Weight Gram cannot be 0" `[G L0434]`; other types "can be reported as 0" `[G L0490]`; FAQ unit examples `[FAQ L0061-L0066]` | L249 `?? ""` | Blank → `0` for non-Usable types; Usable Cannabis / Cannabis Mix Packaged with 0/blank → blocking error with link | S-02 |
| E10 | OPEN | Description required when Usable Cannabis or Cannabis Mix Packaged `[G]` p.14 | none | blocking error for those types when empty | S-02 |
| E11 | OPEN | "Strain name is invalid, cannot be Unknown, THC, or Other" `[G L0358]`, `[FAQ L0014-L0015]` | none | blocking error; link to `knowledge-base/StrainEditor.tsx` | S-02 |
| E12 | OPEN | "CannabisExciseTax does not equal 37% of UnitPrice" `[G L1377]`; worked example `[FAQ L0155-L0160]` | computed once, never re-checked | Per-row identity check `round(37% × (Qty×UnitPrice − Discount)) == CannabisExciseTax` (±1¢) unless SaleType RecreationalMedical with exemption; blocking | S-02 |
| E13 | OPEN | "Inventory AdjustmentDetail missing" for Other/Theft `[G L1111]` | `adjustmentDetail()` L127 returns `""` | `mapAdjustmentRow` → blocking when reason ∈ {Other, Theft} and detail empty; the customer-return path already writes a note (`disposition.ts` L676-L684) so this mainly guards manual adjustments | S-02 |
| E14 | OPEN | InventoryTransfer required for receivers `[G L1162]`, `[G L0126-L0128]`, `[G L0143-L0144]`; all fields required; errors `[G L1190-L1205]` incl. "ToLicense cannot be the same license number as FromLicense" | emitted empty L551-L555 | Build rows from accepted intake lots: `FromLicenseNumber = vendors.license_number` (0064), `ToLicenseNumber = license_settings.license_number`, `FromInventoryExternalIdentifier = vendor id (raw, unsanitized)`, `ToInventoryExternalIdentifier = lot.ccrs_inventory_external_id`, `Quantity = received_qty`, `TransferDate = received_on` (0214), `ExternalIdentifier = TR-<lot ccrs id>` (unique), Operation Insert. Requires a new column to store the vendor's raw id (N-02). | S-05 |
| E15 | OPEN | Errors arrive only by email `[G L0051]`; only the uploader gets it `[FAQ L0102]` | ledger has `error_status` + free `error_notes` only | New table `ccrs_upload_events` (week_key, file_type, file_name, uploaded_at, portal_env prod/preprod, lcb_email_raw, triage_json, resolved_at) — the pasted email becomes the LCB verdict; ledger derives `error_status` | S-06 |
| E16 | PARTIAL | ~60 error strings in Part 02 §1 | 10 triage rules | Extend RULES to every error string in the guide with a pin per rule; every rule maps to a fix-link target | S-06 |
| E17 | OPEN | — | Walkthrough progress in localStorage L54-L64 | Persist step state in `ccrs_upload_events` (same as E15) so phone/desktop agree and the ledger sees "Group 1 uploaded at 14:02" | S-06 |
| E18 | OPEN | — (owner Q6) | two pages | `/admin/reports/compliance` → one card linking to hub; all blocks moved | S-08 |
| W1 | OPEN→error | Sale InventoryExternalIdentifier required `[G]` Table 6 p.41 | `ccrs-sales.ts` L447 warning | severity error + row list | S-03 |
| W2 | OPEN→error | same | L452 fell back to POS key | error unless the key is proven filed (Part 07) | S-03 |
| W3 | keep | — | L457 sanitized ids | warning | — |
| W4 | OPEN→error | "Sold item cannot be in Quarantine" `[G L1305]` | L462 warning | error + row list; also fix inconsistency: sale lot index treats only `status==="quarantine"` as quarantined (`ccrs-sales.ts` L163) while inventory builder treats `recalled` too (L383) → align both on one pure predicate | S-03 |
| W5 | OPEN | — | L467 skipped lines count | warning + row list (line ids) | S-03 |
| W6 | DEFERRED (owner) | medical `[FAQ L0117-L0121]` | L470-L489 | Part 10 | S-10 |
| W7 | keep | StrainType enum `[G]` p.12 | L185 defaulted to Hybrid | warning + link | S-03 |
| W8/W9 | keep | — | L273/L298 | info | — |
| W10/W11 | keep | Name 75 / Description 250 | L307/L322/L314 | warning + link | S-03 |
| W12 | OPEN→error | — | L368 lot skipped no id; capped 25 (L416) then 5 (L624-L636) | error + full row list (no caps on errors) | S-03 |
| W13 | OPEN | Product must exist `[G L0579]` | L379 lot has no product name | warning + link to `menu-imports` | S-03 |
| W14 | keep | ExternalIdentifier rules | L414 | warning | — |
| W15 | OPEN→error | no Product file possible | L471 no published menu; L599 orphan lots | error | S-03 |
| W16 | OPEN | — | `ccrs-inventory-adjustment.ts` ~L100 skipReason | warning + row list | S-03 |

## C. New flags found in this session (N-series)

| ID | Status | Spec | Code | What to do | Slice |
|---|---|---|---|---|---|
| N-01 Area "Quarantine"=TRUE | OPEN, compliance risk | "IsQuarantine True only applies to imported CBD. There are no quarantine requirements for cannabis" `[G L0298]`; FAQ: "Please be sure that Area is NOT set by default to 'TRUE' … the system will treat inventory and products contained in that area as being in quarantine" `[FAQ L0051]`; "Sold item cannot be in Quarantine" `[G L1305]` | `buildAreaFile` L201-L213 emits `Quarantine`/`TRUE`; `buildInventoryFile` L383 puts quarantine/recalled lots there | Rename to an internal hold area with `IsQuarantine=FALSE` (e.g. `Hold`/`AREA-HOLD`) unless the lot is imported CBD awaiting tests; keep our internal quarantine semantics in the app, not in CCRS. Confirm with examiner (U-04) before shipping; it changes what Cultivera may have filed for Area. | S-04 |
| N-02 vendor id lost at intake | OPEN, blocks E14 | InventoryTransfer needs the vendor's exact `FromInventoryExternalIdentifier` `[G L1158-L1205]`; wrong value → "Invalid FromInventoryExternalIdentifier" `[G L1191]` | intake stores `lot_code ← inventory_id` then derives a **sanitized** ccrs id; `inbound_manifests` has no vendor-id column (0023 L22-L38); `raw_payload` keeps the JSON | Migration: `inventory_lots.vendor_inventory_external_id text` (raw, never sanitized) set at intake from `inventory_id` / manifest `InventoryExternalIdentifier`; backfill from `raw_payload` where possible; report count of lots where it is unknown | S-05 |
| N-03 Insert-only Inventory | OPEN | "Update … The record doesn't exist, so an error message would be received" `[FAQ L0052-L0053]`; Duplicate rules per file | every Inventory row `Insert` (L411) every week; Strain duplicate = no action `[G L0325]`; InventoryTransfer duplicate = error `[G L1190]`; Sale duplicate = error `[G L1390]` | Track `ccrs_first_reported_at`/`ccrs_last_reported_at` per lot (or per week in `ccrs_upload_events`); emit Insert once, Update after (with UpdatedBy/UpdatedDate `[G]` p.8); the Inventory guide p.16 says file is required weekly "only when unreported/updates" — so also stop re-sending unchanged lots. Settle behaviour of re-Insert in PREprod first (**U-05**). | S-05 |
| N-04 header padding | UNVERIFIED | templates pad header rows with commas `[TPL * R1-R3]` | `assembleCcrsFile` L641-L643 no padding | **U-03** PREprod test; if CCRS rejects, pad to column count and update goldens | S-01 |
| N-05 UTC file stamp | OPEN | "file name should be referenced in PST" `[FAQ L0075]` | `ccrsFileStamp` L602-L608 uses `getUTC*` | Use Pacific wall-clock (`America/Los_Angeles`, rule 9) for the stamp; golden fixtures fix the date so no diff expected — add a test with a UTC/PST-straddling instant | S-01 |
| N-06 gate self-test never run | OPEN | — | `__runCcrsSubmitGateTests` L149 not imported by `tests/compliance/pure-selftests.test.ts` | add to the self-test runner | S-01 |
| N-07 stale prose | OPEN | API guide exists (Part 02 §3); no "Processing Status" page in guide | `docs/CCRS_SELF_REPORTING_GUIDE.md` A5.4 "Processing Status (PST)", Part C "no API" | correct both to point at Part 02 | S-08 |
| N-08 duplicate strain benign vs Strain file weekly | INFO | "Duplicate Strain" = no action `[G L0325 L0359]` | triage rule `duplicate_strain` benign — correct | none | — |
| N-09 SaleDetail uniqueness | INFO | "All records with the same SaleExternalIdentifier have a unique SaleDetailExternalIdentifier" `[G L0397-L1399]` | `${saleExternalId}-${l.id.slice(0,8)}` L417 — 8 hex chars of a uuid; collision within one order practically impossible; `checkSaleIdentifierIntegrity` (`ccrs-identifiers.ts` L146) exists | keep; ensure integrity check is in the gate as error | S-03 |
| N-10 WA.gov | OPEN | Oct 2026, manual account `[FAQ L0010-L0012]` | `PORTAL_URL` L30 + SAW wording in walkthrough and `docs/CCRS_SELF_REPORTING_GUIDE.md` | Part 11 | S-09 |

## D. Known conflicts between repo prose and the LCB sources (LCB wins)

1. `docs/CCRS_SELF_REPORTING_GUIDE.md` A5.4 "Processing Status (PST)" page — no such page in `[G]`; "PST" in `[FAQ L0075]` is the time zone.
2. `docs/CCRS_SELF_REPORTING_GUIDE.md` Part C "no API" and `[FAQ L0179]` — superseded for integrators by the Aug 2026 API guide (Part 02 §3). Licensee flow unchanged.
3. `ccrs-batch.ts` L551-L555 comment "retail intake is reported via Inventory.csv" — contradicted by `[G L1162]` and `[G L0143-L0144]`.
4. `buildAreaFile` semantics — contradicted by `[G L0298]` / `[FAQ L0051]` (N-01).
5. `ccrs-identifiers.ts` L37-L39 comment "hyphens are widely accepted and used by integrators" — not in any LCB text; treat as UNVERIFIED (**U-06**) and test in PREprod with a hyphenated id.

## E. Test coverage baseline (at Part 03 commit)

- `tests/compliance/ccrs-batch.test.ts` — 41 tests green; golden CSVs for 7 files (`SubmittedDate,06/15/2025`, CRLF).
- `tests/compliance/pure-selftests.test.ts` — 47 green; runs the `__run…Tests()` of the pure cores **except** the submit gate (N-06).
- No test exercises: E7–E14 conditions, N-01 area semantics, filename PST, header padding, ledger↔email linkage, walkthrough persistence.

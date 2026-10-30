# 09 — Slice Plan (binding order, tests-first)

Every slice follows Part 01 §D (recon → ground → tests first → implement → verify → docs → PR → handoff). Code pins are against `c1ca753` (Part 03 header). Spec pins resolve in Part 02. Issue codes are the exact strings in Part 08 §C.

Order is binding because later slices depend on earlier types (`code`/`rows` on `CcrsSyncIssue` from S-03 are consumed by S-08; `ccrs_upload_events` from S-06 is consumed by S-07's env stamping and S-08's ledger). "Ship 6 slices at a time" (AGENTS.md) — S-01…S-06 is the first batch, S-07…S-10 the second.

Branch names: `ccrs/s-01-hygiene`, `ccrs/s-02-preflight-errors`, etc. PR title: `ccrs(S-0N): <kebab>`. Commit author `Greenway Dev <dev@greenwaymarijuana.com>`. Rebase-merge only.

Golden fixtures: `tests/compliance/golden/ccrs/*.golden.csv` (7 files), fixture `tests/compliance/fixtures/ccrs-fixture.ts` (`FIXTURE_LICENSE "413541"` L16, `FIXTURE_SUBMITTED_AT` UTC 2025-06-15 20:00 L23, `FIXTURE_LATE_EVENING_UTC` 2025-06-16 04:30 L30, `FIXTURE_ROWS` L33), regenerated only by `scripts/compliance/generate-golden-ccrs.ts`. Any golden diff must be intentional and justified with a pin in the PR body.

Self-test runner: `tests/compliance/pure-selftests.test.ts` — CCRS entries today at L44-L46 (imports) and L180-L193 (`it(...)` blocks). Every new `*-core.ts` registers here.

---

## S-01 — Hygiene: Pacific file stamp, header padding decision, gate self-test

**STATUS: LANDED** — commit `acb6d32`. `ccrsFileStamp` is Pacific, `padHeaderRowsForTemplates` exists behind an opt-in (default off, pending U-03), the submit-gate self-test is registered, and `scripts/ccrs-bible/mutate_check.py` was introduced.

**Closes:** N-05, N-06; prepares N-04/U-03.
**Files:** `src/lib/compliance/ccrs-batch-core.ts` (L602-L608 `ccrsFileStamp`, L615 `ccrsFileName`, L632-L643 `assembleCcrsFile`), `src/lib/compliance/ccrs-submit-gate-core.ts` (L149 `__runCcrsSubmitGateTests`), `tests/compliance/pure-selftests.test.ts`, `tests/compliance/ccrs-batch.test.ts`.

### Ground
- Filename `<type>_<license>_YYYYMMDDHHMMSS` `[G L0046]`; "file name should be referenced in PST" `[FAQ L0075]`; per-file filename lines `[G L0267]` `[G L0337]` `[G L0397]` `[G L0538]` `[G L1066]` `[G L1173]` `[G L1276]`.
- AGENTS.md: Pacific is the business clock; calendar-day logic anchors to `America/Los_Angeles`.
- Header rows: templates `[TPL Strain R1-R3]` … pad with commas to column count; guide text `[G L0209-L0253]` does not state padding. Behaviour UNVERIFIED → U-03 (Part 06 T-10/T-11).

### Tests first
1. `ccrs-batch-core`: `ccrsFileStamp(FIXTURE_LATE_EVENING_UTC)` (2025-06-16 04:30Z = 2025-06-15 21:30 PDT) → `"20250615213000"`. Today it returns `"20250616043000"` (UTC) — the test must fail first. Comment pin `[FAQ L0075]`.
2. `ccrsFileStamp(FIXTURE_SUBMITTED_AT)` (2025-06-15 20:00Z = 13:00 PDT) → `"20250615130000"`. **Golden filenames** in `ccrs-batch.test.ts` — check what they assert; if they assert the UTC stamp string, update the expected string with the pin. The golden CSV *content* uses `SubmittedDate,06/15/2025` which is unchanged (same Pacific day).
3. Winter instant (PST, −8): `new Date(Date.UTC(2025,0,5,7,59,0))` → `"20250104235900"`.
4. Register `__runCcrsSubmitGateTests` in `pure-selftests.test.ts` (import next to L46, `it` block next to L190); assert `failed === 0`. If the self-test itself is red at first run, fix the *test* only if it is provably wrong against Part 02; otherwise fix the gate.
5. Padding: add a **feature flag** `CCRS_PAD_HEADER_ROWS` (module const, default `false`) in `ccrs-batch-core.ts` and a test for both values: padded header row 1 equals `SubmittedBy,<v>` + `,` × (columns−2). Do **not** flip the default until U-03 is closed in Part 12. Golden files unchanged at default.

### Implement
- `ccrsFileStamp`: use `Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, year/month/day/hour/minute/second: "2-digit" })` → assemble. Check for an existing Pacific helper first (`grep -rn "America/Los_Angeles" src/lib` — `ccrsDate` in `ccrs-inventory-adjustment-core.ts` L109 delegates to a shared formatter; reuse that module's approach rather than adding a second one). Handle the `24` hour edge some engines emit for midnight (`hourCycle: "h23"`).
- `assembleCcrsFile` L641-L643: when flag true, pad rows 1-3 to `CCRS_COLUMNS[type].length` (L37) with commas.

### Verify
tsc 0, eslint 0, `npx vitest run tests/compliance/ccrs-batch.test.ts tests/compliance/pure-selftests.test.ts` green, `npm run build` ok.

### Docs
Part 04 N-05 → DONE, N-06 → DONE, N-04 → "flag present, default off, awaiting U-03". Regenerate Part 03.

### Acceptance
- A file generated at 21:30 Pacific Sunday is named with Sunday's date, not Monday's.
- Gate self-test runs in CI.
- Flipping the padding flag changes only rows 1-3 and all 7 goldens still parse via `verifyCcrsFile` (L776) in both modes.

---

## S-02 — Pre-flight blocking errors E7–E13

**STATUS: LANDED.** All seven checks live in `src/lib/compliance/ccrs-preflight-core.ts` (pure, no I/O), are called by the real builders via `inventoryRowVerdict` / `productRowIssues`, and are covered by `tests/compliance/ccrs-preflight.test.ts` (59 tests).

Three deviations from the plan below, each deliberate:

1. **A new pure module rather than edits inside `ccrs-batch.ts`.** That file is `server-only` and its per-file builders are module-private — only `buildCcrsBatch` is exported — so a test could not reach them without either weakening encapsulation or mocking Supabase. Extracting the row-level decisions into a pure core lets the tests exercise the *real* code path instead of a copy. This is also why `code` **and** `rows` both landed here (the plan allowed it): withholding a row is useless if the hub cannot say which rows.
2. **E10's pin was located, as the plan demanded.** `[G L0482-L0483]`. See Part 05 D-13 — it is a Note with no matching error string, which materially changes how much we should trust it. T-19 decides.
3. **A PREproduction generator was added** (`scripts/compliance/generate-preprod-test-files.ts`, Part 06 §A2). Not in the plan, but the owner asked to begin real upload testing, and no correct application can emit the deliberately-invalid files the test plan requires.

**Closes:** E7, E8, E9, E10, E11, E12, E13.
**Files:** `ccrs-batch.ts` (`buildStrainFile` L160-L193, `buildProductFile` L215-L349, `buildInventoryFile` L351-L417, `buildCcrsBatch` L424-L652), `ccrs-sales.ts` (L366-L390 pricing, L416-L417 ids), `ccrs-inventory-adjustment-core.ts` (`adjustmentDetail` L127, `mapAdjustmentRow` L173-L200), `ccrs-batch-core.ts` (new codes union next to L521).
**Depends on:** S-01 (nothing structural; just ordering). Introduces `code` on `CcrsSyncIssue` minimally (S-03 adds `rows`). If it is smaller to land `code`+`rows` together, do it here and S-03 consumes.

### Ground (one pin per check; copy into the test file)
- E7 "TotalCost cannot equal 0" `[G L0614]`; trade samples `[FAQ L0035]` ($0.01); TotalCost meaning `[FAQ L0057]`.
- E8 "QuanityOnHand is greater than InitialQuantity" `[G L0597]`.
- E9 "UnitWeightGrams … cannot be 0" for Usable Cannabis `[G L0434]`; others "can be reported as 0" `[G L0490]`; unit examples `[FAQ L0061-L0066]`.
- E10 Description required for Usable Cannabis / Cannabis Mix Packaged — Part 02 §1 guide p.14 (L383-L521 range; locate the exact line with `grep -n "Description" lcb/guide.txt` and pin it in the test; do not ship with a page-only pin).
- E11 "Strain name is invalid, cannot be Unknown, THC, or Other" `[G L0358]`; `[FAQ L0014]`.
- E12 "CannabisExciseTax does not equal 37% of UnitPrice" `[G L1377]`; worked example `[FAQ L0155-L0160]` ($1.20 on $4.44 … copy the exact figures from Part 02 into the test).
- E13 "Inventory AdjustmentDetail missing" `[G L1111]` (Other/Theft).

### Tests first (`tests/compliance/ccrs-preflight.test.ts`, new)
Use `FIXTURE_ROWS` shapes from `ccrs-fixture.ts` for valid baselines, then mutate one field per test:
1. Inventory lot with `unit_cost_minor_units = null` → issue `E7_TOTALCOST_ZERO`, severity error, `rows[0].id === lot.id`. Lot with `is_sample = true` (0024 L32) and null cost → row emits `TotalCost 0.01`, **no** error, and Product Description for that product contains "Trade Sample" (else `E7_SAMPLE_DESCRIPTION` error). (Pin `[FAQ L0035]`.)
2. `on_hand_qty 12 > received_qty 10` → `E8_ONHAND_GT_INITIAL` with `detail "on_hand 12 > received 10"`.
3. Product `InventoryType = Usable Cannabis`, `unit_weight null` → `E9_UNITWEIGHT_ZERO_USABLE`; `InventoryType = Concentrate`, `unit_weight null` → row emits `0`, no issue.
4. Usable Cannabis with empty description → `E10_DESCRIPTION_REQUIRED`.
5. Strain named `Unknown`, `THC`, `Other` (case-insensitive, trimmed) → `E11_STRAIN_NAME_RESERVED`; strain `Other Kush` passes.
6. Sale row using the FAQ's own example verbatim `[FAQ L0155-L0160]`: "QTY = 3", "Unit Price = $5.00", "Discount = $3.00", "Sales Tax (10%) = $1.20", "Other Tax (37%) = $4.44" — i.e. base = 3×5.00−3.00 = 12.00; excise = 0.37×12.00 = 4.44; sales tax = 0.10×12.00 = 1.20. Assert the builder emits `CannabisExciseTax 4.44` for that row, and that a row with stored excise ≠ 0.37×(Qty×UnitPrice−Discount) beyond ±0.01 → `E12_EXCISE_NOT_37PCT`. Also test a rounding edge (base 12.01 → 4.4437 → `4.44`) and confirm the half-cent rule matches `applyBps` in `ccrs-sales.ts` L374-L390. Medical exempt row (`medical_exempt_sales` 0040) → tax 0 allowed only when `SaleType = RecreationalMedical` (`[G L1378]` "Only Medical … 0"); Part 10 governs when that can occur — until then the check must still pass for the current `IsMedical=FALSE` world.
7. `mapAdjustmentRow` with reason mapping to `Other` or `Theft` and empty note → returns `{ row: null, skipReason }` **and** the batch surfaces `E13_ADJUSTMENT_DETAIL_MISSING` as an error (not a silent skip). Customer-return rows (`disposition.ts` L679-L684 writes a note) keep passing.
8. Every issue emitted by `buildCcrsBatch` on the fixture has `code` defined (contract test for Part 08 §C).

### Implement
- `buildInventoryFile` L384: compute `TotalCost`; if `is_sample` → `"0.01"`; else if ≤ 0 → push issue (do **not** emit the row; a row that will be rejected is worse than a missing row with an error in front of it — the gate blocks the zip anyway).
- L351-L417: E8 compare `on_hand_qty` vs `received_qty` before emitting.
- `buildProductFile` L249: `unit_weight_grams` blank → `"0"` unless type ∈ {Usable Cannabis, Cannabis Mix Packaged} → issue. L215-L349 E10 description check on the same type set.
- `buildStrainFile` L160-L193: reserved-name check.
- `ccrs-sales.ts` L388-L390: after computing tax, recompute independently from base and compare; push `E12` with `rows[{id: order id, label: order number, detail: "stored 1.20 expected 1.64"}]`.
- `ccrs-inventory-adjustment-core.ts` L173: return `skipReason` with a stable prefix `E13:` so the I/O wrapper (`ccrs-inventory-adjustment.ts` ~L100) maps it to the coded issue rather than W16.
- `ccrs-batch-core.ts`: `export const CCRS_ISSUE_CODES = [...] as const; export type CcrsIssueCode = typeof CCRS_ISSUE_CODES[number];`.

### Verify
Full compliance suite. Goldens: the fixture must remain **valid** under the new checks — if a golden row now trips E7/E9/E10, the fixture data was wrong (it has no cost / no weight) and both fixture and golden are regenerated with the pin cited in the PR. Expect this for TotalCost.

### Acceptance
- Each of E7–E13 has a failing-then-passing test with the pin in a comment.
- The hub and zip route block on any of them (gate unchanged; severity error suffices).
- `syncIssues` from the fixture contain no code-less entries.

---

## S-02b — Align pre-flight with what CCRS actually did (small, high value, do first)

**Why now:** the 2026-09-17 run (Part 15) proved one of our gates blocks a file CCRS would
accept, and revealed two cheap gates we are missing. Small, self-contained, no schema work.

**Closes:** U-21 (behaviourally), E19, E20; corrects E10.

1. **Demote `E10_DESCRIPTION_REQUIRED` from error to warning** and **stop withholding the
   row** (`ccrs-preflight-core.ts` L342). T-19 was accepted with an empty Description
   `[OBS 2026-09-17 T-19]`. Withholding a valid product is worse than filing a thin one:
   the product never lands, and every Inventory row referencing it then fails
   `Invalid Product`.
2. **Add E19 — `NumberRecords` must equal the emitted data-row count**, asserted as the
   **last** step before write. File-fatal `[OBS 2026-09-17 T-54]`. **Interaction to test
   explicitly:** S-02 withholds failing rows; if the count is computed before withholding,
   a withheld row silently invalidates the entire file. This is a real, reachable bug.
3. **Add E20 — Inventory `Product` must match a filed Product name byte-for-byte**
   `[OBS 2026-09-17 T-37]`.
4. **Replace every predicted error string with the 11 verbatim ones** (Part 04 §H) and add
   one regression test per string so wording drift is caught.
5. **Add a test asserting a zero-excise Sale line is only ever emitted with
   `SaleType = RecreationalMedical`**, naming `Only Medical Sales Excise tax can be 0`.
   (Today this holds because one `medicalOrderIds` set drives both — lock it down.)

**Acceptance:** the 14 returned error CSVs are committed as fixtures (already at
`docs/ccrs-bible/evidence/2026-09-17-preprod-run/errors/`) and a test asserts the measured
coverage — **6/14 with today's gates, 8/14 after E19+E20** — so the number cannot drift
silently. `python3 …/coverage.py` reproduces it.

---

## S-05b — The filed-identifier ledger (the single most valuable change this run implies)

**Why:** the examiner instructed *"continue to use the IDs already submitted and use the
update path to update them vs creating new ones."* We cannot obey that without knowing
which ids were already submitted. The run proved **both** blanket strategies fail:

- blanket `Insert` → `Duplicate External Identifier` (T-33)
- blanket `Update` → `ExternalIdentifier not found` (T-35)

There is no third option that avoids tracking state. It is also the largest single coverage
win available: **4 of the 14 observed failures** are invisible to us without it.

**Scope:** a table of every external identifier we have filed, per file type, with the
filed date, the operation, and the receipt token (U-19). `Insert` vs `Update` is then
decided **per row** from that ledger rather than assumed per file.

**Seed data is inbound and free:** the Cannabis Examiner Unit is preparing Greenway's
Cultivera-filed records (Part 12 U-08). **That delivery is the ledger's initial load** —
sequence this slice so the ledger exists in time to receive it, and log the file in Part 13
with its checksum when it arrives.

**Ordering note:** this supersedes the identifier guesswork in S-05/W2 and should land
before the first production upload, not after.

---

## S-03 — Warnings that are really errors; row lists; no caps

**Closes:** W1, W2, W4, W12, W15, N-09; upgrades W5, W7, W10/11, W13, W16 with rows.
**Files:** `ccrs-batch.ts` (L57-L62 type, W12 L368, W14 L414, W15a L471, W15b L599, CAP L624-L636), `ccrs-sales.ts` (L163 quarantine predicate, L447-L470 warnings), `ccrs-batch-core.ts` (`classifyWarning` L544 → fallback only), `ccrs-identifiers.ts` (`checkSaleIdentifierIntegrity` L146), `ccrs-submit-gate-core.ts` (L68 `defaultClassifyWarning`, L77-L137).

### Ground
- Sale `InventoryExternalIdentifier` required — Part 02 §1 Table 6 (guide p.41; pin the exact line with grep before shipping).
- "Sold item cannot be in Quarantine" `[G L1305]`.
- ExternalIdentifier required `[G L0224]`; "Invalid Product" `[G L0579]`.
- SaleDetail uniqueness `[G L1390-L1399]`.
- Warnings vs errors: Part 01 §E "Do not treat a warning-severity finding as safe."

### Tests first
1. Sale line whose lot has no `ccrs_inventory_external_id` and no proven-filed POS key → `E_SALE_NO_INVENTORY_ID` error with `rows` = every affected order line (build 30 such lines; assert `rows.length === 30`; no cap).
2. Lot `status = "recalled"` sold → error; both `ccrs-sales.ts` and `buildInventoryFile` use one exported predicate `isCcrsHeldLot(status)` (new in a core file) → test that predicate over all five statuses (0023 L86-L113 enum: active|quarantine|recalled|sold_out|destroyed). **Note N-01 interaction:** what Area a held lot goes to is S-04's problem; here only the Sale check is aligned.
3. 40 lots with no id → `W12_LOT_NO_ID_SKIPPED` becomes error with 40 rows (today capped at 25 then 5).
4. No published menu → `W15_NO_PUBLISHED_MENU` error; orphan lots → `W15_ORPHAN_LOTS` error with rows.
5. Two sale lines in one order that collide on `SaleDetailExternalIdentifier` (force by stubbing ids with the same first 8 chars) → `N09_SALEDETAIL_NOT_UNIQUE` error from the gate.
6. `defaultClassifyWarning` fallback: a bare-string warning is still classified; a coded one is not re-classified (severity comes from producer).
7. Gate: `assertCcrsBatchSubmittable` throws when any issue has severity error regardless of `code`; passes with warnings only.

### Implement
- Type extension per Part 08 §C. Producers set `code`, `severity`, `specPin`, `rows`.
- Delete the two caps (L416 `25`, L624-L636 `5`). Keep a `count` for display.
- `ccrs-sales.ts` L163: replace `status === "quarantine"` with `isCcrsHeldLot`.
- W2 (L452): the POS-key fallback stays **only** when `license_settings.pos_key_ids_filed_by_integrator = true` (new boolean, default false; Part 07 R-2 — the owner flips it after the Cultivera export proves the barcode = POS key relationship). Otherwise error.

### Verify + Docs
Suite green; Part 04 rows W1/W2/W4/W12/W15/N-09 → DONE. Regenerate Part 03.

### Acceptance
- No `slice(` on any error array in `ccrs-batch.ts`, `ccrs-sales.ts`, hub page (grep in test: `tests/compliance/ccrs-no-caps.test.ts` reads the source files and asserts the regex `/errors\.slice\(/` is absent — this is a guardrail test, allowed per AGENTS.md "add guardrails not just fixes").
- Every warning/error has `rows` when it concerns identifiable records.

---

## S-04 — Area semantics (N-01)

**Closes:** N-01 (code side); U-04 remains a PREprod question.
**Files:** `ccrs-batch.ts` (`buildAreaFile` L201-L213, `buildInventoryFile` L383), `license_settings` migration, hub Step 0 (S-08 renders; S-04 adds the setting + server read).

### Ground
- "IsQuarantine True only applies to imported CBD. There are no quarantine requirements for cannabis" `[G L0298-L0299]`.
- "Please be sure that Area is NOT set by default to 'TRUE' … the system will treat inventory and products contained in that area as being in quarantine" `[FAQ L0051]`.
- Quarantine examples list (waste/destruction) `[G L0258-L0259]` — this is the reason U-04 exists: p.9 lists waste inventory as a quarantine example while p.11 says no requirement for cannabis. The examiner decides; the code must support both answers.
- "Sold item cannot be in Quarantine" `[G L1305]`.

### Tests first
1. Default setting `hold_area_is_quarantine = false` → Area file rows: `Sales Floor`/FALSE and `Hold`/FALSE (names: keep `Sales Floor` if that is what L201-L213 emits today — read the snippet in Part 03 and keep the existing sales-floor name byte-identical; rename only the quarantine area). Golden `Area.golden.csv` changes: this is an intentional diff; PR body cites `[FAQ L0051]`.
2. Setting `true` → `Hold`/TRUE (the current behaviour, for the case the examiner says a hold area should be TRUE).
3. Inventory: held lots (`isCcrsHeldLot`) still land in the hold area either way; sold lines from held lots still error (S-03).
4. **Area ExternalIdentifier continuity:** Part 07 — if Cultivera filed Area identifiers, ours must match or be new ones. Unknown (U-08 sibling). Test that Area `ExternalIdentifier` values are stable across two builds (already the case if hard-coded).

### Implement
- Migration `license_settings.hold_area_is_quarantine boolean not null default false` + `hold_area_name text not null default 'Hold'`.
- `buildAreaFile` reads settings; `buildInventoryFile` L383 uses the same area id.
- Until U-04 closes: emit `N01_AREA_QUARANTINE_TRUE` as **warning** when the setting is true (so the owner sees it on every batch), never error.

### Acceptance
- Default batch emits no `IsQuarantine=TRUE` anywhere.
- Toggling the setting is the only way to get TRUE, and it is visible as a warning.

---

## S-05 — InventoryTransfer from receiving intake + identifier continuity

**Closes:** E14, N-02, N-03 (tracking half), Part 07 R-1 tooling.
**Files:** new `src/lib/compliance/ccrs-transfer-core.ts` (PURE, `__runCcrsTransferTests`), `ccrs-batch.ts` L551-L555 (replace the empty file), `src/lib/inventory/intake-store.ts` (`stageManifest` L513, lot insert L650-L672), `src/lib/inventory/intake-parser.ts` (L371 `inventory_id`, L568-L569), `src/lib/inventory/ccrs-manifest-csv-core.ts` (L492-L498 `InventoryExternalIdentifier`), migrations, `src/app/admin/inventory/intake/[id]` (hand-entry field), `src/lib/pos/import-lot-core.ts` (read-only reference for barcode).

### Ground
- Retailers upload InventoryTransfer `[G L0143-L0144]`; "Only the receiving licensee" files the transfer `[G L0124-L0128]`; file marked REQUIRED `[G L1162]`.
- Field list and errors `[G L1158-L1262]`: "Duplicate InventoryTransfer" `[G L1190]`; "Invalid FromInventoryExternalIdentifier" `[G L1191]`; "ToLicense cannot be the same license number as FromLicense" `[G L1205]`.
- FAQ on From/To identifiers and Update `[FAQ L0058-L0059]`.
- Update-before-Insert error `[FAQ L0052-L0053]`; keep existing IDs `[FAQ L0149]`.
- Template `[TPL InventoryTransfer R1-R4]` for column order.

### Migrations (two files, sequential numbers after the latest in `supabase/migrations/` — `0224` at c1ca753; re-check at slice time)
1. `inventory_lots.vendor_inventory_external_id text` (raw, **never** through `sanitizeExternalId` L41-L47); `inventory_lots.ccrs_first_reported_at timestamptz`, `ccrs_last_reported_at timestamptz`, `ccrs_transfer_reported_at timestamptz`.
   Backfill: `update inventory_lots set vendor_inventory_external_id = lot_code where vendor_inventory_external_id is null and lot_code is not null and manifest_id is not null` — **justified only because** `intake-parser.ts` L371 sets `lot_code ← inventory_id` for WCIA JSON and `ccrs-manifest-csv-core.ts` L492-L498 sets it from `InventoryExternalIdentifier` for CCRS manifest CSVs. PDF-parsed manifests (L568-L569 pick from `lot_code|lot|lot_number|batch|…`) may hold a *batch* not an inventory id — so the backfill also sets `vendor_inventory_external_id_source text` ∈ `wcia_json|ccrs_csv|pdf_guess|owner_entered|unknown` from `inbound_manifests.source_format` (verify the column name in 0023 L22-L38 / Part 03 schema table; if no such column exists, derive from `raw_payload` shape in a one-off script and record counts in the PR body).
2. `license_settings.pos_key_ids_filed_by_integrator boolean default false`, `integrator_name text`, `integrator_removed_on date` (Part 07/08).

### Tests first (`ccrs-transfer-core.ts` self-test + `tests/compliance/ccrs-transfer.test.ts`)
1. `buildTransferRows(lots, settings)` for an accepted lot with all fields → one row: `FromLicenseNumber = vendor.license_number`, `ToLicenseNumber = settings.license_number`, `FromInventoryExternalIdentifier = lot.vendor_inventory_external_id` (raw, with any punctuation the vendor used), `ToInventoryExternalIdentifier = lot.ccrs_inventory_external_id`, `Quantity = received_qty`, `TransferDate = received_on` (0214 L42-L45) formatted `MM/DD/YYYY` Pacific, `ExternalIdentifier = "TR-" + lot.ccrs_inventory_external_id`, `Operation = Insert`, `CreatedBy/CreatedDate` per header rules `[G L0229-L0243]`. Column order = `[TPL InventoryTransfer R4]` exactly.
2. Missing vendor license → `E14_TRANSFER_FIELD_MISSING` row-level error; missing `vendor_inventory_external_id` → `E14_TRANSFER_VENDOR_ID_UNKNOWN` with fix-link to `/admin/inventory/intake/[manifest_id]`.
3. `vendor.license_number === settings.license_number` → `E14_TRANSFER_SAME_LICENSE` `[G L1205]`.
4. Lot with `ccrs_transfer_reported_at` set → not re-emitted (duplicate = error `[G L1190]`), unless `received_qty` changed since (then Operation `Update` `[FAQ L0059]`).
5. Week filter: lots whose `received_on` falls in the selected week, plus any earlier accepted lot never reported (catch-up) — test both.
6. N-03 tracking: `markBatchReported(weekKey, files)` sets `ccrs_first_reported_at` (if null) and `ccrs_last_reported_at` on the Inventory lots included, and `ccrs_transfer_reported_at` on transfer lots — called from the **record week** action (Step 5), not from the download (a download is not an upload). Test the pure planner that decides Insert vs Update per lot from these stamps: null first → Insert; set → Update only if any reported field changed (compare a hash of the emitted row stored as `ccrs_last_row_hash text` — add to migration 1).
7. Cultivera continuity (Part 07 R-1): pure `compareIdentifierSets(cultiveraBarcodes: string[], ourIds: string[])` → `{ matched, onlyCultivera, onlyOurs }`; used by a hub panel in S-08 and by a one-off script `scripts/compliance/ccrs-id-continuity.ts` reading a Cultivera CSV export (`import-lot-core.ts` L14-L30 already knows the Barcode column).

### Implement
- `intake-store.ts` L650: add `vendor_inventory_external_id: line.vendor_inventory_external_id ?? line.lot_code` (parser adds the field; for PDF sources leave null unless the parser found an explicit `inventory_id` key).
- `ccrs-batch.ts` L551-L555: replace the empty-file block with `buildInventoryTransferFile(...)` and delete the comment "retail intake is reported via Inventory.csv" (Part 04 §D.3).
- Insert/Update planner in `ccrs-transfer-core.ts` or a sibling `ccrs-report-state-core.ts` used by both Inventory (N-03) and Transfer.
- Intake detail page: field "Vendor's CCRS InventoryExternalIdentifier" per lot with `owner_entered` source stamp.

### Verify
Goldens: `InventoryTransfer.golden.csv` today has a header + 0 rows presumably — it will gain rows from the fixture; intentional, cite `[G L1162]`. `Inventory.golden.csv` unchanged in S-05 unless the planner changes Operation for fixture lots (fixture lots have no stamps → Insert → unchanged).

### Acceptance
- With a fully-populated intake, InventoryTransfer has one row per accepted lot received that week, and 0 blocking issues.
- With a lot lacking the vendor id, the batch blocks with one error row pointing at the manifest.
- Recording a week stamps lots; the next week's Inventory rows for those lots are `Update` (until U-05 says otherwise — see Part 12 U-05 for the alternative "don't re-send unchanged" path; the planner supports both via a setting `inventory_resend_mode ∈ update|omit`, default `update`, flipped after T-33).

---

## S-06 — Upload events, LCB email paste, triage to every guide error

**Closes:** E15, E16, E17.

> **REVISED by the 2026-09-17 run — read before building this.**
>
> The premise "paste the LCB email" is weaker than reality. **CCRS returns a machine-readable
> CSV**: the submitted file echoed back with an `ErrorMessage` column. Ingest the file; do
> not parse email prose.
>
> - **Parse by column name, never by position.** Inventory returns `ErrorMessage` **third**
>   and appends an `InventoryIdentifier` we never sent; Product moves `UnitWeightGrams` last.
> - **`ErrorMessage` is per-FILE, not per-row.** The identical string is stamped on every
>   returned row, including provably innocent ones (T-17's `AREA-2`). **Never build UI that
>   says "row N is the problem" from this column** — it would be confidently wrong. Show
>   CCRS's text as the file's verdict and use our own pre-flight to point at the row.
> - **Success is now a positive signal.** `PRE: CCRS Processing Successful` from
>   `info@lcb.wa.gov`, 30–90 s (U-11 disproven). Batch states become
>   `submitted → confirmed | rejected`, with timeout only as the *unknown* branch.
> - **Capture the receipt token** CCRS appends to the echoed filename
>   (`…_20250615213000_2026917T1252497.csv`, U-19) as the correlation id between our
>   `ccrs_upload_events` row and LCB's record. It is the only shared key.
> - **Rejection is all-or-nothing** (U-17): nothing in a rejected file is filed, so the hub
>   can safely say "fix it and re-send the whole file."
>
> Fixtures for all of this are committed at
> `docs/ccrs-bible/evidence/2026-09-17-preprod-run/errors/`.
**Files:** migration `ccrs_upload_events` (Part 08 §E.1 DDL), new `src/lib/compliance/ccrs-upload-events-core.ts` (+ `-store.ts`), `src/app/admin/compliance/ccrs/actions.ts` (new actions `recordLcbEmailAction`, `markFileUploadedAction`, `resolveEventAction`), `src/components/admin/compliance/UploadWalkthrough.tsx` (L54-L64 localStorage → props+actions), `src/lib/compliance/ccrs-error-triage-core.ts` (RULES L54-L159), `src/lib/compliance/ccrs-week-store.ts` (derive `error_status`).

### Ground
- Errors only by email `[G L0051]`; only the uploader `[FAQ L0102]`; examiner contact `[FAQ L0030]`.
- Owner D-04: YES paste emails. D-05: everything in the hub.
- Every error string in Part 02 §1 (grep `lcb/guide.txt` for lines in the error tables: L0325, L0358-L0359, L0434, L0530, L0557, L0579, L0597, L0614, L1111, L1190-L1205, L1305, L1374-L1378, L1390-L1399, and the rest of each file's error table — enumerate by reading the tables, do not rely on this list being complete).

### Tests first
1. `deriveWeekErrorStatus(events)` → `clean` / `errors_reported` / `resolved` per Part 08 §E.1 rules; empty → `clean`.
2. `deriveWalkthroughState(events)` → per file `uploadedAt | null`, honouring `note "undo <file>"`.
3. `groupStartAllowedAt(events, group)` → last upload in previous group + 10 min `[G L0530]`; null if previous group incomplete.
4. Triage: for **each** RULES entry, `pin` present and the sample text appears at that line in `docs/ccrs-bible/02-authoritative-spec.md` (read file in test; the spec part reproduces `guide.txt` with `L####` prefixes — parse the prefix). Add rules until every error line in the guide's error tables has one; test asserts a count ≥ the number of distinct error strings found by a regex over the spec (keep the regex simple: lines inside the "Error" tables — identify them by the table header text in Part 02 and pin it).
5. `recordLcbEmail` store: inserts `kind='lcb_email'` with `raw_text` verbatim (no trimming beyond CRLF normalisation), `triage_json` from the core.
6. `resolveWeek` refuses when `env='preprod'` (S-07 adds the env; write the test now with a parameter default `'prod'`).

### Implement
- Migration per Part 08 §E.1; RLS mirrored from 0118 L111-L120.
- Store functions with `pagedAll` for lists.
- `UploadWalkthrough.tsx`: remove `localStorage` L54-L64; accept `events` and call actions; show "Group 2 may start at HH:MM Pacific".
- Actions: `settings.manage` for writes (matches `actions.ts` L28).
- `ccrs-week-store.ts` `listWeekSubmissions`: join/derive `error_status` from events; keep the stored column as override (`error_status_override`?) — smaller change: keep the column, but the hub displays the derived value and the manual select is labelled override (Part 08 §B Step 5).

### Acceptance
- Ticking a file on a phone shows on the desktop after reload.
- Pasting a guide error string yields a triage hit with a fix-link and the week chip turns amber.
- Marking the event resolved turns the chip green with "resolved".

---

## S-07 — Environment switch (PREPROD/PROD) and PREprod tooling

**Closes:** Part 08 §F; enables Part 06 execution.
**Files:** migration `license_settings.ccrs_env`, hub Step 0 control (minimal render now; S-08 restyles), `UploadWalkthrough.tsx` L30 `PORTAL_URL` → prop, `batch-export/route.ts` L125 README text, `ccrs-upload-events-store.ts` (stamp env), `compliance-reminders.ts` L100 (URL from a shared const), `ccrs-week-core.ts` L282 text, new `src/lib/compliance/ccrs-portal-core.ts` exporting `CCRS_PORTAL_URLS = { prod, preprod }` with pins.

### Ground
`[API L0070]` prod URL, `[API L0074]` PREprod URL, `[FAQ L0088]` all licensees have PREprod, `[FAQ L0096]` environments autonomous. Existing const `excise-payment-core.ts` L47 `CCRS_PORTAL_URL` — reuse or re-export; one source of truth.

### Tests first
1. `portalUrlFor("prod") === "https://cannabisreporting.lcb.wa.gov"`, `portalUrlFor("preprod") === "https://precannabisreporting.lcb.wa.gov"` with pins in comments.
2. Guardrail test: grep source for the literal `cannabisreporting.lcb.wa.gov` outside `ccrs-portal-core.ts` → must be zero occurrences (the list at Part 08 §A.1 has six today).
3. `resolveWeek` with `env='preprod'` → `{ ok: false, error: /PROD/ }`.
4. Switch action requires confirmation token `"PREPROD"` / `"PROD"`.

### Implement
As specified. README in zip states env + URL + login label.

### Acceptance
- In PREPROD the hub banner is visible on every section; the walkthrough links go to the PREprod host; a week cannot be recorded.
- In PROD nothing changed visibly except the small status line in Step 0.

---

## S-08 — Hub consolidation

**Closes:** E1 (UI), E18, N-07; renders Part 08 §B–§D, §G, §H.
**Files:** `src/app/admin/compliance/ccrs/page.tsx` (L282, L313-L344, L378, L382, L397, L626), `src/app/admin/reports/compliance/page.tsx` (→ pointer card), `src/components/admin/reports/LicenseSettingsForm.tsx` (import from hub), `src/app/admin/reports/compliance/actions.ts` L14 (import or move), new components `CcrsErrorSummary.tsx`, `CcrsValidationQueue.tsx`, `CcrsFilesTable.tsx` under `src/components/admin/compliance/`, `docs/CCRS_SELF_REPORTING_GUIDE.md` (A5.4 and Part C corrections), delete `docs/CCRS_WEEKLY_UPLOAD_BIBLE.md`.

### Ground
Owner D-05 (hub); Part 08 §C rendering rules; `[G L0143-L0144]` file order; `[G L0530]` waits; `[FAQ L0049]` no "no change" report.

### Tests first
- Pure render helpers only (no DOM tests in this repo's style — check `tests/compliance/*ui-core*.test.ts` for the existing pattern, e.g. `banking-vault-ui-core.test.ts`, and follow it): `groupIssues(issues)` → ordered groups errors-first by file order; `summaryHeading(n, gateOk)`; `filesTableRows(batch, events)`.
- Guardrail: `tests/compliance/admin-dead-links.test.ts` exists — extend so every `href` in the fix-link map (Part 08 §D.2) resolves to an existing route directory.
- Guardrail: Reports page source contains no `buildCcrsBatch` import after the move.

### Implement
Per Part 08. Keep `route.ts` handlers in place. Reports page becomes the pointer card. Fix stale prose (N-07) with pins.

### Acceptance
Part 08 §H checklist, every row observed on the running app (`npm run build` + local start, screenshots in the PR).

---

## S-09 — WA.gov transition scaffolding

**Closes:** N-10 (code side); Part 11 governs content.
**Files:** `license_settings.portal_login_mode text check in ('saw','wagov') default 'saw'`, `ccrs-portal-core.ts` `loginLabel(mode)`, `UploadWalkthrough.tsx` L178 text, `compliance-reminders.ts` L100 text, `batch-export/route.ts` L125 text, `docs/CCRS_SELF_REPORTING_GUIDE.md`.

### Ground
`[FAQ L0010]` October 2026 WA.gov; `[FAQ L0012]` manual account creation; `[SAW L0004-L0005]` do not log into SAW directly (Part 02 §6); `[LOGIN]` current flow (Part 02 §4). Owner D-07: start now.

### Tests first
- `loginLabel("saw") === "SAW"`, `loginLabel("wagov") === "WA.gov"`; guardrail grep: the literal `SAW` appears in source only via `loginLabel` or in `ccrs-portal-core.ts`.
- A hub notice appears when today ≥ 2026-09-01 and mode is still `saw`: "WA.gov transition due October 2026 — see Part 11" (pure date function tested at three dates).

### Acceptance
Flipping the setting changes every login mention in one place; nothing else about the upload changes (owner's belief — confirmed or refuted by U-10/T-series in Part 06).

---

## S-10 — Medical (DEFERRED by owner; do not start without D-03 flipped)

Part 10 holds the procedure. No code in this slice until the owner says go. Placeholder here so numbering is stable and no agent "helpfully" starts it.

---

## S-12d — First day of sales + dismiss a deadline with a reason — DONE in code (2026-10-07); owner applies 0250 by hand

**Why.** The owner was nagged (email/SMS reminders, CCRS page, compliance calendar, dashboard count, Compliance Health) about every CCRS week and LIQ-1295 month before this system files anything. Those periods are filed by the integrator (Cultivera). Measured on 2026-10-07 with the real engines: 8 overdue weeks and 2 overdue LIQ-1295 months with no start date; **0 overdue weeks, 0 overdue months** with the start date 2026-11-01 (a Sunday, so the first day of a CCRS week).

**Ground.** LIQ-1295 is due the 20th of the following month and is required even with no sales; weekly CCRS is due the Sunday after the Sun–Sat week (calendar task text, WAC 314-55-083(4)). The codebase holds no DOR sales-tax/excise-return reminder (searched), so there is nothing to dismiss there yet (see R-3).

**What it does.**
- **First day of sales** (`site_settings.compliance_obligation_start`, `{startDate}`): a CCRS week that ends before it is `before_start`. A LIQ-1295 month that ends before it is `before_start` only **after its due date**, so a required LIQ-1295 is still reminded.
- **Dismiss with a reason** (table `obligation_waivers`, migration 0250): one ended week or LIQ-1295 month, 10–500 characters of reason, who and when. Undo keeps the row (revoked by/at). The database refuses deletes, edits to the reason, and a second undo. Only `ccrs_weekly` and `liq1295` can be dismissed; `dor_excise` is rejected on purpose.
- **Precedence everywhere:** recorded/filed > before_start > dismissed > date math. Both new statuses are "settled": no reminder of any stage.
- **One context, every nag surface:** reminder cron (weekly + monthly), CCRS page, compliance calendar and the dashboard overdue count, Compliance Health (the cadence check is ok before the start date), classic compliance report.
- **Fails safe:** if the context cannot be read it is empty, so nagging is exactly as before. It never goes silent by accident.

**Proof.** `scripts/recon/obligation-waivers-pg-check.sql` PASSED on PG15 (applied twice, every check, guard, FK set-null cascade, RLS as authenticated, rollback refuses with rows); **30/30 SQL mutants** (`mutate_0250_sql.py`; 3 equivalent documented); `tests/compliance/s12d-obligation-dismiss.test.ts` 33 tests; self-tests (waiver 58, week 65, deadline 51, health 20); **38/38 TS mutants** (`mutate_s12d_ts.py`); factory reset KEEPs the table.

---

## S-13 — Areas (D-03, N-01, E23) — DONE in code (2026-10-07); production stays Update-only until PREprod probe P-02 closes U-31

**Why.** Before S-13 every batch Inserted `Sales Floor`/`AREA-SALES-FLOOR` (an id CCRS does not hold under that name: gap E23) and, when any lot was on hold, an Area `Quarantine` with **IsQuarantine TRUE** (N-01). The guide says IsQuarantine must be False for cannabis `[G L0298-L0299]` and CCRS refuses a sale from quarantine `[G L1305]`.

**What it does** (`src/lib/compliance/ccrs-area-core.ts`, pure; wired in `ccrs-batch.ts` `buildAreaFile`):
- **Ledger-driven.** The Area file is planned from what CCRS holds (S-12 ledger) and owner decision **D-03** (code constant `PROD_AREA_PLAN`: keep `C1100011`–`C1100014`, retire `A65303` and `C1-11021100011`–`14`). PREprod has its own empty plan. **Note:** the D-03 line the owner accepted ("all of your recommendations") read "most-recently-dated Sales Floor set". Both id sets carry the same CreatedDate, so set C is our resolution. Get the owner's explicit OK before `mode: "delete"` is switched on. Update-only does not touch the retired ids.
- **Production default `mode: "update-only"`.** While any retired id is still on file, the four kept ids are sent as `Update` (filed name, IsQuarantine `FALSE`, UpdatedBy/UpdatedDate set). **No Delete is sent** until P-02 proves what CCRS does when an Area that Inventory references is Deleted (U-31). Update-only is safe whichever way U-31 answers. `mode: "delete"` is coded and tested and is switched on by a reviewed one-line change (an intentional deviation from a `license_settings` column: no migration, and the switch is code-reviewed).
- **Every lot is reported in `Sales Floor`** with IsQuarantine `FALSE`. The quarantine Area is gone. A lot on quarantine/recalled hold in our system raises advisory **E45_HELD_LOT_NOT_AN_AREA** (Inventory). Hold remains an in-app status and does not move the lot in CCRS. OD-3 is still the owner's to answer.
- **Never guesses.** A kept/retired id the ledger does not show as present, a kept id with no filed name, or a needed name held only by an uncertain/unknown record → blocking **E46_AREA_LEDGER**. Two present records with the same name → advisory E46.
- **PREprod / new names.** A needed name with no surviving holder is Inserted under `GWA-<SLUG>` (D-01a). A taken id gets the suffix `-2`…`-99`. An empty PREprod ledger → one Insert `GWA-SALES-FLOOR`; once that row is filed, nothing more is sent. Production with no ledger emits **nothing** (so E23 cannot recur).
- **Proof:** `tests/compliance/s13-ccrs-areas.test.ts` (38 tests: D-03 constant, both modes, real 2026-09 Cultivera Area.csv cross-check through `buildLedgerSeed`, outbox self-check L_REF_AREA/L_DELETE_NOT_ON_FILE), `tests/compliance/p02-area-probe.test.ts` (9), self-test runner, **50/50 TS mutants killed** (`scripts/ccrs-bible/mutate_s13_ts.py`).

**Enterprise practice (fetched 2026-10-07).**
- S-13 follows **parallel change / expand–migrate–contract**: "breaking the change into three distinct phases: expand, migrate, and contract" (Fowler/Sato, https://martinfowler.com/bliki/ParallelChange.html).
  - Expand = the kept ids are refreshed with Update so they are the most recently ingested `Sales Floor` `[BRIAN A12]`.
  - Contract = Delete the retired ids, and only after P-02.
  - The same source warns "If the contract phase is not executed you might end up in a worse state than you started, therefore you need discipline to finish the transition". The register row U-31 is that discipline.
- MDM practice is to rely on referential integrity before deleting reference data: "Try to delete a Zone that has Areas pointing to it? Foreign key violation" (https://primentra.com/blog/hard-delete-vs-soft-delete-master-data). CCRS gives no such guarantee in writing, so P-02 tests it.
- The same source says deleted codes "squat" and block re-use. That is why P-02 file 9 Inserts a **new** id and never re-uses a deleted one (outcome E).

**P-02 PREprod probe (closes U-31, U-32).** `npx tsx scripts/compliance/generate-p02-area-probe.ts --run P2026MMDDX` writes 10 files plus `MANIFEST.md`, with three 10-minute waits `[G L0530]`. File 6 is produced by the real planner in delete mode (Delete a duplicate-name record and the record of a referenced Area; Update the keeper). Files 7–10 show whether Inventory still joins. The manifest lists outcomes A–E and the action for each. A → flip production to `mode: "delete"`. B/C/E → stay Update-only. Evidence goes in `docs/ccrs-bible/evidence/<run>/`.

---

## S-17a — Every withheld/warned row shown in the hub, report and export refusal — DONE in code (2026-10-19)

**Why.** On 2026-10-19 the owner's screenshots (`evidence/2026-10-19-owner-screenshots/`) showed "17 of 38 lot(s) withheld" in production and "20 product(s) withheld" in PREprod with no per-row reasons. The ledger planner already wrote one row per withheld entity with a reason, but `ccrs-submit-gate-core.ts` dropped `rows` and the hub printed only `• [file] message` (Part 17 §C.4 defect 2).

**What changed.**
- `src/lib/compliance/ccrs-issue-display-core.ts` (pure): classifies every planner reason into 10 classes (a lot whose product is withheld inherits the product's class); per-class next step, environment-aware (PREprod "no CCRS Product id" → "Assign PREprod ids"; ids do not carry over `[FAQ L0096]`); uncapped plain-text rendering; `mergeRows` dedupes by id + detail.
- `ccrs-submit-gate-core.ts`: `GateIssue` carries `code`, `specPin`, `rows`; `toGateInput` is the one mapping used by the hub, the compliance report and the batch-export route; dedupe merges rows instead of dropping them.
- `CcrsIssueList.tsx`: reason groups, "Show all N row(s)", copy buttons. Used by the hub (errors + warnings) and the report (the 30-warning cap is removed).
- Batch-export refusal text and README list every row.
- S-12a: `EXPECTED_2026_09_18` is now checked for internal consistency against Part 04 even when the real delivery files are absent (mutation M89 used to survive in such sandboxes).
- `mutate_check.py`: M120–M130 added; M101 retargeted to `ccrs-area-core.ts` (its anchor was dead since S-13).

**Proof.** `tests/compliance/s17a-hub-issue-rows.test.tsx` (real `planLedgerBatch` output through the gate to the markup; every `reason:` literal in the planner is classified; 250 rows uncapped). Mutation harness: 0 survived.

**Not covered (S-17b).** The orphan "(38)" warning comparison (U-60); why a lot's product is missing from the published menu; the hub does not yet run `verifyOutboxAgainstLedger` (Sale → unfiled lot, `[G L1302-L1304]`).

## S-17b — Honest "not in the menu" rows (E47) and the hub runs the export's ledger self-check — DONE in code (2026-10-19)

**Why.**
- U-60: the orphan warning said "(38)" for 38 lots whose products Product.csv carried. It compared Product column 6, the CCRS id after `applyProductPlan`, with the lot's key.
- U-62 / Part 17 §K.4: the hub did not run `verifyOutboxAgainstLedger`. So a Sale naming an unfiled, withheld lot ("Invalid InventoryExternalIdentifier" `[G L1302-L1304]`) showed only as a refused download.

**What changed.**
- `src/lib/compliance/ccrs-lot-product-core.ts` (new, pure):
  - `lotsWithheldForMissingProduct` (ledger mode: the planner's own decision);
  - `legacyLotsWithBlankProduct` (no ledger: lots written with a blank Product, "Product is required" `[G L0578]`);
  - `explainMissingProduct`, with 7 classes, never guessed; an unreadable menu is said as such;
  - `lotsWithProductNotInMenu`, one row per key, every lot listed;
  - `enrichLotWithholdReason` and `e47Message`.
- `ccrs-batch.ts`:
  - `readMenuPresence` reads hidden (with reason) and staged menu items for only the keys concerned, and fails closed to "unreadable";
  - E47 replaces the column-6 warning: a warning with a ledger, an error in legacy mode;
  - E41 lot rows are enriched;
  - `ledgerSelfCheckIssues` results are pushed as blocking issues.
- `ccrs-outbox-core.ts`: `ledgerSelfCheckIssues`, `LEDGER_PROBLEM_PIN`, plain-English messages per code.
- `ccrs-preflight-core.ts`: `E47_LOT_PRODUCT_NOT_IN_MENU` → `[G L0579-L0583]`.
- `ccrs-issue-display-core.ts`: the enriched reason keeps class "not-in-published-menu"; a loose prefix does not.
- `s13-ccrs-areas.test.ts`: its source pin now includes the new trailing `menuPresence` argument. The Area-name argument it guards is unchanged.
- `mutate_check.py`: M131–M148; `S17B_TESTS` added to the baseline.

**CI note (learned on PR #1427).** `lcb/*.txt` is outside the repo, so a test must not read it unconditionally. The first push read `/workspace/lcb/guide.txt` and failed in CI. Fix:
- the cited guide lines are embedded verbatim, as `ccrs-preflight.test.ts` does;
- a drift check compares them with the file only where it exists (`it.runIf`);
- a second test requires every cited pin to be embedded.

Verified both ways: with the file hidden, the drift check skips and M145 is still killed; with the file present, an altered line goes red.

**Proof.** `tests/compliance/s17b-honest-orphans-and-hub-selfcheck.test.ts`:
- the old rule reproduced (4 of 4) on real planner output;
- the filed-lot, uncertain-lot and legacy cases through the real planner;
- self-check parity with `verifyOutboxAgainstLedger`;
- one issue per (file, code);
- every pin checked against `guide.txt`;
- source pins.

Full `tests/compliance` is green. Mutation harness: 0 survived.

**Not covered.**
- The menu reason is only as good as `menu_items.hidden_reason`.
- A lot whose `pos_product_key` does not equal any item's `source_item_id` (after trimming) shows as "no menu item". That is the truth of the join, and the row quotes the exact key, so a near-miss (case, prefix) is visible to the reader. It is not auto-matched.

## S-17c — CCRS sign-in wording says WA.gov (replaces S-09) — DONE in code (2026-10-19)

**Why.** CCRS moved from SAW to WA.gov on 2026-10-12 `[BUL1006 L0010]`. The upload README, the reminder email, the walkthrough, the error-triage footer, the concierge and about 15 docs still said "SAW login". The owner also thought PREprod access proves live access. It does not: "You will need separate WA.gov accounts for the Pre-Production environment and the live environment." `[SIGNIN L0035-L0036]`.

**What changed.**
- New `ccrs-signin-core.ts` (pure, self-test registered).
- The six src strings and the docs (Part 11 §G has the list).
- New evidence: `signin-links.txt`, the PDF link targets.
- `mutate_check.py`: M149–M156, and `S17C_TESTS` in the baseline.

**Proof.** `tests/compliance/s17c-wagov-signin-wording.test.ts` (26 tests):
- every grounding line read from the committed evidence (runs in CI);
- core behaviour per environment;
- the guardrail tested on the six old strings, wrapped markdown, the DOH line and history lines;
- a whole-tree scan with zero findings.

Reverting the src/docs changes turns 7 tests red.

**Not covered.** The LCB Portal (SAW per lcb.wa.gov/portal/resources) and the DOH MCR (U-63) are outside CCRS and unchanged. S-09's `portal_login_mode` setting and date notice are dropped: the switch is past and cannot be reverted (Part 11 §F).

---

## S-17d — Hand-over plan from Cultivera: the first upload date, worked out and warned (DONE in code, 2026-10-19)

**Why.** The owner asked when Greenway's first upload is (Part 05 D-20). He assumed 11/14; by `[FAQ L0041]` it is **Sun 2026-11-08** (week 11/01–11/07). `docs/audit/CUTOVER-CHECKLIST.md` still scheduled an Oct 18 cutover.

**What changed.**
- New `ccrs-handover-core.ts` (pure, self-test registered). `planHandover` takes the first day of sales (S-12d), Cultivera's last sale day and its final upload day. It returns Greenway's first week, earliest upload (its Saturday) and due Sunday, the next week, Cultivera's last week and its due Sunday, and the fresh-copy window. Warnings: START_NOT_SET and SALES_OVERLAP and FINAL_UPLOAD_BEFORE_LAST_SALE block; START_NOT_SUNDAY, LAST_SALE_UNKNOWN, SALES_GAP, FINAL_UPLOAD_UNKNOWN, FINAL_UPLOAD_AFTER_DUE (U-64, "not verified"), FINAL_UPLOAD_AFTER_START (U-61) warn; FRESH_COPY_WINDOW informs. Steps H-1..H-6.
- New `ccrs-handover-store.ts`: site_settings key `ccrs_handover_facts` (no migration). Unreadable reads as unknown, which only adds warnings.
- `setHandoverFactsAction`: `settings.manage`, audited `ccrs_handover.facts_set`.
- New `HandoverPlanCard.tsx` on the hub, after "First day of sales".
- CUTOVER-CHECKLIST: superseding notice, current calendar, and dated steps corrected; no ID renumbered.
- `mutate_check.py`: M157+ with `S17D_TESTS` in the baseline.

**Proof.** `tests/compliance/s17d-handover-plan.test.tsx`: grounding read from Part 02 and the committed FAQ (runs in CI); weekdays checked against the platform Date; the owner's dates (11/08, not 11/14; Cultivera due 11/01; 6 days late; overlap warning); edges (on-time, due-day, not set, junk, Wednesday and Saturday starts, overlap, gap, upload before last sale, year boundary); card render; wiring pins; docs pins.

**Not covered.** Whether the FAQ's "transition period" has ended (U-64) and what Cultivera's 11/07 upload contains (U-61) are for the examiner and Cultivera. The stored first day of sales is data and is not read here.

---

## S-18a — CCRS mailbox monitor: confirmations and error files read from Gmail (DONE in code, 2026-10-20)

**Why.** The owner asked for it (Part 05 D-21). The submitter's address gets the confirmation and error messages `[EXAM L0098]`. Until now each one was pasted by hand (S-12c). This is roadmap R-1 (d) (email ingestion).

**What changed.**
- New `ccrs-mail-core.ts` (pure, self-test registered):
  - Gmail query `from:info@lcb.wa.gov after:<epoch seconds>`, with Spam included.
  - MIME walk and base64url decode.
  - `classifyCcrsMail`: success (S-12c `parseSuccessEmails`) / error (a `.csv` with an `ErrorMessage` column, read with the same known-message rule as `classifyEcho`) / unknown / not-ccrs (sender must be exactly info@lcb.wa.gov).
  - `subjectEnv`: only `PRE: CCRS Processing Successful` is verified. A subject without PRE is "production, not yet verified" (U-65). Error subjects never decide the env (U-66).
  - `authVerdict`: shown, never blocking (U-67).
  - `pickEchoFile` / `resolveEchoPick`: an error CSV is applied only to the one uploaded file whose rows it proves (`classifyEcho`). Two fits means the owner picks, and the pick is re-proven.
  - `planSuccessEnv`, heartbeat.
- New `ccrs-mail-fetch.ts` (server): Google token by service-account JWT (RS256, `sub` = mailbox, scope `gmail.readonly`) or by OAuth refresh token. `messages.list` (5 pages max), `messages.get?format=full`, `attachments.get`. 15 s timeout per call.
- New `ccrs-mail-store.ts` + cron `/api/cron/ccrs-mail` (`4-59/5 * * * *`, fail-closed `CRON_SECRET`). The insert is the claim (unique `(mailbox, gmail_id)`). At most 25 new emails per tick, oldest first. A quiet tick writes nothing (heartbeat on change, on new mail, or every 30 min).
- Migration **0282** `ccrs_mail_messages`:
  - A received email is never deleted (`CCRS_MAIL_KEPT`) or altered (`CCRS_MAIL_IMMUTABLE`), and is handled once (`CCRS_MAIL_HANDLED`).
  - RLS: staff read, admin write. Factory reset keeps it.
  - pg-check `scripts/recon/ccrs-mail-0282-pg-check.sql` runs in `verify-migrations-execute`.
- New `mail-actions.ts`: Check now / Apply confirmation / Apply error file / Set aside. All need `settings.manage` and are audited. Apply re-reads the stored email and re-proves the file on the server, then writes through the same `recordOutcome` (0249) as the paste boxes. An error email is all-or-nothing.
- New `CcrsMailPanel.tsx` on the hub ("CCRS email: confirmations and error files"). It shows not-set-up, a stale/failing warning, every reason to look, the sender check, and the env picker / portal tick only when needed.
- `.env.example`: `CCRS_MAILBOX_ADDRESS`, `CCRS_MAIL_LOOKBACK_HOURS`, `GMAIL_SA_*` or `GMAIL_OAUTH_*`. Unset means the monitor is off and nothing breaks.
- `parseSuccessEmails` now reads a line-wrapped "Date / Submitted:" (the 09-17 printouts).
- `mutate_check.py`: M173–M201 with `S18A_TESTS` in the baseline.

**Proof.** `tests/compliance/s18a-ccrs-mail-monitor.test.ts` covers:
- all 45 real PREprod confirmations wrapped as Gmail delivers them: 44 applied, and the `_1` renamed copy goes to a human;
- all 15 real error CSVs as attachments (inline and by `attachments.get`, any MIME type);
- the P20261005A echo proven against its SENT file;
- sender look-alikes; DKIM/SPF/DMARC verdicts;
- the fetch client against a mocked `fetch`, with a real RSA key whose signature is verified;
- migration, cron, action and panel pins.

29 mutations are killed. Migration 0282 is executed on Postgres 15 with the CI bootstrap.

**Not covered.**
- The production subject (U-65), an error email's subject/body/MIME (U-66) and a real email's authentication header (U-67) are unseen. Each is shown to the owner rather than guessed.
- Gmail push (`users.watch`) was not used: it needs Pub/Sub and renewal every 7 days. A 5-minute poll is simpler and well inside quota.
- The monitor is off until the owner sets the Google credentials (build report 2026-10-20b).

---

## S-18b — Strategy report for every CCRS error email, and a once-only owner alert (DONE in code, 2026-10-20)

**Why.** The owner asked for the system to "automatically draft a strategy report to fix the issue" when an upload fails (Part 05 D-21). Failed uploads come back with the failures in an attached CSV (owner, 2026-10-20; also the 15 error CSVs in `evidence/`).

**What changed.**
- New `ccrs-strategy-core.ts` (pure, self-test registered, floor 18):
  - `STRATEGY_PLAYBOOK`: one entry per `CCRS_KNOWN_MESSAGES` text (12). Each has what failed, the rule it breaks with its pin, ordered fix steps, and the PREprod run where the exact text was received. The action follows the class: benign → none, file-fatal → whole file, row → fix and re-send the listed rows, row-contradicts-ledger → settle first with a Service Desk copy (the hub holds the id as "uncertain").
  - `SOURCE_QUOTES`: every guide / FAQ / examiner line the playbook cites, embedded verbatim. The test re-checks each one against `lcb/guide.txt`, `lcb/faq.txt` and the in-repo examiner thread. Every cited range must be fully embedded.
  - `buildCcrsStrategy`: per file it gives the scope (none / listed-rows / whole-file / unknown) and per message the row count and the ids. An id is read only from a row whose cells match the header; a shifted row (comma, P20261005A) is counted as unreadable, never guessed. The re-send order follows the guide's groups "Group 1 file uploads are the Strain, Area, and Product records." `[G L0084-L0089]`, with the 10-minute wait `[G L0529-L0530]`. The weekly deadline comes from `[FAQ L0041]`.
  - An unknown message, an unreadable message, or a file whose name and header disagree produces an examiner email DRAFT through the existing `buildExaminerDraft` (to examiner@lcb.wa.gov, never sent automatically). The week stays a placeholder: an error file does not say which week it answers.
  - `planMailAlert`: one alert per error or unreadable email. Key `ccrs_mail:<mailbox>:<gmail id>`, stage `ccrs_mail_error`, all CCRS text HTML-escaped, a DMARC failure and Spam stated first.
- New `ccrs-mail-notify.ts` (server). Called at the end of each ccrs-mail tick. It uses the cutover-watch pattern: claim by insert into `compliance_reminder_log` (23505 = already claimed), send email (Resend, `ORDER_STAFF_EMAILS`) and push, then record the channels. With no channel nothing is claimed. With every channel failed the claim stays, marked with the same `WATCH_UNDELIVERED` text. Only open mail fetched in the last 7 days is alerted. A quiet tick is one read and no write.
- New `CcrsStrategyReport.tsx`, shown inside each open error email on the hub panel. The page builds the report from the stored CSVs.
- `mutate_check.py`: M202–M223 with `S18B_TESTS` in the baseline.

**What to re-send.** Brian: "Header and operation errors are full file, individual row errors are specific to that row, so a file that passes operation and header validation can have 5 rows fail and 1 row pass." `[EXAM L0532]`. PREprod agrees for row errors (P20261006A: the rows not listed were filed) and for the checksum (T-54). One observation does not fit "operation errors are full file": P20261005A's `Operation is invalid ...` came back on 3 of 8 rows and the other 5 were filed. The report says what was observed and tells the owner to check the confirmation of the re-sent rows. It does not choose.

**Proof.** `tests/compliance/s18b-ccrs-error-strategy.test.ts` (57 tests) covers:
- all 15 real error CSVs: every one fully explained, no examiner escalation, the row counts add up, the observed scope per file;
- quotes verbatim against the source files;
- unknown / unreadable / mismatched files go to a draft;
- the alert through the real postgrest-js client against FakePostgrest: once only, a racing tick, no channel, all channels failed, email+push, the 7-day and state filters, a quiet tick, a database fault;
- wiring and panel rendering.

22 mutations are killed.

**Not covered.**
- No production error email has been seen yet (U-66). If CCRS sends a message that is not in the playbook, the report says so and drafts to the examiner instead of guessing.
- The report does not edit products or lots. The owner makes the fix in the app, and the next export re-sends only what CCRS does not hold.

## S-18c — CCRS watchdog: no answer after 60 minutes, mailbox monitor down (DONE in code, 2026-10-20)

**Why.** Two things the owner could only see by opening the hub:
- an uploaded file with no CCRS answer an hour later. CCRS answers in 30–90 s (Part 15 A1), and 60 minutes is the line the hub button and 0249 (`CCRS_OUTCOME_SLA_NOT_REACHED`) already use (Part 05 E, `CCRS_EMAIL_SLA_MINUTES`);
- a mailbox monitor (S-18a) that is failing, or whose 5-minute cron stopped. The panel turned red, but nobody was told.

**What changed.**
- New `ccrs-watchdog-core.ts` (pure, self-test registered, floor 21):
  - `planNoEmail`: files in state `uploaded` at or past `uploaded_at + 60 min`. Each gets a reason from what the mailbox already holds:
    - a stored, unapplied confirmation naming the file → "press Apply";
    - an unhandled error/unknown CCRS email received at or after the upload (1-minute clock slack) → "may be the answer". It is never matched by guess, because error attachments do not carry our file name (Part 15 A2);
    - monitor not set up / failing / stale → "check Gmail (Inbox AND Spam) by hand";
    - else → "check the CCRS portal, then the no-email button".
  - `noEmailMessage`: one message for every file crossing in a tick, HTML-escaped, with a link to the right env.
  - `planMonitorAlert`:
    - "failing" when configured and every check since `failingSince` failed for 15+ minutes (`MAIL_DOWN_AFTER_MINUTES`); one alert per outage;
    - "stopped checking" when `heartbeatStale` (45 min), asked only by the daily cron;
    - "not set up" never alerts.
  - Keys:
    - `ccrs_no_email:<env>:<file id>`
    - `ccrs_mail_down:<mailbox>:<failingSince>`
    - `ccrs_mail_stale:<mailbox>:<lastRunAt|never>`
- `ccrs-mail-core.ts`:
  - the heartbeat carries `failingSince`. `nextFailingSince` keeps it across failed ticks of the same mode, restarts it on a mode change, and clears it when healthy or not set up;
  - `shouldWriteHeartbeat` persists a new outage start at once.
- New `ccrs-watchdog.ts` (server):
  - the cutover-watch / S-18b claim-before-send pattern on `compliance_reminder_log`; every file keeps its own claim row even when sent in one message;
  - no channel → nothing claimed; all channels failed → `WATCH_UNDELIVERED`; a quiet tick only reads.
- Wiring:
  - `runCcrsMailTick` runs the watchdog inside `finish`, so on EVERY path (not set up, Gmail failing, healthy). The result carries `watchdog`;
  - the daily `compliance-reminders` cron calls `runCcrsWatchdogDaily` (checkStale), because a dead 5-minute cron cannot report itself.
- Panel: the red box adds "Failing since …; the owner is alerted once after 15 minutes."
- Checklist C-136. `mutate_check.py` M224–M247 with `S18C_TESTS` in the baseline.

**Drafts-only.** Nothing here records an outcome or writes `ccrs_files`. The no-email button stays the owner's (standing rule 3). Alerts go only to `ORDER_STAFF_EMAILS` and staff push devices.

**Proof.** `tests/compliance/s18c-ccrs-watchdog.test.ts` (53 tests):
- the 60-minute edge; every state; every reason;
- messages and escaping; monitor down/stale edges; the heartbeat outage start;
- claims through the real postgrest-js client against FakePostgrest: once, a 23505 race, no channel, undelivered, push only, one message per batch, the mail filters, a 500 database, an exception;
- the tick end to end with Gmail mocked: not set up; failing at 0/5/10/15/20 minutes; recovery;
- the daily stale alert once; route wiring; guards.

All 24 mutations are killed.

**Not covered.** If the whole Vercel project is down, no cron runs and nothing can alert. The daily alert covers a dead 5-minute cron, not a dead platform.

---

## S-15 — Re-seed / diff loader for a later LCB delivery (G-1; U-30) (DONE in code, 2026-10-20)

**Why.** The ledger decides Insert or Update for every row we send. It was seeded from the LCB delivery current through 2026-09-18 (U-30), and Cultivera kept filing until the cutover. The examiner confirmed the delivery holds only "what data was reported up to the date I pulled" `[EXAM L0476]`. A lot Cultivera created after 9/18 is missing from the ledger, so we would Insert it and CCRS would refuse a duplicate. The seed script cannot load a second delivery: it is idempotent and refuses a second finalize (Part 17 §G). G-1 needs a reviewed merge, and a fresh copy can be OLDER than our own filings, so it must never overwrite what our files recorded.

**What changed.**
- New `src/lib/compliance/ccrs-reseed-core.ts` (pure, self-test registered, floor 12):
  - `reseedSource(asOf)` → `seed:<asOf>-delivery`. The date must be real and after 2026-09-18, and the tag matches 0248's source regex;
  - `LEDGER_READ_SQL` reads prod Inventory/Product/Strain/Area with each row's last file, its `uploaded_at`, and the guard `updated_at` in integer epoch microseconds (does not depend on DateStyle);
  - `planReseed(copy, ledger, asOf)` sorts every row into a bucket.
    - **Written:**
      - **add** — an id the ledger lacks. The seed's state rules apply (QoH 0 → closed; Product "1" → unknown);
      - **refresh** — a `seed`/`closed` row with a `seed:*` source that no file has touched, where the copy differs;
      - **settleLink** — an untouched 0248 linker `unknown` lot that the copy now holds;
      - **settleUncertain** — an `uncertain` row whose file was uploaded strictly before 00:00 UTC of the as-of day, that is not a Delete and that the copy holds as a real record. It becomes `confirmed`, or `closed` for a QoH-0 lot.
    - **Only reported:**
      - uncertain rows that are absent or not proven (a Delete, junk, uploaded on/after the as-of day, no upload time);
      - our filings that disagree with the copy (`filed`/`confirmed`, or any row a file touched; ours wins);
      - ledger Deleted but still in the copy (never revived);
      - seed rows missing from the copy;
      - our rows missing from the copy;
  - `applyRefusal`: seed rows missing from the copy block writing unless `--accept-seed-missing` gives the EXACT count;
  - `reseedApplyStatements` builds ONE transaction:
    1. the `hashtext('ccrs_seed_finalize')` advisory lock;
    2. a not-seeded refusal;
    3. a temp stage table;
    4. adds `on conflict do nothing` plus a count assert;
    5. updates guarded by the planned `state` AND `updated_at` µs, plus a count assert. Either assert failing raises `CCRS_RESEED_STALE` and the whole transaction rolls back;
    6. `ccrs_link_unfiled_migration_lots(true)`, which keeps the 0248 invariant;
    7. 4 provenance `ccrs_files` rows (purpose seed, closed, the delivery's sha256 and row counts).
- New CLI `scripts/compliance/reseed-ccrs-ledger.ts`:
  - plan only by default;
  - `--report` writes a markdown review (refuses to overwrite);
  - writing (`--sql-file` or `--apply`) needs `--expect '<copy counts>'` equal to what was read;
  - the delivery is parsed by the S-12 seed reader (exact headers, prod only).
- New generated pg-check `scripts/recon/ccrs-reseed-pg-check.sql`, built by `scripts/compliance/reseed-pg-check-fixture.ts --write` and registered in `verify-migrations-execute.ts`, so CI's migrations job runs it on real Postgres 15. It proves on a fixture:
  - the unseeded refusal;
  - a stale refusal (a row moved after planning; nothing written);
  - an added-race refusal;
  - every outcome of a full apply;
  - a re-run refusing as stale;
  - then it rolls back.
- No migration: the merge is plain SQL under existing grants. `ccrs_filed_entities` has no guard trigger.
- Checklist C-137. `mutate_check.py` M248–M269 with `S15_TESTS` in the baseline.

**Drafts-only.** Nothing runs on its own. The owner reviews the report, then runs the one-transaction script. A row our pipeline filed is never overwritten.

**Proof.**
- `tests/compliance/s15-ccrs-reseed.test.ts` (50 tests):
  - every bucket and its boundaries; exact ids; refusals and gates;
  - idempotency: a second plan after the apply plans nothing;
  - the SQL structure, quoting and batching;
  - the pg-check equals the generator byte for byte, and is registered for CI;
  - routing after the merge (adds route as Update);
  - the report and its escaping;
  - the CLI end to end on a saved ledger file;
  - purity, and that no migration was added.
- All 22 mutations are killed.
- Local Postgres:
  - the CLI plan, refusal, `--apply`, a re-plan with 0 writes, and a `--sql-file` race (stale, nothing written);
  - a 70k-lot / 65k-product scale run: plan 2 s, apply 6 s.

**Not covered.**
- Whether a copy lists Deleted records is not verified, so an uncertain Delete is never settled from a copy (it is reported).
- The real G-1 delivery does not exist yet (U-30 stays OPEN until it is received, measured, md5 recorded in Part 13 and applied).

---

## S-14 — Equalize waves: stale lots zeroed by Update, then Reconciliation (Part 17 §E; X-11) (DONE in code, 2026-10-20)

**Why.** CCRS holds about 44,746 open lots for 413541 `[EXAM L0203]`, and about 40,662 of them are not in our back office `[EXAM L0204]`. They are Cultivera history. The examiner gave the method: "submit an inventory update for all those ids and get them to zero and then an inventory adjustment for those ids, with the reason as reconciliation" `[EXAM L0430]`. The rows must use the ids already filed (Update, never Insert) `[EXAM L0096]`, and every other value must stay accurate `[EXAM L0473]`. A wave is one bounded, reviewed set of these lots.

**What changed.**
- New `src/lib/compliance/ccrs-equalize-core.ts` (pure, self-test registered, floor 15):
  - `planEqualizeWave(input, policy)` reads the same-day pair: the LCB copy (Inventory / Product / Strain / Area, parsed by the S-12 reader), the ledger (`LEDGER_READ_SQL`), and our own lots (`OURS_READ_SQL`: lot code, product key, assigned CCRS id, status).
    - It refuses the whole wave if the snapshot is older than the copy (D-14 item 2), if a date, the wave label (`W1`…) or a policy value is bad, if no Sales Floor Area is on file, or if an id is duplicated in the ledger or in our lots.
    - Lots at QoH 0 in the copy are counted and never sent (the Q-B2 default).
    - A lot in our own system is never zeroed. It is matched by assigned id, by lot code, or by product key, in exact bytes.
    - Every other lot either joins the wave or is held under one of 21 named reasons (`EQUALIZE_HOLD_CODES`, in a fixed order so `--expect` is stable). Each reason has a plain-English meaning in `EQUALIZE_HOLD_MEANING`. The ledger must hold the lot as seeded, untouched by any of our files, and merged with this same copy, which is why S-15 runs first.
    - Values are written exactly as filed. The product name comes from the Product ledger by the lot's Product Identifier `[G L0579]`. The strain is written in its filed casing, and a strain CCRS does not hold is held `[G L0555]`. TotalCost 0 is held `[G L0614]`, and so is a reserved strain `[G L0358]`.
    - Eligible lots are taken in exact byte order up to `maxLots` (default 10,000). The rest wait for the next wave.
  - Rows use the PREprod-accepted P20261007A Inventory Update shape, tested column for column against `docs/ccrs-bible/evidence/P20261007A/files/Inventory_413541_20261006222853.csv`. The file name day and SubmittedDate are the wave day.
  - Two modes (Q-B1):
    - **separate** (default): the wave emits the Inventory file only;
    - **same-batch** (only if Brian says yes): Inventory and Reconciliation adjustments in one emission. The ledger self-check orders them in the existing groups.
  - Adjustment phase (separate mode): `ADJUST_PHASE_SQL` reads, from the database only, the wave's Inventory rows and what CCRS answered. `planAdjustPhase` writes a Reconciliation only for a lot whose wave Update landed (the row landed, the lot is closed, and nothing touched it later). Anything not proven is held under `A_FILE_UNANSWERED`, `A_ROW_NOT_LANDED`, `A_NOT_CLOSED`, `A_TOUCHED_LATER` or `A_NO_QUANTITY`. The adjustment id is `EQ-<wave>-<lot>` (≤100, `[G L0219-L0225]`). The reason is `Reconciliation` with a short audit detail `[G L1097-L1103]`. The quantity is the filed QoH removed, never negative `[G L1119]`.
  - `verifyEqualizeFiles` runs the standard outbox ledger self-check. It relaxes exactly one finding: an adjustment on a lot that is closed AND in this wave (0249 `ccrs_mark_uploaded` accepts that, `[G L1077-L1085]`).
  - `equalizeEmitStatements` builds ONE transaction:
    1. refuse if the wave label already has files (`CCRS_EQUALIZE_WAVE_USED`);
    2. `ccrs_emit_files('prod', …)` with purpose `cleanup:stale`;
    3. refuse anything not newly emitted (`CCRS_EQUALIZE_NOT_NEW`);
    4. write the wave label on the new `ccrs_files` rows;
    5. list them.
- New CLI `scripts/compliance/equalize-ccrs-wave.ts`:
  - `--phase inventory|adjustments` is plan only by default and writes a markdown review (`--report`, never overwrites) plus optional review files (`--out`);
  - `--emit` needs `--psql` and `--expect '<counts printed by the plan>'`, and runs only on the wave day (adjust day for phase 2) in Pacific time. The file name is stamped in Pacific `[FAQ L0075]` and must match SubmittedDate;
  - the switches waiting on Brian: `--same-batch` (Q-B1), `--nominal-cost 0.01` (Q-B3), `--strain-override <filed strain>` (Q-B6), `--max-lots N` (Q-B7). There is no switch for Delete (Q-B8: never written).
  - Exit codes: 0 ok, 1 refused, 2 bad arguments or files.
- New generated pg-check `scripts/recon/ccrs-equalize-pg-check.sql`, built by `scripts/compliance/equalize-pg-check-fixture.ts --write` and registered in `verify-migrations-execute.ts`. On real Postgres it proves:
  - the exact emit statements store the wave file with purpose `cleanup:stale` and label W1;
  - a second emit of the label is refused;
  - an error-rows answer closes only the landed lots;
  - `ADJUST_PHASE_SQL` returns exactly the expected lines;
  - the adjustment file is accepted by `ccrs_mark_uploaded` with no override;
  - then it rolls back.
- No migration (the wave column is not immutable in 0247). `mutate_check.py` M270–M297 with `S14_TESTS` in the baseline. Checklist C-139.

**Drafts-only.** Nothing runs on its own. The owner reads the plan, then emits on the wave day. The hub hands out the stored files, and they are uploaded one at a time after each success email (X-31).

**Proof.**
- `tests/compliance/s14-ccrs-equalize.test.ts` (45 tests):
  - every hold and its boundary; byte order; maxLots;
  - the exact P20261007A row shape;
  - refusals; both modes passing the format verifier and the ledger self-check; 10,001 lots → 2 chunks;
  - the emit SQL;
  - the adjustment phase from proof only;
  - the pg-check equals the generator and is registered for CI;
  - the CLI end to end (report, refusals, `--expect`, the switches, exit codes, Pacific wave day);
  - purity, and no migration.
- All 28 mutations are killed.
- Local Postgres, end to end with the CLI (2026-10-20): 29 copy lots and 1 of ours.
  - The plan gave a wave of 10, 15 for the next wave, 1 zero-cost hold, 1 reserved-strain hold, 1 of ours never touched, and 1 already zero.
  - A wrong `--expect` was refused.
  - `--emit` stored `Inventory_413541_20261020025437.csv` (cleanup:stale, W1, 10 rows).
  - A re-emit was refused.
  - Marked uploaded, then success: all 10 lots closed by Update.
  - The adjustment phase planned 10 lines (sum 55) and emitted `InventoryAdjustment_413541_20261020025615.csv`.
  - `ccrs_mark_uploaded` accepted it with no override, and success closed it.
  - A second adjustment emit was refused. The database was cleaned afterwards.

**Not covered (waits on Brian or on the real copy).**
- Q-B1 / U-55 (same batch or a later week), Q-B2 / U-56 (adjust lots already at 0?), Q-B3 / U-57 (what cost to write where CCRS shows 0.00), Q-B6 / U-58 (which strain for THC/Other/Unknown), Q-B7 (per-day ceiling). Each is a switch with the safe default. Changing a default is a one-line policy change plus its tests.
- QoH > Initial lots (77, `[EXAM L0235]`) resolve themselves when zeroed (0 ≤ Initial). Lots we keep are our weekly files' job.
- No real wave has run. The first one needs the G-1/G-2 copy merged by S-15 and a same-day count.

---

## S-16 — Copy diff verifier: is every record we sent stored as we sent it? (Part 17 §G G-3; `[EXAM L0568]`) (DONE in code, 2026-10-20)

**Why.** The examiner's advice: "after the initial uploads, recommendation is to reach out for a copy of what was submitted to check for accuracy" `[EXAM L0568]`. A success email proves that CCRS accepted a file. It does not prove what CCRS stored. This slice compares a fresh LCB copy (the same four delivery reports as the 9/18 delivery) with what our own files sent and CCRS answered as landed. It reports every difference with the exact bytes on both sides.

**What changed.**
- New `src/lib/compliance/ccrs-copy-verify-core.ts` (pure, self-test registered, floor 15):
  - `SENT_READ_SQL` (read-only) returns one JSON line per row of every production, non-seed Inventory / Product / Strain / Area file that left the building (states uploaded / succeeded / errored / reconciling / closed; never draft, emitted-only or abandoned). It also counts, per lot, the landed Sale / InventoryAdjustment rows in answered files stamped later (`eventsAfter`). Times are integer microseconds, and the order is byte order (`collate "C"`).
  - `parseSentLine` validates every line, so a shape is never trusted.
  - `verifyCopy(copy, sent, asOf)` judges each record by its LAST row that may have reached CCRS (by file stamp, then row number). Rejected, withheld, planned and emitted rows never did, so they are skipped. Each record lands in exactly one of nine buckets: `verified`, `mismatched`, `zeroedNotZero`, `missing`, `deletedPresent`, `copyConflict`, `notJudgedUncertain`, `notJudgedUnanswered` or `notJudgedTooNew`. The first four are problems.
  - "Too new" means uploaded on or after 00:00 UTC of the copy's date (the S-15 rule). `--as-of` is required and is never guessed.
  - Fields compared:
    - Inventory: LicenseNumber, Strain (a case-only difference is a U-45b note), Product, InitialQuantity, QuantityOnHand, TotalCost, IsMedical (any case) and CreatedDate (as a day). The product name is read from the copy's own Product report by the lot's Product Identifier; the Inventory report's "Product Name" column is the Description (Part 04 §A.5).
    - Product: Name, Description, InventoryType and UnitWeightGrams.
    - Strain: StrainType. A strain held only in another case is matched with a note.
    - Area: Area vs Name, and IsQuarantine.
  - Numbers are compared as exact decimals (10 = 10.00), and anything unreadable is never equal.
  - Not compared, and stated in the report: Area on lots (no such column in the delivery), CreatedBy / UpdatedBy / UpdatedDate (undocumented), InventoryCategory (not in the delivery), and sales / adjustments / transfers (not in the delivery).
  - A QoH difference on a lot with later landed Sale/Adjustment rows is still reported, with a U-68 note. Whether CCRS changes a stored QoH from those rows is not documented.
  - `verifyReport` writes a markdown report: a result line, a bucket table, a "Not compared" paragraph and one section per bucket. Values are JSON-quoted and table-escaped.
- New read-only CLI `scripts/compliance/verify-ccrs-copy.ts`:
  - `--as-of`, the four copy files, `--psql <PGURL>` (or `--sent-file`), `--report` and `--json` (never overwritten);
  - prints `copy check counts: {…}`;
  - exit codes: 0 no problems, 1 problems or input refused, 2 bad arguments/files.
- New generated pg-check `scripts/recon/ccrs-copy-verify-pg-check.sql`, built by `scripts/compliance/copy-verify-pg-check-fixture.ts --write` and registered in `verify-migrations-execute.ts`. Through the real `ccrs_emit_files` / `ccrs_mark_uploaded` / `ccrs_record_outcome`, it builds three weeks of history: Strain, Area, two Products and four lots, one of them rejected; then Updates to 0 and 3; then a Sale. It proves `SENT_READ_SQL` returns exactly the lines the unit tests use, then rolls back.
- No migration. `mutate_check.py` M298–M327 with `S16_TESTS` in the baseline. Checklist C-145.

**Read-only.** Nothing is written to the database. A difference is reported, never "fixed". What to do about a difference is a person's decision, made with the report in hand.

**Proof.**
- `tests/compliance/s16-ccrs-copy-verify.test.ts` (93 tests):
  - every bucket and its boundary (the cutoff microsecond, a rejected later row skipped, last row by stamp and by row number);
  - every compared field; Product by report id, never by Description; strain and IsMedical case; numbers; dates; copyConflict; a product missing from the copy; the U-68 note;
  - report escaping and the cut-off limit; parseSentLine refusals; the SQL's structure;
  - the pg-check equals the generator and is registered; the fixture history judged against constructed copies (all verified; sold down; dropped; too new);
  - the CLI end to end (exit codes 0/1/2, refusals, never overwrites); purity; no migration.
- All 30 mutations are killed.
- Local Postgres, end to end with the real CLI (2026-10-20):
  - the pg-check history was committed and copy files were written;
  - CV-L3 at 4 (sold down) → `mismatched` with the U-68 note, exit 1;
  - CV-L3 at 5 → 7 verified, exit 0;
  - `--as-of 2026-09-28` → 2 too new;
  - CV-L1 at 3 → `zeroedNotZero`, exit 1;
  - an existing report → refused; no `--as-of` → refused;
  - a hash of `ccrs_files` and `ccrs_file_rows` was identical before and after (read-only). The database was cleaned afterwards.

**Not covered (waits on a real copy).**
- No real post-upload copy exists yet. `docs/ccrs-bible/evidence/P20261005A/Product__20261006T113333390.csv` is an error echo, not a data copy. U-27b / U-44b / U-45b stay OPEN until the first real G-3 copy is diffed.
- U-68 (does CCRS change a stored QoH from Sale/Adjustment rows?) is answered by the first G-3 diff: lots with later sales whose QoH differs show it directly.
- G-2 (the same-day pair for a wave) is S-15 + S-14's job. S-16 is the after-the-fact proof.

---

## S-14b — Equalize waves wait for a copy dated after Cultivera's final upload, and never zero a lot from our 10/30 audit (Part 17 §E.6; D-22) (DONE in code, 2026-10-20)

**Why.** Owner question (D-22): can the cleanup happen on 10/31 or 11/01, and can it wait until after the migration? Two facts decide it:
- Cultivera files week 10/25–10/31 on **Sun 11/01** (D-21). That upload carries sales, adjustments and possibly new lots. A copy pulled before or on that day cannot show what it changed, so a wave planned from it could zero a lot that still holds stock.
- The migration import skips Cultivera lots with zero units (no lot is created). Those lots are not in "our lots". If the 10/30 audit scanned one of them, it was on our shelf, so no wave may zero it.

**What changed (tests first: `tests/compliance/s14b-final-upload-guard.test.ts`, 25 tests).**
- `planEqualizeWave` (`ccrs-equalize-core.ts`) needs `finalUploadDate` and `countedBarcodes`:
  - a final upload day that is not a real `YYYY-MM-DD` is refused ("never assumed");
  - `copyAsOf <= finalUploadDate` is refused, with no override; the message says to request a copy after that day and merge it (S-15);
  - a copy barcode in the audit list (trimmed, any letter case) is held `H_COUNTED_ON_SHELF`. The hold sits right after `H_POSSIBLY_OURS` and is never zeroed;
  - the report states the final upload day and the number of audit barcodes.
- `parseCountedList`: one barcode per line, blank and `#` lines skipped; an empty list is refused.
- `equalize-ccrs-wave.ts` (inventory phase):
  - `--final-upload-date` is required (exit 2);
  - `--counted-file <file>` or an explicit `--no-counted-file` is required (neither, both, or a missing file: exit 2);
  - when our lots are read live (`--psql` without `--ours-file`), `--snapshot-date` must be today in Pacific time (`liveSnapshotRefusal`, exit 1).
- New `scripts/compliance/count-barcodes.ts`:
  - reads the counters' audit workbooks with the same parser as the count apply (`cultivera-count-core`);
  - refuses on any blocking problem;
  - writes every scanned and hand-counted barcode once, sorted, and never overwrites.

**Not changed:** selling. Opening on 11/01 does not depend on any wave.

**Mutations:** M328–M339, all killed.

## R-3 — DOR Combined Excise Tax Return on the compliance calendar, with reminders (DONE in code, 2026-10-20)

**Ground (read online 2026-10-20):**
- RCW 82.32.045(1): returns "are due monthly within 25 days after the end of the month".
- DOR: "If the due date falls on a weekend or legal holiday, the due date is extended to the next business day."
- RCW 82.32.090(1): 9% penalty, rising to 19% after the last day of the following month and 29% after the second month.
- Greenway files monthly.

**What changed (tests first: `tests/compliance/r3-dor-excise-calendar.test.ts`).**
- `compliance-calendar-core.ts`:
  - task `dor_excise` (monthly, LAST month, citing RCW 82.32.045(1));
  - `dorExciseDueDate(year, month)`: the 25th of the next month, rolled over weekends and WA legal holidays, with `shiftedBy`. The holidays come from the one shared table, `isWaLegalHoliday` in `wa-quarterly-core.ts`;
  - `planDorExciseReminders(today, doneMap)`:
    - `dor_due_soon` 5–1 days before (warning, one per month);
    - `dor_due_today` (critical);
    - `dor_overdue_daily` (critical, new each day, states the penalty);
    - looks at last month and the month before, so a missed return keeps nagging after the month turns;
    - silent for a month marked done.
- Every month of DOR's published 2026 table is pinned (weekend rolls Mar/Jun/Sep; holiday rolls Apr = Memorial Day, Nov = Christmas).
- `compliance-reminders.ts` runs the planner in its own try/catch ("DOR excise planner failed").

**Design change from the roadmap text:** no CCRS-page dismiss and no migration. A month is cleared by **Mark done** on the compliance calendar, the S-18 done map in `site_settings`. `WAIVABLE_OBLIGATIONS` and the 0250 check are unchanged.

**Mutations:** M340–M346, all killed.

## R5-1 — Customer-return Sale corrections ride the weekly batch, per env, checked against the Sale ledger (DONE in code, 2026-10-20)

Branch `round5-returns-reach-ccrs-and-reset-proof`. Owner plan: Clean Slate (rehearse on real manifests, then factory reset).

**Before.** The return's inventory add-back reached CCRS (InventoryAdjustment `Other`), but the Sale correction ("the sale identifier should be deleted from CCRS" `[FAQ L0039]`) did not. It was a separate manual download that (G1) knew nothing of PREprod/prod or the ledger and marked returns exported on download, (G2) computed a second partial return wrongly (original minus THIS return), and (G3) could not be checked: `ccrs_ledger_slice` (0248) never returns Sale entities, so an Update/Delete of a line CCRS lacks ("SaleDetailExternalIdentifier not found" `[G L1413-L1414]`) went out unchecked.

**Built.**
- `src/lib/compliance/ccrs-return-corrections-core.ts` (pure): `planReturnCorrections` (cumulative per SaleDetailExternalIdentifier; Delete when everything is returned, else Update with the remaining quantity and pro-rated money; invalid lines named: blank id, snapshot clash, missing SaleType/SaleDate, over-return `[G L1345]`; ledger mode emits only for lines CCRS holds, with no file in flight and not Inserted in the same batch, otherwise withheld E48; already-applied corrections are "reflected", not re-sent); `correctionExportIds` (only a PROD emission clears the shared `correction_status`); `decodeSaleSlice`; `routeSaleInserts` (a held line is never Inserted again, "Duplicate Sale detail item for Licensee" `[G L1412]`; uncertain = withheld); `saleLedgerEntries`; `eventLotRefs`; `returnRecordFromRow` (no defaults invented). 18 embedded self-tests, registered in `run-pure-selftests.ts`.
- Migration **0283** `ccrs_sale_slice(p_env, p_detail_ids)` (read-only, service role only) + rollback + pg-check. Owner applies by hand (SQL editor). Without it the batch withholds every correction with a note (never guesses).
- `ccrs-ledger-store.ts` `loadSaleSlice`; `ccrs-ledger-core.ts` `buildLedgerView`.
- `ccrs-batch.ts`: reads pending + in-range + sibling returns (`readReturnsForCorrections`); reads destroyed lots named by this batch's event rows or returns (`readDestroyedLots`, chunked) so a Destruction or a return on a fully destroyed / sold-out lot passes `L_REF_INVENTORY`; routes Sale Inserts (E49 warning = already held, E49 error = ledger unsure); merges corrections into the ONE Sale file (E38-checked through the shared `encode`); E48 lists every withheld/invalid correction with its reason; the self-check uses the Sale-aware ledger; `CcrsBatch.corrections` reports counts and the ids to mark.
- `ccrs-outbox-core.ts`: a lot CCRS has closed (QoH 0) may carry event rows when THIS emission re-reports it in Inventory.csv (`closedReported`; M95 anchor updated).
- `batch-export/route.ts`: `markCorrectionsExported` runs only AFTER `emitOutboxFiles` stored the files, and only for prod; the audit row carries `sale_corrections`.
- Manual route `disposition/sale-correction-export`: same planner in legacy mode (fixes G2).
- New issue codes: E48_SALE_CORRECTION_WITHHELD `[G L1413-L1414]`, E49_SALE_LINE_ALREADY_HELD `[G L1412]`.

**Tests.** `tests/compliance/r5-return-corrections.test.ts` (46), plus updated pins in `ccrs-csv-fidelity.test.ts`. Mutations **M347-M372** (26) all killed; M95 re-anchored and killed; M30 anchor kept unique.

## R5-2 — Factory reset proof for the Clean Slate (DONE in code, 2026-10-20)

**Built.** `src/lib/accounting/reset-proof-core.ts` (pure): `REHEARSAL_ACTIVITY_TABLES` (36 tables the rehearsal writes, incl. destruction_events, vendor_returns, customer_returns, inbound_manifests, orders, ccrs_export_batches); `CCRS_LEDGER_KEEP` (7); `verifyResetSummary(tables, plan)` checks the DB's own per-table report from `gl_factory_reset` (every WIPE table reported, no kb_*, CCRS-ledger, KEEP or unclassified table reported; empty report and refused plan are named problems); `summariseOpenCcrsFiles` (anything not closed/abandoned is open, unknown states included). 11 self-tests registered.
- `settings/actions.ts`: after the reset, `verifyResetSummary` problems join the audit RPC's problems in the audit row and the owner's message.
- `src/lib/admin/reset-open-ccrs.ts` (service-role read of `ccrs_files`, kept out of `reset-service.ts` which must stay on the owner session) + reset page box "CCRS files still waiting for an answer" with a link to the hub.
- No SQL change: `gl_factory_reset` (0240) is not redefined.

**Tests.** `tests/compliance/r5-reset-proof.test.ts` (25), incl. a write-scan guard: every table written by POS / orders / inventory / receiving code is WIPE, or KEEP and on an exact 16-table allowlist (config + kb_products / kb_strains). Mutations **M373-M386** (14) all killed.

## R5-3 — The pre-flight agrees with the real 2026-09-17 PREprod results (S-02b remnants) (DONE in code, 2026-10-20)

Every test runs on the files we actually uploaded on 2026-09-17 and the error files CCRS sent back (`docs/ccrs-bible/evidence/2026-09-17-preprod-run/probes/` and `errors/`).

- **E50_ZERO_EXCISE_NOT_MEDICAL (new, blocking).** T-42 (RecreationalRetail, CannabisExciseTax 0.00) was rejected, verbatim `Only Medical Sales Excise tax can be 0`. Guide: "Only Medical Sales can be 0" `[G L1378]`; "An entry of 0 CannabisExciseTax is only allowed for sale type Wholsale, and sales that meet medical compliance conditions." `[G L1460-L1461]`. `ccrs-batch-core.ts` `verifySaleExciseRule` (pure, every row listed, any Operation, exact SaleType enum, a mis-formatted value left to `verifySaleNumericColumns`) runs inside `verifyCcrsFile`, so the hub, the compliance report and the export route all refuse it. T-40 (same line, 4.44) is the passing control. Today the Sale builder zeroes excise only for medical-exempt lines and non-cannabis lines; a non-cannabis line (merch keypad or a category outside the cannabis set) in Sale.csv would now be caught before CCRS rejects it.
- **E10 demoted to a warning** (closes the S-02b item; U-21 stays open for the future). T-19 (Usable Cannabis, empty Description) was ACCEPTED. The product row was never withheld (proved by test); only the issue severity changed, so the gate no longer refuses a whole batch for a missing description. The message quotes the examiner: "There is an expectation that a description is on file" `[EXAM L0552]`.
- **E19 proven** on the real T-54 file (NumberRecords 1, 2 rows): `verifyCcrsFile` refuses it, and the export route verifies the FINAL files (after every withholding step) before the gate and before the refusal. `assembleCcrsFile` writes the count from the rows it is given.
- **E20 proven** on the real T-37 file (`blue  dream flower 3.5g`): the ledger self-check `L_REF_PRODUCT` flags it (exact, case- and space-sensitive); the filed spelling is clean.

**Tests.** `tests/compliance/r5-preprod-evidence-gates.test.ts` (31). Mutations **M387-M395** (9) all killed (M390 survived once; the test now covers `0.000` and `-0`, and it is killed).

## R6-1 — Uncertain ids settle by proof or by the PREprod button (the 2026-10-20 Inventory failure) (DONE in code, 2026-10-20)

Branch `r6-1-preprod-settle-uncertain`. Owner report: D-23. Evidence: `evidence/2026-10-20-real-upload/` (README explains it).

**Diagnosis.**
- Strain: 11 × `Duplicate Strain`, benign by design `[G L0325-L0326]`.
- Inventory: 13 of 18 Inserts got `Duplicate External Identifier`. They are exactly the lots whose strains were duplicates: an earlier PREprod test had filed those vendor lots, our PREprod ledger starts empty, and lot ids have no per-run prefix.
- The accepted Sale named 4 of the 13, so PREprod holds them `[G L1302-L1304]`.
- 0249 had made all 13 `uncertain`, and nothing but a copy could settle them. PREprod cannot be reset `[EXAM L0518]`.

**Built.**
- Migration **0284** `0284_ccrs_settle_uncertain.sql` + rollback. No tables. Service role only, not security definer, search_path pinned. The owner applies it by hand.
  - `ccrs_prove_by_reference(env)`: lots proved by a later accepted Sale/Adjustment row become filed, closed if their last QoH is 0. The product is resolved by an exact single name match. Writes info issue `I_PROVED_BY_REFERENCE`.
  - `ccrs_preprod_settle_duplicates(by)`: PREprod only. Settles Inventory/Product/Area entities whose last-file row was an Insert in state uncertain with a `CCRS_ROW_CONTRADICTS_LEDGER` issue ending `: Duplicate External Identifier`. Records `source = preprod-settle:<time> PT by <who>`. Writes info issue `I_PREPROD_SETTLED`.
  - `ccrs_close_settled_files(env, note)`: reconciling → closed when none of a file's uncertain rows still has an uncertain entity.
- `ccrs-lifecycle-core.ts` (pure): `decodeProveByReference`, `decodePreprodSettle` (PREprod only; Inventory/Product/Area only; no duplicates), `pendingDuplicateCount`, `settleSummaryText`, hints `CCRS_SETTLE_BY` / `CCRS_SETTLE_BAD_ENV`, and a new reconciling state text.
- `ccrs-ledger-store.ts`: `proveByReference`, `preprodSettleDuplicates`, `proveAfterOutcome`. `proveAfterOutcome` never throws: a recorded answer is never hidden by a failed proof. The two info codes are now listed with each file.
- Actions:
  - the proof runs after Record success, Record error (paste), and both email-apply paths, and is audited as `ccrs.ledger.proved_by_reference`;
  - new `settlePreprodDuplicatesAction` (settings.manage, audited as `ccrs.preprod.settle_duplicates`).
- `CcrsFilesPanel`: the PREprod set-up box shows "Settle PREprod duplicates" only while a reconciling PREprod file has such rows. Row notes now label "proved by sale" and "PREprod settled".
- Playbook (`ccrs-strategy-core.ts`) "Duplicate External Identifier" names both new routes and keeps "Never re-send it as Insert" and the Service Desk address.

**Tests.**
- `tests/compliance/r6-1-preprod-settle.test.ts` (18) runs on the real 2026-10-20 bytes. It checks:
  - the hashes;
  - Strain → error-benign;
  - Inventory → 13 uncertain;
  - the 13 = the duplicate-strain lots;
  - Sale proves exactly 4;
  - the 0249 issue-message format matches what the button looks for;
  - decoders and wiring.
- `scripts/recon/ccrs-settle-0284-pg-check.sql` replays the run in miniature through the real 0249 lifecycle on Postgres 15 (CI: `POST_APPLY_CHECKS`). It covers:
  - an earlier upload, a rejected Sale row, a production Sale and a non-event file prove nothing;
  - an Update-row "duplicate" is not settled, and an ambiguous product name resolves to none;
  - QoH 0 → closed, and a Product settles with its Name;
  - production is never touched, and the functions are idempotent.
  Its 15 SQL mutations (`scripts/recon/sqlmut/0284.txt`, `run-0284.sh`) are all killed.
- TS mutations **M396–M405** (10), all killed. M204 was re-anchored to the new playbook line and is still killed.
- Migration-tail pins were moved to 0284.

## R6-2 — InventoryTransfer.csv from real deliveries + vendor-return design (DONE in code, 2026-10-21)

Branch `r6-2-inventory-transfer`. Closes E14 and N-02 (Part 04 §A.13).

**Built.**
- Migration **0285** `0285_ccrs_inventory_transfer.sql` + rollback. The owner applies it by hand.
  - `inventory_lots.vendor_inventory_external_id` (raw, ≤100) and `vendor_inventory_external_id_source` with check constraints.
  - A fill-only backfill from `lot_code` for real deliveries. Cultivera migration lots (migration manifest kinds, `POS-IMPORT-` numbers, the notes marker) are excluded. One audit row counts the lots.
  - `ccrs_transfer_slice(env, ids)`: the transfer ledger plus in-flight flags. Service role only, search_path pinned, a bad or null env is refused.
- `ccrs-transfer-core.ts` (pure, 27 self-tests) builds the rows from these inputs:
  - **window:** fromDay..toDay; in production the floor is the owner's start date, with catch-up when the ledger is loaded;
  - **vendor license normalizing:** `WA 417-068` → `417068`;
  - **issue codes:** E14_TRANSFER_* with pins;
  - **ledger entries:** merged into the batch's ledger view.
- `ccrs-batch.ts` reads accepted lots with a manifest (`readTransferLots`) and replaces the empty push. `ccrs-outbox-core.ts` knows `ExternalIdentifier` for transfers, and its L_REF check uses `ToInventoryExternalIdentifier`.
- Intake stores the vendor id and its source on every new lot. The delivery page has a per-lot **Vendor inventory id** form (Confirm/Save) that writes `owner_entered` plus an audit row.

**Tests.**
- `tests/compliance/r6-2-inventory-transfer.test.ts` (26), with spec pins checked against Part 02.
- The self-test is registered.
- `scripts/recon/ccrs-transfer-0285-pg-check.sql` is in POST_APPLY_CHECKS. Its 26 SQL mutants (`scripts/recon/sqlmut/0285.txt`) are all killed.
- TS mutations **M406–M431** (26) are all killed.
- Migration-tail pins were moved to 0285.

**Vendor returns: the simple, automated design (research; NOT built).**

How it works today: a return posts an InventoryAdjustment `Other` with a note, and `vendor_returns` tracks the manifest status (`none → requested → submitted → confirmed → picked_up`).

The CCRS manifest page says these things:
- the manifest is filed by the **originating** licensee: the file-name license "must match OriginLicenseNumber" `[MANI L0066]`;
- each item must be "a previously reported inventory item external identifier" `[MANI L0147]`;
- Inventory files are required before a Manifest file `[MANI L0019]`;
- TransportationType has three values: Regular, Pick-up and Transporter Licensee `[MANI L0054-L0056]`.

For a return, Greenway is the origin. **Unverified: U-73.**

The planned one-click flow (R6-3+):
1. The owner picks lots and quantities on the return screen. A partial lot is split first, so the returned units get their own id.
2. The app pre-fills everything else:
   - the vendor's license, phone and email;
   - the transport type (default Pick-up: the vendor collects) and the vendor's saved driver/vehicle;
   - the departure and arrival times.
3. The app builds `manifest_413541_<PT stamp>.csv` with our ids and runs the verifier, then posts the Adjustment (or the Sale, if U-72 says Wholesale) in the same batch.
4. The CCRS success email with the PDF is matched by S-18a and moves `vendor_returns.manifest_status` to `confirmed`.

**Remaining.**
- The Manifest.csv builder and its verifier.
- The return screen (one click).
- An InventoryTransfer **Update** when a filed transfer's quantity or vendor id changes `[FAQ L0059]` (U-74).
- N-03 (Insert-only Inventory): routing done by the S-05 ledger; unchanged re-sends stopped by R6-3.

 research first, build later, switch on only after the upload process is proven)

**R-1 Automated weekly CCRS upload.** Goal: no hand upload, no waiting 10 minutes between groups. Known facts: the LCB says API/system-to-system access is for integrators only (Brian A33); Greenway currently uploads by hand through the CCRS portal; Cultivera is the current integrator. Research (do not assume): (a) how enterprise integrators submit for many licensees — the LCB integrator path, its approval steps, credentials and terms; (b) whether a licensee can become its own integrator, and the cost; (c) whether browser automation of the portal is allowed by the LCB terms of use (ask the LCB in writing before building anything); (d) how success/error emails are read automatically (S-16 email ingestion is a prerequisite either way). Gate: every item in "what is left" below is closed and N consecutive weeks are accepted with zero errors on hand upload. Then a switch in settings turns automation on, starting dry-run (build + verify + notify, no submit).

**R-2 Monthly LIQ-1295 excise payment automation.** Known: there is no LCB payment API in the sources; payment is made through the LCB's online system. Research: the accepted payment channels (online portal/ACH), whether a scheduled ACH debit can be set up, and whether report filing can be automated at all. Until then: the monthly reminder plus the dismiss/record path.

**R-3 DOR combined excise / sales-tax return tracking — DONE 2026-10-20 (see the R-3 section above; built without dismiss or migration).** Original text: not tracked anywhere in the code today. Monthly filers are due the 25th. Build: a calendar task + reminders + dismiss + "filed" record, same pattern as S-12d (add `dor_excise` to `WAIVABLE_OBLIGATIONS` and to the 0250 check in a new migration).

**R-4 PREprod tab shows the amber "ledger not started" banner instead of the green bar (owner report 2026-10-07).** Not yet diagnosed. **First hypothesis, unproven:** the button the owner tested was the S-12d *first-day-of-sales* start date, not **Start PREprod ledger** (CcrsFilesPanel "PREprod set-up (one time per test cycle)"). The amber text itself says "PREprod ledger not started (…). Start it in the CCRS files section below". If the reason in brackets is `seed-not-finalized`, pressing Start PREprod ledger once should turn it green. Check this first. Do not assume the cause; recon it first. Known code facts:
- the banner is `src/app/admin/compliance/ccrs/page.tsx` ~L491-L496, shown when `!batch.ledger.view`, and its text includes `absentReason`;
- the reason comes from `buildCcrsBatch` (`ccrs-batch.ts`): `"not-configured"` (early return ~L719, e.g. no license/Supabase), or `decodeLedgerSlice` (`ccrs-ledger-store-core.ts` L44-L54): `"migration-not-applied"` (RPC missing) or `"seed-not-finalized"` (`loaded` false);
- `ccrs_ledger_slice` (0248 ~L551) sets `loaded` = a `ccrs_files` row exists with `env = p_env, purpose = 'seed', state = 'closed'`;
- `ccrs_preprod_ledger_start` (0249 ~L495-L506) inserts exactly such a row for `preprod`.

Fix steps:
1. Ask the owner for the exact banner text (the reason in brackets) and whether **Start PREprod ledger** has been pressed.
2. Query `ccrs_files` for the preprod seed row and call `ccrs_ledger_slice('preprod', …)` by hand.
3. Check that the page builds with `env=preprod` and that no cache serves an old render.
4. Fix only the proven cause, with a test.

## R6-3 — Inventory.csv sends only what changed (DONE in code, 2026-10-21)

Branch `r6-3-inventory-unchanged`. Closes the re-send half of N-03 (Part 04 §A.14).

**Rule.** "Inventory.CSV is required weekly by any licensed facility that owns the inventory, only when inventory exists that is unreported, or unreported updates to an existing inventory. No report is needed if there are no changes." `[G L0525-L0527]`. Sent Updates carry UpdatedBy/UpdatedDate; "Updated Date cannot be prior to Created Date" `[G L0234-L0242]`. PREprod accepted an Update with both filled (P20261007A file 7, Part 17 §B).

**Built.**
- Migration **0286** `0286_ccrs_inventory_last_told.sql` + rollback (no tables). The owner applies it by hand.
  - `ccrs_inventory_last_told(env, ids)`: stable, read-only, service role only, search_path pinned, a bad or null env is refused.
  - Per lot: the ledger state; `told` = the payload of the newest Inventory row of an uploaded file that CCRS accepted (row submitted/confirmed in a succeeded/errored/reconciling/closed file), else null; `in_flight` = an emitted/uploaded Inventory file names it.
- `ccrs-inventory-delta-core.ts` (pure, 22 self-tests): `decodeInventoryTold`, `changedColumns` (numbers as numbers, IsMedical case-insensitive, text exact), `updatedDateFor`, `planInventoryDelta`, `lotsNamedByEventRows`.
- `ccrs-ledger-store.ts` `loadInventoryTold` (chunks of 1000). `ccrs-batch.ts` pushes Inventory after the event rows are known, through `planInventoryDelta`, and reports left-out lots as advisory **E51_INVENTORY_UNCHANGED_NOT_SENT**.
- Sent when unsure: 0286 absent, no ledger, never accepted, uncertain/rejected last row, in flight, named by an event row (keeps R5-1's closed-lot re-report), or any cell changed. Inserts are never touched.

**Tests.**
- `tests/compliance/r6-3-inventory-unchanged.test.ts`, with spec pins checked against Part 02. The self-test is registered.
- `scripts/recon/ccrs-inventory-told-0286-pg-check.sql` is in POST_APPLY_CHECKS. Its 21 SQL mutants (`scripts/recon/sqlmut/0286.txt`) are all killed.
- TS mutations **M432–M445** (14) are all killed.
- Migration-tail pins were moved to 0286.

**Remaining.** Confirm with an S-16 copy that a lot left out of a week keeps its values in CCRS (U-77).

## R6-4 — CCRS Integrator API client foundation, switched off (DONE in code, 2026-10-21)

Branch `r6-4-integrator-api`. Part 18 rows 13-15. Roadmap R-1 groundwork; no migration.

**Why now.** The owner applied to be Greenway's own integrator (Part 18). Everything that does not need the LCB's answer is built now, so approval only needs credentials plus a PREprod proof. Every rule is from the CCRS Integrator API Guide, verbatim in Part 02 §3.

**Built.**
- `ccrs-integrator-api-core.ts` (pure, 20 self-tests):
  - `CCRS_API_ENDPOINTS`: token URL, audience and upload URL per env `[API L0053-L0075]`.
  - `readIntegratorConfig`: off unless `CCRS_API_<ENV>_ENABLED` is exactly `true`; names missing variables, never values; the Integrator ID must be letters, digits and hyphens.
  - `tokenRequest` and `decodeTokenResponse` `[API L0119-L0135]`; `tokenIsUsable` (same audience, refresh 15 min before expiry) `[API L0137-L0138]`.
  - `integratorFileName` `[G L0047]`.
  - `buildUploadRequest`: Bearer + X-Uploader-Email, one `files` part per file `[API L0080-L0085]`, `[API L0159-L0160]`. It refuses an empty request, duplicates, a name that is not ours, a file without CRLF, and mixed upload groups.
  - `redactRequest`.
  - `classifyUploadResponse`: received / rejected (error or errors[]) / auth_failed (any 401) / server_error / too_large (HTML or 413) / unknown `[API L0187-L0228]`.
  - `nextStep`: retries a 500 with back-off and one cached-token 401 with a new token, at most 3 tries; never retries a rejection, an oversize page or an unreadable answer.
- `ccrs-integrator-api.ts` (server only): `integratorConfig`, `getIntegratorToken` (per-env in-memory cache), `uploadGroupViaApi`. It checks the switch before any request. **No route, cron or screen imports it** (test-enforced).
- `.env.example`: the ten `CCRS_API_PREPROD_*` / `CCRS_API_PROD_*` variables.
- "Acceptance means the file was received for processing" `[API L0230-L0231]`: a `received` answer marks nothing succeeded. The CCRS email (S-12c / S-18a) still decides.

**Tests.**
- `tests/compliance/r6-4-integrator-api.test.ts` (26), with the API quotes checked against Part 02 §3. The self-test is registered.
- TS mutations **M446–M460** (15) are all killed.

**Remaining (needs the LCB).**
- Credentials and the Integrator ID.
- An owner button to send one group by API in PREprod, recording the answer on the `ccrs_files` row.
- The PREprod proof (evidence folder).
- Then the R-1 dry-run switch.
- U-78 (oversize status) and U-79 (Integrator ID format) close on the first PREprod call.

## R6-5 — Keyless Gmail sign-in for the CCRS mailbox monitor (DONE in code, 2026-10-21)

Branch `r6-5-gmail-keyless`. S-18a follow-up; no migration.

**Why.** The owner tried option A (service-account key). Google's secure-by-default organisation policy `iam.disableServiceAccountKeyCreation` blocks key files in new organisations, and Google recommends Workload Identity Federation instead. The cron runs on **Vercel**, so the federation is Vercel to Google (not GitHub).

**Built.**
- `ccrs-mail-core.ts` (pure, 42 self-tests):
  - mode `workload-identity`, selected by `GMAIL_WIF_SERVICE_ACCOUNT_EMAIL`, `GMAIL_WIF_PROJECT_NUMBER`, `GMAIL_WIF_POOL_ID`, `GMAIL_WIF_PROVIDER_ID`;
  - checks: SA email shape, project NUMBER (digits), pool/provider IDs "4-32 characters ... [a-z0-9-]", no `gcp-` prefix (IAM REST reference);
  - more than one sign-in set is refused; with nothing set, the panel names the four keyless variables;
  - `stsExchangeBody`, `signJwtRequest` (the same DWD claims as option A: sub = mailbox, gmail.readonly, 1 hour);
  - `decodeStsResponse` / `decodeSignJwtResponse`, which turn Google's refusals into the fix, including the exact principal to grant;
  - `pickVercelOidcToken` (header, then `VERCEL_OIDC_TOKEN_FILE`, then `VERCEL_OIDC_TOKEN`, as @vercel/oidc 4.x).
- `ccrs-mail-fetch.ts`: `readVercelOidcToken` (request context, no new package), then STS, then signJwt, then the unchanged oauth2 jwt-bearer step.
- Panel text and `.env.example` updated (option K, recommended).

**Tests.** `tests/compliance/r6-5-gmail-keyless.test.ts` (21) runs the whole chain against a fake Google. TS mutations **M461–M474** (14) are all killed.

**Owner setup (one time, about 30 minutes plus up to 24 h for Google).**
Values for Greenway:
- team slug `michael-lymans-projects`;
- project `greenway_website`;
- issuer `https://oidc.vercel.com/michael-lymans-projects`;
- audience `https://vercel.com/michael-lymans-projects`;
- subject `owner:michael-lymans-projects:project:greenway_website:environment:production` (U-81).

Steps:
1. Vercel → project → Settings → Security → "Secure backend access with OIDC federation": ON, issuer mode **Team**.
2. Google Cloud console: create or choose a project. Turn on the **Gmail API** and the **IAM Service Account Credentials API**.
3. IAM & Admin → Workload Identity Federation → Create pool `vercel`. Add an OIDC provider `vercel` with:
   - the issuer above;
   - Allowed audiences = the audience above;
   - mapping `google.subject` = `assertion.sub`.
4. IAM & Admin → Service Accounts → create `ccrs-mail`. Grant no project roles and create **no key**. Note its email and its numeric **Unique ID** (OAuth 2 Client ID).
5. On that service account → Permissions → Grant access to principal `principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel/subject/<subject above>`, with the role **Service Account Token Creator**.
6. Workspace Admin console → Security → Access and data control → API controls → Domain-wide delegation → Add new: Client ID = the Unique ID, scope `https://www.googleapis.com/auth/gmail.readonly`. Google says this "might take up to 24 hours".
7. Vercel → Environment Variables (Production): the four `GMAIL_WIF_*` values. Delete any `GMAIL_SA_*` / `GMAIL_OAUTH_*`. Redeploy.
8. Admin → Compliance → CCRS → "Check the mailbox now". Any refusal is printed with its fix.

**Remaining.**
- U-80: the first real success proves the chain.
- U-81: confirm the issuer mode.

## W-1 — The hub keeps PREprod; email Apply answers where you look (DONE in code, 2026-10-30)

Branch `ccrs-pipeline-w1` (not pushed).

**Rule.** The env the owner picked on `/admin/compliance/ccrs` is part of every link, form and redirect. No button may drop it, so PREprod testing never jumps back to production. An email's Apply/Answer-all only looks at files of the email's own env first, shows its result inside the email panel, and never times out silently.

**Built.**
- `ccrs-hub-flow-core.ts` (pure, 17 self-tests): `hubHref` (always writes `env`, keeps a valid `W-YYYY-MM-DD` week, params cannot overwrite week/env, optional anchor), `hubWeekLink`, `flashParams` / `flashFrom`, `echoEnvScope`, `scopeEchoPool`, `mapLimit`.
- `actions.ts` / `mail-actions.ts`: every redirect goes through `hubHref`; every form carries a hidden `env` / `page_env`. Resolve builds the batch for the page's env. Product-ID assignment stays prod only.
- Email candidates: one `listCcrsFilesLite` query (no issue paging), pool scoped to the email's env with fallback to all, rows read 4 at a time. `export const maxDuration = 300` on the page covers its server actions.
- `CcrsMailPanel`: flash inside the panel, `SaveButton` busy labels on every button, browser-required fields instead of silent refusals, a link to the other env when an email belongs there, error picker filtered to the email's env.
- Page: sticky flash with Dismiss; Step 3 anchor `#ccrs-week`.

**Tests.** `tests/compliance/w1-ccrs-hub-env.test.ts` (14). Mutations **M475–M483** (9) are all killed.

**Remaining.** Page speed (W-2). Duplicate hold-back for every file type (W-3).

## Cross-slice guardrail tests (added in the slice that first needs them, kept forever)

| Test | Slice | Purpose |
|---|---|---|
| no `slice(` on error arrays | S-03 | Part 04 W12 caps never return |
| every `syncIssue` has `code` | S-02 | Part 08 §C contract |
| single portal URL source | S-07 | Part 08 §F |
| single login label source | S-09 | Part 11 |
| triage rule pins resolve to Part 02 lines | S-06 | Part 01 §C "a statement with no pin is an opinion" |
| fix-link routes exist | S-08 | Part 08 §D.2 |
| gate self-test registered | S-01 | N-06 |
| Pacific stamp straddle | S-01 | N-05 |

## What a slice PR body must contain (copy this template)

```
Slice: S-0N <name>  (docs/ccrs-bible/09-slice-plan.md)
Spec pins: [G L####] … [FAQ L####] …
Code pins (before): path L###…   Atlas regenerated: yes (Part 03 header commit → <new>)
Tests added: <file>: <n> cases; self-test registered: <yes/no>
Golden diffs: <none | file: reason + pin>
Verification: tsc 0 / eslint 0 / vitest <n> passed / next build ok
Part 04 rows changed: …   Part 12 items closed/opened: …
UNVERIFIED still open that this slice touches: U-xx …
```

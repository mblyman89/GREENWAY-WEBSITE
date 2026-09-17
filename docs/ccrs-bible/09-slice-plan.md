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
7. `mapAdjustmentRow` with reason mapping to `Other` or `Theft` and empty note → returns `{ row: null, skipReason }` **and** the batch surfaces `E13_ADJUSTMENT_DETAIL_MISSING` as an error (not a silent skip). Customer-return rows (`disposition.ts` L676-L684 writes a note) keep passing.
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

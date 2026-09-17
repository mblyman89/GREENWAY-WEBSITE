# 07 — Cultivera Cutover and Identifier Continuity

## A. The situation, stated from facts

1. Cultivera is Greenway's assigned integrator and uploads the weekly CCRS files today (owner, Part 05 D-01).
2. As integrator, Cultivera is the party that receives LCB error emails: "the individual (integrator) uploading the .CSV file would be notified of any errors, but the licensee will not receive an email." `[FAQ L0102]`
3. Cultivera filed Greenway's inventory using the product **Barcode** as `InventoryExternalIdentifier`. Evidence in-repo: `src/lib/pos/import-lot-core.ts` L17-L19 ("Barcode is ALWAYS populated … and is the [identifier]"), L47-L48 ("Cultivera Barcode — the CCRS-filed inventory identifier"), L420; `src/lib/pos/import-service.ts` L449-L452 ("Cultivera is a WSLCB integrator; the Barcode column is the identifier it filed"). This evidence is the repo's *own* prior research; it is not an LCB statement. It is the best available fact until OD-2 (Public Records) or U-08 (examiner answer) confirms it.
4. CCRS has no read-back: "There is no direct access to the data that has already been reported." `[FAQ L0142-L0143]`; "A license can request their data from the examiner unit for CCRS." `[FAQ L0136]`.
5. Identifiers are licensee-assigned and must be stable: "It is recommended that where possible to continue to use the existing ID structures." `[FAQ L0149]`; changing an id requires an InventoryTransfer with old and new `[G L0124-L0128]`, `[FAQ L0059]`.
6. The environments are separate; nothing rehearsed in PREprod exists in production `[FAQ L0096]`.
7. Only the license administrator can remove an integrator: Account → Licensee → Edit → "Manage Integrators" → uncheck → "Update" `[ADMIN]` Part 02 §5 ("Manage Approved Integrators" steps 1–5). "only the active administrator of the license can assign or remove an integrator." `[FAQ L0081]`
8. Duplicate rules differ per file: Strain duplicate = ignored `[G L0325]`; InventoryTransfer duplicate = error `[G L1190]`; Sale duplicate = error `[G L1390]`; Inventory re-Insert behaviour unknown (U-05).

## A1. CONFIRMED by the Cannabis Examiner Unit, 2026-09-17

The central question of this chapter is answered. Brian McQuay, Data Consultant Supervisor,
Cannabis Examiner Unit, verbatim:

> "For your other questions, please continue to use the IDs already submitted and use the
> update path to update them vs creating new ones, this will simplify your workflow getting
> started doing your own uploads."

**R-1 and R-2 below are confirmed.** The alternative cutover — Insert new identifiers and
file InventoryTransfer rows old→new — is **CANCELLED**; do not build it.

Two operational consequences, both proven in PREprod the same day:

1. **`Insert` vs `Update` must be decided per ROW, from a ledger of what we have filed.**
   A blanket `Insert` fails (`Duplicate External Identifier`, T-33) and a blanket `Update`
   fails for new lots (`ExternalIdentifier not found`, T-35). This is why **S-05b (the
   filed-identifier ledger)** exists and why it should land before the first production
   upload.
2. **R-5 is validated and unforgiving.** The Inventory→Product join is exact-match: T-37
   sent `blue  dream flower 3.5g` against a filed `Blue Dream Flower 3.5g` and got
   `Invalid Product` `[OBS 2026-09-17 T-37]`. Byte-for-byte, including case and double
   spaces.

**Inbound:** the examiner is preparing Greenway's Cultivera-filed records — *"Yes, I can get
your data over to you that has been submitted by your integrator for your license"* —
possibly via Box. **When it arrives it is a first-class source document:** log it in Part 13
with fetch date and checksum, re-pin R-1…R-5 against it, and use it as the ledger's initial
load. It settles R-4 (Areas/Strains as filed) and R-5 (Product names) with data instead of
inference.

## B. Identifier continuity rules (binding for code)

R-1. **Cultivera-imported lots** (`inventory_lots.received_on_source = 'pos_import'`, migration 0214 L72/L136) keep `ccrs_inventory_external_id = sanitized Barcode` exactly as `import-lot-core.ts` L420 produced. If `sanitizeExternalId` changed the barcode (it only alters non-alphanumerics; the example barcode `GF42802505795142` is untouched, test L569), the lot is flagged for review — do not silently upload a different id than Cultivera filed. Add a pure check `barcode === sanitizeExternalId(barcode)` and count the mismatches in the pre-flight (slice S-05).

R-2. **Lots received through intake after cutover** get the id chosen by `deriveInventoryExternalId` (`ccrs-identifiers.ts` L221-L236). Because the vendor's id (`inventory_id` in WCIA JSON, `intake-parser.ts` L371; `InventoryExternalIdentifier` in a CCRS manifest.csv, `ccrs-manifest-csv-core.ts` L492-L498) is the first candidate via `lot_code`, our id **equals the vendor's id when it is already alphanumeric+hyphen**, and differs only if sanitization changed it. In both cases an InventoryTransfer row (E14) is filed with `FromInventoryExternalIdentifier = raw vendor id` and `ToInventoryExternalIdentifier = our id`, which is exactly the guide's rule `[G L0124-L0128]`. Because the rows are Insert-once, keep them idempotent on `ExternalIdentifier = TR-<our id>`.

R-3. **Never rewrite `ccrs_inventory_external_id` on an existing lot.** It is the join key across Inventory, Sale, InventoryAdjustment, InventoryTransfer and the correction files (`0031` header comment, `disposition.ts` L597-L606). If a fix is needed, it is an `Update`/InventoryTransfer at CCRS, not a mutation here.

R-4. **Areas and Strains as filed by Cultivera are unknown.** Strain names we file must exist under the license before Inventory refers to them ("Strain Name reported is not linked to the license number" `[G L0557]`); since Duplicate Strain is harmless `[G L0325]`, always file the full Strain file first. Areas: our `Sales Floor`/`AREA-SALES-FLOOR` will be a new Area under the license; the Inventory rows we `Update` for Cultivera-era lots will move them to it — allowed (`Update` alters an existing record `[G L0246]`). Do not attempt to guess Cultivera's area names.

R-5. **Products**: "Invalid Product" — "validate that you have submitted this product name in the same format and spelling as previously submitted on the product.CSV" `[G L0579-L0583]`. Our Product names come from `composeCcrsProductName`. For Cultivera-era lots the Product name Cultivera filed is unknown; therefore our first production Product file must `Insert` all current names, and the Inventory rows for old lots reference our names. Whether CCRS accepts an Inventory `Update` that changes the Product reference is **U-12** — test in PREprod (T-34 variant) and add to the examiner email.

## C. Parallel run (owner-approved shape from `docs/CCRS_SELF_REPORTING_GUIDE.md` Part B, now tightened)

Week -3 to -1 (at least 2 weeks; owner picks, OD-1):
1. Cultivera keeps filing. The hub generates the weekly batch every Sunday with environment = PREPRODUCTION and the human uploads it to PREprod (Part 06 T-60/T-61). Zero error emails for two consecutive weeks is the exit criterion.
2. Ask Cultivera (in writing) for the exact files it uploaded for one of those weeks, or at minimum the inventory export with Barcode, on-hand, product name, strain, area. Diff against our Inventory file: id set equality, quantity equality. Record the diff in the ledger notes. This is the only cheap way to see what CCRS believes today; the expensive way is OD-2 (Public Records).
3. Confirm the SAW/WA.gov production login works and the uploader's mailbox (the *only* recipient of errors `[FAQ L0102]`) is monitored — OD-5.

## D. Cutover Sunday (the exact sequence)

1. Saturday close: no more sales counted for the week (week is Sunday–Saturday `[FAQ L0041]`).
2. Sunday morning: generate the batch with environment = PRODUCTION. Pre-flight must be green (all E-items are errors; Part 09 S-02/S-03).
3. Upload Group 1 (Strain, Area, Product). Wait ≥10 minutes `[G L0530]`. Check the uploader's mailbox.
4. Upload Group 2 (Inventory). For Cultivera-era lots Operation = `Update` with `UpdatedBy/UpdatedDate` (guide p.8; "Updated Date cannot be prior to Created Date" `[G L0242]`) — **only if U-08 confirmed (a) in Part 06 §G Q5**; otherwise `Insert` new ids and file InventoryTransfer old→new per R-2. Wait ≥10 minutes.
5. Upload Group 3 (InventoryAdjustment, InventoryTransfer, Sale). Wait 30 minutes; if no error email, record the week as `submitted` in the ledger with all file names.
6. Then, and only then, the license administrator removes Cultivera: Account → Licensee → Edit → Manage Integrators → uncheck → Update `[ADMIN]`. Screenshot before/after into the ledger event.
7. Notify Cultivera in writing that Greenway self-reports from week W and that they must not upload for W or later (two uploaders → "Duplicate Sale for Licensee" `[G L1390]` and "Duplicate InventoryTransfer" `[G L1190]`).

## E. Rollback

If Group 1–3 produce errors that cannot be fixed by the Sunday deadline, do **not** remove Cultivera; ask them to file the week as usual, and paste the LCB error emails into the hub for triage (S-06). Repeat the parallel run. "Reporting more frequently than weekly is allowed." `[FAQ L0042]` — a late corrected file is still better than none, but the ledger must record `on_time = false`.

## F. Data the hub must display for this chapter (feeds Part 08)

- Count of lots by `received_on_source` and whether each has a filed-id (Cultivera barcode or intake vendor id).
- Count of lots with `vendor_inventory_external_id` unknown (N-02 backfill gap) — these cannot produce a valid InventoryTransfer row and must be listed with a fix-link to the lot.
- The environment badge on every generated batch and every ledger event.
- The integrator status as last recorded by a human (checkbox in hub: "Cultivera removed on <date> by <user>", stored in `ccrs_upload_events` kind = `integrator_change`).

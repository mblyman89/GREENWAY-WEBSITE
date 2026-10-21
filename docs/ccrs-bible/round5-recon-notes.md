# Round 5 recon notes (work-in-progress checkpoint, 2026-10-20)

Branch: `round5-returns-reach-ccrs-and-reset-proof` (from main `f5c96875`).
Purpose: if the sandbox resets, this file is the full state of the recon and the build plan.
No product code has changed at this checkpoint.

## Owner request (summary)
Clean Slate chosen. Test sales and returns on manifests received through receiving, then factory reset.
Questions: do sales, returns and transfers reach PREprod? Recon vendor returns. Make sure vendor returns,
destructions and all test activity are wiped, and kb_* facts are kept. Build 2 slices, tests first, then mutation-test the tests.

## Findings (verified in code)
- Sales reach PREprod: hub batch export with `env=preprod` -> `buildCcrsBatch` -> outbox (`ccrs_emit_files`).
  Each Sale row's lot must be held by the PREprod ledger or Inserted in the same emission (`L_REF_INVENTORY`).
- Customer returns: the inventory add-back reaches CCRS as InventoryAdjustment "Other" in the batch.
  The Sale CORRECTION (Delete/Update, "the sale identifier should be deleted from CCRS" [FAQ L0039]) does NOT:
  it is a separate manual download (`/admin/inventory/disposition/sale-correction-export`) that is
  (G1) not env-aware, not ledgered, not in the batch, and marks returns "exported" on download;
  (G2) a second partial return on the same line computes the wrong remaining quantity (it uses only that return's quantity);
  (G3) the ledger slice (`ccrs_ledger_slice`, 0248) never returns Sale entities, so Update/Delete of a Sale
  cannot be checked ("SaleDetailExternalIdentifier not found" [G L1414]).
  `ccrs_promote_rows` (0249) DOES record Sale entities (state filed, Delete -> deleted) once an outcome is recorded.
- Vendor returns (`createVendorReturn`): InventoryAdjustment "Other" with RMA/manifest detail. No InventoryTransfer
  row (only the receiving licensee submits transfers). Reaches CCRS in the batch.
- Destructions: InventoryAdjustment "Destruction" once completed (hold configurable, 0 h allowed).
  `completeDestruction` sets the lot status to `destroyed` when on hand <= 0.
- Inbound InventoryTransfer: always emitted empty (retailer reports intake via Inventory.csv).
- Reset (0240 truncate): orders, order_lines, customer_returns, vendor_returns, destruction_events,
  inventory_adjustments, inventory_lots, inbound_manifests, pos_sale_events ... are WIPE. All 16 kb_* tables are KEEP.
  A write-scan of POS/orders/inventory/receiving/disposition code found no unclassified table; every activity table is WIPE.
  CCRS ledger/outbox tables (ccrs_files, ccrs_filed_entities, ccrs_file_rows, ccrs_product_ids) are KEEP by design:
  PREprod files emitted but never answered survive the reset and must be answered or abandoned.
- `gl_audit_factory_reset` (0209) does not check activity tables or kb_* survival.

## Build plan
Slice 1: return corrections reach CCRS through the batch, per env, checked against the Sale ledger.
  - Pure core `ccrs-return-corrections-core.ts`: one row per SaleDetail id; the cumulative returned quantity
    comes from ALL returns on that line; Delete when cumulative >= original; Update/Delete only when
    the PREprod/prod ledger holds the SaleDetail id; otherwise withheld with E48 [G L1412-L1414].
  - Migration 0283: `ccrs_ledger_slice` also returns the Sale entities asked for.
  - Batch merges corrections into the single Sale file; mark exported only after the outbox emit, per env.
  - Fix the manual route's cumulative bug.
Slice 2: reset proof.
  - Pure check of the reset summary: every activity table was emptied (it is in `tables`), no kb_* table was touched.
  - Guard test: every table written by POS/inventory/receiving/disposition code is WIPE unless it is in an explicit KEEP allowlist.
  - Reset page: list CCRS files that are emitted or uploaded but unanswered (they survive the reset).

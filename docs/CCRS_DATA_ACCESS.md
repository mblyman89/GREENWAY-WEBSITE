# CCRS Data Access — How to get your real product/inventory data, and how we keep IDs aligned

_Prepared as your compliance advisor. Sources: WSLCB CCRS Upload User Guide (June 2025), the
official [CCRS FAQ](https://lcb.wa.gov/ccrs/faq), and the [CCRS Resources page](https://lcb.wa.gov/ccrs/resources)._

## TL;DR (the honest answer)

**There is no way for me — or any software — to "log into" your CCRS database and read your product
data.** The WSLCB confirms this directly:

- **No API.** _"Does CCRS allow integrators to use an API? **No.** There is no Application Programming
  Interface (API) for CCRS."_
- **No portal export / no direct read access.** _"There is **no direct access to the data that has
  already been reported**."_ CCRS is **upload-only** (you submit `.CSV` files; you cannot pull data
  back out of the UI).
- **The only ways to obtain your reported data:**
  1. **Public Records request** to the LCB (the licensee requests their own license-specific
     records), or
  2. an **approved Integrator** that you have explicitly assigned to your license can request a copy
     of your data on your behalf.

So I **cannot** be "let into" your live CCRS. What I _can_ do is make our system produce perfectly
aligned files and give you a clean way to reconcile against whatever you pull from CCRS.

## What this means for "InventoryExternalIdentifier"

The single most important CCRS rule for us (from the Upload Guide):

> _"The external identifier is an alpha-numeric identification **assigned by the licensee** (or
> integrator)."_ It is **Text(100)**, and the **same** identifier is reused across **Inventory.csv,
> LabTest.csv, Sale.csv, Transfer.csv, and InventoryAdjustment.csv**.

And from the FAQ, the recommended practice when you can't see prior IDs:

> _"It is recommended that where possible to continue to use the existing ID structures."_

Because **we** assign the IDs (the state never generates them), the right architecture is:

1. **One canonical `InventoryExternalIdentifier` per inventory lot**, assigned **once** at intake and
   **never changed** (CCRS keys records by it — drift = "Invalid InventoryExternalIdentifier" errors).
2. **Reuse that exact id everywhere** — on the Inventory.csv you file, on LabTest.csv, and on every
   Sale.csv line that sells from that lot.

This is now implemented (Slice 22):

- `inventory_lots.ccrs_inventory_external_id` stores the canonical id (migration **0034**, with a
  deterministic backfill for existing lots).
- At intake we assign it deterministically: **lot code → POS product key → `LOT-<id>`**, sanitized to
  alphanumerics + single hyphens, clamped to 100 chars (`deriveInventoryExternalId`).
- The Sale.csv generator resolves each line in priority order: **explicit per-line override →
  matched lot's canonical id → sanitized POS product key (degraded fallback)** and **warns** you when
  it had to fall back, when an id is quarantined, or when an id looks invalid.

## How YOU verify our IDs match your real CCRS data (the reconciliation play)

Since CCRS won't show me your data, here's the concrete, low-effort path:

### Option A — Public Records request (you, the licensee)
1. Submit a **Public Records request** for **your license's** CCRS records (especially the
   **Inventory** records, which contain each item's `ExternalIdentifier`). Start here:
   <https://lcb.wa.gov/records/public-records>.
2. When you receive the export (CSV/spreadsheet), send it to me (or upload it to the workspace). I'll
   build a one-click **reconciliation report** that matches your real CCRS `ExternalIdentifier`s
   against our `inventory_lots.ccrs_inventory_external_id` / `pos_product_key`, and flags:
   - items in CCRS we have no lot for,
   - lots we have that aren't in CCRS yet,
   - id mismatches we should correct via an **Inventory Transfer** "Update" (per the FAQ, the way to
     change an id is an Inventory Transfer providing both old and new IDs — not an in-place edit).

### Option B — If you use/assign an Integrator
- The active **license administrator** can assign an approved integrator in CCRS, and that integrator
  can request a copy of your data. (Only the administrator can assign/remove integrators.) If you ever
  want this back-office to become an approved integrator, that's a separate LCB approval process:
  <https://lcb.wa.gov/ccrs/approval_process>. **Not required** for our upload-file workflow.

### Option C — Pre-production (training/testing) sandbox
- The LCB provides a **PRE-production CCRS environment** for testing uploads without touching live
  data. We can dry-run our generated `Sale.csv` / `Inventory.csv` there before filing for real.
  (Note: pre-prod and prod are autonomous — assignments/data don't carry over.)

## What I need from you to go further

1. **(Best) A Public Records export of your current CCRS Inventory** (even a one-time snapshot). That
   lets me reconcile real ids and tell you exactly which of our keys to correct.
2. Confirmation of **how you've historically assigned inventory external identifiers** (e.g., vendor
   lot codes? your own SKU scheme?) so our `deriveInventoryExternalId` order matches your existing
   structure. Today it prefers **lot code**, then **POS product key**.
3. Your **6-digit license number** entered in Compliance settings (already supported) — it's required
   on every CCRS row.

## Other CCRS facts I baked in / flagged while researching (so we stay clean)

- **File names use PST.** (Our timestamps are now Pacific — Slice 20.)
- **Medical sales** are reported as **`RecreationalMedical`** (not `RecreationalRetail`), product must
  be marked **"Medically Compliant"** in Inventory, store needs a DOH **Medical Endorsement**, and
  both tax columns are **$0.00**. _(Feature H/I — to be built; our Sale.csv currently emits
  `RecreationalRetail`; we'll add the medical path.)_
- **Trade samples** need **$0.01** Total Cost and "Trade Sample" in the name/description. _(Feature F.)_
- **Returns:** **delete** the Sale identifier, then file an **Inventory Adjustment (return)** — never
  negative-sell. _(Future inventory-adjustment work.)_
- **Infused pre-rolls** are categorized as **Concentrates** in CCRS (affects sales-limit math).
- **Quarantine:** cannabis is normally **not** quarantined; CCRS rejects sales of quarantined
  inventory. Our exporter now warns if a sold lot is still in quarantine.
- **Excise tax is paid via CCRS** per the Cannabis Tax Reporting Guide — relevant to the upcoming
  excise-payment feature.

---

_Bottom line: I can't be given a login to read your live CCRS, because that capability doesn't exist
for anyone. The compliant, expert path is: we assign and persist one stable external id per lot
(done), you pull a Public Records snapshot of your CCRS inventory, and I build a reconciliation report
to align them. Send me that snapshot whenever you have it._

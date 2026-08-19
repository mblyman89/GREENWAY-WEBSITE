# Returns & Destruction — WA Retailer Compliance Reference (Task Q)

> **Audience:** This document is written specifically for an AI (or a careful human)
> to use as the authoritative reference and guide when building, reviewing, or
> operating the returns/destruction features of the Greenway back office.
> Every claim below was verified against the CURRENT rule text or an official
> LCB publication at the time of writing (July 2026). Sources are cited inline.
> **Never guess: if a claim is not in this document, verify it at the source
> before acting on it.**

Licensee context: Greenway Marijuana, WA I-502 cannabis **retailer**,
LCB license **413541** (Port Orchard). Everything below is written from the
retailer's perspective — producer/processor-only rules are called out as such.

---

## 1. The three disposition flows (and what each one is, legally)

| Flow | Legal basis | Inventory effect | CCRS reporting shape |
| --- | --- | --- | --- |
| **Customer return** (a consumer brings product back) | WAC 314-55-079(12) | Product comes BACK into inventory, then is either restocked or destroyed | Sale record **Delete/Update** + InventoryAdjustment "as a return" (see §5.1) |
| **Vendor return** (retailer sends product back to a processor) | WAC 314-55-079(11) + WAC 314-55-085 (transport/manifest) | Product LEAVES inventory | CCRS **manifest** (created in the CCRS portal) + InventoryAdjustment `Other` with detail (see §5.2) |
| **Destruction / waste disposal** (render unusable on premises, dispose) | WAC 314-55-097 (waste) + WAC 314-55-083(4) (traceability) | Product LEAVES inventory | InventoryAdjustment `Destruction` (see §5.3) |

A fourth, special path overrides all of the above:

| Flow | Legal basis | Critical constraint |
| --- | --- | --- |
| **Recall / administrative hold** | WAC 314-55-225 | A retailer is **PROHIBITED from destroying recall-affected product before notifying LCB and coordinating destruction with the enforcement officer** (see §4) |

---

## 2. Customer returns — WAC 314-55-079(12) (current text)

The current rule (effective 11/12/22) says a cannabis retailer **may accept
returns of open cannabis products from customers**, with one hard condition:

> "Products must be returned in their **original packaging** with the
> **lot, batch, or inventory ID number fully legible**."
> — WAC 314-55-079(12), current text at apps.leg.wa.gov

Operational requirements this creates for the POS/back office:

1. **Attestation gate.** Before a return is accepted, staff must confirm BOTH:
   (a) the product is in its original packaging, and (b) the lot/batch/inventory
   ID on the package is fully legible. If either fails, the return **must be
   refused** (the product cannot re-enter the traceability chain).
2. **Open products are OK.** The rule explicitly allows returns of *open*
   products — "we can't take it because it's open" is NOT a valid refusal
   reason under current rule. (Store policy may still be stricter.)
3. **Disposition decision.** Once accepted, the retailer decides:
   - **Restock** — only defensible for unopened, undamaged, correctly stored
     product; goes back to the same inventory identifier (lot).
   - **Destroy** — the professional default for any opened, damaged, or
     quality-suspect product: quarantine it, then destroy per WAC 314-55-097.
4. **Money.** Refund amounts are business decisions (not LCB-regulated), but
   the tax consequences flow to the excise/sales-tax books: a refunded sale
   that is deleted/updated in CCRS should be mirrored in the sales-tax and
   excise (LIQ-1295) figures for the affected period. Keep the refund record.

### CCRS shape for a customer return (verbatim from the LCB CCRS FAQ)

> **"How does a retailer report a return in CCRS? If a retailer receives a
> valid return from a customer, the sale identifier should be deleted from
> CCRS, and the inventory identifier reported on an Inventory Adjustment as a
> return, with details provided about why it was a return."**
> — lcb.wa.gov/ccrs/faq

So a customer return is TWO CCRS records:

1. **Sale correction** — a Sale.csv row for the original
   `SaleExternalIdentifier` / `SaleDetailExternalIdentifier` with
   `Operation = Delete` (full return of the line) or `Operation = Update`
   (partial return; report the REMAINING quantity and recomputed taxes).
   The Upload User Guide (June 2025) confirms `Operation` valid values:
   *Insert (create new), Update (alter existing record indicated by external
   identifier), Delete (delete a record indicated by external identifier)*,
   and that SaleExternalIdentifier/SaleDetailExternalIdentifier are required
   on Insert, Update AND Delete. `UpdatedBy`/`UpdatedDate` must be filled on
   corrections, and *"Updated Date cannot be prior to Created Date."*
2. **InventoryAdjustment** — the returned quantity is ADDED BACK to the
   original inventory identifier. Per the FAQ the reason is reported "as a
   return, with details" — since `Return` is NOT a valid `AdjustmentReason`
   (valid values: `Destruction | Reconciliation | Lost | Seizure | Theft |
   ReturnedLabSample | Other`), the correct encoding is **`Other` with an
   `AdjustmentDetail` that states it is a customer return and that the
   quantity is being ADDED back** (the Quantity column allows *no negative
   entries* — direction goes in the detail text). `AdjustmentDetail` is
   **REQUIRED** whenever reason is `Other` or `Theft` (Upload User Guide).

If the returned product is then destroyed (not restocked), a SECOND
InventoryAdjustment with reason `Destruction` reports the reduction when the
destruction is completed (§5.3). The ledger therefore shows: sale deleted →
quantity added back (`Other`, "customer return — ADD") → quantity destroyed
(`Destruction`). That is the complete, audit-proof story.

---

## 3. Vendor returns (retailer → processor) — WAC 314-55-079(11) + WAC 314-55-085

Current WAC 314-55-079(11): a retailer may transport product to its own other
locations **or return product to a cannabis processor**, subject to the
transportation/manifest rules of WAC 314-55-085.

Operational requirements:

1. **A CCRS-generated manifest is mandatory.** Transport manifests must be
   generated from CCRS itself (the Manifest function in the CCRS portal) —
   POS-generated manifest PDFs are NOT valid, and **contingency manifests are
   no longer available (discontinued November 18, 2025)**.
2. **Lead time.** Industry guidance (POSaBIT, aligned with LCB practice):
   submit the return manifest **48–72 hours before pickup**. LCB confirms
   manifests on **Monday / Wednesday / Friday** via email from
   info@lcb.wa.gov. Do not release product before the manifest is confirmed.
3. **Agreement with the processor.** Get the processor's acceptance (an RMA
   number or written confirmation) BEFORE creating the manifest. The
   processor reports the receipt on their side (InventoryTransfer is uploaded
   by the RECEIVER per the Upload User Guide).
4. **Retailer-side CCRS record.** There is no retailer "transfer-out" CSV.
   The retailer's on-hand reduction is reported as an **InventoryAdjustment
   with reason `Other`** and a detail naming the return (processor, manifest
   number, RMA). The Upload User Guide's own mapping table for destruction
   reasons lists "Returned to seller → Other", confirming `Other` +
   detail is the LCB-expected encoding for product going back up the chain.
5. **Records.** Keep the manifest, the processor confirmation, and the RMA
   with the return record for five years (WAC 314-55-087 record retention —
   three years until WSR 24-19-040, effective 10/12/2024).

---

## 4. Recalls & LCB coordination — WAC 314-55-225

- **Exempt market withdrawal** (no consumer-safety risk): notify the local
  LCB enforcement officer **within 48 hours** of initiating the withdrawal.
- **Consumer-safety recall:** IMMEDIATELY notify the LCB enforcement officer;
  secure and isolate the affected product; a recall plan is required and
  weekly progress reports are expected.
- **HARD RULE:** the licensee is **prohibited from destroying any affected
  cannabis product until the LCB has been notified and destruction has been
  coordinated with the enforcement officer**. Any destruction flow in the app
  MUST block completion of a recall-reason destruction until the operator
  confirms LCB coordination happened (name/date of the officer contact).

---

## 5. Destruction & waste disposal — WAC 314-55-097 (current, effective 4/12/2025)

### 5.1 What changed — the 72-hour notices are GONE (do not re-assert them)

- The **old** WAC 314-55-079(10) (2016/2017 text) required a retailer to give
  LCB enforcement **72 hours' notice** before destroying product. That
  language **does not exist in the current rule** (verified by comparing the
  2017 PDF snapshot against the current apps.leg.wa.gov text).
- The **old** WAC 314-55-097(4)(b) (2017 text) required producers/processors
  to give a minimum of **72 hours' notice in the traceability system** before
  rendering product unusable. That language was **struck by WSR 22-14-111**
  and does not exist in the current rule either.
- **Consequence for this codebase:** the legacy hardcoded
  `DESTRUCTION_QUARANTINE_HOURS = 72` is based on the outdated rule. A hold
  window before destruction remains a **conservative best practice** (it
  gives time to catch mistakes, coordinate witnesses, and mirrors the
  quarantine concept), but it is **no longer a current-rule mandate** and the
  app must not claim it is. The hold is now a configurable store policy
  (default 72h, may be shortened to 0) — documented in the UI as policy, not law.

### 5.2 Rendering unusable (current rule)

Cannabis waste must be **rendered unusable BEFORE it leaves the licensed
premises**. The approved method is **grinding and incorporating the cannabis
waste with other ground material so the result is at least 50 percent
non-cannabis waste by volume**. Acceptable mixing materials:

- **Compostable mix:** food waste, yard waste, vegetable-based grease/oils.
- **Non-compostable mix:** paper waste, cardboard waste, plastic waste.

**Any other method requires PRIOR LCB approval.** After rendering unusable,
dispose of the material at a **permitted solid waste facility** (or compost
facility for compostable mix).

### 5.3 Records the rule requires

Per current WAC 314-55-097 — subsection (7)(e) states "All required records
must be kept consistent with the requirements in WAC 314-55-087", so waste
records inherit the WAC 314-55-087 retention period, which is FIVE years since
WSR 24-19-040 (effective 10/12/2024) — the licensee must keep records of:

- **what** was destroyed (product, lot/inventory identifier, quantity),
- **when** it was rendered unusable and disposed,
- the **method** used to render it unusable (incl. the ≥50% mix),
- the **final destination** of the waste (the disposal/compost facility).

The app therefore captures on every completed destruction: rendering method,
mixing material, method detail, witness name(s), final destination /
disposal facility, completion timestamp, and the acting staff member.

### 5.4 CCRS shape for a destruction

Retail product destruction is reported as an **InventoryAdjustment with
`AdjustmentReason = Destruction`** (Upload User Guide Table 3:
"Destruction/Disposal → Destruction"). Quantity is the positive magnitude;
the detail carries reason/method. (`plantDestruction.csv` is a
producer/processor file for PLANTS — retailers do not file it.)

Traceability timing: WAC 314-55-083(4) lists "when a lot or batch is to be
destroyed" among the key reportable events, and CCRS reporting is weekly,
Sunday–Saturday (LCB Policy Statement PS21-10) — destructions must appear in
that week's InventoryAdjustment.csv upload.

### 5.5 Theft / loss (adjacent flows, for completeness)

- Theft: reportable event (WAC 314-55-083(4)); CCRS `AdjustmentReason =
  Theft`, and **AdjustmentDetail is REQUIRED for Theft**.
- Lost/shrink/damage: CCRS `Lost`.
- LCB seizure: CCRS `Seizure`.

---

## 6. CCRS file mechanics that constrain the implementation

Verified against the CCRS Upload User Guide (June 2025) and the live LCB
templates:

1. **InventoryAdjustment.csv is 12 columns:** `LicenseNumber,
   InventoryExternalIdentifier, AdjustmentReason, AdjustmentDetail, Quantity,
   AdjustmentDate, ExternalIdentifier, CreatedBy, CreatedDate, UpdatedBy,
   UpdatedDate, Operation`.
2. **Quantity is never negative** (upload error: "No Negative entries
   allowed"). Direction must be stated in `AdjustmentDetail`
   (e.g., "ADD back to inventory — customer return of …").
3. **AdjustmentDetail is REQUIRED when reason = `Other` or `Theft`.** Since
   both the customer-return add-back and the vendor return use `Other`, their
   details must never be empty.
4. **The same `InventoryExternalIdentifier` must be reused** across
   Inventory, Sale, and InventoryAdjustment for a given lot; an adjustment
   for an identifier never filed on an Inventory.csv fails with
   "Invalid InventoryExternalIdentifier".
5. **Sale.csv corrections:** `Operation = Update|Delete` on rows carrying the
   ORIGINAL `SaleExternalIdentifier` + `SaleDetailExternalIdentifier`. All
   required fields must still be present; `UpdatedBy`/`UpdatedDate` are
   filled; "Updated Date cannot be prior to Created Date"; quantities and
   money are non-negative decimal dollars (no $, no parentheses).
6. **File header:** 3 rows (`SubmittedBy`, `SubmittedDate`, `NumberRecords`)
   and `NumberRecords` must exactly equal the data-row count.
7. **Upload order:** Group 1 (Strain, Area, Product) → Group 2 (Inventory) →
   Group 3 (InventoryAdjustment, InventoryTransfer, Sale). Adjustments and
   Sales depend on Inventory already being on file.
8. **Quarantine areas:** CCRS rejects sales of inventory reported in a
   quarantine area ("Sold item cannot be in Quarantine"), and per the guide,
   `IsQuarantine = TRUE` areas are only for imported CBD — cannabis product
   destruction staging should NOT be filed as a CCRS quarantine area. The
   app's internal `quarantine` lot status is an internal shop-floor signal
   only; it is not reported as a CCRS quarantine area.
9. **Login:** CCRS uses SecureAccess Washington (SAW); LCB has announced a
   transition to WA.gov login (Oct 2026). Harvest.CSV / updated Manifest.CSV
   (Oct 2025) are producer/processor requirements and do not change retailer
   disposition reporting.

---

## 7. How the Greenway app implements this (map for future AI sessions)

| Concern | Where |
| --- | --- |
| Pure disposition logic + guardrails + self-tests | `src/lib/inventory/disposition-core.ts` |
| Sale-correction (Delete/Update) pure builder + self-tests | `src/lib/compliance/ccrs-sale-correction-core.ts` |
| DB-backed store (returns, destructions, settings) | `src/lib/inventory/disposition.ts` |
| Drafts-only AI advisor (aggregate-fed) | `src/lib/inventory/disposition-advisor.ts` |
| Command-center UI | `src/app/admin/inventory/disposition/page.tsx` (+ `actions.ts`) |
| Sale-correction CSV download | `src/app/admin/inventory/disposition/sale-correction-export/route.ts` |
| Internal→CCRS reason mapping | `src/lib/compliance/ccrs-inventory-adjustment-core.ts` (`mapAdjustmentReason`; internal `return` → `Other`) |
| Schema | `supabase/migrations/0042_returns_destruction_samples.sql` + `0115_disposition_command_center.sql` |
| Tests | `tests/compliance/disposition-core.test.ts` |

Design decisions (deliberate, documented):

- **Hold before destruction is store policy, not law** (§5.1). Configurable
  `hold_hours` (default 72, range 0–336) in `disposition_settings`.
- **Recall-reason destructions cannot complete** until the operator confirms
  LCB coordination (officer/date captured) — WAC 314-55-225 (§4).
- **Customer returns require both attestations** (original packaging +
  legible lot ID) — WAC 314-55-079(12) (§2). Refunds are recorded in minor
  units (cents).
- **Customer-return restock posts a POSITIVE adjustment** with internal
  reason `return` → CCRS `Other` + mandatory detail stating "ADD". The
  original sale is corrected via the Sale-correction CSV (Delete for full
  line return, Update with remaining quantity for partial).
- **Customer-return destroy path** posts the add-back adjustment AND opens a
  destruction event for the returned quantity so the ledger tells the whole
  story (§2).
- **Vendor returns** keep internal reason `other` (already-merged CCRS
  behavior) and now track manifest number/status, pickup time, and processor
  license, with 48–72h lead-time guidance surfaced in the UI (§3).
- **Destruction completion captures** rendering method (grind+mix
  compostable / grind+mix non-compostable / LCB-approved other), mixing
  material, ≥50% attestation, witness, final destination, disposal facility
  (§5.2–5.3). All of it lands in the adjustment note (250-char clamped) and
  the `destruction_events` row.
- **Graceful pre-migration degradation:** all new columns/tables are read
  defensively; before migration 0115 is applied the page still renders and
  legacy flows still work.

## 8. Primary sources

- WAC 314-55-079 (current): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-079
- WAC 314-55-097 (current): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-097
- WAC 314-55-225 (recalls): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-225
- WAC 314-55-083 (traceability): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-083
- WAC 314-55-085 (transport/manifest): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-085
- WAC 314-55-087 (records, 5-year retention): https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087
- WSR 22-14-111 (rulemaking that removed the old 72h notice language)
- CCRS FAQ (customer-return answer, verbatim §2): https://lcb.wa.gov/ccrs/faq
- CCRS Upload User Guide (June 2025 PDF, lcb.wa.gov) — Operation semantics,
  12-column adjustment file, required-detail rules, Sale required fields
- LCB Policy Statement PS21-10 (weekly Sun–Sat reporting)

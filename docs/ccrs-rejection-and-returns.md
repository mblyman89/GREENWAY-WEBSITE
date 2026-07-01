# CCRS-Compliant Rejection & Returns of Inbound Product

_Compliance research grounded in fact. Sources: [WSLCB CCRS Transportation
Manifest User Guide](https://lcb.wa.gov/ccrs/manifests) (Oct 2025), the **Feb 26 2026
CCRS Manifest Guide (CIB140)** and its
[education bulletin](https://content.govdelivery.com/accounts/WALCB/bulletins/40bc9f3),
the [Fall 2025 CCRS Enhancement bulletin](https://content.govdelivery.com/accounts/WALCB/bulletins/3fd0886),
[POSaBIT "CCRS – How to Perform a Return Manifest"](https://support.posabit.com/washington-ccrs/ccrs-how-to-perform-a-return-manifest),
[CCRS FAQ](https://lcb.wa.gov/ccrs/faq), WAC 314-55-083(4)/085. This document
governs how the back office lets an employee "reject" inbound product without
breaking compliance._

## ⭐ OWNER CLARIFICATION (verbatim) — governs this build

> "Currently when ever a vendor brings in product, we can choose to reject it, in
> other words we don't or have not ever had to process a return manifest. We just
> tell the vendor to take it back with them. So we need the ability to tell the
> system that we are only accepting a part of the manifest and the rest was
> rejected. There are several instances where the vendor forgot to send an item,
> or it broke in transit, etc. but again, we have never had to re manifest the
> products back."

**This is "Refuse at the dock" (Outcome A below), NOT a Return Manifest.** The
build target is **partial acceptance**: accept the good lots into inventory, mark
the rest rejected-with-reason (never received, never destroyed, no return
manifest). Confirmed compliant by the sources below.

## Why refuse-at-dock needs NO CCRS action from us (the fact grounding)

1. **The manifest belongs to the ORIGIN (the vendor).** The vendor uploads the
   `Manifest.CSV`; CCRS emails the PDF confirmation to both parties. The
   `HeaderOperation` field (`Insert` / **`Update`** / **`Delete`**) is on the
   *vendor's* file. The **receiving** licensee has **no CCRS transaction** for
   accepting or refusing a delivery. (CCRS Manifest User Guide, header attributes.)
2. **Our reporting duty attaches only to product we actually receive into
   inventory.** Product that stays on the truck is never added to our `Inventory.csv`,
   so there is nothing for us to report or destroy. WAC 314-55-083(4) governs *our*
   traceability of *our* inventory — refused product was never ours.
3. **The vendor fixes their own record** for a short/broken/refused item using the
   CCRS **`Update`** operation (correct the `Quantity`) or **`Delete`** operation
   (remove the line). The Feb 26 2026 Manifest Guide (CIB140) explicitly documents
   "how to edit previously submitted manifests with the 'update' and 'delete'
   processes to ensure accuracy." That is the vendor's responsibility, not ours.
4. **CCRS processes files in <15 minutes** (Fall 2025 bulletin), so the vendor's
   correction is near-real-time. Contingency manifests are **discontinued**
   (violating WAC 314-55-085 / 083(4) if used).

**Conclusion:** Our compliant action for a rejection is purely **local** — only
accept the good lots, log the rejected lots + reason for our own audit trail, and
remind staff to have the **vendor** submit an `Update`/`Delete` on their manifest.
We never file anything with CCRS for refused product and we never auto-destroy it.

## The honest reality: CCRS has no "reject" button

There is **no reject / refuse transaction type in CCRS**. CCRS is upload-only and
has **no API and no inbound feed** (confirmed in `CCRS_DATA_ACCESS.md`). The flow
for an inbound transfer is:

1. The **origin (vendor)** uploads a `Manifest.CSV` to CCRS naming Greenway as the
   `DestinationLicenseNumber`.
2. CCRS validates dependencies (Strain/Area/Product → Inventory → Manifest) and,
   on success, **emails a PDF Manifest Report** from `info@lcb.wa.gov` to the
   sending licensee, the receiving licensee (us), the integrator and transporter.
3. The receiving licensee has **no CCRS action** that says "I reject this." CCRS
   does not track acceptance on the receiving side at all.

Therefore, in our system, "reject" is a **local business decision + a compliant
physical/paper action**, not a CCRS API call. There are exactly two compliant
outcomes when product arrives and we do not want to keep some or all of it:

### Outcome A — Refuse at the dock, product never leaves the truck
If the driver is still present and the product is refused on the spot, the goods
simply **do not get received** and leave with the driver. Nothing was ever added
to our inventory, so there is nothing for us to report. We record this **locally**
(who refused, why, when) for our own audit trail, but we file **no CCRS record**
because the lots were never our reported inventory. The **origin** remains
responsible for the goods on the origin's books.

### Outcome B — Return to origin via a Return Manifest (the CCRS-compliant path)
If we have already **accepted the product into our inventory** (it became our
reported `Inventory.csv` lots) and later decide to send some or all of it back,
the compliant mechanism is a **Return Manifest**: a **new, outbound**
`Manifest.CSV` that **we upload**, where:

- `OriginLicenseNumber` = **Greenway** (we are now the origin/shipper),
- `DestinationLicenseNumber` = the **original vendor** (they receive it back),
- the data rows list **only the lot(s) / quantity(ies) being returned**, each keyed
  by its existing `InventoryExternalIdentifier`,
- `Quantity` is `decimal(10,2)` — so **partial-lot returns are supported**
  (e.g. return 12.00 of 48 units).

Because the Return Manifest is just a normal outbound manifest with us as origin,
**it reuses the exact same outbound manifest generator** we already build for
transfers. There is no special "return" file type in CCRS — it is a Manifest with
the direction reversed.

## Partial acceptance (owner request: "partially accepted flag/badge")

CCRS has no concept of a manifest that is "partially accepted." From CCRS's point
of view each **inventory lot** either exists in our reported inventory or it does
not. So "partial acceptance" is, again, a **local** status we track for the
employee's clarity, backed by two compliant real-world actions:

1. **Accept the good lots** into inventory exactly as normal (quarantine → active),
   and
2. For the **rejected lots/quantities**, either
   - **Refuse at the dock** (Outcome A — nothing entered our inventory), or
   - **Accept then Return** (Outcome B — a Return Manifest sends them back).

So a manifest becomes **`partially_accepted`** locally when **some** of its lots
were accepted and **at least one** lot was rejected (refused or returned). The
badge is a convenience/label; the compliance lives in (a) the accepted lots being
correctly in inventory and (b) the rejected lots being either never-received or
covered by a Return Manifest.

## Guard rails baked into the back office

1. **No silent destruction.** The old `rejectManifest` marked every lot
   `destroyed`. That is **wrong** for a normal vendor rejection — destruction is a
   `Destruction`/`InventoryAdjustment` event with its own WAC rules and 48-hour /
   scheduled-destruction obligations, not the same thing as sending product back.
   Rejection now defaults to **return-to-vendor** or **refused-at-dock**, never
   auto-destroy. Destruction stays a separate, explicit path.
2. **Reason is mandatory.** Every reject (lot or manifest) requires a reason
   (failed COA, wrong product, damaged, overage, expired, etc.) recorded in the
   manifest event log for audit.
3. **Return Manifest reminder.** When a reject disposition is "return to vendor,"
   the UI surfaces the CCRS Return-Manifest steps and the **48–72 hour lead-time**
   guidance (submit before pickup; confirmations arrive Mon/Wed/Fri from
   `info@lcb.wa.gov`). We do not auto-file anything with the state; we prepare the
   record and remind the employee to complete the CCRS upload.
4. **Refused-at-dock files nothing with CCRS.** If the disposition is
   "refused at dock," we explicitly note in the UI that **no CCRS record is
   required** because the lots never entered our reported inventory — preventing an
   employee from over-reporting.
5. **Partial state is derived, not free-typed.** `partially_accepted` is computed
   from the per-lot dispositions so the badge can never lie.
6. **Contingency manifests are discontinued** (WSLCB, effective Nov 18 2025) — the
   only accepted transport document is the CCRS Manifest. The UI must never suggest
   a contingency manifest.

## Per-lot disposition model

Each manifest lot gets a **disposition**:

| disposition        | inventory effect                | CCRS effect                          |
|--------------------|---------------------------------|--------------------------------------|
| `accepted`         | quarantine → active             | none (was already vendor's manifest) |
| `refused_at_dock`  | never activated (stays quarantine → voided/`refused`) | none (never our inventory) |
| `returned_to_vendor` | activated then flagged for return | **Return Manifest** (we upload)   |
| `destroyed`        | → destroyed                     | Destruction / InventoryAdjustment (separate path) |

A manifest's derived status:
- **accepted** — all lots `accepted`.
- **rejected** — all lots `refused_at_dock`/`returned_to_vendor`/`destroyed`.
- **partially_accepted** — a mix (≥1 accepted **and** ≥1 rejected).

## Timing (from the WSLCB / POSaBIT guidance)
- Submit return/transfer manifests **48–72 hours before pickup**.
- CCRS confirmations are processed **Mon / Wed / Fri**; the confirmation email
  comes from **`info@lcb.wa.gov`** with a PDF attached.
- A success email + PDF means it worked even if a separate error email also
  arrives (known CCRS quirk); a lone error email means the CSV failed.

## What we will build (Slice 81) — REVISED per owner clarification

The owner's real-world flow is **refuse-at-dock partial acceptance** — the driver
takes rejected product back and the vendor corrects their own manifest. So the
build is:

- Add a per-lot **disposition** to `inventory_lots`: `accepted` |
  `rejected_at_dock` (with a mandatory `reason`). Add a manifest-level derived
  capability so its status can become **`partially_accepted`**.
- Replace the old destructive whole-manifest reject (which set every lot
  `destroyed`) with a **reason-required, disposition-aware** accept/reject that
  works **per lot** and **whole manifest**, and **never auto-destroys** and
  **never files a return manifest**.
- On **accept**: only lots marked `accepted` go quarantine → active; drafts/COAs
  seed only for accepted lots. Lots marked `rejected_at_dock` stay out of inventory
  (status `rejected`) and are logged with their reason.
- Derived manifest status:
  - **accepted** — all lots accepted,
  - **rejected** — all lots rejected,
  - **partially_accepted** — a mix (≥1 accepted **and** ≥1 rejected).
- Surface a **"Partially Accepted"** badge (and a rejected-count) on the intake
  list + detail.
- Reasons offered (owner's examples + common ones): *vendor forgot to send it /
  short shipment*, *broke/damaged in transit*, *wrong product*, *failed COA /
  quality*, *expired / short-dated*, *overage not ordered*, *other (free text)*.
- Guard-rail help inline: "Refused product stays on the truck — it never enters
  your inventory, so **you file nothing with CCRS**. Ask the **vendor** to submit a
  CCRS manifest **Update** (to fix the quantity) or **Delete** (to remove the line)
  so their record matches what physically stayed. Do **not** create a return
  manifest for driver-present refusals; contingency manifests are discontinued."

### (Reference only) When a Return Manifest *would* apply
Kept for completeness: a Return Manifest is only needed if product was **already
accepted into our inventory** and later shipped back — a separate, rare path we are
**not** building now per the owner ("we have never had to re manifest the products
back"). If it ever comes up, it is a normal **outbound** manifest with Greenway as
origin and the vendor as destination, reusing our outbound manifest generator.

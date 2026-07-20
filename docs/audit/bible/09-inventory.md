# Bible Chapter 09 — Inventory (Lots, Intake, Decrement, Counts, Dispositions)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** every unit of cannabis in the
> store lives in exactly one **lot** row. A lot arrives on a vendor manifest in
> quarantine, cannot go on sale until a hard compliance gate says it's clean,
> loses stock automatically when sales complete (oldest lot first), and every
> quantity change that ISN'T a sale is written to one signed adjustments
> ledger. Nothing enters or leaves inventory silently.

---

## 1. The big idea in one paragraph

Three tables from migration `0023_pos_inventory_lots.sql` form the backbone:
`inbound_manifests` (a vendor delivery), `inventory_lots` (a traceable batch of
product with `received_qty`, `on_hand_qty`, and a lifecycle `status`), and
`inventory_adjustments` (the signed ledger of every non-sale quantity change —
this ledger is what feeds the CCRS InventoryAdjustment file). A lot's status
walks a one-way-ish road: `quarantine` (just arrived, held) → `active`
(sellable) → `sold_out` / `recalled` / `destroyed` / `rejected`. Two separate
layers of "how many do we have" are kept in sync: the **published menu**
(`menu_variants.inventory_level`, what customers and the register see — Chapter
07) and the **lots** (`inventory_lots.on_hand_qty`, what compliance, purchasing
and COGS see). Sales decrement BOTH layers through one funnel; everything else
(returns, destruction, counts, shrink) goes through the adjustments ledger.

---

## 2. The lot — the atom of inventory

**Files:** `src/lib/inventory/types.ts` (row shapes), `src/lib/inventory/store.ts`.

- `InventoryLot` (`types.ts:104`): identity (`lot_code`, `pos_product_key`,
  `ccrs_inventory_external_id` via the manifest intake), provenance
  (`vendor_id`, `brand_id`, `manifest_id`, `lab_result_id`), quantities
  (`received_qty`, `on_hand_qty` — integer units), money (`unit_cost_minor_units`
  — cents, per the money-in-cents rule), flags (`is_sample`, `is_medical`),
  `expires_on`, and `status` (comment at `:125`: active | quarantine | recalled
  | sold_out | destroyed).
- `LabResult` (`types.ts:73`) carries the COA: potency, pass/fail (`passed`),
  the vendor's `coa_url` AND our own archived copy (`coa_storage_path` in the
  private `coa` bucket — vendor links expire; ours don't).
- `InventoryAdjustment` (`types.ts:131`): `lot_id`, signed `qty_delta`,
  `reason`, `note`, `actor_id`. One ledger, always signed, always attributed.
- Reads: `listLots` (`store.ts:40`, search + status filter, hydrated with
  vendor/brand/lab names via `hydrateLots` `:71`), `getLotById` (`:217`),
  `listLotAdjustments` (`:226`), `computeInventoryStats` (`:138` — counts by
  status plus compliance-gap columns: `missingCoa`, `missingProductLink`,
  `expired`/`expiringSoon` within `EXPIRING_SOON_DAYS = 30` `:20`, and
  `onHandCostMinor` = Σ on-hand × unit cost in cents).
- Manual writes: `createAdjustment` (`:253`) inserts the ledger row FIRST, then
  bumps `on_hand_qty`; `updateLotStatus` (`:290`) flips lifecycle status. Both
  are wrapped by admin actions in `src/app/admin/inventory/actions.ts` that
  require the `inventory.manage` permission (`:31`, `:58`) and validate reason
  (`VALID_REASONS` `:8` — receive, shrink, damage, sample, employee_sample
  [Task K, WAC 314-55-096 → CCRS "Other" with employee named], destruction,
  count, recall, other) and status (`VALID_STATUSES` `:22`) against allow-lists.
- **Note the deliberate vocabulary rule:** sales are NOT in the adjustment
  reasons. The ledger is "every change to on-hand that ISN'T a sale" — a
  completed order's own lines are the sale audit trail (see §4).

---

## 3. Intake — from the truck to the shelf, with a hard gate

**Files:** `src/lib/inventory/intake-store.ts` (1,603 lines),
`src/lib/inventory/lot-activation-gate-core.ts` (pure),
`src/lib/inventory/manifest-dedupe-core.ts` (pure). Admin actions in
`src/app/admin/inventory/intake/actions.ts` all require `inventory.manage`.

### 3a. Staging (`stageManifest`, `intake-store.ts:245`)

The standing rule is stated in the file header (`:4–13`): **machine output is
never auto-live.** A parsed manifest (WCIA JSON, CCRS CSV, or PDF) becomes:
- one `inbound_manifests` row with `status = 'pending'` (`:304–319`),
- one `lab_results` row per line that has a COA, de-duplicated within the
  manifest by the lab's external id (`labIdCache`, `:331–334`),
- one `inventory_lots` row per line with **`status = 'quarantine'`** (`:408` —
  "held until the manifest is accepted") and its canonical
  `ccrs_inventory_external_id` derived once (`:390–394`) and reused across
  every CCRS file forever after.

Two protections fire before anything is written:
- **Duplicate-manifest dedupe** (H16b-7, `:266–298`): identity = normalized
  manifest number + vendor (`buildManifestIdentity`,
  `manifest-dedupe-core.ts:47`); a LIVE row (pending/in_transit/accepted) with
  the same identity blocks re-staging (`findBlockingDuplicate` `:83`), but a
  previously REJECTED one does not (a corrected re-send is allowed), and a
  manifest with no number is never deduped (never silently drop a real
  transfer). This exists because of the owner's own words, quoted in the code:
  "if for what ever reason the vendor sends us the email twice… I dont want to
  accidentally accept the manifest twice."
- **Vendor resolution** (`resolveOrCreateVendor` `:120`): license → name →
  alias → normalized-name ladder, auto-creating a draft vendor as last resort.

### 3b. The activation gate (Slice 107 — the compliance heart)

`src/lib/inventory/lot-activation-gate-core.ts` is a PURE gate with one job:
a lot may become `active` (sellable) ONLY if it has **all three** of a CCRS
inventory identifier, a linked lab result/COA, and a NOT-failed lab result
(`evaluateLotActivation` `:76`; reason codes `missing_ccrs_id` /
`missing_lab_result` / `failed_lab_result` `:38–41`; batch form
`evaluateLotBatchActivation` `:116`; self-tests `:131`). The file header cites
the legal grounding: WAC 314-55-102 / WAC 246-70-050 (testing standards before
retail sale), the CCRS Upload User Guide (identifier reuse), WAC 314-55-083(4)
(complete traceability).

Historically important: the comment at `intake-store.ts:417–421` records that
the legacy `acceptManifest()` helper was **deleted** (S-11 / gap M-8) because
it activated every quarantined lot with NO gate. The only activation path is
`finalizeManifestDispositions`.

### 3c. Finalize (`finalizeManifestDispositions`, `intake-store.ts:750`)

The reviewer marks each lot accepted or refused (`setLotDisposition` `:492` —
decision only, no side effects), then finalize runs the whole ceremony:

1. **Accept-time vendor repair** (H17, `:771–806`): manifests staged before the
   resolver upgrade get their vendor linked now — best-effort, never blocks.
2. **Sample-cap hard block** (H16b Slice B, `:809–831` calling
   `preflightManifestSampleCap` `:549`): WAC 314-55-096(1)(f)(ii) caps a
   processor at 120 sample units per quarter to one retailer. If accepting
   would breach the cap, the ENTIRE finalize is refused before anything
   activates — mirroring exactly what the ledger seeder would record, so
   pre-flight and ledger can never disagree. Warn-only mode never blocks;
   re-finalizing an already-accepted manifest never falsely blocks
   (already-seeded lots aren't re-counted).
3. **Per-lot gate + flip** (`:856–928`): every ACCEPTED lot is judged by the
   pure gate. **Dirty lots are HELD in quarantine** with a visible "cannot go
   live" note (`:886–900`) — the accept intent is recorded but status never
   changes. Clean quarantined lots flip to `active` AND get a `receive`
   adjustment for `received_qty` (`:904–916`) — the ledger's opening entry.
   Refused lots become `rejected` (`:920–927`) — never destroyed, because
   refused product stays on the vendor's truck (see 3d).
4. **Honest derived status** (`:931–945`): accepted+refused (or accepted+held)
   → `partially_accepted`; all-held → `partially_accepted` (never falsely
   stamped rejected); plus a timeline event narrating exactly what happened.
5. **Best-effort follow-ons, each isolated in its own try/catch** (`:974–1071`):
   catalog draft seeding with VERIFIED write counts (Task AK — failures are
   surfaced on the manifest timeline, not silently counted as successes),
   COA archiving, KB promotion (H11a), remembering the vendor's usual
   transport (H15e), seeding incoming sample-ledger events (H16b Slice A,
   idempotent by lot_id), PO auto-receive (W6 — only THIS run's newly
   activated lot ids, so re-finalizes never double-receive against the
   purchase order), and the intake menu auto-carry from Chapter 07.

### 3d. Reject-at-dock (`rejectManifest`, `intake-store.ts:432`)

Research-grounded (docs/ccrs-rejection-and-returns.md): refused product never
entered our inventory, so lots become `rejected` with a mandatory reason —
NOT destroyed — and **nothing is filed with CCRS**; the vendor corrects their
own manifest. Already-active/sold lots are never clawed back (`:451`).

---

## 4. Sale decrement — the one funnel that reduces stock (B19/B20)

**Files:** `src/lib/inventory/sale-decrement-core.ts` (pure, 499 lines,
self-tests `:309`), `src/lib/inventory/sale-decrement.ts` (server wrapper).

- **Where it fires:** `setOrderStatus` in `src/lib/orders/orders-store.ts:370–377`
  — on the `completed` transition only, EVERY completion path (POS sync,
  back-office, future) funnels through `decrementInventoryForOrder`.
- **Two design rules** (wrapper header `:10–25`):
  1. **Idempotent per order** — an `inventory_decremented` order_event is the
     latch (`sale-decrement.ts:53–60`); a re-complete never double-decrements.
  2. **Never blocks completion** — the sale legally happened at the counter; a
     stock-write failure leaves a visible failure note on the order's event
     feed (`:197–210`) instead of stranding the order.
- **Layer 1 — published menu** (`buildVariantDecrementPlan`, core `:150`):
  matches each sold line to a variant defensively (exact variantId → sole
  variant → the trailing "(3.5g)" label the register bakes into the name —
  header `:25–33`), accumulates multiple lines against one variant correctly,
  clamps at zero and reports every **OVERSOLD** clamp (`:200–206`), and
  recomputes item status using the IDENTICAL thresholds as the import pipeline
  (`statusForLevelTotal` `:129` = `transform.ts:580` statusForInventory:
  ≤0 unavailable, ≤3 low-stock) — but ONLY for items that tracked stock before
  the sale (`preTotal <= 0` guard `:224` — never hide a live untracked product).
- **Layer 2 — lots FIFO** (`buildLotDecrementPlan`, core `:237`): demand is
  aggregated per lot key (the variant's own encoded lot key first, else the
  product_id snapshot — Mastering Slice 1, `lotKeyForSaleLine`), then consumed
  oldest-active-lot-first; a drained lot flips to `sold_out`
  (`sale-decrement.ts:167–172`); any un-servable remainder is reported as a
  **LOT SHORTFALL**. The FIRST (oldest) consumed lot's CCRS id stamps the sale
  lines (B20, core `:268–272`; wrapper `:175–188` — fills blanks only, never
  overwrites an explicit per-line id) so the weekly CCRS Sale file carries the
  exact lot that was actually consumed.
- Custom keypad lines (`pos-custom-*` keys, B39) are filtered out up front
  (`sale-decrement.ts:74–78`) — they track no stock by design.
- **Everything is narrated:** `summarizeDecrement` (core `:288`) writes the
  human trail (counts + OVERSOLD/UNMATCHED/SHORTFALL) into the marker event.
- **The mirror image:** voiding a sale restocks both layers through
  `restockInventoryForVoid` (`src/lib/pos/void-store.ts:188`) with its own
  idempotency marker (`:193–200`) — covered in Chapter 05.

---

## 5. Cycle counts — blind counts that correct the books

**File:** `src/lib/inventory/cycle-counts.ts` (Run 6 / Slice 30).

- `createCycleCount` (`:316`) snapshots `system_qty` per active lot (or a
  chosen subset) into `cycle_count_lines`. The employee then enters a **blind**
  physical count (`recordLineCount` `:367`) — they see the shelf, not the
  system number — and the variance is computed per line.
- `applyCycleCount` (`:423`) posts each non-zero variance as a signed
  `inventory_adjustments` row with reason `count` (`:463–470`) and bumps
  `on_hand_qty` (`:471–477`); zero-variance counted lines are just finalized
  (`:449–453`); uncounted lines are skipped (`:447`). Per-line `applied` flags
  make a re-apply resume-safe. Cancelled sessions can't be applied (`:434–436`);
  applied sessions can't be cancelled (`:500–502`).
- This is also the designated cleanup tool for the decrement's OVERSOLD and
  SHORTFALL notes (§4) — the notes literally say "cycle count to reconcile."

---

## 6. Dispositions — returns, vendor returns, destruction

**Files:** `src/lib/inventory/disposition-core.ts` (pure, self-tested),
`src/lib/inventory/disposition.ts` (1,118 lines, Task Q). Customer returns are
traced end-to-end in **Chapter 05** (§ returns); here is the inventory view:

- Every quantity change posts a signed `inventory_adjustments` row — the file
  header (`disposition.ts:4–8`) names this "the single auditable ledger that
  feeds the CCRS InventoryAdjustment.csv"; business detail lives in
  `customer_returns` / `vendor_returns` / `destruction_events`.
- **Destruction hold:** `scheduleDestruction` (`:862`) moves the lot to
  `quarantine` for shop-floor signalling, stamps `quarantine_start` and
  `earliest_destroy_at` = start + hold hours (`computeEarliestDestroyAt`,
  core `:42`; owner-tunable via `clampHoldHours` core `:35`, default
  `HOLD_HOURS_DEFAULT = 72`, max 336 = 14 days). The old mandatory 72-hour
  WSLCB notice was REMOVED from current rule (WSR 22-14-111) — the hold is now
  store POLICY, documented at `disposition.ts:42–46`.
- `completeDestruction` (`:922`) enforces the Task Q guardrails
  (`validateDestructionCompletion`, core `:205` — rendering method,
  witness/attestation discipline) and posts the reducing `destruction`
  adjustment. `cancelDestruction` (`:1023`) backs out of a scheduled one.
- Vendor returns (`createVendorReturn` `:732`) and the CCRS correction queue
  (`markCorrectionsExported` `:700`) round out the module. Missing migration
  `0115` is detected gracefully (`isMissingSchemaError` `:50`).

---

## 7. Product onboarding — drafts, price floor, approval = go-live

**Files:** `src/lib/inventory/catalog-drafts.ts`, `src/lib/inventory/pricing.ts`.

- When an accepted lot doesn't match a published-menu product,
  `seedDraftsForManifest` (`catalog-drafts.ts:99`) creates a DRAFT catalog
  product from the transfer + COA facts. Standing rule restated in the header
  (`:4–7`): machine output is never auto-live; a human approves.
- **The price floor** (`pricing.ts`): price can NEVER be below
  `min_markup_multiple` × cost (default 2×), rounded UP to the rounding step
  (`priceFloorMinor` `:48`, `roundUpTo` `:33` — "so we never dip below floor").
  `suggestPrice` (`:81`) starts at the floor and nudges by sales velocity —
  transparent, never below floor. `validatePrice` (`:132`) is the enforcement.
- `approveDraftWithPrice` (`catalog-drafts.ts:356`) validates against the floor
  (`:372–376`), marks the draft approved, then triggers the intake auto-carry
  from Chapter 07 (`:384–400`): **pressing "Approve" IS the go-live decision**
  — the product reaches the website and register with no further clicks;
  best-effort with the staged version as manual fallback on a publish hiccup.

---

## 8. Purchasing tie-in (W5/W6)

Migration `0102_manifest_po_link.sql` links a manifest to a purchase order.
`autoReceiveManifestPo` (`src/lib/inventory/po-receive-store.ts:53`) is called
from finalize (§3c step 5) with ONLY the lot ids that activated in this run —
so the PO's received quantities stay idempotent across re-finalizes, and the
manifest timeline gets an ordered-vs-delivered note. Pre-0102 it's a no-op;
failures never break intake. (The PO builder, vendor-platform integrations and
market-context pricing in `src/lib/integrations/` are catalog/purchasing
tooling that never touches lot quantities — out of scope for this chapter's
money-and-compliance trace.)

---

## 9. Findings that live in this chapter

No new findings. Two deliberate postures worth restating for future auditors
(both verified, both intentional):

1. **Sale decrement is best-effort by design.** A stock write failure leaves a
   visible note and the order completes anyway (`sale-decrement.ts:197–210`).
   This is the correct direction: the register already took the money and the
   product already left the store — blocking completion would corrupt the
   ledger that matters most. The cost is that on-hand can drift until a human
   acts on the note; cycle counts are the designed reconciliation.
2. **Manual lot-status flips are permission-gated but not gate-checked.**
   `setLotStatusAction` (`admin/inventory/actions.ts:58`) lets an
   `inventory.manage` holder set any allow-listed status, including `active` —
   bypassing the Slice 107 activation gate that finalize enforces. This is the
   deliberate manual-override escape hatch (same philosophy as the POS
   override with audit). It is worth a 🔵 hardening thought for a future
   focused pass (e.g. warn when manually activating a lot that would fail the
   gate), but the surface requires an authorized manager and every flip stamps
   `updated_by` — recorded here rather than as a formal finding.

---

## 10. What SHOULD never happen (watchlist)

1. **A lot going active without the gate.** The ONLY code path from
   quarantine to active is `finalizeManifestDispositions` running
   `evaluateLotBatchActivation`; the legacy ungated helper was deleted
   (comment at `intake-store.ts:417`). (Manual status flips are the audited
   exception — §9.2.)
2. **A failed-COA lot on the sales floor.** `failed_lab_result` blocks
   activation (`lot-activation-gate-core.ts:38`); if a failed lot is active,
   someone bypassed the gate.
3. **The same manifest accepted twice.** Live-identity dedupe at staging
   (`intake-store.ts:266–298`) plus idempotent finalize (only
   quarantine/pending lots flip; only THIS run's ids auto-receive the PO).
4. **A sale writing to `inventory_adjustments`.** The reason vocabulary
   deliberately excludes sales; a `sale`-flavored adjustment row means someone
   broke the two-ledger design.
5. **A double decrement.** The `inventory_decremented` order_event is the
   latch; two such events for one order is a broken invariant.
6. **A negative stored level.** Both layers clamp at zero (variant plan
   `:206`; lot plan takes `min(onHand, remaining)`); a negative
   `inventory_level` or `on_hand_qty` was written by something else.
7. **An unexplained quantity change.** Every non-sale change must have a
   ledger row with reason + actor; on-hand differing from
   (received + Σ adjustments − sales) means an out-of-band write.
8. **A sample cap breach.** Finalize hard-blocks BEFORE activation
   (`intake-store.ts:810–831`); an over-cap quarter in the sample ledger means
   the pre-flight was bypassed or settings disabled enforcement.
9. **Refused product filed with CCRS.** Reject-at-dock files nothing; the
   vendor corrects their own manifest. A CCRS row for a rejected lot is wrong.
10. **A price below the floor.** `validatePrice` enforces ≥ 2× cost (owner
    setting); an approved draft priced below floor bypassed validation.
11. **A destruction completed before its hold.** `earliest_destroy_at` must
    have passed and the completion guardrails satisfied.
12. **CCRS id drift.** The id assigned at staging (`deriveInventoryExternalId`)
    must be the same one stamped on sale lines (B20) and used in every CCRS
    file — one identifier per lot, forever.
13. **A cycle count applied twice.** Per-line `applied` flags plus the session
    status make apply resume-safe, never repeatable.
14. **Draft counts lying.** Draft seeding reports VERIFIED writes (Task AK);
    "drafts created" with silent insert failures is the exact bug that was
    fixed — watch for regressions.

---

*Chapter status: DRAFTED at main `9f472a17`. No new findings — two deliberate
postures documented in §9 for future auditors.*

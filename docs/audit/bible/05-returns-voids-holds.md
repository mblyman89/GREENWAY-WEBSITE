# Chapter 05 — Undoing and Pausing Sales (returns, voids, holds, recall holds, pickups)

> **Status:** COMPLETE (traced line-by-line against main @ `9a63c8b1`)
> **Primary files:**
> `src/lib/pos/returns-core.ts` (B15 — pure return policy: receipt contract, 15-day Pacific window, refund math, points clawback)
> `src/lib/pos/returns-store.ts` (B16 — receipt lookup, server-side re-check, end-to-end return processing)
> `src/lib/inventory/disposition-core.ts` + `src/lib/inventory/disposition.ts` (Task Q — WAC 314-55-079(12) attestations, add-back, CCRS correction queue, destroy path)
> `src/app/api/pos/returns/route.ts` (AM-C — counter returns from the iPad, manager-PIN gated)
> `src/lib/pos/void-sale-core.ts` + `src/lib/pos/void-store.ts` + `src/app/api/pos/void/route.ts` (B27 — same-day whole-sale void)
> `src/lib/pos/register-polish-core.ts` (B17 — hold/resume a cart) and `src/lib/pos/active-sale-resume-core.ts` (parked active sale)
> `src/lib/pos/recall-hold-core.ts` + `src/lib/pos/recall-hold-store.ts` (AN-7 — recall hold hard gate)
> `src/lib/pos/pickup-core.ts` + `src/lib/pos/pickup-store.ts` + `src/app/api/pos/pickup/route.ts` (B28/AM-D — website pickup queue at the register)

A sale is not always the end of the story. This chapter covers every way a sale
(or a cart on its way to becoming a sale) gets **undone, paused, or blocked**:

1. **Returns** — the customer brings product back days later (up to 15 days, store policy).
2. **Voids** — a same-day "that ring-up was wrong" full reversal at the register.
3. **Holds** — the customer forgot their wallet; park the cart and resume it.
4. **Recall holds** — the LCB or a producer recalls a lot; the product must stop selling instantly.
5. **Pickups** — a website order is handed over at the register (a "completion," but with its own ID-at-handover gate; it also becomes returnable/voidable like any register sale).

Every one of these paths runs through the same discipline established in
chapters 01–04: pure policy cores with embedded self-tests, server-authoritative
re-checks (the UI's opinion is advisory only), idempotency markers so retries
never double-move inventory or money, and loud visible failure notes instead of
silent rollbacks.

---

## 1. Returns — store policy is deliberately STRICTER than the law

WAC 314-55-079(12) allows a retailer to accept returns when the product is in
its **original packaging** and the **lot/batch ID is fully legible**. Greenway
adds three store-policy gates on top (owner decision, Task AD), all encoded in
`src/lib/pos/returns-core.ts`:

- **Original receipt required.** The paper receipt's printed number is the last
  8 hex characters of the sale's durable `client_uuid`, uppercase
  (`normalizeReceiptNumber`, returns-core.ts:62). Sloppy input is tolerated —
  spaces, dashes, lowercase are stripped — but anything that doesn't reduce to
  exactly 8 hex characters is rejected, never guessed at (the self-test at
  returns-core.ts:245+ even proves that pasting the word "Receipt" — which
  contains hex letters — safely rejects rather than mis-reads).
- **Loyalty member required.** Only sales with a loyalty member attached at the
  register (orders.customer_id) are returnable
  (`evaluateReturnEligibility`, returns-core.ts:160).
- **15-day window**, counted in **Pacific calendar days** with the purchase day
  as day 0 (`RETURN_WINDOW_DAYS = 15`, returns-core.ts:49;
  `pacificDaysBetween`, returns-core.ts:98). The day math uses
  `pacificDayKey` (the reports timezone helper), so it is DST-safe — the
  embedded self-tests prove the November fall-back day doesn't shift the count,
  and that a sale at 11:30 PM Pacific is "1 day ago" 90 minutes later. This is
  the CORRECT day convention (contrast GW-009, where the medical ledger uses
  UTC days).

`evaluateReturnEligibility` (returns-core.ts:160) evaluates ALL the sale-level
gates together and reports **every failure at once** — staff see the complete
picture ("not completed" + "no member" + "outside window"), not a
whack-a-mole of one error at a time. The per-line WAC attestations
(packaging, legibility) are enforced later by Task Q (§2).

**Refund math** (`refundForLine`, returns-core.ts:204): refund = stored
tax-inclusive unit price (`order_lines.price_minor_units` — the exact cents the
customer paid per unit, medical repricing already baked in) × returned
quantity. Never a manual entry, never an estimate. A `remainingReturnable`
guard (sold − already returned) makes double-returns impossible per line.

**Loyalty clawback** (`pointsClawback`, returns-core.ts:256): proportional to
the refunded share of the order total, floored (customer-favorable rounding),
clamped to [0, earned]. A full-order refund claws back every earned point; an
order that earned nothing claws nothing.

### 1.1 The server flow (returns-store.ts)

`lookupSaleByReceipt` (returns-store.ts:99) is the receipt-first entry point:

- Scans `pos_sale_events` for processed sales in the last **17 days**
  (`LOOKUP_WINDOW_DAYS = RETURN_WINDOW_DAYS + 2`, returns-store.ts:53 — the +2
  is a clock-skew buffer; the real window verdict is still the strict pure
  check), newest first, up to `LOOKUP_SCAN_LIMIT = 5000` rows
  (returns-store.ts:54). The suffix match happens **in memory**
  (`clientUuidMatchesReceipt`) because PostgREST can't LIKE-match into a uuid
  column.
- Loads the order, re-runs `evaluateReturnEligibility` server-side, builds a
  privacy-lean member label (first name + last initial,
  returns-store.ts:88), and returns each line with its
  `remainingReturnable` quantity (prior `customer_returns` rows summed per
  line, returns-store.ts:178–197).

`processCounterReturn` (returns-store.ts:252) is the end-to-end processor:

1. **Re-verifies everything server-side** by calling `lookupSaleByReceipt`
   again — the UI verdict is advisory only (returns-store.ts:260).
2. Computes the exact refund with `refundForLine` (returns-store.ts:268).
3. Hands off to **Task Q's `createCustomerReturn`** (§2) for the compliant
   pipeline (returns-store.ts:276).
4. Claws back loyalty points **cumulative-safely** (returns-store.ts:299–334):
   it sums prior negative `adjust` rows for the order and never claws more
   than `earned − alreadyClawed`, so repeated partial returns can never
   over-claw.
5. Builds a printable refund receipt (`buildRefundReceiptHtml`,
   returns-store.ts:338) in the same 576px PassPRNT family as the sale receipt,
   honoring the owner's B13 receipt customization.

Failures after step 3 are **visible, not rolled back**: if the clawback or
receipt fails, the return itself stands and the result reports what happened —
matching the discipline stated in the void store's header.

### 1.2 The counter-return API (AM-C)

`src/app/api/pos/returns/route.ts` brings the SAME machinery to the iPad —
nothing re-implemented. Two-man rule in one request: the authenticated
**device** (scrypt device key, `authenticateDevice`) submits the receipt +
line + reason, and a **manager/lead PIN** (`APPROVER_ROLES` = manager, lead;
route.ts:49) authorizes processing, behind the shared PIN throttle
(`pinPadBlocked`/`noteFailure`, route.ts:40). Lookup-only mode (`{ receipt }`)
needs no PIN. **Online-only by design** — a return reverses durable server
facts (inventory, loyalty, CCRS queue); there is nothing sensible to queue
offline, and the register hides the action while offline.

---

## 2. Task Q — the compliant return pipeline (WAC 314-55-079(12) + CCRS)

`validateCustomerReturn` (src/lib/inventory/disposition-core.ts:92) enforces
the hard rules on every return, in refuse-first order:

- **No original packaging → refuse** (the error text cites WAC 314-55-079(12)).
- **Lot/batch ID not fully legible → refuse** (same citation).
- Quantity must be > 0 and ≤ the remaining returnable quantity.
- Refund must be a non-negative **integer number of cents**.
- Disposition must be `restock` or `destroy`; reason must be one of
  `CUSTOMER_RETURN_REASONS` (disposition-core.ts:57 — wrong_item,
  defective, adverse_reaction, quality, mislabeled, other).

It also decides the **CCRS Sale correction operation**: returning the full
original quantity ⇒ `Delete` (the sale row disappears from CCRS), partial ⇒
`Update`. Note the subtlety in the store layer: `createCustomerReturn`
(src/lib/inventory/disposition.ts:443) validates against the REMAINING
returnable quantity but decides Delete-vs-Update against the **full original
line quantity including prior partials** (disposition.ts:529) — so two partial
returns that together cover the whole line correctly produce a Delete.

`createCustomerReturn` end-to-end (disposition.ts:443):

1. Loads order + line; only **completed** sales are returnable.
2. Sums prior `customer_returns` rows for the line (double-return guard,
   disposition.ts:503–516).
3. Runs the pure validation above.
4. Resolves the **inventory lot**: an explicit staff pick wins; otherwise the
   newest non-quarantine lot matching the line's lot key
   (`lotKeyForSaleLine` — variant-encoded lot key wins over the card's
   product_id, Mastering Slice 1; disposition.ts:498). No lot ⇒ refuse with
   "pick the lot manually" so the add-back always lands on the correct CCRS
   inventory identifier.
5. Snapshots the **CCRS Sale-row data** for the correction file: external IDs
   (`resolveSaleInventoryExternalId`), medical/exempt status read from
   `medical_exempt_sales` mirroring the Sale.csv builder, sales-tax and excise
   cents recomputed with the same `applyBps` math, and `sale_date` stamped
   with `pacificDayKey` (disposition.ts:622 — Pacific, the correct
   convention).
6. Posts the **POSITIVE add-back adjustment** (internal reason `return` →
   CCRS "Other" with a mandatory direction-stating detail,
   `buildCustomerReturnAdjustmentNote`, disposition-core.ts:136 — CCRS
   quantities are never negative, so the note must say "ADD ... back").
7. If disposition = **destroy**, opens a destruction event for JUST the
   returned quantity (`quarantineLot: false` — the rest of the lot stays
   sellable; disposition.ts:637–650). The destruction machinery (WAC
   314-55-097 rendering methods, LCB coordination) enforces the waste record
   at completion — covered in the inventory chapter.
8. Inserts the `customer_returns` row with `correction_status: "pending"` —
   the CCRS correction export (ch.11) reads this queue. If the table is
   missing (migration 0115 not applied) the error says so explicitly AND warns
   that the add-back was already posted and must be reversed manually if
   aborting (disposition.ts:688–693). **Owner note:** this is one of the
   sequential-visible-failure points — the pipeline does not pretend to be a
   transaction.

`markCorrectionsExported` (disposition.ts:700) flips returns to `exported`
after the correction CSV is downloaded.

---

## 3. Voids — "that sale never happened," same day only

A VOID is **not** a return. `src/lib/pos/void-sale-core.ts` (B27) draws the
line explicitly:

| | Void (B27) | Return (B15/B16 + Task Q) |
| --- | --- | --- |
| When | Same Pacific business day only | Up to 15 Pacific days |
| Scope | The WHOLE sale, all lines | Per line, partial quantities allowed |
| CCRS | No correction needed — Sale.csv exports completed orders only, and the void reverses the order the same day, before any export period closes | Correction queued (Delete/Update) |
| Approval | Manager/lead PIN | Manager/lead PIN (at the counter) |
| Product | Assumed unopened, straight back to shelf (both inventory layers) | restock OR destroy per WAC attestations |

`evaluateVoidEligibility` (void-sale-core.ts:78) reports all gates together:

- Not already voided (the `VOID_MARKER` latch, §3.1).
- Order status must be `completed`.
- **No prior partial returns** (`priorReturnQuantity > 0` ⇒ refuse — voiding
  after a partial return would refund the same items twice; the message
  routes staff to the returns desk).
- Completed **today on the Pacific wall clock** (`pacificDay`,
  void-sale-core.ts:38 — the self-test proves a 23:59-Pacific sale is NOT
  voidable at 00:01 Pacific even though the UTC date matches).

`validateVoidRequest` (void-sale-core.ts:110): reason 3–500 chars
(`VOID_REASON_MIN`/`MAX`, void-sale-core.ts:47–48; presets at :51), manager
approval id required. `voidRefundMinor` (void-sale-core.ts:129) is a pure echo
of `orders.total_minor_units` with integer guards — the cash handed back is
exactly what was paid, never typed in. `buildVoidSlipHtml`
(void-sale-core.ts:166) produces the paper void slip (576px, HTML-escaped,
both names + reason + Pacific timestamp) that goes in the till with the cash.

### 3.1 The void store (void-store.ts) — sequential, visible failure points

`lookupVoidableSale` (void-store.ts:82) scans **today's** processed sales only
(`occurred_at >= pacificWallTimeToUtcISO(pacificToday(), "start")`, limit 500),
matches the receipt suffix in memory, then loads order + lines + prior
returns + the void marker in parallel and runs `evaluateVoidEligibility`
server-side.

`processVoidSale` (void-store.ts:298) runs the steps **in order, never
silently rolling back**:

1. **Lifecycle**: `completed → ready` via `setOrderStatus` with a
   **reasoned reversal** (`reversalReason: "VOID: <reason>"` — the S-15
   lifecycle gate in `src/lib/orders/orders-store.ts:279` refuses to rewind a
   closed sale without one; the timeline note is stamped
   `REVERSAL (completed → ready): ...`, orders-store.ts:341), then
   `ready → cancelled`. The order is **never deleted** — the full timeline
   survives. If the second step fails, the error tells staff exactly how to
   finish from the back office (void-store.ts:327–331).
2. **Inventory restock** (`restockInventoryForVoid`, void-store.ts:188), the
   exact reverse of the B19 completion decrement, on BOTH layers:
   published `menu_variants` levels (+ recomputed item status) and
   `inventory_lots` on-hand (newest non-quarantine lot per key, variant-first
   `lotKeyForSaleLine`; a `sold_out` lot flips back to `active`). Idempotent
   via the `RESTOCK_MARKER` order_event (void-store.ts:58) — a retry sees
   "already restocked" and does nothing. A missing lot produces a loud
   "restock it manually" note, and a thrown restock error is captured into an
   order_event note ("run a cycle count") instead of failing the void.
3. **Loyalty**: claws back the FULL earn, cumulative-safe (same
   earned − alreadyClawed math as returns; void-store.ts:346–380).
4. **Medical ledger**: deletes the order's `medical_exempt_sales` rows —
   a voided sale never happened, so the 5-year excise-exemption ledger must
   not contain it (void-store.ts:383; cross-referenced in ch.03 §8).
5. **Latch + audit + slip**: writes the `VOID_MARKER` order_event (the
   double-void latch the eligibility check reads), records the
   `register.sale_voided` audit row with receipt/reason/approver/refund/claw/
   restock summary (void-store.ts:401), and returns the printable slip.

The void API (`src/app/api/pos/void/route.ts`) mirrors the returns route:
device auth + manager/lead PIN (`APPROVER_ROLES`, route.ts:34) + shared
throttle; online-only.

---

## 4. Holds — pausing a cart, never pausing compliance

Two related mechanisms park in-progress work on the device; both store
**deliberately minimal state** so a resumed cart can never resurrect stale
prices or someone else's age check:

- **Held sale (B17)** — "forgot my wallet." `holdFromCart`
  (src/lib/pos/register-polish-core.ts:132) snapshots ONLY variant ids +
  counts under localStorage key `gw-pos-held-sale` (`HELD_SALE_KEY`,
  register-polish-core.ts:33). **Prices are NEVER stored**; `rebuildHeldCart`
  (register-polish-core.ts:155) rebuilds against the CURRENT menu bundle —
  fresh prices and promotions, with vanished or out-of-stock variants dropped
  and reported, and quantities re-clamped to `MAX_LINE_QUANTITY`. A held cart
  never inherits the previous customer's age verification (the module header
  states this as the design rule). `parseHeldSale`
  (register-polish-core.ts:110) returns null on ANY corruption.
- **Parked active sale** — the lock screen interrupted a sale.
  `ACTIVE_SALE_KEY` = `gw-pos-active-sale`
  (src/lib/pos/active-sale-resume-core.ts:41) with a **30-minute TTL**
  (`ACTIVE_SALE_TTL_MS`, active-sale-resume-core.ts:49): beyond it the
  snapshot is treated as abandoned and the **ID gate re-runs** — an ID
  verified long ago must not silently authorize a much-later sale. Same
  minimal-lines rule (variant id + count only, prices never stored).

Neither hold touches the server; nothing about a hold is a compliance event.

---

## 5. Recall holds (AN-7) — the product must stop selling NOW

When a lot's `inventory_lots.status` is set to **`recalled`** (and ONLY that
status — `HOLD_LOT_STATUS`, src/lib/pos/recall-hold-core.ts:44), its entire
product key is held from sale. Routine `quarantine` lots (intake holds, the
72-hour destruction segregation) deliberately do NOT trip this — quarantine is
a normal operational state, recall is not.

- `buildRecallHoldIndex` (recall-hold-core.ts:54) builds the held-key set;
  a product with one recalled lot and one active lot is held **whole**
  (self-tested).
- `findHeldLines` (recall-hold-core.ts:86) matches an order's lines by
  product key OR by the variant's own encoded lot key
  (`lotKeyFromVariantId` — Mastering Slice 1: a recalled lot holds ITS size
  on a mastered card, while sibling sizes from safe lots stay sellable).
- `recallHoldRefusal` (recall-hold-core.ts:108) is the refusal text; it states
  plainly that **there is no override** — the hold clears only when a manager
  releases or destroys the recalled lot in Admin → Inventory.

**Asymmetric fail posture** (`recalledProductKeys`,
src/lib/pos/recall-hold-store.ts:29):

- The **menu bundle** (`/api/pos/menu` route.ts:80) calls it without
  `failClosed` — a read error collapses to an empty set, because the bundle's
  recall flag is advisory UI only.
- The **completion gate** (src/lib/orders/completion-gate.ts:102) calls
  `recalledProductKeys({ failClosed: true })` — a read error THROWS, and the
  gate's catch (completion-gate.ts:118) refuses the sale: *"Selling cannot
  proceed while recall status is unknown."* The recall check sits early in the
  gate, right after sales hours and BEFORE the money recompute
  (completion-gate.ts:94–118), so no recalled product can complete through ANY
  path — register sync, pickup handover, or back-office completion — because
  they all run the same gate.

---

## 6. Pickups (B28) — website orders handed over at the register

Website pickup orders surface **on the iPad** so the budtender never has to
touch the back office. The critical legal point, stated in the pure core's
header: **WAC 314-55-150 age verification happens at HANDOVER, not at
placement** — the flow refuses to complete without an explicit at-the-counter
ID attestation.

### 6.1 The queue and the completion policy (pure core)

- Register-materialized orders are excluded from the queue by the staff-note
  contract: sync-store writes every register sale's order with a staff_note
  starting exactly `"POS sale —"` (em-dash included;
  `POS_SALE_STAFF_NOTE_PREFIX`, src/lib/pos/pickup-core.ts:38 — the self-test
  proves an ASCII hyphen does NOT match).
- Queue order (`sortPickupQueue`, pickup-core.ts:90): **ready first** (the
  customer may already be standing there), then preparing → acknowledged →
  new, oldest first within each group. Labels are privacy-lean
  (first name + last initial, `customerPickupLabel`, pickup-core.ts:50).
- `evaluatePickupCompletion` (pickup-core.ts:154) reports every failing gate
  together: not a POS-materialized order, status in the ACTIVE set
  (new/acknowledged/preparing/ready — any active status may complete, "bag
  and hand over in one step"), **idConfirmed must be true** (the error cites
  WAC 314-55-150), integer total, and full cash tender via the same
  `computeCashChange` used by register sales. A fully discounted $0 order is
  completable.

### 6.2 The server flow (pickup-store.ts)

`completePickupAtRegister` (src/lib/pos/pickup-store.ts:154):

1. Belt-and-suspenders POS-exclusion: staff_note prefix AND a
   `pos_sale_events.order_id` link check (pickup-store.ts:163–171).
2. Pure verdict (ID attestation, tender, status).
3. The employee must be a real, **active** `employees` row
   (pickup-store.ts:183–188).
4. **The SAME completion gate every sale runs**, with `overridePermitted:
   false` — no override at handover (pickup-store.ts:191). Hours, recall
   holds, money recompute, loyalty code, medical card, high-THC, sales
   limits, exempt ledger: everything from ch.02 §7 and ch.03 §7 applies to a
   pickup exactly as to a register ring.
5. `setOrderStatus(completed)` — which fires the B19 inventory decrement and
   loyalty accrual exactly like every other completion path.
6. **Day-ledger row** (pickup-store.ts:208–241): one already-`processed`
   `pos_sale_events` row is inserted (fresh `client_uuid`, `sequence: 0` —
   server-materialized, outside any device's offline ordering) because the
   handover takes cash INTO THE DRAWER: the X/Z day report and
   expected-drawer math read this ledger, and the printed receipt number is
   the row's client_uuid suffix — so the **returns desk and same-day void
   find pickup sales exactly like register sales**. Replay never touches it
   (ingest only processes `pending` rows). Nothing double-counts: CCRS
   Sale.csv reads orders (one row), the day report reads pos_sale_events
   (one row), inventory decrements via the idempotent order_events marker,
   loyalty accrues once per order.
7. If the ledger insert fails, the sale is complete and legal — the failure
   is recorded as a LOUD order_event note ("The X/Z report undercounts this
   cash — reconcile manually", pickup-store.ts:242–254) instead of failing
   the customer's handover, and the audit row records `ledger: FAILED`.
8. `register.pickup_completed` audit + printable receipt (owner's B13 config;
   `medicalSale: false` — pickup orders carry no medical exemptions).

**Load-into-register (AM-D)** (`loadOrderIntoRegister`, pickup-store.ts:355):
"the customer is here and wants to add items." The website order is **NOT
superseded at load time** (owner decision, documented in the function header):
loading is not selling — cancelling on load would lose the order whenever the
register sale was abandoned. The order stays ACTIVE; the register carries
`sourceOrderId`, and the SYNC supersedes the website order exactly when the
register sale COMPLETES (ch.04 §7.1, AM-D2) — so the two can never both
fulfill, and an abandoned load leaves the order untouched in the queue. The
device rebuilds the lines against its CURRENT bundle (fresh prices; the
website order's prices are history, not a pricing source), and a linked
customer comes back shaped like a member-lookup hit for one-tap loyalty
attach.

The pickup API (`src/app/api/pos/pickup/route.ts`) is device-authenticated for
all modes (queue GET, load/detail/complete POST) and validates
`drawerSessionId` as a UUID — the cash must land in a named drawer session.

---

## 7. How the pieces fit — one sale's possible afterlives

```
completed sale (register ring OR pickup handover — both leave a
pos_sale_events row + an orders row)
│
├─ same Pacific day, nothing returned yet
│   └─ VOID (B27): manager PIN → completed→ready→cancelled (reasoned
│      reversal) → restock both layers → full points clawback → delete
│      medical_exempt_sales rows → VOID_MARKER latch → void slip.
│      No CCRS correction needed (same-day, pre-export).
│
├─ within 15 Pacific days, member attached, receipt in hand
│   └─ RETURN (B15/B16 → Task Q): per-line, partial OK → WAC 079(12)
│      attestations → positive add-back adjustment → CCRS Sale
│      correction queued (Delete if the whole line, else Update) →
│      proportional points clawback → restock or destroy → refund receipt.
│
└─ recall lands on one of its products (any time)
    └─ RECALL HOLD (AN-7): lot status → recalled; menu flags it
       (advisory), completion gate hard-blocks it (fail-closed, no
       override) — future sales stop; the existing sale is untouched.
```

A VOID after a partial RETURN is refused (double-refund guard); a second VOID
is refused (marker latch); a RETURN beyond the remaining quantity is refused
(per-line guard). Every reversal leaves the order row and its full timeline in
place — nothing in this chapter deletes an order.

---

## 8. What SHOULD never happen (the owner's watchlist)

1. **A refund for more than was paid.** Refunds echo stored cents
   (`refundForLine`, `voidRefundMinor`) — if a refund amount ever needs manual
   typing, something is broken.
2. **A return without the paper receipt** accepted at the counter, or a
   receipt number that "almost matches" being accepted (8 hex chars exactly,
   or rejection).
3. **A return on day 16.** The window is 15 Pacific days, purchase day = 0.
   An evening purchase must not gain or lose a day at midnight UTC.
4. **A return of a sale with no loyalty member attached.**
5. **The same units refunded twice** — whether return-after-return
   (remainingReturnable), void-after-return, or void-after-void (marker
   latch).
6. **A void of yesterday's sale.** Same Pacific day only; the refusal should
   route staff to the returns desk.
7. **A void or counter return processed without a manager/lead PIN**, or with
   a reason shorter than 3 characters.
8. **An accepted return with damaged packaging or an illegible lot ID.** The
   two WAC 314-55-079(12) attestations are hard refusals, not warnings.
9. **A full-line return (in any number of partials) that queues an `Update`
   instead of a `Delete`** CCRS correction — or any accepted return with no
   pending correction row at all.
10. **A destroyed return that quarantines the whole lot.** Only the returned
    unit is segregated (`quarantineLot: false`).
11. **A void that leaves inventory decremented** with no visible note. Restock
    failures must appear on the order timeline ("run a cycle count"), never
    vanish.
12. **A voided medical sale still present in `medical_exempt_sales`.**
13. **Loyalty points surviving a void**, or clawbacks across repeated partial
    returns exceeding what was earned.
14. **A held/parked cart resuming with old prices, a vanished product, or the
    previous customer's ID check.** Holds store variant ids + counts ONLY;
    the parked-sale ID gate re-runs after 30 minutes.
15. **A recalled product completing a sale through ANY path** — register,
    pickup, or back office. And the inverse: a routine quarantine lot (intake
    hold, destruction segregation) must NOT block sales.
16. **A recall-status read failure allowing a sale.** The completion gate is
    fail-closed; "unknown" means blocked.
17. **A pickup handed over without the ID attestation**, or completed while
    the completion gate would refuse (outside hours, over limits, recalled
    product).
18. **Pickup cash missing from the X/Z day report** silently. If the ledger
    row fails, there must be a loud order-timeline note and an audit entry
    saying so.
19. **A register-materialized order appearing in the pickup queue** (the
    "POS sale —" staff-note contract or the pos_sale_events link must catch
    it), or a website order superseded merely by being LOADED into the
    register.
20. **Any order deleted** by a return, void, or pickup flow. Reversals move
    status with reasons; history is permanent.

---

## 9. Findings from this chapter

No new findings. Observations worth recording:

- The Pacific-day conventions here (returns window, void same-day, Task Q's
  `sale_date` via `pacificDayKey`) are the CORRECT pattern that the medical
  exempt-sale ledger (GW-009, ch.03) should be migrated to.
- The multi-step server flows (`createCustomerReturn`, `processVoidSale`,
  `completePickupAtRegister`) are deliberately sequential with visible
  failure points rather than transactional. Every partial-failure path traced
  leaves a loud note (order_events / audit / explicit error text telling
  staff what to fix manually), which is an acceptable posture for a
  single-store deployment — but it is exactly the kind of thing the load/
  concurrency lens (pass 6) should stress-test later.

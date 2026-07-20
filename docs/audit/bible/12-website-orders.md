# Bible Chapter 12 — Website Orders → POS Pickup (Checkout, Server Pricing, Lifecycle, Handover)

> **Audience:** the owner (novice) and any future auditor (human or AI).
> **Verified against:** main @ `9f472a17` (every file:line anchor re-checked on
> that tree — if a line looks off, the file changed after this chapter was
> written; re-verify before trusting).
> **Plain-English promise of this chapter:** a customer can reserve products on
> the website with nothing but a name — no account, no payment — and NOTHING
> the customer's browser claims is ever trusted. The server re-prices every
> line from the published menu, re-checks the legal limits, and runs the same
> compliance gate as every register sale before the order can complete. The
> pickup handover at the register requires a human ID check, and a completed
> sale can never be silently rewound.

---

## 1. The big idea in one paragraph

The website order system is a **pickup reservation**, not e-commerce: no money
changes hands online (`src/app/api/orders/route.ts:17–18` — "NO online payment
is captured — this is a pickup reservation; final price/tax/limits are
confirmed in store"). The design principle throughout is **the client is a
display, the server is the truth**: the checkout posts what the customer's cart
believed, and the server independently re-resolves every line against the
published menu, re-runs the same promotions engine the register uses, applies
the statutory price floor, recomputes totals in cents, and soft-checks the
WAC 314-55-095 possession limits — all BEFORE a row is written. From placement
to handover the order moves along a one-way status chain guarded by a pure
lifecycle matrix (S-15), and the transition into `completed` — the moment a
reservation legally becomes a SALE — passes through the exact same
nine-step compliance gate whether it happens on the admin dashboard or at the
register pickup counter.

---

## 2. The order's shape and its one-way life (`src/lib/orders/types.ts`, `order-lifecycle-core.ts`)

An order has seven statuses (`OrderStatus`, `src/lib/orders/types.ts:9`):
`new → acknowledged → preparing → ready → completed`, plus the two failure
closures `cancelled` and `no_show`. The first four are "active" (staff
attention needed, `ACTIVE_ORDER_STATUSES` :29); the last three are "closed"
(`CLOSED_ORDER_STATUSES` :37). The workflow buttons only offer forward moves
(`ORDER_FORWARD_TRANSITIONS` :47).

The **pure lifecycle matrix** (`order-lifecycle-core.ts`, S-15) exists because
before it, the store accepted ANY from→to change — including `completed→new`,
which corrupts the audit story of a finished sale (header :6–11: "Under WAC
314-55 record-keeping expectations a completed sale must never be silently
rewound"). The rules (`evaluateOrderTransition` :59):

- **Forward is free** — skipping ahead is allowed (a phone order bagged and
  handed over in one step).
- **Any active order may close** as cancelled/no_show (:90–91).
- **completed / cancelled / no_show are TERMINAL** (:70–88). The only way out
  is a reversal to the ONE designated target (`ORDER_REVERSAL_TARGETS` :35 —
  completed→ready, cancelled→new, no_show→new) WITH a written reason of at
  least 5 characters (`MIN_REVERSAL_REASON_LENGTH` :32).
- **Moving backward within the active chain** also requires a reasoned
  reversal (:98–105) — it rewinds recorded workflow history.
- `from === to` is a permitted no-op so re-submits are idempotent (:64).

The store enforces this matrix at the STORE layer (`orders-store.ts`,
`setOrderStatus` :279 — gate at :295–303) so **no caller can bypass it**. On a
reversal the store also clears the timestamps of the statuses being undone
(:321–329) so the row reflects the true current position, and the order_event
note is prefixed `REVERSAL (from → to): reason` (:339–342) so the timeline
reads honestly.

---

## 3. Placement: guest checkout with a server-authoritative spine

### 3a. What the customer sends (`src/app/api/orders/route.ts`)

`POST /api/orders` is guest-friendly — no auth, just a first name and lines
(:74–79). The route parses the payload defensively (`parseLines` :39 drops
malformed lines, `asInt`/`asString` coerce types) and then runs three checks
in order:

1. **S-2a server-authoritative reprice** (:81–90): every line goes through
   `repriceOrderLines` (section 3b). A failure returns the specific problems
   with a 409 so the storefront can refresh its cart.
2. **Totals cross-check** (:92–107): the client's claimed
   subtotal/tax/total are compared against the server's recomputation
   (`clientTotalsMatch`, `order-pricing.ts:272` — tolerance 2 cents via
   `moneyMatches`). A mismatch beyond rounding means stale prices or a
   tampered payload → 409 with the fresh totals. **The client's numbers are
   never persisted** — the insert uses the server's (:136–140, comment
   "SERVER-computed money — the client payload is never persisted").
3. **S-1a placement sales-limit SOFT check** (:109–127): online guests are
   recreational by default (medical status is verified in store). An
   over-limit cart is still accepted as a reservation but flagged
   (`limit_flag` + `limit_reasons`) and the event is logged
   (`logSalesLimitEvent`, `sales-limits.ts:195`); the customer sees a polite
   "we'll adjust at pickup" note (:211–216). The check is
   fail-open-by-design at placement (:123–126 — "must never break placement")
   because the COMPLETION hard gate re-evaluates everything (section 5).

After a successful insert the route fires two best-effort side effects that
never block the customer's 201: a staff/customer email via Resend
(`notifyOrderPlaced` :174–181; entirely env-gated no-op without keys —
`notify.ts:4–15`) and a receipt print queue entry (`queueOrderReceipt`
:183–206, Slice 37).

### 3b. Server pricing (`src/lib/orders/order-pricing.ts`, GAP H-1/H-2)

`repriceOrderLines` (:112) makes the server the source of truth (header
:4–23):

1. Every line resolves against the CURRENT published menu snapshot by
   variantId (:117–153) — category, variant label, and the TRUE regular price
   come from the DB, never the client. A missing variant, a product/variant
   mismatch, or an invalid quantity (≤0 or >500) each add a precise problem
   and refuse placement (:132–162).
2. **Discounts are recomputed server-side with the SAME rules engine the
   register uses** (:164–176 — Promotions Harmony, Task T/PR 1): the back
   office's published promotions evaluated by the pure POS engine, so the
   website can never show a price the register wouldn't honor.
3. The **CCRS cost floor** (Task R, :169–172) attaches each product's
   weighted-average acquisition cost so no discount can price a unit below
   cost, and the **global cannabis price floor** (RCW 69.50.357 — no cannabis
   line may ever be $0) is applied via
   `clampCannabisUnitPrice`/`assertCannabisLineSellable`
   (`order-pricing-core.ts:97/:79`, `MIN_CANNABIS_UNIT_PRICE_MINOR = 1` :65).
4. Totals are rebuilt with the shared pure money math (section 3c), and each
   line is mapped to a WAC 314-55-095 limit bucket, including the AN-1
   per-unit grams parsed from the variant label so limits meter actual
   package sizes (route :153–156).

### 3c. One money brain (`order-pricing-core.ts`)

The pure core is the single source of truth for the tax model (header :1–19):
card prices are **tax-INCLUSIVE out-the-door prices**. Cannabis goods include
the 37% excise + 9.3% combined sales tax (back-out divisor 1.463,
`TAX_INCLUSIVE_DIVISOR` :37); non-cannabis goods only the 9.3% (divisor 1.093,
:39). `computeOrderTotals` (:135) sums line totals, backs out the pre-tax
subtotal with a SINGLE rounding (:149), and derives tax as `total − subtotal`
so the three numbers are exact by construction. The statutory rates are
basis-point constants here (:28–31 — 3700/650/280) and `lib/reports/tax.ts`
imports them for its defaults (S-19/S-20 — the comment at :21–27 records the
"two hardcoded twins" bug this killed; chapter 10 §3 shows the other side).
The cart (client), checkout API (server) and completion gate all import this
same file, which is why `moneyMatches` (:163) can use a 2-cent tolerance: the
same math should produce drift of exactly zero.

### 3d. What gets persisted (`orders-store.ts`, `createOrder` :43)

The insert is guest-safe and defensive:

- A **24-hour advisory reservation window** is stamped
  (`reservation_expires_at` :49–50 — "POS/cart engine remain truth").
- The header insert prefers the migration-0096 shape (limit flags) and falls
  back to the legacy shape when the owner hasn't applied the migration
  (:70–82, `isMissingColumnError` :38) — the same **degrade-don't-fail
  ladder** used for lines: full row → without `unit_grams` (0122 unapplied) →
  without `category` (0096 unapplied) (:105–114).
- If the lines insert still fails, **the orphaned header is rolled back**
  (:116–119) so an order can never exist with no items.
- A `placed` order_event with `actor_label: "customer"` starts the timeline
  (:121–127).
- The response carries the DB-generated GWY order number and a private
  `public_token` (:129).

That token is the guest's only key: the confirmation page reads its OWN order
via `GET /api/orders/[token]` which returns a **customer-safe projection** —
no staff notes, no other orders (`src/app/api/orders/[token]/route.ts:1–6,
:28–47`). Age gating on the storefront itself is a client-side
localStorage acknowledgment (`src/components/age-gate/AgeGate.tsx:7`) — the
REAL age verification is the human ID check at handover (section 6), which is
where WAC 314-55-150 actually bites.

---

## 4. Staff workflow and the audit trail (`src/app/admin/orders/actions.ts`)

Every staff mutation requires `orders.manage`
(`setOrderStatusAction` :51–52, notes :172–173, medical card attach/detach
:206–207/:246–247, loyalty :279–280/:314–315) and writes `recordAudit` rows.
The status action is where the two gates meet:

- **Completing?** The completion gate runs first (:60–101). A manager
  override for the sales-limit gate requires the SEPARATE
  `sales_limit.override` permission AND a written reason (:61–69); a refusal
  is audited as `order.completion_blocked` (:79–86) and the UI redirects with
  the reason; a granted override is audited as `order.limit_override_applied`
  (:92–99).
- **Any transition** then passes the S-15 matrix inside `setOrderStatus`
  (:103–112). A matrix refusal is audited as `order.transition_blocked`
  (:120–127). A success is audited as `order.status_changed` including any
  reversal reason (:135–147).
- **Ledger hygiene (Task O):** if the completion gate already wrote WAC
  314-55-090(2) exempt-sale rows but the matrix then refused, they are
  removed (:115–118) — "the ledger may only describe sales that actually
  completed." Symmetrically, when an order LEAVES completed via a logged
  reversal, its exempt-sale rows are cleared and audited
  (`medical.exempt_sales_cleared` :149–166) because the excise return sums
  that ledger by sale date and stale rows would overstate the Box 2
  deduction (chapter 10 §7).

**Customer linking (Task T/PR 4)** makes loyalty work for online orders: an
order arrives as guest contact info, and linking it to a POS customer record
is deliberately a HUMAN decision — the pure matcher only RANKS candidates by
normalized phone/email, it never auto-links
(`customer-link-core.ts:4–9`, `rankCustomerMatches` :80, `matchBasis` :65 —
phone_and_email beats phone beats email). The store writes the link plus a
`customer_linked` order_event (`customer-link-store.ts:120–148`; unlink
:152–172). Once linked, completion accrues loyalty points on the pre-tax
subtotal (section 5).

---

## 5. Completion: one gate for every path (`src/lib/orders/completion-gate.ts`, POS Slice B1)

`runCompletionGate` (:78) is the → completed compliance gate, extracted
VERBATIM from the admin action so that **both callers run the identical
sequence** (header :3–9): the admin dashboard AND the POS sync ingest (every
synced register sale re-runs it server-side). The register pickup handover is
a third caller (section 6). The sequence, in order (header :11–23, verified
against the body):

1. **Idempotent re-complete** — already completed → allow (:81).
2. **S-12 sales-hours gate** (WAC 314-55-147) — HARD, no override (:83–92).
   The AN-3(a) `hoursAt` option (:64–72) evaluates the instant the SALE
   OCCURRED, not when it synced — an offline sale rung legally at 11 PM that
   flushes at 2 AM must not be refused, and a sale actually rung at 2 AM must
   be refused even if it syncs at noon.
3. **AN-7 recall-hold HARD gate** (:94–118) — a line whose product has ANY
   lot in `recalled` status may not sell, NO override, and it is
   **fail-CLOSED**: if recall status cannot be read, the sale is refused
   rather than guessed safe (:118).
4. **S-2b money recompute gate** (:121–125) — `verifyStoredOrderForCompletion`
   (`order-pricing.ts:308`) recomputes subtotal/tax/total from the STORED
   lines and compares against the header; any drift means the rows were
   altered outside the priced path. It prefers each line's placement-time
   category snapshot (migration 0096), resolves legacy lines from the live
   menu, and treats still-unresolvable lines CONSERVATIVELY as usable
   flower-equivalent so an unknown never slips past the statutory gate
   (:326–337); it also re-checks the price floor on the stored prices
   (:351–358). The "counted as useable cannabis" note alone does not fail the
   money gate — money/floor problems do (:379–381).
5. **Task S-a loyalty-code consistency gate** (:127–143).
6. **Task O attached-card re-validation** — an invalid recognition card
   BLOCKS (:146–159, chapter 3).
7. **Task O DOH 246-70 high-THC HARD gate** — statutory, no override
   (:182–186).
8. **S-1b sales-limit HARD gate** (WAC 314-55-095) — logged override only
   (:189–206); a valid attached card evaluates under medical limits.
9. **Task O exempt-sale ledger write-or-block** (:208–229) — a medical
   exemption whose WAC 314-55-090(2) records cannot be written refuses
   completion, because without the records the exemption is presumed invalid
   and the store owes the tax.

After the gate and the S-15 matrix both pass, `setOrderStatus` fires the
completion side effects (chapter 9 §4, chapter 6): the B19 inventory
decrement (idempotent, best-effort, never blocks — `orders-store.ts:366–377`),
loyalty accrual on the pre-tax subtotal for the linked customer (:379–398),
and — on cancellation/no_show — the loyalty-code release so a customer's
stored value survives a sale that never happened (:353–364).

---

## 6. The register pickup counter (`/api/pos/pickup` + `pickup-store.ts`, Slice B28 / Task AM-D)

The register's pickup queue is **device-authenticated like every register
endpoint** (x-pos-device-id/-key, `src/app/api/pos/pickup/route.ts:48–53`)
and **online-only by design** (:28–30 — the queue lives on the server and
completion mutates durable facts; there is nothing sensible to queue offline).
A device not bound to a register is refused (:66–71). Three modes:

### 6a. Queue + detail

`GET` returns the active website pickup queue, counter-sorted
(`listRegisterPickupQueue`, `pickup-store.ts:71`); `POST {orderId}` returns
one order's lines + totals (:101). POS-materialized orders (the orders the
register's own sales create) are excluded from the queue by the
`staff_note` contract — `isPosMaterializedOrder` checks the exact
`"POS sale —"` prefix with the em-dash (`pickup-core.ts:38–43`; the self-test
at :193–196 pins that an ASCII hyphen does NOT match).

### 6b. Completion at handover

`POST {orderId, complete:{…}}` runs the full handover
(`completePickupAtRegister`, `pickup-store.ts:154`):

1. **Belt-and-suspenders POS exclusion** (:161–171): the staff_note contract
   AND the pos_sale_events link (a register sale always has one).
2. **Register-side policy** — the pure `evaluatePickupCompletion`
   (`pickup-core.ts:154`) collects ALL problems at once: not a POS sale, the
   order must be active, **the budtender must explicitly attest the ID check**
   ("Check the customer's ID first — age verification happens at handover
   (WAC 314-55-150)." :164–166), and the cash tender must cover the total
   (`computeCashChange`).
3. **A real, active employee** must be on the hook (:183–188).
4. **The SAME server completion gate every sale runs — with NO override at
   handover** (:190–197).
5. The order completes through `setOrderStatus` (so the S-15 matrix,
   inventory decrement and loyalty accrual all apply, :199–205).
6. **A day-ledger row is written** (`pos_sale_events`, :207–241) so the X/Z
   report and drawer math count this cash — the payload records the tender,
   change, drawer session, and a `pickup` marker naming who confirmed the ID.
   If that write fails, the sale STANDS (it is complete and legal) and a loud
   order_event tells staff the X/Z report undercounts and to reconcile
   manually (:242–254).
7. Everything is audited (`register.pickup_completed`, :256–272, including
   whether the ledger row was written) and a printable receipt honoring the
   owner's B13 receipt customization comes back (:274–311).

### 6c. Load into a register sale (Task AM-D / AM-D2)

`POST {orderId, load:{…}}` handles "the customer is here and wants to add
items." The critical owner decision is documented at
`pickup-store.ts:338–347`: **the order is NOT superseded at load time** —
loading is not selling, and the earlier cancel-on-load design LOST the order
and its revenue whenever the register sale was abandoned. Instead the order
stays ACTIVE, the register carries the source order id into the sale it is
building, and **the sync supersedes the website order EXACTLY when that
register sale COMPLETES** (`sync-store.ts:767–800`): the source order is
cancelled with a loud timeline note (`supersedeNote`,
`order-to-cart-core.ts:100`) so the two can never both fulfill — and if the
cancel hiccups, the completed, paid-for sale is never undone; a
`order.supersede_on_complete_failed` audit row tells a manager to close the
order by hand (:786–798). The device rebuilds the cart lines against its
CURRENT menu bundle (`rebuildOrderCart`, `order-to-cart-core.ts:57`) — fresh
prices, live promotions, vanished lines dropped and reported; "the website
order's prices are history, not a pricing source" (:350–353). A load is
audited (`order.loaded_into_register`, :376–389) and the response includes
the linked customer as a one-tap member attach (:318–336).

---

## 7. Findings from this pass

No new formal findings. Three deliberate postures worth naming:

1. **The placement limit check is soft and fail-open; the completion gate is
   hard.** An over-limit or even limit-check-crashed placement still creates
   the reservation (route :123–126) — deliberately, because a reservation is
   not a sale and refusing placements on a transient error would cost real
   revenue. The statutory enforcement happens where the law attaches: at
   completion (S-1b hard gate), which is fail-closed.
2. **The website age gate is honor-system; the legal age check is human.**
   The storefront's AgeGate is a localStorage confirmation — trivially
   bypassable, and that is fine, because no product changes hands online.
   The enforceable check is the budtender's ID attestation at handover,
   which the pickup gate physically requires (`idConfirmed`) and records by
   employee id.
3. **The pickup day-ledger write is best-effort after a legal sale.** A
   completed handover with a failed `pos_sale_events` insert leaves the sale
   standing and a loud reconcile-manually note (pickup-store :242–254) — the
   same never-block-a-lawful-sale posture as the B19 decrement (chapter 9 §4).

---

## 8. What SHOULD never happen (watchlist)

1. An order header persisted with the CLIENT's totals — the insert only uses
   server-recomputed money (`route.ts:136–140`).
2. An order with zero lines — the header is rolled back if the lines insert
   fails (`orders-store.ts:116–119`).
3. `completed → new` (or any closed → active hop) without a logged reversal
   reason of ≥ 5 chars (`order-lifecycle-core.ts:70–88`; store gate
   `orders-store.ts:295–303`).
4. A completion that skipped the gate — all three paths (admin action, POS
   sync ingest, pickup handover) call the same `runCompletionGate`, and the
   pickup path forbids overrides entirely (`pickup-store.ts:190–197`).
5. A sale completing while recall status is UNREADABLE — the AN-7 gate is
   fail-closed (`completion-gate.ts:118`).
6. A pickup handover without the explicit ID attestation
   (`pickup-core.ts:164–166`).
7. A POS-materialized order appearing in — or being completed from — the
   pickup queue (double-checked at `pickup-store.ts:161–171`).
8. A loaded website order AND its register sale both fulfilling — the sync
   supersedes the source order on register-sale completion
   (`sync-store.ts:767–800`).
9. A website order cancelled merely because it was LOADED and then abandoned
   (the AM-D owner decision, `pickup-store.ts:338–347`).
10. Exempt-sale ledger rows describing an order that is not currently
    completed (Task O hygiene, `actions.ts:115–118` and :149–166).
11. An auto-link between a guest order and a customer profile — linking is
    always a staff decision (`customer-link-core.ts:4–9`).
12. A guest reading any order other than their own — the token route returns
    a customer-safe projection looked up only by the private token
    (`api/orders/[token]/route.ts`).
13. A notification or receipt-print failure blocking a customer's checkout
    response (route :174–206, both `.catch(() => {})`).

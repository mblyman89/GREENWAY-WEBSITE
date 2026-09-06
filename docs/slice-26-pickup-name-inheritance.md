# Slice 26 — the pickup receipt prints the name the customer already has

## The report

> "I want to connect/ pass the online order fun receipt overlay that is
> generated when an online order is completed, to the register in the open
> pickup queue screen. right now, the online order gets a fun overlay that is
> shown on the screen and emailed to you. then when I get to the store, the
> order is pulled up and finalized. the fun overlay on the printed receipt is
> now different from the one originally attached to the online order. I am all
> about consistency and I feel like if I notice this, others will too."

One order, two different names. The customer is shown a name on the
confirmation screen, is emailed the same name, drives to Port Orchard, and is
handed a slip of paper calling their order something else entirely.

## What was actually happening

A website order gets its name on the server, inside the same request that
inserts the row. By the time the confirmation page renders, `display_name` is
already a column on that order, which is why the website side has always been
perfectly consistent with itself.

The register never learned about it. Reading the load path end to end, the
order's name is absent at every single hop:

- `PickupOrderDetail` has no display-name field.
- `LoadOrderResult` has no display-name field.
- `getRegisterPickupOrder` maps the order row without touching `display_name`.
- `/api/pos/pickup` never selects it and never returns it.

So the device received the order's lines, its customer and its id — everything
needed to ring up the sale — and nothing at all about what the order was
already called. The register then did the only thing it could: it treated the
sale like any other and drew a brand new name from the pool at the first cart
line. Two names, one order.

## The second bug hiding inside the first

That fresh draw was not free. Every draw stamps the rotation's assignment
sequence, which is exactly how the pool guarantees a name will not come back
around for a long time. A pickup order was therefore charging the pool **twice**
— once at insert for the name the customer saw, and once again at the register
for the name that got printed — while only ever showing one of them on paper.
For a shop where pickups are a large share of orders, that halves the effective
rotation length and pulls every repeat forward for nothing.

Fixing the consistency complaint fixes the leak in the same move, because the
correct behaviour is not to draw at all.

## The fix

The sale already knows which website order it came from: `sourceOrderId` is
threaded through `SaleFlow` and carried into the completed sale's payload so the
sync can supersede the website order on completion. That value is the whole
answer — it just was not being used for the name.

`POST /api/pos/order-name` now accepts an optional `sourceOrderId`. When one is
present, the server reads that order's stored `display_name` and hands it
straight back with `source: "inherited"` and `gap: null`, assigning nothing. When
there is no source order, or the order has no stored name, the endpoint draws
from the pool exactly as it always did.

### Why the endpoint and not the pickup load response

The obvious alternative was to add `displayName` to `LoadOrderResult` and carry
it through the shell as client state. That was rejected because the register can
arrive at "I need a name for this sale" by three different routes: loading an
order from the queue, resuming a snapshot after an idle auto-lock, and
rebuilding the sale. Only one of those three goes through the pickup load
response, and a name carried as extra client state would have to be persisted
into the resume snapshot and cleared on every path that already clears
`loadedOrderId`. Every one of those is a place to forget.

`sourceOrderId` is already on all three paths and already persisted in the
resume snapshot, because superseding the website order depends on it. Answering
on the name endpoint means all three inherit for free, and the pickup response
keeps the shape the pickup screen already trusts.

### The decision lives in a pure module

`resolveNameInheritance` in `order-name-prefetch-core.ts` owns the rule, next to
the Slice 24 rules it belongs with, and is mutation-tested. Two mutations were
run against it and both were caught: making a walk-in inherit produced 2
failures, and making an inherited name fall through to a draw produced 5.

`normalizeSourceOrderIdForName` drops anything that is not UUID-shaped, mirroring
the guard the pickup route already applies to the same id, so a corrupted resume
snapshot degrades to an ordinary draw rather than handing an arbitrary string to
the data layer.

## What deliberately still draws a new name

- **Walk-in sales.** No source order, no inheritance. Unchanged.
- **A loaded order with no stored name.** Orders placed before the pool existed,
  before migration 0147 was applied, or while the pool was empty were shown the
  plain `GWY-XXXXXX` number. There is no name to be consistent with, so the
  paper gets a fresh one exactly as a walk-in would.
- **Any failed lookup.** Not knowing is treated as not having. A decorative read
  must never be able to delay or fail a sale, so an unreadable body, a missing
  column and a transient database error all mean "draw".

## Invariants preserved

- `onPaid` stays synchronous; the sale never waits on the name.
- A printed or emailed receipt is closed forever — the Slice 24 late-fill guard
  is untouched.
- A name is never printed that the append-only queued payload does not carry.
- An inherited name is never re-validated into a draw. If an inherited name is
  somehow unprintable it degrades to the real receipt number, because drawing
  instead would burn a pool slot *and* contradict the customer's email — the
  exact defect this slice removes.

## Verification

- `tsc --noEmit` — 0 errors.
- `eslint` on all five touched files — 0 problems.
- Pure self-tests: `order-name-prefetch-core` 36 → 52 assertions, 0 failures.
- Two mutations introduced and both caught (2 failures, then 5); reverted.
- `tests/compliance/order-name-inheritance.test.ts` — 8 tests, all passing.

## No migration required

This slice reads `orders.display_name`, which migration 0147 already added and
which is in production today. There is nothing for the owner to apply by hand.

# Slice 16 — Why the register said "unavailable" for inventory you could see in the back office

**Reported by:** Michael Lyman, from the counter, with a scanner in his hand.

> "In the register app, I have been trying to scan things that are showing up in
> the back office inventory page, but shows as unavailable for sale on the
> register. I tried several to see if it was universal and was the scanner not
> working. But I found some products that do appear in the register side and do
> work to add them to the cart when scanned."

That last sentence is the most valuable part of the report, and it is what made
this diagnosable. A scanner that is broken is broken for everything. A scanner
that works for some products and not others is not a scanner problem at all —
it is a data problem, and the data decides which products fall on which side of
the line. This document is the record of finding that line, proving where it
was, and moving it back to where it belongs.

Everything below was established by reading the code in this repository. There
are no database credentials in the environment this work was done in, so
nothing here rests on a live query, and nothing here rests on a guess. Every
claim carries the file and line that supports it, and every fix carries the
test that fails when the fix is removed.

## The two lists, and why they were allowed to disagree

The back office and the register do not read the same thing. They never have.
They are two different reads of two different tables, and the whole defect
lives in the gap between them.

The back office inventory page calls `listAllLotsForFiltering()` in
`src/lib/inventory/store.ts`. It reads the `inventory_lots` table with
`select("*")` and — this is the important part — **no status filter of any
kind**. Every lot in the table appears on that page. That is correct behaviour
for a back office: an inventory manager needs to see the empty lots, the
quarantined lots and the destroyed lots, not just the good ones.

The register calls `GET /api/pos/menu`, which calls `loadLiveMenuAll()` in
`src/lib/pos/live-menu.ts`. That does not read `inventory_lots` at all. It reads
the single **published** row in `menu_versions` and the `menu_items` and
`menu_variants` that hang off it. A published menu version is a *snapshot* — a
photograph of what the menu looked like at the moment somebody pressed publish.

The two are stitched together by one text column. `inventory_lots.pos_product_key`
is matched against `menu_items.source_item_id`, a relationship declared in
`supabase/migrations/0023_pos_inventory_lots.sql` at line 96. It is a plain text
column, not a foreign key, so the database will never complain when the two
sides drift apart.

So the back office reads live truth, and the register reads a photograph. That
design is defensible on its own — you do not want a register menu changing under
a customer's nose mid-transaction. It becomes a defect the moment the photograph
stops being refreshed when the truth changes underneath it. Which is exactly
what was happening.

## Defect A — two stock counters, and nothing kept them in agreement

The system counts the same physical product in two separate places.
`inventory_lots.on_hand_qty` is the live count that the back office shows.
`menu_variants.inventory_level` is the count baked into the published snapshot
that the register shows.

Five modules in this codebase move stock. I checked, file by file, which of them
writes to each counter:

| Module | writes `on_hand_qty` | writes `inventory_level` |
| --- | --- | --- |
| `src/lib/inventory/cycle-counts.ts` | yes | **no** |
| `src/lib/inventory/disposition.ts` | yes | **no** |
| `src/lib/inventory/intake-store.ts` | yes | **no** |
| `src/lib/inventory/sale-decrement.ts` | yes | yes |
| `src/lib/pos/void-store.ts` | yes | yes |

Sales and voids keep both numbers honest. **Intake, cycle counts and
dispositions only ever move one of them.** Those three are precisely the
operations that *add* stock or *correct* stock — the operations that ought to
bring a product back to life on the register.

The consequence follows mechanically. A product sells down to zero. The sale
path correctly writes `on_hand_qty = 0` and `inventory_level = 0`, and the
snapshot's `inventory_status` becomes `"unavailable"` — the threshold is applied
identically in three places (`intake-menu-staging-core.ts:311`,
`sale-decrement-core.ts:137-141`, `transform.ts:590-594`), so at that instant
everything is consistent and correct. Then a new case arrives. Intake writes
`on_hand_qty = 48`. It does not touch `inventory_level`, which is still 0, and
it does not touch `inventory_status`, which is still `"unavailable"`.

The back office now shows 48 units. The register still holds a photograph that
says zero.

From there the register's own code does exactly what it was told. In
`src/app/api/pos/menu/route.ts` the line `if (item.inventoryStatus ===
"unavailable") continue;` drops the product from the payload. Because it never
reaches the payload, its key never enters `sellableKeys`. Because the key is not
in `sellableKeys`, `buildBarcodeIndex` deliberately drops that lot's barcodes.
Because the barcode is not in the index, `resolveScan` returns `none`. And
because it returns `none`, `SaleFlow.tsx` line 2399 prints the message the owner
was staring at: `Barcode "…" matched nothing on the menu`.

Nothing in that chain is a bug in isolation. Every link is behaving correctly
given its input. The bug is a stale number at the top, and five layers of
faithful obedience carrying it to the counter.

**This is the answer to "why do some work and some don't."** A product whose
last stock event was a sale or a void has two correct counters and scans fine. A
product whose last stock event was an intake, a cycle count or a disposition has
one stale counter and cannot be sold. Two products sitting next to each other on
the same shelf, one scannable and one not, purely on the history of how their
stock last moved.

## Defect B — the staleness was copied forward, not corrected

`carryForward()` in `src/lib/pos/intake-menu-staging-core.ts` (lines 313-371)
builds each new menu snapshot from the previous one. It copies
`inventory_status` and `inventory_level` across verbatim.

So publishing a new menu did not fix anything. The wrong value was faithfully
reproduced into the next snapshot, and the next, indefinitely. The only code
path that could wake a dead card back up was `applyMergeToCarried()`, and that
only fires when a product goes through intake mastering. A product that was
merely restocked, recounted or corrected never qualified. The staleness was
effectively permanent.

## Defect C — the 86 button had no undo

`/api/pos/stock-flag` writes `inventory_status = "unavailable"` at
`route.ts:79`. That is the "86 this item" control staff use when something runs
out on the floor.

I grepped the entire `src/app/admin` tree for any code that writes that column
back to `"in-stock"`. **There is none.** Once a product was 86'd it stayed 86'd
forever, with no control anywhere in the back office to reverse it. Every
accidental press was a permanent removal from the sellable catalogue.

## Defect D — lots with no link to the menu at all

A lot whose `pos_product_key` is null or blank has nothing to match against
`menu_items.source_item_id`. It can never be sold, under any circumstances,
because there is no product on the register for it to attach to.

The count of these was already being computed — `lot-gap-core.ts:129` tracks it
as `missingProductLink` — but the number was never surfaced anywhere a human
would see it, and never explained. A silently discarded diagnostic.

## Defect E — the only detector was the owner, at the counter

This is the one that matters most, because it is the reason all of the above
survived. There was no screen anywhere in the system that compared what the back
office holds against what the register can sell. The discrepancy was
undetectable by design. The first and only alarm was the owner standing at a
till with a scanner that appeared to be broken.

A fault that can only be discovered by a customer-facing failure will always be
discovered by a customer-facing failure.

## The fix

### 1. The register re-checks live stock before it hides anything

`GET /api/pos/menu` already read `inventory_lots` — it needed them to build the
barcode index. That read has been moved up front and now selects `id, lot_code,
pos_product_key, ccrs_inventory_external_id, status, on_hand_qty, product_name`
with **no SQL filter on status or quantity**. The filtering moved into pure code
so that the barcode index and the availability decision are computed from one
identical set of facts and cannot disagree with each other.

The route then hands the snapshot cards and the live lots to
`reconcileRegisterAvailability()` in the new pure module
`src/lib/pos/register-availability-core.ts`. Three gates that used to be three
separate `continue` statements are now one decision point:

```ts
const verdict = availabilityByProduct.get(item.id);
if (!verdict || !verdict.sellable) continue;
const effectiveStatus = verdict.restored ? verdict.liveStatus : item.inventoryStatus;
```

When a card is marked `"unavailable"` in the snapshot but its lots hold real
units right now, the card is restored and shipped with a status derived from the
live count (`in-stock`, or `low-stock` at three units or fewer) rather than the
stale one. The product reappears, the key enters `sellableKeys`, the barcode
enters the index, and the scan works.

**It is self-healing.** No migration, no backfill, no button to press. The next
time a register downloads the menu, every stale card is repaired.

### 2. The one-way safety invariant

This is the single most important design rule in the slice, and it is enforced
in code and pinned by a mutation test.

**Reconciliation may only ever ADD sellability. It may never remove it.**

```ts
if (card.inventoryStatus !== "unavailable") { /* always sellable */ }
```

The reason is that lot data is not complete and was never meant to be. Merchandise,
glass, lighters and non-cannabis goods legitimately have no `inventory_lots`
rows at all. If the reconciler were allowed to subtract, "I have no lot evidence
for this" would be silently read as "this has no stock," and the fix would blank
out a section of the menu that works perfectly well today. So absence of
evidence is recorded honestly as `no_lot_evidence` — a distinct reason code from
`no_live_stock` — and it never removes a product that the snapshot already
considered sellable.

### 3. Every compliance gate is untouched

The fix widens availability. It does **not** widen the rules. All of these still
block a sale exactly as before, and each has a dedicated test:

- **AN-7 recall holds**, at both card level and variant level. Live stock does
  not override a recall — a recalled product with 500 units on hand stays off
  the register.
- **Lot status must be `active`.** Quarantined, destroyed and returned lots
  contribute nothing, no matter what their quantity column says.
- **Hidden cards stay hidden.** `hidden` is an intentional merchandising
  decision and stock never overrides intent.
- **Ambiguous-barcode poisoning** is unchanged: a barcode mapping to more than
  one product still refuses to resolve rather than guessing.

One detail is worth recording because I got it wrong and my own test caught it.
I first wrote the card's recall flag as `lotKeys.some((k) => recalled.has(k))`,
which meant a single recalled *size* would kill an entire mastered product card
— a real regression, widening AN-7 well beyond its intent. The test
`keeps a recalled LOT's size off a mastered card` went red immediately. The
correct form is card-level only (`recalled.has(item.id)`), with variant-level
recall staying in the per-variant loop where it always was. Mutation M10 now
pins that permanently.

### 4. The back office shows what the register cannot sell

Defect E gets its own answer. `getRegisterSellabilityReport()` joins the live
lots to the published snapshot and returns the lots that hold **real stock in an
active lot** but that the register still cannot sell. `RegisterSellabilityBanner`
renders them on `/admin/inventory`, grouped by cause, each linked to the lot and
each carrying the one action that fixes it.

Two deliberate properties:

- **It is silent when clean.** No banner, no green "0 problems" row. A badge
  that is always present is a badge the eye learns to skip, and then it is worth
  nothing on the day it finally matters.
- **It never guesses.** Any failure in the read returns an empty report with a
  `null` summary rather than a fabricated verdict. It is also careful about what
  it counts as a problem: an empty lot or an inactive lot is *correctly*
  unsellable and is not nagged about. Only `no_product_link`, `no_menu_card`,
  `recall_hold` and `hidden_card` — the four causes that represent real,
  actionable stock the register is refusing — are reported.

The banner takes only serialisable props. This is deliberate: the crash fixed in
PR #1095 was caused by passing a function across the React Server Component
boundary, and that mistake is not being repeated.

## How this was verified

The standing rule is that test file content is not test behaviour. A test that
string-matches source code proves nothing about what the code does. So the
behavioural tests in `tests/compliance/register-availability.test.ts` drive the
**real** `GET /api/pos/menu` handler, imported dynamically after
`vi.resetModules()`, against a fake Supabase client shaped like PostgREST that
honours `.range()` so the genuine pagination logic executes. The scan assertions
call the **real** `resolveScan` against the **real** barcode index built by the
route.

- `tsc --noEmit` — **0 errors**
- `eslint` on all seven touched files — **0 errors, 0 warnings**
- `register-availability-core` pure self-tests — **100 assertions passed**
- Behavioural suite — **21/21 passed**
- Full repository suite — no regressions

Then the part that actually establishes the tests are worth having. Eleven
mutations were introduced into the fixed code one at a time, and **all eleven
were caught red**:

| # | Mutation | Caught by |
| --- | --- | --- |
| M1 | Restoration disabled entirely | owner's-defect end-to-end test |
| M2 | Stale snapshot status shipped instead of live | restored-status test |
| M3 | One-way invariant broken (allowed to subtract) | never-removes test |
| M4 | Lot `status` ignored | quarantined-lot test |
| M5 | Recall overridden by live stock | AN-7 card-level test |
| M6 | Hidden overridden by live stock | hidden-card test |
| M7 | Fake "0 left" badge shown on restored card | unitsLeft test |
| M8 | PostgREST numeric-as-string not handled | `toQty` test |
| M9 | Lot read capped at 1,000 rows | deep-target pagination test |
| M10 | Recall widened from variant to whole card | mastered-card test |
| M11 | `no_lot_evidence` conflated with `no_live_stock` | reason-code test |

The 1,000-row test deserves a note. PostgREST caps any single response at 1,000
rows regardless of the `.limit()` requested, and `inventory_lots` is proven in
this repo to run around 4,179 rows. A naive read would silently see only the
first quarter of the store's inventory. The test plants 2,500 filler rows in
front of the target lot and asserts it is still found, so the paging cannot
regress into a silent truncation.

## What to expect at the counter

The next menu download repairs everything. Products that were restocked,
recounted or corrected — and were therefore invisible — come back and scan
straight into the cart. Products that are genuinely out of stock stay out.
Recalled and hidden products stay off, exactly as compliance requires.

If a lot still cannot be sold after this, `/admin/inventory` will now say so by
name, say why, and link to the fix, instead of leaving it to be discovered with
a customer waiting.

## Known follow-up, recorded honestly

**Defect C is diagnosed but not yet closed.** The 86 button still has no undo
control in the back office. The reconciler now heals its effect automatically
whenever real stock is present, which removes the operational sting, but the
proper fix is an explicit "restore to sale" control in the admin UI. That is a
separate slice with its own UI surface, and it is recorded here rather than
quietly bundled in.

**Defects A and B are healed at read time, not at write time.** The three
modules that move `on_hand_qty` without moving `inventory_level` still do so.
The register no longer trusts that stale column, so the failure is contained,
but writing both counters at the source would be the deeper repair. That change
touches intake, cycle counts and dispositions and carries migration risk, so it
is deliberately not bundled into a fix the owner needs working today.

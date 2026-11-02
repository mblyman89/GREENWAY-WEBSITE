# Slice: register-sell-sold-out-stock

## The owner's request (verbatim)

> That didn't fix it. I refreshed the menu. I am uploading a few screenshots of products I can't scan or find yet show up in the back inventory table. The front register still won't let me sell them. Please try harder. The register needs to stop rejecting it and allow it. I search for them in the back office using the all, not active filter. These items are not in active status even though the detail page shows them as active. I need to sell these products right now. Follow the standing rules.

Earlier in the same thread he said: "I dont care if it has no COA, or if its not active or whatever, I WANT TO SELL IT ANYWAYS… no exceptions."

## What production data showed (read-only SQL, 2026-11-01)

These are the packages in his photos.

| Product | Barcode | Lot status | On hand |
|---|---|---|---|
| Trees Co Honey Crystal Alley Oop 1g | GF41656605593661 | sold_out | 0 |
| Trees Co Honey Crystal Bananaconda 1g | GF41656605593659 | sold_out | 0 |
| Phat Panda Chronberry Crunch Badder 1g | WA413287.INFN3T | sold_out | 0 |
| Ooowee Marker 1g | GF43212805631503 | sold_out | 0 |
| Buddies Live Resin Puck Berry Syrup 1g | 20194999226978477 | sold_out | 0 |
| Buddies Live Resin Puck Black Haze 1g | 20194927306946379 | sold_out | **3** |
| Stoned Gnomes Lemon Meringue 3.5g | 21764997002227556 | active | 4 (owner-hidden card; sold since #1632) |
| Heavenly Buds Spodie 3.5g | 21575221784697568 | active | 3 (owner-hidden card; sold since #1632) |

**Root cause.** The R50 "Oct-30 count" import (`cultivera-count-core`) ran at 2026-11-01 08:00 UTC.

- It recorded these barcodes as "counted 0" and wrote 465 lots down by a total of 1,951 units.
- `apply_lot_delta` then flipped each of them `active → sold_out`. 463 of those lots are still Sold out at 0.
- The packages are physically on the shelf.

The register served only `status = 'active'` lots that had a quantity above 0. These cards were therefore dropped, and their barcodes left the scan index ("matched nothing").

Black Haze is a separate case. Michael counted +3 back onto the lot, but a manual adjustment never flips Sold out → Active (`wantsAutoSoldOut` only fires on removals). Setting the lot to Active by hand was refused by the go-live check.

## The change

1. **`register-availability-core`** adds `REGISTER_SELLABLE_LOT_STATUSES = {active, sold_out}` and `isRegisterSellableLotStatus`.
   - `indexLiveStock` counts units on Sold out lots.
   - A card whose Active or Sold out lot has a count of 0 is now served (`sell_anyway_zero_count`) instead of `no_live_stock`.
   - `diagnoseLot` no longer calls a Sold out lot "not active".
2. **`/api/pos/menu`** uses the new status set in four places:
   - the live-unit count;
   - the hidden-card eligibility check (any Active or Sold out lot);
   - the barcode index;
   - the exact-size scan index.

   Lots at a 0 count are included in both indexes, so the package scans. With no proven count the size ships `unitsLeft: null`, so the scan adds straight to the cart. A proven size 0 still offers "Sell anyway".
3. **`sale-lot-read`** (the stock decrement and cost replan) draws from Active and Sold out lots that hold units. Samples and held units are still excluded. A sale with no units to draw from is recorded as a shortfall (the oversold report), never as invented stock.
4. **`register-coverage-core`** (per-size attribution), **`register-sellability-store`** and **`restore-to-sale-core`** all count Sold out lots.
5. **Manual adjustment.** A positive adjustment on a Sold out lot now asks `apply_lot_delta` for auto-status, which flips it back to Active (`wantsRestockToActive`; the pre-0129 fallback does the same). Quarantine, Recalled and Destroyed are never changed by an adjustment.
6. **Expiry hold.** `isSellableExpired` and `readExpiredActiveLots` include Sold out lots. Expired edibles and RSO stay hard-blocked even though Sold out lots are now sellable.

## Still never sellable (unchanged)

- `quarantine`: the 38 lots on the two inbound manifests that are still in transit, so not received in CCRS.
- `recalled`: recall holds (WAC 314-55-215).
- `destroyed`: reported to CCRS.
- Trade samples, units held for destruction, non-cannabis or unpriced hidden cards.
- Expired hard-block categories (D36/D44).

## Owner follow-up

- On the iPad, tap **Refresh menu** once the deploy is live.
- The zeroed lots still show 0 on hand in the back office. A sale draws nothing from them and is listed on the oversold report.
- To get the counts right, adjust each lot up to the real number on the shelf (Inventory → lot → Adjust → Count). The lot now goes back to Active by itself.

## Tests

- `tests/compliance/register-sell-sold-out-stock.test.ts` (new).
- `register-availability.test.ts` covers zero-count Active/Sold out lots, Sold out with units, and quarantine staying off.
- `register-sell-all-back-office-stock.test.ts` covers a Sold out hidden card served and quarantine/recalled/destroyed staying off.
- Wiring pins updated in `r74-s31-sale-size-draw` and `sale-posting-wiring`.
- Pure self-tests updated in `register-availability-core` and `manual-adjustment-core`.

# Slice: register-sell-all-back-office-stock

Branch: `register-sell-all-back-office-stock`. **Not merged.** The owner said another agent is working in parallel, so the merge waits for his go-ahead.

## Owner request (verbatim)

> i need your help. there is something strange behavior happening on the front register. i am finding several products that we are unable to find on the front register, despite them being active, with quantity available and such, so they should be sellable. please help me fix this so all the items in my back office inventory table are sellable on the register. i have another agent working so please complete all work needed to fix the issues, then wait to merge to git until i say it is safe to do so. download a copy of the repo, read agents.md, the standing rules, then begin the fix. please follow the standing rules. go above and beyond, we need to be able to sell everything, especially if it can be found in the back office inventory. thank you.

Follow-up: "please continue. follow the standing rules. thank you."

## How this was diagnosed

The sandbox has no database credentials, so every cause below was proven from the code paths. None comes from production rows. The size of cause 1 comes from the measurement already recorded in `src/lib/pos/missing-product-master-core.ts`, which ran the real transformer on the owner's workbooks: **771 hidden cards, all `no_product_master`, 8,012 units on hand, $141,148.02 retail, 0 with zero stock.**

## Root causes

1. **Cards the importer hid were treated as "do not sell".**
   - The Cultivera importer (`src/lib/pos/transform.ts`) hides two kinds of card:
     - `no_product_master`: an Inventories row with no Products-workbook row.
     - `no_inventory`: a Products row with no inventory.
   - That hide is a machine's website-listing decision. `/api/pos/menu` treated every `hidden` card as a person's hide and dropped the card, all its sizes and its barcodes.
   - The lots stayed active and stocked in the back office inventory table, but the register could not find or scan them. **This is the main cause.**
2. **A stale "0 left" silently refused scans.**
   - A card the snapshot still listed as in stock shipped each size's cached `menu_variants.inventory_level`. Only sales and voids update that cache. Cycle counts, intake adjustments and dispositions update `inventory_lots.on_hand_qty` instead.
   - A size with real stock could therefore ship as `unitsLeft: 0`. Its tile greyed out, `addToCart` clamped the add to nothing, and every scan path still flashed "Scanned" with no message.
3. **Search ignored the back-office name.**
   - Register search looked only at card name, brand, category and size.
   - The back office table shows the lot's product name (the Cultivera name). When a card had been renamed or rolled up, typing what the inventory table shows found nothing.

## What changed

- **`src/lib/pos/register-coverage-core.ts`** (new, pure, with a self-test registered in `run-pure-selftests.ts`):
  - `classifyHiddenCard` lets the register ring up a hidden card **only** when all of these hold:
    - the hide reason is the importer's own (`no_product_master` / `no_inventory`);
    - the card's category is a cannabis category with a WAC 314-55-095 limit bucket;
    - the raw Cultivera category is one the importer maps explicitly. This keeps out a `needs_category` hold hiding under the `paraphernalia` placeholder.
    - at least one size has a price above $0.
  - These stay off the register: a person's hide (`owner`, `owner_override_hide:`, `reviewer_rejected`, or no reason), `needs_category`, non-cannabis or unmapped categories, and unpriced cards.
  - `attributeLotsToVariants` / `variantUnitsLeft` compute live units per size.
    - Attribution order: lot size link (0294) → `${key}-onboarded` → the card's only size. This is the same order the price and decrement paths use.
    - Anything ambiguous ships as unknown (`null`). The code never guesses a count and never ships a stale 0.
  - `registerSearchText` builds extra search words from lot product names and the strain, de-duplicated and capped at 160 characters.
- **`src/lib/pos/register-availability-core.ts`**: adds the optional `SnapshotCard.registerEligible`. The reconciler and `diagnoseLot` treat such a card as not hidden. Recall is still checked first. A person's hide is unchanged. New self-test assertions cover this.
- **`src/app/api/pos/menu/route.ts`**:
  - Serves importer-hidden cards that pass the classifier **and** have live active stock (sample lots and held units excluded). It never serves their $0 sizes.
  - Reads `menu_source_variant_id`, with a fallback for databases before migration 0294.
  - Ships live per-size `unitsLeft` when the lot read is complete. A failed or truncated read keeps the old behaviour exactly.
  - Ships `searchText`.
  - Logs how many register-only cards are being served.
  - Barcodes for these cards join the scan index automatically, because the index is built from the products that ship.
- **`src/lib/pos/sale-flow-core.ts`**: `PosMenuProduct.searchText` added, and `searchProducts` matches it.
- **`src/app/(site)/pos/SaleFlow.tsx`**: all four scan paths (search-box Enter, global wedge scan, both size-pick rows) now go through `scanAdd`.
  - A refused scan shows the same "Sell anyway" offer the tiles show. Any staff member may take it, for that sale only (owner decision Q2).
  - Scans now honour an override already taken. Before, they silently did nothing.
- **`src/lib/inventory/register-sellability-store.ts`**: the back-office banner reads `hidden_reason`, `category`, `pos_inventory_category` and prices, and applies the **same** classifier. A lot the register is selling is never reported as "hidden" there.

## Gates kept (never bypassed)

These still apply exactly as before:

- Recall hold, at card level and per size.
- Lot status must be `active`.
- Expired hard-block.
- Trade samples (`withoutSampleLots`).
- Units held for destruction (`sellableQty`).
- Sales-limit buckets.
- Server-side re-pricing and re-gating at sync.

## Important caveat for the owner: CCRS

`ccrs-batch` builds `Product.csv` only from `hidden = false` items. Lots of hidden products are withheld from `Inventory.csv` (E41/E47), and their Sale rows are held back by `dropEventRowsForHeldLots` and tracked as owed.

So a register sale of an importer-hidden product completes, decrements the lot and is recorded. **Its CCRS Sale row is held back until the product is fixed** (Products row added / reviewed, which un-hides it). The fix list is the existing missing-product-master worklist. Nothing is lost; it is reported once the product is fixed.

## Still not sellable (by design), and the fix

- A lot with **no product link**, or whose key matches **no published card**: no verified price or category exists, so there is nothing to ring up. The back-office banner lists these with fix links (Product Onboarding / link the lot).
- A card a **person** hid: un-hide it on the product page.
- `needs_category` holds, or unmapped / non-cannabis / unpriced importer-hidden cards: pick the category or set a price.

## Tests

- `tests/compliance/register-sell-all-back-office-stock.test.ts` (new) drives the real route and covers:
  - importer-hidden cards sold, with scan;
  - every unsafe or human hide stays off;
  - recall, sample and held units still block;
  - $0 sizes dropped;
  - live units from linked sizes;
  - search on lot names and strain;
  - banner parity;
  - a guardrail that every sellable back-office lot reaches the register.
  - Mutation-checked: disabling the eligibility line turns 4 tests red.
- `tests/compliance/register-availability.test.ts`: two expectations changed on purpose. Unit counts now come from live lots (12, matching the back office) instead of the stale cache (7 / null). A new test pins the old cached behaviour when the lot read fails, and another pins `null` for ambiguous multi-size lots.

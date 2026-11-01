# Slice: register-scan-exact-size

## The owner's request (verbatim)

> I need your help fixing a behavior I do not like happening on the ipad registers. when I scan a product, it will pull on screen all of the products of the same type but the different size variants. for example, if we stock 3.5g, 7g, and 28g options, scanning the 3.5g bag pulls on screen all three options, where I then have to select one of the three. this will cause major issues with inventory discrepancies if the budtenders push the wrong one. if I scan something, and it knows what it is I just scanned, that product alone needs to be added to the cart with out needing to select a variant size. please clone the repo, read agents.md, the standing rules, then proceed with fixing the system to behave the way we need it to. please go above and beyond. follow the standing rules. make sure to do sufficient recon and create a comprehensive todo list and roadmap strategy to follow. thank you.

## Root cause (grounded)

`/api/pos/menu` shipped one barcode index, `barcodes: code → card key` (`buildBarcodeIndex`). A Cultivera card with several sizes has one card key and its lots all point to it. So `resolveScan` could only answer "this product". It returned `pick`, and the register showed every size.

The lot already knew its size:

- `inventory_lots.menu_source_variant_id` (migration 0294), filled in by the Cultivera import or by the owner under **Which size is this lot?**
- the receiving variant `${lotKey}-onboarded`
- `unit_weight` / `unit_weight_uom` (migration 0024)

None of this reached the register.

A wrong tap is a real inventory error, not just a cosmetic one. The sale decrement (R74 S31, `sale-decrement-core`) draws stock from the lots of the size that was sold, so tapping 7g for a 3.5g bag takes the units from the 7g lots.

## The fix

- **`src/lib/pos/scan-exact-size-core.ts`** (pure, with `__runScanExactSizeCoreTests`, 32 assertions in the pure self-test runner). `buildBarcodeSizeIndex` proves each lot's size. It checks the evidence in this order:
  1. the receiving variant;
  2. the 0294 size link;
  3. the package weight compared with the size label (g or oz), using the medical flag only to break a tie.

  The results are:
  - **Exact size proven:** the code maps to that size.
  - **Proven size not on the register** (recalled, $0, removed): the code is mapped to a *refusal* message, so another size is never offered.
  - **One code shared by lots with different answers:** the code is dropped (never guessed).
  - **No evidence:** no entry. The register asks as before, but now says why and how to fix it.

  Only multi-size cards ship entries. The whole index on today's data is about 39 KB.
- **`/api/pos/menu`** also reads `unit_weight, unit_weight_uom, is_medical` and builds the index from the same active, stocked, sellable lots the card index uses. It ships the result as `barcodeSizes` / `barcodeRefusals`, and logs a one-line summary (a warning when lots are unproven or conflicting).
- **`resolveScan`** gets an optional 4th argument. A refusal wins. Exactly one fitting size means **add**. A narrowed set gives a pick of *only* those sizes. A stale entry falls back to the card index. Picks now carry a `reason`, and `scanPickPrompt` words each one.
- **`SaleFlow.tsx`** passes the index on both scan paths (search box Enter, and the wedge/Socket scanner). A refusal shows its message and adds nothing.
- **Back office:** the lot page's "Which size is this lot?" panel now explains that an unlinked lot may make the register ask, and that saving a size fixes every future scan.
- **SOP-01 §4.8** has been updated.

## Measured on the real Cultivera workbooks (`scripts/recon/scan-exact-size-probe.ts`)

| | Before | After |
|---|---|---|
| Stocked lots scanned | 4,147 | 4,147 |
| Scans forcing a size pick | **739** | **0** |
| Straight to cart | 3,408 | 4,147 |
| Wrong-size adds | n/a | **0** |

The 739 were resolved by the size link (738) and by package weight (1).

## Gates kept

- Recall and delisted cards: their barcodes still resolve to nothing, because the size index only covers sellable keys.
- Samples, held units, quarantine and zero stock: excluded exactly as before.
- Scan-required mode, stock ceilings and purchase limits: unchanged. The add path is the same `addToCart`.
- Old cached bundles with no `barcodeSizes`: they keep the old behaviour (they ask), and never break.
- Typing the card key still asks, because it names a product, not a package.

## Tests

- `tests/compliance/register-scan-exact-size.test.ts` drives the real route and the real `resolveScan`. It covers the 3.5g/7g/28g example, CCRS ids, weights in g and oz, refusal, a shared code, an unlinked lot, an old bundle, the card key, recall, and a failed read. Mutation check: when `barcodeSizes` is emptied, 4 tests fail.
- The pure self-tests for both cores are registered in `scripts/compliance/run-pure-selftests.ts`.

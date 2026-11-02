# Slice: register-price-lookup-and-lot-details

## The owner's request (verbatim)

> I need your help adding two new features to my iPad registers. I want to add a price lookup feature to the lock screen. A button that opens the browse menu in full screen mode, with the ability to scan a product to see its price. The second feature is to add significantly more details to the browse menu. We need every detail available, vendor lot number, everything. Clone the repo, read agents.md, the standing rules, then proceed with building both features. I have another agent working. So complete all tasks and stage them to be merged when I say it is safe to do so. Go above and beyond. Follow the standing rules. Thank you. Commit work out of the sandbox. Use the shared root workspace folder to keep work safe. Keep the ready to merge work there. Thank you.

**Merge status:** staged, **not merged**. Another agent is working. The branch is rebase-merged only when the owner says it is safe.

## Feature A: lock-screen Price lookup

- **Lock screen** (`RegisterShell.tsx` `LockScreen`): a **🔍 Price lookup** button under the PIN pad. It needs no PIN. It is greyed out, with the reason shown, until the menu bundle has downloaded (`priceLookupUnavailableReason`).
- **`PriceLookupScreen`** (exported from `SaleFlow.tsx`, so it reuses the same `ProductTile`, category colours, chips and info card): a full-screen, **read-only** browse over the cached bundle.
  - There is no cart, no employee and no sync; tiles open the info card instead of adding.
  - Scans come from the keyboard wedge (same `wedgeKey` detector, which stands down while the Socket SDK owns scanning), from Socket Mobile (`useSocketScanner`, product route only, so licences are ignored), or from typing a code and pressing Enter.
- **`src/lib/pos/price-lookup-core.ts`** (pure, 23 self-test assertions plus a vitest mirror):
  - `resolveLookupScan` goes through the **same** `resolveScan` and exact-size index as the sale. A lookup therefore never shows a different size than a scan would ring, and refusals and size picks read the same.
  - `lookupPrice` prices one unit with the sale's own `priceCart` (promotions plus legal floors). The card shows the shelf price and **today's price**, the deal name and the saving.
  - `lookupStockLine` gives the stock line; `lookupIdleRemaining` drives the **90-second idle auto-close**, with a 15-second countdown hint.
- The screen works fully offline. The photo and lot details are online extras.

## Feature B: "every detail" info card

- **`GET /api/pos/product-details?productId=&variantId=`** is device-authenticated, with CORS and OPTIONS handling, as for every `/api/pos/*` route.
  - **What it reads** (rule 15, explicit columns): `inventory_lots` for the size's lot keys, plus lots linked to the size (0294), then `vendors`, `brands`, `inbound_manifests` and `lab_results` by id.
  - **Missing columns:** columns added after 0023/0024 are *optional*. If a migration is missing in an environment, the read drops that one column and retries (`missingOptionalColumn`).
  - **Errors:** every other `{ error }` becomes a plain-English warning on the card (`explainReadError`: 42501, 42P01/PGRST205, 42703/PGRST204).
  - **Tables:** they are named through `*_TABLE` constants. All five were already in the DB contract (`build-db-contract --check` is unchanged).
- **`src/lib/pos/product-detail-core.ts`** (server, 68 assertions) builds the sections for each lot.
  - **Which lots are shown:** trade samples are excluded, and a lot linked to *another* size is never shown as this size. Lots selling now come first, in FIFO order; the rest are newest first, capped at 8. If the lots are filed only under the card key, the card warns.
  - **The sections:**
    - **Lot & traceability:** vendor lot #, with its source and a warning for pdf_guess or unknown; "Not on file" when it is missing; lot code; CCRS id; status; manifest, invoice and transfer date; POS key; size link.
    - **Vendor & brand:** vendor, legal name, DBA, licence, brand.
    - **Product:** names, strain and type, LCB inventory type, package size, net weight or volume, servings, ratio, low-THC and otherwise-taken flags, medical lot.
    - **Stock & dates:** received qty, on hand, held, sellable, sold or used, received date with age and source, expiry with a "soon" or "past" tone.
    - **Potency on the package.**
    - **Lab result (COA):** lab, test id, date, pass or fail, percentages, the certificate's detected cannabinoids and total terpenes (only when the certificate's identity checks out), COA dates, terpenes in ppm, and the COA link (http or https only).
  - **Never shows cost or margin**, because the card is reachable from the lock screen. A vitest pin checks this.
- **`src/lib/pos/product-detail-view-core.ts`** is the client half (29 assertions). It has no heavy imports, so the packaged iPad app stays within the register-app guard. It holds the wire types, a defensive `parseProductDetailsResponse` (caps sizes and drops non-http links) and `cardFactRows`.
  - `cardFactRows` lists the size-level facts the cached bundle already has, so they show **offline**: size, weight or volume per unit, THC per unit, items per package, units left, legal lane, expired lot on the shelf, POS key.
- **`ProductInfoModal`** is now wider (`max-w-2xl`). It shows the B42 facts, then **This size**, then **Lot details**: collapsible lot blocks, with the lot selling now opened first and the warnings strip on top. Offline, it says "Lot details need a connection…".
  - The price block shows today's deal price and the stock line.
  - "Add to check" is hidden when the card is opened from Price lookup.
- **`RegisterShell`** has stable `useCallback` fetchers (`fetchProductDetails`, `fetchProductImage`) shared by the sale and the lock screen.

## Verification

- `tsc` is clean for every changed file (scoped project; the full-repo `tsc` is out of memory in this 3 GB sandbox, and CI runs it).
- eslint is clean on every changed file.
- vitest: 61 related files and 1,424 tests pass. These include `pos-register-app-guard`, `pos-tokens`, `pos-theme-contrast`, `register-scan-exact-size` and `g71a-db-contract`.
- `run-pure-selftests` reports ALL PURE SELF-TESTS PASSED.
- `npm run register:build` succeeds.
- `build-db-contract --check` reports the contract up to date.
- **SOP-01:** new §4.1a (Price lookup); §4.8 gains the *Product info card* description.

## Out of scope / notes

- No migrations and no CCRS files were touched.
- Cost is deliberately not shown anywhere on the card.

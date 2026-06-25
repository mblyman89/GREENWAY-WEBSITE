# Shop Filter Section Expansion Todo

## Context / logic map
- POS data comes from `pos-data/raw/PRODUCTS.xlsx` and `pos-data/raw/INVENTORIES.xlsx`.
- `scripts/pos/transform_pos_data.ts` normalizes raw POS rows into `src/data/pos-menu-preview.json` during `npm run transform:pos` and `npm run build`.
- `GreenwayCategory`, menu item fields, variant labels, potency, package labels, and filter categories are defined in the transformer and mirrored in `src/lib/leafly/types.ts`.
- Visible category filters are defined in `src/lib/pos/category-taxonomy.ts`.
- Shop filtering/grouping happens in `src/components/menu/InteractiveMenuBrowser.tsx`.
- Product card display and variant price labels use `ProductCardVisual.tsx` and `ProductCardPriceSelector.tsx`.
- Prior branch grouped broad `concentrate` filter results by raw POS category. This branch should extend that same sectioning idea to cartridges, disposable cartridges, solid edibles, liquid edibles, and preroll/blunt families.

## A. Refresh / discovery
- [x] Confirm branch state and re-read the relevant transformer, taxonomy, menu browser, and card files
- [x] Inspect current generated items for cartridges/disposables/edibles/liquids/prerolls/blunts to see raw categories, names, variants, and package labels
- [x] Inspect raw workbook package/name fields for edible/liquid/tincture rows before changing package logic
- [x] Identify where colon punctuation is currently stripped from display names and confirm representative affected source names
- [x] Inspect existing image/content conventions before adding accessory category cards

## B. Filtered-section grouping expansion
- [x] Extend broad-filter grouping so `cartridge` filtered results section by cartridge subtype such as Live Resin Cartridge, Rosin Cartridge, Distillate Cartridge, Pod, etc. where detectable
- [x] Extend broad-filter grouping so `disposable-cartridge` filtered results section by disposable subtype where detectable
- [x] Extend broad-filter grouping so `edible-solid` results section by raw edible type such as Gummies, Candy, Sugar, Mints, Chocolate, Capsules, etc.
- [x] Extend broad-filter grouping so `edible-liquid` results section by raw liquid type such as Beverage, Soda, Shots, Other Liquid Edible, Tincture, etc.
- [x] Extend filtered grouping for preroll/blunt families so selected preroll/infused-preroll/blunt/infused-blunt views separate single-pack and multi-pack sections
- [x] Preserve normal default grouping behavior unless one of these broad filters is the active grouping context

## C. Accessories filter and accessory section cards
- [x] Add an `accessories` filter category back to the visible filter taxonomy without mapping raw POS spreadsheet rows into it
- [x] Add static accessory section cards for bongs, pipes, papers, bowl pieces, rolling trays, grinders, vape batteries, dab tools, dab rigs, down stems, bubblers, Sherlocks, chillums, and lighters
- [x] Include real image URLs and useful descriptions for each accessory section card
- [x] Show accessory section cards when the Accessories filter is selected without polluting POS product data or raw category mapping
- [x] Ensure accessory cards do not break count/filter behavior for actual POS products

## D. Colon preservation in customer-facing names
- [x] Update display-name cleanup so meaningful colons from raw product names are preserved instead of stripped/blanked
- [x] Avoid preserving separator noise only when it is clearly variant/brand/category punctuation rather than meaningful product punctuation
- [x] Regenerate POS data and verify representative names with colons keep them correctly

## E. Edible/liquid/tincture package-size validation
- [x] Build transformer helper logic to extract package size from raw product names for edible-solid, edible-liquid, and tincture items
- [x] Compare product-name package size against Package Size column and use product-name value as source of truth when they conflict
- [x] Normalize package labels like 12oz, 2oz, 100mg, 10pk, etc. consistently for card variant labels
- [x] Use validated edible/liquid/tincture package labels in price-per-unit boxes, e.g. `$12 /12oz`
- [x] Keep multi-variant edible/liquid/tincture options distinguishable and avoid misleading fallback labels like `12 each`

## F. Verification
- [x] Run POS transformer and inspect category/filter/section-package outputs with targeted scripts
- [x] Run TypeScript/build verification with `npm run build`
- [x] Review git diff for scope control and remove temporary scripts

## G. GitHub / Vercel
- [x] Commit changes with descriptive messages
- [x] Push branch with token-safe GitHub push command
- [x] Create or update PR for Vercel preview
- [x] Report PR and Vercel preview/deployment status; merge only if checks are clearly healthy or explicitly appropriate

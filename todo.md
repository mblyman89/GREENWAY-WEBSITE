# Major Shop Page Refinement Branch Todo

## Context / Current Architecture Notes
- POS workbooks are transformed by `scripts/pos/transform_pos_data.ts` into `src/data/pos-menu-preview.json`.
- Product card data type is defined in `src/lib/leafly/types.ts` as `GreenwayMenuItem` and related category/variant types.
- Shop category filters are defined in `src/lib/pos/category-taxonomy.ts`.
- Shop page UI uses `src/app/menu/page.tsx` → `InteractiveMenuBrowser` → `ProductCard` → `ProductCardVisual` → `ProductCardPriceSelector`.
- Filter matching uses `item.filterCategories` when present; otherwise it falls back to `item.category`.
- Card section grouping currently groups filtered results by `item.category`, not by raw POS category.
- Raw POS category is preserved on each item as `posInventoryCategory`.

## A. Refresh / discovery
- [x] Review file tree and current branch state
- [x] Re-read transformer, category taxonomy, menu browser, product card, and selector files
- [x] Inspect raw edible/liquid/tincture workbook rows to verify strain/potency/package fields before changing logic
- [x] Inspect current generated edible/liquid/tincture output to compare against source rows

## B. Variant selector visual refinement
- [x] Remove the “box inside a box” look from the collapsed price/variant selector
- [x] Make the collapsed selector a single dark price box with the chevron inside the same box
- [x] Make the expanded option list feel like an extension of that same box, not a separate floating/nested box
- [x] Ensure single-variant products and multi-variant products have matching selector width/height styling
- [x] Preserve sale price display, line-through original price, and `/unit` suffix where appropriate

## C. Edible / liquid edible / tincture card data corrections
- [x] Stop forcing edible-solid and edible-liquid items to `unknown` strain type when source row has indica/sativa/hybrid/cbd
- [x] Verify tinctures are included in the edible-liquid correction path unless moved to a dedicated filter category only
- [x] Expand THC/CBD display eligibility so edible/liquid/tincture rows can show source potency values when present
- [x] Prevent edible/liquid/tincture card price boxes from showing misleading package suffixes such as `/2 each` or `/100mg`
- [x] Ensure variant option labels still remain distinguishable if a product truly has multiple edible/liquid variants
- [x] Regenerate POS preview JSON and confirm representative edible/liquid/tincture cards show correct strain and potency fields

## D. Infused preroll filter mapping correction
- [x] Remove `preroll` from `filterCategories` for `infused-preroll`
- [x] Remove `preroll` from `filterCategories` for `infused-preroll-pack` if present
- [x] Keep non-infused `preroll-pack` mapped to `preroll` unless evidence says otherwise
- [x] Verify filtering by Preroll no longer surfaces infused prerolls before regular prerolls

## E. Additional shop filter categories
- [x] Add filter category type support for `blunt`, `infused-blunt`, `tincture`, and `rso`
- [x] Add category taxonomy definitions/labels/helpers for Blunt, Infused Blunt, Tincture, and RSO
- [x] Add raw POS category → filter category mapping so:
  - POS `Blunt` items keep their main category but also filter under `blunt`
  - POS `Infused Blunt` items keep their main category but also filter under `infused-blunt`
  - POS `Tincture` items keep their main category but also filter under `tincture`
  - POS `RSO` items keep their main category but also filter under `rso`
- [x] Confirm `Live Resin Cartridge` remains main category `cartridge` and still cross-filters under `concentrate`

## F. Concentrate filtered section grouping
- [x] Update `InteractiveMenuBrowser` grouping so when the selected category is `concentrate`, results are separated into sections by raw POS category where useful
- [x] Ensure concentrate filtered sections can show labels like Rosin, BHO, Badder, Hash, RSO, Live Resin Cartridge, Cartridge, Disposable Cartridge, Moon Rocks/Infused Flower, etc.
- [x] Preserve normal unfiltered grouping behavior unless a broad concentrate filter is active
- [x] Ensure section anchors/keys are safe and stable

## G. Verification
- [x] Run transformer and inspect generated category/filter counts
- [x] Run targeted script checks for edibles/liquids/tinctures strain + THC/CBD + card unit suffix behavior assumptions
- [x] Run `npm run build`
- [x] Review git diff for scope control

## H. GitHub / Vercel
- [x] Commit changes with descriptive message
- [x] Push branch with token-safe GitHub push command
- [x] Create or update PR for Vercel preview
- [x] If user asked for production Vercel update, merge after build/PR verification or report preview URL/status for inspection

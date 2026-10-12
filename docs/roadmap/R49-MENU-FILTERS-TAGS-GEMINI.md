# R49 — Menu Filters, Layout Safety, Auto-Tags & Gemini Vendor Research

> **THE BIBLE FOR R49.** Read this before every slice, and check it again before every commit.
> If something is not in here, it is not in scope. No drift.
> Branch prefix: `r49-*`. Base: main `7db72a24` (R48 merged, PR #1338).

---

## 0. Owner's request (verbatim, recorded 2026-10-12)

> On the customer facing website, the vendors on left side filter bar bleeds or extends past the container
> into the menu, the long names need to be stacked into two lines. The filter bar should have a stacking
> rule when something extends beyond the edge of the filter bar so no sections names can do this. The
> weights section in the filter bar is empty when it should show options there. There should be size
> options too if the menu has them, like 1oz beverage, 12oz beverage. I can't think of any solid edibles
> that would go in this category other than single serving and multi severing packs, so let's just start
> there. Next I want to add thc, cbd, cbg, cbn, cbc mg slider filter options meant for the edibles,
> liquids, topicals, and others that use mg. Next, please change the strains section title to say
> "strain types" instead of just "strains" in the filter bar. Then, please add a "strains" section with
> all the strains on the menu. May be overkill, but data rich feature rich is the true powerhouse of our
> system. Next issue, When items are added to the cart, it covers the brown bar at the top with our logo
> and business info. It needs to not do this. For any and all screen types and screen sizes. The top
> right cart button that is on every page, sits partially off the screen on some screens or some
> computer types I've seen, it needs to be moved over so it doesn't do this. Not just for my computer,
> but any computer that is used to visit our website. I suppose if we are optimizing the screen size for
> those items, maybe make sure this doesn't and can't happen going forward for any element on the page.
> The next great idea I had was to have the system auto tag new products as new, then auto untag them as
> being new two weeks later. Let's build and set up an auto tag rotation system, maybe a global inventory
> tag setting system on its own page connected to the inventory page via a button at the top of the
> page. Then add tags to the menu filter that would hold the various tags we set. Finally, I want to add
> Google Gemini to the vendor detail page to try and get even more information about the vendor. I will
> use it first, then resort to scraping websites and social media pages after using Gemini.

Standing rules: never guess, never assume. Commit and push often. Do minimal testing (the owner tests).
Finish with a summary report and how-to-test.

---

## 1. Requirement ledger (every ask → an ID → a slice)

| ID | Requirement (owner's words, condensed) | Slice |
|----|----|----|
| F1 | Long vendor names in the left filter bar wrap onto 2 lines instead of bleeding into the menu | S1 |
| F2 | A **stacking rule** for the whole filter bar: nothing (section titles, option labels, search boxes) may extend past its edge | S1 |
| F3 | Rename the filter section **"Strains" → "Strain types"** (and the active-filter pill "Strain" → "Strain type") | S1 |
| F4 | New **"Strains"** section listing every strain name on the menu (searchable, with counts) | S1 |
| F5 | **Weights** section is empty; it must show the real options | S2 |
| F6 | **Size** options when the menu has them: beverage sizes (1 oz, 12 oz …) and, for solid edibles, **Single serving / Multi-serving pack** | S2 |
| F7 | mg range sliders for **THC, CBD, CBG, CBN, CBC**, for edibles, liquids, topicals and other mg products | S3 |
| C1 | The add-to-cart drawer must **not cover the brown top bar** (logo + business info) on any screen | S4 |
| C2 | The top-right **Cart button must never sit off-screen** on any device | S4 |
| C3 | A global guard so **no element can push past the viewport** in the future | S4 |
| T1 | **Auto-tag "New"** on new products, auto-removed **14 days** later (rotation system) | S5 |
| T2 | A **global inventory Tag Settings page**, linked by a button at the top of the Inventory page | S5 |
| T3 | A **Tags** section in the menu filter holding the tags we set | S6 |
| G1 | **Google Gemini** on the vendor detail page as the FIRST research step, before website/social scraping | S7 |

---

## 2. Recon findings (measured, not assumed)

### 2.1 Filter bar (F1–F4)
- The desktop sidebar is `<aside class="… p-5 …">` in `src/components/menu/InteractiveMenuBrowser.tsx` (~L1407), inside a grid with `lg:grid-cols-[280px_1fr]`. The 280px track is **pinned** by `tests/compliance/shop-layout.test.ts`, so it must not change.
- The controls are rendered by `MenuFilterControls` in `src/components/menu/FilterMobile.tsx`, which is shared by desktop and mobile.
- Measured on the live site at 1599px wide: aside 32–312, content box 238px. The **Vendors** `<details>` had `scrollWidth 277 > clientWidth 238`, and the label rows reached `right=330`, which is **18px past the aside**. The cause is the classic flexbox/grid `min-width:auto` problem:
  - `FilterCheckboxGroup` uses the `grid gap-3` wrapper, then a `label.grid` holding the search **input**. An input has an intrinsic min width (~20 chars), so the grid track grows to about 277px and every row in the group inherits that width.
  - The option label is `truncate`, but its parents have no `min-w-0` in the grid track, so truncation never kicks in. Rows simply widen.
- `FilterSection` summary text has no wrap rule.
- Specials, DOH and Product Type rows (inline in FilterMobile.tsx) use `truncate font-bold`. They are pinned by `classification-facet-plumbing.test.ts` (`{option.label}`, `{option.count}`, `name="classification"`, `checked={active}`), and the class strings are not pinned.
- Strain types: `strainOptions` is built from `item.strainType` plus the HIGH-CBD lane `cbd`. The `?strains=` URL param is **pinned** (legal-policies-theme test, plus the Medical page links `/menu?strains=cbd`), so it must stay the strain-TYPE param.
- `item.strainName` is present on every live item (45/45 measured). Examples: "Raspberry Peach", "White Lobster x Mint Milkshake", "Granddaddy Purple (I)".

### 2.2 Weights (F5) — root cause
- `weightTokenFromLabel()` compares normalized labels against the list `["0.5g", …, "28g", "1oz", "10pk"]`, all written **without a space**.
- Live variant labels, measured from the production /menu payload on 2026-10-12:
  - Labels: `28 g`(10), `1 g`(9), `3.5 g`(6), `50 g`(5), `32.5 g`(5), `3.5 Grams`(5), `28 Grams`(5), `1 Grams`(5).
  - Source: the approve path writes `lotPackageLabel()`, which is `${unit_weight} ${uom}` **with a space**. The vendor-feed path gives "Grams".
  - Result: **zero** labels match, so every count is 0 and the section is empty. Exactly what the owner sees.
- Fix: a pure core (`menu-size-facet-core.ts`) that parses any label using the same grammar as `variantSizeValue` (variant-sort.ts): number + optional space + unit, where the unit can be g/gram(s)/oz/ounce(s)/fl oz/ml/mg/L/pk/each. It produces canonical tokens (`1g`, `3.5g`, `28g`→`1oz`?, see below).
- Weight canonicalisation: `transform.ts parsePackageSize` already shows the store convention, rendering 28 g as "1oz". The facet keeps grams for flower-type categories, matching what shoppers see on cards (cards show the raw label for non-ounce categories). **Decision:** the weight facet value is the canonical **gram** token (`28g`), labelled "28 g (1 oz)" for 28 g, "14 g (½ oz)", "7 g (¼ oz)", "3.5 g (⅛ oz)". This is the standard dispensary ladder, it is honest, and it keeps the 28 g/1 oz duplicates in one bucket.
- **Which categories feed Weights:** only categories whose package weight is the product (flower, popcorn-bud, infused-flower, preroll(s)/blunts/packs, concentrate, cartridge, disposable, rso, trim). Edibles, liquids, tinctures and topicals are **excluded** from Weights: a "50 g" gummy pack or "32.5 g" drink weight is not a shopping axis, and those go to Size (F6).

### 2.3 Sizes (F6)
- Liquid edibles carry `netVolumeMl` (measured 29.5735, which is 1 fl oz) plus variant labels in grams. `weight-display-core` already converts ml to fl oz for display (`ML_PER_FL_OZ = 29.5735`).
- **Beverage size** = `netVolumeMl` when present (authoritative, set by SLICE L3), else a `ml`/`fl oz`/`L` variant label. It is rendered as fl oz, rounded to the nearest 0.5 (1 fl oz, 2 fl oz, 12 fl oz, 16 fl oz…). Only for `edible-liquid` and `tincture`.
- **Solid edible packs** = `servingsPerPack` (or `unitsPerPackage`): 1 gives "Single serving", >1 gives "Multi-serving pack". Measured: all 5 live solid edibles have `servingsPerPack: 10`, so they become Multi-serving. Items with unknown servings are **not** bucketed (never guess).
- The URL param is new: `sizes`. The pill label is "Size".

### 2.4 mg sliders (F7)
- `resolvePackageMg(item)` in `src/lib/menu/cannabinoid-profile-core.ts` already returns verified per-package mg for thc/cbd/cbg/cbn/cbc (it never counts percent rows or "~" estimates). That is the single source of truth to reuse.
- Measured: 8 live items have mg data (5 solid, 3 liquid). CBN, CBG and CBC appear.
- Sliders are data-driven: one appears only when at least one item in the current pool has that cannabinoid in mg. Each is a min–max range slider (dual thumb). The existing % THC/CBD sliders stay untouched.

### 2.5 Cart drawer + header (C1–C3)
- The `Header` (`src/components/site/Header.tsx`) is `sticky top-0 z-50`: black bar, logo, nav, Search/Cart/Menu, plus `SecondaryBar`. The green business bar is `bg-[var(--greenway)]`; the owner calls it the "brown bar" (the brand colour may render brown/olive on some displays). **To confirm with the owner in the report; the fix covers the whole header either way.**
- `addItem()` in `CartProvider.tsx` calls `setIsOpen(true)`. `CartDrawer` is `fixed inset-0 z-[70]` with the aside at `top-0 h-full`, so it **covers the header**.
- Fix: the drawer and backdrop start **below the header**, sized by a CSS variable `--site-header-h` that a tiny ResizeObserver sets from the real header height. This works on every screen size because it is measured, not guessed. If the header is not on the page (checkout pages still render Header; admin has no CartProvider UI), the fallback is `0px`.
- HeaderCartButton: the header's right cluster is `shrink-0` with fixed widths `md:w-[18rem] … 2xl:w-[27rem]`, plus a logo cluster `md:w-[18rem]…`, plus a nav `gap-7` with ~8 links. Between `md` (768) and about 1100px, logo + nav + right cluster exceed the viewport. With the header at `overflow-x-clip`, the right side (Cart) gets **clipped off-screen**. That matches "some screens".
- Fix: give the right cluster `min-w-0`, drop the fixed widths below xl, make the desktop nav shrinkable (`min-w-0`, smaller gap at md/lg, scroll-free wrap rule), and push the global guard into a shared `site-layout-safety` CSS block: `html,body{overflow-x:clip}`, `img,video,svg,canvas{max-width:100%}`, `.min-w-0` defaults for flex children in header/sidebars, and `env(safe-area-inset-*)` padding on fixed elements.

- **S4 RECON CORRECTION (measured with Playwright, supersedes the assumption above):** the "brown bar" is **not** the header. It is the **StoreCard inside the cart drawer** (`bg-[#4a2c18]`, logo + address + hours + phone) at the top of the drawer's scroll column. It had `overflow-hidden` but no `shrink-0`, so flexbox squeezed it as cart lines were added (100px → 42px at 1440 wide, 80px → 51px at 390, **0px with 4 lines at every width**) and cart lines painted over it. Fix shipped: `shrink-0` + `min-h-[5rem] sm:min-h-[6.25rem]`. The drawer-below-header plan was therefore **not** needed and not built.
- **Cart button measured:** completely off-screen from 768 to 1600px (e.g. x=1484–1577 at 1440). Cause: an 869px non-shrinking nav + fixed-width logo and right clusters. Fix shipped: a **Priority+ nav** (`PriorityNav.tsx` + `priority-nav-core.ts`): links that don't fit are hidden (all remain in the ☰ menu), the right cluster is `shrink-0` with no fixed width. Verified on production after deploy: Cart fully visible at all 21 widths 320–2560.

### 2.6 Tags (T1–T3)
- Today no product-tag model exists. The `menu_items` rows are **per menu version** (re-published), so their `created_at` is not "first seen".
- Needs a new table `product_tags` (KEEP class for factory reset, so keep 150 becomes 151, plus the pin update), a `tag_definitions` table, and an auto-rule. "New" = first time a product key (`source_item_id` / POS product key) appeared in a **published** menu. The cron/publish hook stamps `first_published_at` into a `product_first_seen` table; the "New" membership is computed as `now - first_published_at < 14 days`, not stored. So it **cannot drift** and needs no untag job (the Shopify Flow/Mechanic pattern of scheduled removal is replaced by a time-window predicate, which is the more robust enterprise pattern).
- Admin page: `/admin/inventory/tags` (Button on the Inventory header next to "Expiration rules"). There the owner manages tag definitions (name, colour, auto-rule: none / new-for-N-days), sees the auto-rotation window (default 14), and manually applies or removes tags.
- Menu: a "Tags" facet built from tags attached at menu-build time (`item.tags`).

### 2.7 Gemini vendor research (G1)
- Existing: `generateWebSearch()` in `src/lib/ai/provider.ts` already supports **Gemini google_search grounding via the Interactions API** (`AI_GEMINI_API_KEY`, `AI_MODEL_HEAVY=gemini-…`). It returns text plus real source URLs.
- The vendor page has "✨ Research with AI" (name-only drafting, `researchVendorAction`, no web) and "🔎 Research with the crawler".
- Plan: add a **"🔍 Research with Google Gemini (step 1)"** card at the top of the research area. It calls the grounded lookup with a vendor-specific prompt (official site, socials, license #, location, founding story, product lines, awards/press). The result goes in as reviewable **suggestions** (same `persistSuggestion` gate, with sources attached). Discovered website/social URLs pre-fill the crawler forms (step 2).
- Official docs (ai.google.dev/gemini-api/docs/google-search, updated 2026-10-09): REST `POST https://generativelanguage.googleapis.com/v1beta/interactions`, `tools:[{type:"google_search"}]`, `url_citation` annotations. Billing: 5,000 free searches/month, then $14 per 1,000.

---

## 3. Research — enterprise patterns adopted

| Topic | Source | What we adopt |
|---|---|---|
| Filter label overflow | Baymard "Ecommerce filter UI" + Product-list UX 2025 | Never truncate facet values silently; wrap to 2 lines with full text available (title attr). Show counts. Use a search box for long facets (vendors, brands, strains). |
| CSS overflow safety | MDN `min-width:auto` for flex/grid items; `overflow-wrap:anywhere` | `min-w-0` on every flex/grid child in the rail; `[overflow-wrap:anywhere]` + `line-clamp-2` + `title` on labels; inputs `min-w-0 w-full`. |
| Faceted counts | Algolia/Shopify facet model ("disjunctive faceting") | The existing `criteriaWithout(key)` already implements disjunctive counts; new facets follow it. |
| Auto "New" tag | Shopify Flow scheduled tag removal / Mechanic "auto-remove tag X days after it's added" | Replaced by a **time-window predicate** on a first-published timestamp: no scheduler, no missed runs, no drift. |
| Gemini grounding | ai.google.dev Grounding with Google Search | Interactions API + google_search; show cited URLs; staff-accept gate. |

---

## 4. Slices (order, strategy, acceptance)

### S1 — Filter stacking rule + "Strain types" rename + "Strains" facet  (F1–F4)
Strategy:
1. `FilterSection`: summary `min-w-0`, title `break-words [overflow-wrap:anywhere]`, details `min-w-0`.
2. `FilterCheckboxGroup`: wrapper `min-w-0`; search label/input `min-w-0 w-full`; option label `min-w-0` row; text `line-clamp-2 break-words [overflow-wrap:anywhere]` + `title={label}`; drop `truncate`. Keep `capitalize` (vendors in CAPS stay CAPS).
3. Specials / DOH / Product Type inline rows get the same text rule (pinned tokens untouched).
4. Root `MenuFilterControls` wrapper: a `min-w-0` container. The aside gets `min-w-0`.
5. Rename the section title to "Strain types" and the pill label to "Strain type".
6. New `strainNames` facet: state `selectedStrainNames`, URL `strainNames`, criteria + `criteriaWithout` + match + options + pill "Strain" + reset + popstate. Searchable, `initialVisibleCount=5`. Pure helper in `menu-facets-core.ts` (`itemStrainName`, normalise and trim).
Acceptance: no element in the aside has `right > aside.right` at 1024/1280/1600 px; long vendor names wrap to 2 lines; "Strain types" shows; "Strains" lists names with counts; `?strains=cbd` still works.

### S2 — Weights fix + Size facet  (F5–F6)
Strategy: new pure `src/lib/menu/menu-size-facet-core.ts`:
- `weightTokenForLabel(label)` → canonical gram token or null (accepts "3.5 g", "3.5 Grams", "3.5g", "1oz", "1 oz"→28g, "28 g"→28g).
- `WEIGHT_FACET_CATEGORIES`; `itemWeightTokens(item)`; `weightTokenLabel(token)` ("28 g (1 oz)").
- `itemSizeTokens(item)`: liquids → `floz:<n>` from netVolumeMl / ml / fl oz / L labels; solid edibles → `serving:single` / `serving:multi` from servingsPerPack/unitsPerPackage. `sizeTokenLabel(token)` gives "12 fl oz" / "Single serving" / "Multi-serving pack". Sorting is by an ordinal.
- Self-tests are registered in run-pure-selftests.
- InteractiveMenuBrowser: weights use the core; new `selectedSizes` (URL `sizes`); a "Size" section that shows only when options exist.
Acceptance: Weights shows 1 g / 3.5 g / 28 g (1 oz) with live counts; Size shows "1 fl oz" (5 Hiku) and "Multi-serving pack" (5 Bytes); old `?weights=1g` links still work (token unchanged for 1g).

### S3 — mg range sliders (F7)
A pure `menu-mg-facet-core.ts` built on `resolvePackageMg`. Bounds per cannabinoid come from the pool. A dual-thumb range component. URL `mg_thc=min-max`, etc. A section "Cannabinoids (mg)" appears only when mg data exists.

### S4 — Cart drawer below header + header can't overflow + global guard (C1–C3)
`--site-header-h` measured by a ResizeObserver client component placed in Header. The drawer becomes `top: var(--site-header-h)`. The header right cluster gets `min-w-0`; the nav shrinks; fixed widths only at ≥xl. A globals.css safety block. FloatingCartButton gets safe-area insets.

### S5 — Tag system: tables + Tag Settings page + "New" auto-rotation (T1, T2)
Migration `0269_product_tags.sql`: `tag_definitions`, `product_tag_assignments`, `product_first_seen` (all KEEP). The publish hook stamps first-seen. Admin page `/admin/inventory/tags`, plus a button on Inventory. A pure `product-tags-core.ts` (window predicate, default 14 days, configurable).

### S6 — Tags facet on the menu (T3)
Attach `item.tags` at menu build (`withProductTags`). Add a "Tags" FilterSection, URL `tags`. Cache revalidation on tag change.

### S7 — Gemini vendor research (G1)
A "Research with Google Gemini" card (step 1) on the vendor detail page; a server action calling the grounded lookup; suggestions with citations; discovered URLs prefill the crawler/social forms.

---

## 5. Guard rails (re-read before each commit)
- Never change the pinned strings: `lg:grid-cols-[280px_1fr]`, the `?strains=` strain-type param, `HIGH_CBD_VALUE = "cbd"`, `const persistedStrains = parsePersistedList(initialParams.strains)`, `useState<string[]>(persistedStrains)`, the classification section tokens, and `pagingStatusLabel(pagedGroups)`.
- No `Date.now()` in render; no `.limit(>=1000)`; new tables are KEEP (update the factory-reset pins 150→N).
- Pure logic goes in `*-core.ts` with `__run…Tests` registered in run-pure-selftests.
- Every commit: scoped tsc + eslint on touched files + the relevant vitest.

---

## 6. Slice log
| Slice | Status | Commit/PR | Notes |
|---|---|---|---|
| S1 | done | branch r49-menu-filters | Stacking rule (min-w-0 / minmax(0,1fr) / overflow-wrap:anywhere, no truncation); "Strain types" rename; new Strains facet (?strainNames=, 32 cultivars on live menu); menu-facets-core 18 selftests |
| S2 | done | branch r49-menu-filters | Weights fixed via shared parseWeightLabelGrams (live: 1 g ×14, 3.5 g ⅛ oz ×11, 28 g 1 oz ×15); Size facet ?sizes= (live: 1 fl oz beverage ×5, Multi-serving pack ×5); legacy ?weights=1oz→28g; menu-size-facet-core 39 selftests |
| S3 | done | PR #1340 | menu-mg-facet-core (33 selftests); dual-thumb FilterRangeSlider (W3C APG multi-thumb); "Cannabinoids (mg)" section; URL mg_thc/mg_cbd/mg_cbg/mg_cbn/mg_cbc=min-max; pills, reset, back/forward. Bounds anchored at 0 (raise min = "at least N mg"). Live: thc 0–110, cbd 0–490, cbg 0–300, cbn 0–210, cbc 0–95 |
| S4 | done | PR #1340 + #1341 | Cart StoreCard shrink-0 (true "brown bar"); Priority+ header nav (priority-nav-core 14 selftests); right cluster shrink-0 no fixed width; globals guard body{overflow-x:clip}, iframe/embed/object max-width, overflow-wrap on landmarks; floating cart safe-area insets; #1341 product-card price row min-w-0+flex-wrap (clipped at 1024–1099px). Production-measured: Cart visible 320–2560 |
| S5 | pending | | |
| S6 | pending | | |
| S7 | pending | | |

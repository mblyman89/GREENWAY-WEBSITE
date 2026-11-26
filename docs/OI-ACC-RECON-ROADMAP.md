# OI-ACC — Other Inventory types, editable accessory cards, per-type detail pages, merch filter fix

Recon + roadmap, round 1 (no code changed). Branch `oi-acc/recon`.

## Owner request (verbatim, rule 1)

> I need your help fixing the other inventory page so that it accepts all of the types, and any characters as well. right now the only blocker is this character "/", but there may be more than just that one. please allow us to add any inventory items with whatever characters we need included. the next thing I want to do is change how the customer facing website manages accessories. we have several place holder product cards for the accessories. I want to now be able to edit the cards so I can change the image and text on the card. we will need to add a new website editor page to the website dropdown menu in the back office. it does not need to be the fancy heavy weight editors from the other page editors, just a simple version like the one used for the merch product cards, please copy how it does it. the next thing I want, is to create a new product card for every non cannabis product type except for merch, that one has its own home. I want to be able to add and remove types from the other inventory page as well as the website editor, so they are linked basically. if one page makes a new type, it shows up on the other page. I want to then move all of the other inventory that is sitting at the very bottom of the shop menu page into the product cards for their respective types. so a new other inventory detail page will be needed too. I do not want customers to be able to checkout with these items yet, because we just have prices available right now, with out descriptions. so there is no way to know what is what, I just want customers to be able to see we have a stock of bongs or whatever and the price range for that type. eventually I will turn it on so customers can add them to their cart. so please add the ability to add them to the cart, but give me a toggle that holds it off until i turn it on. one last odd behavior, on the customer facing website, in the filters bar, when I check greenway merch's box, it shows the merch product cards as it should. but if I add another type, the merch product cards disappear. can you look into that and fix it as well. I think for this first round, just clone the repo, read agents.md, it is your standing rules to follow, then read and recon the code. document what you find and create for yourself a roadmap strategy to enhance the system with this new look and behavior. please return back with a summary report of all that you have found and all that is needed to be done to accomplish this feature set. we are on a budget, so keep that in mind too please, be conservative and save tokens. follow the standing rules. thank you.

## Findings (verified in code)

### F1 — Why "/" (and more) is refused
- `src/lib/naming/convention-core.ts:33` `DISALLOWED_NAME_CHARS = /[,/&!#$@"|\u0000-\u001f]/` is the **CCRS cannabis** product-name rule (CCRS Product.Name is a CSV join key, 75-char cap).
- Other Inventory reuses it: `validateNonCannabisName` (`src/lib/naming/noncannabis-core.ts:107`) also requires the name to **start with a letter or number**. Called from the intake form (`NonCannabisIntakeForm.tsx:41`), create (`store.ts:224`) and invoice minting (`store.ts:252`).
- **Six of the built-in types cannot be saved with an auto-built name**, because their labels contain "/": Bowl / Slide, Banger / Nail, Wraps / Cones, Coil / Atomizer, Storage / Jar, Apparel / Merch. (Measured by running the real core, `scratch/p.mts`.)
- These characters are refused as well: `, & ! # $ @ " |`. A leading `(` is refused too. Examples: `RAW 1 1/4`, `Zig-Zag & Co`, `Bong #2`.
- **Why it is safe to relax:** Other Inventory never reaches CCRS. `ccrs-sales.ts:338-341` leaves out `nc-<uuid>` lines, and `ccrs-batch.ts:514-516` skips `NonCannabis` returns. The CCRS rule should stay exactly as it is for cannabis. Other Inventory only needs to refuse control characters and empty names (we keep a length cap for labels and receipts).
- The DB column `noncannabis_products.type` is free text (0076 says "Free text allowed for forward-compat"). There is no CHECK, so **no migration is needed for F1**.

### F2 — Types are a hard-coded list
- `NONCANNABIS_TYPES` (22 entries, `noncannabis-core.ts:30`) is a TS constant that drives the intake `<Select>`, the invoice-builder `<Select>`, the SKU prefix and the label. There is no table, so a type cannot be added or removed at runtime.
- The register maps a type to its tax/menu category with `ncRegisterCategory` (`pos-catalog-core.ts:46`): `apparel` → `merch`, and everything else → `accessories`.

### F3 — The accessory cards are static placeholders
- The 14 cards (`accessorySectionCards`, `InteractiveMenuBrowser.tsx:153-168`) have hard-coded text, and their images are in `public/accessories/*.webp`. Their keys (bongs, pipes, papers, bowl-pieces, …) **do not match** the inventory type values (bong, pipe, papers, bowl, …). Some cards (sherlocks, chillums, dab-tools) have no type, and some types (torch, ashtray, cleaning, charger, coil, storage, wraps, carb_cap, banger) have no card.
- A card is not a link and shows no stock or price.

### F4 — The merch card editor to copy
- There is one content block, `merch.ad` (`src/lib/merch/merch-ad-core.ts`). It stores JSON that is normalised/serialised by a pure core with `__runMerchAdTests`.
- The editor is `PublishPanel.tsx:145-210`: each card has a label, text and image (`ContentImageField` + media library), with up/down/remove/add buttons and a preview.
- The actions are `src/app/admin/merch-studio/ad-actions.ts`: permission `content.edit`, `saveContentDraft` / `publishContentBlock` (revisions), `recordAudit`, `revalidatePath('/menu')`. The seed is in `content-blocks-seed.ts:197`.
- The nav entry goes in the `Website` group, subgroup `Cannabis`, in `src/components/admin/admin-nav-data.ts:141-162`.

### F5 — "Also in store" list at the bottom of the shop
- `src/components/menu/InStoreGoods.tsx` (rendered in `ShopPage.tsx:217` in its own Suspense) lists up to 48 active, in-stock items as plain name/brand/price tiles. It is fed by `readNcCatalogForRegister` → `toInStoreCards` (paged, active only, and never shows cost/qty/SKU).

### F6 — Cart / checkout today
- `POST /api/orders` reprices every line against the **published cannabis menu** (`order-pricing.ts:152-175`). An `nc-…` line would be refused as "no longer available on the current menu", so Other Inventory cannot be ordered online today.
- The tax model already supports non-cannabis: `isNonCannabisCategory` (`order-pricing-core.ts:42-51`) charges sales tax only, with no excise and no price floor.
- Turning on online carting therefore needs: a pricing branch for `nc-` lines (price read from `noncannabis_products`), a stock check, a pickup→register completion path that decrements NC stock (`applyNcDelta`) and keeps those lines out of CCRS, and a server-side switch.

### F7 — Merch filter bug (root cause)
- `InteractiveMenuBrowser.tsx:1144`: `showMerchAds = merchAdCards.length && selectedCategories.length === 1 && selectedCategories[0] === "merch"`.
- Once a second category is ticked, `showMerchAds` is false. The grid then renders product groups, and there are no merch *products* on the cannabis shop (R71 S4), so the cards vanish.
- Accessories already handle this with `showAccessoryBottom` (`:1170-1172`). Merch has no equivalent.
- `showEmptyState` (`:1176`) can also wrongly show "No products match" when you pick merch together with a category that has nothing in it.
- **Fix:** add `showMerchBottom` (merch selected with others), which renders the merch ad section below the products like the accessories one. It should also count toward `showEmptyState`. This is a client-only change: no DB and no CCRS.

## Roadmap (6 slices, rule 5; each: pure core + `__run…Tests` → tsc/eslint/build → PR → rebase-merge)

| # | Slice | Touches | Migration |
|---|---|---|---|
| S1 | **Merch filter fix (F7)**, the smallest and lowest risk; ship it first. Move the show/hide decision into a pure `menu-collections-core.ts` with tests (merch alone, merch + other, merch + empty category, accessories mix). | InteractiveMenuBrowser | none |
| S2 | **Any character (F1).** Add `validateOtherInventoryName` in `noncannabis-core`: refuse only empty names, control characters and names over the length cap; allow `/ & # , " ! @ $ \| (`. Switch the 3 call sites. Keep `convention-core` (CCRS) unchanged, and add a test that pins the cannabis rule as still strict. Check that label, receipt and CSV exports quote their fields (Label Studio, `sale-correction-export`). | naming core, store, intake form | none |
| S3 | **Shared type registry (F2).** New table `noncannabis_types` (`value` PK slug, `label` free text, `sku_prefix`, `menu_group` accessories/merch/hidden, `sort`, `active`, and the card fields `card_label`, `card_text`, `card_image`, timestamps). Seed it from the 22 current types (an idempotent upsert). Full grants and a PG check (rule 15), plus a db-contract regen. The pure core takes care of the slug, the unique SKU prefix and the rule "cannot remove a type that still has stock (archive it instead)". The Other Inventory page gets a small "Types" panel (add/rename/archive). The intake and invoice selects read the table, with `NONCANNABIS_TYPES` as the fallback when the read fails. `ncRegisterCategory` reads `menu_group`. | new migration 0371, store, forms, pos-catalog-core | **yes, owner applies manually** |
| S4 | **"Accessory Cards" website editor (F3/F4).** A new page `/admin/content/accessory-cards` in Website → Cannabis, built as a copy of the merch PublishPanel cards block: picture (ContentImageField), name, short text, show/hide, order, and add/remove type. **The page edits the same `noncannabis_types` rows**, so a type added on either page appears on both (the owner's "linked"). Draft→publish: card fields are kept as `draft_*` / `published_*` columns (or one `content_blocks` row per type). Recommendation: keep the columns on the table; it is simpler and needs one read. Every save is audited, and publishing revalidates `/menu`. The 14 placeholder texts and images are carried into the seed, so nothing visible changes on day one. | new admin page, actions, nav entry | (in 0371) |
| S5 | **Per-type cards + detail page (F5).** The shop's accessory cards are built from published, non-merch types that have at least one active, in-stock item. Each card shows "In stock" and a **price range** (min–max of the shelf price, in cents → $), and links to `/menu/accessories/[type]`. The new detail page lists the items of that type (name, brand, price; never cost/qty/SKU), reads only that type's rows, and streams in Suspense (rule 18). Remove `InStoreGoods` from the bottom of the shop. Merch keeps its own home (`apparel` → merch ad). Check the `[category]` route's `isRoutableCategorySlug`/static params so the new route does not clash. | InteractiveMenuBrowser, ShopPage, new route, a pure core for the price range | none |
| S6 | **Add-to-cart behind a toggle (F6).** Add a setting `online_other_inventory_enabled` (site_settings, default **OFF**), shown on the Accessory Cards page. When it is OFF, no Add button is shown and `/api/orders` refuses `nc-` lines on the server, so the switch cannot be bypassed. When it is ON, the detail page has Add buttons, and the reprice branch reads the price and stock from `noncannabis_products` (non-cannabis tax). Pickup completion decrements NC stock and keeps the lines out of CCRS. The existing guards for this are reused (`isNonCannabisProductId`, `applyNcDelta`, ccrs-sales exclusion), and tests prove the lines never reach Sale.csv. | order-pricing, orders route, sync-store, cart | maybe (setting row only) |

### CCRS / compliance notes
- S2 changes **only** the non-cannabis validator. The CCRS bible is not touched, because no CCRS file field changes. S6 relies on the existing `nc-` exclusions from Sale.csv. Following the mandatory first step, I will read `docs/ccrs-bible/00-INDEX.md` → `09` before S6 and add a test pinned to the exclusion.
- Shop advertising: the accessory cards show non-cannabis goods only, with no cannabis claims. The merch disclaimer text stays as it is.

### Open decisions for the owner
1. **Card ↔ type mapping.** The current cards and types don't line up one-to-one (F3). My proposal: one card per type, and keep the placeholder copy where the names match (bong→Bongs, pipe→Pipes, bowl→Bowl Pieces, …). Sherlocks, Chillums and Dab Tools would become new types. Each would be hidden until it has stock, or should they always show?
2. Should a type card with **zero stock** be hidden or shown as "Out of stock"? I propose hidden.
3. **Removing a type** that still has products: block it, or archive it (hide it everywhere, keep its history)? I propose archive.

## Status (round 2)

- S1 merged (#1920): merch adverts stay at the bottom when other types are also ticked (`menu-collections-core`).
- S2: Other Inventory names accept any printable character; only empty, control characters and >75 chars are refused. The CCRS cannabis name rule is unchanged (Other Inventory never goes to CCRS).
- S3: `noncannabis_types` registry (migration 0371), seeded with the 22 built-ins plus sherlock, chillum, dab tool. Add/Archive/Restore on Other Inventory and on Website > Accessory Cards; both read the same table. Archive, never delete.
- S4: Website > Accessory Cards editor (picture, name, text, order; draft then publish), copied from the Merch Studio card editor.
- S5: shop accessory cards built from published live non-merch types WITH stock (zero stock hidden), showing the price range; each links to `/accessories/<type>` (name, brand, price only). The old "Also in store" list was removed.
- S6: Add-to-cart on `/accessories/<type>` held behind the site_settings toggle `online_other_inventory_enabled` (OFF by default; switch on Accessory Cards). Checkout re-checks the toggle, shelf price and stock server-side; `nc-` keys keep lines off CCRS Sale.csv; pickup completion moves On hand (sale-decrement).

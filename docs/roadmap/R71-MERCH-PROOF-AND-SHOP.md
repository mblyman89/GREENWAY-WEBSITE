# R71 — Merch Studio: Proof & Export (Slice 3) and Publish & Ads (Slice 4)

Follows `docs/roadmap/R70-MERCH-STUDIO.md` (Slices 1–2). The seller of every item is **Greenway Merchandising LLC (dba Greenway Glass & Goods)**, never the cannabis licensee.

## 1. Owner request (verbatim)

> "Thank you! So the strategy is to keep everything on the main site, with a distinctly different check out process on a subdomain? I want the shopping experience to be seamless for the customer, in fact, they should have no idea they are on a different domain or platform or system or whatever. We take precautions to protect ourselves, while at the same time providing a frictionless shopping experience. Is there any other strategic ways of setting this up for best results and successful outcomes. This merch branch of sales will be tiny. To put it into perspective, I sell about 200k of cannabis per month and at most 3k of non cannabis paraphernalia. So merch will probably be less than that. With a different company, different ein, different ubi, subdomain identity, different bank account, etc. can we do this as envisioned reliably and sustainably? Or are we still at high risk of cc shut down? I still want to build this as fed regulation changes on cannabis are starting to change become more real. In the summary report, please break this down more for me. Let's jump right in to slice 3 and slice 4. … Go above and beyond for me, add as much additional value as you can to this new feature system. … Put yourself in the creative genius shoes and ask yourself, what do I need to design and create awesome apparel I can sell to my customers. Then document all those choices and build it that way, with purpose."

## 2. Slice 3 — Proof & Export (what a prepress desk would hand the printer)

New studio tab **🖨️ Proof & Export**, between Design and Artwork Check.

### 2.1 Design choices (and why)

| Choice | Why (source) |
|---|---|
| **One PNG per Printful *file type*, not per studio placement.** Full-front + left-chest on DTG become ONE `front` file. | In Printful's catalog the DTG left-chest file id `default` has type `front` — Printful prints them as one file. Sending two files of the same type is impossible. (Printful catalog `files[]`, verified for all 11 blanks.) |
| The largest frame in a merged group owns the area; smaller frames are offset by their real garment position. Art outside the owner's area is a **blocker**. | Printful crops anything outside the print area (`limit_to_print_area`). Catches the classic "left-chest logo sitting above the front print area" mistake. |
| **Transparent PNG, sRGB, 300 DPI**, with an `sRGB` chunk and a `pHYs` chunk written into the file. | Printful DTG file guide: PNG with transparent background (a JPG prints a white box), sRGB IEC61966-2.1, ≥150 DPI, best not above 300. The pHYs chunk makes Photoshop / Printful read the true print size. |
| Trimmed to the art (+0.05″ pad; text gets +0.12 em for italic/script overhang) and placed with Printful's `position` object `{area_width, area_height, width, height, top, left}`. | Printful Orders/Mockup API position object. Small files upload faster; position keeps the exact placement. |
| DPI steps down only when the file would exceed **16,777,216 px** (12×16″ → 295 DPI) and says so. | iOS Safari / WebKit canvas cap. Still ~2× Printful's 150 DPI minimum. |
| **Rendered in the browser**, not on the server. | The browser already has the exact fonts (next/font + owner uploads) and the artwork (IndexedDB). Fonts are embedded into the SVG as data: URLs before rasterising, so the PNG uses the real typeface. Verified in Chromium: `@font-face` embedded, PNG chunks `IHDR, sRGB, pHYs, IDAT`, 300 DPI. |
| Alpha measured after render; **> 18 % semi-transparent inked pixels warns** on DTG/DTF; any element below 100 % opacity warns. | Printful "Transparency in DTG printing": semi-transparent areas print with gaps, worst on dark garments. |
| Embroidery threads go on the item `options` using the catalog's **real** option id (`thread_colors_chest_left`, `thread_colors`, …). When the product lists none (e.g. Yupoong 6089M), the file gets `auto_thread_color` + the thread codes in `notes`. `embroidery_type` only when listed. | Never invent an option id (standing rule). Option ids generated from the public catalog (`PRINTFUL_OPTION_IDS`). |
| **ZIP** = every PNG + `README.txt` (sizes, positions, threads) + `proof-sheet.html` + `design.json` backup. STORE-only zip writer (PNG is already compressed), no new dependency. | Everything a human printer (or a second POD vendor) needs, in one file. |
| **Proof sheet** (printable, letter): each file on the garment colour, art size, *distance below the neckline / back neck seam / above the brim*, offset from centre, threads, file name, check counts, the sample checklist and an "Approved for sale by / date" line. | What you hold next to the physical sample with a ruler. |
| **Sample checklist** (placement, size, colour in daylight, fit, labels show Greenway Glass & Goods, wash test, hand-feel, stitch quality, thread match, ribbing stretch, photograph the sample). Ticks saved per design. | Printful: order a sample before selling (20 % off samples). Apparel returns are dominated by fit; wash durability drives repeat buys. |
| **Photo mockups** via Printful's mockup generator (up to 6 colours per run). Files go to a **private** bucket (`merch-files`, migration 0281) and Printful gets 1-hour signed links. | Printful API `POST /mockup-generator/create-task/{id}` + `GET /mockup-generator/task`. Rate limit 2/min new stores, 10/min established — the UI says so. Fails closed without `PRINTFUL_API_TOKEN`. |
| **Order-item JSON preview** (`files[]` + `options[]`) — exactly what Slice 4 sends. | No surprises at order time. |

### 2.2 Files

- `src/lib/merch-studio/print-export-core.ts` — pure planning, Printful mapping, PNG tagging, CRC-32, zip, proof sheet, mockup body, variants. `__runPrintExportTests()` (102 checks) in `run-pure-selftests.ts` and vitest.
- `src/components/admin/merch-studio/print-export.tsx` — browser renderer (React → SVG → fonts embedded → canvas → tagged PNG), downloads, signed upload.
- `src/components/admin/merch-studio/ProofPanel.tsx` — the tab.
- `src/app/admin/merch-studio/proof-actions.ts` — signed upload tokens, mockup task create/poll (staff `content.edit`).
- `src/lib/merch-studio/printful-client.ts` — server-only Printful v1 client (Bearer + optional `X-PF-Store-Id`, 20 s timeout, fails closed).
- `supabase/migrations/0281_merch_print_files_bucket.sql` (+ rollback) — private `merch-files` bucket, PNG only, 50 MB cap.
- Generator (`scripts/merch/refresh-printful-catalog.py`) now also emits `PRINTFUL_FILE_TYPES`, `PRINTFUL_OPTION_IDS`, `PRINTFUL_VARIANTS` (1,368 variant ids with price + stock). Existing colours/sizes unchanged byte-for-byte.

### 2.3 Environment (only needed for mockups)

- `PRINTFUL_API_TOKEN` — private token from **Greenway Merchandising LLC's** Printful account.
- `PRINTFUL_STORE_ID` — only if the token is account-level.

## 3. Strategy research notes (October 2026) — for the owner and the attorney

These are research notes, not legal advice.

**Card networks and processors**

- **Stripe** restricted list includes "Cannabis products; Cannabis dispensaries and related businesses". Stripe's FAQ allows a business that removed all unsupported items to keep processing for the rest. (support.stripe.com prohibited/restricted FAQ.)
- **Transaction laundering** (LegitScript): "the processing of payments through a merchant account underwritten by a payment provider on behalf of a different merchant, which is not known to, approved by or underwritten by the payment provider." This is what a *hidden* merchant looks like to a network — and it carries Visa/Mastercard fines. https://www.legitscript.com/transaction-laundering
- **Visa Core Rules (18 Apr 2026) §5.8.4.1 Merchant Website Requirements:** customer-service contact; the Merchant Outlet country "clearly and prominently" on the checkout screen or within the checkout sequence ("A link to a separate web page does not meet this requirement"); address for cardholder correspondence; multiple-shipment policy.
- **Visa VIRP / Mastercard MMP** require acquirers to monitor merchant websites on an ongoing basis, **including related domains**. https://ballerine.com/blog/mmp-virp-merchant-monitoring
- **Visa and Mastercard have not changed their cannabis prohibitions** after medical rescheduling (HLG, https://www.cannabisindustrylawyer.com/credit-card-processing).

**Federal status**

- DEA final rule (April 22, 2026, effective April 28, 2026) moved FDA-approved and **state-medical-licensed** marijuana to Schedule III. Adult-use: 11-day hearing June–July 2026, ALJ recommendation pending; recreational marijuana is still Schedule I. (Gibson Dunn, "DEA Downschedules State Medical Marijuana to Schedule III…"; Morgan Lewis, Sept 2026.)

**Washington LCB (Cannabis Advertising FAQ, https://lcb.wa.gov/enforcement/cannabis_advertising_faqs)**

- "A licensee is not permitted to sell t-shirts from their retail store or business website. A separate business is necessary to sell items beyond what is allowed under the law."
- "May we sell t-shirts hoodies and other soft goods from our 'parent' website…? You may sell the soft goods from the parent website. The paraphernalia must be sold from the licensed location."
- "Could a separate entity (separate LLC, operating close-by) sell branded merchandise? Yes."
- Giveaways / distribution of branded merchandise are banned (WAC 314-55-155(4)).
- **These answers pull in different directions — ask the attorney which governs a merch shop linked from the licensee's site.**

**Existing site conflict found:** `src/lib/merch/merch-catalog.ts` (Logo Tee, Hoodies, Hat, Beanie, Socks, Lanyard) is sold through the **cannabis** menu, cart and pickup checkout. That matches the FAQ's "licensee is not permitted to sell t-shirts from their … business website". Recommendation was to remove it. **Done in Slice 4 (§4.4)** after the owner's direction that no product details may reach the main site.

## 4. Slice 4 — Publish & Ads (strategy change: separate domain + pure redirect ad)

### 4.1 Owner direction (verbatim, overrides the subdomain plan)

> "We can design and create everything in our back office studio. The publish step needs to publish to a new domain url altogether, not a subdomain. The product cards on the customer facing website will be advertisements that redirect to the merch site. Then we can use stripe. I really want to use credit cards. … So long as no cannabis sales are kept separate. No product details can reach the main site. That's the trick. No data at all. A pure redirect button, that's it. We will build the merch site later. Please continue, make any adjustments to the current build and roadmap strategy."

The R70 §4 "subdomain cart" plan and the R71 §1 "seamless, they should have no idea they are on a different domain" goal are **superseded**. The customer now *knowingly* leaves the cannabis site for a separately branded shop, which also matches the Visa §5.8.4.1 and transaction-laundering points in §3 (no hidden merchant).

### 4.2 What Slice 4 ships

The new studio tab is **🚀 Publish & Ads**, the last tab, and is also reachable at `/admin/merch-studio?tab=publish`. It does two separate jobs.

**A. The Greenway Goods redirect ad, on the cannabis site.** It is one content block, `merch.ad`, handled with the normal draft → publish flow and revision history. Each save is audited (`content.draft` / `content.publish`).

The ad renders at the bottom of the shop, after the product grid, on `/menu` and every `/menu/[category]` page (both render `ShopPage`). Publishing revalidates `/menu` and the `/menu/[category]` pattern (not the menu data cache).

It is **off by default** (seed value `""`), so deploying this changes nothing on the live site.

The block can only hold:
- an on/off switch
- **one** https address on the separate domain
- an eyebrow, heading, intro and button label
- up to 4 pictures with short captions

**B. The listing package, for the separate merch site (Slice 5).** The owner picks a saved design, colours and sizes, and a retail price (optionally passing on Printful's bigger-size upcharge). Then they download `greenway-goods-<handle>-<date>.json`, which contains:
- the product title, handle, description and blank
- print files with the same filenames as the Proof & Export ZIP and their exact Printful `position`
- every colour × size variant, with its Printful variant id, stock flag, Printful estimate, retail price, Stripe fee, profit and margin
- a Printful sync-product body and the order-item draft
- the seller and payments notes

The file is **built in the browser and downloaded**. It is never written to the cannabis database and never rendered by the cannabis site.

### 4.3 Design choices (and why)

| Choice | Why |
|---|---|
| The ad holds **no product data**. Prices, `$`, `12.34`, "add to cart", "buy now", "checkout", "in stock", "SKU" and size lists are **blockers**. Publishing is refused while the ad is on and has a blocker, and the public renderer (`resolveMerchAd`) re-checks and renders nothing if anything slips through. | Owner rule: "No product details can reach the main site… A pure redirect button." Defence in depth: the editor, the server action and the renderer each enforce it. |
| **One destination address.** It must be https, with no `?query`, no `#fragment`, no user:password, no port, no IP or localhost, and never `greenwaymarijuana.com` or the site's own host. There are no per-product links. | Per-product deep links would carry product identity across. A query string could carry tracking data. |
| Links use `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`. | The merch site receives **no referrer and no customer data** from the cannabis site. |
| Clicks are counted only in this site's own click analytics (`data-gw-place="other"`, slot `greenway-goods`). Nothing is shared with the merch site. | Lets the owner measure the ad without passing data between the businesses. `other` is used because placements are DB-constrained, so no migration is needed. |
| Pictures are plain `<img>`: a Media Library path or an https URL. | They may live on the merch domain. They must not be proxied through the cannabis site's image optimizer, and the merch domain must not be added to `next/image` remotePatterns. |
| A disclosure line under the ad: "Apparel is sold and shipped by Greenway Merchandising LLC (dba Greenway Glass & Goods) on its own website, {host}. It is not sold, delivered or rung up by this cannabis store." | Transparency for customers and processors (no hidden merchant). Ask the attorney to approve the exact wording. |
| The ad is **one section**, not cards mixed into the product grid. | Keeps the menu grid 100 % cannabis inventory and avoids anything that looks like a merch listing inside the cannabis menu. The owner said "product cards… will be advertisements". The tiles are picture links, but they never carry product details. |
| The "Greenway Merch" nav links (desktop and mobile) were removed. `/menu/merch` (the taxonomy route) stays. | The ad is hidden by default, so a nav link to it could point at nothing. The `merch` category is part of the POS, tax, COA and Leafly taxonomy, and its route is prerendered and pinned by Slice H tests. |
| **Listing package as a downloaded file**, not "create the Printful product" from the studio. | Printful's sync-product variant `files` take `{type, url}` only, with no `position` (position exists only on order items). A product created that way prints at Printful's default position, not where it was designed. The package carries `printfulOrderItem` with exact positions; the merch site orders with it plus the variant id. |
| Package costs use the same `basePriceCents` + `unitEconomics` as the Fulfillment tab. A variant that loses money is a blocker; under 30 % margin is a warning; more than 100 variants is a blocker (Printful cap). | Same numbers everywhere. Printful's order estimate stays the final word, as the file itself says. |
| No migration, no new tables, no Printful or Stripe calls. | "We will build the merch site later." Slice 4 hands off cleanly without committing the cannabis database to merch data. |

### 4.4 Old in-menu merch removed (the LCB conflict from §3)

- **Deleted:** `src/lib/merch/merch-catalog.ts`, `src/components/merch/MerchProductCard.tsx`, `src/components/merch/MerchDetailPanel.tsx`.
- **`InteractiveMenuBrowser`:** the "Greenway Merch" category fill, the lone-merch section, the bottom merch section and the toolbar title branch are gone. The accessories sections are unchanged.
- **Product page (`/menu/products/[id]`):**
  - Only live POS items resolve, so the old static `merch-*` ids now **404**.
  - The static merch photo, merch detail panel and merch related rail are gone.
  - `isMerchItem` and the "Greenway Merch" chip remain for real POS items in the `merch` category (kept as-is; pinned by tests).
- **Not changed:** the `merch` POS category, its tax, COA and Leafly mapping, the cart label and `/menu/merch`.
- **Not verified (flag):** whether any **live POS products** are categorised `merch`. If any are, they still appear on the public menu through `loadLiveMenuItemsCached` and can be bought through the cannabis cart. Check Inventory → Products filtered by category "Greenway Merch" and deactivate or re-categorise them.

### 4.5 Files

- **New**
  - `src/lib/merch/merch-ad-core.ts` (pure; 36 checks)
  - `src/components/merch/MerchRedirectAd.tsx` (server wrapper)
  - `src/components/merch/MerchRedirectAdView.tsx` (shared markup, also used by the studio preview)
  - `src/lib/merch-studio/listing-package-core.ts` (pure; 29 checks)
  - `src/components/admin/merch-studio/PublishPanel.tsx`
  - `src/app/admin/merch-studio/ad-actions.ts`
- **Changed**
  - `ShopPage.tsx` renders `<MerchRedirectAd />` after the products section, inside `ShopContent`. The pinned destructure and `menuItems` lines are untouched.
  - The content seed adds `merch.ad` (page `menu`).
  - `content-reachability-core` gains the `MERCH_STUDIO` editor and the `merch.ad` owner.
  - `edit-target-core` routes `merch.*` to `/admin/merch-studio?tab=publish`.
  - The studio page reads `?tab=` and the saved/published/warning flags.
  - `MerchStudio` gains `initialTab` and the publish tab.
  - Fulfillment pipeline: `SHIPPED_SLICE = 4`; sell = Slice 5; order, confirm and ship = Slice 6.
- **Tests**
  - `merch-studio-core.test.ts` adds both cores and the roadmap pins. Both cores are also registered in `run-pure-selftests.ts`.
  - `menu-render-cap` asserts the merch catalog is gone.
  - `r33-website-facts` pins the green redirect button.
  - `shop-layout` changes from 5 to 3 four-up grids (the two merch grids were removed).

### 4.6 Roadmap (adjusted)

**Slice 5: the Greenway Goods website.** It gets its own domain, owned by the LLC (not a subdomain), a separate repo and Vercel project, and ideally its own Supabase project, so the cannabis database never holds merch orders. It covers:
- importing listing packages
- shared design and art storage
- product pages with mockups
- a cart
- **Stripe Checkout under Greenway Merchandising LLC**, with its own descriptor, bank account and Stripe Tax or WA sales tax
- Visa §5.8.4.1 page requirements: customer-service contact, the merchant country shown in the checkout flow, address, and shipping, returns and refund policies
- LLC terms and privacy
- age-neutral, cannabis-free content: no cannabis words or images and no link back to the menu from checkout pages

**Slice 6: fulfilment.** It covers:
- the Stripe `checkout.session.completed` webhook creating a Printful **draft** order (variant + files + positions from the package)
- an Orders screen with a human "Confirm" click
- Printful webhooks for shipped and tracking events, with customer emails
- refunds and reprints
- monthly reporting for the LLC's books

## 5. Refreshing the catalog

Unchanged; see R70 §5.

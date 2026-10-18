# R73 - Merch in the back office (greenwaymerch.com)

## Owner request (verbatim)

> Thank you! I would really like to have merch orders to be managed from Greenway Marijuana back office, with its table or whatever to be the last table on that page. If that’s what you meant by “order desk at /admin/orders” then great. If not, I want it to be on that page and the table  should be identical to the other two on there. I open the detail page and then manage it from there, just like how it’s done with our online orders and Leafly online orders. I want to change the behavior of the website dropdown. I want two options, “Cannabis”, and, “Merchandise”. The cannabis one when clicked will have everything currently listed in it. The other will have the product ad card editor, a product card editor, a home page banner editor, a catalog banner editor, a customer email editor for orders, and a header/ footer editor. All just copy and pasted from the cannabis site so it’s a quick and easy addition to the new domain site. Plus any seo related work that would make it highly visible online. Also, for all the website editors, creative studio, and merch studio, I want all of the very top of the page helpers and such that follow me down and up as I pan up and down to be moved to a new helpers page. Using the various custom design studios is difficult due to the helpers following you everywhere you go. I want the first banner to be in the spot it would be on the customer facing website and then follow me when the setting is clicked. Then I want to enhance the brand editor, so that it can build and save not just banners, but the various cards too, as well as a custom size builder for blogs and newsletters and other such marketing content. I also want a new page to manage all of the merch inventory in a enterprise grade way. We create apparel in the merch studio, save it, publish it, it shows up on the public website, at the same time it’s added to the merch inventory management page in the inventory drop down menu. The reports page should have a new tab for merch data, everything merch related including website traffic stats, sales stats for merch, tax info. I want to make this order platform exclusive to Washington state for easy sales reasons. Unless printful manages all sales taxes, I only want to deal with Washington tax authorities for now. In the summary results, please let me know if I need to do anything in resend and supabase, and if it costs more to do these things and if so, how much more. I’m on pro for all three. I have orders@, and contact@ set up in Google workspace and the domain has been registered and whitelisted for spam purposes. Please break all of this up into manageable slices so you don’t drift. Don’t rebuild what you can reuse. Keep going above and beyond for me as you have been doing. Research the internet if you need enterprise grade solutions and documentation. Do minimal testing to ensure the code isn’t broken, and that it doesn’t break the existing code. Try and save as much credit and money as possible. Follow the standing rules and never guess, never assume. Thank you!

## Facts verified before planning (no guesses)

- **Printful and sales tax** (help.printful.com): Printful charges the *seller* sales tax on Printful's own charges in most states, Washington included, unless a resale certificate is on file (Billing > Tax information). It does **not** collect or remit sales tax on the seller's sales to customers. So Greenway Merchandising LLC collects WA sales tax at checkout and files it with WA DOR.
- **Stripe hosted Checkout** cannot restrict the shipping address to one state. `shipping_address_collection.allowed_countries` is country-only. Server-side shipping validation exists only for the Elements custom checkout. So "Washington only" has to be enforced:
  - in the cart, before checkout, and
  - in the webhook, after payment (a non-WA order is refused and refunded).
- **WA DOR rate lookup**: free, no key. `https://webgis.dor.wa.gov/webapi/AddressRates.aspx?output=xml&addr=&city=&zip=` returns the location code, the local rate and the state rate. These are destination-based (what the LLC reports by location code).
- **Printful v1 OpenAPI** (developers.printful.com/docs/openapi.json):
  - `GET /orders?limit<=100&offset` returns `paging.total`.
  - `GET /orders/{id|@external_id}`
  - `POST /orders/{id}/confirm` confirms a draft.
  - `DELETE /orders/{id}` cancels a pending order or a draft; Printful's charge is returned to the store owner's card.
  - Statuses: draft, failed, inreview, pending, canceled, onhold, inprocess, partial, fulfilled.

## Slices

| # | Slice | Status |
|---|-------|--------|
| S1 | Merch orders as the LAST panel on /admin/orders (same shell, row and controls as Greenway and Leafly), plus a details page at /admin/orders/merch/[ref] to Confirm or Cancel | shipped |
| S2 | Washington-only selling: ZIP gate in the cart and checkout API, authorize-only Checkout, webhook captures WA orders and cancels other states for free, customer email, policy text | shipped |
| S3 | Website dropdown split into "Cannabis" (everything today) and "Merchandise" (Header & Footer, Banners, Product Cards, Ad Card, Order Emails) feeding greenwaymerch.com | shipped |
| S4 | SEO for greenwaymerch.com: JSON-LD Organization, Product and Breadcrumb; OG images; canonical URLs; sitemap; Google Merchant feed | shipped |
| S5 | Helpers page: move the top-of-page helpers off the website editors, Creative Studio and Merch Studio. The first banner sits where it does on the live site and only follows the scroll when that setting is turned on | shipped |
| S6 | Brand editor: build and save cards plus custom sizes (blog, newsletter, marketing), not just banners, and save a finished design as an image into the Media Library "Merch" folder so Merch Banners can attach it | shipped |
| S7 | Merch inventory page (Inventory menu). Publishing in Merch Studio adds the item to inventory automatically | planned |
| S8 | Reports > Merch tab: traffic, sales, WA tax | planned |

## S1 - merch orders in the back office (shipped)

- **Source of truth: Printful.** greenwaymerch.com already writes every paid order there, with `external_id` set to the gm- ref, the customer's address, the items, `retail_costs` (what the customer paid, including tax) and later the shipments.
- The back office reads Printful with the LLC token Merch Studio already uses (`PRINTFUL_API_TOKEN`). No new table, no new secret, no copy that can drift.
- `src/lib/orders/merch-orders-core.ts` (pure, 40 self-tests) holds:
  - the Printful status mapping to our tabs: draft, failed and onhold go to New; inreview and pending to Acknowledged; inprocess to Preparing; partial to Ready; fulfilled to Completed; canceled to Cancelled; anything unknown to New, so it is never hidden;
  - the order parser (money in cents, https-only thumbnails);
  - the view, which uses the same search, date, total, sort and page semantics as the other panels;
  - the "hidden but needs a person" warning.
- `order-panels-core.ts` now has three panels. Merch parameters are prefixed with `m`, and every link and form carries the other two panels' views.
- `MerchOrdersPanel` renders through `OrdersPanel` and `OrderBoardRow`, so it is identical by construction. It is loaded inside `withRenderBudget`, so a slow Printful cannot stall the board, and it is skipped on the Setup tab.
- The details page `/admin/orders/merch/[ref]` shows:
  - the status, the progress strip, customer and shipping details, shipments and tracking, and the items;
  - "Customer paid vs Printful charges us", including the sales tax collected.
- Actions on the details page (`merch-actions.ts`, `orders.manage`, audited) are **Confirm** and **Cancel**. Each one re-reads Printful's current status first, so a stale page can never confirm an order twice or cancel a shipped one.
- The greenwaymerch.com /admin/orders desk (R72 S6) still works as a fallback.

## S5 - Helpers page and less top-of-page chrome (shipped)

The owner clarified that "helpers" means the green "How this works" bar at the very top. It was collapsible, but it lived inside the **sticky** page header, so it rode along over the editors and studios together with the title and subtitle.
- **New Helpers page** at `/admin/helpers` (Website > Cannabis > Helpers, `content.edit`). It holds every guide that used to sit at the top of the website editors (Website Sync, Header & Footer, Branding, Legal Policies, Blog wording, the page editors, Shop Banner, Store Listing, Schedule, Loyalty, Specials, Medical page), the four Merchandise editors, Creative Studio and Merch Studio.
  - The wording is moved unchanged into `src/lib/admin/page-helpers-core.ts` (pure, 17 self-tests: unique anchor-safe ids, every guide has steps, every link stays in the back office, and each section is covered).
  - Anchor ids are the old HelpPanel ids, so `/admin/helpers#merch-studio` and similar links are stable.
- **Editors:** the green panel is gone. The header shows one small "ⓘ How this page works" link to that page's guide. The embedded Hero text and Page wording cards do the same.
- **Less chrome everywhere:** `AdminPageHeader` is no longer sticky. It scrolls away with the page, and the top menu bar stays pinned. Padding is tighter, the title is a step smaller, and a long subtitle is clamped to one line on desktop (the full text shows on hover). This applies to every back-office page.
  - Pages that still pass `help={<HelpPanel/>}` (purchasing, inventory and similar operational pages) keep their panel, but it now scrolls away too.
- **Merch Studio:** the four-line "Sold by Greenway Glass & Goods" notice is now a one-line strip that links to the full text on the Helpers page.
- **First banner sits in place:** the studio canvas dock (`useStudioDock`, used by every Design Studio banner/card editor and Merch Studio) now starts **off**. The canvas sits where the banner sits on the live page, and follows the scroll only after the owner presses "📌 Follow scroll". The choice is remembered in the browser under a new key (`gw-studio-follow-v2`), so everyone starts once from the new default.

## S4 - SEO for greenwaymerch.com (shipped)

Built from Google's own docs (merchant listing, product variants, return policy, the Merchant Center product data spec, and the official product taxonomy file). All of it lives in `merch-site/lib/seo-core.ts`, which has 19 self-tests.
- **Every page:** `OnlineStore` (an Organization type) JSON-LD with the dba, legal name and a `merchantReturnLink` to /returns, plus `WebSite`. Email, phone and address are only included when their env vars are set.
- **Product pages:** a `ProductGroup` with one `Product`/`Offer` per variant (`variesBy` size/color, `productGroupID` = handle, price in USD, New condition, InStock/OutOfStock).
  - Variants priced at $0 are left out, because Google requires a price above zero.
  - Shipping is only claimed when `MERCH_SHIP_FLAT_CENTS` is set, and the destination is always **US-WA**. The free-shipping threshold follows the same rule as checkout.
  - Google category: 212 Shirts & Tops (tees, long sleeves, hoodies, sweatshirts, zip hoodies; the taxonomy has no hoodie node), 5598 Coats & Jackets, and 173 Hats (hats, beanies).
  - Audience is "unisex" only where Printful's own title says Unisex. The hat titles don't, so no gender is claimed for them.
- **Breadcrumbs:** `BreadcrumbList` on catalogue and product pages.
- **Canonical URLs:** set on home, catalogue, product and policy pages. They are per page, so a policy page can never inherit the home canonical. Cart, success and admin stay `noindex`. Default OG image and `summary_large_image` Twitter card.
- **Google Merchant feed:** `https://greenwaymerch.com/feeds/google.xml` (RSS 2.0 with the `g:` namespace, cached for 1 hour). It has one item per variant with `item_group_id`, price, availability, `identifier_exists=no` (print-on-demand has no GTIN), google_product_category, color, size, age_group adult, gender where verified, and WA shipping.
  - Owner step: in Merchant Center, add a data source by file URL (scheduled fetch), and verify and claim greenwaymerch.com.
  - Today the catalogue is empty, so the feed is valid and has no items until Merch Studio publishes.

## S3 - Website -> Cannabis / Merchandise (shipped)

Course change (owner, mid-S3): build banners once in the cannabis Brand editor, save the finished image to a "Merch" media folder, and have the merch side simply attach it. We agreed because copying the live banner renderer to greenwaymerch.com would mean about 61 files and 17.5k lines (DesignedBanner, banner-design-core at 1,830 lines, the smoke/animation/promotions code, and three extra packages: `shaders/js`, `@lottiefiles/dotlottie-web`, `@rive-app/webgl2`). Two copies would drift apart. A finished image looks pixel-identical, costs nothing to serve, and needs no second renderer.

What shipped:
- The Website dropdown now shows two headings, **Cannabis** (all existing items, unchanged) and **Merchandise** (`subgroup` on nav items; `subgroupHeaderAt` in admin-nav-core, tested).
- Four editors at `/admin/merch-site/{header-footer,banners,cards,emails}`, all one shared component cloned from the Header & Footer editor (same draft, publish and history actions). "Merch Ad Card (on Shop)" is `/admin/merch-site/ad-card`, a guarded redirect to the existing Merch Studio Publish tab (one editor, no copy).
- Banners: one slot for Home and one per category (desktop image, optional phone image, alt text, link). The image picker lists the new **Merch** media folder first. An empty slot renders nothing.
- The content lives in `content_blocks` (pages `merch-header-footer`, `merch-banners`, `merch-cards`, `merch-emails`), defined once in `merch-site/lib/site-content-core.ts` (15 self-tests) and seeded from there. No migration.
- greenwaymerch.com reads only published values from the public, read-only `GET /api/merch-content` (60s CDN cache). If that call fails it uses the built-in defaults. The defaults match the pre-S3 site exactly, so nothing changes until someone publishes.
- Order emails: the shipped and "cancelled (Washington only)" subjects, the shipped note and the sign-off are editable (`{order}`, `{site}`). Order facts, tracking and refund wording stay automatic.
- The green Edit router (edit-target-core) sends `merch.header/footer/banner/card/email.*` keys to their new editors.

## S2 - Washington-only selling (shipped)

Facts verified on docs.stripe.com:
- Hosted Checkout `shipping_address_collection` only limits countries, not states.
- `payment_intent_data[capture_method]=manual` only authorizes the card. The PaymentIntent moves to `requires_capture`. Card holds last about 7 days (Visa: 5 days for customer-initiated payments).
- Cancelling an uncaptured PaymentIntent releases the hold at no charge. A refund after capture does not return Stripe's processing fee, so we never capture first.
- `custom_text[shipping_address][message]` shows a note on the Checkout address step.

How it is enforced (`merch-site/lib/region-core.ts`, 11 self-tests):
1. Cart: the shopper enters a ZIP, and the Secure checkout button stays disabled until it is a Washington ZIP (USPS prefixes 980-986 and 988-994).
2. `/api/checkout` returns 422 for a non-WA ZIP. The session is authorize-only and shows the Washington-only note.
3. The webhook expands `payment_intent` and calls `decidePayment(pi.status, ...)`:
   - WA address and the order plan is clean: capture, then create the Printful draft.
   - Address outside WA: cancel the PaymentIntent (free), email the shopper "not charged", and alert the owner.
   - Plan problems: the order is not captured, and the owner is alerted. The owner can capture or cancel it in Stripe within about 7 days.
   - Already `succeeded` (retries or older sessions): fulfill as before.
4. `planPrintfulOrder` refuses non-WA recipients, so Printful never receives one.

Tax: Printful does not collect or remit the customer's sales tax. Greenway Merchandising LLC collects WA sales tax and files with WA DOR. Two options:
- Stripe Tax with only a Washington registration (`MERCH_STRIPE_AUTOMATIC_TAX=true`). Stripe Tax Basic for Checkout costs 0.5% per transaction, charged only in registered locations and on top of normal processing (secondary source dodopayments.com; stripe.com/tax/pricing requires JavaScript).
- No Stripe Tax: then sales tax is not added at checkout.

Resale certificate: file a WA reseller permit with Printful so Printful does not charge the LLC sales tax on its production costs.

## S6 - Brand designs in any size, saved as pictures (shipped)

- Branding → Saved banners is now "Saved brand designs". A new design starts from **What is it for?**: website banner, card, or any researched size from `creative-placements-core` (website, social, email/newsletter, blog, print), or a custom W×H (64–6000px).
- `src/lib/brand/brand-sizes-core.ts` (pure, 25 self-tests): size options, custom-size checks, frame choice (shape 0.4–2.5 → card frame that scales with width; wider → banner frame at the 1408px reference), `applySize`, `stillDesign` (drops entrances/curtain, square corners), `exportPlan` (render size + scale, 16 MP cap) and `exportFilename`.
- `BrandSaved` gains an optional `size` (normalised; absent = classic). The `brand.kit` JSON block needs no migration.
- **Save as picture** (`BrandDesignExport.tsx`) renders the same public `<DesignedBanner>` offscreen, rasterises it with `modern-screenshot` (MIT, new dependency, free), and uploads the PNG through the existing direct-upload actions into a Media Library folder (Merch by default; Section banner, Blog, Newsletter, Other). Merch Banners lists the Merch folder first.
- Helpers (Branding, Merch Banners) updated.

## S6 - Brand designs in any size, saved as pictures (shipped)

- Branding → Saved banners is now "Saved brand designs". A new design starts from **What is it for?**: website banner, card, or any researched size from `creative-placements-core` (website, social, email/newsletter, blog, print), or a custom W×H (64–6000px).
- `src/lib/brand/brand-sizes-core.ts` (pure, 25 self-tests): size options, custom-size checks, frame choice (shape 0.4–2.5 → card frame that scales with width; wider → banner frame at the 1408px reference), `applySize`, `stillDesign` (drops entrances/curtain, square corners), `exportPlan` (render size + scale, 16 MP cap) and `exportFilename`.
- `BrandSaved` gains an optional `size` (normalised; absent = classic). The `brand.kit` JSON block needs no migration.
- **Save as picture** (`BrandDesignExport.tsx`) renders the same public `<DesignedBanner>` offscreen, rasterises it with `modern-screenshot` (MIT, new dependency, free), and uploads the PNG through the existing direct-upload actions into a Media Library folder (Merch by default; Section banner, Blog, Newsletter, Other). Merch Banners lists the Merch folder first.
- Helpers (Branding, Merch Banners) updated.

## S6 - Brand designs in any size, saved as pictures (shipped)

- Branding → Saved banners is now "Saved brand designs". A new design starts from **What is it for?**: website banner, card, or any researched size from `creative-placements-core` (website, social, email/newsletter, blog, print), or a custom W×H (64–6000px).
- `src/lib/brand/brand-sizes-core.ts` (pure, 25 self-tests): size options, custom-size checks, frame choice (shape 0.4–2.5 → card frame that scales with width; wider → banner frame at the 1408px reference), `applySize`, `stillDesign` (drops entrances/curtain, square corners), `exportPlan` (render size + scale, 16 MP cap) and `exportFilename`.
- `BrandSaved` gains an optional `size` (normalised; absent = classic). The `brand.kit` JSON block needs no migration.
- **Save as picture** (`BrandDesignExport.tsx`) renders the same public `<DesignedBanner>` offscreen, rasterises it with `modern-screenshot` (MIT, new dependency, free), and uploads the PNG through the existing direct-upload actions into a Media Library folder (Merch by default; Section banner, Blog, Newsletter, Other). Merch Banners lists the Merch folder first.
- Helpers (Branding, Merch Banners) updated.

## S6 - Brand designs in any size, saved as pictures (shipped)

- Branding → Saved banners is now "Saved brand designs". A new design starts from **What is it for?**: website banner, card, or any researched size from `creative-placements-core` (website, social, email/newsletter, blog, print), or a custom W×H (64–6000px).
- `src/lib/brand/brand-sizes-core.ts` (pure, 25 self-tests): size options, custom-size checks, frame choice (shape 0.4–2.5 → card frame that scales with width; wider → banner frame at the 1408px reference), `applySize`, `stillDesign` (drops entrances/curtain, square corners), `exportPlan` (render size + scale, 16 MP cap) and `exportFilename`.
- `BrandSaved` gains an optional `size` (normalised; absent = classic). The `brand.kit` JSON block needs no migration.
- **Save as picture** (`BrandDesignExport.tsx`) renders the same public `<DesignedBanner>` offscreen, rasterises it with `modern-screenshot` (MIT, new dependency, free), and uploads the PNG through the existing direct-upload actions into a Media Library folder (Merch by default; Section banner, Blog, Newsletter, Other). Merch Banners lists the Merch folder first.
- Helpers (Branding, Merch Banners) updated.

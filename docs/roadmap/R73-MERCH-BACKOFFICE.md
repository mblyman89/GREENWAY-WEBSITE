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
| S3 | Website dropdown split into "Cannabis" (everything today) and "Merchandise" (product ad card, product card, home banner, catalog banner, order email, header/footer editors) feeding greenwaymerch.com | planned |
| S4 | SEO for greenwaymerch.com: JSON-LD Organization, Product and Breadcrumb; OG images; canonical URLs; sitemap; Google Merchant feed | planned |
| S5 | Helpers page: move the top-of-page helpers off the website editors, Creative Studio and Merch Studio. The first banner sits where it does on the live site and only follows the scroll when that setting is turned on | planned |
| S6 | Brand editor: build and save cards plus custom sizes (blog, newsletter, marketing), not just banners | planned |
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

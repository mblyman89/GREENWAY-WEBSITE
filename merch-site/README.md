# greenwaymerch.com

The apparel store for **Greenway Merchandising LLC (dba Greenway Glass & Goods)**.
It's a separate Next.js app inside this repo, deployed as its **own Vercel project**
with its own environment variables and the LLC's own Stripe account. It shares
nothing at runtime with greenwaymarijuana.com: no age gate, no cannabis cart, no
cannabis analytics, and no database.

The pages are a copy of the cannabis shop's design: the same filter rail, toolbar,
glow cards, detail-page layout and buttons.

| Page | What it is |
| --- | --- |
| `/` | The shop page. It shows a category card for each garment type, and the filter-bar category rows link straight to each catalogue page. Typing in search shows matching products from every category. |
| `/tees`, `/hoodies`, `/sweatshirts`, `/zip-hoodies`, `/long-sleeves`, `/jackets`, `/hats`, `/beanies` | Catalogue pages: product cards with search, sort, colour and size filters. Aliases such as `/hoodie`, `/hat` and `/t-shirts` redirect permanently (308). |
| `/<category>/<product>` | The detail page: photos, colour and size, quantity, and add to cart. |
| `/cart` | Server-priced cart, then Stripe-hosted checkout. |
| `/checkout/success` | Order confirmation. |
| `/shipping`, `/returns`, `/privacy`, `/terms`, `/contact` | Policy pages (card networks require these). |
| `/api/stripe/webhook` | Slice 6: a paid order creates a Printful **draft** order. |
| `/admin/orders` | Slice 6: the owner's order desk. Sign in with `MERCH_ADMIN_KEY`, see paid vs. Printful cost per order, and confirm drafts (Printful only charges for confirmed orders). |
| `/api/printful/webhook/<token>` | Slice 6: shipment tracking emails go to the customer. |

## Washington-only selling (R73 S2)

Printful does not collect or remit the customer's sales tax, so the LLC is the seller of record. To keep to one tax authority (WA DOR), the store sells to Washington addresses only.

1. In the cart, the shopper must enter a Washington ZIP before the checkout button turns on. `/api/checkout` checks the ZIP again.
2. Stripe Checkout only authorizes the card (`capture_method=manual`) and shows a "Washington only" note on the address step.
3. The webhook reads the real shipping address:
   - **Washington:** it captures the payment, then creates the Printful draft.
   - **Any other state:** it cancels the authorization, which costs nothing. The customer gets a "not charged" email and you get an alert.
   - **Any other problem:** the order is left authorized but not charged, and you get an alert. Capture or cancel it in Stripe within about 7 days, before the hold expires.

**Stripe Tax (optional):** in Stripe, go to Tax, then Registrations, and add **Washington only**. Then set `MERCH_STRIPE_AUTOMATIC_TAX=true`. Stripe Tax Basic for Checkout costs 0.5% per taxed transaction.

**Printful:** first add your legal info in the Printful Dashboard (Billing, then Legal info). Then go to Billing, then Resale certificates (printful.com/dashboard/billing/resale-certificates), click Add certificate, choose the Washington form (MTC or SSUTA) and enter your WA tax registration number. Approval takes about 2 business days, and Printful doesn't refund tax on orders placed before approval. Without a certificate, Printful charges you WA sales tax on its production costs.

## Google (R73 S4)

- Search Console: add `https://greenwaymerch.com`, then submit `https://greenwaymerch.com/sitemap.xml`.
- Merchant Center (free listings): verify and claim the domain, then add a data source with the file URL `https://greenwaymerch.com/feeds/google.xml`, set to a daily scheduled fetch. Each product page also carries Product structured data, so prices stay in sync.
- Shipping in the feed and markup comes from `MERCH_SHIP_*`. If those aren't set, no shipping is claimed. The destination is always Washington.

## Adding a product (no code)

1. In the back office, open **Merch Studio**, go to **Publish & Ads** and click **Download listing package**.
2. Put the `.json` file in `merch-site/catalog/`. File-name order sets the "Featured" order, so prefix names with `01-`, `02-` and so on.
3. Put the print PNGs from the Proof & Export ZIP in `merch-site/public/print/`, using the same file names.
4. Put product photos in `merch-site/public/products/`, named `<product-handle>-1.jpg`, `<product-handle>-2.webp` and so on. Without photos, the category's blank-garment photo is shown.
5. Commit and push to `main`. Vercel rebuilds, and `npm run catalog` prints any problems.

To hide a product without deleting it, add `"merch": { "active": false }` to its JSON file.

## Vercel project setup (one time)

1. In Vercel, go to **Add New**, then **Project**, and import this same GitHub repo. Set the **Root Directory** to `merch-site` (Framework: Next.js).
2. Add the environment variables below (Production).
3. Add the domain `greenwaymerch.com` (and `www.greenwaymerch.com`, redirecting to the apex) and set the DNS records Vercel shows.
4. `vercel.json` skips builds when nothing in `merch-site/` changed and only deploys `main`.

| Variable | Required | What |
| --- | --- | --- |
| `MERCH_SITE_URL` | yes | `https://greenwaymerch.com`. Used for print-file URLs Printful downloads, Stripe return URLs and the sitemap. |
| `STRIPE_SECRET_KEY` | yes | The **LLC's** Stripe secret key (`sk_live_...`). Checkout stays closed until it's set. |
| `MERCH_SHIP_FLAT_CENTS` | yes | Shipping charged per order, in cents (for example `599`). Checkout stays closed until it's set, so a price is never guessed. |
| `MERCH_SHIP_EXTRA_ITEM_CENTS` | no | Added per extra unit (for example `200`). |
| `MERCH_FREE_SHIP_OVER_CENTS` | no | Free shipping at or above this subtotal (for example `7500`). |
| `MERCH_SHIP_MIN_DAYS` / `MERCH_SHIP_MAX_DAYS` | no | Delivery estimate shown in Stripe Checkout (business days). |
| `MERCH_STRIPE_AUTOMATIC_TAX` | no | `true` after Stripe Tax is activated and registrations are added in the Stripe dashboard. |
| `NEXT_PUBLIC_MERCH_CONTACT_EMAIL` | yes | Shown in the footer, the policy pages and the success page. |
| `NEXT_PUBLIC_MERCH_CONTACT_PHONE` | recommended | Customer-service phone number. |
| `NEXT_PUBLIC_MERCH_BUSINESS_ADDRESS` | recommended | One line, for example `123 Main St, Olympia, WA 98501`. |
| `STRIPE_WEBHOOK_SECRET` | Slice 6 | `whsec_...` from the Stripe webhook endpoint. |
| `PRINTFUL_API_TOKEN` | Slice 6 | Printful private token with the `orders` and `webhooks` scopes. |
| `PRINTFUL_STORE_ID` | Slice 6 | Needed if the token covers more than one store. |
| `MERCH_CONTENT_URL` | no | R73 S3. Where the editable wording and banners come from. Default `https://greenwaymarijuana.com/api/merch-content` (set in the back office under Website -> Merchandise). Only set this for a preview or staging back office. |
| `PRINTFUL_WEBHOOK_TOKEN` | Slice 6 | A long random string that becomes part of the Printful webhook URL. |
| `MERCH_ADMIN_KEY` | Slice 6 | A long random string (32+ characters; 16 minimum) that you type to open `/admin/orders`. Changing it signs everyone out. |
| `MERCH_PRINTFUL_AUTO_CONFIRM` | no | `true` sends paid orders straight to production instead of as drafts. Leave unset until you trust the flow. |
| `RESEND_API_KEY` / `MERCH_EMAIL_FROM` | Slice 6 | Shipping emails (for example `Greenway Merch <orders@greenwaymerch.com>`). |
| `MERCH_ORDER_ALERT_EMAIL` | Slice 6 | Where problem alerts go (bad address, Printful rejected an order, Printful failed, cancelled or on-hold events, an email that didn't send). |

## Local commands

```bash
cd merch-site
npm install
npm run dev        # http://localhost:3000
npm test           # pure self-tests (catalog + checkout + orders)
npm run build
```

## Orders: how they flow (Slice 6)

1. The customer pays in Stripe Checkout. Stripe calls `/api/stripe/webhook`.
2. The webhook checks Stripe's signature, re-reads the session from Stripe, re-prices the cart from this site's catalog, and creates a Printful **draft** with `external_id` set to the `gm-...` order number. The call uses `?update_existing=true`, so a Stripe retry can never create a second order.
3. You open `/admin/orders`, check the address, items and margin, and press **Confirm**. Printful charges the LLC's card on file and starts production.
4. When Printful ships, it calls `/api/printful/webhook/<token>`, and the customer gets a "your order shipped" email with the tracking link. Failed, cancelled and on-hold orders email you instead.

There's no database. Stripe (payments) and Printful (orders, searchable by `gm-...`) are the record.

### One-time webhook setup

**Stripe:** go to **Developers**, then **Webhooks**, then **Add endpoint**:

- URL: `https://greenwaymerch.com/api/stripe/webhook`
- Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

**Printful:** v1 webhooks are registered with the API, once:

```bash
curl -X POST https://api.printful.com/webhooks \
  -H "Authorization: Bearer $PRINTFUL_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://greenwaymerch.com/api/printful/webhook/<PRINTFUL_WEBHOOK_TOKEN>","types":["package_shipped","order_failed","order_canceled","order_put_hold"]}'
```

Add `-H "X-PF-Store-Id: <id>"` if your token covers more than one store. Printful v1 doesn't sign webhooks, which is why the URL carries the secret token. A wrong token gets a 404.

**Resend:** verify `greenwaymerch.com` as a sending domain (Resend shows the DNS records), then set `MERCH_EMAIL_FROM`.

### Test it end-to-end (Stripe test mode)

1. Use an `sk_test_...` key and a test webhook secret.
2. Buy with card `4242 4242 4242 4242`.
3. A draft should appear on `/admin/orders` and in Printful's Orders list. Delete the draft in Printful without confirming, so you aren't charged.

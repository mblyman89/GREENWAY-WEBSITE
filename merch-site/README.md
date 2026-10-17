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
| `/admin/orders?key=...` | Slice 6: the owner confirms drafts (only confirmed orders are charged by Printful). |
| `/api/printful/webhook/<token>` | Slice 6: shipment tracking emails go to the customer. |

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
| `PRINTFUL_API_TOKEN` | Slice 6 | Printful private token (orders scope). |
| `PRINTFUL_STORE_ID` | Slice 6 | Needed if the token covers more than one store. |
| `PRINTFUL_WEBHOOK_TOKEN` | Slice 6 | A long random string that becomes part of the Printful webhook URL. |
| `MERCH_ADMIN_KEY` | Slice 6 | A long random string that opens `/admin/orders`. |
| `RESEND_API_KEY` / `MERCH_EMAIL_FROM` | Slice 6 | Shipping emails (for example `Greenway Merch <orders@greenwaymerch.com>`). |
| `MERCH_ORDER_ALERT_EMAIL` | Slice 6 | Where new-order and problem alerts go. |

## Local commands

```bash
cd merch-site
npm install
npm run dev        # http://localhost:3000
npm test           # pure self-tests (catalog + checkout + orders)
npm run build
```

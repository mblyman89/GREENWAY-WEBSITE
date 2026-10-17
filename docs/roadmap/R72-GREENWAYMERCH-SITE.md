# R72 - greenwaymerch.com (Slices 5 + 6)

## Owner request (verbatim)

> Thank you! I like the idea of removing the product cards from the shop page while it's disabled. I wan to be able to use the filter bar to navigate to them faster. That would then show a list of advertisement cards, each one pointing to greenwaymerch.com/sweatshirts, or /tees, or /hoodie, or /hats, etc. the new domain is greenwaymerch.com. I want the new merch website to be a copy and paste design of the shop page, identical to how it looks, works, interacts with, everything. That way we don't have to start from scratch. We only need the one shop page with all the main types of categories cards that opens up the catalogue page ( new page I would guess), then picking something from there opens the detail page, which we can copy and paste from the main site. We can copy and paste the checkout process adding anything needed to manage it. I am hoping the new domain website will be fairly simple and straight forward. Almost everything we need is already built, except for the catalogue page. I like the new tab opening is a great idea too for the merch domain. I just want the transition from GreenwayMarijuana.com to greenwaymerch.com to be as seamless as possible.

## Slice 5

### Cannabis site (greenwaymarijuana.com)

- The merch ad block (`merch-ad-core.ts`) now carries up to 12 **category cards**: path, label, image and words. Each one links to `https://greenwaymerch.com/<path>`.
- The shop filter bar gets a **"Greenway Merch"** category. Choosing it swaps the product grid for the category ad cards, styled like the accessory cards. Each card opens greenwaymerch.com in a **new tab** (`noopener noreferrer`, `no-referrer`).
- When the ad is disabled or has no cards, the filter option and cards do not exist at all.
- The bottom-of-shop redirect banner is unchanged.
- **Merch Studio > Publish & Ads** gets:
  - a "Use https://greenwaymerch.com" button
  - "Add the standard category cards" (tees, hoodies, sweatshirts, zip hoodies, hats, beanies)
  - per-card edit, reorder and remove
  - an add-card form and a live preview
- The no-price and no-cart wording rules also apply to the card words.

### merch-site/ (greenwaymerch.com)

- This is a separate Next 16 app with its own Vercel project (root directory `merch-site`), its own lockfile and the LLC's Stripe keys.
- `turbopack.root` and `outputFileTracingRoot` are pinned to the folder. This was verified necessary: without them, Next built the parent's `src/`.
- The root `tsconfig.json`, `tsconfig.build.json` and eslint ignores exclude it.
- Pages:
  - `/` category cards
  - `/<category>` catalogue
  - `/<category>/<handle>` detail
  - `/cart`
  - `/checkout/success`
  - the policy pages
  - `robots.txt` and `sitemap.xml`
- Alias redirects: `/hoodie` → `/hoodies`, `/hat` → `/hats`, `/t-shirts` → `/tees`, and others.
- The design is copied class-for-class from the shop: glow cards, filter rail, mobile filter sheet, toolbar, search, sort, PDP layout and buttons.
- Category photos are Printful's public blank-garment photos (no logos). The cannabis-leaf `/merch/*.webp` photos are **not** used.
- Products come from Merch Studio listing packages dropped into `merch-site/catalog/`.
- **Cart:** stored in localStorage and **priced by the server** (`priceCart`).
- **Checkout:** Stripe-hosted Checkout on the LLC's account:
  - tax codes `txcd_30011000` / `txcd_92010001`
  - US-only shipping
  - the shipping price comes **only** from owner env vars, so checkout stays closed until they are set
  - Stripe Tax is opt-in
  - the order ref `gm-…` is the client_reference_id and the future Printful external_id
  - the cart is encoded into session metadata (each value ≤500 characters)
- **Tests:** `catalog-core` (25) and `checkout-core` (17) are registered in `run-pure-selftests.ts`; `merch-ad-core` now has 51.
- `SHIPPED_SLICE` is 5.

## Slice 6 - Printful orders (shipped)

There's no database: Stripe holds the payment, customer and address, and Printful holds the production order, addressed by our `gm-...` ref (`external_id`).

**`merch-site/lib/orders-core.ts`** (pure, 26 self-tests, registered in `run-pure-selftests.ts` and `merch-site npm test`) provides:

- Stripe signature verification (`t=,v1=`, HMAC-SHA256, 5-minute tolerance, any matching v1 accepted so secrets can rotate).
- Constant-time secret compare (16 characters minimum).
- The paid session → Printful order body. The cart is re-priced from the server catalog, and problems are flagged, never silently dropped.
- The Printful webhook reader. Tracking URLs are https only.
- The escaped "shipped" email.
- Admin order rows: paid vs. Printful cost vs. margin. Unknown costs stay blank, never 0.

**Routes:**

- **`/api/stripe/webhook`** handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
  - It verifies the signature and re-fetches the session at the pinned API version.
  - It only handles sessions with `metadata.site=greenwaymerch`, then sends `POST /orders?update_existing=true`, which is idempotent and creates a draft by default (`MERCH_PRINTFUL_AUTO_CONFIRM=true` sends orders straight to production).
  - Permanent problems alert the owner and return 200. Transient errors (network, 429, 5xx) return 500 so Stripe retries.
- **`/admin/orders`** is the owner's order desk.
  - The key is typed into a form, never put in a URL. The cookie is httpOnly, Secure and SameSite=Strict, scoped to `/admin`, and holds a sha256 of the key, not the key.
  - It lists orders by status, shows paid / Printful cost / margin, and has a Confirm button (`POST /orders/{id}/confirm`) for site drafts.
  - It's noindex and no-store.
- **`/api/printful/webhook/<token>`** handles `package_shipped`, which sends the customer the tracking email via Resend. `order_failed`, `order_canceled` and `order_put_hold` send an owner alert instead. Orders without a gm- ref are ignored.

All fields were checked against Printful's v1 OpenAPI: the token scopes are `orders` and `webhooks`. Server REST clients are in `merch-site/lib/fulfillment.ts`, with no SDKs. `SHIPPED_SLICE` is 6, and every Merch Studio pipeline step is live.

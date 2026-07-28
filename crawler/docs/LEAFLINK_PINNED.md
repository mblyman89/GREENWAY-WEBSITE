# LeafLink — pinned facts from a LIVE authenticated probe (never guess)

Probed 2026-01-29 with the owner's real retailer account
(stephen@greenwaymarijuana.com, company **greenway-marijuana** / id 3053,
user id 699) via a real browser session. Every endpoint, parameter, and field
below was observed on the wire — nothing is assumed.

## Login (Auth0 universal login)

- `https://www.leaflink.com/accounts/login/` redirects to
  `https://auth.leaflink.com/u/login?state=...` — a plain Auth0-hosted form:
  one text input (email), one password input, one `Log in` submit button.
- Successful login redirects to `https://app.leaflink.com/c/<company-slug>/`
  (for Greenway: `/c/greenway-marijuana/`).
- There is NO Bearer token for the internal API. Authorization is **cookie
  based**: the same `fetch` against the internal API returns **200 with
  cookies, 403 without** (verified with `credentials:'omit'`). Cookies of
  interest after login: Auth0 session cookies + `mp-csrftoken` +
  `mp-django_language` on `app.leaflink.com`.

## Internal API (cookie-authenticated, app.leaflink.com)

All calls are `GET` with `error_format=jsonapi` and return classic DRF
pagination envelopes: `{count, next, previous, results[]}`.

### Product search (the SPA's Shop → Products call)

    GET /api/internal/greenway-marijuana/shop/products/?limit=24&offset=0&search=<q>&sort_by=&error_format=jsonapi

- `search=smokiez` → count=44 with full product rows. Plain paging via
  `limit`/`offset` (`next` carries the follow-up URL).
- Category filter pinned: `categories=category__7` (the `value` strings come
  from `GET /api/internal/greenway-marijuana/shop/filters/?filters=categories`
  → `{categories:[{value:"category__9", display_value:"Accessories (all)",
  sub_categories:[{value:"sub_category__38", ...}]}]}`).
- Observed result fields (list row): `id`, `name`, `display_name`,
  `brand {id, name, company {id, name}}`, `category {id, name, slug,
  description}`, `sub_category {id, name}`, `unit_denomination {value, label}`,
  `unit_multiplier` (e.g. 18), `unit_of_measure` ("Unit"),
  `license {number, type, display_type, classification}`, `discount`,
  `volume_discounts[]`, `featured_image` (CloudFront URL),
  `display_price_unit` ("Case (18 Units)"), `is_backordered`, `sold_in_bulk`,
  `strain_classification` ("–" when n/a), `can_be_purchased`, `brand_badges[]`,
  `wholesale_price {amount, currency}` (e.g. `{"amount":"112.50",
  "currency":"USD"}` — note: sometimes a NUMBER 60, sometimes a STRING
  "60.00"; normalizers must accept both), `sale_price`, `base_price`,
  `retail_price`, `effective_price`, `base_unit_price`, `price_per_unit`,
  `external_ids`.

### Product detail (the SPA's product page call)

    GET /api/internal/greenway-marijuana/brands/<brandId>/products/<productId>?error_format=jsonapi&company_slug=greenway-marijuana

Adds on top of the list row: `description` (HTML string), `tagline`, `sku`,
`quantity` ("1857.000000" — stringified decimal), `reserved_qty`,
`display_available_inventory`, `product_specs` / `product_data_items`
(`[{name:"THC", value:"100 mg"}, {name:"CBD", value:"100 mg"}, ...]`),
`batch_information[]`, `strain_names` (string), `images` (**array of plain URL
strings**, e.g. CloudFront `https://d3nec6hp1jgjd8.cloudfront.net/media/...`),
`display_min_order`, `display_max_order`, `listing_state`, `coming_soon`,
`allow_fractional_quantities`.

NOTE: `GET /shop/products/<id>/` is **404** — the detail route is the
brand-scoped one above. The SPA product URL is
`/c/greenway-marijuana/shop/brands/<brandId>` (brand menu) and clicking a card
name fires the brand-scoped detail request.

### Brand menu (a seller's full menu)

    GET /api/internal/greenway-marijuana/brands/<brandId>?error_format=jsonapi              (brand header)
    GET /api/internal/greenway-marijuana/brands/<brandId>/products?product_lines=1&error_format=jsonapi   (brand's product list)

### Sellers the buyer works with

    GET /api/internal/greenway-marijuana/sellers/?limit=..&error_format=jsonapi
    → {count:3, results:[{id, name, sell_through_data_shared, ...}]}
    (Only sellers with a relationship; brand/product search is the primary
    discovery surface.)

### Search behavior gotcha (pinned)

`search=` on `shop/products/` is a REAL filter only when it matches something:
`search=smokiez` → count=44, `search=wyld` → count=97, but a non-matching
term (`search=fairwinds`) FALLS BACK to the FULL catalog (count=4607 — the
same as no search). A client must therefore treat "count == unfiltered total"
as *no match* and/or name-filter the grouped brands against the query. Vendor
discovery = group product-search hits by `brand {id, name, company{id,name}}`.

### Brand header / brand menu

- `GET /api/internal/greenway-marijuana/brands/11765?error_format=jsonapi` →
  `{id, name, company, description, image, banner, tagline, address, zipcode,
  city, phone, website, fb_handle, ig_handle, ..., product_categories}`.
- `GET /api/internal/greenway-marijuana/brands/11765/products?product_lines=1`
  → top-level **array**: `[{brand, product_lines:[{product_line,
  products:[<detail-shaped rows>]}]}]` — 7 lines / e.g. 16 products for Blazy
  Susan. Product rows here carry the SAME rich shape as the product-detail
  endpoint (description, quantity, images, specs).

### Shop Brands page (JWT, not cookies)

The "Shop Brands" tab calls `https://api.leaflink.com/content/brands/listing?company_id=3053&page=1`
plus `/brands/recommended`, `/vendors/recommended` — these use an Auth0
Bearer JWT (audience `https://api.leaflink.com`, `prompt=none` silent
authorize) and are CORS-blocked from page JS. Brand search on that tab is
client-side over the ~32-brand relationship network. NOT needed for menus —
the cookie API above is sufficient.

## Official public API — NOT usable for menus

`https://api.leaflink.com` (App API key, self-serve at Settings →
Applications; header `Authorization: App <key>`; 300 req/min). The
**retailer permission set only exposes `GET /buyer/orders/`** (order history).
There is NO official endpoint for browsing seller menus/catalogs as a buyer —
which is why menu data must come from the internal cookie API above, with a
real Playwright login, exactly like the GrowFlow marketplace integration.

## Politeness

Human-paced delays before every request, aggressive session reuse (login as
rarely as possible), modest page sizes. The site advertises 300/min for the
official API; we stay far below that.

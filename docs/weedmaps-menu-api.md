# Weedmaps Menu API (2025-07) — Grounded Reference

Source of truth: owner-supplied Weedmaps developer documentation (25 PDFs,
`weedmaps_part_1..25.pdf`, extracted to `wm_all.txt`). Only VERIFIED facts from those
documents are recorded here. Where the docs reference an external interactive "API
Examples" page that was NOT inlined in the PDFs, that gap is called out explicitly under
"Not fully specified in source" — we do NOT guess those field shapes.

## Hosts, versions, base URLs

| Concern | Value | Source |
|---|---|---|
| Menu API base URL | `https://api-g.weedmaps.com/wm/` | part 1 |
| Menu API versioned path | `https://api-g.weedmaps.com/wm/2025-07/partners/...` | parts 2, 14 |
| Orders API base URL | `https://api-g.weedmaps.com/oos/2026-01` | part 22 |
| Auth | **OAuth 2.0**, Bearer access token, **HTTPS only** | part 22 |
| Menu API OpenAPI spec | `https://api-g.weedmaps.com/wm/2025-01/openapi_doc` (no changes 2025-01→2025-07) | part 24 |
| Orders API OpenAPI spec | `https://api-g.weedmaps.com/oos/2026-01/openapi` | part 22 |

OAuth docs (token URL not inlined in PDFs — see "Not fully specified"):
`/docs/oauth`, `/docs/obtaining-an-access-token`, `/docs/making-authorized-request`.

## Domain model
Organization → Listing(s) → Menu(s) → Menu Item(s). A retailer may have multiple menus
per listing. The integration target is the **Menu** (by `menu_id`), NOT the legacy WMID
listing id. The same id is called the **merchant id** in the Orders API.

## Menus

| Method | Path | Purpose |
|---|---|---|
| GET | `/wm/2025-07/partners/menus` | List menus (auth-scoped to the token's partner) |
| GET | `/wm/2025-07/partners/menus/{menu_id}` | Retrieve a single menu / verify access |

- Verify write access before writing: `GET /partners/menus/{menu_id}` → **200** = access,
  **404** = no access / not found.
- Filter by organization: `?filters[organization_id]={org_id}` and `page_size`.
- Menu response shape (verified, part 14):
  ```json
  { "data": [ { "id": 636708886, "name": "...", "items_count": 33, "features": [],
    "organization": { "id": 89188, "name": "..." }, "updated_at": "2025-07-21T00:14:32Z" } ],
    "meta": { "page": 1, "per_page": 20, "total": 1 } }
  ```

## Menu Items — management strategies (verified)

Two strategies (2025-07):

### Direct Management (Weedmaps-generated id; we store it)
| Method | Path | Purpose |
|---|---|---|
| POST | `/partners/menus/{menu_id}/items` | Create a menu item (returns `id`) |
| GET | (by id) | Retrieve a single menu item |
| PATCH | (by id) | Update a menu item |
| DELETE | (by id) | Delete a menu item |
| GET | `/partners/menus/{menu_id}/items` | List all items for a menu |

### Indirect Management (our `external_id`; stateless upsert) — RECOMMENDED for sync
| Method | Path | Purpose |
|---|---|---|
| PUT | upsert by external id | Create-or-update by `external_id` |
| DELETE | delete by external id | Delete by `external_id` |

- **`external_id` is REQUIRED** on every menu item. It must uniquely + STABLY identify the
  item. **Do NOT tie it to a batch/inventory shipment** (those churn). If `external_id`
  changes, Weedmaps treats it as a brand-new item and **loses all curated data** (brand
  links, attributes from ML / manual merchandising / curation). → use our stable POS
  product key.
- **`external_product_id`** (optional): our internal Brand-Product id; helps Weedmaps cache
  Brand-Product linking and auto-link across locations in the same Organization.
- PUT (indirect) returns the **same response structure** as Direct (brand, product, strain,
  tags, etc.).

### Paused integrations (verified)
A retailer can pause the integration at any time. While paused: create/update/delete
return **423 Locked**; reads still work. Build for this.

## Required fields on a Menu Item (verified)
- **`external_id`** — required (see above).
- **At least one valid Category** — required. Provide `category_ids` (preferred) OR
  `category_names` (mutually exclusive). Exactly **one Root (L1) category** is allowed;
  more than one root → **HTTP 422** ("Categories must assign one and only one root category").
- For a **sub-category**, you must send the **full parent chain** of `category_ids`
  (root → L2 → L3), e.g. `"category_ids": [1, 2, 3]`. Sub-category alone → 422.

## Enrichment / linking fields (verified)
All "id" vs "name" pairs below are **mutually exclusive**; ids are preferred; unmatched
names are **silently ignored (no error)**.

| Link | Id field | Name field | Notes |
|---|---|---|---|
| Brand | `brand_id` (int) | `brand_name` (string) | name alone still displays the brand |
| Brand Product | `product_id` (int) | — | inherits official imagery/desc/cannabinoids/etc. Pair with `external_product_id`. |
| Categories | `category_ids` (int[]) | `category_names` (csv string) | required; one root |
| Strain | `strain_id` (int) | `strain_name` (string) | |
| Discovery Tags | `tag_ids` (int[]) | `tag_names` (csv string) | groups: Effects, Flavors, Material, Dietary |
| Cannabinoids | `cannabinoids[]` | — | each entry: `{id|slug, percentage:{min,max}, milligrams:{min,max}}` |
| Terpenes | `terpenes[]` | — | same Measurement shape as cannabinoids |

### Measurement object (cannabinoids & terpenes, verified)
```json
{ "percentage": { "min": 0.0, "max": 0.0 }, "milligrams": { "min": 0.0, "max": 0.0 } }
```
A measurement entry needs the cannabinoid/terpene `id` (or `slug`) plus a percentage
and/or milligrams range (each with min + max floats). (Response form uses `percent`.)

### Clearing links (verified)
- `{ "brand_id": null }` does NOT clear the product — brand is re-inferred from the product.
- To clear both: `{ "brand_id": null, "product_id": null }`.
- **Do not overwrite manual/curated Brand-Product links.** Only send attributes that
  changed on our side; persist the Weedmaps `product_id`.

## Reference data lookups (verified GET operations, all under `/wm/2025-07/partners/`)
- `GET /brands`, `GET /brands/{brand_id}`, `GET /brands/{brand_id}/products`,
  `GET /products/{id}`, `GET /products/{id}/reviews`
- `GET /categories`, `GET /categories/tree` (tree gives category_id, name, slug, parent_id)
- `GET /cannabinoids` — `{id, slug, symbol, name, updated_at}` (e.g. id 36 = thc)
- `GET /terpenes` — `{id, slug, symbol, name, updated_at}`
- `GET /strains` — `{id, name, updated_at}`
- `GET /tags` (Discovery Tags) — `{id, slug, name, published, updated_at, group}`
- Common filters: `filters[published]=true`, `filter[name][match]`,
  `filter[updated_at][gte]` (sync), `page`, `page_size`.

## Category Root (L1) list (verified, part 16)
Concentrates, Cultivation, Drinks, Edibles, Flower, Gear, Infused Pre Roll, Other,
Pre Roll, Vape Pens, Wellness. (Each L1 has L2/L3 sub-trees; fetch live via category tree.)

## Errors / status codes (verified)
- **200/201** success.
- **404** menu not accessible / not found.
- **422** validation (e.g. category root rule) — body `{errors:[{status,title,detail,source:{pointer}}]}`.
- **423 Locked** integration paused (write blocked, read allowed).
- **429** rate limited (callbacks section); retry/backoff.

## Orders API (2026-01) — verified, for a LATER slice (not built now)
- Inbound **callbacks/webhooks** (HTTP POST) for `DRAFT` (sync, confirm availability/totals)
  and `CREATE` (async, `PENDING`). Verify with **HMAC-SHA256 over the raw JSON body**, key =
  per-integration **client secret** (v4 UUID), Base64-encoded, compared to `Signature` header.
- Status update: `PUT /oos/2026-01/merchants/{listing_id}/orders/{order_id}` body
  `{ "status": ..., "canceledReason"?: ... }`.
- Statuses: DRAFT, PENDING, IN_PROGRESS, READY_FOR_ATTAINMENT, COMPLETE,
  CANCELED_CUSTOMER, CANCELED_SELLER, FAILED.
- Canceled reasons: OUT_OF_STOCK, CUSTOMER_REQUEST, PAYMENT_FAILURE, FRAUD_DETECTED,
  POS_CLOSED, DELIVERY_ISSUE, ORDER_TOO_EXPENSIVE, ID_ISSUE, CUSTOMER_NO_SHOW,
  EXCEEDS_LIMIT, OTHER.
- Order line item fields seen in payloads: `externalId`, `name`, `brand`, `originalPrice`,
  `salePrice`, `adjustedPrice`, `quantity`, `unitOfMeasure {unit, value}`, `weightBreakpoint`
  (GRAM/UNIT), `wmProductId`, `integratorMetadata {product_id, sell_by}`.
- Order Callback onboarding/setup is facilitated by Weedmaps: integrations@weedmaps.com.

## Sync workflow (verified guidance)
- Use the `filter[updated_at][gte]` filters to sync reference data (brands/etc.) periodically.
- Prefer **Indirect Management (PUT by external_id)** for frequent, stateless syncing of a
  full menu; use Direct (POST/PATCH/DELETE) when fine-grained id control is needed.
- POS remains the source of truth; adjust quantities/stock via item updates.

## Authentication — VERIFIED (Obtaining an Access Token + Authorized Requests + Rate Limits)
- **Token endpoint:** `POST https://api-g.weedmaps.com/auth/token` (NOT under `/wm/...`).
- **Request body (JSON):**
  ```json
  {
    "client_id": "...",
    "client_secret": "...",
    "grant_type": "client_credentials",
    "scope": "taxonomy:read brands:read products:read menu_items menus:write"
  }
  ```
- **Success: `201 Created`** with
  `{ access_token, token_type:"Bearer", expires_in:1209600, scope, created_at }`.
  The token is a JWT (`exp`, `iss`, `wm.client_id`).
- **Token lifetime: 14 days (1,209,600 s).** A new token is only issued after **50% of
  lifetime (7 days)** has passed OR if requested with a **different scope**; otherwise the
  SAME token is returned. → Cache the token; call `/auth/token` roughly **every 8–14 days**.
- **`/auth/token` rate limit: 1 request per minute** (and it still counts against the global
  limit). NEVER request a token per API call.
- **CRITICAL — inspect granted scopes:** you are NOT guaranteed all requested scopes. Always
  read the `scope` field in the token response; a missing scope causes `403 Invalid Scope`.
- **Authorized requests:** header `Authorization: Bearer {access_token}` on every call.
  - Token missing/invalid/expired → **401 Unauthorized**.
  - Token valid but lacks scope → **403 Forbidden** (`Invalid Scope`).
  - Expired tokens **cannot be refreshed** — request a new one.
- Once a listing adds you as integrator, an existing token automatically grants access to
  their listing data (no new token needed per listing).

## Rate limiting — VERIFIED
- **Global: 2,500 requests/minute per integrator, enforced at 420 requests / 10 seconds**
  across all endpoints.
- **`/auth/token`: 1 request/minute** (separate, stricter).
- On **429 Too Many Requests**: back off (exponential), reduce polling, consolidate requests.

## Error handling — VERIFIED
- **422 Unprocessable Entity** — invalid create/update data: prohibited terms in `name`/
  `description`, unsupported images, or the one-root-category rule.
- **401 / 403** — auth (see above). **404 / 423** — access / paused integration.
- **5xx** — treated by Weedmaps as critical incidents; retry with backoff and, if sustained,
  contact integrations@weedmaps.com.
- **Best practice:** retry **5xx and 429** with exponential backoff; **log 4xx** for review.
- Error body shape: `{ errors: [ { status, title, detail, code?, source? } ] }`.

## Images — VERIFIED (Working with Images)
- **One image per menu item.** Set/replace via `image_url` on create or
  `PATCH /wm/2025-07/partners/menu_items/{id}` body `{ "image_url": "https://..." }`.
- **Force refresh (same URL):** include `image_updated_at` (a valid UNIX timestamp). Weedmaps
  does NOT re-download an unchanged URL otherwise. Do NOT send `image_updated_at` if your
  image URLs change on every update (causes inconsistent behavior).
- Weedmaps issues a **HEAD request** to the image URL first — your host must return **200 OK**.
- **Formats: JPG and PNG only**, and the `Content-Type` header must match the real file type
  (verify with `file -b --mime-type`).

## Versioning & change monitoring — VERIFIED
- Two versioned releases/year (**January & July**); each stable version supported **≥ 2 years**
  with **≥ 18 months overlap**. `2025-07` is supported **until July 2027**.
- Stable versions are locked except critical bug fixes. RC endpoints exist for a 6-month
  preview but may break — do not use in production.
- **Do NOT use undocumented endpoints** (removable without notice).
- Monitor the **changelog** (RSS: `https://developer.weedmaps.com/changelog.rss`) /
  integrator email list. Documentation index: `https://developer.weedmaps.com/llms.txt`.

## NOT fully specified in the supplied source (do NOT guess — confirm against live API)
The PDFs now fully document **authentication, rate limits, error handling, images, and
versioning**. The one remaining deferred item is the **base menu-item write schema**:
1. **Exact base item attribute names** (e.g. `name`, `description`, price, and the
   **Menu Item Variants** price/weight schema referenced at `/docs/wm-menu-item-variants`)
   are shown via the live "API Examples" (`.../partners/menus/{menu_id}/items`) rather than
   inlined. We model these with the documented names we DID see (`name`, `description`,
   `external_id`, variant `unitOfMeasure`/`weightBreakpoint`/price from Orders payloads) and
   mark the variant price field as TENTATIVE pending the live schema. The preview/dry-run
   surfaces the exact payload so staff can validate it against the API Examples before any
   live push.

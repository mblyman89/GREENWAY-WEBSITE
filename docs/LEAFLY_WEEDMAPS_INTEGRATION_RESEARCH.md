# Leafly + Weedmaps Menu Syndication — Professional Integrator Research (Task X)

AI-READABLE GROUNDING DOCUMENT. This file records only VERIFIED facts and is the
source of truth for the syndication sync engine, the integrations UI, and the
AI integrator assistant. Never guess beyond it.

Sources:
- Leafly: owner-supplied OpenAPI spec `leafly_menu_api_v2.json` + deep-research
  report, recorded in `docs/leafly-menu-api-v2.md` (repo source of truth).
- Weedmaps: owner-supplied 2025-07 developer PDFs recorded in
  `docs/weedmaps-menu-api.md`, PLUS the live developer portal re-verified on
  2026-07-12: `https://developer.weedmaps.com/llms.txt`, the Menu Items guides,
  Indirect Management guide, Obtaining An Access Token guide, and the full
  OpenAPI `Request_MenuItem` schema from the POST/PUT reference pages.

---

## 1. Leafly Menu Integration API v2.0 (PRIORITY channel)

### Hosts & auth
| Concern | Value |
|---|---|
| Sandbox base | `https://api-sandbox.leafly.io/v2/menu_integration` |
| Production base | `https://api.leafly.com/v2/menu_integration` |
| Sandbox token URL | `https://sso-sandbox.leafly.io/token` |
| Production token URL | `https://sso.leafly.com/token` |
| Grant | OAuth2 client_credentials (HTTP Basic client_id:client_secret) |
| Retailer identity | Leafly-generated `menu_integration_key` in the URL path |

### Operations
- `POST /{key}/menu/items` — FULL SYNC. Updates matching ids, inserts new,
  **deletes anything not in the payload**. Recommended once/day.
- `PUT /{key}/menu/items` — UPSERT. Update-or-insert; never deletes omitted
  items. For incremental updates through the day.
- `DELETE /{key}/menu/items` — body `{ "ids": [...] }`.
- `GET /{key}/menu` — sandbox only (production returns 405; keep your own copy).
- `GET /{key}/status` — integration status + summary statistics.
- Codes: 200 success · 400 bad request · 403 invalid/missing key · 404 key not found.

### Payload rules (certification-relevant)
- Root `{ "items": [...] }`, camelCase fields.
- Item: `id` (stable, REQUIRED), `name`, `brandName`, `type`
  (flower/concentrate/edible/pre-roll/tincture/topicals/other), `strainName`
  (string or **null**, NEVER "NA"), `description` (**plain text only**),
  `compounds[]`, `totalThc`, `totalCbd`, `variants[]` (**≥1 required**).
- Variant: `id` REQUIRED, `price` **integer minor units (cents)**,
  `inventoryLevel` = **stock quantity** (an integer count, not a 0/1 flag),
  `medical` boolean, optional label.
- Compound: `type` (thc/thca/cbd/cbda/cbdv/cbn/…), `unit` (% or mg),
  `value` number or **null** when unknown (NEVER 0 — 0 renders as "0mg").
- Do NOT send removed v2 fields: batchId, parentBatchId, sku, tax_rate,
  price_includes_tax.

### Publishing & inventory semantics
- Items WITH inventory are auto-published on leafly.com.
- Items WITHOUT inventory import but stay UNPUBLISHED (backend only).
- Low-inventory hide thresholds are configured in the Leafly Integration
  Settings UI, not via the API.
- Processing latency: ~2.5 min sandbox, ~5 min production.

### Certification (sandbox → production)
Checklist Leafly evaluates: successful OAuth2, 200-level responses, automated
(non-Postman/curl) requests, sensible sync cadence, **consistent stable ids
across syncs**, in-stock inventory present, null handling for strain +
cannabinoids, plain-text descriptions, sensible field values. Production
coordination: partners@leafly.com · technical questions: api-support@leafly.com.

### Recommended cadence (from Leafly's own guidance)
- Initial sync / reactivation: one `POST` full menu.
- Daily: one `POST` full sync, plus `PUT`/`DELETE` for changes during the day
  (or several full POSTs per hour — both acceptable).

---

## 2. Weedmaps Menu API 2025-07

### Hosts & auth (verified live 2026-07-12)
| Concern | Value |
|---|---|
| Menu API base | `https://api-g.weedmaps.com/wm/2025-07/partners` |
| Token endpoint | `POST https://api-g.weedmaps.com/auth/token` (JSON body) |
| Token body | `{client_id, client_secret, grant_type:"client_credentials", scope:"taxonomy:read brands:read products:read menu_items menus:write"}` |
| Success | `201 Created` → `{access_token, token_type:"Bearer", expires_in:1209600, scope, created_at}` |
| Token lifetime | 14 days; a NEW token is only issued after the 7-day mark (same-scope requests before that return the SAME token) |
| Token rate limit | 1 request/minute — cache aggressively, never per-call |
| Scope warning | You are NOT guaranteed all requested scopes — inspect `scope` in the response; missing scope ⇒ 403 |
| Global rate limit | 2,500 req/min, enforced at **420 requests / 10 seconds** |
| Retry policy | Retry 429 + 5xx with exponential backoff; log 4xx |

### Menu item management (verified from live OpenAPI)
There is **no bulk items endpoint**. Every write is per item:
- **Indirect Management (RECOMMENDED for POS sync):**
  - `PUT /menus/{menu_id}/items/external/{external_id}` — upsert by OUR id.
    `name` required. Creates if missing, updates if present. Response = full
    MenuItem with all linked objects.
  - `DELETE /menus/{menu_id}/items/external/{external_id}`.
- **Direct Management:** `POST /menus/{menu_id}/items` (create ONE item, 201;
  store returned `id`), `PATCH /menu_items/{id}`, `DELETE /menu_items/{id}`,
  `GET /menu_items/{id}`, `GET /menus/{menu_id}/items`.
- Access check: `GET /menus/{menu_id}` → 200 access · 404 none · **423 paused
  (retailer paused the integration; writes blocked, reads allowed)**.

### VERIFIED write schema (Request_MenuItem, live OpenAPI 2025-07)
- `external_id` string REQUIRED, STABLE (our POS product key — NEVER a batch
  id). If it churns, Weedmaps treats it as a NEW item and all curated data
  (brand links, ML enrichment, manual merchandising) is LOST.
- `name` string (required on POST and PUT-by-external-id).
- `description` string — displayed on Weedmaps. Prohibited terms ⇒ 422.
- Categories (REQUIRED, one root only): `category_ids` int[] (preferred —
  include the FULL parent chain root→L2→L3) OR `category_names` (comma-string,
  likeness-matched, unmatched silently ignored). Mutually exclusive.
  Root L1 list: Concentrates, Cultivation, Drinks, Edibles, Flower, Gear,
  Infused Pre Roll, Other, Pre Roll, Vape Pens, Wellness.
- `brand_id` int XOR `brand_name` string (likeness autolink). NEVER overwrite
  manually-curated brand/product links — only send attributes that changed.
- `product_id` int — link to an official Brand Product; inherits the brand's
  official imagery/description/profile. Highest-value enrichment.
- `external_product_id` string|null — OUR brand-product identifier (caching aid).
- `strain_id` int XOR `strain_name` string (likeness match).
- `genetics` enum `indica|sativa|hybrid` or null.
- `cannabinoids`: array of `{id|slug, percentage:{min,max}, milligrams:{min,max}}`.
- `terpenes`: same Measurement shape (requires actual min/max values).
- `tag_ids` int[] XOR `tag_names` string[] (Discovery Tags: effects/flavors/…).
- `image_url` string (https; JPG/PNG only; host must answer HEAD 200; one image
  per item) + `image_updated_at` int|null (UNIX seconds; ONLY to force
  re-download of an UNCHANGED url — never send when urls change per update).
- `published` boolean — public visibility of the item on Weedmaps.
- `variants` array — THE price/inventory carrier. Each variant REQUIRES:
  - `external_id` string (stable per variant),
  - `price` = `{ "amount": "35.00", "currency": "USD" }` (decimal string,
    WHOLE currency units — dollars),
  - `weight` = `{ "unit": "g"|"mg"|"kg"|"oz"|"lb", "value": 3.5 }`.
  Optional: `inventory_quantity` int (**minimum 1** — omit when out of stock),
  `online_orderable` boolean, `compliance {precalculated, weight}`,
  `cart_quantity_multiplier` float ≥1.
- DEPRECATED top-level fields (do NOT send): `price`, `inventory_quantity`,
  `items_per_pack`, `license_type`, `online_orderable`, `compliance`,
  `cart_quantity_multiplier`, `sale`.

### Errors (verified)
- 401 token missing/invalid/expired (expired tokens cannot be refreshed —
  request a new one). 403 valid token but missing scope, or listing has not
  added you as integrator. 404 menu not accessible. 423 integration paused by
  the retailer. 422 validation — body
  `{errors:[{status,title,detail,source:{pointer}}]}`; common causes:
  prohibited terms in name/description, more than one root category,
  unsupported image. 429 rate limited. 5xx Weedmaps incident — backoff, and if
  sustained contact integrations@weedmaps.com.

### Enrichment value ladder (Weedmaps' own guidance)
1. **Brand Product link (`product_id`)** — highest value; inherits official
   imagery/descriptions/profiles; converts measurably better.
2. Brand link (`brand_id`/`brand_name`) — recognition + trust.
3. Categories — correct root + subcategories power search/filters/WM Orders.
4. Cannabinoids — THC/CBD shown prominently, used in filters + ranking.
5. Strain link — one of the most-searched attributes.
6. Terpenes — requires measurement values (min/max % or mg).
7. Discovery Tags — effects/flavors/material/dietary smart labels.

### Reference data (GET, all under the partners base)
`/brands`, `/brands/{id}`, `/brands/{id}/products`, `/products/{id}`,
`/categories`, `/categories/tree` (id, name, slug, parent_id), `/cannabinoids`
(id 36 = thc), `/terpenes`, `/strains`, `/tags`.
Filters: `filter[name][match]`, `filter[updated_at][gte]` (delta sync),
`filters[published]=true`, `page`, `page_size`.

### Versioning
Two stable releases/year (Jan + July), each supported ≥2 years with ≥18 months
overlap; 2025-07 supported until July 2027. Monitor
`https://developer.weedmaps.com/changelog.rss`. Never use undocumented endpoints.

---

## 3. Professional sync-engine best practices (encoded in our engine)

1. **Stable identifiers forever.** `external_id`/`id` = POS product key;
   variant ids = POS variant keys. Never batch-derived. Id churn destroys
   curated data (Weedmaps) and fails certification (Leafly).
2. **Idempotency via payload hashing.** Hash the outbound payload; skip
   identical re-sends (record "skipped — no changes") unless the owner forces.
3. **Delta awareness.** Track the id set last successfully synced per channel;
   on the next sync compute creates/updates/deletes. Weedmaps needs explicit
   per-item DELETEs; Leafly POST full-sync deletes implicitly (PUT does not).
4. **Retry with exponential backoff** on 429/5xx (250ms → 500ms → 1s, max 3);
   retry 401 ONCE after clearing the token cache; never retry 4xx validation.
5. **Client-side pacing** under the strictest limit (Weedmaps 420/10s ⇒ we pace
   item writes ≥100ms apart by default, owner-tunable).
6. **Preflight validation before any live write:** duplicate ids, missing
   names, non-positive prices, unparseable weights, missing categories —
   surfaced with severities so staff fix data BEFORE the API rejects it.
7. **Menu richness scoring:** % of items carrying brand / strain / THC / CBD /
   description / image — the owner's "information-rich menu" goal made
   measurable per channel.
8. **Full audit trail:** every preview and live attempt recorded
   (syndication_logs) with payload, response, and outcome.
9. **Health monitoring:** consecutive failures + time-since-last-success drive
   a connected/degraded/down status with plain-language recovery steps.
10. **Never auto-push.** Live writes always require explicit owner
    confirmation (standing rule) — the engine is owner-triggered.
11. **Only send what changed / never clobber curation** (Weedmaps): brand and
    product links curated on the Weedmaps side are preserved by sending
    `brand_name` only as an autolink hint and never nulling `product_id`.
12. **Honest imagery:** only the product's own approved photo is transmitted
    (never a representative substitute) — `image_url` is sent only when the
    image resolver returns an exact, non-fallback image.

## 4. Recovery runbook facts (for the wizard + AI assistant)

| Symptom | Meaning | Fix |
|---|---|---|
| Leafly 403 | invalid/missing menu integration key | re-copy key from Leafly biz portal; save in Credentials |
| Leafly 404 | key not found | key wrong or environment mismatch (sandbox key on prod URL) |
| Leafly token failure | bad client id/secret or wrong env token URL | re-check OAuth pair + environment toggle |
| WM 401 | token missing/invalid/expired | engine auto-refreshes once; else re-check client id/secret |
| WM 403 | missing scope OR listing hasn't added you | inspect granted scope; ask Weedmaps to grant menu scopes; confirm listing added you as integrator |
| WM 404 on menu | menu id wrong / no access | verify menu id in WM back office; confirm integrator link |
| WM 423 | RETAILER paused the integration | unpause in the Weedmaps listing settings (nothing to fix code-side) |
| WM 422 | validation | read errors[].detail — prohibited terms, root-category rule, or image format |
| WM/Leafly 429 | rate limited | engine backs off automatically; raise pacing delay in Tuning |
| 5xx sustained | platform incident | wait + retry; Leafly api-support@leafly.com / WM integrations@weedmaps.com |

Contacts: Leafly partners@leafly.com (production/cert), api-support@leafly.com
(technical). Weedmaps integrations@weedmaps.com.

# Leafly Menu Integration API v2.0 — Grounded Reference

Source of truth: owner-supplied `Leafly_API_Integration_Deep_Research_Report.md` and the
OpenAPI spec `leafly_menu_api_v2.json` (title "Leafly Menu Integration", version 2.0).
This file records only VERIFIED facts from those documents. Do not guess beyond them.

## Endpoints & hosts

| Concern | Value |
|---|---|
| Base URL (sandbox) | `https://api-sandbox.leafly.io/v2/menu_integration` |
| Base URL (production) | `https://api.leafly.com/v2/menu_integration` |
| OAuth token URL (sandbox) | `https://sso-sandbox.leafly.io/token` |
| OAuth token URL (production) | `https://sso.leafly.com/token` |
| Authentication | OAuth2 **client_credentials** grant |

Retailer is identified by a Leafly-generated `menu_integration_key` in the URL path.

### Operations on `/{menu_integration_key}/menu/items`

- `POST` — "Synchronize Menu by id". Full menu sync: updates matching ids, inserts new,
  **deletes any items NOT present** in the payload. Recommended once/day.
- `PUT` — "Upsert Menu Items". Update-or-insert without deleting omitted items. For
  incremental updates throughout the day.
- `DELETE` — "Delete Menu Items". Body is `{ "ids": [ ... ] }` (schema `schemas/v1/ids.json`).

Both POST and PUT bodies use schema `schemas/v2/items.json` (external $ref; shape documented below).

### `GET /{menu_integration_key}/menu`
Sandbox-only. Returns full menu. In production returns 405 Method Not Allowed — production
clients must keep their own copy of the menu.

### `GET /{menu_integration_key}/status`
Returns menu integration status + summary statistics (schema `schemas/v1/status.json`).

### Response codes
200 (success), 400 (bad request), 403 (invalid/missing key in header), 404 (key not found).

## Request body shape (POST / PUT)

Root object: `{ "items": [ Item, ... ] }`. **camelCase** convention for all fields.

### Item
- `id` (string, required) — stable identifier; reused as outbound `id`. Use consistently.
- `name` (string)
- `brandName` (string)
- `type` / category — product type: flower, concentrate, edible, pre-roll, tincture,
  topicals, other (serialized outbound as `type`).
- `strainName` (string | **null**) — null when absent (NEVER "NA").
- `description` (string) — **plain text only**, no markup.
- `compounds` (array of Compound) — see below.
- `totalThc` (Compound | null) — summary cannabinoid, same shape as a compounds entry.
- `totalCbd` (Compound | null)
- `variants` (array of Variant) — **at least one required** in POST/PUT.
- Removed in v2 (do NOT send): `batchId`, `parentBatchId`, `sku`.

### Variant
- `id` (string, **required** in v2)
- `price` (**integer, minor currency units** — cents)
- `inventoryLevel` (integer) — stock quantity (outbound name `inventoryLevel`).
- `medical` (boolean) — per-variant medical flag.
- Optional label/size/weight fields per item.
- Removed in v2 (do NOT send): `price_includes_tax`, `tax_rate`, `batchId`,
  `parentBatchId`, `sku`.

### Compound
- `type` (enum) — thc, thca, cbd, cbda, cbdv, cbn, and others.
- `unit` (string) — typically `mg` or percent.
- `value` (number | **null**) — null when absent (NEVER 0; 0 displays "0mg" instead of "unknown").

## Data-quality rules (certification-relevant)
- Strain absent → `null`, never "NA".
- Cannabinoid absent → `null`, never 0.
- Every item has ≥1 variant.
- Variant prices are integer minor units (cents).
- Consistent reuse of `id` values across syncs.
- Descriptions are plain text.
- Most variants should reflect in-stock inventory.

## Inventory / publishing semantics
- Items received WITH inventory are auto-published on leafly.com.
- Items received WITHOUT inventory are imported but UNPUBLISHED (backend only).
- Availability thresholds (low-inventory hide) are NOT API-configurable — set in Leafly
  Integration Settings UI.

## Latency
Background processing: ~2.5 min sandbox, ~5 min production before updates are visible.

## Sync strategy
- Initial sync / reactivation: `POST` full menu.
- Daily: one `POST` full menu, plus `PUT`/`DELETE` for individual changes through the day.
- Alt: multiple full `POST` syncs per hour.

## Certification (sandbox → production)
Five-stage process. Cert checklist: successful OAuth2 auth, 200-level responses,
automated (non-Postman/curl) request signatures, sensible sync cadence, consistent ids,
in-stock inventory present, null handling for strain & cannabinoids, sensible field values.
Order API requires certified Menu API first. Coordinate production via partners@leafly.com;
technical questions api-support@leafly.com.

## Contacts
- API Support: api-support@leafly.com
- Partner Ops (access, production ramp-up): partners@leafly.com

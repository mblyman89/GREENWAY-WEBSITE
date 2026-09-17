# Leafly Menu Integration API v2.0 — Grounded Reference

**Source of truth: the vendored live specs in `docs/leafly-specs/`** — specifically
`docs/leafly-specs/schemas/v2-items.json` (the request-body contract) and
`docs/leafly-specs/menu-integration-v2.openapi.json` (hosts, paths, response codes).
Provenance, URLs and md5s are recorded in `docs/leafly-specs/SOURCES.md`.

This file records only facts that are checkable against those vendored files. The machine
contract lives in `src/lib/leafly/contract-core.ts` and is asserted against the vendored
schema by `tests/compliance/leafly-contract.test.ts`. **If you change a claim here, the
test must still pass** — that is deliberate.

> ### Why this document was rewritten (read this before editing)
>
> The previous version of this file was grounded on an **owner-supplied copy** of the spec
> rather than the live document, and it asserted two things that are false:
>
> 1. *"**camelCase** convention for all fields."* — Wrong. v2 is camelCase **except
>    `total_thc` and `total_cbd`**, which are snake_case.
> 2. That v2 had no image field. — Wrong. `imageUrl` exists, and *omitting it deletes any
>    existing image.*
>
> Those two errors produced **eight field-level defects** in `src/lib/leafly/payload-core.ts`.
> Validating the payload our code actually generates against Leafly's published JSON Schema
> returned four hard schema errors, meaning the first real menu push would have been
> rejected with **HTTP 400 on every item** before any credential was exercised.
>
> The v1→v2 diff shows how the mistake happened. Leafly renamed `image_url → imageUrl`,
> `inventory_level → inventoryLevel` and `available_for_pickup → availableForPickup`, but
> left `brand` and `strain` untouched and then **added `total_thc`/`total_cbd` as new
> snake_case fields**. Someone saw the renames and generalised them into a rule that does
> not exist. **Do not "tidy" the field names into uniform camelCase.** It will re-break the
> cannabinoid fields and 400 every item.

## Endpoints & hosts

| Concern | Value |
|---|---|
| Base URL (sandbox) | `https://api-sandbox.leafly.io/v2/menu_integration` |
| Base URL (production) | `https://api.leafly.com/v2/menu_integration` |
| OAuth token URL (sandbox) | `https://sso-sandbox.leafly.io/token` |
| OAuth token URL (production) | `https://sso.leafly.com/token` |
| Authentication | OAuth2 **client_credentials** grant |

The retailer is identified by a Leafly-generated `menu_integration_key` in the URL path.

Note a trap in the OpenAPI document itself: the **production** token URL is the one carried
in the structured `flows.clientCredentials.tokenUrl` field, while the **sandbox** URL
appears only in the prose `description`. Reading the structured field alone points you at
production. Both URLs above are also present in `src/lib/leafly/config.ts` and verified
correct. `sso-sandbox.leafly.io/token` was probed live: it answers `invalid_request` with
no credentials and `invalid_client` with junk credentials, and its OIDC discovery document
advertises both `client_secret_basic` and `client_secret_post`, so the HTTP Basic form used
by `push.ts` is supported.

### Operations on `/{menu_integration_key}/menu/items`

All three write operations live on `/menu/items` — there is no write endpoint on `/menu`.

- `POST` — "Synchronize Menu by id". Full menu sync: updates matching ids, inserts new
  ones, and **deletes any item NOT present in the payload**. Recommended once per day.
- `PUT` — "Upsert Menu Items". Update-or-insert **without** deleting omitted items. For
  incremental updates during the day.
- `DELETE` — "Delete Menu Items". Body is `{ "ids": [ ... ] }`
  (schema `docs/leafly-specs/schemas/v1-ids.json` — still a v1 schema in v2).

POST and PUT bodies both use `docs/leafly-specs/schemas/v2-items.json`.

### `GET /{menu_integration_key}/menu`

**Sandbox only.** Returns the full menu. Other environments return `405 Method Not
Allowed`. Leafly explicitly warns that "the schema is subject to change and this endpoint
is provided only to aid in development" — so it is fine for eyeballing a sandbox push, but
nothing may depend on its shape.

### `GET /{menu_integration_key}/status`

Returns integration status and summary statistics
(schema `docs/leafly-specs/schemas/v1-status.json`).

This endpoint is a free diagnostic and worth using deliberately. It reports
`totalItemCount`, `integratedItemCount`, `manualItemCount`, `lastSyncedAt` and
`lastModifiedAt`. Per Leafly's own field description, when `lastSyncedAt` and
`lastModifiedAt` differ, "the last menu sync led to no changes" — which is exactly how to
tell an accepted-but-inert push from a real update.

### Response codes

| Operation | Documented responses |
|---|---|
| `POST /menu/items` | `200`, `400`, `403`, `404` |
| `PUT /menu/items` | `200`, `400`, `403`, `404` |
| `DELETE /menu/items` | `200`, `403`, `404` |
| `GET /menu` | `200`, `403`, `404` |
| `GET /status` | `200`, `403`, `404` |

`403` means an invalid or missing key; `404` means the key is not found. Only POST and PUT
document a `400`, because they are the only operations carrying an items payload — a `400`
here is a schema violation, and the eight defects below were all of that kind.

## Request body shape (POST / PUT)

Root object: `{ "items": [ Item, ... ] }`, with `items` required.

**Field naming is camelCase with exactly two snake_case exceptions: `total_thc` and
`total_cbd`.** The authoritative list is `LEAFLY_ITEM_FIELDS` / `LEAFLY_VARIANT_FIELDS` /
`LEAFLY_COMPOUND_FIELDS` in `src/lib/leafly/contract-core.ts`.

### Item

Required: **`id`, `type`, `name`, `variants`**. Everything else is optional.

| Field | Type | Notes |
|---|---|---|
| `id` | string, **required** | Unique across the menu; must stay stable between syncs. |
| `type` | string, **required** | **Free text, NOT an enum** — see the warning below. |
| `name` | string, **required** | `minLength: 1`. |
| `variants` | array, **required** | `minItems: 1` — every item needs at least one variant. |
| `strain` | string \| **null** | `null` when absent, never `"NA"`. Auto-links to Leafly's strain page when recognised. |
| `brand` | string | Auto-links to Leafly's brand page when recognised. Not nullable — omit it instead. |
| `compounds` | array | Lab results. Currently THC/CBD; Leafly says terpenes will follow. |
| `total_thc` | object | **snake_case.** `{ content, unit }` — an object, not a bare number. |
| `total_cbd` | object | **snake_case.** `{ content, unit }`. |
| `description` | string | Plain text, no markup. |
| `availableForPickup` | boolean | Whether the item is orderable via Leafly pickup. **Omit to preserve the current setting; new items default to `false`.** |
| `imageUrl` | string \| null, `format: uri` | Product image. **Omitting or nulling it REMOVES any existing image.** Cached by Leafly shortly after receipt. |

Removed in v2 — never send: `available_for_pickup`, `image_url` (both renamed),
`batchId`, `parentBatchId`, `sku`.

> **`type` is free text, and that makes it the most dangerous field in the payload.** The
> schema constrains it only by `minLength: 1`, so a wrong value does **not** produce a
> `400` — Leafly silently funnels the item into the wrong category on the storefront. The
> ten funnel targets, verbatim from the schema, are:
>
> `Accessory`, `Seeds`, `Clone`, `Flower`, `Edible`, `PreRoll`, `Concentrate`,
> `Cartridge`, `Topical`, `Other`
>
> Note the exact casing. `flower`, `pre-roll`, `topicals` and `tincture` — which
> `payload-core.ts` emits today — are **not** funnel targets. There is no `tincture`
> target at all; a tincture belongs under `Concentrate` or `Other`, which is a judgement
> call the owner should confirm rather than a fact this document can assert.

### Variant

**All six fields are required: `id`, `medical`, `price`, `amount`, `unit`,
`inventoryLevel`.**

| Field | Type | Notes |
|---|---|---|
| `id` | string \| number, **required** | Unique across the menu; stable between syncs. **Takes precedence over the item-level `id` for order-integration purposes** — so this is the id that will come back on a Leafly order. |
| `medical` | boolean, **required** | `true` only if the variant is a medical product. |
| `price` | **integer**, **required** | **Minor currency units (cents)**, `minimum: 1`. Matches AGENTS rule 8. |
| `amount` | number, **required** | The count of `unit` — e.g. `3.5` with `unit: "g"`. |
| `unit` | enum, **required** | One of `oz`, `g`, `each`. |
| `inventoryLevel` | number, **required** | Saleable packages in stock, `minimum: 0`. **Leafly internally caps the value at 10**, so a push of 250 and a push of 11 are indistinguishable downstream. |

Removed in v2 — never send: `inventory_level` (renamed), `batch_id`, `parent_batch_id`,
`price_includes_tax`, `sku`, `tax_rate`.

### Compound

Required: **`type`, `content`, `unit`**. The value field is `content`, **not** `value`.

- `type` — enum, 25 values: `thc`, `cbd`, `cbc`, `cbca`, `cbcv`, `cbda`, `cbdml`, `cbdv`,
  `cbdva`, `cbg`, `cbga`, `cbl`, `cbla`, `cbn`, `cbna`, `cbt`, `tac`, `thca`, `thcha`,
  `thc_d8`, `thc_d9`, `thc_d10`, `thcml`, `thcv`, `thcva`. All lowercase.
- `content` — number \| **null**. `22.06` means 22.06 %; `100` means 100 mg. **Use `null`
  for unknown or untested, never `0`** — `0` renders as a real "0 mg" reading rather than
  "unknown".
- `unit` — enum, **`percent` or `mg` only**. The literal `"%"` is **not** legal.

`total_thc` and `total_cbd` use the same `{ content, unit }` shape, with both properties
required when the object is present.

### `type` governs which units are legal

`variant.unit` and `compound.unit` are not free choices — Leafly documents them per item
type. Encoded as `LEAFLY_TYPE_UNIT_MATRIX` in `contract-core.ts`:

| Item type | Valid `variant.unit` | Valid `compound.unit` |
|---|---|---|
| `Accessory` | `each` | — |
| `Seeds` | `each` | — |
| `Clone` | `each` | — |
| `Flower` | `g`, `oz` | `percent` |
| `Edible` | `each` | `mg` |
| `PreRoll` | `each` | `percent` |
| `Concentrate` | `each`, `g` | `percent` |
| `Cartridge` | `each`, `g` | `percent` |
| `Topical` | `each` | — |
| `Other` | `each` | ignored |

So an ounce of flower measured in milligrams, or a brownie measured in percent, is a
data-quality defect even though each value is individually in-enum. Compounds on `Other`
items are ignored outright.

## Known defects in our current implementation (Slice L-2 fixes these)

Recorded here so the next slice has an exact worklist. Every row was confirmed by
validating our generated payload against the vendored schema.

| # | Our code emits | Leafly expects | Failure |
|---|---|---|---|
| 1 | `compounds[].value` | `compounds[].content` | **400** — missing required `content` |
| 2 | `compounds[].unit = "%"` | `"percent"` | **400** — not in enum |
| 3 | *(absent)* | `variants[].amount` | **400** — missing required |
| 4 | *(absent)* | `variants[].unit` | **400** — missing required |
| 5 | `brandName` | `brand` | silent data loss |
| 6 | `strainName` | `strain` | silent data loss |
| 7 | `totalThc` | `total_thc` | silent data loss |
| 8 | `totalCbd` | `total_cbd` | silent data loss |
| 9 | `type: "flower"`, `"pre-roll"`, `"topicals"`, `"tincture"` | `Flower`, `PreRoll`, `Topical`, … | silent miscategorisation |
| 10 | *(absent)* | `imageUrl` | images never reach Leafly; the owner's `sendImages` toggle is inert |
| 11 | *(absent)* | `availableForPickup` | items never become orderable |

`variants[].medical` is currently hardcoded `false`. **For today that value is correct** —
Greenway is not yet DOH-certified and is selling recreational only — but it is a hardcoded
constant rather than a value derived from endorsement status, so it must be revisited when
the endorsement lands. See `docs/medical-doh-requirements.md`.

## Data-quality rules (certification-relevant)

- Strain absent → `null`, never `"NA"`.
- Cannabinoid absent → `null`, never `0`.
- Every item carries ≥ 1 variant.
- Variant prices are integer minor units (cents).
- `id` values are reused consistently across syncs.
- Descriptions are plain text.
- Variant inventory should reflect that **most items** are in stock. Leafly's wording is
  *"Variants contain inventory that reflect most items are in stock"* — the graded unit is
  the item, not the variant, and one in-stock size is enough to publish an item (finding
  L-20).

## Inventory / publishing semantics

- Items received **with** inventory are auto-published on leafly.com.
- Items received **without** inventory are imported but **unpublished** (backend only).
- Low-inventory hide thresholds are **not** API-configurable — they live in the Leafly
  Integration Settings UI.

## Latency

Background processing runs roughly 2.5 minutes in sandbox and 5 minutes in production
before changes become visible. Budget for this when testing: an immediate `GET /menu` after
a push can legitimately show the old menu.

## Sync strategy

- Initial sync or reactivation: `POST` the full menu.
- Daily: one full `POST`, plus `PUT`/`DELETE` for individual changes through the day.
- Alternative: several full `POST` syncs per hour.

## Certification (sandbox → production)

A five-stage process. The checklist Leafly grades against: successful OAuth2
authentication, 200-level responses, automated request signatures (not Postman/curl),
a sensible sync cadence, consistent ids, inventory reflecting that **most items** are in
stock, correct `null` handling for strain and cannabinoids, and sensible field values.

Two consequences worth planning around. **The Order API requires a certified Menu API
first**, so menu defects block the order work. And `push.ts`'s 401-retry-once plus
429/5xx exponential backoff is not a nicety — resilient, automated request behaviour is
part of what is being graded.

Coordinate production access via `partners@leafly.com`; technical questions to
`api-support@leafly.com`.

## Contacts

- API support: `api-support@leafly.com`
- Partner ops (access, production ramp-up): `partners@leafly.com`

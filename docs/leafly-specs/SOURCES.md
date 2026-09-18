# Leafly API specifications — vendored sources (AUTHORITATIVE)

These files are **verbatim copies of Leafly's live published specifications**, retrieved
directly from Leafly's documentation host. They are the source of truth for every Leafly
field name, type, enum and required-flag in this repository.

**Do not hand-edit any file in this directory.** Re-download it instead (see below) and
re-run the contract tests. Hand-editing a vendored spec destroys the only independent
check we have on our own payload code.

## Why these are vendored

`docs/leafly-menu-api-v2.md` was previously grounded on an **owner-supplied copy** of the
spec rather than the live document. That copy said Leafly v2 used "camelCase for ALL
fields" and had no image field. Both statements were false, and eight field-level defects
in `src/lib/leafly/payload-core.ts` descend directly from them. A prose document cannot
fail CI; a vendored machine-readable schema can, and now does
(`tests/compliance/leafly-contract.test.ts`).

## Retrieval

| File | Live URL | md5 |
|---|---|---|
| `menu-integration-v2.openapi.json` | `https://docs.leafly.io/menu-integration-docs/v2.json` | `df77378ba607452a70281967a37b3496` |
| `order-api-v1.openapi.json` | `https://docs.leafly.io/api-api/reservations-api/docs/order-api/order.json` | `daab7bcf6f77177de85425adf7f805f1` |
| `schemas/v2-items.json` | `https://docs.leafly.io/menu-integration-docs/schemas/v2/items.json` | `1f57b1f657a233f7d39f0ef89218685c` |
| `schemas/v2-show.json` | `https://docs.leafly.io/menu-integration-docs/schemas/v2/show.json` | `a8dc70de57e0f9a80c33707fa47bde1d` |
| `schemas/v1-items.json` | `https://docs.leafly.io/menu-integration-docs/schemas/v1/items.json` | `b5d36afcf6bdad9c1a766f60ba97af88` |
| `schemas/v1-ids.json` | `https://docs.leafly.io/menu-integration-docs/schemas/v1/ids.json` | `23f9f0cd1612b3cb94ff7ebe0d08bc53` |
| `schemas/v1-status.json` | `https://docs.leafly.io/menu-integration-docs/schemas/v1/status.json` | `f261b0fa331833dd64cfb2b79697b9a6` |

**Retrieved:** 2026-09-17 (UTC). `schemas/v2-show.json` added later the same day during
slice L-4; every other file re-verified at that time (see below).

`v1-items.json` is kept deliberately, even though v1 is superseded: the v1→v2 **diff** is
what proves which fields were actually renamed, and it is the evidence that the
"camelCase for ALL fields" claim was a mis-generalisation of a partial rename.

## `schemas/v2-show.json` — the readback contract, added in slice L-4

This file was **named by the OpenAPI document but never vendored** in slice L-1. The
`GET /{menu_integration_key}/menu` operation declares its 200 response as
`{"$ref": "schemas/v2/show.json"}`, and slice L-4 needed to read a menu back and reconcile
it, which is impossible without the response contract. Retrieved live, byte-identical to
the download (`cmp` clean).

**It is a different contract from `v2-items.json`, not a mirror of it.** Read the warning
in `src/lib/leafly/readback-core.ts` before using it. Two of its field names —
`brandName` and `strainName` — are precisely the wrong names that produced defects L-06
and L-07 in `payload-core.ts`. They are correct *here*, on the way in, and catastrophic on
the way out. Do not use this schema as a guide to what to POST.

**Freshness re-check performed in L-4.** `schemas/v2/items.json` was re-downloaded from
Leafly and its md5 compared with the copy vendored in L-1:

```
1f57b1f657a233f7d39f0ef89218685c   freshly downloaded 2026-09-17 (L-4)
1f57b1f657a233f7d39f0ef89218685c   docs/leafly-specs/schemas/v2-items.json (L-1)
```

Identical — the write contract that slices L-2 and L-3 were built against has not drifted.

## Re-downloading

Leafly's docs are rendered by ReDoc, so the documentation URL returns a JavaScript shell
with no API content — `curl` of the `.html` page is useless. The real spec is named in the
page's `<redoc spec-url="...">` attribute. Fetch the JSON directly:

```bash
cd docs/leafly-specs
curl -sS -o menu-integration-v2.openapi.json \
  https://docs.leafly.io/menu-integration-docs/v2.json
curl -sS -o schemas/v2-items.json \
  https://docs.leafly.io/menu-integration-docs/schemas/v2/items.json
curl -sS -o schemas/v1-items.json \
  https://docs.leafly.io/menu-integration-docs/schemas/v1/items.json
curl -sS -o schemas/v1-ids.json \
  https://docs.leafly.io/menu-integration-docs/schemas/v1/ids.json
curl -sS -o schemas/v1-status.json \
  https://docs.leafly.io/menu-integration-docs/schemas/v1/status.json
curl -sS -o order-api-v1.openapi.json \
  https://docs.leafly.io/api-api/reservations-api/docs/order-api/order.json
md5sum *.json schemas/*.json      # update the table above
npm run test -- tests/compliance/leafly-contract.test.ts
```

Then reconcile: if a field name, enum or required-flag changed, `leafly-contract.test.ts`
will fail. **Fix the code and `docs/leafly-menu-api-v2.md`, then update the md5 table** —
in that order. A failing contract test is the system working as designed.

## URL CORRECTION, SLICE L-5

The order-api URL recorded above was updated in L-5. The address this file
originally carried,
`https://docs.leafly.io/reservations-api/order-api/order.json`, now answers
**301** (moved); Leafly has relocated it to
`https://docs.leafly.io/api-api/reservations-api/docs/order-api/order.json`,
which answers **200**.

Verified before changing anything here, because a moved URL and a CHANGED
document are very different problems and the checksum is the only thing that
tells them apart: the file fetched from the new address is **byte-identical** to
the vendored copy, md5 `daab7bcf6f77177de85425adf7f805f1`, unchanged from when
it was first vendored in L-4. So the document did not move on from us -- only
its address moved. Nothing downstream needed re-deriving.

Recorded rather than silently edited so that a future reader who finds the old
URL in an older commit knows it was a relocation and not a different spec.

## Confirmed NOT to exist (checked, 404)

Do not go looking for these again; their absence is a verified fact, not an oversight:

- `menu-integration-docs/v3.json` — **there is no v3.** v2.0 is current as of retrieval.
- `schemas/v2/item.json` and `schemas/v2/variant.json` — the item and variant contracts
  exist only **inline** inside `schemas/v2/items.json`, which is therefore the single
  authoritative definition of a menu item **for writes**.

> **Correction made in slice L-4.** The line above originally ended "...the single
> authoritative definition of a menu item", full stop. That phrasing was too broad and it
> is the reason nobody fetched `schemas/v2/show.json` in L-1: it reads as though
> `items.json` is the only v2 schema. It is not. `schemas/v2/show.json` also exists, is
> referenced by the OpenAPI document, returns `200`, and defines the **readback** shape.
> The words "for writes" have been added. The lesson generalises: when vendoring an
> OpenAPI document, enumerate **every** `$ref` in it rather than only the request bodies.
> The command that would have caught this in L-1:
>
> ```bash
> python3 -c "import json,re; \
>   print(sorted(set(re.findall(r'\"\\\$ref\": \"([^\"#]+)\"', \
>   open('menu-integration-v2.openapi.json').read()))))"
> ```

## Note on the Order API spec

`order-api-v1.openapi.json` is vendored now because it is the contract Slice L-5 will
build the six inbound webhooks against, and because parts of Leafly's docs host sit behind
Cloudflare Access — capturing it while it is reachable removes a future blocker. It is
**OpenAPI 3.1.0**, a different version from the Menu API's 3.0, and it declares its
webhooks under the top-level `webhooks` key rather than `paths`.

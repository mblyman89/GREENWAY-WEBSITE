# Greenway POS Transformer

This directory contains the active Greenway POS-to-menu transformer.

## Active command

```bash
npm run transform:pos
```

The production build runs the transformer automatically:

```bash
npm run build
```

`npm run build` is configured as:

```bash
npm run transform:pos && next build
```

## Inputs

Place the current Cultivera exports here locally:

```text
pos-data/raw/PRODUCTS.xlsx
pos-data/raw/INVENTORIES.xlsx
```

These raw workbooks are intentionally gitignored. They are operational exports, not source code.

## CI / Vercel behavior

Vercel does not receive `pos-data/raw/*.xlsx` because those workbooks are intentionally gitignored. During local builds, if both raw workbooks exist, the transformer regenerates the menu JSON. During CI/Vercel builds, if the raw workbooks are missing but `src/data/pos-menu-preview.json` already exists, the transformer logs a clear message and uses the committed JSON without regenerating. This keeps deployments stable while still allowing local POS refreshes before committing.

## Outputs

The transformer writes website data to:

```text
src/data/pos-menu-preview.json
src/data/pos-menu-sample-preview.json
```

It also writes diagnostics locally to:

```text
pos-data/generated/transform-summary.json
pos-data/generated/anomaly-report.json
```

`pos-data/generated/` is gitignored because it is a local build artifact.

## Core behavior

The Products workbook remains the source of truth for product metadata such as brand, category, strain/type, and description. The Inventories workbook contributes live operational values such as product price, units available for sale, medical flag, package size, and THC/CBD values.

Inventory rows with the same product/package/price/medical identity are treated as multiple batches or barcodes of the same sellable item. They are collapsed into one variant by summing `Units Available For Sale`. Duplicates are not deleted.

The transformer then aggressively groups related variants into one customer-facing product card using brand, website category, display name/strain family, and medical/adult split. This is intended to reduce menu clutter and make the product card variant selector more useful.

## THC display rule

For now, THC/CBD display values are only emitted for these inventory types:

- `Concentrate for Inhalation`
- `Usable Marijuana`

For those types, the Inventories workbook `Total` column is treated as a percentage. A value of `25` becomes `25%`. If the total is missing or zero, the transformer emits `N/A`.

For other inventory types, THC/CBD display values are omitted for now rather than aggressively normalized.

## Safety rules

The transformer validates required workbook columns, requires every POS category to be explicitly mapped to a website category, emits diagnostics for unmatched inventory/product rows, and validates generated menu records before writing output.

Unknown categories fail the transform so mapping mistakes are caught immediately instead of silently corrupting menu data.

## Legacy scripts

The old scripts remain in this folder for reference during the transition:

- `analyze_matching_v2.py`
- `build_pos_menu_preview.py`
- `verify_pos_menu_mapping.py`

The active implementation is `transform_pos_data.ts`.

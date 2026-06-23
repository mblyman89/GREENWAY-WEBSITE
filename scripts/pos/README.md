# POS Menu Transformer

These scripts convert Greenway POS exports into the website menu JSON.

## Expected input files

Place the latest POS exports here before running the transformer:

- `pos-data/raw/INVENTORIES.xlsx`
- `pos-data/raw/PRODUCTS.xlsx`

The Products workbook may use either a `Products` sheet or a first/default sheet. The current cleaned product export is expected to include authoritative `Type`, `Strain`, and `Description` columns.

## Run order

From the repository root:

```bash
python3 scripts/pos/analyze_matching_v2.py
python3 scripts/pos/build_pos_menu_preview.py
python3 scripts/pos/verify_pos_menu_mapping.py
```

`analyze_matching_v2.py` normalizes and matches inventory rows to product master rows.

`build_pos_menu_preview.py` generates:

- `pos-data/generated/greenway_pos_menu_preview.json`
- `pos-data/generated/greenway_pos_menu_preview_summary.json`
- `pos-data/generated/greenway_pos_menu_preview_variants.csv`
- `src/data/pos-menu-preview.json`
- `src/data/pos-menu-sample-preview.json`

The website imports the full `src/data/pos-menu-preview.json` feed. The sample JSON is retained only as an optional inspection artifact.

## Current mapping rules

- `strainType` comes directly from the cleaned Products workbook `Type` column.
- `strainName` comes from the Products workbook `Strain` column, with inventory strain as fallback.
- Customer-facing `name` uses `Strain` for cannabis products except solid edibles, liquid edibles, and topicals.
- Solid edibles, liquid edibles, and topicals use the original Product Name as the customer-facing `name`.
- Original POS product name is preserved as `productName`.
- `description` comes from the Products workbook `Description` column, with a pending-description fallback.

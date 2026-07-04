# Cultivera Product Upload Sheet

**Deliverable:** `cultivera_upload/CULTIVERA_PRODUCT_UPLOAD.xlsx`
**Generator:** `scripts/naming/build_cultivera_products_sheet.py`
**Purpose:** One batch-upload sheet the owner sends to the Cultivera rep so Cultivera
can rename every product in a single pass (Cultivera does not allow the owner to
upload their own sheets — the rep does the batch upload).

## Column layout (exactly as the Cultivera rep requires)

| Column | Contents |
| --- | --- |
| `Original Product Name` | The current, messy name straight from `PRODUCTS_UPDATED.xlsx`. This is the match key Cultivera uses to find the row. |
| `Updated Product Name` | The normalized Greenway-convention name. |
| `Receipt Name` | Identical to `Updated Product Name` (owner: "same as product name"). |
| `Strain Type` | `Indica` / `Sativa` / `Hybrid` / `CBD`, or blank when it cannot be determined from the data (never guessed). |
| `Product Description` | Left blank (we have no descriptions yet — that's fine). |

## How the sheet was built (grounded, not guessed)

- **List source:** `PRODUCTS_UPDATED.xlsx` **only** — all **3,500** rows in, **3,500**
  rows out. Nothing is dropped, added, or collapsed.
- **Name inputs:** `PRODUCTS_UPDATED` has no Vendor column and no cannabinoid
  columns, so Vendor / Brand / Strain / THC / CBD / Category are borrowed from
  `INVENTORIES_UPDATED.xlsx` by an **exact product-name match** (verified
  **3,500 / 3,500** match). Where a name maps to several inventory rows, the modal
  Vendor/Brand/Strain and the maximum labeled THC/CBD are used.
- **Naming convention** (same engine as the website + CCRS export):
  `{Vendor} {Brand} {Strain/Flavor} {Cannabinoid Tag} {Size}`
  - Vendor leads (vendors carry multiple brands).
  - Brand is dropped when it equals the Vendor **or** is a redundant token-subset of
    it (e.g. vendor `Downtown Cannabis Company` + brand `Downtown` → brand dropped).
  - **Cannabinoid tag** only appears for genuine multi-cannabinoid products. A
    co-cannabinoid must be **≥ 10 %** of the dominant one to count (a 92 % THC /
    1.7 % CBD cart is **not** tagged `20:1`). THCA/CBDA are folded into THC/CBD.
  - Size normalized: `1.000 Grams → 1g`, `2.00 FluidOunce → 2floz`, etc.
  - Commas and CCRS-disallowed characters stripped; every name ≤ **75** characters.
- **Duplicates are preserved.** Two rows with the same original name get the **same**
  normalized name and **both stay** in the sheet (owner: "they were already
  duplicates, so it should be fine to remain duplicate but normalized").
- **Strain cleanup:** cannabinoid / ratio / mg noise, strain-type words, pack tokens
  and generic placeholders (`No Strain`, `Mixed`, `Assorted`, `Paraphernalia`) are
  stripped from the flavor before it goes into the name
  (`Sour Watermelon CBN 1:1 → Sour Watermelon`, `GMO 2pk → GMO`).
- **Strain Type derivation** (priority order): explicit `(I)/(S)/(H)` marker in the
  name → an `indica/sativa/hybrid` word → a CBD-forward ratio → otherwise **blank**.
- **Non-cannabis accessories** (batteries, pipes, rolling trays, glass tips) keep a
  cleaned version of their original descriptive name (they have no strain to build
  from), so `WALNUT ROLLING TRAY → Sitka Packaging Walnut Rolling Tray`.

## Verified invariants (all pass)

- 3,500 rows; column layout exactly as required.
- `Receipt Name` == `Updated Product Name` on every row.
- Every `Updated Product Name` ≤ 75 chars, contains no comma, and is non-blank.
- Every exact-duplicate original maps to a single identical updated name.
- `Product Description` blank on every row.

## Regenerating

```bash
python3 scripts/naming/build_cultivera_products_sheet.py \
    --products    /path/to/PRODUCTS_UPDATED.xlsx \
    --inventories /path/to/INVENTORIES_UPDATED.xlsx \
    --out         cultivera_upload/CULTIVERA_PRODUCT_UPLOAD.xlsx

# unit tests (36 assertions):
python3 scripts/naming/build_cultivera_products_sheet.py --selftest
```

> **Draft, not final.** This is AI-generated output. Spot-check the sheet before
> sending it to the Cultivera rep, especially the handful of unusual reduplicated
> flavor names (e.g. "Bang Bang", "Yum Yum") and rolling-paper size tokens
> (`1 1/4` renders as `1 1 4` because `/` is CCRS-disallowed).

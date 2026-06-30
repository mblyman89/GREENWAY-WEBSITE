# WCIA Transfer Schema — Reference (Cultivera order email → our intake)

This is the authoritative analysis of the **real** vendor data Greenway receives,
derived from a live Quality Green Trees → Greenway order (Order #20636, delivered
3/13/2025). Example files live in `./examples/`. **All intake parsing targets
this schema first.**

## The big efficiency win (answers the owner's question)

The Cultivera order email contains a **WCIA Transfer Data Link** — a single JSON
URL near the top, e.g.:

```
https://files.cultivera.com/435553542D5753353031/Interop/25/10/QZ60727TG6AE020G/Cultivera_ORD-20636_413541.json
```

**That one JSON already embeds every COA link** (one per line item). There is *no
need to click the per-product "Click here to download COA" links one at a time.*
Each `inventory_transfer_items[].lab_result_data.coa` is a direct PDF URL, and
`.potency[]` already carries the THC/CBD/THCA/CBDA/total-cannabinoids numbers.

So the intake flow is: **paste (or fetch) the one transfer JSON → we extract all
products + all COAs + all potency automatically.** The PDFs (COA, manifest,
invoice) are supplementary; the JSON is the spine.

## Document shape (WCIA Transfer Schema v2.1.0)

Top-level object keys:

| Key | Example | Use |
| --- | --- | --- |
| `document_name` | `"WCIA Transfer Schema"` | format detection |
| `document_schema_version` | `"2.1.0"` | format detection |
| `document_origin` | the transfer JSON URL | provenance |
| `from_license_number` / `from_license_name` | `413632` / `QUALITY GREEN TREES` | vendor match |
| `to_license_number` / `to_license_name` | `413541` / `GREENWAY MARIJUANA` | sanity check (us) |
| `manifest_type` | `"delivery"` | manifest meta |
| `transfer_id` | `15410217973875889` | **manifest number** (matches PDF "Manifest ID") |
| `external_id` | `0000020830` | secondary ref |
| `created_at` / `transferred_at` / `est_arrival_at` | ISO timestamps | transfer/arrival dates |
| `route` | turn-by-turn text | manifest meta |
| `transporter_name` / `transporter_license` | often null in JSON (on PDF) | manifest meta |
| `inventory_transfer_items[]` | array (40 items in the example) | **the line items** |

### Each `inventory_transfer_items[]` entry

| Field | Example | Maps to our `inventory_lots` / `lab_results` |
| --- | --- | --- |
| `product_name` | `"Infused Peg Legs - Scented Marker - 2 x 0.5g"` | `product_name` |
| `inventory_id` | `15410021851532647` | `lot_code` (the WA lot/batch id; matches Invoice "Lot" + Manifest left column) |
| `sample_source_id` | `15419916741146472` | secondary lot ref / matches COA "Parent Batch ID" |
| `qty` | `15` | `received_qty` / `on_hand_qty` |
| `uom` | `"ea"` | `unit` |
| `unit_weight` + `unit_weight_uom` | `1` + `"g"` | product weight (display) |
| `line_price` | `60` | **line total**; unit cost = `line_price / qty` → minor units |
| `is_medical` | `"1"` (string!) | medical flag |
| `is_sample` | `"0"` / `"1"` | sample flag (note: $0 lines are vendor samples) |
| `inventory_category` | `EndProduct` / `IntermediateProduct` | category bucket |
| `inventory_type` | `Usable Marijuana` / `Concentrate for Inhalation` | category detail |
| `strain_name` | `"Scented Marker "` (note trailing space) | strain (trim!) |
| `product_sku` | usually `null` | `pos_product_key` (fallback to `inventory_id`) |
| `lab_result_passed` | `"passed"` | COA pass/fail |
| `lab_result_link` | a JSON URL (sometimes double-prefixed, see bug) | lab detail link |
| `lab_result_data` | object (below) | the COA |

### `lab_result_data` (the COA payload)

| Field | Example | Maps to `lab_results` |
| --- | --- | --- |
| `lab_result_id` | `WA-250209-029` *or* a long numeric id | **`labtest_external_identifier`** (the CCRS value) |
| `lab_result_status` | `"passed"` | `passed` |
| `coa` | `https://files.cultivera.com/.../COA_15419916741146472.pdf` | COA PDF URL (store in KB) |
| `lab_result_detail` | JSON URL | raw lab data link |
| `potency[]` | `[{type:"thc",value:1.562,unit:"pct"}, …]` | THC/CBD/THCA/CBDA/total |
| `lab_result_list[]` | per-COA: `coa_release_date`, `coa_expire_date`, … | release/expire dates |

`potency[].type` values seen: `cbd`, `thc`, `thca`, `cbda`, `total-cannabinoids`.
For flower the headline number is usually **THCA** (e.g. 40.28%); for vape/concentrate
it's **THC** (e.g. 84.77%). We store all of them and compute a display "total THC".

## Data quirks we MUST handle (all observed in the real file)

1. **Doubled URL prefix bug** — some `lab_result_link` / `lab_result_detail` values
   are literally `https://files.cultivera.com/https://files.cultivera.com/…`.
   Collapse a leading doubled origin before using/fetching.
2. **`is_medical` / `is_sample` are strings** (`"1"`, `"0"`), not booleans.
3. **Trailing whitespace** in `strain_name` (`"Permanent Marker "`).
4. **$0 vendor samples** — `line_price: 0` (items 36–40). Manifest tags them
   `<Vendor Sample>`; intake should default these to **0 cost** and may flag them
   as samples (not sellable inventory unless reclassified).
5. **Same lab_id split across multiple lots** — items 17/18 (and 27/28) share one
   `lab_result_id` but are separate `inventory_id` lots with different qty/price.
   We dedupe `lab_results` by `labtest_external_identifier` and link both lots to it.
6. **`unit_weight` semantics** — `unit_weight` is the per-unit product weight (e.g.
   `3.75` g for a 5-pack), NOT the pack count. Keep `uom = "ea"` for counting.
7. **`lab_result_id` is sometimes the numeric inventory id** (older COAs) instead of
   a `WA-YYMMDD-NNN` code. Either is valid as the external identifier.

## Cross-document linkage (how the 4 files relate)

- **Transfer JSON** ↔ **Invoice**: `inventory_id` == Invoice "Lot"; `line_price` ==
  Invoice "Line Total"; Invoice adds per-unit "Unit Price" + `<DOH Compliant>` tag +
  Order # (20636) + Portal Ref.
- **Transfer JSON** ↔ **Manifest**: `transfer_id` == Manifest "Manifest ID"; manifest
  lists `inventory_id` + name + qty, transporter/vehicle/driver, time windows,
  `<Vendor Sample>` tags.
- **Transfer JSON** ↔ **COA PDF**: `sample_source_id` == COA "Parent Batch ID" /
  "Origin Sample ID"; `lab_result_id` == COA "Lab Sample ID" (e.g. WA-250209-029);
  `inventory_id` == COA "Batch #".

## COA PDF structure (for KB extraction)

`pdftotext -layout` yields clean text. Key extractable blocks:
- Header: Origin (license #), Sample Name, **Lab Sample ID** (WA-…), Product Type,
  Category, Date of Completion, **Batch Pass/Fail**, **Parent Batch ID**.
- **Cannabinoid Analysis – summary**: Total d9-THC, Total CBD, Total Cannabinoids.
- **Terpene Analysis – summary**: Total Terpenes + Top Three.
- **Safety Analysis – summary**: Foreign Matter / Heavy Metals / Microbial /
  Mycotoxins / Pesticides / Solvents / Water Activity (PASS / NT / FAIL).
- Detailed per-analyte cannabinoid + terpene tables (%, mg/g, LoD/LoQ).

Because the transfer JSON already gives us potency + pass/fail + COA URL, **PDF
parsing is a KB enrichment step**, not required for intake. We store the COA PDF in
the media bucket/KB and link it to the lot + lab_result.

## Files in `./examples/`
- `QGT_FreddysFuego_ORD-20636_transfer.json` — the WCIA transfer JSON (40 items).
- `QGT_FreddysFuego_COA_QA_RESULTS.pdf` — one product's COA (5 pages).
- `QGT_FreddysFuego_MANIFEST.pdf` — the delivery manifest.
- `QGT_FreddysFuego_INVOICE.pdf` — the invoice (Order #20636).
- `email_individual_coa_links.png` — the Gmail screenshot showing per-product COA
  links (the thing we're replacing with one-JSON ingestion).

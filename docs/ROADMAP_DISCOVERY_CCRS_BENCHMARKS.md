# Roadmap — Discovery CCRS Benchmark & Insights Command Center

Status: hand-off ready. Owner-approved direction (see standing rules + WSLCB
enforcement officer confirmation on retailer benchmarking use).

## The vision
Turn the WSLCB **CCRS public-records extract** (the same "full traceability dataset" that
paid analytics firms like *Your Weed Data* / Alma Analytics resell) into an in-house
**benchmark + insights command center**, and compare it against Greenway's OWN live
POS/PO/inventory data. No web crawler, no scraping — the owner files a Public Records
Request, receives raw CSVs, and uploads them into the Discovery page; the system does the rest.

### How the pros do it (verified)
Every WA producer/processor/retailer must report monthly into CCRS: inventory, transfers,
**sales transactions**, and lab results. That dataset is obtainable under the Public Records
Act (RCW 42.56). Analytics firms request the raw CSVs, clean/model them, and publish
dashboards. We do the same — for ourselves — and layer our live data on top.

### Legal note (must persist in UI + docs)
Verbatim from lcb.wa.gov: *"Per RCW 42.56.070(8), records received through the Public Records
Act may not be used for commercial purposes."* Owner's WSLCB enforcement officer confirmed
retailer sourcing/benchmarking use is acceptable practice. Feature is owner-controlled and
fully removable via the Discovery kill-switch.

## Verified data model (see docs/CCRS_VERIFIED_SCHEMA.md — do NOT guess columns)
Key files & columns we ingest:
- **Sale**: LicenseNumber, SoldToLicenseNumber, InventoryExternalIdentifier, SaleType
  (RecreationalRetail|RecreationalMedical|Wholesale), SaleDate, Quantity, UnitPrice, Discount,
  SalesTax, OtherTax, SaleExternalIdentifier, SaleDetailExternalIdentifier.
- **Product**: LicenseNumber, InventoryCategory, InventoryType, Name, Description,
  UnitWeightGrams, ExternalIdentifier.
- **Inventory**: LicenseNumber, Strain, Area, Product, InitialQuantity, QuantityOnHand,
  TotalCost, IsMedical, ExternalIdentifier.
- **LabTest**: InventoryExternalIdentifier, LabLicenseNumber, TestName, TestValue, TestDate.
- **Strain**: Strain, StrainType.
Money columns are dollars → stored as MINOR UNITS (cents). Files may or may not carry the
3-line SubmittedBy/SubmittedDate/NumberRecords preamble → importer auto-detects the header row.
We key on column NAME (case-insensitive), never position.

## What we compute (benchmarks & insights)
1. **Wholesale price benchmark** (SaleType=Wholesale): median/avg/min/max UnitPrice per
   category, per InventoryType, per $/gram. = what stores PAY vendors → our cost target.
2. **Retail price benchmark** (SaleType=RecreationalRetail): shelf-price distribution per
   category/type → our pricing target and margin headroom.
3. **Category & type velocity/mix**: units + $ share by category over time → what's growing.
4. **Top vendors (producers/processors)** by wholesale volume/$ → best-supplier leads.
5. **Top products/brands** by retail units/$ → what to stock.
6. **Potency benchmarks** (LabTest THC/CBD) per category/strain → quality bar.
7. **Strain leaning mix** (Strain + StrainType) → assortment guidance (ties to KB).
8. **Our-vs-market comparison**: our POS sell-through & PO unit cost vs. the CCRS benchmark
   (over/under-priced, over/under-buying, margin gap). THE headline feature.
9. **Vendor lead generation**: producers/processors seen in Wholesale sales become vendor
   leads (reconciled + deduped via the existing engine), prioritized by volume.
10. **Opportunity finder**: high-velocity categories where we're under-assorted or
    over-priced vs. market.

## Data model (migration 0079 — idempotent, is_staff RLS, minor units)
- `discovery_datasets` — one row per uploaded CCRS extract batch: id, label,
  period_start, period_end, status (uploading|ready|error), row counts per file,
  source_note, uploaded_by, created_at.
- `discovery_ccrs_sales` — normalized Sale rows: dataset_id, seller_license, buyer_license,
  sale_type, sale_date, quantity_num, unit_price_minor, discount_minor, sales_tax_minor,
  other_tax_minor, inventory_ext_id, sale_ext_id, product_category, product_type,
  product_name, brand, unit_weight_grams. (Product fields denormalized in during import.)
- `discovery_ccrs_products` — dataset_id, license, category, type, name, description,
  unit_weight_grams, ext_id.
- `discovery_ccrs_lab` — dataset_id, inventory_ext_id, test_name, test_value_num, test_date.
- `discovery_ccrs_licensees` — derived roster: dataset_id, license_number, name (best-known),
  role (producer|processor|retailer|unknown), wholesale_out_$, wholesale_out_units.
- `discovery_benchmarks` — computed rollups: dataset_id, scope (category|type|category_type|
  brand|strain), scope_key, metric (wholesale_unit_price|retail_unit_price|price_per_gram|
  units|revenue|thc_pct|cbd_pct), sample_size, min_minor, p25_minor, median_minor, p75_minor,
  max_minor, avg_minor, value_num (for non-money), period_start, period_end, computed_at.
Note: raw sale rows can be large. Import keeps only cannabis Sale rows in the target period
and can be pruned per-dataset. Benchmarks are the durable artifact.

## Server layer
- `src/lib/discovery/ccrs.ts` (PURE): header auto-detect (skip preamble), column-name mapping
  (case-insensitive), row → normalized typed record for Sale/Product/Inventory/LabTest/Strain,
  dollarsToMinor reuse, brand extraction from Product.Name, price-per-gram derivation. Unit-tested.
- `src/lib/discovery/ingest.ts` (server-only): parse an uploaded file, detect which CCRS file it
  is (by header signature), batch-insert into the right discovery_ccrs_* table under a dataset,
  update dataset counts/status. Guarded by isDiscoveryEnabled + isSupabaseServiceConfigured.
- `src/lib/discovery/benchmarks.ts` (server-only + pure helpers): computeBenchmarks(datasetId)
  → aggregate percentiles per scope/metric → upsert discovery_benchmarks; deriveLicenseeRoster;
  getBenchmarksSnapshot; getBenchmarkFor(scope, key, metric); pure percentile()/summarize()
  helpers unit-tested. Also generateVendorLeadsFromCcrs(datasetId) → top producers/processors →
  createVendorLead (deduped). Never fabricates: if no rows, returns empty, no synthetic numbers.
- `src/lib/discovery/compare.ts` (server-only): join our POS velocity + PO unit costs +
  inventory vs. discovery_benchmarks → per-category comparison rows (our price vs market median,
  margin gap, sell-through vs market mix). Reuses existing reporting/store helpers; read-only.

## UI / routes (premium, professional, print-friendly)
- `/admin/discovery` hub: add a "CCRS Benchmarks" card with dataset status + a "Manage data"
  and "Get public records" affordance; keep kill-switch.
- `/admin/discovery/ccrs` — **the Public Records helper + upload center**:
  step-by-step "How to request WA CCRS data" (portal link, exact request wording, what to ask
  for, legal note), a drag/drop multi-file uploader (Sale/Product/Inventory/LabTest/Strain),
  dataset list with row counts + status, "Compute benchmarks" and "Generate vendor leads" actions.
- `/admin/discovery/benchmarks` — the insights command center: category/type/brand/strain
  benchmark tables (wholesale $, retail $, $/g, potency), velocity & mix, top vendors, top
  products; "computed from CCRS <period> on <date>" provenance labels; export.
- `/admin/discovery/benchmarks/compare` (or a tab) — **Our vs. Market**: our POS/PO/inventory
  vs. the benchmark, with over/under flags and margin-gap callouts.
- Benchmark chips on product-lead rows and the PO builder line (shows market median cost/retail
  for the category so buyers negotiate with data).
- Nav: add "CCRS Benchmarks" under Product Intake (permission inventory.manage).

## Slices (do all; don't stop until done)
1. Research docs + migration 0079 (this file, CCRS_VERIFIED_SCHEMA.md, RESEARCH_HOW_ANALYTICS...,
   0079_discovery_ccrs.sql). Types added to types.ts.
2. `ccrs.ts` pure parser/normalizer + unit tests (header detect, column map, row→record, $→minor,
   brand/pack, price-per-gram).
3. `ingest.ts` server ingest + `/admin/discovery/ccrs` upload center + Public Records helper +
   dataset actions (kill-switch guarded).
4. `benchmarks.ts` compute (percentiles per scope/metric) + licensee roster + vendor-lead
   generation from CCRS + unit tests for pure aggregation helpers.
5. `/admin/discovery/benchmarks` insights command center page + nav entry + provenance labels.
6. `compare.ts` our-vs-market + compare tab + benchmark chips on product leads & PO builder;
   verify (tsc→eslint→build→dev smoke); tick this checklist.

## Hand-off checklist / TODO
- [x] 0079 migration WRITTEN & ready (idempotent; is_staff RLS; minor units). **Owner applies manually** (standing rule).
- [x] ccrs.ts + tests green.
- [x] Upload center ingests real CCRS CSVs (auto-detects file type + preamble).
- [x] Public Records helper accurate (portal link, wording, legal note).
- [x] Benchmarks computed with percentiles; provenance labeled; never fabricated.
- [x] Vendor leads generated from CCRS wholesale, deduped/reconciled.
- [x] Our-vs-market comparison from live POS/PO/inventory.
- [x] Benchmark chip helper (`benchmarkChipForCategory`) + our-vs-market table live on Benchmarks page. (Row-level chips on PO builder: helper ready, wiring optional next pass.)
- [x] Kill-switch disables all new routes/actions.
- [x] tsc/eslint/build/dev-smoke clean; PR opened + merged.

## Removability guarantee
All new tables are `discovery_*`. All routes live under `/admin/discovery`. All actions call
`ensureEnabled()`. Dropping the feature = flip the kill-switch (hides UI, blocks writes) and,
if desired, `drop table discovery_ccrs_*` / `discovery_benchmarks` / `discovery_datasets`.
No writes to vendors/catalog/purchase_orders except the existing, opt-in lead→PO promotion.

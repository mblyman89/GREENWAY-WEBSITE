# CVB — Cultivera Benchmark: roadmap and strategy

Owner request, 2026-11-01. Owner-only. Read-only against Cultivera. Built in slices so the work does not drift.

## 1. The request (verbatim; the login line is redacted from the repository)

> I need your help using my crawl4ai web crawler to login to my Cultivera back office and scrape all sales, cogs, returns, voids, employee samples, employee purchases, discounts by employee, all reports, taxes, cycle counts, vendor records like purchase history and purchase stats, any and all data. I want to create a Cultivera benchmark report in the reports page. I want to compare Cultivera's system with ours. I want to know everything. Leave nothing out. This will help me see the results of migrating to our own system and help me justify the migration from an expense perspective. Maybe add a total build cost amount that goes down as our system outperforms theirs as well as account for the 5500 less for not using Cultivera anymore. We just now today from switching saved 5500. So we are already putting a dent in it. Total build was 40k. This will also allow me to retain Cultivera historical data safely in our system. This will be owner only access. Please clone the repo, read agents.md, the standing rules, then proceed with building everything. Break it up into manageable slices so you don't drift. My crawler has the login credentials already. I'll give you them as well, my account is set to deactivate soon so it's fine to expose the password. [credentials redacted from repo] There is another agent working in the repo, so complete all tasks and prepare them to be pushed, but do not merge them until I tell you it is safe to do so. Create a comprehensive roadmap strategy. Add a new page in the admin and a new tab to the reports page. Follow the standing rules. Thank you.

Later the same day: *"please continue working on the remaining tasks. please complete 2 more slices before stopping and reporting back with a summary report. I have another agent working on the repo and will be merging soon. it is working on inventory issues that are causing us to not be able to ring them up. so please complete all work, commit it out of the sandbox, use the shared root workspace folder to keep work safe. follow the standing rules. thank you."*

## 2. What each phrase becomes

| Owner phrase | What we build | Slice |
|---|---|---|
| "scrape all sales, cogs, returns, voids, employee samples, employee purchases, discounts by employee, all reports, taxes, cycle counts, vendor records like purchase history and purchase stats, any and all data" | The read-only archive harvester (section 4 lists every dataset, measured live) | CVB-2 (merged, #1631) |
| "retain Cultivera historical data safely in our system" | A private bucket `cultivera-archive` holding the run's files byte for byte, plus `cultivera_archive_runs` / `cultivera_archive_files` (sha256 + rows per file, append-only) | CVB-3 (0337) + CVB-5 |
| "compare Cultivera's system with ours ... I want to know everything. Leave nothing out." | `cultivera_benchmark_days` (Cultivera's own daily figures, cents) and a pure comparison core that lines them up with ours, metric by metric, and says plainly when a side has no figure | CVB-3, CVB-4, CVB-6 |
| "a total build cost amount that goes down as our system outperforms theirs as well as account for the 5500 less ... Total build was 40k" | `cultivera_payback_entries`: an append-only ledger seeded with the two stated figures ($40,000.00 build cost, $5,500.00 saved on 2026-11-01). Remaining = build cost − savings − outperformance credits ± adjustments | CVB-3, CVB-4, CVB-6 |
| "a Cultivera benchmark report in the reports page ... a new tab to the reports page" | Reports → **Cultivera Benchmark** tab (owner-only, wired like the ACH tab; separate from the existing "Benchmarks" tab, which is about our own targets) | CVB-6 |
| "Add a new page in the admin" | Admin → **Cultivera archive** page: start / continue / cancel a harvest, see progress, archive a finished run to the bucket, browse datasets | CVB-5 |
| "This will be owner only access" | Permission `cultivera.benchmark: ["owner"]`; every table service_role only (RLS on, no policies), checked on every page and every server action | CVB-5 |
| "do not merge them until I tell you it is safe" / "complete 2 more slices before stopping" | Every slice is a pushed branch with an open PR; nothing is merged by this agent unless the owner says so; patches are copied to `/workspace/cvb-safe/` | all |

## 3. Ground rules for this work

1. **Read-only against Cultivera.** The harvester reuses the Phase A client guard: only `POST api/auth/login`, then GET/POST under `data-api/`. Nothing can write to Cultivera.
2. **Never guess.** Every figure on the benchmark is either Cultivera's own number (from a stored, sha256-verified file) or ours (from our ledger). Where one side has no figure the page says "not available", never zero.
3. **Money in cents.** Cultivera answers in dollar floats (for example `GrossSales: 8684.14`). They are converted to cents once, at ingest, with a half-away-from-zero rounding to the nearest cent, and only cents are stored or compared.
4. **Pacific days.** Cultivera's daily report is keyed by Day / Month / Year in the store's time zone; our side uses `pacificDayKey`.
5. **Crawler output is a draft.** A harvest is stored and shown; it changes nothing in our books. The payback ledger only moves by an explicit owner action, and each credit carries its basis.
6. **Credentials and PII never enter the repository.** The login stays on the crawler as environment variables. Datasets marked PII (employees, users, customers, loyalty accrual) are stored only in the private bucket.

## 4. Every dataset the archive reads (measured live 2026-11-01)

Generated from `crawler/app/cultivera_archive.py` (the catalogue the harvester actually runs). Every paged dataset is verified: unique keys must equal the server's Count, or the dataset fails loudly.

| # | Dataset | Endpoint (data-api) | Page size | Key | PII | Note |
|---|---|---|---|---|---|---|
| 1 | `employees` | `employees` | 1,000 | Id | yes |  |
| 2 | `users` | `users` | 1,000 | Id | yes |  |
| 3 | `roles` | `roles` | 1,000 | Id |  |  |
| 4 | `clocks` | `clocks` | 1,000 | Id |  |  |
| 5 | `shifts` | `shifts/list` | 1,000 | Id |  | 5,000 per page returns zero rows (measured); 1,000 works |
| 6 | `discounts` | `discounts` | 1,000 | Id |  |  |
| 7 | `promotions` | `promotions` | 1,000 | Id |  |  |
| 8 | `loyalty_rules` | `loyalty-program-rules` | 1,000 | Id |  |  |
| 9 | `price_models` | `products/price-models` | 1,000 | Id |  |  |
| 10 | `categories` | `products/categories` | 1,000 | Id |  |  |
| 11 | `strains` | `products/strains` | 5,000 | Id |  |  |
| 12 | `brands` | `brands` | 5,000 | Id |  |  |
| 13 | `products` | `products` | 2,000 | Id |  | ShowNonCannabis=false is ALL products (17,605); true is non-cannabis only (189) |
| 14 | `storage_locations` | `storage-locations` | 1,000 | Id |  |  |
| 15 | `tax_settings` | `tax-settings` | 1,000 | Id |  |  |
| 16 | `vendors` | `/vendors` | 1,000 | Id |  |  |
| 17 | `vendor_transfers` | `transfers/incoming` | 2,000 | Id |  | purchase history: every inbound manifest with vendor, status and Total |
| 18 | `outbound_transfers` | `transfers/outbound` | 1,000 | Id |  |  |
| 19 | `inbound_transfer_report` | `reports/inbound-transfers` | 5,000 | Id |  |  |
| 20 | `vendor_returns` | `inventory-returns` | 1,000 | Id |  |  |
| 21 | `samples` | `samples` | 1,000 | Id |  | employee samples (budtender samples) with employee, status and quantity |
| 22 | `cycle_counts` | `inventories/cycle-counts` | 1,000 | Id |  |  |
| 23 | `inventory_discrepancies` | `inventories/inventory-discrepancies` | 1,000 | Id |  |  |
| 24 | `loyalty_adjustments` | `customers/customer-loyalty-point-adjustment` | 1,000 | Id |  |  |
| 25 | `inventories` | `inventories` | 5,000 | Id |  |  |
| 26 | `aging_inventory` | `reports/aging-inventory` | 5,000 | Id |  |  |
| 27 | `depleted_inventories` | `inventories/depleted-inventories` | 5,000 | Barcode |  | no Id; Barcode is unique (26,899 of 26,899, measured) |
| 28 | `shrink` | `reports/shrink-report` | 5,000 | Id |  | every inventory adjustment with reason, employee and cost valuation |
| 29 | `customers` | `customers` | 1,000 | Id | yes | 5,000 per page times out (HTTP 504, measured); 1,000 works |
| 30 | `loyalty_accrual` | `reports/loyalty-point-accrual` | 5,000 | Id | yes |  |
| 31 | `activity` | `activity` | 5,000 | Id |  | register activity: opens, drops, payouts, pay-ins, closes, sales, returns |
| 32 | `sales_lines` | `reports/daily-sales-detail` | 5,000 | Id |  | every sold line: employee, payment, discount, tax, cost, returns |
| 33 | `discount_lines` | `reports/promotion-details-report` | 5,000 | Id |  | every line's discount: employee, discount type, manager-approved discount |
| 34 | `tax_lines` | `reports/tax-report` | 5,000 | Id |  |  |

| # | Roll-up report (keyless, one page, refused if short) | Endpoint |
|---|---|---|
| 1 | `daily_sales` | `reports/daily-sales` |
| 2 | `weekly_sales` | `reports/weekly-sales` |
| 3 | `monthly_sales` | `reports/monthly-sales` |
| 4 | `hourly_sales` | `reports/hourly-sales` |
| 5 | `sales_by_sku` | `reports/sales-by-sku` |
| 6 | `sales_by_category` | `reports/sales-by-categories` |
| 7 | `sales_by_inventory_type` | `reports/sales-by-inventory-types` |
| 8 | `budtender_performance` | `reports/budtender-performance` |
| 9 | `promotion_report` | `reports/promotion-report` |
| 10 | `tax_setting_report` | `reports/tax-setting-report` |
| 11 | `inventory_valuation_by_sku` | `reports/inventory-valuation-by-sku` |

| # | Summary object | Endpoint |
|---|---|---|
| 1 | `sales_details_summary` | `reports/sales-details-summary` |
| 2 | `tax_report_summary` | `reports/tax-report-summary` |
| 3 | `tax_setting_summary` | `reports/tax-setting-summary` |
| 4 | `sales_cannabis_non_cannabis` | `reports/sales-cannabis-non-cannabis` |
| 5 | `sales_medical_non_medical` | `reports/sales-medical-non-medical` |
| 6 | `sales_pre_packaged_vs_bulk` | `reports/sales-pre-packaged-vs-bulk` |
| 7 | `sales_by_sku_summary` | `reports/sales-by-sku-summary` |
| 8 | `sales_by_categories_summary` | `reports/sales-by-categories-summary` |
| 9 | `sales_by_inventory_types_summary` | `reports/sales-by-inventory-types-summary` |
| 10 | `aging_inventory_summary` | `reports/aging-inventory-summary` |
| 11 | `inbound_transfers_summary` | `reports/inbound-transfers-summary` |
| 12 | `inventory_valuation_by_sku_summary` | `reports/inventory-valuation-by-sku-summary` |
| 13 | `inventory_valuation_cannabis_non_cannabis` | `reports/inventory-valuation-cannabis-non-cannabis` |
| 14 | `inventory_valuation_medical_non_medical` | `reports/inventory-valuation-medical-non-medical` |
| 15 | `inventory_valuation_pre_packaged_bulk` | `reports/inventory-valuation-pre-packaged-bulk` |

Lookups (`lookups.json`): `transaction-status`, `activity-operation-types`, `payment-methods`, `order-origins`, `inventory-return-reasons`, `adjustment-reasons`, `employee-sample-status`, `loyalty-point-accrual-types`, `discount-types`, `employees`, `valuation-snapshot`.

Orders: `orders` in monthly Pacific windows of 1,000 (voids = IsCanceled, refunds = IsRefunded / IsPartialRefunded, ManagerPinUsed). Stages: login → lookups → summaries → keyless → paged → orders → cycle_count_details → valuation_snapshots.

Measured facts that shaped the catalogue (probe notes, 2026-11-01):

- `orders` and `customers` time out (HTTP 504, about 60 s gateway limit) on large pages. Orders are read in monthly windows of 1,000; customers in pages of 1,000 (16,588 customers).
- `shifts/list` returns zero rows (with the right Count, 1,662) for a 5,000 page; 1,000 works.
- `inventories/depleted-inventories` has no Id; Barcode is unique (26,899 of 26,899).
- `products` with `ShowNonCannabis=false` returns all 17,605 products (`true` returns only the 189 non-cannabis ones).
- The first order is 2024-08-30 (order 04300000001); about 135,000 orders exist; `promotion-details-report` has 233,067 lines.
- `reports/daily-sales` for 2026-10-31 answered GrossSales 8,684.14, Discounts 2,577.70, Taxes 2,779.90, NetSales 6,106.44, Cost 3,686.18. This is the shape `cultivera_benchmark_days` stores (in cents).

## 5. How the comparison works

The two systems do not define "sales" the same way, so a raw total-to-total comparison would mislead. The benchmark compares like with like:

| Metric | Cultivera (their figure) | Ours | Basis |
|---|---|---|---|
| Gross sales | `GrossSales` | sum of line pre-tax bases before discount | pre-tax, `preTaxLineBaseMinor` (tax-base-core) |
| Discounts | `Discounts` | sum of line discounts | pre-tax |
| Net sales | `NetSales` | gross − discounts − returns | pre-tax |
| Taxes | `Taxes` | sales tax + excise collected | as collected |
| Returns | `Returns` | refunded pre-tax amounts | pre-tax |
| Cost (COGS) | `Cost` | cost of goods sold for the day | cents |
| Gross / net profit | `GrossProfit` / `NetProfit` | derived the same way from the rows above | cents |

For every metric and period, the comparison core reports both figures, the difference in cents and percent, and a status: **ahead**, **behind**, **even**, or **not comparable** (one side missing). It never fills a missing side.

The comparison is between **periods**. Cultivera's history (2024-08-30 → cutover) is the baseline, and our system's days (cutover → today) are the result. The page shows our period beside Cultivera's same calendar period one year earlier, and beside Cultivera's trailing average, so seasonality is visible instead of hidden.

## 6. The payback ledger (the number that goes down)

- **Start:** build cost **$40,000.00** (`owner-build-cost`, the owner's words "Total build was 40k").
- **Already credited:** **$5,500.00** saved on 2026-11-01 (`owner-saving-2026-11-01`, "We just now today from switching saved 5500"). **Remaining today: $34,500.00.**
- **Later credits** are each a row with a unique key and their basis in JSON:
  - `saving`: recurring savings the owner confirms (for example a Cultivera invoice that no longer arrives). The amount is entered by the owner, never inferred.
  - `outperform`: for a closed period, the amount by which our chosen metric (default: gross profit, pre-tax) beat Cultivera's baseline for the same period. Only positive outperformance is credited, and a period is credited once (its key is `outperform:<metric>:<from>:<to>`).
  - `adjustment`: a correction of either sign. Rows are never edited or deleted.
- **Remaining** = build cost − savings − outperform ± adjustments, shown with a "paid back" date once it reaches zero (it never goes negative; the surplus is shown as "ahead by").

## 7. Slice plan

| Slice | What | Status |
|---|---|---|
| CVB-0 | Live probe of the back office (endpoints, shapes, page limits, counts) | done (notes kept outside the repository) |
| CVB-1 | This roadmap | merged #1633 |
| CVB-2 | Archive harvester on the crawler (34 paged datasets, 11 roll-up reports, 15 summaries, 11 lookups, monthly orders, cycle-count details, valuation snapshots), Count-verified, resumable, read-only | merged #1631 |
| CVB-3 | Migration 0337: private bucket, archive run / file provenance, Cultivera daily figures, payback ledger seeded with the owner's two figures, two service_role functions | merged #1633 |
| CVB-4 | Pure cores (`src/lib/reports/cultivera-benchmark-core.ts`): dollars → cents ingest normaliser for the daily report (a day with two different answers is kept out), manifest → archive register list (refused whole, never partial), comparison engine (missing side is never zero; a partial period cannot win), payback ledger arithmetic and the outperformance credit rule; 40 self-tests + vitest mirror that checks agreement with 0337 | merged #1634 |
| CVB-5 | Admin → Lyman → **Cultivera Archive** (`/admin/cultivera-archive`, owner-only `cultivera.benchmark`): start / continue / stop the harvest; progress for each of the 8 stages; **Archive to our storage** (every file checked against the manifest's sha256, then stored with upsert:false; a size mismatch stops it; resumable within the 300 s page limit; the manifest's bytes are stored and their sha256 registered); Cultivera's daily figures are read back from the bucket, sha256-checked and stored in cents; a dataset browser; archived harvests. Pure core `cultivera-archive-core.ts` (28 self-tests) + vitest | PR (not merged) |
| CVB-6 | Reports → **Cultivera Benchmark** tab (`/admin/reports/cultivera-benchmark`, owner-only `cultivera.benchmark`, before ACH Payments). It has a payback meter ($40,000 less savings and credits, from the insert-only ledger), a period picker, and our period beside Cultivera's same calendar days one year earlier, using the CVB-4 engine. Our side is pre-tax, completed orders by Pacific completed_at day, from the cut-over (0186), with cost from each sale's own `order:<id>#cogs` entry (unknown rather than partial). Cultivera's formulas are measured on the compared days before any derived metric is shown, and returns are not compared. Owner actions: **Record a saving** (idempotent key) and **Credit this period** (recomputed on the server; closed and complete periods only; no day credited twice). Pure core `cultivera-benchmark-report-core.ts` (43 self-tests) + vitest | PR (not merged) |
| CVB-7 | Deeper comparisons from the archive: discounts by employee, employee samples / purchases, voids and returns, cycle-count accuracy, vendor purchase stats, inventory valuation | later |

## 8. Gaps and risks (stated, not hidden)

- **Different definitions.** Cultivera's GrossSales/NetSales are its own definitions; section 5 maps them, and any metric that cannot be mapped exactly is labelled "not comparable".
- **Account deactivation.** The owner's Cultivera account will be deactivated soon. The harvest must finish and be archived before then; after that, the bucket is the only copy.
- **Size.** About 135,000 orders and 233,067 discount lines. Files are gzip parts of 20,000 rows or fewer, well under the bucket's 100 MB per-file limit.
- **The crawler is single-purpose at a time.** The archive, the POS fetch and the loyalty crawl refuse to run together (a shared "busy" lock).
- **PII.** Customer and employee datasets go only to the private bucket. They are never shown on the benchmark, which uses only aggregates.

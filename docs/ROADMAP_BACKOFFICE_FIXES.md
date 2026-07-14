# Roadmap — Back Office Fixes (Media, Harvest Console, Vendors)

This roadmap records a multi-part request from the owner, captured **verbatim** per the
standing rules. Each task is delivered as its **own slice / PR** (one slice per PR).
Nothing goes live automatically; all outputs are **drafts** for human validation, and any
database schema changes are shipped as **migration files applied MANUALLY by the owner**.

---

## Owner's request (verbatim)

> thank you, that is working much much better now. something i need you to fix however. the
> crawler now is getting the alt text that goes with the images, perfect. however, when i
> click the save button on the image to save it as a draft in the media library, it does not
> carry over with it the alt text that went with it from the vendor page. i need you to fix
> that for me. i also need you to add a way to delete many media items at once, like a select
> check box so i can delete things i have in there more easily. next i would like you to add a
> jump to vendor button in the complete box for that particular vendor that was crawler and
> appears on the harvest console. that way it is much easier to get back to the vendor i just
> scraped. next i want you to relocate the past crawls to a new tabbed page on the harvest
> console page that shows the history of my crawls, but doesnt clutter up my main harvest
> console page. next, on the vendors and brands page, i need you to fix the back buttons and
> breadcrumb/ in page return button on the vendor page, so when i return to the vendors and
> brands page, it has the same filters and sorting as before. then i need you to either add a
> function or method to combine vendors/ remove duplicates. i think what is happening, is a
> lot of vendors are producer processors and may have different lcb license numbers for each
> license. but i want you to help me combine the vendors that have two to three vendor cards
> in the list so that there is one combined vendor card with all the info from all two to
> three vendor cards in the list. please proceed, follow the standing rules, never guess, no
> cutting corners and be hand off ready. please complete all tasks before reporting back to
> me. thank you.

---

## Slices

### Task A — Alt text carryover on media save  `[x]`  (PR pending)
When saving a crawled image to the media library as a draft, the alt text captured from the
vendor page must carry over with it. Today the alt text is dropped on the save path.

**Root cause (verified by reading code):** `HarvestImagePicker.tsx` already parses each
image's alt text/context into `item.caption` (via `parseImageLines`), but the "💾 Save" and
"★ Set as logo" forms did **not** submit that caption. The server action
`importHarvestImageAction` (`src/app/admin/vendors/actions.ts`) then hardcoded
`altText: \`${displayName} logo\``, so the real alt text was discarded. The image-import
library `src/lib/media/harvest.ts` already accepts and stores `altText` correctly — the loss
was purely in the picker → action wiring.

**Fix:** added a hidden `caption` field to both Save forms in `HarvestImagePicker.tsx`, and
`importHarvestImageAction` now reads `caption` (capped 300 chars) and uses it as `altText`,
falling back to the previous default only when the source image had no alt text. Verified with
`tsc --noEmit` (clean) and the full compliance suite (747 passing).

### Task B — Bulk media delete  `[x]`  (PR pending)
Add select checkboxes to the media library so multiple media items can be selected and
deleted in one action.

**Implementation (verified by reading code):** the library grid was a plain server component
of `<Link>` cards (`src/app/admin/media/page.tsx`). Added a client wrapper
`src/components/admin/media/MediaGrid.tsx` with a "Select" toggle that turns each card into a
checkbox toggle (out of select mode the cards link to the detail page exactly as before,
carrying the active filters). A "🗑 Delete selected (N)" action bar submits the chosen ids to a
new server action `bulkDeleteMediaAction` (`src/app/admin/media/actions.ts`) that guards **each**
asset exactly like the single delete (`whereUsed` → in-use items are SKIPPED, never
force-deleted), removes storage + row, audits each deletion, and returns a plain-language
summary (deleted / skipped-in-use / failed). No schema change. Verified with `tsc` (clean),
scoped ESLint (clean), and the full compliance suite (747 passing).

### Task C — Jump-to-vendor button in completed job box  `[x]`  (PR pending)
In the "completed" job box on the Harvest Console (`HarvestJobsLive.tsx`), add a button to
jump back to the vendor that was just crawled, for quick return.

**Implementation (verified by reading code):** the worker already carries `entity_type` +
`entity_id` per target (`crawler/app/harvest.py` `TargetState`, relayed unchanged through
`/api/admin/harvest` → `HarvestTargetState`). Added those fields to the component's local
`TargetState` type and a "Jump to vendor(s)" row that renders a link
(`/admin/vendors/<entity_id>`) for each **completed** vendor target. Lead targets (id prefixed
`lead:`) and non-vendor targets are excluded since they have no vendor page. No schema change,
no new endpoint. Verified with `tsc` (clean), scoped ESLint (clean), full compliance (747).

### Task D — Relocate past crawls to a tabbed history page  `[x]`  (PR pending)
Move the crawl history off the main Harvest Console page into a new tab / sub-page so the
main console stays uncluttered.

**Implementation (verified by reading code):** `HarvestJobsLive` gained a `filter` prop
(`"active" | "history" | "all"`, default `all`). The main console now renders `filter="active"`
(queued/running only) under an "Active jobs" heading with a "🕘 Past crawls" tab link. A new
route `src/app/admin/knowledge-base/harvest/history/page.tsx` renders the same live cards with
`filter="history"` (finished jobs, newest-first) and a breadcrumb/back link to the console. The
poller still fetches all jobs, so a job that finishes while you watch simply moves from the
console to the history tab on the next poll. Resume and the Task-C jump links still work on
history cards. No schema change. Verified with `tsc` (clean), scoped ESLint (clean), full
compliance (747).

### Task E — Preserve filters/sort on back navigation  `[x]`  (PR pending)
On the Vendors & Brands page, fix the back buttons and the breadcrumb / in-page return button
on the vendor detail page so that returning to the list restores the same filters and sorting
that were active before.

**Root cause (verified by reading code):** the list page (`src/app/admin/vendors/page.tsx`) is
fully URL-driven (filters/sort/page in `searchParams`), but each vendor card linked to a bare
`/admin/vendors/${v.id}` with **no** filter context. The detail page
(`src/app/admin/vendors/[id]/page.tsx`) then hardcoded its only back link to `/admin/vendors`,
so returning always dropped every filter/sort/page.

**Fix:** new pure helper `src/lib/vendors/list-state-core.ts` (`pickVendorListParams`,
`vendorListQueryString`, `vendorDetailHref`, `vendorListBackHref`). The list now builds each
card link with `vendorDetailHref(v.id, listParams)`, encoding the active state into an opaque
`from` token. The detail page reads `from`, rebuilds the exact list URL with
`vendorListBackHref` (re-sanitised through the allow-list so a tampered token can't steer the
link off-app), and uses it for **both** the "← All vendors" button and a new breadcrumb. Added
`tests/compliance/vendor-list-state.test.ts` (13 tests). Verified `tsc` (clean), scoped ESLint
(clean), full compliance (**760 passing**).

### Task F — Combine / merge duplicate vendors  `[x]`
Add a function/method to combine vendors (dedupe). Producer-processors may carry multiple LCB
license numbers → multiple vendor cards. The owner wants to merge 2–3 duplicate cards into one
combined card that carries all info from all the merged cards.

**Done.** New **migration `0104_merge_vendors.sql`** (⚠️ apply MANUALLY in the Supabase SQL
editor) installs an atomic `merge_vendors(survivor_id, duplicate_ids)` DB function: repoints
every table referencing `vendors(id)` (vendor_aliases, brands, product_enrichments, kb_brands,
inbound_manifests, inventory_lots, vendor_returns, purchase_orders, trade_sample_events,
vendor_manifest_payments, kb_products, discovery_vendor_leads) **plus** entity-scoped rows
(ai_suggestions, media_usages, seo_entries) from the duplicates to the survivor; gap-fills ONLY
the survivor's EMPTY fields (curated data never overwritten — same rule as the importer);
preserves **every license number** as `vendor_aliases` (source `merge`) + Internal-notes stamps;
sums product counts / YTD cents, ORs is_active, recomputes brand_count; then **archives** the
duplicates (status=archived, slug suffixed `-merged-<id8>`) — **nothing is deleted**; returns
per-table jsonb counts. `audit_logs`/`ai_usage` deliberately untouched (history).
New pure module `src/lib/vendors/merge-core.ts` (duplicate-group detection by identical
normalized business name — the multi-license case — or identical website host; archived cards
excluded; survivor suggestion by completeness; merge-plan preview mirroring the DB gap-fill
rule; selection validation mirroring the DB guards). New `src/lib/vendors/merge-service.ts`
wraps the RPC with graceful degradation (friendly "apply migration 0104 first" message before
it's applied). New page **`/admin/vendors/merge`** (linked from Vendors & Brands via a
"🔀 Combine duplicates" button) lists suggested groups; `MergeGroupCard` lets the owner pick
the card to keep, tick duplicates, read a plain-language preview of exactly what moves/fills,
and confirm — nothing merges automatically. New server action `mergeVendorsAction` (permission
gate, validation, RPC, audit `vendor.merged`, revalidates). Added
`tests/compliance/vendor-merge-core.test.ts` (19 tests). Verified `tsc` (clean), scoped ESLint
(clean), full compliance (**779 passing**).

---

## Owner's request (verbatim) — Employee sample-product assignment

> Thank you, I will add the zip file to my git in a release. It's uploading now. While we
> wait, I want you to help me with the employee samples page. I see i can pick an employee for
> sample distribution, but I don't see a way to assign an actual sample product to an employee.
> Can you audit that section so you can see if that's possible currently. If not, please re
> read the CCRS around samples for retailers specifically and then add the function to assign
> samples to employees. Please proceed. Follow the standing rules, never guess no cutting
> corners and be handoff ready. Thank you.

### Task G — Assign a specific sample PRODUCT/lot to an employee  `[x]`

**Audit (verified by reading code):** the Samples page recorder let you pick an *employee* and a
*product-type category* (useable/concentrate/infused) plus sizes, but there was **no way to
identify WHICH actual sample product/lot** was given to that employee. The DB `trade_sample_events`
carried `lot_id` (FK `inventory_lots`) and `import_id` (FK `sample_json_imports`) but neither was
ever set for outgoing events, and imported sample lots live inside `sample_json_imports.raw`
(jsonb) — they are **not** `inventory_lots` rows and have no per-lot stable id, so `lot_id` could
never point at one and `import_id` only links the *batch*, not the individual assigned product.
`parseSampleJson` already extracted a `productName` + `lotRef` per lot, but nothing persisted them
onto an assignment.

**CCRS finding (WAC 314-55-096, WSR 25-08-032 eff. 4/26/25):** when a retailer transfers a trade
sample to a current paid employee, the traceability (CCRS) record must capture the amount, the
receiving employee, **and the specific sample product** (product name/strain + traceability lot
reference). This obligation is consistent across rule versions.

**Done.** New **migration `0105_sample_source_product.sql`** (⚠️ apply MANUALLY, after 0104) adds
two nullable identity columns to `trade_sample_events` — `source_product_name` and
`source_lot_ref` — snapshotting the assigned product onto the event (denormalised so the record
survives edits to the import), plus a helper index; `import_id` (0095) is **reused** to link the
event back to its batch, `lot_id` left untouched. The pure core (`trade-samples-core.ts`) extends
`RecordDraft`/`ParsedRecord`/`parseRecordDraft` with `sourceProductName`/`sourceLotRef`/`importId`
and now **requires** a product identity for OUTGOING samples (and strips it from incoming rows).
The server layer (`trade-samples.ts`) persists the identity in `recordSampleEvent` with **graceful
degradation** — it tries the insert with the new columns and, if migration 0105 isn't applied yet,
retries without them (still linking via `import_id`) so nothing breaks before the migration lands.
New server helper `listSampleProductOptions` re-parses stored sample JSON imports into pickable,
named product options (only lots that actually carry a product name are offered). The
`SampleRecorder` gains an outgoing-only **"Sample product assigned to this employee"** picker
(populated from imports, with a manual product-name/lot fallback so it works with no imports); a
picked import lot auto-fills the product type + sizes so the ledger matches the product. Product
identity now shows in the Samples recent-events ledger, the Employee Sample History table + CSV
(new `sample_product` / `lot_ref` columns), and the history search now matches product name + lot.
The record action audits the assigned product. Extended the existing sample self-test suites (wired
into CI via `tests/compliance/sample-core.test.ts`) with outgoing product-identity coverage.
Verified `tsc` (clean), scoped ESLint (clean), full compliance (**779 passing**).

---

## Task H — CCRS monthly public-records extract: parse, ingest, and self-service pipeline

**Verbatim request (owner):** "thank you. the two files finally uploaded to my git via release. the
tag or name of the release is, APRIL & MAY 2026 CCRS MONTHLY REPORTS. please get after that data and
help me get it into the back office, and then help me strategize the best way going forward to get
the info to the back office with out needing to come in here to have you parse it for me. let me know
what you find and what we can do with this information."

**Status: PARSED + REPORTED (no app code changed yet — reporting before code per standing rule).**

### What the files are
GitHub release tag `CCRS_DATA` ("APRIL & MAY 2026 CCRS MONTHLY REPORTS") has two assets:
`April.2026.Monthly.CCRS.Reports.zip` (~713 MB) and `May.2026.CCRS.Monthly.Reports.zip` (~990 MB).
Each is the **entire WA statewide CCRS public-records extract** for that month — not just Greenway.
May alone is ~101 million rows. Outer zip → `<Month> 2026 Monthly CCRS Reports/CCRS PRR (…)/` →
many nested per-table zips (April 49, May 64); big tables are split into `_0.._N` chunks of ≤1M rows.

### VERIFIED file format (differs from the self-reporting templates in CCRS_VERIFIED_SCHEMA.md)
- Encoding **UTF-16-LE with BOM**, delimiter **TAB** for almost every table, **CRLF** line endings.
  Exception: `Areas` is UTF-16 but **comma**-delimited; a couple of tables (e.g. `Harvest`) ship
  with no BOM. A robust importer must sniff delimiter/BOM per file.
- **No 3-line preamble** (unlike the self-report CSV templates). Row 1 is the header.
- The extract is **normalised with integer surrogate keys** (`LicenseeId`, `ProductId`,
  `InventoryId`, `SaleHeaderId`, `StrainId`, `AreaId`) — NOT the 6-digit `LicenseNumber`/external
  identifiers used by the self-report templates. Only `Licensee` and `ManifestHeader` carry the
  6-digit `LicenseNumber`.

### Identity resolution (earlier "Green Dragon/Eastsound" note was WRONG — an artifact of misreading
UTF-16 as UTF-8). Correctly parsed, the `Licensee` row for `LicenseNumber = 413541` is:
`LicenseeId = 736`, Name **"LYMAN'S MARIJUANA L.L.C."**, DBA **"GREENWAY MARIJUANA"**,
4851 GEIGER RD SE, **PORT ORCHARD, WA 98366**, KITSAP county, email MICHAEL@GREENWAYMARIJUANA.COM,
license active, issued 2025-10-27, expires 2026-11-30. **No discrepancy — this is the owner's store.**
The correct join key for all transactional tables is **LicenseeId = 736**.

### Join map for the extract (how to find "Greenway" rows)
- Direct `LicenseeId`: Inventory, Product, Strains, SaleHeader (seller=`LicenseeId`,
  buyer=`SoldToLicenseeId`), Contacts, LabResult (`LicenseeId`/`LabLicenseeId`), Plant.
- `InventoryPlantTransfer`: `FromLicenseeId` / `ToLicenseeId`.
- **SalesDetail** has NO LicenseeId → join via `SaleHeaderId ∈ Greenway SaleHeaderIds`.
- **InventoryAdjustment** → join via `InventoryId ∈ Greenway InventoryIds`.
- **ManifestHeader** → match `OriginLicenseNumber`/`DestinationLicenseNumber == 413541`.
- **TransportedItems** → join via `ExternalManifestIdentifier ∈ Greenway manifest ids`.

### Extracted Greenway subsets (verified counts; tab/UTF-16 parsed correctly)
| Table | April rows | May rows |
|---|---:|---:|
| SaleHeader (all) | 5,732 | 6,504 |
| — retail sales (seller=736) | 4,796 | 5,438 |
| — wholesale purchases (buyer=736) | 936 | 1,066 |
| SalesDetail (line items) | 10,593 | 11,469 |
| Product | 373 | 329 |
| Inventory lots | 1,029 | 911 |
| Strains | 70 | 66 |
| InventoryPlantTransfer | 1,098 | 984 |
| ManifestHeader | 68 | 71 |
| TransportedItems | 1,110 | 1,284 |
| InventoryAdjustment | 0 | 0 |
| Plant / Harvest / LabResult | 0 | 0 (Greenway is a retailer, not a grower/lab) |

### Business summary (money kept in cents internally; USD shown here)
| Metric | April 2026 | May 2026 |
|---|---:|---:|
| Retail revenue | $149,721.94 | $159,107.43 |
| Retail units sold | 11,034 | 12,071 |
| Wholesale spend (purchases) | $10,199.35 | $11,450.60 |
| Distinct products sold | 373 | 329 |

NOTE — **category attribution is partial**: SalesDetail references ~3,857 distinct InventoryIds but
the monthly extract only contains the Inventory lots *touched that month* (911), so only ~622 join
to a Product for category breakdown. The monthly extract is a **delta**, not a full master; accurate
product/category attribution needs a **cumulative** Inventory+Product master accumulated across
months. This directly informs the pipeline design (persist a rolling master, upsert by surrogate id).

### Next (pending owner review before code)
1. Ingestion pipeline design (self-service upload → stream/filter by LicenseeId=736 → drafts).
2. Wire Greenway sales/inventory/product/manifest data into the back office (drafts-only, 1 slice/PR).
3. Retune CCRS benchmarks + Discovery leads to the real extract schema (LicenseeId-keyed, tab/UTF-16).

---

## Task H (revised) — statewide CCRS transformer feeding Leads + CCRS Benchmarks + Local Benchmarks

**Owner clarified the vision (verbatim):** "…I want this data not for my own data, the back office
has this already. This data will be used … to create state wide benchmarks on the CCRS benchmark
page. It will also be used on the reports page in the local benchmarks page. It will also be used on
the leads page so it can help my purchaser make better more informed decisions based on what is
moving well in the state but also at our competitors stores. I want the ai to help us beat them by
under cutting them or beating them in some other ways. Ideally, I will make the public records
request once per month to get the previous months data. One big zip file with nested zips in it. I
drag and drop or upload the full zip file, the back office via some sort of transformer, extracts
what we need and then uses it in all the system I've described. I do not want to have to do a bunch
of steps or validate anything. If we get the logic right the first time, all the future extracts
will be reliable and source data … work on the transformer first, then update the leads page, the
CCRS benchmarks page and the reports local benchmarks page … No code edits yet."

**Purpose reframed:** the extract is the **statewide market/competitor** dataset (NOT Greenway's own
numbers — POS is source of truth for those). It feeds three surfaces: **CCRS Benchmarks** (statewide),
**Reports → Local Benchmarks** (competitor/area), **Leads** (purchaser decisions + AI undercut/
out-position recommendations).

**Zero-touch flow:** monthly, owner uploads the ONE big zip (nested zips); a **transformer** streams
it, extracts what's needed, and auto-feeds all three surfaces. No wizard, no manual validation.

**Reality vs current code:** the real monthly extract is UTF-16/TAB, no preamble, statewide (~101M
rows/mo), split into nested per-table zips, and **normalised with integer surrogate keys**
(`LicenseeId`, `ProductId`, `InventoryId`) — Sales are split into `SaleHeader` + `SalesDetail`. The
existing `ccrs.ts` parser + `discovery_ccrs_sales` shape were built for the **self-report template**
(one `Sale` file, `LicenseNumber`, comma/UTF-8, 3-line preamble) and will match none of these files.
The transformer must do the header/detail + inventory→product join and the LicenseeId↔LicenseNumber
resolution, and **store ROLLUPS, not statewide raw rows** (raw is far too large; discard after
aggregation). Greenway self (LicenseeId 736) excluded from competitor sets.

**Build order (one slice per PR, drafts-only, migrations MANUAL):**
1. **Transformer** — 1a real-extract pure parser (UTF-16/tab + new table signatures + surrogate-key
   joins; template path kept) with tests; 1b streaming zip ingest + aggregation writing only rollups
   (new `discovery_competitor_stats` + `discovery_market_signals`, period auto-derived from SaleDate);
   1c single drag-drop zip uploader (`uploading → ready`, latest ready dataset wins).
2. **Leads page** — surface statewide fast-movers + competitor-beating signals; AI undercut/out-position.
3. **CCRS Benchmarks page** — point at statewide rollups.
4. **Reports → Local Benchmarks** — point at competitor stats sliced by `discovery_competitors` roster.

Full strategy: `ccrs_data/CCRS_TRANSFORMER_STRATEGY.md` (working notes, not in repo).

**Open confirmations before Phase 1:** (a) upload raw ~1 GB zip via browser vs point at GitHub
release URL; (b) keep all monthly datasets (trend) vs latest only; (c) confirm `discovery_competitors`
roster is current. **No app code changed yet.**

### Task H — S1 (transformer pure core) — DONE
**S1 of 6.** New pure, dependency-free modules under `src/lib/discovery/ccrs-extract/`:
`zip.ts` — random-access ZIP reader over a BlobLike (browser File or Node fd): central-directory
(+Zip64) parsing, stored/deflate entry streaming via the platform's `DecompressionStream`
("deflate-raw"), nested-zip support, byte-exact fixtures in tests. Hand-rolled because the
transformer runs IN THE BROWSER on the dragged ~1 GB file (Vercel body limits forbid uploading raw)
and needs central-directory random access to process tables in dependency order; no new npm deps.
`parse.ts` — the REAL monthly-extract format: UTF-16-LE(±BOM)/UTF-8 sniffing, tab-vs-comma sniffing,
incremental line splitting, VERIFIED table signatures (licensee, sale_header, sale_detail, product,
inventory, strain, lab_result; self-report template headers deliberately → unknown), typed row
mappers keyed on normalized column names, string-math `moneyToMinor` (never float×100),
`streamTable`/`decodeStream` streaming readers, SKIPPED_TABLES for grower/lab-side tables.
**Verified UnitPrice is PER-UNIT** (per-unit reading → 54.9% COGS vs 7.2% for line-total — only
per-unit is plausible; wholesale qty-50 @ $2.20 lines corroborate). New CI suite
`tests/compliance/ccrs-extract-parse.test.ts` (37 tests, fixtures replicate real bytes incl.
Greenway's actual Licensee row; **816 passing** total). Validation harness
`scripts/validate-ccrs-extract.mjs` (npx tsx) ran the modules against the REAL May 2026 zip:
all 49 non-skipped files detected correctly (licensee 1,715 / product 1.6M / inventory 14.05M /
sale_header 10.74M / sale_detail 10.82M / strains 334K / lab 255K rows) and Greenway's row parsed
exactly. No app pages touched; no migration.

### Task H — S2 (aggregation engine) — DONE
**S2 of 6.** New pure module `src/lib/discovery/ccrs-extract/aggregate.ts`: single-pass
`CcrsAggregator` folding the typed rows from parse.ts (fed in dependency order — Licensee →
Strains → Product → Inventory → SaleHeader → SalesDetail) into the three rollups the surfaces need:
**statewide benchmarks** (retail/wholesale unit-price + $/g percentiles, units, revenue by
type/brand/strain/overall; brand+strain capped at top 500 per class by revenue), **competitor stats**
(per tracked license from the `discovery_competitors` roster: retail revenue/units/price
distribution, byType breakdown, top-25 products; **self 413541 structurally excluded**), and
**market signals** (top-100 statewide movers + top-15 per competitor, each with median and p25
unit-price bands — p25 is the undercut reference for the Leads AI).
Key scale piece: **`U53Map`**, a typed-array open-addressing hash map for CCRS's integer surrogate
keys. A first cut with JS `Map<string,…>` joins **OOM-killed a 3.3 GB Node heap** on the real file
(14.05M inventory + 10.74M header entries); U53Map holds the same joins in flat Float64Arrays and
the whole run peaks ≈ **0.8 GB heap** — safe for the in-browser transformer. Sale headers fold to
ONE packed number (sale class bit + tracked-competitor slot). Prices use exact-cents
`PriceHistogram`s (nearest-rank percentiles, $10k cap). The statewide product-mover map is bounded
by documented heavy-hitters pruning (cap 150k names → keep top 30k; prune count surfaced in
`totals.moverMapPrunes` — honesty over silence). Attribution is never guessed: lines whose
InventoryId doesn't resolve (delta-month reality) land in "(unattributed)" and the retail join rate
is reported in totals.
CI: `tests/compliance/ccrs-extract-aggregate.test.ts` (30 tests — U53Map growth/rehash, histogram
percentiles, per-unit revenue math `qty × unit − discount` clamped at 0, self-exclusion, caps,
deterministic ordering; **846 passing** total). Validation harness
`scripts/validate-ccrs-aggregate.mjs` ran the FULL S1+S2 pipeline over the real May 2026 zip
(results recorded in the S2 PR). No app pages touched; no migration.

### Task H — S3 (migration 0106 + server persist + drag-drop zip uploader) — DONE
**S3 of 6.** The zero-touch monthly flow the owner asked for: drag the ONE big WSLCB zip onto the
CCRS page and everything else is automatic.
**Migration `0106_discovery_market_rollups.sql` (APPLY MANUALLY):** new `discovery_competitor_stats`
(per tracked license per dataset: retail units/revenue/lines, unit-price distribution columns,
`by_type` + `top_products` jsonb; unique dataset+license) and `discovery_market_signals`
(statewide_mover/competitor_mover rows with median + p25 undercut bands); new `discovery_datasets`
columns `retail_lines`, `wholesale_lines`, `attributed_retail_lines`, `ingest_kind`
('csv' legacy | 'monthly_zip' transformer). Idempotent; RLS is_staff read/write like 0079/0080.
**Client (`CcrsZipUploader.tsx`, "use client"):** drag-drop/click card on `/admin/discovery/ccrs`
(new "Step 2 — Drop the monthly zip"; legacy per-file CSV upload demoted to "Advanced"). Runs the
S1 zip reader + parser and S2 aggregator IN THE BROWSER over the local File (raw ~1 GB never
uploads; Vercel limits forbid it anyway), processing inner zips in dependency order with a real
progress bar (files done / rows scanned), then POSTs only the ~1 MB rollup JSON. Roster comes from
`discovery_competitors` (self license passed separately for structural exclusion).
**Server (`market-rollups.ts` + `saveMonthlyRollupsAction`):** `sanitizeAggregationResult` —
structural validation of the posted payload BEFORE any write (rejects whole on malformed rows,
caps 5k/200/2k rows, truncates over-long keys, coerces junk numbers to safe zeros — NEVER GUESS);
`persistAggregationResult` — replace-then-insert per dataset (re-drop = recompute, history kept
across datasets): statewide → existing `discovery_benchmarks` under NEW class-scoped metrics
(`retail_unit_price`/`wholesale_unit_price`/`retail_price_per_gram`/`wholesale_price_per_gram`/
`retail_units`/`wholesale_units`/`retail_revenue`/`wholesale_revenue` — added to `BenchmarkMetric`),
competitor stats + signals → the 0106 tables, dataset stamped with derived period + honest line
totals + `benchmarks_computed_at`. Dataset lifecycle `uploading → ready | error` (verbatim errors).
Loaders for S4–S6: `getLatestTransformerDataset`, `listTransformerDatasets`, `listCompetitorStats`,
`listMarketSignals`. Guard: legacy "Compute benchmarks" refuses monthly_zip datasets (it reads
`discovery_ccrs_sales`, empty for them, and would wipe the rollups).
CI: `tests/compliance/ccrs-monthly-rollups.test.ts` (9 tests — round-trip through the REAL
aggregator output, rejection of malformed/oversized payloads, junk-coercion; **855 passing** total).
**Owner reminder: apply migration 0106 manually before dropping the first zip.**

### Task H — S4 (Leads page: market movers + AI undercut context) — DONE
**S4 of 6.** The owner's Leads surface: "statewide top movers … all the top movers from my
competitors … [AI] could help me beat them by undercutting them or beating them in some other ways."
**Pure core (`src/lib/discovery/market-leads-core.ts`):** `buildMarketMoverLeads(signals, roster)`
maps persisted `discovery_market_signals` rows into lead-shaped movers — statewide (cap 12) and
competitor (cap 15, roster tradename resolved; unknown license → "lic <n>") — sorted revenue desc /
units desc / name asc. NEVER GUESS: junk numbers → 0, bad/absent price bands → null (rendered "—",
never a fabricated price). `undercutTargetMinor` = the transformer's REAL p25 unit price (selling
at/below beats ~75% of observed sales). `formatMarketMoversDigest` renders the compact grounded
prompt block for the AI.
**Leads page (`MarketMoversSection.tsx`, server component on `/admin/discovery`):** reads the
latest READY `monthly_zip` dataset via `getLatestTransformerDataset()` + `listMarketSignals()` +
`listCompetitors()`; renders "Statewide top movers" and "Competitor top movers" tables (units,
revenue, median price, **Price to beat (p25)**) with the dataset's observed period and an honest
"only that month's reported activity" note. Best-effort: no dataset / tables not migrated → the
section renders nothing and the rest of the Leads page is untouched.
**AI advisor:** `LeadsAdvisorInput` gains optional `marketMovers`; `buildLeadsDigest` appends the
movers digest; SYSTEM prompt instructs the model to treat movers as the strongest demand evidence,
flag pipeline leads matching a mover, call out proven movers the pipeline is missing, and anchor any
price recommendation to the provided `undercut_at_or_below` (p25) — never invent a price, say when
the sample was too thin. `analyzeLeadsAction` loads the movers best-effort (non-fatal on any
failure) and audits `withMarketMovers`.
CI: `tests/compliance/market-leads-core.test.ts` (10 tests — mapping, roster fallback, unknown-kind
/ no-product drops, junk-coercion to null (never fabricate), deterministic sort, caps, digest
dollars + n/a; **865 passing** total).

### Task H — S5 (CCRS Benchmarks page: transformer statewide rollups + history) — DONE
**S5 of 6.** The owner's Benchmarks surface for the monthly drop, with history rollups kept as
confirmed ("yes let's keep history rollups please").
**Pure core (`src/lib/discovery/benchmarks-history-core.ts`):** `buildTransformerHistory(datasets,
benchmarks)` lines up each transformer dataset's OVERALL (scope=overall, scope_key=all) rows into
one month-over-month history row — median retail / $/g / wholesale, retail units, retail revenue
(rides in `avg_minor` per `benchmarkRows`), plus `attributedShare` = attributed_retail_lines /
retail_lines (the delta-file honesty metric). NEVER GUESS: missing metric → null (UI "—"), never
interpolated; negatives rejected; newest period first, null periods last.
**Page (`/admin/discovery/benchmarks`):** when the active dataset has `ingest_kind='monthly_zip'`
the page renders the new `TransformerBenchmarks` server component instead of the legacy
category-scope view (whose scopes/metrics don't exist in transformer data): headline KPI cards
(median retail/wholesale/$g, units+revenue), an honest "detail coverage" note explaining the
monthly delta attribution, retail+wholesale price tables by inventory type, $/g by type, brand &
strain pricing (top rows by sample size), velocity & mix (units+revenue by type/brand), and the
**Month over month History table** across every ready transformer dataset. Dataset selector chips
extracted into a shared `DatasetSelector` used by both views; legacy CSV datasets render exactly
as before.
CI: `tests/compliance/benchmarks-history-core.test.ts` (6 tests — metric mapping incl.
revenue-in-avg_minor, non-overall/foreign-dataset exclusion, honest nulls, divide-by-zero guard,
ordering, rounding + negative rejection; **871 passing** total).

### Task H — S6 (Reports → Local Benchmarks: competitor/area stats from the monthly drop) — DONE
**S6 of 6 — final slice.** The owner's local-intelligence surface for the monthly drop.
**Pure core (`src/lib/discovery/local-benchmarks-core.ts`):** `buildLocalBenchmarks(stats, roster)`
joins `discovery_competitor_stats` (0106) to the verified WSLCB roster: per-competitor rows
(tradename from roster, honest fallbacks dba → CCRS name → "License <n>"; unknown license → area
"other", never guessed), price bands p25/median/p75/avg (junk → null, NEVER a fabricated price),
volume/revenue/lines, by_type + top_products passthrough; self excluded belt-and-braces (aggregator
already excludes it structurally). Area rollup = median of each store's median (the same labeled
proxy the legacy view uses — a pooled median would need raw rows the transformer deliberately never
uploads) + summed volume; deterministic ordering (revenue desc; AREA_ORDER incl. "other").
**Page (`/admin/reports/benchmarks`):** when the active dataset has `ingest_kind='monthly_zip'`,
renders `TransformerLocalBenchmarks` — headline KPIs (Port Orchard market median, competitors seen,
competitor revenue, top competitor), Area benchmarks table, Port Orchard head-to-head, all tracked
competitors, and per-competitor "what they sell most" top-product tables with the median price they
sell at. HONESTY: notes that Greenway's own numbers live in the POS (transformer excludes the
license), that product detail covers same-month joins only, and that vendor-sourcing analysis is
NOT derivable from a monthly delta (stays a legacy full-extract feature — said plainly instead of
faked). Dataset switcher extracted into shared `DatasetSwitcher`; legacy CSV datasets render
exactly as before.
CI: `tests/compliance/local-benchmarks-core.test.ts` (7 tests — roster join + fallbacks, self
exclusion, junk coercion, ordering, median-of-medians area proxy, null-median volume handling;
**878 passing** total).

### Task H — S7 (competitor wholesale sourcing: top suppliers + AI priority vendor leads) — DONE
**Owner request (verbatim):** "Let's build S7. 10 top suppliers per competitor sounds great. And
yes, the ai advisor should call out vendors that supply multiple competitors as priority leads.
Please proceed, follow the standing rules never guess and no cutting corners. Be handoff ready.
Complete the full task from start to finish then report back to me when it's done. Thank you! Also
at the end, with your final report, will you tell me if there is anything else you would add from a
professional expert standpoint? You are smarter than I, what would you do with this information?
Please proceed."
**Honesty correction (S6 → S7):** S6's footnote claimed vendor sourcing "is not derivable from a
monthly delta." That was WRONG about the data and only true about the code at the time: wholesale
SaleHeaders in the monthly extract carry BOTH sides of every transfer (seller `LicenseeId` → buyer
`SoldToLicenseeId`), and the licensee table ships whole every month, so supplier identity resolves
exactly. Only PRODUCT-level joins are delta-limited. S6's aggregator simply never looked at the
buyer column. S7 fixes the code and replaces the footnote with the honest caveat: sourcing reflects
this month's reported wholesale activity only, not a competitor's all-time vendor list.
**Aggregator (`ccrs-extract/aggregate.ts`):** headerMap still folds each sale header to ONE
Float64 — now packed as `class(1 bit) + sellerSlot(8 bits) + buyerSlot(8 bits) + supplier
licenseeId(36 bits)`; max packed value is exactly 2^53−1 (verified round-trip at all extremes), so
memory is unchanged. `addLicensee` additionally keeps a compact identity map for EVERY licensee
(~1.7k rows/month) so suppliers get real names; roster slots capped at 255 (packing bound, roster
is 39). `addSaleDetail` credits wholesale lines whose BUYER is tracked to that competitor's
supplier accumulator (lineCount + spendMinor = qty × unit − discount, clamped ≥ 0); competitor
entries are now created for wholesale-only activity too (shared `competitorAcc` helper). SELF is
structurally excluded as buyer (never in the tracked set). `CompetitorStat` gains
`wholesale { lineCount, spendMinor, topSuppliers(≤10 by spend, TOP_SUPPLIERS_PER_COMPETITOR) }`;
supplier identity missing from the drop → honest nulls, never guessed.
**Migration `0107_discovery_competitor_suppliers.sql` (idempotent — OWNER APPLIES MANUALLY):**
`discovery_competitor_stats` + `wholesale_line_count int default 0`, `wholesale_spend_minor bigint
default 0`, `top_suppliers jsonb default '[]'`. Pre-S7 rows default to zero/empty (honest "no
sourcing captured"); re-uploading the monthly zip backfills. RLS unchanged (row-level, 0106).
**Server boundary (`market-rollups.ts`):** `sanitizeAggregationResult` validates the wholesale
block — BACKWARD COMPATIBLE (payload without `wholesale` → zeros/empty, not rejected), supplier
rows require `licenseeId`, list capped at 20, junk numbers coerced; `persistAggregationResult`
writes the three new columns. `DiscoveryCompetitorStatRow` extended in types.ts.
**Pure lead logic (`market-leads-core.ts`):** `buildSupplierLeads(stats, roster)` inverts
per-competitor suppliers into vendor leads — dedup by supplier licenseeId across competitors,
buyerCount + buyer tradenames (spend desc), total spend/lines, `suppliesMultipleCompetitors`
(≥2 buyers) = PRIORITY; sort buyerCount desc → spend desc → name asc, cap 15; display name
dba → name → "Licensee <id>", never invented. `formatSupplierLeadsDigest` renders the grounded AI
block with explicit `PRIORITY=multi-competitor-supplier` markers and a "this drop only" framing.
**Reports → Local Benchmarks (`TransformerLocalBenchmarks.tsx`):** new "Who competitors buy from"
section (per-competitor top-supplier tables with spend + lines) and "Shared suppliers — priority
vendor leads" table (vendors serving 2+ tracked stores); footnote rewritten to the corrected,
honest caveat. `local-benchmarks-core.ts` passes the sourcing fields through (pre-0107 rows →
zero/empty, junk coerced, id-less suppliers dropped).
**Leads page (`MarketMoversSection.tsx`):** new "Shared suppliers — priority vendor leads" card
(multi-competitor suppliers only; full breakdown lives on Reports). Best-effort as before.
**AI advisor (`leads-ai.ts` + `actions.ts`):** `LeadsAdvisorInput` gains optional `supplierLeads`;
digest appends the supplier block; SYSTEM prompt instructs: treat PRIORITY multi-competitor
suppliers as priority vendor leads (contact first, cite which competitors they supply + observed
spend), flag pipeline vendor leads matching a listed supplier, call out heavy shared suppliers
missing from the pipeline, and never extrapolate one month's spend. `analyzeLeadsAction` loads
supplier leads best-effort alongside movers and audits `withSupplierLeads`.
**Validation:** full run against the REAL May 2026 zip (14.05M inventory / 10.74M headers / 10.82M
details) via `scripts/validate-ccrs-aggregate.mjs` (now prints per-competitor suppliers + shared
suppliers) — memory bounded, self never appears as buyer, supplier names resolve via the monthly
licensee table.
CI: 24 new tests — aggregator S7 block (buyer attribution incl. wholesale-only competitors, self
exclusion as buyer, untracked-buyer/retail-buyer ignore, spend math + clamp, top-10 cap, honest
null identity, 9-digit id round-trip) + sanitize round-trip/backward-compat/caps/junk + supplier
leads build/digest + local-benchmarks passthrough (**902 passing** total).
**OWNER REMINDER: apply migration `0107_discovery_competitor_suppliers.sql` manually, then
re-upload the May monthly zip so supplier data backfills.**

---

## Task H — S8: monthly-zip upload failure — int4 overflow on statewide revenue (fix)

**Owner request (verbatim):** "Please log all of your suggestions, I want to add those after we
are done fixing the upload. The message says "something went wrong" "discovery benchmarks insert
failed: value 8932289184 is out of range for type integer" "nothing was saved. Fix the file, it
should be the monthly delivery zip". I drag and dropped the April zip I gave to you via the git
release. So it was the right file uploaded. It took a really really long time to get to the fail.
It looked like it was working, the progress bar moved through the 29 folders. The browser
constantly kept saying it was frozen and if I wanted to wait or exit. I have uploaded a screenshot
as well. Please help me figure this out. Follow the standing rules and never guess."

**Root cause (verified against real data — no guessing):** `discovery_benchmarks` (migration 0079)
declares its money columns (`min_minor` … `avg_minor`) as `integer` (int4, max 2,147,483,647).
The transformer stores STATEWIDE REVENUE TOTALS in `avg_minor` for the `retail_revenue` /
`wholesale_revenue` metrics — money in minor units per standing rules. A real month of Washington
statewide retail is ~$90M+ ≈ 9–12.5 BILLION cents, far past int4. Re-checked the saved May 2026
rollup JSON (from the S7 real-file validation): 4 rows exceed int4 —
retail/overall/all = 12,531,365,735; retail/type/(unattributed) = 8,572,258,333;
wholesale/overall/all = 8,716,406,494; wholesale/type/(unattributed) = 6,676,246,603. April's
failing value 8,932,289,184 is the same class of row. The failure happened at the very END of the
~1.5h browser crunch because the overflow only occurs at the DB insert; the error surfaced via
`insertInBatches` → "discovery_benchmarks insert failed: …". Nothing durable was saved: the save
action marks the dataset `status='error'` on failure, and only `status='ready'` datasets are ever
read; deleting the errored dataset (CCRS page) cascades away any partial benchmark batches.

**Fix:** migration `0108_discovery_minor_columns_bigint.sql` (idempotent, MANUAL apply) widens
every transformer-written `*_minor` column to `bigint` across all three rollup tables
(`discovery_benchmarks` 6 cols, `discovery_competitor_stats` 6 price cols,
`discovery_market_signals` 2 price-band cols). Unit-price percentiles didn't overflow in the real
files checked, but one anomalous CCRS price row would crash the whole save identically — bigint
everywhere removes the failure mode outright (no cutting corners). No TS code change needed:
values are exact in JS numbers (≪ 2^53) and PostgREST JSON. The CCRS upload page footnote now
references migrations 0106–0108.

**Tests:** +3 (905 passing) — sanitize passes >2^31 revenue totals through UNCLAMPED (using the
exact April failure value 8,932,289,184 and the real May maximum 12,531,365,735), and a schema
guard pinning migration 0108's DDL (all 14 columns widened; no `type integer` regression in DDL).

**Note on the browser "page unresponsive" prompts:** expected with the current design — the
transformer crunches ~10.8M rows on the main thread, so Chrome periodically offers wait/exit.
Choosing "Wait" is safe. Moving the crunch to a Web Worker is logged below as suggestion #6, not
done in this slice (ONE slice per PR).

**OWNER REMINDERS:**
1. Apply `0107_discovery_competitor_suppliers.sql` (if not yet applied) and
   `0108_discovery_minor_columns_bigint.sql` manually.
2. Delete the errored April dataset row on the CCRS page (optional but tidy).
3. Re-upload the April zip (and the May zip for supplier backfill) — the insert will now succeed.

### Logged suggestions (owner: "log all of your suggestions, I want to add those after we are done fixing the upload")

1. **Supplier-switching detection (highest value):** with 2+ monthly datasets, diff each
   competitor's supplier list month-over-month. A store dropping a vendor = that vendor is hungry
   and negotiable; a store adding one = a product line winning nearby.
2. **Wholesale price benchmarking:** compute per-supplier average spend-per-line across all
   buyers statewide; walk into vendor negotiations knowing what that vendor's other accounts look
   like ("you supply 23 stores in my dataset" is leverage).
3. **Auto-draft vendor outreach:** the shared suppliers (61 in May) are pre-qualified — they
   already service the competitive set, so logistics/coverage is proven. Generate a ranked call
   list with talking points (which nearby stores they supply, observed volume).
4. **Assortment-gap analysis:** cross-reference top statewide movers (S5/S6 product data) against
   what shared suppliers carry — find products competitors sell that Greenway doesn't, from
   vendors already delivering to the area.
5. **New-vendor early detection:** flag suppliers appearing in the data for the first time each
   month — early accounts with rising producers get the best pricing.
6. **Web Worker transformer (UX):** move the zip crunch off the main thread so the browser stays
   responsive (no "page unresponsive" prompts), with a live progress readout; optionally
   File System Access API streaming to cut memory further.

---

## Task H — S9–S14: the six logged suggestions (owner-approved set)

**Owner request (verbatim):** "I have applied both sql files. While I test the upload again,
please create a comprehensive roadmap, task list and todo list that are handoff ready. I want you
to tackle all six slices, one slice per pr, completing the entire set before reporting back to me.
I will then let you know how the new upload went and we can hopefully move on to the next set of
tasks to be done. For now, please proceed on these 6 slices. Follow the standing rules, never
guess and do not cut corners. Thank you."

### The set (one slice per PR, dependency order)

| Slice | Suggestion | Scope | Migration |
| --- | --- | --- | --- |
| S9  | #1 supplier-switching detection | pure diff core + Reports section (current vs previous transformer dataset) | none |
| S10 | #2 wholesale price benchmarking | aggregator statewide supplier stats + `discovery_supplier_stats` + Reports section | **0109 (MANUAL)** |
| S11 | #3 auto-draft vendor outreach | server action drafting vendor leads from shared suppliers (dedupe upsert) + Leads button | none |
| S12 | #4 assortment-gap analysis | pure gap core (statewide movers vs published menu) + Reports section | none |
| S13 | #5 new-vendor early detection | pure first-appearance core over uploaded history + Reports section | none (reads 0109) |
| S14 | #6 Web Worker transformer | DOM-free pipeline runner + worker + uploader with main-thread fallback | none |

### S9 — Supplier switching, month over month (suggestion #1)

**Core (`src/lib/discovery/supplier-switching-core.ts`, pure):**
`buildSupplierSwitchReport(current, previous, roster)` diffs each competitor's persisted
`top_suppliers` (0107) between two transformer datasets. Join key = supplier LICENSE NUMBER
(stable public id; real-file check: 367/367 May supplier rows carry one), fallback `id:<licenseeId>`
(surrogate ids shift between extracts — verified semantics). Outputs:
- per competitor: `entered` / `exited` / `continued` (with spend delta) — sorted spend/|delta| desc;
  competitors with a steady list produce NO row (no noise);
- per supplier: tracked-buyer momentum (prev→curr buyer counts, gained/lost store names, spend);
  restricted to competitors with data in BOTH months — a store missing data in one month can't
  honestly contribute to buyer deltas;
- `missingPrevData` / `missingCurrData`: competitors excluded because a month lacks supplier data
  (pre-0107 rows or absent stats) — reported by name, never silently folded into the diff.
HONESTY: the persisted lists are TOP-10-BY-SPEND, so "exited" strictly means "left the top list",
never "stopped buying" — every UI subtitle says so. Absent-month spends stay null (unknown ≠ 0).
Caps: 40 competitor reports / 20 momentum rows.

**UI (Reports → Local Benchmarks):** new "Supplier switching — month over month" section rendered
only when a previous READY transformer dataset exists (`listTransformerDatasets()` order, the
entry after the active one). Momentum table (buyers prev→now, gained/lost, spend prev→now) +
per-competitor entered/left blocks (top 3 continued for context). Missing-data stores are listed
in an explicit footnote. Best-effort try/catch: on any load failure the section simply doesn't
render.

**Tests:** `tests/compliance/supplier-switching-core.test.ts` — 11 tests: entered/exited/continued
with deltas + null unknowns, pre-0107 exclusion honesty, absent-competitor handling, steady-roster
silence, cross-competitor momentum with named gains/losses, license-number join across changing
surrogate ids, licenseeId fallback, junk-row drop, junk-number coercion, momentum cap + ordering,
roster/dba naming fallbacks.

### S10 — Statewide wholesale price benchmarking (suggestion #2)

**What it answers:** "am I paying a fair wholesale price, and who else could supply me?" — one
statewide table per monthly drop of every wholesale SELLER with observed volume, revenue,
unit-price distribution, and buyer reach. Negotiation leverage grounded in the extract itself.

**Aggregator (`src/lib/discovery/ccrs-extract/aggregate.ts`):**
- Packing widened (S10): the seller LicenseeId is now packed into the Float64 header value for
  EVERY wholesale header (S7 packed it only when the BUYER was a tracked competitor). Bound
  unchanged and still exact: the id occupies the same bits either way, max packed = 2^53 − 1
  exactly. Ids ≥ 2^36 are not packed — absent from the supplier table (never guessed), still
  counted in `wholesaleLines` (verified: max LicenseeId in the May 2026 Licensee table is 3,517 —
  nowhere near the 2^36 bound).
- New `StatewideSupplierStat` (top `TOP_SUPPLIERS_STATEWIDE = 100` by revenue desc → lineCount
  desc → id asc): lines/revenue/prices from wholesale SalesDetail lines (qty × unit − discount,
  clamped ≥ 0, exact-cents PriceHistogram percentiles); buyer reach = DISTINCT buyer licensees on
  wholesale SaleHeaders (a header with no surviving lines still proves the relationship);
  `trackedBuyers` = how many buyers are roster competitors (self never counts — dropped from the
  tracked set by the constructor). Identity from the monthly licensee table; missing rows leave
  nulls. Suppliers with headers but zero surviving detail lines are NOT emitted (no observed volume).
- Self appears honestly as a statewide supplier if the self license sells wholesale — the
  statewide table describes the market, it hides nothing.

**Migration `0109_discovery_supplier_stats.sql` (OWNER APPLIES MANUALLY):**
`discovery_supplier_stats` — one row per (dataset, supplier licensee), `unique (dataset_id,
licensee_id)`, cascade on dataset delete, ALL money/count columns BIGINT (the S8 lesson: real
statewide months overflow int4), integer only for the bounded buyer counts, staff-only RLS
matching 0106. Pinned by a schema-guard test (comments stripped line-wise before DDL checks —
the S8 regex lesson).
> **OWNER REMINDER:** apply `0109_discovery_supplier_stats.sql` manually, then RE-UPLOAD the
> monthly zips — supplier benchmarks only exist for drops transformed after this slice merges.

**Persistence (`src/lib/discovery/market-rollups.ts`):** sanitize gains a `suppliers` block —
BACKWARD COMPATIBLE (older payload without the array → `[]`, never a rejection), rejects rows
without a licenseeId and lists over `MAX_SUPPLIERS = 200`, coerces junk numbers, passes >2^31
revenue unclamped. Persist deletes-then-inserts `discovery_supplier_stats` per dataset (same
idempotent pattern as every other rollup table). New reader `listSupplierStats(datasetId)`
ordered by revenue desc.

**UI (Reports → Local Benchmarks):** new "Statewide supplier benchmarks" section (top 40 shown)
before the S9 switching section — supplier name + license, revenue, lines, p25/median/p75
wholesale unit-price band, distinct buyers, tracked buyers (highlighted when > 0). Best-effort
load in try/catch; section renders only when rows exist (pre-0109 datasets simply show nothing).

**Tests:** 12 aggregator tests (fixture supplier emission with price summary + buyer reach,
untracked-buyer inclusion vs the S7 view, qty×price−discount accumulation with clamping, header
buyer reach incl. line-less headers, zero-line suppliers not emitted, self-as-buyer counted but
never tracked, self-as-seller emitted honestly, null identity, top-100 cap, deterministic tie
ordering, ≥2^36 id skip, widened-packing round trip) + 6 sanitize tests (round trip, pre-S10
backward compat, missing-id rejection, oversize rejection, junk coercion, >2^31 pass-through) +
3 schema-guard tests over 0109. Suite: 937 passing.

### S11 — Auto-draft vendor outreach from shared suppliers (suggestion #3)

**What it does:** one click on the Leads page's "Shared suppliers — priority vendor leads" card
drafts a vendor lead for every multi-competitor supplier in the latest drop — the pre-qualified
call list. DRAFTS ONLY: nothing is contacted, ordered, or merged.

**Pure core (`market-leads-core.ts`):**
- `buildSupplierOutreachNote(lead, drop)` — grounded talking points only: supplier identity +
  WSLCB license (with "verify current status" caveat), which tracked competitors they supplied
  (names, spend desc), observed spend + line count framed EXPLICITLY as "this drop only", and a
  closing line that the figures are one month's reported transfers, not a run rate. NEVER GUESS:
  no projections, no invented contacts.
- `supplierLeadToVendorLeadInput(lead, drop)` — display name passed through verbatim (S7
  dba→name→licensee fallbacks already applied), license number carried (drives dedupe + vendor
  matching), priority **high ONLY for multi-competitor suppliers** (the owner's S7 rule), else
  the default med. `MAX_SUPPLIER_LEAD_DRAFTS = 100` (May real data: 61 shared suppliers fit).

**Server action (`draftSupplierOutreachAction`, actions.ts):** permission `inventory.manage` +
kill-switch guard; loads the latest transformer dataset's competitor stats + roster, selects the
SAME multi-competitor suppliers the card shows, and upserts each via `createVendorLead` —
dedupe_key upsert means RE-CLICKING NEVER DUPLICATES (already-piped suppliers return null and are
reported as skipped). Audited (`discovery.supplier_outreach_drafted` with inserted/processed).

**UI (`DraftSupplierOutreachButton.tsx`, client):** button under the shared-suppliers table with
inline honest feedback — "N new draft vendor leads created (M already in your pipeline —
skipped)". Errors (no dataset, discovery off, pre-0107 data) surface verbatim.

**Tests:** +6 (note grounding incl. no-projection/no-contact guards, single-competitor and
missing-period honesty, license-less supplier fallback, high/med priority mapping, draft cap
bounds). Suite: 943 passing.

### S12 — Assortment-gap analysis (suggestion #4)

**What it does:** a new "Assortment gaps — statewide movers vs your menu" section on Reports →
Local Benchmarks crosses the drop's statewide top movers (`discovery_market_signals`,
kind='statewide_mover', migration 0106 — no new migration needed) against Greenway's PUBLISHED
menu (`loadCandidateItems()`), answering: "which of the state's best sellers do we not carry?"

**Pure core (`assortment-gap-core.ts`):**
- `normalizeKey` — lowercase, trim, collapse whitespace, NOTHING else. No punctuation stripping,
  no fuzzy matching: aggressive normalization manufactures false "carried" matches, so a
  near-miss renders honestly as a gap instead of being silently mis-matched (NEVER GUESS).
- `buildAssortmentGapReport(movers, menu)` — statewide movers only (competitor_mover rows
  describe one store, not demand; kind-less legacy rows kept), nameless movers skipped, revenue
  desc, per-mover status: **carried** (exact name match) / **brand_carried** (brand on menu, with
  item count) / **not_carried** (neither). Rows capped at `MAX_GAP_ROWS = 50` for the UI but
  counts cover ALL candidates. Money minor units; junk numerics coerced, never NaN.
- HONESTY: CCRS product names come from producer/processor systems and rarely equal a retail
  menu name verbatim, so BRAND match is the primary signal — the UI copy says so, and the footer
  states that brand-less movers can only be name-matched.

**UI (`TransformerLocalBenchmarks.tsx`):** best-effort load of signals + menu (try/catch — no
signals → no section; no published menu → honest empty state telling the owner to publish one).
Table: mover name+brand, type, statewide units/revenue, median unit price, status badge (green
carried / gold brand-carried / neutral not-carried) + a counts footer disclosing the cap.

**Tests (`assortment-gap-core.test.ts`):** +15 — conservative normalization (punctuation
near-misses stay distinct), carried/brand_carried(+count)/not_carried, no fuzzy matching,
brand-less movers name-match only, revenue ordering, kind filtering (competitor_mover excluded,
kind-less kept), nameless skipped, cap-with-full-counts, MAX_GAP_ROWS default, empty menu, junk
numeric coercion. Suite: 958 passing.

### S13 — New-vendor early detection (suggestion #5)

**What it does:** a "New suppliers this month — first appearance in your uploads" section on
Reports → Local Benchmarks flags suppliers present in this drop's statewide supplier benchmarks
(`discovery_supplier_stats`, migration 0109 — no new migration) that are absent from EVERY prior
uploaded month with supplier data — candidate new producers/processors to call before competitors
lock in shelf space.

**Pure core (`supplier-history-core.ts`):**
- `supplierHistoryKey` — LICENSE NUMBER (stable WSLCB identity), fallback `id:<licensee_id>`;
  the same S9 cross-month join rule.
- `buildSupplierHistoryReport(latest, prior)` — first-appearance = present now, absent from all
  prior months WITH supplier rows. Pre-0109 prior months (zero rows) are EXCLUDED from the
  comparison (missing data ≠ absence) and returned in `priorWithoutSupplierData` for the UI's
  re-upload prompt. `detectable=false` when NO prior month has supplier data — nothing is called
  new when nothing can be compared. Revenue desc, `MAX_NEW_SUPPLIER_ROWS = 25` cap with pre-cap
  counts; dba→name→Licensee-id display fallbacks; junk numerics coerced. Money minor units.

**HONEST framing (in the UI copy, verbatim intent):** "first appearance in your uploads" is NOT
"new to the market" — months the owner hasn't uploaded and suppliers below a prior month's
top-100 rollup cap are invisible to the comparison. Rows are call-first candidates to verify,
never certainties.

**UI (`TransformerLocalBenchmarks.tsx`):** reuses the S9 dataset-list fetch; loads each older
dataset's supplier stats; section renders only when this drop has supplier stats, older months
exist, and detection is possible. Table: supplier + license, wholesale revenue, lines, statewide
buyers, tracked-competitor count (green when >0), plus cap disclosure and the pre-0109 re-upload
note listing excluded months.

**Tests (`supplier-history-core.test.ts`):** +13 — key stability across licensee-id changes,
license-less fallback join, first-appearance vs any-prior-month presence, no-prior-data and
first-upload honesty (detectable=false), data-less month exclusion, revenue ordering,
cap-with-full-counts, MAX default, display fallbacks + junk coercion. Suite: 971 passing.

### S14 — Web Worker transformer (suggestion #6)

**What it does:** the ~1 GB monthly-extract crunch now runs inside a WEB WORKER, so the tab stays
responsive and the browser never shows the "page unresponsive" prompt mid-crunch. No behavior
change to the math — the pipeline is byte-for-byte the same code, just relocated.

**Runner (`ccrs-extract/run.ts`):** the zip → parse → aggregate pipeline extracted VERBATIM from
CcrsZipUploader into a pure, DOM-free `runCcrsExtract(file, opts)` — same table filters
(SKIPPED_TABLES + labresult), same dependency ordering (Licensee → Strains → Product → Inventory
→ SaleHeader → SalesDetail), same reserve hints (chunk count × 1M), same row mappers, same
verbatim not-a-delivery-zip error. Progress = structured-clonable snapshots via callback (safe to
postMessage unchanged). Loadable in a worker AND under Node for tests.

**Worker (`transformer.worker.ts`):** thin shell — receives {file, self, tracked}, relays
progress, posts done/error. Errors cross the boundary VERBATIM (NEVER GUESS). Typed protocol
exported for the uploader.

**Uploader (`CcrsZipUploader.tsx`):** constructs the worker via the bundler-analyzable
`new Worker(new URL("…/transformer.worker.ts", import.meta.url))`; if construction throws
(ancient browser, blocked workers) it falls back to running the SAME runner on the main thread —
identical results, pre-S14 responsiveness, no regression path. Worker crunch errors reject
verbatim (they are real failures the main thread would reproduce identically after minutes of
frozen tab — retrying there would help nobody).

**Tests (`ccrs-extract-run.test.ts`, +6; shared fixture `fixtures/ccrs-zip-fixture.ts`):**
end-to-end over byte-exact synthetic nested deliveries (outer zip → inner table zips → UTF-16-LE
tab csv, verified May-2026 headers + Greenway's real licensee row): full-crunch math (competitor
retail revenue/units, wholesale sourcing qty×price−discount, S10 statewide supplier stats,
totals, period detection, Greenway never in competitor outputs), structuredClone-able progress
with monotonic filesDone + dependency-ordered first table, skip rules, verbatim error, and
callback-less operation. Suite: 977 passing.

---

## Task I — CCRS benchmark bug fixes, per-type intelligence, leads-page purchase cockpit, PO insights, and AI everywhere

### Owner's request (verbatim)

> this is working incredibly well so far. I have two things to report. the month over month history
> section on the CCRS benchmarks page, has the April upload I did twice in the list. I feel like the
> table should replace a duplicate with a newer uploaded version. it also shows the date as june of
> 2022, which is wrong, the month I uploaded was April of 2026. the other thing that is not working
> quite right, is the velocity and mix section with the retail volume by type, it does not breakdown
> the info like it should. same with the top part of the page, none of the by type boxes are filled.
> I am also hoping we can add some extra insight to this page. like being able to see which vendor/
> brand the top strains/ products are from. I want to be able to, like the top strains section, to be
> able to have a list of the top 10 products from every single type shown each in its own section
> with the ability to see which vendor/ brand those products come from. the next thing I want to
> focus on is the product leads page. we now have all this data, what would a professional expert
> level purchase manager need to make their job as easy as possible. I want there to be more displays
> and tables and insights related to our local competitors as well as port orchard specifically. port
> orchard is who we really need to start beating. so I need my purchase manager to have an easier
> time putting together purchase orders with this new gold mine of information. you are super
> intelligence... please use this vast wealth of knowledge you have to transform our leads page.
> after you have done that transformation, I need you to then focus on the purchase order detail
> page, where my purchase manager actually builds the p.o.'s. I need this to be a super easy super
> clean super helpful page for my manager to build the best p.o.'s possible that focus on port
> orchard and local competitor insights from ai. I want ai to be included in all of the benchmarks
> sections. it knows more about the data set than we do and can offer way more insight than simple
> charts and tables. I want to be able to ask questions and have appropriate and fantastic responses
> and insights. after we nail this, the entire pipeline from leads, ordering, receiving, enriching,
> etc. we will have the greatest intake and enrichment system around. please put together a roadmap,
> task list, todo list that are all handoff ready. please help me finish this off. please proceed,
> follow the standing rules, never guess, no short cuts or cutting corners. best work possible, use
> you best judgement when it comes to professional and expert level enhancements. I trust you to
> make the right decision. please proceed. thank you.

### Verified root causes (from the REAL May 2026 zip + code reading — never guessed)

1. **Wrong month (2022-06) + duplicate April rows in history.** SaleHeader files in a monthly
   delivery contain every header *updated* that month, with original `SaleDate`s spanning 54
   distinct months (sampled 1.2M May headers: 2026-05 = 53.2% dominant; tail back to 2021).
   `aggregate.ts` tracked `minDate`/`maxDate` over ALL headers, so `periodStart` landed on a stale
   old sale (June 2022) and the dataset label inherited it. And `saveMonthlyRollupsAction` always
   `createDataset`s — re-uploading the same month created a second row instead of replacing it.
2. **Empty "by type" boxes / broken "retail volume by type" / mixed-up brand table.**
   `listBenchmarks()` had NO pagination — PostgREST caps a read at 1000 rows while a drop writes
   ~6,000–8,200 benchmark rows, and `order("scope_key")` means only alphabetically-early keys
   (e.g. "(unattributed)", numeric-prefix "brands" like `1g`, `3.5g`) survived the cut.
3. **Brand contamination.** `extractBrand`'s prefix-before-separator heuristic captures junk
   tokens; verified over 300k real May product names: real brands dominate but `3.5g` (712),
   `Flower` (642), `100mg`, `2pk` etc. leak in. Also verified: the `"… by <brand>"` naming
   convention is common (e.g. "Gelato x Dosidos by Mt Baker Homegrown - 14g").
4. **No vendor attribution on top products/strains.** `Product.LicenseeId` (the producer/processor
   that created the product = the vendor) exists in the raw file and in `parse.ts`'s `ProductRow`,
   but `addProduct` dropped it. Licensee identity for every licensee is already interned (S7).

### Slices (one PR each; owner applies migrations manually)

- **I1 — Dataset identity: dominant-month period + replace-on-reupload.**
  `aggregate.ts` builds a yyyy-mm histogram of header SaleDates and reports the DOMINANT month as
  the period (full month span), plus honest min/max kept as observed span metadata. Label becomes
  `CCRS monthly · <dominant yyyy-mm>`. `saveMonthlyRollupsAction` finds prior `monthly_zip`
  datasets with the same label and deletes them AFTER the new dataset persists + flips ready
  (replace, never lose data on a failed upload — owner: "the table should replace a duplicate
  with a newer uploaded version"). Existing bad rows fix themselves on re-upload.
- **I2 — Paginate `listBenchmarks`** with the same `.range()` loop the file already uses
  elsewhere; fixes all by-type StatCards, velocity & mix, $/g, and truncated brand/strain tables.
- **I3 — `extractBrand` v2.** Blocklist of weight/size/count/generic tokens (verified junk set),
  `"… by <brand>"` extraction, still conservative (null when unsure — never guess).
- **I4 — Per-type top products with vendor + brand.** Aggregator keeps per-inventory-type top
  product accumulators (retail, revenue-ranked, cap 10) carrying brand, strain, and the product's
  creating licensee (vendor) resolved to name/license via the interned licensee table; statewide
  movers gain the same vendor fields. New signal kind `type_mover` rides the existing
  `discovery_market_signals` table; migration 0110 adds nullable `vendor_name` / `vendor_license`
  columns. CCRS Benchmarks page renders "Top 10 products — <type>" sections for EVERY type in the
  drop, each row showing brand · strain · vendor, and the top-strains/movers tables gain vendor.
- **I5 — Leads page → purchase-manager cockpit (Port Orchard first).** New pure core
  (`po-cockpit-core.ts`) shaping persisted rollups into buyer-ready boards: Port Orchard
  head-to-head (Greenway vs each PO competitor: revenue, units, mix), "what Port Orchard sells
  that we don't order" (PO competitor movers vs our PO/vendor history), undercut board (p25 price
  targets on local movers), shared-supplier call list (exists, S7) — every row with a one-click
  "Start PO" prefill into Purchasing.
- **I6 — PO builder + detail: market context & AI review.** The builder and the PO detail page
  surface grounded local-market context (median/p25 for matching movers, Port Orchard emphasis)
  and an advisory AI review of the draft PO (line-by-line: price vs market band, mix warnings,
  Port Orchard-focused suggestions). Drafts-only; AI never edits an order.
- **I7 — AI everywhere in benchmarks + interactive Q&A.** "Ask the analyst" panel on the CCRS
  Benchmarks page and the Local Benchmarks report: free-text question → server action builds a
  grounded digest (persisted rollups ONLY: benchmarks, competitor stats, suppliers, signals,
  history) → structured, cited answer via the leads-ai pattern (`generateStructured`, heavy tier,
  never invents figures; unconfigured key = friendly notice).

Standing rules apply to every slice: never guess (verify against real data/code), money in minor
units, drafts-only AI, tests + roadmap update per slice, CI green, squash-merge, sync main.

### I1 — shipped notes

**Aggregator (`ccrs-extract/aggregate.ts`):** every dated SaleHeader also feeds a yyyy-mm
histogram (`monthCounts`); `result()` reports the DOMINANT month's full calendar span as
`periodStart`/`periodEnd` (ties break toward the newer month; leap years from the calendar),
with the honest observed min/max kept as `observedMinDate`/`observedMaxDate`. No dated headers →
null period (never guessed).

**Sanitizer (`market-rollups.ts`):** carries the two new optional observed-span fields
(older payloads sanitize to null — backward compatible).

**Action (`actions.ts` `saveMonthlyRollupsAction`):** captures prior `monthly_zip` datasets with
the same `CCRS monthly · yyyy-mm` label BEFORE creating the new one, and deletes them only AFTER
the new dataset persists and flips ready — replace-on-reupload without ever risking data on a
failed upload. Replaced ids are recorded in the audit event. Existing mislabeled/duplicate rows
fix themselves when the owner re-uploads each month's zip.

**Tests:** +4 (stale-header dominance mirroring the real May-zip shape, newest-month tie break,
leap February, 'other'-type headers still dating the drop) and 3 updated period assertions.
Suite: 981 passing.

### I2 — shipped notes

**`benchmarks.ts` `listBenchmarks`:** now paginates with the same `.range()` loop the file
already uses in `loadSales`/`loadPotency` (+ a stable `id` tiebreaker within equal scope_keys).
Root cause of the owner's "by type boxes empty / velocity & mix broken / brand table mixed up"
reports: a drop writes ~6,000–8,200 benchmark rows but the un-ranged read stopped at PostgREST's
1,000-row cap, and scope_key-ascending ordering meant only alphabetically-early keys (e.g.
"(unattributed)", numeric-prefix junk "brands") survived. Pure read-layer fix — no migration,
no re-upload needed; the pages heal on next render.

### I3 — shipped notes

**New shared pure module `brand-core.ts`** (single source for the transformer AND the legacy CSV
path — the two v1 copies could drift): prefix-before-separator extraction kept, plus (a) a
junk-candidate blocklist — a candidate is rejected only when EVERY token is a weight/size
(`3.5g`, `100mg`, spaced variants like `10 ct`), count/pack (`2pk`, `x2`) or generic category
word (`Flower`, `Preroll`, `Live Resin`…); all-numeric real brands like `2727` (1,311 real hits)
and lines that merely contain a generic word ("Regulator Sugar Wax (2.0)") pass — and (b) the
verified `"… by <brand>"` convention: the brand after the last " by " wins when the prefix is
itself a strain-by-brand run or junk; a junk by-brand still returns null (never guess).
`aggregate.ts` and `ccrs.ts` now import + re-export it (call sites unchanged).

**Tests:** new `brand-core.test.ts` (+14) with fixtures mirroring real May-2026 names. Suite:
995 passing. Owner: re-upload monthly zips to rebuild brand benchmarks with the clean extractor.

### I4 — shipped notes

**PLAN CORRECTION (never guess, verified against the real May-2026 delivery):** the original I4
bullet assumed retail `Product.LicenseeId` names the creating vendor. Measured reality: over 26k
joined retail lines it equals the RETAILER 99.7% of the time — useless as a vendor signal. The
wholesale-sales brand bridge was also measured (1.1–2.1% of retail revenue) — insufficient. The
shipped vendor route is MANIFESTS:

- **Lot-level join (exact):** `ManifestHeader` (live rows only; deleted manifests skipped whole)
  gives `ExternalManifestIdentifier → OriginLicenseNumber/Name`; `TransportedItems` (live rows)
  ties that manifest to `InventoryExternalIdentifier`; the retailer's
  `Inventory.ExternalIdentifier` equals it (case-insensitive). Measured: 306,998 lots resolve;
  1,858 lots claimed by two different origins are TOMBSTONED (never guessed); 24.6% of retail
  inventory rows hit.
- **Brand→vendor bridge (conservative fallback):** `normalizeBrandKey(extractBrand(transported
  description))` → dominant origin license, accepted only at ≥80% share across ≥3 distinct
  manifests (one count per brand+manifest). 2,698 brands resolve.
- **Measured coverage on the real May zip:** 53% of the top-10-per-type products get a vendor
  (85 lot-level + 8 bridge of 175); the rest stay honestly null.

**Transformer:** `parse.ts` un-skips `manifestheader`/`transporteditems`, adds verified header
signatures + `mapManifestHeader`/`mapTransportedItem`, and carries `Inventory.ExternalIdentifier`
(the lot id). `run.ts` crunches manifests BEFORE inventory (lot map must exist when inventory
joins). `aggregate.ts` builds `lotVendor` (+conflict tombstones), the brand bridge, and
`invVendor` (inventoryId→vendor license); every retail mover sighting records the lot's vendor;
`resolveVendor` = dominant lot vendor (ties → smaller license) → bridge at thresholds → null.
Vendor display name: licensee-table DBA → name → manifest origin name. NEW signal kind
`type_mover`: top `TOP_TYPE_MOVERS_PER_TYPE` (10) products per inventory type, grouped over the
FULL mover map (small types keep their leaders), revenue-desc; statewide + competitor movers gain
the same `vendorName`/`vendorLicense` fields.

**Persistence:** migration `0110_discovery_signal_vendor.sql` (owner applies MANUALLY) adds
nullable `vendor_name`/`vendor_license` to `discovery_market_signals`; `kind` is plain text so
`type_mover` needs no DDL. Sanitizer accepts the new kind, passes vendor fields through
(pre-I4 payloads sanitize to null), counts `manifestRows`/`transportedItemRows`, and raises
MAX_SIGNALS 2000→4000 (~25 types × 10 + existing 100 + 15/competitor headroom).

**UI:** CCRS Benchmarks gains "Top products by type" — one section per inventory type (biggest
type first), each a top-10 table with Product / Brand / Strain / **Vendor** (license in the
title tooltip) / Units / Revenue / Median / Low(p25), via pure `type-movers-core.ts`
(`groupTypeMovers`). Empty state tells the owner to re-upload after applying 0110.

**Tests:** +29 (aggregator manifest path: lot join incl. case-insensitivity, deleted-skip,
tombstoning, dominance + deterministic ties, bridge thresholds + dedupe, lot-beats-bridge,
≤10/type emission, unattributed fold; `type-movers-core` grouping; sanitizer type_mover +
vendor round-trip + pre-I4 compat; migration 0110 guard; parse detection/mappers with the real
header rows; run.ts end-to-end with manifest zips). Suite: 1024 passing. Owner: apply 0110,
then re-upload April + May zips to backfill vendor data and the per-type boards.

### I5 — shipped notes

**PLAN CORRECTION (verified before building — never guess):** the plan sketch said the buy list
would cross Port Orchard movers against "our PO/vendor history". Verified reality: the monthly
transformer **structurally excludes Greenway (`is_self`)** from all competitor rollups, so no
Greenway CCRS numbers exist anywhere in the drop; and the PUBLISHED MENU (`loadCandidateItems()`,
same source as the S12 assortment-gap report) is the honest, current statement of what we carry —
PO history says what we once ordered, not what's on the shelf. The shipped cockpit therefore
compares their CCRS reality against our published menu, and the head-to-head board is *their*
month + *our coverage of their movers*, never an invented Greenway sales figure.

**PURE core `src/lib/discovery/po-cockpit-core.ts`** (`buildPoCockpit(stats, roster, signals,
menu, {area})`, default `port_orchard`; money in minor units; junk → 0/null):
- **Head-to-head board** — one row per tracked area competitor (self excluded): revenue/units/
  line count, p25/median/p75 bands, top-3 category mix with revenue shares, wholesale spend +
  supplier count (null for pre-0107 rows), and our menu's coverage of that store's
  `competitor_mover` list (carried / brand-only / gaps) using the CONSERVATIVE
  `normalizeKey` exact-name + brand matching from `assortment-gap-core` (imported, not copied).
- **Buy list ("they sell it, we don't")** — area movers deduped across stores on
  `brand|name` key: units/revenue summed; stores listed by contribution; **price to beat =
  MIN p25 across stores** (beats ~75% at EVERY store — a factual bound, not a pooled estimate);
  median from the top-revenue store (labeled proxy); brand/strain/type/vendor carried only when
  all contributing rows AGREE (two different values → null tombstone; null-vs-value is NOT a
  conflict); exact-name-carried movers excluded; brand-only flagged. Cap 25 (`MAX_BUY_ROWS`).
- **Undercut board** — exact-name matches where BOTH our min matching menu price and their MIN
  p25 exist; `delta = ours − theirs`, sorted above-beat-first. Cap 15 (`MAX_UNDERCUT_ROWS`).
- **`suggestLeadCategory`** — CCRS type → lead category ONLY for unambiguous WSLCB types
  (verified May-2026 vocabulary): Usable Cannabis/Marijuana + Flower Lot → flower; Cannabis Mix
  Packaged/Infused → preroll; Hydrocarbon/Ethanol/CO2/Non-Solvent → concentrate; Solid/Liquid
  Edible → edible; Topical Ointment → topical. Ambiguous (Concentrate For Inhalation = carts OR
  dabs, Cannabis Mix, Tincture, Capsule, …) → null: the manager picks on the builder.
- **`buildBuyRowDemandSignal`** — grounded this-drop-only demand copy stored on the created lead.

**Server action `startPoFromCockpitRowAction`** (discovery/actions.ts): creates a HIGH-priority
product lead (dedupe-safe — a re-click reuses the existing lead via new
`getProductLeadByDedupeKey` in store.ts, since the upsert's ignoreDuplicates returns null on a
dupe), marks it ordered + audits, then redirects into `/admin/purchasing/new` with the EXISTING
prefill contract (fromLead/leadName/leadBrand/leadCategory/leadVendorName/leadVendorId) — so the
PO save stamps `promoted_po_id` back on the lead exactly like a normal promotion. The I4 manifest
vendor is threaded as a vendor id ONLY when `matchVendorLead` (license-exact, else conservative
name match) finds a real vendor record; otherwise name-only text. The observed p25 is a RETAIL
price, so unit cost is deliberately NOT prefilled — the manager enters the real quote.

**UI `src/app/admin/discovery/PoCockpitSection.tsx`** — server component in the
MarketMoversSection best-effort pattern (any failure/no dataset/no area competitors → renders
nothing), mounted on the Leads page ABOVE Market movers: "Port Orchard battle plan" Section with
the three cards, CCRS-monthly period badge, menu-item count in the honesty copy, and per-row
Start PO forms. "—" everywhere data was too thin or conflicting.

**Tests:** +25 in `tests/compliance/po-cockpit-core.test.ts` (category map incl. refusals;
board: area scoping + self exclusion + non-default area, mix shares, junk coercion, pre-0107
sourcing nulls, coverage counting, signal-kind filtering; buy list: cross-store dedupe/min-p25/
store ordering, agree-vs-conflict tombstones, null-not-a-conflict, pre-0110 vendor nulls,
brand-carried stays listed, carried excluded, category suggestion, sort + caps, junk/unnamed
skips; undercuts: min-menu-price pairing, both-prices-required, above-first sort + cap; menu
accounting; demand-signal copy). Suite: 1049 passing. No migration needed (reads 0106/0107/0110
tables as-is).

### I6 — shipped notes

Owner's ask: "the purchase order detail page, where my purchase manager actually builds the
p.o.'s. I need this to be a super easy super clean super helpful page for my manager to build the
best p.o.'s possible that focus on port orchard and local competitor insights from ai."

**Pure core `src/lib/purchasing/po-market-context-core.ts`** — `buildPoMarketContext(lines,
signals, roster, {area})` crosses PO lines (or builder candidate rows — anything in `PoLineLike`
shape) against the persisted monthly CCRS market signals (0106/0110) and the verified roster.
Matching is CONSERVATIVE: exact product-name equality after `normalizeKey` first, brand-level
fallback, otherwise `none` — never fuzzy. Provenance is honest: `competitor_mover` signals count
ONLY when they come from a tracked store in the target area (out-of-area/untracked rows are
DROPPED, never mislabeled); statewide/type movers count as statewide evidence. Per line: area
stores (deduped/sorted tradenames), summed units/revenue across matches, MIN p25 across matches
(the "price to beat" — a factual bound), median from the single top-revenue match (labeled
proxy), and `retailCostMultiple` = p25 retail ÷ wholesale cost to 1 decimal ONLY when both are
known and cost > 0 (plain arithmetic across different bases, never a margin claim). Order mix
aggregates by the lines' OWN categories with spend shares. Junk numbers coerce to 0/null;
unnamed lines are skipped; money in minor units end to end. `formatPoReviewDigest` renders the
grounded fact block the AI reasons over, explicitly labeling `unit_cost=… (WHOLESALE)` vs
`retail_price_to_beat_p25` and per-line `PORT ORCHARD_EVIDENCE`.

**AI reviewer `src/lib/purchasing/po-review-ai.ts`** — leads-ai pattern (`generateStructured`,
tier "heavy" → router-controlled model, temperature 0.3, flat schema DSL). Returns
`PoReview {headline, line_reviews, mix_observations, pre_send_checks, model}`; line reviews come
back as pipe-delimited strings parsed by the PURE `parseLineReviews` (verdicts
solid/check_price/check_demand/reconsider; unknown verdict → check_demand; confidence clamped
0..1, NaN → 0.5; malformed rows dropped). The SYSTEM prompt enforces the wholesale-vs-retail
basis rule, Port Orchard-first weighting, and never-invent-figures. Advisory only — it never
edits the order.

**Action `src/app/admin/purchasing/actions.ts` `reviewPurchaseOrderAction`** — permission check,
friendly unconfigured-key message, re-reads the PO's REAL lines via `getPurchaseOrder`,
best-effort dataset/signals/roster load (no drop → the reviewer honestly sees match=none
everywhere), builds context for `port_orchard`, generates the review, records a
`purchase_order.ai_review` audit event (model, line count, evidence count).

**UI** — `src/app/admin/purchasing/PoMarketContextCard.tsx` (server, shared): per-line table
(match badge, Port Orchard evidence with store names, units/revenue, retail median, price to
beat p25, retail÷cost) with evidence-first ordering, honest "—" everywhere data is missing, and
the wholesale-vs-retail basis note; best-effort (any failure/no dataset hides the card). Mounted
on the PO DETAIL page (all lines + order-mix chips, `showMix`) and on the BUILDER as a
market-check strip (`onlyMatched`, cap 15 — only rows with real evidence show; the lead prefill
row is included). `src/app/admin/purchasing/[id]/PoReviewPanel.tsx` (client, LeadsAssistantPanel
pattern): "Review this PO" → headline, line-by-line verdict cards, Order mix / Before you send
bullets, provenance footer; soft-disable copy when no AI key.

**Tests:** +13 in `tests/compliance/po-market-context-core.test.ts` (exact/brand/none matching,
normalizeKey-insensitive but never fuzzy, statewide-vs-area provenance, out-of-area drop,
multi-source MIN-p25/top-revenue-median/store dedupe, retail÷cost gating, junk coercion +
unnamed-line skip, mix shares, digest basis labels + unmatched rendering, parseLineReviews
clamps/defaults/drops). Suite: 1062 passing. No migration needed (reads 0106/0110 as-is).

### I7 — shipped notes

Owner's ask: "I want ai to be included in all of the benchmarks sections … I want to be able to
ask questions and have appropriate and fantastic responses and insights."

**Pure core `src/lib/discovery/benchmarks-ai-core.ts`** — two grounded fact blocks built ONLY
from the persisted rollups the pages already render (never raw CCRS re-reads, never invented):
`buildStatewideAnalystDigest` (dataset provenance + one-month scope notice + attribution share,
overall retail/wholesale/$g bands, per-type/brand/strain price tables biggest-samples-first with
null-median rows dropped, month-over-month history, per-type top movers with the honest
`vendor=unresolved` fallback) and `buildLocalAnalystDigest` (self-exclusion + Port Orchard-first
notice, area rollups with the labeled median-of-medians proxy, per-competitor rows — bands, top
products, top suppliers, wholesale spend with an honest "none recorded (pre-0107…)" state —
shared multi-competitor suppliers, statewide supplier benchmarks labeled WHOLESALE). Both return
NULL when nothing is persisted; missing figures print "n/a"; retail-vs-wholesale bases labeled
on every money line; caps keep the prompt bounded (15 competitors, 12 types, 15 brands, 12
history months…). `sanitizeAnalystQuestion` trims/collapses/caps at 500 chars and refuses
empty/non-string input. Shared `AnalystAnswer`/`AnalystAnswerResult` types live here (pure) so
the client panel never imports server-only code.

**AI module `src/lib/discovery/benchmarks-ai.ts`** — leads-ai pattern (`generateStructured`,
heavy tier → router-controlled, temperature 0.2, flat schema `benchmark_analyst_answer`):
headline (must say plainly when the data can't answer), 2-8 answer_points quoting the digest's
actual numbers, key_facts grounding trail (citations of DATA lines only), caveats (one-month
scope, thin n, n/a fields, basis), and follow_ups the SAME dataset can answer. The SYSTEM prompt
hard-rules: digest-only figures, basis separation, no month-to-year extrapolation, Greenway
never in the data, Port Orchard weighted first, thin samples flagged.

**Actions `src/app/admin/discovery/analyst-actions.ts`** — `askStatewideAnalystAction`
(inventory.manage; benchmarks + best-effort history/type-movers exactly like the page) and
`askLocalAnalystAction` (reports.view — matching the report page's permission; competitor stats
+ roster → buildLocalBenchmarks, shared suppliers, best-effort 0109 supplier stats). Both:
friendly unconfigured-key message, sanitized question, dataset validated by id, no-digest → an
honest "nothing persisted to analyze" message, `discovery.benchmarks_analyst` audit (surface,
model, question).

**UI `src/app/admin/discovery/AskAnalystPanel.tsx`** — shared client panel (LeadsAssistantPanel
styling): free-text input + one-click example chips per surface, headline + Answer bullets +
"Grounded in" / "Caveats" columns + clickable "Ask next" follow-ups + provenance footer (model,
one-month scope, basis note, self-exclusion); soft-disable copy when no AI key. Mounted on the
CCRS Benchmarks page (both the transformer view and the legacy computed view — hidden until
benchmarks are computed) and on the Local Benchmarks report (transformer view, above the
tables).

**Tests:** +16 in `tests/compliance/benchmarks-ai-core.test.ts` (sanitizer trim/refusal/cap;
statewide: null-on-empty, scope+attribution labels, dollar bands with n, scope grouping with
sample-desc ordering + null-median drops, history with n/a, movers with vendor=unresolved;
local: null-on-empty, self-exclusion/PO-weighting labels, area proxy label, competitor rows,
honest missing-wholesale state, shared suppliers + supplier stats ordering/fallback-name/basis,
competitor cap messaging). Suite: 1078 passing. No migration needed (reads persisted rollups
as-is).

---

## Task J — Purchase Order Command Center (`/admin/purchasing/new` major upgrade)

## Owner's request (verbatim)

> "I now need you to focus your attention on the new purchase order page, or the purchase
> builder, the page that I see when I click the 'new purchase order' button on the purchasing
> page. that page was not touched I can see, did you build a po builder somewhere else? I will
> upload a screenshot for you to see the page currently and then I want you to give it a major
> major upgrade and enhancement so it is a true purchase order command center. unless you built
> the po command center somewhere else? if so, please move it to the new po page. if not, deep
> research professional and expert level purchase order building. I want this to be clean easy
> and powerful. please use your vast knowledge and wisdom to build me something truly excellent
> and awesome. please proceed, follow the standing rules, no guessing no cutting corners no
> short cuts. be handoff ready. thank you."

Context answered honestly: the I5 "battle plan" cockpit was built on **Discovery → Leads**
(`PoCockpitSection`), and the I6 market-check card WAS already mounted on the builder — but it
hides itself when no CCRS dataset/matches exist, and the owner's screenshot showed the page in
its **empty state** (no active inventory lots ⇒ zero reorder suggestions ⇒ one barren line of
text). Task J = bring the cockpit ONTO the builder, add a real command-center layer, and make
the empty state honest and helpful.

### J — shipped notes (PR #TBD)

**Research** — grounded in the existing `docs/RESEARCH_CANNABIS_PURCHASING.md` (Cova reorder
math, Northstar category benchmarks, NetSuite procurement KPIs) plus fresh reads: Happy Cabbage
dispensary demand-planning (stockouts on top movers at the front of a purchase cycle are the #1
revenue leak; overstock of non-movers is the #1 cash trap ⇒ urgency triage must be
velocity-gated) and Ivalua procurement-dashboard practice (a FEW actionable KPIs beat vanity
counts; role-relevant rollups; drill-downs over static numbers).

**Pure core `src/lib/purchasing/po-builder-core.ts`** (no server-only, no DB — shared by the
server page, the client island, and vitest):
- `classifyUrgency(row, leadTimeDays)` → `stockout` (selling, zero on hand) / `critical`
  (below reorder AND days-of-supply ≤ the store's real lead time — runs out before a typical
  delivery) / `low` (below reorder, more runway) / `healthy`. **Velocity-gated:** zero recent
  sales ⇒ never urgent (reordering a non-mover is how dead stock happens).
- `builderRowKey(row)` — STABLE row identity (pos_product_key, else `name:<normalized>` —
  exactly the store's own lot-dedupe key). Fixes a latent hazard: the old table keyed edit
  state by array index, which client-side sorting would have corrupted.
- `buildBuilderKpis` (stockout/critical/low counts, needs-action, suggested units + spend in
  minor units, distinct vendors/categories), `groupRowsByVendor` / `groupRowsByCategory`
  (needs-action + spend per group, worst-first), `filterRowsByQuery` (name/brand/vendor/
  category substring), `sortRows` (urgency default reproducing the server order, plus
  daysLeft/value/product/vendor/category/onHand; stable, non-mutating, Infinity-safe),
  `presetRowKeys` (needs_action / stockouts / critical / all / none — qty>0 only for urgency
  presets), `countVendorMismatches` (PO-vendor vs line inventory-vendor sanity check),
  `buildEmptyStateGuidance` (filtered-to-nothing vs truly-no-lots vs lead-only, with
  grounded hints on how suggestions are actually computed).

**Page `src/app/admin/purchasing/new/page.tsx`** — retitled "Purchase order command center":
- **Command strip** (only when rows exist): Stockouts / Order today (≤ lead time, labeled with
  the store's real setting) / Below reorder / Suggested buy ($ + units) / In view (rows,
  vendors, categories) — colored borders on the urgent tiles, all computed by the pure core.
- **Vendor hot list** — top vendors with needs-action items and their suggested spend ("who do
  I owe a call today?").
- **Honest empty state** (EmptyState component + guidance hints) replacing the barren one-liner:
  explains WHY it's empty (filters vs no active lots), primary action (Reset filters / Go to
  Inventory), secondary (Open Discovery leads), and how suggestions are computed. Lead-prefill
  arriving onto an empty inventory keeps the builder mounted with an explanatory note.
- **Port Orchard battle plan ON the builder** — mounts the same `PoCockpitSection` (I5) used on
  Discovery → Leads: head-to-head board, "they sell it, we don't" buy list with one-click Start
  PO, price check vs their p25. Best-effort as before (hidden with no dataset) and additionally
  gated on `isDiscoveryEnabled()` because its Start-PO action requires the Discovery flag.
- I6 market-check card, AI plan box, manual filters, reference/settings section unchanged.

**Client `src/app/admin/purchasing/new/builder-table.tsx`** — command-center work surface:
- Live search (product/brand/vendor/category), sort dropdown (urgency default), quick-select
  chips (Stockouts / Order today / Needs action / All / None) acting on the VISIBLE rows;
  the prefilled lead row is pinned on top and survives search/presets (except explicit None).
- Urgency Badge per row (stockout=danger, critical=orange, below reorder=gold, lead=green).
- All edit state (selection, qty, cost) keyed by the STABLE row key.
- Sticky bottom order bar (totals, category mix chips, Save as draft / Save & send) so the
  actions stay visible on long tables.
- Vendor mismatch warning when selected lines' inventory vendor differs from the PO's vendor.
- **Contracts preserved exactly:** hidden `lines` JSON field (same NewPoLine field names),
  `origin`, `from_lead`, `vendor_id/name/email`, `expected_date`, `note`;
  createPurchaseOrderAction / createAndSendPurchaseOrderAction untouched; lead-prefill URL
  contract untouched.

**Tests:** +27 in `tests/compliance/po-builder-core.test.ts` (urgency incl. the
zero-velocity-never-urgent rule and defensive lead-time handling; stable keys; KPI sums and
dedupe; vendor/category grouping with (unknown) bucket; search; every sort key incl.
stability + non-mutation + Infinity; all five presets; vendor mismatch counting incl.
case/whitespace and null vendors; all three empty-state variants). Suite: **1105 passing**
(was 1078). tsc + eslint clean. No migration needed — reads existing tables only.

## Task K — Employee Samples page rebuild (compliance-first, table-based assignment)

**Owner request (verbatim, condensed):** "the page is a disaster… research exactly what a
retailer specifically needs to have on this page to keep us compliant, and that's it. I don't
want the json upload to happen here anymore, those will filter into receiving via the email
intake… a simple form that only has what is required… Limits respected… There should be a
table with the available samples to select. I don't want a drop down… Assign the selected
sample to the employee, if the system says they are allowed to have it, mark/record it out of
the system in whatever way is the CCRS required way. Then… confirm the samples history page is
properly connected."

**Research (verified, not guessed):**
- WAC 314-55-096 (WSR 25-08-032, eff. 4/26/25): a retailer's only sample lane is TRADE.
  Incoming ≤120 units/qtr/processor [096(1)(f)(ii)]; outgoing ≤30 units/qtr/CURRENT PAID
  employee [096(1)(j)(vi)] (jar leftovers count [096(4)(d)(i)]); per-unit sizes 3.5 g useable /
  1 g concentrate / 100 mg infused, ≤10 mg THC/serving [096(1)(e)]; the retailer must track
  incoming AND outgoing sample inventory by product type and record amount + product type +
  employee name [096(1)(j)(iv)-(v)]; no customer samples [096(2)]; IQC is producer/processor
  only [096(3)].
- CCRS reporting mechanism (LCB-confirmed via GrowFlow help, May 2025): an employee sample is
  reported to CCRS as an **InventoryAdjustment with reason "Other" and a detail naming the
  employee**, plus the retailer's own log of samples and recipients.

**What shipped:**
- **New pure core `src/lib/compliance/employee-sample-core.ts`** — maps accepted sample lots
  (`inventory_lots` is_sample/active/on-hand>0) into selectable table rows (product type via the
  H16b-9 resolver; per-unit size derived from the lot's unit_weight g/mg/oz); validates the
  minimal assignment draft (employee, units ≤ on-hand, date, size caps, manual size only when
  the lot has no weight on file); builds the employee-named CCRS adjustment note; embedded
  self-tests.
- **`assignSampleToEmployee` (trade-samples.ts)** — one call does the compliant sequence:
  records the OUTGOING `trade_sample_events` row (30/qtr cap HARD-blocked; now linked via
  `lot_id` + source product/lot identity) then posts a negative `inventory_adjustments` row with
  new internal reason **`employee_sample`** (decrements the lot's on-hand). If the adjustment
  fails after the ledger row landed, the receipt stands and the owner gets an explicit warning
  to post it manually — never silently lost.
- **CCRS exporter** (`ccrs-inventory-adjustment-core.ts`): `employee_sample` → AdjustmentReason
  **"Other"** with the employee-named detail (the LCB-confirmed shape). The pre-existing lab/QA
  `sample` → ReturnedLabSample mapping is unchanged. `employee_sample` added to the lot-page
  adjustment reasons and the inventory action whitelist. NOTE: `inventory_adjustments.reason` is
  free text (0023) — **no migration needed**.
- **Page rebuilt (`/admin/compliance/samples`)** — retitled "Employee samples". REMOVED: JSON
  upload (SampleImportUploader), recent-imports table, the manual incoming/outgoing recorder
  with its product DROPDOWN (SampleRecorder), the capacity gauge, and the JSON-import plumbing
  (`sample_json_imports` readers/writers) — samples now arrive exclusively through email-intake
  receiving (cap preflight + auto incoming ledger already shipped in H16b). ADDED:
  `SampleAssigner` — a TABLE of available samples (radio row select, search over name/strain/
  lot/vendor) + the minimal form (employee with live remaining-allowance, units, date, from-jar
  flag, optional note; manual size field only when the lot carries no unit weight). The
  "inbound section" question resolved: intake usage vs the 120 cap is now a READ-ONLY panel
  pointing at Receiving (that cap IS retailer-relevant but is enforced at receiving, not here).
- **Server action `assignSampleAction`** re-resolves the lot server-side (never trusts the
  client row), requires a CURRENT paid employee, audits as `trade_sample.assigned`, and
  revalidates samples + history + inventory.
- **History page connection confirmed + tightened:** `listEmployeeSampleHistory` already
  surfaces outgoing rows with source product/lot; assignments now also carry `lot_id`.
  Breadcrumb/copy updated ("assignments happen on the Employee Samples page"). Nav label →
  "Employee Samples"; concierge KB facts updated to describe the real flow.

**Tests:** new `tests/compliance/employee-sample-core.test.ts` (+7: self-test suite, lawful-row
building, on-hand block, product-identity carry, employee_sample→Other + note ≤250 chars,
lab-sample mapping unchanged, allowance floors). Suite: **1112 passing** (was 1105). tsc +
eslint clean. No migration needed.

## Task L — Inventory management powerhouse (CCRS + DOH compliant)

**Shipped:** 2026-07-12 (branch `task-l-inventory-powerhouse`).

**Owner's request (verbatim):** "I want you to now go back to the CCRS and doh rules and
regulations. I want you to learn and document everything there is to know about retail cannabis
inventory management. I want to make sure we have an inventory management system that is CCRS
and doh compliant. I also want you to enhance and upgrade the inventory management system so it
is a truly powerful system that is easy to use, clean and simple, feature rich, efficient and
makes use of every professional and expert level tactic and strategy for managing large
inventory. This needs to be highly specific to the Washington state retail cannabis industry.
But it also should follow industry standards and best practices for managing inventory like a
pro. ... This also includes the cycle counts page as this is how we efficiently audit inventory
counts."

**Research + compliance doc (NEW `docs/INVENTORY_COMPLIANCE_WA.md`):** 12-section reference
built from live scrapes of app.leg.wa.gov + the full WAC/RCW/DOH corpus + the CCRS 2026 upload
guide. Covers: seed-to-sale traceability (WAC 314-55-083, Category II exposure), 5-year on-
premises recordkeeping + audit-trail requirements for POS systems (WAC 314-55-087), **the
deemed-sales rule (WAC 314-55-089(4)(c): undocumented inventory reductions are deemed SALES and
assessed excise tax)** — the compliance backbone of cycle counts, CCRS InventoryAdjustment.csv
mechanics (valid reasons Destruction|Reconciliation|Lost|Seizure|Theft|Other; AdjustmentDetail
REQUIRED for Other/Theft; no negative quantities; weekly cadence), retailer operating rules
(WAC 314-55-079: **max FOUR months of average inventory on premises**, no below-cost sales,
returns only in original packaging), waste/destruction (WAC 314-55-097 + the 72h quarantine
already in disposition.ts), transport records (085), QA sale gate (102(2)(c)), DOH 246-70
(endorsed retailer must ALWAYS keep compliant medical product in stock or on order), plus the
professional layer: ABC classification, FEFO, aging buckets, shrink telemetry, months-of-
supply, blind-count variance review.

**Pure core (NEW `src/lib/inventory/inventory-intel-core.ts`, ~560 lines, embedded
self-tests):** `classifyAbc` (80/95 cumulative-value breakpoints, dominant lot forced A),
`fefoRank`, `summarizeAging` (0-30/31-60/61-90/90+), `monthsOfSupply` vs
`MAX_MONTHS_ON_HAND=4` (WAC ceiling), `summarizeShrink` (negative deltas valued at cost,
grouped shrink/destruction/samples/correction/other), count cadence A=30d/B=90d/C=180d with
`summarizeOverdueCounts` (anchor = last counted ?? received), `reviewVariances` (accuracy %,
over/short units, net/abs $ at cost, recount flags at ≥20% of system OR ≥$50 at cost),
`buildCommandCenter` composition + DOH medical-in-stock count.

**Server loaders (NEW `src/lib/inventory/inventory-intel.ts`):** `loadIntelLots` (joins most-
recent counted timestamp from cycle_count_lines), `loadIntelAdjustments(30d)`,
`getInventoryCommandCenter` (+FEFO sell-first list), `getCycleCountVarianceReview`.

**UI:**
- **Inventory index** — NEW `InventoryIntelPanel` (server component) after MissingInsight:
  months-of-supply vs the 4-month WAC ceiling, ABC mix + overdue-count cadence card,
  documented-reductions-30d shrink telemetry (with the 089(4)(c) hint), aging table (90+
  highlighted, DOH medical-in-stock warning when zero), FEFO sell-first list (expired bolded).
- **Cycle counts index** — 4th KPI "Lots overdue for count" + orange callout with a one-click
  "Count overdue lots only" button → NEW server action `createOverdueCycleCountAction`
  (classifies ABC, finds cadence-overdue lots, opens a scoped blind session).
- **Count detail** — NEW "Variance review — check before you apply" section while the session
  is open and lines are counted: accuracy %, over/short units, net $ impact at cost, flagged
  lines (top 8 by |$|) needing recount — so bad counts get caught BEFORE variances post.

**Tests:** new `tests/compliance/inventory-intel-core.test.ts` (+8). Suite: **1120 passing**
(was 1112). tsc + eslint clean. No migration needed (read-only over existing tables).

## Task M — Non-cannabis inventory masterclass (dual-identifier merch management)

**Shipped:** 2026-07-12 (branch `task-m-noncannabis-masterclass`).

**Owner's request (verbatim):** "Will you now give the other inventory page, the non cannabis
inventory. We sell cannabis paraphernalia, glass products, lighters grinders papers etc. almost
none of it has barcodes. So I need a master class strategy for managing inventory like this.
Some things like lighters and papers will have barcodes. But pipes and bongs and such won't. I
want the professional expert standard way of managing this type of inventory. We have built
into the admin equipment page the printer I plan on using for barcoding my non cannabis
inventory. ... The inventory adjustments should live on that page, it doesn't have the same
requirements as cannabis. So there are no special hoops to jump through."

**Playbook doc (NEW `docs/NONCANNABIS_INVENTORY_PLAYBOOK.md`):** the professional standard for
mixed barcoded/non-barcoded merch — the **dual-identifier strategy**: items WITH a manufacturer
UPC/EAN scan the package (GS1 mod-10 check digit validated on entry, unique per product); items
WITHOUT one (most glass) get the in-house Code128 smart-SKU label printed on the equipment-page
label printer (Rollo, PRN-LABEL-01). Every sellable item ends up scannable. Plus reorder
points, shrink telemetry, ABC by retail value, and the daily workflow.

**Migration 0111 (`noncannabis_inventory_ops.sql`, owner applies manually):**
`noncannabis_products` + `barcode` (unique partial index), `reorder_point`, `reorder_qty`,
`location`; NEW append-only `noncannabis_adjustments` (product_id, signed qty_delta, reason,
note, actor_id). Store layer degrades gracefully pre-migration (intake retries without 0111
columns).

**Pure core (NEW `src/lib/noncannabis/merch-intel-core.ts`, self-tested):**
`validateRetailBarcode` (UPC-A/EAN-13/EAN-8 GS1 check digit — canonical test vectors),
`scanIdentity` (barcode wins, SKU label fallback), `reorderStatusOf` (out/below/near≤125%/ok/
untracked) + `buildReorderList` (urgency-ordered, suggested qty = explicit or 2×min default),
`valuateMerch` (retail/cost/margin + needs-label count), `classifyMerchAbc` (80/95 by retail
value), `MERCH_ADJUSTMENT_REASONS` (received/return/count/damaged/theft/promo/sold_correction/
other) + `validateMerchAdjustment` (note REQUIRED for theft/other, non-zero integer, never
below zero), `summarizeMerchShrink` (negative deltas at cost, by reason).

**Store (`src/lib/noncannabis/store.ts`):** `createNonCannabisAdjustment` (fresh server-side
re-read → ledger insert → qty update), `listNonCannabisAdjustments(30d)`,
`updateNonCannabisOps` (barcode/reorder/location), intake carries the new fields.

**Page rebuilt (`/admin/inventory/noncannabis`):** 6-KPI band (active, units, retail value,
margin on hand, reorder now, need SKU labels) → "Reorder now" panel (out → below → near, with
suggested order qty) → "Documented reductions 30d" shrink panel (by reason, at cost) → NEW
`MerchCatalog` client workbench: instant search (name/SKU/barcode/shelf — scanning a code jumps
to the item) + type filter, scan-identity column (UPC/EAN badge vs SKU-label badge with print
link), ABC badge, on-hand with reorder flag, expandable row panel where **adjustments live**
(reason picker auto-sets direction, note enforcement, post) + item settings (barcode with live
check-digit validation, reorder point/qty, shelf) + label print/archive → append-only recent-
adjustments ledger → intake (now with barcode scan field validated live + reorder/shelf) →
drafts. Server actions `adjustNonCannabisAction` + `updateNonCannabisOpsAction` both audit.

**Tests:** new `tests/compliance/merch-intel-core.test.ts` (+8: self-tests, constants, GS1
check digits, dual identifier, reorder ordering, ABC, adjustment validation, shrink). Suite:
**1128 passing** (was 1120). tsc + eslint clean. **Owner action: apply migration 0111.**

## Task N — Non-cannabis paper-invoice intake (vendor visit → payable source document)

## Owner's request (verbatim)

> I forgot to mention that we won't be accepting non cannabis products through the email
> intake process. It will be a manual process. The glass vendor will come in with a stock of
> inventory, we pick out what we want, then they write us up a paper invoice. So id like a way
> to intake non cannabis products through the other inventory page. It should be a simple
> invoice builder type of form, where we manually input the details and submit the form. That
> way we can use it as a source document for the ach payments page for vendors. Please add
> this to the other inventory page. Follow the standing rules, never guess, no short cuts no
> cutting corners.

## What shipped

**The design decision (verified, not guessed):** in this back office a payable "invoice" was
ALWAYS an accepted inbound manifest — `vendor_manifest_payments.manifest_id` was `NOT NULL`
FK to `inbound_manifests`, so a merch paper invoice could not reuse the ledger as-is. Rather
than fork a second payments system, migration 0112 turns `vendor_manifest_payments` into the
**unified AP ledger**: `manifest_id` drops NOT NULL, a new `noncannabis_invoice_id` FK is
added, and a CHECK enforces **exactly one source document per payment row** (all existing rows
have manifest_id set, so the constraint holds). The Sage 50 vendor-payment export and ACH batch
refs see merch payments with zero changes (`manifest_number` carries the invoice number).

**Migration (`supabase/migrations/0112_noncannabis_vendor_invoices.sql`):**
`noncannabis_invoices` (invoice_number, vendor_id SET NULL + vendor_name snapshot,
invoice_date, total_minor_units CENTS, status open/paid, note; unique per
lower(vendor_name)+lower(invoice_number) to catch double entry) +
`noncannabis_invoice_lines` (product_id SET NULL, description snapshot, qty>0,
unit_cost_minor_units≥0; CASCADE on invoice delete) + the unified-ledger change above.
RLS staff-read/admin-write, guarded updated_at trigger. **Owner action: apply 0112.**

**Pure core (NEW `src/lib/noncannabis/invoice-core.ts`, self-tested):**
`validateNonCannabisInvoice` (vendor/number/real-date required, ≥1 line, integer qty>0,
integer cents≥0, existing lines need a product, optional STATED paper total must equal the
computed line total — the typo catcher), `invoiceTotalMinorUnits` (integer cents),
`checkNonCannabisInvoicePayment` (IDENTICAL policy to `checkManifestPayment`: overpay
BLOCKED, partial WARNING, fully-paid BLOCKED, exact OK), `encodePayableKey`/`decodePayableKey`
("manifest:<id>" / "ncinv:<id>"; bare ids decode as manifests for back-compat).

**Store (NEW `src/lib/noncannabis/invoice-store.ts`):** `createNonCannabisInvoice` — header +
lines, then per line: "new" stages a catalog DRAFT (smart SKU, cost/qty/retail from the line),
"existing" posts a +received adjustment through the Task-M ledger; any mid-way failure deletes
the header (cascade) so a broken half-invoice never becomes a payable. Vendor link only on an
EXACT case-insensitive display-name match (never fuzzy-guess on a payment document).
`listNonCannabisInvoicePayables` (paid from the unified ledger; [] pre-0112 → graceful),
`recordNonCannabisInvoicePayment` (unified-ledger insert + stamps the invoice 'paid' when
settled).

**Non-cannabis page:** NEW `InvoiceBuilderForm` client island — header (vendor, invoice #,
date, optional paper total with live mismatch flag) + multi-row lines (New item: description/
type/qty/unit cost/retail; Restock existing: product picker), running total, problems returned
in-place (typed rows preserved). Plus a "Recent vendor invoices" table (total/paid/owe badge)
linking to Accounts Payable. Action `submitNonCannabisInvoiceAction` audits
(`noncannabis_invoice.create`) and revalidates both pages.

**Accounts Payable page:** `loadPayableOptionsAction` now returns manifests PLUS open merch
invoices behind one opaque `key`; both `VendorAchForm` and `ManualPaymentForm` pickers show
"Manifest #… / Merch #…" tags. `buildVendorAchAction` and `recordManualPaymentAction` resolve
the key via `resolvePayable` and run the source-appropriate guardrail (`checkPayablePayment`) —
the manifest path (incl. PO-paid stamping and status checks) is byte-for-byte the same policy
as before; merch invoices skip PO stamping (no PO link exists).

**Tests:** new `tests/compliance/noncannabis-invoice-core.test.ts` (+8: self-tests, cents
math, date validation, draft validation, typo-catcher, payment guardrails, key round-trip).
Suite: **1136 passing** (was 1128). tsc + eslint clean. **Owner action: apply migration 0112
(after 0110 + 0111).**

---

## Task O — Medical cannabis selling pipeline (PR #399, merged)

**Research first:** `docs/MEDICAL_CANNABIS_COMPLIANCE.md` — an AI-optimized, verbatim-sourced
reference covering RCW 82.08.9998 (sales-tax exemption), WAC 314-55-090 (excise exemption +
5-yr records + 2029-06-30 sunset), chapter 246-70 WAC (DOH product categories), the DOH MCR
card workflow, CCRS medical flags, and the full sell-to-patient procedure. This is now the
authoritative doc; the older `docs/medical-doh-requirements.md` carried a WRONG sales-tax rule
("ANY cannabis" exempt for cardholders) which has been corrected with a pointer.

**Statute-correct tax fix (`src/lib/medical/tax.ts`):** RCW 82.08.9998 conditions the 9.3%
sales-tax exemption on the product being **chapter 246-70 WAC compliant**. Carded patient +
non-compliant product = BOTH taxes due in full. High-CBD compliant product = sales-tax exempt
for ANYONE at an endorsed store ((1)(c), new `highCbd` flag). Excise rule unchanged
(endorsed + carded-in-MCR + compliant + exemption active).

**Migration 0113 (owner applies manually):** `medical_product_registry` (unique
`pos_product_key` = stable menu source_item_id, `doh_category` CHECK in
general_use/high_thc/high_cbd, verified_by/at, staff RLS) + `orders.medical_authorization_id`
FK. Every store read degrades gracefully pre-migration (`isMissingSchemaError`).

**Pure core `src/lib/medical/medical-sale-core.ts`** (self-tested, registered in
pure-selftests): `decideLineExemption` implements the corrected statute;
`buildOrderExemptionPlan` maps stored order lines + registry + card validity to per-line
sales/excise exemptions, claimed totals, and high-THC violations; `buildExemptSaleDrafts`
refuses incomplete WAC 090(2) rows; `suggestDohCategory` is a conservative drafts-only
heuristic (staff must confirm from the package). CLAIM POLICY: exemptions are only claimed on
orders with a valid attached card — uncarded High-CBD is deliberately not claimed
(over-remit rather than under-document).

**Completion gate hardening (`src/app/admin/orders/actions.ts`):** after the money gate —
(1) an attached card is RE-validated at completion date (fix-or-detach message if invalid);
(2) **high-THC products sell ONLY to valid cardholders — hard block, NO override** (WAC
246-70); (3) sales-limit gate switches to MEDICAL limits when carded-valid; (4) WAC
314-55-090(2) exempt-sale rows are written idempotently (delete-then-insert, each row
verified) or completion is BLOCKED. Ledger hygiene: rows are cleared when a completion is
refused after the gate and when an order leaves completed status (the excise return sums the
ledger by sale date, so stale rows would overstate Box 2) — audited as
`medical.exempt_sales_cleared`.

**UI:** `MedicalSaleSection` on the order detail sidebar — carded/invalid/recreational badge,
customer search + one-click card attach (validity-checked), card facts + expiring-soon
warning, per-line exemption plan preview with claimed totals, high-THC hard-stop warning,
detach. `DohProductRegistry` on /admin/medical — search the live menu, category suggestion
hint, required category select, register/re-verify/remove with audits
(`medical.doh_product.verified` / `.removed`). New actions: `attachMedicalCardAction` /
`detachMedicalCardAction` (orders.manage) and `upsertDohProductAction` /
`removeDohProductAction` (medical.manage).

**Tests:** +3 pure self-test registrations (`__runMedTaxTests`,
`__runMedicalAuthorizationTests`, `__runMedicalSaleTests`). Suite: **1139 passing** (was
1136). tsc + eslint clean. **Owner action: apply migration 0113 (after 0110–0112).**

---

## Shipped — Task P: medical guided intake polish (PR #400)

**Problem set (owner-reported):** blank page when printing a recognition card; a
redundant "Authorization Intake" page duplicating the Patient Records flow; no
step-by-step guidance for the DOH registration process; open questions about
where the UPID comes from, DOH login, and expiration dates.

**Print fix:** `/admin/medical/card/[id]` rendered its own `<html>/<body>`
INSIDE the root layout's document — nested documents crash the React render
(the blank page). Rewritten as a normal admin page with scoped `@media print`
CSS (`@page 3.5in × 2.25in` credit-card layout) + client `CardPrintButton`
(`window.print()`), same pattern as the order ticket. Toolbar adds "Mark
printed & laminated."

**Consolidation:** `/admin/medical/intake`, `AuthorizationIntakeForm`, and
`CustomerPicker` DELETED; the duplicate `issueCardAction` +
`intakeAuthorizationAction` paths replaced by ONE hardened `guidedIntakeAction`.
The Medical nav group is now a direct-link button to `/admin/medical`
(DIRECT_LINK_GROUPS, like Reports/CCRS). MedicalPanel on the customer page
links into the wizard preselected.

**Research (scraped verbatim — RCW 69.51A.230/.220, DOH MCR + FAQs):** the card
number/UPID is "a randomly generated and unique identifying number" GENERATED
BY THE MCR — staff copy it, never invent it. MCR login is via SecureAccess
Washington (SAW), Chrome recommended, store selected by LCB license 413541; no
public API. Card expiration = authorization form expiration, statutory max
1 year (adult) / 6 months (minor) from the date the practitioner ISSUED the
authorization. $1 minimum fee at registration (230(10)). Photo: portrait JPEG
≥400×600 uploaded into the MCR; compassionate renewals photo-exempt (230(4)(b)).
Only DOH-Certified Consultants register patients; any budtender may verify by
card number and sell to existing cardholders. 30-day post-expiry grace keeps
the same card number on renewal.

**New pure core `src/lib/medical/medical-intake-core.ts`** (self-tested):
`addMonthsClamped` (leap-safe), `ageOn`, `classifyPatientAge` (minor /
adult_18_20 / adult_21_plus), `maxExpirationFor`, `checkIntakeDates` (blocks
expiration > statutory max, expiration ≤ effective, expired-at-issue,
future-dated auth, effective-before-auth), `checkCardNumber` (shape check only —
MCR format unpublished).

**GuidedIntakeWizard** (server component on `/admin/medical`): Step 1 patient
search with age-class badges + existing-valid-card renewal/replacement warning;
Step 2 DOH 608-048 four-point checklist + Canon PIXMA TS3522 scan upload;
Step 3 numbered MCR walkthrough with required confirmations (certified
consultant, photo uploaded [waived on compassionate renewal], $1 fee collected,
minor parent/guardian DP per RCW 69.51A.220); Step 4 MCR-generated card number +
dates with auto-hinted statutory maximum. Success banner links straight to the
print page. Recent-cards queue with MCR / scan / printed badges.

**Migration 0114 (owner applies manually AFTER 0113):** adds
`authorization_issued_on`, `card_fee_collected`, `photo_uploaded_to_mcr`,
`compassionate_renewal` to `patient_authorizations`. `createAuthorization`
degrades gracefully pre-migration (42703 → retry without new columns).

**Tests:** +1 pure self-test registration (`__runMedicalIntakeTests`). Suite:
**1140 passing** (was 1139). tsc + eslint clean. **Owner action: apply
migration 0114 (after 0113).**

---

## Shipped — Task Q: Returns & Destruction command center (PR #401)

**Research (all verified, never guessed):** CCRS Upload User Guide (June 2025
PDF — Operation Insert/Update/Delete semantics, identifiers required on
corrections, no negatives, AdjustmentDetail required for Other/Theft,
"Returned to seller → Other"), LCB CCRS FAQ (customer return = delete the
sale identifier + report an Inventory Adjustment as a return), current
WAC 314-55-079(12) (returns require ORIGINAL packaging + fully legible
lot/batch/inventory ID), -085 (CCRS-generated manifests only, 48–72h lead,
Mon/Wed/Fri confirmations), -097 as amended (render unusable BEFORE leaving
premises, grind + mix ≥50% non-cannabis; **the old 72-hour notices were
REMOVED by WSR 22-14-111** — the hold is now store policy), -225 (recall
destruction PROHIBITED before LCB coordination), -087 (3-year records).
Full AI-reference report: **`docs/RETURNS_DESTRUCTION_COMPLIANCE.md`**.

**Customer returns (new, end-to-end):** guided wizard — search COMPLETED
sales, pick the exact line (double-return protected), attest the
WAC 314-55-079(12) conditions, restock or destroy. Server posts a positive
`return` adjustment (CCRS `Other`), snapshots the original CCRS Sale row
(identifiers, sale type/date, unit price/discount/sales tax/excise in minor
units), queues the **Sale Delete** (full line) or **Update** (partial —
remaining qty, pro-rata money) correction, and can open a destruction event
WITHOUT quarantining the whole lot. New export route builds the 18-column
Sale correction CSV (original identifiers, UpdatedBy/UpdatedDate clamped ≥
CreatedDate, Pacific-day-safe dates, no negatives) and marks rows exported.

**Vendor returns:** manifest workflow none → requested → submitted →
confirmed → picked_up (forward-only state machine), manifest # / processor
license / pickup fields, on-page WAC 314-55-085 checklist.

**Destruction:** completion form enforcing current -097 — rendering-method
select (grind+mix compostable / non-compostable / LCB-approved other), mix
material + ≥50% attestation, final destination / disposal facility, witness —
plus the -225 recall guard (LCB coordination + officer required, enforced in
the pure validator). Hold is a configurable store policy (0–336h, default
72h) with the legal history explained in-app.

**New pure cores (self-tested):** `disposition-core.ts` (return validation →
Delete/Update, rendering rules, recall guard, manifest machine, hold policy)
and `ccrs-sale-correction-core.ts` (Sale correction rows + file assembly).
`mapAdjustmentReason("return") → "Other"`. Drafts-only AI advisor
(aggregate counts only). Graceful pre-0115 degradation throughout.

**Migration 0115 (owner applies manually):** `customer_returns`,
destruction waste-record + recall columns, vendor manifest columns,
`disposition_settings` singleton.

**Tests:** `tests/compliance/disposition-core.test.ts` (22 tests wiring both
self-test suites + targeted assertions). Suite: **1162 passing** (was 1140).
tsc + eslint clean. **Owner action: apply migration 0115.**

## Shipped — Task R: Discounts & Promotions command center (PR #402)

**What shipped:** the promotions program rebuilt as a professional command
center with the CCRS cost floor enforced everywhere, the owner's set-in-stone
daily deals wired store-advantaged, and a publish-time HARD BLOCK.

**Verified ground truth (no guessing):** CCRS Upload User Guide (June 2025),
Sale.csv `Discount` — a discount "must be available to all who meet the
discount conditions and **may not discount the sale price below the cost of
acquisition**"; RCW 69.50.357 (never free, $1,000/violation); WAC 314-55-018.
Full reference: **`docs/PROMOTIONS_COMPLIANCE.md`**. Cannabis card prices are
tax-inclusive, costs pre-tax ⇒ floor = `ceil(cost × 1.463)` (merch × 1.093),
`Math.ceil` = store-advantaged; floor is capped at regular price so a cost
anomaly can never RAISE a price.

**Three enforcement layers:** (1) every engine clamps every mechanic at
`max(statutory never-free floor, cost floor)` — checkout attaches
weighted-average lot costs (same method as the COGS report) in the server
reprice; (2) publish-time HARD BLOCK — `promo-guard-core.ts` (pure,
self-tested) worst-cases each mechanic per product; `setPromotionStatusAction`
refuses to publish and audits `promotion.publish_blocked`; (3) standing
below-cost audit panel re-checks every published promo against the CURRENT
menu + costs (drift after publish surfaces immediately).

**Set-in-stone daily deals:** Tuesday = 20% off prerolls/blunts OR 4-for-3
mix & match — the register picks WHICHEVER SAVES THE CUSTOMER LESS
(store-advantaged, deterministic and uniform per CCRS "available to all");
4-for-3 spreads the cheapest-unit-per-group savings across ALL eligible lines
as an equivalent floor percent. Sunday 3-for-2 storewide uses the same spread
math (cheapest unit sets the target). Copy updated across seeds, menu,
specials pages. **No stacking, ever:** `stackable` removed from the engine —
strictly best-deal-wins.

**Command center (`/admin/promotions`):** stats (incl. below-cost hits +
costed-product coverage), weekly strip, CCRS cost-floor audit panel, conflicts
panel, drafts-only AI advisor (aggregates only), URL-driven filters
(status/type/weekday/search) + 5 sort keys. Builder: full mechanics editor
(qty/weight/spend tiers, BOGO ≤99%, basket N-for-M / top-item, either/or)
persisted to `promotions.config` (existing 0006 column — **no new
migration**); detail page shows a live pre-publish cost-floor check.
Simulator: real costs attached, 🛡 cost-floor badges on clamped lines. AI
mechanics drafter gains either/or + never-free/no-stacking guardrails.
`auto-discount.ts` register helper also clamps at cost (pre-tax ⇒ floor =
cost directly).

**Tests:** parity tests rewritten for the new Tuesday either/or (incl. a
cost-floor clamp case), `__runPromoGuardTests` + expanded
`__runDiscountEngineTests` wired into `tests/compliance/pure-selftests.test.ts`
and the local runner script. Suite: **1164 passing** (was 1162). tsc + eslint
clean. No owner actions (costs flow from existing `inventory_lots`).

## Shipped — Task S: Loyalty POS-side, Employee command center, Users guard rails, Marketing makeover (PRs #404, #405, #406, #407)

Owner's request (summary of the four sub-areas): (a) harden loyalty on the POS
sale side; (b) transform the Employees tab into a command center covering
everything a major corporation does — onboarding (background checks, W-4, I-9,
handbook read-and-sign), document tracking, time cards, a visual schedule
builder, termination, grounded in re-verified CCRS/RCW/DOH rules; (c) harden
the Users page against malicious behavior with guard rails that still make it
easy to let someone go; (d) give Marketing a professional makeover with a
playbook to beat nearby competitors.

### S-a — Loyalty at the register (PR #404, merged; migration 0116)
POS sale-side earn/redeem with **no stacking**: a sale takes the promotion OR
the loyalty redemption, whichever saves the customer more (best-deal-wins,
computed in pure `loyalty-sale-core.ts`); redemptions respect the acquisition-
cost floor like every other discount. Ledger entries recorded server-side at
sale completion; loyalty metrics + drafts-only AI customer-behavior advisor
(aggregates only) on the back-office loyalty page. **Owner action: apply
`0116_loyalty_at_sale.sql`.**

### S-b — Employee command center (PR #405, merged; migration 0117)
Ground truth documented in **`docs/EMPLOYEE_COMPLIANCE.md`** (verified by
scraping the current sources): RCW 69.50.357 (21+ employees, rules + under-21
ID training), WAC 314-55-083 (photo ID badges), WAC 314-55-087 (**5-year**
employee records — employees are never deleted), RCW 49.94.010 Fair Chance
(background check only AFTER a conditional offer), I-9 §1 day 1 / §2 within 3
business days, W-4 before first payroll, DSHS new-hire report within 20 days,
WA paid sick leave RCW 49.46.210 (1 hr per 40 worked, usable day 90, 40-hr
carryover), final pay RCW 49.48.010, DOH WAC 246-72 medical consultant cert.

What shipped: employment lifecycle (candidate → onboarding → active →
terminated, rehire supported) with a **15-task, 4-phase onboarding checklist**
whose ordering enforces Fair Chance in code (`background_check` requires
`conditional_offer`) and whose **activation gate** blocks going active until
the critical items are done (age-21 ID check, I-9 both sections, W-4, handbook
signed, both trainings, badge issued). Employee file page answers "do we have
their W-4 and I-9 on file? did they sign the handbook?" via a document tracker
(missing / on file / signed, expiry tracking for the DOH consultant cert), plus
a training log (5-yr records), deadline cards computed from the hire date
(business-day I-9 §2 math), WA sick-leave accrual from real time punches, and a
guided termination that clears the clock PIN, keeps the file 5 years, and opens
an offboarding checklist. Printable **employee handbook v1.0** with citations
and signature block at `/admin/staffing/handbook`. Schedule builder gained a
week-at-a-glance coverage bar chart. Time-clock surfaces moved from the
`loyalty.view` proxy to an honest **`timeclock.use`** permission (same roles —
no behavior change, pinned by a permission test). Drafts-only HR advisor sees
only roster aggregates — never SSNs/DOBs/banking. **Owner action: apply
`0117_employee_command_center.sql` (after 0116).**

### S-c — Users guard rails (PR #406, merged; no migration)
Pure `user-guards-core.ts` (self-tested) enforced server-side: (1) no self
role-change / self-deactivation; (2) you can't touch anyone ranked above you;
(3) **privilege ceiling** — you can't grant a role above your own (closes the
admin→owner escalation hole; applies to invites); (4) the last active owner
can never be demoted or deactivated. Silent failures eliminated — every
outcome lands as a visible banner, and **blocked attempts are audited**
(`user.*.blocked`) and shown in a new on-page access-change log. Deactivation
now also bans sign-in at the Supabase auth layer (`ban_duration` verified
against @supabase/auth-js; reactivate lifts it) on top of the per-request
profile check and `is_staff()` RLS. "Letting someone go? Do both halves" box
ties deactivation to the S-b offboarding checklist. Also fixed a latent CI bug:
`run-pure-selftests.ts` imported two runners it never invoked.

### S-d — Marketing command center (PR #407, merged; no migration)
`campaign-rules-core.ts` (pure, self-tested) encodes the **current** WAC
314-55-155 (WSR 26-12-082, eff. 7/4/26, scraped from app.leg.wa.gov) + RCW
69.50.369 per channel: universal content bans, 21+ statement, four mandated
warnings at 10% type size (with the outdoor exemption), the four-sign/1,600-
sq-in on-premises regime + 512-sq-in informational exemption, billboard/trade-
name limits, the <$1 incidental-item giveaway regime, and the coupon
acquisition-cost floor — rendered as an 8-channel campaign planner with
pre-flight checklists, never-do lists, and copy-ready warning text.
`competitive-playbook-core.ts` (pure, self-tested) is the "win your market"
playbook: 9 legal plays across intel (CCRS benchmarks, weekly menu recon),
price perception (known-value-item pricing with the cost floor pinned, vendor
exclusives), retention (loyalty + newsletter moats), experience (training,
accurate menu, rush staffing), and local search (Google Business Profile,
educational content) — every play links to the in-app tool that executes it.
The drafts-only AI strategist now embeds the verified channel checklist in its
prompt and remains compliance-scanned before display.

**Tests across Task S:** suite grew 1164 → **1176 passing** (loyalty-sale,
schedule-core, employee-lifecycle, timeclock permission, user-guards,
campaign-rules, competitive-playbook — all wired into both the vitest harness
and the CI selftest script). tsc + eslint clean on every PR. Owner actions:
apply migrations **0116** and **0117**.

---

## Shipped — Task T: Back office as the single source of truth for the website + POS (PRs #409, #410, #411, #412, #413)

Owner's request: make the back office and its full feature suite the source of
truth for the customer-facing website and the front POS side — close every
split-brain between what staff publish and what customers see/pay; add the
cart estimator (honest best-case range for medical); align hours to the real
8am–11pm (footer graphic "1145"→"11" only, everything else untouched).

### T-1 — Promotions Harmony (PR #409, merged; no migration)
Closed gap G-1: the register priced carts with the DB rules engine while the
website priced with a static weekday engine. New pure
`published-rules-core.ts` serialises published promotions into JSON-safe
`PublishedRuleSnapshot[]` once per render; the storefront cart and product
cards now price with the SAME pure engine the register uses
(`computePromotions`), resolving active rules by the store's Pacific weekday
so a cart left open past midnight re-prices like the register would.
Zero-blank guarantee: committed daily-deal seeds remain the fallback when the
DB is empty (behaviour pinned by a parity test suite).

### T-2 — Cart estimator (PR #410, merged; no migration)
Register-final estimates on the cart and checkout: pure `estimator-core.ts`
+ `/api/estimator` compute the tax-inclusive total the register will charge,
the loyalty redemption value, tier-discount nudges, and the **honest
best-case medical range** (sales-tax relief per RCW 82.08.9998 on compliant
products; excise relief only when carded + compliant + endorsed per WAC
314-55-090) — never promising a discount the register can't deliver.

### T-3 — Public loyalty terms + medical program page (PR #411, merged; no migration)
`/loyalty` now publishes the LIVE program terms (earn/value/redeem/bonus/
expiry sentences + tier ladder) derived from `loyalty_config`/`loyalty_tiers`
via pure `program-terms-core.ts` — admin edits appear on the public page on
next render. New `/medical` page (CMS-editable hero/intro) explains the DOH
recognition-card program with honest fine print, the high-CBD-for-anyone
lane ("very low THC with a high CBD ratio", chapter 246-70 WAC), the
statutory purchase-limit table derived from the SAME register constants
(WAC 314-55-095, 3× recreational), and no therapeutic claims (WAC
314-55-155). Menu cards and product pages show a "Med" chip on
DOH-compliant variants, linking to /medical.

### T-4 — Order↔customer linking + live confirmation + hours polish (PR #412, merged; no migration)
Staff-confirmed customer matching on the order detail page: pure
`customer-link-core.ts` (exact normalized phone/email matches ONLY; a
near-miss digit never matches) ranks candidates; staff link/unlink with
audit events, so online member orders accrue loyalty points through the
existing completion hook. The order confirmation page now always polls live
status (30s refresh). Hours aligned to the real 8am–11pm everywhere: footer
PNG edited pixel-surgically ("1145"→"11", the OPEN artwork verified
byte-identical), CMS hours block, alt text.

### T-5 — Website Sync Command Center (PR #413, merged; no migration)
The harmony dashboard: `/admin/website-sync` shows exactly what the
storefront is serving RIGHT NOW — published menu version stats, the Mon–Sun
deal grid with today resolved by the store's Pacific weekday and each day's
source (back office vs seed), the live loyalty terms + tier ladder, the
medical endorsement status with honest language, and the footer hours copy
next to the sales-hours completion-gate window (statutory vs
owner-tightened, WAC 314-55-147). Every block reads through the SAME loaders
the public site uses and links (permission-gated) to the owning admin page.
Pinned to the top of the Website nav group.

**Tests across Task T:** suite grew 1,176 → **1,272 passing** (promotions
parity, estimator, public-surfaces, customer-link, website-sync cores). tsc +
eslint clean on every PR. No migrations in Task T.

---

## Shipped — Task U: Website command center — Site Content redesign + Creative Studio (PRs #415, #416, #417)

Owner's request: turn the Website nav-group pages into a command-center
masterpiece — rebuild the "ugly and cluttered" Site Content page "like how the
big players do it"; harness the full FLUX suite so Greenway AI uses the
store's promotions to generate perfectly-sized images for the website, blog,
newsletters, and physical print/in-store displays — "completely fool proof and
simple… tons of helper text and ai assistance"; give Midjourney "some love"
but "focus all your firepower on flux."

### U-1 — Site Content progressive-disclosure redesign (PR #415, merged; no migration)
`/admin/content` rebuilt on the Shopify/Squarespace progressive-disclosure
pattern: each block collapses to a one-line summary row (single status pill —
● unsaved / draft pending / ✓ live — plus a content snippet) and expands on
demand; the preview panel's "edit this" click dispatches a `gw-expand`
CustomEvent that opens and focuses the exact block. Raw hex colors replaced
with admin design tokens across the editor shell, preview panel, and bulk
bar; header simplified to a short subtitle, ONE merged HelpPanel
(workflow + SEO + WA compliance), and a StatCard row (editable blocks /
pending drafts / SEO-flagged → /admin/content/seo).

### U-2 — Creative Studio: placement-sized FLUX + promotions-grounded AI (PR #416, merged; no migration)
The Image Generator became the **Creative Studio** (nav, header, concierge
KB, Help & FAQ all updated), a fool-proof 3-step flow:
1. **Pick the destination** — new pure `creative-placements-core.ts`: 20
   verified placements across website / social / email / blog / print, each
   with exact pixel size, format, where-used text, tip, FLUX composition
   hint, and print DPI notes. Website slots derive LIVE from
   `image-spec-core` so they can never drift; email at 2× retina; print sized
   under FLUX's verified ~4MP ceiling with upscale notes.
2. **Describe the idea** — new `creative-ai.ts`: Greenway AI drafts the full
   brief from one line, grounded in the store profile AND the LIVE published
   weekly deals ("a banner for our Monday deal" uses the real Monday deal);
   brand-palette steering, no-text rule, compliance-scanned with flag chips
   in the UI. Drafts-only.
3. **Generate with FLUX** — `flux-core.ts` rewritten against verified
   docs.bfl.ai contracts per endpoint family (flux-2-max/pro `disable_pup` +
   safety 0–5 + webp + exact width/height; flux-2-flex `prompt_upsampling`;
   kontext legacy `aspect_ratio` + 4-ref cap), captures per-run cost, shows
   "will generate at W×H — sized for {destination}", saves drafts to the
   media library. ~90 self-test assertions.

### U-3 — Midjourney love (PR #417, merged; no migration)
The copy-paste fallback got smarter: `closestAspectRatio(w,h)` snaps the
Midjourney `--ar` to the Step-1 destination (log-space nearest supported
ratio, 10 new assertions); the previously-unexposed **weird slider** and
**omni-reference (`--oref`) picker** surfaced with plain-language guidance;
parameters card retitled with an honest "FLUX ignores these" note.

**Tests across Task U:** suite grew 1,272 → **1,275 passing**
(midjourney-core, flux-core, creative-placements-core self-tests wired into
both the vitest harness and the CI selftest script). tsc + eslint clean on
every PR. No migrations in Task U.

## Shipped — Task V: Pre-deployment tidy-up — loyalty→customers auto-connect, Getting Started removal, count integrity (PRs #419, #420, #421)

### V-1 — Loyalty signups → Customers auto-connection (PR #419, merged; no migration)
Closed the verified gap that `customers.loyalty_signup_id` (migration 0022)
was never written by any code path — validating a signup draft did NOT create
the customer. Now "Mark entered" runs a connect step automatically:
- New pure `signup-customer-core.ts` (~40 assertions): normalizers,
  `marketingConsentFromSignup()` (consent minus opt-out), field mapping
  (`import_source: "loyalty-signup"`, normalized email/phone, the
  `loyalty_signup_id` back-link), match-basis ranking (phone+email > phone >
  email), existing-customer tie-break (linked-to-this-signup → unlinked →
  linked-to-other), and a FILL-ONLY link patch that never overwrites data and
  never flips `do_not_contact`.
- New `signup-customer-store.ts`: `connectSignupToCustomer()` —
  already-linked check, dedupe match against phone_normalized /
  email_normalized / email, create-or-link, then best-effort
  `enrollCustomer()` (idempotent loyalty account + signup bonus).
- Queue UX: success banner deep-linking the customer record, error banner
  with retry guidance, a green "↗ Customer" chip on connected rows, and an
  explicit "Add to customers" backfill button for signups entered BEFORE this
  shipped. Audited as `loyalty.customer_created` / `.customer_linked` /
  `.customer_connect_failed`.
- Dashboard "Loyalty signups" tile switched from the legacy JSONL file count
  to the DB queue's `new` count.

### V-2 — Getting Started removed; SOP pack kept (PR #420, merged; no migration)
Owner: "Please remove the getting started page." Deleted the route, wizard
component, actions, and `ai-setup-assistant.ts` (SETUP_GUIDE retained — it
still grounds the concierge). The printable SOP pack the wizard hosted is
used by 9 admin pages via SopSheetLink, so it was RELOCATED to `/admin/sop`
(`SOP_BASE_PATH` + self-test + vitest expectations updated). Nav item
removed; dashboard buttons now read "Help & FAQ" and "Printable SOPs"; the
setup-progress banner deep-links each check's own page; help/concierge/docs
swept.

### V-3 — Count integrity + Pacific timestamps + orders polish (PR #421, merged; no migration)
- S-7 family: `getOrderStatusCounts()`, `getLoyaltyStatusCounts()`, and the
  promotions report counted rows via `select("status")`, silently truncating
  at PostgREST's `db.max_rows` cap (1000) — the dashboard/cockpit/new-order
  poll would under-report past 1000 lifetime rows. All three now use exact
  indexed head counts per status; the loyalty report's signup fetch now pages
  via `pagedAll`.
- `formatDateTime()` (pos/format) now anchors to America/Los_Angeles — on
  UTC servers every staff-facing timestamp rendered 7–8 hours off. Order
  detail + pick-ticket + loyalty-queue timestamps all fixed.
- Orders list gained Cancelled / No-show filter chips; the dashboard's
  open-orders tiles deep-link to their status filter.

**Audits completed with no further gaps found:** every Reports tab
(Overview/Sales/Benchmarks/Forecast/COGS/Tax/Customers/Loyalty/Employees/
Medical/Compliance/Excise/Accounting) verified to enforce `reports.view`,
guard on `isSupabaseServiceConfigured`, and read live stores (pagedAll /
chunkedIn where row volume matters); the order detail page's compliance
gates (sales-hours, money recompute, loyalty-code, high-THC, sales-limit,
exempt-sale ledger) verified intact end to end.

**Tests:** suite at **1,276 passing** (signup-customer-core self-tests added
in both harnesses). tsc + eslint clean on every PR. No migrations in Task V.

## Shipped — Task W: CCRS Compliance Reporting Command Center (PRs #423, #424, #425)

Owner: "upgraded it and enhanced it to be a compliance reporting command
center… extremely easy, super user friendly, tons of helpers and ai
assistance… hand held process… step by step with checks and guard rails…
completely hardened and bullet proof… push notifications if possible, email
reminders, bells and whistles even so there is no way we could ever miss the
upload deadlines."

Research first (standing rule): `docs/CCRS_COMMAND_CENTER_RESEARCH.md` — an
AI-readable report covering what CCRS is (manual CSV upload only, NO API;
SAW login, WA.gov cutover ~Oct 2026), the weekly cadence (Sun–Sat week due
the FOLLOWING SUNDAY per the LCB FAQ), the monthly LIQ-1295 (due the 20th,
even with no sales, 2% late penalty), all seven retailer file specs with
enums/limits/error messages, the dependency upload order (Group 1 → 10 min →
Group 2 → 10 min → Group 3), the error-by-email workflow + LCB contacts, the
DOH medical 4-leg exemption (endorsement + DOH database check every
transaction + IsMedical=TRUE inventory + RecreationalMedical $0-tax sale) —
there is NO separate DOH report upload for retailers — and a recon of every
existing CCRS asset.

### W PR A — weekly deadline engine + submission ledger (PR #423, merged; migration 0118 owner-applied)
- `ccrs-week-core.ts` (PURE, 40 self-tests): Sun–Sat weeks, `weekDeadline`,
  `weeklyDeadlineOverview` (oldest-overdue most urgent), and
  `planWeeklyReminders` (thursday_heads_up / saturday_wrap / sunday_due /
  overdue_daily with send-once dedupe keys; overdue keys embed the date so
  they repeat daily).
- FIXED VERIFIED BUG: the compliance calendar's `ccrs_weekly` due date was
  `weekEnd + 7` (following Saturday) — corrected to `weekEnd + 1` (the
  Sunday) per the LCB FAQ; it was under-alarming by six days.
- Migration `0118_ccrs_command_center.sql`: `ccrs_week_submissions` (ledger:
  resolution submitted|nothing_to_report, on_time computed at write,
  files_json manifest, error_status), `compliance_reminder_log` (unique
  dedupe_key), `push_subscriptions` (VAPID endpoints, RLS self-policy).
- `ccrs-week-store.ts`: fails SAFE (DB down ⇒ unresolved ⇒ MORE nagging);
  refuses to resolve in-progress weeks.

### W PR B — reminders that can't be missed (PR #424, merged; no migration)
- `notifications/push.ts`: Web Push (web-push 3.6.7, VAPID env-gated),
  auto-prunes dead endpoints. `public/push-sw.js` + staff-gated
  `/api/admin/push` (GET key / POST subscribe / DELETE) +
  `PushRemindersPanel` per-device toggle with honest degraded states.
- `notifications/compliance-reminders.ts`: daily orchestrator — weekly
  planner + NEW pure `planMonthlyReminders` in `ccrs-deadline-core.ts`
  (liq_due_soon / liq_due_today / liq_overdue_daily; 5 new self-tests; the
  Slice-106 self-tests were never harness-registered — now wired into both).
  Email (Resend REST staff-list pattern) + push in parallel; send-once via
  `compliance_reminder_log`; failed sends NOT logged (retry next run);
  no-channel-configured NOT logged (fires once a channel exists).
- `/api/cron/compliance-reminders` (GET/POST): `CRON_SECRET` Bearer with the
  fail-closed production posture; staff-session fallback for manual runs.
  `vercel.json` cron daily 16:00 UTC (~8–9am Pacific). Env documented in
  `.env.example` (CRON_SECRET, VAPID keys).

### W PR C — the Command Center page (PR #425, merged; no migration)
`/admin/compliance/ccrs` (top-nav CCRS button): deadline banner → week picker
→ activity KPIs + the SAME authoritative validation gate as the zip export →
drafts-only AI advisor → guided upload walkthrough (steps LOCK until
prerequisites clear; live 10-minute dependency countdowns; per-week
localStorage via SSR-safe useSyncExternalStore) → record-the-week forms with
hard guards (no submit while validation fails; no nothing-to-report with
records; no resolving in-progress weeks; audited; manifest evidence;
on-time/late stamped; undo) → error-email triage
(`ccrs-error-triage-core.ts`, PURE, 18 self-tests: 10 verified LCB error
signatures, duplicate-strain benign per FAQ, DRAFTS-ONLY examiner@lcb.wa.gov
escalation builder) → DOH/medical 4-leg panel with the week's exempt-sale
evidence → monthly LIQ-1295 strip → reminder status → submission ledger.

**Tests:** suite at **1,279 passing** (ccrs-week-core 40, ccrs-deadline-core
30 incl. monthly planner, ccrs-error-triage-core 18 — all in both
harnesses). tsc + eslint clean on every PR. Migration 0118 applied manually
by the owner (Task W PR A).

## Shipped — Task X: Leafly + Weedmaps menu syndication, rock solid (PRs #427, #428, #429)

Owner directive (condensed): "Focus on the integrations page. Make sure they
are rock solid and ready to start transmitting data to Leafly and Weedmaps,
Leafly being of higher priority. Hold my hand through this process — getting
connected, staying connected, help if we get unconnected, AI assistance
deep-trained on the Leafly v2 docs. If there are settings that allow us to
tune parameters, I want full control. What would a professional do and add.
Never guess, no shortcuts, no cutting corners."

### Research first (never guess)
`docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md` — AI-readable deep-dive:
Leafly Menu API v2.0 (OAuth2 client-credentials at sso.leafly.com /
sso-sandbox.leafly.io, POST = full sync deleting omitted items, PUT = upsert,
DELETE {ids}, GET /status, integer-cent prices, real `inventoryLevel`,
null-never-"NA" for absent strain/cannabinoids, NO image field in v2 items,
per-environment integration keys, ~2.5 min sandbox / ~5 min prod latency) and
the Weedmaps Menu API 2025-07 (live OpenAPI verified: 14-day JWT from
/auth/token at 1 req/min, scopes menu_items + menus:write, global 420
requests/10 s, NO bulk endpoint — per-item PUT
/menus/{menu_id}/items/external/{external_id} + per-item DELETE, price
{amount,currency} in dollars + weight per variant, inventory_quantity min 1
omitted when out of stock, 423 = menu paused, unpublish-not-delete for OOS).

### X PR A — verified wire formats + pure sync cores (PR #427, merged)
- `weedmaps/payload-core.ts` REBUILT against the live 2025-07
  Request_MenuItem schema (variants with external_id/price/weight,
  genetics, published flag, single exact image_url).
- Leafly payload sends the REAL stock quantity as `inventoryLevel`; the feed
  (`menu-feed-core`) carries `inventoryLevel` + exact-photo `imageUrl`.
- 4 new pure cores, all self-tested in both harnesses: `sync-plan-core`
  (FNV-1a payload hashes + delta plan), `preflight-core` (blocking
  validation: dup ids, missing names, non-positive prices),
  `richness-core` (menu richness scoring + connection-health classifier),
  `sync-settings-core` (owner-tunable parameters, clamped).

### X PR B — the sync engine + owner transmission parameters (PR #428, merged; migration 0119)
- **Migration 0119** (owner applies MANUALLY after 0118):
  `syndication_sync_settings` (per-channel settings jsonb) +
  `syndication_sync_state` (per-item payload hashes from the last
  successful sync).
- Preflight GATE: `PreflightBlockedError` stops live pushes when blocking
  errors exist — logged as "skipped", nothing transmitted.
- Delta sync on both channels: only changed items are sent; unchanged
  Leafly syncs are skipped honestly ("no changes"); failed items keep their
  old hash so they auto-retry next sync; one-shot force-resend clears
  itself after a clean forced sync.
- Weedmaps engine: paced per-item PUT loop (default 150 ms ≈ 66 req/10 s,
  far under the 420/10 s cap), explicit per-item DELETEs (404 = already
  gone), 423-paused stops the loop early, republish when the owner turns
  off hide-out-of-stock.
- Leafly engine: POST always sends the FULL menu (POST deletes omissions);
  PUT sends changed items then explicit DELETE {ids}; 401-retry-once +
  429/5xx exponential backoff on both channels with owner-tunable retries.
- 6 new audited server actions: get/save settings + reset sync state per
  channel; saves clamp through the pure core so bad input can't break a sync.

### X PR C — hold-my-hand UI + playbook-trained AI (PR #429, merged; no migration)
- `syndication-playbook.ts` (pure, 18 self-tests): 5 verified connect steps
  per channel, channel-tagged stay-connected practices, an 11-row recovery
  runbook (symptom → meaning → fix keyed to real HTTP statuses: 401/403,
  404 menu id, 422, 423 paused, 429, 5xx, preflight-blocked, skipped),
  verified support contacts, and `syndicationPlaybookBlock()` — the
  grounding injected into the integrations AI helper so it diagnoses from
  the runbook and never invents an endpoint or key name.
- Channel pages now mount: **ConnectionWizard** (get connected / stay
  connected / get reconnected, auto-opens until credentials are set),
  **ConnectionHealthPanel** (connected/degraded/down from LIVE attempts
  only — skipped syncs transmit nothing so they don't count),
  **DataQualityPanel** (preflight gate + per-field richness bars with
  weakest-first guidance; image row hidden on Leafly since v2 has no image
  field), and **SyncSettingsPanel** (full owner control: pacing 0–5000 ms,
  retries 0–5, Leafly POST/PUT default mode, field toggles for
  descriptions/THC-CBD/strains, Weedmaps exact-photo + hide-OOS toggles,
  one-shot resend-everything, armed-confirm reset-sync-memory).

**Tests:** suite at **1,289 passing** (sync-plan 21, preflight 17,
richness/health 17, sync-settings 19, apply-settings 19,
syndication-playbook 18 — all in both harnesses). tsc + eslint clean on
every PR. Migration 0119 applied manually by the owner (after 0118).

## Shipped — Creative Studio tabs: FLUX first, Midjourney on its own tab (PR #431)

Owner directive: "the two AI generators [should be] separated into their own
tabs in that page, with FLUX being the main one being shown first when
entering the creative studio."

- The Creative Studio (`/admin/marketing/midjourney`) now opens on the
  **FLUX tab** (default): shared brief (destination → AI-drafted idea →
  brief fields) on the left, FLUX generation + compliance note on the right.
- The **Midjourney tab** carries the same shared brief plus the
  Midjourney-only knobs (parameters, --sref/--oref references) and the
  copy-paste prompt + structure guide.
- Tabs are client-side state (no route change) — the brief, destination,
  AI draft, reference selections, and results all carry over on switch;
  nothing typed is lost. Tab styling matches the ReceivingTabs pattern.
- Zero logic changes: handlers, actions, compliance scanning, and helper
  text untouched (copy cross-references updated for the new layout).
  Page help + concierge KB grounding updated so AI directions stay honest.

**Tests:** suite unchanged at 1,289 passing; tsc + eslint clean. No migration.

## Shipped — POS front-end mega research report v2 (PR #433, Task Z)

Owner directive: deep research on how the best professional POS front-side
apps work; iPad Pro deployment despite App Store cannabis constraints;
offline mode with sale records syncing to the back office; ID scanning
required with audited manual fallback; guided step-by-step compliant sale;
hard blocks below cost; future card acceptance; cash-only tight controls;
clock in/out + PIN-per-sale till accountability; front-side hardware in the
equipment hub; findings recorded in an AI-optimized mega report.

- `docs/POS_FRONTEND_RESEARCH.md` rewritten as the v2 mega report (13
  numbered sections + source appendix), superseding v1 (PR #211).
- Corrected v1's outdated "iOS PWA 50MB / 7-day" claim using the current
  WebKit Safari-17 storage policy; PWA stays disqualified for the correct
  reason (no Web Bluetooth/USB/Serial on iOS). Capacitor recommendation
  stands: verbatim reuse of the repo's TS compliance cores.
- Verified three legitimate App Store paths under Guideline 1.4.3
  (public listing, **Unlisted App Distribution — recommended**, Custom
  Apps/ABM private) with the Cultivera POS listing as live precedent.
- Verified current WAC text: 314-55-095 full transaction limits
  (rec + MCAD) and 314-55-150 acceptable IDs incl. the 11/8/2025
  additions (Global Entry, Permanent Resident card).
- Specced the guided-sale UX (ID-first gate, audited manual verify,
  PIN-per-sale lock screen tied to drawer sessions, clock in/out,
  hard compliance checkpoint before tender, pluggable payment enum),
  offline-first sync design (SQLite + append-only idempotent event log,
  inventory deltas, server-side gate re-validation), payments landscape
  (cash/point-of-banking/ACH compliant; POSaBIT candidate; credit cards
  federally impossible), and the per-register hardware kit for the
  equipment hub. Build plan mapped onto POS slices P0–P7.

**Docs only.** No code, no migration; suite unchanged at 1,289 passing.

## Shipped — Pre-POS seam audit + owner POS decisions recorded (PR #435, Task AA)

Owner directive: "complete a seam audit for me so you are completely grounded
in our actual code and logic and such. No guessing." Plus five recorded
decisions: Unlisted App Distribution approved; 3 registers at launch
(2 budtender + 1 manager till); KEEP the existing Bluetooth front-counter
receipt printer (kicks the drawer today — no mC-Print3 purchase; hub TSP143IV
stays on online-order duty; exact model to be provided); cash-only launch
with POSaBIT pre-approved; seam audit approved.

- New `docs/POS_SEAM_AUDIT.md`: verified contracts of the five back-office
  seams the iPad POS builds on — money core (order-pricing-core), the 8-step
  completion gate (runCompletionGate sequence documented from source),
  registers/drawers (blind-count lifecycle; migration-0038 seed already
  matches the 3-register launch plan exactly), time clock (toggleClock +
  PIN actions), and auth/PIN (corrected a v1 assumption: salted-scrypt PIN
  infrastructure ALREADY EXISTS — employees.clock_pin + throttle +
  getEmployeeByPin — so the POS PIN-per-sale layer reuses it).
- Verdict: all five seams stable; four low-risk additive refactors folded
  into POS slices P0/P1 (extract completion gate to a shared module; sale↔
  register/session/device linkage; punch source "register" + intent-carrying
  offline punches; employee↔staff-profile linkage + pos.* permissions).
- `docs/POS_FRONTEND_RESEARCH.md` gained §14 (binding owner decisions).
- Verification loop on main confirmed green: tsc 0 errors, vitest 1,289/88,
  pure self-tests all passing.

**Docs only.** No code, no migration.

## Shipped — POS B1: completion gate extracted to a shared module (PR #437)

Seam-audit refactor #1 (POS_SEAM_AUDIT Seam 2). `runCompletionGate` moved
VERBATIM from the admin orders server-actions file into
`src/lib/orders/completion-gate.ts` (server-only) so the upcoming POS sync
route re-runs the IDENTICAL 8-step sequence on every synced register sale:
idempotent re-complete → S-12 sales hours → S-2b money recompute →
loyalty-code consistency → card re-validation → DOH 246-70 high-THC hard
gate → S-1b sales-limit hard gate (logged override) → WAC 314-55-090(2)
write-or-block. Zero behavior change; permission checks + completion_blocked
audits remain with the callers.

**Tests:** tsc 0 errors; vitest 1,289/88; pure self-tests pass; eslint clean.
No migration.

## Shipped — POS B2: offline-first POS foundation (PR #439)

Foundation for the register app's offline-first sync spine, per the approved
POS research plan (§14 owner decisions: 3 registers, cash-only launch,
existing TSP143IIIBi Bluetooth printer kept).

- `src/lib/pos/sale-event-core.ts` (pure, zero I/O): append-only POS event
  envelope (client UUID idempotency key, per-device monotonic sequence,
  intent-carrying punches), payment-method enum `cash | point_of_banking |
  ach | debit` with ONLY `cash` enabled at launch (disabled methods
  hard-blocked in validation), cash change math, mandatory ID-gate result on
  every sale payload (manual verifies must reference their audit event UUID),
  category snapshot per line, deterministic replay ordering
  (device → sequence → occurred-at). 34 embedded self-tests.
- `supabase/migrations/0120_pos_foundation.sql` (OWNER APPLIES MANUALLY):
  `pos_devices` (register binding, provision hash, active/revoked),
  `pos_sale_events` (client_uuid UNIQUE for idempotent ingest, status
  pending/processed/exception with resolution fields, order FK),
  `drawer_sessions.device_id`, `time_punches.source` comment adds `register`
  (verified: no CHECK constraint, no ALTER needed), equipment seed
  PRN-COUNTER-01 = Star TSP143IIIBi (front counter, Bluetooth, StarXpand,
  drawer kick via DK port, serial 2550923021300119). RLS mirrors the 0038
  staff pattern.
- `tests/compliance/pos-sale-event-core.test.ts` pins the payment enum, cash
  math, envelope + payload validation, and replay ordering (19 tests).

**Tests:** tsc 0 errors; vitest 1,308/89; pure self-tests pass; eslint clean.
Migration 0120 pending manual apply by owner.

## Shipped — POS B3: pure ID gate — AAMVA scan + audited manual fallback (PR #441)

`src/lib/pos/id-scan-core.ts` — the register's mandatory ID gate, zero I/O so
it runs on the iPad. SCAN path: AAMVA PDF417 parser for US/Canada DL/ID cards
(header validation, DL/ID subfile extraction, CRLF-scanner tolerance, DCT
fallback for pre-2009 first names, US MMDDCCYY / Canada CCYYMMDD dates
normalized to YYYY-MM-DD). Verdict = readable DOB + 21+ (RCW 69.50.357; the
21st birthday itself counts) + not expired (valid through the expiry date,
WAC 314-55-150); anything unreadable routes to the MANUAL path — never a
silent pass. MANUAL path: the 9-type WAC 314-55-150 acceptable-ID list
(incl. Global Entry + Permanent Resident card, eff. 11/8/2025 per WSR
25-21-035), required reason, photo-match confirmation, same 21+/expiry math;
callers must emit a `manual_id_verification` event (B2) whose UUID the sale
payload references. Age math runs on Pacific wall-clock YYYY-MM-DD strings
passed in by the caller — the core stays pure.

**Tests:** tsc 0 errors; vitest 1,327/90; `__runIdScanCoreTests` 39/39 in the
pure self-test runner; eslint clean. No migration.

## Shipped — POS B4: offline-queue sync ingest (PR #443)

The server half of the offline-first spine (research §4.2; seam audit Seams
2+4). `POST /api/pos/sync` authenticates a provisioned iPad by
`X-POS-Device-Id` + `X-POS-Device-Key` (scrypt hash in
`pos_devices.provision_hash`; fails closed) and ingests batched event
envelopes. `src/lib/pos/sync-core.ts` (pure, 18 self-tests): device/register
binding checks, punch INTENT resolution (in+open ⇒ idempotent skip; out+none
⇒ manager exception — never blind-toggle), manual-ID audit payload
validation, ACK semantics (processed/duplicate/exception durable; rejected
stays on-device). `src/lib/pos/sync-store.ts` (server-only): insert-once
ledger on `client_uuid` UNIQUE — a retried flush converges as `duplicate`
with the original outcome, never double-posts. Synced sales materialize an
order and re-run the IDENTICAL B1 completion gate with NO override; refusals
audit `order.completion_blocked` and land in the exception queue with the
order id — never silently dropped, never completed. Punches replay through
`toggleClock(…, "register")`; no-sales and manual ID verifies write audit
rows. Exception queue reads + manager resolution included.
`completion-gate.ts` actorId widened to `string | null` (floor staff have no
back-office login; the ledger row still pins employees.id).

**Tests:** tsc 0 errors; vitest 1,341/91; pure self-tests pass; eslint clean.
Endpoint refuses clearly until migration 0120 is applied.

## Shipped — POS B5: register shell + device provisioning (PR #445)

The iPad-facing register app shell at `/pos` (outside admin middleware,
noindex, AgeGate-skipped) plus its back-office console. Owner decisions
honored (research §14): the DEVICE holds a device-scoped credential; HUMANS
are identified per-action by PIN; the register locks on idle (2 min) and can
be locked with one tap. `src/lib/pos/register-client-core.ts` (pure, 16
self-tests) owns the on-device offline queue: monotonic per-device sequences
(`buildEnvelope`), durable-ACK clearing (`applyAcks` — processed/duplicate/
exception leave the queue; REJECTED rows are kept, flagged, and surfaced,
never silently dropped or blindly re-sent), flush batching in true offline
order capped at the server's 50-event limit, and corruption-tolerant
(de)serialization so a damaged localStorage blob can never brick the till.
`RegisterShell.tsx` wires screens setup → locked (PIN pad → `/api/pos/unlock`
with throttle + `register.unlocked` audit) → home (identity strip, drawer
status, sync card with pending/rejected counts, clock in/out punch intents,
15s background flush + flush-on-reconnect). `/api/pos/sync` gained a
zero-event heartbeat (`{acks: [], device}`) that powers the setup screen.
Back office: `/admin/registers/devices` (gated `staffing.manage`) provisions
devices — a 24-byte key is shown ONCE and only its scrypt hash is stored
(same discipline as employee PINs) — plus bind-to-register, rotate, revoke,
last-sync display; all actions audited (`pos_device.*`). "Start sale" button
is present but disabled pending B6 (guided sale flow).

**Tests:** tsc 0 errors; vitest 1,357/92; `__runRegisterClientCoreTests`
16/16 in the pure self-test runner; eslint clean. Pages degrade with a clear
hint until migration 0120 is applied (owner applies manually).

## Shipped — POS B6: the guided sale (PR #447)

The register's sale loop: ID gate → cart → cash tender → auto-lock. Owner
decisions honored — nothing enters the cart before the ID gate passes, cash
only at launch, and the register locks after EVERY sale so the next one is
PIN-attributed to whoever actually rings it. `src/lib/pos/sale-flow-core.ts`
(pure, 24 self-tests) prices the cart with the IDENTICAL shared engine the
website checkout and the server-side completion gate use — `computePromotions`
over the published rules, statutory cannabis floor (RCW 69.50.357), CCRS
acquisition-cost floor, `computeOrderTotals` tax back-out — so an offline
sale can never disagree with the server's S-2b money recompute. `judgeLimits`
wraps the WAC 314-55-095 evaluator with the owner's settings semantics (hard
block / soft warning / off; rec vs medical), rendered as a live bucket meter
in the cart. `buildSalePayload` validates with `validateSalePayload` BEFORE
enqueue — short tenders, manual verifies without their audit UUID, and empty
carts can never enter the offline queue. `GET /api/pos/menu` (device-auth)
ships one bundle: published menu flattened per variant, promotions active
now as pure EngineRules, limit settings, sales-hours window — cached locally
so offline sales price with the last download (every synced sale is re-gated
server-side regardless). The ID gate takes PDF417 keyboard-wedge scans
(21+ Pacific wall-clock, expired refused) or the audited WAC 314-55-150
manual fallback whose `manual_id_verification` event is enqueued FIRST and
referenced by the sale. Sales hours (WAC 314-55-147) checked on-device
before the gate and re-checked server-side at sync.

**Tests:** tsc 0 errors; vitest 1,376/93; `__runSaleFlowCoreTests` 24/24 in
the pure self-test runner; eslint clean. No migration beyond 0120.

## Shipped — POS B7: pure medical-sale core (PR #449)

The medical brain of the register, kept pure (zero I/O) so it can run
offline on the iPad and be re-verified byte-for-byte by the server gate.
`src/lib/pos/medical-pos-core.ts` ships four pieces. (1) Card capture:
`validateCardCapture` accepts a recognition-card scan/entry only with a
UPID, effective/expiration dates in range for the sale date, patient vs
designated-provider type, and an explicit budtender attestation that the
card was verified in the DOH Medical Cannabis Database (WAC 246-71's
verification duty — we refuse to claim exemptions without it). (2) Age:
`medicalAgeAllowed` — 21+ always; 18–20 ONLY with a valid card (RCW
69.50.357(1)); under 18 never at the counter. (3) Pricing pass-through:
`applyMedicalPricing` reprices each cart line using the EXACT same
primitives the completion gate uses — `lineBaseMinor` backs the pre-tax
base out of the tax-inclusive card price and `decideLineExemption` decides
per line from the durable DOH registry category. A carded patient buying a
246-70 compliant product pays base only ($14.63 shelf → $10.00): the 37%
excise (RCW 69.50.535 exemption via HB 1453, sunset 2029-06-30 per WAC
314-55-090(6), enforced by `exciseSunsetPassed`) and the 9.3% sales tax
(RCW 82.08.9998(1)(a)) both come OFF the price instead of being merely
re-reported. High-THC products hard-block for anyone without a valid card
(statutory, no override). No card ⇒ no claims at all — the documented
conservative policy, because WAC 314-55-090(2) exempt-sale records require
card facts. (4) Payload: `PosMedicalSaleBlock` carries the card capture +
its audit-event UUID + computed savings into the sale payload for B8's
server wiring, validated by `validateMedicalSaleBlock` before enqueue.
Because the reprice changes unit prices themselves, `computeOrderTotals`
over the repriced lines stays self-consistent — the server's S-2b money
recompute needs no tolerance changes.

**Tests:** tsc 0 errors; vitest 1,394/94; `__runMedicalPosCoreTests` 31/31
in the pure self-test runner; eslint clean. Pure module — no migration.

## Shipped — POS B8: medical server wiring (PR #451)

The B7 medical core is now wired through every server seam, so a medical
sale rung at the register — even fully OFFLINE — resolves, attaches,
re-gates, and records exactly like a back-office medical sale.
`GET /api/pos/menu` ships a `medical` config block (endorsement flag, the
WAC 314-55-090(6) excise sunset with the gate's own 2029-06-30 fallback,
and the durable DOH 246-70 registry as productId → category), cached with
the bundle so `applyMedicalPricing` runs offline with the IDENTICAL inputs
the completion gate re-derives at sync. `PosSalePayload` gained an optional
`medical` block (card facts + card-capture event UUID + passed-through
savings); `validateSalePayload` enforces its structure including the
mandatory MCR-verification attestation (the consultant must check the card
in the DOH Database — HB 1453 FAQ). A new `medical_card_capture` event type
is enqueued BEFORE the sale that references it (same discipline as
manual_id_verification) so the card facts are an immutable audit fact even
for abandoned sales; **migration 0121** widens the 0120 event-type CHECK to
accept it, and until the owner applies it the sync route returns a precise
"apply 0121 first" rejection (23514 detected — nothing silently dropped).
At ingest, a medical sale (1) verifies its card-capture event synced first,
(2) resolves the UPID to an ACTIVE `patient_authorizations` row via the new
`findAuthorizationByUpid` (the durable card from DOH 608-048 intake), and
(3) re-validates it TODAY with `authorizationValidityAt` — any failure is
an exception with a staff-actionable reason and NO order is created. The
resolved card is attached with `attachCardToOrder` before `runCompletionGate`,
so the gate's existing medical machinery all fires: card re-validation,
high-THC statutory gate, 3× medical limits (WAC 314-55-095(2)(d)), and the
WAC 314-55-090(2) exempt-ledger write-or-block. The S-2b money gate needed
NO changes: B7's pass-through reprices unit prices themselves, so the
server recompute is self-consistent with the device's totals.

**Tests:** tsc 0 errors; vitest 1,400/94; sale-event-core self-tests now
41/41; eslint clean. Owner applies migration 0121 (after 0120).

## Shipped — POS B9: medical register UX (PR #453)

Selling to a medical cardholder at the register is now one extra step at
the ID gate — nothing more. The recognition card is captured AT the gate
(not a cart toggle) because it changes the legal age floor, unlocks
high-THC products, and drives pricing and the sale payload. When the store
is endorsed (the menu bundle carries a `medical` config), the gate shows a
"Medical recognition card" checkbox with UPID / effective / expires /
holder-type fields and the mandatory MCR-verified attestation. The card is
validated with `validateCardCapture` WITHOUT enqueueing; the
`medical_card_capture` event is enqueued only after the WHOLE gate passes,
so retries never litter the offline queue. Carded buyers pass the gate at
18+ (RCW 69.50.357(1)) — both scan and manual paths take a new optional
`minimumAgeYears` param (default 21) and re-assert with `medicalAgeAllowed`.

From there everything reprices automatically. A module-level
`priceForBuyer(cart, bundle, carded)` helper leaves non-carded carts
untouched and runs carded carts through `applyMedicalPricing` (tax-off
pass-through) plus the SAME `computeOrderTotals` the server uses — device
totals and the S-2b server recompute can never disagree. The cart shows a
MEDICAL · UPID header badge, per-line "MED · TAX OFF" chips, and a
"Medical savings (tax off)" totals row; `judgeLimits` runs the "medical"
3× profile (WAC 314-55-095(2)(d)); chapter 246-70 WAC high-THC violations
render a red blocking banner that disables tender with NO override. The
tender screen reprices with the same helper and shows the savings under
the total due, and `buildSalePayload` carries the medical block verbatim
(`card`, `cardEventUuid`, `medicalSavingsMinor`) — exactly the B8
`validateSalePayload` contract that sync ingest resolves and re-gates.

**Tests:** tsc 0 errors; vitest 1,400/94; id-scan-core self-tests 43/43,
sale-flow-core 27/27; eslint clean. UI-only — no migration, no server
changes (B8 already shipped the ingest + gate wiring).

## Shipped — POS B10: register receipts (PR #455)

Receipts print two ways from the sale-complete screen, and both render the
SAME pure HTML so paper can never differ: "Print receipt" hands the document
to Star's PassPRNT iOS app (App Store) which prints on the paired
TSP100IIIBi over Bluetooth, kicks the cash drawer AFTER the print
(`drawer=after&drawerpulse=200`), and returns to the register via the
`back=` callback; "Browser print" opens the same HTML in a popup with
`window.print()` for devices without PassPRNT. The URL scheme, `size=3`
(576 dots / 72mm printable width), and drawer parameters were verified from
the Star PassPRNT manual — never guessed.

The new pure module `src/lib/pos/receipt-core.ts` (25 self-tests, vitest
mirror `pos-receipt-core.test.ts`) builds a self-contained 576px document:
money in minor units via the existing `formatMoneyMinor` and Pacific
wall-clock timestamps via `formatReceiptTimestamp` — both REUSED from
`printing/receipt-core` so the POS receipt and the CloudPRNT pickup receipt
can never drift. Medical sales print a "MEDICAL — TAX EXEMPT SALE" banner,
a "Medical savings (tax off)" row, per-line MED TAX OFF chips, and struck
regular prices — but deliberately NO card details (no UPID, no dates): the
WAC 314-55-090(2) records live in the back-office exempt ledger, not on the
customer's paper (asserted by self-test). Every customer-visible string is
HTML-escaped; the receipt number is the last 8 of the durable sale
`client_uuid`, so paper always traces to the synced event. The receipt
snapshot is frozen at enqueue time from EXACTLY the priced lines/totals/
tender in the payload, so reprint (tap again) always reproduces the
original. `RegisterShell` passes the provisioned device name for the
header.

**Tests:** tsc 0 errors; vitest 1,407/95; `pos/receipt-core` 25/25 in the
pure self-test runner (import + call both verified); eslint clean. No
migration, no server changes.

## Shipped — POS B11: iPad Home-Screen PWA for /pos (PR #456)

The register now installs to the counter iPads as a real Home-Screen app —
full-screen with no Safari chrome, landscape, dark status bar, Greenway
icon — and the shell BOOTS OFFLINE, completing the offline-first story
(the app layer already kept the event queue and menu bundle in
localStorage). `public/pos/manifest.webmanifest` declares the standalone
app (scope + start_url `/pos`, 192/512 icons rendered from the brand logo
with sharp); `src/app/pos/page.tsx` exports the Next metadata (`manifest`,
`icons.apple` 180px, `appleWebApp` capable + black-translucent status bar)
and a `Viewport` (dark theme color, no pinch-zoom at the counter).

The service worker (`public/pos-sw.js`) is deliberately tiny: `/pos` HTML
is network-first with cache fallback so the register opens with the
store's internet down; `/_next/static/*` hashed assets and the `/pos/*`
icons are cache-first (immutable by content hash); and it NEVER intercepts
`/api/*`, so sync/unlock/menu semantics stay exactly as built. It is
registered best-effort from `RegisterShell` mount with `scope: "/pos"` so
it can never collide with the Task-W admin push worker (`push-sw.js` at
scope `/`); old caches are cleaned on activate, and registration failure
(private mode, old iPadOS) simply leaves the register online-only.

**Tests:** tsc 0 errors; vitest 1,407/95; pure self-tests all pass; eslint
clean. No migration, no server changes.

## Shipped — POS B12: register exception-queue manager (PR #458)

The manager UI for the sync exception ledger — the last piece of the
B7–B12 run. Every register event the ingest could not process safely lands
in the queue with a staff-actionable reason (the B4/B8 discipline: nothing
is ever silently dropped), and `/admin/registers/exceptions`
(`staffing.manage`) is where a manager works it. Open exceptions render
oldest-first with an event-type badge, Pacific timestamp, register and
employee NAMES (resolved through the existing stores), the client UUID,
the actionable reason, and a collapsible full-payload inspector so the
manager sees exactly what the register sent — lines, totals, tender, card
facts. Resolving requires a written note (min 5 chars, enforced
server-side by the existing `resolvePosException`) and records an audited
`pos.exception_resolved`; the help panel spells out the workflow — fix the
underlying problem FIRST (intake the card, apply the migration, correct
the price), re-ring at the register if the sale still needs to happen,
then resolve, because resolution never replays the event. A "Recently
resolved" section keeps the durable paper trail (reason, note, resolver,
timestamps, payload). `listPosExceptions` now selects the payload and a
new `listResolvedPosExceptions` reads the resolution columns migration
0120 already carries; the Register Activity page gained an "Exceptions"
button with a live open-count.

**Tests:** tsc 0 errors; vitest 1,407/95; pure self-tests all pass; eslint
clean. No migration, no register-app changes.

### Shipped: POS B13 — receipt customization (PR #461)

Owner directive (Task AD): "the ability to customize the receipt, like
other POS systems offer." The new `/admin/registers/receipt` page
(`settings.manage`) styles the REGISTER receipt the way the big POS
players do: header (store name), an address/contact block printed one
centered line each (street, city, phone, license #), the footer message,
and three display toggles — Served-by (budtender name), You-saved (promo
savings row), and Loyalty points (member block, consumed by B14). The
page's live preview is a sandboxed iframe running the IDENTICAL pure
`buildPosReceiptHtml` the register hands to Star PassPRNT, fed a sample
sale — preview and paper are the same builder, so they can never drift.

Config lives in a pure core (`receipt-config-core`, 19 self-test
assertions in the compliance harness + vitest mirror) with foolproof
normalization: garbage degrades to safe defaults, header/footer clamp to
60/400 chars, the address clamps to 5 printable lines, blank header/footer
reset to the compliant defaults while a cleared address stays empty.
Storage is a single `site_settings` JSON row (`pos_receipt_config`) — the
same NO-migration pattern as the sales-hours window — and the config
ships inside the `/api/pos/menu` bundle (optional field; pre-B13 cached
bundles still parse) so OFFLINE sales print the customized design. The
pure receipt builder gained addressLines / servedBy / hideSavings /
loyalty inputs (10 new assertions; card details still never print). Saves
are normalized server-side and audited (`pos.receipt_config_saved`).

**Tests:** tsc 0 errors; vitest 1,413/96; pure self-tests all pass
(import AND call grep-verified); eslint clean. No migration.

### Shipped: POS B14 — loyalty at the register (PR #463)

The loyalty program now works at the till the way the big POS players do
— attach a member, earn points automatically, see it on the receipt —
without ever letting the register compute authoritative points. A new
device-authenticated `GET /api/pos/member` searches customers by
name/phone/email (the existing listCustomers matcher) and returns a
privacy-lean hit: first name + last initial, points balance, tier — never
birthdate/contact/notes. Lookup is ONLINE-ONLY by design (no customer
book is ever cached on an iPad); an offline register simply rings the
sale without the member.

The cart screen gained a "★ Add loyalty member" panel (search → pick →
attached chip with Remove). The sale payload carries an optional
`loyalty { customerId, memberLabel }` block (structurally validated:
UUID + 1–80-char label). At sync, processSale re-verifies the customer
exists (dangling id = actionable exception, never a silent anonymous
completion that loses points) and — on medical sales — that the member
IS the recognition-card holder (mismatch = exception; points must never
land on the wrong person). It then writes `orders.customer_id` BEFORE
the gate, so the EXISTING idempotent completion accrual
(setOrderStatus → accrueForOrder, auto-enroll, pretax basis) earns the
points exactly like website orders — zero new accrual paths. The bundle
ships `loyalty.pointsPerDollar` so the receipt prints a points ESTIMATE
(B13 loyalty block, owner-toggleable); the ledger stays authoritative.

**Tests:** tsc 0 errors; vitest 1,416/96; pure self-tests all pass
(pos/sale-event-core 46, pos/sale-flow-core 29); eslint clean. No
migration.

### Shipped: POS B15 — customer-return policy core (PR #465)

Pure, zero-I/O policy module (`src/lib/pos/returns-core.ts`) for counter
returns, holding every SALE-level verdict the B16 flow enforces. Rule vs
policy is verified and separated: WAC 314-55-079(12) (scraped
app.leg.wa.gov) lets a retailer accept returns of open cannabis products
— ALL products, not vape-only — only in original packaging with the
lot/batch/inventory ID fully legible (those per-line attestations remain
in Task Q's `validateCustomerReturn`); the CCRS FAQ correction shape
(Sale Delete/Update + positive InventoryAdjustment with details) remains
in the Task Q machinery. The OWNER'S STORE POLICY — stricter than rule,
which is allowed — is what this core adds: the buyer must be a loyalty
member (`orders.customer_id`, set at the register by B14), the original
receipt must be in hand, and the return must be requested within 15
Pacific calendar days of purchase (purchase day = day 0).

Contracts: `normalizeReceiptNumber` turns sloppy input into the canonical
8-hex-uppercase receipt number exactly as `receiptNumber()` prints it
(inputs whose stray characters are themselves hex are rejected, never
mis-read); `receiptLookupSuffix` yields the lowercase suffix for the
`client_uuid::text LIKE '%xxxxxxxx'` server lookup.
`pacificDaysBetween`/`returnWindowVerdict` count DST-safe Pacific
calendar days and refuse future-dated sales (clock skew).
`evaluateReturnEligibility` reports ALL sale-level failures at once.
`refundForLine(s)` computes exact integer-cent refunds off the stored
FINAL tax-inclusive paid price (medical lines were repriced at sale
time, so no special-casing). `pointsClawback` is proportional to the
refunded share of the order total, floored (customer-favorable), and
clamped to the points actually earned — a full refund claws back
everything, a zero-earn order claws back nothing.

**Tests:** tsc 0 errors; vitest 1,422/97; pure self-tests all pass
(import AND call grep-verified — the call was silently dropped once
again and re-applied); eslint clean. No migration; no server/UI changes
(that's B16).

### Shipped: POS B16 — returns desk (PR #467)

Receipt-first counter returns at `/admin/registers/returns`
(inventory.manage — the Task Q level, since returns move inventory and
queue CCRS corrections). The flow follows the counter conversation:
type the 8-char number off the customer's ORIGINAL receipt →
`lookupSaleByReceipt` scans processed `pos_sale_events` sales from the
last 17 days (the 15-day policy window + 2-day clock-skew buffer — the
policy bounds the scan, so no uuid-cast tricks) and suffix-matches the
`client_uuid` exactly as `receiptNumber()` prints it, then evaluates
EVERY sale-level gate at once (completed-only, loyalty member attached
via B14's `orders.customer_id`, 15 Pacific days). Pick the line and
quantity — the refund is computed from the stored FINAL tax-inclusive
paid price (`refundForLine`), so staff never type an amount and medical
exemptions carry through automatically. Attest to WAC 314-55-079(12)
(original packaging + fully legible lot ID), pick restock vs destroy,
submit: the server re-verifies ALL policy (UI verdicts are advisory)
and runs Task Q's `createCustomerReturn` — CCRS Sale-row snapshot,
Sale Delete/Update correction queued, positive inventory add-back,
optional destruction event.

Loyalty points are clawed back proportionally (`pointsClawback`:
floored, clamped) as a negative `adjustPoints` ledger row tied to the
order — `adjustPoints` gained an optional `orderId` so repeated partial
returns subtract prior clawbacks and can never over-claw. A new pure
`buildRefundReceiptHtml` (same 576px PassPRNT size=3 family, owner's
B13 header/address/footer, REFUND banner, original receipt number,
exact cash, points adjustment, never card details) prints straight from
the result panel. Audited as `customer_return.counter`; "Returns desk"
button added to Register Activity.

**Tests:** tsc 0 errors; vitest 1,424/97; pure self-tests all pass
(pos/receipt-core now 49 asserts); eslint clean. No migration (reuses
0115 `customer_returns` + 0120 `pos_sale_events`).

### Shipped: POS B17 — register polish pack (PR #469)

Three register features the big POS players all ship, on the existing
offline-queue / device-auth / PassPRNT machinery. No migrations.

**Audited no-sale drawer open.** The server path already existed
(`validateNoSalePayload` + `processNoSale` → `register.no_sale` audit);
this slice added the register UI plus the missing approval mechanic. New
`POST /api/pos/approve`: device-authenticated manager-PIN check — same
salted-scrypt verify + shared brute-force throttle as `/api/pos/unlock`,
then role-gated to `manager`/`lead`. Returns only `employees.id` + name;
the approver's PIN never rides in a queue payload, and the endpoint
writes no audit of its own (the approved `no_sale` event is audited once
at sync with the approver's id inside it). The home-screen modal takes a
preset or free-text reason (3–500 chars, mirroring the server validator)
plus the manager PIN, online-only. The drawer opens ONLY behind paper:
PassPRNT's kick fires after a print (`drawer=after`, verified from the
manual), so the flow enqueues the event, prints the new NO SALE audit
slip (`buildNoSaleSlipHtml` — same 576px family, B13 header/address,
reason + "Opened by" + "Approved by", escaped), and the kick follows.

**Reprint last receipt.** The register locks after EVERY sale (owner
rule), which unmounted SaleFlow and lost the frozen receipt. SaleFlow
now fires `onReceiptFrozen` with the exact enqueue-time snapshot; the
shell persists it (`gw-pos-last-receipt`) and `parseLastReceipt` REALLY
validates the stored shape (integer minor-units, non-empty lines,
versioned envelope) — corruption yields null, never a garbage print.
Home screen shows the receipt number + age; reprints use
`openDrawer:false` so the drawer never pops on a reprint.

**Hold / resume sale.** Hold parks a MINIMAL snapshot (variant ids +
counts, never prices; one hold at a time). Resume rebuilds against the
CURRENT bundle (`rebuildHeldCart`): fresh prices, vanished/out-of-stock
variants dropped and named, quantities clamped. The ID gate always
re-runs — a held cart never inherits the previous customer's age
verification, medical card, or member. Completing a resumed sale
consumes the hold; cancelling leaves it parked.

New pure `src/lib/pos/register-polish-core.ts` (23 asserts) + 9 new
no-sale-slip asserts in pos/receipt-core (58 total) + vitest mirror
`pos-register-polish-core.test.ts`.

**Tests:** tsc 0 errors; vitest 1,431/98; pure self-tests all pass;
eslint clean. No migration; no schema changes; no new env vars.

### Shipped: POS B18 — handoff-ready operations guide (PR #471)

Docs-only. `docs/POS_OPERATIONS_GUIDE.md` is the single handoff
reference for owners, managers, and budtenders — every claim verified
against the shipping code, with file references embedded so a future
maintainer can follow the trail.

Covers: one-time setup (device provisioning, employee PINs with scrypt
self-upgrade, Star TSP100IIIBi + PassPRNT pairing with verified URL
parameters, B13 receipt design studio); daily operations (drawer
count-in, clock-in, menu refresh, the guided sale rail with medical
path + loyalty attach + cash tender, B17 hold/resume + reprint +
manager-approved no-sale, closing with drop/blind-close/reconcile/
verify); the returns desk counter script with the sourced regulatory
note (WAC 314-55-079(12) = ALL products in original packaging with
legible lot ID; CCRS Sale Delete/Update + positive InventoryAdjustment;
15-day + loyalty-member = store policy, stricter than rule); loyalty
mechanics; offline queue + exception-queue behavior; a 13-row
troubleshooting table grounded in real code paths; and a compliance map
(rule → enforcing code) for WAC 314-55-079/-095/-147, RCW 69.50.375,
ch. 246-70 WAC, CCRS reporting, and drawer accountability.

**Tests:** docs-only — no code changes, no migration. CI green
(compliance + Vercel) on PR #471.

### Shipped: POS B19 — inventory decrement on completed sales (PR #473)

Closed the verified gap where NOTHING reduced stock at sale:
`menu_variants.inventory_level` was only written by imports/intake/
draft-injection and `inventory_lots.on_hand_qty` only by dispositions and
cycle counts (migration 0023's comment promised the sell flow "in a later
slice" — this is that slice). Every completed order now decrements BOTH
layers through one funnel in `setOrderStatus`, so POS-synced sales and
back-office completions behave identically.

Pure core (`src/lib/inventory/sale-decrement-core.ts`, 32 assertions):
variant matching (explicit variant_id → single-variant fallback → the
trailing "(label)" the register bakes into product names), demand
accumulation, oversell clamped at 0 and reported (never a stored
negative), item `inventory_status` recompute with the import pipeline's
exact thresholds (≤0 unavailable / ≤3 low-stock) guarded so an UNTRACKED
item (all-zero levels) never flips status on a sale; FIFO oldest-first
lot consumption keyed by `pos_product_key` with `sold_out` marking and
exact-remainder shortfall reporting.

Server wrapper (`src/lib/inventory/sale-decrement.ts`): idempotent per
order via an `inventory_decremented` order_event marker; NEVER blocks
completion (failures leave a visible note event); sales deliberately do
not write `inventory_adjustments` (0023 scopes that ledger to non-sale
changes — the order's own lines are the sale audit trail).

**Tests:** 1,441 vitest tests / 99 files (10 new in
`tests/compliance/sale-decrement-core.test.ts`); selftest runner
registers import AND call. No migration needed. CI green on PR #473.

### Shipped: POS B20 — exact variant + lot CCRS-id capture on sale lines (PR #475)

**What was missing (verified in code):** the register never told the
server WHICH variant it sold — `order_lines.variant_id` (present since
migration 0007) stayed NULL and `order_lines.ccrs_inventory_external_id`
(0031) was only ever set by hand, so the weekly Sale.csv builder fell
back to `pos_product_key` fuzzy resolution (`fallbackKeyIds`) instead of
the exact line-level id CCRS wants.

Register → server: `PosSaleLine` gained an OPTIONAL `variantId` (blank
rejected if present; pre-B20 offline queues still validate), carried
through `priceCart` → `buildSalePayload` → `/api/pos/sync`, where
`processSale` now writes `order_lines.variant_id`.

Lot id stamping: `buildLotDecrementPlan` (B19's pure FIFO planner) now
returns `lineExternalIds` — per product key, the canonical CCRS external
id of the FIRST lot consumed, derived with the same
`deriveInventoryExternalId` used by the Sale.csv builder. On completion
the B19 wrapper stamps `order_lines.ccrs_inventory_external_id` ONLY
where NULL (`.is(..., null)`) so explicit manual overrides are never
clobbered, and never fabricates an id when no lot matched.

Result: Sale.csv resolution preference (line → lot → product-key) now
lands on "line" (exact) for every sale rung after this ships.

**Tests:** 1,442 vitest tests / 99 files;
`sale-decrement-core` self-tests now 33 assertions (variantId carry,
stamping, no-fabrication). No migration needed. CI green on PR #475.

### Shipped: POS B21 — register-side till: count-in, drops, blind close (PR #477)

**What was missing (verified in code):** every drawer primitive existed
server-side (`openDrawer`/`recordDrop`/`closeDrawerBlind` in
`src/lib/registers/store.ts`, pure denom math in `registers/cash.ts`,
schema 0038/0077/0120) but was reachable ONLY through back-office admin
actions requiring a staff login the iPad doesn't have — the register home
screen literally said "count one in from the back office." Owner's
direction (recorded in `registers/oversight.ts`): the hands-on till work
belongs at the register; the back office keeps oversight/reconcile/verify.

New device-authenticated `POST /api/pos/till` (same two-factor discipline
as /api/pos/unlock — provisioned device + human PIN with shared scrypt
throttle): **open** counts in the float from a full 13-denomination
breakdown, stamps `drawer_sessions.device_id` best-effort, and returns
live DrawerInfo so Start Sale unlocks immediately; **drop** records a
mid-shift safe drop with an optional SECOND person's witness PIN verified
server-side (a drop can never witness itself); **close** records the
count-out BLIND — the response carries no expected/variance/total, the
manager reveals over/short at back-office reconcile. Every action writes
an audit row (`drawer.opened`/`drawer.drop`/`drawer.closed_blind` with
`via: "register"`). ONLINE-ONLY: PINs can't verify offline and cash
custody must be durable the moment cash moves.

Pure core `src/lib/pos/till-core.ts` (30 assertions): request validation
(empty float rejected on open, zero-count close legitimate, drop window +
plausibility cap, register-side reconcile rejected), `dollarsToMinor`
returning null (never 0) for bad input, `sanitizeDenoms` clamping.
`TillModal` in RegisterShell: denom count grid ($100→1¢) with live total,
drop amount/window/witness/notes, actor PIN on everything; the close
screen tells the cashier the blind count protects them.

**Tests:** 1,448 vitest tests / 100 files (6 new in
`tests/compliance/till-core.test.ts`); selftest runner registers import
AND call. No migration needed. CI green on PR #477.

### Shipped: POS B22 — X/Z day report printed on the Star (PR #479)

**What was missing (verified in code):** no per-register end-of-day report
existed anywhere, even though the register's own append-only ledger
(`pos_sale_events`, 0120) already carried everything — processed SALE
payloads hold the totals the compliance gate recomputed and accepted at
sync, and `drawer_sessions`/`drawer_drops` hold the cash-custody story.

Pure core `src/lib/pos/day-report-core.ts` (25 assertions):
`summarizeDayEvents` sums money from PROCESSED sales only (gross/subtotal/
tax + medical count and tax-exempt savings) — exceptions and pendings are
counted, never summed; `summarizeDrawerDay` reports floats/drops and sums
over/short ONLY from manager-reconciled/verified sessions (null until
then — blind counts stay blind, nothing computes expected early);
`reportKind` = X while any session is open, Z once all closed;
`buildDayReportSlipHtml` renders the 576px Star slip (same page family as
receipts) with SALES / REGISTER ACTIVITY / CASH DRAWER sections.

`POST /api/pos/day-report`: device-auth + MANAGER/LEAD PIN (same role
gate as /api/pos/approve) because gross cash + float − drops IS the
expected-drawer figure the blind close hides from the cashier. Pacific
business-day window via the reporting suite's DST-correct helpers.
Audits `register.day_report`. The register builds the slip client-side
and prints via PassPRNT with the drawer kick OFF — a report never pops
the drawer. "Day report (X/Z)" card added to the home screen.

**Tests:** 1,452 vitest tests / 101 files (4 new in
`tests/compliance/day-report-core.test.ts`); selftest runner registers
import AND call. No migration needed. CI green on PR #479.

### Shipped: POS B23 — barcode scan-to-cart on the sale screen (PR #481)

**What was missing (verified in code):** the register had no product
barcode path at all — the sale screen's search box matched name/brand/
category text only, and the menu bundle carried no code→product mapping.
In WA I-502 the package label barcode is the traceability lot code (the
same fact cycle-count scanning already relies on), so every jar/unit on
the floor already carries a scannable id the system knows.

Pure core `src/lib/pos/scan-to-cart-core.ts` (18 assertions):
`normalizeBarcode` reuses the cycle-count scan normalizer; 
`buildBarcodeIndex` maps each active lot's lot_code AND canonical CCRS
external id (via `deriveInventoryExternalId`) to its sellable product
key — sub-4-char codes excluded, delisted products excluded, and a code
seen on two different products is dropped AND poisoned so it can never
silently pick the wrong item; `resolveScan` returns add (one sellable
variant), pick (several — cashier chooses the size), or none (falls
through to plain text search).

`/api/pos/menu` ships the index in the bundle (active lots with stock,
built in a try/catch so an index failure can never break the menu
download), which means scanning works OFFLINE from the cached bundle.
On the cart screen, Enter in the search box tries the text as a scan
first — exactly how a keyboard-wedge scanner types — with a green flash
on add and a variant-pick chip panel when one code covers multiple sizes.

**Tests:** 1,456 vitest tests / 102 files (4 new in
`tests/compliance/scan-to-cart-core.test.ts`); selftest runner registers
import AND call. No migration needed. CI green on PR #481.

### Shipped: POS B24 — manager-PIN price override at the register (PR #483)

**What was missing (verified in code):** the register had no price-override
path at all — priceCart's output was final, POS sync runs the completion
gate with `overridePermitted: false`, and the only manager-PIN pattern was
the no-sale drawer open. Damaged packaging or a posted-price discrepancy
had no compliant markdown path.

Pure core `src/lib/pos/price-override-core.ts` (26 assertions):
`overrideFloorMinor` mirrors priceCart's floors EXACTLY — the statutory
cannabis minimum (RCW 69.50.357, never free cannabis) plus the CCRS
acquisition-cost floor via the same lineCostFloor/EngineCartLine shapes,
so no PIN can approve a price below either; `validateOverrideRequest` is
MARKDOWN-ONLY (raising a price is a back-office menu edit) and enforces
the floor + a 3–500-char reason BEFORE the PIN is spent;
`applyPriceOverrides` is stale-safe — an override approved against a
specific engine price is DROPPED and reported if the engine reprices the
line (quantity change moving a promo tier), never silently applied.

Register UI: per-line "Override" button → modal with new price, reason
presets + free text, and manager/lead PIN, verified server-side by the
EXISTING /api/pos/approve (scrypt + shared throttle + role gate) —
ONLINE-ONLY, and the PIN never enters any queue payload; only the
approver's employees.id rides the sale line's new OPTIONAL `override`
block (validated in validateSalePayload; pre-B24 queues still sync).
Overridden lines show an amber chip with the approver + "was" price and
an Undo; overrides are per-sale state, never inherited by holds. The
medical exemption pass reprices FROM the overridden price. At sync,
processSale audits one `register.price_override` row per overridden line;
the overridden price IS the stored line price, so the S-2b money
recompute and the stored-price floor check hold unchanged.

**Tests:** 1,471 vitest tests / 103 files (15 new in
`tests/compliance/price-override-core.test.ts`); selftest runner registers
import AND call. No migration needed. CI green on PR #483.

### Shipped: POS B25 — register setup credential shape-check (PR #485)

**What happened in the field (verified from the owner's screenshot):**
first provisioning failed with the server's terse "Missing or malformed
device credentials." — the DEVICE ID field held the one-time KEY and the
DEVICE KEY field held the UUID id (pasted into each other's fields).
authenticateDevice checks isUuid(deviceId) and correctly refused, but the
register offered no explanation.

The two credentials have unmistakable shapes — pos_devices.id is a
Postgres UUID; the key is randomBytes(24).toString("base64url"), a
32-char dash-free string — so a swap is detectable with certainty.

Pure core `src/lib/pos/device-setup-core.ts` (13 assertions):
`checkSetupCredentials` strips pasted whitespace + zero-width characters,
detects the id↔key swap and returns the values in the correct slots,
explains a malformed id in human terms, points a UUID-in-the-key-field at
key rotation (the plaintext key shows only once), and catches too-short
keys — all BEFORE any network round-trip. The SetupScreen runs it on
Verify & save: a detected swap is fixed with a visible notice, then the
verify proceeds. Server behavior unchanged.

**Tests:** 1,478 vitest tests / 104 files (7 new in
`tests/compliance/device-setup-core.test.ts`); selftest runner registers
import AND call. No migration needed. CI green on PR #485.

### Shipped: POS B26 — setup key integrity, the field "Device key rejected." failure (PR #487)

After B25 fixed the id/key field swap, provisioning failed in the field a
second time: the server answered "Device key rejected." with the correct id,
the original key, AND a freshly rotated key. That error fires only when
verifyPin(deviceKey, provision_hash) is false — the key string arriving is
not the key that was minted. Root cause: the key is TYPED on the iPad and is
case-sensitive base64url (randomBytes(24).toString("base64url"), always
exactly 32 chars of [A-Za-z0-9_-] at both minting sites), but the setup
inputs lacked autoCapitalize="none"/autoCorrect="off" — iOS silently
capitalizes the first typed letter, autocorrects letter runs, and swaps
smart dashes for hyphens; spellCheck={false} stops none of that.

Fix (client-only): (1) autoCapitalize="none" + autoCorrect="off" on both
setup inputs; (2) device-setup-core's clean() also normalizes typographic
dashes (en/em/minus/figure/non-breaking) to ASCII "-"; (3) an exact
key-shape check (^[A-Za-z0-9_-]{32}$) that names the bad character or the
wrong count and explains case sensitivity + keyboard mangling BEFORE the
network call; (4) a server "Device key rejected." is translated on-screen:
the key is case-sensitive, only the NEWEST key survives rotation, and both
values must be copied from the SAME device row without retyping.

**Tests:** 1,482 vitest tests / 104 files (+4 in
`tests/compliance/device-setup-core.test.ts`); device-setup-core self-tests
13 → 21 assertions. No migration. No money paths. CI green on PR #487.

### Shipped: POS B27 — same-day void sale at the register (PR #489)

A void is not a return. A return is a customer bringing product back on any
later day (B15/B16 handle that, CCRS corrections included); a void is "that
sale should never have happened" — wrong items rung, customer walked before
taking product, trainee error — caught the SAME day. Every major cannabis
POS (Dutchie, Flowhub, Cova, Treez) separates these, and now so do we.

New pure core `src/lib/pos/void-sale-core.ts`: eligibility is server-
authoritative and returns a COMPLETE error list — the order must be
completed TODAY (Pacific wall-clock, DST-safe via the tested
pacificToday()/pacificWallTimeToUtcISO helpers), must have no prior partial
returns against it, and can never be voided twice (order_events
`sale_voided` marker). Reason is mandatory (3–500 chars, five one-tap
presets: wrong items, customer walked, trainee error, duplicate ring,
price dispute) and a manager/lead PIN is required — same scrypt + throttle
discipline as every other two-man-rule action.

The reversal reuses existing tested machinery instead of inventing new
paths: S-15 reasoned lifecycle (completed→ready with reversalReason
"VOID: …", then ready→cancelled), both B19 inventory layers restocked
idempotently (`sale_void_restocked` marker; menu_variants level + item
status recompute, newest non-quarantine lot per product, sold_out
reactivates), FULL loyalty clawback (cumulative-safe: earn minus prior
adjust clawbacks), and medical_exempt_sales rows deleted so the WAC
314-55-090(2) ledger never shows a voided sale. `register.sale_voided`
audit row records who, why, and how much. A 576px void slip prints with a
"SALE VOIDED" banner and the drawer pops — cash goes back to the customer.
ONLINE-ONLY (no offline voids). Register home gets a "Void a sale (today)"
tile: receipt lookup → sale preview → reason → manager PIN → red confirm.

No CCRS correction file is needed: Sale.csv exports COMPLETED orders only
(verified in ccrs-sales.ts) and voids are same-day, so a voided order never
reaches the weekly filing in the first place.

**Tests:** 1,492 vitest tests / 105 files (+10 in
`tests/compliance/void-sale-core.test.ts`); void-sale-core self-tests
(23 assertions) registered in the runner with import AND call. No
migration. CI green on PR #489.

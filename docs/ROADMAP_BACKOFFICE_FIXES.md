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

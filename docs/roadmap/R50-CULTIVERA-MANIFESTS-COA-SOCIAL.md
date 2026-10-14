# R50 — Cultivera Manifests Rebuilt, COA Harvest, Logged-in Social

> **THE BIBLE FOR R50.** Read before every slice; check again before every commit.
> If it is not in here, it is not in scope. Branch prefix `r50-*`. Base: main `f7fe6986` (R49 merged, PR #1343).

---

## 0. Owner's request (verbatim, recorded 2026-10-12)

> Thank you! I have a big task that I want you to go really slow on, be meticulous and work every tedious
> detail to perfection. We need to upgrade the Cultivera upload to intelligently recognize and group
> products based on when they came in, so we can recreate the manifest for those grouped products and then
> send them through the onboarding process. Not blocking them from being visible on the menu and register
> for sale. The onboarding process for those "manifests" will be the first enrichment process before it
> moves to the enrichment page for manual attachment of missing facts. Instead of having thousands of
> products unattached to their original manifests, we should group them as if we received them. Then the
> sorting and filtering logic we built can use those manifests. Then we can name them better, attach real
> coa data to them, attach all the facts. Then master them, then store them in the kb so we can reference
> them in the future when that product comes in through our system. Even if our systems naming convention
> was slightly different than Cultivera's, the system should be smart enough to suggest the imported
> Cultivera product when that same product comes in through our intake. We will need to utilize the web
> crawler to scrape my Cultivera portal to get all of the COA's. Cultivera is not going to give them to me.
> Please let me know the steps to add the variables to the crawler on railway to make it work. I want to
> attach them at the onboarding step, so we will need to match the coa to the product, utilizing llama
> parse. Can the process be intelligent where it records the name and lot number and such to remarry it to
> the product as it downloads the PDFs to a special folder that we can then upload from? I still do very
> much want to send all products uploaded via Cultivera to move through the onboarding process all the way
> through to the inventory page. Then, I want to upgrade it so we can scrape vendor social media pages in a
> different way. The page access api key method won't work. We need to simulate me logging in and then
> scrape. But first we need to build caching or something so we can get past the authentication step at
> log in. Follow the standing rules and never guess, never assume. I want you to test this feature set
> more heavily than the last rounds testing. Test it, test the tests. Go above and beyond for me please.
> Thank you!

### 0.1 Owner's follow-up #1 (verbatim, 2026-10-12)

> Please continue. I appreciate you going slow to find all the ways this could break anything, think of all
> the ways this needs to be integrated in a way that makes the import process as simple as possible to move
> them from Cultivera where they have very dirty data to our system that intakes very clean data. So being
> able to match our cleanliness with the Cultivera import is very important. And it shouldn't mess up
> accounting, or vendor pay, or things of that nature. The process of moving them through our intake
> pipeline is to enrich them and get them into our kb in a way that they can be reused in the future. I
> don't want to just wait for a year or two to go by hoping that time will fix this issue. The pos import
> used to make one big manifest essentially, but I want to break it up into there existing manifests when
> they came in. Since we are building a crawler that will take the coa, maybe we use it to scrape every bit
> of data and document every single action it took to get them. The record and catalog all the data, so we
> have everything we need to get them into our pipeline so we can turn them into the beautiful products we
> create. I am fine with scraping the hell out of Cultivera. They are a terrible company, they refuse to
> give us our data we own, so let's just take it, and use it intelligently so we can import them into our
> system properly. Please keep going above and beyond for me as you have been doing for me. Keep researching
> the internet for enterprise grade solutions to use and implement. Follow the standing rules and never
> guess, never assume. Test it, test the tests. Add as much additional value in as you can. Think of
> everything important. Thank you!

### 0.2 Owner's follow-up #2 (verbatim except the credentials, 2026-10-12)

> I know I'm not suppose to give you log in info, but I won't be using Cultivera in a few weeks, so I want
> you to log in to my portal, and recon the portal, find the products and inventory tables, and then map
> everything, map and document everything relevant and important to this task. Let's take it all. My user
> name is, [REDACTED], password, [REDACTED]
> Please continue. Thank you.

**Credential handling (this repo is PUBLIC):** the username and password are NEVER written to the repo, a
commit, a doc, a log line or a test. During recon they lived only in a mode-600 file outside the repo, and the
session token likewise. The action log records URLs, bodies, status and byte counts, but never the token. On
Railway they go in env vars (§S8). **The owner should change the Cultivera password once the harvest is done**,
because it was shared in a chat transcript.


### 0.3 Owner's follow-up #3 (verbatim, 2026-10-13)

> Please continue. I want to reiterate that we need to scape everything from Cultivera, json, manifest, coa,
> inventory, products, etc. the purpose of sending all the re created manifests through our onboarding process
> onward is to be able to run Gemini on them, assign facts automatically, read the manifests and coas for all
> their data, convert the name to our conventions, convert their type and category to our systems versions as
> best you can. Map everything you can for me. I'll go through one manifest at a time and validate everything
> before pushing it to enrichment. I want to lean heavily on the kb, and make certain these products go into the
> kb in a way we can re use them. I want these products to be treated like we received them. Everything should
> be attached at onboarding as we can using all of the Cultivera data we can use to automate the process. This
> includes mastering. We have an awesome mastering system, I want it to be used effectively here too. Again,
> nothing blocks it from the menu and sales while we onboard them. So we need a way to track which manifests
> we're Cultivera's. And a way to make the process not overloaded with manifests. It should be organized very
> well to make the process easier. Follow the standing rules and never guess, never assume. Keep going above and
> beyond for me. Keep researching the internet for enterprise grade solutions to use and implement. Commit work
> often, the sandbox is very unstable. Please protect the work as best as possible. Test it, test the tests.
> Thank you!

### 0.4 Owner's follow-up #4 (verbatim, 2026-10-13)

> Please continue building this enhanced and far superior pipeline for transferring all Cultivera data to our
> system. The plan is to scrape everything, document and record everything, make certain that every manifest
> created by the migration behaves like it was received by us. I need to be able to onboard the manifests and
> utilize every tool we built for receiving products. We need to make certain that every product gets enriched
> the same way our intake process does it. The system needs to catalog the products in the exact same way,
> master them the same, the inventory page should show them as being the same with the exception of having a
> flag set to them saying they were received by Cultivera. Their inventory detail page should be identical to
> ones we received. The products should be attached to the vendors the same way, and show up on the menu in the
> same way. The point is for these products to be completely rebuilt by our superior system so they can be
> displayed on the menu without shame or disappointment about them being inaccurate and full of garbage data.
> The only difference about these recreated manifests is they can be sold while they are still being onboarded.
> Keep going above and beyond as you have been doing for me, it's working. Keep researching the internet for
> enterprise grade solutions to use and implement. I need you to keep looking for enterprise grade migration
> solutions, expert and professional solutions that are well established and widely used. We shouldn't reinvent
> the wheel, just improve upon it. Follow the standing rules and never guess, never assume. Test it, test the
> tests. Thank you!

### 0.5 Owner's follow-up #5 (verbatim, 2026-10-13)

> Thank you! Really great work so far, keep it up! Please continue building this fantastic new pipeline for the
> Cultivera migration. There are two things I’d like to add to the list, the first is to add an option to the
> receiving pages table that lets me see all the Cultivera manifests in there, I can open the manifest like ones
> we intake. It should have a completed not complete status so I can see which ones are still in need of
> attention. The receiving table should also have better filters and sorting so I can organize the list however
> I need. The second addition is to completely revamp the menu import page, all of the helpers need to be
> updated completely to help with the new process. Any links or buttons or help text and such should be
> modified, updated, and significantly enhanced to make it easy to read and follow the steps. There will be
> several items that we end up migrating to our system that we know are broken and the system won’t like. The
> LCB examiners office has given me the green light to clean up my CCRS account so all the dead broken non
> existent products we migrate will end up immediately being flagged to be removed from CCRS. So I’m not too
> worried about the broken garbage, I just want the system to know, when we migrate, it’s going to be intaking
> some garbage, and I want the system to recognize this and help me remove them from the system when I comes
> time to do our first CCRS upload. Other than that, keep going above and beyond for me as you have been doing,
> it’s working! Keep researching the internet for enterprise grade migration solutions to use and implement.
> Follow the standing rules and never guess, never assume. Commit work often, the sand box is very unstable. We
> must protect the work at all costs. Test it, test the tests. Thank you!

### 0.6 Owner's follow-up #6 (verbatim, 2026-10-13): the October 30 wall-to-wall count

> awesome, thank you! I want to add one more thing to the list. my plan is to count my inventory on october
> 30th, scanning every single item into a spreadsheet. I need a very intelligent way to set up my excel
> spreadsheet so that I can scan every product, I have about 8 or so computers with 8 or so scanners and 8 or so
> helpers. so this solution has to be something all 8 or so of us can work on simultaneously. once we have
> scanned every product, I will upload the results into our system on the menu import page. the system will then
> take those counts, and update all of the lots we intake from cultivera with the accurate ones. again, that will
> mean keeping track of everything for the ccrs cleanup upload. I feel like this is the best way to start the
> system out in absolute accuracy. I need your help to research the best, most expert professional, enterprise
> grade method and solutions for managing this. it needs to be super simple and quick. so please create for us
> the perfect process for all 8 of so of my helpers can accomplish this in the most efficient and effective way
> possible. complete another round of building, stop when you feel you should stop and report back with a summary
> report of whats been built, and what still left to build. please keep going above and beyond for me, you are
> doing great. follow the standing rules and never guess, never assume. test it, test the tests. thank you.

Clarification (verbatim, same day):

> sorry to stop you. I just wanted to clarify, this count and process is meant for the cultivera upload
> migration. I do want you to reuse any code and logic already built established and tested relating to the
> cycle counts and inventory audit systems to be used if it can be. I just wanted you to know that was my
> intention for the inventory audit being done right before cutover is meant to help the cultivera upload
> process. please continue. thank you

Clarification #2 (verbatim, same day; this **replaces** the scope above):

> Sorry to stop you. I decided, to make this simpler, all I want you to do is build a super intelligent excel
> spreadsheet, something with advanced logic and formulas and such. I want to connect the scanner to a computer,
> download and open the spreadsheet on the computer, point scan, rapid fire. We have Tera and socket scanners. At
> the end, I will upload the 8-9 spreadsheets, one from each of us counters. Since this upload happens on the
> 30th, I need the web crawler to scrape October 31st sales and cogs and other sales data to then reconcile the
> October 30th count we did. All I want to have to do is, download the spreadsheet, scan, upload the spreadsheet.
> The system takes care of the rest. The barcode is the products lot#. Please build it in this way. Make sure the
> spreadsheet is smart, intelligent, easy to use. Enterprise grade spreadsheet. Plead continue. Thank you.

Clarification #3 (verbatim, same day):

> I feel like I keep needing to stop you because you aren't figuring this out. Stop drifting. We are talking
> about the Cultivera menu upload. The sales I'm talking about obviously come from Cultivera. Our system has no
> idea what's going on in Cultivera until the web crawler logs into my Cultivera back office and scrapes the data
> to use. We are building a Cultivera menu upload pipeline. Please stop drifting! Please continue.

Clarification #4 (verbatim, 2026-10-13):

> Sorry to stop you. I don't need you over thinking the sales interfering counts. We will count the back stock
> inventory while we are open, no pulling inventory during this period, so nothing leaves the back inventory stock
> room on the 30th. We will have the back stock room counted before 6pm. We will close early at 6pm and then proceed
> to count the front sales floor. There will be no offsetting needed or logic regarding that. There will be no
> collisions between counts and sales. We only need to reconcile for the sales done on the 31st. Also to help you
> find where the sales data is on Cultivera's back office, the url for it is, wa.cultivera.com/cbo/#/rpt/sales-details.
> The url for finding the COAs is wa.cultivera.com/cbo/#/inv/incoming-transfers/inbound transfer id goes here/detail.
> The "inbound transfer id" is just a number, no spaces or other characters. The products can be found at,
> wa.cultivera.com/cbo/#/inv/products, and inventories at, wa.cultivera.com/cbo/#/inv/inventorie, So please record
> those URLs for the crawler. Then continue with building without worrying about adjusting quantity while selling.
> I will make it as simple as possible to avoid accidents. I want pristine data and absolute accuracy. Follow the
> standing rules and never guess, never assume. Push work often, the sandbox is very unstable. Protect it at all costs.

What this decides (S11): the count is final when the floor count ends on 10/30 (back stock is frozen while it is
counted; the floor is counted after the 6 pm close). The ONLY roll-forward is Cultivera's 10/31 sales: rolled =
counted − net sold on 10/31. No during-count or in-flight logic.

The owner's back-office pages → the read-only data calls the crawler makes for them (measured in
`cbo-app.bundle.js`, 2026-10-13: route → controller → service → endpoint). DNS note, measured the same day: the
host `wa.cultivera.com` does not resolve from the sandbox; the back office answers at `https://wa.cultiverapos.com/cbo/`
(the same app; its data host is `api-wa.cultiverapos.com`). The owner's paths are recorded exactly as given:

| Owner's page (`#/` route) | Route in the bundle | Controller | Data call the crawler makes (stage) |
|---|---|---|---|
| `cbo/#/rpt/sales-details` | `/rpt/sales-details/:dateFrom?/:dateTo?/:inventoryTypeId?/:categoryId?` | `salesDailyDetailsController` | POST `data-api/reports/daily-sales-detail` (grid) + POST `data-api/reports/sales-details-summary` (totals) — stage `sales` |
| `cbo/#/inv/incoming-transfers/<id>/detail` (id = digits only) | `/inv/incoming-transfers/:incomingId/detail` | `incomingDetailController` | GET `data-api/transfers/incoming/<id>/detail` (stage `transfer_details`) + POST `data-api/transfers/incoming-load-wcia-json` `{Url: JsonFile}` (stage `wcia_json`, the COA/lab file) |
| `cbo/#/inv/products` | `/inv/products` | `productsController` | POST `data-api/products/export-products` (stage `export_products`) |
| `cbo/#/inv/inventorie[s]` | `/inv/inventories/:inboundTransferId?` | `inventoriesController` | POST `data-api/inventories/export-inventories-to-excel` (stage `export_inventories`) + POST `data-api/inventories` (stage `inventory_list`) |

---

## 1. Measured facts (recon, read-only; every number counted, none inferred)

### 1.1 The real export (`normalized_cultivera/INVENTORIES_NORMALIZED.xlsx`, sheet `Inventories`)

| Fact | Value |
|---|---|
| Data rows | 4,346 |
| Distinct barcodes | 4,256 (81 barcodes appear on >1 row) |
| Rows with a `Received date` | 4,076 |
| Rows with a blank `Received date` | 270, across 53 vendors |
| Rows with a blank `Vendor` | 0 |
| `Received date` cell format | text `YYYY-MM-DD HH:MM:SS.ffffff` (4,061 rows) or `YYYY-MM-DD HH:MM:SS` (15 rows) |
| Hour-of-day range | 07:00–22:59 only (consistent with store wall clock, i.e. Pacific; never 00:00–06:59) |
| Distinct exact timestamps | 2,209; **no timestamp is shared by two vendors** |
| Different-vendor rows within 5 s of each other | 0 |

Within one vendor, consecutive dated rows are separated by: 0 s ×1,867; <1 s ×1,508; <10 s ×1; <1 min ×27;
<10 min ×17; <1 h ×5; <1 day ×1; ≥1 day ×543. **A receive session is a burst of millisecond-spaced rows,
but some deliveries were keyed in item by item over many minutes** (example: I502 Distro 2024-10-02, gaps of
16–3,582 s).

Groups produced by "same vendor AND same Pacific day AND gap ≤ G minutes":

| G | Groups | Singletons | Largest |
|---|---|---|---|
| 10 | 656 | 138 | 71 |
| 30 | 654 | 138 | 71 |
| **60 (default)** | **651** | 137 | 71 |
| 120 | 651 | 137 | 71 |
| 240 | 651 | 137 | 71 |

> **Correction (S1, measured through the executor's own path, `tests/compliance/r50-cultivera-manifest-groups.test.ts`):**
> the table above counted ROWS. Grouping runs on LOTS (one per barcode, earliest row's date, first row's vendor -
> exactly `planImportLots`). Per lot: **4,256 lots; 3,987 timed; 269 undated across 53 vendors (270 rows - one
> undated barcode has two rows); 124 vendors; sessions at G = 10/30/60/120/240 min = 654/652/649/649/649;
> singletons 138/138/137/137/137; largest 71 (TTL HOLDINGS LLC 2026-06-26 08:23).** Total manifests at the default
> = 649 sessions + 53 undated = **702**. No barcode's rows disagree on vendor; no barcode mixes dated and undated rows.

Only ONE same-day pair is more than 60 min apart (AGRO COUTURE 2025-07-09 11:45 → 20:33): two deliveries on
one day, correctly split. The result is stable from 60 min upward, so 60 is the default and it is configurable.

### 1.2 What the live import keeps (verified in code)

* `transformWorkbooks` reads with `cellDates:false, raw:false`; SheetJS returns the cell's text verbatim
  (`"2026-07-02 09:32:07.787000"`, probed with the repo's own `xlsx`).
* **FIXED in S1:** `parseUsDate` now delegates unknown shapes to the shared R50 parser, so the export's
  timestamps (and SheetJS date-cell texts `7/2/26`, `7/2/26 9:32`) give the Pacific day. Probed through
  `transformWorkbooks → planImportLots` on the real export: 0 of 4,256 lots had a `receivedOn` before, 3,987 after.
  The existing fill-only "fill lot facts" backfill (`fillImportLotFacts`, `received_on IS NULL` guard) can now
  date the live lots without overwriting anything.
* (Pre-S1 finding) **`parseUsDate` accepts only `M/D/YYYY` or `YYYY-MM-DD`, so it returns `null` for this timestamp format**
  (probed: `"2026-07-02 09:32:07.787000" → null`). The live import only got dates because the export it
  stored used a format that parser accepts. Never assume which format is stored: the R50 parser accepts all
  three shapes and reports the ones it cannot read.
* The raw workbooks are kept in the private `pos-raw` bucket (`pos_imports.inventories_storage_key`), and
  `createImportLots` / `fillImportLotFacts` already re-read them. R50 re-reads the SAME stored file; there is
  no new upload.
* Every import lot hangs off ONE synthetic manifest `POS-IMPORT-<id8>` (`raw_payload.kind =
  "pos-import-migration"`). Lots are matched back to rows by `ccrs_inventory_external_id` = Barcode.
* A barcode on several rows becomes ONE lot carrying the **earliest** received date
  (`planImportLots`). R50 groups that lot by the same earliest row, so the lot and its manifest agree.

### 1.3 Who reads `POS-IMPORT-<id8>` by number (all must keep working after lots move)

`received-date-bulk-store.ts`, `legacy-lot-removal-store.ts`, `import-service.ts` (backfill count),
`classification-worklist-store.ts` (source filter), `enrichment-manifest-core.ts` (the "Cultivera import"
pseudo-manifest), and migration 0244 (excludes import manifests from the intake backfill).

**Done in S2b (2026-10-12).** All five TypeScript readers now find an import's lots by **import id**: the
`POS-IMPORT-<id8>` manifest (and, if the row records an import id, only when it is THIS import) plus every
migration manifest whose `raw_payload.import_id` is this import (`import-lineage-core.ts` +
`import-lineage-store.ts`). **Migration 0244 is NOT changed.** It is a one-time backfill (`received_on IS NULL`,
fill-only) that stamps the Pacific day of `accepted_at`, and it excludes only the POS-IMPORT manifest by number
and kind. Verified by grep on 2026-10-12: no code in `src` writes a `cultivera-reconstructed` manifest yet (only
readers and predicates). So 0244 can stamp a rebuilt manifest's lots ONLY if it is applied AFTER S2c runs.
**S2c precondition:** before Apply, confirm 0244 is already applied in production (Supabase migration history).
The executor also sets a rebuilt manifest's `accepted_at` only from the real transfer acceptance, never the run
instant, so even a late 0244 would stamp a true date.

### 1.3b What ~700 NEW accepted manifests would do to native screens (S2c research, 2026-10-12, by grep + schema)

Measured on PG15 with all 269 migrations: `inbound_manifests` has no CHECK on `status`; the only unique index
is `dedupe_key` (partial, not null); the only trigger on either table is `set_updated_at`. Moving a lot
(`inventory_lots.manifest_id`) therefore fires nothing but `updated_at`, and no code in `src` uses a lot's
`updated_at` as a change signal (grep: the single hit is a React form key on the lot page). The 23 files that
read `inbound_manifests` were reviewed. The ones a rebuilt manifest would change:

| Reader | What would happen | S2c rule |
|---|---|---|
| Receiving list `listManifests` (newest 200 by `created_at`) | ~700 rows created at the run instant push every native delivery off the page on 11/01 | **done (S2c)**: rebuilt manifests are left out of the Receiving work queue (null-safe kind filter); they are history, not work; the full intake export still includes them |
| Stage counts `countManifestsByStatus` | "Accepted" jumps by ~700 | **done (S2c)**: counted separately (`migrated`), shown as "Moved from Cultivera" |
| Dock-to-shelf metric (`received_at` → `accepted_at`, last 90 days) | rebuilt rows would add fake 0-minute dock times | **done (S2c)**: the rebuilt kind is excluded |
| Onboarding picker (accepted in last 30 days) | the recent rebuilt manifests appear | WANTED (S3 enrichment through the native flow); S3 adds the "Cultivera manifests" section |
| Payables, Sage, bill, receipt | money | already excluded (S2a) |
| Per-manifest readers (`.eq("id", …)`: PO link, KB bridge, goldminer, brand) | only when someone opens that manifest | unchanged |

**Dates on a rebuilt manifest (never guess):** real transfer → `accepted_at` = `received_at` = Cultivera's
`DateAccepted` (UTC), `transfer_date` = its `TransferDate` day. S1 session → the first lot's real Received
instant. S1 day-only → `transfer_date` = the day, instants left null (the time of day is unknown). Undated →
all null. `vendor_id` is set only when every lot on it carries the same vendor id and no lot came in through
the vendor-by-link alias; otherwise null (never invent or create a vendor).

### 1.4 Who reads ACCEPTED manifests (accounting risk)

`vendor-payables-store.ts` (owed = Σ received_qty × unit_cost), `sage-exports.ts` (purchases export),
`vendor-bill-service.ts` (record a bill). Opening inventory from the cut-over is booked through the
opening-balance builder (`cutover-inventory-core.ts`, DEFECTS D-50/D-51), **never as a purchase**. If
reconstructed manifests carried real vendor ids and looked like ordinary deliveries, Vendor Payables would
show money "owed" for stock that was paid for years ago. **R50 rule: reconstructed manifests are excluded from
payables, the Sage purchases export and vendor bills by one shared predicate.**

**Done in S2a (2026-10-12).** One pure predicate, `migration-stock-core.ts`. It covers BOTH migration kinds
(`pos-import-migration` and `cultivera-reconstructed`), because lots in the POS-IMPORT manifest were paid for
before the switch too. It is applied at four doors: payables, the Sage purchases export, the vendor bill **and
the goods receipt**. A receipt would capitalise the stock a second time on top of the opening balance.

### 1.5 Onboarding today

`planDraftSeeding` returns `match` (no draft) when the lot's key is already on the published menu. Every
Cultivera lot IS on the menu, so none of them ever reaches Onboarding. Approving a draft whose key is live is
harmless to the menu: the staging planner treats live keys as existing (`draft_superseded_by_pos`, the live
row wins). So a re-onboarding draft cannot create a duplicate card and cannot hide the live one.

### 1.5b S3 research: the native chain a Cultivera manifest reuses (2026-10-13, read in code + measured)

**What native finalize already does** (`intake-store.ts` finalize, after the lots activate):
1. `seedDraftsForManifest` (drafts; identity stamps; price floor + suggestion);
2. `archiveCoasForManifest` → `extractCoasForManifest` (the COA PDF and the WCIA lab JSON behind
   `lab_results.wcia_json_url`, read by `wcia-lab-json-core.ts`);
3. `promoteManifestToKb` (`lotToWritebackFacts`: name, key, brand, category, strain, size → KB drafts,
   non-destructive merge, confidence 0.95);
4. `linkKbProductsToDrafts` (lots + drafts → `kb_products` by the natural key);
5. `attachLabFactsToManifestDrafts` (terpenes, potency, cannabinoids, serving mg → `attached_facts`, source
   `coa`; flower terpenes taught to `kb_strains`, fill-only).

Approval (`approveDraftWithPrice`) then adds: the classification gates, the lot mirrors (classification provenance,
strain type), `attachOnApproval` (the `kb_products` golden record + `kb_product_id` links, fill-only), and the
onboarding memory that pre-fills the next delivery of the same product (`recallOnboardingPicks`). A finished
Cultivera manifest therefore teaches every later manifest and every later native delivery of the same product.

**Measured on the real export** (`scripts/recon/r50-s3-keys.ts`, through `transformWorkbooks → planImportLots`):
4,256 lots on 3,435 card keys (2,873 keys with one lot, 392 with 2, 116 with 3, the largest has 17); 562 keys
carry more than one product name (sizes); every lot has a strain name, brand, size and cost; 3,764 have a
THC/CBD figure; only **60** have a strain type; 0 carry minor cannabinoids. Of 5,385 menu items, 488 are visible.

**Why nothing reaches Onboarding today:** `planDraftSeeding` returns `match` for a key on the published menu,
and every Cultivera key is on it (hidden cards included: `publishedKeys` reads `menu_items` regardless of
`hidden`). The open-draft unique index is per key, so the onboarding unit is **one draft per card key**.

**Approval safety, verified line by line:**
* `buildDraftInjectionPlan` skips a live key (`draft_superseded_by_pos`) BEFORE `injection.items`, and
  `lotFactsByKey` is built only from `injection.items`, so a superseded draft writes no lot facts and no card.
* The one exposure: a key that is NOT on the published menu at approval time would be injected as a new card.
  **S3 rule:** staging skips a rebuilt manifest outright (`migration-manifest`), and a failed manifest read skips
  too (fail closed, the S19 doctrine). Approval of a rebuilt-manifest draft can never stage a menu version.
* Price: the 2× floor would refuse Cultivera-era prices, and a typed price could never reach the live card.
  **S3 rule:** on a rebuilt manifest the server records the live card's price (only when every variant of the
  card has the same price; otherwise null, never a guess), ignores the form's price and skips the floor. The
  live card's price, visibility and the lot's status, qty, cost and CCRS fields are never written.
* `mirrorIntakeFixToLive` (R27) stays the one door by which a reviewer's fact fix reaches a live card (facts
  only, never `hidden`).

**Fact assist sources, honest about what S3 can and cannot read:**

| Source | S3 | How |
|---|---|---|
| Lot row (name, brand, vendor, category, type, strain, strain type, size, cost, lot code) | yes | native seeding + identity stamp |
| Product name | yes | native resolvers: category heuristic, type labeler, strain-type name parse, volume |
| Cultivera THC/CBD (`pos_*` columns) | yes | `potency` attached fact, source `cultivera`: shown, never counted (fact-chips rule) |
| Live card price | yes | recorded on approval (above) |
| Onboarding memory + KB | yes | native recall + KB link: the second manifest of a product pre-fills from the first |
| Vendor WCIA transfer JSON / lab JSON | S6/S9 | 619 of 644 transfers name a `JsonFile`; the crawler does not download it yet. Once a lab result is linked, "Re-read lab certificates" runs the native read + attach |
| COA PDF | S6 | batch `ImagePath` |

### 1.5c S3b research: the vendors' own WCIA transfer files are in Cultivera (2026-10-13, measured)

**Found.** Every Cultivera transfer detail has `JsonFile` (a relative path such as `wa_pos/4355`) and
`HasJsonFile`. The back office shows it with "Show Json", which calls the READ-ONLY query endpoint
`POST data-api/transfers/incoming-load-wcia-json {Url: JsonFile}` (read in `cbo-app.bundle.js`,
`transferService.getWciaJson`). It returns `{JsonFile: "<the vendor's WCIA transfer document, as text>"}`.
This is the same document a vendor emails us on a native delivery, and the native parser
(`intake-parser.ts parseVendorJson`) reads it unchanged.

**Harvested** (owner's login, query host only, 0.6 s pace): 619 of 619 transfers that name a file, 620 calls
(1 login), 0 errors, about 12 minutes. The files are kept outside the repo.

| Measured | Value |
|---|---|
| Schema versions | 2.0.0 ×45, 2.1.0 ×365, 2.2.0 ×209 |
| Lines | 15,451. On **619 of 619** files the WCIA line set equals Cultivera's transfer line set (barcode = WCIA `inventory_id`) |
| Lines with lab data / COA PDF / lab JSON | 15,429 / 15,224 / 13,226 |
| Distinct lab result ids / COA PDFs / lab JSONs | 8,400 / 8,580 / 7,564 |
| Lab results marked failed | 1 |
| Potency entries | thc, thca, cbd, cbda, total-cannabinoids on almost every line; `total-thc`/`total-cbd` on 7,175; minor cannabinoids (cbg, cbn, cbc, cbdv, thcv, cbga) and 52 named terpenes on 105 / 58 lines; heavy metals on 299 |
| Also on the line | `strain_name` 15,370; `unit_weight` + uom; `serving_weight` 6,784; `product_sku` 5,862; `sample_collection_date` 5,205; `is_medical`, `is_sample`, `inventory_type` |
| **Export lots (r2a) with a WCIA line** | **3,388 of 3,762**. Of those, 3,369 have lab data, 3,271 a COA PDF and 2,809 a lab JSON |
| …whose COA or lab JSON is on a built-in COA host | 2,564 (COA 2,398, JSON 2,271). The rest are on 4 other lab hosts (growflow, googleapis, openthc, treeline) that the owner can allow in Testing labs (R36) |
| Barcodes on more than one WCIA file | 385 (re-deliveries, §1.9) |

**Join (measured, not assumed).** A rebuilt manifest carries `raw_payload.cultivera_transfer_id`. Its lots
carry `lot_code` = Cultivera Barcode = WCIA `inventory_id` (probed on the harness: `lot_code` equals
`ccrs_inventory_external_id` for import lots). So each lot gets **the line of its own transfer**, never a
same-barcode line from a re-delivery.

**What S3b does with it (the native shape, nothing new):**
1. The crawler gains a `wcia_json` stage. It runs only for transfers a live lot references, is resumable
   per id and pinned to the same guards. The importer persists one file per rebuilt manifest's transfer next
   to the plan inputs (`pos-raw/rehome/<import>/wcia/<transferId>.json`, private bucket).
2. **Start** first runs "attach the vendor's lab results". It parses the stored WCIA document with the
   native parser, builds `lab_results` rows exactly as native intake does (`source "wcia-transfer"`,
   potency, COA URL, release/expiry, `wcia_json_url`, deduped by lab id), and **fills `lab_result_id` only
   where it is empty**. That is the guarded compare-and-set of `linkLotLabResult` (S37: never replaces a COA,
   never on a destroyed lot). It writes no other lot column.
3. Then the existing chain runs unchanged: seeding carries the lab potency onto the draft; COA archive →
   LlamaParse/WCIA-JSON extract; lab facts (terpenes, cannabinoids, serving mg) → `attached_facts`; flower
   terpenes → `kb_strains` (fill-only); KB promote + link; and on approval the golden record and the
   onboarding memory.
4. **Sellable stays sellable (verified in code):** lab pass/fail is read only by native finalize/activation
   of a delivery that is not yet accepted (`finalize-label-core`, `lot-activation-gate-core`). A live lot's
   `status` is never derived from it, and the menu never reads `lab_results.passed`. The inventory table
   will show the COA ✅ and lab, which is now true.

### 1.5d S3c research: parity with a received manifest (2026-10-13, read in code; owner follow-up #4)

**Practice we follow (not invented here).** Migration validation guides describe three layers:
1. record and field checks;
2. business-rule parity, where the target is compared against a known-good baseline;
3. an exception report, where every difference is resolved or explicitly accepted
   ([dbSeer, "Data Migration Validation"](https://dbseer.com/blog/data-migration-validation-how-to-prove-accuracy-completeness-and-parity)).

MDM golden records are assembled by **field-level survivorship**: the most trusted *non-null* source wins per
field, and the record keeps its lineage (Informatica / Reltio / Profisee survivorship rules). We already run
both ideas:
- the golden-record and attach-facts cores apply survivorship;
- `migration-stock-core` and `import-lineage-core` carry lineage.

S3c applies them to the one place they were missing.

**Parity audit: every surface a received product reaches, and what a rebuilt one gets.**

| Surface | Received manifest | Rebuilt manifest before S3c |
|---|---|---|
| Lots, vendor, cost, CCRS | finalize | same rows (imported); rebuilt manifest carries the shared vendor id |
| Drafts, identity stamp, KB promote, KB link, COA read, lab facts, vendor lab JSON | finalize | same chain (S3 Start, S3b step 0b) |
| Gemini lookup, fact chips, attach, classification gates, onboarding memory, `attachOnApproval` golden record | Onboarding / approval | same code, same gates |
| **Menu card** (name, category, type, strain, potency, mg facts, compliance flags, description, effects) | approval stages and publishes a card built by `buildDraftInjectionPlan` (+ mastering name) | **never**: staging is skipped (`migration-manifest`), so the live card keeps Cultivera's data. **This is the gap.** |
| Lot golden-record facts (servings, mg, net measure, minors) | written by staging (`lotFactsByKey`) | never (same skip) |
| Fact review hold / withhold | staging | never (same skip) |
| Inventory list / lot detail | native | identical rows; **no "received via Cultivera" flag** (only the old "From the one-time Cultivera import" callout on detail) |
| Intake list, dock-to-shelf, payables, Sage, bills, receipts | native | excluded on purpose (history, not work; accounting-inert, §1.4). Kept. |

**S3c design: "refresh, never inject".** A rebuilt manifest's approved drafts go through the SAME staging
pipeline (carry-forward completeness, fact flags, saved fact decisions, withhold, lot facts, KB links,
auto-publish). Only the plan step differs. `planRebuiltCardRefresh` (pure) builds each approved draft's card
with the native `buildDraftInjectionPlan`. For a key that is on the live menu, it then applies field-level
survivorship onto the carried live card.

* **Catalogue fields our pipeline decides** take our value when it has one:
  - name (`intakeDisplayName`, as mastering names a new card), product name, brand, vendor;
  - category and filter categories, inventory type and type label;
  - strain type and strain name;
  - description (only a non-placeholder one replaces it); effects and aroma.
* **Facts:** a non-null value from our pipeline wins (potency display and JSON, compounds, mg facts, net measures,
  the four compliance flags). A null never wipes a live value, because null means "not verified" (S12 rule).
  Provenance is merged.
* **Never touched:** source key, price, price label, variants (ids, prices, levels, medical), hidden and
  hidden reason, stock status, sort order. *Sellable stays sellable.*
* **No new cards.** A key not on the live menu is reported and never injected. Rebuilt cards are never merged
  into other cards (no mastering merges on migration stock).
* **Fact flags** work as on a received delivery: an unanswered flag withholds the REFRESH for that product.
  The live card keeps selling unchanged, because a withheld refresh is simply not applied.
* **Fail closed.** An unreadable manifest kind still builds nothing. `CULTIVERA_CARD_REFRESH=off` restores the
  S3 behaviour (approval catalogues only).
* **Approval:** a rebuilt draft no longer skips staging. The price stays the live one (S3 rule), never typed.

### 1.6 Cultivera POS back office (from the PUBLIC client code only; no login was attempted)

Sources: `https://wa.cultiverapos.com/scripts/app.bundle.js`, `/scripts/cbo-app.bundle.js`,
`/scripts/cboath.bundle.js`, `/scripts/partials.min.js` (Angular templates), plus support articles
`support.cultivera.com/article/qqtwmxvf51-inventory-qa-coa` and `.../u64nq7di3f-inventory-management-batch-details`.

| Thing | Evidence |
|---|---|
| API roots | `apiUrl = https://api-wa.cultiverapos.com/api/`, `queryUrl = https://api-wa.cultiverapos.com/data-api/` |
| Login | `POST apiUrl + "auth/login"` body `{username, password}` (signInController `vm.cred`); response `data.Token` |
| Auth on every call | `Authorization: Bearer <Token>` plus `x-aloc`, `x-tmz`, `x-def-aloc`, `x-def-tmz` from localStorage `active-location` / `default-location` (`{Id, TimeZone}`); locations come from `POST queryUrl + lookup/inventory/extended-locations` (`IsDefault` marks the default) |
| Inventory list | `POST queryUrl + "inventories"`, body = filter `{Barcode, ProductIds, CategoryIds, StorageIds, VendorIds, DisplayIds, BrandIds, InboundTransferId}` + kendo paging; response `{Data, Count}`; rows carry `Id, Barcode, Alias, BatchId, ProductName, VendorId, VendorName, ...` |
| Batch detail | `GET queryUrl + "inventories/inventory-batch/{BatchId}"`; template fields `Barcode, BatchNumber, ProductName, VendorName, ReceivedDate, TransferId, TransferNumber, Lab, LabId, HasQaResult, HasCoaDocument, ImagePath, Thc, Thca, Cbd, Cbda, Total, TerpeneTotal, TestingDate, HarvestDate, PackagedDate, IsCannabis` |
| **The COA link** | `<a href="{{vm.batch.ImagePath}}">COA Document</a>` shown when `HasCoaDocument && IsCannabis` |
| Real manifests | `POST queryUrl + "transfers/incoming"` `{Number, VendorIds, StatusIds, DateFrom, DateTo, Skip, Take, Sort, HasSortInfo}` → `{Data, Count}` (`Id, TransferNumber, TransferDate, VendorId, Status, StatusDisplay`); `GET queryUrl + "transfers/incoming/{id}/detail"` (`TransferNumber, TransferDate, FromVendor, Details[] with Barcode, ProductName, Quantity, UnitPrice`) |

Real COA fixtures (35, `tests/fixtures/coa-cultivera/`): the PDF's printed **Batch ID** equals the WCIA
`sample.id` and the number in `COA_<n>.pdf` on 33 of 35 (cv10 and cv29 differ, so the file name is NOT
trusted). That batch id is the vendor's inventory id, the same family of 16–17 digit numbers as our
Barcodes, but 0 of 35 fixtures equal a current Barcode (they are older batches). **So the harvest manifest
(Cultivera's own Barcode → COA link) is the authoritative marriage key; the PDF's own Batch ID is a
cross-check; a name match is only ever a suggestion.**

### 1.8 The live back office, logged in (read-only harvest, 2026-10-12)

The owner's own login (§0.2) was used, at a human pace (≥ 0.6 s between calls), against the **query** host
only (`https://api-wa.cultiverapos.com/data-api/`). The harvester refuses any other host or method: it never
calls the write API except for the one `auth/login`. Every call is in an action log (method, URL, body, status,
bytes, time; never the token). During the harvest it recorded 3,886 actions: 3,858 × 200, 7 × 500 (probes
of endpoints that need a filter) and 1 × 400.

| Table (endpoint) | Rows (server `Count` = rows saved) | What it gives us |
|---|---|---|
| `inventories` | 3,908 | Live lots: `Barcode`, `Alias` (070R… CCRS id), `BatchId`, `ProductId`, `VendorId`, **`IncomingTransferId`** (3,755 of 3,908), units, potency, `QaResultId` |
| `inventories/depleted-inventories` | 25,231 | Every sold-out barcode with product + potency (product history for the KB) |
| `inventories/inventory-batch/{BatchId}` | one per batch, 3,875 | `TransferId`, `TransferNumber`, `ReceivedDate`, `AcceptedDate`, `Lab`, `HasCoaDocument`, **`ImagePath` = the COA PDF URL**, `BatchNumber`, harvest / packaged / testing dates |
| `transfers/incoming` | 1,164 | **The real manifests**: `TransferNumber`, `TransferDate`, `VendorId`, `Status` |
| `transfers/incoming/{id}/detail` | 1,164 of 1,164 | Header (`FromVendor`, `DateAccepted` UTC, `IsManualCreated`, `JsonFile` = the vendor's WCIA file) + 26,095 lines (`Barcode`, `Quantity`, `AcceptedQuantity`, `AcceptedBarcode`, `ProductName`, `IsSample`) |
| `products/master-products` | 17,268 | Cultivera's product catalogue: name, brand, variants, image |
| `vendors` | 1,786 | Licence no., trade name / DBA, addresses, `LastDateAccepted` |
| `brands` | 436 | Brand → vendor |
| `products/strains` | 4,792 | Strain names |
| `products/categories` | 21 | Categories |
| `reports/inbound-transfers` | 103 | Per-transfer sales / profit report (recent transfers only) |
| `samples` | 50 of 282 | The server returns the first 50 whatever the paging, sort or filter body (tried 4 paging shapes and 10 sort fields). Recorded as a known gap; employee samples are not needed for manifests. |

**Join keys (measured, not assumed).** The export's `Barcode` equals a transfer line's `Barcode` for 3,987 of
4,256 lots. `AcceptedBarcode` is a different id family (068R…/070R…) and matches no export Barcode or Alias
(0 hits), so it is never used. The live `IncomingTransferId` and the batch's `TransferId` never disagree
(0 conflicts). Vendor labels: the export's `Vendor` equals the transfer's `FromVendor` on every married lot
(3,987 / 3,987).

**Time zones (measured).** `DateAccepted` is UTC with a `Z`. The export's `Received date` is Pacific wall time.
Read that way, no single-receipt lot was received after its transfer was accepted (0 of 3,755 rows); the gap
is 0–197 h, median 1.06 h. Read as Pacific instead, every lot would be received 7–57 h *before*, which is
impossible. So the UTC reading is correct.

**Kept OUT of the public repo:** prices, totals, addresses, employee names, the WCIA file paths, the
credentials and the token. The `normalized_cultivera/TRANSFERS_INDEX.json` to be committed (1.2 MB when first built; see the §4 reset entry) keeps only
id, number, vendor, vendor no., transfer date, accepted instant, status, manual / internal flags and the lines'
`[barcode, acceptedQuantity, quantity, isSample]`. A test fails if a banned field name appears in it.
`scripts/cultivera/build-transfer-index.py` rebuilds it from a harvest. The file records its source's SHA-256.

### 1.9 The real manifests, matched (S1b)

A **receipt** of a lot is a transfer line with its barcode and `AcceptedQuantity > 0`, on an accepted
transfer. 257 export barcodes appear on two or more transfers. That happens because the same CCRS barcode is
re-delivered (for example, Grow Op Farms' `WA413287.INUN16` is on 8 transfers between April and November 2025).

| Evidence | Lots | Rule |
|---|---|---|
| Only one receipt | 3,738 | That transfer |
| Several receipts | 249 | The first receipt accepted at or after the lot's earliest Received time (−60 s tolerance) |
| No receipt | 269 | Back to S1. These are exactly the 269 lots with a blank Received date. 152 are live with no transfer id and 117 are depleted. |
| Ambiguous / vendor mismatch | 0 | Refused and sent to S1 (rule exists; real count 0) |

The result is that **3,987 lots go onto 651 real manifests** (640 Accepted, 11 Partially Accepted), each carrying
the vendor's real manifest number. The 269 undated lots go to S1's 53 per-vendor "date unknown" manifests.
Every lot ends up on exactly one manifest.

**Cross-checks:**
- On the 183 lots where both methods can answer, S1's same-session consensus agreed with the forward rule
  183 / 183 times.
- An independent Python implementation (reading Cultivera's raw JSON) and the TS core produce the same
  per-lot answer, verified with a SHA-256 of `barcode=transferId` (pinned in vitest once the index is rebuilt).
- 647 of S1's 649 time sessions are exactly one real transfer, and no real transfer is ever split across two
  sessions. The 2 mixed sessions are two genuine manifests from the same vendor, received seconds apart:
  EDGEMONT 2026-03-31 (transfers 883 + 884, 13 s apart) and GROW OP FARMS 2025-11-26 (682 + 683, 97 s apart).
  Time alone cannot separate those; the transfer index can.

**Why the earlier "live IncomingTransferId" is NOT the authority for re-delivered barcodes.** On 37 lots it
points at a LATER re-delivery, after the export's Received date (e.g. received 2026-07-02, but
IncomingTransferId = transfer 1109, accepted 2026-08-20). Cultivera overwrites it with the latest receipt.
The forward rule is the one consistent with the export.

**Number collisions with live intake.** Real numbers are unique across all 1,164 transfers. The rebuilt
manifest's `dedupe_key` is `<NUMBER>|<VENDOR>|IMPORT-<importId>`, so it can never take the unique slot of a
live intake key (`<NUMBER>|<VENDOR>`). If someone later re-uploads the same historic WCIA file,
`findBlockingDuplicate` (which matches on number + vendor + live status) still correctly flags it as already
received.

### 1.7 Social

The current connector is Meta Graph Business Discovery (`crawler/app/social.py`), which needs a Page token.
The owner says that method will not work. **Honest risk, stated before building:** Instagram's and Meta's
Terms of Use forbid collecting content by automated means without permission, and Meta actively detects
automated logins. The account used can be challenged, rate-limited or disabled. R50 builds the
owner-requested logged-in reader with the safest shape: the owner logs in by hand ONCE (2FA included) in a
real browser on their own computer; only the resulting session (Playwright `storageState`) is cached; reads are
slow, low volume and read-only; and the reader stops at the first login wall or checkpoint instead of retrying.
Use a dedicated business account, not a personal one.

---

## 2. Rules for this round (binding)

1. **Sellable stays sellable.** Nothing in R50 changes a lot's status, quantity, cost, CCRS fields or a menu
   card's visibility. Re-homing a lot changes only `inventory_lots.manifest_id`.
2. **Never guess a date.** Timestamp parse failures, out-of-window dates and blank cells go to the vendor's
   "undated" manifest, never to a neighbour's.
3. **Never merge vendors.** Different vendor ⇒ different manifest, always.
4. **Idempotent.** Re-running reconstruction creates nothing new and moves nothing already moved. A lot is
   moved only while it still sits on the import's `POS-IMPORT` manifest.
5. **Lineage.** Every reconstructed manifest records the import id, the source manifest, the group key, the
   rows and the rule (gap minutes) that formed it, and gets a timeline event.
6. **Accounting-inert.** Reconstructed manifests never count as purchases or payables (§1.4).
7. **COA marriage is evidence-ranked.** Harvest manifest barcode (exact) > PDF Batch ID = lot barcode
   (exact) > name/strain/vendor similarity (SUGGESTION ONLY, a human confirms). Drafts-only.
8. **Rule 11.** The intake suggestion runs in RECEIVING, reusing the shared identity and brand cores; the
   Cultivera side only provides history.
9. Standing rules: pure `*-core.ts` with self-tests in the runner, vitest pins, mutation testing, gate,
   rebase-merge, production verified.

---

## 3. Slices

| Slice | What | Done when |
|---|---|---|
| **S1** | `cultivera-manifest-group-core.ts`: timestamp parser (ISO date-time ± fraction, ISO date, US date ± time, Pacific), per-vendor sessions (same Pacific day + gap ≤ G), day-only groups, undated bucket, earliest-row-per-barcode, stable group keys + manifest numbers; `isReconstructedManifest` / `isMigrationManifest` predicates; lineage | self-tests + vitest on the REAL export reproduce the corrected §1.1 numbers (649 / 137 / 71 / 269 lots / 53 vendors) |
| **S1b** | `cultivera-transfer-match-core.ts`: marry lots to the REAL transfers (§1.9) from the committed `TRANSFERS_INDEX.json`; S1 only for what no transfer claims | real-data pins + oracle SHA + mutants |
| **S2** | Reconstruct executor (re-read stored workbook → **S1b plan (real transfers first, S1 fallback)** → create manifests idempotently → move lots guarded on source manifest → events + audit); Menu Imports panel: preview (counts, biggest, examples, gap choice) + Apply; every `POS-IMPORT` reader follows the lots (§1.3); accounting exclusion (§1.4) | tests; reruns are no-ops |
| **S3** | Onboarding for reconstructed manifests (§1.5b): `reonboard` seeding (one draft per card key, flagged "already on the menu", skips keys already onboarded); a "Cultivera manifests" section on Product Onboarding with Start per manifest, which runs the native chain (drafts → COA read → KB promote → KB link → lab facts → Cultivera potency fact); staging skips rebuilt manifests; approval records the live price and never touches the live card | planner + fact + price self-tests; vitest over the shared fake; real-DB probe; mutants |
| **S4** | Intake suggestion: on a receiving line, "Looks like Cultivera product X" from the imported history (same vendor via the shared vendor/brand keys, token similarity on the product family + size), shown as a suggestion with evidence, never applied automatically | pure scorer tests incl. real naming variants |
| **S5** | Crawler: Cultivera POS back-office login (cached token with JWT exp, 401 re-login, human pace), harvester: inventories → batches → COA PDFs into a folder + `harvest.json`/`harvest.csv` (barcode, batch id, batch number, product, vendor, received, transfer #, lab, COA file, sha256), optional upload to the private `coa` bucket; incoming transfers recorded too | pytest (pure + mocked HTTP) |
| **S6** | Onboarding "Attach harvested COAs": read the harvest (storage folder or uploaded files), marry by §2.7 rank, LlamaParse/unpdf read through the existing COA readers, create `lab_results` + link lots where none is linked, then the existing lab-facts attach | pure matcher tests on the 35 real fixtures |
| **S7** | Crawler logged-in social reader: `storageState` capture script (headed, owner logs in by hand), session cache + validation + expiry, login-wall detection, profile/post extraction, drafts-only; `/research-social` falls back to it when no Graph token | pytest |
| **S9** | The cutover button (§3b): Railway `cultivera_pos` job (Phase A/B, resumable, read-only guard) + supplemented workbook builder + link-first manifest plan + progress page on `/admin/menu-imports` with the go/no-go report; manual upload kept as fallback | pure cores + pytest + rehearsals #2–#4 pass §3b.6 |
| **S10a** | Receiving table (follow-up #5): a "Cultivera manifests" view on the receiving table listing every rebuilt manifest with Complete / Needs attention (from the onboarding tally; Unknown when it cannot be read), each row opening the same manifest page; filters (status, vendor, search, date range) and sorting (pulled in, ETA, vendor, manifest #, status) in a pure `receiving-table-core.ts`; the default view and the counts stay as they are | self-tests + vitest + mutants |
| **S10b** | Menu Imports revamp (follow-up #5): one numbered, plain-language migration guide (fetch → review → publish → rebuild manifests → onboard → CCRS clean-up), every helper, link and button label rewritten for the new process, copy in a pure core pinned by tests | copy/link pins + mutants |
| **S10c** | Known garbage → CCRS clean-up (follow-up #5, examiner green light): a pure classifier over the import diagnostics marks migrated records that are dead/broken as "remove from CCRS" candidates; the CCRS hub lists them for the first upload; removal goes only through paths the CCRS bible allows (ledger-proven Delete / R15b adjust-out), never a guessed Delete | self-tests + vitest + mutants |
| **S8** | Railway steps doc, final report + test strategy PDFs | delivered |
| **A1** | One-click accept of an S4 suggestion, remembered (0270 `intake_card_aliases`); applied only with zero exact matches and only to an eligible same-axis card, else stale | pure + vitest + mutants |
| **A2** | Reconciliation go/no-go page: Cultivera units = ours, by vendor / category, red/green | pure + vitest + mutants |
| **A3** | Dry-run preview before every bulk apply (counts that would change, nothing written) | pure + vitest + mutants |
| **A4** | Failure alerts (email / text) for the cutover jobs, on the existing notify infrastructure | pure + vitest + mutants |
| **A5** | One-page cutover runbook for 10/31–11/01 (doc + `/admin/menu-imports/cutover`) | copy pins |
| **A6** | Drift check 11/02–11/08 (our counts vs the last Cultivera numbers, daily) | pure + vitest + mutants |
| **A7** | Barcode-first matching (a delivery line whose barcode is already a live lot joins that card before any name rule) | pure + vitest + mutants |

## 3b. The cutover button: "Fetch It All, Fuck Cultivera" (owner's request, 2026-10-12)

**What the owner asked for (paraphrased; the credentials stay out of the repo):** on 2026-11-01, before opening at
08:00 PT, the first job is moving the Cultivera products into our system. He wants ONE button on
`/admin/menu-imports`, labelled **Fetch It All, Fuck Cultivera**, in place of the two upload boxes.

* The system logs into his Cultivera account and fetches everything, at a pace that finishes in time.
* It cleans the data to Greenway conventions and runs it through intake **grouped by the original manifest**.
* Enrichment works exactly as it does for native intake, and **nothing in this path may keep a product off the
  menu or the register while it is being enriched**.
* Every one of these manifests is already paid, so none of it creates a payment obligation.
* Rehearse it for real in the weeks before cutover, then do it for real on 11/01. Data taken now is rehearsal
  data and is re-taken on the day.

### 3b.1 Measured on rehearsal #1 (2026-10-12, live account, read-only, query host only)

| Step | Measured | Notes |
|---|---|---|
| Login | 1 call, 200 | Bearer JWT; the client re-logs in on a 401 |
| Inventory export (`POST inventories/export-inventories-to-excel` → CDN xlsx) | 3,835 rows, 649 KB, same 32 columns as the committed INVENTORIES export | Cultivera's own Excel export, the file the upload box takes today |
| Product export (`POST products/export-products`, every Hide flag false, ShowNonCannabis false) | 17,266 rows, 1.3 MB, same 19 columns as PRODUCTS | Covers 3,289 / 3,289 product names on the inventory export. ShowNonCannabis true returns only 187 non-cannabis rows; the UI default returns 3,211 rows and covers only 2,526 names, so the defaults are **not** used |
| Lists (inventories 3,858, depleted 25,280, vendors, categories, strains) | 102.7 s | kendo bodies |
| Lists2 (transfers 1,164, brands 436, master products 17,268, inbound report 103) | 33.5 s | the body shapes the Cultivera client itself sends |
| Transfer details (`GET transfers/incoming/{id}/detail`) | 1,164 in 779.5 s (0.67 / s at a 0.6 s pace) | only 654 are referenced by live lots |
| `normalize_cultivera.py` on the exports | 5 s | see 3b.3 for why it does not run before the transform |
| `transformWorkbooks` (raw inventory export + products filtered to inventory names) | 1.7 s, **0 errors, 2,906 cards, 2,906 visible**, 3,835 lot sources | |
| S1b plan on that live export | 1.6 s | |
| Memory | transform peak RSS 233–336 MB; sandbox total under 0.8 GB | the 3.9 GB box is never close |

### 3b.2 Completeness: Cultivera's export is NOT complete (found in rehearsal #1)

The inventory **list API** returns 3,858 lots. The **Excel export** returns 3,835. Every export Id is in the list
(0 extra), but **23 list lots are missing from the export**. All 23 are active, in stock (`UnitsInStock` > 0) and
not deleted, and all 23 come from one vendor, **BOTANICAL ARTS**. That same vendor has 24 other lots that the
export does include. I have not found the cause: none of the 12 flags I compared (active, available, sample, medical, storage, sales floor, deleted and so on) separates the 23 from the lots that were exported. Taking the export at its
word would have left 23 sellable lots off our menu on day one.

On the 3,835 shared lots the two sources agree exactly on barcode, product name, vendor, units on hold,
Thc/Thca/Cbd/Cbda/Total/terpenes, storage, location and cost. They disagree on available units for 32 lots and
on units in stock for 2: the reads were minutes apart during trading hours. Is Medical and Is Sample are written
`"False"` in the export and `false` in the API, which is a formatting difference only.

**Rule:** the button treats the **list API as the inventory of record** and the export as the column source. A
lot in the list but not in the export gets a row built from the list record plus `GET products/{ProductId}`,
which carries Brand, Category, InventoryType, Strain, Uom, PackageSize and UnitPrice (verified fields). The row
is flagged `supplemented: list-only` in the run report. The run's go/no-go gate (3b.6) requires
**list lots = rows imported**, with every difference named.

### 3b.3 Clean to Greenway conventions without breaking the join

* The transform joins inventory to products **by product name**.
* `scripts/naming/normalize_cultivera.py` (Slice E) renames each workbook from its own columns. The two
  workbooks carry different columns (PRODUCTS has no Vendor column), so the same product gets different new
  names on each side.
* Measured on the live pair, after normalising: **3,278 inventory names find no product row**, producing
  3,278 hidden "no product master" cards and only 494 visible cards.
* The committed normalized pair has the same problem: 3,807 inventory rows with no product master and 488
  visible cards.
* The **raw** pair joins completely: 0 missing and 2,906 visible.

**Rule:** the button transforms the **raw** exports, so the join is intact and every lot is on the menu. The
Greenway conventions come from the transform's own display naming and categories (the same code native intake
uses). The normalizer's proposed names, keyed by inventory `Id`, are kept in the run report for review. They are
not applied before the join.

Strain type (Indica/Sativa/Hybrid) is blank in Cultivera:

* blank on 3,279 of the 3,295 matching product rows;
* `strains` has no type field;
* `GET products/{id}` has no type field.

It cannot be fetched. Enrichment fills it, exactly as for native intake.

### 3b.4 Grouping by the original manifest: two real signals, and where they differ

Each live lot in the list API carries `IncomingTransferId`. **3,710 of 3,858 lots** have one, every one of those
transfers is in the detail harvest, and the lot's barcode is on that transfer's lines in **3,710 / 3,710** cases.

**First, a date trap.** The live export writes `Received date` as an Excel date cell formatted `MM/DD/YYYY`. The
transform reads formatted text, so the time of day is lost: 143 lots came out "ambiguous_no_time". The committed
export had the full timestamp as text. The button must rewrite date cells to `YYYY-MM-DD HH:MM:SS.ffffff` text
before the transform. Those values are Pacific local time: on 5 lots spread over 2025–2026 the export reads 7 h
(PDT) or 8 h (PST) behind the batch record's UTC `ReceivedDate`, which is the zone S1/S1b already assume.

Against Cultivera's link, S1b's evidence-only match on the live export with times restored:

| S1b outcome | Lots |
|---|---|
| Barcode on exactly one transfer: same as Cultivera's link | 3,458 of 3,482 (the other 24 are vendor-name mismatches, unmatched) |
| Barcode re-received on 2+ transfers: same as the link | 110 of 144 |
| Barcode re-received on 2+ transfers: different | **34**; S1b picks the first receipt after the lot's received time |
| No link, and S1b unmatched | 147 |

On the 144 re-received barcodes, Cultivera's link points to the **latest** receipt in 142 cases. Its link means
"last delivery that topped this lot up", not "the delivery that first brought it". Example: DOGTOWN PIONEERS
barcode `…072309`, received 08/28 on `DEL20010018642` (12 units) and again 09/07 on `DEL20010018855` (24 units).
Both are real manifests that carried the barcode.

**Rule (ranked evidence, like the COA rule 7):**

1. A barcode on exactly one transfer goes to that transfer. Both signals agree there except for the 24
   vendor-name mismatches, which go to Cultivera's link because the barcode is on its lines.
2. A re-received barcode goes to its FIRST receipt at or after the lot's received time (S1b). That is the
   original manifest. Every other transfer carrying it is recorded in the lineage as `alsoOn`, so no manifest
   loses the line. The disagreement count with Cultivera's link is printed in the run report and is not an error.
3. Everything else goes to S1 sessions / undated.

The 148 lots without a link are mostly "Default Vendor" (26), MAMA JS (13), CANNA ORGANIX (11) and FIRELINE
CANNABIS (9).

### 3b.5 Architecture (one click, no browser waiting)

1. **Button (Vercel, `menu.import` permission).** It refuses after cutover is done (the existing S18
   `refuseUpload` guard). A **test-mode** checkbox keeps rehearsals separate. It starts a Railway job and shows a
   live progress page that polls the job.
2. **Railway crawler job `cultivera_pos`** (new module, the `harvest.py` job pattern: one asyncio lock,
   crash-safe job JSON, resume, cancel):
   * Uses the username and password from Railway env vars only (S8 documents them).
   * Is read-only by construction: GET/POST to the query host's read endpoints and GET from the CDN. Every
     other URL or method raises an error.
   * Paces itself and logs every action without the token.
   * Phase A (critical path): login → both exports → inventory list → the transfer details referenced by live
     lots → `products/{id}` for list-only lots. Transfer details are immutable once accepted, so details
     fetched in a rehearsal are reused and only new or pending transfers are fetched again.
   * Phase B (after opening, never blocking): batches → COA catalog → WCIA files → lab JSON.
   * Writes each artifact with its SHA-256 to the private storage bucket.
3. **Import (Vercel, from storage).**
   * Builds the supplemented inventory workbook, then runs the existing `runImport` / `transformWorkbooks` (about
     2 s) and stages the version.
   * The manager publishes, and every lot is on the menu and the register.
   * Then the S2 executor files lots under their real manifests (3b.4). This touches only
     `inventory_lots.manifest_id`, per rule 1.
4. **Enrichment.** S3 seeds onboarding drafts for every reconstructed manifest in `reonboard` mode: "already on
   the menu", and approval never changes visibility. Enrichment, facts, COAs (S6) and KB then run exactly as for
   native intake.
5. **Accounting.** Reconstructed manifests are accounting-inert (rule 6, §1.4). There are no payables, purchases
   or vendor-pay rows, because all of this stock is paid.

### 3b.6 Go / no-go (written before rehearsal #2; every item is a number the run report prints)

* Login ok. Both exports downloaded, SHA-256 recorded, and the column sets equal to `INVENTORIES_REQUIRED_COLUMNS`
  / `PRODUCTS_REQUIRED_COLUMNS` (with Description added empty).
* List lots = imported lots. Each list-only lot is supplemented and named; there are 0 unexplained.
* Transform: 0 errors. Visible cards = cards with stock. No lot is hidden because of a missing product master.
* Manifest plan: every lot is on exactly one manifest and vendors are never mixed. Every single-receipt barcode agrees with the link, apart from named vendor-name mismatches. Multi-receipt differences are printed.
* The run fits its time budget (3b.7). Phase B failures never block go.
* **No-go fallback:** the two upload boxes stay on the page, collapsed under "manual upload". The owner can export
  the two files from Cultivera by hand and upload them as today.

### 3b.7 Time budget (from 3b.1)

The critical path is login + 2 exports + inventory list + about 654 transfer details. That is about 654 × 0.67 s
≈ 7.3 min of details, plus about 2 min for the rest. **The estimate is about 10 min**; it becomes a measurement in
rehearsal #2.

With details reused from the 10/31 dry run, only new transfers are fetched on the day, so the real figure should
be a few minutes. **Start at 06:00 PT**, which leaves 2 h of margin. Phase B (COAs) runs during the day.

### 3b.8 Rehearsals (test-mode imports; production data is never published from a rehearsal)

| # | When | Goal |
|---|---|---|
| 1 | 2026-10-12 (done) | live API map, exports found, completeness gap found, link ⇔ S1b agreement measured |
| 2 | week of 10/19 | crawler module + button end-to-end in test mode; time every phase; go/no-go printed |
| 3 | week of 10/26 | full run including S2 + S3 in test mode, then clean-slate test data; kill the job halfway and resume |
| 4 | 10/31 evening | dry run on the day-before data; the transfer details cached from it are reused on 11/01 |
| Live | 11/01 06:00 PT | real run → publish → open 08:00 → Phase B + enrichment during the day; then the owner changes the Cultivera password |

---

## 4. Status log

* 2026-10-12 — recon complete, bible written (this commit). No code yet.
* 2026-10-12 — **S1 done.** `src/lib/inventory/cultivera-manifest-group-core.ts` (pure; 110 self-test
  assertions, registered in the runner with floor 110). The pre-existing `parseUsDate` bug is fixed: it read 0 of
  4,256 export lots and now reads 3,987, plus the SheetJS date-cell texts `7/2/26` and `7/2/26 9:32`. It has
  75 self-test assertions. `tests/compliance/r50-cultivera-manifest-groups.test.ts` (15 tests) runs the REAL committed
  export through `transformWorkbooks` and pins every §1.1 number at G = 10/30/60/120/240. Those pins include an
  independent oracle, a partition check, vendor/day purity, agreement with `planImportLots`, four known real
  deliveries, determinism, and unique numbers and dedupe keys. Testing the tests: 32/32 mutants were killed, and
  reverting the parseUsDate fix makes 3 tests fail. Full vitest: 856 files and 22,522 tests passed. eslint 0,
  scoped tsc 0.
* 2026-10-12 — **Live recon + harvest (§0.2, §1.8).** I logged in with the owner's account and harvested read-only,
  query host only, human pace, every action logged. That covered the real manifests (1,164 transfers, 26,095
  lines), every live lot, 25,231 depleted barcodes, 17,268 catalogue products, vendors, brands, strains and the
  per-batch COA links. Every number in §1.8 / §1.9 was measured on that harvest.
* 2026-10-12 — **Sandbox reset; the harvest was lost.** The build machine restarted and rolled its disk back to
  an earlier snapshot. That wiped the harvest folder, the action log and the out-of-repo credential file. By
  design, none of them was ever in the repo. Nothing in the repo or in production was affected. The transfer
  index (`normalized_cultivera/TRANSFERS_INDEX.json`) and its real-data test must be rebuilt from a fresh
  read-only re-harvest. That needs the owner's login again, and the password should be changed afterwards.
  `scripts/cultivera/build-transfer-index.py` is committed so the rebuild is one command.
* 2026-10-12 — **S1b core shipped (real-data pins pending the re-harvest).** `src/lib/inventory/cultivera-transfer-match-core.ts`
  (pure; 72 self-test assertions, runner floor 72). S1's lot builder is now shared (`buildCultiveraLots`), so a
  lot means the same thing in both cores; S1's 110 assertions and 15 real-data tests are unchanged.
  Before the reset, the same core was proven against the real harvest:
  - 3,987 lots went onto 651 real manifests, and 269 went to S1's 53 undated groups.
  - The per-lot SHA-256 equalled an independent Python oracle (`54b67ffc…a180a3`).
  - S1 cross-validation: 647 / 649.
  - 30 / 30 mutants were killed.

  Those pins return in `tests/compliance/r50-cultivera-transfer-match.test.ts` once the index is rebuilt. If the
  re-harvest differs (new deliveries since), the differences will be re-measured and recorded, not forced.

* 2026-10-12 — **Re-harvest done; S1b real-data pins are back (rehearsal #1).** The owner re-sent the login, so I
  ran a fresh read-only harvest at 18:48 UTC. `normalized_cultivera/TRANSFERS_INDEX.json` was rebuilt with the
  committed one-command script; its source SHA is `9c9e9978…4a89`. The fresh harvest reproduced the lost one
  exactly: 1,164 transfers, 26,095 lines, 6 without an accepted time. All 9 parked pins pass unchanged on it,
  including the per-lot oracle SHA `54b67ffc…a180a3`. The test now lives in
  `tests/compliance/r50-cultivera-transfer-match.test.ts`.
  Testing the tests used 8 data mutants on the index. Six were killed straight away. Two survived: moving the
  accepted time of the transfer with the most lots by a year, and changing its manifest number. Neither changes
  which lot goes where, only what the reconstructed manifest SHOWS. A 10th test now pins a golden SHA of every
  manifest's (id, number, accepted time, vendor, status, lots) (`00339dd8…7e74`), and all 8 mutants are killed.
  A first mutant that dropped the BIGGEST transfer tripped only the guard. That was correct: none of its 104
  barcodes is a lot in the committed export, which I checked before accepting it.
* 2026-10-12 — **§3b written (the cutover button).** Rehearsal #1 measured it, and found two things that change
  the design. (1) Cultivera's own inventory export drops 23 in-stock lots, all from BOTANICAL ARTS, so the list
  API becomes the inventory of record. (2) Each lot's `IncomingTransferId` is real evidence, but on re-received barcodes it names the LATEST
  delivery (142 / 144), so S1b's first-receipt rule stays first for those (34 differ) and the link fills the 24
  vendor-name gaps. The live export also stores Received date as a date-only cell, which must be rewritten. Normalising before the join hides about 3,300 cards, so
  the raw exports are transformed and naming comes from the transform.
* 2026-10-12 — **S9 core shipped (`src/lib/pos/cultivera-fetch-core.ts`, pure, 76 self-tests).** This is the
  logic the button runs between the harvest and `runImport`. It rebuilds a 32-column inventory row from a
  list-API lot, so the 23 lots the export drops come back. It rewrites the Received date cells to
  `YYYY-MM-DD HH:MM:SS.ffffff` Pacific text so the time of day survives. It filters the product export to
  inventory names, so no stockless cards appear. It checks completeness (missing barcodes, duplicate ids) and
  prints a 7-check go/no-go.
  Live oracle (rehearsal #1 data, before the sandbox reset): rebuilding all 3,835 exported rows from list +
  products differed only where expected: units (32 lines over 2 columns), and 3 Category, 3 InventoryType,
  1 Brand and 1 Price on names with more than one product match. The date rewrite matched openpyxl on
  3,687 / 3,687 cells.
  Testing the tests: 38 / 38 mutants killed. Three earlier survivors (ms floor, UnitsAvailable taken from
  InStock, completeness ignoring a missing barcode) each got a pin.
  `tests/compliance/r50-cultivera-fetch-pipeline.test.ts` drives the real `transformWorkbooks` on a 600-row
  fixture shaped like the live export (20 dropped lots, serial date cells, 300 stockless products). The result
  is GO with 600 lots, 0 errors and 0 hidden. Removing any one safeguard turns it no-go or breaks a pin.
* 2026-10-12 — **S9 crawler harvester + rehearsal #2a (live, read-only): GO on all 8 checks.**
  `crawler/app/cultivera_pos.py` runs Phase A as resumable stages: login, both exports, the inventory list,
  the transfers list, referenced transfer details, and batches for list-only lots. A request guard allows
  only GET/POST, login is POST only, and data URLs must stay under `data-api/`. The CDN guard runs on every
  redirect hop. Logs are redacted, and the token lives in memory only. Files are written atomically, and the
  JSONL writer repairs a torn last line before appending. `crawler/app/cultivera_pos_jobs.py` adds
  single-flight start/resume and cancel, plus an allow-listed file download, all behind `X-Crawler-Secret`
  (`/cultivera-pos/runs…`). Tests: 47 harvester pytest (40/40 mutants killed) and 28 API pytest (12/12 killed).
  Rehearsal #2a timings:
  - 478 s total, 660 calls, 0 errors.
  - Login 0.1 s.
  - Inventory export 647 KB in 9 s.
  - Product export 1.3 MB in 30 s.
  - Inventory list: 3,824 lots in 10 s (Count verified).
  - Transfers list: 1,164 in 2 s.
  - Referenced transfer details: 644 / 644 in 427 s.
  - Batches: 0, because today the export carried every list lot. This was checked by Id, not assumed.

  `assembleFromRun` (`src/lib/pos/cultivera-fetch-assemble.ts`) ran the real transform on those bytes in
  3.7 s at 318 MB RSS. Result:
  - 3,824 / 3,824 lots and 3,676 date cells rewritten.
  - 17,266 product rows filtered to 3,285.
  - 2,898 items, all visible, and 3,249 variants.
  - 0 errors, and 0 hidden for a missing master.
  - **Control totals (new check 8):** 25,851 units, and cost value of $174,591.22 matching to the cent.

  **Found by the live run, fixed:** the first assemble was a false NO-GO with 56 "mismatches". The cause was
  the reconcile join on barcode. Live data has **59 barcodes shared by 121 lots** (re-received batches, and
  a POS Returns copy of a Sales Floor lot), so a barcode map paired the wrong rows. Reconcile and the batch
  received-date join now key on **lot Id** (`receivedUtcByLotId`; the Id key beats the barcode key, and an Id
  with a null date stays blank). Six new self-test pins cover it (93 total). Testing the tests: 17 / 17
  reconcile and assemble mutants killed. The first pass left 5 survivors (blank-Id pairing, ok ignoring
  per-lot mismatches when totals net out, cent flooring, junk units → 1, mismatch order), and each now has a pin.
  **Known, not a defect:** 148 exported lots have no Received date at all. The batch record has every date
  null and there is no `IncomingTransferId`. These are legacy and manual lots, 26 of them under "Default
  Vendor". They stay visible, and manifest grouping puts them in the `undated` group. They are never dated
  by guess.

- **2026-10-12, S9 button (PR #1350, merged).** The Fetch It All button, the progress and go/no-go page, the
  import gate (`importDecision`: verified files, GO, no cutover, harvest no older than 90 min; test mode needs
  only verified files), the server client with sha/byte verification, the timed 11/01 runbook, and the Railway
  env docs. 33 self-tests (24/24 mutants killed) and 8 fake-crawler tests (9/9 killed).

- **2026-10-12, S10: link-first manifest plan in code (rule v2, §3b.4), and the §3b.6 "Manifest plan" gate.**
  * `cultivera-transfer-match-core.ts` rule v2:
    * **Vendor alias by link.** When a lot's only receipt is on another vendor's transfer, the lot is accepted
      if Cultivera links it to exactly that transfer. Without a link, or with a link elsewhere, or with
      several receipts, the refusal stands. The manifest keeps the shipper's vendor.
    * **alsoOn.** Every other receipt of a re-received barcode is recorded on the group and in lineage
      (`also_on`, `vendor_by_link`).
    * **Link agreement.** Each lot is marked agree, differ or none, and the summary counts them.
    * Without `links`, the v1 answers are unchanged (the S1b real-data pins and the oracle SHA still pass).
  * New pure adapters:
    * `transferIndexFromDetails`: the TypeScript twin of `build-transfer-index.py`, **equal on 644 / 644
      transfers**.
    * `linksFromListLots`.
  * `manifestPlanGate` fails on any of these:
    * a lot that is not placed exactly once;
    * vendor mixing outside the named aliases;
    * number collisions;
    * a single-receipt lot that disagrees with the link;
    * a linked lot left unplaced;
    * no links at all.
    It prints multi-receipt differences without failing.
  * Wiring:
    * `assembleFromRun` builds the plan from the transform's own `lotSources` and appends check 9,
      `manifest_plan`.
    * `loadRunForImport` fetches and verifies `transfer_details.jsonl`. It **refuses a run whose lots link
      transfers but has no details**, so the plan can never be skipped silently.
    * The run page shows the plan (real transfers, rebuilt groups, aliases, alsoOn, link differences, the 10
      biggest manifests).
    * The audit row records the plan's counts.
  * **Re-measured on rehearsal #2a (live, 2026-10-12), GO 9 / 9:**
    * 3,762 lots: 3,615 on 641 real transfers (3,496 only-receipt, 119 first-after-received), and 147 on 38
      rebuilt undated groups.
    * Link agrees on 3,609. The 24 aliases are all brands shipped by a distributor; the largest pairs are
      DOPE SYNERGY ← R&B GROUP (6), TTL HOLDINGS LLC ← R&B GROUP (5), and HOMETOWN HERBS ← SOUTH BAY MASTER
      GROWERS (4).
    * **6 differ**, all one event: GROW OP FARMS transfers 1108 and 1109 were accepted 8 min apart on
      2026-08-20. The lots were received before both. We file them on 1108 (the first receipt after received);
      Cultivera points at 1109 (its "latest top-up" link). 1109 is in `alsoOn`, and the earlier receipts 962
      and 1036 were accepted before the received time.
    * 0 unmatched-but-linked, 0 collisions, partition 3,762 / 3,762.
    * Assemble with the plan: 3.8 s, 499 MB RSS.
  * **Correction to §3b.4 (re-measured, not copied).** The 2026-10-12 morning figures (110 / 144 agree, 34
    differ) came from the earlier export. On #2a, 119 re-received lots split 113 agree / 6 differ. Rule v2 does
    not depend on either number.
  * **Testing the tests:**
    * 116 self-tests, runner floor 116.
    * 32 / 32 code mutants killed. The first pass left 5 survivors (alias on multi-receipt, alias with two
      links, receipt on an unknown transfer, flag truthiness, and the multi-differ filter), and each now has
      a pin. One equivalent mutant (`lotsAlsoOn` vs multi-receipt count) is documented, not counted.
    * A real-data vitest, `r50-cultivera-manifest-plan-live.test.ts`, runs on
      `normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json` (no prices, addresses or people, which the test
      asserts). It checks per lot against an **independent Python oracle (openpyxl plus Cultivera's raw JSON),
      SHA-256 equal**, and **6 / 6 data mutants are killed**.
    * The fake-crawler client test went from 8 to 12 cases: details served, missing details refused, a torn
      line, a link to a transfer that lacks the barcode (NO-GO), and the old no-link path.

- **2026-10-12, S2a: Cultivera migration stock never reaches payables or the books (§1.4).**
  * `src/lib/accounting/migration-stock-core.ts` (pure, 26 self-tests, runner floor 26) is the one predicate
    for both migration kinds. It also holds the PostgREST filter string and the plain-English messages.
  * **Payables** filter on the server and in code. The server filter is the null-safe
    `.or("raw_payload->>kind.is.null,raw_payload->>kind.not.in.(...)")`. **Trap found on a real PostgREST
    12.2.3:** the obvious `.not("raw_payload->>kind","in",...)` drops every manifest with no kind
    (`NULL NOT IN` is NULL in SQL). That would have hidden most native deliveries from payables. The new
    test forbids that form.
  * **The Sage purchases export** leaves migration manifests out and prints a warning: "N Cultivera
    migration manifest(s) left out: ...". The skip is never silent.
  * **The vendor bill and the goods receipt** refuse with `BILL_MIGRATION_STOCK` / `RECEIPT_MIGRATION_STOCK`.
    The check runs before any lot is read.
  * **Intake** treats those refusals as "none needed", not an error banner. They land on the timeline as
    quiet accounting events (`vendor_bill_migration_stock`, `receipt_migration_stock`; `problem: false`).
    `manifest_events.event_type` is unconstrained text (migration 0032), so the new events are stored.
  * **Measured on a real database** (PG15 with all 269 migrations applied, plus PostgREST 12.2.3, running
    the shipped TypeScript). Five accepted manifests were seeded: native WCIA $50.00, a PDF with a null
    payload $48.00, `POS-IMPORT` $300.00, reconstructed $140.00, and an odd payload `{"other":1}` $1.00.
    * BEFORE (main):
      * Payables listed all five, including $300.00 and $140.00 of migration stock.
      * The Sage export had 4 transactions, including the reconstructed manifest.
      * Bill and receipt returned `OK` for both migration manifests, so they would have been booked twice.
      * Re-measured on a freshly seeded database, with the same result.
    * AFTER (this branch):
      * Payables list only the three real deliveries (WCIA 5000, PDF-77 4800, CV-NOKIND 100). The null and
        odd payloads **stay payable**.
      * The Sage export has 3 transactions and the warning "2 Cultivera migration manifests left out".
      * Bill and receipt return `*_MIGRATION_STOCK` for both migration manifests. The native manifest still
        returns `BILL_OK` and `RECEIPT_OK`.
    * One early BEFORE run printed `BILL_POST_FAILED` for the native bill. Re-running on fresh seed data
      gave `BILL_OK`, so that result did not reproduce. Its cause was not established and no claim is made.
    * The local harness scripts were lost in a sandbox reset before they were committed. The numbers above
      are the printed probe outputs.
  * **Testing the tests:**
    * `tests/compliance/r50-migration-stock.test.ts` has 17 tests covering the core, the labels and the
      source wiring of all four doors plus the intake actions.
    * **20 / 20 mutants killed** (a dropped filter, a missing select, guards removed, the trap filter form, an
      inverted filter, a loose match, the label marked as a problem, and the intake banner or event changed).
    * 25 related suites pass (785 tests). The S29 count pin is now 63 on purpose; the original D-71 regexes
      still hold. eslint 0, scoped tsc 0, all pure self-tests pass.
  * Next is **S2b**: the §1.3 readers must follow moved lots by import id, not by the `POS-IMPORT-<id8>`
    number. That has to land before the S2c executor moves any lot.

- **2026-10-12, S2b: every reader follows an import's lots by import id (§1.3).**
  * New pure `src/lib/inventory/import-lineage-core.ts` (30 self-tests, runner floor 30) and server
    `import-lineage-store.ts`. ONE manifest read: `.or(manifest_number.eq.POS-IMPORT-<id8>,
    raw_payload->>import_id.eq.<id>)`, then the core keeps exactly this import's manifests. Lots are read chunked
    by manifest (150) and fully paged by lot id. Any failed page THROWS, so there is never a short list.
  * Rewired: received-date bulk page and write, legacy-lot removal, the backfill lot count
    (`countImportLots`), the classification source tab (`isCultiveraMigrationRow`, kind or legacy prefix) and
    enrichment attribution. For a rebuilt manifest, the date is the lot's own `received_on`, else the manifest's
    `received_at`, never `accepted_at` or `created_at`.
  * **Two latent bugs found on a real database** (PG15, all 269 migrations, PostgREST 12.2.3, shipped TypeScript;
    `scripts/recon/r50-s2b`):
    * Two imports whose ids share the first 8 characters: on main the received-date page THREW ("JSON object
      requested, multiple (or no) rows returned") and the removal plan said "import manifest not found". On the
      branch each import sees only its own lots.
    * A lot re-homed to a rebuilt manifest: on main it vanished from both the received-date page and the removal
      plan. On the branch it is found (A = lots 1 and 3; B = lot 5).
    * Found while probing the branch: the received-date WRITE could date a destroyed lot that the page never
      showed. The write is now scoped to the import's own non-destroyed lots (6 ids sent, only lots 1 and 3
      written).
  * **Testing the tests:** `tests/compliance/r50-import-lineage.test.ts` (21 tests: the core, the store against a
    fake PostgREST with 1,200 lots over 151 manifests, a mid-read failure, reader wiring, rebuilt-manifest dates).
    **22 / 22 mutants killed.** 17 related suites pass (449 tests), eslint 0, scoped tsc 0, all pure self-tests
    pass. Two pins changed on purpose: the s22 self-test count is now 81, and the worklist source pin now uses the
    shared predicate.
  * Migration 0244 is unchanged (see §1.3, which also records the S2c precondition).
  * Next is **S2c**: the executor that rebuilds manifests and re-homes lots.

- **2026-10-13, S2c: rebuild the Cultivera manifests and re-home the lots (§1.3b).**
  * **Executor.**
    * The pure `cultivera-rehome-core.ts` (69 self-tests, runner floor 69) and the server `cultivera-rehome-store.ts`.
    * Preview is read-only. Apply changes only `inventory_lots.manifest_id`, and every move is guarded by
      `.eq("manifest_id", source.id)`. Manifest inserts are idempotent by `dedupe_key`.
    * Control totals (lots, on-hand units, received units, cost value) are re-read after Apply. Event-insert
      failures come back as `warnings`; they are never swallowed.
  * **Apply runs only the plan you previewed.**
    * `rehomePlanDigest` is a sha256 over the plan, independent of who runs it. Apply refuses if the plan changed.
    * A manifest from elsewhere that already holds a planned key is caught in **preview** (`readManifestsByKeys`),
      not at insert time.
  * **Plan inputs persisted at import.**
    * Fetch It All saves `pos-raw/rehome/<import>/plan-inputs.json` for real imports. It holds no prices and uses
      the same harvest day as lot creation.
    * Apply rebuilds its sources from the import's stored workbooks, with the same transform and sheet names as
      lot creation. A missing or mismatched input fails closed.
  * **Rollback.**
    * It moves back only the barcodes in each manifest's `raw_payload->barcodes` lineage, in guarded batches of
      150. It checks that every batch made progress, and refuses when lineage is missing.
    * It deletes only empty rebuilt manifests of this import that have no work attached.
  * **Screen.** `/admin/menu-imports/<id>/manifests` (`cultivera-rehome-ui-core.ts`, 13 self-tests) shows:
    * stat cards, control totals, refusals and each exception code explained in plain words, and the largest
      manifests;
    * Apply/Resume and Rollback, both attested and audited (`cultivera_rehome.*`).
    * The import page links to it.
  * **Native readers (§1.3b), all done.** Rebuilt manifests are left out of:
    * the Receiving queue (`listManifests`, unless `includeMigration`, which the full intake export sets);
    * the stage counts, which gain `migrated`, shown on the intake page as "Moved from Cultivera";
    * dock-to-shelf.

    Each reader uses the null-safe server filter `NOT_REBUILT_OR` plus the same rule in code. The POS-IMPORT
    manifest is unchanged (SLICE 58).
  * **Measured on a real database** (PG15 + PostgREST, 3,762 lots, 679 rebuilt manifests; `scripts/recon/r50-s2c`):
    * Apply: 679 created, 3,762 moved, about 3.0 s. Re-Apply is a no-op.
    * Rollback restores the snapshot exactly.
    * Crash and resume converge.
    * A hand-placed native lot is kept (keptNonEmpty 1).
    * Readers: the queue shows 3 of 682 rows, the export 682; counts are received 1, accepted 2, migrated 679.
  * **Testing the tests:** `r50-cultivera-rehome.test.ts` (29) + `r50-rehome-readers.test.ts` (9, the real
    PostgrestClient over the shared fake, which now emulates `or=`, JSON `neq`/`is.null` and `alias:col->>key`).
    **23 / 23 mutants killed.** 32 suites that use the shared fake pass (851 tests), eslint 0, scoped tsc 0, all
    pure self-tests pass.
  * **Precondition (owner):** confirm migration 0244 is applied in production before the first Apply (§1.3).
  * Next is **S3**: the onboarding "Cultivera manifests" section and `reonboard` drafts.

- **2026-10-13, S3: Cultivera manifests through Product Onboarding (§1.5b).**
  * **Executor.** `cultivera-onboarding-core.ts` (pure, 55 self-tests, runner floor 55) and the server
    `cultivera-onboarding.ts`. "Start" on a rebuilt manifest runs the NATIVE chain, nothing new:
    `seedDraftsForManifest(…, {reonboard:true})` → COA archive → extract (60 s budget) → `promoteManifestToKb` →
    `linkKbProductsToDrafts` → `attachLabFactsToManifestDrafts` → Cultivera THC/CBD as a `potency` fact
    (source `cultivera`, shown, never counted) with provenance rows. One `manifest_events` note + one audit row
    (`live_menu_changed:false`). Start refuses any manifest that is not `cultivera-reconstructed`.
  * **Reonboard seeding.** One draft per card key, flagged "Already on the menu"; keys already waiting in review or
    already approved are skipped (reruns are no-ops); the suggestion is the live card's price only when every
    variant agrees, otherwise none.
  * **Rules (sellable stays sellable).** Staging skips a rebuilt manifest (`migration-manifest`) and fails closed
    on a manifest read error (`manifest-kind-read-failed`). Approval of a rebuilt-manifest draft re-reads the live
    price on the server, ignores the form, skips the floor and can never stage a menu version. Verified: approval
    writes only fact columns on the lot (classification mirror, strain type, `kb_product_id`); status, qty, cost,
    CCRS, card visibility and price are never written.
  * **Screen.** Product Onboarding gains a collapsible "Cultivera manifests" section (paged, newest first, state per
    manifest: Not started / In review / Done), a Start / Run again button, a result banner (closed set), and on
    rebuilt rows the badge, the live price and Approve without a price box.
  * **Measured on a real database** (`scripts/recon/r50-s3`): START#1 seeded 3 (1 same card), 3 saved to the KB,
    3 linked, 3 potency facts, 339 ms; START#2 seeded 0; native manifest refused; approvals recorded 2500 / null /
    1500 with `kb_product_id`; staging reason `migration-manifest`; section "Done: 3 approved"; 3 provenance rows.
    After `undo.sql` the lot md5 and the `kb_strains` md5 are byte-identical to before.
  * **Testing the tests:** `r50-s3-cultivera-onboarding.test.ts` (23, real PostgrestClient over the shared fake).
    **22 / 22 mutants killed.** 40 related suites pass (1,087 tests), eslint 0, scoped tsc 0, all pure self-tests
    pass. Pins changed on purpose: s13 permission count 7, S31 allowlist `cvBanner.tone`, s11 header row in tbody.
  * Next is **S3b** (owner's follow-up #3): the full Cultivera fact harvest at onboarding (§0.3).

- **2026-10-13, S3b: the vendors' own WCIA files at onboarding (owner follow-up #3, §1.5c).**
  * Crawler stage `wcia_json` saves the vendor's WCIA transfer file for each transfer. The path is guarded,
    the reply is validated, and the stage is resumable and cancellable. It runs last, as enrichment that may
    end `partial`: a missing file never blocks the import. 80 pytest, **17 / 17 mutants killed**.
  * `cultivera-wcia-core.ts` (pure, 32 self-tests) holds the storage key and the own-transfer link plan, so a
    lot only takes lab results from its own transfer. `intake-store` now uses the same shared lab-row
    builder, so native and Cultivera lab rows are built by one function.
  * Start step 0b attaches the vendor's lab results fill-only (never over an existing value). A rejected
    attach is reported as a result and never blocks Start.
  * 14 behavioural tests. **19 / 19 mutants killed** (the last two: padded lot codes, a rejected attach).

- **2026-10-13, S3c: a rebuilt manifest refreshes its live cards through the native pipeline (owner
  follow-up #4, §1.5d).**
  * **Practice followed, not invented.** We validate migration parity against a known-good baseline (dbSeer,
    "Data Migration Validation": record checks, then business-rule parity, then an exception report). Golden
    records use MDM field-level survivorship (Informatica / Reltio / Profisee): a trusted non-null value wins
    per field, a null never wipes, and lineage is kept. The parity test uses a natively received delivery
    as the baseline.
  * **`cultivera-card-refresh-core.ts`** (pure, 82 self-tests, runner floor 82). It holds the switch
    (`CULTIVERA_CARD_REFRESH`, on unless `off`), the kind gate (`cultivera-reconstructed` only), and the
    staging plan.
    * The plan carries the whole live menu forward and builds our cards with the native
      `buildDraftInjectionPlan` plus mastering's `masteredSingletonText`. It then overlays them onto the live
      cards by survivorship.
    * The plan never adds a card, never merges, and never writes price, sizes, stock, visibility or sort
      order.
    * The core also holds the lot-fact patch (non-null only, provenance merged), the notes, the events, and
      the Onboarding row copy.
  * **Staging (`intake-menu-staging.ts`).** A rebuilt manifest now runs the same pipeline as a received one:
    fact flags, saved fact answers, withhold, lot golden-record facts, KB links, auto-publish.
    * An unverified product's refresh is withheld, and its live card keeps selling unchanged. The timeline
      says "still on sale".
    * Refresh mode makes no vendor-id restock read and no merge-answer read.
    * `pos-import-migration`, an unreadable kind, or the switch set to `off` keep the S3 rule (skip, or fail
      closed).
  * **Approval** on a rebuilt draft now stages. The price is still the live one, re-read on the server.
  * **Parity, measured** in `r50-s3c-cultivera-parity.test.ts` (11 tests). It runs real staging over the
    shared PostgREST fake, with the real bytes COAs.
    * The rebuilt card equals the received card on all 30 customer-facing fields, description included.
    * Protected fields and variants stay byte-identical. The lot patch never touches stock.
    * Re-approval builds no redundant version. Switch off makes zero writes.
  * **Testing the tests: 27 / 27 mutants killed** across the core, the staging wiring and approval. One
    survivor was found and pinned: the vendor-id read in refresh mode, now with a spy and a native control.
  * Pins changed on purpose:
    * mastering count 218 → 222 (`masteredSingletonText`);
    * S01 notes pin (the refresh text is a suffix);
    * S3 tests renamed "switch off: …".

- **2026-10-13, S3d: the "via Cultivera" flag (owner follow-up #4).**
  * The Inventory list and lot page are unchanged for migrated lots except for one flag.
    `cultivera-received-flag-core.ts` (pure, 20 self-tests) is the one rule for both pages. A lot is flagged
    when its manifest is a migration manifest (the shared lineage predicate `isCultiveraMigrationRow`) or
    when its notes carry the import marker. Re-homing moves only `manifest_id`, so the marker survives. A real
    delivery is never flagged.
  * **List.** A "VIA CULTIVERA" badge sits in the always-visible product cell. One chunked lineage read
    serves the badge. It fails soft: on a read error it falls back to the marker, like the Leafly badge.
  * **Lot page.** "Received via Cultivera" sits beside the manifest link.
  * **13 / 13 mutants killed.** Two survivors were found and pinned: an array payload, and a failure on a
    later chunk.
  * The Onboarding row copy now says approval "rebuilds the live card from this onboarding (sizes and
    visibility unchanged)". With the switch off it still says "does not change the menu". The Start note
    ("The live menu was not changed.") stays as it is, because Start only adds drafts.

- **2026-10-13, S10a: Cultivera manifests on the receiving table (owner follow-up #5, part 1).**
  * `receiving-table-core.ts` is pure, with 88 self-tests. It adds a third view, `?view=cultivera`, which
    lists every rebuilt manifest as Complete / Needs attention / Unknown. The status comes from the
    onboarding tally, and an unreadable tally is Unknown, never Complete.
  * It also adds status, vendor, search and date filters, plus sorting. The default view and its counts are
    unchanged.
  * Tests: 16 vitest; mutants 21/21 core + 11/11 wiring.
- **2026-10-13, S10c: migrated garbage → CCRS clean-up (owner follow-up #5, part 3; D-15, U-46).**
  * `ccrs-migration-garbage-core.ts` is pure, with 53 self-tests. "Dead" means only `no_product_master` or
    no barcode. Each dead lot is routed by the CCRS ledger: zero in CCRS (Reconciliation `[G L1142]`, via
    R15b), fix status, local only, reconcile first, already zeroed, or already removed.
  * It never sends an Inventory Delete (`[G L0248]`, U-46 OPEN). Fixable rows are listed, not removed.
  * The store is read-only and fails closed: any short read is an error, never a partial list. The panel
    sits at `/admin/compliance/ccrs#migration-garbage`.
  * Tests: 13 vitest; mutants 25/25 core + 15/15 wiring.
- **2026-10-13, S10b: Menu Imports revamp (owner follow-up #5, part 2).**
  * `src/lib/pos/menu-imports-guide-core.ts` is pure, with 70 self-tests and is registered in the runner. It
    holds the nine-step migration guide:
    1. Fetch
    2. Go / no-go
    3. Stage
    4. Review (Fact Review, warnings, types)
    5. Publish
    6. Rebuild manifests
    7. Onboarding and missing products
    8. CCRS clean-up
    9. Receive from now on (Cultivera view)
  * **How a status is set.** Status comes only from facts the page already reads: the cutover verdict, fetch
    runs, import rows and the crawler setting.
    - A step the page cannot prove is "Check", never "Done". Steps 6–9 stay Check even after go-live.
    - An unknown cutover read, or a page-load error, turns every step into Check with zero done.
    - Exactly one step is "Do this next", and a blocked step (crawler off) is never next.
    - A test import never counts.
    - After go-live, the guide links the migrated import, not a later staged one.
  * **Page changes.**
    - `MenuImportsGuide.tsx` is open before go-live and collapsed after.
    - The HelpPanel has new steps ("How the Cultivera migration works") and a CCRS clean-up note ("Nothing is
      ever sent as a Delete").
    - The Fetch section has an anchor (`#fetch-cultivera`) and a three-line "what happens next" list.
    - The recent-runs label, the staged banner and the empty-history copy were rewritten.
    - The import page's Publish section gained the `#publish` anchor the guide links to.
  * **Fetch run page.** `fetchRunNextStep` prints one "What to do now" line from the page's own facts:
    running, failed/cancelled → Resume, unknown, done but short, check error, unchecked, GO + allowed, GO but
    refused (test only), and NO-GO. An unchecked run never says GO.
  * **Tests.**
    - 13 vitest: the rendered guide, every guide href resolving to a real `src/app` route, and the page
      wiring.
    - Every existing pin is kept, including s21, s18, r13a, s15, s16, intake-version-copy-core,
      receiving-is-the-real-pipeline, r14a, r14b and pipeline-fix-links-connected. One s21 pin caught new
      banner text that said "Import history" above the wrapper; the copy was reworded and the pin was left
      unchanged.
    - Mutants: 25/25 core (three survivors found and pinned), 14/14 page/panel/runner, and 10/10 fetch-run
      (one survivor pinned).
- **2026-10-13, research notes (enterprise migration practice; every claim is from the cited page).**
  * **Concentrus, "Data Migration Cutover Plan: Checklist And Risk Controls" (2026-03-16)**
    (https://concentrus.com/data-migration-cutover-plan).
    - A cutover plan has four layers: preparation, execution sequence, validation checkpoints and rollback.
    - Success criteria must be measurable, e.g. "Record count match 100%".
    - Go/no-go is a formal sign-off, not a verbal confirmation.
    - Rehearse with a full copy of production data at least two weeks before go-live, and time every block.
    - Our §3b.6 go/no-go and the rehearsals in §3b.8 already follow this. The guide's step 2 makes the
      go/no-go an explicit stop.
  * **Monic Solutions, "Data migration reconciliation report template" (2026-09-27)**
    (https://www.monicss.com/insight-data-migration-reconciliation-report-template.html).
    - "Equal row counts alone cannot establish matching keys, values or business outcomes."
    - "Partial, sampled or unrun mandatory work stays Not assessed"; "Treat a skipped field as uncovered,
      not passing."
    - Keep a tool error, an unavailable check and a genuine mismatch as separate records.
    - Keep exceptions traceable across reruns rather than replacing them with "a fresh green summary".
    - **Applied here:** the guide's "Check" status means not assessed, never done. The fetch-run line
      separates a crawler error, a check error and a NO-GO. S10c keeps a short read as an error, distinct
      from an empty list.
  * **Konexxia migration audit (read during S10c).** It recommends exception reports with categories and
    resolution strategies, documented exclusions with sign-off, and item-by-item inventory reconciliation.
    **Applied here:** S10c groups rows by route and by reason with a resolution link. D-15 is the recorded
    sign-off for the clean-up.
- **2026-10-13, S11: the Oct 30 shelf count (owner follow-up #6, clarifications #2–#4; D-16; U-47–U-53).**
  * **The owner's flow:** download one workbook per counter → point-scan → upload them all → preview → confirm.
    The page is `/admin/menu-imports/count`, and the guide gains step 6, "Apply the Oct 30 shelf count" (now
    10 steps).
  * **Workbook** (`cultivera-count-workbook.ts`, exceljs).
    - Its lot list comes from the latest verified harvest's `inventories.json` (`loadRunLotList`). Real lots
      do not exist until the cutover import.
    - The count is blind: the workbook never shows Cultivera's quantity.
    - The scan column is text-only and the sheet is protected. Downloads are audited
      (`cultivera_count.workbook_downloaded`, with the inventories sha256).
  * **Sales** (crawler stage `sales`, the owner's page `#/rpt/sales-details`).
    - It runs only when the fetch form has a count date. It reads every Sales Details line from the sales day
      (count date + 1) through today, with safe fields only (no employee, customer or payment fields).
    - It is Count-verified, and the row sums must equal Cultivera's own summary, or the run is marked
      "partial".
    - It is an enrichment stage: a sales miss never blocks the cutover import. Instead, the count page refuses
      to apply.
    - At import, the sales files are saved, with their sha256s re-checked, to `pos-raw/count/<importId>/`.
  * **Core** (`cultivera-count-core.ts`, pure, 65 self-tests).
    - The formula is `rolled = counted − (Units − ReturnUnits on 10/31)` and `delta = rolled − Cultivera
      on hand`, per barcode.
    - **Refused outright:**
      - workbooks with mixed count dates;
      - the same workbook uploaded twice;
      - an unreconciled sales summary, or one for the wrong day or with the wrong line count;
      - any 10/31 sale at or after the harvest snapshot;
      - any sale after 10/31;
      - a harvest with no snapshot time.
    - **Flagged and left alone, per lot:**
      - unknown barcode;
      - uncounted lot ("leave" policy; "zero" is an explicit choice);
      - ambiguous barcode;
      - unknown order status;
      - a lot that moved after the import (`moved_since_import`).
    - A re-apply is a no-op. A corrected re-upload moves only the difference.
  * **Apply** (`cultivera-count-store.ts`).
    - It uses the R15b pattern: an `inventory_adjustments` row (reason `count` = CCRS Reconciliation
      `[G L1142]`), then a strict `applyLotDelta`. The row is removed if the write is refused.
    - The server rebuilds the preview and refuses the apply if the plan digest changed since the owner looked.
    - Uploads are stored with their sha256s and re-checked on read. Every step is audited.
  * **Accounting** (D-16). The Sage adjustments export leaves out count rows, which are opening inventory, and
    prints a warning line. CCRS, vendor pay and bills are unchanged.
  * **Tests.**
    - vitest: count 7, fetch-client 17, migration-stock 18 and guide 13.
    - The crawler pytest passes 94.
    - Dependent suites pass: slice5c, sage-exports-core, s16, s10b, rehome, receiving, s21, s15, s18, r13a,
      intake-version-copy-core and fetch-pipeline.
    - Mutants: store 19/19, core + migration 14/14, guide 3/3, fetch-button 6/6 and crawler 12/12. Two
      survivors were found and pinned: the digest ignoring a field, and the summary `dateFrom` check.
  * **Before 10/30 (rehearsal #3), the owner:**
    - scans 3 items per scanner (U-47);
    - rings a test sale and return (U-48, U-49);
    - opens a workbook in Excel on a store PC (U-53).
  * **On 10/31:** fetch after the close and before the 11/01 open (U-50), with the count date set to 10/30.

### S12b — vendor lab results onto every Cultivera manifest, one button (PR #1361, merged)

  * **What.** On Product Onboarding → Cultivera manifests, one button, "Attach vendor lab results to every
    Cultivera manifest", runs the same fill-only WCIA attach the per-manifest Start runs, over every rebuilt
    manifest. Before this it took one click per manifest (about 700).
  * **How.**
    - Keyset pages of 50 (`id > cursor`).
    - About 200 s per click. When time runs out, the run pauses and the button becomes **Continue**, which
      resumes from the saved cursor.
    - A certificate is never replaced. A re-run is a no-op.
    - One audit row per click (`cultivera.wcia_backfill_run`).
    - A failing manifest is counted and named, never fatal. A list-read error stops honestly and can be resumed.
  * **Tests.** vitest 13 and pure 27. Mutants 18/18. The related suites (39 files) pass.

### S4 — "Looks like Cultivera product X" on a New-card onboarding row (this PR)

  * **What.** The exact restock rule stays the only thing that merges. When a delivered product gets the
    verdict "New card", the row now also shows the imported Cultivera card it is spelled almost exactly
    like, with the evidence (vendor, category, how the names differ, size) and a link to compare.
  * **Never applied.** Approve, staging and the merge never read it; this is pinned by a test.
  * **Rule** (`cultivera-intake-suggestion-core.ts`, pure). Only Cultivera keys qualify, and never hidden or
    medical-only cards. The card must match on all of the following:
    - the same vendor record, vendor name or brand;
    - no conflicting named brand;
    - the same category axis;
    - the same numbers in the name (a hard block).
    The name must then be one of:
    - the same apart from spacing or punctuation;
    - the same words reordered;
    - ONE letter off, with the same first letter and at least 6 letters.
    Vendor/brand words and product-form words are dropped from the comparison first. Flavour words are never dropped.
  * **Measured on the real export, not guessed.**
    - A first version used token/bigram similarity at 0.8. Over the 3,247 distinct imported identities it
      flagged 129 pairs, mostly different flavours or strains (Wyld sour cherry vs sour apple, Cherry vs
      Berry Gelato).
    - The strict rule flags exactly 13 pairs, all genuine variants (Grand Daddy / Granddaddy Purple,
      Tropicana / Tropicanna Cookies, Facelock / Face Lock, …).
    - On the real Old Name → New Name renames it recovers 145 variants (81 same, 32 reordered, 32 typo).
    - Both results are pinned in vitest.
  * **Cost.** No new reads: it rides the restock preview's GET reads. A scorer failure is caught and the
    preview still shows (`safeSuggestions`).
  * **Tests.** pure 58 and vitest 13. Mutants 28/28 (one survivor, "vendor link off", was found and
    pinned). The related suites (41 files) pass.

### S7 — social-media COA crawler: DROPPED by the owner (2026-10, this round)
  * **Owner's words:** "Cultivera stores the JSON, not the coa, but the coa is embedded in the JSON, so we
    can still get them all using the jsons we fetch. We don't need to build the social media crawler."
  * **Verified on disk before acting.**
    - Each WCIA transfer line carries `lab_result_data.coa`, the lab's own PDF link, plus the full potency,
      for example `https://certs.conflabs.com/full/WA-…pdf` in `tests/fixtures/coa/transfer.json` and the
      `cv*.wcia.json` fixtures.
    - S3b/S12b already save that link as `lab_results.coa_url`.
    - The JSON holds the link, not the PDF bytes, so S13 below downloads each linked PDF once.
  * **S5 (COA harvest)** is therefore satisfied by S12b and S13; no crawler is needed.

### S13 — keep a private copy of every lab certificate, one button (this PR)
  * **Button.** "Save a copy of every lab certificate", in the Cultivera manifests section of Onboarding.
  * **What it does.**
    - Walks `lab_results` that have a `coa_url` and no stored copy, in id order (keyset), four at a time.
    - Downloads each PDF into the private `coa` bucket, at the same path delivery intake has always used
      (`<labId>/<labtest id>.pdf`).
    - Records it with a compare-and-set on an empty `coa_storage_path`.
    - Stops before 200 s and hands back a checkpoint; Continue resumes from it.
    - Writes one audit row per click (`lab.coa_archive_backfill_run`).
  * **Stricter than the per-delivery archive (bulk and unattended).**
    - https only, and never a private, loopback, link-local or internal host, re-checked on every redirect
      (no SSRF).
    - The bytes must start with `%PDF-` within 1 KB, so an HTML "not found" page is never stored as a
      certificate.
    - 25 MB cap and a 20 s timeout.
    - Failed links stay unarchived and are retried on the next run.
  * **Writes only** the storage object and `coa_storage_path`, `coa_file_bytes` and `coa_archived_at`. Never
    potency, lots, stock, status, cost, CCRS, price, menu, drafts or accounting. Receiving's own archive
    (`coa-archive.ts`) is unchanged.
  * **Tests.**
    - Pure: 52 assertions.
    - vitest: 13, against the real postgrest-js fake and the real fixture COA links.
    - Mutants: 25/25 (three survivors found and pinned: the cursor filter, byte counting, and the tone for
      a bad link alone).

### A1 — "Yes, same product — always join this card" (one-click accept of the S4 hint, remembered)
  * **What.** Under a "New card" onboarding row that has an S4 suggestion, one button per suggested card.
    Pressing it saves a permanent answer: this product identity (vendor|category axis|family, exactly as the
    planner builds it) IS that live card. Every later delivery of the product then joins that card as a size
    or restock, and the chip reads "(you said it is this product)" with a "Forget this choice" button.
  * **Why a new table (0270 `intake_card_aliases`).** S32's `intake_merge_decisions` is for 2+ matches
    (check cardinality ≥ 2) and is only read in that case. This is the 0-match case. Additive, RLS on with
    no policy (service role only), `decided_by → staff_profiles on delete set null`, no FK into a WIPE
    table, factory reset KEEP (a wiped card key simply reads as stale). Rollback provided.
  * **Never a guess.**
    - The alias is consulted ONLY when the exact rule matched no live card (one match or S32 still win).
    - It applies ONLY while the card is still an eligible merge target (published, not hidden, not
      medical-only) on the SAME category axis; otherwise it is stale, the product is added as its own card
      exactly as before, and an info diagnostic `intake_master_alias_stale` says why.
    - The server re-computes the row's verdict, identity and suggestions (`card-alias-server.ts`) and saves
      only a card the scorer suggests for that row right now; a posted card key is never trusted.
    - Preview (chip) and staging (Approve) share `aliasTarget`, so what the chip says is what Approve does.
  * **Cost.** Zero extra reads unless a group matched nothing; then one chunked select (staging) or one
    re-run of the dry run (preview). A failed read (or 0270 not applied) = no aliases = the plan byte for byte.
  * **Audit.** `intake_card_alias.accept` / `.forget` audit rows and `card_alias_saved` /
    `card_alias_forgotten` manifest events. `inventory.manage` required.
  * **Tests.** Mastering self-tests 222 → 271 (+49), card-alias-core 44, vitest 25 (store on the real
    postgrest-js fake, both actions behavioural, controls render, wiring + migration pins). Related suites
    (~70 files) pass; pins updated: s13 (11 inventory.manage actions), S31 colour allowlist, S32 parallel read.
    Mutants 17/18 killed (two survivors found and pinned: a later failed chunk must discard the whole read;
    the byAlias chip copy). The one left is equivalent: `decidedTarget` needs ≥ 1 live match and the alias
    needs 0, so "alias before decision" can never change the target.

### A2 — "Do the units balance?" go / no-go page (`/admin/menu-imports/reconcile`)
  * **What.** Pick the Cultivera import (defaults to the published one). The page re-reads the exact
    inventories workbook the import made lots from (`pos-raw` bucket, `Inventories` sheet, the transform's
    own whitespace rules and `Units Available For Sale` floor) and compares it barcode by barcode with every
    lot on that import's manifests (followed wherever "Rebuild deliveries" moved them). It compares
    **received_qty** (what the import wrote), never on-hand (sales and the Oct 30 count move on-hand).
  * **Verdict.** 🟢 GO (every check passes), 🟡 GO (explained) (every line left has a note), 🔴 NO-GO.
    Any failed read is NO-GO, always; a note can never rescue it. Eight named checks (reads, total,
    barcodes, missing, extra, no-barcode rows, blank product names, whole numbers).
  * **Helpers on the page.** Read-once help box; totals; vendor and category tables (red names link to the
    filtered lines, "show only red"); barcode lookup (both sides, every lot with status); line list with
    kind chips + counts, vendor / category / text filters, "only unexplained", 200 per page with filters
    kept; every line says what it means and **what to do**, links each lot, and names the earlier delivery
    when a "missing" barcode is really a lot that already existed elsewhere (looked up by the import's own
    dedupe key, `ccrs_inventory_external_id`); CSV of the filtered lines (UTF-8 BOM, RFC 4180, formula
    guard); next-step links (import page, rebuild deliveries, count page, cutover runbook).
  * **Things you can work from the page.** (1) **Explain a line** with a note (`menu.import`); the note is
    keyed to both numbers, so if either changes the line re-opens. "Remove note" undoes it. (2) **Create the
    missing lots** (`menu.publish`) — the import's own idempotent backfill, adds only lots that do not exist,
    never touches an existing lot, audited `pos_import.backfill_lots` with `from: reconcile`. (3) **Sign off**
    (`menu.publish`, tick box) — the server re-runs the whole check and refuses NO-GO or unreadable notes;
    the page shows the last sign-off and flags it if the numbers moved since.
  * **Storage.** No migration: notes and sign-offs are `audit_logs` events (`cultivera_reconcile.explain /
    .unexplain / .signoff`, entity `pos_import`), which the factory reset keeps. The loader writes nothing
    else; a failed insert says the note was NOT saved.
  * **Verified on the real export.** Transform + lot planner on the back-office `INVENTORIES.xlsx` +
    `PRODUCTS.xlsx`: 26,249 = 26,249 units over 3,870 barcodes, GO (pinned in vitest, skipped where the file
    is absent).
  * **Bugs found by the tests and fixed.** A barcode whose only lot had a non-whole quantity was also listed
    as "missing" (so "Create the missing lots" would have counted it); junk bytes in the stored file parsed as
    a one-cell CSV and read as zero units — now refused by a header check naming the missing columns.
  * **Tests.** Core self-tests 95 (runner floor 95), vitest 38 (loader on the postgrest fake + a real xlsx in
    a storage mock, all four actions, CSV route, page render incl. roles, wiring pins, real-export pin), guide
    72 → 74 pins updated. Mutants 26/26 killed (one survivor, "GO (explained) with zero lines", pinned).

### A3 — "Preview first (writes nothing)" before every bulk apply

  * **Survey (read first, not assumed).** These already previewed: rebuild deliveries (S2c digest), the
    count, strains, the legacy removal list and Clean Slate (counts + typed phrase). Three bulk buttons
    had **no** preview: S12b "Attach vendor lab results to every Cultivera manifest", S13 "Save a copy of
    every lab certificate" (both on Product Onboarding → Cultivera manifests) and R15a "Fill received dates
    & cannabinoids from the spreadsheet" (import page). "Backfill lots" reuses the idempotent lot creation
    and is already shown by A2's reconcile page.
  * **How.** Not a second copy of the logic: the SAME functions take `dryRun` and stop right before the
    first write. `attachWciaLabResults` reads the vendor file, the lots and the exact-id lab lookup, then
    counts would-create / would-reuse / would-link; `runWciaBackfill` passes it through, writes no timeline
    line and no audit, and keeps its own resumable cursor (`lab_pv_next`, "Continue preview").
    `previewCoaArchiveBackfill` walks the same candidate query (link set, no stored copy, id keyset, cap
    20,000 rows, says so when capped) through the same URL check — no download, no upload. `fillImportLotFacts`
    re-reads the stored workbooks and runs the same `planLotFactFill`, then returns its counts.
  * **Copy.** `bulk-preview-core.ts`: every message starts "Preview - nothing was written.", speaks in
    would-words, names problems, unusable links by reason and the top hosts, and says the real run fills
    blanks only, so anything filled in the meantime is skipped (never overwritten). Tone is info / warn,
    never "done".
  * **Gates.** Same permission as the real button (`inventory.manage`); no audit, no revalidate. Receiving
    never takes the dry-run path.
  * **Tests.** Core self-tests 28 (runner floor 28). Vitest 15 on the postgrest fake: each preview makes
    zero writes / audits / uploads / fetches, and its counts **equal what the real run then does** on the
    same data (lab results incl. reuse, kept certificate, destroyed lot; certificates: candidates = checked,
    would-skip = bad-link, would-try = archived; facts: dry = real, owner-set date kept, test import refused);
    paused preview resumes; failures honest; wiring pins. Mutants 24/24 killed (one survivor, "a problem
    alone warns", pinned with a new self-test).

### A4 — Failure alerts (email + phone) for the cutover jobs

  * **What is watched (and nothing else).** The two jobs that run while nobody is looking at a screen: the
    Cultivera harvest (crawler thread, 10–30 min) and the import it feeds. Every button the owner presses
    already shows its own result on the page, so those are not alerted. Harvest started / resumed in the last
    6 h (the Start button's audit row): **failed** (critical, once per run + finish time, so a resumed run
    that fails again alerts again), **running past budget + 15 min** (warning; budget = the crawler's
    `CULTIVERA_POS_BUDGET_SECONDS`, default 1800, read from the same env name on the site if set),
    **crawler unreachable** (warning), **finished** (info: "check and import"). Imports created in the last
    24 h: **failed** (critical), **stuck "processing" ≥ 15 min** (warning). Cancelled runs say nothing (the
    owner did it). Test-mode imports are tagged "(test mode)".
  * **Channels = the existing notify infrastructure.** Email through Resend (`RESEND_API_KEY`,
    `ORDER_EMAIL_FROM`, `ORDER_STAFF_EMAILS`, via the bounded `sendStaffAlertEmail`) and Web Push to every
    staff device (`sendPushToAll`, VAPID keys). **"Text" = phone push**, on purpose (researched 2026-10-14):
    carrier email-to-text gateways are closing (T-Mobile tmomail.net Dec 2024, AT&T txt.att.net Jun 2025,
    Verizon vtext.com Mar 31 2027) and a real SMS provider needs A2P 10DLC carrier registration (days to
    weeks) — not something to start two weeks before go-live. The page says this in plain words.
  * **Claim before send (rule 12).** New cron `/api/cron/cutover-watch`, every 5 min at :02/:07/… (`2-59/5`: L-33 bans two identical
    expressions, so it is offset off content-schedule; the L-34 parser learned `A-B/N` with its own
    test-the-test cases; 288/day; pinned in the
    L-34 cadence map, the usage-5 cron count 7 → 8 and rule 12's schedule text). Each alert's key is
    INSERTED into `compliance_reminder_log` (UNIQUE dedupe_key) before sending; a doubled tick loses the
    insert and sends nothing. A claim the database refuses for another reason sends nothing (a send without
    a claim could repeat every 5 min). Every channel failing → the row says "NOT DELIVERED" and is shown red
    on the page instead of re-sending every 5 min. No channel configured → nothing claimed, so the alert
    fires the moment one is. Crawler text is HTML-escaped in the email and un-escaped for the plain-text push.
    An idle tick is two indexed reads and writes nothing. Fail-closed cron auth (copied preamble).
  * **On the cutover runbook page.** "Failure alerts (email and phone)": whether alerts can reach you (email
    on/off with recipient count, push on/off with device count, what to set when off), the text note,
    **Send a test alert** (menu.import; logged + audited; says plainly when no channel exists) and **Alerts
    sent** (newest 20, real + test, each "Delivered by email and phone (…)", "Sending now",
    "Sending was interrupted" or "Not delivered"). No migration (the log table and its channel check exist).
  * **Tests.** Core self-tests 37 (runner floor 37). Vitest 24 on the postgrest fake with the real unique
    rule: once by email + push and never again; two overlapping ticks → exactly one send; resumed failure →
    new alert; no channel → nothing claimed then fires; push-only; every channel failing → not resent; claim
    refused → nothing sent; unreachable; 6 h / 24 h windows; other audit actions ignored; budget env;
    crawler unconfigured; idle tick writes nothing; test button both ways; log shows only cutover rows; page
    and route wiring; wrong secret 401. Mutants 42/42 killed (3 first-round survivors — resumed-run dedupe,
    a 0 budget, the email HTML — each pinned by a new assertion).

### A2+ — "Work it and fix it" helpers on the go / no-go page (owner follow-up)

* **Why.** The owner: "make sure the new reconciliation page has tons of helper features and functions. If
  something needs worked, make sure I can work it and fix it." A2 showed every line and let him note it one
  at a time; with hundreds of lines after a real import that is too slow and too easy to lose your place.
* **What he can do now** (`/admin/menu-imports/reconcile`, nothing here changes stock):
  * **Progress** under the verdict: "N open, M explained (P% done)" with a bar (floors, so 100% only when
    nothing is open) and **Start working: go to the first line without a note**.
  * **Save & next** on every open line: saves the note, then lands on the next line without a note (wraps
    round, skips noted ones, keeps his filters, scrolls to it and rings it gold). The jump key is validated
    on the server; a junk key just saves without jumping.
  * **?jump=** opens whichever page the line is on (beats ?page), used by Save & next, Start working, the
    barcode lookup ("Go to the line and write a note" / "See its note") and the latest-notes list.
  * **Work many lines at once**: one note on every OPEN line in the current view (all pages), and **Remove the
    notes** (the undo) on every noted line in the view. The page sends the count he saw; the server re-reads
    the lines with the same filter and refuses if the count moved ("Nothing was saved"), if the box is not
    ticked, over 500 lines, or if his notes cannot be read (never guesses which lines are open). One
    all-or-nothing insert, one audit row per line, each marked `bulk: true`.
  * **Note suggestions** (click the note box): his own latest notes first, then ready-made notes for that
    kind of line. **Your latest notes** list with a link back to each line.
  * **Open column** in the vendor and category tables: a link to just that group's lines still needing a
    note; a tick when a red group is fully explained.
  * The page, the CSV download and the bulk buttons read the filter with ONE function (`filterFromParams`),
    so all three always act on the same lines.
* **Tests.** Core self-tests 95 → 120 (runner floor 120). New `r50-a2-helpers.test.tsx`, 18 behavioural tests
  on the same postgrest fake + real .xlsx as A2 (bulk: only open lines, filters honoured, stale count
  refused and nothing written, no tick / short note / bad id / notes unreadable / failed insert, the 500 cap,
  undo; Save & next; jump paging + highlight; open counts; suggestions order; CSV filter). A2's gate pin
  moves 2 → 3 menu.import (the shared bulk helper). Mutants 45/45 killed.

### A7 — Barcode-first matching (a re-delivered lot joins its live card before any name rule)

* **Why.** The barcode IS the lot number (owner, clarification #2). A WCIA line without a `product_sku` gets
  `pos_product_key` = its barcode, while the Cultivera card for that product is keyed `pos-<hash>`, so the
  key never matched and only the name rule could find the card. If the vendor renamed the product (or spelled
  it differently) the re-delivery became a SECOND card. Measured on the committed `TRANSFERS_INDEX.json`:
  **900 barcodes sit on 2+ real transfers** (re-deliveries, §1.9), and **no barcode is ever accepted from two
  vendors (0 of 24,622)**.
* **The rule** (`intake-mastering-core.ts` `barcodeTarget`, run for each delivery lot AFTER "already a size
  on a live card" and BEFORE the vendor / name / S19 vendor-id / S32 decision / A1 alias rules):
  the lot's `inventory_lots.lot_code` (= Cultivera Barcode = WCIA `inventory_id`) is already a lot on ONE
  live card → the lot joins that card as its own `-onboarded` size (price, label, stock, medical kept; pack
  sections carried like any merge). Diagnostic `intake_master_restock` with `matched_by: "barcode"`.
* **Never guessed — each of these falls through to the rules before A7, byte for byte, plus one FYI note
  `intake_master_barcode_unused` ("Same barcode on the menu, matched by name instead"):** lots on 2+
  different live cards carry the barcode (`ambiguous`); the card is hidden, medical-only, has no vendor or a
  vague name (`not_a_target`, the same eligibility as every merge); another category axis
  (`other_category`); both sides carry a vendor id and any live lot's differs (`vendor_differs`).
* **What a barcode is.** `^[A-Za-z0-9][A-Za-z0-9.-]{7,63}$` — 24,710 of the 24,713 barcodes in the transfer
  index match; the 3 that do not are junk ("1", "Fire Bros AIO Phone Case", "Firebros Lanyard"), and the 8
  misses in the inventories export are accessories ("RBBW", "giraffe", "D-0005" ...). Anything else is "no
  barcode". Case is kept, never folded.
* **Reads** (`restock-preview-server.ts` `loadBarcodeInputs`, shared by staging and the Onboarding preview so
  the chip and Approve agree): the drafts' own lots by id, then the lots carrying those barcodes — two named,
  paged, id-ordered reads. The delivery's own lot rows never count as live. Flag `INTAKE_BARCODE_FIRST=off`,
  nothing live, a refresh (S3c), more than 1,000 barcodes, or ANY failed page → no inputs = the plan before A7.
* **The chip** on Product Onboarding: "Restock → joins live card 'X' (same barcode)", with the barcode in the
  sentence under it.
* **Intake / receiving.** Nothing about receiving, quarantine, COAs, CCRS ids or stock changes. The ONLY
  difference: a lot whose barcode already sells on one eligible live card now joins that card instead of being
  matched by name. Every other lot is planned exactly as before (pinned byte-for-byte in the self-tests).
* **Tests.** New `barcode-match-core.ts` (34 self-tests, in the runner; a lot claimed by two live cards lists both, so it is `ambiguous`). Planner self-tests 271 → 327 (+56:
  join, beats name / ambiguous / alias, every unsafe reason byte-identical, absent/empty byte-identical,
  already-a-size wins, mixed delivery, preview). New `r50-a7-barcode-first.test.ts` (12: the loader on the real
  postgrest-js client — reads, own-lot exclusion, flag/empty/failed/missing table → none; end to end; owner
  words; wiring order pins; a failed SECOND draft page and >1,000 barcodes → none). S32/S34/S19 count + wiring
  pins moved with comments. Mutation: 64 mutants, 63 killed, 1 documented equivalent (dropping the joined
  category from `filter_categories` — the injected variant already carries it).

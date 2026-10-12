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
| **S3** | Onboarding for reconstructed manifests: seed drafts even when the key is live (`reonboard` mode, flagged "already on the menu"); a "Cultivera manifests" section in the onboarding picker; approval never touches the live card's visibility | planner tests; picker lists them |
| **S4** | Intake suggestion: on a receiving line, "Looks like Cultivera product X" from the imported history (same vendor via the shared vendor/brand keys, token similarity on the product family + size), shown as a suggestion with evidence, never applied automatically | pure scorer tests incl. real naming variants |
| **S5** | Crawler: Cultivera POS back-office login (cached token with JWT exp, 401 re-login, human pace), harvester: inventories → batches → COA PDFs into a folder + `harvest.json`/`harvest.csv` (barcode, batch id, batch number, product, vendor, received, transfer #, lab, COA file, sha256), optional upload to the private `coa` bucket; incoming transfers recorded too | pytest (pure + mocked HTTP) |
| **S6** | Onboarding "Attach harvested COAs": read the harvest (storage folder or uploaded files), marry by §2.7 rank, LlamaParse/unpdf read through the existing COA readers, create `lab_results` + link lots where none is linked, then the existing lab-facts attach | pure matcher tests on the 35 real fixtures |
| **S7** | Crawler logged-in social reader: `storageState` capture script (headed, owner logs in by hand), session cache + validation + expiry, login-wall detection, profile/post extraction, drafts-only; `/research-social` falls back to it when no Graph token | pytest |
| **S9** | The cutover button (§3b): Railway `cultivera_pos` job (Phase A/B, resumable, read-only guard) + supplemented workbook builder + link-first manifest plan + progress page on `/admin/menu-imports` with the go/no-go report; manual upload kept as fallback | pure cores + pytest + rehearsals #2–#4 pass §3b.6 |
| **S8** | Railway steps doc, final report + test strategy PDFs | delivered |

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

- **2026-10-12, S2a: Cultivera migration stock never reaches payables or the books (\u00a71.4).**
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
      * Re-measured after a sandbox reset, with the same result.
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
  * Next is **S2b**: the \u00a71.3 readers must follow moved lots by import id, not by the `POS-IMPORT-<id8>`
    number. That has to land before the S2c executor moves any lot.

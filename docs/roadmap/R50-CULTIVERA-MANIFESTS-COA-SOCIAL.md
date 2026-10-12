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

Only ONE same-day pair is more than 60 min apart (AGRO COUTURE 2025-07-09 11:45 → 20:33): two deliveries on
one day, correctly split. The result is stable from 60 min upward, so 60 is the default and it is configurable.

### 1.2 What the live import keeps (verified in code)

* `transformWorkbooks` reads with `cellDates:false, raw:false`; SheetJS returns the cell's text verbatim
  (`"2026-07-02 09:32:07.787000"`, probed with the repo's own `xlsx`).
* **`parseUsDate` accepts only `M/D/YYYY` or `YYYY-MM-DD`, so it returns `null` for this timestamp format**
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
| **S1** | `cultivera-manifest-group-core.ts`: timestamp parser (3 shapes, Pacific), per-vendor sessions (same Pacific day + gap ≤ G), undated bucket, earliest-row-per-barcode, stable group keys + manifest numbers; `isReconstructedManifest` predicate | self-tests + vitest on the REAL export reproduce §1.1 numbers (651 / 137 / 71 / 53) |
| **S2** | Reconstruct executor (re-read stored workbook → plan → create manifests idempotently → move lots guarded on source manifest → events + audit); Menu Imports panel: preview (counts, biggest, examples, gap choice) + Apply; every `POS-IMPORT` reader follows the lots (§1.3); accounting exclusion (§1.4) | tests; reruns are no-ops |
| **S3** | Onboarding for reconstructed manifests: seed drafts even when the key is live (`reonboard` mode, flagged "already on the menu"); a "Cultivera manifests" section in the onboarding picker; approval never touches the live card's visibility | planner tests; picker lists them |
| **S4** | Intake suggestion: on a receiving line, "Looks like Cultivera product X" from the imported history (same vendor via the shared vendor/brand keys, token similarity on the product family + size), shown as a suggestion with evidence, never applied automatically | pure scorer tests incl. real naming variants |
| **S5** | Crawler: Cultivera POS back-office login (cached token with JWT exp, 401 re-login, human pace), harvester: inventories → batches → COA PDFs into a folder + `harvest.json`/`harvest.csv` (barcode, batch id, batch number, product, vendor, received, transfer #, lab, COA file, sha256), optional upload to the private `coa` bucket; incoming transfers recorded too | pytest (pure + mocked HTTP) |
| **S6** | Onboarding "Attach harvested COAs": read the harvest (storage folder or uploaded files), marry by §2.7 rank, LlamaParse/unpdf read through the existing COA readers, create `lab_results` + link lots where none is linked, then the existing lab-facts attach | pure matcher tests on the 35 real fixtures |
| **S7** | Crawler logged-in social reader: `storageState` capture script (headed, owner logs in by hand), session cache + validation + expiry, login-wall detection, profile/post extraction, drafts-only; `/research-social` falls back to it when no Graph token | pytest |
| **S8** | Railway steps doc, final report + test strategy PDFs | delivered |

## 4. Status log

* 2026-10-12 — recon complete, bible written (this commit). No code yet.

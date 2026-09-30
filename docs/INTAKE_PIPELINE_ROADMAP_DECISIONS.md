# Intake Pipeline — Owner Decisions & Roadmap Additions

This file records the owner's answers to the open questions in the intake
pipeline audit (bible `INTAKE_PIPELINE_BIBLE.md` §18.5 / §18.6, executive
report §8), plus roadmap items the owner added after Round 5. Every fact here
has a file:line citation that was checked at commit `3e35824e`. Where the owner
said "I think", the code was checked, and the result is written down, even when
it disagrees.

A pin test (`tests/compliance/intake-roadmap-decisions.test.ts`) keeps the
code facts below honest. If one of them stops being true, that test fails and
this file has to be updated.

---

## D-R3-1 — Who may key a missing unit cost? (S33)

**Owner answer (Round 6, verbatim):** "owner and admin can add cost if
missing. It never will be though, the states CCRS is extremely strict about
this. So I'm almost hesitant to build it. It can only be used for non cannabis
inventory. No product I upload from Cultivera will come without a cost
assigned. Our system refuses to accept the manifest if it doesn't have a cost
assigned even, I think. So let's not build this for the cannabis inventory, but
we should for non cannabis inventory."

**Decision:** S33 is **rescoped**. Cannabis cost entry is **not built**.
S33 becomes non-cannabis cost entry, S33-NC below.

### What the code actually does with a cannabis line that has no cost

The owner's "I think" was checked. The system does **not** refuse the manifest.
Only the books refuse the vendor bill.

| Step | What happens to a line with no price | Where |
|---|---|---|
| Parse | Parse accepts it. `unit_cost_minor_units` stays `null` when the JSON has no `line_price`. | `src/lib/inventory/intake-parser.ts:391-397` |
| Invoice merge | Cost is filled from the vendor invoice by lot, when an invoice is attached. | `src/lib/inventory/manifest-merge-core.ts:174` (`mergeInvoicePricesByLot`) |
| Review | Review adds an **info** flag only ("No unit cost on this line — confirm pricing."). Info does not block review. | `src/lib/inventory/intake-review-core.ts:176-177` |
| Finalize | The manifest finalizes and the lots are received. | `src/app/admin/inventory/intake/actions.ts:804` (`finalizeManifestAction`) |
| Vendor bill | The **whole bill** is refused with `BILL_LOT_COST_UNKNOWN` ("Key the unit costs, then finalize again"), and `vendor_bill_refused` is logged. | `src/lib/accounting/vendor-bill-service.ts:262-284` |

So in theory a no-cost cannabis line can enter inventory. The owner reports
that in practice it never happens: CCRS and Cultivera always carry cost.
Because of that, we are **not** building a cannabis cost-entry screen. If a
`BILL_LOT_COST_UNKNOWN` refusal ever shows up in the audit log, reopen this
decision. The refusal already fails safe, because nothing partial is posted.

### Non-cannabis: the real gap (S33-NC, new scope)

| Fact | Where |
|---|---|
| A blank cost field becomes **0**, not "unknown". | `src/app/admin/inventory/noncannabis/actions.ts:29-34` (`dollarsToMinor` returns 0 for `""`) |
| The product column is `cost_minor_units integer not null default 0`, so "unknown" and "free" look the same. | `supabase/migrations/0076_noncannabis_products.sql:43` |
| Invoice lines allow `unit_cost_minor_units >= 0`, so $0.00 is accepted. | `supabase/migrations/0112_noncannabis_vendor_invoices.sql:89` |
| There is **no way to edit cost after creation**. The only edit action changes barcode, reorder point and location. | `src/app/admin/inventory/noncannabis/actions.ts:153` (`updateNonCannabisOpsAction`) |
| Every non-cannabis action is gated by `inventory.manage`, which is owner, admin **and manager**. | `src/lib/auth/roles.ts:97` |

**S33-NC scope (proposed, not built yet):**

- Add a "Cost" edit on the non-cannabis product page that fills **only when the cost is 0**.
- Parse the input with the existing bulk-fill `parseCostInput`.
- Record an audit event with before and after values via `recordAudit` (`src/lib/auth/audit.ts:19`).
- Show a "Cost missing" chip on $0 products, so they can be found.

**Role:** the owner said "owner and admin". Today's `inventory.manage` and
`payables.manage` both also include **manager** (`roles.ts:90,97`). There is no
owner/admin-only helper today: `session.ts` exports only `requireStaff` and
`requirePermission`. The permission map does have owner/admin-only permissions
(`users.manage`, `settings.manage`), but they mean other things. S33-NC will
therefore add a dedicated permission, e.g. `inventory.cost.fill` =
`["owner","admin"]`, in `roles.ts`, rather than borrow an unrelated one. **To confirm when S33-NC starts:** should
managers be excluded, as stated, or included, as the permission map would do by
default?

**Resolved when S33-NC started (Round 13):** managers are **excluded**. This
follows the owner's words, "owner and admin can add cost if missing". No new
answer was assumed. The permission is `inventory.cost.fill` = `["owner","admin"]`
(`src/lib/auth/roles.ts`). If managers should be allowed, it is a one-line
change to that list.

**S33-NC as built (Round 13):**

| Piece | Where |
|---|---|
| Pure rules: missing = cost 0 and not archived; fill only a 0; refuse a 0 fill; parse with `parseCostInput` | `src/lib/noncannabis/cost-fill-core.ts` (`planCostFill`, `isCostMissing`) |
| Race-guarded write: `.eq("cost_minor_units", 0)` and `.neq("status","archived")` | `src/lib/noncannabis/store.ts` (`fillNonCannabisCost`) |
| Action, gated by `inventory.cost.fill`, with before/after `recordAudit` (`noncannabis.cost_fill`) | `src/app/admin/inventory/noncannabis/actions.ts` (`fillNonCannabisCostAction`) |
| "Cost missing" chip, a "Cost missing only" filter, the cost box in the row panel and on draft rows, and a banner with a count and link | `MerchCatalog.tsx`, `page.tsx` |

`updateNonCannabisOpsAction` still cannot change cost. Cost has its own action,
so a settings save can never touch it.

---

## S32 as built — a remembered choice must survive the product's own card (Round 13)

**Found in the code, not assumed.** Before the owner answers, the planner
adds a look-alike product as its **own new card**, keyed by its smallest lot
key (`ownCardKeyOf`, `src/lib/pos/intake-mastering-core.ts`), and the update
auto-publishes. The next delivery then matches the old cards **plus that own
card**, so a choice saved against the old cards alone would go stale on the
very next delivery. So the warning carries `own_card_key`, migration 0239
stores it, and `mergeDecisionVerdict` accepts exactly two matched sets: the
saved candidates, or the saved candidates plus the own card. Any other set
is stale and is never applied. A join can never target the own card. Two old
live cards are never merged here (D-R3-2); a duplicate is hidden from its
product page's Visibility control.

After a save, the match page reports what the rebuild actually did
(`mergeSaveResultCode`), and never claims the menu changed when it did not.

---

## R14a as built — publish now, fix after (Round 14)

**Found in the code, not assumed.** `evaluateCommitGate` refused on any
pending fact-review row, in the Publish preview and again inside
`publishMenuVersion`, so a fresh Cultivera upload (~600 pending rows) could
not go live. The owner or an admin may now tick “Publish now, fix after”
(permission `menu.publish.open_reviews`). The form posts the pending count
they saw; the gate honours it only while pending ≤ that count. Imbalance and
untrustworthy evidence still refuse first. Rows stay pending (nothing is
approved for anyone); the publish is audited as
`menu_version.published_with_open_reviews`. Every later decision also lands
on the live/staged intake-origin versions and refreshes the public menu, so
fixes made after publishing reach the site.

---

## R14b as built — the remaining Cultivera fix-its (Round 14)

**Measured on the real export, not assumed.** `INVENTORIES.xlsx` (3917 rows):
Cultivera's InventoryType column holds CCRS types; its Category matches our
catalog. `cultivera-type-from-category-core` derives OUR type and the expected
CCRS type from the Category. On the real rows 3790 agree and 127 are flagged:
125 are type mismatches (largest: Infused Pre-roll filed as Usable Marijuana
×85), shown with advice to correct the CCRS type in Cultivera, because the
CCRS type is the regulator's value and is never rewritten here. Two are
category suspects (the name and the CCRS type both disagree with the
category: a Panda Candies row that reads as a pre-roll, and a Roll On row
named “Infused Pre-roll”). Only those two get a one-click “Re-file as …”
(owner/admin, `inventory.manage`), which writes a product classification
override validated against the live registries and audited as
`menu_import.type_check_refiled`. Unknown categories get a grounded placement
(Dab Rig → paraphernalia per WAC 314-55-010(34); a category that names a
catalog type → that type), prefilled on the Types page.
“Count these products” now opens a count preloaded with every active lot
of every flagged mixed-size card: the import stores all keys, and the planner
ignores due-ness and the budget. Fact Review adds a one-reason-at-a-time
view (the focus is kept after each save) and a “Use these values” button
for values the product name states outright. No migration.

---

## Q-02 — How many manifests per week?

**Owner answer:** 15–20 manifests per week, about 65–87 per month.

Checked against the caps that depend on it:

| Cap | Value | Covers 15–20/wk? | Where |
|---|---|---|---|
| Onboarding manifest picker window | 30 days | yes (~65–87 manifests in the window) | `src/lib/catalog/onboarding-list-core.ts:67` |
| Picker max manifests | 100 | yes, about 13 manifests of headroom at the top of the range | `onboarding-list-core.ts:68` |
| Legacy draft read | 500 | yes | `onboarding-list-core.ts:61` |
| Picker draft count cap | 5000 | yes | `src/lib/inventory/catalog-drafts.ts:692` |

**Watch item:** at 20 per week a 30-day window holds about 87 manifests. If
volume rises above about 23 per week (about 100 in 30 days), the picker's
100-manifest cap will start dropping the oldest manifests in the window. The
picker already says when it is capped (S14).

**Still open from Q-02:** lines per manifest per week and how many lines
arrive with no SKU. These size the S05 identity backfill and the F-086
classification-memory scan. They have not been answered, so nothing here
assumes them.

---

## R-LLAMA — One more try at LlamaParse invoice # and transport details

**Owner request (Round 6, verbatim):** "Will you also add to the roadmap
strategy to try one more time to get llama ai to work better to extract invoice
numbers and transportation manifest details. It really struggles, and we've
tried 2-3 times already, I just don't get why it's so hard for it, it's in
quality PDFs but it still struggles."

### Prior attempts (git history)

| PR | What it did |
|---|---|
| #797, #798 | LlamaParse provider (PR-1, PR-2) |
| #799 | LlamaParse made the **primary** PDF reader, with unpdf as the outage fallback |
| #802 | LlamaParse status page |
| #803 | Invoice-number regex (`extractInvoiceNumberFromText`) |
| #804 | "Run AI extract" + driver license reader (`readDriverLicenseNumber`) |
| #805 | Manual invoice-number override (migration 0151) |

### Root cause — proven, not guessed

**LlamaParse is reading the PDFs correctly. Our code cannot read LlamaParse's
answer.**

- We ask LlamaParse for **Markdown**: `result_type: "markdown"` in `src/lib/inbound-email/llamaparse-core.ts:123`. We then fetch `/api/v1/parsing/job/{id}/result/markdown` in `llamaparse-provider.ts:125`.
- Since #799, that Markdown is the **primary** text for every PDF (`src/lib/inventory/pdf-extract.ts:64-105`).
- The field scanners were written and tested against **unpdf's flat text**, for example `Invoice #: INV-15121 Order #: 15121`. They were never tested against Markdown.

A probe ran the real functions on the same values in both shapes:

| Input shape | `extractInvoiceNumberFromText` | `readDriverLicenseNumber` |
|---|---|---|
| Flat text (unpdf) | ✅ found | ✅ found |
| `**Invoice #:** INV-15121` (bold label) | ❌ null | ❌ null |
| `**Invoice #** INV-15121` | ❌ null | — |
| `\| Invoice # \| INV-15121 \|` (table, label and value in one row) | ❌ null | ❌ null |
| Table with header row, then value row | ❌ null | ❌ null |
| `Invoice \# 0000020830` (escaped hash) | ❌ null | — |
| `## Invoice Number: 0000020830` (heading) | ✅ found | — |

Markdown adds `**`, `\#`, `|` and header/value rows. That breaks every label
followed by value pattern except headings. This is why each earlier regex fix
helped for a while and then "struggled" again: each fix was tuned to whichever
text shape was in front of us.

### Strategy (one slice, S-LLAMA, Ring 1 then Ring 2)

1. **Golden set first (the acceptance bar).** Collect 10–15 of Michael's real
   manifests and invoices, covering every vendor layout seen in 30 days. For
   each one, commit the redacted LlamaParse Markdown **and** the unpdf text as
   fixtures. Next to each fixture, record the hand-checked truth: invoice #,
   driver name, driver license #, vehicle make/model/plate, departure and
   arrival times. No fixture is added without a hand-checked truth.
2. **Markdown to label/value normalizer (pure core).** Add
   `markdown-fields-core.ts`, which turns Markdown into the flat
   `Label: value` lines the scanners already understand:
   - strip `**` and `__`;
   - unescape `\#`;
   - turn a two-cell `| Label | value |` row into `Label: value`;
   - turn a header row plus value row(s) into `Header: value` pairs by column;
   - drop `|---|` separator rows.

   The existing scanners run on the normalized text. This is a pure function
   with embedded self-tests and mutation testing, and no scanner logic is
   rewritten.
3. **Structured tables, only if the golden set needs them.** The LlamaParse v2
   API can return `text` and `items`, which are tables as rows, alongside
   Markdown in the **same** job (`expand=`). If step 2 misses a golden field,
   read the label from the `items` table cells instead of regexing text. This
   still makes one parse call per PDF.
4. **Per-field acceptance.**
   - Invoice #: at least 95% exact match on the golden set.
   - Driver license # and plate: at least 90%.
   - **Zero wrong values.** A miss must be `null`, never a guess (never-guess rule).
   - The existing manual override (0151) stays as the fallback.
5. **Shadow before switching.** Ring 1 logs "normalized says X, legacy said
   Y" through `recordAudit` (`src/lib/auth/audit.ts:19`) for two weeks of real traffic, about 30–40
   manifests. After that, Ring 2 uses the normalized value.
6. **Cost.** Zero extra LlamaParse calls. Same parse count, about 65–87
   manifests per month. No new egress, polls or crons.
7. **Later, optional:** LlamaParse structured-output / extraction schema for
   the header block, but only if the golden set still misses fields after
   steps 2–3.

**Placement:** added after S33 as **S34 (R-LLAMA)**. It does not depend on
Phases 3–7, so it can move earlier if invoice numbers hurt more than the
publish work.

---

## R-COA-CSV: a possible upload for Cultivera's COA spreadsheet (Round 12)

**Owner, verbatim:** "I will ask Cultivera if they can send me the coa data in a
spreadsheet for us to add to the database. Add that to the roadmap that a
possible new uploadable csv might be needed to be built to handle this."

**Why it's needed (verified in code):**
- The one-time Cultivera import only gets a Y/N COA flag from the POS export.
  When the flag is N it logs `import_lot_coa_missing`
  (`src/lib/pos/import-lot-core.ts:410-418`).
- It never creates a lab result. The only insert into `lab_results` is intake
  finalize (`src/lib/inventory/intake-store.ts:663`).
- So every Cultivera-import lot has `inventory_lots.lab_result_id` NULL and
  stays on the missingCoa gap.
- Since R12a, the Issues row and the lot-page callout say honestly that this
  import is on the roadmap. They no longer pretend a fix exists.

**Plan: slice S38 in the bible (finding F-135).** It is waiting on one sample
file from Cultivera. The importer detects which file shape it got rather than
assuming one:

1. **CCRS LabTest.csv (long format, one row per test).** Fields per the LCB
   CCRS Data Model File Specifications Manual:
   - `LabLicenseNumber` (10 digits)
   - `LabTestStatus` (Pass / Fail / FailRetestAllowed / … / InProcess)
   - `InventoryExternalIdentifier` (= Inventory.ExternalIdentifier)
   - `TestName` (for example `Potency - delta-9-THCA (mg/g)`)
   - `TestDate` (mm/dd/yyyy)
   - `TestValue` (text 25)

   The CCRS Lab Upload Guide (11-27-24) adds three rules. Values are never
   zero, negative or in scientific notation. A non-detect is `<LOQ`.
   `TestValue` is blank for InProcess.
2. **A wide per-lot sheet** (lot/barcode, THC %, CBD %, lab, date, COA link).
   It reuses `parseGenericLab` (`intake-parser.ts` L518-547) and the
   `ccrs-manifest-csv-core` header mapper. No third CSV parser.

**Rules:**
- **Matching.** Match on `ccrs_inventory_external_id` first
  (`import-lot-core.ts:420`, indexed in `0034`), then exact `lot_code`. Never
  fuzzy-match.
- **Which lots it can fill.** Only Cultivera-import lots (`MIGRATION_MARKER`)
  that have no COA. The update is guarded with `.is("lab_result_id", null)`.
- **Review.** Preview first, then confirm. Each attached lot gets one audit
  event.
- **Data kept.** mg/g ÷ 10 = %. Every raw row is kept in `analytes_json` /
  `raw_payload`. Rows are tagged `source = 'cultivera-coa-csv'`.
- **Scope.** Intake lots are never touched.
- **Schema.** None expected; `lab_results` and `lab_result_id` already exist
  (0023/0024). A unique index for re-upload idempotency would be an
  owner-applied migration, and the code stays no-op-safe until it is applied.

**Sources:**
- https://lcb.wa.gov/sites/default/files/publications/Cannabis/CCRS/CCRS%20Data%20Model%20File%20Specifications%20Manual.pdf
- https://lcb.wa.gov/sites/default/files/2024-12/CCRS%20Lab%20Guide%2011-27-24.pdf

**Numbering note:** R-LLAMA above was called "S34" before Round 11 took S34
for the mastering preview. In the bible, S34 = mastering preview and S38 = this
COA import. R-LLAMA keeps its request code and gets a slice number when it is
scheduled.

## R-COA-ZIP: Cultivera's COA PDFs as one ZIP (Round 12)

**Owner, verbatim:** "i have confirmed from my cultivera back office, that pdfs
exist for all the inventory in our back office, which means cultivera can send
me all of them, hopefully in one big zip file. so update the roadmap to include
this."

**Why it's needed (verified in code):**
- Both COA archivers are keyed by an intake manifest and write onto an
  existing `lab_results` row:
  - `archiveCoasForManifest`, `src/lib/inventory/coa-archive.ts:109`
  - `archiveEmailedCoaForManifest`, `:174`
- A Cultivera-import lot has neither a manifest nor a lab row
  (`import-lot-core.ts:410-420`). So even with every PDF in hand, there is no
  way today to store one against it.
- No ZIP reader is installed. `package.json` has `unpdf` only.

**Plan: slice S39 in the bible (finding F-136).** It shares the page and the
matcher with S38.

1. **Upload.** A Vercel Function body is capped at 4.5 MB
   (vercel.com/docs/functions/limitations). So the browser uploads the ZIP
   straight to a Supabase Storage signed upload URL in the private `coa`
   bucket, and a server action then processes it in resumable batches. There
   is no poll or cron: the manager presses Process / Continue.
2. **Safe ZIP reading** (OWASP File Upload Cheat Sheet):
   - Stream the entries.
   - Keep only the base name (zip-slip).
   - Enforce limits on entry count, per-PDF size (reuse the 25 MB
     `MAX_BYTES`), total size and compression ratio (zip bomb).
   - Accept only files that start with the `%PDF-` magic bytes.
   - Reject nested ZIPs.
3. **Matching (never fuzzy).** In order:
   1. the CCRS inventory id in the file name → `ccrs_inventory_external_id`;
   2. then the exact lot code;
   3. then a lot id found in the PDF's text layer.

   Anything ambiguous goes to a review list.
4. **Which lots it can fill.** Only Cultivera-import lots that have
   `lab_result_id IS NULL` (guarded update). Intake lots are never touched.
5. **Writes.** Store the PDF at `coa/<lab_id>/<name>.pdf` (the existing
   convention) and insert `lab_results` with `source='cultivera-coa-zip'`.
   A SHA-256 makes a re-upload idempotent. One audit event per import and one
   per lot.
6. **Schema.** Probably a small owner-applied `coa_imports` table (counts and a
   cursor). The code stays no-op-safe until it is applied.

## R-COA-EXTRACT: read the terpene profile (and everything else) off every COA (Round 12)

**Owner, verbatim:** "a lot of the coa pdfs have the terpene profile in the
analysis, and in the json that gets used by intake, has a link to the coa pdf
that has the terpene profile. a lot of times, the email we get with manifest
and invoice docs, will have a coa doc with it, so we have the coa saved in the
system. i want either llama parse to extract the terpene data, or if easier, to
use the provided url.pdf file in the json file and have llama parse extract it
from there. there is good information in these coa docs and we shouldn't be
throwing them in storage somewhere without extracting their useful data."

**Why it's needed (verified in code):**
- `lab_results.terpenes_json` and `analytes_json` exist (`0023:64-65`), but they
  are filled only when the vendor JSON itself carries `terpenes`
  (`intake-parser.ts:354`).
- The emailed-COA parser hard-codes both to null (`pdf-coa-core.ts:194-195`).
- The PDFs are archived, both from the JSON `coa` URL (`intake-parser.ts:357`
  → `coa-archive.ts:109`) and from the email attachment (`:174`), and then
  never read.
- The menu's terpenes come only from the curated strain KB
  (`strain-terpenes.ts:84`).
- LlamaParse is already wired (`llamaparse-provider.ts`).

**Plan: slice S40 in the bible (finding F-137).**

1. **Which source.** The owner's two options converge. Once archived, the JSON
   URL's PDF *is* the stored object at `coa_storage_path`.
   - S40 reads the archived PDF first: it is already ours and survives the lab
     removing the link.
   - Only if nothing is archived does it fetch the JSON `coa` URL, through the
     existing `archiveOneCoa` guard (20 s timeout, 25 MB).
2. **Extractor.** LlamaExtract (same LlamaCloud key) with a pinned schema
   version, `cite_sources` and `confidence_scores`.
   - Endpoint: `POST /api/v2/extract` with `extraction_target: "per_doc"`
     (developers.llamaindex.ai/llamaparse/extract/guides/configuring-extract).
   - The fallback is LlamaParse markdown plus a pure table reader, via the
     existing `parsePdfWithFallback`.
   - Following LlamaIndex's guidance, the extractor returns clean values and
     the app computes the rest (% ↔ mg/g, totals).
3. **Never guess.**
   - Terpene testing is optional for WA labs (WAC 314-55-102), so a missing
     panel is stored as "not tested", never as zeros.
   - `<LOQ`/`ND` are kept as text.
   - A value is only accepted if its unit is recognised.
   - The lot/sample id must match before anything is written.
   - A low-confidence result goes to review.
   - Vendor-JSON terpenes stay authoritative.
   - Every value carries provenance (source, storage path, sha256, page,
     confidence, extractor version).
4. **Menu.** A lab-measured terpene overlay runs before `attachTerpenes`, which
   already skips items that have terpenes. The KB remains the labelled
   "typical for this strain" fallback.
5. **When it runs.** Inline, best-effort, after the existing archive step at
   intake finalize (intake-store.ts:1415) and after an S39 attach. For the COAs
   already stored, the owner presses a backfill that shows a credit estimate
   first. Every call is logged to `ai_usage` (feature `coa-extract`). No crons
   or polls.
6. **Schema.** No new columns are needed for the values. `coa_extracted_at` /
   `coa_extract_status` would be owner-applied, and the code stays no-op-safe
   until then.

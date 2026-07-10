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

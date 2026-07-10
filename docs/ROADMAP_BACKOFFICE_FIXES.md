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

### Task E — Preserve filters/sort on back navigation  `[ ]`
On the Vendors & Brands page, fix the back buttons and the breadcrumb / in-page return button
on the vendor detail page so that returning to the list restores the same filters and sorting
that were active before.

### Task F — Combine / merge duplicate vendors  `[ ]`
Add a function/method to combine vendors (dedupe). Producer-processors may carry multiple LCB
license numbers → multiple vendor cards. The owner wants to merge 2–3 duplicate cards into one
combined card that carries all info from all the merged cards.

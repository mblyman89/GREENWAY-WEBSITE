# Slice 20 — The warning box that finally tells you where to go, and reprinting any past receipt

Michael asked for two things in one breath, and they turned out to share a root:
a screen that tells you something is wrong without telling you where to fix it.

> "will you tell me how I can reprint past order receipts in our register? I see I
> can reprint the last transactions receipt, but not any others. is that what you
> are saying about above, that it is not wise to give that ability, or is that
> feature of ours just not connected yet and so I cant see it yet? let me know in
> the summary report at the end of this next slice. if we need to connect it, then
> lets do that and give us a button for that feature. but if is against industry
> standards then we dont need it. I just feel it might be handy. I will let you
> decide. I have had a chance to inspect the inventory not showing up on the
> register. I see in the inventory page that there is a big warning box with all
> the products not on the menu yet. so far I see two reasons, but there may be
> more, the list only shows 25 at a time and I have 973 that I need to figure out.
> the first is "— Approve it in Product Onboarding, then publish the menu." there
> are two in this category. the rest are "— Un-hide the product in the back
> office." when I click either issue, it takes me to the product detail page of
> the affected product, but there is nothing for me to do there that I can see
> that would unhide them and approve them. will you deep recon this and link those
> warning errors to where I should go to fix them. then link all of them so I can
> work through them all. if there is a possibility to make the process more
> efficient and quicker, please add in any genius expert professional logic to get
> it done as quickly and efficiently as possible. follow the standing rules and
> never guess, never assume. go above and beyond for me. test the connections and
> the redirects and such so everything points where it should. thank you!"

The standing rule governed every line below: **do not guess, do not assume. we
build from fact, not memory.** Every claim in this document carries the file and
line it was read from, and every behaviour was proven by a test that fails when
the behaviour is removed.

## Part one — the answer to the reprint question

The short version, because Michael asked directly and deserves a direct answer:
**it was never a policy decision, and it was never "unwise." The feature simply
was not connected.** Nothing was being withheld and nothing was being protected
against. There was exactly one receipt the register could reprint, and it was the
one still sitting in the browser's memory.

Here is the proof rather than the assertion. `RegisterShell.tsx:261` held the last
sale in a single piece of React state called `lastReceipt`. `RegisterShell.tsx:1211`
persisted that one snapshot to the device's localStorage so it would survive a
refresh, with a comment noting that if storage were full "reprint just won't
survive a restart." The button itself lived at `RegisterShell.tsx:2277` reading
"🧾 Reprint last receipt," and it was wired at `RegisterShell.tsx:1617-1623` to
hand that one in-memory object to `buildPosReceiptHtml` and then to
`printSlip(html, false, "reprint")`. That is the entire mechanism. It was one
variable, on one device, holding one sale. The moment a second sale rang up, the
first was gone, and no code path existed that could ever go and fetch it back.

So the ability to reprint older receipts was not blocked, not gated behind a
permission, and not deliberately omitted on compliance grounds. It was an
unbuilt road, and Michael's instinct that it "might be handy" was correct.

The reason it could be built quickly is that the data was already being kept. The
migration at `0120:62` defines `pos_sale_events.payload` as `jsonb NOT NULL`, and
the shape stored in it, `PosSalePayload` at `sale-event-core.ts:215-273`, carries
the full envelope of a sale: every line, the subtotal, the tax, the total, the
payment method, the amount tendered, the change given, and the medical and
loyalty blocks. In other words the register has been faithfully recording
everything a receipt needs since the day that migration landed. It simply had no
door to walk back through and read it.

On the industry question, reprinting historical receipts is ordinary and expected
rather than exotic. Lightspeed exposes it as a row action on Sales History, and
Oracle's Xstore treats reprint as a standard transaction lookup function. The one
genuine control that matters is the cash drawer, and this codebase already
understood that: `star-printer-core.ts:201-204` refuses any print job that asks
to pop the drawer on a reprint. A reprint is a piece of paper, not a cash event,
and the new code honours that rule rather than working around it.

So the verdict is: connect it, and connect it carefully. That is what this slice
did.

## Part two — the warning box that pointed at a wall

Michael's second complaint was more serious than it first appeared, because it
was a correctness bug wearing the costume of a UX annoyance.

The blocked-stock banner on the inventory page lists every lot the register
cannot sell, grouped by cause. There are six causes, defined by `LotSellableCode`
at `register-availability-core.ts:436`: `no_product_link`, `lot_not_active`,
`lot_empty`, `no_menu_card`, `recall_hold`, and `hidden_card`. Six different
problems, six different places to go and fix them.

Every single one of them linked to the same destination. At
`RegisterSellabilityBanner.tsx:68-73` the old code built its link as
``href={`/admin/inventory/${lot.lotId}`}`` for every blocked lot regardless of
why it was blocked. Michael's observation that clicking either issue "takes me to
the product detail page of the affected product, but there is nothing for me to
do there" was exactly right, and it is worth stating plainly that he was not
missing a control. There was no control. `src/app/admin/inventory/[id]/page.tsx`
runs to 1,186 lines, and searching it for anything touching hidden state,
visibility or approval returns nothing actionable. The page genuinely cannot fix
either of the two problems he was being sent there to fix.

The controls he needed exist, just elsewhere. Un-hiding a product is a
`<select name="visibility">` at `admin/products/[key]/page.tsx:852`, offering
inherit, show and hide, whose submission is translated at
`admin/products/actions.ts:96` into `update.hidden_override = vis === "inherit" ? null : vis === "hide"`.
Approving a product is `approveDraftAction` at `admin/inventory/drafts/page.tsx:316`,
on the page titled "Product Onboarding" at `admin/inventory/drafts/page.tsx:93`,
reachable from the nav entry at `admin-nav-data.ts:64`. So the banner was
describing the fix accurately in prose — "Un-hide the product in the back office"
at `register-availability-core.ts:539`, and "Approve it in Product Onboarding,
then publish the menu" at `register-availability-core.ts:517` — while linking
somewhere the fix did not live.

### The trap that made this worth doing carefully

The obvious repair is to send every blocked lot to its product page, since that
is where the visibility control is. That obvious repair would have been a bug,
and reading the code rather than assuming is what caught it.

`admin/products/[key]/page.tsx:65-67` opens with `if (!published) notFound();`
followed by `if (!item) notFound();`. A lot blocked with `no_menu_card` is by
definition a product that has not been published yet. Sending those to the
product page would have replaced Michael's dead end with a 404 — a worse outcome,
because at least the old link loaded a page. Lots blocked on `no_menu_card` must
go to Product Onboarding, where the approve action actually is, and never to the
product page.

This is precisely the class of mistake the standing rule exists to prevent, and
it was caught by reading `page.tsx:65-67` rather than by reasoning about where a
product page "should" go.

### Where each cause now sends you

The routing decision was pulled out of the component and into a pure, tested
module, `src/lib/inventory/blocked-stock-fix-core.ts`, so that no view can ever
hard-code a destination again. Its `fixLinkForLot(cause, lotId, productKey)`
returns an `href`, a `label`, and a `why` string explaining what you will do when
you arrive.

A `hidden_card` lot now goes to `/admin/products/${encKey(key)}`, the page that
holds the visibility select, falling back to the lot page when the product key is
blank or null so the link can never be malformed. A `no_menu_card` lot goes to
`/admin/inventory/drafts?status=draft`, Product Onboarding, and deliberately never
to the product page for the 404 reason above. The remaining three causes,
`no_product_link`, `recall_hold`, `lot_not_active` and `lot_empty`, are genuinely
lot-level problems and continue to the lot page, which is now correct rather than
accidental.

### Working through 973 of them

Michael asked for efficiency, and the honest answer had two halves.

Where a real filtered screen exists, there is now a bulk button on the group
header via `bulkFixLinkForCause`. Unlinked lots go to
`/admin/inventory?missingProductLink=1`, and that filter is real — it is parsed at
`lot-gap-core.ts:129-130`. Unapproved products go to the drafts queue filtered to
`status=draft`, which `admin/inventory/drafts/page.tsx` genuinely accepts.

Where no such screen exists, the bulk link returns `null` and no button is drawn.
This is the part worth being candid about, because I got it wrong first and the
standing rule caught me. My initial draft emitted `/admin/products?status=hidden`
as the bulk link for hidden products. Reading `parseEnrichmentStatusFilter` at
`match-core.ts:454-455` showed that `status` there means *enrichment* status and
accepts only `none`, `draft`, `published` or `archived`. The value `hidden` would
have been silently discarded, and the screen would have shown Michael the entire
catalogue while appearing to show him a filtered list of his hidden products.
That is worse than no button, because it lies. The bulk link for `hidden_card` is
now `null`, with a comment in the source recording why, and a self-test asserts
its absence so no future edit can reintroduce the invented filter.

### The 25 that hid the 2

The other half of Michael's efficiency problem was structural, and it is the
detail I am most glad he reported. He wrote that "the list only shows 25 at a
time and I have 973," and that two of them were approval problems while the rest
were hidden.

`register-sellability-store.ts` capped the list at `BLOCKED_LOT_DISPLAY_LIMIT = 25`
and then applied it as a single flat slice across all causes:
`diagnoses.filter((d) => !d.sellable).slice(0, 25)`. Because the list was flat,
971 hidden lots could fill all 25 slots and bury the 2 approval lots entirely.
Michael only knew the approval cases existed because the *counts* were computed
separately from the *list*. Had the mix been slightly different, an entire
category of problem would have been invisible to him.

The cap is now per cause, at `register-sellability-store.ts:100` and `:264-270`,
raised to 60 and tallied with a `Map` so each cause gets its own budget. Two
approval lots can no longer be crowded out by 971 hidden ones, whatever the
proportions. The banner also now reads its group totals from
`summary.byCode[g.code]` at `RegisterSellabilityBanner.tsx:61` rather than from
the length of the displayed array, so the header count is the true total and the
"Showing 60 of 971" line at `:104-106` is honest about the difference.

Threading the product key through made this possible: `LotDiagnosis` in
`register-availability-core.ts` now carries `productKey: string | null`, set on
all seven return paths — `null` for `no_product_link`, where by definition there
is no key, and the real key everywhere else.

## Part three — how the reprint was built

`src/lib/pos/receipt-reprint-core.ts` is pure and holds the entire rebuilding
decision. `rebuildReceiptFromPayload(payload, ctx)` takes the stored JSON and
returns either a receipt or a refusal.

The single most important property is that it prints **what was actually
charged**, never what the numbers ought to add up to today. It reads the stored
`totalMinor`, `subtotalMinor` and `taxMinor` and uses them verbatim. It does not
recompute the total from the lines, because tax rates change, prices change, and
a receipt is a historical record of a transaction rather than a fresh quote. A
reprint that recalculated could hand a customer a slip disagreeing with their
bank statement.

The second property is that it refuses rather than invents. If the totals were
never stored, it returns an error instead of printing zeros. If a line has no
name, no quantity, or no unit price, it refuses the whole receipt rather than
printing that line as free — a slip saying a customer received an item at no
charge is a compliance problem, not a cosmetic one. It coerces numeric strings,
since JSON round-trips are not always tidy, and it omits rounding rows when none
were stored rather than fabricating a zero row. Savings are derived honestly as
(regular − charged) × quantity.

`REPRINT_OPENS_DRAWER` is exported as `false` and `REPRINT_JOB_KIND` as
`"reprint"`, matching the guard already living at `star-printer-core.ts:201-204`.
No cash moves on a reprint.

The server side is `src/lib/pos/receipt-reprint-store.ts`, whose only export is
`reprintReceiptByNumber(receiptCode)`. It scans `pos_sale_events` over the same
window the returns flow uses, `RETURN_WINDOW_DAYS + 2`, with an
`EVENT_SCAN_LIMIT` of 400, and matches by computing `receiptNumber(e.client_uuid)`
per row. The receipt number is derived rather than stored, so it cannot be pushed
down into SQL; the scan is bounded deliberately. It refuses any code shorter than
four characters before touching the database at all, and it distinguishes a
failed read ("Could not read the sales ledger — try again in a moment.") from a
genuine miss, because telling a cashier "no sale found" when the database merely
hiccuped would send them hunting for a receipt that exists. Register and employee
names are looked up best-effort and never block the reprint.

`GET /api/pos/reprint?receipt=XXXXXXXX` at `src/app/api/pos/reprint/route.ts` is
device-authenticated like every other register endpoint, wrapped in
`withPosCors`/`posPreflightResponse`, and returns 404 on failure.

In the register itself there is now a "🧾 Reprint receipt" button on **every** row
of transaction history, not just the last sale. Each history row was wrapped in
its own keyed element so that a sale which is not returnable can still be
reprinted — the two capabilities are independent, and conflating them would have
made older receipts unreachable again for exactly the wrong reason. The handler
uses `posFetch`, the same helper every other register call uses, then
`buildPosReceiptHtml` and `printSlip(html, false, "reprint")` with the drawer
shut.

## How this was verified

`tests/compliance/blocked-stock-fix-links.test.ts` contains 38 tests that drive
the real modules, and it does something stronger than checking strings. For every
href the routing core can emit, it resolves the URL to a real `page.tsx` on disk
with `existsSync`, so a link to a route that does not exist fails the build.
Then it reads the destination file and asserts the fix control is actually
present there — `name="visibility"`, `value="show"` and `hidden_override` on the
product page, `approveDraftAction` on the drafts page. It asserts the *lot* page
does not contain `name="visibility"`, which pins Michael's original complaint as
a fact rather than an anecdote. It asserts `notFound()` still exists in
`products/[key]` and that `no_menu_card` never links there, so the 404 trap
cannot be reopened. And it asserts the banner no longer contains the old
``href={`/admin/inventory/${lot.lotId}`}`` pattern. The reprint tests run against
a PostgREST-shaped fake whose `update`, `insert` and `delete` all throw, proving a
reprint is incapable of writing.

Michael asked me to "test the connections and the redirects and such so
everything points where it should," and then to go further, so the suite was
attacked with 13 deliberate mutations. Each was applied to the real source, the
suite was run, and the source was restored and checked byte-for-byte by SHA-256.
All 13 turned the suite red: sending hidden lots back to the lot dead end,
sending unapproved lots to the 404, using a filter that does not exist, inventing
the hidden filter, dropping URL encoding on the product key, recomputing the
total, printing zeros instead of refusing, printing a priceless line as free,
opening the cash drawer, reporting a failed read as "not found", scanning the
ledger on a too-short code, reverting the per-cause cap to a flat 25, and showing
the displayed count instead of the true total.

One of those, the priceless line printing as free, initially came back **green**,
meaning the suite would not have caught it. That was a genuine gap rather than a
harness fault: the tests covered a sale with missing totals but never a sale
whose totals were fine and whose line was defective. Two tests were added for
exactly that case, one for an absent price and one for an unreadable one, and the
mutation then failed as it should. It is recorded here because a mutation sweep
that is never surprised is not being run honestly.

The gates: `tsc --noEmit` exits 0. `eslint` reports 0 errors and 0 warnings across
all ten touched files. The pure runner reports `register-availability-core: PASSED
103 assertions`, `blocked-stock-fix-core: PASSED 47 assertions`,
`receipt-reprint-core: PASSED 34 assertions`, and `ALL PURE SELF-TESTS PASSED`.
The full suite is 570 files and 14,401 tests, all passing, up from 569 and 14,363
— exactly the one file and 38 tests this slice added, with nothing else disturbed.

## Files

New: `src/lib/inventory/blocked-stock-fix-core.ts`,
`src/lib/pos/receipt-reprint-core.ts`, `src/lib/pos/receipt-reprint-store.ts`,
`src/app/api/pos/reprint/route.ts`,
`tests/compliance/blocked-stock-fix-links.test.ts`.

Changed: `src/lib/pos/register-availability-core.ts` (productKey threaded through
`LotDiagnosis`), `src/lib/inventory/register-sellability-store.ts` (per-cause cap
at 60), `src/components/admin/inventory/RegisterSellabilityBanner.tsx` (per-row
and per-group fix links, true totals),
`src/app/pos/RegisterShell.tsx` (reprint on every history row),
`scripts/compliance/run-pure-selftests.ts` (two cores registered).

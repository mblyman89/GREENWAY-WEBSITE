# Slice 21 — Returns and voids in the back office, and a cockpit you can ask questions of

## What the owner asked for

Michael, verbatim:

> "Something I noticed that I wish I had caught before is, nowhere in the back office can I find anything related to returns or voids, and possibly other important data/ metrics I should have on hand and available to see. It should be in reports and in the main cockpit. Plus anywhere else that needs to display that info should be properly connected to that missing data. Another thing I want changed/ enhanced is on the cockpit page, the main landing page when I login, I want the comparison number that compares the previous day to today is good, but we can make it better. I want to be able to switch between different comparison metrics. For example, I want to see an average for that particular day of the week going back in history to average all of that specific day to compare with today. Or maybe I want to see last weeks specific day of the week as a comparison. Is there any other useful comparison measures we can add to make it more powerful and insightful? Please add in as much added value as you can to make it as useful as possible. Please make the next slice add this and any other vital and important and useful metrics I should see when I first login as well as in the reports page. Then enhance the comparison methods so they allow more insightful data. Follow the standing rules and never guess, never assume. Go above and beyond for me. Test everything you can including the tests. Thank you."

Three things, then: put returns and voids where they can be seen, make the cockpit comparison switchable and smarter, and add whatever other numbers genuinely belong on a first screen. The standing rule governs all of it — *do not guess, do not assume; we build from fact, not memory.*

## The finding, stated plainly

You were right, and the reason is worse than a missing page. **Every revenue number the back office has ever shown you was gross.** Not gross-versus-net as a labelling choice — gross because nothing in the reporting layer had ever heard of a refund.

That is provable rather than assumed. `src/lib/reports/sales.ts` is the module every back-office sales figure flows through, all 457 lines of it, and searching it for `return`, `void` or `refund` turns up exactly two things: the phrase "Returning customers", and the JavaScript `return` keyword. There is no refund arithmetic in it anywhere.

Meanwhile the data was being captured faithfully the whole time, in two separate places. A void writes an `audit_logs` row with action `register.sale_voided` carrying `refundMinor` in its `after_json` blob, and also stamps `order_events.event_type` with the marker defined at `src/lib/pos/void-store.ts:62`. A customer return writes a `customer_returns` row, whose shape was created back in `supabase/migrations/0115_disposition_command_center.sql:38-86` with `refund_minor_units`, `quantity`, a `disposition` constrained to `'restock'` or `'destroy'`, and a `reason`. Both have been recording for as long as they have existed.

There was even a function that already read both of them and added them up: `refundsForBusinessDay` at `src/lib/pos/refunds-store.ts:33`. So the aggregation was written, tested and working. The gap was purely in who called it. Grepping the entire repository for callers returned two, and only two: `src/app/api/pos/day-report/route.ts:144`, which prints the register's X/Z slip, and `src/lib/registers/oversight.ts:351`, which watches drawers. Both live inside the register. **Nothing in the back office had ever called it.** The money was measured at the register, printed on a slip, and then never carried through to a single page you look at.

So this was not a policy decision anyone made and it was not data we lacked. It was two systems that were never wired to each other — the same shape of problem as the receipt reprint in Slice 20, where `pos_sale_events.payload` had held every historical receipt all along and simply had no button pointing at it.

One limitation is worth stating up front because it is stated on the screen too: neither source carries register attribution. The header comment on `refunds-store.ts` says so, and the underlying rows bear it out — a void's audit entry and a `customer_returns` row both identify the order, not the till that processed the refund. So the new report gives you store-wide totals and says on its face that it is store-wide. It would have been easy to invent a per-register split and it would have been fiction, so there is a test that fails if the word `byRegister` ever appears in that page (`tests/compliance/cockpit-comparisons-and-refunds.test.ts`).

## What now exists

### Returns and voids, as a first-class report

`src/app/admin/reports/returns/page.tsx` is a new report, registered in the tab bar at `src/components/admin/reports/ReportTabs.tsx:18` so it sits alongside Sales rather than hiding at a URL you would have to know. It follows the existing house pattern exactly — `searchParams` as a promise, `await requirePermission("reports.view")`, `resolveRange(sp)` — so it takes the same date presets as every other report.

It leads with five figures: gross sales, money refunded out, net sales, the refund rate, and units returned. Then it breaks the refunds down three ways — voids versus returns, restock versus destroy, and by reason — and finishes with a day-by-day table that lists only days that actually had activity.

The data comes from `src/lib/admin/returns-metrics-store.ts`, which reads both tables **once for the whole range** and buckets the rows by Pacific day, rather than looping a query per day. A 90-day report is two queries, not a hundred and eighty. The range is guarded at 400 days and the whole read is wrapped so a database failure yields honest zeros rather than a broken page.

### Net revenue, everywhere it matters

`src/lib/admin/refund-metrics-core.ts` is a pure module holding the arithmetic, and three of its decisions are deliberate enough to name.

`computeNetSales` **does not clamp net at zero.** If a big return lands today against a sale made last week, net for today is genuinely negative, and the number says so. Clamping would have been the tidier-looking choice and it would have quietly hidden the exact day you most need to look at.

`refundRate` returns **null, not zero**, when gross is zero. A morning with no sales and no refunds has no meaningful refund rate, and printing "0.0%" would be a flattering little lie that reads as a clean day. Null renders as a dash.

`toRefundFacts` **recomputes the total from its parts** instead of trusting the stored `refundTotalMinor` it was handed. If a caller ever passes an inconsistent bundle, the parts win.

### A comparison you can interrogate

You asked for the day-of-week average and for last week's same day. Both are there, along with seven more. `src/lib/admin/comparison-basis-core.ts` defines nine bases:

Yesterday, which is what you had. **Same day last week**, which you asked for by name. **Average of the last 4 of this weekday** and **average of the last 12 of this weekday** — the historical day-of-week average you described, at two depths, because four tells you about this season and twelve tells you about the year. **Trailing 7-day average** and **trailing 28-day average**, all weekdays mixed, which answer "is today normal for us right now" rather than "how is Tuesday doing". **Same day last month**, at 28 days back so the weekday still lines up. **Same day last year**, at 364 days back — and 364 rather than 365 specifically because 364 is 52×7, so it lands on the same weekday; 365 would compare your Sunday to a Saturday. And **best same weekday in the last 12**, which is not an average at all but the record today is chasing.

Two rules run through all of it. The first is that **today is never part of its own baseline** — every window generator walks strictly backwards, and the tests assert it across all nine bases at four different values of "today", because a basis that quietly averaged today into its own comparison would always look reassuringly average.

The second is subtler and it comes straight out of how `sales.ts` works. `emptyDaySeries` at `src/lib/reports/sales.ts:151-163` seeds **every calendar day in the range at zero** before the real data is merged in at `:284-285`. That means a day the store was closed and a day the store was open and sold nothing are byte-identical in the report — both are zero revenue. The only honest signal that separates them is `orders === 0`. So `combineBaseline` **drops days with no data rather than averaging them in as zero.** Four Sundays where one was a holiday closure gives you the average of three real Sundays, and the screen tells you "3 of 4 days had data". Averaging the closure in as a zero would have dragged your baseline down by a quarter and manufactured a fake win for today. A genuine zero-revenue day that did have orders still counts, because that one is real.

There is a third piece of honesty in there: `paceNote`. Comparing a partial day against complete ones is apples to oranges, and at 10am today has had three trading hours against a baseline day's full twelve. The window carries a plain-language note saying today is still in progress, so the number is never presented as though the day were finished.

The picker itself (`src/components/admin/ComparisonBasisPicker.tsx`) is server-rendered links, not a client component — it writes `?basis=…` into the URL, which costs nothing in JavaScript and means any view you like can be bookmarked. Each option shows its description on screen rather than hiding it in a tooltip.

Underneath, `src/lib/admin/comparison-data.ts` resolves the whole thing in **one** `getSalesReport` call spanning the oldest baseline day to the newest, whatever the basis. The 28-day average is one query, not twenty-eight.

### The cockpit itself

`src/app/admin/page.tsx` now reads the basis from the URL, drives all four KPIs from the chosen comparison, and carries a new "Returns, voids & net" section. `buildAttentionFlags` in `src/lib/admin/cockpit-core.ts` gained an optional refunds input, so an unusual refund rate raises a flag that links straight to the new report. The parameter is optional on purpose: the mobile cockpit does not pass it and must not start behaving differently.

## How this was verified

Type checking is clean: `tsc --noEmit` exits 0. Linting is clean: eslint reports 0 errors and 0 warnings across all thirteen touched files, which caught a genuinely dead `deltaLabel` import left behind when the KPI block moved to the new comparison-driven helper.

The two pure cores carry their own self-tests, run by `scripts/compliance/run-pure-selftests.ts`: **208 assertions** for the comparison bases and **58** for the refund metrics, with the runner reporting `ALL PURE SELF-TESTS PASSED`.

The new suite `tests/compliance/cockpit-comparisons-and-refunds.test.ts` adds **47 tests**. They drive the real modules — the comparison engine against a fake `getSalesReport` whose day values are known, and the returns store against a fake database client **whose write methods throw**, so that reading refunds can be proven not to mutate anything. Several are filesystem assertions, because you asked for this to be visible in specific places rather than merely computed: they check that the cockpit actually renders the panels, that it no longer contains the old hard-wired `deltaLabel(snap.deltas.revenue)` call, that the returns report exists and is a registered tab, and that **every** `/admin/reports/*` link the cockpit emits resolves to a page that really exists.

The full suite is **571 files and 14,448 tests, all passing**, up from 570 and 14,401 at the start of this slice.

### Testing the tests

You asked for the tests themselves to be tested, so fourteen deliberate mutations were made to the shipped source — each one a single plausible token change of the sort a careless refactor produces — and the suite was required to catch every one.

Included among them: putting today back into its own baseline; using 365 days instead of 364 for the year-ago comparison; averaging closed days in as zeros; starting the trailing window at today instead of yesterday; letting `parseComparisonBasis` guess at near-miss strings by prefix; returning the minimum instead of the maximum for the record basis; reporting a flattering 0% refund rate on zero gross; clamping net sales at zero; trusting the stored refund total instead of recomputing it; fetching the comparison per-day so the span reaches today; and deleting the Returns & Voids tab from the registry.

Thirteen went red immediately. **One did not, and that matters more than the thirteen that did.**

Mutation M13 removed the `severity !== "ok"` guard from the refund attention flag, and the entire suite stayed green. The gap was real: the only test exercising that flag passed a severity of `"high"`, so nothing was pinning the healthy case. The practical consequence would have been that every ordinary trading day — and every trading day has some refunds — raised a refund alarm on your cockpit, until you learned to ignore the alarm bar entirely. An alarm that always fires is worse than no alarm.

Four tests were added to close it, covering a normal refund day with real money moving and no flag, a bad-looking severity with nothing actually refunded and no flag, the grading of watch-level as info versus high as a warning, and the mobile case where refunds are not passed at all. M13 was re-run and is now red. **All fourteen mutations are caught.**

Afterwards every mutated file was confirmed byte-identical to its pre-mutation state, `git status` showed exactly the intended file set with no residue, and the harness was deleted.

## A note on one test that was wrong

Two tests failed on their first run, asserting that the comparison query span ended on `2026-09-05` when it reported `2026-09-06`. The temptation is to adjust the number until it goes green. Reading `src/lib/reports/timezone.ts:139` gave the actual answer: `pacificWallTimeToUtcISO(ymd, "end")` builds 23:59:59.999 **Pacific** and converts it to the true UTC instant, and because Pacific is UTC−7 or −8, that instant lands in the small hours of the *following* UTC calendar date. Slicing the first ten characters off a UTC ISO string was simply the wrong way to ask which Pacific day a boundary falls on.

The product was correct; the assertion was not. It now uses `pacificDayKey`, which answers the question that was actually being asked, and additionally asserts that the boundary instant strictly precedes the moment today begins in Pacific — so no row from today can satisfy the filter regardless of how the database rounds. The corrected test is stronger than the one it replaced.

## Files

New: `src/lib/admin/comparison-basis-core.ts` (579 lines, pure), `src/lib/admin/refund-metrics-core.ts` (425, pure), `src/lib/admin/comparison-data.ts` (197), `src/lib/admin/returns-metrics-store.ts` (219), `src/components/admin/ComparisonBasisPicker.tsx` (74), `src/app/admin/reports/returns/page.tsx` (233), `tests/compliance/cockpit-comparisons-and-refunds.test.ts` (712).

Modified: `src/lib/admin/cockpit-data.ts`, `src/lib/admin/cockpit-core.ts`, `src/lib/admin/mobile-core.ts`, `src/app/admin/page.tsx`, `src/components/admin/reports/ReportTabs.tsx`, `scripts/compliance/run-pure-selftests.ts`.

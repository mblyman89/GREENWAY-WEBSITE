# Slice D — recon and plan (performance round 4)

Owner report after Slice C: home ≈ 5 s, shop ≈ 10 s+. Speed Insights is a Pro
feature and the owner cannot open the dashboard, so the only field telemetry is
the Observability screenshots (Active CPU spiking to ~20 s, errors 0 %,
timeouts 0 %).

Standing rule for this document: every claim below is either a file:line in this
repository, a quoted line from vendor documentation, or a number produced by a
script that was actually run. Nothing here is inferred.

## 1. What the vendor documentation actually says

**Data Cache item limit.** From `vercel.com/docs/caching/runtime-cache/data-cache`
(page metadata `last_updated: 2026-08-21`), section "Limits and usage":

| Data cache property | Limit                               |
| ------------------- | ----------------------------------- |
| Item size           | 2 MB (items larger won't be cached) |
| Tags per item       | 128 tags                            |
| Maximum tag length  | 256 bytes                           |

**Runtime Cache item limit.** From `vercel.com/docs/caching/runtime-cache`
(`last_updated: 2026-08-28`), the same 2 MB item ceiling applies.

This kills the change that was pencilled in at the end of Slice C — "move the
cache boundary outward and cache the fully enriched menu". The raw menu payload
measures 1.62 MB (`JSON.stringify`, 4,500 items). The enriched payload is
strictly larger, because enrichment only ever adds fields. A single cache entry
holding it would exceed 2 MB and, per the documentation, the write is simply
dropped. The code would look cached, report no error, and re-read the database on
every request. That is Slice A's failure mode rebuilt with more machinery.

**Active CPU excludes I/O wait.** From `vercel.com/kb/guide/optimize-active-cpu-on-fluid-compute`:

> "Active CPU is the CPU time your code consumes. It excludes time spent waiting
> on external I/O."

and

> "Waiting on external I/O usually increases duration, not Active CPU."

The same guide names our shape directly. Under "Per-request transforms and media
work": "Unbounded loops over large result sets". Under "Waiting on background
work": "Use the preloading pattern to start independent I/O together."

**Dynamic rendering triggers.** Same guide:

> "request-time APIs such as `cookies()`, `headers()`, the page's `searchParams`
> prop, and `connection()` ... can make a route render dynamically."

**Caching antipatterns.** From `vercel.com/kb/guide/caching-antipatterns`
(`last_updated: 2026-09-07`), antipattern 5 is "Nobody owns the cache", and its
prescription is a data-access layer that owns caching, with "semantic,
entity-specific tags" and "every write pairs with its invalidation". Our
`menu-cache-policy-core.ts` plus `public-surfaces.ts` already implement exactly
that contract, which is why the changes below can safely reuse it.

## 2. A hypothesis that was tested and REJECTED

Before reading the framework source, `draftMode()` in the root layout
(`src/app/layout.tsx:79`) looked like a site-wide dynamic-rendering trigger. If
true it would have made every page on the site uncacheable, and it would have
been the single biggest find of this round.

It is **false**, and the plan was corrected before any code was written.

In `node_modules/next/dist/server/request/draft-mode.js`, the dynamic-tracking
helper `trackDynamicDraftMode` is invoked from exactly two call sites: `enable()`
at line 123 and `disable()` at line 129. Reading `.isEnabled` goes through the
`DraftMode` class getter, which performs no tracking whatsoever. The Next.js
reference page for `draftMode` states the same intent from the other direction:
"`isEnabled` is readable inside a caching directive scope."

So the root layout is not the problem and is left untouched. Recording the
rejected hypothesis matters as much as recording the accepted one — acting on it
would have been a large, risky, useless diff.

## 3. Measurements taken against this repository

Pure CPU cost of the enrichment chain at 4,500 items, no database:

```
1 pass: items.map(i => ({...i}))                      1.8 ms
5 passes: spread x5 (the enrichment chain)            7.8 ms
JSON.stringify(all items) [RSC payload]               3.4 ms   (1.62 MB raw)
compliance: 15 precompiled regex x 4500               3.7 ms
compliance: new RegExp per phrase per item (12x4500) 25.2 ms
group by category + sort                              0.8 ms
```

Total pure compute is roughly 40 ms. It cannot account for a 10-second page.
The time is spent waiting, and what it waits on is round trips.

Sequential database round trips per `/menu` request, after Slice C:

```
CACHED (only on a 60 s miss)             44
UNCACHED (every request, typical)        85
UNCACHED (every request, worst)         134
```

The uncached number is the one that matters, and the reason it is uncached is
structural: `loadLiveMenuAllCached` (`src/lib/pos/live-menu.ts:188`) wraps only
the innermost load. All five enrichment passes run *outside* that boundary, on
every single request.

## 4. Why those round trips are sequential

`chunkedIn` (`src/lib/supabase/chunked-in.ts:56`) and `pagedAll` (line 87) both
advance with a `for` loop containing an `await`. Every chunk waits for the
previous chunk to return. At 4,500 items with the 200-id default chunk, one call
is 23 serial round trips. Several such calls plus paging is where 85–134 comes
from.

Nothing about these reads is order-dependent: each chunk queries a disjoint set
of ids and the results are concatenated. They are serial by construction, not by
necessity.

## 5. The plan

Four changes, ordered by confidence and inverse risk.

**D1 — Home page: `force-dynamic` to time-based revalidation.**
`src/app/page.tsx:38` opts the home page out of every cache layer. The page is a
public product-card grid; nothing on it varies per user. Invalidation is already
wired: `revalidatePublicMenuSurfaces()` calls `revalidatePath("/")`
(`src/lib/site/public-surfaces.ts:71`) and `"/"` is the first entry of
`PUBLIC_MENU_SURFACES`. Switching to `revalidate = 60` matches the TTL the menu
data cache has used since Slice A, so publish-to-live stays instant.

**D2 — Cache the strain index instead of the menu.**
`buildMenuIndexes()` (`src/lib/menu/strain-terpenes-server.ts:35`) calls
`listKbStrains(50_000)`, which pages 1,000 rows at a time
(`src/lib/ai/kb/store.ts:501`) — up to 50 serial round trips, uncached, on every
request. Its output is two `Map`s keyed by strain name: the strain library, not
the product catalog. Small, shared by every request, and it changes only when
staff edit the knowledge base. This is the correct thing to cache, and it stays
far below the 2 MB ceiling precisely because it is not the menu.

**D3 — Let independent chunks travel together.**
Add an opt-in `concurrency` option to `chunkedIn`. The default stays `1`, so all
existing callers keep byte-identical behaviour, including the reports and intake
paths that were never in scope. Only the menu read paths pass a value. Output
ordering is preserved by writing each chunk's rows into its own slot and
flattening at the end, so results are indistinguishable from the serial version.

**D4 — Start the independent page reads together.**
`src/app/menu/page.tsx:54-80` awaits the enrichment chain, then category labels,
then banners, then the carousel seed, then the carousel, then the sale filters —
sequential waits for things that do not depend on each other. This is precisely
the "preloading pattern" the Vercel guide points at.

## 6. What is deliberately NOT being done

- **Not** caching the enriched menu as one entry. It exceeds the documented 2 MB
  item limit and the write would fail silently.
- **Not** touching `src/app/layout.tsx`. The hypothesis that it forced dynamic
  rendering was tested against the framework source and disproved.
- **Not** making `/menu` a statically cached route. It reads the `searchParams`
  prop (`src/app/menu/page.tsx:42`), which the Vercel guide lists as a
  request-time API that makes a route dynamic. Removing it would change how
  deep-linked filters behave — a behaviour change, not a performance slice.
- **Not** touching any money path. `menu-cache-policy-core.ts` holds the line
  "cache the display, never cache the money", and its self-test refuses to let
  the cacheable set grow without a written justification.

# Customer Site Performance — Recon, Diagnosis & Roadmap

**Status:** Recon and strategy only. No code changed.
**Scope:** the customer-facing pages that render products.
**Method:** every claim below is anchored to a file and line number in this
repo, or to an official vendor document. Nothing here is estimated from
memory. Where a number is modelled rather than measured, it says so.

---

## THE HEADLINE

**This is not a Vercel problem and not a Supabase problem. It is our code.**

The database schema is actually *well* built — the indexes that matter already
exist (`supabase/migrations/0002_slice2_pos_import.sql:133-138, 152`). The
queries are correctly paged and chunked, with no N+1 loops. Whoever wrote the
data layer did it properly.

The problem is what we do *around* those queries:

1. **We rebuild the entire 4,500-product catalog from scratch on every single
   page view.** Nothing is cached. Not for one second.
2. **We then ship that entire catalog to the browser as JSON** — roughly
   **6.5 MB uncompressed** — even though a shopper sees about 20 products.
3. **We render every matching product as a live DOM element**, with no
   pagination and no virtualization.

Three separate problems, each individually enough to make a site feel broken.
Together they explain exactly the symptom described: slow to load, laggy,
unresponsive.

You were told 4,500 products is a small database. **That is correct.** 4,500
rows is nothing for Postgres. The database is not struggling. We are asking it
the same question over and over and then mailing the answer to every visitor.

---

## FINDING 1 — Nothing is cached, and we explicitly told Next.js not to

**Severity: CRITICAL. This is the single biggest win available.**

Three customer pages opt out of all caching:

| File | Line | Setting |
|---|---|---|
| `src/app/page.tsx` | 38 | `export const dynamic = "force-dynamic"` |
| `src/app/specials/page.tsx` | 16 | `export const dynamic = "force-dynamic"` |
| `src/app/menu/products/[id]/page.tsx` | 270 | `export const dynamic = "force-dynamic"` |

And `/menu` itself has no cache directive at all, while calling uncached
database functions — which makes it dynamic by default.

A repo-wide search for `unstable_cache`, `revalidate`, or `"use cache"` across
`src/app/menu`, `src/app/page.tsx`, `src/app/specials`, `src/lib/pos/live-menu.ts`,
`src/lib/menu/` and `src/lib/enrichment/image-resolver.ts` returns **nothing**.

**What this means in practice:** if ten customers open the menu in the same
minute, we execute the entire pipeline ten times and produce ten identical
results. If one customer loads the menu, clicks a product, and hits back, we do
it three times.

**Why the comment says to do it:** the note at
`src/app/menu/products/[id]/page.tsx:268` explains the reasoning — *"The menu is
dynamic (published DB version), so product pages render on demand rather than
being statically pre-generated from a frozen snapshot."*

That instinct is right and it comes from a real past bug: SLICE 48 retired a
committed JSON snapshot because clearing the back office had no effect on the
live site (`src/lib/pos/live-menu.ts:9-23`). Nobody wants to go back to a
frozen menu.

**But `force-dynamic` is the wrong tool for that goal.** The correct tool is
**tagged caching with on-demand invalidation**: cache the menu indefinitely,
and blow the cache away the instant someone presses Publish. The menu changes
when *we* change it, not on a timer, and not on every visitor's request.

Next.js documents exactly this pattern for non-`fetch` data sources like
Supabase — `unstable_cache` with a tag, invalidated by `revalidateTag`
(Next.js ISR guide, "On-demand revalidation with revalidateTag").

We already use `revalidatePath` elsewhere in the POS code
(`src/lib/pos/intake-menu-staging.ts:468-469`), so the pattern is established
in this codebase — it just was never applied to the public menu.

---

## FINDING 2 — ~49 sequential database round trips per page view

**Severity: CRITICAL.**

`/menu` (`src/app/menu/page.tsx:53-58`) chains five enrichment passes, each
`await`ed inside the previous one's result:

```
withCategoryOverride(
  withDohCompliance(
    withDisplayKnowledge(
      withResolvedImages(
        withMenuProfile(
          loadLiveMenuItems())))))
```

Because each is awaited before the next begins, **none of them overlap**. Every
round trip's latency adds to the total.

Counting the actual queries:

| Stage | Round trips | Anchor |
|---|---|---|
| `getPublishedVersion` | 1 | `src/lib/pos/menu-version.ts:31` |
| `menu_items` paging | 5 | `menu-version.ts:388-402`, page size 1000 (`chunked-in.ts:43`) |
| `menu_variants` chunking | **23** | `menu-version.ts:415-433`, chunk size 200 |
| `withCardIdentity` | 3 | `card-identity.ts:67, 90, 120` |
| `withResolvedImages` | ~6 | `image-resolver.ts:99, 119, 190, 214, 245, 267` |
| `withMenuProfile` / `withDisplayKnowledge` | ~4 | |
| DOH / category override / label map | 3 | |
| banners, carousel, promo titles | ~4 | `menu/page.tsx:64-80` |
| **Total** | **≈ 49 sequential** | |

The 23 variant round trips deserve attention. `chunkedIn`
(`src/lib/supabase/chunked-in.ts:65-77`) is a plain `for` loop with `await`
inside — every chunk waits for the one before it:

```js
for (let i = 0; i < unique.length; i += chunkSize) {
  const chunk = unique.slice(i, i + chunkSize);
  for (;;) {
    const rows = await fetchPage(chunk, from, from + pageSize - 1);
```

4,500 items ÷ 200 per chunk = **23 trips, strictly one after another.**

**Modelled cost** (latency × count — a model, not a measurement): at 30 ms
round-trip latency that is **~1.5 seconds**; at 80 ms — plausible if the Vercel
region and the Supabase region differ — it is **~3.9 seconds**, before a single
pixel is rendered.

Two things make this much worse than it looks:
- It happens on **every request** (Finding 1), so it is never amortised.
- The chunk size of 200 is very conservative. It was chosen to keep the URL
  short, which is a real constraint, but it can be raised substantially and the
  chunks can run concurrently.

---

## FINDING 3 — We ship the whole catalog to the browser (~6.5 MB)

**Severity: CRITICAL.**

`src/app/menu/page.tsx:146` passes every enriched item into a **client**
component:

```jsx
<InteractiveMenuBrowser items={menuItems} ... />
```

`InteractiveMenuBrowser.tsx:1` is `"use client"`. Per Vercel's own guidance,
**every prop crossing that boundary is serialized into the RSC payload and sent
over the network** (Vercel KB, *How to Optimize RSC Payload Size*, 3 Nov 2025):

> "Every time you forward a prop from the server to the client, it's sent as
> data over the network."

**Measured** (`/tmp/payload.js`, using a representative fully-enriched item
built from the real `GreenwayMenuItem` shape in `src/lib/leafly/types.ts:52`
plus the fields the enrichment passes add):

```
bytes per enriched item: 1,509
  4,500 items -> 6.48 MB uncompressed  (~1.6 MB gzipped, estimated)
```

For calibration, the repo contains **2,615** real `product.json` files today,
which at the same per-item cost is **3.76 MB**. So this is not hypothetical —
it is roughly the current state, and it grows every time inventory grows.

**And it is sent twice**: once inline in the streamed HTML, and again as a
`.rsc` payload when Next.js prefetches or a client navigation occurs.

Vercel's prescription is exactly our situation:

> "Only pass the data you need from server to client components. If your API
> returns a large object that you want to display, filter unused properties
> before passing it to the client."

> "When you render many instances of one component — a grid of product cards,
> for example — use pagination or infinite scroll."

### We ship fields the client never opens

Counting property access inside `InteractiveMenuBrowser.tsx`:

| Field | Uses in client | Verdict |
|---|---|---|
| `category` | 9 | needed |
| `filterCategories` | 5 | needed |
| `variants` | 4 | needed |
| `compounds` | **0** | **dead weight** |
| `dohCompliant` | **0** | **dead weight** |
| `hiddenReason` | **0** | **dead weight** |
| `knowledge` / `educationalCopy` | **0** | **dead weight** |

`compounds` alone is an array of cannabinoid objects on every item. The
`description` field averages **221 bytes** of prose per product (measured
across 2,615 real files) and is only needed on the product detail page — not on
a grid card.

Underneath, `getVersionItems` uses `.select("*")`
(`src/lib/pos/menu-version.ts:391`). The `menu_items` table has ~26 columns from
migration 0002 plus 8 added later — **~34 columns fetched, ~19 used.**

---

## FINDING 4 — Every matching product becomes a real DOM node

**Severity: HIGH.**

`InteractiveMenuBrowser.tsx:1358`:

```jsx
{group.items.map((item) => <ProductCard key={item.id} item={item} />)}
```

Unbounded. A search of the file for `slice(`, `PAGE_SIZE`, `visibleCount`,
`loadMore`, `IntersectionObserver`, or `virtual` finds **no pagination and no
virtualization** — the only `slice(` hits are string operations for capitalising
labels (lines 476, 1102).

With no category filter applied, an unfiltered menu tries to mount thousands of
card components. Each `ProductCard` (`src/components/menu/ProductCard.tsx`) is
itself a client component that runs **two** pricing computations per render —
`menuCardDiscountForItem` and `menuCardBadgeForItem` (lines 23, 30) — plus two
context hook subscriptions.

That is the "laggy and unresponsive" symptom specifically: React must hydrate
and keep alive thousands of interactive components, and every filter keystroke
re-runs that work.

**Credit where due:** filtering *is* memoized (19 `useMemo` calls) and images
*are* lazy-loaded (`ProductCardVisual.tsx:344`). Those were done right. The
missing piece is limiting how many cards exist at all.

---

## FINDING 5 — Product images bypass Next.js optimization

**Severity: MEDIUM-HIGH (worst on phones).**

`next.config.ts:52-63` correctly configures `remotePatterns` for the Supabase
storage bucket — so `next/image` was *intended* to be used.

But `ProductCardVisual.tsx:341` renders a raw `<img>` with an eslint-disable
comment on line 340:

```jsx
{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={item.imageUrl} alt={item.name} loading="lazy" ... />
```

Consequences: no automatic WebP/AVIF conversion, no responsive `srcset`, no
width/height attributes (so every image causes layout shift), and full-size
originals downloaded to a 375 px-wide phone screen.

`next.config.ts` also sets no `formats`, `deviceSizes`, or `minimumCacheTTL`.

---

## FINDING 6 — Viewing one product loads all 4,500 items, twice

**Severity: HIGH.**

`src/app/menu/products/[id]/page.tsx`:

- Line **109** — `getLiveMenuItemById(id)`, which internally calls
  `loadLiveMenuItems()` and then does `items.find(...)`
  (`src/lib/pos/live-menu.ts:145-150`). **The entire catalog is loaded and
  converted to find one product.**
- Line **263** — `await withMenuProfile(await loadLiveMenuItems())` again, to
  pick 8 related items.

So opening one product page runs the full catalog load **twice**, on a page
marked `force-dynamic` (line 270) so it can never be reused.

There is no `generateStaticParams` on this route. Product pages are the most
cacheable content on the entire site — a product's name, image, and description
change rarely — and we currently rebuild them from scratch on every view.

---

## WHAT IS ALREADY GOOD

Worth stating plainly, so the fix does not become a rewrite:

- **Indexes exist and are correct** — `idx_menu_items_version`, `..._category`,
  `..._brand`, `..._vendor`, `..._hidden`, `..._source`, and
  `idx_menu_variants_item` (migration 0002, lines 133-138 and 152).
- **No N+1 queries.** Variants are fetched in bulk and grouped in a `Map`
  (`menu-version.ts:434-438`).
- **Paging is correct and defends against PostgREST's 1000-row cap**
  (`chunked-in.ts:80-101`) — a real bug class this codebase already solved.
- **Error handling is honest** — a failed page returns `[]` rather than a
  silently truncated menu (`menu-version.ts:403-406`), and a variant read
  failure fails the whole load rather than showing a wrong price
  (`menu-version.ts:439-442`). That is the right call for a regulated business.
- **Filtering is memoized** and **images are lazy-loaded.**

The data layer is sound. The problem is caching, payload, and render volume.

---

## THE ROADMAP

Ordered by **impact per unit of risk**. Each slice is independently shippable
and independently verifiable. Nothing here requires a rewrite.

### Slice A — Cache the menu, invalidate on Publish
**Impact: MASSIVE. Risk: LOW. Do this first.**

Wrap the catalog load in `unstable_cache` with the tag `menu`, and call
`revalidateTag("menu")` in the publish action.

- Removes ~49 DB round trips from **every request after the first**.
- The menu still updates **instantly** on Publish — this is strictly better
  than a timer, and it does not reintroduce the SLICE 48 frozen-snapshot bug,
  because the cache is keyed to the published version and cleared on publish.
- Must verify: press Publish, confirm the site changes immediately. That is the
  acceptance test, and it is the one that protects the original bug fix.

**Expected: first visitor pays full cost; everyone else gets a near-instant page.**

### Slice B — Stop shipping the whole catalog to the browser
**Impact: MASSIVE. Risk: MEDIUM.**

Two parts:

1. **Trim the card shape.** Define a `MenuCardItem` containing only the ~19
   fields the client actually reads. Drop `compounds`, `description`,
   `dohCompliant`, `hiddenReason`, and the knowledge copy from the grid payload.
   Replace `.select("*")` (`menu-version.ts:391`) with an explicit column list.
2. **Paginate the grid.** Render the first ~48 cards and load more on scroll —
   precisely what Vercel's guidance recommends for product grids.

**Expected: 6.5 MB → a few hundred KB.** This is the fix for "unresponsive".

### Slice C — Parallelise what remains
**Impact: HIGH. Risk: LOW-MEDIUM.**

- Run the independent enrichment passes with `Promise.all` instead of nesting
  five `await`s (`menu/page.tsx:53-58`).
- Make `chunkedIn` fetch chunks concurrently with a bounded pool, and raise the
  chunk size from 200 (`menu-version.ts:432`) after testing URL length limits.
- Fetch banners, carousel, and promo titles in parallel with the catalog.

Even with Slice A in place this matters, because it sets the cost of a cache
miss — the price the *first* visitor after each publish pays.

### Slice D — Make product pages cheap
**Impact: HIGH. Risk: LOW.**

- Add a direct single-item query instead of loading 4,500 and calling `.find()`
  (`live-menu.ts:145-150`).
- Load related items from the cached catalog rather than a second full load
  (`[id]/page.tsx:263`).
- Replace `force-dynamic` (line 270) with tag-based caching, and consider
  `generateStaticParams` for the top sellers.

### Slice E — Images
**Impact: MEDIUM-HIGH on mobile. Risk: LOW.**

- Move `ProductCardVisual.tsx:341` to `next/image` with explicit `sizes`.
- Add `formats: ["image/avif", "image/webp"]` and `minimumCacheTTL` to
  `next.config.ts`.
- Fixed dimensions eliminate layout shift, which is a large part of the
  *perceived* jank.

### Slice F — Lock it in with tests
**Impact: prevents regression. Risk: NONE.**

Following the pattern proven in `announcer-docs.test.ts`, add a performance
budget test that **fails the build** when:
- a customer product page reintroduces `force-dynamic`,
- the serialized card payload exceeds an agreed byte budget,
- the card grid renders without a cap.

A performance fix with no test is a performance fix with an expiry date.

---

## WHAT I RECOMMEND, AND WHY

**Do Slice A first, alone, and measure it.** It is a small, low-risk change
that removes the largest share of the cost, and it will tell us how much of the
remaining slowness is server time versus browser time. I would rather learn that
from a real measurement than assume it.

Then **Slice B**, which is the fix for the lag and unresponsiveness you can feel
while typing in the filters.

**One thing I want to flag honestly:** the ~49 round trips and the ~1.5-3.9
second figure are *modelled* — round-trip count × typical latency. I have the
round-trip count from reading the code, and the payload size from measuring real
data, but I do not have production timings from your Vercel deployment. Before
Slice C I would like to confirm where the time actually goes rather than
optimise something that turns out not to be the bottleneck.

If you can get me the Vercel Observability numbers for `/menu` — TTFB and
function duration — and confirm **which region your Supabase project is in
versus your Vercel deployment**, that would turn the last modelled number into a
measured one. A region mismatch alone can triple every one of those 49 round
trips, and it is a settings change rather than a code change.

---

## SOURCES

**This repository** (read directly, line numbers verified):
`src/app/menu/page.tsx`, `src/app/page.tsx`, `src/app/specials/page.tsx`,
`src/app/menu/products/[id]/page.tsx`, `src/components/menu/InteractiveMenuBrowser.tsx`,
`src/components/menu/ProductCard.tsx`, `src/components/menu/ProductCardVisual.tsx`,
`src/lib/pos/live-menu.ts`, `src/lib/pos/menu-version.ts`,
`src/lib/supabase/chunked-in.ts`, `src/lib/menu/card-identity.ts`,
`src/lib/enrichment/image-resolver.ts`, `src/lib/leafly/types.ts`,
`next.config.ts`, `supabase/migrations/0002_slice2_pos_import.sql`.

**Official documentation:**
- Vercel Knowledge Base — *How to Optimize RSC Payload Size*, Phil Zona,
  3 Nov 2025. https://vercel.com/kb/guide/how-to-optimize-rsc-payload-size
- Next.js — *How to implement Incremental Static Regeneration (ISR)*,
  including `unstable_cache` + `revalidateTag` for ORM/database sources.
  https://nextjs.org/docs/app/guides/incremental-static-regeneration

**Measurements taken during this recon:**
- 2,615 real `product.json` files; mean 534 bytes raw, mean description
  221 bytes.
- Representative enriched `GreenwayMenuItem`: 1,509 bytes serialized →
  6.48 MB at 4,500 items.

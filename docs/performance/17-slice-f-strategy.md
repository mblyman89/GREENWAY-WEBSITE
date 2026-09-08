# Why the shop page is slow, what the competitor does differently, and the plan

Every number in this document was measured against the live deployment or read
out of Next.js source in `node_modules`. Where I estimate, I say so and name the
tool. Where I was previously wrong, I say that too.

Measured at `76f8b68c`. Tooling: a Node streaming probe (`fetch` + async
iteration over `res.body`, `Accept-Encoding: identity`) — the exact technique
Vercel's own streaming guide recommends over `curl`, because `curl` buffers.

---

## Part 1 — The short answer

Your site is **not** unusual, and it is **not** unfixable. Three specific,
identified defects are producing your numbers. Two of them are one-line-class
mistakes that have nothing to do with having 2,562 products.

The single biggest one, and I did not see it until I measured byte arrival
times: **the first thing your shoppers look at for 2.3 seconds is the HOME
PAGE's loading skeleton.** Not the shop page. Not a shop skeleton. A grey
mock-up of the home page — a fake hero block and three fake promo cards —
rendered on the shop URL.

That is your 2.3 s First Contentful Paint. Your competitor's 0.8 s FCP is not
better engineering on their part; you're painting the wrong thing.

---

## Part 2 — What actually happens, millisecond by millisecond

I recorded when each byte arrived and when each piece of real markup first
appeared:

```
     0 ms         browser requests the page
   476 ms  (+476) first byte, <head> complete
   476 ms  (+  0) HOME PAGE skeleton painted   <-- this is your FCP
  1678 ms  (+1202) shop banner + filter skeleton arrive
  2808 ms  (+1130) the real site header finally arrives
  2849 ms  (+ 41) first product card arrives   <-- this is your LCP
  3027 ms  (+178) footer, stream ends
```

Arrival curve, same request:

```
   750 ms   +    83,860 bytes    2.4% of the document
  1000 ms   +       377 bytes    2.5%
  1250 ms   +       879 bytes    2.5%     <-- ~700 ms of near-total silence
  2000 ms   + 2,915,923 bytes   87.3%     <-- the entire catalog lands at once
  2250 ms   +   436,788 bytes  100.0%
```

Read that middle section carefully. The connection is open, 84 KB has arrived,
and then for roughly **700 milliseconds essentially nothing is sent**. The
server is waiting on the database and the shopper is watching a fake home page.
Then 2.9 MB arrives in one burst and the phone has to parse all of it before it
can show a single product.

That is the shape of your problem. Not bandwidth. **Order of operations.**

### Proof of the wrong skeleton

The first paintable markup in the response body, taken verbatim from the live
stream (I dumped the raw first chunks):

```html
<main class="min-h-screen bg-black px-4 py-10 text-white md:px-8">
  <div class="mb-8 flex items-center gap-3">
    <div class="h-11 w-11 animate-pulse rounded-full bg-[var(--greenway)]"></div>
    ...
  <section class="film-strip ..."> ... </section>          <!-- fake hero -->
  <section class="mt-8 grid gap-5 md:grid-cols-3">          <!-- 3 fake cards -->
```

That is `src/app/loading.tsx` — the ROOT loading file — byte for byte. There is
no `src/app/menu/loading.tsx`. Per the Next.js `loading.js` docs, a `loading.js`
higher in the tree is a valid Suspense boundary, so the framework finds it,
stops there, and uses it for `/menu`. The Next.js streaming guide states the
consequence plainly:

> "A `loading.js` high in the tree is a valid boundary, so the framework finds
> it and stops, but now the entire page falls back to a full-page skeleton
> instead of streaming granularly."

So the shopper sees a hero block and three promo cards where a shop banner and a
product grid belong. It is the wrong shape, in the wrong place, for 2.3 seconds.

### And the `<Suspense>` already in the shop page does nothing

`src/app/menu/page.tsx` wraps the browser in `<Suspense>`. It cannot help.
Every `await` — the catalog, the enrichment ladder, the banners, the carousel —
runs **before** the `return` statement:

```
line  2:  const resolvedSearchParams = await searchParams;
line 13:  const enrichedMenuItems = await withCategoryOverride(
line 14:      await withDohCompliance(
line 15:        await withDisplayKnowledge(
line 16:          await withResolvedImages(await withMenuProfile(await loadLiveMenuItemsCached())),
line 40:  const [categoryLabels, banners, shopSlides, promotionTitles] = await Promise.all([...]);
line 88:  return (        <-- the <Suspense> only exists from here on
```

A Suspense boundary can only stream around work that happens *inside* it. All of
our work finishes before the JSX is created, so the boundary wraps a component
whose data is already sitting in a variable. The Next.js guide names this exact
mistake:

> "If you `await` any of these at the top of a layout or page, everything below
> that point becomes dynamic and cannot be prerendered as part of the static
> shell. Instead, pass the promise down and let the consuming component resolve
> it inside a `<Suspense>` boundary."

**We have the right tool installed backwards.** Michael's instinct — "maybe
begin painting the page immediately while the big components load" — is exactly
right, and it is exactly what the framework is built to do. We just aren't
letting it.

---

## Part 3 — Why the competitor's numbers look the way they do

Their reported figures: FCP 0.8 s, LCP 5.8 s, TBT 10 ms, Speed Index 1.1 s,
score 71.

Ours: FCP 2.3 s, LCP 6.1 s, TBT 530 ms, Speed Index 5.4 s, score 58.

Compare them honestly, metric by metric:

**LCP: 5.8 s vs our 6.1 s — we are essentially tied.** Their biggest element is
no faster than ours. Neither site is winning here.

**FCP 0.8 s vs 2.3 s.** They paint something real almost immediately. We paint
the wrong skeleton at 0.48 s and the right content at 2.8 s; the scoring tool
records the meaningful paint late. This is the wrong-skeleton defect, not a
hardware or hosting difference.

**Speed Index 1.1 s vs 5.4 s.** Speed Index measures how quickly the visible
area *fills in*. Theirs fills progressively. Ours shows a placeholder, sits
still through a 700 ms silence, then repaints wholesale at ~2.8 s. That single
late repaint is what a 5.4 s Speed Index looks like.

**TBT 10 ms vs 530 ms. This is the real architectural difference.** Total
Blocking Time measures main-thread work — JavaScript parsing and executing. A
TBT of 10 ms means their browser receives **a small number of products**, almost
certainly a paginated page. Our 530 ms is the phone parsing a 2.5 MB array of
2,562 products, because we ship the entire catalog to the browser and filter it
in JavaScript.

So the fair summary is: **they are not doing anything magical.** They paint the
right thing first and they don't ship their whole catalog at once. Two
decisions, both available to us.

One thing worth saying plainly: a score of 58 or 69 is not a grade on your
business. It is a lab simulation on a throttled mid-range Android over slow 4G.
The metrics that matter for shoppers are what they see at 1 second and whether
tapping a filter feels instant. Chasing the number for its own sake would be the
wrong goal; fixing what the number is *pointing at* is the right one.

---

## Part 4 — The three defects, in priority order

### Defect 1 — the page is never cached by the CDN (verified from framework source)

```
/menu             cache-control: private, no-cache, no-store, max-age=0, must-revalidate
                  x-vercel-cache: MISS        age: 0
/                 public, max-age=0, must-revalidate   STALE   age: 334
/vendor-delivery  public, max-age=0, must-revalidate   STALE   age: 349
```

Every request rebuilds the page. The home page — the one that now feels instant
to you — is served from the edge.

That exact header string is emitted on exactly one branch in
`next/dist/server/lib/cache-control.js`: when `revalidate === 0`. The full chain,
every link read from source:

> `menu/page.tsx:75` `await searchParams`
> → `createStaticPrerenderSearchParams` (`request/search-params.js`)
> → `makeErroringSearchParams`
> → `throwToInterruptStaticGeneration` (`app-render/dynamic-rendering.js:269`)
> → `prerenderStore.revalidate = 0`
> → `collectedRevalidate === 0` (`app-render/app-render.js:1635`)
> → `cache-control: no-store` → the CDN is forbidden to store the page.

Reading the query string on the server is what makes the page uncacheable. The
`export const revalidate = 60` from Slice E is overwritten three lines into the
component. It never had a chance.

Ruled out by reading source, so we don't fix the wrong thing: middleware (matcher
is `/admin/:path*`), `draftMode()` (returns an empty provider during prerender —
checked twice because it looks guilty and isn't), `cookies()` (not in the menu
path), and payload size (a MISS is a policy refusal, not a size limit).
`searchParams` is the only dynamic API in the entire `/menu` tree.

### Defect 2 — the wrong skeleton, and streaming that isn't streaming

Covered in Part 2. This is the FCP and Speed Index defect, and it is the one
that most directly matches what you actually feel.

### Defect 3 — the whole catalog ships to every phone

```
raw document          3,437,412 bytes   (~250 KB compressed on the wire)
  RSC flight payload  3,024,457
  the items array     2,505,260   = 2,562 products
DOM elements                2,702
product cards rendered        165   (the render cap from Slice B)
```

Note the mismatch: we render **165** cards but ship data for **2,562** products.
Every phone downloads, decompresses, JSON-parses and retains all of it. That is
your TBT (530–890 ms), your 5–8 long tasks, and your "Optimize DOM size" and
"Forced reflow" warnings. It is also why desktop LCP is a healthy 1.1 s while
mobile is 6.0 s — a desktop CPU chews through it and a Moto G Power does not.

Vercel's own guidance, from "How to Optimize RSC Payload Size":

> "When you render many instances of one component — a grid of product cards,
> for example — use pagination or infinite scroll, loading in batches so that you
> don't send more data than you need at once."

Within that array, **475,808 bytes are fields that say nothing**:
`unitsPerPackage` null in 2,561 of 2,562 items, `otherwiseTaken` null in all
2,562, `dohCompliant` false in all 2,562. Omitting absent optional fields:

```
current        raw 2,505,415   gzip 204,221
nulls dropped  raw 2,098,540   gzip 198,213
saved              406,875 raw (16.2%)     6,008 gzip (2.9%)
```

Being straight: that saves only ~6 KB on the wire, because gzip already squashes
a column of identical nulls. **The win is 407 KB less for the phone to parse.**
It helps blocking time, not bandwidth.

Deleting big fields is not available — I grepped all 32 fields of
`GreenwayMenuItem` for readers across `src/components/menu`, `src/lib/menu` and
`src/lib/promotions`. Every one is used. `variants` and `compounds` (25% of the
payload) are read by the potency line and price selector on every card.

### Minor, real, already identified

Render-blocking CSS is 42.8 KB across two files, and **13 script tags sit in the
`<head>`** (measured gzipped: 71.4 KB + 41.1 KB + 14.6 KB + 14.5 KB + 14.0 KB +
13.1 KB + 12.1 KB + 9.4 KB + 8.8 KB + 5.4 KB + 4.4 KB + 1.0 KB). This is
PageSpeed's "render-blocking requests" (560–590 ms on mobile) and part of the
87 KiB of unused JavaScript.

---

## Part 5 — The plan

Ordered by measured impact per unit of risk. Each step is independently
shippable and independently verifiable.

### F1 — Give `/menu` its own skeleton that looks like the shop page

Add `src/app/menu/loading.tsx`: banner block, filter sidebar, and a grid of card
placeholders sized to the real cards.

* Fixes the "fake home page" defect immediately.
* Improves FCP and Speed Index because the first paint is finally the right
  shape.
* Helps CLS, per the streaming guide: "Design skeleton fallbacks that match the
  dimensions of the content they represent."
* **Risk: near zero.** New file, no existing behavior touched.

### F2 — Actually stream: move the data work below the `return`

Extract the catalog fetch + enrichment into a child server component and let the
page return its JSX immediately, with the child inside `<Suspense>`. Header,
breadcrumbs, banner and filter chrome paint as the static shell while the catalog
resolves.

* Removes the 700 ms silent gap from the user's experience — they see real page
  furniture during it instead of a placeholder.
* Directly implements "push dynamic access down" from the Next.js guide.
* **Risk: low-moderate.** It is a restructure of one page; no data logic changes.

### F3 — Make the page CDN-cacheable

Stop reading `searchParams` on the server; let the client resolve deep-link
filters from the live URL, which it already does today via `resolveInitialParams`
reading `window.location.search`.

* Removes the ~1,300 ms "document request latency" on all three PageSpeed runs.
* **This is the trade-off that needs your decision** — see Part 6.

### F4 — Stop shipping 2,562 products to render 165

Two stages:

* **F4a (safe now):** omit absent optional fields. 407 KB less JSON to parse on
  every phone. Pure projection, no type change, nothing removed that exists.
* **F4b (the real fix, needs design):** send the first page of products and load
  the rest on demand. This is what gives the competitor a 10 ms TBT and it is
  Vercel's explicit recommendation. It is also the most invasive change, because
  our filters, facet counts and sliders are all computed from the full in-memory
  array — the sidebar's category counts and the THC/price slider ceilings are
  derived from every product. Doing this properly means moving facet computation
  to the server. **I would not bolt this on quickly.** It deserves its own slice
  and its own careful plan.

### F5 — Trim the head

Deferred/lazy-load non-critical client components so fewer of the 13 head scripts
block the first paint; address the 87 KiB of unused JS and the 14 KiB of legacy
JS. Plus the known carry-overs: memoise `matchesSearch`
(`InteractiveMenuBrowser.tsx:363`), hoist the `new RegExp` out of the loop in
`src/lib/ai/compliance.ts:149` (25.2 ms → 3.2 ms), and the `.select("*")` still
in `getVersionItems`.

---

## Part 6 — The one decision that is yours

F3 requires giving up server-side deep-link filtering. There is no way to keep
both: reading `searchParams` on the server is precisely what makes the page
uncacheable, and per-route PPR — which would solve this elegantly — was removed
in Next.js 16.2.9 (`experimental.ppr` now throws a hard deprecation error; it was
folded into `cacheComponents`, an app-wide switch I am not flipping for one
page).

Today the server does filter deep links. Verified live: `/menu?category=flower`
returns 144 product links, plain `/menu` returns 165.

* **Option A (recommended):** deep-link filters apply on the client. Everyone
  gets an edge-cached shop page. Cost: a category link from the mobile nav, a
  brand link, or a Specials link may show the unfiltered grid for a fraction of a
  second before the filter applies. A plain "click Shop" visit — the exact thing
  you're complaining about — has no query string and shows no flash at all.
* **Option B:** keep server-side deep-link filtering, and `/menu` stays
  uncacheable permanently.

Note that **F1, F2, F4a and F5 do not depend on this decision** and can ship
either way. If you'd rather not decide yet, I can ship those first — they are
the ones that fix the wrong skeleton and the dead 700 ms, which is most of what
you actually feel.

---

## Part 7 — Honest expectations

What I am confident about, because it follows from measurements:

* F1 + F2 will change what you *see*. The shop page will start showing shop
  furniture within a few hundred milliseconds instead of a home-page mock-up at
  2.3 s. FCP and Speed Index should improve substantially.
* F3 removes a full second of server time on repeat visits, verifiable in one
  command (`curl -D-` showing `s-maxage=60` and `x-vercel-cache: HIT`).
* F4a is a modest, real, safe improvement to blocking time.

What I will not promise:

* I will not put a predicted score on this. PageSpeed's number is a weighted
  simulation and I would be guessing. I will re-measure with the same probes
  after each step and show you before/after.
* **TBT will not reach the competitor's 10 ms until F4b** (real pagination). As
  long as we hand the browser 2,562 products, the phone must parse 2,562
  products. F4a trims it; only F4b removes it.

Recommended sequence: **F1 → F2 → F4a → F5**, re-measuring after each, then F3
once you've picked A or B, then F4b as its own carefully planned slice.

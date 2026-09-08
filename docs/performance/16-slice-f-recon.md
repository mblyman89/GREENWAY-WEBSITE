# Slice F recon — why /menu is still slow after Slice E

Ground rules for this document: every number below was measured against the
LIVE deployment or read out of framework source in `node_modules/next`. Nothing
here is inferred, recalled, or estimated unless the word "estimate" appears and
names the tool that produced it.

Repo state at time of recon: `76f8b68c` (Slice E), working tree clean.

---

## 0. Timeline check — do the PageSpeed reports describe the CURRENT site?

Yes. This mattered enough to verify before drawing any conclusion from them.

| Event | UTC |
|---|---|
| Slice E merged (`76f8b68c`) | 2026-09-07 22:04:47 |
| PageSpeed mobile first load captured | 2026-09-07 22:17 |
| PageSpeed mobile second load + desktop captured | 2026-09-07 22:19 |

The reports post-date the Slice E deploy, so they measure the site as it stands
today. Confirmed independently in the live payload: every product now serializes
`"description":""`, which is the Slice E grid projection doing its job.

## 1. What the reports actually say

| Metric | Mobile 1st | Mobile 2nd | Desktop |
|---|---|---|---|
| Performance | 51 | 58 | 69 |
| FCP | 2.3 s | 2.3 s | 0.5 s |
| LCP | 6.0 s | 6.1 s | 1.1 s |
| TBT | 890 ms | 530 ms | 650 ms |
| Speed Index | 5.4 s | 5.4 s | 2.1 s |
| CLS | 0 | 0 | 0 |

Insights appearing on ALL THREE runs:

* Document request latency — est. savings **1,370 / 1,340 / 1,270 ms**
* Render-blocking requests — 140 / 590 / 560 ms
* Legacy JavaScript — 14 KiB
* Forced reflow
* Optimize DOM size
* Reduce unused JavaScript — 87 KiB
* Avoid long main-thread tasks — 5 to 8 found

Desktop LCP is already 1.1 s. Mobile LCP is 6.0 s. The metric that is bad on
BOTH is TBT (650 ms desktop, 890 ms mobile). That shape — good desktop paint,
bad blocking time everywhere — points at main-thread work, not at bandwidth.

## 2. Finding #1 — the shop page is never cached by the CDN

Measured with `curl -s -D-` against the live deployment:

```
/menu             cache-control: private, no-cache, no-store, max-age=0, must-revalidate
                  x-vercel-cache: MISS        age: 0
/                 cache-control: public, max-age=0, must-revalidate
                  x-vercel-cache: STALE       age: 334
/vendor-delivery  cache-control: public, max-age=0, must-revalidate
                  x-vercel-cache: STALE       age: 349
```

`/menu` is a MISS with `age: 0` on every single request. The home page, which is
now instant for the owner, is served from the edge with an age of several
minutes. That is the whole difference between the two pages.

### Why, proven from framework source (not inferred)

`node_modules/next/dist/server/lib/cache-control.js:12`

```js
function getCacheControlHeader({ revalidate, expire }) {
  if (revalidate === 0) return 'private, no-cache, no-store, max-age=0, must-revalidate';
  else if (typeof revalidate === 'number') return `s-maxage=${revalidate}${swrHeader}`;
  return `s-maxage=${CACHE_ONE_YEAR_SECONDS}${swrHeader}`;
}
```

The header we observe is emitted on exactly one branch: `revalidate === 0`. So
at runtime the page's `export const revalidate = 60` is being overridden.

`node_modules/next/dist/server/app-render/app-render.js:1635`

```js
if (workStore.forceStatic === false || response.collectedRevalidate === 0) {
  metadata.cacheControl = { revalidate: 0, expire: undefined };
}
```

`collectedRevalidate` comes from the prerender store. And this is what writes 0
into it — `node_modules/next/dist/server/app-render/dynamic-rendering.js:239`
and `:269`:

```js
case 'prerender-legacy':
  workUnitStore.revalidate = 0;      // bail out of static generation
```

```js
function throwToInterruptStaticGeneration(expression, store, prerenderStore) {
  prerenderStore.revalidate = 0;
  ...
}
```

And this is who calls it, `node_modules/next/dist/server/request/search-params.js`:

```js
function createStaticPrerenderSearchParams(workStore, prerenderStore) {
  if (workStore.forceStatic) return Promise.resolve({});
  switch (prerenderStore.type) {
    case 'prerender-ppr':
    case 'prerender-legacy':
      // We are in a legacy static generation and need to interrupt the
      // prerender when search params are accessed.
      return makeErroringSearchParams(workStore, prerenderStore);   // -> :325 throwToInterruptStaticGeneration
```

Complete chain, every link read from source:

> `src/app/menu/page.tsx:75` `await searchParams`
> → `createStaticPrerenderSearchParams`
> → `makeErroringSearchParams`
> → `throwToInterruptStaticGeneration`
> → `prerenderStore.revalidate = 0`
> → `collectedRevalidate === 0`
> → `cache-control: private, no-cache, no-store`
> → Vercel CDN cannot store it → `x-vercel-cache: MISS` forever.

`export const revalidate = 60` never had a chance. It is not being ignored — it
is being overwritten by the searchParams read three lines into the component.

### Candidates ruled OUT by reading source (so we do not "fix" the wrong thing)

* **`src/middleware.ts`** — `export const config = { matcher: ["/admin/:path*"] }`.
  It never runs on `/menu`.
* **`draftMode()`** in `src/app/layout.tsx:79`, `render-content.ts`,
  `page-sections-store.ts:160`, `shop-carousel-store.ts:142`. Re-verified in
  `next/dist/server/request/draft-mode.js`: on `prerender-legacy` it returns
  `createOrGetCachedDraftMode(null, workStore)`, and `DraftMode.isEnabled`
  returns `false` from a null provider without touching dynamic tracking.
  `trackDynamicDraftMode` is only reachable from `.enable()` / `.disable()`,
  which the storefront never calls. Not the cause. (Checked twice, in two
  separate sessions, because it looks guilty and is not.)
* **`cookies()`** in `src/lib/supabase/server.ts:8` — only reached from
  `books-client.ts` and `auth/session.ts`. Not in the menu path.
* **Payload size** — a 250 KB compressed document does not produce a `MISS`.
  Caching is refused by policy, not by size.

`searchParams` is the ONLY dynamic API on the whole `/menu` tree. Verified by
grepping every dynamic entry point across `src/`.

### What it costs

Live TTFB for `/menu`, three consecutive runs: 1.500 s, 0.287 s, 0.455 s. The
first is a cold function, the rest are warm functions still doing full work
because nothing is stored at the edge. A CDN hit on the same platform serves in
tens of milliseconds. PageSpeed's "Document request latency" estimate of
1,270–1,370 ms is its model of this same fact.

## 3. Finding #2 — the document is 3.4 MB and 2.5 MB of it is one array

Measured by downloading the live page and parsing it:

```
raw document                     3,437,412 bytes
  inline <script> content        3,029,773   (112 tags)
  of which RSC flight payload    3,024,457   (46 pushes)
  non-script HTML                  407,639
compressed on the wire             ~250,000
```

Decoding the flight stream and parsing the props actually handed to
`<InteractiveMenuBrowser>`:

```
items array          2,505,260 chars
item count           2,562 products
```

Per-field cost across all 2,562 products (top of the list):

| field | bytes | share |
|---|---|---|
| variants | 376,899 | 13.8% |
| compounds | 317,770 | 11.6% |
| productName | 164,445 | 6.0% |
| totalThc | 149,972 | 5.5% |
| totalCbd | 148,137 | 5.4% |
| posInventoryType | 113,692 | 4.2% |
| filterCategories | 105,295 | 3.9% |
| posInventoryCategory | 97,686 | 3.6% |
| inventoryStatus | 80,416 | 2.9% |
| strainName | 77,062 | 2.8% |

This array is transferred, decompressed, JSON-parsed, and retained by every
phone that opens the shop page. That is the work behind TBT (530–890 ms),
"Avoid long main-thread tasks" (5–8), "Optimize DOM size", and "Forced reflow".
It is why desktop LCP is a healthy 1.1 s while mobile LCP is 6.0 s: the desktop
CPU chews through it and a Moto G Power does not.

### The cheapest slice of that: fields that carry no information

Counting values that are `null`, `""`, `[]`, or `false` — bytes spent to say
"nothing here":

```
TOTAL null/empty/false cost: 475,808 bytes  (19% of the items array)

unitsPerPackage    66,586   null in 2,561/2,562 items
otherwiseTaken     64,051   null in 2,562/2,562 items
dohCompliant       61,488   false in 2,562/2,562 items
lowThcLiquid       58,903   null in 2,561/2,562 items
dohCategory        56,364   null in 2,562/2,562 items
description        51,240   ""   in 2,562/2,562 items   <- already blanked by Slice E
unitThcMg          51,220   null in 2,561/2,562 items
hidden             46,116   false in 2,562/2,562 items
```

Measured effect of omitting absent optional fields instead of serializing them
as null:

```
current        raw 2,505,415   gzip 204,221
nulls dropped  raw 2,098,540   gzip 198,213
saved              406,875 raw (16.2%)      6,008 gzip (2.9%)
```

Read that honestly: it barely changes what crosses the network, because gzip
already compresses a column of identical `null`s to nearly nothing. The win is
407 KB less JSON for the phone to PARSE and 2,562 fewer objects' worth of
properties to allocate and retain. It helps TBT, not transfer.

**Field removal beyond that is NOT available.** Every field on
`GreenwayMenuItem` was checked for readers across `src/components/menu`,
`src/lib/menu`, and `src/lib/promotions`. All 32 are referenced. `variants` and
`compounds`, the two biggest, are read by `cardCannabinoids()` through
`ProductCardVisual`. Nothing here is dead weight that can simply be deleted.

## 4. The one decision that is not mine to make

Fixing Finding #1 means the server can no longer read the query string, because
reading it is precisely what makes the page uncacheable. The framework offers no
way to have both: `searchParams` opts the route into dynamic rendering, full
stop, and per-route PPR is not available on Next 16.2.9 (`experimental.ppr` now
throws `HardDeprecatedConfigError` — it has been folded into `cacheComponents`,
an app-wide switch that is far too broad to flip for one page).

Today the server DOES filter deep links. Verified live:

```
/menu                    initialSearchParams.category = ""
/menu?category=flower    initialSearchParams.category = "flower"
```

and the two documents contain different first-paint cards (165 vs 144 product
links). That behavior was a deliberate past decision, recorded in
`src/app/menu/page.tsx:153`:

> "so a shared /menu?doh=... link renders already-filtered on the server instead
> of flashing the full grid"

So the trade is explicit:

* **Keep server-side deep-link filtering** → `/menu` stays uncacheable forever,
  and every visitor pays full server render time.
* **Move deep-link filtering to the client** → `/menu` becomes edge-cached for
  everyone, and a deep link (`?category=flower` from the mobile nav, a brand
  link, a Specials link) paints the unfiltered grid for a moment before the
  filter applies.

A plain `/menu` visit — the "click Shop" path that is actually being complained
about — carries no query string and would show no flash at all.

`force-static` is explicitly rejected as the mechanism: per
`next/dist/server/request/draft-mode.js` and the `workStore.forceStatic` checks,
it forces `cookies`/`headers`/`draftMode` to empty values, which would break the
admin preview of the Shop banner carousel (`shop-carousel-store.ts:142`). Simply
not reading `searchParams` achieves the same caching with no such side effect,
and draft-mode requests still bypass the ISR cache normally.

## 5. Proposed Slice F, pending the decision above

* **F1 — make `/menu` edge-cacheable.** Stop reading `searchParams` on the
  server; hydrate filters on the client from the live URL in a mount effect so
  server and client agree at hydration time (no mismatch, no console errors).
  Verify with `curl -D-` expecting `s-maxage=60` and `x-vercel-cache: HIT`.
* **F2 — stop serializing absent optional fields.** Pure projection, measured
  407 KB less JSON to parse on every phone. No type change, no field genuinely
  removed. Safe regardless of the F1 decision.
* **F3 — main-thread carry-overs**, all previously identified and still open:
  memoise `matchesSearch` (`InteractiveMenuBrowser.tsx:363`), hoist the
  `new RegExp` out of the loop in `src/lib/ai/compliance.ts:149`
  (25.2 ms → 3.2 ms), and `getVersionItems` still using `.select("*")`.

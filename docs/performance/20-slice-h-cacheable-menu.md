# Slice H — the shop page can finally be cached, and categories became real pages

Merged as `d16d1e85` + `b0e95039`, with follow-up `b2edfbed`. All authorship-verified `mblyman89`, CI green.

## What was wrong, measured

`/menu` read `searchParams`. Next.js documents the consequence plainly:

> "`searchParams` is a Request-time API whose values cannot be known ahead of time. Using it will opt the page into dynamic rendering at request time."

Probing the live deployment before the change showed exactly that. `/menu` was the only public route on the site that never came from the CDN. Measured with cache-busting query strings, five samples each, so every request is what a genuinely new visitor gets:

| Route | Median | Cache |
|---|---|---|
| **`/menu`** | **1,415 ms** | MISS, MISS, MISS, MISS, MISS |
| `/` | 59 ms | STALE, STALE, STALE, STALE, HIT |

The shop page — the single most important page the business has — was **24× slower than the home page**, and its response carried `cache-control: private, no-cache, no-store`. PageSpeed had reported the same thing from the outside as "server responded slowly (observed 1324 ms)", est. savings 1,220 ms. Two independent measurements, one cause.

`draftMode()` had been suspected three separate times across earlier slices. It was cleared again here by controlled comparison rather than by argument: the home page calls `draftMode()` through `getSectionsForRender`, has `revalidate = 60`, reads the database on every render — and caches. `/blog` does the same and is PRERENDER. The only structural difference between `/` and `/menu` was `searchParams`.

## What changed

The category facet was promoted from a query string to a real route segment. That distinction is the whole slice: a route segment is known at build time, so the page can be prerendered into the CDN; a query string is request-time, so it cannot.

`src/lib/menu/menu-facet-core.ts` is a new pure core that decides which facets are safe to promote. Categories are a closed set of 21 owned by `category-taxonomy.ts`. Brands (191), vendors (113), strains, terpenes, weights, the THC/CBD/price sliders and sort order all stay on the client, because they are open sets that change with every receiving run and their combinations are unbounded — promoting them would create an infinite prerender surface and a crawl trap. That reasoning is pinned by the core's own self-tests, so a future change has to argue with a failing test rather than with a comment.

`src/app/menu/[category]/page.tsx` enumerates all 21 categories through `generateStaticParams` and prerenders them, each with its own canonical, title, description and breadcrumb trail. `dynamicParams = false` means an unknown slug 404s at the edge without ever reaching the origin.

`src/components/menu/ShopPage.tsx` is one renderer that both shop routes call, so they cannot drift apart. Slice F2's streaming shape is preserved and in fact strengthened — the shell now awaits nothing at all, which is a stronger guarantee than "awaits nothing expensive."

## What it bought — measured, same method as the baseline

| Route | Before | After | Change |
|---|---|---|---|
| `/menu` | **1,415 ms**, MISS ×5 | **67 ms**, HIT ×5 | **21× faster, −1,348 ms** |
| `/menu/flower` | 404 (did not exist) | **63 ms**, HIT ×5 | new |
| `/` (control) | 59 ms | 72 ms | unchanged |

`cache-control` went from `private, no-cache, no-store` to `public`. `/menu` is now marginally faster than the home page. The −1,348 ms lands almost exactly on PageSpeed's predicted 1,220 ms saving, which is the best available confirmation that the diagnosis was right rather than lucky.

Throttled mobile (4× CPU, 1.6 Mbps, 150 ms RTT), two runs, reproducible:

```
/menu          TTFB  55ms   FCP 4344ms   LCP 4908ms   TBT 1135ms   CLS 0.0000
/menu          TTFB  55ms   FCP 4328ms   LCP 4980ms   TBT 1150ms   CLS 0.0000
/menu/flower   TTFB  59ms   FCP 3896ms   LCP 4776ms   TBT 1156ms   CLS 0.0000
```

TTFB is now 55 ms. LCP improved from 6.2 s to ~4.9 s and TBT from ~1,970 ms to ~1,140 ms. CLS is holding at exactly 0.0000, so Slice G's fix survived this refactor — worth checking explicitly, because Slice F1 is precisely where a well-intentioned change silently broke it before.

All 21 category routes return 200. A bogus slug returns 404.

## The SEO half

`/menu?category=flower` was, to a search engine, the shop page with a parameter on it — one page, not twenty. The 21 categories are now distinct documents with self-referencing canonicals, unique titles and unique descriptions, each targeting the query that actually converts:

```
/menu/flower         canonical .../menu/flower         h1 "Flower"
/menu/cartridge      canonical .../menu/cartridge      h1 "Cartridge"
/menu/edible-solid   canonical .../menu/edible-solid   h1 "Edible (Solid)"
```

## Two bugs the work surfaced, both mine

**`truncateAtWord` returned more than it promised.** It sliced to `maxLength` and *then* appended an ellipsis, so it could return `maxLength + 3`. The one caller that matters is the meta description, where overflowing is the exact thing being guarded against. Worse, its self-test had been written as `<= 158` — a bound chosen to fit the observed output, which accommodated the bug instead of catching it. That is a rubber stamp, not a test. The bound is now the real 155, and the length promise is asserted directly across a range of budgets including a pathological no-spaces input.

**Category titles rendered the brand twice, at 88 characters.** This one was only visible in the deployed HTML, because it came from two places: the root layout applies `template: "%s | Greenway Marijuana"`, and `categoryMetaTitle` also ended with `| Greenway Marijuana Port Orchard`. The live page rendered:

```
Flower — Cannabis Menu | Greenway Marijuana Port Orchard | Greenway Marijuana
```

Google renders about 60 characters, so the words doing the actual work were the ones being cut. The site convention is that the template supplies the brand and the page supplies the distinguishing words (`/locations` does this correctly). Titles now follow it — longest rendered title is 60 characters, brand appears once.

The self-test missed this because it asserted the *raw* title contained "Greenway", which passed while the rendered title was wrong. A test that checks a string other than the one the user sees is measuring the wrong thing. Both tests now assert the rendered form. The brand check is scoped to the full "Greenway Marijuana" string rather than the bare word, because "Greenway Merch" is a real category label — found by running the check, not by guessing.

## On the 13 existing assertions

Thirteen assertions across seven files pointed at `src/app/menu/page.tsx` for code that legitimately moved into the shared renderer. Every one was retargeted, not weakened, and several now cover both routes where they previously covered one.

Two deserved particular care. `classification-facet-plumbing` and `legal-policies-theme` guard a real, previously-shipped bug: a shared `?doh=` or `?strains=cbd` link flashing the unfiltered grid on first paint. Deleting them because the code moved would have thrown away the guard on a live defect. They now assert the promise on the mechanism that keeps it — `resolveInitialParams`, running in a `useState` lazy initializer so filters apply during the first client render rather than in a post-mount effect.

That the mechanism is complete was verified mechanically rather than assumed: the resolver reads back all 16 params the URL-writer can write, and `syncFromUrl` restores the same complete set on back/forward. A new test derives both sets from the source and requires them to match, so adding a filter that writes to the URL but forgets to read it back now fails.

## Verification

- `tsc --noEmit` 0 errors; `eslint` 0 errors, 0 warnings
- pure self-tests: ALL PASSED, `menu-facet-core` 42/42, registered in the CI runner
- vitest: **589 files, 14,964 tests, all passing**
- **11/11 mutations caught**, including: reintroducing `searchParams`; `dynamicParams = true`; canonicalising every category back to `/menu`; a nav-link typo pointing at a slug with no prerendered page; reverting a link to `?category=`; hoisting the catalog read above the Suspense boundary; `revalidate` drift; dropping `?doh=` resolution; resolving in an effect instead of a lazy initializer; a category slug colliding with the `/menu/products` segment; and reintroducing the duplicated brand.

## What is still wrong — the next slice

The page still ships **3.35 MB of HTML**. Roughly 88% of that is the RSC flight payload carrying the entire catalog — 2,563 brands, 2,562 vendors, 2,570 descriptions, 7,466 THC values — to render **48 cards**. Every shopper downloads and parses ~2,500 products they will never see.

That is what the remaining numbers are made of: TBT ~1,140 ms is almost entirely script evaluation, and LCP ~4.9 s is dominated by the parse. Slice H removed the server-side cost of the shop page; it did not reduce what the page sends. Caching a 3.35 MB document makes it arrive faster, not smaller.

Sending only the first page of products and fetching the rest on demand is the single largest remaining win on this page, and it is the next slice.

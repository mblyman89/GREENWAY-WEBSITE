# Slice I — the age gate was the Largest Contentful Paint

After Slice H the shop's Total Blocking Time had come down from 1,970 ms to
180 ms and the PageSpeed performance score had gone from 23 to 71. The remaining
bad number was Largest Contentful Paint at 6.1 s in the field. This slice is
about finding out what that number was actually measuring, and it turned out not
to be what anyone had assumed.

## What was measured, and what it showed

Every figure below was taken from `greenwaywebsite1.vercel.app/menu` on a
throttled mobile profile — 4× CPU slowdown and 1.6 Mbps — which is the same
profile PageSpeed itself uses. A `PerformanceObserver` was attached for
`largest-contentful-paint` and every candidate the browser considered was
recorded rather than just the final value:

```
LCP candidate 1 .. t=3896ms  IMG   header wordmark
LCP candidate 2 .. t=4292ms  SPAN  "Browse our full selection..."
LCP candidate 3 .. t=4804ms  P     "you must be 21 years of age or older"  <- FINAL
```

The element defining the storefront's LCP was the age-gate modal's paragraph.
Not a product card, not the hero image, not the catalog. Then the served HTML
was checked directly:

```
served HTML contains "21 years of age"?  false
served HTML contains "Age Verification"? false
```

The element that defined LCP **was not in the HTML the server sent at all**.
`AgeGate` is a client component, and its `useSyncExternalStore` server snapshot
returned `true` — meaning "already confirmed" — so it rendered nothing during
server-side rendering. The modal could only appear after React had downloaded,
parsed, and hydrated the page, and this page hydrates a 3.3 MB payload
(`domInteractive` 5,695 ms).

So LCP was not waiting on bytes. It was waiting on JavaScript to execute. That
distinction is the whole slice: it means the entire class of
"make-the-payload-smaller" fixes could not have moved this number much, because
the LCP element's arrival time was set by hydration completing, not by transfer
finishing.

## The optimisation that was built, measured, and then rejected

The plan carried into this slice was a columnar codec for the item array — the
catalog ships 2,562 products to render 69 cards, and repeated JSON key names
accounted for 1,327 KB, or 51.7%, of the flight payload. Encoding the array
column-wise serialises each key name once instead of 2,562 times.

It was built and benchmarked against 2,561 items harvested from the real live
payload rather than reasoned about in the abstract:

```
                 raw          brotli-11
row-oriented     2,492 KB     132 KB
columnar         1,577 KB     112 KB
saving           36.7%        20 KB

JSON.parse(row-oriented)      median  9.9 ms
JSON.parse(columnar)          median  6.5 ms
columnar parse + rehydrate    median 13.0 ms   <- +3.1 ms, a 31% regression
```

The raw saving is real and large. It is also almost entirely irrelevant, because
brotli already removes most of that redundancy on the wire: the measured document
was 239 KB transferred against 3,465 KB decoded. The codec buys 20 KB on a wire
that measurement had already shown was not the bottleneck, and it pays for that
saving in main-thread time — because the columnar form has to be rehydrated into
objects before any existing client code can use it, and that loop costs more than
the parse it saved.

Trading 3.1 ms of main-thread work for 20 KB of transfer is the wrong direction
on a page whose problem is decode and hydration, and it is a direct regression to
Total Blocking Time, which is the metric that had just been brought under
control. So the codec was abandoned. It is documented here in full, with its
numbers, so nobody has to re-derive it.

One correction worth recording: an earlier run of the round-trip check reported
`identical? false`, which looked like data loss. It was not. The throwaway
decoder mapped absent keys and genuine `null`s onto the same sentinel, and the
comparison used `JSON.stringify`, which is key-order sensitive. With both fixed
the round-trip is semantically exact. The codec was rejected on its performance
numbers, not because it was broken.

## The fix

Render the age gate in the server HTML so that it paints with the first paint
instead of after hydration. Once the gate exists in the initial HTML, it stops
being the thing LCP waits for.

The complication is the reason the component was written the way it was: whether
a visitor has already confirmed their age lives in `localStorage`, which the
server cannot read. Server-rendering the gate naively would flash a modal in
front of every returning customer on every page load, which is a worse
experience than a slow LCP.

The resolution is a small synchronous inline script in `<head>`:

```js
(function(){try{if(window.localStorage.getItem("greenway-age-confirmed-v1")==="true"){
document.documentElement.setAttribute("data-age-confirmed","true");}}catch(e){}})();
```

paired with one CSS rule in `globals.css`:

```css
[data-age-confirmed="true"] [data-age-gate] { display: none !important; }
```

The script runs before the browser computes first paint, so the attribute and
the stylesheet are both applied during the same style resolution that produces
that paint. A confirmed visitor never sees a frame containing the modal. No
framework is involved in the hiding, which is what makes it fast enough to
happen pre-paint.

`display: none` rather than `opacity` or `visibility` is deliberate: a merely
transparent modal would still be painted, would still be an LCP candidate, and
would still trap focus.

## Failing closed, on purpose

This is a regulated gate on a cannabis storefront, so the failure direction was
chosen rather than inherited. The markup ships **visible** and is hidden only by
a positive signal. If the inline script is blocked, throws, or `localStorage` is
unavailable — Safari private browsing throws on property *access*, it does not
return `null` — then the attribute is never set, the selector never matches, and
the gate shows. An extra prompt for a returning adult is a nuisance; an
unverified visitor reaching the menu is a compliance failure.

Worth stating plainly: this is **stricter** than the behaviour it replaces. The
old server snapshot claimed "confirmed", so the gate was absent for everyone
until JavaScript ran at all. If a visitor's JavaScript never executed, they were
never gated.

The exempt-path check was also tightened while it was being extracted. The
component previously used `pathname.startsWith("/pos")`, which exempts
`/posters` — a customer page — from age verification. The shared helper now
requires an exact match or a `/`-delimited descendant.

## Verification

- 43 pure self-test assertions in `age-gate-core.ts`, registered in
  `scripts/compliance/run-pure-selftests.ts` so CI enforces them on every push.
- 27 compliance assertions in `tests/compliance/slice-i-age-gate-lcp.test.ts`
  covering the wiring a pure core cannot see: the server snapshot, the script's
  placement in `<head>`, that it carries neither `defer` nor `async`, and the
  CSS rule's existence and strength.
- **17 deliberate mutations, 17 caught.** Each mutation reintroduces a specific
  real failure — snapshot back to `true`, bootstrap made `async`, hide rule
  downgraded to `visibility`, bootstrap made fail-open, storage key drifted, and
  so on.
- One assertion was found to be a rubber stamp by that process: checking
  `code.toContain("AGE_GATE_ELEMENT_ATTRIBUTE")` still passed when the attribute
  was deleted from the JSX, because the import line remained. It now asserts the
  attribute is spread onto the fixed full-screen overlay element specifically.
- The mutation harness itself had a bug worth recording: piping `vitest` into
  `sed` to strip colour codes makes the pipeline's exit status `sed`'s, which is
  always 0. That silently masked 12 real detections and made the suite look far
  weaker than it was.
- Behavioural proof in a real browser against the real app: gate ships in the
  server HTML; a new visitor is gated; a returning visitor's gate is not visible
  in **any** sampled animation frame (~200 frames per run); denied storage fails
  closed and never stamps the attribute; confirming hides the gate with no
  reload.
- Served HTML inspected directly: the script is at byte 6,565 with `</head>` at
  6,812 — genuinely inside `<head>` — with no `defer` or `async`, and the gate
  markup follows it.
- 590 test files, 14,991 tests passing. `tsc --noEmit` clean, `eslint` clean.

On the dev server the final LCP candidate for a returning visitor is now an
`IMG`, no longer the age-gate paragraph. Field numbers on the production deploy
are to be measured after this ships, not predicted here.

## Still outstanding

`/specials` is still `force-dynamic` and measured 2,694 ms on a cache MISS; that
needs its own slice. `matchesSearch` in `InteractiveMenuBrowser.tsx` is not
memoised, `src/lib/ai/compliance.ts:149` constructs a `RegExp` inside a loop,
`getVersionItems` still does `.select("*")`, and product detail pages are
`force-dynamic`. Render-blocking CSS is 40.8 KiB and legacy JS polyfills are
13.7 KiB.

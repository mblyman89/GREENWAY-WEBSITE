# Slice F1 + F2 — shipped, and the professional answer on F3

Merged to `main` as `9efa19f1` (F1) and `66c0ca9e` (F2) via PR #1121,
rebase-merged, linear history, both commits verified authored by `mblyman89`.

---

## What was actually wrong

### F1 — the shop page was rendering the home page's skeleton

`src/app/loading.tsx` was the ONLY loading file in the entire application.
Next.js resolves `loading.js` by walking UP the segment tree from the requested
route, so a shopper opening `/menu` was served the ROOT skeleton — which is
shaped like the HOME page: a `film-strip` hero and a `md:grid-cols-3` row of
three promo cards.

This was not inferred. The raw first chunk was dumped off the wire and matched
byte-for-byte against `src/app/loading.tsx`.

The framework's own documentation names this exact failure:

> "A `loading.js` high in the tree … the entire page falls back to a full-page
> skeleton instead of streaming granularly."
> — nextjs.org, Linking and Navigating (Streaming)

### F2 — the `<Suspense>` boundary streamed nothing

A `<Suspense>` boundary already wrapped the product browser. It was decorative.
Every `await` in `MenuPage` — the catalog read, image resolution, terpene
profile, display knowledge, DOH compliance, category override, and the
four-way `Promise.all` — completed BEFORE the `return` statement was reached.

React can only stream work that suspends INSIDE a boundary. By the time the JSX
existed there was nothing left to wait for.

### The measurement

Taken with a Node script reading the response body chunk-by-chunk with
`Accept-Encoding: identity`. `curl` was deliberately not used for timing: it
buffers, and it misreports chunk arrival.

```
   0 ms  request sent
 476 ms  first byte, <head> complete; HOME PAGE skeleton painted  <- FCP
1678 ms  shop banner + filter skeleton arrive
2808 ms  real site <header> arrives
2849 ms  first product card arrives                               <- LCP
3027 ms  footer, stream ends
```

Byte arrival:

```
 750 ms      83,860 bytes
1000 ms          +377 bytes
1250 ms          +879 bytes    <- ~700 ms of near-silence
2000 ms  +2,915,923 bytes      <- the entire page in one burst
2250 ms    +436,788 bytes
```

A healthy page produces a steady climb. This is a flat line, a dead pause, and
a wall. The server was doing all the work with its mouth shut, then shouting
the finished page in one breath.

---

## What shipped

**`src/app/menu/loading.tsx`** — a shop-shaped skeleton: breadcrumb bar, banner
box, 280px filter rail, product card grid. Its presence stops the framework's
upward walk at `/menu`. Every other route keeps the root skeleton, and that is
asserted by test.

**`src/components/menu/MenuSkeleton.tsx`** — one shared skeleton serving BOTH
the navigation placeholder (`loading.tsx`) and the streaming fallback (the
`<Suspense>` boundary in `page.tsx`). Two copies of this markup is exactly how
the two placeholders would drift apart, so there is only one.

**`src/lib/menu/menu-skeleton-core.ts`** — the geometry, as pure constants with
a `__runMenuSkeletonTests()` self-test.

This module is the part worth explaining. A skeleton is only useful if its
geometry MATCHES the component that replaces it. If the placeholder is a
different size, the page visibly jumps when real content arrives — that is
Cumulative Layout Shift, and it would trade one bad score for another. So every
measurement is copied from the real component and pinned:

| Constant | Source of truth |
|---|---|
| `SHOP_GRID_SHELL` | `InteractiveMenuBrowser.tsx:1365` |
| `SHOP_CARD_GRID` | the product `<div className="grid gap-5 …">` |
| `CARD_MIN_HEIGHT` | `ProductCardVisual.tsx:314` — `min-h-[29.25rem]` |
| `CARD_IMAGE_HEIGHT_BASE/_MD` | `ProductCardVisual.tsx:337` |

The tests read the REAL component files and require these constants to appear
in them literally. Restyle the grid without updating the skeleton and CI fails.

One honest note on that: the card image well's two breakpoint classes
(`h-[14.15rem]` and `md:h-[14.65rem]`) are NOT adjacent in the source — other
utilities sit between them. The first attempt used a single combined constant,
and the test correctly failed. Rather than weaken the assertion into something
that proves nothing, the constant was split in two so each can be matched
exactly. The guard stayed honest.

**`src/app/menu/page.tsx`** — all catalog I/O moved BELOW the `return`, into a
new `<MenuBrowserSection>` child. The page component now returns its shell
immediately: background, header, breadcrumbs flush in the first chunk while the
catalog is still being read, and products stream in behind them. This is what
the Next.js documentation means by "push dynamic access down."

`searchParams` is still read in the parent. That is deliberate — it is cheap,
does no I/O, and every deep-link facet test passes unchanged. Making `/menu`
CDN-cacheable is F3 and was NOT bundled into this slice.

---

## Verification

- `tsc --noEmit` → 0 errors
- `eslint` → 0 problems
- **588 test files / 14,935 tests** pass
- **7 of 7 mutations caught**, each restored to green afterward:
  1. drift the card grid to 3-up → caught
  2. drift the card min-height → caught
  3. leak the home-page shape into the skeleton markup → caught
  4. make the skeleton `async` → caught
  5. hoist the catalog read back above the `return` (the original defect) → caught
  6. revert the fallback to the old text placeholder → caught
  7. move `<Header>` inside the Suspense boundary → caught
- CI `compliance-tests` → success
- Post-merge authorship on both commits → `mblyman89`

### One test was changed, and why

`tests/compliance/shop-layout.test.ts` asserted that `page.tsx` contained the
`--shop-max` token at least 3 times. After F2 it contains it twice, because the
Suspense fallback's wrappers MOVED into the shared skeleton.

The token was not dropped — it moved. Verified: 2 uses in `MenuSkeleton.tsx`
plus the `SHOP_GRID_SHELL` constant, and the forbidden fixed `88rem` cage is
still absent from both files. The assertion now counts across the files that
actually render those wrappers, and additionally requires `page.tsx` to keep
caging its own banner block and breadcrumb.

A test that fails on a refactor which improved the code is an obstacle, not a
guard. It was updated to follow the code honestly, not deleted or loosened.

---

## Post-deploy measurement — NOT YET TAKEN

The after-numbers could not be measured from this sandbox. Repeated automated
requests tripped a **SiteGround CAPTCHA challenge** on the sandbox IP:

```
HTTP/2 202
sg-captcha: challenge
x-robots-tag: noindex
```

The home page returns the same 202, which confirms this is IP-level bot
mitigation rather than a deployment problem. CI passed on the merged commit.

**No before/after claim is made here.** The correct next step is a PageSpeed
Insights run from Michael's side, which requests from Google's infrastructure
rather than this blocked IP.

What SHOULD move, given the defects that were fixed:

* **First Contentful Paint** — the first paint is now a shop instead of the
  home page, and the shell no longer waits on the catalog.
* **Speed Index** — the page fills progressively instead of one late repaint.

What will NOT move yet:

* **Total Blocking Time** stays high. The browser is still handed 2,562
  products to parse and hydrate. Nothing in F1 or F2 changes that. Only real
  pagination (F4b) will, and no amount of streaming substitutes for it.

---

## F3 — the professional answer

Michael asked, correctly, not to be handed a choice but to be told what a real
engineering team would ship. Here it is.

### Recommendation: **Option B, done properly.**

Option A (drop server-side `searchParams`, filter on the client) is faster to
build and would score well. It is the wrong answer for this business for one
concrete reason: **the filtered views stop existing as far as Google is
concerned.** If `/menu?category=flower` is rendered only after JavaScript runs
on the client, then the server's response for that URL is the unfiltered menu.
That is what a crawler indexes, that is what a shared link previews, and that
is what a shopper sees flash before it snaps.

For a retail catalog, category and brand pages are the pages that earn search
traffic. Trading them for a score is not a trade a professional makes.

### What "done properly" means

The reason Option B looked like "more moving parts" in the earlier report is
that it was framed as a split route. That framing was too narrow. The
industry-standard shape for this exact problem is:

1. **A cacheable, statically-rendered `/menu`** — the default view, no
   `searchParams`, fully CDN-cached, served instantly from the edge.

2. **Real, indexable filtered routes** — `/menu/[category]` and similar, each
   statically generated via `generateStaticParams` for the known facets. These
   are genuinely pre-rendered, genuinely cacheable, and genuinely indexable.

3. **Client-side filtering for the interactive long tail** — the combinatorial
   filters (price sliders, multi-select terpenes, THC ranges) stay on the
   client where they belong. Nobody pre-renders a route for every combination
   of six filters, and nobody needs to.

That split — cacheable static routes for the facets that matter to search,
client interactivity for everything else — is what a production e-commerce
build looks like. It is the same structure the competitor's 10 ms TBT implies
they are using.

### A note on `cacheComponents`

Next.js 16.2.9 does ship `cacheComponents` (the stable successor to Partial
Prerendering — `experimental.ppr` now throws a `HardDeprecatedConfigError`
directing you to it). Verified present in `server/config-schema.js:233`.

It is genuinely the framework's answer to "cached shell, dynamic holes." It is
also **application-wide, not per-route**, and under it any uncached IO throws
`"couldn't be rendered statically because it used IO that was not cached."`

That means enabling it is a repo-wide migration touching every server component
and data loader in the application, not a slice. It is the right long-term
destination and it should be a planned project with its own budget — not
something bolted onto a performance fix. Recorded here so the option is not
lost.

### Sequence from here

1. **F4a** — omit null/empty/false fields from the payload (~400 KB less to
   parse; honest caveat: ~6 KB compressed, so this helps TBT, not bandwidth).
2. **F5** — trim the head: 42.8 KB render-blocking CSS, 13 `<script>` tags,
   plus the carry-overs (memoise `matchesSearch`; hoist the `new RegExp` out of
   the loop in `ai/compliance.ts:149`, measured 25.2 ms → 3.2 ms).
3. **F4b** — real pagination. The one that reaches the competitor's TBT.
4. **F3** — the static-routes restructure above, as its own carefully planned
   slice.

F3 is sequenced last deliberately. It is the largest change, it touches
routing and SEO, and it should be done when the cheap wins are already banked
and measurable — not tangled up with them.

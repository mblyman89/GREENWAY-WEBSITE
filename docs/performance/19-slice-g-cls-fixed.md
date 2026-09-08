# Slice G — the CLS regression, found and fixed

## The situation

PageSpeed on `https://greenwaywebsite1.vercel.app/menu` (mobile) dropped from
**61 to 23** after Slices F1 and F2 shipped.

| Metric | Before F1/F2 | After F1/F2 | Change |
| --- | --- | --- | --- |
| First Contentful Paint | 2.3 s | 2.3 s | unchanged |
| Largest Contentful Paint | 6.2 s | 6.2 s | unchanged |
| Total Blocking Time | ~400 ms | 1,970 ms | 5x worse |
| **Cumulative Layout Shift** | ~0 | **0.405** | **new** |
| Speed Index | 5.6 s | 6.3 s | slightly worse |

The report named the culprit element directly:

```
<article class="group relative flex min-h-[29.25rem] min-w-0 flex-col justify-between over…">
0.405 Layout shift score
```

That is the real ProductCard replacing the Slice F1 skeleton. The regression was
mine.

## Why the F1 tests did not catch it

Slice F1 pinned the skeleton's geometry to the real card with assertions like:

```ts
check("card min height matches the real card", CARD_MIN_HEIGHT === "min-h-[29.25rem]");
```

That assertion passed. The strings genuinely were equal. It was still worthless,
because `min-h` is a **floor**, not a height — the card is free to render taller,
and it did. The test proved two Tailwind class strings matched. CLS measures
**rendered height**, which the test never looked at.

This is the lesson from the slice: a test that compares source strings is not a
test of layout.

## Measuring instead of inferring

Rather than reason about Tailwind, the live deployment was measured in a real
throttled Chromium (Moto G Power profile, Slow 4G, 4x CPU).

**Defect 1 — the card reserve was up to 128px short.**

| viewport | skeleton reserved | real card | shortfall |
| --- | --- | --- | --- |
| 390px | 468px | 586px | −118px |
| 412px | 468px | 542px | −74px |
| 768px | 468px | 596px | −128px |
| 1599px | 468px | 596px | −128px |

**Defect 2 — the header was never reserved.**

`src/app/menu/loading.tsx` rendered no header. `src/app/menu/page.tsx` renders
`<Header />`. A position timeline captured across the handoff:

```
t=4558ms  banner top =  37px   <- loading.tsx, no header
t=4918ms  banner top = 136px   <- page.tsx, header present   (+99px)
t=7634ms  skeleton card 468px -> real card 542px
```

Two separate downward shoves, both from the placeholder under-reserving space.

## The fix

1. **One number instead of two copies.** `CARD_MIN_HEIGHT` was raised to the
   measured ceiling (`min-h-[37.25rem]` = 596px), and `ProductCardVisual` now
   **imports** it rather than declaring its own literal. Two constants that
   agree today can drift tomorrow; one constant cannot drift at all.

2. **A zero-IO header spacer.** New `<ShopHeaderSkeleton />` reserves the real
   header's height at every breakpoint, pinned to live measurements:

   ```
   360→93.2  390→93.6  412→95.4  640→105.2
   768→115   1024→121.3  1280→127.8  1536→137.4
   ```

   The real `<Header />` cannot be reused here: it is an async server component
   that awaits `getContentForRender(MEDICAL_HIDE_BLOCK)`, and a skeleton that
   awaits I/O is not a skeleton.

3. **`min-h` kept deliberately.** A fixed `h` would clip a card whose content
   genuinely exceeds 596px (a long name wrapping to a third line). The same
   component also renders on the home rail, specials grid and PDP rail —
   surfaces this slice did not measure. A raised floor fixes the measured shift
   and cannot clip.

## The tests now assert geometry, not strings

The self-tests were rewritten to encode the measured evidence:

- card reserve ≥ tallest measured card (596px), and not wastefully taller
- card reserve is a floor (`min-h-`), not a fixed height
- header reserve ≥ tallest real header **in every breakpoint band**
- header reserve steps increase monotonically
- the card root **imports** the shared constant and declares no literal of its own

## Verified after deploy

Same harness, same throttling, against the deployed fix:

```
t=4125  skel=Y  banner=[0,0]      skelCard=[0,0]
t=4428  skel=Y  banner=[136,596]  skelCard=[500,596]
t=7432  skel=n  banner=[136,160]  firstCard=[519,596]
```

| | before | after |
| --- | --- | --- |
| banner top across handoff | 37px → 136px | 136px → 136px |
| card height across swap | 468px → 542px | 596px → 596px |
| **measured CLS** | 0.405 | **0.0000** (two runs) |

Skeleton confirmed rendering in both runs, 69 articles present — so this is a
real zero, not a case of the harness missing the swap.

## Mutation testing

Six mutations, all caught:

| # | mutation | caught |
| --- | --- | --- |
| M1 | revert card reserve to the original 29.25rem defect | yes |
| M2 | under-reserve the header base step | yes |
| M3 | card re-declares its own literal instead of importing | yes |
| M4 | delete the header JSX, leave the import | yes* |
| M5 | header reserve steps go non-monotonic | yes |
| M6 | render the header reserve after the breadcrumb | yes* |

\* M4 and M6 **defeated the first version of these tests** — the assertion
searched the whole file for the name `ShopHeaderSkeleton`, which the import
statement alone satisfies. Deleting the JSX while leaving the import (exactly
the 99px regression) slipped straight through. The assertions were tightened to
match the rendered JSX tag. Worth recording, because it is the same class of
mistake that let Slice F1's CLS through: asserting that a name appears
somewhere, rather than asserting the thing that actually matters.

## Verification

- `tsc --noEmit` — 0 errors
- `eslint` — 0 errors, 0 warnings
- 588 test files / 14,937 tests — all passing
- CI `compliance-tests` green; merged as `f8909501`, authorship `mblyman89`

---

## What is still wrong (measured, not yet fixed)

Slice G fixes CLS only. The probe turned up three larger problems that the
PageSpeed PDF could only see indirectly.

### 1. `/menu` is never CDN-cached — worth ~1,220 ms

PageSpeed reported "server responded slowly (observed 1,324 ms)". The cause is
now isolated. Cache headers across routes:

| route | `draftMode()` | `searchParams` | `revalidate` | `x-vercel-cache` |
| --- | --- | --- | --- | --- |
| `/` | yes | **no** | 60 | `STALE` (cached, age 753) |
| `/about` | — | no | — | `PRERENDER` |
| `/vendors` | — | no | — | `HIT` (age 3494) |
| `/menu` | yes | **yes** | 60 | **`MISS`, every time** |

`/menu` is the only route returning `private, no-cache, no-store`. Three
requests in a row: `MISS`, `MISS`, `MISS`.

This **exonerates `draftMode()`**, which had been suspected three times. The home
page calls `draftMode()` through `getSectionsForRender` and caches perfectly.
The one structural difference is that `/menu` reads `searchParams`, which Next.js
documents as opting a page into dynamic rendering at request time.

The `searchParams` are used for exactly one thing: building a plain object of
strings passed to `InteractiveMenuBrowser` for first-paint hydration. The client
already re-reads them from the live URL in `resolveInitialParams`
(`InteractiveMenuBrowser.tsx:630`), and the live URL takes precedence. Only
2 static `/menu?...` links exist in the codebase.

### 2. The page ships a 3.4 MB HTML document

Measured with `Accept-Encoding: identity`:

```
total bytes        3,462,852  (3,381.7 KiB uncompressed)
RSC flight bytes   3,035,178  (2,964.0 KiB — 88% of the document)
gzipped transfer     269,791  (263.5 KiB)
```

The flight payload contains the **entire catalog**: 2,563 brands, 2,564
categories, 2,562 vendors, 2,570 descriptions, 2,581 names, 7,466 THC values.

Only **48 cards** are rendered on first paint (`FIRST_PAGE_SIZE`), and only 69
`<article>` elements exist in the DOM. So roughly 2,500 products are serialized,
transferred, parsed and retained to render 48 of them.

This is the direct cause of the remaining metrics:

- **TBT 1,970 ms** — script evaluation alone is 1,900 ms
- **LCP 6.2 s** — 100% of bytes have not arrived until 5,434 ms
- unused JavaScript, est. 87 KiB
- 11 long main-thread tasks

Streaming (F2) moved *when* this work happens; it did not reduce it. That is why
FCP and LCP did not move at all.

### 3. Smaller confirmed items

- render-blocking CSS 40.8 KiB / 750 ms (est. 560 ms)
- legacy JS polyfills 13.7 KiB — `Array.prototype.at`, `flat`, `Map`,
  `Object.fromEntries`, `Object.hasOwn`, `String.prototype.trimStart/End`
- forced reflow 162 ms
- image delivery est. 19 KiB

Items 1 and 2 are the whole game. Together they account for the server latency,
the blocking time and the late LCP.

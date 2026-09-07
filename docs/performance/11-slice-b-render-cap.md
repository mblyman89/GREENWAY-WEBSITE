# Slice B — The Menu Render Cap

**Status:** shipped
**Branch:** `slice-b-menu-payload-render-cap`
**Follows:** Slice A (`docs/performance/10-slice-a-menu-cache.md`)

---

## What you told me

> "when I load the website, the home page takes a few seconds to load. Then if I
> click the shop button to go to the menu, it takes what feels like over a minute
> to load. Then once loaded things speed up a bit, but not a lot. Open a product
> to the detail page doesn't take too long, but still longer than it should.
> Going back to the menu again, again what feels like over a minute of loading.
> That was before slice a. After slice a, no change."

And then:

> "Everything I described above is still a symptom even after waiting several
> minutes after it successfully built."

That second message is the important one, and I want to be straight with you
about why.

## Why Slice A didn't change what you feel

Slice A made the **server** stop re-reading 4,500 products from the database on
every request. That was a real improvement and it is still working. But it was
not your problem.

Here is the tell, and it was sitting in your own description the whole time:
**going back to the menu was still slow.** By that point Slice A's cache was
warm — the server was handing the page over almost instantly. If the database
were the bottleneck, the second visit would have been fast. It wasn't.

So the minute you are waiting is not the server fetching data. It is your
**browser** building the page after the data arrives. Slice A never touched the
browser. I led with the safest fix rather than the one that matched your
symptom, and that cost you a round trip.

## The actual cause

`src/components/menu/InteractiveMenuBrowser.tsx`, at the line that draws the
grid:

```
{group.items.map((item) => <ProductCard key={item.id} item={item} />)}
```

There was no cap, no pagination and no virtualization anywhere in that file. So
with no filter applied, the browser was told to build a live `ProductCard`
component for **every single matching product**.

Each of those cards is not a static tile. Every one of them:

- runs a discount calculation (`menuCardDiscountForItem`),
- runs a badge calculation (`menuCardBadgeForItem`),
- and subscribes to two React contexts.

Multiply that by a few thousand and the browser has thousands of components to
construct, lay out and paint before it can show you anything. That is your
minute. And it explains the second half of your sentence too — "once loaded
things speed up a bit, but not a lot" — because after the first paint, every
interaction still has to run work across all of those live components.

## What changed

The menu now builds **48 cards** on first paint and adds another 48 as you
scroll, up to a ceiling of 480.

The subtle part, and the reason this needed a dedicated module rather than a
one-line change: the menu is not a flat list. It is a set of category sections
("Flower", "Vapes", "Edibles", …), each with its own heading. The obvious fix —
"show 48 per section" — would still have built 48 × 12 = 576 cards, and it would
get *worse* every time you add a category in Admin → Settings → Types. So the
budget is spent **across** the sections in order instead: fill the first, then
the next, until it runs out. The total is bounded by one number no matter how
many categories exist. There is a test that specifically fails if anyone ever
changes it back to per-section.

**Nothing is hidden from your customers.** This is a render cap, not a filter.
Every product still matches, is still counted in the total, and is still
reachable by scrolling. Under the grid it now says, honestly, "Showing 48 of
4,500 products." Once you scroll past 480 it says to use search or a filter,
because at that depth scrolling is not how anyone finds a product anyway.

Scrolling loads the next page automatically, starting 600px before you reach the
bottom so the grid feels continuous. There is also a "Show more products" button
— partly for people who prefer clicking, and partly because if a browser doesn't
support the scroll detection, the menu becomes a manual pager instead of
trapping the shopper at 48 items.

## Measured, from your real data

I did not estimate this. I parsed all **2,615 real `product.json` files** in the
repo and measured the actual bytes.

| | |
|---|---|
| Real product files parsed | 2,615 |
| `description` field, average | **223 bytes per product** |
| Share of each product file that the grid never displays | **46.1%** |
| Cards built on first paint, before | every match (thousands) |
| Cards built on first paint, after | **48** |

One correction to my own earlier recon, because it matters: my first estimate
used a made-up product record and put the payload at 5.89 MB. Measured against
your real files it is **6.28 MB**, and the trimmed version is **2.86 MB** — a
54.4% reduction. That trim is *not* in this PR (see below); the render cap is.

## What is deliberately NOT in this PR

I built the payload trim as well — a `MenuCardItem` shape that strips the ~223
bytes of description prose and other detail-page-only fields from every product
before they cross the wire. It passes 89 self-assertions and cuts 6.28 MB to
2.86 MB.

I am not shipping it here. Wiring it in requires retyping 28 separate references
inside `InteractiveMenuBrowser.tsx`, and you said "extreme discipline so nothing
breaks." Bundling a large type migration with the fix for your actual symptom
would mean that if anything went wrong, we couldn't tell which half did it. It
is parked and ready to go as **Slice B2**, on its own, where it can be verified
on its own.

I also want to set your expectations honestly: 2.86 MB is still a large payload.
The trim is worth doing, but **the render cap in this PR is the change that
should fix the minute-long wait.** I'd rather tell you that now than have you
expect the trim to be the fix.

## Three things I nearly got wrong

I'm recording these because they are the reason this took as long as it did, and
because two of them would have broken compliance features silently — no error
message, no crash, just filters that quietly match nothing.

1. **`totalThc` / `totalCbd`.** My recon said the card visual never displays
   these, so I dropped them. Wrong. The browser reads them in five places: both
   THC/CBD slider bounds, the slider matching, the potency sort, and the
   high-CBD ("CBD") strain option. Dropping them would have pinned both sliders'
   maximums to 1% and made the CBD option vanish. Caught by re-grepping the
   component instead of trusting my own earlier note.

2. **`dohCompliant`.** I had this on the omit list too. But
   `isItemDohCompliant()` checks `dohCompliant === true` **first**, before it
   looks at the category — so an item flagged compliant with no category is
   real. Dropping the boolean would have removed those items from the DOH filter
   and stripped their blue DOH pill.

3. **`dohCategory` typed as `string`.** I had widened a compliance enum to a
   plain string. That compiles fine and then silently fails every comparison
   against the three legal values. I caught this with a throwaway compile-only
   probe that type-checked the card shape against the real filter signatures —
   the compiler found it; reading the code had not.

The pattern in all three: a field looks unused if you only grep the component,
because it's read *indirectly* inside a pure filter core that the component
imports. The card shape is now built from the transitive closure of everything
reachable from the client tree, not from a single-file grep.

## How this was verified

- **`tsc --noEmit`** — 0 errors.
- **`eslint`** — 0 errors, 0 warnings. One of those errors was real and worth
  noting: my first version reset the card budget inside a `useEffect`, and the
  linter correctly flagged it as a cascading render. That would have meant
  painting the stale budget and then immediately re-rendering — the exact kind of
  wasted work this slice exists to remove. Rewritten to React's documented
  adjust-state-during-render pattern.
- **33 new pins** in `tests/compliance/menu-render-cap.test.ts`. These read the
  **real source file**, so reverting the render site fails the build.
- **The pagination core's own harness caught two bugs in my code before it ever
  ran in the app** — a clamp that failed open on `Infinity` instead of closed,
  and a test of mine whose premise was broken (it passed a budget of 15, which
  gets raised to 48, so it never actually exercised the split it claimed to
  test).
- **Mutation testing — 6 sabotages, 6 caught, 0 escaped:**

  | # | Sabotage | Caught by |
  |---|---|---|
  | 1 | Revert the render site to the unbounded map | 1 test |
  | 2 | Stop resetting the budget when filters change | 1 test |
  | 3 | Raise the ceiling to 100,000 | 3 tests |
  | 4 | Make the clamp fail open on nonsense input | 2 tests |
  | 5 | Apply the budget per group (the category trap) | 8 tests |
  | 6 | Remove the no-observer fallback button | 1 test |

  Both source files were then restored and confirmed **byte-identical** with
  `cmp`.
- **Full suite: 584 files, 14,812 tests, all passing.** That is exactly +1 file
  and +33 tests against the Slice A baseline of 583 / 14,779 — nothing else
  moved.

## What I need you to check

**1. The thing this fixes.** Load the site, click Shop. The menu should paint in
a couple of seconds instead of a minute. Scroll down — more products should
appear on their own. Open a product, then press Back — that was the worst case
before, and it should now be fast too.

**2. The Slice A acceptance test you haven't run yet.** You said "I haven't tried
testing changing the menu in any way yet." Please do this one, because it is the
only check that proves Slice A's cache invalidation works: **change something on
the menu (a price, or hide a product) and confirm the public site shows it
immediately.** If there is ever a delay there, tell me right away — that is the
one risk Slice A carries, and there is a 60-second safety net behind it.

**3. Still waiting on, when you get a chance:** your Vercel **Function Region**
and Supabase **Region** strings. If those are in different regions, every single
database call is paying a cross-country round trip, and that would be a
completely separate cause worth fixing on its own.

## Known limitation

The ceiling is 480 rendered cards. Past that, a shopper must search or filter
rather than keep scrolling. I chose a ceiling on purpose: infinite scroll with no
limit just recreates the original bug slowly, and a shopper who has scrolled past
480 products is not going to find what they want by scrolling to 4,500. If you'd
rather that number were higher or lower, it is one constant
(`MAX_RENDERED_CARDS`) and I can change it.

## Files

| File | Change |
|---|---|
| `src/lib/menu/menu-pagination-core.ts` | **new** — pure cross-group budget module, 57 self-assertions |
| `src/components/menu/InteractiveMenuBrowser.tsx` | render cap wired in at the grid |
| `tests/compliance/menu-render-cap.test.ts` | **new** — 33 pins, reads the real source |
| `docs/performance/11-slice-b-render-cap.md` | this report |

## Next

- **Slice B2** — the payload trim (built, 89 assertions green, parked).
- **Slice C** — parallelise the six sequential enrichment passes on `/menu`.
- **Slice D** — product detail pages fetch a single row instead of the full menu.
- **Slice E** — `next/image` for product photos (currently raw `<img>`).
- **Slice F** — performance-budget tests so a regression fails CI.

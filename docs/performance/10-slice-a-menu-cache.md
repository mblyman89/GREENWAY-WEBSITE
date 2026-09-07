# Slice A — The menu is now cached (and how to prove it)

**What changed in one sentence:** the customer website now remembers the menu
instead of rebuilding all 4,500 products from the database on every single page
view, and the moment you publish or receive product, that memory is thrown away
so the site updates instantly.

---

## The rule this slice is built on

> **Cache the display. Never cache the money.**

That sentence is the whole design. It is worth explaining why it had to be the
design, because the obvious version of this change would have been dangerous.

`loadLiveMenuAll()` — the function that loads the published menu — is not used
only by the website. It is also used by:

- **`src/lib/orders/order-pricing.ts:133`** — the code that decides what a
  customer is actually **charged**, and
- **`src/app/api/pos/menu/route.ts:87`** — the **register's** copy of prices and
  stock.

If this slice had simply cached that shared function, then a price change could
have taken up to a minute to reach the register, and an order could have been
priced from a stale copy. That is how a shop accidentally sells at yesterday's
price.

So the cache is a **separate, opt-in function**. The original loaders are
untouched and still read straight through to the database on every call. A
money path cannot inherit the cache by accident — it would have to be edited by
name to do so, and a test now fails the build if anyone ever does.

| Surface | Cached? | Why |
|---|---|---|
| `/menu` shop page | **Yes** | Browsing. Shows cards; charges nobody. |
| `/` home page | **Yes** | Browsing. |
| `/specials` | **Yes** | Browsing. |
| `/menu/products/[id]` | **Yes** | Browsing. Price is re-verified at checkout. |
| `/vendor-delivery` | **Yes** | Directory derived from menu. Display only. |
| `sitemap.xml` | **Yes** | A list of URLs for Google. No prices. |
| **Order repricing** | **NO** | Decides what the customer pays. |
| **Order completion / limits** | **NO** | Enforces legal purchase limits. |
| **Register menu sync** | **NO** | The sales floor must see present stock. |
| **Admin DOH registry** | **NO** | Staff must see their edit immediately. |

---

## How fresh is the website now?

| When this happens | The website updates |
|---|---|
| You **publish** a menu | **Immediately.** Next visitor sees it. |
| A **delivery is received and approved** (intake auto-publish) | **Immediately.** |
| You **reset operational data** | **Immediately.** |
| A **sale** decrements stock | Within **60 seconds** on the website. The register is correct **instantly**. |
| A **price is corrected** in the back office | Within **60 seconds** on the website. Register instant. |

### Why publish is instant

Every path that publishes a menu — the one-time Cultivera import **and** the
permanent intake/receiving flow — funnels through the same atomic
`publish_menu_version` RPC and then calls **one** helper,
`revalidatePublicMenuSurfaces()` (`src/lib/site/public-surfaces.ts:46`).

That helper now clears the menu **data** cache *before* it refreshes the pages.
The order matters and is enforced by a test: clearing the pages first would
simply rebuild the old catalog into fresh-looking pages — stale data wearing a
new hat, which is worse than obviously stale data because it looks correct.

This is what protects the original **SLICE 48** guarantee: *an empty back office
means an empty website.* That guarantee is why `force-dynamic` was there in the
first place. It has not been weakened — it is now enforced by a tag instead of
by paying full price on every request.

### Why there is also a 60-second safety net

This is the part I want to be straight with you about, because it is a real
limitation and not a detail I want buried.

Some things change the live menu **without** going through publish at all. A
sale writes stock levels directly onto the published rows
(`src/lib/inventory/sale-decrement.ts:132-167`). Staff flagging an item out of
stock does the same (`src/app/api/pos/stock-flag/route.ts:78`). So does a price
correction (`src/lib/inventory/price-write-store.ts:239`).

**None of those call any refresh today** — they didn't need to, because nothing
was cached. So a cache with no expiry would let a sold-out product sit on the
website looking available indefinitely.

The 60-second expiry means any write path we have not explicitly wired up
**self-heals within a minute**, automatically. A cache that never expires is a
promise that every future developer will remember to clear it. This one does not
rely on anyone's memory.

Worst case: a shopper briefly sees a product that just sold out. They add it to
the cart, and the order is rejected at pricing time with the message that
already exists — *"The menu is being updated. Please refresh and try again."*
We can show a stale card. We can never take stale money.

Wiring those three write paths to invalidate instantly is a small, obvious
follow-up. It is not in this slice because this slice changes caching only.

---

## What I did NOT change

Being explicit, because you asked me not to break anything:

- **No visual change.** Not one component, style, or piece of copy was touched.
- **No query change.** The same rows are fetched in the same way.
- **No change to what a customer is charged.** Every pricing path is
  byte-for-byte identical.
- **No change to the register.**
- **`force-dynamic` was left alone.** I checked, and removing it would have
  changed nothing: `/menu` reads `searchParams` and the home/specials pages read
  draft-mode cookies, which makes them dynamic regardless. Deleting the line
  would have looked like progress while doing nothing. The **data** cache is
  where the entire win is.
- **The double catalog load on the product page is still there** — it is now
  served from a warm cache instead of the database. Removing it properly is
  Slice D.

---

## How this was tested

- **35 new tests**, all passing. Suite went from 582 files / 14,744 tests to
  **583 files / 14,779 tests**. Nothing else changed.
- **The tests were themselves tested.** I deliberately broke the code six ways
  and confirmed the suite caught every one:

| # | Sabotage | Caught? |
|---|---|---|
| 1 | Publish stops clearing the data tag (the frozen-menu bug returns) | ✅ |
| 2 | Order pricing switched to the cached loader (stale price charged) | ✅ |
| 3 | Cache expiry set to infinity (stock never self-heals) | ✅ |
| 4 | Pages cleared before data (stale data, fresh-looking pages) | ✅ |
| 5 | `/menu` quietly reverted to the uncached loader | ✅ |
| 6 | Hidden-product filter dropped (hidden items go public) | ✅ |

  **6 of 6 caught, 0 escaped.** Every file was then restored byte-identical and
  re-verified.
- The pure policy module also carries **40 self-assertions** and was proven to
  fail loudly when a money surface is marked cacheable.
- `tsc --noEmit`: 0 errors. `eslint`: 0 errors.

---

## The acceptance test — please do this yourself

This is the one that matters, and it takes about a minute:

1. Open the customer website `/menu` in a normal browser tab. Note a product.
2. In the back office, change something obvious about that product — hide it, or
   rename it — and **publish**.
3. Refresh the website tab.

**The change must appear immediately.** If it does, tag invalidation is working
and the SLICE 48 guarantee is intact.

Then do the same for the path that matters long-term: **receive and approve a
product through intake**, and confirm it appears on the website right away.

---

# Getting the Vercel numbers (step by step)

You said you'd get these but need walking through it. Here is every click. This
is read-only — you cannot break anything by looking.

## What we're after

Three numbers for the `/menu` page:
- **TTFB** (time to first byte) — how long before the browser gets anything.
- **Function duration** — how long our server code takes.
- **Cache hit rate** — proof this slice is working.

## Part 1 — Speed Insights (the customer-experience numbers)

1. Go to **vercel.com** and log in.
2. Click the **Greenway** project.
3. Along the top: `Project` · `Deployments` · `Analytics` · `Speed Insights` ·
   `Logs` · `Observability` · `Settings`. Click **Speed Insights**.
4. If it says *"Enable Speed Insights"*, click it. It's free on Hobby/Pro and
   starts collecting from real visitors immediately. You may need to wait a few
   hours for data.
5. Set the time range (top right) to **Last 7 days**.
6. Screenshot the row of scores: **LCP, INP, CLS, FCP, TTFB**.
7. Below there's a **"Routes"** or **"Pages"** table. Find **`/menu`**.
   Screenshot that row — that's the one I care about most.

> **What good looks like:** LCP under 2.5 s, INP under 200 ms, TTFB under 800 ms.
> I'd expect `/menu` to be failing LCP and INP badly right now, because of the
> 6.5 MB payload — that's Slice B, not this one.

## Part 2 — Observability (the server-side numbers)

1. Same project, click **Observability** in the top nav.
2. Time range: **Last 24 hours**.
3. You'll see cards for **Requests**, **Edge Requests**, **Function
   Invocations**, **Function Duration**, **Errors**.
4. Screenshot the whole overview page.
5. Look for a **Routes** or **Paths** breakdown. Find `/menu`. Screenshot it.
   I want **P75** and **P99** duration if shown — the average hides the pain.
6. If there's an **ISR** or **Cache** section, screenshot it. After this slice
   deploys, that should show cache **HITs** climbing. That's the proof.

## Part 3 — The single most valuable check (2 minutes, do this first)

This is the region question, and it's worth more than everything above.

1. **Vercel** → project → **Settings** → **Functions**.
   Find **Function Region**. Write down exactly what it says
   (e.g. *"Washington, D.C., USA (iad1)"* or *"Portland, USA (pdx1)"*).
2. **supabase.com** → log in → your project → **Settings** → **General**.
   Find **Region**. Write it down (e.g. *"West US (North California)"*).

**Send me both strings.** You said both are "North American," which is a good
sign — but North America is 3,000 miles wide. If Vercel is in Washington DC and
Supabase is in California, every one of those ~49 database round trips crosses
the continent twice. That alone could account for seconds, and it is fixed by
changing a setting, not by writing code.

If they match, we've ruled it out and we know the remaining slowness is the
payload size — Slice B.

## Part 4 — A number you can get right now, no login

Best measured on your phone, on cell data, not shop wifi:

1. Go to **pagespeed.web.dev**
2. Paste `https://greenwaymarijuana.com/menu` (or whatever the live URL is).
3. Click **Analyze**, wait ~30 seconds.
4. Screenshot **both** the Mobile and Desktop tabs.

Do this **now, before the next deploy**, so we have a genuine before-and-after.
If you've already deployed this slice, still take it — it becomes the baseline
for Slice B.

---

## Honest expectations for this slice

I don't want to oversell it.

**What Slice A fixes:** the server rebuilding the entire catalog on every
request. After the first visitor, that work disappears. TTFB and function
duration should drop substantially.

**What Slice A does NOT fix:** the 6.5 MB of product JSON still being sent to
every browser, and the thousands of DOM nodes still being rendered. **The
lag and unresponsiveness you feel while typing in the filters will still be
there.** That is Slice B, and it is the bigger win for perceived speed.

Slice A had to come first because it's low-risk, it's the foundation Slice B
sits on, and it tells us — from real measurements rather than my modelling —
how much of the remaining slowness is server versus browser.

---

## Sources

**Code in this repository** (verified by reading, with line numbers):
`src/lib/pos/live-menu.ts`, `src/lib/menu/menu-cache-policy-core.ts`,
`src/lib/site/public-surfaces.ts`, `src/lib/orders/order-pricing.ts`,
`src/app/api/pos/menu/route.ts`, `src/lib/inventory/sale-decrement.ts`,
`src/app/api/pos/stock-flag/route.ts`, `src/lib/inventory/price-write-store.ts`,
`src/lib/pos/intake-menu-staging.ts`, `src/lib/pos/import-service.ts`.

**Framework behaviour** (verified against the installed Next.js 16.2.9, not from
memory):
- `unstable_cache` exists and is the supported API for caching non-`fetch`
  (database/ORM) reads — `next/dist/server/web/spec-extension/unstable-cache.d.ts`.
- `revalidateTag` requires a second argument in Next 16; omitting it logs a
  deprecation warning — `next/dist/server/web/spec-extension/revalidate.js:42-44`.
- Valid cache profiles are `default | seconds | minutes | hours | days | weeks |
  max` — `next/dist/server/config-shared.js:136-171`.

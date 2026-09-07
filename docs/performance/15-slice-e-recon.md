# Slice E — Recon: why the shop page is still slow

Owner report after Slice D: *"The home page loads instantly now. The shop menu
page is still very slow. I feel like it got a little worse somehow."*

Both halves of that report are consistent with what the measurements show. This
document records the facts before any code changed, per the standing rule:
**build from fact, not memory. Do not guess, do not assume.**

---

## Fact 1 — the menu cache has never worked in production

`src/lib/pos/live-menu.ts:188` wraps the whole published catalog:

```ts
export const loadLiveMenuAllCached = unstable_cache(
  async (): Promise<GreenwayMenuItem[]> => loadLiveMenuAll(),
  [...MENU_CACHE_KEY],
  menuCacheOptions(),
);
```

`unstable_cache` writes to Vercel's Data Cache. Vercel's documentation, verified
in the previous slice, states the Data Cache and Runtime Cache both cap
**item size at 2 MB**, and that *"items larger won't be cached."* The write is
dropped **silently** — no error, no warning, no log.

Measured with `scripts/measure-cache-fit.mjs`, at 4,500 products:

| | |
|---|---|
| Data Cache item limit | 2.00 MB |
| Published menu, serialized | **5.94 MB** |
| Over the limit by | 3.94 MB |

**Consequence: the cache entry is never stored, so it is never read.** Every
single request to `/menu` re-runs `loadLiveMenuAll()` in full — the published
version lookup, `getVersionItems`, and `withCardIdentity`.

This is the honest explanation for Slice A producing "no perceptible change."
The cache was correct in shape and wrong in size, and the failure mode is
silent, so nothing ever surfaced it.

### The fix, measured

Store the cache entry **compressed**:

| | |
|---|---|
| gzipped | 153 KB (40x smaller) |
| stored as base64 | **204 KB** |
| fits under 2 MB with | 1.85 MB to spare |
| decode cost on a cache HIT | ~45 ms |
| encode cost on a cache MISS | ~28 ms, once per 60s window |
| headroom | ~45,000 products before the compressed entry reaches 2 MB |

Trading ~45 ms of decode for the elimination of the entire uncached database
read path is the correct trade, and it keeps working as the catalog grows.

---

## Fact 2 — `/menu` is dynamically rendered on every request

`src/app/menu/page.tsx` has **no route segment config** — no `revalidate`, no
`dynamic`. It reads `searchParams` at the top level.

Next.js documentation (`/docs/app/api-reference/file-conventions/page`), quoted
verbatim:

> `searchParams` is a **Request-time API** whose values cannot be known ahead
> of time. Using it will opt the page into **dynamic rendering** at request
> time.

So the page can never be prerendered or reused. This is precisely the condition
the home page was in before Slice D, and removing it is why the home page is now
instant. The home page has no `searchParams`, which is the only structural
difference between the two routes.

### Why the server `searchParams` are nearly redundant

`InteractiveMenuBrowser` already resolves its filters from the **live browser
URL** (`src/components/menu/InteractiveMenuBrowser.tsx:630`):

```ts
function resolveInitialParams(serverParams: InitialMenuSearchParams) {
  if (typeof window === "undefined") return serverParams;
  const live = new URLSearchParams(window.location.search);
  const pick = (key) => {
    const liveValue = live.get(key as string);
    if (liveValue !== null && liveValue !== "") return liveValue;   // live wins
    return serverParams[key];
  };
  ...
}
```

The live URL **takes precedence** on the client. The server-passed values only
affect the server-rendered first paint.

---

## Fact 3 — the payload is large, but compression handles it

Measured with `scripts/measure-menu-transfer.mjs`:

| | |
|---|---|
| raw JSON | 5.87 MB |
| gzip | 154 KB (39x) |
| brotli q4 | 75 KB (80x) |
| serialize (server) | 17 ms |
| parse (client) | 23 ms |

**A payload-trimming hypothesis was tested and rejected as the primary fix.**
Dropping `description` saves 12% of raw bytes but **zero** compressed bytes,
because compression already collapses the repetition. Transfer size is not the
bottleneck.

(Caveat recorded honestly: this synthetic fixture is more repetitive than the
real catalog, so real-world compression ratios will be worse than 39–80x. The
conclusion — that transfer is not the dominant cost — holds regardless, because
even a 10x ratio leaves well under a megabyte on the wire.)

`item.description` is nonetheless **verified unused** by the entire menu client
tree (`ProductCard`, `ProductCardVisual`, `ProductCardPriceSelector`,
`InteractiveMenuBrowser`). The one `.description` hit in the browser is
`AccessoryCard`, a static accessory tile, not a menu item. The product detail
page loads its own item through `getLiveMenuItemByIdCached(id)`, so it is
unaffected. Dropping it from the grid projection is safe but is **not** the
headline fix, and is treated as secondary.

---

## Fact 4 — why it can feel *worse* than before

Slice D made the uncached path genuinely faster (6 chunks in flight instead of
1). But because the cache never stored anything (Fact 1) and the page is dynamic
(Fact 2), **every visitor still pays the full cost every time**. Faster server
work means the browser reaches the hydration wall sooner, and the 4,500-card
client tree is the same size it always was. Nothing regressed; the ceiling
simply moved closer to the part that did not improve.

---

## Plan

**E1 — compress the menu cache entry.** Store gzip+base64 inside
`unstable_cache` so the entry is 204 KB instead of 5.94 MB and is actually
retained. Decode on read. Fall back to the uncached loader on any decode
failure. *This is the fix that matters.*

**E2 — make `/menu` cacheable.** Add `export const revalidate = 60` and stop
opting the whole route into request-time rendering. The client already resolves
filters from the live URL, so shopper-visible behavior is preserved.

**E3 — trim the grid projection.** Drop the verified-unused `description` from
the items handed to the client grid. Secondary, but free.

## Deliberately NOT doing

- **Not** trimming `variants` or `compounds` — verified in use by
  `cardCannabinoids` via `ProductCardVisual`.
- **Not** touching the PDP's data path — it loads its own item.
- **Not** re-attempting an uncompressed enriched-menu cache — that is the 2 MB
  trap this slice exists to escape.

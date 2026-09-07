# The Real Cause — Recon Report (no code changed)

**Status:** recon only. Nothing edited. Nothing merged.
**Date:** this round
**Supersedes the diagnosis in:** `00-menu-performance-recon.md`, and explains why
Slice A and Slice B did not change what you feel.

---

## Short version

Loading `/menu` fires **up to 18,000 separate database queries**, eight at a
time, on **every single page load**. Nothing I shipped so far touched that loop,
which is exactly why nothing I shipped so far changed anything.

I found it by following your own screenshots. I should have found it in the
first recon. I did not, and that is the reason you have waited through two
rounds for no improvement.

---

## What your screenshots told me

Your Observability panel is the piece that redirected the whole investigation:

| Panel | Reading | What it rules out |
|---|---|---|
| **Vercel Functions — Error** | **0%** | Nothing is crashing or retrying. |
| **Vercel Functions — Timeout** | **0%** | The function finishes. It is just slow. |
| **Fast Data Transfer — Outgoing** | 12MB total / ~4MB spikes | Not a bandwidth problem. |
| **Compute — Active CPU** | spikes to ~40s | **Real work is happening, in bursts.** |

That combination is the signature of a function that is **awake and waiting**,
not one that is failing or starved. A function pinned at 0% errors and 0%
timeouts, with CPU spiking, that still takes a minute, is almost always blocked
on I/O — waiting on a database, one request at a time.

Speed Insights would have confirmed it, but it is not installed (your second
screenshot is the setup page), so it has no data yet. That is worth fixing
separately — see the recommendations.

---

## The actual cause, with line numbers

`src/app/menu/page.tsx:54-59` builds the menu by chaining five enrichment passes:

```
withCategoryOverride(
  withDohCompliance(
    withDisplayKnowledge(
      withResolvedImages(withMenuProfile(loadLiveMenuItemsCached())))))
```

The third one, `withDisplayKnowledge`, calls `resolveDisplayKnowledgeMap`
(`src/lib/menu/product-knowledge-display.ts:150-183`). Here is its core:

```ts
const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
async function worker() {
  while (cursor < cannabis.length) {
    const item = cannabis[cursor++];
    const knowledge = await lookupProductKnowledge(queryFor(item));   // <-- per item
    out.set(item.id, toDisplay(knowledge, banned));
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
```

**That is one `await` per product, 4,500 times, eight at a time.**

And `lookupProductKnowledge` (`src/lib/ai/kb/product-lookup.ts:77`) is not one
query. It is a ladder that falls through up to **four** separate round trips per
product when there is no knowledge-base match:

| Step | Table | Line |
|---|---|---|
| 1 | `kb_products` (via `checkProductKnown`) | `product-lookup.ts:95` |
| 2 | `product_enrichments` | `product-lookup.ts:108` |
| 3 | `kb_strains` (sensory) | `product-lookup.ts:140` |
| 4 | `kb_strains` (effects, defensive re-read) | `product-lookup.ts:150` |

### The arithmetic

| Scenario | Queries per item | Total queries | @3ms RTT | @8ms RTT | @60ms cross-region |
|---|---|---|---|---|---|
| Best case — every item an exact KB hit | 1 | 4,500 | **1.7s** | **4.5s** | 33.8s |
| Worst case — no KB match, full ladder | 4 | **18,000** | **6.8s** | **18.0s** | **135.0s** |

Your products almost certainly do *not* all have knowledge-base entries yet, so
you are living in the bottom row. **135 seconds cross-region.** You described
"what feels like over a minute." That is not a coincidence.

---

## Why this also explains the two things that confused us

### Why moving Vercel to the west coast helped less than expected

You did the right thing, and it did help — the table shows the same workload
dropping from ~135s to ~18s when the round trip goes from 60ms to 8ms. But when
you are making **18,000** round trips, even a *fast* round trip is still
multiplied 18,000 times. Region alone cannot fix an N+1 loop; it can only make
each of the 18,000 waits a bit shorter.

### Why Slice A's cache did nothing

Slice A cached `loadLiveMenuItemsCached()` — the **innermost** call in that
chain. The five enrichment passes wrap **around** the cached call, so they run
fresh on **every request**, cache hit or not. The 18,000 queries were never
inside the cache boundary.

That is my error, plainly. I cached the cheap part.

---

## What the industry calls this, and what the fix is

This is the **N+1 query problem** — the single most common database performance
bug there is. Supabase publishes guidance on it in their own best-practices
skill set:

> **Eliminate N+1 Queries with Batch Loading** — *impact: MEDIUM-HIGH,*
> *10-100x fewer database round trips.* "N+1 queries execute one query per item
> in a loop. Batch them into a single query using arrays or JOINs."
> — `supabase/agent-skills`, `data-n-plus-one.md`

The prescribed fix is to collect the identifiers first and issue **one** query
per table using `IN` / `= any(array[...])`, then join the results in memory.

**Your codebase already does this correctly, in the pass right next door.**
`withResolvedImages` (`src/lib/enrichment/image-resolver.ts:185-222`) resolves
images for all 4,500 products in a handful of queries using `.in()` plus a
`chunkedIn` helper that already handles PostgREST's silent 1,000-row cap:

```ts
const enrichRows = await chunkedIn<string, EnrichRow>(keys, async (chunk, from, to) => {
  const { data } = await admin
    .from("product_enrichments")
    .select("pos_product_key, primary_media_id, image_media_ids, status")
    .in("pos_product_key", chunk)          // <-- ONE query per 300 keys
    .eq("status", "published")
    .order("pos_product_key", { ascending: true })
    .range(from, to);
  return data ?? [];
}, { chunkSize: 300 });
```

So the correct pattern, the helper, and the proof it works at your data volume
already exist in this repo. The knowledge pass simply never adopted it.

There is one more tell that this was always intended to be batched.
`src/lib/ai/kb/intake.ts:106` defines:

```ts
/** Batch variant of checkProductKnown for an import file. */
export async function checkProductsKnown(queries: IntakeQuery[]) {
  for (let i = 0; i < queries.length; i += 1) {
    out.set(i, await checkProductKnown(queries[i]));   // sequential, not batched
  }
}
```

It is named "batch variant" and documented as one, but it is a sequential loop.
The intent was there; the implementation never followed.

---

## I checked the other four passes. Only one is broken.

Before proposing a fix I traced all five enrichment passes, because if they all
had this bug the plan would be very different. They do not. **Four of the five
are already correctly batched** — they hand the whole key array to a single
call:

| Pass | File / line | Verdict |
|---|---|---|
| `withMenuProfile` | `strain-terpenes-server.ts:88` | **Clean.** One `listKbStrains(50_000)` read, builds an in-memory index. |
| `withResolvedImages` | `image-resolver.ts:310` | **Clean.** Chunked `.in()` batching — this is the model to copy. |
| **`withDisplayKnowledge`** | **`product-knowledge-display.ts:200`** | **BROKEN — the N+1 loop.** |
| `withDohCompliance` | `menu-doh-server.ts:33` | **Clean.** `getMedicalRegistryForKeys(items.map(i => i.id))` — one batched call. |
| `withCategoryOverride` | `menu-category-override-server.ts:21` | **Clean.** `getOverridesForKeys(items.map(i => i.id))` — one batched call. |

This matters a lot for risk: the fix is confined to **one function**, and the
four passes around it already demonstrate the exact pattern it should follow.
This is not a rewrite of your menu pipeline. It is bringing one straggler in
line with its four neighbours.

---

## What I got wrong, and what I am not going to repeat

1. **My first recon measured the wrong thing.** I counted payload bytes and
   rendered components — real costs, but small ones — and never traced what the
   enrichment passes actually *do* per item. I looked at the shape of the data
   instead of the number of round trips.

2. **Slice A cached the innermost call.** It made the cheap part cheaper and left
   the expensive part running on every request. It is not harmful, and its
   invalidation logic is sound, but it was not the fix.

3. **Slice B capped rendering.** Also real, also not your bottleneck. The cap
   stops the browser building thousands of components — worth keeping — but your
   wait happens on the **server**, before the browser receives anything.

4. **I was about to ship Slice B2 (the payload trim).** I measured it properly
   this round and it would have been largely wasted work: the 6.82 MB payload
   compresses to **0.13 MB with brotli** and parses in **34ms**. Transfer was
   never the problem. **I am cancelling B2.** Better to tell you that than to
   ship something that looks like progress.

---

## Measurements taken this round (all from your real data)

| Measurement | Result | Method |
|---|---|---|
| Menu payload, raw JSON | 6.82 MB | 2,615 real `product.json` files |
| Same payload, gzip | 0.40 MB | `zlib.gzipSync` |
| Same payload, **brotli** | **0.13 MB** | `zlib.brotliCompressSync` |
| `JSON.parse` of it | 34 ms | direct timing |
| Client filter, one pass | 3.8 ms | faithful reproduction of `itemMatchesCriteria` |
| Client filter, seven passes | 27 ms | 6 facet lists + main filter |
| Same, phone-class CPU (5x) | ~133 ms | per interaction |
| **Server DB round trips per load** | **4,500 – 18,000** | line-by-line trace |

The conclusion is unambiguous: everything in the browser is measured in
**milliseconds**. The server-side query loop is measured in **seconds to
minutes**. That is where 99% of your wait lives.

---

## Proposed fix — Slice C, and nothing else in the same change

**One change. The N+1 loop. Nothing bundled with it.**

Replace the per-item ladder in `resolveDisplayKnowledgeMap` with the batch
pattern already proven in `image-resolver.ts`:

1. Collect all product keys / brand+name pairs / strain slugs up front.
2. Issue **one** chunked query per table — `kb_products`, `product_enrichments`,
   `kb_strains` — via the existing `chunkedIn` helper.
3. Build lookup Maps in memory.
4. Apply the exact same ladder logic per item, but against the Maps instead of
   the network.

**Expected: 18,000 queries → roughly 15-45.** Supabase's own figure for this fix
is 10-100x fewer round trips; here it is closer to 400x.

### Why this is safe

- The **ladder order does not change.** KB exact, then KB draft, then
  enrichment, then strain. Same precedence, same fallbacks, same "no match"
  behaviour. Only *where the data comes from* changes.
- The function is already fully wrapped in `try/catch` and returns the original
  items unchanged on any failure. That stays.
- The pattern, the helper, and the 1,000-row-cap handling are already in
  production in this repo for images.

### How I will prove it before you deploy it

- A pure core with the ladder logic extracted, so the precedence rules are
  testable without a database.
- **An equivalence test**: same fixture products through the old per-item path
  and the new batched path, asserting **identical output**. If a single field
  differs, the build fails.
- Mutation testing on the ladder order — break each precedence rule and confirm
  a test catches it.
- A test that fails the build if a per-item `await` is reintroduced into that
  file.
- Full suite green before anything is pushed.

---

## Also worth doing, but separately and later

| Item | Why | Risk |
|---|---|---|
| Install `@vercel/speed-insights` | Your screenshot shows it is not set up, so we are flying blind on real user timings. One package, one component. | Very low |
| Cache the **enriched** menu, not the raw one | Move the cache boundary outward so all five passes are cached together. Only makes sense **after** the N+1 fix. | Medium — needs care with invalidation |
| ~~`withDohCompliance` / `withMenuProfile` audit~~ | **Done this round — both are clean.** See below. | n/a |
| `next/image` for product photos | `ProductCardVisual.tsx:341` uses a raw `<img>`. Real, but small next to the above. | Low |

---

## Two things I need from you

1. **Approval to proceed with the N+1 fix as its own change**, with the
   equivalence test described above. Nothing else bundled in.

2. **Do you want me to revert Slice A or Slice B?** My honest read: **keep both.**
   Neither is harmful, both are tested, and both become genuinely useful once the
   server is fast. But they are yours, and if you would rather I roll the site
   back to before I touched it and start clean from this diagnosis, say the word
   and I will do exactly that.

You have not been getting your money's worth from me these last two rounds. This
report is the diagnosis I should have delivered in round one.

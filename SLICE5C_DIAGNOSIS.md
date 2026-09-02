# SLICE 5C — DIAGNOSIS BEFORE CODE

> Standing rules apply (AGENTS.md, md5 `e572cae78a55770f8436f43dceef8e02`, 101 lines).
> **Never guess. Never assume. Build from fact, not memory.**
> Verified on `main` @ `62ce1c61` (SLICE 6B merged).

---

## 1. The census, re-measured — NOT recalled

I did not trust the "13 remaining" figure from my own earlier report. I
re-measured it on current `main`.

A raw `grep` for `.limit(N>=1000)` in `src/` returns **38** hits. That number is
**wrong** and would have sent this slice off a cliff. Comments written by SLICE
5A/5B *documenting the bug they fixed* contain the literal text `.limit(5000)`,
and the paging primitives themselves legitimately carry large memory ceilings.

Re-ran with a comment-stripping scanner (`scripts/pos/slice5c-census.ts`,
temporary, deleted after use) so doc-comment mentions cannot create false
positives:

```
REAL (comment-stripped) .limit(N>=1000) call sites: 13
total numeric .limit() call sites:                 108
```

**13 — matching what was reported to the owner.** The other 25 are prose or
deliberate ceilings. Verified by opening the dropped sites
(`compliance-health.ts:186`, `ccrs/page.tsx:148`, `intake-store.ts:112`,
`discount-engine.ts:198`) and confirming each is a `// SLICE 5A`/`// SLICE 5B`
comment above already-paged code.

### The 13 real sites

| Limit | Site | Reads | Shape |
| ---: | --- | --- | --- |
| 100000 | `src/lib/ai/router.ts:129` | `ai_usage` | sum in JS |
| 50000 | `src/lib/reports/forecast.ts:64` | `orders` | series in JS |
| 20000 | `src/lib/accounting/sage-exports.ts:766` | `menu_items` | distinct in JS |
| 10000 | `src/lib/ai/usage.ts:271` | `ai_suggestions` | group in JS |
| 5000 | `src/app/api/pos/menu/route.ts:195` | `inventory_lots` | barcode index |
| 5000 | `src/lib/ai/kb/intake-strain-match-server.ts:39` | `kb_strains` | match list |
| 5000 | `src/lib/ai/usage.ts:116` | `ai_usage` | report in JS |
| 5000 | `src/lib/inventory/catalog-drafts.ts:360` | `catalog_product_drafts` | **count in JS** |
| 5000 | `src/lib/noncannabis/store.ts:121` | `noncannabis_products` | SKU set |
| 2000 | `src/lib/accounting/sage-exports.ts:711` | `vendors` | CSV export |
| 2000 | `src/lib/noncannabis/store.ts:94` | `noncannabis_products` | list |
| 1000 | `src/app/admin/inventory/intake/actions.ts:732` | `inbound_manifests` | id list |
| 1000 | `src/lib/inventory/manifest-kb-bridge.ts:211` | `inbound_manifests` | backfill |

---

## 2. Reuse, do not rebuild (Rule 4)

SLICE 5A already built the primitive this slice needs. Verified in-repo:

- `pagedAllChecked()` (`chunked-in.ts:145`) — pages in 1,000-row windows and
  returns `{ rows, verdict }`, where a FAILED page sets `readFailed` instead of
  masquerading as end-of-data, and a self-imposed memory ceiling is reported as
  `limit_reached` rather than silently accepted.
- `evaluateReadCompleteness()` (`read-completeness-core.ts:126`) — the verdict.
- The established call-site shape is `ccrs/page.tsx:162-176`: stable UNIQUE
  `.order("id")` + `.range(from, to)`, `{ rows: [], ok: false }` on error.

**Nothing new needs inventing at the primitive layer.** This slice is the
mechanical application the SLICE 5 workplan predicted (`SLICE5_WORKPLAN.md:204`
— "Mechanical once the primitive from 5A exists").

---

## 3. Two shapes, two different correct fixes

Not every one of the 13 should become a paging loop. Reading the code shows two
distinct shapes, and treating them identically would be its own error.

### Shape A — the read exists ONLY to produce a count/aggregate

`catalog-drafts.ts:360` pulls up to 5,000 `status` strings across the network
and tallies them in a JS loop. `sage-exports.ts:766` pulls up to 20,000
`category` strings to find the DISTINCT set. `router.ts:129` pulls up to 100,000
usage rows to SUM them.

For pure counts, PostgREST's `count:"exact", head:true` is **immune to
`db.max_rows`** — it returns a server-side COUNT with **no row payload at all**.
That is both correct AND dramatically cheaper than paging. This is already the
house pattern (`vendors/store.ts:136`, `medical/store.ts:450`, and 20+ others).

Using a paging loop where an exact count would do would be slower and would
still be reading rows it does not need.

### Shape B — the caller genuinely needs every ROW

`forecast.ts:64` needs each order's date and amount to build a daily series.
`noncannabis/store.ts:121` needs every SKU string to guarantee a collision-free
new SKU. `menu/route.ts:195` needs every active lot's code to build the barcode
index. These must page.

---

## 4. Severity, established from code — not assumed

### 4a. `noncannabis/store.ts:121` — `listExistingSkus()` can MINT A DUPLICATE SKU

This is the one site in the 13 that silently CORRUPTS data rather than
under-reporting a number.

Verified chain: `listExistingSkus()` returns a `Set` of every existing SKU. It
is the collision guard — the generator asks "is this SKU taken?" against that
set. If the read is truncated at 1,000, SKUs from row 1,001 onward are **absent
from the set**, so the generator concludes they are free and **re-issues an SKU
that already exists**.

A duplicate SKU on a non-cannabis product means two different physical items
share one identifier on labels and in inventory. Unlike a wrong dashboard
number, this writes bad data that persists.

### 4b. `menu/route.ts:195` — scan-to-cart silently stops finding products

The barcode index is built from ACTIVE lots. `inventory_lots` is the largest
table in the system — SLICE 3 shipped behavioural proof that **4,179** lot rows
survive the cap (`SLICE3_WORKPLAN.md:58`). Filtered to `status = active` and
`on_hand_qty > 0`, crossing 1,000 is a routine inventory level, not an edge
case.

Past row 1,000 the barcode is simply missing from the index, so scanning that
product at the register does nothing. The code's own comment says a lot-read
failure "ships an empty index ... never a failed menu download" — that
best-effort intent is correct and is preserved. The bug is that a TRUNCATED read
is not a failure at all: it ships a CONFIDENT, SILENTLY INCOMPLETE index.

### 4c. `forecast.ts:64` — forecasts computed from a partial history

`.limit(50000)` on `orders` over the lookback window returns 1,000. The daily
series is then built from whichever 1,000 arrived. Note it DOES have
`.order("placed_at")`, so the truncation is deterministic — it always keeps the
OLDEST 1,000 and silently discards the most recent orders. A revenue forecast
built on stale data, presented with no indication anything is missing.

### 4d. The two `inbound_manifests` reads sit EXACTLY on the cap

`actions.ts:732` and `manifest-kb-bridge.ts:211` both use `.limit(1000)` — the
one value where the number looks deliberate but IS the ceiling. The backfill is
explicitly built for "the owner's historical upload of hundreds of transfer
JSONs" (`manifest-kb-bridge.ts:205-207`). At 1,001 manifests the backfill
silently processes 1,000 and reports success, and the owner has no way to know
the rest were skipped.

---

## 5. What this slice will NOT do

- It will not change what any screen DECIDES. Advisory panels stay advisory.
  Where a read cannot be proven complete, the code says so; it does not
  invent a policy of refusing to render.
- It will not touch the register's sell path (SLICE 5A owns that) or intake
  vendor resolution (5B).
- `menu/route.ts` keeps its best-effort contract: a failed lot read still
  ships an empty index rather than breaking the menu download.

---

## 5b. RESULT (measured after the work)

Re-ran the same comment-stripping census against the finished tree:

```
REAL (comment-stripped) .limit(N>=1000) call sites: 0     (was 13)
total numeric .limit() call sites:                 95     (was 108)
```

The SLICE 5 family is closed: every cap-relevant read in `src/` is now either
paged with an honest completeness verdict, or replaced by a cap-immune
server-side `count:"exact", head:true`.

### A gap this process caught in MY OWN tests

Sabotage 6 — hardcoding `complete: true` inside `listExistingSkusChecked()`,
i.e. reintroducing the duplicate-SKU bug — **passed the entire 13,162-test
suite.** The pure core was well tested; the STORE's use of it was not tested at
all. That is exactly the shape of hole the original bug lived in.

Fixed by adding source-level wiring pins ("the fixes are actually WIRED, not
just available"). Re-running the same sabotage now fails immediately. Recorded
here rather than quietly patched, because a guardrail nobody proved is a
guardrail nobody has.

**8 sabotages run, 8 caught** (one only after closing the gap it exposed), every
file restored byte-identical.

---

## 6. Definition of done (from SLICE5_WORKPLAN.md:216-222)

- [ ] Pure core with `__run…Tests()`, registered in the self-test sweep
- [ ] Behavioural tests proving completeness under a SIMULATED 1,000-row cap
- [ ] Every guardrail proven NON-VACUOUS by reintroducing the bug
- [ ] `tsc --noEmit` → 0 errors
- [ ] `eslint` → 0 problems on touched files
- [ ] Full `vitest run` — no regression (baseline 518 files / 13,140 tests)
- [ ] Branch → PR → fast-forward merge, authored `dev@greenwaymarijuana.com`

> `next build` OOMs (exit 137) in this sandbox **identically on clean `main`** —
> an environment memory limit, not a code regression. `tsc --noEmit` is the
> type gate. Disclosed every round.

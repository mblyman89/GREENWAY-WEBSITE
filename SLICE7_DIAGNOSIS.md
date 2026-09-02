# SLICE 7 — enrichment worklists + the two gaps that could not be clicked

> Diagnosis written BEFORE code (standing rule: build from fact, not memory).
> Every claim below carries a file:line anchor so nothing drifts.

---

## 0. What this slice was allowed to be

SLICE 7 was deferred, in writing, at `SLICE6B_DIAGNOSIS.md:202`:

> `- SLICE 7 — enrichment worklists.`

The owner's standing framing across rounds: lots still need **expiry dates**,
some need **COA** documents, some carry **no cost**, and the Inventory
"What's missing" panel had **two gaps left without working links**.

### What I checked FIRST, so I would not rebuild something that exists

A product-level enrichment worklist **already exists** and is already tested:
`/admin/products` ("Product Enrichment"), specified at
`docs/audit/TEST-PLAN.md:1939` (T-223) with brand/stock filters, smart priority
sort and an honest "Showing X of Y" count.

**So SLICE 7 is NOT "build an enrichment worklist."** That would have duplicated
shipped work and violated standing rule 4 (reuse verified work). The product
side is done. The **lot** side is where the holes are.

---

## 1. The two gaps that could not be clicked — cause, from code

`src/lib/insight/inventory.ts:69-94` carries my own SLICE 6A note:

> these two gaps have NO filter on the inventory list that can isolate them
> (`pos_product_key is null` and `on_hand_qty = 0` are not exposed as query
> knobs). They previously linked to `?status=active`, which on a store where
> every lot is active narrowed nothing at all — a "Fix →" that reloaded the
> same page and looked broken.
> Rather than ship a link that pretends to filter, they are reported WITHOUT
> an href. … Giving these real filters is a follow-up, not something to fake here.

**Re-verified STILL TRUE this round**, not assumed:

- The page accepts exactly `q, status, back, page, sort, coa, sample, medical,
  expiring, vendor, needsReceivedDate` (`src/app/admin/inventory/page.tsx:57-78`).
  There is no knob for either gap.
- `listLotsPaged` builds predicates for status, vendor, q, COA, needsReceivedDate,
  sample, medical, expiry window — and nothing else
  (`src/lib/inventory/store.ts:86-119`).
- `MissingInsight` renders the "Fix →" affordance **only when `href` is set**
  (`src/components/admin/insight/MissingInsight.tsx:52`), which is why omitting
  the href was the honest stopgap rather than a dead button.

So the follow-up SLICE 6A named is exactly this slice: **build the missing
filter knobs, then — and only then — give the gaps their links.**

---

## 2. Two MORE holes found while grounding (not in the original list)

These were not in my memory of the scope. I found them by reading
`computeInventoryStats()`, and they are the reason this slice grew.

### 2a. Lots with NO expiry date are counted by NOTHING

`src/lib/inventory/store.ts:350-353`:

```ts
if (r.expires_on) {
  if (r.expires_on < today) stats.expired += 1;
  else if (r.expires_on <= soon) stats.expiringSoon += 1;
}
```

The guard `if (r.expires_on)` means a lot with **no expiry date on file** falls
through both branches. It is not `expired`. It is not `expiringSoon`. There is
no `missingExpiry` field on `InventoryStats` at all (`store.ts:213-241`).

`expires_on date` is nullable (`supabase/migrations/0023_pos_inventory_lots.sql:106`).

**Consequence:** the "Needs attention" tile (`page.tsx:252-258`) sums recalled +
quarantine + expired + expiringSoon + missingCoa. A lot with an unknown expiry
date is invisible to every one of those terms. The owner asked for an expiry
worklist; the system could not even count the thing he wanted to work through.

This is the same doctrine SLICE 2 established for received dates: **NULL means
UNKNOWN, and unknown must be raised, never quietly treated as fine**
(`store.ts:231-237`).

### 2b. Lots with unknown cost silently contribute 0 to the on-hand total

`src/lib/inventory/store.ts:331-333`:

```ts
if (r.on_hand_qty != null && r.unit_cost_minor_units != null) {
  stats.onHandCostMinor += Math.round(r.on_hand_qty * r.unit_cost_minor_units);
}
```

`unit_cost_minor_units integer` is nullable (`0023_pos_inventory_lots.sql:105`).
A lot whose cost is unknown is skipped — so it adds **0** to a number the page
presents as "On-hand cost" (`page.tsx:246-251`) with the hint "On-hand qty ×
unit cost". No asterisk, no count of how many lots were skipped.

That is the **exact shape** of the original complaint that started this whole
engagement: *"wrong on-hand cost totals."* Earlier slices fixed the truncation
half (only 1,000 lots were being summed). This is the remaining half: the total
is under-stated by every lot whose cost nobody has filled in, and the screen
does not say so.

This connects directly to the below-cost discount floor already documented at
`SLICE5_WORKPLAN.md:118-124`: a missing cost makes `costFloorMinorUnits()`
return `0`, the floor does not bind, and below-cost protection silently
disappears. So an uncosted lot is not merely a cosmetic reporting gap.

---

## 3. What I could NOT do, stated plainly

**There are no database credentials in this sandbox** (`.env.local` absent;
`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset). I therefore
**cannot re-measure** the live counts (how many lots lack an expiry date, a COA,
or a cost) this round.

Numbers I have quoted in past reports came from measurements taken when those
credentials were available. **I will not restate them as current fact.** The
build is therefore driven by the *shape* of the data (nullable columns, verified
predicates), not by remembered magnitudes, and every new counter computes from
the live table when the owner loads the page.

---

## 4. The design call: mirror the COUNTER, not the column

The naive fix is `\`.is("pos_product_key", null)\``. That would be **wrong**, and
would produce a "Fix →" whose list disagrees with the number beside it.

The counters use JavaScript truthiness (`store.ts:347-349`):

- `if (!r.pos_product_key)` — true for `null` **and for the empty string**.
  `pos_product_key text` has no NOT NULL and no default
  (`0023_pos_inventory_lots.sql:97`), so `''` is representable.
- `if (!r.on_hand_qty || r.on_hand_qty <= 0)` — `on_hand_qty numeric not null
  default 0` (`0023:102`), so the real case is `<= 0`, not `is null`. Negative
  quantities also count.

So each filter must reproduce its counter's predicate exactly:

| gap | counter (store.ts) | filter must be |
|---|---|---|
| `missingProductLink` | `!r.pos_product_key` | `pos_product_key is null OR = ''` |
| `emptyActive` | `!on_hand_qty \|\| <= 0` | `on_hand_qty <= 0` |
| `missingExpiry` (new) | `!r.expires_on` | `expires_on is null` |
| `unknownCost` (new) | `unit_cost_minor_units == null` | `unit_cost_minor_units is null` |

All four are additionally scoped to `status = 'active'`, because every counter
above sits inside `if (r.status === "active")` (`store.ts:346`).

**This equivalence is the thing worth testing**, and it is what I will pin: the
count and the filtered list are two expressions of one predicate, and they must
never drift apart. That is the defect SLICE 6A found (a link that narrowed
nothing) generalised into a rule.

---

## 5. Scope of this slice

1. A PURE core that owns the four gap predicates + their hrefs, so the counter
   and the filter are derived from ONE definition and cannot disagree.
2. Four new filter knobs on the inventory list, parsed by the existing grammar
   (`parseYesNo` / literal `"1"`), garbage silently meaning "filter off" — the
   house rule at `page.tsx:84-100`.
3. Two new honest counters: `missingExpiry` and `unknownCost`.
4. Disclose the on-hand cost total when lots were skipped, instead of printing a
   confident understated number.
5. Give the two href-less gaps their real links — only now that filters exist.

NOT in this slice (reported, not silently dropped):
- Bulk editing of expiry/cost from the worklist (a write path; DRAFTS-ONLY rule
  3 means owner-reviewed writes need their own slice).
- Re-measuring live counts (no credentials, see §3).

---

## 5b. RESULT

| | before | after |
|---|---|---|
| gaps in "What's missing" with a working link | 3 of 5 | **6 of 6** |
| lots with no expiry date counted anywhere | **0 (invisible)** | counted + linked |
| lots with no unit cost counted anywhere | **0 (invisible)** | counted + linked |
| on-hand cost total disclosing what it skipped | no | **yes** |
| definitions of each gap predicate in the codebase | 2 (counter + filter, free to drift) | **1 (shared core)** |

Verification: `tsc --noEmit` 0 errors; `eslint` 0 problems on 7 touched files;
pure self-tests all passed with `lot-gap-core` registered; vitest **520 files /
13,201 tests passed** (baseline 519 / 13,169 → +1 file, +32 tests, zero
regressions); **9 sabotages run, 9 caught**, every file restored byte-identical
(`md5sum -c`).

### Two process notes, recorded rather than hidden

**ESLint caught a dead import I had left behind.** I imported
`LOT_GAP_DEFINITIONS` into `store.ts` while drafting the filter loop, then
implemented it without needing the symbol. It was flagged and removed rather
than shipped.

**A `git checkout --` during sabotage repair silently reverted `store.ts` to the
committed version, discarding every SLICE 7 edit in that file.** The pure core
is a NEW, untracked file, so `git checkout` could not restore it — but `store.ts`
IS tracked, so the same command wiped real work instead of undoing a sabotage.
The md5 pin caught it immediately (`store.ts: FAILED`), and all four edits were
reapplied and re-verified byte-identical. Without checksum verification after
each sabotage, this slice would have shipped a core that nothing called — which
is precisely the failure SLICE 5C's sabotage 6 exposed.

---

## 6. Definition of done

- [x] Pure core with `__run…Tests()`, registered in the self-test sweep
- [x] Tests proving each filter predicate MATCHES its counter (the anti-drift pin)
- [x] The existing SLICE 6A test updated honestly, not deleted
- [x] Every guardrail proven NON-VACUOUS by sabotage; files restored byte-identical
- [x] `tsc --noEmit` → 0 errors; `eslint` → 0 problems on touched files
- [x] Full `vitest run` — no regression (baseline 519 files / 13,169 tests)
- [x] Branch → PR → fast-forward merge, authored `dev@greenwaymarijuana.com`

> `next build` OOMs (exit 137) in this sandbox **identically on clean `main`** —
> an environment memory limit, not a code regression. `tsc --noEmit` is the type
> gate. Disclosed every round.

# SLICE 5 — Work plan and scoping decision

> Standing rules apply (AGENTS.md, md5 `e572cae78a55770f8436f43dceef8e02`, 101 lines).
> **Never guess. Never assume. Build from fact, not memory.**
> Every fact below carries the file:line it was verified at, on `main` @ `4c7cfb6b`.

---

## 0. Why this slice exists

SLICE 1–4 fixed truncation where it had already caused visible damage (the 1,000-product
menu cap, the fact-review gate). SLICE 5 closes the rest of the family. The owner's
original report — *"it only lets 1000 products in"* — was never one bug. It is a
**pattern** repeated across the codebase: a `.select()` with a large `.limit(N)` that the
author believed raised the row cap.

**It does not.** PostgREST's `db.max_rows` (default 1000) is a SERVER-side ceiling.
`.limit(N)` can only ever LOWER it. `.limit(5000)` returns 1,000 rows, no error, no warning.

Verified in-repo, not from memory:

| Fact | Source |
| --- | --- |
| "PostgREST/Supabase caps a single response at `db.max_rows` (default 1000)" | `src/lib/supabase/chunked-in.ts:13-14` |
| "a plain query silently returned only the first 1000 (the root cause of 'the system thinks we only have 1000 vendors')" | `src/lib/vendors/store.ts:32-34` |
| "`listBenchmarks()` had NO pagination — PostgREST caps a read at 1000 rows while a drop writes ~6,000–8,200" | `docs/ROADMAP_BACKOFFICE_FIXES.md:884` |
| The established fix is `.range()` paging in 1,000-row windows until a short page | `chunked-in.ts:76-96`, `vendors/store.ts:43-63` |

---

## 1. Verified inventory — 20 cap-relevant sites

Swept every `.ts`/`.tsx` under `src/`, with block and line comments stripped so
doc-comment mentions could not create false positives.

**114 numeric `.limit()` call sites total. 20 are `>= 1000`** — i.e. 20 places where the
author asked for more rows than the server will ever return.

Line numbers below are re-verified against the RAW files (`grep -n`), not the
comment-stripped copy.

| Limit | Site | Table | Tier |
| ---: | --- | --- | --- |
| 5000 | `src/lib/pos/recall-hold-store.ts:37` | `inventory_lots` | **1 — statutory** |
| 10000 | `src/lib/promotions/discount-engine.ts:190` | `inventory_lots` | **1 — statutory** |
| 1000 | `src/app/admin/compliance/ccrs/page.tsx:152` | `medical_exempt_sales` | **1 — statutory** |
| 2000 | `src/lib/compliance/compliance-health.ts:186` | `patient_authorizations` | **1 — statutory** |
| 2000 | `src/lib/inventory/intake-store.ts:143` | `vendors` | **2 — correctness** |
| 2000 | `src/lib/inventory/intake-store.ts:183` | `vendors` | **2 — correctness** |
| 2000 | `src/lib/inventory/intake-store.ts:96` | `inbound_manifests` | 2 |
| 5000 | `src/app/api/pos/menu/route.ts:195` | `inventory_lots` | 2 |
| 1000 | `src/app/admin/inventory/intake/actions.ts:732` | — | 2 |
| 2000 | `src/lib/accounting/sage-exports.ts:711` | `vendors` | 3 — money/report |
| 20000 | `src/lib/accounting/sage-exports.ts:766` | `menu_items` | 3 |
| 50000 | `src/lib/reports/forecast.ts:64` | `orders` | 3 |
| 5000 | `src/lib/noncannabis/store.ts:121` | — | 3 |
| 2000 | `src/lib/noncannabis/store.ts:94` | — | 3 |
| 5000 | `src/lib/inventory/catalog-drafts.ts:360` | — | 3 |
| 1000 | `src/lib/inventory/manifest-kb-bridge.ts:211` | — | 3 |
| 5000 | `src/lib/ai/kb/intake-strain-match-server.ts:39` | — | 3 — advisory |
| 100000 | `src/lib/ai/router.ts:129` | — | 3 |
| 5000 | `src/lib/ai/usage.ts:116` | — | 3 |
| 10000 | `src/lib/ai/usage.ts:271` | — | 3 |

> Correction recorded per the standing rules: my earlier working notes said "about five
> sites" and listed two paths (`src/lib/inventory/recall-hold-store.ts`,
> `src/lib/pos/discount-engine.ts`) that **do not exist**. The real count is 20 and the
> real paths are `src/lib/pos/recall-hold-store.ts` and
> `src/lib/promotions/discount-engine.ts`. Verified by walking the tree, not by memory.

---

## 2. The finding that reshaped this slice

Grounding turned up something more important than any individual `.limit()`:

### **There is currently no way to detect truncation at all.**

1. **A capped read is not an error.** `recalledProductKeys()`
   (`recall-hold-store.ts:33-38`) checks `if (error) throw`. Truncation sets no error.
   The function is documented as the fail-CLOSED half of an asymmetric pair
   (`recall-hold-store.ts:11-15`) and the completion gate calls it with
   `failClosed: true` (`completion-gate.ts:103`) so a read failure refuses the sale
   (`completion-gate.ts:118-120`). **That protection cannot fire on truncation**, because
   truncation looks exactly like success.

2. **The read has no `.order()`.** Verified: zero `order(` calls in
   `recall-hold-store.ts:29-46`. Without a stable sort, *which* 1,000 of the recalled
   lots come back is arbitrary and can change between two calls on the same data.

3. **`pagedAll()` cannot distinguish "read failed" from "no more rows."** Its fetcher
   returns `Row[]` (`chunked-in.ts:82-96`); a failed page returns `[]`, which
   `rows.length < pageSize` reads as a clean end-of-data. The same shape of fail-open
   that SLICE 4A found in the commit gate. `listVendors()` has it too —
   `if (error || !data) break;` (`vendors/store.ts:60`) silently returns a SHORT list on
   a mid-page failure.

So patching 20 `.limit()` calls into 20 `.range()` loops would fix today's numbers and
leave the same blind spot in place. **The right first move is to build the missing
primitive: a read that can prove it was complete, and say so when it cannot.**

---

## 3. Severity, established from code — not assumed

### Tier 1a — `recall-hold-store.ts:37` — a recalled product can be sold

`inventory_lots` is the largest table in the system (SLICE 3 shipped behavioural proof
that **4,179** lot rows survive the cap — `SLICE3_WORKPLAN.md:58`). The query filters
`.eq("status", "recalled")`, so it only truncates once more than 1,000 lots are recalled
at one time — a large multi-batch LCB recall, which is precisely the moment the gate
matters most. Past row 1,000 the product key is absent from the hold set, `findHeldLines`
returns nothing, and `runCompletionGate` **completes the sale**.

This is the one failure in the list with a statutory consequence at the register.

### Tier 1b — `discount-engine.ts:190` — the below-cost floor silently disappears

`loadProductCosts()` builds the weighted-average acquisition cost map. Verified chain:

- cost missing → `costFloorMinorUnits()` returns **`0`** (`discount-engine-core.ts:226`)
- floor `0` → `atCostFloor: floor > 0 && ...` is **false** (`discount-engine-core.ts:592`)
- so the clamp does not bind and the discount applies unchecked

The map is consumed by **7 call sites** including `order-pricing.ts:175`,
`api/pos/menu/route.ts:67`, `api/pos/loyalty/route.ts:95` and `promo-guard.ts:54` — i.e.
live register pricing. Truncation does not throw an error or show a warning; it just
removes below-cost protection from every product past the cap. Fail-open, in the money
direction, on a CCRS/RCW 69.50.357 concern.

### Tier 1c/1d — compliance evidence reads

- `ccrs/page.tsx:152` reads `medical_exempt_sales` for the DOH evidence panel.
  WAC 314-55-090(2) recordkeeping carries a **5-year retention** duty; a silently short
  count under-reports exempt excise.
- `compliance-health.ts:186` reads `patient_authorizations` for DOH card health
  (expiring/expired counts). Truncation under-reports expiring cards.

Both are wrapped in `try {} catch {}` marked *best-effort* — which is defensible for a
panel, but it means a wrong number is displayed with no indication that it is wrong.

### Tier 2 — `intake-store.ts:143` — **already broken today**

This one is not conditional on future growth:

| Fact | Source |
| --- | --- |
| `vendors` holds **1,775 rows** | `docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30` (live PostgREST count) |
| the lookup asks for `.limit(2000)` and gets **1,000** | `intake-store.ts:139-143` |
| it then filters **in JavaScript**: `rows.find(r => normalizeLicense(r.license_number) === licenseKey)` | `intake-store.ts:145` |
| there is **no `.order()`** | verified: 0 matches in `intake-store.ts:136-150` |

**1,775 > 1,000, so ~775 vendors are invisible to the license lookup right now, and which
775 is arbitrary.** Step 4 (`intake-store.ts:179-187`) repeats the identical pattern for
the normalized-name scan.

The consequence is not a missing row on a screen. The ladder is documented at
`intake-store.ts:109-122`: when steps 1–4 all miss, **step 5 auto-creates a new `draft`
vendor** (`intake-store.ts:210-223`). So a vendor we already have, whose row happens to
sit past the arbitrary cap, gets **duplicated on every delivery** — splitting that
vendor's lots, catalog drafts and CCRS lineage across two ids.

**This one is not a pagination fix.** Fetching 1,775 rows to find one license in JS is the
wrong shape regardless of the cap. The correct fix is a targeted database filter, so the
server returns the one matching row. Recorded here because it changes what 5B must build.

### Tier 3 — money, reporting, advisory

`sage-exports.ts`, `forecast.ts`, `noncannabis/store.ts`, `catalog-drafts.ts`,
`manifest-kb-bridge.ts`, `ai/*`. Real but lower blast radius; several are genuinely
best-effort (the POS barcode index at `menu/route.ts:195` ships an empty index on failure
by design — `menu/route.ts:183-185`).

---

## 4. Scoping decision

The owner delegated this call (Round 5, verbatim): *"If the scope grows, the slice count
should too unless it doesn't make sense from a professional experts opinion… Please do
what you think is right."*

The scope grew from an assumed ~5 sites to a verified 20, and grounding showed the real
defect is a **missing primitive**, not 20 independent typos. Splitting by *blast radius*
and by *kind of fix* — the same reasoning that split SLICE 4:

### **SLICE 5A — the completeness primitive + the two statutory sell-path reads**
- Pure core: a read that can prove it was complete, and name the reason when it cannot.
- `pagedAllChecked()` — paging that reports failure instead of impersonating end-of-data.
- Apply to `recall-hold-store.ts` (the sale-blocking gate) and `discount-engine.ts`
  (the below-cost floor).
- Blast radius: the register. Fail posture must stay asymmetric — advisory callers keep
  degrading softly, the statutory gate refuses.

### **SLICE 5B — compliance evidence reads + the vendor-resolution correctness bug**
- `medical_exempt_sales`, `patient_authorizations` — complete reads, and surface it
  honestly when a panel's number cannot be trusted.
- `intake-store.ts` vendor resolution — **targeted DB filter**, not paging. Different fix,
  different test battery, and it is the one actively-firing bug in the list.
- Blast radius: back office + intake. Does not touch the register.

### **SLICE 5C — money, reporting and advisory reads**
- `sage-exports.ts`, `forecast.ts`, `noncannabis`, `catalog-drafts`,
  `manifest-kb-bridge`, `intake/actions.ts`, `ai/*`.
- Mechanical once the primitive from 5A exists.

**Slice count: 7 → 9.** Reported to the owner, as with SLICE 4.

Why not one PR: 5A changes the sell path, 5B changes intake write behaviour (it can stop
creating vendor rows), 5C is bookkeeping. Landing them together would mean one revert
button for three unrelated risk profiles.

---

## 5. Definition of done (each sub-slice)

- [ ] Pure core with `__run…Tests()`, registered in `scripts/compliance/run-pure-selftests.ts`
- [ ] Behavioural tests proving completeness under a simulated 1,000-row server cap
- [ ] Every guardrail proven **non-vacuous** by reintroducing the bug and watching it fail
- [ ] `tsc --noEmit` → 0 errors
- [ ] `eslint` → 0 errors, 0 warnings on touched files
- [ ] Full `vitest run` — no regression against the 13,018-test baseline
- [ ] Branch → PR → fast-forward merge, authored `dev@greenwaymarijuana.com`

> `next build` OOMs (exit 137) in this sandbox **identically on clean `main`** — an
> environment memory limit, not a code regression. `tsc --noEmit` is the type gate.
> Disclosed every round.

# ROUND 7 — DIAGNOSIS BEFORE CODE

Owner reported four things. Each is reproduced below from the owner's OWN
uploaded workbooks and screenshots, by running the REAL transformer, the REAL
bucket builder and the REAL commit gate. Nothing here is inferred.

Evidence run: `scripts/pos/round7-repro.ts` (grounding only, deleted after use)
against `268245__September-01-2026_Products.xlsx` (3,541 rows) and
`CACA40__Inventories-September-01-2026.xlsx` (4,284 rows).

---

## THE MEASURED TRUTH

```
menu items                      3333
hidden (rejected)                771
diagnostics emitted             6603      <-- SIX THOUSAND SIX HUNDRED THREE
  by severity: warning 4160 / info 2443
```

Diagnostics by code (the four that feed the review queue are marked):

```
  3251  warning  unknown_strain_type
   831  warning  inventory_without_product_master
   716  info     product_master_duplicate
   488  info     fact_extraction_review        <-- FEEDS REVIEW
   448  info     inventory_batch_collapse
   257  info     cannabinoid_missing           <-- FEEDS REVIEW
   168  info     package_size_potency_rejected
   119  info     package_size_measure_conflict
    98  info     thc_package_total_override
    76  info     group_variant_merge
    73  info     package_size_name_override
    46  warning  unmapped_category_fallback
    18  warning  package_size_mg_garbage       <-- FEEDS REVIEW
    13  warning  new_unmapped_category
     1  warning  cannabinoid_value_capped      <-- FEEDS REVIEW
```

---

## DEFECT 1 — "604 await a decision" but the page shows nothing (THE BLOCKER)

**The two screens are reading two different universes.**

| Caller | Line | Call | Rows it really gets |
|---|---|---|---|
| Publish gate | `import-service.ts:360` | `getImportDiagnostics(importId)` | **all 6,603** (paged) |
| Fact Review page | `facts/page.tsx:48` | `getImportDiagnostics(id, { limit: 5000 })` | **1,000** |
| Fact Review CSV export | `facts/export/route.ts:31` | `getImportDiagnostics(id, { limit: 5000 })` | **1,000** |
| Import Review page | `[id]/page.tsx:74` | `getImportDiagnostics(id, { limit: 5000 })` | **1,000** |

`.limit(5000)` does not raise PostgREST's `db.max_rows` ceiling of 1,000 — it
can only ever LOWER a result below it. So the three display screens are hard
capped at 1,000 while the gate reads all 6,603.

**It is worse than a simple cap, and this is the part that made the queue look
empty rather than merely short.** `getImportDiagnostics` orders by
`severity` (`menu-version.ts:173`). `severity` is a Postgres ENUM declared in
migration `0002_slice2_pos_import.sql:28` as:

```sql
create type diagnostic_severity as enum ('error','warning','info');
```

An enum sorts in DECLARATION order, so ascending severity puts **`info` LAST**.
There are 4,160 warnings — more than the 1,000-row ceiling by itself. The
page's 1,000 rows are therefore **100% warnings, and not one single `info` row
ever arrives.**

Two of the four review-feeding codes are `info` severity
(`transform.ts:665` `cannabinoid_missing`, `transform.ts:1034`
`fact_extraction_review`) and together they are 745 of the 764 review
diagnostics. That is why the owner sees "10" and not "614": the only review
flags that survive the cut are the 18 `package_size_mg_garbage` +
1 `cannabinoid_value_capped` warnings — exactly the "junk mg numbers like THC
recorded at 25000 instead of 250" the owner said were the only ones fixable.

**Reproduced exactly:**

```
=== A. PUBLISH GATE (all diagnostics, no limit) ===
needs-review  : 614
PENDING       : 614
gate.message  : Cannot publish: 614 fact-review row(s) still await a human decision.

=== B. FACT REVIEW PAGE (limit:5000 -> capped at 1000) ===
diagnostics the page actually receives: 1000
their severities: [ [ 'warning', 1000 ] ]      <-- ZERO info rows
PENDING SHOWN : 11

=== THE DISCREPANCY ===
gate says 614 pending; page shows 11. Invisible to the owner: 603
```

The owner already saved **10** decisions (the CSV shows 10 rows with
`Status = fix`). **614 − 10 = 604** — the owner's exact error message.

**Verdict: the refusal is CORRECT and the queue is REAL. The screen that is
supposed to let the owner clear it simply cannot see 603 of its own rows.**

## DEFECT 1b — clearing it by hand is not humanly possible

Even once visible, `facts/page.tsx:126` renders one `ReviewCard` per pending
row and each card posts ONE decision (`actions.ts:219 resolveFactReview`).
614 rows = 614 individual form round-trips. There is no bulk decision path.

## DEFECT 2 — rejected rows cannot be acted on

`facts/page.tsx` renders the Rejected section as **name + notes only** — no
`ReviewCard`, no form, no buttons. It is display-only by construction, so
there is genuinely nothing to click.

All 771 carry ONE reason (verified, all 771 identical in the owner's CSV):
`no_product_master` — "In the inventory file but missing from the products
file." Confirmed against the raw workbooks: 801 inventory product-keys have no
match in the Products workbook (`transform.ts:827`).

**These 771 do NOT block publishing** — they are documented rejects, already
reconciled. They are a data-completeness worklist, not a review queue.

## DEFECT 3 — the inventory "Fix →" button goes nowhere

`insight/inventory.ts:50` — the missing-COA gap links to
`/admin/inventory?status=active`. The owner's screenshot shows
**TOTAL LOTS 3800 / ACTIVE LOTS 3800** — every lot is already active, so the
link filters 3800 lots down to... 3800 lots. Nothing appears to happen.

Five of the eight gaps point at the same `?status=active` URL. The page
already supports `coa=no` (`page.tsx:88`) and `expiring=N` (`page.tsx:92`);
the hrefs simply never used them.

## DEFECT 4 — no products reach the customer-facing website

Not a separate bug. `live-menu.ts:115` reads the single `published`
`menu_versions` row; publishing is blocked by Defect 1, so no version is ever
published and `loadLiveMenuItems()` correctly returns `[]`. **Fixing Defect 1
fixes this.**

---

## THE ONE SLICE (SLICE 6A)

Fix what BLOCKS the owner, and only that:

1. Display screens read EVERY diagnostic, not a silently-capped 1,000, and say
   so out loud if a read ever comes back incomplete (use SLICE 5A's
   `pagedAllChecked`, never a silent partial queue).
2. A bulk decision path so 614 rows can be cleared by named human decisions
   grouped by reason, each still recorded per-row and auditable.
3. Point the "Fix →" links at filters that actually narrow the list.

Deferred, reported to the owner, NOT silently dropped:
- The 771 `no_product_master` rows (product-master enrichment worklist).
- SLICE 5C — the remaining 13 cap-relevant reads.

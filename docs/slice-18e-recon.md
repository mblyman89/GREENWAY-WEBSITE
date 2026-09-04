# SLICE 18E — RECON AND STRATEGY

> **Status after the build (added at the end of 18E).** This document is the
> recon as it stood *before* any code was written, and it is left intact so the
> reasoning can be audited against what was actually known at the time. Three
> things changed afterwards and are recorded elsewhere:
>
> - The two items this document marked **NOT PROVEN** were both investigated and
>   closed. See **`docs/slice-18e-verdicts.md`**. In short: the F6 draft-staleness
>   issue is real but *cannot* overwrite a correction, so it is cosmetic; and the
>   suspicious POS-import code is a self-test fixture, not a defect.
> - Decision **D5** ("do not spend a migration on prose") was **overruled by the
>   owner**, who asked for the enterprise-grade practice. Migration
>   `0219_classification_provenance_doctrine.sql` was written. The count moves
>   **218 → 219**. The reasoning is in `docs/classification-provenance.md`.
> - A **third, more serious defect** was discovered during the build: receiving
>   any product erases every sales-limit classification on the menu. It is not
>   fixed here. See **`docs/slice-18e-defect3.md`**.
>
> Finding **F9** below ("no migration is required") was correct as a technical
> statement and is now superseded as a plan by the owner's decision.

**Status: RECON ONLY. No code was changed. No branch was cut. No migration was written.**

Owner instruction for this round, verbatim:

> "I agree, let's recon first and come up with a proper strategy for this next
> slice. I'm not sure what this slice does, so please break it down in plain
> English for me in the summary report. No code edits, just recon and strategy.
> Follow the standing rules and never guess, never assume."

Standing rule in force: **do not guess, do not assume. we build from fact, not
memory.** Every finding below cites a file and a line number that was read in
this session. Where a claim could not be proven from primary source it is
marked NOT PROVEN and is not relied upon.

Baseline at the time of recon: `main` at `f2b7c6c9`, working tree clean,
migrations **218**, `todo.md` **3,577** lines.

---

## 0. WHAT 18E IS SUPPOSED TO BE — the roadmap's own words

From `docs/slice-18-integration-recon.md:348-351`, verbatim:

> **18E — Lot-level truth + correction path.** Decide and document whether
> `inventory_lots` is authoritative or derived; make the lot page able to
> correct a classification; make the dead columns live or explicitly retire
> them.

And from the same document's file-touch map for 18E, verbatim:

> - `src/app/admin/inventory/[id]/page.tsx` (929 lines) + its action.
> - Decide: is `inventory_lots.otherwise_taken` authoritative, derived from
>   `menu_items`, or retired? Document the answer in the migration comment.

That is the brief as written. The recon below establishes that **two of the
three deliverables in that brief have already been built and shipped**, that
the decision it asks for **has already been made in code**, and that the real
remaining work is something the roadmap did not know about because it had not
happened yet.

---

## 1. FINDINGS

### F1 — There are four classification columns, not one, and they exist on four tables

Read from primary source (the migration files themselves).

`0216_low_thc_liquid_limit.sql:96-103` adds to **both** `menu_items` and
`inventory_lots`:

```sql
alter table public.menu_items      add column if not exists low_thc_liquid boolean;
alter table public.menu_items      add column if not exists unit_thc_mg    numeric(10,3);
alter table public.inventory_lots  add column if not exists low_thc_liquid boolean;
alter table public.inventory_lots  add column if not exists unit_thc_mg    numeric(10,3);
```

`0217_otherwise_taken_limit.sql:163-170` adds to the same two tables:

```sql
alter table public.menu_items      add column if not exists otherwise_taken   boolean;
alter table public.menu_items      add column if not exists units_per_package numeric(10,3);
alter table public.inventory_lots  add column if not exists otherwise_taken   boolean;
alter table public.inventory_lots  add column if not exists units_per_package numeric(10,3);
```

`0217:280-287` additionally adds all four to `order_lines` as an immutable
**sale-time snapshot**, and `0218_receiving_classification.sql` adds five
`chosen_*` columns to `catalog_product_drafts`.

So the same four facts live in four places, and each place has a different job:

| Table | Role | Proven by |
|---|---|---|
| `catalog_product_drafts.chosen_*` | where the human's answer is **captured** at onboarding | `0218`, `catalog-drafts.ts:631-638` |
| `menu_items.*` | what the register and website **enforce** from | `live-menu.ts:94-100` |
| `inventory_lots.*` | (the question this slice asks) | — |
| `order_lines.*` | frozen snapshot of what was true **at sale time** | `0217:280-287` |

### F2 — DECISIVE: nothing anywhere reads `inventory_lots` classification columns to enforce a limit

This is the single most important fact in the recon and it is the one the whole
decision turns on.

The register's flags come from the **menu row**, not the lot row.
`src/lib/pos/live-menu.ts:94-100`:

```ts
lowThcLiquid:    row.low_thc_liquid ?? null,
unitThcMg:       row.unit_thc_mg ?? null,
otherwiseTaken:  row.otherwise_taken ?? null,
unitsPerPackage: row.units_per_package ?? null,
```

`row` there is a `menu_items` row. Those values then travel into
`sale-flow-core.ts:428-431` and `:494-501`, which is what
`qualifiesAsLowThcLiquid()` / `qualifiesAsOtherwiseTaken()` consume.

I searched every Supabase `select` in `src/` that names any of the four columns.
Only **two** reads of the *lot* copies exist in the entire codebase:

1. `src/lib/inventory/intake-store.ts:1470` — `listManifestLots()` selects
   `otherwise_taken` for the receiving-dock review summary.
2. `src/lib/inventory/store.ts:431` — `getLotById()` uses `select("*")`, so it
   incidentally returns all four, and `admin/inventory/actions.ts:799-802`
   reads them **only to write the audit-log `before` block**.

Neither is an enforcement read. **No limit decision anywhere in the system is
made from `inventory_lots`.** This is not my inference; the codebase says so in
its own words at `src/lib/inventory/classification-status-core.ts:22-40`:

> `menu_items` is the ONLY surface the register enforces from. […] Nothing ever
> reads those columns back off `inventory_lots` to decide a limit. […] So:
> STATUS IS COMPUTED FROM MENU TRUTH. **The lot row is provenance, not the
> answer.**

### F3 — The decision the roadmap asks 18E to make was already made and shipped in 18A

The roadmap says "Decide … whether `inventory_lots` is authoritative or
derived". `git log -S` proves when that decision was implemented:

```
0454810b SLICE 18A: sales-limit classification worklist + product-detail editing
```

18A introduced both `updateLotComplianceClassificationAction` and
`applyClassificationToMenu`, and it wrote the reasoning into
`classification-status-core.ts:22-40` (quoted above) and into
`src/app/admin/inventory/[id]/page.tsx:154-163`:

> We deliberately do NOT show `lot.otherwise_taken` here. The register reads the
> limit flags off the MENU row (`live-menu.ts:94-100`), and every lot from the
> one-time Cultivera import carries NULL lot-flags whether or not a human
> already classified it in fact review […] Showing the lot column would tell the
> owner a product is unclassified when the register is already enforcing an
> answer.

**Verdict on the roadmap's question: `inventory_lots` is NEITHER authoritative
NOR derived-and-displayed. It is a write-only provenance mirror.** The
correct 18E action is therefore to *ratify and enforce* that answer, not to
re-open it.

### F4 — The "make the lot page able to correct a classification" deliverable already ships

`src/app/admin/inventory/[id]/page.tsx:876-1030` renders a complete
"Sales-limit classification" panel with a status badge
(`classificationBadgeLabel`), a plain-English gap list
(`describeClassificationGap`), the current menu-side answers, and a four-field
form bound to `updateLotComplianceClassificationAction`. It is anchored
`id="classification"` (`:887`) as the landing target for 18A's worklist link.

The action itself (`admin/inventory/actions.ts:706-825`) is well built and I
found no defect in its ordering logic. Notably it:

- re-derives the shelf **server-side** and refuses to trust the form
  (`:726-736`), so a stale tab cannot disable the gate;
- validates through the *same pure gate the receiving door uses*
  (`validateReceivingClassificationChoice`), so the two doors cannot drift;
- writes the **menu first** (`:759-766`) because that is the enforcement
  surface, and only then mirrors to the lot row (`:773-790`) as best-effort;
- records `lot_row_write_failed` in the audit when the mirror fails, so a reader
  can tell "the register is enforcing this but the lot row disagrees".

**Deliverables 2 of 3 in the roadmap's 18E brief are already done.** Anything
18E does here is polish, not construction.

### F5 — DEFECT 1 (REAL, HIGH VALUE): the receiving dock's suppository warning can never be silenced

This is a genuine, provable bug that the roadmap did not anticipate. It is the
strongest candidate for 18E's actual work.

The chain, every link read from source:

1. **The parser always writes null.** `intake-parser.ts:430-433`, `:504-507`,
   `:628-631`, plus `manifest-merge-core.ts:411`, `ccrs-manifest-csv-core.ts:515`,
   `pdf-manifest-core.ts:63`, `pdf-growflow-manifest-core.ts:154`,
   `pdf-openthc-manifest-core.ts:193`, `pdf-transferlog-core.ts:156` — every
   manifest parser in the building sets `otherwise_taken: null`. Correct: a WA
   manifest has no such field.

2. **Receiving inserts that null onto the lot.** `intake-store.ts:562-565`
   inserts `otherwise_taken: line.otherwise_taken`, i.e. null, on every received
   lot. The comment at `:552-561` explains this is deliberate — the answer
   "arrives later from the Product Onboarding gate".

3. **Onboarding captures the answer — into the DRAFT table.**
   `catalog-drafts.ts:631` writes `update.chosen_otherwise_taken` to
   `catalog_product_drafts`. I checked lines 560–740 of that file for any write
   back to `inventory_lots`: **there is none.**

4. **Approval pushes the answer to the MENU.**
   `draft-injection-core.ts:499` maps `otherwise_taken: d.chosen_otherwise_taken`
   and `draft-injection.ts:278` inserts it into `menu_items`. Correct and
   sufficient for enforcement.

5. **But the dock reads the LOT.** `intake-store.ts:1470` selects
   `otherwise_taken` from `inventory_lots`, and
   `intake-review-core.ts:158` fires its warning on
   `line.otherwise_taken == null && suspectsOtherwiseTaken(...)`.

**Consequence.** `inventory_lots.otherwise_taken` can only become non-null via
exactly one code path in the entire system: the 18A manual edit at
`admin/inventory/actions.ts:779` (line 777 selects the table, 779 sets the flag). The onboarding answer never reaches it.
Therefore a receiver who correctly classifies a suppository at Product
Onboarding **still sees the "This looks like a suppository… nobody has
classified it" warning on the manifest review screen, permanently.**

The code even states the intent it is failing to meet, at
`intake-review-core.ts:154-157`:

> Only null/undefined counts as unclassified. An explicit `false` means a human
> already considered it and said no, and **nagging them again is how a checklist
> becomes noise people stop reading.**

That is precisely the failure mode now shipping. This is the same class of
defect 0218 was written to fix at the dock, reintroduced one step downstream.

**Compliance stake:** this is a warning-fatigue defect, not a mis-enforcement
defect. The register enforces correctly (F2), because enforcement runs off
`menu_items`. But the control that is supposed to make a human *look* is crying
wolf on already-settled work, which is exactly how a real unclassified
suppository gets scrolled past.

### F6 — DEFECT 2 (REAL, LOWER SEVERITY): the 18A correction does not reach the draft row

`admin/inventory/actions.ts` and `classification-status-store.ts` contain **zero**
references to `catalog_product_drafts` (verified by grep). So when a manager
corrects a classification on the lot page, the answer lands on `menu_items`
(enforcing — correct) and on `inventory_lots` (provenance — correct), but the
`catalog_product_drafts.chosen_*` row that originally produced it is left
holding the superseded value.

I did **NOT** prove that a stale draft can overwrite the corrected menu value.
That would require establishing whether `injectApprovedDrafts` can re-run for an
already-approved draft against a new menu version. **NOT PROVEN — must be
established before any fix is designed.** Flagging it as a question, not a fact.

> **RESOLVED during the 18E build — it cannot overwrite.** `injectApprovedDrafts`
> skips any product key already staged on the version
> (`draft-injection-core.ts:221-228`, diagnostic `draft_superseded_by_pos`), and
> a corrected product is by definition already on the menu. The defect is
> therefore **cosmetic**, and no fix was built. Full evidence, plus the
> uncomfortable corollary that this same skip blocks any accidental repair of
> Defect 3, is in `docs/slice-18e-verdicts.md`.

### F7 — The columns are NOT "dead", so "retire them" is the wrong option

The roadmap's phrase "make the dead columns live or explicitly retire them"
presumes they are dead. They are not, and dropping them would be actively
harmful:

- They are **written** on every received lot (`intake-store.ts:562-565`) and on
  every 18A correction (`actions.ts:779-782`).
- They are **read** by the dock summary (`intake-store.ts:1470`).
- They carry **CHECK constraints** that encode statute:
  `inventory_lots_low_thc_unit_ceiling` (0216) pins the 4 mg per-unit ceiling of
  WAC 314-55-095(1)(d)(i)(F), and `inventory_lots_otherwise_taken_needs_units`
  (0217) refuses a `true` flag without a unit count — the constraint 0217
  describes as "what makes the flag trustworthy".
- They are the **lot-level traceability record**. Both migrations state the
  purpose explicitly: *"Traceable to the source invoice via lot_code."*
  `menu_items` has no lot code; a product can be re-classified while old lots
  sit on the shelf. Only the lot row can answer "what did we believe about
  *this physical box* when we received it?"

Retiring them would require a `drop column` migration, would delete an audit
trail, and would break the dock read. **Recommendation: reject the "retire"
option outright, on evidence.**

### F8 — The existing test surface is substantial and must be read before touching anything

`tests/compliance/` already contains, among others:
`classification-status-parity.test.ts`, `receiving-classification-parity.test.ts`,
`otherwise-taken-truth-surfaces.test.ts` (374 lines),
`otherwise-taken-both-surfaces.test.ts`, `otherwise-taken-receiving.test.ts`,
`classification-worklist-plumbing.test.ts`, `receiving-pipeline-plumbing.test.ts`,
`low-thc-liquid-feature-parity.test.ts`, plus 18B/18C/18D's
`classification-facet-plumbing`, `classification-badge-plumbing`,
`pos-classification-visibility` and `pos-classification-plumbing`.

`migration-execution-gate.test.ts:617` already asserts on the 0216→0217
`order_lines` repair, which means **that test file is the established home for
"a column exists but nothing writes it" assertions** — the exact shape of
Defect 1.

### F9 — No migration is required for the recommended plan

Every column, constraint and index the fix needs already exists in 0216/0217/0218,
all of which Michael has applied. The recommended work is **application code
only**. Migration count stays at **218**. `todo.md` stays at **3,577**.

The one exception: the roadmap says "Document the answer in the migration
comment." A `comment on column` statement is metadata-only, but it is still a
new `.sql` file that Michael would have to apply by hand. See Decision D5 — my
recommendation is to *not* spend a migration on prose.

---

## 2. THE DECISION

### The question, restated

Is `inventory_lots.otherwise_taken` (and its three siblings) **authoritative**,
**derived**, or **retired**?

### Option A — AUTHORITATIVE (make the lot row the source of truth)

Enforcement would read flags off the lot backing each sale line.

- **For:** lot-level precision; two lots of the same SKU could differ.
- **Against, decisively:** the website has no lot context at all — an online
  cart cannot know which physical box it will be picked from. It would require
  rewriting `live-menu.ts`, `sale-flow-core.ts`, the whole cart engine and the
  order-completion gate. It would resurrect the exact failure 0218 documents:
  imported lots carry NULL flags whether or not a human classified them, so
  every Cultivera product would instantly read as unclassified and the ten-unit
  limit would stop engaging. **REJECT.**

### Option B — DERIVED / MIRROR (ratify what is already true) ← RECOMMENDED

`menu_items` remains the sole enforcement surface. `inventory_lots` is formally
designated a **write-only provenance mirror**: it records what was believed
about a specific physical lot, is never consulted to decide a limit, and is used
only for traceability and for the receiving-dock "has anyone looked at this?"
signal.

- **For:** it is what the system already does (F2, F3); it is already documented
  in code; it costs no migration; it preserves the lot-code traceability both
  migrations promise; and it makes Defect 1 a well-defined bug with an obvious
  fix rather than an ambiguity.
- **Against:** the mirror must actually be kept in sync, or it lies — which is
  precisely Defect 1. Choosing B *obligates* fixing F5.

### Option C — RETIRE (drop the columns)

**REJECT on evidence (F7).** They are written, read, constrained, and are the
only lot-level traceability record. Dropping them destroys an audit trail and
breaks the dock.

### Recommended decision

**Option B.** `inventory_lots` classification columns are a **PROVENANCE
MIRROR**: authoritative about *what we believed about this physical lot*, never
consulted to *enforce a limit*. `menu_items` is and remains the only
enforcement surface.

---

## 3. PROPOSED STRATEGY

Sequenced so that each step is independently verifiable, and ordered by
compliance value.

### D1 — Ratify the decision in a durable, test-enforced form
Write the authoritative/derived/retired answer down where it cannot rot, and
**assert on it**. A doc paragraph nobody tests is a doc paragraph that goes
stale. The assertion should be behavioural where possible: e.g. a test that
fails if any *enforcement* module gains a read of the lot-side columns.

### D2 — Fix Defect 1: close the onboarding → lot provenance gap (the real work)
Make the answer captured at Product Onboarding reach `inventory_lots` for the
lot the draft came from. `catalog_product_drafts.lot_id` already exists
(`catalog-drafts.ts:67`, `:324`) so the link is present — no schema change.

Design constraints, all derived from patterns the codebase already proved:
- The **menu write stays first and stays authoritative**. Mirror second,
  best-effort, exactly as `actions.ts:759-790` already does.
- A failed mirror must **not** fail the approval, and must be **recorded**, not
  swallowed — the `lot_row_write_failed` precedent.
- Must survive a database missing the columns (the 42703 ladder pattern).
- Must write `false` as a real value, never leave it null — `false` means "a
  human considered this", and the dock warning depends on telling that apart
  from null.

### D3 — Make the lot page show provenance honestly
Today the panel deliberately hides the lot value (page.tsx:157-163) because it
was untrustworthy. Once D2 makes it trustworthy for *received* lots, the panel
can show it as a clearly-labelled provenance line — while *still* computing
status from menu truth. This must not become a second scoreboard: enforcement
status stays menu-derived, and any lot-vs-menu disagreement should be surfaced
as a disagreement, not silently preferred either way.

### D4 — Resolve F6 (draft staleness) before deciding whether to act on it
Establish, from source, whether an approved draft can ever be re-injected over a
corrected menu value. If yes, it is a real correctness bug and belongs in this
slice. If no, it is cosmetic and should be documented and deferred rather than
padded into scope. **Do not design a fix for an unproven risk.**

### D5 — Do NOT spend a migration on prose
The roadmap asks to "document the answer in the migration comment." A
`comment on column`-only migration would move the count off 218 and put manual
work on Michael for zero functional gain. Recommend instead: document the
decision in `docs/`, and pin it with tests (D1). Raise it to Michael as his call.

> **OVERRULED BY THE OWNER, and he was right.** He asked for "the enterprise
> grade industry standard practice", and that is to put the doctrine in the
> schema: a column comment is visible in `psql \d+`, in the Supabase table
> editor and in every BI tool, whereas a markdown file is not available to
> someone holding a 2am incident. The old comment actively *misled* ("See
> `menu_items.low_thc_liquid`" reads as "these mean the same thing"), so this
> was never merely prose — it was a correction to wrong documentation living in
> the database. Migration `0219_classification_provenance_doctrine.sql` was
> written; it changes no data and no structure, and a test asserts that it
> contains nothing but `comment on column` statements. Count: **218 → 219**.

### D6 — Test doctrine for this slice
Carrying forward what 18B–18D cost us to learn:
- Text matching proves a word exists, never that a value is right. **Prove
  behaviourally.** Defect 1 in particular must be proven by *executing* the
  review-summary logic against a lot row with `otherwise_taken: false` and
  asserting the warning count is zero — not by grepping for a column name.
- Write a test **of the test**: apply the defect in memory and confirm the new
  test goes red. A regression test that passes against the broken code is
  worthless.
- Purity tests use an import allowlist that **fails closed**.
- Keep `assertNoCommentTraps()` in force; never write `/*` inside a `//` line.
- Mutation-test the new surface. **Every survivor is a test gap** — strengthen
  the suite, never soften the mutant.

### Non-goals for 18E
- No change to `menu_items` as the enforcement surface.
- No change to any statutory constant (200 mg, 10 units, 4 mg, 72 oz).
- No new category slug; `categoryToBucket('topical')` stays untouched.
- No change to `order_lines` snapshot semantics.
- No `drop column`.
- Nothing that requires the Socket AppKey / Developer ID.
- 18F (catalog defaults + safe bulk classify) stays out of scope.

---

## 4. OPEN QUESTIONS FOR THE OWNER

1. **Ratify Option B?** Confirm `inventory_lots` is a provenance mirror, not an
   enforcement source.
2. **Migration for prose (D5)?** Skip it and use docs + tests, or spend 0219 on
   a `comment on column`?
3. **Scope of D4.** If the draft-staleness question proves to be a real bug, fold
   it into 18E or keep 18E tight and schedule it separately?

### The owner's answers (recorded verbatim, for the audit trail)

1. **Option B ratified.** "Yes please ratify option B."
2. **Migration written.** "I don't mind running migrations in supabase, it's
   quick and easy. I want the enterprise grade industry standard practice for
   this one." → 0219 was written; see D5 above.
3. **Own slice, no drift.** "If it is needed, let's make it its own slice. I
   don't want to drift so adding too much to a slice might cause lost focus on
   finer details."

That third answer governed the whole build. It is the reason Defect 3 — which is
more serious than anything 18E fixes — was written up and *left alone* rather
than folded in. Discovering a bigger problem mid-slice is exactly the moment
scope discipline is hardest and matters most.

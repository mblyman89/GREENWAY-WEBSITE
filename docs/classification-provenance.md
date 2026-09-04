# Sales-limit classification: what is enforced, and what is only recorded

**Slice 18E.** This document states one rule and explains why it exists. If you
read nothing else, read this line:

> **Enforcement reads the menu. Provenance reads the lot. Never the reverse.**

The rule is also written onto the database itself, in migration
`0219_classification_provenance_doctrine.sql`, as comments on the eight columns
involved. That is deliberate: a rule stated only in a markdown file is a rule
the person holding a 2am incident does not have. A column comment shows up in
`psql \d+`, in the Supabase table editor, and in every BI tool.

## The four flags

Washington sets three separate transaction limits that depend on *what kind of
thing* a product is, not merely how much of it there is:

| Column | Statute | What it decides |
| --- | --- | --- |
| `otherwise_taken` | WAC 314-55-095(1)(d)(i)(D) | Whether the product counts against the **ten-unit** bucket (suppositories, transdermal patches and the like) |
| `units_per_package` | RCW 69.50.101 | How many units one package is, so the ten-unit bucket can be counted correctly |
| `low_thc_liquid` | WAC 314-55-095(1)(d)(i)(E)+(F) | Whether a liquid falls under the **200 mg** carve-out instead of the 72 oz bucket |
| `unit_thc_mg` | WAC 314-55-095(1)(d)(i)(F) | The per-unit milligrams that carve-out is measured against |

All four exist on **two** tables, and the difference between them is the entire
subject of this document.

## `menu_items` is the answer

The register reads these four columns off the **menu** row and nothing else
(`src/lib/pos/live-menu.ts`). When a manager corrects a classification, the
correction is written to `menu_items` first, because that is the only write that
changes what happens at the point of sale
(`src/lib/inventory/classification-status-store.ts`).

This was settled in Slice 18A and has not changed. The reasoning is recorded in
`src/lib/inventory/classification-status-core.ts`:

> `menu_items` is the ONLY surface the register enforces from. … The lot row is
> provenance, not the answer.

## `inventory_lots` is the paper trail

The lot-side columns record what **this physical lot's receiving paperwork
said**, traceable to the source invoice via `lot_code`. Nothing reads them to
decide a limit.

They are not dead, and they were considered for removal and kept on evidence
(see `docs/slice-18e-recon.md`, Finding 7). They are written by the receiving
path, read by the receiving dock summary, constrained by `CHECK`s in 0216/0217,
and they are the only per-lot record of what the invoice claimed. A product can
be re-classified on the menu at any time; what the paperwork said when the
goods came through the door is a historical fact and does not change.

### Why the old comment was a hazard

Before 0219 the lot columns were commented, in full:

```
SLICE 16. See menu_items.low_thc_liquid. Traceable to the source invoice via lot_code.
```

"See `menu_items.low_thc_liquid`" reads as *these two columns mean the same
thing*. A reader who believed that could write the lot column, watch the write
succeed, and change nothing whatsoever at the register — a silent no-op in a
compliance system, which is the worst category of defect because it is
invisible and confidently wrong.

## What Slice 18E changed

**1. The doctrine is now in the schema.** Migration 0219 rewrites the four
lot-side comments to say "PROVENANCE MIRROR — NOT ENFORCEMENT" and states the
matching enforcement role on the four `menu_items` comments, so the rule is
legible from either end. The migration changes no data and no structure; a test
asserts that it contains nothing but `comment on column` statements.

**2. The mirror is actually written.** Until 18E the classification a human
answered at Product Onboarding never reached the lot row at all. The receiving
insert always writes `null` there (a Washington manifest has no such field), and
the real answer arrived later, at approval — and stopped at the draft and the
menu.

That mattered because the receiving dock reads `otherwise_taken` to tell *nobody
has classified this yet* from *somebody already answered*, and warns only while
it is `null`. Since it could never stop being `null`, the suppository warning
could never be silenced — on the very product a human had just classified. The
comment in `intake-review-core.ts` says why that is not cosmetic:

> nagging them again is how a checklist becomes noise people stop reading.

`src/lib/inventory/classification-mirror-core.ts` now decides what to mirror,
and `catalog-drafts.ts` performs the write **after** the authoritative one, as
best-effort, recording success or failure in the audit trail. It can never fail
an approval: by that point the classification is already saved where it counts,
and aborting would tell the owner nothing was recorded when in fact the register
is enforcing the new answer.

**3. Disagreements are reported as disagreements.** Because a lot can now hold
a real answer, it can hold one that contradicts the enforced answer.
`classification-disagreement-core.ts` detects that and the lot page says so
plainly, naming the menu as the copy in force.

## The `null` / `false` distinction is load-bearing

For `otherwise_taken` there are three states, not two:

- `null` — nobody has answered. The dock **should** nag.
- `false` — a human considered it and said no. The dock must **go quiet**.
- `true` — a human said yes. The ten-unit limit engages.

A mirror that skipped `false` because it looks falsy would leave the row at
`null` and fix nothing. So `otherwise_taken` is mirrored on **every** approval.

The low-THC pair is treated the **opposite** way, deliberately. There silence is
safe: an unclassified liquid simply keeps the *tighter* 72 oz limit, so writing
a `false` nobody said would invent a claim to no benefit. Those two are mirrored
only when actually answered.

The asymmetry is not an inconsistency — it follows the direction each fail-safe
points, which is the only principle that keeps both honest.

## Rules for future work

1. **Never** decide a limit from an `inventory_lots` column. A limit decided
   from a lot row is a limit that ignores the manager's correction.
2. When adding an enforcement path, read the flags from `menu_items`.
   `tests/compliance/classification-provenance.test.ts` fails closed if an
   enforcement module starts reading `inventory_lots`; the fix is to route the
   read through the menu, **never** to add the module to an exception list.
3. Write the menu copy first and treat the lot mirror as best-effort. Record
   mirror failures; never fail the user's action over one.
4. Never coalesce `null` to `false` on the lot side.

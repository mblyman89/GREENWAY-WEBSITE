# DEFECT 3 — receiving a product erases every sales-limit classification

**Found during Slice 18E recon. NOT fixed in 18E. Proposed as its own slice (18G).**

## Numbering key (read this first)

`docs/slice-18e-recon.md` was written before this defect was found, and it
numbered only two. To keep the record honest rather than rewrite a document the
owner has already read, the new finding was given the **next** number. The three
defects of the 18E round are:

| # | Name | Where it is described | Status |
| --- | --- | --- | --- |
| 1 | The receiving dock's suppository warning can never be silenced | recon F5 | **FIXED in 18E** |
| 2 | The 18A correction does not reach the `catalog_product_drafts` row | recon F6 | **Investigated in 18E — cosmetic, not a correctness bug.** See `docs/slice-18e-verdicts.md` |
| 3 | Receiving a product erases every sales-limit classification | this document | **NOT fixed. Proposed as slice 18G** |

Defect 2 is the *lower*-severity one despite the numbering; the numbers record
discovery order, not severity. Defect 3 is by far the most serious of the three.

---

Every claim below is machine-verified by `scripts/slice18e/verify-defect3.sh`,
which asserts 34 citations against the real files and exits non-zero on any
mismatch. It currently reports **34 passed, 0 failed**. The script also carries
a test-of-the-test: injecting a one-line fix into the carry-forward mapping
flips it red, so it detects the defect rather than always passing.

---

## In one paragraph, in plain English

Every time a product is received and approved, the system rebuilds the live menu
by copying the current menu forward and adding the new product. That copy is
made field by field — and the four compliance classification columns are not in
the list of fields it copies. So they are silently dropped, the rebuilt menu is
published automatically, and **every classification in the shop reverts to
"nobody has answered"**. The ten-unit suppository limit and the low-THC beverage
carve-out stop applying, at the register, with nothing shown on any screen.

It is not a rare edge case. It fires on the ordinary act of receiving goods.

---

## Why this is worse than Defect 1

Defect 1 (fixed in 18E) was **warning fatigue**: the receiving dock could not
stop nagging about a product a human had already classified. Annoying and
corrosive, but nothing was mis-sold.

Defect 3 is a **compliance fail-open**: a statutory limit that a human correctly
set stops being enforced, and the system reports no error. The failure is
invisible because every screen keeps working and the menu looks normal — the
four flags simply read `null` again, and `null` means "treat it as an ordinary
product".

---

## The chain, link by link

**1. `menu_items` is what the register enforces from.**
`src/lib/pos/live-menu.ts:94-100` reads all four flags off the menu row and
hands them to the cart engine. `null` is the fail-open: migration 0216 states
"NULL = not yet classified; the engine treats NULL as a normal liquid."

**2. Classifications really do get written there.**
`classification-status-store.ts:223-226` (the manager's correction) and
`draft-injection.ts:276-279` (onboarding) both write the four columns. So there
is real, human-supplied data to lose.

**3. The carry-forward drops them — in three places at once.**
When a manifest is received, or any catalog draft is approved,
`stageIntakeMenuVersionForManifest()` builds a fresh menu version: the currently
published items carried forward verbatim, plus the newly approved products.
"Verbatim" is implemented as an explicit field list, and the four columns are
absent from all three layers:

| Layer | File | Evidence |
| --- | --- | --- |
| DB read | `intake-menu-staging.ts:559-599` | maps ~25 fields; none of the four |
| Type | `intake-menu-staging-core.ts:71-163` | `CarryForwardItem` / `StagedSnapshotItem` have no such field |
| Pure mapper | `intake-menu-staging-core.ts:264-307` | `carryForward()` copies none of them |
| DB write | `intake-menu-staging.ts:615-660` | the insert omits them → new rows are `NULL` |

The read itself uses `select("*")`, so **the data is available** — the loss is
purely in the mapping. That makes the fix cheap and local.

The control case proves this is a gap rather than a style: `servings_per_pack`
and the other Slice 62 structured facts *are* carried, with a comment saying
they must be, "so a new intake snapshot never wipes facts an earlier import
earned". The same reasoning applies to the compliance flags and was simply never
extended to them.

**4. The lossy snapshot goes live automatically.**
`intake-menu-staging.ts:327` inserts the rows and `:362` calls
`autoPublishIntakeVersion(...)`. This is not a staged draft awaiting review — it
becomes the published menu.

**5. Routine actions trigger it.**
`catalog-drafts.ts:806` (approving any draft) and `intake-store.ts:1263`
(receiving a manifest). Both are everyday operations.

**6. Nothing repairs it afterwards.**
The Cultivera import path never writes the four columns either
(`import-service.ts` contains no reference to any of them), so a later import
cannot restore them. The only code that re-applies a classification is
`applyClassificationToMenu`, and its single caller is the human-triggered form
on the lot page. There is no automatic reconciler.

---

## What it looks like in the shop

1. A box of suppositories is received and correctly classified as *otherwise
   taken into the body*, 6 units per package. The register now enforces the
   ten-unit limit.
2. A week later, an unrelated delivery arrives and one product is approved.
3. That approval rebuilds and republishes the menu. The suppository's
   `otherwise_taken` is now `null`.
4. The ten-unit limit no longer applies. The product is sold under the ordinary
   topical limit. No error is raised anywhere.

The same applies to every low-THC beverage carve-out in the shop.

---

## Why it was not fixed inside 18E

The owner's instruction for this round was explicit:

> "if it is needed, let's make it its own slice. I don't want to drift so adding
> too much to a slice might cause lost focus on finer details."

18E was scoped to ratifying the provenance doctrine and closing the
onboarding→lot gap. Defect 3 sits in a different subsystem (menu version
staging), has a different blast radius (the whole published catalog), and needs
its own test design — in particular a decision about **repairing existing data**,
since classifications may already have been silently erased in production.

Folding it in would have been exactly the drift he asked to avoid.

---

## Proposed scope for slice 18G

1. Carry the four columns through all three layers (read → type → mapper →
   write), mirroring how the Slice 62 structured facts are already handled.
2. A fails-closed test that every enforcement-relevant `menu_items` column
   survives a carry-forward — asserted **behaviourally**, so a future column
   cannot be forgotten in the same way. This is the real deliverable: the
   specific bug is easy, the class of bug is what keeps recurring.
3. Decide and document what to do about rows already erased in production
   (a read-only report first — never a silent bulk write).
4. Mutation-test the guard by deleting each column from the carry list and
   confirming the suite goes red for each one.

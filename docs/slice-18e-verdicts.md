# Slice 18E — verdicts on the two questions the recon left open

The recon (`docs/slice-18e-recon.md`) deliberately shipped with two claims marked
**NOT PROVEN**, because the standing rule is *do not guess, do not assume; build
from fact, not memory*. A recon that quietly guesses is worse than one that says
"I do not know yet", so both were carried forward as open items rather than
written up as findings.

This document closes them. Both were investigated during the 18E build. Every
line number below was read out of the working tree at the time of writing, not
recalled.

---

## Verdict 1 — Defect 2 (draft staleness) is real but **cosmetic**, not a
correctness bug

### The question

Recon F6 established, by grep, that a manager's classification correction on the
lot page updates `menu_items` and `inventory_lots` but never touches the
`catalog_product_drafts.chosen_*` row that originally produced the product. The
draft is therefore left holding a superseded answer.

The recon refused to call that a bug, because the severity depends entirely on a
question it had not yet answered:

> "I did **NOT** prove that a stale draft can overwrite the corrected menu value.
> … **NOT PROVEN — must be established before any fix is designed.**"

If an approved draft can be re-injected onto a later menu version, the stale
value would silently overwrite the manager's correction and the register would
go back to enforcing the wrong limit. That would be severe. If it cannot, the
stale row is merely untidy history.

### The answer: it cannot overwrite. The injector skips keys already present.

`injectApprovedDrafts` does not blindly write every approved draft onto the new
version. Before injecting, it checks whether the POS export has already staged a
row for that product key, and if so it **skips**:

```
draft-injection-core.ts:221    if (inputs.existingKeys.has(key)) {
draft-injection-core.ts:224      code: "draft_superseded_by_pos",
draft-injection-core.ts:228      continue;
```

The diagnostic is named `draft_superseded_by_pos` — the code itself states the
precedence: the POS row supersedes the draft, not the other way round.

`existingKeys` is built from the rows already staged on the version being built:

```
draft-injection.ts:143    .from("menu_items")
draft-injection.ts:151    const existingKeys = new Set(stagedRows.map((r) => r.source_item_id));
```

So for a product that already exists on the menu — which is necessarily true of
any product a manager has corrected, since you cannot correct a classification
on a product that is not there — the draft is skipped and its stale `chosen_*`
values are never read into a write.

**Injection cannot clobber a correction. Defect 2 is cosmetic.**

### Why it is still worth writing down

Two reasons, and neither is "for completeness".

First, the safety here is **incidental, not intentional**. Nothing in the skip
was written to protect classifications; it exists because the POS export is
treated as the more authoritative description of a product. We are relying on a
guard that was installed for an unrelated reason. That is worth knowing, because
a future change to injection precedence — perfectly reasonable on its own terms —
would silently convert a cosmetic defect into a compliance one.

Second, the skip only holds while the corrected product is present on the
version being staged. That is guaranteed today by the carry-forward, which
copies every published item onto the new version. Which leads directly to the
uncomfortable observation below.

### The interaction that makes Defect 3 worse, not better

The injector's insert **does** write all four classification columns:

```
draft-injection.ts:276    low_thc_liquid: it.low_thc_liquid,
```

with a comment recording that this was Slice 18-0's fix for exactly this class of
bug. So one might hope injection would repair the erasure described in Defect 3.

It does not, and the reason is the skip above. Injection only writes a row for a
product that is **not** already staged. A product erased by the carry-forward
*is* staged — it is present on the new version, just with four `NULL`s. So the
injector skips it and the erasure stands.

The guard that protects us from Defect 2 is the same guard that prevents any
accidental repair of Defect 3. This is recorded here so that whoever builds 18G
does not waste a day hoping the injector will do the work for them.

### Recommendation

No code change in 18E. If the draft row is ever made to follow the correction,
it should be for provenance tidiness — and it should be done with the same
doctrine as the lot mirror: written after the authoritative write, best-effort,
never able to fail the user's action. It is explicitly **not** urgent.

---

## Verdict 2 — the POS import path has **no** classification defect; the
suspicious code is a test fixture

### The question

Recon left open whether `import-commit-core.ts` drops the four classification
columns, because it contains four literal `null` assignments to exactly the
fields under investigation:

```
import-commit-core.ts:269    lowThcLiquid: null,
```

with `unitThcMg`, `otherwiseTaken` and `unitsPerPackage` on the three lines
following. In a module on the import path, four hard-coded `null`s on the four
compliance flags is precisely the shape of the defect being hunted.

### The answer: those lines are inside the module's own self-test

The enclosing function is:

```
import-commit-core.ts:239    export function __runImportCommitCoreTests(): void {
```

The `null`s are at line 269 — inside that function, in an `item()` fixture
builder used to construct sample rows for the self-test. They are test data, not
a live write path. A comment immediately above them explains why they are
spelled out at all: they must be listed *before* the `...over` spread, or the
`Partial` widens the field type and the fixture stops satisfying
`FactReviewItemInput`. It is a TypeScript ordering constraint, not a data
decision.

Confirming the negative: `lowThcLiquid` and `otherwiseTaken` appear in this file
**only** at lines 269 and 271 respectively. There is no other reference — so
there is no production code path in this module that touches the flags at all,
correctly or otherwise.

**No defect. No change required.**

### Why this one is worth writing down too

Because it is the exact case the standing rule exists for. A grep for
`otherwiseTaken: null` produces a hit that looks damning, and a reviewer working
from pattern-matching rather than from reading the enclosing scope would have
filed a bug, or worse, "fixed" a test fixture and broken its type contract.

The rule *do not guess, do not assume* is usually invoked to stop us claiming
something works. It applies with equal force to claiming something is broken. A
false defect costs real time and erodes trust in the rest of the report.

---

## Summary

| Open item | Verdict | Action in 18E |
| --- | --- | --- |
| Defect 2 — stale `catalog_product_drafts.chosen_*` | Real, but **cannot** overwrite a correction (`draft_superseded_by_pos` skip) | Documented. No fix — not urgent |
| POS import path drops the flags | **Not a defect** — the code is a self-test fixture | None |
| Bonus finding | The Defect 2 skip also blocks any accidental repair of Defect 3 | Recorded for slice 18G |

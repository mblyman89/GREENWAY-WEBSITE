# Slice 18 — Restore to sale: the undo the 86 button never had

**Requested by:** Michael Lyman, Greenway Marijuana, Port Orchard WA.

> "I will test that while you build the proper restore to sale button."

This closes Defect C, which Slice 16 found, documented and deliberately left
open for its own slice. The register could take a product off sale in one press.
Nothing anywhere could put it back.

Everything below was established by reading the code in this repository. There
are no database credentials in the environment this work was done in, so
nothing here rests on a live query, and nothing here rests on a guess. Every
claim carries the file and line that supports it, and every fix carries the
test that fails when the fix is removed.

## The defect, in the code's own words

`src/app/api/pos/stock-flag/route.ts` is the endpoint behind the register's 86
button. It writes `inventory_status = "unavailable"`. Its header says, at lines
6 to 8, exactly what it intends:

> ONE-WAY by design — the register can kill a … bringing an item back is a
> back-office action (intake/receiving or menu edit).

The design instinct there is sound. A register standing on a sales floor should
not be able to conjure inventory into existence. The problem was never that
sentence. The problem was that the back-office action it promises did not
exist. Slice 16's recon searched the whole of `src/app/admin` for anything that
wrote `inventory_status` back to a sellable value and found nothing. So every
86 was permanent, and the only recovery was a database edit.

That is the gap this slice fills, and it fills it without giving away the
property the original header was protecting.

## The rule: restoring recomputes, it never asserts

The obvious implementation is a button that sets `inventory_status` to
`"in-stock"`. That would be wrong, and it would quietly reintroduce the exact
risk the one-way design was built to prevent — a click that manufactures
inventory that is not on the shelf.

So restore does not write a status anyone chose. It counts what is actually
there and writes what that count implies. `sellableUnits()` sums **ACTIVE lots
only**, so quarantined and destroyed stock is not counted, and quantities are
coerced defensively: PostgREST's numeric-as-string is parsed, and anything
unparseable or negative counts as zero, because an unreadable quantity is not
evidence of stock. The total then goes through the same `statusForUnits()` the
rest of the system already uses, at
`src/lib/pos/register-availability-core.ts:141-145`: nothing at or below zero is
`unavailable`, three or fewer is `low-stock`, and above that is `in-stock`.

The consequence is the important part. Press restore on a product whose shelf is
genuinely empty and it does not come back. It recomputes to `unavailable`, no
write happens, and the message says so — that the lots are empty and it will
return on its own when stock is received. The button cannot lie about inventory,
because it is not the thing deciding.

## What outranks stock

Two things sit above the count, and they refuse regardless of how full the shelf
is.

An **AN-7 recall hold** blocks a restore outright. The recall check calls
`recalledProductKeys({ failClosed: true })`, and the `failClosed` flag matters
more than it looks: it makes a truncated or failed recall read **throw** instead
of quietly returning an empty set. Putting a product back on sale is precisely
the moment never to assume "probably not recalled". If that check cannot be
completed, the restore refuses and says it could not confirm the product is free
of holds.

A **hidden card** also blocks it. Hiding a product is a separate, deliberate
decision, and restoring stock must not silently undo it.

The lot read is treated the same way. It is paged, because PostgREST caps a
response at 1,000 rows regardless of `.limit()`, and a product with many lots
must not be judged on a truncated read. If any page fails, a local
`lotReadFailed` flag makes that explicit and the whole operation refuses rather
than deciding on partial facts. A failed read must never be mistaken for "no
stock", because that would produce a confidently wrong refusal.

And a card that was never flagged is left alone. Restore only acts on a card
whose current status is `unavailable`, so it can never clobber a live status.

## Where the button lives

It appears on the back-office inventory page, directly beneath the Slice 16
register-parity banner, and only when there is something to act on. The
`restorable` list is computed in
`src/lib/inventory/register-sellability-store.ts` from the same facts that
banner already gathers, so it costs no extra queries. It skips anything that is
not `unavailable`, anything recalled, anything hidden and anything with zero
sellable units — which means the page never offers a button that would refuse if
pressed. The list is sorted by unit count and capped at
`RESTORABLE_DISPLAY_LIMIT = 25`.

Each entry is a plain form posting to the `restoreProductToSaleAction` server
action, which requires the `inventory.manage` permission, then revalidates both
`/admin/inventory` and `/menu` so the shelf and the public menu agree
immediately. The button says what it will do before it does it — *Restore to
sale → in-stock* or *→ low-stock* — because the status is computed from live
units and can be shown in advance.

Every successful restore writes an audit row, `inventory.restore_to_sale`,
carrying the previous status, the new status, the sellable unit count and the
active lot count. It mirrors the shape of the `pos.stock_flag` audit the 86
writes, so the kill and the undo read as one story in the log rather than two
unrelated events. The previous status is snapshotted **before** the write, so
the record cannot be corrupted by the update it is describing.

## How this was verified

`src/lib/inventory/restore-to-sale-core.ts` is pure and self-testing: 31
assertions, run in CI by `scripts/compliance/run-pure-selftests.ts`.

`tests/compliance/restore-to-sale.test.ts` holds 17 tests that drive the **real**
`restoreProductToSale` against a PostgREST-shaped fake which honours `.range()`
paging. The assertion surface is what was actually written and actually audited,
not what the function returned about itself.

Building that fake surfaced a genuine defect, and it is worth recording. The
first version returned live row objects from its `select`, so the later `update`
mutated a row the store had already read, and the audit's `previousStatus` came
out as the *new* status. A real PostgREST client returns JSON-deserialized
copies and can never do that, so the fake was corrected to return copies — and
the store was hardened as well, snapshotting the previous status before the
write so the audit cannot depend on reference semantics at all. Both halves were
fixed, because the fake being wrong did not make the store's fragility
acceptable.

The tests were then proven capable of failing. Nine mutations were applied to the
shipped source, one at a time, and every one was caught: hardcoding `"in-stock"`
instead of recomputing (5 failed), ignoring the recall hold (2), ignoring the
hidden flag (2), counting quarantined lots as sellable (2), accepting a partial
lot read (1), reading a failed recall check as "not recalled" (1), restoring a
card that was never flagged (2), auditing the post-write status as the previous
one (1), and reporting a failed write as success (1). The source was restored
and confirmed byte-identical afterwards.

Type-check is clean, ESLint reports zero problems on every touched file, and the
full suite passes at 568 files and 14,342 tests.

## What this means at the counter

If something gets 86'd by mistake, it is now a button in the back office instead
of a phone call. If it gets 86'd correctly and the shelf really is empty, the
button will tell you so rather than pretending. And if the product is under a
recall hold, nothing brings it back until the hold is lifted — which is the one
case where the old behaviour of "no undo at all" was accidentally right, and is
now right on purpose.

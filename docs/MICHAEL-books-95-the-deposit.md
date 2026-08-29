# The cash finally arrives at the bank

Michael — last slice made every reconciled drawer put its counted cash into an
account called **10400 Undeposited Funds**. This slice built the other half:
the entry that takes it back out when the bank confirms the money landed.

## Why this had to be next, and not something newer

When I surveyed before choosing, I found that 10400 was only ever going **up**.
Nothing anywhere took money out of it. Every entry balanced, nothing errored,
no screen turned red — and the balance would have climbed every trading day
forever. The moment we read your real bank balance alongside it, the same
dollar would have been counted twice: once sitting in 10400 because nothing
cleared it, once in 10200 because the bank actually has it. Cash on the balance
sheet would have read high, by a number that grows.

That is written down as **D-75**, and it produced a new standing rule: a
half-loop is a defect, not a milestone. Shipping one direction of a money
movement is not "half done" — it is a working mechanism that produces a wrong
number, and it gets wronger with use.

## What it does

When a deposit shows up in the bank feed, it debits **10200 Bank — Operating**
and credits **10400**. No income line, because the sale was already recorded
when it was rung up; recording it again would double your day. It refuses
thirteen ways when the two sides do not plausibly describe the same money —
including a deposit larger than what was counted out of the tills, which is the
one that would push 10400 below zero and claim more cash left the drawers than
was ever in them. It will not clear an empty pool, will not touch a pending or
pre-2026 row, and will not accept an ATM settlement or a transfer between your
own accounts as till cash.

Your end-of-day page now shows the balance, with the two questions it should
provoke printed next to it: either deposits are reaching the bank and nobody is
matching them here, or cash was counted out of a drawer and never banked. An
account only a developer can query is not a control.

## The sign

A backwards bank match still balances perfectly. That already happened once in
Sage. So the negation is delegated to the single sanctioned function that
crosses between the bank feed's convention and the ledger's, never hand-rolled,
and I broke the code on purpose 36 different ways — every sign flip, both
account swaps, both one-cent boundary loosenings, and four that cut the panel
off the screen. All 36 were caught. Two of those four initially were **not**:
the tests were reading source text, and the word they looked for survived in
the import line. They now render the actual panel. That is rule 141.

## Are we drifting? No.

Slice C (the recon findings) and slice A (the W-2/W-3 engine) are complete.
Slice D — the generalized forms builder you promoted yourself — is what these
ledger slices feed, and the wiring campaign we are in was authorized by you
directly. Slice B stays deliberately last, because it depends on Form 7203 and
basis, which needs the books to be right first. Nothing here was invented; each
slice has been the direct consequence of the one before.

## Should we fix defects before continuing? One, and it is now fixed.

D-75 was the only thing I would have stopped for, and stopping for it *was*
this slice. Nothing else open blocks the next step.

## Everything still to build and wire

You asked for the full list. There are 37 money events the books need. **14**
now reach the ledger. Here is the rest, honestly:

**Nothing builds these yet (16).** Excise liability split; discounts and comps;
refunds and returns; freight-in; purchase-order commitments; vendors paid by
ACH; net pay disbursed; payroll taxes remitted; garnishments remitted; ATM
vault loads; excise tax remitted; depreciation; crypto activity; period close;
reversals; opening balances.

**Built but not wired — a builder exists, nothing calls it (7).** Cutover
inventory load; Cultivera manifest import; till open from the vault;
intercompany transfers; B&O tax accrual; fixed asset acquisition; loan
activity. These are the cheapest wins left, because the hard part is done.

**Working but incomplete (6).** Inventory receipt, goods received, vendor bill
recorded and payroll accrual all post correctly but are not yet married to the
bank feed. Expense classification needs its duplicate guard. Till close now
posts but is not matched to named sessions.

**Not yet decided, not code.** Entity structure and the legal work you set
aside; the November 1 POS cutover and the October 31 audit inventory; parallel
running against Sage to year end; payroll and clock-in on January 1.

## The state of it

501 test files, 12,789 tests, all passing. TypeScript clean, lint clean, the
ledger census regenerated and verified against the code. 75 defects recorded,
141 standing rules. Nothing was checked against your live database, because
there are no credentials in this environment.

*This report runs past one page on purpose. You asked for the complete
remaining inventory and I would rather give you the whole list than a tidy
page with things left off it.*

# The system now knows the difference between free and unknown

**books-92 · Greenway Marijuana · prepared for Michael Lyman**

Your correction was worth more than the slice it corrected. You told me cost
lives in the JSON and the invoice, sometimes on the manifest, and that samples
are the one lawful exception. I went looking for how the code handled that
distinction, and the honest answer is that it didn't handle it at all.

## What was actually wrong

Both the bill engine and the vendor payments screen worked out what a lot cost
the same way: take the unit cost, and if there isn't one, call it zero. That
sounds harmless. It answers *how much* without ever asking *do we know*. Three
completely different lots came out as the same number — a free trade sample, a
purchased lot nobody had keyed the price for yet, and a genuine zero.

Your database has known which lots are samples since the beginning. The column
is filled in at intake. Neither the bill engine nor the payments screen was
reading it.

Here is why that mattered more than the missing entry you reported. A delivery
where *nothing* was priced refused outright, so it looked like the system was
working. But a **mixed** delivery — some lots priced from the invoice, some not
yet keyed — quietly dropped the unpriced lots and recorded a bill for the rest.
The payable came out short. The inventory value came out short. Short inventory
means short cost of goods sold, and under 280E that means your **taxable income
comes out too high**. You would have overpaid. And because the entry still
balanced to the penny, nothing anywhere would have flagged it. A wrong number
that balances is the worst kind there is, because it never asks for attention.

## What it does now

Every incoming lot gets sorted into one of three answers, by a single piece of
code that both the ledger and the payments screen now ask — because if they each
decided separately, they would eventually disagree with each other about money.

A **free sample** owes nothing and never touches a bill. A **priced** lot gets
billed. A lot with **no cost keyed yet** stops the entire bill and tells you
exactly which lots to go fix, quoting them by lot code. It will not post the
priced half. Recording part of a delivery is worse than recording none of it,
because you would end up with a believable number instead of an obvious gap.

The sample check runs first, deliberately. A sample genuinely has no cost, so
asking "is the price missing?" before "is this free?" would have flagged every
sample delivery you ever take as an error.

Two smaller things follow from that. A sample-only delivery now says so plainly
— that no payable is due and this is the correct outcome — instead of telling
you to go find prices that don't exist. And on the vendor payments screens,
where money actually leaves, any manifest with unpriced lots now carries a
warning that the total is incomplete. Without that last piece you could have
been looking at a confident-looking total on one screen while the ledger was
refusing that very same delivery.

## What you can see, and what I have not proven

The worked example on the drafts page now has a third lot on the truck:
`SPEC-SAMPLE-003`, two units, no cost, marked as a sample. A new table shows
each lot and what it did to the bill — billed, or free and owing nothing. The
entry total is unchanged at $20,400.00, and that is the proof rather than my
say-so: the sample rode along and moved the bill by nothing.

Verification: 498 test files, 12,633 tests, all passing, types and lint clean. I
broke this fix on purpose 26 different ways — billing samples, treating unknown
costs as free again, cutting the warning off before it reached your screen — and
the tests caught **all 26**.

What I have not proven: nothing here has run against your live database, because
this environment has no credentials for it. And one line inside the payables
lookup can only execute with a real database connection, so it is verified by
inspection rather than by test. I have written that limitation into the test
file itself rather than let it look fully covered.

Recorded as defect D-72 and standing rule 135. When you next accept a delivery,
a mixed or unpriced manifest will now tell you which lots need costs — on the
manifest timeline, permanently, not just in a message that disappears.

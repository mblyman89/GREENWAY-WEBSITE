# How the best of the best actually do this

Michael — you were right to stop me. I researched Oracle Retail Xstore (the
point-of-sale that runs a large share of enterprise chain retail), the ERP
deposit patterns, the IRS's own structuring manual, and the cannabis-specific
cash vendors. Two findings matter. One says **do not build what you asked
about**. The other says **we are missing a piece**.

## Finding 1: the pros do NOT match deposits to tills

This was your question, and the answer is a clear no. Oracle Xstore runs cash
in three layers, not two:

**Till → Store Safe → Bank Deposit.**

A till is counted and *reconciled into the store safe*. The bank deposit is
then prepared **from the safe**, not from any till. The deposit is a
safe-level event. Xstore's own manual is explicit that "deposits from the
reconciled till are made to the store safe," and the bank deposit function
lives under **Store Safe Maintenance** — a different menu from till
management entirely.

So the thing we recorded in our census as a shortcoming — "the deposit is
attributed to business days, not to named register sessions" — is not a
shortcoming. **It is the enterprise pattern.** Nobody ties a bank credit back
to a specific cashier's drawer, because cash is fungible the moment two
drawers are counted into one safe, and pretending otherwise creates false
precision.

Employee accountability is real, but it lives somewhere else: in the
**over/short at reconcile time**, per named cashier. Xstore calls this "Till
Accountability" mode — a till is assigned to a *named person*, follows that
person to whatever register they work, and is counted at handoff, so every
transfer of custody is a checkpoint. That is where you catch a person. The
deposit is where you catch the *bank*. Two different controls, two different
places. We currently have the over/short account (50920) but tills are not
yet assigned to named people — that is the real gap, and it is a payroll-era
item, not a deposit item.

## Finding 2: the unit is the BAG, not the day

Here is what we are missing, and it is a genuine adjustment.

Xstore identifies every deposit bag with a **unique scannable ID** and runs it
through a four-state lifecycle: **Available → Undeclared → Counted →
Deposited → Available**. A bag is atomic — "all the money that is in a safe
bag is used in the function... There is no option to use only half the money."
One currency per bag. When a bag goes to the bank it is marked *Deposited*,
and its amount and currency go blank in the store's own records because, as
the manual puts it, "this money is not in the store any longer." There is even
a **Return Safe Bag** function for when the physical bag comes back from the
night drop.

There is also a control I want to steal outright: cash pulled from a drawer
into a bag is **Undeclared** until it is counted into the safe, and until then
"that cash is still a part of the drawer." You cannot close the register with
an undeclared bag outstanding. That single rule prevents the most common cash
fraud in retail.

Why this matters for us: we keyed the deposit pool on **business day**. For
your procedure a bag *is* a day, so nothing we built is wrong. But the bag ID
is the durable identifier, and it does something the date cannot — it makes
"oldest first" **a fact instead of a convention**. Right now our code honestly
admits FIFO is a guess about which bag you handed the teller. With a bag ID on
the deposit slip, it stops being a guess. That retires a stated weakness
rather than papering over it.

The cannabis vendors confirm the same shape from the other direction: the
smart-safe programs sell a **three-way match** where "the smart safe count,
the pickup manifest, and the bank deposit should all reference the same
transaction identifiers." Same idea — a shared ID is what makes reconciliation
take minutes instead of hours.

## Finding 3: the $10,000 question, answered from the law

You asked whether multiple sealed bags is a workaround. I read the IRS's own
structuring manual (IRM 4.26.13) and FinCEN's aggregation ruling, and I need
to correct something implied in my earlier answer.

**Multiple bags is not a workaround, because there is nothing to work around.**
Three points:

1. **The CTR is the bank's paperwork, not yours.** A CTR being filed on your
   deposit is routine and harmless. It is not a penalty, an audit trigger, or
   a mark against you. *Wanting to avoid one* is what creates the crime.

2. **Splitting cannot evade it anyway.** FinCEN Ruling 2003-1 confirms a bank
   aggregates multiple same-day transactions by the same person. Two bags
   totalling $14,000 handed over the same day are one $14,000 reportable
   transaction. The regulation reaches "one or more transactions... in any
   amount... on one or more days."

3. **Purpose is the entire offense.** Structuring requires acting "for the
   purpose of evading" reporting. The IRM instructs examiners that "accounting
   entries are not evidence of a structuring violation," and that a violation
   needs all four of: structured to avoid a CTR, knowledge of the rules, **no
   legitimate purpose**, and material amounts. It even tells examiners to
   "eliminate legitimate reasons for the pattern," giving the example of an
   insurance policy capping cash on site.

Your procedure has an obvious legitimate purpose — one bag per business day so
each deposit matches the day that produced it — and that purpose is now
documented in the source code, dated, with your own words. That is exactly the
evidence an examiner is told to look for. **Your daily-bag plan is the safe
plan, and it is safe because the bag size is decided by the day's sales, not
by the threshold.**

But here is the control worth building. The IRM lists the examiner's own test:
"Does currency fluctuate to keep the deposit at or below $10,000?" We can run
that test on ourselves. If a deposit lands under $10,000 while undeposited
cash on hand is *over* $10,000, that is the shape that draws attention — and
you would want to know, because the innocent explanation (a missed bank run) is
also the one that makes the pattern look deliberate over time.

## What I recommend we adjust

Three things, smallest first:

**A. Add a deposit bag with an ID.** One bag per business day, as you planned,
but the bag carries a number that goes on the deposit slip and into the books.
This upgrades FIFO from convention to fact and gives you the three-way match
the enterprise vendors sell. Low cost — we already fold by day, and a bag is a
day.

**B. Add the bag status lifecycle and the undeclared-bag block.** A bag cannot
be deposited twice, and a shift cannot close with cash pulled but never
counted in. This is the anti-fraud control, and it is nearly free once the bag
exists.

**C. Add the structuring self-check as a warning, not a refusal.** Consistent
with your last decision: post it, flag it, explain it.

And one thing to **stop** worrying about: matching deposits to individual
tills. The best of the best do not do it, and we should record that we
deliberately do not either — with the Oracle citation, so the next person to
ask gets the answer instead of building it.

Tell me which of A, B, C you want and I will build the next slice around them.

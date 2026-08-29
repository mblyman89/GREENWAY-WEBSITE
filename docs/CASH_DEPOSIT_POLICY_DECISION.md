# Cash deposit cadence — the decision, and why

**Status:** Michael's proposal, answered books-96 planning. Recorded because a
verbal answer to a legal question is worth nothing six months from now when
somebody asks why the books look the way they do.

---

## What Michael proposed

> "I am not opposed to having the current days sales be put into a deposit bag
> with a deposit slip in it ready for me to take to the bank. Then I could
> easily make a trip to the bank 3 times a week to keep cash on hand low. You
> just stated above it's a crime to break apart deposits so they are less than
> 10k. My daily sales are rarely over 10k. So would multiple sealed deposit
> bags be considered a work around to the 10k deposit issue?"

## The answer: no, and the reason matters more than the answer

Structuring under **31 U.S.C. § 5324(a)** turns on a single phrase. The statute
prohibits certain acts *"for the purpose of evading the reporting requirements
of section 5313(a)."* The offence is not "making deposits under $10,000." It is
**making them in that shape in order to keep the bank from filing.** The dollar
pattern is evidence of the purpose; it is not the crime by itself.

That distinction is the whole answer to Michael's question. One-bag-per-day
banked three times a week is not a workaround, because **the purpose is
operational, not evasive**: it exists so each deposit equals one known day of
sales, so cash does not sit in a house, and so a shortage is found in days
rather than a fortnight. A deposit slip that matches a single day's Z-report is
the opposite of concealment — it is a better audit trail than the lump sum.

**But it must actually be the reason.** If the cadence were chosen to keep the
bank quiet, the identical deposits would be the identical crime. Same numbers,
different purpose, different outcome. This is why the reason is written down
here, in advance, rather than reconstructed later.

### The part that makes the question mostly moot

**31 CFR § 1010.313(b)** — aggregation:

> "multiple currency transactions shall be treated as a single transaction if
> the financial institution has knowledge that they are by or on behalf of any
> person and result in either cash in or cash out totaling more than $10,000
> during any one business day... Deposits made at night or over a weekend or
> holiday shall be treated as if received on the next business day."

Three bags of $8,000 handed over together are **$24,000 in one business day**,
and the bank aggregates them and files one CTR. Multiple bags do not avoid the
report. So the arrangement cannot be a "workaround" in the mechanical sense
either — there is nothing being worked around. Michael should expect CTRs to
continue, and that is fine. **A CTR is a routine filing on a lawful deposit,
not an accusation.**

### Why the intent framing must not be over-relied upon

*Ratzlaf v. United States*, 510 U.S. 135 (1994), read § 5324 to require proof
the defendant knew structuring itself was unlawful. **Congress removed that
requirement later that year** in the Money Laundering Suppression Act of 1994.
So the modern standard is only the purpose to evade the reporting requirement —
not knowledge that evasion is a crime. "I didn't know structuring was illegal"
is not a defence today, which is precisely why the deposit pattern should never
be allowed to *look* deliberate about the threshold, even innocently.

### The practical trap to avoid

The dangerous version of Michael's plan is the one where a day's takings run
over $10,000 and somebody splits that day across two bags, or holds part back
to the next trip, "to keep it simple." That is the fact pattern prosecutors
recognise. **The rule that keeps this safe is: never let the threshold
influence the split. Bag exactly one business day, whatever that day happens
to be — $600 or $16,000 — and bank it whole.** The day decides the amount; the
amount never decides the day.

## The bookkeeping verdict

From the accounting side, one-bag-per-day is **strictly better** than the lump,
and it is better for a reason worth stating: it removes an inference.

Under the lump, a $110,000 deposit covering fifteen days can only be matched to
the pool of counted cash as a whole. The books can say "this cleared fifteen
days of takings"; they cannot prove which day was short. Under one bag per day,
the deposit **is** the day. Bank row equals deposit slip equals Z-report equals
one register session. That is a one-to-one audit trail from till to bank, which
is the reconciliation WAC 314-55-087 and the LCB look at first, and it is also
how a shortage becomes attributable to a shift instead of a fortnight.

It also collapses the hardest part of the software. FIFO batching across many
days is inference; one-to-one matching is fact. The books get more accurate by
being asked to guess less.

## What is built anyway

The software will still support multi-day batching, for three reasons that do
not depend on Michael's discipline:

1. **The history is lumps.** Everything before cutover looks like the old
   pattern, and it must import truthfully.
2. **Nobody is perfect** — Michael's own words: *"You are right about us not
   being perfect, we never are, ever. So baking in flexibility for our
   misbehavior is always wise."* A missed Friday means Monday carries two days.
3. **Software that only works when the human is perfect gets abandoned**, and
   an abandoned control is worse than none because it looks like one.

So: one-to-one is the **procedure**; many-to-one is the **capability**. The
system should make the good path the easy path and the messy path possible,
never the reverse.

## Standing decisions this produces

- Deposits are bagged **per business day**, sealed, with the slip and the
  Z-report total, and banked roughly three times a week.
- **The $10,000 threshold never influences how a day is split.** One day, one
  bag, whole, whatever it totals.
- CTRs are expected and unremarkable. Nothing is done to avoid one.
- Cash stays on the **licensed premises** until banked, not at a residence
  (WAC 314-55-087 recordkeeping-on-premises; standard homeowners policies cap
  money at roughly $200 and off-premises business property near $250, so a
  house safe is effectively uninsured for this).
- The written procedure is itself a compliance artifact and is kept current.

**Not legal advice.** This is a developer's reading of primary sources, written
so the reasoning is inspectable. The cadence change should be mentioned to
Michael's CPA and, given the dollar amounts, ideally run past counsel once.

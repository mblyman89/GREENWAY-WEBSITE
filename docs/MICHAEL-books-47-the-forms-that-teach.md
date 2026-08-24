# The forms that teach

## books-47, slice D — and a straight answer about what is still not done

Michael — you asked for something specific:

> "I want to be able to see the form, and click a box to have it teach me all
> there is to know about that box. It should be thorough and verbatim and plain
> English explain actions. It should teach me how to read them and use them as
> a tool. Everything a cpa would know about these forms, I want to know to."

And then you corrected my aim, which was the right call:

> "the majority of the forms I really am interested in are the payroll forms
> like 940 941 l&I esd pfml wa cares etc."

This document explains what got built, and then — because you asked me directly
to explain what is not finished — it goes through the unfinished items one at a
time, in plain English, with no softening.

---

## Part one: what the three tabs actually do

Every form screen now has the same three tabs, and they answer three different
questions that people usually try to answer with one screen.

**The Form tab** shows the return the way it will look when you file it. Line
number, caption, figure, and a short sentence saying where the figure came
from. Above it sits a coloured bar answering the question that matters more
than any single line: whose money is this? Gold is your cost. Green is money
withheld from an employee that you are holding in trust. On Form 940 that bar
is solid gold across the full width, and it is worth understanding why. Not one
cent of federal unemployment tax is ever withheld from an employee. It does not
appear on a W-2, no employee ever sees it, and withholding it would be
unlawful. If green ever appears on that bar, a line has been classified wrongly
and the software has a bug.

Lines that are blank get a grey chip saying "blank on purpose" and the reason.
This matters more than it sounds. A blank box and a box containing 0.00 are
different statements to the IRS, and an empty box with no explanation reads as
something forgotten. Saying "blank on purpose: the instructions say to leave
this line empty when it does not apply" turns a suspicious gap into a fact you
learn once and never worry about again.

**The Why tab** is the teaching. Click any line number on the Form tab and it
takes you here, to that line. Each lesson has the same shape: what the line is
in plain English, where the figure came from, how to read it as a tool rather
than as a chore, the mistake people actually make, what to do about it, at
least one worked example with the arithmetic shown step by step, and the IRS's
own words quoted verbatim with a link to the source document.

The quotes are not paraphrases and they are not typed from memory. They are
checked, mechanically, against a copy of the actual IRS instructions stored in
the repository. A test reads that file off disk and confirms every quoted
fragment appears in it, in order. If I ever mistype a quote, or soften one word
of it, the build fails. That is not a promise about my carefulness; it is a
machine that does not get tired.

**The Check tab** is the form proving itself, and this is the tab that was
broken until today. More on that below.

---

## Part two: Form 940, and why it got built first

Form 940 had an engine, a full set of researched authorities, and about a
hundred passing tests. It had no screen. You could not reach it from anywhere
in the application. It now has one.

Here is the thing about Form 940 that makes it worth your attention, and it is
not obvious from looking at the form:

**Form 940 is a form about a credit, not about a tax.**

The federal unemployment rate is 6.0% on the first $7,000 you pay each person.
Almost nobody pays 6.0%. If you paid your Washington state unemployment tax on
time, you get a credit of 5.4%, and the 6.0% becomes 0.6%. That is a
ten-to-one difference, and it turns entirely on a payment made to ESD — not on
anything you send the IRS.

Which explains why the form is built in an order that otherwise makes no sense:

| Lines | What they do |
|---|---|
| 3 – 7 | Work out the wage base. No tax is charged anywhere. |
| 8 | Charge 0.6% — the **best case**, assuming you earned the full credit. |
| 9 – 11 | **Take back** whatever credit you did not actually earn. |
| 12 | The real tax. Every adjustment only ever **adds**. |

A Form 940 that stops at line 8 is not finished. It is merely optimistic.

The second thing worth knowing: because the $7,000 ceiling is **per person per
year**, FUTA is a headcount tax far more than a wages tax. At the 0.6% rate it
is roughly $42 a head. Give somebody a raise and it barely moves. Hire
somebody and it jumps. For budgeting purposes that is a genuinely useful thing
to have straight in your head, and it is the opposite of how most payroll taxes
behave.

For your two-person example — Joan at $44,000 and Nicholas at $6,200 — the
whole return comes to **$79.20 for the year**. Joan contributes $42.00 because
she is capped at $7,000. Nicholas contributes $37.20 on his full $6,200. If a
state payment went out late, that same year could cost $279.20 instead. Same
wages, same people, same work — different date on a cheque.

The screen refuses rather than guesses. The experience rate, the state payment
dates, the deposits, and the quarterly split are facts only you hold, and the
page names each missing one instead of inventing a plausible default. You will
see a short list headed "facts only you know" rather than a filled-in form
built on assumptions.

---

## Part three: the Check tab, and a bug I want to tell you about

You asked for three tabs. I built three tabs. Two of them worked.

The Check tab rendered the sentence *"There is nothing to reconcile on this
form yet."* on every single screen in the system, because no page ever passed
it anything to check. It looked finished. It had been tested. The component
that renders it has its own test file and a mutation campaign proving those
tests can fail. And it was empty everywhere, because the tests all tested the
component and nothing tested whether any page had been wired to it.

That is a specific kind of failure worth naming, because it will happen again
in some other form if I am not careful: **the component was perfect and the
connection did not exist.** Every test passed. The feature did not work.

Form 940's Check tab is now live, with four reconciliations. Three are
arithmetic that the return can prove about itself:

- **The wage base foots.** Line 3 minus line 6 should equal line 7. If it does
  not, one of the three is wrong and every figure below inherits the error.
- **The tax is the sum of its parts.** Lines 8 + 9 + 10 + 11 should equal line
  12. Since line 12 is what you actually pay, a gap here is real money.
- **Part 5 foots to the annual tax.** The four quarterly liabilities must add
  to line 12. This one is not my rule — the IRS instructions say *"Your total
  tax liability for the year must equal line 12"*, and the return is checked
  against that automatically when it is filed. Finding a mismatch here costs
  you a minute. Finding it by notice costs you a correspondence.

The fourth is the one that saves money:

- **Was the full state credit earned?** Compare line 12 against line 8. If they
  are equal, you paid FUTA at 0.6% and the year was clean. If line 12 is
  larger, the difference **is exactly what the lost credit cost you**, stated in
  dollars.

That fourth row is deliberately worded to say the return is **not** wrong when
the two differ. The form is correct; the year was expensive. If the software
called that an error you would spend an afternoon hunting a bug in a
mathematically perfect return, when the actual problem was a payment date eight
months earlier. The wording is now pinned by a test, because a mutation that
reworded it to "something is wrong with the return" passed every check I had.

There is now also a gate that reads the page files and fails the build if a
screen renders the teaching system with a permanently empty Check tab, unless
that screen is on a written list of exceptions with a stated reason. There are
two exceptions right now. They are items one and two below.

---

## Part four: the four things that are not finished

You asked me to explain these properly. Here they are, each with what it is,
why it is not done, and what it would take.

### 1. Nothing writes the filed Form 941 totals

**What it is.** When you file a 941 each quarter, the figures you actually
filed should be recorded. At year end, the W-3 totals must equal the sum of the
four filed 941s — that is one of the first things the SSA and IRS cross-check,
and a mismatch generates a notice.

**Why it is not done.** The table exists. Nothing writes to it. The 941 screen
prepares figures and shows you the arithmetic, but there is no "I filed this,
record it" step, so at year end the software has nothing to compare the W-3
against.

**Why I did not fake it.** I could reconcile the W-3 against the four 941s the
software *computed*. That would compare the system against itself and always
agree. It would be a green tick that means nothing — and worse than no check,
because you would trust it.

**What it needs.** A small confirmation step on the 941 screen: you file, you
enter what you filed (or confirm the computed figures were what went), and it
is stored with the date. Then the W-3 reconciliation becomes real. This is
maybe half a slice of work and it is the single highest-value unfinished item,
because it converts the entire W-2/W-3 comparison from decorative to load-
bearing.

### 2. PFML and WA Cares withheld amounts are not carried year-to-date

**What it is.** The year-to-date accumulators track wages and the federal taxes
withheld. They do not track how much Paid Family and Medical Leave premium or
WA Cares premium was withheld from each employee.

**Why it matters.** Both are money withheld from your staff and held in trust —
green money, not yours. Without a running total, the quarterly ESD reconcili-
ation cannot be checked against what was actually deducted from paycheques, and
an employee asking "how much have you taken for Paid Leave this year?" cannot
be answered from the system.

**What it needs.** Two more columns on the accumulator, written during the pay
run, plus the reconciliation rows on the Washington quarterly screen. Not
difficult. It is on the list rather than done because it touches the pay run
write path, and I would rather change that once, carefully, than twice.

### 3. Eight of the eighty-two worked examples

**What it is.** Across the teaching system there are 82 worked examples planned.
74 are written. Eight are not.

**Which eight.** They are the ones that need a number only you have — the
credit reduction worksheet (needs a credit reduction state, which Washington is
not, so I have no realistic figures), a couple of the L&I risk-class examples
that need your actual 2027 rates, and the multi-state apportionment cases that
do not apply to Greenway at all.

**Honest assessment.** Some of these should probably never be written. An
example about apportioning wages across three states is not teaching you
something you need; it is padding. I would rather give you 74 examples that
are all about your business than 82 where eight are theatre. When the 2027
rates arrive, three or four of the eight become real and I will write those.

### 4. The three ATM record types

**What it is.** There are three row shapes coming out of the ATM data that are
handled with a `Record<string, unknown>` cast — which in plain English means
the software is looking at them and saying "this is some kind of object, I
will figure out the fields at runtime."

**Why that is bad.** It is the one place in the payroll and books code where
the compiler is not checking the shape of the data. If the ATM export changed a
field name, nothing would catch it until something behaved oddly in production.
Everywhere else, a changed field name breaks the build immediately.

**Why it is still there.** I do not have enough real examples of the three row
types to write their shapes honestly. Guessing at them would produce a type
that looks authoritative and is wrong, which is worse than an honest `unknown`
— at least `unknown` forces the code to check before it trusts.

**What it needs.** A handful of real records of each type. This connects
directly to what you said next about Plaid and the ATM account, so it is about
to become the live problem rather than a footnote.

---

## Part five: what you told me comes next

You wrote:

> "Now that you brought up the atm, we will need to go back to the plaid
> connected accounts and atm connection so we can properly connect them to the
> accounting platform. Currently All inventory purchases flow through the main
> checking account, and all atm transactions go through the atm account. Once we
> migrate to our platform, the atm account will be used to pay vendors and
> payroll. The main checking account will be used for ordinary business
> transactions. The master Citi card is the business credit card. I know it's
> not ideal, but the credit card is shared between the cannabis shop and the
> landholding business."

I want to flag one thing in that paragraph now, because it is the part with
real consequences and it is better raised early than discovered during a
review.

**The shared credit card is the item to design around carefully.** Two separate
legal entities using one card is common and it is not fatal, but it does need
handling properly rather than sorting out at year end. Every charge has to be
assigned to one entity or the other, and whichever entity actually pays the
bill has effectively lent money to the other one. That creates a due to/due
from between the cannabis shop and the landholding business that has to be
tracked, and it has to be settled or documented, because two related entities
with an unexplained running balance between them is exactly the pattern an
examiner looks for.

The good news is that this is a solved problem in accounting and the software
can do the tedious part: every card transaction gets an entity at the point it
is categorised, the inter-entity balance accrues automatically, and you get a
statement showing what each entity owes the other. What it cannot do is guess
which entity a charge belongs to. That will be a decision per transaction, at
least until there are enough patterns to suggest defaults — and I will suggest,
never auto-apply, because a wrong guess here is a related-party problem rather
than a bookkeeping one.

The account roles you described are clean and I will build to them:

| Account | Role after migration |
|---|---|
| ATM account | Pays vendors and payroll |
| Main checking | Ordinary business transactions |
| Master Citi card | Business credit card, **shared across two entities** |

---

## Part six: what I still need from you

Nothing on this list is a nice-to-have. Each one is a place where the software
currently refuses to compute rather than guess.

**Time-critical, because the first payroll is 1 January 2027:**

- The twelve 2027 rates (Social Security wage base, the WA unemployment
  experience rate, PFML and WA Cares percentages, the L&I rates for risk class
  6403, and the rest). The engine will refuse to run a 2027 pay run without
  them, by name, which is the correct behaviour but not a useful one in
  January.

**For the S-corporation side:**

- Form 7203. This blocks the whole basis and distributions picture.
- Form 2553 and the CP261 acceptance letter, to confirm the S election date.
- The ending AAA balance.
- Your 2024 Form 1040 when you find it — you mentioned you have the transcripts,
  which helps, but the return itself is better.

**For Washington:**

- The July DOR Combined Excise Tax Return as filed. Everything on that screen
  is blocked on seeing one real return rather than my reading of the
  instructions.
- The Q3 and Q4 2026 returns.

**Smaller items:**

- Your legal name as it appears on filings, and the shareholder IDs.
- The depreciation schedule.

---

## What was verified, not assumed

I do not want any of the above read as a claim about care taken. Here is what
was actually run:

| Check | Result |
|---|---|
| Full compliance suite | 443 files, 10,859 tests, all passing |
| TypeScript strict compile | clean |
| Lint on every changed file | clean |
| Pure self-test runner | all passed |
| Mutation campaigns this session | 27 attacks, 27 killed |

That last line is the one I would point at. A mutation campaign takes the
finished code, deliberately breaks it in a realistic way, and checks that the
tests notice. If the tests stay green, the test was decoration.

This session ran 27 such attacks across three modules, and every one of them is
now killed. But the number that matters is not 27 — it is how many got through
on the first attempt.

Both new test files passed **every** first-round attack immediately. That
sounds like good news and is actually the moment to get suspicious, because a
test suite that cannot be broken by an obvious attack is usually one that is
not looking closely enough. So I wrote second rounds aimed at the weaknesses I
could see by re-reading my own gates. Those found **seven real holes**,
including:

- Emptying any single lesson's quotes left everything green, because the test
  counted quotes in total rather than per lesson. Three lessons were in fact
  teaching with no authority behind them at all. Fixed, and they now quote the
  actual IRS text for lines 3, 7 and 17.
- Changing a worked example's answer from $50,200.00 to $5,020.00 left
  everything green. The worked examples — the part you asked for by name — were
  the one part nothing checked.
- A reconciliation could compare a figure against itself and always agree.
- On a clean return, lines 9, 10 and 11 are all zero, so the addition test was
  comparing zeroes against zeroes. A mutation that added line 9 twice and never
  added line 11 survived, because with all-zero adjustments it made no
  difference. The fixture was too well-behaved to test the code.

And one more that I think is the most instructive of the lot. I added three new
IRS quotes and the 33-test verbatim suite passed them immediately. It should
not have — I had not registered them in the authority list, so the loop that
checks every quote against the source document never saw them. They were
unverified text that looked verified. Registering them made the count guard
fail 21-against-18, exactly as designed, and only then were the quotes actually
checked.

That is the second time in one session that something was green because nothing
was looking at it. It is the failure mode I now assume is present by default.

---

*Prepared for Michael Lyman, Greenway Marijuana. This software prepares
figures. It does not transmit anything to the IRS, ESD, L&I or the Department
of Revenue, and it is not a filing agent. You file every form yourself.*

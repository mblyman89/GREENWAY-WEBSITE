# books-40 — The Quarterly Return (Form 941)

**For:** Michael, Greenway Marijuana
**Slice:** books-40
**Screen:** Books → Form 941 (Quarterly)
**Status:** built, wired, and proved against a return the IRS already accepted

---

## First, the answer to your question about the roadmap

You asked whether we are still on track with the plan. We are, and I want to
give you the honest version rather than the comfortable one.

**books-39 delivered the pay run.** The W-4 read-back is there, and the join
you asked for — timesheet into engine into year-to-date into a pay run for a
real employee on a real date — is wired and reachable at Books → Pay Run.

**books-39 did not deliver the garnishment lifecycle buttons.** You asked for
those in the same breath and I want to be precise about what is and is not
there, because "mostly done" is how a thing never gets finished.

What exists: the code that terminates, suspends and resumes a wage order is
written and tested. The server actions that call that code are written. The
database constraints behind them are written. All of it is green.

What does not exist: the buttons. I searched the garnishment screen and the
workbench component for every one of those three actions and found this:

| Action | Times the screen calls it |
| --- | --- |
| `createWageOrderAction` | 2 |
| `terminateWageOrderAction` | **0** |
| `suspendWageOrderAction` | **0** |
| `resumeWageOrderAction` | **0** |

So you can create a wage order and you cannot end one. The machinery is
complete right up to the point where a human would touch it. That is exactly
the pattern you described when you said a lot of what we need is built but not
fully connected, and it is going in its own small change rather than being
smuggled into this one, because one feature per change is how we keep being
able to tell what broke.

**books-40 is the quarterly filing, 941 first**, which is what this document is
about. Your instinct on sequencing was right: the 941 is due first and it is
mostly summation, so it is the cheapest of the three to get right and the most
expensive to get wrong.

---

## What a Form 941 actually is

Four times a year, every employer tells the federal government three things:
how much it paid people, how much income tax it held back from them, and how
much Social Security and Medicare tax the quarter generated. That is the 941.

It is not a bill and it is not a payment. You have usually already sent the
money in during the quarter, in deposits. The 941 is the reconciliation: here
is what the quarter came to, here is what I already sent, here is the
difference. Most quarters the difference is zero and the form is a formality.

Three things about it surprise people, and all three are wired into this
screen because all three are ways to be wrong without noticing.

**One. A quarter in which you paid nobody still needs a return.** This is not a
folk rule, it is the actual text of the regulation, and the words are worth
reading:

> Except as otherwise provided in paragraphs (a)(3) and (a)(5) of this section
> and in 31.6011(a)-5 every employer is required to make a return for the first
> calendar quarter in which the employer pays wages, other than wages for
> agricultural labor, subject to the tax imposed by the Federal Insurance
> Contributions Act, and is required to make a return for each subsequent
> calendar quarter (whether or not wages are paid therein) until the employer
> has filed a final return in accordance with 31.6011(a)-6. ... Form 941,
> "Employer's QUARTERLY Federal Tax Return," is the form prescribed for making
> the return required by this paragraph (a)(1).

— 26 CFR 31.6011(a)-1(a)(1)

The phrase "whether or not wages are paid therein" is the whole point. Once you
have filed your first 941, you file one every quarter until you formally close
the account. A quiet quarter does not excuse you. And the penalty for a missing
return attaches to the missing **form**, not to missing money — so skipping a
zero quarter costs you a penalty on a return that would have cost nothing to
file. It is the most avoidable money in payroll.

**Two. The tax on the form is bigger than what came out of the paycheques.**
Social Security and Medicare are matched: the employee pays half and Greenway
pays the other half. Line 5a on the form is **both halves** — 12.4% — not the
6.2% you withheld. If you ever look at line 5a and think "that is twice what I
took off them", you are right, and it is correct. The instructions print the
multiplier on the form itself:

> Enter the total wages, sick pay, and taxable fringe benefits subject to social
> security tax you paid to your employees during the quarter. ... Enter the
> amount before payroll deductions. Don't include tips on this line. ... For
> 2026, the rate of social security tax on taxable wages is 6.2% (0.062) each
> for the employer and employee. Stop paying social security tax on and entering
> an employee's wages on line 5a when the employee's taxable wages and tips reach
> $184,500 for the year. However, continue to withhold income and Medicare taxes
> for the whole year on all wages and tips, even when the social security wage
> base limit of $184,500 has been reached. line 5a (column 1) x 0.124 line 5a
> (column 2)

— IRS, Instructions for Form 941, line 5a (Taxable social security wages)

Three things in there are worth saying out loud. The **0.124** at the end is the
giveaway that both halves are in the line. The **$184,500** cap is per person
per calendar year, which is why year-to-date figures are an input to a quarterly
return — the quarter somebody crosses the cap has a line 5a smaller than its
line 2. And **Medicare never stops**. Nobody at Greenway is anywhere near
$184,500, so the cap does not bite today. It is built and tested anyway, because
the first year it matters is the year nobody is looking for it.

**Three. There is a line for rounding, and it is the most dangerous line on the
form.** More on that below, because it deserves its own section.

---

## The one thing that will bite you: pay date, not period end

This is the single most common way a 941 goes wrong. I have wired the screen so
it cannot happen, but you should know why.

A pay period runs 21 June to 4 July. You pay it on 10 July. **Every cent of
that is third-quarter wages** — including the ten days that were physically
worked in June.

Federal employment tax follows the date the money reaches the employee, not the
days that earned it. So the question is never "when was this worked", it is
always "when was this paid".

Get it backwards and you misstate **two** quarters at once: the one that is now
short and the one that is now over. And it is invisible after the fact, because
both returns look internally consistent. Nothing adds up wrong. They are just
both wrong.

The screen selects the quarter by pay date, and there is a test that fails if
anybody ever changes it to period end date.

---

## Your real Q2 2026, reproduced line for line

Here is the part I am most confident about, and the reason I think this engine
is trustworthy.

I did not test this against numbers I made up. I tested it against **your
actual Q2 2026 Form 941** — the one that was really filed and really accepted,
which we have on file with its figures. I fed the engine the same ten
employees and the same wages, and asked it to build the return from scratch.

| Line | What it asks | What the engine produced | What you filed | Match |
| --- | --- | --- | --- | --- |
| 2 | Wages paid | $68,923.45 | $68,923.45 | ✅ |
| 3 | Income tax withheld | $3,659.35 | $3,659.35 | ✅ |
| 5a | Social Security, both halves | $8,546.51 | $8,546.51 | ✅ |
| 5c | Medicare, both halves | $1,998.78 | $1,998.78 | ✅ |
| 6 | Total before adjustment | $14,204.64 | $14,204.64 | ✅ |
| 7 | Fractions of cents | **−$0.07** | **−$0.07** | ✅ |
| 12 | **Total tax for the quarter** | **$14,204.57** | **$14,204.57** | ✅ |

Every line. To the cent. Including the seven-cent rounding line, with the right
sign.

One note on line 2, because it is the line that ties this return to January's
W-2s:

> Enter amounts on line 2 that would also be included in box 1 of your
> employees' Forms W-2. See Box 1 - Wages, tips, other compensation in the
> General Instructions for Forms W-2 and W-3 for details.

— IRS, Instructions for Form 941, line 2 (Wages, Tips, and Other Compensation)

That is a definition by cross-reference, and it is why the four quarterly 941s
and the January W-2s have to agree — the IRS compares them mechanically. It also
explains something that worries people the first time they see it: **line 2 and
line 5a are allowed to be different numbers**, because box 1 excludes things
like 401(k) deferrals that Social Security still taxes. For your Q2 2026 they
happen to be the same, because there is nothing in the pay treated differently
by the two definitions. The software does not assume they always will be.

The verdict sentence the screen produces for that quarter reads:

> Q2 2026 is fully paid. $14,204.57 of tax, $14,204.57 deposited, nothing owed.
> Due 2026-07-31.

**Why this matters more than a hundred ordinary tests.** A test I write myself
only proves the code agrees with my understanding. If my understanding is
wrong, the test passes anyway. This proves the code agrees with a document the
federal government has already looked at and accepted. That is a different
class of evidence, and it is what makes me comfortable telling you the engine
is ready to run in parallel against Sage on your 2026 data.

---

## Line 7, and why I will not let the system touch it

Line 7 is called "current quarter's adjustment for fractions of cents". Yours
was seven cents. Here is where seven cents comes from — and first, here is the
IRS admitting in writing that the form does not foot:

> Enter adjustments for fractions of cents (due to rounding) relating to the
> employee share of social security and Medicare taxes withheld. The employee
> share of amounts shown in column 2 of lines 5a-5d may differ slightly from
> amounts actually withheld from employees' pay due to the rounding of social
> security and Medicare taxes based on statutory rates. This adjustment may be a
> positive or a negative adjustment.

— IRS, Instructions for Form 941, line 7 (Current quarter's adjustment for
fractions of cents)

When you run a paycheque, the tax is rounded to the nearest cent on **that
cheque**. Do that across ten people and six or seven pay dates and you have
rounded about seventy times. The sum of seventy rounded numbers is not quite
the same as the tax on the quarter's total worked out in one go. The difference
is a few cents. The IRS knows this, expects it, and gives you a line for it.

**Here is the trap.** Line 7 is the only line on the return where a wrong
number looks completely normal. The IRS expects small change there and does not
scrutinise it. Which means that if you ever have a real problem — a rate typed
in wrong, a pay run posted twice — the tempting thing to do is push the
difference into line 7 and make the form balance.

Do that and you have hidden a genuine payroll error in the one place nobody
looks. Every subsequent quarter inherits it.

So the system computes line 7 as a **residual**. It works out what the tax
should have been at statutory rates, it adds up what actually came off the
cheques, and line 7 is the difference — measured, never chosen. And if that
difference is bigger than rounding could possibly explain for the number of
people you have, the screen **refuses to produce the return at all** and sends
you to the reconciliation instead.

There is a test that specifically checks line 7 does not move when the deposit
figure changes. If line 7 ever became a plug, that test goes red.

**Worked example of the good case.** Seven of your ten people had one cent less
withheld across the quarter than the statutory rate on their quarterly total.
Seven people, one cent each, withheld slightly under: −$0.07. That is
rounding doing exactly what rounding does, and the engine recovers it without
being told.

**Worked example of the bad case.** Suppose one person's Social Security had
been withheld at 5.2% instead of 6.2% by a typo. On $13,000 of wages that is
$130 missing. Line 7 would come out at −$130.00. Rounding cannot produce $130
from ten people. The screen refuses, names the size of the gap, and tells you
to run the reconciliation, which lists the difference per person largest first
— and the person with the typo is at the top.

---

## When it is due, and the ten days you can earn

There are **two** due dates, not one, and the second one has to be earned:

> Except as provided in paragraph (a)(4) of this section, each return required
> to be made under 31.6011(a)-1, in respect of the taxes imposed by the Federal
> Insurance Contributions Act (26 U.S.C. 3101-3128), or required to be made
> under 31.6011(a)-4, in respect of income tax withheld, shall be filed on or
> before the last day of the first calendar month following the period for which
> it is made. A return may be filed on or before the 10th day of the second
> calendar month following such period if timely deposits under section 6302(c)
> of the Code and the regulations have been made in full payment of such taxes
> due for the period.

— 26 CFR 31.6071(a)-1(a)(1)

The ordinary deadline is the last day of the month after the quarter ends.
April 30th, July 31st, October 31st, January 31st.

If that date lands on a weekend or a federal holiday it moves to the next
working day, and that is a rule of law rather than a courtesy:

> Section 7503 provides that when the last day prescribed under authority of any
> internal revenue law for the performance of any act falls on a Saturday,
> Sunday, or legal holiday, such act shall be considered performed timely if
> performed on the next succeeding day which is not a Saturday, Sunday, or legal
> holiday. For this purpose, any authorized extension of time shall be included
> in determining the last day for performance of any act.

— 26 CFR 301.7503-1(a)

The screen computes this rather than looking it up from a table, so it stays
right in years I have never thought about. Some real examples it produces:

| Quarter | Ordinary date | Shifted? | Actually due |
| --- | --- | --- | --- |
| Q2 2026 | 31 Jul 2026, a Friday | no | **2026-07-31** |
| Q3 2026 | 31 Oct 2026, a **Saturday** | yes | **2026-11-02** |
| Q4 2026 | 31 Jan 2027, a **Sunday** | yes | **2027-02-01** |
| Q2 2027 | 31 Jul 2027, a **Saturday** | yes | **2027-08-02** |

**The ten extra days.** If every deposit for the quarter was made in full and on
time, you may file by the 10th of the *second* month instead. It is not
requested and there is no form for it — you either earned it with your deposit
history or you did not. The screen shows both dates so you can see what the
good behaviour bought you.

Note the one that matters for you: **your first 941 ever, for Q1 2027, is due
30 April 2027**, covering the payrolls from your 1 January 2027 cutover.

---

## Line 1 is not a headcount

Line 1 asks how many employees you had. It does not mean "how many people work
here". It means:

> Enter the number of employees on your payroll for the pay period including
> March 12, June 12, September 12, or December 12, for the quarter indicated at
> the top of Form 941. Don't include: Household employees, Employees in nonpay
> status for the pay period, Farm employees, Pensioners, or Active members of
> the U.S. Armed Forces.

— IRS, Instructions for Form 941, line 1 (Number of Employees Who Received
Wages, Tips, or Other Compensation)

One specific pay period. The one containing the 12th of the quarter's **last**
month. Somebody who worked the whole quarter but left in May is not on the Q2
line 1. Somebody hired on the 11th of June is.

The screen finds the pay period covering that date, sees who was paid in it,
and counts them. If no pay period in your calendar covers that date, it does
**not** fall back to counting your staff — it refuses and tells you to build
the calendar. A plausible wrong number is worse than a refusal, because you
would sign it.

---

## The seven ways this screen will refuse

The screen never guesses. When it cannot produce an honest figure it says so
and tells you what would fix it. There are exactly seven of these, each with
its own explanation panel:

| Code | What it means |
| --- | --- |
| `NO_SUBJECTS` | Nobody was paid this quarter — and you still need a return. |
| `TWELFTH_DAY_UNKNOWN` | Nobody has recorded who was on the payroll for the 12th. |
| `NEGATIVE_WAGES` | A wage figure is below zero, which no real quarter produces. |
| `OASDI_EXCEEDS_WAGES` | Somebody's Social Security wages exceed their total wages. Impossible. |
| `FRACTIONS_TOO_LARGE` | Line 7 is too big to be rounding. Something is genuinely wrong. |
| `DEPOSITS_UNKNOWN` | The deposit history is not on file, so what is owed cannot be stated. |
| `QUARTER_NOT_VALID` | The quarter asked for is not a real quarter. |

All refusals are collected and shown **at once**. A screen that reports one
problem, gets it fixed, then reports the next one is a screen that wastes an
afternoon.

**`DEPOSITS_UNKNOWN` will fire for you right now, and it should.** There is no
federal tax deposit table in the database — not one migration creates it. So
the screen passes "unknown" rather than "zero". This matters enormously: if it
assumed zero, a fully paid quarter would show a balance due equal to the entire
quarter's tax. For Q2 2026 that would have been a $14,204.57 bill you do not
owe, and you would have gone looking for a chequebook. Recording deposits is a
later slice.

---

## The colours, and what each one is telling you

You said you like the colours, so here is what they actually mean on this
screen. There are two independent colour scales and they answer two different
questions, which is why one can be green while the other is red.

**Scale one — the state of the return.** Three states, three colours:

| Colour | Label | What it means |
| --- | --- | --- |
| Green | Ready to file | The return is complete and it foots. Read line 1, line 2 and line 12 out loud, then sign and file it. |
| Gold | Ready to file - money owed | The return is correct and it is ready to file - there is simply money still owed on it. The deposits made during the quarter came to less than the quarter's tax, so a payment goes with the return. |
| Red | Cannot be filed yet | Something is missing, so no return has been produced. Nothing has been saved and nothing has been filed - fix the items listed below and the return will build itself. |

**Gold is not a smaller red.** Gold means the arithmetic is right and you owe
money. Red means there is no return. Those are completely different situations
and confusing them costs you either a late filing or a payment you did not need
to make, so the gold sentence deliberately opens by telling you the return is
correct. Same rule as the pay-run screen, for the same reason.

**Scale two — the clock.** Four bands, keyed off how many days are left:

| Days left | Colour | Band |
| --- | --- | --- |
| Past the date | Red | overdue |
| 0 to 7 | Orange | due-now |
| 8 to 30 | Gold | due-soon |
| More than 30 | Green | comfortable |

Thirty days is not arbitrary — it is roughly the entire filing window, because
the return is due one month after the quarter closes. Seven days is one full
week: still enough time to find a missing pay run and file anyway. And the
overdue sentence names the price rather than just scolding you: **late filing is
charged at 5% of the tax per month under IRC 6651.**

---

## The seven checks before you sign

The screen carries a checklist, in the order the questions actually arrive.
Each one is answered by a physical action, never by "verify the data". These
are the questions word for word as the screen asks them:

1. Is the quarter actually over, and is every pay date inside it accounted for?
2. Is every pay run in the quarter approved and posted - none left half-finished?
3. Do the quarter's wages agree with the year-to-date record?
4. Do we know who was on the payroll for the pay period containing the 12th?
5. Is the quarter's deposit total recorded, from the deposit record and not from memory?
6. Is line 7 a few cents rather than a few dollars?
7. Read line 1, line 2 and line 12 out loud. Do all three sound like Greenway?

The order is not decorative. Each one is placed where it is because it is the
earliest point at which it can be answered, and the screen explains for every
single one why it sits there rather than later. Checks 1 and 2 are the same
class of problem — a missing input — and they come first because they are the
only errors on the list that **cannot be found by looking at the form**. Every
line will foot perfectly against a quarter that is missing its last payroll.

Check 2 has a rule of thumb worth memorising: **a biweekly quarter has six or
seven pay runs, never five.** If you count five, one is still in draft.

---

## The four worked examples built into the screen

You asked for examples, so they are not in this document only — they are on the
screen, and a test fails if one of them disappears. Each has a setup, numbered
steps, and a lesson at the end.

**1. "Greenway's real Q2 2026, line by line."** The whole return worked through
in eight steps using your own filed figures. The lesson at the end:

> Everything except lines 1 and 7 is addition or one multiplication. Line 7 is
> the form admitting it does not foot, and telling you where to put the
> difference. If you ever see it in dollars rather than cents, the problem is
> not on the 941.

**2. "Why line 5a is bigger than the Social Security you took out of the
cheques."** This one exists because it is the objection anybody sensible raises
the first time. Your Q2 2026 payslips show **$4,273.25** of Social Security
withheld. Line 5a says **$8,546.51**. The form looks like it is double-counting.
It is not: the employee paid 6.2% ($4,273.25) and Greenway paid 6.2% out of its
own pocket ($4,273.25). The half Greenway pays never appears on anybody's
payslip, which is exactly why it is easy to forget it has to be in the bank
account.

**And now the one cent that will nag at you.** $4,273.25 plus $4,273.25 is
$8,546.**50**, not $8,546.**51**. Line 5a is a penny higher than the two halves
added together, and **that one cent is not an error.** The form does not ask you
to add two halves — it prints its own multiplier: `line 5a (column 1) x 0.124`. And
$68,923.45 × 12.4% is $8,546.5078, which rounds up to $8,546.51. Rounding once
at 12.4% and rounding twice at 6.2% are genuinely different sums. The form says
which one it wants, and the engine does what the form says.

I mention this because I got it wrong first. The worked example on the screen
originally said "$4,273.25 + $4,273.25 = $8,546.51", which is arithmetic that
does not work. The test that re-derives these figures from your filed return
caught it, and the example now explains the penny instead of hiding it. That is
what these gates are for.

**3. "The pay period that ends in June but pays in July."** The 21 June to 4
July period, paid 9 July, is entirely Q3 — including the June work. Pay date
decides, always.

**4. "A quarter where Greenway pays nobody."** This one is aimed straight at
you: **you take your owner pay in a single annual period.** That means three of
the four quarters in a year may contain nothing at all for you, and all four
still need returns. The instinct is to file nothing because there is nothing to
report. The regulation quoted above says otherwise, and a zero return takes two
minutes.

---

## What the screen will not do

There is a button, and under it there is a sentence that says:

> This produces the figures for the return. It does not transmit anything to the
> IRS - nothing here files on your behalf, and nothing here is a filing agent.
> Take these figures to your filing method, check them against the form, and
> sign it yourself.

That boundary is deliberate and it is the one we agreed: we replace the
data-preparation half of what Aatrix did for you. We do not become a filing
agent. A button labelled "File" that does not file is the most dangerous
control this system could ship, because the failure mode is you believing a
return went in when it did not.

---

## What got wired together

You asked me to connect things that were already built rather than build more.
This slice reuses, and does not re-implement:

- **The filed-return oracle** (`known-good-quarters`) — your real Q2 2026
  figures, previously reachable from no page at all. It is now the thing the
  engine is proved against.
- **The deposit-schedule engine** — 1,000 lines of quarter and business-day
  logic that already knew about federal holidays. The 941 due dates use its
  calendar rather than a second one. If two calendars ever disagreed about
  whether a day is a working day, one of them would be wrong on a deadline.
- **The shared authority registry** — ten authorities the 941 needed were
  already transcribed for the deposit and pay-run slices. They are cited, not
  copied. Seven genuinely new ones were fetched from eCFR and irs.gov and
  transcribed word for word. All seventeen are now in the merged registry, so
  a citation means one thing on every screen.
- **The per-tax pay-run columns** — the wage columns added back in migration
  0199, which have been sitting there waiting for exactly this.

Lines written before those per-tax columns existed genuinely do not know their
own tax split. Those are **excluded and counted**, never treated as zero, and
the screen tells you how many there were.

---

## Where to find it

**Books → Form 941 (Quarterly)**, sitting directly after Pay Run in the menu.
That position is deliberate: the menu reads in the order the work is actually
done, and the 941 is pure summation of pay runs that already happened.

Owner-only, same as every other books screen.

---

## Numbers in this document you can hold me to

- 7 lines of your Q2 2026 return reproduced exactly, including line 7 at −$0.07
- 7 refusal codes, each with its own written explanation
- 7 pre-flight checks, each with its own reason for sitting where it does
- 7 newly transcribed authorities, plus 10 reused from the shared registry,
  17 in total on the screen
- 4 worked examples, each with numbered steps and a lesson
- 8 exported functions, each with its own mentor lesson
- 95 new tests on the engine, the mentor, the screen and the store
- 74 further tests on **this document**, checking its own claims

Every one of those counts is re-derived from the code by a test that runs on
every commit. If a later change makes a number in this document wrong, that
test goes red and the document gets corrected. A report that quietly goes stale
is worse than no report, because you would plan around it.

**It already earned its keep.** The document gate caught the $8,546.50 versus
$8,546.51 error described above — an arithmetic mistake I had written into the
teaching material and then repeated here, where it read perfectly plausibly. No
human proofread would have stopped on it. The test stopped on it because it
re-derives the figures from your filed return instead of reading my prose.

---

## What is next

**books-41: the state quarterly filings.** The ESD report and the L&I report.
We have your real Q2 2026 figures for both, with the confirmation numbers, so
they can be proved the same way this one was: ESD unemployment insurance
$255.02 with confirmation `G2413C8A6HP330LL`, and L&I premium $1,989.99 with
confirmation `12616784`.

**And the small one first:** the three garnishment lifecycle buttons. The work
behind them is done. It is an afternoon to connect them, and it should not wait
behind a bigger slice.

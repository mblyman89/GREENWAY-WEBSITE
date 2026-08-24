# What your ten documents unlock — the strategy for finishing the books

**For Michael. Plain English. No accounting jargon without a translation.**

Slice books-48. Written after reading, extracting and independently re-adding
every figure in all ten PDFs you uploaded.

---

## Read this part first, even if you read nothing else

You uploaded ten documents. Two of them were labelled "Federal Tax Return" and I
expected them to be your personal 1040s. **They are not.** They are Greenway's
own **Form 1120-S** returns for 2025 and 2024 — the S-corporation returns, with
all four Schedule K-1s attached to each.

That single discovery is the most valuable thing in the upload, and it changes
the plan. Here is why in one sentence: **the two figures that were blocking the
entire K-1 / 1120-S slice were sitting inside those files the whole time.** I
was waiting on you for them. I am not waiting any more.

The two figures were:

1. **Your accumulated adjustments account (AAA) balance — $229,081.**
   Plain English: this is the running total of profits the company has already
   been taxed on but has not yet handed out to shareholders. It matters because
   it is the dividing line between a distribution that is tax-free and a
   distribution that is taxable. Without it, any distribution screen I built
   would have to guess, and guessing on that line is how a tax-free withdrawal
   turns into a taxable dividend eighteen months later.

2. **The date your S election took effect — 1 January 2016.**
   Plain English: the day Greenway stopped being taxed as an ordinary company
   and started passing its income through to you personally. Several rules
   (built-in gains, the accumulated-earnings question, the five-year
   re-election bar) are measured in years since that date. I could not compute
   "years since" without the date.

Both are now recorded as **facts read off a filed return**, not assumptions.

---

## The second discovery, and it is a big one

Look at Greenway's 2024 return. There is a **Form 1125-E** attached — the schedule
where a corporation reports what it paid its officers. It shows **officer
compensation of $55,000**. Now look at where that $55,000 went. It is **not** on
page 1, line 7 ("Compensation of officers"), where most people would expect it.
Page 1 line 7 is blank. The whole $55,000 is claimed on **Form 1125-A, as "cost
of labor"** — inside cost of goods sold.

### Why that matters more than almost anything else in this build

Because of **§280E**. That is the law that says a business selling a Schedule I
controlled substance — which federally is exactly what Greenway is — cannot
deduct ordinary business expenses. Rent, advertising, admin salaries: all
disallowed. Your 2025 return reports **$228,245** of expenses knocked out by
§280E on Schedule K line 16c. That is real money you paid and got no deduction
for.

But §280E does **not** reach cost of goods sold. COGS is not a deduction, it is a
subtraction built into how gross profit is defined, and the courts have kept it
available. So for a cannabis retailer, **the single most consequential accounting
decision is which costs are legitimately COGS and which are disallowed
overhead.**

Your preparer routed officer wages into COGS via cost of labor. When my payroll
engine goes live on 1 January 2027 and starts posting journal entries, it must
reproduce that same routing — otherwise your first year on the new system will
report a materially different taxable income than every year before it, for no
reason other than that the software put a number in a different box.

**This is the number one thing I will now build against, and I would never have
known to do it if you had not uploaded the 2024 return.** Your 2025 return
carries **$170,109** of cost of labor and 2024 carries **$196,935**, so the
practice is consistent across both years, not a one-off.

> **One honest caveat.** I can see WHAT your preparer did. I cannot see his
> reasoning, and I am not going to invent it. There is a real legal question
> about how much of an officer's time in a retail dispensary is genuinely
> inventory-related labour. That is a conversation for you and Nicholas, and I
> have put it on the questions list at the end. My job is to make the software
> reproduce your chosen treatment consistently and show its working — not to
> pick the treatment for you.

---

## Document by document: what each one is actually for

### 1. July 2026 Department of Revenue return → unlocks slice E

This is your Washington Combined Excise Tax Return for July 2026. Every one of
its five lines checks out to the penny:

| Line | Base | Rate | Tax |
|---|---|---|---|
| B&O Retailing | $168,465.17 | 0.4710% | $793.47 |
| B&O Service & Other | $4,355.00 | 1.5% | $65.33 |
| State Retail Sales | $168,465.17 | 6.5% | $10,950.24 |
| Local Sales — 1802 Port Orchard | $168,465.17 | 2.8% | $4,717.02 |
| **Total** | | | **$16,526.06** |

**What it gives me that nothing else could:** the *shape* of the real return.
Which lines you actually use and which you leave blank. That you file
**monthly**, not quarterly. Your local jurisdiction code — **1802 Port
Orchard** — and its 2.8% rate, which I cannot derive from anything and would
otherwise have had to ask you for. That your combined rate is 9.3%. And a
confirmation number format (`0-053-958-352`) that tells me what a filed-return
record looks like.

**How it will be used:** as the worked example the WA excise screen is built
against. Slice E will reproduce this exact return line for line from your POS
sales data. If my engine cannot produce $16,526.06 from July 2026's sales, my
engine is wrong — and I will know it before you ever file with it.

**The one thing I still need:** the excise tax on cannabis itself. This return
shows B&O and sales tax, but the 37% cannabis excise tax is reported separately
to the WSLCB. I need one of those too. See the questions list.

### 2. Your 2025 W-2 → the arithmetic oracle for slice A

Boxes 1, 3 and 5 all read **$53,530.16** — identical, which tells me you had no
pre-tax deductions reducing one base but not another. Box 4 is **$3,318.87** and
I verified that is exactly 6.2% of box 3. Box 6 is **$776.19**, exactly 1.45% of
box 5. Box 14 says **HEALTH 30,980.16**.

**What it gives me:** proof that my W-2 engine's rates and rounding match what a
real filed W-2 looks like. The 6.2% and 1.45% ties are the strongest possible
test, because they either match to the cent or they do not.

**The interesting part is box 14.** $30,980.16 of health insurance reported for
a shareholder-employee. For anyone owning more than 2% of an S corporation —
you own 85% — health insurance premiums the company pays are **not** a tax-free
fringe benefit. They must be added to your W-2 wages, and then you deduct them
on your personal return. It nets out to roughly zero federal tax, but it must
flow through the W-2 to work. **My payroll engine has to know how to do this for
you specifically, and not do it for a rank-and-file employee.** That is now a
build requirement I can point at a real document to justify.

### 3. Alyssa's 2025 W-2 → the rate oracle for Washington, and the joint return

Small numbers — **$140.92** of wages from the Greater Gig Harbor Foundation. You
almost apologised for including it. Do not. It is one of the most useful
documents in the batch, for a reason that has nothing to do with the amount.

Its box 14 carries **three separate Washington withholdings** on a wage base
small enough that I can solve for the rate exactly:

| Item | Amount | Implied rate | Status |
|---|---|---|---|
| WA CARES | $0.82 | 0.58% | **Exact. Confirmed.** |
| WA PFML | $0.93 | 0.6599% | Close to 0.65% but not exact — flagged |
| WA L&I | $0.96 | — | Depends on risk class; charity ≠ retail |

WA Cares at 0.58% is now **mechanically confirmed from a filed W-2**, not taken
from a rate table I read on a website. That is exactly the standard I hold
everything to.

**And the bigger use:** she has W-2 income, which means your 2025 return is a
**joint** return with wages from two employers. The 2024 transcripts already
confirm you file **married filing jointly** with two dependents. So when I build
the personal-return side, I have to model two W-2s, not one. Without her form I
would have built a one-earner model and it would have been wrong on the first
run.

### 4 and 6. The two 1120-S returns → unlocks slice B, the biggest remaining piece

These two documents are the backbone of everything left to build. Here is the
two-year picture:

| | 2024 | 2025 | Change |
|---|---|---|---|
| Gross receipts (line 1a) | $2,461,538 | $2,206,244 | −10% |
| Cost of goods sold | $1,720,107 | $1,523,215 | −11% |
| **Ordinary business income (line 22)** | **$741,431** | **$683,029** | **−8%** |
| §280E disallowed (K line 16c) | $198,508 | $228,245 | +15% |
| Distributions (K line 16d) | $464,191 | $490,273 | +6% |
| Total deductions (line 21) | $0 | $0 | — |

That "total deductions $0" is not a mistake and it is worth understanding. It is
§280E in action: because the deductions are disallowed, they are not claimed on
the return at all. They are instead reported to shareholders on line 16c as
nondeductible expenses, which reduces your stock basis without ever reducing
taxable income. **You pay tax on income you never got to deduct expenses
against.** Seeing $0 on line 21 of a return with $2.2M of sales is the single
clearest illustration of what §280E costs you, and I want that on the screen.

**The chain that proves the whole thing hangs together.** I traced one number
through four independent documents:

```
2024 Form 1120-S line 22                        $741,431
        × your 85% ownership              =     $630,215.35
Michael's 2024 Schedule K-1, box 1              $630,215   ← matches
IRS 2024 tax return transcript, Sch E line      $630,215   ← matches
IRS 2024 record of account                      $630,215   ← matches
```

Four documents, three of them produced by the IRS rather than by your preparer,
and they agree exactly. That is what a verified chain looks like, and it is now
the test case slice B will be built against.

**The second proof — the years actually connect:**

```
2024 return, Schedule M-2 ending AAA            $264,570
2025 return, Schedule M-2 beginning AAA         $264,570   ← matches
2025 return, Schedule M-2 ending AAA            $229,081
2025 Schedule L ending: cash 40,000 + inv 189,081 = $229,081   ← matches
```

Your balance sheet and your AAA foot to each other, and 2024 rolls into 2025
without a break. This means I can trust the AAA figure as a starting balance for
the distribution engine rather than treating it as an unverified input.

### The four K-1s, both years — and your shareholders

Thank you for the correction on this. My model was wrong and yours is right. For
the record, as verified against the returns:

| Shareholder | Relationship | % |
|---|---|---|
| Michael Lyman | you | 85% |
| Nicholas C Mullan | your grandfather | 5% |
| Theresa L Becker | your mother | 5% |
| James H Becker | your step-father | 5% |

You gifted your mother 10%. <!-- SUPERSEDED-ROSTER: this is the HOUSEHOLD figure and it is
correct as written; the legal roster is 85/5/5/5. --> Washington is a **community-property state**, so her
husband James owns half of what she owns by operation of law, and the return
correctly reports it as two 5% interests rather than one 10% interest. Her
economic unit is still the 10% you gave her. I verified the arithmetic on your
**2025** return: box 1 of $34,151 × 2 = $68,302, against an exact 10% share of
$68,302.90 (10% of the $683,029 on line 22). It ties.

> Added in books-50: this paragraph is correct, and I want to record that I
> briefly decided it was not. Re-checking it, I looked for $34,151 on the
> **2024** return, whose total is $741,431, could not find it, and concluded the
> arithmetic was wrong. The figures are from **2025**. On the 2024 return the
> same holders show $37,072 each against a $741,431 total. Both years say
> 85/5/5/5. The lesson is to check which year a number belongs to before
> calling it wrong.

**Why the software has to care.** An S corporation is allowed only **one class of
stock**, which in practice means every distribution must be strictly
proportional to ownership. Not roughly. Proportionally. A distribution that is
not pro-rata can be argued to create a second class of stock, and losing S
status is a catastrophic, retroactive event.

So I checked. 2025 is pro-rata to within rounding — clean. **2024 is not:**

| Shareholder | 2024 distribution | Pro-rata would be | Difference |
|---|---|---|---|
| Nicholas C Mullan | $5,000 | $23,209.55 | **−$18,209.55** |
| James H Becker | $29,590 | $23,209.55 | +$6,380.45 |
| Theresa L Becker | $29,591 | $23,209.55 | +$6,381.45 |

I want to be very careful in how I say this. **I am not telling you something is
wrong.** There are perfectly ordinary explanations — timing across a year-end, a
loan repayment recorded as a distribution, an agreed unequal advance that
evened out later. Any of those is fine. What I am telling you is that **this is
a question worth asking Nicholas**, because if there is no explanation it is the
kind of thing that is cheap to fix now and expensive to discover during an
examination. It goes on the questions list, framed as a question.

**What this unlocks:** the shareholder table, the basis tracking, and a
distribution screen that will refuse to record a non-pro-rata distribution
without an explicit reason attached. That last part is the whole point — the
software should make the safe thing easy and the risky thing deliberate.

### 5. Your 2024 W-2 → the year-over-year continuity check

$55,000 of wages, matching the officer compensation on Form 1125-E exactly. That
match is what let me prove the COGS routing described above. Box 12 shows an
amount of $20,000 but the **code letter did not survive text extraction**, so I
do not know what kind of contribution it was. I am not going to guess a
retirement plan type. It is on the questions list.

### 7–10. The four IRS transcripts → the personal-return side

You said you do not have your full 2024 1040 yet, only the transcripts. The
transcripts are enough to get a long way, and here is what they establish:

| Item | Amount |
|---|---|
| Filing status | Married filing jointly, 2 dependents |
| Wages | $55,000 |
| Schedule C (two of them) | −$26,297 |
| Schedule D capital loss allowed | −$3,000 |
| Schedule E — Greenway K-1 | $630,215 |
| Total income | $655,918 |
| **Adjusted gross income** | **$601,019** |
| Taxable income | $571,819 |
| **Total tax** | **$140,886** |
| **QBI deduction** | **$0.00** |
| Payments | $233,667 |
| Overpayment applied forward | $92,592 |

**Three things here deserve your attention.**

**First — the QBI deduction is zero.** QBI, or the qualified business income
deduction under §199A, normally lets an owner deduct up to 20% of business
income. On $630,215 that would be worth roughly $126,000 of deduction. It is
zero. Whether that is because §280E interacts with §199A, or because of the
income-based limitations that phase the deduction out for higher earners, or a
deliberate position, **I cannot tell from a transcript and I am not going to
speculate about a six-figure number.** This is the highest-value question on the
list. It is worth asking Nicholas directly and getting the answer in writing.

**Second — your Schedule D shows a net short-term loss of $59,036** but only
$3,000 was allowed, because $3,000 a year is the cap against ordinary income.
That means roughly **$56,036 of capital loss is carrying forward** into 2025 and
beyond. A carryforward is an asset. It is worth real money in the year you use
it, and the way carryforwards get lost is that nobody is tracking them. The
software will track it.

**Third — a small discrepancy I am flagging rather than smoothing over.** The
IRS 5498 form shows an IRA contribution of **$7,000**, but the 1040 claims an
IRA deduction of **$14,000**. There is an obvious innocent explanation — a spousal
IRA, two accounts, one custodian reporting late — but $7,000 of deduction is not
something I am willing to assume my way past. On the list.

I also noticed the wage-and-income transcript flags your **2024 Greenway K-1 as
an "Amended document."** So the K-1 was corrected at some point. The corrected
figures are what tie out, so the chain is fine — but it is worth knowing that an
amendment happened, and worth knowing why.

---

## So what actually gets built, and in what order

**Slice B — the 1120-S, the K-1s and the personal return. Now unblocked.**
This was stalled waiting on the AAA balance and the S-election date. Both are
now known facts read off filed returns. What I will build: the four-shareholder
table with the community-property split modelled explicitly; stock and debt
basis tracking per shareholder; the §280E line 16c mechanism that reduces basis
without reducing income; a pro-rata distribution check that refuses silently
unequal distributions; and the 2024 chain above as the acceptance test. If the
engine cannot reproduce $741,431 → $630,215 → the transcript, it does not ship.

**Slice E — the Washington excise return.** Built against July 2026 line for
line, with the 1802 Port Orchard local rate and monthly filing frequency taken
from the actual return rather than a rate table.

**Payroll, for 1 January 2027.** Three requirements now come from documents
rather than from my judgement: officer wages route into COGS as cost of labor,
not page-1 line 7; your health insurance flows through W-2 box 14 because you
are a more-than-2% shareholder; and WA Cares withholds at 0.58% confirmed.

**The personal-return side.** Two W-2s, married filing jointly, two dependents,
a $56,036 capital loss carryforward to track, and a large open question about
QBI that I will not resolve by guessing.

**Still on the back burner, at your instruction:** four of the eight worked
examples, waiting for the 2027 rates. They are scaffolded and ready to fill in
the day you send the numbers.

---

## What I still need from you

Split into three lists, because they are urgent in very different ways.

### Time-critical — needed before 1 January 2027

1. **The twelve 2027 rates.** Social Security wage base; Medicare and Additional
   Medicare thresholds; FUTA rate and wage base; WA unemployment taxable wage
   base and your experience rate; WA PFML total rate and employee share; WA Cares
   rate; your L&I rate for risk class 6403; and the federal withholding tables.
   This is the one list where the calendar is the constraint rather than my
   pace. Everything else can wait; this cannot.

### Answers only you or Nicholas can give

2. **Why is the QBI deduction $0.00?** Highest-value question here by a wide
   margin. Worth roughly $126,000 of deduction if it turns out to be available.
3. **The 2024 distributions.** Nicholas received $5,000 where pro-rata would be
   $23,209.55. What was the reason?
4. **The reasoning behind routing officer compensation through COGS**, so I can
   reproduce the policy rather than just the number.
5. **Box 12 on your 2024 W-2** — the code letter for the $20,000.
6. **The IRA figures** — $7,000 reported by the custodian, $14,000 deducted.
7. **Why the 2024 K-1 was amended.**
8. **Employer ZIP** — the 2024 W-2 says 98366, the 2025 says 98367. Which is
   correct on file?

### Documents that would close remaining gaps

9. **Your full 2024 Form 1040** with all schedules — you have already promised
   this. The transcripts got me far but the schedules carry the detail.
10. **The depreciation schedule** — also promised.
11. **Form 7203** — your shareholder basis computation. This is the form that
    tracks your stock basis year over year, and it is what makes the
    distribution engine trustworthy rather than merely arithmetically correct.
12. **Form 2553 and the CP261 acceptance letter** — the S election and the IRS's
    confirmation of it.
13. **One WSLCB cannabis excise tax return** — the 37% tax, which the DOR return
    does not cover.
14. **Q3 and Q4 2026 WA excise returns**, so slice E has more than one month to
    test against.

### And separately — what I need from your ATM portal

You offered, so here is exactly what to pull. You do not need to understand why
each one matters; just export whatever the portal will give you for these:

1. **A settlement or funding report for one full month.** The record of what the
   ATM processor actually wired to your bank account, by date. This is the
   independent side of the reconciliation — the number I compare *against*, and
   it must come from the processor rather than from your own books, or the
   comparison compares your books to your books and always agrees.
2. **A transaction detail report for the same month.** Individual withdrawals:
   date, time, amount dispensed, surcharge charged, and the terminal ID.
3. **A surcharge or fee revenue summary.** What the ATM earned you, and how the
   processor splits it. Your surcharge income is ordinary business income and it
   is almost certainly **not** cannabis income — which means it is arguably
   outside §280E. That distinction is worth real money and it needs to be
   recorded separately from day one.
4. **A vault or cash-load history.** When cash was loaded into the machine and
   how much. This is what turns the ATM from a black box into a cash account
   with a provable balance.
5. **A statement or invoice from the processor.** Their fees, their billing
   frequency, and whether fees are netted out of settlements or billed
   separately. Netted fees are the single most common reason an ATM never
   reconciles: the deposit is smaller than the withdrawals and nobody knows why.
6. **Terminal IDs and how many machines you run.** One or several, and whether
   each has its own settlement stream.

Screenshots are fine. CSV is better. A month of real data is worth more than a
year of my assumptions.

---

## The standing commitment

Nothing in this document is a guess. Every figure was extracted from your PDFs
mechanically and then independently re-added before I wrote it down. Where two
documents disagreed I said so and flagged it rather than picking the one that
made a nicer story. Where I do not know something — the QBI answer, the box 12
code, your preparer's reasoning — I have written "I do not know" and put it on a
list, because a confident wrong answer in a tax system is worse than an admitted
gap.

That is the standard for the rest of this build.

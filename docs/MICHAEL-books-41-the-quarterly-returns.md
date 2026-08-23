# The quarterly returns: four Washington forms, every box explained

**Prepared for Michael Lyman · Greenway Marijuana · books-41**

---

## What changed, in one paragraph

Every fortnight the pay run produces cheques. Four times a year Washington asks you to account for them, and it asks four separate times, on four different forms, to two different agencies, measuring four different things. Until this slice the system could compute a paycheque but could not produce a single one of those returns. It now builds all four — the ESD Form 5208A tax report, the ESD Form 5208B wage detail, the combined Paid Family & Medical Leave and WA Cares report, and the L&I quarterly premium report — and it reproduces your **actual filed Q2 2026 return to the cent, on every comparable figure**. Not approximately. Not within a rounding tolerance. Exactly, including a one-cent difference that most payroll systems get wrong and that took a statute to explain. This report walks every box on all four forms in plain English: what the number is, where it came from, whose money it is, and what happens if it is wrong.

---

## Why I built it against your real return instead of my own arithmetic

I want to be precise about the method, because it is the reason you can trust the output.

I did not write the engine and then test that it agreed with me. That proves nothing — it proves I am consistent, not that I am right. Instead I took the Q2 2026 returns you actually filed, with their confirmation numbers, and stored the assessed figures as an **oracle**: a record of what a state agency actually charged. The engine is then required to reproduce those figures independently. Where it disagrees, the engine is wrong, because a filed return that an agency accepted and cashed outranks any program output.

That is a standing rule in this repository and it earned its place here immediately. The very first run disagreed with your ESD return by one cent, and I will come back to that cent below, because it turned out to be the most instructive thing in the entire slice.

Seven comparable figures now reproduce exactly:

| Figure | Filed | Computed |
| --- | --- | --- |
| Unemployment insurance (UI) | $255.02 | $255.02 |
| Employment Administration Fund (EAF) | $20.68 | $20.68 |
| ESD total due | $275.70 | $275.70 |
| Paid Leave withheld from employees | $556.32 | $556.32 |
| Paid Leave employer share | $0.00 | $0.00 |
| WA Cares premiums | $399.76 | $399.76 |
| L&I premium | $1,989.99 | $1,989.99 |

The L&I split reproduces too: $585.11 employee plus $1,404.88 employer, which add to the $1,989.99 that was filed under confirmation 12616784.

---

## The four forms, and why there are four

This is the part nobody explains, and it is the thing that makes the quarter feel more complicated than it is. There are four returns because Washington is measuring four genuinely different things. Once you can name what each one measures, the whole quarter stops being a pile of paperwork and becomes four short questions.

### Form 5208A — Quarterly Tax Report

Filed with the **Washington Employment Security Department**, in EAMS. Here is what the regulation asks for, in its own words:

**WAC 192-310-010(3)(a)** says:

> "Tax report. Each calendar quarter, every employer must file a tax report with the commissioner. The report must list the total wages paid to every employee during that quarter."

In plain English: this is Form 5208A in a single sentence, and it is worth reading closely for **how little it asks for**. The tax report is one number — total wages for the whole business. For your Q2 2026 that number is $68,923.45, and every dollar ESD assessed for the quarter is a percentage of it. There are no names on this report and no hours. That is what makes the second report necessary, and it is why a mistake in the wage total is far more expensive than a mistake in any one person's line: **the total is what gets taxed**.

What it is charged on: wages, capped per person per year at the unemployment wage base ($78,200 for 2026). Once somebody passes that ceiling their later wages stop being taxable, which is why this return usually shrinks through the year even when payroll does not.

The common mistake, and it is the big one: treating the 0.40% on your rate notice as one tax. It is two.

### Form 5208B — Quarterly Wage Detail Report

Same agency, same system, completely different purpose.

**WAC 192-310-010(3)(b)** says:

> "Report of employees' wages. Each calendar quarter, every employer must file a report of employees' wages with the commissioner. This report must list each employee by full name, Social Security number, standard occupational classification code or job title, and total hours worked and wages paid during that quarter."

In plain English: five things per person — full name, Social Security number, occupational code or job title, total hours worked, wages paid. This report produces no bill of its own. It is how the state knows **whose** earnings to credit if that person later files for unemployment.

Here is the fact I would most like you to take from this section: **the federal Form 941 asks for none of these per person.** The 941 wants totals. Washington wants a row per human being, with hours. That single difference explains most of why state and federal quarterly filing feel so unalike, and it explains why an employee's hours matter to a form that charges no tax on them.

The common mistake: thinking hours are optional on this form because no tax is charged on them here. They are required, and the same hour count is what L&I charges real money on. An hour missed here is an hour missed there.

### The Paid Family & Medical Leave and WA Cares report

Same agency, **different system** — this one is not in EAMS, which surprises people every first quarter.

Two employee-funded premiums that happen to be collected together. Almost all of the money on this return was already taken out of paycheques; the business is handing it on, not paying it.

What it is charged on: wages — but the two premiums do not agree on which wages. Paid Leave stops at the Social Security wage base. **WA Cares has no ceiling whatsoever** and is charged on every dollar. They sit side by side on one form and use two different wage definitions.

The common mistake: collapsing Paid Leave into a single rate on wages. It is a percentage *of* a percentage, and I give it a worked example below.

### The L&I Quarterly Report

A different agency entirely — the **Department of Labor & Industries** — and the only one of the four that does not care about money coming in.

**WAC 296-17-31021(1)** says:

> "A unit of exposure is the measure which is used to help determine the premium you will pay. For most businesses the unit of exposure is the hours worked by their employees. Because not all employees are compensated based on the hours they work, we have developed reporting alternatives to make reporting to us easier."

In plain English: this return is charged on **hours**. Not wages. Wages appear nowhere in the calculation. It is insurance against workplace injury, and it is priced by exposure to that risk — and an hour of exposure is an hour of exposure whether the person earning it is paid $16 or $60. Greenway has one risk class, 6403, specialty grocery retail, so the whole return is one hour count times one rate.

The common mistake: expecting this return to move when pay moves. Give everyone a raise and the three ESD numbers all rise while this one does not change by a cent. The reverse trap is worse: cut hours and this falls, so an hours error here is invisible against the wage figures that would normally catch it.

---

## The one cent that explains everything

I said the first run disagreed with your filed return by a cent. Here is the whole story, because it is the single most useful thing in this document.

Your ESD rate notice shows **0.40%**. The obvious thing to do — the thing almost every payroll system does — is multiply your taxable wages by 0.40% and pay the answer. Do that and you get $275.69. ESD assessed **$275.70**.

The reason is not arithmetic. It is legal. That 0.40% is not one tax; it is two separate statutory accounts printed on one line.

**RCW 50.24.010** says:

> "In the payment of any contributions, a fractional part of a cent shall be disregarded unless it amounts to one-half cent or more, in which case it shall be increased to one cent."

**RCW 50.24.014(2)(b)** says the same thing again, for its own account:

> "Contributions under this section shall become due and be paid by each employer under rules as the commissioner may prescribe, and shall not be deducted, in whole or in part, from the remuneration of individuals in the employ of the employer. Any deduction in violation of this section is unlawful. ... In the payment of any contributions under this section, a fractional part of a cent shall be disregarded unless it amounts to one-half cent or more, in which case it shall be increased to one cent."

Read those two together and the cent explains itself. Each statute commands rounding **for its own section**. So the arithmetic must round twice, not once:

- The shortcut: 0.40% of $68,923.45 = $275.6938, which rounds to **$275.69**.
- The lawful method, part one: 0.37% of $68,923.45 = $255.016765. A fractional part of a cent of one-half or more is increased to one cent, so **$255.02**.
- Part two: 0.03% of $68,923.45 = $20.677035, and its own statute says the same thing, so **$20.68**.
- Add the two **rounded** figures: $255.02 + $20.68 = **$275.70**.

That is exactly what ESD assessed, under confirmation G2413C8A6HP330LL.

**When the law rounds twice, the software rounds twice.** A cent a quarter is not the point. The point is that the cent was a signal that the model was wrong — that the system thought it was dealing with one tax when it was dealing with two — and a system with the wrong model will eventually be wrong by more than a cent.

### What this cost you, and it is not the cent

Because the two components must be rounded separately, the system needs **both figures**, not the combined 0.40%. So the rate registry now holds them as two separate evidenced rows: the unemployment insurance rate and the Employment Administration Fund surcharge.

That has one visible consequence for you, and I would rather tell you plainly than let you find it. **The count of 2027 rates you still owe the system went from ten to twelve.** I have corrected the books-39 report accordingly, and its own tests forced me to — which is exactly what those tests are for.

Nothing new is being demanded of you. **Both numbers are already printed on the one ESD notice you were always going to receive in December.** You simply enter the two components rather than the total. The reward is that your quarterly return then reproduces your filing to the penny instead of to within a cent.

---

## Every box on every form, in plain English

This is the section you asked for. Ten boxes produce numbers across the four returns. For each one: what goes in it, where the figure comes from, **whose money it is**, why that ownership matters legally, what happens if it is wrong, and the real Q2 2026 figure.

That "whose money" column is not decoration. It is carried in the system as data rather than as prose, precisely so a screen cannot blur it, because the two kinds of money are governed by opposite rules.

### Form 5208A, box: "UI tax due" — **your money**

**What goes here:** your unemployment insurance rate multiplied by the quarter's taxable wages. The rate is specific to Greenway — ESD calculates it from your own history of former staff claiming benefits and mails it every December. It is not a rate you can look up.

**Where it comes from:** taxable wages come from the pay runs for the quarter, capped per person at the annual wage base. The rate comes from the dated rate registry, which holds the figure read off your ESD tax rate notice for account 000-073905-00-0.

**Why the ownership matters:** RCW 50.24.010 does not merely discourage passing this on to staff — it says any such deduction "shall be unlawful". There is no consent form that makes it acceptable. Here is the sentence itself:

> "Contributions shall become due and be paid by each employer to the treasurer for the unemployment compensation fund in accordance with such regulations as the commissioner may prescribe, and shall not be deducted, in whole or in part, from the remuneration of individuals in employment of the employer. Any deduction in violation of the provisions of this section shall be unlawful."

**If it is wrong:** too low and ESD assesses the difference with interest under RCW 50.24.040 and a penalty under RCW 50.12.220. Too high and you have simply overpaid, and getting it back means an amended return. The likeliest error is not arithmetic at all: it is using last year's rate because the December notice was never entered.

**Q2 2026:** $68,923.45 × 0.37% = $255.016765, which the half-cent rule rounds to $255.02.

### Form 5208A, box: "EAF tax due" — **your money**

**What goes here:** the Employment Administration Fund surcharge — 0.03% of the same taxable wages. It pays for *running* the unemployment system rather than for benefits themselves.

**Where it comes from:** the same taxable wage figure as the line above. The 0.03% is itself two statutory accounts added together: 0.02% under RCW 50.24.014(1)(a) and 0.01% under (1)(b).

**Why the ownership matters:** RCW 50.24.014(2)(a) carries its own copy of the no-deduction rule and its own word "unlawful". Small surcharge, identical legal treatment.

**If it is wrong:** it is small enough to be waved through, which is the danger. A wrong EAF makes the total disagree with what ESD assessed, and reconciling a $0.30 difference three quarters later costs far more than getting it right now.

**Q2 2026:** $68,923.45 × 0.03% = $20.677035, rounded to $20.68 by its own statute's half-cent rule.

### Form 5208A, box: "Total due" — **your money**

**What goes here:** the two lines above, added after each has been rounded on its own.

**Where it comes from:** nothing new — it is arithmetic on the two boxes above. But the *order* is not cosmetic.

**Why the ownership matters:** this is the figure that leaves the bank account, and every cent of it is company money. Neither part of it may be deducted from anybody's pay: RCW 50.24.010 says an employer attempting to do so is guilty of a misdemeanour, and RCW 50.24.014(2)(b) applies the same prohibition to the EAF portion. There is no consent form that makes it lawful.

**If it is wrong:** the classic failure is rounding once instead of twice. It produces a figure one cent below what ESD assessed, the payment does not clear the balance, and the account shows as delinquent over a cent — which is enough to attract a notice.

**Q2 2026:** $255.02 + $20.68 = $275.70.

### Paid Leave / WA Cares, box: "Paid Leave premiums withheld from employees" — **your staff's money**

**What goes here:** the Paid Family and Medical Leave money already taken out of paycheques during the quarter. Two steps: work out the whole premium on wages, then take the employees' share *of that premium*.

**Where it comes from:** wages from the pay runs, capped at the Social Security wage base. The 1.13% premium rate and the 71.43% employee share both come from the dated rate registry, and both are reset by ESD every year.

**Why the ownership matters:** this is the most important ownership statement on any of the four forms.

**RCW 50A.10.030(7)(b) and (9)** say:

> "The employer must collect from the employees the premiums provided under this section through payroll deductions and remit the amounts collected to the department. In collecting employee premiums through payroll deductions, the employer shall act as the agent of the employees and shall remit the amounts to the department as required by this title. ... Premiums collected under this section are placed in trust for the employees and employers that the program is intended to assist."

In plain English: you are the **agent** of your employees for this money, and it is held **in trust**. It is never available to the business, even briefly, even if the bank balance is tight and the payment is not due for three weeks. This is the state-level twin of the federal trust-fund rule, and it is why "I'll pay it next month" is a categorically different act here than it is for an ordinary supplier invoice.

**If it is wrong:** withhold too much and you owe the staff a refund, individually, with a wage-payment problem attached. Withhold too little and the premium is still owed — you simply cannot go back and take extra from a past paycheque without running into RCW 49.52.050.

**Q2 2026:** $68,923.45 × 1.13% = $778.83 of premium; 71.43% of $778.83 = $556.32.

### Paid Leave / WA Cares, box: "Employer Medical + Employer Family" — **your money (but zero)**

**What goes here:** Greenway's own share of the Paid Leave premium — which for you is **$0.00**, because a business with fewer than fifty Washington employees is not required to pay it.

**RCW 50A.10.030(5)(a)** says:

> "Employers with fewer than 50 employees employed in the state are not required to pay the employer portion of premiums for family and medical leave. ... If an employer with fewer than 50 employees elects to pay the premiums, the employer is then eligible for assistance under RCW 50A.24.030."

**Why the ownership matters:** if it were owed it would be a genuine company cost, not a withholding — so it must never be recovered from staff by adjusting their share upward.

**If it is wrong:** a zero here looks like something was forgotten, so the reason must travel with the number. The real risk is drift: cross fifty employees and this stops being zero from the following January, and nothing on the payroll screen will announce that.

**Q2 2026:** $0.00 filed. Had it been owed, it would have been 28.57% of the $778.83 premium = **$222.51** — which is the size of the exposure if the headcount test is ever missed.

### Paid Leave / WA Cares, box: "Total WA Cares premiums" — **your staff's money**

**What goes here:** the long-term care premium: 0.58% of gross wages, all of it employee money, with **no wage ceiling of any kind**.

**Where it comes from:** gross wages for the quarter — the same $68,923.45 the ESD tax report uses — and the 0.58% rate from the registry. Some employees hold exemptions, which is a per-person fact and not something to net off the total by hand.

**Why the ownership matters:** every cent was withheld from staff. The business is a conduit, exactly as with Paid Leave.

**If it is wrong:** the trap is applying the Paid Leave wage cap to it. WA Cares has no cap, so capping it under-collects from anyone above the Social Security base — and because the two premiums sit side by side on the same return and use the same wage definition, this is an easy and entirely silent error.

**Q2 2026:** $68,923.45 × 0.58% = $399.76 exactly, with no cap applied to anybody.

### L&I, box: "Hours reported, risk class" — **shared**

**What goes here:** the total hours worked in the quarter, in each risk classification. Greenway has one class — 6403 — so there is one figure.

**Where it comes from:** the time clock, via the timesheets for the quarter. The same total must appear on the 5208B wage detail; if the two returns disagree about hours, one of them is wrong.

**Why the ownership matters:** hours are not money, but they determine money on both sides: the employer premium, and the employee share that RCW 51.16.140 allows to be withheld.

**If it is wrong:** this is the **highest-leverage number on any of the four returns**, because it is the only one no wage figure can cross-check. Wrong hours means a wrong premium, a wrong employee deduction, and a wage detail that disagrees with the L&I filing.

**Q2 2026:** 3,558 hours across ten people, matching the 5208B exactly.

A small design note, because you will see it on screen. This box reports **hours**, not dollars, and the system carries that distinction as data. Earlier in this slice the hours box held a money field set to zero, which meant any screen formatting it would have printed "$0.00" next to a box reporting 3,558 hours — a number you would reasonably read as "you owe nothing". The box now knows what it measures and prints "3,558 hours".

### L&I, box: "Employee share withheld" — **your staff's money**

**What goes here:** hours times the employee's hourly rate from the L&I rate notice. For Greenway in 2026 that is $0.16445 per hour.

**Where it comes from:** the rate notice for account 521,756-00, held in the registry to five decimal places because that is how the state quotes it.

**Why the ownership matters:** RCW 51.16.140 expressly *permits* withholding this portion. It is one of the few payroll deductions Washington affirmatively allows — and only up to the rate on the notice.

**If it is wrong:** deriving this rate instead of reading it is a known, expensive mistake. This system once computed it as half the medical aid rate and produced $0.067185 per hour against a true $0.16445. It never derives it now — it reads it off the notice.

**Q2 2026:** 3,558 hours × $0.16445 = $585.11 withheld from staff across the quarter.

### L&I, box: "Employer share" — **your money**

**What goes here:** hours times the employer's hourly rate, $0.39485 for Greenway in 2026.

**Where it comes from:** the same L&I rate notice. Read, never derived.

**Why the ownership matters:** the larger half of workers' compensation is a company cost. RCW 51.16.140(1) lets an employer deduct only the employee's stated half from wages, which means this half **may not be deducted or otherwise recovered from staff at all** — not by withholding it, and not by quietly reducing pay to offset it.

**If it is wrong:** an error here is a straight over- or under-payment of premium, and L&I audits hours against payroll records. Transposing the two halves is worse than a simple miscount: it under-pays L&I and over-deducts from every employee at the same time, so one mistake creates both a premium liability and a wage claim. The two rates arrive on the same piece of paper and are easy to transpose, which is exactly why the system reads them into separate, individually evidenced rows.

**Q2 2026:** 3,558 hours × $0.39485 = $1,404.88.

### L&I, box: "Amount owed" — **shared**

**What goes here:** the full workers' compensation premium for the quarter: hours times the combined rate of $0.5593 per hour.

**Where it comes from:** hours from the time clock; the combined rate is the employee and employer rates on the notice added together, which is how L&I bills it.

**Why the ownership matters:** part of this was already taken from staff and part is company money. The split matters for the books even though one payment leaves the bank.

**If it is wrong:** not filing at all is worse than filing wrong.

**WAC 296-17-31023** says:

> "If you do not have employees during a quarter, you must report by the due date and indicate 'no payroll' or 'no employees'. If you do not submit reports when required, we will estimate premiums and initiate legal action against you to collect premiums due."

Read that twice. **An estimate made without your hours will not favour you**, and a quarter with no payroll still requires a report. Silence is not a filing.

**Q2 2026:** 3,558 × $0.5593 = $1,989.99 exactly, filed under confirmation 12616784. Note that the whole return never mentions the $68,923.45 of wages.

---

## Four worked examples

### One: the cent that proves the two funds are separate

Covered in full above. The short version: $275.69 the tempting way, $275.70 the lawful way, and the difference is that the law rounds twice.

### Two: why Paid Leave cannot be done in one multiplication

Same quarter, same $68,923.45. The premium rate is 1.13% and employees pay 71.43% of the premium.

1. First the whole premium, on wages: $68,923.45 × 1.13% = $778.8349…
2. Then the employees' share **of the premium**: $778.8349 × 71.43% = $556.32.
3. The employer's share would be the other 28.57%, or $222.51 — but see the next example.

**Answer:** $556.32 withheld from employees, matching the filed return.

**The lesson:** the 71.43% is a share of the premium, not a rate on wages. Anyone who stores it as a wage rate produces a number roughly ninety times too small, and it will look perfectly plausible on the screen. The engine keeps the two steps apart and rounds only at the end — rounding the intermediate turns $556.32 into $556.33.

### Three: a zero that has to be defended

The employer share of Paid Leave on your filed Q2 2026 return is $0.00. Is that a mistake?

1. The premium for the quarter is $778.83, and the employer share of it would be 28.57%, or $222.51.
2. RCW 50A.10.030(5)(a): employers with fewer than 50 Washington employees are not required to pay the employer portion.
3. Greenway employs ten. The exemption applies, so the correct figure is $0.00.
4. And the timing rule, which is the part people miss. **RCW 50A.10.030(7)(c)** says:

> "On September 30th of each year, the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters to determine the size of the employer for the next calendar year for the purposes of this section, RCW 50A.24.010, and 50A.24.030."

**Answer:** $0.00 is correct, and it is a legal position rather than an omission.

**The lesson:** every zero on a tax return should have a reason attached to it, because a zero and a blank look identical to a reviewer. The exposure is $222.51 a quarter, and it switches on **in the January following the September the headcount crosses fifty** — not on the day the fiftieth person is hired. You would have roughly a quarter's notice, if you are looking. The system now records the determined headcount so you can see the margin.

### Four: give everyone a raise, and watch which returns move

Suppose your Q2 2026 wages had been 10% higher — $75,815.80 — on exactly the same 3,558 hours.

1. 5208A unemployment: 0.37% of $75,815.80 = $280.52, up from $255.02. **Changes.**
2. EAF: 0.03% of $75,815.80 = $22.74, up from $20.68. **Changes.**
3. Paid Leave and WA Cares: both are rates on wages, so both rise by 10%. **Change.**
4. L&I: 3,558 hours × $0.5593 = $1,989.99. **Unchanged, to the cent.**

**The lesson:** this is the fastest way to internalise the difference between the two agencies. L&I is insurance against injury, and an hour is an hour regardless of what it pays. It also explains the asymmetry in where your risk lies: an error in **wages** shows up in three places and is likely to be caught, while an error in **hours** shows up in the one return that no wage figure can cross-check.

---

## Your 2027 deadlines, and a Washington trap

The rule is in the regulation, and it is worth having in its own words because it disposes of a very expensive assumption.

**WAC 192-310-010(3)(d)** says:

> "Due dates. The quarterly tax and wage reports are due by the last day of the month following the end of the calendar quarter being reported. Calendar quarters end on March 31st, June 30th, September 30th and December 31st of each year. So, reports are due by April 30th, July 31st, October 31st, and January 31st, in that order. If these dates fall on a Saturday, Sunday, or a legal holiday, the reports will be due on the next business day. Reports submitted by mail will be considered filed on the postmarked date. The commissioner must approve exceptions to the time and method of filing in advance."

The system computes these rather than storing them, so they cannot go stale:

| Quarter | Named date | Actually due | Why |
| --- | --- | --- | --- |
| Q1 2027 | 30 April 2027 | **Friday 30 April 2027** | A business day. No shift. |
| Q2 2027 | 31 July 2027 | **Monday 2 August 2027** | 31 July is a Saturday. |
| Q3 2027 | 31 October 2027 | **Monday 1 November 2027** | 31 October is a Sunday. |
| Q4 2027 | 31 January 2028 | **Monday 31 January 2028** | A business day. No shift. |

**The trap, and it is the expensive one.** The federal Form 941 gives you an extra ten days to file if you have deposited all your tax on time. **Washington has no such extension.** None of these four dates moves for any reason except a weekend or a legal holiday. Carrying the federal habit across the border is the single most likely way to be late on a state return while believing you are early.

A note on holidays, because I checked rather than assumed. The Washington list in RCW 1.16.050 is **not** the federal list — it excludes Columbus Day by name and adds Native American Heritage Day, the Friday after Thanksgiving. As it happens, no Washington legal holiday can ever fall on 31 January, 30 April, 31 July or 31 October, so in practice only weekends ever move a quarterly deadline. I verified that across every quarter from 2024 to 2200. The holiday check stays in the code anyway, because the legislature amends that statute from time to time and a test will tell us the day it matters.

---

## What being late actually costs

I would rather you know this now, in a calm moment, than look it up in a panic.

The two agencies charge differently, and **both charge for the filing as well as for the payment**. ESD's late-report penalty under RCW 50.12.220 is assessed **per employee not reported** — so with ten people it scales ten times faster than the intuition of "a small late fee". Interest under RCW 50.24.040 runs separately from the penalty and does not stop while you gather the money. And a balance still unpaid on 30 September can push next year's unemployment **rate** up, which quietly costs more than the penalty ever did.

The practical conclusion is simple and worth internalising: **filing on time while paying late is nearly always cheaper than doing neither.** File the return, pay what you can, and deal with the balance. The penalty for not filing is separate from the interest on not paying, and only one of those two is avoidable when money is short.

---

## Where this lives, and what you will see when you open it

Everything above is now a screen. Open the left-hand menu, find the **Accounting** group, and click **WA Quarterly Returns** — it sits directly beneath **Form 941 (Quarterly)**, because the two fall due on the same day and are worked in the same sitting. The address, if you ever want it directly, is `/admin/books/wa-quarterly`.

Small aside, and a fair example of why this document is tested rather than proofread. The paragraph you just read originally said "directly beneath **Federal 941**", which is what I remembered the menu saying. The menu actually says **Form 941 (Quarterly)**. A test that checks the report's directions against the real menu labels went red and I corrected the document. That is a trivial error with a non-trivial consequence: directions that are nearly right are how you end up scrolling a menu looking for something that is in front of you, concluding it was never built.

The page opens on **the most recently closed quarter**, not the one you are living in, because a quarter that has not ended yet cannot be filed and showing it would invite you to file half a quarter. If no payroll has run in the quarter it opens on, it says so plainly rather than showing a return full of zeroes, and a return full of zeroes is a thing you might reasonably have submitted.

Reading down the page, here is what each part is for.

**The deadline banner, and its colour.** The colour is not decoration and it is not a mood. It is computed from the number of days between today and the real due date, and it changes at defined boundaries: **green** while the quarter has only just closed and there is room to fix things, **gold** from thirty days out, which is the ordinary filing window, **orange** inside the last week, and **red** once the date has passed. There is a detail worth knowing about the gold band: 1 July is exactly thirty days from the 31 July deadline, so **the first day of the filing month is already gold**. That is deliberate. A colour that only changed partway through the month would let the first week of July feel like June.

The red state says something the other three do not. Its words are: *"Washington has no federal-style extension for having paid on time, so nothing you did earlier in the quarter cures a late report."* If you have spent years around the federal system, that instinct — *I deposited on time, so I have some room* — is the exact instinct that will cost you money here, and the screen says so at the only moment it matters.

**The three submission cards.** This is the heart of the screen and the reason it is not a single "file your state return" button. Your Q2 2026 quarter appears as three cards, in the order you should work them:

The first card is the **Employment Security Department, filed in EAMS**, carrying **both** the 5208A tax report and the 5208B wage detail, totalling **$275.70**. The two forms travel together because they are two halves of one filing; sending one without the other is an incomplete report with its own penalty.

The second card is the **Employment Security Department again — same agency, same deadline, a completely separate system**, the Paid Leave and WA Cares reporting system, totalling **$956.08**. The screen states in words why this is its own card: *"This is the one people miss, because having filed in EAMS feels like having filed with ESD. It is a separate submission with its own confirmation number."* I want to be blunt about why this got its own card rather than being folded into an "ESD" heading. Grouping by agency is the obvious way to build this screen, and it is wrong. It would teach you that one submission discharges both duties, and you would learn otherwise from a late notice for a report you believed you had filed.

The third card is the **Department of Labor & Industries, in the L&I portal**, totalling **$1,989.99** — a different department, a different account number, and charged on **hours** rather than wages.

Three cards, three confirmation numbers. If you have fewer than three confirmation numbers, the quarter is not filed.

**The "whose money is this" panel.** Underneath, the same quarter is totalled again a second way: **$1,680.58 is Greenway's own cost** and **$1,541.19 was withheld from your staff and is held in trust**. Those two add to $3,221.77, which is exactly what the three submission cards add to — the same money, sorted by who it belongs to instead of by where it goes.

There is no single "you owe" number anywhere on this screen, and its absence is the point. One combined figure would be the natural thing to display and it would blur the one distinction the statutes exist to protect: RCW 50.24.010 makes recovering the unemployment tax from a worker a misdemeanour, while RCW 50A.10.030(7)(b) makes the Paid Leave premiums money you are already holding as your employees' agent. Those are opposite legal relationships. A screen that adds them together invites precisely the mistake the law was written to prevent, so the system carries "whose money" as data on every single box rather than as a sentence in a document that a future screen could forget to read.

**The form-by-form detail.** Below that, each form is laid out box by box, and every box carries the four things you need to check it: what the number is, where it came from, whose money it is, and what happens if it is wrong. The 5208B is different from the other three and is drawn differently — as a table with one row per person, because that is what a wage detail report is.

**When it refuses.** If anything is missing, the page does not show you a return. It shows you a card per problem, each naming what is missing, what it means, and what to do about it. The most common one by far will be a missing rate, and the screen resolves rates as of the quarter's **last day** — for Q2 2026 that is 30 June 2026 — because that is the law in force during the quarter being reported, not the law in force on the day you happen to be sitting there filing it.

I checked what this actually does today, both ways. Ask it for **Q2 2026** and all seven rates resolve and match your filed return. Ask it for **Q1 2027** and it refuses, and it lists **all six** missing rates at once — the unemployment rate, the EAF surcharge, the Paid Leave rate, the employee share of Paid Leave, and both L&I hourly rates — rather than stopping at the first one. That matters practically: you can take one list to one sitting with your rate notices in December instead of discovering them one at a time across six attempts.

**What the screen will not do.** There is no submit button that talks to a state agency, and there never will be from this slice. The button is labelled for the work it actually does, and the boundary is written on the page itself.

---

## The eight-step quarterly checklist

The system carries this as a checklist on screen, in this order, with the reasoning attached to each step. The order is deliberate.

**One: check this year's rate notices are entered.** Find the ESD tax rate notice and the L&I rate notice for the current year — both arrive in December — and confirm the figures on the rate screen match them. *Done when* the unemployment rate, the EAF rate and both L&I hourly rates all show the current year's dates, and the rate screen refuses nothing. *If skipped:* every figure on all four returns is computed at last year's prices. This is the single most common way a quarterly filing goes wrong, and it produces a return that looks entirely reasonable.

**Two: confirm the hours are complete before anything else.** Check that every timesheet in the quarter is approved and that nobody shows wages with zero hours. If anyone is salaried, confirm which reporting method is in force for **all** salaried people. *Done when* the total hours figure is stable and equals what you would get by adding the approved timesheets by hand. *If skipped:* hours drive the entire L&I premium and no wage figure can catch an error in them.

On that salaried point, the regulation is unusually blunt. **WAC 296-17-31021(2)** says:

> "Salaried employees: You must select one of the following methods to report your salaried employees: Actual hours worked; or Assumed hours of one hundred-sixty hours per month. All salaried employees of an employer must be reported by the same method. You cannot report some salaried employees based on the actual hours they work and others using the one hundred sixty hours per month method."

You pick one method for everybody. A per-person decision made quietly is itself a defect, even if every individual number is defensible.

**Three: cross-foot the wage detail against the tax report.** Add the wages on the 5208B rows and check the total equals the single figure on the 5208A. Do the same for hours against the L&I return. *Done when* one wage number appears on the 941, the 5208A, the 5208B and the Paid Leave return, and one hour number appears on the 5208B and the L&I return. *If skipped:* returns that disagree with each other are the fastest route to an audit letter, because the agencies compare them to one another and to the federal filing.

**Four: separate the money you owe from the money you are holding.** Read down the "whose money" column. Everything marked as employee money was already withheld and is being passed on; everything marked as employer cost is a company expense. *Done when* you can say, without looking it up, which of the four payments are your cost and which are your staff's money in transit. *If skipped:* the two are governed by opposite rules. Unemployment tax may never be deducted from anybody, and Paid Leave money is held in trust and may never be used by the business. Blurring them is how an employer ends up owing both the agency and the staff.

**Five: confirm the Paid Leave employer exemption still applies.** Check the averaged headcount ESD determined on 30 September. If it is close to fifty, plan for the employer share from the following January. *Done when* the determined average headcount is recorded on the return, with the margin to fifty visible. *If skipped:* the exemption is decided once a year and fixed for the whole of the next one. Crossing fifty does not produce a warning anywhere in payroll; it produces a bill.

**Six: read the due date off the return, not off the calendar.** Check whether the last day of the month after the quarter is a weekend. If it is, the deadline moves to the next business day — and only then. *Done when* the due date shown on the screen is the one in your diary. *If skipped:* two of your four 2027 deadlines move, and assuming the federal 941's ten-day extension applies here is the more expensive mistake, because Washington has no such extension at all.

**Seven: know what being late actually costs before you need to know.** If a return is going to be late, file it anyway and pay what you can. *Done when* you can say, out loud, what a month's delay would cost on this quarter's figures — and you have filed rather than waited until you could pay in full.

**Eight: if Greenway ever stops paying wages, say so on the return.** If the business stops employing anybody, report it on the quarterly return for the quarter it happened in, rather than assuming the agencies will notice the zeros. *Done when* the final return states the date wages stopped, and you have kept the confirmation.

That last one exists because of a specific regulation, and I hope you never need it.

**WAC 192-310-010(4)** says:

> "Each employer who stops doing business or whose account is closed by the department must immediately file: (i) A tax report for the current calendar quarter which covers tax payments due on the date the account is closed; and (ii) A report of employees' wages for the current calendar quarter which includes all wages paid as of the date the account is closed."

Nothing about closing is automatic. Both agencies keep expecting returns, and a return they expect and do not receive is a late return with a penalty attached, quarter after quarter, for a business that no longer has any payroll to pay them from.

---

## The ten ways the return will refuse to build

The engine refuses rather than guessing. Each refusal names what it saw, why it will not proceed, and the first thing to do about it.

**NO_SUBJECTS** — there is nobody on this quarter. A quarter with no people is either a quarter with no payroll, which still needs a return, or a quarter whose pay runs have not arrived. Those need opposite responses, so the software will not pick one. *Fix:* if nobody was paid, file the return marked "no payroll". Otherwise find the missing pay runs.

**NEGATIVE_WAGES** — somebody has negative wages. No quarter pays a negative amount. It is almost always a reversal entered as a fresh pay run, and filing it would understate the whole return. *Fix:* void the original pay run properly rather than posting a negative one.

**NEGATIVE_HOURS** — somebody has negative hours. Hours are charged directly by L&I; a negative would reduce the premium owed. *Fix:* correct the timesheet.

**TAXABLE_EXCEEDS_TOTAL** — somebody's taxable wages are larger than their total wages. Taxable wages are the part of total wages still under a ceiling, so they can never be the larger of the two. This means the year-to-date figures are wrong. *Fix:* check the year-to-date wage records feeding this quarter.

**FRACTIONAL_HOURS** — somebody's hours are not a whole number. Both agencies collect whole hours for this employer, so a fraction means a rounding decision was made somewhere it is not visible. *Fix:* round at the timesheet, where the decision can be seen and defended.

**MISSING_RATE** — one or more rates were not supplied. The rate registry refuses rather than reaching for a neighbouring year, because last year's rate produces a return that looks entirely normal and is wrong throughout. *Fix:* enter this year's figures from the December ESD notice and the L&I notice.

**PFML_SHARE_NOT_A_SHARE** — the Paid Leave employee share is not a percentage between 0 and 100. This field is a share of the premium, not a rate on wages. A wage-shaped number here would under-collect by roughly ninety times and look plausible. *Fix:* enter 71.43% as a share.

**WAGES_WITHOUT_HOURS** — somebody was paid but reported no hours. Washington requires hours per person, and L&I charges premium on them, so zero hours against real pay understates the premium while every wage figure still looks right. *Fix:* record the hours; if the person is salaried, choose actual hours or 160 per month for **all** salaried staff.

**HOURS_WITHOUT_WAGES** — somebody worked hours but was paid nothing. This is either unpaid work, which is a far larger problem than a tax return, or a pay run that has not posted. *Fix:* resolve the pay run before filing.

**PFML_SIZE_UNDETERMINED** — the return says the employer share of Paid Leave is owed, but no determined headcount is recorded. Paying the employer share is a consequence of ESD's 30 September determination; paying it without recording that determination leaves no reason on the file. *Fix:* record the averaged headcount ESD determined.

---

## What I did not do, and what I got wrong

**The boundary is unchanged.** This slice prepares the data. It does not file anything. You still enter the figures in EAMS, in the Paid Leave system, and in the L&I portal, and the confirmation numbers still come back to you. We replace the data-preparation half of what Aatrix did; we do not become a filing agent.

**Several things in this slice were wrong when I first wrote them, and I want every one of them on the record.** Two were in the engine, two more were found by deliberately sabotaging it, one was in the screen, and one was in the machinery that checks this very document. They are all below, in the order I found them.

The first was a function called `isWaLegalHolidayOnDueDate` that returned "no" unconditionally. It looked like a holiday check. It was a stub — a claim about Washington law that had never been implemented, sitting in code that other code trusted. I replaced it with a real table built from RCW 1.16.050 and then proved by test that it behaves correctly across 52 years of quarters.

The second was the hours box holding a money value of zero, described above.

Neither was found by a test. Both were found by reading the code adversarially and asking what it would do if it were wrong. That is worth saying because it is the honest account of how this work goes: the tests catch regressions, but somebody still has to go looking for the things nobody thought to test.

**The mutation battery found two more.** After writing the tests I ran a script that deliberately breaks the engine in fourteen realistic ways and requires the suite to fail for each. Eight survived the first run. Three turned out to be undetectable in principle — the holiday branch cannot be reached by any real quarter, which I proved by walking 708 of them — and one was my own error in describing a rounding mode. But two were **genuine holes in the tests**: the engine could have started double-rounding Paid Leave, or computing the L&I total as the sum of two rounded halves, and every test would have stayed green. Both are now covered, and the reason they slipped through is worth understanding: your Q2 2026 figures happen to give the same answer either way. **The filed return proves the engine is right for one quarter; it cannot prove the method is right for every quarter, and the method is what ships.**

**The screen would have dropped a whole form, and a test caught it.** When I wrote the tests for the screen's logic, one of them asked a deliberately dull question: of the four forms this quarter produces, how many does the page know how to draw? The answer came back **three**. Form 5208B — the wage detail, one row per person — carries no boxes at all, only a list of people, and the box-by-box renderer that draws the other three forms had nothing to draw for it. It would have rendered nothing. No error, no gap, no blank space with a warning: the page would simply have shown you three forms and looked complete.

That is the same failure as the test counter below, in a more expensive place. **The ESD filing is incomplete without the 5208B**, and an incomplete report carries its own penalty separate from anything you owe. So the page would have been quietly walking you into a penalty while showing you a tidy, finished-looking screen. The fix was to give the wage detail its own renderer — a table, because that is what it is — and to move the question "is every form drawn by something?" into the tested layer so it is asked automatically on every commit, rather than depending on me noticing. If a fifth form is ever added and nobody writes a renderer for it, that test goes red the same day.

**And then the checking machinery itself was wrong.** The last paragraph of this document tells you how many tests stand behind it. Those numbers are not typed by hand — a test reads the test files and counts, so that the claim cannot rot. The first version of that counter reported 65 where the real number was 72, and it failed the moment I ran it. Two bugs were hiding in one line: it could not see a test indented one level deeper than the others, and it counted a loop that generates seven tests — one for each figure on your filed return — as though it were a single test. I fixed it by making it do the real work: find the loop, resolve the list it walks, and add one test per entry. If it ever meets a loop shape it does not recognise, it now stops and says so instead of quietly reporting a number that is too low.

I am telling you about a bug in a test that counts other tests because the failure mode is the one you should be most suspicious of in all of this. **A check that undercounts does not look broken. It looks like a green check.** This one happened to fail loudly, which is the only reason I found it — but that was luck, not design, and if the two numbers had lined up differently it would have passed while being wrong. There is now a further test whose only job is to prove the old broken counter would have said 65, so nobody can ever quietly put the simpler, wrong version back.

---

## What I still need from you

**The 2027 rate notices, as they arrive.** Twelve rates are outstanding for 1 January 2027, and this slice added two of them by splitting your ESD notice into its two real components. In rough order of arrival: the Washington minimum wage (L&I must calculate it by 30 September 2026), the Paid Leave premium rate and its employee/employer split (ESD, around the end of September), the Social Security wage base (SSA, October), the L&I rate notice for risk class 6403 (autumn, giving both hourly rates), and the ESD unemployment tax rate notice (December, giving the unemployment insurance rate, the EAF surcharge, and the wage base as three separate entries).

**Your Q3 and Q4 2026 filed returns, if you have them.** One filed quarter proved the engine reproduces reality. A second and third would let me prove it reproduces a quarter where somebody crosses the unemployment wage base — which Q2 did not test, because nobody had.

**Confirmation of the salaried reporting method**, if any salaried person is ever paid. WAC 296-17-31021(2) requires one method for everybody, and it is cheaper to decide it before there is a second salaried person than after.

---

## The tests behind this document

The engine has 72 tests of its own, which reproduce your filed Q2 2026 return figure by figure, prove that the tempting single-rounding shortcut gives the wrong answer, walk every quarterly deadline from 2024 to 2075, and verify that all ten boxes carry an explanation whose worked figure matches what the engine actually computes. The rate registry has 108, twelve of them added by this slice to prove that a construction gate which had never once been observed to fire actually fires. The screen's logic has 107 of its own, which is where the missing 5208B renderer was caught. The mutation battery runs fourteen deliberate sabotages and requires the suite to fail for every one.

The reason the screen has a test count at all is worth one sentence, because it is the whole reason that form was rescued. The page itself contains no decisions — not a colour, not a sentence, not a total, not whether a button may be pressed. All of it lives in a plain module that a test can call directly, and the page only arranges what that module returns. A rule that lives in the markup can only be checked by a human looking at it; a rule that lives in the module gets checked on every commit, forever.

This report itself is tested too, on the same principle as the last one: every statute quoted above is re-derived from the stored registry text on every commit, every figure is recomputed from the engine, and every count stated in prose is checked against the code. A report that quietly goes stale is worse than no report, because you would plan around it.

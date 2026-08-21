# Sage 50 payroll baseline — extracted 2026-08-21, sources deleted by owner instruction

This file is the **permanent record** of what Michael's live Sage 50 payroll actually
contained on 2026-08-21. He printed thirteen Sage reports and five real government
forms to PDF, uploaded them, and instructed: *"after you have documented everything you
need from the sage pdfs, i need you to delete them. these are just printed to pdf, they
live for real in sage, so deleting them does not hurt me in any way."*

The Sage PDFs are therefore **gone from the sandbox**. Everything below was mechanically
extracted with `pdftotext -layout` and then arithmetically re-verified in Python before
being written down. Nothing here is remembered, inferred, or rounded by hand. If a number
appears below, it either appeared verbatim in a source document or it is explicitly
labelled as a computation with its inputs shown.

The five government forms he described separately as reference documents were **not**
deleted, because he did not ask for that and rule 1 forbids guessing at the edges of an
instruction. They remain in the sandbox and their contents are also recorded here so that
this file stands alone even if they are later removed.

## Why this file exists

Michael's reframe governs this whole branch: *"There is this huge disconnect between me
and the system and it's dragging me down."* A payroll engine written against a rate table
alone is a guess about his business. A payroll engine written against **his own filed
returns** is a reconstruction of it. The Q2 2026 figures below are the acceptance criteria
for books-27 through books-30: when our engine produces a 941, it must reproduce these
numbers from the same wages, or one of us is wrong and we find out which.

There is a second reason. Reconciling these documents against each other surfaced **three
real defects in his live books** that nobody had caught, one of which has been silently
overpaying the state all year. Those are written up in full below.

---

## 1. Company identity (cross-verified across four independent filings)

Every field below appeared identically on more than one document, which is why it is
recorded as fact rather than as a single-source claim.

| Field | Value | Appears on |
| --- | --- | --- |
| Legal name | LYMAN'S MARIJUANA | 941, 940, 5208A, PFML, new-hire |
| Trade name | GREENWAY MARIJUANA | 941, 940, L&I dashboard, EAMS |
| Address | 4851 GEIGER RD SE, PORT ORCHARD, WA 98366 | 941, 940, PFML, new-hire |
| Federal EIN | 46-4217016 | 941, Schedule B, 940, 5208A, PFML, new-hire |
| WA UBI | 603 353 555 | 5208A, L&I dashboard |
| ESD account | 000-073905-00-0 (5208A prints `000739050 10 0` / `000739050100`) | 5208A, EAMS portal |
| PFML employer reference | C 603353555 (letter "C" + 9-digit UBI) | PFML return |
| L&I account | 521,756-00 | L&I dashboard |
| Signer | MICHAEL LYMAN, title OWNER | 941, 940 |
| Phone | 360-443-6988 (fax 360-443-6989) | 941, 940, 5208A, PFML |
| Sage company name | LYMAN'S | all thirteen Sage report headers |

The Sage company file is named `LYMAN'S`, not `GREENWAY MARIJUANA`. Every report header
says so. That matters for books-27: a report the system generates should be headed with
the name Michael expects to see, and the entity that files is the LLC, not the trade name.

## 2. Federal deposit schedule — ANSWERED by evidence, not by research

books-26 Phase 1 listed "deposit schedule (monthly vs semiweekly), the lookback-period
rule that DECIDES it" as an open research question. **The uploaded 941 answers it
directly and there is no ambiguity.**

Michael's Q2 2026 Form 941 carries a completed **Schedule B (Report of Tax Liability for
Semiweekly Schedule Depositors)** with liabilities recorded on individual dates. A monthly
depositor fills in Part 2 line 16 with three monthly figures and files no Schedule B at
all. The presence of a populated Schedule B, with per-date entries, means Greenway is a
**semiweekly schedule depositor**.

This is a determination we must therefore *reproduce*, not *decide*. The engine still
needs the lookback rule so it can tell him when his status is about to change, but the
current-state answer is now evidenced.

### Schedule B, Q2 2026 — every liability date, verbatim

| Pay date | Liability | Weekday (computed) |
| --- | --- | --- |
| 2026-04-03 | 2,089.76 | Friday |
| 2026-04-17 | 2,500.65 | Friday |
| 2026-05-01 | 2,066.54 | Friday |
| 2026-05-15 | 2,055.59 | Friday |
| 2026-05-29 | 1,776.45 | Friday |
| 2026-06-12 | 1,965.01 | Friday |
| 2026-06-26 | 1,750.57 | Friday |

Month totals as printed: Month 1 = 4,590.41, Month 2 = 5,898.58, Month 3 = 3,715.58.
Quarter total = 14,204.57.

Verified by computation: 2,089.76 + 2,500.65 = 4,590.41 exactly; 2,066.54 + 2,055.59 +
1,776.45 = 5,898.58 exactly; 1,965.01 + 1,750.57 = 3,715.58 exactly; the three months sum
to 14,204.57 exactly, which equals line 12. Every one of the seven dates is a **Friday**,
and consecutive dates are exactly fourteen days apart.

That last point is the mechanical confirmation of Michael's own statement, *"every two
weeks on friday"*. We now have his pay calendar proven from a filed federal return rather
than from memory. Seven biweekly Fridays in a quarter is the normal pattern (some quarters
carry seven pay dates, most carry six), which is itself a fact the reports engine will
need when it explains a quarter that looks unusually large.

## 3. Form 941, Q2 2026 (quarter ending 2026-06-30) — the reconciliation target

Every line as printed, with my independent recomputation beside it.

| Line | Description | Filed | Recomputed |
| --- | --- | --- | --- |
| 1 | Employees paid in the June 12 period | 8 | — |
| 2 | Wages, tips, other compensation | 68,923.45 | ties to 5208A and PFML |
| 3 | Federal income tax withheld | 3,659.35 | ties to Sage FIT total |
| 5a | Taxable social security wages × 0.124 | 8,546.51 | 68,923.45 × 0.124 = 8,546.51 ✓ |
| 5c | Taxable Medicare wages × 0.029 | 1,998.78 | 68,923.45 × 0.029 = 1,998.78 ✓ |
| 5e | Total SS + Medicare | 10,545.29 | 8,546.51 + 1,998.78 = 10,545.29 ✓ |
| 6 | Total before adjustments | 14,204.64 | 3,659.35 + 10,545.29 = 14,204.64 ✓ |
| 7 | Fractions-of-cents adjustment | −0.07 | see below |
| 10/12 | Total after adjustments | 14,204.57 | 14,204.64 − 0.07 = 14,204.57 ✓ |
| 13 | Total deposits | blank | — |
| 14 | Balance due | 14,204.57 | — |

Lines 5b, 5d, 5f, 8, 9, 11 are zero. Line 1 is **8**, while the PFML return reports **10**
employees for the same quarter and the 5208B wage detail lists **10** people. That is not
an inconsistency: 941 line 1 counts only those paid in the single pay period containing
June 12, whereas the state returns count everyone paid at any point in the quarter. Two
people (Stephen Benoit and Bailey Giovannini, four weeks each) had stopped being paid
before mid-June. The reports engine must never "fix" this by making the two numbers agree.

### The fractions-of-cents line is a real teaching moment

Line 7 is −0.07. The form's own printed note explains it: *"The amount in line 7 is
calculated based on LIABILITY amounts in either Line 16 if monthly or Schedule B if
semiweekly."* Line 6 is built from the aggregate quarterly wage base (68,923.45 × 12.4%
and × 2.9%). Schedule B is built by summing what was actually withheld and matched
paycheck by paycheck, where every individual computation was rounded to the cent. Those
two routes disagree by seven cents, and the IRS provides line 7 precisely so the return
can balance.

I verified the same effect at month scale independently: Sage's Tax Liability Report for
June computes a "941 Total" of **3,715.65**, while Schedule B's Month 3 says **3,715.58** —
a difference of exactly **0.07**. The whole quarterly adjustment arises in June.

This is the kind of number that makes an accountant distrust a system, because a
seven-cent unexplained difference looks like a bug. It is not a bug; it is the arithmetic
of rounding, and our engine must both produce it and *say so in plain English* rather than
silently plugging it.

## 4. Form 940 (FUTA) — filed for tax year **2025**, not 2026

The uploaded file is named `example_form_940_with_real_2026_data.pdf`, but the form itself
reads **"940 for 2025"** and its footer is `Form 940 (2025)`. The checkbox list even
offers *"No payments to employees in 2025"*. Whether the underlying wage figures are 2025
or 2026 is not something I can determine from the document, and I will not guess — see
the open questions in section 12.

| Line | Description | Value |
| --- | --- | --- |
| 1a | Single-state employer | WA |
| 3 | Total payments to all employees | 171,297.28 |
| 4 | Payments exempt from FUTA | 0.00 |
| 5 | Payments to each employee in excess of $7,000 | 95,592.77 |
| 6 | Subtotal | 95,592.77 |
| 7 | Total taxable FUTA wages | 75,704.51 |
| 8 | FUTA tax before adjustments (× 0.006) | 454.23 |
| 9, 10, 11 | Adjustments / credit reduction | 0.00 |
| 12 | Total FUTA tax after adjustments | 454.23 |
| 14 | Balance due | 454.23 |

Verified: 171,297.28 − 95,592.77 = 75,704.51 exactly; 75,704.51 × 0.006 = 454.23 exactly.
Part 5 (quarterly breakdown, required when line 12 exceeds 500) is blank, correctly, since
454.23 is under the threshold.

**Line 3 (171,297.28) equals the Sage Yearly Earnings Report's "Final YTD Total" gross for
1/1/26–12/31/26 to the cent.** So the 940's wage base was pulled from the same 2026 ledger
that produced the yearly report, even though the form is the 2025 revision. This is
recorded as an observation, not a conclusion about which year is correct.

WA is not a credit-reduction state here (line 11 is zero), so the full 5.4% credit applies
and the effective FUTA rate is 0.6%.

## 5. WA Form 5208A / 5208B, Q2 2026 — and the rate conflict

### 5208A, as filed

| Box | Description | Value |
| --- | --- | --- |
| 9 / 10 / 11 | Exempt corporate officers, their wages, stock options | 0 / 0.00 / 0.00 |
| 12 | Employees paid in period incl. 12th, by month | 9, 8, 8 |
| 13 | Total gross wages | 68,923.45 |
| 14 | Excess wages (taxable base $78,200) | 0.00 |
| 16 | Taxable wages | 68,923.45 |
| 17 | UI tax due — **rate printed as 0.0064** | 441.11 |
| 18 | EAF — **rate printed as 0.0003** | 20.68 |
| 19 / 24 | Total tax due / amount due | 461.79 |

Due date 07/31/26. Verified: 68,923.45 × 0.0064 = 441.11 ✓; × 0.0003 = 20.68 ✓; sum
461.79 ✓. Note box 12 gives 9/8/8 while 941 line 1 gives 8 — again the June-12 period, and
the two forms agree with each other on that month.

Excess wages are zero because no single employee has yet crossed the $78,200 base; the
largest annual figure in the yearly report is well under it.

### 5208B wage detail, Q2 2026 (ten employees)

All rows carry SOC code 41-2031 (Retail Salespersons) and "worked in WA".

| SSN | Name | Total = taxable wages | Hours |
| --- | --- | --- | --- |
| 531-23-1883 | STEPHEN BENOIT | 4,901.10 | 158 |
| 626-30-0724 | ANGELA BRITTON | 13,340.32 | 565 |
| 534-29-8006 | AUTUMN E CLARK | 8,313.22 | 479 |
| 608-37-6995 | DAYLIN A COLE | 7,554.16 | 441 |
| 358-80-5805 | LARRY E DEE | 8,589.15 | 466 |
| 590-47-8985 | BAILEY GIOVANNINI | 859.13 | 46 |
| 527-97-1943 | JERMAINE JOHNSON | 3,931.57 | 225 |
| 535-43-1068 | ZACHARY M SMITH | 5,690.50 | 332 |
| 536-17-4009 | ISANA SOLIS | 4,157.53 | 227 |
| 586-49-5156 | RAELENE Q TAITAGUE | 11,586.77 | 619 |

Verified: the ten wage figures sum to **68,923.45** exactly, matching 5208A box 13, PFML
gross, and 941 line 2. Total hours = 3,558.

Note that every employee's taxable wages equal their total wages, and that the same ten
figures appear on the PFML detail. One wage number feeds four different returns — which is
exactly the reconciliation the reports engine has to be able to demonstrate.

### 5208B is efile-only

Printed on the form: *"THIS REPORT IS EFILE ONLY"*, and 5208A is headed *"Form 5208A -
EFILE ONLY"*. This constrains books-30: for ESD we can prepare and reconcile the data, but
the transmission is a file, not a printed page. That matches the standing boundary — we
replace the data-preparation half, we do not become a filing agent.

## 6. WA PFML / WA Cares return, Q2 2026

| Field | Value |
| --- | --- |
| Employees reported | 10 |
| Total gross PFML wages | 68,923.45 |
| Total taxable PFML wages | 68,923.45 |
| Employee rate | 0.807159 % |
| Employer rate | 0.322841 % |
| Total premium rate | 1.130000 % |
| Employee withholding share | 71.43 % |
| Employer share | 28.57 % |
| Employee PFML premium | 556.32 |
| Employer PFML premium | 222.51 |
| PFML premiums this quarter | 778.83 |
| **Total WA Cares wages this quarter** | **0.00** |
| WA Cares premium rate (employee) | 0.58000 % |
| **WA Cares premiums this quarter** | **0.00** |
| Total amount due | 778.83 |

Verified: 68,923.45 × 0.00807159 = 556.32 ✓; × 0.00322841 = 222.51 ✓; the two sum to
778.83, which also equals 68,923.45 × 0.0113 ✓. Share percentages check out too:
0.807159 ÷ 1.13 = 71.43% ✓ and 0.322841 ÷ 1.13 = 28.57% ✓.

The employee wage detail lists the same ten people with identical wages and hours to the
5208B, plus dates of birth, and a "WA CARES WAGES" column that is **0.00 for every single
person**. See defect 3 in section 9 — this is the one I am least certain about and it needs
Michael's eyes.

Four statements printed on the return worth preserving, because they are the state's own
plain-English explanation of rules we have to encode:

- *"Employers with fewer than 50 employees are not required to pay the employer portion of the PFML premium."*
- *"PFML premium withholdings are capped at the Social Security limit, WA Care premiums are not subject to the SS limit."*
- *"WA Cares premium is paid by the employee. Employers won't pay any share of the premiums for their employees."*
- *"An employer can elect to pay all or some of their employees' share of the premium on their behalf."*

Greenway has ten to twelve people, so the small-employer exemption is available — yet the
return **charges the employer 222.51 anyway** and the exemption checkbox is not ticked. See
defect 4.

## 7. L&I workers' compensation

From `My_L&I_tax_rate_and_experience_factor.pdf` (a real L&I dashboard screenshot, still
in the sandbox, retained):

- Account: **LYMAN'S MARIJUANA LLC | WA UBI 603 353 555 | GREENWAY MARIJUANA, L&I Account ID 521,756-00**
- Experience factor: **0.9** — *"Your claim costs are lower than average."*
- Heading: **"Risk Classification & Rates (1)"**
- Class **6403 Stores: Specialty Groceries**
  - Hourly employee withholding: **$0.16445**
  - Hourly employer portion: **$0.39485**
  - Total hourly rate: **$0.5593**
- Account representative DESIREE VERES, 360-902-4284
- *"Quarter 3 deadline is 11/2/2026 11:59:59 PM"*

Verified: 0.16445 + 0.39485 = 0.55930 exactly.

**The open risk-class question is now answered.** The heading reads "Risk Classification &
Rates **(1)**" and exactly one class is listed. So 6403 is the only class on his account,
and the company-setup screen does not need to model multiple concurrent risk classes for
Greenway today. It should still refuse rather than assume if a second class ever appears.

I want to be precise about what this does and does not settle. It settles that L&I has
assigned one class. It does not settle whether that assignment is *correct* for people
doing delivery or maintenance work, which is a question for L&I and not for me.

### Michael is absorbing the employees' L&I share

The rate table records both halves, and the Sage journal charges the employer expense
account with the **full $0.5593 per hour**, not the employer's $0.39485. I verified this on
all eight June 12 paychecks: for example Angela worked 78.77 hours and Sage posted 44.06,
which is 78.77 × 0.5593 = 44.06 ✓, where the employer-only portion would have been 31.10.

Then I reconstructed net pay from gross for all eight and found each one to the cent using
only FIT, social security, Medicare, PFML and WA Cares as deductions. **No L&I is withheld
from anybody.** For instance Angela: 1,969.25 − 53.23 − 122.09 − 28.55 − 15.89 − 11.42 =
1,738.07, matching her check exactly.

So Michael voluntarily pays the employee half of workers' comp. Over the year the L&I
expense is 4,528.20, which at 0.5593/hr implies about 8,096 hours, meaning roughly
**1,331** of that is the employee share he chose to cover. That is allowed — it is the
same principle as the PFML line *"An employer can elect to pay all or some of their
employees' share"* — but it must be a **recorded, deliberate setting** in our system, not
an accident, and it belongs on the company-setup screen with that number shown.

## 8. What the Sage reports contained (the thirteen deleted files)

### 8.1 Employee List — 26 people, and a contradiction to resolve

Twenty-six employees are on file. Pay types as Sage recorded them:

- **Salaried (3):** JIM BECKER, **MICHAEL LYMAN**, THERESA BECKER (Teri L. Becker)
- **Hourly (23):** Angela Britton, Autumn Clark, Bailey Giovannini, Brandon Hall, Brian Berting, Colorado Flatt, Danielle Simmons, Daylin Cole, Emily Lamanna, Isana Solis, Jason Boehme, Jermaine Johnson, Jordan Alexander, Kiamaria Baston, Larry Dee, Luke A Meier, Michael Zenger, Myles Moylan, Raelene Taitague, Stephen Benoit, Taylor Klaus, Tristan Gerbing, Zachary Smith

Federal filing statuses in use: Single, Married, Married/Jointly, Head/Household, and
"Single/Married filing separately".

Michael's binding instruction for the new system was *"hourly for all employees, salary
for me"*. Sage has **three** salaried records. I am not going to reconcile that by
assumption — it is open question 1 in section 12.

### 8.2 Payroll Tax Report — FICA employee, quarter ending 2026-06-30

Ten employees, "Week" column showing pay periods (14 for most, 4 for Benoit and
Giovannini, 10 for Solis). Adjusted gross = taxable gross for everyone; no excess gross.

| Employee | Taxable gross | Tax |
| --- | --- | --- |
| ANGELA BRITTON | 13,340.32 | 827.08 |
| AUTUMN CLARK | 8,313.22 | 515.42 |
| BAILEY GIOVANNINI | 859.13 | 53.27 |
| DAYLIN COLE | 7,554.16 | 468.36 |
| ISANA SOLIS | 4,157.53 | 257.76 |
| JERMAINE JOHNSON | 3,931.57 | 243.76 |
| LARRY DEE | 8,589.15 | 532.52 |
| RAELENE TAITAGUE | 11,586.77 | 718.37 |
| STEPHEN BENOIT | 4,901.10 | 303.87 |
| ZACHARY SMITH | 5,690.50 | 352.81 |
| **Total** | **68,923.45** | **4,273.22** |

The individual amounts are each 6.2% of the individual wage, and they sum to 4,273.22.
Note that 68,923.45 × 6.2% computed on the aggregate is **4,273.25** — three cents more.
This is the same rounding phenomenon as 941 line 7, visible here at the social-security
level, and it is why the aggregate and the per-person sum can never be assumed equal.

### 8.3 Exception Report — the COGS/SALES split, and a genuinely useful control

Printed "for MED_COGS", as of 2026-06-30, covering all 26 employees with columns Taxable
Gross, Amt Withheld, Calculated Amt, Difference.

Summary: Q1 61,531.21 / −892.19; Q2 68,923.45 / −999.39; total 130,454.66 / −1,891.58 —
and **Difference is 0.00 on every row**.

I verified each of the ten Q2 amounts against 1.45% of that employee's wages and all ten
match, and 68,923.45 × 1.45% = 999.39 exactly. Note that 1.45% is the *employee* Medicare
half, and 68,923.45 × 2.9% = 1,998.78, which is 941 line 5c — both halves.

This report is worth copying in concept. It recomputes what should have been withheld,
compares it to what actually was, and shows the difference. That is exactly the "prove it
to me" control an accountant wants, and it is a strong candidate for the books-27 engine.
Michael said *"I don't use any of the reports in the screenshot really because I don't
understand fully what it is showing me"* — this one is understandable the moment the
columns are named in English, because a column of zeros in "Difference" means "nothing is
wrong", and any non-zero is a name and an amount to go look at.

Fifteen of the 26 employees show 0.00 wages for both quarters — inactive records still on
file. A report that lists 26 people to tell you about 10 is part of why these reports feel
unreadable.

### 8.4 Payroll Journal — Michael's real GL account structure

June 2026, balanced: total debits **21,095.90** = total credits **21,095.90**.

Distinct accounts observed, with the `-GRW` / `-GRN` department suffixes:

- **71000-GRW, 71002-GRW, 71003-GRW, 71004-GRW, 71006-GRW, 71007-GRW** — the 71xxx series
- **72000-GRW, 72001-GRW, 72002-GRW, 72003-GRW, 72004-GRW, 72005-GRW, 72006-GRW, 72007-GRW** — the 72xxx series
- **32000-GRN … 32007-GRN** and **33000-GRN … 33007-GRN** — liability side
- **30003, 30010, 30013, 30016, 30018, 30020, 30021, 30022-GRN** — net pay per employee
- **30993-GRN, 30994-GRN** — loan and other deductions (Isana: 100.00 loan, 158.41 other)

The pattern is legible: one employee's gross goes to a 71xxx or 72xxx expense account,
each tax is credited to a 3xxxx liability account **and** debited to a matching 7xxx
employer-expense account when the employer owes a share, and net pay credits a per-employee
30xxx account. Angela sits in the 71xxx/32xxx block; the other seven sit in 72xxx/33xxx.

This is the COGS-versus-SALES labour split the payroll-cogs work already models, expressed
in his real chart of accounts. Angela is being coded to a different block than the rest,
which is presumably a management-versus-floor distinction; I have not verified that and
have not assumed it.

### 8.5 Payroll Check Register — June 2026

Sixteen checks, references 7021–7028 (6/12) and 7047–7053, 7056 (6/26), totalling
**15,389.06**. Eight people paid on each date. Reference numbers are not contiguous across
the two runs (7028 → 7047, and 7056 sits apart from 7053), meaning other non-payroll checks
were issued in between from the same sequence.

### 8.6 Direct Deposit Pre-Sync Report — empty

*"This report contains no data."* Filter was "Posted Transactions only; Direct Deposit
Employees" for June 2026. So **nobody is on direct deposit** — Greenway pays by physical
check, consistent with the check register above. That is a real design input: our system
must not assume ACH.

### 8.7 Employee Compensation Report — completely empty of data

All 26 employees listed with Raise Date, Applicable Rate, Base Amount, Raise Amount, Raise
Percentage, New Amount and Raise Notes — **every one of those columns is blank for every
employee.** The report has structure and no content.

This is the single clearest illustration of Michael's complaint. A raise-history report
that has never been populated tells him nothing, so he doesn't open it, so it stays empty.
Whatever our system does here, it must be fed automatically by the act of changing
someone's pay rate, or it will be just as empty.

### 8.8 Vacation and Sick Time Report — negative balances

June 2026, per employee, YTD accrued / taken / remaining:

| Employee | Accrued | Taken | Remaining |
| --- | --- | --- | --- |
| ANGELA BRITTON | 23.99 | 72.00 | −48.01 |
| AUTUMN E. CLARK | 15.08 | — | 15.08 |
| DAYLIN A. COLE | 13.73 | — | 13.73 |
| ISANA SOLIS | 7.72 | 83.00 | −75.28 |
| JERMAINE JOHNSON | 11.66 | 8.00 | 3.66 |
| LARRY E. DEE | 23.04 | 45.45 | −6.41 |
| RAELENE Q. TAITAGUE | 19.60 | 49.55 | −29.95 |
| ZACHARY M. SMITH | 10.50 | — | 10.50 |

Four of eight are negative. Angela's own beginning balance was already −10.58 before June.

I verified the accrual rate against each June 12 paycheck and it is consistently **one hour
per forty hours worked**, counting regular and overtime hours but **excluding** paid sick
hours themselves. Angela worked 38.77 and accrued 0.97 (38.77/40 = 0.969); Larry worked
44.97 with 13.45 sick and accrued 1.12 (44.97/40 = 1.124), not 1.46. Daylin's 59.80 hours
gave 1.50, which is 1.495 rounded half-up. Eight for eight.

One-per-forty is the RCW 49.46.210 statutory floor, so the accrual **rate** is compliant.
The negative balances mean he is letting people take sick leave they have not yet accrued —
advancing it. That is permissible and generous; it is not a violation. But it needs to be
a deliberate, visible policy in our system rather than an artefact, and the report should
say "advanced 48.01 hours" instead of showing a bare negative, because a negative balance
reads like a bug.

### 8.9 Current / Quarterly / Yearly Earnings Reports — the column layout problem

These three share one layout with **thirty-three** value columns wrapped over eight
physical lines per employee, which is precisely why they are unreadable. The column names,
recorded in full:

`Amount, Gross, FIT_COGS, SS_COG, MED_COGS, SICK_Accrue, SICK_Remain, SICK_Taken,
FIT_SALES, SS_SALES, MED_SALES, WAPFML_COG, WAPFML_SAL, WALTC_COG, WALTC_SAL, DCH_01,
DCH_02, DCH_03, LOAN_01, SS_COGS_C, MED_COGS_C, FUI_COGS_C, SUI_COGS_C, SUI2_COGS_C,
PREMERA_C, DELTA_C, SS_SALES_C, MED_SALES_C, FUI_SALES_C, SUI_SALES_C, SUI2_SALES_C,
WALIER_COG, WALIER_SAL, FEE_C`

Decoded, with confirmations where I could verify them arithmetically:

- `_COGS` / `_COG` vs `_SALES` / `_SAL` — the labour split between cost of goods sold and selling expense. **Confirmed:** WALTC_COG 606.48 + WALTC_SAL 387.13 = 993.61, and 0.58% of the annual 171,297.28 is 993.52.
- Trailing `_C` — the **company** (employer) side of a tax. So `SS_COGS_C` is the employer's matching social security on COGS labour.
- `FIT` federal income tax; `SS` social security; `MED` Medicare; `FUI` FUTA; `SUI` state unemployment; **`SUI2` the EAF surcharge**; `WAPFML` paid family and medical leave; **`WALTC` WA Cares** ("long-term care", its original name); `WALIER` the L&I employer rate.
- `PREMERA_C`, `DELTA_C` — employer-paid medical and dental. `DCH_01..03` deductions, `LOAN_01` employee loan repayment, `FEE_C` a company fee.

Annual "Final YTD Total" for 1/1/26–12/31/26: gross **171,297.28**, net **139,570.59**,
FIT −8,697.08, SS −10,620.43 (employee) and −10,620.43 (employer), MED −2,483.83 each
side, FUTA −454.19, SUI −1,096.32, EAF −134.04, WA Cares −993.61, L&I −4,528.20,
loans −1,000.00.

Verified against the annual gross: SS at 6.2% = 10,620.43 ✓ exact; Medicare at 1.45% =
2,483.81 against 2,483.83 recorded (two cents of per-paycheck rounding); SUI at 0.64% =
1,096.30 against 1,096.32; FUTA 75,704.51 × 0.6% = 454.23 against 454.19.

Quarterly report, Q2: gross 68,923.45, net 56,100.02, FIT −3,659.35, SS −4,273.22,
MED −999.39, PFML −556.29, WA Cares −399.76 (253.65 COGS + 146.11 SALES), SUI −441.13,
EAF −66.73, L&I −1,960.15. YTD through Q2: gross 130,454.66, net 106,350.39.

Two of those Q2 figures **do not match the filed returns**, and the EAF one is large. That
is section 9.

---

## 9. Defects found in the live books

I did not go looking for these. They fell out of cross-footing the documents against each
other, which is exactly what the reports engine is supposed to do for him automatically.

### Defect 1 — the EAF surcharge is being charged at 0.64% instead of 0.03% for at least one employee

Sage's own Tax Liability Report for June prints its workings, and they contradict
themselves. Under `WASUI2 C` (the EAF) it shows:

```
WASUI2 C   16,542.26   0.03000    4.96
WASUI2 C    2,378.84   0.64000   15.22
```

Two different rates applied inside one tax for one month. The 2,378.84 base is **Daylin
Cole's** June wages, and his detail line reads 15.23 where 0.03% of 2,378.84 is only 0.71.
He was charged the **UI** rate on the **EAF** line. The two bases do sum correctly to the
June total (16,542.26 + 2,378.84 = 18,921.10), so this is a rate error, not a wage error.

Scale of it, all computed:

- June, Daylin alone: 15.23 charged against 0.71 correct — **14.52 overstated**
- Q2: Sage's EAF total is **66.73**, but the filed 5208A box 18 says **20.68**, and 0.03% of 68,923.45 is 20.68. The 46.05 gap is explained almost exactly by Daylin's Q2 wages of 7,554.16 × (0.64% − 0.03%) = 46.08.
- Year to date: Sage shows **134.04** where 0.03% of 171,297.28 is **51.39** — **82.65 overstated**. Daylin's H1 wages account for 57.33 of that, so **at least one other employee has the same misconfiguration**.

The good news is that the *filed* 5208A used the correct 20.68, so the state was not
overpaid on this. The bad news is that the general ledger and the return disagree, which
means his books overstate payroll tax expense and understate profit, and the accrued
liability will not clear when he pays. This is a live reconciliation break.

### Defect 2 — the UI rate on the filed return does not match ESD's own rate notice

This one is bigger, and it goes the other way: it is real money out the door.

`employment_security_tax_rate.pdf` is a screenshot of ESD's EAMS portal, "Check Tax Rates",
for GREENWAY MARIJUANA, ESD # 000-073905-00-0, tax year 2026. It states plainly:

- UI tax rate 2026: **0.37%**
- Tax class: Regular Taxable Employer
- EAF rate: **0.03%**
- Annual taxable wage base: **$78,200.00**
- **Total employer tax rate: 0.4%**

The filed Q2 5208A used **0.0064** for UI. Sage's ledger agrees with the 0.64% figure
(1,096.32 annual, and 171,297.28 × 0.64% = 1,096.30).

Computed exposure, if 0.37% is the correct 2026 rate:

- Q2 UI paid 441.11 against 255.02 owed — **186.09 overpaid in one quarter**
- Annualised: 1,096.30 against 633.80 — **462.50 overpaid for the year**
- Together with defect 1's 82.65 of ledger overstatement, roughly **545** is mis-stated

**I am not asserting Michael overpaid.** There are innocent explanations I cannot rule out
from the documents in front of me: 0.64% may have been his 2025 rate carried into the Sage
tax table and never updated after ESD issued the 2026 notice, or the EAMS screenshot may
post-date a rate revision. The screenshot is dated 8/19/26 and the return was prepared
8/21/26, which makes the "stale Sage tax table" explanation the more likely of the two, but
likely is not proven. This is open question 2.

What is certain is that **two documents in his own records disagree about his own tax
rate**, and nothing in his current toolchain told him. Our rate registry already refuses to
serve a rate it cannot evidence, which is exactly the right instinct; this is the case that
justifies it. Note the repo currently records `wa_suta_total` as 400 milli-percent (0.40%
= 0.37% + 0.03%) sourced to the ESD notice, so **the repo agrees with EAMS, not with
Sage.** Our table is already the more defensible of the two.

### Defect 3 — WA Cares is withheld from paychecks but reported to the state as zero

Sage withheld WA Cares all quarter: Q2 total 399.76 across the `WALTC_COG` and
`WALTC_SAL` columns, which is exactly 0.58% of 68,923.45. I verified it per paycheck as
well — Angela 11.42 on 1,969.25 gross is 0.58% to the cent, and all eight June 12 checks
match.

The filed PFML/WA Cares return reports:

- TOTAL WA CARES WAGES PAID THIS QTR: **0.00**
- WA CARES PREMIUMS THIS QTR: **0.00**
- and the per-employee detail shows **0.00 WA Cares wages for all ten people**

So money was taken from ten employees' pay and the state was told there were no WA Cares
wages. If that is what actually happened, it is the most serious of the three, because it
involves employee money.

I want to be careful here, because there are legitimate reasons a WA Cares figure can be
zero: every employee might hold an approved exemption, or the premium might be reported on
a separate WA Cares filing rather than this combined form. But the return's own
"EMPLOYEE EXEMPT?" column is **blank for all ten**, not ticked, and the same form does
report PFML wages of 68,923.45 for those same people — so the zero is not because the form
excludes them generally. That combination is hard to explain innocently, which is why it
goes to Michael rather than into a conclusion.

### Defect 4 — the small-employer PFML exemption may be unclaimed

The return prints *"Employers with fewer than 50 employees are not required to pay the
employer portion of the PFML premium"* and offers a checkbox: *"Check this box if you are
exempt from paying the employer portion of the premium (fewer than 50 employees)."*

The box is **not checked**, and the return charges an employer share of **222.51** for the
quarter. Greenway reported ten employees.

This may well be deliberate — an employer can choose to pay it, and there may be a
threshold definition (headcount averaged over a period, not a single quarter's count) that
I should not assume. But at roughly 222 per quarter it is on the order of **890 a year**,
and it deserves a deliberate answer. This is open question 3.

---

## 10. What this changes for books-26 and beyond

**Answered without further research:**

1. Federal deposit schedule is **semiweekly**, evidenced by a populated Schedule B. The engine must still implement the lookback rule, but to *confirm and monitor* rather than to decide from nothing.
2. L&I has exactly **one** risk class, 6403, experience factor 0.9. The multi-class screen design is unnecessary for now.
3. Michael **absorbs the employee L&I share** — this must be an explicit company-setup setting.
4. **Nobody is on direct deposit.** Payment is by check. Do not assume ACH.
5. Pay cadence is **biweekly Friday**, proven from seven Schedule B dates fourteen days apart.
6. Sick leave accrues at **one hour per forty worked**, excluding sick hours from the base, and negative balances are advanced leave.
7. The company file is named **LYMAN'S**; the filer is the LLC, the trade name is Greenway.

**Firm reconciliation targets for books-27 through books-30.** Given Q2 2026 wages of
68,923.45 across ten employees, a correct engine must produce: 941 line 2 68,923.45, line 3
3,659.35, 5a 8,546.51, 5c 1,998.78, 5e 10,545.29, line 6 14,204.64, line 7 −0.07, line 12
14,204.57, and a Schedule B matching the seven dates above; 5208A box 13 68,923.45 and box
16 68,923.45; PFML employee 556.32 and employer 222.51. Any engine that cannot reproduce
these from the same wage inputs is wrong.

**The fractions-of-cents adjustment is a first-class feature, not an afterthought.** It
appears at three levels in his data (941 line 7 at −0.07, the June 941 total differing from
Schedule B Month 3 by 0.07, and social security aggregate-versus-sum differing by 0.03).
Our engine must compute it, place it on line 7, and explain it in one plain sentence.

**Copy the Exception Report's idea, not its layout.** Recompute, compare, show the
difference. That single control would have caught defect 1 immediately, since Daylin's EAF
would have shown a non-zero difference.

**Thirty-three columns wrapped over eight lines is the disconnect made visible.** When we
build the reports engine, no report gets a column whose name we cannot say in English.

## 11. Provenance

| File | Pages | Fate |
| --- | --- | --- |
| Current_Earnings_Report_08212026.pdf | 11 | deleted per instruction |
| Direct_Deposit_Pre-Sync_Report_08212026.pdf | 1 | deleted per instruction |
| Employee_Compensation_Report_08212026.pdf | 3 | deleted per instruction |
| Employee_List_08212026.pdf | 2 | deleted per instruction |
| Exception_Report_08212026.pdf | 3 | deleted per instruction |
| Payroll_Check_Register_08212026.pdf | 1 | deleted per instruction |
| Payroll_Journal_08212026.pdf | 5 | deleted per instruction |
| Payroll_Register_08212026.pdf | 5 | deleted per instruction |
| Payroll_Tax_Report_08212026.pdf | 1 | deleted per instruction |
| Quarterly_Earnings_Report_08212026.pdf | 19 | deleted per instruction |
| Tax_Liability_Report_08212026.pdf | 6 | deleted per instruction |
| Vacation_and_Sick_Time_Report_08212026.pdf | 4 | deleted per instruction |
| Yearly_Earnings_Report_08212026.pdf | 38 | deleted per instruction |
| example_form_941_with_real_qtr_2_data.pdf | 3 | retained (not covered by the instruction) |
| example_form_940_with_real_2026_data.pdf | 2 | retained |
| example_form_5208_with_real_qtr_2_data.pdf | 3 | retained |
| example_form_washington_state_paid_family_and_medical_leave_with_real_qtr_2_data.pdf | 2 | retained |
| example_new_hire_form.pdf | 2 | retained |

All thirteen Sage reports were produced by "Amyuni PDF Converter version 5.5.0.3" on
2026-08-21 between 10:17 and 10:23 local. The five forms were produced by "Microsoft: Print
To PDF" the same day and are Aatrix-generated, each stamped "Draft Copy" and "Do Not File".
The two rate documents (L&I dashboard, EAMS portal) were captured 2026-08-19 from Chrome.

The new-hire form additionally records four hires with full SSN, date of birth, address and
hire date: AUTUMN E CLARK (534-29-8006, 10/13/1993, hired 01/13/2026), DAYLIN A COLE
(608-37-6995, 11/30/2002, hired 02/13/2026), LUKE A MEIER (307-13-5597, 08/27/1992, hired
07/23/2026), ZACHARY M SMITH (535-43-1068, 08/05/1999, hired 01/14/2026). It is DSHS form
18-463 (rev. 04/2023), filed with the Division of Child Support, and it defines a new hire
as *"an employee who has never worked for you before, or a former employee who has returned
after a separation of at least 60 consecutive days"*, with date of hire being *"the date on
which the employee first performed services for pay"*. Reporting channels are SAW online
(preferred), phone 800-562-0479, fax 800-782-0624, or mail to NEW HIRE REPORTING, PO BOX
9023, OLYMPIA WA 98507-9023.

Full SSNs for all ten Q2 employees are recorded in section 5 because the 5208B prints them
and Michael's standing instruction is that SSNs are stored in full and masked in the UI for
everyone but the owner. Sage's own reports mask them as `XXX-XX-####` (and inconsistently,
as `XXXXX5805` for Larry Dee — a formatting bug worth not reproducing).

## 12. Open questions for Michael — do not resolve by assumption

1. **Salaried records.** Sage has three salaried people (Jim Becker, Michael Lyman, Theresa Becker) but the instruction for the new system was *"hourly for all employees, salary for me"*. Are Jim and Theresa still employed, and should they be salaried at cutover?
2. ~~**The UI rate.**~~ **ANSWERED 2026-08-21 by the filed EAMS return (section 13.1): 0.37 % is correct.** Sage's 0.64 % is stale and overstates UI by 186.09 a quarter. Nothing was overpaid to ESD; the correction is Sage-side for the rest of 2026.
3. ~~**PFML employer share.**~~ **WITHDRAWN (section 13.2).** The filed return shows Employer Medical 0.00 and Employer Family 0.00 — the small-employer exemption is already being taken. The 222.51 came from a Sage worksheet, not from the filing.
4. ~~**WA Cares.**~~ **WITHDRAWN (section 13.2).** The filed return reports 399.76, the correct figure. The zeros were a Sage printout artefact.
5. **Form 940 year.** The uploaded 940 is the **2025** revision, yet its line 3 matches the 2026 yearly gross exactly. Which tax year does it actually represent?
6. **Inactive employees.** Fifteen of 26 have zero wages in both quarters. Which should migrate to the new system at all?
7. **The 71xxx vs 72xxx split.** Angela is coded to a different expense block than the other seven. What distinguishes her?

## 13. The filed returns themselves (uploaded 2026-08-21) — questions 2, 3 and 4 ANSWERED

Sections 5, 6 and 9 above were written from Sage's *printouts*. Michael then uploaded the
**returns as actually filed with the agencies**, which are the higher authority: a Sage
report says what Sage believes, while an EAMS confirmation page says what the State of
Washington received and assessed. Where the two disagree, the filed return wins. Michael's
own reading was *"sage is probably wrong, our research is recent... so our system has the
right data i think"*, and the documents prove him right on every point.

### 13.1 EAMS unemployment return, Q2 2026 — confirmation G2413C8A6HP330LL

Filed 2026-07-31 for ESD account 000-073905-00-0, total due **$275.70**. The return prints
its own rates:

| item | rate the RETURN prints | amount |
| --- | --- | --- |
| Gross / total taxable wages | — | 68,923.45 |
| UI tax due | **0.37 %** | 255.02 |
| EAF tax due | **0.03 %** | 20.68 |
| **Total** | | **275.70** |

Verified mechanically: 68,923.45 × 0.0037 = 255.02 exactly; × 0.0003 = 20.68 exactly; the
two sum to 275.70, the amount assessed. The ten employee rows sum to 68,923.45 and the hours
to 3,558, both matching the printed totals. Ten employees; April 9, May 8, June 8.

**This closes open question 2, and it reverses what section 5 recorded.** Section 5 read
0.0064 off the Sage-generated copy of the 5208A. The FILED return says **0.37 %**, and only
0.37 % reproduces the dollars the State actually charged. Sage's 0.64 % is stale. Had 0.64 %
been correct the UI line would have been 441.11 rather than 255.02 — an overstatement of
**186.09 for the quarter**. The correction belongs in Sage for the remainder of 2026, which
is Michael's stated plan; nothing was overpaid to ESD, because ESD billed from its own rate.

### 13.2 Paid Family & Medical Leave / WA Cares, Q2 2026 — customer C603353555

Submission type **Original**, for April–June 2026.

| item | amount |
| --- | --- |
| Paid Leave premiums withheld | 556.32 |
| — Employer Medical | **0.00** |
| — Employer Family | **0.00** |
| — Employee Medical | 182.01 |
| — Employee Family | 374.31 |
| WA Cares premiums withheld | 399.75 |
| **Total WA Cares premiums** | **399.76** |
| Exemptions reported | 0 |

**This closes open questions 3 and 4, and both were false alarms.**

Question 3 asked whether the small-employer PFML exemption had been missed. The filed return
shows **Employer Medical 0.00 and Employer Family 0.00** — the employer share is not being
paid, which is exactly the treatment a business under fifty employees is entitled to. The
222.51 that section 6 flagged was read from a Sage worksheet, not from the return. There is
no ~890/yr recovery to pursue, because there was never an overpayment.

Question 4 asked why 399.76 of WA Cares was withheld but reported as zero. The filed return
reports **399.76** — the correct figure, to the cent. The zeros were an artefact of the Sage
printout, not of the filing. Nothing is missing from the State's records.

### 13.3 L&I quarterly report, Q2 2026 — confirmation 12616784

Filed 2026-07-31 for L&I account 521,756-00. Account manager DESIREE VERES, 360-902-4284.

| class | nature of work | gross payroll | hours | rate/hour | owed |
| --- | --- | --- | --- | --- | --- |
| **6403-05** | Stores: Specialty Groceries | 68,923 | 3,558 | 0.5593 | 1,989.99 |

Verified: 3,558 × 0.5593 = 1,989.99 exactly. The hours tie to the EAMS return's 3,558 and the
gross to its 68,923.45 rounded to the nearest dollar, as L&I requires. **One risk class only**
— confirming what section 7 recorded and what books-26 assumed.

### 13.4 Form 941, Q2 2026 — with Schedule B attached

| line | description | amount |
| --- | --- | --- |
| 2 | Wages, tips, other compensation | 68,923.45 |
| 3 | Federal income tax withheld | 3,659.35 |
| 5a | Taxable social security wages 68,923.45 × 0.124 | 8,546.51 |
| 5c | Taxable Medicare wages 68,923.45 × 0.029 | 1,998.78 |
| 5e | Total social security and Medicare | 10,545.29 |
| 6 | Total taxes before adjustments | 14,204.64 |
| 7 | Fractions-of-cents adjustment | −0.07 |
| 10 | Total taxes after adjustments | 14,204.57 |
| **12** | **Total after adjustments and credits** | **14,204.57** |

Every line recomputed and matched exactly. Two things follow.

First, **line 2 (68,923.45) is identical to the EAMS gross and to the L&I gross.** Three
separate agencies, three separately filed returns, one wage base. That is the cross-foot that
makes this quarter trustworthy as a reconciliation target.

Second, **line 12 is 14,204.57 — bit-for-bit the fixture the books-26 deposit-schedule engine
was built on** (`Q2_2026_LINE12 = 1_420_457` cents). The engine's semiweekly determination was
computed from this number before the filed return was in hand; the filed return now confirms
the input. And the return carries **Schedule B**, which only semiweekly depositors file, so the
determination is confirmed a second way by the government's own form.

### 13.5 What section 9's defect list looks like now

| # | as first written | status after reading the filed returns |
| --- | --- | --- |
| 1 | EAF charged at 0.64 % instead of 0.03 % | **STANDS.** The filed return proves 0.03 % is correct, so the GL's 0.64 % is wrong. |
| 2 | UI rate conflict, 0.37 % vs 0.64 % | **RESOLVED — 0.37 % is correct.** Sage is stale. Fix in Sage for the rest of 2026. |
| 3 | PFML small-employer exemption possibly unclaimed | **WITHDRAWN.** Employer share is 0.00 on the filed return; the exemption is being taken. |
| 4 | WA Cares withheld but reported as 0.00 | **WITHDRAWN.** The filed return reports 399.76 correctly. |

Two real, two artefacts of reading Sage instead of the filing. That distinction is the whole
lesson: **a printout is evidence of what a program believes, and only a filed return is
evidence of what was filed.** Where this document quotes Sage, it is now labelled as such.

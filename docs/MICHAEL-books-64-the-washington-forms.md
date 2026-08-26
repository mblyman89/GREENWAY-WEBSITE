# The Washington forms — and the $166 your books disagree about

**Slice books-64 · 26 August 2026 · Greenway Marijuana**

---

## What you asked for

> "Let move into the Washington forms. Please work on esd first, then pfml/ wa
> cares second. The later is one form and one upload. I gave you the upload
> requirements. When we go to do the pdf exports, we will need an export .csv for
> esd and pfml/ wa cares. Please research the upload structure and requirements
> for esd while building these forms and learning lessons on boxes that bite.
> Follow the standing rules and stay within budget. Never guess."

That is what this slice did, in that order. ESD first, Paid Leave and WA Cares
second, a .csv for each, and lessons on the two boxes that actually bite.

But I have to lead with something else, because it is about real money and it is
in your books right now rather than in mine.

---

## The thing you should look at first: your Sage copy disagrees with ESD

I read your filed Q1 2026 Form 5208A — both versions of it, the EAMS
confirmation and the Sage "Record Copy" — with a text extractor rather than by
eye. They do not agree, and the disagreement is not small.

**Sage's record copy prints:**

- an unemployment tax rate of **0.0064** (0.64%)
- a taxable wage base of **$72,800**

**What Employment Security actually charged you:**

- an unemployment tax rate of **0.37%**
- a taxable wage base of **$78,200**

These are not my calculations — both documents state their own figures, and I
quote them. Your EAMS confirmation for Q1 2026 (code G0632D997H63JG44, submitted
19 March 2026) reads:

```
Gross wages          $61,531.21
Excess wages              $0.00     Annual taxable wage base: $78,200.00
Total taxable wages  $61,531.21
UI tax due             $227.66      Unemployment Insurance - Rate 0.37%
EAF tax due             $18.46      Employment Administration Fund - Rate 0.03%
UI and EAF charges     $246.12
```

The Sage record copy of the same quarter prints `UI tax rate: 0.0064`, a taxable
wage base of `$72,800`, **17) UI TAX DUE THIS QUARTER 393.80** and **19) TOTAL
TAX DUE 412.26**.

So the same quarter is recorded two ways: **$246.12** by Employment Security and
**$412.26** by Sage. That is **$166.14 in one quarter** — and the pattern repeats
in Q2, where ESD billed $255.02 and 0.64% would give $441.11.

**You paid the right amount.** ESD billed 0.37% and 0.37% is what left your bank.
This is not a filing problem and you do not owe anyone money. It is a
*bookkeeping* problem: if Sage is accruing unemployment tax at 0.64%, then your
payroll tax expense and your accrued liability are both overstated, and your
margins look worse than they are.

I have not "fixed" this, and I want to be explicit about why: it is a figure in
*your* records produced by *your* software, and quietly overwriting it would
destroy the evidence that the two ever disagreed. It is written up as defect
**D-14** in `docs/DEFECTS.md` with both figures and where each came from. This is
one to put in front of your CPA — it is exactly the kind of thing that is easier
to correct in August than in January.

The system itself uses **0.37% and $78,200**, because those are the figures on
your own 2026 rate notice from ESD.

---

## The wrong line number I caught before it reached your screen

My own plan for this slice recorded the ESD total as **line 24**. I went and read
your filed returns instead of trusting my note, and the returns say:

```
19) TOTAL TAX DUE   Add lines #17 and #18
24) AMOUNT DUE      Add lines #19, #20, #21, #22, and #23
```

Lines 20 through 23 are penalty, interest, late-report penalty and any prior
balance. This system does not compute any of those — so if I had printed your tax
figure at line 24, the form would have been *asserting that you owe no penalty
and no interest.* That is a claim I have no basis for making on your behalf.

So the worksheet stops at **line 19**, and there is now a test that fails if line
24 ever appears. It is written up as **D-13**.

There was a second trap in the same area. The blank Form 5208A sitting in your
files is from **2011** — I checked its metadata rather than assuming. It numbers
these same lines 12, 13, 14, 15, 16 and prints a wage base of **$37,300**. Had I
laid your figures onto that artwork, every amount would have printed one to two
lines above its own caption and the wage base on screen would have contradicted
your actual filing by $40,900.

---

## Why the ESD form is a worksheet and not a picture of the form

You asked, in an earlier slice, to see forms "as it would look if I were holding
it in my hand," and I have built exactly that for the 941, the 940, the W-2 and
the W-3. For the ESD returns I have deliberately **not** done it, and the reason
is a rule rather than a preference:

> "Paper forms supplied by the department (or an approved version of those forms).
> Agency forms include "drop-out ink" that cannot be copied. Therefore,
> photocopies are considered incorrectly formatted reports and forms."
> — WAC 192-310-010(3)(c)(ii)

An incorrectly formatted report earns an incomplete-report penalty. Your own
filed 5208s are stamped **"THIS REPORT IS EFILE ONLY."** A beautiful facsimile of
a 5208A would be a penalty waiting to be posted.

I also measured both blank ESD PDFs for fillable fields, the way the federal
pipeline reads them: **zero fillable rectangles on either form.** There is no
geometry to read, so producing a facsimile would have required me to invent
coordinates — which is guessing.

What you get instead is the honest version: **your real figures beside the line
numbers and captions as printed on the return you actually file**, so
transcribing into EAMS is reading across a row. The screen says plainly that it
is a worksheet and not a filing copy, and that sentence is built into the data
rather than into the page, so a future screen cannot show the numbers without it.

---

## The two boxes that bite

You asked for lessons on "boxes that bite." The ESD return has exactly two, and
neither of them is a box this system calculates — which is precisely why they
bite. Nothing disagrees with you when you get them wrong.

**Line 14, excess wages.** Every other figure on this return is about the
quarter. This one counts from 1 January. Unemployment tax is charged on the first
**$78,200 each person earns each year**, and once somebody passes that, the rest
of their pay is free of it. The bite is that the ceiling is **per person, per
year** — not a company allowance and not a quarterly one. Your Q1 and Q2 both
correctly report **$0.00** excess, because your largest single earner was at
$13,996.50 for the quarter, nowhere near the ceiling. The lesson works through
what happens later in a year when someone does cross it, and shows the check that
catches an error: gross minus excess must equal taxable, to the penny.

**Line 12, the 12th-day headcount.** Three small boxes asking how many people
were on the payroll in the pay period containing the 12th of each month. No tax
depends on it, so it gets filled in from memory or copied from the number of rows
on the wage detail. **Your own Q1 proves that shortcut is wrong**: eleven people
appear on the wage detail, and the three counts you filed were **10, 11 and 9**.
Not one of the three equals eleven and no two equal each other. Anyone who
started after the 12th, left before it, or was on unpaid leave across it is paid
during the quarter but absent from that month's count.

This system does **not** compute the headcount, and the worksheet says so on its
face. It is a fact about who was on your roster on three specific dates, not a
fact about the quarter's wages, and I am not going to invent it.

---

## The two upload files, and why they now have buttons

Both .csv writers exist and both are now reachable from the page. This mattered
more than it sounds: the Paid Leave / WA Cares writer had been finished **eight
slices ago** and had no caller anywhere in the application. 511 lines of correct,
spec-checked code that no screen could reach. That is defect **D-11**, now fixed.

The two files are both eight columns and they are **not interchangeable** —
different column order, and one needs a header row while the other must not have
one. There is a test whose only job is to prove those two files can never look
alike. On the page they are two separate buttons, each naming its own portal.

The EAMS file carries full Social Security numbers, so it is served with caching
switched off and the page tells you to delete it from your downloads once
uploaded.

While wiring that up I found that the store was reading three columns off your
employee records that **had never been created**: date of birth, WA Cares
exemption, and the SOC occupational code the state requires. Found by checking
rather than assuming (defect **D-12**). Migration 0207 adds them, and I proved it
against a real PostgreSQL server rather than reasoning about it — which was the
right call, because PostgreSQL's pattern matching is unanchored and would
otherwise have silently accepted a seven-digit SOC code as valid.

---

## What I did not do, and what it cost

Adding those two lessons turned **seven tests red in five files I never touched**
— the roadmap's lesson counts and four earlier owner-report gates. None was a bug
in the new work. Each was a promise made to you in a previous slice, pinned so it
cannot quietly stop being true.

I did not edit those old numbers to make the red go away. Each report keeps the
sentence you originally read, today's real figure is pinned beside it, and a
floor is added so coverage can never drop below what you were told. Where a
number moved, the reason is recorded.

One of the seven turned out to be a genuine defect in the *guard* rather than a
stale count: it compared a naive count against a hardcoded 72, because the
accurate counter was locked inside a different test. A hardcoded number on that
line has to be hand-edited every time a test is added, which is how a guard rots.
It now measures both sides.

---

## Where things stand

| | |
| --- | --- |
| Full test suite | **11,564 passing** across 470 files |
| Type checking | clean |
| Verbatim authority quotes | 345 verified character-for-character |
| Washington lessons | 14 → **16** |
| Defects recorded this slice | D-10 through D-14 |

The Washington forms are now built: the ESD 5208A worksheet on filed line
numbers, the wage detail, the Paid Leave / WA Cares premiums, and both upload
files with buttons that work.

**Two things worth your attention:**

1. **The Sage rate and wage base (D-14).** Real money, in your books today, worth
   raising with your CPA.
2. **Q1's rounding (D-10).** Your Q1 UI and EAF figures cannot both be reproduced
   by any single rounding rule I can find. Q2 reproduces perfectly to the cent.
   I have left this **unresolved and written down** rather than inventing a rule
   the legislature did not write. It is worth one question to ESD.

Next, per your ordering: the PDF export of the forms, now that the form set is
complete.

# The 941 is finished — and three things were quietly wrong

**Slice books-53 · Form 941, from 13 lines to all 27**

Michael — you asked me to proceed with the 941, to keep testing everything
including the tests, to break it and fix it, and to point out any pre-existing
warnings so we can decide together whether to fix them.

There were three. All three are now fixed. One of them would have put a wrong
number on a government portal, so I want to explain it in plain language before
anything else.

---

## The short version

Form 941 is the quarterly federal payroll return you file. Before this slice the
application could explain **13** of its lines. It now explains **all 27** — every
single box on the form you actually filed last quarter, with nothing left over
and nothing invented.

| | before | after |
|---|---|---|
| Lines the app can teach | 13 | **27 — the whole form** |
| Full written lessons | 5 | **20** |
| Lines with "whose money is this" recorded | 13 | **27** |
| Word-for-word IRS quotes behind them | 6 | **28** |

Every one of those 28 quotes is checked letter by letter against the real IRS
instruction file on every single test run. Not one was typed by hand — they are
cut mechanically out of the source document, because anything I retype is
something I could get subtly wrong.

---

## Warning 1: the app called a line "15" when the IRS calls it "15a"

This is the one that mattered most, and it is exactly the kind of thing you asked
me to flag.

The line where an overpayment goes — where you tell the IRS you paid more than
you owed — was labelled **15** inside the application. The printed form and the
IRS instructions both call it **15a**.

Here is why that is not a cosmetic problem. You told me:

> *"I need accurate numbers and I need a way to visualize them so I can reproduce
> them on my various tax agency portals."*

You read a label off the screen and type the number into that box on the portal.
If the screen says 15 and the portal says 15a, 15b, 15c, 15d and 15e, you are
one hesitation away from putting an overpayment figure into a box that means
something completely different. **15b** is a tickbox choosing refund or
carry-forward. **15c** is a bank routing number.

No test anywhere asserted what that line was called. That is precisely why it
survived. It is fixed, and the label is now checked against the printed form.

---

## Warning 2: twenty of twenty-four lines could have been silently mislabelled

This is the one I found by deliberately breaking the code, and it is the most
important thing in the slice.

Every line on the 941 is tagged with **whose money it is** — your money, your
employees' money, a shared 50/50 tax, or not money at all. That tag drives how
the figure is presented to you. Getting it wrong means the app tells you a tax
was yours to pay when it was actually withheld from a worker's cheque, or the
reverse.

So I tried to break it. I changed **line 5d** — the Additional Medicare Tax — from
*"the employee's money"* to *"shared 50/50 with Greenway."*

That is flatly false. The IRS instruction file sitting in this repository says,
word for word:

> "Additional Medicare Tax is only imposed on the employee. There is no employer
> share of Additional Medicare Tax."

**All 11,046 tests passed.** The application would have happily told you that
Greenway owed half of a tax that Greenway owes nothing toward.

Then — and this is the part the standing rules require, because I am not allowed
to take credit for a problem I caused myself — I checked whether I had just
introduced this hole or merely walked into an old one. I mutated **line 13**, a
line that has been untouched since a much earlier slice. That passed too.

So the hole was **pre-existing**. It was not created by this slice. What this
slice did was widen the exposure, because I grew the form from 13 lines to 24
and every new line inherited the same lack of protection. Only four lines — 1, 2,
3 and 5a — had ever had a test guarding their ownership. The other twenty could
be relabelled at will and nothing would object.

**What I did about it.** I could have written one assertion about line 5d and
called it fixed. That would have closed one hole and left nineteen open, and the
next line added to the form would have arrived unprotected all over again.

Instead every one of the 27 lines is now written down in a table, by hand,
checked against the printed form and the instructions, and compared against what
the application believes on every test run. It is checked in **both** directions:

- if a line's ownership ever changes, the tests fail and name the line;
- if a **new** line is ever added without someone recording whose money it is,
  the tests fail and say so.

Then I proved it works the only way that means anything: I re-broke all 27 lines,
one at a time, 27 separate experiments. **27 caught, 0 survived.** Before this
change, 23 of those 27 would have sailed straight through.

---

## Warning 3: a file had been gutted, and only the type-checker noticed

Partway through this slice I found that `form-box-adapters.ts` — the file holding
all the ownership rules — had been **cut from 869 lines to 136**. Nineteen of its
twenty pieces were simply gone, including a safety gate added in the previous
slice.

The unsettling part: the tests I would naturally have run still passed. They
passed because the tests that check the missing pieces could no longer even find
them, so they quietly did nothing.

What caught it was the **type-checker**, in about four seconds, before I ran a
single test. The lesson is now written into the roadmap: the test runner in this
project compiles code *without* checking types, so a green test suite tells you
nothing about whether a file is still in one piece. Type-check first, always.

Nothing was lost. I rebuilt the file mechanically from the last known-good
version, keeping only the new work, and verified that all twenty pieces came back
before moving on.

---

## And one mistake of my own, which I want on the record

I found four sentences in the new lessons with a stray line break and six spaces
of code indentation baked into the middle of them — invisible to every automated
check, plainly visible to you reading the screen.

I fixed them. My fix **created five more problems**: three of the four sentences
already ended in a space, so I turned single stray breaks into double spaces, and
a fifth instance I had not even spotted went untouched.

Then the cleanup script I wrote to fix *those* reached too far and reflowed **your
own words** — the verbatim quote of your instructions at the top of the lessons
file. I caught that only because I read the diff line by line instead of trusting
a green test run.

Everything is correct now, and there is a permanent gate so this whole class of
defect cannot come back. I am telling you because "break it, fix it better"
should include the times I am the thing that broke it.

---

## Where the forms actually stand — measured, not estimated

I asked the application itself to count, rather than trusting my own notes:

| Form | Boxes taught | Status |
|---|---|---|
| **Form 941** (quarterly federal payroll) | **27** | ✅ **complete — every line** |
| Form W-2 (wage statement) | 20 | ✅ complete |
| Form 940 (annual FUTA) | 18 | 3 lines still missing |
| **Form W-3** (W-2 transmittal) | **0** | ⚠️ **listed as taught, teaches nothing** |
| WA 5208A (ESD quarterly tax) | 3 | thin |
| WA 5208B (ESD wage detail) | 4 | thin |
| WA PFML + WA Cares | 3 | thin |
| WA L&I quarterly | 4 | thin |
| DOR Combined Excise | 0 | not started |

**A fourth pre-existing warning, found while writing this report.** Form W-3 is
registered in the app as a form it teaches, but it has **zero** content. The good
news is the code refuses to render it rather than showing you a blank form
pretending to be real — it stops with a clear error. But it is a gap, and you
should know it is there. It is small: the W-3 is just the summary sheet that
totals your W-2s, and the W-2 behind it is already complete.

**A correction to my own roadmap, too.** My notes said the 941 had 25 boxes and
listed "15c" and "15e" while omitting "15d". Both were wrong. I re-measured by
reading the labels straight out of your filed `2ND_QTR_FORM_941.pdf`, and the
real answer is **27** — line 15 splits five ways, 15a through 15e. Had I trusted
my own notes instead of your actual form, I would have shipped this slice three
lines short while telling you it was finished. The count now comes from the form.

The last three lines, 15c/15d/15e, are the bank details for a refund by direct
deposit. They are the only boxes on the whole form that hold **bank
credentials**, so their teaching examples deliberately contain no digits at all —
enforced by a gate that scans every example on every form for fabricated figures.

---

## Budget

| | |
|---|---|
| Spent before this slice | $24,000 |
| Credits in hand at slice start | $2,000 |
| Authorised after those | $6,000 |
| **Runway** | **$8,000** |
| Ceiling you set yourself | $30,000 |

This slice was deliberately cheap on your wallet and heavy on verification:
mostly mechanical text extraction and mutation testing, which is where the value
per token is highest.

---

## What I recommend next

Your stated priorities, in your order:

1. **Finish the lessons** — 940 needs 3 lines; the four Washington forms are thin;
   DOR Combined Excise has nothing. The W-3 gap above joins this list.
2. **Build the physical forms** — the visual layout you can read numbers off and
   reproduce on the agency portals. You called this "truly useful," and I agree
   it is the thing that changes your working day.
3. **Connect the books** — the ATM, the intercompany rent, and the bank feeds.

On point 3, I want to be careful about something. You said:

> *"I don't think they are connected to the books."*

That is a belief, not a verified fact, and the standing rules say I must not
build on either until I have measured it. So the first thing in that slice will
not be building anything — it will be **measuring exactly what posts to the
journals today and what does not**, and showing you the answer. If bank feeds
turn out to be partly connected, building a second path would create duplicate
entries, which is worse than the gap. I will find out first, then build.

My recommendation is to keep going in your order. Coverage before cosmetics has
been paying off — the two real defects in this slice were both found *because*
the coverage work forced me to look at every line on the form.

---

## Your open questions — still five, unchanged

Repeated in full, every report, until closed.

| # | Question | Who can answer | Status |
|---|---|---|---|
| 1 | The two LLC legal names — confirm the crossed naming is right, and supply UBI/EIN for each | Grandpa (Nicholas) | **OPEN** |
| 2 | The Schedule C industry codes appear **swapped** between the two businesses, and rent sits on Schedule C rather than Schedule E — which has a self-employment tax consequence | Grandpa (Nicholas) | **OPEN** |
| 4 | How were the health premiums reported for each Becker, and is the FICA treatment in boxes 3 and 5 intended? | Grandpa (Nicholas) | **OPEN** |
| 5 | Is Nicholas paid as compensation (W-2/1099) or as a distribution? | Grandpa (Nicholas) | **OPEN** |
| 6 | Intercompany rent between the entities is not modelled at all yet | build slice | **OPEN** |

**Question 3 is closed**, thanks to your answer: James was not an employee in
2024, 2025 or 2026 — he was on the books like your mother Theresa for health
insurance benefits, and neither takes distributions. That closes the missing-W-2
mystery: it is expected, not lost.

One caution I do not want buried. Your answer settles the *arrangement*. It does
not by itself settle the *payroll-tax* question, because a W-2 for Teri Becker
**does** exist, showing $11,029.32 of health coverage in box 14 and matching box
1, with nothing withheld. Whether that reporting is right is a different test —
and that is question 4, for grandpa.

---

## How to check every word of this

Nothing here rests on my say-so:

- Type-check: **0 errors**
- Lint: **0 problems**
- Word-for-word authority check: **315 quotes verified**
- Full test suite: **449 files, 11,047 tests, all passing**
- Ownership mutations: **27 attempted, 27 caught, 0 survived**
- Every new gate proven capable of failing before being trusted
- Standing rules file: **0 deletions**

All three CI checks passed on GitHub before this merged: `compliance`,
`migrations`, and `build`. Then I re-ran the entire verification on the merged
main branch, not just on my working copy — because a check that only passes in
the place you did the work is not a check.

Pull request **#1038**, merged as commit **b0f33c34**.

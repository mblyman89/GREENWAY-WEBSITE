# What got built — Form 940, the W-3, and one period picker everywhere

**Slice books-63.** For Michael Lyman, Greenway Marijuana.

---

## The short version

Form 940 and Form W-3 now print as real paper, filled from your own figures. And
every form page in the system now has the same period picker in the same place,
with your selection in the web address.

Along the way the work found **six real defects**. Two of them would have put a
wrong return in front of you, and one of those had eleven thousand passing tests
sitting on top of it.

---

## Form 940 — both pages, and deliberately not the third

The annual FUTA return now renders on the IRS's own artwork, measured rectangle
by rectangle out of their PDF: 59 input areas on page 1, 31 on page 2.

Page 3 of the official file is **Form 940-V**, the payment voucher you detach
and post with a cheque. It is not rendered. Greenway pays by EFTPS, and printing
a voucher nobody should use only invites somebody to use it.

Page 2 is not optional, and this is worth knowing: it carries **Part 5**, the
four quarterly FUTA liabilities, and their total **must equal line 12 exactly**.
That is the only arithmetic on the 940 that checks itself. A one-page 940 would
have looked finished while omitting it.

The whole form carries a gold banner saying **every cent on it is your money**.
Not one penny of FUTA is withheld from an employee, it never appears on a W-2,
and withholding it would be unlawful. The headline rate is 6.0% on the first
$7,000 you pay each person, but the state unemployment credit takes most
employers to 0.6% — so this return turns more on what you paid Washington than
on what you paid your staff.

When the year has not been computed, **every money box is blank, not zero**. A
zero on a 940 is a statement to the IRS that no such wages were paid.

## The W-3 — put where you can check the addition

The W-3 has **no page of its own**, on purpose. It is a *transmittal*: every
figure on it is a sum of the W-2s behind it. So it renders at the top of the
W-2 sheet, directly above the forms it adds up, where you can check the
arithmetic by eye.

It is **hidden when you have one employee selected**, because batch totals
sitting above a single person's W-2 read as that person's figures.

## The period picker — the professional answer to your question

You wrote: *"I am not sure the smart industry standard or professional way to do
it."*

In filing software it is a **persistent bar**, in the same place on every
screen, with the selection **in the web address**. That buys three things:

- you can send a CPA a link to "the Q2 941" and he lands on exactly that;
- **Back** does what it looks like it does;
- the period is visible while the figures are on screen, so you can never read
  Q2's numbers under a Q3 heading.

It is on all seven form surfaces — the tabbed pages and the printed-form pages —
and on the quarterly forms there is a row labelled **"Same quarter, another
year:"** that jumps a year while *keeping* the quarter. That is the comparison
you actually make, and it used to take four clicks.

You asked for this to work with "the full form workflow and all its tabs and
pages", so it is a **gate**, not a hope: the test suite goes and finds every
form page for itself and fails if any one of them rolls its own picker.

---

## The six defects

Four were found by writing the picker, and two by looking at the finished pages.

**1. Two pages would have computed a return for the year 1.** The rule for
"which period do we show by default" was written out **six separate times**, and
`?year=` was validated three different ways. Two pages checked only that the
number was a number — so `?year=1&q=1` was accepted, and would have produced a
Washington return for the year 1. One rule now, bounded, in one file.

**2. Changing the year silently cleared the employee.** On the W-2 sheet, if you
were looking at one person and clicked another year, you got everybody again
without being told.

**3. A substituted period was shown under a heading that agreed with it.** If
you asked for something impossible, the system quietly showed you something
else. It now says so out loud, in gold.

**4. The rectangle-coverage gate was protecting three pages out of seven.** The
test that proves no box on a form goes unfilled had been pointed at a
hand-written list of three pages. Schedule B, both 940 pages and the W-3 were
never covered by it. It now discovers the pages for itself.

**5. `normaliseEinInput` — the fix you asked for in this slice.** Your EIN is
stored as nine bare digits, because the database insists on it. The IRS prints
it as **46-4217016**, with a hyphen, on your CP 575 letter and on the top of
every return you have ever filed. So the shape you would naturally paste in was
the one shape the database rejected — and you would have got a raw Postgres
constraint error for your trouble. A function to fix exactly this had been
written months ago and was **called from nowhere**. It is now wired in, so
hyphens and spaces are fine to type. A genuinely unparseable EIN is **refused by
name and nothing is saved** — deliberately not stored as blank, because a blank
EIN reads as a field you had not got to yet.

**6. A live Form 940 printed with no EIN, no name and no address.** This is the
one to know about.

The 940's engine computes numbered lines, and the code returned only those. So a
real 940 produced your entire FUTA calculation under a **completely anonymous
header** — on *both* pages, and the 940 repeats your name and EIN on page 2
precisely because the two sheets get separated in handling.

**Why no test caught it.** The identical defect was found on the 941 and the W-2
back in books-61 and fixed on both. The 940's test was left reading
`expect(boxes.length).toBe(lines.length)` — an exact equality that made the
*absence* of your name a **requirement**. So 11,555 passing tests were actively
defending the bug on the one form nobody had looked at.

**Why nothing looked wrong.** The blank teaching form has no name boxes either,
so the page renders identically with and without the defect — right up until the
year closes, real figures arrive, and you file it.

It was found by **looking at the rendered page** with realistic figures in it.
That is the third time in three slices that the only thing that caught a
filing-grade defect was a pair of eyes on the paper. Both fixes now come from
**one shared piece of code** used by both returns, so a third form cannot be
written without it.

---

## What is next, in your order

1. **PDF export**, after all the forms including the Washington ones — as you
   asked, that comes once the set is complete.
2. **ESD 5208A/B and PFML / WA Cares**, if the budget allows.
3. L&I is skipped: there is no form.

Then the ATM feed, intercompany rent and bank feeds.

## One thing to note about verification

CI does not run on the kind of push I make, so I ran all four of its steps here
instead: type checking clean, **11,559 tests across 470 files** passing, the
pure self-tests, the quote verifier (345 authorities checked against local
copies), and linting. Plus one deliberate look at each new page — which is what
found defect 6.

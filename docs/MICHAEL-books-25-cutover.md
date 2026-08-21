# Your migration question, answered

**How Greenway moves onto this payroll system for the January 1, 2027 first payroll**

---

Michael, you asked at the start of this branch how we get you from where you are
now onto this system, and I said I would answer it at the end of the slice
rather than guessing at the front. Here it is.

The short answer is that you picked the one date that makes this easy, and I do
not think you picked it by accident.

## Why January 1 is the whole answer

Payroll migrations go wrong in one specific place: **year-to-date wage totals.**

Several payroll taxes stop at a ceiling. Social Security stops after the first
$184,500 of wages in a calendar year. Federal unemployment stops after $7,000.
Washington unemployment stops after $78,200. Washington paid family leave stops
at the same ceiling as Social Security. Each of those is a *running total for the
calendar year*, and each has its own separate definition of which wages count —
there are seven of these running totals in this system, deliberately kept apart,
because collapsing them into one "year to date wages" figure is how people
compute the wrong tax.

If you switched systems in, say, July, the new system would have to be told all
seven of those running totals, for every employee, exactly right. Get one wrong
and the error does not announce itself. It hides until an employee crosses a
ceiling that the system thinks is further away than it really is, and then you
under-withhold or over-withhold for the rest of the year and find out on a W-2.
That is the classic mid-year conversion disaster, and it is genuinely nasty
because it is invisible while it is happening.

**On January 1, all seven of those totals are zero.** Not "close enough to
zero," not "we reconstructed them from the old system" — actually, legitimately
zero, because a new calendar year has started and every ceiling has reset by
law. There is nothing to carry over and therefore nothing to carry over
incorrectly.

The system already encodes this. There is a constant called `ZERO_YTD` holding
all seven accumulators at zero, which is exactly and only the correct starting
state for a January 1 cutover. You are not migrating year-to-date payroll data.
You are declining to have any.

That removes the single biggest risk in the entire exercise, and it means the
plan below is genuinely short.

## What actually has to move

Only three things, and none of them are calculated figures:

**1. The employees themselves.** They are already in this system — the
`employees` table has existed since the timeclock work, and the setup screen
reads its roster from there. Nothing to import.

**2. Each employee's W-4 and I-9, entered by hand on the new screen.** I want to
be direct that this is manual, and that manual is the right call rather than a
shortcut. These come off paper the employee signed. The form year printed on
that paper decides which half of the IRS withholding worksheet runs, the
signature date decides whether it is a valid form at all, and the I-9 document
list decides whether you are compliant with immigration verification. None of
that is safely inferable from a Sage export, and every one of those fields is
one the new screen will refuse to let you leave wrong. Typing them in *is* the
audit — you will find out during entry which of your existing W-4s are unsigned,
which are on an obsolete form year, and which I-9s are missing a document.

I would rather you discover that in December 2026 with time to fix it than have
me import it silently and have you discover it under examination.

**3. Each employee's pay information.** Hourly rate, pay frequency, labor role
for the §280E split, hire date. Also manual, and also short. Your Sage rates all
read `0.00`, so there is nothing there worth importing even if I wanted to.

## What does *not* move, and why that is fine

**Historical paychecks.** They stay in Sage. You do not need them in this system
to run 2027 payroll, because 2027 withholding depends only on 2027 wages. What
you *do* need them for is the 2026 W-2s and the fourth-quarter 2026 941, and
those are produced from Sage because Sage is where 2026 payroll actually
happened. Keep Sage readable through the 2026 filing season for that reason
alone — through roughly April 2027, and keep the data files permanently.

**The general ledger side of payroll.** That is books-26 and later. The setup
screens record *who* and *how much*; the posting rules that turn a payroll run
into journal entries come after.

## The sequence I would follow

**Now through books-26 — build.** Company payroll setup: Greenway's federal and
state tax accounts, deposit schedule, the L&I risk class assignment, and the
minimum wage figure properly sourced. That slice also closes the one field the
employee screen currently ships blank.

**Around November 2026 — dry run with one employee.** Set up a single person
end to end on the new system while Sage is still running the real payroll. Then
compare: same gross, same federal withholding, same Social Security, same
Medicare, same Washington deductions, to the penny. If the two disagree, one of
them is wrong and we find out which with four months to spare rather than four
days. I expect disagreements, and I expect some of them to be Sage.

**December 2026 — enter everyone, run parallel.** All employees onto the new
system, and one full pay period computed on both systems side by side without
paying anyone from the new one. Same comparison, every employee. This is the
real gate.

**Late December 2026 — the checklist is the go/no-go.** The screen already
refuses to save an incomplete employee, so "every employee saves cleanly" is a
verifiable condition rather than a judgement call. That is the point of building
the gate before building the migration.

**January 1, 2027 — cut over cold, with all seven accumulators at zero.**

**Through April 2027 — Sage stays readable** for the 2026 W-2s, W-3, and the
Q4 2026 941. It is a reference, not a system of record.

## What I need from you, and when

**Before November:** the physical W-4s and I-9s for every current employee, or
confirmation of where they live. If any are missing, unsigned, or on a
pre-2020 form, that is a thing to fix in 2026 — a new signed W-4 is a five
minute conversation now and a finding later.

**Before the December parallel run:** one real Sage paycheck stub per employee,
for the comparison. Actual figures, so the dry run has something to be checked
against instead of checking itself.

**Not needed at all:** year-to-date totals, historical journal entries, the Sage
payroll tables. January 1 makes them irrelevant, which is the nicest sentence in
this document.

## The honest risk assessment

The thing most likely to go wrong is not arithmetic — the withholding engine is
tested against the IRS publications and will be tested again against your real
stubs. It is **paperwork you do not know is defective yet.** An unsigned W-4, a
missing I-9 document, an employee whose hourly rate nobody ever actually
recorded because Sage let it sit at zero. This system will refuse all three,
which means the pain arrives during setup instead of during payroll.

That is the trade, and I want to name it plainly: **the new system will be
harder to set up than Sage was, and that difficulty is the product.** Sage was
easy to set up because it never checked anything. Every hour this costs you in
December 2026 is an hour of a problem you would otherwise have met in the middle
of a pay period, or in front of an examiner, without knowing it was coming.

You said the point of this system is to replace your grandfather with something
that both protects you and teaches you. A cutover that refuses to start until
the paperwork is genuinely complete is the protecting half. Finding out in
December exactly which of your files are defective — and why each one matters —
is the teaching half.

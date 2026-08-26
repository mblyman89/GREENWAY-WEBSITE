# THE DEFECT REGISTER

Standing rule 131. Every real defect gets ONE numbered entry here: what broke,
how it stayed hidden, and the gate that now catches it. Everywhere else - code,
test, commit message, owner report - CITES the number ("see D-03") instead of
retelling the story. books-61 told the missing-EIN story four times at length;
that is what this file exists to stop.

A defect earns an entry when it (a) shipped or would have shipped, and (b) would
have looked correct to a reader. Bugs caught by the compiler are not defects;
they are typos.

---

## D-01 - Form 941 rendered with no EIN, no business name and no address

**Found:** books-61, by dumping the rendered attribution as text rather than by
looking at the picture.

**What broke:** 18 rectangles on page 1 and 32 on page 2 - the entire entity
block, which is to say every box that says WHO the return is for - were never
bound to anything. The form rendered, the figures were right, and it could not
have been filed by anybody.

**How it hid:** a blank name box on a form looks like a form nobody has started
yet, not like a form that is broken. Nothing was counting rectangles, so nothing
complained.

**Gate:** `derive-form-box-map.py` now refuses to emit a map unless every
rectangle on the page is either bound to a box or listed with a written reason,
and `form-facsimile-core.test.ts` asserts the same property from the data side.

---

## D-02 - The W-2 sheet filled the top form and left the bottom one blank

**Found:** books-61, by measuring whether the page's rectangles partition into
translated groups, having previously only ever screenshotted the top of the page.

**What broke:** the IRS W-2 Copy B page carries TWO W-2s at a 396.0pt pitch.
Half of every sheet was going unfilled.

**How it hid:** every screenshot taken while building the map was cropped to the
top form, so the picture looked finished.

**Gate:** `copy_partition` measures the number of copies with no reference to any
field name, and `FormFacsimile` refuses more data than the sheet has forms.

---

## D-03 - W-2 money figures printed without their cents

**Found:** books-61, by checking the output against Michael's own filed W-2
rather than against my expectation of it.

**What broke:** money was split into dollars and cents whenever the box was a
money box, then only the dollars half was printed. On the 941 that is correct -
the cents have their own rectangle. On the W-2 there is no second rectangle, so
`$60,000.00` printed as `60000`, and `11029.32` would have printed as `11029`.

**How it hid:** it understates by at most 99 cents, on a copy the employee files
with their own return, and every printed figure still looks like a real figure.

**Gate:** whether a form splits money is read per-field from the agency's own
`/MaxLen`, never inferred from a width - see D-04 for the sequel.

---

## D-04 - "Cents boxes have /MaxLen 3" was true of two forms and assumed of all

**Found:** books-62, before writing Schedule B, by measuring its `/MaxLen`
values instead of reusing the constant.

**What broke:** nothing yet - this was caught one step before it shipped.
`CENTS_MAX_LEN = 3` was a single global constant. Schedule B (Form 941) uses
`/MaxLen` **2** for its cents boxes. Under the old constant every one of the 93
daily liability cells and all four totals would have found no cents rectangle,
so `2089.76` would have printed as `2089.76` crammed into the dollars box and
the cents box beside it would have stayed empty.

Widening the constant to "2 or 3" was the obvious fix and is also wrong: W-2
box 12 uses `/MaxLen` 2 for its CODE boxes, so a global widening would have
started splitting box 12's amounts into a code box.

**How it would have hidden:** on a form whose whole purpose is looking like the
paper, a figure sitting slightly wrong inside its own rule reads as a font
problem, not as a wrong number.

**Gate:** the cents `/MaxLen` is now measured per page by the derivation script
and carried in the box map as `centsMaxLen`, with `null` meaning "this form does
not split money". `form-941-schedule-b-core.test.ts` pins all four values.

---

## D-05 - Schedule B does not reconcile to line 12 unless it is built to

**Found:** books-62, by reading Michael's own filed Q2 2026 Schedule B and
reproducing its arithmetic.

**What broke:** the naive construction of a daily liability - federal income tax
withheld, plus employee FICA actually withheld, plus the employer FICA stored on
the same payroll line - does NOT sum to line 12. It cannot, because the 941
computes lines 5a and 5c ONCE on the quarter's aggregate wage base, while the
payroll lines rounded each levy on each cheque. The difference is the
fractions-of-cents residual that line 7 exists to carry.

The IRS is explicit that this is not a small matter:

> Your total liability for the quarter must equal line 12 on Form 941.
> - Instructions for Schedule B (Form 941) (Rev. 6-2025)

**How it would have hidden:** by a few cents. A Schedule B that is 7 cents off
line 12 looks completely normal, is arithmetically self-consistent down every
column, and is the kind of discrepancy that produces a notice months later.

**Gate:** `scheduleBLiability` derives the employer share as the RESIDUAL the
941 itself implies - `line 5a + line 5c - (employee FICA by statutory rate)` -
and allocates it across paydays by largest remainder, so the quarter total
equals line 12 by construction. The function then asserts that equality and
REFUSES rather than printing a schedule that does not tie. See rule 129(e).

---

## D-06 - Two of line 16's three ticks were never placed, including the one he uses

**Found:** books-62, by counting which rectangles box "16" actually offers a
reader after Schedule B made line 16 worth clicking.

**What broke:** line 16 of Form 941 is a three-way declaration - under $2,500,
monthly schedule depositor, or semiweekly schedule depositor. Only the first
tick, `c2_1[0]`, was bound to box 16. The other two sat in the unclaimed list
described as "not ticked", which is a reason for leaving a box EMPTY, not a
reason for making it unreachable. Michael is a semiweekly filer, so the single
tick that declares Schedule B is attached was the one nobody could click.

**How it hid:** an unticked checkbox and an unbindable checkbox are the same
picture. The page rendered, every rectangle was accounted for by rule 123, and
the form looked complete because a blank tick is what a blank tick looks like.

**Gate:** `NINE41_LINE16_TICKS` binds all three by the sentence the IRS prints
beside each one, verified against the page's own text at derivation time, never
by field index - `c2_1[1]` and `c2_1[2]` are indistinguishable by name, and
transposing them would tell the IRS a semiweekly depositor is a monthly one.
`form-941-schedule-b-boxes.test.ts` asserts the caption each placed tick sits
against, so a future re-derivation cannot silently swap them.

---

## D-07 - Correctly-empty money boxes printed "0 00" on any form that splits cents

**Found:** books-62, by LOOKING at the rendered Schedule B once (rule 130(c))
after the data-level tests were already green.

**What broke:** `paperText` refuses to print a figure for a box flagged
`blankOnPurpose` - that gate was written for D-03, so a W-2 box 16 stays blank
instead of claiming Washington withheld zero state income tax. But `slotsFor`
does not use `paperText` on the dollars/cents SPLIT path. It re-derives the
halves from `amountCents` and suppressed them on `notComputedYet` ALONE. So
every money box that was deliberately blank, on any form with separate cents
rectangles, printed `0` and `00`.

On Schedule B that is 86 of the 93 day cells: every day Greenway did not pay
wages showed a liability of zero.

**Why that is not cosmetic:** Schedule B is a DAILY liability form. The IRS
reads a filled space as "wages were paid that day and this much tax became
due". 86 zeros is a positive statement about 86 days, on a schedule whose only
job is to say WHICH days carry liability, filed under penalties of perjury.
The three real paydays a month would have been surrounded by 28 declarations
that nothing happened - which is a claim, not an absence.

**How it hid:** every data-level test passed, because they all assert
`quarterTotal === line12Cents` and the arithmetic was never wrong. The zeros
are in the RENDERING, and the two conditions differ only on boxes that are
simultaneously blank-on-purpose and money-with-split-cents - which no form had
until Schedule B, where it is 86 of 100 boxes. Reading the figures as text
would not have caught it either; `0 00` reads as a real entry.

**Gate:** the flag `slotsFor` takes now means "this box prints nothing", set
from EITHER reason at the one call site that knows both, so the split path and
the single-rectangle path cannot diverge again.
`form-941-schedule-b-core.test.ts` asserts that a day with no payday emits no
text in either of its two rectangles, and that the count of filled slots equals
the paydays plus the totals plus the header.

---

## D-08 — `normaliseEinInput` exists, is correct, and is wired to nothing

**Found:** books-63, during the rule-130(c) visual check, by probing
`paperEin("46-4217016")` and getting `null`.

**Severity: low, and the null was RIGHT.** `company_profile.ein` carries a
database constraint `check (ein = '' or ein ~ '^[0-9]{9}$')`, so the stored
shape is nine bare digits and `paperEin` refusing a hyphenated string is the
correct behaviour on the read path. Every form renders the EIN correctly from a
stored value. Nothing filed is wrong. This is recorded rather than fixed
because it costs money to fix and files nothing incorrectly today.

**The actual gap is on the WRITE path.** `normaliseEinInput` in
`company-identity-core.ts` strips hyphens and spaces and then insists on nine
digits — written precisely because, in its own words, "someone copying from a
CP 575 letter will include" them. It is referenced in exactly two places: its
own definition and its mentor-gate entry. `saveCompanyProfile` does not call
it; it calls `.trim()` and hands the string to Postgres.

So pasting `46-4217016` — the shape the IRS itself prints on the CP 575 — fails
the CHECK constraint, and the owner is shown a raw Postgres constraint-violation
message. That is the exact failure mode this whole system exists to avoid:
being stopped without being told anything useful. The fix is one call in
`saveCompanyProfile` plus an assertion that a hyphenated EIN round-trips.

---

## D-09 — a live Form 940 printed with no EIN, no name and no address

**Found:** books-63, by the rule-130(c) visual check, on the LIVE adapter rather
than the teaching specimen. This is D-01 recurring on a third form.

**What it was:** `form940Boxes` mapped `ret.lines` and returned only those. The
engine computes numbered lines, so a real Form 940 produced its whole FUTA
arithmetic — payments, the $7,000 excess, taxable wages, tax, line 12, line 17
— under a **completely anonymous header**, on BOTH pages. Page 2 of the 940
repeats the name and EIN precisely because the sheets get separated in handling,
so both halves of the return were unidentifiable.

**Why it survived a green suite of 11,555 tests.** The assertion in
`form-box-adapters.test.ts` read:

```
expect(form940Boxes(ret).length).toBe(ret.lines.length);
```

An exact equality, which made the absence of the entity area a **requirement**.
The sibling assertions for the 941 and the W-2 were both upgraded in books-61
when this identical defect was found on those two forms. The 940's was not. So
the test suite actively defended the bug on the one form that had not been
looked at.

**Why it was invisible on screen.** The teaching specimen has no entity boxes
either, so the sheet renders identically with and without the defect until a
year is closed and real figures arrive — at which point the form is filed. Rule
23's exact failure mode: the instance was fixed twice and the class never was.

**Fix:** the block moved out of `form941Boxes` into a shared
`employerEntityBoxes(formId, formLabel)`, called by both adapters. The 941's
`FORM_940_WHOSE`-equivalent table is not extended, because
`assertEvery940LineOwnershipIsPinned` pins that table to exactly the 30 numbered
lines; the entity facts are not per-form facts — Greenway has one EIN, and the
IRS reconciles the year's 940 against the four 941s filed under it.

**Gate:** the 940 assertion now checks the RELATIONSHIP (every engine line
survives, five entity boxes present, nothing else appears) exactly as the 941's
does; a test asserts both adapters route through the one shared builder; and a
third test discovers from the generated box map that every entity box has a
rectangle on the 940's paper, page 2 included.

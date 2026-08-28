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

---

## D-10 — Q1 2026 UI and EAF cannot both be reproduced by one rounding rule

**Found:** books-64, by computing the two ESD taxes from Michael's own filed Q1
2026 figures and comparing with what ESD actually charged.

**Severity: one cent, and DELIBERATELY UNRESOLVED.**

Filed Q1 2026: gross $61,531.21 (the eleven wage-detail rows sum to exactly
that), UI $227.66, EAF $18.46, charges this quarter $246.12.

```
UI  0.37% of 6153121c = 22766.5477c   statutory half-up -> 22767   ESD CHARGED 22766
EAF 0.03% of 6153121c =  1845.9363c   statutory half-up ->  1846   ESD CHARGED  1846
```

EAF requires the round UP. UI requires the round DOWN. **No single rounding rule
reproduces both**, and rounding per employee before summing reproduces neither
(22767 / 1844). One reading does fit the total to the cent: `0.40% of 6153121c =
24612.484c -> 24612`, i.e. ESD may compute the combined 0.40% once and round at
the end, then apportion. Q2 2026 is consistent with either reading — both give
$275.70 — so the evidence available cannot decide it.

**Why it is not fixed.** Picking the rounding that reproduces Q1 would be
inventing a rule the legislature did not write (standing rule 62d). RCW
50.24.010 and RCW 50.24.014(2)(b) each command rounding for their own section,
which is what the engine implements, and that is a defensible reading of the
statute rather than a bug. ESD bills from its own computation and mails a
monthly billing statement, so the practical exposure is that Michael's screen
may read one cent above ESD's invoice.

**What the system does instead.** The 5208A worksheet's total line says so in
plain English and tells him to pay what ESD bills. Recording the discrepancy is
worth more than resolving it wrongly: if a third quarter ever discriminates
between the two readings, the evidence is here to settle it.

### books-65 UPDATE — the premise above is wrong, and a single rule does fit

Michael asked, verbatim: *"will you please clarify what D-10 means? what do i
need to get for you to make it work?"* Answering that meant re-doing the
arithmetic rather than re-reading the paragraph, and the paragraph did not
survive it.

**First correction.** The claim that "Q2 2026 is consistent with either reading"
is FALSE. Q2 discriminates cleanly, and it rules out the combined-0.40% reading
this entry proposed:

```
Q2 gross 6892345c
  round each fund separately : 25502 + 2068 = 27570   ESD CHARGED 27570  MATCH
  round combined 0.40% once  : 27569.38   ->   27569   ESD CHARGED 27570  MISS
```

So reading B explains Q1 and fails Q2; reading A explains Q2 and fails Q1. The
variable was never the rounding rule. That was the wrong question, and it was
asked for two slices.

**What actually fits.** ESD applies the rate to the taxable wages WITH THE CENTS
DROPPED. One rule, four figures, two quarters, no exceptions:

| quarter | taxable | whole dollars | UI @0.37% | ESD | EAF @0.03% | ESD |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 2026 | $61,531.21 | 61,531 | 227.6647 → **227.66** | 227.66 | 18.4593 → **18.46** | 18.46 |
| Q2 2026 | $68,923.45 | 68,923 | 255.0151 → **255.02** | 255.02 | 20.6769 → **20.68** | 20.68 |

Note what this explains that nothing else did: at $61,531.21 the exact-cents UI
figure is 22766.5477c, which sits a hair ABOVE the half-cent and rounds up to
22767. Drop the 21 cents of wages first and it becomes 22766.47c, which sits
just BELOW and rounds down to 22766 — the figure ESD charged. The 0.5477 was
never a rounding tie. It was 21 cents of wages that ESD had already discarded.

**It is still not implemented, and the reason has changed.** It is no longer
"no rule fits"; it is that a rule which fits four data points is a PATTERN, not
an authority, and standing rule 62d does not allow a filed tax figure to be
computed from a pattern. RCW 50.24.010 commands rounding of the CONTRIBUTION and
says nothing about truncating the WAGE BASE first. Searched this slice and not
found: any ESD publication, WAC, or EAMS help page stating a whole-dollar wage
base. Until that document exists the engine keeps computing on exact cents, and
the worksheet keeps telling Michael to pay what ESD bills.

### What Michael needs to get, to close this

Any ONE of these ends it. They are in order of how likely they are to work.

1. **The monthly billing statement from ESD** (the return itself says: *"Employment
   Security Department will mail you each month a complete billing statement"*).
   If it shows a taxable-wage figure with no cents, that is the answer in his own
   post, and it is the cheapest thing on this list.
2. **Any further filed quarter's EAMS confirmation page** — Q3 2026 onwards. Not
   every quarter settles it: the two readings agree about 81% of the time, so one
   extra quarter has roughly a **1 in 5** chance of being decisive, and it needs
   the cents on the gross to fall in the right band. Two or three quarters make
   it likely. Cost: nothing, he files them anyway.
3. **A written answer from the Account Management Center**, 855-829-9243 or
   OlympiaAMC@esd.wa.gov (both printed on his own confirmation page). The question
   to ask, in one sentence: *"When EAMS computes UI and EAF tax, does it apply the
   rate to total taxable wages including cents, or to whole dollars with the cents
   dropped?"* An email reply is a citable document; a phone call is not.
4. **The ESD tax-rate notice for 2026**, if it prints a worked example.

**What it is worth.** One cent per quarter, four cents a year, and ESD bills from
its own computation either way — so no payment is ever wrong. What is actually
at stake is whether his screen agrees with his invoice to the penny, which
matters because a system that is reliably one cent off teaches him to ignore
small differences, and small differences are how the large ones announce
themselves. That is the reason to close it, and also the reason not to close it
by guessing.

### books-66 UPDATE — half of it is now settled BY AUTHORITY, and the half that is not has narrowed to one sentence

Michael uploaded three official ESD documents this slice: the **Employer Tax
Handbook** (April 2026), the **EAMS bulk filing specifications** (2021), and the
**ICESA bulk filing specifications** (rev. December 2023). All three were mined
against this entry specifically. The result splits D-10 cleanly in two.

**The STRUCTURE half is SETTLED, and it kills reading B for good.** The ICESA
specification names the fields in ESD's own words, and the words are arithmetic:

- *"UI Taxes Due (taxable wages multiplied by the UI tax rate)"*
- *"EAF Assessment Amount ... (total taxable wages x EAF rate)"*
- *"Total Taxable Wages for this Employer (total gross wages – total excess wages)"*
- *"EAF Tax rate ... 0.02% = 0002 / 0.03% = 0003"*

That is two separate fields, each carrying its own rate, each multiplied
separately. The original entry's proposed reading B — that ESD computes a
combined 0.40% once and apportions it afterwards — is not merely unsupported now,
it is contradicted by the document that defines the file ESD ingests. There is no
combined rate anywhere in the specification, and EAF is enumerated as a rate of
its own in basis points. **Per-fund computation is the published behaviour.** The
engine already does exactly this, so nothing changed in code; what changed is that
it is now backed by a citation instead of by a reading of the statute.

**The ROUNDING half is still open, and it is now the ONLY thing open.** None of
the three documents states whether the rate is applied to taxable wages including
cents or to whole dollars with the cents dropped. This was not assumed — it was
searched. An exhaustive grep across all three extracted texts for cents, rounding,
truncation and EAF arithmetic returns **zero hits** on the question. The handbook
rounds HOURS (*"round up to the next whole number"*) and the EAMS spec formats
MONEY for transmission (*"decimal is assumed two places from right"*), but neither
says a word about rounding the computed TAX.

**A probe was written and then deliberately not acted on.** `probe-d10-icesa.py`
tested all four candidate readings against Michael's four filed figures. Exactly
one survives: drop the wage cents, then apply each fund's rate separately, round
half up. That is the same pattern books-65 found, now with reading B independently
eliminated by authority rather than by arithmetic. **It is still not implemented.**
One surviving reading over four data points is a stronger pattern than before and
is still a pattern, and rule 62d does not permit a filed tax figure to be computed
from a pattern no matter how well it fits. The probe was kept in the repository on
purpose — it is the cheapest way to re-run the question the day a fifth quarter
arrives, and deleting it would mean re-deriving it from this paragraph.

**What Michael needs to get is unchanged and has shortened by one item.** Item 4
of the list above (the 2026 rate notice) is the only remaining paper candidate the
handbook did not cover; items 1–3 still stand, and item 1 — the monthly billing
statement — is still the cheapest. The question to ask has not moved: *does EAMS
apply the rate to taxable wages including cents, or to whole dollars?* Everything
else about D-10 now has a citation.

---

## D-17 — the confirmation sheet prints one name column, not first and last

**Found:** books-66, at the moment of writing the wage-detail table, and recorded
rather than fixed.

**Severity: cosmetic, deliberate, and safer than the alternative.** The filed EAMS
confirmation prints employee names in two columns, first and last. The facsimile
prints the whole `displayName` in one. The reason is that splitting a name on
whitespace is a guess about the person, and the guesses fail in exactly the cases
that matter to someone reading their own name on a tax document: "Van Dyke", "De
La Cruz", "St. John", any two-word surname, any hyphenated pair entered without a
hyphen. A wrong split on a document that is meant to look filed is worse than an
honest single column, because a single column reads as a layout choice and a wrong
split reads as a records error.

**What would close it.** Separate `first_name` / `last_name` columns on the
employee record, which the upload path will need anyway — the ICESA layout has
fixed-width positions for each. When those columns exist the table takes them
directly and this entry closes with no guessing involved. Until then, one column.

---

## D-18 — monthly employment counts render as em dashes because the engine does not compute them

**Found:** books-66, while laying out the confirmation sheet against Michael's
filed copy.

**Severity: a visible gap on a document that otherwise reproduces exactly.** The
real EAMS confirmation carries three monthly employment counts — the number of
covered employees on the 12th of each month in the quarter. The engine has never
been asked for that figure, so the facsimile renders `[null, null, null]`, which
the sheet prints as three em dashes.

**Why em dashes and not zeros.** Zero is an answer. A dash is the absence of one.
Printing `0` in those three boxes would state, on a document formatted to look
filed, that Michael employed nobody in January, February and March 2026 — which is
false, and which he would have no way to distinguish from a genuine zero. This
follows the same rule the money boxes follow throughout the system (D-07): a box
with nothing in it must not look like a box with zero in it.

**What would close it.** A headcount-on-the-12th query over the payroll records,
which is a real piece of engine work rather than a display fix, because it needs a
definition of "covered" that matches ESD's and a decision about employees who start
or end mid-month. Scoped out of books-66 deliberately (rule 132) and named here so
it is not discovered later as a surprise.

---

## D-19 — the blank form said 0 employees and 10 employees at the same time

**Found:** books-67, by the rule 130c visual check — after the empty-quarter
feature had passed 11,658 tests, `tsc`, the pure self-tests, the verbatim
verifier and eslint. It is the second consecutive slice where the single
mandated screenshot found something no gate was looking for.

**Severity: the form contradicted itself on two figures ESD reconciles against
each other.** The first render of the no-payroll confirmation showed
`TOTAL EMPLOYEES 0` and, two lines beneath it, `JANUARY 10  FEBRUARY 11
MARCH 9`. On a document formatted to look like a filed return, that is not a
cosmetic blemish — those two regions are exactly what an agency cross-checks,
and a report that disagrees with itself invites the notice it is meant to avoid.

**The mechanism, and why it is the same shape as D-15.** `monthlyHeadcount`
arrives as its own input, passed independently of `ret`. When `ret` became
nullable this slice, every figure DERIVED from `ret` correctly became an em
dash — but the monthly counts were never derived from `ret` at all, so they went
on faithfully echoing whatever the caller handed them. Both halves were
individually correct: the totals honestly described an empty wage table, and the
monthly row honestly echoed its input. **The defect lived in the space between
two correct things**, which is precisely where D-15 lived, and where the
expensive ones live.

**Why no gate saw it.** Every existing assertion checked one region of the page
against its own inputs. Not one compared two regions against each other. The
`.render` harness likewise asserted that no charge printed `$0.00` — which was
true, and irrelevant, because the contradiction was in a section the assertion
never visited.

**Fixed at the source of truth, not at the display.** `buildEamsConfirmation`
now takes `ret === null ? null : input.monthlyHeadcount[i]`, so an absent quarter
reports no headcount whatever the caller passes. Fixing it in the page instead
would have left the next caller free to reintroduce it.

**The gate:** "D-19: the monthly counts cannot contradict the employee total". It
is deliberately fed a NON-EMPTY `monthlyHeadcount` alongside a null return — the
exact combination that produced the contradiction — rather than the nulls the
page happens to pass today, because a gate that only exercises today's caller
proves nothing about tomorrow's. Mutation-proven: reverting the fix fails with
`JANUARY reported "10" employees on a quarter whose employee total is 0`.

---

## D-20 — the two download links vanished on an empty quarter, so he hovered the disabled button

**Found:** books-67, reported by Michael, and it is the SECOND occurrence of a
defect class this repository had already found and fixed once.

**What he saw, verbatim:** *"I think I see the export button for esd and pfml,
the button is not very clear it is the button to use to export the files for esd
and pfml/ wa cares, it has a circle with a slash in it when I hover over that
box."*

**What was actually happening.** The card holding both download links was wrapped
in `{result.ok ? ( ... ) : null}`. With no payroll in the quarter,
`validateWaQuarterRequest` raises `NO_SUBJECTS`, `result.ok` is false, and **both
links were removed from the page entirely.** The only button-shaped object left
was *"Taking these figures to the State"* — which is deliberately inert (its own
comment calls it "the button that does not file") and deliberately carries
`cursor-not-allowed`. That is the circle with a slash. **He hovered the one
control on the screen designed to look forbidden, because the two that are not
were not rendered at all.**

His two reports in that message were therefore one defect seen from two angles:
the confirmation page refusing to draw, and the downloads apparently disabled,
are both `result.ok` hiding a surface that should never hide.

**The class, and the precedent that should have prevented it.**
`form-sheet-core.test.ts` has recorded the finding since books-49, in as many
words: *"hiding a teaching surface behind `result.ok` made it invisible for a
year."* The `sheet` route learned that lesson and falls back to a blank specimen.
books-66 shipped the confirmation route and the upload card without it. Same
class, new surface, two years apart — which is exactly the situation standing
rule 23 exists for.

**Fixed in the class.** The download card now renders ALWAYS. On an empty quarter
it keeps both links and adds a panel explaining that a download would return a
list of what is missing rather than an empty file — because an empty wage file
uploaded to EAMS is an affirmative report that nobody was paid. The links became
real buttons with a `download` attribute and each now states its purpose in a
sentence (*"This is the file you upload to EAMS"*), which is what he asked for.

**The gate:** "books-67: an empty quarter draws the form, and the downloads never
hide", in `form-sheet-core.test.ts` alongside the books-49 gate it generalises.
It walks back from each download link to the nearest enclosing `<Card>` and fails
if the preceding conditional is the figures gate. Mutation-proven: re-wrapping
the card fails with *"the download card is wrapped in `result.ok` again — on an
empty quarter both links vanish and the only button left on the page is the
disabled one."*

**The separate judgement this forced, and it is the interesting part.** An empty
quarter must draw the form; a BROKEN quarter must not. `NO_SUBJECTS` means "there
is nothing here", which is a fact about the quarter and safe to render blank.
Every other refusal — negative wages, fractional hours, a missing rate — means
"something here is wrong and I will not guess", and rendering those as a blank
form would hide a real fault behind a page that merely looks empty. So the
confirmation route branches on the refusal CODE, not on `result.ok`, and only
`NO_SUBJECTS` alone earns the blank form.

---

## D-11 — `buildPaidLeaveCsv` existed for eight slices with no caller

**Found:** books-64. `grep -rn "buildPaidLeaveCsv" src/` outside its own module
returned nothing.

**Severity: the feature did not exist.** 511 lines of correct, spec-quoted,
gate-covered CSV writer that no screen could reach — while Michael's instruction
for this very slice was *"we will need an export .csv for esd and pfml/ wa
cares."* This is D-08's class repeating: a pure core, tested and right, wired to
nothing. Standing rule 125(d): a run needs a way in that is not a URL.

**Fixed in books-64.** `src/lib/payroll/esd-upload-store.ts` joins the database
quarter to both writers, and
`src/app/admin/books/wa-quarterly/esd-upload/route.ts` serves each as a
download with `Content-Disposition: attachment` and `Cache-Control: no-store`.
Building the store is what exposed D-12 below.

---

## D-12 — the ESD upload store selected three columns that did not exist

**Found:** books-64, immediately after writing the store, by checking its column
list against the migrations instead of assuming:

```
$ grep -rln "date_of_birth\|wa_cares_exempt\|soc_code" supabase/migrations/
(no output)
```

**Severity: the download would have failed in his hands, at a deadline.**
`esd-upload-store.ts` selected nine employee columns; three had never been
created. `esd-paid-leave-csv-core.ts` had *recorded* the gap in books-56 — "this
file CANNOT be produced from what the engine holds today" — and the note was
right, which is the only reason the fix was a short job rather than an
excavation.

**Fixed:** migration `0207_employee_esd_upload_fields.sql`, executed against a
real PostgreSQL 15 by `scripts/payroll/verify-esd-upload-fields.sh`: 21 checks,
0 failures. `date_of_birth` is nullable (so the upload refuses by name rather
than inventing a date WA Cares eligibility turns on), `wa_cares_exempt` is
`not null default false` (absent and "no" are the same claim), and `soc_code` is
nullable with a CHECK — because ESD says the column "can be only 6 digits or
blank", so blank is a documented value rather than a gap.

**The gate that mattered was the regex.** PostgreSQL's `~` is POSIX and
unanchored; a pattern missing `^`/`$` would match the first six digits of a
seven-digit code and accept it, sending ESD a plausible-looking truncated
occupation code. `'4120310'` is now an executed refusal, not a reasoned one.

---

## D-13 — the slice plan put the ESD total on line 24; the filed return says 19

**Found:** books-64, while writing the 5208A worksheet, by opening
`1ST QUARTER FORM 5208A - SAGE.pdf` and
`example_form_5208_with_real_qtr_2_data.pdf` and reading the captions instead of
trusting the plan's own table.

**Severity: it would have printed a figure that asserted something false.** The
filed 5208A numbers its money lines:

```
19) TOTAL TAX DUE          Add lines #17 and #18
20) LATE PAYMENT PENALTY
21) INTEREST
22) LATE-REPORT PENALTY
23) PRIOR BALANCE TO ADD (or credits to subtract)
24) AMOUNT DUE             Add lines #19, #20, #21, #22, and #23
```

The engine computes UI + EAF, which is **line 19**. It computes no penalties, no
interest and no prior balance, so it cannot compute line 24. Putting its total
there would have asserted that Greenway owes nothing in penalties — a statement
only ESD's monthly billing statement can make.

**Fixed** before any of it reached a screen. `FILED_2026_LINE_NUMBERS` now
carries `totalTaxDue: "19"` and `amountDue: "24"`, the worksheet fills 19 and
explains why it leaves 24 empty, and a self-test asserts line 24 is **absent** —
the assertion that would have failed under the plan's original reading.

---

## D-14 — his Sage record copy shows a UI rate and wage base that ESD did not use

**Found:** books-64, comparing the two documents for the same quarter.

**Severity: unresolved, and it is about HIS books rather than our code.** For
Q1 2026 the two records disagree:

| | Sage record copy (5208A) | EAMS confirmation (what ESD charged) |
| --- | --- | --- |
| UI rate | 0.0064 (0.64%) | 0.37% |
| Taxable wage base printed | $72,800 | $78,200 |
| UI tax | $393.80 | **$227.66** |
| Total | $412.26 | **$246.12** |

ESD's own confirmation is authoritative and the money actually moved on
$246.12, which is the figure this system reproduces. But Michael's Sage
installation computed the quarter at a rate 73% too high against a stale wage
base, and its "Record Copy" is the document that would be handed to a CPA or an
auditor. The Q2 example carries the corrected $78,200 base but still prints
0.0064.

**Not fixed here because it is not ours to fix**, and guessing which record is
right would be exactly the wrong move — but it is recorded because a $166.14
discrepancy per quarter in his own books is worth his knowing about, and because
it is independent confirmation that this system's rate registry (0.37% / 0.03%,
$78,200) matches what ESD actually billed.

### books-65 — RESOLVED BY THE OWNER. Sage is wrong; the books are right.

D-14 was written as an open question because it was not this system's place to
declare a number in Michael's other software incorrect. He has now decided it,
and the decision is his to make. Verbatim:

> *"for D-14, sage is wrong, i need to update the formula. this is one of the
> issues we are escaping sage from. we will build a compliance cron bot that
> will poll the agencies for tax updates and such. that way our books never
> lie to me."*

**What this settles.** The 0.64% UI rate and the $72,800 wage base printed on
his Sage record copy are stale. The rate registry in this system — 0.37% UI,
0.03% EAF, $78,200 base — is correct and is the one ESD billed from. Nothing in
the engine changes, because the engine was already right; what changes is that
the discrepancy is no longer an open question with two candidate answers. There
is one answer, and Sage does not have it.

**The correction is his to make in Sage**, for the remainder of 2026. Worth
$166.14 per quarter of overstated UI tax on the record copy — the document that
would be handed to a CPA or an auditor. No money was ever overpaid, because ESD
bills from its own computation; the exposure is entirely in what his own books
say happened.

**What he asked for next, recorded so it is not lost.** A compliance cron bot
that polls the agencies for rate and threshold changes, so that a stale rate can
never again sit in the books quietly producing confident wrong numbers. That is
the correct generalisation of this defect: D-14 is not really about one rate, it
is about the fact that a rate went stale and nothing noticed for two quarters.
It is NOT built in this slice and is not claimed to be. Noted here as the
owner's stated intent, and it belongs on the roadmap rather than in a defect
entry.

**Why this entry stays instead of being deleted.** The two figures and their
sources are the evidence for the decision. A resolved defect that erases its own
evidence leaves the next person no way to check the resolution.

---

## D-15 — the company profile was correct, and no form had a box to put it in

**Found:** books-65, by Michael. Verbatim: *"the forms are not populating with my
company data even though it is correctly stored in the company info page in
accounting."*

**Severity: high, and it had been visible on every form since the forms
existed.** His EIN, legal name, trade name, address and city/state/ZIP were all
stored, all validated, all showing green. Every sheet page read them. And every
form printed the entity area blank.

The instinct is to look for a broken read or a key mismatch. Both were measured
and both were fine: `loadCompanyProfile` has four callers, and the profile keys
(`ein`, `legal_name`, `trade_name`, `address_line1`, `city`, `state_code`,
`zip_code`) match the sheet exactly. The fault was one layer further on. The
identity values are joined onto the specimen by `identity[box.box]` — so a value
is drawn only if a BOX EXISTS with that id. `teachingBoxes` emitted no entity
boxes at all. Five values, zero homes, silent on every form.

**Why it stayed hidden.** Nothing was throwing, nothing was null, and no test
asked the only question that would have caught it: *does every identity value
have somewhere to land?* Each half was correct in isolation. The defect lived in
the space between them, which is where the expensive ones live.

**Fixed in the class, not the instance.** `teachingBoxes` now emits the entity
area for every form that prints one — the 941 went 27 → 32 boxes and the 940
30 → 35. Both were measured against Michael's own filed returns with `pdftotext`
first, because the question is whether the paper prints those fields, not
whether we think it should.

**The gate:** `assertEveryIdentityValueHasABox` fails if any of the five ever
loses its home again, for every form and both modes. Confirmed visually this
slice: `.render/30-wa-sheet-header-complete.png` shows all five populated.

---

## D-16 — the ESD work code box displayed the labor role's error message

**Found:** books-65, by the rule 130c visual check — after the whole SOC feature
had passed 11,616 tests, tsc, the pure self-tests, the verbatim verifier and
eslint. It is the one defect this slice found that no gate was looking for.

**Severity: it makes the highlighting untrustworthy, which is worse than not
having it.** Typing `41-20` into the new ESD work code box produced, in red,
underneath that box: *"No labor role. This is the field that decides whether the
wage is cost of goods sold or a §280E-disallowed operating expense."* The labor
role was fine. The work code was the problem, and the screen named the wrong
one.

**The mechanism, and why it is structural rather than a typo.** A checklist row
carries two PARALLEL arrays — `highlightFields` and `problems` — index-aligned
by construction. `problemFor(path)` found the row that mentioned the field and
then returned `row.problems[0]`: the first complaint on the STEP, whichever
field it belonged to. That is wrong for any step with more than one problem.
For eight slices `labor_role` raised exactly one, so index 0 was the right
answer by accident. books-65 gave it a second, and the accident ended.

**Why every existing gate was blind to it.** The engine was correct — the right
problem, on the right field, with the right severity. The view core was correct
— it copied both arrays faithfully. Only the JOIN between them was wrong, and it
lived in a component function that no test called. A screenshot found in one
look what five green gates could not see.

**Fixed in the class.** `ChecklistRow` now carries `fieldProblems`, where each
message stays attached to its own field and severity, and `problemFor` looks up
by field name instead of by position. It joins every matching sentence rather
than the first, because two things being wrong with one box is not a reason to
hide one of them. The parallel arrays are kept — the checklist renders them as
flat lists, which is all they were ever asked for.

**The gate:** `tests/compliance/payroll-onboarding-ui-core.test.ts`, "D-16: each
problem stays attached to its own field, even when one step has two". It builds
the two-problem condition, asserts existence before absence (rule 66c), checks
the pairing, and separately asserts that index 0 WOULD have been wrong — because
a test that only checks the right answer still passes against the broken code on
a one-problem step. Mutation-proven: re-introducing the index-0 read fails it.

## D-21 — every box on the new hire form printed "0", and the first fix printed "not computed yet" instead

**Found:** books-68, by looking at a screenshot, with **all 11,695 tests green**.
Not reported by Michael — he never saw it, because it was caught before the slice
shipped. That is the only reason it is a defect record rather than an apology.

**What the screenshot showed.** The filled DSHS 18-463 rendered a literal `0` in
all twelve boxes. The employer's legal name: `0`. The employee's last name: `0`.
The social security number: `0`. The date of hire: `0`. A form that, printed and
mailed, would have told Washington that Greenway hired a person named zero.

**The cause.** `BoxMeasure` is `"money" | "hours" | "count"`. There is no text
member. `formatBoxValue` therefore sent every one of these boxes down the count
branch, which returns `(box.quantity ?? 0).toLocaleString()`, and `quantity` is
null on all twelve — because **nothing on the 18-463 is a figure.** It is two
names, an address, an SSN and two dates. The type system was asked to represent a
form made entirely of words using a vocabulary that only knows amounts, and it
answered with the default.

**Why the suite did not catch it, which is the part worth keeping.** Thirty-three
tests covered this form and every one of them passed. They asserted on the *view
object* — that the SSN was grouped `534-29-8006`, that the deadline was hire + 20,
that the pagination broke 4 + 1 — and the view object was **correct in every
respect.** The defect lived entirely in the last step, between a correct view and
the rendered page. This is precisely the D-19 class (assertions about the data
while the page says something else) and it is why standing rule 130c requires one
visual check per surface. **The screenshot is not a courtesy to Michael. It is a
gate, and on this slice it was the only gate that fired.**

**The first fix, and why it was also false.** The codebase already had a road for
non-numeric boxes: `employerEntityBoxes` carries the 941's EIN, legal name and
address flagged `notComputedYet`, which `formatBoxValue` checks first, ahead of
every numeric branch. Following it (rule 25: extend, never duplicate) removed all
twelve zeroes, and the suite went green a second time. The next screenshot showed
the real problem: **a fully populated report reading "not computed yet" in all
twelve boxes.** Trading a false zero for a false "unknown" is not a fix. Those 941
boxes are headers repeated from a company profile; these twelve *are* the return.

**Fixed in the class.** One additive, optional `text?: string | null` field on
`FormBox`, read only through `boxText()`, which treats absent, null and
whitespace-only identically as "no words here". `formatBoxValue` consults it
**second** — after `notComputedYet`, so an unknown figure still refuses to print,
and before the numeric branches, so a person's name is never formatted as
`quantity ?? 0`. `boxIsEmpty` returns false for a box carrying text, so a box
holding an employee's name is not greyed out as `correctlyBlank`.

Widening `BoxMeasure` to a fourth member was the alternative and was rejected on
budget: it is a union that `form-box-adapters`, `form-box-teaching-core`,
`wa-quarterly-mentor-gates`, `form-941-schedule-b-boxes` and `form-box-ui-core`
must each then handle exhaustively — every form in the system, for one form's
benefit. Michael: *"We need to find a fair balance between having perfect code
verse acceptable code within budget."* The field was made optional rather than
required for the same reason: required, the type checker enumerated ~30
construction sites, and every one would have been edited to write `text: null` —
churn across nine files of tax-form code to restate a default, which is how a real
edit hides among a hundred mechanical ones.

**The honesty gate.** `assertBoxTextIsHonest` throws if a box is `measure:
"money"` and also carries text, or carries text while flagged not-computed. A box
is an amount or a sentence, never both: words where a dollar figure belongs is how
a wrong number reaches a return. It is called from `sheetGroups()`, so **every
sheet in the system passes through that one door** (rule 23), not just this form.

**The gates:** two, in `tests/compliance/new-hire-report.test.ts`, one per half of
the defect. *"never reaches the numeric branch, because no box on this form is a
figure"* asserts the **class** rather than twelve strings — a box escapes the
count branch only via `notComputedYet` or `text`, so a thirteenth box added later
with neither fails immediately. *"prints the real value in the box, and greys only
what is genuinely unknown"* pins the rendered strings through the real formatter
and uses MIDDLE NAME as its control: the one box that must read "not computed yet"
while the eleven beside it read as data.

Mutation-proven, both halves. Reverting `text` to null reproduces the original
failure verbatim — *"expected '0' to contain 'LYMAN\'S MARIJUANA L.L.C.'"* — and
re-flagging a populated box `notComputedYet` fails with *"expected 'not computed
yet' to be '46-4217016'"*. The green suite that missed this defect twice now
fails against both versions of it.

---

## D-22 — an unreadable ATM cash load counted as a real reading of "no cash loaded"

**Where:** `src/lib/atm/store.ts`, `listAtmCashLoads()`.

**The line, as it shipped:**

```ts
cashLoadCents: Number(r.cash_load_cents ?? 0),
```

**Why it is wrong.** `atm_cash_loads.cash_load_cents` is declared `bigint NOT
NULL` in migration `0156_atm_pai_foundation.sql`. PostgREST serialises a
`bigint` as a JSON **string**, because 64 bits do not fit in JavaScript's 53
bits of exact integer. So the value arriving here is text, and `Number("")` is
`0`, not `NaN`. A blank, whitespace, or otherwise unreadable column therefore
became a confident `0` — and zero is the most dangerous possible wrong answer
for this particular column, because it is entirely plausible: an ATM that simply
was not filled that day looks exactly the same.

It did not stop at the read. `atm-ui-core.ts` `buildCashLoadsView` accumulates
with `if (Number.isFinite(r.cashLoadCents)) totalLoaded += ...`, and
`Number.isFinite(0)` is `true`, so the invented zero was **added to the total as
a genuine reading** rather than skipped as missing. Vault cash put into the
machine was understated, silently, with no null, no NaN and no throw anywhere.

The `?? 0` is a second, separate fault stacked on the first. The schema says the
column cannot be null, so a null there means the row is not the shape the schema
promises — something wrote it outside the normal path. The coalesce converted
that evidence of a broken row into a plausible figure.

**How it survived.** `src/lib/atm/store.ts` was already listed as a caller in
`tests/compliance/pg-bigint.test.ts` §7, and it passed every check there: it
imported the shared reader, and it carried neither of the two banned idioms.
Both of those assertions ask *"does this file still contain the old line"*,
which is a check for one spelling of the mistake rather than for the mistake.
Importing the fixed reader and then failing to use it on one column out of
twelve defeats both. That is standing rule 50 — dead code wearing a green check
— and the file wearing it was on the list of files the check existed to protect.

**Why the casts hid it.** Every read in the file said `data as
Array<Record<string, unknown>>`. A cast does not establish a shape, it asserts
one, so `r.cash_load_cents` was typed `unknown` and *any* handling of it
compiled. The file's own `numOrNull` docstring had already recorded the
consequence — *"no column in this file has ever been type-checked at all"* — and
deferred the repair to the roadmap. This is that repair.

**Fixed.** Three DB row types (`AtmSettlementDbRow`, `AtmCashLoadDbRow`,
`AtmTerminalStatusDbRow`) measured field by field from migrations `0156` and
`0183`, with nullability copied from the schema rather than chosen — which is
what makes `requiredBigint` demonstrably the correct reader for this column and
`optionalBigint` the wrong one. Five cast sites removed (the books-69 recon
counted four; it missed the one in `getLatestAtmTerminalStatus`, and the number
is corrected out loud per rule 89). `numOrNull` narrowed from `unknown` to
`number | string | null | undefined`, which is the payoff the old docstring
predicted, and its now-unreachable runtime type guard deleted rather than left
as a branch no test could ever fire (rule 39).

Each row type is paired with a `Record<keyof Row, true>` column map that the
`select` string is generated from, so the two lists cannot drift: a column
missing from the map is a compile error, and a column that is not in the row
type is a compile error. This matters more than it looks, because a column
omitted from a `select` arrives as `undefined` at runtime while the compiler
believes it is a string — the failure the old defensive `String(r.x ?? "")`
calls were quietly absorbing.

**The gates:** two, in `pg-bigint.test.ts` §7. *"none of them converts a row
value with a raw `Number()`"* asks the opposite question from the two gates that
missed this — not "is the old line still here" but "is there any raw `Number()`
left on a row value anywhere in the six stores". *"that D-22 gate would have
caught the real defect"* feeds the removed line back to the regex, so a gate
that matches nothing cannot quietly become a decoration (rule 39).

Mutation-proven, four ways. Dropping a column from a map, misspelling a column
in a map, and misspelling a column at a read site are each now compile errors
naming the column (the third — `r.surchage_cents` — compiled cleanly under the
old cast and returned `null`, which is precisely the recon's warning that *"a
mistyped column reads as empty, becomes a zero in a journal line, and a zero
posts perfectly cleanly without complaining"*). Restoring the original
`Number(r.cash_load_cents ?? 0)` fails the new gate with the defective line
quoted back.

**Why it was worth fixing before wiring the ATM to the ledger.** Michael:
*"we need bullet proof logic in place before we touch the books."* Every figure
these readers return is about to become a journal line. A zero posts perfectly
cleanly.

---

## D-23 — the owner distribution that would have erased itself

**Found:** books-69 step 2, while checking the first draft of
`atm-sweep-core.ts` against migrations 0172 / 0173 / 0175 / 0178 before writing
any test for it.

**Where:** `src/lib/atm/atm-sweep-core.ts`, the 6228 → 3557 branch, in the draft
version of the file only. It never reached a commit, which is the reason it is
recorded here rather than in a git log: a defect that was designed and then
caught still says something about how the design went wrong.

**What it did.** The draft treated *every* transfer out of the ATM account as an
intercompany pair, including the one to Michael's personal checking. For that
row it proposed:

    ON THE ATM BOOKS        debit  41000    distribution
                            credit 10300    cash out
    ON THE PERSONAL BOOKS   debit  10200    cash in
                            credit 41000    distribution

Both halves balance. Both post. Both are wrong, in two independent ways, and the
second is the expensive one.

**Wrong direction.** `41000 Shareholder Distributions` is seeded in 0173 as
`equity` with `is_contra = true`, so `gl_upsert_account` derives its
`normal_balance` as **debit**. `gl_trial_balance` in 0175 computes `is_abnormal`
as `normal_balance = 'debit' and sum(amount_cents) < 0`. The credit leg would
therefore have sat permanently on the abnormal-balance report — the same report
that exists to catch negative ATM cash, which is on Michael's permanent failure
corpus.

**Wrong economics, which is worse.** `41000` has `allowed_entity_codes = null`,
meaning it is shared by all four entities. A `+X` debit on the ATM books and a
`−X` credit on the personal books therefore **sum to zero across the group**.
The consolidated equity statement would have reported that no distributions were
taken. Michael's S-corporation stock basis and the §1368(b)/(c) analysis are
computed *from* distributions; a distribution that nets itself out understates
basis consumption and hides the point at which further draws become capital gain.
Migration 0175's own header warns about exactly this shape of error — "a
balanced, fictional report".

**The fix.** A distribution is not a transfer between two businesses. It is money
leaving the business; where it lands afterwards is not a claim on any entity. So
it is now a **single** entry on the ATM books (debit `41000`, credit `10300`) with
`entityB: null` and `linesB: []`. `36000` was considered and rejected: an
undocumented owner "loan" is routinely re-characterised as a distribution on
examination, and having called it a loan first is worse than having called it a
distribution. The judgment is stated in the proposal's own `assumptionNote`,
including how to overrule it.

**The gates:** `atm-sweep-core.test.ts` §3, five tests. The load-bearing ones are
*"is ONE entry, not an intercompany pair — the defect this replaced"* and
*"DEBITS 41000, because it is contra-equity and therefore debit-normal"*. Both
were mutation-proven: forcing the personal branch down the intercompany path
fails 8 tests, and flipping the sign on the `41000` leg fails 4.

**Why nothing would have caught it.** The pair balances, both entities exist,
`41000` permits both of them, and `gl_submit_intercompany_pair` would have
accepted it without complaint. The error is invisible at every level except the
consolidated equity statement, which is the one report nobody looks at until the
K-1s are being prepared. It was found by reading the account's seed definition
instead of assuming what a distributions account does.

---

## D-24 — a reference the database would have rejected, and a duplicate it would have swallowed

**Found:** books-69 step 2, same review pass as D-23. Also pre-commit.

**Where:** `src/lib/atm/atm-sweep-core.ts`, draft version.

Two defects with one cause: the draft invented its own identifier scheme without
measuring the column it had to fit or the uniqueness rule it had to survive.

**(a) The ref was a string; the column is a uuid.** The draft produced
`ref: "atm-sweep:2026-08-21:6048:1142750"`. `gl_journals.intercompany_ref` is
declared `uuid` in migration 0172 and `gl_submit_intercompany_pair` takes
`p_ref uuid`. Postgres would have rejected the very first sweep Michael tried to
post. **No pure unit test could have caught this**, because nothing in a pure
test ever meets the column's type — the suite would have been green right up to
the moment a human pressed the button. The fix is a deterministic RFC 4122
version-5 uuid over a frozen namespace; deterministic because a random
`randomUUID()` would mint a new ref on every re-import and yesterday's two halves
would stop pointing at each other. The four real statement keys were computed
independently in Python's `uuid.uuid5` and those measured values are what the
tests assert (rule: measure, never assert from memory).

**(b) Two transfers on one day would have collided.** `gl_submit_journal` keys
idempotency on `entity:source_kind:source_ref`, and when that key already exists
with the same line fingerprint it returns `GL_DUPLICATE_IGNORED` and writes
nothing — correctly; that is what idempotency is for. The draft's source ref was
date + destination, so **two sweeps on one date would have merged into one and
the second one's money would have silently disappeared** behind a cheerful
"already recorded".

This is not hypothetical. Walking the population (rule 43) found **2026-05-26
carries two sweeps**, $3,522.50 and $20,610.00. Adding the amount to the key
saves that particular pair but not the general case: two transfers of the same
amount to the same account on the same day are ordinary. So `SweepFacts` now
carries a **required** `occurrence` — the 1-based position among identical rows —
and it is required rather than defaulted to 1 precisely because a default would
make the dangerous case look exactly like the safe case at every call site.
`withOccurrences()` assigns them, and the store sorts oldest-first before
numbering, because Plaid returns newest-first and numbering a same-day pair
backwards would keep the refs stable while swapping which bank row each one
describes.

**The gates:** §5 and §6 of `atm-sweep-core.test.ts`. *"is a syntactically valid
version-5 uuid"* (mutation-proven: removing the version nibble yields
`...-af60-...`, which is not a v5 uuid and which Postgres would reject),
*"matches the uuid measured independently in Python"* (killed by sha256-for-sha1
and by omitting the namespace), and *"distinguishes two IDENTICAL transfers on
one day"* — the most important test in the file, which asserts the two
`buildIdempotencyKey` outputs differ rather than merely that the refs do.

**The class, not the instance (rule 23).** Both halves of this defect come from
the same habit: designing an identifier from what reads nicely instead of from
the constraint it must satisfy. The constraint was written down in two
migrations the whole time.

## D-25 — the disagreement the ingest resolved correctly and never mentioned

**Found:** books-69 step 3, by reading `atm-sync-core.planSettlementUpserts`
before writing a new comparison module.

Payment Alliance publishes the same ATM period twice. The Funds Movement report
carries one row per settlement leg; the Daily Settlement Report carries one row
per day. Michael's 2026-05-01..2026-08-23 exports do not agree:

|                  | Surcharge  | Transaction |
| ---------------- | ---------- | ----------- |
| Funds Movement   | 16,272.50  | 526,620.00  |
| Daily Settlement | 16,267.50  | 526,520.00  |

The whole difference is four rows on three days. Funds Movement appends a
correction row rather than restating the original, so 2026-06-27 carries
`$3,060.00` **and** `-$100.00`, 2026-07-02 carries `$4,980.00` and `+$100.00`
plus `$157.50` and `+$5.00`, and 2026-07-09 carries `$2,500.00` and `+$100.00`.
The Daily Settlement Report shows only the first row of each pair. It is
structurally blind to corrections.

**The defect was not the disagreement. It was that a choice was already being
made about it, silently.** `planSettlementUpserts` wrote the Daily Settlement
surcharge and then overwrote it from Funds Movement, commented *"deposit truth
wins"*. That preference is **correct** — Funds Movement is the only one of the
two reports that can ever say a correction happened, and books built on the
summary report would be permanently $100 wrong on three days with nothing to
ever reveal it. But on Michael's real data the overwrite quietly discarded a
$5.00 surcharge difference and a $100.00 dispensed difference, and wrote nothing
down to say a decision had been reached. If the next export disagrees for a
different reason — a dropped day, a duplicated batch, a terminal swap, a genuine
processor error — it would be discarded just as quietly, and the system would
look like it was handling corrections while it was actually absorbing an unknown.

**The fix keeps the conclusion and records the reasoning.** `SettlementPlan` now
carries a `corroboration` array built from the same rows the merge consumed, so
the record cannot drift from the decision. `IngestSummary.corroborationAttention`
carries only the days where nothing in the data explains the difference, and
`ingestResultMessage` names those days in the sentence Michael reads. On the
measured 115 days that list is **empty**: 112 days agree exactly, 3 differ
because of a correction, 0 are unexplained.

**A five-state vocabulary, because "different" is not one thing.** `agreed`,
`adjusted` (differs, and the differing leg carries a correction row),
`unexplained` (differs, and nothing accounts for it), `primary_only`,
`secondary_only`. Only `unexplained` and `secondary_only` ask for attention —
listing explained corrections would bury the real questions, which is the same
mistake that once produced a false six-figure shortage in the reconciliation
engine.

**The gates:** `tests/compliance/atm-corroborate-core.test.ts`, 34 tests, and
§8 covers this defect directly: *"still prefers the Funds Movement surcharge,
which was always the right call"* alongside *"but now records that the two
reports disagreed on that day"*. Mutation-proven: returning
`corroboration: []` from the plan kills three tests; making
`agreementNeedsAttention` return `a !== "agreed"` kills five.

## D-26 — the correction on one leg that would have excused the other

**Found:** books-69 step 3, while deciding what evidence separates an explained
difference from an unexplained one.

The signature of a correction is that Funds Movement carries more than one row
for a settlement figure. `mapFundsMovementCsv` already recorded `legCount` — the
number of source rows folded into the day — so the obvious test was
`legCount > 2`.

That test is wrong, and Michael's own data is the counterexample. **2026-06-27
folds to `legCount` 3: two Transaction rows and one Surcharge row.** The
correction is unambiguously on the transaction leg. But `legCount` cannot say
which leg it landed on, so a day whose *surcharge* disagreed with the summary
report for a completely unrelated reason would be waved through as "explained by
a correction" purely because some *other* leg happened to carry two rows. A
false all-clear, produced by evidence about the wrong number.

**The fix is per-leg counts recorded at the only place that can still see the
source rows.** `FundsMovementRow` now carries `transactionLegCount` and
`surchargeLegCount` beside the existing `legCount`, assigned in the same loop
that sums the cents. `compareReports` then checks the signature **on the leg
that actually differs**. Walking the whole population confirmed the shapes are
112 days of `1/1`, two days of `2/1`, and one day of `2/2` — which accounts for
exactly the four known adjustment rows and nothing else.

`tsc --noEmit` caught the two places that construct a `FundsMovementRow`
literal, which is the reason the typecheck gate runs separately from vitest:
vitest transpiles without type-checking and both sites would have compiled
silently into fixtures missing the new fields.

**The gates:** *"does not let a corrected transaction leg vouch for an
unexplained surcharge difference"* and its mirror for the surcharge leg. Both
fire when the check is reverted to `pp.legCount > 2`. In `atm-core.ts`,
*"funds: 2026-06-27 correction is on the TRANSACTION leg only"* fires when the
two counters are conflated.

## D-27 — three money formatters, one of which would print `$-100.00`

**Found:** books-69 step 3, by grepping `src/lib/atm` for `toLocaleString`
before adding a fourth formatter.

`atm-posting-core.ts` and `atm-sweep-core.ts` each defined a local one-line
`money()` closure of the shape
`` `$${(cents / 100).toLocaleString(...)}` ``. Interpolating the sign from
`toLocaleString` puts the minus **inside** the string, after the dollar sign, so
a negative amount renders as `$-100.00`.

That was harmless only for as long as no negative could reach either function,
and books-69 ended that: the Funds Movement report demonstrably carries reversal
rows, so a period whose surcharge nets negative is now reachable in ordinary
data. Writing a third copy — this time with the sign handled correctly — would
have left the codebase with three formatters that disagree about the most
error-prone case, which is a worse outcome than the original duplication.

**The fix is one exported `formatMoneyCents` in `atm-core.ts`**, the module every
ATM file already imports, with the sign taken from the number and rendered as a
real minus (`−$100.00`). Both closures now delegate to it (rule 23: fix the
class, not the instance).

**The gate:** *"money: negative uses a real minus, not $-"* in
`__runAtmCoreTests`, plus *"renders a negative total with a real minus rather
than $-"* in the vitest suite, which asserts both that `−$100.00` is present and
that `$-100.00` is absent. Restoring the old one-liner kills it.

## D-28 — the test fixture that made every ingest a disagreement

**Found:** books-69 step 3, by a pre-existing test failing after the
corroboration was wired in — `Imported 1 settlement day.` gained a sentence
about a day that did not match.

The failure was correct and the fixture was wrong. `atm-sync-core.test.ts` built
a Daily Settlement row with `settlementTotalCents: 90000` against a Funds
Movement transaction leg of `87600`, and `87600 + 2400` is exactly `90000` —
the fixture had been written on the assumption that the report's "Settlement"
column means dispensed cash **plus** surcharge.

Rather than assume either reading, the relationship was measured across the real
export: the Daily Settlement `Settlement` column equals the Funds Movement
`Transaction` leg on **112 of 115 days** and equals transaction + surcharge on
**zero** days. The three exceptions are the known correction days. The fixture
described a settlement shape the real report never produces, and it made every
settlement fixture into a day on which the two sources silently disagreed by
$24.00.

The fixture now says `87600`, with the measurement recorded beside it, and a new
assertion pins the meaning: *"reports agreement when the two sources match,
rather than a silent $24.00 gap"*. Restoring `90000` kills three tests.

**The lesson (rule 1).** The old fixture passed for as long as nothing compared
the two columns. A wrong number is invisible until something finally reads it,
and the thing that finally read it was a feature built to catch exactly this.

## D-29 — the date validator that accepted February 30th, on a medical card

**Found:** books-69 step 4, while looking for an existing ISO-date validator to
reuse rather than writing a tenth one (rule 25).

`medical-intake-core.ts` validated a date as:

```ts
ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
```

The regex proves the SHAPE and `Date.parse` was trusted to prove the date is
real. It does not. `Date.parse` **rolls over** rather than rejecting, so
`2026-02-30` silently becomes March 2nd, `2025-02-29` becomes March 1st, and
`2026-04-31` becomes May 1st. All three passed as valid dates.

**Why it matters here and not somewhere harmless.** The function guards a
recognition card's `effectiveOn`, `expiresOn` and `authorizationIssuedOn`.
RCW 69.51A.230(4)(a) makes those dates legally operative — they are what decides
whether a card is valid at the moment of a sale. The same value feeds `ageOn`,
which decides whether a patient is a minor and therefore whether a designated
provider is required. A card typed as expiring `2027-02-30` would have been
accepted and then silently treated as expiring on March 2nd: a card honoured for
two days after it expired, with nothing anywhere saying so.

**How it hid:** nobody types February 30th on purpose. The defect needed a
typo, an OCR slip or a bad import to surface, and when it did surface the result
was not an error but a plausible neighbouring date. Every test in the suite used
real dates, so every test passed.

**The fix** is a `Date.UTC` round-trip — build the date from its parts, then
check the constructed date reports back the same year, month and day. Kept
dependency-free rather than importing a shared helper, because the module header
promises "PURE: no imports" and breaking that promise to fix a date bug would
have been a worse trade.

**The gate:** seven named assertions in `__runMedicalIntakeTests`, one per
rolling-over case (`2026-02-30`, `2025-02-29`, `2026-04-31`, `2026-13-01`,
`2026-00-10`, `2026-01-32`) plus one confirming `2024-02-29` is still ACCEPTED,
because a leap day is a real date and over-correcting would reject a valid card.

**The lesson (rule 1, and the reason this was found at all).** The first pass at
this audit was a grep across nine implementations, and it produced two FALSE
POSITIVES — `posting-core` and `cutover-core` both looked wrong and are correct
by different means (`toISOString().slice(0, 10) === s`, and an explicit
`daysInMonth` table). Reading code told me the wrong answer twice. A throwaway
script that EXECUTED all nine against thirteen cases found the one real defect
in a module I had not suspected.

## D-30 — the classification-rule table whose unique index forbids effective dating

**Found:** books-69 step 4, by grepping for the existing rules table before
building one (rule 25) after the recon had promised Michael dated rules.

`public.gl_account_rules` already exists, in migration 0173. It carries
`match_kind`, `match_value`, `account_id`, `entity_id`, `cost_class`,
`priority`, `source`, and a `gl_guard_rule_target()` trigger that refuses
control-account targets. It is a well-built table. It has **no effective
dating**, and this index makes adding any physically impossible:

```sql
create unique index gl_account_rules_unique_idx
  on public.gl_account_rules (
    match_kind, match_value,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

One row per (kind, value, entity). Michael's own plan is the counter-example:

> "My plan is to switch to paying vendors from the atm account starting on
> November 1st. I will begin paying employees via the atm account on
> January 1st."

Two rules for the same matcher on different dates. Under that index the November
rule can only **overwrite** the October rule, and the October history is gone —
which is precisely the dateless-rule failure the books-69 recon told Michael
would not happen:

> "A transaction gets classified by the rule that was in force on its own date,
> never by today's rules. If your CPA re-runs last March in two years' time, he
> gets last March's answer."

**How it hides:** nothing is wrong today, because there is only one rule per
matcher today. The defect activates on November 1st, and its symptom is not an
error — it is last October's transactions quietly re-classifying themselves
under November's rule the next time anybody re-runs the period. A restated prior
period that nobody asked for.

**What step 4 did instead of a schema change.** A dated layer in FRONT of the
existing table (`atm-classification-core.ts`), which writes nothing to it. The
five ATM rules carry `effectiveFrom`/`effectiveTo` and are matched on the
transaction's own date, so the promise holds for the ATM account now. The table
itself is untouched, so no migration was rushed.

**OPEN.** The migration that adds `effective_from`/`effective_to` and reshapes
that unique index into a dated pair is NOT written. It has to come before the
general ledger's own rules are used for anything dated — realistically before
November 1st, since that is the date Michael named. Recorded here rather than
attempted, because a unique-index change on a live table is its own slice with
its own backfill.

**The gate:** `atm-classification-core.test.ts` asserts the dated behaviour the
schema cannot yet express — *"still gives October's answer for an October row
after November's rule exists"*, *"switches on the boundary day itself, not the
day after"*, and *"treats effectiveTo as INCLUSIVE"*. Mutants 1, 2 and 3 (a
dateless lookup, a fallback to the nearest rule, an exclusive end date) are each
killed by three of them. There is no gate on the SQL side, and that absence is
the open half of this record.

---

## D-31 - Not one retail sale has ever reached the general ledger

**Found:** books-70, by walking the ledger's own `source_kind` vocabulary and
asking which values any code path can actually produce.

**What broke:** `pos_sale` has zero producers. 97 files live under `src/lib/pos`
and `src/app/api/pos`; none of them calls `submitJournal`. Sales, discounts
(50900) and refunds (50910) are all absent from the books. The accounts were
seeded in 0173 and have never been touched.

**How it hid:** the POS works. Orders are taken, tenders are recorded, the
`orders` table fills up. Nothing in the application is broken, and nothing
reports an error, because posting to the ledger was never wired rather than
wired wrongly. A missing feature has no failure mode to notice.

### books-77 -- the arithmetic now exists; the wire does not

`src/lib/accounting/sale-journal-core.ts#buildSaleJournal` turns a POS order into
the two entries it implies, and passes the REAL `ledger-core.ts#validateJournalDraft`
with zero issues on both halves.

The load-bearing idea is that the shelf price is **tax-inclusive**, so both taxes
are EXTRACTED from what the customer paid and never added to it. Adding 37% to a
$10.00 sticker would invent $3.70 of excise the customer never handed over and
inflate revenue by the same amount. Worked in full for a $10.00 bag of flower:

```
excise   = round(1000 x 3700 / 14630) = 253c   -> 32000, TRUST, RCW 69.50.535(4)
salesTax = round(1000 x  930 / 14630) =  64c   -> 32100, TRUST
revenue  = 1000 - 253 - 64            = 683c   -> 50010, NET of excise
                                        1000c  <- debit 10110, what was paid
```

The 9.3% is computed on a base that EXCLUDES the 37% excise, which is not a
simplification: account 32100's own chart description says so, and 50000's says
revenue is recognised net of the excise. Both taxes therefore share one base,
which is why a single 1.463 divisor does the whole job. Accessories,
paraphernalia and merch (`isCannabis: false`) take the 9.3% only, and the excise
account does not appear on their entries at all -- not as a zero line, since
migration 0172 forbids a zero-amount line.

**Where the residual goes, stated rather than silent.** Extracting three integers
from one leaves a sub-cent remainder. Each tax is computed at its own statutory
rate and **revenue absorbs the fraction**, reported on every entry as
`roundingResidualCents`. The direction is deliberate: pushing the residual into a
tax account would mean remitting a number not derived from the statute, dressing
a rounding convenience up as a trust liability. Taking it from Michael's own
revenue can never overstate what the State is owed. All money math is integer;
`divRoundHalfUp` never routes a value through a float.

**Still MISSING: reachable.** `grep -rn 'buildSaleJournal' src/app src/lib/pos`
-> 0 callers. The builder is correct and tested and nothing calls it, so the
books still contain no sales. The gap moved from "nothing computes this" to
"nothing calls it", and the census says exactly that rather than claiming the row
is closed. A dedicated test asserts the caller list is empty, so wiring it will
fail that test and force the census row to be updated in the same commit.

**Gate:** `tests/compliance/ledger-census.test.ts` asserts that nothing under
`src/lib/pos` reaches a ledger door, and separately that no module anywhere
emits `sourceKind: "pos_sale"`. Both tests FAIL the moment sales are wired,
which forces the census row to be updated in the same commit.

---

## D-32 - Excise and retail sales tax cannot be told apart from stored data

**Found:** books-70, while checking whether the trust liabilities 32000 and
32100 could be posted from what the database already holds.

**What broke:** two things, and the second is the harder one. First, `excise`
has zero producers, so the 37% cannabis excise is never accrued. Second, prices
are TAX-INCLUSIVE (`CANNABIS_EXCISE_TAX_BPS = 3700`, back-out divisor 1.463,
RCW 69.50.535) and the `orders` table from migration 0007 stores only
`subtotal_minor_units`, `estimated_tax_minor_units` and `total_minor_units`.
There is no excise column. A single blended "estimated tax" figure cannot be
split into 32000 and 32100 after the fact.

**How it hid:** the total the customer pays is correct, which is the only figure
anybody looks at on a receipt. The split only matters when the money has to be
handed to two different agencies, and that step is the one nobody has reached
yet.

**Gate:** the census test asserts `estimated_tax_minor_units` exists in 0007 and
that the word "excise" does not, so the day a column is added the test fails and
the finding is revisited deliberately. Also asserted: nothing emits
`sourceKind: "excise"`.

**Note on scope:** 32000 is TRUST money, collected on the state's behalf. Booking
it as revenue overstates income and understates a liability the state can audit.

---

## D-33 - Cost of goods sold is never booked, which is the 280E deduction

**Found:** books-70.

**What broke:** `cogs-position-core.ts` computes costing and has ZERO importers.
Nothing moves cost from inventory (20000) to COGS (60000) when product sells.
`coa-core` already mirrors every 20xxx inventory account to a 60xxx COGS account
per category, so the destination exists; nothing selects it.

**How it hid:** inventory quantities are tracked correctly by the inventory
system, so the shelves and the counts agree. The financial consequence lives in
a ledger nobody was reading yet.

**Why this is the most expensive record in the register:** under IRC 280E a
cannabis retailer may deduct essentially nothing except cost of goods sold. An
unbooked COGS is tax paid on gross receipts instead of gross profit.

### books-77 -- COGS is now welded to the sale, so it cannot be forgotten

`buildSaleJournal` returns `cogsJournal` alongside `revenueJournal`, and there is
no way to ask for the revenue half alone. That coupling is the design decision,
not an implementation detail: a sale that credits revenue and never relieves
inventory overstates 280E income by the entire cost of the product, and the only
reliable way to stop that is to make the two inseparable at the type level.

The entry debits the 6xxxx COGS account and credits the mirrored 2xxxx inventory
account on the same category slug, routed through `coa-core`'s existing
`cogsAccountCode` / `inventoryAccountCode` helpers rather than a second copy of
the taxonomy. Every 6xxxx line carries `cost_class: 'cogs_direct'`, because 0173
seeds those accounts with `requires_cost_class` and 0172 would otherwise raise
`GL_COST_CLASS_REQUIRED`; the 2xxxx lines carry `'none'`, or 0172 raises
`GL_COST_CLASS_NOT_ALLOWED` on a balance-sheet line.

**The refusal that matters most is `UNIT_COST_UNKNOWN`.** When a lot cost is not
known the builder refuses the whole order rather than booking the sale at zero
cost. A zero would look like a working system and quietly produce the single most
expensive error available here -- full revenue recognised with no deduction
against it. Standing rule 1: never guess.

**Correction to this record.** The original entry said `cogs-position-core.ts`
has "ZERO importers", and a later re-measurement appeared to contradict it with
5 hits. Re-measured properly in books-77: those 5 are comments and a runtime
path string; `grep` for an actual `import ... from ".../cogs-position-core"`
returns **0**. The original claim was correct and is now stated precisely enough
that it cannot be misread again.

**Gate:** census test asserts `cogs-position-core` has no importer, and the
census row for `cost_of_goods_sold.cogs_on_sale` carries the consequence in
writing so it cannot be reprioritised by accident.

---

## D-34 - The vendor bill builder is finished, correct, and unreachable

**Found:** books-70, function-level reachability sweep.

**What broke:** `vendor-bill-core.ts` builds a complete, balanced bill journal
with 280E cost classes, and `billSourceRef` builds a genuinely good idempotency
key (`manifest:<n>` when the bill came from an accepted manifest, else
`bill:<vendor>:<invoice>`). Migration 0187 supplies the posting door
`gl_post_vendor_bill` and an auditor `gl_audit_vendor_bill_wiring`. NOTHING
calls any of it: `src/app/admin/books/bills/` has no `actions.ts`, and no
`supabase.rpc()` names the door. Inventory receipts and freight-in (60800) are
therefore never booked either.

**How it hid:** this is the archetype the census was built to catch. The module
has thorough self-tests and they all pass. Purity is the absence of the wiring in
question, so a pure test can never see that nothing calls it. Reviewed on its
own, the file looks complete - because it is.

**Gate:** the census test asserts `src/app/admin/books/bills/actions.ts` does not
exist and that `gl_post_vendor_bill` has no `.rpc()` caller, plus a positive
control listing the three doors that ARE called. Wiring the bill screen breaks
the test.

---

## D-35 - Nothing connects an approved purchase order to the receipt that should post

**Found:** books-70, while answering Michael's question "I want to make sure that
purchase orders are properly booked."

**What broke:** the honest answer is that a plain PO should NOT hit the ledger -
an unfulfilled purchase order is a commitment, not a transaction, and booking it
would overstate both assets and payables. The real gap is that none of the 12
`po-*` modules under `src/lib/purchasing` connects an approved PO to the receipt
event that IS supposed to post, and `20800 Inventory - In Transit` (which would
carry goods that have shipped but not arrived) is unused.

**How it hid:** it presents as a question with an intuitive wrong answer. "Are
POs booked?" invites wiring a journal that should not exist. Recording the
correct treatment as a `NOT_APPLICABLE` verdict with a stated reason means the
next person to ask does not have to re-derive it, and cannot "fix" it by
mistake.

**Gate:** the census row `vendor_cycle.purchase_order_commitment` carries
`correct: NOT_APPLICABLE` with the reason, and a test asserts that verdict and
its reason text. The validator refuses `NOT_APPLICABLE` without a reason, so the
justification cannot be dropped.

---

## D-36 - A vendor ACH payment would be booked twice, and the books would balance

**Found:** books-70, tracing the workflow Michael described.

**What broke:** the full ACH stack exists - `nacha-core`, `vendor-ach-core`,
`payee-banking-store`, `invoice-po-match-core`, `vendor-payables-store` - with
zero ledger references. Separately, `payments/vendor-reconcile-core.ts`
(`reconcileVendorPayments`, with a real tolerance model) ALREADY matches system
payments to bank withdrawals. It returns matches and posts nothing.

**How it hid:** this is the failure mode that survives an audit. The same dollar
arrives twice - once from the system that spent it, once from the Plaid feed that
saw it leave - and each arrival is individually correct. Book both and the
expense doubles while the trial balance still balances and the bank still
reconciles. There is no imbalance for a control to detect.

**Gate:** the census test asserts both reconcilers exist, that neither contains
`submitJournal(`, and that the census records their marriage layer as PARTIAL
rather than MISSING - so a future wiring slice connects the existing matcher
instead of rebuilding it.

---

## D-37 - The bank feed cannot post, and the rules table that would classify it is inert

**Found:** books-70.

**What broke:** 16 files under `src/lib/plaid` and none reaches a ledger door.
Migration 0189 supplies an entire SQL-side reconciliation suite -
`gl_post_bank_match`, `gl_unmatch_bank_row`, `gl_bank_reconcile`,
`gl_sign_off_bank_reconciliation` - with no `.rpc()` caller. The
`gl_account_rules` table that would map a description to an account is empty and
no code reads or writes it (see D-30).

**How it hid:** the Plaid integration visibly works - transactions arrive and are
displayed. Display and posting are different problems, and only one of them was
solved.

**Why this is nonetheless the SAFEST thing to wire first:** a bank-fed expense
has no in-system counterpart, so nothing can duplicate it. Its marriage layer is
`NOT_APPLICABLE` for a real reason rather than an unfinished one, which is
exactly what makes it the right starting point.

**Gate:** census test asserts nothing under `src/lib/plaid` reaches a door and
that `gl_post_bank_match` has no caller.

---

## D-38 - The payroll journal is built, proven, and called only by a development script

**Found:** books-70. This record is the reason the census measures reachability
at FUNCTION level rather than MODULE level.

**What broke:** `payroll-cogs-core.ts#buildPayrollJournal` builds a complete
payroll journal including the 61000 allocable-inventory-labour split that 280E
turns into real money. Migration 0188 supplies `gl_post_payroll_run` and
`gl_payroll_allocation_guard`. `grep -rn buildPayrollJournal` returns matches
ONLY inside `payroll-cogs-core.ts` itself, all in its own self-tests. The single
external caller anywhere is `scripts/compliance/e2e-payroll-journal.ts`, whose
header says "Not part of the app. Development verification only." Net pay,
withheld tax remittance (31100), employer tax (31200) and garnishments (31300)
are all unbooked.

**How it hid - and how it nearly hid from the census itself:** the FIRST DRAFT of
`ledger-census-core.ts` scored reachability by counting module importers.
`payroll-cogs-core` has six of them, so the first draft scored payroll WIRED.
Those six importers take types, labour-role codes and teaching content - not the
journal builder. A census that measured modules would have shipped a green
verdict on the largest unwired subsystem in the platform.

**Gate:** two of them. `validateCensusRow` now REFUSES any row claiming
`reachable = PRESENT` without naming a `file#symbol` poster, so the contradiction
cannot be expressed. And the census test asserts that no file in `src/` outside
`payroll-cogs-core.ts` mentions `buildPayrollJournal` at all.

---

## D-39 - Cash movements from till to vault to bank are not booked

**Found:** books-70.

**What broke:** 7 files under `src/lib/registers` with zero ledger reach.
`10400 Undeposited Funds` and `10900 Cash - Clearing / In Transit` were seeded
for exactly this purpose and are unused, as is `50920 Cash Over / (Short)`.
Neither deposits nor till discrepancies are recorded.

**How it hid:** register close-out works as an operational process, so staff
count and reconcile and the drawer balances. The accounting consequence lives
elsewhere.

**Why it matters more here than in most businesses:** in a cash-heavy regulated
industry the till-to-bank trail is the first thing an examiner asks for, and
over/short is the earliest signal of both honest error and theft.

**Gate:** census test asserts nothing under `src/lib/registers` reaches a ledger
door.

---

## D-40 - The ATM classifier decides correctly and posts nothing

**Found:** books-70, immediately after books-69 shipped the classifier.

**What broke:** books-69 built `atm/atm-classification-core.ts` - effective-dated,
5 rules, 80 tests, 18/18 mutants killed - and wired it to
`store.ts#listAtmClassificationProposals`. That function returns PROPOSALS for
human review, by design. No journal is built from an accepted proposal. Vault
loads (10300 against 10100) and surcharge income (51000) are unbooked.

**How it hid:** it is not hiding; it is the deliberate end of the previous slice.
It is recorded because "reviewed and proposed" is one step short of "booked", and
without a register entry the distinction erodes into an assumption that the ATM
is done.

**Note:** `ledger-core.ts:770` uses code `70100` named "ATM Fee Income" inside a
self-test FIXTURE. The seeded account is `51000 ATM Surcharge Income`. The
fixture is not a production mapping and must not be copied when this is wired.

**Gate:** the census row records the classifier's `correct` layer as PARTIAL with
the reason that classification is proven while the journal is not built, and the
validator forbids a PARTIAL verdict from carrying softening prose.

---

## D-41 - Intercompany transfers have a working paired door and no caller

**Found:** books-70.

**What broke:** `posting-service.ts#submitIntercompanyPair` exists and
`gl_submit_intercompany_pair` is one of only three ledger write doors any code
actually invokes - but the only `.rpc()` call sits inside the service itself, and
`grep -rn submitIntercompanyPair src/app` returns zero callers. `36000 Due To /
From Related Entity` is unused.

**How it hid:** the door is genuinely complete and atomic, so any review of it
passes. Nothing about the module reveals that no screen reaches it.

**OPEN QUESTION FOR MICHAEL, and the census refuses to guess it:** the vendor
payment made out of account 6228 is either an intercompany balance (36000) or a
capital contribution (41100). That is a decision about intent, not a measurable
fact, and it changes Michael's basis. The census records this as `correct:
UNKNOWN` with the reason stated, per standing rule 1.

**Gate:** the validator refuses `UNKNOWN` without a reason, so the open question
cannot decay into a silent assumption.

---

## D-42 - The B&O tax accrual is correct to the millionth and has no caller

**Found:** books-70.

**What broke:** `bo-tax-core.ts` exports `boAccrualEntry` and `boPaymentEntry`,
holding rates in MILLIONTHS specifically to avoid the rounding drift a percentage
would introduce (.00471 retailing for Greenway, .015 service for the ATM entity).
`grep -rn 'boAccrualEntry|boPaymentEntry' src/` returns ZERO callers. 75040 B&O
Tax Expense and 32200 B&O Tax Payable are unused.

**How it hid:** same shape as D-34 and D-38 - a finished, well-tested pure module
with no wire. B&O is owed on gross receipts whether or not there is profit, so
the liability accrues in reality regardless of whether the books record it.

**Gate:** census test asserts no file in `src/` outside `bo-tax-core.ts` mentions
either export.

---

## D-43 - Fixed assets and depreciation are ready in the database and unwired - and my first finding about them was WRONG

**Found:** books-70. Recorded with the error included, because the error is the
more useful half.

**What I first concluded, and stated to Michael:** that the chart of accounts was
complete and only wires were missing. Then, that the entire fixed-asset block
(21000-21900) was ABSENT from the chart, making capitalisation impossible.

**Both were wrong, and the second was wrong in the more dangerous direction.** I
extracted the chart of accounts from `0173_chart_of_accounts.sql` alone - 183
accounts - and 21000-21900 are not in it. They are seeded by
`0178_fixed_assets.sql` via `gl_upsert_account`, with `0189` adding one more:
193 accounts in total. 0178 also installs `gl_guard_no_land_depreciation` and
`gl_check_accumulated_depreciation`. The chart, the guards and the MACRS maths in
`fixed-assets-core.ts` all agree with each other.

**The actual defect:** `fixed-assets-core.ts` has no importer - five files
mention it, every mention being a comment or
`period-close-mentor-gates.ts` reading it as TEXT - and nothing emits
`sourceKind: "depreciation"`. So no asset has ever been capitalised or
depreciated, but the blocker is a missing wire, not a missing chart.

**How the WRONG finding hid:** it was measured, evidenced, reproducible and
confidently reported. A single-source measurement produces exactly the same kind
of confidence as a complete one. The chart is the sum of every migration that
ever touched it; reading one file answered a narrower question than the one I
asked.

**Gate:** the census test now scrapes account codes from EVERY migration and
handles both seeding shapes (`VALUES` tuples and `gl_upsert_account(...)`). One
test asserts 21000-21900 ARE present; another asserts the all-migrations total
exceeds the 0173-only total and that `21900` is absent from 0173 specifically -
so the shortcut that produced the wrong answer can never silently return.

---

## D-44 - Loan principal and interest are not split, and neither is booked

**Found:** books-70.

**What broke:** `sourceKind: "loan"` has zero producers. `34000 Notes & Loans
Payable` and `85010 Interest Expense` are seeded and unused.
`plaid/liabilities-core.ts` reads liability data and posts nothing.

**How it hid:** a loan payment leaves the bank as a SINGLE debit. It looks like
one expense, and booked as one it is wrong in two directions at once - the
liability is never reduced and the deduction is overstated.

**Gate:** census test asserts nothing emits `sourceKind: "loan"`.

---

## D-45 - Crypto activity is not booked (recorded so it is not mistaken for an oversight)

**Found:** books-70.

**What broke:** 35 files under `src/lib/crypto`; `sourceKind: "crypto"` has zero
producers. `80030 Realized` and `80040 Unrealized Investment Gain/(Loss)` are
unused. An on-chain transaction hash would be a perfect natural idempotency key
and is not used as one.

**Why it is recorded despite being lowest priority:** it belongs to the personal
entity and affects the 1040 rather than the business return. Left unrecorded, its
absence from a wiring plan looks like an omission; recorded, it is a decision.

**Gate:** the census row exists with a stated consequence, and its marriage layer
is `UNKNOWN` with the reason that it depends on which exchange accounts Michael
has linked - which is not measurable from the source tree.

---

## D-46 - There is no period close and no way to reverse a posted entry

**Found:** books-70.

**What broke:** `period-close-core.ts` has no functional importer and nothing
emits `sourceKind: "close"` or `sourceKind: "reversal"`. `gl_reverse_journal`
exists in 0172 with no `.rpc()` caller. `40300 Retained Earnings` and `40400
Opening Balance Equity` are unused.

**How it hid:** neither matters until posting starts. Both matter immediately
afterwards. Without a close, a prior period can silently change after the CPA has
filed from it - which is the difference between books and a spreadsheet. Without
a reversal path, the first mistake can only be corrected by hand-keying the
opposite entry with no link between the two.

**The idempotency trap in the reversal case:** reversing twice re-creates the
error it was cancelling, and the books still balance afterwards. Like D-36, there
is no imbalance for a control to catch.

**Gate:** census test asserts nothing emits either source kind.

---

## D-47 - Opening balances have a staging table, a validator, and no path into the ledger

**Found:** books-70.

**What broke:** `0176_opening_balances.sql` supplies a staging table plus
`gl_ob_validate_row`, `gl_bless_opening_balances` and
`gl_close_opening_balance_equity`. `gl_opening_balance_summary` IS called from the
app, so the staging side is reachable READ-ONLY. The two functions that would
turn staged balances into journals have no `.rpc()` caller, and nothing emits
`sourceKind: "opening_balance"`.

**How it hid:** the read path works, so the screen shows data and looks
functional. Reading staged balances and posting them are different operations.

**Why it gates everything else:** every other row in the census assumes a
starting point. Until opening balances are loaded, even perfectly wired activity
produces a balance sheet that starts from zero.

**BLOCKED ON MICHAEL, not on code:** the opening figures come from the Sage
COA-tagged spreadsheets, which he has not yet produced. Standing rule 1 - the
census will not invent them. Recorded as `correct: UNKNOWN` with that reason.

**Gate:** the validator refuses `UNKNOWN` without a reason; the census test
asserts nothing emits `sourceKind: "opening_balance"`.

---

## D-48 - The cut-over inventory load has no path into the books, and it is the largest number the ledger will ever receive

**Found:** books-70 follow-up recon, in answer to Michael's own question: *"When I
go to transfer my inventory from Cultivera to our system, how will the system add
that inventory to the books? I want to make sure it is accounted for properly."*

**Severity:** BLOCKING for the 2026-11-01 cut-over.

**The plan, in Michael's words:** *"I plan on auditing the inventory October 31st,
after we close. Then upload the inventory November 1st before we open."*

**What is already right, and it is more than expected.**

- Migration `0186_cutover_config.sql` **already moved the opening-balance date to
  2026-10-31**, which is exactly the day Michael named. Its own header records
  that the previously hard-coded `2025-12-31` would have *"stamped the cut-over
  TEN MONTHS EARLY. Nothing would have errored. The journal would have balanced."*
- `0173_chart_of_accounts.sql` seeds **21 per-category inventory accounts**
  (`20010` Flower through `20220` Merch) under control account `20000`, plus
  `20890` as a visible quarantine.
- `inventoryAccountForCategory` (`vendor-bill-core.ts:966`) maps a category slug
  to its account and is self-tested, including the zero-padding trap
  (`infused-blunt` -> `20100`, not `2100`) and returning `null` on an unknown
  category rather than guessing.
- `gl_guard_inventory_manual` (`0173:316`) **refuses** any `source_kind='manual'`
  journal line touching a `2xxxx` asset account. Its message is explicit:
  inventory moves only with goods. So the database already forbids the wrong way
  to do this.
- `0176_opening_balances.sql:76` lists **`inventory_count`** among the valid
  `evidence_kind` values. The worksheet was designed to accept exactly this row.

**What is missing.** The path. Measured:

- `grep -rn 'sourceKind: "opening_balance"' src/` -> **0 hits**.
- No file in `src/` inserts into `gl_opening_balances`. `ledger-store.ts:458`
  only `SELECT`s from it.
- `src/app/admin/books/conversion/page.tsx` is 361 lines and contains **zero**
  `rpc(` calls. This is deliberate and correct - its header states *"Nothing here
  posts anything... a screen that could bypass it would be the single most
  dangerous button in the application, because a wrong opening balance can never
  be found again."*
- `gl_bless_opening_balances` and `gl_close_opening_balance_equity` have no
  caller (already recorded as D-47).

**THE CLASSIFICATION QUESTION, and it is the whole defect.** The cut-over load is
**not a purchase**. That product was bought and paid for under Cultivera and Sage;
its cash left the bank before this platform existed. Booking it through the
receipt path would credit `30000 Accounts Payable` and invent a liability to
vendors who have already been paid - overstating liabilities and understating
equity by the entire value of the shelf. The correct shape is a debit to the
per-category inventory accounts against **`40400` Opening Balance Equity**, with
`source_kind='opening_balance'` and `evidence_kind='inventory_count'` citing the
2026-10-31 count.

**Why it is dangerous rather than merely missing.** Every COGS figure for the life
of the business is measured from this number, and under Sec. 280E cost of goods is
the only deduction available. A wrong opening inventory value propagates into
every 280E computation forever, and the balance sheet balances either way.

**Blocked on:** the 2026-10-31 count and Cultivera's per-unit costs. **Not
invented** (rule 1). The census records `correct: UNKNOWN` with that reason
attached.

**Census row:** `cost_of_goods_sold.cutover_inventory_load`.

---

## D-49 - Cultivera manifest imports put product on the shelf and value nowhere, and the CCRS CSV path carries no cost at all

**Found:** books-70 follow-up recon.

**Severity:** BLOCKING for accurate books from 2026-11-01 onward.

This is the *ongoing* sibling of D-48: after cut-over, every new delivery arrives
as a Cultivera / WCIA transfer data link.

**Cost DOES survive the import, on one path.** `intake-parser.ts:375-380` computes
`unit_cost_minor_units = round((linePrice / qty) * 100)` and migrations `0023` /
`0028` persist it on `inventory_lots`. `0067_vendor_manifest_payments.sql` already
computes what is owed as `SUM(received_qty * unit_cost_minor_units)`. This is a
genuinely good position to be in.

**But `ccrs-manifest-csv-core.ts:495` hard-codes `unit_cost_minor_units: null`,**
because a CCRS transfer file carries no price. So cost is present on the
URL/PDF path and **absent** on the CSV path. Once posting is wired, that path
would book a **zero-value receipt** unless it refuses instead. It must refuse:
`0192`'s own comment on the audit path already establishes the principle -
*"NULL here means 'not valued'... an unknown value is never quietly turned into a
zero."*

**Nothing posts.** Measured on `src/app/admin/inventory/intake/actions.ts` (821
lines, 21 exported server actions including `importManifestAction`,
`importManifestBatchAction` and `finalizeManifestAction`): **0** `submitJournal`
or `gl_` posting calls. `BatchTransferImport.tsx` states its own scope as
*"DRAFTS-ONLY."* Product reaches the shelf; value reaches nothing.

**What is already right.** `buildBillJournal` resolves cannabis lines to the
category subaccount and falls back to `20890` quarantine on an unknown category
rather than guessing (`vendor-bill-core.ts:1140-1146`), and applies the entity
correction so only `greenway` carries `nondeductible_280e`. `billSourceRef`
already yields `manifest:<n>`, the right idempotency key. The import
de-duplicates URLs and reports "already imported", so the staging side is
idempotent.

**The open design question for the wiring slice:** does the entry post at
**import** (manifest staged) or at **finalize** (lots activated)? Recommendation,
with reasoning: **finalize**, because a staged manifest is a draft that may be
rejected, partially accepted, or blocked by the WAC 314-55-096 sample cap, and
`finalizeManifestAction` already computes `activated` / `rejected` / `blocked`
counts. Posting at import would book product that never came on the shelf. This
is D-35's lesson applied one step earlier: the commitment is not the transaction.

**Census row:** `cost_of_goods_sold.cultivera_manifest_import`.

## D-50 - The ledger inherits the website menu's category groupings, and four of them ignore a more specific account that already exists

**Found by:** books-71 recon, measuring Michael's real Cultivera exports
(`INVENTORIES.xlsx`, 3,917 rows; `PRODUCTS.xlsx`, 3,311 rows) against the code.

**Status:** OPEN, awaiting an owner decision. Not a code fault.

**The good news first, because it reverses an earlier fear.** The census recorded
the cut-over's category side as unsolved. It is solved. `src/lib/pos/transform.ts`
already contains `CATEGORY_MAP`, a hand-built Cultivera-category to
Greenway-slug map with 53 entries. Measured against the real export by
`scripts/recon/cultivera-existing-map.py` (which parses the map out of the
TypeScript source rather than retyping it, so the measurement cannot drift from
the code):

- Cultivera categories present in the file: **52**
- covered by the existing map: **52**
- not covered: **0**
- shelf value routed to a real category account: **$176,824.62 = 100.00%**
- shelf value routed to `20890` quarantine: **$0.00 = 0.00%**
- map entries pointing at a slug with no inventory account: **0**

My own first pass, applying only the naive slug rule the posting code uses
(lowercase, spaces to hyphens), concluded that 43 of 52 categories would fail and
**51.31% of shelf value would land in quarantine.** That conclusion was wrong. It
measured a rule, not the system. Recorded here because the wrong number is the
instructive part: a plausible-looking measurement of the wrong artifact produced a
false alarm, and only reading the actual mapper corrected it.

**The defect.** `CATEGORY_MAP` was written for the **storefront menu**, where
grouping blunts with prerolls is good merchandising. The **ledger** has dedicated
accounts the menu map does not use. Four entries route to a less specific account
than the chart provides:

| Cultivera Category | map sends to | dedicated account that exists | rows | value |
|---|---|---|---|---|
| `RSO` | `20140` Concentrate | **`20150` RSO** | 47 | $2,680.69 |
| `Tincture` | `20170` Edible (Liquid) | **`20180` Tincture** | 32 | $2,484.78 |
| `Infused Blunt` | `20080` Infused Preroll | **`20100` Infused Blunt** | 44 | $951.78 |
| `Blunt` | `20050` Preroll | **`20070` Blunt** | 24 | $782.82 |

Combined value affected: **$6,900.07** of $176,824.62 (3.90%).

Neither choice is an error. Sharing the menu map keeps one list to maintain and
guarantees the menu and the books agree. A ledger-specific override uses the chart
as designed and yields finer margin reporting. **This is an accounting judgement
and it belongs to Michael.** Rule 1: not decided here.

**Whatever is decided, one rule must hold: `Category` must win over
`InventoryType`.** `Infused Pre-roll` carries `InventoryType = Concentrate for
Inhalation` on 532 of its 617 rows. An infused pre-roll is not a concentrate.
Keying on `InventoryType` would post **$19,547.49** to `20140` instead of `20080`
and every report would still balance. `Usable Marijuana` is similarly unusable as
a key: the file carries Flower (749), Pre-roll (626), Infused Pre-roll (85), Blunt
(24) and stray `Panda Candies` (1), `Roll On` (1), `Hash` (1) under it.

**Also measured, and consequential for the loader:** `Barcode` is NOT unique - 41
barcodes appear on more than one row (35 groups at identical cost, 6 groups at
**different** costs, all with differing `Received date`). `Id` IS unique (3,917
distinct, 0 duplicates). A loader keyed on barcode would collapse 41 real cost
lots. Whether the 6 differing-cost groups keep both layers or are averaged is a
second owner decision.

**Census rows:** `cost_of_goods_sold.cutover_inventory_load`,
`cost_of_goods_sold.cultivera_manifest_import`.

## D-51 -- the cut-over inventory builder exists, and two of its guards were decoration until a mutation campaign said so

**Slice:** books-72. **Status:** builder BUILT and double-gated; nothing calls it
yet, deliberately.

`src/lib/accounting/cutover-inventory-core.ts` now converts a counted lot list
into the cut-over opening-balance entry: per-category `200xx` debits and ONE
`40400` Opening Balance Equity credit. It is a pure leaf -- zero imports, no I/O
-- so it can be reasoned about and tested in isolation.

**Why the credit is equity and not accounts payable.** The shelf counted on
2026-10-31 was bought and paid for months earlier, under Cultivera, with money
that left the bank before this platform existed. Booking the load as a purchase
would credit `30000` Accounts Payable and assert that Michael owes his vendors
the entire value of his inventory. His liabilities would be overstated by
$176,824.62-ish, his equity understated by the same, **and the trial balance
would still balance.** Every report would render. Michael closed the last input
question himself: *"The cost from Cultivera is the invoice cost. There isn't any
other cost associated with inventory purchases unfortunately... All that matters
is the cost from the spreadsheet is the all inclusive cost for that product."*
So nothing is added to the invoice cost, and employee hours capitalised to COGS
were explicitly excluded from this slice by the owner.

**THE FINDING WORTH RECORDING.** A 30-mutant campaign against the module left
**two survivors**: deleting the builder's internal balance assertion, and
deleting its control-account loop, changed **no test result at all**. Both were
correct code. Both were also unreachable through the builder's input surface --
no category slot resolves to `20000`, and the balancing credit is derived from
the same sum that builds the debits. Under rule 43 that made them decoration, not
protection. Fixed by extracting both into an exported
`findCutoverLineSetDefect(lines)` that a test can hand hostile lines directly.
The builder still calls it on every run, so protection is unchanged; the
difference is that it is now proven rather than asserted. Re-tested: 4 further
mutants aimed at the extracted guard, all 4 dead. **Final: 34 mutants, 34 dead,
0 survivors.**

**A process failure in the same campaign, recorded because the result was nearly
believed.** The first run reported a clean 26/26 sweep. It was worthless. A
blocking command reported a timeout without killing the python process; a second
copy was then started, and the two raced on the same module and the same backup
file. The second process captured an ALREADY-MUTATED file as its baseline and
"restored" that at the end, leaving two mutants (broken zero-padding, so `20100`
rendered as `2100`; and a balance check hard-coded to `return true`) baked into
the module AND into the backup. Two other mutants silently failed to apply and
were never tested, yet the run still printed a clean sweep. Detected only because
`grep padStart` returned nothing. Repaired, then verified BY BEHAVIOUR
(`infused-blunt -> 20100`, and a tampered plan reporting unbalanced) rather than
by string match. The campaign was rewritten with a lockfile, pattern
pre-validation that refuses if any pattern does not match exactly once, a
baseline-must-be-green check, and sha256-verified restoration.

**Measured, not assumed:** the live `CATEGORY_MAP` in `src/lib/pos/transform.ts`
has **53 source keys but only 12 distinct target slugs**, so it can currently
reach only 12 of the 21 inventory accounts. The nine it cannot reach are
`accessories`, `blunt`, `infused-blunt`, `infused-preroll-pack`, `merch`,
`paraphernalia`, `preroll-pack`, `rso`, `tincture`. This is not a defect in the
builder, which files all 21 correctly; it is the D-50 routing question still
awaiting Michael's decision. Pinned in a test at the exact measured counts so
that when the map gains finer slugs the count changes and the test FAILS, forcing
the change to be acknowledged rather than absorbed (rule 89).

**Design decisions, each with a reason:**
- Keys on `Id`, never `Barcode`. books-71 measured 41 barcodes spanning multiple
  rows, 6 at genuinely different costs; a barcode-keyed loader would collapse
  real cost layers and lose value.
- An unresolved category is **dropped and named, not quarantined to `20890`**. A
  mid-year vendor bill can be parked and cleaned up later; the cut-over is the
  foundation every later number is measured from, so it asks rather than parks.
- A negative or zero cost is dropped and named, never netted against a good lot
  and never silently zeroed. The table refuses a zero line outright
  (`check (amount_cents <> 0)`).
- Range checks use `Number.isSafeInteger`, not `Number.isInteger`.
  `Number.isInteger(1e300)` is `true`, and past `MAX_SAFE_INTEGER` money stops
  being exact. Both the per-lot extension and the running total are checked, so
  an unholdable value is named where it enters instead of resurfacing as an
  unexplained imbalance.
- No rounding exists anywhere in the module. Cost is integer cents, quantity is
  whole units, so the extension is exact. Fractional quantities are refused
  rather than rounded, because how to round half a gummy is an accounting
  decision and rule 1 forbids inventing one. D-10 stays open and uninvented.

**Reachability is deliberately still MISSING.** `grep -rn
'buildCutoverInventoryPlan' src/` finds only the definition. No migration, no UI,
no server action, no posting call. The census row records `exists: PARTIAL` and
`reachable: MISSING`; writing a builder does not make a path reachable, and
recording otherwise would be the exact overstatement the census exists to
prevent.

**Census rows:** `cost_of_goods_sold.cutover_inventory_load`.

---

## D-50 UPDATE -- DECIDED by Michael: the ledger gets its own map

**Decided:** books-73. Michael, verbatim:

> "the ledger should use its own accounts and not the website map."

That closes the open question D-50 recorded. The ledger no longer inherits
`src/lib/pos/transform.ts#CATEGORY_MAP`; it has its own map in
`src/lib/accounting/ledger-category-map-core.ts`, and the four measured
divergences are applied:

| Cultivera Category | website menu map | LEDGER account | rows | value |
|---|---|---|---|---|
| `RSO` | `20140` Concentrate | **`20150` RSO** | 47 | $2,680.69 |
| `Tincture` | `20170` Edible (Liquid) | **`20180` Tincture** | 32 | $2,484.78 |
| `Infused Blunt` | `20080` Infused Preroll | **`20100` Infused Blunt** | 44 | $951.78 |
| `Blunt` | `20050` Preroll | **`20070` Blunt** | 24 | $782.82 |

Total re-routed: **$6,900.07** of $176,824.62 (3.90%), 147 rows.

**The second question, also decided.** On the 41 non-unique barcodes -- 35 groups
at identical cost and 6 groups at DIFFERENT costs -- Michael said:

> "keep both layers."

So the loader keys on `Id` (3,917 distinct, 0 duplicates), never on `Barcode`,
and the 6 differing-cost groups keep both cost layers rather than being averaged
into one. `cutover-inventory-core.ts` already keys on `Id`, so his answer
confirms the built behaviour rather than changing it. No averaging code exists,
and D-51's builder has no rounding at all, which is what makes "keep both
layers" free rather than a change.

**The third item is a deferral, not a decision.** On wiring the upload/review/post
path for the cut-over count, Michael said:

> "we are not ready to migrate inventory over yet."

So the census row `cost_of_goods_sold.cutover_inventory_load` KEEPS
`reachable: MISSING`. That is now a deliberate deferral with a quote behind it,
not an unmeasured gap. It must not be marked reachable until he asks for it.

---

## D-52 -- the ledger's own category map, and the two guards its own map cannot reach

**Built:** books-73, on Michael's decision above.

**What exists:** `src/lib/accounting/ledger-category-map-core.ts`, a pure leaf
with ZERO imports, no I/O, no clock, no randomness, and -- proved by a
source-level test -- no `Math.round`, `Math.floor`, `toFixed` or `parseFloat`
anywhere. It maps Cultivera `Category` to a house slug and a 5-digit block-2
inventory account.

**The counts are stated, not rounded off.** The measured export
`INVENTORIES.xlsx` (3,917 rows) contains **52** distinct `Category` values. The
map holds **53** keys. The extra key is `Trim`, which carries **zero rows** in
this export but is a real chart category (`20040`) that the website map also
carries. It is mapped in advance so that the first trim Michael receives posts
instead of refusing. Rather than let 52 and 53 sit next to each other looking
like an error, the module exports `MEASURED_CATEGORY_COUNT = 52` and
`UNSTOCKED_MAPPED_CATEGORIES = ["Trim"]`, and the self-test asserts
`keys === measured + unstocked`. A mutant that falsified either constant died.

**Five chart categories are deliberately absent as map targets** --
`preroll-pack`, `infused-preroll-pack`, `accessories`, `paraphernalia`, `merch`.
No Cultivera category in the measured export belongs to any of them. A test
asserts they are NOT map values, because routing something to them without
evidence is exactly the invention rule 1 forbids; it also asserts their accounts
still exist, so a future category can be mapped when there is a real row to map.

**There is no fallback account, and a test enforces that.** The website map has
one by design -- an unmapped category still has to appear on a menu. The ledger
must not, because a fallback in the books silently misstates an account balance.
`CATEGORY_UNKNOWN` names the offending category string in the refusal message. A
mutant that replaced the refusal with a silent route to `20140` died, and so did
one that stripped the category name out of the message.

**"Category wins over InventoryType" is now executable rather than commented.**
D-50 measured the trap: `Infused Pre-roll` carries
`InventoryType = Concentrate for Inhalation` on 532 of its 617 rows, and routing
by `InventoryType` would post **$19,547.49** to `20140` instead of `20080` --
and every report would still balance. That is why it needs a refusal and not a
warning. `resolveLedgerLotCategory` accepts `inventoryType` as a parameter and
never reads it as a key; supplying it alone yields
`INVENTORY_TYPE_IS_NOT_A_KEY` with both account numbers and both row counts in
the message, because Michael is a visual learner and the number he needs to see
is the one the shortcut would have hit. Three mutants attacked this rule -- make
`InventoryType` a fallback key, let it override a good `Category`, strip the
account numbers from the message -- and all three died.

**How the divergence is kept honest.** The test parses `CATEGORY_MAP` out of
`src/lib/pos/transform.ts` SOURCE rather than retyping it, then asserts the set
of actual divergences equals `LEDGER_ONLY_OVERRIDES` **exactly -- no more, no
fewer**. It also asserts the ledger map covers every key the website map covers,
so the books can never be blinder than the menu. Either map can now be edited
and the test will name the drift.

**The failure this record exists for.** The first mutation campaign scored **34
mutants, 30 dead, 4 survivors.** Two survivors -- `CATEGORY_AMBIGUOUS` (two keys
case-folding onto disagreeing slugs) and `SLUG_HAS_NO_ACCOUNT` (a category
pointing at a slug with no account) -- survived because **the shipped map cannot
reach either guard.** The shipped map has no case-folding collision and no
dangling slug, so no input on earth could make those branches fire. Correct code,
genuinely valuable for the map's future, and under standing rule 43 -- "A REFUSAL
CODE THAT NO CODE PATH EMITS IS NOT PROTECTION, IT IS DECORATION" -- not yet
protection.

The fix is the same one D-51 used: the resolver was parameterised on the map it
reads. `resolveLedgerCategoryIn(map, category)` holds the real logic and is
exported so tests can hand it hostile maps (`{RSO:"rso", rso:"concentrate"}` for
the ambiguity guard, `{Ghost:"not-a-real-slug"}` for the dangling-slug guard);
`resolveLedgerCategory(category)` is a one-line wrapper passing the shipped map.
The code that runs in production is the identical function, and a test asserts
both entry points agree on every one of the 53 keys plus four junk inputs.

The other two survivors were **weak tests of mine, not decoration**: one let
`InventoryType` override a good `Category` while my assertion only checked the
account code, and one stripped the teaching numbers out of a refusal message
nothing asserted on. Fixed by comparing the FULL result object against the
Category-only result for all 53 categories under 4 misleading `InventoryType`
values, and by pinning `532`, `617`, `20140`, `20080` in the message.

Re-aiming added 5 mutants. **Final: 39 mutants, 39 dead, 0 survivors**, file
byte-identical to the original at exit (sha256 verified).

**Two more survivors appeared after the refactor and were also real gaps.** One
picked `hits[hits.length - 1]` instead of `hits[0]` on an agreeing case-fold --
harmless to the account, but `matchedKey` is evidence that gets printed, so it
must be deterministic and it must be the first declared key. One made the
wrapper inject an extra key into the map it passes, which no test noticed
because nothing asserted that the public door resolves EXACTLY the declared 53
and nothing else. Both now have named assertions.

**Process note.** The campaign script `scripts/recon/lcm-mutate.py` carries the
five rails the D-51 corruption incident earned: exclusive lockfile, pattern
pre-validation requiring every pattern to match exactly once against the pristine
original before anything is written, baseline-must-be-green, sha256-verified
restore after every single mutant, and a final hash check. **Rail 2 earned its
keep immediately** -- after the resolver was parameterised, three mutants (M17,
M22, M25) no longer matched anything, and the run REFUSED to start rather than
print a clean sweep over three untested mutants. That is precisely the silent
"NOT APPLIED" that made campaign #1's result garbage.

**Census rows:** `cost_of_goods_sold.cutover_inventory_load` (builder side).

---

## D-41 UPDATE -- the professional opinion Michael asked for

**Asked:** books-73. Michael, verbatim:

> "for question 4, i am not sure, please tell me your professional opinion and
> recommendation."

The question: when Michael pays a vendor out of account **6228** (the ATM
account) for something that is not an ATM expense, is that an **intercompany
balance (`36000` Due To / From Related Entity)** or a **capital contribution
(`41100` Shareholder Contributions)**?

This is a question about intent, so it cannot be measured outright. But the
CONSEQUENCES can be, and Michael's existing Sage books already answer most of
it. Measured by `scripts/recon/sage-suffix-check.py` over his real chart (288
accounts) and 550 expense rows totalling $368,276.34:

- **Sage has NO due-to/due-from account. In 288 accounts, there is not one.**
  There is no `36000` equivalent under any suffix.
- **121 expense rows, $61,109.02, are LYMAN-suffixed expenses paid out of
  GREENWAY cash** -- `81002-LYMAN` MAINENANCE $40,206.79 (56 rows),
  `81001-LYMAN` UTILITIES $10,743.08 (61 rows), `81003-LYMAN` PROPERTY TAX
  $10,159.15 (4 rows). Cross-entity payment is not a hypothetical; it is 22% of
  the expense dollars already.
- **Sage DOES book rent both ways:** `70000-GRNWY` RENT (expense) and
  `52000-LYMAN` RENT (income). So the landholding entity is already treated as a
  real counterparty with real revenue, not as a pocket.
- **Owner money is currently classified as EQUITY, and it closes:**
  `41000-GRNWY` WITHDRAWALS - LYMAN, type **"Equity-gets closed"**, carrying
  **$141,904.95 across 87 rows** -- the single largest G/L account in the
  exports. Plus `41001`/`41002` for Mullan and Becker, and `40001`/`40002`/`40003`
  RETAINED EARNINGS per member, type "Equity-doesn't close".

**My recommendation: `36000` intercompany, NOT `41100` capital contribution.**
Four reasons, in the order I weight them.

**1. It is reversible; a capital contribution is not.** An intercompany balance
is a receivable/payable that gets settled or written off later, and either way
the treatment is visible and fixable. A capital contribution permanently
increases Michael's basis in the paying entity and permanently increases the
receiving entity's equity. If we guess "contribution" and it was really a loan,
unwinding it means amending returns. If we guess "intercompany" and it was
really a contribution, we reclassify one balance at year end with the CPA. **The
asymmetry of the mistake decides the default.** Rule 1 says never guess; when a
default is unavoidable, take the one that is cheapest to correct.

**2. His own books already treat the entities as counterparties.** Rent flows
Greenway to Lyman as expense and income. Entities that invoice each other have
intercompany balances. Recording the same relationship as equity in one place
and as revenue in another would make the two treatments disagree.

**3. `41100` means something specific and this probably is not it.** A capital
contribution is money the owner puts IN to fund the business. The 6228 payments
are the ATM entity's cash paying someone ELSE's bill. Nothing was contributed to
the ATM entity; the ATM entity paid out on another entity's behalf. That is the
textbook definition of a due-from.

**4. It is the only treatment that keeps the four entities auditable
separately.** Michael's end game needs each entity to stand on its own -- an
LCB-regulated retailer must. `36000` on both sides preserves that: each entity's
P&L carries its own expenses and each balance sheet carries what it owes the
others. Routing it through equity erases the trail.

**Three things this recommendation does NOT do, so it cannot be mistaken for
more than it is.**

- **It does not post anything.** `submitIntercompanyPair` still has zero callers.
  This is a recommendation about which account a future rule should name, not a
  wiring change.
- **It does not decide the `41000` WITHDRAWALS question.** That $141,904.95 is a
  separate and larger issue: distributions from an S-corp to its members have
  their own basis and reasonable-compensation consequences, and it needs the CPA
  and the K-1 work that is on the back burner. I am not folding it into this.
- **It does not cover the $61,109.02 of LYMAN expenses paid from Greenway cash.**
  Those are the SAME pattern as the 6228 question and the same logic points the
  same way, but they are historical Sage rows, and restating history is Michael's
  and his CPA's call, not mine.

**What I need from Michael to close D-41 rather than merely advise on it:** one
sentence confirming that money one entity spends on another's behalf is expected
to be **repaid or settled** (then `36000` is correct and I will build the rule),
or that it is **not expected to be repaid** (then it is `41100` or a
distribution, and the rule differs). Until he answers, the census row stays
`correct: UNKNOWN` with this recommendation attached as the reason -- an opinion
on the record is not the same as a decision, and the code will keep refusing
rather than assume.

**Census rows:** `intercompany.transfer_pair`.

---

## D-55 - The entity structure was designed for a tax result and never tested against the case that governs it

**Found:** books-74, and found because Michael volunteered the one fact that
makes it findable. Verbatim:

> "They exist solely to mitigate 280E, otherwise all three businesses would be
> under the cannabis business."

**Why this is a defect record and not just research.** Every prior slice treated
the four entities in `gl_entities` as a given -- a settled dimension to post
against. They are not settled. They are a *tax position*, and until books-74
nobody had checked that position against the authority that decides it. A
structure nobody has tested is the same class of problem as a refusal code
nobody can reach (rule 43): it looks like protection and may be decoration.

**What the law actually says.** `Alternative Health Care Advocates v.
Commissioner`, 151 T.C. No. 13 (2018) held that a commonly-owned S corporation
which performed a dispensary's daily operations was *itself* "trafficking in
controlled substances" under Sec. 280E, though it never held title to any
marijuana:

> "the only difference between what Alternative did and what Wellness did (since
> Alternative acted only through Wellness) is that Alternative had title to the
> marijuana and Wellness did not. Wellness employees were directly involved in
> the provision of medical marijuana ... We do not read the term 'trafficking' to
> require Wellness to have had title to the marijuana its employees were
> purchasing and selling."

And on the double tax that resulted:

> "These tax consequences are a direct result of the organizational structure
> petitioners employed, and petitioners have identified no legal basis for
> remedy."

The structure produced a result WORSE than no structure: income to the service
entity, deductions disallowed at both, flow-through income to the shareholders
with nothing to offset it. `Loughman v. Commissioner`, T.C. Memo 2018-85, is the
same trap in miniature.

**The hinge, measured from the opinion's own text rather than assumed.** The
holding turns on the fact that *Wellness employees bought and sold the
marijuana*; that "was Wellness' primary business." Two findings follow:

- **A management/staffing/payroll entity for the store is the losing pattern.**
  Title is irrelevant. Do not build one.
- **Wellness was the tenant: the opinion lists rent among the expenses Wellness
  PAID.** No lessor was before the court, so the case decides nothing about a
  commonly-owned landlord. It is authority against a management company, not
  against Michael's landholding entity. Stated as a limit, not as a blessing --
  no case found holds a cannabis landlord is trafficking, and none holds it is
  safe either.

**Why Michael's sentence is the exposure.** Whether entities are one trade or
business or several is factual, and separate entities still collapse into one
where they form a "unified business enterprise" with a single profit motive
(`Alternative Health Care`, 151 T.C. at 239) or "share a close and inseparable
organizational and economic relationship" (`Olive v. Commissioner`, 139 T.C. 19,
41 (2012), aff'd 792 F.3d 1146 (9th Cir. 2015)). One express factor is "the
business purpose which is (or might be) served by carrying on the various
undertakings separately or together." **A tax purpose is not a business purpose.**
`CHAMP`, 128 T.C. 173 (2007) won on separate people, separate space, separate
records -- 7 employees on marijuana against 18 on caregiving. `Olive`,
`Canna Care` and `Patients Mutual` lost on shared staff, shared fees, and a
percentage nobody could compute.

**How it stayed hidden.** The structure is real and correctly modeled: migration
0172 seeds four entities with tax forms and NAICS codes, and `coa-core.ts`
already encodes that only `greenway` is exposed to 280E. Correct modeling of a
structure is not validation of the structure. The schema can only record the
position; it cannot check whether the position survives audit. Nothing in the
census asks "is this dimension defensible," so nothing failed.

**Measured evidence already in his books that argues the wrong way.** From
`scripts/recon/sage-suffix-check.py` over the real chart (288 accounts) and 550
expense rows ($368,276.34):

- **121 rows, $61,109.02** of LYMAN-suffixed expenses paid out of GREENWAY cash
  (`81002-LYMAN` MAINENANCE $40,206.79; `81001-LYMAN` UTILITIES $10,743.08;
  `81003-LYMAN` PROPERTY TAX $10,159.15). Commingled cash is the strongest
  available evidence of a single unified enterprise.
- Rent IS booked both ways (`70000-GRNWY` expense against `52000-LYMAN` income),
  which is the right instinct and should be kept -- but the rate has no
  documented market basis on file, and Sec. 482 plus Reg. 1.6662-6(d)(2) both
  want that basis to exist BEFORE the return is filed.

**Washington cuts the other way, and that is load-bearing.** WAC 314-55-035(4)(a)
excludes from "true party of interest" a person "receiving payment for rent on a
fixed basis under a lease or rental agreement," then adds that where there IS
common ownership between licensee and property owner, "the board may investigate
all funds associated with the landlord," and may also investigate "where a rental
payment has been waived or deferred." So Michael's landlord arrangement is
expressly contemplated and permitted -- conditioned on a written lease, a fixed
basis, and rent actually paid. Meanwhile (4)(f) would TOLERATE a staffing company
that federal tax law punishes. Both regimes must be satisfied; the safe
intersection is no staffing entity, and a documented fixed lease that is never
waived.

**Consequence for D-41, recorded honestly rather than left standing.** The
books-73 recommendation (`36000` intercompany, not `41100` capital contribution)
STANDS and is strengthened -- but it gains a second half. An intercompany balance
is only meaningful if the entities are genuinely separate, and the `36000` balance
is therefore a measuring instrument as well as an account: a due-from that cycles
looks like two businesses; a due-from that only ratchets upward looks like one
wallet with two labels, and is the first exhibit in a unified-enterprise
argument. So: book it to `36000`, **and settle it.** If it cannot be settled
because the receiving entity has no cash of its own, that is the finding, and the
answer was `41100` or a distribution all along. The question put to Michael in
books-73 is unchanged but now matters more, because its answer is also the answer
to whether the entities are separate.

**Gate.** No code gate is possible here and claiming one would be decoration: this
is a question of fact about conduct, not a computable property. What IS gated is
the consequence -- the census row for `intercompany.transfer_pair` stays
`correct: UNKNOWN`, `submitIntercompanyPair` still has no caller, and the
forthcoming expense classifier (D-56) must REFUSE rather than guess an entity or
a cost class. The research itself is recorded in
`docs/ENTITY-STRUCTURE-AND-280E.md` so it is cited by number hereafter and not
retold (rule 131).

**Not done, deliberately.** No restructuring is recommended and none should be
undertaken on my say-so: I am not Michael's attorney, and under WAC
314-55-035(5)(b) and WAC 314-55-120 an ownership change requires LCB approval
before it happens. The structural questions go to cannabis-experienced tax
counsel with this document attached.

**Census rows:** `intercompany.transfer_pair` (unchanged, still UNKNOWN).

---

## D-56 - Nothing turns a real transaction into (account, entity, cost class)

**Found:** books-74, while choosing the next slice. This is the measured gap, and
it is recorded before any code is written so the slice can be judged against it.

**What is missing.** Four things exist and one does not:

- The **entity dimension exists and is right.** `gl_entities` (0172) seeds exactly
  `greenway` / `atm` / `landholding` / `personal` with tax form and NAICS each.
- The **280E classification exists in the schema.**
  `gl_accounts.default_cost_class` and `gl_account_rules.cost_class` both carry
  `cogs_direct | cogs_allocable | nondeductible_280e | separate_business |
  personal | none`; `coa-core.ts#defaultCostClass` encodes that only `greenway`
  is 280E-exposed.
- The **costing engine exists**: `cogs-position-core.ts`, 1,260 lines,
  `determineTaxpayerRole` / `validateCogsInput` / `computeForm1125A` /
  `comparePositions` / `adviseOnMethodChange`. **Zero importers** (census already
  records this).
- The **raw material exists and is measured**: 550 rows, $368,276.34, five real
  exports, 18 G/L accounts, paid from `10005-GRNWY` (349 rows) and `37009-GRNWY`
  (201 rows), with "G/L accounts used but NOT in the chart: 0".
- **The classifier in the middle does not exist.** `gl_account_rules` has a unique
  index and a control-account guard trigger and **no TypeScript reads or writes
  it**; `atm-classification-core.ts` documents it in comments and deliberately
  does not use it.

**How it hid.** Each individual piece is present and demonstrably good, so every
inspection of any one piece passes. The gap is between the pieces. This is the
same shape as D-37 (the bank feed displays but cannot post) and D-38 (the payroll
journal builds but nothing calls it): display and posting are different problems,
and a chain is measured at its missing link, not at its strongest one.

**Why it is the right next slice.** It is the single surface blocking D-30, D-37
and D-47 simultaneously; it can be proved against Michael's real measured rows
rather than fixtures; it posts nothing, so it cannot corrupt anything (the same
safety property that made the bank feed the safest thing to wire first); and it
is where the Sec. 280E conclusions in `docs/ENTITY-STRUCTURE-AND-280E.md` become
mechanical instead of advisory. It is also the expense side, not the inventory
cut-over, which Michael has deferred ("we are not ready to migrate inventory over
yet").

**What the slice must do, and the two rules that shape it.**

1. Normalize merchant text the way `match_value` requires (upper-cased,
   punctuation stripped) so "Office Depot", "OFFICE DEPOT #1234" and
   "office  depot" are ONE rule.
2. Match on the ladder the schema already defines (`merchant_exact` before
   `merchant_contains`), lowest `priority` wins, **with first-key determinism
   pinned by test** -- the exact weakness that produced survivor M15b in the
   books-73 campaign.
3. Assign the ENTITY. Kitsap County Treasury property tax on Geiger Rd is the
   landlord's cost whichever card paid it. This is where separateness stops being
   advice (D-55) and becomes code.
4. Assign the COST CLASS conservatively by law: for `greenway`, a reseller's
   operating expense is `nondeductible_280e`, and the module must **REFUSE to put
   store labor, rent or security into `cogs_direct`** -- Reg. 1.471-3(b) does not
   allow it and `Richmond Patients Group`, T.C. Memo 2020-52, closed the
   trimming-and-packaging route. A wrong `cogs_direct` is the row that loses an
   audit; a refusal is worth more than a guess.
5. Refuse with reachable codes (rule 48: a check that cannot classify must fail,
   never skip). Any code the shipped rule set cannot reach gets a parameterized
   door -- `classifyIn(rules, line)` -- so tests can reach it, exactly as
   `resolveLedgerCategoryIn` does for D-52. Rule 43: an unreachable refusal code
   is decoration.

**Gate (to be built with the slice).** Pure-leaf self-test plus a second
independent test file; the census row must move from absent to
`exists: YES / reachable: NO` and say so honestly until a caller exists.

**Explicitly out of scope.** It will not post, will not write
`gl_account_rules`, and will not touch the `41000` WITHDRAWALS question
($141,904.95 across 87 rows) -- that needs the CPA and the K-1 work that is
deliberately on the back burner.

---

## D-57 -- the ATM account is a CUSTODY account, and booking it as revenue would overstate the ATM's income by 33.4x

**Status: MEASURED. The accounting position is now decided; the posting code is not written yet.**

**How this came up.** Michael, books-75, describing account 6228 in his own
words: *"The atm has its own bank account, it's 6228. Its only purpose is to
accept deposits from the atm. Right now I just transfer the deposited money from
6228 to 6048, because vendors and payroll are paid through that account. Cash
generated by the sales of cannabis go back into the physical atm. So I suppose
what we could say is the money is simply in the atm businesses custody."*

He is right, and the word he reached for -- **custody** -- is the correct
accounting word. This record exists because the naive reading of a bank statement
gets it exactly backwards, and the size of the error is large.

**What was measured.** `scripts/recon/atm-custody-measure.py` over five real
exports (two ATM processor reports, one cash-load report, the 6228 bank
statement, and the daily settlement file). 234 funds-movement rows, 0
unparseable:

| Flow | Amount | Rows | What it actually is |
| --- | --- | --- | --- |
| Transaction / settlement | **$526,620.00** | 118 | Cardholder withdrawals. Reimbursement of vault cash. **NOT revenue.** |
| Surcharge | **$16,272.50** | 116 | The $3.00-per-withdrawal fee. **This, and only this, is the ATM's revenue.** |
| Cash loaded into the machine | **$535,180.00** | 133 | Greenway's cannabis cash, terminal HG26499 |
| Sweeps 6228 -> 6048 | **$526,937.58** | 66 | The cross-entity move Michael describes |

Independently cross-checked against the Daily Settlement file (a second source):
115 rows, Surcharge $16,267.50, Settlement $526,520.00. The variance of $5.00 and
$100.00 was **not** waved off as rounding -- it was drilled into and fully
explained by explicit adjustment rows present in the detail file and netted in
the summary (6/27/26 Transaction -$100.00; 7/2/26 Transaction +$100.00 and
Surcharge +$5.00; 7/9/26 Transaction +$100.00). Not a defect.

**The three findings.**

1. **Surcharge is 3.00% of what lands in 6228.** Treating the whole of 6228 as
   ATM revenue would state income of $542,892.50 where the true figure is
   $16,272.50 -- a **33.4x overstatement**. It would also manufacture a large
   phantom profit in the entity whose separateness is the point of the structure
   (D-55), which is the opposite of helpful.
2. **The settlement money is Greenway's own vault cash coming back.** Michael
   loads $535,180.00 of cannabis cash into the machine; cardholders draw it out;
   the processor reimburses it. It is a clearing/custody balance, not income and
   not equity. This is what `10900 Cash -- Clearing / In Transit` is for.
3. **The sweeps are a third, separate flow.** 99.0% of deposits are swept to
   6048. Per D-41, Michael has now confirmed this is **not expected to be
   repaid**.

**THE TRAP THIS RECORD EXISTS TO PREVENT.** All three flows pass through one bank
account and are close in size ($526,620.00 settlement, $526,937.58 swept). It is
therefore tempting to net them, and a netted set of books would still BALANCE --
which is precisely why the error would survive review. They are three different
things and must be posted as three:

- reimbursement of vault cash -> a **custody/clearing** balance (`10900`), not income;
- the $3.00 fee -> **`51000` ATM Surcharge Income**, the ATM's own separate-business revenue;
- the sweep -> the **cross-entity** flow, whose character is the open half of D-41.

**Michael's forward-looking change, recorded so it is not lost.** *"I usually
transfer the fees to the cannabis account too, but going forward we can leave the
atm fees in the atm account because that revenue belongs to the atm."* This is
the right instinct and it directly strengthens the separateness argument in D-55:
revenue that belongs to the ATM should stay in the ATM's account. Also recorded:
*"soon I will switch to paying employees and vendors out of the atm account. It
is too expensive to open a dedicated ach payments account."* When that happens,
6228 becomes a **mixed** account and the custody split above stops being merely
correct and becomes load-bearing, because the ATM's cash and Greenway's payroll
cash will be in one place.

**Not yet done.** No posting code. The custody split is measured and named here;
wiring it is a later slice.

---

## D-58 -- two refusal codes in the new classifier could never fire, and an articulate comment explaining why is still decoration

**Status: FIXED in books-75. Both codes now emitted; mutation-verified.**

**What happened.** The first draft of
`src/lib/accounting/expense-classification-core.ts` declared eight refusal codes.
Its own self-test, on first run, proved that **two of them were unreachable by
any input**:

1. **`ENTITY_NOT_PERMITTED`.** `ACCOUNT_ENTITY_RESTRICTIONS` had been populated
   with `51000` and `52000` -- both **income** accounts. Neither is in
   `CLASSIFIABLE_ACCOUNTS`, so the chart-membership check always answered first
   and returned `ACCOUNT_NOT_IN_CHART`. Measuring migration 0173 (rather than
   recalling it) showed the only entity-restricted **expense** accounts are the
   `79xxx` personal block. Fixed by restating those 14 accounts and by moving the
   entity check **before** the membership check -- specific before general. The
   ordering matters for a human reason: "account 79030 belongs to the personal
   books" tells Michael what he did wrong, whereas "79030 is not in the chart" is
   actively misleading, because the account plainly IS in the chart.

2. **`RESELLER_COGS_FORBIDDEN`** -- the code that carries the whole 280E position
   from D-55, and the one that matters most in an audit. `ExpenseRule` had no
   `costClass` field, so the class was always derived from the entity, and
   `expenseCostClassFor("greenway")` can only ever return `nondeductible_280e`.
   The branch was dead by construction. But `gl_account_rules.cost_class` in
   migration 0173 is a **stored** column (`not null default 'none'` with a
   six-value CHECK), so a hand-written or imported rule row genuinely can carry
   `cogs_direct` against store rent. The TypeScript type was **narrower than the
   database**, which is what made the dangerous input unrepresentable. Fixed by
   giving `ExpenseRule` the optional `costClass` the schema actually stores and
   honouring it before validating it.

**The part worth keeping.** The draft did not hide the second problem. It asserted
`produced.length === 7` and carried a paragraph explaining that the eighth code
was "structurally unreachable defence-in-depth" for the SQL layer. Every word of
that was true, and it was still decoration under standing rule 43. **A refusal
code that no code path emits is not protection, it is decoration -- and an
accurate explanation of why it cannot fire does not convert it into protection.**
The fix was to make the dangerous input representable, not to document its
absence. The self-test now asserts all **eight** codes fire and walks
`ALL_EXPENSE_REFUSAL_CODES` mechanically, so a ninth code added without a path
fails immediately.

**Why the parameterized door earned its keep.** Both defects were caught only
because the real logic lives in `classifyIn(rules, line)` with the rule set as a
parameter (the D-52 pattern). Had the module tested only the shipped rule set,
both codes would have looked fine forever, because the shipped set provokes
neither.

**Mutation verification (6 mutants, 6 caught).** Deliberately small -- Michael
asked to stay on budget.

| Mutant | Result |
| --- | --- |
| Account code renumbered off the migration | CAUGHT |
| Control account dropped from the restated list | CAUGHT |
| Entity restriction silently widened | CAUGHT |
| Entity check moved back after chart membership | CAUGHT |
| Stored cost class ignored (reseller bar goes decorative) | CAUGHT |
| `<` -> `<=` in the priority scan | **SURVIVED, then fixed** |

**The survivor, and why it was not dismissed.** Changing `<` to `<=` in the
winner scan passed all 48 tests. It was tempting to call it an equivalent mutant,
since two same-priority rules aiming at the same account and entity do not trip
`RULE_TIE` and the accounting answer is identical either way. A probe proved it
is **not** equivalent: array order silently flips `matchedValue` and `matchKind`
-- the record of **which rule fired**. That is provenance, and provenance is not
cosmetic. It is what tells Michael why a line landed where it did, and it is what
`gl_account_rules.times_applied` and `last_applied_at` count in SQL; if it
flipped with array order, two runs over the same data would disagree about which
rules are earning their keep and a dead rule could look busy. First-match-wins is
now pinned by test, and the mutant is caught. Same family as books-73 survivor
M15b.

**One further honesty note.** Two `AMBIGUOUS_VENDORS` explanations were
cross-references -- "Same split as Office Depot" and "Filing fees vs licences and
permits" (27 and 38 characters). Since each `why` is what Michael reads when the
classifier refuses his line, a test requires every explanation to stand on its
own. Both were rewritten rather than the threshold lowered.

## D-59 -- the loan engine cannot represent the loan Michael just described, and answers anyway

**Found:** books-76, by probing the shipped engine with Michael's own terms before
writing anything new.

**Michael's decision, verbatim:** "I want to classify the cash in the atm as a
loan. It doesn't need to be interest bearing or have a term limit."

Both halves of that sentence are unrepresentable in `src/lib/loans/loan-core.ts`,
and the failure is silent rather than loud.

**The probe.** `buildAmortizationSchedule` was called with exactly his terms --
`kind: "interest_free"`, `rateMilliPct: 0`, `termMonths: 0`, principal set to the
$526,937.58 of sweeps that D-57 measured:

| Input | Rows returned | Total interest |
| --- | --- | --- |
| `termMonths: 0` (his loan) | **0** | **0** |
| `termMonths: 12` (invented) | 12 | 0 |

Zero rows is not an error. It is a clean, confident, empty schedule. Nothing in
the return value distinguishes "this loan has no payments" from "this engine
cannot describe this loan", and a caller cannot tell the difference either.

**Three separate defects sit behind that empty answer.**

1. **`kind: "interest_free"` treats zero interest as a property of the loan.**
   The schedule builder hard-zeroes `monthlyRate` whenever the kind is
   `interest_free`. But "interest free" is not a property of the loan -- it is a
   description of what the lender chose to charge, and for a loan between
   commonly controlled entities the tax law substitutes a different rate. There
   is no field in `LoanInput` that could hold an imputed rate distinct from a
   charged rate, so the model cannot express the situation at all.

2. **A demand loan has no representation.** `termMonths` is a required integer
   and the schedule is generated by stepping months from `firstPaymentDate`. A
   loan with no term is not `termMonths: 0`; it is a loan whose balance is
   outstanding until demand is made. Storing 0 makes it look like a settled loan.

3. **The rate it would need is deliberately absent.** `FEDERAL_SHORT_TERM_RATES`
   in `interest-rates-evidenced.ts` is an **empty array on purpose** -- the AFR is
   set quarterly by the Secretary and published in a revenue ruling, so it is a
   document to be looked up and not a number to be reasoned toward. That is the
   correct state and it is not the defect. The defect is that nothing connects
   the empty rate table to the loan engine, so the loan engine does not know it
   is missing anything.

**Why this matters more than it looks.** Under `26 C.F.R. Sec. 1.482-2(a)(2)(iii)(B)(2)`,
where no interest is charged on a loan between controlled entities, an arm's
length rate "shall be equal to the lower limit, compounded semiannually" -- 100%
of the applicable Federal rate. The IRS does not have to argue for a better
number; the regulation supplies it. And because the loan has no term,
`(a)(2)(iii)(C)` makes it a **demand loan**, taking the Federal short-term rate
"in effect for each day on which any amount of such loan or advance (including
unpaid accrued interest ...) is outstanding" -- a daily series over a rate that
moves quarterly, with unpaid interest compounding into principal.

**The asymmetry, which is the part that costs money.** The imputation is not a
wash between the two entities. Interest INCOME lands in the ATM entity, which is
not a cannabis business, so it is taxable and is B&O revenue at the .015000
service rate. The matching interest EXPENSE lands in Greenway, which is a
cannabis business, where Sec. 280E disallows it. Income on one side, dead deduction
on the other.

**What books-76 did about it, and what it deliberately did not.** It did not
patch `loan-core.ts` to accept `termMonths: null`, because a schedule builder
that returns rows for a demand loan would be inventing the payment dates.
Instead `related-party-loan-core.ts#imputedInterestRequirement` computes the
**requirement** and refuses with a named code when an input is absent. Its
refusal for Michael's loan today is `BONA_FIDE_UNDETERMINED`, not
`AFR_NOT_LOADED` -- the ordering is deliberate, because there is no point pricing
a loan before establishing that it is one. All five refusal codes are proven
reachable, per standing rule 43.

**Still open.** `loan-core.ts` itself is unchanged and still returns an empty
schedule for a zero-term loan. Fixing it properly means adding a demand-loan
representation and a charged-rate/imputed-rate distinction to `manual_loans`,
which is a migration and belongs in its own slice. Recorded here so it is not
rediscovered.

---

## D-60 -- calling it a loan is the cheap half; the expensive half is that the label can be taken away

**Found:** books-76, reading `26 C.F.R. Sec. 1.482-2(a)(1)(ii)(B)` before building on
Michael's decision.

**The trap.** D-41 asked whether the intercompany money is a loan (36000) or a
capital contribution (41100), and said in as many words that it "closes when
Michael confirms whether the money is expected to be repaid." He has confirmed:
loan. The natural next step is to book it to 36000 and consider the question
answered. That step is where the trap is.

`Sec. 1.482-2(a)(1)(ii)(B)`, verbatim: this paragraph "does not apply to so much of
an alleged indebtedness which is not in fact a bona fide indebtedness, **even if
the stated rate of interest thereon would be within the safe haven rates**", and
payments on alleged indebtedness "shall be treated according to their substance."
The regulation then names the two substitutes it has in mind, and they are
exactly Michael's two exposures: a **contribution to the capital of a
corporation**, or a **distribution by a corporation with respect to its shares**.

So the label is not self-executing. A perfect contract at a perfect AFR rate does
not win by itself -- the safe haven is expressly unavailable to a loan that is
not bona fide.

**The evidence as it stands today, measured not assumed.** Michael's own
description of the practice, from books-75, verbatim: "When one account needs
cash, I move it there. If the other needs cash, I move it back." Sorted honestly
against the factors:

| Fact | State | Effect |
| --- | --- | --- |
| Written instrument | **No** -- "I suppose I could create a contract" is an intention | Not fatal: `(a)(1)(ii)(A)` covers advances "whether or not evidenced by a written instrument" |
| Stated interest rate | **No** -- his words | Triggers `(a)(1)(i)` and forces the AFR imputation |
| Maturity date | **No** -- his words | Makes it a demand loan under `(a)(2)(iii)(C)` |
| Repayment schedule | **No** | Against |
| Repayments actually made | **Yes** -- cash does go back | **For, and this is the strongest fact he has** |
| Balance cycles both ways | **Yes** -- his description | **For** |
| Balance tracked anywhere | **Not asked** | Open |
| Demand ever made | **Not asked** | Open |

Two facts are recorded as `null`, not `false`, and the distinction is the point:
nobody has asked him. books-73 measured that his 288 Sage accounts contain no
due-to/due-from account at all, which suggests the balance is not tracked -- but
"suggests" is a guess, and standing rule 1 forbids recording a guess as an answer.

**Therefore `assessBonaFide` returns UNDETERMINED, and that is the correct
output.** A system that returned BONA_FIDE here would be telling Michael he is
safe on the strength of questions nobody put to him. The two open facts are
listed in the verdict so they can be closed by asking rather than by assuming.

**The one that helps him.** The balance CYCLES. books-74 established that 36000 is
not merely storage but a **measuring instrument**: a due-from that moves both ways
evidences two businesses dealing with each other, while one that only ratchets
upward evidences a single unified enterprise -- the exhibit against him under
*Alternative Health Care Advocates*, 151 T.C. No. 13 (2018). His practice already
cycles. That is a genuine asset and the books should be capable of proving it,
which is why `applyRepaymentsFifo` returns `balanceReachedZero` as a measured
output rather than leaving it as a claim.

**What the contract has to contain.** `CONTRACT_REQUIREMENTS` lists five items in
value order. The second is worth more than the other four combined: state the
rate as a **formula** -- "the applicable Federal short-term rate, compounded
semiannually" -- rather than a number. A formula stays inside the 100%-130% safe
haven of `(a)(2)(iii)(B)(1)` automatically as the AFR moves, with no amendment.
A fixed number goes stale and drops out of the safe haven the first time rates
rise, which is precisely the case mutation M3 exposed in the test suite.

**Which account, and why it was not a preference.** 34000 Notes & Loans Payable is
a CONTROL account whose own chart comment (migration 0173, verbatim) is 'CONTROL,
driven by the loan subledger and its amortization schedule.' Michael's loan has no
term, therefore no amortization schedule, therefore the subledger that drives
34000 cannot be built for it -- routing there would require inventing a term.
36000 holds an intercompany balance without one. `loanControlAccountFor` returns
34000 the moment a term AND a schedule both exist, so the decision is a function
of the facts rather than a constant someone would have to remember to change.

### books-77 update -- the two open questions were answered, and the answer is bad

Michael was asked the two facts the verdict was waiting on, and he answered both
against his own interest, unprompted:

> "The outstanding inter company balance is not tracked anywhere. I never thought
> to track it before. We will now."

> "Demand has never been made. It's just me moving my money around as I please
> with out structure."

`MICHAELS_ATM_LOAN_AS_STATED` now records `balanceIsTracked: false` and
`demandEverMade: false`. **Measured, not predicted:** `assessBonaFide` moved from
`UNDETERMINED` to **`NOT_BONA_FIDE`**, with `substanceIfNotDebt` of
**`distribution`** for money moving OUT and `contribution_to_capital` for money
moving IN. `imputedInterestRequirement` correspondingly moved from the refusal
code `BONA_FIDE_UNDETERMINED` to `NOT_BONA_FIDE_INDEBTEDNESS`.

Nothing in the gate or the regulation changed. Only the evidence did. The gate
requires `hasActualRepayments && balanceIsTracked`, and an untracked balance is
fatal to it for a reason that survives restatement: if no one knows the amount,
there is no sum that could be demanded, and a debt nobody can quantify or enforce
is not a debt. Sec. 1.482-2(a)(1)(ii)(B) is explicit that the safe haven cannot
rescue this -- the regime applies only to bona fide indebtedness "even if the
stated rate of interest thereon would be within the safe haven rates", and
payments are "treated according to their substance".

**This is the system working, not the system failing.** Michael's stated purpose
for it is "forcing me to behave properly bookkeeping wise so I can have
defensible evidence our system follows the law." A tool that returned a
comfortable answer to those two admissions would be useless for that purpose. The
verdict is also not permanent: it is a function of facts, and he has already
begun changing them ("We will now"). Tracking the balance plus executing the
contract in `CONTRACT_REQUIREMENTS` moves `balanceIsTracked` to true and the
verdict with it.

**Reachability preserved deliberately.** `BONA_FIDE_UNDETERMINED` lost its only
emitter when his facts resolved, and the rule 43 sweep in the self-tests caught
that immediately. The fix was to keep an explicitly unanswered fact set alive in
the tests, never to weaken the sweep -- an unreachable refusal code is
decoration, and the branch must stay live for the next loan.

---

## D-61 -- the receipt and the vendor bill both want to debit inventory for the same goods

**Found:** books-78, while writing `receipt-journal-core.ts`. Found by executing
`buildBillJournal` and reading its output, NOT by reading its documentation --
which matters, because the first draft of the receipt module's own header
asserted the opposite and was wrong.

**What broke:** two builders capitalise the same delivery.

`buildBillJournal` was run against a one-line cannabis-product bill. Measured
output:

    accountCode "20010"  amountCents  15000    <- category inventory, DEBIT
    accountCode "30000"  amountCents -15000    <- accounts payable,   CREDIT

So the bill debits the CATEGORY INVENTORY account directly. It never touches
`20800 Inventory - In Transit`: `grep -c 20800 src/lib/accounting/vendor-bill-core.ts`
returns 1, and that lone hit is a seeded-account list inside a self-test, not a
posting path.

`buildReceiptJournal` also debits the category inventory account -- because that
is what receiving goods correctly does. If both entries ever post for one
delivery, inventory is carried at twice its cost and, when the goods sell, so is
COGS. Under 280E that is the single most dangerous direction an error can run:
COGS is the only deduction this business gets, so an overstatement is the number
an examiner tests hardest, and it would be defended by two internally consistent
journals that each look correct in isolation.

**Why it is not fixed in this slice.** The honest end state is that the receipt
debits inventory and credits 20800, and the bill then DEBITS 20800 instead of
inventory, so 20800 nets to zero for anything both received and invoiced and a
residual balance is precisely the list of shipments missing one half. That
requires changing `buildBillJournal`, which is shipped, heavily tested, and
depended upon by migration 0187's `gl_post_vendor_bill`. Rewriting it as an
unannounced side effect of adding a receipt is exactly the kind of silent change
these rules exist to prevent, and the count of affected tests has not been
measured. It is named here so the next slice starts from a written finding
rather than rediscovering it.

**Nothing is double counted today**, and that is a fact about wiring, not about
correctness: neither builder is reachable. The census records `reachable:
MISSING` for `vendor_cycle.vendor_bill_recorded` and for the new receipt row.
This is a LATENT trap that springs on whoever wires the second door.

**How it hid:** each module is correct on its own, and both have passing pure
self-tests. Purity is the absence of the other module, so no pure test can see
the collision -- the same archetype as D-34, one level up. It also hid behind
plausible prose: the receipt module's first header stated as fact that the bill
debits 20800, which is what a well-designed system WOULD do and what this one
does not do. Rule 1 says never guess; a confident sentence about another
module's behaviour is a guess unless that module was run.

**Gate:** `tests/compliance/receipt-journal-core.test.ts` executes the REAL
`buildBillJournal` and the REAL `buildReceiptJournal` for the same goods, asserts
that they currently collide on the category account, and asserts that they are
not both reachable. When someone fixes the bill to relieve 20800, the collision
assertion fails and forces this defect to be closed deliberately rather than
forgotten. A test that merely asserted today's behaviour would rot into
protecting the bug; this one is written to fail on the FIX and on the DANGER
both, so neither can pass silently.

### books-79 -- FIXED ON THE EXPLICIT PATH, still reachable by omission

`VendorBillInput` gained `goodsAlreadyReceived?: boolean`. When it is true, a
cannabis-product line debits `20800` instead of the category account, so:

    GOODS ARRIVE     debit 2xxxx category   credit 20800
    INVOICE ARRIVES  debit 20800            credit 30000

Measured by adding the two real journals together for one $150.00 delivery:

    goodsAlreadyReceived = false ->  20010: 30000   20800: -15000   30000: -15000
    goodsAlreadyReceived = true  ->  20010: 15000   20800:      0   30000: -15000

The second line is the fix: inventory capitalised ONCE and the clearing account
netting to exactly zero. All 42 combinations (21 categories x received/not) were
run through the real `ledger-core#validateJournalDraft` with zero issues.

**Scope, deliberately narrow.** Only `isCannabisProduct` lines move. The other
three `treatment: 'inventory'` kinds are `freight_in` and `product_packaging`
(60800) and `purchase_discount` (60900) -- costs known WITH THE INVOICE, not
with the truck, which `receipt-journal-core` deliberately never books. Redirecting
them would credit a clearing account nothing ever debited and leave a permanent
phantom balance in 20800. Mutation N1 tries exactly that and is caught.

**Why a new flag instead of reusing `fromAcceptedManifest`.** They look
interchangeable and are not. Migration 0059 lists the manifest statuses as
`pending | in_transit | received | accepted | rejected | partially_accepted`, so
"accepted" is a COMPLIANCE state -- it does not prove an accounting entry exists.
Deriving one from the other would mean accepting a manifest silently changed
which account a bill debits, which is the same invisible coupling that produced
this defect. Mutation N4 makes that substitution and is caught.

**STILL OPEN, and this is the honest part.** The flag defaults to `false`, which
reproduces the old behaviour exactly. That default is the safe direction if a
caller forgets -- stranding nothing beats stranding cost in a clearing account
forever -- but it means the double count remains reachable BY OMISSION. The
defect is fixable, not automatically fixed. It closes fully when the receiving
screen is wired and passes the flag, at which point the wiring itself must be
tested. Two tests hold the line: one asserts the danger still exists on the
default path, one asserts the cure works on the explicit path.

Mutation campaign on the new logic: 7 deliberate defects, 7 caught, 0 survivors.

---
## D-62 -- the factory reset was 68 migrations stale and left the entire ledger on the books

**Found:** books-80, answering the owner's question "Is there a factory reset
option we can use before we go live so I can have a clean completely empty
database to work with? I don't want to have a bunch of stuff stuck on the books
from all of my testing."

**Severity: HIGH.** Silent. Nothing crashes; the owner simply opens for business
on November 1st with rehearsal numbers in his trial balance and does not find out
until a CPA asks why the books disagree with reality.

A reset already existed -- `reset_operational_data()`, migration 0069, guarded in
0097, extended in 0140 -- so the tempting answer was "yes, already built." That
answer was wrong. Measured, not assumed:

* Migrations on disk run 0001..0208. The reset was last extended at **0140**:
  sixty-eight migrations stale.
* Those migrations create **250** tables. The old reset deleted from **66**.
* Of the **184** it never touched, the worst were the general ledger --
  `gl_journals`, `gl_journal_lines`, `gl_periods`, `gl_audit_events`,
  `gl_opening_balances`, `gl_bank_matches`, `gl_bank_reconciliations` -- because
  the ledger was born at migration **0172**, thirty-two migrations AFTER the reset
  was last taught anything. Also `payroll_ytd_accumulators` and
  `sick_leave_ledger`, either of which would corrupt the first real W-2.

So pressing "Reset operational data" would have deleted the test SALES and kept
every test JOURNAL ENTRY -- the exact opposite of what the button promises.

**The root cause is the shape of the fix, not the missing names.** 0140's own
header says it exists because "0069 was written before many newer operational
tables existed," and it fixed that by typing more table names. Then 68 more
migrations landed and it rotted identically. A hand-typed list is not a fix; it
is the same bug on a delay.

**Closed by** `src/lib/accounting/factory-reset-core.ts`, which classifies every
one of the 250 tables WIPE or KEEP and REFUSES on anything unclassified (rule 48
-- no default disposition exists, because guessing WIPE destroys records WAC
314-55-087 requires and guessing KEEP is this defect), plus migration 0209
`gl_factory_reset(...)`. Two tests read the real migrations off disk: one fails
when a table exists that nobody classified, one fails when 0209 does not delete
something the core says to delete. The staleness is now a red build, not a wrong
number on a tax return.

**Found during the fix, by the guard catching its author.** My first table
extraction used a grep that did not strip SQL comments, and
`0175_gl_trial_balance.sql:425` mentions `create table secret_ledger(...)` inside
a comment describing a manual penetration test. I wrote a rule for that phantom
table. `RULE_FOR_MISSING_TABLE` refused on the first real run. Had the refusal
been softer, a non-existent table would have reached a production DELETE and
aborted the whole reset transaction. The rule was deleted; the refusal was not
weakened. Family prefix rules also over-swept thirteen structural `gl_` tables
(the chart of accounts, entities, the shareholder register, the cut-over config)
on their first run; each was opened, read, and carved out with a specific rule.

Mutation campaign: 19 deliberate defects, 19 caught, 0 survivors -- after three
survivors on the first pass exposed that the SQL tests asserted only that a
phrase appeared in the file, so replacing `if not public.is_owner() then` with
`if false then` left the error message in place and the test still passed. Those
tests now assert the CONDITION, not the message.

---

## D-63 -- the retention guard cited three years; the rule has said five since October 2024

**Found:** books-80, reading `0097_reset_retention_guard.sql` while fixing D-62.

Migrations 0097 and 0140 both refuse a wipe with: "Licensees must retain
sales/inventory/transport records for 3 years."

WAC 314-55-087(1), as amended by **WSR 24-19-040** (filed 9/11/2024, effective
**10/12/2024**), requires records to be kept on the licensed premises for a
**five-year period**. The repo already knew: `docs/COMPLIANCE_BIBLE.md` §3.6 and
`docs/INVENTORY_COMPLIANCE_WA.md` §2 both record the current text from a verified
scrape, and the Bible states plainly that "anything in this repo still saying
three years is stale." `src/lib/admin/reset-service.ts` already said FIVE. Only
the SQL the owner actually reads at the moment of destruction said three.

**Why it matters here specifically.** This string is not documentation -- it is
the sentence shown to the owner in the instant he decides whether to destroy
records. Telling him three years understates how long the state can ask for them,
and record-keeping violations are Category IV (WAC 314-55-523).

**Closed** in migration 0209 and `factory-reset-core.ts`, which state five years,
cite `WAC 314-55-087(1)` with the amending WSR, and are held by tests that read
0097 (still three), the Bible (five), and 0209 (must be five, and must not
reintroduce three). Note the repo's separate OWN policy is to retain at least six
years as a margin of safety -- that is policy, not the requirement, and is not
what the refusal message cites.

Mutation M4 reverts the constant to 3 and is caught.

---

## D-64 -- the category that decides the account is free text, and the only existing mapper guesses

Found: books-81, while wiring the receiving path.

`inventory_lots.category` is a free-text column (migration 0024_pos_coa_potency.sql:28).
Nothing in the codebase mapped it to the accounting vocabulary. The one mapper that
exists, `src/lib/pos/transform.ts#categoryWithFallback`, ends with `return "concentrate"`
for anything it does not recognise.

Why that cannot be reused for the books. `coa-core.ts` gives all 21 categories distinct
slots, so each resolves to its own inventory account (20010..20220). Three of them --
`accessories`, `paraphernalia`, `merch` -- are `isCannabis: false`. A silent fallback to
`concentrate` therefore moves a 280E-exempt purchase into a cannabis inventory account and
changes the tax owed. The same fallback collapses RSO into concentrate, Tincture into
edible-liquid, Blunt into preroll and Infused Blunt into infused-preroll, which would leave
accounts 20150, 20180, 20070 and 20100 permanently dark -- balances that can never be
reconciled because nothing can ever land in them.

Response: `src/lib/accounting/receipt-category-core.ts` maps ~110 spellings onto the 21
slugs with NO default branch. Unrecognised input returns `kind: "refused"`, and
`receipt-service.ts` refuses the delivery AS A UNIT rather than post a partly-guessed
journal. Measured: 21 of 21 slugs reachable, no dark accounts.

Still open. Refusing is correct but it is not finished. Receiving will block on any
spelling the table does not carry, and the fix at that moment must be to add the spelling
to the table -- never to add a fallback. The durable repair is a constrained category
column, which is a migration this slice did not take.

Consequence if ignored: someone under time pressure at the loading dock adds
`return "concentrate"` to stop the refusal, and 280E-exempt purchases start silently
capitalising into cannabis inventory.

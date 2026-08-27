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

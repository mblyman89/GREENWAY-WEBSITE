# A report you cannot read is a report that does not exist

**Slice books-27, part two — August 21, 2026**

Michael, you told me what you wanted in one sentence: *"I want the same amount
of power Sage has, but displayed in a way that is significantly easier to read
and understand."*

That sentence set the whole approach. I did not start from a blank page and
design a pretty report. I started from **your** reports — the thirteen Sage
files you sent me — measured exactly what makes them unreadable, and then built
something that answers each defect specifically. Five of them, and each one now
has code that exists solely to fix it.

Here is the short version before the detail.

**I built the engine. Two of my own tests caught two real bugs in it before you
ever saw them, and one of those bugs was the dangerous kind — a control that had
quietly stopped controlling. Both are fixed. And I have one piece of good news
about something you asked for that already exists.**

## The five things wrong with your Sage reports, measured

I want to be precise here, because "the reports are ugly" is an opinion and I do
not build on opinions. These are counts I took off your actual files.

**One. Your Employee Payroll Analysis has thirty-three columns, and the headings
wrap across eight physical lines.** Nobody reads thirty-three columns. What
actually happens — and I suspect this is exactly what happens to you — is that
you find the one column you recognise, read it, and ignore the other
thirty-two. That is thirty-two facts about your money going unexamined every
single quarter.

**Two. Those column headings are machine tokens, not words.** `SUI2_COGS_C`.
`WAPFML`. `MED_C`. You told me *"I don't use any of the reports in the
screenshot really because I don't understand fully what it is showing me."* Of
course you don't. Nobody could. That is not a failure of understanding on your
part, it is a failure of labelling on Sage's.

**Three. Your Exception Report prints twenty-six rows to tell you about ten
people.** Sixteen of your employee records have zero wages in both quarters —
they are inactive people still on file. So two thirds of that report is blank
rows you have to scan past.

**Four. Your Employee Compensation report is completely empty.** Seven columns,
twenty-six rows, and not one number anywhere. It has structure and no content.
That is worse than a blank page, because it looks like an answer.

**Five. Your Vacation and Sick Time report shows negative balances as bare
negative numbers**, with nothing to say what a negative balance means or whether
it is a problem.

## What I built, defect by defect

**For the machine tokens, a dictionary and a decoder.** Every one of those
tokens is now translated into English, and — this is the part that matters
financially — it tells you whose money it is. `SS` and `SS_C` look like the same
tax. They are not. One is withheld from your employee, and one comes out of your
pocket. If you read them as one number you will believe payroll costs you about
half of what it actually does. The trailing `_C` is the entire difference.

The decoder handles the ugly ones too. `SUI2_COGS_C` decomposes into: the
Employment Administration Fund surcharge, on the cost-of-goods-sold labour side,
employer half. Three separate facts hiding in one token.

**For the thirty-three columns, eight layout rules.** Each rule names the
specific Sage defect it fixes and cites authoritative text. They are not
preferences — a preference does not belong in an engine.

**For the twenty-six rows telling you about ten people, suppression with
disclosure.** Rows with nothing in them are hidden, and the report always tells
you *how many* were hidden and offers to show them. Hiding quietly would be
worse than not hiding at all. Hidden-and-disclosed is a summary;
hidden-and-silent is a lie of omission.

There is a free benefit here. If the report says "sixteen of twenty-six had
nothing to report" and you only think you employ ten people, that gap is a list
of names worth looking at once — terminated staff never deactivated,
duplicates, or somebody who should have been paid and was not.

**For the empty report, an honest empty state.** It now distinguishes two
completely different facts that used to look identical: *nothing happened in the
period you picked* versus *this report has never had any data in it, ever*. The
first is a quiet quarter. The second usually means a feature was never switched
on and something has been going unrecorded, possibly for years.

**For the bare negative leave balance, words.** It now reads **"48.01 hours
advanced"** — meaning the employee has taken leave they have not earned yet.
That is an ordinary thing with a name, and naming it turns a puzzle into a fact
you can act on. Worth catching early, because if that person leaves you are
recovering it from a final paycheque.

## The one Sage report that is genuinely good

I want to give Sage credit where it is due. Your Exception Report — the one
printed "for MED_COGS" — is, underneath the bad presentation, exactly the right
idea. It recomputes what should have been withheld, sets it beside what actually
was, and shows the difference. A column of zeros means nothing is wrong. Any
non-zero is a name and an amount to go look at.

That is the "prove it to me" control every accountant wants, and I have rebuilt
it properly. Same arithmetic, readable columns, inactive people suppressed, and
a one-sentence verdict at the top so you can close the page in four seconds when
everything is fine.

**One warning about it, and it is important.** A clean reconciliation proves
your withholding matches **the rate**. It does not prove the rate is right. If
the rate itself is stale, every line ties perfectly and every line is wrong.
That is not hypothetical — it is precisely what happened with the 0.64%
unemployment rate sitting in Sage against the 0.37% the State actually charged
you.

## The rate correction you need to make in Sage

This follows from reading your filed returns, and it stands:

| | Sage has | The filed return proves | |
| --- | --- | --- | --- |
| Unemployment (UI) | 0.64% | **0.37%** | Sage is stale |
| Employment Administration Fund (EAF) | 0.64% | **0.03%** | Sage is wrong |

At 0.64% the UI line would have been $441.11 for the quarter. The State charged
you $255.02. Nothing was overpaid, because ESD bills from its own rate — but
Sage will keep producing wrong figures until you correct it for the rest of
2026.

## Something you asked for that already exists

You wrote: *"We will need a way to update these and all other rates and formulas
that change periodically easily."*

**You already have that engine.** I built it in an earlier slice when you said
rates change often. It is worth knowing what it does, because it is better than
what you asked for.

It does not store rates as fixed numbers anywhere. It stores them as **dated
rows** — this rate, from this date, to this date, from this source document. So
when your 2027 rate notices arrive and we enter them, re-running an old quarter
still uses the rate that was correct *then*. Your history does not silently
change underneath you.

It also refuses to answer rather than guess. If you ask it for a rate on a date
it has no row for, it stops and says so instead of quietly reaching for the
nearest one. And it self-checks at start-up: overlapping dates, gaps, rates
above the statutory ceiling, and employer/employee shares that do not add to
100% all fail loudly and immediately.

**What is missing is the screen.** The engine has no user interface, so today
updating a rate means I do it. That is the gap, and it is a much smaller job
than building the engine would have been. Send me the notices when they arrive
and I will build you the screen alongside entering them.

## Two bugs my own tests found before you did

I would rather tell you about these than have you find them.

**The first was embarrassing but harmless.** When a figure moved by an amount too
small to show as a percentage — a penny off two thousand dollars is 0.005% — the
report printed **"down 0%"**. That is a sentence that argues with itself, and a
reader who sees it twice stops trusting the whole column. It could also print
"-0%", because of a quirk in how computers handle negative zero. It now says
"down by less than 0.01%" and shows the exact dollars, which were always right.

**The second was the dangerous kind, and I want to explain it properly** because
it is the sort of thing that decides whether a system is trustworthy.

The reconciliation report has to make one judgement call: is this small
difference harmless rounding, or a real error? Rounding differences are
unavoidable — every paycheque rounds to the nearest cent, the tax return rounds
once on the quarter's total, and the two answers differ slightly. Both are
correct. Your own Form 941 has a line for it: line 7, "fractions of cents",
which reads −$0.07 on your Q2 return.

I had forty tests on that report and all forty passed. Then I ran what is called
a mutation test — I deliberately sabotage the code and check that the tests
notice. I replaced the entire judgement with "always call it rounding." That
change **permanently disables the control**. It would excuse a difference of any
size — a hundred dollars, ten thousand — as harmless rounding, forever.

**All forty tests still passed.**

Not one of them had ever tested the case where the report is supposed to say
"no, this is too big to be rounding." I had tested the control agreeing and
never tested it refusing. That is a control that only looks like a control.

It is fixed, and there is now a test driven by a realistic cause — the hours on
the return disagreeing with the hours in the detail, which is a mistake a real
payroll clerk makes. I also wrote it into the standing rules as **rule 60**, so
it cannot happen the same way twice: *any tolerance, threshold, grace period or
materiality floor must have a test proving it refuses, not merely one proving it
accepts.*

On the threshold itself — I did not pick a number that felt about right. Ten
people each rounding to the nearest cent can move a total by at most five cents.
That is arithmetic, not judgement. It scales correctly from ten employees to four
hundred, and it can be explained in one sentence to an examiner. A tuned constant
cannot be defended at all, and it fails both ways at once: swallowing real errors
when you are small, crying wolf when you are large.

## The quarter I am keeping as the reference

You said: *"yes keep them as known good quarters to reference."* Done, and it is
now doing real work.

Q2 2026 is stored as it was **filed** — ten employees, fourteen return lines,
three agencies, with the confirmation numbers. Every figure the engine produces
is checked against it.

The reason this quarter is so valuable is that one number — **$68,923.45** —
appears on four separately filed returns to three different agencies: your Form
941, your ESD unemployment return, your Paid Leave return, and your L&I report.
Four independent filings agreeing on one wage base is about as strong as evidence
gets for a business your size.

So this is not a test fixture I invented. Most test data is made up by whoever
writes the test, which means it can only ever prove the code agrees with its
author. **When our arithmetic disagrees with this quarter, ours is wrong.** There
is no third possibility to argue about.

Everything reproduces to the cent:

| What | Filed | Reproduced by |
| --- | --- | --- |
| 941 line 5a, Social Security | 8,546.51 | 68,923.45 × 12.4% |
| 941 line 5c, Medicare | 1,998.78 | 68,923.45 × 2.9% |
| 941 line 12, total owed | 14,204.57 | 14,204.64 − 0.07 |
| ESD unemployment | 255.02 | 68,923.45 × **0.37%** |
| ESD administration fund | 20.68 | 68,923.45 × **0.03%** |
| WA Cares | 399.76 | 68,923.45 × 0.58% |
| Paid Leave, employee share | 556.32 | premium 778.83, then 71.43% of it |
| L&I workers' comp | 1,989.99 | 3,558 hours × $0.5593 |

That Paid Leave line taught me something worth passing on. It is a **two-step**
calculation and the order matters. Compute the premium first, then take the
employee's share of the premium. Collapsing it into one combined rate gives a
different answer and does not match what you filed. The State's arithmetic is the
specification — when our answer and theirs differ, ours is wrong.

## How a real finance department would actually use these

You asked how enterprise reporting is genuinely used, because you don't want to
poke around in reports for no reason. The honest answer is going to sound
anticlimactic.

**In a well-run finance function, nobody browses these reports.** They run on a
schedule, and the only question asked of them is binary: did anything break. The
skill is not in reading the grid. It is in the cadence, in knowing which
differences are expected, and in knowing which single number justifies picking up
the phone.

So here is the routine I would actually give you.

**Every quarter, before you file — not after.** Run the reconciliation the same
day each quarter. A difference found in July is a correction. The identical
difference found in November is an amended return, and those cost real money and
real time. Read the verdict sentence at the top and stop there when it is clean;
that is what it is for.

**When it is not clean, work the exception list from the top.** It is sorted
largest-first on purpose, because the biggest difference almost always carries
the explanation that accounts for the smaller ones.

**Once a month, look at leave balances.** Any advanced balance is a conversation
to have that week — not because it is wrong, but because you want to have decided
it deliberately rather than discovered it at an exit interview.

**Once a year, separately, verify the rates against the agency notices.** The
reconciliation cannot do this for you. This is the failure mode where every line
ties and every line is wrong, and it is exactly the one that bit you.

**Read the change column before the amount column.** On a payroll report the
amounts are mostly predictable and the changes are where the story is: a new
hire, a termination, a rate change, or a mistake. Three of those four you already
know about. The fourth is the one to chase.

There is one more idea worth stealing from large finance departments, called
four-eyes review: the person who runs payroll should not be the only person who
ever checks it. You are a small employer, so for you that means *your own eyes,
at a different time, on a fixed day, looking at a report you did not assemble by
hand*. That is a genuine control and it is nearly free.

## What the authorities say, and one place I am staying quiet

Everything above is tied to text I can quote and verify, not to my taste. Ten new
authorities went into the system this slice and every quote was checked
character-by-character against a local copy of the source.

The two that carry the most weight here are binding accounting standards, not
guidance. **ASC 205-10-45-1** says comparative statements are ordinarily
necessary and that one year's figures alone are not particularly useful — which
is why every report defaults to showing you the prior period. **ASC 205-10-45-3**
uses the word "shall" twice: prior figures shall in fact be comparable, and any
exception shall be clearly brought out. That is the rule behind the engine's
refusal to print a percentage when a rate changed underneath the numbers. In that
situation the percentage describes the rate change, not your business, and
printing it unqualified is the report telling you a confident lie.

The FASB conceptual framework supplies the rest: that reports must be
understandable to a reader with reasonable business knowledge who reviews them
diligently — not to a specialist; that omitting information can make a report
incomplete and therefore potentially misleading; and the balance between
aggregating too little and too much. That last pair is exactly the tension
between your thirty-three-column report and a single useless total.

**And one honest limitation.** You asked me to reference how professional CPAs
and CFOs work. I have done that above from practice, but I want to flag the
difference: the accounting standards I quoted are verified word-for-word against
sources held locally. The professional-practice guidance — the COSO internal
control framework in particular, which is the standard reference for exactly the
control-versus-tolerance problem I hit this slice — is **not** mirrored here, so I
have deliberately not quoted it. Under our own rules I do not put quotation marks
around text I cannot mechanically verify. If you want that woven in properly, say
so and I will mirror the source first and quote it correctly.

## Proof

- **86 new tests.** Total suite: **7,751 tests across 371 files, all passing.**
- **13 of 13 sabotage tests caught** — and one deliberate harmless change
  *survived*, which is what proves the harness is reporting real results rather
  than rubber-stamping everything.
- All source files verified byte-for-byte identical after the sabotage runs.
- Type checking clean, linting clean, and the verbatim-quote gate passing on 121
  verified quotations.

## What comes next

books-28 is the federal forms — 941, **940**, W-2/W-3, and 1099-NEC. That answers
the question you asked me earlier: 940 arrives in books-28, not this slice.

One thing I inherit into it: because you are a semiweekly depositor you file
Schedule B, which reports your tax liability **day by day**. That means the daily
figure has to be captured as payroll runs, not reconstructed at quarter end.

The boundary I keep repeating still holds: **we replace the data-preparation half
of what Aatrix does for you. We do not become your filing agent.** You keep
control of transmission.

## One question for you

The reconciliation report suppresses employees who have no wages and nothing
withheld. On your Q2 data that hides sixteen of twenty-six people.

**Are those sixteen genuinely inactive, or should some of them have been paid?**
I am not going to assume either way. If they are inactive it may be worth
deactivating them properly, so the number stops appearing on every report you
run.

# The 940 is finished — and the roadmap itself was wrong

**Slice books-54 · Form 940, from 18 lines to all 30**

Michael — you asked me to finish the lessons for the 940, to go above and beyond,
to test everything, to never guess and never assume, and to point out any
pre-existing warnings so we can decide together whether to fix them.

There were **four**. Three are now fixed. The fourth I found and am reporting
without fixing, and I explain why below.

One of the four was a dead cross-reference that would have sent you to look at a
box that does not exist. Another was a hole around **the single most important
arithmetic check on the whole form**. I want to explain both in plain language.

---

## The short version

Form 940 is your annual federal unemployment return — the FUTA form. Before this
slice the application could explain **18** of its lines. It now explains **all
30** — every box on the form you actually filed, with nothing left over and
nothing invented.

| | before | after |
|---|---|---|
| Lines the app can teach | 18 | **30 — the whole form** |
| Full written lessons | 8 | **20** |
| Lines with "whose money is this" recorded | 18 | **30** |
| Word-for-word IRS quotes behind them | 21 | **34** |
| Ownership mutations attempted / caught | 4 / **3** | 30 / **30** |

Read that last row carefully, because it is the heart of this report. The
previous slice's probe tried four deliberate sabotages of the 940 and caught
three. This slice tried **all thirty** and caught **all thirty**. The one that
got away last time was line 17 — and line 17 is the worst possible place for a
gap. More on that in Warning 2.

Every one of those 34 quotes is checked letter by letter against the real IRS
instruction file on every test run. Not one was typed by hand. They are cut
mechanically out of the source document, because anything I retype is something
I could get subtly wrong — and I proved that to myself the hard way in this very
slice (see "The mistake I made", below).

---

## Warning 1: the roadmap said the 940 had 21 lines. It has 30.

You asked me to track the roadmap so we do not drift. So the first thing I did
was check the roadmap against the paper — and the roadmap was wrong.

Our own planning document said the 940 needed to go from 18 lines to **21**, and
listed the gap as "missing 1a, 1b, 2, 4a–4e". That is seven boxes.

The real form has **30** numbered lines and the real gap was **twelve**.

The document had been written from memory of the form rather than from the form.
Line 15 splits five ways — 15a, 15b, 15c, 15d, 15e — exactly as the 941's line
15 does. Line 16 splits four ways. Nobody had counted.

Had I trusted our own roadmap, I would have added seven boxes, marked step 1c
complete, and told you the 940 was finished while five lines were still missing —
including your bank routing number and account number boxes.

**This is the second slice in a row where the roadmap's own line count was
wrong.** The 941 target said 25 and the truth was 27. I have now corrected the
940 row and added a note to the roadmap recording that both counts came from
memory. From here on the count comes from `pdftotext` of your own filed PDFs,
and is asserted against the engine on every test run.

One detail worth your time: I first tried to read the line labels with a pattern
match, and it **could not be trusted**. It returned "24" and "25" out of a
paragraph of ordinary body text, and it missed 4a, 4c, 4d, 4e, 15b and 15d
because a lowercase word happened to follow them. So I read all thirty in
context by hand instead. The pattern match would have been faster and wrong.

---

## Warning 2: line 17 could have been silently mislabelled, and line 17 is the audit check

This is the most serious finding, and I want to be precise about the timeline,
because it matters for whether you can trust the measurement.

**I measured this before I changed anything.** That was deliberate. If I had
added my twelve lines first and then probed, I could not have told you whether a
hole was pre-existing or something I had just introduced. So the probe ran
against the code as it stood on `main`.

Every line on the 940 is tagged with **whose money it is** — your money, a wage
base that nobody owes, or not money at all. I mutated four of those tags to
values that are flatly false and ran the tests.

Three were caught. **Line 17 survived, with 274 tests green.**

Here is why that specific line is the worst place for a gap. Line 12 is your
total FUTA tax for the year. Lines 16a through 16d are that tax split across the
four quarters. Line 17 is the sum of the four quarters — and **line 17 must
equal line 12 to the cent**. It is the form's own internal audit check. It is
the number the IRS uses to confirm the return is internally consistent.

I had mislabelled it from "your money" to "a wage base nobody owes", and nothing
in eleven thousand tests noticed.

Why did the other three get caught? Because two specific gates happened to cover
them: one blocks any 940 line being called employee money, and a named test pins
lines 3 through 7 as wage-base lines. The unguarded space was drift *between*
"your cost" and "a wage base" and "not money at all" — and nothing patrolled it.

**It is now closed, and closed for all thirty lines rather than for line 17.**
Fixing only line 17 would have been fixing the instance instead of the class.
There is now a pinned table stating what every one of the thirty lines is, in
both directions, plus a specific gate asserting that lines 12 and 17 are both
your cost. The sweep at the top of this report is the proof: 30 attempted, 30
caught, 0 survived.

**This was pre-existing.** It was in the code before this slice and it was not
something I introduced.

---

## Warning 3: two lessons pointed at a box that has never existed

This one I was not looking for, and it is a good illustration of why "test
everything" keeps earning its keep.

Every lesson in the app carries cross-references — *"this box relates to that
box on that other form."* They are how the app tells you the ESD wage detail
must reconcile with the 5208A, or that a 940 line ties to a W-2 box. They are
genuinely useful and they are the sort of thing you would follow.

**Nothing had ever checked that the box on the other end existed.**

I measured it: **56 cross-references across the four lesson files, two of them
dead.** Both were in the Washington lessons, and both pointed at the ESD 5208B
box named `"wage-detail"` — which has never existed. That form's real columns
are `wage-detail-wages`, `wage-detail-hours` and `wage-detail-total`.

In practice: the app tells you to go compare a figure against a box, you go to
that screen, and the box is not there. Both had been in the code since the
lessons were first written, and every test had been green the whole time — for
the simple reason that written prose does not execute.

There is a wrinkle here that I think justifies the whole approach. The two dead
references had **identical target text**, so the obvious fix is a
search-and-replace. That would have been wrong. One of them is about *wages*
reconciling and the other about *hours* — so they needed to be repointed at two
*different* columns. A search-and-replace would have sent both to whichever
column I typed first, and a gate written afterwards would have gone green on a
half-wrong answer.

Both are fixed, pointed at the right column each, and there is now a gate that
resolves every cross-reference in **all four** lesson files. It refuses a
missing form, a missing box, and — importantly — it refuses to report success
if it was handed nothing to check, because a checker that examines nothing
approves everything.

**This was pre-existing**, dating to the slice that first built the lessons.

While I was there I found something adjacent and smaller: a gate called
"every taught box must have a specimen" has existed for several slices but was
being applied to the **W-2 lessons only**. I measured whether the other three
would pass — they all do, so nothing was broken — but they were correct by luck
rather than by gate. It is now applied to all four.

---

## Warning 4: the IRS's own 2025 sentence is incomplete — reported, not fixed

This one I am flagging rather than fixing, because fixing it is not mine to do.

The 940 has a line 2 for wages paid in a **credit reduction state** — a state
that borrowed from the federal unemployment fund and did not repay, where you
lose part of the 5.4% credit. I went to quote the IRS on it, and the 2025
instruction file says, word for word:

> *"For tax year 2025, there are credit reduction states."*

There is no number in that sentence. It reads like a sentence with a word
missing, and it is genuinely unhelpful.

I checked whether our mirrored copy was corrupted, byte by byte against its
recorded fingerprint. **It is faithful.** That is what the IRS actually
published. I then researched it separately: the 2025 credit reduction states are
**California** (1.2%) and the **U.S. Virgin Islands** (4.5%).

So I did **not** quote that sentence, because quoting a sentence that omits its
own subject teaches nothing. I quoted a complete adjacent sentence instead and
wrote the reasoning into the code as a permanent comment. The two state names
are in the lesson text — but as researched fact plainly labelled as such, never
dressed up as an IRS quote.

**Does this affect Greenway?** No. You are a Washington-only employer, line 1a
is WA, and Washington is not a credit reduction state. Line 2 stays blank. But
the day it *isn't* blank, that lesson needs to be right.

---

## The mistake I made, and how it got caught

You have asked me repeatedly not to hide these, so here it is, and it is the
worst class of error in this whole project.

The quotes in this app are cut mechanically out of the IRS instruction file
rather than retyped, precisely so I cannot get them subtly wrong. My slicing
tool takes an anchor phrase, finds it, and takes the text that follows.

For lines 4a and 4e the anchor phrases were *"Fringe benefits, such as the
following."* and *"Other payments, such as the following."* — and **each of
those phrases appears twice in the document.** My tool took the first match
each time, which was in the wrong section, and returned slices of 2,180 and
2,298 characters. They had swallowed an entire IRS worked example about three
employees, and a page header.

**And my own checker said they were fine.** Of course it did: a contiguous slice
of a document is *trivially* verbatim. Every character was genuine. The quote
was still a fabrication — a fabricated quote made of genuine parts. The repo's
own test file lists that as a known defect class, and I walked straight into it.

What caught it was not the checker. It was the length. A quote for a tickbox
should be one or two sentences, and 2,298 characters is not that. I looked
because the number was implausible.

Three guards now exist so it cannot recur: a hard length ceiling, a page-header
detector, and a heading-swallow detector. The corrected slices are 289 and 150
characters.

There was a second, related one. The line 1b slice came back containing
`"multi-state employ- er"` — because the PDF splits words across line breaks.
I deliberately did **not** write code to stitch hyphens back together. That
would be a third transformation applied to text that is supposed to be
untouched, and it is exactly how "verbatim" quietly stops meaning verbatim. The
tool now **refuses** such a slice and I chose a different anchor.

---

## What is now true, and what is still not

Honest status, because a report that only lists wins is not a report.

**True now:**
- All 30 lines of the 940 are taught, classified and quoted.
- All 30 ownership tags are protected by mutation-proven gates.
- Every cross-reference in every lesson file resolves to a real box.
- The 941 (27 lines) and W-2 (20 boxes) were already complete.

**Still not true:**
- **Form W-3 has zero boxes** and asking the app to teach it throws an error.
  Pre-existing, reported in the last two slices, still open. It is small and I
  can close it in a future slice.
- **The four Washington forms are weak.** You said so and you are right. The ESD
  5208B has 4 boxes and **zero lessons**. That is next — books-55 — along with
  the PFML / WA Cares CSV export from the specification you uploaded.
- **The DOR Combined Excise return has no teaching table at all.**
- **The 941's instruction citations are formatted so they do not route to the
  verifier**, which means they are *unchecked* rather than wrong. This is
  recorded debt from an earlier slice. I want to flag that it is still open: it
  is not a defect today, but it is an unlit corner.

---

## On your budget

You have **$8,000** of runway against your $30,000 ceiling, and you asked
whether we can finish. I said yes and I still think yes, but I want to give you
a real reading rather than a reassuring one.

This slice cost less than the last one, because the pattern is now established:
measure the paper, cut the quotes mechanically, classify, teach, then mutate
every row to prove the gates. That machinery is built and paid for. Applying it
to the Washington forms should be cheaper still, because those forms are smaller.

The expensive work left is not the teaching layer — it is the three things you
named as high priority: the ATM connection, intercompany rent, and bank feeds.
Those touch real money movement rather than form labels, and I have deliberately
not started them, because you were right that they matter more than cosmetics
and I do not want to reach them with an empty tank.

**My recommendation, unchanged:** finish the Washington forms next (books-55,
including your CSV export), then stop expanding the teaching layer and turn to
the money plumbing. The K-1, 1120-S and 1040 stay on the back burner where you
put them.

One thing I want to say plainly, since you mentioned wanting to wow grandpa. The
940 is now the most thoroughly verified form in the application: 30 of 30 lines,
34 word-for-word IRS quotes, 30 of 30 sabotage attempts caught. When you sit
down with him, that form will hold up to any question he asks about where a
number came from.

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

**Question 3 remains closed**, thanks to your answer: James was not an employee
in 2024, 2025 or 2026 — he was on the books like your mother Theresa for health
insurance benefits, and neither takes distributions.

The caution I attached to it still stands and I am repeating it rather than
letting it fade. Your answer settles the *arrangement*. It does not settle the
*payroll-tax* question, because a W-2 for Teri Becker **does** exist showing
$11,029.32 of health coverage in box 14 and matching box 1, with nothing
withheld. Whether that reporting is right is question 4, for grandpa.

That figure came up again in this slice, from a different direction. The new
lesson for line 4a warns that health premiums for a more-than-2% S-corporation
shareholder belong in **line 3** of the 940, not in line 4 as an exempt payment.
Putting them in line 4 would understate your FUTA wage base. This is the same
$11,029.32, and it is now taught in the place where the mistake would be made.

---

## How to check every word of this

Nothing here rests on my say-so:

- Type-check: **0 errors**
- Lint: **0 problems**
- Word-for-word authority check: **328 quotes verified**
- Full test suite: **451 files, 11,098 tests, all passing**
- Ownership mutations: **30 attempted, 30 caught, 0 survived**
- Cross-references checked: **56, all resolving**
- Every new gate proven capable of failing before being trusted
- Standing rules file: **0 deletions**

On the "proven capable of failing" line — that is not a formality. For every
gate added here I first broke the thing it guards and confirmed the gate went
red, then restored the file and confirmed it was byte-for-byte identical to
where it started. A gate that has never been seen to fail is decoration, and I
would rather show you the failure than assert the pass.

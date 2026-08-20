# What is left to build

Written for Michael, in plain English, at the end of slice books-13.

> **See also `docs/BOOKS_ROADMAP.md`** — added in books-17 at Michael's
> direction. That file is the *tracked status board*: the mandated build order,
> what is done, what is next, and what is still owed. This file is the
> *narrative*: why each piece matters and what makes it hard. Keep both.

You asked: *"at the end of the next slice please let me know what all is left to
build to make our platform complete."* This is that answer. I have kept it
honest, including the parts that are harder than they look and the parts I
cannot finish without something from you.

---

## Where the bookkeeping branch stands today

Thirteen slices in, this is what is actually built and tested:

The **general ledger** is real. Chart of accounts, journal entries,
double-entry posting that refuses to post out of balance, a trial balance, and
four separate ledger entities so Greenway, the ATM, the landholding, and your
personal books never touch each other. That last part matters more than
anything else on this list, and I will come back to it.

**Vendor bills and 280E** are built, including which costs survive as inventory
and which die at the door. **Bank matching** is built, with the two silent
reconciliation errors it is possible to make. **Payroll and COGS** is built,
with the honest answer that a retailer mostly cannot inventory labor.
**Fixed assets** exist. **Cutover and conversion** scaffolding exists, and by
design it runs last.

As of this slice, **payroll withholding** is built end to end: the W-4 record,
Worksheet 1A, the 2026 percentage-method tables, eight distinct wage bases,
and nine mentoring blockers that intercept a bad edit and route you to the
right place with an audit trail.

What does **not** exist yet is everything downstream of the ledger: the
financial statements, the tax engine, and the forms.

---

## 1. Financial statements

This is the next thing to build, and it has to come before the tax work,
because every return in section 2 is assembled from these three reports. If
the statements are wrong, the returns are confidently wrong, which is worse.

Four pieces:

**Balance sheet, income statement, and statement of cash flows**, each per
entity and consolidated. These are not hard arithmetic — they are hard
*presentation*. The income statement in particular has to show 280E honestly:
gross receipts, then cost of goods sold, then the wall, and then the operating
expenses that are real money out the door but not deductible. You should be
able to look at one page and see both the number the IRS cares about and the
number your bank account cares about, and understand why they differ by so
much.

**Statement of stockholders' equity**, which for an S-corp is where the
Accumulated Adjustments Account lives. This one is quiet and important. It
tracks the difference between what the company earned, what it distributed,
and what your basis is — and it is the thing that decides whether a
distribution is tax-free or a capital gain.

**Comparative periods and a close checklist.** A statement with no prior period
next to it tells you almost nothing.

The one thing that makes this slice genuinely hard is that under 280E, the line
between "cost of goods sold" and "operating expense" is not an accounting
preference — it is the entire tax bill. That boundary has to be enforced by
the software, with the reasoning attached, not left to judgment at month end.

---

## 2. The tax engine and the forms

You said to go slow here, and you were right to. This is the part of the
platform where a plausible-looking wrong answer does real damage, because you
will sign it.

I want to state the sequence plainly, because it is not optional:

> **Statements → basis → 1120-S → K-1 → 1040.**

Each one is built from the one before it. Skipping ahead means guessing, and
guessing here has your signature on it.

### 2a. S-corporation basis and the AAA

Before any return can be drafted, the system has to know your **stock basis**
and **debt basis**, tracked year by year. This decides three separate things:
how much loss you are allowed to deduct, whether a distribution is tax-free,
and what happens when you eventually sell or wind down.

Basis is also the single most commonly wrong number on small S-corp returns,
because it lives outside the general ledger. Nothing in your bookkeeping forces
it to be right. The software has to.

Research is done for §1366 and §1368. Still owed: §1366(d)(1) loss limitation
mechanics in full, and the ordering rules when distributions and losses land in
the same year.

### 2b. Form 1120-S and Schedule K-1

Line by line, built from the statements, with every line traceable back to the
journal entries that produced it. Click a number, see where it came from.

This is also where **reasonable compensation** has to be confronted, and I am
going to be direct with you about it because the numbers are already in your
own filings. The transcript review of the returns you uploaded shows roughly
**$55k of W-2 wages against about $630k of K-1 income**. You are an 85%
owner-employee who works in the business. The IRS position, and a long line of
cases behind it, is that an owner-employee takes a reasonable salary *before*
taking distributions — and this is the most frequently litigated S-corp issue
there is. A ratio like that is exactly the pattern an examiner looks for.

I am not telling you the number is wrong. I do not know that, and I will not
guess at it. What I am telling you is that it is the largest unaddressed
exposure sitting in your returns today, and the system should surface it
plainly, show the comparison, and let you document the reasoning behind the
figure — not quietly pick one for you.

Two related flags came out of that same transcript review and belong here
rather than buried in a research file: the **disproportionate distributions**
question, which touches the one-class-of-stock requirement (your mother's 10%
is allocated but not paid), and the **CHAMP-structure substantiation** gap —
the written leases, square-footage study, and duty studies that a 280E cost
allocation needs standing behind it. You have told me those documents do not
exist yet, so drafting the templates is on my side of the line, not yours.

### 2c. Form 1040 and the individual side

The K-1 flows to Schedule E. Then Schedule C for the ATM (NAICS 522200), and
Schedule E page 1 for the Geiger rental at $48k a year (NAICS 531100).

**§199A** deserves its own mention. The qualified business income deduction is
worth up to 20%, and whether a cannabis S-corp can claim it against income that
280E already inflated is a genuinely contested question. This needs the
research treatment before a line of code, and it needs to be a documented,
switchable position with the argument attached — the same way we treat 280E
relief today.

### 2d. Washington and local

The B&O tax, which is a **gross receipts** tax — it does not care whether you
made money. The WA cannabis excise tax. Sales tax. Port Orchard and Kitsap
County local obligations. And the annual L&I and unemployment filings.

### 2e. The payroll returns

Form 941 quarterly, Form 940 annually, W-2 and W-3, and the deposit schedule
rules — which matter enormously, because the penalty for depositing late is
calculated on money you already withheld and already hold. The withholding
engine built in this slice produces every number these forms need. What is
missing is the forms themselves and the calendar that tells you when.

### 2f. The forms builder

This is the piece you described most specifically, and it is a real product in
its own right, not a printing feature.

A form field in this system should know four things about itself: where its
number came from, whether it may be edited, what the correct path is if it may
not be, and what audit record an override produces. That is exactly the pattern
built this slice for payroll — nine blockers, three severities, one route per
stated intent, every route naming the record it leaves behind. It generalizes.

The work is applying it to every line of every form, and doing the visual
research you asked for: how professional preparers actually lay out a form
review screen, what auditors expect to see in a workpaper reference, and what
the AICPA standards require when software prepares a return.

---

## 3. The rest of the platform

**Depreciation.** More is built here than I first credited. The MACRS
percentage table is already transcribed verbatim from Pub. 946, the asset
classes are defined, and — this is the good part — the engine currently
*refuses* the mid-quarter convention rather than faking it, because mid-quarter
is a whole-year test across every asset you placed in service, and it cannot be
decided one asset at a time. What remains is that whole-year test, the §179 and
bonus elections, and the schedule that ties it all to real assets. That last
part is blocked on you — see below.

**Period close — a screen for it.** I want to correct something before you read
it wrong: the close *machinery* is already built and it is strict. Migration
0172 gives you `gl_close_period`, which refuses to close a period that still
has unposted drafts sitting in it, and `gl_reopen_period`, which will not
reopen anything without a written reason. Both write to the audit log. What is
missing is only the screen — today closing a month means calling a database
function, which is not something you should have to do.

**Document management.** Every refusal in this system asks for evidence — a
rate notice, an exemption letter, a signed W-4. Those documents need somewhere
to live, attached to the transactions that depend on them.

**Audit trail reporting.** The events are being recorded. There is no screen
yet that lets your grandfather sit down and review them, which is the whole
point of recording them.

**The conversion slices.** Sage has all four entities commingled. Untangling
that is the last thing we do, deliberately, because it should land on top of a
system that is already provably correct.

---

## 4. What I need from you

These are genuine blockers. I am not going to invent them.

1. **The depreciation schedule.** Cannot build MACRS without knowing what
   assets exist, what you paid, and when they were placed in service.
2. **The work papers.**
3. **Twelve years of tax returns.** These are the historical corpus. Under
   standing rule 19, your past filings are the permanent test cases — if the
   engine cannot reproduce a return you already filed, the engine is wrong.
4. **Evidence that Greenway has zero accumulated E&P.** This changes how
   distributions are taxed. Standing rule 11 says it comes from evidence, not
   from an assumption, so I am asking rather than assuming.
5. **Your SUTA rate notice and L&I risk classification.** The payroll engine
   refuses to compute these from memory. That refusal is deliberate, and it
   will keep refusing until the documents exist.

---

## Suggested order

1. Financial statements — everything else is built on them
2. Period close and lock — so the statements stay true
3. Basis and AAA tracking
4. Form 1120-S and the K-1
5. The 1040 side, including §199A researched properly
6. Payroll returns — 941, 940, W-2/W-3
7. Washington and local
8. The forms builder generalized across all of it
9. Depreciation, once you have sent the schedule
10. Conversion, last

---

## One thing worth saying plainly

The most valuable property this system has is not any single calculation. It is
that it **refuses to guess**, and tells you why in words you can check against
a statute.

That is also the property that is easiest to lose. Every future slice adds
pressure to let one number through unverified because it is inconvenient that
day. The mutation campaigns exist for exactly that reason: they break the code
on purpose and require the tests to notice. In this slice they caught two real
gaps, including one vacuous test I had written myself — a test that derived its
expected answer from the function it was testing, and so passed happily even
when that function was broken.

Keep that discipline and the tax engine will be trustworthy. Drop it, and the
tax engine will be confident instead.

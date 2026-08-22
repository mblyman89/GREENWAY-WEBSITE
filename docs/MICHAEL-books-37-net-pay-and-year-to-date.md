# Net Pay and Year-to-Date — And the Date Your First Payroll Cannot Run

**Prepared for:** Michael Lyman, Owner, Greenway Marijuana
**Legal entity:** LYMAN'S MARIJUANA L.L.C. · WA UBI 603 353 555 · EIN 46-4217016
**Slice:** books-37 · **Migrations:** none new (uses 0199, `payroll_ytd_accumulators`)
**Screens:** `/admin/books/net-pay` — "Net Pay Walkthrough" under Accounting
 `/admin/books/ytd` — "Year-to-Date Totals" under Accounting
**Date prepared:** 22 August 2026

---

## Read this part first

I have to lead with something you are not going to like, because burying it
would be the single worst thing I could do to you.

**Your first payroll is scheduled for 1 January 2027. As of today, the system
cannot compute it.** Ten of the eleven rates a Greenway paycheque depends on
have no figure on file that covers that date. This is not a bug I introduced
and then failed to fix. It is a calendar problem that has been sitting quietly
in your file the whole time, and this slice is the first thing that was capable
of seeing it.

Here is the list, exactly as the software reports it:

| Rate | What I have on file | Covers 1 Jan 2027? |
|---|---|---|
| WA Paid Leave — total premium | 2025 and 2026 | **No** |
| WA Paid Leave — employee share | 2026 | **No** |
| WA Paid Leave — employer share | 2026 | **No** |
| WA unemployment (SUTA) rate | 2026 | **No** |
| WA unemployment wage base | 2026 | **No** |
| L&I employee hourly rate | 2026 | **No** |
| L&I employer hourly rate | 2026 | **No** |
| Social Security wage base | 2026 | **No** |
| Washington minimum wage | 2025 and 2026 | **No** |
| Federal minimum wage | 2009 through 2026 | **No** |
| WA Cares premium rate | 2026 **and 2027** | **Yes** |

One out of eleven. And the one that passes only passes because the statute
happens to set that rate every two years instead of every year.

Now — why doesn't the system just carry last year's numbers forward? Every
other payroll package on earth would. That is exactly the point, and it is
worth two minutes of your time.

Suppose I let it reuse the 2026 figures. Your 1 January cheques compute
instantly. Every line adds up. The stub balances to the penny. It looks
perfect. And it is wrong, because Washington will have published new Paid
Leave premiums, a new minimum wage, and a new L&I rate notice with your
experience factor baked into it — and you will have withheld against none of
them. You would not find out from the software. You would find out from a
notice, months later, for every employee and every cheque in between, with
interest.

A refusal costs you an afternoon of gathering paperwork. A confident wrong
answer costs you a correction cycle you cannot see coming. So the system stops.

**What I need from you, and roughly when:**

- **WA minimum wage for 2027** — L&I usually announces around 30 September
  2026. Send me the announcement.
- **Your 2027 L&I rate notice** — arrives in December. This one is
  Greenway-specific: it carries your own experience factor for risk class 6403,
  so I cannot get it from a public table. It has to be your notice.
- **Your 2027 SUTA rate notice from ESD** — also Greenway-specific, also
  December, also cannot be looked up.
- **2027 Paid Leave premium split** — ESD publishes it in the autumn.
- **2027 Social Security wage base** — SSA announces mid-October.

The two that genuinely cannot be rushed are the L&I and ESD notices, because
they are addressed to you personally and nobody else has them. The moment they
land, scan them to me and the date clears.

There is one honest piece of good news buried in that table. If your first
payroll were run today — say a 18 December 2026 pay date — **all eleven rates
are on file and it computes cleanly.** The machinery works. It is only the
2027 crossing that is dark, and it is dark for a reason that has nothing to do
with the code.

---

## What was actually built

Two screens, both under Accounting in the left-hand navigation.

### 1. Net Pay Walkthrough — `/admin/books/net-pay`

This screen answers one question: **where did the money go between "gross pay"
and "what the employee takes home"?** It shows the full waterfall, in order,
with the law sitting next to each step.

The first thing on the page is the readiness banner described above — the list
of what is missing for 1 January 2027. I put it at the top deliberately. A
warning below a beautiful worked example is a warning nobody reads.

Below it is a complete worked cheque. **Every number on it was computed by the
same engines a real pay run uses.** Nothing is typed in. The hourly rate is
read out of the rate registry with the L&I announcement behind it. I will walk
you through it, because the shape of it is the thing worth learning.

### 2. Year-to-Date Totals — `/admin/books/ytd`

This screen shows each active employee's running totals for the year, and how
much room is left before the Social Security wage base cuts off. It also
carries a six-step year-end checklist that has to be worked in order before
W-2s go out.

You told me the 16 inactive employees are no longer working for you and their
data lives in your Sage backups. This screen therefore shows **active employees
only**. There is an important caveat on that, and it is in its own section near
the end of this report — please read it before January of any year.

---

## The worked cheque, line by line

An employee earning the Washington minimum wage, working two full 40-hour
weeks, with one child-support order attached. Pay date 18 December 2026.

**Gross pay: $1,370.40** — $17.13 per hour × 80 hours.

**Withholding required by law: $217.59**

| Line | Amount |
|---|---|
| Federal income tax | $80.60 |
| Social Security | $84.96 |
| Medicare | $19.87 |
| WA Paid Leave | $11.06 |
| WA Cares | $7.95 |
| L&I workers' comp (employee share) | $13.15 |
| **Total** | **$217.59** |

**Disposable earnings: $1,152.81**

**This is the most important number on the page and almost nobody gets it
right.** It is not gross pay, and it is not take-home pay. It is gross minus
*only* what the law forces out. Here is the statute, word for word:

> "The term 'disposable earnings' means that part of the earnings of any
> individual remaining after the deduction from those earnings of any amounts
> required by law to be withheld."
>
> — 15 U.S.C. §1672(b)

In plain English: this is the line every garnishment is measured from. Notice
what Congress did *not* do — it did not give you a list of qualifying
deductions. It gave you a **test**: "required by law." You apply that test to
each deduction, one at a time. Get this line wrong and every garnishment
computed from it is wrong too, in the same direction, on every cheque, forever.

**Garnishment: $288.20**

**Net pay: $864.61**

And the arithmetic closes exactly: $1,370.40 − $217.59 − $288.20 − $0.00 =
$864.61. The screen states that reconciliation explicitly rather than leaving
you to check it, and a test fails the build if it ever stops balancing.

---

## The defect this slice found in your garnishment engine

This is the part I most want you to see, because it is the kind of error that
is invisible from the outside.

The garnishment engine documented its "required by law" bucket as income tax,
FICA, Paid Leave and WA Cares — and the comment said **"NOTHING ELSE."** The
L&I employee premium was missing from that list.

That sounds like a footnote. Watch what it does.

L&I is $13.15 on this cheque. Leave it out of the required bucket and
disposable earnings become $1,165.96 instead of $1,152.81 — $13.15 too high.
The garnishment is a percentage of that inflated base, so the creditor takes
slightly more than the law allows, out of the pay of someone who is *already*
being garnished. It is small on one cheque. It is permanent, it repeats every
payday, and it is taken from the person least able to absorb it.

Here is the sentence that settles it, verbatim:

> "(1) Every employer who is not a self-insurer **shall deduct** from the pay of
> each of his or her workers one-half of the amount he or she is required to
> pay, for medical benefits within each risk classification. ... (2) It shall be
> unlawful for the employer, unless specifically authorized by this title, to
> deduct or obtain any part of the premium or other costs required to be by him
> or her paid from the wages or earnings of any of his or her workers, and the
> making of or attempt to make any such deduction shall be **a gross
> misdemeanor**."
>
> — RCW 51.16.140(1), (2)

Read the verb in subsection (1): **shall deduct**. Not *may*. Washington
*orders* you to take half the medical-aid premium out of your worker's pay. And
subsection (2) makes deducting the *wrong* amount a gross misdemeanor.
Something the state compels you to withhold, on pain of a criminal charge, is
about as clearly "required by law" as a deduction can possibly get. So it comes
out **before** the garnishment limits are applied. It now does.

The federal enforcement agency reads the test the same way:

> "The amount of pay subject to garnishment is based on an employee's
> 'disposable earnings,' which is the amount of earnings left after legally
> required deductions are made. Examples of such deductions include federal,
> state, and local taxes, and the employee's share of Social Security, Medicare
> and State Unemployment Insurance tax. It also includes withholdings for
> employee retirement systems required by law."
>
> — U.S. DOL, Wage and Hour Division, Fact Sheet #30 (Dec. 2024)

Look at the pattern in their examples. The test is whether the deduction is
**compelled**, not who ends up holding the money. They include the employee's
share of *state unemployment insurance* — a state-law payroll deduction that is
not an income tax at all. Washington's L&I employee premium is the same kind of
animal. Same bucket.

One honesty note, which the screen also displays: Fact Sheet #30 says of itself
that its contents "do not have the force and effect of law." It is the
published view of the division that *enforces* this against employers, on a
term the statute leaves undefined. Persuasive, not binding. The screen tags it
"agency guidance" rather than "regulation" so you always know which kind of
authority you are looking at.

---

## The mirror image — the mistake almost everyone makes

Now the opposite error, and this one is the most common garnishment mistake in
payroll:

> "Deductions **not** required by law — such as those for voluntary wage
> assignments, union dues, health and life insurance, contributions to
> charitable causes, purchases of savings bonds, retirement plan contributions
> (except those required by law) and payments to employers for payroll advances
> or purchases of merchandise — usually **may not** be subtracted from gross
> earnings when calculating disposable earnings under the CCPA."
>
> — U.S. DOL, Wage and Hour Division, Fact Sheet #30 (Dec. 2024)

Health insurance. Retirement. Union dues. A payroll advance you are recovering.
**None of them reduce the base a garnishment is measured against**, however
automatic they look on the pay stub. They come out *after* the garnishment, not
before.

Why this trips people: on a pay stub, a health premium sits in the same column
as Social Security, in the same font, with the same minus sign. It *looks*
identical. But subtract it first and you shrink the base, take too little for
the order, and on a **support order the shortfall can become your liability
rather than the employee's.** The wrong answer looks completely ordinary, which
is exactly why it survives.

The engine now enforces the split, and a test fails if a voluntary deduction
ever migrates into the required bucket.

---

## The garnishment ceiling, worked out loud

The order asks for 25% of disposable earnings: 25% of $1,152.81 = **$288.20**.

Support orders are not held to the ordinary 25% ceiling. Two facts pick the
real limit:

1. **Does the employee support another spouse or child?** Yes → the cap starts
   at 50% rather than 60%.
2. **Are there arrears older than twelve weeks?** No → it stays at 50%.

50% of $1,152.81 = **$576.40**. Washington separately caps support withholding
at 50% of disposable earnings under RCW 26.18.090(2) — also $576.40. Both
apply, and the employee gets the benefit of whichever is stricter.

$288.20 fits comfortably under $576.40, so the full amount comes out. The
screen shows this reasoning as prose, not as a bare number, because when a
worker asks "why is this much gone?" you need to be able to answer without
opening a law book.

---

## Why the engine refuses instead of warning

You will occasionally hit a screen that stops and says it will not compute
something. That is deliberate, and this is the statute behind it:

> "Any employer **or officer, vice principal or agent of any employer** ... who
> (1) Shall collect or receive from any employee a rebate of any part of wages
> theretofore paid ... or (2) Wilfully and with intent to deprive the employee
> of any part of his or her wages, shall pay any employee a lower wage than the
> wage such employer is obligated to pay ... or (4) Being an employer or a
> person charged with the duty of keeping any employer's books or records shall
> wilfully fail ... to show openly and clearly in due course in such employer's
> books and records any rebate of or deduction from any employee's wages ...
> Shall be guilty of a misdemeanor."
>
> — RCW 49.52.050

Note the phrase **"officer, vice principal or agent."** This statute reaches
*you personally*, Michael — not merely LYMAN'S MARIJUANA L.L.C. Taking money out
of somebody's cheque that you were not entitled to take is not a bookkeeping
error in this state. It is a misdemeanor.

That is why the engine **refuses** a deduction with no written authorisation
rather than taking it and flagging it in a report somebody reads on Monday. A
refusal costs you five minutes. The alternative is a wage claim, doubled
damages, and your name on it.

There are exactly two lawful exits:

> "The provisions of RCW 49.52.050 shall not make it unlawful for an employer to
> withhold or divert any portion of an employee's wages **when required or
> empowered so to do by state or federal law** or **when a deduction has been
> expressly authorized in writing in advance by the employee** for a lawful
> purpose accruing to the benefit of such employee ... PROVIDED, That the
> employer derives no financial benefit from such deduction and the same is
> openly, clearly and in due course recorded in the employer's books."
>
> — RCW 49.52.060

Either the law makes you withhold it, or the employee signed for it **in
writing, in advance**, for something that actually benefits them. No third exit.

"In advance" is the part that catches people. Taking the deduction this Friday
and collecting the signature next week does not satisfy this — the
authorisation has to exist *before the money moves*. There is a narrow extra
allowance for medical, surgical and hospital deductions, and note the two
conditions riding on it: you must derive **no financial benefit** from the
deduction, and it must be recorded openly in the books. A health premium you
quietly mark up is outside that exit entirely.

---

## The Year-to-Date screen, and the number that made it necessary

Some payroll limits are **annual**, and a pay run that only knows about itself
cannot see them. The clearest example:

> "The total of boxes 3 and 7 cannot exceed $184,500 (2026 maximum social
> security wage base)."
>
> — IRS Instructions for Forms W-2 and W-3 (2026), Box 3

Social Security stops once an employee has been paid $184,500 in a calendar
year. Nobody at Greenway is close, but the rule is not optional and the system
has to be *able* to stop. The only way to know you have crossed an annual
figure is to remember what you already paid. That is what this table does, and
it is why year-to-date storage was the first job in the queue rather than the
fourth.

The screen shows each active employee's remaining room before the ceiling. Two
behaviours are worth knowing about, both locked down by tests:

- **At exactly $184,500 the ceiling is reached** — not "above." Equality counts.
  An off-by-one here would withhold Social Security on a dollar that is exempt.
- **Remaining room never displays as negative.** If a row somehow exceeded the
  base, room shows zero and the ceiling flags as reached, rather than printing a
  negative number that looks like an accounting entry.

The wage base is also **passed in as an argument**, never read from the system
clock. If you open the 2026 board in March 2027 it still uses the 2026 base.
Reading a limit off the wall calendar is how a historical figure silently
becomes the current year's.

### The three ways the SSA throws a whole year back at you

> "The SSA will reject Form W-2 electronic and paper wage reports under the
> following conditions. • Medicare wages and tips are less than the sum of
> social security wages and social security tips. • Social security tax is
> greater than zero; social security wages and social security tips are equal to
> zero. • Medicare tax is greater than zero; Medicare wages and tips are equal to
> zero."
>
> — IRS Instructions for Forms W-2 and W-3 (2026)

Each of these is a relationship between two running totals, so the database
enforces all three the moment a pay run posts. Medicare wages can never be less
than Social Security wages; neither tax can be nonzero while its own wage figure
is zero. Catching this in August costs nothing. Catching it at the filing
deadline costs a scramble.

The middle bullet is also the reason Medicare and Social Security have separate
columns. They are identical up to the wage base and permanently different
afterwards — one figure for "wages" would hide that.

### The year-end checklist, in order

Six checks, and the order is not decorative. Each one lists what must pass
first, and the screen will not let you skip ahead.

1. **The year-to-date totals agree with the pay run lines they came from.**
   Everything else depends on this. *If it fails:* the report names each figure
   that disagrees with the stored number, the recomputed number, and the
   difference. **Understand the difference before rebuilding** — a rebuild makes
   the numbers agree and destroys the only evidence of what went wrong.
2. **No employee's Social Security wages exceed the wage base.** *If it fails:*
   the ceiling was missed on a pay run; both the employee's withholding and your
   match are overstated, and the over-withheld amount must be refunded to the
   employee **before** the W-2 is issued.
3. **No employee's Medicare wages are below their Social Security wages.**
   *If it fails:* automatic SSA rejection. Usual cause is the wage base ceiling
   having been applied to Medicare, which has no ceiling.
4. **No employee shows Social Security or Medicare tax with no wages behind it.**
   *If it fails:* another automatic rejection. Usually a manual adjustment made
   to a tax figure without the matching wage figure.
5. **No employer match was booked against Additional Medicare tax.** There is no
   employer match on the 0.9%. At Greenway's wage levels this should be zero for
   everyone, so any amount here deserves confirming before it is accepted.
6. **The W-2 totals agree with the four quarterly 941s added together.** This
   one requires all four above. *If it fails:* the IRS compares these itself and
   issues a notice when they disagree, whether or not the underlying money was
   right. **Do not adjust the W-2 totals to force agreement** — if a 941 was
   wrong, it gets amended.

Five of the six block filing. Only the Additional Medicare check is advisory.

---

## The caveat on "active employees only" — please read this one

You said the 16 inactive employees are gone and their data lives in Sage. The
screen honours that: every read filters on `active = true`.

**Filtering the screen by active is right. Filtering a filed tax form by active
would not be.** A W-2 is owed to everyone you paid during the year, including
people who quit in March. When the W-2 and 941 slice is built it must read by
**tax year**, not by active status, or you will under-report wages and shortcut
someone's W-2.

I have written that constraint into the code as a permanent comment so whoever
builds that slice cannot miss it. And I built one more safeguard: the board
reports a count called `inactiveRowsNotShown`. If there is ever a stored
year-to-date row belonging to someone not on the active list, the screen tells
you **how many people are being left out** rather than silently omitting them.
Hiding a row is fine. Hiding the fact that you hid a row is not.

One more small thing: an employee with no stored row for the year reads as
"never paid this year" — which is genuinely different from "paid zero." The
screen distinguishes them. And if the database read fails outright, you get an
error card that says so plainly. It specifically does **not** show an empty
table, because an empty table looks exactly like "nobody has been paid," and
those two situations demand opposite responses.

---

## What I got wrong building this, and what I did about it

You have told me these are the most useful part of these reports, so here they
are.

**1. I nearly deleted a real safeguard to fix a cosmetic failure.**

I wrote a test that fails the build if arithmetic like `0.25` ever appears
inside a screen file — because a garnishment percentage belongs in the engine
where it is tested, never in display code where it isn't. The test immediately
went red, and it was matching Tailwind styling names like `mt-0.5` and
`bg-white/[0.02]`. Harmless. Not arithmetic.

The obvious fix was to delete the check. That would have been a disaster: it
would have removed the only thing standing between us and a hard-coded 25%
garnishment rate living in display code where no engine test would ever look at
it. So I made the check **sharper** instead. It now blanks out the *contents* of
every text string before it looks for arithmetic, so styling names are invisible
to it while real numbers are not. Then I added a test proving the check can
still fail. It survived, and it got stronger.

**2. I suspected a defect and was wrong — evidence beat instinct.**

WA Cares was the one rate covering 2027, and my first reaction was that
somebody had fat-fingered an end date. I went to check before changing
anything, and found the statute sets that premium **biennially**, not annually.
The 2027 end date is correct, and there was already a comment warning future
maintainers not to "tidy" it. I left it alone. Under your standing rule I do not
change a number because it looks wrong — I change it when I can show it *is*
wrong.

**3. A navigation guard caught me, correctly.**

Adding two screens broke a test that pins the exact list of Accounting pages. My
instinct was to loosen it to "contains at least." But that test has a comment
explaining why it is strict: a loose check notices a page being *added* and
completely misses a page being *deleted*. I extended the pinned list to sixteen
and recorded why. The strict half stayed strict.

**4. I broke my own tests 22 times on purpose.**

A test that cannot fail is worse than no test, because it displays a green
checkmark while guarding nothing at all. So for every safeguard in this slice, I
deliberately broke the thing it protects and confirmed the test caught it —
moving the permission check after the data read, dropping the active-employee
filter, changing the wage base ceiling from "at or above" to "above,"
hard-coding the garnishment rate, unlinking the navigation, deleting the
read-failure branch, and sixteen others. **All 22 turned red. None slipped
through.** Then every file was restored.

---

## Where this leaves you

**Working today:** gross-to-net for a pay date with rates on file; the full
garnishment waterfall with correct disposable earnings; year-to-date
accumulators with wage base tracking; the six-step year-end checklist; and every
number on both screens traceable to the statute or agency instruction behind it.

**Blocked on paperwork:** the 1 January 2027 pay date, until those five rate
notices arrive. Two of them — L&I and ESD — are addressed to you and cannot come
from anywhere else.

**Still to build before you can file anything:** the W-2 and 941 forms
themselves, the financial statements, and the read-back of employee W-4s into
the pay run so this stops being an illustration and starts being your actual
payroll. That last one is the next real milestone, and this slice built the seam
it plugs into.

**A boundary worth restating:** this replaces the data-*preparation* half of
what Aatrix does for you. It gets the numbers right and shows you why. It does
not transmit anything to any agency, and it is not a filing agent.

---

## The verification behind this report

Every figure quoted above was produced by running the code, not by remembering
what it should say.

- **8,832 tests across 400 files — all passing.**
- **239 verbatim quotations re-read from their mirrored sources and matched
  character for character.** Every quote in this report is in that set. If one
  word drifts, the build fails. Two quotes in this slice were caught by that
  checker during drafting — one had run two subsections together and dropped a
  "(2)" marker, which made a criminal penalty read as part of a different
  sentence. Four characters. That is why quotes are re-verified on every commit
  rather than trusted because they looked right the day they were pasted.
- **78 new tests** over the two screens, each proved capable of failing.
- **22 deliberate mutations, 22 caught.**
- Type checking, linting and the pure self-test suite all clean.

---

*Prepared by your development agent · books-37 · 22 August 2026*
*Questions, corrections, or "that's not how I do it" — tell me and I will change
it. Nothing in here is guessed; where I did not know, I said so and asked.*

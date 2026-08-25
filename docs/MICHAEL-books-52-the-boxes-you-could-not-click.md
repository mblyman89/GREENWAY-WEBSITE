# Books-52 — The twelve boxes you could not click

**For Michael Lyman. Written after the work was finished and verified, not while
it was hopeful.**

---

## The short version

Your W-2 has nineteen numbered boxes on it. Until this slice, this system could
explain **eight** of them. If you clicked box 14 — the one with `HEALTH
11,029.32` printed on Teri Becker's real filed W-2 — the software had nothing to
say. Twelve of those silent boxes now talk. The W-2 went from **8 boxes to 20.**

Then I tried to break what I had built, which is what you asked for. Breaking it
found something worse than a missing box, and it had been sitting in the code
long before this slice: **the system would happily let a tax withheld from an
employee's paycheque be relabelled as your company's own expense, and not one of
eleven thousand tests objected.** That is now fixed and the fix is proven.

I also found a test that was punishing progress, and a mistake I made while
testing that I nearly recorded as a success. Both are written up below, because
you have said repeatedly that you want to know when I get things wrong.

---

## What you can now click

Twelve new boxes on the W-2 screen, each one a real box on the paper form you
hold in your hand:

| Box | What it is | Whose money |
|---|---|---|
| 7 | Social security tips | A figure, settles nothing |
| 8 | Allocated tips | A figure, settles nothing |
| 9 | (not used) | Not money at all |
| 10 | Dependent care benefits | A figure, settles nothing |
| 11 | Nonqualified plans | A figure, settles nothing |
| 12 | The lettered codes | A figure, settles nothing |
| 13 | The three tick-boxes | Not money at all |
| 14 | "Other" — your `HEALTH` box | A figure, settles nothing |
| 15 | State and employer state ID | Not money at all |
| 18 | Local wages | A figure, settles nothing |
| 19 | Local income tax | **The employee's money** |
| 20 | Locality name | Not money at all |

Each one gives you what the box is called on the real government form, whose
money it is, where the number comes from, how to read it, the mistake people
usually make, and what to do about it — plus the IRS's own words where the
instructions say something specific.

**On box 14 specifically, because it is yours.** Teri Becker's filed W-2 shows
`HEALTH 11,029.32` in box 14, and that figure equals her box 1 exactly. The
lesson says plainly that **box 14's caption is not authority for anything.** It
is a free-text box. Whatever word is typed in it — `HEALTH`, or anything else —
does not decide how that money is treated for tax. That distinction is the
difference between a caption and a rule, and it is exactly the kind of thing a
tidy-looking form will quietly talk you out of. This connects directly to your
**open question 4**, which is still open and still needs your accountant.

Every IRS quote in those twelve lessons was pulled out of the mirrored
instruction file **by a script**, slicing exact line ranges and printing the text
mechanically. I did not retype a single one. Retyped quotes are how a document
slowly becomes wrong while looking more polished each time.

---

## The thing that breaking it found

This is the part worth your attention.

I changed one word in the code. W-2 **box 19** is local income tax *withheld from
an employee*. I relabelled it from "the employee's money" to "the employer's
cost" — in plain terms, I made the software believe that a tax taken out of a
worker's cheque was actually Greenway's own business expense.

**The entire test suite passed. All of it.**

That is a bookkeeping lie with a legal edge on it. Money withheld from a worker
belongs to the worker; it is their money, travelling to the government through
your payroll. Money that is your cost is yours. Confusing the two in the wrong
direction is not an accounting nicety — **RCW 51.16.140(2) makes deducting the
employer's share of workers' compensation from a worker's pay a gross
misdemeanour.** A system that cheerfully calls withheld money "employer cost" is
a system that could one day show you a screen implying you may recover it from
someone's paycheque.

### Was it my fault?

I had to know whether I had just broken this, or merely discovered it. So I ran
the identical experiment on **box 17**, which has been in the system since long
before this slice.

**That passed too.** So the hole was **already there** and this slice did not
create it. It had survived because nothing had ever probed it.

Here is why it went unnoticed: the Form 940 side already had a guard for the
mirror-image error, stopping *your* federal unemployment tax from being charged
to an employee. Somebody — me, earlier — wrote that guard and never wrote its
opposite for the W-2. The protection existed in one direction only.

### The fix, and why it is narrow

There is now a guard asserting that the five W-2 boxes reporting money withheld
from an employee — **2, 4, 6, 17, 19** — can never be classified as your cost or
as shared.

I deliberately did **not** write the sweeping version, "no W-2 box is ever the
employer's money," and I want to say why, because the sweeping version would look
stronger and be worse. It is simply **false**. Box 12 code DD is *Cost of
employer-sponsored health coverage* — genuinely your money, reported on the
employee's W-2 for information. A rule that has to be weakened the first time
someone models box 12 properly is a rule that teaches the next person to edit
tests until they go green. So the guard asserts only what is actually true.

### Proof it works, run both ways

| | Box 19 relabelled as employer cost |
|---|---|
| **Before** the new guard | 27 tests passed — the hole was real |
| **After** the new guard | Fails, and names box 19 in a full English sentence |

Ten experiments in total — all five withholding boxes, both wrong labels —
**ten caught, ten naming the exact box.**

---

## Two more things I got wrong, told on myself

**One: my first attempt to test the new guard was worthless, and it looked
like a result.**

I ran all five mutations and every one of them "passed." I was moments from
recording that the new guard did not work. It did work — I was running the wrong
test file, one that never invokes those checks, so my guard never executed at
all.

What saved me was **box 4**. Mutating box 4 should have tripped a *different,
older* guard about Social Security that I knew for a fact was already there. It
didn't. That was impossible, and impossible results mean the experiment is broken,
not the code. A test run that cannot fail is not evidence of anything.

**Two: a test in this repo was punishing progress.**

An older test had the W-2's box count frozen at exactly `8`, and the total across
all forms frozen at exactly `53`. The moment W-2 coverage rose to 20, the suite
went red — `53 − 8 + 20 = 65` — even though nothing whatsoever was broken.

The flaw was structural: it compared a **letter written to you on a particular
day** against a **system that is supposed to keep growing**. That comparison can
only ever mean "coverage may never improve." Worse, anyone who hit it would learn
the wrong lesson — just edit the number until the tests pass — and that habit is
how test suites rot into decoration.

It is now a **ratchet**, and it is *stricter* than before, not looser:

- The words in your books-49 letter are still pinned **exactly.** Quietly
  rewriting a letter already sent is falsifying the record, and that still fails.
- The engine may **grow** freely, but may never **shrink** silently. If a form
  loses boxes — a bad merge, a deleted table — it fails and names the form.

Before, exactly one number passed. Now every number below the baseline fails.
I proved it by cutting the W-2 down to 6 boxes; it went red and told me which
form had lost coverage and by how much.

---

## Verification — what I actually ran

Not "it should work." These were run, and on the **merged** code, not just on my
branch — because a rebase can produce a combination that neither side ever tested.

- **449 of 449** test files pass
- **11,046 of 11,046** tests pass
- TypeScript: **0 errors**
- Linter: **0 problems**
- **315** legal quotes verified word-for-word against the source documents
- All **three** CI jobs green: compliance, migrations, build
- The standing-rules file was not touched

---

## Where we are on the roadmap you approved

You said you agreed with the coverage-before-cosmetics plan and asked me to track
it so we don't drift. That tracker is now a real file in the repo,
`docs/ROADMAP-forms-and-lessons.md`, so it survives me forgetting.

| Step | Status |
|---|---|
| **1a. W-2: 8 → 20 boxes** | **Done, this slice** |
| 1b. Form 941: 13 → 25 lines | Next |
| 1c. Form 940: 18 → 21 lines | Waiting |
| 1d. Count and close the four Washington forms | Waiting |
| 2. DOR Combined Excise — **no teaching at all today** | Waiting |
| 3. The visual form layer (making them look like the paper) | Deliberately after coverage |
| 4. Real figures | Deliberately last |
| 5. Intercompany rent, then the ATM business | Waiting — your open question 6 |

The tracker also records what I am **deliberately not doing**, because an
unwritten "not now" gets rediscovered and re-argued at your expense.

---

## Your six open questions — still open

You asked me to put these in front of you every time. Nothing this slice
answered any of them; they all need a human, mostly your accountant.

1. **The two LLC legal names** — confirm the crossed naming is right, and supply
   the UBI and EIN for each. *(Nicholas Mullan — you said you're asking.)*
2. **The Schedule C industry codes appear swapped** between the two Schedule C
   businesses, and rent is on Schedule C rather than Schedule E. That has a
   self-employment tax consequence. *(Nicholas Mullan.)*
3. **Was James H Becker an employee, and is there a W-2 for him?** None appears
   in the 2025 employer copies. *(You / payroll records.)*
4. **How were the health premiums reported for each Becker, and is the FICA
   treatment in boxes 3 and 5 intended?** *(Nicholas Mullan.)* — this is the one
   box 14 above touches directly.
5. **Is Nicholas paid as compensation (W-2/1099) or as a distribution?**
   *(Nicholas Mullan.)*
6. **Intercompany rent between the entities is not modelled at all yet.**
   *(A build slice — Step 5a.)*

---

## Your budget question, answered directly

You asked: *"Do you think we can finish with 8k more invested?"* You deserve a
straight answer rather than encouragement.

**First, a discrepancy I am not going to paper over.** You wrote both *"I have
spent $24,000 so far"* and *"we have gotten to this point right now spending
about 22k."* Those cannot both be right, and the gap is $2,000 — a third of the
remaining runway on the lower figure. **I do not know which is correct and I will
not guess.** Please check the actual billing. It changes the answer materially:
$6,000 and $8,000 are meaningfully different amounts of road.

**Second, the honest answer on scope.** Yes — I believe **Steps 1 and 2 can be
finished** inside that budget. That is all remaining box coverage on the 941, the
940, the four Washington forms, and the DOR Combined Excise return that has no
teaching at all today. That work is well-understood, the architecture already
supports it, and this slice is a fair measure of the pace: twelve boxes, a real
bug found and fixed, fully verified.

**What I am *not* confident about, and want on the record now rather than at
$29,000:** Steps 3 through 5 — the pixel-accurate visual forms, real figures
flowing through them, and the intercompany rent plus the ATM business — are
**probably not all fitting** in the remainder. Step 5 in particular touches four
entities and their rent relationships, and the entity questions above are *still
unanswered*, so part of it cannot even be specified yet, let alone built.

**What I recommend, plainly.** Spend the remaining budget finishing **coverage**
(Steps 1 and 2). That is the difference between a system that can explain every
box on every form you actually file, and one that explains some of them. If the
money runs out there, you own something genuinely useful and honest: it teaches
you your own filings, it refuses to show a figure it has not computed, and it
will not lie to you about whose money is whose.

A beautiful form with silent boxes would have been the worse buy, which is why
the roadmap you approved puts the cosmetics last. I think that ordering is what
protects you here.

**The thing that would waste your money is drift** — re-litigating decisions, or
me wandering into work you did not ask for. That is precisely why the tracker
file now exists and why it records the "not now" list. If you want a different
priority than the order above, say so and I will follow it; but I would rather
finish fewer things completely than leave many things half-built.

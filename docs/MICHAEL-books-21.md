# books-21 — The S Corporation Year, and Four Things I Got Wrong

**For Michael. Plain English, no jargon, nothing you need an accounting book for.**

Prepared 20 August 2026. Greenway Marijuana / LYMAN'S MARIJUANA LLC, WA UBI 603 353 555.

---

## The short version

You told me to correct the S corporation mistakes before they bit us, and to proceed with the next
piece of the roadmap. Both are done. Along the way I checked four of my own assumptions against the
actual statute text and **three of them were wrong**, which is worth more to you than the code is.

Here is the whole slice in five sentences. The software believed Greenway became an S corporation in
2026, which would have thrown away about ten years of profit you have already paid tax on and turned
ordinary distributions into reported capital gains. That is now fixed, and the software refuses to
guess the year rather than substituting a different guess. Separately, I found that this system could
not see the penalty for filing a late 1120-S at all — it answered **zero dollars** for a return a
full year late, when the real figure is over seven thousand. And I found one piece of genuinely good
news: there is a punitive IRS interest rate that **cannot legally be charged to you**, purely because
you are an S corporation.

---

## Finding 1 — The software thought you became an S corporation this year

**What it believed.** Two earlier pieces of work, books-19 and books-20, both contained a line
saying the first S corporation year was 2026. That number is correct for something else entirely —
2026 is the year these books start, the line in the sand we agreed on. Somebody (me) reused it as
though it also answered the question "since when has this been an S corporation?" Those are two
completely different facts that happened to want the same number typed in.

**Why that costs money rather than just being untidy.** There is an account in every S corporation's
records that tracks profit which has already been taxed on your personal return but not yet taken out
of the company. Distributions come out of that account tax free, because the tax was already paid.
The account correctly starts at zero **in the first year of the election** — and the software was
applying that first-year rule to 2026.

So it was starting 2026 with zero, as though a decade of already-taxed retained profit did not exist.
The consequence is not abstract: when you take a distribution, the software compares it against that
account, finds nothing there, and reports the distribution as a **capital gain**. You would be paying
tax a second time on money you had already paid tax on. The bug did not create audit risk. It
invented tax.

**A second, nastier layer.** While fixing it I found the same wrong constant was also being used to
decide which years must have their opening balances carried forward from the prior year with
evidence. It was written as "years after the first must be evidenced" — and since the software
wrongly thought 2026 was the first year, **2026 was the single year exempt from every evidence
requirement in the module.** The one year you are actually working in was the one year the guard rails
were off.

**What it does now.** The election year is a fact that has to come from a document, and the software
will not proceed without one. It will not substitute a different guess either — I very deliberately
did **not** hardcode 2016. "I don't know" is now a real answer that the system can give, and it
refuses and tells you which document to fetch. The check also runs in both directions: a non-zero
opening balance in a genuine first year is refused just as firmly as a zero balance in a continuing
year.

**What I need from you.** Two things, and the first is quick:

1. **The exact tax year of the S election.** You said late 2015 to early 2016. Those are two
   different tax years and they give different answers, so I have recorded your words verbatim as a
   *statement* rather than as a fact, and the software still refuses. The oldest Form 1120-S in your
   filing cabinet has the year printed on page one. That is evidence and it takes five minutes.
2. **The ending balance from Schedule M-2 of your most recent 1120-S** — you mentioned you have the
   K-1 and would get me the number. That is the opening balance for everything downstream.

---

## Finding 2 — Good news: a punitive IRS interest rate cannot touch you

I set out to build the extra-high IRS interest rate into the system. Then I read the statute and
found we do not need it, because it cannot apply to Greenway.

There is a penalty interest rate for large tax underpayments — five percentage points over the base
rate instead of the normal three. Practitioners call it "hot interest." The statute that creates it,
§6621(c)(3)(A), defines a large corporate underpayment as an underpayment **"by a C corporation."**
And §1361(a)(2) defines a C corporation as one that is **not** an S corporation for that year.

So the two extra points are simply unavailable to the IRS in your case, no matter how large an
assessment ever gets. That is a real benefit of the election, worth serious money on any large old
balance, and I have never seen it listed among the reasons to make one. Nobody talks about it.

**The one caveat, and it matters.** This protection lasts exactly as long as the election does. If the
election were ever broken, the year becomes a C corporation year retroactively and this rate switches
on with it. It is one more reason the election paperwork is worth finding and keeping.

I built the rate into the engine anyway — but as a **refusal**. If any part of this system ever asks
for the hot rate on Greenway's behalf, it declines and explains why, in your favour.

While I was in there I also found the ordinary rates are not symmetric, which is worth knowing. When
you owe the IRS, it is three points over the base rate. When the IRS owes **you** and you are a
corporation, it is two points — and only **half a point** on any refund above ten thousand dollars.
The government charges more than it pays, and it pays a corporation least of all.

---

## Finding 3 — I was wrong about the $435, and it was already right

The system had a note saying the minimum late-filing penalty was $435 and flagging it as probably out
of date. I assumed it was stale and set out to replace it.

It is not stale. **$435 is the figure written in the statute**, and it is correct as the base. A
separate provision, §6651(j), then inflates that base every year — which is where your numbers come
in. So the note was right and my assumption about it was wrong.

The figures you gave me are now loaded, organised by the calendar year the return was **required to
be filed** (not the tax year it covers — an easy and expensive thing to mix up):

| Return due in | Minimum penalty |
|---|---|
| 2023 | $450 |
| 2024 | $485 |
| 2025 | $525 |
| 2026 | $525 |

There is a small piece of good news buried in this. The statute rounds these adjusted figures down to
the nearest **five dollars**, which gives a free mechanical test of your handwritten numbers. All four
of yours pass. That check could have caught a transcription error and did not, which is the best
possible outcome for a check.

The software refuses to fall back to the $435 base for a year it does not have. Using the base in 2026
would understate the floor by ninety dollars, and the gap grows every year.

---

## Finding 4 — The big one: this system could not see a $7,000 penalty

This is the finding I would most want to know about if I were you.

I asked the existing penalty engine a simple question: what does it cost to file the 1120-S a full
year late? It answered **$0.00**.

I did not assume that. I ran it and read the number off the screen.

**Why it said zero.** Every late-filing penalty the system knew about is calculated as a percentage of
the tax shown on the return. An S corporation does not normally pay tax itself — the profit flows
through to your personal return. So the tax shown was nothing, a percentage of nothing is nothing, and
the software confidently reported no exposure.

**What the real answer is.** There is a separate statute, §6699, that exists specifically for late S
corporation returns. It charges a flat amount **per shareholder per month**, up to twelve months, and
it **never mentions the tax at all**. A return showing nothing owed carries exactly the same penalty
as one showing a million dollars.

You have three shareholders. At the un-inflated base figure in the statute, a return one year late
costs **$7,020**. The actual inflation-adjusted figure is higher, and I do not have it yet — see the
list at the bottom.

Before this week, the word "6699" did not appear anywhere in this codebase. Not in the penalty engine,
not in a comment, nowhere. I checked by searching for it and got zero results.

I want to be blunt about why that is the worst kind of bug. A system that reports a real five-figure
exposure as nothing does not merely fail to warn you. It **recommends the thing it exists to prevent**.
If you had asked it whether a late 1120-S mattered, it would have told you no.

**Three details that are counter-intuitive and all cost money:**

- **The ownership split is irrelevant.** Your grandfather's 5% costs exactly as much as your 85%.
  The statute counts *people*, not percentages. Three shareholders means three times the penalty,
  full stop.
- **Anyone who held stock for any part of the year counts in full.** Somebody who held shares for a
  single day in January counts as a whole shareholder for all twelve months.
- **"Each month or fraction thereof."** One day late is a full month. There is no such thing as being
  slightly late.

**What I would do.** File the 1120-S on time even in a year with nothing to report, and file an
extension the moment it looks tight. The extension is free; one day of lateness is not. And if a
return is ever already late, note that §6699's reasonable-cause defence is **broader** than the usual
one: it asks only for reasonable cause, where the ordinary late-filing statute also requires that the
failure was not due to willful neglect. That is a meaningful difference. It still has to be argued and
documented — it is a defence, not a plan.

---

## Also built: the interest engine, and why it refuses to answer

The roadmap piece for this slice was interest. It is built, and it correctly does something that will
look like a failure until you know why.

**Interest is not a penalty and it is usually worse.** Penalties are capped — the late-filing penalty
stops growing after five months, the §6699 one after twelve. Interest is not capped. It compounds
**daily** and runs for as long as the balance exists, and it is charged on the penalties too. People
negotiate hard over penalties and ignore interest, which is backwards on any balance more than a year
old.

Daily compounding is not a rounding detail. Ten thousand dollars at 7% for one year is **$725.01**, not
$700.00. Over two years at 10% the difference is more than two thousand dollars. Every estimate done
as "balance times rate" is systematically low, and it is low in the direction that makes putting off a
payment look cheaper than it is.

**Why it refuses.** The rate is not one number. It resets every calendar quarter, and the IRS
publishes each quarter's figure in a separate document. I do not have those documents. So the rate
table is **deliberately empty**, and every interest calculation refuses until it is filled in.

I want to be explicit that this is the feature, not a shortcoming. The obvious shortcut is to carry
last quarter's rate forward into a gap. That produces arithmetic which reconciles perfectly against
itself and is **silently wrong against the IRS** — the worst possible failure, because nothing in your
own records would ever contradict it. The engine refuses instead, and it lists every missing quarter at
once so it is one trip to look them up rather than four.

One more contrast worth keeping straight, because the same nominal rate behaves differently: the
Washington DOR rate you gave me (6% for 2026 and 2027) is **simple interest, reset annually**. Federal
interest **compounds daily, reset quarterly**. Six percent federally costs $618.31 on ten thousand
dollars where the state version costs $600.00, and the gap widens with time. The two schedules never
share a code path in this system.

---

## Two holes I found in my own safety nets

Both of these were found by attacking my own work after the tests were passing, which is the part of
the process that keeps earning its keep.

**The citation checker was half blind.** There is a permanent tripwire in this system that checks
every legal citation in the code actually points at a real authority — it was added in books-20 after
a citation turned out to reference the wrong kind of identifier entirely. It worked by looking for
citations written in CAPITAL_LETTERS style. But 29 of the 80 authorities in this system are written in
lower-case-with-hyphens style, including every single one I added this week, and **those were never
being checked at all.** A typo in any of them would have sailed straight through and only shown up the
moment you clicked "why?" and got an empty panel. Worse, the comment justifying the narrow check
claimed capitals were "the shape every authority id in this repo has" — which was already untrue when
it was written. The reassuring comment was the alibi.

It also only looked at citations in one of the two field shapes the code uses, which excluded all 25
citations in the penalty engine — the module that tells you what a late filing costs.

Both holes are closed. All 105 citations across both styles and both shapes are now checked, and they
all resolve.

**My own regression test was guarding the wrong door.** I wrote a test to make sure the 2026 mistake
could never be reintroduced. Then I ran an attack that reintroduced it — and the test **passed
anyway**. It was checking the two old modules where the bug had already been fixed, and not the new
module written specifically to prevent it, which is where it would next appear. Now it scans every
accounting module in the source tree rather than a hand-written list, so a new file cannot slip
through by simply not being on the list.

---

## The proof that these were real, not theoretical

Before committing any of this I do a check I hold myself to: put my week's work aside completely, so
the code goes back to exactly what is running today, and look at what the system says.

With my work set aside, the software today declares that your S election began in **2026**. It is
sitting there in two separate modules. There is no mention of the $7,000-per-year late-filing penalty
anywhere in the codebase — the phrase does not appear once. And here is the part worth pausing on:
**the existing tests all passed.** One hundred and thirty-one of them, green, sitting on top of a
defect that would have invented a tax bill out of a decade of your already-taxed earnings.

That is not a criticism of the tests. It is the whole reason I attack my own work after it goes green
instead of stopping when it does. A passing test suite tells you the code does what the tests say. It
tells you nothing at all about what the tests forgot to say. Every one of the four findings in this
report was invisible to a green test suite, and three of the four were found by deliberately trying to
break things that were already working.

---

## What I need from you

**New this week, because of what this slice found:**

1. **The exact tax year of the S election** — page one of the oldest 1120-S you have.
2. **The ending balance from Schedule M-2** of your most recent 1120-S (you mentioned you have the
   K-1 and would get me the number).
3. **The §6699 per-shareholder monthly amount** for the relevant year. Neither of us knew this penalty
   existed until this week, so it was never on a list. It is published in an IRS revenue procedure and
   will be a multiple of five dollars.
4. **The quarterly federal short-term interest rates** for any period we need to calculate. Each
   quarter is a separate IRS revenue ruling. Until these are loaded, the interest engine refuses.

**Still outstanding from previous weeks:**

5. **The depreciation schedule and asset list.**
6. **The work papers.**
7. **Twelve years of tax returns.**
8. **The intercompany detail** between the four ledgers (Greenway, ATM, land holding, personal).

---

## The state of the work

Everything is green and everything was attacked after it went green.

- **7,103 tests across 359 files**, all passing — up from 6,950 across 356 at the start of the week.
- **The type checker is clean.**
- **67 legal quotations verified word for word** against locally mirrored statute text. Four of my new
  quotations were caught as slightly wrong by that checker — I had dropped paragraph numbers — and
  were corrected against the source.
- **58 deliberate sabotage attempts** on the new code, all detected. The three that initially slipped
  through are described above; each one found a real gap rather than a theoretical one.
- The full text of §6621, §6622, §6651 and §6699 is now mirrored locally, so these quotations can be
  re-verified without an internet connection.

The roadmap order has not changed. Next up is the 1120-S and the K-1 themselves, which is the piece
that needs the two numbers at the top of the list above.

One last note on process, since it is the whole reason this slice was worth doing. Of the four
assumptions I started the week with, **three were wrong**, and all three were only caught by reading
the actual statute text rather than reasoning from what I expected it to say. The one about §6621(c)
turned into good news for you. The one about §6699 turned into a $7,000 blind spot. Neither would have
surfaced from a well-written plan.

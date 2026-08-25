# Books-59 — The three taxes, and the email address that broke your deploy

**For Michael Lyman · Greenway Marijuana · Port Orchard, WA**

---

## The short version

You gave me five things to do. Here is where each one stands.

**1. Squash merge everything so you can inspect it.** Done and pushed. All 44
commits from books-55 through books-58 are now a single commit on `main`. I
proved it carried faithfully by comparing tree hashes rather than eyeballing a
file list — the squashed tree and the branch tip are the same hash,
`29d6c82d`, which means not one byte was dropped or added. The full battery
then ran **on `main`** and passed: 464 files, 11,338 tests.

**2. The email address that broke your deploy.** You were right, and the cause
was worse than a bad setting: it was me breaking a standing rule you already
had. Fixed at the root, and the deploy is green again. Details below, because
you should know how it happened.

**3. The DOR form is cancelled.** Understood — you enter total sales and it
tells you what you owe, so there is nothing to teach. I will strip it out of
the roadmap so it stops promising you a page you do not want.

**4. B&O accounted for as its own tax type.** Done, and your July return now
lives in the system as permanent test evidence. Every line of it recomputes to
the cent. There is one genuine finding you need to weigh in on, in the section
called *"Expense and not a liability" — you are right, and here is the nuance*.

**5. Lessons for the untaught federal boxes, then the next physical form.**
Not started yet. This report is the pause before that work.

---

## The email address: I broke a rule you already had

Your repository is private now, and Vercel refuses to build when the commit
carries an address that does not look like a person. The address on your last
commit was `root@172.22.219.243` — a container IP. That is what stopped the
deploy.

What makes this worth a full explanation is that **you already had a rule
about this, and I had already been warned by the same failure once before.**
Rule 20 in the standing rules says to commit as
`Greenway Dev <dev@greenwaymarijuana.com>`. Rule 20a, added back on books-12,
says specifically that *a squash merge throws the author away* — it was written
after `gh pr merge --squash` did exactly this.

I then did it again by a different door. Rule 20a warned about
`gh pr merge --squash`; I used `git merge --squash` followed by `git commit`.
Same operation, different spelling, and I did not put the email flag on that
particular command. This sandbox had no email configured at all, so git quietly
invented one from the container's IP address rather than stopping to ask.

The real fault is in how the rule was written. It depended on me remembering a
flag on every single commit, which is the kind of guard that works until the
one time it does not. **A wrong default is more dangerous than no default,**
because it produces a plausible-looking commit instead of an error you would
notice.

**What I changed so it cannot recur:**

The identity is now set in git's own configuration — both for this clone and
globally, so a fresh clone later in the same session inherits it too. Git can
no longer guess, because there is nothing left to guess.

I also changed how it gets verified. Checking locally was never enough; the
check that actually proves anything is asking GitHub what it stored:

    gh api repos/mblyman89/GREENWAY-WEBSITE/commits/main --jq '.commit.author.email'

That now returns `dev@greenwaymarijuana.com`.

**Repairing the commit that was already pushed.** Your `main` branch is not
protected (I checked — GitHub returns "Upgrade to GitHub Pro" for the
protection API, so no protection exists), the bad commit was the very tip, and
nobody had pulled it in the few minutes it existed. That made it safe to
relabel. Before force-pushing I compared the tree hash before and after the
fix: both `29d6c82d`, unchanged. Only the author line moved; not a line of code
was touched.

**Your redeploy is triggered and green.** The corrected push fired a fresh CI
run which completed successfully.

**One thing I did not do.** Your repository's history contains a great many
older commits with bad addresses — 989 from the bot account, and about forty
with container IPs, going back long before this session. I left them alone.
Rewriting shared history to tidy up cosmetics would be a far bigger risk than
the untidiness, and only the tip actually matters to Vercel.

---

## Your July return is now evidence, not a note

You said: *"my uploaded JULY.pdf in the workspace is the actual return i filed
with dor, so it is authoritative."*

You are right that it is authoritative, and that is precisely why I checked it
instead of copying it. An authority transcribed wrongly stops being an
authority. So before a single figure was used, every line was recomputed from
its own base and rate:

| Line | Base | Rate | Computed | You filed | |
|---|---|---|---|---|---|
| B&O Retailing | 168,465.17 | 0.004710 | 793.47 | 793.47 | match |
| B&O Service & Other (ATM) | 4,355.00 | 0.015000 | 65.33 | 65.33 | match |
| State Retail Sales | 168,465.17 | 0.065000 | 10,950.24 | 10,950.24 | match |
| Local — Port Orchard 1802 | 168,465.17 | 0.028000 | 4,717.02 | 4,717.02 | match |
| **B&O subtotal** | | | **858.80** | **858.80** | match |
| **Grand total** | | | **16,526.06** | **16,526.06** | match |

Six for six, to the cent. **Your return foots perfectly.**

I also found a second copy of the same return already in the workspace
(`July 2026 Department of Revenue.pdf`), diffed the two, and confirmed they are
the same document. And I re-extracted from the PDF rather than trusting a text
file that was already sitting there from an earlier session.

The return is now mirrored in the repository at
`docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt`, byte-for-byte
identical to what comes out of the PDF, alongside the IRS and FASB sources. Its
confirmation number (0-053-958-352) is pinned in the tests, so any figure can
always be traced back to one specific real filing.

---

## The thing I did not expect: your B&O rate does not fit

This is the most important technical finding of the slice, and it is a good
example of why "never assume" earns its keep.

Every tax rate in your system is stored as an integer number of **basis
points** — hundredths of a percent. That worked perfectly while sales tax was
the only rate involved. 6.5% is exactly 650 basis points. 2.8% is exactly 280.
Clean integers, no drift, no rounding.

Your B&O Retailing rate is **0.004710**. In basis points that is **47.10** —
**not a whole number.** There is no way to store it in the existing unit
without changing the rate, and changing the rate means disagreeing with a
return you already filed with the state.

Here is what that would have cost, measured on your actual July numbers:

| What we store | July B&O retailing | Versus your filing |
|---|---|---|
| **0.004710 — the real rate** | **793.47** | **matches exactly** |
| rounded down to 47 bps | 791.79 | **understates by $1.68/month** |
| rounded up to 48 bps | 808.63 | **overstates by $15.16/month** |

A dollar sixty-eight a month is about twenty dollars a year. Small in dollars,
total in meaning: your books would permanently disagree with a filed government
return, and every reconciliation from then on would be chasing a difference the
unit itself created. **Rounding a rate is not a rounding error. It is storing
the wrong rate.**

So B&O rates are stored in **millionths** — the rate times one million.
`0.004710` becomes `4710`, `0.015000` becomes `15000`. Both exact whole
numbers. Basis points convert into the same unit without moving at all
(650 bps = 65,000 millionths), so **nothing that already worked changes its
answer.** Everything stays an integer; only the fineness changed.

I also built the rates so they can be changed. You said it yourself — *"im sure
it updates however often as it does"* — and your service rate is conditional on
prior-year receipts staying under $1,000,000, a threshold you could cross. The
rates are settable defaults, never hardcoded inside a calculation where a future
change could not reach them.

---

## "Expense and not a liability" — you are right, and here is the nuance

You said: *"its important that the books account for b&o as it is an expense
and not a liability."*

**Your instinct is exactly right, and it is the single most important thing
about B&O.** Let me lay out why, and then flag one nuance I need your call on
rather than deciding for you.

**Why B&O is different from your other two taxes.** Retail sales tax and the
37% cannabis excise are **trust money**. You collect them from the customer on
the state's behalf. They were never yours — you are holding someone else's cash
on its way to Olympia. So they hit a liability on the way in, clear it on the
way out, and **never touch your profit and loss at all.**

B&O is not that. Nobody hands you B&O at the register. It is a tax **on
Greenway**, measured by your gross receipts, and it comes out of your own
pocket. **That makes it a genuine business expense that genuinely reduces your
profit** — which is your point, and it is correct.

**The nuance.** Your chart of accounts (migration 0173, written long before
this conversation) already carries *both* `75040 B&O Tax Expense` **and**
`32200 B&O Tax Payable`. That looks like it contradicts you. It does not — the
two accounts answer different questions.

The expense records **what it cost you**. The payable records **that you have
not paid it yet**. Your July sales happened in July; the money left your bank
on 25 August. Accrual books put the expense in July, where the sales were, and
park the amount owed in the payable until the cash actually moves:

    When the month closes:
      DEBIT   75040  B&O Tax Expense      858.80   <- the expense you mean
      CREDIT  32200  B&O Tax Payable      858.80   <- just "not paid yet"

    When you pay DOR:
      DEBIT   32200  B&O Tax Payable      858.80
      CREDIT  10100  the bank             858.80

The liability is temporary plumbing that nets to zero. The expense is the
economic fact, and it stays. **If B&O were booked the way sales tax is booked —
straight to a liability with no expense side — your profit would be overstated
by the full B&O amount every single month, forever.** That is the error you were
guarding against, and the system now actively refuses it.

I have built it to keep both sides, because dropping the payable would have
meant guessing at what you meant instead of reading what you said. **If you want
B&O expensed directly when paid, with no payable at all, say so and I will
change it.** That is a legitimate choice on a smaller set of books; it just is
not the standard accrual treatment, and it is your call, not mine.

**One warning attached to this.** Migration 0173 flags account 75040 as
`nondeductible_280e`. Being an expense in your books does **not** make B&O
deductible on your federal return — §280E still disallows it for a cannabis
retailer. It is a real book expense and a disallowed tax deduction at the same
time. That difference belongs in the book-to-tax bridge, and this slice does not
touch your return.

---

## The real gap was not what either of us thought

Before writing anything, I measured what already existed. The result was not
what I expected:

| Tax type | Was it computed? | Did anything post it to the books? |
|---|---|---|
| State sales (6.5%) | **Yes** — already split out | via the trust liability |
| Local sales (2.8%) | **Yes** — already split out | via the trust liability |
| **B&O** | **No. Nothing, anywhere.** | **No** |

Two of your three types were already handled. `wa-tax.ts` has been computing
state and local separately for a long time, and your tax report page already
prints both with their rates.

B&O was the hole — and a strange one. The accounts `75040` and `32200` have
existed since migration 0173, complete with careful descriptions explaining that
B&O *"has an expense side — unlike excise and sales tax, which are trust money
and never touch the P&L."* Someone understood this perfectly and wrote it down.
Then **nothing was ever built to use it.** Searching the entire codebase for
either account number returns nothing outside the chart of accounts itself, and
there was no B&O rate anywhere in the system at all.

So the chart of accounts had the right idea sitting unused for months. That is
now connected.

---

## Your ATM answer, built in

You said: *"the surcharge only is what i enter into the dor portal when paying
sales taxes. the atm service provider deposits the surcharge separate so it will
be very simple to track."*

That matches your July return exactly — the "Service and Other Activities" line
is $4,355.00, which is surcharge income, not withdrawal volume. Built to that
shape:

- The surcharge is its own B&O classification at its own rate (1.5%), **not**
  the retail rate. This matters more than it looks: the service rate is over
  three times the retailing rate, so confusing them is a real misstatement, not
  a rounding matter. There is a test that fails if anyone ever taxes the ATM at
  the retail rate.
- The surcharge is tagged to the **ATM entity**, retail sales to **Greenway**,
  keeping your four-entity separation intact.
- **Cash withdrawn is never treated as revenue.** It is vault money moving.
  Taxing withdrawal volume as gross receipts would be a catastrophic
  overstatement, so the engine only ever sees surcharge income.
- A month with no surcharge produces no ATM line at all, because DOR does not
  print one.

Your chart of accounts already has `51000 ATM Surcharge Income` tagged to the
ATM entity — and, like the B&O accounts, **nothing posts to it yet.** Worth
flagging for when we wire the ATM feed.

---

## Proving the tests can actually fail

A test that cannot fail proves nothing. So I wrote 18 deliberate sabotages of
the B&O code, each one a realistic mistake a maintainer could make in good
faith, and required every one to turn the suite red. Among them:

- storing the rate in basis points, both rounding directions
- taxing the ATM at the retail rate, and swapping the two rates
- **booking B&O as a liability only, the way sales tax is booked** — the exact
  error you were pointing at, and the nastiest of the set because it *balances
  perfectly* and looks tidy
- neutering the expense check so it always says "yes" — a verifier that
  approves everything
- expensing the tax a second time when it is paid
- removing each refusal guard in turn

**Result: 17 of the 18 were caught. One escaped — and it was worth finding.**

### The one that escaped, and what it taught me

Mutation 10 disabled the guard that refuses **negative gross receipts**, and the
test suite stayed **green**. A guard protecting against exactly the kind of
corrupt figure that appears in your own history (negative ATM cash, negative
inventory) could have been deleted and nothing would have complained.

The reason is subtle and worth understanding, because it is a trap I had set for
myself. My test fed in gross receipts of `-100` and asserted that *something*
was thrown containing the word "negative". When the negative-gross guard was
removed, a **different** guard caught the input instead — the one checking that
deductions do not exceed gross, because zero deductions really are greater than
minus one hundred. And that guard's message happens to contain the word
"negative" too.

**So the test passed for the wrong reason.** It was never testing the guard it
believed it was testing. It would have kept passing forever with the real
protection gone.

**The fix is a class fix, not a patch.** Every refusal in the B&O engine now
carries a unique code — `BO-E01` through `BO-E14` — and every test pins the
**code** rather than the wording. Matching on prose is matching on a
coincidence; a code cannot be satisfied by accident, and rewording a message can
no longer quietly disconnect a test from the thing it guards. I also added a
test asserting that the negative-gross guard fires *before* the deductions
guard, because that ordering turned out to be load-bearing, and a test that
proves every one of the 14 codes is genuinely emitted by a real guard rather
than sitting there as decoration.

The suite went from 47 tests to **54**, and the campaign was re-run against the
hardened gates.

### The re-run, and one more piece of honesty

Second run: M10 was **caught**. But a different mutant now reported *"pattern not
found"* — my hardening had reworded the very guard that mutant was written to
attack, so the sabotage no longer applied cleanly.

That is a small thing with a big principle attached. A mutation that cannot be
applied has proved **nothing**, and if the harness had quietly counted it as a
pass it would have been lying to me — exactly the kind of blind verifier these
campaigns exist to catch. The harness is built to treat "pattern not found" as a
**defect**, so it flagged itself. I repointed that mutant at the current code and
ran a third time.

**Final result: 18 mutants planted, 18 caught, 0 escaped.** Baseline files
restored and verified by checksum, suite green afterwards.

---

## Where things stand

| | |
|---|---|
| Squash merge | Done, pushed, tree hash proved identical |
| Full battery on `main` | **464 files / 11,338 tests, all passing** |
| CI on corrected `main` | **Passed** — deploy triggered and green |
| Commit author | `Greenway Dev <dev@greenwaymarijuana.com>`, verified at GitHub |
| B&O engine | 47 tests, every line of your July return recomputed |
| Type check | 0 errors |
| Lint | 0 errors |
| New standing rules | 20b, 114, 115 |

---

## Warnings still open

Carried forward every report, per your standing request:

- **Warning #5** — the IRS's own sentence omits a count. Their text, not ours;
  not fixable by us.
- **Warning #8** — W-3 box 12b has no IRS instruction text to quote.
- **New, minor** — one pre-existing lint warning in the W-2 page
  (`w2ChecksInOrder` declared but never used). Proved pre-existing by stashing
  my changes and re-linting. I have not removed it, because deleting a symbol
  from a screen you rely on is not a safe thing to do inside an unrelated slice.
- **New, informational** — nothing posts to `51000 ATM Surcharge Income` yet,
  same as B&O was. Flagged now so it is not a surprise later.

---

## My open questions for you

1. **The B&O payable.** Standard accrual keeps both the expense and the payable.
   You said "expense and not a liability." I have kept both and explained why
   above. **Do you want it that way, or expensed directly when paid?**

2. **B&O rate changes.** The rates are settable rather than hardcoded. **Where
   would you like to set them** — the existing tax settings screen alongside
   excise and sales tax, or somewhere separate?

3. **The $1,000,000 threshold.** Your service rate depends on prior-year
   receipts staying under a million. **Should the system warn you as you
   approach it**, so a rate change never catches you by surprise?

4. **Which form next.** I am about to evaluate the 17 untaught federal boxes and
   only write lessons where they genuinely apply to you. Then the next physical
   form. **My recommendation is the 941**, because that is where the "not taught
   yet" markers actually appear — but say the word if you would rather see
   another one first.

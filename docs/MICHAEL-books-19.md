# Michael — what got built this round (books-19)

**Basis and AAA tracking.** Item 3 of the 8 you asked for, in the order you set.

No accounting jargon below. Where a technical term is unavoidable I explain it
the first time and then use it plainly.

---

## The short version

Your company now keeps track of two numbers it has to keep track of, and it
refuses to guess at either of them.

The first is **your basis**. Think of basis as "how much of this company is
already yours, tax-wise". You start with what you put in, it goes up when the
company makes money, and it goes down when you take money out or when the
company loses money. The reason it matters is blunt: **you can only take money
out of the company tax-free up to your basis.** Take out more than that and the
excess is a taxable gain, even though it felt like your own money coming home.

The second is the **AAA** — the Accumulated Adjustments Account. It is the
company's running record of profits that have already been taxed to you
personally and can therefore come back out to you without being taxed twice.

Most people assume those two numbers move together. For most businesses they
roughly do. **For yours they do not, and the reason is §280E.**

---

## Why your two numbers pull apart, and what it costs you

§280E says a cannabis business cannot deduct ordinary business expenses. Your
rent, your wages, your utilities — real money genuinely spent — are not
deductible.

Here is what that does. Take a year where the company earns $1,000 and has
$3,000 of expenses that §280E disallows:

| | Amount |
|---|---|
| Your stock basis at the end | **$0.00** |
| The AAA at the end | **−$2,000.00** |

Your basis stops at zero because the law does not let it go negative. The AAA
has no such floor and goes to minus two thousand.

**In plain terms:** every dollar of nondeductible expense burns a dollar of your
ability to take money out tax-free, and it keeps burning after your basis has
already hit zero. The damage does not stop when the counter stops. That negative
AAA is a real hole that future profits have to climb out of before distributions
are comfortable again.

This is not a bug and I have not smoothed it over. It is what §280E does to an
S-corporation, and you should be able to see the number.

---

## A mistake I made, and how it got caught

I want to show you this one, because it is the sort of thing that decides
whether you can trust the rest.

The rule for the AAA says certain reductions get deferred until after
distributions are taken into account. I read that as "when the year is a bad
one, defer **all** the reductions". That is the natural reading of the sentence
and it is wrong. The statute defines the deferred amount as the **excess** of
the reductions over the income — so the part of the expense your income can
absorb still comes off immediately, and only the surplus waits.

On the $1,000/$3,000 year above, my version produced **−$1,000**. The correct
answer is **−$2,000**. A thousand dollars of understatement, in your favour on
paper, which is the worst direction for an error to run because nobody
complains about it until the IRS does.

It was caught the first time the tests ran. It is now covered by a test that
checks the totals reconcile across eight differently-shaped years, so it cannot
come back quietly.

**Why it survived my own review:** when income is zero, both readings give
exactly the same answer. It only diverges when a year has income *and*
disallowed expense at the same time — which is to say, every single year you
will ever have.

---

## Three errors I found in work I had already shipped

While building this I set up machinery to check quoted law mechanically —
character by character against the actual government text — rather than trusting
that I had copied it correctly. Then I pointed it at the quotes from the
previous round, which were already merged.

It found three defects:

1. **A quote from §1367 stopped mid-sentence.** It ended at "held by the S
   corporation" and dropped the rest, which is a real qualifying clause about
   oil and gas depletion. The truncated version reads as a broader rule than the
   statute actually states.

2. **A quote from §1368 skipped two headings** in the middle of an ellipsis, so
   it appeared to run continuously from one part of the statute into another
   that is not adjacent to it.

3. **The same quote used single quotation marks** where the statute uses double
   ones, around the phrase "(but not below zero)".

The third sounds trivial. It is not, for one specific reason: if you or an
accountant ever search a filing for that exact phrase to check where it came
from, the wrong quote marks mean you do not find it.

All three are fixed. The checker now proves **26 quotes** character-for-character
against government source text stored in your own repository — no internet
needed, so it still works years from now if a website reorganises.

---

## The question about unequal distributions — the actual answer

You have three shareholders: you at 85%, your mother at 10%, your grandfather at
5%. Your grandfather gets paid. Your mother is allocated her share but does not
receive cash.

The worry is a rule called **one class of stock**. An S-corporation is only
allowed one class of stock, and if it accidentally has two, the S election can
be lost — which would be genuinely expensive.

I have seen this handled two wrong ways: ignoring it, or telling the owner their
election is in danger. Both are wrong here, and the second is worse because it
frightens you into fixing something that is not broken.

**The actual test is about rights, not payments.** §1.1361-1(l)(1) asks whether
all the shares confer *identical rights* to distributions and liquidation
proceeds. That is answered by your charter, your bylaws, state law, and any
binding agreement about distributions. It is **not** answered by what the
cheques happened to be. The regulation's own worked example has one shareholder
paid a full year after another and still concludes there is one class of stock.

So: **unequal distributions are not, by themselves, a second class of stock.**

**But it is not nothing either.** The last sentence of §1.1361-1(l)(2)(i) says
distributions that differ in amount "are to be given appropriate tax effect in
accordance with the facts and circumstances". Translated: the gap has to be
*called something*. Usually one of three things —

- a **loan** from the company to whoever got more,
- additional **compensation**, or
- a **gift** between the shareholders.

The system now names the variance in dollars, names the test, and tells you what
needs verifying. It does not refuse — refusing would be as wrong as staying
silent. **What you actually need to do:** check that no document anywhere gives
anyone different distribution rights, and decide what to call your mother's
undistributed share. That is a real decision with real consequences, and it is
yours, not the software's.

---

## Things the system now flatly refuses to do

Following your rule that it should refuse rather than warn:

- **Guess whether you have old C-corporation profits.** You have told me you do
  not — never a C corporation, no ownership changes since you started — so it is
  now recorded as a stated fact rather than an assumption. It stays a required
  answer, because the day that changes an entire additional set of rules
  switches on and silence would be dangerous.
- **Accept opening balances that were typed in by hand.** For any year after the
  first, the opening figures must have been produced by the system carrying
  forward the prior year. This one matters more than it sounds: a hand-typed
  opening balance gives you a year that adds up perfectly and is still wrong,
  and every year after it inherits the error.
- **Accept a misspelt name.** If next year's figures mention "Micheal Lyman", it
  stops. Previously that would have quietly recorded that you took no
  distribution — overstating your basis, overstating the AAA, and looking
  completely normal on the report.
- **Round a fraction of a cent.** Everything is whole cents, and the three-way
  85/10/5 split is proven never to lose or invent a cent.

---

## How hard I tried to break it

Per your standing instruction.

- **124 tests** on this piece alone. Whole system: **354 files, 6,802 tests, all
  passing.**
- I then broke the engine deliberately, **36 different ways**, one at a time, to
  see whether the tests would notice. Every single one was caught.
- The first two attempts were not that clean. Round one had **2 survivors** and
  round two had **2** — places where I could sabotage your books and the tests
  stayed green. Both rounds' holes are now closed and the tests that close them
  are permanent.

One of those holes is worth describing, because it is a lesson rather than a
bug. I sabotaged the routine that decides who gets the odd cent in a three-way
split — replacing the correct rule with alphabetical order — and every test
still passed. The logic was fine and the coverage was fine. The problem was my
test data: on **your** roster, alphabetical order and the correct order happen to
give the same answer. Michael, Mother, Nicholas Mullan — pure coincidence.

Using your real numbers felt like realism and was actually a blind spot. Fixed
by testing with a deliberately awkward roster where the two rules disagree.

That became **standing rule 41**, and **standing rule 40** came from the same
round: a safety check that no ordinary input can ever reach is a safety check
nobody knows works, so it now has a deliberate way to be triggered and a test
that watches it fire.

---

## Your outstanding list

**Now resolved — thank you:**

- ~~Evidence on accumulated E&P~~ — answered: none, and none possible.
- ~~SUTA rate and L&I classification~~ — supplied and in the dated rate registry.
  Payroll taxes look complete end to end.

**Still open:**

1. **The depreciation schedule** — what assets exist, what you paid, when they
   went into service. Depreciation cannot be built without it.
2. **The work papers.**
3. **Twelve years of tax returns** — these become the permanent test corpus. If
   this system cannot reproduce a return you already filed, the system is wrong
   and I want to know.
5. **Form 2553 and the CP261 acceptance letter** — the proof of your S election.
7. **Three tax rates** — the IRS quarterly underpayment rates under §6621, the
   Washington DOR 2026 annual rate, and the §6651(j) 60-day minimum penalty.
8. **Whether the "recurring item exception" was ever elected.** This is a fact
   recorded on a filed return, not something to reason out. It decides whether
   an excise liability can be deducted in the year it accrues when it is paid
   shortly after year end. Until the returns settle it, the system shows both
   treatments.
9. **Intercompany detail between your four ledgers** — Greenway, ATM,
   landholding, personal. This blocks combined statements.

Items 7, 8 and 9 are the ones you said you would get back to me on.

---

## What is next

**Item 4: Form 1120-S and Schedule K-1** — your actual corporate return,
including Schedule M-2, which is the AAA schedule that this round's work feeds
directly.

Fair warning on what that slice will raise: **reasonable compensation.** Roughly
$55,000 of W-2 wages against roughly $630,000 of K-1 income is the single most
recognisable S-corporation audit trigger there is. The system is going to say so
plainly rather than quietly print the return. Better it tells you now than an
examiner tells you later.

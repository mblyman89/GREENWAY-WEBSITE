# Michael — what got built this round (books-20)

**Form 1125-A and the cost of goods sold position.** This is the first half of
item 4 on the list of 8, in the order you set.

No accounting jargon below. Where a technical term is unavoidable I explain it
the first time and then use it plainly.

---

## The short version

Form 1125-A is the one page of your tax return that decides how much of the
money you actually spent you are allowed to subtract from your income. Under
§280E it is very nearly the *only* relief you have. So it is the highest-stakes
number on the whole return.

Your system now computes that number **two different ways, every year, side by
side**:

1. **The strict way** — only the costs the regulation plainly names.
2. **The way your grandfather has done it for twelve years** — those costs plus
   budtender wages and allocated rent.

It shows you both numbers, it shows you the gap between them in dollars, and it
will not put either one on a return until you have personally, on the record,
chosen which one goes there — with your name, the date, and your reason.

On the sample year I used to test it, the gap is **$260,800**. That is not a
rounding difference. That is roughly **$91,000 of federal tax** at a 35% blended
rate, per year, riding on which of the two numbers goes on line 8.

---

## I have to tell you plainly what the law says

You told me to maintain your grandfather's approach, and I have. You also told
me you want the system to tell you the right way "properly and aggressively,"
and to help you do it the right way. So here is the honest picture, in both
directions. I am not going to soften it, because you asked me not to, and
because the softened version would be useless to you.

### The part that cuts against you

The regulation that governs a *reseller* — a business that buys finished goods
and sells them — is **26 C.F.R. §1.471-3(b)**. It says inventory cost is:

> the invoice price less trade or other discounts... To this net invoice price
> should be added transportation or other necessary charges incurred in
> acquiring possession of the goods.

Read what that list contains: **the invoice, and the cost of getting the goods
to you.** It does not mention wages. It does not mention rent. There is a
separate, much more generous paragraph — §1.471-3(c) — that *does* allow labour
and overhead into inventory, and that is the one your treatment looks like.

But §1.471-3(c) is for **producers**, and here is the thing I want you to see
clearly, because it is not a judgment call and it will never change while you
hold your licence. Washington law, **RCW 69.50.328**, says:

> Neither a licensed cannabis producer nor a licensed cannabis processor shall
> have a direct or indirect financial interest in a licensed cannabis retailer.

You hold a retail licence. Washington forbids you from having any interest in
production. So you are a reseller as a matter of *state law*, permanently, and
the producer rules are not available to you and never will be. I built that
into the system as a computed fact rather than a setting, because it is not
something anyone should be able to tick a box to change.

There is also a sentence in the regulations that closes the argument most people
reach for. **§1.446-1(e)(2)(i)** says a taxpayer who has adopted a method of
accounting may not change it without consent —

> even though such method is proper or is permitted

— and the surrounding text applies this **"whether or not such method is
proper."** In other words: the fact that a treatment has been used consistently
does not make it correct. It makes it *a method*, which is a different thing.

And **§446(f)** closes the "nobody ever told me to stop" argument:

> A change in method of accounting... shall not be considered... to have been
> consented to... merely because the taxpayer's return... was accepted.

Twelve years of returns being accepted is not twelve years of approval. It is
twelve years of nobody looking. I know you know that — you said as much. I am
putting it in writing because it is the single most important sentence in this
whole report.

### The part that cuts in your favour

I am not going to pretend the case is one-sided, because it is not.

**§1.471-2(b)** says inventory rules cannot be uniform across all businesses,
and then says this:

> Greater weight is to be given to consistency than to any particular method of
> inventorying or basis of valuation so long as the method or basis used is in
> accord with §§1.471-1 through 1.471-11.

Twelve consistent years is a real argument, and that sentence is the reason.
Note the limiting clause at the end, though — consistency wins *so long as* the
method is within the rules. That is where the argument gets contested, and I am
not going to tell you it is a slam dunk when it is not.

The other genuinely favourable point is more subtle and it matters. Because you
have been consistent for twelve years, your treatment is a **method of
accounting**, not an **error**. That sounds bad and is actually protective: an
error can be assessed against you for the open years and corrected. A method
can only be changed by a formal procedure — and, as I explain below, that
procedure can be made to work *for* you.

---

## The thing I found that I think you should act on

This is the most valuable part of the slice, and I want to be direct about it.

There is a procedure called a **Form 3115** — a request to change your method
of accounting. Everyone assumes it is a confession. It is closer to the
opposite.

I pulled **Rev. Proc. 2015-13** from the official IRS bulletin (not a summary,
not a blog — the actual bulletin, and the file is now stored in your repo so the
quote can be machine-checked against the source). Section 8.01 says:

> ...the IRS will not require the taxpayer to change its method of accounting
> for the same item for a taxable year prior to the year of change.

Read that again. If you file the change **voluntarily**, the IRS agrees not to
go back and reopen the earlier years on that item. The twelve years close.

Then §7.03(1) sets the terms. If correcting the method increases your income —
which it would, since you would be moving costs *out* of inventory — that
increase is spread over **four years**, not taken all at once. If it decreases
your income, you take it in one. And §7.03(3)(c) lets you elect a single year if
the adjustment is under $50,000.

**But there are two conditions, and they are the reason I am raising this now
rather than later.** Section 8.02 lists eight situations where the protection
does not apply. Six of them do not touch you. Two do:

- **§8.02(1):** the protection is lost if you are **under examination** when you
  file.
- **§8.02(3):** it is lost if the issue is **already an issue under
  consideration**.

You told me the IRS has contacted you several times about other things and has
never raised the COGS classification. On those facts, both conditions are
currently clear. **That is exactly the window in which this procedure is worth
the most, and it is a window that closes the moment somebody opens an
examination.** The protection is available *because* nobody has raised it. Once
they raise it, the option is gone, and you are negotiating instead of electing.

So: **no news is not good news. No news is the deadline.**

I am not going to file anything or change anything. That is your call and your
grandfather's, and the system does what you decide. But the mentor panel in the
app now walks through this in five ordered steps, each with the authority
attached, and it will keep making this argument every year until either you take
it or §280E goes away.

---

## What the system will and will not do

You were clear that you want it to behave like a top enterprise system, and that
means it does not get to be squishy. So:

**It will not refuse to operate.** It computes your position, it files your
position, it produces your numbers. You are the owner and it does what you say.

**It will not silently agree with you either.** Every single time it produces
the number, it produces the strict number beside it and the gap between them.
There is no screen anywhere in the app that shows you one without the other.

**It will not let the choice be a default.** Last year's answer does not carry
forward. Every year you have to choose again, with that year's numbers in front
of you, and record who chose and why. An unchosen position is not a chosen
position — that is the same principle as the period-close work from last round.

**It records that you were shown the alternative.** Not "warned in the
abstract" — the actual dollar figure that was on your screen at the moment you
decided. If this is ever examined, the question will not only be "was it right"
but "who decided, when, and knowing what." A contemporaneous record that you
were shown the strict computation and consciously chose otherwise is materially
better for you than a silence that looks like nobody ever thought about it. It
is also, bluntly, the difference between a *position* and an *oversight* — and
that is the difference that matters most when penalties get discussed.

---

## One thing the system now stops you from doing, and I want to explain why

If you ever decide to switch to the strict treatment, the system will **refuse
to just let you file it**.

That will feel backwards. You are trying to do the right thing and the software
is blocking you. Here is why.

**§446(e)** says a taxpayer who changes his method of accounting shall, **before
computing** his taxable income under the new method, secure the consent of the
Secretary. Before. Not "and mention it on the return."

So the plan everyone has — *"we'll just start doing it correctly next year and
not bring up the old years"* — is itself a violation. Worse, it is the version
that gets you the least. Do it quietly and you have made an unauthorised change,
the earlier years stay open, and you have thrown away the §8.01 audit protection
that the *exact same change* would have carried if it had gone on a Form 3115.

That is why the refusal fires in **both** directions — moving toward the strict
treatment and moving away from it. It is not the system obstructing you from
doing the right thing. It is the system making sure that when you do the right
thing, you get paid for it.

---

## About §280E going away

You said you think we are close, and you want the system ready. It is, and I
tested it by actually throwing the switch.

That test found a real bug, and it is worth telling you about because of *how*
it was wrong. When I simulated §280E being repealed, the system reported that
the gap between your two numbers had closed to **zero**. That looks like good
news. It was not. It had closed the gap by quietly loosening the strict
computation — moving the goalposts rather than removing the exposure.

Here is the correct answer, from the statutes. §280E denies a **"deduction or
credit."** It says nothing whatsoever about inventories. And §1.471-3, which
governs what goes into inventory, never mentions §280E at all. They are separate
questions. So repeal does **not** change what is allowed into cost of goods
sold, and the gap does not disappear.

What *does* change is what the gap costs you. Today, a cost that does not make
it into inventory is disallowed **permanently** — that is the §280E wall. After
repeal, that same cost becomes an ordinary deductible business expense under
§162. It still is not inventory, but you get it. The gap stops being a permanent
loss and becomes a **timing difference** — the difference between deducting
something this year versus next.

That is a completely different-sized problem, and the system now says so in
those words. It also still warns you that moving costs out of inventory at that
point is *itself* a change of method needing consent first — because repealing
§280E does not repeal §446(e).

---

## How hard this was tested

You said not to get sloppy, so here is the accounting of it.

**148 new tests**, all passing. The full system is at **356 test files and 6,950
tests**, all green.

Then I attacked my own work, which is where the real value was. I ran the
finished engine against realistic numbers and read the output as an auditor
would rather than as its author, and that exercise found **five real defects
that the passing tests had not**:

| # | What was wrong | Why it mattered |
|---|---|---|
| 1 | Repeal switch loosened the strict computation | Made a $260,800 exposure look like it had vanished |
| 2 | A citation pointed at an id that does not exist | You click "why?" and get an empty panel |
| 3 | Three different failures shared one error code | The screen could not highlight the right field |
| 4 | The negative-inventory guard was never wired up | It cheerfully reported a cost of goods sold of **minus $899,999** |
| 5 | The §446(e) consent guard could never fire | It would have let you silently abandon a twelve-year method |

Number 5 is the one that bothers me most, and it is worth understanding. That
guard was *declared* — it was listed in the code as a protection. Reading the
code, the slice looked protected. But the check had nothing to compare against,
so no input could ever have triggered it. It reviewed as protection and provided
none. Both of those last two are now permanent rules in the project's standing
rules file so the same class of mistake gets caught next time, and I added a
repo-wide gate that walks every file and fails the build if any citation
anywhere points at an authority that does not exist.

Finally I ran a mutation harness: **45 deliberate sabotages** of the finished
engine, each one checking that the tests actually catch it. **45 caught, 0
survived.** Including a mutant that re-arms defect #1 above, so that specific
bug can never come back unnoticed.

Every quote in this report is machine-verified against source text stored in
your repo — **57 quotes** now checked automatically, up from 26 at the start of
this session. Fixing that checker turned up **two misquotations in code that had
already shipped**, both now corrected.

---

## What I still need from you

Still outstanding from before:

1. Depreciation schedule / asset list
2. Work papers
3. Twelve years of tax returns
4. Form 2553 and the CP261 confirmation
5. IRC §6621 quarterly rates, the DOR 2026 annual rate, and §6651(j)
6. Whether the §1.461-5 recurring item exception was ever adopted
7. Intercompany detail between the four ledger entities

**New question from this round, and it is a real one:** when you elected S-corp
status for 2026, did that reset your method of accounting, or does the LLC's
twelve-year method carry over into the S-corp? It matters a great deal. If the
S election started a fresh method, then the 2026 return may be the cleanest
opportunity you will ever get to adopt the strict treatment — possibly without a
Form 3115 at all. If the method carries over, it does not.

I am not going to guess at this one. It depends on the specific facts of the
election and it is exactly the sort of question your grandfather will have a
view on. Please ask him, and if he is unsure, it is worth a written opinion.

---

## Where this leaves us

Item 4a is done: Form 1125-A computes both ways, refuses to guess, and makes
the case for the lawful path every single time without ever refusing to do what
you tell it.

Next up is **4b — Form 1120-S and Schedule K-1**, which is the return that
consumes the 1125-A number built this round.

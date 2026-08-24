# The tabs you could not see

**For Michael. Plain English. No accounting jargon without a translation.**

Slice books-49. Written after finding and fixing the reason your form pages were
still walls of text.

---

## The short version

You were right, and I was wrong. You wrote:

> I am unable to see or use the tab system we built to let me see the various
> forms and be able to click them for learning about them. The form pages are
> still just walls of text.

The tabs existed. The lessons existed. Every test was green. And **none of it
was on your screen.** Not because it was broken in the ordinary sense, but
because of one small condition wrapped around the whole thing:

```
show the form explorer  ONLY IF  a payroll result was successfully computed
```

Greenway's first payroll is **1 January 2027**. There is no payroll result to
compute yet, so that condition is false, and it will stay false for the rest of
this year. The code said "hide the teaching material until there are real
numbers to teach with." So the one period when you most need to learn the forms
— *before* the first payroll, while there is still time to get it right — was
exactly the period the software refused to show them.

That is fixed. All seven forms now have their own tab, visible right now, with
no payroll data required.

---

## What you can click, starting now

Four screens, seven forms, fifty-three boxes. I confirmed these counts by
running the code, not by reading it:

| Screen | Web address | Forms on it | Boxes you can click |
|---|---|---|---|
| Form 941 | `/admin/books/form-941` | Form 941 | 13 |
| Form 940 | `/admin/books/form-940` | Form 940 | 18 |
| Form W-2 | `/admin/books/form-w2` | Form W-2 | 8 |
| WA quarterly | `/admin/books/wa-quarterly` | ESD 5208A, ESD 5208B, PFML & WA Cares, L&I quarterly | 3 + 4 + 3 + 4 = 14 |

**Total: 7 forms, 53 boxes.**

Click any box and you get three things: what the box is called on the real
government form, whose money it is (yours, the employee's, or a number that is
not money at all), and how that box gets filled in — written out in sentences.
Where the law says something specific about the box, you get the quote from the
actual IRS or Washington instruction, word for word.

---

## The one thing I want you to notice about the numbers

Every box on those tabs today says **"not computed yet."**

It does **not** say `$0.00`.

That difference is the most important decision in this whole slice, so let me
explain why I spent real effort on it. `$0.00` is a claim. It says "I looked,
and the answer is nothing." "Not computed yet" says "I have not looked, because
there is nothing to look at." Those are completely different statements, and a
tax form is exactly the wrong place to confuse them.

If a box showed `$0.00` today, you would learn the shape of the form while
quietly absorbing a number that is not true. Then in January, when real wages
start flowing, some of those zeros would become real figures and some would stay
zero — and you would have no way to tell which zeros you had been taught and
which zeros the system actually calculated. So I built "not computed yet" as its
own separate state, all the way down in the core of the engine, and I made it a
**required** field rather than an optional one. Required means the compiler
itself refused to build the app until every single place that creates a form box
had answered the question "is this a real figure or not?" There were eight such
places. All eight now answer it explicitly.

The alternative — which I considered and rejected — was to invent a fake sample
tax return with plausible-looking wages so the tabs would have something to
show. I did not do that. A fabricated figure that looks real is worse than no
figure, because you cannot tell it apart from a real one.

---

## What else was wrong, since you asked me to diagnose properly

You asked me to test everything and never assume. I did not read the code
looking for the bug — I ran the code and printed out what it actually decided.
That turned up **five** separate problems, not the one you reported.

**One. The condition I described above.** I ran the Form 941 builder with the
exact information the live system has today and printed the result: *not ok*.
Which means the explorer was never rendered. Confirmed by execution, not
inference. This was the same on three screens.

**Two. Form W-2 had no explorer at all.** Not hidden — genuinely absent. And
there was a function sitting in the codebase called `w2Boxes`, written to feed
that explorer, that **nothing anywhere ever called.** Dead code with a green
check mark next to it. Separately, the W-2 lessons that did exist taught the
form as a whole rather than box by box, which is a different kind of lesson than
the tabs need. So I wrote eight new box-level lessons for W-2 boxes 1, 2, 3, 4,
5, 6, 16 and 17, and I verified all eight quotes character-for-character against
the official IRS W-2/W-3 instructions in our document library.

**Three. The test that was supposed to catch this proved nothing.** It checked
that the page source contained the text `<FormBoxExplorer`. It did — inside a
condition that was never true. A test that asks "is this component mentioned
anywhere in the file" will happily approve a component that can never appear on
screen. That test now checks that the explorer is *not* wrapped in a condition,
that it is *not* handed an empty list, and that no form gets silently skipped.

**Four, and this one was worse than what you reported.** On the Washington
quarterly screen there was a line that said: if a form has no boxes, skip it
entirely. Sounds sensible. But the **ESD 5208B** — the wage-detail form, where
each employee's name, wages and hours are listed — legitimately has zero boxes
until there are employees to list. So that form was not merely hidden until
January. It was dropped **permanently**, including after real payroll starts. I
proved this by building a complete, valid Washington quarter with real numbers
in it and printing what each form produced: 5208A produced 3 lines, PFML 3,
L&I 4, and **5208B produced 0** while the underlying employee wage detail had a
row sitting right there. You would have filed a quarter with a missing schedule
and the screen would have looked fine.

**Five. I caught myself.** The specification I wrote for the teaching tabs
drifted from the actual calculation engine *the same day I wrote it*. Two boxes
the engine produces were missing from my list, and one box — the L&I hours box —
was labelled with the wrong kind of unit. Worse, there was a hand-written
special case in the code propping up that wrong label, a little branch that
could never actually run. That is the shape of a bug hiding behind its own
workaround. I fixed the cause rather than the symptom: instead of my teaching
notes keeping their own private copy of "whose money is this," they now read it
directly from the same tables the real forms use. There is now only one source
of truth, so this particular drift cannot happen again.

---

## How I know the fix holds

I did not just fix it and declare victory. I deliberately broke it, ten
different ways, to confirm the new tests actually notice. Ten sabotages, ten
caught, zero got through — and each one produced the *specific* error message
naming what I had broken, not a vague failure:

- Re-hide the Form 940 explorer behind the old condition → caught
- Re-hide the Form 941 explorer → caught
- Restore the line that dropped the 5208B → caught, "permanently drops the 5208B"
- Feed the explorer an empty box list → caught
- Mislabel the L&I hours box again → caught
- Delete a box from the teaching list → caught
- Reword a box caption so it no longer matches the government form → caught
- Unregister the 5208B → caught
- Put an invented dollar figure in a teaching box → caught
- Flip whose money the PFML employer box is → caught

Then the whole test suite: **447 files, 10,973 tests, zero failures.** Type
checking clean. Linting clean.

Two of those 10,973 tests failed the first time I ran them, and I want to be
straight with you about how I handled that, because it is the exact moment where
it is tempting to cheat. One was a guard that tracks the size of a page file and
noticed the W-2 page had grown — correct, I had grown it, so I updated the
recorded size. The other was pinned to the precise punctuation of a line of code
I had touched, even though the behaviour was unchanged. The lazy fix is to
loosen the test until it goes quiet. Instead I rewrote it to check the actual
behaviour, and then I **deliberately broke that behaviour** to make sure the
rewritten test still went red. It did. A test I have not seen fail is a test I
do not trust.

---

## Now — the four things you told me about your taxes

You raised these in the same message. They are not code, they are your actual
tax position, and three of the four are more consequential than they sound. I
have written all of them into the strategy file. I am flagging, not deciding,
because deciding would mean guessing.

### Your grandfather, and the distribution that did not match

You said Nicholas lets you pay him when you can, and that he understands family
comes first. That explains something that had been bothering me: the filed
return shows one distribution figure where a strict ownership split would
predict another. If he owns 5% and takes less than 5%, the arithmetic stops
matching.

Here is the thing to know, said plainly: **an S corporation is required to treat
all shareholders of the same class of stock identically when it distributes
money.** Not as a matter of fairness — as a condition of remaining an S
corporation. If distributions are persistently disproportionate, the IRS
position is that a second class of stock effectively exists, and a corporation
with two classes of stock is not eligible to be an S corporation. The
consequence of losing that eligibility is that Greenway would be taxed as a
regular corporation, which given §280E is a genuinely bad outcome.

I want to be precise about how worried to be. This is usually **fixable and
often not fatal.** The standard treatment is that the unpaid amount is recorded
as owed to him rather than forgiven — the money is his, it just has not moved
yet. That is a normal, defensible arrangement between family shareholders. What
turns it into a problem is doing it informally for years with nothing written
down, so that later there is no way to show the money was owed rather than never
allocated. **The fix is paperwork, and paperwork is cheap right now.** This is
worth twenty minutes with your grandfather and a note in the corporate records.
It is not worth losing sleep over.

### Your mother, employed so she could be on your insurance

This one I need you to hear clearly, because you described it as a favour and it
is also a tax event.

You said Theresa was an employee only so she could be on your insurance policy,
that it was cheaper through you than through her work, and that you paid her
insurance premiums as compensation for their share. Every part of that sentence
has a consequence:

- **"As compensation" is the right instinct.** Health premiums paid for an
  employee are normally tax-free to the employee. But she is also a
  **shareholder** — 5% — and she is your **mother**, and the tax code has a rule
  that says family members' ownership counts as yours for this purpose. That
  rule is called attribution. Under it she is treated as a more-than-2%
  shareholder even though she owns 5%, and for a more-than-2% shareholder the
  premiums are **not** tax-free. They belong in Box 1 of her W-2 as wages.
- **The offsetting good news:** those same premiums are then generally
  deductible on the personal return as self-employed health insurance. So this
  is frequently a wash in net tax. The failure mode is not usually "you owe a
  fortune," it is "the W-2 was wrong," and a wrong W-2 is a correctable thing.
- **She is now on Medicare and no longer employed.** That is genuinely good
  news: it means this stops going forward. It matters for the years it was
  happening, not for 2027 onward.

What I will not do is tell you which years were reported which way. I have not
seen her W-2s. I will check them against this rule the moment you send them, and
I will show you the arithmetic rather than a conclusion.

### The Fidelity HSA — please read this one before you fund 2027

You said you have an HSA for the shop, that it is your family's health
insurance, that you invest the full allowed amount every year, and that it is
connected through Plaid.

**There is a known trap here and I am flagging it rather than guessing.** For a
more-than-2% shareholder of an S corporation — which you are, at 85% — the
company cannot make HSA contributions on your behalf the way it can for a rank
and file employee. If it does, those contributions are not a tax-free fringe
benefit. They are wages: they go in Box 1 of your W-2, and you then take the
deduction personally on your own return instead.

Why this matters more for you than for most people: **§280E.** Greenway cannot
deduct ordinary business expenses. So the question of whether an HSA
contribution is a business expense or personal compensation is not academic
paperwork for you — the two paths lead to different amounts of tax. I need to
know how those contributions have actually been characterised before I say
anything definite, and I would rather ask than assume.

Concretely, I need to know: is the money going into the HSA coming out of the
business account or your personal account? Is it showing up anywhere on a W-2?
The Plaid connection means I can see the transactions once we wire that up,
which is genuinely useful — I will be able to check this against the returns
rather than take anyone's word for it.

### The QBI deduction showing $0.00

You said you would talk to your grandfather about this and that you are not
sure. Good — please do, and please tell me what he says, because there are two
completely different explanations and I do not yet know which one applies.

QBI, translated: a deduction of up to 20% of business profit that pass-through
owners like you can take on their personal return. It is one of the larger
deductions available to a business like yours, so a zero is worth understanding.

The two possibilities:

1. **It is correct and deliberate.** There is a real argument that a business
   whose income is disallowed under §280E cannot generate a qualified business
   income deduction. If your preparer took that position, the zero is a
   considered professional judgment, and I would want to respect it and
   understand the reasoning.
2. **It is a data-entry omission.** Also entirely possible, and it happens.

The way to tell them apart is not to argue about the law in the abstract — it is
to look at whether the return carries the supporting statement that a deliberate
position would produce. That is a document question, and it is one of the things
I will check when the full 2024 Form 1040 arrives. **Do not let anyone, including
me, tell you the answer before we have looked.**

---

## What I still need from you

Unchanged from last time, in order of how much they are blocking:

1. **The twelve 2027 rates.** This is the time-critical one. Your first payroll
   is 1 January 2027 and several of these are published late in the year. Every
   rate I do not have is a number the system refuses to invent — which is the
   correct behaviour, and also means the calculation cannot run.
2. **The full 2024 Form 1040** — settles the QBI question above.
3. **The depreciation schedule.**
4. **Form 7203** — your basis. This is what determines whether a distribution to
   you is tax-free.
5. **Form 2553 and the CP261 acceptance letter** — the proof of the S election.
6. **One WSLCB excise return** — any quarter, just so I can see the real format.
7. **Q3 and Q4 2026 Washington returns.**
8. **The six ATM portal exports.**

And two new ones, from this message:

9. **Your mother's W-2s** for the years she was on the insurance.
10. **How the HSA contributions were paid and reported** — business account or
    personal, and whether they appear on a W-2.

---

## One last thought

The reason this slice happened is that you looked at what I built and told me it
did not work. Every automated check said it was fine. Ten thousand tests said it
was fine. You looked at the screen and said "this is still a wall of text," and
you were right, and four more defects came out of the wall behind that one.

Please keep doing that. The tests protect against the mistakes I already know
how to make. You are the only check on the mistakes I do not.

Go click on the boxes. Every one of them will tell you what it is and where its
number comes from, and none of them will show you a number that is not real
yet.

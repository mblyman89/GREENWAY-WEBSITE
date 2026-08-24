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

I started to write you a warning here, and then I checked it against the actual
regulation and found I had it wrong. I am leaving the correction visible rather
than quietly fixing it, because you should see how this goes when it goes right.

**What I was about to tell you:** that paying your grandfather less than his 5%
share risks creating a second class of stock, which would disqualify Greenway
from being an S corporation altogether.

**What the regulation actually says.** The test lives in §1.1361-1(l)(1), and I
pulled the sentence out of the copy we hold in our own document library:

> Although a corporation is not treated as having more than one class of stock so
> long as the governing provisions provide for identical distribution and
> liquidation rights, any distributions (including actual, constructive, or
> deemed distributions) that differ in timing or amount are to be given
> appropriate tax effect in accordance with the facts and circumstances.

Read that first clause carefully, because it is the good news. The test is
**not** "were the cheques equal." The test is **"do the governing documents give
everyone identical rights"** — your charter, your articles, your bylaws, state
law, and any binding agreement about distributions. Uneven payments do **not**,
by themselves, create a second class of stock. The regulation's own worked
example has one shareholder paid a full year after another and still concludes
there is a single class of stock.

So the arrangement you described with your grandfather is not an existential
threat to your S election. I should not have implied it was.

**What the second clause does require**, and this is the part that is real: the
gap has to be *given appropriate tax effect*. Plain English: the difference
between what he was entitled to and what he actually received cannot just sit
there as an unexplained hole. It has to be characterised as **something** — most
commonly a loan from the company to the other shareholders, additional
compensation, or a gift between shareholders. Each of those three has a
different tax result, so which one it is matters.

**So the practical answer is the same even though my reasoning was wrong:** it is
a paperwork job, and paperwork is cheap right now. Twenty minutes with your
grandfather to agree what the unpaid amount *is* — money the company still owes
him is the most likely and usually the cleanest answer — and a dated note in the
corporate records saying so. What makes this messy is not the arrangement. It is
doing it informally for years and then having no way to show what the gap was.
Do it now while everyone remembers and agrees.

This same analysis is already built into the basis and AAA engine from an earlier
slice, with fourteen verbatim authorities behind it. The engine names the
variance, names the test, and states what has to be verified — it neither shrugs
nor cries wolf. I should have read my own work before writing you a warning.

### Your mother, employed so she could be on your insurance

This one I need you to hear clearly, because you described it as a favour and it
is also a tax event.

You said Theresa was an employee only so she could be on your insurance policy,
that it was cheaper through you than through her work, and that you paid her
insurance premiums as compensation for their share. Every part of that sentence
has a consequence:

- **"As compensation" is the right instinct**, and the official instructions say
  so directly. She owns 5%, which is more than 2%, so this line from the 2026
  Form W-2 instructions is about her exactly. It is item 5 in the list of things
  that must be included in Box 1:

  > The cost of accident and health insurance premiums for 2%-or-more
  > shareholder-employees paid by an S corporation.

  Plain English: for an ordinary employee, company-paid health premiums are
  tax-free and appear nowhere on the W-2. For a shareholder who owns more than
  2%, they are **wages** and they belong in Box 1. She is in the second group.
  This is not an interpretation — it is the instruction, quoted from the copy in
  our own document library.

- **This is already built and already known.** Your own W-2 has the same feature,
  and the roadmap records it as a deliberate result rather than a bug: Box 1
  legitimately comes out **higher** than Boxes 3 and 5, because §3121(a)(2)(B)
  carves these premiums out of Social Security and Medicare even though income
  tax still applies. Anyone who "fixes" those boxes to agree either overpays FICA
  or understates income. So the shape of this was handled before you asked.

- **The offsetting good news:** those same premiums are then generally deductible
  on the personal return as self-employed health insurance — **but only if they
  went on the W-2 first.** That conditional is the whole ballgame. Reporting it
  correctly is what unlocks the deduction; leaving it off does not save tax, it
  just forfeits the offset. So the likely failure mode here is not "you owe a
  fortune," it is "the W-2 was wrong and the deduction was lost."

- **One thing I am flagging rather than asserting.** There is a further rule that
  treats a family member's ownership as the owner's own for some of these tests.
  I have **not** mirrored that statute into our document library yet, so I am not
  going to state how it applies to your mother. I do not need it for the
  conclusion above — she owns 5% in her own name, which is already more than 2% —
  but I want you to know exactly where the verified ground stops.

- **She is now on Medicare and no longer employed.** Genuinely good news: it
  means this stops going forward. It matters for the years it was happening, not
  for 2027 onward.

What I will not do is tell you which years were reported which way. I have not
seen her W-2s. I will check them against this rule the moment you send them, and
I will show you the arithmetic rather than a conclusion.

### The Fidelity HSA — please read this one before you fund 2027

You said you have an HSA for the shop, that it is your family's health
insurance, that you invest the full allowed amount every year, and that it is
connected through Plaid.

**There is a known trap here and I am flagging it rather than guessing.** Let me
separate what I can prove from what I cannot, because the difference matters.

**What the instructions verifiably say.** Two sentences from the 2026 Form W-2
instructions, quoted from our document library, do most of the work:

> You must report all employer contributions (including an employee's
> contributions through a cafeteria plan) to an HSA in box 12 of Form W-2 with
> code W. Employer contributions to an HSA that are not excludable from the
> income of the employee must also be reported in boxes 1, 3, and 5.

And for money you put in yourself, outside a cafeteria plan:

> An employee's contributions to an HSA (unless made through a cafeteria plan)
> are includible in income as wages and are subject to federal income tax
> withholding and social security and Medicare taxes... Employee contributions
> are deductible, within limits, on the employee's Form 1040 or 1040-SR.

Read those together and the shape is clear. **Every** employer HSA contribution
has to show up in Box 12 with code W — there is no version of this where the
contribution is invisible on the W-2. Whether it *also* lands in Boxes 1, 3 and 5
turns entirely on one question: is it excludable from your income or not?

**Where the verified ground stops.** The rule that answers that question for a
more-than-2% shareholder of an S corporation — which you are, at 85% — is **not**
in the documents I have mirrored. The widely-followed treatment is that the
company cannot give you a tax-free HSA contribution the way it can for a rank and
file employee, so it becomes wages in Box 1 with a matching personal deduction
instead. **I am telling you that is the likely answer, and I am telling you I have
not proven it from source text.** I will mirror the governing authority and show
you the sentence before this goes anywhere near a computation.

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

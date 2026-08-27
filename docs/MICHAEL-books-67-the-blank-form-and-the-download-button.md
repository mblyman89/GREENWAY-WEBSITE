# The blank form, and the button that looked forbidden

**books-67 — for Michael Lyman, Greenway Marijuana**

You reported two things. They turned out to be the same bug wearing two costumes,
and you were right about both. Then the fix for them turned up a third problem
that no test in this system could see.

---

## Short answers first

1. **The circle with a slash was not the download button.** It was a different
   button entirely, one that is *supposed* to look disabled. The real download
   links had vanished off the page. Fixed — they are now always there, they look
   like buttons, and each one says in plain words what it is for.
2. **No, the refusal was not correct behaviour, and your instinct was right.**
   You should be able to see the form with no payroll in it, exactly like the
   others. Fixed.
3. **The ATM: you have already uploaded everything I need to start.** I checked
   all four files. There are three questions only you can answer, listed at the
   end. Nothing is blocked on more downloads.

---

## Your first report: the export button

You wrote: *"I think I see the export button for esd and pfml, the button is not
very clear it is the button to use to export the files for esd and pfml/ wa
cares, it has a circle with a slash in it when I hover over that box."*

**Here is what was actually happening, and it is worse than an unclear label.**

The two download links were inside a panel that only appeared when the quarter
had payroll figures in it. Your current quarter has none. So the panel — and both
links with it — **was not on the page at all.**

The only button-shaped thing left on that screen was one labelled *"Taking these
figures to the State"*. That button is deliberately dead. It exists to make a
point: nothing in this system files on your behalf, and it will never pretend to.
It is disabled on purpose, and being disabled it shows the "no entry" cursor —
the circle with a slash you saw.

**So you hovered the one control on the page that is designed to look forbidden,
because the two that are not were invisible.** You were not misreading the
screen. The screen was wrong.

**What it looks like now.** Both downloads are proper buttons with a download
arrow, and underneath each one, in bold: *"This is the file you upload to EAMS"*
and *"This is the file you upload to the Paid Leave portal."* They are on the page
whether or not the quarter has figures. When the quarter is empty, a blue note
explains that clicking would give you a list of what is missing rather than an
empty file — because an empty wage file uploaded to EAMS is not nothing, it is an
affirmative report that nobody was paid.

---

## Your second report: the form that would not draw

You wrote: *"the esd form page says it refuses to draw the form because there is 1
problem, no payroll yet. I just want to make sure this is correct behavior, or if
I should still be able to see the form without payroll data in it? Ideally I'd
like to see the form like all the others, even with no payroll data to fill it
with."*

**It was not correct behaviour. You should see the form, and now you do.**

Before changing anything I proved what the "1 problem" actually was, rather than
assuming. It is a refusal called `NO_SUBJECTS`, reading *"This quarter has nobody
on it at all."* Exactly one, which matches your "1 problem". That check mattered:
if I had guessed wrong and fixed a different refusal, your screen would have
looked identical and I would have reported success.

**Your instinct also matched a rule this system already had.** There is a note in
the test suite from an earlier slice that reads: *"hiding a teaching surface
behind `result.ok` made it invisible for a year."* The W-2 form page learned that
lesson and shows a blank form when there is nothing to put in it. The ESD
confirmation page, which I built last slice, did not. Same mistake, new page. So
this was not a new idea you were proposing — it was a rule already on the books
that the newest page had failed to follow.

**One important distinction I want you to know about, because it is deliberate.**
An *empty* quarter now draws the form. A *broken* quarter still refuses. Those are
different things:

- "Nobody has been paid yet" is a fact about the quarter. Safe to show blank.
- "Someone has negative wages" or "an employee has 37.5 hours when ESD only takes
  whole numbers" or "the tax rate for this quarter is missing" means something is
  genuinely wrong.

If the second kind drew a nice blank form, a real problem would be hiding behind
a page that just looks empty. So the page checks *which* problem it has, and only
"nobody here yet" earns the blank form. Everything else still stops and tells you
what is wrong.

**Every amount on the blank form is a dash, not $0.00.** This is the single most
important detail on that page. A zero on an unemployment report is a statement —
it says wages of nothing were paid and tax of nothing is owed. A dash says we
don't have an answer yet. Those must never look the same, so the blank form shows
dashes everywhere, and a blue panel at the top explains that it is blank because
no payroll has run, not because anything is broken.

The blank form uses the *same* layout as the filled one — same boxes, same order,
same labels — so you can study where everything will go before there is anything
to put there. That was the point of your request, and building it as a separate
"empty version" would have let the two slowly drift apart until the blank form
you learned from stopped matching the real form you file.

---

## The third problem, which you did not report and no test caught

After building the blank form I photographed it, because there is a standing rule
that every new screen gets looked at with human eyes once. The picture showed
this:

> **TOTAL EMPLOYEES** 0
>
> **TOTAL EMPLOYEES EACH MONTH** — JANUARY 10 · FEBRUARY 11 · MARCH 9

**The form contradicted itself.** Zero employees in the quarter, ten in January.

At that moment 11,658 tests were passing, the type checker was clean, and every
other gate was green. Not one of them was looking at this, because every test
checked one region of the page against its own inputs and none compared two
regions against each other. The monthly headcount is supplied separately from the
wage figures, so when the wage figures correctly went blank, the monthly counts
carried on reporting what they had been handed.

This matters more than it looks. Those two numbers are exactly the pair ESD checks
against each other. A report that disagrees with itself there is a report that
invites a letter.

It is fixed at the source — with no quarter, there is no headcount to report — and
there is now a test that deliberately feeds it a *full* headcount alongside an
empty quarter, which is the precise combination that caused the problem. I broke
the fix on purpose afterward to confirm the test catches it. It does.

This is the second slice running where the one required screenshot found a real
defect after every automated gate had passed. That is worth the time it takes.

---

## The ATM — what you have already given me

You asked: *"Let me know what else you need from the atm and bank atm account. I
think I uploaded everything already, but I can't remember."*

**You did upload it, and I checked all four files rather than taking your word or
mine.** Here is what is in them, measured:

| File | Rows | What it carries |
|---|---|---|
| ATM Cash Load Report | 134 | Each cash load, with terminal and running balance |
| ATM Daily Settlement Report | 116 | Daily transaction counts, surcharge, settlement |
| Funds Movement By Account By Day | 235 | Settlements split by type — the important one |
| Timberland Bank ATM Account | 301 | The actual bank account activity |

For 1 May to 23 August 2026, the funds movement file totals **$526,620.00 of
transaction settlements** against **$16,272.50 of surcharge**, and it reports
those as separate line types rather than one blended number.

**That confirms your description of the business exactly.** You said: *"the atm
fee belongs to the atm company and its chart of accounts."* The surcharge arrives
already separated in the data, which means the books can keep it out of Greenway's
revenue without anyone having to split it by hand — and that is the single thing
most likely to be done wrong, because $16,272.50 of someone else's money sitting
in your revenue would overstate your income and, under §280E, your tax with it.

The Timberland account shows the two flows you described: **230 daily settlement
credits** coming in, and **66 transfers from x6228 to x6048** going out. There are
also 3 account analysis charges and 1 EFT payment.

**Your change of practice is recorded and it matters.** You wrote: *"going forward,
I will be paying vendors and employees from the atm account via the ach feature we
built, so I won't be moving cash from the atm account to the main cannabis account
like i used to do anymore. The cash from the cannabis business will be used still
to fill the atm."* That is a real change in how the money moves, and it means the
66 transfers are a *historical* pattern that will stop. The books need to handle
both the old shape and the new one, and to know which date the practice changed —
which is one of the three questions below.

### The three things I still need, and only you can answer them

1. **The date you switch to paying from the ATM account.** Before it, transfers
   back to the cannabis account are normal. After it, a transfer back would be the
   unusual event. Without the date, the books cannot tell a routine movement from
   one worth flagging.
2. **The relationship in writing between Greenway and the ATM company** — whichever
   of the agreement, the statement, or the 1099 you have. The data shows the
   surcharge separated, but a document is what establishes *whose* money it is, and
   that is a fact about a contract, not something I will infer from a spreadsheet.
3. **Which bank account is x6048** (the transfer destination) **and x3557** (one
   transfer went there). I can see the numbers; I cannot see which of your accounts
   they are, and guessing would post real money to the wrong ledger.

Nothing else is needed to begin. **Please do not go hunting for more downloads.**

---

## On the ESD mail

You wrote: *"I will look for that mail from esd. It's not in my email so I'm not
sure. I can't find anything else online or on esd portal that would settle this."*

Then stop looking. It is not worth more of your time. That question is worth one
cent a quarter, ESD bills from its own calculation regardless, and no payment you
make is ever wrong because of it. It will most likely answer itself when a future
quarter's numbers happen to fall in the right range. If a paper statement turns up
in the post one day, glance at it — otherwise let it be.

---

## What is checked

- 11,659 tests across 472 files, none failing
- Type checking clean
- Pure self-tests all passed
- 357 authority quotes verified word-for-word against the original documents
- Linter clean, apart from one warning that predates this work
- The new blank form photographed and inspected, which is how the third problem
  was found
- Three deliberate sabotage attempts, all caught: hiding the downloads again,
  printing $0.00 instead of dashes, and reverting the monthly-count fix

---

## Next

The ATM and the Plaid connections into the books, as you asked. I have the four
files, the model you described, and the three questions above. Answer those when
convenient and that slice can run start to finish.

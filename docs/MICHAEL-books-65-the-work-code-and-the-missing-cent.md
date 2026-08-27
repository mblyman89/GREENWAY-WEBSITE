# The work code, the company data that never arrived, and the cent I finally caught

**Slice books-65 · 27 August 2026 · Greenway Marijuana**

---

## What you asked for, and where each piece landed

> *"first, please finish wa forms, tell me more better what i need to get you for
> D-10 to be resolved, find out why company data is not filling the forms even
> though it is correctly stored in company info page in accounting, and then tell
> me your plan for finishing the forms clickability thoroughness."*

| # | You asked for | Status |
| --- | --- | --- |
| 1 | Finish the WA forms | **Done** — the Washington returns now have their own "as it prints" page, reached from the WA page the same way the 941 and 940 reach theirs |
| 2 | Explain D-10 and what you must get | **Done, and the old answer was wrong** — see below. One rule *does* fit |
| 3 | Why company data never filled the forms | **Found and fixed** — D-15 |
| 4 | The plan for clickability thoroughness | **Done rather than planned** — 23 lessons written, **0** boxes left untaught on any form |
| 5 | A way to enter the ESD work code | **Done** — `41-2031` |
| 6 | D-14 — Sage is wrong | **Recorded as your decision** |

---

## Your work code is in

You said: *"for esd, they require a work code for each employee, so i will need a
way to enter that code in. the code my employees use is, 41-2031."*

There is now a box for it on the employee setup screen, and it does three things
worth knowing about.

**It never fills itself in with 41-2031.** That is a fact about your roster, not
a default for every person the screen will ever open. A code that arrived by
itself says what somebody does for a living without anyone checking, and it
would look identical to one you verified.

**Blank is allowed, and a wrong code is not.** This is the one place I did not
simply do what you said. You told me ESD *requires* a code. What the law actually
says — RCW 50.12.070(2)(a)(i) — is that you report "the standard occupational
classification **or job title**" of each worker, and ESD's own file spec says the
code column "can be only 6 digits or blank". So a blank is a lawful filing. It
warns, and tells you the cost: somebody types the job title into EAMS by hand
every quarter. A **malformed** code stops the save outright, because EAMS rejects
the whole quarterly upload over one bad row rather than just that row.

**It found a real bug before it could bite.** If you typed `4-12031`, the old
code stripped it to six digits, decided it was fine — and the database would have
thrown, because the stored column requires the hyphen in the right place. The
screen would have said saved while nothing was saved. The code now re-seats the
hyphen so what gets stored is correct by construction.

I also checked your filed Q1 return: all eleven rows carry `41-2031`. Your
answer was right.

---

## Why your company information never reached the forms

You were right that it was stored correctly, and I want to say plainly that the
green checks on your company page were not lying.

The fault was one layer further on. Your EIN, legal name, trade name, address and
city/state/ZIP were all read correctly by every form — and then had **nowhere to
go**. A value only prints if a box exists with its name, and the forms were being
built with no entity boxes at all. Five values, zero boxes, silent on every form.

Nothing was broken in a way anything could detect. Nothing threw, nothing was
empty, and no test had ever asked the one question that would have caught it:
*does every piece of company information have somewhere to land?* Both halves
were correct on their own. The gap between them is where it lived.

The 941 went from 27 boxes to 32 and the 940 from 30 to 35, measured against
your own filed returns first. A test now fails if any of the five ever loses its
home again. Recorded as **D-15**.

---

## D-10 in plain English — and I had it wrong

You asked: *"will you please clarify what D-10 means? what do i need to get for
you to make it work?"*

**What it is.** On your Q1 2026 return, ESD charged $246.12. This system computes
$246.13. One cent.

**What I previously told you.** That your UI line needed rounding down, your EAF
line needed rounding up, no single rule could do both, and Q2 could not settle it.

**That was wrong, and answering your question is what exposed it.** I re-did the
arithmetic instead of re-reading my own note. Q2 *does* settle it — and it rules
out the explanation I had offered. One reading fit Q1 and failed Q2; the other fit
Q2 and failed Q1. Which means the rounding rule was never the variable. I had
been asking the wrong question for two slices.

**What actually fits.** ESD appears to **drop the cents from your taxable wages**
before applying the rate. One rule, all four figures, both quarters:

| quarter | your taxable wages | ESD appears to use | UI @ 0.37% | ESD charged | EAF @ 0.03% | ESD charged |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 2026 | $61,531.21 | $61,531 | **227.66** | 227.66 | **18.46** | 18.46 |
| Q2 2026 | $68,923.45 | $68,923 | **255.02** | 255.02 | **20.68** | 20.68 |

Look at what that explains. At $61,531.21 the UI figure lands at 227.665477 —
just *above* the halfway point, so it rounds up to 227.67 and misses. Drop the 21
cents of wages first and it becomes 227.6647, just *below*, rounding to 227.66 —
exactly what ESD charged. That stray 0.5477 was never a rounding tie. It was 21
cents of wages that ESD had already thrown away.

**I did not implement it.** A rule that fits four numbers is a pattern, not a
published rule, and I am not computing a filed tax figure from a pattern I
inferred. I searched for an ESD publication saying so and did not find one.

### What you need to get me — any ONE of these closes it

1. **Your monthly billing statement from ESD.** Your own return says they mail
   one every month. If the taxable wage figure on it has no cents, that is the
   answer, in your own post, for free. **Start here.**
2. **Any further quarter's EAMS confirmation page.** Not every quarter decides
   it — the two readings agree about four times out of five — so one extra
   quarter has roughly a **1 in 5** chance of being decisive. Two or three make
   it likely. Costs nothing; you file them anyway.
3. **An email to the Account Management Center** — OlympiaAMC@esd.wa.gov or
   855-829-9243, both printed on your own confirmation page. Ask exactly this:
   *"When EAMS computes UI and EAF tax, does it apply the rate to total taxable
   wages including cents, or to whole dollars with the cents dropped?"* Get it in
   writing — an email is a document I can cite, a phone call is not.

**What it is worth.** One cent a quarter, four cents a year, and ESD bills from
its own computation so you never pay the wrong amount. What is actually at stake
is whether your screen agrees with your invoice to the penny — because a system
that is reliably one cent off teaches you to ignore small differences, and small
differences are how the large ones announce themselves.

---

## D-14 — recorded as your decision

> *"for D-14, sage is wrong, i need to update the formula. this is one of the
> issues we are escaping sage from. we will build a compliance cron bot that will
> poll the agencies for tax updates and such. that way our books never lie to me."*

That closes it. The 0.64% rate and $72,800 wage base on your Sage record copy are
stale; the 0.37% / 0.03% and $78,200 in this system are what ESD actually billed.
Nothing in the engine changes — it was already right. What changes is that this
is no longer an open question with two candidate answers.

The correction is yours to make in Sage: **$166.14 per quarter** of overstated UI
tax on the record copy, which is the document that would go to a CPA or an
auditor. No money was ever overpaid.

Your compliance cron bot is the right generalisation, and I have written it down
so it is not lost. D-14 is not really about one rate — it is about a rate going
stale while nothing noticed for two quarters. **It is not built in this slice**
and I am not claiming it is; it is on the roadmap.

---

## The bug five green test suites could not see

This is the part I would want to know if I were you.

The work-code feature passed everything: 11,616 tests, the type checker, the
self-tests, the quote verifier, the linter. All green. Then I took the one
screenshot the standing rules require before finishing, looked at it — and the
new box was showing **the wrong error message**. Type a bad work code and it
complained, in red, that you had no labor role. You did have a labor role. The
work code was the problem, and the screen named a different field.

The cause is worth understanding because it is a shape that recurs. Each
checklist step carries a list of fields and a list of complaints, side by side.
The screen asked "what is wrong with this box?" and got back *the first complaint
on the step* — whichever box it belonged to. For eight slices every step had
exactly one complaint, so the first one was always the right one **by accident**.
This slice gave one step a second complaint, and the accident ended.

Every gate was blind to it because every gate was looking at a correct thing. The
engine produced the right complaint about the right field. The layer beneath
copied both lists faithfully. Only the *join between them* was wrong, and it lived
in a place no test called. A photograph found in one look what five green suites
could not.

Fixed so the class of bug cannot return: each complaint now travels attached to
its own field, and if two things are wrong with one box you now see both. Logged
as **D-16**, with a test that fails if anyone reintroduces it — proven by
reintroducing it and watching the test fail.

---

## Where the forms stand

| | |
| --- | --- |
| Boxes with no lesson, across every form | **0** |
| Federal forms with clickable boxes | 941, Schedule B, 940, W-2, W-3 |
| Washington | 5208A, 5208B, PFML / WA Cares, L&I — all box-by-box, all lessons |
| Company information on the forms | Fixed (D-15) |

**Why Washington has no picture of the paper underneath.** The IRS publishes
fillable PDFs — 116 exact rectangles on the 941 — so your figures can sit in the
agency's own boxes. The two ESD PDFs have **zero** fillable fields between them,
so there is no agency answer to where a figure goes, and placing them by eye is
guessing in the one place a mistake looks completely correct. Worse: the blank
5208A that ESD publishes is the **2011 draft**. It numbers the wage lines 12, 13
and 14 and prints a $37,300 wage base. Your own filed returns number them 13, 14
and 16 with a $78,200 base. Printing your real figures onto that artwork would
produce a convincing document with the wrong line numbers on it. So you get the
boxes, the lessons and the figures — and the page says this out loud, so the
absence reads as a decision rather than as unfinished work.

---

## Deliberately not done

- **The whole-dollar rounding rule.** Not without a document. See D-10 above.
- **The compliance cron bot.** Your idea, recorded, on the roadmap, not built.
- **PDF export of the forms**, still deferred, as agreed.
- **K-1, 1120-S, 1040** — still on the back burner, as agreed.
- **L&I** has no form to render; the figures are on the Washington page.

---

## The four open questions

1. **Will you get me one of the three D-10 documents?** The billing statement is
   the cheapest and most likely to work.
2. **Do any employees use a work code other than 41-2031?** Everything is built
   per-person; I have assumed nothing beyond what your filed return shows.
3. **When do you want the compliance cron bot?** It is the right answer to D-14
   and it is a slice of its own.
4. **Sage's 0.64% — are you correcting it for the rest of 2026?** You said you
   would; nothing here depends on it, but your record copies do.

---

*Every figure in this report was extracted from your own filed documents with a
text extractor, or computed and pinned by a test. Gates at close: 471 test files,
11,618 tests, all passing; type checker clean; pure self-tests passed; 357
authorities verified word-for-word against local sources; linter clean.*

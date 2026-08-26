# The form as it would look if you were holding it

**Slice books-61 · 26 August 2026 · Greenway Marijuana**

---

## What you asked for

You looked at what I built last time and told me, plainly, that I had missed:

> "When I had asked for the physical form to be displayed on the page by itself,
> I meant literally. I am hoping that for all the various forms, I can see the
> form as it would look if I were holding it in my hand."

> "this form would get filled with real data automatically as it should, when we
> begin operations via this platform."

> "then, if i click a box or field on the actual form, the lesson would open in
> the same manor, an overlay over the form that you click to see and click to
> un see. i am a visual learner and this is the best way for me to learn."

> "i want to be able to export the form to be added to my digital records. sage
> allows me to do this and it is something we will do too. we are not a filing
> service, i agree, but being able to see and print and export a form doesnt
> mean we are a filing service."

And then you raised the bar while I was working:

> "I am hoping you are building these forms in a way that is genius and
> professional and expert. This is where you add value as if you are the one
> using this platform. How would you want and need to interact with these
> forms? I want what the cpa needs. We have many employees so that means many
> w-2s. We have multiple quarters, so that means needing forms that can produce
> those quarters or those data and such... It's meant to be a part of the
> process for bookkeeping and taxes, not just informative."

You were right, and the distinction matters more than it sounds. What I had
built was a nicely-styled *list* of the boxes on a form. What you asked for is
the form.

---

## The short version

The W-2 and the 941 now render the **actual IRS artwork** — the real lines,
the real captions, the real shading — with your figures positioned in the
agency's own rectangles. Not a lookalike I drew. The IRS's own PDF, converted
to vector artwork, with every box position measured out of the file itself.

Click any box and the lesson opens as an overlay on the form. Click it again
and it closes. Print gives you the form and nothing else — no menus, no web
page furniture.

**Along the way I found a serious defect, and then found the same defect a
second time on the other form.** That is most of what this report is about,
because it is the part you should know.

---

## The defect: your forms had no name on them

Here is what a live W-2 was producing before this slice: boxes 1 through 6,
box 16 and box 17. Eight boxes of money.

No Social Security number. No EIN. No employer name. No employee name. No
address.

The wage figures were right. Everything that identified *whose* W-2 it was, was
missing.

**Why nobody caught it:** the teaching specimen — the blank practice version —
produced all 26 boxes correctly. The specimen was the only thing ever
screenshotted, and it looked perfect. The real one looked like a form somebody
had not finished filling in yet, which is exactly what an unfinished form looks
like. There was no error, no warning, nothing red. It just quietly was not a
W-2.

Then I asked the same question of the 941, and it was worse:

| | Rectangles on the page | Getting filled | **Silently empty** |
|---|---|---|---|
| 941 page 1 | 70 | 52 | **18** |
| 941 page 2 | 35 | 3 | **32** |

Missing: your EIN, your legal name, your trade name, your address, and the
entire repeated header at the top of page 2.

**A 941 with no EIN on it is not a return. It is a page of arithmetic the IRS
cannot match to anybody.**

Both are fixed. I did not just patch the W-2 and move on — the standing rule
here is to fix the whole class of problem, not the one instance you happened to
trip over, and that rule is the only reason the 941 got checked at all.

---

## Three things I learned from your own filed return

I did not reason about how these forms should be filled. I read one you had
already filed and the IRS had already accepted — your Q2 941 — and copied it.

**1. Your EIN prints one digit per little box.** The form shows
`4 6 - 4 2 1 7 0 1 6`. That is not decoration; the PDF has a flag on the field
that says "divide this box into 9 equal cells, one character each." I found the
flag, read the cell count from the file, and divide the agency's own rectangle
by the agency's own number.

I first built this by *guessing* the character spacing from the font size. That
worked and looked fine, and I deleted it, because a guess that looks fine is the
kind of thing that silently drifts off the line on a form you file.

**2. Your legal name and your trade name are two different boxes and must stay
that way.** Your EIN was issued to **LYMAN'S MARIJUANA**. You trade as
**GREENWAY MARIJUANA**. The form has a box for each.

This is the one I would most hate to get wrong. The IRS matches a return to your
account using the EIN *plus the name control* — the first four characters of the
name the EIN was issued to. Put "GREENWAY" where "LYMAN'S" belongs and the
return does not post to your account. There is now a test that fails if these
two ever get collapsed into one.

**3. What you left blank, I leave blank.** Your filed return has an empty line
16 grid and an empty preparer block. So does this.

---

## What is deliberately blank, and why you are being told

Every single rectangle on both forms is now either filled, or **listed as
deliberately blank with a written reason**. There is no third category, because
the third category is exactly what the missing EIN was.

The blanks fall into four groups:

**A choice only you can make.** Which quarter this is. Whether you file as an
aggregate filer. Whether the IRS may speak to a third-party designee. The
software should not be picking these.

**Your signature.** The profile *does* hold your name and title, so I could
print them. I refuse to. That block sits under "Under penalties of perjury, I
declare that I have examined this return" — software should not pre-sign a
perjury declaration on your behalf. You sign it.

**The paid-preparer block.** You do not use one.

**Line 16 — and this one is a real gap you should know about.** Line 16 is the
monthly deposit liability: your tax for month 1, month 2, month 3, and the
total. It is the line your whole deposit schedule depends on.

It prints blank because **the 941 engine does not compute it.** There is no
monthly breakdown anywhere in what the engine produces — it works in quarters.
This is not a rendering problem I can fix by moving text around; the number does
not exist yet. Fixing it means changing the engine, which is a bigger job than
this slice, and I am telling you rather than quietly leaving an empty box that
looks like a styling choice.

Boxes 4, 5b, 5d, 5f, 8, 9, 11 and 15b–e are in the same position — mapped,
clickable, teachable, but never fed a figure. For Greenway most of them are
correctly empty (no tips, no sick pay, no R&D credit). Line 16 is the one that
matters.

---

## What the CPA needs — the part you pushed me on

You said "we have many employees so that means many w-2s" and "multiple
quarters". That changed the design.

**The W-2 paginates like a real run.** Your 2025 W-2s printed two to a sheet
across five sheets, in a specific order. I did not invent an order — I read the
order off your filed run and reproduced it:

> BECKER, BENOIT · BRITTON, DEE · GIOVANNINI, JOHNSON · LYMAN, SOLIS ·
> TAITAGUE, ZENGER

Sorted by surname, tie-broken by full name. The tie-break is not tidiness: you
employ two people called Michael, and without it they could swap sheets between
one printing and the next. A document that gets filed cannot move around like
that.

Nine employees gives you five sheets with the last one holding a single form —
short, never padded with a blank W-2.

**The 941 gives you two years of quarters as links.** Eight, because two years
is the IRS's own lookback window for deciding whether you deposit monthly or
semiweekly. You should be able to see the whole window at once.

**Both pages of the 941 print.** Page 2 is not optional. It carries line 16, and
a page-1-only version would look complete while omitting the part your deposit
schedule depends on.

**Export.** The print bar produces a clean PDF of the form itself via your
browser's print-to-PDF, with a sensible filename. You were right that this does
not make us a filing service — printing and keeping your own return is the
ordinary use of the document.

---

## A warning that was being computed and never shown

While wiring this up I found that the W-2 page was already *calculating* whether
your employer details were incomplete — and then throwing the answer away
without displaying it.

Both forms now say so out loud, in amber, with a link straight to the company
profile: which specific fields are missing, and that the form cannot be filed
without them. A blank name box reads as "I have not started this yet" rather
than "this is broken", which is precisely why it needs saying in words.

---

## Testing

| | |
|---|---|
| Test files | **468 passed** |
| Individual tests | **11,468 passed, 0 failed** |
| New gate | `form-facsimile-core.test.ts` (18 tests) |
| TypeScript | 0 errors |
| Linting | 0 errors, 14 pre-existing warnings (none in files I touched) |
| Verbatim quote verification | PASSED, 345 quotes proved against local sources |
| Rectangles accounted for | 70/70 · 35/35 · 94/94 — filled or reasoned |

**The new gate caught something the moment I wrote it.** It asks every form the
same question — "why is this box empty?" — and found that the 941 could answer
per-rectangle while the W-2 could only answer per-label. Same question, one form
answered, the other was silent. Now both answer.

**Four tests went red on this slice and all four were correct to do so.** Three
were counts that pin how many boxes each form emits; they went red because the
forms genuinely emit more boxes now, and I moved each pin with the reason
written next to it rather than loosening it. The fourth was a test checking that
the 941 page tells you whether you are looking at your data or a blank specimen
— it failed because the sentence got re-wrapped across two lines by the
formatter. The promise was intact; the test was reading raw source text. I fixed
the test to read it the way you read it, rather than reformat working code to
please a regex.

I also mirrored both IRS source PDFs into the repository with their SHA-256
hashes recorded, so if the IRS reissues a form the change shows up as a
deliberate act instead of a silent shift in where numbers print.

---

## Warnings I owe you

These are open items I am carrying forward, not new breakage.

**Line 16 of the 941 is not computed.** New this slice, described above. The
deposit-liability grid is blank because the engine has no monthly figures.

**The 2026 W-2 has a box we do not model.** The form splits box 14 into "14a
Other" and "14b Treasury Tipped Occupation Code(s)". We model 14a. You have no
tipped occupations so 14b is blank on a correct filing either way — but the
paper has a box the software does not know about, and you should hear that from
me.

**Lint warnings I did not cause and did not remove.** 14 across the codebase,
none in any file this slice touched. I proved they predate this work and left
them alone, because quietly tidying someone else's file is how you lose track of
what you changed.

**The IRS's own sentence omits a count.** Still open from an earlier slice — one
of the instruction passages we quote is internally incomplete. We quote it as
written, because correcting an authority is not our job.

**W-3 box 12b has no IRS instruction text to quote.** Still open. The box exists
on the form and the instructions do not discuss it.

**Nothing posts to `51000 ATM Surcharge Income` yet.** Informational. The
account exists, the B&O logic knows about your ATM classification, but no
transaction actually lands there because the ATM feed is not connected to the
books. I still have not measured whether the ATM, the intercompany rent or the
bank feeds are wired up at all — that measurement is on my list and I have not
done it, so I am telling you rather than implying it is fine.

**One open question of my own.** A box on our forms can hold money, hours or a
count — there is no "text" option, so names and addresses are modelled as counts
with the value carried alongside. It works and it is tested, but it is slightly
dishonest plumbing. Adding a proper text type would touch every form in the
system, so I did not do it quietly on a slice about rendering. Flagging it
rather than hiding it.

---

## Open questions I am still carrying

Same four, repeated because you asked me to repeat them every time until they
are answered.

**1. True accuracy versus your history of fast data entry.** You said you want
"true accuracy, not taking my bad form filling into account". I keep building
gates that compare what the system computes against what was actually filed. I
need to know how you want the disagreements handled when they show up — flagged
for you to judge, or corrected automatically with a record of the change.

**2. ATM revenue.** You answered the part I asked: the surcharge only is what
goes in the DOR portal, and the provider deposits it separately so it is easy to
track. What I still do not have is how you want the *cash* side handled in the
books — the vault load, the reload, and the reconciliation between what the
machine dispensed and what the bank shows.

**3. The other three entities.** Everything built so far serves Greenway. The
ATM company, the landholding company and your personal books all exist and none
of them has a chart of accounts wired to anything. I need to know the order you
want them in.

**4. The 1120-S, the K-1 and the 1040.** You put these on the back burner and I
have left them there. Say the word when you want them.

---

## What I would do next

Three candidates, and my preference has changed since last time.

**Line 16.** It is the one thing on these two forms that is genuinely missing
rather than deliberately blank, and it is the line your deposit schedule rests
on. It means teaching the 941 engine to break a quarter into months. I would do
this first.

**The remaining four forms** — 940, W-3, and the Washington returns — now that
the machinery is form-agnostic and proved on two. Mostly plumbing.

**The measurement of what is actually connected.** Still deferred, still the one
I keep putting off, and still the one I think is most valuable in the long run.
I do not know whether your ATM activity, your intercompany rent or your bank
feeds reach the books at all.

I lean toward line 16 first because it is a hole in something you can now see on
screen, then the measurement. But you have been clear that you want to see and
interact with the forms, so if you would rather have the other four forms next,
say so and they are next.

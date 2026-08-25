# books-60 — the 941 you can click, and four boxes I refused to teach you

## What you asked for

Three things, in your words:

> "if there are learning lessons worth adding to the federal forms as you mentioned that dont have one yet, and you believe it will be worth my while to include them, then please add them in before building the physical forms. there are some boxes that dont apply to me and so we dont need to waste time learning something that does not apply to us. only add the lesson if it will really truly benefit me."

> "then get back to work on the forms. i really want to see and interact with the forms now."

> "follow the standing rules and never guess, never assume."

Both are done. You can open the 941 as one large page and click any line to get the whole lesson without leaving the page — same as the W-2 you already have. And I added four lessons, refused to add seven, and can show you the arithmetic behind every one of those refusals.

---

## The short version

The 941 now has its own "just the form" page. There is a **View just the form →** button in the top-right of the 941 screen; that is the only way in, on purpose. Twenty-four of its twenty-seven boxes now teach when you click them. Three do not, and I left those alone deliberately.

Along the way three things went wrong and were caught. One of them was a screen of your tax data with no access check on it, and the test that was supposed to be watching had never been watching. That one is worth reading about.

---

## The lessons: four added, seven refused

You said only add a lesson if it will really truly benefit you. So I made this a measurement rather than an opinion.

The 941 had seven boxes with a specimen on screen and nothing to teach. I taught four of them.

**Line 5e** is the total of social security and Medicare. It is the box that is *double* what any employee ever saw, because it adds your half to theirs — and nothing on the form says so anywhere. That is worth knowing before you look at the number and wonder why it seems too big.

**Line 6** is the first "everything so far" line on the form. That makes it the first place a wrong figure upstream turns into a wrong figure that actually gets paid, which is a different and more expensive kind of wrong.

**Line 7** is fractions of cents, and it is the one box on your 941 that *should* be non-zero and is the one most likely to be left blank by somebody working quickly. The lesson says that in as many words, and it says it with reference to your own history of exactly that.

**Line 10** is the number your deposits get measured against. It is therefore the number that decides whether you owe a penalty, which makes it the number worth understanding rather than just copying.

And I did **not** teach lines 12, 13 or 14, because for Greenway there is nothing in them. Line 12 is line 10 minus credits you do not claim, so it is a subtraction of zero. Line 13 is copying a figure off your EFTPS record — a transcription, with no judgement in it at all. Line 14 is arithmetic on 12 and 13. Writing three lessons for those would be exactly the waste of your time you told me to avoid, so the reasons are written into the file's header where the next person to look cannot mistake the omission for an oversight.

### And four boxes on the 940 that are not yours to learn

The 940 has ten untaught boxes. Four of them I can now rule out, and not because I think so — because your own filed return says so.

Your 2025 Form 940 shows total payments to all employees of **$332,975.44** on line 3, exempt and excess payments of **$262,975.44** on line 6, and taxable FUTA wages of **$70,000.00** on line 7. At the 0.6% rate that is **$420.00** of FUTA tax for the year, and your line 13 shows you deposited exactly that, so you owe nothing and are owed nothing.

Part 5 of the form — boxes 16a through 16d, the quarterly liability boxes — prints its own rule right at the top:

> "Report your FUTA tax liability by quarter only if line 12 is more than $500."

$420 is not more than $500. Those four boxes are not yours to fill in, so I wrote no lessons for them.

I did not want that to live only in this report, so I mirrored your filed 940 into the repository as an authority, reconciled all six of its computed lines to the cent before trusting any figure from it, and wrote a test that reads the $500 sentence out of the return and proves $420 is under it. **If your payroll ever grows enough to push that figure over $500, that test fails and tells us the four lessons are now worth writing.** It defends the omission for exactly as long as the figure justifies it, which is the honest way to do it.

That is the whole to-do list moving from 17 boxes to 13.

---

## The form you can actually click now

The new page is at the same place as the W-2's, one level under the 941: a large page with nothing on it but the form. Click any line number and the entire lesson opens in place — plain English, where the figure comes from, how to read it, the common mistake, the worked examples and the verbatim IRS instruction. You are never taken to the learning centre, because you said you did not want to be.

The tabbed 941 screen you already have is **untouched** apart from the one button I added to its header. You said you liked it and asked me not to change it, so the checks, the confirmation panel and the deposit schedule are all exactly where they were.

Two things about what it shows you. Until January 2027 there is no payroll, so the page falls back to the blank IRS form and says so in a line under the header. Every figure on it reads "not computed yet" rather than $0.00, because a zero on a 941 is a statement to the IRS and an absence is not. And if the database cannot be read at all, the page says *that* instead — it does not quietly show you the blank form, because a screen full of specimen figures that looks like your return is the one thing this page must never do.

### Why the 941 and not the 940 or the W-3

Not arbitrary. When the W-2's sheet shipped in books-58 I told you honestly that the "not taught yet" marker could not be proved, because the W-2 has no untaught boxes — so the marker sat there looking finished with nobody able to demonstrate it works. Our own rules call that out: an unreachable guard is an untested guard.

The 941 has three untaught boxes, so it is the first screen where both states appear together and the marker stops being a claim.

---

## Three things went wrong. The second one is the one to read.

### One: I pasted quotes that were not quotes

I appended the four new lessons with a script, and the IRS text I pasted into them carried the line breaks from the source document straight into the code. The file would not even compile — which is the good outcome, a loud failure rather than a quiet one.

But fixing the line breaks was not the real repair. When I wrote a script to fix them properly, and made that script refuse to write anything it could not find *verbatim* in the mirrored IRS instructions, **three of my four quotes failed.** Not the escaping — the words. I had written "6. Total taxes before adjustments." with a lower-case title and a full stop. The IRS prints "6. Total Taxes Before Adjustments" as a heading, title-cased, no full stop. Same mistake on line 10. And on line 5e I had broken the sentence in the wrong place and dropped its last clause entirely.

Four quotes, three wrong. Every one of them would have looked completely authoritative to you.

So the fix was to stop typing them at all. The repair script names a line range in the mirrored file, slices the text out of it, proves the slice starts with the box it claims, proves it is present in the file, and only then writes it. Nothing about the words passes through my hands.

### Two: a page of your tax data with no lock on the door, and a test that had never checked

This is the one I want you to see, because it is the third time this exact shape has bitten us.

I wrote a gate that said "the sheet page must guard access", and it worked by searching the file for `requireBooksAccess`. Then, testing whether my own gate could fail, I deleted the actual access check out of the middle of the page — leaving a screen of your payroll and tax figures with no permission check on it whatsoever — and **every test stayed green.**

The reason is embarrassing and simple. The file still had the line at the top that *imports* `requireBooksAccess`. My gate found that word, was satisfied, and reported the page as guarded. It had never been testing the guard. It had been testing an import.

This is the same failure as the one in the last slice, where a refusal test passed because a completely different error message happened to contain the word I was grepping for. A test that matches *text* rather than *behaviour* will eventually match the wrong text. Three times now.

The fix was not a cleverer search. There was already a function in this codebase built for exactly this — it strips comments first and requires an actual call with its brackets, not a mention — and it even carried a comment warning about this hazard. It existed and I had not used it, which is worse than it not existing, because anyone reading my test would assume the check was being done.

I repaired it, repaired the identical assertion on the W-2's page, and then ran the mutation against the W-2 as well, to prove the fix had actually reached the other file instead of only the one I was working in. It had.

### Three: a gate that protected one form and would have protected only ever one form

The sheet tests named the W-2 by file path. That was fine when there was one sheet. Adding the second one showed what it cost: the 941's page could have shipped with no door, no access check, no fallback and no honesty line, and every test would have stayed green, because nothing was looking at it.

So those tests now *find* the sheet pages by walking the folders and hold every one of them to the same seven promises. The third form gets all of it for free by existing. And the discovery itself is checked — it must find at least two, and it must find the two we know about by name — because a search that silently matches nothing passes forever and proves nothing.

This is the same shape as the "56 ties" number I got wrong and corrected for you a few slices ago: counting part of a thing while describing all of it.

---

## What I did to the report I already gave you

books-58's report told you the teaching to-do list was "17 boxes across two federal forms", and there was a test pinning that 17. Teaching four of them made that test go red, correctly.

The easy fix was to change the 17 to a 13. I did not, because you have the PDF of that report. Quietly editing the markdown would leave you holding a document that disagrees with the code and no way to tell which one had lied to you.

Instead the original sentence stays exactly where it was, with a dated correction underneath it explaining that four were taught and three were deliberately left. The test now requires **all three** at once: the old figure must still be on the record, the correction must be there, and the corrected number must match what the code actually produces. It is now a standing rule.

---

## Testing

Every new gate was mutation-tested — I broke the real thing in the real file and confirmed the suite noticed.

On the 941 sheet: removing the door, deleting the access check, removing the specimen fallback, removing the read-failure branch, rewording the "not computed yet" honesty line, and adding a navigation link to the component that is forbidden to navigate. **Six of seven caught on the first run; the seventh was the access-check escape described above, and it is caught now.** Plus the same access-check mutant run against the W-2 to prove the repair reached it.

On the mirroring of your filed 940: falsifying a line so the reconciliation fails, and rewording the $500 sentence so it is no longer verbatim. **Both refused to write anything.** On the four new lesson gates: reworded threshold, lowered threshold, wrong file path, and a fifth box added to the protected list. **All four caught.**

Every mutated file was restored and checked byte-for-byte by checksum afterwards.

---

## Where things stand

| | |
|---|---|
| Type checking | 0 errors |
| Linting | 0 errors, 1 pre-existing warning (below) |
| Test suite | see the closing note — full battery re-run on this slice |
| Verbatim quote verification | PASSED, 345 quotes proved against local sources |
| Form 941 boxes | 27 total · 24 teach · 3 left untaught on purpose |
| Teaching to-do list | 13 boxes, down from 17 |
| Sheet views built | 2 of 6 forms (W-2, 941) |
| New standing rules | 116, 117, 118, 119 |

---

## Warnings I owe you

These are open items I am carrying forward, not new breakage.

**A lint warning I did not cause and did not remove.** `w2ChecksInOrder` is declared and never used in the W-2 page. I proved it predates my work and left it alone, because quietly tidying someone else's file is how you lose track of what you changed.

**The IRS's own sentence omits a count.** Still open from an earlier slice — one of the instruction passages we quote is internally incomplete. We quote it as written, because correcting an authority is not our job.

**W-3 box 12b has no IRS instruction text to quote.** Still open. The box exists on the form and the instructions do not discuss it.

**Nothing posts to `51000 ATM Surcharge Income` yet.** Informational. The account exists, the B&O logic built last slice knows about your ATM classification, but no transaction actually lands there because the ATM feed is not connected to the books. I have not measured whether the ATM, the intercompany rent or the bank feeds are wired up at all — that measurement is on my list and I have not done it, so I am telling you rather than implying it is fine.

---

## Open questions I am still carrying

Same four, repeated because you asked me to repeat them every time until they are answered.

**1. True accuracy versus your history of fast data entry.** You said you want "true accuracy, not taking my bad form filling into account". I keep building gates that compare what the system computes against what was actually filed. I need to know how you want the disagreements handled when they show up — flagged for you to judge, or corrected automatically with a record of the change.

**2. ATM revenue.** You answered the part I asked: the surcharge only is what goes in the DOR portal, and the provider deposits it separately so it is easy to track. What I still do not have is how you want the *cash* side handled in the books — the vault load, the reload, and the reconciliation between what the machine dispensed and what the bank shows.

**3. The other three entities.** Everything built so far serves Greenway. The ATM company, the landholding company and your personal books all exist and none of them has a chart of accounts wired to anything. I need to know the order you want them in.

**4. The 1120-S, the K-1 and the 1040.** You put these on the back burner and I have left them there. Say the word when you want them.

---

## What I would do next

Two candidates, and I have a preference.

The **940's sheet view** is the cheap one — the pattern is now form-agnostic and proved on two forms, so the third is mostly plumbing, and it would give you a clickable 940 with the four boxes we agreed not to teach visibly marked as not applying to you.

The **measurement of what is actually connected** is the more valuable one, and it is the one I keep deferring. I do not currently know whether your ATM activity, your intercompany rent or your bank feeds reach the books at all. I have found one thing already by accident — nothing posts to the ATM income account — and I found it while looking for something else. I would rather go looking on purpose.

I lean toward the measurement, because building a fourth beautiful form on top of books that may not be receiving real transactions is the kind of thing we would both regret later. But you said you want to see and interact with the forms, so if you would rather have the 940 first, say so and it is next.

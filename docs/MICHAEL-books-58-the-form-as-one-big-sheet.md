# The W-2 as one large page — nothing on it but form

**Slice books-58 · for Michael Lyman · Greenway Marijuana**

---

## What you asked for

> "Even with the tab system, there is walls of text and information. I like it how it is and rather than updating or changing any of it, I want to simply add a way to display the form in one large page with nothing on it but form. And every box/field that has already been mapped to its learning lesson, when clicked, should show an info box with all of the lesson displayed. I don't want to be redirected to the learning center, but have the lesson brought to me on the form page."

And then, when I asked two questions before starting:

> "I agree, let's do the w-2 first, then the remaining once we have proven the concept. For the second question, I also agree, visually marked as not taught yet is great and makes sense to me."

That is what got built. It is the W-2 only, on purpose, because you said to prove the concept on one form first.

---

## Where it is

Go to the W-2 screen you already know — the one with the tabs. In the top right of its header there is now a small link, **"View just the form →"**. That is the only change to that screen. Everything else on it is byte-for-byte what it was.

The link opens a new page that has the form on it and essentially nothing else. A title, a count of boxes, and then the boxes. Click any box and the entire lesson for that box opens directly underneath it, in place, on the same page. Click it again, or click Close, and it collapses. You are never taken anywhere.

Boxes that have no lesson written yet are marked, in words, **"not taught yet"**, and are drawn with a dashed outline rather than a solid one. They are deliberately not clickable, because a box that looks clickable and does nothing when you click it reads as a broken app rather than as an honest gap.

There is a second, different marker: **"not used"**. That one is a statement about the IRS form, not about our teaching. More on that below, because it turned out to be the most interesting thing in this slice.

---

## The two real defects this slice found in its own work

I want to be plain about these, because both were mistakes I made and both were caught by running the code against the real forms rather than against the examples I had written for it. Neither was caught by thinking harder. That is the useful lesson.

### One — W-2 box 9 nearly lost its lesson

The W-2 has a box 9. The IRS still prints it, and the caption it prints is literally "(not used)". Box 9 once carried an advance Earned Income Credit payment, that programme ended, and the box was left on the form. The entire IRS instruction for it is one sentence: do not enter an amount in box 9.

We already have a lesson for it. It is called "The box that must stay empty."

My first version of this feature had three states a box could be in: it teaches you something, it has no lesson yet, or the form does not use it. It checked "does the form use it" first. So box 9 was classified as unused, and being unused meant not clickable — and a lesson we already own, on a box where the correct entry is *nothing*, would have become unreachable on the new page. That is exactly the sort of box this whole product exists for. The instinct to be helpful and put a number in an empty box is how filing errors happen, and the lesson that talks you out of it would have been the one hidden.

The root cause was not the ordering of the check. It was that I had squashed two completely separate questions into one answer:

- *Does the form use this box?* — a fact about *the IRS form*. Settled, permanent.
- *Has anybody written the lesson yet?* — a fact about *our software*. Pending, and an admission.

A box can be any combination of those two, and box 9 is the combination my design could not express: not used, and taught. They are now carried as two separate facts, and neither one is allowed to overrule the other. So box 9 shows the grey "not used" badge, and is still fully clickable, and its lesson opens like any other. It is also kept out of the coverage denominator, so it does not sit on our to-do list forever as a lesson nobody should ever write.

### Two — half the forms were sitting under a heading that lied

The page groups boxes into sections. My first version split them by "is the box labelled with a single letter" — because on the W-2, boxes a through f are the identification block at the top and everything else is numbered. It headed the second group **"The numbered boxes."**

That is true for the W-2. It is false for half of what we have:

- The W-3 does not have a plain box "b". It has three — kind of payer, kind of employer, third-party sick pay — plus a contact block at the foot. None of those is a single letter, so all four were filed under a heading promising numbers.
- The four Washington forms have **no numbered boxes at all**. Their fields are named things like `lni-hours`, `esd-ui`, `pfml-employee`. Every box on every one of them would have appeared under "The numbered boxes."

So: four forms plus part of a fifth, mis-headed, on a page whose entire purpose is to be trustworthy enough that you copy figures off it onto a government portal. The split now asks the only question that is answerable for every form without me maintaining a per-form table — does the label start with a digit — and a section with nothing in it is not drawn at all. A form of purely named fields simply has one section, correctly headed.

Neither of these was visible from the W-2 alone, which is the argument for the way the code is now built: it walks all eight forms we teach, so the ninth form runs through every check without anybody remembering to add it.

---

## The thing you approved that could not have worked as asked

You said marking untaught boxes "is great and makes sense to me," and you asked for the W-2 first. Those two instructions quietly conflict, and I measured before building rather than discovering it later.

The W-2 has 26 boxes and **all 26 are taught.** So on the form you picked, the "not taught yet" marker can never appear. Not because it is broken — because there is nothing for it to mark.

That matters more than it sounds. A feature that cannot be reached cannot be tested, so it sits there looking finished until the first day it is genuinely needed, and that is the day you find out whether it works. Our standing rules call this out specifically: an unreachable guard is an untested guard.

So the new code is form-agnostic from its first line, and the marker is proved against the forms where it is reachable *today*:

| Form | Boxes | Taught | Not taught yet |
|---|---|---|---|
| Form W-2 | 26 | 26 | **0** |
| Form W-3 | 31 | 31 | 0 |
| Form 941 | 27 | 20 | **7** — 5e, 6, 7, 10, 12, 13, 14 |
| Form 940 | 30 | 20 | **10** — 4, 6, 11, 13, 14, 15a, 16a–16d |
| ESD 5208A | 3 | 3 | 0 |
| ESD 5208B | 4 | 4 | 0 |
| PFML / WA Cares | 3 | 3 | 0 |
| L&I quarterly | 4 | 4 | 0 |

The marker is proved working on the 941 and the 940. The W-2's zero is *also* pinned by a test — so if a box is ever added to the W-2 without a lesson, that test goes red and somebody makes a deliberate decision instead of it slipping through.

That table is also your real to-do list for teaching: **17 boxes across two federal forms.** Everything else we teach is complete.

### Updated in books-60 — four of those seventeen are now taught

The table above was true the day it was written and I am leaving it exactly as it was, because a report that silently rewrites itself is a report you cannot check. Here is what changed afterwards.

You told me to add lessons only where they would "really truly benefit" you, and you said plainly that some boxes do not apply to you and we should not waste time on those. I took that literally. Of the 941's seven untaught boxes I taught four — 5e, 6, 7 and 10 — and deliberately left 12, 13 and 14 alone, because for Greenway line 12 is a subtraction of zero, line 13 is copying a number off your EFTPS record, and line 14 is arithmetic on the two. There is nothing in them to learn.

So the current figures are **Form 941: 27 boxes, 24 taught, 3 not taught (12, 13, 14)** and the standing to-do total is **13 boxes, not 17.**

The 940's ten are unchanged so far, but four of those ten I can already tell you do not apply to you, and I know it from your own filed return rather than from an opinion. Your 2025 Form 940 shows total payments of $332,975.44 on line 3, exempt and excess payments of $262,975.44 on line 6, and taxable FUTA wages of $70,000.00 on line 7 — which comes to $420.00 of FUTA tax for the year. Boxes 16a through 16d are the quarterly deposit-schedule boxes, and they only start to matter once the liability crosses $500. At $420 you are under it, so those four boxes are not yours to learn. If your payroll grows enough to push that figure over $500 the answer changes, which is exactly why I am giving you the number and not just the conclusion.

---

## A pre-existing gate caught me building a room with no door

This is my favourite thing that happened in this slice, and it is worth you knowing about because it is the system defending you from me.

I built the new page. It had a link back to the W-2 screen. It did not have anything linking *forward* to it. So it existed, worked perfectly, passed every test I had written — and you would never have found it. There was no way to reach it except by typing the URL.

The full test suite caught it within the hour. A gate written in an earlier slice, about navigation, failed with this message:

> "owner-only pages that are not in the menu and not on the known list. Each one is a decision nobody made: /admin/books/form-w2/sheet"

*"Each one is a decision nobody made."* That is exactly what it was.

This is the same failure you reported yourself back in books-49, in your words at the time: *"I am unable to see or use the tab system."* A finished surface, invisible, because nothing led to it. That gate exists because of that report, and it just earned its keep.

The fix is the "View just the form →" link, which is the *entire* change to your existing W-2 screen. I also added a new test that asserts the door is there — because the navigation gate now has this page on an approved list of "pages allowed to be absent from the menu," and that permission is only honest while a link exists somewhere else. Without the new test, someone tidying that header a year from now would delete the link, both gates would stay green, and the page would go invisible again. Now it goes red.

---

## What I did not touch

You said "rather than updating or changing any of it," and I took that literally.

- `FormBoxExplorer` — the tab system — **unchanged.**
- The existing W-2 page — **one 12-line addition**, the link, and nothing else.
- Every other form page — **unchanged.**

There is a test that asserts the old page and the explorer contain no reference to the new component, so the two surfaces cannot quietly grow into each other.

The new page also shares the lesson renderer with the existing tab system rather than having its own copy. That is deliberate: if there were two renderers, the next time a field is added to a lesson it would show up on one screen and silently not on the other, and there would be no way for you to know that is what happened. One renderer means a new field either appears everywhere or nowhere.

---

## Proof, not assertion

Everything below was measured in this slice, not remembered.

- TypeScript compile: **0 errors**
- Lint: **0 errors**
- Full test suite: **463 files, 11,314 tests** — the one failure was the navigation gate described above, now fixed and green
- New tests added: **64** in the gate, plus **35** self-tests inside the logic itself
- Verbatim authority check: **345 quotes verified** against local copies of the statutes, 0 failures

### The tests were attacked before being trusted

A test that cannot fail is worse than no test, because it looks like protection. So I deliberately broke the code in six specific ways and confirmed each one turns something red:

| Deliberate break | Caught? |
|---|---|
| Make unused boxes unclickable — the box-9 defect, restored | ✅ 4 tests red |
| Revert to the single-letter grouping — W-3 and Washington mis-headed | ✅ 6 tests red |
| Let a lesson from one form attach to another form's box | ✅ 3 tests red |
| Delete the "not taught yet" wording | ✅ 1 test red |
| Make the sheet navigate away instead of opening in place | ✅ 1 test red |
| Delete the "View just the form" link — the door | ✅ 1 test red |

Six out of six caught. Baseline restored afterwards and verified by checksum, so nothing from that exercise is left in the code.

---

## Pre-existing warnings — the standing list

Per your standing request, everything already known and open, whether or not this slice touched it:

| # | What | Status |
|---|---|---|
| Lint | `w2ChecksInOrder` declared and never used in the W-2 page | **Open, pre-existing.** Verified by stashing my changes and re-running lint — it is not mine. It is a computed list of reconciliation rows that stopped being consumed at some point. I did not remove it in this slice because deleting a symbol on a screen you rely on is not a change to bundle into a UI slice. Flagging it for a deliberate decision. |
| #5 | An IRS instruction sentence of ours omits a count that the IRS's own published sentence also omits | **Open, and not fixable by us.** Their text is what it is; we quote it verbatim rather than correcting it. |
| #8 | W-3 box 12b has no IRS instruction text to quote | **Open, and not fixable by us.** The IRS publishes none for that box. |
| M11 | A mutation that drops a subject phrase survives, because 24 authorities legitimately omit one | **Closed as documented** — investigation written up in `docs/books-56-m11-investigation.md`. |
| M19 | A test pin loosened from "exactly 4" to "not zero" | **Closed as equivalent** while exactly 4 lessons exist. |
| 17, 25 | Earlier warnings | **Closed** in books-56/57. |
| CI gap | | **Closed.** |

Nothing new was opened by this slice.

---

## Open questions — carried forward, still yours to answer

These stay in every report until you tell me otherwise.

1. **Your W-2s and W-3.** You produced all of them yourself, and you have said you believe you did it wrongly. Every lesson we write rests on the legal authoritative text rather than on those forms, per your instruction — *"I want true accuracy, not taking my bad form filling and calling it source material."* Nothing in this slice changed that.
2. **The 17 untaught boxes.** 7 on the 941, 10 on the 940. Do you want those written next, or after the DOR work?
3. **Whether the sheet view should spread now.** The concept is proven on the W-2. The 941 is the most valuable next one, because it is where the "not taught yet" markers actually appear.

---

## What I believe comes next, and why I am stopping to ask

Your instruction was explicit about the order:

> "After we do that, I want to add the wa dor page with all its verbatim authoritative text and plain English explanations, then the learning lessons for it, same as all the other forms. Then we will build the physical form for it in the same way we are are building all forms. ATM revenue maps to dor form. So I want it ready to take that data."

So the plan is the WA DOR Combined Excise Tax Return, in that order: authoritative text first, then plain-English explanations, then the box lessons, then its sheet view. The DOR form currently has **zero** lessons and is not in the taught-forms list, so this is a from-scratch build — meaningfully larger than this slice was.

Two things I want your call on before I start, because they change the size of it:

- **The DOR return is not one form.** It has a business-and-occupation section, a retail sales section, and the cannabis excise piece, and Greenway touches all three. Do you want all three sections in one slice, or B&O first as its own provable slice?
- **"ATM revenue maps to dor form."** I want to make sure I build the right shape, so: is the ATM revenue you mean the *surcharge fee income* the machine earns, or the *gross cash dispensed* moving through it? Those land in completely different places on a B&O return, and I will not guess between them.

I am stopping here rather than starting, per your rule that a slice which grows because of what it finds is a reason to pause and refocus. This one found two real defects in its own design and one unreachable page, all fixed and pinned — that is a good place to stop and check the direction with you.

---

**Committed and pushed.** Branch `books-55-56-w3-and-wa-forms`. `main` untouched, no pull requests opened.

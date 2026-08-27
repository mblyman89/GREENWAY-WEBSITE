# books-73 — The books get their own category list, and my answer on the 6228 question

**For:** Michael Lyman, Greenway Marijuana
**Date:** 2026-08-27
**Commit:** see the end of this report

---

## What you asked for, and what you got

You answered three questions and asked me one. Here is each, and what happened.

**You said: "the ledger should use its own accounts and not the website map."** That is now built. The books have their own category list, completely separate from the website menu. Four products now land in the account they deserve instead of being lumped in with their cousins. RSO stops being filed under Concentrate and gets its own account. Tincture stops being filed under Edible (Liquid). Infused Blunt stops being filed under Infused Preroll. Blunt stops being filed under Preroll. That moves **$6,900.07** across 147 rows into four accounts where you can actually see it. When you ask "how much of my money is sitting in RSO," the books will now answer, instead of burying it inside a bigger number.

**You said: "keep both layers."** Done, and here is the good news: nothing had to change. The builder I wrote last slice already keys on the product `Id`, never on the barcode, so the six barcode groups that carry two different costs keep both costs. Your answer confirmed the build instead of correcting it. I have written it down in the record so nobody ever "helpfully" averages them later.

**You said: "we are not ready to migrate inventory over yet."** Understood, and nothing was built toward it. What matters is *how* I recorded that. The books' own honesty tracker still shows the inventory-loading path as MISSING, but it now says MISSING **because you told me to wait**, with your words attached. That is the difference between a gap somebody forgot and a gap somebody chose. When you are ready, we build it, and the tracker will say so.

**You asked me for a professional opinion on the 6228 question.** That is the biggest part of this report and it is below.

---

## My recommendation on the 6228 vendor payments

The question: when you pay a vendor out of the ATM account (6228) for something that is not an ATM expense, are the books recording money one company **owes** another, or money you **put into** the company permanently?

I did not want to answer that from theory, so I measured your actual Sage books first — all 288 accounts and all 550 expense rows, $368,276.34 of real spending. Four things came back that decide it.

**Your Sage books have no due-to/due-from account at all.** In 288 accounts there is not one. So today, money crossing between your companies has nowhere correct to land.

**Meanwhile, money is already crossing between your companies — a lot of it.** 121 expense rows totalling **$61,109.02** are LYMAN-suffixed expenses paid out of GREENWAY's cash. Maintenance $40,206.79, utilities $10,743.08, property tax $10,159.15. This is not a hypothetical future problem. It is 22% of your expense dollars, happening now, with no account built to hold it.

**Your books already treat the companies as real counterparties.** You have `70000-GRNWY RENT` as an expense and `52000-LYMAN RENT` as income. Greenway pays rent, the property company earns it. Companies that invoice each other have balances with each other.

**And your owner money is already sitting in equity.** `41000-GRNWY WITHDRAWALS - LYMAN` carries **$141,904.95 across 87 rows** — the single largest account in the whole export.

**So my recommendation is `36000` — record it as one company owing the other, not as a capital contribution.** Four reasons, strongest first.

**One, it is the mistake that is cheap to fix.** An amount one company owes another is a balance that gets settled or written off later, in plain view. A capital contribution permanently changes your basis in the company that paid, and permanently changes the equity of the company that benefited. If we call it a loan and it was really a contribution, we reclassify one balance at year end with your CPA over coffee. If we call it a contribution and it was really a loan, unwinding it can mean amended returns. When a default has to be picked, pick the reversible one.

**Two, it matches how your own books already behave.** Rent flows between the companies as expense and income. Recording that same relationship as equity somewhere else would have your books telling two different stories about the same arrangement.

**Three, a capital contribution means something specific, and this probably is not it.** A contribution is money you put IN to fund a business. These payments are the ATM company's cash paying somebody *else's* bill. Nothing was contributed to the ATM company — it paid out on another company's behalf. That is the dictionary definition of a "due from."

**Four, it is the only version that keeps your four companies auditable on their own.** As an LCB licensee you need Greenway to stand up to inspection by itself. Recording both sides as an intercompany balance keeps each company's expenses in its own P&L and each company's obligations on its own balance sheet. Running it through equity erases the trail.

**Three things this recommendation deliberately does NOT do,** so you know exactly what you are agreeing to if you agree.

It does not post anything. Nothing is wired. This is advice about which account a future rule should name.

It does not touch the $141,904.95 in WITHDRAWALS. That is a bigger and separate question — distributions from an S-corp have their own basis and reasonable-compensation consequences, and it needs your CPA and the K-1 work we have on the back burner. I am not quietly folding it in here.

It does not restate the $61,109.02 of LYMAN expenses already paid from Greenway cash. Same pattern, same logic, but that is history, and rewriting history is your call with your CPA, not mine.

**What I need from you to actually close this — one sentence.** Is money that one of your companies spends on another's behalf **expected to be paid back or settled up**? If yes, `36000` is right and I will build the rule. If it is **not** expected to come back, then it is a contribution or a distribution and the rule is different. Until you tell me, the books keep refusing to post it rather than guessing, and my recommendation sits on the record as a recommendation — not as a decision I made for you.

---

## The honest part: two numbers that look wrong and are not

Your Cultivera export contains **52** different product categories. My new list has **53** entries. That gap is not a bug and I did not paper over it.

The extra entry is **Trim**. You had zero trim in that export, but trim is a real category with a real account (`20040`), and the website already knows about it. If I left it out, the first time trim came through the door the books would refuse it and you would get a phone call. So I mapped it in advance and then made the code *state* what it did: it publishes "52 measured, 1 mapped-ahead" as two separate numbers, and a test fails if either one is ever quietly changed. Nobody will find 52 and 53 sitting next to each other in a year and wonder which is the lie.

**Five accounts are deliberately empty:** Preroll Pack, Infused Preroll Pack, Accessories, Paraphernalia, and Merch. No Cultivera category in your export belongs to any of them, so nothing routes there. The accounts exist and are ready, but I refused to point anything at them without a real row to justify it. Guessing there would put money in an account for no reason.

**There is no catch-all account, on purpose.** The website has one, because an unlabelled product still has to show up on the menu. The books must not have one, because a catch-all in the books silently makes an account balance wrong and everything still adds up. So if a category shows up that the books have never seen, they stop and name it out loud. A test enforces that no catch-all can ever be added.

---

## The trap that would have moved $19,547.49 and balanced perfectly

This one is worth understanding because it is exactly the kind of error that hides forever.

Cultivera gives every product a `Category` and an `InventoryType`. For **Infused Pre-roll**, 532 of its 617 rows carry an `InventoryType` of "Concentrate for Inhalation." An infused pre-roll is obviously not a concentrate. But if the books had sorted by `InventoryType` instead of `Category`, **$19,547.49** would have landed in Concentrate instead of Infused Preroll — **and every single report would still have balanced.** Your totals would be right, your assets would be right, and one product line would be quietly overstated while another was quietly understated, forever.

So this is not a comment in the code hoping somebody reads it. The code physically accepts `InventoryType` as an input and never uses it to decide anything. If the category is missing and only the type is available, the books refuse — and the refusal message names both account numbers and both row counts, so when you see it you can see exactly which shortcut was being attempted and what it would have cost. You told me you are a visual learner, and that message is written for you rather than for a developer.

---

## How I proved it, including where I was wrong

Two independent test suites, then I attacked my own code on purpose.

I wrote **39 deliberate sabotages** of the new file — reverting each of your four overrides back to the website grouping, breaking the account numbering, turning the refusals into silent catch-alls, making `InventoryType` override `Category`, falsifying the honest counts, dropping a real category. Then I ran the tests against each one. If a test does not catch a sabotage, the test is decoration.

**The first run scored 34 sabotages, 30 caught, 4 escaped.** Here is what escaped and why it matters.

Two escaped because they were **guards nothing could ever reach.** I had written protection against two future mistakes — someone adding the same category twice with different accounts, and someone pointing a category at an account that does not exist. Both are worth guarding. But my current list has neither problem, so no possible input could ever make those guards fire. Correct code that cannot run is not protection. It is decoration, and one of your standing rules says so in capital letters. I fixed it by letting the tests hand the function a deliberately broken list, so the guards get exercised for real while the code that runs on your actual data is the identical function.

The other two escaped because **my tests were weak, not because the code was wrong.** One sabotage let `InventoryType` override a perfectly good `Category` and my test did not notice, because I was only checking the account number in one narrow case. Now the test compares the entire result for all 53 categories against four different misleading `InventoryType` values. The other stripped the teaching numbers out of that refusal message and no test cared, because I had never asserted the message actually teaches anything. Now it pins all four numbers.

After fixing those and re-aiming, two more escaped, and both were real gaps too — one made the code report the wrong evidence label on a tie, and one let an extra category sneak in through the front door that no test was watching. Both now have named tests.

**Final score: 39 sabotages, 39 caught, 0 escaped.**

**And a note on process, because last slice I corrupted my own file doing this.** The campaign script now refuses to start if another copy is running, and it checks that every single sabotage actually matches the file *before* changing anything. That second check earned its keep immediately: after I reorganised the code, three of my sabotages no longer matched anything, and the script **refused to run at all** rather than print a clean sweep over three tests that were secretly doing nothing. That is precisely the false "all clear" that made last slice's first campaign worthless. The file is also hash-checked after every restore, and it came out byte-for-byte identical to how it went in.

---

## Where the books stand

All five checks green: **480 test files, 12,109 tests, 0 failures.** Type checking clean, code style clean, all 357 verified legal quotes still verified, and the honesty tracker regenerated and current.

**What is real:** the books now have their own category list, separate from the website, with your four overrides applied. It converts a product category into the right account, refuses anything it has not seen instead of guessing, and cannot be edited to add a catch-all without a test failing.

**What is still not wired:** nothing loads inventory yet. You said you are not ready, so I did not build it, and the tracker says MISSING with your words as the reason.

**What is waiting on you:** one sentence on whether money spent between your companies is expected to come back. That closes the 6228 question and unlocks the intercompany rule.

**What is still deliberately unanswered:** the rounding question (D-10) stays open and uninvented, per your standing rule. I have not touched it.

---

## The one thing to do next

Answer this: **when one of your companies pays a bill for another one, do you expect that money to be paid back or settled up between them?**

Yes or no is enough. If yes, I build the intercompany rule against account `36000` and the four companies stay cleanly separable. If no, we treat it as a contribution or a distribution and I will tell you what changes about your basis before anything gets built.

Everything else is on track for your dates. Count on October 31 after close, load on November 1 before open, run parallel with Sage to year end, and we look hard at whether Sage still earns its keep.

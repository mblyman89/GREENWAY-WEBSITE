# Battle-Testing Greenway: How to Try to Break Your Own System

**Written for Michael Lyman. No jargon. No assumptions.**

You said something important: *"I am not a dev, an expert, a tester, a coder, or technical in any way. I know how to use a back office system in an ordinary everyday way. Edge cases are usually found by us when they occur, I do not know how to spot a possible failure or collision."*

That is the correct starting position, and it is not a weakness. You do not need to think like a programmer to break software. You need to think like a **bad day**. This document teaches you the handful of patterns that account for the overwhelming majority of real-world failures, in plain language, using your shop and your products as the examples.

---

## Part 1: The direct answer on Supabase access

You asked: *"Can I give you access to my supabase database and you stress test the system by driving the tables and such?"*

**Yes. Give me the access, and I will drive it as hard as it will go.**

An earlier draft of this document said the opposite, at length, and recommended you stand up a second Supabase project first. That recommendation was **wrong and has been withdrawn**. It rested on a premise I never checked with you: that the Supabase database was production. You corrected me:

> *"We are not in production yet, still developing. Everything on our system is test data. All sales, all refunds, all customers, all employees, all test data. The inventory and vendors are my real products and vendors, but production lives in Cultivera currently. There is no contaminating the database at this point."*

That changes the answer completely. My standing instruction from you is *"do not guess, do not assume"*, and I had done both. The reasoning is preserved below only so the distinction stays clear for anyone reading later.

### Why the objection no longer applies

The three hazards in the withdrawn draft were: test data is not cleanly reversible, it contaminates numbers you are trying to trust, and it creates a compliance record you cannot retract. Every one of those depends on there being real trade in the database. There is none. Production is Cultivera. Nothing here has been reported to the WSLCB, nothing backs a filed excise return, and no customer record in Supabase belongs to a real patient.

There is also a purpose-built way back: the factory reset. It empties every table that records an event — including the general ledger — and keeps every table that describes the business. So the plan is deliberately disposable: fill the system with rehearsal data, break it on purpose, learn everything, then wipe the slate before you migrate for real.

You also declined a second Supabase project, and I agree with the decision rather than merely accepting it:

> *"I don't want to setup another supabase database, there are too many env variables to re setup in vercel for it to be worth the time and effort."*

That is correct on cost/benefit. A staging project buys isolation you do not need when the live database contains nothing worth isolating, and it costs a full re-plumbing of the Vercel environment — which is itself a rich source of new bugs that would have nothing to do with your POS.

### The two things that genuinely are real

Two things in Supabase are not test data, and I treat them as read-mostly:

1. **Inventory and vendors** — your real products and real suppliers. I will not delete or rename these. Where I need product rows to abuse, I create clearly-labelled rehearsal products alongside them.
2. **The knowledge base** (`kb_*`) — hand-validated reference material. You asked me not to touch it, and the factory reset keeps it too, so it survives the wipe.

### The one thing to do before I start

**Run the factory reset yourself, once, and confirm it does what it says.** Not because the data is precious, but because the reset is the safety net under everything else in this document, and a safety net nobody has tested is a decoration. You test it, you see the numbers go to zero, and from that point on we both know the slate can be cleaned on demand.

A defect was found in exactly that function during this audit: the rules were current, but the **button was still wired to the superseded reset**, which would have left the entire general ledger behind. That is fixed. Details are in the slice report — but it is the reason "test the reset first" is the first instruction here rather than an afterthought.

Everything below is now safe to run at whatever volume we like, because the worst case is a reset.

---

## Part 2: How to think like something going wrong

Here is the whole skill, distilled. When you sit down at any screen, run it through these seven lenses. You do not need to know how the code works. You only need to ask the question.

### Lens 1 — The Empty Case

**The question: what happens when there is nothing?**

Software is almost always written and demoed with data present. The author sees three products on screen and moves on. Nobody checks the day the list is empty, because during development it never is.

Ask it everywhere. What does the receiving screen do with a purchase order that has zero lines? What does a report show for a day you were closed? What does the register history show at 8:01am before the first sale? What does a discount do when it applies to a category with nothing in it? An empty case should say something honest and human like "No sales yet today." What you are hunting for is a blank white area, a spinner that never stops, an error message, or — worst of all — a **zero presented as a fact** when the truth is "I could not look."

That last one is the real danger and it is worth understanding, because it is the difference between a bug and a disaster. "You sold $0 today" and "I could not read the sales ledger" look identical on screen if the software is careless, but they mean opposite things. One means go home, one means call for help. Whenever you see a zero or an empty list, ask yourself: *would I be able to tell if this were actually a failure?*

### Lens 2 — The Too-Much Case

**The question: what happens when there is far more than anyone expected?**

This is the lens that would have caught the bug you just reported. The register's transaction history search was written to filter the fifty rows the browser happened to be holding. With a handful of test sales that works perfectly. On a real Saturday, fifty sales is about half a day — so searching for a customer from yesterday truthfully reported "nothing matches" while the sale sat right there in the database, perfectly returnable. Nobody wrote a bug; somebody wrote code that was correct for a small number and wrong for a big one.

So: what does a 40-item basket do to the receipt? To the on-screen cart? To the printer? What does a purchase order with 300 lines do to the receiving screen? What does a product name of 200 characters do to a menu tile, a label, a CCRS export? What does a customer with 500 past visits do to their history panel?

**Rule of thumb: any time you see a list, ask what happens at ten times your busiest day.**

### Lens 3 — The Boundary

**The question: what happens exactly at the line, not near it?**

Bugs cluster on boundaries with startling reliability, because "less than" and "less than or equal to" look nearly identical to a human eye and mean different things to a computer. Your system has real, checkable boundaries:

- The recreational usable-cannabis limit is **28 grams**. Try a cart at exactly 28.0g. Then 28.01g. Then 27.99g. One of those must be refused and two must be allowed, and you know which.
- Concentrate is **7 grams** recreational, **21 grams** medical. Same three-point test.
- Medical usable is **84 grams**. Same again.
- Sales hours run to **midnight**. What happens to a sale started at 11:58pm and finished at 12:01am?
- The return window is **15 days**. Try a return at day 14, day 15 and day 16.
- A discount that starts Tuesday: what happens at 11:59pm Monday, and 12:01am Tuesday?

Test the exact value, one below, and one above. Three attempts. This is the highest-yield testing technique that exists and it requires no technical knowledge at all — only the willingness to be pedantic.

### Lens 4 — The Interruption

**The question: what happens when a human or a machine stops halfway?**

Real shifts are full of interruptions and software is usually written as though they do not happen. Deliberately abandon things:

Start a sale, add items, then walk away and let the screen lock. Come back. Is the cart still there? Is it still correct? Start receiving a purchase order, get halfway, close the browser tab, and reopen it. Did you lose the work, or worse, did half of it save? Begin a return, then hit the back button. Unplug the register's network cable mid-sale and plug it back in. Put the tablet in airplane mode, ring a sale, then reconnect — does it sync once, or twice?

**"Twice" is the thing to watch for.** Duplicate submissions are one of the most common and most expensive classes of bug in retail software, because they double-decrement inventory and double-report to the state. Anywhere you can press a button twice quickly, do so, and then go check whether one thing happened or two.

### Lens 5 — The Collision

**The question: what happens when two people do related things at the same time?**

You mentioned "collision" specifically, so here is what it means concretely. Every register and every back-office tab is a separate person as far as the software is concerned. A collision is two of them touching the same fact at the same moment.

Concrete tests you can run with two devices, or two browser tabs:

The **last unit** collision. Find a product with exactly one unit left. Add it to a cart on register one. Add it to a cart on register two. Complete both. Exactly one should succeed; the other should be told clearly why it failed. If both succeed, you have just sold inventory you do not have and CCRS will disagree with your shelf.

The **stale edit** collision. Open the same product in two back-office tabs. Change the price in tab one and save. Change the description in tab two and save. Does tab two's save silently undo tab one's price change? This is a "last write wins" problem and it is extremely common.

The **mid-sale change** collision. Add a product to a cart at the register. Before completing, go to the back office and change that product's price. Complete the sale. Which price did the customer pay, and which price is on the receipt, and do those two agree with each other and with the books?

The **discount overlap** collision. This is on your untested list and deserves attention. Set up a percentage discount and a fixed-amount discount that both legitimately apply to the same product, then sell it. Does it stack? Should it? Is the answer the same on the receipt, in the sales report, and in the excise calculation? Then try a discount that would take a product below its cost, or below zero — the system must refuse rather than produce a negative line.

### Lens 6 — The Wrong Shape

**The question: what happens when the data is not what anyone pictured?**

This is where imports and integrations break. You are importing from Cultivera, so this lens matters a lot for you.

Names are the classic trap. Try a product whose name contains an ampersand, a hash, an apostrophe, a slash, an emoji, or a very long run of characters. The bug I just fixed in the register search had a cousin exactly here: a product called `Tom & Jerry #4` sent through a URL without proper encoding gets silently cut off at the `#`, and the system searches for something the customer never typed. Everything looks like it worked, and the answer is wrong.

Also worth trying: quantities with more decimal places than expected (0.333g), a zero-price product, a product with no category, a product with no image, a customer with only one name, a customer with an apostrophe in their surname, and a CSV file exported with the wrong line endings or an extra blank row at the bottom. All of these are fair game. Create rehearsal products rather than editing your real ones, and the reset clears the lot afterwards.

### Lens 7 — The Honest Failure

**The question: when something goes wrong, does the system tell the truth about it?**

This is the lens I care about most, and it is the one that separates software you can bet a business on from software you cannot.

When you turn off the wifi and press a button, do you get a clear message, or a silent nothing? When the printer is out of paper, does the sale still complete and tell you the receipt failed, or does the whole sale fail? When a report cannot load, does it say so, or does it show zeroes? When a search finds nothing, can you tell "there is nothing" apart from "I stopped looking"?

**Test this by deliberately causing failures.** Turn wifi off. Unplug the printer. Type a receipt number that does not exist. Log in with a wrong PIN four times. Each time, judge the message by one standard: *could a brand-new budtender read this and know what to do next?* If the answer is no, that is a bug worth reporting even though nothing crashed.

---

## Part 3: What to actually do, in what order

You said you are struggling to keep track. The companion file **`docs/BATTLE_TESTING_CHECKLIST.md`** is the tracker: every area, every test, with a checkbox and space for notes. It records what you have already confirmed working so you do not re-tread it.

Work it in this order, because it is ordered by **what hurts most if it is wrong**:

**First, money and inventory accuracy.** Discounts (especially the non-daily ones you have not tested), price overrides, returns, voids, and the till count. If these are wrong you lose money silently and the books lie.

**Second, compliance.** Purchase limits, sales hours, the CCRS CSV upload you have on your list, and the excise numbers. If these are wrong the exposure is regulatory, not just financial.

**Third, the interruption and collision cases** from Lenses 4 and 5. These are rare per shift but certain over a year, and they are the ones that produce inventory drift you cannot explain later.

**Fourth, the too-much and wrong-shape cases** from Lenses 2 and 6. These are where the Cultivera migration itself will bite, because their data will contain shapes your own manual entry never produces.

**Last, cosmetic and convenience issues.** Real, worth fixing, but they do not threaten the migration decision.

---

## Part 4: How to report what you find, so it can be fixed fast

You do not need to diagnose anything. You need to give me enough to reproduce it. Four things, in plain sentences:

**What you did**, step by step, including the boring steps. **What you expected.** **What actually happened**, quoting any message exactly. **When and where** — which screen, which register, roughly what time, and whether it happened once or every time.

That last one matters more than it sounds. "Every time" and "once" are completely different bugs. If you can, try it twice.

A good report reads like this: *"On register 2 at about 3:15pm I opened transaction history, typed 'Miller' in the search bar and pressed Enter. I expected to see Sarah Miller's sale from this morning. Nothing happened at all — the list did not change and no error appeared. It did the same thing three times, and the same thing when I scanned the receipt instead."*

That is exactly what you gave me, and it was enough to find four separate defects with no guessing. Keep doing precisely that.

---

## Part 5: The honest scorecard

You are considering betting the shop's operations on this platform, so you deserve a straight answer about what is and is not currently proven.

**What is genuinely well protected right now.** The pure calculation layer — money math, purchase limits, discount arithmetic, tax, receipts, CCRS formatting — is covered by an extensive automated suite that runs on every change, plus embedded self-tests in each module that CI executes independently. Where I have fixed defects for you recently, I have also run *mutation testing*: deliberately corrupting the fixed code to confirm the tests actually catch the corruption. A test that cannot fail proves nothing, and I do not ship those.

**What is well protected but only against known cases.** The compliance rules are strong where the statute is explicit. They are only as good as the scenarios anyone thought to encode.

**What is genuinely untested and where I would look first.** Concurrency between two live registers under real load. Very large data volumes. Cultivera's real-world data shapes, as opposed to the sample you have imported. The non-daily discount types. The CCRS upload path end to end against the real portal. Long-running sessions and the interruption cases in Lens 4.

**What would move the needle most.** The staging database in Part 1. Everything in that "genuinely untested" list is testable properly the day it exists, and is only testable timidly until then.

The honest summary: the arithmetic and the rules are in good shape and well defended. The unknowns are concentrated in volume, concurrency, and real-world data mess — which is exactly the profile you would expect for a system that has been carefully built and lightly used. That is a normal and healthy place to be before cutover. It is also precisely the profile that a staging environment plus the checklist in the companion file is designed to close out.

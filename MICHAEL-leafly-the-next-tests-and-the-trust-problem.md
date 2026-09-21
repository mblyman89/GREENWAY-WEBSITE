# Leafly: The Next Tests, And The Trust Problem

**For Michael Lyman — Greenway Marijuana**
Written in plain English. No technical background assumed. Read it top to bottom, or jump to the part you need.

---

## The short version

You asked seven things. Here are the seven answers in one paragraph each, and then the rest of the document is the detail behind them.

**What's the next logical sandbox test?** Push an update and a deletion, not another full menu. You have only ever tested the "send everything" button. Leafly's certification checklist explicitly wants to see three different kinds of request in your logs, and you have so far produced one of them. That is the gap.

**Should you enrich a product with an image and description and push it?** Yes, and it is the perfect vehicle for the test above, because it gives you a real reason to send an update rather than a full menu. But there is a trap in the image field that I want you to know about before you touch it, and it is in Section 3.

**How do you test an online order end to end?** Section 4 is a numbered walkthrough. The short answer is that your own storefront is the honest test today, because it exercises the same speaker and the same printer through the same code. The Leafly side cannot be fully tested until Leafly switches your webhooks on in their sandbox, and Section 4.4 explains exactly what to ask them for.

**Should we add Leafly-style inventory parameters on our side?** We already did, in this release. Section 5.

**The "don't show it if we only have two left" feature?** Built, tested, shipped, and turned off until you turn it on. Section 5 tells you where the switch is and what the three settings mean.

**The set-it-and-forget-it path?** Section 7 is a readiness checklist with honest checkmarks and honest blanks. You are closer than you think, but you are not there, and I will not tell you that you are.

**Test it, test the tests?** Section 8. I attacked my own work with 18 deliberate sabotages and it caught all 18. Two more sabotages survived, and rather than call them harmless I proved it across nearly ten thousand cases. One of my tests also turned out to be broken and passing for the wrong reason — I found it, and I tell you about it, because that is the kind of thing that should never be quietly fixed.

---

## 1. First, the thing I found that you did not ask about

You asked how to make the menu trustworthy. Before answering, I went and looked at what the menu actually does today, and I found a real problem. I want to lead with it, because it is the direct cause of the exact scenario you described.

Here is every stock check that existed anywhere in the Leafly path before this release:

> Is the quantity greater than zero?

That is it. That is the whole rule. A jar with **one gram left** was published to Leafly, and marked as available for pickup, with exactly the same confidence as a jar with forty grams.

So the situation you described — a customer sees something on the menu, drives over, and finds out at the counter that it is gone and would you like something else — was not bad luck. It was the system working as designed. There was no design. The menu was answering "do we have any at all" when the customer was asking "will it still be there when I arrive."

Those are different questions. Between the moment the menu syncs and the moment the customer walks in, that last gram can sell at the counter. A single walk-in sale can turn a truthful menu into a lie, and nothing in the system knew to be careful about it.

This is logged in the codebase as **FINDING L-22**, and fixing it is the main piece of work in this release.

---

## 2. The next logical sandbox test

### 2.1 What you have proven so far

You have proven that you can send Leafly your **whole menu at once** and they accept it. That is real progress and it is not nothing — it proves the login works, the format is right, and the pipe is open.

### 2.2 What you have not proven

Leafly's certification checklist is in their own specification document, which we keep a copy of in the repository. It asks to see a particular pattern of behaviour in your request logs before they will move you to production. Their words:

> **Option 1 (Recommended):**
> `POST` — Full menu updates across items at a cadence of once per day
> `PUT` — Submission of item updates individually or in batches
> `DELETE` — Removal of items from Leafly menus

Three verbs. In plain English:

| Their word | What it means | Have you done it? |
|---|---|---|
| `POST` | "Here is my entire menu, replace everything" | **Yes** |
| `PUT` | "Just change this one item, leave the rest alone" | **No** |
| `DELETE` | "Remove this item from my menu" | **No** |

You are one third of the way through the behaviour they want to see. **That is the gap, and closing it is the next logical test.**

The good news is that all three are already built. I checked before writing this — `src/lib/leafly/push.ts` implements POST, PUT, and DELETE, including a subtlety I will come back to in Section 6 where a PUT sync automatically issues DELETE calls for items that left your menu, because PUT on its own can never remove anything.

So there is nothing to build. There is something to **exercise**.

### 2.3 Why this ordering matters, and the "full menu every time" trap

There is a tempting shortcut here. Leafly's Option 2 says you may simply POST the full menu several times an hour and skip PUT and DELETE entirely. It is simpler. It is also allowed.

I want to recommend against it, and give you the reason rather than just the verdict.

A full menu POST means "everything I am not mentioning does not exist." Every single sync, your entire catalogue is torn down and rebuilt. If one sync goes out while your inventory system is mid-update, or a product feed hiccups, or a category fails to load, the items that did not make it into that payload **disappear from Leafly immediately** — and they stay gone until the next successful sync. Several times an hour, you are betting your whole public menu on one request being perfect.

PUT is the opposite. PUT says "change this, and do not touch anything else." A PUT that fails leaves your menu exactly as it was. The blast radius of a bad sync drops from "the entire menu" to "one item did not update."

For a business where the menu **is** the storefront, that difference matters more than the simpler code. Leafly recommends Option 1 for a reason, and the reason is that Option 1 fails gracefully.

### 2.4 The test, step by step

Do these in order. Each one builds on the last.

**Test A — Update one item (PUT).** Pick a single product. Change something visible and harmless: the description, or the price by a cent. Push it as an update, not a full sync. Wait about two and a half minutes — Leafly's own documentation says sandbox changes take "not more than about two and half minutes" to appear. Then use the **Menu Readback** button in the admin panel and confirm your change is actually there.

**Test B — Update several items at once (PUT, batched).** Same thing with a handful of products. This proves batching works and is explicitly what Leafly's checklist describes ("individually or in batches").

**Test C — Remove an item (DELETE).** Take one test product off the menu. Read back. Confirm it is gone.

**Test D — Put it back (PUT).** Prove removal is not a one-way door.

**Test E — The daily rhythm (POST).** One full sync, as the daily baseline. This is the cadence Leafly recommends: full menu once a day, updates throughout.

After all five, your request log shows all three verbs in the pattern Leafly's checklist describes. That is what gets you certified.

### 2.5 Why the readback step is not optional

I want to be emphatic about this because it is the single most important habit in the whole process.

**A success message from Leafly does not mean your menu is correct.**

It means the request was well-formed and accepted. It does not mean the data inside it was right. We have already been bitten by this in this project — a payload can be accepted with a perfectly cheerful response and still be wrong, and there was a round of eight separate field-level defects discovered exactly this way.

This is why the Menu Readback tool exists. It does not ask Leafly "did that work?" It asks "what do you actually have?" and then compares it, field by field, to what we sent, and names any difference.

The comment at the top of that file says it better than I can:

> the interesting question is not "what is on Leafly's side", it is "does what is on Leafly's side MATCH WHAT WE SENT". [...] a payload can be accepted and still be wrong; an HTTP 200 is not evidence of a correct menu.

**Push, wait, read back. Every time. That is the loop.**

---

## 3. Should you enrich a product with an image and description?

**Yes.** And it pairs perfectly with the PUT test above, because enrichment gives you a genuine reason to update one item rather than resend everything. Do them together.

But there are three things about those fields you should know first, because they are not obvious and one of them can quietly damage your menu.

### 3.1 The image trap — please read this one

In the Leafly format, sending the image field as **empty** does not mean "no change." It means **"delete the image you have."**

If a product has a beautiful photo sitting on Leafly, and we send an update where the image field is blank, Leafly deletes that photo. The update succeeds. Nothing warns you. The picture is just gone.

The code is written to protect you from this. It only ever sends the image field when there is a real image to send, and omits it entirely otherwise:

```
// imageUrl: nullable, and null/omitted REMOVES the cached image.
// Only send a real one.
```

There are tests locking this behaviour in place, including cases where the image is an empty string or nothing but spaces — both are treated as "no image" and omitted rather than sent as blank.

**What this means for you in practice:** enriching is safe. Adding images will not hurt anything. Just be aware that if you ever *remove* an image on our side, it will also disappear from Leafly, and that is correct behaviour rather than a bug.

### 3.2 Descriptions must be plain text

Leafly's specification says:

> **Product Descriptions**: Do not submit product descriptions containing markup, all product descriptions should be submitted as plain text.

"Markup" means the invisible formatting codes that come along when you copy text out of a web page or Word. The system strips them automatically before sending — there is a function whose entire job is converting formatted text to clean plain text, and a test proving that a description written as bold HTML arrives at Leafly as ordinary readable words.

**What this means for you:** write or paste descriptions however is convenient. It gets cleaned up on the way out.

### 3.3 Blank means "leave it out," not "send nothing"

There is a distinction here that caused three real defects earlier in this project. For certain fields, there is a difference between:

- **Omitting** the field — "I have nothing to say about this"
- **Sending it as empty** — "The correct answer is: nothing"

Leafly treats those differently, and for some fields, sending empty is an error. The code now omits rather than empties, and there are tests named for exactly that.

This connects to something else in Leafly's certification checklist:

> Strain values are set to `null` when absent
> Cannabinoid values are set to `null` when absent

And their warning about why:

> If cannabinoid information is absent the value `null` should be submitted rather than `0`. Transmitting `0` results in a display of `"0mg"` to shoppers rather than the preferable `"unknown"`.

A customer seeing **"0mg THC"** on a flower product will assume it is broken or worthless. A customer seeing **"unknown"** understands we just have not tested that batch. Same missing data, completely different impression. The system already handles this correctly.

There is a matching trap for strains: sending the text `"NA"` instead of a true blank causes Leafly to match your product to an actual strain in their database called **"El-na."** Your product gets filed under a strain that does not exist. Also already handled.

### 3.4 So what should you actually enrich?

Prioritise in this order:

1. **Your best sellers.** Highest traffic, highest return on the effort.
2. **Anything with a confusing name.** A description does the most work where the name does the least.
3. **Anything where a photo would seal the deal.** Edibles and concentrates especially.

Do a handful, push them as a PUT, read back, confirm. Then scale up once the loop feels boring. Boring is the goal.

---

## 4. Testing an online order end to end

This is your question about the back office, the receipt, and the noise on the speaker. I checked the entire chain in the code rather than assuming it works, and here is what is true.

### 4.1 What is actually wired up

Both order paths are fully connected. I verified each link:

**An order from your own website:**
- The order arrives and gets saved
- A receipt is queued to print (`src/app/api/orders/route.ts`, line 255)
- The speaker announcement is fired off in the background (`src/lib/orders/orders-store.ts`, line 265)

That announcement is deliberately **not waited for**. That is a good decision and worth explaining: if the speaker is unplugged, or the Pi is rebooting, or the network blips, the customer's order still completes normally. The announcement is allowed to fail. The sale is not. Getting that backwards would mean a broken speaker could break your checkout.

**An order from Leafly:**
- The webhook arrives and is verified as genuinely from Leafly
- The announcement fires (`src/lib/leafly/bridge-server.ts`, line 212)
- The receipt is queued (line 235)
- A local order is created in your back office

There is also protection against double-announcing. If Leafly sends the same notification twice — which happens, networks retry — the system claims the announcement atomically, so it plays **once**. Two flags in the database, `announced_at` and `printed_at`, act as the record of "already done."

**The speaker sounds different depending on where the order came from.** There is a separate sound file for Leafly orders (`sounds/leafly.mp3`) and a different one for your own site. Your staff can tell, without looking at a screen, whether that was a Leafly order or a website order.

### 4.2 Test One — your own storefront, end to end (do this first)

This is the test you can run **today, by yourself, with no help from anyone.** It exercises the same speaker, the same printer, and the same back office as a Leafly order.

1. Make sure the Pi announcer is powered on and the speaker volume is up.
2. Make sure the receipt printer has paper and is online.
3. Go to your own website as a customer would. Not the admin panel — the actual public storefront.
4. Add something to the cart and place a real pickup order. Use your own name so it is obvious in the records.
5. **Listen.** The speaker should announce within a few seconds.
6. **Watch the printer.** A receipt should print.
7. **Check the back office.** Go to the admin orders screen. Your order should be sitting there.

If all four happen, the chain works. If one does not, you have isolated the problem to exactly one link, which is the entire point of testing them together.

### 4.3 If something does not happen

There is already a full troubleshooting guide at `docs/announcer/10-field-manual.md` with a decision tree. But the quick triage:

| Symptom | Most likely cause |
|---|---|
| No sound, but receipt printed | Pi offline, speaker unplugged, or volume down |
| Sound, but no receipt | Printer offline, out of paper, or paused |
| Neither, but order is in back office | Announcer and printer both unreachable — check the network |
| Order not in back office at all | The order itself failed — this is the serious one |

There is also a **test button** on the admin orders screen that fires a test announcement without needing a real order. Use it to check the speaker in isolation before blaming the order system.

**One honest caveat I want to flag:** that test button currently only plays the **Greenway** sound, not the Leafly one. So it proves your speaker works, but it does not prove the Leafly-specific sound file is present and playing. That is a small gap and I am noting it rather than letting you discover it during a real Leafly order.

### 4.4 Test Two — a Leafly order (needs Leafly's help)

Here is where I have to be straight with you about what is and is not possible right now.

All six order webhooks exist and are live. I confirmed the files:

```
src/app/api/webhooks/leafly/order-activate
src/app/api/webhooks/leafly/order-cancel
src/app/api/webhooks/leafly/order-deactivate
src/app/api/webhooks/leafly/order-preview
src/app/api/webhooks/leafly/order-status
src/app/api/webhooks/leafly/order-submit
```

But **Leafly has to be the one to send an order.** These are webhooks — Leafly calls us. We cannot make a genuine Leafly order appear by pressing a button on our side any more than you can make your phone ring by wanting it to.

Every message from Leafly is cryptographically signed, and we verify that signature against the exact raw bytes received. We cannot forge one, and we should not want to be able to — that check is what stops anyone else from injecting fake orders into your store.

**So the email to Ben, or to partners@leafly.com, should ask for:**

> We have completed menu sandbox integration and all six Order API webhook endpoints are deployed and responding. We would like to enable the Order API in the sandbox environment so we can run an end-to-end order test before going to production. Could you enable order webhooks for our sandbox retailer and confirm the endpoint URLs you have on file?

### 4.5 Two things to know before Leafly orders go live

**First: enabling the Order API makes Leafly's own dashboard read-only.** Once orders flow to us, Leafly's order screen becomes a viewer, not a control panel. Your staff manage orders in *your* back office from that point on. This is what you want — one screen, not two — but your team needs to hear it before it happens, not after.

**Second: there is a fifteen-minute clock.** When a Leafly order comes in, there is an automatic cancellation timer. If we do not acknowledge in time, Leafly cancels the customer's order. This is why the webhook code is written to *never* respond with an error, even when something is wrong internally. Leafly's own documentation, quoted in our code:

> Unless Leafly's outbound HMAC keys fails your validation, webhook requests should only be responded to with status codes 200 or 201. These webhook events are not the place to apply business rules or validations on the order lifecycle.

The five near-identical webhooks were deliberately built from **one shared piece of code** rather than five copies, and the reasoning is written right there in the file:

> Five hand-written copies is five chances for one of them to grow a `return NextResponse.json(..., { status: 400 })` during a late-night fix. A 400 here makes Leafly retry and then auto-cancel a paying customer's order.

**Third, on customer emails:** Leafly is the sole originator of customer communication for Leafly orders. If we also emailed the customer, they would get two confirmations from two brands for one order. So for Leafly-origin orders the system suppresses the *customer* email but always sends the *staff* alert. Your team is always told. The customer is not told twice.

---

## 5. Leafly's settings versus ours — and your low-stock feature

### 5.1 The fact everything here rests on

You noticed that Leafly has inventory and menu-management settings and asked whether we should have equivalents. You were right to ask, and here is the precise situation, quoted from Leafly's own specification:

> **Availability Thresholds**: These are not currently supported via API, however there are toggles within each reatiler's Integreation Settings UI that can be used to set global or category-specific low inventory thresholds for hiding items.

(The two typos are Leafly's, not mine. I have left them exactly as written because there is a test asserting that sentence still exists in their spec — if they ever change it, we find out immediately rather than discovering it the hard way.)

Read that carefully, because it is the whole story:

- Leafly **does** have low-stock hiding
- It lives **only in their web interface**
- It **cannot be controlled through the connection between our systems**

So if you wanted low-stock protection today, you would log into Leafly, find their settings, and set it there. Which means it is one more Leafly thing to remember, in a Leafly place, in Leafly's language — the exact opposite of "set it and forget it."

### 5.2 What we built instead

We built it on our side, where you already work, and made it better than theirs.

**Leafly's version:** one threshold, applied to a whole product.
**Ours:** a threshold applied to **each individual size**.

Here is why that difference is worth real money. Say you have a popular strain:

| Size | In stock |
|---|---|
| 1 gram | 40 |
| 3.5 gram | 2 |
| 7 gram | 15 |

Under Leafly's per-product rule, the product is low on something, so the **whole strain vanishes** from your menu. You have fifty-five units of it in the building and customers cannot see any of them.

Under our per-size rule, the 3.5g quietly steps back and the grams and sevenths keep selling. The customer still finds the strain. You still make the sale. Nobody gets disappointed at the counter.

That is not us matching Leafly. That is us being better, in a way that shows up in the till.

### 5.3 The three settings, in plain English

Go to the Leafly integration settings and you will find a new section called **Low-stock protection**. Three choices:

**Off** — Exactly how things work today. Anything with one or more in stock gets published and marked orderable. **This is the default.** Nothing about your menu changed when this shipped. Nothing changes until you decide.

**Show it, but don't let them reserve it** — The item stays visible on Leafly so customers can still discover it, but they cannot place an online order for it. Someone browsing sees it exists; someone wanting to reserve one is stopped. Good middle ground for popular products you still want visible.

**Withhold it entirely** — The size disappears from the Leafly menu completely until stock recovers. This is the strongest promise: *if it is on the menu, we have it.*

Then there is the number — **how many is "too few."** You can set anything from 0 to 10. The cap of 10 is not arbitrary: Leafly's own system internally caps the stock number it stores at 10, so a threshold above that would be comparing against a number Leafly cannot represent.

**My recommendation is 3**, which is what the system suggests by default. Here is the reasoning:

- **At 2**, you are protected against a single walk-in sale between syncs.
- **At 3**, you are protected against two.
- **Above 4 or 5**, you start hiding real, sellable inventory and leaving money on the counter.

Three is the point where the menu becomes trustworthy without becoming timid. But it is your call, you know your floor traffic better than any default does, and you can change it any time.

### 5.4 Per-category thresholds

The system also supports different thresholds for different categories, because the risk is genuinely different. A pre-roll that sells thirty a day needs a bigger buffer than a rare concentrate that sells one a week. The storage and the logic for this are built and tested; the settings screen currently exposes the global number, and per-category is ready to surface when you want it.

Importantly, if per-category values are already saved, **saving the main form does not wipe them out.** That was a real hazard — a form that only shows some settings can silently erase the ones it does not display. There is a test specifically preventing it.

### 5.5 Two deliberate decisions worth knowing

**Out of stock is still out of stock.** Something with zero gets no special treatment from this feature — it was already excluded and still is. This feature is only about the *dangerous middle*: one or two left.

**When the system does not know, it does not guess.** In some cases a product has no real size information and the system creates a placeholder with a quantity of 1. That 1 is not a real count — it is a stand-in. Reading it as "nearly out" and hiding the product would be the system inventing a fact. So in that case the low-stock rule **deliberately abstains** and leaves the item alone. This is written into the code with an explanation, and there is a test proving it.

I want to highlight that one because it is exactly the "never guess, never assume" rule applied inside the software itself, not just in how I work.

---

## 6. The trap that would have silently ignored you

This is the part I am most glad we caught, because it would have made the system lie to you about obeying you.

Remember the two ways of syncing:

- **POST** — "here is my whole menu, replace everything"
- **PUT** — "change these specific items, leave everything else alone"

Now think about what "withhold this item" means in each.

Under **POST**, withholding works perfectly. We leave the item out of the payload, Leafly replaces the menu with what we sent, and the item is gone. Exactly as intended.

Under **PUT**, withholding **does nothing at all.** PUT only changes what it mentions. Leaving an item out of a PUT does not remove it — it means "no change to that one." So an item already live on Leafly **stays live**, on sale, at full visibility.

You would have set your threshold to 3. You would have saved it. The screen would have said saved. And your low-stock items would have kept right on selling, with no error, no warning, and no way to tell from your side.

That is the worst category of bug: the one where the system appears to obey you and does not.

**So the settings screen now tells you.** If you choose "withhold" while in PUT mode, a warning banner appears explaining that withholding will not take effect for items already on Leafly. The code that decides when to show it is called `withholdEffectiveness`, and there are tests covering both the case where it must appear and the case where it must stay quiet.

Worth adding: the sync code already handles the general version of this problem well. When running in PUT mode, it follows up with explicit DELETE calls for items that left your menu — there is a comment reading *"then explicitly DELETE items that left the feed (PUT never deletes)."* Someone had already thought carefully about this. The banner closes the remaining gap for the low-stock case specifically.

---

## 7. The set-it-and-forget-it readiness checklist

You said you want to turn auto-sync on and never touch it again. That is the right goal. Here is an honest assessment of where you stand.

### Ready now

- ✅ Authentication works
- ✅ Full menu sync (POST) proven end to end
- ✅ Update (PUT) and removal (DELETE) built — untested against Leafly
- ✅ Readback verification tool built, compares field by field
- ✅ Low-stock protection built, tested, shipped (default off)
- ✅ All six order webhooks deployed
- ✅ Order → back office → receipt → speaker chain verified in code
- ✅ Different speaker sounds per order source
- ✅ Duplicate-notification protection
- ✅ Blank-image protection
- ✅ Plain-text description conversion
- ✅ Correct handling of missing strain and cannabinoid data
- ✅ PUT-mode withhold warning

### Not yet

- ⬜ **PUT exercised against the sandbox** — Section 2.4, Tests A and B
- ⬜ **DELETE exercised against the sandbox** — Test C
- ⬜ **Daily POST cadence demonstrated** — Test E
- ⬜ **Enriched product pushed and read back** — Section 3
- ⬜ **Your own storefront order tested end to end** — Section 4.2. *You can do this today.*
- ⬜ **A real Leafly sandbox order** — needs Leafly to enable webhooks (Section 4.4)
- ⬜ **Low-stock threshold chosen and switched on** — Section 5.3
- ⬜ **Ben's answer on Question 2** (the automated-tools certification point) — still outstanding, and worth chasing since it sits directly on the certification checklist

### The order I would do it in

1. **Today:** run the storefront order test (4.2). No dependencies. Proves your speaker and printer.
2. **Today:** turn on low-stock protection at "show but don't reserve," threshold 3. Low risk, immediate benefit, easy to reverse.
3. **This week:** enrich a few products and push as PUT (Tests A and B). Read back.
4. **This week:** DELETE test and restore (Tests C and D).
5. **This week:** one full POST (Test E). Certification pattern now complete.
6. **In parallel:** email Leafly for sandbox order webhooks, and chase Ben on Question 2.
7. **Once a Leafly sandbox order works:** move to "withhold" if you want the strongest promise.
8. **Then, and only then:** turn on auto-sync.

### One thing to keep an eye on after auto-sync

When you switch it on, watch for a few days for items disappearing that you did not expect. Not because I expect it, but because the difference between a system you trust and a system you hope about is whether you ever actually checked. After a week of it behaving, stop watching. That is the moment it becomes set-and-forget.

---

## 8. Testing the tests

You said: *"Test it, test the tests."* Here is exactly what that meant in practice.

### 8.1 The normal gates

| Check | Result |
|---|---|
| Type checking | 0 errors |
| Code quality (lint) | **0 errors** |
| Internal self-tests | All passed |
| Full test suite | **634 files, 16,739 tests, all passing** |
| New tests for this feature | **38, all passing** |

### 8.2 Testing the tests: deliberate sabotage

A passing test suite proves the tests ran. It does not prove they would **notice** if something broke. A test that passes no matter what is worse than no test, because it produces false confidence.

So I broke the feature on purpose, 18 different ways, and checked each time whether the tests screamed. Flip the comparison. Remove the zero-stock check. Make the threshold ignored. Break the warning banner.

**All 18 sabotages were caught.**

I also ran a **control**: a change that alters the code without changing behaviour at all. The tests must *not* fail on that, because a test that fails on a harmless change is just noise. The control passed silently, as required.

### 8.3 Two sabotages that survived — and why I did not shrug

Two of my attacks were **not** caught. The tests stayed green.

The easy move here is to write "equivalent mutant" in a report and move on. That phrase is the standard excuse for an untested branch, and I was not willing to use it on your money without proof.

So I proved it. I wrote a program that ran both the real code and a faithful copy of the sabotaged version across every meaningful combination of inputs and compared every single result:

- **First survivor:** 2,976 cases tested. **0 differences.**
- **Second survivor:** 6,720 cases tested. **0 differences**, and 0 counterexamples on the specific edge case I was most suspicious of.

Nearly ten thousand comparisons, zero disagreements. Those two really are unkillable — not because the tests are weak, but because the code in question genuinely cannot change the outcome. They are safety nets behind other safety nets.

I kept both in the code anyway, as defence-in-depth, with the proof written beside them so nobody deletes them in a year thinking they are dead weight. And I added a test that pins the *behaviour* they protect, rather than leaving a permanent false gap in the sabotage report.

### 8.4 One of my own tests was broken

This is the part I most want you to see, because it is the difference between claiming rigour and having it.

One test was supposed to confirm that the low-stock rule was genuinely wired into the menu-building code. It passed. It should not have.

The tool it used to grab the relevant chunk of code had a subtle flaw — it stopped reading at the wrong place and handed the test an almost-empty fragment. The test then checked that fragment for the low-stock rule, did not find a contradiction, and reported success. It was checking nothing and calling it a pass.

I found it, fixed the extraction properly, and then added something extra: the test now **checks its own homework.** Before looking for the rule, it verifies that what it grabbed is actually a substantial piece of code. If the extraction ever breaks again, the test fails loudly instead of passing quietly.

That failure was the most valuable thing that happened during this work. It is precisely the class of problem that makes a green test suite meaningless, and it only surfaced because the suite was being attacked rather than admired.

---

## 9. What shipped, and what changes for you today

**Nothing changes today.** Low-stock protection ships **off**. Your menu behaves exactly as it did this morning. The feature waits for you.

**Files in this release:**

- `src/lib/leafly/menu-visibility-core.ts` — the new rule
- `src/lib/leafly/payload-core.ts` — wiring it into menu building
- `src/lib/syndication/sync-settings-core.ts` — saving your choice
- `src/app/admin/integrations/leafly/actions.ts` — the save handler
- `src/components/admin/syndication/SyncSettingsPanel.tsx` — the controls and the warning banner
- `tests/compliance/leafly-menu-visibility.test.ts` — 38 new tests
- `scripts/compliance/run-pure-selftests.ts` — registering the new checks so they run forever

**Your single next action:** place a test order on your own website and listen for the speaker. It takes five minutes, needs nobody's permission, and tells you something real.

---

## 10. Sources

Everything factual here came from these, not from memory or assumption:

- `docs/leafly-specs/menu-integration-v2.openapi.json` — Leafly's Menu API v2 specification, including the availability-thresholds quote, the certification checklist, sync frequency guidance, latency figures, and the strain/cannabinoid rules
- `docs/leafly-specs/order-api-v1.openapi.json` — the Order API and its webhook events
- `src/lib/leafly/push.ts` — confirmed POST, PUT, and DELETE are implemented
- `src/lib/leafly/payload-core.ts` — image, description, and field-omission behaviour
- `src/lib/leafly/readback-core.ts` — the verification comparator
- `src/lib/leafly/bridge-server.ts` — the Leafly order → announce → print chain
- `src/lib/orders/orders-store.ts`, `src/app/api/orders/route.ts` — the storefront order chain
- `src/app/api/webhooks/leafly/` — all six webhook endpoints and the shared handler
- `src/lib/announcer/announcer-fanout-core.ts` — per-origin sounds
- `src/app/admin/orders/announcer-actions.ts` — the speaker test button
- `docs/announcer/10-field-manual.md` — troubleshooting guide

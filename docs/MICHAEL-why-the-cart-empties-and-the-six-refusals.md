# Michael — why your cart emptied, and why those "6 refused" were not what the screen said

Short version, before anything else: **the dashboard message you sent me was wrong, and it was my code that wrote it.** It told you the webhook HMAC key here doesn't match the one Leafly issued. That was not a reading of your evidence; it was the only sentence that box knew how to print, and it printed it because a number was bigger than zero. I am sorry. Some of the six refusals it was accusing Leafly over were my own test requests, run by hand against your public URL while I was diagnosing the vanishing cart. This document explains what was actually happening, what I changed, and exactly what you do now to get a receipt and a noise out of a test order.

---

## 1. The "6 deliveries we refused" — what they really were

The message on your screen read: *"Leafly is reaching us but the signature didn't match. That almost always means the webhook HMAC key here doesn't match the one Leafly issued. Orders are being turned away."*

Here is the problem with that. There are seven different reasons a delivery can be refused, and the system has been recording which one applied to each refusal since we built the webhook log months ago. The panel never read that column. It only counted rows. So whenever the count was above zero it printed the key-mismatch sentence, no matter which of the seven reasons had actually occurred.

Your six refusals were all the same reason, and it was the one reason that has nothing whatsoever to do with a key: the request arrived carrying **no signature at all**. A request with no signature never involved a key, so it cannot possibly be evidence that your key is wrong. Genuine Leafly deliveries always carry a signature — so anything unsigned did not come from Leafly. In practice it is a port scanner finding a public address, a crawler, a health check, or, in your case, me testing the endpoint by hand. Turning those away with a refusal is the lock on the door doing its job.

You can see the contradiction in the screenshot yourself, now that you know what to look for. The box immediately to the left read **"Signed deliveries from Leafly: received ✓"**. That tick can only appear if a signature from Leafly verified correctly. So the panel was simultaneously telling you your key worked and that your key was wrong, in two boxes an inch apart, and you quite reasonably believed the louder one.

The panel now reads the reason column. It shows each reason, how many of them there were, and — the part that matters — who has to do something about it. Exactly one of the seven reasons is permitted to point at Leafly, and that is a properly formed signature that genuinely failed to match. Everything else is either labelled "ours to fix" or "not Leafly". Your six probes will now show as `6× missing_header — not Leafly`, with the explanation that these were almost certainly scanners or hand-run tests and say nothing about your key.

**So: you do not need to chase Leafly about your HMAC key, and you must not rotate it.** It has verified at least once, which is proof it is correct.

---

## 2. Why the cart emptied — and it was none of the above

This is the real fault, and it is entirely on our side. It is also not something you could have found, because no screen mentioned it.

When a shopper taps "proceed to preorder", Leafly does not simply record the order. It calls us first and asks us to confirm the cart, and it waits for our answer. Leafly's own specification is explicit that our reply is allowed to *"adjust items quantities (downward only), **remove items entirely**, correct top-of-line pricing, and supply a list of applicable taxes."*

Read that again, because it is the whole story. **Our answer *becomes* the cart.** If we answer with no items in it, Leafly honours that and the shopper's basket is empty. Which is precisely what you saw.

There are three separate conditions that make us answer with no items, and all three look absolutely identical from the shop floor — the shopper just sees "Empty stash?". That is why this took so long to pin down:

The first is a refused signature. If we turn the request away, Leafly gets no cart back at all, and the basket empties. Second is having no published menu loaded, so there is nothing to price the cart against. And the third is the one that got you.

**Your Leafly sync settings have a switch called "send pickup availability", and it ships switched OFF.** That switch is what decides whether we tell Leafly your items may be sold through a marketplace. With it off, when Leafly asks us to confirm a cart, we answer truthfully according to the setting: none of these items may be sold that way. Leafly believes us, removes every line, and the shopper sees an empty basket.

I proved this by running the real code rather than reasoning about it. With the switch on, the cart came back with the item in it, priced. With the switch off, the cart came back empty, with every line marked removed because it was not orderable. Same product, same everything else, one switch.

And here is why every screen told you **READY** while this was happening: the setup checklist never checked this switch. It checked your menu connection, your six URLs, your HMAC key, your order key, your speaker and your printer — all correct, all ticked, headline "Everything needed is in place." It had no idea that one setting on a different page could make the whole thing unsellable.

That switch is now its own step on the checklist, it is marked as blocking, and the panel will refuse to call you ready until it is on. If a cart would empty right now, the panel says so in plain language at the top, names which of the three causes it is, and links you to the page that fixes it.

---

## 3. Something I found while fixing this, that I am deliberately NOT "fixing"

I want to flag this because it is the kind of thing that looks like a bug and is actually a safety rule, and if I quietly "improved" it you would never know.

The obvious fix for the empty cart is: if pickup ordering is switched off, just hand Leafly the cart back unchanged so the shopper can complete the order anyway. I did not do that, and I will not.

When we remove a line from a cart, the code records one reason — "not orderable" — and that single reason covers two completely different situations. One is your pickup switch being off. The other is a **DOH High-THC product**, which under WAC 246-70 may only be sold to a registered patient holding a valid recognition card. That card cannot be checked when somebody places an order on a marketplace, so those products must never be offered for unattended pickup, ever.

I checked which of the two wins when both apply, by running it. The pickup switch is tested first, so when it is off, a High-THC product reports "pickup disabled" and its statutory block is **invisible** at that point in the code. So a change that said "pickup is off, hand the cart back anyway" would have handed back High-THC product for marketplace pickup. A confusing empty cart is a support call. That would have been a licensing problem.

So the cart stays empty when the switch is off. What changed is that *you* now get told why, clearly, on the panel — and the server log now says so in as many words too. There is a permanent test locking that statutory ordering in place, so nobody can reverse it later by accident.

---

## 4. What to do now, in order

**Step one — turn on pickup availability.** Go to Integrations → Leafly, find the sync settings, and switch on "send pickup availability". This is the one that was blocking you. Save it.

**Step two — check the setup panel.** Open the back-office online orders page and look at the Leafly setup panel. You should now see seven steps rather than six, with "Pickup ordering is switched on for Leafly" among them, ticked. If a red box appears at the top telling you a cart would still empty, it will name the reason — read that before going any further, because it will be more specific than anything I can predict here.

**Step three — check the refusals box.** It should now break down by reason. If everything in it is labelled "not Leafly", that is background noise and my old probes, and you can ignore it entirely. If anything is labelled "Leafly's key", that is the real thing and it is worth an email. If anything says "ours to fix", tell me.

**Step four — place a test order on Leafly.** Add a product that you know is in the published menu, and complete the preorder. The cart should survive to the confirmation this time.

**Step five — watch for the three things you asked about.** A row should appear in the Leafly section of the online orders dashboard. The speaker should make a noise. A receipt should print, and it will be in our own format, not Leafly's — same layout as your other online order receipts, with a line identifying it as a Leafly order and a banner telling whoever picks up the paper the deadline to accept it before Leafly cancels it automatically at fifteen minutes.

If any one of those three does not happen, that is now a much smaller question than it was this morning, because the panel will have already told us which part of the chain is not ready.

---

## 5. Still outstanding, and not on our side

Ben has still not replied about the six URLs or confirmed the webhook HMAC key. Two things follow from that.

Your activation succeeded when you switched the integration on in the portal, and Leafly's specification says an error returned from the activation webhook *prevents* the integration from being turned on. So either our activation URL is registered with them and answered correctly, or Leafly did not call it at all. That is evidence the URL registration is at least partial, but it is not proof that all six are in place — and until a real order webhook arrives and verifies, it stays evidence rather than proof. The panel is careful to word it that way rather than claiming more than it knows.

Separately, the HMAC key comes from Leafly's API team alongside your client credentials, not from the portal. The two keys you found in the portal are your **order integration key**, and they were identical because they are the same thing shown in two places — the specification calls it "the dispensary's integration key, provided by Leafly". That key is correct and it is saved. It is a different credential from the webhook signing key, and the signing key is the one Ben still owes us a confirmation on.

---

## 6. One thing I owe you

Earlier in all this I told you that you did not need the order integration key and could leave the field blank. That was wrong, and I checked it properly this time rather than repeating it: the order key is required to collect an order's contents and to accept it, and the menu push never reads it at all, so setting it could not have broken your menu sync. I also left misleading wording on the credentials page — "leave them blank until Leafly sends them" — which is what put that idea in your head in the first place. Say the word and I will fix that wording too; I did not want to bundle an unrelated text change into a slice about your cart emptying.

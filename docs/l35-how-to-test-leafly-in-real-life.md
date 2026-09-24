# HOW TO TEST THE LEAFLY INTEGRATION IN REAL LIFE (SLICE L-35)

Written for Michael. No technical knowledge needed. Each test says what to do,
what you should see, and what it means if you see something else.

---

## PART 1 — WHY YOU ONLY GOT ONE EMAIL (READ THIS FIRST)

**Short answer: nothing is broken on our side. The emails are sent by Leafly,
and the shopper gets them, not you.**

What Leafly's own documents say, word for word:

- The Order API specification (our saved copy, `docs/leafly-specs/order-api-v1.openapi.json`):
  *"Leafly will be the sole originator of automated consumer facing
  communications related to orders placed on the Leafly platform. That is,
  Leafly shoppers should receive no automated emails or text messages from a
  partner system with regard to order confirmation, status updates, etc."*
  So we are **not allowed** to email shoppers. We send the status change and
  Leafly decides who gets told.
- Leafly Help Center, "How to fulfill a Leafly online order": moving an order
  to Ready for Pickup *"alerts the shopper that their order is ready to be
  picked up."*
- Leafly Help Center, "Enabling Email Notifications for Online Orders": the
  only email a **store** can switch on is the **New Order** alert (Biz
  Dashboard → Settings → Notifications). There is no store email for Confirmed
  or Ready.

Put together: when you pressed **Confirm** and **Mark ready**, the alerts went to
the **shopper's** account, which Leafly controls. The review request after
**Picked up** is also a shopper email. If you placed the test order with your
own email, it matters **which inbox and which Leafly account** placed the
order. Also check spam/promotions folders, because Leafly's alerts can land there.

We also do not know, and **cannot see**, whether Leafly sends an *email* for
every step. It may use its app or its website order page instead. The spec
does not say, so we don't guess.

**What we DID fix (L-35):** after each button press, the screen now tells you
what **Leafly's own copy of the order** says. Leafly always sends it back
with the 200. Instead of just *"Leafly accepted the request (200)"*, you will
now see for example:

> ✅ Done — Leafly now shows this order as "Ready for pickup". (Checked against
> the order Leafly sent back, not just its 200.) Any notice to the shopper
> about this step comes from Leafly, not from us.

If Leafly ever answers 200 but its copy of the order shows something else,
you will see a yellow ⚠️ warning saying so, with the Leafly support address to
contact.

We also fixed a hidden screen bug. Yellow warnings after a button press (for
example *"the register order did not close — close it by hand"*) were being
covered up by the green success message and **never shown**. They now show.

---

## PART 2 — TEST THE ORDER STEPS (10 minutes)

Place a small test order on your Leafly menu from a phone, **logged in to
Leafly with an email you can check**.

| Step | You do | You should see in the back office | Leafly side |
|---|---|---|---|
| 1 | Nothing, just wait | The order appears and is **acknowledged automatically**, but **not confirmed** | New-order email to the store (if switched on in Biz) |
| 2 | Press **Confirm order** | Green: *Done — Leafly now shows this order as "Confirmed"* | Shopper's Leafly order page shows it confirmed |
| 3 | Press **Mark ready for pickup** | Green: *Done — Leafly now shows this order as "Ready for pickup"* | Leafly says this "alerts the shopper" |
| 4 | Press **Mark picked up** | Green: *…"Picked up"*; the order moves to the hidden/finished list | Review-request email to the shopper |

**While doing it, open the order on the shopper's phone** (Leafly → your
orders). After each press, pull to refresh. The status there should move in
step with your presses. **That is the real proof**, whether or not an email
arrives.

If a step shows a **yellow ⚠️** instead, screenshot it and send it to me.

---

## PART 3 — TEST THE AUTOMATIC MENU UPDATES (about 1 hour, mostly waiting)

### Switch it on (one time)

1. Back office → **Integrations → Leafly**.
2. Find the card **Automatic syncing**.
3. Tick **"Keep my Leafly menu in sync automatically"**. *(It starts OFF on
   purpose. Automation that talks to Leafly with nobody present is your
   decision.)*
4. **Full sync every day at**: pick a quiet hour (e.g. 4 am).
5. **Send changes in between**: choose **every 15 minutes** for the test (you
   can set it back to 60 later; either is fine).
6. Press **Save schedule**.

### Test A: a price change reaches Leafly on its own

1. Pick one product you can easily find on Leafly. Write down its current price.
2. In the back office, change its price by a cent or a dollar and save.
3. **Do nothing else.** Wait up to **20 minutes** (15-minute schedule + a few
   minutes for Vercel's timer, which Vercel describes as "best effort").
4. Refresh your Leafly menu page for that product. The new price should show.
5. Back on **Integrations → Leafly**, the **run history** under Automatic
   syncing shows a new line reading **Sent — Scheduled — update**. "Scheduled" (not "You pushed") is the system doing it without you.
6. Put the price back. It will follow again within ~20 minutes.

### Test B: a sold-out item leaves Leafly on its own

1. Pick a product with stock. Set its stock to zero (or mark it unavailable)
   in the back office.
2. Wait up to 20 minutes, then refresh Leafly. It should no longer be offered.
3. Restore the stock. It should come back within ~20 minutes.

### Test C: a quiet period is not a failure

If nothing changed, the history shows **"Nothing to send"**. That is the
system working correctly. It checked, found your menu and Leafly already
match, and did not bother Leafly.

### If you don't want to wait

On the same card, **Run the check now** runs the same check the timer runs,
immediately. If it says it is **not due yet**, that is correct behaviour: it
respects your 15-minute setting. Use **Live push to Leafly** above it for an
immediate manual send.

### What "wrong" looks like

- History shows **Failed** with a red reason → send me a screenshot.
- Nothing appears in the history for over an hour with the box ticked → send
  me a screenshot of the Automatic syncing card.

---

*Sources: Leafly Order API v1 spec (vendored, md5
`daab7bcf6f77177de85425adf7f805f1`, "Expectations"); help.leafly.com "How to
fulfill a Leafly online order"; help.leafly.com "Enabling Email Notifications
for Online Orders". Code: `src/lib/leafly/lifecycle-core.ts` §4b,
`src/lib/leafly/order-ack-server.ts` (`setLeaflyOrderStatus`),
`src/components/admin/syndication/LeaflySchedulePanel.tsx`.*

# Why your Leafly test order vanished

Michael — you placed a real order on Leafly and nothing happened. No record in the
back office, no receipt, no noise from the speaker, and no Leafly section anywhere on the
online orders page. You asked me a very fair question: **is it all built and the UI just
isn't there yet?**

The honest answer is **no**. It was not one missing screen. It was three separate faults
sitting in three different layers, and each one on its own was enough to swallow the order.
I found all three by reading the code and by running it, not by guessing, and I fixed the
one that was ours. This document explains what was wrong, what I changed, what is still
waiting on you, and exactly how to run the test again and watch it land.

---

## The short version

| # | What was wrong | Whose side | Status |
|---|---|---|---|
| 1 | Leafly was never given the six web addresses to send orders to | Leafly's side — needs an email from you | **Still open — your move** |
| 2 | The Order integration key is blank in our back office | Ours — one paste | **Still open — your move** |
| 3 | Even if 1 and 2 were done, the receipt could never have printed | Ours — a real code defect | **Fixed in this change** |
| 4 | The Leafly section hid itself while you were setting it up | Ours — a UI rule | **Fixed in this change** |

Faults 3 and 4 are fixed and shipped. Faults 1 and 2 are things only you can do, and I have
made the back office tell you about them instead of staying silent.

---

## Fault 1 — Leafly does not know where to send your orders

This is the big one, and it is the reason nothing at all arrived.

Leafly does not push orders out to whoever happens to be listening. It only sends an order
to a list of web addresses that you have explicitly given them. There are six of these —
one for each kind of event. Ben Scott asked for them in his email. They have never been sent.

So when you placed that test order, Leafly took it, held it, and then had nowhere to deliver
it to. From our side the experience is indistinguishable from the order never existing. That
is why all three of your first symptoms happened at once: there was no record because nothing
arrived to record, no receipt because nothing arrived to print, and no sound because nothing
arrived to announce.

I verified this is not a case of "the endpoints are broken". I sent a request to each of the
six addresses myself. All six are live, and all six correctly answered **401 Unauthorized** —
which is exactly right, because my test request was not signed by Leafly. The doors are built,
hung, and locked. Nobody has told Leafly which doors to knock on.

**These are the six addresses.** They are also now displayed in the back office with a copy
button on each one, so you never have to retype them:

```
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-submit      (required)
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-cancel      (required)
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-status      (recommended)
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-preview     (recommended)
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-activate    (optional)
https://greenwaywebsite1.vercel.app/api/webhooks/leafly/order-deactivate  (optional)
```

Send those to `api-support@leafly.com`, replying on the existing thread with Ben so it stays
attached to the sandbox request already in flight. Until Leafly has these, **no change on our
side can make an order appear**, because no order will ever be sent to us.

---

## Fault 2 — the Order integration key is blank

Your own screenshot of the credentials page shows it: **Order integration key — Source: NOT
SET.**

That key is not the same thing as the menu key, which is why it is easy to miss. The menu key
is how we push products *to* Leafly. The order key is how we identify ourselves when we reach
back to Leafly to *collect* an order and to say "got it". It appears in the URL of every single
order call we make.

Without it, two things break. We cannot fetch the order, and — worse — we cannot acknowledge
it. Leafly gives a store **fifteen minutes** to acknowledge an order. Miss that window and
Leafly cancels the customer's order automatically. So even in a world where fault 1 was fixed
tomorrow, a blank order key would mean every order arrives, sits unacknowledged, and is killed
by Leafly a quarter of an hour later.

You get the key from the Leafly business dashboard — the store settings page in your sandbox
account, the same screen you screenshotted. Paste it into the Order integration key field on
the Integrations page in our back office.

---

## Fault 3 — the receipt could never have printed (a real bug, now fixed)

This is the one I would not have found by reading a checklist, and it is the reason I am glad
you reported this as a bug rather than as a setup question.

When Leafly sends the `order_submit` webhook, that webhook **does not contain the order**. It
is a notification, not a delivery. It carries five small fields — essentially "an order with
this id just happened at this store". No customer name. No items. No prices. No totals.

Our code was storing that little notification and then handing it straight to the part of the
system that builds the receipt. I ran that path to be certain rather than assuming, and it
returned, word for word:

> `the stored Leafly payload has no order id`

So the receipt builder was being handed a scrap of metadata and asked to produce a printable
ticket. It refused, correctly, and the order died quietly right there. **Even with faults 1 and
2 fixed, you would have got no receipt.** You would have got a bell and a mystery.

The reason is that a required piece of the integration had never been built. Leafly's own
specification lists an endpoint — `GET /{order_integration_key}/orders/{id}`, "Fetch Order by
ID" — that you are *required* to call to go and collect the actual order. That endpoint did
not exist anywhere in our codebase. The notification arrived and nobody ever went to pick up
the parcel.

**What I built:** a new step that runs the moment a webhook arrives and before anything else
happens. It takes the order id out of the notification, calls Leafly's Fetch Order endpoint,
and replaces the metadata scrap with the real order — items, prices, customer, totals. Only
then does the receipt and alert machinery run, and now it runs with something it can actually
use.

I also made it handle the unhappy paths properly, because "it worked on the good day" is not
good enough for something that touches a customer's order:

- **Leafly does not answer at all** → the bell still rings. An order you cannot read is still
  an order, and staff need to know it is there. Going silent would be the worst possible
  behaviour and I have a test that specifically forbids it.
- **401 or 403** → this is a credentials problem, and it is reported as one. It is deliberately
  *not* retried, because retrying a wrong password forever looks healthy on a dashboard while
  every order is quietly lost.
- **404** → this one is genuinely ambiguous, and it is worth knowing why. Leafly only keeps an
  order while it is live, plus twenty-four hours after it finishes. So a 404 means either "that
  order never existed" or "that order is simply old". We now tell those two apart by checking
  whether we already know the order locally, and we give you the right message instead of a
  scary one.
- **A 500 from Leafly** → retried, because that one is their side and usually temporary.

While I was building the test that pins this behaviour, **it caught a second, separate defect
in my own new code**, which I want to be transparent about. The check that decided "is this
order printable?" was saying yes to an order that had an id and a total but no line items at
all. The real receipt builder rejects that order — it will not print a ticket with nothing on
it. So the two disagreed, and the system would have reported a clean, successful, no-action-
needed order that produced no paper. Exactly the bug you reported, wearing a different hat.
That is fixed too, and three of my own test assertions that had encoded the same wrong
assumption were corrected.

---

## Fault 4 — the Leafly section was hiding

Your fourth symptom was that there is nothing on the online orders page that has a Leafly
orders section.

The section exists. It is over seven hundred lines of working interface and it was already
mounted on that page. It was rendering nothing because of a deliberate rule in the code, which
I will quote exactly:

```ts
if (!hasOrders && !hasProblem && !hasOutcome && !board.orderIntegrationKeyPresent) {
  return null;
}
```

Read that against your situation. No orders, no problems, no outcomes, and no order
integration key — because of fault 2. Every condition true, so the panel returned nothing and
vanished. The UI was working perfectly and that is precisely what made it useless.

The rule itself is defensible. The orders page should not grow a permanent empty box for a
feature the shop does not use. But it is badly wrong in one specific situation: when the owner
is actively trying to set the feature up. At that moment an invisible panel is
indistinguishable from a broken one, and it answers "is this thing even installed?" with
silence. It cost you a test order and an afternoon.

**What I did:** I did not weaken that rule — a shop that genuinely does not use Leafly still
gets a clean page. Instead I added a second panel that appears *while you are mid-setup*. It
shows up as soon as there is any sign you are working on this, and disappears into a compact
one-liner once everything is connected.

It tells you, in order:

1. A plain-English paragraph explaining why an order placed right now would not arrive.
2. Hard evidence — how many signed deliveries we have ever received from Leafly, how many we
   refused and why, and when we last heard from them at all.
3. A six-step checklist: menu connected → Leafly has our six URLs → signing key → order key →
   speaker → printer. The first four block orders. The last two do not: an order must still
   land in the system even with no speaker and no printer, and there is a test that enforces
   that.
4. The six webhook URLs, each with its own copy button, plus a "copy all six" button.
5. A "we couldn't check this" block, so that if something is unknown it says so rather than
   pretending to be fine.

The checklist is ordered deliberately. The URLs come **before** the key, because pasting a key
changes nothing while Leafly still has no address to call.

One important detail: the "Leafly has our six URLs" step can only be marked done by **evidence
of an actual signed delivery from Leafly**. I could have made it tick when the key was saved,
which would have been easier and would have looked tidier. It would also have been a lie, and
would have told you setup was complete while the one genuinely unverifiable step remained
undone. There is a mutation test that deliberately introduces that shortcut and requires the
suite to catch it.

---

## What I did to prove any of this works

You told me to test it and to test the tests, so here is the accounting.

**The specification is pinned, not paraphrased.** The tests read Leafly's actual OpenAPI file
off disk. I re-downloaded it and confirmed it is byte-for-byte identical to the copy in the
repo (md5 `daab7bcf6f77177de85425adf7f805f1`). If Leafly changes their API, or if someone
mistypes a URL or a webhook path, a test fails rather than an order disappearing.

**148 self-check assertions** run inside the two new logic files themselves, with no imports
and no mocks, and they run on every build.

**61 new compliance tests** on top of that, including an exhaustive sweep of every HTTP status
from 100 to 599, and every combination of fetch-outcome × printable × already-handled ×
Leafly status, checking that the resulting plan is never self-contradictory.

**And then I attacked my own tests.** A passing suite proves nothing by itself — it might be
passing because the code is right, or because the tests cannot see the code at all. The only
way to tell is to deliberately break the production code and demand the tests notice. I wrote
fourteen sabotage runs, each one impersonating a plausible real mistake:

- swap the production Leafly host for the sandbox host
- misspell one of the six webhook paths
- make a failed fetch go silent instead of ringing the bell
- treat a wrong password as a temporary glitch worth retrying
- remove the guard that stops us sending Leafly a `localhost` address
- mark the webhook step done because a key is saved
- unwire the new fetch entirely, restoring your original bug exactly
- unmount the new setup panel, reproducing your fourth symptom exactly

**Result: all fourteen were caught.** The fifteenth run is a control — a harmless comment that
changes no behaviour — and it correctly survived, which proves the suite is reacting to real
behaviour and not to cosmetic edits.

That round also found a genuine hole the first time I ran it. The test that checked the new
panel was mounted on the orders page was passing by matching the *import line* rather than the
place the panel is actually used — so deleting the panel from the page left the test green. I
closed that by stripping imports before checking, and it now dies as it should.

---

## How to run your test again

Do these in order. Steps 1 and 2 are yours; nothing works until both are done.

1. **Email the six URLs** above to `api-support@leafly.com`, replying to Ben on the existing
   thread. This is the blocker. Until Leafly has them, nothing will arrive no matter what else
   is configured.
2. **Paste the Order integration key** from your Leafly sandbox store settings into the Order
   integration key field on the Integrations page.
3. **Open the online orders page.** The new setup panel will be visible. Work down the
   checklist until the first four steps are ticked. The "Leafly has our six URLs" step will
   only tick once Leafly actually sends us something signed — that is the point of it.
4. **Place a sandbox order on Leafly.**
5. **Watch three things happen:** the speaker announces it, the printer produces a receipt with
   the real items and totals on it, and the order appears in the Leafly orders section with the
   customer and the line items.

If it still does not arrive after all of that, the setup panel will now tell you which of the
six steps is the problem, and the evidence cards will show whether Leafly reached us at all and
whether we refused them. You will not be staring at a blank page again.

One caveat worth knowing: if you are testing against a Vercel preview deployment rather than
the main site, the URLs are different for every deployment and Leafly will be pointing at the
main one. Test against the real site address. The panel says this on screen too.

---

## What is still outstanding

- **The six URLs have not been sent to Leafly.** This is the single blocking item and it needs
  an email from you. I will not send anything to Ben on your behalf.
- **The Order integration key is not set.** One paste from the Leafly dashboard.
- **Ben has not answered the certification question** from the last round — whether the
  Postman/curl evidence is acceptable for sign-off, or whether they need to drive a live order
  through themselves.

Everything on our side of the line is done, tested, and merged.

# Leafly: your store key, and answering inside 9 seconds

This covers slices **L-45** and **L-46**, the last two items from Ben's email
that change how orders flow. It is written in plain English. The technical
record is in `docs/leafly-integration-finish-roadmap.md`.

---

## L-45: your store key

### What Leafly told us

Ben (item 2): the "order integration key" is **the same value as your Menu
integration key**. There is one key per store, and Leafly puts it inside every
order message it sends us.

### What was actually wrong

This turned out to be a real, blocking bug, not just a missing check.

The website only looked in the **Order integration key** box. On your
credentials page that box said **NOT SET**. So whenever an order arrived, three
things would have refused with "fix your credentials":

- collecting the order's contents (the items, the customer's name, the totals);
- accepting it automatically;
- sending status updates back to Leafly.

All of that happened even though your Menu integration key, which is the
exact same value, was saved and working for menu sync.

### What changed

- **A blank Order box now means "use the Menu key".** You do not need to paste
  anything new. If you have typed something into the Order box, that still
  wins, so nothing that works today changes.
- **Every order message is checked.** When Leafly sends an order, we compare
  the store key inside it with yours.
  - **If they match** (the normal case), nothing extra happens.
  - **If they don't match**, the order is **still taken**: it rings, it
    prints, it is accepted. We never throw away an order over a key
    difference. You are Leafly's only store on this connection, so a
    difference can only mean a typo in one of our boxes, and dropping the
    order would turn that typo into a customer's order being cancelled.
    Instead, the Leafly setup panel (Online orders → Setup) shows a yellow
    warning that says which box to fix.
- **The credentials page now tells you where you stand.** Under "Order API"
  there is a new line starting "Store key:". It says whether your two boxes
  agree. With the Order box blank it reads: "The Order box is blank, so your
  Menu integration key is used for orders too. That is correct."
- **The old wording is fixed.** The page used to say both boxes were
  "required". Only the **Webhook HMAC key** is a separate value that you must
  paste. The Order box help text now says: "Leafly uses your Menu integration
  key as the order integration key; leave blank to use it."
- **The setup checklist step** is now called "Store key saved (used for
  orders)". It ticks as soon as your Menu key is saved.

### What you should do

**Nothing.** Leave the Order integration key box blank.

If you ever see the yellow "store key" warning on the setup panel, follow the
instruction it gives. It will say either "clear the Order integration key box"
or "re-copy your Menu integration key from Leafly".

### Safety notes

- Your keys are never written to the logs and never shown on the setup panel.
  Only "match" or "doesn't match" is.
- Only messages that Leafly properly signed are counted. A stranger sending a
  fake message with some other key cannot make the warning appear or talk you
  into changing a working key.
- The store key can **never** stand in for the Webhook HMAC key. The store key
  appears in every message, so it is not a secret. If the HMAC key is missing,
  orders are still refused as before.
- The check costs no extra time. It uses the same single settings lookup the
  website already did for each order.

### How it was tested

- 31 automated tests run real order messages through the real code. They
  include one with a wrong key, which is still taken, rung and accepted, with
  the warning written to the log.
- 81 built-in self-checks cover the key rule.
- 27 "sabotage" runs deliberately break the new code in realistic ways, for
  example "drop orders with a wrong key", "stop falling back to the Menu key"
  or "let the Menu key stand in for the HMAC key". Every sabotage has to make
  the tests fail, and every one did.

---

## L-46: answering Leafly inside 9 seconds

### What Leafly told us

Ben (item 4):

- Leafly **retries** new orders, status changes and cancellations 3 more
  times (4 deliveries in all). The waits between tries are 15–25 seconds,
  15–35 seconds and 30–60 seconds.
- Any answer that is **not "OK"**, or that takes **longer than 9 seconds**,
  counts as a failed delivery.
- The **price check** (preview) that Leafly sends while a shopper is in the
  cart is **not** retried.
- Orders that are not accepted within **15 minutes** are cancelled by Leafly.

Ben did not say whether "store turned on / turned off" messages (activate and
deactivate) are retried. The code records that as **unknown**; it does not
guess.

### What was actually wrong

Before this change, when a new order arrived the website did **all** of the
following before answering Leafly:

1. saved the order;
2. fetched the order's full contents from Leafly;
3. rang the store and queued the receipt to print;
4. accepted the order with Leafly;
5. sent the staff alert if something went wrong.

Each of those steps is either a database write or a call to Leafly, and each
already had its own time limit. Added up, the worst case was **more than 90
seconds**. So on a slow day, a perfectly good order could have been marked
"failed" by Leafly and sent to us again, even though we had already taken it.

### What changed

- **We now answer Leafly within about 6 seconds, every time.** That leaves 3
  seconds of room under Leafly's 9-second limit. First we check that the
  message is really from Leafly (the HMAC check, which is one quick settings
  lookup with its own 5-second cap). Then all of the order work starts.
- **If the work finishes quickly, which is the normal case, nothing is
  different.** The same steps run in the same order, and the log line is the
  same as before.
- **If the work is slow, it is not stopped or skipped.** We answer Leafly "OK"
  at the 6-second mark and **the same work carries on to the end** in the
  background. The website's hosting keeps it running for up to 5 minutes.
  The log shows two lines: "answered 200 at …" and then "finished after the
  response".
- **Nothing is done twice when Leafly retries.** A retry of an order we
  already have is recognised and answered "OK". It does not create a second
  order, ring twice or print twice. This was already true, and it is now
  tested against Ben's 4 deliveries.
- **The existing safety net still applies.** The acknowledge check that runs
  every 2 minutes still picks up any saved order that has not been accepted
  yet, well inside Leafly's 15 minutes.
- **The price check is kept fast too.** If looking up your prices would take
  too long, the website answers with the cart unchanged instead of making the
  shopper wait. A price check is never retried, so a late answer would have
  been a wasted one.
- **Bonus fix: no more false staff alerts.** When Leafly sent the same order
  twice, the second copy could send staff an alert saying the order was "not
  announced or printed", even though the first copy had already rung and
  printed it. That false alarm is gone. A genuine failure still sends the
  alert.

### What you should do

**Nothing.** There is no setting to change.

### Safety notes

- The "is this really from Leafly?" check is **still done before we answer**.
  A fake message is still refused, and on time.
- The 6-second budget cannot be turned off or changed in production. The only
  switch is used by the automated tests.
- If you ever see "answered 200 at" in the logs, it means an order arrived on
  a slow moment and was finished in the background. That is the system working
  as designed, not an error. If the log says **WARNING** with "over Leafly's
  9 s", please tell us.

### How it was tested

- 37 automated tests run real order messages through the real code with the
  slow parts deliberately stalled: slow saving, slow fetching of the order,
  slow ringing, slow duplicate checks, and a stalled price lookup. In each case
  Leafly gets its "OK" on time and the work still finishes afterwards.
- 89 built-in self-checks cover the timing rules, and 9 more cover the false
  alert fix.
- 29 "sabotage" runs deliberately break the new code in realistic ways, for
  example "wait for everything again", "forget to finish the work after
  answering", "treat activate as retried" or "bring back the false alert".
  Every sabotage has to make the tests fail, and every one did.

| Slice | What | State |
|---|---|---|
| L-45 | Store key: blank Order box uses the Menu key; every order checked, never dropped | **Merged, live** (`9d498a09`) |
| L-46 | Answer Leafly within about 6 s; slow work finishes in the background; no false duplicate alert | **Merged, live** (see the final report) |

### Still waiting on you

You have not yet told us the results of three things: the automatic sync you
turned on, the "Replace my whole Leafly menu (POST)" button, and deleting an
item. When you try them, let us know what you see.

The staging site and the staging database are paused, as you asked. They
were not used for this work (standing rule 13).

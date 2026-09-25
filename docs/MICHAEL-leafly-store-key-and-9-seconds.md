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

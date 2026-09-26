# Leafly: the certification proof card (L-47) and changing an order (L-48)

For: Michael Lyman · Greenway Marijuana

---

## Part 1: L-47, the "Proof for Leafly certification" card

### Step 1 (do this once): run migration 0231

Open Supabase, go to **SQL Editor**, paste the whole of
`supabase/migrations/0231_leafly_certification_proof.sql`, and click **Run**.

- It is safe to run twice. Running it again changes nothing.
- It changes no data. It only widens the list of call types the Leafly call
  log may hold (adding "fetch order", "government ID image" and "medical ID
  image") and adds two indexes so the card loads quickly.
- Until you run it, the site still works normally. The card simply cannot
  record "Collect the order" or the ID-image views. Those rows say *"may need
  migration 0231"* so you know why.

### Where to find the card

**Admin → Integrations → Leafly.** It sits directly under the existing
evidence panel and is titled **Leafly certification proof**.

### What the card shows

Each thing Leafly's "Preparing for Production" list asks for gets one row,
grouped four ways:

| Group | Rows |
|---|---|
| Menu API | POST (replace whole menu), PUT, DELETE, status check, read-back |
| Order webhooks (Leafly calls us) | Order arrives, Shopper cancels, Status change, Checkout price check, Store switched on/off |
| Order endpoints (we call Leafly) | Collect the order, Acknowledge, Move the order along, Government ID image, Medical ID image, Change the order's items |
| Order lifecycle | An order finished as picked up; an order finished as canceled |

Every row carries Leafly's own label, **Required**, **Recommended** or
**Optional**. Those labels are read from Leafly's published spec, not
typed in by hand, and a test fails if they ever disagree.

A row turns **green only from a recorded success** in the database, never
from a button someone ticked. The possible states are:

- **Proven**: a recorded success, with its date and how it happened.
- **Proven, last try failed**: run it again and get a success. Leafly looks
  for errors being fixed on later calls.
- **May have expired**: the success is older than 14 days, so it may have
  dropped out of Leafly's sandbox logs (Ben, answer 11). Run it again inside
  your window.
- **Failing**: tried, never succeeded.
- **No record yet**: nothing recorded at all.
- **Could not read**: a record could not be read just now. The card will not
  say "never done" when it simply could not look.
- **Not needed here**: for example, the menu read-back in production.

Each row also has a **How to prove it** line telling you exactly which button
to press or which sandbox action to take.

### The certification window and the email

Leafly certifies inside a window you give them, with 2 business days' notice.
The card:

1. **Suggests a window** of two business days, early enough that the logs
   will still be there when Leafly reviews them.
2. Shows **"If you emailed Leafly today"**, meaning which Required rows have
   a success inside your most recent business-day window.
3. Drafts the email to Leafly. Press **Copy email** and paste it.

### Something I found and fixed while building this

Automatic acknowledgements were **silently not being logged**. The call to
Leafly itself worked (orders were acknowledged), but the log entry failed to
save, because the "who did it" column only accepts a staff member's ID and
auto-acknowledge was writing the word "auto-acknowledge" into it. It is now
logged with an empty staff column and the message starts with
`[auto-acknowledge]`. No migration was needed for this fix.

### What the card cannot prove for you (still open)

- **You have not yet checked that POST and DELETE actually changed the menu
  on Leafly.** The card proves Leafly *accepted* the call (a 2xx). It cannot
  see Leafly's storefront. Next time: delete one test item, then search for
  it on your Leafly menu and confirm it is gone.
- **There is no recorded proof yet that automatic sync is running.** You
  switched it on. The Menu rows will show "Automatic sync" as the source once
  a scheduled run succeeds. Check the card the day after.
- Webhooks need you to place **sandbox test orders** (Ben, answer 6): one
  picked up, one canceled, and one where you change the items (Part 2).
- Activation and deactivation are sent by Leafly, not by us. They are
  **Optional**, so a "No record yet" there does not block certification.

---

## Part 2: L-48, changing an order's items

Leafly calls this **"Update Order's Cart"**. It is **Optional** for
certification, but you asked for it, so it is built. It works on
**both the dashboard and the front register**.

**No migration is needed for this part.** The log table already accepts
cart changes (migration 0226). Migration 0231 is only needed for Part 1.

### What you can do

On a Leafly order you can:

- **Change a quantity** with the − and + buttons.
- **Swap** an item for a different product or size.
- **Remove** an item.
- **Add** an item from your menu.
- **Set a price by hand** ("Price each $"). Leave it empty for the normal
  menu price.

You can make several changes at once. Leafly applies them **all together
or not at all**. It never applies half of a change.

### On the dashboard (Orders)

1. Open the Leafly order. You'll see **"✏️ Change items"**. It only shows
   once the order is acknowledged and Leafly has it as pending, confirmed
   or ready.
2. Make your changes. The item picker only shows products that are on the
   menu you publish to Leafly and in stock.
3. Press **Review changes**. Nothing is sent yet. The screen lists every
   change in plain words, for example "Remove 1 x OG Kush (1g)" or "Swap
   Blue Dream 3.5g for Gelato 3.5g". It also shows an estimate before
   deals.
4. Press **Send these changes to Leafly**. If you touch anything after
   reviewing, the review is thrown away and you must review again. That
   way you can never send something you didn't see.

A hand-set price is allowed on the dashboard without a PIN, because only
staff with the "manage orders" permission can use it. It is still marked in
the review and in the audit log.

### At the front register

1. Open the Leafly order in the pickup queue. Press **"✏️ Change items
   (swap, add, remove, quantity)…"**.
2. It works the same way: make the change, **Review changes**, then
   **Send these changes to Leafly**.
3. **The PIN rule:**
   - Ordinary changes (quantity, swap, add, remove at the menu price)
     need **no PIN**.
   - A **hand-set price** needs a **manager or lead PIN**. The PIN box only
     appears when the review says so.
   - A budtender's PIN is refused. Wrong PINs count toward the same lockout
     as the other register PINs.
4. **Start handover** is greyed out while the editor is open, so you can't
   hand over a bag that is mid-change.
5. Website orders don't get this button. Change those the usual way, by
   loading them into a sale.

### What happens when you send

- **Leafly says yes.** We check that the order Leafly sends back really has
  what we asked for. We save it, then rebuild the register's copy of the
  order: new items, new totals and new item count. A note goes on the
  order's timeline saying who changed what. **Leafly tells the customer.**
  - We add the new lines *before* removing the old ones, so the register
    never shows an empty bag, even if something fails halfway.
  - If Leafly's answer doesn't match what we sent, you get a warning
    instead of a green tick.
- **Leafly says no** (for example, an item went out of stock at Leafly):
  nothing changes. We re-read the order from Leafly so the next attempt
  starts from Leafly's real items.
- **No answer** (network timeout): we re-read the order from Leafly and
  tell you which of these happened:
  - "it went through";
  - "it did not, safe to try again";
  - "we can't tell, do NOT send again, use *Check this order with Leafly*
    first".

  It is only shown as a success when the re-read proves it.

### When we refuse to send, with the reason shown

We refuse, and show the reason, when:

- the order isn't acknowledged yet;
- the order is picked up, canceled or expired, or in any status other than
  pending, confirmed or ready;
- it is a delivery order (Greenway is pickup-only);
- a register sale is holding the order;
- we can't read every line of the order (Leafly removes any line we leave
  out, so we won't risk it);
- someone else changed the order since you opened the editor ("reload and
  make your change again");
- the change would leave no items (cancel the order instead);
- an item is not on your Leafly menu, not orderable, out of stock, or you
  asked for more than is on hand.

### Every attempt is recorded

- Each send is logged in the Leafly call log as a **cart** call. The
  **"Change the order's items"** row on the certification proof card (Part
  1) turns green after the first success.
- The dashboard audit log records `leafly.order_cart_updated`, `_failed` or
  `_timeout`.
- The register records `order.cart_updated_at_register` or
  `order.register_cart_failed`. Each record includes the employee, the
  device, the approving manager (if any) and the list of changes.

### How to test it (sandbox)

1. Place a sandbox test order on Leafly with two items. Wait for it to be
   acknowledged, which happens automatically.
2. Dashboard: open it, press **Change items**, remove one item, then
   **Review** and **Send**.
   - Check the order on Leafly: the item should be gone.
   - Check the proof card: "Change the order's items" should be green.
3. Register: open the same order and press + on the remaining item, then
   Review and Send. No PIN should be asked for.
4. Register: set a hand-set price. The PIN box should appear.
   - A budtender PIN should be refused.
   - A manager PIN should go through.
5. Try **Change items** on a picked-up order. It should be refused with the
   reason.

### How it was tested

- 128 rule checks in the core, which is also counted in the main test
  suite.
- 23 tests that run the real server code against a fake Leafly and a fake
  database.
- 26 tests of the register route: the PIN gates, the dry run, the refusals,
  the real register store, the audit names, the wiring, and the Leafly spec
  file itself.
- A **mutation check** (`scripts/recon/l48-mutation-check.sh`) breaks 32
  important rules one at a time on purpose. The tests must catch every one,
  and they do. The first run found one gap: nothing checked the "no answer,
  but it went through" rebuild. I fixed the test before shipping.

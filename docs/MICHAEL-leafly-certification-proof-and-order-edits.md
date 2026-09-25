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

*(Added when L-48 ships. See below.)*

# Michael — what changed on your Leafly page (L-41 and L-42)

## 1. Automatic sync works now (L-41, live)

**Why you couldn't turn it on.** When you pressed save, your schedule was
saved correctly, but the scheduler read it back from the wrong place and
always saw "off".

**Second problem.** Even once it could read your schedule, automatic runs
would have used the old all-or-nothing send. That send fails whenever any
single product has a problem.

**What it does now.** Automatic runs use the same approach as your favourite
button, "Send my whole menu, hold back only the bad ones":

- Once a day it sends the full menu. Between those full sends it sends only
  what changed.
- If nothing is held back, the daily run is a **POST** (a full replace).
- If anything is held back, it uses **PUT** instead, and removes only products
  you genuinely stopped carrying. A robot never deletes a product just because
  it has a data problem.

## 2. The page, reorganised (L-42)

**Removed:**
- The AI description drafter.
- The POST/PUT dropdown.
- The two push buttons that threw errors.

**Kept:**
- **Check integration status**
- **Read the menu back from Leafly and check it**

These two now sit together in a small "Checks (read only)" card.

**New at the top: "What each kind of send does".** One line per action:

| Action | What it does | Buttons that use it |
|---|---|---|
| **GET** | Reads only. Nothing changes. | the two check buttons |
| **PUT** | **Adds and updates, never deletes.** This is what "PUT" means. | **Send my whole menu, hold back only the bad ones** (everyday); **Send only certain products** (your hand-picked list) |
| **POST** | **Replaces the whole menu.** Anything not in the send is deleted from Leafly. | **Replace my whole Leafly menu (POST)** (new) |
| **DELETE** | Removes the products you pick. | **What is on your Leafly menu**; **Remove by product ID (advanced)** |

## 3. Your POST button, for certification

You were right that we need to prove a successful POST. Automatic sync only
POSTs on days when nothing is held back, so we can't count on it. The new card
is simple:

1. Press **Check what a POST would do**. Nothing is sent. The card shows how
   many products would go, and names any that are held back (with fix links).
2. If some are held back, tick the box that says you understand those
   products will be removed from Leafly until they are fixed. (A POST deletes
   everything it doesn't send.) If you've already fixed everything, there's
   no box to tick.
3. Press **Send POST…**, then **Yes, replace the menu**.
4. You'll see **"POST succeeded (HTTP 200) — N products sent."** It's recorded
   in the run history as a POST and in the sync activity log. That record is
   your proof for Leafly.

**Tip:** do this in the sandbox first. The optional "Fix the size problem
automatically" box usually means fewer products are held back.

**If products were held back:** once you fix them, press **Send my whole
menu, hold back only the bad ones** to put them back on Leafly.

## 4. Other small fixes

- The ordering card now tells the truth about the 15-minute rule. Automatic
  acknowledgement is on, so the app accepts each order as it arrives, and
  staff then confirm or cancel it on the Orders board.
- Wording on the schedule card, the settings card and the handbook
  (/admin/integrations/leafly/help) now matches the new buttons.

## What's next

The full plan is in `docs/leafly-integration-finish-roadmap.md`:

- **L-43:** webhook signature, following Ben's answer.
- **L-44:** tax shown the way Ben asked.
- **L-45:** order key check.
- **L-46:** answer Leafly within 9 seconds, every time.
- **L-47:** a "proved every action" checklist for certification.

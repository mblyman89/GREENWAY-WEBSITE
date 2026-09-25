# L-38 — Online orders and Leafly orders, split; steps on the details page only

*For Michael. What changed, what it looks like, and what I decided along the
way. Nothing here needs a database change, and the register does not need to
be rebuilt.*

---

## 1. What you asked for

You wanted Leafly orders out of the main online-orders table, in every view:
the open view, and the closed views you reach through search or filters. They
should still be searchable in their own Leafly section. You wanted that section
to look identical to the online-order rows, with a **Details** button on the
far right of each row, and the steps done on the details page. You wanted the
same for our own online orders: no moving orders along on the dashboard, only
on the details page. And the layout should be online orders first, the Leafly
section underneath.

That is what shipped.

## 2. What the dashboard looks like now

**Online orders (top).** Each order is one row: the name and number, the status
and where it came from, the customer, the items, the total and how long ago it
was placed, the little progress strip, and **Details** on the far right. There
are no step buttons on the row any more. The old "Mark Acknowledged / Preparing
/ Ready…" button is gone from the dashboard.

**Leafly orders (below).** The rows are built from the *same* component as the
online-order rows, so they cannot drift apart visually. Each one shows the
Greenway name and number once the order has been accepted (or `Leafly ·ABC123`
before that), the Leafly status, the customer, items, total, the progress
strip, and **Details** on the far right.

A Leafly row keeps just three things you must see without opening anything,
because each one has a clock or a stopped till behind it:

- **the acceptance countdown** (Leafly cancels an order automatically after 15
  minutes),
- **the "arrived silently" warning** (the announcer or printer didn't fire),
- **"Register stopped"** when a cancellation has halted a till.

Everything else (the step buttons, the which-step strip, the ID photos, the cart,
the cancellation history) is on the details page.

**Totals at the top.** The New / Confirmed / Preparing / Ready counters now
count online orders only, matching the table directly beneath them. The Leafly
section has its own groupings (Accept now, To build, Ready for pickup…). The
navigation badge and the dashboard cockpit still count every order, as before.

**One exception to "online orders first", kept on purpose.** If a Leafly order
is sitting **unaccepted**, the Leafly section moves to the top *and says why*
in a gold banner, because that 15-minute auto-cancel is real. As soon as
nothing is waiting to be accepted, it goes back underneath. This was already
the rule from L-22, and I left it in place.

## 3. Searching

- **The online-orders search** only ever looks at online orders now. A Leafly
  order can't be found there, not even with the "show closed" filters.
- **The Leafly section's own search** now finds an order by **customer name,
  phone number, Greenway order number or order name**, as well as by the Leafly
  id it already understood. Before, it only understood id fragments. Since the
  Leafly section is now the only place a Leafly order can be found, it needed to
  answer "find Jane's order".

## 4. The details pages

**An online order.** Press Details. The page is unchanged: status buttons,
Cancel, No-show, the manager override, and a logged Reopen for closed orders.

**A Leafly order that has been accepted.** Details opens the Greenway order
page (the same page as an online order, with the items, customer, loyalty and
medical sections). The status buttons are replaced by a **Leafly steps** box
that holds the actual Leafly buttons (Confirm, Ready, Picked up, Cancel), the
which-step strip, the order itself with the ID photos (opened for you
automatically), the countdown, and any register cancellation record.

**A Leafly order not accepted yet.** There's no Greenway copy yet, so Details
opens a small Leafly page with the Accept button, the countdown and the order.
Once it's accepted, that page forwards you straight to the Greenway order page,
where the remaining steps are.

After pressing any step, you stay on the details page and see the result there
("Confirmed", or what went wrong and how to fix it). **Back to orders** returns
you to the exact dashboard view you left: same search, filters and page.

## 5. Keeping the two copies of a Leafly order in step

A Leafly order exists twice: at Leafly, where the customer's app reads it, and
in our system. Two protections now stop them from disagreeing:

1. **When you press a Leafly step, our copy follows it.** Confirm moves our copy
   to Confirmed, Ready moves it to Ready, and so on, forward only. The order
   timeline records it as *"your name (Leafly step)"*. Before this, pressing
   Ready on the Leafly board left our copy saying "New" at the register. If
   Leafly accepted the step but our copy couldn't be updated, you get a gold
   warning; the Leafly step still stands.
2. **The Greenway status buttons are refused for an open Leafly order**, by the
   server itself and not just hidden on screen. Changing only our copy would
   leave the customer's Leafly app showing the wrong step. If anyone tries, for
   example from an old tab, they get a plain-English explanation and the
   attempt is recorded in the audit log.

Picked up and Cancel still close our copy exactly as they did before. A
**closed** Leafly order can still be reopened with a written reason, like any
other order.

## 6. How it was checked

- A new test file (`orders-dashboard-split.test.ts`, 24 checks) covers every
  point above: exclusion from the table *and* the counters, search, no step
  buttons on the dashboard, Details links, returning to the details page, the
  copy following Leafly, the server-side refusal, the new page and its
  time budget.
- **The tests were tested.** I deliberately broke the real code 15 different
  ways (for example: letting Leafly orders back into the table, removing the
  server refusal, dropping the "follow Leafly" step, breaking the search), and
  confirmed each break turned the tests red. One break slipped through on the
  first pass (neutralising the refusal with a hidden `false &&`); I tightened
  that test, and it now catches it. All 15 are caught, and the code was restored
  after each one.
- Eight older tests pinned the Leafly buttons to the dashboard row. Each was
  updated to follow the buttons to their new home, with a note saying why. None
  was simply deleted, and one (the "combined history" check from L-22) was
  rewritten to state the new rule instead of the old one.
- A pure-logic self-test (43 checks) runs in the compliance pipeline on every
  deploy.
- The L-33 auto-accept guide now tells you the "Accepted automatically" badge is
  on the details page.

## 7. What did not change

- Leafly's own rules, the webhook, auto-accept, the sweeper and the register
  pickup flow are all untouched.
- No database migration, and no register rebuild.
- The count badge in the navigation and the cockpit numbers still include
  Leafly orders.

**Next:** back to the Leafly integration setup, based on Ben's reply.

---

**Update (L-40):** the dashboard layout described above was refined. Our
section is now labelled **Greenway orders**, and both sections are boxed
panels with identical controls. Leafly no longer moves above ours: it is
always second. See `docs/l40-identical-order-panels.md`.

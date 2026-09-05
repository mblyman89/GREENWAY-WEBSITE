# Slice 19 — The register's transaction history: finding a sale without the receipt

**Requested by:** Michael Lyman, Greenway Marijuana, Port Orchard WA.

> "I want to now add a feature to the register that compliments the return an
> item function. Right now it's just a box that you enter or scan the receipt
> code. I want the register to show a history of transactions with the name of
> the customer and total and whatever other data the enterprise industry
> standard practice method for viewing and interacting with past sales on the
> register."

Everything below was established by reading the code in this repository and by
reading the published documentation of two enterprise point-of-sale systems.
There are no database credentials in the environment this work was done in, so
nothing here rests on a live query, and nothing here rests on a guess. Every
claim about this codebase carries the file and line that supports it, and every
behaviour carries the test that fails when the behaviour is removed.

## What the returns desk was before this slice

The owner's description of the current state is exactly right, and the code
says so plainly. The returns modal lives in `src/app/pos/RegisterShell.tsx`
starting at line 3120. Its only way in is a single text input: eight characters
wide, `maxLength={8}`, placeholder `"8 characters"`, with a `Find` button that
stays disabled until `receipt.trim().length` reaches four. There is no list, no
browse, no search. A budtender either has the receipt number or they have
nothing.

That receipt number is not a friendly code. `src/lib/pos/receipt-core.ts` lines
100 to 103 derive it from the sale's client UUID:

    uuid.replace(/-/g, "").slice(-8).toUpperCase()

The last eight hex characters of a UUID, upper-cased. Something like
`05E82C3301`. It is a fine machine key and a poor human one. If the paper slip
went in the bin, or the customer is standing at the counter describing a
purchase from last Tuesday, the eight-character box is a locked door.

Worth being precise about what did and did not already exist, because a
neighbouring feature made this look solved when it was not. There is a
member-history endpoint in the POS surface, but it is *per member*: it needs a
`customerId` obtained from a prior member lookup, so it only answers "what has
this specific person bought" after you have already identified the person. It
is not a register-wide list of recent sales. A grep of the POS surface for
`recentSales`, `transactionHistory` or `salesHistory` returns nothing. The gap
the owner described is real, and this slice fills it.

## What the enterprise systems actually do

The owner asked for "the enterprise industry standard practice method." That is
a research question, not a taste question, so it was researched rather than
invented.

**Oracle Retail Xstore 22.0.** When a customer returns merchandise without a
receipt, Xstore does not leave the associate stranded. It presents an
*Available Transactions* list, and the columns it chooses are **Date**,
**Trans** (the transaction ID), **Qty Avail** and **Trans Total**. Xstore also
draws a hard line between a *verified* return, where the original transaction
was found, and a *blind* or unverified return, where it was not — blind returns
above a configured threshold require a manager override. And when a receipt
barcode is scanned at the Sale screen, Xstore enters return mode directly
rather than making the associate navigate there.

**Lightspeed X-Series, "Sales history".** A tabbed view — All, Process return,
Continue sale — sorted newest first. It filters by date, time range, **customer
name**, **receipt number** and note, with further filters for product, sale
total, register, status, user and payment type. Tapping a row expands it to
show staff, customer, products and payments, and offers the actions: return,
reprint the receipt, void.

The two systems disagree about plenty, but they converge on a core, and the
convergence is what got built:

> **date and time · receipt number · customer · total · item count · status ·
> staff — newest first, searchable, and tappable to act on.**

That list is the answer to "whatever other data." It is not my preference. It
is what both reference implementations independently show.

## What a budtender sees now

Open **Return an item**. Above the receipt box there is now a line reading
**No receipt? Find the sale**, with a **Recent sales** button beside it. The
list does not load until that button is pressed — an iPad that never needs the
panel never pays for it.

Press it and the recent sales appear, newest first. Each row carries the
customer on the left and the total on the right in large type, because those
are the two things a person standing at a counter matches against first. Under
that, in smaller grey text: the date and time, the staff member who rang the
sale, and the receipt number in a monospaced font on the right. Under that, the
item count and the first few item names, with `+2 more` when a basket runs long.

Above the list is a search box: **Search name, receipt, item or staff**. It
filters across all four, which is the Lightspeed filter set reduced to the
fields this store actually has.

Rows that cannot be returned are still shown, greyed out, and labelled with the
reason — `Voided - nothing left to return`, `Fully returned - nothing left to
return`. A partially returned sale stays tappable and says how much is left:
`Partially returned - 1 still returnable`. This was a deliberate choice and it
is the opposite of hiding them. If a budtender voided a sale ten minutes ago
and the sale then vanished from history, the honest conclusion they would draw
is that the register lost it. Showing it, marked, answers the question before
it is asked, and stops anyone starting a return that policy will refuse.

Tapping an actionable row fills in the receipt number and immediately runs the
existing lookup, landing the budtender in exactly the state they would have
reached by typing the code by hand. That immediacy is Xstore's documented
behaviour — selecting a transaction enters return mode, it does not merely
stage a field.

## The one thing this slice most deliberately is not

It is not a second way to give money back.

This mattered more than any other decision here, so it is enforced in four
independent places rather than trusted to intent.

The panel reads and nothing else. `src/lib/pos/transaction-history-store.ts`
exports exactly one function, `listRecentTransactions`, and the suite asserts
that `Object.keys` of the module equals `["listRecentTransactions"]` — a
mutating export cannot be added later without a test failing. The fake database
client used in the tests throws on `update`, `insert` and `delete`, so a write
is not merely detected, it is impossible to perform silently. The new endpoint
`GET /api/pos/transactions` is a GET, device-authenticated through
`authenticateDevice` like its neighbours. And tapping a row calls the same
`lookup()` the manual box calls, which posts to `POST /api/pos/returns` — the
one path that carries the manager PIN, the WAC 314-55-079(12) attestations, the
CCRS correction queue and the loyalty clawback.

The refund logic was not copied, wrapped, or re-implemented. There is still
exactly one refund path in this register, and this panel is a way of arriving
at it, not an alternative to it.

## Two agreements enforced by construction rather than by memory

**The window.** `lookupSaleByReceipt` in `src/lib/pos/returns-store.ts` scans
back `LOOKUP_WINDOW_DAYS`, which is `RETURN_WINDOW_DAYS + 2` — the fifteen-day
return window from `src/lib/pos/returns-core.ts` line 49, plus two days of
slack so a sale on the edge is still findable. The history panel scans the same
window, derived the same way.

The failure this prevents is worth naming. If the list reached back further
than the return path accepted, staff would see a sale, tap it, and be told it
is out of window — a rejection they could not have predicted from what was on
screen. The list would be lying. So `HISTORY_WINDOW_DAYS` lives in the pure
core as the number the interface quotes to the user, and a test asserts
`HISTORY_WINDOW_DAYS === RETURN_WINDOW_DAYS + 2`. If anyone ever changes the
store's return policy, that test fails and the on-screen number cannot silently
go stale.

**The customer's name.** `src/lib/pos/returns-store.ts` line 88 already had a
private helper, `privacyLabel`, rendering a customer as first name plus last
initial — `Jane D.` The register has a stated privacy budget, written down at
`src/lib/pos/member-history-core.ts` line 21: no contact details, no notes, no
birthdate, because the response lands in the memory of an iPad on a sales floor.

A list of recent customers is precisely the feature that erodes that budget by
accident. Rather than duplicate the helper and hope the two copies stayed in
step, the shared version now lives in the pure core and both sides use it. The
test asserts that a payload containing `Jane D.` does **not** contain the string
`Doe` anywhere, and separately that no row carries an `email`, `phone`,
`birthdate`, `dob`, `address` or `notes` key. A budtender can identify a
customer standing in front of them. They cannot harvest a mailing list.

## Reading the data honestly

`listRecentTransactions` reads the same ledger the receipt lookup already
trusts: processed `sale` events in `pos_sale_events` that produced an order. It
then joins the orders, their lines, prior returns from `customer_returns`, the
attached customer and the employee who rang it, and hands raw facts to the pure
`shapeTransaction`.

Three details are worth recording because each one was a place where a
plausible-looking shortcut would have produced a lie.

An event whose order no longer exists is **skipped**, not rendered as a
placeholder. A row that cannot be acted on is worse than no row, and inventing
one to keep the counts tidy would be inventing data.

A failed read is reported as a failure. An empty list means "no sales in the
window" and never means "the read did not work" — those are different answers
and staff deserve to know which one they are looking at. The panel says
`Could not reach the server - the receipt number still works.` and offers a
retry, which is both honest and useful: the manual box is unaffected by the
panel being down.

The customer and employee name lookups are the deliberate exception. Their
errors are **not** checked, and that is on purpose: a name lookup failing
should not blank out an otherwise perfectly good list of sales. Those rows
simply say `Walk-in`. A sale genuinely made without a member also says
`Walk-in`, never an empty space where a name should be.

One schema note, recorded because I got it wrong first and the code caught it.
I initially wrote the employee join as `first_name, last_name`, matching the
`customers` table. Migration 0037 shows `employees` stores a single `full_name`
column. Reading the migration before running anything caught it; the join is
now `.select("id, full_name")` with a comment recording the verification.

## How this was verified

`src/lib/pos/transaction-history-core.ts` is pure — no imports, no clock, no
network — and carries **49 assertions** in `__runTransactionHistoryCoreTests()`,
registered in `scripts/compliance/run-pure-selftests.ts` so it runs with every
other core in the repo. It covers the receipt derivation, the classification
rules, the privacy label, the search, the sort, and the clamps: a voided sale
offers nothing back, an over-return can never drive the returnable count
negative.

Because a core can agree with itself and still be wrong about the real system,
`tests/compliance/transaction-history.test.ts` drives the **real** store and the
**real** core against a PostgREST-shaped fake — **21 tests**, covering the
owner's stated ask, the privacy budget, the read-only guarantee, status
honesty, the window agreement, and six distinct failure modes.

One of those tests deserves singling out. `receiptNumberFromUuid` in the new
core must produce byte-identical output to `receiptNumber` in
`src/lib/pos/receipt-core.ts`, or the panel would hand the returns endpoint a
code it cannot resolve. The test imports both functions and asserts they agree
across several UUIDs. The two implementations are checked against each other,
not against my memory of what the first one did.

A suite that passes the moment it is written has proved nothing, so every
assertion was checked by breaking the source on purpose. Nine mutations were
applied one at a time, each reverting a real behaviour: leak the full surname;
let a voided sale offer units back; drift the window off the return window;
render a blank name instead of `Walk-in`; report a failed ledger read as "no
sales"; swallow a failed line read; drop the newest-first sort; ignore prior
returns so a returned sale looks fully returnable; drop the staff name.

**All nine turned the suite red.** Both source files were confirmed
byte-identical afterwards by SHA-256, and the harness was deleted.

Final state of the gates:

- `tsc --noEmit` — exit 0
- `eslint` on all six touched files — 0 errors, 0 warnings
- pure self-test runner — `ALL PURE SELF-TESTS PASSED`, including
  `transaction-history-core: PASSED 49 assertions`
- full suite — **569 files, 14,363 tests, all passing**

The baseline entering this slice was 568 files and 14,342 tests. The difference
is exactly this slice's one new file and twenty-one new tests, and nothing else
moved.

## Files

New:

- `src/lib/pos/transaction-history-core.ts` — pure shaping, classification,
  search, sort and the privacy label
- `src/lib/pos/transaction-history-store.ts` — the read, server-only
- `src/app/api/pos/transactions/route.ts` — `GET /api/pos/transactions`
- `tests/compliance/transaction-history.test.ts` — 21 behavioural tests

Modified:

- `src/app/pos/RegisterShell.tsx` — the history panel inside the returns modal,
  and `lookup()` gained an optional explicit receipt so a row tap runs the same
  lookup without waiting a render for state to settle
- `scripts/compliance/run-pure-selftests.ts` — registers the new core

## What was deliberately left out

Lightspeed offers reprint-receipt and void directly from its history rows. Both
already exist in this register as their own flows, the void flow with its own
manager PIN and reason capture at `RegisterShell.tsx:2862`. Wiring them into
history rows as well would mean two entry points into each, which is the same
mistake Slice 17 removed when it retired the second handover door. If the owner
wants them there, they should move rather than multiply — and that is a slice of
its own, not a quiet addition to this one.

Xstore's blind-return threshold with manager override is not implemented, since
this register has no blind-return path at all: a return here requires a located
sale. That remains correct and is not changed by this slice.

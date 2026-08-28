# Register cash — your four questions answered

You asked four questions. Two answers are yes, two are no, and the two "no"s
matter as much as the yes's.

**Your float, checked first.** One drawer of 5 tens, 10 fives, 50 ones and a
roll each of quarters, dimes, nickels and pennies is **$167.50** exactly. Three
of those plus the master till is **$1,502.50** on hand before a single sale.
Your original master mix came to $999.50 — the 90 nickels — and you corrected it
to 100. That 90-nickel version is now a permanent test: every count in this
system states its total twice, once as coins and once as dollars, and when the
two disagree it refuses instead of picking a winner.

## 1. Opening a till — yes, but only when the money moves

Cash going from the vault into a drawer debits 10110 Cash on Hand — Tills and
credits 10100 Cash on Hand — Vault. Two lines, and your total cash is identical
before and after. It is a transfer, never income. On an ordinary morning where
the float simply stayed in the drawer overnight, nothing moved, so there is no
entry — and the system now says that out loud instead of going quiet.

## 2. Closing a till — yes, and this is the one that matters

This is the entry your books cannot live without. Every cash sale already
debits 10110. If nothing ever credits it, the books claim your drawers hold
more money every single day, forever, and no report would flag it. The close
fixes that: 10400 Undeposited Funds is debited with exactly what physically
left the drawer, 10110 is relieved, and any difference goes to 50920 Cash Over
/ (Short) — over is a credit, short is a debit. A drawer counted below its own
float is refused and sent to a manager rather than posted, because that is not
a bookkeeping question.

## 3. Swapping large bills for small — no entry, ever

Breaking a hundred at the master till is the same cash, in the same account,
worth the same amount. Denominations are an operational fact, not an economic
one. Still worth logging for drawer accountability; it just never reaches the
ledger. One guard: if the two sides of the "swap" are not equal, it is refused —
that is cash moving under a label saying it isn't.

## 4. Every sale — already its own entry

This was already true before I touched anything. Each sale posts as it is rung,
debiting 10110 for the cash taken. So the shift-end entry is the **close**, not
a summary of the day's sales. Doing both would count the same money twice and
overstate your revenue. Worth knowing that half the loop was already running at
full speed while the other half did not exist at all.

## What you can see, and what is not done

Open the end-of-day report at **/admin/registers/eod**. There is a collapsed
panel, *"What the ledger does with the cash drawer,"* using your own float. The
worked close is deliberately $4.00 short so you can see 50920 as a real line
rather than a possibility. Every figure is calculated by the same code that
would post the real thing — none of it is typed in.

**Nothing posts yet.** Closing a shift still does not write to the ledger. That
gap is D-39, it stays open, and the panel says so on its face: *these are not
your books.* What this settles is which entry each event produces and which
events produce none, so the posting work that follows has nothing left to
invent.

One thing worth telling you plainly. I first marked these three items as
partly-wired in the compliance census, reasoning that you can now see them. A
tripwire in the test suite rejected that and it was right — showing you an entry
is not the same as posting it. The count of unfinished items actually went *up*,
from 6 to 9, because three of them now have working math and still no door. A
number moving the wrong way is the correct report when you have built one half
of a loop, and I would rather hand you that than a prettier one.

Checks: 12,692 tests pass, and 43 of 43 deliberate sabotage attempts on this
work were caught — including eight that cut the panel out of the page to prove
you would notice if it vanished.

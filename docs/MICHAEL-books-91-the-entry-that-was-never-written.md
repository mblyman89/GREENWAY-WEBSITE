# The pending entry that was never written — and a worked example you can look at

You accepted a delivery, the product went to inventory and onto the menu, and no
draft journal entry appeared. You asked me to find out why and make sure it was
wired properly. What I found was not what I expected.

## The wire was connected the whole time

My first guess was another dead door — a finished engine nobody calls, which is
what bit us in books-88 and books-90. That guess was wrong, and I checked before
believing it. Finalizing a manifest really does call the vendor-bill poster. The
intake screen really does render a red banner when the books refuse. The
"Waiting to Post" page hides nothing and filters nothing. Every link existed.

What was broken is subtler and, I think, worse. The poster can refuse in nine
different ways, each with a specific, useful sentence — and every one of those
sentences was handed to the web address you were redirected to, and to nothing
else. Nothing went into the database. Navigate away, refresh, or come back
tomorrow, and the reason vanishes with no trace the attempt was ever made. A
receipt written in disappearing ink. And when a finalize accepted no lots at
all, the poster was never called and nothing was said — so "nothing was owed,
correctly" looked exactly like "the wiring is broken."

## Why yours most likely refused, and why I did not fix it by guessing

I could not read your actual manifest — this build environment has no connection
to your database, and inventing what your data said would be exactly the guess
you have told me never to make. What I could read is the code. A manifest
imported from a CCRS transfer file carries **no prices**, because the state file
does not contain any. The bill engine skips any line costing zero, then refuses
the whole bill with: *"Every billable lot on this delivery carries a cost of
zero, so there is nothing to owe. Add the unit costs from the vendor's invoice,
then finalize again."* That message was right. You never got to see it.

I deliberately did **not** make missing costs default to some number. A made-up
inventory cost becomes a made-up deduction, and under 280E that is a tax
position neither of us could defend.

Every books outcome of a finalize is now written to the manifest's permanent
timeline, the one already on that page: posted, refused with the exact code and
message, or skipped-because-nothing-arrived. The red banner still appears for
whoever is standing there; the timeline is what is still there next week.

## You asked to see one, so here is one

At the top of **Accounting → Waiting to Post** there is now a collapsed panel:
*"Show me what a journal entry looks like."* It walks a delivery from arrival to
posted ledger — the draft with debits and credits in separate columns, the one
button and why it says what it says, then that same entry as it appears in the
general ledger afterwards.

Not one number in it is typed. It states a small delivery — 12 units at $875.50
and 24 at $412.25 — then hands it to the *same three functions* your real
deliveries go through. The $20,400.00 payable on screen was computed by the
engine you actually use, so if that engine changes, the example changes with it
instead of quietly becoming a lie. It is labelled clearly as not your money, and
it works even when the database is unreachable. One thing worth taking from it:
a vendor bill is exempt from the second-approver rule, so it posts on one click
however large it is. That requirement is for unusual entries, and a bill backed
by a state manifest is not unusual.

## Honest limits

Nothing was posted to your live books here, and I still cannot tell you which of
the nine refusals your manifest hit — only that it is now answerable, because
the next one records itself. I also corrected a stale note in our own coverage
census that had wrongly claimed, since books-83, that nothing called the poster.

All five gates pass: 12,596 tests across 497 files, plus types, lint, quotes and
the census check. I broke this slice 18 ways on purpose, including cutting the
example off the screen and cutting the poster out of finalize, and all 18 were
caught. Recorded as D-71, with a new standing rule 134: a refusal that is not
written down did not happen.

# The block comes off

**Slice books-89 · for Michael Lyman**

## The $5,000 rule: notified, not blocked

Last slice I told you a $5,000 entry would refuse until a second person approved it. You told me that person does not exist and never will — you are the only owner-operator with books access — and that you write invoices over $5,000 routinely. You were right and I have changed it.

Your two sentences were doing different jobs, so I split them. **"I liked it because it flags large purchases"** is a *warning*. **"It needs to allow me to approve it"** is about a *block*. The system had one switch wired to both, which is why turning off the annoyance would have turned off the useful part with it.

**The block is off. The flag stays on.** Migration `0211` records that a sole owner-operator cannot satisfy a two-person rule, quotes your own words as the reason, and deliberately leaves the $5,000 figure alone. Large entries still come back marked large — you will simply be able to approve them yourself. The day a second person gets books access, one setting restores the old behaviour.

Two things remain, and I have put them on the list rather than half-doing them. The "this one is large" marker is calculated correctly but **is not yet drawn on any screen**, so for now nothing visibly changes except that you are no longer stopped. And when you want telling *outside* the app — text, email — I need to ask you which, so I have not guessed.

## Your safety net, written into the rules

You asked me to make end-to-end wiring a standing rule so nothing important gets missed again. That is now **rule 133**, and it is the strictest one yet: a slice is not finished when the code works, it is finished when **a human being can cause the effect** — screen, to button, to service, to ledger — and every link is named out loud in writing. Anything left deliberately unconnected must *say so* in plain English rather than sit quietly. And the sabotage test must now include cutting the wire itself, to prove the alarm actually sounds.

I ran that on this slice. Fifteen deliberate acts of sabotage, including severing the new button from its engine — the exact bug you found last time. **All fifteen were caught.** Two got through on the first attempt: the list of things being watched was itself unwatched, and one safety check was never actually exercised. Both are fixed, and both would have been invisible without the rule you asked for.

## The ATM settlements now reach your books

This slice's census work is defect **D-40**, and it is the same shape as the one you found. Since books-69 the system could read a settled ATM day and work out the entry correctly — surcharge income to your ATM business, cash out of the machine. **Nothing turned that into a journal.** It calculated, then stopped.

On **ATM → Transactions** there is now a panel: press **File settled days as drafts**. Each day is reported back — filed, already filed, or refused with the reason. Refusals come first. Entries land as drafts, never auto-posted, because you reconcile against a physical count before anything is real.

The surcharge is booked as income of the ATM business, which is a separate trade from the store and **not subject to 280E** — that separation is the reason the ATM account is worth keeping clean.

**One honest limit.** ATM *settlements* are wired. **Loading cash into the machine is not** — no part of the system builds that entry yet, and wiring a button to nothing would be theatre. D-40 is closed for one half and openly recorded as open for the other. Under the new rule, saying so is required.

**Where things stand.** 12,560 tests pass. The census now shows 24 of 35 areas unwired, down from 26 — the two that moved are the ones this slice and the last one connected. Still ahead: register cash, ATM vault loads, intercompany transfers, B&O accrual, fixed assets, loans, and the Cultivera cutover.

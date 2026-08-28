# Payroll now reaches the books

**books-86 · D-38 closed**

## What changed

The pay run screen could always work out what everyone was owed. It could not write any of it down. The journal builder that splits wages between selling and inventory handling — the §280E split, which decides what you can actually deduct — was finished, correct, and reachable only from a development script, and had been since books-70.

There is now a **Record this payroll in the books** button on `/admin/books/pay-run`. It builds the entry, sends it to the ledger as a draft, and it lands in Drafts for approval like everything else. The old "Not connected yet" note is gone, because it is no longer true.

## Four things I found by measuring, not assuming

**A payroll where nobody earned anything came back "ready to post" with an entry containing no lines** — a journal entry recording that nothing happened. It now refuses and says so.

**Voluntary deductions have nowhere to go.** A health premium or a retirement contribution is money you hold back from someone's cheque and then owe to a third party. The payroll journal has no account for that yet. If one appeared today, the entry would credit net pay short by that amount and *still balance* — the kind of wrong nobody finds for months. It refuses instead. The list is empty today, so this changes nothing now; it will matter the first time you offer a benefit.

**A part-time split is genuinely ambiguous and I would not guess it.** If someone's record says 40% cultivation, nothing on file says what the other 60% was. Assuming it stayed cultivation overstates what rides into inventory. Assuming it was selling understates it. Both are wrong on a tax return, so the system refuses and asks for the whole split with a written basis behind it. That written basis is the difference between a deduction that survives an audit and one that does not.

**Nothing connects a pay period to a payroll run.** The database has a guard that catches an already-posted payroll coming back with different money in it — a correction, as opposed to a double click. It needs an id the app cannot supply, because the link does not exist. Double-posting is still blocked; a *changed* run is not automatically detected. That is logged as **D-68** rather than papered over.

I also found the ledger map listed five accounts for payroll when the entry actually touches seven. Employer tax and garnishments payable were missing. Fixed.

## What protects it

51 new tests. Then I deliberately broke my own code sixteen times — dropped the ownership check, resolved the ambiguous split, ignored a voluntary deduction — and confirmed the tests caught every one. Four breaks initially slipped through; those holes are now closed.

Three old tests were written to fail the moment this got wired. I turned each around rather than deleting it, so they now guard the opposite fact. If someone later cuts this wire, a test fails instead of payroll silently going unbooked.

The books-39 report I gave you said the button was disabled and that connecting it would come later. I did not edit that report to match today. It says what it said; the promise has now been kept.

## What is not proven

No payroll has been posted against your live database. The logic is tested hard and the wire is checked end to end, but the first real one is yours. Every refusal is written in plain English with what to do about it, so if something stops you, the screen tells you why rather than just greying out. Payroll goes live 1 January 2027; this is ready well ahead of that.

## Still ahead

Register cash, the ATM classifier, intercompany, B&O accrual, fixed assets, loans, cutover inventory, Cultivera. Clearing payroll against the bank withdrawal is its own slice and is not done.

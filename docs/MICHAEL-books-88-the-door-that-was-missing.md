# The door that was missing

**Slice books-88 · for Michael Lyman**

## Your question, answered first

You asked whether ATM fees should show on the approvals page. **Yes — and you found a real bug.** The page was not empty because you hadn't done anything. It was empty because nothing in the system could ever put a bank or ATM charge there.

In books-84 I built the piece that reads your connected accounts, works out what each charge is, and files it as a draft. It works — 24 tests, every sabotage caught. **Nothing called it.** No button, no link, no job. Your ATM fees arrived and stopped. Now defect **D-70**.

The other three posters — sales, vendor bills, audits — survived because each hangs off something the system already notices: an order finishes, a manifest arrives, an audit closes. A bank feed has no such moment. Somebody has to *ask*, and the asking is what nobody built.

## What I built

On **Books → Bank** there is now a green panel: pick an account, press **File charges as drafts**. Every row is reported back — filed, already recorded, or refused. **Refusals come first**, because they are the ones needing you. Roughly 54 of your 60 real vendors are recognised from your Sage history; the other six refuse by name rather than guess.

It is a button, not an automatic job, on purpose: a refusal nobody reads is a refusal nobody acts on.

## How approving and posting will work

Everything moves in **three steps: submit → approve → post.** Nothing skips a step.

**1. Submit.** A draft is created — by a sale, an intake, an audit, or now that bank button. A draft is visible but touches no report: your P&L, balance sheet and tax figures do not move.

**2. Approve.** Go to **Books → Approve journals** (`/admin/books/drafts`). Every draft appears there whatever its source — nothing is filtered. Open one and you see the full entry: each line, each account, debits and credits, the total. Check it, then press approve.

**3. Post.** Approving and posting happen on one click. Posting makes it real: the entry takes the next journal number in an unbroken sequence — no gaps ever, because a gap is the first thing an auditor asks about — and from that instant **it cannot be edited or deleted by anyone, including you.** A mistake is fixed with a reversing entry, which is what your CPA expects.

**One rule will occasionally stop you, and should.** Any entry of **$5,000 or more** needs an approver who is not its author. Right now that is always you, so a large manual entry refuses in plain English rather than silently posting. That is the control working; it can be switched off per entity, but only deliberately and with a written reason recorded. Below $5,000, and for entries the system generated itself — sales, bank charges, vendor bills — one click is all it takes.

**When things will appear.** The ledger is empty because nothing has posted yet, which is correct. Press the bank button and your ATM fees appear as drafts within seconds. Sales flow in when the POS goes live November 1, vendor bills as manifests arrive, inventory from the October 31 audit.

**Honest notes.** The census — the document tracking what reaches the books — claimed both of these were live. I've corrected both rows to say how they were wrong. The old test proved the *service* calls the ledger, never that anything calls the *service*: reachability measured one link too early. I did not delete it; I inverted it and widened it to cover **all four** posters, so no future poster can be finished and unreachable while its tests stay green. The first mutation in this slice's probe severs the new button — the exact state you found — and the suite goes red.

**The numbers.** 493 test files, 12,525 tests, all passing. 13 of 13 sabotages caught. Type check, lint, self-tests, verbatim and census checks clean. No database changes.

**Next:** D-39 register cash, D-40 ATM classifier, D-41 intercompany, D-42 B&O accrual, D-43 fixed assets, D-44 loans, D-48 cut-over inventory, D-49 Cultivera. Thank you for telling me the page was blank — that was worth more than another test.

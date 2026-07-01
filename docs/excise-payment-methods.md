# WA Cannabis Excise Tax — Payment Methods (Source of Truth, verified)

> Grounded in the WSLCB **Cannabis Tax Reporting Guide** (Payments section) and the
> **Cannabis Payment Process Reminders** bulletin (03/04/2026), plus the official
> **Cannabis Excise Tax ACH Payment Instructions** PDF.
> Sources:
> - Cannabis Tax Reporting Guide: https://lcb.wa.gov/taxreporting/cannabis-tax-reporting-guide
> - Payment bulletin: https://content.govdelivery.com/accounts/WALCB/bulletins/40ca828
> - ACH instructions PDF: https://lcb.wa.gov/sites/default/files/publications/Tax_and_Fees/Cannabis%20Excise%20Tax%20ACH%20Payment%20Instructions.pdf
> - PayStation deep link (Retail Lockbox): https://www.paystation.com/TokenPayment/WSLCB

## The honest constraint (verified)
There is **no public payment API**. A licensee pays their cannabis excise tax through
one of the LCB's human portals or by mail/in-person. Our system therefore builds a
**guided payment workflow** — it pre-fills a deep-link into the correct portal with the
license number, amount due, and due date, tells the employee exactly what to enter, and
records a **payment reconciliation** so we know each month is filed AND paid. We never
fabricate a payment integration.

## Method 1 — CCRS "Make a Payment" (ACH) — recommended
- In CCRS (SAW login at https://cannabisreporting.lcb.wa.gov/), use the **Make a Payment** link.
- CCRS auto-fills your **license number** and the **current date**. You enter:
  - Payment amount
  - Contact (name, phone number, email)
  - Banking routing + bank account number
- The payment date recorded is the date you submit the request (cannot be scheduled in advance).
- A receipt is emailed to the address you enter.

## Method 2 — Retail Lockbox / PayStation (card or ACH)
- Deep link base: `https://www.paystation.com/TokenPayment/WSLCB`
- Verified token params (from the LCB PayStation link):
  - `custom.productCode = MarijuanaExciseTax`
  - `custom.billerID = EXC`
  - `custom.billerGroupID = WSL`
  - `custom.accountidentifier1 = <your 6-digit license number>`
  - `custom.amountdue = <dollars, 2dp>`
  - `static.transactionamount = <dollars, 2dp>`
  - `custom.dueDate = <YYYY-MM-DD>`
  - `custom.disallowLogin = N`
- The PayStation token format is `key~value~<editableFlag>` joined with commas; the LCB
  link marks the amount/date/account fields with the appropriate flags. We reproduce the
  same shape so the portal opens pre-filled.

## Always: email the report
- Email the completed **LIQ-1295** to **cannabistaxes@lcb.wa.gov**, ideally the SAME day
  you submit payment (whichever method).
- Mailing address (check / cashier's check / money order):
  Washington State Liquor and Cannabis Board, PO Box 3724, Seattle WA 98124-3724.
  Put the license number on the check.

## Due date + penalty (verified)
- Reports + payment are due on/before the **20th** of the month after the reporting month
  (next business day if the 20th is a weekend/holiday).
- **2% late payment penalty** on the balance after the due date (LIQ-1295 Box 8).

## Implications for our build (Slice 55)
1. A **guided payment panel** on the excise tab: a pre-filled PayStation deep-link + the
   CCRS "Make a Payment" checklist + the cannabistaxes@lcb.wa.gov email reminder.
2. A **payment reconciliation record** per return (method, confirmation #, paid amount,
   paid date) so a return is tracked filed → paid.
3. The excise tax is filed and paid by an authorized employee; these are drafts/records
   they validate — we never auto-submit.

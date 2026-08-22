# Garnishments and child support: how to set one up from the judgement

**Prepared for Michael Lyman · Greenway Marijuana · books-38**

---

## Before anything else — the answer to your question

You wrote:

> "the child support and garnishment page does not have a way for me to enter that in. Is it on other page like the payroll setup page?"

You were right, and the honest answer is worse than you assumed. It was not on another page. It was on **no page at all**.

Here is exactly what I found before writing a line of code, because I want you to see that this is a finding and not an impression:

- The `wage_orders` table has existed since migration 0198, with every field a judgement carries, seven order kinds, and database constraints that make a half-entered order impossible to save.
- `garnishment-core.ts` — 940 lines — computes every withholding ceiling correctly, and it is tested against the statutes.
- `garnishment-store.ts` exported exactly **one** function: `loadGarnishmentBoard()`. It could read. It could not write.
- I searched the entire repository for any `insert`, `update` or `upsert` touching `wage_orders`. There was exactly one hit, and it was a piece of text inside a comment.

So the system could read wage orders, display wage orders, and calculate withholding on wage orders — and there was no way on earth to put one in. The table would have stayed empty forever, and the garnishments page would have kept saying "no orders on file." That sentence is what the screen shows when everything is fine. It is also what the screen shows when a live court order is being ignored. Those two situations look identical from the outside, which is precisely why this needed fixing before you ever ran payroll.

That is now done. The entry form is on the page you were already looking at — `Books → Garnishments` — sitting above the list of existing orders.

---

## Why the form is where it is

I did not create a separate "add a garnishment" page, and the reason is worth one paragraph because it is the kind of decision that looks arbitrary later.

Entering an order and seeing the orders that already exist are the same job. If they live on two different screens, you cannot see that an order is already on file from the page where you are typing it in. That is how the same writ gets entered twice, and a writ entered twice withholds twice. The form is above the list because until now there was no way to enter an order at all, and a court order has a deadline attached to it — the way in should never be something you scroll to find.

---

## The single most important thing on this page

**Write the date of service on the envelope the moment the paper arrives, before you read a word of the order.**

Everything else on a court order can be re-read off the document next week. The date it was handed to you cannot. It is not printed on the order. It lives on the process server's return, the certified-mail green card, the courier's receipt, the postmark, or a received stamp if somebody at the shop applied one — and if the envelope goes in the bin, that fact is gone.

It matters because **every deadline in this area is measured from service, not from the date the judge signed.** The order's signature date is right there on the last page, and the service date is not, which is exactly why people copy the wrong one into the wrong box. That single keystroke misstates both statutory clocks at once.

Here is the shape of it, using the example the system itself carries:

> An order signed 5 January 2026 and handed to the shop on 20 January 2026 has its answer due **9 February**, not 25 January.

Get that wrong in the generous direction and the screen reassures you while the deadline passes.

---

## What you must do first, and it is not withholding money

There are two separate duties when an order arrives, and the one everybody skips is the first one.

**You must ANSWER the order.** This is separate from withholding, it comes first, and failing to do it is an independent route to liability. Withholding every cent perfectly does not cure a missing answer.

For a **support order**, RCW 26.18.110(1) requires a sworn affidavit within **twenty days of service**. The statute says, in its own words:

> "An employer upon whom service of a wage assignment order or income withholding order has been made shall answer the order by sworn affidavit within twenty days after the date of service. The answer shall state whether the obligor is employed by or receives earnings or other remuneration from the employer, whether the employer will honor the wage assignment order or income withholding order, and whether there are either multiple child support or maintenance attachments, or both, against the obligor."

For a **creditor writ**, the deadline is printed on the face of the writ and it is **not always twenty days**. Find it and diary it today. This is why the system asks you to type the deadline off the document rather than computing one for you — I will not guess at a number that is printed on paper in front of you.

What happens if you do not answer a creditor writ is the part worth remembering. Under RCW 6.27.200 a court can enter judgment against **Greenway** for the **full amount your employee owes** — not the slice you should have withheld from one cheque, the entire debt, with interest and costs. There is a relief valve if you move within seven days of the execution writ, but relief requires you to notice it, hire counsel, and act fast. The cheap version of this is answering on time.

---

## The ten steps, in order

This is the sequence the system carries, and the order is deliberate.

**1. Write the date of service on the envelope, before anything else.**
The moment the paper arrives, write the date it arrived on it and keep the envelope or the delivery receipt with it. Do this before reading the order. It is the only fact in the whole process that cannot be recovered later from the document itself, and it is the one every deadline is measured from.

**2. Answer the order — this is separate from withholding, and it comes first.**
A support order requires a sworn affidavit within twenty days of service. A creditor writ states its own deadline on its face; find it and diary it today. This is the step employers skip, and it carries the largest penalty in the area.

**3. Identify what kind of order it is, from the title.**
Read the heading on the first page and choose the matching kind on the form. Every later field means something different depending on this one, and the ceilings differ by a factor of two or more.

**4. Copy the identifying details exactly.**
Case number from the caption block, issuing court or agency from the top of the page, signature date from the end, service date from the envelope you labelled in step 1. These are transcription, not judgement — doing them together, straight off the paper, is how they stay accurate.

**5. Enter the payee and the payment identifiers together.**
Who the cheque is made out to, and every identifier the payment must quote. Copy the identifiers verbatim. A correct amount to a correct payee with no identifier is not a paid obligation; it sits unallocated while the arrears grow.

**6. Enter the measure — amount or percentage, never both.**
If the order states a fixed amount per month, convert it with × 12 ÷ 26 for biweekly pay and enter the result. If it states a percentage, type the percentage as printed.

**7. Answer the two support questions from the paper, or ask.**
Second family, and arrears older than twelve weeks. If the order does not say, telephone the issuing authority with the case number, then record the date and the name of whoever answered in the notes. Together these two answers move the ceiling from fifty percent to sixty-five.

**8. Set the first affected pay period, and the end date only if you know it.**
Start with the next unpaid pay period. Leave the end date empty for a support order. For a creditor writ, expect it to expire about sixty days after service.

**9. Save, then check the first paycheque by hand.**
Run the next pay period and read the garnishment lines on that employee's cheque against the order. Confirm the disposable-earnings base, the ceiling applied, and the amount taken. Every mistake available in this area produces a plausible dollar figure — nothing crashes and nothing looks wrong.

**10. Deduct the processing fee if you choose to, and never from the order.**
Washington permits you to recover a processing fee from the **employee's remaining wages**. It is optional. It never reduces what is remitted. Taking the fee out of the amount sent to the registry is a short remittance, and short remittances are the employer's liability.

---

## Field by field, with the traps

Each of these lessons is also displayed beside its own box on the screen, so you do not have to hold any of it in your head while typing. The two whose mistakes are silent and expensive — the amount and the percentage — are expanded by default. The rest are one click away.

### What kind of order is this?

**Where on the paper:** The title across the top of the first page. It is the largest text on the document and it is almost always accurate — courts are precise about what they are issuing.

**The trap:** Treating anything from a court as a "garnishment." The kind decides which ceiling applies, and the ceilings are not close together: a creditor writ is capped near twenty-five percent of disposable earnings, a support order can reach sixty-five, and a federal tax levy is not subject to that ceiling at all. Choosing the wrong kind produces a plausible number that is wrong by hundreds of dollars a period.

**Example:** A page headed "INCOME WITHHOLDING FOR SUPPORT" is child support, even when it arrives from a collection agency rather than from a court, and even when the words "child support" never appear again.

### Case number

**Where on the paper:** Top right of the first page, in the caption block beside the court's name. Copy it exactly, including punctuation and leading zeros.

**The trap:** Two different numbers appear on a support order and they are not interchangeable. The **court cause number** identifies the case; the **IV-D or member number** identifies the support registry account. Use the cause number here, and put the other in the remittance instructions — the payment has to carry it or it will not be credited to the right person.

**Example:** `26-3-01234-5` is a Kitsap County Superior Court cause number for a domestic matter.

### Who issued it

**Where on the paper:** Directly above the case number, at the very top: "IN THE SUPERIOR COURT OF THE STATE OF WASHINGTON IN AND FOR THE COUNTY OF KITSAP", or an agency's name on a letterhead.

**The trap:** Writing the plaintiff's or the collection agency's name here. The issuing authority is who has the power to compel Greenway, and it is the body to contact when something about the order does not make sense. On an administrative support order it may be a state agency rather than a court — that is normal, and such an order binds an employer exactly as a court order does.

### Date the order was signed

**Where on the paper:** Beside the judge's or commissioner's signature at the end of the document.

**The trap:** Believing this is the date that matters. It almost never is. See the next field.

### Date it was SERVED on Greenway

**Where on the paper:** Not on the order. It is on the evidence of delivery — the process server's return, the certified-mail green card, the courier's receipt, the postmark, or the received stamp. If the envelope has been thrown away, ask the person who opened it before the memory goes cold.

**The trap:** Copying the signature date into this box because it is right there and this one is not. That single keystroke misstates both statutory clocks at once. The answer on a support order is due twenty days after **service**, and the sixty-day life of a creditor writ is measured from **service**, because the statute defines the writ's effective date that way.

**Example:** Signed 2026-01-05, handed to the shop 2026-01-20 → served date is 2026-01-20 and the answer is due 2026-02-09.

### Who the money goes to

**Where on the paper:** In the payment instructions, usually a boxed section headed "REMIT PAYMENT TO" or "MAKE CHECKS PAYABLE TO". On a Washington support order this is almost always the Washington State Support Registry, not the other parent.

**The trap:** Paying the person the money is *for* instead of the entity named to receive it. Sending child support directly to the other parent feels obviously correct and is a failure to comply: the payment is not recorded, the arrears keep building, and Greenway has to pay again to the registry. The money is gone and the debt is not.

### Where the payment is sent

**The trap:** Reusing an address from memory or from a previous order for the same registry. Support registries and collection firms move their lockboxes, and a payment posted to a superseded PO box is not late — it is **lost**. It does not bounce back quickly and it is not credited while it is missing. Copy the address printed on *this* order every time, even when the payee is one you have paid before.

### How the payment must be identified

**The trap:** Sending a correct amount to a correct payee with nothing to identify it. An unidentified payment to a support registry is not a paid support obligation; it is an unallocated receipt sitting in a suspense account while the employee's arrears continue to accrue. Copy the identifiers verbatim.

### A flat amount per pay period — read this one twice

**Where on the paper:** In the withholding instructions. Support orders overwhelmingly state a fixed amount, and they usually state it **per month**.

**The trap:** Entering a monthly figure into a per-period box. Greenway pays every two weeks — twenty-six times a year — so a monthly obligation is **not** the monthly figure divided by two. It is the monthly figure times twelve divided by twenty-six. Using half of the monthly amount under-withholds by about eight percent all year, and on a support order the employer can be liable for the shortfall.

**Example:** $650.00 per month is $650 × 12 ÷ 26 = **$300.00** per biweekly period, entered as `300.00`.

If the order does not state a per-period figure, ask the issuing authority to confirm the conversion in writing rather than doing the arithmetic quietly.

### A percentage of disposable earnings — read this one twice as well

**The trap:** This box takes a **percent**, typed the way it is printed. Type `25` for twenty-five percent. The system stores it internally in basis points, and that conversion is the single most dangerous one in the entry path — storing 25 where 2500 belongs turns a **$288.20** withholding into **$2.88**, and nothing about the resulting number looks alarming.

An order states an amount **or** a percentage, never both. The database enforces that.

### Past-due balance

**The trap:** Adding arrears into the ongoing amount. They are recorded separately because they do different work: the arrears figure is what tells you the balance is finite, and it drives the twelve-week question below, which moves the federal ceiling by five percentage points.

### Is any of the arrears more than twelve weeks old?

**The trap:** Leaving it blank to be safe. **Blank is not safe here — it is refused, and deliberately.** This answer adds five percentage points to the federal ceiling. Guessing "no" under-withholds on an order the employer is liable for; guessing "yes" takes money the employee is entitled to keep. There is no cautious direction, so the system refuses rather than picking one.

**Example:** Ticked "yes" → the ceiling moves from 50% to 55%, or from 60% to 65%.

### Does this employee support another spouse or child?

**The trap:** Assuming from what you know about the person. This single answer is the difference between a fifty percent ceiling and a sixty percent one — on a $2,000 disposable-earnings cheque that is two hundred dollars a period. It is a question about their **legal support obligations**, not about their household, and it belongs to the court's finding rather than to an employer's impression.

### Priority

**Where on the paper:** Not on the paper. It is Greenway's record of the order in which competing orders are satisfied when one paycheque cannot cover them all. Lower number is paid first.

**The trap:** Changing it by instinct. Support outranks everything by statute, so a support order should be `1` and everything else should be left alone unless a court has said otherwise. Paying a creditor writ ahead of a support order is not merely out of order — it exposes Greenway to the support liability while the money has already gone elsewhere.

### First pay period this affects

**The trap:** Setting it to the order date and back-dating into periods already paid. A pay run that has been issued cannot be re-cut, and withholding retroactively from a later cheque to make up for it takes more than the ceiling permits from that cheque. Start with the next period and let the arrears balance carry the history.

### Last day it applies (if known) — two opposite errors

This is the most common mistake in the whole area, and it fails in **opposite directions** depending on the order type:

- A **creditor writ dies sixty days after service** by operation of law. Leaving it open-ended means withholding from someone's pay under an expired writ, which is simply taking their money.
- A **support order does NOT expire.** It continues until the issuing authority says stop, in writing. Putting a guessed end date on one stops a legally required withholding early and leaves Greenway liable for what was not taken.

**Example:** Creditor writ served 2026-01-20 → the lien runs to roughly 2026-03-21. Support order → leave empty.

---

## Why the form refuses instead of guessing

You will hit refusals. They are intentional, and each one comes with a sentence telling you what to do about it — never a red box with no explanation, which is your standing complaint about Sage.

The principle is this: **there is no safe direction to guess in.** On the two support questions, guessing low under-withholds on an obligation Greenway can be held liable for, and guessing high takes money the employee is legally entitled to keep. A system that picks one for you is a system that produces a confident, plausible, wrong number — and every mistake in this area produces a confident, plausible, wrong number. That is what makes it dangerous. Nothing crashes.

So the form stops and tells you to ring the issuing authority. Record the date and the name of whoever answered in the notes field while you are there.

The save button is never disabled by validation, either. It always works, and if something is wrong the server tells you what. A greyed-out button with no explanation is the thing you already hate.

---

## Something I found while building this, which you should know about

The employee dropdown originally would have shown only **currently active** employees. That is the obvious way to build it. It is also a legal defect, and I want to record why, because it is the kind of thing somebody tidies up later without realising.

An order can be served naming somebody who **no longer works here**. Support registries work from records that lag; an order naming a person who left in March arrives in June. The duty to answer attaches on service either way — and RCW 26.18.110(1), quoted above, requires the answer to state "whether the obligor is employed by ... the employer." The statute plainly contemplates the answer being **no**.

If the name simply were not in the dropdown, the natural reading is "we have no such employee, so this does not concern us." That belief is exactly what ends in a default judgment against Greenway under RCW 6.27.200 for the employee's entire debt.

So every employee appears in the list. Former employees are labelled "— no longer employed", and when you select one the screen explains what to put on the sworn answer. There is one exception it also flags: if a **final paycheck** is still to be paid out, those earned wages **are** subject to the order. In that case you both answer the order and withhold from that last cheque.

---

## The processing fee

Washington lets you recover a processing fee, and the statute is specific about the amounts:

> "The employer may deduct a processing fee from the remainder of the employee's earnings after withholding under the wage assignment order or income withholding order, even if the remainder is exempt under RCW 26.18.090. The processing fee may not exceed (a) ten dollars for the first disbursement made by the employer to the Washington state support registry; and (b) one dollar for each subsequent disbursement to the clerk."

Ten dollars for the first disbursement, one dollar for each one after. It comes out of what is left of the **employee's** pay, never out of what is remitted, and taking it is optional.

---

## What you must never do to an employee with a garnishment

This one carries real teeth, and the middle word catches people who would never dream of firing anybody. RCW 26.18.110(8):

> "No employer may discharge, discipline, or refuse to hire an employee because of the entry or service of a wage assignment or income withholding order issued and executed under this chapter. If an employer discharges, disciplines, or refuses to hire an employee in violation of this section, the employee or person shall have a cause of action against the employer. The employer shall be liable for double the amount of damages suffered as a result of the violation and for costs and reasonable attorneys' fees, and shall be subject to a civil penalty of not more than two thousand five hundred dollars for each violation. The employer may also be ordered to hire, rehire, or reinstate the aggrieved individual."

Three verbs: discharge, **discipline**, or refuse to hire. Cutting somebody's hours, moving them off a good shift, or passing them over because their wages are being garnished is inside that sentence. Doubled damages, their attorney's fees, up to $2,500 per violation, and a court can order reinstatement.

There is a federal backstop too, 15 U.S.C. § 1674, and it is worth knowing because of how it ends:

> "(a) Termination of employment — No employer may discharge any employee by reason of the fact that his earnings have been subjected to garnishment for any one indebtedness. (b) Penalties — Whoever willfully violates subsection (a) of this section shall be fined not more than $1,000, or imprisoned not more than one year, or both."

**Imprisoned not more than one year.** This is one of the very few genuinely criminal provisions in ordinary payroll. The federal rule is *narrower* than Washington's — discharge only, not discipline, and only for any one indebtedness — so plan against the broader Washington rule and remember the narrower one is the one with a jail term attached.

There is a companion provision worth knowing as well: an employer who **complies** with an order cannot be sued by the employee for wrongful withholding. Between that and the anti-retaliation rule, following the order exactly is the only genuinely safe position.

---

## Two clocks that are easy to confuse

From RCW 26.18.110(2):

> "If the employer possesses any earnings or remuneration due and owing to the obligor, the earnings subject to the wage assignment order or income withholding order shall be withheld immediately upon receipt of the wage assignment order or income withholding order. The withheld earnings shall be delivered to the Washington state support registry ... within five working days of each regular pay interval."

Two different clocks in one sentence:

- **Withholding** starts *immediately on receipt* — not at the start of the next pay period, not once payroll is set up.
- **Remittance** is *five working days after each regular pay interval*.

Money you have withheld and not yet sent is not your money, and it is not the employee's either. You are holding it as a stakeholder.

---

## After you save

Do step 9. Run the next pay period and read the garnishment lines on that employee's cheque against the order in your hand. Check three things: the disposable-earnings base, the ceiling that was applied, and the amount taken.

I want to be blunt about why. Every single mistake available in this area produces a **plausible dollar figure**. Nothing crashes, nothing turns red, and no report says "this looks wrong." A monthly amount entered as a per-period amount looks like a normal deduction. A percentage stored as 25 instead of 2500 produces $2.88 where $288.20 belongs, and $2.88 is a perfectly ordinary-looking number on a pay stub. One deliberate check of the first cheque catches what no amount of re-reading the form ever will.

---

## What this slice does not do

I said at the start of this project that I would tell you where the boundaries are rather than let you discover them.

- **It does not file anything.** We prepare data; we are not a filing agent. The sworn answer is still something you sign and send.
- **It does not compute your answer deadline for a creditor writ from a rule.** The deadline is printed on the writ and it is not always twenty days, so you type it from the paper.
- **It does not decide the two support questions.** If the order does not state them, you ring the issuing authority.
- **There is no delete.** Orders are terminated, suspended, or resumed — never erased. A court order that vanished from the record without a trace is not something I am willing to make possible.

---

## Verification behind this work

For your own confidence, and because the standing rules require it:

- **41 tests** cover the entry screen; the full suite is **8,942 tests across 403 files**, all passing.
- **24 deliberate defects** were injected into this slice's code to confirm each test actually catches what it claims to. All 24 were caught.
- The first run caught only 23 of 24. The one that slipped through had deleted the entry form from the page entirely — the exact defect this slice exists to fix — and the test still passed, because it checked that the component's *name* appeared in the file and the leftover `import` line satisfied it. An import is not a render. That gate has been rewritten and now fails correctly.
- Three real defects were found and fixed during this phase: a type declared in two places that would have drifted silently, the former-employee filtering problem described above, and a warning box styled with two CSS variables that do not exist — which would have rendered a legal warning as invisible unstyled text.

---

*Every statute quoted in this document is stored verbatim in the codebase at `src/lib/payroll/wage-order-entry-authorities.ts`, with a test that fails if the quoted text is altered.*

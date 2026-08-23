# books-40b — Ending, Pausing and Resuming a Wage Order

**For:** Michael, Greenway Marijuana
**Slice:** books-40b (the small finishing change promised at the end of books-40)
**Screen:** Books → Garnishments
**Status:** built, wired, reachable, and proved by a test that I deliberately broke twice to make sure it works

---

## The one-paragraph version

You could enter a garnishment. You could not end one. Everything needed to end
one had been written months ago and was sitting there fully tested — it just had
no button attached to it. This change attaches the buttons: **End this order**,
**Pause it**, and **Resume it**. While attaching them I found a second problem
that nobody had reported, which was arguably worse than the missing buttons, and
it is fixed here too. Both fixes are now guarded by tests that fail if anyone
ever undoes them.

---

## First, the honest part: what was wrong

In the books-40 report I showed you this table. It counts how many times the
garnishment screen actually calls each piece of the underlying machinery:

| Action | Times the screen called it |
| --- | --- |
| `createWageOrderAction` | 2 |
| `terminateWageOrderAction` | **0** |
| `suspendWageOrderAction` | **0** |
| `resumeWageOrderAction` | **0** |

Three zeroes. The code that ends, pauses and resumes a wage order existed, was
correct, was covered by its own tests, and was called by nothing. Every test in
the repository passed. Nothing was red. You simply could not reach it.

Here is the same table today, produced by the same probe, which now lives in the
shipped source rather than in a note I typed:

| Action | Times the screen calls it |
| --- | --- |
| `createWageOrderAction` | 5 |
| `terminateWageOrderAction` | **2** |
| `suspendWageOrderAction` | **2** |
| `resumeWageOrderAction` | **2** |

That probe runs on every commit now. If those numbers ever go back to zero, the
build fails and names the action that got unplugged.

### The second problem, which was not on anyone's list

While wiring the Resume button I went to check what the garnishments board
actually loads, and found this in the reader:

    .eq("status", "active")

The board only ever loaded **active** orders. A paused order was invisible to
every screen in the system.

Sit with what that means for a moment, because it is the more instructive of the
two defects. If I had done only what was asked — add three buttons — then the
Resume button would have been attached to rows that could never appear on
screen. Pausing an order would have made it vanish, and the only control that
could bring it back would have been sitting on the row that had just disappeared.
An order could go into the system and never come out. And the entire test suite
would have stayed green while that shipped, because no test asked "can a human
being actually see this?"

The reader now loads **active and suspended**, and still deliberately excludes
**terminated**. That exclusion matters in the other direction: an ended order
back on a live board would eventually get withheld against, and taking money
under a released order is money out of your employee's pocket that you had no
authority to take.

The board now shows an amber **paused** count next to the active count, and a
paused order carries a gold **Paused - not withholding** badge so it can never be
mistaken for a live one.

> While fixing this I introduced a bug of my own and the tests caught it within a
> minute. Once paused orders were visible, the code that builds the worked
> example on each card would happily have fed a *paused* order to the withholding
> engine and shown you a calculated amount for an order that is explicitly not
> running. A test went red, I found it, the filter now says `status === "active"`
> as well, and there is a test named for that exact scenario. I am telling you
> this because it is the clearest evidence I can give you that the tests are
> doing real work rather than decorating the build.

---

## What the three buttons do

Every button on this screen tells you what will happen **before** you click it,
whether it can be undone, and the one thing worth checking first. A button that
just says "End" is a trap.

### End this order — red, and the only one you cannot undo

Withholding stops. No future pay run calculates anything for this order. The
order and every cent already withheld under it stay on file permanently.

**"Cannot be undone" does not mean the record is destroyed.** It means
withholding cannot be restarted under *this* order — new paperwork means a new
order. That asymmetry is on purpose.

It requires a written reason of at least a few words, and that reason is the
entire answer if a court or the employee asks in two years why withholding
stopped.

### Pause it — grey, reversible, and usually the wrong tool

Withholding stops for now, the order stays live, and it moves to the paused list.

I have deliberately made the wording here discouraging, because pausing is the
weaker tool and it is the wrong one far more often than it is the right one. The
honest use is narrow: the employee is on unpaid leave, or the issuing authority
has told you in writing to hold. Everything else is an ending. A paused order is
easy to forget, and a forgotten support order is under-withholding you can be
made to pay for personally.

### Resume it — green, and offered only from paused

The order goes back on the active board and the next pay run withholds against it
again.

**Resuming does not catch up.** Nothing is collected for the periods it was
paused. If the issuing authority wants those periods collected, that comes from
them in writing and gets entered as arrears. It is not something a green button
should do quietly to somebody's take-home pay.

### The button that does not exist

**There is no delete.** No delete button, no delete action, no delete query
anywhere in this feature. A garnishment record is the proof that Greenway did
what a court told it to do, and under RCW 26.18.110(6) an employer who cannot
prove that can be made to pay the support debt itself. Deleting the record
destroys the defence.

That is not just a promise in a document. A test greps the entire garnishment
feature for a delete path on every commit and fails if one ever appears.

### Which buttons appear when

| Order is | You can | You cannot |
| --- | --- | --- |
| Active | Pause it, End this order | Resume (it is already running) |
| Paused | Resume it, End this order | Pause (it already is) |
| Ended | *nothing* | Resume, pause or delete — it is finished |

Where two buttons appear, the reversible one is always on the left and the red
one is always last. That is not decoration; a red irreversible button nearest
your thumb eventually gets clicked by accident.

If a row shows no buttons, the screen tells you **why** in a sentence rather than
just rendering empty space.

---

## Before you end or pause anything: the five checks

These appear on the screen next to the orders, in this order, for the reasons
given.

**1. Which kind of order is this — support, or a creditor writ?**
If it fails: Look at the top of the paperwork for the issuing authority. A
Washington support order comes from the Division of Child Support or a court
under chapter 26.18 RCW. A creditor writ of garnishment comes from a court under
chapter 6.27 RCW and names a plaintiff who is a company. If you cannot tell, do
not end anything — ask.

**2. What piece of paper tells you it is over, and do you have it in front of you?**
If it fails: Do not end it yet. If you believe it is over but cannot show why,
that is exactly the situation Pause exists for — pause it, get the paper, then end
it properly. Pausing is reversible and ending is not.

**3. If it is a creditor writ, have the sixty days actually run?**
If it fails: Count from the service date recorded on the order, not from the date
on the judge's signature and not from the day you opened the envelope. If a
second writ was queued behind a first, its sixty days start when the first one
terminated.

**4. Is there money already withheld that has not been sent to the payee yet?**
If it fails: Send it. RCW 26.18.110(2) gives you five working days from each
regular pay interval for support, and the writ states the timing for a creditor
garnishment. Ending the order in this system does not do it for you and does not
excuse it.

**5. Has the answer or affidavit this order required already been filed?**
If it fails: File it. If the reason you are ending the order is "this person does
not work here", that still needs to be said in the answer — silence reads as
ignoring the order, and for a creditor writ silence is how a default judgment
against Greenway for the entire debt happens under RCW 6.27.200.

---

## The single most expensive mistake available at this screen

**A creditor writ expires. A support order does not.** They arrive in similar
envelopes and they live in the same drawer, and the rules are opposite.

| | Creditor writ (ch. 6.27 RCW) | Support order (ch. 26.18 RCW) |
| --- | --- | --- |
| **Does it end by itself?** | Yes. It expires at the payroll period ending on or before sixty days after the writ's effective date, or when the amount on the writ is collected, whichever comes first. | No. It runs indefinitely until the court or the registry says otherwise. There is no expiry date in it and none should be invented. |
| **Who can tell you to stop?** | The court, the creditor's release, or the clock. Satisfaction of the judgment also ends it. | The issuing authority only — a court order or the Division of Child Support, in writing. Not the employee, and not the other parent. |
| **What ending it too early costs** | You under-collect for a creditor. Recoverable, and the writ can be re-served. | Up to one hundred percent of the support debt, from Greenway, under RCW 26.18.110(6) — plus costs and their attorney's fees. |
| **What ending it too late costs** | You take money you have no authority to take. That is an unlawful deduction from wages under RCW 49.52.050, which reaches officers personally. | The same exposure, and it is the more likely error here because there is no clock telling you the order is over. |
| **The typical reason to end it** | "Writ expired 60 days after service 2026-02-01" or "judgment satisfied in full 2026-03-15". | "Released by the Washington State Support Registry 2026-04-02" or "terminated by court order dated 2026-04-02". |

---

## Three situations and the right button

### 1. The writ that quietly expired

**The situation.** A creditor writ for one of your budtenders was served on
1 February 2026. It is now 10 April. Payroll is about to run and the order is
still on the active board.

**The right answer.** End it. Sixty days after 1 February is 2 April, so the lien
ended at the payroll period ending on or before that date. It should already have
stopped, and every dollar withheld after it expired is money taken without
authority.

**What to type.** `Writ expired 60 days after service 2026-02-01; lien ended 2026-04-02.`

**The trap.** Waiting for the court to send something. It will not. A creditor
writ ends by the clock, and nobody writes to tell you — which is why this one is
missed far more often than a support order is.

### 2. The employee who tells you it is over

**The situation.** An employee with a child support withholding order tells you
their case is closed and asks you to stop taking it out of their cheque. They are
sincere and slightly upset.

**The right answer.** Change nothing. Keep withholding. A support order ends when
the registry or the court says so, in writing, and neither has said anything to
you.

**What to type.** Nothing — do not end it. Tell them you will stop the day the
registry or the court tells Greenway, and that you will act the same day it
arrives.

**The trap.** That this feels unkind, so it is tempting to help. If they are
wrong, the shortfall is Greenway's under RCW 26.18.110(6), and "the employee told
me it was closed" is not one of the defences listed in that subsection. Helping
them here costs them nothing and costs Greenway the whole debt.

### 3. The one case Pause was actually built for

**The situation.** An employee with an active support order goes on three months
of unpaid leave. There are no earnings to withhold from, and the order sits on
the board every payroll asking to be looked at.

**The right answer.** Pause it, and set yourself a reminder for the date they are
due back. This is the narrow case Pause was built for: nothing is over, there is
simply nothing to withhold from.

**What to type.** Nothing is required for a pause — but write the return date in
the note anyway, because the note is the only thing that will remind you.

**The trap.** Forgetting it. A paused order leaves the active board, so nothing
puts it in front of you again. When they come back, resuming does **NOT** collect
anything for the months that passed — and it should not, but you need to know that
is what happened.

---

## The law, word for word

These four are on the screen itself, quoted in full, next to the buttons they
govern. They are not retyped here from memory — the screen and this document both
read them from the same mirrored copy of the statute, and a test fails if the two
ever differ.

### RCW 6.27.350(1) — a creditor writ expires

> Where the garnishee's answer to a garnishment for a continuing lien reflects
> that the defendant is employed by the garnishee, the judgment or balance due
> thereon as reflected on the writ of garnishment shall become a lien on earnings
> due at the time of the effective date of the writ, as defined in this
> subsection, to the extent that they are not exempt from garnishment, and such
> lien shall continue as to subsequent nonexempt earnings until the total subject
> to the lien equals the amount stated on the writ of garnishment or until the
> expiration of the employer's payroll period ending on or before sixty days
> after the effective date of the writ, whichever occurs first, except that such
> lien on subsequent earnings shall terminate sooner if the employment
> relationship is terminated or if the underlying judgment is vacated, modified,
> or satisfied in full or if the writ is dismissed. The "effective date" of a
> writ is the date of service of the writ if there is no previously served writ;
> otherwise, it is the date of termination of a previously served writ or writs.

**Plain English.** A creditor garnishment is not permanent. It runs until the
writ amount is collected or until the payroll period ending on or before sixty
days after the effective date — whichever comes first. Keep withholding after that
and you are taking money you have no authority to take. Note the last sentence
too: if a second writ is served while one is running, its clock does not start
until the first one ends, so two overlapping writs do not each run sixty days
from their own service dates.

### RCW 26.18.110(2) — a support order starts immediately and keeps going

> If the employer possesses any earnings or remuneration due and owing to the
> obligor, the earnings subject to the wage assignment order or income
> withholding order shall be withheld immediately upon receipt of the wage
> assignment order or income withholding order. The withheld earnings shall be
> delivered to the Washington state support registry or, if the wage assignment
> order is to satisfy a duty of maintenance, to the addressee specified in the
> assignment within five working days of each regular pay interval.

**Plain English.** Two clocks in one sentence. Withholding starts immediately on
receipt — not next pay period. Remittance is five working days after each regular
pay interval. There is no expiry anywhere in it. Money you have withheld and not
yet sent is not yours and is not the employee's; you are holding it as a
stakeholder, and ending the order in this system does not discharge that.

### RCW 26.18.110(6) — what ending a support order too early costs

> An employer who fails to withhold earnings as required by a wage assignment
> order or income withholding order issued under this chapter may be held liable
> to the obligee for one hundred percent of the support or maintenance debt, or
> the amount of support or maintenance moneys that should have been withheld from
> the employee's earnings whichever is the lesser amount, if the employer:
> (a) Fails or refuses, after being served with a wage assignment order or income
> withholding order, to deduct and promptly remit from the unpaid earnings the
> amounts of money required in the order; (b) Fails or refuses to submit an answer
> to the notice of wage assignment or income withholding after being served; or
> (c) Is unwilling to comply with the other requirements of this section.

**Plain English.** This is the sentence that should decide how seriously you take
the End button on a support order. Get it wrong and Greenway can be made to pay
somebody else's child support, plus costs and their attorney's fees. And look at
trigger (b): failing to *answer* is its own independent route into this
liability. You could withhold every penny correctly and still land here by never
filing the affidavit.

### RCW 26.18.110(1) — ending an order does not discharge the answer

> An employer upon whom service of a wage assignment order or income withholding
> order has been made shall answer the order by sworn affidavit within twenty
> days after the date of service. The answer shall state whether the obligor is
> employed by or receives earnings or other remuneration from the employer,
> whether the employer will honor the wage assignment order or income withholding
> order, and whether there are either multiple child support or maintenance
> attachments, or both, against the obligor.

**Plain English.** Twenty days from service, and it must be a sworn affidavit —
not a phone call, not an email to the caseworker. "We ended it" is not an answer.
If you end an order because the person does not work here, that fact still has to
go in the affidavit.

---

## If the screen refuses

Every refusal names itself, says what it means, and says what to do. There are
six, and each one is explained on the screen next to the buttons. Two worth
knowing in advance:

**REASON_TOO_SHORT** — you tried to end an order with a reason shorter than a few
words. Nothing changed and withholding continues exactly as it was. That is the
safe direction to fail in: money withheld under a released order can be given
back; money not withheld under a live one lands on Greenway.

**NOT_FOUND** — the order was not in the state the button expected. Almost always
this means somebody else changed it in another tab. Reload before trying again.

The five-character minimum on the reason is enforced in three places — the
browser, the server, and a CHECK constraint in the database — and a test proves all
three use the same number from the same constant. A browser check is not a
control; a server check is not a guarantee.

---

## How to use it

1. Go to **Books → Garnishments**.
2. Find the order. Active orders show first; paused ones carry a gold
   **Paused - not withholding** badge.
3. Work the five checks above. The screen lists them next to the orders.
4. Click **End this order**, **Pause it** or **Resume it**.
5. A confirmation panel opens telling you what will happen and whether it can be
   undone. Ending asks for a reason; pausing offers an optional note.
6. Confirm. The result appears in plain English on the card.

If a click fails in a way the system cannot interpret, the message says the
outcome is **unknown** and tells you to reload and check the status rather than
saying "failed". Saying "failed" after a request that may have succeeded is how a
person ends up clicking twice.

---

## What this change is guarded by

A new test file, `wage-order-lifecycle.test.ts`, holds 31 tests. The ones worth
knowing about:

- The three actions are called by the screen. Fails if they go back to zero.
- The board loads paused orders and still excludes ended ones.
- The buttons the screen offers match the transitions the server permits, checked
  by comparing them mechanically rather than by two hand-written lists.
- The three statuses in the code match the CHECK constraint in the database.
- No delete path exists anywhere in the feature.
- The five-character rule is the same number in all three layers.
- Every one of the four quoted statutes resolves to the real mirrored text.
- Every refusal the system can emit has a plain-English explanation, **and** no
  explanation exists for a refusal that cannot happen.

**I broke it twice on purpose to check it works.** I reverted the reader to the
old `.eq("status", "active")` — one test went red, naming the paused-orders
problem. I unplugged the Resume action — one test went red, naming the action. Both
changes were reverted. A test that has never been seen to fail is not evidence of
anything.

---

## What this did not do

Being explicit, so nothing here reads as more than it is:

- **This does not send anything to anyone.** Ending an order in this system does
  not notify the court, the registry or the creditor, and it does not remit money
  you are still holding. Those are things you do; this records what you did.
- **This does not file the twenty-day answer.** That duty is untouched by any of
  these three buttons.
- **This does not track the sixty-day writ clock for you.** The screen teaches you
  to count it and shows you the service date. It does not yet warn you when a writ
  is about to expire. That is worth building and it is not built.
- **Resuming still does not catch up missed periods**, by design.

---

## Where this leaves the roadmap

The garnishment and child support feature is now complete end to end: enter an
order, see it calculated correctly against the CCPA and Washington caps, and end,
pause or resume it. That was the last piece you asked for before the bigger
quarterly slice.

Next is **books-41: the state quarterly filings** — the Employment Security
Department return and the Labor & Industries return, proved against your filed
Q2 2026 figures the same way the 941 was proved.

Still the one thing blocking your 1 January 2027 cutover: **the ten 2027 rates.**
Nothing in this slice depends on them, but the first live payroll does.

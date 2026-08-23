# The financial statements: how to read the four pages that describe your business

**Prepared for Michael Lyman · Greenway Marijuana · books-42**

---

## What changed, in one paragraph

The engine that builds your income statement, balance sheet, cash flow statement and statement of shareholder equity has existed for months. It is 1,600 lines, it has 132 passing tests, and until this week **nothing in the application imported it**. Not a page, not a component. Every one of those tests passed every night while you could not see a single number they produced. That is the largest gap the books-38 report named, and this slice closes it: there is now a screen at **Accounting → Financial Statements**, the income statement and balance sheet build from your own ledger, and the two that cannot honestly be built yet say exactly which document unblocks them instead of quietly making something up. Wiring it also uncovered a defect in the engine that would have made your net sales larger than your gross sales, on a perfectly balanced set of books, with nothing refusing. That defect, and the guard that now stops it, is the most important thing in this report.

---

## Why you should care about four pages of numbers

You asked to be taught these again, and specifically to understand how to use them as a tool rather than as a piece of paper with numbers on it. So let me start with the thing that nobody said to me until my third year, and which reorganised how I read a set of accounts.

**The statements are not a report card. They are a set of four answers to four different questions, and the questions are the point.**

Most people are taught the statements as artefacts — this is an income statement, it has revenue at the top and profit at the bottom. Taught that way, they are inert. You produce one, you glance at the last line, you file it. The number at the bottom either makes you feel good or it does not, and either way nothing happens differently on Monday.

Taught the other way round, they become instruments. Each one exists because somebody needed to answer a specific question that the others could not:

| Statement | The question it answers | Period or instant |
|---|---|---|
| Income statement | Did the business make money over this stretch of time — and how much of that will actually be taxed? | A **period** |
| Balance sheet | What does the business own and owe, at one exact moment? | An **instant** |
| Cash flow statement | Where did the money physically go? | A **period** |
| Statement of equity | What is your stake, and what has moved it? | A **period**, bridging two instants |

When you open the screen, each of the four leads with its question rather than its title. That is deliberate and it is the single highest-leverage thing in the whole design. If you can say out loud what question you are trying to answer, you know which page to open. If you cannot, you are about to read numbers for no reason.

### The one that trips everybody: period versus instant

An income statement covers a stretch of time and starts again at zero each year, because the year-end closing entry sweeps it all into retained earnings. A balance sheet is a photograph taken at close of business on one specific day.

This sounds academic. It is not, and here is the shape of the mistake it causes. You look at a balance sheet showing $40,000 of cash and you think the business is comfortable. But that photograph was taken on the 31st, and the 31st was the day after a big delivery day and three days before rent, payroll and the excise remittance all land. The photograph is accurate and the conclusion is wrong. A balance sheet tells you where you stand at an instant; it tells you nothing whatsoever about which direction you were moving when the shutter clicked. That is the income statement's job, and the cash flow statement's.

This is why a CPA never reads one alone.

---

## The four are one document

This is the principle I would keep if I could keep only one.

The statements are joined to each other, in specific and checkable places:

- **Net income** on the income statement lands in **equity** on the balance sheet. It is the same number, arriving from a different direction. On the screen, the balance sheet is built with the income statement's net income passed into it — not recomputed, passed — so the two cannot disagree.
- The **change in cash** on the balance sheet between two dates is exactly what the cash flow statement exists to explain.
- The **distributions** on the statement of equity are the financing outflow on the cash flow statement.

Reading one alone is like reading one page of a contract: everything you need is present and the meaning is absent.

And here is the part that turns this from a tidy fact into a working tool: **when two of them disagree, the disagreement is the finding.** It is not an annoyance to be reconciled away. A profitable month with falling cash is not a bookkeeping error, it is a message, and the message is usually one of five things: you bought inventory, you paid down debt, you took a distribution, somebody owes you money, or somebody is stealing. Each of those is visible on a different one of the four pages. That is why there are four.

---

## Reading them in the right order

There is an order, and it is not the order they are printed in. Seven steps, and the screen shows you the relevant ones underneath each statement.

**Step 1 — The abnormal balances panel, before any total on any statement.** Is anything sitting on the wrong side? Cash in credit, inventory negative? Those things are impossible in the real world, so they mean the books are wrong rather than the business is. Every number on every page is built on these, so reading a total before checking this is reading a total you have no reason to believe.

**Step 2 — Gross margin, on the income statement.** Not net income. Gross margin is the health of the business model itself: what you sell things for, against what they cost you. It is the number that tells you whether the model works, before any question of how well it is being run.

**Step 3 — The §280E wall line, and the disallowed spend directly beneath it.** This is the money you spent that bought you no tax relief at all. It exists on no other report in this building.

**Step 4 — Net income, and only now.** Read against gross margin, never on its own.

**Step 5 — Cash, on the balance sheet, against net income on the income statement.** If profit went up and cash went down, find out why before you do anything else.

**Step 6 — The current ratio, remembering that trust money is sitting inside those liabilities.**

**Step 7 — Stock basis, which is the decision you actually have to make**, because it governs what you can take out of the company without it being taxed as a capital gain.

Notice that net income is fourth, and that the first thing you look at is not a number at all — it is a check on whether the numbers mean anything. That ordering is the difference between reading statements and using them.

---

## The §280E wall, taught properly

Everything above changes shape for you, because of one sentence in the Internal Revenue Code.

**IRC §280E:**

> "No deduction or credit shall be allowed for any amount paid or incurred during the taxable year in carrying on any trade or business if such trade or business (or the activities which comprise such trade or business) consists of trafficking in controlled substances (within the meaning of schedule I and II of the Controlled Substances Act) which is prohibited by Federal law..."

In plain English: an ordinary retailer subtracts its rent, its wages, its insurance and its accounting fees from its income before working out the tax. You do not. Those are **deductions**, and §280E denies them to you entirely.

What you *are* allowed is **cost of goods sold** — and the reason is a technical one worth understanding, because it is the whole game. Cost of goods sold is not a deduction. Under **Treas. Reg. §1.61-3(a)**, gross income for a merchandising business *is* total sales *minus* cost of goods sold. It is subtracted in **arriving at** income rather than deducted **from** it. §280E denies deductions; it cannot deny something that happens before there is any income to deduct from. That distinction is the reason your inventory accounting matters more than any other single control in this business.

So your income statement has a wall running across it, and the screen draws it as an actual line:

- **Everything above the line** reduces the income you are taxed on.
- **Everything below the line** is real money, really spent, that reduces your tax by nothing.

### One month, worked all the way through

These figures are illustrative — shaped like a real month at a Washington retailer so the arithmetic is recognisable, but they are not your books.

| | |
|---|---|
| Gross sales | $200,000.00 |
| Less: discounts and comps | $8,000.00 |
| **Net sales** | **$192,000.00** |
| Less: cost of goods sold | $110,000.00 |
| **GROSS INCOME — the number §280E taxes** | **$82,000.00** |
| Less: operating expenses (below the wall) | $78,000.00 |
| **Book net income** | **$4,000.00** |
| | |
| Tax computed on gross income, at 37% | $30,340.00 |
| Tax if you were an ordinary retailer | $1,480.00 |
| **THE COST OF §280E, this month** | **$28,860.00** |

Read the last three rows twice.

**The books show $4,000.00 of profit, and §280E costs $28,860.00 in extra tax on top of what an ordinary retailer would pay. That is why net income is not the number to run this business on.**

The extra tax is more than seven times the profit. A month that looks modestly successful on the bottom line is, in cash terms, a serious problem — and nothing on a conventionally-presented income statement would tell you that. This is why the layout on your screen puts the wall in the middle and puts the disallowed figure in its own panel, rather than presenting a tidy top-to-bottom page that ends in a number which, for you, means much less than it appears to.

Every figure in that table is computed by the software from the four inputs, not typed. There is a test that recomputes all of them, and another that checks the percentage quoted in the commentary against the percentage the arithmetic actually produces. That second test exists because the first draft of this very example claimed a gross margin of 47.9% when the real figure is 42.71%. I did not catch that by reading it. The test caught it by computing it.

### What this means for how you run the shop

Three consequences follow, and they are the practical payoff of the whole section:

1. **Gross margin is not a vanity metric for you, it is survival.** For an ordinary retailer, thin margins can be offset by tight cost control. For you, cost control below the wall does not reduce tax at all. The margin has to carry everything.
2. **Inventory accounting is your largest tax position.** Cost of goods sold is the only route you have, so how inventory is counted and valued is worth real money. **Treas. Reg. §1.471-2(d)** requires inventory to be verified by physical count rather than inferred from a system — which is exactly why the cycle count screens exist. An inventory figure you cannot defend is a §280E position you cannot defend, and it is the only position you have.
3. **You must set aside cash against gross income, not against profit.** An ordinary business puts aside a share of what it earned. You have to put aside more than you earned. This is the single most common way a profitable-looking cannabis retailer runs out of money.

---

## The defect this slice found, and why I am telling you about it

I could have shipped the screen and said nothing. I am telling you because it is the most useful thing that happened, and because you have asked me to never guess and to test everything — and this is what that produces.

The engine takes a list of "which accounts carry the cannabis excise", so it can subtract the excise in arriving at net sales. It then filtered that list against **every row of the trial balance**, rather than only the profit-and-loss rows.

Your chart of accounts has no income- or expense-typed excise account at all. The 37% lives in:

> `32000  Cannabis Excise Tax Payable (37%) — TRUST` — a **liability**

It is a liability because **RCW 69.50.535(4)** makes that money the state's from the moment your customer pays it, and this chart therefore recognises revenue net of it.

So the single most natural thing anyone would ever do — pass the account with the word "excise" in its name as the excise account — was tested against a **perfectly balanced** trial balance, and produced:

| | Engine output | The truth | Overstated by |
|---|---|---|---|
| Gross sales | $10,000.00 | $10,000.00 | — |
| Less: discounts & comps | ($500.00) | ($500.00) | — |
| Less: excise tax | **$(3,700.00)** — *a negative deduction* | $0.00 | — |
| **Net sales** | **$13,200.00** | $9,500.00 | $3,700.00 |
| Cost of goods sold | $6,000.00 | $6,000.00 | — |
| **Gross income — the §280E base** | **$7,200.00** | $3,500.00 | $3,700.00 |
| Operating expenses | $1,200.00 | $1,200.00 | — |
| **Net income (book)** | **$6,000.00** | $2,300.00 | $3,700.00 |

**Net sales exceeded gross sales, and nothing refused.**

Read the right-hand column, because it is the whole story: **every subtotal is overstated by exactly $3,700.00** — the trust liability itself. That is not a coincidence and it is not a rounding artefact. A liability carries a credit balance, and the excise line subtracts a debit; subtracting a negative added. The error then propagated cleanly down every line beneath it, which is exactly why it is so dangerous. A wild number gets noticed. A number that is wrong by a consistent, plausible amount does not.

Note where the damage lands hardest. **Gross income is the number §280E taxes**, and it came out $7,200.00 when the truth was $3,500.00 — more than double. At a 21% federal rate that is roughly $777 of tax on money that was never yours; it belonged to the Washington State Liquor and Cannabis Board from the moment your customer handed it over. And because §280E denies you the deduction for the $1,200 of operating expenses anyway, there is no later line where the error washes back out.

Worse still: the same $3,700 *also* remained in current liabilities on the balance sheet, so a single number was counted twice in opposite directions — and the balance sheet **still tied perfectly**.

The engine's own 132 tests never caught this because they use the fictional account codes `4900` and `6900`, which are income and expense types. The engine had never been shown a real chart of accounts. This is a standing rule in this repository — attack the engine with the inputs it was never asked about — and it is the rule that earns its keep most often.

There is now a guard that runs **before** the engine is called and refuses outright any role code that is not a profit-and-loss account. And there is a test that deliberately removes the guard and proves the engine really does produce that wrong answer without it, so nobody can ever "simplify" the guard away on the grounds that it looks redundant.

**The lesson, which generalises well beyond this bug:** a statement that balances is not a statement that is right. Every journal individually sums to zero, so any subset of your books that contains whole journals will balance. A report can omit half your ledger and still print the word BALANCED. That has happened here before — eighteen accounts, including the whole of payroll, once vanished from a report because of a four-letter typo in an entity code, and the report footed perfectly. Never accept "it balances" as evidence that anything is correct.

---

## What the screen will not do for you, and why

Two of the four statements do not render today. You will see them as **blocked**, in gold rather than red, because waiting on a document is the system working correctly rather than a fault.

### The statement of cash flows

Nothing in the system yet computes the split between operating, investing and financing activities. That split is not derivable from account types alone — buying a freezer and buying inventory are both money going out, and they mean opposite things about the business. Until something computes it honestly, the statement is blocked.

### The statement of shareholder equity

This one needs three documents I do not have, and each has a specific consequence:

| What is needed | Where it comes from | Why it cannot be assumed |
|---|---|---|
| Whether the company has accumulated earnings and profits | **Form 2553** and the **CP261** acceptance letter | If E&P exists from any pre-election period, distributions are taxed differently. Assuming "none" is a claim about your company that I have no basis for. |
| Beginning AAA | Prior year's **Schedule M-2**, line 8 | The accumulated adjustments account governs which distributions are tax-free. Starting it at zero would misstate every distribution afterwards. |
| Beginning stock basis, per shareholder | **Form 7203** for each of the three of you | Basis is what determines whether money you take out is a tax-free return of capital or a capital gain. |

I want to be explicit about the choice here, because the alternative was tempting and is what most accounting software does. I could have defaulted all of these to the tidy answer — no E&P, AAA of zero, everything current — and rendered four handsome statements. Each of those defaults produces a page that looks finished and states something false. A false balance sheet that ties is materially more dangerous than a missing one, because it is the one that gets emailed to a landlord.

So the screen names the document instead. A blank space that explains itself is worth more than a number that lies.

The same reasoning applies to the Wells Fargo loan. Until the amortisation schedule is on file, nothing knows how much of that balance falls due within twelve months, so **every liability shows as current**. That makes your current ratio look worse than it really is. I chose that direction deliberately: an error that makes you look weaker is one you investigate, and an error that makes you look stronger is one you rely on.

---

## What "good" looks like, for your business specifically

Generic benchmarks are worse than useless here, because a cannabis retailer's numbers are structurally different. The ratios on the screen carry bands set for a Washington I-502 retailer, and they run in this order:

**Gross margin** — measured against **net** sales, not gross. This is the health of the business model. For you it has to be strong enough to carry the operating expenses that §280E will not let you deduct.

**Disallowed spend as a share of net sales** — this ratio exists on no conventional financial statement anywhere. It is the proportion of your revenue that goes to expenses which reduce your tax by nothing.

**Operating expense ratio** — everything below the wall, as a share of net sales.

**Net margin** — deliberately **last**. It is the number everyone reaches for first and it is the least informative one on the page for a §280E business. Read against gross margin or not at all.

On the balance sheet: the **current ratio**, with the standing reminder that trust money sits inside the liabilities it counts, and **debt to assets**.

Every ratio is computed in **basis points using integer arithmetic** — no floating-point numbers anywhere near money or the percentages derived from it. If a calculation ever produces a fraction of a basis point, the software refuses rather than rounding, because a fraction means a float touched money somewhere upstream. Where a denominator is zero, the ratio displays as an em dash rather than as 0.00%, because "we cannot compute this" and "this is zero" are different statements and only one of them is true.

---

## Trust money, and the reason it gets spent by accident

Under **RCW 69.50.535(4)**, the 37% excise belongs to the state from the moment your customer hands it over. It is not revenue and it never was, which is why it does not appear on the income statement at all.

It appears on the balance sheet, inside current liabilities, and the screen calls it out separately with the total. The reason it needs calling out is simple and slightly uncomfortable: **that money is in your bank account right now.** It looks exactly like your money in every balance you check. The only thing distinguishing it is a line in the ledger. Businesses do not spend trust money out of dishonesty; they spend it because on the 14th of the month the bank balance looked fine.

When you read the current ratio, remember that a meaningful chunk of the liabilities in the denominator is money you are merely holding.

---

## Where this lives, and what you will see

**Accounting → Financial Statements** (`/admin/books/financial-statements`), directly beneath Trial Balance. That placement is intentional: the trial balance is the raw material and the statements are what it becomes, and reading them in the other order teaches you the wrong dependency.

The page opens with a note saying these are **management accounts** — not audited, not reviewed, not compiled by an independent accountant. That note is at the top in ordinary-sized text rather than at the bottom in small print, because a well-formatted page headed "Balance Sheet" gets handed to landlords and lenders as though it were something more. The same note explains that Reg S-X, which several of the presentation rules come from, governs companies filing with the SEC and does not bind you — the layout follows it anyway because it is the clearest published statement of how not to be misleading, and a lender who knows what a real balance sheet looks like will recognise it.

Then: four status cards, each leading with its question. Then the income statement with the wall drawn across it, the disallowed-spend panel, and the ratios. Then the balance sheet with the trust-money callout and the abnormal balances panel. Then the full teaching section — all four statements explained, the seven principles, and the worked example above.

---

## The eight-step monthly checklist

1. Open the statements for the month just closed, with the same entity selected each time.
2. Read the abnormal balances panel first. Clear anything there before reading a single total.
3. Check gross margin against the prior month. A move of more than a couple of points is a question, not a fact.
4. Read the disallowed-spend figure and say the number out loud. That is the money §280E cost you this month.
5. Compare net income to the change in cash. If they point in different directions, find out which of the five causes it was.
6. Check the trust-money figure against what you have actually set aside.
7. Print it, or save the PDF, and keep the last twelve. **The value of a balance sheet is almost entirely in the comparison** — one on its own is a photograph of a stranger.
8. Note anything you could not explain, and bring it to the next conversation rather than resolving it by adjusting a number.

That last point is the one principle I would enforce above all others: **never move a number in order to change an outcome.** Change a number when you learn it was recorded wrongly, and never because the result it produces is inconvenient. The moment a set of books is adjusted to produce a desired answer, it stops being a record and becomes an opinion, and it can never be relied on again — including by you.

---

## What I did not do, and what I got wrong

**What I got wrong, and fixed — the first one.** The worked example in this document originally claimed a gross margin of 47.9%. The real figure, from the same numbers, is 42.71%. I wrote a plausible number instead of computing one. It was caught by a test that recomputes the percentage and compares it to the text, and that test is now permanent — if anyone edits the example's inputs and leaves the prose behind, the build fails.

**What I got wrong, and fixed — the second one, which is more instructive than the first.** The table above showing the defect originally printed $13,200.00 of net sales but the wrong figures underneath it, because I typed the supporting lines rather than running them. When I wrote the test that re-derives that table, it reported $13,700.00 and I assumed the report was wrong. So I "corrected" the report to $13,700.00.

Both numbers were real outputs of the real engine. Neither was a typo. They differed because the test had quietly built its **own** set of books, and that second set had no discounts account in it — so there was no $500 of comps to subtract, and the same bug produced a different wrong answer. I had two fixtures both claiming to be "Greenway's books", and I had just edited a published document to agree with the wrong one.

The fix was not to pick a number. It was to delete the second set of books entirely. There is now one fixture, in one file, that both the screen's test suite and this document's test suite import. The figure in the table above and the figure the software produces are now the same figure by construction, and they cannot drift apart again without the build going red.

I am telling you this at length because it is the identical failure to the one this whole slice is about, committed by me, in the act of documenting it. Two records of the same fact, both internally consistent, both balancing, silently disagreeing. **That is what a second copy of a number always eventually does.** It is the reason your books have one general ledger and not two, and the reason I will keep refusing to let a second copy of anything in here go unguarded.

**What I did not do.** I did not build the cash flow statement or the equity statement against assumed facts. I did not classify the Wells Fargo loan without the loan agreement. I did not collapse the three separate copies of the account-type list into one — instead I put a gate around them that fails the moment they disagree, and I have written down why below. And I did not become a filing agent: this screen prepares statements, it transmits nothing to anybody.

**A piece of debt I chose to police rather than repay.** The list of legal account types is written out four separate times: once as a CHECK constraint in the database, and three times as TypeScript in `ledger-core`, `trial-balance-core` and `cutover-core`. All four are currently identical. The danger is the day they are not: whoever hits the resulting compiler error will be tempted to add a cast, and a cast there would let an account flow through with a type the classifier has never heard of, landing its money on whichever side of the §280E wall the fallthrough happens to pick. Nothing would crash and the statements would still balance. There is now a test that reads all four lists off disk, compares them member by member and in order, fails if a fifth copy appears anywhere, and separately proves that every type the database permits has a defined side of the wall. Collapsing them into one import is the right long-term fix; it is a change with its own blast radius and it is not this slice. A known duplicate with a gate on it is manageable. A known duplicate with nothing watching it is a future incident.

---

## What I still need from you

For the **statement of shareholder equity**:

- **Form 2553** and the **CP261** acceptance letter — establishes whether there is accumulated E&P.
- The prior year's **Schedule M-2**, line 8 — the beginning AAA.
- **Form 7203** for each of the three shareholders — beginning stock basis.

For the **balance sheet** to classify debt honestly:

- The **Wells Fargo loan agreement and amortisation schedule**.

For the **cash flow statement**, nothing from you — that one is work on my side.

---

## The tests behind this document

Every factual claim here is re-derived by a check that runs on every commit, so this document cannot quietly go stale:

- **105 tests** on the screen's decision layer, including one that proves the engine really produces net sales of $13,200.00 against gross sales of $10,000.00 when the excise guard is removed.
- **50 tests** on the teaching layer, including tests that recompute every figure in the worked example from its inputs, prove the summary sentence is derived rather than typed, and confirm every authority cited resolves to a real one.
- **12 tests** on the account-type gate, all four failure paths provoked deliberately and observed failing.
- **35 tests** keeping the books-38 gap report honest — including a new one that now asserts the *opposite* of what it used to. When this screen was built, the check that claimed "nothing imports the financial statements engine" went red, exactly as designed. Rather than deleting that line, the entry moved to a list that requires the module to **stay** reachable. A gap closed last month is the easiest one in the system to reopen by accident.

Full suite at the time of writing: **423 files, 9,999 tests, all passing.**

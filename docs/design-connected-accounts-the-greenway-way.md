# Connected bank accounts: how QuickBooks and NetSuite do it, and what Greenway should do instead

Michael asked: *"I don't know the best most industry standard expert professional
method for accounting for and bookkeeping for connected bank accounts. How do we
manage them, how does sage or quickbooks solve this. Deep research this. Let's do
it their way, but better. Their way, but refined specifically for greenway only."*

This is the answer. Sources are cited inline and dated 27 August 2026.

---

## PART 1 — WHAT THE INDUSTRY ACTUALLY DOES

### The QuickBooks Online model, in four moves

Intuit's own documentation describes a pipeline, not a posting engine:

1. **Download.** *"QuickBooks tries to update your bank transactions
   automatically every 24 hours."* Feed in, nothing posted.
2. **Land in a review queue.** *"QuickBooks sends downloaded transactions to the
   Pending tab, and suggests categories for each transaction."* Note the word:
   *suggests*.
3. **Rules classify, humans confirm.** Up to **2,000 rules**, each with up to
   **5 conditions**, matching on `Description`, `Bank text` or `Amount` with
   `Contains` / `Doesn't contain` / `Is exactly`. Rules are **ordered**, and
   *"the rule with the highest priority will always be applied first."*
4. **Then, and only then, post.** *"Select Post if the suggested category is
   correct."* A matched rule shows a **RULE** badge; auto-posting is opt-in per
   rule and shows an **AUTO** badge.

Intuit's own advice on auto-post is conservative: *"We recommend starting with
simple, consistent transactions like rent or gas expenses."*

**The single most useful detail in the whole document** is the troubleshooting
note, because it names the trap:

> "The **bank text** is exactly the same information the app receives from the
> bank... The **description** is a simplified version of the bank text."

A rule written against the prettified description silently stops matching when
the vendor's raw string changes. Match on raw text; show the pretty one.

### The transfer problem, which is Michael's problem exactly

When both sides of a transfer are connected feeds, **the same movement of money
arrives twice** — once as money out of x6228, once as money in to x6048. Treated
as two independent events, that is a fictitious expense and a fictitious income,
and the consolidated books overstate both sides.

Every platform solves it the same way: classify the pair as a **Transfer**, not
as income and expense. QuickBooks has a dedicated "Record as transfer" action for
precisely this. Michael's sweep hits this on **67 rows in sixteen weeks**.

### The NetSuite / intercompany model, for separate legal entities

Where the two accounts belong to *different entities* — which is Greenway's case,
since the ATM operation and the cannabis store are separate books — a transfer is
not merely a transfer. NetSuite states the objective:

> "The objective of intercompany accounting is to strip away the financial impact
> of internal transactions... to yield financial statements that only reflect
> activity with independent third parties."

And the mechanism:

> "Journal entries are made on each related party's books using intercompany
> accounts, such as 'due to and due from' when a transaction arises."

Their nine best practices include four that matter here: **flag transactions
immediately** (*"Labeling transactions at inception... is more efficient than
searching for activity after the fact"*), **automate eliminations**, **settle
accounts monthly** (*"rather than leaving them unreconciled for multiple fiscal
periods"*), and **standardize transfer pricing** at arm's length.

NetSuite also names the failure mode, with consequences: *"more than $12 million
in penalties were levied against an advertising firm and its officers for failing
to reconcile intercompany accounts for six years."*

### Where each model falls short for Greenway

| | QuickBooks | NetSuite | What Greenway needs |
|---|---|---|---|
| Rules | Strings + amount only | Entity-aware | Rules that know the **date** (Nov 1, Jan 1) |
| Entities | Weak; separate company files | Strong | Strong, but **four books in one system** |
| §280E | No concept | No concept | **The whole point** |
| Reversals | Manual find-and-fix | Manual | Detected, because the ATM reports disagree |
| Evidence | Trusts the feed | Trusts the feed | **Two feeds cross-checked** |

QuickBooks would need three separate company files and would lose consolidation.
NetSuite would handle the entities and cost six figures to know nothing about
§280E or the DOR. Both trust a single feed as truth.

---

## PART 2 — THE GREENWAY REFINEMENT

Eight decisions. Each is "their way" with a specific, named improvement.

### 1. Same pipeline, but a transaction is EVIDENCE before it is a journal

Their way: feed → review queue → rule suggests → human posts.

**Better for Greenway:** the raw feed row is retained permanently as evidence and
the journal points back at it, rather than the row being consumed by the posting.
`gl_bank_matches` already establishes this instinct, deliberately refusing a
cascading foreign key: *"a Plaid resync must never be able to silently delete
accounting evidence."* Extend that to classification. When the CPA asks in March
why a November payment was coded the way it was, the answer is the row plus the
rule that fired plus who approved it — not a journal with a memo.

### 2. Rules are EFFECTIVE-DATED, because Michael's business changes twice this year

This is the biggest single departure, and it comes straight from his message:

> *"My plan is to switch to paying vendors from the atm account starting on
> November 1st. I will begin paying employees via the atm account on January 1st."*

A QuickBooks rule has no date dimension. A rule that says "money out of 6228 is an
ATM expense" is **true in October and false in November** — and on 1 November the
books would begin silently re-characterising the store's vendor payments as ATM
expenses. That is a §280E error with a tax consequence, produced by a rule that
was correct when it was written.

**So every rule carries `effective_from` / `effective_to`.** A transaction is
classified by the rule in force **on its own date**, never by today's rule set.
Re-running last year's classification produces last year's answer.

### 3. The sweep is an INTERCOMPANY PAIR, not a transfer

Their way: two feed rows, one Transfer.

**Better for Greenway:** `TRANSFER FROM X6228 TO X6048` moves money between two
sets of books, so it posts as a pair through `36000 Due To / From Related
Entity` — whose own seed comment already states the invariant: *"Must net to ZERO
across all four on consolidation — a standing close check."*

`submitIntercompanyPair()` already exists and posts both sides in one transaction.
NetSuite's advice to *"settle accounts monthly"* becomes a close-gate assertion
that `36000` nets to zero, rather than a habit somebody is supposed to remember.

### 4. Two feeds, cross-checked — not one feed trusted

Every platform treats the bank feed as truth. Greenway has something better and
should use it: **the ATM company's report and the bank's own statement describe
the same money independently.**

The recon proved this is not theoretical. Funds Movement and Daily Settlement
disagree by **$5.00 of surcharge and $100.00 of cash** across three dates, because
one report carries corrections and the other does not. **Booking from the wrong
one understates income permanently and never self-corrects.**

**So: Funds Movement is primary, Daily Settlement corroborates, the bank confirms,
and any date where they disagree is surfaced rather than silently resolved.** This
is the standing rule about refusing rather than guessing, applied to a data feed.

### 5. Classification proposes; it never posts by itself

QuickBooks offers auto-post and advises caution. Greenway declines it, for a
reason Michael himself gave:

> *"ready for me to validate and post to the books."*

`bank-match-core.ts` already models this with a `postable: false` gate. Under
§280E the difference between a deductible ATM expense and a disallowed cannabis
expense is real money, and it turns on a judgement a string match cannot make.
The engine's job is to make his approval **fast and informed**, not to remove it.

Confidence is stated, never hidden: an exact rule match on a five-phrase
vocabulary is not the same as a fuzzy vendor guess, and the screen should say so.

### 6. Match on RAW bank text, display the friendly name

Directly from Intuit's troubleshooting note. Rules bind to the raw string; the
screen shows something readable. Greenway's ATM vocabulary is only five phrases,
which makes exact matching genuinely achievable rather than aspirational — and
makes the sixth phrase, when it appears, an event worth noticing.

### 7. Every line carries an ENTITY, and the ledger refuses the wrong one

`EntityCode = "greenway" | "atm" | "landholding" | "personal"` already exists, and
`decidePosting` already returns `AUTOPOST_WRONG_ENTITY` when a template targets
the wrong books. The chart already restricts accounts by entity: `51000` is
`{atm}` only, `10300` is `{atm, greenway}`.

**Refinement:** the entity is not a report filter, it is a **posting
precondition**. `51000 ATM Surcharge Income` is annotated *"Separate trade or
business (CHAMP). Not cannabis revenue."* That annotation is a tax position. A
line that lands in the wrong entity is not untidy — it can move real money, in
both directions, because it decides whether an expense survives §280E.

### 8. Personal money is IN the system and OUT of the business books

x3557 is personal. Michael: *"I am the only owner that matters for my three
businesses and personal life so all the money and financing and such are all
mine."*

That makes tracking it useful and commingling it dangerous. `personal` is already
a first-class entity, and `40000 Owner Equity` / `36000` are the correct
destinations for money crossing that line. Visible, classified, reconciled —
never absorbed into a business expense account.

---

## PART 3 — WHAT THIS MEANS FOR THE FOUR REPEATING TRANSACTIONS

Measured from the 301-row Timberland file, plus the settlement reports. Amounts
are illustrative; the account codes and entities are the design.

**1. Daily settlement — the ATM company funds the account (229 rows).** Two legs
that arrive separately and must be booked separately, because only one of them is
income:

    entity: atm
    Dr 10300 Bank — ATM Vault Account        (cash withdrawn, returned to the vault)
      Cr 10300 / vault contra                 ← NOT income. Michael's own money coming back.
    Dr 10300 Bank — ATM Vault Account        (surcharge)
      Cr 51000 ATM Surcharge Income           ← the ONLY revenue on this form

The distinction is already recorded in the schema (`terminal_transaction_cents`
vs `surcharge_cents`) and in Michael's own words: *"the surcharge only is what i
enter into the dor portal."* Getting it wrong overstates ATM revenue by roughly
**32×** — 526,620 against 16,272.50 — and would flow straight into the B&O return
at .015000.

**2. The sweep to the cannabis account (67 rows).** Intercompany pair:

    entity: atm                          entity: greenway
    Dr 36000 Due To / From                Dr 10200 Bank — Operating
      Cr 10300 Bank — ATM Vault             Cr 36000 Due To / From

Nets to zero on consolidation, which the close gate asserts.

**3. Account analysis charge (3 rows) and the processor debit (1 row).** Ordinary
ATM-entity operating expenses — deductible, because CHAMP makes the ATM a separate
trade or business. Cost class matters and must be set explicitly.

**4. The single reversed settlement (1 Debit row) and the three correction
dates.** These are the ones that must never be smoothed over. A reversal is
evidence of a dispute, and the books should show it as one.

**And from 1 November, a fifth pattern appears: vendor payments out of 6228.**
Those are **not** ATM expenses. They are the store's expenses, paid by the ATM
entity, which makes each one either an intercompany advance through `36000` or a
capital movement — a judgement Michael makes, on rules dated from 1 November.

---

## PART 4 — WHAT THE SAGE SPREADSHEETS WILL DO

Michael is preparing exports of expenses tagged to their Sage COA. Their job is
**not** to create the buckets — migration 0173 already built the chart with
deliberate design (*"the old chart had one account per till"*, *"the MONTH was
encoded into the account code"*).

Their job is to answer three questions that cannot be answered from the bank feed:

1. **Which raw bank strings correspond to which account**, historically — turning
   the rule set from a guess into a measurement across twelve years of his actual
   spending.
2. **Which expenses recur**, so the buckets cover the real population rather than
   the memorable examples (the standing rule about walking the population).
3. **Which of them are personal, which are the store's, and which are the ATM's** —
   the entity split that no bank feed carries and no string match can infer.

Until they arrive, rules will be written only for the five measured Timberland
patterns, which are certain. Everything else waits for evidence.

---

## PART 5 — ON THE PAPERWORK HE OFFERED

Michael: *"There is no atm contract that I can produce or a monthly statement or
1099... if I need a specific doc for it I can produce one... if formalities are
required, we can produce them, but for now let's just build."*

**No document should be produced, and building is the right call.**

Creating a contract in 2026 to paper a relationship that has operated consistently
since 2014 would be manufacturing evidence, not recording it. The transaction data
is stronger: twelve years of consistent treatment, two independent reports per
day, and a bank statement that confirms both.

Two places where a formality **will** eventually be load-bearing, named now so
they are not discovered later:

- **`52000 Rental Income`** — the chart itself already flags it: *"Rents to the
  store and to the ATM operation — related-party, so it must be at arm's length
  and documented."* Related-party rent between entities under §280E attracts
  scrutiny precisely because it shifts deductible expense across the 280E wall.
- **The intercompany balances in `36000`** — NetSuite's *"settle accounts
  monthly"*. An intercompany balance left open for years starts to look like
  something other than a loan. Settling on a cadence is the documentation.

Neither blocks the build. Both should be raised again before the first return that
depends on them.

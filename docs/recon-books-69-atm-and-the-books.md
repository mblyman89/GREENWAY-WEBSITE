# books-69 recon — the ATM, the books, and the connected accounts

**Measured 27 August 2026, before any code was written.** Every claim below was
run against the repository or Michael's four CSVs. Nothing here is remembered or
inferred from a previous slice.

---

## 1. THE HEADLINE FINDING: THE ATM HAS NEVER TOUCHED THE GENERAL LEDGER

The ATM subsystem is substantial and it works. Fourteen source modules, five test
files, three migrations, a PAI client, a sync engine, a reconciler with a
business-day posting window, and a terminal-status monitor.

**It has never posted a single journal entry.**

    grep -rn "posting-service|journal-entry-service|posting-core" src/lib/atm src/app/admin/atm
    → no matches (exit 1)

The word "posting" appears 20 times in `src/lib/atm`, and **every one of them
means the BANK's posting window** (`bankPostingWindow`, T+1..T+3) — when
Timberland credits the account. Not one refers to posting to the books. The two
meanings of "post" have been sitting next to each other in this codebase, and the
accounting one was never implemented.

**Existence asserted before absence (rule 66d).** The posting machinery is real
and is used by others:

| Consumer | Uses |
|---|---|
| `inventory-audit-store.ts` | `posting-service` |
| `admin/books/journal/actions.ts` | `journal-entry-service` |
| `journal-entry-service.ts` | `posting-service` |

So the road exists, is paved, and carries traffic. The ATM is simply not on it.

**What this means for Michael's question.** He asked to "make sure we are
recording the ATM surcharge revenue to the correct books." The honest answer is
that **it is not being recorded to the books at all.** It is displayed on the ATM
screen, it feeds the net-income report, and it feeds the B&O return — all three of
which read `atm_settlements` **directly**, bypassing the ledger entirely:

    net-income-store.ts:57   settlements.reduce(... surchargeCents ...)

That is why the figures look right on screen while the general ledger knows
nothing about them. **A report that reads the source table instead of the ledger
is a report that cannot be audited, cannot be tied to a trial balance, and cannot
be reconciled to the bank.** It is also how a number can be correct today and
unexplainable in eighteen months.

---

## 2. WHAT ALREADY EXISTS, AND IS BETTER THAN EXPECTED

The chart of accounts was built in migration 0173 with this exact future in mind.
Every account this slice needs is **already seeded**:

| Code | Name | Type | Entities | Note from the migration |
|---|---|---|---|---|
| `10300` | Bank — ATM Vault Account | asset | `{atm, greenway}` | "CONTROL. The old 12000 ATM CASH BALANCE had drifted to -45,230.00 — negative cash, impossible." |
| `51000` | ATM Surcharge Income | income | `{atm}` | **"Separate trade or business (CHAMP). Not cannabis revenue."** |
| `36000` | Due To / From Related Entity | liability | all four | "Must net to ZERO across all four on consolidation — a standing close check." |
| `10200` | Bank — Operating | asset | — | "CONTROL: reconciled to the Plaid feed." |
| `10400` | Undeposited Funds | asset | — | "Money collected but not yet in the bank." |
| `52000` | Rental Income | income | `{landholding}` | "Rents to the store and to the ATM operation — related-party." |

`EntityCode = "greenway" | "atm" | "landholding" | "personal"` is a real type, and
`decidePosting` already **refuses** a template that tries to post into the wrong
entity's books (`AUTOPOST_WRONG_ENTITY`).

**`submitIntercompanyPair()` already exists** in `posting-service.ts`, backed by
the `gl_submit_intercompany_pair` RPC. It takes `entityA` + `linesA` and
`entityB` + `linesB` and posts both sides in one transaction. **This is precisely
the machinery a transfer between x6228 and x6048 requires**, and it is already
built and tested.

`gl_bank_matches` (migration 0189) links a `plaid_transactions.transaction_id` to
a `gl_journals.id`, deliberately **not** as a cascading FK: *"a Plaid resync must
never be able to silently delete accounting evidence."* `bank-match-core.ts`
**proposes** matches and gates them (`postable: false`), leaving the decision to
the owner. That is the validate-then-post workflow Michael described, already half
built.

**So the gap is narrower than it looks.** The accounts, the entities, the
intercompany posting, the bank-match proposal engine and the owner-approval gate
all exist. What is missing is the wiring between the ATM/bank feeds and them.

---

## 3. THE ACCOUNTS, NOW IDENTIFIED (previously three open questions)

Michael, verbatim: *"The atm account is 6228, 3557 is my personal checking account
and 6048 is the cannabis checking account."*

This closes the books-69 blocker. Confirmed against the data:

- **x6228 — ATM account** (Timberland). Every row of the Funds Movement report
  carries `Acct # = ******6228`. Both money legs land here.
- **x6048 — cannabis checking.** Appears only as the destination of
  `TRANSFER FROM X6228 TO X6048` (**66** occurrences, all Debits to 6228,
  totalling **$526,937.58**).
- **x3557 — personal checking.** **CORRECTED IN STEP 2 — this recon was wrong.**
  It said x3557 does not appear anywhere in the four CSVs. It does:
  `TRANSFER FROM X6228 TO X3557`, once, on **2026-07-03**, for **$5,242.50**,
  a Debit. There were 67 `TRANSFER` rows in total and this recon counted all 67
  as sweeps to x6048; 66 were, and the sixty-seventh went to Michael's personal
  checking. Treating it as a sweep would have overstated what the store owes the
  ATM business by $5,242.50 and hidden an owner distribution that belongs on the
  equity statement. Stated rather than quietly amended, per standing rule 89.

**The Timberland vocabulary is SIX phrases**, not five (301 rows, 5.1.26–8.23.26).
This recon said five; the sixth is the transfer to personal checking, corrected
below:

| n | Description | Dr/Cr | What it is |
|---|---|---|---|
| 229 | `DLY SETTLE MVNT - HG26499 CCD` | Credit | The ATM company funding the account |
| 66 | `TRANSFER FROM X6228 TO X6048` | Debit | **The cash sweep** to the cannabis account ($526,937.58) |
| 1 | `TRANSFER FROM X6228 TO X3557` | Debit | **An owner distribution** to personal checking, 2026-07-03, $5,242.50 |
| 3 | `ACCOUNT ANALYSIS CHARGE` | Debit | Bank fee |
| 1 | `EFTRANSACT PAYMENT ALLIANCE PPD` | Debit | Processor debit |
| 1 | `DLY SETTLE MVNT - HG26499 CCD` | **Debit** | A settlement that went the *other* way |

Five patterns is a small enough vocabulary to classify with **rules, not
guesses** — and the single Debit-direction settlement is exactly the kind of
exception that a rule must be forced to notice rather than average away.

---

## 4. A REAL DISCREPANCY BETWEEN THE ATM COMPANY'S OWN TWO REPORTS

Measured, not assumed. Two files report the same period and disagree:

|  | Surcharge | Transaction |
|---|---|---|
| Funds Movement By Account By Day | **16,272.50** | **526,620.00** |
| ATM Daily Settlement Report | 16,267.50 | 526,520.00 |
| Difference | **5.00** | **100.00** |

Not a rounding drift and not a missing day — the date coverage is identical. It is
**three specific dates**, and the cause is visible once the rows are printed:

    6/27/26  Transaction   $3,060.00      ← matches Daily Settlement
    6/27/26  Transaction    -$100.00      ← EXTRA, negative
    7/2/26   Transaction   $4,980.00      ← matches
    7/2/26   Transaction     $100.00      ← EXTRA
    7/2/26   Surcharge         $5.00      ← EXTRA
    7/9/26   Transaction   $2,500.00      ← matches
    7/9/26   Transaction     $100.00      ← EXTRA

**The Daily Settlement Report shows only the original day's activity. The Funds
Movement report additionally shows CORRECTIONS** — a $100 reversal on 6/27 and
$100 re-posts on 7/2 and 7/9, plus a $5.00 surcharge adjustment. The $100 out on
6/27 and $100 back on 7/2 look like one dispute or reversal cycle; the 7/9 $100 is
a second one.

**Consequence, and it decides the design:** the Funds Movement report is the
one that reconciles to the bank, because it contains the corrections the bank
actually saw. **Booking from the Daily Settlement Report would understate
surcharge income by $5.00 and cash by $100.00 over sixteen weeks, and the error
would never self-correct.** The engine must take Funds Movement as the primary
and treat Daily Settlement as corroboration — with any date where they disagree
**surfaced, not silently preferred.**

This also revises a figure recorded in an earlier slice from the same data; the
totals above are the measured ones and supersede it.

---

## 5. WHAT THE FOUR FILES ARE

| File | Rows | Grain | Role |
|---|---|---|---|
| Funds Movement By Account By Day | 234 | date × settlement type | **Primary.** Both legs, with corrections. Names the account (6228). |
| ATM Daily Settlement Report | 115 | date | Corroboration + transaction counts (Total/WD/Surcharge WDs). |
| ATM Cash Load Report | 133 | timestamp | Vault replenishment — the cash Michael *puts in*. Has a running Balance. |
| Timberland Bank ATM Account | 300 | bank posting date | The bank's own truth. What must be reconciled to. |

Note the two money legs are structurally separate and always were — matching
Michael's earlier statement that *"the atm service provider deposits the surcharge
separate."* `atm_settlements` already stores them in separate columns
(`terminal_transaction_cents`, `surcharge_cents`) with a comment recording that
answer.

---

## 6. THE 280E POINT THAT MAKES THIS MORE THAN BOOKKEEPING

`51000 ATM Surcharge Income` is annotated **"Separate trade or business (CHAMP).
Not cannabis revenue."** That is the CHAMP doctrine — a genuinely separate trade
or business is not swallowed by §280E, so its ordinary expenses remain deductible.

The B&O engine already reflects this: `bo-tax-core.ts` maps
`service_and_other → "atm"` at **.015000**, against retailing at **.00471**, and
carries Michael's verbatim instruction that *"the surcharge only is what i enter
into the dor portal."*

**Which means the entity tag on every ATM journal line is not clerical — it is the
line between a deductible expense and a disallowed one.** A sweep misposted to the
cannabis entity does not merely look untidy; it can move real tax. This is the
strongest argument for posting the ATM through the ledger with an entity dimension
rather than reading a table.

---

## 7. KNOWN DEBT FOUND ON THE WAY

`src/lib/atm/store.ts` casts rows `as Array<Record<string, unknown>>` in four
places, and says so in its own comment at line 461: *"no column in `atm/store.ts`
has ever been type-checked."* Already recorded in BOOKS_ROADMAP as outstanding.
Any slice that starts writing journals from these rows must fix this first — a
mistyped column that silently reads `undefined` becomes a zero in a journal line,
and a zero posts cleanly.

`12000-GRWYE ATM CASH BALANCE` is in **quarantine** at -45,230.00 with the owner's
own words attached: *"I have no idea how to fix it."* It maps to `10300`. The
opening balance for the vault account has to be re-derived from evidence at
cut-over — and the Cash Load report's running `Balance` column is the evidence
that makes that possible.

---

## 8. WHAT I STILL NEED, AND WHAT I DO NOT

**Do NOT need** (Michael offered, and the answer is no):
- An ATM contract, monthly statement or 1099. He has twelve years of consistent
  treatment and is the only owner of all three businesses. Manufacturing a document
  now to justify a position already taken would be *creating* evidence, not
  recording it. The **transaction data is the evidence**, and it is better evidence.
- Formalities in general, for now. Where a formality becomes load-bearing (the
  related-party rent at `52000`, for instance, which the chart itself flags as
  needing arm's-length documentation), I will name it specifically rather than
  ask for paperwork in the abstract.

**Genuinely blocking nothing right now.** The Sage COA-tagged expense
spreadsheets he is preparing are what turn the classification rules from a guess
into a measurement — but the wiring work below does not wait on them.

---

## 9. THE ORDER THE WORK SHOULD GO IN

Stated so Michael can overrule it before money is spent.

1. **Wire the ATM to the ledger.** Surcharge → `51000` (entity `atm`), cash leg →
   `10300`. Idempotent by `entity:source_kind:source_ref`, which
   `buildIdempotencyKey` already enforces — a re-sync must not post twice.
2. **The sweep as an intercompany pair.** `TRANSFER FROM X6228 TO X6048` is
   `10300` down in `atm`, cash up in `greenway`, with `36000` carrying both sides
   so it nets to zero on consolidation. `submitIntercompanyPair` already does this.
   **BUILT IN STEP 2, with three corrections to this plan.** (a) The transfer to
   x3557 is NOT an intercompany pair — it is a single-entity owner distribution
   against `41000`; a matching credit on the personal books would have netted the
   distribution to zero across the group and understated Michael's §1368 basis.
   (b) `intercompany_ref` is a `uuid` column, so the reference is a deterministic
   v5 uuid, not the readable string this plan implied. (c) 2026-05-26 carries TWO
   sweeps, so the source ref must include an occurrence number or the ledger's
   own idempotency check would swallow the second one as a duplicate.
3. **Take Funds Movement as primary**, Daily Settlement as corroboration, and
   surface every date where they disagree instead of preferring one silently.
4. **The classification rules** for the five Timberland patterns, extended by the
   Sage-tagged expense buckets when they arrive — proposed, never auto-posted,
   because Michael asked to "validate and post," and `bank-match-core` already
   models exactly that gate.
5. **Nov 1 and Jan 1 are dates the system must be told, not dates it should
   infer.** Vendor payments move to the ATM account on 1 November; payroll on
   1 January. A rule that reads "expenses from 6228 are ATM expenses" is true in
   October and false in November. Effective-dated rules, or the books silently
   re-characterise themselves at midnight.

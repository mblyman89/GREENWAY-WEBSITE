# D-65 — A rehearsal must not cost you your connections

**Requested:** "make sure to also exclude from the reset, the atm connection,
bank feeds, crypto, loans, credit cards. I don't want to have to re-establish
connections with all of them, it's a pain in the butt."

**Answer: it needed fixing, and it needed one more fix you did not ask for.**

---

## 1. What the reset would have done before this change

Measured from the migrations on disk, not from memory.

| Connection | Table | Before | After |
|---|---|---|---|
| ATM portal login (PAI) | `atm_connection` | **DELETED** | **KEPT** |
| Bank + card links | `plaid_items` | **DELETED** | **KEPT** |
| Which account is main/ATM/credit | `plaid_accounts` | **DELETED** | **KEPT** |
| Hand-entered loan terms | `manual_loans` | **DELETED** | **KEPT** |
| Crypto wallets | `crypto_wallets` | kept | kept |
| Crypto assets / rules / confirmations | `crypto_assets`, `crypto_classification_rules`, `crypto_owner_wallet_confirmations` | kept | kept |
| Saved integration keys | `integration_credentials` | kept | kept |

The crypto side was already safe. **The ATM and bank sides were not.** The
`atm_` and `plaid_` families were blanket WIPE with no carve-outs, so pressing
reset would have logged you out of the PAI portal and unlinked Timberland and
Citi — meaning a fresh Plaid Link run, with bank credentials and MFA codes, per
institution, every time you rehearsed.

**Credit cards:** there is no separate credit-card table. A credit card is a
`plaid_accounts` row with `role = 'credit'`. Keeping `plaid_accounts` keeps the
cards, including the role you assigned. Verified — no other card table exists in
any migration.

## 2. The trap I found while fixing it

This is the part that was not in the request, and it is the part that would have
hurt.

Plaid's `/transactions/sync` is a **cursor** protocol. You send the cursor you
saved last time; Plaid replies only with what changed **since** it. It never
re-sends what it already gave you. `plaid_items.transactions_cursor` stores that
position.

So simply keeping the connection would have created this:

1. Reset keeps `plaid_items` — cursor and all.
2. Reset empties `plaid_transactions`.
3. Next sync sends the saved cursor and resumes **past** the deleted rows.
4. Plaid returns almost nothing, because nothing changed.

Result: a bank that shows **connected and healthy, with no transactions in it**.
The history is gone from the database and Plaid will not send it again. Nothing
raises an error. You would not find out until you noticed a year of bank
activity missing — after seeding real data on top of it.

**Fix:** the reset now *rewinds* the connections it keeps. The login survives;
the reading position goes back to the start, so the next sync does a full
backfill. This is an `UPDATE`, not a delete, so it changes no row counts:

```sql
update public.plaid_items
   set transactions_cursor = null, last_successful_sync = null ...
update public.atm_connection
   set last_sync_at = null, last_error = null ...
```

The ATM feed pulls by date range rather than cursor, so that one is honesty
rather than correctness — it stops the screen advertising a successful sync for
data that no longer exists.

## 3. The line that was drawn

**KEEP — things only you can supply.** Credentials, institution links, account
identity, owner-typed terms and judgements.

**WIPE — things the connection re-fetches by itself.** Settlements, transactions,
balances, price snapshots, webhooks, cash loads, terminal status, loan payments.

Keeping the connection must never become keeping the test data, so every one of
these still clears: `plaid_transactions`, `plaid_holdings`, `plaid_mortgages`,
`plaid_webhook_events`, `atm_settlements`, `atm_transactions`, `atm_cash_loads`,
`atm_reconciliation`, `atm_terminal_status`, `crypto_transactions`,
`crypto_balances`, `crypto_price_snapshots`, `crypto_sync_state`,
`manual_loan_payments`.

Each carve-out is a **specific table rule**, which the classifier checks *before*
the family prefix. That is deliberate: a KEEP that came from a family default
could be lost silently by an unrelated edit. A test asserts each one resolves
with `source: "table"`, so if someone deletes the rule the family takes over and
the build fails instead of the connection quietly being destroyed again.

## 4. Numbers

| | Before | After |
|---|---|---|
| Tables in schema | 258 | 258 |
| Classified WIPE | 138 | **134** |
| Classified KEEP | 120 | **124** |
| Unclassified | 0 | 0 |
| SQL ↔ rules parity | 138 ↔ 138 | **134 ↔ 134** |

Exactly four tables moved. The reset still empties the clear majority of the
schema, and a test holds that line so carve-outs cannot creep.

## 5. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `eslint src tests` | 17 warnings — **identical to the pre-change baseline**, none in any file touched |
| Full suite | **606 files, 15,555 tests, all passing** (+12) |
| Mutation testing | **17 / 17 killed, 0 survivors** |

The mutation run is the part that matters. It breaks the fix deliberately, one
change at a time, and requires the suite to fail each time. Among the mutants
killed: flipping each connection back to WIPE; re-adding each `delete` to the
SQL; **removing the cursor rewind while leaving the connection intact** (the
silent-history-loss case); "fixing" the cursor by deleting the item instead; and
removing the disclosure from the on-screen briefing.

## 6. What the screen now tells you

The reset page states, in plain words, that your connections are kept — Plaid
links including the main/ATM/credit roles, the ATM portal login, crypto wallets,
and hand-entered loan terms — that what those connections *fetched* is still
erased, and that the sync position is rewound so the full history downloads
again. A test asserts the briefing actually says this, so the promise cannot
drift away from the behaviour.

## 7. One correction to an earlier test I wrote

My first draft of the orphan test listed `plaid_accounts` as a wiped child. It
is kept, so the test failed immediately. That is the test catching me rather
than me catching the test, and the corrected version records why the pair is
`KEEP → KEEP` and orphans nothing. Noting it because the standing rule is to
report what actually happened.

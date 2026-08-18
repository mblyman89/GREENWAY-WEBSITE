-- =============================================================================
-- SLICE books-05 — BANK MATCHING AND RECONCILIATION
-- =============================================================================
-- Migration 0189. IDEMPOTENT: safe to run twice. Applied MANUALLY by the owner.
--
-- WHAT THIS SLICE IS FOR, in the owner's own words (standing rule 1, verbatim):
--   "Slice 5 — bank matching. Every draft entry matched against what actually
--    hit the bank, so nothing is invented and nothing is missed."
--
-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION IS WRITTEN SO DEFENSIVELY
-- ---------------------------------------------------------------------------
-- Every other posting slice fails LOUDLY. An out-of-balance payroll journal
-- will not post. A bill with no vendor will not post. Bank matching is
-- different, and the difference is the reason for every guard below:
--
--     A WRONGLY MATCHED BANK TRANSACTION STILL BALANCES.
--
-- Flip the sign and BOTH lines flip together: debits still equal credits, the
-- journal still sums to zero, nothing errors, no screen turns red. Code a
-- transfer between the owner's own accounts as revenue and it balances. Post the
-- same bank line twice and both entries balance. There is no imbalance to catch.
-- The only symptom is a wrong tax return, found — if ever — by an examiner.
--
-- Standing rule 19 records that this has happened to this business once already:
-- the "backwards card signs" in the Sage books. The whole purpose of this file is
-- to make sure it cannot happen a second time in a new place.
--
-- ---------------------------------------------------------------------------
-- THE SIGN WALL — READ THIS BEFORE CHANGING ANY ARITHMETIC HERE
-- ---------------------------------------------------------------------------
-- There are two money-sign conventions in this database and they are EXACT
-- OPPOSITES for the cash line:
--
--   plaid_transactions.amount_cents  (migration 0157, line 96)
--       POSITIVE = money LEFT the account (an outflow)
--       NEGATIVE = money CAME IN         (an inflow)
--
--   gl_journal_lines.amount_cents    (migration 0172, line 382)
--       POSITIVE = DEBIT
--       NEGATIVE = CREDIT
--
-- Money arriving at the bank must DEBIT cash (ledger positive) and arrives as
-- Plaid NEGATIVE. Money leaving must CREDIT cash (ledger negative) and leaves as
-- Plaid POSITIVE. So the crossing is always a negation:
--
--       ledger_cash_cents = -plaid_amount_cents
--
-- That crossing happens in exactly ONE place in TypeScript
-- (plaidToLedgerCashCents in src/lib/accounting/bank-match-core.ts) and is
-- enforced independently here by gl_bank_sign_agrees(). Defence in depth: a UI
-- can be bypassed by anyone with a database connection; a CHECK cannot.
--
-- ---------------------------------------------------------------------------
-- SECTIONS
--   §1  Authorities, verbatim
--   §2  gl_bank_matches      — the match record (owner-only)
--   §3  Bridge columns on plaid_transactions
--   §4  gl_bank_reconciliations — a signed-off period (owner-only)
--   §5  gl_bank_sign_agrees()  — the independent sign guard
--   §6  gl_post_bank_match()   — the only sanctioned door
--   §7  gl_unmatch_bank_row()  — supersede, never delete
--   §8  gl_bank_reconcile()    — the both-sides reconciliation
--   §9  Row level security — owner-only, absolutely
--   §10 gl_audit_bank_wiring() — a self-check that returns problems only
--   §11 How to run this
-- =============================================================================

-- ═════════════════════════════════════════════════════════════════════════════
-- §1  THE AUTHORITIES, VERBATIM
--
-- Quoted exactly from primary sources, verified 2026-08-17. These are not
-- decoration: the plain-English refusal text in
-- src/lib/accounting/gl-refusal-core.ts quotes them, and a drift test asserts
-- the wording has not changed. A paraphrased regulation is one you cannot rely
-- on in a dispute.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- A1. IRM 4.10.4, Examination of Income (revised 08-29-2025)
--     https://www.irs.gov/irm/part4/irm_04-010-004
--     (§4.10.4.1.8 "Related Resources" expressly lists "Marijuana Cases".)
--
--   §4.10.4.2.3.7(2) — what a bank analysis is FOR:
--     "This analysis is used to:
--        a. Identify deposits which may be taxable income,
--        b. Determine whether business expenses may have been paid from other
--           sources (such as cash-on-hand or accumulated funds) or are
--           overstated,
--        c. Estimate the risk of commingled personal and business
--           bank/financial accounts, and
--        d. Determine whether cash is deposited."
--
--   §4.10.4.2.3.7(3)(b) Reminder — the transfer trap:
--     "Nontaxable funds, transfers-in, and returned deposits need to be
--      subtracted from total deposits to get 'Taxable Deposits.'"
--
--   §4.10.4.2.3.4(4) — weak internal controls. Read honestly, this list is a
--   catalogue of every way an unreviewed bank matcher can hurt you:
--     "a. Books and records that cannot be reconciled to the tax return
--      b. Transactions that are not properly authorized
--      c. Recorded transactions are not valid
--      d. Existing transactions are not recorded
--      e. Transactions are improperly valued
--      f. Transactions are improperly classified
--      g. Transaction are recorded at the improper time
--      h. Transactions are improperly posted
--      i. Lack of segregation of duties
--      j. Significant commingling of business and personal funds"
--
-- A2. Reg. §1.6001-1(a) — Records:
--     "...any person subject to tax under subtitle A of the Code... shall keep
--      such permanent books of account or records, including inventories, as are
--      sufficient to establish the amount of gross income, deductions, credits,
--      or other matters required to be shown by such person in any return of such
--      tax or information."
--
-- A3. WAC 314-55-087 — Recordkeeping requirements for cannabis licensees
--     (current: WSR 24-19-040, filed 9/11/24, effective 10/12/24)
--   (1)   "Cannabis licensees are responsible to keep records that clearly
--          reflect all financial transactions and the financial condition of the
--          business. The following records must be kept and maintained on the
--          licensed premises for a five-year period and must be made available
--          for inspection if requested by an employee of the LCB:"
--   (1)(b) "Bank statements and canceled checks for any accounts relating to the
--          licensed business;"
--   (2)(a) "Provides an audit trail so that details (invoices and vouchers)
--          underlying the summary accounting data may be identified and made
--          available upon request."
--   (2)(b) "Provides the opportunity to trace any transaction back to the
--          original source or forward to a final total. If printouts of
--          transactions are not made when they are processed, the system must
--          have the ability to reconstruct these transactions."
--
--   => THIS IS A STATE-LAW MANDATE FOR EXACTLY WHAT THIS MIGRATION BUILDS.
--      A match must carry its evidence in BOTH directions (bank row -> journal
--      AND journal -> bank row), and the five-year retention rule is why an
--      unmatch SUPERSEDES rather than deletes. Nothing here is ever hard-deleted.
--
-- A4. IRC §163(a) — Interest:
--     "(a) General rule. There shall be allowed as a deduction all interest paid
--      or accrued within the taxable year on indebtedness."
--   => Only the INTEREST part of a loan payment is an expense. Principal reduces
--      a liability; escrow is an asset held by the servicer. One-line "mortgage
--      expense" coding is wrong three ways at once.
--
-- A5. Californians Helping to Alleviate Medical Problems, Inc. v. Commissioner,
--     128 T.C. 173 (2007) ("CHAMP")
--   => §280E reaches the TRADE OR BUSINESS that traffics, not the taxpayer. The
--      landholding and ATM entities are separate trades or businesses, so THEIR
--      interest is fully deductible. This is why interest cost class is derived
--      from the entity (interestCostClassFor) and never hardcoded.
--
-- A6. 31 CFR 1010.311 — Currency transaction reports:
--     "Each financial institution other than a casino shall file a report of
--      each deposit, withdrawal, exchange of currency or other payment or
--      transfer, by, through, or to such financial institution which involves a
--      transaction in currency of more than $10,000, except as otherwise
--      provided in this section."
--
-- A7. 31 U.S.C. §5324(a),(d)(1) — Structuring:
--     "No person shall, for the purpose of evading the reporting requirements of
--      section 5313(a)... (3) structure or assist in structuring, or attempt to
--      structure or assist in structuring, any transaction with one or more
--      domestic financial institutions."
--     "Whoever violates this section shall be fined in accordance with title 18,
--      United States Code, imprisoned for not more than 5 years, or both."
--   => A cash-only cannabis retailer is the textbook exposure profile. The
--      offence is in the PURPOSE, not the amount, so the system SURFACES the
--      pattern to the owner and never accuses or blocks. Being unsurprised by
--      what an examiner can see is the entire defence.

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITION — refuse to run out of order rather than half-apply.
--
-- WHY THIS BLOCK EXISTS. These files are pasted BY HAND, one at a time, in
-- numeric order. A human reading file names can skip one. Without this block,
-- running 0189 too early does not produce a sentence telling you what to do; it
-- produces a raw PostgreSQL error about a relation that does not exist, several
-- hundred lines in, with no hint about WHICH earlier file was missed.
--
-- Every statement below runs inside one transaction, so a failure here changes
-- NOTHING. That is the point: refuse completely, in plain English, rather than
-- half-build a bank-matching system on top of a ledger that is not there yet.
-- ═══════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0189 needs public.is_owner(), which migration 0185 creates. Run 0185_books_owner_only.sql first, then 0186, 0187, 0188, then this file.';
  end if;

  -- The general ledger this slice matches the bank against.
  if to_regclass('public.gl_journals') is null
     or to_regclass('public.gl_journal_lines') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0189 matches bank lines against the general ledger from 0172. Run the 0172-0178 books migrations first.';
  end if;

  if to_regclass('public.gl_accounts') is null
     or to_regclass('public.gl_entities') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0189 needs the chart of accounts and the entity list from 0172/0173. Run 0172_gl_foundation.sql and 0173_chart_of_accounts.sql first.';
  end if;

  -- The bank side. This migration bridges plaid_transactions INTO the ledger;
  -- without that table there is nothing to bridge, and the bridge columns in
  -- §3 below would have nowhere to attach.
  if to_regclass('public.plaid_transactions') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0189 bridges plaid_transactions (migration 0157) to the ledger. Run 0157_plaid_foundation.sql first.';
  end if;

  -- The bridge writes plaid_transactions.transaction_id into gl_bank_matches and
  -- relies on it being unique. 0157 declares it so. If a future edit ever drops
  -- that guarantee, the double-match protection in §2 silently weakens - so the
  -- guarantee is checked here rather than assumed.
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
     where c.relname = 'plaid_transactions'
       and c.relnamespace = 'public'::regnamespace
       and i.indisunique
       and a.attname = 'transaction_id'
       and i.indnatts = 1
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0189 requires plaid_transactions.transaction_id to be UNIQUE (migration 0157 declares it). Without that, one bank line could be matched twice. Re-run 0157_plaid_foundation.sql.';
  end if;
end;
$precheck$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §2  gl_bank_matches — the match record.
--
-- One row per (bank line -> journal) link. This table IS the audit trail that
-- WAC 314-55-087(2)(b) requires, which drives three design choices:
--   * `superseded_at` instead of DELETE — five-year retention, and an examiner
--     can see that a wrong match was made AND that it was corrected.
--   * both `ledger_cash_cents` and `plaid_amount_cents` are stored, so the sign
--     relationship is provable from the row itself long after the fact.
--   * a partial unique index makes double-matching impossible at the storage
--     layer, not merely discouraged at the application layer.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_bank_matches (
  id                   uuid primary key default gen_random_uuid(),

  -- The bank side. Text, referencing plaid_transactions.transaction_id, which is
  -- unique in 0157. NOT a FK with cascade: a Plaid resync must never be able to
  -- silently delete accounting evidence.
  transaction_id       text not null,
  plaid_account_id     text not null,

  -- The ledger side.
  journal_id           uuid not null references public.gl_journals(id) on delete restrict,
  entity_id            uuid not null references public.gl_entities(id) on delete restrict,

  -- BOTH signs, stored side by side on purpose. If the two ever disagree with
  -- ledger = -plaid, the audit in §10 reports it, and the row itself is the
  -- evidence of which way round it was written.
  plaid_amount_cents   bigint not null,
  ledger_cash_cents    bigint not null,

  -- What kind of real-world event this was. The single most consequential field
  -- in the slice: it decides whether a dollar becomes income, an expense, a
  -- transfer between the owner's own pockets, or nothing at all.
  event_kind           text not null
                         check (event_kind in (
                           'deposit_of_sales','vendor_payment','payroll_funding',
                           'loan_payment','own_transfer','owner_draw',
                           'owner_contribution','bank_fee','interest_income',
                           'tax_payment','atm_vault'
                         )),

  -- 0..100000 milli-percent. Integers only — a confidence stored as a float
  -- would be the one non-integer number in a system whose whole discipline is
  -- integers, and disciplines fail at their exceptions.
  confidence_milli_pct integer not null default 0
                         check (confidence_milli_pct between 0 and 100000),

  -- Was this the owner's decision, or the engine's proposal that he accepted?
  -- IRM 4.10.4.2.3.4(4)(b) names "Transactions that are not properly
  -- authorized" as a weak-control symptom, so authorship is recorded.
  matched_by           uuid references public.staff_profiles(id) on delete set null,
  matched_at           timestamptz not null default now(),
  match_method         text not null default 'manual'
                         check (match_method in ('manual','proposed_accepted','auto')),

  -- Supersede, never delete (WAC 314-55-087(1): five-year retention).
  superseded_at        timestamptz,
  superseded_reason    text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.gl_bank_matches is
  'One row per bank-line-to-journal match. Stores BOTH sign conventions (plaid_amount_cents and ledger_cash_cents) so the sign relationship is provable from the row itself. Never hard-deleted: superseded_at preserves the audit trail required by WAC 314-55-087(2)(b) for five years. Owner-only.';

comment on column public.gl_bank_matches.plaid_amount_cents is
  'The bank feed sign: POSITIVE = money LEFT the account (migration 0157).';
comment on column public.gl_bank_matches.ledger_cash_cents is
  'The ledger sign: POSITIVE = DEBIT (migration 0172). Must equal -plaid_amount_cents; enforced by the CHECK below and re-checked by gl_audit_bank_wiring().';

-- THE SIGN WALL, AS A CONSTRAINT.
-- This is the most important line in the file. It makes the backwards-sign error
-- physically unstorable rather than merely unlikely. Added separately so the
-- migration stays idempotent on re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'gl_bank_matches_sign_wall'
       and conrelid = 'public.gl_bank_matches'::regclass
  ) then
    alter table public.gl_bank_matches
      add constraint gl_bank_matches_sign_wall
      check (ledger_cash_cents = -plaid_amount_cents);
  end if;
end $$;

-- ONE BANK LINE, ONE LIVE MATCH. Partial, so superseded rows do not block a
-- corrected re-match. This is the storage-layer half of GL_BANK_ALREADY_MATCHED.
create unique index if not exists gl_bank_matches_one_live_per_txn
  on public.gl_bank_matches (transaction_id)
  where superseded_at is null;

-- ONE JOURNAL, ONE LIVE MATCH. The mirror image, and just as necessary: without
-- it, one entry could absorb two bank lines and the second line's money would
-- simply be missing from the books.
create unique index if not exists gl_bank_matches_one_live_per_journal
  on public.gl_bank_matches (journal_id)
  where superseded_at is null;

create index if not exists idx_gl_bank_matches_entity on public.gl_bank_matches (entity_id);
create index if not exists idx_gl_bank_matches_account on public.gl_bank_matches (plaid_account_id);
create index if not exists idx_gl_bank_matches_live
  on public.gl_bank_matches (plaid_account_id) where superseded_at is null;

drop trigger if exists trg_gl_bank_matches_updated_at on public.gl_bank_matches;
create trigger trg_gl_bank_matches_updated_at
  before update on public.gl_bank_matches
  for each row execute function public.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- §3  BRIDGE COLUMNS on plaid_transactions.
--
-- WAC 314-55-087(2)(b) requires tracing "back to the original source or forward
-- to a final total" — both directions. gl_bank_matches gives bank -> ledger;
-- these columns give ledger <- bank cheaply, so the unmatched-work queue is an
-- index scan rather than an anti-join over every transaction ever synced.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.plaid_transactions
  add column if not exists gl_match_id   uuid references public.gl_bank_matches(id) on delete set null,
  add column if not exists gl_journal_id uuid references public.gl_journals(id) on delete set null,
  add column if not exists gl_matched_at timestamptz;

comment on column public.plaid_transactions.gl_match_id is
  'The live match for this bank line, or NULL when it still needs one. Set only by gl_post_bank_match(); cleared only by gl_unmatch_bank_row().';

-- The work queue: settled, not removed, on or after the cut-over, not matched.
create index if not exists idx_plaid_transactions_unmatched
  on public.plaid_transactions (date)
  where gl_match_id is null and pending = false and removed = false;

-- ═════════════════════════════════════════════════════════════════════════════
-- §4  gl_bank_reconciliations — a period the owner has signed off.
--
-- The point of storing a reconciliation rather than recomputing it: a signed-off
-- period is a statement of fact made on a date, and IRM 4.10.4.2.3.4(4)(a) names
-- "Books and records that cannot be reconciled to the tax return" as the FIRST
-- symptom of weak controls. This table is the answer to that.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_bank_reconciliations (
  id                        uuid primary key default gen_random_uuid(),

  entity_id                 uuid not null references public.gl_entities(id) on delete restrict,
  plaid_account_id          text not null,
  gl_account_code           text not null,

  period_start              date not null,
  period_end                date not null,

  statement_closing_cents   bigint not null,
  ledger_balance_cents      bigint not null,
  in_bank_not_books_cents   bigint not null default 0,
  in_books_not_bank_cents   bigint not null default 0,
  -- BOTH adjusted figures, because a real reconciliation adjusts BOTH sides.
  -- Leaving the second one out invents unexplained gaps out of clean books, and
  -- a control that cries wolf every month teaches the owner to ignore it.
  adjusted_ledger_cents     bigint not null,
  adjusted_bank_cents       bigint not null,
  difference_cents          bigint not null,

  -- `ties` MEANS THE ARITHMETIC CLOSES. IT DOES NOT MEAN THE MONTH IS FINISHED.
  -- See the `unrecorded_item_count` note immediately below; the two together are
  -- what governs sign-off.
  ties                      boolean not null,

  -- ─────────────────────────────────────────────────────────────────────────
  -- THE D8 COLUMNS. A reconciliation has TWO kinds of reconciling item:
  --
  --   TIMING DIFFERENCES  uncashed cheques, deposits in transit. The books are
  --                       already right; these clear themselves. NO ENTRY.
  --   UNRECORDED ITEMS    bank charges, interest, NSF returns, forgotten
  --                       auto-debits. The books are WRONG until an entry is
  --                       posted. AN ENTRY IS MANDATORY.
  --
  -- Collapsing the two is not academic. Proven against a live database: empty
  -- books plus one unrecorded $77.00 service fee returned ties=true and
  -- difference=0, because the fee is added to the ledger side AND is already
  -- inside the bank's closing balance, so it cancels itself. The owner would
  -- sign off a "clean" month with $77 of deductible expense missing from the
  -- profit and loss. A year of card fees treated that way is a deduction never
  -- claimed on a return that OVERSTATES income - tax paid that was never owed.
  --
  -- WA SAO BARS Manual 3.1.9.15(4), verbatim:
  --   "Identifying transactions from the bank accounts need to be recorded in
  --    the accounting records. For example, some of these items could include
  --    interest earned, bank fees or charges, NSF checks, and unrecorded
  --    deposits ... Accounting records should be updated for all such
  --    transactions identified in the bank statements."
  -- 3.1.9.15(5), verbatim:
  --   "After adjusting for reconciling items, there should be no further
  --    differences between bank statements and accounting records."
  unrecorded_item_count     integer not null default 0,
  -- `complete` is the honest flag: it ties AND there is nothing left to write
  -- down. This, never `ties` alone, is what sign-off is allowed to rely on.
  complete                  boolean not null default false,

  signed_off_by             uuid references public.staff_profiles(id) on delete set null,
  signed_off_at             timestamptz,
  notes                     text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  check (period_end >= period_start),
  -- The reconciliation must be internally consistent. If these ever disagree the
  -- stored row is arithmetic fiction, so it cannot be stored at all.
  check (adjusted_ledger_cents = ledger_balance_cents + in_bank_not_books_cents),
  check (adjusted_bank_cents   = statement_closing_cents + in_books_not_bank_cents),
  check (difference_cents      = adjusted_ledger_cents - adjusted_bank_cents),
  check (ties = (difference_cents = 0)),
  check (unrecorded_item_count >= 0),
  -- `complete` is not a free-form opinion. It is forced to equal the definition,
  -- so no caller and no future migration can mark an unfinished month finished.
  check (complete = (difference_cents = 0 and unrecorded_item_count = 0)),
  -- AND THE GATE THAT MATTERS: a month may only be signed off when it is
  -- complete. Not when it merely balances.
  check (signed_off_at is null or complete),
  check ((signed_off_by is null) = (signed_off_at is null))
);

-- Idempotent upgrade path for a database where 0189 was applied before the D8
-- columns existed. `create table if not exists` above will NOT add them to an
-- existing table, so they are added explicitly here.
alter table public.gl_bank_reconciliations
  add column if not exists unrecorded_item_count integer not null default 0;
alter table public.gl_bank_reconciliations
  add column if not exists complete boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.gl_bank_reconciliations'::regclass
       and conname  = 'gl_bank_recs_complete_is_defined'
  ) then
    alter table public.gl_bank_reconciliations
      add constraint gl_bank_recs_complete_is_defined
      check (complete = (difference_cents = 0 and unrecorded_item_count = 0));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.gl_bank_reconciliations'::regclass
       and conname  = 'gl_bank_recs_signoff_needs_complete'
  ) then
    alter table public.gl_bank_reconciliations
      add constraint gl_bank_recs_signoff_needs_complete
      check (signed_off_at is null or complete);
  end if;
end $$;

comment on table public.gl_bank_reconciliations is
  'A reconciliation of one cash account for one period. The CHECK constraints make an internally inconsistent reconciliation unstorable: both sides must be adjusted, the difference must follow, and ties must agree with the difference being zero. A signed-off period with ties=false is a period with a known, named, unexplained amount - which is honest. What is forbidden is a plug that makes it disappear.';

-- NO PLUGS. Standing rule 19 records the "20009 LAZY INVENTORY ENTRY" of
-- $4,624,697.31 in the Sage books: a single balancing figure that concealed two
-- structural problems for years. A reconciliation may report a difference; it
-- may never invent a number to absorb one.
create unique index if not exists gl_bank_recon_one_per_period
  on public.gl_bank_reconciliations (entity_id, plaid_account_id, period_start, period_end);

create index if not exists idx_gl_bank_recon_entity on public.gl_bank_reconciliations (entity_id);

drop trigger if exists trg_gl_bank_recon_updated_at on public.gl_bank_reconciliations;
create trigger trg_gl_bank_recon_updated_at
  before update on public.gl_bank_reconciliations
  for each row execute function public.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- §5  gl_bank_sign_agrees() — the independent sign guard.
--
-- Deliberately duplicates plaidToLedgerCashCents() in TypeScript. That is not
-- redundancy, it is the design: the TS function guards the app, this function
-- guards the DATABASE, and neither trusts the other. Anyone with a connection
-- string can bypass the UI; nobody can bypass this.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_bank_sign_agrees(
  p_plaid_amount_cents bigint,
  p_ledger_cash_cents  bigint
)
returns boolean
language sql
immutable
as $$
  select p_ledger_cash_cents = -p_plaid_amount_cents;
$$;

comment on function public.gl_bank_sign_agrees(bigint, bigint) is
  'TRUE when the ledger cash amount is the correct negation of the Plaid amount. Plaid: POSITIVE = money OUT (0157). Ledger: POSITIVE = DEBIT (0172). The conventions are exact opposites, so the crossing is always a negation. This exists because a backwards-signed match STILL BALANCES and therefore cannot be caught by any balance check.';

revoke all on function public.gl_bank_sign_agrees(bigint, bigint) from public;
grant execute on function public.gl_bank_sign_agrees(bigint, bigint) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §6  gl_post_bank_match() — the ONE sanctioned door.
--
-- Owner-only. Refuses everything src/lib/accounting/bank-match-core.ts refuses,
-- independently. Every raise code has a plain-English translation in
-- src/lib/accounting/gl-refusal-core.ts, and a drift test scans this file to
-- prove none is missing — so the owner can never be shown raw database text.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_post_bank_match(
  p_transaction_id       text,
  p_journal_id           uuid,
  p_event_kind           text,
  p_confidence_milli_pct integer default 0,
  p_match_method         text    default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn        public.plaid_transactions%rowtype;
  v_journal    public.gl_journals%rowtype;
  v_cash_cents bigint;
  v_cash_count integer;
  v_expected   bigint;
  v_match_id   uuid;
  v_cutover    date := date '2026-01-01';
begin
  -- OWNER-ONLY. Verbatim owner directive: "there is no reason anyone else needs
  -- to see my books or my financials ever." An admin may still pay vendors and
  -- run payroll; what an admin may not do is write the ledger the tax return is
  -- built from, because only the owner signs that return.
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_txn
    from public.plaid_transactions
   where transaction_id = p_transaction_id;

  if not found then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: no bank line with that id'
      using errcode = 'raise_exception';
  end if;

  select * into v_journal from public.gl_journals where id = p_journal_id;
  if not found then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: no journal with that id'
      using errcode = 'raise_exception';
  end if;

  -- A pending line's amount AND date can both still change, and some vanish.
  -- Posting one creates an entry whose source later contradicts it.
  if v_txn.pending then
    raise exception 'GL_BANK_PENDING_ROW: that bank line is still pending and cannot be posted yet'
      using errcode = 'raise_exception';
  end if;

  -- removed = true is Plaid's soft delete: the bank reversed or cancelled it.
  -- The correct entry for an event that did not happen is no entry at all.
  if v_txn.removed then
    raise exception 'GL_BANK_REMOVED_ROW: the bank withdrew that line, so there is nothing to record'
      using errcode = 'raise_exception';
  end if;

  -- Standing rule 10: the line in the sand. Anything earlier belongs to the Sage
  -- books and to closed, filed years.
  if v_txn.date < v_cutover then
    raise exception 'GL_BANK_PRE_CUTOVER: that bank line is dated before %, which is earlier than these books begin', v_cutover
      using errcode = 'raise_exception';
  end if;

  if p_event_kind is null or btrim(p_event_kind) = '' then
    raise exception 'GL_BANK_UNCLASSIFIED: that line has not been identified yet, so it cannot post'
      using errcode = 'raise_exception';
  end if;

  -- Double-posting, BOTH directions. The unique indexes in §2 also enforce this
  -- at the storage layer; these raises exist so the owner gets a sentence he can
  -- act on instead of a constraint-violation string.
  if exists (
    select 1 from public.gl_bank_matches
     where transaction_id = p_transaction_id and superseded_at is null
  ) then
    raise exception 'GL_BANK_ALREADY_MATCHED: that bank line is already matched to an entry'
      using errcode = 'raise_exception';
  end if;

  if exists (
    select 1 from public.gl_bank_matches
     where journal_id = p_journal_id and superseded_at is null
  ) then
    raise exception 'GL_BANK_JOURNAL_ALREADY_MATCHED: that entry is already matched to a different bank line'
      using errcode = 'raise_exception';
  end if;

  -- Find the cash line on the journal. Cash accounts are 10200 (Bank —
  -- Operating), 10300 (Bank — ATM Vault), 10400 (Undeposited Funds) and 10900
  -- (Cash — Clearing/In Transit): all seeded in migration 0173, none invented
  -- here.
  select count(*), coalesce(sum(l.amount_cents), 0)
    into v_cash_count, v_cash_cents
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
   where l.journal_id = p_journal_id
     and a.code in ('10200','10300','10400','10900');

  if v_cash_count = 0 then
    raise exception 'GL_BANK_ACCOUNT_NOT_CASH: that entry has no cash line, so there is nothing for the bank to agree with'
      using errcode = 'raise_exception';
  end if;

  -- ── THE SIGN WALL ──────────────────────────────────────────────────────────
  -- Checked BEFORE the amount, and the order matters. If both the sign and the
  -- magnitude are wrong, the sign is the more dangerous error and the more
  -- useful thing to be told, because a magnitude error is visible on inspection
  -- and a sign error is not.
  v_expected := -v_txn.amount_cents;

  if not public.gl_bank_sign_agrees(v_txn.amount_cents, v_cash_cents) then
    if abs(v_cash_cents) = abs(v_expected) then
      raise exception 'GL_BANK_SIGN_DISAGREES: the bank and the entry disagree about which way the money moved (bank % / entry %)',
        v_txn.amount_cents, v_cash_cents
        using errcode = 'raise_exception';
    else
      raise exception 'GL_BANK_AMOUNT_MISMATCH: the bank shows % and the entry shows % on the cash line',
        v_expected, v_cash_cents
        using errcode = 'raise_exception';
    end if;
  end if;

  -- Four separate sets of books. Money that crosses between them is a loan or a
  -- distribution, never a shared entry. IRM 4.10.4.2.3.4(4)(j).
  if v_journal.entity_id is null then
    raise exception 'GL_BANK_ENTITY_MISMATCH: that entry has no entity, so it cannot be matched'
      using errcode = 'raise_exception';
  end if;

  insert into public.gl_bank_matches (
    transaction_id, plaid_account_id, journal_id, entity_id,
    plaid_amount_cents, ledger_cash_cents, event_kind,
    confidence_milli_pct, matched_by, match_method
  ) values (
    p_transaction_id, v_txn.account_id, p_journal_id, v_journal.entity_id,
    v_txn.amount_cents, v_cash_cents, btrim(p_event_kind),
    coalesce(p_confidence_milli_pct, 0), auth.uid(), coalesce(p_match_method, 'manual')
  )
  returning id into v_match_id;

  -- Stamp the bridge so the paper and the ledger point at each other, which is
  -- what WAC 314-55-087(2)(b) means by tracing in both directions.
  update public.plaid_transactions
     set gl_match_id   = v_match_id,
         gl_journal_id = p_journal_id,
         gl_matched_at = now()
   where transaction_id = p_transaction_id;

  return jsonb_build_object(
    'match_id',          v_match_id,
    'transaction_id',    p_transaction_id,
    'journal_id',        p_journal_id,
    'plaid_amount_cents', v_txn.amount_cents,
    'ledger_cash_cents',  v_cash_cents,
    'event_kind',        btrim(p_event_kind)
  );
end;
$$;

comment on function public.gl_post_bank_match(text, uuid, text, integer, text) is
  'The ONLY sanctioned way to match a bank line to a journal. Owner-only. Independently re-checks everything bank-match-core.ts checks: pending, removed, pre-cut-over, unclassified, double-posting in BOTH directions, the presence of a cash line, and above all the SIGN WALL - because a backwards-signed match still balances and no balance check can ever catch it.';

revoke all on function public.gl_post_bank_match(text, uuid, text, integer, text) from public;
grant execute on function public.gl_post_bank_match(text, uuid, text, integer, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §7  gl_unmatch_bank_row() — supersede, never delete.
--
-- WAC 314-55-087(1) requires records be kept five years. A mistaken match that
-- vanishes without trace is worse than one that is visibly corrected: an
-- examiner who can see the correction can see the control working.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_unmatch_bank_row(
  p_transaction_id text,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'GL_BANK_UNCLASSIFIED: say why the match is being undone, so the audit trail explains itself'
      using errcode = 'raise_exception';
  end if;

  update public.gl_bank_matches
     set superseded_at     = now(),
         superseded_reason = btrim(p_reason)
   where transaction_id = p_transaction_id
     and superseded_at is null
  returning id into v_match_id;

  if v_match_id is null then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: there is no live match on that bank line to undo'
      using errcode = 'raise_exception';
  end if;

  update public.plaid_transactions
     set gl_match_id = null, gl_journal_id = null, gl_matched_at = null
   where transaction_id = p_transaction_id;

  return jsonb_build_object('superseded_match_id', v_match_id, 'reason', btrim(p_reason));
end;
$$;

comment on function public.gl_unmatch_bank_row(text, text) is
  'Undoes a match by SUPERSEDING it, never deleting it, and requires a reason. The five-year retention rule (WAC 314-55-087(1)) and the audit-trail rule (2)(b) both point the same way: a corrected mistake that is visible is evidence the controls work.';

revoke all on function public.gl_unmatch_bank_row(text, text) from public;
grant execute on function public.gl_unmatch_bank_row(text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §8  gl_bank_reconcile() — the both-sides reconciliation.
--
--     adjusted books = book balance   + settled bank lines not yet recorded
--     adjusted bank  = bank statement + entries recorded but not yet cleared
--     difference     = adjusted books - adjusted bank        (zero = it ties)
--
-- The second line is the one that is easy to omit, and omitting it fails in the
-- WORST direction: it invents an unexplained gap out of books that are perfectly
-- clean. A cheque written on the 30th that the payee has not cashed is correctly
-- on the books and correctly absent from the statement. Nothing is wrong. Flag
-- that as a gap every month and the owner learns to ignore the warning — and
-- then the month a gap is REAL, he ignores that one too.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_bank_reconcile(
  p_entity_code             text,
  p_plaid_account_id        text,
  p_gl_account_code         text,
  p_period_start            date,
  p_period_end              date,
  p_statement_closing_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity      public.gl_entities%rowtype;
  v_account     public.gl_accounts%rowtype;
  v_ledger      bigint := 0;
  v_in_bank     bigint := 0;
  v_in_books    bigint := 0;
  v_adj_ledger  bigint;
  v_adj_bank    bigint;
  v_difference  bigint;
  v_ties        boolean;
  v_unrecorded  integer := 0;
  v_complete    boolean;
  v_id          uuid;
begin
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_entity from public.gl_entities where code = p_entity_code;
  if not found then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: no entity with code %', p_entity_code
      using errcode = 'raise_exception';
  end if;

  -- NOTE ON THE CHART OF ACCOUNTS: gl_accounts has NO entity_id column. The
  -- chart is SHARED across all four sets of books, and an account is scoped to
  -- particular entities by `allowed_entity_codes` (NULL meaning "available to
  -- every entity") — see migration 0172 §1 and the gl_submit_journal check at
  -- 0172 lines 727-728. The per-entity separation lives on gl_journal_lines,
  -- which carries its own entity_id.
  --
  -- This was originally written as `where code = ... and entity_id = ...`, which
  -- is a column that does not exist. plpgsql does not validate a function body
  -- when the function is created, so the migration applied perfectly cleanly and
  -- the function was broken only when someone actually called it. It was caught
  -- by running it against a real database, which is exactly why that step is not
  -- optional.
  select * into v_account
    from public.gl_accounts
   where code = p_gl_account_code
     and (allowed_entity_codes is null or p_entity_code = any(allowed_entity_codes));
  if not found then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: no account % available to the % books', p_gl_account_code, p_entity_code
      using errcode = 'raise_exception';
  end if;

  if p_gl_account_code not in ('10200','10300','10400','10900') then
    raise exception 'GL_BANK_ACCOUNT_NOT_CASH: % is not a cash account, so a bank statement cannot prove its balance', p_gl_account_code
      using errcode = 'raise_exception';
  end if;

  -- The ledger balance of the cash account through the period end. Signed
  -- ledger convention throughout: positive = debit = money.
  --
  -- THE `l.entity_id` FILTER IS LOAD-BEARING. Because the chart of accounts is
  -- shared, account 10200 is the SAME gl_accounts row for the shop, the ATM
  -- business and the land. Summing on account_id alone would silently blend all
  -- four sets of books into one balance — the exact commingling that IRM
  -- 4.10.4.2.3.4(4)(j) calls out, produced by the tool meant to prevent it, and
  -- it would never look wrong because the number would still be a plausible
  -- balance.
  select coalesce(sum(l.amount_cents), 0) into v_ledger
    from public.gl_journal_lines l
    join public.gl_journals j on j.id = l.journal_id
   where l.account_id = v_account.id
     and l.entity_id = v_entity.id
     and j.journal_date <= p_period_end
     and j.status = 'posted';

  -- Settled bank lines in the period with no entry yet. Negated on the way in,
  -- because Plaid POSITIVE = money out and the ledger needs a credit.
  --
  -- The COUNT is taken at the same time and is every bit as important as the
  -- sum: these lines are real money that has already moved with nothing written
  -- down against it. They are NOT timing differences and they do not clear
  -- themselves. See the D8 note on the table definition - the sum alone can net
  -- to a figure that makes the month look balanced while entries are missing.
  select coalesce(sum(-t.amount_cents), 0), count(*)
    into v_in_bank, v_unrecorded
    from public.plaid_transactions t
   where t.account_id = p_plaid_account_id
     and t.date between p_period_start and p_period_end
     and t.pending = false
     and t.removed = false
     and t.gl_match_id is null;

  -- Entries on the books that have not reached the bank: uncashed cheques and
  -- deposits in transit. These are NOT errors — they are correctly recorded and
  -- correctly not yet cleared, so the STATEMENT is adjusted for them.
  select coalesce(sum(l.amount_cents), 0) into v_in_books
    from public.gl_journal_lines l
    join public.gl_journals j on j.id = l.journal_id
   where l.account_id = v_account.id
     and l.entity_id = v_entity.id
     and j.journal_date between p_period_start and p_period_end
     and j.status = 'posted'
     and not exists (
       select 1 from public.gl_bank_matches m
        where m.journal_id = j.id and m.superseded_at is null
     );

  v_adj_ledger := v_ledger + v_in_bank;
  v_adj_bank   := p_statement_closing_cents + v_in_books;
  v_difference := v_adj_ledger - v_adj_bank;
  v_ties       := (v_difference = 0);
  -- TIES IS ARITHMETIC. COMPLETE IS TRUTH.
  v_complete   := (v_ties and v_unrecorded = 0);

  insert into public.gl_bank_reconciliations (
    entity_id, plaid_account_id, gl_account_code, period_start, period_end,
    statement_closing_cents, ledger_balance_cents,
    in_bank_not_books_cents, in_books_not_bank_cents,
    adjusted_ledger_cents, adjusted_bank_cents, difference_cents, ties,
    unrecorded_item_count, complete
  ) values (
    v_entity.id, p_plaid_account_id, p_gl_account_code, p_period_start, p_period_end,
    p_statement_closing_cents, v_ledger, v_in_bank, v_in_books,
    v_adj_ledger, v_adj_bank, v_difference, v_ties,
    v_unrecorded, v_complete
  )
  on conflict (entity_id, plaid_account_id, period_start, period_end)
  do update set
    statement_closing_cents = excluded.statement_closing_cents,
    ledger_balance_cents    = excluded.ledger_balance_cents,
    in_bank_not_books_cents = excluded.in_bank_not_books_cents,
    in_books_not_bank_cents = excluded.in_books_not_bank_cents,
    adjusted_ledger_cents   = excluded.adjusted_ledger_cents,
    adjusted_bank_cents     = excluded.adjusted_bank_cents,
    difference_cents        = excluded.difference_cents,
    ties                    = excluded.ties,
    unrecorded_item_count   = excluded.unrecorded_item_count,
    complete                = excluded.complete,
    -- RE-RUNNING A RECONCILIATION REVOKES ITS SIGN-OFF. The facts underneath it
    -- have just been recomputed; a signature that predates the recomputation no
    -- longer attests to anything. Michael signs the numbers he actually saw.
    signed_off_by           = null,
    signed_off_at           = null,
    updated_at              = now()
  returning id into v_id;

  return jsonb_build_object(
    'reconciliation_id',       v_id,
    'statement_closing_cents', p_statement_closing_cents,
    'ledger_balance_cents',    v_ledger,
    'unrecorded_item_count',   v_unrecorded,
    'complete',                v_complete,
    'in_bank_not_books_cents', v_in_bank,
    'in_books_not_bank_cents', v_in_books,
    'adjusted_ledger_cents',   v_adj_ledger,
    'adjusted_bank_cents',     v_adj_bank,
    'difference_cents',        v_difference,
    'ties',                    v_ties
  );
end;
$$;

comment on function public.gl_bank_reconcile(text, text, text, date, date, bigint) is
  'Reconciles one cash account for one period by adjusting BOTH sides: the books for settled bank lines not yet recorded, and the statement for entries not yet cleared. Reports the difference and NEVER plugs it - standing rule 19 records a $4,624,697.31 balancing figure in the old Sage books that hid two structural problems for years. Owner-only.';

revoke all on function public.gl_bank_reconcile(text, text, text, date, date, bigint) from public;
grant execute on function public.gl_bank_reconcile(text, text, text, date, date, bigint) to authenticated;

-- ===========================================================================
-- 8b  gl_sign_off_bank_reconciliation() - the signature, and what it costs.
--
-- Signing off is an ASSERTION, not a button. Michael is telling his own records,
-- and anyone who reads them later, that this month is finished and correct.
--
-- So the function refuses in exactly the circumstance an owner would expect to
-- get away with: a month that BALANCES but still has bank lines with no entry
-- against them. That month is not finished. The arithmetic closing is not the
-- test - see the D8 note on the table above, where empty books and one
-- unrecorded $77 fee produced difference = 0 and a cheerful all-clear.
--
-- A month that does NOT tie may still be signed off, deliberately, PROVIDED the
-- owner writes down what the unexplained amount is. An honest "there is $412
-- here I cannot explain yet" is a real audit trail. A plug that makes the $412
-- vanish is what standing rule 19 is about. We forbid the plug, not the honesty.
-- ===========================================================================
create or replace function public.gl_sign_off_bank_reconciliation(
  p_reconciliation_id uuid,
  p_notes             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.gl_bank_reconciliations%rowtype;
begin
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.gl_bank_reconciliations
   where id = p_reconciliation_id for update;
  if not found then
    raise exception 'GL_BANK_MATCH_NOT_FOUND: no reconciliation with that id'
      using errcode = 'raise_exception';
  end if;

  if r.signed_off_at is not null then
    raise exception 'GL_BANK_ALREADY_SIGNED_OFF: that period was already signed off on %', r.signed_off_at
      using errcode = 'raise_exception';
  end if;

  -- THE REFUSAL THAT MATTERS. Named separately from "it does not tie", because
  -- the two mean completely different things and deserve different advice.
  if r.unrecorded_item_count > 0 then
    raise exception 'GL_BANK_UNRECORDED_ITEMS: % bank line(s) in this period still have no entry against them. The books balance, but they are not finished - money has moved that is written down nowhere. Post those entries, run the reconciliation again, then sign off.', r.unrecorded_item_count
      using errcode = 'raise_exception';
  end if;

  if not r.ties then
    raise exception 'GL_BANK_DOES_NOT_TIE: this period is out by % cents. You may sign off an unexplained difference, but you must say what it is in a note. Never adjust it away.', r.difference_cents
      using errcode = 'raise_exception';
  end if;

  update public.gl_bank_reconciliations
     set signed_off_by = auth.uid(),
         signed_off_at = now(),
         notes         = coalesce(nullif(btrim(p_notes), ''), notes),
         updated_at    = now()
   where id = r.id;

  return jsonb_build_object(
    'reconciliation_id', r.id,
    'signed_off',        true,
    'period_start',      r.period_start,
    'period_end',        r.period_end,
    'complete',          r.complete
  );
end;
$$;

comment on function public.gl_sign_off_bank_reconciliation(uuid, text) is
  'Signs off a reconciled period. Refuses while any settled bank line in the period still has no entry against it, because a month that merely balances is not a month that is finished - an unrecorded fee cancels itself out of the difference and would otherwise be signed off as clean. Owner-only.';

revoke all on function public.gl_sign_off_bank_reconciliation(uuid, text) from public;
grant execute on function public.gl_sign_off_bank_reconciliation(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §9  ROW LEVEL SECURITY — owner-only, absolutely.
--
-- Owner directive, verbatim: "there is no reason anyone else needs to see my
-- books or my financials ever." Matching migration 0185.
--
-- NOTE FOR THE OWNER, recorded honestly rather than quietly worked around:
-- the four plaid_* tables from migration 0157 are gated with is_staff(), which
-- is owner|admin|manager|readonly. These new tables are is_owner(). That is a
-- deliberate asymmetry, not an oversight — an admin needs the banking screens to
-- pay vendors — but it does mean a manager can still see raw bank lines even
-- though they cannot see the books. Re-gating the plaid_* tables is a decision
-- for the owner because it would change what the existing admin screens can do.
-- It is tracked as open item R1 in todo.md and is NOT changed here.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.gl_bank_matches          enable row level security;
alter table public.gl_bank_reconciliations  enable row level security;

drop policy if exists gl_bank_matches_owner_all on public.gl_bank_matches;
create policy gl_bank_matches_owner_all
  on public.gl_bank_matches
  for all
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists gl_bank_reconciliations_owner_all on public.gl_bank_reconciliations;
create policy gl_bank_reconciliations_owner_all
  on public.gl_bank_reconciliations
  for all
  using (public.is_owner())
  with check (public.is_owner());

-- ═════════════════════════════════════════════════════════════════════════════
-- §10  gl_audit_bank_wiring() — a self-check that returns PROBLEMS ONLY.
--
-- Run it and get nothing back: everything is wired correctly. Standing rule 16
-- says prove the gate is wired; this is how the owner proves it himself, any
-- time, without reading a line of code:
--
--     select * from gl_audit_bank_wiring();
--
-- Every branch re-checks something a constraint already enforces. That is the
-- point: a constraint that was somehow dropped fails SILENTLY forever, and the
-- whole theme of this slice is failures that make no noise.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_bank_wiring()
returns table (area text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- (a) THE BIG ONE. Any live match whose two signs are not exact negations.
  --     The CHECK makes this unstorable; if a row appears here, the constraint
  --     is gone and the backwards-sign error is live again.
  select 'sign_wall'::text,
         format('match %s has plaid %s and ledger %s, which are not opposites - the sign wall is not holding',
                m.id, m.plaid_amount_cents, m.ledger_cash_cents)::text
    from public.gl_bank_matches m
   where m.superseded_at is null
     and not public.gl_bank_sign_agrees(m.plaid_amount_cents, m.ledger_cash_cents)

  union all

  -- (b) The sign wall constraint itself must exist.
  select 'sign_wall'::text,
         'the gl_bank_matches_sign_wall CHECK constraint is missing - a backwards-signed match could be stored, and it would still balance'::text
   where not exists (
     select 1 from pg_constraint
      where conname = 'gl_bank_matches_sign_wall'
        and conrelid = 'public.gl_bank_matches'::regclass
   )

  union all

  -- (c) Double-matching, bank side. The partial unique index forbids it.
  select 'double_count'::text,
         format('bank line %s has %s live matches - the same money is on the books more than once',
                m.transaction_id, count(*))::text
    from public.gl_bank_matches m
   where m.superseded_at is null
   group by m.transaction_id
  having count(*) > 1

  union all

  -- (d) Double-matching, journal side.
  select 'double_count'::text,
         format('journal %s has %s live matches - one entry is absorbing several bank lines',
                m.journal_id, count(*))::text
    from public.gl_bank_matches m
   where m.superseded_at is null
   group by m.journal_id
  having count(*) > 1

  union all

  -- (e) A pending or removed bank line must never be matched.
  select 'source_integrity'::text,
         format('bank line %s is matched but is %s - its amount and date can still change, or it never happened',
                t.transaction_id,
                case when t.removed then 'withdrawn by the bank' else 'still pending' end)::text
    from public.plaid_transactions t
   where t.gl_match_id is not null
     and (t.pending or t.removed)

  union all

  -- (f) Nothing may be matched before the line in the sand (standing rule 10).
  select 'cutover'::text,
         format('bank line %s is dated %s, before the 2026-01-01 cut-over, but is matched into these books',
                t.transaction_id, t.date)::text
    from public.plaid_transactions t
   where t.gl_match_id is not null
     and t.date < date '2026-01-01'

  union all

  -- (g) The bridge must agree with the match table in both directions.
  select 'bridge'::text,
         format('bank line %s points at match %s, but that match is superseded or gone',
                t.transaction_id, t.gl_match_id)::text
    from public.plaid_transactions t
   where t.gl_match_id is not null
     and not exists (
       select 1 from public.gl_bank_matches m
        where m.id = t.gl_match_id and m.superseded_at is null
     )

  union all

  select 'bridge'::text,
         format('match %s is live but bank line %s does not point back at it - the trail only runs one way',
                m.id, m.transaction_id)::text
    from public.gl_bank_matches m
    join public.plaid_transactions t on t.transaction_id = m.transaction_id
   where m.superseded_at is null
     and coalesce(t.gl_match_id::text, '') <> m.id::text

  union all

  -- (h) A matched journal must actually be posted, not a draft.
  select 'ledger_integrity'::text,
         format('match %s points at journal %s, which is %s rather than posted',
                m.id, j.id, j.status)::text
    from public.gl_bank_matches m
    join public.gl_journals j on j.id = m.journal_id
   where m.superseded_at is null
     and j.status <> 'posted'

  union all

  -- (i) A superseded match must carry its reason. An undo with no explanation is
  --     the audit trail failing at the one moment it matters.
  select 'audit_trail'::text,
         format('match %s was superseded with no reason recorded', m.id)::text
    from public.gl_bank_matches m
   where m.superseded_at is not null
     and coalesce(btrim(m.superseded_reason), '') = ''

  union all

  -- (j) A stored reconciliation must be internally consistent. The CHECKs make
  --     this impossible; if it appears, they are gone.
  select 'reconciliation'::text,
         format('reconciliation %s does not add up: books %s + %s = %s, bank %s + %s = %s, difference recorded as %s',
                r.id, r.ledger_balance_cents, r.in_bank_not_books_cents, r.adjusted_ledger_cents,
                r.statement_closing_cents, r.in_books_not_bank_cents, r.adjusted_bank_cents,
                r.difference_cents)::text
    from public.gl_bank_reconciliations r
   where r.adjusted_ledger_cents <> r.ledger_balance_cents + r.in_bank_not_books_cents
      or r.adjusted_bank_cents   <> r.statement_closing_cents + r.in_books_not_bank_cents
      or r.difference_cents      <> r.adjusted_ledger_cents - r.adjusted_bank_cents
      or r.ties                  <> (r.difference_cents = 0)
      -- D8: `complete` must equal its definition, and a signed-off period must
      -- be complete. A stored row that breaks either one is a month that was
      -- declared finished while entries were still missing.
      or r.complete              <> (r.difference_cents = 0 and r.unrecorded_item_count = 0)
      or (r.signed_off_at is not null and not r.complete)

  union all

  -- (n) THE D8 GUARDS THEMSELVES must still be on the table. A CHECK constraint
  --     that gets dropped in a later migration takes its protection with it and
  --     leaves no trace, so their presence is audited rather than assumed.
  select 'constraint'::text,
         format('gl_bank_reconciliations is missing CHECK %s - a month that merely balances could be signed off as finished', x.needed)::text
    from (values ('gl_bank_recs_complete_is_defined'),
                 ('gl_bank_recs_signoff_needs_complete')) as x(needed)
   where not exists (
     select 1 from pg_constraint
      where conrelid = 'public.gl_bank_reconciliations'::regclass
        and conname  = x.needed
   )

  union all

  -- (o) The sign-off door must exist and must be owner-gated. Without it a
  --     caller could simply UPDATE signed_off_at directly and skip every word
  --     of advice the function exists to give.
  select 'wiring'::text,
         'gl_sign_off_bank_reconciliation() is missing - sign-off would have no gate'::text
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'gl_sign_off_bank_reconciliation'
   )

  union all

  select 'wiring'::text,
         'gl_sign_off_bank_reconciliation() does not check is_owner()'::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'gl_sign_off_bank_reconciliation'
     and pg_get_functiondef(p.oid) not like '%is_owner%'

  union all

  -- (k) Both new tables must have RLS on and be owner-gated. A financial table
  --     with RLS off is readable by anyone who can reach the database.
  select 'rls'::text,
         format('table %s does not have row level security enabled', c.relname)::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('gl_bank_matches','gl_bank_reconciliations')
     and c.relrowsecurity = false

  union all

  select 'rls'::text,
         format('policy %s on %s does not gate on is_owner() - the books are the owner''s alone',
                p.polname, c.relname)::text
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('gl_bank_matches','gl_bank_reconciliations')
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%is_owner%'

  union all

  -- (l) The posting function must exist and be owner-gated. If someone replaced
  --     it with a version missing the is_owner() check, everything above still
  --     passes and the front door is simply open.
  select 'gate'::text,
         'gl_post_bank_match() does not mention is_owner() - the owner-only gate is not in the function body'::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'gl_post_bank_match'
     and pg_get_functiondef(p.oid) not like '%is_owner%'

  union all

  select 'gate'::text,
         'gl_bank_reconcile() does not mention is_owner() - the reconciliation is not owner-gated'::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'gl_bank_reconcile'
     and pg_get_functiondef(p.oid) not like '%is_owner%'

  union all

  -- (m) The unique indexes that make double-matching physically impossible.
  select 'double_count'::text,
         format('the %s unique index is missing - double-matching is no longer prevented at the storage layer', idx)::text
    from (values ('gl_bank_matches_one_live_per_txn'), ('gl_bank_matches_one_live_per_journal')) as v(idx)
   where not exists (
     select 1 from pg_indexes
      where schemaname = 'public' and indexname = v.idx
   );
$$;

comment on function public.gl_audit_bank_wiring() is
  'Self-check for slice books-05. Returns ONE ROW PER PROBLEM and nothing at all when the bank wiring is sound. Every branch re-checks something a constraint already enforces, because a constraint that was dropped fails silently forever - and silent failure is the entire theme of bank matching.';

revoke all on function public.gl_audit_bank_wiring() from public;
grant execute on function public.gl_audit_bank_wiring() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- §11  HOW TO RUN THIS — baby steps, as requested.
--
--   1. Open Supabase, pick your project, click "SQL Editor" in the left sidebar.
--   2. Click "New query".
--   3. Paste this ENTIRE file in and press "Run" (or Ctrl+Enter).
--      It is safe to run twice. Everything is "if not exists" or "or replace",
--      so a second run changes nothing.
--   4. Now prove it worked. Click "New query" again, paste exactly this ONE
--      line, and press Run:
--
--          select * from gl_audit_bank_wiring();
--
--   5. Read the result:
--        * "Success. No rows returned"  -> PERFECT. Everything is wired.
--        * Any rows at all              -> each row is one problem, in plain
--                                          English, with the area it is in.
--                                          Send them over and they get fixed.
--
--   That is the whole check. No rows means no problems.
-- ═════════════════════════════════════════════════════════════════════════════

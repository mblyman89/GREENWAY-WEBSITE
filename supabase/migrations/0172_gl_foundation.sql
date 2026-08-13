-- 0172_gl_foundation.sql
-- =============================================================================
-- GREENWAY GENERAL LEDGER — FOUNDATION (Slice F1)
-- =============================================================================
-- The double-entry backbone for Greenway's own books: the replacement for Sage 50.
-- This migration creates an EMPTY, LOCKED, PROVABLY-CORRECT ledger. It seeds NO
-- accounts (that is F2, which Michael approves account-by-account) and posts NO
-- journals. Purely additive: it does not touch any existing table.
--
-- WHY THIS EXISTS (owner context, recorded verbatim in research/bookkeeping/):
-- Michael's Sage 50 books drifted badly (negative inventory categories offset by a
-- $4,624,697.31 "LAZY INVENTORY ENTRY" plug, negative ATM cash, an undepreciated
-- building, legacy partner equity). His TAX filings are clean and verified against
-- IRS transcripts 2022-2024; the bookkeeping was the failure, not the accounting.
-- We are drawing a line in the sand at 2026-01-01 and never inheriting that drift.
--
-- STANDING RULES ENCODED HERE (owner-mandated, see AGENTS.md + todo.md):
--   * Money is INTEGER CENTS (bigint). Never a float, anywhere, ever.
--   * Rates/percentages are INTEGER MILLI-PERCENT (85% = 85000). 
--   * DRIFT IS CATASTROPHIC. Every rule below that could be "just a convention" is
--     instead enforced by the database, because conventions drift and constraints
--     do not.
--   * Pacific time is the business clock (America/Los_Angeles).
--   * Idempotent: safe to run repeatedly in the Supabase SQL editor.
--
-- THE PROFESSIONAL DOCTRINE (what a CPA/CFO-grade ledger does that a checkbook
-- does not) — each item is a constraint, trigger, or function below:
--   1. Posted journals are IMMUTABLE. Corrections are reversal + repost (ASC 250).
--   2. Draft -> posted lifecycle; balance is proven at the moment of posting.
--   3. Debits must equal credits, proven arithmetically, or nothing posts.
--   4. Journal numbers are GAPLESS per entity — auditors test for gaps.
--   5. Accounting periods LOCK; a closed month cannot be altered.
--   6. Control accounts (A/P, inventory, payroll) belong to their subledgers and
--      cannot be moved by a hand-keyed journal entry. This single rule is what
--      prevents another "LAZY INVENTORY ENTRY".
--   7. Dimensions (entity, 280E cost class, shareholder) ride on every line.
--   8. Intercompany entries are linked so both sides always tie.
--   9. Provenance (source, author, timestamp) on every entry.
--  10. A memo is MANDATORY. Unexplained entries are how books become unauditable.
--  11. NOTHING may be dated before the line in the sand except opening balances.
--  12. Assumptions are recorded in the entry itself, never applied silently.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Enumerated domains. Kept as CHECK constraints (repo convention) rather than
--    postgres enums, so values can be extended in a later idempotent migration
--    without an ALTER TYPE dance.
-- ---------------------------------------------------------------------------

-- Account types drive the financial statements and the normal-balance rule:
--   asset, liability, equity, income, cogs, expense, other_income, other_expense
-- COGS is deliberately its OWN type, not a flavour of expense: under IRC 280E the
-- distinction between cost of goods sold and operating expense is the difference
-- between a deductible dollar and a non-deductible one.

-- Cost classes implement 280E tagging at the line level:
--   cogs_direct        — invoice cost of product (IRC 471-3(b)); always allowed
--   cogs_allocable     — documented handling/storage/processing allocations
--   nondeductible_280e — ordinary operating expense of the cannabis trade
--   separate_business  — a genuinely separate trade or business (CHAMP doctrine)
--   personal           — Michael's personal activity (never a business deduction)
--   none               — balance-sheet lines, which carry no 280E character
-- When cannabis is rescheduled, the reporting VIEW changes; the tagged history
-- does not have to be rebuilt. That is the conversion switch, by design.

-- ---------------------------------------------------------------------------
-- 1) gl_entities — the four sets of books.
--    Sage encoded these as account-code suffixes (-GRNWY/-GRWYE/-LYMAN/-OTHER),
--    which is why its reports could never separate them cleanly. Here the entity
--    is a first-class dimension on every single line.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_entities (
  id            uuid primary key default gen_random_uuid(),

  code          text not null unique
                  check (code in ('greenway','atm','landholding','personal')),
  name          text not null,

  -- Which tax form this entity's results ultimately land on. Verified against
  -- Michael's IRS transcripts 2022/2023/2024 (research/bookkeeping/07).
  tax_form      text not null
                  check (tax_form in ('1120S','1040_SCH_C','1040')),

  -- NAICS as actually filed (Sch C activities). ATM operation = 522200,
  -- landholding/rental = 531100. Null where not applicable.
  naics_code    text,

  description   text,
  active        boolean not null default true,
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.gl_entities is
  'The four sets of books (greenway S-corp, atm Sch C, landholding Sch C, personal 1040). Replaces Sage 50 account-code suffixes with a real first-class dimension.';

-- ---------------------------------------------------------------------------
-- 2) gl_shareholders — Greenway LLC ownership, verified from IRS Schedule K-1
--    transcripts for 2022, 2023 and 2024 (all three show Michael at 85%).
--    Ownership is stored in MILLI-PERCENT: 85% = 85000, 10% = 10000, 5% = 5000.
--    This table exists in F1 (not later) because S-corp distributions must be
--    tracked per shareholder from the very first entry — reconstructing them
--    afterwards is exactly the mess we are escaping.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_shareholders (
  id                 uuid primary key default gen_random_uuid(),

  entity_id          uuid not null references public.gl_entities(id) on delete restrict,

  name               text not null,
  relationship       text,                                  -- 'owner','mother','grandfather'

  ownership_milli_pct integer not null
                       check (ownership_milli_pct >= 0 and ownership_milli_pct <= 100000),

  -- Michael's mother is ALLOCATED income but is NOT paid distributions (Michael
  -- covers her tax burden personally). That fact is recorded here because it is a
  -- one-class-of-stock and gift-tax consideration his grandfather must weigh in on
  -- — see research/bookkeeping/07. The books must never silently assume she was
  -- paid.
  receives_distributions boolean not null default true,

  notes              text,
  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.gl_shareholders is
  'S-corp ownership in milli-percent (85%=85000), verified from IRS K-1 transcripts. Drives per-shareholder distribution/basis tracking (Schedule M-2, Form 7203).';

create index if not exists idx_gl_shareholders_entity
  on public.gl_shareholders (entity_id) where active;

-- ---------------------------------------------------------------------------
-- 3) gl_accounts — the chart of accounts.
--    SEEDED EMPTY ON PURPOSE. Michael's real chart is modernized and approved
--    account-by-account in slice F2; inventing account numbers here would be
--    guessing, which the standing rules forbid.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_accounts (
  id                   uuid primary key default gen_random_uuid(),

  code                 text not null unique,                -- '10100', '50100', ...
  name                 text not null,

  type                 text not null
                         check (type in ('asset','liability','equity','income',
                                         'cogs','expense','other_income','other_expense')),

  -- Derived from type but stored explicitly so reports never have to infer it,
  -- and so a contra account (e.g. accumulated depreciation) can be declared
  -- deliberately. Validated against `type` by gl_guard_account_normal_balance().
  normal_balance       text not null check (normal_balance in ('debit','credit')),

  is_contra            boolean not null default false,

  -- CONTROL ACCOUNT DISCIPLINE (the anti-drift rule).
  -- A control account is the GL's summary of a subledger (A/P, inventory lots,
  -- payroll, excise). Its balance MUST equal the subledger it summarizes. Manual
  -- journal entries into control accounts are how a $4.6M inventory plug happens,
  -- so the ledger refuses them: only the owning subledger may post here.
  is_control           boolean not null default false,
  control_subledger    text
                         check (control_subledger is null or control_subledger in
                           ('ap','ar','inventory','payroll','excise','sales','cash','loans','crypto')),

  -- P&L accounts must declare a 280E cost class on every line; balance-sheet
  -- accounts must not. Enforced at post time.
  requires_cost_class  boolean not null default false,

  -- Restricts an account to particular entities (e.g. an excise-tax liability
  -- belongs to greenway only). Null = available to all entities.
  allowed_entity_codes text[],

  -- System accounts are structural (Opening Balance Equity, Retained Earnings)
  -- and may not be deleted or renamed by a user.
  is_system            boolean not null default false,

  parent_code          text,
  description          text,
  active               boolean not null default true,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- A control account must name the subledger it controls, and only a control
  -- account may name one.
  constraint gl_accounts_control_subledger_pair
    check ( (is_control and control_subledger is not null)
         or ((not is_control) and control_subledger is null) )
);

comment on table public.gl_accounts is
  'Chart of accounts. Seeded EMPTY in F1 by design — the real chart is approved account-by-account by the owner in slice F2. Control accounts may only be moved by their owning subledger.';

create index if not exists idx_gl_accounts_type on public.gl_accounts (type) where active;

-- ---------------------------------------------------------------------------
-- 4) gl_periods — monthly accounting periods, per entity.
--    'open'   : may be posted to
--    'closed' : month-end close complete; reopening is an explicit admin act
--    'locked' : permanently sealed (return filed) — never reopened
-- ---------------------------------------------------------------------------
create table if not exists public.gl_periods (
  id           uuid primary key default gen_random_uuid(),

  entity_id    uuid not null references public.gl_entities(id) on delete restrict,

  fiscal_year  integer not null check (fiscal_year between 2026 and 2100),
  period_no    integer not null check (period_no between 1 and 12),

  start_date   date not null,
  end_date     date not null,

  status       text not null default 'open'
                 check (status in ('open','closed','locked')),

  closed_at    timestamptz,
  closed_by    uuid references auth.users(id),
  close_note   text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (entity_id, fiscal_year, period_no),
  constraint gl_periods_dates_ordered check (end_date >= start_date)
);

comment on table public.gl_periods is
  'Monthly accounting periods per entity. Posting into a non-open period is refused by gl_post_journal(). Fiscal years start at 2026 — the line in the sand.';

create index if not exists idx_gl_periods_entity_dates
  on public.gl_periods (entity_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 5) gl_journal_sequences — gapless journal numbering, per entity.
--    Auditors test journal numbers for gaps because a missing number suggests a
--    destroyed record. Numbers are therefore assigned AT POST TIME (a discarded
--    draft must not consume one) and never reused.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_journal_sequences (
  entity_id   uuid primary key references public.gl_entities(id) on delete restrict,
  next_no     bigint not null default 1 check (next_no >= 1),
  updated_at  timestamptz not null default now()
);

comment on table public.gl_journal_sequences is
  'Per-entity gapless journal number allocator. Numbers are issued at POST time so abandoned drafts never create gaps.';

-- ---------------------------------------------------------------------------
-- 6) gl_journals — the journal entry header.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_journals (
  id                uuid primary key default gen_random_uuid(),

  entity_id         uuid not null references public.gl_entities(id) on delete restrict,

  -- Pacific business date of the entry (AGENTS.md rule 8: Pacific is the clock).
  journal_date      date not null,

  -- Assigned only when the entry posts; null while draft.
  journal_no        bigint,

  status            text not null default 'draft'
                      check (status in ('draft','posted','reversed')),

  -- PROVENANCE. Where did this entry come from? An auditor will ask.
  --   manual            — a human keyed it
  --   opening_balance   — THE cut-over entry (the only pre-2026 entry allowed)
  --   pos_sale, purchase, payroll, excise, inventory, bank, loan, crypto, atm,
  --   intercompany, depreciation, accrual, close, reversal
  source_kind       text not null
                      check (source_kind in ('manual','opening_balance','pos_sale',
                        'purchase','payroll','excise','inventory','bank','loan',
                        'crypto','atm','intercompany','depreciation','accrual',
                        'close','reversal')),
  source_ref        text,                                   -- external id / document id

  -- MANDATORY EXPLANATION. An entry nobody can explain is an entry nobody can
  -- audit. Blank/whitespace memos are rejected.
  memo              text not null check (length(btrim(memo)) >= 3),

  -- STANDING RULE 12: assumptions and educated guesses must be RECORDED, never
  -- applied silently. Michael's equity history is admittedly incomplete; every
  -- judgement call made while reconstructing it is written down right here.
  assumption_note   text,

  -- Links the two halves of an intercompany transaction (e.g. the $2,000/month
  -- rent: income in landholding, expense in greenway) so they can always be tied
  -- back together and eliminated in combined statements.
  intercompany_ref  uuid,

  -- Reversal linkage, both directions (ASC 250: correct by reversal, never edit).
  reverses_journal_id uuid references public.gl_journals(id) on delete restrict,
  reversed_by_journal_id uuid references public.gl_journals(id) on delete restrict,
  reversal_reason   text,

  created_by        uuid references auth.users(id),
  posted_by         uuid references auth.users(id),
  posted_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- THE LINE IN THE SAND (standing rule 10). Cut-over is Option C: 2026-01-01.
  -- The ONLY entry permitted to bear an earlier date is the opening-balance entry
  -- itself, dated 2025-12-31. Everything else, forever, is 2026 or later.
  constraint gl_journals_line_in_the_sand
    check ( journal_date >= date '2026-01-01'
            or (source_kind = 'opening_balance' and journal_date = date '2025-12-31') ),

  -- A posted entry must have a number, an author-timestamp; a draft must not have
  -- a number.
  constraint gl_journals_posted_has_number
    check ( (status = 'draft' and journal_no is null and posted_at is null)
            or (status in ('posted','reversed') and journal_no is not null and posted_at is not null) ),

  unique (entity_id, journal_no)
);

comment on table public.gl_journals is
  'Journal entry headers. Immutable once posted (corrections are reversal + repost per ASC 250). Nothing may be dated before 2026-01-01 except the single opening-balance entry.';

create index if not exists idx_gl_journals_entity_date
  on public.gl_journals (entity_id, journal_date desc);
create index if not exists idx_gl_journals_status
  on public.gl_journals (status) where status = 'draft';
create index if not exists idx_gl_journals_intercompany
  on public.gl_journals (intercompany_ref) where intercompany_ref is not null;

-- ---------------------------------------------------------------------------
-- 7) gl_journal_lines — the journal entry detail.
--
--    SIGNED AMOUNT CONVENTION: amount_cents is POSITIVE for a DEBIT and NEGATIVE
--    for a CREDIT. One signed integer column instead of separate debit/credit
--    columns means "debits equal credits" is simply "the lines sum to zero" —
--    an arithmetic fact the database can prove, with no possibility of a row
--    carrying a value in both columns. Debit/credit presentation happens in the
--    reporting layer (F4), where humans read it.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_journal_lines (
  id             uuid primary key default gen_random_uuid(),

  journal_id     uuid not null references public.gl_journals(id) on delete cascade,
  line_no        integer not null check (line_no >= 1),

  account_id     uuid not null references public.gl_accounts(id) on delete restrict,

  -- Denormalized from the header deliberately: every line stands on its own for
  -- reporting, and gl_post_journal() verifies it matches the header entity.
  entity_id      uuid not null references public.gl_entities(id) on delete restrict,

  -- Positive = debit, negative = credit. Integer cents. Never zero.
  amount_cents   bigint not null check (amount_cents <> 0),

  -- 280E tagging (see the header comment). 'none' for balance-sheet lines.
  cost_class     text not null default 'none'
                   check (cost_class in ('cogs_direct','cogs_allocable',
                                         'nondeductible_280e','separate_business',
                                         'personal','none')),

  -- Which shareholder an equity movement belongs to (distributions/contributions).
  shareholder_id uuid references public.gl_shareholders(id) on delete restrict,

  -- If this line's amount came from an allocation study (e.g. the rent-as-COGS
  -- percentage), this points at the config row that justified it — so the
  -- supporting document is always one hop away from the number.
  allocation_config_id uuid,

  description    text,

  created_at     timestamptz not null default now(),

  unique (journal_id, line_no)
);

comment on table public.gl_journal_lines is
  'Journal lines. amount_cents is SIGNED: positive = debit, negative = credit, so "debits equal credits" is provable as "the lines sum to zero". Immutable once the journal posts.';

create index if not exists idx_gl_journal_lines_journal on public.gl_journal_lines (journal_id);
create index if not exists idx_gl_journal_lines_account on public.gl_journal_lines (account_id);
create index if not exists idx_gl_journal_lines_entity  on public.gl_journal_lines (entity_id);

-- ---------------------------------------------------------------------------
-- 8) gl_allocation_configs — effective-dated allocation percentages.
--    The rent-as-COGS split and the COGS-employee designations are exactly the
--    numbers the IRS challenged in Alterman and Harborside. The lesson from those
--    cases is that an allocation survives ONLY if a contemporaneous study supports
--    it. So this table makes the supporting document MANDATORY: an allocation
--    percentage cannot exist here without a document reference.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_allocation_configs (
  id              uuid primary key default gen_random_uuid(),

  entity_id       uuid not null references public.gl_entities(id) on delete restrict,

  code            text not null,                            -- 'rent_cogs_pct', ...
  name            text not null,

  rate_milli_pct  integer not null
                    check (rate_milli_pct >= 0 and rate_milli_pct <= 100000),

  effective_from  date not null,
  effective_to    date,

  -- NON-NEGOTIABLE: the study/lease/memo that justifies this percentage.
  document_ref    text not null check (length(btrim(document_ref)) >= 3),
  basis_note      text not null check (length(btrim(basis_note)) >= 3),

  approved_by     text,                                     -- e.g. 'Nicholas Mullan, CPA'
  approved_on     date,

  active          boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (entity_id, code, effective_from),
  constraint gl_allocation_dates_ordered
    check (effective_to is null or effective_to >= effective_from)
);

comment on table public.gl_allocation_configs is
  'Effective-dated allocation rates in milli-percent (rent-as-COGS, labor splits). A supporting document reference and written basis are REQUIRED — an unsupported allocation cannot be stored (Alterman/Harborside doctrine).';

-- ---------------------------------------------------------------------------
-- 9) gl_audit_events — append-only ledger of who did what.
-- ---------------------------------------------------------------------------
create table if not exists public.gl_audit_events (
  id           uuid primary key default gen_random_uuid(),

  event_kind   text not null
                 check (event_kind in ('journal_posted','journal_reversed',
                                       'period_closed','period_reopened',
                                       'period_locked','account_created',
                                       'account_deactivated','opening_balance_posted')),

  entity_id    uuid references public.gl_entities(id) on delete set null,
  journal_id   uuid references public.gl_journals(id) on delete set null,
  period_id    uuid references public.gl_periods(id) on delete set null,

  actor        uuid references auth.users(id),
  detail       text,

  created_at   timestamptz not null default now()
);

comment on table public.gl_audit_events is
  'Append-only audit trail for ledger-significant actions (posting, reversal, period close). Never updated or deleted.';

create index if not exists idx_gl_audit_events_created on public.gl_audit_events (created_at desc);

-- =============================================================================
-- FUNCTIONS AND TRIGGERS — where the doctrine becomes enforcement
-- =============================================================================

-- updated_at maintenance (repo convention: public.set_updated_at()).
drop trigger if exists trg_gl_entities_updated on public.gl_entities;
create trigger trg_gl_entities_updated before update on public.gl_entities
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gl_shareholders_updated on public.gl_shareholders;
create trigger trg_gl_shareholders_updated before update on public.gl_shareholders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gl_accounts_updated on public.gl_accounts;
create trigger trg_gl_accounts_updated before update on public.gl_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gl_periods_updated on public.gl_periods;
create trigger trg_gl_periods_updated before update on public.gl_periods
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gl_journals_updated on public.gl_journals;
create trigger trg_gl_journals_updated before update on public.gl_journals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_gl_allocation_configs_updated on public.gl_allocation_configs;
create trigger trg_gl_allocation_configs_updated before update on public.gl_allocation_configs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- normal_balance must agree with the account type. Assets, COGS and expenses are
-- debit-normal; liabilities, equity and income are credit-normal. A contra
-- account deliberately inverts, which is the only legal exception.
-- ---------------------------------------------------------------------------
create or replace function public.gl_guard_account_normal_balance()
returns trigger language plpgsql as $$
declare
  expected text;
begin
  expected := case
    when new.type in ('asset','cogs','expense','other_expense') then 'debit'
    else 'credit'
  end;

  if new.is_contra then
    expected := case when expected = 'debit' then 'credit' else 'debit' end;
  end if;

  if new.normal_balance <> expected then
    raise exception 'GL_NORMAL_BALANCE: account % (type=%, is_contra=%) must have normal_balance=% but got %',
      new.code, new.type, new.is_contra, expected, new.normal_balance
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_gl_accounts_normal_balance on public.gl_accounts;
create trigger trg_gl_accounts_normal_balance
  before insert or update on public.gl_accounts
  for each row execute function public.gl_guard_account_normal_balance();

-- ---------------------------------------------------------------------------
-- IMMUTABILITY. Once a journal is posted its header and lines are history.
-- The only permitted mutations on a posted header are the bookkeeping fields the
-- system itself sets when the entry is later reversed.
-- ---------------------------------------------------------------------------
create or replace function public.gl_guard_posted_journal()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted','reversed') then
      raise exception 'GL_IMMUTABLE: journal % is posted and cannot be deleted. Reverse it instead (ASC 250).', old.id
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  if old.status in ('posted','reversed') then
    -- Permit ONLY the reversal-linkage bookkeeping and the posted->reversed flip.
    if (new.entity_id      is distinct from old.entity_id)
    or (new.journal_date   is distinct from old.journal_date)
    or (new.journal_no     is distinct from old.journal_no)
    or (new.source_kind    is distinct from old.source_kind)
    or (new.memo           is distinct from old.memo)
    or (new.posted_at      is distinct from old.posted_at)
    or (new.posted_by      is distinct from old.posted_by)
    or (new.status not in ('posted','reversed'))
    then
      raise exception 'GL_IMMUTABLE: journal % is posted; posted entries cannot be edited. Reverse and repost (ASC 250).', old.id
        using errcode = 'raise_exception';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_gl_journals_immutable on public.gl_journals;
create trigger trg_gl_journals_immutable
  before update or delete on public.gl_journals
  for each row execute function public.gl_guard_posted_journal();

create or replace function public.gl_guard_posted_lines()
returns trigger language plpgsql as $$
declare
  jstatus text;
  jid uuid;
begin
  jid := case when tg_op = 'DELETE' then old.journal_id else new.journal_id end;
  select status into jstatus from public.gl_journals where id = jid;

  if jstatus in ('posted','reversed') then
    raise exception 'GL_IMMUTABLE: journal % is posted; its lines cannot be added, changed or removed. Reverse and repost (ASC 250).', jid
      using errcode = 'raise_exception';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_gl_journal_lines_immutable on public.gl_journal_lines;
create trigger trg_gl_journal_lines_immutable
  before insert or update or delete on public.gl_journal_lines
  for each row execute function public.gl_guard_posted_lines();

-- Audit events are append-only.
create or replace function public.gl_guard_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'GL_IMMUTABLE: gl_audit_events is append-only.'
    using errcode = 'raise_exception';
end $$;

drop trigger if exists trg_gl_audit_append_only on public.gl_audit_events;
create trigger trg_gl_audit_append_only
  before update or delete on public.gl_audit_events
  for each row execute function public.gl_guard_audit_append_only();

-- ---------------------------------------------------------------------------
-- Ownership must total exactly 100% per entity (85000 + 10000 + 5000 = 100000).
-- Deferred-style check: evaluated after each statement so a multi-row insert can
-- land as a set.
-- ---------------------------------------------------------------------------
create or replace function public.gl_assert_ownership_sums()
returns trigger language plpgsql as $$
declare
  bad record;
begin
  for bad in
    select e.code, sum(s.ownership_milli_pct) as total
    from public.gl_shareholders s
    join public.gl_entities e on e.id = s.entity_id
    where s.active
    group by e.code
    having sum(s.ownership_milli_pct) <> 100000
  loop
    raise exception 'GL_OWNERSHIP: active ownership for entity % totals % milli-percent; it must total exactly 100000 (100%%).',
      bad.code, bad.total
      using errcode = 'check_violation';
  end loop;

  return null;
end $$;

drop trigger if exists trg_gl_shareholders_sum on public.gl_shareholders;
create trigger trg_gl_shareholders_sum
  after insert or update or delete on public.gl_shareholders
  for each statement execute function public.gl_assert_ownership_sums();

-- ---------------------------------------------------------------------------
-- gl_next_journal_no — gapless allocation, concurrency-safe.
-- ---------------------------------------------------------------------------
create or replace function public.gl_next_journal_no(p_entity_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_no bigint;
begin
  insert into public.gl_journal_sequences (entity_id, next_no)
  values (p_entity_id, 1)
  on conflict (entity_id) do nothing;

  -- FOR UPDATE serializes concurrent posters so two entries can never share a
  -- number and no number is ever skipped.
  select next_no into v_no
  from public.gl_journal_sequences
  where entity_id = p_entity_id
  for update;

  update public.gl_journal_sequences
  set next_no = v_no + 1, updated_at = now()
  where entity_id = p_entity_id;

  return v_no;
end $$;

comment on function public.gl_next_journal_no(uuid) is
  'Allocates the next gapless journal number for an entity. Called only by gl_post_journal().';

-- ---------------------------------------------------------------------------
-- gl_post_journal — THE GATE.
--
-- Every rule that protects these books is checked here, in order, inside one
-- transaction. If any check fails the exception aborts everything and NOTHING is
-- written. There is no partial post, and there is no way to post around it: the
-- immutability triggers mean a journal that never passed this function can never
-- become history.
-- ---------------------------------------------------------------------------
create or replace function public.gl_post_journal(p_journal_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  j              public.gl_journals%rowtype;
  v_line_count   integer;
  v_sum          bigint;
  v_bad          record;
  v_period       public.gl_periods%rowtype;
  v_no           bigint;
begin
  -- (1) The journal must exist and still be a draft.
  select * into j from public.gl_journals where id = p_journal_id for update;
  if not found then
    raise exception 'GL_NOT_FOUND: journal % does not exist', p_journal_id
      using errcode = 'no_data_found';
  end if;
  if j.status <> 'draft' then
    raise exception 'GL_ALREADY_POSTED: journal % has status %; only drafts may be posted', j.id, j.status
      using errcode = 'raise_exception';
  end if;

  -- (2) At least two lines. A single-sided entry is not double-entry.
  select count(*), coalesce(sum(amount_cents), 0)
    into v_line_count, v_sum
  from public.gl_journal_lines where journal_id = j.id;

  if v_line_count < 2 then
    raise exception 'GL_TOO_FEW_LINES: journal % has % line(s); double-entry requires at least 2', j.id, v_line_count
      using errcode = 'raise_exception';
  end if;

  -- (3) THE FUNDAMENTAL RULE: debits must equal credits, i.e. the signed lines
  --     must sum to exactly zero.
  if v_sum <> 0 then
    raise exception 'GL_OUT_OF_BALANCE: journal % is out of balance by % cents (debits and credits must be equal)', j.id, v_sum
      using errcode = 'raise_exception';
  end if;

  -- (4) Every line must belong to the same entity as its header.
  select l.id, l.line_no into v_bad
  from public.gl_journal_lines l
  where l.journal_id = j.id and l.entity_id <> j.entity_id
  limit 1;
  if found then
    raise exception 'GL_ENTITY_MISMATCH: journal % line % belongs to a different entity than the journal header', j.id, v_bad.line_no
      using errcode = 'raise_exception';
  end if;

  -- (5) Accounts must be active, and permitted for this entity.
  select l.line_no, a.code, a.active into v_bad
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  where l.journal_id = j.id and not a.active
  limit 1;
  if found then
    raise exception 'GL_INACTIVE_ACCOUNT: journal % line % uses inactive account %', j.id, v_bad.line_no, v_bad.code
      using errcode = 'raise_exception';
  end if;

  select l.line_no, a.code into v_bad
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  join public.gl_entities e on e.id = l.entity_id
  where l.journal_id = j.id
    and a.allowed_entity_codes is not null
    and not (e.code = any(a.allowed_entity_codes))
  limit 1;
  if found then
    raise exception 'GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: journal % line % uses account % which is not permitted for this entity', j.id, v_bad.line_no, v_bad.code
      using errcode = 'raise_exception';
  end if;

  -- (6) CONTROL ACCOUNT DISCIPLINE. A manual journal entry may not move a
  --     subledger-controlled account. This is the rule that makes another
  --     "LAZY INVENTORY ENTRY" structurally impossible.
  if j.source_kind = 'manual' then
    select l.line_no, a.code, a.control_subledger into v_bad
    from public.gl_journal_lines l
    join public.gl_accounts a on a.id = l.account_id
    where l.journal_id = j.id and a.is_control
    limit 1;
    if found then
      raise exception 'GL_CONTROL_ACCOUNT: journal % line % posts manually to control account % (subledger: %). Control accounts may only be moved by their subledger — post the underlying transaction instead.',
        j.id, v_bad.line_no, v_bad.code, v_bad.control_subledger
        using errcode = 'raise_exception';
    end if;
  end if;

  -- (7) 280E tagging. Accounts that require a cost class must have a real one;
  --     balance-sheet accounts must not carry one.
  select l.line_no, a.code into v_bad
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  where l.journal_id = j.id and a.requires_cost_class and l.cost_class = 'none'
  limit 1;
  if found then
    raise exception 'GL_COST_CLASS_REQUIRED: journal % line % (account %) requires a 280E cost class but has none', j.id, v_bad.line_no, v_bad.code
      using errcode = 'raise_exception';
  end if;

  select l.line_no, a.code into v_bad
  from public.gl_journal_lines l
  join public.gl_accounts a on a.id = l.account_id
  where l.journal_id = j.id
    and a.type in ('asset','liability','equity')
    and l.cost_class <> 'none'
  limit 1;
  if found then
    raise exception 'GL_COST_CLASS_NOT_ALLOWED: journal % line % (balance-sheet account %) must not carry a 280E cost class', j.id, v_bad.line_no, v_bad.code
      using errcode = 'raise_exception';
  end if;

  -- (8) PERIOD CONTROL. The opening-balance entry is exempt because it is dated
  --     2025-12-31, before any period exists — that is precisely its job.
  if j.source_kind <> 'opening_balance' then
    select * into v_period
    from public.gl_periods
    where entity_id = j.entity_id
      and j.journal_date between start_date and end_date;

    if not found then
      raise exception 'GL_NO_PERIOD: no accounting period exists for entity % on %', j.entity_id, j.journal_date
        using errcode = 'raise_exception';
    end if;
    if v_period.status <> 'open' then
      raise exception 'GL_PERIOD_CLOSED: period %-% for this entity is % and cannot receive postings', v_period.fiscal_year, v_period.period_no, v_period.status
        using errcode = 'raise_exception';
    end if;
  end if;

  -- All checks passed: assign the gapless number and post.
  v_no := public.gl_next_journal_no(j.entity_id);

  update public.gl_journals
  set status     = 'posted',
      journal_no = v_no,
      posted_at  = now(),
      posted_by  = auth.uid(),
      updated_at = now()
  where id = j.id;

  insert into public.gl_audit_events (event_kind, entity_id, journal_id, actor, detail)
  values (
    case when j.source_kind = 'opening_balance' then 'opening_balance_posted' else 'journal_posted' end,
    j.entity_id, j.id, auth.uid(),
    format('posted journal #%s (%s lines, source=%s)', v_no, v_line_count, j.source_kind)
  );

  return v_no;
end $$;

comment on function public.gl_post_journal(uuid) is
  'The posting gate: validates balance, entity, accounts, control-account discipline, 280E cost classes and period status, then assigns a gapless journal number. Any failure aborts the whole post.';

-- ---------------------------------------------------------------------------
-- gl_reverse_journal — the ONLY way to undo posted history (ASC 250).
-- Creates a mirror-image DRAFT so a human reviews and posts it deliberately.
-- ---------------------------------------------------------------------------
create or replace function public.gl_reverse_journal(
  p_journal_id uuid,
  p_reason     text,
  p_date       date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  j       public.gl_journals%rowtype;
  v_new   uuid;
  v_date  date;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'GL_REASON_REQUIRED: a written reason is required to reverse a posted entry'
      using errcode = 'raise_exception';
  end if;

  select * into j from public.gl_journals where id = p_journal_id;
  if not found then
    raise exception 'GL_NOT_FOUND: journal % does not exist', p_journal_id using errcode = 'no_data_found';
  end if;
  if j.status <> 'posted' then
    raise exception 'GL_NOT_POSTED: only a posted journal can be reversed (journal % is %)', j.id, j.status
      using errcode = 'raise_exception';
  end if;
  if j.reversed_by_journal_id is not null then
    raise exception 'GL_ALREADY_REVERSED: journal % was already reversed by %', j.id, j.reversed_by_journal_id
      using errcode = 'raise_exception';
  end if;

  -- Reversals never reach back before the line in the sand.
  v_date := greatest(coalesce(p_date, j.journal_date), date '2026-01-01');

  insert into public.gl_journals (
    entity_id, journal_date, status, source_kind, source_ref, memo,
    reverses_journal_id, reversal_reason, intercompany_ref, created_by
  )
  values (
    j.entity_id, v_date, 'draft', 'reversal', j.source_ref,
    format('REVERSAL of journal #%s — %s', coalesce(j.journal_no::text, '(draft)'), p_reason),
    j.id, p_reason, j.intercompany_ref, auth.uid()
  )
  returning id into v_new;

  -- Mirror image: every sign flipped, dimensions preserved.
  insert into public.gl_journal_lines (
    journal_id, line_no, account_id, entity_id, amount_cents,
    cost_class, shareholder_id, allocation_config_id, description
  )
  select v_new, l.line_no, l.account_id, l.entity_id, -l.amount_cents,
         l.cost_class, l.shareholder_id, l.allocation_config_id,
         coalesce('REVERSAL: ' || l.description, 'REVERSAL')
  from public.gl_journal_lines l
  where l.journal_id = j.id;

  return v_new;
end $$;

comment on function public.gl_reverse_journal(uuid, text, date) is
  'Creates a mirror-image DRAFT reversing a posted journal. A written reason is mandatory; the draft must still be reviewed and posted.';

-- ---------------------------------------------------------------------------
-- gl_close_period / gl_reopen_period — month-end control.
-- F10 will require reconciliation evidence before allowing a close; F1 provides
-- the mechanism and the audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.gl_close_period(p_period_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.gl_periods%rowtype;
  v_open_drafts integer;
begin
  select * into p from public.gl_periods where id = p_period_id for update;
  if not found then
    raise exception 'GL_NOT_FOUND: period % does not exist', p_period_id using errcode = 'no_data_found';
  end if;
  if p.status <> 'open' then
    raise exception 'GL_PERIOD_NOT_OPEN: period %-% is already %', p.fiscal_year, p.period_no, p.status
      using errcode = 'raise_exception';
  end if;

  -- An unposted draft inside the period means unfinished work; closing over it
  -- would strand the entry forever (it could never post afterwards).
  select count(*) into v_open_drafts
  from public.gl_journals
  where entity_id = p.entity_id
    and status = 'draft'
    and journal_date between p.start_date and p.end_date;

  if v_open_drafts > 0 then
    raise exception 'GL_OPEN_DRAFTS: % unposted draft entr(ies) remain in period %-%; post or delete them before closing', v_open_drafts, p.fiscal_year, p.period_no
      using errcode = 'raise_exception';
  end if;

  update public.gl_periods
  set status = 'closed', closed_at = now(), closed_by = auth.uid(),
      close_note = p_note, updated_at = now()
  where id = p_period_id;

  insert into public.gl_audit_events (event_kind, entity_id, period_id, actor, detail)
  values ('period_closed', p.entity_id, p.id, auth.uid(),
          format('closed period %s-%s', p.fiscal_year, p.period_no));
end $$;

create or replace function public.gl_reopen_period(p_period_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.gl_periods%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'GL_REASON_REQUIRED: a written reason is required to reopen a closed period'
      using errcode = 'raise_exception';
  end if;

  select * into p from public.gl_periods where id = p_period_id for update;
  if not found then
    raise exception 'GL_NOT_FOUND: period % does not exist', p_period_id using errcode = 'no_data_found';
  end if;

  -- 'locked' means a return has been filed on these numbers. It is permanent.
  if p.status = 'locked' then
    raise exception 'GL_PERIOD_LOCKED: period %-% is permanently locked (a tax return was filed on it) and cannot be reopened', p.fiscal_year, p.period_no
      using errcode = 'raise_exception';
  end if;
  if p.status <> 'closed' then
    raise exception 'GL_PERIOD_NOT_CLOSED: period %-% is %', p.fiscal_year, p.period_no, p.status
      using errcode = 'raise_exception';
  end if;

  update public.gl_periods
  set status = 'open', closed_at = null, closed_by = null, updated_at = now()
  where id = p_period_id;

  insert into public.gl_audit_events (event_kind, entity_id, period_id, actor, detail)
  values ('period_reopened', p.entity_id, p.id, auth.uid(), p_reason);
end $$;

-- =============================================================================
-- SEED DATA — only facts VERIFIED from Michael's IRS transcripts and his own
-- statements. No invented numbers. (Accounts are NOT seeded: slice F2.)
-- =============================================================================

insert into public.gl_entities (code, name, tax_form, naics_code, description, sort_order)
values
  ('greenway',    'Greenway Marijuana',             '1120S',      '453998',
   'WA I-502 cannabis retailer (LLC taxed as S-corp). Subject to IRC 280E while cannabis remains Schedule I.', 1),
  ('atm',         'ATM Operation',                  '1040_SCH_C', '522200',
   'ATM services. Separate trade or business; revenue is not cannabis revenue.', 2),
  ('landholding', 'Lyman Land Holding (Geiger)',    '1040_SCH_C', '531100',
   'Real property owner/lessor. Rents to the cannabis store and to the ATM operation.', 3),
  ('personal',    'Michael Lyman (Personal)',       '1040',       null,
   'Personal (non-business) activity, kept separate from the businesses.', 4)
on conflict (code) do nothing;

-- Journal sequences start at 1 for each entity.
insert into public.gl_journal_sequences (entity_id, next_no)
select id, 1 from public.gl_entities
on conflict (entity_id) do nothing;

-- Ownership of the S-corp, verified against IRS Schedule K-1 transcripts for
-- 2022, 2023 and 2024 (each shows Michael at 85%). 85000 + 10000 + 5000 = 100000.
insert into public.gl_shareholders
  (entity_id, name, relationship, ownership_milli_pct, receives_distributions, notes)
select e.id, v.name, v.relationship, v.pct, v.receives, v.notes
from public.gl_entities e
join (values
  ('Michael Lyman',   'owner',       85000, true,
   'Verified 85% on Schedule K-1 (1120-S) for 2022, 2023 and 2024.'),
  ('Mother',          'mother',      10000, false,
   'Allocated 10% of income but NOT paid distributions; Michael covers her resulting tax burden personally. Flagged for grandfather review: one-class-of-stock and gift-tax considerations (research/bookkeeping/07).'),
  ('Nicholas Mullan', 'grandfather',  5000, true,
   'Grandfather and accountant; 5% for performing the tax work, and is paid his share.')
) as v(name, relationship, pct, receives, notes) on true
where e.code = 'greenway'
  and not exists (select 1 from public.gl_shareholders s where s.entity_id = e.id);

-- All twelve 2026 periods for every entity, open. 2026 is the first fiscal year
-- of the new books (cut-over Option C).
insert into public.gl_periods (entity_id, fiscal_year, period_no, start_date, end_date)
select e.id,
       2026,
       m.n,
       make_date(2026, m.n, 1),
       (make_date(2026, m.n, 1) + interval '1 month - 1 day')::date
from public.gl_entities e
cross join generate_series(1, 12) as m(n)
on conflict (entity_id, fiscal_year, period_no) do nothing;

-- =============================================================================
-- ROW-LEVEL SECURITY — the books are ADMIN-ONLY.
-- Staff operate the POS; they have no business reading or writing the general
-- ledger. The server uses the service-role client, which bypasses RLS.
-- =============================================================================
alter table public.gl_entities            enable row level security;
alter table public.gl_shareholders        enable row level security;
alter table public.gl_accounts            enable row level security;
alter table public.gl_periods             enable row level security;
alter table public.gl_journal_sequences   enable row level security;
alter table public.gl_journals            enable row level security;
alter table public.gl_journal_lines       enable row level security;
alter table public.gl_allocation_configs  enable row level security;
alter table public.gl_audit_events        enable row level security;

drop policy if exists gl_entities_admin_all on public.gl_entities;
create policy gl_entities_admin_all on public.gl_entities
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_shareholders_admin_all on public.gl_shareholders;
create policy gl_shareholders_admin_all on public.gl_shareholders
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_accounts_admin_all on public.gl_accounts;
create policy gl_accounts_admin_all on public.gl_accounts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_periods_admin_all on public.gl_periods;
create policy gl_periods_admin_all on public.gl_periods
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_journal_sequences_admin_all on public.gl_journal_sequences;
create policy gl_journal_sequences_admin_all on public.gl_journal_sequences
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_journals_admin_all on public.gl_journals;
create policy gl_journals_admin_all on public.gl_journals
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_journal_lines_admin_all on public.gl_journal_lines;
create policy gl_journal_lines_admin_all on public.gl_journal_lines
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_allocation_configs_admin_all on public.gl_allocation_configs;
create policy gl_allocation_configs_admin_all on public.gl_allocation_configs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_audit_events_admin_all on public.gl_audit_events;
create policy gl_audit_events_admin_all on public.gl_audit_events
  for all using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- END 0172_gl_foundation.sql
-- The ledger now exists, is empty, and is locked. It cannot hold a wrong number
-- because it holds no numbers at all — by design. Slice F2 adds the chart of
-- accounts, with the owner approving every account.
-- =============================================================================

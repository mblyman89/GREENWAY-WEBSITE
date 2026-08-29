-- =============================================================================
-- 0212_deposit_bags.sql  (books-98)
--
-- THE STORE SAFE LAYER + THE NUMBERED DEPOSIT BAG.
--
-- Owner (verbatim): "we have three tills, one master till, and a store safe.
-- The employee counts the till before opening, to verify it has 167.50 in it.
-- At the end of the shift they count it out and enter the amount into the
-- register. 167.50 is left in the register and the rest goes into the safe. The
-- end of the day, the safe money goes into the deposit bag with an id."
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- Before books-98 a deposit was matched to the days it came from by FIFO on
-- DATE alone. That is a convention, not a fact: if two bags are sealed on the
-- same day, or a bag sits in the safe over a weekend, the date cannot tell the
-- bank credit which cash it was. The bag NUMBER can. It is written on the bag,
-- it is on the bank's deposit slip, and it survives the trip. Once a deposit
-- carries a bag id, the match stops being an assumption and becomes evidence.
--
-- This mirrors Oracle Retail Xstore, which runs cash in three layers -- till,
-- store safe, bank deposit -- and prepares the bank deposit FROM THE SAFE under
-- "Store Safe Maintenance", not from any individual till. Its safe bags carry
-- unique scannable ids through a fixed lifecycle, and a register cannot close
-- while a bag it created is still undeclared.
--
-- THE LIFECYCLE (enforced in safe-bag-core.ts, mirrored by the check below)
--     available -> undeclared -> counted -> deposited -> available
-- "undeclared" is the state that does the real work: cash pulled from a drawer
-- into a bag has LEFT the drawer but has not yet been counted into the safe, so
-- it is nobody's money until somebody counts it. Xstore's rule is that "that
-- cash is still a part of the drawer" until it is declared, and the register
-- cannot close while such a bag exists. That is the control that makes cash
-- impossible to lose in the gap between two people.
--
-- A BAG IS ATOMIC. Xstore: "All the money that is in a safe bag is used in the
-- function ... There is no option to use only half the money." A bag is sealed
-- once, for one amount, and is never topped up or partially banked. That is why
-- there is one amount column and not a running balance.
--
-- Money in MINOR UNITS (cents), integers.
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- deposit_bags
-- ---------------------------------------------------------------------------
create table if not exists public.deposit_bags (
  id             uuid primary key default gen_random_uuid(),

  -- The number printed on the physical bag. This is the whole point of the
  -- table: it is the identifier the BANK also sees, so it is what lets a bank
  -- credit be matched to counted cash without guessing from the date.
  bag_no         text not null,

  -- The business day whose takings this bag carries. Not the date it reached
  -- the bank -- that is deposit_confirmed_on below, and the two differ by days.
  business_day   date not null,

  status         text not null default 'available'
                   check (status in ('available','undeclared','counted','deposited')),

  -- What was counted into the bag when it was sealed, in cents. NULL until it
  -- has actually been counted: rule 135, zero is an answer and missing is a
  -- question, and "nobody has counted this yet" is a question, not $0.00.
  amount_minor   integer null check (amount_minor is null or amount_minor > 0),

  -- Who pulled the cash, and who counted it into the safe. Two different people
  -- is the point; the schema does not force it, because at a three-person shop
  -- it is sometimes genuinely the same person, and a constraint that fires on
  -- normal operation just teaches people to work around it.
  pulled_by      uuid null references public.employees(id) on delete set null,
  counted_by     uuid null references public.employees(id) on delete set null,

  sealed_at      timestamptz null,

  -- Set when the bank confirms the deposit. Until then the cash is in 10400
  -- Undeposited Funds and this is NULL.
  deposit_confirmed_on date null,

  notes          text null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One bag number per business day. NOT globally unique: bag numbers come off a
-- roll and roll over, so the same printed number legitimately reappears months
-- later. Scoping to the day keeps the identifier honest without refusing a
-- reused bag number a year on.
create unique index if not exists deposit_bags_no_day_uniq
  on public.deposit_bags (bag_no, business_day);

create index if not exists deposit_bags_status_idx
  on public.deposit_bags (status);

create index if not exists deposit_bags_day_idx
  on public.deposit_bags (business_day);

-- A sealed bag must have an amount, and an unsealed one must not claim to be
-- deposited. Written as one constraint because the two facts are one rule:
-- money is only committed to a deposit once it has been counted.
alter table public.deposit_bags
  drop constraint if exists deposit_bags_counted_has_amount;
alter table public.deposit_bags
  add constraint deposit_bags_counted_has_amount
  check (
    status in ('available','undeclared')
    or amount_minor is not null
  );

comment on table public.deposit_bags is
  'Numbered store-safe deposit bags. The bag id is what lets a bank credit be '
  'matched to the counted cash it came from, instead of inferring it from the '
  'date. Lifecycle: available -> undeclared -> counted -> deposited.';

comment on column public.deposit_bags.amount_minor is
  'Cents counted into the bag when sealed. NULL means not yet counted, which '
  'is a QUESTION, not zero.';

-- ---------------------------------------------------------------------------
-- Which drawer sessions a bag carries.
--
-- Many-to-many on purpose: one bag holds the takings of all three tills, and a
-- till closed late on Friday can end up in Saturday's bag. Storing this as a
-- link table rather than a bag_id column on drawer_sessions is what allows the
-- second case without lying about the first.
-- ---------------------------------------------------------------------------
create table if not exists public.deposit_bag_sessions (
  bag_id       uuid not null references public.deposit_bags(id) on delete cascade,
  session_id   uuid not null references public.drawer_sessions(id) on delete cascade,
  -- What this session contributed to this bag, in cents.
  amount_minor integer not null check (amount_minor > 0),
  created_at   timestamptz not null default now(),
  primary key (bag_id, session_id)
);

create index if not exists deposit_bag_sessions_session_idx
  on public.deposit_bag_sessions (session_id);

comment on table public.deposit_bag_sessions is
  'Which drawer sessions contributed cash to which sealed bag, and how much.';

-- ---------------------------------------------------------------------------
-- RLS. Mirrors 0038_registers_drawers.sql exactly: cash handling is FLOOR work,
-- so staff read and write, and there is no public access to internal financial
-- data. Deviating to owner-only here would mean the people who actually seal
-- the bags could not record that they had done so, and the control would be
-- worked around within a week.
-- ---------------------------------------------------------------------------
alter table public.deposit_bags          enable row level security;
alter table public.deposit_bag_sessions  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['deposit_bags','deposit_bag_sessions']
  loop
    execute format('drop policy if exists %1$s_staff_read on public.%1$s;', t);
    execute format('create policy %1$s_staff_read on public.%1$s for select using (public.is_staff());', t);
    execute format('drop policy if exists %1$s_staff_write on public.%1$s;', t);
    execute format('create policy %1$s_staff_write on public.%1$s for all using (public.is_staff()) with check (public.is_staff());', t);
  end loop;
end $$;

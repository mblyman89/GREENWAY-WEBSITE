-- ---------------------------------------------------------------------------
-- 0133_special_discounts.sql  (Feature run — special discount programs)
--
-- Three PERSON-based courtesy discount programs, deliberately separate from
-- the promotions engine (owner decision: admin-only to configure, never on
-- the promotions page, and every single use is recorded — who gave it, who
-- received it, and how much it saved):
--
--   employee — staff purchases (owner default 35%). The POS additionally
--              requires a DIFFERENT employee's PIN approval and blocks the
--              purchase on the register the buying employee is logged into;
--              this schema records those facts for the audit trail.
--   industry — licensed-industry visitors (vendors, budtenders from other
--              stores). The visitor's company name is required so usage is
--              reportable per-company. Seeded DISABLED at 0% — the owner
--              picks the rate himself (we never guess one for him).
--   veteran  — military veterans (owner default 15%). The cashier must
--              confirm they physically checked a military ID.
--
-- Conventions (matching the rest of the schema):
--   • Money in MINOR UNITS (cents).
--   • Percent in BASIS POINTS (3500 = 35%) — same as tax_settings.
--   • RLS deny-by-default; managers (public.is_manager(), from 0130) can
--     READ; all writes go through the app's service-role server code, which
--     bypasses RLS — so no write policy is granted to humans at all.
--
-- Idempotent: create-if-not-exists / on-conflict-do-nothing / drop-if-exists
-- before create policy. Safe to run more than once.
-- APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. special_discount_settings — one row per program (the owner's dials).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.special_discount_settings (
  kind        text primary key
                check (kind in ('employee', 'industry', 'veteran')),
  -- Discount rate in basis points (3500 = 35%). 0..10000 inclusive.
  percent_bps integer not null default 0
                check (percent_bps >= 0 and percent_bps <= 10000),
  enabled     boolean not null default false,
  updated_by  uuid references public.staff_profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.special_discount_settings is
  'Admin-only special discount programs (employee/industry/veteran). NOT promotions — person-based courtesy rates, percent in basis points.';

-- Seed the owner's starting rates. on conflict do nothing = re-runnable and
-- never overwrites a rate the owner has since changed.
insert into public.special_discount_settings (kind, percent_bps, enabled) values
  ('employee', 3500, true),
  ('industry', 0,    false),
  ('veteran',  1500, true)
on conflict (kind) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. special_discount_uses — append-style ledger: every time one of these
--    discounts is applied, exactly what happened and who was involved.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.special_discount_uses (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null
                             check (kind in ('employee', 'industry', 'veteran')),
  -- Who RANG the sale, and where.
  cashier_employee_id      uuid not null references public.employees(id) on delete restrict,
  register_id              uuid not null references public.registers(id) on delete restrict,
  -- employee program: which staff member was buying, and the OTHER employee
  -- who approved it with their PIN (must differ — enforced in the app rules).
  beneficiary_employee_id  uuid references public.employees(id) on delete set null,
  approved_by_employee_id  uuid references public.employees(id) on delete set null,
  -- industry program: the visitor's company (reportable per-company).
  company_name             text,
  -- veteran program: cashier confirmed a physical military ID.
  military_id_checked      boolean not null default false,
  -- Money snapshot in cents: the pre-discount subtotal and what was taken off.
  subtotal_minor           integer not null default 0 check (subtotal_minor >= 0),
  discount_minor           integer not null default 0 check (discount_minor >= 0),
  -- Sale linkage: the register sale's client_uuid (pos_sale_events idempotency
  -- key) and/or the resulting order. One special discount per sale.
  client_uuid              uuid,
  order_id                 uuid references public.orders(id) on delete set null,
  occurred_at              timestamptz not null default now()
);

comment on table public.special_discount_uses is
  'Every use of a special discount: who gave it (cashier), who received it (employee beneficiary / company / veteran), the approver, and cents saved.';

-- One recorded use per register sale (client_uuid is the sale's idempotency
-- key from pos_sale_events) — a sync retry can never double-record.
create unique index if not exists special_discount_uses_client_uuid_idx
  on public.special_discount_uses (client_uuid) where client_uuid is not null;

-- Reporting: "who / to whom / how often".
create index if not exists special_discount_uses_kind_time_idx
  on public.special_discount_uses (kind, occurred_at desc);
create index if not exists special_discount_uses_beneficiary_idx
  on public.special_discount_uses (beneficiary_employee_id)
  where beneficiary_employee_id is not null;
create index if not exists special_discount_uses_cashier_idx
  on public.special_discount_uses (cashier_employee_id);
create index if not exists special_discount_uses_company_idx
  on public.special_discount_uses (lower(company_name))
  where company_name is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Row-level security — deny by default; managers read; writes only via
--    the app's service-role server code (bypasses RLS). Same posture as 0130.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.special_discount_settings enable row level security;
alter table public.special_discount_uses enable row level security;

drop policy if exists special_discount_settings_mgr_read on public.special_discount_settings;
create policy special_discount_settings_mgr_read on public.special_discount_settings
  for select using (public.is_manager());

drop policy if exists special_discount_uses_mgr_read on public.special_discount_uses;
create policy special_discount_uses_mgr_read on public.special_discount_uses
  for select using (public.is_manager());

-- ---------------------------------------------------------------------------
-- Review (run after applying — expect: 3 seeded settings rows; both tables
-- with rowsecurity = true):
--
--   select kind, percent_bps, enabled from public.special_discount_settings order by kind;
--
--   select relname, relrowsecurity from pg_class
--   where relname in ('special_discount_settings','special_discount_uses');
-- ---------------------------------------------------------------------------

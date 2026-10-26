-- 0302_employee_product_loans.sql  (Register round — S5 employee pay-later)
--
-- Owner request (verbatim, todo.md): "I want to add to the employee purchase
-- feature an additional button, for paying later. if they are to pay for it
-- later, it is an employee product loan, and I want to keep track of these
-- unpaid for products and then deduct it from their pay if over n number of
-- days old, a setting in the admin somewhere for owners and admin to set."
--
-- One row per pay-later register sale (paymentMethod "employee_tab"). The
-- N-day setting lives in site_settings key 'employee_loan_policy'.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).

create table if not exists public.employee_product_loans (
  id                uuid primary key default gen_random_uuid(),
  client_uuid       uuid not null unique,
  order_id          uuid,  -- plain uuid: orders are emptied by a factory reset, this KEEP ledger is not
  employee_id       uuid not null references public.employees(id) on delete restrict,
  cashier_id        uuid references public.employees(id) on delete set null,
  witness_id        uuid references public.employees(id) on delete set null,
  register_id       uuid references public.registers(id) on delete set null,
  amount_minor      integer not null check (amount_minor > 0),
  ack_text          text not null,
  taken_at          timestamptz not null,
  status            text not null default 'open'
                      check (status in ('open', 'paid', 'deducted', 'forgiven')),
  settled_at        timestamptz,
  settled_by        uuid,
  settle_note       text,
  created_at        timestamptz not null default now()
);

create index if not exists employee_product_loans_open_idx
  on public.employee_product_loans (employee_id, taken_at) where status = 'open';
create index if not exists employee_product_loans_taken_idx
  on public.employee_product_loans (taken_at desc);

alter table public.employee_product_loans enable row level security;

comment on table public.employee_product_loans is
  'Register S5: employee pay-later product loans. Open loans older than the owner''s N days are deducted from pay (Admin → Employee tabs).';

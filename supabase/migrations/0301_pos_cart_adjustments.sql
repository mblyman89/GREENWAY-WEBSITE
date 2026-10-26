-- 0301_pos_cart_adjustments.sql  (Register round — S3 minus/void tracker)
--
-- Owner request (verbatim, todo.md): "I also want to keep track of who is
-- using the minus quantity button on the register screen. It is like a void,
-- and I want to make sure it is not getting abused in anyway. So a tracker on
-- when, who and how often it gets used ..."
--
-- Every minus (−), line remove (✕) and cancelled sale on the register queues a
-- `cart_adjustment` event; sync lands it here. Voids stay in audit_logs
-- (register.sale_voided) and are combined in Reports → Register Adjustments.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment'));

create table if not exists public.pos_cart_adjustments (
  id              uuid primary key default gen_random_uuid(),
  client_uuid     uuid not null unique,
  register_id     uuid references public.registers(id) on delete set null,
  employee_id     uuid references public.employees(id) on delete set null,
  action          text not null check (action in ('qty_decrease', 'line_remove', 'cart_cancel')),
  variant_id      uuid,
  product_name    text,
  units_removed   integer not null check (units_removed between 1 and 10000),
  value_minor     integer not null default 0 check (value_minor >= 0),
  line_count      integer,
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists pos_cart_adjustments_occurred_idx
  on public.pos_cart_adjustments (occurred_at desc);
create index if not exists pos_cart_adjustments_employee_idx
  on public.pos_cart_adjustments (employee_id, occurred_at desc);

alter table public.pos_cart_adjustments enable row level security;

-- 0063_sales_limit_override.sql  (Slice 109)
--
-- Sales-limit HARD GATE + logged manager override.
--
-- Slice 34 (migration 0045) created sales_limit_events to LOG each cart
-- evaluation. Slice 109 turns the limit from advisory into a HARD BLOCK at the
-- point of sale, permitting an over-limit sale ONLY via a permission-gated,
-- LOGGED manager override. To make the override auditable we record, on the
-- same event row: whether an override was applied, who applied it, and the
-- written reason they gave. RCW 69.50.360 / WAC 314-55-095 (rec limits) and
-- the 3x medical limits (RCW 69.51A) are the underlying statutory caps.
--
-- Idempotent: safe to run multiple times (owner applies manually in SQL editor).

alter table public.sales_limit_events
  add column if not exists override_applied boolean not null default false;

alter table public.sales_limit_events
  add column if not exists override_by uuid references public.staff_profiles(id) on delete set null;

alter table public.sales_limit_events
  add column if not exists override_reason text;

-- Find over-limit sales that were pushed through by an override quickly.
create index if not exists sales_limit_events_override_idx
  on public.sales_limit_events (override_applied, created_at desc);

-- ============================================================================
-- 0096_sale_path_gates.sql — Phase A sale-path integrity (GAP H-1 / H-2 / H-3)
--
-- 1. order_lines.category — placement-time category SNAPSHOT so the completion
--    gate can map every line to its WAC 314-55-095 limit bucket without
--    depending on the (mutable) published menu.
-- 2. orders.limit_flag / orders.limit_reasons — placement-time sales-limit
--    soft-check annotation ("we'll adjust at pickup") surfaced to staff.
-- 3. RLS TIGHTENING (S-2c): drop the anonymous INSERT policies on orders /
--    order_lines / order_events. Placement runs EXCLUSIVELY through the
--    service-role API route (POST /api/orders → orders-store), which bypasses
--    RLS; the anon policies were an unused tampering surface that allowed any
--    site visitor to insert arbitrary order rows with arbitrary prices.
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor.
-- ============================================================================

-- 1) Category snapshot on order lines --------------------------------------
alter table public.order_lines
  add column if not exists category text;

comment on column public.order_lines.category is
  'Placement-time category slug snapshot (server-resolved from the published menu). Used to map the line to its WAC 314-55-095 limit bucket and its tax divisor at completion.';

-- 2) Sales-limit annotation on orders ---------------------------------------
alter table public.orders
  add column if not exists limit_flag boolean not null default false;

alter table public.orders
  add column if not exists limit_reasons jsonb not null default '[]'::jsonb;

comment on column public.orders.limit_flag is
  'True when the placement-time WAC 314-55-095 sales-limit soft check found the cart over a statutory bucket. Staff must adjust at pickup; completion re-checks and hard-blocks.';
comment on column public.orders.limit_reasons is
  'Human-readable per-bucket overage reasons captured at placement (JSON array of strings).';

-- 3) Drop the anonymous INSERT policies (service-role path only) -------------
drop policy if exists orders_public_insert on public.orders;
drop policy if exists order_lines_public_insert on public.order_lines;
drop policy if exists order_events_public_insert on public.order_events;

-- RLS remains ENABLED on all three tables with the staff-only policies from
-- 0007 (orders_staff_all / order_lines_staff_all / order_events_staff_all).
-- The anon key can no longer insert order rows directly.

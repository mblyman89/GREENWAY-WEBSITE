-- 0300_friends_family_discount.sql  (Register round — S2 friends & family)
--
-- Owner request (verbatim, todo.md): "I would like to also add a friends and
-- family discount button. It is a 35% off discount. ... I don't want to have
-- a list of family and friends ... Maybe the friend or family is required to
-- have an account, and we keep track of who is getting the discount and how
-- often."
--
-- Design (no list of names): the guest MUST have a customer account (WHO got
-- it), a SPONSOR employee vouches with their PIN and can never be the cashier
-- (two people on every use), and an owner-set cap limits uses per account per
-- rolling 30 days. Every use lands on the existing special_discount_uses
-- ledger with customer_id, so the report shows who, how often, and sponsor.
--
-- Idempotent. APPLY MANUALLY in the Supabase SQL editor (standing rule).

alter table public.special_discount_settings
  drop constraint if exists special_discount_settings_kind_check;
alter table public.special_discount_settings
  add constraint special_discount_settings_kind_check
  check (kind in ('employee', 'industry', 'veteran', 'friends_family'));

-- Uses per customer account per rolling 30 days (null = no cap).
alter table public.special_discount_settings
  add column if not exists uses_per_30d_cap integer
  check (uses_per_30d_cap is null or uses_per_30d_cap between 1 and 100);

insert into public.special_discount_settings (kind, percent_bps, enabled, uses_per_30d_cap)
values ('friends_family', 3500, true, 4)
on conflict (kind) do nothing;

alter table public.special_discount_uses
  drop constraint if exists special_discount_uses_kind_check;
alter table public.special_discount_uses
  add constraint special_discount_uses_kind_check
  check (kind in ('employee', 'industry', 'veteran', 'friends_family'));

alter table public.special_discount_uses
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists special_discount_uses_customer_idx
  on public.special_discount_uses (customer_id, occurred_at desc)
  where customer_id is not null;

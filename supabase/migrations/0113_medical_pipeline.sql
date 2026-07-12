-- 0113_medical_pipeline.sql
-- Task O — Medical cannabis pipeline: durable DOH-compliant product registry +
-- the order → medical-sale link that makes exempt sales real end-to-end.
--
-- Grounded in: WAC 314-55-090 (excise exemption + 5-yr records), RCW 82.08.9998
-- (sales-tax exemption — 246-70 COMPLIANT products only; High-CBD compliant is
-- sales-tax-free for anyone), chapter 246-70 WAC (DOH product categories:
-- General Use / High THC / High CBD; High-THC sells ONLY to registry patients),
-- RCW 69.51A.230 (recognition cards). See docs/MEDICAL_CANNABIS_COMPLIANCE.md.
--
-- WHY A REGISTRY (and not menu_items.doh_compliant from 0040): menu_items rows
-- are per menu_version — every menu re-import creates NEW rows, so a flag there
-- is wiped on the next import and has never been read by any code. This table
-- is keyed by the STABLE POS product key (menu_items.source_item_id, the same
-- key product_enrichments uses), so the DOH verification survives re-imports.
--
-- Idempotent. Owner applies manually in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- DOH-compliant product registry (durable, keyed by POS product key)
-- ---------------------------------------------------------------------------
create table if not exists public.medical_product_registry (
  id                uuid primary key default gen_random_uuid(),
  -- Stable POS product key (menu_items.source_item_id / order_lines.product_id).
  pos_product_key   text not null unique,
  -- Name snapshot at verification time (for the audit trail; menu is truth).
  product_name      text,
  -- WAC 246-70 category, verified from the DOH logo on the physical packaging:
  --   general_use — any LCB-allowed product; ≤10 mg THC/serving, ≤100 mg/pkg
  --   high_thc    — >10–50 mg THC/serving (capsules, tinctures, patches,
  --                 suppositories ONLY); sells ONLY to registry cardholders
  --   high_cbd    — low-THC/high-CBD ratios; sales-tax-free for ANYONE
  doh_category      text not null,
  notes             text,
  verified_by       uuid references public.staff_profiles(id) on delete set null,
  verified_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'medical_product_registry'
      and constraint_name = 'medical_product_registry_category_chk'
  ) then
    alter table public.medical_product_registry
      add constraint medical_product_registry_category_chk
      check (doh_category in ('general_use', 'high_thc', 'high_cbd'));
  end if;
end $$;

create index if not exists med_product_registry_key_idx
  on public.medical_product_registry (pos_product_key);

-- ---------------------------------------------------------------------------
-- Orders → the recognition card used for a medical sale
-- ---------------------------------------------------------------------------
-- Which card (patient_authorizations row) this order is being sold under. Set
-- when staff attach a verified patient before completion; the card is
-- RE-validated at the completion gate and the WAC 314-55-090(2) exempt-sale
-- rows are recorded from it. orders.customer_id (0022) carries the customer
-- link (loyalty etc.); this column pins the exact card snapshot.
alter table public.orders
  add column if not exists medical_authorization_id uuid
    references public.patient_authorizations(id) on delete set null;

create index if not exists orders_medical_auth_idx
  on public.orders (medical_authorization_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger + RLS (staff read/write, mirrors sibling medical tables)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['medical_product_registry'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_staff_read on public.%I;', t, t);
    execute format('create policy %I_staff_read on public.%I for select using (public.is_staff());', t, t);
    execute format('drop policy if exists %I_staff_write on public.%I;', t, t);
    execute format(
      'create policy %I_staff_write on public.%I for all using (public.is_staff()) with check (public.is_staff());',
      t, t
    );
  end loop;
end $$;

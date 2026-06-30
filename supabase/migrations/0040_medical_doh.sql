-- 0040_medical_doh.sql
-- Slice 28 — Medical endorsement, recognition cards & DOH compliance (H/I).
--
-- Grounded in: WAC 314-55-090, HB 1453 (DOH 608-050), DOH 608-048, RCW
-- 69.51A.230 / 69.50.535. See docs/medical-doh-requirements.md.
--
-- Extends the existing patient_authorizations table (0022) with the precise
-- DOH recognition-card fields, adds a medically_endorsed store flag, and adds
-- the WAC 314-55-090(2) excise-exempt sale recordkeeping table (retain 5 yrs).
--
-- Idempotent. Owner applies manually in the SQL editor.

-- ---------------------------------------------------------------------------
-- Recognition-card fields on patient_authorizations
-- ---------------------------------------------------------------------------
alter table public.patient_authorizations
  -- The MCR randomly-generated unique patient identifier (RCW 69.51A.230).
  add column if not exists unique_patient_identifier text,
  -- Card holder type: patient or designated provider.
  add column if not exists holder_type text not null default 'patient',
  -- effective_on mirrors the recognition card's effective date (issued_on is
  -- kept for backward compatibility; effective_on is authoritative going fwd).
  add column if not exists effective_on date,
  -- Whether this customer is in the DOH database / MCR (drives exemptions).
  add column if not exists in_doh_database boolean not null default false,
  -- Authorization-form validation checklist (DOH 608-048), captured at issuance.
  add column if not exists form_complete_signed boolean not null default false,
  add column if not exists tamper_resistant_verified boolean not null default false,
  add column if not exists identity_verified boolean not null default false,
  add column if not exists embossed_seal_verified boolean not null default false,
  -- When a consultant validated the card in the MCR (manual lookup result).
  add column if not exists mcr_validated_at timestamptz,
  add column if not exists mcr_validated_by uuid references public.staff_profiles(id) on delete set null,
  -- Optional designated-provider link (the patient this DP serves, or vice versa).
  add column if not exists linked_customer_id uuid references public.customers(id) on delete set null;

-- holder_type guard
do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'patient_authorizations' and constraint_name = 'patient_auth_holder_type_chk'
  ) then
    alter table public.patient_authorizations
      add constraint patient_auth_holder_type_chk
      check (holder_type in ('patient', 'designated_provider'));
  end if;
end $$;

create index if not exists patient_auth_upid_idx
  on public.patient_authorizations (unique_patient_identifier);

-- ---------------------------------------------------------------------------
-- Store-level medical endorsement flag (single config row)
-- ---------------------------------------------------------------------------
create table if not exists public.medical_endorsement_config (
  id                       uuid primary key default gen_random_uuid(),
  -- Does this store hold a valid LCB medical endorsement (RCW 69.50.375)?
  is_medically_endorsed    boolean not null default true,
  endorsement_number       text,
  -- The excise exemption sunsets 2029-06-30 (WAC 314-55-090(6)).
  excise_exemption_until    date not null default date '2029-06-30',
  notes                    text,
  updated_by               uuid references public.staff_profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

insert into public.medical_endorsement_config (is_medically_endorsed, notes)
select true, 'Greenway holds an LCB medical endorsement.'
where not exists (select 1 from public.medical_endorsement_config);

-- ---------------------------------------------------------------------------
-- DOH-compliant product flag on the menu items (drives excise exemption)
-- WAC 246-70-040 compliant products bear the DOH logo and are lab-tested.
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column if not exists doh_compliant boolean not null default false;

-- ---------------------------------------------------------------------------
-- Excise-exempt sale records — WAC 314-55-090(2). Retain 5 years.
-- One row per excise-exempt line item (SKU + price), tied to the card data.
-- ---------------------------------------------------------------------------
create table if not exists public.medical_exempt_sales (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid references public.orders(id) on delete set null,
  customer_id                 uuid references public.customers(id) on delete set null,
  authorization_id            uuid references public.patient_authorizations(id) on delete set null,
  -- WAC 314-55-090(2)(a)
  sale_date                   date not null default current_date,
  -- WAC 314-55-090(2)(b) — copied from the recognition card at time of sale
  unique_patient_identifier   text not null,
  card_effective_on           date,
  card_expires_on             date,
  -- WAC 314-55-090(2)(c)
  product_sku                 text not null,
  product_name                text,
  -- WAC 314-55-090(2)(d) — minor units (cents)
  sales_price_minor           integer not null,
  -- which exemption(s) applied
  sales_tax_exempt            boolean not null default true,
  excise_tax_exempt           boolean not null default true,
  excise_amount_exempt_minor  integer not null default 0,
  recorded_by                 uuid references public.staff_profiles(id) on delete set null,
  created_at                  timestamptz not null default now()
);
create index if not exists med_exempt_order_idx on public.medical_exempt_sales (order_id);
create index if not exists med_exempt_date_idx on public.medical_exempt_sales (sale_date desc);
create index if not exists med_exempt_upid_idx on public.medical_exempt_sales (unique_patient_identifier);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['medical_endorsement_config'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['medical_endorsement_config','medical_exempt_sales'] loop
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

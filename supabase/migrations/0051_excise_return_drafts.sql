-- =============================================================================
-- 0051_excise_return_drafts.sql  (Slice 55)
--
-- Full editable LIQ-1295 draft + excise payment reconciliation.
--
-- Grounded in the official LIQ-1295 (R 7.24) workbook and the WSLCB Cannabis Tax
-- Reporting Guide (Payments). See docs/excise-payment-methods.md.
--
-- Adds:
--   1. excise_return_drafts  — one editable draft per (month, year). Holds EVERY
--      editable LIQ-1295 input field so an employee can fill/override the form in
--      the app before download, plus payment reconciliation (method, confirmation,
--      paid amount/date) so a return is tracked filed -> paid.
--
-- The computed sales figures (Box 1/Box 2) still come from live data at compute
-- time; the draft stores OVERRIDES + the manual boxes (6/8/9) + header + flags.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.excise_return_drafts (
  id                       uuid primary key default gen_random_uuid(),
  report_month             integer not null check (report_month between 1 and 12),
  report_year              integer not null,

  -- LIQ-1295 header (override license_settings when set here).
  license_number           text,
  trade_name               text,
  location_address         text,
  city                     text,
  contact_phone            text,
  contact_email            text,

  -- Form flags (Yes/No on the sheet).
  is_revised               boolean not null default false,
  is_no_sales              boolean not null default false,
  is_final                 boolean not null default false,

  -- Box overrides (all in MINOR UNITS / cents; null = use computed/zero).
  -- Box 1 & Box 2 are normally computed from live sales, but the owner may
  -- override them (e.g. to match a corrected POS report on a revised return).
  box1_cannabis_sales_minor      integer,
  box2_less_medical_minor        integer,   -- magnitude; stored positive
  box6_additional_excise_minor   integer,
  box8_assessed_penalty_minor    integer,
  box9_approved_credits_minor    integer,   -- magnitude; stored positive

  notes                    text,

  -- Payment reconciliation.
  -- payment_method: ccrs_ach | paystation | mail | in_person | other
  payment_method           text,
  payment_status           text not null default 'unpaid',  -- unpaid | paid
  payment_confirmation     text,
  amount_paid_minor        integer,
  paid_at                  timestamptz,

  updated_by               uuid references public.staff_profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint excise_return_drafts_period_uniq unique (report_year, report_month)
);

create index if not exists excise_return_drafts_period_idx
  on public.excise_return_drafts (report_year, report_month);

-- payment_method guard
do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'excise_return_drafts' and constraint_name = 'excise_return_drafts_method_chk'
  ) then
    alter table public.excise_return_drafts
      add constraint excise_return_drafts_method_chk
      check (payment_method is null or payment_method in ('ccrs_ach','paystation','mail','in_person','other'));
  end if;
end $$;

drop trigger if exists excise_return_drafts_set_updated_at on public.excise_return_drafts;
create trigger excise_return_drafts_set_updated_at
  before update on public.excise_return_drafts
  for each row execute function public.set_updated_at();

-- RLS — STAFF read, ADMIN write (regulatory filing record).
alter table public.excise_return_drafts enable row level security;

drop policy if exists excise_return_drafts_staff_read on public.excise_return_drafts;
create policy excise_return_drafts_staff_read on public.excise_return_drafts
  for select using (public.is_staff());

drop policy if exists excise_return_drafts_admin_write on public.excise_return_drafts;
create policy excise_return_drafts_admin_write on public.excise_return_drafts
  for all using (public.is_admin()) with check (public.is_admin());

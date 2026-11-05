-- supabase/migrations/0342_label_studio.sql  (D177 S6 — Label Studio: saved designs + print history)
--
-- Owner request (verbatim, D177): "I want a much fancier, far more professional label builder
-- experience … It needs to be exceptional, professional, enterprise grade, easy to use."
--
--   1. public.label_templates - the store's saved label designs, picked by name on every device
--      ("Glass price tag 2.25x1.25", "Re-barcode 2x1 QR"). One per (kind, name) among live designs,
--      at most one default per kind (partial unique indexes, so a race can never make two). A design
--      is retired by stamping archived_at, never deleted, so a print-log row that names it still
--      resolves. kind: 'lot' (cannabis lot) | 'nc' (other inventory). The template jsonb is
--      re-validated by the app on every read (label-saved-core.ts savedTemplateFromRow).
--   2. public.label_print_log - append-only: who printed which labels, for which items, with what
--      code, on what stock. When a re-barcoded item will not ring up, this says what was printed.
--      subject_ids (uuid[], GIN) answers "every print for this lot / item".
--   3. public.label_template_set_default(id, kind) - moves the default in one statement block, so
--      two staff members pressing "Make default" at once cannot leave zero or two defaults.
--
-- Grants: RLS on; nothing for anon / authenticated.
--   label_templates: service_role select / insert / update (no delete - archive instead).
--   label_print_log: service_role select / insert only (append-only; never update / delete).
-- Factory reset: both KEPT (factory-reset-core.ts). Designs are owner configuration; the print
-- history is an operations log, and the reset's pinned WIPE list (0240) is not reopened.
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied the Label Studio still prints; saving designs and history show a hint
-- naming this file.

create table if not exists public.label_templates (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('lot', 'nc')),
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  printer_id   text not null check (printer_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  stock_id     text not null check (stock_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  template     jsonb not null check (jsonb_typeof(template) = 'object'),
  is_default   boolean not null default false,
  created_by   uuid null,
  created_at   timestamptz not null default now(),
  updated_by   uuid null,
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz null,
  check (not (is_default and archived_at is not null))
);

comment on table public.label_templates is
  'D177 S6 (0342): saved Label Studio designs (printer, label stock, barcode + fields) per kind (lot | nc). Archived, never deleted. Owner configuration; kept by the factory reset.';

create unique index if not exists label_templates_live_name_uq
  on public.label_templates (kind, lower(btrim(name))) where archived_at is null;
create unique index if not exists label_templates_one_default_uq
  on public.label_templates (kind) where is_default and archived_at is null;

alter table public.label_templates enable row level security;
revoke all on table public.label_templates from public, anon, authenticated;
revoke delete, truncate, references, trigger on table public.label_templates from service_role;
grant select, insert, update on table public.label_templates to service_role;

create table if not exists public.label_print_log (
  id                uuid primary key default gen_random_uuid(),
  printed_at        timestamptz not null default now(),
  printed_by        uuid null,
  printed_by_email  text null check (printed_by_email is null or char_length(printed_by_email) <= 320),
  kind              text not null check (kind in ('lot', 'nc')),
  printer_id        text not null check (char_length(printer_id) between 1 and 64),
  stock_id          text not null check (char_length(stock_id) between 1 and 64),
  symbology         text not null check (char_length(symbology) between 1 and 20),
  total_labels      integer not null check (total_labels between 1 and 1000),
  item_count        integer not null check (item_count between 1 and 1000),
  subject_ids       uuid[] not null check (cardinality(subject_ids) between 1 and 1000),
  items             jsonb not null check (jsonb_typeof(items) = 'array'),
  template          jsonb not null default '{}'::jsonb check (jsonb_typeof(template) = 'object'),
  template_id       uuid null references public.label_templates(id) on delete set null,
  context           text null check (context is null or char_length(context) <= 200)
);

comment on table public.label_print_log is
  'D177 S6 (0342): append-only Label Studio print history - who printed which labels, for which items (subject_ids), with what code, on what stock. Kept by the factory reset.';

create index if not exists label_print_log_printed_at_idx on public.label_print_log (printed_at desc);
create index if not exists label_print_log_subjects_gin on public.label_print_log using gin (subject_ids);

alter table public.label_print_log enable row level security;
revoke all on table public.label_print_log from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.label_print_log from service_role;
grant select, insert on table public.label_print_log to service_role;

create or replace function public.label_template_set_default(p_id uuid, p_kind text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_kind is null or p_kind not in ('lot', 'nc') then
    raise exception 'label_template_set_default: unknown kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.label_templates where id = p_id and kind = p_kind and archived_at is null) then
    raise exception 'label_template_set_default: no live % design %', p_kind, p_id using errcode = 'no_data_found';
  end if;
  update public.label_templates
     set is_default = false, updated_at = now()
   where kind = p_kind and is_default and id <> p_id;
  update public.label_templates
     set is_default = true, updated_at = now()
   where id = p_id and kind = p_kind and archived_at is null and not is_default;
end;
$$;

comment on function public.label_template_set_default(uuid, text) is
  'D177 S6 (0342): make one live design the default for its kind (clears the old default in the same call). Server only.';

revoke all on function public.label_template_set_default(uuid, text) from public, anon, authenticated;
grant execute on function public.label_template_set_default(uuid, text) to service_role;

notify pgrst, 'reload schema';

-- ===========================================================================
-- 0253_inventory_expiry_rules.sql
--
-- R34 (owner-requested). EXPIRATION RULES FOR LOTS THAT ARRIVED WITHOUT A DATE.
--
-- Owner request (verbatim, abridged):
--   "add an expiration date to all the products that do not have one
--    specifically assigned to it from the json and manifest ... a list of
--    every one of our types and categories, and a box next to it that lets me
--    assign a date to it ... skipping the ones that have a json set date.
--    Perhaps a setting that allows me to override all manually set dates."
--
-- WHAT THIS ADDS
--   1. public.inventory_expiry_rules - one rule per website category or per
--      inventory type: N months / N days after a basis date, a fixed date, or
--      "exempt" (the product does not degrade, e.g. glass).
--   2. inventory_lots.expires_on_rule_id / expires_on_rule_note - which rule
--      produced a rule-derived date and, in words, how ("Flower rule: 12
--      months after received date 2026-03-01"). Provenance is evidence.
--   3. The expires_on_source vocabulary (0215) gains two values:
--        'manifest' - the date came in on the vendor JSON / manifest
--        'rule'     - the date was computed by one of the rules above
--
-- WHAT IT NEVER DOES
--   * It never writes a date itself. Rules are applied by the app, after a
--     preview the owner confirms, and the app NEVER replaces a date whose
--     source is pos_import / coa / manifest, or a legacy date whose source was
--     never recorded (NULL source with a date = a document date of unknown
--     origin, protected). An owner-entered date is replaced only when the
--     owner explicitly turns on "override manual dates".
--   * WAC 314-55-105(8) makes a "best by" date OPTIONAL label information in
--     Washington; nothing here claims a rule date is a regulatory expiry.
--
-- IDEMPOTENT (standing rule 6): create-if-not-exists, add-column-if-not-exists,
-- guarded DO blocks, drop-and-recreate of the one widened check constraint.
-- APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0253_inventory_expiry_rules.rollback.sql
-- FACTORY RESET: KEEP (configuration, like inventory_types).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The rules table
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_expiry_rules (
  id              uuid primary key default gen_random_uuid(),
  scope           text not null,
  scope_key       text not null,
  scope_label     text,
  mode            text not null,
  amount          integer,
  fixed_date      date,
  basis           text not null default 'received_on',
  override_manual boolean not null default false,
  enabled         boolean not null default true,
  notes           text,
  citation_key    text,
  set_by          uuid references public.staff_profiles(id) on delete set null,
  set_at          timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.inventory_expiry_rules is
  'R34: owner expiration rules. One per website category (scope=category, scope_key = website category value) or inventory type (scope=type, scope_key = lower(trim) type key). A type rule beats its category rule. Applied only to lots with no document date, after an owner-confirmed preview.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_scope_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_scope_chk check (scope in ('category', 'type'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_key_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_key_chk
      check (scope_key = lower(btrim(scope_key)) and length(scope_key) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_mode_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_mode_chk check (mode in ('months', 'days', 'fixed', 'exempt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_basis_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_basis_chk check (basis in ('received_on', 'lab_tested_on'));
  end if;
  -- The value columns must match the mode exactly: months 1-120, days 1-3650,
  -- fixed needs a sane date and nothing else, exempt carries no value.
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_value_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_value_chk check (
        (mode = 'months' and amount between 1 and 120 and fixed_date is null)
        or (mode = 'days' and amount between 1 and 3650 and fixed_date is null)
        or (mode = 'fixed' and amount is null and fixed_date is not null and fixed_date >= date '2014-07-08')
        or (mode = 'exempt' and amount is null and fixed_date is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_expiry_rules_notes_chk') then
    alter table public.inventory_expiry_rules
      add constraint inventory_expiry_rules_notes_chk check (notes is null or length(notes) <= 1000);
  end if;
end$$;

create unique index if not exists inventory_expiry_rules_scope_key_uq
  on public.inventory_expiry_rules (scope, scope_key);

drop trigger if exists inventory_expiry_rules_set_updated_at on public.inventory_expiry_rules;
create trigger inventory_expiry_rules_set_updated_at
  before update on public.inventory_expiry_rules
  for each row execute function public.set_updated_at();

alter table public.inventory_expiry_rules enable row level security;

drop policy if exists "inventory_expiry_rules staff read" on public.inventory_expiry_rules;
create policy "inventory_expiry_rules staff read" on public.inventory_expiry_rules
  for select using (public.is_staff());

drop policy if exists "inventory_expiry_rules admin write" on public.inventory_expiry_rules;
create policy "inventory_expiry_rules admin write" on public.inventory_expiry_rules
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.inventory_expiry_rules to service_role;

-- ---------------------------------------------------------------------------
-- 2. Rule provenance on the lot
-- ---------------------------------------------------------------------------
alter table public.inventory_lots
  add column if not exists expires_on_rule_id   uuid references public.inventory_expiry_rules(id) on delete set null,
  add column if not exists expires_on_rule_note text;

comment on column public.inventory_lots.expires_on_rule_id is
  'R34: the inventory_expiry_rules row that computed expires_on (only when expires_on_source = rule). Set null if the rule is later deleted; the note keeps the words.';
comment on column public.inventory_lots.expires_on_rule_note is
  'R34: how a rule-derived expires_on was computed, in words (e.g. "Flower rule: 12 months after received date 2026-03-01").';

-- ---------------------------------------------------------------------------
-- 3. Widen the provenance vocabulary (0215) with 'manifest' and 'rule'
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'inventory_lots_expires_on_source_chk') then
    alter table public.inventory_lots drop constraint inventory_lots_expires_on_source_chk;
  end if;
  alter table public.inventory_lots
    add constraint inventory_lots_expires_on_source_chk
    check (
      expires_on_source is null
      or expires_on_source in ('pos_import', 'coa', 'owner_entered', 'manifest', 'rule')
    );
end$$;

-- A rule note only makes sense on a rule-sourced date.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_expires_on_rule_note_chk') then
    alter table public.inventory_lots
      add constraint inventory_lots_expires_on_rule_note_chk
      check (expires_on_rule_note is null or (expires_on_source = 'rule' and length(expires_on_rule_note) <= 300));
  end if;
end$$;

create index if not exists inventory_lots_expires_on_source_idx
  on public.inventory_lots (expires_on_source);

notify pgrst, 'reload schema';

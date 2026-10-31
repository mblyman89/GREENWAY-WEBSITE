-- 0329_medical_endorsement_switch.sql  (slice A-06 · owner decisions OD-27, OD-40)
--
-- WHY. The owner, verbatim (OD-40):
--   "I need your help adding a medical endorsement switch to the back office
--    medical page. right now its in code only, and i need a way to manually set
--    it in the back office for when i am ready to become endorsed. i also want
--    to make the test medical sales on the register to be a setting i can switch
--    on and off in the medical page. so the register can hide that ability, so
--    that real sales cant be rung in as a test medical sale."
-- And earlier (OD-27): "we have not gotten our medical endorsement yet".
--
-- Master plan A-06 (docs/accounting-bible/15-master-plan.md): one switch,
-- fail-closed, dated. Turning it on requires an endorsement number and an
-- effective date.
--
-- WHAT. No new table. On public.medical_endorsement_config (0040:55-70):
--   endorsed_effective_on       date     the day the LCB endorsement takes effect
--   register_test_mode_allowed  boolean  may the registers OFFER medical test
--                                        mode (default false = hidden)
--   is_medically_endorsed default flips TRUE -> FALSE (0040 seeded it TRUE with
--   the note "Greenway holds an LCB medical endorsement.", which was never true).
--
-- DATA. A row that says endorsed but has no endorsement number or no effective
-- date cannot be a real endorsement (OD-27), so it is switched OFF here with a
-- note. The app already treats such a row as NOT endorsed
-- (src/lib/medical/endorsement-switch-core.ts resolveEndorsement), so this only
-- makes the stored switch say what the registers already do. If no row exists,
-- one OFF row is inserted.
--
-- GUARDS.
--   * medical_endorsement_config_on_needs_facts: switched ON requires a
--     non-blank endorsement_number AND an endorsed_effective_on.
--   * RLS: staff keep READ; WRITE becomes owner-only (is_owner(), 0185). The app
--     writes with the service role after checking the owner in the server action,
--     so this only removes the ability of a non-owner browser session to flip it.
--
-- FACTORY RESET. Unchanged: the table is KEEP (factory-reset-core.ts).
-- Safe to re-run: add column if not exists, guarded constraint, drop/create policy.

alter table public.medical_endorsement_config
  add column if not exists endorsed_effective_on date;

alter table public.medical_endorsement_config
  add column if not exists register_test_mode_allowed boolean not null default false;

alter table public.medical_endorsement_config
  alter column is_medically_endorsed set default false;

-- A switched-ON row without the facts of a real endorsement goes OFF (OD-27).
update public.medical_endorsement_config
   set is_medically_endorsed = false,
       notes = 'Switched OFF by migration 0329: no endorsement number or effective date on file (owner OD-27: not endorsed yet).',
       updated_at = now()
 where is_medically_endorsed = true
   and (nullif(btrim(coalesce(endorsement_number, '')), '') is null
        or endorsed_effective_on is null);

-- Make sure the single config row exists, OFF.
insert into public.medical_endorsement_config (is_medically_endorsed, register_test_mode_allowed, notes)
select false, false, 'Not endorsed. Created by migration 0329.'
 where not exists (select 1 from public.medical_endorsement_config);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'medical_endorsement_config_on_needs_facts'
       and conrelid = 'public.medical_endorsement_config'::regclass
  ) then
    alter table public.medical_endorsement_config
      add constraint medical_endorsement_config_on_needs_facts
      check (
        not is_medically_endorsed
        or (nullif(btrim(coalesce(endorsement_number, '')), '') is not null
            and endorsed_effective_on is not null)
      );
  end if;
end $$;

comment on column public.medical_endorsement_config.endorsed_effective_on is
  'A-06: the day the LCB medical endorsement takes effect. Exemptions apply only from this Pacific day.';
comment on column public.medical_endorsement_config.register_test_mode_allowed is
  'A-06 / OD-40: may registers OFFER medical test mode. False hides it on every register.';

-- RLS: staff read (unchanged), owner-only write.
alter table public.medical_endorsement_config enable row level security;
drop policy if exists medical_endorsement_config_staff_write on public.medical_endorsement_config;
drop policy if exists medical_endorsement_config_owner_write on public.medical_endorsement_config;
create policy medical_endorsement_config_owner_write on public.medical_endorsement_config
  for all using (public.is_owner()) with check (public.is_owner());

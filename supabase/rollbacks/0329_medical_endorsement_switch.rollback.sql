-- Rollback for 0329_medical_endorsement_switch.sql.
-- Removes the two A-06 columns and the "ON needs facts" check, and restores the
-- 0040 staff write policy. The is_medically_endorsed DEFAULT is deliberately
-- left FALSE: putting back 0040's TRUE default would make a missing row mean
-- "endorsed", which is the fail-open defect A-06 removed. Stored rows are not
-- changed, so a store that is OFF stays OFF.
-- After this, the /admin/medical switch reports that migration 0329 is needed,
-- and register medical test mode stays hidden.
alter table public.medical_endorsement_config
  drop constraint if exists medical_endorsement_config_on_needs_facts;
alter table public.medical_endorsement_config
  drop column if exists endorsed_effective_on,
  drop column if exists register_test_mode_allowed;
drop policy if exists medical_endorsement_config_owner_write on public.medical_endorsement_config;
drop policy if exists medical_endorsement_config_staff_write on public.medical_endorsement_config;
create policy medical_endorsement_config_staff_write on public.medical_endorsement_config
  for all using (public.is_staff()) with check (public.is_staff());

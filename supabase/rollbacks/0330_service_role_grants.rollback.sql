-- Rollback for 0330_service_role_grants.sql.
--
-- Undoes ONLY the default-privilege change (step 3): future tables, sequences and
-- functions created by `postgres` in `public` go back to getting no automatic
-- grant for service_role, which is Supabase's behaviour since 2026-10-30.
--
-- The object grants from steps 1-2 are deliberately KEPT. Revoking them would
-- bring back the owner's exact failure ("permission denied for function
-- record_customer_return") on every return, vendor return, Other Inventory
-- sale/return and the checklist / recall / safe / supply-run pages. Before
-- 2026-10-30 every one of those objects had that grant automatically, so keeping
-- it restores the state the app was written and tested against; nothing becomes
-- reachable by anon or authenticated.
--
-- If you truly need to take a single grant back, do it by hand, for example:
--   revoke execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb) from service_role;
do $$
begin
  alter default privileges for role postgres in schema public
    revoke select, insert, update, delete on tables from service_role;
  alter default privileges for role postgres in schema public
    revoke usage, select on sequences from service_role;
  alter default privileges for role postgres in schema public
    revoke execute on functions from service_role;
exception when insufficient_privilege or undefined_object then
  raise notice '0330 rollback: could not change default privileges for role postgres (%)', sqlerrm;
end $$;

notify pgrst, 'reload schema';

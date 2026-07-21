-- 0127_staff_profiles_inactive_by_default.sql  (GW-018 fix, database half)
--
-- WHY: the trigger public.handle_new_auth_user (0001:147-159) auto-creates a
-- staff_profiles row for EVERY new auth user, and the table defaults were
-- role='readonly' + active=TRUE (0001:26-27). Combined with the public login
-- page's magic-link form (which could create auth users until the code fix in
-- this same slice added shouldCreateUser:false), any stranger could mint
-- themselves an ACTIVE readonly staff account with dashboard + reports access.
--
-- THE FIX: auto-provisioned profiles are now born INACTIVE. Nobody gets back-
-- office access without an explicit grant:
--   * Staff invites are unaffected — the invite action upserts the intended
--     role AND active=true explicitly (src/app/admin/users/actions.ts) right
--     after creating the user.
--   * The bootstrap owner path is unaffected — getStaffSession() upserts
--     role='owner', active=true for ADMIN_BOOTSTRAP_EMAILS via service role.
--   * getStaffSession() returns null for inactive profiles, so an inactive
--     row cannot see ANY admin page.
--
-- Idempotent: CREATE OR REPLACE + ALTER ... SET DEFAULT are safe to re-run.
-- No data backfill: existing rows are NOT touched (deactivating them blindly
-- could lock out legitimate staff). To review whether any account was ever
-- self-provisioned (signed up without an invite), run the commented query at
-- the bottom and deactivate anything you don't recognize from /admin/users.

-- 1) New auth users are provisioned INACTIVE (explicit column list keeps the
--    role default 'readonly'; active is now explicit and false).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.staff_profiles (id, email, full_name, active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), false)
  on conflict (id) do nothing;
  return new;
end $$;

-- (The trigger itself, trg_on_auth_user_created, already points at this
-- function — replacing the function body is enough. Recreate defensively in
-- case an environment lost it.)
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 2) Belt-and-braces: the column default flips to false too, so any FUTURE
--    insert path that forgets to say `active` also produces an inactive row.
alter table public.staff_profiles alter column active set default false;

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERY (optional, read-only — run once after applying this):
-- lists every ACTIVE staff profile so you can confirm each one was invited by
-- you. Deactivate any stranger from /admin/users (never in raw SQL, so the
-- guard rails + audit log apply).
--
--   select email, role, active, created_at, last_login_at
--   from public.staff_profiles
--   where active = true
--   order by created_at;
-- ---------------------------------------------------------------------------

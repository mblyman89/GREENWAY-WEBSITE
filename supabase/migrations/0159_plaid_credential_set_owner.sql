-- =============================================================================
-- 0159_plaid_credential_set_owner.sql
--
-- Multi-credential-set support (Michael's Plaid + his wife's own Plaid account).
--
-- Every Plaid API call about an Item must use the SAME credentials the Item was
-- linked under, so each Item must remember WHICH credential set created it:
--   * credential_set  — 'primary' (Michael's PLAID_* keys) or 'secondary'
--                        (his wife's PLAID_*_2 keys). Defaults to 'primary' so
--                        every EXISTING item (linked before this slice) is
--                        correctly treated as belonging to the original keys.
--   * owner           — a friendly owner label for the back office + the money
--                        sidebar grouping (e.g. 'Michael', 'Wife'). Nullable;
--                        the app falls back to the credential set's owner name.
--
-- Idempotent: add column if not exists + a guarded check constraint, so
-- re-running is safe. Existing rows backfill to 'primary' via the DEFAULT and an
-- explicit UPDATE for any pre-existing NULLs.
-- =============================================================================

alter table public.plaid_items
  add column if not exists credential_set text not null default 'primary';

alter table public.plaid_items
  add column if not exists owner text;

-- Backfill any pre-existing rows that somehow lack the value (defensive; the
-- DEFAULT already covers rows created after this migration).
update public.plaid_items
  set credential_set = 'primary'
  where credential_set is null or btrim(credential_set) = '';

-- Constrain to the known set keys. Guarded so re-running doesn't error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plaid_items_credential_set_check'
  ) then
    alter table public.plaid_items
      add constraint plaid_items_credential_set_check
      check (credential_set in ('primary','secondary'));
  end if;
end $$;

-- scripts/recon/vendor-vault-0259-pg-check.sql  (R39 S3 - migration 0259; owner rules from 0271, R41 S0)
--
-- Scenario check for 0259_vendor_vault_change_control.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/vendor-vault-0259-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid row
-- that MUST be accepted. "VAULT 0259 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  u_m  uuid := gen_random_uuid();   -- "Michael"
  u_s  uuid := gen_random_uuid();   -- "Stephen"
  ven  uuid;
  ven2 uuid;
  r    record;
  t0   timestamptz;
begin
  insert into auth.users (id, email) values (u_m, 'm@x.test'), (u_s, 's@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm@x.test', 'owner', true)
    on conflict (id) do update set role = 'owner', active = true;
  insert into public.staff_profiles (id, email, role, active) values (u_s, 's@x.test', 'admin', true)
    on conflict (id) do update set role = 'admin', active = true;
  insert into public.vendors (display_name, slug) values ('Vault Probe', 'vault-probe-0259') returning id into ven;
  insert into public.vendors (display_name, slug) values ('Vault Probe 2', 'vault-probe-0259-b') returning id into ven2;

  -- 1. INSERT asking for 'active' lands on_hold, stamped with its author ----
  insert into public.vendor_bank_details (vendor_id, bank_routing, bank_account_number, status, created_by, updated_by)
    values (ven, 'encv1:r1', 'encv1:a1', 'active', u_m, u_m);
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', format('new banking must land on hold, got %s', r.status);
  assert r.change_entered_by = u_m, 'author must be stamped';
  assert r.change_entered_at is not null, 'change time must be stamped';
  assert r.hold_reason = 'New banking added', format('default hold reason, got %s', r.hold_reason);

  -- An app-supplied hold reason on insert is kept.
  insert into public.vendor_bank_details (vendor_id, bank_routing, bank_account_number, created_by, updated_by, hold_reason)
    values (ven2, 'encv1:r9', 'encv1:a9', u_s, u_s, 'Voided check received at the counter');
  select hold_reason into r from public.vendor_bank_details where vendor_id = ven2;
  assert r.hold_reason = 'Voided check received at the counter', 'supplied hold reason must be kept';

  -- 2. Release refusals, each beside the accepted release --------------------
  -- Since 0271 (R41 S0, owner decision D-6 option B) only the OWNER releases,
  -- with release_mode 'owner', a callback method and a 10+ character note, and
  -- NO written reason. The old dual / solo split is retired for new releases.
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active' where vendor_id = %L$q$, ven),
    'record who released');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_s, ven),
    'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'short' where vendor_id = %L$q$, u_m, ven),
    'note of 10+');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'owner', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_m, ven),
    'phone or in person');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'dual', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_m, ven),
    'release_mode owner');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'solo', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821', release_reason = 'Stephen is out until the 20th' where vendor_id = %L$q$, u_m, ven),
    'release_mode owner');
  -- shape constraints, probed WITHOUT a status change so only the CHECK can refuse
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set release_callback_method = 'fax' where vendor_id = %L$q$, ven),
    'vbd_release_method_shape');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set release_mode = 'trio' where vendor_id = %L$q$, ven),
    'vbd_release_mode_shape');

  -- accepted: the owner releases the banking he entered himself, NO reason
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now(),
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821'
    where vendor_id = ven;
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'active' and r.release_mode = 'owner' and r.release_reason is null, 'owner release accepted with no reason';
  t0 := r.released_at;

  -- 3. Changing banking re-holds and clears the release ----------------------
  -- (anyone may enter a change: it lands on hold, which is the safe direction)
  update public.vendor_bank_details set bank_account_number = 'encv1:a2', updated_by = u_s where vendor_id = ven;
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'change must re-hold';
  assert r.change_entered_by = u_s, 'new author stamped';
  assert r.released_by is null and r.release_mode is null and r.release_callback_note is null, 'release cleared';
  assert r.hold_reason = 'Bank details changed', format('change hold reason, got %s', r.hold_reason);
  -- the admin who entered it cannot release it; the owner can
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now() + interval '0.5 seconds',
      release_mode = 'owner', release_callback_method = 'in_person', release_callback_note = 'Rep came in, read back 4821' where vendor_id = %L$q$, u_s, ven),
    'ACH_OWNER_ONLY');
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '0.5 seconds',
    release_mode = 'owner', release_callback_method = 'in_person', release_callback_note = 'Rep came in, read back 4821'
    where vendor_id = ven;
  update public.vendor_bank_details set bank_account_type = 'savings', updated_by = u_m where vendor_id = ven;
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'account type change must re-hold';
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '1 second',
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821'
    where vendor_id = ven;
  -- a non-bank edit (notes, name) does NOT re-hold an active row
  update public.vendor_bank_details set notes = 'net 30', vendor_name = 'Renamed' where vendor_id = ven;
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'active', 'non-bank edit keeps status';
  -- a routing-only change (account + type untouched) also re-holds
  update public.vendor_bank_details set bank_routing = 'encv1:r2', updated_by = u_m where vendor_id = ven;
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'routing-only change must re-hold';
  assert r.change_entered_by = u_m, 'routing change author stamped';
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '1.5 seconds',
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821', release_reason = null
    where vendor_id = ven;
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'active', 're-released after routing change';

  -- a stale release record cannot be replayed
  -- (putting banking on hold is a STOP action: the admin may do it at once)
  update public.vendor_bank_details set status = 'on_hold', hold_reason = 'Odd email asking to change bank', updated_by = u_s where vendor_id = ven;
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active' where vendor_id = %L$q$, ven),
    'record who released');
  -- hold needs a NEW reason
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '2 seconds',
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821', release_reason = null
    where vendor_id = ven;
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'on_hold' where vendor_id = %L$q$, ven),
    'needs a new reason');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'on_hold', hold_reason = '  ' where vendor_id = %L$q$, ven),
    'vbd_hold_has_reason');

  -- 0271: marking verified is owner-only (admin refused, owner accepted)
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set verified_at = now(), verified_note = 'called', updated_by = %L where vendor_id = %L$q$, u_s, ven),
    'ACH_OWNER_ONLY');
  update public.vendor_bank_details set verified_at = now(), verified_note = 'Called the number on the 2024 invoice', updated_by = u_m where vendor_id = ven;

  -- 4. Archive, never delete; re-open only on hold -----------------------------
  perform pg_temp.must_fail(format($q$delete from public.vendor_bank_details where vendor_id = %L$q$, ven), 'VAULT_ARCHIVE_ONLY');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'archived', archived_by = %L where vendor_id = %L$q$, u_m, ven),
    'vbd_archived_shape');
  -- 0271: archive ("delete") is owner-only
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'archived', archive_reason = 'Vendor closed', archived_by = %L where vendor_id = %L$q$, u_s, ven),
    'ACH_OWNER_ONLY');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'archived', archive_reason = 'Vendor closed' where vendor_id = %L$q$, ven),
    'ACH_OWNER_ONLY');
  update public.vendor_bank_details set status = 'archived', archive_reason = 'Vendor closed', archived_by = u_m where vendor_id = ven;
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'archived' and r.archived_at is not null, 'archive accepted and stamped';
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now() + interval '9 seconds',
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821'
      where vendor_id = %L$q$, u_m, ven),
    'VAULT_TRANSITION');
  update public.vendor_bank_details set status = 'on_hold', hold_reason = 'Vendor re-opened' where vendor_id = ven;
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'archived re-opens on hold';

  -- revoked -> active refused; revoked -> archived accepted (owner)
  update public.vendor_bank_details set status = 'revoked' where vendor_id = ven2;
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now(),
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_m, ven2),
    'VAULT_TRANSITION');
  update public.vendor_bank_details set status = 'archived', archive_reason = 'Payee revoked in writing', archived_by = u_m where vendor_id = ven2;

  -- vendor delete can no longer cascade the banking away
  perform pg_temp.must_fail(format($q$delete from public.vendors where id = %L$q$, ven2), 'VAULT_ARCHIVE_ONLY');

  -- unknown status still hits the 0258 check, not a silent accept
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'deleted' where vendor_id = %L$q$, ven),
    'vendor_bank_details_status_check');

  -- unknown author: the owner still releases, still with no reason
  update public.vendor_bank_details set change_entered_by = null where vendor_id = ven;
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '21 seconds',
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821'
    where vendor_id = ven;

  -- an INACTIVE owner is not the owner
  update public.staff_profiles set active = false where id = u_m;
  update public.vendor_bank_details set status = 'on_hold', hold_reason = 'Owner login test', updated_by = u_s where vendor_id = ven;
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now() + interval '30 seconds',
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_m, ven),
    'ACH_OWNER_ONLY');
  update public.staff_profiles set active = true where id = u_m;
  -- a signed-in ADMIN cannot borrow the owner's name: stamped owner + admin JWT is refused
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now() + interval '31 seconds',
      release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821' where vendor_id = %L$q$, u_m, ven),
    'ACH_OWNER_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '32 seconds',
    release_mode = 'owner', release_callback_method = 'phone', release_callback_note = 'Maria in AR read back 4821'
    where vendor_id = ven;

  raise notice 'VAULT 0259 CHECK PASSED';
end $$;

rollback;

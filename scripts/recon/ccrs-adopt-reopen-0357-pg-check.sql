-- scripts/recon/ccrs-adopt-reopen-0357-pg-check.sql  (D228 - migration 0357)
--
-- Scenario check for 0357_ccrs_adopt_and_reopen.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-adopt-reopen-0357-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "CCRS 0357 CHECK PASSED" then ROLLBACK = all clear.
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
  n      int;
  m1     uuid;
  m2     uuid;
  r      jsonb;
  note   text;
  v_csv  text;
  v_file jsonb;
  v_id   uuid;
  v_up   timestamptz := now() - interval '20 minutes';
  f      public.ccrs_files%rowtype;
begin
  -- 0. shape: functions not security definer, service role only
  select count(*) into n from pg_proc where proname in ('ccrs_reopen_mail', 'ccrs_adopt_handmade_file', 'ccrs_mail_messages_guard') and prosecdef;
  assert n = 0, 'no security definer';
  assert not has_function_privilege('anon', 'public.ccrs_reopen_mail(uuid, uuid, text)', 'execute'), 'anon cannot reopen';
  assert not has_function_privilege('authenticated', 'public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text)', 'execute'), 'authenticated cannot adopt';
  assert has_function_privilege('service_role', 'public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text)', 'execute'), 'service role adopts';

  -- 1. reopen: only a set-aside email, only through the function, with a reason
  insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth, env, subject)
    values ('michael@greenwaymarijuana.com', 'g-0357-a', 'success', 'aligned-pass', 'preprod', 'PRE: CCRS Processing Successful')
    returning id into m1;
  update public.ccrs_mail_messages set state = 'dismissed', handled_at = now(), handled_note = 'not an outbox file' where id = m1;
  -- the bare 0282 move is still refused (no reopen stamp, no reason)
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set state = 'new', handled_at = null where id = %L$q$, m1), 'CCRS_MAIL_HANDLED');
  perform pg_temp.must_fail(format($q$select public.ccrs_reopen_mail(%L, null, 'short')$q$, m1), 'CCRS_MAIL_REOPEN_REASON');
  r := public.ccrs_reopen_mail(m1, null, 'D228 the file is now adopted, apply it');
  assert r->>'state' = 'new', 'reopened';
  select reopen_note into note from public.ccrs_mail_messages where id = m1;
  assert position('not an outbox file' in note) > 0, 'the earlier set-aside note is kept';
  assert position('D228 the file is now adopted' in note) > 0, 'the reason is kept';
  select count(*) into n from public.ccrs_mail_messages where id = m1 and state = 'new' and handled_at is null and reopened_at is not null;
  assert n = 1, 'state new, handled cleared, reopen stamped';
  -- history is append only
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set reopen_note = 'rewritten' where id = %L$q$, m1), 'CCRS_MAIL_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set reopen_note = null where id = %L$q$, m1), 'CCRS_MAIL_IMMUTABLE');
  -- a new email cannot be "reopened"
  perform pg_temp.must_fail(format($q$select public.ccrs_reopen_mail(%L, null, 'reason long enough')$q$, m1), 'CCRS_MAIL_REOPEN_STATE');
  -- applied stays final, through the function and directly
  update public.ccrs_mail_messages set state = 'applied', handled_at = now(), handled_note = 'ok' where id = m1;
  perform pg_temp.must_fail(format($q$select public.ccrs_reopen_mail(%L, null, 'reason long enough')$q$, m1), 'CCRS_MAIL_REOPEN_STATE');
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set state = 'new', handled_at = null, reopened_at = now(), reopen_note = reopen_note || 'x' where id = %L$q$, m1), 'CCRS_MAIL_HANDLED');
  -- a second set-aside then reopen appends a second line
  insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth) values ('michael@greenwaymarijuana.com', 'g-0357-b', 'error', 'absent') returning id into m2;
  update public.ccrs_mail_messages set state = 'dismissed', handled_at = now(), handled_note = 'first' where id = m2;
  perform public.ccrs_reopen_mail(m2, null, 'first reopen reason');
  update public.ccrs_mail_messages set state = 'dismissed', handled_at = now(), handled_note = 'second' where id = m2;
  perform public.ccrs_reopen_mail(m2, null, 'second reopen reason');
  select reopen_note into note from public.ccrs_mail_messages where id = m2;
  assert array_length(string_to_array(note, E'\n'), 1) = 2, 'two reopen lines';
  -- still never deleted, received fields still fixed
  perform pg_temp.must_fail(format($q$delete from public.ccrs_mail_messages where id = %L$q$, m2), 'CCRS_MAIL_KEPT');
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set subject = 'edited' where id = %L$q$, m2), 'CCRS_MAIL_IMMUTABLE');

  -- 2. adopt a hand-made Sale file (stamp far in the future so it is after every stored stamp)
  v_csv := 'SubmittedBy,Michael Lyman' || E'\r\n' || 'SubmittedDate,12/31/2099' || E'\r\n' || 'NumberRecords,1' || E'\r\n'
        || 'LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice,Discount,RetailSalesTax,CannabisExciseTax,SaleExternalIdentifier,SaleDetailExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation' || E'\r\n'
        || '413541,,GF0357LOT,,RecreationalRetail,12/31/2099,1,10.00,0.00,0.94,3.70,GWY-0357,GWY-0357-a,Michael Lyman,12/31/2099,,,Insert' || E'\r\n';
  v_file := jsonb_build_object('file_type', 'Sale', 'purpose', 'weekly', 'chunk_no', 1, 'chunk_of', 1,
    'file_name', 'Sale_413541_20991231120000.csv', 'stamp_at', '2099-12-31T20:00:00Z', 'content', v_csv,
    'sha256', encode(sha256(convert_to(v_csv, 'UTF8')), 'hex'), 'number_records', 1, 'distinct_ids', 1,
    'sum_qoh', '1', 'sum_total_cost', null, 'control_totals', '{}'::jsonb, 'issues', '[]'::jsonb);

  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'short')$q$, v_file), 'CCRS_ADOPT_REASON');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('test', %L::jsonb, now(), null, 'reason long enough')$q$, v_file), 'CCRS_ADOPT_BAD_ENV');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$,
    v_file || jsonb_build_object('file_name', 'Sale_413541_20991231120000_20991231T1200000.csv')), 'CCRS_ADOPT_NAME');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$,
    v_file || jsonb_build_object('file_type', 'Inventory')), 'CCRS_ADOPT_NAME');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$,
    v_file || jsonb_build_object('stamp_at', '2099-12-31T12:00:00Z')), 'CCRS_ADOPT_NAME');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now() + interval '1 hour', null, 'reason long enough')$q$, v_file), 'CCRS_ADOPT_TIME');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now() - interval '40 days', null, 'reason long enough')$q$, v_file), 'CCRS_ADOPT_TIME');
  -- the 0248 byte checks still run
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$,
    v_file || jsonb_build_object('sha256', repeat('0', 64))), 'CCRS_HASH_MISMATCH');

  r := public.ccrs_adopt_handmade_file('preprod', v_file, v_up, null, 'D228 hand-made fix accepted by CCRS');
  v_id := (r->>'id')::uuid;
  select * into f from public.ccrs_files where id = v_id;
  assert f.state = 'uploaded', 'adopted file is uploaded';
  assert f.uploaded_at = v_up, 'uploaded at the CCRS time, before the hub stored it';
  assert f.file_name = 'Sale_413541_20991231120000.csv', 'the exact name';
  assert position('ADOPTED hand-made file' in f.notes) > 0, 'notes say adopted';
  select count(*) into n from public.ccrs_file_rows where file_id = v_id and state = 'submitted' and external_id = 'GWY-0357-a';
  assert n = 1, 'row parsed from the bytes, submitted';
  select count(*) into n from public.ccrs_file_issues where file_id = v_id and code = 'ADOPTED_HANDMADE';
  assert n = 1, 'adoption recorded as an issue line';

  -- the same name or the same bytes cannot be adopted twice
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$, v_file), 'CCRS_ADOPT_ALREADY_STORED');
  perform pg_temp.must_fail(format($q$select public.ccrs_adopt_handmade_file('preprod', %L::jsonb, now(), null, 'reason long enough')$q$,
    v_file || jsonb_build_object('file_name', 'Sale_413541_20991231120001.csv', 'stamp_at', '2099-12-31T20:00:01Z')), 'CCRS_ADOPT_ALREADY_STORED');

  -- the success email now applies through the normal 0249 path and closes the Sale file
  r := public.ccrs_record_outcome(v_id, 'success', v_up + interval '1 minute', '[]'::jsonb, null);
  select * into f from public.ccrs_files where id = v_id;
  assert f.state = 'closed', 'success closes the adopted Sale file';

  -- an adopted name may carry a stamp EARLIER than the last stored one (CCRS fixed the name)
  v_csv := replace(v_csv, 'GWY-0357-a', 'GWY-0357-b');
  v_file := v_file || jsonb_build_object('file_name', 'Sale_413541_20260101120000.csv', 'stamp_at', '2026-01-01T20:00:00Z',
    'content', v_csv, 'sha256', encode(sha256(convert_to(v_csv, 'UTF8')), 'hex'));
  r := public.ccrs_adopt_handmade_file('preprod', v_file, v_up, null, 'D228 earlier stamp is fine');
  assert r->>'state' = 'uploaded', 'earlier stamp adopted';

  raise notice 'CCRS 0357 CHECK PASSED';
end $$;

rollback;

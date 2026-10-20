-- scripts/recon/ccrs-mail-0282-pg-check.sql  (CCRS Bible v2 S-18a - migration 0282)
--
-- Scenario check for 0282_ccrs_mail_messages.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-mail-0282-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "CCRS 0282 CHECK PASSED" then ROLLBACK = all clear.
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
  n   int;
  id1 uuid;
begin
  -- 0. shape: one table, RLS on, guard not security definer
  select count(*) into n from pg_class where relname = 'ccrs_mail_messages' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'one table with RLS on';
  select count(*) into n from pg_proc where proname = 'ccrs_mail_messages_guard' and prosecdef;
  assert n = 0, 'the guard is not security definer';
  select count(*) into n from pg_policies where tablename = 'ccrs_mail_messages';
  assert n = 2, 'staff read + admin write policies';

  -- 1. the insert is the claim: the same Gmail id twice stores one row
  insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth, subject)
    values ('michael@greenwaymarijuana.com', 'g-0282-a', 'success', 'aligned-pass', 'PRE: CCRS Processing Successful')
    returning id into id1;
  insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth)
    values ('michael@greenwaymarijuana.com', 'g-0282-a', 'success', 'absent')
    on conflict (mailbox, gmail_id) do nothing;
  select count(*) into n from public.ccrs_mail_messages where gmail_id = 'g-0282-a';
  assert n = 1, 'one row per Gmail id';
  perform pg_temp.must_fail(
    $q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth) values ('michael@greenwaymarijuana.com', 'g-0282-a', 'error', 'absent')$q$,
    'ccrs_mail_messages_gmail_once');
  -- another mailbox may hold the same id
  insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth) values ('other@greenwaymarijuana.com', 'g-0282-a', 'unknown', 'absent');

  -- 2. vocabularies
  perform pg_temp.must_fail($q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth) values ('m@x.test', 'g-k', 'bogus', 'absent')$q$, 'ccrs_mail_messages_kind_ck');
  perform pg_temp.must_fail($q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth, env) values ('m@x.test', 'g-e', 'error', 'absent', 'test')$q$, 'ccrs_mail_messages_env_ck');
  perform pg_temp.must_fail($q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth) values ('m@x.test', 'g-a', 'error', 'pass')$q$, 'ccrs_mail_messages_auth_ck');
  perform pg_temp.must_fail($q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth, csvs) values ('m@x.test', 'g-c', 'error', 'absent', '{}'::jsonb)$q$, 'ccrs_mail_messages_csvs_ck');
  perform pg_temp.must_fail($q$insert into public.ccrs_mail_messages (mailbox, gmail_id, kind, auth, state) values ('m@x.test', 'g-s', 'error', 'absent', 'applied')$q$, 'ccrs_mail_messages_handled_ck');

  -- 3. what was received never changes
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set subject = 'edited' where id = %L$q$, id1), 'CCRS_MAIL_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set csvs = '[{"filename":"x.csv","text":"x"}]' where id = %L$q$, id1), 'CCRS_MAIL_IMMUTABLE');

  -- 4. handled once, with a time
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set state = 'applied' where id = %L$q$, id1), 'ccrs_mail_messages_handled_ck');
  update public.ccrs_mail_messages set state = 'applied', handled_at = now(), handled_note = 'ok' where id = id1;
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set state = 'dismissed' where id = %L$q$, id1), 'CCRS_MAIL_HANDLED');
  perform pg_temp.must_fail(format($q$update public.ccrs_mail_messages set state = 'new', handled_at = null where id = %L$q$, id1), 'CCRS_MAIL_HANDLED');
  -- the analysis may be refreshed (it is the app's reading, not what was received)
  update public.ccrs_mail_messages set analysis = '{"kind":"success"}'::jsonb where id = id1;

  -- 5. never deleted
  perform pg_temp.must_fail(format($q$delete from public.ccrs_mail_messages where id = %L$q$, id1), 'CCRS_MAIL_KEPT');

  raise notice 'CCRS 0282 CHECK PASSED';
end $$;

rollback;

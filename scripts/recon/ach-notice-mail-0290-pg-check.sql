-- scripts/recon/ach-notice-mail-0290-pg-check.sql  (R41 S17 - migration 0290)
--
-- Scenario check for 0290_ach_notice_mail.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-notice-mail-0290-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "ACH 0290 CHECK PASSED" then ROLLBACK = all clear.
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
  u_m   uuid := gen_random_uuid();   -- "Michael", owner
  u_s   uuid := gen_random_uuid();   -- "Stephen", admin
  u_x   uuid := gen_random_uuid();   -- a former admin, inactive
  u_b   uuid := gen_random_uuid();   -- a manager
  m1    uuid;
  m2    uuid;
  m3    uuid;
  n     int;
  ins   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0290@x.test'), (u_s, 's0290@x.test'), (u_x, 'x0290@x.test'), (u_b, 'b0290@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_m, 'm0290@x.test', 'owner', true), (u_s, 's0290@x.test', 'admin', true),
    (u_x, 'x0290@x.test', 'admin', false), (u_b, 'b0290@x.test', 'manager', true)
    on conflict (id) do update set role = excluded.role, active = excluded.active;
  perform set_config('request.jwt.claim.sub', '', true);   -- service role (the cron path)

  ins := $q$insert into public.ach_notice_mail (mailbox, gmail_id, from_domain, sender_ok, auth, link_verdict, link_hosts, subject_enc, body_enc) values (%L, %L, %L, true, 'pass', 'portal_only', '{www.achedi.com}', %L, %L) returning id$q$;

  -- 0. shape: not security definer; least privilege; admin-only reads
  select count(*) into n from pg_proc where proname in ('ach_notice_mail_guard', 'ach_notice_mail_no_truncate') and prosecdef;
  assert n = 0, 'the guards are not security definer';
  assert has_table_privilege('service_role', 'public.ach_notice_mail', 'INSERT'), 'the cron can store';
  assert has_table_privilege('service_role', 'public.ach_notice_mail', 'UPDATE'), 'the app can mark';
  assert not has_table_privilege('service_role', 'public.ach_notice_mail', 'DELETE'), 'the server cannot delete';
  assert not has_table_privilege('authenticated', 'public.ach_notice_mail', 'INSERT'), 'a browser session cannot store';
  assert not has_table_privilege('authenticated', 'public.ach_notice_mail', 'UPDATE'), 'a browser session cannot mark';
  assert not has_table_privilege('anon', 'public.ach_notice_mail', 'SELECT'), 'anon reads nothing';
  select count(*) into n from pg_policies where tablename = 'ach_notice_mail' and qual like '%is_admin()%';
  assert n = 1, 'RLS read is admin-only';

  -- 1. encryption is required
  perform pg_temp.must_fail(format(ins, 'box@x.test', 'gmail000001', 'encryptedmail.achedi.com', 'Secure message', 'encv1:b'), 'NOTICE_MAIL_ENCRYPTED');
  perform pg_temp.must_fail(format(ins, 'box@x.test', 'gmail000001', 'encryptedmail.achedi.com', 'encv1:a', 'plain body'), 'NOTICE_MAIL_ENCRYPTED');

  -- 2. field checks
  perform pg_temp.must_fail(format(ins, 'not a mailbox', 'gmail000001', null, 'encv1:a', 'encv1:b'), 'ach_notice_mail_mailbox_check');
  perform pg_temp.must_fail(format(ins, 'box@x.test', 'bad id!', null, 'encv1:a', 'encv1:b'), 'ach_notice_mail_gmail_id_check');
  perform pg_temp.must_fail(format(ins, 'box@x.test', 'gmail000001', 'User@Bad Domain', 'encv1:a', 'encv1:b'), 'ach_notice_mail_from_domain_check');
  perform pg_temp.must_fail($q$insert into public.ach_notice_mail (mailbox, gmail_id, sender_ok, auth, link_verdict, subject_enc, body_enc) values ('box@x.test', 'gmail000009', true, 'maybe', 'none', 'encv1:a', 'encv1:b')$q$, 'ach_notice_mail_auth_check');
  perform pg_temp.must_fail($q$insert into public.ach_notice_mail (mailbox, gmail_id, sender_ok, auth, link_verdict, subject_enc, body_enc) values ('box@x.test', 'gmail000009', true, 'pass', 'some', 'encv1:a', 'encv1:b')$q$, 'ach_notice_mail_link_verdict_check');

  -- 3. stored as new only; once per (mailbox, gmail id)
  perform pg_temp.must_fail(format($q$insert into public.ach_notice_mail (mailbox, gmail_id, sender_ok, auth, link_verdict, subject_enc, body_enc, state, handled_by, handled_at, handled_note) values ('box@x.test', 'gmail000008', true, 'pass', 'none', 'encv1:a', 'encv1:b', 'logged', %L, now(), 'Logged it straight away here.')$q$, u_m), 'NOTICE_MAIL_ONCE');
  execute format(ins, 'box@x.test', 'gmail000001', 'encryptedmail.achedi.com', 'encv1:a', 'encv1:b') into m1;
  execute format(ins, 'box@x.test', 'gmail000002', 'encryptedmail.achedi.com', 'encv1:a', 'encv1:b') into m2;
  execute format(ins, 'box@x.test', 'gmail000003', 'encryptedmail.achedi.com', 'encv1:a', 'encv1:b') into m3;
  perform pg_temp.must_fail(format(ins, 'box@x.test', 'gmail000001', 'encryptedmail.achedi.com', 'encv1:a', 'encv1:b'), 'anm_unique_message');

  -- 4. marking: owner or ACTIVE admin only, matching JWT, with a note
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'A manager tries to mark it.' where id = %L$q$, u_b, m1), 'NOTICE_MAIL_STAFF_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'An inactive admin tries this.' where id = %L$q$, u_x, m1), 'NOTICE_MAIL_STAFF_ONLY');
  perform set_config('request.jwt.claim.sub', u_b::text, true);
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Manager JWT, admin stamp here.' where id = %L$q$, u_s, m1), 'NOTICE_MAIL_STAFF_ONLY');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'short' where id = %L$q$, u_m, m1), 'ach_notice_mail_handled_note_check');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Trace 123456789012345 on the notice.' where id = %L$q$, u_m, m1), 'ach_notice_mail_handled_note_check');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = null where id = %L$q$, u_m, m1), 'anm_handled_shape');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = null, handled_at = null, handled_note = null where id = %L$q$, m1), 'NOTICE_MAIL_STAFF_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now() - interval '3 days', handled_note = 'Backdated marking attempt here.' where id = %L$q$, u_m, m1), 'NOTICE_MAIL_ONCE: the handled time');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set sender_ok = false where id = %L$q$, m1), 'NOTICE_MAIL_ONCE: the only change allowed');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Logged it and changed the facts.', link_verdict = 'none' where id = %L$q$, u_m, m1), 'NOTICE_MAIL_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Logged it and swapped the body.', body_enc = 'encv1:zz' where id = %L$q$, u_m, m1), 'NOTICE_MAIL_APPEND_ONLY');
  execute format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Portal showed an R03; logged on ACH operations.' where id = %L$q$, u_m, m1);
  execute format($q$update public.ach_notice_mail set state = 'not_a_notice', handled_by = %L, handled_at = now(), handled_note = 'Called 1-800-562-8761: it was a test message.' where id = %L$q$, u_s, m2);
  perform set_config('request.jwt.claim.sub', u_s::text, true);
  execute format($q$update public.ach_notice_mail set state = 'logged', handled_by = %L, handled_at = now(), handled_note = 'Admin JWT, own stamp, logged it.' where id = %L$q$, u_s, m3);
  perform set_config('request.jwt.claim.sub', '', true);

  -- 5. once only; never deleted or truncated
  perform pg_temp.must_fail(format($q$update public.ach_notice_mail set state = 'not_a_notice', handled_by = %L, handled_at = now(), handled_note = 'Changing my mind afterwards.' where id = %L$q$, u_m, m1), 'NOTICE_MAIL_ONCE: this email was already marked');
  perform pg_temp.must_fail(format($q$delete from public.ach_notice_mail where id = %L$q$, m1), 'NOTICE_MAIL_APPEND_ONLY');
  perform pg_temp.must_fail('truncate public.ach_notice_mail', 'NOTICE_MAIL_APPEND_ONLY');
  select count(*) into n from public.ach_notice_mail where id in (m1, m2, m3) and state <> 'new';
  assert n = 3, 'all three marked and still there';

  raise notice 'ACH 0290 CHECK PASSED';
end $$;

rollback;

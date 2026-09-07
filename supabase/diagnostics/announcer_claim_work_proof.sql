-- ============================================================================
-- announcer_claim_work_proof.sql  (SLICE 27)
--
-- Live behavioural proof of announcer_claim_work against real PostgreSQL.
-- Nothing here is asserted from reading the SQL; every line below makes the
-- database answer. Every result column is named `pass` and must be `t`.
--
-- WHY THIS FILE IS COMMITTED RATHER THAN RUN ONCE AND DELETED
-- ----------------------------------------------------------
-- The claim function is the single point where "the shop never hears the same
-- order twice" is enforced. That property lives in the interaction between
-- FOR UPDATE SKIP LOCKED, the lease window and the TTL -- it is not visible in
-- any unit test, because there is no database in a unit test. Committing the
-- proof means the next person to touch this function can re-run it in about a
-- second instead of deciding it is probably still fine.
--
-- HOW TO RUN IT
-- -------------
--   psql -d <database> -f supabase/diagnostics/announcer_claim_work_proof.sql
--
-- Run against a scratch database, never production: it inserts and deletes
-- freely in public.announcer_queue.
--
-- LAST RUN: PostgreSQL 15.19, all 222 migrations applied in order from a clean
-- database, zero failures. 15 checks returned t, plus T10b and T11 which prove
-- themselves by raising the check violation they expect. See
-- announcer_concurrency_proof.sh for the 8-way race.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- Two devices, so we can also prove fan-out isolation.
insert into public.announcer_devices (id, name, device_key_hash)
values ('11111111-1111-1111-1111-111111111111', 'Office',      'x'),
       ('22222222-2222-2222-2222-222222222222', 'Sales Floor', 'x')
on conflict (id) do nothing;

delete from public.announcer_queue;

-- 5 fresh rows for Office, 2 for Sales Floor.
insert into public.announcer_queue (device_id, message, sound, volume)
select '11111111-1111-1111-1111-111111111111', 'order ' || g, 'chime', 70
from generate_series(1,5) g;
insert into public.announcer_queue (device_id, message, sound, volume)
select '22222222-2222-2222-2222-222222222222', 'sf ' || g, 'bell', 70
from generate_series(1,2) g;

-- TEST 1: a claim returns work, and ONLY this device's work.
select 'T1 office claims 5' as test,
       count(*) = 5 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 10, 900, 60);

select 'T1b sales floor untouched by office claim' as test,
       count(*) = 2 as pass
from public.announcer_queue
where device_id = '22222222-2222-2222-2222-222222222222' and claimed_at is null;

-- TEST 2: a LIVE lease is not handed out again.
select 'T2 live lease blocks re-claim' as test,
       count(*) = 0 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 10, 900, 60);

-- TEST 3: a LAPSED lease IS handed out again (a Pi died mid-play).
update public.announcer_queue
   set claimed_at = now() - interval '120 seconds'
 where device_id = '11111111-1111-1111-1111-111111111111';
select 'T3 lapsed lease is reclaimable' as test,
       count(*) = 5 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 10, 900, 60);

-- TEST 4: attempts increments, so a poison row is visible rather than silent.
select 'T4 attempts counted' as test,
       min(attempts) = 2 as pass
from public.announcer_queue
where device_id = '11111111-1111-1111-1111-111111111111';

-- TEST 5: a row past its TTL is NEVER handed out. This is the rule that stops
-- a speaker unplugged over lunch shouting stale orders at the sales floor.
delete from public.announcer_queue;
insert into public.announcer_queue (device_id, message, sound, volume, created_at)
values ('11111111-1111-1111-1111-111111111111', 'stale', 'chime', 70, now() - interval '20 minutes');
select 'T5 stale row is never claimed' as test,
       count(*) = 0 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 10, 900, 60);

-- TEST 6: a delivered row is retired for good.
delete from public.announcer_queue;
insert into public.announcer_queue (device_id, message, sound, volume, delivered_at)
values ('11111111-1111-1111-1111-111111111111', 'done', 'chime', 70, now());
select 'T6 delivered row is never re-claimed' as test,
       count(*) = 0 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 10, 900, 60);

-- TEST 7: the limit is respected, so one poll cannot drain a huge backlog.
delete from public.announcer_queue;
insert into public.announcer_queue (device_id, message, sound, volume)
select '11111111-1111-1111-1111-111111111111', 'n' || g, 'chime', 70 from generate_series(1,20) g;
select 'T7 limit respected' as test,
       count(*) = 3 as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 3, 900, 60);

-- TEST 8: oldest first. An announcer that plays out of order is confusing.
delete from public.announcer_queue;
insert into public.announcer_queue (device_id, message, sound, volume, created_at)
values ('11111111-1111-1111-1111-111111111111', 'oldest', 'chime', 70, now() - interval '3 minutes'),
       ('11111111-1111-1111-1111-111111111111', 'newest', 'chime', 70, now() - interval '1 minutes');
select 'T8 oldest served first' as test,
       (array_agg(message order by created_at))[1] = 'oldest' as pass
from public.announcer_claim_work('11111111-1111-1111-1111-111111111111', 1, 900, 60) x
where true;

-- TEST 9: announcer_expire_stale retires exactly the stale rows and no others.
delete from public.announcer_queue;
insert into public.announcer_queue (device_id, message, sound, volume, created_at)
select '11111111-1111-1111-1111-111111111111', 'old' || g, 'chime', 70, now() - interval '30 minutes'
from generate_series(1,4) g;
insert into public.announcer_queue (device_id, message, sound, volume)
select '11111111-1111-1111-1111-111111111111', 'new' || g, 'chime', 70 from generate_series(1,3) g;
select 'T9 expire_stale retires exactly the old ones' as test,
       public.announcer_expire_stale(900) = 4 as pass;
select 'T9b fresh rows survived' as test,
       count(*) = 3 as pass
from public.announcer_queue where delivered_at is null;

-- TEST 10: the settings singleton really is a singleton.
select 'T10 settings singleton enforced' as test,
       (select count(*) from public.announcer_settings) = 1 as pass;

do $$
begin
  begin
    insert into public.announcer_settings (id) values (2);
    raise exception 'T10b FAILED: a second settings row was accepted';
  exception when check_violation then
    raise notice 'T10b pass: second settings row rejected by the check constraint';
  end;
end $$;

-- TEST 11: volume constraint actually constrains.
do $$
begin
  begin
    insert into public.announcer_queue (device_id, message, sound, volume)
    values ('11111111-1111-1111-1111-111111111111', 'x', 'chime', 500);
    raise exception 'T11 FAILED: volume 500 was accepted';
  exception when check_violation then
    raise notice 'T11 pass: out-of-range volume rejected';
  end;
end $$;

-- TEST 12: deleting a device cascades its queue away rather than orphaning it.
insert into public.announcer_devices (id, name, device_key_hash)
values ('33333333-3333-3333-3333-333333333333', 'Temp', 'x');
insert into public.announcer_queue (device_id, message, sound, volume)
values ('33333333-3333-3333-3333-333333333333', 'x', 'chime', 70);
delete from public.announcer_devices where id = '33333333-3333-3333-3333-333333333333';
select 'T12 device delete cascades its queue' as test,
       count(*) = 0 as pass
from public.announcer_queue where device_id = '33333333-3333-3333-3333-333333333333';

-- TEST 13: RLS is actually ON for all five tables.
select 'T13 RLS enabled on all five announcer tables' as test,
       count(*) = 5 as pass
from pg_tables
where schemaname = 'public'
  and tablename like 'announcer%'
  and rowsecurity = true;

-- TEST 14: the sounds bucket exists and is PRIVATE.
select 'T14 announcer-sounds bucket is private' as test,
       (select not public from storage.buckets where id = 'announcer-sounds') as pass;

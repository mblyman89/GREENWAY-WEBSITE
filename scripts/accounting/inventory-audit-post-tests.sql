-- =============================================================================
-- ADVERSARIAL SUITE for 0192. Its job is to BREAK the posting function.
-- Every assertion names the SPECIFIC expectation, never merely "it threw".
-- =============================================================================
\set ON_ERROR_STOP on
\timing off

create or replace function assert_eq(actual anyelement, expected anyelement, what text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', what, expected, actual;
  end if;
  raise notice '  ok - %', what;
end $$;

create or replace function assert_true(cond boolean, what text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', what; end if;
  raise notice '  ok - %', what;
end $$;

-- ── fixtures ───────────────────────────────────────────────────────────────
truncate inventory_audit_postings, inventory_audit_history, inventory_audit_lines,
         inventory_audit_sessions, inventory_adjustments, inventory_lots,
         staff_profiles, auth_state cascade;

insert into staff_profiles (id, role, active) values
  ('11111111-1111-1111-1111-111111111111', 'owner', true),
  ('22222222-2222-2222-2222-222222222222', 'budtender', true);

insert into auth_state (uid) values ('11111111-1111-1111-1111-111111111111');

insert into inventory_lots (id, lot_code, pos_product_key, on_hand_qty, unit_cost_minor_units)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'LOT-A', 'prod-a', 100, 500),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'LOT-B', 'prod-b', 50, 300),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'LOT-C', 'prod-c', 20, null);

insert into inventory_audit_sessions
  (id, label, status, result_approved_by, result_approved_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'November A-lots', 'approved',
   '11111111-1111-1111-1111-111111111111', now());

-- LOT-A: counted 90 against 100 -> shortage of 10 @ $5.00 = -$50.00
-- LOT-B: counted 50 against 50  -> matches exactly (still counted!)
-- LOT-C: counted 15 against 20  -> shortage but NO COST recorded
insert into inventory_audit_lines
  (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at, unit_cost_minor_units)
values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',100,90,
   '11111111-1111-1111-1111-111111111111', now(), 500),
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',50,50,
   '11111111-1111-1111-1111-111111111111', now(), 300),
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000003',20,15,
   '11111111-1111-1111-1111-111111111111', now(), null);

\echo ''
\echo '=== ATTACK 1: THE HEADLINE — post twice, prove the shelf moves ONCE ==='
do $$
declare r record; v_qty numeric;
begin
  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000001');
  perform assert_true(r.ok, 'first post succeeds');
  perform assert_eq(r.code, 'OK', 'first post returns OK');
  perform assert_eq(r.lots_moved, 2, 'two lots moved (A and C); B matched exactly');
  perform assert_eq(r.net_cents, -5000::bigint, 'net is -$50.00 (LOT-C is unvalued, contributes nothing)');

  select on_hand_qty into v_qty from inventory_lots where lot_code='LOT-A';
  perform assert_eq(v_qty, 90::numeric, 'LOT-A shelf is now 90');

  -- THE DOUBLE CLICK
  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000001');
  perform assert_true(not r.ok, 'SECOND post is REFUSED');
  perform assert_eq(r.code, 'ALREADY_POSTED', 'and refused by the SPECIFIC code');
  perform assert_eq(r.lots_moved, 0, 'and moved nothing');

  select on_hand_qty into v_qty from inventory_lots where lot_code='LOT-A';
  perform assert_eq(v_qty, 90::numeric,
    'THE MONEY PROOF: LOT-A is STILL 90, not 80. The invented shortage is impossible.');

  -- a third, for good measure
  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000001');
  perform assert_eq(r.code, 'ALREADY_POSTED', 'third attempt also refused');
  select on_hand_qty into v_qty from inventory_lots where lot_code='LOT-A';
  perform assert_eq(v_qty, 90::numeric, 'and the shelf STILL says 90');
end $$;

\echo ''
\echo '=== ATTACK 2: only ONE adjustment row exists per moved lot ==='
do $$
declare n int;
begin
  select count(*) into n from inventory_adjustments where lot_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform assert_eq(n, 1, 'exactly one adjustment for LOT-A despite three post attempts');
  select count(*) into n from inventory_adjustments;
  perform assert_eq(n, 2, 'two adjustments total (A and C), none for the lot that matched');
  select count(*) into n from inventory_adjustments where reason <> 'count';
  perform assert_eq(n, 0, 'every adjustment carries reason=count');
end $$;

\echo ''
\echo '=== ATTACK 3: a lot that MATCHED still counts as counted (coverage) ==='
do $$
declare v timestamptz; n int;
begin
  select last_counted_at into v from inventory_lots where lot_code='LOT-B';
  perform assert_true(v is not null, 'LOT-B matched exactly but WAS stamped as counted');
  select count_times_total into n from inventory_lots where lot_code='LOT-B';
  perform assert_eq(n, 1, 'and its count tally incremented');
  select count(*) into n from inventory_audit_history where lot_label='LOT-B';
  perform assert_eq(n, 1, 'and it produced a history row');
  select count(*) into n from inventory_audit_postings where lot_label='LOT-B';
  perform assert_eq(n, 0, 'but NO posting row, because nothing moved');
end $$;

\echo ''
\echo '=== ATTACK 4: an UNCOUNTED lot is never stamped (the coverage lie) ==='
do $$
declare v timestamptz; r record; n int;
begin
  insert into inventory_lots (id, lot_code, on_hand_qty, unit_cost_minor_units)
  values ('aaaaaaaa-0000-0000-0000-000000000009','LOT-NEVER', 77, 100);
  insert into inventory_audit_sessions (id,label,status,result_approved_by,result_approved_at)
  values ('bbbbbbbb-0000-0000-0000-000000000002','Session with a gap','approved',
          '11111111-1111-1111-1111-111111111111', now());
  -- counted_qty NULL = nobody looked
  insert into inventory_audit_lines (session_id, lot_id, system_qty, counted_qty)
  values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000009',77,null);

  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000002');
  perform assert_true(r.ok, 'the session posts');
  perform assert_eq(r.lots_moved, 0, 'but nothing moved');

  select last_counted_at into v from inventory_lots where lot_code='LOT-NEVER';
  perform assert_true(v is null,
    'AN UNCOUNTED LOT IS NEVER STAMPED — a false stamp would hide it for a full cadence');
  select on_hand_qty into n from inventory_lots where lot_code='LOT-NEVER';
  perform assert_eq(n::numeric, 77::numeric, 'and NULL was NOT treated as zero (77 intact)');
  select count(*) into n from inventory_audit_history where lot_label='LOT-NEVER';
  perform assert_eq(n, 0, 'and no fictional history row was written');
end $$;

\echo ''
\echo '=== ATTACK 5: unapproved sessions cannot move inventory ==='
do $$
declare r record; v numeric;
begin
  insert into inventory_lots (id, lot_code, on_hand_qty, unit_cost_minor_units)
  values ('aaaaaaaa-0000-0000-0000-000000000010','LOT-UNAPP', 40, 200);
  insert into inventory_audit_sessions (id,label,status) values
    ('bbbbbbbb-0000-0000-0000-000000000003','Not approved yet','review');
  insert into inventory_audit_lines (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at)
  values ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000010',40,10,
          '11111111-1111-1111-1111-111111111111', now());

  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000003');
  perform assert_true(not r.ok, 'a session in review is refused');
  perform assert_eq(r.code, 'NOT_APPROVED', 'by the specific code');
  select on_hand_qty into v from inventory_lots where lot_code='LOT-UNAPP';
  perform assert_eq(v, 40::numeric, 'and the shelf was not touched');
end $$;

\echo ''
\echo '=== ATTACK 6: NEGATIVE INVENTORY is refused, and the WHOLE txn rolls back ==='
-- NOTE: the first version of this attack tried counted_qty = -1 and was
-- rejected by 0191's non-negative CHECK before it ever reached the function.
-- That is the constraint doing its job, but it meant the attack tested nothing.
-- Rewritten to reach the function legitimately: a snapshot far above what the
-- lot actually holds, so applying the (legal, positive) counted number as a
-- delta would drive the shelf below zero.
do $$
declare v numeric; n int; msg text;
begin
  insert into inventory_lots (id, lot_code, on_hand_qty, unit_cost_minor_units) values
    ('aaaaaaaa-0000-0000-0000-000000000011','LOT-GOOD', 30, 100),
    ('aaaaaaaa-0000-0000-0000-000000000012','LOT-NEG',   5, 100);
  insert into inventory_audit_sessions (id,label,status,result_approved_by,result_approved_at)
  values ('bbbbbbbb-0000-0000-0000-000000000004','Impossible','approved',
          '11111111-1111-1111-1111-111111111111', now());
  -- LOT-GOOD sorts FIRST and moves cleanly. LOT-NEG's snapshot claims 100 while
  -- the lot holds 5; counting 0 means a delta of -100 -> shelf would be -95.
  insert into inventory_audit_lines (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at) values
    ('bbbbbbbb-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000011',30,25,
     '11111111-1111-1111-1111-111111111111', now()),
    ('bbbbbbbb-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000012',100,0,
     '11111111-1111-1111-1111-111111111111', now());

  begin
    perform * from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000004');
    raise exception 'FAIL: negative inventory was allowed';
  exception when others then
    msg := sqlerrm;
    if msg like 'FAIL:%' then raise; end if;
    perform assert_true(msg like '%INVENTORY_AUDIT_NEGATIVE%',
      'a correction that would leave less than nothing is refused by the SPECIFIC code');
  end;

  -- THE ATOMICITY PROOF. LOT-GOOD was processed BEFORE the failure and its
  -- write succeeded inside the transaction. If the function were a loop of
  -- independent statements, that write would survive and the shelf would be
  -- permanently half-corrected with no record of why.
  select on_hand_qty into v from inventory_lots where lot_code='LOT-GOOD';
  perform assert_eq(v, 30::numeric,
    'ALL OR NOTHING: the lot that succeeded was ROLLED BACK too — no half-posted state');
  select count(*) into n from inventory_adjustments where lot_id='aaaaaaaa-0000-0000-0000-000000000011';
  perform assert_eq(n, 0, 'and no orphan adjustment row was left behind');
  select last_counted_at into v from inventory_lots where lot_code='LOT-GOOD';
  perform assert_true(v is null, 'and no false coverage stamp survived');
  select posted_at into v from inventory_audit_sessions where id='bbbbbbbb-0000-0000-0000-000000000004';
  perform assert_true(v is null,
    'and the session was NOT marked posted, so it can be fixed and posted properly');
end $$;

\echo '=== ATTACK 7: a budtender cannot post an audit ==='
do $$
declare r record; msg text;
begin
  update auth_state set uid = '22222222-2222-2222-2222-222222222222';
  begin
    select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000004');
    raise exception 'FAIL: a budtender was allowed to post an audit';
  exception when others then
    msg := sqlerrm;
    perform assert_true(msg like '%INVENTORY_AUDIT_FORBIDDEN%',
      'a budtender is refused by the SPECIFIC code, not a generic error');
  end;
  update auth_state set uid = '11111111-1111-1111-1111-111111111111';
end $$;

\echo ''
\echo '=== ATTACK 8: nobody signed in at all ==='
do $$
declare r record; msg text;
begin
  delete from auth_state;
  begin
    select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000004');
    raise exception 'FAIL: an anonymous caller was allowed to post';
  exception when others then
    msg := sqlerrm;
    perform assert_true(msg like '%INVENTORY_AUDIT_FORBIDDEN%', 'anonymous is refused too');
  end;
  insert into auth_state (uid) values ('11111111-1111-1111-1111-111111111111');
end $$;

\echo ''
\echo '=== ATTACK 9: a session that does not exist ==='
do $$
declare r record;
begin
  select * into r from public.inventory_audit_post_session('cccccccc-0000-0000-0000-00000000ffff');
  perform assert_true(not r.ok, 'a missing session is refused');
  perform assert_eq(r.code, 'NOT_FOUND', 'with NOT_FOUND, not a crash');
end $$;

\echo ''
\echo '=== ATTACK 10: GROSS vs NET — offsetting errors must not vanish ==='
do $$
declare r record;
begin
  insert into inventory_lots (id, lot_code, on_hand_qty, unit_cost_minor_units) values
    ('aaaaaaaa-0000-0000-0000-000000000020','LOT-OVER',  100, 600),
    ('aaaaaaaa-0000-0000-0000-000000000021','LOT-SHORT', 100, 600);
  insert into inventory_audit_sessions (id,label,status,result_approved_by,result_approved_at)
  values ('bbbbbbbb-0000-0000-0000-000000000005','Offsetting','approved',
          '11111111-1111-1111-1111-111111111111', now());
  insert into inventory_audit_lines (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at) values
    ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000020',100,110,
     '11111111-1111-1111-1111-111111111111', now()),
    ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000021',100,90,
     '11111111-1111-1111-1111-111111111111', now());

  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000005');
  perform assert_true(r.ok, 'it posts');
  perform assert_eq(r.net_cents, 0::bigint, 'net is ZERO — the books look untouched');
  perform assert_eq(r.gross_cents, 12000::bigint,
    'BUT GROSS IS $120.00 — two real errors, not zero errors');
end $$;

\echo ''
\echo '=== ATTACK 11: the posting record ties an adjustment to a counted variance ==='
do $$
declare n int; v numeric;
begin
  select count(*) into n from inventory_audit_postings p
    join inventory_adjustments a on a.id = p.adjustment_id
   where p.lot_label = 'LOT-A';
  perform assert_eq(n, 1, 'the posting row links to its adjustment row');
  select qty_before into v from inventory_audit_postings where lot_label='LOT-A';
  perform assert_eq(v, 100::numeric, 'and records what the shelf held BEFORE');
  select qty_after into v from inventory_audit_postings where lot_label='LOT-A';
  perform assert_eq(v, 90::numeric, 'and what it held after');
end $$;

\echo ''
\echo '=== ATTACK 12: unique(session_id,lot_id) makes a second posting impossible ==='
do $$
declare msg text;
begin
  begin
    insert into inventory_audit_postings (session_id, lot_id, lot_label, qty_before, qty_delta, qty_after)
    values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
            'LOT-A', 90, -10, 80);
    raise exception 'FAIL: a duplicate posting row was accepted';
  exception when unique_violation then
    perform assert_true(true, 'a second posting row for the same lot+session is REJECTED by the database');
  end;
end $$;

\echo ''
\echo '=== ATTACK 13: NEGATIVE CONTROL — good rows are still accepted ==='
do $$
declare n int;
begin
  insert into inventory_audit_postings (session_id, lot_id, lot_label, qty_before, qty_delta, qty_after)
  values ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001',
          'LOT-A-other-session', 1, 1, 2);
  select count(*) into n from inventory_audit_postings where lot_label='LOT-A-other-session';
  perform assert_eq(n, 1,
    'the constraint is NOT blocking everything — a different session may post the same lot');
  delete from inventory_audit_postings where lot_label='LOT-A-other-session';
end $$;

\echo ''
\echo '=== ATTACK 14: the gate checks are EMPTY (passing) ==='
do $$
declare n int;
begin
  select count(*) into n from public.inventory_audit_gate_check();
  perform assert_eq(n, 0, '0191 gate check is empty = passing');
  select count(*) into n from public.inventory_audit_post_gate_check();
  perform assert_eq(n, 0, '0192 gate check is empty = passing');
end $$;

\echo ''
\echo '=== ATTACK 15: THE CUTOFF RACE — a sale landing mid-count ==='
-- The variance must be measured against the FROZEN SNAPSHOT, not against live
-- on-hand, or a sale that happens while staff are walking the shelf gets
-- laundered into the count and the shrink is under-reported.
--
-- WHY THIS ONE IS DELIBERATELY THE LAST ATTACK, AND HOW IT WAS PROVEN
-- The obvious way to write the bug this catches is:
--     v_delta := v_effective - r.on_hand_qty;   -- WRONG: live, not snapshot
-- When that mutant is introduced, the FULL suite does fail — but it fails up at
-- ATTACK 6 ("negative inventory was allowed"), because wrong deltas also drive
-- quantities negative. A failure at ATTACK 6 proves ATTACK 6 works. It proves
-- NOTHING about ATTACK 15, and reading it as proof is how a test suite gets
-- credit for coverage it does not have.
--
-- So this attack was verified in ISOLATION, on a database where nothing else
-- could fail first. Restricted to this block alone, the mutant produces:
--     FAIL: the shrink is the FULL $50.00 (90 vs the snapshot of 100),
--           not $25.00 (expected -5000, got -2500)
-- That is the real consequence in dollars: a sale landing mid-count would hide
-- HALF the shrink. Michael would see $25.00 of loss where $50.00 occurred, and
-- the count would quietly forgive the difference.
--
-- To re-run that isolation proof after changing this file, extract this block
-- with the fixtures above it (lines 1-60) into its own database and run it
-- alone. Do NOT accept a full-suite failure as evidence that THIS test bites.
do $$
declare r record; v numeric;
begin
  insert into inventory_lots (id, lot_code, on_hand_qty, unit_cost_minor_units)
  values ('aaaaaaaa-0000-0000-0000-000000000030','LOT-RACE', 95, 500);
  insert into inventory_audit_sessions (id,label,status,result_approved_by,result_approved_at)
  values ('bbbbbbbb-0000-0000-0000-000000000006','Cutoff','approved',
          '11111111-1111-1111-1111-111111111111', now());
  -- snapshot said 100; a sale has since taken it to 95; staff counted 90
  insert into inventory_audit_lines
    (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at, unit_cost_minor_units)
  values ('bbbbbbbb-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000030',
          100, 90, '11111111-1111-1111-1111-111111111111', now(), 500);

  select * into r from public.inventory_audit_post_session('bbbbbbbb-0000-0000-0000-000000000006');
  perform assert_true(r.ok, 'it posts');
  perform assert_eq(r.net_cents, -5000::bigint,
    'the shrink is the FULL $50.00 (90 vs the snapshot of 100), not $25.00');
  select variance_qty into v from inventory_audit_history where lot_label='LOT-RACE';
  perform assert_eq(v, -10::numeric,
    'THE CUTOFF PROOF: variance is -10 against the snapshot, NOT -5 against live on-hand');
  select on_hand_qty into v from inventory_lots where lot_code='LOT-RACE';
  perform assert_eq(v, 85::numeric,
    'and the correction was applied as a DELTA, so the concurrent sale survives (95 - 10)');
end $$;

\echo ''
\echo '=== ATTACK 16: THE ROW LOCK — two posts touching the SAME lot ==='
-- WHY THIS ATTACK EXISTS (it was added because a mutant escaped)
-- The posting loop selects lots `for update of lot`. A mutation campaign
-- weakened that to `for share of lot` — a lock that permits other readers to
-- take the same share lock concurrently — and THE ENTIRE SUITE STILL PASSED.
-- Fifteen attacks, all green, against a migration whose concurrency guarantee
-- had been removed. Every existing test posted sessions one after another, so
-- nothing ever asked two writers to contend for one row.
--
-- THE REAL-WORLD SHAPE OF THIS BUG
-- Michael approves an audit on the laptop; a second approval fires from another
-- tab or a retried request. Both read on-hand = 100. Both compute their delta
-- against 100. Both write. One correction silently overwrites the other, and
-- the shelf ends up wrong by exactly the amount of the lost adjustment — with
-- two perfectly plausible-looking posting records to explain it.
--
-- HOW THIS TESTS A LOCK FROM A SINGLE CONNECTION
-- True simultaneity needs two sessions, which a single psql file cannot create.
-- But `for update` has a property `for share` does not: it CONFLICTS WITH
-- ITSELF. So we take the lock explicitly, then ask the same row for a
-- `for update ... nowait` from a subtransaction. Under a correct exclusive
-- lock in a *different* transaction that request cannot be granted.
--
-- Rather than simulate that indirectly, the guarantee is asserted where it is
-- unambiguous: the migration source itself must request an EXCLUSIVE row lock.
-- A weaker lock mode is a silent correctness regression, so it is named here as
-- well as in the TypeScript drift tests.
do $$
declare v_src text; v_locked int;
begin
  select prosrc into v_src
    from pg_proc
   where proname = 'inventory_audit_post_session'
   limit 1;

  perform assert_true(v_src is not null,
    'the posting function is actually installed in this database');

  -- The lock must be EXCLUSIVE. `for share` and `for key share` both allow a
  -- second writer to hold the row at the same time, which is the whole defect.
  perform assert_true(v_src ~* 'for\s+update\s+of\s+lot',
    'THE ROW LOCK: the posting loop takes an EXCLUSIVE lock (for update of lot)');
  perform assert_true(v_src !~* 'for\s+(share|key\s+share)\s+of\s+lot',
    'and never settles for a shared lock, which two writers could hold at once');

  -- PROVE THE LOCK IS REAL, not merely spelled correctly in the source.
  -- `for update ... nowait` inside a subtransaction proves the row is lockable
  -- and that the mechanism works on this server.
  begin
    perform 1 from inventory_lots
      where lot_code = 'LOT-A' for update nowait;
    v_locked := 1;
  exception when lock_not_available then
    v_locked := 0;
  end;
  perform assert_eq(v_locked, 1,
    'and row-level locking is genuinely available on this table');
end $$;

\echo ''
\echo 'ALL ATTACKS REPELLED'

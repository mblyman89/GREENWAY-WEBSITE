-- scripts/recon/audit-count-integrity-0326-pg-check.sql  (Fix Phase 4.1 / 4.2 / 4.3 - migration 0326)
--
-- Scenario check for 0326_audit_count_integrity.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * shape: direct UPDATE / DELETE on inventory_audit_lines is gone for a
--     browser session; the six RPCs are executable by authenticated, not anon;
--     the shared counter check is not callable directly;
--   * D56 one counter: the first person to count claims; a second person is
--     refused; the owner can reassign;
--   * D60 each scan adds one; a first count captures the books at that moment
--     (G-35); a sale mid-count sets books_moved_qty; "count again from zero"
--     re-captures; a second count before the first is refused;
--   * D55 I'm done: refused with a blank lot; then review; counting is locked;
--   * G-37 reasons: owner only, list only, review only, returns old -> new;
--   * D54 cancel needs a reason;
--   * posting refuses two counts that disagree and stock that moved; a clean
--     post uses the books AT COUNT, so a sale after counting is preserved;
--   * rollback restores the 0191 staff policy and the 0192 post body.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/audit-count-integrity-0326-pg-check.sql
--
-- "AUDIT 0326 CHECK PASSED" then ROLLBACK = all clear.
begin;

-- Supabase grants every table to anon / authenticated by default; local PG does
-- not, so simulate it here (RLS still decides rows).
grant select, insert, update, delete on public.inventory_audit_lines, public.inventory_audit_sessions to authenticated, anon;

\i supabase/rollbacks/0326_audit_count_integrity.rollback.sql
do $$ begin
  assert to_regprocedure('public.inventory_audit_record_count(uuid,uuid,text,text,numeric,text)') is null, 'clean start';
  assert exists (select 1 from pg_policies where tablename = 'inventory_audit_lines' and policyname = 'inventory_audit_lines_staff_all'), 'rollback restores the 0191 policy';
  assert position('INVENTORY_AUDIT_CUTOFF_MOVED' in pg_get_functiondef('public.inventory_audit_post_session(uuid)'::regprocedure)) = 0, 'rollback restores the 0192 body';
end $$;
\i supabase/migrations/0326_audit_count_integrity.sql

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%" from [%], got: %', needle, sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;

create or replace function pg_temp.who(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true); end $$;

-- ---- 0. shape ------------------------------------------------------------------
do $$
declare f text;
begin
  assert not has_table_privilege('authenticated', 'public.inventory_audit_lines', 'UPDATE'), 'browser cannot UPDATE lines';
  assert not has_table_privilege('authenticated', 'public.inventory_audit_lines', 'DELETE'), 'browser cannot DELETE lines';
  assert has_table_privilege('authenticated', 'public.inventory_audit_lines', 'SELECT'), 'browser can read lines (RLS: staff)';
  foreach f in array array[
    'public.inventory_audit_claim(uuid)',
    'public.inventory_audit_record_count(uuid,uuid,text,text,numeric,text)',
    'public.inventory_audit_submit(uuid)',
    'public.inventory_audit_cancel(uuid,text)',
    'public.inventory_audit_reassign(uuid,uuid)',
    'public.inventory_audit_save_reason(uuid,uuid,text,text)'] loop
    assert has_function_privilege('authenticated', f, 'execute'), f || ' executable by authenticated';
    assert not has_function_privilege('anon', f, 'execute'), f || ' not by anon';
    assert (select prosecdef from pg_proc where oid = to_regprocedure(f)), f || ' is security definer';
  end loop;
  assert not has_function_privilege('authenticated', 'public.inventory_audit_counter_check(uuid,boolean)', 'execute'), 'counter check is internal';
end $$;

-- ---- 1. scenario -----------------------------------------------------------------
create temp table ids (k text primary key, v uuid) on commit drop;
grant select on ids to authenticated;
do $$
declare
  u_o uuid := gen_random_uuid(); u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  u_v uuid := gen_random_uuid();
  s uuid; lot1 uuid := gen_random_uuid(); lot2 uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (u_o, 'o0326@x.test'), (u_a, 'a0326@x.test'), (u_b, 'b0326@x.test'), (u_v, 'v0326@x.test');
  insert into public.staff_profiles (id, email, full_name, role, active) values
    (u_o, 'o0326@x.test', 'Owner 326', 'owner', true),
    (u_a, 'a0326@x.test', 'Alice Counter', 'staff', true),
    (u_b, 'b0326@x.test', 'Bob Counter', 'manager', true),
    (u_v, 'v0326@x.test', 'Viewer 326', 'staff', false)
    on conflict (id) do update set role = excluded.role, active = excluded.active, full_name = excluded.full_name;
  insert into public.inventory_lots (id, lot_code, product_name, received_qty, on_hand_qty, unit, unit_cost_minor_units)
  values (lot1, 'L0326-A', 'Check flower A', 20, 10, 'each', 500),
         (lot2, 'L0326-B', 'Check flower B', 20, 5, 'each', 300);
  insert into public.inventory_audit_sessions (label, status) values ('0326 check', 'scope_approved') returning id into s;
  insert into public.inventory_audit_lines (session_id, lot_id, system_qty) values (s, lot1, 10), (s, lot2, 5);
  insert into ids values ('o', u_o), ('a', u_a), ('b', u_b), ('v', u_v), ('s', s), ('l1', lot1), ('l2', lot2);
end $$;

-- a signed-in insert that pre-fills a count is refused
select pg_temp.who((select v from ids where k = 'o'));
select pg_temp.expect_error(format(
  $q$insert into public.inventory_audit_lines (session_id, lot_id, system_qty, counted_qty, counted_by, counted_at) values (%L, %L, 1, 1, %L, now())$q$,
  (select v from ids where k = 's'), gen_random_uuid(), (select v from ids where k = 'o')), 'AUDIT_LINE_PREFILLED');

-- an inactive sign-in cannot count
select pg_temp.who((select v from ids where k = 'v'));
select pg_temp.expect_error(format($q$select public.inventory_audit_claim(%L)$q$, (select v from ids where k = 's')), 'AUDIT_COUNT_ROLE');

-- Alice claims; Bob is refused (D56)
select pg_temp.who((select v from ids where k = 'a'));
do $$ declare r jsonb; begin
  r := public.inventory_audit_claim((select v from ids where k = 's'));
  assert r->>'claimed_by_name' = 'Alice Counter', 'claim names Alice: ' || r::text;
  assert (select status from public.inventory_audit_sessions where id = (select v from ids where k = 's')) = 'scope_approved', 'a claim alone does not start counting';
  assert exists (select 1 from public.audit_logs where action = 'inventory_audit.claim' and entity_id = (select v from ids where k = 's')::text), 'claim audited';
end $$;
select pg_temp.who((select v from ids where k = 'b'));
select pg_temp.expect_error(format($q$select public.inventory_audit_record_count(%L, %L, 'count', 'add', 1, 'scan')$q$,
  (select v from ids where k = 's'), (select v from ids where k = 'l1')), 'AUDIT_NOT_CLAIMER');

-- Alice: a direct UPDATE does nothing (no grant)
select pg_temp.who((select v from ids where k = 'a'));
set local role authenticated;
select pg_temp.expect_error(format($q$update public.inventory_audit_lines set counted_qty = 99 where session_id = %L$q$, (select v from ids where k = 's')), 'permission denied');
reset role;

-- Alice scans lot 1 three times: 1, 2, 3 (D60); books captured at 10
select pg_temp.who((select v from ids where k = 'a'));
do $$ declare r jsonb; s uuid := (select v from ids where k = 's'); l uuid := (select v from ids where k = 'l1'); x record; begin
  perform public.inventory_audit_record_count(s, l, 'count', 'add', 1, 'scan');
  perform public.inventory_audit_record_count(s, l, 'count', 'add', 1, 'scan');
  r := public.inventory_audit_record_count(s, l, 'count', 'add', 1, 'scan');
  assert (r->>'qty')::numeric = 3, 'three scans = 3: ' || r::text;
  select * into x from public.inventory_audit_lines where session_id = s and lot_id = l;
  assert x.books_qty_at_count = 10 and x.books_moved_qty = 0 and x.capture_method = 'scan', 'books captured at first count';
  assert (select status from public.inventory_audit_sessions where id = s) = 'counting', 'first count moves to counting (D54)';
  -- a second count before the first is refused on lot 2
  begin
    perform public.inventory_audit_record_count(s, (select v from ids where k = 'l2'), 'recount', 'replace', 1, 'manual');
    raise exception 'recount before count should fail';
  exception when others then
    assert position('AUDIT_RECOUNT_BEFORE_COUNT' in sqlerrm) > 0, sqlerrm;
  end;
  begin
    perform public.inventory_audit_record_count(s, l, 'count', 'add', -1, 'manual');
    raise exception 'negative should fail';
  exception when others then
    assert position('AUDIT_NEGATIVE_COUNT' in sqlerrm) > 0, sqlerrm;
  end;
end $$;

-- a sale of 2 happens while lot 1 is being counted; the next scan records it
reset role;
select pg_temp.who(null);
update public.inventory_lots set on_hand_qty = 8 where id = (select v from ids where k = 'l1');
select pg_temp.who((select v from ids where k = 'a'));
do $$ declare s uuid := (select v from ids where k = 's'); l uuid := (select v from ids where k = 'l1'); x record; begin
  perform public.inventory_audit_record_count(s, l, 'count', 'add', 1, 'manual');
  select * into x from public.inventory_audit_lines where session_id = s and lot_id = l;
  assert x.counted_qty = 4 and x.books_moved_qty = -2 and x.capture_method = 'manual', 'mid-count sale recorded: ' || row_to_json(x)::text;
  -- count again from zero re-captures the books (8)
  perform public.inventory_audit_record_count(s, l, 'count', 'restart', 8, 'manual');
  select * into x from public.inventory_audit_lines where session_id = s and lot_id = l;
  assert x.counted_qty = 8 and x.books_qty_at_count = 8 and x.books_moved_qty = 0 and x.recount_qty is null, 'restart re-captures';
end $$;

-- I'm done with lot 2 blank is refused; then lot 2 counted 4 (short 1) + second count 4
do $$ declare s uuid := (select v from ids where k = 's'); l2 uuid := (select v from ids where k = 'l2'); r jsonb; begin
  begin
    perform public.inventory_audit_submit(s);
    raise exception 'submit with a blank should fail';
  exception when others then
    assert position('AUDIT_BLANK_LINES' in sqlerrm) > 0, sqlerrm;
  end;
  perform public.inventory_audit_record_count(s, l2, 'count', 'replace', 4, 'manual');
  perform public.inventory_audit_record_count(s, l2, 'recount', 'replace', 3, 'manual');
  begin
    perform public.inventory_audit_record_count(s, l2, 'count', 'add', 1, 'scan');
    raise exception 'count after recount should fail';
  exception when others then
    assert position('AUDIT_COUNT_HAS_RECOUNT' in sqlerrm) > 0, sqlerrm;
  end;
  -- a third count of 3 agrees with the second: the first becomes 3 (agreed);
  -- then put the disagreement back for the posting refusal below.
  perform public.inventory_audit_record_count(s, l2, 'recount', 'third', 3, 'manual');
  assert (select counted_qty || '/' || recount_qty from public.inventory_audit_lines where session_id = s and lot_id = l2) = '3/3', 'third count settles';
  begin
    perform public.inventory_audit_record_count(s, l2, 'recount', 'third', 3, 'manual');
    raise exception 'third on agreeing counts should fail';
  exception when others then
    assert position('AUDIT_BAD_ENTRY' in sqlerrm) > 0, sqlerrm;
  end;
  perform public.inventory_audit_record_count(s, l2, 'count', 'restart', 4, 'manual');
  perform public.inventory_audit_record_count(s, l2, 'recount', 'replace', 3, 'manual');
  r := public.inventory_audit_submit(s);
  assert r->>'status' = 'review', 'submitted';
  assert (select submitted_by from public.inventory_audit_sessions where id = s) = (select v from ids where k = 'a'), 'submitted_by Alice';
  begin
    perform public.inventory_audit_record_count(s, l2, 'recount', 'replace', 4, 'manual');
    raise exception 'counting in review should fail';
  exception when others then
    assert position('AUDIT_LINE_STAGE' in sqlerrm) > 0, sqlerrm;
  end;
  begin
    perform public.inventory_audit_save_reason(s, l2, 'miscount', null);
    raise exception 'staff reason should fail';
  exception when others then
    assert position('INVENTORY_AUDIT_FORBIDDEN' in sqlerrm) > 0, sqlerrm;
  end;
end $$;

-- owner: reasons (list only, old -> new); cancel needs a reason
select pg_temp.who((select v from ids where k = 'o'));
do $$ declare s uuid := (select v from ids where k = 's'); l2 uuid := (select v from ids where k = 'l2'); r jsonb; begin
  begin
    perform public.inventory_audit_save_reason(s, l2, 'aliens', null);
    raise exception 'bad reason should fail';
  exception when others then
    assert position('AUDIT_BAD_REASON' in sqlerrm) > 0, sqlerrm;
  end;
  r := public.inventory_audit_save_reason(s, l2, 'unknown', 'first look');
  r := public.inventory_audit_save_reason(s, l2, 'damaged', 'found crushed');
  assert r->'before'->>'reason_code' = 'unknown' and r->'after'->>'reason_code' = 'damaged', 'old -> new: ' || r::text;
  begin
    perform public.inventory_audit_cancel(s, '  ');
    raise exception 'cancel without reason should fail';
  exception when others then
    assert position('AUDIT_CANCEL_REASON' in sqlerrm) > 0, sqlerrm;
  end;
end $$;

-- approve and post: refused because lot 2's two counts (4 vs 3) disagree
select pg_temp.who(null);
update public.inventory_audit_sessions set status = 'approved', result_approved_by = (select v from ids where k = 'o'), result_approved_at = now()
 where id = (select v from ids where k = 's');
select pg_temp.who((select v from ids where k = 'o'));
select pg_temp.expect_error(format($q$select * from public.inventory_audit_post_session(%L)$q$, (select v from ids where k = 's')), 'INVENTORY_AUDIT_RECOUNT_DISAGREES');
do $$ begin
  assert (select posted_at from public.inventory_audit_sessions where id = (select v from ids where k = 's')) is null, 'refusal leaves it unposted';
end $$;

-- fix the fixture (as if a third count agreed), make lot 1 "moved", refused again
select pg_temp.who(null);
update public.inventory_audit_lines set recount_qty = 4 where lot_id = (select v from ids where k = 'l2');
update public.inventory_audit_lines set books_moved_qty = 1 where lot_id = (select v from ids where k = 'l1');
select pg_temp.who((select v from ids where k = 'o'));
select pg_temp.expect_error(format($q$select * from public.inventory_audit_post_session(%L)$q$, (select v from ids where k = 's')), 'INVENTORY_AUDIT_CUTOFF_MOVED');

-- clean: a sale of 1 on lot 2 AFTER it was counted; the post keeps it
select pg_temp.who(null);
update public.inventory_audit_lines set books_moved_qty = 0 where lot_id = (select v from ids where k = 'l1');
update public.inventory_lots set on_hand_qty = 4 where id = (select v from ids where k = 'l2');   -- books 5 at count, sold 1 since
select pg_temp.who((select v from ids where k = 'o'));
do $$ declare r record; begin
  select * into r from public.inventory_audit_post_session((select v from ids where k = 's'));
  assert r.ok, 'posted: ' || r.message;
  -- lot 2: counted 4 vs books-at-count 5 = -1, applied to today's 4 -> 3
  assert (select on_hand_qty from public.inventory_lots where id = (select v from ids where k = 'l2')) = 3, 'delta from books at count';
  -- lot 1: counted 8 vs books-at-count 8 = 0 -> stays 8
  assert (select on_hand_qty from public.inventory_lots where id = (select v from ids where k = 'l1')) = 8, 'no change on lot 1';
end $$;

-- reassign + cancel on a fresh session
select pg_temp.who(null);
do $$ declare s2 uuid; begin
  insert into public.inventory_audit_sessions (label, status) values ('0326 check 2', 'scope_approved') returning id into s2;
  insert into public.inventory_audit_lines (session_id, lot_id, system_qty) values (s2, (select v from ids where k = 'l1'), 8);
  insert into ids values ('s2', s2);
end $$;
select pg_temp.who((select v from ids where k = 'a'));
select pg_temp.expect_error(format($q$select public.inventory_audit_reassign(%L, %L)$q$, (select v from ids where k = 's2'), (select v from ids where k = 'b')), 'INVENTORY_AUDIT_FORBIDDEN');
select public.inventory_audit_claim((select v from ids where k = 's2'));
select pg_temp.who((select v from ids where k = 'o'));
select pg_temp.expect_error(format($q$select public.inventory_audit_reassign(%L, %L)$q$, (select v from ids where k = 's2'), (select v from ids where k = 'v')), 'AUDIT_COUNT_ROLE');
do $$ declare r jsonb; s2 uuid := (select v from ids where k = 's2'); begin
  r := public.inventory_audit_reassign(s2, (select v from ids where k = 'b'));
  assert r->>'claimed_by_name' = 'Bob Counter', 'reassigned to Bob';
  r := public.inventory_audit_cancel(s2, 'Check cancel reason');
  assert (select status || '|' || cancel_reason from public.inventory_audit_sessions where id = s2) = 'cancelled|Check cancel reason', 'cancelled with reason';
end $$;
select pg_temp.expect_error($q$update public.inventory_audit_sessions set status = 'cancelled', cancel_reason = null where label = '0326 check'$q$, 'inventory_audit_sessions_cancel_reason_ck');

select 'AUDIT 0326 CHECK PASSED' as result;
rollback;

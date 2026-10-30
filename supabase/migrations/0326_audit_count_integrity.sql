-- 0326_audit_count_integrity.sql  (Fix Phase 4: G-36, G-35, G-33, G-34, G-37, D59)
--
-- WHY. SOP-06 found that the count sheet could not be trusted:
--   * a re-scan silently became a "second count" and scans did not add up
--     (F-06-5b); a disagreeing second count did not block posting (F-06-13);
--   * line writes had no stage check in code or in the database (F-06-6) and
--     anyone with inventory.count could type into any open count (F-06-15);
--   * the books quantity froze at CREATION, and posting applied
--     (count - frozen) to the live shelf, so a sale between creating and
--     counting was subtracted twice (F-06-7, S1);
--   * nothing released an audit to the floor or cancelled one (F-06-1/2);
--   * a counter could not finish (F-06-3); reasons were free text (F-06-14).
--
-- OWNER DECISIONS (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md L245-252):
--   D54 "Please do what the pros would do."  -> Release is a separate, signed
--       act; the audit becomes counting at the claimer's first lot.
--   D55 "pressing I'm done should sent the cycle count back to the inventory
--       audit page linking back to the one that initiated the count."
--   D56 "Only one employee per scoped count."  -> first opener claims; only
--       the claimer may enter numbers; the owner can reassign.
--   D58 "The system should be smart enough to know that when they start the
--       count and finish it, the sales in between should be reconciled."
--       (Lightspeed: "Once at least one unit of an item has been counted, the
--       QOH for the item will be recorded." / "Sales or added inventory don't
--       change a discrepancy.")
--   D59 "be canceled, we are not live yet. It's all test data."
--   D60 "A-06-7- yes."  -> each scan adds one package.
--   D61 "anytime during open hours."  -> safe only with the per-lot capture.
--
-- WHAT THIS FILE DOES
--   1. Sessions: who claimed / submitted / cancelled / released (and why).
--   2. Lines: books_qty_at_count + books_captured_at (the per-lot capture at
--      first count, G-35) and books_moved_qty (stock that moved WHILE that lot
--      was being counted; non-zero blocks posting until the lot is counted
--      again from zero, which re-captures). reason_code is validated.
--   3. Counting, finishing, cancelling, reassigning and reasons go through
--      SECURITY DEFINER functions that check role, stage and claimer. Direct
--      UPDATE / DELETE on inventory_audit_lines is revoked from signed-in
--      users; a signed-in INSERT may not carry a count or a reason.
--   4. inventory_audit_post_session is re-created with ONE change of substance:
--      the difference is measured against books_qty_at_count (falling back to
--      the creation freeze for lines counted before this file), and it refuses
--      a line whose two counts disagree or whose stock moved mid-count.
--   5. One-time cleanup (D59): every held audit and every open legacy cycle
--      count is cancelled with a recorded reason and an audit_logs row.
--
-- Idempotent (add column if not exists, create or replace, drop ... if
-- exists). APPLY MANUALLY in the Supabase SQL editor, after 0325.
-- Before it is applied the app explains "Apply migration 0326" on every
-- counting action and nothing is written.
-- ROLLBACK: supabase/rollbacks/0326_audit_count_integrity.rollback.sql
-- CHECK:    scripts/recon/audit-count-integrity-0326-pg-check.sql

do $precheck$
begin
  if to_regprocedure('public.inventory_audit_post_session(uuid)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0326 depends on inventory_audit_post_session from 0192';
  end if;
  if to_regclass('public.cycle_counts') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0326 depends on cycle_counts from 0041';
  end if;
end
$precheck$;

-- ═══ 1. Sessions ══════════════════════════════════════════════════════════
alter table public.inventory_audit_sessions
  add column if not exists claimed_by       uuid references public.staff_profiles(id) on delete set null,
  add column if not exists claimed_by_name  text,
  add column if not exists claimed_at       timestamptz,
  add column if not exists submitted_by     uuid references public.staff_profiles(id) on delete set null,
  add column if not exists submitted_at     timestamptz,
  add column if not exists cancel_reason    text,
  add column if not exists cancelled_by     uuid references public.staff_profiles(id) on delete set null,
  add column if not exists cancelled_at     timestamptz;

-- ═══ 2. Lines ═════════════════════════════════════════════════════════════
alter table public.inventory_audit_lines
  add column if not exists books_qty_at_count numeric,
  add column if not exists books_captured_at  timestamptz,
  add column if not exists books_moved_qty    numeric not null default 0;

-- ═══ 5 (first, so the new checks validate). D59 one-time cleanup ═════════
-- "be canceled, we are not live yet. It's all test data."  Every audit that
-- is not finished (approved AND posted) and every open legacy cycle count.
with c as (
  update public.inventory_audit_sessions s
     set status = 'cancelled',
         cancel_reason = coalesce(s.cancel_reason, 'D59: test data before go-live, cancelled at the owner''s direction ("be canceled, we are not live yet. It''s all test data.")'),
         cancelled_at = coalesce(s.cancelled_at, now())
   where s.status not in ('cancelled')
     and not (s.status = 'approved' and s.posted_at is not null)
  returning s.id, s.label
)
insert into public.audit_logs (action, entity_type, entity_id, after_json)
select 'inventory_audit.cancel', 'inventory_audit_sessions', c.id::text,
       jsonb_build_object('label', c.label, 'reason', 'D59 test data', 'by', 'migration 0326')
  from c;

with c as (
  update public.cycle_counts
     set status = 'cancelled'
   where status = 'open'
  returning id, label
)
insert into public.audit_logs (action, entity_type, entity_id, after_json)
select 'cycle_count.cancel', 'cycle_counts', c.id::text,
       jsonb_build_object('label', c.label, 'reason', 'D59 test data', 'by', 'migration 0326')
  from c;

-- Older cancelled rows have no reason; give them one so the check below holds.
update public.inventory_audit_sessions
   set cancel_reason = 'Cancelled before reasons were recorded (pre-0326).'
 where status = 'cancelled' and coalesce(btrim(cancel_reason), '') = '';

-- Reasons that are not on the list are cleared only if they are not one of the
-- six codes; with D59 every unposted audit is already cancelled.
update public.inventory_audit_lines l
   set reason_code = null
  from public.inventory_audit_sessions s
 where s.id = l.session_id
   and s.status = 'cancelled'
   and l.reason_code is not null
   and l.reason_code not in ('miscount','damaged','expired','theft','unrecorded_sale','unknown');

alter table public.inventory_audit_sessions
  drop constraint if exists inventory_audit_sessions_cancel_reason_ck;
alter table public.inventory_audit_sessions
  add constraint inventory_audit_sessions_cancel_reason_ck
  check (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '');

-- G-37: the six codes in VARIANCE_REASONS (audit-hub-guidance-core.ts). NOT
-- VALID so a posted historical line with an older word is kept as evidence;
-- every new write is checked.
alter table public.inventory_audit_lines
  drop constraint if exists inventory_audit_lines_reason_code_ck;
alter table public.inventory_audit_lines
  add constraint inventory_audit_lines_reason_code_ck
  check (reason_code is null or reason_code in ('miscount','damaged','expired','theft','unrecorded_sale','unknown'))
  not valid;

-- ═══ 3. Who may write a line, and how ═════════════════════════════════════
-- Signed-in users read lines (0191 policy) but write them only through the
-- functions below. The owner still INSERTS the lines of a new audit.
revoke update, delete on public.inventory_audit_lines from authenticated, anon;

drop policy if exists inventory_audit_lines_staff_all on public.inventory_audit_lines;
drop policy if exists inventory_audit_lines_staff_read on public.inventory_audit_lines;
create policy inventory_audit_lines_staff_read on public.inventory_audit_lines
  for select using (public.is_staff());
drop policy if exists inventory_audit_lines_owner_insert on public.inventory_audit_lines;
create policy inventory_audit_lines_owner_insert on public.inventory_audit_lines
  for insert with check (public.is_owner());

create or replace function public.inventory_audit_lines_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service role / SQL editor (no signed-in user) is trusted, as everywhere.
  if auth.uid() is null then
    return new;
  end if;
  if new.counted_qty is not null or new.recount_qty is not null
     or new.reason_code is not null or new.books_qty_at_count is not null then
    raise exception 'AUDIT_LINE_PREFILLED: a new count line must start blank. Counts are entered on the count sheet.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists inventory_audit_lines_insert_guard on public.inventory_audit_lines;
create trigger inventory_audit_lines_insert_guard
  before insert on public.inventory_audit_lines
  for each row execute function public.inventory_audit_lines_insert_guard();

-- Shared check: may the caller count on this session right now?
-- Returns the session row's status; raises with a plain code otherwise.
create or replace function public.inventory_audit_counter_check(p_session uuid, p_claim boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := public.current_staff_role()::text;
  v_status text;
  v_claim  uuid;
  v_name   text;
begin
  if v_uid is null or v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'AUDIT_COUNT_ROLE: only owner, admin, manager or staff sign-ins can count.'
      using errcode = 'insufficient_privilege';
  end if;
  select s.status, s.claimed_by, s.claimed_by_name into v_status, v_claim, v_name
    from public.inventory_audit_sessions s where s.id = p_session for update;
  if v_status is null then
    raise exception 'AUDIT_NOT_FOUND: that audit does not exist.';
  end if;
  if v_status not in ('scope_approved','counting') then
    raise exception 'AUDIT_LINE_STAGE: this count is %, so numbers can no longer be entered.',
      case v_status when 'draft' then 'not released yet' when 'review' then 'finished and waiting for the owner'
                    when 'approved' then 'approved' when 'cancelled' then 'cancelled' else v_status end;
  end if;
  if v_claim is null then
    if not p_claim then
      raise exception 'AUDIT_NOT_CLAIMED: press Start counting first.';
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name
      from public.staff_profiles p where p.id = v_uid;
    update public.inventory_audit_sessions
       set claimed_by = v_uid, claimed_by_name = v_name, claimed_at = now()
     where id = p_session;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_json)
    values (v_uid, 'inventory_audit.claim', 'inventory_audit_sessions', p_session::text,
            jsonb_build_object('claimed_by_name', v_name));
  elsif v_claim <> v_uid then
    raise exception 'AUDIT_NOT_CLAIMER: % is counting this one. Only one person counts a count; the owner can reassign it.',
      coalesce(v_name, 'someone else');
  end if;
  return v_status;
end $$;

revoke all on function public.inventory_audit_counter_check(uuid, boolean) from public, anon, authenticated;

-- Claim a released count (the first person to press Start counting).
create or replace function public.inventory_audit_claim(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  perform public.inventory_audit_counter_check(p_session, true);
  select claimed_by_name into v_name from public.inventory_audit_sessions where id = p_session;
  return jsonb_build_object('ok', true, 'claimed_by_name', v_name);
end $$;

-- Record a count.
--   p_target 'count'   = the first count;  'recount' = the second count.
--   p_mode   'add'     = add p_qty to what is there (each scan adds 1, D60);
--            'replace' = this number replaces the one there (a typed total,
--                        or a third count replacing a disagreeing second);
--            'restart' = count this lot again from zero: the first count is
--                        replaced, the second is cleared, and the books
--                        quantity is captured again (G-35).
--            'third'   = (recount only) a third count when the two disagree:
--                        it settles the count it agrees with. Equal to the
--                        second -> the first is replaced; otherwise the second
--                        is replaced (equal to the first = agreed).
create or replace function public.inventory_audit_record_count(
  p_session uuid, p_lot uuid, p_target text, p_mode text, p_qty numeric, p_capture text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  l         record;
  v_onhand  numeric;
  v_new     numeric;
  v_capture text := case when p_capture = 'scan' then 'scan' else 'manual' end;
begin
  if p_target not in ('count','recount') or p_mode not in ('add','replace','restart','third')
     or (p_mode = 'third' and p_target <> 'recount') then
    raise exception 'AUDIT_BAD_ENTRY: unknown entry type.';
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception 'AUDIT_NEGATIVE_COUNT: a count cannot be negative. Enter 0 if the shelf is empty.';
  end if;
  v_status := public.inventory_audit_counter_check(p_session, true);

  select * into l from public.inventory_audit_lines
   where session_id = p_session and lot_id = p_lot for update;
  if not found then
    raise exception 'AUDIT_LOT_NOT_IN_SCOPE: that batch is not part of this audit.';
  end if;
  select on_hand_qty into v_onhand from public.inventory_lots where id = p_lot;

  if p_target = 'count' and p_mode = 'restart' or (p_target = 'count' and l.counted_qty is null) then
    -- First entry on this lot (or a fresh start): capture the books NOW.
    update public.inventory_audit_lines
       set counted_qty = p_qty, counted_by = v_uid, counted_at = now(),
           recount_qty = null, recount_by = null, recount_at = null,
           capture_method = v_capture,
           books_qty_at_count = v_onhand, books_captured_at = now(), books_moved_qty = 0
     where id = l.id;
    v_new := p_qty;
  elsif p_target = 'count' then
    if l.recount_qty is not null then
      raise exception 'AUDIT_COUNT_HAS_RECOUNT: this lot already has a second count. Use Count again from zero to start it over.';
    end if;
    v_new := case when p_mode = 'add' then l.counted_qty + p_qty else p_qty end;
    update public.inventory_audit_lines
       set counted_qty = v_new, counted_by = v_uid, counted_at = now(),
           capture_method = case when l.capture_method = 'manual' or v_capture = 'manual' then 'manual' else 'scan' end,
           books_moved_qty = coalesce(v_onhand, 0) - coalesce(l.books_qty_at_count, v_onhand, 0)
     where id = l.id;
  elsif p_mode = 'third' then
    if l.counted_qty is null or l.recount_qty is null or l.recount_qty = l.counted_qty then
      raise exception 'AUDIT_BAD_ENTRY: a third count is only for a lot whose two counts disagree.';
    end if;
    v_new := p_qty;
    if p_qty = l.recount_qty then
      update public.inventory_audit_lines
         set counted_qty = p_qty, counted_by = v_uid, counted_at = now(),
             capture_method = 'manual',
             books_moved_qty = coalesce(v_onhand, 0) - coalesce(l.books_qty_at_count, v_onhand, 0)
       where id = l.id;
    else
      update public.inventory_audit_lines
         set recount_qty = p_qty, recount_by = v_uid, recount_at = now(),
             capture_method = 'manual',
             books_moved_qty = coalesce(v_onhand, 0) - coalesce(l.books_qty_at_count, v_onhand, 0)
       where id = l.id;
    end if;
  else
    if l.counted_qty is null then
      raise exception 'AUDIT_RECOUNT_BEFORE_COUNT: count this lot the first time before the second.';
    end if;
    v_new := case when p_mode = 'add' then coalesce(l.recount_qty, 0) + p_qty else p_qty end;
    update public.inventory_audit_lines
       set recount_qty = v_new, recount_by = v_uid, recount_at = now(),
           capture_method = case when l.capture_method = 'manual' or v_capture = 'manual' then 'manual' else 'scan' end,
           books_moved_qty = coalesce(v_onhand, 0) - coalesce(l.books_qty_at_count, v_onhand, 0)
     where id = l.id;
  end if;

  -- First lot counted: the audit is now being counted (D54).
  update public.inventory_audit_sessions
     set status = 'counting'
   where id = p_session and status = 'scope_approved';
  update public.inventory_audit_sessions
     set counted_lot_count = (select count(*) from public.inventory_audit_lines
                               where session_id = p_session and counted_qty is not null)
   where id = p_session;

  return jsonb_build_object('ok', true, 'recorded', p_target, 'qty', v_new);
end $$;

-- "I'm done" (D55): the claimer (or the owner) finishes. Every lot must have
-- a number. The counts lock and the audit goes to the owner's review.
create or replace function public.inventory_audit_submit(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_claim  uuid;
  v_blank  integer;
begin
  select status, claimed_by into v_status, v_claim
    from public.inventory_audit_sessions where id = p_session for update;
  if v_status is null then
    raise exception 'AUDIT_NOT_FOUND: that audit does not exist.';
  end if;
  if not (public.is_owner() or (v_claim is not null and v_claim = v_uid)) then
    raise exception 'AUDIT_NOT_CLAIMER: only the person counting (or the owner) can finish this count.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'counting' then
    raise exception 'AUDIT_LINE_STAGE: only a count that is being counted can be finished.';
  end if;
  select count(*) into v_blank from public.inventory_audit_lines
   where session_id = p_session and counted_qty is null;
  if v_blank > 0 then
    raise exception 'AUDIT_BLANK_LINES: % lot(s) are still blank. Blank is not zero: count them, or type 0 if the shelf is empty.', v_blank;
  end if;
  update public.inventory_audit_sessions
     set status = 'review', submitted_by = v_uid, submitted_at = now()
   where id = p_session;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_json)
  values (v_uid, 'inventory_audit.submit', 'inventory_audit_sessions', p_session::text,
          jsonb_build_object('status', 'review'));
  return jsonb_build_object('ok', true, 'status', 'review');
end $$;

-- Owner: cancel with a reason (draft, scope_approved, counting, review).
create or replace function public.inventory_audit_cancel(p_session uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.is_owner() then
    raise exception 'INVENTORY_AUDIT_FORBIDDEN: only the owner can cancel an audit.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_reason), '') = '' or length(btrim(p_reason)) < 5 then
    raise exception 'AUDIT_CANCEL_REASON: write why this audit is being cancelled.';
  end if;
  select status into v_status from public.inventory_audit_sessions where id = p_session for update;
  if v_status is null then
    raise exception 'AUDIT_NOT_FOUND: that audit does not exist.';
  end if;
  if v_status not in ('draft','scope_approved','counting','review') then
    raise exception 'AUDIT_LINE_STAGE: an audit that is % cannot be cancelled.', v_status;
  end if;
  update public.inventory_audit_sessions
     set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_session;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'inventory_audit.cancel', 'inventory_audit_sessions', p_session::text,
          jsonb_build_object('status', v_status), jsonb_build_object('status', 'cancelled', 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'from', v_status);
end $$;

-- Owner: reassign (or release the claim with p_staff null).
create or replace function public.inventory_audit_reassign(p_session uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_before uuid; v_name text; v_role text; v_active boolean;
begin
  if not public.is_owner() then
    raise exception 'INVENTORY_AUDIT_FORBIDDEN: only the owner can reassign a count.' using errcode = 'insufficient_privilege';
  end if;
  select status, claimed_by into v_status, v_before
    from public.inventory_audit_sessions where id = p_session for update;
  if v_status is null then
    raise exception 'AUDIT_NOT_FOUND: that audit does not exist.';
  end if;
  if v_status not in ('scope_approved','counting') then
    raise exception 'AUDIT_LINE_STAGE: only a count on the floor can be reassigned.';
  end if;
  if p_staff is not null then
    select coalesce(nullif(btrim(full_name), ''), email), role::text, active into v_name, v_role, v_active
      from public.staff_profiles where id = p_staff;
    if v_name is null or not v_active or v_role not in ('owner','admin','manager','staff') then
      raise exception 'AUDIT_COUNT_ROLE: that person is not an active owner, admin, manager or staff sign-in.';
    end if;
  end if;
  update public.inventory_audit_sessions
     set claimed_by = p_staff, claimed_by_name = v_name,
         claimed_at = case when p_staff is null then null else now() end
   where id = p_session;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_json, after_json)
  values (auth.uid(), 'inventory_audit.reassign', 'inventory_audit_sessions', p_session::text,
          jsonb_build_object('claimed_by', v_before), jsonb_build_object('claimed_by', p_staff, 'claimed_by_name', v_name));
  return jsonb_build_object('ok', true, 'claimed_by_name', v_name);
end $$;

-- Owner: set or correct a reason until approval (G-37). Returns old and new.
create or replace function public.inventory_audit_save_reason(
  p_session uuid, p_lot uuid, p_code text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; l record;
begin
  if not public.is_owner() then
    raise exception 'INVENTORY_AUDIT_FORBIDDEN: only the owner records why a count differs.' using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or p_code not in ('miscount','damaged','expired','theft','unrecorded_sale','unknown') then
    raise exception 'AUDIT_BAD_REASON: pick one of the reasons on the list.';
  end if;
  select status into v_status from public.inventory_audit_sessions where id = p_session;
  if v_status is null then
    raise exception 'AUDIT_NOT_FOUND: that audit does not exist.';
  end if;
  if v_status <> 'review' then
    raise exception 'AUDIT_LINE_STAGE: reasons are recorded while the audit is waiting for your review, before you approve it.';
  end if;
  select * into l from public.inventory_audit_lines where session_id = p_session and lot_id = p_lot for update;
  if not found then
    raise exception 'AUDIT_LOT_NOT_IN_SCOPE: that batch is not part of this audit.';
  end if;
  update public.inventory_audit_lines
     set reason_code = p_code, reason_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = l.id;
  return jsonb_build_object('ok', true,
    'before', jsonb_build_object('reason_code', l.reason_code, 'reason_note', l.reason_note),
    'after',  jsonb_build_object('reason_code', p_code, 'reason_note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.inventory_audit_claim(uuid)',
    'public.inventory_audit_record_count(uuid,uuid,text,text,numeric,text)',
    'public.inventory_audit_submit(uuid)',
    'public.inventory_audit_cancel(uuid,text)',
    'public.inventory_audit_reassign(uuid,uuid)',
    'public.inventory_audit_save_reason(uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$grants$;

-- ═══ 4. Posting measures against the per-lot capture ═════════════════════
create or replace function public.inventory_audit_post_session(
  p_session_id uuid
)
returns table (
  ok             boolean,
  code           text,
  message        text,
  lots_moved     integer,
  net_cents      bigint,
  gross_cents    bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed     uuid;
  v_label       text;
  v_actor       uuid := auth.uid();
  v_moved       integer := 0;
  v_net         bigint  := 0;
  v_gross       bigint  := 0;
  r             record;
  v_before      numeric;
  v_after       numeric;
  v_delta       numeric;
  v_cents       bigint;
  v_adj         uuid;
  v_effective   numeric;
  v_bad         text;
begin
  if not public.is_owner() then
    raise exception
      'INVENTORY_AUDIT_FORBIDDEN: only the owner can post an inventory audit. Approving a count changes both the shelf record and the tax return.';
  end if;

  update public.inventory_audit_sessions s
     set posted_at = now()
   where s.id = p_session_id
     and s.status = 'approved'
     and s.posted_at is null
  returning s.id, s.label into v_claimed, v_label;

  if v_claimed is null then
    select s.label into v_label from public.inventory_audit_sessions s where s.id = p_session_id;
    if v_label is null then
      return query select false, 'NOT_FOUND'::text,
        'That audit does not exist.'::text, 0, 0::bigint, 0::bigint;
      return;
    end if;
    if exists (select 1 from public.inventory_audit_sessions s
                where s.id = p_session_id and s.posted_at is not null) then
      return query select false, 'ALREADY_POSTED'::text,
        ('"' || v_label || '" was already posted. Posting it again would move the same inventory a second time and invent a shortage that never happened, so nothing was done.')::text,
        0, 0::bigint, 0::bigint;
      return;
    end if;
    return query select false, 'NOT_APPROVED'::text,
      ('"' || v_label || '" has not been approved yet. Only an approved audit can change inventory.')::text,
      0, 0::bigint, 0::bigint;
    return;
  end if;

  -- 0326 (G-36): two counts that disagree, or stock that moved while the lot
  -- was being counted (G-35), are refused here too. The raise rolls back the
  -- posted_at claim above, so the audit stays approved and unposted.
  select string_agg(coalesce(lot.lot_code, l.lot_id::text), ', ') into v_bad
    from public.inventory_audit_lines l
    join public.inventory_lots lot on lot.id = l.lot_id
   where l.session_id = p_session_id
     and l.recount_qty is not null and l.recount_qty <> l.counted_qty;
  if v_bad is not null then
    raise exception 'INVENTORY_AUDIT_RECOUNT_DISAGREES: the two counts disagree on %. One of them is wrong; nothing was posted.', v_bad;
  end if;
  select string_agg(coalesce(lot.lot_code, l.lot_id::text), ', ') into v_bad
    from public.inventory_audit_lines l
    join public.inventory_lots lot on lot.id = l.lot_id
   where l.session_id = p_session_id
     and coalesce(l.books_moved_qty, 0) <> 0;
  if v_bad is not null then
    raise exception 'INVENTORY_AUDIT_CUTOFF_MOVED: stock moved on % while it was being counted. Count it again from zero; nothing was posted.', v_bad;
  end if;

  for r in
    select l.lot_id,
           -- 0326 (G-35): the books quantity captured when THIS LOT was first
           -- counted. Lines counted before 0326 fall back to the creation freeze.
           coalesce(l.books_qty_at_count, l.system_qty) as system_qty,
           l.counted_qty,
           l.recount_qty,
           coalesce(l.unit_cost_minor_units, lot.unit_cost_minor_units)
             as unit_cost_minor_units,
           lot.on_hand_qty,
           coalesce(lot.lot_code, lot.id::text) as lot_label
      from public.inventory_audit_lines l
      join public.inventory_lots lot on lot.id = l.lot_id
     where l.session_id = p_session_id
     order by l.lot_id
     for update of lot
  loop
    v_effective := coalesce(r.recount_qty, r.counted_qty);
    if v_effective is null then
      continue;
    end if;

    v_before := r.on_hand_qty;
    -- Count minus the books AT THE MOMENT OF COUNTING. Sales or receipts since
    -- then are already in on_hand and are preserved by applying a delta.
    v_delta  := v_effective - r.system_qty;

    update public.inventory_lots
       set last_counted_at   = now(),
           last_counted_by   = v_actor,
           count_times_total = coalesce(count_times_total, 0) + 1
     where id = r.lot_id;

    insert into public.inventory_audit_history
      (lot_id, lot_label, pos_product_key, session_id, counted_at, counted_by,
       system_qty, counted_qty, variance_qty, variance_cents, had_variance)
    select r.lot_id,
           r.lot_label,
           lot.pos_product_key,
           p_session_id,
           now(),
           v_actor,
           r.system_qty,
           v_effective,
           v_delta,
           case when r.unit_cost_minor_units is null then null
                else round(v_delta * r.unit_cost_minor_units)::bigint end,
           (v_delta <> 0)
      from public.inventory_lots lot
     where lot.id = r.lot_id;

    if v_delta = 0 then
      continue;
    end if;

    v_after := v_before + v_delta;

    if v_after < 0 then
      raise exception
        'INVENTORY_AUDIT_NEGATIVE: correcting % by % would leave % on the shelf, and a shelf cannot hold less than nothing. The counted number and the system number disagree in a way that needs a person. Nothing was posted.',
        r.lot_label, v_delta, v_after;
    end if;

    v_cents := case when r.unit_cost_minor_units is null then null
                    else round(v_delta * r.unit_cost_minor_units)::bigint end;

    insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, actor_id)
    values (r.lot_id, v_delta, 'count',
            'Inventory audit "' || v_label || '": counted ' || v_effective || ', books said ' || r.system_qty || ' when counted.',
            v_actor)
    returning id into v_adj;

    update public.inventory_lots
       set on_hand_qty = v_after
     where id = r.lot_id;

    insert into public.inventory_audit_postings
      (session_id, lot_id, lot_label, qty_before, qty_delta, qty_after,
       variance_cents, adjustment_id, posted_by)
    values (p_session_id, r.lot_id, r.lot_label, v_before, v_delta, v_after,
            v_cents, v_adj, v_actor);

    v_moved := v_moved + 1;
    v_net   := v_net   + coalesce(v_cents, 0);
    v_gross := v_gross + abs(coalesce(v_cents, 0));
  end loop;

  update public.inventory_audit_sessions
     set counted_lot_count    = (select count(*) from public.inventory_audit_lines
                                  where session_id = p_session_id
                                    and coalesce(recount_qty, counted_qty) is not null),
         net_variance_cents   = v_net,
         gross_variance_cents = v_gross
   where id = p_session_id;

  return query select true, 'OK'::text,
    ('"' || v_label || '" is posted. ' || v_moved || ' lot(s) were corrected on the shelf.')::text,
    v_moved, v_net, v_gross;
end;
$$;

revoke all on function public.inventory_audit_post_session(uuid) from public;
grant execute on function public.inventory_audit_post_session(uuid) to authenticated, service_role;

comment on function public.inventory_audit_post_session(uuid) is
  '0192, re-created by 0326 (G-35/G-36): posts an APPROVED audit once. The difference is count minus the books captured when each lot was first counted; disagreeing counts and mid-count movement are refused. Owner only.';

notify pgrst, 'reload schema';

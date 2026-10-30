-- Rollback for 0326_audit_count_integrity.sql.
-- Drops the counting RPCs, the insert guard and the new policies; gives staff
-- back direct writes on inventory_audit_lines (the 0191 policy); drops the new
-- checks and columns; restores the 0192 body of inventory_audit_post_session.
-- The D59 cancellations are NOT undone (test data; the audit_logs rows remain).
drop function if exists public.inventory_audit_claim(uuid);
drop function if exists public.inventory_audit_record_count(uuid, uuid, text, text, numeric, text);
drop function if exists public.inventory_audit_submit(uuid);
drop function if exists public.inventory_audit_cancel(uuid, text);
drop function if exists public.inventory_audit_reassign(uuid, uuid);
drop function if exists public.inventory_audit_save_reason(uuid, uuid, text, text);
drop function if exists public.inventory_audit_counter_check(uuid, boolean);
drop trigger if exists inventory_audit_lines_insert_guard on public.inventory_audit_lines;
drop function if exists public.inventory_audit_lines_insert_guard();

drop policy if exists inventory_audit_lines_staff_read on public.inventory_audit_lines;
drop policy if exists inventory_audit_lines_owner_insert on public.inventory_audit_lines;
drop policy if exists inventory_audit_lines_staff_all on public.inventory_audit_lines;
create policy inventory_audit_lines_staff_all on public.inventory_audit_lines
  for all using (public.is_staff()) with check (public.is_staff());
grant update, delete on public.inventory_audit_lines to authenticated;

alter table public.inventory_audit_sessions drop constraint if exists inventory_audit_sessions_cancel_reason_ck;
alter table public.inventory_audit_lines drop constraint if exists inventory_audit_lines_reason_code_ck;
alter table public.inventory_audit_lines
  drop column if exists books_qty_at_count,
  drop column if exists books_captured_at,
  drop column if exists books_moved_qty;
alter table public.inventory_audit_sessions
  drop column if exists claimed_by,
  drop column if exists claimed_by_name,
  drop column if exists claimed_at,
  drop column if exists submitted_by,
  drop column if exists submitted_at,
  drop column if exists cancel_reason,
  drop column if exists cancelled_by,
  drop column if exists cancelled_at;

-- inventory_audit_post_session exactly as 0192 defined it.
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
begin
  -- ── THE OWNER GATE, FIRST STATEMENT ──────────────────────────────────────
  -- In the database, not in the page. A future screen that forgets to check
  -- cannot open a hole, because the hole is not reachable from here.
  if not public.is_owner() then
    raise exception
      'INVENTORY_AUDIT_FORBIDDEN: only the owner can post an inventory audit. Approving a count changes both the shelf record and the tax return.';
  end if;

  -- ── THE ATOMIC CLAIM ─────────────────────────────────────────────────────
  -- This single statement is the entire double-post defence. It is a lock and a
  -- decision at the same time: the row is locked by the update, and the WHERE
  -- clause is the eligibility test. Two callers cannot both succeed, and there
  -- is no moment between "is it eligible?" and "mark it posted" for a second
  -- caller to slip into. Proven under real concurrency; see the file header.
  update public.inventory_audit_sessions s
     set posted_at = now()
   where s.id = p_session_id
     and s.status = 'approved'
     and s.posted_at is null
  returning s.id, s.label into v_claimed, v_label;

  if v_claimed is null then
    -- Work out WHICH refusal this is, so the message is useful rather than a
    -- generic failure. This read happens after the claim attempt on purpose:
    -- reading first and then claiming is precisely the gap being closed.
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

  -- ── MOVE THE SHELF ───────────────────────────────────────────────────────
  -- Ordered by lot id so the work is deterministic and, more importantly, so
  -- concurrent sessions touching overlapping lots always take row locks in the
  -- same order and cannot deadlock against each other.
  for r in
    select l.lot_id,
           l.system_qty,
           l.counted_qty,
           l.recount_qty,
           -- The cost FROZEN ON THE LINE wins, because that is what the item
           -- cost when it was counted and it must not drift if the lot is
           -- repriced afterwards. When the line has none, fall back to the lot.
           --
           -- Caught by execution: without the fallback, a session whose lines
           -- were created before the cost was known reported a $120 gross
           -- variance as $0.00. Two real errors would have been presented to
           -- Michael as a perfectly clean audit. NULL here means "not valued",
           -- and it stays NULL only when BOTH are unknown — an unknown value is
           -- never quietly turned into a zero.
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
    -- The recount wins when there is one; otherwise the count. NULL means
    -- NOBODY LOOKED and must never be treated as zero — that would write off
    -- the entire lot because an employee ran out of time.
    v_effective := coalesce(r.recount_qty, r.counted_qty);
    if v_effective is null then
      continue;
    end if;

    v_before := r.on_hand_qty;

    -- ── WHICH NUMBER IS THE VARIANCE MEASURED AGAINST? ────────────────────
    -- THE FROZEN SNAPSHOT (`system_qty`), NOT the live on-hand. This looked
    -- like a detail and is not; it was caught by executing the race.
    --
    -- `system_qty` is what the books claimed at the moment the count sheet was
    -- printed. `on_hand_qty` is what the books claim RIGHT NOW, and a register
    -- sale can move it while staff are still walking the shelf.
    --
    -- Measured: snapshot 100, a sale drops on-hand to 95, staff count 90.
    --   against the snapshot : 90 - 100 = -10   <- the real discrepancy
    --   against live on-hand : 90 -  95 =  -5   <- HALF of it, silently
    -- The five units that the sale legitimately removed would be laundered into
    -- the count, and the shrink would be under-reported by half. This is the
    -- cutoff problem every inventory standard warns about, and it is exactly
    -- the kind of error that leaves books that "balance" while being wrong.
    --
    -- inventory-audit-core.ts computes `effective - line.systemQty`. The SQL
    -- MUST agree with the core, or the number Michael approves on screen is not
    -- the number the database writes.
    v_delta  := v_effective - r.system_qty;

    -- Stamp the coverage memory for EVERY counted lot, including the ones that
    -- matched exactly. A lot that was counted and found correct is still a lot
    -- that was counted, and the annual-coverage claim depends on that being
    -- recorded. (A lot NOBODY counted is skipped above and never stamped —
    -- stamping it would hide it from the next audit for a full cadence.)
    update public.inventory_lots
       set last_counted_at   = now(),
           last_counted_by   = v_actor,
           count_times_total = coalesce(count_times_total, 0) + 1
     where id = r.lot_id;

    -- Permanent history for every counted lot, variance or not.
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

    -- The correction is applied as a DELTA to whatever the shelf says now, so a
    -- sale that landed mid-count is preserved rather than overwritten. Same
    -- reasoning as GW-012 in the older cycle-count path.
    v_after := v_before + v_delta;

    -- Negative inventory is arithmetically impossible and is all over the old
    -- Sage file. Refuse the whole transaction rather than clamp: clamping hides
    -- the contradiction, and the contradiction is the finding.
    if v_after < 0 then
      raise exception
        'INVENTORY_AUDIT_NEGATIVE: correcting % by % would leave % on the shelf, and a shelf cannot hold less than nothing. The counted number and the system number disagree in a way that needs a person. Nothing was posted.',
        r.lot_label, v_delta, v_after;
    end if;

    v_cents := case when r.unit_cost_minor_units is null then null
                    else round(v_delta * r.unit_cost_minor_units)::bigint end;

    insert into public.inventory_adjustments (lot_id, qty_delta, reason, note, actor_id)
    values (r.lot_id, v_delta, 'count',
            'Inventory audit "' || v_label || '": counted ' || v_effective || ', books said ' || v_before || '.',
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
    -- GROSS, deliberately kept separate. A $600 overage and a $600 shortage net
    -- to zero and look perfect while being two distinct errors.
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
  'Posts an APPROVED inventory audit exactly once, in one transaction. Owner only. Moves the shelf and records evidence; never writes to the general ledger (that is drafted for the owner to approve).';

notify pgrst, 'reload schema';

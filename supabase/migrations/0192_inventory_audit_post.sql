-- =============================================================================
-- 0192_inventory_audit_post.sql   (slice books-11)
--
-- Makes an approved inventory audit actually move the shelf, in ONE transaction,
-- exactly once, ever.
--
-- Idempotent: safe to run more than once. Applied MANUALLY by the owner.
--
-- -----------------------------------------------------------------------------
-- THE DEFECT THIS FILE EXISTS TO KILL (measured, not argued)
-- -----------------------------------------------------------------------------
-- The cycle-count code that predates this slice applies a session by reading a
-- line, deciding whether it was already applied, and then writing. Read, decide,
-- write — with a gap in the middle where a second request can do the same thing.
--
-- That gap was EXECUTED against a real PostgreSQL 15.18 while building this
-- slice, on a lot whose system quantity was 100 and whose counted quantity was
-- 90 (a shortage of ten):
--
--     on_hand   100  ->  90  ->  80
--
-- The second application invented a second ten-unit shortage that nobody counted
-- and no shelf ever lost. Nothing errored. Nothing looked broken afterwards.
-- It is the same shape as the double-reversal defect found in F3, which invented
-- money, and it is triggered by the most ordinary act there is: clicking the
-- button again because you are not sure the first click registered.
--
-- The repair is NOT "check more carefully before writing" — that only narrows
-- the gap. The repair is to remove the gap: the session is CLAIMED with a
-- conditional update that is its own lock.
--
--     update public.inventory_audit_sessions
--        set posted_at = now()
--      where id = p_session_id and status = 'approved' and posted_at is null
--
-- Whoever gets a row posts. Everyone else gets zero rows and is told the audit
-- was already posted. That was executed too, with two transactions launched
-- simultaneously and deliberately overlapped inside a sleep so they genuinely
-- raced: EXACTLY ONE claim was granted. There is no window to lose.
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS A DATABASE FUNCTION AND NOT A TYPESCRIPT LOOP
-- -----------------------------------------------------------------------------
-- Posting a count touches four things: the count lines, the lot quantities, the
-- permanent audit history, and the coverage memory. A TypeScript loop doing that
-- over many round trips can stop halfway — a crash, a timeout, a closed laptop.
-- What is left behind is inventory that moved with no record of why, or a
-- history that says a count happened to a shelf that never changed. That is
-- silent, permanent drift, which the standing rules call the most severe class
-- of failure there is.
--
-- One `security definer` function is one transaction. Either all four happen or
-- none do. There is no half-posted state to discover weeks later.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES **NOT** DO
-- -----------------------------------------------------------------------------
-- It does not touch the general ledger. `inventory` is on the never-auto-post
-- list in posting-core.ts for a stated reason — "inventory moves only when goods
-- move, and a person confirms goods moved" — so the money side is DRAFTED by the
-- application through the F3 door and posted by the owner. This function moves
-- goods and records evidence. It never writes a journal.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITIONS
--
-- Fail loudly and specifically BEFORE changing anything, so that a file pasted
-- out of order says which file to run first instead of leaving a half-built
-- schema behind.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.inventory_audit_sessions') is null
     or to_regclass('public.inventory_audit_lines') is null
     or to_regclass('public.inventory_audit_history') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0192 posts inventory audits, but the audit tables do not exist yet. Run 0191_inventory_audit.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0192 gates posting on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.inventory_adjustments') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0192 writes inventory_adjustments, which does not exist yet. Run 0023_pos_inventory_lots.sql first, then run this file again. Nothing was changed.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'inventory_lots'
       and column_name = 'last_counted_at'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0192 stamps inventory_lots.last_counted_at, which does not exist yet. Run 0191_inventory_audit.sql first, then run this file again. Nothing was changed.';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE POSTING RECORD
--
-- One row per lot actually moved, written at the moment it moves. This exists so
-- that "what did this audit do to my inventory?" is a question with an answer
-- that does not depend on re-deriving anything.
--
-- It also carries the link to the drafted journal, so the shelf record and the
-- books record can be tied together later without guesswork.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.inventory_audit_postings (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.inventory_audit_sessions(id) on delete cascade,
  lot_id              uuid references public.inventory_lots(id) on delete set null,

  -- Denormalised on purpose. A lot row can be deleted; the record of what was
  -- done to it during an audit must survive that, because WAC 314-55-087
  -- requires these records be producible for years.
  lot_label           text,

  qty_before          numeric not null,
  qty_delta           numeric not null,
  qty_after           numeric not null,

  -- Null when the lot had no recorded cost. NULL means "not valued", never zero.
  variance_cents      bigint,

  adjustment_id       uuid references public.inventory_adjustments(id) on delete set null,

  posted_at           timestamptz not null default now(),
  posted_by           uuid references public.staff_profiles(id) on delete set null,

  created_at          timestamptz not null default now(),

  -- A lot may be posted by a given audit exactly once. Belt and braces with the
  -- atomic claim: even if the claim were somehow defeated, this constraint makes
  -- a second write for the same lot impossible rather than merely unlikely.
  unique (session_id, lot_id)
);

create index if not exists inventory_audit_postings_session_idx
  on public.inventory_audit_postings (session_id);
create index if not exists inventory_audit_postings_lot_idx
  on public.inventory_audit_postings (lot_id, posted_at desc);

comment on table public.inventory_audit_postings is
  'One row per lot moved by an approved audit. The evidence that an adjustment came from a counted variance and not from someone typing a number.';

-- The link from a posted audit back to the journal the owner approved. Nullable
-- because the shelf may legitimately move before the money side is posted (an
-- unvalued lot has no money side at all).
alter table public.inventory_audit_sessions
  add column if not exists gl_journal_id uuid;

comment on column public.inventory_audit_sessions.gl_journal_id is
  'The general ledger journal drafted from this audit, once one exists. NULL means the books have not been touched yet — which is correct until the owner posts it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  RLS
--
-- Same split as 0191: the decision record answers to the owner.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.inventory_audit_postings enable row level security;

drop policy if exists inventory_audit_postings_owner_all on public.inventory_audit_postings;
create policy inventory_audit_postings_owner_all on public.inventory_audit_postings
  for all using (public.is_owner()) with check (public.is_owner());

-- Staff may SEE what an audit did (so a count sheet can show "already posted"),
-- but may never write it.
drop policy if exists inventory_audit_postings_staff_read on public.inventory_audit_postings;
create policy inventory_audit_postings_staff_read on public.inventory_audit_postings
  for select using (public.is_staff());

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  THE DOOR: post an approved audit, once, atomically
--
-- Returns a single row describing what happened. It does NOT raise on a refusal
-- that is a legitimate business answer ("already posted", "not approved"),
-- because those are answers a screen must render, not crashes. It DOES raise on
-- conditions that mean the data is wrong, because those must not be swallowed.
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  GATE CHECK
--
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.inventory_audit_post_gate_check()
returns table (object_name text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  select 'inventory_audit_post_session'::text,
         'The posting function is missing, so an approved audit cannot move the shelf.'
   where to_regprocedure('public.inventory_audit_post_session(uuid)') is null

  union all

  select 'inventory_audit_postings'::text,
         'RLS IS NOT ENABLED on the posting record — anyone who can reach the database could rewrite what an audit did.'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'inventory_audit_postings'
     and c.relrowsecurity is false

  union all

  -- Staff must never WRITE the posting record. Reading it is fine and useful.
  select (p.tablename || '.' || p.policyname)::text,
         'This policy lets STAFF write the audit posting record, which is the evidence that a variance was approved by the owner.'
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename = 'inventory_audit_postings'
     and p.cmd <> 'SELECT'
     and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%is_staff%'

  union all

  -- The uniqueness that makes a second posting impossible must actually exist.
  select 'inventory_audit_postings.unique(session_id,lot_id)'::text,
         'The one-posting-per-lot constraint is missing, so an audit could move the same lot twice.'
   where not exists (
     select 1 from pg_constraint
      where conrelid = 'public.inventory_audit_postings'::regclass
        and contype = 'u'
   );
$$;

comment on function public.inventory_audit_post_gate_check() is
  'Verifies the books-11 posting locks actually latched. AN EMPTY RESULT IS THE PASSING RESULT.';

-- =============================================================================
-- AUTHORITIES
--
-- Treas. Reg. §1.471-2(d) — inventory must be verified by physical count, and
--   the count is what the books are corrected to. This function is the moment
--   that correction happens, which is why it demands an approval it can prove.
--
-- Treas. Reg. §1.471-2(f)(3) — omitting portions of the stock on hand makes an
--   inventory unacceptable. This is why a lot nobody counted is skipped rather
--   than treated as zero, and why its coverage memory is deliberately NOT
--   stamped: a false stamp would hide the lot from the next audit entirely.
--
-- WAC 314-55-089(4)(c) — an undocumented reduction in inventory is treated as a
--   sale and carries the 37% excise. The application flags these for the owner
--   before anything is written off; this function records the evidence trail
--   that makes the documentation findable years later.
--
-- WAC 314-55-087(2)(c) — inventory records must be kept and producible. Labels
--   are denormalised into the history and posting tables so the record survives
--   the deletion of the lot it describes.
--
-- PCAOB AS 2510.11 — the auditor observes counts and tests the records. The
--   posting record exists so that observation has something to test: it ties an
--   inventory adjustment back to a specific counted variance in a specific
--   approved audit, rather than to someone typing a number.
-- =============================================================================

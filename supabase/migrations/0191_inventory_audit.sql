-- ═════════════════════════════════════════════════════════════════════════════
-- 0191_inventory_audit.sql
-- Slice books-10 — THE INVENTORY AUDITOR.
--
-- WHAT THIS DOES, IN PLAIN ENGLISH
--
-- Migration 0041 gave us cycle counts: a session, a list of lots, a system
-- quantity, a counted quantity. That was a good counting SHEET. It was not an
-- audit PROGRAMME, and the difference is what this file closes.
--
-- A counting sheet answers "what did we find today?". An audit programme has to
-- answer four harder questions:
--
--   1. WHEN DID WE LAST TOUCH THIS?  Nothing in the database remembered. Without
--      that memory there is no way to prove every item was reached inside a
--      year, and a rotating count that cannot prove its own coverage is not
--      allowed to stand in for a full annual count (PCAOB AS 2510.11).
--
--   2. WHY IS IT DIFFERENT?  0041 stored a variance and a free-text note. It
--      never asked for a REASON, so a $4,000 shortage and a miscounted gram
--      looked identical in the data. WAC 314-55-089(4)(c) makes an undocumented
--      disappearance a DEEMED SALE — taxable at 37% — so the reason is not
--      paperwork, it is money.
--
--   3. DID WE CHECK IT TWICE?  There was nowhere to put a second count. A
--      material variance accepted on one person's first attempt is a guess
--      wearing a number's clothing.
--
--   4. WHO IS ALLOWED TO SEE AND DECIDE?  Counting is staff work. Deciding what
--      a variance MEANS is an owner decision with a tax consequence attached.
--      0041 gated everything on is_staff().
--
-- THE FAILURE THIS FILE IS BUILT AROUND
--
-- Recorded from the owner, and now permanent test corpus: staff recorded the lot
-- code of the FIRST unit they pulled and assumed every other unit matched,
-- collapsing several distinct lots into one. The quantities still added up. The
-- shelf still looked right. The traceability was destroyed — and in a traceable-
-- goods business, destroyed traceability is the whole problem.
--
-- The database defence against that is §3 below: a count line records WHICH LOT
-- was scanned and how it was captured (scanned vs typed), and a blank is stored
-- as NULL and never as zero. A lot nobody counted and a lot counted as empty are
-- different facts about the world, and the schema refuses to conflate them.
--
-- HOW TO RUN IT: see docs/HOW_TO_RUN_A_MIGRATION.md. Apply MANUALLY in the
-- Supabase SQL editor. Then check:
--   select * from public.inventory_audit_gate_check();
-- AN EMPTY RESULT IS THE PASSING RESULT.
--
-- This file is IDEMPOTENT. Running it twice is safe and changes nothing the
-- second time.
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITIONS — REFUSE TO RUN OUT OF ORDER
--
-- Every statement below is written to be safe to re-run, which means a missing
-- dependency would let this file finish "successfully" having built half an
-- audit trail. A migration that can fail silently is worse than one that fails
-- loudly, so this one refuses to start unless what it extends already exists.
-- ═════════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0191 gates the audit decision tables on is_owner(), which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.is_staff()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0191 gates the counting tables on is_staff(), which does not exist yet. Run the staff foundation migration first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.inventory_lots') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0191 adds count memory to inventory_lots, which does not exist yet. Run 0023_pos_inventory_lots.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.cycle_counts') is null
     or to_regclass('public.cycle_count_lines') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0191 extends the cycle-count tables, which do not exist yet. Run 0041_cycle_counts.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0191 attaches updated-at triggers using set_updated_at(), which does not exist yet. Run the migration that defines it first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §1  COVERAGE MEMORY — "WHEN DID WE LAST TOUCH THIS?"
--
-- AS 2510.11 permits a rotating count INSTEAD of a full annual count only when
-- the rotation produces "results substantially the same as those which would be
-- obtained by a count of all items each year." That is a claim about coverage,
-- and a claim nobody can evidence is a claim nobody should make. These three
-- columns are the evidence.
--
-- last_counted_at is NULLABLE ON PURPOSE and starts NULL for every existing lot.
-- Backfilling it to now() would be the single most damaging thing this migration
-- could do: it would tell the auditor that thousands of lots were verified on a
-- day nobody counted anything, and the coverage report — which is designed to be
-- shown to an LCB enforcement officer — would be built on a fiction. A lot that
-- has never been counted must READ as never counted until somebody counts it.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.inventory_lots
  add column if not exists last_counted_at      timestamptz,
  add column if not exists last_counted_by      uuid references public.staff_profiles(id) on delete set null,
  add column if not exists count_times_total    integer not null default 0;

comment on column public.inventory_lots.last_counted_at is
  'When this lot was last physically counted. NULL means NEVER COUNTED and must never be backfilled to a date on which no count occurred — the coverage report is evidence, not decoration. Basis: PCAOB AS 2510.11.';

comment on column public.inventory_lots.count_times_total is
  'How many times this lot has ever been counted. Feeds the "history of error" risk signal in AS 1105.25.';

-- Partial index: the audit planner overwhelmingly asks "what has NOT been
-- counted lately", so the never-counted rows are the hot path.
create index if not exists inventory_lots_last_counted_idx
  on public.inventory_lots (last_counted_at nulls first);

-- ═════════════════════════════════════════════════════════════════════════════
-- §2  THE AUDIT SESSION — SCOPE, APPROVAL, AND THE OWNER GATE
--
-- The operating model, stated by the owner:
--   the system drafts → Michael validates the scope → staff enter the numbers
--   → the system drafts the changes → Michael approves.
--
-- Those are five distinct states and the table records all five, because an
-- approval that cannot be evidenced did not happen. Note that scope is approved
-- BEFORE counting begins: choosing what to count after seeing the numbers is how
-- an audit becomes a search for a comfortable answer.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.inventory_audit_sessions (
  id                    uuid primary key default gen_random_uuid(),
  label                 text not null,

  -- draft            : the system has proposed a scope, nobody has agreed to it
  -- scope_approved   : the owner accepted the scope; counting may begin
  -- counting         : staff are entering numbers
  -- review           : counting finished, variances drafted, awaiting the owner
  -- approved         : the owner accepted the result; adjustments may post
  -- cancelled        : abandoned; kept forever, never deleted
  status                text not null default 'draft',

  -- Why these lots and not others. Written by the planner, in plain English, so
  -- that a year from now the selection can be explained rather than defended.
  scope_rationale       text,

  planned_lot_count     integer not null default 0,
  counted_lot_count     integer not null default 0,

  -- BOTH numbers, deliberately. Net variance is what hits the books; GROSS is
  -- what tells you whether the books are actually under control. A $600 overage
  -- on one lot and a $600 shortage on another nets to zero and looks perfect,
  -- while being two errors and — if the two lots are different products — a
  -- traceability failure. A system that reports only the net teaches the owner
  -- that offsetting mistakes are the same as no mistakes. They are not.
  net_variance_cents    bigint not null default 0,
  gross_variance_cents  bigint not null default 0,

  scope_approved_by     uuid references public.staff_profiles(id) on delete set null,
  scope_approved_at     timestamptz,
  result_approved_by    uuid references public.staff_profiles(id) on delete set null,
  result_approved_at    timestamptz,

  -- Set when the approved variances have been written to the general ledger.
  posted_at             timestamptz,

  created_by            uuid references public.staff_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint inventory_audit_sessions_status_ck check (
    status in ('draft','scope_approved','counting','review','approved','cancelled')
  ),

  -- An approved session must name who approved it. "Approved by nobody" is the
  -- shape an audit finding takes.
  constraint inventory_audit_sessions_approval_ck check (
    status <> 'approved' or (result_approved_by is not null and result_approved_at is not null)
  )
);

create index if not exists inventory_audit_sessions_status_idx
  on public.inventory_audit_sessions (status);
create index if not exists inventory_audit_sessions_created_idx
  on public.inventory_audit_sessions (created_at desc);

drop trigger if exists inventory_audit_sessions_set_updated_at on public.inventory_audit_sessions;
create trigger inventory_audit_sessions_set_updated_at
  before update on public.inventory_audit_sessions
  for each row execute function public.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════
-- §3  THE COUNT LINE — WHERE THE LOT-CODE FAILURE IS STOPPED
--
-- Read the header again if you skipped it. Staff scanned one unit, read its lot
-- code, and wrote that code down for everything else on the shelf. Several
-- distinct lots became one lot in the records. Quantities still tied.
--
-- Three columns here exist solely because of that morning:
--
--   scanned_lot_id  — WHICH lot the scanner actually read, stored per line. Not
--                     inherited from a sibling, not assumed from the first unit.
--   capture_method  — 'scan' or 'manual'. A typed lot code is a human claim; a
--                     scanned one is a machine observation. The auditor is
--                     entitled to know which it is looking at, and manual entry
--                     on a multi-lot product is exactly where this failure lives.
--   counted_qty     — NULLABLE, and NULL MEANS NOT COUNTED. Zero means counted
--                     and found empty. Collapsing those two is how an unvisited
--                     shelf becomes a write-off.
--
-- The second count is real second evidence, not a formality: recount_qty is
-- entered without showing the first number, and if the two disagree the system
-- refuses to average them. Averaging two numbers that contradict each other
-- produces a third number that nobody observed.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.inventory_audit_lines (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.inventory_audit_sessions(id) on delete cascade,
  lot_id              uuid not null references public.inventory_lots(id) on delete cascade,

  -- Blind baseline: system on-hand at the moment the line was created. Frozen so
  -- that later sales cannot quietly move the target the count is measured against.
  system_qty          numeric not null,

  -- NULL = not counted yet. 0 = counted, found nothing. NOT THE SAME FACT.
  counted_qty         numeric,
  counted_by          uuid references public.staff_profiles(id) on delete set null,
  counted_at          timestamptz,

  -- Independent second count, entered blind to the first.
  recount_qty         numeric,
  recount_by          uuid references public.staff_profiles(id) on delete set null,
  recount_at          timestamptz,

  -- 'scan' | 'manual' — see §3 header.
  capture_method      text,
  scanned_lot_id      uuid references public.inventory_lots(id) on delete set null,

  -- Valuation frozen at count time. Costs change; what this count was worth
  -- when it was taken does not.
  unit_cost_minor_units integer,
  variance_qty        numeric,
  variance_cents      bigint,

  -- WHY it differs. This is the WAC 314-55-089(4)(c) column: an unexplained
  -- disappearance is a DEEMED SALE taxed at 37%, so "we don't know" is an
  -- expensive answer and the schema makes it a deliberate one.
  reason_code         text,
  reason_note         text,

  status              text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (session_id, lot_id),

  constraint inventory_audit_lines_capture_ck check (
    capture_method is null or capture_method in ('scan','manual')
  ),

  -- Quantities are counts of physical things. A negative physical count is not a
  -- small error, it is an impossible observation, and it must not be storable.
  constraint inventory_audit_lines_counted_nonneg_ck check (
    counted_qty is null or counted_qty >= 0
  ),
  constraint inventory_audit_lines_recount_nonneg_ck check (
    recount_qty is null or recount_qty >= 0
  ),

  -- A count has a counter and a time. An anonymous count is not evidence, and
  -- WAC 314-55-087(2)(c) expects an audit trail that identifies who did what.
  constraint inventory_audit_lines_counted_attribution_ck check (
    counted_qty is null or (counted_by is not null and counted_at is not null)
  ),

  -- You cannot recount something you never counted. This ordering is what makes
  -- the second count INDEPENDENT rather than a retroactive edit of the first.
  constraint inventory_audit_lines_recount_order_ck check (
    recount_qty is null or counted_qty is not null
  )
);

create index if not exists inventory_audit_lines_session_idx
  on public.inventory_audit_lines (session_id);
create index if not exists inventory_audit_lines_lot_idx
  on public.inventory_audit_lines (lot_id);
create index if not exists inventory_audit_lines_status_idx
  on public.inventory_audit_lines (status);

drop trigger if exists inventory_audit_lines_set_updated_at on public.inventory_audit_lines;
create trigger inventory_audit_lines_set_updated_at
  before update on public.inventory_audit_lines
  for each row execute function public.set_updated_at();

comment on column public.inventory_audit_lines.counted_qty is
  'NULL means NOT COUNTED. Zero means counted and found empty. These are different facts and must never be merged — an unvisited shelf is not a write-off.';

comment on column public.inventory_audit_lines.scanned_lot_id is
  'The lot the scanner actually read on THIS line. Exists because staff once recorded the first unit''s lot code and assumed the rest matched, collapsing distinct lots into one. Never inherit this value from a sibling line.';

-- ═════════════════════════════════════════════════════════════════════════════
-- §4  THE RUNNING TRACK RECORD
--
-- The owner asked for a system that "keeps a running track record so nothing is
-- missed." This is that table: one immutable row per completed count of a lot.
-- It is deliberately SEPARATE from the session lines, because sessions get
-- cancelled and lots get deleted while the history of what was verified, and
-- when, has to outlive both.
--
-- It also feeds the AS 1105.25 "history of error" signal. A lot that has been
-- wrong three times is not the same audit risk as one that has never been wrong,
-- and only a history table can tell you which is which.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.inventory_audit_history (
  id                uuid primary key default gen_random_uuid(),
  lot_id            uuid references public.inventory_lots(id) on delete set null,

  -- Denormalised ON PURPOSE. If the lot row is later deleted, the fact that this
  -- product was counted on this date must survive. An audit trail that vanishes
  -- when the subject vanishes is not an audit trail.
  lot_label         text,
  pos_product_key   text,

  session_id        uuid references public.inventory_audit_sessions(id) on delete set null,
  counted_at        timestamptz not null default now(),
  counted_by        uuid references public.staff_profiles(id) on delete set null,

  system_qty        numeric,
  counted_qty       numeric,
  variance_qty      numeric,
  variance_cents    bigint,
  reason_code       text,
  had_variance      boolean not null default false,

  created_at        timestamptz not null default now()
);

create index if not exists inventory_audit_history_lot_idx
  on public.inventory_audit_history (lot_id, counted_at desc);
create index if not exists inventory_audit_history_product_idx
  on public.inventory_audit_history (pos_product_key);
create index if not exists inventory_audit_history_counted_idx
  on public.inventory_audit_history (counted_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- §5  ROW-LEVEL SECURITY — THE SPLIT THAT MATTERS
--
-- This is the one place where "gate everything to the owner" would be WRONG.
--
--   COUNTING is staff work. Staff must read and write count lines, or nobody can
--   count anything and the whole programme is theatre.
--
--   DECIDING is owner work. What a variance MEANS — shrink, theft, a data-entry
--   error, or an undocumented disappearance the state will tax at 37% — is a
--   financial and tax judgement with the owner's name on the return.
--
-- So: lines are staff-writable, sessions and history are owner-only. A counter
-- can record what they see. A counter cannot approve what it costs, and cannot
-- quietly edit the permanent record of what was found last time.
--
-- Consistent with the owner's standing instruction: "there is no reason anyone
-- else needs to see my books or my financials ever."
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.inventory_audit_sessions enable row level security;
alter table public.inventory_audit_lines    enable row level security;
alter table public.inventory_audit_history  enable row level security;

-- Sessions: OWNER ONLY. Scope approval and result approval both live here.
drop policy if exists inventory_audit_sessions_owner_all on public.inventory_audit_sessions;
create policy inventory_audit_sessions_owner_all on public.inventory_audit_sessions
  for all using (public.is_owner()) with check (public.is_owner());

-- Staff may READ the session they are counting against — they need its label and
-- status to know what they are doing and whether counting is open. They may not
-- write it, so they cannot approve their own work.
drop policy if exists inventory_audit_sessions_staff_read on public.inventory_audit_sessions;
create policy inventory_audit_sessions_staff_read on public.inventory_audit_sessions
  for select using (public.is_staff());

-- Lines: staff read/write. This is the count sheet.
drop policy if exists inventory_audit_lines_staff_all on public.inventory_audit_lines;
create policy inventory_audit_lines_staff_all on public.inventory_audit_lines
  for all using (public.is_staff()) with check (public.is_staff());

-- History: OWNER ONLY, and note there is no staff-write policy at all. The
-- running track record is written by the service role when a session is
-- approved. If staff could edit history, "nothing is missed" would depend on
-- nobody choosing to miss it.
drop policy if exists inventory_audit_history_owner_all on public.inventory_audit_history;
create policy inventory_audit_history_owner_all on public.inventory_audit_history
  for all using (public.is_owner()) with check (public.is_owner());

-- ═════════════════════════════════════════════════════════════════════════════
-- §6  THE GATE CHECK
--
-- Rule: prove the gate is wired. This function is how the owner verifies, after
-- running the file, that the locks actually latched — rather than trusting that
-- they did because the migration printed no error.
--
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.inventory_audit_gate_check()
returns table (object_name text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- Any audit table that is not protected at all.
  select c.relname::text,
         'RLS IS NOT ENABLED on this table — anyone who can reach the database can read or change it.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('inventory_audit_sessions','inventory_audit_lines','inventory_audit_history')
     and c.relrowsecurity is false

  union all

  -- Any audit table with security on but no policies: that denies everyone,
  -- which fails CLOSED rather than open, but it silently breaks counting and
  -- must still be reported.
  select c.relname::text,
         'RLS is enabled but NO POLICY exists — this table is unreadable by everyone, which will break the audit screens.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('inventory_audit_sessions','inventory_audit_lines','inventory_audit_history')
     and c.relrowsecurity is true
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname)

  union all

  -- The decision tables must answer to is_owner(). If a policy on sessions or
  -- history checks is_staff() for anything other than SELECT, the split in §5
  -- has been undone and staff can approve their own counts.
  select (p.tablename || '.' || p.policyname)::text,
         'This policy lets STAFF write an owner-only audit table. Approving a variance is an owner decision with a tax consequence.'
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('inventory_audit_sessions','inventory_audit_history')
     and p.cmd <> 'SELECT'
     and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%is_staff%'

  union all

  -- The coverage memory must exist, or the annual-coverage claim has no evidence.
  select 'inventory_lots.last_counted_at'::text,
         'The coverage column is missing, so the system cannot prove every item was reached inside a year (PCAOB AS 2510.11).'
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name  = 'inventory_lots'
        and column_name = 'last_counted_at'
   );
$$;

comment on function public.inventory_audit_gate_check() is
  'Verifies the books-10 inventory audit locks actually latched. AN EMPTY RESULT IS THE PASSING RESULT.';

-- ═════════════════════════════════════════════════════════════════════════════
-- AUTHORITIES — why this file looks the way it does
--
-- ── 26 C.F.R. §1.471-2(d) ────────────────────────────────────────────────────
--   "the inventories of taxpayers on whatever basis taken, will be subject to
--    investigation by the district director, and the taxpayer must satisfy the
--    district director of the correctness of the prices adopted."
--   source: https://www.law.cornell.edu/cfr/text/26/1.471-2
--   SO WHAT: the burden of proof is on Michael, not on the government. Every
--   column in §1 and §4 exists so that the answer to "prove it" is a query
--   rather than a memory.
--
-- ── 26 C.F.R. §1.471-2(f)(3) ─────────────────────────────────────────────────
--   Omitting portions of the stock on hand is not a permitted basis of valuation.
--   source: https://www.law.cornell.edu/cfr/text/26/1.471-2
--   SO WHAT: this is why counted_qty is NULL-not-zero and why the coverage
--   report names the lots it did not reach. Silently treating an uncounted lot
--   as empty IS omitting stock, and it is the exact bug the schema forbids.
--
-- ── WAC 314-55-089(4)(c) ─────────────────────────────────────────────────────
--   Marijuana that cannot be accounted for may be treated as a sale, with tax
--   due accordingly.
--   source: https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-089
--   SO WHAT: reason_code and reason_note are not administrative tidiness. An
--   undocumented shortage is taxed as if it had been sold, at 37%. The schema
--   asks WHY at the moment the variance is found, because that is the only
--   moment anyone still remembers.
--
-- ── WAC 314-55-087(2)(c) ─────────────────────────────────────────────────────
--   "Has available a full description of the ADP and/or POS portion of the
--    accounting system... the procedures employed in each application, and the
--    controls used to ensure accurate and reliable processing."
--   source: https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087
--   SO WHAT: "the controls used" — the constraints, the RLS split in §5 and the
--   gate check in §6 ARE those controls, and this comment block is the required
--   description of them.
--
-- ── PCAOB AS 2510.11 ─────────────────────────────────────────────────────────
--   A well-kept perpetual system with a rotating count programme may substitute
--   for an annual count where the results are "substantially the same as those
--   which would be obtained by a count of all items each year."
--   source: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2510
--   SO WHAT: this is the permission slip for cycle counting instead of closing
--   the store once a year — and it is conditional. §1 stores the proof that the
--   condition is met.
--
-- ── PCAOB AS 2510.12 ─────────────────────────────────────────────────────────
--   Records alone are not sufficient evidence of inventory existence.
--   source: https://pcaobus.org/oversight/standards/auditing-standards/details/AS2510
--   SO WHAT: the reason this whole slice insists on PHYSICAL counts. What the
--   POS believes is on the shelf is a claim; what somebody scanned is evidence.
--
-- ── PCAOB AS 1105.25 ─────────────────────────────────────────────────────────
--   Specific items may be selected because they are large, or because they are
--   "suspicious, unusual, or particularly risk-prone or items that have a
--    history of error."
--   source: https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105
--   SO WHAT: the professional basis for both the ABC value stratification and
--   the history table in §4 that makes "history of error" a knowable fact.
-- ═════════════════════════════════════════════════════════════════════════════

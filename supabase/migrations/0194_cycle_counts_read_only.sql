-- =============================================================================
-- 0194_cycle_counts_read_only.sql   (slice books-23)
--
-- Makes the RETIRED cycle-count tables read-only at the database level, so the
-- database says the same word the application now says.
--
-- Idempotent: safe to run more than once. Applied MANUALLY by the owner.
--
-- -----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- -----------------------------------------------------------------------------
-- Owner decision, 2026-08-20, verbatim:
--
--   "letting someone cycle counts process something without a way to post it to
--    the ledger would have been a killer. Let's make sure we correct that
--    properly."
--
-- THE DEFECT, PLAINLY. `public.cycle_counts` and `public.cycle_count_lines`
-- were the old counting flow, added by migration 0041. The code path that
-- "applied" a count -- src/lib/inventory/cycle-counts.ts applyCycleCount() --
-- corrected the shelf quantity and WROTE NOTHING TO THE GENERAL LEDGER. So the
-- value of the missing product stayed on the balance sheet forever and cost of
-- goods sold was understated by exactly the same amount.
--
-- That is not a theoretical concern. It is the mechanism behind the
-- $4,624,697.31 inventory plug in the old Sage file -- a number nobody ever
-- decided to make, which accumulated because shrink was taken off the shelf and
-- never taken off the books.
--
-- The application half of the fix shipped in this same slice: applyCycleCount()
-- and createCycleCount() now refuse, with CYCLE_COUNT_APPLY_RETIRED and
-- CYCLE_COUNT_CREATE_RETIRED, and counting moved to the Inventory Auditing flow
-- where the owner approves the scope, staff count blind, the owner reviews every
-- difference and records why, and only then does the shelf move -- with a
-- matching journal entry drafted for the owner to approve.
--
-- This file is the other half. The tables must stay: WAC 314-55-083(4) requires
-- traceability records be retained for three years, and there are real counts in
-- them. What must stop is anyone WRITING to them, because a write there is a
-- shelf correction with no accounting entry behind it.
--
-- -----------------------------------------------------------------------------
-- HONEST SCOPE: WHAT THIS DOES AND DOES NOT CHANGE TODAY
-- -----------------------------------------------------------------------------
-- THIS IS NOT THE LOCK THAT IS HOLDING THE DOOR TODAY, and saying otherwise
-- would be worse than not writing the file at all.
--
-- Every reader and writer of these two tables in this codebase uses the SERVICE
-- ROLE key, which BYPASSES ROW-LEVEL SECURITY ENTIRELY. Checked one at a time,
-- in src/lib/inventory/cycle-counts.ts, before this file was written:
--
--     listCycleCounts            createSupabaseAdminClient()
--     getCycleCount              createSupabaseAdminClient()
--     getCycleCountLines         createSupabaseAdminClient()
--     getCycleCountScanLines     createSupabaseAdminClient()
--     getCycleCountSheetLines    createSupabaseAdminClient()
--     bumpLineCount              createSupabaseAdminClient()
--     recordLineCount            createSupabaseAdminClient()
--     cancelCycleCount           createSupabaseAdminClient()
--     cycleCountSummary          createSupabaseAdminClient()
--
-- So the thing stopping a write today is the refusal in the LIBRARY FUNCTION,
-- and nothing else. An RLS policy cannot restrain a service-role connection, and
-- a comment claiming it does would be a lie with a citation attached.
--
-- What this file actually buys is worth having anyway:
--
--   1. THE API PATH. These tables are reachable through the Supabase REST API
--      with any logged-in staff member's own credentials. Migration 0041 granted
--      `for all using (is_staff())`, so today any budtender's session can
--      INSERT, UPDATE and DELETE cycle-count rows directly, with no application
--      code involved at all. That path needs no code change by anyone to become
--      useful, and it is closed here.
--
--   2. THE NEXT REFACTOR. The day somebody converts one of the nine readers
--      above to a normal session client -- an ordinary, sensible-looking change
--      -- the table does not quietly become writable again.
--
-- Both are cheap: the nine functions above are unaffected because service-role
-- ignores RLS, so there is no feature to break.
--
-- -----------------------------------------------------------------------------
-- WHY SELECT SURVIVES
-- -----------------------------------------------------------------------------
-- Staff keep READ. Three reasons, in order of how much they matter:
--
--   * The counts are a retention record under WAC 314-55-083(4). A record that
--     cannot be read is not being retained in any useful sense.
--   * /admin/inventory/cycle-counts still lists them under "Older counts (read
--     only)", which is how a manager answers "what did we count in March".
--   * Deleting or hiding history to make a retirement look tidier is how an
--     audit trail becomes an audit problem.
-- =============================================================================

-- ═════════════════════════════════════════════════════════════════════════════
-- §0  PREFLIGHT
--
-- Fails loudly and changes NOTHING if this file is run against a database that
-- is not ready for it. A migration that half-applies is worse than one that
-- refuses, because the half that applied is invisible.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.cycle_counts') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0194 re-gates public.cycle_counts, which does not exist yet. Run 0041_cycle_counts.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.cycle_count_lines') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0194 re-gates public.cycle_count_lines, which does not exist yet. Run 0041_cycle_counts.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regprocedure('public.is_staff()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0194 keeps staff READ access using is_staff(), which does not exist yet. Run the staff foundation migration first, then run this file again. Nothing was changed.';
  end if;

  -- The replacement flow must be in place before the old one is sealed. Without
  -- this check, running 0194 on a database that never got 0191 would leave the
  -- store with NO working way to count stock at all: the old path refused in
  -- code, and the new path's tables absent.
  if to_regclass('public.inventory_audit_sessions') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0194 seals the OLD cycle-count tables, but the replacement audit flow (public.inventory_audit_sessions) does not exist yet. Applying this now would leave no working way to count stock. Run 0191_inventory_audit.sql and 0192_inventory_audit_post.sql first, then run this file again. Nothing was changed.';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §1  THE RE-GATE — read stays, write goes
--
-- Migration 0041 created `cycle_counts_staff_all` and `cycle_count_lines_staff_all`
-- as `for all using (is_staff()) with check (is_staff())`. "for all" means
-- SELECT, INSERT, UPDATE and DELETE. Those are dropped and replaced with
-- SELECT-only policies.
--
-- Note there is deliberately NO owner-write policy. The owner does not need one
-- either: the correct place to count stock is Inventory Auditing, and leaving a
-- writable door open "just for the owner" is how a retired path comes back.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.cycle_counts      enable row level security;
alter table public.cycle_count_lines enable row level security;

drop policy if exists cycle_counts_staff_all       on public.cycle_counts;
drop policy if exists cycle_counts_staff_read      on public.cycle_counts;
drop policy if exists cycle_count_lines_staff_all  on public.cycle_count_lines;
drop policy if exists cycle_count_lines_staff_read on public.cycle_count_lines;

create policy cycle_counts_staff_read on public.cycle_counts
  for select using (public.is_staff());

create policy cycle_count_lines_staff_read on public.cycle_count_lines
  for select using (public.is_staff());

-- ═════════════════════════════════════════════════════════════════════════════
-- §2  BELT AND BRACES — revoke the write grants outright
--
-- RLS decides which ROWS a role may touch; table grants decide whether the role
-- may attempt the verb at all. Revoking the verbs means a stray policy added by
-- a later migration cannot reopen writing on its own, and the error a caller
-- gets names the table instead of vanishing as "zero rows affected".
--
-- `service_role` is deliberately NOT revoked here. It is the key the nine
-- functions listed above still use for READS, and revoking its write grant would
-- suggest a protection this file cannot provide -- the service role is precisely
-- the connection that ignores all of this. The refusal in cycle-counts.ts is the
-- real lock on that path, and it is tested in
-- tests/compliance/inventory-audit-wiring.test.ts section B.
-- ═════════════════════════════════════════════════════════════════════════════
revoke insert, update, delete on table public.cycle_counts      from anon, authenticated;
revoke insert, update, delete on table public.cycle_count_lines from anon, authenticated;

comment on table public.cycle_counts is
  'RETIRED (books-23), READ-ONLY, RETAINED. The old cycle-count flow: it corrected the shelf but never wrote a journal entry, so shrink stayed on the balance sheet and COGS was understated by the same amount -- the mechanism behind the $4,624,697.31 inventory plug in the old Sage file. Superseded by public.inventory_audit_sessions, where the owner approves the scope, staff count blind, and posting drafts a journal entry for the owner to approve. Rows are kept as a traceability record under WAC 314-55-083(4) and are readable by staff. NOTE the honest limit: writes through the SERVICE ROLE key bypass RLS entirely, so the enforced lock on that path is the CYCLE_COUNT_APPLY_RETIRED / CYCLE_COUNT_CREATE_RETIRED refusal in src/lib/inventory/cycle-counts.ts, not this policy.';

comment on table public.cycle_count_lines is
  'RETIRED (books-23), READ-ONLY, RETAINED. Per-lot counted quantities from the old cycle-count flow. See the comment on public.cycle_counts for why writing here is closed and what the real lock is.';

-- ═════════════════════════════════════════════════════════════════════════════
-- §3  DID THE LOCK ACTUALLY LATCH?
--
-- AN EMPTY RESULT IS THE PASSING RESULT. This exists because "I ran the
-- migration" and "the migration did what it says" are different claims, and only
-- the second one is worth anything. Every check below re-reads the catalog rather
-- than trusting that the statements above ran.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.cycle_counts_retired_gate_check()
returns table (object_name text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- 1. RLS must be on. Without it, policies are decoration.
  select c.relname::text,
         'Row-level security is DISABLED, so the read-only policies below are not enforced at all.'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('cycle_counts', 'cycle_count_lines')
     and c.relrowsecurity = false

  union all

  -- 2. No policy may permit a write. `cmd = 'ALL'` is the 0041 shape and is the
  --    specific thing this migration exists to remove; INSERT/UPDATE/DELETE
  --    would be a new one added later.
  select (p.tablename || '.' || p.policyname)::text,
         'This policy permits writing to a RETIRED table. A write here is a shelf correction with no journal entry behind it.'
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('cycle_counts', 'cycle_count_lines')
     and p.cmd <> 'SELECT'

  union all

  -- 3. Read must SURVIVE. Sealing the table so completely that the retention
  --    record cannot be read would break WAC 314-55-083(4) and the "Older
  --    counts" list, so this check runs in the OTHER DIRECTION on purpose
  --    (standing rule 34: gates are tested both ways).
  select t.tablename::text,
         'There is no SELECT policy, so this retained traceability record cannot be read by staff at all.'
    from (values ('cycle_counts'), ('cycle_count_lines')) as t(tablename)
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tablename
        and p.cmd = 'SELECT'
   )

  union all

  -- 4. The write grants must be gone for ordinary sessions.
  select (g.table_name || ' / ' || g.grantee || ' / ' || g.privilege_type)::text,
         'An ordinary logged-in session still holds this write grant on a retired table.'
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name in ('cycle_counts', 'cycle_count_lines')
     and g.grantee in ('anon', 'authenticated')
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')

  union all

  -- 5. The REPLACEMENT must still work. A retirement that quietly took the new
  --    flow down with it would leave the store unable to count anything, and
  --    the first four checks would all pass while that was true.
  select 'inventory_audit_post_session'::text,
         'The replacement posting function is missing, so retiring the old flow leaves no way to turn a count into a journal entry.'
   where to_regprocedure('public.inventory_audit_post_session(uuid)') is null;
$$;

comment on function public.cycle_counts_retired_gate_check() is
  'Verifies the books-23 cycle-count retirement actually latched: RLS on, no write policy, READ still present, write grants revoked for ordinary sessions, and the replacement posting function still installed. AN EMPTY RESULT IS THE PASSING RESULT.';

-- ---------------------------------------------------------------------------
-- OWNER REVIEW QUERIES (read-only -- run each once after applying, just look):
--
-- A. The one that matters. Expect ZERO rows:
--
--      select * from public.cycle_counts_retired_gate_check();
--
-- B. Each retired table should have exactly ONE policy, and it should say
--    SELECT. Expect two rows, both with cmd = 'SELECT':
--
--      select tablename, policyname, cmd, qual
--        from pg_policies
--       where schemaname = 'public'
--         and tablename in ('cycle_counts', 'cycle_count_lines')
--       order by tablename;
--
-- C. The history is still there and still readable. Expect your real counts,
--    not an empty list -- if this comes back empty, STOP and say so, because
--    these rows are a three-year retention record:
--
--      select id, label, status, created_at
--        from public.cycle_counts
--       order by created_at desc limit 10;
--
-- D. The replacement flow is the one that works now. Counting a shelf should
--    produce sessions here, not in cycle_counts:
--
--      select id, label, status, posted_at, created_at
--        from public.inventory_audit_sessions
--       order by created_at desc limit 10;
-- ---------------------------------------------------------------------------

-- =============================================================================
-- AUTHORITIES
--
-- WAC 314-55-083(4) -- traceability: records must be kept and made available.
--   This is why the tables are retained and readable rather than dropped.
--
-- Treas. Reg. §1.471-2(d) -- inventory must be verified by physical count, and
--   the books are corrected TO that count. A count that corrects the shelf and
--   not the books satisfies the counting and defeats the purpose.
--
-- Treas. Reg. §1.446-1(a)(4)(i) -- inventories must be taken consistently and
--   the accounting must reflect them. Understating COGS by leaving shrink on the
--   balance sheet is exactly the inconsistency this retirement removes.
--
-- IRC §280E -- a retailer's only deductible amounts run through cost of goods
--   sold, so COGS understated by unposted shrink is tax OVERPAID, year on year.
--   Getting this right is money, not tidiness.
-- =============================================================================

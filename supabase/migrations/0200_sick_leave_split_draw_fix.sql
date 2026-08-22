-- ══════════════════════════════════════════════════════════════════════════
-- 0200  THE UNIQUE INDEX THAT MADE A LAWFUL APPROVAL IMPOSSIBLE
--
-- books-35. This migration fixes ONE defect in 0198, and it is a defect that
-- would have surfaced as a red error box on Michael's screen the first time he
-- tried to approve a sick day for an employee he had been generous to.
--
-- ──────────────────────────────────────────────────────────────────────────
-- WHAT WENT WRONG, IN PLAIN ENGLISH
-- ──────────────────────────────────────────────────────────────────────────
--
-- Sick leave at Greenway lives in two buckets. There is the leave an employee
-- EARNED by working -- the statutory bucket, one hour for every forty worked --
-- and there is leave Michael GAVE them because they were out of earned hours
-- and he did not want them coming in sick. 0198 built both buckets on purpose,
-- and sick-leave-core.ts spends the earned hours FIRST so that the hours
-- Michael gifted are the ones left over at year end, where they can lapse
-- instead of joining the balance he is legally required to carry forward.
--
-- That draw order is correct and it is tested. Its consequence is that a
-- SINGLE approved sick day can legitimately need TWO ledger rows: some minutes
-- out of the earned bucket, the rest out of the awarded bucket. The engine
-- returns exactly that -- planDraw() hands back fromStatutoryMinutes AND
-- fromAwardedMinutes, and both can be greater than zero on the same request.
--
-- 0198 then created this index:
--
--     create unique index if not exists sick_leave_ledger_one_usage_per_request
--       on public.sick_leave_ledger (request_id)
--       where entry_kind = 'usage';
--
-- One usage row per request. Which means the second row -- the awarded half of
-- a perfectly ordinary split -- is rejected by the database:
--
--     ERROR:  duplicate key value violates unique constraint
--             "sick_leave_ledger_one_usage_per_request"
--     DETAIL:  Key (request_id)=(...) already exists.
--
-- That is not a theory. It was reproduced on a real PostgreSQL 15 with all 199
-- migrations applied, and the whole insert rolled back, leaving zero rows. So
-- the failure was at least honest -- it would not have half-deducted anyone's
-- leave -- but the approval was IMPOSSIBLE. Michael would have been unable to
-- approve sick leave for exactly the employees he had been kindest to, with an
-- error message about a duplicate key that explains nothing about why.
--
-- ──────────────────────────────────────────────────────────────────────────
-- WHY THE INDEX IS NOT SIMPLY DROPPED
-- ──────────────────────────────────────────────────────────────────────────
--
-- The index exists for a real reason and that reason has not gone away. 0198
-- says it plainly:
--
--     "One usage entry per approved request. Without this, a double-click on
--      the approve button deducts the leave twice and the employee silently
--      loses hours."
--
-- Dropping it to make the split work would trade a loud, harmless failure for
-- a silent, harmful one. A double-clicked approve button would quietly deduct
-- a sick day twice and nobody would find out until an employee counted their
-- own hours -- which is precisely the class of defect this whole payroll build
-- exists to make impossible.
--
-- So the key is WIDENED rather than removed, from
--
--     (request_id)                to        (request_id, drawn_from)
--
-- and the partial condition `where entry_kind = 'usage'` is kept exactly as it
-- was. The rule the database now enforces is: ONE ROW PER REQUEST PER BUCKET.
-- A request may draw once from earned and once from awarded, and never twice
-- from either.
--
-- Both halves of that were proven on a real database before this file was
-- written, not reasoned about:
--
--   - the legitimate split (-300 statutory AND -180 awarded, same request)
--     INSERTs successfully, 2 rows, summing to -480; and
--   - a repeat of EITHER bucket for that same request is still rejected with
--     the same constraint name, leaving the row count at exactly 2.
--
-- The double-click defence therefore still bites. It simply no longer mistakes
-- a lawful two-bucket draw for a double-click.
--
-- WHY drawn_from IS SAFE AS PART OF THE KEY. A NULL in a unique key would
-- defeat the whole index, because NULL never equals NULL and PostgreSQL would
-- happily accept unlimited rows. That cannot happen here: 0198 already
-- constrains it with
--
--     constraint sick_leave_ledger_draw_only_on_usage
--       check ((entry_kind = 'usage') = (drawn_from is not null))
--
-- so on the `usage` rows this partial index covers, drawn_from is guaranteed
-- NOT NULL and can only ever be 'statutory' or 'awarded'. The widened key is
-- therefore genuinely unique across at most two rows per request.
--
-- ──────────────────────────────────────────────────────────────────────────
-- WHY THE INDEX KEEPS ITS NAME
-- ──────────────────────────────────────────────────────────────────────────
--
-- Standing rule 25: extend, do not duplicate. Two other places in this repo
-- assert this index BY NAME -- the gl_audit_sick_and_orders() health check
-- inside 0198, and scripts/compliance/prove-0198-gates.ts. Renaming it would
-- silently turn both of those green-for-the-wrong-reason, which is standing
-- rule 50, dead code wearing a green check. Reusing the name means every
-- existing guard keeps guarding the real thing.
--
-- IDEMPOTENT, because Michael applies these by hand and may run the file
-- twice. Dropping by name and recreating is safe on a re-run and converges to
-- the same state whether 0198's original index or this one is present.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Pre-flight: refuse clearly rather than failing obscurely ───────────────
do $precheck$
begin
  if to_regclass('public.sick_leave_ledger') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0200 repairs an index on public.sick_leave_ledger, which does not exist yet. Run 0198_sick_leave_and_garnishments.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

-- ── The repair itself ──────────────────────────────────────────────────────
-- Dropped by name and rebuilt with the widened key. `if exists` and the
-- unconditional create make this converge from either starting state.
drop index if exists public.sick_leave_ledger_one_usage_per_request;

create unique index if not exists sick_leave_ledger_one_usage_per_request
  on public.sick_leave_ledger (request_id, drawn_from)
  where entry_kind = 'usage';

comment on index public.sick_leave_ledger_one_usage_per_request is
  'ONE USAGE ROW PER REQUEST PER BUCKET. A single approved sick day may draw from the statutory bucket and the awarded bucket at once, because sick-leave-core.ts spends earned hours before gifted ones, so a request can legitimately produce two rows. The original 0198 key was (request_id) alone, which made that lawful split impossible to write. Widening the key to (request_id, drawn_from) keeps the double-click defence intact - a second attempt at the SAME bucket for the SAME request is still rejected - while permitting the two-bucket draw the engine actually plans.';

-- ── Post-flight: prove the index really is the shape we intended ───────────
-- STANDING RULE 16: prove the gate is WIRED. An index that exists under the
-- right name but the wrong key would pass every by-name check in this repo and
-- still reject the approvals this file exists to permit. So the KEY ITSELF is
-- verified here, and the migration refuses to report success unless the
-- catalogue actually shows two key columns.
do $verify$
declare
  key_columns integer;
begin
  select count(*) into key_columns
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where c.relname = 'sick_leave_ledger_one_usage_per_request'
    and a.attname in ('request_id', 'drawn_from');

  if key_columns <> 2 then
    raise exception
      'SICK_LEAVE_INDEX_NOT_REPAIRED: sick_leave_ledger_one_usage_per_request should be keyed on BOTH request_id and drawn_from, but the catalogue reports % of those 2 columns. A single approved sick day that draws from the earned bucket and the awarded bucket at once would be rejected by the database. Nothing about the balances is wrong, but no such approval can be recorded until this index is correct.', key_columns;
  end if;
end
$verify$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0211_owner_operator_self_approval.sql   (slice books-89)
--
-- TURN OFF THE $5,000 BLOCK. KEEP THE $5,000 FLAG.
--
-- Michael, verbatim (standing rule 1 — record the request in his own words):
--
--   "I will need you to turn off the over 5k approval feature. I am the one and
--    only owner operator that will have access to the books. I liked it because
--    it flags large purchases, but I regularly have over 5k invoices, so I want
--    to be notified about it, then it needs to allow me to approve it. But we
--    will work on that later, just add it to the list of things to complete
--    later on."
--
-- WHAT WAS ACTUALLY WRONG, BECAUSE IT IS NOT THE THRESHOLD
--
-- Migration 0174 built two separate things and gave them one switch:
--
--   1. A WARNING. Entries at or above threshold_cents come back from
--      gl_submit_journal with needs_second_approver = true. That is useful and
--      Michael said so plainly: "I liked it because it flags large purchases."
--
--   2. A BLOCK. gl_approve_journal (0174:777) and the posting trigger
--      (0174:846) both REFUSE when the approver is the author, at or above the
--      same figure, unless allow_self_approval is on.
--
-- Segregation of duties means the author and the approver are different people.
-- Greenway has exactly one person with books access — is_owner(), migration
-- 0185 — so the control cannot be satisfied. It is not protecting anything; it
-- is a locked door in a building with one occupant, and the occupant regularly
-- needs to walk through it. Michael says he has $5,000+ invoices routinely.
--
-- SO: THIS MIGRATION MOVES ONE BOOLEAN AND NOTHING ELSE.
--
-- What it does NOT do, deliberately:
--   * It does NOT raise threshold_cents. The threshold stays at $5,000 because
--     the WARNING is computed from it, and Michael asked to keep being warned.
--     Raising it to a billion would have removed the block AND the flag, which
--     is the opposite of what he asked for.
--   * It does NOT touch gl_approve_journal or the posting trigger. Those
--     functions are correct. They read the policy; the policy is what changes.
--     A business rule belongs in a row, not carved into a function body, so
--     that the day Michael hires a bookkeeper it is one UPDATE to restore.
--   * It does NOT remove the audit trail. approved_by and approved_at are still
--     written on every approval. Self-approved is not unapproved: the ledger
--     still records who blessed the entry and when.
--
-- The 0174 check constraint gl_approval_policy_self_needs_reason requires a
-- written reason of at least 20 characters whenever allow_self_approval is
-- true. That constraint is the reason this is a migration and not a hand-edit:
-- the justification is stored next to the decision, permanently, where an
-- examiner asking "who approved this $40,000 entry" finds the answer and the
-- policy that permitted it in the same place.
--
-- STILL OPEN, and tracked as PR D in todo.md: the flag has no screen. The
-- database computes needs_second_approver and nothing renders it. Removing the
-- block without building the warning would quietly drop the half Michael said
-- he liked, so it is written down rather than assumed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- §0  ORDERING GUARD
--
-- This migration UPDATEs a table 0174 creates. Run out of order it would fail
-- with a bare "relation does not exist" rather than a sentence, so it says so.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.gl_approval_policy') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0211 changes the approval policy, and public.gl_approval_policy does not exist yet. Run 0174_gl_posting_service.sql first, then this file. Nothing was changed.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gl_approval_policy'
      and column_name = 'allow_self_approval'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0211 needs gl_approval_policy.allow_self_approval, added by 0174_gl_posting_service.sql. Run that first, then this file. Nothing was changed.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  THE CHANGE
--
-- Every entity, because Michael is the sole operator of all four of them. The
-- reason is stored in two columns on purpose: self_approval_reason explains the
-- self-approval specifically (and satisfies the 0174 constraint), while
-- change_reason is the audit note for this edit.
--
-- WHERE clause, not a blanket UPDATE: if a policy row somehow already permits
-- self-approval with its own written reason, that reason is better evidence
-- than this one and is left alone. Re-running this file is then a no-op, which
-- is what idempotent means for a data migration.
-- ─────────────────────────────────────────────────────────────────────────────
update public.gl_approval_policy
   set allow_self_approval  = true,
       self_approval_reason =
         'Sole owner-operator. Michael Lyman is the only person with books access (is_owner(), migration 0185), so an approver who is not the author does not exist and the segregation-of-duties control cannot be satisfied by anyone. He owns the business, signs the return and bears the liability. Requested by the owner in books-89 in these words: "I am the one and only owner operator that will have access to the books... I regularly have over 5k invoices, so I want to be notified about it, then it needs to allow me to approve it." The $5,000 threshold is deliberately LEFT IN PLACE so that gl_submit_journal keeps returning needs_second_approver = true on large entries: the warning was wanted, only the block was not. Restore segregation by setting this column back to false the day a second person is granted books access.',
       change_reason        =
         'books-89: the $5,000 block is removed for a sole operator; the $5,000 flag is kept. See 0211_owner_operator_self_approval.sql and PR D in todo.md.',
       updated_at           = now()
 where allow_self_approval = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2  PROVE IT TOOK
--
-- A data migration that silently matched zero rows looks identical to one that
-- worked. Standing rule 46: a failed read is not an empty result. If any policy
-- row still blocks self-approval after this file runs, the transaction aborts
-- rather than leaving Michael to discover it the next time a $6,000 invoice
-- refuses to post.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_blocking int;
  v_total    int;
begin
  select count(*) into v_total from public.gl_approval_policy;

  select count(*) into v_blocking
    from public.gl_approval_policy
   where allow_self_approval = false;

  if v_blocking > 0 then
    raise exception
      '0211 FAILED: % of % approval policy row(s) still block self-approval. Michael would still be unable to post his own entries of $5,000 or more. Nothing has been committed.',
      v_blocking, v_total;
  end if;

  raise notice
    '0211: self-approval permitted on % policy row(s). The $5,000 threshold is unchanged, so large entries still come back flagged.',
    v_total;
end $$;

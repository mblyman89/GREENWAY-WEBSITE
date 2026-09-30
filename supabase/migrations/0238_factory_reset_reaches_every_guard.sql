-- =============================================================================
-- 0238 - The factory reset reaches every guard it has to pass (D-81)
-- =============================================================================
-- The owner asked, in his own words:
--
--   "Please refresh the git repo, then proceed to fix the reset data feature
--    so I can clean out all my dirty test data."
--
-- WHAT WAS BROKEN
-- gl_factory_reset() (0209) empties every table the core classifies WIPE in
-- ONE transaction. Three of those tables carry a BEFORE DELETE trigger that
-- raises, and 0209 never gave those three the transaction-local escape hatch
-- it gave the ledger guards:
--
--   gl_template_changes   0174  gl_guard_template_changes_append_only  GL_APPEND_ONLY
--   gl_override_log       0177  gl_override_log_is_append_only         GL_OVERRIDE_LOG_APPEND_ONLY
--   gl_opening_balances   0176  gl_ob_guard_frozen (posted rows)       GL_OB_FROZEN
--
-- 0209 re-created only gl_guard_posted_journal, gl_guard_posted_lines and
-- gl_guard_audit_append_only. So the moment testing put ONE row in any of the
-- three tables above (editing a posting template, self-approving a journal
-- of 5000 dollars or more under the 0211 policy, posting an opening balance),
-- the delete raised, the whole reset rolled back, and the page said
-- "Reset failed" even with the retention attestation ticked.
--
-- A FOURTH BLOCKER, found while proving this fix. gl_audit_events.journal_id
-- and .period_id reference gl_journals and gl_periods ON DELETE SET NULL, and
-- 0209 deletes gl_journals and gl_periods BEFORE gl_audit_events. So deleting
-- a journal makes Postgres UPDATE every audit event that names it, setting
-- journal_id to null. 0209 gave gl_guard_audit_append_only a DELETE hatch
-- only, and it refuses every UPDATE, including that one. gl_post_journal and
-- gl_approve_journal both write an audit event naming the journal, so ONE
-- journal posted or approved through the app was enough to abort the reset:
--
--   GL_IMMUTABLE: gl_audit_events is append-only.
--   ... UPDATE ONLY "public"."gl_audit_events" SET "journal_id" = NULL ...
--   ... delete from public.gl_journals where true
--
-- Every case above was proven on a throwaway Postgres 15 with all 237
-- migrations applied, each in a rolled-back transaction.
--
-- The WIPE and KEEP lists were NOT the cause: the plan for the real schema
-- builds clean (139 WIPE, 125 KEEP, no refusals).
--
-- WHAT THIS FILE DOES
-- Re-creates those three functions with the SAME hatch 0209 uses (a DELETE
-- while gl_factory_reset_active() is true returns OLD) as the FIRST
-- statement, before any refusal. Everything else in each body is
-- copied from 0174, 0176 and 0177 with the same logic and the same error
-- codes. One character differs: the 0177 override-log message used an em dash,
-- written here as a plain hyphen so the file is pure ASCII for the SQL editor
-- (the transit-hazard check). Every caller matches on the code prefix
-- (gl-refusal-core.ts, owner-override-tests.sql), never on that dash.
--   * UPDATE is still refused, always, reset or not.
--   * DELETE is still refused outside a factory reset.
--   * gl_factory_reset_active() is TRUE only inside the transaction that
--     gl_factory_reset() marked with set_config(..., true). A rollback un-sets
--     it with no cleanup, so nothing is ever left unguarded.
-- And re-creates gl_guard_audit_append_only (0172, hatched by 0209) so that
-- INSIDE a factory reset it also permits the ONE update the foreign keys
-- themselves perform: journal_id, period_id or entity_id going to null with
-- every other column byte-identical. Any other UPDATE, reset or not, is
-- refused exactly as before, and outside a reset every UPDATE is refused.
-- The rows are deleted a few statements later by 0209 in the same
-- transaction, so the nulled pointer is never visible to anyone.
-- No trigger is dropped, disabled or re-pointed.
--
-- The whole class is now a red test, not a surprise on the reset page:
-- tests/compliance/d81-reset-reaches-every-guard.test.ts reads every
-- migration and fails if any BEFORE DELETE trigger that raises, on a table
-- 0209 deletes, lacks the hatch ahead of its first refusal.
--
-- Depends on 0209 (gl_factory_reset_active), 0172, 0174, 0176 and 0177.
-- Refuses to run, by name, if any is missing. Idempotent: create or replace only. APPLY
-- MANUALLY in the Supabase SQL editor (standing rule 6).
-- ROLLBACK: supabase/rollbacks/0238_factory_reset_reaches_every_guard.rollback.sql
-- =============================================================================

do $precheck$
begin
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0238 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
  if to_regclass('public.gl_audit_events') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0238 depends on gl_audit_events from 0172_gl_foundation.sql';
  end if;
  if to_regclass('public.gl_template_changes') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0238 depends on gl_template_changes from 0174_gl_posting_service.sql';
  end if;
  if to_regclass('public.gl_opening_balances') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0238 depends on gl_opening_balances from 0176_opening_balances.sql';
  end if;
  if to_regclass('public.gl_override_log') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0238 depends on gl_override_log from 0177_owner_override.sql';
  end if;
end
$precheck$;

-- 1. gl_template_changes (0174). The change log of posting-template edits.
create or replace function public.gl_guard_template_changes_append_only()
returns trigger language plpgsql as $$
begin
  -- 0238: the factory reset may discard the rehearsal change log. Nothing
  -- else may, and nobody may ever UPDATE it.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;
  raise exception 'GL_APPEND_ONLY: gl_template_changes is a permanent record and cannot be % ', lower(tg_op)
    using errcode = 'raise_exception';
end $$;

-- 2. gl_opening_balances (0176). Posted worksheet rows are frozen.
create or replace function public.gl_ob_guard_frozen()
returns trigger language plpgsql as $$
begin
  -- 0238: during a factory reset the rehearsal worksheet goes with the
  -- rehearsal journals it was posted to. Outside a reset nothing changes.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'GL_OB_FROZEN: this opening balance line has already been posted (journal %). Posted history is corrected by reversing the journal, never by deleting the evidence of it.', old.journal_id
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  -- UPDATE. The only permitted transition out of posted is none at all.
  if old.status = 'posted' then
    raise exception 'GL_OB_FROZEN: this opening balance line has already been posted (journal %). Correct it by reversing that journal, not by editing the worksheet.', old.journal_id
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

-- 3. gl_override_log (0177). Every use of the owner override.
create or replace function public.gl_override_log_is_append_only()
returns trigger language plpgsql as $$
begin
  -- 0238: the overrides used while rehearsing are rehearsal data. Only the
  -- factory reset may discard them, and nobody may ever rewrite one.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;
  raise exception 'GL_OVERRIDE_LOG_APPEND_ONLY: the override log records what was actually done and can never be edited or deleted. If an override was a mistake, reverse the journal - that correction is itself part of the record.'
    using errcode = 'raise_exception';
end $$;

-- 4. gl_audit_events (0172, DELETE hatch from 0209). The ledger audit trail.
create or replace function public.gl_guard_audit_append_only()
returns trigger language plpgsql as $$
begin
  if public.gl_factory_reset_active() then
    -- 0209: the append-only trail of a rehearsal is itself rehearsal data.
    if tg_op = 'DELETE' then
      return old;
    end if;
    -- 0238: while the reset deletes gl_journals and gl_periods, the ON DELETE
    -- SET NULL foreign keys null the pointers on these rows before 0209
    -- deletes them. Permit exactly that and nothing else: each pointer is
    -- unchanged or null, and every other column is identical.
    if tg_op = 'UPDATE'
       and (new.journal_id is null or new.journal_id = old.journal_id)
       and (new.period_id  is null or new.period_id  = old.period_id)
       and (new.entity_id  is null or new.entity_id  = old.entity_id)
       and (to_jsonb(new) - 'journal_id' - 'period_id' - 'entity_id')
         = (to_jsonb(old) - 'journal_id' - 'period_id' - 'entity_id')
    then
      return new;
    end if;
  end if;
  raise exception 'GL_IMMUTABLE: gl_audit_events is append-only.'
    using errcode = 'raise_exception';
end $$;

comment on function public.gl_guard_audit_append_only() is
  '0172, DELETE hatch from 0209, FK set-null hatch from 0238 (D-81): gl_audit_events is append-only. Outside gl_factory_reset() every UPDATE and DELETE is refused. Inside it, DELETE is permitted, and UPDATE only when the sole change is journal_id, period_id or entity_id becoming null (the ON DELETE SET NULL of the rows being wiped).';
comment on function public.gl_guard_template_changes_append_only() is
  '0174, hatch added by 0238 (D-81): gl_template_changes is append-only. UPDATE is always refused. DELETE is refused except inside gl_factory_reset(), detected by gl_factory_reset_active().';
comment on function public.gl_ob_guard_frozen() is
  '0176, hatch added by 0238 (D-81): a posted opening balance row is frozen. UPDATE is always refused. DELETE of a posted row is refused except inside gl_factory_reset(), detected by gl_factory_reset_active().';
comment on function public.gl_override_log_is_append_only() is
  '0177, hatch added by 0238 (D-81): gl_override_log is append-only. UPDATE is always refused. DELETE is refused except inside gl_factory_reset(), detected by gl_factory_reset_active().';

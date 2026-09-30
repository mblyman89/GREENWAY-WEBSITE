-- =============================================================================
-- ROLLBACK for 0238_factory_reset_reaches_every_guard.sql (D-81)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Run it ONLY to undo 0238. It restores the four guard functions to the exact
-- bodies from 0174, 0176, 0177 and 0209 (extracted from those files, not
-- retyped).
-- Three transit-only edits for safe pasting: one comment lost its apostrophes,
-- one comment semicolon became a comma,
-- and the 0177 message em dash became a hyphen. Logic and codes identical.
--
-- WARNING: after this runs the factory reset is broken again. Any row in
-- gl_template_changes or gl_override_log, or any POSTED gl_opening_balances
-- row, or any audit event naming a journal (every journal posted or approved
-- through the app writes one), makes gl_factory_reset() raise and roll back,
-- even with the retention attestation ticked. That is the D-81 defect this
-- migration fixed.
-- =============================================================================

create or replace function public.gl_guard_template_changes_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'GL_APPEND_ONLY: gl_template_changes is a permanent record and cannot be % ', lower(tg_op)
    using errcode = 'raise_exception';
end $$;

create or replace function public.gl_ob_guard_frozen()
returns trigger language plpgsql as $$
begin
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

create or replace function public.gl_override_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'GL_OVERRIDE_LOG_APPEND_ONLY: the override log records what was actually done and can never be edited or deleted. If an override was a mistake, reverse the journal - that correction is itself part of the record.'
    using errcode = 'raise_exception';
end $$;

create or replace function public.gl_guard_audit_append_only()
returns trigger language plpgsql as $$
begin
  -- 0209: the append-only trail of a rehearsal is itself rehearsal data. Note
  -- this permits DELETE only, and UPDATE is still refused unconditionally, because
  -- there is no legitimate reason to REWRITE an audit event, ever.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;
  raise exception 'GL_IMMUTABLE: gl_audit_events is append-only.'
    using errcode = 'raise_exception';
end $$;

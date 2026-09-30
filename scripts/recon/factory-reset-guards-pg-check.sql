-- scripts/recon/factory-reset-guards-pg-check.sql  (D-81 - migration 0238)
--
-- Scenario check for 0238_factory_reset_reaches_every_guard.sql against a real
-- Postgres 15 that has every migration applied
-- (scripts/compliance/verify-migrations-execute.ts). Runs in ONE transaction
-- that is rolled back, so it leaves no rows behind. A run that prints
-- "FACTORY RESET GUARDS CHECK PASSED" and then ROLLBACK is the all-clear.
--
--   psql -h localhost -U postgres -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/factory-reset-guards-pg-check.sql
--
-- Each guarded table is filled the way the app fills it, not by a bare insert:
--   gl_template_changes  - written by trg_gl_templates_audit when a posting
--                          template is created (0174)
--   gl_override_log      - written by gl_approve_journal when the owner
--                          self-approves a journal at or above the threshold
--                          (0177, policy from 0211: allow_self_approval, 500000)
--   gl_opening_balances  - a staged worksheet row blessed to posted (0176)
--   gl_audit_events      - written by gl_approve_journal and gl_post_journal
--                          naming the journal (0172/0177). Its journal_id is
--                          ON DELETE SET NULL, so deleting the journal UPDATEs
--                          the audit row: the fourth blocker 0238 closes.
--
-- Part 1  fixture: an owner, and one row in each of the three guarded tables.
-- Part 2  OUTSIDE a reset every guard still refuses DELETE and UPDATE, by name,
--         including the exact FK-shaped update (journal_id to null) on
--         gl_audit_events.
-- Part 3  the real gl_factory_reset (attestation ticked) returns ok, empties
--         all three tables, and reports a truthful count for each.
-- Part 4  after the reset the hatch is closed again: a fresh override log row
--         still cannot be deleted. Inside a reset, an audit UPDATE that changes
--         anything besides nulling a pointer is still refused.
-- Part 5  the rollback file brings the D-81 defect back (the reset raises),
--         and re-applying 0238 cures it again. 0238 applied twice is a no-op.
begin;

-- Part 1 ---------------------------------------------------------------------
insert into auth.users (id, email)
  values ('00000000-0000-4000-8000-0000000d8101', 'owner-d81@example.com');
-- 0127 creates the staff_profiles row read-only and inactive, so UPDATE it.
update public.staff_profiles set role = 'owner', active = true, full_name = 'D81 Owner'
  where id = '00000000-0000-4000-8000-0000000d8101';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000d8101', true);

do $p1$
declare
  v_gw   uuid := (select id from public.gl_entities where code = 'greenway');
  v_cash uuid := (select id from public.gl_accounts where code = '10100');
  v_eq   uuid := (select id from public.gl_accounts where code = '40000');
  v_j    uuid;
  v_ob   uuid;
begin
  assert public.is_owner(), 'part1: is_owner() must be true or the reset below is vacuous';
  assert v_gw is not null and v_cash is not null and v_eq is not null, 'part1: fixtures exist';

  -- a posting template -> trg_gl_templates_audit writes gl_template_changes
  insert into public.gl_posting_templates
    (code, entity_id, source_kind, description, effective_from, max_autopost_cents, change_reason, created_by)
  values ('D81-TPL', v_gw, 'pos_sale', 'D81 rehearsal template', date '2026-10-01', 100000,
          'rehearsal template for D81', auth.uid());
  assert (select count(*) from public.gl_template_changes) >= 1, 'part1: template change logged';

  -- a draft of 600000 cents written by the owner, then approved by the owner
  -- -> gl_approve_journal writes gl_override_log (self + over threshold)
  insert into public.gl_journals (entity_id, journal_date, source_kind, memo, created_by)
    values (v_gw, date '2026-10-01', 'manual', 'D81 rehearsal entry', auth.uid())
    returning id into v_j;
  insert into public.gl_journal_lines (journal_id, line_no, account_id, entity_id, amount_cents)
    values (v_j, 1, v_cash, v_gw, 600000), (v_j, 2, v_eq, v_gw, -600000);
  perform public.gl_approve_journal(v_j, 'D81 rehearsal approval');
  assert (select count(*) from public.gl_override_log) >= 1, 'part1: override logged';
  -- and post it through the real door, which writes journal_posted
  perform public.gl_post_journal(v_j);
  assert (select status from public.gl_journals where id = v_j) = 'posted', 'part1: journal posted';
  assert (select count(*) from public.gl_audit_events where journal_id = v_j) >= 2,
    'part1: approval and posting audit events name the journal';

  -- a posted opening balance worksheet row
  insert into public.gl_opening_balances (entity_id, account_code, amount_cents, evidence_kind, evidence_ref, status, prepared_by)
    values (v_gw, '10100', 100, 'bank_statement', 'D81-STMT', 'staged', auth.uid())
    returning id into v_ob;
  insert into public.gl_journals (entity_id, journal_date, journal_no, status, source_kind, memo, posted_at, posted_by)
    values (v_gw, date '2025-12-31', 981001, 'posted', 'opening_balance', 'D81 opening balance', now(), auth.uid())
    returning id into v_j;
  update public.gl_opening_balances set status = 'posted', journal_id = v_j where id = v_ob;
  assert (select count(*) from public.gl_opening_balances where status = 'posted') >= 1, 'part1: posted opening balance';
end
$p1$;

-- Part 2 ---------------------------------------------------------------------
do $p2$
begin
  assert not public.gl_factory_reset_active(), 'part2: hatch is closed outside a reset';

  begin delete from public.gl_template_changes;
    raise exception 'part2: template change log DELETE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_APPEND_ONLY:%', 'part2: template delete refused by name, got ' || sqlerrm;
  end;
  begin update public.gl_template_changes set reason = 'rewritten history';
    raise exception 'part2: template change log UPDATE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_APPEND_ONLY:%', 'part2: template update refused by name, got ' || sqlerrm;
  end;

  begin delete from public.gl_override_log;
    raise exception 'part2: override log DELETE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_OVERRIDE_LOG_APPEND_ONLY:%', 'part2: override delete refused by name, got ' || sqlerrm;
  end;
  begin update public.gl_override_log set reason = 'rewritten history';
    raise exception 'part2: override log UPDATE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_OVERRIDE_LOG_APPEND_ONLY:%', 'part2: override update refused by name, got ' || sqlerrm;
  end;

  begin delete from public.gl_opening_balances where status = 'posted';
    raise exception 'part2: posted opening balance DELETE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_OB_FROZEN:%', 'part2: ob delete refused by name, got ' || sqlerrm;
  end;
  begin update public.gl_audit_events set journal_id = null where journal_id is not null;
    raise exception 'part2: audit event pointer UPDATE accepted outside a reset';
  exception when raise_exception then
    assert sqlerrm like 'GL_IMMUTABLE:%', 'part2: audit update refused by name, got ' || sqlerrm;
  end;
  begin delete from public.gl_audit_events;
    raise exception 'part2: audit event DELETE accepted outside a reset';
  exception when raise_exception then
    assert sqlerrm like 'GL_IMMUTABLE:%', 'part2: audit delete refused by name, got ' || sqlerrm;
  end;

  begin update public.gl_opening_balances set evidence_note = 'edited' where status = 'posted';
    raise exception 'part2: posted opening balance UPDATE accepted';
  exception when raise_exception then
    assert sqlerrm like 'GL_OB_FROZEN:%', 'part2: ob update refused by name, got ' || sqlerrm;
  end;
end
$p2$;

-- Part 3 ---------------------------------------------------------------------
do $p3$
declare
  r jsonb;
begin
  r := public.gl_factory_reset('ERASE ALL TEST DATA', true);
  assert (r->>'ok')::boolean, 'part3: reset ok, got ' || r::text;
  assert (select count(*) from public.gl_template_changes) = 0, 'part3: template changes emptied';
  assert (select count(*) from public.gl_override_log) = 0, 'part3: override log emptied';
  assert (select count(*) from public.gl_opening_balances) = 0, 'part3: opening balances emptied';
  assert (select count(*) from public.gl_journals) = 0, 'part3: journals emptied';
  assert (select count(*) from public.gl_audit_events) = 0, 'part3: audit events emptied';
  assert (r->'tables'->>'gl_override_log')::int >= 1, 'part3: override count reported, got ' || coalesce(r->'tables'->>'gl_override_log', 'null');
  assert (r->'tables'->>'gl_opening_balances')::int >= 1, 'part3: ob count reported';
  -- gl_posting_templates is KEEP, so no FK cascade can empty the change log:
  -- only the explicit delete can, and it must report its own count.
  assert (r->'tables'->>'gl_template_changes')::int >= 1, 'part3: template change count reported';
  assert (select count(*) from public.gl_posting_templates where code = 'D81-TPL') = 1, 'part3: the template itself is KEPT';
end
$p3$;

-- Part 4 ---------------------------------------------------------------------
do $p4$
begin
  assert not public.gl_factory_reset_active(), 'part4: hatch closed again after the reset';
  insert into public.gl_override_log (entity_id, override_kind, amount_cents, threshold_cents, actor, reason)
    values ((select id from public.gl_entities where code = 'greenway'), 'self_approval', 1, 1,
            auth.uid(), 'post reset probe row');
  begin delete from public.gl_override_log;
    raise exception 'part4: override log DELETE accepted after the reset';
  exception when raise_exception then
    assert sqlerrm like 'GL_OVERRIDE_LOG_APPEND_ONLY:%', 'part4: refused by name, got ' || sqlerrm;
  end;

  -- The audit hatch is narrow even INSIDE a reset: open it by hand for this
  -- subtransaction only, and prove a rewrite of the detail is still refused
  -- while the pure FK-shaped null is accepted.
  insert into public.gl_audit_events (event_kind, entity_id, detail)
    values ('journal_posted', (select id from public.gl_entities where code = 'greenway'), 'original detail');
  begin
    perform set_config('greenway.factory_reset', 'on', true);
    begin
      update public.gl_audit_events set detail = 'rewritten', entity_id = null where detail = 'original detail';
      raise exception 'part4: audit rewrite accepted inside a reset';
    exception when raise_exception then
      assert sqlerrm like 'GL_IMMUTABLE:%', 'part4: audit rewrite refused inside a reset, got ' || sqlerrm;
    end;
    update public.gl_audit_events set entity_id = null where detail = 'original detail';
    assert (select entity_id from public.gl_audit_events where detail = 'original detail') is null,
      'part4: the FK-shaped null is accepted inside a reset';
    perform set_config('greenway.factory_reset', 'off', true);
  end;
  assert not public.gl_factory_reset_active(), 'part4: hatch closed again';
end
$p4$;

-- Part 5 ---------------------------------------------------------------------
\ir ../../supabase/rollbacks/0238_factory_reset_reaches_every_guard.rollback.sql
do $p5a$
begin
  begin
    perform public.gl_factory_reset('ERASE ALL TEST DATA', true);
    raise exception 'part5: reset succeeded without 0238 - the rollback did not restore the old guard';
  exception when raise_exception then
    assert sqlerrm like 'GL_OVERRIDE_LOG_APPEND_ONLY:%', 'part5: old guard blocks the reset, got ' || sqlerrm;
  end;
end
$p5a$;
\ir ../../supabase/migrations/0238_factory_reset_reaches_every_guard.sql
\ir ../../supabase/migrations/0238_factory_reset_reaches_every_guard.sql
do $p5b$
declare
  r jsonb;
begin
  r := public.gl_factory_reset('ERASE ALL TEST DATA', true);
  assert (r->>'ok')::boolean, 'part5: reset ok after re-applying 0238 twice';
  assert (select count(*) from public.gl_override_log) = 0, 'part5: probe row emptied';
  assert (select count(*) from public.gl_audit_events) = 0, 'part5: audit probe emptied';
end
$p5b$;

select 'FACTORY RESET GUARDS CHECK PASSED' as result;
rollback;

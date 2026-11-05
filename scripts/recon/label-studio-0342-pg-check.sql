-- scripts/recon/label-studio-0342-pg-check.sql  (D177 S6 - migration 0342)
--
-- Scenario check for 0342_label_studio.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0342 applies twice (idempotent);
--   * grants: label_templates service_role select / insert / update, never delete;
--     label_print_log service_role select / insert only (append-only); nothing for anon /
--     authenticated; RLS on both; the function is service_role only;
--   * one live name per kind (case-insensitive), archived names free again;
--   * at most one default per kind, moved atomically by label_template_set_default;
--   * an archived design cannot be default; unknown kind / bad ids / 0 or 1001 labels refused;
--   * the app's history lookup (subject_ids @> array[id]) works as service_role.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/label-studio-0342-pg-check.sql
--
-- "LABEL STUDIO 0342 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0342_label_studio.sql
\i supabase/migrations/0342_label_studio.sql

do $$
begin
  assert has_table_privilege('service_role', 'public.label_templates', 'SELECT'), 'templates: read';
  assert has_table_privilege('service_role', 'public.label_templates', 'INSERT'), 'templates: insert';
  assert has_table_privilege('service_role', 'public.label_templates', 'UPDATE'), 'templates: update';
  assert not has_table_privilege('service_role', 'public.label_templates', 'DELETE'), 'templates: never deleted';
  assert not has_table_privilege('service_role', 'public.label_templates', 'TRUNCATE'), 'templates: never truncated';
  assert has_table_privilege('service_role', 'public.label_print_log', 'SELECT'), 'log: read';
  assert has_table_privilege('service_role', 'public.label_print_log', 'INSERT'), 'log: insert';
  assert not has_table_privilege('service_role', 'public.label_print_log', 'UPDATE'), 'log: never changed';
  assert not has_table_privilege('service_role', 'public.label_print_log', 'DELETE'), 'log: never deleted';
  assert not has_table_privilege('service_role', 'public.label_print_log', 'TRUNCATE'), 'log: never truncated';
  assert not has_table_privilege('anon', 'public.label_templates', 'SELECT'), 'anon: no templates';
  assert not has_table_privilege('authenticated', 'public.label_templates', 'SELECT'), 'authenticated: no templates';
  assert not has_table_privilege('anon', 'public.label_print_log', 'INSERT'), 'anon: no log';
  assert not has_table_privilege('authenticated', 'public.label_print_log', 'SELECT'), 'authenticated: no log';
  assert (select relrowsecurity from pg_class where oid = 'public.label_templates'::regclass), 'RLS on templates';
  assert (select relrowsecurity from pg_class where oid = 'public.label_print_log'::regclass), 'RLS on log';
  assert has_function_privilege('service_role', 'public.label_template_set_default(uuid, text)', 'EXECUTE'), 'fn: service_role';
  assert not has_function_privilege('anon', 'public.label_template_set_default(uuid, text)', 'EXECUTE'), 'fn: not anon';
  assert not has_function_privilege('authenticated', 'public.label_template_set_default(uuid, text)', 'EXECUTE'), 'fn: not authenticated';
end $$;

create or replace function pg_temp.try_as(r text, sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', r);
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ran';
end $$;

do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  c uuid := '33333333-3333-4333-8333-333333333333';
  lot1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r text;
  n int;
begin
  -- What the app writes, as the server.
  r := pg_temp.try_as('service_role', format($q$insert into public.label_templates (id, kind, name, printer_id, stock_id, template, is_default)
       values (%L, 'lot', 'Re-barcode 2x1 QR', 'rollo-x1040', 'rollo-2x1', '{"symbology":"qr"}', true),
              (%L, 'lot', 'Shelf 4x6', 'rollo-x1040', 'rollo-4x6', '{}', false),
              (%L, 'nc', 'Re-barcode 2x1 QR', 'rollo-x1040', 'custom-2.25x1.25', '{}', true)$q$, a, b, c));
  assert r = 'ran', 'service_role saves designs: ' || r;

  -- Same live name in the same kind (any case / padding) is refused; other kind is fine (above).
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('lot', '  re-barcode 2X1 qr ', 'rollo-x1040', 'rollo-2x1', '{}')$q$);
  assert r = '23505', 'duplicate live name refused: ' || r;
  -- A second default for the kind is refused.
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template, is_default) values ('lot', 'Other', 'rollo-x1040', 'rollo-2x1', '{}', true)$q$);
  assert r = '23505', 'second default refused: ' || r;
  -- Bad kind / ids / template shape.
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('plant', 'X', 'rollo-x1040', 'rollo-2x1', '{}')$q$);
  assert r = '23514', 'unknown kind refused: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('lot', 'X', 'a b', 'rollo-2x1', '{}')$q$);
  assert r = '23514', 'bad printer id refused: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('lot', 'X', 'rollo-x1040', 'rollo-2x1', '[]')$q$);
  assert r = '23514', 'template must be an object: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('lot', '   ', 'rollo-x1040', 'rollo-2x1', '{}')$q$);
  assert r = '23514', 'blank name refused: ' || r;
  -- Designs are archived, never deleted.
  r := pg_temp.try_as('service_role', format('delete from public.label_templates where id = %L', b));
  assert r = '42501', 'service_role cannot delete a design: ' || r;

  -- Move the default atomically.
  r := pg_temp.try_as('service_role', format($q$select public.label_template_set_default(%L, 'lot')$q$, b));
  assert r = 'ran', 'set default: ' || r;
  assert (select count(*) from public.label_templates where kind = 'lot' and is_default) = 1, 'exactly one lot default';
  assert (select is_default from public.label_templates where id = b), 'b is now default';
  assert (select is_default from public.label_templates where id = c), 'nc default untouched';
  r := pg_temp.try_as('service_role', format($q$select public.label_template_set_default(%L, 'nc')$q$, b));
  assert r = 'P0002', 'wrong kind refused: ' || r;
  r := pg_temp.try_as('service_role', format($q$select public.label_template_set_default(%L, 'x')$q$, b));
  assert r = '22023', 'unknown kind refused: ' || r;

  -- An archived design cannot stay default; archiving frees the name.
  r := pg_temp.try_as('service_role', format($q$update public.label_templates set archived_at = now() where id = %L$q$, b));
  assert r = '23514', 'archived default refused: ' || r;
  r := pg_temp.try_as('service_role', format($q$update public.label_templates set archived_at = now() where id = %L$q$, a));
  assert r = 'ran', 'archive a non-default: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_templates (kind, name, printer_id, stock_id, template) values ('lot', 'Re-barcode 2x1 QR', 'rollo-x1040', 'rollo-2x1', '{}')$q$);
  assert r = 'ran', 'archived name is free again: ' || r;
  r := pg_temp.try_as('service_role', format($q$select public.label_template_set_default(%L, 'lot')$q$, a));
  assert r = 'P0002', 'archived design cannot become default: ' || r;

  -- Print history: append-only.
  r := pg_temp.try_as('service_role', format($q$insert into public.label_print_log
       (printed_by_email, kind, printer_id, stock_id, symbology, total_labels, item_count, subject_ids, items, template, template_id, context)
       values ('staff@example.com', 'lot', 'rollo-x1040', 'rollo-2x1', 'qr', 3, 1, array[%L]::uuid[],
               '[{"subjectId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","copies":3,"codeValue":"6034A"}]', '{"symbology":"qr"}', %L, 'Manifest 1')$q$, lot1, b));
  assert r = 'ran', 'service_role records a print: ' || r;
  r := pg_temp.try_as('service_role', $q$update public.label_print_log set total_labels = 1$q$);
  assert r = '42501', 'history never changed: ' || r;
  r := pg_temp.try_as('service_role', $q$delete from public.label_print_log$q$);
  assert r = '42501', 'history never deleted: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_print_log (kind, printer_id, stock_id, symbology, total_labels, item_count, subject_ids, items) values ('lot', 'p', 's', 'qr', 0, 1, array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[], '[]')$q$);
  assert r = '23514', 'zero-label job refused: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_print_log (kind, printer_id, stock_id, symbology, total_labels, item_count, subject_ids, items) values ('lot', 'p', 's', 'qr', 1001, 1, array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[], '[]')$q$);
  assert r = '23514', '1001-label job refused: ' || r;
  r := pg_temp.try_as('service_role', $q$insert into public.label_print_log (kind, printer_id, stock_id, symbology, total_labels, item_count, subject_ids, items) values ('lot', 'p', 's', 'qr', 1, 1, array[]::uuid[], '[]')$q$);
  assert r = '23514', 'no subjects refused: ' || r;
  r := pg_temp.try_as('anon', $q$insert into public.label_print_log (kind, printer_id, stock_id, symbology, total_labels, item_count, subject_ids, items) values ('lot', 'p', 's', 'qr', 1, 1, array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[], '[]')$q$);
  assert r = '42501', 'anon cannot write history: ' || r;

  -- The app's per-item lookup.
  set local role service_role;
  select count(*) into n from public.label_print_log where subject_ids @> array[lot1];
  reset role;
  assert n = 1, 'history found by subject';
end $$;

\echo 'LABEL STUDIO 0342 CHECK PASSED'
rollback;

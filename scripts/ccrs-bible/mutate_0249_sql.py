#!/usr/bin/env python3
"""Test the test: each mutant of migration 0249 / its rollback must make
scripts/recon/ccrs-lifecycle-pg-check.sql FAIL. Needs PGURL (a database with
all migrations through 0249 applied; the check re-applies 0249 inside one
transaction that is itself rolled back).
Usage: PGURL=postgres://... python3 scripts/ccrs-bible/mutate_0249_sql.py"""
import os, subprocess, sys, shutil
MIG = "supabase/migrations/0249_ccrs_upload_lifecycle.sql"
RB = "supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql"
CHECK = "scripts/recon/ccrs-lifecycle-pg-check.sql"
MUTANTS = [
    # upload groups mirror uploadGroupOf()
    ("L1", MIG, "    when 'Inventory' then 2\n", "    when 'Inventory' then 1\n"),
    ("L2", MIG, "when 'InventoryTransfer' then 3", "when 'InventoryTransfer' then 2"),
    # mark_uploaded guards
    ("L3", MIG, "  if f.state <> 'emitted' then\n    raise exception 'CCRS_UPLOAD_NOT_EMITTED", "  if f.state not in ('emitted', 'uploaded', 'abandoned') then\n    raise exception 'CCRS_UPLOAD_NOT_EMITTED"),
    ("L4", MIG, "  if p_uploaded_at is null or p_uploaded_at > now() + interval '5 minutes'", "  if p_uploaded_at > now() + interval '5 minutes'"),
    ("L5", MIG, "     or p_uploaded_at < f.emitted_at - interval '1 minute' then", "     or false then"),
    ("L6", MIG, "  if p_uploaded_at is null or p_uploaded_at > now() + interval '5 minutes'", "  if p_uploaded_at is null or p_uploaded_at > now() + interval '2 hours'"),
    ("L7", MIG, "  if v_hash is distinct from f.sha256 then", "  if false then"),
    # pacing (Brian A27)
    ("L8", MIG, "     and o.state in ('emitted', 'uploaded');", "     and o.state in ('uploaded');"),
    ("L9", MIG, "o.stamp_at < f.stamp_at\n     and o.state in", "o.stamp_at > f.stamp_at\n     and o.state in"),
    ("L10", MIG, "  if v_block is not null and length(trim(coalesce(p_override, ''))) < 10 then", "  if v_block is not null and length(coalesce(p_override, '')) < 10 then"),
    ("L11", MIG, "  if v_block is not null and length(trim(coalesce(p_override, ''))) < 10 then", "  if v_block is not null and length(trim(coalesce(p_override, ''))) < 3 then"),
    ("L12", MIG, "         notes = case when v_block is null then notes", "         notes = case when true then notes"),
    # dependencies
    ("L13", MIG, "where e.env = f.env and e.file_type = 'Product' and e.filed_name = r.payload->>'Product'\n                            and e.state in ('seed', 'filed', 'confirmed'))\n      union", "where e.env = f.env and e.file_type = 'Product'\n                            and e.state in ('seed', 'filed', 'confirmed'))\n      union"),
    ("L14", MIG, "lower(e.external_id) = lower(r.payload->>'Strain')", "e.external_id = r.payload->>'Strain'"),
    ("L15", MIG, "                          where e.env = f.env and e.file_type = 'Inventory' and e.external_id = r.payload->>'InventoryExternalIdentifier'\n                            and e.state in ('seed', 'filed', 'confirmed', 'closed'))", "                          where e.env = f.env and e.file_type = 'Inventory'\n                            and e.state in ('seed', 'filed', 'confirmed', 'closed'))"),
    ("L16", MIG, "  update public.ccrs_file_rows set state = 'submitted' where file_id = f.id and state = 'emitted';", ""),
    # promote_rows
    ("L17", MIG, "case when f.file_type = 'Inventory' and nullif(i.payload->>'QuantityOnHand', '')::numeric = 0 then 'closed' else 'filed' end,", "'filed',"),
    ("L18", MIG, "         case f.file_type when 'Product' then i.payload->>'Name' when 'Area' then i.payload->>'Area'", "         case f.file_type when 'Product' then i.external_id when 'Area' then i.payload->>'Area'"),
    ("L19", MIG, "           select case when count(*) = 1 then min(p.external_id) end", "           select min(p.external_id)"),
    ("L20", MIG, "   where e.state = 'deleted';\n\n  update public.ccrs_filed_entities e\n     set last_operation = 'Update'", "   where true;\n\n  update public.ccrs_filed_entities e\n     set last_operation = 'Update'"),
    ("L21", MIG, "filed_name = case f.file_type when 'Product' then r.payload->>'Name' when 'Area' then r.payload->>'Area' else e.filed_name end,", "filed_name = e.filed_name,"),
    ("L22", MIG, "                   when f.file_type = 'Inventory' and e.state = 'closed' then 'filed'\n", ""),
    ("L23", MIG, "   where r.file_id = f.id and r.id = any(p_row_ids) and r.operation = 'Update'\n", "   where r.file_id = f.id and r.operation = 'Update'\n"),
    ("L24", MIG, "    if v_unres > 0 then", "    if v_unres > 1 then"),
    # record_outcome guards
    ("L25", MIG, "  if f.state <> 'uploaded' then\n    raise exception 'CCRS_OUTCOME_NOT_UPLOADED", "  if f.state not in ('uploaded', 'succeeded', 'closed') then\n    raise exception 'CCRS_OUTCOME_NOT_UPLOADED"),
    ("L26", MIG, "  if p_outcome is null or p_outcome not in", "  if p_outcome not in"),
    ("L27", MIG, "or p_at < f.uploaded_at - interval '5 minutes' then", "or false then"),
    ("L28", MIG, "  if p_outcome = 'no-email' and p_at < f.uploaded_at + interval '60 minutes' then", "  if p_outcome = 'no-email' and p_at < f.uploaded_at + interval '30 minutes' then"),
    ("L29", MIG, "  if p_outcome like 'error-%' and coalesce(array_length(p_messages, 1), 0) = 0 then", "  if p_outcome like 'error-%' and p_messages is null then"),
    ("L30", MIG, "  if (p_outcome = 'error-rows') <> (jsonb_array_length(coalesce(p_rejected, '[]'::jsonb)) > 0) then", "  if p_outcome = 'error-rows' and jsonb_array_length(coalesce(p_rejected, '[]'::jsonb)) = 0 then"),
    ("L31", MIG, "                where jsonb_typeof(x->'row_no') <> 'number' or coalesce(x->>'message', '') = ''", "                where coalesce(x->>'message', '') = ''"),
    ("L32", MIG, "       or (select count(distinct (x->>'row_no')) from jsonb_array_elements(p_rejected) x) <> jsonb_array_length(p_rejected)\n", ""),
    ("L33", MIG, "                   or jsonb_typeof(coalesce(x->'uncertain', 'null'::jsonb)) <> 'boolean')", "                   or false)"),
    ("L34", MIG, "  if jsonb_typeof(coalesce(p_rejected, '[]'::jsonb)) <> 'array' then", "  if false then"),
    # outcome effects
    ("L35", MIG, "  v_closable := f.file_type in ('Strain', 'Area', 'Sale', 'InventoryAdjustment', 'InventoryTransfer');", "  v_closable := f.file_type in ('Strain', 'Area', 'Sale', 'InventoryAdjustment', 'InventoryTransfer', 'Inventory');"),
    ("L36", MIG, "  v_closable := f.file_type in ('Strain', 'Area', 'Sale', 'InventoryAdjustment', 'InventoryTransfer');", "  v_closable := f.file_type in ('Strain', 'Area', 'InventoryAdjustment', 'InventoryTransfer');"),
    ("L37", MIG, "       set state = case when (x->>'uncertain')::boolean then 'uncertain' else 'rejected' end", "       set state = 'rejected'"),
    ("L38", MIG, "    perform public.ccrs_promote_rows(f.id, v_ok, p_at);", "    perform public.ccrs_promote_rows(f.id, v_ok || v_rej, p_at);"),
    ("L39", MIG, "    if v_closable then\n      update public.ccrs_file_rows set state = 'confirmed' where id = any(v_ok);", "    if true then\n      update public.ccrs_file_rows set state = 'confirmed' where id = any(v_ok);"),
    ("L40", MIG, "    if cardinality(v_unc) > 0 then", "    if false then"),
    ("L41", MIG, "       set state = 'uncertain', last_file_id = excluded.last_file_id;\n    -- every other row", "       set last_file_id = excluded.last_file_id;\n    -- every other row"),
    ("L42", MIG, "      update public.ccrs_files set state = 'errored', error_email_at = p_at, error_messages = p_messages where id = f.id;\n      v_final := 'errored';", "      update public.ccrs_files set state = 'errored', error_email_at = p_at where id = f.id;\n      v_final := 'errored';"),
    ("L43", MIG, "         where r.id = any(v_ok) and r.operation = 'Update'", "         where r.id = any(v_ok)"),
    ("L44", MIG, "           and gf.stamp_at < f.stamp_at and gf.state in ('succeeded', 'errored')", "           and gf.state in ('succeeded', 'errored')"),
    ("L45", MIG, "         where e.env = f.env and e.file_type = f.file_type and e.state = 'filed'", "         where e.env = f.env and e.file_type = f.file_type and e.state in ('filed', 'seed')"),
    ("L46", MIG, "                          where g.file_id = gf.id and g.state not in ('confirmed', 'rejected', 'withheld'));", "                          where g.file_id = gf.id and g.state not in ('confirmed', 'rejected', 'withheld', 'submitted'));"),
    ("L47", MIG, "    update public.ccrs_file_rows set state = 'rejected' where file_id = f.id;\n    update public.ccrs_files set state = 'errored'", "    update public.ccrs_files set state = 'errored'"),
    ("L48", MIG, "    update public.ccrs_file_rows set state = 'uncertain' where file_id = f.id;\n", ""),
    ("L49", MIG, "     where r.file_id = f.id and coalesce(r.operation, 'Insert') in ('Insert', 'Delete')\n     order by r.external_id, r.row_no\n    on conflict (env, file_type, external_id) do update\n       set state = 'uncertain', last_file_id = excluded.last_file_id;\n    if p_outcome", "     and false\n     order by r.external_id, r.row_no\n    on conflict (env, file_type, external_id) do update\n       set state = 'uncertain', last_file_id = excluded.last_file_id;\n    if p_outcome"),
    ("L50", MIG, "    if p_outcome = 'error-unmatched' then\n      update public.ccrs_files set state = 'errored'", "    if true then\n      update public.ccrs_files set state = 'errored'"),
    ("L51", MIG, "      update public.ccrs_files set state = 'succeeded', success_email_at = p_at where id = f.id;", "      update public.ccrs_files set state = 'succeeded' where id = f.id;"),
    # abandon
    ("L52", MIG, "  if f.state <> 'emitted' then\n    raise exception 'CCRS_ABANDON_NOT_EMITTED", "  if f.state not in ('emitted', 'closed') then\n    raise exception 'CCRS_ABANDON_NOT_EMITTED"),
    ("L53", MIG, "  if length(trim(coalesce(p_reason, ''))) < 10 then", "  if length(trim(coalesce(p_reason, ''))) < 5 then"),
    ("L54", MIG, "     set state = 'abandoned', notes = concat_ws(E'\\n', notes, 'ABANDONED: ' || trim(p_reason))", "     set state = 'abandoned'"),
    # PREprod start
    ("L55", MIG, "  if v_id is not null then\n    return jsonb_build_object('status', 'already', 'id', v_id);", "  if false then\n    return jsonb_build_object('status', 'already', 'id', v_id);"),
    ("L56", MIG, "  if length(trim(coalesce(p_by, ''))) = 0 then", "  if p_by is null then"),
    ("L57", MIG, "  values ('preprod', 'Area', 'seed',", "  values ('prod', 'Area', 'seed',"),
    # grants / hygiene
    ("L58", MIG, "grant execute on function public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]) to service_role;", "grant execute on function public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]) to service_role, authenticated;"),
    ("L59", MIG, "revoke all on function public.ccrs_promote_rows(uuid, uuid[], timestamptz) from public, anon, authenticated;", "grant execute on function public.ccrs_promote_rows(uuid, uuid[], timestamptz) to service_role;"),
    ("L60", MIG, "create or replace function public.ccrs_abandon_file(p_file_id uuid, p_reason text)\nreturns jsonb\nlanguage plpgsql\n", "create or replace function public.ccrs_abandon_file(p_file_id uuid, p_reason text)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\n"),
    ("L61", MIG, "grant execute on function public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text) to service_role;", ""),
    # rollback
    ("L62", RB, "drop function if exists public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]);\n", ""),
    ("L63", RB, "drop function if exists public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text);\n", "drop function if exists public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text);\ndelete from public.ccrs_file_issues;\n"),
]
url = os.environ.get("PGURL")
if not url:
    print("PGURL not set: SKIPPED (no database)"); sys.exit(2)
def run():
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-f", CHECK], capture_output=True, text=True)
    return r.returncode == 0 and "CCRS LIFECYCLE CHECK PASSED" in (r.stdout + r.stderr)
assert run(), "baseline check must pass before mutating"
killed = survived = 0
for mid, f, old, new in MUTANTS:
    src = open(f).read()
    if src.count(old) != 1:
        print(f"{mid} STALE (anchor count {src.count(old)})"); survived += 1; continue
    shutil.copy(f, f + ".bak")
    try:
        open(f, "w").write(src.replace(old, new))
        ok = run()
    finally:
        shutil.move(f + ".bak", f)
    print(f"{mid} {'SURVIVED' if ok else 'killed'}")
    killed += (not ok); survived += ok
assert run(), "baseline must pass after restore"
print(f"killed={killed} survived={survived}")
sys.exit(1 if survived else 0)

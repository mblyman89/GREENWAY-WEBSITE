#!/usr/bin/env python3
"""Test the test: each mutant of migration 0248 / its rollback must make
scripts/recon/ccrs-outbox-pg-check.sql FAIL. Needs PGURL (a database with all
migrations through 0247 applied; the check rolls 0248 back and re-applies it
inside one transaction that is itself rolled back).
Usage: PGURL=postgres://... python3 scripts/ccrs-bible/mutate_0248_sql.py"""
import os, subprocess, sys, shutil
MIG = "supabase/migrations/0248_ccrs_outbox.sql"
RB = "supabase/rollbacks/0248_ccrs_outbox.rollback.sql"
CHECK = "scripts/recon/ccrs-outbox-pg-check.sql"
MUTANTS = [
    # same data never twice (Brian A29) - M-c at the database
    ("O1", MIG, "    if v_dup is not null then\n      v_out := v_out || v_dup;\n      continue;\n    end if;", "    if false then\n      v_out := v_out || v_dup;\n      continue;\n    end if;"),
    ("O2", MIG, "     where c.env = p_env and c.sha256 = f->>'sha256';", "     where c.sha256 = f->>'sha256';"),
    # monotonic stamps (Part 05 B)
    ("O3", MIG, "  if v_last is not null and v_min is not null and v_min <= v_last then", "  if v_last is not null and v_min is not null and v_min < v_last then"),
    ("O4", MIG, "  if exists (select 1 from jsonb_array_elements(p_files) x where nullif(x->>'stamp_at', '') is null) then", "  if false then"),
    # the bytes
    ("O5", MIG, "    if encode(sha256(convert_to(f->>'content', 'UTF8')), 'hex') is distinct from f->>'sha256' then", "    if false then"),
    ("O6", MIG, "    if right(f->>'content', 2) <> E'\\r\\n' then", "    if false then"),
    ("O7", MIG, "    if v_lines[3] <> ('NumberRecords,' || v_n::text) or (f->>'number_records')::integer <> v_n then", "    if v_lines[3] <> ('NumberRecords,' || v_n::text) then"),
    ("O8", MIG, "       where coalesce(array_length(string_to_array(d.line, ','), 1), 0) <> array_length(v_cols, 1)", "       where coalesce(array_length(string_to_array(d.line, ','), 1), 0) > array_length(v_cols, 1)"),
    ("O9", MIG, "  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then", "  if jsonb_typeof(p_files) <> 'array' then"),
    ("O10", MIG, "  if p_env not in ('preprod', 'prod') then\n    raise exception 'CCRS_EMIT_BAD_ENV", "  if false then\n    raise exception 'CCRS_EMIT_BAD_ENV"),
    # rows/issues/state written
    ("O11", MIG, "    select v_id, d.n::integer, e.id, p.payload->>v_idcol, nullif(p.payload->>'Operation', ''), p.payload, 'emitted'", "    select v_id, d.n::integer, e.id, p.payload->>v_idcol, 'Insert', p.payload, 'emitted'"),
    ("O12", MIG, "    if v_inflight > 0 then", "    if v_inflight > 1 then"),
    ("O13", MIG, "       set state = 'emitted', sha256 = f->>'sha256', storage_path", "       set state = 'emitted', sha256 = repeat('0', 64), storage_path"),
    # stored bytes are a record
    ("O14", MIG, "  if tg_op = 'UPDATE' then\n    raise exception 'CCRS_CONTENT_IMMUTABLE", "  if false then\n    raise exception 'CCRS_CONTENT_IMMUTABLE"),
    ("O15", MIG, "  if exists (select 1 from public.ccrs_files f where f.id = old.file_id and f.state <> 'draft') then", "  if false then"),
    ("O16", MIG, "  constraint ccrs_file_contents_length_matches check (byte_length = octet_length(content))", "  constraint ccrs_file_contents_length_matches check (byte_length >= 0)"),
    # GWP ids (D-01a)
    ("O17", MIG, "  raise exception 'CCRS_PRODUCT_ID_IS_RECORD: an assigned CCRS Product id can never be changed or removed'\n    using errcode = 'check_violation';", "  return coalesce(new, old);"),
    ("O18", MIG, "  external_id  text not null check (external_id ~ '^(P[0-9]{8}[A-Z]-)?GWP-[0-9]{6}$'),", "  external_id  text not null,"),
    ("O19", MIG, "  constraint ccrs_product_ids_env_ext unique (env, external_id)", "  constraint ccrs_product_ids_env_ext check (true)"),
    ("O20", MIG, "  if (p_env = 'preprod') <> (p_preprod_run is not null) then", "  if false then"),
    ("O21", MIG, "    if exists (select 1 from public.ccrs_product_ids c where c.env = p_env and c.product_key = k) then", "    if false then"),
    # lot linking (Part 03 D.5)
    ("O22", MIG, "  if p_apply then", "  if true then"),
    ("O23", MIG, "       and l.status <> 'destroyed'\n       and coalesce(trim(l.ccrs_inventory_external_id), '') <> ''\n    on conflict", "       and coalesce(trim(l.ccrs_inventory_external_id), '') <> ''\n    on conflict"),
    ("O24", MIG, "    select distinct 'prod', 'Inventory', trim(l.ccrs_inventory_external_id), 'unknown', 'link:unfiled-migration-lot'\n      from public.inventory_lots l\n     where l.notes like", "    select distinct 'prod', 'Inventory', trim(l.ccrs_inventory_external_id), 'unknown', 'link:unfiled-migration-lot'\n      from public.inventory_lots l\n     where true or l.notes like"),
    ("O25", MIG, "  if v_ledger = 0 then", "  if v_ledger < 0 then"),
    # grants / RLS
    ("O26", MIG, "revoke all on function public.ccrs_emit_files(text, jsonb, jsonb) from public, anon, authenticated;\n", ""),
    ("O27", MIG, "alter table public.ccrs_product_ids   enable row level security;\n", ""),
    ("O28", MIG, "grant execute on function public.ccrs_emit_files(text, jsonb, jsonb) to service_role;\n", ""),
    # rollback
    ("O29", RB, "    raise exception 'ROLLBACK_REFUSED: ccrs_product_ids holds assigned CCRS Product ids; export them first';", "    raise notice 'skipped';"),
    ("O30", RB, "      raise exception 'ROLLBACK_REFUSED: ccrs_files holds emitted outbox files; export them first';", "      raise notice 'skipped';"),
    ("O31", RB, "    raise exception 'ROLLBACK_REFUSED: a linked lot entity has moved past unknown; it is a record now';", "    raise notice 'skipped';"),
    ("O32", RB, "drop sequence if exists public.ccrs_gwp_seq;\n", ""),
    ("O33", RB, "delete from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot' and state = 'unknown';\n", ""),
    ("O34", RB, "alter table if exists public.ccrs_files drop column if exists stamp_at;\n", ""),
    # seed finalize (Part 03 D.4/D.5)
    ("O35", MIG, "  if v_got is distinct from (p_expected->'entities') then", "  if false then"),
    ("O36", MIG, "    if v_closed <> (p_expected->>'inventoryClosed')::integer then", "    if false then"),
    ("O37", MIG, "   where env = 'prod' and source = p_source;\n  if v_got", "   where env = 'prod';\n  if v_got"),
    ("O38", MIG, "  select * into r from public.ccrs_link_unfiled_migration_lots(true);\n", "  select * into r from public.ccrs_link_unfiled_migration_lots(false);\n"),
    ("O39", MIG, "  if p_source is null or p_source !~ '^seed:[0-9]{4}-[0-9]{2}-[0-9]{2}-delivery$' then", "  if p_source is null then"),
    ("O40", MIG, "     or (select count(distinct x->>'file_type') from jsonb_array_elements(p_provenance) x", "     or 4 <> 4 and (select count(distinct x->>'file_type') from jsonb_array_elements(p_provenance) x"),
    ("O41", MIG, "              where coalesce(x->>'sha256', '') !~ '^[0-9a-f]{64}$'\n                 or", "              where false and coalesce(x->>'sha256', '') !~ '^[0-9a-f]{64}$'\n                 or"),
    ("O42", MIG, "    on conflict do nothing;\n  end loop;", "    ;\n  end loop;"),
    ("O43", MIG, "grant execute on function public.ccrs_seed_finalize(text, jsonb, jsonb) to service_role;\n", "grant execute on function public.ccrs_seed_finalize(text, jsonb, jsonb) to service_role, authenticated;\n"),
    ("O44", RB, "drop function if exists public.ccrs_seed_finalize(text, jsonb, jsonb);\n", ""),
    # ledger slice (Part 03 D.3: route against exactly what CCRS holds, per env)
    ("O45", MIG, "     where e.env = p_env and e.file_type = 'Inventory' and e.external_id = any(coalesce(p_inventory_ids, '{}'))", "     where e.file_type = 'Inventory' and e.external_id = any(coalesce(p_inventory_ids, '{}'))"),
    ("O46", MIG, "     where e.env = p_env and e.file_type = 'Inventory' and e.external_id = any(coalesce(p_inventory_ids, '{}'))", "     where e.env = p_env and e.file_type = 'Inventory'"),
    ("O47", MIG, "       and (e.external_id in (select i.product_external_id from inv i where i.product_external_id is not null)\n            or ", "       and (false\n            or "),
    ("O48", MIG, "            or e.external_id in (select c.external_id from public.ccrs_product_ids c where c.env = p_env)\n", ""),
    ("O49", MIG, "\n            or e.filed_name = any(coalesce(p_product_names, '{}')))", ")"),
    ("O50", MIG, "     where e.env = p_env and e.file_type in ('Strain', 'Area')", "     where e.file_type in ('Strain', 'Area')"),
    ("O51", MIG, "    'loaded', exists (select 1 from public.ccrs_files f where f.env = p_env and f.purpose = 'seed' and f.state = 'closed'),", "    'loaded', true,"),
    ("O52", MIG, "    'loaded', exists (select 1 from public.ccrs_files f where f.env = p_env and f.purpose = 'seed' and f.state = 'closed'),", "    'loaded', exists (select 1 from public.ccrs_files f where f.purpose = 'seed' and f.state = 'closed'),"),
    ("O53", MIG, "    'last_stamp', (select max(f.stamp_at) from public.ccrs_files f where f.env = p_env),", "    'last_stamp', (select max(f.stamp_at) from public.ccrs_files f),"),
    ("O54", MIG, "                               from public.ccrs_product_ids c where c.env = p_env), '[]'::jsonb));", "                               from public.ccrs_product_ids c), '[]'::jsonb));"),
    ("O55", MIG, "    raise exception 'CCRS_SLICE_BAD_ENV: %', p_env using errcode = 'check_violation';", "    null;"),
    ("O56", MIG, "grant execute on function public.ccrs_ledger_slice(text, text[], text[]) to service_role;\n", "grant execute on function public.ccrs_ledger_slice(text, text[], text[]) to service_role, authenticated;\n"),
    ("O57", RB, "drop function if exists public.ccrs_ledger_slice(text, text[], text[]);\n", ""),
]
url = os.environ.get("PGURL")
if not url:
    print("PGURL not set: SKIPPED (no database)"); sys.exit(2)
def run():
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-f", CHECK], capture_output=True, text=True)
    return r.returncode == 0 and "CCRS OUTBOX CHECK PASSED" in (r.stdout + r.stderr)
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

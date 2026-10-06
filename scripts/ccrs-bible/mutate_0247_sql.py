#!/usr/bin/env python3
"""Test the test: each mutant of migration 0247 / its rollback must make
scripts/recon/ccrs-ledger-pg-check.sql FAIL. Needs PGURL (a database with all
migrations through 0246 applied, or 0247 too — the check re-applies it).
Usage: PGURL=postgres://... python3 scripts/ccrs-bible/mutate_0247_sql.py"""
import os, subprocess, sys, shutil
MIG = "supabase/migrations/0247_ccrs_ledger.sql"
RB = "supabase/rollbacks/0247_ccrs_ledger.rollback.sql"
CHECK = "scripts/recon/ccrs-ledger-pg-check.sql"
MUTANTS = [
    # identity
    ("L1", MIG, "  constraint ccrs_filed_entities_env_type_id_key unique (env, file_type, external_id)\n", "  constraint ccrs_filed_entities_env_type_id_key unique (env, file_type, external_id, state)\n"),
    ("L2", MIG, "  external_id         text not null check (external_id <> ''),", "  external_id         text not null,"),
    ("L3", MIG, "  env                 text not null check (env in ('preprod', 'prod')),\n  file_type           text not null check (file_type in\n                        ('Strain',", "  env                 text not null,\n  file_type           text not null check (file_type in\n                        ('Strain',"),
    # never twice (Brian A29)
    ("L4", MIG, "create unique index if not exists ccrs_files_env_sha256_key\n  on public.ccrs_files (env, sha256);", "create index if not exists ccrs_files_env_sha256_key\n  on public.ccrs_files (env, sha256);"),
    ("L5", MIG, "  file_name         text not null unique,", "  file_name         text not null,"),
    # state machine
    ("L6", MIG, "    'draft>emitted',\n    'emitted>uploaded',", "    'draft>emitted',\n    'draft>uploaded',\n    'emitted>uploaded',"),
    ("L7", MIG, "    'reconciling>closed'\n  ];", "    'reconciling>closed',\n    'closed>reconciling'\n  ];"),
    ("L8", MIG, "    if new.state <> 'draft' and not (new.purpose = 'seed' and new.state = 'closed') then", "    if false then"),
    ("L9", MIG, "    if old.state <> 'draft' then\n      raise exception 'CCRS_FILE_IS_RECORD", "    if false then\n      raise exception 'CCRS_FILE_IS_RECORD"),
    # immutability, one field at a time
    ("L10", MIG, "       new.sha256 is distinct from old.sha256\n    or ", "       "),
    ("L11", MIG, "    or new.number_records is distinct from old.number_records\n", ""),
    ("L12", MIG, "    or new.file_name is distinct from old.file_name\n", ""),
    ("L13", MIG, "    or new.env is distinct from old.env\n", ""),
    ("L14", MIG, "    or new.storage_path is distinct from old.storage_path\n", ""),
    ("L15", MIG, "  if old.state <> 'draft' and (\n", "  if old.state not in ('draft', 'emitted') and (\n"),
    # constraints
    ("L16", MIG, "    state = 'draft'\n    or (sha256 is not null and number_records is not null and storage_path is not null)", "    true"),
    ("L17", MIG, "    (state = 'withheld') = (withheld_code is not null)", "    (state <> 'withheld') or (withheld_code is not null)"),
    ("L18", MIG, "  constraint ccrs_files_chunk_in_range check (chunk_no <= chunk_of),", "  constraint ccrs_files_chunk_in_range check (chunk_no >= 1),"),
    ("L19", MIG, "  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),", "  sha256            text,"),
    # RLS
    ("L20", MIG, "alter table public.ccrs_file_rows      enable row level security;\n", ""),
    ("L21", MIG, "create policy \"ccrs_files admin write\" on public.ccrs_files\n  for all using (public.is_admin()) with check (public.is_admin());", "create policy \"ccrs_files admin write\" on public.ccrs_files\n  for all using (public.is_staff()) with check (public.is_staff());"),
    # cascade only for drafts
    ("L22", MIG, "  file_id       uuid not null references public.ccrs_files(id) on delete cascade,", "  file_id       uuid not null references public.ccrs_files(id),"),
    # rollback
    ("L23", RB, "    raise exception 'ROLLBACK_REFUSED: ccrs_files holds files that left draft; export them first';", "    raise notice 'ROLLBACK_REFUSED skipped';"),
    ("L24", RB, "drop function if exists public.ccrs_files_guard();", "select 1;"),
    ("L25", RB, "drop table if exists public.ccrs_file_rows;\n", ""),
    ("L26", MIG, "drop trigger if exists trg_ccrs_files_updated on public.ccrs_files;\ncreate trigger trg_ccrs_files_updated\n  before update on public.ccrs_files\n  for each row execute function public.set_updated_at();\n", ""),
]
url = os.environ.get("PGURL")
if not url:
    print("PGURL not set: SKIPPED (no database)"); sys.exit(2)
def run():
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-f", CHECK], capture_output=True, text=True)
    return r.returncode == 0 and "CCRS LEDGER CHECK PASSED" in (r.stdout + r.stderr)
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

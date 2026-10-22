#!/usr/bin/env python3
"""scripts/usage/mutate-0292-sql.py - test the 0292 check (USAGE-6, the two
updated_at indexes for the Orders board snapshot).

Each mutant changes ONE thing in 0292. For each one:
  1. roll 0292 back (drops both indexes);
  2. apply the mutated migration text from a temp file (the repo file is
     never written);
  3. run scripts/recon/orders-updated-at-0292-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0292 is applied first, in the middle and last (controls); the 0292
AND the 0291 checks must print their PASSED line each time.

One more probe, outside the mutant list: with 0292 rolled back (no indexes),
the check must FAIL.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/usage/mutate-0292-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0292_orders_updated_at_indexes.sql"
RB = "supabase/rollbacks/0292_orders_updated_at_indexes.rollback.sql"
CHECK = "scripts/recon/orders-updated-at-0292-pg-check.sql"
CHECK_PREV = "scripts/recon/ach-control-records-0291-pg-check.sql"
TMP = "/tmp/mut0292.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    cprev = psql_file(CHECK_PREV)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and cprev.returncode == 0
        and "USAGE 0292 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0291 CHECK PASSED" in (cprev.stdout + cprev.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} cprev={cprev.returncode} {(ck.stderr or cprev.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    ("orders-no-index", "create index if not exists orders_updated_at_idx\n  on public.orders (updated_at desc);", "select 1;"),
    ("leafly-no-index", "create index if not exists leafly_orders_updated_at_idx\n  on public.leafly_orders (updated_at desc);", "select 1;"),
    ("orders-asc", "on public.orders (updated_at desc);", "on public.orders (updated_at);"),
    ("leafly-asc", "on public.leafly_orders (updated_at desc);", "on public.leafly_orders (updated_at);"),
    ("orders-wrong-column", "on public.orders (updated_at desc);", "on public.orders (created_at desc);"),
    ("leafly-wrong-column", "on public.leafly_orders (updated_at desc);", "on public.leafly_orders (first_seen_at desc);"),
    ("orders-hash", "on public.orders (updated_at desc);", "on public.orders using hash (updated_at);"),
    ("orders-partial", "on public.orders (updated_at desc);", "on public.orders (updated_at desc) where updated_at < '2000-01-01';"),
    ("leafly-partial", "on public.leafly_orders (updated_at desc);", "on public.leafly_orders (updated_at desc) where updated_at < '2000-01-01';"),
    ("orders-renamed", "create index if not exists orders_updated_at_idx\n", "create index if not exists orders_upd_idx\n"),
    ("leafly-renamed", "create index if not exists leafly_orders_updated_at_idx\n", "create index if not exists leafly_upd_idx\n"),
    ("orders-composite", "on public.orders (updated_at desc);", "on public.orders (status, updated_at desc);"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"probe rolled-back: {'pass (check fails with no indexes)' if ok else 'FAILED'}", flush=True)
    return ok


def main(src):
    if not control("before"):
        return 2
    surv = []
    for name, a, b in M:
        if src.count(a) != 1:
            print(f"ANCHOR count={src.count(a)} {name}", flush=True)
            surv.append(name)
            continue
        r = psql_file(RB)
        if r.returncode:
            print(f"rollback failed before {name}: {r.stderr}", flush=True)
            return 3
        mutated = src.replace(a, b, 1)
        # a renamed or missing index leaves the comment pointing at a missing name; drop
        # the comment lines so the mutant applies and the CHECK has to catch it
        if name.endswith("-renamed") or name.endswith("-no-index"):
            mutated = "\n".join(l for l in mutated.splitlines() if not l.startswith("comment on index") and not l.startswith("  'USAGE-6"))
        open(TMP, "w").write(mutated)
        ap = psql_file(TMP)
        if ap.returncode:
            print(f"killed   {name}  (mutated migration did not apply: {ap.stderr.strip().splitlines()[-1][:120]})", flush=True)
            continue
        ck = psql_file(CHECK)
        k = ck.returncode != 0
        why = (ck.stderr.strip().splitlines() or ["-"])[-1][:140]
        print(f"{'killed  ' if k else 'SURVIVED'} {name}  ({why if k else 'check passed'})", flush=True)
        if not k:
            surv.append(name)
        # mutants may leave a renamed index behind; drop them before the next one
        subprocess.run(["psql", PGURL, "-X", "-q", "-c", "drop index if exists public.orders_upd_idx; drop index if exists public.leafly_upd_idx;"], capture_output=True)

    if not control("mid"):
        return 2
    if not probe_rolled_back():
        surv.append("rolled-back")

    assert open(MIG).read() == src
    ctl = control("after")
    names = {n for n, _, _ in M}
    print(f"total {len(M)} killed {len(M) - len([s for s in surv if s in names])} survivors {surv}")
    return 1 if surv or not ctl else 0


sys.exit(main(open(MIG).read()))

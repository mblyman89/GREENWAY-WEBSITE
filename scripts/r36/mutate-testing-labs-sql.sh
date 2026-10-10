#!/usr/bin/env bash
# scripts/r36/mutate-testing-labs-sql.sh - test the 0256 SQL self-test (R36 #4).
# Each mutant: drop the table + function, apply a MUTATED 0256, run the
# self-test, expect FAIL ("killed"). The real 0256 is re-applied at the end.
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
DB="psql -h localhost -U postgres -d greenway -q -v ON_ERROR_STOP=1"
MIG=supabase/migrations/0256_testing_labs.sql
TEST=scripts/r36/testing-labs.selftest.sql
killed=0; survived=0
reset() { $DB -c "drop table if exists public.testing_lab_hosts; drop table if exists public.testing_labs; drop function if exists public.testing_lab_hosts_valid(text[]);" >/dev/null 2>&1; }
run() {
  local name="$1" old="$2" new="$3"
  python3 - "$MIG" "$old" "$new" > /tmp/mut0256.sql <<'PY'
import sys
s=open(sys.argv[1]).read(); old=sys.argv[2]; new=sys.argv[3]
assert s.count(old)==1, f"anchor count {s.count(old)}: {old}"
print(s.replace(old,new))
PY
  if [ $? -ne 0 ]; then echo "ANCHOR FAIL $name"; survived=$((survived+1)); return; fi
  reset; $DB -f /tmp/mut0256.sql >/dev/null 2>&1
  if $DB -f "$TEST" >/dev/null 2>&1; then echo "SURVIVED $name"; survived=$((survived+1)); else echo "killed   $name"; killed=$((killed+1)); fi
}
reset; $DB -f "$MIG" >/dev/null 2>&1
if $DB -f "$TEST" >/dev/null 2>&1; then echo "CONTROL pass"; else echo "CONTROL FAILED"; exit 1; fi
run status-chk "check (status in ('active', 'historical', 'owner_added', 'platform'))" "check (true)"
run platform-chk "check (status <> 'platform' or lab_number is null)" "check (true)"
run name-trim "check (name = btrim(name) and length(name) between 2 and 200)" "check (length(name) between 2 and 200)"
run name-len "check (name = btrim(name) and length(name) between 2 and 200)" "check (name = btrim(name) and length(name) between 1 and 200)"
run number-chk "check (lab_number is null or lab_number between 1 and 9999)" "check (lab_number is null or lab_number between 0 and 9999)"
run website-chk "check (website is null or website ~ '^https?://')" "check (true)"
run notes-len "coalesce(length(notes), 0) <= 1000" "coalesce(length(notes), 0) <= 100000"
run number-uq "create unique index if not exists testing_labs_number_uq on public.testing_labs (lab_number) where lab_number is not null;" ""
run name-uq-ci "on public.testing_labs (lower(name));" "on public.testing_labs (name);"
run hosts-chk-off "cardinality(coa_hosts) <= 20 and public.testing_lab_hosts_valid(coa_hosts)" "cardinality(coa_hosts) <= 20"
run hosts-card "cardinality(coa_hosts) <= 20 and" "cardinality(coa_hosts) <= 21 and"
run hosts-notnull "coa_hosts          text[] not null default '{}'," "coa_hosts          text[] default '{}',"
run host-null "    h is not null
    and length(h)" "    length(h)"
run host-lower "and h ~ '^([a-z0-9]" "and h ~* '^([a-z0-9]"
run host-numeric-tld "([a-z]{2,63}|xn--[a-z0-9-]{1,59})\$'" "([a-z0-9]{1,63}|xn--[a-z0-9-]{1,59})\$'"
run host-anchor "and h ~ '^([a-z0-9]" "and h ~ '([a-z0-9]"
run host-end-anchor "|xn--[a-z0-9-]{1,59})\$'" "|xn--[a-z0-9-]{1,59})'"
run host-hyphen-end "([a-z0-9-]{0,61}[a-z0-9])?\\.)+" "([a-z0-9-]{0,62})?\\.)+"
run host-punycode "|xn--[a-z0-9-]{1,59})\$'" ")\$'"
run host-tld-len "([a-z]{2,63}|" "([a-z]{1,63}|"
run host-bool-or "select coalesce(bool_and(" "select coalesce(bool_or("
run rls-labs "alter table public.testing_labs enable row level security;" ""
run policy-read "create policy \"testing_labs staff read\" on public.testing_labs for select using (public.is_staff());" ""
run trigger "create trigger testing_labs_set_updated_at
  before update on public.testing_labs
  for each row execute function public.set_updated_at();" "select 1;"
run seed-cultivera "'{files.cultivera.com}')" "'{files.cultivera.org}')"
run seed-platform "'https://cultivera.com', 'platform'," "'https://cultivera.com', 'owner_added',"
run seed-historical "(25, 'Pacific Botanicals Laboratory'" "(26, 'Pacific Botanicals Laboratory'"
run seed-tt-name "'Testing Technologies, Inc.'," "'Testing Technologies',"
run seed-active "'https://medicinecreekanalytics.com', 'active'," "'https://medicinecreekanalytics.com', 'historical',"
run seed-conflabs "'{certs.conflabs.com}')" "'{}')"
run seed-ggl "'{gglabs-j.github.io}')" "'{}')"
run default-status "status             text not null default 'owner_added'," "status             text not null default 'active',"
reset; $DB -f "$MIG" >/dev/null 2>&1
echo "killed $killed, survived $survived"
[ "$survived" -eq 0 ]

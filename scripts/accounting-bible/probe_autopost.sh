#!/usr/bin/env bash
# PROBE P-01 (accounting bible): does gl_submit_journal accept autoPost=true with
# NO template, as drawer-posting-service / seal-bag / deposit-clearing / supply-run do?
set -uo pipefail
R=/workspace/GREENWAY-WEBSITE
PGBIN=/usr/lib/postgresql/15/bin
D=$(mktemp -d /tmp/probe.XXXX); chmod 777 $D; chown postgres $D
su postgres -c "$PGBIN/initdb -D $D/data -A trust" >/dev/null
su postgres -c "$PGBIN/pg_ctl -D $D/data -l $D/log -o '-p 5499 -k $D' start" >/dev/null; sleep 2
P="$PGBIN/psql -h $D -p 5499 -q -v ON_ERROR_STOP=1"
su postgres -c "$P -d postgres -c 'create database p'"
run(){ su postgres -c "$P -d p -f $1" 2>&1 | grep -v 'skipping' | tail -3; }
run $R/scripts/accounting/gl-schema-harness.sql
for m in 0172 0173 0174 0175; do echo "== $m"; run $R/supabase/migrations/${m}_*.sql; done
cat > $D/q.sql <<'SQL'
\set ON_ERROR_STOP 0
-- act as admin (harness stand-in)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
select public.is_admin() as is_admin_check;
\echo '--- P-01a: bank, auto_post=true, NO template (what drawer close does)'
select public.gl_submit_journal('greenway', date '2026-11-02', 'bank', 'till-close:probe1',
  'probe', '[{"account_code":"10100","amount_cents":1000},{"account_code":"10110","amount_cents":-1000}]'::jsonb,
  null, null, true, null, null, false);
\echo '--- P-01b: bank, auto_post=false (draft)'
select public.gl_submit_journal('greenway', date '2026-11-02', 'bank', 'till-close:probe2',
  'probe', '[{"account_code":"10100","amount_cents":1000},{"account_code":"10110","amount_cents":-1000}]'::jsonb,
  null, null, false, null, null, false);
\echo '--- P-01c: periods present?'
select fiscal_year, count(*) from public.gl_periods group by 1 order by 1;
SQL
chown postgres $D/q.sql
su postgres -c "$PGBIN/psql -h $D -p 5499 -d p -f $D/q.sql" 2>&1 | tail -30
su postgres -c "$PGBIN/pg_ctl -D $D/data stop -m immediate" >/dev/null

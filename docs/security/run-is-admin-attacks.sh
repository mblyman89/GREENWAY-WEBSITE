#!/usr/bin/env bash
# Run the is_admin() audit attack suite on a throwaway PostgreSQL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE="$SCRIPT_DIR/is-admin-attack-tests.sql"
if [ ! -f "$SUITE" ]; then echo "suite not found: $SUITE"; exit 1; fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -z "$PGBIN" ]; then echo "no postgres found"; exit 1; fi

PGDATA_DIR="$(mktemp -d /tmp/adminaudit.XXXXXX)"
PGPORT=55446
DB=auditdb

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

as_pg() {
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres "$PGDATA_DIR"
    su -s /bin/bash postgres -c "$1"
  else
    bash -c "$1"
  fi
}

step() {
  local label="$1" cmd="$2" out
  echo "--- $label ---"
  if ! out="$(as_pg "$cmd" 2>&1)"; then echo "$out"; echo "!!! STEP FAILED: $label"; exit 1; fi
  if grep -qE '^(psql:.*)?ERROR:' <<<"$out"; then echo "$out"; echo "!!! STEP REPORTED AN ERROR BUT EXITED 0: $label"; exit 1; fi
  echo "    ok"
}

step "initdb"  "$PGBIN/initdb -D $PGDATA_DIR/data -A trust -U postgres --no-sync >/dev/null"
step "start"   "$PGBIN/pg_ctl -D $PGDATA_DIR/data -o '-p $PGPORT -k $PGDATA_DIR' -l $PGDATA_DIR/log start >/dev/null"
step "createdb" "$PGBIN/createdb -h $PGDATA_DIR -p $PGPORT -U postgres $DB"

PSQL="$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"

echo "=== RUNNING ATTACK SUITE ==="
as_pg "$PSQL -f $SUITE" 2>&1 | grep -E "PASS|FAIL|BREACH|ATTACK|ERROR|COMPLETE" || true
as_pg "$PSQL -f $SUITE" >/tmp/adminaudit-full.log 2>&1 \
  && echo "=== SECOND RUN (idempotency): exit 0 ===" \
  || { echo "=== SECOND RUN FAILED ==="; tail -20 /tmp/adminaudit-full.log; exit 1; }

echo "=== is_admin AUDIT ATTACK SUITE PASSED ==="

#!/usr/bin/env bash
# scripts/r39/mutate-0259-sql.sh - test the 0259 pg scenario check (R39 S3).
# Each mutant weakens ONE guard in 0259, re-applies the mutated file (it is
# idempotent: create or replace / drop+add constraint), runs
# scripts/recon/vendor-vault-0259-pg-check.sql and expects it to FAIL. The real
# 0259 is re-applied at the end and the control re-run.
#
#   DB=r39 bash scripts/r39/mutate-0259-sql.sh
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
DBNAME=${DB:-r39}
PSQL="psql -h localhost -U postgres -d $DBNAME -q -v ON_ERROR_STOP=1"
MIG=supabase/migrations/0259_vendor_vault_change_control.sql
TEST=scripts/recon/vendor-vault-0259-pg-check.sql
TMP=${TMPDIR:-/workspace/gw/.r39logs}/mut0259.sql
killed=0; survived=0; survivors=""

run() {
  local name="$1" old="$2" new="$3"
  python3 - "$MIG" "$old" "$new" > "$TMP" <<'PY'
import sys
s=open(sys.argv[1]).read(); old=sys.argv[2]; new=sys.argv[3]
if s.count(old)!=1:
    sys.stderr.write(f"anchor count {s.count(old)}: {old}\n"); sys.exit(2)
print(s.replace(old,new))
PY
  if [ $? -ne 0 ]; then echo "ANCHOR FAIL $name"; survived=$((survived+1)); survivors="$survivors $name"; return; fi
  if ! $PSQL -f "$TMP" >/dev/null 2>&1; then echo "APPLY FAIL $name"; survived=$((survived+1)); survivors="$survivors $name"; return; fi
  if $PSQL -f "$TEST" >/dev/null 2>&1; then
    echo "SURVIVED $name"; survived=$((survived+1)); survivors="$survivors $name"
  else
    echo "killed   $name"; killed=$((killed+1))
  fi
}

$PSQL -f "$MIG" >/dev/null 2>&1
if $PSQL -f "$TEST" >/dev/null 2>&1; then echo "CONTROL pass"; else echo "CONTROL FAILED"; exit 1; fi

run no-delete-guard "    raise exception 'VAULT_ARCHIVE_ONLY: vendor banking % is never deleted. Archive it instead.', old.id;" "    return old;"
run insert-not-held "  if tg_op = 'INSERT' then
    bank_changed := true;" "  if tg_op = 'INSERT' then
    bank_changed := false;"
run routing-not-watched "    bank_changed := new.bank_routing is distinct from old.bank_routing
                 or " "    bank_changed := false
                 or "
run account-not-watched "                 or new.bank_account_number is distinct from old.bank_account_number" "                 or false"
run type-not-watched "                 or new.bank_account_type is distinct from old.bank_account_type;" "                 or false;"
run no-hold-on-change "    new.status := 'on_hold';" "    null;"
run no-author-stamp "    new.change_entered_by := coalesce(new.updated_by, new.created_by);" "    null;"
run no-time-stamp "    new.change_entered_at := now();" "    null;"
run release-not-cleared "    new.released_by := null;
    new.released_at := null;" "    null;"
run mode-not-cleared "    new.release_mode := null;
    new.release_callback_method := null;" "    null;"
run note-not-cleared "    new.release_callback_note := null;" "    null;"
run default-reason-overwrites "    if coalesce(length(trim(new.hold_reason)), 0) = 0
       or (tg_op = 'UPDATE'" "    if true
       or (tg_op = 'UPDATE'"
run default-reason-wrong-text "case when tg_op = 'INSERT' then 'New banking added' else 'Bank details changed' end" "'Bank details changed'"
run archived-to-active "    raise exception 'VAULT_TRANSITION: archived banking can only be re-opened on hold (% -> %).', old.status, new.status;" "    null;"
run revoked-to-active "    raise exception 'VAULT_TRANSITION: revoked banking can only be re-opened on hold or archived (% -> %).', old.status, new.status;" "    null;"
run no-release-who "      raise exception 'VAULT_RELEASE: record who released the hold and when.';" "      null;"
run replay-allowed "       or (old.released_at is not null and new.released_at <= old.released_at) then" "       or false then"
run no-note-length "coalesce(length(trim(new.release_callback_note)), 0) < 10 then" "coalesce(length(trim(new.release_callback_note)), 0) < 1 then"
run no-method-needed "    if new.release_callback_method is null or coalesce" "    if false or coalesce"
run null-author-is-dual "    is_solo := new.change_entered_by is null or new.change_entered_by = new.released_by;" "    is_solo := new.change_entered_by = new.released_by;"
run solo-mislabel-ok "      raise exception 'VAULT_RELEASE: the person who entered the change (or an unknown author) releasing it is a SOLO release.';" "      null;"
run dual-mislabel-ok "      raise exception 'VAULT_RELEASE: a release by a different person is a DUAL release.';" "      null;"
run solo-reason-short "    if is_solo and coalesce(length(trim(new.release_reason)), 0) < 20 then" "    if is_solo and coalesce(length(trim(new.release_reason)), 0) < 5 then"
run hold-same-reason "    raise exception 'VAULT_HOLD: putting banking on hold needs a new reason.';" "      null;"
run hold-reason-check "  check (status <> 'on_hold' or coalesce(length(trim(hold_reason)), 0) > 0);" "  check (true);"
run archived-check "  check (status <> 'archived' or (archived_at is not null and coalesce(length(trim(archive_reason)), 0) > 0));" "  check (true);"
run no-archive-stamp "    new.archived_at := coalesce(new.archived_at, now());" "    null;"
run method-shape "  check (release_callback_method is null or release_callback_method in ('phone', 'in_person'));" "  check (true);"
run mode-shape "  check (release_mode is null or release_mode in ('dual', 'solo'));" "  check (true);"
run unknown-status-swallowed "  if new.status not in ('active', 'on_hold', 'revoked', 'archived') then
    return new;
  end if;" "  if new.status not in ('active', 'on_hold', 'revoked', 'archived') then
    new.status := old.status; return new;
  end if;"
run no-trigger "  before insert or update or delete on public.vendor_bank_details
  for each row execute function public.vendor_bank_guard();" "  before truncate on public.vendor_bank_details
  for each statement execute function public.vendor_bank_guard();"

$PSQL -f "$MIG" >/dev/null 2>&1
if $PSQL -f "$TEST" >/dev/null 2>&1; then echo "RESTORED control pass"; else echo "RESTORE FAILED"; exit 1; fi
echo "killed=$killed survived=$survived"
[ -n "$survivors" ] && echo "survivors:$survivors"
[ "$survived" -eq 0 ]

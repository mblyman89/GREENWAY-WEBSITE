#!/usr/bin/env bash
# scripts/r39/mutate-0260-sql.sh - test the 0260 pg scenario check (R39 S5).
# Each mutant weakens ONE guard in 0260, re-applies the mutated file (it is
# idempotent: create or replace / drop+add constraint), runs
# scripts/recon/ach-intake-0260-pg-check.sql and expects it to FAIL. The real
# 0260 is re-applied at the end and the control re-run.
#
#   DB=r39 bash scripts/r39/mutate-0260-sql.sh
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
DBNAME=${DB:-r39}
PSQL="psql -h localhost -U postgres -d $DBNAME -q -v ON_ERROR_STOP=1"
MIG=supabase/migrations/0260_ach_document_intake.sql
TEST=scripts/recon/ach-intake-0260-pg-check.sql
TMP=${TMPDIR:-/workspace/gw/.r39logs}/mut0260.sql
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
  $PSQL -c "revoke all on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) from authenticated" >/dev/null 2>&1
  $PSQL -c "alter function public.ach_intake_finish(uuid, uuid, text, text, jsonb) security invoker" >/dev/null 2>&1
}

$PSQL -f "$MIG" >/dev/null 2>&1
if $PSQL -f "$TEST" >/dev/null 2>&1; then echo "CONTROL pass"; else echo "CONTROL FAILED"; exit 1; fi

run basis-any '  if p_basis is null or p_basis not in ('"'"'matches_form'"'"', '"'"'two_blind_entries'"'"') then' '  if p_basis is null then'
run actor-optional '  if p_actor is null then
    raise exception '"'"'ACH_INTAKE_ACTOR: who accepted' '  if false then
    raise exception '"'"'ACH_INTAKE_ACTOR: who accepted'
run future-signed '  if p_signed_on is null or p_signed_on > current_date then' '  if p_signed_on is null then'
run zero-accounts '  if n < 1 or n > 3 then' '  if n > 3 then'
run four-accounts '  if n < 1 or n > 3 then' '  if n < 1 then'
run vendor-doc-accepted '  if d.payee_type <> '"'"'employee'"'"' then' '  if false then'
run reaccept '  if d.archived_at is not null or d.authorization_id is not null
     or d.intake_status not in ('"'"'received'"'"', '"'"'extracted'"'"') then' '  if d.archived_at is not null then'
run archived-doc-accept '  if d.archived_at is not null or d.authorization_id is not null
     or d.intake_status not in ('"'"'received'"'"', '"'"'extracted'"'"') then' '  if d.authorization_id is not null
     or d.intake_status not in ('"'"'received'"'"', '"'"'extracted'"'"') then'
run any-kind '  if d.kind not in ('"'"'signed_form'"'"') then' '  if false then'
run silent-replace '    if not coalesce(p_replace_open, false) then' '    if false then'
run old-accounts-live '    update public.ach_authorization_accounts
       set archived_at = now()
     where authorization_id = old_auth.id and archived_at is null;' '    null;'
run no-supersede-event "    values (old_auth.id, 'employee', d.employee_id, 'authorization_superseded', p_actor," "    values (old_auth.id, 'employee', d.employee_id, 'authorization_noted', p_actor,"
run no-ended-reason '           ended_reason = format('"'"'Superseded by a new signed form (document %s).'"'"', d.id),' '           ended_reason = null,'
run active-not-signed '    ('"'"'employee'"'"', d.employee_id, left(coalesce(trim(p_payee_name), '"'"''"'"'), 200), '"'"'signed'"'"', '"'"'wet_ink_upload'"'"', p_signed_on, p_actor, p_actor)' '    ('"'"'employee'"'"', d.employee_id, left(coalesce(trim(p_payee_name), '"'"''"'"'), 200), '"'"'signed'"'"', '"'"'esign'"'"', p_signed_on, p_actor, p_actor)'
run name-not-trimmed 'left(coalesce(trim(p_payee_name), '"'"''"'"'), 200)' 'left(coalesce(p_payee_name, '"'"''"'"'), 200)'
run priority-unchecked '    if (a->>'"'"'priority'"'"')::int is distinct from i then' '    if false then'
run doc-not-linked '     set intake_status = '"'"'accepted'"'"', authorization_id = new_id,' '     set intake_status = '"'"'accepted'"'"','
run no-accept-event '     jsonb_build_object('"'"'document_id'"'"', d.id, '"'"'basis'"'"', p_basis)),
    (new_id, '"'"'employee'"'"', d.employee_id, '"'"'document_accepted'"'"', p_actor,' '     jsonb_build_object('"'"'document_id'"'"', d.id, '"'"'basis'"'"', p_basis)),
    (new_id, '"'"'employee'"'"', d.employee_id, '"'"'document_noted'"'"', p_actor,'
run ciphertext-in-event ''"'"'accounts'"'"', n, '"'"'account_last4'"'"', to_jsonb(last4s),' ''"'"'accounts'"'"', p_accounts, '"'"'account_last4'"'"', to_jsonb(last4s),'
run outcome-any '  if p_outcome is null or p_outcome not in ('"'"'accepted'"'"', '"'"'rejected'"'"') then' '  if p_outcome is null then'
run finish-actor-optional '  if p_actor is null then
    raise exception '"'"'ACH_INTAKE_ACTOR: who decided' '  if false then
    raise exception '"'"'ACH_INTAKE_ACTOR: who decided'
run redecide '  if d.archived_at is not null or d.intake_status not in ('"'"'received'"'"', '"'"'extracted'"'"') then' '  if d.intake_status in ('"'"'accepted_never'"'"') then'
run short-reason '  if p_outcome = '"'"'rejected'"'"' and coalesce(length(trim(p_note)), 0) < 10 then' '  if p_outcome = '"'"'rejected'"'"' and coalesce(length(trim(p_note)), 0) < 1 then'
run emp-via-finish '    if d.payee_type <> '"'"'vendor'"'"' then' '    if false then'
run vendor-no-basis '    if p_detail is null or (p_detail->>'"'"'basis'"'"') is null or (p_detail->>'"'"'basis'"'"') not in ('"'"'matches_form'"'"', '"'"'two_blind_entries'"'"') then' '    if false then'
run no-reject-event '  values (d.payee_type, d.employee_id, d.vendor_id, '"'"'document_rejected'"'"', p_actor,' '  values (d.payee_type, d.employee_id, d.vendor_id, '"'"'document_noted'"'"', p_actor,'
run reject-no-note '     set intake_status = '"'"'rejected'"'"', intake_note = left(trim(p_note), 500)' '     set intake_status = '"'"'rejected'"'"''
run grant-authenticated 'grant execute on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) to service_role;' 'grant execute on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) to service_role, authenticated;'
run security-definer 'language plpgsql
set search_path = public, pg_temp
as $$
declare
  d public.ach_authorization_documents%rowtype;
begin' 'language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  d public.ach_authorization_documents%rowtype;
begin'

# Clean up mutants that changed privileges or SECURITY DEFINER (create or
# replace keeps privileges; the real file re-revokes, but reset definer too).
$PSQL -c "revoke all on function public.ach_intake_finish(uuid, uuid, text, text, jsonb) from authenticated" >/dev/null 2>&1
$PSQL -c "alter function public.ach_intake_finish(uuid, uuid, text, text, jsonb) security invoker" >/dev/null 2>&1
$PSQL -f "$MIG" >/dev/null 2>&1
if $PSQL -f "$TEST" >/dev/null 2>&1; then echo "RESTORED control pass"; else echo "RESTORE FAILED"; exit 1; fi
echo "killed=$killed survived=$survived"
[ -n "$survivors" ] && echo "survivors:$survivors"
[ "$survived" -eq 0 ]

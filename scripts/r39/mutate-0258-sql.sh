#!/usr/bin/env bash
# scripts/r39/mutate-0258-sql.sh - test the 0258 pg scenario check (R39 S2).
# Each mutant weakens ONE guard in 0258, applies the mutated file to a fresh
# copy of the schema, runs scripts/recon/ach-authorizations-pg-check.sql and
# expects it to FAIL ("killed"). A survivor means the check does not prove
# that guard. The real 0258 is re-applied at the end.
#
#   DB=r39 bash scripts/r39/mutate-0258-sql.sh
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
DBNAME=${DB:-r39}
PSQL="psql -h localhost -U postgres -d $DBNAME -q -v ON_ERROR_STOP=1"
MIG=supabase/migrations/0258_ach_authorizations.sql
TEST=scripts/recon/ach-authorizations-pg-check.sql
TMP=${TMPDIR:-/workspace/gw/.r39logs}/mut0258.sql
killed=0; survived=0; survivors=""

reset() {
  $PSQL >/dev/null 2>&1 <<'SQL'
drop table if exists public.ach_return_notices, public.ach_verifications, public.ach_authorization_events,
  public.ach_authorization_documents, public.ach_authorization_accounts, public.ach_authorizations,
  public.payee_contacts cascade;
alter table public.vendors drop constraint if exists vendors_ach_opt_out_shape;
alter table public.vendors drop constraint if exists vendors_ach_flags_exclusive;
alter table public.vendors drop column if exists ach_needs_bank_info, drop column if exists ach_opted_out,
  drop column if exists ach_opted_out_reason, drop column if exists ach_opted_out_by, drop column if exists ach_opted_out_at;
drop policy if exists ach_docs_admin_read on storage.objects;
drop policy if exists ach_docs_manager_drop on storage.objects;
delete from storage.buckets where id = 'ach-docs';
SQL
}

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
  reset; $PSQL -f "$TMP" >/dev/null 2>&1
  if $PSQL -f "$TEST" >/dev/null 2>&1; then
    echo "SURVIVED $name"; survived=$((survived+1)); survivors="$survivors $name"
  else
    echo "killed   $name"; killed=$((killed+1))
  fi
}

reset; $PSQL -f "$MIG" >/dev/null 2>&1
if $PSQL -f "$TEST" >/dev/null 2>&1; then echo "CONTROL pass"; else echo "CONTROL FAILED"; exit 1; fi

# authorizations
run payee-shape "    (payee_type = 'employee' and employee_id is not null and vendor_id is null)
    or (payee_type = 'vendor' and vendor_id is not null and employee_id is null)
  ),
  constraint ach_auth_signed_has_date" "    true
  ),
  constraint ach_auth_signed_has_date"
run signed-date "check (state = 'draft' or signed_on is not null)" "check (true)"
run signed-method "check (state = 'draft' or signature_method is not null)" "check (true)"
run ended-date "check (state not in ('revoked', 'archived') or ended_on is not null)" "check (true)"
run end-after-sign "check (ended_on is null or signed_on is null or ended_on >= signed_on)" "check (true)"
run hold-reason "check (state <> 'on_hold' or coalesce(length(trim(hold_reason)), 0) > 0)" "check (true)"
run legal-reason "check (not legal_hold or coalesce(length(trim(legal_hold_reason)), 0) > 0)" "check (true)"
run one-open-emp "where employee_id is not null and state not in ('revoked', 'archived');" "where false;"
run transition-draft "when 'draft'     then array['signed', 'archived']" "when 'draft'     then array['signed', 'active', 'archived']"
run transition-revoked "when 'revoked'   then array['archived']" "when 'revoked'   then array['archived', 'active']"
run archived-readonly "      raise exception 'ACH_AUTH_ARCHIVED" "      return new; raise exception 'ACH_AUTH_ARCHIVED"
run retention-6y-end "(p_ended_on + interval '6 years')::date,
           coalesce" "(p_ended_on + interval '5 years')::date,
           coalesce"
run retention-hold "select p_legal_hold is not true
     and" "select"
run retention-open "     and p_ended_on is not null
" "     and true
"
run retention-trigger "create trigger trg_ach_auth_guard_delete
  before delete" "create trigger trg_ach_auth_guard_delete
  after delete"
# accounts
run enc-routing "routing_enc           text not null check (routing_enc like 'encv1:%')" "routing_enc           text not null"
run rule-fixed "(rule_kind = 'fixed'     and fixed_cents is not null and fixed_cents > 0 and basis_points is null)" "(rule_kind = 'fixed')"
run rule-percent "basis_points between 1 and 9999" "basis_points between 1 and 10000"
run hmac-shape "check (account_key_hmac ~ '^[0-9a-f]{64}\$')" "check (true)"
run one-remainder "on public.ach_authorization_accounts (authorization_id) where archived_at is null and rule_kind = 'remainder';" "on public.ach_authorization_accounts (id);"
run no-dup-acct "on public.ach_authorization_accounts (authorization_id, account_key_hmac) where archived_at is null;" "on public.ach_authorization_accounts (id);"
run priority-range "check (priority between 1 and 3)" "check (priority between 1 and 9)"
run acct-limit ") >= 3 then" ") >= 4 then"
run acct-immutable "     or new.account_enc   is distinct from old.account_enc
" ""
run acct-no-delete "    raise exception 'ACH_ACCOUNT_IMMUTABLE: accounts are archived, never deleted (%).', old.id;" "    return old;"
run acct-archived-frozen "  if old.archived_at is not null then
    raise exception 'ACH_ACCOUNT_IMMUTABLE: account % is archived.', old.id;
  end if;" ""
run verified-shape "(verification_status = 'verified') = (verified_at is not null and verification_method is not null)" "true"
# verifications / notices
run micro-range "check (micro_amount_cents is null or micro_amount_cents between 1 and 99)" "check (true)"
run micro-shape "check ((method = 'micro_entry') = (micro_amount_cents is not null))" "check (true)"
run code-kind "(notice_kind = 'return' and code like 'R%') or (notice_kind = 'noc' and code like 'C%')" "true"
run trace-15 "trace_number ~ '^[0-9]{15}\$'" "trace_number ~ '^[0-9]+\$'"
run resolved-shape "(resolved_at is null) = (resolved_by is null and resolution_note is null)" "true"
# events
run events-append-only "create trigger trg_ach_events_append_only
  before update or delete" "create trigger trg_ach_events_append_only
  before delete"
run event-kind "check (event_kind ~ '^[a-z][a-z_]{2,48}\$')" "check (true)"
# documents
run doc-path "check (storage_path like 'ach-docs/%')" "check (true)"
run doc-mime "check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic'))" "check (true)"
run doc-size "byte_size <= 26214400" "byte_size <= 262144000"
run doc-sha-unique "on public.ach_authorization_documents (payee_type, coalesce(employee_id, vendor_id), sha256);" "on public.ach_authorization_documents (id);"
run doc-immutable "     or new.sha256 is distinct from old.sha256
" ""
run doc-retention "       or not public.ach_retention_may_dispose(a.signed_on, a.ended_on, a.legal_hold, current_date) then" "       and false then"
run bucket-private "values ('ach-docs', 'ach-docs', false)" "values ('ach-docs', 'ach-docs', true)"
run storage-read-admin "for select using (bucket_id = 'ach-docs' and public.is_admin());" "for select using (bucket_id = 'ach-docs' and public.is_manager());"
run storage-drop-mgr "for insert with check (bucket_id = 'ach-docs' and public.is_manager());" "for insert with check (bucket_id = 'ach-docs' and public.is_staff());"
# contacts
run phone-shape "check (contact_kind <> 'phone' or value ~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}\$')" "check (true)"
run email-shape "check (contact_kind <> 'email' or value ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+\$')" "check (true)"
run not-future "check (on_file_since <= (created_at at time zone 'America/Los_Angeles')::date)" "check (true)"
run contact-date-immutable "     or new.on_file_since is distinct from old.on_file_since
" ""
run contact-no-delete "    raise exception 'PAYEE_CONTACT_IMMUTABLE: retire contact % instead of deleting it.', old.id;" "    return old;"
# vendors / vault
run optout-shape "  (ach_opted_out and coalesce(length(trim(ach_opted_out_reason)), 0) > 0 and ach_opted_out_at is not null)
  or (not ach_opted_out and ach_opted_out_at is null)" "  true"
run flags-exclusive "check (not (ach_opted_out and ach_needs_bank_info))" "check (true)"
run vault-archived "check (status in ('active', 'on_hold', 'revoked', 'archived'))" "check (status in ('active', 'on_hold'))"
run restrict-employee "  employee_id           uuid references public.employees (id) on delete restrict,
  vendor_id             uuid references public.vendors (id) on delete restrict,
  payee_name" "  employee_id           uuid references public.employees (id) on delete cascade,
  vendor_id             uuid references public.vendors (id) on delete cascade,
  payee_name"
# RLS / grants
run rls-auth "alter table public.ach_authorizations          enable row level security;" ""
run policy-admin "  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists ach_accounts_admin" "  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists ach_accounts_admin"
run mgr-drop-status "    and intake_status = 'received'
" ""
run mgr-drop-self "    and uploaded_by = auth.uid()
" ""
run mgr-event-kind "or (public.is_manager() and event_kind = 'document_dropped' and actor_id = auth.uid())" "or public.is_manager()"
run revoke-delete "revoke delete on table public.ach_authorizations, public.ach_authorization_accounts," "grant delete on table public.ach_authorizations, public.ach_authorization_accounts,"
run service-grant "public.ach_return_notices, public.payee_contacts to service_role;" "public.ach_return_notices to service_role;"
run anon-revoke "revoke all on table public.ach_authorizations          from anon;" "grant select on table public.ach_authorizations to anon;"

# restore
reset; $PSQL -f "$MIG" >/dev/null 2>&1
echo "killed $killed, survived $survived${survivors:+ :$survivors}"
[ "$survived" -eq 0 ]

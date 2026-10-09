#!/usr/bin/env bash
# scripts/r36/mutate-dismiss-sql.sh - test the SQL self-test (R36 #2).
# For each mutation: re-create dismiss_duplicate_manifest from a MUTATED copy
# of 0255, run the self-test, and expect it to FAIL ("killed"). Restores the
# real function at the end (re-applies 0255, which is idempotent).
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
DB="psql -h localhost -U postgres -d greenway -q -v ON_ERROR_STOP=1"
MIG=supabase/migrations/0255_inbound_dedupe.sql
TEST=scripts/r36/dismiss-duplicate.selftest.sql
killed=0; survived=0
run() { # name, python-replace old, new
  local name="$1" old="$2" new="$3"
  python3 - "$MIG" "$old" "$new" > /tmp/mut0255.sql <<'PY'
import sys
s=open(sys.argv[1]).read(); old=sys.argv[2]; new=sys.argv[3]
assert s.count(old)==1, f"anchor count {s.count(old)}: {old}"
print(s.replace(old,new))
PY
  if [ $? -ne 0 ]; then echo "ANCHOR FAIL $name"; survived=$((survived+1)); return; fi
  $DB -f /tmp/mut0255.sql >/dev/null 2>&1
  if $DB -f "$TEST" >/dev/null 2>&1; then echo "SURVIVED $name"; survived=$((survived+1)); else echo "killed   $name"; killed=$((killed+1)); fi
}
# CONTROL: unmodified must pass
$DB -f "$MIG" >/dev/null 2>&1
if $DB -f "$TEST" >/dev/null 2>&1; then echo "CONTROL pass"; else echo "CONTROL FAILED"; exit 1; fi
run self-guard "if p_dup = p_keep then" "if false then"
run accepted-guard "not in ('pending', 'in_transit', 'received', 'rejected') then" "not in ('pending', 'in_transit', 'received', 'rejected', 'accepted') then"
run identity-guard "is distinct from public.inbound_manifest_identity(v_keep.manifest_number, v_keep.vendor_label) then" "is distinct from public.inbound_manifest_identity(v_dup.manifest_number, v_dup.vendor_label) then"
run stock-guard "and status not in ('quarantine', 'rejected');" "and status not in ('quarantine', 'rejected', 'active');"
run history-guard "if exists (select 1 from public.inventory_adjustments where lot_id = any(v_lot_ids))" "if false and exists (select 1 from public.inventory_adjustments where lot_id = any(v_lot_ids))"
run invoice-fill-only "and nullif(btrim(coalesce(v_dup.invoice_number_detected, '')), '') is not null then" "and false then"
run transport-fill-only "driver_name           = coalesce(nullif(btrim(coalesce(driver_name, '')), ''), v_dup.driver_name)," "driver_name           = coalesce(v_dup.driver_name, driver_name),"
run docs-move "update public.manifest_documents set manifest_id = p_keep where manifest_id = p_dup;" "perform 1;"
run coa-lab-kept "and l.coa_storage_path is null" "and true"
run lot-delete "delete from public.inventory_lots where id = any(v_lot_ids);" "perform 1;"
run key-release "    dedupe_key = null,
    updated_by = p_actor
   where id = p_dup;" "    updated_by = p_actor
   where id = p_dup;"
run key-handover "  if v_key is not null and v_keep.dedupe_key is null then" "  if false then"
run already-dismissed "if lower(coalesce(v_dup.status, '')) = 'dismissed' then" "if false then"
run drafts "update public.catalog_product_drafts set status = 'dismissed'" "update public.catalog_product_drafts set status = 'draft'"
run event-keep "(p_keep, 'duplicate_merged'," "(p_dup, 'duplicate_merged',"
run grant "revoke all on function public.dismiss_duplicate_manifest(uuid, uuid, uuid, text) from public, anon, authenticated;" "grant execute on function public.dismiss_duplicate_manifest(uuid, uuid, uuid, text) to authenticated;"
run ws-parity-vendor "         || '|' || upper(btrim(regexp_replace(coalesce(p_vendor, ''), '[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+', ' ', 'g')))" "         || '|' || upper(btrim(regexp_replace(coalesce(p_vendor, ''), '\\s+', ' ', 'g')))"
run ws-parity-number "    else upper(btrim(regexp_replace(coalesce(p_number, ''), '[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+', ' ', 'g')))" "    else upper(btrim(regexp_replace(coalesce(p_number, ''), '\\s+', ' ', 'g')))"
# restore
$DB -c "drop function if exists public.dismiss_duplicate_manifest(uuid, uuid, uuid, text)" >/dev/null 2>&1
$DB -f "$MIG" >/dev/null 2>&1
if $DB -f "$TEST" >/dev/null 2>&1; then echo "RESTORED pass"; else echo "RESTORE FAILED"; fi
echo "killed=$killed survived=$survived"

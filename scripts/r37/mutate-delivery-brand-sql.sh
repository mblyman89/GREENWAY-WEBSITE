#!/usr/bin/env bash
# R37 S5 - mutation test for 0257: each mutant is applied in place of the
# real migration (rollback first) and the scenario check must FAIL.
# Run from the repo root:  bash scripts/r37/mutate-delivery-brand-sql.sh
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
PSQL="psql -h localhost -U postgres -d greenway -v ON_ERROR_STOP=1 -q"
MIG=supabase/migrations/0257_delivery_brand.sql
CHK=scripts/r37/delivery-brand-pg-check.sql
cp "$MIG" /tmp/0257.orig
killed=0; total=0
mutate() {
  local label="$1" expr="$2"
  total=$((total+1))
  cp /tmp/0257.orig "$MIG"
  sed -i "$expr" "$MIG"
  if cmp -s /tmp/0257.orig "$MIG"; then echo "NOOP     $label"; return; fi
  $PSQL -f supabase/rollbacks/0257_delivery_brand.rollback.sql >/dev/null 2>&1
  $PSQL -f "$MIG" >/dev/null 2>&1
  if $PSQL -f "$CHK" >/tmp/pgm.log 2>&1; then echo "SURVIVED $label"; else echo "killed   $label"; killed=$((killed+1)); fi
}
mutate "vendors on delete cascade"        '0,/on delete set null/s//on delete cascade/'
mutate "manifests on delete cascade"      '/inbound_manifests/,$ s/on delete set null/on delete cascade/'
mutate "vendors FK dropped"               's/default_brand_id uuid references public.brands(id) on delete set null/default_brand_id uuid/'
mutate "manifests FK dropped"             's/brand_id uuid references public.brands(id) on delete set null;/brand_id uuid;/'
mutate "vendors column text"              's/default_brand_id uuid references/default_brand_id text references/'
mutate "vendor index missing"             '/vendors_default_brand_idx/d'
mutate "manifest index missing"           '/inbound_manifests_brand_idx/d'
mutate "manifest column misnamed"         's/add column if not exists brand_id/add column if not exists brand_ref/'
mutate "no action instead of set null"    's/on delete set null/on delete no action/g'
cp /tmp/0257.orig "$MIG"
$PSQL -f supabase/rollbacks/0257_delivery_brand.rollback.sql >/dev/null 2>&1
$PSQL -f "$MIG" >/dev/null 2>&1
echo "killed $killed / $total"

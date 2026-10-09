#!/usr/bin/env bash
# R35 #6 - tests the 0254 scenario check by mutating the migration and
# requiring the check to FAIL for every mutant (then restoring the original).
# Run from the repo root:  bash scripts/r35/pg-mutants.sh
set -u
MIG=supabase/migrations/0254_menu_item_effects_aroma.sql
CHK=scripts/recon/menu-effects-aroma-pg-check.sql
cp "$MIG" /tmp/0254.orig
killed=0; total=0
mutate() {
  local label="$1" expr="$2"
  total=$((total+1))
  cp /tmp/0254.orig "$MIG"
  sed -i "$expr" "$MIG"
  if cmp -s /tmp/0254.orig "$MIG"; then echo "NOOP  $label"; return; fi
  if sudo -u postgres psql -d greenway -v ON_ERROR_STOP=1 -f "$CHK" >/tmp/pgm.log 2>&1; then
    echo "SURVIVED $label"
  else
    echo "killed   $label"; killed=$((killed+1))
  fi
}
mutate "effects cap 8->9"            's/cardinality(effects) between 1 and 8/cardinality(effects) between 1 and 9/'
mutate "aroma cap 8->9"              's/cardinality(aroma_notes) between 1 and 8/cardinality(aroma_notes) between 1 and 9/'
mutate "effects allows empty"        's/cardinality(effects) between 1 and 8/cardinality(effects) between 0 and 8/'
mutate "aroma allows empty"          's/cardinality(aroma_notes) between 1 and 8/cardinality(aroma_notes) between 0 and 8/'
mutate "effects allows null element" 's/(effects is null or (cardinality(effects) between 1 and 8 and array_position(effects, null) is null))/(effects is null or (cardinality(effects) between 1 and 8))/'
mutate "aroma allows null element"   's/(aroma_notes is null or (cardinality(aroma_notes) between 1 and 8 and array_position(aroma_notes, null) is null))/(aroma_notes is null or (cardinality(aroma_notes) between 1 and 8))/'
mutate "effects check made vacuous"  's/check (effects is null or (cardinality(effects) between 1 and 8 and array_position(effects, null) is null))/check (true)/'
mutate "aroma check renamed"         's/add constraint menu_items_aroma_notes_shape_chk/add constraint menu_items_aroma_x_chk/'
mutate "effects column text not array" 's/add column if not exists effects text\[\],/add column if not exists effects text,/'
mutate "aroma column dropped"        's/  add column if not exists aroma_notes text\[\];/  add column if not exists r35_unused text[];/'
cp /tmp/0254.orig "$MIG"
echo "pg mutants: $killed/$total killed"
[ "$killed" = "$total" ]

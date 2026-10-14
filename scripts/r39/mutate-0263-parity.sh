#!/usr/bin/env bash
# Test the 0263 parity test: each mutant must make it FAIL. Restores files after each.
set -u
cd "$(dirname "$0")/../.."
T=tests/compliance/r39-ach-ops-0263-parity.test.ts
M=supabase/migrations/0263_ach_operations.sql
killed=0; total=0; survivors=()
run() { # name file perl-expr
  local name=$1 file=$2 expr=$3
  cp "$file" "$file.bak"
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "$file.bak"; then echo "NO-OP $name"; mv "$file.bak" "$file"; survivors+=("$name(noop)"); total=$((total+1)); return; fi
  total=$((total+1))
  if timeout 200 npx vitest run "$T" > /dev/null 2>&1; then survivors+=("$name"); echo "SURVIVED $name"; else killed=$((killed+1)); echo "killed $name"; fi
  mv "$file.bak" "$file"
}
run note-11       $M 's/length\(trim\(resolution_note\)\) >= 10/length(trim(resolution_note)) >= 11/'
run age-366       $M 's/today - 400 then/today - 366 then/'
run method-email  $M "s/p_method not in \('phone', 'in_person'\)/p_method not in ('phone', 'in_person', 'email')/"
# R41 S0: solo-15 retired: 0271 replaced the 0263 release body (no solo reason); see scripts/r41/mutate-owner-parity.py
run cb-note-5     $M "s/'voided_check_callback' and coalesce\(length\(trim\(p_note\)\), 0\) < 10/'voided_check_callback' and coalesce(length(trim(p_note)), 0) < 5/"
run definer       $M 's/(create or replace function public\.ach_auth_review_done[^\n]*\nreturns date\nlanguage plpgsql\n)/$1security definer\n/'
run grant-auth    $M 's/grant execute on function public\.ach_notice_resolve\(uuid, uuid, text\) to service_role;/grant execute on function public.ach_notice_resolve(uuid, uuid, text) to authenticated;/'
run no-delete     $M 's/before update or delete on public\.ach_verifications/before update on public.ach_verifications/'
run final-late    $M "s/  if v.status in \('passed', 'failed', 'cancelled'\) then\n    raise exception 'ACH_VERIFICATION_FINAL[^\n]*\n  end if;\n//"
run review-2y     $M "s/\+ interval '1 year'\)::date\)\n       where id = a.id;/+ interval '2 years')::date)\n       where id = a.id;/"
run eligible-same $M 's/or p_eligible <= p_settlement then/or p_eligible < p_settlement then/'
# R41 S0: core-solo retired: 0271 replaced the 0263 release body (no solo reason); see scripts/r41/mutate-owner-parity.py
run core-age      src/lib/payments/ach-return-log-core.ts 's/export const NOTICE_MAX_AGE_DAYS = 400;/export const NOTICE_MAX_AGE_DAYS = 365;/'
run rb-late       supabase/rollbacks/0263_ach_operations.rollback.sql 's/ROLLBACK REFUSED: ach_authorizations has holds/ROLLBACK warning: ach_authorizations has holds/'
echo "killed $killed/$total survivors [${survivors[*]:-}]"

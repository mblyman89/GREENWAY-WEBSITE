#!/usr/bin/env bash
#
# scripts/prove-migration-columns.sh   (books-35)
#
# Proves the shared migration parser refuses what it cannot classify, instead
# of silently skipping it the way the books-34 parser did.
#
# Two halves:
#   1. SWEEP  - parse every migration in the repo. Any column-shaped line whose
#               type is not in KNOWN_SQL_TYPES is reported by name. This is the
#               control that stops KNOWN_SQL_TYPES from falling behind the
#               schema: a new `interval` column fails HERE, loudly, rather than
#               vanishing from a coverage gate's field of view.
#   2. KILLS  - feed the parser deliberately broken input and require a refusal.
#
# Standing rule 15: every test must be provably failable. A parser proof that
# only ever parses good input proves nothing about the refusal path.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

pass=0
fail=0

ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }

echo "═══════════════════════════════════════════════════════════════════"
echo " 1. SWEEP: every migration must parse with zero unrecognised types"
echo "═══════════════════════════════════════════════════════════════════"

npx tsx scripts/sweep-migration-columns.ts
sweep=$?
if [ $sweep -eq 0 ]; then
  ok "all migrations parsed, no unrecognised column types"
else
  bad "at least one migration contains a type the parser cannot classify"
fi

echo
echo "═══════════════════════════════════════════════════════════════════"
echo " 2. KILLS: broken input must produce a refusal, not a shrug"
echo "═══════════════════════════════════════════════════════════════════"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- kill 1: an unknown type must refuse -----------------------------------
#
# `geography` is a real PostGIS type and is deliberately NOT in KNOWN_SQL_TYPES,
# because this repo does not use it. That is the whole point: the parser must
# refuse a type it has never been told about rather than skip the line. If a
# future migration legitimately needs it, someone adds it here ON PURPOSE,
# having looked at the column — which is the decision the old regex was making
# silently on everybody's behalf.
cat > "$tmp/unknown.sql" <<'SQL'
create table if not exists public.thing (
  id uuid primary key,
  where_it_happened geography not null
);
SQL

# --- kill 2: the exact 0198 shape - a smallint the old parser dropped ------
cat > "$tmp/smallint.sql" <<'SQL'
create table if not exists public.orders (
  id uuid primary key,
  priority smallint not null
);
SQL

# --- control: a file of only known types must parse silently ---------------
cat > "$tmp/clean.sql" <<'SQL'
create table if not exists public.fine (
  id uuid primary key,
  amount_cents bigint not null,
  note text
);
SQL

npx tsx scripts/check-migration-parse.ts "$tmp/unknown.sql" > "$tmp/out1" 2>&1
if grep -q "UNRECOGNISED COLUMN TYPE" "$tmp/out1" && grep -q "where_it_happened" "$tmp/out1"; then
  ok "an unknown type (geography) is refused BY NAME, not skipped"
else
  bad "an unknown type did not raise a named refusal"
  cat "$tmp/out1"
fi

npx tsx scripts/check-migration-parse.ts "$tmp/smallint.sql" > "$tmp/out2" 2>&1
if grep -q "^COLUMNS:" "$tmp/out2" && grep -q "orders.priority=smallint" "$tmp/out2"; then
  ok "wage_orders.priority's type (smallint) is now READ, not dropped"
else
  bad "smallint is still not parsed"
  cat "$tmp/out2"
fi

# ACCEPT CONTROL (standing rule 55): refusal must discriminate. If the clean
# file also refused, the kills above would prove nothing at all.
npx tsx scripts/check-migration-parse.ts "$tmp/clean.sql" > "$tmp/out3" 2>&1
if grep -q "^COLUMNS:" "$tmp/out3" && ! grep -q "UNRECOGNISED" "$tmp/out3"; then
  ok "ACCEPT CONTROL: a clean migration parses without complaint"
else
  bad "ACCEPT CONTROL FAILED: the parser refuses valid input, so its refusals are noise"
  cat "$tmp/out3"
fi

echo
echo "═══════════════════════════════════════════════════════════════════"
echo " RESULT: $pass passed, $fail failed"
echo "═══════════════════════════════════════════════════════════════════"
[ $fail -eq 0 ]

#!/usr/bin/env bash
#
# scripts/recon/mutation-cloudprnt-auth.sh  (D-68 — "test the tests")
#
# A passing test suite proves the tests RAN. It does not prove they would
# NOTICE if the code broke. This harness deliberately breaks
# cloudprnt-auth-core.ts (and the route's wiring to it) one mutation at a
# time and demands that the suite go RED for every single one. A mutation the
# suite still passes is called a SURVIVOR and is a hole in the tests.
#
# Mutations are chosen to be the realistic regressions for this defect:
# reverting the precedence (i.e. reintroducing D-68), breaking the fallbacks,
# breaking the empty-password rule, and unwiring the route.
#
# Run:  bash scripts/recon/mutation-cloudprnt-auth.sh
# Exit: 0 only when EVERY mutation was caught.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/printing/cloudprnt-auth-core.ts"
ROUTE="src/app/api/cloudprnt/route.ts"
TEST="tests/compliance/cloudprnt-auth.test.ts"
BACKUP_CORE="/tmp/mut-core.bak"
BACKUP_ROUTE="/tmp/mut-route.bak"
LOG="/tmp/mut-cloudprnt.log"

cp "$CORE" "$BACKUP_CORE"
cp "$ROUTE" "$BACKUP_ROUTE"

restore() {
  cp "$BACKUP_CORE" "$CORE"
  cp "$BACKUP_ROUTE" "$ROUTE"
}
trap restore EXIT

caught=0
survived=0
declare -a SURVIVORS=()

# run_mutation <name> <file> <sed-expression>
run_mutation() {
  local name="$1" file="$2" expr="$3"
  restore

  # Apply the mutation and confirm it actually changed something. A sed that
  # silently matches nothing would look like a "caught" mutation and quietly
  # weaken this harness, so a no-op edit is treated as a hard error.
  local before after
  before=$(md5sum "$file" | cut -d' ' -f1)
  perl -0pi -e "$expr" "$file"
  after=$(md5sum "$file" | cut -d' ' -f1)
  if [ "$before" = "$after" ]; then
    echo "  ERROR   $name -- mutation did not change $file (stale pattern)"
    SURVIVORS+=("$name (PATTERN DID NOT APPLY)")
    survived=$((survived + 1))
    return
  fi

  if npx vitest run "$TEST" > "$LOG" 2>&1; then
    echo "  SURVIVED  $name  <-- TESTS DID NOT NOTICE"
    SURVIVORS+=("$name")
    survived=$((survived + 1))
  else
    echo "  caught    $name"
    caught=$((caught + 1))
  fi
}

echo "=== Mutation testing cloudprnt-auth-core (D-68) ==="
echo

# --- 1. Revert the auth precedence: this IS defect D-68 coming back. --------
run_mutation "auth precedence reverted (query wins) => D-68 returns" "$CORE" \
  's{return basicAuthPassword\(sources\.authorizationHeader\) \?\? queryValue\(sources\.queryToken\);}{return queryValue(sources.queryToken) ?? basicAuthPassword(sources.authorizationHeader);}'

# --- 2. Revert the job precedence: GET would fetch the wrong receipt. -------
run_mutation "job precedence reverted (Basic wins)" "$CORE" \
  's{return queryValue\(sources\.queryToken\) \?\? basicAuthPassword\(sources\.authorizationHeader\);}{return basicAuthPassword(sources.authorizationHeader) ?? queryValue(sources.queryToken);}'

# --- 3. Drop the auth query fallback: ?token=-only setups break. ------------
run_mutation "auth query fallback removed" "$CORE" \
  's{return basicAuthPassword\(sources\.authorizationHeader\) \?\? queryValue\(sources\.queryToken\);}{return basicAuthPassword(sources.authorizationHeader);}'

# --- 4. Drop the job Basic fallback. ---------------------------------------
run_mutation "job Basic fallback removed" "$CORE" \
  's{return queryValue\(sources\.queryToken\) \?\? basicAuthPassword\(sources\.authorizationHeader\);}{return queryValue(sources.queryToken);}'

# --- 5. Empty Basic password leaks "" instead of null. ---------------------
run_mutation "empty Basic password returns empty string" "$CORE" \
  's{return password\.length > 0 \? password : null;}{return password;}'

# --- 6. Stop trimming the query token. ------------------------------------
run_mutation "query token no longer trimmed/blank-checked" "$CORE" \
  's{const q = \(queryToken \?\? ""\)\.trim\(\);\n  return q\.length > 0 \? q : null;}{return queryToken ?? null;}'

# --- 7. Split Basic on the LAST colon instead of the first. ----------------
run_mutation "Basic split on last colon (breaks colon passwords)" "$CORE" \
  's{const idx = decoded\.indexOf\(":"\);}{const idx = decoded.lastIndexOf(":");}'

# --- 8. Dispatcher swaps the two uses. ------------------------------------
run_mutation "dispatcher maps 'auth' to the job handle" "$CORE" \
  's{return use === "auth" \? authCredential\(sources\) : jobHandle\(sources\);}{return use === "auth" ? jobHandle(sources) : authCredential(sources);}'

# --- 9. Accept any auth scheme, not just Basic. ---------------------------
run_mutation "Basic scheme check dropped" "$CORE" \
  's{if \(!auth\.toLowerCase\(\)\.startsWith\("basic "\)\) return null;}{if (false) return null;}'

# --- 10. Unwire the route: the D-66 lesson. -------------------------------
# The pure module stays perfect; the route goes back to its own extractor.
run_mutation "route GET reverts to the colliding query-first fallback" "$ROUTE" \
  's{const token = extractToken\(req, "job"\);\n  if \(!token\) \{}{const url2 = new URL(req.url);\n  const token = url2.searchParams.get("token") || extractToken(req, "auth");\n  if (!token) \{}'

# --- 11. Route asks for the wrong use on the auth check. ------------------
run_mutation "route authenticates with the job handle" "$ROUTE" \
  's{const provided = extractToken\(req, "auth"\);}{const provided = extractToken(req, "job");}'

# --- 12. Route drops the constant-time compare (GW-022 collateral). -------
run_mutation "route drops timingSafeEqualStr" "$ROUTE" \
  's{if \(timingSafeEqualStr\(provided, expected\)\) return null;}{if (provided === expected) return null;}'

restore

echo
echo "=== RESULT ==="
echo "caught:   $caught"
echo "survived: $survived"
if [ "$survived" -gt 0 ]; then
  echo
  echo "SURVIVORS (holes in the test suite):"
  for s in "${SURVIVORS[@]}"; do echo "  - $s"; done
  echo
  echo "FAILED: the tests do not catch every regression."
  exit 1
fi
echo
echo "All $caught mutations caught. The tests have teeth."

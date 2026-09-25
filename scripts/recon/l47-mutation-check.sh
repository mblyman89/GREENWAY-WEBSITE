#!/usr/bin/env bash
# SLICE L-47 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
#
# "Test it, test the tests." A green suite proves the tests RAN; this proves
# they BITE. Every anchor must appear exactly once, so a silently-missed edit
# is reported as SKIP (a failure), never as a false "killed".
set -u
TESTS="tests/compliance/leafly-l47-certification-proof.test.ts tests/compliance/leafly-id-image-runtime.test.ts tests/compliance/leafly-online-orders-report.test.ts"
for t in $TESTS; do [ -f "$t" ] || TESTS="${TESTS/$t/}"; done
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l47-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l47-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l47-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l47-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l47-mut-backup "$file"
}

# BASELINE GATE: if the pinned tests are not green unmutated, every mutation
# would look "killed". Refuse to run rather than report false kills.
if ! npx vitest run $TESTS > /tmp/l47-mut-base.log 2>&1 || ! npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l47-mut-base-pure.log 2>&1; then
  echo "BASELINE NOT GREEN - fix the tests first (see /tmp/l47-mut-base*.log)"; exit 2
fi
echo "baseline green"

C=src/lib/leafly/certification-proof-core.ts
S=src/lib/leafly/certification-proof-server.ts
F=src/lib/leafly/order-fetch-server.ts
D=src/lib/leafly/order-detail-server.ts
A=src/lib/leafly/order-ack-server.ts
R=src/lib/leafly/online-orders-report-core.ts
P=src/app/admin/integrations/leafly/page.tsx

# -- the pure core --------------------------------------------------------------
mutate "core: non-uuid passed to uuid column"     $C '  return { createdBy: null, label: v };' '  return { createdBy: v, label: null };'
mutate "core: label dropped from message"         $C '  return label ? `[${label}] ${m}` : m;' '  return m;'
mutate "core: fetch 401 mapped to retry"          $C '    case "fix_credentials":
      return "fix_config";' '    case "fix_credentials":
      return "retry";'
mutate "core: 404 not gone"                       $C '    case "not_found":
    case "gone":
      return "gone";' '    case "gone":
      return "gone";'
mutate "core: expiry boundary >= (off by one)"    $C '  return Number.isFinite(diff) && diff > LEAFLY_SANDBOX_LOG_RETENTION_DAYS * DAY_MS;' '  return Number.isFinite(diff) && diff >= LEAFLY_SANDBOX_LOG_RETENTION_DAYS * DAY_MS - 1;'
mutate "core: unsigned probe counted"             $C '  if (!row.signatureVerified && (row.rejectionReason ?? "").trim() === LEAFLY_PROOF_UNSIGNED_REASON) {
    // Not from Leafly.' '  if (false) {
    // Not from Leafly.'
mutate "core: unsigned webhook accepted as ok"    $C '    row.signatureVerified === true &&
    typeof row.responseStatus' '    typeof row.responseStatus'
mutate "core: errored auto-run counted as proof"  $C '  if (row.status !== "ok") return null;
  return {
    action: "menu_delete",' '  return {
    action: "menu_delete",'
mutate "core: auto-run w/o deletes counted"       $C '  if (!(row.deleteCount > 0)) return null;' ''
mutate "core: unreadable source ignored"          $C '  const sourcesUnreadable = LEAFLY_PROOF_SOURCES_BY_ACTION[def.id].some((s) =>
    ctx.unreadable.includes(s),
  );' '  const sourcesUnreadable = false;'
mutate "core: saturation flag dropped"            $C '  const saturated = ctx.saturated.includes(def.id);' '  const saturated = false;'
mutate "core: migration hint never shown"         $C '    LEAFLY_OPERATIONS_NEEDING_0231.includes(op) &&' '    false &&'

# -- the loader -----------------------------------------------------------------
mutate "loader: failed read not unreadable"       $S '        if (!r.ok) unreadable.push(src);' '        void 0;'
mutate "loader: full read not saturated"          $S '        if (r.full) full.push(src);' '        void 0;'

# -- the recorders --------------------------------------------------------------
mutate "fetch: recorder never runs"               $F '  if (ctx.dialled) {
    await recordFetchAttempt' '  if (false) {
    await recordFetchAttempt'
mutate "fetch: records even when not dialled"     $F '  if (ctx.dialled) {
    await recordFetchAttempt' '  if (true) {
    await recordFetchAttempt'
mutate "fetch: failure recorded as success"       $F '      disposition: fetchDispositionToLedger(result.ok ? "success" : result.assessment.disposition),' '      disposition: "success",'
mutate "media: recorder never runs"               $D '  if (ctx.dialled) {' '  if (false) {'
mutate "media: zero-byte 200 = success"           $D '        ? "fix_request"
        : mediaStatusToLedger(ctx.httpStatus);' '        ? "success"
        : mediaStatusToLedger(ctx.httpStatus);'
mutate "media: image bytes stored"                $D '      responseBody: null,' '      responseBody: { leaked: "bytes" } as never,'
mutate "ack: attribution bypassed (uuid bug back)" $A '        created_by: who.createdBy,' '        created_by: row.createdBy ?? null,'

# -- the report + wiring --------------------------------------------------------
mutate "report: read calls inflate outbound"      $R '    !(REPORT_EXCLUDED_READ_OPERATIONS as readonly string[]).includes(String(a.operation ?? "")),' '    true,'
mutate "report: back to allow-list (drops rows)"  $R '    !(REPORT_EXCLUDED_READ_OPERATIONS as readonly string[]).includes(String(a.operation ?? "")),' '    (REPORT_OUTBOUND_OPERATIONS as readonly string[]).includes(String(a.operation ?? "")),'
mutate "page: panel unwired"                      $P '      <LeaflyCertificationProofPanel view={certificationProof} />' ''

echo "--------------------------------------------------"
echo "killed: $pass   survived/skipped: $fail"
[ "$fail" -eq 0 ]

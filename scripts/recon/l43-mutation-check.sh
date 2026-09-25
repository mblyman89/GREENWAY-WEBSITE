#!/usr/bin/env bash
# SLICE L-43 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
set -u
TESTS="tests/compliance/leafly-l43-hmac.test.ts tests/compliance/pure-selftests.test.ts tests/compliance/leafly-refusal-diagnosis.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l43-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l43-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l43-mut.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l43-mut-backup "$file"
}

H=src/lib/leafly/hmac-core.ts
W=src/lib/leafly/webhook-server.ts
PV=src/app/api/webhooks/leafly/order-preview/route.ts
E=src/lib/leafly/evidence-core.ts

mutate "base64 shape re-enabled"          $H 'return /^[0-9a-fA-F]{64}$/.test(value);' 'return /^[0-9a-fA-F]{64}$/.test(value) || /^[A-Za-z0-9+/]{43}=$/.test(value);'
mutate "base64 encoding re-added"         $H 'export const LEAFLY_HMAC_ENCODINGS = ["hex"] as const;' 'export const LEAFLY_HMAC_ENCODINGS = ["hex", "base64"] as const;'
mutate "empty-unsigned check removed"     $H '    if (rawBody === "") {
      // Ben, item 1' '    if (false) {
      // Ben, item 1'
mutate "carve-out widened to whitespace"  $H '    if (rawBody === "") {
      // Ben, item 1' '    if (String(rawBody).trim() === "") {
      // Ben, item 1'
mutate "carve-out widened to any body"    $H '    if (rawBody === "") {
      // Ben, item 1' '    if (true) {
      // Ben, item 1'
mutate "hex case-folding removed"         $H 'timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())' 'timingSafeStringEqual(computed, presented)'
mutate "flag flipped back"                $H 'export const LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = false;' 'export const LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = true;'
mutate "admission: empty -> 401"          $H 'return { action: "acknowledge_only", status: 200,' 'return { action: "acknowledge_only", status: 401 as 200,'
mutate "admission: empty recorded"        $H 'status: 200, recordEvent: false, mayActOnPayload: false };' 'status: 200, recordEvent: true, mayActOnPayload: false };'
mutate "admission: ok not required"       $H 'if (verdict && verdict.outcome === "verified" && verdict.ok === true) {' 'if (verdict && verdict.outcome === "verified") {'
mutate "admission: fails open"            $H '  return { action: "refuse", status: 401, recordEvent: true, mayActOnPayload: false };' '  return { action: "process", status: 200, recordEvent: true, mayActOnPayload: true };'
mutate "server: old !ok gate restored"    $W '  if (admission.action === "refuse") {' '  if (!verdict.ok) {'
mutate "server: skip ack-only branch"     $W '  if (admission.action === "acknowledge_only") {' '  if (false) {'
mutate "preview: skip ack-only branch"    $PV '  if (handled.admission === "acknowledge_only") {' '  if (false) {'
mutate "evidence: base64 advice back"     $E '"they are signing with. (The encoding is settled: Leafly confirmed lowercase hex.)",' '"they are signing with and whether the signature is hex or base64 encoded.",'

echo "killed=$pass survived_or_skipped=$fail"
[ $fail -eq 0 ]

#!/usr/bin/env bash
# SLICE L-42 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
set -u
TESTS="tests/compliance/leafly-l42-page.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l42-mut-backup
  python3 - "$file" "$from" "$to" <<'EOF'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if a not in s:
    print("MUTATION ANCHOR MISSING:", a); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
EOF
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l42-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l42-mut.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l42-mut-backup "$file"
}

C=src/app/admin/integrations/leafly/leafly-client.tsx
P=src/app/admin/integrations/leafly/replace-menu-panel.tsx
A=src/app/admin/integrations/leafly/actions.ts
S=src/lib/leafly/replace-menu-server.ts
R=src/lib/leafly/replace-menu-core.ts

mutate "panel unmounted"            $C '<ReplaceMenuPanel configured={configured} />' ''
mutate "action loses gate"          $A '  const gate = await requireLeaflyReady();' '  const gate = { ok: true as const, error: "" };'
mutate "action loses confirm"       $A 'if (!input?.confirm) {' 'if (false) {'
mutate "server sends PUT"           $S 'method: "POST",
    operation: "full_menu_push"' 'method: "PUT",
    operation: "full_menu_push"'
mutate "panel bare yes"             $P 'acknowledgedWithheldCount: heldCount === 0 ? 0 : acknowledged ? heldCount : null' 'acknowledgedWithheldCount: heldCount'
mutate "core skips stale check"     $R '    if (ack !== withheldIds.length) {' '    if (false) {'
mutate "whole-menu PUT dropped"     $C '      <FullMenuPanel configured={configured} />' '      {null}'
mutate "PUT explanation changed"    $C 'plain: "Adds new products and updates existing ones. Never deletes anything."' 'plain: "Upserts."'
mutate "stale copy returns"         src/components/admin/syndication/LeaflySchedulePanel.tsx 'Always available, in the send tools above' 'Always available, in <strong>Live push to Leafly</strong> above'

echo "killed=$pass survived_or_skipped=$fail"
[ $fail -eq 0 ]

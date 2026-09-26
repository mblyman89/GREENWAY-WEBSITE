#!/usr/bin/env bash
# Inventory LEAFLY badge mutation check: each mutation MUST make the pinned
# tests fail. Run from repo root. Restores every file afterwards.
# Every anchor must appear exactly once (else SKIP = failure), and a baseline
# gate refuses to run when the tests are not green unmutated.
set -u
TESTS="tests/compliance/inventory-leafly-badge.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/ilb-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/ilb-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/ilb-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/ilb-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/ilb-mut-backup "$file"
}

if ! npx vitest run $TESTS > /tmp/ilb-mut-base.log 2>&1 || ! npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/ilb-mut-base-pure.log 2>&1; then
  echo "BASELINE NOT GREEN - fix the tests first (see /tmp/ilb-mut-base*.log)"; exit 2
fi
echo "baseline green"

C=src/lib/inventory/leafly-badge-core.ts
S=src/lib/inventory/leafly-badge-server.ts
P=src/app/admin/inventory/page.tsx

mutate "core: split parent not counted"         $C '    if (parent !== null) keys.add(parent);' ''
mutate "core: first marker instead of last"     $C '  const at = id.lastIndexOf(LEAFLY_SPLIT_ID_SEPARATOR);' '  const at = id.indexOf(LEAFLY_SPLIT_ID_SEPARATOR);'
mutate "core: single hyphen treated as split"   $C 'export const LEAFLY_SPLIT_ID_SEPARATOR = "--";' 'export const LEAFLY_SPLIT_ID_SEPARATOR = "-";'
mutate "core: empty slug accepted"              $C '  if (parent.length === 0 || slug.length === 0) return null;' '  if (parent.length === 0) return null;'
mutate "core: ids not trimmed"                  $C '    const id = raw.trim();' '    const id = raw;'
mutate "core: blank key matches"                $C '  if (key === "") return false;' ''
mutate "core: every lot badged"                 $C '  return onLeafly.has(key);' '  return true;'
mutate "core: hover drops 'our record'"         $C 'according to our record of what Leafly accepted' 'live on Leafly'
mutate "server: wrong channel"                  $S '    const state = await getSyncState("leafly");' '    const state = await getSyncState("weedmaps");'
mutate "server: failure invents badges"         $S '    return { keys: new Set(), title: leaflyBadgeTitle(null) };' '    return { keys: new Set(["*"]), title: leaflyBadgeTitle(null) };'
mutate "server: failure throws"                 $S '  } catch {
    return { keys: new Set(), title: leaflyBadgeTitle(null) };' '  } catch (e) {
    throw e;'
mutate "server: UTC instead of store time"      $S 'timeZone: "America/Los_Angeles"' 'timeZone: "UTC"'
mutate "server: Invalid Date printed"           $S '  if (Number.isNaN(d.getTime())) return null;' ''
mutate "page: badge unwired"                    $P '                          {isLotOnLeafly(l.pos_product_key, leafly.keys) && <LeaflyBadge title={leafly.title} />}' ''
mutate "page: badge on every row"               $P '{isLotOnLeafly(l.pos_product_key, leafly.keys) && <LeaflyBadge' '{true && <LeaflyBadge'
mutate "page: badge style drifts"               $P '      className="rounded bg-[var(--admin-purple-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-purple)]"' '      className="rounded-full bg-[var(--admin-purple-soft)] px-3 py-1 text-xs text-[var(--admin-purple)]"'
mutate "page: side by side, not stacked"        $P '<div className="flex flex-col items-center gap-1">' '<div className="flex items-center gap-1">'

echo "--------------------------------------------------"
echo "killed: $pass   survived/skipped: $fail"
[ "$fail" -eq 0 ]

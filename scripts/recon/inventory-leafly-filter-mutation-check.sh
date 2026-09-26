#!/usr/bin/env bash
# Inventory "Leafly" tab mutation check: each mutation MUST make the pinned
# tests fail. Run from repo root. Restores every file. Anchors must appear
# exactly once (else SKIP = failure); a baseline gate refuses a red start.
set -u
TESTS="tests/compliance/inventory-leafly-filter.test.ts tests/compliance/slice13-inventory-filtering.test.ts"
pass=0; fail=0
mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/ilf-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/ilf-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/ilf-mut.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/ilf-mut-backup "$file"
}
if ! npx vitest run $TESTS > /tmp/ilf-mut-base.log 2>&1; then echo "BASELINE NOT GREEN"; exit 2; fi
echo "baseline green"
C=src/lib/inventory/inventory-page-core.ts
P=src/app/admin/inventory/page.tsx
mutate "tab ignores the badge rule"        $C 'if (!isLotOnLeafly(lot.pos_product_key, leaflyKeys)) return false;' ''
mutate "tab inverts the badge rule"        $C 'if (!isLotOnLeafly(lot.pos_product_key, leaflyKeys)) return false;' 'if (isLotOnLeafly(lot.pos_product_key, leaflyKeys)) return false;'
mutate "tab falls through to lot.status"   $C 'if (state.status === LEAFLY_STATUS_TAB) {' 'if (false) {'
mutate "tab key renamed"                   $C 'export const LEAFLY_STATUS_TAB = "leafly";' 'export const LEAFLY_STATUS_TAB = "on_leafly";'
mutate "keys dropped in the pipeline"      $C 'matchesLegacyFilters(l, legacy, input.now, input.leaflyKeys ?? EMPTY_KEYS),' 'matchesLegacyFilters(l, legacy, input.now),'
mutate "tab skips other legacy knobs"      $C '    return false;
  }

  // .eq("vendor_id", opts.vendorId)' '    return false;
  }
  if (state.status === LEAFLY_STATUS_TAB) return true;

  // .eq("vendor_id", opts.vendorId)'
mutate "count ignores the rule"            $C 'for (const l of lots) if (isLotOnLeafly(l.pos_product_key, leaflyKeys)) n += 1;' 'for (const l of lots) if (l.pos_product_key) n += 1;'
mutate "count off by one"                  $C '  return n;
}

/**
 * Apply the legacy knobs.' '  return n + 1;
}

/**
 * Apply the legacy knobs.'
mutate "page: tab removed"                 $P '  { key: LEAFLY_STATUS_TAB, label: "Leafly" },' ''
mutate "page: keys not passed"             $P '    leaflyKeys: leafly.keys,' ''
mutate "page: count not shown"             $P '({leaflyLotCount})' '()'
mutate "page: honest empty state removed"  $P 'activeStatus === LEAFLY_STATUS_TAB && leafly.keys.size === 0' 'false'
mutate "page: white ink on purple"         $P '"bg-[var(--admin-purple)] text-black"' '"bg-[var(--admin-purple)] text-white"'
echo "RESULT: $pass killed, $fail survived/skipped"
[ $fail -eq 0 ]

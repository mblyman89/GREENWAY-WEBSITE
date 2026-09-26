#!/usr/bin/env bash
# Leafly order -> register cart (empty-cart fix) mutation check: each mutation
# MUST make the pinned tests fail. Run from repo root. Restores every file.
# Every anchor must appear exactly once (else SKIP = failure), and a baseline
# gate refuses to run when the tests are not green unmutated.
set -u
TESTS="tests/compliance/leafly-register-load.test.ts tests/compliance/leafly-l48-cart-server.test.ts tests/compliance/order-to-cart-core.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/lrl-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/lrl-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/lrl-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/lrl-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/lrl-mut-backup "$file"
}

if ! npx vitest run $TESTS > /tmp/lrl-mut-base.log 2>&1 || ! npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/lrl-mut-base-pure.log 2>&1; then
  echo "BASELINE NOT GREEN - fix the tests first (see /tmp/lrl-mut-base*.log)"; exit 2
fi
echo "baseline green"

C=src/lib/pos/leafly-register-lines-core.ts
P=src/lib/pos/pickup-store.ts
O=src/lib/pos/order-to-cart-core.ts
B=src/lib/leafly/bridge-core.ts
BS=src/lib/leafly/bridge-server.ts
CS=src/lib/leafly/order-cart-server.ts

# -- the pure core ------------------------------------------------------------
mutate "core: variant id not read"              $C '    const variantId = text(ci.integratorVariantId);' '    const variantId = null as string | null;'
mutate "core: wrong spec field"                 $C '    const variantId = text(ci.integratorVariantId);' '    const variantId = text(ci.id);'
mutate "core: envelope not unwrapped"           $C '      ? (o.order as Record<string, unknown>)
      : o;
  const items' '      ? o
      : o;
  const items'
mutate "core: default key not derived"          $C '      productId: leaflyProductIdFromVariantId(variantId),' '      productId: null,'
mutate "core: default suffix wrong"             $C 'export const LEAFLY_DEFAULT_VARIANT_SUFFIX = "-default";' 'export const LEAFLY_DEFAULT_VARIANT_SUFFIX = "-onboarded";'
mutate "core: bare suffix yields blank key"     $C '  return key === "" ? null : key;
}

/** Trimmed text' '  return key;
}

/** Trimmed text'
mutate "core: quantity not carried"             $C '      quantity,
    });' '      quantity: 1,
    });'
mutate "core: missing id silently dropped"      $C '    if (variantId === null) out.missingId.push(productName);' '    if (variantId === null) continue;'
mutate "core: website orders re-routed"         $C '  if (input.isMarketplace && input.leafly && input.leafly.lines.some((l) => l.variantId !== null)) {' '  if (input.leafly && input.leafly.lines.some((l) => l.variantId !== null)) {'
mutate "core: id-less Leafly copy preferred"    $C '  if (input.isMarketplace && input.leafly && input.leafly.lines.some((l) => l.variantId !== null)) {' '  if (input.isMarketplace && input.leafly && input.leafly.lines.length > 0) {'
mutate "core: Leafly copy never used"           $C '    return { lines: input.leafly.lines, source: "leafly" };' '    return { lines: input.stored, source: "stored" };'

# -- the server load path -----------------------------------------------------
mutate "load: Leafly copy not consulted"        $P '  const chosen = chooseRegisterLines({ isMarketplace: loadedIsMarketplace, leafly: leaflyReading, stored: storedLines });' '  const chosen = chooseRegisterLines({ isMarketplace: loadedIsMarketplace, leafly: null, stored: storedLines });'
mutate "load: stored lines returned anyway"     $P '    lines: chosen.lines,' '    lines: storedLines,'
mutate "load: reads for website orders too"     $P '  const leaflyReading = loadedIsMarketplace
    ? await' '  const leaflyReading = true
    ? await'
mutate "load: wrong order's Leafly row"         $P '      .eq("local_order_id", localOrderId)
      .limit(1)
      .maybeSingle<{ raw_order: unknown }>();
    if (error || !data) return null;' '      .eq("local_order_id", "x")
      .limit(1)
      .maybeSingle<{ raw_order: unknown }>();
    if (error || !data) return null;'
mutate "load: read error treated as a payload"  $P '    if (error || !data) return null;
    return { raw: data.raw_order };' '    if (!data) return { raw: null };
    return { raw: data.raw_order };'

# -- honest drop message ------------------------------------------------------
mutate "cart: id-less line says 'off the menu'" $O '      dropped.push(`${line.productName} (${UNMATCHED_LINE_REASON})`);' '      dropped.push(`${line.productName} (no longer on the menu)`);'
mutate "cart: vanished line not dropped"        $O '    if (!product) {
      dropped.push(`${line.productName} (no longer on the menu)`);' '    if (!product) {
      dropped.push(`${line.productName} (x)`);'

# -- forward fix: ids saved on new lines ---------------------------------------
mutate "draft: reader drops variant id"         $B '          priceMinorUnits: base,
          variantId,' '          priceMinorUnits: base,
          variantId: null,'
mutate "draft: first line loses variant id"     $B '      lines.push({ productName: name, variantLabel, quantity, priceMinorUnits: base, variantId });' '      lines.push({ productName: name, variantLabel, quantity, priceMinorUnits: base, variantId: null });'
mutate "draft: builder drops ids"               $B '    ...leaflyLineIds(l.variantId),' '    ...leaflyLineIds(null),'
mutate "draft: default key not derived"         $B '  return { variantId: v, productId: key === "" ? null : key };' '  return { variantId: v, productId: null };'
mutate "bridge insert: no variant_id"           $BS '            variant_id: l.variantId,' ''
mutate "bridge insert: no product_id"           $BS '            product_id: l.productId,' ''
mutate "L-48 rebuild insert: no variant_id"     $CS '          variant_id: l.variantId,' ''
mutate "L-48 rebuild insert: no product_id"     $CS '          product_id: l.productId,' ''

echo "--------------------------------------------------"
echo "killed: $pass   survived/skipped: $fail"
[ "$fail" -eq 0 ]

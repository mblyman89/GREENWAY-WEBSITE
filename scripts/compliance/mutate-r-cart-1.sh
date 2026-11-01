#!/bin/bash
# R-CART-1 mutation probe: every mutant must be "killed". Run from the repo root.
F=src/lib/pos/cart-adjust-core.ts
cp $F /tmp/orig.ts
run(){ name="$1"; py="$2"; cp /tmp/orig.ts $F; python3 -c "$py"; if cmp -s $F /tmp/orig.ts; then echo "NOAPPLY $name"; return; fi
  if npx vitest run tests/compliance/r-cart-1-variant-id.test.ts tests/compliance/cart-adjust-core.test.ts >/dev/null 2>&1; then echo "SURVIVED $name"; else echo "killed $name"; fi; }
P="import sys;p='$F';s=open(p).read()"
run uuid-back "$P;s=s.replace('&& !isMenuVariantId(p.variantId)','&& !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$/i.test(String(p.variantId))');open(p,'w').write(s)"
run no-trim-empty "$P;s=s.replace('return t.length > 0 &&','return t.length >= 0 &&');open(p,'w').write(s)"
run no-maxlen "$P;s=s.replace('t.length <= MAX_VARIANT_ID_LENGTH &&','');open(p,'w').write(s)"
run no-control "$P;s=s.replace('&& !CONTROL_RE.test(t)','');open(p,'w').write(s)"
run no-type "$P;s=s.replace('if (typeof v !== \"string\") return false;\n  const t = v.trim();','const t = String(v).trim();');open(p,'w').write(s)"
run no-reason-filter "$P;s=s.replace('if ((r.exceptionReason ?? \"\").trim() !== STRANDED_UUID_REASON) {','if (false) {');open(p,'w').write(s)"
run no-resolved-filter "$P;s=s.replace('if (r.status !== \"exception\" || r.resolvedAt != null) continue;','if (r.status !== \"exception\") continue;');open(p,'w').write(s)"
run no-status-filter "$P;s=s.replace('if (r.status !== \"exception\" || r.resolvedAt != null) continue;','if (r.resolvedAt != null) continue;');open(p,'w').write(s)"
run no-type-filter "$P;s=s.replace('if (r.eventType !== \"cart_adjustment\") continue;','');open(p,'w').write(s)"
run no-revalidate "$P;s=s.replace('    const check = validateCartAdjustPayload(payload);\n    if (!check.ok) {\n      plan.leave','    const check = { ok: true as const, errors: [] as string[] };\n    if (!check.ok) {\n      plan.leave');open(p,'w').write(s)"
cp /tmp/orig.ts $F

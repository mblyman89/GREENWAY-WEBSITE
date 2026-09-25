#!/usr/bin/env bash
# SLICE L-44 mutation check: each mutation MUST make the pinned tests fail.
# Run from repo root. Restores every file afterwards.
#
# The pure self-tests are ALSO run through the standalone entry point, which
# enforces the assertion floors, because several mutations here are designed to
# be caught by an embedded self-test rather than by a vitest case.
set -u
TESTS="tests/compliance/leafly-l44-preview-tax.test.ts tests/compliance/pure-selftests.test.ts tests/compliance/leafly-order-webhooks.test.ts tests/compliance/leafly-l43-hmac.test.ts"
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$file" /tmp/l44-mut-backup
  python3 - "$file" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf8").read()
if s.count(a) != 1:
    print("MUTATION ANCHOR COUNT", s.count(a), ":", a[:80]); sys.exit(3)
open(p, "w", encoding="utf8").write(s.replace(a, b, 1))
PY
  if [ $? -ne 0 ]; then echo "SKIP(anchor) $name"; fail=$((fail+1)); cp /tmp/l44-mut-backup "$file"; return; fi
  if npx vitest run $TESTS > /tmp/l44-mut.log 2>&1 && npx tsx scripts/compliance/run-pure-selftests.ts > /tmp/l44-mut-pure.log 2>&1; then
    echo "SURVIVED  $name"; fail=$((fail+1))
  else
    echo "killed    $name"; pass=$((pass+1))
  fi
  cp /tmp/l44-mut-backup "$file"
}

P=src/lib/leafly/preview-core.ts
R=src/app/api/webhooks/leafly/order-preview/route.ts
L=src/lib/leafly/preview-lookup.ts

# -- the route ---------------------------------------------------------------
mutate "route: unchecked exclusive builder"       $R '    const built = buildLeaflyWebhookPreviewResponse({ lines, lookup });' '    const built = (await import("@/lib/leafly/preview-core")).buildLeaflyPreviewResponse({ lines, lookup, presentation: "tax_exclusive_with_tax_lines" });'
mutate "route: unchecked default builder"         $R '    const built = buildLeaflyWebhookPreviewResponse({ lines, lookup });' '    const built = (await import("@/lib/leafly/preview-core")).buildLeaflyPreviewResponse({ lines, lookup });'
mutate "route: echo sends a tax line"             $R '        packagePrice: Math.trunc(l.packagePrice as number),
      })),
    taxes: [],' '        packagePrice: Math.trunc(l.packagePrice as number),
      })),
    taxes: [{ label: "WA Cannabis Excise Tax", amountCents: 1 }],'
mutate "route: ack-only sends a tax line"         $R '    console.log(handled.logLine);
    return NextResponse.json({ cartItems: [], taxes: [] }, { status: 200 });' '    console.log(handled.logLine);
    return NextResponse.json({ cartItems: [], taxes: [{ label: "x", amountCents: 1 }] }, { status: 200 });'

# -- the webhook builder ------------------------------------------------------
mutate "builder: exclusive presentation"          $P 'export const LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION = "tax_inclusive_no_tax_lines" as const;' 'export const LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION = "tax_exclusive_with_tax_lines" as const;'
mutate "builder: honours a caller presentation"   $P '    presentation: LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION,
  });
  const check' '    presentation: (input as { presentation?: LeaflyPreviewTaxPresentation }).presentation ?? LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION,
  });
  const check'
mutate "builder: never throws"                    $P '  if (!check.ok) throw new LeaflyPreviewTaxInvariantError(check);' '  void check;'

# -- the invariant checker ---------------------------------------------------
mutate "check: tax lines ignored"                 $P '  if (!Array.isArray(built.body.taxes) || built.body.taxes.length !== 0) {' '  if (!Array.isArray(built.body.taxes)) {'
mutate "check: missing taxes array passes"        $P '  if (!Array.isArray(built.body.taxes) || built.body.taxes.length !== 0) {' '  if (Array.isArray(built.body.taxes) && built.body.taxes.length !== 0) {'
mutate "check: price tolerance of 1 cent"         $P '    if (item.packagePrice !== feedPrice) {' '    if (Math.abs(item.packagePrice - feedPrice) > 1) {'
mutate "check: price check removed"               $P '    if (item.packagePrice !== feedPrice) {' '    if (false) {'
mutate "check: total check removed"               $P '  if (linesTotal !== built.outTheDoorTotalMinor) {' '  if (false) {'
mutate "check: unknown variant skipped silently"  $P '      violations.push({
        kind: "unknown_variant_in_body",' '      void ({
        kind: "unknown_variant_in_body",'
mutate "check: presentation not checked"          $P '  if (built.presentation !== LEAFLY_PREVIEW_WEBHOOK_TAX_PRESENTATION) {' '  if (false) {'
mutate "check: ok ignores violations"             $P '  return { ok: violations.length === 0, violations };' '  return { ok: true, violations };'

# -- the core it rests on ----------------------------------------------------
mutate "core: inclusive sends tax lines"          $P '  const taxes =
    presentation === "tax_exclusive_with_tax_lines"
      ? buildTaxComponents({ exciseMinor, salesMinor })
      : [];' '  const taxes = buildTaxComponents({ exciseMinor, salesMinor });'
mutate "core: inclusive publishes pre-tax"        $P '    const publishedPrice =
      presentation === "tax_exclusive_with_tax_lines"
        ? preTaxFromInclusive(shelfInclusive, facts.category)
        : shelfInclusive;' '    const publishedPrice = preTaxFromInclusive(shelfInclusive, facts.category);'
mutate "core: flag flipped back"                  $P 'export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = false;' 'export const LEAFLY_PREVIEW_TAX_PRESENTATION_IS_UNCONFIRMED = true;'
mutate "core: source loses Ben"                   $P '  "Ben (Leafly integrations), item 8, docs/leafly-ben-email-integration-round.md: " +' '  "Leafly integrations, item 8, docs/leafly-ben-email-integration-round.md: " +'

# -- the price source --------------------------------------------------------
mutate "lookup: floors instead of rounds"         $L '            priceMinorUnits: Math.round(v.priceMinorUnits),' '            priceMinorUnits: Math.floor(v.priceMinorUnits),'
mutate "lookup: default variant unrounded"        $L '          priceMinorUnits: Math.round(item.priceMinorUnits),' '          priceMinorUnits: item.priceMinorUnits,'

echo "killed=$pass survived_or_skipped=$fail"
[ $fail -eq 0 ]

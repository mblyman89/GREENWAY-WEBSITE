#!/usr/bin/env python3
"""SLICE C1 apply harness. Wires the markdown lock into the engine and threads
`markdownOnly` through the config parser. assert count == 1 + disk read-back."""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

EDITS = [
    # ------------------------------------------------ engine: import the lock
    (
        "src/lib/promotions/discount-engine-core.ts",
        'import { brandInList } from "@/lib/promotions/brand-match-core";',
        'import { brandInList } from "@/lib/promotions/brand-match-core";\n'
        '// SLICE C1: clearance / vendor-day markdowns. The DECISION about which\n'
        '// lines are locked out of every other deal lives there; all pricing,\n'
        '// clamping and rounding stays here.\n'
        'import {\n'
        '  computeMarkdownLock,\n'
        '  isMarkdownRule,\n'
        '  linesVisibleToRule,\n'
        '} from "@/lib/promotions/markdown-lock-core";',
    ),
    # ------------------------------------------------ engine: config field
    (
        '  eitherOr?: { flatPercent: number; bundle: { n: number; m: number } };\n};',
        '  eitherOr?: { flatPercent: number; bundle: { n: number; m: number } };\n'
        '  /**\n'
        '   * SLICE C1 -- CLEARANCE / VENDOR DAY. When true this rule is a MARKDOWN,\n'
        '   * not an ordinary promotion: every line it touches keeps this markdown\n'
        '   * and is excluded from all other sales and daily deals, whether the\n'
        '   * markdown is deeper than the day\'s deal or shallower.\n'
        '   *\n'
        '   * Owner, verbatim: clearance and vendor-day items are "excluded from any\n'
        '   * and all other sales/ daily deals".\n'
        '   *\n'
        '   * This is NOT the never-discount list. never-discount means "no promotion\n'
        '   * ever" and charges full price; a markdown charges the marked-down price.\n'
        '   */\n'
        '  markdownOnly?: boolean;\n};',
    ),
    # --------------- engine: compute the lock EARLY (before `competing`)
    (
        '  // Evaluate rules by priority (higher first) so ties favour the higher-priority promo.\n'
        '  const ordered = [...rules].sort((a, b) => b.priority - a.priority);',
        '  // Evaluate rules by priority (higher first) so ties favour the higher-priority promo.\n'
        '  const ordered = [...rules].sort((a, b) => b.priority - a.priority);\n'
        '\n'
        '  // SLICE C1: decide the markdown lock ONCE, before ANY rule is evaluated --\n'
        '  // including the SLICE D3 pre-pass below, which must not treat a clearance\n'
        '  // line as competition for the Saturday headline.\n'
        '  //\n'
        '  // A locked line is removed from every non-markdown rule\'s INPUT rather than\n'
        '  // having its result discarded afterwards, because the basket mechanics\n'
        '  // (Saturday\'s "30% off one item", Sunday\'s 3-for-2) SPREAD their savings\n'
        '  // across the eligible basket: a clearance item left in that basket would\n'
        '  // absorb part of a spread it can never receive and quietly shrink every\n'
        '  // other line in the cart.\n'
        '  const markdownLock = computeMarkdownLock(lines, ordered, ruleMatchesLine);',
    ),
    # ------------------------------------------------ engine: the main loop
    (
        '  for (const rule of ordered) {\n'
        '    const discounts = applyOnePromotion(rule, lines, competing);\n'
        '    for (const [lineId, d] of discounts.entries()) {',
        '  for (const rule of ordered) {\n'
        '    const visible = linesVisibleToRule(rule, lines, markdownLock);\n'
        '    if (visible.length === 0) continue;\n'
        '    const discounts = applyOnePromotion(rule, visible, competing);\n'
        '    for (const [lineId, d] of discounts.entries()) {',
    ),
    # ------------------------------ engine: markdown beats best-deal-wins
    (
        '      // Best-deal-wins (strictly exclusive \u2014 no stacking, ever).\n'
        '      if (newSavingsPerUnit > current.unitSavingsMinorUnits) {',
        '      // Best-deal-wins (strictly exclusive \u2014 no stacking, ever).\n'
        '      //\n'
        '      // SLICE C1: a MARKDOWN is exempt from the comparison. Measured before\n'
        '      // this change: a 10% clearance markdown on a $40.00 line lost to\n'
        '      // Munchie Monday\'s 25% and the receipt read "Munchie Monday", even\n'
        '      // though the owner\'s rule is that clearance items are out of every\n'
        '      // other deal. Best-deal-wins is right BETWEEN two offers competing for\n'
        '      // the customer; a markdown is a reprice of stock the store needs to\n'
        '      // move, so it applies whether or not it is the deeper number. Because\n'
        '      // locked lines are invisible to non-markdown rules, the only way two\n'
        '      // candidates reach one line here is if BOTH are markdowns -- and\n'
        '      // between two markdowns the deeper one still wins.\n'
        '      const ruleIsMarkdown = isMarkdownRule(rule);\n'
        '      const currentIsMarkdown = current.appliedRuleId != null\n'
        '        && markdownLock.markdownRuleIds.has(current.appliedRuleId);\n'
        '      const takeIt = ruleIsMarkdown && !currentIsMarkdown\n'
        '        ? true\n'
        '        : newSavingsPerUnit > current.unitSavingsMinorUnits;\n'
        '      if (takeIt) {',
    ),
    # ---------------- engine: the D3 pre-pass must also respect the lock
    (
        '  const competing = new Map<string, number>();\n'
        '  if (ordered.some(isBasketHeadline)) {\n'
        '    for (const rule of ordered) {\n'
        '      if (isBasketHeadline(rule)) continue;\n'
        '      for (const [lineId, d] of applyOnePromotion(rule, lines).entries()) {',
        '  const competing = new Map<string, number>();\n'
        '  if (ordered.some(isBasketHeadline)) {\n'
        '    for (const rule of ordered) {\n'
        '      if (isBasketHeadline(rule)) continue;\n'
        '      // SLICE C1: measure competition over the lines each rule can ACTUALLY\n'
        '      // reach. Without this the pre-pass would record a clearance line as\n'
        '      // "already getting 50% from Monday", steering the Saturday headline\n'
        '      // away from a line that was never Monday\'s to give.\n'
        '      const rivalLines = linesVisibleToRule(rule, lines, markdownLock);\n'
        '      for (const [lineId, d] of applyOnePromotion(rule, rivalLines).entries()) {',
    ),
]

# The parser lives in another file.
PARSER_EDITS = [
    (
        "src/lib/promotions/published-rules-core.ts",
        '  // NOTE: legacy `stackable` configs are intentionally IGNORED — discount\n'
        '  // stacking is hard-blocked (owner directive; see docs/PROMOTIONS_COMPLIANCE.md).\n'
        '  return out;',
        '  // SLICE C1: clearance / vendor-day markdown flag. Strictly `=== true` so a\n'
        '  // stray truthy value out of the jsonb column (the string "false", a 1)\n'
        '  // cannot silently lock a product out of every daily deal.\n'
        '  if (c.markdownOnly === true) out.markdownOnly = true;\n'
        '  // NOTE: legacy `stackable` configs are intentionally IGNORED — discount\n'
        '  // stacking is hard-blocked (owner directive; see docs/PROMOTIONS_COMPLIANCE.md).\n'
        '  return out;',
    ),
]

changed = 0
skipped = 0


def apply(rel, old, new):
    global changed, skipped
    p = ROOT / rel
    text = p.read_text()
    if text.count(new) == 1:
        skipped += 1
        print(f"  SKIP (already applied) {rel}")
        return
    n = text.count(old)
    assert n == 1, f"{rel}: anchor found {n} times, expected exactly 1\n---\n{old[:400]}"
    p.write_text(text.replace(old, new, 1))
    back = p.read_text()
    assert back.count(new) == 1, f"{rel}: read-back failed"
    changed += 1
    print(f"  OK {rel}")


print("SLICE C1: wiring the clearance markdown lock")
ENGINE = "src/lib/promotions/discount-engine-core.ts"
for item in EDITS:
    if len(item) == 3:
        rel, old, new = item
    else:
        rel, old, new = ENGINE, item[0], item[1]
    apply(rel, old, new)
for rel, old, new in PARSER_EDITS:
    apply(rel, old, new)

print(f"\nchanged={changed} skipped={skipped}")
if changed == 0 and skipped == 0:
    print("NOTHING HAPPENED", file=sys.stderr)
    sys.exit(1)

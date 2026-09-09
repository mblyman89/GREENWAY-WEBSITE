#!/usr/bin/env python3
"""SLICE T1: surface the brand near-misses to the owner in the Thursday planner.

Detection that nobody sees is not a fix. When the owner picks "Lifted" and the
live menu also carries "Lifted Cannabis", the planner now says so, in the one
screen where he can act on it.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
REL = "src/components/admin/promotions/ThursdayPlanner.tsx"

EDITS = [
    (
        'import { schedulePlannedThursdaysAction } from "@/app/admin/promotions/actions";',
        'import { schedulePlannedThursdaysAction } from "@/app/admin/promotions/actions";\n'
        '// SLICE T1: the brand matcher the ENGINE uses. Imported here so this screen\n'
        '// warns about exactly the brands the register would leave at full price --\n'
        '// if the planner used its own comparison, the warning could disagree with\n'
        '// the till, which is the class of bug T1 exists to remove.\n'
        'import { findBrandNearMisses } from "@/lib/promotions/brand-match-core";',
    ),
    (
        '  const plannedCount = thursdays.filter(\n'
        '    (t) => (weeks[t.ymd]?.brands.length ?? 0) > 0,\n'
        '  ).length;',
        '  const plannedCount = thursdays.filter(\n'
        '    (t) => (weeks[t.ymd]?.brands.length ?? 0) > 0,\n'
        '  ).length;\n'
        '\n'
        '  /**\n'
        '   * SLICE T1 -- NEAR MISSES.\n'
        '   *\n'
        '   * The matcher is deliberately exact: it will never decide on its own that\n'
        '   * "Lifted Cannabis" is the same deal as "Lifted", because that is a fact\n'
        '   * about the vendor agreement and not about the spelling. Measured on the\n'
        '   * store\'s live catalogue, four brands sit in that gap and cover 12\n'
        '   * products, which today ring up at full price while the shelf sign\n'
        '   * advertises their brand.\n'
        '   *\n'
        '   * So instead of guessing, this tells the owner. Picking the extra brand is\n'
        '   * one click away in the very list below.\n'
        '   */\n'
        '  const nearMisses = useMemo(() => {\n'
        '    const picked = Array.from(\n'
        '      new Set(Object.values(weeks).flatMap((w) => w.brands)),\n'
        '    );\n'
        '    if (picked.length === 0) return [];\n'
        '    // Only report brands the owner has NOT already selected -- an already\n'
        '    // scheduled brand is not a missed one.\n'
        '    const chosen = new Set(picked);\n'
        '    return findBrandNearMisses(brands, picked).filter((m) => !chosen.has(m.brand));\n'
        '  }, [brands, weeks]);',
    ),
    (
        '      {/* Action + result */}\n'
        '      <div className="flex flex-wrap items-center gap-3">',
        '      {/* SLICE T1: brands on the live menu that LOOK related to the ones\n'
        '          picked but do NOT match, and so would ring up at full price. */}\n'
        '      {nearMisses.length > 0 && (\n'
        '        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">\n'
        '          <p className="text-sm font-semibold text-amber-200">\n'
        '            {nearMisses.length} similar brand\n'
        '            {nearMisses.length === 1 ? "" : "s"} on your menu {nearMisses.length === 1 ? "is" : "are"} NOT included\n'
        '          </p>\n'
        '          <p className="mt-1 text-xs text-amber-100/80">\n'
        '            These are separate brand names in your menu, so the register will\n'
        '            charge FULL price for them. If they are the same vendor, tick them\n'
        '            in the list above as well.\n'
        '          </p>\n'
        '          <ul className="mt-3 space-y-1.5">\n'
        '            {nearMisses.map((m) => (\n'
        '              <li key={`${m.target}|${m.brand}`} className="text-xs text-white/80">\n'
        '                <span className="font-medium text-white">{m.brand}</span>\n'
        '                <span className="text-white/50"> vs your pick </span>\n'
        '                <span className="font-medium text-white">{m.target}</span>\n'
        '                {m.kind === "corporate-suffix" ? (\n'
        '                  <span className="ml-2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">\n'
        '                    likely the same company\n'
        '                  </span>\n'
        '                ) : (\n'
        '                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">\n'
        '                    may be a different line\n'
        '                  </span>\n'
        '                )}\n'
        '              </li>\n'
        '            ))}\n'
        '          </ul>\n'
        '        </div>\n'
        '      )}\n'
        '\n'
        '      {/* Action + result */}\n'
        '      <div className="flex flex-wrap items-center gap-3">',
    ),
]

changed = 0
skipped = 0
p = ROOT / REL
for old, new in EDITS:
    text = p.read_text()
    if text.count(new) == 1:
        skipped += 1
        print("  SKIP (already applied)")
        continue
    n = text.count(old)
    assert n == 1, f"anchor found {n} times, expected 1\n---\n{old[:300]}"
    p.write_text(text.replace(old, new, 1))
    assert p.read_text().count(new) == 1, "read-back failed"
    changed += 1
    print("  OK")

print(f"\nchanged={changed} skipped={skipped}")
if changed == 0 and skipped == 0:
    print("NOTHING HAPPENED", file=sys.stderr)
    sys.exit(1)

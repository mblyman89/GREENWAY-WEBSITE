/**
 * R29 mutation harness ("test the tests"). Each mutant reverts ONE piece of
 * the R29 logic; the named test command must then FAIL. A mutant that
 * survives (tests still green) is a hole in the tests. Every file is
 * restored in `finally`, even on crash.
 *
 *   npx tsx scripts/r29/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const VT = (f: string) => `npx vitest run ${f}`;
const PURE = (mod: string, fn: string) =>
  `npx tsx -e "import('./${mod}').then(m=>{const f=m.${fn}??(m.default&&m.default.${fn});if(typeof f!=='function'){console.error('no export ${fn}');process.exit(2)}const r=f();if(r&&r.failed)process.exit(1)}).catch(e=>{console.error(String(e).slice(0,300));process.exit(1)})"`;

const MUTANTS: Mutant[] = [
  {
    name: "card: package totals no longer outrank stale totalThc",
    file: "src/lib/menu/card-cannabinoids.ts",
    old: "  if (thc === null && cbd === null) return item;\n  const mgSlot",
    neu: "  return item;\n  const mgSlot",
    cmd: VT("tests/compliance/r29-ratio-card-render.test.tsx"),
  },
  {
    name: "card: servings line removed",
    file: "src/lib/menu/card-cannabinoids.ts",
    old: "  if (!isRatioLedCategory(item.category)) return null;\n  return servingSummary(withPackageTotals(item));",
    neu: "  return null;",
    cmd: VT("tests/compliance/r29-ratio-card-render.test.tsx"),
  },
  {
    name: "card: box limit back to 4 for ratio products",
    file: "src/components/menu/ProductCardVisual.tsx",
    old: "const boxLimit = isRatioLedCategory(item.category) ? 6 : 4;",
    neu: "const boxLimit = isRatioLedCategory(item.category) ? 3 : 4;",
    cmd: VT("tests/compliance/r29-ratio-card-render.test.tsx"),
  },
  {
    name: "lot filter compares package mg instead of percent",
    file: "src/lib/inventory/inventory-filter-core.ts",
    old: "if (!inNumericRange(lotCbdFilterValue(lot), state.cbdMin, state.cbdMax)) return false;",
    neu: "if (!inNumericRange((lot as { package_cbd_mg?: number | null }).package_cbd_mg ?? (lot.inventory_type === \"Liquid Edible\" ? null : lotCbdFilterValue(lot)), state.cbdMin, state.cbdMax)) return false;",
    cmd: VT("tests/compliance/slice13-inventory-filtering.test.ts"),
  },
  {
    name: "intake form: minors no longer merged into card compounds",
    file: "src/lib/pos/intake-fact-review-core.ts",
    old: "          card.compounds_json = mergeMinorMg(card.compounds_json, minors);",
    neu: "          void minors;",
    cmd: VT("tests/compliance/s30-intake-fact-review.test.ts"),
  },
  {
    name: "intake form: profile parser skipped (ratio / servings x mg / minors)",
    file: "src/lib/pos/intake-fact-review-core.ts",
    old: "    const profile = parseCannabinoidProfileFacts(get, facts);",
    neu: "    const profile = { ok: true as const, facts: {} };",
    cmd: VT("tests/compliance/s30-intake-fact-review.test.ts"),
  },
  {
    name: "profile parser: servings x mg contradiction accepted",
    file: "src/lib/pos/fact-review-core.ts",
    old: "    } else if (typed > 0 && Math.abs(typed - computed) / computed > 0.05) {",
    neu: "    } else if (typed > 0 && Math.abs(typed - computed) / computed > 500) {",
    cmd: PURE("src/lib/pos/fact-review-core.ts", "__runFactReviewCoreTests"),
  },
  {
    name: "mergeMinorMg drops the THC / % rows it must keep",
    file: "src/lib/menu/cannabinoid-profile-core.ts",
    old: "    rows = rows.filter((r) => !(r.type.toLowerCase() === type && r.unit === \"mg\"));",
    neu: "    rows = rows.filter((r) => !(r.type.toLowerCase() === type) && r.unit === \"mg\");",
    cmd: PURE("src/lib/menu/cannabinoid-profile-core.ts", "__runCannabinoidProfileCoreTests"),
  },
  {
    name: "mastering: lot bundle loses minors",
    file: "src/lib/pos/intake-mastering-core.ts",
    old: "        ...(minors.length > 0 ? { minor_cannabinoids_json: minors.map((c) => ({ ...c })) } : {}),",
    neu: "",
    cmd: VT("tests/compliance/s32-merge-review.test.ts"),
  },
  {
    name: "lot facts panel: minors not listed",
    file: "src/lib/inventory/coa-panel-core.ts",
    old: "  if (minorRows.length === 0) return out;",
    neu: "  if (minorRows.length >= 0) return out;",
    cmd: "npx tsx scripts/compliance/run-pure-selftests.ts",
  },
  {
    name: "titleCase: CBN back to Cbn",
    file: "src/lib/pos/transform.ts",
    old: "(Cbd|Thc|Cbg|Cbn|Cbc|Thcv|Cbdv|Thca|Cbda)",
    neu: "(Cbd|Thc)",
    cmd: PURE("src/lib/pos/transform.ts", "__runTransformCoreTests"),
  },
  {
    name: "draft injection: lab percent read as mg again",
    file: "src/lib/pos/draft-injection-core.ts",
    old: "    inventoryType: invType,\n    thcColumn: null,",
    neu: "    inventoryType: invType,\n    thcColumn: d.total_thc_pct,",
    cmd: VT("tests/compliance/r29-draft-injection-lab-pct.test.ts"),
  },
  {
    name: "draft injection: lab-percent potency rows printed as mg compounds again",
    file: "src/lib/pos/draft-injection-core.ts",
    old: "Object.entries(unit === \"mg\" ? {} : (d.potency_json ?? {}))",
    neu: "Object.entries(d.potency_json ?? {})",
    cmd: VT("tests/compliance/r29-draft-injection-lab-pct.test.ts"),
  },
  {
    name: "draft injection: lab_percent_not_mg disclosure dropped",
    file: "src/lib/pos/draft-injection-core.ts",
    old: "if (labPctSetAside && packageThcMg === null) {",
    neu: "if (false) {",
    cmd: VT("tests/compliance/r29-draft-injection-lab-pct.test.ts"),
  },
];
// Optional: R29_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R29_ONLY;
if (ONLY) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter((m) => m.name.includes(ONLY)));

// CONTROL: every command must PASS on the unmutated code, or a "kill" would
// be vacuous (a broken command fails for every mutant).
for (const cmd of [...new Set(MUTANTS.map((m) => m.cmd))]) {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 600_000 });
    console.log(`CONTROL ok   ${cmd.slice(0, 90)}`);
  } catch (e) {
    console.error(`CONTROL FAILED (clean code must pass): ${cmd}\n${String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 800)}`);
    process.exit(2);
  }
}

let killed = 0;
const survivors: string[] = [];
for (const m of MUTANTS) {
  const original = readFileSync(m.file, "utf8");
  const n = original.split(m.old).length - 1;
  if (n !== 1) {
    console.error(`HARNESS ERROR (${m.name}): anchor found ${n}x in ${m.file}`);
    process.exit(2);
  }
  try {
    writeFileSync(m.file, original.replace(m.old, m.neu));
    let failed = false;
    try {
      execSync(m.cmd, { stdio: "pipe", timeout: 600_000 });
    } catch {
      failed = true;
    }
    if (failed) {
      killed += 1;
      console.log(`KILLED   ${m.name}`);
    } else {
      survivors.push(m.name);
      console.log(`SURVIVED ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, original);
  }
}
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
if (survivors.length) {
  console.log("Survivors:\n - " + survivors.join("\n - "));
  process.exit(1);
}

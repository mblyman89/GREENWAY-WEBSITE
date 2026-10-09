/**
 * R32 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the R32 logic (truthful price fine print, identity memory for type /
 * strain type / shelf, the machine fill-only lot write, the paged reads, the
 * inventory onboarding join). The test command must then FAIL. A survivor is
 * a hole in the tests. Every file is restored in `finally`. A CONTROL pass
 * first proves the command is green on clean code, and every anchor must be
 * found exactly once.
 *
 *   npx tsx scripts/r32/mutation-harness.ts
 *   R32_ONLY=<substring> npx tsx scripts/r32/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const R32 = "npx vitest run tests/compliance/r32-onboarding-identity-memory.test.ts";

const PRICE = "src/lib/inventory/price-explain-core.ts";
const RECALL = "src/lib/inventory/onboarding-recall-core.ts";
const LOTC = "src/lib/inventory/lot-onboarding-core.ts";
const LOTS = "src/lib/inventory/lot-onboarding-server.ts";
const TABLE = "src/lib/inventory/lot-table-core.ts";
const SORT = "src/lib/inventory/inventory-sort-core.ts";
const FILTER = "src/lib/inventory/inventory-filter-core.ts";
const DRAFTS = "src/lib/inventory/catalog-drafts.ts";
const CARD = "src/app/admin/inventory/drafts/page.tsx";
const INV = "src/app/admin/inventory/page.tsx";

const MUTANTS: Mutant[] = [
  // --- price-explain-core: the 2x + tax + round-up rule ---
  {
    name: "price: rounds to nearest instead of UP",
    file: PRICE,
    old: "  return Math.ceil(cleaned / PRICE_WHOLE_DOLLAR_MINOR) * PRICE_WHOLE_DOLLAR_MINOR;",
    neu: "  return Math.round(cleaned / PRICE_WHOLE_DOLLAR_MINOR) * PRICE_WHOLE_DOLLAR_MINOR;",
    cmd: R32,
  },
  {
    name: "price: float-noise guard removed ($15.00 jumps to $16)",
    file: PRICE,
    old: "  const cleaned = Math.round(amountMinor * 1e6) / 1e6;",
    neu: "  const cleaned = amountMinor + 1e-9;",
    cmd: R32,
  },
  {
    name: "price: tax left out of the floor",
    file: PRICE,
    old: "  return roundUpToWholeDollarMinor(costMinor * multiple * priceTaxDivisorFor(category));",
    neu: "  return roundUpToWholeDollarMinor(costMinor * multiple);",
    cmd: R32,
  },
  {
    name: "price: non-cannabis taxed like cannabis",
    file: PRICE,
    old: "  return isNonCannabisCategory(category) ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR : TAX_INCLUSIVE_DIVISOR;",
    neu: "  return TAX_INCLUSIVE_DIVISOR;",
    cmd: R32,
  },
  // (The `if (suggested < floor)` guard is an EQUIVALENT mutant: every band
  // multiplier is >= 1 and the result is rounded UP, so it can never fire.
  // It stays as defence-in-depth against a mis-tuned band; not mutated.)
  {
    name: "price: demand uplift not applied (suggestion stuck at the floor)",
    file: PRICE,
    old: "  let suggested = roundUpToWholeDollarMinor(floor * band.multiplier);",
    neu: "  let suggested = roundUpToWholeDollarMinor(floor);",
    cmd: R32,
  },
  // --- onboarding-recall-core: identity memory ---
  {
    name: "recall: machine-stamped values become recallable",
    file: RECALL,
    old: "  return p === null || RECALLABLE.has(p);",
    neu: "  return true;",
    cmd: R32,
  },
  {
    name: "recall: unstamped (pre-R32 human) values are forgotten",
    file: RECALL,
    old: "  return p === null || RECALLABLE.has(p);",
    neu: "  return p !== null && RECALLABLE.has(p);",
    cmd: R32,
  },
  {
    name: "recall: ambiguous shelf memory (2 shelves) still recalled",
    file: RECALL,
    old: "    if (shelves.size === 1) {",
    neu: "    if (shelves.size >= 1) {",
    cmd: R32,
  },
  {
    name: "recall: a type outside the allowed list is recalled",
    file: RECALL,
    old: "    if (input.allowedTypeLabels && !input.allowedTypeLabels.has(t)) continue;",
    neu: "",
    cmd: R32,
  },
  {
    name: "recall: unknown identity key matches everything",
    file: RECALL,
    old: "  const same = identityKey === \"\"\n    ? []",
    neu: "  const same = false\n    ? []",
    cmd: R32,
  },
  {
    name: "type: remembered no longer outranks the labeler",
    file: RECALL,
    old: "  if (input.recalled) {\n    return {\n      value: input.recalled.value,\n      source: \"remembered\",\n      confidence: input.recalled.confidence,\n      needsTypePick: false,",
    neu: "  if (input.recalled && !input.labeler.autoAssigned) {\n    return {\n      value: input.recalled.value,\n      source: \"remembered\",\n      confidence: input.recalled.confidence,\n      needsTypePick: false,",
    cmd: R32,
  },
  {
    name: "type: category papers over a name/shelf clash",
    file: RECALL,
    old: "  const implied = input.labeler.houseType ? null : singleTypeForCategory(",
    neu: "  const implied = singleTypeForCategory(",
    cmd: R32,
  },
  {
    name: "type: the one-type category verdict is not persisted",
    file: RECALL,
    old: "      persistProvenance: ONBOARDING_PICK_PROVENANCE.category,",
    neu: "      persistProvenance: null,",
    cmd: R32,
  },
  {
    name: "strain: auto bar lowered (a guess gets written)",
    file: RECALL,
    old: "  if (s && sVal !== \"unknown\" && s.confidence >= STRAIN_AUTO_BAR) {",
    neu: "  if (s && sVal !== \"unknown\" && s.confidence >= 50) {",
    cmd: R32,
  },
  {
    name: "strain fill: overwrites a lot that already has a value",
    file: RECALL,
    old: "  if (before !== \"unknown\") {\n    return { write: false, code: \"lot_has_value\"",
    neu: "  if (false) {\n    return { write: false, code: \"lot_has_value\"",
    cmd: R32,
  },
  {
    name: "strain fill: drops the lot's other provenance keys",
    file: RECALL,
    old: "fact_provenance: { ...prov, strain_type: input.effective.lotProvenance } } };",
    neu: "fact_provenance: { strain_type: input.effective.lotProvenance } } };",
    cmd: R32,
  },
  // --- catalog-drafts.ts: server wiring ---
  {
    name: "server: machine fill not passed to the lot mirror",
    file: DRAFTS,
    old: "    machineFill: effectiveStrain,\n",
    neu: "",
    cmd: R32,
  },
  {
    name: "server: machine fill runs even when a human picked",
    file: DRAFTS,
    old: "  const fill = !input.humanPick && input.machineFill && input.machineFill.value ? input.machineFill : null;",
    neu: "  const fill = input.machineFill && input.machineFill.value ? input.machineFill : null;",
    cmd: R32,
  },
  {
    name: "server: a failed page still yields a half memory",
    file: DRAFTS,
    old: "  if (read.verdict.reason === \"read_failed\") return [];\n",
    neu: "",
    cmd: R32,
  },
  {
    name: "server: memory reads dismissed drafts too",
    file: DRAFTS,
    old: "        .eq(\"status\", \"approved\")\n        .order(\"updated_at\", { ascending: false })",
    neu: "        .order(\"updated_at\", { ascending: false })",
    cmd: R32,
  },
  {
    name: "server: the gate ignores the shared type verdict",
    file: DRAFTS,
    old: "    needsTypePick: effectiveType.needsTypePick,\n  };",
    neu: "    needsTypePick: assessment.needsTypePick,\n  };",
    cmd: R32,
  },
  {
    name: "server: provenance merged AFTER the pinned write",
    file: DRAFTS,
    old: "  classificationProvenance = { ...classificationProvenance, ...onboardingProvenance };\n",
    neu: "",
    cmd: R32,
  },
  // --- drafts card ---
  {
    name: "card: type basis line removed",
    file: CARD,
    old: 'data-testid="draft-type-basis"',
    neu: 'data-testid="draft-type-x"',
    cmd: R32,
  },
  // --- inventory join ---
  {
    name: "join: onboarding read not paged-checked (incomplete never flagged)",
    file: LOTS,
    old: "    return { byLot: indexApprovedDraftsByLot(read.rows), complete: read.verdict.complete };",
    neu: "    return { byLot: indexApprovedDraftsByLot(read.rows), complete: true };",
    cmd: R32,
  },
  {
    name: "join: dismissed drafts indexed as onboarded",
    file: LOTC,
    old: "    if (!d || d.status !== \"approved\") continue;",
    neu: "    if (!d) continue;",
    cmd: R32,
  },
  {
    name: "join: margin ignores tax (overstates margin)",
    file: LOTC,
    old: "  const preTax = priceMinor / priceTaxDivisorFor(category);",
    neu: "  const preTax = priceMinor;",
    cmd: R32,
  },
  {
    name: "join: missing cost reads as a 100% margin",
    file: LOTC,
    old: "  if (costMinor == null || !Number.isFinite(costMinor) || costMinor < 0) return null;",
    neu: "  if (costMinor == null) costMinor = 0;",
    cmd: R32,
  },
  {
    name: "join: draft strain overwrites the lot's own value",
    file: LOTC,
    old: "  if (lotStrain !== \"unknown\") {\n    strainType = strainTypeLabel(lotStrain);",
    neu: "  if (lotStrain !== \"unknown\" && draftStrain === \"unknown\") {\n    strainType = strainTypeLabel(lotStrain);",
    cmd: R32,
  },
  {
    name: "join: draft strain not carried to the table row",
    file: LOTC,
    old: "      onboarding_strain_type: draftStrain !== \"unknown\" ? draftStrain : null,",
    neu: "      onboarding_strain_type: null,",
    cmd: R32,
  },
  {
    name: "table: blank lot strain type no longer falls back to onboarding",
    file: TABLE,
    old: "  return strainTypeText(lot.onboarding_strain_type);",
    neu: "  return EM_DASH;",
    cmd: R32,
  },
  {
    name: "table: onboarding type ignored for CCRS-blob categories",
    file: TABLE,
    old: "  if (onboarded) return onboarded;\n",
    neu: "",
    cmd: R32,
  },
  {
    name: "sort: margin column removed",
    file: SORT,
    old: '  { key: "margin", label: "Margin"',
    neu: '  { key: "margin_x", label: "Margin"',
    cmd: R32,
  },
  {
    name: "facet: Onboarded facet removed",
    file: FILTER,
    old: '  { param: "fOnboarded", label: "Onboarded"',
    neu: '  { param: "fOnboardedX", label: "Onboarded"',
    cmd: R32,
  },
  {
    name: "page: lots not joined before buildInventoryPage",
    file: INV,
    old: "    lots: joinedLots as PageLot[],",
    neu: "    lots: allLots as PageLot[],",
    cmd: R32,
  },
  {
    name: "page: incomplete-read notice removed",
    file: INV,
    old: "        {!onboardingIndex.complete && (",
    neu: "        {false && (",
    cmd: R32,
  },
  {
    name: "page: wide table clipped again",
    file: INV,
    old: '<div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">',
    neu: '<div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">',
    cmd: R32,
  },
];

// Optional: R32_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R32_ONLY;
if (ONLY) MUTANTS.splice(0, MUTANTS.length, ...MUTANTS.filter((m) => m.name.includes(ONLY)));

// Every anchor must exist exactly once BEFORE anything runs.
for (const m of MUTANTS) {
  const n = readFileSync(m.file, "utf8").split(m.old).length - 1;
  if (n !== 1) {
    console.error(`HARNESS ERROR (${m.name}): anchor found ${n}x in ${m.file}`);
    process.exit(2);
  }
}

// CONTROL: every command must PASS on the unmutated code.
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

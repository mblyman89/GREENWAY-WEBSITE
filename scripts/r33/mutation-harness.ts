/**
 * R33 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the R33 logic (lot strain / details push to the website, the reviewer
 * lock, the product's own lab terpenes, the house-type override, the PDP
 * size words + JSON-LD weight, the green button, the public refresh). The
 * test command must then FAIL. A survivor is a hole in the tests. Every file
 * is restored in `finally`. A CONTROL pass first proves the command is green
 * on clean code, and every anchor must be found exactly once.
 *
 *   npx tsx scripts/r33/mutation-harness.ts
 *   R33_ONLY=<substring> npx tsx scripts/r33/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const LOTT = "npx vitest run tests/compliance/r33-lot-propagation.test.ts";
const WEB = "npx vitest run tests/compliance/r33-website-facts.test.ts";
const PURE = "npx vitest run tests/compliance/r33-pure-cores.test.ts";

const STORE = "src/lib/inventory/lot-propagation-store.ts";
const ACT = "src/app/admin/inventory/actions.ts";
const SCORE = "src/lib/inventory/lot-strain-propagation-core.ts";
const OVC = "src/lib/menu/product-facts-overlay-core.ts";
const OVS = "src/lib/menu/product-facts-overlay-server.ts";
const STS = "src/lib/menu/strain-terpenes-server.ts";
const ST = "src/lib/menu/strain-terpenes.ts";
const CATS = "src/lib/menu/menu-category-override-server.ts";
const PANEL = "src/components/menu/ProductDetailPurchasePanel.tsx";
const SIZE = "src/lib/menu/pdp-size-core.ts";
const SEO = "src/lib/seo/seo.ts";
const PS = "src/lib/site/public-surfaces.ts";
const INJ = "src/lib/pos/draft-injection-core.ts";
const PAGE = "src/app/admin/inventory/[id]/page.tsx";

const MUTANTS: Mutant[] = [
  // --- the store ---
  { name: "store: import-staged versions are written too", file: STORE,
    old: 'if (v.status === "published" || (v.status === "staged" && v.import_id === null)) statusById.set(v.id, v.status);',
    neu: 'if (v.status === "published" || v.status === "staged") statusById.set(v.id, v.status);', cmd: LOTT },
  { name: "store: a failed card read still writes", file: STORE,
    old: "      if (!read.ok) return fail(read.error);", neu: "      if (!read.ok) { cards = []; }", cmd: LOTT },
  { name: "store: pending drafts get the memory too", file: STORE,
    old: '      .eq("status", "approved");', neu: "      ;", cmd: LOTT },
  { name: "store: websiteChanged never set", file: STORE,
    old: "      out.websiteChanged = true;", neu: "      void 0;", cmd: LOTT },
  { name: "store: sibling read failure ignored", file: STORE,
    old: "      if (!sib.ok) return fail(sib.error);", neu: "      if (!sib.ok) { /* ignored */ } else", cmd: LOTT },
  // --- the core ---
  { name: "core: card not stamped reviewer", file: SCORE,
    old: 'patch: { strain_type: target, fact_provenance: withStamp(prov, "strain_type", value === null ? null : LOT_STRAIN_REVIEWER) },',
    neu: "patch: { strain_type: target, fact_provenance: prov },", cmd: LOTT },
  { name: "core: disagreeing sibling lot ignored", file: SCORE,
    old: "      if (disagree.length > 0) {", neu: "      if (false && disagree.length > 0) {", cmd: LOTT },
  // --- the actions ---
  { name: "action: no public refresh after a website change", file: ACT,
    old: "    if (outcome.websiteChanged) revalidatePublicMenuSurfaces();\n    banner", neu: "    banner", cmd: LOTT },
  { name: "action: propagation skipped", file: ACT,
    old: "  if (strainChanged || hasNameChange(names)) {", neu: "  if (false) {", cmd: LOTT },
  // ("always propagate" is an EQUIVALENT mutant: with no change the store
  // returns before any read, no audit is written and the banner is empty.)
  { name: "action: a brand-only edit also pushes the strain type", file: ACT,
    old: "      strainType: strainChanged ? { value: patch.strain_type } : null,", neu: "      strainType: { value: patch.strain_type },", cmd: LOTT },
  { name: "send-to-website: blank type pushed", file: ACT,
    old: "  if (!lot.strain_type) {", neu: "  if (false) {", cmd: LOTT },
  // --- the overlay ---
  { name: "overlay: own terpenes overwrite explicit item terpenes", file: OVC,
    old: "    if (!(item.terpenes && item.terpenes.length > 0) && terps.size > 0) {", neu: "    if (terps.size > 0) {", cmd: PURE },
  { name: "overlay: reviewer stamp never applied", file: OVC,
    old: '    if (reviewer.has(item.id) && item.strainTypeSource !== "reviewer") {', neu: "    if (false) {", cmd: WEB },
  { name: "overlay: oldest draft wins", file: OVC,
    old: 'String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))', neu: 'String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? ""))', cmd: PURE },
  { name: "overlay server: unapproved drafts read", file: OVS,
    old: '          .eq("status", "approved")\n', neu: "\n", cmd: WEB },
  { name: "overlay server: reviewer filter dropped", file: OVS,
    old: '            .eq("fact_provenance->>strain_type", "reviewer")\n', neu: "\n", cmd: WEB },
  { name: "overlay server: reviewer read on any version", file: OVS,
    old: '      .eq("status", "published")\n', neu: "\n", cmd: WEB },
  { name: "withMenuProfile: overlay not applied", file: STS,
    old: "    withProductFacts(items),", neu: "    Promise.resolve(items),", cmd: WEB },
  { name: "strain library overrides a reviewer type", file: ST,
    old: 'const kbType = item.strainTypeSource === "reviewer" ? null : strainTypeForStrain(strainTypeIndex, item.strainName);',
    neu: "const kbType = strainTypeForStrain(strainTypeIndex, item.strainName);", cmd: PURE },
  { name: "onboarding: human strain pick not stamped", file: INJ,
    old: '      factProvenance.strain_type = "reviewer";\n    }\n    const goldenCopy', neu: '      void 0;\n    }\n    const goldenCopy', cmd: WEB },
  // --- house type ---
  { name: "house_type override dropped", file: CATS,
    old: "    return applyHouseTypeOverrides(applyCategoryOverrides(items, map), types);", neu: "    return applyCategoryOverrides(items, map);", cmd: WEB },
  // --- PDP size / weight / button ---
  { name: "panel: single-size line removed", file: PANEL,
    old: "variants.length === 1 && item.variants.length > 0 ? purchaseSizeLabel(", neu: "false ? purchaseSizeLabel(", cmd: WEB },
  { name: "panel: synthetic default variant shows a size", file: PANEL,
    old: "variants.length === 1 && item.variants.length > 0 ? purchaseSizeLabel(", neu: "variants.length === 1 ? purchaseSizeLabel(", cmd: WEB },
  { name: "panel: button back to pale green", file: PANEL,
    old: "rounded-md bg-[var(--greenway)] px-5", neu: "rounded-md bg-[#d8e6c4] px-5", cmd: WEB },
  { name: "size: retail fraction never shown", file: SIZE,
    old: "Math.abs(g - grams) < 0.01);", neu: "Math.abs(g - grams) < -1);", cmd: PURE },
  { name: "size: ratio-led categories get a gram line too", file: SIZE,
    old: "  if (!GRAM_SIZE_CATEGORIES.has(cat) || isRatioLedCategory(cat)) return null;", neu: "", cmd: PURE },
  { name: "size: multi-size product gets one JSON-LD weight", file: SIZE,
    old: "  if (sizes.length !== 1) return null;", neu: "  if (sizes.length === 0) return null;", cmd: WEB },
  { name: "seo: weight key emitted as null", file: SEO,
    old: "    ...(item.weight ? { weight: item.weight } : {}),", neu: "    weight: item.weight ?? null,", cmd: WEB },
  { name: "public surfaces: /menu/[category] dropped", file: PS,
    old: 'export const PUBLIC_MENU_PAGE_PATTERNS = ["/menu/products/[id]", "/menu/[category]"] as const;',
    neu: 'export const PUBLIC_MENU_PAGE_PATTERNS = ["/menu/products/[id]"] as const;', cmd: WEB },
  { name: "lot page: form no longer keyed (React 19 reset returns)", file: PAGE,
    old: "<form key={detailsFormKey} action={detailsAction}", neu: "<form action={detailsAction}", cmd: WEB },
];

// Optional: R33_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R33_ONLY;
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

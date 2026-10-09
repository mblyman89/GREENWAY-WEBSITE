/**
 * R35 #4 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the WAC 314-55-095 manual-form warning (the limits, the boundaries, the
 * category scope, the topical exemption, the arithmetic, the banner wording,
 * the code-only URL, the save-not-refuse rule, the audit, the error path, the
 * wiring on every form). Its kill command must then FAIL. A survivor is a
 * hole in the tests. A CONTROL pass first proves every kill command is green
 * on clean code, every anchor must be found exactly once, and every file is
 * restored in `finally`.
 *
 *   npx tsx scripts/r35/mutation-harness-wac.ts
 *   R35_ONLY=<substring> npx tsx scripts/r35/mutation-harness-wac.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const VT = "npx vitest run tests/compliance/r35-serving-limit-warning.test.ts";
const CORE_T = `npx tsx -e 'import {__runServingLimitWarningCoreTests as t} from "./src/lib/compliance/serving-limit-warning-core"; const r=t(); if (r.failed) process.exit(1);'`;
const COA_T = "npx vitest run tests/compliance/r28-coa-panels.test.ts tests/compliance/r35-serving-limit-warning.test.ts";

const CORE = "src/lib/compliance/serving-limit-warning-core.ts";
const COA = "src/lib/inventory/coa-facts-core.ts";
const PANEL_CORE = "src/lib/inventory/coa-panel-core.ts";
const ACT = "src/app/admin/inventory/drafts/actions.ts";
const MIA = "src/app/admin/menu-imports/actions.ts";
const PFP = "src/app/admin/inventory/drafts/ProductFactsPanel.tsx";
const IFR = "src/app/admin/inventory/drafts/IntakeFactReviewPanel.tsx";
const DPAGE = "src/app/admin/inventory/drafts/page.tsx";
const MIP = "src/app/admin/menu-imports/[id]/facts/page.tsx";
const LCP = "src/components/admin/inventory/LabCertificatePanels.tsx";
const CPS = "src/lib/inventory/coa-panel-server.ts";
const LOTP = "src/app/admin/inventory/[id]/page.tsx";

const MUTANTS: Mutant[] = [
  // --- core: limits + boundaries ---
  { name: "core: serving limit 10 -> 11", file: CORE, old: "export const WA_SERVING_MAX_THC_MG = 10;", neu: "export const WA_SERVING_MAX_THC_MG = 11;", cmd: CORE_T },
  { name: "core: package limit 100 -> 110", file: CORE, old: "export const WA_PACKAGE_MAX_THC_MG = 100;", neu: "export const WA_PACKAGE_MAX_THC_MG = 110;", cmd: CORE_T },
  { name: "core: other-THC each 0.5 -> 1", file: CORE, old: "export const WA_OTHER_THC_EACH_MAX_MG = 0.5;", neu: "export const WA_OTHER_THC_EACH_MAX_MG = 1;", cmd: CORE_T },
  { name: "core: serving > becomes >= (10 mg warns)", file: CORE, old: "if (per !== null && per > WA_SERVING_MAX_THC_MG) {", neu: "if (per !== null && per >= WA_SERVING_MAX_THC_MG) {", cmd: CORE_T },
  { name: "core: package > becomes >=", file: CORE, old: "if (pkg !== null && pkg > WA_PACKAGE_MAX_THC_MG) {", neu: "if (pkg !== null && pkg >= WA_PACKAGE_MAX_THC_MG) {", cmd: CORE_T },
  { name: "core: tolerance sneaks in (+0.5 mg)", file: CORE, old: "if (per !== null && per > WA_SERVING_MAX_THC_MG) {", neu: "if (per !== null && per > WA_SERVING_MAX_THC_MG + 0.5) {", cmd: CORE_T },
  { name: "core: serving check removed", file: CORE, old: "if (per !== null && per > WA_SERVING_MAX_THC_MG) {", neu: "if (false) {", cmd: VT },
  { name: "core: package check removed", file: CORE, old: "if (pkg !== null && pkg > WA_PACKAGE_MAX_THC_MG) {", neu: "if (false) {", cmd: VT },
  // --- core: scope ---
  { name: "core: unknown category exempted", file: CORE, old: 'return c === "" || SERVING_LIMIT_CATEGORIES.has(c);', neu: "return SERVING_LIMIT_CATEGORIES.has(c);", cmd: VT },
  { name: "core: every category checked (flower warns)", file: CORE, old: 'return c === "" || SERVING_LIMIT_CATEGORIES.has(c);', neu: "return true || SERVING_LIMIT_CATEGORIES.has(c);", cmd: VT },
  { name: "core: tincture dropped from scope", file: CORE, old: 'new Set(["edible-solid", "edible-liquid", "tincture", "topical"])', neu: 'new Set(["edible-solid", "edible-liquid", "topical"])', cmd: CORE_T },
  { name: "core: category case-sensitive", file: CORE, old: 'const c = typeof category === "string" ? category.trim().toLowerCase() : "";', neu: 'const c = typeof category === "string" ? category.trim() : "";', cmd: CORE_T },
  { name: "core: topical package exemption dropped", file: CORE, old: "  if (PACKAGE_LIMIT_EXEMPT_CATEGORIES.has(c)) return out;\n", neu: "", cmd: VT },
  { name: "core: topical exempt from serving too", file: CORE, old: "  if (!servingLimitApplies(input.category)) return [];\n", neu: '  if (!servingLimitApplies(input.category) || String(input.category).trim().toLowerCase() === "topical") return [];\n', cmd: VT },
  // --- core: arithmetic ---
  { name: "core: computed package ignored (typed only)", file: CORE, old: "const pkg = typed ?? (per !== null && sv !== null && Number.isInteger(sv) ? r2(per * sv) : null);", neu: "const pkg = typed;", cmd: VT },
  { name: "core: arithmetic wins over the typed package", file: CORE, old: "const pkg = typed ?? (per !== null && sv !== null && Number.isInteger(sv) ? r2(per * sv) : null);", neu: "const pkg = (per !== null && sv !== null && Number.isInteger(sv) ? r2(per * sv) : null) ?? typed;", cmd: CORE_T },
  { name: "core: fractional servings computed", file: CORE, old: "const pkg = typed ?? (per !== null && sv !== null && Number.isInteger(sv) ? r2(per * sv) : null);", neu: "const pkg = typed ?? (per !== null && sv !== null ? r2(per * sv) : null);", cmd: CORE_T },
  { name: "core: negatives accepted", file: CORE, old: 'const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);', neu: 'const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : null);', cmd: CORE_T },
  { name: "core: arithmetic not disclosed", file: CORE, old: "const how = typed === null && per !== null && sv !== null ? ` (${fmt(sv)} servings x ${fmt(per)} mg)` : \"\";", neu: 'const how = "";', cmd: CORE_T },
  // --- core: wording / url ---
  { name: "core: serving sentence loses the rule cite", file: CORE, old: "single-serving limit (${SERVING_RULE}).`;", neu: "single-serving limit.`;", cmd: CORE_T },
  { name: "core: wrong rule cited for the package", file: CORE, old: 'export const PACKAGE_RULE = "WAC 314-55-095(1)(b)";', neu: 'export const PACKAGE_RULE = "WAC 314-55-095(1)(a)";', cmd: CORE_T },
  { name: "core: unknown URL codes accepted", file: CORE, old: "  return ALL_CODES.filter((c) => parts.has(c));", neu: "  return [...parts] as ServingLimitCode[];", cmd: CORE_T },
  { name: "core: banner never mentions the package", file: CORE, old: '  if (codes.includes("package_over_limit")) parts.push(', neu: '  if (false) parts.push(', cmd: CORE_T },
  { name: "core: junk category hint trusted", file: CORE, old: "  return /^[a-z][a-z0-9-]{0,40}$/.test(c) ? c : null;", neu: "  return c || null;", cmd: VT },
  { name: "core: audit always null", file: CORE, old: "  return warnings.length ? warnings.map((w) => ({ code: w.code, rule: w.rule })) : null;", neu: "  return null;", cmd: VT },
  // --- COA path shares the constants ---
  { name: "coa: serving limit retyped as 10", file: COA, old: "  if (printedThc > WA_SERVING_MAX_THC_MG) {", neu: "  if (printedThc > 10) {", cmd: VT },
  { name: "coa: package limit loosened", file: COA, old: "  if (out.packageThcMg && out.packageThcMg.value > WA_PACKAGE_MAX_THC_MG) {", neu: "  if (out.packageThcMg && out.packageThcMg.value > WA_PACKAGE_MAX_THC_MG * 2) {", cmd: COA_T },
  // --- action: save, never refuse; audit; url ---
  { name: "drafts action: over-limit REFUSED instead of saved", file: ACT, old: "  let code: FactResultCode;\n  let message = \"\";", neu: "  if (limitWarnings.length) redirect(back(form.manifestId, form.draftId, { fact: \"error\", fact_msg: \"over limit\" }));\n  let code: FactResultCode;\n  let message = \"\";", cmd: VT },
  { name: "drafts action: warning not audited", file: ACT, old: "          servingLimitWarnings: servingLimitAudit(limitWarnings),\n", neu: "", cmd: VT },
  { name: "drafts action: warning param dropped", file: ACT, old: "  if (warnParam) extra[SERVING_LIMIT_PARAM] = warnParam;", neu: "  void warnParam;", cmd: VT },
  { name: "drafts action: warning shown on a failed save", file: ACT, old: 'const warnParam = code !== "error" && code !== "migration" ? servingLimitParam(limitWarnings) : null;', neu: "const warnParam = servingLimitParam(limitWarnings);", cmd: VT },
  { name: "drafts action: category hint ignored (flower warns)", file: ACT, old: '          category: limitCategoryFromForm(get("limit_category")),', neu: "          category: null,", cmd: VT },
  { name: "menu-import action: warning param dropped", file: MIA, old: "  const warnParam = servingLimitParam(limitWarnings);", neu: "  const warnParam = null as string | null;\n  void servingLimitParam;", cmd: VT },
  { name: "menu-import action: not audited", file: MIA, old: "after: { note, correctedFacts, servingLimitWarnings: servingLimitAudit(limitWarnings) },", neu: "after: { note, correctedFacts },", cmd: VT },
  { name: "menu-import action: focus anchor before the warning", file: MIA, old: 'if (focusSuffix) redirect(dest + "?saved=1" + warnSuffix + focusSuffix);', neu: 'if (focusSuffix) redirect(dest + "?saved=1" + focusSuffix + warnSuffix);', cmd: VT },
  // --- banners ---
  { name: "lot/KB banner: warning never turns it red", file: PANEL_CORE, old: '  return warn ? { text: `${text} ${warn}`, tone: "bad" } : { text, tone };', neu: "  return warn ? { text: `${text} ${warn}`, tone } : { text, tone };", cmd: VT },
  { name: "lot page: fact_warn not passed", file: LOTP, old: "banner={factSaveBanner(fact, fact_msg, fact_warn)} />", neu: "banner={factSaveBanner(fact, fact_msg)} />", cmd: VT },
  { name: "drafts page: banner ignores fact_warn", file: DPAGE, old: "      ? servingLimitBannerText(parseServingLimitCodes(sp.fact_warn))", neu: "      ? servingLimitBannerText(parseServingLimitCodes(undefined))", cmd: VT },
  // --- forms ---
  { name: "Product facts: saved-facts alert removed", file: PFP, old: "      {limitWarnings.length > 0 && (", neu: "      {false && limitWarnings.length > 0 && (", cmd: VT },
  { name: "Product facts: limits hint removed", file: PFP, old: "            {limitsApply && (", neu: "            {false && limitsApply && (", cmd: VT },
  { name: "Product facts: hidden category not posted", file: PFP, old: '            {category && <input type="hidden" name="limit_category" value={category} />}\n', neu: "", cmd: VT },
  { name: "Drafts flag panel: hint removed", file: IFR, old: "          {servingLimitApplies(category ?? null) && (", neu: "          {false && (", cmd: VT },
  { name: "drafts page: category not passed to the flag panel", file: DPAGE, old: "                                  returnManifest={focus.manifestId}\n                                  category={displayCategory}\n                                />", neu: "                                  returnManifest={focus.manifestId}\n                                />", cmd: VT },
  { name: "lot/KB: category not passed", file: LCP, old: "            category={ctx.draft.chosen_website_category ?? null}\n", neu: "", cmd: VT },
  { name: "lot/KB: category not read", file: CPS, old: "inventory_type, chosen_website_category", neu: "inventory_type", cmd: VT },
  { name: "menu imports: row warning removed", file: MIP, old: 'data-testid="facts-row-limit-warning"', neu: 'data-testid="facts-row-x"', cmd: VT },
];

function run(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 300_000 });
    return true;
  } catch {
    return false;
  }
}

const only = process.env.R35_ONLY;
const list = only ? MUTANTS.filter((m) => m.name.includes(only)) : MUTANTS;

// anchors exist exactly once
for (const m of list) {
  const src = readFileSync(m.file, "utf8");
  const n = src.split(m.old).length - 1;
  if (n !== 1) {
    console.error(`ANCHOR ${n}x (need 1): ${m.name}`);
    process.exit(2);
  }
}
// CONTROL: every kill command is green on clean code
for (const cmd of [...new Set(list.map((m) => m.cmd))]) {
  if (!run(cmd)) {
    console.error(`CONTROL FAILED (clean code is red): ${cmd}`);
    process.exit(2);
  }
}
console.log(`CONTROL ok on ${new Set(list.map((m) => m.cmd)).size} kill commands`);

let killed = 0;
const survivors: string[] = [];
for (const m of list) {
  const orig = readFileSync(m.file, "utf8");
  try {
    writeFileSync(m.file, orig.replace(m.old, m.neu));
    const green = run(m.cmd);
    if (green) {
      survivors.push(m.name);
      console.log(`SURVIVED  ${m.name}`);
    } else {
      killed += 1;
      console.log(`killed    ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, orig);
  }
}
console.log(`\nR35 #4 mutants: ${killed}/${list.length} killed`);
if (survivors.length) {
  console.log("SURVIVORS:\n  " + survivors.join("\n  "));
  process.exit(1);
}

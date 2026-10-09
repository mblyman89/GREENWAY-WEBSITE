/**
 * R34 mutation harness ("test the tests"). Each mutant breaks ONE piece of
 * the R34 expiration system (the guarded writes, the source rules, the
 * dynamic category registry, the opt-in custom-category resolution, the
 * report maths, the export, the actions' stale guard and audit). The test
 * command must then FAIL. A survivor is a hole in the tests. Every file is
 * restored in `finally`. A CONTROL pass first proves each command is green on
 * clean code, and every anchor must be found exactly once.
 *
 *   npx tsx scripts/r34/mutation-harness.ts
 *   R34_ONLY=<substring> npx tsx scripts/r34/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const VT = "npx vitest run tests/compliance/r34-expiration-rules.test.ts";
const CORE_T =
  `npx tsx -e 'import {__runExpiryRulesCoreTests as t} from "./src/lib/inventory/expiry-rules-core"; const r=t(); if (r.failed) process.exit(1);'`;
const EXP_T =
  `npx tsx -e 'import {__runExpiryReportExportTests as t} from "./src/lib/inventory/expiry-report-export"; const r=t(); if (r.failed) process.exit(1);'`;
const RES_T =
  `npx tsx -e 'import {__runWebsiteCategoryResolverTests as t} from "./src/lib/inventory/website-category-resolver"; t();'`;

const CORE = "src/lib/inventory/expiry-rules-core.ts";
const STORE = "src/lib/inventory/expiry-rules-store.ts";
const ACT = "src/app/admin/inventory/expiration-rules/actions.ts";
const PAGE = "src/app/admin/inventory/expiration-rules/page.tsx";
const RES = "src/lib/inventory/website-category-resolver.ts";
const RESS = "src/lib/inventory/website-category-resolver-server.ts";
const EXP = "src/lib/inventory/expiry-report-export.ts";
const ROUTE = "src/app/admin/reports/expiration/export/route.ts";
const TABS = "src/components/admin/reports/ReportTabs.tsx";
const FR = "src/lib/accounting/factory-reset-core.ts";

const MUTANTS: Mutant[] = [
  // --- store: guarded writes ---
  { name: "store: blank guard dropped (overwrites a date set after preview)", file: STORE,
    old: '  if (d.guard.kind === "blank") q = q.is("expires_on", null);', neu: '  if (d.guard.kind === "blank") q = q;', cmd: VT },
  { name: "store: destroyed lots writable", file: STORE,
    old: '.eq("id", d.lotId).neq("status", "destroyed");', neu: '.eq("id", d.lotId);', cmd: VT },
  { name: "store: 'changed' counted as written", file: STORE,
    old: '  return { outcome: ((data as { id: string }[] | null) ?? []).length > 0 ? "written" : "changed" };',
    neu: '  return { outcome: "written" };', cmd: VT },
  { name: "store: changed lots added to writtenDecisions", file: STORE,
    old: "        changed += 1;\n        changedLotIds.push(d.lotId);", neu: "        changed += 1;\n        changedLotIds.push(d.lotId);\n        writtenDecisions.push(d);", cmd: VT },
  { name: "store: failed lot read tolerated", file: STORE,
    old: "    if (!read.verdict.complete) {", neu: "    if (false) {", cmd: VT },
  { name: "store: custom categories not opted in", file: STORE,
    old: "    { includeCustomCategories: true },", neu: "    {},", cmd: VT },
  { name: "store: owner label ignored", file: STORE,
    old: "      ? (labelOf ? labelOf(resolutions[i].websiteCategory as string) : resolutions[i].label) || resolutions[i].label",
    neu: "      ? resolutions[i].label", cmd: VT },
  { name: "store: rule note not written", file: STORE,
    old: "          expires_on_rule_note: d.note,", neu: "          expires_on_rule_note: null,", cmd: VT },
  { name: "store: clear leaves the rule id", file: STORE,
    old: "          expires_on_rule_id: null,\n          expires_on_rule_note: null,", neu: "          expires_on_rule_note: null,", cmd: VT },
  // --- resolver: opt-in custom categories ---
  { name: "resolver: custom categories accepted by default", file: RES,
    old: "  const isValid = (v: string) => VALID_CATEGORY.has(v) || Boolean(extra?.has(v));",
    neu: "  const isValid = (v: string) => true || VALID_CATEGORY.has(v) || Boolean(extra?.has(v));", cmd: RES_T },
  { name: "resolver: extra categories ignored", file: RES,
    old: "  const isValid = (v: string) => VALID_CATEGORY.has(v) || Boolean(extra?.has(v));",
    neu: "  const isValid = (v: string) => VALID_CATEGORY.has(v);", cmd: RES_T },
  { name: "resolver: custom label lost", file: RES,
    old: "  const labelOf = (v: string) => (VALID_CATEGORY.has(v) ? websiteCategoryLabel(v) : extra?.get(v) || v);",
    neu: "  const labelOf = (v: string) => websiteCategoryLabel(v);", cmd: RES_T },
  { name: "resolver-server: built-ins counted as custom (none excluded)", file: RESS,
    old: "      if (v && !builtIn.has(v)) out.set(v, String(r.label ?? \"\").trim() || v);",
    neu: "      if (v && builtIn.has(v)) out.set(v, String(r.label ?? \"\").trim() || v);", cmd: VT },
  // --- core: dynamic registry ---
  { name: "core: hidden categories always dropped", file: CORE,
    old: "    if (!active && !keep.has(normalizeScopeKey(value))) continue;", neu: "    if (!active) continue;", cmd: CORE_T },
  { name: "core: hidden categories always kept", file: CORE,
    old: "    if (!active && !keep.has(normalizeScopeKey(value))) continue;", neu: "    void keep;", cmd: CORE_T },
  { name: "core: owner sort order ignored", file: CORE,
    old: '    return sa - sb || String(a.label ?? "").localeCompare(String(b.label ?? ""));',
    neu: '    return 0 * (sa - sb) || String(a.label ?? "").localeCompare(String(b.label ?? ""));', cmd: CORE_T },
  { name: "core: custom flag never set", file: CORE,
    old: 'custom: r.is_system === false, hidden: !active });', neu: 'custom: false, hidden: !active });', cmd: VT },
  { name: "core: duplicate registry values kept", file: CORE,
    old: "    if (!value || seen.has(value)) continue;", neu: "    if (!value) continue;", cmd: CORE_T },
  { name: "core: hidden owner type with a rule dropped", file: CORE,
    old: "      if (!ruleOf.has(`type|${k}`)) continue;\n      hiddenTypes.add(k);", neu: "      continue;", cmd: CORE_T },
  { name: "core: owner category no longer wins", file: CORE,
    old: "    if (wins && category) t.category = category;", neu: "    void wins;", cmd: CORE_T },
  // --- core: report maths ---
  { name: "core: gaps keep fully dated categories", file: CORE,
    old: "    .filter((g) => g.undated > 0)", neu: "    .filter((g) => g.undated >= 0)", cmd: CORE_T },
  { name: "core: disabled category rule counts as cover", file: CORE,
    old: '  const ruled = new Set(rules.filter((r) => r.enabled && r.scope === "category")',
    neu: '  const ruled = new Set(rules.filter((r) => r.scope === "category")', cmd: CORE_T },
  { name: "core: forecast folds expired stock in", file: CORE,
    old: "    if (!d || d < todayPacific) continue;", neu: "    if (!d) continue;", cmd: CORE_T },
  { name: "core: value at risk ignores 0-30 days", file: CORE,
    old: '    const atRisk = b === "expired" || b === "d0_30";', neu: '    const atRisk = b === "expired";', cmd: CORE_T },
  // --- export ---
  { name: "export: watchlist value total wrong", file: EXP,
    old: "          value: report.watch.reduce((n, w) => n + w.valueMinor, 0),", neu: "          value: 0,", cmd: EXP_T },
  { name: "export: coverage as a percent number instead of fraction", file: EXP,
    old: "            coverage: c.lots ? c.dated / c.lots : 0,", neu: "            coverage: c.lots ? (c.dated / c.lots) * 100 : 0,", cmd: EXP_T },
  { name: "export: unknown sheet name falls through to watchlist", file: EXP,
    old: ': "all";\n}', neu: ': "watchlist";\n}', cmd: EXP_T },
  { name: "route: partial export on a failed read", file: ROUTE,
    old: "  if (!lotsRead.ok) {\n    return new Response(`Expiration export unavailable: ${lotsRead.error}`, { status: 503 });\n  }",
    neu: "", cmd: VT },
  { name: "route: permission not checked", file: ROUTE,
    old: '  await requirePermission("reports.view");', neu: "", cmd: VT },
  // --- actions ---
  { name: "action: stale fingerprint accepted", file: ACT,
    old: "  if (!fp || fp !== nowFp) {", neu: "  if (!fp) {", cmd: VT },
  { name: "action: audit lists planned (not written) lots", file: ACT,
    old: "  const written = res.writtenDecisions;", neu: "  const written = res.plan.writes;", cmd: VT },
  { name: "action: report not refreshed after apply", file: ACT,
    old: '  revalidatePath("/admin/reports/expiration");\n', neu: "", cmd: VT },
  { name: "action: save never audits", file: ACT,
    old: '      action: r.before ? "inventory_expiry_rule.updated" : "inventory_expiry_rule.created",',
    neu: '      action: "x",', cmd: VT },
  // --- wiring ---
  { name: "page: back to the static taxonomy", file: PAGE,
    old: "    listWebsiteCategoryTypes({ includeInactive: true }),", neu: "    listWebsiteCategoryTypes({ includeInactive: false }),", cmd: VT },
  { name: "tabs: report tab removed", file: TABS,
    old: '  { href: "/admin/reports/expiration", label: "Expiration", icon: "\u23f3" },\n', neu: "", cmd: VT },
  { name: "factory reset: rules wiped", file: FR,
    old: '  { table: "inventory_expiry_rules", disposition: "KEEP",', neu: '  { table: "inventory_expiry_rules", disposition: "WIPE",', cmd: VT },
];

// Optional: R34_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R34_ONLY;
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

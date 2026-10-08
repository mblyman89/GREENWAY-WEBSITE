/**
 * R30 mutation harness ("test the tests"). Each mutant reverts or breaks ONE
 * piece of the R30 logic (first-pass lab attach, terpenes as the tenth fact,
 * strain-library learning, survivorship). The test command must then FAIL. A
 * mutant that survives (tests still green) is a hole in the tests. Every file
 * is restored in `finally`, even on crash. A CONTROL pass first proves the
 * command is green on the clean code (otherwise every "kill" is vacuous), and
 * every anchor must be found exactly once.
 *
 *   npx tsx scripts/r30/mutation-harness.ts
 *   R30_ONLY=<substring> npx tsx scripts/r30/mutation-harness.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

type Mutant = { name: string; file: string; old: string; neu: string; cmd: string };

const R30 =
  "npx vitest run tests/compliance/r30-lab-facts-attach.test.ts tests/compliance/s07-attach-product-facts.test.ts tests/compliance/product-lookup-core.test.ts tests/compliance/attached-facts-schema.test.ts tests/compliance/s11-onboarding-row.test.ts tests/compliance/s06-structured-lookup.test.ts";

const CORE = "src/lib/catalog/lab-facts-attach-core.ts";
const SRV = "src/lib/catalog/lab-facts-attach.ts";
const PLAN = "src/lib/catalog/attach-plan-core.ts";

const MUTANTS: Mutant[] = [
  // --- lab-facts-attach-core (pure planner) ---
  {
    name: "core: infused / concentrate types also teach the strain",
    file: CORE,
    old: 'new Set(["usable marijuana", "usable cannabis"])',
    neu: 'new Set(["usable marijuana", "usable cannabis", "marijuana mix infused", "concentrate for inhalation"])',
    cmd: R30,
  },
  {
    name: "core: an archived strain is written",
    file: CORE,
    old: 'if (String(row.status ?? "").trim().toLowerCase() === "archived") return { action: "skip", reason: "the strain is archived" };',
    neu: "",
    cmd: R30,
  },
  {
    name: "core: a certificate creates a missing strain (would-be update on null)",
    file: CORE,
    old: '  if (!row) return { action: "skip", reason: "the strain is not in the strain library yet (a certificate never creates a strain)" };',
    neu: '  if (!row) row = { id: "new", terpenes: [] };',
    cmd: R30,
  },
  {
    name: "core: strain source tag never added",
    file: CORE,
    old: "    if (!s.includes(STRAIN_COA_SOURCE_TAG)) s.push(STRAIN_COA_SOURCE_TAG);",
    neu: "",
    cmd: R30,
  },
  {
    name: "core: panel pre-fills over a saved value",
    file: CORE,
    old: "    if (has) keptSaved.push(target);\n    else prefill[target] = String(f.value);",
    neu: "    prefill[target] = String(f.value);",
    cmd: R30,
  },
  {
    name: "core: no-op suppression disabled (re-run re-writes + re-audits)",
    file: CORE,
    old: "      return JSON.stringify(rec.value) !== JSON.stringify(f.value);",
    neu: "      return true;",
    cmd: R30,
  },
  {
    name: "core: no-op suppression ignores the value (a corrected certificate never lands)",
    file: CORE,
    old: "    if (rec.source !== f.source) return true;",
    neu: "    if (rec.source !== f.source) return true;\n    return false;",
    cmd: R30,
  },
  // --- lab-facts-attach (server orchestrator) ---
  {
    name: "server: strain learning dropped",
    file: SRV,
    old: "          for (const t of plan.strainTerpenes) if (!cur.includes(t)) cur.push(t);",
    neu: "",
    cmd: R30,
  },
  {
    name: "server: provenance rows never built",
    file: SRV,
    old: "        if (built.ok) provRows.push(built.row);",
    neu: "        void built;",
    cmd: R30,
  },
  {
    name: "server: audit row never recorded",
    file: SRV,
    old: "    if (run.attached > 0 || run.strainsUpdated > 0) {\n      await recordAudit({",
    neu: "    if (false) {\n      await recordAudit({",
    cmd: R30,
  },
  {
    name: "server: missing 0235 not recognised (attempts writes)",
    file: SRV,
    old: "      if (isMissingAttachedFactsError(dr.error)) return { ...run, unmigrated: true };",
    neu: "",
    cmd: R30,
  },
  {
    name: "server: reads every manifest's drafts",
    file: SRV,
    old: '      .eq("manifest_id", manifestId)\n      .in("status", ["draft", "approved"]);',
    neu: '      .in("status", ["draft", "approved", "dismissed"]);',
    cmd: R30,
  },
  // --- survivorship (attach-facts-core) ---
  {
    name: "merge: a web value replaces a lab value (keptLab rule removed)",
    file: "src/lib/catalog/attach-facts-core.ts",
    old: '    if (cur.source === "coa" && l.source !== "coa" && l.source !== "human") {',
    neu: "    if (false) {",
    cmd: R30,
  },
  {
    name: "merge: the lab replaces a person's value",
    file: "src/lib/catalog/attach-facts-core.ts",
    old: '    if (cur.source === "human" && l.source !== "human") {',
    neu: '    if (cur.source === "human" && l.source !== "human" && l.source !== "coa") {',
    cmd: R30,
  },
  // --- attach-plan-core terpene rules (Gemini door) ---
  {
    name: "plan: web terpenes teach the strain for any product type",
    file: PLAN,
    old: '      if (f === "terpenes" && !input.strainLearnsTerpenes) {',
    neu: '      if (f === "terpenes" && false) {',
    cmd: R30,
  },
  {
    name: "plan: web terpenes mix into a populated strain list",
    file: PLAN,
    old: "          if (cur.length === 0) {\n            patch.terpenes = val(f);",
    neu: "          if (true) {\n            patch.terpenes = val(f);",
    cmd: R30,
  },
  {
    name: "plan: strain terpenes written blind when the column was not read",
    file: PLAN,
    old: "          if (ex.terpenes === undefined) {\n            strainNotes.set(f, SKIP.terpenes_lab_first);\n            continue;\n          }",
    neu: "",
    cmd: R30,
  },
  {
    name: "plan: a populated product terpene list is replaced",
    file: PLAN,
    old: "        if (cur.length > 0) {\n          const have = new Set(cur.map((x) => x.toLowerCase()));",
    neu: "        if (false) {\n          const have = new Set(cur.map((x) => x.toLowerCase()));",
    cmd: R30,
  },
  {
    name: "plan: canonical terpenes stop mapping to the KB vocabulary",
    file: PLAN,
    old: "      const slug = kbTerpeneSlug(x);",
    neu: "      const slug = x.toLowerCase();",
    cmd: R30,
  },
  // --- Gemini cleaning ---
  {
    name: "lookup: cleanTerpenes skips the copy lint",
    file: "src/lib/inventory/product-lookup-core.ts",
    old: '    if (!name.trim() || lintCopy(name, extraBanned).disposition === "block") continue;',
    neu: "    if (!name.trim()) continue;",
    cmd: R30,
  },
  {
    name: "lookup: cleanTerpenes keeps unknown names (guessing)",
    file: "src/lib/inventory/product-lookup-core.ts",
    old: "    const slug = kbTerpeneSlug(name);",
    neu: "    const slug = kbTerpeneSlug(name) ?? name.toLowerCase();",
    cmd: R30,
  },
  // --- wiring ---
  {
    name: "finalize: first-pass lab attach removed",
    file: "src/lib/inventory/intake-store.ts",
    old: "      const labRun = await attachLabFactsToManifestDrafts(manifestId, actorId).catch((reason: unknown) => {",
    neu: "      const labRun = await Promise.resolve(null).catch((reason: unknown) => {",
    cmd: R30,
  },
  {
    name: "re-read: lab attach removed",
    file: "src/app/admin/inventory/actions.ts",
    old: "        const labRun = await attachLabFactsToManifestDrafts(run.manifestId, session.userId);",
    neu: "        const labRun = { attached: 0, facts: 0, kept: 0, strainsUpdated: 0, unmigrated: false, errors: [] as string[], drafts: 0, noPanel: 0, strainTerpenesAdded: 0 };",
    cmd: R30,
  },
  {
    name: "onboarding: terpenes no longer the tenth fact",
    file: "src/lib/catalog/fact-chips-core.ts",
    old: '  "terpenes",\n] as const',
    neu: "] as const",
    cmd: R30,
  },
  {
    name: "attach door: strain flower flag hard-wired true",
    file: "src/lib/catalog/attach-facts.ts",
    old: "strainLearnsTerpenes: strainLearnsFromType(sf.inventoryType)",
    neu: "strainLearnsTerpenes: true",
    cmd: R30,
  },
];

// Optional: R30_ONLY=<substring> runs just the matching mutants.
const ONLY = process.env.R30_ONLY;
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

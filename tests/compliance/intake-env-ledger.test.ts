/**
 * tests/compliance/intake-env-ledger.test.ts  (owner request, Round 5)
 *
 * "Will you add to the roadmap strategy to provide for me all of the vercel
 *  env variables to add to vercel at the very end of this whole pipeline
 *  build."
 *
 * docs/INTAKE_PIPELINE_ENV_LEDGER.md is that list. This guard keeps it true
 * while the build continues:
 *   1. every pipeline flag constant in src/ (`export const X_ENV = "NAME"`
 *      under src/lib/inventory and src/lib/catalog) is in the ledger's
 *      "Shipped" table AND in .env.example;
 *   2. every variable in the ledger's "Shipped" table is really read by the
 *      code (no stale rows);
 *   3. every AI_* variable provider.ts / router.ts read is in the ledger's AI
 *      table (the same derivation the S00 .env.example guard uses);
 *   4. the "Planned" names are the bible's, and are NOT yet read by code
 *      (a planned name that ships must move to "Shipped");
 *   5. the final checklist exists and mentions every shipped flag.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const LEDGER = "docs/INTAKE_PIPELINE_ENV_LEDGER.md";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** `export const FOO_ENV = "NAME"` in the pipeline modules. */
function pipelineFlagNames(): string[] {
  const files = [...walk(path.join(ROOT, "src/lib/inventory")), ...walk(path.join(ROOT, "src/lib/catalog"))];
  const names = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/export const [A-Z0-9_]+_ENV = "([A-Z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

/** Backticked names in the first column of a markdown table under `## <heading>`. */
function tableNames(doc: string, heading: string): string[] {
  const start = doc.indexOf(heading);
  if (start < 0) return [];
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const names: string[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\| `([A-Z0-9_]+)` \|/);
    if (m) names.push(m[1]);
  }
  return names;
}

const ledger = read(LEDGER);
const envExample = read(".env.example");
const inExample = (v: string) => new RegExp(`^#?\\s*${v}=`, "m").test(envExample);

describe("intake env ledger", () => {
  it("derives the pipeline flags from the code (proves the derivation works)", () => {
    const flags = pipelineFlagNames();
    for (const v of ["INTAKE_IDENTITY_STAMP", "LOOKUP_SCHEMA_V2", "ATTACH_POLICY_RING", "INTAKE_BATCH_STAGING", "INTAKE_CUTOVER_GUARD", "INTAKE_VENDOR_ID_IDENTITY"]) expect(flags).toContain(v);
  });

  it("every pipeline flag is in the Shipped table AND .env.example", () => {
    const shipped = tableNames(ledger, "## 1. Shipped pipeline flags");
    for (const v of pipelineFlagNames()) {
      expect(shipped, `${v} missing from ${LEDGER} §1`).toContain(v);
      expect(inExample(v), `${v} missing from .env.example`).toBe(true);
    }
  });

  it("no stale Shipped rows: each is read via process.env[<CONST>] somewhere in src", () => {
    const shipped = tableNames(ledger, "## 1. Shipped pipeline flags");
    expect(shipped.length).toBeGreaterThanOrEqual(3);
    const all = walk(path.join(ROOT, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const v of shipped) {
      const constDecl = all.match(new RegExp(`export const ([A-Z0-9_]+) = "${v}"`));
      expect(constDecl, `${v} has no exported constant`).not.toBeNull();
      expect(all.includes(`process.env[${constDecl![1]}]`), `${v} is never read`).toBe(true);
    }
  });

  it("every AI_* var provider/router read is in the AI table", () => {
    const src = read("src/lib/ai/provider.ts") + read("src/lib/ai/router.ts");
    const vars = new Set([
      ...[...src.matchAll(/process\.env\.(AI_[A-Z0-9_]+)/g)].map((m) => m[1]),
      ...[...src.matchAll(/num\("(AI_[A-Z0-9_]+)"/g)].map((m) => m[1]),
    ]);
    expect(vars.size).toBeGreaterThanOrEqual(15);
    const table = tableNames(ledger, "## 2. AI provider variables");
    for (const v of vars) expect(table, `${v} missing from ledger §2`).toContain(v);
  });

  it("the platform table lists the three Supabase variables", () => {
    expect(tableNames(ledger, "## 3. Platform variables")).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("planned names are the bible's, and none is read by code yet", () => {
    const planned = ["ATTACH_FACTS_V2", "KB_FIRST_ONBOARDING", "ONBOARDING_V2_ROW"];
    const sec = ledger.slice(ledger.indexOf("## 4. Planned flags"));
    const all = walk(path.join(ROOT, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const v of planned) {
      expect(sec).toContain(`\`${v}\``);
      expect(all.includes(`"${v}"`), `${v} now ships: move it to §1`).toBe(false);
    }
  });

  it("the final Vercel checklist exists, is the owner's request, and names each shipped flag", () => {
    expect(ledger).toContain("Will you add to the roadmap strategy to provide for me all of the vercel env variables");
    const final = ledger.slice(ledger.indexOf("## Final Vercel checklist"));
    expect(final.length).toBeGreaterThan(100);
    for (const v of tableNames(ledger, "## 1. Shipped pipeline flags")) expect(final).toContain(`\`${v}\``);
    expect(final).toContain("`ATTACH_POLICY_RING` = `1`");
  });

  it("the per-slice 'added / added no variable' lists match the Slice column of section 1", () => {
    const sec1 = ledger.slice(ledger.indexOf("## 1. Shipped pipeline flags"), ledger.indexOf("## 2."));
    const bySlice = new Map<string, string>();
    for (const m of sec1.matchAll(/^\| `([A-Z0-9_]+)` \| (S\d\d) \|/gm)) bySlice.set(m[2], m[1]);
    expect(bySlice.size).toBeGreaterThanOrEqual(3);
    const addedLine = ledger.match(/Slices that \*\*added\*\* a variable: ([^\n]+)/);
    const noneLine = ledger.match(/Slices that added \*\*no\*\* variable: ([^\n]+?)\. /);
    expect(addedLine).not.toBeNull();
    expect(noneLine).not.toBeNull();
    const added = new Map([...addedLine![1].matchAll(/(S\d\d) \(`([A-Z0-9_]+)`\)/g)].map((m) => [m[1], m[2]] as [string, string]));
    // Every section-1 row appears in the "added" list with the same name, and vice versa.
    expect([...added.entries()].sort()).toEqual([...bySlice.entries()].sort());
    const none = [...noneLine![1].matchAll(/S\d\d/g)].map((m) => m[0]);
    expect(none.length).toBeGreaterThanOrEqual(7);
    for (const s of none) expect(bySlice.has(s), `${s} is filed as "no variable" but owns a section-1 row`).toBe(false);
    // S14 (onboarding list) is pure URL/query/UI: it reads no environment.
    expect(none).toContain("S14");
    expect(read("src/lib/catalog/onboarding-list-core.ts")).not.toMatch(/process\.env/);
    // S15 (one archival rule) rolls back by re-applying the previous RPC body,
    // not by a flag. Its new code reads no environment.
    expect(none).toContain("S15");
    for (const f of ["src/lib/pos/publish-archive-rule-core.ts", "src/lib/pos/publish-guard-core.ts"]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).toContain("supabase/rollbacks/0236_publish_archive_rule.rollback.sql");
    // S16 (Publish exception queue) is copy + pure logic; bible S16.7 "Revert.".
    expect(none).toContain("S16");
    for (const f of ["src/lib/pos/publish-queue-core.ts", "src/app/admin/publish/page.tsx"]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S17 (batch staging) ADDED a flag - bible S17.7 "Flag." - so it must be in
    // the added list and NOT in the none list.
    expect(none).not.toContain("S17");
    expect(added.get("S17")).toBe("INTAKE_BATCH_STAGING");
    // S18 (cutover guard) ADDED a flag - bible S18.7 "Flag." - and its planned
    // row left section 4 (a planned row for a shipped slice would be stale).
    expect(none).not.toContain("S18");
    expect(added.get("S18")).toBe("INTAKE_CUTOVER_GUARD");
    expect(ledger.slice(ledger.indexOf("## 4. Planned flags"))).not.toMatch(/^\| S18 \|/m);
    // S19 (vendor-id identity) ADDED a flag - bible S19.7 "Flag." - and its
    // planned "named in S19" row left section 4.
    expect(none).not.toContain("S19");
    expect(added.get("S19")).toBe("INTAKE_VENDOR_ID_IDENTITY");
    expect(ledger.slice(ledger.indexOf("## 4. Planned flags"))).not.toMatch(/^\| S19 \|/m);
    expect(read("src/lib/inventory/vendor-identity-core.ts")).toContain('export const VENDOR_ID_IDENTITY_ENV = "INTAKE_VENDOR_ID_IDENTITY"');
    // S21 (Menu Imports after cutover) is copy + reads; bible S21.7 "Revert.".
    // Its new code reads no environment; the page's "refused" wording follows
    // the S18 flag through readCutoverDone, which the ledger row says.
    expect(none).toContain("S21");
    for (const f of [
      "src/lib/inventory/menu-imports-cutover-core.ts",
      "src/lib/pos/menu-imports-cutover.ts",
      "src/components/admin/catalog/OneTimeImportTools.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).toContain('S21: the Menu Imports page says "refused" only when this guard would refuse');
    expect(ledger).not.toContain("As of **S21**");
    // S22 (Enrichment manifest filter) is reads + a pure core; bible S22.7
    // "Revert.". Its new code reads no environment.
    expect(none).toContain("S22");
    for (const f of [
      "src/lib/enrichment/enrichment-manifest-core.ts",
      "src/lib/enrichment/enrichment-manifest.ts",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).toContain("As of **S22**");
    expect(ledger).not.toContain("As of **S19**");
    expect(ledger).not.toContain("As of **S18**");
  });
});

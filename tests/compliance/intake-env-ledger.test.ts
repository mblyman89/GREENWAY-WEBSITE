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
    for (const v of ["INTAKE_IDENTITY_STAMP", "LOOKUP_SCHEMA_V2", "ATTACH_POLICY_RING", "ATTACH_FACTS_V2", "KB_FIRST_ONBOARDING", "ONBOARDING_V2_ROW", "INTAKE_BATCH_STAGING", "INTAKE_CUTOVER_GUARD", "INTAKE_VENDOR_ID_IDENTITY"]) expect(flags).toContain(v);
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
    // S09 + S11 shipped (Round 18): no planned row names a variable any more;
    // the remaining rows (S12, S13, S20) are "named in <slice>".
    const sec = ledger.slice(ledger.indexOf("## 4. Planned flags"), ledger.indexOf("**Which shipped slice"));
    // S07 shipped (Round 17), S09 + S11 shipped (Round 18): their planned rows left section 4.
    for (const s of ["S07", "S09", "S11"]) expect(sec).not.toMatch(new RegExp(`^\\| ${s} \\|`, "m"));
    expect(sec).not.toContain("`KB_FIRST_ONBOARDING`");
    expect(sec).not.toContain("`ONBOARDING_V2_ROW`");
    for (const s of ["S12", "S13", "S20"]) expect(sec).toMatch(new RegExp(`^\\| ${s} \\| .* \\| named in ${s} \\|$`, "m"));
  });

  it("S09 + S11 (Round 18) ADDED their bible-named flags, read through the core constants", () => {
    expect(read("src/lib/catalog/fact-memory-core.ts")).toContain('export const KB_FIRST_ONBOARDING_ENV = "KB_FIRST_ONBOARDING"');
    expect(read("src/lib/catalog/fact-chips-core.ts")).toContain('export const ONBOARDING_V2_ROW_ENV = "ONBOARDING_V2_ROW"');
    expect(read("src/app/admin/inventory/drafts/page.tsx")).toContain("process.env[KB_FIRST_ONBOARDING_ENV]");
    expect(read("src/app/admin/inventory/drafts/page.tsx")).toContain("process.env[ONBOARDING_V2_ROW_ENV]");
    expect(read("src/lib/catalog/onboarding-row-flag.ts")).toContain("process.env[ONBOARDING_V2_ROW_ENV]");
    const sec1 = ledger.slice(ledger.indexOf("## 1. Shipped pipeline flags"), ledger.indexOf("## 2."));
    expect(sec1).toMatch(/^\| `KB_FIRST_ONBOARDING` \| S09 \| on \|/m);
    expect(sec1).toMatch(/^\| `ONBOARDING_V2_ROW` \| S11 \| on \|/m);
    expect(ledger).toContain('"Flag KB_FIRST_ONBOARDING=off" (S09) and "Flag ONBOARDING_V2_ROW=off renders today\'s row" (S11)');
    for (const v of ["KB_FIRST_ONBOARDING", "ONBOARDING_V2_ROW"]) expect(envExample).toContain(`# ${v}=on`);
  });

  it("section 5 explains ATTACH_POLICY_RING in plain English, matching the code", () => {
    const sec = ledger.slice(ledger.indexOf("## 5. `ATTACH_POLICY_RING` in plain English"), ledger.indexOf("## Final Vercel checklist"));
    expect(sec.length).toBeGreaterThan(2000);
    // One row per ring value, in order.
    const rows = [...sec.matchAll(/^\| `([0-3])`/gm)].map((m) => m[1]);
    expect(rows).toEqual(["0", "1", "2", "3"]);
    // The claims are the code's: default 1, junk -> 1, off-words -> 0, 2 and 3 alike, 90% bar.
    const core = read("src/lib/catalog/fact-attach-policy-core.ts");
    expect(core).toContain("export const ATTACH_POLICY_DEFAULT_RING: AttachPolicyRing = 1;");
    expect(core).toContain('if (v === "off" || v === "false" || v === "no" || v === "disabled" || v === "0") return 0;');
    expect(core).toContain("return writerShipped ? \"act\" : \"shadow\";");
    expect(core).toContain("export const ATTACH_WRITER_SHIPPED = true;");
    expect(sec).toContain("falls back to `1`");
    expect(sec).toContain("the code treats `2` and `3` alike");
    expect(sec).toContain("90%");
    expect(sec).toContain("**Nothing lands on a live record.**");
    expect(sec).toContain("set it back to `1` (or `0`)");
  });

  it("the final Vercel checklist exists, is the owner's request, and names each shipped flag", () => {
    expect(ledger).toContain("Will you add to the roadmap strategy to provide for me all of the vercel env variables");
    const final = ledger.slice(ledger.indexOf("## Final Vercel checklist"));
    expect(final.length).toBeGreaterThan(100);
    for (const v of tableNames(ledger, "## 1. Shipped pipeline flags")) expect(final).toContain(`\`${v}\``);
    expect(final).toContain("`ATTACH_POLICY_RING` = `1`");
    expect(final).toContain("`ATTACH_FACTS_V2` = `on`");
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
    // S07 (single write door, Round 17) ADDED a flag - bible S07 "Flag
    // ATTACH_FACTS_V2=off restores old actions" - and is not filed as "no variable".
    expect(none).not.toContain("S07");
    expect(added.get("S07")).toBe("ATTACH_FACTS_V2");
    expect(read("src/lib/catalog/attach-plan-core.ts")).toContain('export const ATTACH_FACTS_V2_ENV = "ATTACH_FACTS_V2"');
    expect(read("src/lib/catalog/fact-attach-policy-server.ts")).toContain("process.env[ATTACH_FACTS_V2_ENV]");
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
    expect(ledger).not.toContain("As of **S22**");
    // S24 (KB ladder writer identity) is reads + a pure core; bible S24.7
    // "Revert.". Its new code reads no environment.
    expect(none).toContain("S24");
    for (const f of [
      "src/lib/ai/kb/product-knowledge-batch-core.ts",
      "src/lib/ai/kb/product-knowledge-batch.ts",
      "src/lib/ai/kb/product-lookup.ts",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).not.toContain("As of **S24**");
    // S26 (issue fix links) is reads + a pure core; bible S26.7 "Delete the
    // new core + test; revert the optional ctx param." Its new code reads no
    // environment.
    expect(none).toContain("S26");
    expect(ledger).toContain('"Delete the new core + test; revert the optional ctx param." (S26)');
    expect(ledger).toContain("S26 needs nothing set.");
    for (const f of [
      "src/lib/pos/issue-fix-link-core.ts",
      "src/lib/pos/issue-fix-link-server.ts",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).not.toContain("As of **S26**");
    // S27 (PageTabs) is a pure core + a server component; bible S27.7
    // "Delete page-tabs-core + PageTabs; ReceivingTabs restored from git (it
    // was only wrapped)." Its new code reads no environment.
    expect(none).toContain("S27");
    expect(ledger).not.toContain("As of **S27**");
    expect(ledger).toContain('"Delete page-tabs-core + PageTabs; ReceivingTabs restored from git (it was only wrapped)." (S27)');
    expect(ledger).toContain("S27 needs nothing set.");
    for (const f of [
      "src/lib/admin/page-tabs-core.ts",
      "src/lib/admin/page-tab-sets.ts",
      "src/components/admin/ui/PageTabs.tsx",
      "src/components/admin/inventory/ReceivingTabs.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S28 (Issues tabs) is pure cores + server components; bible S28.7.
    expect(none).toContain("S28");
    expect(ledger).not.toContain("As of **S28**");
    expect(ledger).toContain(
      '"Revert the three page files + delete issues-core/IssuesList/IssuesSummaryLine; PageTabs (S27) and fix-link core (S26) stand alone." (S28)',
    );
    expect(ledger).toContain("S28 needs nothing set.");
    for (const f of [
      "src/lib/admin/issues-core.ts",
      "src/components/admin/ui/IssuesList.tsx",
      "src/components/admin/ui/IssuesSummaryLine.tsx",
      "src/components/admin/inventory/RegisterSellabilityBanner.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S29 (Accounting tab) is a pure label core + server components; bible S29.7.
    expect(none).toContain("S29");
    expect(ledger).not.toContain("As of **S29**");
    expect(ledger).toContain('"Revert page/nav files; the pure label core is additive." (S29)');
    expect(ledger).toContain("S29 needs nothing set.");
    for (const f of [
      "src/lib/inventory/manifest-event-labels-core.ts",
      "src/components/admin/inventory/ManifestAccountingPanel.tsx",
      "src/components/admin/inventory/ManifestTimeline.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S30 (receiving fact review) adds migration 0237 and no variable; its
    // bible rollback line is S30.7, word for word.
    expect(none).toContain("S30");
    expect(ledger).not.toContain("As of **S30**");
    expect(ledger).toContain(
      '"Migration is additive (nullable column + partial index): leave it; revert code." (S30, shipped as `supabase/rollbacks/0237_fact_review_for_versions.rollback.sql`)',
    );
    expect(ledger).toContain("S30 needs nothing set, only migration 0237 applied by hand.");
    for (const f of [
      "src/lib/pos/intake-fact-review-core.ts",
      "src/lib/pos/intake-fact-review-server.ts",
      "src/app/admin/inventory/drafts/IntakeFactReviewPanel.tsx",
      "src/app/admin/inventory/drafts/actions.ts",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S31 (fix-link contract) is a test + a pure core + page fixes; no
    // variable. Its bible rollback line is S31.7, word for word.
    expect(none).toContain("S31");
    expect(ledger).not.toContain("As of **S31**");
    expect(ledger).toContain('"Delete the test + doc section." (S31)');
    expect(ledger).toContain("S31 needs nothing set.");
    for (const f of ["src/lib/admin/fix-link-contract-core.ts", "tests/compliance/pipeline-fix-links-connected.test.ts"]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    // S33 (shipped as S33-NC, D-R3-1) adds a permission + a guarded update;
    // no variable, no schema. Its bible rollback line is S33.7, word for word.
    expect(none).toContain("S33");
    expect(ledger).not.toContain("As of **S33**");
    expect(ledger).toContain('"Revert code. No schema. Keyed costs remain valid, provenance-stamped facts." (S33');
    expect(ledger).toContain("S33 needs nothing set.");
    // S32 (match review) adds migration 0239 + a page/actions; no variable.
    // Its bible rollback line is S32.7, word for word.
    expect(none).toContain("S32");
    expect(ledger).toContain("As of **S32**");
    expect(ledger).toContain(
      '"Revert code; the table can stay (unused). Or drop the table \u2014 the planner treats a missing table as \'no decisions\'." (S32',
    );
    expect(ledger).toContain("S32 needs nothing set, only migration 0239 applied by hand.");
    for (const f of [
      "src/lib/pos/merge-review-core.ts",
      "src/lib/pos/merge-review-server.ts",
      "src/lib/pos/merge-decision-store.ts",
      "src/app/admin/inventory/intake/[id]/match/page.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    for (const f of [
      "src/lib/noncannabis/cost-fill-core.ts",
      "src/app/admin/inventory/noncannabis/actions.ts",
      "src/app/admin/inventory/noncannabis/MerchCatalog.tsx",
    ]) {
      expect(read(f)).not.toMatch(/process\.env/);
    }
    expect(ledger).not.toContain("As of **S19**");
    expect(ledger).not.toContain("As of **S18**");
  });
});

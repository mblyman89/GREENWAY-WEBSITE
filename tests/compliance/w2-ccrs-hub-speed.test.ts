/**
 * W-2 (2026-10-30): the CCRS hub shell renders at once; the heavy panels
 * (week build, scoreboard, files list, clean-up scan, medical scan) stream in
 * behind <Suspense> from settled promises, so one failed read never blanks
 * the page, and the Production page reads half the scoreboard queries.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCcrsHubViewTests,
  medicalSaleRowCount,
  pickSelectedWeek,
  recordGate,
  settle,
  waitingFilesOfEnv,
} from "@/lib/compliance/ccrs-hub-view-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");
const STORE = read("src/lib/compliance/ccrs-scoreboard-store.ts");

/** The page function body up to its JSX `return (` (the part that blocks the first byte). */
function preamble(): string {
  const start = PAGE.indexOf("export default async function CcrsCommandCenterPage");
  const ret = PAGE.indexOf("\n  return (\n", start);
  return PAGE.slice(start, ret);
}

describe("W-2 pure core", () => {
  it("self-tests pass", () => {
    expect(__runCcrsHubViewTests()).toEqual({ passed: 17, failed: 0 });
  });
  it("settle never rejects (sync throw, async reject, resolve)", async () => {
    await expect(settle(() => { throw new Error("sync"); })).resolves.toEqual({ ok: false, error: "sync" });
    await expect(settle(Promise.reject(new Error("async")))).resolves.toEqual({ ok: false, error: "async" });
    await expect(settle(Promise.resolve(7))).resolves.toEqual({ ok: true, value: 7 });
  });
  it("selected week, waiting files, medical rows, record gate", () => {
    const w = (k: string) => ({ week: { key: k } });
    expect(pickSelectedWeek({ current: w("c"), weeks: [w("a")], mostUrgent: null }, "a").week.key).toBe("a");
    expect(waitingFilesOfEnv([{ env: "prod", state: "uploaded" }], "preprod")).toEqual([]);
    expect(medicalSaleRowCount([{ type: "Sale", csv: "RecreationalMedical" }])).toBe(1);
    expect(recordGate({ built: false, submittable: true, totalRecords: 0, nothingToReport: true }).nothing).toBe(false);
  });
});

describe("W-2 page: the shell never waits for the heavy reads", () => {
  const pre = preamble();
  it("no heavy read is awaited before the JSX", () => {
    expect(pre).not.toMatch(/await\s+buildCcrsBatch/);
    expect(pre).not.toMatch(/await\s+Promise\.all\(\[batchP/);
    expect(pre).not.toMatch(/await\s+readCcrsScoreboard/);
    expect(pre).not.toMatch(/await\s+listCcrsFiles\(/);
    expect(pre).not.toMatch(/await\s+readOwed/);
    expect(pre).not.toMatch(/await\s+medicalP/);
    // the one awaited wave holds only the small reads
    const wave = pre.slice(pre.indexOf("= await Promise.all(["), pre.indexOf("const handoverPlan"));
    for (const heavy of ["buildCcrsBatch", "readCcrsScoreboard", "listCcrsFiles(", "readOwed", "loadMigrationGarbage"]) {
      expect(wave, heavy).not.toContain(heavy);
    }
  });
  it("the batch is built once per render and settled", () => {
    expect(PAGE.match(/buildCcrsBatch\(/g)?.length).toBe(1);
    expect(PAGE).toMatch(/const weekP: Promise<WeekView> = settle\(\(\) =>/);
    expect(PAGE).toContain("buildCcrsBatch(range.fromISO, range.toISO, { env })");
  });
  it("every heavy panel streams inside its own Suspense", () => {
    for (const p of ["scoreboardP", "Promise.all([weekP, owedP])", "Promise.all([weekP, filesP])", "migrationGarbageP", "medicalViewP"]) {
      expect(PAGE, p).toMatch(new RegExp(`<Suspense fallback=\\{[^\\n]*\\}>\\s*<Await p=\\{${p.replace(/[()[\]]/g, "\\$&")}\\}>`));
    }
    const suspenses = PAGE.match(/<Suspense /g)?.length ?? 0;
    expect(suspenses).toBeGreaterThanOrEqual(8);
  });
  it("the email panel and the warning use the light waiting-files read, not the heavy list", () => {
    expect(PAGE).toContain('listCcrsFilesLite(admin0, ["prod", "preprod"], WAITING_STATES, CCRS_UPLOAD_ORDER, 200)');
    expect(PAGE).toContain("uploadedFiles={waitingAll.filter((f) => isUnansweredState(f.state))}");
    expect(PAGE).toContain("unansweredWarningLines(waitingHere)");
    expect(PAGE).not.toContain("unansweredWarningLines(ccrsFiles.files)");
  });
  it("Step 3 cannot record a week whose files failed to build", () => {
    expect(PAGE).toContain("const gate = recordGate({ built: !!batch, submittable, totalRecords, nothingToReport });");
    expect(PAGE).toContain("disabled={!gate.submitted}");
    expect(PAGE).toContain("disabled={!gate.nothing}");
  });
  it("a failed build is shown in place", () => {
    expect(PAGE).toMatch(/wv\.buildError \? <PanelFailed/);
  });
});

describe("W-2 scoreboard: Production reads half", () => {
  it("acceptedOnly skips the waiting/refused read", () => {
    expect(STORE).toContain("opts.acceptedOnly ? Promise.resolve([] as ScoreRow[]) : readOne(admin, env, t, false)");
    expect(PAGE).toContain('readCcrsScoreboard(admin0, "preprod", { acceptedOnly: env !== "preprod" })');
  });
});

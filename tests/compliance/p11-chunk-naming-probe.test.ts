/**
 * Guards scripts/compliance/generate-p11-chunk-naming-probe.ts (PREprod probe
 * P-11, Bible v2 Part 06 §A.4, U-36). The probe must upload EXACTLY the names
 * production's chunk planner emits, or its answer proves nothing.
 *
 * Expected file names are written out by hand (oracle independent of the
 * code): 2026-10-15T17:00:00Z is 10:00:00 AM PDT, and the stamp is the Pacific
 * wall clock [G L0046].
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CCRS_COLUMNS, ccrsReaderSplit, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { buildP11, p11Manifest, RUN_RE } from "../../scripts/compliance/generate-p11-chunk-naming-probe";

const RUN = "P20261015B";
const START = new Date("2026-10-15T17:00:00.400Z");
const files = buildP11(RUN, "413541", START);
const rowsOf = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(ccrsReaderSplit);
const col = (name: string) => CCRS_COLUMNS.Inventory.indexOf(name);

describe("P-11 chunk naming probe files", () => {
  it("exact names, in upload order (hand-computed oracle)", () => {
    expect(files.map((f) => f.fileName)).toEqual([
      "Strain_413541_20261015100000.csv",
      "Area_413541_20261015100001.csv",
      "Product_413541_20261015100002.csv",
      "Inventory_413541_20261015100003.csv",
      "Inventory_413541_20261015100004.csv",
      "Inventory_413541_20261015100005_1.csv",
      "Inventory_413541_20261015100006.csv",
    ]);
    expect(files.map((f) => f.step)).toEqual(["1", "1", "1", "2", "2", "2", "3"]);
    expect(files.map((f) => f.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("the two chunk files differ ONLY by one second and carry one lot each", () => {
    const [c1, c2] = [files[3], files[4]];
    expect(c1.folder).toBe("04-Inventory-chunk-1-of-2");
    expect(c2.folder).toBe("05-Inventory-chunk-2-of-2");
    expect(rowsOf(c1.csv).map((r) => r[col("ExternalIdentifier")])).toEqual([`${RUN}-L01`]);
    expect(rowsOf(c2.csv).map((r) => r[col("ExternalIdentifier")])).toEqual([`${RUN}-L02`]);
    expect(c1.fileName.replace("100003", "X")).toBe(c2.fileName.replace("100004", "X"));
  });
  it("the Update file names the lots of BOTH chunks (the proof both were stored)", () => {
    const u = files[6];
    const rows = rowsOf(u.csv);
    expect(rows.map((r) => r[col("ExternalIdentifier")])).toEqual([`${RUN}-L01`, `${RUN}-L02`]);
    expect(rows.every((r) => r[col("Operation")] === "Update")).toBe(true);
    expect(u.why).toContain("[FAQ L0053]");
  });
  it("every file passes our verifier, NumberRecords is right, CRLF, no BOM, no row shift", () => {
    for (const f of files) {
      expect(verifyCcrsFile(f.type, f.csv).filter((p) => p.severity === "error")).toEqual([]);
      expect(f.csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(f.csv.endsWith("\r\n")).toBe(true);
      expect(f.csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const rows = rowsOf(f.csv);
      expect(f.csv.split("\r\n")[2]).toBe(`NumberRecords,${rows.length}`);
      for (const r of rows) expect(r.length).toBe(CCRS_COLUMNS[f.type].length);
    }
  });
  it("every id and name carries the run prefix (never collides with production or other runs)", () => {
    const inv = files.filter((f) => f.type === "Inventory").flatMap((f) => rowsOf(f.csv));
    for (const r of inv) {
      for (const c of ["Strain", "Area", "Product", "ExternalIdentifier"]) expect(r[col(c)].startsWith(RUN)).toBe(true);
    }
    expect(rowsOf(files[2].csv)[0].join("|")).toContain(`${RUN}-P-1`);
  });
  it("refuses a bad run id", () => {
    expect(() => buildP11("P2026101A", "413541", START)).toThrow(/--run/);
    expect(RUN_RE.test("P20261015B")).toBe(true);
  });
  it("manifest: PREprod only, wait 10 min, the STOP rule, every file listed", () => {
    const m = p11Manifest(RUN, "413541", files);
    expect(m).toContain("**PREPRODUCTION ONLY**");
    expect(m).toContain("**Wait at least 10 minutes** [G L0530]");
    expect(m).toContain("STOP: do not upload any multi-chunk production file");
    for (const f of files) expect(m).toContain(`\`${f.fileName}\``);
  });
  it("CLI writes 7 files + MANIFEST and refuses to overwrite a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "p11-"));
    const out = join(dir, "out");
    try {
      const r = spawnSync("npx", ["tsx", "scripts/compliance/generate-p11-chunk-naming-probe.ts", "--run", RUN, "--out", out], { encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(existsSync(join(out, "MANIFEST.md"))).toBe(true);
      const folders = readdirSync(out).filter((x) => x !== "MANIFEST.md").sort();
      expect(folders.length).toBe(7);
      const f4 = readdirSync(join(out, folders[3]))[0];
      expect(readFileSync(join(out, folders[3], f4), "utf8").startsWith("SubmittedBy,")).toBe(true);
      const again = spawnSync("npx", ["tsx", "scripts/compliance/generate-p11-chunk-naming-probe.ts", "--run", RUN, "--out", out], { encoding: "utf8" });
      expect(again.status).toBe(2);
      const noRun = spawnSync("npx", ["tsx", "scripts/compliance/generate-p11-chunk-naming-probe.ts"], { encoding: "utf8" });
      expect(noRun.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

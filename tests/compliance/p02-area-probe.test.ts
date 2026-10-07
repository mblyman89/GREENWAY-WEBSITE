/**
 * Guards scripts/compliance/generate-p02-area-probe.ts (PREprod probe P-02,
 * U-31). The question file must be the PRODUCTION planner's own output, or the
 * answer proves nothing about production. Names are a hand-computed oracle:
 * 2026-10-09T17:00:00Z is 10:00:00 AM PDT; the stamp is the Pacific wall clock.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CCRS_COLUMNS, ccrsReaderSplit, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { buildP02, p02Manifest, RUN_RE } from "../../scripts/compliance/generate-p02-area-probe";

const RUN = "P20261009B";
const START = new Date("2026-10-09T17:00:00.300Z");
const files = buildP02(RUN, "413541", START);
const rowsOf = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(ccrsReaderSplit);
const A = (c: string) => CCRS_COLUMNS.Area.indexOf(c);
const I = (c: string) => CCRS_COLUMNS.Inventory.indexOf(c);

describe("P-02 Area probe files", () => {
  it("exact names and types, in upload order, one second apart", () => {
    expect(files.map((f) => f.fileName)).toEqual([
      "Strain_413541_20261009100000.csv",
      "Area_413541_20261009100001.csv",
      "Area_413541_20261009100002.csv",
      "Product_413541_20261009100003.csv",
      "Inventory_413541_20261009100004.csv",
      "Area_413541_20261009100005.csv",
      "Inventory_413541_20261009100006.csv",
      "Inventory_413541_20261009100007.csv",
      "Area_413541_20261009100008.csv",
      "Inventory_413541_20261009100009.csv",
    ]);
    expect(files.map((f) => f.step)).toEqual(["1", "1", "1", "1", "2", "3", "4", "4", "5", "6"]);
    expect(files.map((f) => f.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(files[5].folder).toBe("06-Area-Delete-Delete-Update");
  });
  it("two records share the name; the RETIRED one is ingested last (the hard case)", () => {
    const keep = rowsOf(files[1].csv);
    const retire = rowsOf(files[2].csv);
    expect(keep.map((r) => [r[A("Area")], r[A("ExternalIdentifier")], r[A("Operation")]])).toEqual([
      [`${RUN} Sales Floor`, `${RUN}-AREA-K`, "Insert"],
      [`${RUN} Probe Room`, `${RUN}-AREA-Z`, "Insert"],
    ]);
    expect(retire.map((r) => [r[A("Area")], r[A("ExternalIdentifier")]])).toEqual([[`${RUN} Sales Floor`, `${RUN}-AREA-R`]]);
  });
  it("the question file is Delete R, Delete Z, Update K — all FALSE, filed names, Updated* set", () => {
    const rows = rowsOf(files[5].csv);
    expect(rows.map((r) => `${r[A("Operation")]} ${r[A("ExternalIdentifier")]} ${r[A("Area")]}`)).toEqual([
      `Delete ${RUN}-AREA-R ${RUN} Sales Floor`,
      `Delete ${RUN}-AREA-Z ${RUN} Probe Room`,
      `Update ${RUN}-AREA-K ${RUN} Sales Floor`,
    ]);
    for (const r of rows) {
      expect(r[A("IsQuarantine")]).toBe("FALSE");
      expect(r[A("UpdatedBy")]).toBe("Greenway Marijuana");
      expect(r[A("UpdatedDate")]).toBe("10/09/2026");
    }
  });
  it("the Inventory files ask one question each", () => {
    const at = (i: number) => rowsOf(files[i].csv).map((r) => `${r[I("Operation")]} ${r[I("ExternalIdentifier")]} ${r[I("Area")]}`);
    expect(at(4)).toEqual([`Insert ${RUN}-L01 ${RUN} Sales Floor`, `Insert ${RUN}-L02 ${RUN} Probe Room`]);
    expect(at(6)).toEqual([`Update ${RUN}-L01 ${RUN} Sales Floor`]);
    expect(at(7)).toEqual([`Insert ${RUN}-L03 ${RUN} Probe Room`]);
    expect(files[7].expect).toBe("Error: Invalid Area");
    expect(rowsOf(files[8].csv).map((r) => `${r[A("Operation")]} ${r[A("ExternalIdentifier")]} ${r[A("Area")]}`)).toEqual([`Insert ${RUN}-AREA-Y ${RUN} Probe Room`]);
    expect(at(9)).toEqual([`Update ${RUN}-L02 ${RUN} Probe Room`]);
  });
  it("every file passes our verifier, NumberRecords is right, CRLF, no BOM, no row shift, IsMedical FALSE", () => {
    for (const f of files) {
      expect(verifyCcrsFile(f.type, f.csv).filter((p) => p.severity === "error")).toEqual([]);
      expect(f.csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(f.csv.endsWith("\r\n")).toBe(true);
      expect(f.csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      const rows = rowsOf(f.csv);
      expect(f.csv.split("\r\n")[2]).toBe(`NumberRecords,${rows.length}`);
      for (const r of rows) expect(r.length).toBe(CCRS_COLUMNS[f.type].length);
      if (f.type === "Inventory") for (const r of rows) expect(r[I("IsMedical")]).toBe("FALSE");
    }
  });
  it("every id and every name carries the run prefix", () => {
    for (const f of files) {
      for (const r of rowsOf(f.csv)) {
        const cells = f.type === "Strain" ? [r[1]] : f.type === "Area" ? [r[A("Area")], r[A("ExternalIdentifier")]] : f.type === "Product" ? [r[3], r[6]] : [r[I("Strain")], r[I("Area")], r[I("Product")], r[I("ExternalIdentifier")]];
        for (const c of cells) expect(c.startsWith(RUN)).toBe(true);
      }
    }
  });
  it("refuses a bad run id", () => {
    expect(() => buildP02("P2026109B", "413541", START)).toThrow(/--run/);
    expect(RUN_RE.test(RUN)).toBe(true);
  });
  it("manifest: PREprod only, 10-minute waits, every outcome A–E, every file listed", () => {
    const m = p02Manifest(RUN, "413541", files);
    expect(m).toContain("**PREPRODUCTION ONLY**");
    expect(m.match(/\*\*Wait 10 minutes\.\*\*/g)?.length).toBe(3);
    for (const k of ["**A.", "**B.", "**C.", "**D.", "**E."]) expect(m).toContain(k);
    expect(m).toContain("**Never Delete in production.**");
    for (const f of files) expect(m).toContain(`\`${f.fileName}\``);
  });
  it("CLI writes 10 files + MANIFEST and refuses to overwrite a run or run without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "p02-"));
    const out = join(dir, "out");
    try {
      const r = spawnSync("npx", ["tsx", "scripts/compliance/generate-p02-area-probe.ts", "--run", RUN, "--out", out], { encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(existsSync(join(out, "MANIFEST.md"))).toBe(true);
      const folders = readdirSync(out).filter((x) => x !== "MANIFEST.md").sort();
      expect(folders.length).toBe(10);
      const f6 = readdirSync(join(out, folders[5]))[0];
      expect(readFileSync(join(out, folders[5], f6), "utf8")).toContain(",Delete\r\n");
      expect(spawnSync("npx", ["tsx", "scripts/compliance/generate-p02-area-probe.ts", "--run", RUN, "--out", out], { encoding: "utf8" }).status).toBe(2);
      expect(spawnSync("npx", ["tsx", "scripts/compliance/generate-p02-area-probe.ts"], { encoding: "utf8" }).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

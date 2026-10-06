/**
 * Guards scripts/compliance/generate-p04-fidelity-probe.ts (PREprod probe P-04,
 * Bible v2 Part 06 §A.4). These files go to a government system: a malformed
 * probe teaches the wrong lesson, so every property is asserted on the bytes.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CCRS_COLUMNS, splitCsvLine, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { buildP04, P04_CASES, p04Manifest, RUN_RE } from "../../scripts/compliance/generate-p04-fidelity-probe";

const RUN = "P20261015A";
const START = new Date("2026-10-15T17:00:00Z"); // 10:00 AM PDT
const files = buildP04(RUN, "413541", START);
const rowsOf = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(splitCsvLine);
const col = (type: keyof typeof CCRS_COLUMNS, name: string) => CCRS_COLUMNS[type].indexOf(name);

describe("P-04 probe files", () => {
  it("has the planned shape: Strain, Area, Product, 8 Inventory Inserts, 1 Inventory Update", () => {
    expect(P04_CASES.length).toBe(8);
    expect(files.map((f) => f.type)).toEqual(["Strain", "Area", "Product", ...Array(8).fill("Inventory"), "Inventory"]);
    expect(files.map((f) => f.step)).toEqual(["1", "1", "1", ...Array(8).fill("2"), "3"]);
  });

  it("every file passes our own verifier, is CRLF, has no BOM, and has a unique Pacific-stamped name", () => {
    for (const f of files) {
      expect(verifyCcrsFile(f.type, f.csv).filter((p) => p.severity === "error")).toEqual([]);
      expect(f.csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(/(^|[^\r])\n/.test(f.csv)).toBe(false);
      expect(f.fileName).toMatch(new RegExp(`^${f.type}_413541_202610151000\\d\\d\\.csv$`));
    }
    expect(new Set(files.map((f) => f.fileName)).size).toBe(files.length);
  });

  it("each case's exact name survives encode → parse in Product, its Insert, and the Update", () => {
    const product = rowsOf(files[2].csv);
    const update = rowsOf(files[11].csv);
    P04_CASES.forEach((c, i) => {
      const name = c.name(RUN);
      expect(product[i][col("Product", "Name")]).toBe(name);
      expect(rowsOf(files[3 + i].csv)).toHaveLength(1);
      expect(rowsOf(files[3 + i].csv)[0][col("Inventory", "Product")]).toBe(name);
      expect(update[i][col("Inventory", "Product")]).toBe(name);
    });
  });

  it("the cases really contain the character class they claim", () => {
    const n = Object.fromEntries(P04_CASES.map((c) => [c.code, c.name(RUN)]));
    expect(n.C1.startsWith('"') && n.C1.endsWith('"')).toBe(true);
    expect(n.C2.slice(1, -1)).toContain('"');
    expect(n.C3).toContain("\t");
    expect(n.C4).toMatch(/[ñè]/);
    expect(n.C5).toContain("Ã©");
    expect(n.C6).toContain("  ");
    expect(n.C7).toContain(",");
    expect(n.C8.endsWith(" ")).toBe(true);
    // ...and the encoder emits them in RFC 4180 form on the wire.
    expect(files[2].csv).toContain(`"""${RUN} Mama J's Fidelity - 3.5g"""`);
    expect(files[2].csv).toContain(`"${RUN} Smith, Jane Fidelity - 1g"`);
    expect(files[2].csv).toContain(`"${RUN} Trailing Space Fidelity "`);
  });

  it("every id and every created name carries the run prefix (no collision with 2026-09-17)", () => {
    for (const f of files) {
      for (const r of rowsOf(f.csv)) {
        const ext = col(f.type, "ExternalIdentifier");
        if (ext >= 0) expect(r[ext].startsWith(`${RUN}-`)).toBe(true);
        for (const nameCol of ["Strain", "Area", "Name", "Product"]) {
          const i = col(f.type, nameCol);
          if (i >= 0) expect(r[i]).toContain(RUN);
        }
      }
    }
  });

  it("Update rows keep ids/names, change only QoH, and carry UpdatedBy/UpdatedDate", () => {
    const ins = files.slice(3, 11).map((f) => rowsOf(f.csv)[0]);
    const upd = rowsOf(files[11].csv);
    upd.forEach((u, i) => {
      expect(u[col("Inventory", "Operation")]).toBe("Update");
      expect(u[col("Inventory", "ExternalIdentifier")]).toBe(ins[i][col("Inventory", "ExternalIdentifier")]);
      expect(u[col("Inventory", "QuantityOnHand")]).toBe("9");
      expect(u[col("Inventory", "UpdatedBy")]).not.toBe("");
      expect(u[col("Inventory", "UpdatedDate")]).toBe("10/15/2026");
    });
  });

  it("refuses a malformed run id; the manifest lists every file and the expected email", () => {
    expect(RUN_RE.test("P20261015A")).toBe(true);
    for (const bad of ["", "20261015A", "P2026101A", "P20261015", "P20261015a", "X20261015A"]) {
      expect(() => buildP04(bad, "413541", START)).toThrow(/--run/);
    }
    const m = p04Manifest(RUN, "413541", files);
    for (const f of files) expect(m).toContain(f.fileName);
    expect(m).toContain("PRE: CCRS Processing Successful");
    expect(m).toContain("PREPRODUCTION ONLY");
    expect(m).toContain("[G L0530]");
  });

  it("CLI refuses without --run and refuses to overwrite; with --run it writes 12 files + MANIFEST", () => {
    const dir = mkdtempSync(join(tmpdir(), "p04-"));
    const script = join(__dirname, "..", "..", "scripts", "compliance", "generate-p04-fidelity-probe.ts");
    const tsx = join(__dirname, "..", "..", "node_modules", ".bin", "tsx");
    try {
      const noRun = spawnSync(tsx, [script], { encoding: "utf8" });
      expect(noRun.status).toBe(2);
      expect(noRun.stderr).toContain("Refusing to run: pass --run");
      const out = join(dir, "run");
      execFileSync(tsx, [script, "--run", RUN, "--out", out], { stdio: "pipe" });
      const folders = readdirSync(out).filter((d) => d !== "MANIFEST.md");
      expect(folders).toHaveLength(12);
      for (const d of folders) {
        const [csvName] = readdirSync(join(out, d));
        const bytes = readFileSync(join(out, d, csvName));
        expect(bytes[0]).not.toBe(0xef); // no UTF-8 BOM
      }
      const again = spawnSync(tsx, [script, "--run", RUN, "--out", out], { encoding: "utf8" });
      expect(again.status).toBe(2);
      expect(again.stderr).toContain("Refusing to overwrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

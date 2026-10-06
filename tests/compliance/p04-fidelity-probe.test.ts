/**
 * Guards scripts/compliance/generate-p04-fidelity-probe.ts (PREprod probe
 * P-04b, Bible v2 Part 06 §A.4, re-designed after run P20261005A proved CCRS
 * splits every row on every comma). These files go to a government system: a
 * malformed probe teaches the wrong lesson, so every property is asserted on
 * the bytes, split the way CCRS splits them.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CCRS_COLUMNS, ccrsReaderSplit, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { buildP04, P04_CASES, p04Manifest, RUN_RE } from "../../scripts/compliance/generate-p04-fidelity-probe";

const RUN = "P20261015A";
const START = new Date("2026-10-15T17:00:00Z"); // 10:00 AM PDT
const files = buildP04(RUN, "413541", START);
const N = P04_CASES.length;
const rowsOf = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n").slice(4).map(ccrsReaderSplit);
const col = (type: keyof typeof CCRS_COLUMNS, name: string) => CCRS_COLUMNS[type].indexOf(name);
const products = files.filter((f) => f.type === "Product");
const inserts = files.filter((f) => f.type === "Inventory" && f.step === "2");
const update = files[files.length - 1];
const plain = P04_CASES.filter((c) => !c.rawQuote);

describe("P-04b probe files", () => {
  it("has the planned shape: Strain, Area, one Product per case, one Inventory Insert per case, one Update", () => {
    expect(N).toBe(8);
    expect(P04_CASES.map((c) => c.code)).toEqual(["C3", "C4", "C5", "C6", "C8", "C9", "Q1", "Q2"]);
    expect(files.map((f) => f.type)).toEqual(["Strain", "Area", ...Array(N).fill("Product"), ...Array(N).fill("Inventory"), "Inventory"]);
    expect(files.map((f) => f.step)).toEqual(["1", "1", ...Array(N).fill("1"), ...Array(N).fill("2"), "3"]);
    expect(products.map((f) => f.cases)).toEqual(P04_CASES.map((c) => [c.code]));
    expect(inserts.map((f) => f.cases)).toEqual(P04_CASES.map((c) => [c.code]));
    expect(update.cases).toEqual(plain.map((c) => c.code));
    expect(files.map((f) => f.folder)).toEqual([
      "01-Strain", "02-Area",
      ...P04_CASES.map((c, i) => `${String(3 + i).padStart(2, "0")}-Product-${c.code}`),
      ...P04_CASES.map((c, i) => `${String(3 + N + i).padStart(2, "0")}-Inventory-${c.code}`),
      `${3 + 2 * N}-Inventory-Update-plain`,
    ]);
  });

  it("NO value in any file contains a comma — every row splits into exactly the template's columns", () => {
    for (const f of files) {
      for (const r of rowsOf(f.csv)) expect(r.length).toBe(CCRS_COLUMNS[f.type].length);
    }
  });

  it("every plain file passes our own verifier; the Q files fail ONLY the double-quote rule", () => {
    for (const f of files) {
      const errs = verifyCcrsFile(f.type, f.csv).filter((p) => p.severity === "error");
      const q = f.cases.length === 1 && P04_CASES.find((c) => c.code === f.cases[0])?.rawQuote;
      if (q) {
        expect(errs.length).toBe(1);
        expect(errs[0].message).toMatch(/double quote/);
      } else {
        expect(errs).toEqual([]);
      }
    }
  });

  it("only the four Q files contain a double quote, and each holds exactly the bare characters of its name", () => {
    const withQuote = files.filter((f) => f.csv.includes('"')).map((f) => f.folder);
    expect(withQuote).toEqual([
      `${String(3 + 6).padStart(2, "0")}-Product-Q1`, `${String(3 + 7).padStart(2, "0")}-Product-Q2`,
      `${String(3 + N + 6).padStart(2, "0")}-Inventory-Q1`, `${String(3 + N + 7).padStart(2, "0")}-Inventory-Q2`,
    ]);
    expect(files.some((f) => f.csv.includes("P04RAWQUOTETOKEN"))).toBe(false);
    expect(products[6].csv).toContain(`,${RUN} 7" Cone Fidelity - 1g,`);
    expect(products[7].csv).toContain(`,"${RUN} Mama J's Quoted - 3.5g",`);
    expect(products[7].csv).not.toContain('""');
  });

  it("is CRLF, has no BOM, and has unique Pacific-stamped names", () => {
    for (const f of files) {
      expect(f.csv.charCodeAt(0)).not.toBe(0xfeff);
      expect(/(^|[^\r])\n/.test(f.csv)).toBe(false);
      expect(f.fileName).toMatch(new RegExp(`^${f.type}_413541_202610151000\\d\\d\\.csv$`));
    }
    expect(new Set(files.map((f) => f.fileName)).size).toBe(files.length);
  });

  it("each case's exact name is in its Product file, its Insert file, and (plain cases) the Update — split as CCRS splits", () => {
    const upd = rowsOf(update.csv);
    P04_CASES.forEach((c, i) => {
      const name = c.name(RUN);
      expect(rowsOf(products[i].csv)).toHaveLength(1);
      expect(rowsOf(products[i].csv)[0][col("Product", "Name")]).toBe(name);
      expect(rowsOf(inserts[i].csv)).toHaveLength(1);
      expect(rowsOf(inserts[i].csv)[0][col("Inventory", "Product")]).toBe(name);
    });
    plain.forEach((c, i) => expect(upd[i][col("Inventory", "Product")]).toBe(c.name(RUN)));
  });

  it("the cases really contain the character class they claim", () => {
    const n = Object.fromEntries(P04_CASES.map((c) => [c.code, c.name(RUN)]));
    expect(n.C3).toContain("\t");
    expect(n.C4).toMatch(/[ñè]/);
    expect(n.C5).toContain("Ã©");
    expect(n.C6).toContain("  ");
    expect(n.C8.endsWith(" ")).toBe(true);
    expect(n.C9).toContain("'");
    expect(n.Q1.slice(1, -1)).toContain('"');
    expect(n.Q2.startsWith('"') && n.Q2.endsWith('"')).toBe(true);
    // the trailing space is sent bare — no quote wrapping any more
    expect(products[4].csv).toContain(`,${RUN} Trailing Space Fidelity ,`);
    for (const c of P04_CASES) expect(c.rawQuote === true).toBe(c.name(RUN).includes('"'));
  });

  it("every id and every created name carries the run prefix (no collision with earlier runs)", () => {
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
    const upd = rowsOf(update.csv);
    expect(upd).toHaveLength(plain.length);
    plain.forEach((c, i) => {
      const ins = rowsOf(inserts[P04_CASES.indexOf(c)].csv)[0];
      const u = upd[i];
      expect(u[col("Inventory", "Operation")]).toBe("Update");
      expect(u[col("Inventory", "ExternalIdentifier")]).toBe(ins[col("Inventory", "ExternalIdentifier")]);
      expect(u[col("Inventory", "QuantityOnHand")]).toBe("9");
      expect(u[col("Inventory", "UpdatedBy")]).not.toBe("");
      expect(u[col("Inventory", "UpdatedDate")]).toBe("10/15/2026");
    });
  });

  it("refuses a malformed run id; the manifest lists every file, the expected email and the reason for the rerun", () => {
    expect(RUN_RE.test("P20261015A")).toBe(true);
    for (const bad of ["", "20261015A", "P2026101A", "P20261015", "P20261015a", "X20261015A"]) {
      expect(() => buildP04(bad, "413541", START)).toThrow(/--run/);
    }
    const m = p04Manifest(RUN, "413541", files);
    for (const f of files) expect(m).toContain(f.fileName);
    expect(m).toContain("PRE: CCRS Processing Successful");
    expect(m).toContain("PREPRODUCTION ONLY");
    expect(m).toContain("[G L0530]");
    expect(m).toContain("P20261005A");
    expect(m).toContain("U-44");
    expect(m).toContain(`files 1–${2 + N}`);
    expect(m).toContain(`(${3 + N}–${2 + 2 * N})`);
  });

  it(`CLI refuses without --run and refuses to overwrite; with --run it writes ${3 + 2 * N} files + MANIFEST`, () => {
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
      expect(folders).toHaveLength(3 + 2 * N);
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

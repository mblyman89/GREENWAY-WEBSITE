/**
 * tests/compliance/ccrs-preprod-generator.test.ts — CCRS bible slice S-02
 *
 * Guards scripts/compliance/generate-preprod-test-files.ts, which produces the
 * PREproduction test files for docs/ccrs-bible/06-preproduction-test-plan.md.
 *
 * WHY THIS IS TESTED AT ALL
 * These files get uploaded to a GOVERNMENT system by the owner. If the
 * generator silently emits a malformed file, the owner spends a week chasing an
 * error that came from our test harness rather than from the real batch
 * builder — the single most expensive kind of wasted trip. Worse, an
 * "EXPECT-ERROR" file that is accidentally VALID would teach us the wrong
 * lesson: we would record "CCRS accepts this" when we never actually tested it.
 *
 * The generator writes files to disk, so this test runs it in a temp dir and
 * inspects the result — the same way the owner will run it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyCcrsFile,
  CCRS_COLUMNS,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";

let OUT = "";

/**
 * One generated test case. The generator puts each test in its own folder so
 * the CSV inside can keep the EXACT name CCRS requires [G L0046] -- the owner
 * must be able to upload it without renaming anything.
 */
type Generated = {
  /** e.g. "T-14-EXPECT-ERROR" (the folder name) */
  id: string;
  /** e.g. "Strain_413541_20250615213000.csv" (the CCRS-legal file name) */
  name: string;
  /** absolute path on disk */
  path: string;
};

let FILES: Generated[] = [];

/** Map a generated file name back to its CCRS file type. */
function typeOf(g: Generated): CcrsRetailerFileType {
  const raw = g.name.split("_")[0];
  // T-12 deliberately lower-cases the prefix to probe U-02.
  const canon = (Object.keys(CCRS_COLUMNS) as CcrsRetailerFileType[]).find(
    (t) => t.toLowerCase() === raw.toLowerCase(),
  );
  if (!canon) throw new Error(`cannot map "${g.name}" to a CCRS type`);
  return canon;
}

const read = (g: Generated) => readFileSync(g.path, "utf8");
const byId = (prefix: string) => FILES.find((f) => f.id.startsWith(prefix));

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "ccrs-preprod-"));
  execFileSync(
    "npx",
    ["tsx", "scripts/compliance/generate-preprod-test-files.ts", "413541", OUT],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
  // Walk one level of folders: <OUT>/<test id>/<ccrs file name>.csv
  FILES = [];
  for (const dir of readdirSync(OUT)) {
    const dirPath = join(OUT, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    for (const name of readdirSync(dirPath)) {
      if (!name.endsWith(".csv")) continue;
      FILES.push({ id: dir, name, path: join(dirPath, name) });
    }
  }
}, 150_000);

afterAll(() => {
  if (OUT) rmSync(OUT, { recursive: true, force: true });
});

describe("the PREproduction generator produces uploadable files", () => {
  it("writes a manifest and a meaningful number of test files", () => {
    expect(readdirSync(OUT)).toContain("MANIFEST.md");
    expect(FILES.length).toBeGreaterThanOrEqual(20);
  });

  it("every file name matches the CCRS convention <Type>_<license>_<14-digit stamp>.csv", () => {
    for (const f of FILES) {
      expect(f.name, f.id).toMatch(/^[A-Za-z]+_413541_\d{14}\.csv$/);
    }
  });

  it("no file needs renaming before upload: the test id is the FOLDER, never the file name", () => {
    // CCRS parses the file name. If we prefixed the test id onto the CSV
    // ("T-10__Strain_...csv") every probe could be rejected for a reason we
    // invented, and the run would teach us nothing about the actual rules.
    for (const f of FILES) {
      expect(f.name, `${f.id}: test id leaked into the file name`).not.toContain(f.id);
      expect(f.name).not.toContain("__");
      expect(f.name).not.toContain("EXPECT-ERROR");
    }
  });

  it("T-10 and T-11 share one file name yet do not collide, because each has its own folder", () => {
    // This is the reason folders were chosen over a flat directory: the U-03
    // padding probe is the SAME file name twice, padded and unpadded.
    const a = byId("T-10")!;
    const b = byId("T-11")!;
    expect(a.name).toBe(b.name);
    expect(a.path).not.toBe(b.path);
  });

  it("every stamp is the PACIFIC wall clock, never the UTC date  [FAQ L0075]", () => {
    // The fixed instant is 2025-06-16 04:30 UTC = 2025-06-15 21:30 Pacific.
    // A UTC stamp would read 20250616...; that would be the S-01 bug back.
    for (const f of FILES) {
      const stamp = f.name.match(/_(\d{14})\.csv$/)?.[1];
      expect(stamp, f.id).toBe("20250615213000");
    }
  });

  it("every file uses CRLF line endings and no stray bare LF", () => {
    for (const f of FILES) {
      const raw = read(f);
      expect(raw.replace(/\r\n/g, ""), f.id).not.toContain("\n");
    }
  });

  it("every file's 4th row is the exact template column header for its type", () => {
    for (const f of FILES) {
      const type = typeOf(f);
      const headerRow = read(f).split("\r\n")[3];
      // T-11 pads the first three rows, never the column row.
      expect(headerRow, f.id).toBe(CCRS_COLUMNS[type].join(","));
    }
  });

  it("NumberRecords equals the data-row count — except the file that breaks it on purpose", () => {
    for (const f of FILES) {
      const lines = read(f).split("\r\n").filter((l) => l.length > 0);
      const declared = Number(lines[2].split(",")[1]);
      const actual = lines.length - 4; // 3 header rows + 1 column row
      if (f.id.startsWith("T-54")) {
        // T-54 exists to prove CCRS rejects a bad count [G L0204-L0205].
        expect(declared, f.id).not.toBe(actual);
      } else {
        expect(declared, f.id).toBe(actual);
      }
    }
  });
});

describe("expected-PASS files really are valid; expected-ERROR files really are not", () => {
  it("every non-EXPECT-ERROR file passes our own verifier", () => {
    for (const f of FILES.filter((x) => !x.id.includes("EXPECT-ERROR"))) {
      const problems = verifyCcrsFile(typeOf(f), read(f));
      const errors = problems.filter((p) => p.severity === "error").map((p) => p.message);
      expect(errors, `${f.id} should be clean`).toEqual([]);
    }
  });

  it("at least one EXPECT-ERROR file exists for each rule we are probing", () => {
    const ids = FILES.filter((f) => f.id.includes("EXPECT-ERROR")).map((f) => f.id);
    // These are the rules whose VERBATIM error text we still do not have.
    for (const id of ["T-14", "T-18", "T-19", "T-31", "T-32", "T-48", "T-54"]) {
      expect(ids.some((x) => x.startsWith(id)), `missing probe ${id}`).toBe(true);
    }
  });

  it("the U-03 padding probe ships BOTH shapes of the same content", () => {
    const plain = read(byId("T-10")!);
    const padded = read(byId("T-11")!);
    expect(padded).not.toBe(plain);
    // Same data rows, different header shape — otherwise the comparison proves
    // nothing about padding.
    expect(padded.split("\r\n").slice(3).join("\r\n")).toBe(
      plain.split("\r\n").slice(3).join("\r\n"),
    );
    expect(padded.split("\r\n")[0]).toContain(",,");
    expect(plain.split("\r\n")[0]).not.toContain(",,");
  });

  it("the U-02 filename-case probe really is lower-cased", () => {
    const f = byId("T-12");
    expect(f).toBeDefined();
    expect(f!.name).toMatch(/^strain_/);
  });

  it("the Sale probe reproduces the LCB's own worked example  [FAQ L0155-L0160]", () => {
    const row = read(byId("T-40")!).split("\r\n")[4].split(",");
    const col = (name: string) => row[CCRS_COLUMNS.Sale.indexOf(name)];
    expect(col("Quantity")).toBe("3");
    expect(col("UnitPrice")).toBe("5.00");
    expect(col("Discount")).toBe("3.00");
    expect(col("RetailSalesTax")).toBe("1.20");
    expect(col("CannabisExciseTax")).toBe("4.44");
  });

  it("the manifest warns that these are PREPRODUCTION ONLY", () => {
    const m = readFileSync(join(OUT, "MANIFEST.md"), "utf8");
    expect(m).toContain("PREPRODUCTION ONLY");
    expect(m).toContain("precannabisreporting.lcb.wa.gov");
    // The wait between upload groups must be stated — it is the #1 cause of
    // spurious failures [G L0530].
    expect(m).toContain("10 minutes");
    // The owner must be told not to rename the files [G L0046].
    expect(m).toContain("Do not rename");
  });

  it("the manifest says the 10-minute wait is BETWEEN GROUPS, and why these probes still go one at a time", () => {
    const m = readFileSync(join(OUT, "MANIFEST.md"), "utf8");

    // The guide's only timing rule is a dependency gap before Inventory
    // [G L0530] -- it is NOT a per-file cooldown. Saying otherwise turns a
    // ~25 minute exercise into a multi-hour one for no reason.
    expect(m).toMatch(/BETWEEN GROUPS, not between files/i);

    // But these particular files must still go one at a time: nine of them
    // share a single file name, and T-10/T-11/T-12 carry identical data rows
    // on purpose, so a batch upload would make an error email ambiguous and
    // would answer neither U-02 nor U-03.
    expect(m).toMatch(/one file, one upload/i);
    expect(m).toContain("same file name");
  });

  it("the probes really do collide by file name, which is why the manifest warns about it", () => {
    // Guards the reasoning above with the actual data rather than a comment:
    // if a future change made every name unique, the warning would be stale.
    const counts = new Map<string, number>();
    for (const f of FILES) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    const collisions = [...counts.values()].filter((n) => n > 1);
    expect(collisions.length).toBeGreaterThan(0);

    // T-10/T-11/T-12 are the U-03 / U-02 probes and share their data rows.
    const dataRows = (id: string) =>
      read(byId(id)!).split("\r\n").slice(4).join("\r\n");
    expect(dataRows("T-10")).toBe(dataRows("T-11"));
  });
});

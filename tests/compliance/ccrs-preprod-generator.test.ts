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
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyCcrsFile,
  CCRS_COLUMNS,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";

let OUT = "";
let FILES: string[] = [];

/** Map a generated file name back to its CCRS file type. */
function typeOf(fileName: string): CcrsRetailerFileType {
  const m = fileName.match(/__([A-Za-z]+)_\d+_/);
  const raw = (m?.[1] ?? "") as string;
  // T-12 deliberately lower-cases the prefix to probe U-02.
  const canon = (Object.keys(CCRS_COLUMNS) as CcrsRetailerFileType[]).find(
    (t) => t.toLowerCase() === raw.toLowerCase(),
  );
  if (!canon) throw new Error(`cannot map "${fileName}" to a CCRS type`);
  return canon;
}

beforeAll(() => {
  OUT = mkdtempSync(join(tmpdir(), "ccrs-preprod-"));
  execFileSync(
    "npx",
    ["tsx", "scripts/compliance/generate-preprod-test-files.ts", "413541", OUT],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
  FILES = readdirSync(OUT).filter((f) => f.endsWith(".csv"));
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
      const name = f.split("__")[1];
      expect(name, f).toMatch(/^[A-Za-z]+_413541_\d{14}\.csv$/);
    }
  });

  it("every stamp is the PACIFIC wall clock, never the UTC date  [FAQ L0075]", () => {
    // The fixed instant is 2025-06-16 04:30 UTC = 2025-06-15 21:30 Pacific.
    // A UTC stamp would read 20250616...; that would be the S-01 bug back.
    for (const f of FILES) {
      const stamp = f.match(/_(\d{14})\.csv$/)?.[1];
      expect(stamp, f).toBe("20250615213000");
    }
  });

  it("every file uses CRLF line endings and no stray bare LF", () => {
    for (const f of FILES) {
      const raw = readFileSync(join(OUT, f), "utf8");
      expect(raw.replace(/\r\n/g, ""), f).not.toContain("\n");
    }
  });

  it("every file's 4th row is the exact template column header for its type", () => {
    for (const f of FILES) {
      const type = typeOf(f);
      const raw = readFileSync(join(OUT, f), "utf8");
      const headerRow = raw.split("\r\n")[3];
      // T-11 pads the first three rows, never the column row.
      expect(headerRow, f).toBe(CCRS_COLUMNS[type].join(","));
    }
  });

  it("NumberRecords equals the data-row count — except the file that breaks it on purpose", () => {
    for (const f of FILES) {
      const raw = readFileSync(join(OUT, f), "utf8");
      const lines = raw.split("\r\n").filter((l) => l.length > 0);
      const declared = Number(lines[2].split(",")[1]);
      const actual = lines.length - 4; // 3 header rows + 1 column row
      if (f.startsWith("T-54")) {
        // T-54 exists to prove CCRS rejects a bad count [G L0204-L0205].
        expect(declared, f).not.toBe(actual);
      } else {
        expect(declared, f).toBe(actual);
      }
    }
  });
});

describe("expected-PASS files really are valid; expected-ERROR files really are not", () => {
  it("every non-EXPECT-ERROR file passes our own verifier", () => {
    for (const f of FILES.filter((x) => !x.includes("EXPECT-ERROR"))) {
      const problems = verifyCcrsFile(typeOf(f), readFileSync(join(OUT, f), "utf8"));
      const errors = problems.filter((p) => p.severity === "error").map((p) => p.message);
      expect(errors, `${f} should be clean`).toEqual([]);
    }
  });

  it("at least one EXPECT-ERROR file exists for each rule we are probing", () => {
    const ids = FILES.filter((f) => f.includes("EXPECT-ERROR")).map((f) => f.split("__")[0]);
    // These are the rules whose VERBATIM error text we still do not have.
    for (const id of ["T-14", "T-18", "T-19", "T-31", "T-32", "T-48", "T-54"]) {
      expect(ids.some((x) => x.startsWith(id)), `missing probe ${id}`).toBe(true);
    }
  });

  it("the U-03 padding probe ships BOTH shapes of the same content", () => {
    const plain = readFileSync(
      join(OUT, FILES.find((f) => f.startsWith("T-10"))!),
      "utf8",
    );
    const padded = readFileSync(
      join(OUT, FILES.find((f) => f.startsWith("T-11"))!),
      "utf8",
    );
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
    const f = FILES.find((x) => x.startsWith("T-12"));
    expect(f).toBeDefined();
    expect(f!.split("__")[1]).toMatch(/^strain_/);
  });

  it("the Sale probe reproduces the LCB's own worked example  [FAQ L0155-L0160]", () => {
    const f = FILES.find((x) => x.startsWith("T-40"))!;
    const raw = readFileSync(join(OUT, f), "utf8");
    const row = raw.split("\r\n")[4].split(",");
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
  });
});

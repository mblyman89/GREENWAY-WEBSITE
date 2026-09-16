/**
 * tests/compliance/ccrs-file-stamp.test.ts — CCRS bible slice S-01
 * (docs/ccrs-bible/09-slice-plan.md § S-01; gap Part 04 N-05, N-04, N-06)
 *
 * GROUND (docs/ccrs-bible/02-authoritative-spec.md):
 *   [G L0046]  "Make sure to save the data as a .CSV file with the proper naming
 *              convention" — UploadType_LicenseNumber_YYYYMMDDHHMMSS
 *   [FAQ L0075] "the file name should be referenced in PST"
 *   [G L0209-L0253] the 3-row common header (SubmittedBy / SubmittedDate /
 *              NumberRecords) followed by the template column row
 *   [TPL * R1-R3] the official templates pad the three header rows with commas
 *              out to the column count. The guide does not say whether that is
 *              REQUIRED — that is UNVERIFIED item U-03 (Part 12), to be settled
 *              in PREproduction (Part 06 T-10 vs T-11). Until then the padding
 *              is behind a flag that is OFF by default, and BOTH shapes must
 *              round-trip through verifyCcrsFile().
 *
 * WHY THIS FILE EXISTS: ccrsFileStamp() used getUTC*, so a file generated after
 * 5 PM Pacific was named with TOMORROW's date while its own SubmittedDate row
 * (ccrsDate, Pacific) said today. Two different days inside one upload.
 */
import { describe, it, expect } from "vitest";
import {
  ccrsFileStamp,
  ccrsFileName,
  ccrsDate,
  assembleCcrsFile,
  verifyCcrsFile,
  padHeaderRowsForTemplates,
  CCRS_COLUMNS,
  CCRS_UPLOAD_ORDER,
} from "@/lib/compliance/ccrs-batch-core";
import {
  FIXTURE_LICENSE,
  FIXTURE_SUBMITTED_BY,
  FIXTURE_SUBMITTED_AT,
  FIXTURE_LATE_EVENING_UTC,
  FIXTURE_ROWS,
} from "./fixtures/ccrs-fixture";

describe("ccrsFileStamp is PACIFIC wall-clock, not UTC  [FAQ L0075]", () => {
  it("an instant that is already tomorrow in UTC still stamps today's Pacific date", () => {
    // 2025-06-16 04:30 UTC === 2025-06-15 21:30 PDT.
    // UTC would give 20250616043000 — the file would claim the NEXT day.
    expect(ccrsFileStamp(FIXTURE_LATE_EVENING_UTC)).toBe("20250615213000");
  });

  it("a Pacific-afternoon instant stamps the same wall clock", () => {
    // 2025-06-15 20:00 UTC === 2025-06-15 13:00 PDT.
    expect(ccrsFileStamp(FIXTURE_SUBMITTED_AT)).toBe("20250615130000");
  });

  it("winter instants use PST (UTC-8), not a hard-coded summer offset", () => {
    // 2025-01-05 07:59 UTC === 2025-01-04 23:59 PST.
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 0, 5, 7, 59, 0)))).toBe("20250104235900");
  });

  it("midnight Pacific stamps hour 00, never 24", () => {
    // 2025-03-11 07:00 UTC === 2025-03-11 00:00 PDT.
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 2, 11, 7, 0, 0)))).toBe("20250311000000");
  });

  it("the second before midnight Pacific keeps the OLD day", () => {
    // 2025-03-11 06:59:59 UTC === 2025-03-10 23:59:59 PDT.
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 2, 11, 6, 59, 59)))).toBe("20250310235959");
  });

  it("spring-forward: 2 AM Pacific does not exist, 3 AM PDT is stamped", () => {
    // 2025-03-09 10:00 UTC === 2025-03-09 03:00 PDT (clocks jumped 2→3).
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 2, 9, 10, 0, 0)))).toBe("20250309030000");
  });

  it("fall-back: the repeated 1 AM hour still stamps a valid 14-digit stamp", () => {
    // 2025-11-02 08:00 UTC === 2025-11-02 01:00 PDT (first pass through 1 AM).
    // 2025-11-02 09:00 UTC === 2025-11-02 01:00 PST (second pass).
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 10, 2, 8, 0, 0)))).toBe("20251102010000");
    expect(ccrsFileStamp(new Date(Date.UTC(2025, 10, 2, 9, 0, 0)))).toBe("20251102010000");
  });

  it("is always exactly 14 digits", () => {
    for (const d of [
      FIXTURE_SUBMITTED_AT,
      FIXTURE_LATE_EVENING_UTC,
      new Date(Date.UTC(2025, 0, 5, 7, 59, 0)),
      new Date(Date.UTC(2025, 8, 1, 0, 0, 1)),
    ]) {
      expect(ccrsFileStamp(d)).toMatch(/^\d{14}$/);
    }
  });
});

describe("file name and header agree on the SAME Pacific day  [G L0046] [FAQ L0075]", () => {
  it("the stamp's date part equals the SubmittedDate row's date", () => {
    // This is the bug N-05 describes: the two used different clocks.
    const stamp = ccrsFileStamp(FIXTURE_LATE_EVENING_UTC); // YYYYMMDDHHMMSS
    const submitted = ccrsDate(FIXTURE_LATE_EVENING_UTC); // MM/DD/YYYY
    const [mm, dd, yyyy] = submitted.split("/");
    expect(stamp.slice(0, 8)).toBe(`${yyyy}${mm}${dd}`);
  });

  it("every retailer file type names itself <type>_<license>_<stamp>.csv", () => {
    for (const type of CCRS_UPLOAD_ORDER) {
      const name = ccrsFileName(type, FIXTURE_LICENSE, FIXTURE_LATE_EVENING_UTC);
      expect(name).toBe(`${type}_${FIXTURE_LICENSE}_20250615213000.csv`);
    }
  });

  it("a blank license number still produces a well-shaped name", () => {
    expect(ccrsFileName("Sale", "", FIXTURE_SUBMITTED_AT)).toBe(
      "Sale_LICENSE_20250615130000.csv",
    );
  });
});

describe("header-row padding (U-03, Part 12 — OFF by default until PREprod says otherwise)", () => {
  const sample = () =>
    assembleCcrsFile({
      type: "Strain",
      submittedBy: FIXTURE_SUBMITTED_BY,
      submittedDate: FIXTURE_SUBMITTED_AT,
      rows: FIXTURE_ROWS.Strain,
    });

  it("the default output is NOT padded (unchanged behaviour, goldens intact)", () => {
    const [r1, r2, r3] = sample().split("\r\n");
    expect(r1).toBe("SubmittedBy,Greenway Marijuana");
    expect(r2).toBe("SubmittedDate,06/15/2025");
    expect(r3).toBe("NumberRecords,2");
  });

  it("padHeaderRowsForTemplates() pads rows 1-3 to the column count, like the templates", () => {
    const padded = padHeaderRowsForTemplates("Strain", sample());
    const width = CCRS_COLUMNS.Strain.length; // Strain has 5 columns
    const [r1, r2, r3, r4] = padded.split("\r\n");
    for (const r of [r1, r2, r3]) {
      expect(r.split(",").length).toBe(width);
    }
    expect(r1).toBe(`SubmittedBy,Greenway Marijuana${",".repeat(width - 2)}`);
    expect(r2).toBe(`SubmittedDate,06/15/2025${",".repeat(width - 2)}`);
    expect(r3).toBe(`NumberRecords,2${",".repeat(width - 2)}`);
    // The column row and the data rows are untouched.
    expect(r4).toBe(CCRS_COLUMNS.Strain.join(","));
  });

  it("padding leaves the data rows byte-identical", () => {
    const plain = sample();
    const padded = padHeaderRowsForTemplates("Strain", plain);
    expect(padded.split("\r\n").slice(3).join("\r\n")).toBe(
      plain.split("\r\n").slice(3).join("\r\n"),
    );
  });

  it("BOTH shapes pass verifyCcrsFile for every retailer file type", () => {
    for (const type of CCRS_UPLOAD_ORDER) {
      const plain = assembleCcrsFile({
        type,
        submittedBy: FIXTURE_SUBMITTED_BY,
        submittedDate: FIXTURE_SUBMITTED_AT,
        rows: FIXTURE_ROWS[type],
      });
      const padded = padHeaderRowsForTemplates(type, plain);
      expect(verifyCcrsFile(type, plain)).toEqual([]);
      expect(verifyCcrsFile(type, padded)).toEqual([]);
    }
  });

  it("padding is idempotent (padding an already-padded file changes nothing)", () => {
    const once = padHeaderRowsForTemplates("Product", sampleOf("Product"));
    expect(padHeaderRowsForTemplates("Product", once)).toBe(once);
  });

  /* ---------------------------------------------------------------- *
   * The two tests below exist because mutation testing proved the
   * assertions above could NOT fail for these defects
   * (scripts/ccrs-bible/mutate_check.py, mutants M4 and M5).
   *
   * M4: after one pad a header row has EXACTLY `width` cells, so the
   *     `cells.length >= width` guard computes ",".repeat(0) — a no-op.
   *     The guard's real job is protecting an OVER-WIDE row, where
   *     width - cells is NEGATIVE and String.repeat throws RangeError.
   * M5: the fixture's data rows already carry exactly `width` cells, so
   *     widening the loop past row 3 was also a no-op. Only a SHORT data
   *     row can prove the loop is bounded to the 3 header rows.
   * ---------------------------------------------------------------- */

  it("an over-wide header row is left alone and never throws RangeError  [M4]", () => {
    // A hand-edited file whose SubmittedBy row carries MORE cells than the
    // template has columns. Without the guard this is ",".repeat(negative).
    const width = CCRS_COLUMNS.Strain.length;
    const overWide =
      `SubmittedBy,${"x,".repeat(width + 3)}\r\n` +
      "SubmittedDate,06/15/2025\r\n" +
      "NumberRecords,1\r\n" +
      `${CCRS_COLUMNS.Strain.join(",")}\r\n`;

    let out = "";
    expect(() => {
      out = padHeaderRowsForTemplates("Strain", overWide);
    }).not.toThrow();

    // The over-wide row is preserved verbatim — padding never truncates.
    expect(out.split("\r\n")[0]).toBe(`SubmittedBy,${"x,".repeat(width + 3)}`);
    // The two genuinely short header rows still got padded to width.
    expect(out.split("\r\n")[1].split(",")).toHaveLength(width);
    expect(out.split("\r\n")[2].split(",")).toHaveLength(width);
  });

  it("padding is bounded to the 3 header rows — a short DATA row stays short  [M5]", () => {
    // A data row with fewer cells than the template width must NOT be padded;
    // only rows 0-2 are header rows. If the loop ever runs past row 3 this
    // assertion fails.
    const width = CCRS_COLUMNS.Strain.length;
    const shortDataRow = "ONLY,TWO";
    const csv =
      "SubmittedBy,a@b.com\r\n" +
      "SubmittedDate,06/15/2025\r\n" +
      "NumberRecords,1\r\n" +
      `${CCRS_COLUMNS.Strain.join(",")}\r\n` +
      `${shortDataRow}\r\n`;

    const padded = padHeaderRowsForTemplates("Strain", csv);
    const lines = padded.split("\r\n");

    // Header rows 0-2 padded out to the column count...
    for (let i = 0; i < 3; i += 1) {
      expect(lines[i].split(",")).toHaveLength(width);
    }
    // ...column row and the short data row untouched.
    expect(lines[3]).toBe(CCRS_COLUMNS.Strain.join(","));
    expect(lines[4]).toBe(shortDataRow);
  });

  it("padding never touches NumberRecords' value", () => {
    const padded = padHeaderRowsForTemplates("Inventory", sampleOf("Inventory"));
    const r3 = padded.split("\r\n")[2];
    expect(r3.split(",")[1]).toBe(String(FIXTURE_ROWS.Inventory.length));
  });

  function sampleOf(type: (typeof CCRS_UPLOAD_ORDER)[number]) {
    return assembleCcrsFile({
      type,
      submittedBy: FIXTURE_SUBMITTED_BY,
      submittedDate: FIXTURE_SUBMITTED_AT,
      rows: FIXTURE_ROWS[type],
    });
  }
});

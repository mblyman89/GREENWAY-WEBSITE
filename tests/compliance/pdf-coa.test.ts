/**
 * tests/compliance/pdf-coa.test.ts  (H16b-4)
 *
 * Parses the owner's REAL COA Summary (High_End_COA.pdf, 22 pages),
 * pre-extracted with the SAME serverless `unpdf` extractor used in production
 * into tests/compliance/fixtures/pdf-coa-highend-sample.txt (checked in).
 *
 * WHY: the COA PDF is TWO things merged. Page 1 is a "COA Summary" table that
 * maps EACH inventory Lot to its Lab Report #, Sample ID, strain, and
 * Tested/Expires dates. The remaining pages are the individual Certificates of
 * Analysis (one per Lab Report #), each carrying the batch PASS and the
 * Cannabinoid Analysis summary (Total THC / CBD / Total Cannabinoids). Many
 * Lots share ONE Lab Report (16 lots -> 4 reports here), so the parser links
 * Lot -> Report, reads each COA's potency/pass, then fans the report's potency
 * back out to every Lot that cited it. This is what lets the wiring slice
 * (H16b-5) pre-populate potency/PASS/expiry on the manifest's draft lines.
 *
 * DRAFTS-ONLY: enrichment for human review; never fabricates a PASS or a URL.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCoaSummary,
  looksLikeCoaSummary,
  normalizeCoaDate,
  parseCoaSummaryRows,
  parseCoaReports,
  __runCoaSummaryTests,
} from "@/lib/inventory/pdf-coa-core";

const sample = readFileSync(
  join(__dirname, "fixtures", "pdf-coa-highend-sample.txt"),
  "utf8",
);

describe("pdf-coa-core (H16b-4 — High End COA Summary PDF)", () => {
  it("recognizes the COA summary and rejects other layouts", () => {
    expect(looksLikeCoaSummary(sample)).toBe(true);
    expect(
      looksLikeCoaSummary("Internal Shipping Document Manifest ID: 21544 Batch"),
    ).toBe(false);
    expect(
      looksLikeCoaSummary("Transfer Log (This document is NOT a manifest) Transfer Log ID: GF1"),
    ).toBe(false);
  });

  it("normalizes ISO and m/d/yy dates", () => {
    expect(normalizeCoaDate("2026-03-06")).toBe("2026-03-06");
    expect(normalizeCoaDate("3/6/26")).toBe("2026-03-06");
    expect(normalizeCoaDate("garbage")).toBeNull();
  });

  it("parses all 16 front-page summary rows linking Lot -> Report", () => {
    const rows = parseCoaSummaryRows(sample);
    expect(rows).toHaveLength(16);
    expect(rows[0].lotId).toBe("01KMG0FTXX17N0ST");
    expect(rows[0].reportNumber).toBe("WA-260305-083");
    expect(rows[0].sampleId).toBe("01KJJGDGHYZ4TY06");
    expect(rows[0].strain).toBe("Cat Piss Cookies");
    expect(rows[0].testedOn).toBe("2026-03-06");
    expect(rows[0].expiresOn).toBe("2027-03-06");
    expect(rows[15].lotId).toBe("01KMG0M73JXFQNDP");
    expect(rows[15].reportNumber).toBe("WA-260305-031");
  });

  it("parses the 4 unique COA reports with PASS + potency", () => {
    const reports = parseCoaReports(sample);
    expect(reports).toHaveLength(4);
    const r083 = reports.find((r) => r.reportNumber === "WA-260305-083")!;
    expect(r083.passed).toBe(true);
    expect(r083.total_thc_pct).toBe(22);
    expect(r083.total_cbd_pct).toBe(0.054);
    expect(r083.total_cannabinoids_pct).toBe(27);
    expect(r083.tested_on).toBe("2026-03-06");
    expect(r083.strain).toBe("Cat Piss Cookies");
    const r031 = reports.find((r) => r.reportNumber === "WA-260305-031")!;
    expect(r031.total_thc_pct).toBe(24);
  });

  it("fans report potency out to every Lot that cited it", () => {
    const parsed = parseCoaSummary(sample)!;
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed.byLot)).toHaveLength(16);

    const lab1 = parsed.byLot["01KMG0FTXX17N0ST"];
    expect(lab1.labtest_external_identifier).toBe("WA-260305-083");
    expect(lab1.passed).toBe(true);
    expect(lab1.total_thc_pct).toBe(22);
    expect(lab1.coa_expire_date).toBe("2027-03-06");
    expect(lab1.potency_json?.["total-thc"]).toBe(22);

    // A DIFFERENT lot that shares report 083 gets the SAME potency (fan-out).
    const lab5 = parsed.byLot["01KMG0JFJT0ZN4VS"];
    expect(lab5.labtest_external_identifier).toBe("WA-260305-083");
    expect(lab5.total_thc_pct).toBe(22);

    expect(parsed.expiresByLot["01KMG0FTXX17N0ST"]).toBe("2027-03-06");
  });

  it("never fabricates a COA URL (the COA is the attached PDF itself)", () => {
    const parsed = parseCoaSummary(sample)!;
    for (const lab of Object.values(parsed.byLot)) {
      expect(lab.coa_url).toBeNull();
    }
    expect(parsed.warnings.some((w) => w.toLowerCase().includes("drafts only"))).toBe(true);
  });

  it("passes the embedded self-test suite", () => {
    const r = __runCoaSummaryTests(sample);
    expect(r.failed).toBe(0);
  });
});

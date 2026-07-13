/**
 * tests/compliance/pos-id-scan-core.test.ts  (POS Slice B3)
 *
 * Pins the register's mandatory ID gate: AAMVA PDF417 parsing (US MMDDCCYY /
 * Canada CCYYMMDD dates, CRLF-tolerant), 21+ age math on Pacific wall-clock
 * YYYY-MM-DD strings (RCW 69.50.357), expired-ID refusal and the WAC
 * 314-55-150 acceptable-ID list (incl. Global Entry + Permanent Resident
 * card, eff. 11/8/2025), plus the audited manual-verification fallback.
 */
import { describe, it, expect } from "vitest";
import {
  ACCEPTABLE_ID_TYPES,
  MINIMUM_AGE_YEARS,
  isAcceptableIdType,
  isYmd,
  parseAamvaDate,
  ageOn,
  isExpired,
  parseAamvaPdf417,
  evaluateScannedId,
  evaluateManualId,
  __runIdScanCoreTests,
  type ManualIdInput,
} from "@/lib/pos/id-scan-core";

const TODAY = "2026-07-13";

const WA_PAYLOAD =
  "@\n\x1e\rANSI 636045080002DL00410278ZW03190008DLDAQWDL123ABC456\n" +
  "DCSPUBLIC\nDACJOHN\nDADQ\nDBD09152023\nDBB07131990\nDBA07132028\n" +
  "DBC1\nDAYBRO\nDAU070 in\nDAG123 MAIN ST\nDAIPORT ORCHARD\nDAJWA\nDAK983660000\nDCGUSA\n";

describe("WAC 314-55-150 acceptable ID list", () => {
  it("carries all nine acceptable types, with scannability flags", () => {
    expect(ACCEPTABLE_ID_TYPES.map((t) => t.key)).toEqual([
      "drivers_license",
      "wa_identicard",
      "us_armed_forces",
      "passport",
      "nexus",
      "global_entry",
      "permanent_resident",
      "merchant_marine",
      "tribal_enrollment",
    ]);
    const scannable = ACCEPTABLE_ID_TYPES.filter((t) => t.scannable).map((t) => t.key);
    expect(scannable).toEqual(["drivers_license", "wa_identicard"]);
  });
  it("isAcceptableIdType rejects unlisted document types", () => {
    expect(isAcceptableIdType("passport")).toBe(true);
    expect(isAcceptableIdType("global_entry")).toBe(true);
    expect(isAcceptableIdType("library_card")).toBe(false);
    expect(isAcceptableIdType("")).toBe(false);
    expect(isAcceptableIdType(null)).toBe(false);
  });
  it("statutory minimum age is 21 (RCW 69.50.357)", () => {
    expect(MINIMUM_AGE_YEARS).toBe(21);
  });
});

describe("pure date math", () => {
  it("isYmd rejects impossible and misformatted dates", () => {
    expect(isYmd("2026-07-13")).toBe(true);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("07/13/2026")).toBe(false);
    expect(isYmd(20260713)).toBe(false);
  });
  it("parseAamvaDate handles US MMDDCCYY and Canada CCYYMMDD", () => {
    expect(parseAamvaDate("07131990", "USA")).toBe("1990-07-13");
    expect(parseAamvaDate("19900713", "CAN")).toBe("1990-07-13");
    expect(parseAamvaDate("13311990", "USA")).toBeNull();
    expect(parseAamvaDate("1990", "USA")).toBeNull();
  });
  it("ageOn counts the 21st birthday itself as 21", () => {
    expect(ageOn("2005-07-13", TODAY)).toBe(21);
    expect(ageOn("2005-07-14", TODAY)).toBe(20);
    expect(ageOn("1990-07-13", TODAY)).toBe(36);
    expect(ageOn("not-a-date", TODAY)).toBeNull();
  });
  it("a document is valid through its expiry date", () => {
    expect(isExpired("2026-07-12", TODAY)).toBe(true);
    expect(isExpired(TODAY, TODAY)).toBe(false);
    expect(isExpired("2027-01-01", TODAY)).toBe(false);
    expect(isExpired("bad", TODAY)).toBeNull();
  });
});

describe("AAMVA PDF417 parsing", () => {
  it("parses a WA-style payload into normalized identity fields", () => {
    const r = parseAamvaPdf417(WA_PAYLOAD);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.license.licenseNumber).toBe("WDL123ABC456");
      expect(r.license.lastName).toBe("PUBLIC");
      expect(r.license.firstName).toBe("JOHN");
      expect(r.license.dateOfBirth).toBe("1990-07-13");
      expect(r.license.expirationDate).toBe("2028-07-13");
      expect(r.license.issueDate).toBe("2023-09-15");
      expect(r.license.jurisdiction).toBe("WA");
      expect(r.license.country).toBe("USA");
      expect(r.license.aamvaVersion).toBe(8);
    }
  });
  it("tolerates CRLF scanners and Canadian CCYYMMDD dates", () => {
    const can =
      "@\r\n\x1e\rANSI 636028100002DL00410200DLDAQ12345\r\nDCSROY\r\nDACAVA\r\nDBB19980215\r\nDBA20290215\r\nDAJBC\r\nDCGCAN\r\n";
    const r = parseAamvaPdf417(can);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.license.dateOfBirth).toBe("1998-02-15");
      expect(r.license.expirationDate).toBe("2029-02-15");
      expect(r.license.country).toBe("CAN");
      expect(r.license.jurisdiction).toBe("BC");
    }
  });
  it("rejects non-AAMVA text, empty scans and missing DOB", () => {
    expect(parseAamvaPdf417("hello world").ok).toBe(false);
    expect(parseAamvaPdf417("").ok).toBe(false);
    const noDob = "@\n\x1e\rANSI 636045080002DL00410278DLDAQX1\nDCSDOE\n";
    const r = parseAamvaPdf417(noDob);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("manual");
  });
});

describe("scan gate verdicts", () => {
  const license = (() => {
    const r = parseAamvaPdf417(WA_PAYLOAD);
    if (!r.ok) throw new Error("fixture must parse");
    return r.license;
  })();

  it("allows a valid adult scan", () => {
    const v = evaluateScannedId(license, TODAY);
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.method).toBe("scan");
      expect(v.age).toBe(36);
      expect(v.expirationDate).toBe("2028-07-13");
    }
  });
  it("blocks under-21 (day before 21st birthday) and allows the 21st birthday", () => {
    const under = evaluateScannedId({ ...license, dateOfBirth: "2005-07-14" }, TODAY);
    expect(under.allowed).toBe(false);
    if (!under.allowed) expect(under.reason).toContain("under 21");
    const exact = evaluateScannedId({ ...license, dateOfBirth: "2005-07-13" }, TODAY);
    expect(exact.allowed).toBe(true);
  });
  it("blocks expired IDs (WAC 314-55-150)", () => {
    const v = evaluateScannedId({ ...license, expirationDate: "2026-07-12" }, TODAY);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain("Expired");
  });
  it("routes unreadable expiry or DOB to the manual path", () => {
    const noExp = evaluateScannedId({ ...license, expirationDate: null }, TODAY);
    expect(noExp.allowed).toBe(false);
    if (!noExp.allowed) expect(noExp.reason).toContain("manual");
    const noDob = evaluateScannedId({ ...license, dateOfBirth: null }, TODAY);
    expect(noDob.allowed).toBe(false);
    if (!noDob.allowed) expect(noDob.reason).toContain("manual");
  });
});

describe("manual verification gate (audited fallback)", () => {
  const good: ManualIdInput = {
    idType: "passport",
    dateOfBirth: "1990-07-13",
    expirationDate: "2030-01-01",
    reason: "Customer presented a passport (no barcode).",
    photoMatchConfirmed: true,
  };

  it("allows a valid passport with reason + photo match", () => {
    const v = evaluateManualId(good, TODAY);
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.method).toBe("manual");
      expect(v.idType).toBe("passport");
    }
  });
  it("refuses unlisted ID types, short reasons and unconfirmed photo match", () => {
    expect(evaluateManualId({ ...good, idType: "library_card" }, TODAY).allowed).toBe(false);
    expect(evaluateManualId({ ...good, reason: "x" }, TODAY).allowed).toBe(false);
    expect(evaluateManualId({ ...good, photoMatchConfirmed: false }, TODAY).allowed).toBe(false);
  });
  it("blocks under-21, expired and missing-expiry documents", () => {
    expect(evaluateManualId({ ...good, dateOfBirth: "2007-01-01" }, TODAY).allowed).toBe(false);
    expect(evaluateManualId({ ...good, expirationDate: "2026-07-12" }, TODAY).allowed).toBe(false);
    expect(evaluateManualId({ ...good, expirationDate: "" }, TODAY).allowed).toBe(false);
  });
  it("accepts Global Entry and Permanent Resident cards (eff. 11/8/2025)", () => {
    expect(evaluateManualId({ ...good, idType: "global_entry" }, TODAY).allowed).toBe(true);
    expect(evaluateManualId({ ...good, idType: "permanent_resident" }, TODAY).allowed).toBe(true);
  });
});

describe("embedded self-tests", () => {
  it("__runIdScanCoreTests passes", () => {
    expect(() => __runIdScanCoreTests()).not.toThrow();
  });
});

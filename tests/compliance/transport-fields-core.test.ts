/**
 * tests/compliance/transport-fields-core.test.ts
 *
 * Vitest mirror of the PURE transport-field gap-fill readers. The single most-
 * wanted missing field is the DRIVER'S LICENSE NUMBER, which is present in the
 * real WA-State transportation manifest (VMI: "License #: H0M3R") but sits under
 * the SAME "License #:" label the origin-licensee block uses — so the reader
 * must be anchored strictly to the driver block. These tests lock that in.
 */
import { describe, it, expect } from "vitest";
import {
  readDriverLicenseNumber,
  extractTransportFields,
  __runTransportFieldsCoreTests,
} from "@/lib/inventory/transport-fields-core";

describe("transport-fields-core — driver license number", () => {
  it("reads the driver DL from a VMI-style manifest, NOT the origin license", () => {
    const vmi =
      "Origin License Name: Grow Op Farms License #: 413287 Licensee Phone: 5098791221 " +
      "Driver's Name: David Homer Date of Birth: 03/04/1972 License #: H0M3R " +
      "Vehicle Make: Ram Vehicle Model: Promaster 3500 159 EXT Vehicle Color: White";
    expect(readDriverLicenseNumber(vmi)).toBe("H0M3R");
  });

  it("returns null when there is no driver block (never grabs origin license)", () => {
    expect(
      readDriverLicenseNumber("Origin License Name: FIRETREE LLC License #: 418524"),
    ).toBeNull();
  });

  it("returns null for a 'Not Applicable' driver license (contingency manifest)", () => {
    expect(
      readDriverLicenseNumber(
        "Driver's Name: Not Applicable License #: Not Applicable Vehicle Make: Not Applicable",
      ),
    ).toBeNull();
  });

  it("accepts an explicit 'Driver License #:' even when the value is 6 digits", () => {
    expect(
      readDriverLicenseNumber("Driver Name: Jane Q Driver License #: 123456 Vehicle Make: Ford"),
    ).toBe("123456");
  });

  it("rejects a bare 6-digit value under a plain 'License #:' (likely origin license)", () => {
    expect(
      readDriverLicenseNumber("Driver's Name: Sam Hauler License #: 654321 Vehicle Make: Ram"),
    ).toBeNull();
  });

  it("accepts an alphanumeric WA-style DL", () => {
    expect(
      readDriverLicenseNumber("Driver's Name: Kim Lane License #: WA1234ABC Vehicle Color: Blue"),
    ).toBe("WA1234ABC");
  });

  it("rejects a date-shaped value in the license slot", () => {
    expect(
      readDriverLicenseNumber("Driver's Name: A B License #: 03/04/1972 Vehicle Make: X"),
    ).toBeNull();
  });

  it("handles empty/junk input without throwing", () => {
    expect(readDriverLicenseNumber("")).toBeNull();
    expect(extractTransportFields("").driver_license_number).toBeNull();
  });

  it("the struct returns the same value as the direct reader", () => {
    const vmi = "Driver's Name: David Homer Date of Birth: 03/04/1972 License #: H0M3R Vehicle Make: Ram";
    expect(extractTransportFields(vmi).driver_license_number).toBe("H0M3R");
  });

  it("runs the bundled pure self-tests", () => {
    expect(__runTransportFieldsCoreTests()).toContain("assertions passed");
  });
});

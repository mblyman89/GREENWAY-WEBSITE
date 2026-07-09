/**
 * tests/compliance/manifest-dedupe.test.ts  (H16b-7)
 *
 * Locks in the owner-requested guard that prevents the SAME manifest entering
 * the intake table twice: "if for what ever reason the vendor sends us the
 * email twice or something, I dont want to accidentally accept the manifest
 * twice."
 *
 * The dedupe IDENTITY is (normalized manifest_number + normalized vendor).
 * A duplicate is BLOCKED only when an existing row is still live
 * (pending | in_transit | accepted); a rejected prior row does NOT block, so a
 * corrected re-send after a rejection is allowed to stage again. A manifest
 * with no manifest_number has no reliable identity and is NOT deduped.
 */
import { describe, it, expect } from "vitest";
import {
  buildManifestIdentity,
  isBlockingStatus,
  findBlockingDuplicate,
  __runManifestDedupeTests,
} from "@/lib/inventory/manifest-dedupe-core";

describe("manifest-dedupe-core (H16b-7)", () => {
  it("builds a normalized identity from number + vendor", () => {
    expect(buildManifestIdentity({ manifest_number: " ord-7208 ", vendor_label: "Lilac  Labs" })).toEqual({
      manifestNumber: "ORD-7208",
      vendorKey: "LILAC LABS",
    });
  });

  it("returns null identity when there is no manifest number to dedupe on", () => {
    expect(buildManifestIdentity({ manifest_number: null, vendor_label: "X" })).toBeNull();
    expect(buildManifestIdentity({ manifest_number: "   ", vendor_label: "X" })).toBeNull();
  });

  it("treats only live statuses as blocking", () => {
    expect(isBlockingStatus("pending")).toBe(true);
    expect(isBlockingStatus("in_transit")).toBe(true);
    expect(isBlockingStatus("accepted")).toBe(true);
    expect(isBlockingStatus("rejected")).toBe(false);
    expect(isBlockingStatus(null)).toBe(false);
  });

  it("blocks a live same-vendor same-number re-send", () => {
    const id = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;
    expect(
      findBlockingDuplicate(id, [
        { id: "m1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "pending" },
      ]),
    ).toBe("m1");
  });

  it("does NOT block when the only prior row was rejected (corrected re-send)", () => {
    const id = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;
    expect(
      findBlockingDuplicate(id, [
        { id: "m1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "rejected" },
      ]),
    ).toBeNull();
  });

  it("does NOT block when the same number belongs to a different vendor", () => {
    const id = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;
    expect(
      findBlockingDuplicate(id, [
        { id: "m1", manifest_number: "ORD-7208", vendor_label: "Mako Farms", status: "pending" },
      ]),
    ).toBeNull();
  });

  it("matches duplicates case- and whitespace-insensitively", () => {
    const id = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;
    expect(
      findBlockingDuplicate(id, [
        { id: "m9", manifest_number: " ord-7208 ", vendor_label: "lilac  labs", status: "in_transit" },
      ]),
    ).toBe("m9");
  });

  it("skips a rejected row and blocks on a live one with the same identity", () => {
    const id = buildManifestIdentity({ manifest_number: "ORD-7208", vendor_label: "Lilac Labs" })!;
    expect(
      findBlockingDuplicate(id, [
        { id: "r0", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "rejected" },
        { id: "r1", manifest_number: "ORD-7208", vendor_label: "Lilac Labs", status: "accepted" },
      ]),
    ).toBe("r1");
  });

  it("passes the embedded self-test suite", () => {
    const r = __runManifestDedupeTests();
    expect(r.failed).toBe(0);
  });
});

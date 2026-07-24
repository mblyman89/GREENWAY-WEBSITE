/**
 * tests/compliance/handbook-ack-core.test.ts  (SLICE 36)
 *
 * Pins the employee-handbook acknowledgment GATE (owner directive: "new
 * employees have to read it and check a box and validate they read them and
 * will abide … before being given access to the back office and front end
 * POS"):
 *
 *  - back office: staff must acknowledge the CURRENT handbook version;
 *    owners are exempt (they can never be locked out of their own store);
 *  - register: digital acknowledgment via the linked staff account OR the
 *    signed paper copy in the employee file (PIN-only employees);
 *  - versioned: bumping HANDBOOK_VERSION invalidates prior acknowledgments;
 *  - the typed-name confirmation is validated (trim/collapse, 2–120 chars).
 */
import { describe, it, expect } from "vitest";
import {
  hasAcknowledgedVersion,
  backOfficeHandbookGate,
  registerHandbookGate,
  normalizeAcknowledgedName,
  __runHandbookAckTests,
} from "@/lib/staffing/handbook-ack-core";
import { HANDBOOK_VERSION, HANDBOOK_SECTIONS } from "@/lib/staffing/handbook-content";

describe("hasAcknowledgedVersion", () => {
  it("matches the exact current version (whitespace-tolerant)", () => {
    expect(hasAcknowledgedVersion(["2.0"], "2.0")).toBe(true);
    expect(hasAcknowledgedVersion([" 2.0 "], "2.0")).toBe(true);
    expect(hasAcknowledgedVersion(["1.0"], "2.0")).toBe(false);
    expect(hasAcknowledgedVersion([], "2.0")).toBe(false);
  });

  it("a version bump invalidates prior acknowledgments (re-read required)", () => {
    expect(hasAcknowledgedVersion(["1.0"], "1.0")).toBe(true);
    expect(hasAcknowledgedVersion(["1.0"], "2.0")).toBe(false);
    expect(hasAcknowledgedVersion(["1.0", "2.0"], "2.0")).toBe(true);
  });

  it("blank configured version disables the gate (nothing to acknowledge)", () => {
    expect(hasAcknowledgedVersion([], "")).toBe(true);
    expect(hasAcknowledgedVersion([], "   ")).toBe(true);
  });
});

describe("backOfficeHandbookGate — the box before back-office access", () => {
  it("blocks staff without a current-version acknowledgment", () => {
    const gate = backOfficeHandbookGate({ role: "manager", ackedVersions: [], currentVersion: "2.0" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/read the employee handbook/i);
  });

  it("passes staff who acknowledged the current version", () => {
    expect(
      backOfficeHandbookGate({ role: "staff", ackedVersions: ["2.0"], currentVersion: "2.0" }).ok,
    ).toBe(true);
  });

  it("owners are exempt — never locked out of their own store", () => {
    expect(backOfficeHandbookGate({ role: "owner", ackedVersions: [], currentVersion: "2.0" }).ok).toBe(
      true,
    );
  });

  it("an old acknowledgment does not satisfy a newer version", () => {
    expect(
      backOfficeHandbookGate({ role: "manager", ackedVersions: ["1.0"], currentVersion: "2.0" }).ok,
    ).toBe(false);
  });
});

describe("registerHandbookGate — the box before the register unlocks", () => {
  it("blocks a PIN unlock with no acknowledgment on any path", () => {
    const gate = registerHandbookGate({
      linkedStaffRole: "staff",
      ackedVersions: [],
      currentVersion: "2.0",
      paperHandbookSigned: false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/handbook acknowledgment required/i);
  });

  it("digital acknowledgment via the linked staff account passes", () => {
    expect(
      registerHandbookGate({
        linkedStaffRole: "staff",
        ackedVersions: ["2.0"],
        currentVersion: "2.0",
        paperHandbookSigned: false,
      }).ok,
    ).toBe(true);
  });

  it("the signed PAPER copy passes (PIN-only employees with no login)", () => {
    expect(
      registerHandbookGate({
        linkedStaffRole: null,
        ackedVersions: [],
        currentVersion: "2.0",
        paperHandbookSigned: true,
      }).ok,
    ).toBe(true);
  });

  it("a linked owner account is exempt like in the back office", () => {
    expect(
      registerHandbookGate({
        linkedStaffRole: "owner",
        ackedVersions: [],
        currentVersion: "2.0",
        paperHandbookSigned: false,
      }).ok,
    ).toBe(true);
  });
});

describe("normalizeAcknowledgedName — typed-signature validation", () => {
  it("trims and collapses internal whitespace", () => {
    const r = normalizeAcknowledgedName("  Jordan   Smith  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe("Jordan Smith");
  });

  it("rejects blank / too-short / too-long names", () => {
    expect(normalizeAcknowledgedName("").ok).toBe(false);
    expect(normalizeAcknowledgedName("A").ok).toBe(false);
    expect(normalizeAcknowledgedName("x".repeat(121)).ok).toBe(false);
  });
});

describe("handbook content — the document the gate protects", () => {
  it("has a version and a full-scope section list (21 sections in v2.0)", () => {
    expect(HANDBOOK_VERSION.trim().length).toBeGreaterThan(0);
    expect(HANDBOOK_SECTIONS.length).toBeGreaterThanOrEqual(21);
    const ids = HANDBOOK_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    for (const key of ["welcome", "discipline", "acknowledgment", "cash-handling", "loss-prevention"]) {
      expect(ids).toContain(key);
    }
    // The acknowledgment section is the LAST one (it is the sign-off page).
    expect(ids[ids.length - 1]).toBe("acknowledgment");
  });
});

describe("embedded self-tests", () => {
  it("__runHandbookAckTests passes", () => {
    expect(() => __runHandbookAckTests()).not.toThrow();
  });
});

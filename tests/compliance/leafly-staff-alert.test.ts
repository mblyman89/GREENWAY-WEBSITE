/**
 * tests/compliance/leafly-staff-alert.test.ts — STANDING OFFER 2, round L-24.
 *
 * The staff-alert core carries its own embedded self-tests, which CI runs via
 * `run-pure-selftests.ts`. This file exists for the assertions that suite
 * cannot make: the ones about the OWNER'S CONSTRAINT as a property rather
 * than as a list of examples, and the ones about the boundary between the
 * core and the real world.
 *
 * The distinction matters because the whole feature is defined by a negative.
 * The owner said, verbatim:
 *
 *   "I don't need an email sent to us, the back office dashboard, printer and
 *    speaker let us know an order has been placed."
 *
 * A feature whose correctness is mostly "it stays silent" is exactly the kind
 * that rots quietly — every individual change looks harmless, and one day the
 * mailbox is full. So the central assertion here is exhaustive rather than
 * illustrative: across EVERY combination of the inputs, an alert is sent if
 * and only if something the owner relies on actually failed.
 */
import { describe, expect, it } from "vitest";

import {
  ALERT_URGENCY_MINUTES,
  decideStaffAlert,
  isPermittedStaffRecipient,
  permittedStaffRecipients,
  STAFF_ALERT_REASON_TEXT,
  type StaffAlertInput,
  minutesUntilDeadline,
  type StaffAlertStage,
} from "@/lib/leafly/staff-alert-core";

const STAGES: StaffAlertStage[] = ["arrival", "acceptance"];
const BOOLS = [true, false];

/** Every reachable combination of the four health signals, at both stages. */
function everyCombination(): StaffAlertInput[] {
  const out: StaffAlertInput[] = [];
  for (const stage of STAGES) {
    for (const announced of BOOLS) {
      for (const printed of BOOLS) {
        for (const bridgedToRegister of BOOLS) {
          for (const collectionFailed of BOOLS) {
            out.push({
              leaflyOrderId: "abcdef12-3456-7890-abcd-ef1234567890",
              stage,
              announced,
              printed,
              bridgedToRegister,
              collectionFailed,
              minutesUntilDeadline: 10,
              hasStaffRecipients: true,
              providerConfigured: true,
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * The ground truth, written INDEPENDENTLY of the implementation.
 *
 * Deliberately expressed the way the owner would say it out loud — "did the
 * things I rely on happen?" — rather than by mirroring the code's branch
 * structure. A test oracle that restates the implementation proves only that
 * the code equals itself.
 */
function somethingActuallyFailed(input: StaffAlertInput): boolean {
  if (input.announced !== true) return true;
  if (input.printed !== true) return true;
  if (input.collectionFailed === true) return true;
  // The register is only expected to have the order AFTER we acknowledge.
  if (input.stage === "acceptance" && input.bridgedToRegister !== true) return true;
  return false;
}

describe("L-24 — the alert is silent unless the owner's channels failed", () => {
  it("covers a meaningful number of combinations", () => {
    // Guards the loop below. If the generator were ever reduced to a handful
    // of cases, every assertion under it would still pass while proving far
    // less than it claims.
    expect(everyCombination()).toHaveLength(32);
  });

  it("sends if and only if something the owner relies on failed", () => {
    // THE CENTRAL PROPERTY. Exhaustive, not illustrative.
    const wrong: string[] = [];
    for (const input of everyCombination()) {
      const expected = somethingActuallyFailed(input);
      const actual = decideStaffAlert(input).send;
      if (actual !== expected) {
        wrong.push(
          `${input.stage} announced=${input.announced} printed=${input.printed} ` +
            `bridged=${input.bridgedToRegister} collectFailed=${input.collectionFailed} ` +
            `-> sent ${actual}, expected ${expected}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never claims quiet-because-healthy while also sending", () => {
    // These two are contradictory by definition, and a reader who saw both
    // would not know which to believe.
    for (const input of everyCombination()) {
      const d = decideStaffAlert(input);
      expect(d.send && d.quietBecauseHealthy).toBe(false);
    }
  });

  it("always explains itself, even when silent", () => {
    for (const input of everyCombination()) {
      const d = decideStaffAlert(input);
      expect(d.summary.trim().length).toBeGreaterThan(0);
      expect(d.summary).not.toContain("undefined");
      // A subject is only meaningful on something actually being sent.
      if (!d.send) expect(d.subject).toBe("");
      else expect(d.subject.trim().length).toBeGreaterThan(0);
    }
  });

  it("names a reason for every alert, and none when silent-and-healthy", () => {
    for (const input of everyCombination()) {
      const d = decideStaffAlert(input);
      if (d.send) expect(d.reasons.length).toBeGreaterThan(0);
      if (d.quietBecauseHealthy) expect(d.reasons).toEqual([]);
      for (const r of d.reasons) {
        expect(STAFF_ALERT_REASON_TEXT[r]).toBeTruthy();
      }
    }
  });
});

describe("L-24 — a healthy ARRIVAL is not treated as a broken order", () => {
  /**
   * THE DEFECT THIS PINS. `decideBridgeActions` returns
   * `createLocalOrder: false` at arrival, by the owner's own two-stage rule:
   * the order is supposed to be absent from the register until we
   * acknowledge. Without the stage field, `not_bridged` fired on EVERY
   * healthy arrival — an email per order, the exact outcome the owner ruled
   * out. Caught while wiring the core to the webhook.
   */
  const healthyArrival: StaffAlertInput = {
    leaflyOrderId: "abcdef12-3456-7890-abcd-ef1234567890",
    stage: "arrival",
    announced: true,
    printed: true,
    bridgedToRegister: false,
    collectionFailed: false,
    minutesUntilDeadline: 14,
    hasStaffRecipients: true,
    providerConfigured: true,
  };

  it("stays completely silent", () => {
    const d = decideStaffAlert(healthyArrival);
    expect(d.send).toBe(false);
    expect(d.reasons).toEqual([]);
    expect(d.quietBecauseHealthy).toBe(true);
  });

  it("does not claim the register has seen an order it has not", () => {
    expect(decideStaffAlert(healthyArrival).summary).not.toContain("reached the register");
  });

  it("but the SAME facts at acceptance DO alert", () => {
    // Proves the stage guard narrowed the question rather than deleting it.
    const d = decideStaffAlert({ ...healthyArrival, stage: "acceptance" });
    expect(d.send).toBe(true);
    expect(d.reasons).toEqual(["not_bridged"]);
  });

  it("treats an omitted or unrecognised stage as the STRICTER reading", () => {
    // A field nobody set must never switch a safety check off.
    const omitted = { ...healthyArrival };
    delete omitted.stage;
    expect(decideStaffAlert(omitted).reasons).toEqual(["not_bridged"]);

    const junk = { ...healthyArrival, stage: "later" as unknown as StaffAlertStage };
    expect(decideStaffAlert(junk).reasons).toEqual(["not_bridged"]);
  });
});

describe("L-24 — a missing signal is a FAILURE, never an assumed success", () => {
  it("treats undefined booleans as failures", () => {
    // If the caller could not tell us whether the bell rang, the safe reading
    // is that it did not. Optimism here means silence on a broken order.
    const d = decideStaffAlert({
      leaflyOrderId: "ord-1",
      stage: "acceptance",
      hasStaffRecipients: true,
      providerConfigured: true,
    });
    expect(d.send).toBe(true);
    expect(d.quietBecauseHealthy).toBe(false);
  });

  it("treats truthy non-booleans as failures too", () => {
    // `announced: "yes"` is a caller bug. Reading it as success would hide a
    // real outage behind a type error.
    const d = decideStaffAlert({
      leaflyOrderId: "ord-1",
      stage: "arrival",
      announced: "yes" as unknown as boolean,
      printed: 1 as unknown as boolean,
      hasStaffRecipients: true,
      providerConfigured: true,
    });
    expect(d.send).toBe(true);
  });
});

describe("L-24 — 'warranted but impossible' is distinguishable from 'healthy'", () => {
  const broken: StaffAlertInput = {
    leaflyOrderId: "ord-1",
    stage: "arrival",
    announced: false,
    printed: false,
    hasStaffRecipients: true,
    providerConfigured: true,
  };

  it("reports the reasons even when no provider is configured", () => {
    const d = decideStaffAlert({ ...broken, providerConfigured: false });
    expect(d.send).toBe(false);
    // The crucial bit: NOT quiet-because-healthy. Silence here and silence on
    // a good order look identical in a log and demand opposite reactions.
    expect(d.quietBecauseHealthy).toBe(false);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.summary).toContain("WARRANTED");
  });

  it("reports the reasons even when no recipients are configured", () => {
    const d = decideStaffAlert({ ...broken, hasStaffRecipients: false });
    expect(d.send).toBe(false);
    expect(d.quietBecauseHealthy).toBe(false);
    expect(d.summary).toContain("WARRANTED");
  });

  it("stays quiet-because-healthy on a good order even with no provider", () => {
    // The contrast. An unconfigured provider must not manufacture a problem
    // out of an order that went perfectly.
    const d = decideStaffAlert({
      leaflyOrderId: "ord-1",
      stage: "acceptance",
      announced: true,
      printed: true,
      bridgedToRegister: true,
      providerConfigured: false,
      hasStaffRecipients: false,
    });
    expect(d.send).toBe(false);
    expect(d.quietBecauseHealthy).toBe(true);
  });
});

describe("L-24 — urgency reaches the subject line", () => {
  const base: StaffAlertInput = {
    leaflyOrderId: "abcdef12-3456-7890-abcd-ef1234567890",
    stage: "arrival",
    announced: false,
    printed: false,
    hasStaffRecipients: true,
    providerConfigured: true,
  };

  it("says the deadline passed when it has", () => {
    expect(decideStaffAlert({ ...base, minutesUntilDeadline: 0 }).subject).toContain(
      "DEADLINE PASSED",
    );
    expect(decideStaffAlert({ ...base, minutesUntilDeadline: -3 }).subject).toContain(
      "DEADLINE PASSED",
    );
  });

  it("counts down inside the urgency window", () => {
    const s = decideStaffAlert({
      ...base,
      minutesUntilDeadline: ALERT_URGENCY_MINUTES,
    }).subject;
    expect(s).toContain("min left");
  });

  it("does not cry wolf outside it", () => {
    const s = decideStaffAlert({
      ...base,
      minutesUntilDeadline: ALERT_URGENCY_MINUTES + 1,
    }).subject;
    expect(s).not.toContain("min left");
    expect(s).not.toContain("DEADLINE PASSED");
  });

  it("keeps the urgency threshold inside Leafly's fifteen-minute window", () => {
    // A threshold at or above fifteen would mark every order urgent.
    expect(ALERT_URGENCY_MINUTES).toBeGreaterThan(0);
    expect(ALERT_URGENCY_MINUTES).toBeLessThan(15);
  });

  it("never leaks a full order id into a subject line", () => {
    // Subjects appear in notification previews on lock screens.
    const s = decideStaffAlert({ ...base, minutesUntilDeadline: 2 }).subject;
    expect(s).not.toContain("abcdef12-3456-7890-abcd-ef1234567890");
    expect(s).toContain("abcdef12");
  });
});

describe("L-24 — a staff alert can never be addressed to the shopper", () => {
  /**
   * The contract guard. Leafly's spec makes Leafly the sole originator of
   * consumer-facing communications; a "staff" alert that reached the shopper
   * would be a breach. This is enforced structurally rather than by habit.
   */
  it("refuses the customer's own address", () => {
    expect(isPermittedStaffRecipient("shopper@example.com", "shopper@example.com")).toBe(false);
  });

  it("refuses it regardless of casing or surrounding spaces", () => {
    expect(isPermittedStaffRecipient("  SHOPPER@Example.COM ", "shopper@example.com")).toBe(
      false,
    );
  });

  it("allows a genuine staff address", () => {
    expect(isPermittedStaffRecipient("owner@greenwaymarijuana.com", "shopper@example.com")).toBe(
      true,
    );
  });

  it("refuses anything that is not an address at all", () => {
    for (const bad of ["", "   ", "not-an-email", null, undefined]) {
      expect(isPermittedStaffRecipient(bad, null)).toBe(false);
    }
  });

  it("filters a list, drops duplicates, and keeps order", () => {
    const out = permittedStaffRecipients(
      [
        "owner@greenwaymarijuana.com",
        "shopper@example.com",
        "OWNER@greenwaymarijuana.com",
        "",
        null,
        "manager@greenwaymarijuana.com",
      ],
      "shopper@example.com",
    );
    expect(out).toEqual([
      "owner@greenwaymarijuana.com",
      "manager@greenwaymarijuana.com",
    ]);
  });

  it("still filters sensibly when no customer address is known", () => {
    // A missing customer address must not disable the rest of the validation.
    expect(permittedStaffRecipients(["a@b.com", "junk"], null)).toEqual(["a@b.com"]);
  });
});

describe("L-24 — the deadline is read honestly", () => {
  const now = Date.parse("2026-02-01T12:00:00.000Z");

  it("returns the real remaining minutes", () => {
    expect(minutesUntilDeadline("2026-02-01T12:10:00.000Z", now)).toBeCloseTo(10, 6);
  });

  it("goes negative once the deadline has passed", () => {
    expect(minutesUntilDeadline("2026-02-01T11:55:00.000Z", now)).toBeCloseTo(-5, 6);
  });

  it("returns NULL — never zero — for a missing or unreadable deadline", () => {
    // Zero means "expired", which the core escalates to DEADLINE PASSED.
    // Conflating "unknown" with "expired" would manufacture an urgent alert
    // out of a parsing failure.
    for (const bad of ["", "   ", "not a date", null, undefined]) {
      expect(minutesUntilDeadline(bad, now)).toBeNull();
    }
  });

  it("does not treat an unknown deadline as urgent", () => {
    const d = decideStaffAlert({
      leaflyOrderId: "ord-1",
      stage: "arrival",
      announced: false,
      printed: false,
      minutesUntilDeadline: minutesUntilDeadline(null, now),
      hasStaffRecipients: true,
      providerConfigured: true,
    });
    expect(d.send).toBe(true);
    expect(d.subject).not.toContain("DEADLINE PASSED");
    expect(d.subject).not.toContain("min left");
  });
});

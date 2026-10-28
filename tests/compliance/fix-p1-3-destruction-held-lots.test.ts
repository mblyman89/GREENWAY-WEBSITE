/**
 * Fix Phase 1.3 (G-28; F-05a-17, F-05a-18, F-05a-19, F-15-9, F-15-11) -
 * Returns & Destruction handles held lots.
 *
 * Owner basis: D39 (destruction belongs on Returns & Destruction) and D65
 * (Michael, verbatim: "Let's treat recalls like a transfer back to the vendor
 * for now."): recalled product is never destroyed by us.
 *
 * Pins: the pure rules; the store (schedule stores the earlier status and
 * moves only Active -> Quarantine compare-and-set, refuses Recalled and the
 * Recall reason; complete refuses a Recalled lot and restores after a partial
 * destruction; cancel closes compare-and-set, keeps the reason, restores and
 * never touches a customer-return lot); the owner-only permission; the
 * action (reason, audit before/after, refused audit); the page (picker lists
 * Active + Quarantine with status, never Recalled; Recall reason gone; cancel
 * form only for the owner); migration 0307; the guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateDestructionSchedule,
  lotStatusAfterEventCloses,
  evaluateDestructionCancel,
  completionLotRefusal,
  schedulableDestructionReasons,
  DESTROYABLE_LOT_STATUSES,
  __runDestructionLotStatusCoreTests,
} from "@/lib/inventory/destruction-lot-status-core";
import { DESTRUCTION_REASONS } from "@/lib/inventory/disposition-reasons";
import { can } from "@/lib/auth/roles";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const DISPO = read("src/lib/inventory/disposition.ts");
const ACTIONS = read("src/app/admin/inventory/disposition/actions.ts");
const PAGE = read("src/app/admin/inventory/disposition/page.tsx");

function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("destruction lot-status core", () => {
  it("self-tests pass", () => {
    const r = __runDestructionLotStatusCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(31);
  });
  it("D65: Recalled is never destroyable; Recall reason never schedulable", () => {
    expect(DESTROYABLE_LOT_STATUSES).toEqual(["active", "quarantine"]);
    expect(schedulableDestructionReasons(DESTRUCTION_REASONS)).not.toContain("recall");
    const r = evaluateDestructionSchedule({ reason: "expired", touchesLot: true, lotStatus: "recalled", openEventPrevious: null });
    expect(r.ok).toBe(false);
    expect(completionLotRefusal("recalled")).toMatch(/never destroyed by us/);
  });
  it("only an Active lot is moved to Quarantine; Quarantine stays; earlier status stored", () => {
    expect(evaluateDestructionSchedule({ reason: "damaged", touchesLot: true, lotStatus: "active", openEventPrevious: null })).toEqual({
      ok: true,
      previousLotStatus: "active",
      setQuarantine: true,
    });
    expect(evaluateDestructionSchedule({ reason: "damaged", touchesLot: true, lotStatus: "quarantine", openEventPrevious: null })).toEqual({
      ok: true,
      previousLotStatus: "quarantine",
      setQuarantine: false,
    });
  });
  it("close: only Quarantine -> Active, only if it was Active and nothing else holds it", () => {
    const base = { previousLotStatus: "active", touchedLot: true, lotStatus: "quarantine", otherOpenEvents: 0 };
    expect(lotStatusAfterEventCloses(base).action).toBe("restore_active");
    expect(lotStatusAfterEventCloses({ ...base, lotStatus: "recalled" }).action).toBe("leave");
    expect(lotStatusAfterEventCloses({ ...base, previousLotStatus: "quarantine" }).action).toBe("leave");
    expect(lotStatusAfterEventCloses({ ...base, otherOpenEvents: 1 }).action).toBe("leave");
    expect(lotStatusAfterEventCloses({ ...base, touchedLot: false, previousLotStatus: null }).why).toBe("untouched");
    expect(lotStatusAfterEventCloses({ ...base, previousLotStatus: null }).why).toBe("unknown_previous");
  });
  it("cancel: owner + reason", () => {
    expect(evaluateDestructionCancel({ eventStatus: "ready", canCancel: true, reason: "vendor takes it" }).ok).toBe(true);
    expect(evaluateDestructionCancel({ eventStatus: "ready", canCancel: false, reason: "x" }).ok).toBe(false);
    expect(evaluateDestructionCancel({ eventStatus: "ready", canCancel: true, reason: " " }).ok).toBe(false);
  });
});

describe("owner-only cancel permission", () => {
  it("inventory.destruction.cancel is the owner's alone", () => {
    expect(can("owner", "inventory.destruction.cancel")).toBe(true);
    expect(can("admin", "inventory.destruction.cancel")).toBe(false);
    expect(can("manager", "inventory.destruction.cancel")).toBe(false);
  });
});

describe("disposition store", () => {
  it("scheduleDestruction runs the core, compare-and-sets Active -> Quarantine, stores the earlier status", () => {
    const b = fnBody(DISPO, "scheduleDestruction");
    expect(b).toContain("evaluateDestructionSchedule({");
    expect(b).toMatch(/update\(\{ status: "quarantine", updated_by: actorId \}\)\s*\.eq\("id", input\.lotId\)\s*\.eq\("status", "active"\)/);
    expect(b).toContain("previous_lot_status: decision.previousLotStatus, lot_status_touched: touchesLot");
    expect(b).toContain("isMissingSchemaError(error.message)");
    // the Quarantine write now comes AFTER the decision (never blind)
    expect(b.indexOf("evaluateDestructionSchedule({")).toBeLessThan(b.indexOf('status: "quarantine"'));
  });
  it("completeDestruction refuses a Recalled lot before posting, and restores after a partial", () => {
    const b = fnBody(DISPO, "completeDestruction");
    expect(b).toContain("completionLotRefusal(");
    expect(b.indexOf("completionLotRefusal(")).toBeLessThan(b.indexOf("postReduction("));
    expect(b).toContain("await restoreLotAfterEventCloses(admin, event, actorId);");
  });
  it("cancelDestruction never blindly sets Active (F-05a-19) and keeps the reason", () => {
    const b = fnBody(DISPO, "cancelDestruction");
    expect(b).not.toMatch(/update\(\{ status: "active"/);
    expect(b).toContain("cancel_reason: reason");
    expect(b).toContain('.in("status", [...OPEN_DESTRUCTION_STATUSES])');
    expect(b).toContain("restoreLotAfterEventCloses(admin, event, actorId)");
  });
  it("the restore is compare-and-set on Quarantine", () => {
    const i = DISPO.indexOf("async function restoreLotAfterEventCloses(");
    const b = DISPO.slice(i, DISPO.indexOf("\n}\n", i));
    expect(b).toMatch(/update\(\{ status: "active", updated_by: actorId \}\)\s*\.eq\("id", event\.lot_id\)\s*\.eq\("status", "quarantine"\)/);
    expect(b).toContain("lotStatusAfterEventCloses({");
  });
  it("the customer-return path still never moves the lot", () => {
    expect(DISPO).toContain("quarantineLot: false,");
  });
});

describe("cancel action", () => {
  it("checks the owner permission and the reason, audits refusals and before/after", () => {
    const i = ACTIONS.indexOf("export async function cancelDestructionAction(id: string, formData: FormData)");
    expect(i).toBeGreaterThan(-1);
    const b = ACTIONS.slice(i, ACTIONS.indexOf("\n}\n", i));
    expect(b).toContain('can(session.profile.role, "inventory.destruction.cancel")');
    expect(b).toContain('formData.get("cancel_reason")');
    expect(b).toContain("DESTRUCTION_CANCEL_REFUSED_AUDIT_ACTION");
    expect(b).toContain("before: { event_status:");
    expect(b).toContain("lot_status: result.lotAfter");
    expect(b.indexOf("evaluateDestructionCancel(")).toBeLessThan(b.indexOf("cancelDestruction(id"));
  });
});

describe("page", () => {
  it("picker lists Active and Quarantine lots with status, never Recalled", () => {
    expect(PAGE).toContain('listLots({ status: "quarantine", limit: 500 })');
    // Phase 1.5 (G-42, D65) now loads Recalled lots for the VENDOR RETURN
    // picker. The destruction picker must still never offer them: it is built
    // from Active + Quarantine only and filtered by isDestroyableLotStatus.
    expect(PAGE).toContain("const destroyableLots = [...lots, ...quarantineLots].filter((l) => isDestroyableLotStatus(l.status));");
    expect(PAGE).not.toMatch(/destroyableLots = \[[^\]]*recalledLots/);
    expect(PAGE).toContain("destroyableLots.map((l) =>");
    expect(PAGE).toContain("DESTROYABLE_LOT_STATUS_LABELS[l.status]");
  });
  it("Recall is not offered as a destruction reason; the warning points to a vendor return", () => {
    expect(PAGE).toContain("destructionReasons.map((r) =>");
    expect(PAGE).not.toContain("DESTRUCTION_REASONS.map((r) =>");
    expect(PAGE).toContain("Recall product? Never destroy it");
  });
  it("cancel form is the owner's, with a required reason; others see why not", () => {
    expect(PAGE).toContain("canCancelDestruction ? (");
    expect(PAGE).toContain('name="cancel_reason" required');
    expect(PAGE).toContain("Only the owner can cancel a scheduled destruction");
    expect(PAGE).not.toContain("Cancel (release quarantine)");
  });
});

describe("migration 0307 and the guard", () => {
  it("0307 is idempotent: add column if not exists", () => {
    const m = read("supabase/migrations/0307_destruction_previous_lot_status.sql");
    for (const c of ["previous_lot_status", "lot_status_touched", "cancel_reason", "cancelled_by", "cancelled_at"]) {
      expect(m).toContain(`add column if not exists ${c}`);
    }
    expect(m).toContain("if not exists (");
    expect(m).not.toMatch(/\bupdate\s+public\./i);
  });
  it("guard step 5 pins compare-and-set lot writes in disposition.ts", () => {
    const g = read("scripts/compliance/check-activation-gate.ts");
    expect(g).toContain("Fix Phase 1.3 (G-28 req 5");
    expect(g).toContain("without a compare-and-set on the status it replaces");
  });
  it("self-test registered", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("destruction-lot-status-core", __runDestructionLotStatusCoreTests(), 31)',
    );
  });
});

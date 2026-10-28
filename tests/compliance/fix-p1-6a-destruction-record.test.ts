/**
 * Fix Phase 1.6a (G-43; F-15-4, F-15-5, F-15-12, F-15-21; D64).
 *
 * Owner (D64): "anyone may witness the destruction. It has to be done on
 * camera as well." A destruction is completed only with:
 *   - a witness chosen from the staff roster, never the person completing;
 *   - a camera reference (camera, start, end; Pacific);
 *   - for "Other method", the LCB's prior approval reference and date.
 * Scheduling refuses more than the lot has free (on hand - held - open
 * destructions). Times are Pacific. A printable monthly Destruction log.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDestructionRecord,
  evaluateScheduleQuantity,
  formatDestructionPacific,
  holdNotElapsedMessage,
  schedulableQty,
  witnessLine,
  parseLogMonth,
  __runDestructionRecordCoreTests,
  type DestructionRecordInput,
} from "@/lib/inventory/destruction-record-core";
import { validateDestructionCompletion } from "@/lib/inventory/disposition-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0310_destruction_record.sql");
const DISP = read("src/lib/inventory/disposition.ts");
const ACT = read("src/app/admin/inventory/disposition/actions.ts");
const PAGE = read("src/app/admin/inventory/disposition/page.tsx");
const LOG = read("src/app/admin/inventory/disposition/destruction-log/page.tsx");

const roster = [
  { id: "e1", full_name: "Alex Lee", staff_id: "u1", active: true },
  { id: "e2", full_name: "Jo Smith", staff_id: null, active: true },
];
const base: DestructionRecordInput = {
  witnessEmployeeId: "e2",
  roster,
  actorUserId: "u1",
  actorName: "Alex Lee",
  cameraName: "Cam 4 vault",
  cameraStartIso: "2026-07-04T21:05:00Z",
  cameraEndIso: "2026-07-04T21:20:00Z",
  renderingMethod: "grind_mix_compostable",
  otherApprovalRef: null,
  otherApprovalDate: null,
  nowMs: Date.parse("2026-07-04T22:00:00Z"),
};
const codes = (r: ReturnType<typeof evaluateDestructionRecord>) => (r.ok ? [] : r.refusals.map((x) => x.code));

describe("Phase 1.6a G-43 core", () => {
  it("self-test passes", () => {
    const r = __runDestructionRecordCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(28);
  });

  it("D64: anyone may witness, but not the person completing", () => {
    expect(evaluateDestructionRecord(base).ok).toBe(true);
    expect(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "e1" }))).toContain("witness_is_actor");
    expect(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: null }))).toContain("witness_missing");
    expect(codes(evaluateDestructionRecord({ ...base, witnessEmployeeId: "nobody" }))).toContain("witness_unknown");
  });

  it("D64: on camera, with a start and end time that make sense", () => {
    expect(codes(evaluateDestructionRecord({ ...base, cameraName: "" }))).toContain("camera_missing");
    expect(codes(evaluateDestructionRecord({ ...base, cameraEndIso: null }))).toContain("camera_times");
    expect(codes(evaluateDestructionRecord({ ...base, cameraEndIso: base.cameraStartIso }))).toContain("camera_order");
    expect(codes(evaluateDestructionRecord({ ...base, cameraEndIso: "2026-07-05T03:00:00Z" }))).toContain("camera_future");
  });

  it("Other method needs the LCB's prior approval (WAC 314-55-097)", () => {
    const other = { ...base, renderingMethod: "lcb_approved_other" };
    expect(codes(evaluateDestructionRecord(other))).toContain("other_approval");
    expect(codes(evaluateDestructionRecord({ ...other, otherApprovalRef: "LCB-1", otherApprovalDate: "06/01/2026" }))).toContain("other_approval");
    expect(evaluateDestructionRecord({ ...other, otherApprovalRef: "LCB-1", otherApprovalDate: "2026-06-01" }).ok).toBe(true);
  });

  it("F-15-12: scheduling cannot exceed on hand less held and open destructions", () => {
    expect(schedulableQty({ onHand: 10, held: 2, openEvents: [{ quantity: 2, held_qty_reserved: 2 }, { quantity: 3 }] })).toBe(5);
    expect(evaluateScheduleQuantity({ quantity: 5, onHand: 10, held: 2, openEvents: [{ quantity: 3 }] }).ok).toBe(true);
    const r = evaluateScheduleQuantity({ quantity: 6, onHand: 10, held: 2, openEvents: [{ quantity: 3 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("nothing was scheduled");
  });

  it("F-15-5: times are Pacific, including the hold refusal", () => {
    expect(formatDestructionPacific("2026-07-04T21:05:00Z")).toBe("07/04/2026 2:05 PM Pacific");
    expect(holdNotElapsedMessage("2026-12-01T20:00:00Z")).toBe("Hold policy not elapsed \u2014 earliest destroy at 12/01/2026 12:00 PM Pacific.");
    const v = validateDestructionCompletion({
      reason: "expired",
      renderingMethod: "grind_mix_compostable",
      mixMaterial: "coffee",
      fiftyPercentAttested: true,
      witnessedBy: null,
      finalDestination: "dumpster",
      disposalFacility: null,
      lcbCoordinated: false,
      lcbOfficer: null,
      earliestDestroyAt: "2099-01-01T20:00:00Z",
      nowMs: Date.now(),
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("Pacific");
  });

  it("the witness line names both people and the camera", () => {
    expect(
      witnessLine({ witnessName: "Jo Smith", actorName: "Alex Lee", cameraName: "Cam 4", cameraStartIso: base.cameraStartIso!, cameraEndIso: base.cameraEndIso! }),
    ).toBe("Alex Lee (did) / Jo Smith (witness) \u00b7 camera Cam 4 07/04/2026 2:05 PM Pacific \u2013 07/04/2026 2:20 PM Pacific");
    expect(parseLogMonth("2026-07")).toBe("2026-07");
    expect(parseLogMonth("2026-7")).toBeNull();
  });
});

describe("Phase 1.6a G-43 wiring", () => {
  it("the server action checks the record before completing, and audits refusals", () => {
    const fn = ACT.slice(ACT.indexOf("export async function completeDestructionAction"));
    const body = fn.slice(0, fn.indexOf("\nexport async function", 10));
    expect(body.indexOf("evaluateDestructionRecord(")).toBeGreaterThan(0);
    expect(body.indexOf("evaluateDestructionRecord(")).toBeLessThan(body.indexOf("await completeDestruction("));
    expect(body).toContain("action: `${DESTRUCTION_COMPLETE_AUDIT_ACTION}_refused`");
    expect(body).toContain("listEmployees()");
    expect(body).toContain("camera_start_at: cameraStartAt");
    expect(body).not.toContain('str(formData, "witnessed_by")');
  });

  it("scheduling checks the quantity on the server after the status rules", () => {
    const fn = DISP.slice(DISP.indexOf("export async function scheduleDestruction"));
    expect(fn).toContain("evaluateScheduleQuantity({");
    expect(fn).toContain("if (!qtyCheck.ok) return { ok: false, error: qtyCheck.message };");
    expect(fn.indexOf("if (!qtyCheck.ok)")).toBeLessThan(fn.indexOf('.update({ status: "quarantine"'));
  });

  it("completion stores the record columns and falls back before migration 0310", () => {
    expect(DISP).toContain("witness_employee_id: input.record.witnessEmployeeId");
    expect(DISP).toContain("camera_name: input.record.cameraName");
    expect(DISP).toContain("if (error && input.record && isMissingSchemaError(error.message))");
  });

  it("the page asks for the witness from the roster and the camera, in Pacific", () => {
    expect(PAGE).toContain('name="witness_employee_id"');
    expect(PAGE).toContain('name="camera_name"');
    expect(PAGE).toContain('name="camera_start"');
    expect(PAGE).toContain('name="camera_end"');
    expect(PAGE).toContain('name="other_approval_ref"');
    expect(PAGE).not.toContain('name="witnessed_by"');
    expect(PAGE).not.toMatch(/earliest_destroy_at\)\.toLocaleString\(\)/);
    expect(PAGE).toContain("Destruction log (print)");
  });

  it("the printable log is permission-gated, Pacific, and names witness and camera", () => {
    expect(LOG).toContain('requirePermission("inventory.manage")');
    expect(LOG).toContain("listCompletedDestructionsForMonth(month)");
    expect(LOG).toContain("formatDestructionPacific(r.completed_at)");
    expect(LOG).toContain("cameraCell(r)");
    expect(LOG).toContain("Keep this log five years.");
  });

  it("migration 0310 only adds columns", () => {
    for (const c of ["witness_employee_id", "witness_name", "camera_name", "camera_start_at", "camera_end_at", "other_method_approval_ref", "other_method_approval_date"]) {
      expect(MIG).toContain(`add column if not exists ${c}`);
    }
    expect(MIG).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(MIG).not.toMatch(/\bupdate\s+public\./i);
    expect(MIG).not.toMatch(/\bdelete\s+from\b/i);
  });
});

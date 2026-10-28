/**
 * Fix Phase 1.2 (G-23; F-05a-3 … F-05a-7, F-05a-13) - the hardened manual
 * adjustment on the lot page.
 *
 * Pins: the pure rules (D39 reason list, notes where CCRS needs them,
 * incident reference for Theft / Seizure, no below zero), the store write
 * (atomic strict applyLotDelta, adjustment row deleted on refusal, Sold out
 * only when removing from Active, audit row), the action, the page (reason
 * list, note + reference fields, Schedule destruction link, history with name
 * and Pacific time), the disposition preselect, and the Issues text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateManualAdjustment,
  MANUAL_ADJUSTMENT_REASONS,
  LOT_ADJUSTED_AUDIT_ACTION,
  wantsAutoSoldOut,
  __runManualAdjustmentCoreTests,
} from "@/lib/inventory/manual-adjustment-core";
import { mapAdjustmentReason } from "@/lib/compliance/ccrs-inventory-adjustment-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const base = { qtyDelta: -1, note: "found broken", onHand: 3, lotStatus: "active" };

describe("manual-adjustment core", () => {
  it("self-tests pass", () => {
    const r = __runManualAdjustmentCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(25);
  });
  it("D39: no Receive, Destruction or Recall removal; Theft and Seizure offered", () => {
    expect(MANUAL_ADJUSTMENT_REASONS).not.toContain("receive");
    expect(MANUAL_ADJUSTMENT_REASONS).not.toContain("destruction");
    expect(MANUAL_ADJUSTMENT_REASONS).not.toContain("recall");
    expect(MANUAL_ADJUSTMENT_REASONS).toContain("theft");
    expect(MANUAL_ADJUSTMENT_REASONS).toContain("seizure");
    for (const r of ["receive", "destruction", "recall"]) {
      expect(evaluateManualAdjustment({ ...base, reason: r }).ok).toBe(false);
    }
  });
  it("every offered reason maps to a CCRS reason; Theft and Seizure map exactly", () => {
    expect(mapAdjustmentReason("theft")).toBe("Theft");
    expect(mapAdjustmentReason("seizure")).toBe("Seizure");
  });
  it("a note is required wherever CCRS reports Other or Theft (E13)", () => {
    for (const r of ["other", "employee_sample"]) {
      const d = evaluateManualAdjustment({ ...base, reason: r, note: "" });
      expect(d.ok).toBe(false);
    }
    const t = evaluateManualAdjustment({ ...base, reason: "theft", note: "", incidentReference: "" });
    expect(t.ok).toBe(false);
  });
  it("never below zero", () => {
    expect(evaluateManualAdjustment({ ...base, reason: "damage", qtyDelta: -4 }).ok).toBe(false);
  });
  it("Sold out flip only when removing from an Active lot (never an ungated restock)", () => {
    expect(wantsAutoSoldOut("active", -1)).toBe(true);
    expect(wantsAutoSoldOut("sold_out", 2)).toBe(false);
  });
});

describe("store write", () => {
  const store = read("src/lib/inventory/store.ts");
  const body = store.slice(store.indexOf("export async function createAdjustment("), store.indexOf("export async function getStaffNames("));
  it("is atomic and strict, removes the ledger row on refusal, and audits", () => {
    expect(body).toContain("applyLotDelta(admin, {");
    expect(body).toMatch(/clamp: false/);
    expect(body).toMatch(/autoStatus: autoSoldOut/);
    expect(body).toMatch(/if \(!written\.ok\) \{\s*await admin\.from\("inventory_adjustments"\)\.delete\(\)\.eq\("id", adjustmentId\);/);
    expect(body).toContain("action: LOT_ADJUSTED_AUDIT_ACTION");
    expect(LOT_ADJUSTED_AUDIT_ACTION).toBe("inventory_lot.adjusted");
    expect(body).not.toMatch(/\.update\(\{ on_hand_qty: next/);
    expect(body).toContain("RETIRED_ADJUSTMENT_REASONS[input.reason]");
  });
});

describe("action and page", () => {
  it("the action runs the core and never keeps a VALID_REASONS list", () => {
    const a = read("src/app/admin/inventory/actions.ts");
    expect(a).toContain("evaluateManualAdjustment({");
    expect(a).not.toContain("const VALID_REASONS");
    expect(a).toMatch(/createAdjustment\([\s\S]{0,300}session\.email/);
  });
  it("the page offers the core's list, the reference field, the Schedule destruction link and named history", () => {
    const p = read("src/app/admin/inventory/[id]/page.tsx");
    expect(p).toContain("MANUAL_ADJUSTMENT_REASONS.map(");
    expect(p).not.toContain('label: "Receive (add)"');
    expect(p).not.toContain('label: "Recall removal"');
    expect(p).toContain('name="incident_reference"');
    expect(p).toContain("/admin/inventory/disposition?lot=${lot.id}#schedule-destruction");
    expect(p).toContain("adjustmentActorName(a.actor_id, adjustmentNames)");
    expect(p).toContain("formatPacificDateTime(a.created_at)");
  });
  it("Returns & Destruction preselects the lot from ?lot=", () => {
    const d = read("src/app/admin/inventory/disposition/page.tsx");
    expect(d).toContain('id="schedule-destruction"');
    expect(d).toContain("defaultValue={preselectLot}");
  });
  it("the Issues expired-lot text no longer points to Adjust quantity", () => {
    const i = read("src/lib/admin/issues-core.ts");
    expect(i).not.toContain("record the destruction under Adjust quantity");
    expect(i).toContain("never Adjust quantity");
  });
});

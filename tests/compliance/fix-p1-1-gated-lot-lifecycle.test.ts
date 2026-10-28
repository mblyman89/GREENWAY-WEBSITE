/**
 * Fix Phase 1.1 (G-19 + G-22; F-04-2, F-05a-1, F-05a-2, F-04-12) - the gated,
 * audited lot lifecycle on the lot page.
 *
 * Pins: the pure rules (go-live check on Active, no manual Destroyed, a reason
 * on every change, recall release limited to owner + admin with a clearance
 * reference), the permission, the server action (core + audit on change and
 * refusal + compare-and-set write), the page (no Destroyed choice, reason and
 * reference fields, Status history in Pacific time with names), the Issues
 * text, and the compliance guard (non-literal and "destroyed" writes).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  evaluateLotLifecycleChange,
  MANUAL_LOT_STATUSES,
  LOT_STATUS_AUDIT_ACTION,
  __runLotLifecycleCoreTests,
} from "@/lib/inventory/lot-lifecycle-core";
import { can, ALL_PERMISSIONS, PERMISSION_LABELS } from "@/lib/auth/roles";
import { buildManifestIssues } from "@/lib/admin/issues-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const clear = { id: "L", label: "Lot", ccrsExternalId: "X", hasLabResult: true, labPassed: true };

describe("lot-lifecycle core", () => {
  it("self-tests pass", () => {
    const r = __runLotLifecycleCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });
  it("Destroyed is never a manual choice", () => {
    expect(MANUAL_LOT_STATUSES).not.toContain("destroyed");
    const d = evaluateLotLifecycleChange({ fromStatus: "active", toStatus: "destroyed", reason: "x", canReleaseRecall: true, gateFacts: clear });
    expect(d.ok).toBe(false);
  });
  it("Active runs the go-live check", () => {
    const d = evaluateLotLifecycleChange({
      fromStatus: "quarantine", toStatus: "active", reason: "clear", canReleaseRecall: true,
      gateFacts: { id: "L", ccrsExternalId: null, hasLabResult: false },
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.refusals.map((r) => r.code)).toContain("go_live_check_failed");
  });
  it("recall release: owner/admin only, with a clearance reference", () => {
    const mgr = evaluateLotLifecycleChange({ fromStatus: "recalled", toStatus: "quarantine", reason: "r", reference: "N", canReleaseRecall: false, gateFacts: clear });
    expect(mgr.ok).toBe(false);
    const noRef = evaluateLotLifecycleChange({ fromStatus: "recalled", toStatus: "quarantine", reason: "r", canReleaseRecall: true, gateFacts: clear });
    expect(noRef.ok).toBe(false);
    const ok = evaluateLotLifecycleChange({ fromStatus: "recalled", toStatus: "quarantine", reason: "r", reference: "N", canReleaseRecall: true, gateFacts: clear });
    expect(ok.ok).toBe(true);
  });
});

describe("permission inventory.recall.release (D37)", () => {
  it("owner and admin only", () => {
    expect(can("owner", "inventory.recall.release")).toBe(true);
    expect(can("admin", "inventory.recall.release")).toBe(true);
    for (const r of ["manager", "content_editor", "staff", "readonly"] as const) {
      expect(can(r, "inventory.recall.release")).toBe(false);
    }
    expect(ALL_PERMISSIONS).toContain("inventory.recall.release");
    expect(PERMISSION_LABELS["inventory.recall.release"]).toMatch(/owner & admin/);
  });
});

describe("server action and store", () => {
  const actions = read("src/app/admin/inventory/actions.ts");
  const body = actions.slice(actions.indexOf("export async function setLotStatusAction"));
  const fn = body.slice(0, body.indexOf("\n}\n"));
  it("runs the core, checks the permission, audits change and refusal", () => {
    expect(fn).toContain("evaluateLotLifecycleChange(");
    expect(fn).toContain('can(session.profile.role, "inventory.recall.release")');
    expect(fn).toContain("LOT_STATUS_AUDIT_ACTION");
    expect(fn).toContain("LOT_STATUS_REFUSED_AUDIT_ACTION");
    expect(fn).toContain("getLotGateFacts(lotId)");
    expect(fn.indexOf("updateLotStatus(")).toBeLessThan(fn.indexOf("action: LOT_STATUS_AUDIT_ACTION"));
    expect(actions).not.toContain("VALID_STATUSES");
  });
  it("the write is compare-and-set and refuses non-manual statuses", () => {
    const store = read("src/lib/inventory/store.ts");
    const u = store.slice(store.indexOf("export async function updateLotStatus"));
    const uf = u.slice(0, u.indexOf("\n}\n"));
    expect(uf).toContain("isManualLotStatus(status)");
    expect(uf).toContain('.eq("status", fromStatus)');
    expect(uf).toContain('.select("id")');
    expect(store).toContain(".eq(\"action\", LOT_STATUS_AUDIT_ACTION)");
    expect(LOT_STATUS_AUDIT_ACTION).toBe("inventory_lot.status_changed");
  });
});

describe("lot page", () => {
  const page = read("src/app/admin/inventory/[id]/page.tsx");
  it("no Destroyed choice; reason and reference fields; history", () => {
    expect(page).not.toContain('{ value: "destroyed", label: "Destroyed" }');
    expect(page).toContain("MANUAL_LOT_STATUSES.map");
    expect(page).toContain('name="status_reason"');
    expect(page).toContain('name="status_reference"');
    expect(page).toContain('data-testid="status-history"');
    expect(page).toContain("formatPacificDateTime(h.at)");
    expect(page).toContain("{h.who}");
    expect(page).toContain('href="/admin/inventory/disposition"');
  });
});

describe("Issues text (G-19 req 4, F-04-12)", () => {
  it("now-clear row points at the gated path; no stale attach text", () => {
    const issues = buildManifestIssues({
      manifestId: "m", inProgress: false, missingCoaLines: 0, unmappedCategoryLines: 0, menu: null,
      heldLots: [
        { id: "a", label: "A", reasons: [] },
        { id: "b", label: "B", reasons: [{ code: "missing_lab_result", message: "x" }] },
      ],
    });
    const clearRow = issues.find((i) => i.code === "manifest_held_now_clear")!;
    expect(clearRow.fixText).toMatch(/go-live check/);
    const held = issues.find((i) => i.code === "manifest_held_lot")!;
    expect(held.fixText).toMatch(/Attach a lab result/);
    expect(held.fixText).not.toMatch(/cannot attach one yet/);
  });
});

describe("compliance guard", () => {
  it("check-activation-gate.ts passes and covers non-literal + destroyed writes", () => {
    const out = execFileSync("npx", ["tsx", "scripts/compliance/check-activation-gate.ts"], { cwd: root, encoding: "utf8" });
    expect(out).toContain("ACTIVATION-GATE GUARD OK");
    const src = read("scripts/compliance/check-activation-gate.ts");
    expect(src).toContain("REVIEWED_NONLITERAL");
    expect(src).toContain("DESTROYED_WRITERS");
  }, 60_000);
});

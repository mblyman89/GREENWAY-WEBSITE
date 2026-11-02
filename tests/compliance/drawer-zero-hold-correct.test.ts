/**
 * Owner D125 / D126 / D127 (2026-11-02): "Thank you. Please build 1-3 now."
 *
 *   D125  a $0.00 close must be confirmed ("The drawer is really empty");
 *   D126  reconcile is held when the closer's count and the second count are
 *         more than $5.00 apart, until the manager picks the count and says why;
 *   D127  owner/admin can correct a reconciled drawer (reason required, audit,
 *         books untouched).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runDrawerCorrectionCoreTests,
  checkZeroClose,
  countBasisNeeded,
  resolveCountBasis,
  checkCorrection,
  ZERO_CLOSE_CONFIRM_ERROR,
} from "@/lib/registers/drawer-correction-core";
import { validateTillRequest } from "@/lib/pos/till-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("drawer-correction-core self-tests", () => {
  it("all pass", () => {
    const r = __runDrawerCorrectionCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });
});

describe("D125: a $0.00 close must be confirmed", () => {
  it("the iPad request is refused at $0.00 without the tick", () => {
    const r = validateTillRequest({ action: "close", pin: "1234", denoms: {}, tipsMinor: 9000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(ZERO_CLOSE_CONFIRM_ERROR);
  });
  it("accepted with the tick, and the tick is carried for the audit", () => {
    const r = validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipPool: { poolMinor: 18000, people: 2 } });
    expect(r.ok).toBe(true);
    if (r.ok && r.req.action === "close") {
      expect(r.req.confirmedEmpty).toBe(true);
      expect(r.req.tipsMinor).toBe(9000);
    }
  });
  it("a real count never needs the tick", () => {
    expect(checkZeroClose(1, undefined).ok).toBe(true);
  });
  it("the iPad shows the tick box and only sends it at $0.00", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain("The drawer is really empty");
    expect(shell).toContain("countedMinor === 0 && confirmEmpty ? { confirmEmpty: true }");
    expect(shell).toContain("tipsValid && (countedMinor > 0 || confirmEmpty)");
  });
  it("the till route audits a confirmed-empty close", () => {
    expect(read("src/app/api/pos/till/route.ts")).toContain("till.confirmedEmpty ? { confirmedEmpty: true }");
  });
  it("the back-office close applies the same rule", () => {
    expect(read("src/app/admin/registers/actions.ts")).toContain('checkZeroClose(denomTotalMinor(denoms), formData.get("confirm_empty"))');
    expect(read("src/components/admin/registers/RegisterControls.tsx")).toContain('name="confirm_empty"');
  });
});

describe("D126: hold at reconcile when the counts differ by more than $5.00", () => {
  it("SR2 2026-11-01 ($0.00 vs $2,678.10) is held; equal counts are not", () => {
    expect(countBasisNeeded(0, 267810)).toBe(true);
    expect(countBasisNeeded(222000, 222000)).toBe(false);
    expect(countBasisNeeded(0, 0)).toBe(false);
  });
  it("choosing the second count reconciles on it", () => {
    const r = resolveCountBasis({ closingMinor: 0, secondMinor: 267810, basis: "second", reason: "closer typed nothing" });
    expect(r.ok && r.countedMinor).toBe(267810);
  });
  it("the reconcile action enforces the choice and the store swaps the count with compare-and-set", () => {
    const actions = read("src/app/admin/registers/actions.ts");
    expect(actions).toContain("countBasisNeeded(toReconcile.closing_count_minor, toReconcile.second_count_minor)");
    expect(actions).toContain('action: "drawer.count_basis_chosen"');
    const store = read("src/lib/registers/store.ts");
    expect(store).toContain('q = q.eq("closing_count_minor", opts.countBasis.originalClosingMinor)');
    expect(store).toContain("const os = overShort(counted, expected);");
  });
  it("the reconcile card shows the choice", () => {
    const page = read("src/app/admin/registers/page.tsx");
    expect(page).toContain('name="count_basis" value="second"');
    expect(page).toContain('name="count_basis_reason"');
  });
});

describe("D127: correct a reconciled drawer", () => {
  it("SR2 corrected to the second count is short $99.90", () => {
    const r = checkCorrection({
      status: "reconciled",
      currentCountMinor: 0,
      expectedMinor: 277800,
      secondMinor: 267810,
      basis: "second",
      reason: "closer entered $0 by mistake",
      sealed: false,
      journalExists: false,
    });
    expect(r.ok && r.newOverShortMinor).toBe(-9990);
  });
  it("owner/admin only, audited, never touches the books", () => {
    const actions = read("src/app/admin/registers/actions.ts");
    const i = actions.indexOf("export async function correctReconciledDrawerAction");
    expect(i).toBeGreaterThan(0);
    const body = actions.slice(i);
    expect(body).toContain('requirePermission("registers.warnings")');
    expect(body).toContain('action: "drawer.reconcile_corrected"');
    expect(body).not.toContain("postDrawerCloseForSession");
    const store = read("src/lib/registers/drawer-correction-store.ts");
    expect(store).toContain('.eq("status", "reconciled")');
    expect(store).toContain('.eq("closing_count_minor", oldCount)');
    expect(store).toContain("tillCloseSourceRef(sessionId)");
    expect(store).not.toMatch(/submitJournal|postDrawerCloseForSession/);
  });
  it("the till summary page offers the correction to owner/admin", () => {
    const page = read("src/app/admin/registers/history/[id]/page.tsx");
    expect(page).toContain("correctReconciledDrawerAction");
    expect(page).toContain('can(staff.profile.role, "registers.warnings")');
  });
  it("no migration was needed", () => {
    expect(read("src/lib/registers/drawer-correction-store.ts")).toContain("No migration");
  });
});

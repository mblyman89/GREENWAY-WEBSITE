/**
 * tests/compliance/fix-p4-1-count-integrity.test.ts
 *
 * Fix Phase 4.1-4.3 (G-33 stage controls, G-34 I'm done, G-35 cutoff, G-36
 * count integrity, G-37 reasons). Migration 0326 is the enforcement; its
 * behaviour is proven against real Postgres by
 * scripts/recon/audit-count-integrity-0326-pg-check.sql. This file pins the
 * wiring in the app and the pure flow core.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runAuditCountFlowTests,
  countAccess,
  planScan,
  doneState,
  ownerStageControls,
  movementNote,
} from "@/lib/inventory/audit-count-flow-core";
import { buildAttentionFlags, rollupDrawers } from "@/lib/admin/cockpit-core";

const read = (p: string) => readFileSync(p, "utf8");
const MIG = read("supabase/migrations/0326_audit_count_integrity.sql");
const ACTIONS = read("src/app/admin/inventory/audits/actions.ts");
const SHEET = read("src/app/admin/inventory/audits/AuditCountSheet.tsx");
const COUNT_PAGE = read("src/app/admin/inventory/audits/[id]/count/page.tsx");
const OWNER_PAGE = read("src/app/admin/inventory/audits/[id]/page.tsx");
const REVIEW = read("src/app/admin/inventory/audits/AuditVarianceReview.tsx");
const STORE = read("src/lib/inventory/audit-hub-store.ts");
const CYCLE = read("src/app/admin/inventory/cycle-counts/page.tsx");

describe("the flow core", () => {
  it("runs its self-tests", () => {
    expect(__runAuditCountFlowTests()).toBeGreaterThanOrEqual(26);
  });
  it("D56: one counter; the owner does not count over a claim", () => {
    const claim = { status: "counting" as const, claimedBy: "a", claimedByName: "Ann" };
    expect(countAccess(claim, { staffId: "a", isOwner: false }).mode).toBe("count");
    expect(countAccess(claim, { staffId: "o", isOwner: true }).mode).toBe("locked");
  });
  it("D60 / F-06-5b: first scan adds one, a re-scan asks", () => {
    expect(planScan({ countedQty: null, recountQty: null, needsRecount: false }, false)).toEqual({ kind: "add", target: "count" });
    expect(planScan({ countedQty: 2, recountQty: null, needsRecount: false }, false).kind).toBe("ask");
  });
  it("blank blocks I'm done; zero does not", () => {
    expect(doneState([{ countedQty: null, recountQty: null, needsRecount: false }]).enabled).toBe(false);
    expect(doneState([{ countedQty: 0, recountQty: null, needsRecount: false }]).enabled).toBe(true);
  });
  it("D54: a draft offers Release; review offers Send back", () => {
    expect(ownerStageControls("draft", false)).toContain("release");
    expect(ownerStageControls("review", false)).toContain("send_back");
  });
  it("G-35: movement is named", () => {
    expect(movementNote(5, -1)).toContain("1 sold");
  });
});

describe("migration 0326", () => {
  it("routes every line write through a checked RPC and revokes direct writes", () => {
    expect(MIG).toMatch(/revoke update, delete on public\.inventory_audit_lines from authenticated/i);
    for (const fn of ["inventory_audit_claim", "inventory_audit_record_count", "inventory_audit_submit", "inventory_audit_cancel", "inventory_audit_reassign", "inventory_audit_save_reason"]) {
      expect(MIG).toContain(`function public.${fn}`);
    }
  });
  it("captures the books per lot at first count and refuses posting on movement or disagreement", () => {
    expect(MIG).toContain("books_qty_at_count");
    expect(MIG).toContain("INVENTORY_AUDIT_CUTOFF_MOVED");
    expect(MIG).toContain("INVENTORY_AUDIT_RECOUNT_DISAGREES");
  });
});

describe("the app wiring", () => {
  it("count actions carry target and mode; reasons are validated and audited old -> new", () => {
    expect(ACTIONS).toMatch(/form, "target"/);
    expect(ACTIONS).toMatch(/form, "mode"/);
    expect(ACTIONS).toContain("VARIANCE_REASONS.some(");
    expect(ACTIONS).toContain("before: result.data.before");
  });
  it("I'm done returns to Cycle Counts; cancel needs a reason", () => {
    expect(ACTIONS).toContain('redirect("/admin/inventory/cycle-counts?ok=1")');
    expect(ACTIONS).toContain("AUDIT_CANCEL_REASON");
  });
  it("the store writes lines only through RPCs", () => {
    expect(STORE).toContain('rpc("inventory_audit_record_count"');
    expect(STORE).toContain('rpc("inventory_audit_save_reason"');
    expect(STORE).toContain("USE_CANCEL");
  });
  it("the sheet: Start counting, +1 per scan, ask on re-scan, I'm done, checklist; the old sentence is gone", () => {
    expect(SHEET).toContain("claimCountAction");
    expect(SHEET).toContain("finishCountAction");
    expect(SHEET).toContain("ALREADY_COUNTED_CHOICES.map(");
    expect(SHEET).toContain("planScan(");
    expect(SHEET).toContain("buildCountChecklistFor(");
    expect(SHEET).not.toContain("Ideally a different person does it");
  });
  it("G-34: owner links on the count page are hidden from non-owners", () => {
    expect(COUNT_PAGE).toContain("isOwner ? (");
    expect(COUNT_PAGE).toContain("countAccess(");
  });
  it("owner page: release, send back, reassign, cancel; approved is green", () => {
    expect(OWNER_PAGE).toContain('value="scope_approved"');
    expect(OWNER_PAGE).toContain("Release to Cycle Counts");
    expect(OWNER_PAGE).toContain("cancelAuditAction");
    expect(OWNER_PAGE).toContain("reassignAction");
    expect(OWNER_PAGE).toContain('if (s === "approved") return "green"');
    expect(OWNER_PAGE).not.toContain("Finish counting and review the differences");
  });
  it("G-37/G-35: reasons stay editable in review; movement is shown", () => {
    expect(REVIEW).toContain("Change the reason");
    expect(REVIEW).toContain("movementNote(");
  });
  it("cycle counts: help step, claimer, Pacific times", () => {
    expect(CYCLE).toContain("press I'm done");
    expect(CYCLE).toContain("claimedByName");
    expect(CYCLE).not.toContain(".toLocaleString()");
  });
  it("D55: a finished count flags the owner's cockpit with a link to the audit", () => {
    const f = buildAttentionFlags({
      activeOrders: 0,
      lowStockCount: 0,
      drawers: rollupDrawers([]),
      publishedItems: 1,
      auditsAwaitingReview: [{ id: "x", label: "L" }],
    });
    expect(f[0]?.href).toBe("/admin/inventory/audits/x");
    expect(read("src/app/admin/page.tsx")).toContain('can(session.profile.role, "inventory.audit")');
  });
  it("docs: SOP-06 v1.2, gaps BUILT, findings FIXED, concierge taught", () => {
    const sop = read("docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md");
    expect(sop).toContain("| **Version** | 1.2");
    expect(sop).toContain("Release to Cycle Counts");
    expect(sop).not.toContain("Today there is no button that pushes a new audit");
    const gaps = read("docs/sop-program/05-GAP-REGISTER.md");
    for (const g of ["G-33", "G-34", "G-35", "G-36", "G-37"]) {
      expect(gaps).toMatch(new RegExp(`## ${g} [^\\n]*\\(BUILT`));
    }
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md").match(/Fix Phase 4\.1\u20134\.3/g)?.length).toBeGreaterThanOrEqual(14);
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Release to Cycle Counts");
    expect(read("src/lib/admin/help-content.ts")).toContain("press I'm done");
  });
});

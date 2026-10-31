/**
 * Fix Phase 4.4d — the year-end full count (G-41; owner D58).
 *
 * Owner (Q-06-5, D58): "we do a full inventory audit once per year at the end
 * of the year."
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  __runFullCountCoreTests,
  fullCountReminder,
  planFullCount,
} from "@/lib/inventory/full-count-core";
import type { AuditLot } from "@/lib/inventory/inventory-audit-core";

const read = (f: string) => readFileSync(f, "utf8");
const MIG = read("supabase/migrations/0328_full_count.sql");
const ACTIONS = read("src/app/admin/inventory/audits/full-count/actions.ts");
const PAGES = [
  "src/app/admin/inventory/audits/full-count/page.tsx",
  "src/app/admin/inventory/audits/full-count/[id]/page.tsx",
  "src/app/admin/inventory/audits/full-count/[id]/export/page.tsx",
];

const lot = (id: string, vendorName: string | null, key = `p-${id}`): AuditLot => ({
  lotId: id,
  lotCode: `L-${id}`,
  posProductKey: key,
  productName: key,
  categorySlug: "flower",
  vendorId: vendorName ? `v-${vendorName}` : null,
  vendorName,
  onHandQty: 5,
  unitCostMinorUnits: 400,
  lastCountedAt: null,
  priorVarianceCount: 0,
  status: "active",
  expiresOn: null,
});

describe("G-41 core", () => {
  it("self-test passes", () => {
    expect(__runFullCountCoreTests()).toBeGreaterThanOrEqual(30);
  });

  it("puts every lot in exactly one section and never splits a product", () => {
    const lots = [
      ...Array.from({ length: 25 }, (_, i) => lot(`a${i}`, "Alpha", `pa${Math.floor(i / 5)}`)),
      lot("b0", "Beta"),
      lot("n0", null),
    ];
    const plan = planFullCount(lots, 10);
    const all = plan.sections.flatMap((s) => s.lotIds);
    expect(all.sort()).toEqual(lots.map((l) => l.lotId).sort());
    for (let p = 0; p < 5; p++) {
      const holders = plan.sections.filter((s) => s.lotIds.some((id) => lots.find((l) => l.lotId === id)!.posProductKey === `pa${p}`));
      expect(holders.length).toBe(1);
    }
  });

  it("reminds only in December, and only when no count is planned", () => {
    expect(fullCountReminder({ todayPacific: "2026-12-02", hasCountForYear: false })).toContain("2026");
    expect(fullCountReminder({ todayPacific: "2026-12-02", hasCountForYear: true })).toBeNull();
    expect(fullCountReminder({ todayPacific: "2026-10-30", hasCountForYear: false })).toBeNull();
  });
});

describe("G-41 migration 0328", () => {
  it("adds the four columns, the all-or-none check, the section unique index and the guard", () => {
    for (const c of ["full_count_id", "full_count_year", "section_no", "section_count"]) expect(MIG).toContain(c);
    expect(MIG).toContain("inventory_audit_sessions_full_count_ck");
    expect(MIG).toContain("inventory_audit_sessions_full_count_section_uq");
    expect(MIG).toContain("FULL_COUNT_FIXED");
    expect(MIG).toContain("FULL_COUNT_ONE_PER_YEAR");
    expect(MIG).toContain("gl_factory_reset_active()");
    expect(MIG).not.toMatch(/create table/i);
  });

  it("ships a rollback and a PG check registered with the migration verifier", () => {
    expect(existsSync("supabase/rollbacks/0328_full_count.rollback.sql")).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("FULL COUNT 0328 CHECK PASSED");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0328_full_count.sql");
  });
});

describe("G-41 screens are owner only", () => {
  it("every full-count action gates on inventory.audit", () => {
    const actions = ACTIONS.match(/export async function \w+/g) ?? [];
    expect(actions.length).toBe(5);
    expect((ACTIONS.match(/requirePermission\("inventory\.audit"\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(ACTIONS).not.toContain('requirePermission("inventory.count")');
  });

  it("the planner, detail and combined work paper exist and gate on inventory.audit", () => {
    for (const p of PAGES) {
      expect(existsSync(p)).toBe(true);
      expect(read(p)).toContain('requirePermission("inventory.audit")');
    }
  });

  it("is reachable from the hub, from each section, from Plan a count, and the December cockpit flag", () => {
    expect(read("src/app/admin/inventory/audits/page.tsx")).toContain("/admin/inventory/audits/full-count");
    expect(read("src/app/admin/inventory/audits/[id]/page.tsx")).toContain("fullCountOfSession");
    expect(read("src/app/admin/inventory/audits/new/page.tsx")).toContain("/admin/inventory/audits/full-count");
    const cockpit = read("src/app/admin/page.tsx");
    expect(cockpit).toContain("fullCountReminder");
    expect(cockpit).toContain("hasFullCountForYear(Number(todayPacific.slice(0, 4))).catch(() => null)");
  });
});

describe("G-41 docs", () => {
  it("SOP-06 and the gap register record G-41 as built", () => {
    expect(read("docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md")).toContain("Fix Phase 4.4d");
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("Fix Phase 4.4d");
  });
});

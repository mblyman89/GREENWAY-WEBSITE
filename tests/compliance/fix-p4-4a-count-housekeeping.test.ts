/**
 * Fix Phase 4.4a — counting housekeeping (G-39; owner D58, D59).
 *
 * Owner, D59: "be canceled, we are not live yet. It's all test data."
 * Gap register G-39: "one count schedule used by the planner and the Issues
 * row … the Issues fix opens Plan a count for the owner and tells others to
 * tell the owner; legacy cycle-count write actions removed or refused (true
 * read-only; Q-06-6) … Pacific time on … the default audit name".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { COUNT_CADENCE_DAYS } from "@/lib/inventory/inventory-intel-core";
import { CADENCE_DAYS } from "@/lib/inventory/inventory-audit-core";
import { buildIntelIssues } from "@/lib/admin/issues-core";
import { defaultAuditLabel, pacificShortDate } from "@/lib/inventory/audit-count-flow-core";

const read = (f: string) => readFileSync(f, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const LIB = "src/lib/inventory/cycle-counts.ts";
const ACTIONS = "src/app/admin/inventory/cycle-counts/actions.ts";
const DETAIL = "src/app/admin/inventory/cycle-counts/[id]/page.tsx";

function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  const rest = src.slice(i);
  return rest.slice(0, rest.indexOf("\n}\n") + 3);
}

describe("G-39 legacy cycle counts are truly read-only (F-06-9)", () => {
  const lib = read(LIB);

  it("the three line writers refuse without opening a database client", () => {
    for (const name of ["bumpLineCount", "recordLineCount", "cancelCycleCount"]) {
      const fn = strip(fnBody(lib, name));
      expect(fn, name).toContain("cycleCountReadOnly()");
      expect(fn, name).not.toMatch(/createSupabaseAdminClient\(|\.update\(|\.insert\(|\.delete\(/);
    }
    expect(lib).toContain("CYCLE_COUNT_READ_ONLY:");
  });

  it("the writer actions are deleted, not hidden (no server-action endpoint left)", () => {
    const actions = strip(read(ACTIONS));
    for (const name of [
      "recordLineCountAction",
      "scanBumpLineAction",
      "cancelCycleCountAction",
      "previewCountSheetAction",
      "applyCountSheetAction",
    ]) {
      expect(actions, name).not.toMatch(new RegExp(`export async function ${name}\\b`));
    }
    // Every remaining export refuses (create x2, apply), each audited.
    const exportsLeft = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exportsLeft).toEqual(["applyCycleCountAction", "createCycleCountAction", "createOverdueCycleCountAction"]);
  });

  it("the detail page has no form, scanner, import or Cancel, and says it is read-only", () => {
    const page = strip(read(DETAIL));
    expect(page).not.toMatch(/<form\b/);
    expect(page).not.toMatch(/from "\.\.\/actions"/);
    expect(page).not.toMatch(/CycleCountScanner|CycleCountSheetTools|Enter count/);
    expect(read(DETAIL)).toContain('data-testid="cycle-count-read-only"');
    expect(existsSync("src/components/admin/inventory/CycleCountScanner.tsx")).toBe(false);
    expect(existsSync("src/components/admin/inventory/CycleCountSheetTools.tsx")).toBe(false);
    // Old sessions stay exportable (records kept, WAC 314-55-083(4)).
    expect(read(DETAIL)).toContain("/export?");
  });
});

describe("G-39 one count schedule (F-06-8, D58)", () => {
  it("the Issues/intel cadence equals the planner cadence for A, B and C", () => {
    for (const k of ["A", "B", "C"] as const) expect(COUNT_CADENCE_DAYS[k], k).toBe(CADENCE_DAYS[k]);
  });
  it("the panel hint is built from the table, not typed", () => {
    const panel = read("src/components/admin/inventory/InventoryIntelPanel.tsx");
    expect(panel).toContain("${COUNT_CADENCE_DAYS.B} days");
    expect(panel).not.toMatch(/\(90 days\)|\(180 days\)/);
  });
});

describe("G-39 the overdue Issues row opens Plan a count for the owner", () => {
  const center = { supply: { months: 1, overCeiling: false }, overdue: { total: 3 }, medicalInStock: 1 };
  const base = { today: "2026-10-30", lots: [], medicalEndorsement: false };
  it("owner: Plan a count", () => {
    const row = buildIntelIssues(center, { ...base, canPlanCount: true }).find((i) => i.code === "intel_count_overdue");
    expect(row?.fix).toEqual({ href: "/admin/inventory/audits/new", label: "Plan a count" });
  });
  it("everyone else: no dead link, told to tell the owner (negative control)", () => {
    const row = buildIntelIssues(center, base).find((i) => i.code === "intel_count_overdue");
    expect(row?.fix).toBeNull();
    expect(row?.fixText).toContain("Tell the owner");
  });
  it("the inventory page passes the owner permission, not a guess", () => {
    expect(read("src/app/admin/inventory/page.tsx")).toContain('canPlanCount: can(staffSession.profile.role, "inventory.audit")');
  });
});

describe("G-39 Pacific time (F-06-11)", () => {
  it("the default audit name is the store's month and year", () => {
    expect(defaultAuditLabel(new Date("2026-11-01T02:00:00Z"))).toBe("October 2026 count");
    expect(defaultAuditLabel(new Date("2026-11-01T09:00:00Z"))).toBe("November 2026 count");
  });
  it("Plan a count and the hub use the Pacific helpers", () => {
    expect(read("src/app/admin/inventory/audits/new/page.tsx")).toContain("defaultAuditLabel(new Date())");
    const hub = read("src/app/admin/inventory/audits/page.tsx");
    expect(hub).toContain("pacificShortDate(s.createdAt)");
    expect(hub).not.toContain("toLocaleDateString()");
    expect(pacificShortDate(null)).toBe("\u2014");
  });
});

describe("G-39 docs (living SOP, D41 / D42)", () => {
  it("SOP-06 v1.3, G-39 BUILT, F-06-8..11 FIXED, concierge taught", () => {
    const sop = read("docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.[3-9]/);
    expect(sop).not.toContain("\"Read only\" is only partly true");
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toMatch(/## G-39 [^\n]*\(BUILT/);
    const ledger = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(ledger.match(/Fix Phase 4\.4a/g)?.length).toBeGreaterThanOrEqual(3); // F-06-8, 9, 11 (F-06-10 cites "4.1–4.3 #1573 and 4.4a")
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Fix Phase 4.4a, G-39");
  });
});

/**
 * Fix Phase 4.4b — daily checklists in the app (G-38; owner D51, D57).
 *
 * Owner: "Checklists for daily tasks like cycle counts I initiate via the
 * inventory audit feature" · D51: "the cycle counts and daily checklists are
 * for all employees, admin, manger, sales." · D57: the task catalog, seeded
 * from SOP-06 forms 8.5–8.8.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { can } from "@/lib/auth/roles";
import {
  canEditCatalog,
  canInitial,
  canSignOff,
  checkSignOff,
  checklistPeriodKey,
  describeCountsLine,
} from "@/lib/inventory/daily-checklist-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const read = (f: string) => readFileSync(f, "utf8");
const MIG = read("supabase/migrations/0327_daily_checklists.sql");
const SOP = read("docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md");
const PAGE = read("src/app/admin/inventory/checklists/page.tsx");
const ACTIONS = read("src/app/admin/inventory/checklists/actions.ts");

type Seed = { key: string; kind: string; section: string; label: string; ref: string | null; live: string | null };
function seeds(): Seed[] {
  const out: Seed[] = [];
  const re = /\('(sop06-8\.[5-8]-\d\d)', '(\w+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (null|'(?:[^']|'')*'), \d+, (null|'cycle_counts')\)/g;
  const un = (v: string) => v.replace(/''/g, "'");
  for (const m of MIG.matchAll(re)) {
    out.push({
      key: m[1]!,
      kind: m[2]!,
      section: un(m[3]!),
      label: un(m[4]!),
      ref: m[5] === "null" ? null : un(m[5]!.slice(1, -1)),
      live: m[6] === "null" ? null : "cycle_counts",
    });
  }
  return out;
}

describe("G-38 migration 0327", () => {
  it("creates the three permanent tables with guards, staff read only", () => {
    for (const t of ["checklist_tasks", "checklist_runs", "checklist_ticks"]) {
      expect(MIG).toContain(`create table if not exists public.${t}`);
      expect(MIG).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
    for (const code of [
      "CHECKLIST_TASK_PERMANENT",
      "CHECKLIST_TASK_FIXED",
      "CHECKLIST_RUN_PERMANENT",
      "CHECKLIST_RUN_FIXED",
      "CHECKLIST_SIGNED_OFF",
      "CHECKLIST_TICK_PERMANENT",
      "CHECKLIST_WRONG_LIST",
      "MIGRATION_OUT_OF_ORDER",
    ]) {
      expect(MIG, code).toContain(code);
    }
    expect(MIG).toContain("gl_factory_reset_active()");
    expect(MIG).toContain("is_staff()");
    expect(MIG).not.toMatch(/for (insert|update|delete|all)\s+to authenticated/i);
    expect(MIG).toContain("on conflict (seed_key) where seed_key is not null do nothing");
  });

  it("seeds the 61 tasks of forms 8.5–8.8, word for word", () => {
    const s = seeds();
    expect(s).toHaveLength(61);
    const by: Record<string, number> = {};
    for (const r of s) by[r.kind] = (by[r.kind] ?? 0) + 1;
    expect(by).toEqual({ opening: 19, during: 15, closing: 11, weekly: 10, monthly: 5, yearly: 1 });
    expect(new Set(s.map((r) => r.key)).size).toBe(61);
    const forms = SOP.slice(SOP.indexOf("### 8.5 "), SOP.indexOf("## 9. "));
    for (const r of s) {
      const line = r.ref ? `[ ] ${r.label} (${r.ref})` : `[ ] ${r.label}`;
      expect(forms, r.key).toContain(line);
    }
    expect(s.filter((r) => r.live === "cycle_counts")).toHaveLength(3);
    expect(s.filter((r) => r.live).every((r) => r.label.startsWith("Cycle Counts page checked"))).toBe(true);
  });

  it("the forms no longer point at the unbuilt G-35", () => {
    const forms = SOP.slice(SOP.indexOf("### 8.5 "), SOP.indexOf("## 9. "));
    expect(forms).not.toMatch(/Until G-35/);
  });
});

describe("G-38 permissions (D51: every employee)", () => {
  it("everyone who counts initials the daily lists; managers the rest", () => {
    for (const role of ["owner", "admin", "manager", "staff"] as const) {
      expect(canInitial(role, "opening"), role).toBe(true);
      expect(canInitial(role, "closing"), role).toBe(true);
    }
    expect(canInitial("staff", "weekly")).toBe(false);
    expect(canInitial("manager", "weekly")).toBe(true);
    expect(canSignOff("staff")).toBe(false);
    expect(canSignOff("manager")).toBe(true);
    expect(canEditCatalog("manager")).toBe(false);
    expect(canEditCatalog("owner")).toBe(true);
    expect(can("staff", "inventory.count")).toBe(true);
  });

  it("page and actions gate on the server", () => {
    expect(PAGE).toContain('requirePermission("inventory.count")');
    const body = (name: string) => {
      const i = ACTIONS.indexOf(`export async function ${name}(`);
      expect(i, name).toBeGreaterThan(-1);
      return ACTIONS.slice(i, ACTIONS.indexOf("\n}\n", i));
    };
    expect(body("initialTaskAction")).toContain('requirePermission("inventory.count")');
    expect(body("initialTaskAction")).toContain("canInitial(");
    expect(body("initialTaskAction")).toContain("checklistPeriodKey(kind, pacificToday())");
    expect(body("signOffAction")).toContain('requirePermission("inventory.manage")');
    expect(body("saveTaskAction")).toContain('requirePermission("inventory.audit")');
    expect(body("addTaskAction")).toContain('requirePermission("inventory.audit")');
    for (const a of ["checklist.task_initialled", "checklist.signed_off", "checklist.task_edited", "checklist.task_added"]) {
      expect(ACTIONS, a).toContain(`"${a}"`);
    }
  });

  it("sign-off with tasks left needs a note", () => {
    expect(checkSignOff({ openTasks: 2, note: "" }).ok).toBe(false);
    expect(checkSignOff({ openTasks: 2, note: "Ran out of time, low staff" }).ok).toBe(true);
    expect(checkSignOff({ openTasks: 0, note: "" }).ok).toBe(true);
  });

  it("periods and the live counts line", () => {
    expect(checklistPeriodKey("opening", "2026-10-30")).toBe("2026-10-30");
    expect(checklistPeriodKey("weekly", "2026-10-30")).toBe("2026-10-26");
    expect(checklistPeriodKey("monthly", "2026-10-30")).toBe("2026-10-01");
    expect(checklistPeriodKey("yearly", "2026-10-30")).toBe("2026-01-01");
    expect(describeCountsLine([])).toBe("No counts waiting on Cycle Counts right now.");
    expect(PAGE).toContain('data-testid="checklist-counts-line"');
  });
});

describe("G-38 plumbing and docs", () => {
  it("nav entry for everyone who counts", () => {
    const e = adminNav.find((i) => i.href === "/admin/inventory/checklists");
    expect(e?.label).toBe("Daily Checklists");
    expect(e?.permission).toBe("inventory.count");
  });

  it("factory reset keeps the sheets", () => {
    const fr = read("src/lib/accounting/factory-reset-core.ts");
    for (const t of ["checklist_tasks", "checklist_runs", "checklist_ticks"]) expect(fr, t).toContain(`"${t}"`);
  });

  it("docs record G-38 built", () => {
    expect(SOP).toContain("### 4.23 The daily checklists (Inventory \u2192 Daily Checklists)");
    expect(SOP).toMatch(/\| 1\.4 \| 2026-10-30 \|/);
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("| SOP-06 \u00a74.23, forms 8.5\u20138.8 | **BUILT** |");
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toContain("**Status: FIXED (Fix Phase 4.4b, G-38, migration 0327).**");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0327_daily_checklists.sql");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Daily Checklists (Fix Phase 4.4b, G-38, migration 0327)");
  });
});

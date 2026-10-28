/**
 * Fix Phase 2.3 (G-03 / F-01-11 / F-02-6; owner message 4: "... then
 * over/short warnings"; owner D7: "Q6- $5. It should be an admin only screen
 * ... Who, when, how much, their reason for why it's over/ under (should be
 * required to be input for over/ under)."; D16: "yes, it applies to the
 * master as well"; D21: "only over $5").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OVER_SHORT_WARN_MINOR,
  OVER_SHORT_REASON_MAX_LEN,
  isOverShortWarning,
  checkOverShortReason,
  buildWarningRows,
  summarizeWarnings,
  parseRangeDays,
  dayMinus,
  isMissingReasonColumn,
  __runOverShortWarningCoreTests,
} from "@/lib/registers/over-short-warning-core";
import { ALL_PERMISSIONS, PERMISSION_LABELS, can } from "@/lib/auth/roles";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0315_over_short_reasons.sql");
const STORE = read("src/lib/registers/store.ts");
const SAFE_STORE = read("src/lib/registers/safe-store.ts");
const WSTORE = read("src/lib/registers/over-short-warning-store.ts");
const ACTIONS = read("src/app/admin/registers/actions.ts");
const SAFE_ACTIONS = read("src/app/admin/registers/safe/actions.ts");
const PAGE = read("src/app/admin/registers/page.tsx");
const SAFE_PAGE = read("src/app/admin/registers/safe/page.tsx");
const WPAGE = read("src/app/admin/registers/over-short/page.tsx");
const HIST = read("src/app/admin/registers/history/[id]/page.tsx");
const GRID = read("src/components/admin/registers/CountGrid.tsx");
const NAV = read("src/components/admin/admin-nav-data.ts");
const SOP1 = read("docs/sop/SOP-01-register-operations.md");
const SOP2 = read("docs/sop/SOP-02-master-till-safe.md");
const SOP3 = read("docs/sop/SOP-03-eod-close-deposit.md");
const F3 = read("docs/sop-program/03-FINDINGS-LEDGER.md");
const G5 = read("docs/sop-program/05-GAP-REGISTER.md");
const P6 = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
const C4 = read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md");
const KB = read("src/lib/admin/concierge-kb.ts");

describe("Phase 2.3 pure core", () => {
  it("self-tests pass", () => {
    const r = __runOverShortWarningCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(35);
  });
  it("$5.00 is the line: more than $5.00 is a warning (D7)", () => {
    expect(OVER_SHORT_WARN_MINOR).toBe(500);
    expect(isOverShortWarning(500)).toBe(false);
    expect(isOverShortWarning(-500)).toBe(false);
    expect(isOverShortWarning(501)).toBe(true);
    expect(isOverShortWarning(-501)).toBe(true);
    expect(isOverShortWarning(null)).toBe(false);
  });
  it("a reason is required only over $5.00 (D21)", () => {
    const blank = checkOverShortReason(-600, "   ", "This drawer");
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error).toMatch(/^This drawer is short by \$6\.00, more than \$5\.00\. .*Nothing was saved\.$/);
    expect(checkOverShortReason(-500, "")).toEqual({ ok: true, reason: null });
    expect(checkOverShortReason(900, "  gave  $10 change ")).toEqual({ ok: true, reason: "gave $10 change" });
    expect(checkOverShortReason(0, "x".repeat(OVER_SHORT_REASON_MAX_LEN + 1)).ok).toBe(false);
  });
  it("builds warning rows for drawers and the master till, newest first", () => {
    const names = (id: string | null) => (id ? `N-${id}` : "—");
    const rows = buildWarningRows(
      [
        { id: "d1", registerName: "Register 1", businessDay: "2026-10-01", overShortMinor: -700, closedBy: "a", secondCountedBy: "b", reconciledBy: "c", closedAt: "2026-10-01T20:00:00Z", reconciledAt: "2026-10-01T21:00:00Z", reason: null },
        { id: "d2", registerName: "Register 2", businessDay: "2026-10-01", overShortMinor: 400, closedBy: "a", secondCountedBy: null, reconciledBy: null, closedAt: null, reconciledAt: null, reason: null },
      ],
      [{ id: "s1", businessDay: "2026-10-02", window: "pm", varianceMinor: 1200, countedBy: "a", countedAt: "2026-10-02T22:00:00Z", reason: "miscount", notes: null }],
      names,
    );
    expect(rows.map((r) => r.key)).toEqual(["safe:s1", "drawer:d1"]);
    expect(rows[0].where).toBe("Master till · PM");
    expect(rows[1].who).toBe("N-a · second: N-b");
    expect(rows[1].signedBy).toBe("N-c");
    expect(rows[1].missingReason).toBe(true);
    expect(summarizeWarnings(rows)).toEqual({ count: 2, over: 1, short: 1, drawer: 1, masterTill: 1, missingReason: 1 });
  });
  it("range, day math and the missing-column check", () => {
    expect(parseRangeDays("90")).toBe(90);
    expect(parseRangeDays("12")).toBe(30);
    expect(parseRangeDays(null)).toBe(30);
    expect(dayMinus("2026-03-01", 1)).toBe("2026-02-28");
    expect(isMissingReasonColumn({ code: "42703" })).toBe(true);
    expect(isMissingReasonColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingReasonColumn({ code: "23505" })).toBe(false);
  });
});

describe("Phase 2.3 permission and screen (admin only, D7)", () => {
  it("registers.warnings is owner and admin only", () => {
    expect(ALL_PERMISSIONS).toContain("registers.warnings");
    expect(ALL_PERMISSIONS.filter((p) => p === "registers.warnings")).toHaveLength(1);
    expect(can("owner", "registers.warnings")).toBe(true);
    expect(can("admin", "registers.warnings")).toBe(true);
    expect(can("manager", "registers.warnings")).toBe(false);
    expect(can("staff", "registers.warnings")).toBe(false);
    expect(PERMISSION_LABELS["registers.warnings"]).toMatch(/over\/short warnings over \$5/);
  });
  it("the screen is guarded and shows who, when, how much and the reason", () => {
    expect(WPAGE).toMatch(/await requirePermission\("registers\.warnings"\)/);
    for (const col of ["When", "Who counted", "Signed off", "How much", "Reason"]) expect(WPAGE).toContain(col);
    expect(WPAGE).toMatch(/PrintButton/);
    expect(WSTORE).toMatch(/reasonsReady = false/);
  });
  it("nav entry and the Register Activity button", () => {
    expect(NAV).toMatch(/label: "Over \/ Short Warnings", href: "\/admin\/registers\/over-short", permission: "registers\.warnings"/);
    expect(PAGE).toMatch(/can\(session\.profile\.role, "registers\.warnings"\)/);
    expect(PAGE).toContain("Over / short warnings");
  });
});

describe("Phase 2.3 migration 0315", () => {
  it("adds the reason columns, idempotent, with length checks", () => {
    expect(MIG).toMatch(/add column if not exists over_short_reason text/);
    expect(MIG).toMatch(/add column if not exists over_short_reason_by uuid/);
    expect(MIG).toMatch(/add column if not exists variance_reason text/);
    expect(MIG).toMatch(/drawer_sessions_over_short_reason_len/);
    expect(MIG).toMatch(/safe_counts_variance_reason_len/);
    expect(MIG).not.toMatch(/\bdrop table\b|\bdelete from\b|\btruncate\b/i);
  });
});

describe("Phase 2.3 server checks", () => {
  it("reconcile checks the reason against the server's own figure", () => {
    expect(STORE).toMatch(/checkOverShortReason\(os, opts\.overShortReason/);
    expect(STORE).toMatch(/over_short_reason/);
    expect(ACTIONS).toMatch(/overShortReason: str\(formData, "over_short_reason"\)/);
    expect(ACTIONS).toMatch(/drawer\.reconcile_refused/);
    expect(ACTIONS).toMatch(/drawer\.over_short_warning/);
  });
  it("master till: reason over $5, Counted by required, audit linked to the row", () => {
    expect(SAFE_STORE).toMatch(/checkOverShortReason\(c\.varianceMinor/);
    expect(SAFE_STORE).toMatch(/Pick who counted the master till \(Counted by\)\. Nothing was saved\./);
    expect(SAFE_ACTIONS).toMatch(/Counted by must be an active employee\. Nothing was saved\./);
    expect(SAFE_ACTIONS).toMatch(/safe\.count_refused/);
    expect(SAFE_ACTIONS).toMatch(/safe\.over_short_warning/);
    expect(SAFE_ACTIONS).toMatch(/entityId: result\.id/);
    expect(SAFE_PAGE).toMatch(/reasonName="variance_reason"/);
    expect(SAFE_PAGE).not.toMatch(/— none —/);
  });
  it("the forms and the till summary show the reason", () => {
    expect(PAGE).toMatch(/name="over_short_reason"/);
    expect(GRID).toMatch(/reasonName/);
    expect(HIST).toMatch(/Over\/short reason/);
  });
});

describe("Phase 2.3 docs (D41 living SOP)", () => {
  it("SOP versions moved", () => {
    expect(SOP1).toMatch(/\*\*Version\*\* \| 1\.([7-9]|\d\d) /);
    expect(SOP2).toMatch(/\*\*Version\*\* \| 1\.([4-9]|\d\d) /);
    expect(SOP3).toMatch(/\*\*Version\*\* \| 1\.([4-9]|\d\d) /);
    expect(SOP1).toMatch(/Over \/ short warnings/);
  });
  it("ledgers record the fix", () => {
    expect(F3).toMatch(/F-01-11 · CONFIRMED · GAP · S2 [^\n]*· \*\*FIXED \(Phase 2\.3\)\*\*/);
    expect(F3).toMatch(/Status: PARTLY FIXED \(Phase 2\.3, G-03/);
    expect(G5).toMatch(/\| G-03 \|[^\n]*\*\*BUILT\*\* \(Phase 2\.3\) \|/);
    expect(P6).toMatch(/\| 2\.3 \| G-03 \$5 over\/short warnings/);
    expect(C4).toMatch(/Phase 2\.3 \(G-03 over\/short warnings\) answers/);
    expect(KB).toMatch(/Over \/ Short Warnings \(Phase 2\.3, owner and admin only\)/);
  });
});

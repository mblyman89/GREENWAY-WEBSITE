/**
 * Fix Phase 7.1 — Returns & Destruction (owner message 16, D117; D66, D67).
 *
 *   - G-45 (F-15-8 / F-15-10, D66 "Q4- remove it."): the back-office Customer
 *     return wizard and its actions are gone; the Sale-correction CSV download
 *     runs only when the weekly batch cannot send the corrections, and refuses
 *     (409, nothing marked) otherwise.
 *   - G-46 (F-15-13): error codes become readable sentences.
 *   - G-49 (F-15-17 / F-15-18): stale comments and the wrong CCRS citation fixed.
 *   - G-50 (D67 "Q5- reduce it to the minimum required by law."): the hold
 *     default is 0 (code + migration 0334).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dispositionErrorMessage,
  scheduleButtonLabel,
  holdPolicyText,
  correctionRouteFromSeedRead,
  correctionDownloadRefusal,
  pendingCorrectionsText,
  LEGAL_MINIMUM_HOLD_HOURS,
  __runDispositionMessagesTests,
} from "@/lib/inventory/disposition-messages-core";
import { HOLD_HOURS_DEFAULT, clampHoldHours } from "@/lib/inventory/disposition-core";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "src/app/admin/inventory/disposition/page.tsx";
const ACTIONS = "src/app/admin/inventory/disposition/actions.ts";
const ROUTE = "src/app/admin/inventory/disposition/sale-correction-export/route.ts";

describe("Fix Phase 7.1 — pure messages core", () => {
  it("self-tests pass", () => {
    const r = __runDispositionMessagesTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(46);
  });

  it("G-46: codes become sentences, free text is decoded, empty is null", () => {
    expect(dispositionErrorMessage("destroy_qty")).toMatch(/quantity greater than zero/);
    expect(dispositionErrorMessage("destroy_reason")).toMatch(/reason/);
    expect(dispositionErrorMessage("qty")).not.toBe("qty");
    expect(dispositionErrorMessage("Lot%20not%20found")).toBe("Lot not found");
    expect(dispositionErrorMessage("%E0%A4%A")).toBeTruthy(); // malformed: never throws
    expect(dispositionErrorMessage("")).toBeNull();
    expect(dispositionErrorMessage(undefined)).toBeNull();
  });

  it("G-50: the default hold is the legal minimum 0", () => {
    expect(LEGAL_MINIMUM_HOLD_HOURS).toBe(0);
    expect(HOLD_HOURS_DEFAULT).toBe(0);
    expect(clampHoldHours("x")).toBe(0);
    expect(scheduleButtonLabel(0)).toBe("Schedule");
    expect(scheduleButtonLabel(24)).toBe("Schedule (opens 24h hold)");
    expect(holdPolicyText(0)).toMatch(/no waiting period/);
    expect(holdPolicyText(0)).toMatch(/WSR 22-14-111/);
  });

  it("G-45: route decision and refusal", () => {
    expect(correctionRouteFromSeedRead({ closedSeedRows: 1 })).toBe("weekly_batch");
    expect(correctionRouteFromSeedRead({ closedSeedRows: 0 })).toBe("manual_download");
    expect(correctionRouteFromSeedRead({ closedSeedRows: 1, saleSliceMissing: true })).toBe("manual_download");
    expect(correctionRouteFromSeedRead({ closedSeedRows: null, errorCode: "42P01" })).toBe("manual_download");
    expect(correctionRouteFromSeedRead({ closedSeedRows: null, errorCode: "42501" })).toBe("unknown");
    expect(correctionRouteFromSeedRead({ closedSeedRows: null })).toBe("unknown");
    expect(correctionDownloadRefusal("manual_download")).toBeNull();
    expect(correctionDownloadRefusal("weekly_batch")).toMatch(/Nothing was marked/);
    expect(correctionDownloadRefusal("unknown")).toMatch(/Nothing was marked/);
    expect(pendingCorrectionsText(1, "weekly_batch")).toMatch(/weekly CCRS batch/);
  });
});

describe("Fix Phase 7.1 — wiring", () => {
  it("G-45: the wizard, its search core and its actions are gone", () => {
    expect(existsSync(join(ROOT, "src/components/admin/inventory/CustomerReturnWizard.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/inventory/return-search-core.ts"))).toBe(false);
    const a = src(ACTIONS);
    expect(a).not.toMatch(/createCustomerReturnAction|findReturnableLinesAction/);
    expect(a).toMatch(/D66/);
    const p = src(PAGE);
    expect(p).not.toMatch(/CustomerReturnWizard/);
    expect(p).toMatch(/data-testid="customer-return-paths"/);
    expect(p).toMatch(/\/admin\/registers\/returns/);
    expect(src("src/lib/inventory/disposition.ts")).not.toMatch(/function (searchReturnableOrderLines|findReturnableOrderLines)/);
  });

  it("G-45: the download refuses before any read or mark, and skips non-cannabis returns", () => {
    const r = src(ROUTE);
    const refuse = r.indexOf("correctionDownloadRefusal(await readCorrectionRoute())");
    expect(refuse).toBeGreaterThan(0);
    expect(r.indexOf("status: 409")).toBeGreaterThan(refuse);
    expect(r.indexOf("getCcrsLicenseSettings()")).toBeGreaterThan(refuse);
    expect(r.indexOf("markCorrectionsExported(")).toBeGreaterThan(refuse);
    expect(r).toMatch(/sale_type === "NonCannabis"\) continue/);
  });

  it("G-45: the page only links the download when it is the route", () => {
    const p = src(PAGE);
    expect(p).toMatch(/readCorrectionRoute\(\)/);
    expect(p).toMatch(/data-testid="corrections-pending"/);
    expect(p).toMatch(/correctionRoute === "manual_download"/);
    expect(p).toMatch(/pendingCorrectionsText\(/);
  });

  it("G-46: the schedule action sends codes the page can read", () => {
    const a = src(ACTIONS);
    expect(a).toMatch(/\?error=destroy_qty/);
    expect(a).toMatch(/\?error=destroy_reason/);
    const p = src(PAGE);
    expect(p).toMatch(/dispositionErrorMessage\(sp\.error\)/);
    expect(p).toMatch(/data-testid="disposition-error"/);
  });

  it("G-50: the page uses the hold helpers, not a hard-coded 72", () => {
    const p = src(PAGE);
    expect(p).toMatch(/scheduleButtonLabel\(holdHours\)/);
    expect(p).toMatch(/holdPolicyText\(holdHours\)/);
    expect(p).not.toMatch(/opens \{holdHours\}h hold/);
  });

  it("G-50: migration 0334 is deliberate (rule 15)", () => {
    const m = src("supabase/migrations/0334_destruction_hold_legal_minimum.sql");
    expect(m).toMatch(/alter column hold_hours set default 0/);
    expect(m).toMatch(/set hold_hours = 0\s+where id = true\s+and hold_hours = 72/);
    expect(m).toMatch(/NO grant changes/);
    expect(m).not.toMatch(/^\s*(grant|revoke)\b/im);
    expect(existsSync(join(ROOT, "supabase/rollbacks/0334_destruction_hold_legal_minimum.rollback.sql"))).toBe(true);
    expect(src("scripts/recon/destruction-hold-0334-pg-check.sql")).toMatch(/DESTRUCTION HOLD 0334 CHECK PASSED/);
    expect(src("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /\{ file: "scripts\/recon\/destruction-hold-0334-pg-check\.sql", mustPrint: "DESTRUCTION HOLD 0334 CHECK PASSED" \}/,
    );
    expect(src("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0334_destruction_hold_legal_minimum\.sql/);
  });

  it("G-49: stale comments and the wrong citation are corrected", () => {
    expect(src("src/lib/inventory/disposition-reasons.ts")).not.toMatch(/always require detail/);
    expect(src("src/lib/inventory/disposition-reasons.ts")).toMatch(/Table 4 DestructionReason/);
    expect(src("docs/RETURNS_DESTRUCTION_COMPLIANCE.md")).not.toMatch(/confirming `Other` \+\s+detail is the LCB-expected/);
    expect(src("src/lib/inventory/disposition.ts")).not.toMatch(/default\s+\*?\s*still 72h/);
  });
});

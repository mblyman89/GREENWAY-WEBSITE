/**
 * Slice A-06 (owner OD-40, master plan docs/accounting-bible/15-master-plan.md)
 * — the store medical endorsement switch and the register medical test-mode
 * switch on /admin/medical.
 *
 * Owner (verbatim): "I need your help adding a medical endorsement switch to the
 * back office medical page. right now its in code only, and i need a way to
 * manually set it in the back office for when i am ready to become endorsed. i
 * also want to make the test medical sales on the register to be a setting i
 * can switch on and off in the medical page. so the register can hide that
 * ability, so that real sales cant be rung in as a test medical sale."
 *
 * Pins: fail-closed resolution (RCW 69.50.375; WAC 314-55-090 — no exemption
 * without an endorsed retailer), owner-only writes, every flip audited, one
 * authority (tax_settings is a mirror), migration 0329 shipped with rollback,
 * PG check and run-list entry.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  __runEndorsementSwitchCoreTests,
  resolveEndorsement,
  validateEndorsementChange,
  ENDORSE_CONFIRM_WORD,
  EXCISE_EXEMPTION_SUNSET,
} from "@/lib/medical/endorsement-switch-core";
import { DEFAULT_MED_TAX_SETTINGS } from "@/lib/medical/tax";

const read = (p: string) => readFileSync(p, "utf8");
const T = "2027-03-15";
const ON_ROW = {
  is_medically_endorsed: true,
  endorsement_number: "ME-123",
  endorsed_effective_on: "2027-03-01",
  excise_exemption_until: "2029-06-30",
  register_test_mode_allowed: false,
};

describe("endorsement-switch-core self-tests", () => {
  it("all pass", () => {
    expect(__runEndorsementSwitchCoreTests()).toBeGreaterThan(40);
  });
});

describe("resolveEndorsement fails closed", () => {
  it("no row ⇒ not endorsed, test mode hidden", () => {
    const s = resolveEndorsement(null, T);
    expect(s.isMedicallyEndorsed).toBe(false);
    expect(s.testModeAllowed).toBe(false);
  });
  it("a fully-dated ON row whose date has arrived ⇒ endorsed", () => {
    expect(resolveEndorsement(ON_ROW, T).isMedicallyEndorsed).toBe(true);
  });
  it("the legacy 0040 seed (TRUE, no number, no date) ⇒ NOT endorsed", () => {
    const s = resolveEndorsement({ is_medically_endorsed: true, endorsement_number: null, excise_exemption_until: "2029-06-30" }, T);
    expect(s.isMedicallyEndorsed).toBe(false);
    expect(s.migrationPending).toBe(true);
  });
  it("future effective date ⇒ not endorsed yet (Pacific day compare)", () => {
    expect(resolveEndorsement({ ...ON_ROW, endorsed_effective_on: "2027-03-16" }, T).isMedicallyEndorsed).toBe(false);
    expect(resolveEndorsement({ ...ON_ROW, endorsed_effective_on: "2027-03-15" }, T).isMedicallyEndorsed).toBe(true);
  });
  it("a non-boolean truthy switch never takes tax off", () => {
    expect(resolveEndorsement({ ...ON_ROW, is_medically_endorsed: "true" }, T).isMedicallyEndorsed).toBe(false);
    expect(resolveEndorsement({ ...ON_ROW, is_medically_endorsed: 1 }, T).isMedicallyEndorsed).toBe(false);
  });
  it("test mode is offered only when allowed AND not really endorsed", () => {
    const off = { ...ON_ROW, is_medically_endorsed: false, register_test_mode_allowed: true };
    expect(resolveEndorsement(off, T).testModeAllowed).toBe(true);
    expect(resolveEndorsement({ ...ON_ROW, register_test_mode_allowed: true }, T).testModeAllowed).toBe(false);
    expect(resolveEndorsement({ ...off, register_test_mode_allowed: "yes" }, T).testModeAllowed).toBe(false);
  });
  it("the medical tax default is NOT endorsed (was true before A-06)", () => {
    expect(DEFAULT_MED_TAX_SETTINGS.medicallyEndorsed).toBe(false);
  });
});

describe("validateEndorsementChange", () => {
  const offState = resolveEndorsement({ ...ON_ROW, is_medically_endorsed: false }, T);
  const good = {
    kind: "endorsement" as const,
    on: true,
    endorsementNumber: " ME-9 ",
    effectiveOn: "2027-04-01",
    confirmWord: ENDORSE_CONFIRM_WORD,
    acknowledged: true,
  };
  it("ON needs number, date, acknowledgement and the typed word", () => {
    expect(validateEndorsementChange({ ...good, endorsementNumber: "" }, offState, T).ok).toBe(false);
    expect(validateEndorsementChange({ ...good, effectiveOn: "2027-02-30" }, offState, T).ok).toBe(false);
    expect(validateEndorsementChange({ ...good, acknowledged: false }, offState, T).ok).toBe(false);
    expect(validateEndorsementChange({ ...good, confirmWord: "endorsed" }, offState, T).ok).toBe(false);
    expect(validateEndorsementChange({ ...good, effectiveOn: "2029-07-01" }, offState, T).ok).toBe(false);
  });
  it("a valid ON writes the facts and hides register test mode", () => {
    const v = validateEndorsementChange(good, offState, T);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.write).toEqual({
        is_medically_endorsed: true,
        endorsement_number: "ME-9",
        endorsed_effective_on: "2027-04-01",
        register_test_mode_allowed: false,
      });
      expect(v.summary).toMatch(/takes effect on 2027-04-01/);
    }
  });
  it("OFF needs nothing and only puts tax back on", () => {
    const v = validateEndorsementChange({ ...good, on: false, endorsementNumber: "", confirmWord: "" }, resolveEndorsement(ON_ROW, T), T);
    expect(v.ok && v.write).toEqual({ is_medically_endorsed: false });
  });
  it("test mode cannot be made available while really endorsed", () => {
    expect(validateEndorsementChange({ kind: "test_mode", on: true }, resolveEndorsement(ON_ROW, T), T).ok).toBe(false);
    expect(validateEndorsementChange({ kind: "test_mode", on: false }, resolveEndorsement(ON_ROW, T), T).ok).toBe(true);
  });
  it("every change is refused until migration 0329 is applied", () => {
    const legacy = resolveEndorsement({ is_medically_endorsed: false, excise_exemption_until: "2029-06-30" }, T);
    const v = validateEndorsementChange({ kind: "test_mode", on: true }, legacy, T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/0329/);
  });
  it("sunset constant is the WAC 314-55-090(6) date", () => {
    expect(EXCISE_EXEMPTION_SUNSET).toBe("2029-06-30");
  });
});

describe("wiring: one fail-closed authority, owner-only, audited", () => {
  it("the server action is owner-only, validated by the core, and audited", () => {
    const src = read("src/app/admin/medical/actions.ts");
    const fn = src.slice(src.indexOf("export async function saveEndorsementSwitchAction"));
    expect(fn).toMatch(/if \(!isOwnerRole\(session\.profile\.role\)\)/);
    expect(fn).toMatch(/validateEndorsementChange\(change, before, pacificToday\(\)\)/);
    expect(fn).toMatch(/recordAudit\(/);
    expect(fn).toMatch(/"medical\.endorsement\.set"/);
    expect(fn).toMatch(/"medical\.register_test_mode\.set"/);
  });
  it("the medical page renders the switch panel", () => {
    const page = read("src/app/admin/medical/page.tsx");
    expect(page).toMatch(/<EndorsementSwitchPanel/);
    expect(page).toMatch(/isOwner=\{isOwnerRole\(session\.profile\.role\)\}/);
  });
  it("the store reads through the resolver and mirrors tax_settings", () => {
    const src = read("src/lib/medical/store.ts");
    expect(src).toMatch(/resolveEndorsement\(await readEndorsementRow\(\), pacificToday\(\)\)/);
    expect(src).toMatch(/from\("tax_settings"\)\s*\.update\(\{ medical_endorsement: write\.is_medically_endorsed \}\)/);
  });
  it("the estimator no longer defaults to endorsed", () => {
    const src = read("src/app/api/estimator/route.ts");
    expect(src).toMatch(/endorsed: endorsement\?\.isMedicallyEndorsed \?\? false/);
    expect(src).not.toMatch(/isMedicallyEndorsed \?\? true/);
  });
  it("the tax settings form cannot flip the endorsement", () => {
    expect(read("src/components/admin/settings/TaxSettingsForm.tsx")).not.toMatch(/name="medicalEndorsement"/);
    expect(read("src/app/admin/settings/actions.ts")).not.toMatch(/fd\.get\("medicalEndorsement"\)/);
    expect(read("src/lib/admin/settings-store.ts")).not.toMatch(/medical_endorsement: !!s\.medicalEndorsement/);
  });
  it("tax reports exempt only when the resolved endorsement agrees", () => {
    expect(read("src/lib/reports/tax.ts")).toMatch(/medicalEndorsement: !!data\.medical_endorsement && resolvedEndorsed/);
  });
});

describe("migration 0329 ships complete", () => {
  const mig = "supabase/migrations/0329_medical_endorsement_switch.sql";
  it("adds the dated, fail-closed columns and the owner-only policy", () => {
    const sql = read(mig);
    expect(sql).toMatch(/add column if not exists endorsed_effective_on date/);
    expect(sql).toMatch(/add column if not exists register_test_mode_allowed boolean not null default false/);
    expect(sql).toMatch(/alter column is_medically_endorsed set default false/);
    expect(sql).toMatch(/medical_endorsement_config_on_needs_facts/);
    expect(sql).toMatch(/drop policy if exists medical_endorsement_config_staff_write/);
    expect(sql).toMatch(/using \(public\.is_owner\(\)\) with check \(public\.is_owner\(\)\)/);
    expect(sql).toMatch(/update public\.tax_settings\s+set medical_endorsement = false/);
  });
  it("has a rollback, a registered PG check, and a run-list entry", () => {
    expect(existsSync("supabase/rollbacks/0329_medical_endorsement_switch.rollback.sql")).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /medical-endorsement-0329-pg-check\.sql", mustPrint: "MEDICAL 0329 CHECK PASSED"/,
    );
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0329_medical_endorsement_switch\.sql/);
  });
});

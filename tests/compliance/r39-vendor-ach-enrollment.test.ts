/**
 * R39 S4 — vendor ACH card (owner: "flagged ... that we need to get them to
 * give us their bank info, or if they opt out, a way for me to check a box").
 * Pins vendor-ach-enrollment-core to the 0258 SQL so the two never drift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runVendorAchEnrollmentTests,
  MIN_OPT_OUT_REASON_CHARS,
  optOutPayRefusal,
  patchSatisfiesConstraints,
  planVendorAchFlagChange,
  readVendorAchFlags,
  vendorAchCard,
  type VendorAchFlags,
  type VendorAchFlagPatch,
} from "@/lib/payments/vendor-ach-enrollment-core";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0258_ach_authorizations.sql"), "utf8");
const flat = SQL.replace(/\s+/g, " ");

const F = (o: Partial<VendorAchFlags> = {}): VendorAchFlags => ({
  columnsReady: true,
  needsBankInfo: false,
  optedOut: false,
  optedOutReason: null,
  optedOutAt: null,
  optedOutBy: null,
  ...o,
});
const NOW = "2026-05-01T12:00:00.000Z";

describe("0258 parity", () => {
  it("the SQL still has both CHECK constraints in the shape the core mirrors", () => {
    expect(flat).toContain(
      "(ach_opted_out and coalesce(length(trim(ach_opted_out_reason)), 0) > 0 and ach_opted_out_at is not null) or (not ach_opted_out and ach_opted_out_at is null)",
    );
    expect(flat).toContain("check (not (ach_opted_out and ach_needs_bank_info))");
  });

  it("patch keys are exactly the 0258 vendor columns", () => {
    const r = planVendorAchFlagChange({ current: F(), action: "opt_out", reason: "prefers checks", actorId: "u1", nowIso: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of Object.keys(r.patch)) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.vendors add column if not exists ${k} `));
    }
    expect(Object.keys(r.patch).sort()).toEqual(
      ["ach_needs_bank_info", "ach_opted_out", "ach_opted_out_at", "ach_opted_out_by", "ach_opted_out_reason"],
    );
  });

  it("every reachable (state, action) result satisfies both constraints (exhaustive)", () => {
    const states: VendorAchFlags[] = [
      F(),
      F({ needsBankInfo: true }),
      F({ optedOut: true, optedOutReason: "paper checks", optedOutAt: NOW, optedOutBy: "u0" }),
    ];
    const actions = ["flag_needs_info", "clear_needs_info", "opt_out", "opt_in", "nope"];
    const reasons = ["", "abcd", "prefers checks"];
    let oks = 0;
    for (const s of states)
      for (const a of actions)
        for (const reason of reasons) {
          const r = planVendorAchFlagChange({ current: s, action: a, reason, actorId: "u1", nowIso: NOW });
          if (r.ok) {
            oks += 1;
            expect(patchSatisfiesConstraints(r.patch), `${JSON.stringify(s)} ${a} ${reason}`).toBe(true);
          }
        }
    expect(oks).toBeGreaterThan(5);
  });
});

describe("patchSatisfiesConstraints is a faithful oracle", () => {
  const base: VendorAchFlagPatch = { ach_needs_bank_info: false, ach_opted_out: false, ach_opted_out_reason: null, ach_opted_out_by: null, ach_opted_out_at: null };
  it.each<[string, Partial<VendorAchFlagPatch>, boolean]>([
    ["plain", {}, true],
    ["needs only", { ach_needs_bank_info: true }, true],
    ["opted out well-formed", { ach_opted_out: true, ach_opted_out_reason: "checks", ach_opted_out_at: NOW }, true],
    ["opted out without reason", { ach_opted_out: true, ach_opted_out_at: NOW }, false],
    ["opted out blank reason", { ach_opted_out: true, ach_opted_out_reason: "   ", ach_opted_out_at: NOW }, false],
    ["opted out without time", { ach_opted_out: true, ach_opted_out_reason: "checks" }, false],
    ["time without opt out", { ach_opted_out_at: NOW }, false],
    ["both flags", { ach_needs_bank_info: true, ach_opted_out: true, ach_opted_out_reason: "checks", ach_opted_out_at: NOW }, false],
  ])("%s", (_n, o, want) => {
    expect(patchSatisfiesConstraints({ ...base, ...o })).toBe(want);
  });
});

describe("planVendorAchFlagChange", () => {
  it("opt out needs a real reason and stamps who and when, clearing needs-info", () => {
    expect(planVendorAchFlagChange({ current: F(), action: "opt_out", reason: "x".repeat(MIN_OPT_OUT_REASON_CHARS - 1), actorId: "u1", nowIso: NOW }).ok).toBe(false);
    const r = planVendorAchFlagChange({ current: F({ needsBankInfo: true }), action: "opt_out", reason: "  prefers checks  ", actorId: "u1", nowIso: NOW });
    expect(r).toEqual({
      ok: true,
      patch: { ach_needs_bank_info: false, ach_opted_out: true, ach_opted_out_reason: "prefers checks", ach_opted_out_by: "u1", ach_opted_out_at: NOW },
      summary: "Marked opted out of ACH.",
    });
  });

  it("opt in wipes the opt-out fields; needs-info stays false (it cannot be set while opted out)", () => {
    const r = planVendorAchFlagChange({ current: F({ optedOut: true, optedOutReason: "c", optedOutAt: NOW, optedOutBy: "u0" }), action: "opt_in", reason: "", actorId: "u1", nowIso: NOW });
    expect(r.ok && r.patch).toEqual({ ach_needs_bank_info: false, ach_opted_out: false, ach_opted_out_reason: null, ach_opted_out_by: null, ach_opted_out_at: null });
  });

  it("flag / clear needs-info keep an existing opt-out untouched only when opted out", () => {
    const r = planVendorAchFlagChange({ current: F(), action: "flag_needs_info", reason: "", actorId: "u1", nowIso: NOW });
    expect(r.ok && r.patch).toEqual({ ach_needs_bank_info: true, ach_opted_out: false, ach_opted_out_reason: null, ach_opted_out_by: null, ach_opted_out_at: null });
    // A stale reason left on a not-opted-out row is cleaned, never carried.
    const r2 = planVendorAchFlagChange({ current: F({ needsBankInfo: true, optedOutReason: "stale" }), action: "clear_needs_info", reason: "", actorId: "u1", nowIso: NOW });
    expect(r2.ok && r2.patch.ach_opted_out_reason).toBe(null);
  });

  it("refuses before 0258, unknown actions, repeats and contradictions", () => {
    const bad: [VendorAchFlags, string][] = [
      [F({ columnsReady: false }), "flag_needs_info"],
      [F(), "archive"],
      [F({ needsBankInfo: true }), "flag_needs_info"],
      [F(), "clear_needs_info"],
      [F({ optedOut: true, optedOutReason: "c", optedOutAt: NOW }), "opt_out"],
      [F({ optedOut: true, optedOutReason: "c", optedOutAt: NOW }), "flag_needs_info"],
      [F(), "opt_in"],
    ];
    for (const [cur, action] of bad) {
      expect(planVendorAchFlagChange({ current: cur, action, reason: "prefers checks", actorId: "u1", nowIso: NOW }).ok, action).toBe(false);
    }
  });
});

describe("vendorAchCard", () => {
  it("matches the owner's three asks: flag, opted-out box, shown on the page", () => {
    expect(vendorAchCard(F({ needsBankInfo: true }), { hasRecord: false, status: null, verifiedAt: null })).toMatchObject({ state: "needs_bank_info", tone: "orange", followUp: true });
    expect(vendorAchCard(F({ optedOut: true, optedOutReason: "checks" }), { hasRecord: false, status: null, verifiedAt: null })).toMatchObject({ state: "opted_out", actions: ["opt_in"], followUp: false });
    expect(vendorAchCard(F(), { hasRecord: false, status: null, verifiedAt: null })).toMatchObject({ state: "not_set_up", actions: ["flag_needs_info", "opt_out"] });
  });

  it("only active+verified is ready; every other vault status needs follow-up", () => {
    const v = (status: string, verifiedAt: string | null = NOW) => vendorAchCard(F(), { hasRecord: true, status, verifiedAt });
    expect(v("active").state).toBe("ready");
    expect(v("active", null).state).toBe("unverified");
    expect(v("on_hold").state).toBe("on_hold");
    expect(v("revoked").state).toBe("inactive");
    expect(v("archived").state).toBe("inactive");
    expect(v("ACTIVE").state).toBe("blocked_unknown");
    for (const s of ["on_hold", "revoked", "archived", "x"]) expect(v(s).followUp).toBe(true);
    expect(v("active").followUp).toBe(false);
  });

  it("warns when the flags disagree with the vault", () => {
    const active = { hasRecord: true, status: "active", verifiedAt: NOW };
    expect(vendorAchCard(F({ optedOut: true, optedOutReason: "c" }), active).warnings[0]).toMatch(/opted out, but an ACTIVE bank record/);
    expect(vendorAchCard(F({ needsBankInfo: true }), active).warnings[0]).toMatch(/already in the vault/);
    expect(vendorAchCard(F(), active).warnings).toEqual([]);
  });

  it("never prints a bank number (the card takes none)", () => {
    const card = vendorAchCard(F(), { hasRecord: true, status: "active", verifiedAt: NOW });
    expect(JSON.stringify(card)).not.toMatch(/\d{5,}/);
  });
});

describe("readVendorAchFlags / optOutPayRefusal", () => {
  it("detects missing columns from select * and only trusts real booleans", () => {
    expect(readVendorAchFlags({ id: "v" }).columnsReady).toBe(false);
    // Both columns must be present; half-applied is not ready.
    expect(readVendorAchFlags({ ach_needs_bank_info: false }).columnsReady).toBe(false);
    expect(readVendorAchFlags({ ach_opted_out: false }).columnsReady).toBe(false);
    expect(readVendorAchFlags({ ach_needs_bank_info: "yes", ach_opted_out: false }).needsBankInfo).toBe(false);
    expect(readVendorAchFlags({ ach_needs_bank_info: true, ach_opted_out: false, ach_opted_out_reason: "r", ach_opted_out_at: NOW, ach_opted_out_by: "u" })).toEqual({
      columnsReady: true, needsBankInfo: true, optedOut: false, optedOutReason: "r", optedOutAt: NOW, optedOutBy: "u",
    });
  });
  it("opted-out vendors are refused at pay time with the reason", () => {
    expect(optOutPayRefusal(F(), "Acme")).toBeNull();
    expect(optOutPayRefusal(F({ optedOut: true, optedOutReason: "checks" }), "Acme")).toMatch(/^Acme opted out of ACH \(checks\)/);
  });
});

describe("embedded self-tests", () => {
  it("all pass with the floor", () => {
    const r = __runVendorAchEnrollmentTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(46);
  });
});

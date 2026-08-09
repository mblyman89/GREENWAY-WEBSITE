/**
 * tests/compliance/plaid-core.test.ts  (SLICE P1)
 *
 * Vitest mirror for the Plaid pure core. Pins the money boundary (Plaid dollars
 * → integer CENTS with sign PRESERVED — standing rule + Plaid's positive=outflow
 * convention), account-role validation, the item-status → plain-English mapper,
 * and the idempotent transaction merge planner (added/modified/removed +
 * pending→posted).
 */
import { describe, expect, it } from "vitest";
import {
  plaidDollarsToCents,
  validateAccountRole,
  mapItemStatus,
  normalizeTxn,
  planTransactionMerge,
  __runPlaidCoreTests,
} from "@/lib/plaid/plaid-core";

describe("plaidDollarsToCents (money boundary — integer cents, sign preserved)", () => {
  it("converts positive dollars to cents", () => {
    expect(plaidDollarsToCents(19.99)).toBe(1999);
    expect(plaidDollarsToCents(0)).toBe(0);
    expect(plaidDollarsToCents(1234.5)).toBe(123450);
    expect(plaidDollarsToCents("12.34")).toBe(1234);
  });
  it("PRESERVES the sign (negative = inflow/credit in Plaid)", () => {
    expect(plaidDollarsToCents(-50)).toBe(-5000);
    expect(plaidDollarsToCents(-12.005)).toBe(-1201);
  });
  it("rounds half away from zero with float-error epsilon", () => {
    expect(plaidDollarsToCents(12.005)).toBe(1201);
    expect(plaidDollarsToCents(10.005)).toBe(1001);
  });
  it("returns null for junk / non-finite / empty", () => {
    expect(plaidDollarsToCents(null)).toBeNull();
    expect(plaidDollarsToCents(undefined)).toBeNull();
    expect(plaidDollarsToCents("")).toBeNull();
    expect(plaidDollarsToCents("abc")).toBeNull();
    expect(plaidDollarsToCents(NaN)).toBeNull();
    expect(plaidDollarsToCents(Infinity)).toBeNull();
  });
});

describe("validateAccountRole", () => {
  it("accepts the three canonical roles (case-insensitive)", () => {
    expect(validateAccountRole("main")).toEqual({ ok: true, role: "main" });
    expect(validateAccountRole("ATM")).toEqual({ ok: true, role: "atm" });
    expect(validateAccountRole("credit")).toEqual({ ok: true, role: "credit" });
  });
  it("treats empty/none/null as unassigned (role null)", () => {
    expect(validateAccountRole("")).toEqual({ ok: true, role: null });
    expect(validateAccountRole("none")).toEqual({ ok: true, role: null });
    expect(validateAccountRole(null)).toEqual({ ok: true, role: null });
  });
  it("rejects unknown roles with a friendly error", () => {
    const r = validateAccountRole("savings");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("savings");
  });
});

describe("mapItemStatus (error_code → status + plain English)", () => {
  it("null → healthy, no user action", () => {
    const s = mapItemStatus(null);
    expect(s.status).toBe("healthy");
    expect(s.needsUserAction).toBe(false);
  });
  it("ITEM_LOGIN_REQUIRED → login_required + needs action (case-insensitive)", () => {
    expect(mapItemStatus("ITEM_LOGIN_REQUIRED").status).toBe("login_required");
    expect(mapItemStatus("item_login_required").status).toBe("login_required");
    expect(mapItemStatus("ITEM_LOGIN_REQUIRED").needsUserAction).toBe(true);
  });
  it("PENDING_DISCONNECT → pending_disconnect + needs action", () => {
    const s = mapItemStatus("PENDING_DISCONNECT");
    expect(s.status).toBe("pending_disconnect");
    expect(s.needsUserAction).toBe(true);
  });
  it("institution outage → error, no user action", () => {
    const s = mapItemStatus("INSTITUTION_DOWN");
    expect(s.status).toBe("error");
    expect(s.needsUserAction).toBe(false);
  });
  it("unknown code → error and echoes the code", () => {
    const s = mapItemStatus("SOME_NEW_CODE");
    expect(s.status).toBe("error");
    expect(s.message).toContain("SOME_NEW_CODE");
  });
});

describe("normalizeTxn / planTransactionMerge (idempotent merge)", () => {
  const added = {
    transaction_id: "txn_1",
    account_id: "acc_1",
    amount: 19.99,
    date: "2026-01-05",
    name: "Coffee",
    merchant_name: "Cafe",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
    pending: true,
    payment_channel: "in store",
  };

  it("normalizes a good row to cents + retains raw", () => {
    const n = normalizeTxn(added);
    expect(n.ok).toBe(true);
    if (n.ok) {
      expect(n.row.amount_cents).toBe(1999);
      expect(n.row.personal_finance_category_primary).toBe("FOOD_AND_DRINK");
      expect(n.row.raw).toBe(added);
    }
  });

  it("skips rows with a bad amount or missing id", () => {
    expect(normalizeTxn({ transaction_id: "x", account_id: "a", amount: NaN, date: "d" }).ok).toBe(false);
    expect(normalizeTxn({ transaction_id: "", account_id: "a", amount: 1, date: "d" }).ok).toBe(false);
  });

  it("builds an idempotent plan: added+modified → upserts, removed → removals", () => {
    const plan = planTransactionMerge({
      added: [added],
      modified: [
        { ...added, pending: false }, // pending → posted (same id, handled by upsert)
        { transaction_id: "txn_2", account_id: "acc_1", amount: -50, date: "2026-01-06" },
      ],
      removed: [{ transaction_id: "txn_9" }, { transaction_id: "" }],
    });
    expect(plan.upserts).toHaveLength(3);
    expect(plan.upserts.some((u) => u.transaction_id === "txn_1" && u.pending === false)).toBe(true);
    expect(plan.upserts.some((u) => u.transaction_id === "txn_2" && u.amount_cents === -5000)).toBe(true);
    expect(plan.removals).toEqual(["txn_9"]); // blank id filtered out
    expect(plan.skipped).toHaveLength(0);
  });

  it("records unparseable rows in skipped rather than dropping silently", () => {
    const plan = planTransactionMerge({
      added: [{ transaction_id: "t", account_id: "a", amount: Infinity, date: "2026-01-05" }],
    });
    expect(plan.skipped).toHaveLength(1);
    expect(plan.upserts).toHaveLength(0);
  });
});

describe("self-test harness parity", () => {
  it("__runPlaidCoreTests passes", () => {
    expect(() => __runPlaidCoreTests()).not.toThrow();
  });
});

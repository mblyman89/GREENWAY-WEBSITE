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
  validateRoleAssignment,
  normalizeCustomRoleKey,
  MAX_CUSTOM_ROLE_LEN,
  mapItemStatus,
  normalizeTxn,
  planTransactionMerge,
  extractPlaidError,
  describeLinkTokenCode,
  describeLinkTokenError,
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
  it("accepts the canonical roles (case-insensitive)", () => {
    expect(validateAccountRole("main")).toEqual({ ok: true, role: "main" });
    expect(validateAccountRole("ATM")).toEqual({ ok: true, role: "atm" });
    expect(validateAccountRole("credit")).toEqual({ ok: true, role: "credit" });
    expect(validateAccountRole("savings")).toEqual({ ok: true, role: "savings" });
    expect(validateAccountRole("reserve")).toEqual({ ok: true, role: "reserve" });
    expect(validateAccountRole("mortgage")).toEqual({ ok: true, role: "mortgage" });
    expect(validateAccountRole("loan")).toEqual({ ok: true, role: "loan" });
    expect(validateAccountRole("PERSONAL")).toEqual({ ok: true, role: "personal" });
  });
  it("treats empty/none/null as unassigned (role null)", () => {
    expect(validateAccountRole("")).toEqual({ ok: true, role: null });
    expect(validateAccountRole("none")).toEqual({ ok: true, role: null });
    expect(validateAccountRole(null)).toEqual({ ok: true, role: null });
  });
  it("rejects unknown roles with a friendly error", () => {
    const r = validateAccountRole("banana");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("banana");
  });
});

describe("normalizeCustomRoleKey", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeCustomRoleKey("  Escrow  ")).toBe("escrow");
    expect(normalizeCustomRoleKey("petty   cash")).toBe("petty cash");
  });
  it("keeps hyphen/underscore, strips other punctuation to space", () => {
    expect(normalizeCustomRoleKey("tax-hold_2")).toBe("tax-hold_2");
    expect(normalizeCustomRoleKey("land!!lord")).toBe("land lord");
  });
  it("returns null for empty/punctuation-only/null", () => {
    expect(normalizeCustomRoleKey("")).toBeNull();
    expect(normalizeCustomRoleKey("!!!")).toBeNull();
    expect(normalizeCustomRoleKey(null)).toBeNull();
  });
  it("caps at MAX_CUSTOM_ROLE_LEN", () => {
    expect(normalizeCustomRoleKey("a".repeat(50))?.length).toBe(MAX_CUSTOM_ROLE_LEN);
  });
});

describe("validateRoleAssignment (canonical OR custom)", () => {
  it("treats empty/none as unassigned", () => {
    expect(validateRoleAssignment("")).toEqual({ ok: true, role: null, isCustom: false });
    expect(validateRoleAssignment("none")).toEqual({ ok: true, role: null, isCustom: false });
  });
  it("maps built-in names (case-insensitive) to canonical, not custom", () => {
    expect(validateRoleAssignment("MAIN")).toEqual({ ok: true, role: "main", isCustom: false });
    expect(validateRoleAssignment("personal")).toEqual({ ok: true, role: "personal", isCustom: false });
  });
  it("accepts a typed custom name (normalized) as custom", () => {
    expect(validateRoleAssignment("Escrow")).toEqual({ ok: true, role: "escrow", isCustom: true });
    expect(validateRoleAssignment("Petty   Cash")).toEqual({ ok: true, role: "petty cash", isCustom: true });
  });
  it("rejects a name with no usable characters", () => {
    expect(validateRoleAssignment("###").ok).toBe(false);
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

describe("extractPlaidError (reads code/message/display/type/request_id, null-safe)", () => {
  it("reads every field from a Plaid axios error body", () => {
    const e = extractPlaidError({
      response: {
        data: {
          error_type: "INVALID_INPUT",
          error_code: "UNAUTHORIZED_ENVIRONMENT",
          error_message: "you are not authorized to create items in this api environment.",
          display_message: null,
          request_id: "HNTDNrA8F1shFEW",
        },
      },
    });
    expect(e.type).toBe("INVALID_INPUT");
    expect(e.code).toBe("UNAUTHORIZED_ENVIRONMENT");
    expect(e.message).toContain("not authorized");
    expect(e.requestId).toBe("HNTDNrA8F1shFEW");
  });
  it("missing body / null input \u2192 all null (never throws)", () => {
    expect(extractPlaidError(new Error("network"))).toEqual({ code: null, message: null, display: null, type: null, requestId: null });
    expect(extractPlaidError(null)).toEqual({ code: null, message: null, display: null, type: null, requestId: null });
  });
  it("blank strings \u2192 null", () => {
    const e = extractPlaidError({ response: { data: { error_code: "   ", request_id: "  " } } });
    expect(e.code).toBeNull();
    expect(e.requestId).toBeNull();
  });
});

describe("describeLinkTokenCode / describeLinkTokenError (distinct causes, safe tail)", () => {
  it("does NOT collapse INVALID_API_KEYS and UNAUTHORIZED_ENVIRONMENT into one message", () => {
    expect(describeLinkTokenCode("INVALID_API_KEYS")).not.toBe(describeLinkTokenCode("UNAUTHORIZED_ENVIRONMENT"));
  });
  it("UNAUTHORIZED_ENVIRONMENT points at Production approval", () => {
    const s = describeLinkTokenCode("UNAUTHORIZED_ENVIRONMENT").toLowerCase();
    expect(s).toContain("production");
    expect(s).toContain("approved");
  });
  it("INVALID_API_KEYS points at secret + redeploy", () => {
    const s = describeLinkTokenCode("INVALID_API_KEYS").toLowerCase();
    expect(s).toContain("secret");
    expect(s).toContain("redeploy");
  });
  it("is case-insensitive and echoes unknown codes", () => {
    expect(describeLinkTokenCode("unauthorized_environment").toLowerCase()).toContain("production");
    expect(describeLinkTokenCode("SOME_FUTURE_CODE")).toContain("SOME_FUTURE_CODE");
  });
  it("appends a safe [code \u00b7 request_id] tail when given full info", () => {
    const s = describeLinkTokenError({ code: "UNAUTHORIZED_ENVIRONMENT", message: null, display: null, type: "INVALID_INPUT", requestId: "REQ123" });
    expect(s).toContain("UNAUTHORIZED_ENVIRONMENT");
    expect(s).toContain("request_id: REQ123");
  });
  it("no tail when there is no code or request_id", () => {
    const s = describeLinkTokenError({ code: null, message: null, display: null, type: null, requestId: null });
    expect(s).not.toContain("[");
  });
  it("bare code string still works (back-compat)", () => {
    expect(describeLinkTokenError("UNAUTHORIZED_ENVIRONMENT").toLowerCase()).toContain("production");
  });
});

describe("self-test harness parity", () => {
  it("__runPlaidCoreTests passes", () => {
    expect(() => __runPlaidCoreTests()).not.toThrow();
  });
});

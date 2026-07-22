/**
 * GW-011 + GW-012 — completion races and lost inventory updates.
 * Mirrors the embedded self-tests in status-cas-core.ts and
 * rpc-fallback-core.ts, and adds edge cases.
 */

import { describe, expect, it } from "vitest";

import { classifyStatusCasMiss, __runStatusCasCoreTests } from "@/lib/orders/status-cas-core";
import {
  isMissingDbFunctionError,
  isUniqueViolation,
  __runRpcFallbackCoreTests,
} from "@/lib/db/rpc-fallback-core";

describe("status-cas-core (GW-011)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runStatusCasCoreTests()).not.toThrow();
  });

  it("a raced transition to the SAME status converges (success, no side effects)", () => {
    expect(classifyStatusCasMiss("completed", "completed")).toEqual({ kind: "converged" });
  });

  it("a raced transition to a DIFFERENT status is a conflict naming the current state", () => {
    const v = classifyStatusCasMiss("completed", "cancelled");
    expect(v.kind).toBe("conflict");
    if (v.kind === "conflict") {
      expect(v.refusal).toContain('"cancelled"');
      expect(v.refusal.toLowerCase()).toContain("refresh");
    }
  });

  it("a vanished order is a conflict with an explicit message", () => {
    const v = classifyStatusCasMiss("ready", null);
    expect(v.kind).toBe("conflict");
    if (v.kind === "conflict") expect(v.refusal.toLowerCase()).toContain("could not be found");
  });

  it("every non-matching current status conflicts — never a silent success", () => {
    for (const current of ["new", "acknowledged", "preparing", "ready", "no_show"] as const) {
      expect(classifyStatusCasMiss("completed", current).kind).toBe("conflict");
    }
  });
});

describe("rpc-fallback-core (GW-012)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runRpcFallbackCoreTests()).not.toThrow();
  });

  it("recognises a missing DB function by PostgREST code, Postgres code, and message", () => {
    expect(isMissingDbFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingDbFunctionError({ code: "42883" })).toBe(true);
    expect(
      isMissingDbFunctionError({
        message: "Could not find the function public.apply_lot_delta(p_delta, p_lot_id) in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingDbFunctionError({ message: "function public.apply_variant_delta(uuid, integer) does not exist" }),
    ).toBe(true);
  });

  it("never mistakes real errors for a missing migration", () => {
    expect(isMissingDbFunctionError({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isMissingDbFunctionError({ code: "42501", message: "permission denied for function apply_lot_delta" })).toBe(false);
    expect(isMissingDbFunctionError({ message: 'column "nope" does not exist' })).toBe(false);
    expect(isMissingDbFunctionError(null)).toBe(false);
    expect(isMissingDbFunctionError({})).toBe(false);
  });

  it("recognises a unique violation by code and by message", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(
      isUniqueViolation({ message: 'duplicate key value violates unique constraint "loyalty_ledger_earn_once_uniq"' }),
    ).toBe(true);
    expect(isUniqueViolation({ code: "PGRST202" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

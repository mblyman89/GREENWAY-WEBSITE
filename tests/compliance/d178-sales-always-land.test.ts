/**
 * D178 S1 — "Sales always land".
 *
 * Owner: "if product left the shop and money was given to me in exchange,
 * there can be no manual exceptions." / "For the two sales that already
 * happened, they can be recorded as rung."
 *
 * Pure-core behaviour plus source pins: uniform order_lines keys (the root
 * cause of the stuck $40.90 loyalty sale), receipt-is-truth discount drift,
 * the retry/record-as-rung store + action + page, the cron cadence, and the
 * replay being dated when the money moved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runExceptionRetryTests,
  classifyExceptionReason,
  lineLoyaltyMinor,
  lineUnitGrams,
  replayCompletedAtIso,
  retryDecision,
  specialRateVerdict,
  uniformLineKeys,
  AUTO_RETRY_MAX_ATTEMPTS,
} from "@/lib/pos/exception-retry-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D178 S1 — pure core", () => {
  it("self-tests all pass", () => {
    expect(__runExceptionRetryTests()).toBeGreaterThanOrEqual(35);
  });

  it("every order line carries the same keys, so PostgREST never nulls a NOT NULL column", () => {
    const sale = [{ cut: 250 }, { cut: undefined }, { cut: 0 }];
    const rows = sale.map((l, i) => ({ i, loyalty_discount_minor_units: lineLoyaltyMinor(true, l.cut), unit_grams: lineUnitGrams(undefined) }));
    expect(uniformLineKeys(rows)).toBe(true);
    expect(rows.map((r) => r.loyalty_discount_minor_units)).toEqual([250, 0, 0]);
    expect(rows.every((r) => r.unit_grams === null)).toBe(true);
  });

  it("the stuck loyalty sale is a system fault the cron retries", () => {
    const c = classifyExceptionReason(
      'Order lines insert failed: null value in column "loyalty_discount_minor_units" of relation "order_lines" violates not-null constraint.',
    );
    expect(c.kind).toBe("system_fault");
    expect(c.autoRetry).toBe(true);
  });

  it("the veteran sale (register 15%, saved 20%) is recorded as rung — the customer got less off", () => {
    expect(specialRateVerdict(1500, 2000, false)).toMatchObject({ kind: "as_rung", why: "lower_than_saved" });
    const c = classifyExceptionReason("The veteran discount rate changed (register applied 1500 bps; the saved rate is 2000 bps).");
    expect(c.kind).toBe("receipt_drift");
  });

  it("more off than allowed is refused unless the owner accepts it (fraud triangle)", () => {
    expect(specialRateVerdict(3000, 2000, false).kind).toBe("refuse");
    const row = {
      status: "exception",
      eventType: "sale",
      orderId: null,
      exceptionReason: "discount rate changed (register applied 3000 bps; the saved rate is 2000 bps)",
      resolvedAt: null,
      recoveryAttempts: 0,
    };
    expect(retryDecision(row, "record_as_rung", "manager").ok).toBe(false);
    expect(retryDecision(row, "record_as_rung", "owner").ok).toBe(true);
  });

  it("the law is never forced, by anyone", () => {
    const row = {
      status: "exception",
      eventType: "sale",
      orderId: null,
      exceptionReason: "Completion gate refused the synced sale: Sale blocked outside sales hours.",
      resolvedAt: null,
      recoveryAttempts: 0,
    };
    for (const actor of ["cron", "manager", "owner"] as const) {
      expect(retryDecision(row, "retry", actor).ok).toBe(false);
      expect(retryDecision(row, "record_as_rung", actor).ok).toBe(false);
    }
  });

  it("the cron gives up after the cap and never touches a reviewed row", () => {
    const row = {
      status: "exception",
      eventType: "sale",
      orderId: null,
      exceptionReason: "Order lines insert failed: x",
      resolvedAt: null,
      recoveryAttempts: AUTO_RETRY_MAX_ATTEMPTS,
    };
    expect(retryDecision(row, "retry", "cron").ok).toBe(false);
    expect(retryDecision({ ...row, recoveryAttempts: 0, resolvedAt: "2026-11-02T00:00:00Z" }, "retry", "cron").ok).toBe(false);
    expect(retryDecision({ ...row, recoveryAttempts: 0 }, "retry", "cron").ok).toBe(true);
  });

  it("a replayed sale is dated when the money moved", () => {
    const now = Date.parse("2026-11-05T20:00:00Z");
    expect(replayCompletedAtIso("2026-11-04T04:37:18.306Z", now)).toBe("2026-11-04T04:37:18.306Z");
    expect(replayCompletedAtIso("2099-01-01T00:00:00Z", now)).toBe(new Date(now).toISOString());
  });
});

describe("D178 S1 — wiring pins", () => {
  const sync = read("src/lib/pos/sync-store.ts");

  it("buildLineRows no longer spreads the loyalty column onto only some rows", () => {
    expect(sync).toContain("loyalty_discount_minor_units: lineLoyaltyMinor(redemptionRow !== null, l.loyaltyDiscountMinor)");
    expect(sync).not.toMatch(/redemptionRow && l\.loyaltyDiscountMinor\s*\?\s*\{ loyalty_discount_minor_units/);
    expect(sync).toContain("unit_grams: lineUnitGrams(l.unitGrams)");
  });

  it("the special-discount rate check uses the receipt-is-truth verdict and audits it", () => {
    expect(sync).toContain("specialRateVerdict(sd.percentBps, program.percentBps, replay.acceptAsRung === true)");
    expect(sync).toContain('action: "register.special_rate_as_rung"');
  });

  it("the sale is completed at occurredAt (CCRS SaleDate / excise / books day)", () => {
    expect(sync).toContain("completedAtIso: replayCompletedAtIso(envelope.occurredAt, Date.now())");
    const orders = read("src/lib/orders/orders-store.ts");
    expect(orders).toContain('if (toStatus === "completed") patch.completed_at = opts.completedAtIso ?? now;');
  });

  it("retry claims the row by compare-and-swap before running", () => {
    expect(sync).toMatch(/export async function retryPosException[\s\S]*?\.eq\("status", "exception"\)\s*\n\s*\.is\("order_id", null\)/);
    expect(sync).toContain("export async function runExceptionAutoRetry");
  });

  it("the action gates record-as-rung on the owner permission and the page uses busy buttons", () => {
    const act = read("src/app/admin/registers/exceptions/actions.ts");
    expect(act).toContain('can(session.profile.role, "registers.warnings")');
    expect(act).toContain("export async function retryPosExceptionAction");
    const page = read("src/app/admin/registers/exceptions/page.tsx");
    expect(page).toContain("Record as rung (receipt is the truth)");
    expect(page).toContain("Retry this sale");
    expect(page).toContain("Reviewed but never recorded");
    expect(page).toContain("PendingSubmit");
  });

  it("the cron is declared every 5 minutes and pinned in the cadence map and AGENTS rule 12", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.find((c) => c.path === "/api/cron/exception-retry")?.schedule).toBe("3-59/5 * * * *");
    expect(read("tests/compliance/leafly-certification.test.ts")).toContain('"/api/cron/exception-retry": 288');
    expect(read("AGENTS.md")).toContain("`exception-retry` every 5 min at `3-59/5 * * * *`");
    const route = read("src/app/api/cron/exception-retry/route.ts");
    expect(route).toContain("shouldRefuseWhenSecretMissing");
    expect(route).toContain("runExceptionAutoRetry");
  });
});

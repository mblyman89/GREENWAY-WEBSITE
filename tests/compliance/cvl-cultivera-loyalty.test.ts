/**
 * Vitest mirror of cultivera-loyalty-core (CVL): the owner asked the fetcher to
 * crawl every Cultivera customer record for loyalty earned / spent / current
 * and apply it to our customers. Locks the money math, the "record balance
 * wins" rule, the drafts-only preview, and the migration's grants.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APPLY_BATCH_SIZE,
  applyBatches,
  buildApplyRows,
  crawlSummary,
  dollarsToMinor,
  historyBalance,
  openingPoints,
  parseApplyResult,
  parseLoyaltyJsonl,
  previewApply,
  sumResults,
  __runCultiveraLoyaltyCoreTests,
} from "@/lib/customers/cultivera-loyalty-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("cultivera-loyalty-core", () => {
  it("passes its embedded pure self-tests", () => {
    const r = __runCultiveraLoyaltyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(26);
  });

  it("converts dollars to cents without float drift", () => {
    expect(dollarsToMinor(1.005)).toBe(101);
    expect(dollarsToMinor(-2.5)).toBe(-250);
    expect(dollarsToMinor(0)).toBe(0);
  });

  it("credits whole, never-negative opening points", () => {
    expect(openingPoints(509.13)).toBe(509);
    expect(openingPoints(-4)).toBe(0);
    expect(openingPoints(Number.NaN)).toBe(0);
  });

  it("uses the record balance, and only SHOWS a history mismatch", () => {
    const accrual = { customers: { "2322": { rows: 3, earnedOrders: 577.23, initial: 0, adjusted: 0, applied: 0, cancelled: 0, returned: 0 } } };
    const { rows, problems } = buildApplyRows([{ Id: 2322, LoyaltyPoints: 509.13, LoyaltyPointsApplied: 68.1, LoyaltyAmountApplied: 6.81 }], accrual);
    expect(problems).toEqual([]);
    expect(rows[0].balance).toBe(509.13);
    expect(rows[0].spent_minor).toBe(681);
    expect(rows[0].opening_points).toBe(509);
    expect(historyBalance(accrual.customers["2322"])).toBe(577.23);
    const p = previewApply(rows, new Set(["2322"]), new Set(), [], accrual);
    expect(p.historyDiffers).toBe(1);
    expect(p.toCredit).toBe(1);
    expect(p.pointsToCredit).toBe(509);
  });

  it("lists records with no balance instead of guessing, and skips duplicates", () => {
    const { rows, problems, duplicates } = buildApplyRows(
      [{ Id: 1, LoyaltyPoints: 5 }, { Id: 1, LoyaltyPoints: 5 }, { Id: 2 } as never, { Id: 0, LoyaltyPoints: 1 }],
      null,
    );
    expect(rows.length).toBe(1);
    expect(duplicates).toBe(1);
    expect(problems.length).toBe(2);
  });

  it("previews already-credited and unmatched customers", () => {
    const { rows } = buildApplyRows([{ Id: 1, LoyaltyPoints: 10 }, { Id: 2, LoyaltyPoints: 20 }, { Id: 3, LoyaltyPoints: 0 }, { Id: 4, LoyaltyPoints: 4 }], null);
    const p = previewApply(rows, new Set(["1", "2", "3"]), new Set(["2"]));
    expect(p).toMatchObject({ matched: 3, unmatched: 1, toCredit: 1, alreadyCredited: 1, zeroBalance: 1 });
  });

  it("batches only our customers within the function limit", () => {
    const recs = Array.from({ length: 1201 }, (_, i) => ({ Id: i + 1, LoyaltyPoints: 1 }));
    const { rows } = buildApplyRows(recs, null);
    const ours = new Set(rows.slice(0, 1100).map((r) => r.external_id));
    const b = applyBatches(rows, ours);
    expect(b.map((x) => x.length)).toEqual([APPLY_BATCH_SIZE, APPLY_BATCH_SIZE, 100]);
  });

  it("reads apply results strictly and sums them", () => {
    const ok = { rows: 2, matched: 2, unmatched: 0, accountsCreated: 1, openingsCredited: 1, openingsAlreadyDone: 1 };
    expect(parseApplyResult(ok)).toEqual(ok);
    expect(parseApplyResult({ ...ok, rows: "2" })).toBeNull();
    expect(sumResults([ok, ok]).openingsCredited).toBe(2);
  });

  it("only allows apply when the crawl finished", () => {
    expect(crawlSummary(false, { status: "done", progress: { total: 2, saved: 2 } }).canApply).toBe(true);
    expect(crawlSummary(true, { status: "running" }).canApply).toBe(false);
    expect(crawlSummary(false, { status: "paused" }).canResume).toBe(true);
  });

  it("counts bad jsonl lines", () => {
    expect(parseLoyaltyJsonl('{"Id":1,"LoyaltyPoints":2}\nnope\n[1]\n')).toEqual({ records: [{ Id: 1, LoyaltyPoints: 2 }], bad: 2 });
  });
});

describe("CVL wiring", () => {
  const mig = read("supabase/migrations/0336_cultivera_loyalty_import.sql");

  it("keeps the import table and function service-role only", () => {
    expect(mig).toMatch(/revoke all on table public\.customer_cultivera_loyalty from public, anon, authenticated;/);
    expect(mig).toMatch(/grant select, insert, update on table public\.customer_cultivera_loyalty to service_role;/);
    expect(mig).toMatch(/revoke all on function public\.apply_cultivera_loyalty\(text, timestamptz, uuid, jsonb\) from public, anon, authenticated;/);
    expect(mig).toMatch(/cultivera-opening:/);
    expect(mig).toMatch(/alter table public\.customer_cultivera_loyalty enable row level security;/);
  });

  it("is KEPT by the factory reset and has no foreign key into a wiped table", () => {
    expect(read("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "customer_cultivera_loyalty", disposition: "KEEP"/);
    const ddl = mig.slice(mig.indexOf("create table if not exists public.customer_cultivera_loyalty"), mig.indexOf("create index if not exists customer_cultivera_loyalty_customer_idx"));
    expect(ddl).not.toMatch(/references public\.(customers|loyalty_ledger)/);
  });

  it("has a registered post-apply PG check", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toMatch(/cultivera-loyalty-0336-pg-check\.sql/);
  });

  it("gates every action on menu.import and audits it, with a confirm box", () => {
    const actions = read("src/app/admin/customers/loyalty-import/actions.ts");
    expect(actions.match(/requirePermission\("menu\.import"\)/g)?.length).toBe(3);
    expect(actions).toMatch(/recordAudit/);
    expect(actions).toMatch(/formData\.get\("confirm"\)/);
  });

  it("is linked from the customers page", () => {
    expect(read("src/app/admin/customers/page.tsx")).toMatch(/\/admin\/customers\/loyalty-import/);
  });
});

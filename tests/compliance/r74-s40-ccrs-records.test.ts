/**
 * R74 S40 (Round 20): the CCRS Records page. Minimal pins (owner tests the page).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runCcrsRecordsCompareTests } from "@/lib/compliance/ccrs-records-compare-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S40 CCRS Records", () => {
  it("compare core self-tests pass", () => {
    const r = __runCcrsRecordsCompareTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(13);
  });
  it("migration 0298 holds the guarded apply and a private bucket", () => {
    const m = read("supabase/migrations/0298_ccrs_record_copies.sql");
    expect(m).toMatch(/CCRS_RESEED_STALE/);
    expect(m).toMatch(/values \('ccrs-records', 'ccrs-records', false\)/);
    expect(m).toMatch(/revoke all on function public\.ccrs_apply_record_copy/);
  });
  it("the page is linked from the hub and the E52 next step", () => {
    expect(read("src/app/admin/compliance/ccrs/page.tsx")).toMatch(/\/admin\/compliance\/ccrs\/records/);
    expect(read("src/lib/compliance/ccrs-issue-display-core.ts")).toMatch(/\/admin\/compliance\/ccrs\/records/);
  });
});

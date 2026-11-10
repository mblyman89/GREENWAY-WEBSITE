/**
 * D221 M3 + M4 - finish the vendor links, the review queue, and the AI
 * "closer look" describe + SEO worker.
 *
 * Owner (D221): "please work on the next two slices" = M3 (provenance
 * backfill from menu items, usages and hosts; a fix-misclassified-logos rule;
 * a review queue) and M4 (vision + SEO backfill worker, resumable, budget cap,
 * ledger; inline at harvest going forward), model gpt-6-luna, detail "high".
 *
 * The SQL side is executed for real by
 * scripts/recon/media-library-m3-0353-pg-check.sql in the migrations CI job.
 * These tests pin the pure rules and the wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  MEDIA_AI_DEFAULT_MODEL,
  MEDIA_AI_DEFAULT_DETAIL,
  DESCRIBE_LEASE_MS,
  DESCRIBE_TICK_MS,
  budgetVerdict,
  describeLeaseVerdict,
  parseBudgetUsd,
  estimateRunUsd,
  __runMediaDescribeTests,
} from "../../src/lib/media/media-describe-core";
import { reviewPatch, parseReviewDecision, __runMediaReviewTests } from "../../src/lib/media/media-review-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D221 M4 - describe core", () => {
  it("self-tests pass", () => {
    const r = __runMediaDescribeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });
  it("defaults are the owner's choice: gpt-6-luna at detail high", () => {
    expect(MEDIA_AI_DEFAULT_MODEL).toBe("gpt-6-luna");
    expect(MEDIA_AI_DEFAULT_DETAIL).toBe("high");
  });
  it("the lease outlives the tick and the route's maxDuration (300 s)", () => {
    expect(DESCRIBE_TICK_MS).toBeLessThan(300_000);
    expect(DESCRIBE_LEASE_MS).toBeGreaterThan(300_000);
  });
  it("the budget stops BEFORE the call that would cross it", () => {
    expect(budgetVerdict(4.996, 5)).toBe("stop");
    expect(budgetVerdict(1, 5)).toBe("go");
    expect(budgetVerdict(100, null)).toBe("go");
  });
  it("lease verdict: idle / leased / take", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(describeLeaseVerdict(null, now)).toBe("idle");
    expect(describeLeaseVerdict({ status: "paused", lease_token: null, lease_until: null }, now)).toBe("idle");
    expect(describeLeaseVerdict({ status: "running", lease_token: "t", lease_until: "2026-11-10T12:03:00Z" }, now)).toBe("leased");
    expect(describeLeaseVerdict({ status: "running", lease_token: "t", lease_until: "2026-11-10T11:59:00Z" }, now)).toBe("take");
  });
  it("budget input is clamped and the estimate is in the expected range", () => {
    expect(parseBudgetUsd("$5")).toBe(5);
    expect(parseBudgetUsd("0")).toBeNull();
    expect(parseBudgetUsd("9999")).toBe(500);
    const e = estimateRunUsd(4100);
    expect(e.low).toBeGreaterThan(0.5);
    expect(e.high).toBeLessThan(5);
  });
});

describe("D221 M3 - review queue core", () => {
  it("self-tests pass", () => {
    const r = __runMediaReviewTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(22);
  });
  it("there is no delete decision (archive, never delete)", () => {
    expect(parseReviewDecision("delete")).toBeNull();
    expect(parseReviewDecision("archive")).toBeNull();
  });
  it("reject never deletes and only un-publishes auto-published pictures", () => {
    const v = reviewPatch(
      { id: "a", status: "published", usage_type: "product", role: "product", review_state: "needs_review", publish_reason: "manual" },
      "reject",
      "u",
      "2026-11-10T00:00:00Z",
      false,
    );
    expect(v.ok && v.patch.review_state).toBe("rejected");
    expect(v.ok && "status" in v.patch).toBe(false);
  });
});

describe("D221 M3/M4 - wiring", () => {
  it("the cron is scheduled every 5 minutes at :02 and the route uses the fail-closed preamble", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const c = v.crons.find((x) => x.path === "/api/cron/media-describe");
    expect(c?.schedule).toBe("2-59/5 * * * *");
    const route = read("src/app/api/cron/media-describe/route.ts");
    expect(route).toContain("shouldRefuseWhenSecretMissing");
    expect(route).toContain("tickDescribe");
    expect(route).toContain("maxDuration = 300");
    expect(route).toMatch(/UTC/);
  });
  it("the store leases by compare-and-set and an idle tick is one read", () => {
    const s = read("src/lib/media/media-describe-store.ts");
    expect(s).toContain("lease_token.is.null,lease_until.lt.");
    expect(s).toContain('.eq("lease_token", token)');
    expect(s).toMatch(/idle tick[^\n]*ONE/i);
    expect(s).not.toMatch(/\.limit\(\s*[1-9]\d{3,}/);
  });
  it("admin actions require media.manage and write audit rows", () => {
    const a = read("src/app/admin/media/ai-actions.ts");
    const fns = a.match(/export async function \w+/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(5);
    expect((a.match(/requirePermission\("media\.manage"\)/g) ?? []).length).toBe(fns.length);
    expect((a.match(/recordAudit\(/g) ?? []).length).toBe(fns.length);
  });
  it("the review queue page and the AI panel exist and are linked", () => {
    expect(existsSync(join(root, "src/app/admin/media/review/page.tsx"))).toBe(true);
    expect(read("src/components/admin/media/MediaAiPanel.tsx")).toContain("/admin/media/review");
    expect(read("src/app/admin/media/page.tsx")).toContain("MediaAiPanel");
    expect(read("src/app/admin/media/review/page.tsx")).toContain(".range(");
  });
  it("both logo importers pass provenance (role logo, vendor id)", () => {
    const va = read("src/app/admin/vendors/actions.ts");
    expect(va).toMatch(/provenance:\s*\{[^}]*role:\s*"logo"/);
    const vl = read("src/lib/purchasing/vendor-logo-store.ts");
    expect(vl).toMatch(/provenance:\s*\{[^}]*vendorId:\s*vendor\.id[^}]*role:\s*"logo"/);
  });
  it("the vision call defaults to detail high and records usage as media.describe", () => {
    const p = read("src/lib/ai/provider.ts");
    expect(p).toContain("export async function generateVisionJson");
    expect(p).toContain('"media.describe"');
  });
  it("migration 0353 adds the lease, reviewer and link rules and no new table", () => {
    const m = read("supabase/migrations/0353_media_library_m3_m4.sql");
    for (const s of [
      "lease_token",
      "lease_until",
      "follow_new",
      "reviewed_by",
      "media_backfill_vendor_links",
      "media_vendor_tag",
      "vendor_survivor_id",
      "independent-unlisted-vendor",
      "Run without RLS",
    ]) expect(m).toContain(s);
    expect(m).not.toMatch(/create table/i);
    // the only delete is on its own temp snapshot table (on commit drop), never on a real table
    expect((m.match(/\bdelete from\s+([\w.]+)/gi) ?? []).every((d) => /media_m3_snap$/i.test(d))).toBe(true);
    expect(existsSync(join(root, "supabase/rollbacks/0353_media_library_m3_m4.rollback.sql"))).toBe(true);
    expect(existsSync(join(root, "supabase/migrations/editor-safe/0353_media_library_m3_m4.EDITOR_SAFE.sql"))).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("MEDIA LIBRARY M3 0353 CHECK PASSED");
  });
  it("the pure self-tests are registered", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('assertRan("media-describe-core", __runMediaDescribeTests(), 42)');
    expect(r).toContain('assertRan("media-review-core", __runMediaReviewTests(), 22)');
  });
});

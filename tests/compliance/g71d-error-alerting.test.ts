/**
 * G-71d (owner message 12): error alerting.
 *
 * Owner (verbatim): "Let's build 1-4 first. I see real value in all of them."
 * Item 4: a spike of "permission denied" or server errors alerts staff right
 * away instead of waiting for a cashier to report it.
 *
 * Pins:
 *   - the pure core passes and is registered;
 *   - src/instrumentation.ts exports onRequestError (Next 16 file convention)
 *     and awaits the store, Node runtime only;
 *   - the service-role client is tapped, on top of the L-27 floor, and the
 *     tap never changes or delays the caller's response;
 *   - the store uses its own UNTAPPED client (no loops), throttles, claims
 *     alerts in compliance_reminder_log and never throws;
 *   - 0333 is deliberate (rule 15): append-only grants, RLS, constraints;
 *   - rollback, PG check wiring, factory reset KEEP, DB contract, MIGRATIONS_TO_RUN;
 *   - the 24-hour digest is part of the ONE daily report (no new cron).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ERRORS_TABLE,
  PLATFORM_ERRORS_MIGRATION,
  __runPlatformErrorsCoreTests,
  dbObjectFromUrl,
  kindForDbCode,
} from "@/lib/platform/platform-errors-core";
import { DB_CONTRACT_TABLES } from "@/lib/platform/db-contract";

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = src(`supabase/migrations/${PLATFORM_ERRORS_MIGRATION}`);

describe("G-71d error alerting", () => {
  it("pure core passes and is registered", () => {
    const r = __runPlatformErrorsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("platform-errors-core", __runPlatformErrorsCoreTests\(\), 40\)/);
  });

  it("the R-RET refusal is the first thing it alerts on", () => {
    expect(kindForDbCode("42501")).toBe("db_permission");
    expect(dbObjectFromUrl("https://x.supabase.co/rest/v1/rpc/record_customer_return")).toBe("rpc record_customer_return");
  });

  it("instrumentation.ts follows the Next 16 convention and awaits the store", () => {
    const f = src("src/instrumentation.ts");
    expect(existsSync(join(ROOT, "instrumentation.ts"))).toBe(false); // src/ layout: one file only
    expect(f).toMatch(/export const onRequestError: Instrumentation\.onRequestError = async/);
    expect(f).toMatch(/process\.env\.NEXT_RUNTIME !== "nodejs"/);
    expect(f).toMatch(/await recordRequestError\(/);
    expect(f).toMatch(/catch \(e\)/);
  });

  it("the service-role client is tapped on top of the L-27 floor", () => {
    const admin = src("src/lib/supabase/admin.ts");
    expect(admin).toMatch(/global:\s*ADMIN_GLOBAL_OPTIONS/);
    const tap = src("src/lib/supabase/db-error-tap.ts");
    expect(tap).toMatch(/fetch: tapDbErrors\(SUPABASE_GLOBAL_OPTIONS\.fetch\)/);
    // caller gets the original response; only a clone is read, after the response
    expect(tap).toMatch(/res\.clone\(\)/);
    expect(tap).toMatch(/return res;/);
    expect(tap).toMatch(/after\(task\)/);
    // only PostgREST, only the object name (no query strings)
    expect(tap).toMatch(/\/rest\/v1\//);
    // the user (cookie) client is NOT tapped: RLS refusals there are by design
    expect(src("src/lib/supabase/server.ts")).not.toMatch(/db-error-tap|ADMIN_GLOBAL_OPTIONS/);
  });

  it("the tap passes the response through untouched and reports the refusal", async () => {
    const body = JSON.stringify({ code: "42501", message: "permission denied for function record_customer_return" });
    const base = (async () => new Response(body, { status: 403, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const { tapDbErrors } = await import("@/lib/supabase/db-error-tap");
    const tapped = tapDbErrors(base);
    const res = await tapped("https://x.supabase.co/rest/v1/rpc/record_customer_return", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(JSON.parse(body)); // caller can still read its body
    const ok = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const r2 = await tapDbErrors(ok)("https://x.supabase.co/rest/v1/orders");
    expect(await r2.text()).toBe("[]");
  });

  it("the store never loops, throttles, claims and never throws", () => {
    const s = src("src/lib/platform/platform-error-store.ts");
    expect(s).toMatch(/function errorLogClient\(\)/);
    expect(s).not.toMatch(/createSupabaseAdminClient/); // the tapped client would record its own failures
    expect(s).toMatch(/global: SUPABASE_GLOBAL_OPTIONS/);
    expect(s).toMatch(/admitEvent\(throttle/);
    expect(s).toMatch(/from\("compliance_reminder_log"\)\.insert\(/);
    expect(s).toMatch(/claimErr\.code === "23505"/);
    expect(s).toMatch(/week_key: null/);
    expect(s).toMatch(/isControlFlowError\(e\)/);
  });

  it("0333 is deliberate (standing rule 15)", () => {
    expect(MIG).toMatch(/create table if not exists public\.platform_error_events/);
    expect(MIG).toMatch(/enable row level security/);
    expect(MIG).toMatch(/revoke all on table public\.platform_error_events from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke update, delete, truncate, references, trigger on table public\.platform_error_events from service_role;/);
    expect(MIG).toMatch(/grant select, insert on table public\.platform_error_events to service_role;/);
    expect(MIG).toMatch(/check \(kind in \('server_error', 'db_permission', 'db_missing'\)\)/);
    expect(MIG).toMatch(/char_length\(message\) <= 300/);
    expect(MIG).not.toMatch(/\bbegin;|\bcommit;/i);
    expect(MIG).toMatch(/MIGRATION_OUT_OF_ORDER/);
    expect(MIG).not.toMatch(/create policy/i);
  });

  it("rollback, PG check, factory reset, contract and the run list are wired", () => {
    expect(existsSync(join(ROOT, "supabase/rollbacks/0333_platform_error_events.rollback.sql"))).toBe(true);
    expect(src("scripts/recon/platform-errors-0333-pg-check.sql")).toMatch(/PLATFORM ERRORS 0333 CHECK PASSED/);
    expect(src("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /\{ file: "scripts\/recon\/platform-errors-0333-pg-check\.sql", mustPrint: "PLATFORM ERRORS 0333 CHECK PASSED" \}/,
    );
    expect(src("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "platform_error_events", disposition: "KEEP"/);
    expect(src("src/lib/admin/schema-tables.ts")).toMatch(/"platform_error_events"/);
    expect(DB_CONTRACT_TABLES).toContain(ERRORS_TABLE);
    expect(src("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0333_platform_error_events\.sql/);
  });

  it("the 24-hour digest joins the one daily report; still one platform cron", () => {
    const store = src("src/lib/platform/platform-health-store.ts");
    expect(store).toMatch(/addErrorDigest\(await runSmoke\(admin, await runCheck\(admin\)\)\)/);
    const vercel = JSON.parse(src("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.filter((c) => c.path.startsWith("/api/cron/platform")).length).toBe(1);
    expect(vercel.crons.length).toBe(18);
  });

  it("the page shows Recent errors", () => {
    const page = src("src/app/admin/settings/platform-health/page.tsx");
    expect(page).toMatch(/listRecentErrors\(50\)/);
    expect(page).toMatch(/Recent errors/);
  });
});

/**
 * tests/compliance/d182-night-watch.test.ts   (D182, round slice S5)
 *
 * Owner (2026-11-04): "Nudges by admin screens only for now, it build the
 * email and text options so I can use it if needed. They will listen if they
 * are nagged on their phones."
 *
 * Pins: the pure core's self-test; email + text OFF by default; the morning
 * report rides the existing platform-health cron (no new cron); the send is
 * claimed once per day; the settings are owner-only; the panel is on the
 * cockpit and Register Activity; texts go through a bounded, never-throwing
 * Twilio call that sends nothing without its env vars.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNightWatchTests,
  buildMorningReport,
  DEFAULT_NOTIFY,
  notifyPlan,
  parseNotifySettings,
  type WatchFindings,
} from "@/lib/registers/night-watch-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const empty: WatchFindings = {
  day: "2026-11-05",
  openOldDrawers: [],
  noSecondCount: [],
  notReconciled: [],
  missingBagDays: [],
  bagNeedsReason: false,
  unsealedBagDays: [],
  unbankedBagDays: [],
  openExceptions: 0,
  oldestExceptionDays: null,
  loudSecondCounts: [],
  unexplainedOverShort: [],
  longOpenPunches: [],
  platformStatus: "ok",
  readErrors: [],
};

describe("D182 night watch: pure core", () => {
  it("self-test passes", () => {
    const r = __runNightWatchTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(36);
  });

  it("email and text are OFF by default (admin screens only)", () => {
    expect(DEFAULT_NOTIFY.emailEnabled).toBe(false);
    expect(DEFAULT_NOTIFY.smsEnabled).toBe(false);
    expect(parseNotifySettings(undefined).smsEnabled).toBe(false);
    const report = buildMorningReport({ ...empty, missingBagDays: ["2026-11-04"] });
    const plan = notifyPlan(parseNotifySettings(null), report, { emailProvider: true, smsProvider: true, emailRecipients: 3 });
    expect(plan.email || plan.sms).toBe(false);
  });

  it("a missing bag is urgent and the crew's job", () => {
    const r = buildMorningReport({ ...empty, missingBagDays: ["2026-11-04"] });
    expect(r.items[0]).toMatchObject({ key: "missing_bag", severity: "red", who: "crew" });
  });

  it("a read failure is never reported as all clear (rule 135)", () => {
    const r = buildMorningReport({ ...empty, readErrors: ["drawers (timeout)."] });
    expect(r.status).not.toBe("clear");
  });
});

describe("D182 night watch: wiring", () => {
  it("rides the platform-health cron (no new cron) and stays fail-closed", () => {
    const route = read("src/app/api/cron/platform-health/route.ts");
    expect(route).toContain("runNightWatch");
    expect(route).toContain("shouldRefuseWhenSecretMissing");
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.some((c) => c.path.includes("night-watch"))).toBe(false);
  });

  it("claims the daily send in compliance_reminder_log before sending", () => {
    const s = read("src/lib/registers/night-watch-store.ts");
    const claim = s.indexOf('from("compliance_reminder_log").insert');
    const deliver = s.indexOf("await deliver(report, s, notes)");
    expect(claim).toBeGreaterThan(0);
    expect(deliver).toBeGreaterThan(claim);
    expect(s).toContain('"23505"');
    expect(s).toContain("nightWatchKey(report.day)");
  });

  it("only the owner changes who is nagged or sends a test", () => {
    const a = read("src/app/admin/registers/night-watch/actions.ts");
    expect(a.match(/requireBooksAccess\(\)/g)?.length).toBe(2);
    expect(a).toContain("recordAudit");
  });

  it("the morning report is on the cockpit and Register Activity", () => {
    expect(read("src/app/admin/page.tsx")).toContain("<MorningReportPanel");
    expect(read("src/app/admin/registers/page.tsx")).toContain("<MorningReportPanel");
    expect(read("src/components/admin/admin-nav-data.ts")).toContain('href: "/admin/registers/night-watch"');
  });

  it("texts: bounded, never throw, nothing without the Twilio env vars", () => {
    const s = read("src/lib/notifications/sms.ts");
    expect(s).toContain('import "server-only"');
    expect(s).toContain("AbortController");
    expect(s).toContain("TWILIO_ACCOUNT_SID");
    expect(s).toMatch(/if \(!sid \|\| !token \|\| !from\) return/);
    expect(s).toContain("clearTimeout(timer)");
  });
});

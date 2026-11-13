/**
 * D237 N-3 (SOP-22 G-113, F-22-5, F-22-9, Q-22-4): blog posts can be
 * scheduled through the one content schedule, and the Sunday newsletter has
 * a ready -> approved (with a time) -> sent cadence plus a reminder.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations". Q-22-4 names no Sunday time, so it is a setting that
 * starts empty (nothing sends by itself until a time is picked).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterCadenceCoreTests,
  DEFAULT_CADENCE,
  nextSundaySendUtc,
  normalizeCadence,
  reminderDue,
  stageOf,
  validateSendAt,
} from "@/lib/cms/newsletter-cadence-core";
import { isTargetKind, SCHEDULE_TARGET_KINDS } from "@/lib/cms/content-schedule-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D237 N-3 blog scheduling + Sunday newsletter cadence", () => {
  it("pure core self-tests all pass", () => {
    const r = __runNewsletterCadenceCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });

  it("Q-22-4: no Sunday time is assumed; nothing auto-sends until one is set", () => {
    expect(DEFAULT_CADENCE.sendTime).toBeNull();
    expect(normalizeCadence({}).sendTime).toBeNull();
    expect(nextSundaySendUtc("2026-05-13T19:00:00.000Z", null)).toBeNull();
    expect(stageOf(null)).toBe("draft");
    expect(stageOf({ state: "approved", send_at: null })).toBe("approved");
    expect(stageOf({ state: "approved", send_at: "2026-05-17T16:00:00.000Z" })).toBe("scheduled");
    expect(validateSendAt("2026-05-12T00:00:00.000Z", "2026-05-13T00:00:00.000Z")).not.toBeNull();
  });

  it("the reminder is skipped when a newsletter is ready, and keyed once per day", () => {
    const c = { ...DEFAULT_CADENCE, remindDay: 5, remindTime: "09:00" };
    // Friday 2026-05-15 10:00 Pacific (PDT) = 17:00Z
    const r = reminderDue(c, "2026-05-15T17:00:00.000Z", false);
    expect(r).toEqual({ due: true, key: "newsletter_reminder:2026-05-15" });
    expect(reminderDue(c, "2026-05-15T17:00:00.000Z", true)).toEqual({ due: false });
  });

  it("migration 0363: blog_post schedule kind, approvals table service-role only", () => {
    const sql = read("supabase/migrations/0363_newsletter_approvals_blog_schedule.sql");
    expect(sql).toMatch(/'blog_post'\)\)/);
    expect(sql).toMatch(/create table if not exists public\.newsletter_approvals/);
    expect(sql).toMatch(/references public\.blog_posts\(id\) on delete cascade/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/grant [^;]*to service_role/);
    expect(existsSync(join(root, "supabase/rollbacks/0363_newsletter_approvals_blog_schedule.rollback.sql"))).toBe(true);
  });

  it("content schedule accepts blog posts and the server applies them", () => {
    expect(SCHEDULE_TARGET_KINDS).toContain("blog_post");
    expect(isTargetKind("blog_post")).toBe(true);
    const srv = read("src/lib/cms/content-schedule-server.ts");
    expect(srv).toContain("applyBlogPostChange");
    expect(srv).toContain("setPostStatus");
  });

  it("the blog editor has the Schedule panel and refuses a bare Scheduled status", () => {
    const page = read("src/app/admin/blog/[id]/page.tsx");
    expect(page).toContain("<SchedulePanel");
    expect(page).toContain('kind="blog_post"');
    const actions = read("src/app/admin/blog/actions.ts");
    expect(actions).toContain('if (status === "scheduled")');
    expect(actions).toContain("voidApprovalOnEdit(id)");
    expect(actions).toContain('"newsletter.approval_voided"');
  });

  it("the 5-minute cron runs the Sunday tick (no new cron)", () => {
    const route = read("src/app/api/cron/content-schedule/route.ts");
    expect(route).toContain("runNewsletterCadenceTick()");
    expect(route).toContain("newsletterCadence");
  });

  it("approve and the Sunday settings are owner/admin only; ready is Blog access", () => {
    const a = read("src/app/admin/newsletter/actions.ts");
    const approveFn = a.slice(a.indexOf("export async function approveNewsletterAction"), a.indexOf("export async function newsletterBackToDraftAction"));
    expect(approveFn).toContain('can(session.profile.role, "newsletter.broadcast")');
    expect(approveFn).toContain("validateSendAt");
    expect(approveFn).toContain('"newsletter.approve"');
    const saveFn = a.slice(a.indexOf("export async function saveNewsletterCadenceAction"));
    expect(saveFn).toContain('can(session.profile.role, "newsletter.broadcast")');
    expect(saveFn).toContain('"newsletter.cadence_save"');
    const readyFn = a.slice(a.indexOf("export async function markNewsletterReadyAction"), a.indexOf("export async function approveNewsletterAction"));
    expect(readyFn).toContain('requirePermission("blog.manage")');
    expect(readyFn).not.toContain("newsletter.broadcast");
  });

  it("the tick claims a send before sending and never blindly retries a failure", () => {
    const s = read("src/lib/cms/newsletter-cadence-server.ts");
    expect(s).toContain('"newsletter.scheduled_send"');
    expect(s).toContain('"newsletter.scheduled_send_failed"');
    expect(s).toContain("compliance_reminder_log");
    expect(s).not.toMatch(/\.limit\((\d{4,})\)/);
  });
});

/**
 * R41 S14: Nacha's yearly obligations (Fraud Monitoring Phase 2).
 *
 *   1. every Phase 2 quote is verbatim in its mirror (whitespace flattened);
 *   2. the risk assessment points at real procedure items, and the reviewed
 *      fingerprint follows the text;
 *   3. the record form, the year status and the segregation-of-duties report;
 *   4. wiring: owner-only record (ach.act), owner-only who-did-what
 *      (audit.view), packet never cached, help tab + help + concierge,
 *      the calendar task points here and is ticked by a current-year record;
 *   5. 0288 content pins, rollback, CI post-apply check, factory reset KEEP;
 *   6. docs, mutation logs (test the tests), public-repo rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as y from "@/lib/payments/ach-yearly-review-core";
import { ACH_CAL_TASKS, ACH_FRAUD_PROCEDURE, checkMarkDone } from "@/lib/payments/ach-calendar-core";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const PAGE = "src/app/admin/settings/banking/yearly-review/page.tsx";
const ACTION = "src/app/admin/settings/banking/yearly-review-actions.ts";
const ROUTE = "src/app/admin/settings/banking/yearly-review/packet/route.ts";
const STORE = "src/lib/payments/ach-yearly-review-store.ts";

describe("Phase 2 quotes", () => {
  it("every quote is verbatim in the mirror", () => {
    const mirror = flat(read(`docs/authorities/${y.PHASE2_FILE}`));
    for (const [k, q] of Object.entries(y.PHASE2_QUOTES)) expect(mirror.includes(flat(q)), k).toBe(true);
  });
  it("the calendar task quote is the same annual-review FAQ answer", () => {
    const t = ACH_CAL_TASKS.find((x) => x.id === "fraud_procedure_review")!;
    expect(t.quote?.text).toBe(y.PHASE2_QUOTES.annualFaq);
  });
});

describe("risk assessment", () => {
  it("has higher, lower and very-low rows; every procedure item reference is real", () => {
    const levels = new Set(y.RISK_ASSESSMENT.map((r) => r.level));
    expect([...levels].sort()).toEqual(["higher", "lower", "very_low"]);
    for (const r of y.RISK_ASSESSMENT) {
      expect(r.procedureItems.length, r.id).toBeGreaterThan(0);
      for (const n of r.procedureItems) {
        expect(Number.isInteger(n) && n >= 1 && n <= ACH_FRAUD_PROCEDURE.length, `${r.id} item ${n}`).toBe(true);
      }
    }
    expect(y.RISK_ASSESSMENT.find((r) => r.id === "bank-change")?.level).toBe("higher");
  });
  it("the fingerprint is a SHA-256 and is stable", () => {
    expect(y.reviewedTextFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(y.reviewedTextFingerprint()).toBe(y.reviewedTextFingerprint());
  });
});

describe("record form and year status", () => {
  const good: Record<string, string> = { review_year: "2026", outcome: "no_changes", summary: "Re-read all 12 items and the risk table. No changes.", risk_confirmed: "1", sod_reviewed: "1" };
  const f = (over: Record<string, string | null>, today = "2026-12-20") => y.checkYearlyReviewForm((k) => ({ ...good, ...over })[k] ?? null, today);
  it("accepts a good form, this year or last year", () => {
    expect(f({}).ok).toBe(true);
    expect(f({ review_year: "2026" }, "2027-01-05").ok).toBe(true);
  });
  it("refuses a future year, two years back, before 2026, a short summary, digits, unticked boxes, a bad corrects id", () => {
    expect(f({ review_year: "2027" }).ok).toBe(false);
    expect(f({ review_year: "2026" }, "2028-01-05").ok).toBe(false);
    expect(f({ review_year: "2025" }, "2026-01-05").ok).toBe(false);
    expect(f({ summary: "too short" }).ok).toBe(false);
    expect(f({ summary: "Account 123456789 was checked again this year." }).ok).toBe(false);
    expect(f({ risk_confirmed: null }).ok).toBe(false);
    expect(f({ sod_reviewed: "0" }).ok).toBe(false);
    expect(f({ corrects_id: "nope" }).ok).toBe(false);
    expect(f({ outcome: "fine" }).ok).toBe(false);
  });
  it("the newest correction stands; a changed procedure text is flagged", () => {
    const fp = y.reviewedTextFingerprint();
    const base = { reviewed_on: "2026-12-20", outcome: "no_changes" as const, summary: "x".repeat(20), procedure_sha256: fp, created_by: "o" };
    const o = { ...base, id: "a", review_year: 2026, corrects_id: null, created_at: "2026-12-20T20:00:00Z" };
    const c = { ...base, id: "b", review_year: 2026, corrects_id: "a", created_at: "2026-12-21T20:00:00Z", procedure_sha256: "0".repeat(64) };
    const st = y.yearStatus([c, o], 2026, fp);
    expect(st.current?.id).toBe("b");
    expect(st.original?.id).toBe("a");
    expect(st.textChangedSince).toBe(true);
    expect(y.yearStatus([o], 2026, fp).textChangedSince).toBe(false);
    expect(y.yearStatus([o], 2027, fp).current).toBeNull();
  });
  it("database errors become plain words", () => {
    expect(y.reviewDbErrorMessage("P0001 ACH_OWNER_ONLY")).toMatch(/Only the owner/);
    expect(y.reviewDbErrorMessage("23505 duplicate key aar_one_per_year")).toMatch(/already recorded/);
    expect(y.reviewDbErrorMessage("ACH_YEARLY_APPEND_ONLY")).toMatch(/never changed/);
  });
});

describe("segregation-of-duties report", () => {
  const staff: y.StaffRow[] = [
    { id: "o", email: "o@x.test", full_name: "Owner", role: "owner", active: true, last_login_at: null },
    { id: "a", email: "a@x.test", full_name: "Admin", role: "admin", active: true, last_login_at: null },
    { id: "m", email: "m@x.test", full_name: "Manager", role: "manager", active: true, last_login_at: null },
  ];
  it("counts ACH actions in the Pacific year only, and flags an action by someone without owner or admin", () => {
    const rep = y.buildSodReport({
      year: 2026,
      staff,
      audit: [
        { id: 1, actor_id: "o", actor_email: null, action: "ach.request.approve", created_at: "2026-03-01T20:00:00Z" },
        { id: 2, actor_id: "m", actor_email: null, action: "vendor_ach.generate", created_at: "2026-05-01T20:00:00Z" },
        { id: 3, actor_id: "o", actor_email: null, action: "brand.updated", created_at: "2026-05-01T20:00:00Z" },
        { id: 4, actor_id: "o", actor_email: null, action: "ach.file.voided", created_at: "2026-01-01T07:59:00Z" },
      ],
      requests: [],
      stopReviews: [],
    });
    const total = rep.people.reduce((n, p) => n + p.total, 0);
    expect(total).toBe(2);
    expect(rep.findings.map((x) => x.code)).toContain("acted_without_role");
    expect(rep.holders.map((h) => h.role).sort()).toEqual(["admin", "owner"]);
  });
  it("the year window is Pacific midnight to Pacific midnight", () => {
    expect(y.yearWindowUtc(2026)).toEqual({ fromIso: "2026-01-01T08:00:00.000Z", toIso: "2027-01-01T08:00:00.000Z" });
  });
  it("the packet has the who-did-what section only when given, and no long digit runs", () => {
    const rep = y.buildSodReport({ year: 2026, staff, audit: [], requests: [], stopReviews: [] });
    const args = { year: 2026, generatedAt: new Date("2026-12-20T20:00:00Z"), generatedBy: "Owner", reviews: [], reviewerName: () => "Owner" };
    const withSod = y.yearlyReviewPacket({ ...args, sod: rep });
    const without = y.yearlyReviewPacket({ ...args, sod: null });
    expect(withSod).toMatch(/\n5\. /);
    expect(without).not.toMatch(/\n5\. /);
    expect(withSod.replace(/[0-9a-f]{64}/g, "")).not.toMatch(/[0-9]{9,}/);
  });
});

describe("wiring", () => {
  it("only the owner records (ach.act); the action ticks the calendar task for this year only", () => {
    const a = read(ACTION);
    expect(a).toContain('const session = await requirePermission("ach.act");');
    expect(a).toContain('taskId: "fraud_procedure_review",');
    expect(a).toContain("if (form.row.reviewYear === Number(today.slice(0, 4))) {");
    expect(a).toContain('"ach.yearly_review.corrected" : "ach.yearly_review.recorded"');
    expect(a).not.toContain("achGate(");
  });
  it("the action's calendar note passes checkMarkDone (no digits)", () => {
    for (const w of Object.values(y.OUTCOME_WORD)) {
      expect(checkMarkDone({ taskId: "fraud_procedure_review", periodKey: "2026", todayIso: "2026-12-20", note: `Yearly review recorded (${w}).` }).ok).toBe(true);
    }
  });
  it("the page opens for owner or admin; who-did-what and the form are owner only", () => {
    const p = read(PAGE);
    expect(p).toContain('const session = await requirePermission("settings.manage");');
    expect(p).toContain('const seesLog = can(session.profile.role, "audit.view");');
    expect(p).toContain("seesLog ? readSodInputs(year) : Promise.resolve(null)");
    expect(p).toContain('const isOwner = can(session.profile.role, "ach.act");');
    for (const id of ["status", "procedure", "risk", "duties", "record"]) expect(p).toContain(`id="${id}"`);
  });
  it("the packet route: settings.manage, who-did-what only with audit.view, refuses a partial read, never cached", () => {
    const r = read(ROUTE);
    expect(r).toContain('const session = await requirePermission("settings.manage");');
    expect(r).toContain('const seesLog = can(session.profile.role, "audit.view");');
    expect(r).toContain("if (sodIn && !sodIn.ok) return refuse(sodIn.error);");
    expect(r.match(/"Cache-Control": "no-store"/g)?.length).toBe(2);
    expect(r).toContain('"X-Content-Type-Options": "nosniff"');
    expect(r).toContain('action: "ach.yearly_review.packet"');
  });
  it("every store read is paged and checked complete", () => {
    const s = read(STORE);
    expect(s.match(/pagedAllChecked</g)?.length).toBe(5);
    expect(s.match(/verdict\.complete\)/g)?.length).toBe(5);
    expect(s).toContain('.order("id", { ascending: true })');
  });
  it("the Yearly review tab is listed and its link is in help and concierge", () => {
    const t = BANKING_HELP_TABS.find((x) => x.key === "yearly");
    expect(t?.href).toBe("/admin/settings/banking/yearly-review");
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/settings/banking/yearly-review",');
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Yearly review is /admin/settings/banking/yearly-review.");
  });
  it("the calendar task links here; the calendar procedure links here", () => {
    expect(ACH_CAL_TASKS.find((x) => x.id === "fraud_procedure_review")?.href).toBe("/admin/settings/banking/yearly-review#record");
    expect(read("src/app/admin/settings/banking/calendar/page.tsx")).toContain('<Link href="/admin/settings/banking/yearly-review"');
  });
});

describe("0288 content pins", () => {
  const m = read("supabase/migrations/0288_ach_annual_reviews.sql");
  it("CI runs the 0288 check after every migration", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ach-annual-reviews-0288-pg-check.sql", mustPrint: "ACH 0288 CHECK PASSED" });
  });
  it("owner only, append-only, no backdating, one per year, no truncate, not security definer", () => {
    expect(m).toContain("ach_write_by_owner(new.created_by)");
    expect(m).toContain("ACH_YEARLY_APPEND_ONLY");
    expect(m).toContain("ACH_YEARLY_DATE");
    expect(m).toContain("ACH_YEARLY_CORRECTS");
    expect(m).toMatch(/create unique index if not exists aar_one_per_year/i);
    expect(m).toContain("ach_annual_reviews_no_truncate");
    expect(m).not.toMatch(/security definer/i);
    expect(m).toContain("'[0-9]{7,}'");
  });
  it("the rollback refuses while a review exists", () => {
    expect(read("supabase/rollbacks/0288_ach_annual_reviews.rollback.sql")).toContain("ROLLBACK REFUSED");
  });
  it("factory reset keeps the table", () => {
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain('{ table: "ach_annual_reviews", disposition: "KEEP"');
  });
});

describe("S14 docs", () => {
  it("MIGRATIONS_TO_RUN, TEST-PLAN T-374, the manual, the roadmap", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("## R41 \u2014 0288 \u2014 Yearly ACH fraud-procedure review");
    expect(d).toContain("Apply it **after 0287**.");
    expect(d).toContain("ACH 0288 CHECK PASSED");
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-374 (");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-374"');
    expect(man).toContain('"T-374": "part-b--the-results-log"');
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S14 | Nacha yearly obligations");
    expect(r).toContain("## S14 in detail");
  });
});

describe("S14 mutation runs (test the tests)", () => {
  const pin = (scriptPath: string, logPath: string, floor: number) => {
    const script = read(scriptPath);
    const log = read(logPath);
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const mm = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(mm, "clean summary line").not.toBeNull();
    expect(Number(mm![1])).toBe(listed);
    expect(Number(mm![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(floor);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  };
  it("scripts/r41/mutate-0288-sql.last.log: 22 SQL mutants killed, plus the rolled-back and rollback-refuses probes", () => {
    pin("scripts/r41/mutate-0288-sql.py", "scripts/r41/mutate-0288-sql.last.log", 22);
    const log = read("scripts/r41/mutate-0288-sql.last.log");
    expect(log).toMatch(/killed {3}rolled-back/);
    expect(log).toMatch(/killed {3}rollback-refuses/);
  });
  it("scripts/r41/mutate-s14-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s14-app.py", "scripts/r41/mutate-s14-app.last.log", 15);
  });
});

describe("S14 public-repo rules", () => {
  const files = [
    "src/lib/payments/ach-yearly-review-core.ts",
    STORE,
    ACTION,
    PAGE,
    ROUTE,
    "supabase/migrations/0288_ach_annual_reviews.sql",
    "supabase/rollbacks/0288_ach_annual_reviews.rollback.sql",
    "scripts/recon/ach-annual-reviews-0288-pg-check.sql",
  ];
  it("one phone only, no real emails, no long digit runs", () => {
    for (const f of files) {
      const s = read(f);
      const phones = s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? [];
      expect(phones.filter((p) => !p.endsWith("562-8761")), f).toEqual([]);
      expect(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)?.filter((e) => !e.endsWith("@x.test")) ?? [], f).toEqual([]);
      // the self-tests' deliberate fakes ("account 123456789", refused by the summary rule) are the only allowed runs
      expect(s.replace(/[0-9a-f]{64}/g, "").replace(/account 123456789/g, ""), f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
});

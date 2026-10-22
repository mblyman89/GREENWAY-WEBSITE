/**
 * R41 S18: written ACH policies, the quarterly access review and the yearly
 * key checks.
 *
 *   1. every quote is verbatim in its mirror (whitespace flattened), and
 *      every policy's Why names only real quotes;
 *   2. the pure core: role powers cover exactly the roles that open the
 *      page, the access report flags, the record form, the status/to-do,
 *      the packet carries no account numbers;
 *   3. wiring: page gate settings.manage, records owner-only (ach.act), the
 *      fingerprint is computed on the server, reads are paged, tab, help,
 *      concierge, nav-gate decision;
 *   4. 0291 content pins, rollback, CI post-apply check, factory reset KEEP;
 *   5. docs, mutation logs (test the tests), public-repo rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as p from "@/lib/payments/ach-policies-core";
import { rolesForPermission } from "@/lib/auth/roles";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import { TABLE_RULES } from "@/lib/accounting/factory-reset-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CORE = "src/lib/payments/ach-policies-core.ts";
const STORE = "src/lib/payments/ach-policies-store.ts";
const ACTION = "src/app/admin/settings/banking/policies-actions.ts";
const PAGE = "src/app/admin/settings/banking/policies/page.tsx";
const PACKET = "src/app/admin/settings/banking/policies/packet/route.ts";
const MIG = "supabase/migrations/0291_ach_control_records.sql";
const ROLLBACK = "supabase/rollbacks/0291_ach_control_records.rollback.sql";
const CHECK = "scripts/recon/ach-control-records-0291-pg-check.sql";
const TODAY = "2026-10-22";

const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;
const staff = (over: Partial<p.StaffLite> = {}): p.StaffLite => ({ id: "a", email: null, full_name: "Michael", role: "owner", active: true, last_login_at: "2026-10-21T10:00:00Z", ...over });

describe("S18 quotes", () => {
  it("every quote is verbatim in its mirror", () => {
    for (const [k, q] of Object.entries(p.POLICY_QUOTES)) {
      const mirror = flat(read(`docs/authorities/${q.file}`));
      expect(mirror.includes(flat(q.text)), k).toBe(true);
      expect(q.where.length, k).toBeGreaterThan(3);
    }
  });
  it("quotes come only from the State Auditor and Timberland mirrors", () => {
    for (const q of Object.values(p.POLICY_QUOTES)) expect([p.SAO_FILE, p.TIMBERLAND_FILE]).toContain(q.file);
  });
  it("every policy's Why points at a real quote; only the owner's own procedure has none", () => {
    expect(p.ACH_POLICIES).toHaveLength(8);
    for (const pol of p.ACH_POLICIES) {
      for (const w of pol.why) expect(Object.keys(p.POLICY_QUOTES)).toContain(w);
      if (pol.why.length === 0) expect(pol.ownerProcedure, pol.id).toContain("skip an ach payroll and log it as being covered by written checks");
    }
    for (const k of p.KEY_ITEMS) expect(Object.keys(p.POLICY_QUOTES)).toContain(k.why);
  });
  it("the incident policy names Timberland's one phone number", () => {
    const inc = p.ACH_POLICIES.find((x) => x.id === "incident")!;
    expect(inc.hint).toContain(p.TIMBERLAND_PHONE);
    expect(p.TIMBERLAND_PHONE).toBe("1-800-562-8761");
  });
});

describe("S18 core", () => {
  it("role powers cover exactly the roles that can open the page (settings.manage)", () => {
    expect(Object.keys(p.ACH_ROLE_POWERS).sort()).toEqual([...rolesForPermission("settings.manage")].sort());
    expect(rolesForPermission("ach.act")).toEqual(["owner"]);
  });
  it("access report: owner first, inactive noted, never-signed-in and 90-day flags, no owner flagged", () => {
    const r = p.buildAccessReport(
      [
        staff({ id: "b", full_name: "Stephen", role: "admin", last_login_at: "2026-07-01T00:00:00Z" }),
        staff(),
        staff({ id: "c", full_name: "Old", role: "admin", active: false, last_login_at: null }),
        staff({ id: "d", full_name: "Budtender", role: "staff" }),
        staff({ id: "e", full_name: "New", role: "admin", last_login_at: null }),
      ],
      TODAY,
    );
    expect(r.people.map((x) => x.id)).toEqual(["a", "e", "c", "b"]); // owner first, then admins by name (New, Old, Stephen)
    expect(r.people[0].role).toBe("owner");
    expect(r.people.some((x) => x.role === "staff")).toBe(false);
    const text = r.findings.map((f) => f.text).join("\n");
    expect(text).toContain("New (admin) has never signed in");
    expect(text).toMatch(/Stephen \(admin\) has not signed in for \d+ days/);
    expect(text).toContain("1 switched-off account still marked owner or admin");
    expect(p.buildAccessReport([staff({ role: "admin" })], TODAY).findings[0].text).toContain("No active owner account");
    expect(p.STALE_LOGIN_DAYS).toBe(90);
  });
  it("access fingerprint changes when a role or active flag changes, not when a sign-in date does", () => {
    const base = p.buildAccessReport([staff(), staff({ id: "b", role: "admin" })], TODAY).fingerprint;
    expect(p.buildAccessReport([staff({ last_login_at: "2026-10-01T00:00:00Z" }), staff({ id: "b", role: "admin" })], TODAY).fingerprint).toBe(base);
    expect(p.buildAccessReport([staff(), staff({ id: "b", role: "admin", active: false })], TODAY).fingerprint).not.toBe(base);
  });
  it("the record form: kind, 10-2000 characters, no 7+ digit runs, confirm box, quarter choice, key item and date", () => {
    const ok = { kind: "policy_adoption", summary: "Read all eight policies.", confirm: "1" };
    expect(p.checkControlForm(form(ok), TODAY)).toEqual({ ok: true, row: { kind: "policy_adoption", periodKey: "2026", summary: ok.summary, item: null, itemSetOn: null } });
    expect(p.checkControlForm(form({ ...ok, kind: "x" }), TODAY).ok).toBe(false);
    expect(p.checkControlForm(form({ ...ok, summary: "short" }), TODAY).ok).toBe(false);
    expect(p.checkControlForm(form({ ...ok, summary: "account 1234567 ok fine" }), TODAY).ok).toBe(false);
    expect(p.checkControlForm(form({ ...ok, summary: `Called ${p.TIMBERLAND_PHONE} to confirm.` }), TODAY).ok).toBe(true);
    expect(p.checkControlForm(form({ ...ok, confirm: "" }), TODAY).ok).toBe(false);
    const ar = { ...ok, kind: "access_review" };
    expect(p.checkControlForm(form({ ...ar, period_key: "2026-Q4" }), TODAY).ok).toBe(true);
    expect(p.checkControlForm(form({ ...ar, period_key: "2026-Q3" }), TODAY).ok).toBe(true);
    expect(p.checkControlForm(form({ ...ar, period_key: "2026-Q2" }), TODAY).ok).toBe(false);
    const kc = { ...ok, kind: "key_check", item: "timberland_token" };
    expect(p.checkControlForm(form(kc), TODAY).ok).toBe(true);
    expect(p.checkControlForm(form({ ...kc, item: "nope" }), TODAY).ok).toBe(false);
    expect(p.checkControlForm(form({ ...kc, item_set_on: "2026-10-23" }), TODAY).ok).toBe(false);
    expect(p.checkControlForm(form({ ...kc, item_set_on: "2026-01-05" }), TODAY)).toMatchObject({ ok: true, row: { itemSetOn: "2026-01-05" } });
  });
  it("quarters", () => {
    expect(p.quarterKeyOf("2026-10-22")).toBe("2026-Q4");
    expect(p.quarterKeyOf("2026-03-31")).toBe("2026-Q1");
    expect(p.previousQuarterKey("2026-Q1")).toBe("2025-Q4");
  });
  it("status: to-do items until each is recorded; a wording change asks for a re-adopt", () => {
    const fp = p.policyTextFingerprint();
    const acc = p.buildAccessReport([staff()], TODAY).fingerprint;
    expect(p.controlStatus([], TODAY, fp, acc).todo).toHaveLength(3);
    const row = (o: Partial<p.ControlRow>): p.ControlRow => ({ id: "1", kind: "policy_adoption", period_key: "2026", recorded_on: TODAY, text_sha256: fp, summary: "s", item: null, item_set_on: null, created_by: "a", created_at: `${TODAY}T10:00:00Z`, ...o });
    const rows = [row({}), row({ id: "2", kind: "access_review", period_key: "2026-Q4", text_sha256: acc }), ...p.KEY_ITEMS.map((k, i) => row({ id: `k${i}`, kind: "key_check", item: k.id }))];
    expect(p.controlStatus(rows, TODAY, fp, acc).todo).toEqual([]);
    expect(p.controlStatus(rows, TODAY, "f".repeat(64), acc).todo[0]).toContain("re-adopt");
  });
  it("database errors become plain words", () => {
    expect(p.controlDbErrorMessage("P0001 ACH_OWNER_ONLY: x")).toContain("Only the owner");
    expect(p.controlDbErrorMessage("42P01 relation does not exist")).toContain("0291");
  });
  it("the pure self-test passes and is registered with its floor", () => {
    expect(p.__runAchPoliciesCoreTests().failed).toBe(0);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ach-policies-core", __runAchPoliciesCoreTests(), 69)');
  });
});

describe("S18 wiring", () => {
  it("the page is settings.manage; the forms are only for ach.act", () => {
    const pg = read(PAGE);
    expect(pg).toContain('requirePermission("settings.manage")');
    expect(pg).toContain('const isOwner = can(session.profile.role, "ach.act");');
    expect(pg).toContain("const canRecord = isOwner && records.ok;");
    expect(pg).toContain('active="policies"');
    expect(pg).not.toContain("dangerouslySetInnerHTML");
  });
  it("the action is ach.act, fingerprints on the server, and audits", () => {
    const a = read(ACTION);
    expect(a).toContain('requirePermission("ach.act")');
    expect(a).toContain("const fp = fingerprintFor(form.row, staff.ok ? staff.rows : [], today);");
    expect(a).toContain("action: `ach.control.${form.row.kind}`");
    expect(a).not.toMatch(/fd\.get\("text_sha256"\)/);
  });
  it("the packet is settings.manage and audited", () => {
    const r = read(PACKET);
    expect(r).toContain('requirePermission("settings.manage")');
    expect(r).toContain('action: "ach.control.packet"');
  });
  it("reads are paged (no silent 1,000-row cap)", () => {
    const s = read(STORE);
    expect(s.match(/pagedAllChecked</g)?.length).toBe(2);
    expect(s.replace(/\/\/.*$/gm, "")).not.toMatch(/\.limit\(/);
  });
  it("tab, help, concierge, nav-gate decision", () => {
    expect(BANKING_HELP_TABS).toContainEqual({ key: "policies", href: "/admin/settings/banking/policies", label: "Policies" });
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/settings/banking/policies"');
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Policies is /admin/settings/banking/policies");
    expect(kb).toContain("Policies (R41 S18");
    expect(read("tests/compliance/nav-gate-core.test.ts")).toContain('"/admin/settings/banking/policies"');
  });
});

describe("0291 content pins", () => {
  const m = read(MIG);
  it("CI runs the 0291 check after every migration", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: CHECK, mustPrint: "ACH 0291 CHECK PASSED" });
    expect(read(CHECK)).toContain("ACH 0291 CHECK PASSED");
  });
  it("append-only, owner-only, never backdated, period rules; no definer; anon shut out", () => {
    for (const code of ["ACH_CONTROL_APPEND_ONLY", "ACH_OWNER_ONLY", "ACH_CONTROL_DATE", "ACH_CONTROL_PERIOD"]) expect(m).toContain(code);
    expect(m).toContain("public.ach_write_by_owner(new.created_by)");
    expect(m).toContain("constraint acr_shape check (");
    expect(m).toContain("revoke update, delete, truncate on table public.ach_control_records from service_role;");
    expect(m).toContain("revoke all on table public.ach_control_records from anon;");
    expect(m.replace(/--.*$/gm, "")).not.toMatch(/security definer/i);
  });
  it("the rollback refuses while a row exists", () => {
    expect(read(ROLLBACK)).toContain("ROLLBACK REFUSED");
  });
  it("factory reset keeps it", () => {
    expect(TABLE_RULES).toContainEqual(expect.objectContaining({ table: "ach_control_records", disposition: "KEEP" }));
  });
});

describe("S18 docs", () => {
  it("MIGRATIONS_TO_RUN, TEST-PLAN T-377, the manual, the roadmap", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("## R41 \u2014 0291 \u2014 ACH policies");
    expect(d).toContain("Apply it **after 0290**.");
    expect(d).toContain("ACH 0291 CHECK PASSED");
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-377 (");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-377"');
    expect(man).toContain('"T-377": "part-b--the-results-log"');
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S18 | Written ACH policies");
    expect(r).toContain("## S18 in detail");
  });
});

describe("S18 mutation runs (test the tests)", () => {
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
  it("scripts/r41/mutate-0291-sql.last.log: 27 SQL mutants killed, plus the probes", () => {
    pin("scripts/r41/mutate-0291-sql.py", "scripts/r41/mutate-0291-sql.last.log", 27);
    expect(read("scripts/r41/mutate-0291-sql.last.log")).toMatch(/killed {3}rollback-refuses/);
  });
  it("scripts/r41/mutate-s18-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s18-app.py", "scripts/r41/mutate-s18-app.last.log", 20);
  });
});

describe("S18 public-repo rules", () => {
  const files = [CORE, STORE, ACTION, PAGE, PACKET, MIG, ROLLBACK, CHECK];
  it("one phone only, no real emails, no long digit runs", () => {
    for (const f of files) {
      const s = read(f);
      const phones = s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? [];
      expect(phones.filter((x) => !x.endsWith("562-8761")), f).toEqual([]);
      const emails = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? [];
      expect(emails.filter((e) => !/\.test$/.test(e)), f).toEqual([]);
      expect(s.replace(/[0-9a-f]{64}/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ""), f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
  it("the packet never prints an account or routing number", () => {
    const txt = p.policiesPacket({ generatedAt: new Date(`${TODAY}T12:00:00Z`), generatedBy: "Michael", todayIso: TODAY, rows: [], staff: [staff()], nameOf: () => "Michael" });
    expect(txt).toContain("GREENWAY - WRITTEN ACH POLICIES");
    expect(p.hasLongDigitRun(txt.replace(/[0-9a-f]{64}/g, "").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ""))).toBe(false);
  });
});

/**
 * R41 S21: the Test day runbook for the Zoom test with Timberland.
 *
 *   1. the pure core: steps from live state (a step is done only with its
 *      record; unreadable state is never done or ready), the dates the
 *      release uses, what Brenda will see, the Zoom script, the questions;
 *   2. the page and the sheet only READ (no form, no server action, no
 *      insert/update), owner/admin gate, audit line, no-store;
 *   3. wiring: tab, nav-gate, concierge, help FAQ, self-test count;
 *   4. docs, mutation log, public-repo rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "@/lib/payments/ach-test-day-core";
import { BANK_CHECKLIST, TIMBERLAND_PHONE } from "@/lib/payments/ach-bank-setup-core";
import { earliestEffectiveDate, latestUploadAndApproval } from "@/lib/payments/timberland-deadline-core";
import { PRENOTE_WAIT_WORDS, prenoteLiveUploadDay } from "@/lib/payments/timberland-prenote-core";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const CORE = "src/lib/payments/ach-test-day-core.ts";
const STORE = "src/lib/payments/ach-test-day-store.ts";
const PAGE = "src/app/admin/settings/banking/test-day/page.tsx";
const SHEET = "src/app/admin/settings/banking/test-day/sheet/route.ts";
const OPS = "src/app/admin/settings/banking/operations/page.tsx";

const me = (open: d.TestDayCheck["open"]): d.TestDayCheck => ({ payee: "Owner", accountType: "checking", accountLast4: "1234", verificationStatus: "unverified", authState: "verifying", open });
const BASE: d.TestDayState = { todayIso: "2026-11-03", originator: { ready: true, problems: [] }, checks: [me(null)], prenoteFiles: [], gate: { open: false, stage: "no_file", line: "x" }, noticeSendersOk: true };
const next = (s: d.TestDayState) => d.nextStep(d.testDaySteps(s))?.id ?? null;
const TUE_10AM = new Date("2026-11-03T18:00:00Z");

describe("S21 core: the steps follow the records", () => {
  it("self-tests pass (45)", () => {
    expect(d.__runAchTestDayCoreTests()).toEqual({ passed: 45, failed: 0 });
  });
  it("walks the whole prenote test in order", () => {
    const f = { filename: "acctcheck_prenote_2026-11-05_1.ach", status: "released", effectiveDate: "2026-11-05" };
    expect(next(BASE)).toBe("start");
    const planned = { ...BASE, checks: [me({ method: "prenote", status: "planned", eligibleOn: null, stepKind: "download" })] };
    expect(next(planned)).toBe("release");
    const released = { ...planned, prenoteFiles: [f] };
    expect(next(released)).toBe("upload");
    const sent = { ...released, checks: [me({ method: "prenote", status: "sent", eligibleOn: "2026-11-16", stepKind: "wait" })] };
    expect(next(sent)).toBe("mark-uploaded");
    expect(next({ ...sent, prenoteFiles: [{ ...f, status: "uploaded" }] })).toBe("mark-approved");
    const approved = { ...sent, prenoteFiles: [{ ...f, status: "bank_approved" }], gate: { open: false, stage: "waiting", line: "w" } };
    expect(next(approved)).toBe("pass");
    expect(d.testDaySteps(approved).find((x) => x.id === "pass")!.detail).toContain(`Wait until Mon Nov 16 (${PRENOTE_WAIT_WORDS}).`);
    expect(next({ ...approved, gate: { open: true, line: "o" } })).toBeNull();
  });
  it("unreadable state is never done or ready", () => {
    expect(next({ ...BASE, originator: null })).toBe("originator");
    expect(next({ ...BASE, checks: null })).toBe("account");
    const allDone = { ...BASE, checks: [], prenoteFiles: [{ filename: "a", status: "bank_approved", effectiveDate: "2026-11-05" }], gate: null };
    expect(d.testDaySteps(allDone).find((s) => s.id === "pass")!.state).not.toBe("done");
  });
  it("the buttons named are exactly the ones on ACH operations", () => {
    const ops = read(OPS);
    for (const s of d.testDaySteps(BASE)) if (s.button && s.button !== "Mark uploaded" && s.button !== "Mark approved") expect(ops, s.button).toContain(`>${s.button}<`);
    const steps = read("src/lib/payments/timberland-bank-steps-core.ts");
    expect(steps).toContain('press \\"Mark uploaded\\" here');
    expect(steps).toContain('press \\"Mark approved\\" here');
    for (const h of [d.LINKS.checks, d.LINKS.files]) expect(ops).toContain(`id="${h.split("#")[1]}"`);
  });
  it("no account: the advice is the signed authorization, not the old employee bank fields", () => {
    const s = d.testDaySteps({ ...BASE, checks: [] }).find((x) => x.id === "account")!;
    expect(s.state).toBe("now");
    expect(s.detail).toContain("e-sign");
    expect(s.detail).toContain("old bank fields on the employee record are not used");
  });
});

describe("S21 core: dates, file, Zoom, questions", () => {
  it("the timeline uses the release rules (Tue Nov 3 -> eff Thu Nov 5, upload by 3:30 pm, live from Mon Nov 16)", () => {
    const t = d.testTimeline(TUE_10AM);
    expect(t.effective).toBe(earliestEffectiveDate(TUE_10AM));
    expect(t.effective).toBe("2026-11-05");
    expect(t.uploadBy).toBe(latestUploadAndApproval("2026-11-05").text);
    expect(t.liveFrom).toBe(prenoteLiveUploadDay("2026-11-05"));
    expect(t.liveFrom).toBe("2026-11-16");
  });
  it("what Brenda sees comes from the builder constants", () => {
    const s = d.whatBrendaSees().join(" ");
    for (const w of ["PPD", "PAYROLL", "transaction code 23", "33 (savings)", "$0.00", "ACCTVERIFY"]) expect(s).toContain(w);
    expect(/[0-9]{7,}/.test(s)).toBe(false);
  });
  it("questions are the open Bank setup items (debit block in, dual out)", () => {
    const q = d.callQuestions();
    expect(q.map((x) => x.title)).toEqual(BANK_CHECKLIST.filter((i) => i.status === "ask").map((i) => i.title));
    expect(q.some((x) => /debit block/i.test(x.title))).toBe(true);
    expect(q.some((x) => /Dual approval/.test(x.title))).toBe(false);
  });
  it("the sheet: header, phone, ticks, portal notes, no digit run", () => {
    const sheet = d.testDaySheet(BASE, TUE_10AM);
    expect(sheet.startsWith("GREENWAY MARIJUANA - ACH TEST DAY WITH TIMBERLAND (ZOOM)")).toBe(true);
    expect(sheet).toContain(TIMBERLAND_PHONE);
    expect(sheet).toContain("[x] 1. Greenway's ACH company details match Timberland");
    expect(sheet).toContain("[ ] 3. Start a prenote for your account (button: Start check)");
    for (const n of d.PORTAL_NOTES) expect(sheet).toContain(n);
    expect(/[0-9]{7,}/.test(sheet.split(TIMBERLAND_PHONE).join(""))).toBe(false);
    // the last guard: the core refuses to return a sheet with a 7+ digit run
    expect(read(CORE)).toContain('  if (hasLongDigitRun(text)) throw new Error("testDaySheet: a run of 7+ digits would be printed");');
  });
});

describe("S21 page and sheet only read", () => {
  it("page: owner/admin gate, live reads, no forms or actions", () => {
    const pg = read(PAGE);
    expect(pg).toContain('await requirePermission("settings.manage");');
    expect(pg).toContain("readTestDayState(today)");
    expect(pg).toContain('<BankingSubnav active="testday"');
    expect(pg).not.toMatch(/<form|action=\{|"use server"|\.insert\(|\.update\(|\.rpc\(/);
    for (const id of ["ready", "steps", "timeline", "brenda-sees", "zoom", "questions"]) expect(pg).toContain(`id="${id}"`);
    expect(pg).toContain("DATA_ENCRYPTION_KEY");
    expect(pg).toContain("encryptionKeySet()");
    expect(pg).toContain('{r.ok === null ? "unknown" : r.ok ? "ready" : "fix"}');
    expect(pg).toContain('data-ready={r.ok === null ? "unknown" : r.ok ? "yes" : "no"}');
    expect(pg).toContain("{ ok: keySet, text: \"The server can read stored bank numbers (encryption key set)\"");
  });
  it("store: read only, unreadable becomes null", () => {
    const st = read(STORE);
    expect(st).toContain('import "server-only";');
    expect(st).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    expect(st).toContain("view && view.ready && !view.error");
    expect(st).toContain("files && files.tableReady && !files.error");
    expect(st).toContain("gate && gate.ok");
    expect(st).toContain('f.kind === "prenote"');
  });
  it("sheet route: gate, audit, no-store", () => {
    const r = read(SHEET);
    expect(r).toContain('const session = await requirePermission("settings.manage");');
    expect(r).toContain('action: "ach.test_day.sheet"');
    expect(r).toContain('"Cache-Control": "no-store"');
    expect(r).not.toMatch(/\.insert\(|\.update\(|\.rpc\(/);
  });
});

describe("S21 wiring", () => {
  it("tab after Bank setup", () => {
    const keys = BANKING_HELP_TABS.map((t) => t.key);
    expect(keys[keys.length - 1]).toBe("testday");
    expect(keys[keys.length - 2]).toBe("banksetup");
    expect(BANKING_HELP_TABS.find((t) => t.key === "testday")!.href).toBe("/admin/settings/banking/test-day");
  });
  it("help FAQ, concierge, nav-gate, self-test", () => {
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/settings/banking/test-day"');
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Test day is /admin/settings/banking/test-day");
    expect(kb).toContain("Test day (R41 S21, /admin/settings/banking/test-day)");
    expect(read("tests/compliance/nav-gate-core.test.ts")).toContain('"/admin/settings/banking/test-day",');
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ach-test-day-core", __runAchTestDayCoreTests(), 45)');
  });
});

describe("S21 docs and rules", () => {
  it("T-381 in the test plan and the manual; roadmap S21 row and detail", () => {
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-381 (Test day runbook for the Zoom test with Timberland (R41 S21, no migration)):**");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-381"');
    expect(man).toContain('"T-381": "part-b--the-results-log"');
    const rm = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(rm).toMatch(/\| S21 \|[^\n]*\| #\d+ \| none \|/);
    expect(rm).toContain("## S21 in detail");
    expect(rm).toContain("Manual test T-381.");
  });
  it("mutation log (mutate-s21-app.last.log): every mutant killed", () => {
    const log = read("scripts/r41/mutate-s21-app.last.log");
    expect(log.trim()).toMatch(/total (\d+) killed \1 survivors \[\]$/);
  });
  it("public-repo rules: no long digit runs, no emails, only the published phone", () => {
    for (const f of [CORE, STORE, PAGE, SHEET]) {
      const s = read(f);
      expect(/[0-9]{9,}/.test(s), f).toBe(false);
      expect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(s), f).toBe(false);
      const phones = s.match(/\b\d{1}-\d{3}-\d{3}-\d{4}\b|\(\d{3}\)\s*\d{3}-\d{4}/g) ?? [];
      for (const p of phones) expect(p, f).toBe(TIMBERLAND_PHONE);
    }
  });
});

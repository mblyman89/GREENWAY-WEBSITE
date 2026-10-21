/**
 * R41 S13: notices, corrections and the reversal call sheet.
 *
 *   1. three new Timberland log types (0287): a wrong NOC (15 calendar days, D-10), an OFAC
 *      notice from Timberland (open until resolved), a bank report received (download within
 *      60 calendar days, the Fed's retention);
 *   2. every new quote is verbatim in its mirror (whitespace flattened);
 *   3. the reversal call sheet: built from the stored file, never an account number;
 *   4. 0287 content pins, rollback, docs, mutation logs (test the tests);
 *   5. public-repo rules across the files touched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "@/lib/payments/timberland-obligations-core";
import { EMAIL3_REVERSAL_QUOTE, reversalSheet, sheetEntries, type SheetFileRow } from "@/lib/payments/ach-reversal-sheet-core";
import { testFileForChecker } from "@/lib/payments/timberland-file-checker-core";
import { headerFacts } from "@/lib/payments/ach-file-ledger-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const today = "2026-10-20";
const now = new Date("2026-10-20T18:00:00Z");
type R = core.CommsRow;
const row = (p: Partial<R> & Pick<R, "id" | "entry_type">): R => ({ received_on: today, occurred_at: null, effective_on: null, amount_cents: null, summary: "x", closes_id: null, created_at: "2026-10-20T18:00:00Z", ...p });
const one = (r: R) => core.obligationClocks({ todayIso: today, nowUtc: now, comms: [r], notices: [] });

describe("R41 S13: the three new log types", () => {
  it("are offered, in order, after the S10 clock types; all three have a clock (the 0287 close list)", () => {
    expect(core.COMMS_TYPES.slice(10, 13)).toEqual(["noc_wrong", "ofac_notice", "bank_report_received"]);
    for (const t of ["noc_wrong", "ofac_notice", "bank_report_received"] as const) {
      const s = core.COMMS_TYPE_SPECS[t];
      expect(s.clock, t).toBe(true);
      expect([s.needsTime, s.needsSecondDate, s.needsAmount], t).toEqual([false, false, false]);
    }
  });
  it("a wrong NOC: 15 calendar days from the day it ARRIVED (section 7), call Cash Management", () => {
    const c = one(row({ id: "n", entry_type: "noc_wrong", received_on: "2026-10-19" }))[0];
    expect(c.dueDate).toBe("2026-11-03");
    expect(c.section).toBe("\u00a77");
    expect(c.action).toContain("Cash Management (1-800-562-8761)");
    expect(c.action).toContain("cannot build a Refused NOC");
    expect(core.COMMS_TYPE_SPECS.noc_wrong.hint).toContain("date the correction ARRIVED");
  });
  it("an OFAC notice: no deadline, red, until Cash Management says it is resolved", () => {
    const c = one(row({ id: "o", entry_type: "ofac_notice" }))[0];
    expect([c.dueDate, c.dueUtc, c.tone, c.section]).toEqual([null, null, "danger", "\u00a73"]);
    expect(core.obligationClocks({ todayIso: today, nowUtc: now, comms: [row({ id: "o", entry_type: "ofac_notice" }), row({ id: "d", entry_type: "done", closes_id: "o" })], notices: [] })).toEqual([]);
  });
  it("a bank report: download within 60 calendar days (the Fed deletes it)", () => {
    const c = one(row({ id: "b", entry_type: "bank_report_received", received_on: "2026-10-19" }))[0];
    expect(c.dueDate).toBe("2026-12-18");
    expect(c.action).toContain("60 calendar days");
    expect(core.FED_REPORT_RETENTION_CALENDAR_DAYS).toBe(60);
    expect(core.COMMS_TYPE_SPECS.bank_report_received.hint).toContain("Reporting, Electronic Documents");
  });
  it("the refuse-by line on every bank correction now says to contact Cash Management", () => {
    const n = core.obligationClocks({ todayIso: today, nowUtc: now, comms: [], notices: [{ id: "n1", notice_kind: "noc", code: "C01", received_on: "2026-10-19", apply_by: "2026-10-27", payee: "Pat" }] });
    const r = n.find((c) => c.key === "refuse:n1");
    expect(r?.dueDate).toBe("2026-11-03");
    expect(r?.action).toContain("contact Timberland Cash Management (1-800-562-8761)");
    expect(r?.action).not.toContain("in writing");
  });
  it("a new type refused by a database without 0287 names the migration", () => {
    expect(core.commsDbErrorMessage('new row for relation "ach_timberland_comms" violates check constraint "ach_timberland_comms_entry_type_check"')).toMatch(/run migration 0287/);
  });
});

describe("R41 S13: quotes are verbatim to the mirrors", () => {
  it("Email 3 answers 18 and 21, and the Fed guide's 60 days", () => {
    for (const t of ["noc_wrong", "ofac_notice", "bank_report_received"] as const) {
      const q = core.COMMS_TYPE_SPECS[t].quote!;
      expect(flat(read(`docs/authorities/${q.file}`)), t).toContain(flat(q.text));
    }
    expect(core.COMMS_TYPE_SPECS.noc_wrong.quote!.file).toBe(core.EMAIL3_FILE);
    expect(core.COMMS_TYPE_SPECS.bank_report_received.quote!.file).toBe(core.FED_EDI_FILE);
    expect(flat(read(`docs/authorities/${EMAIL3_REVERSAL_QUOTE.file}`))).toContain(flat(EMAIL3_REVERSAL_QUOTE.text));
  });
  it("the Fed guide mirror is listed in the ACH README with its source URL and PDF fingerprint", () => {
    const r = read("docs/authorities/ach/README.md");
    expect(r).toContain("| frbservices-edi-encrypted-email-guide.txt | https://www.frbservices.org/wp-content/uploads/edi-use-guide.pdf |");
    expect(r).toContain("a4204295adaa5515fdb5146c3a65b4c399abb3ff1666d6039ac9783acbddc63e");
    const m = read("docs/authorities/ach/frbservices-edi-encrypted-email-guide.txt");
    expect(m).toContain("Revised 06/26/24");
    expect(flat(m)).toContain("If you need to retain reports longer than 60 calendar days, you will need to download and store them elsewhere.");
  });
});

describe("R41 S13: the reversal call sheet", () => {
  const fx = testFileForChecker({ entries: [{ amountCents: 12_345 }, { amountCents: 6_700 }], description: "PAYROLL", sec: "PPD", effective: "2026-10-23", created: new Date("2026-10-20T17:00:00Z") });
  const f = headerFacts(fx);
  if (!f.ok) throw new Error("fixture");
  const base: SheetFileRow = { filename: "GW-x.ach", kind: "vendor", status: "uploaded", file_date: f.facts.fileDate, file_id_modifier: f.facts.modifier, effective_date: f.facts.effectiveDate, settlement_date: "2026-10-23", entry_count: 2, total_cents: f.facts.totalCreditCents, sha256: "c".repeat(64), uploaded_at: null };
  it("lists the file facts and every payment with its trace, never an account or routing number", () => {
    const s = reversalSheet(fx, base);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.entries.map((e) => [e.seq, e.name, e.amountCents])).toEqual([[1, "TEST PAYEE 1", 12_345], [2, "TEST PAYEE 2", 6_700]]);
    expect(s.text).toContain("Cash Management: 1-800-562-8761");
    expect(s.text).toContain("Settlement date ...... 2026-10-23");
    expect(s.text).toContain("Uploaded ............. time not recorded");
    expect(s.text).toContain("Total ................ $190.45");
    for (const r of fx.split(/\r?\n/).filter((x) => x[0] === "6")) {
      expect(s.text).not.toContain(r.slice(12, 29).trim());
      expect(s.text).not.toContain(r.slice(3, 12));
    }
    expect(s.text).not.toMatch(/0012345/);
  });
  it("only for a file that went to Timberland; record and bytes must agree", () => {
    expect(reversalSheet(fx, { ...base, status: "released" }).ok).toBe(false);
    expect(reversalSheet(fx, { ...base, status: "voided" }).ok).toBe(false);
    expect(reversalSheet(fx, { ...base, file_id_modifier: "B" }).ok).toBe(false);
    expect(reversalSheet(fx, { ...base, effective_date: "2026-10-26" }).ok).toBe(false);
    expect(sheetEntries("6" + "x".repeat(10)).ok).toBe(false);
  });
  it("the route: settings.manage, re-checked bytes, audited, never cached; linked from Operations for uploaded files", () => {
    const r = read("src/app/admin/settings/banking/files/[id]/reversal-sheet/route.ts");
    expect(r).toContain('await requirePermission("settings.manage")');
    expect(r).toContain("readAchFileForDownload(id)");
    expect(r).toContain("reversalSheet(res.body, res.row)");
    expect(r).toContain('action: "ach.file.reversal_sheet"');
    expect(r).toContain('"Cache-Control": "no-store"');
    // every response (errors AND the 200 sheet) must say no-store
    const cc = r.match(/"Cache-Control": "[^"]*"/g) ?? [];
    expect(cc.length).toBe(3);
    expect(cc.every((x) => x === '"Cache-Control": "no-store"')).toBe(true);
    expect(r).toContain('      "Cache-Control": "no-store",\n      "X-Content-Type-Options": "nosniff",');
    expect(r).not.toMatch(/body_enc|account_number/);
    const p = read("src/app/admin/settings/banking/operations/page.tsx");
    expect(p).toContain('{f.status === "uploaded" || f.status === "bank_approved" ? (');
    expect(p).toContain("/admin/settings/banking/files/${f.id}/reversal-sheet");
  });
});

describe("0287 content pins", () => {
  const m = read("supabase/migrations/0287_ach_timberland_comms_notices.sql");
  it("CI runs the 0287 check after every migration, and the 0277 check still runs", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ach-timberland-comms-0287-pg-check.sql", mustPrint: "ACH 0287 CHECK PASSED" });
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ach-timberland-comms-0277-pg-check.sql", mustPrint: "ACH 0277 CHECK PASSED" });
  });
  it("adds the three types to the list and to the guard's close list; not security definer", () => {
    expect(m).toContain("    'noc_wrong', 'ofac_notice', 'bank_report_received'));");
    expect(m).toContain("                                 'noc_wrong', 'ofac_notice', 'bank_report_received') then");
    expect(m).not.toMatch(/security definer\n/i);
    expect(m).toContain("raise exception 'ACH_COMMS_APPEND_ONLY");
    expect(m).toContain("ach_write_by_owner(new.created_by)");
  });
  it("the rollback refuses while a new-type row exists and restores the 0277 guard verbatim", () => {
    const rb = read("supabase/rollbacks/0287_ach_timberland_comms_notices.rollback.sql");
    expect(rb).toContain("where entry_type in ('noc_wrong', 'ofac_notice', 'bank_report_received')");
    const m77 = read("supabase/migrations/0277_ach_timberland_comms.sql");
    const g = (s: string) => {
      const i = s.indexOf("create or replace function public.ach_timberland_comms_guard()");
      return s.slice(i, s.indexOf("end $$;", i) + 7);
    };
    expect(g(rb)).toBe(g(m77));
  });
  it("MIGRATIONS_TO_RUN has the 0287 section with its check", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("## R41 \u2014 0287 \u2014 Three new Timberland log types");
    expect(d).toContain("scripts/recon/ach-timberland-comms-0287-pg-check.sql");
    expect(d).toContain("ACH 0287 CHECK PASSED");
  });
});

describe("S13 docs", () => {
  it("TEST-PLAN has T-373, the manual lists it, the roadmap has the S12 PR and the S13 row", () => {
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-373 (");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-373"');
    expect(man).toContain('"T-373": "part-b--the-results-log"');
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| #1444 | none |");
    expect(r).toContain("| S13 | Notices and corrections");
    expect(r).toContain("## S13 in detail");
  });
});

describe("S13 mutation runs (test the tests)", () => {
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
  it("scripts/r41/mutate-0287-sql.last.log: 14 SQL mutants killed, plus the rolled-back and rollback-refuses probes", () => {
    pin("scripts/r41/mutate-0287-sql.py", "scripts/r41/mutate-0287-sql.last.log", 14);
    const log = read("scripts/r41/mutate-0287-sql.last.log");
    expect(log).toMatch(/killed {3}rolled-back/);
    expect(log).toMatch(/killed {3}rollback-refuses/);
  });
  it("scripts/r41/mutate-s13-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s13-app.py", "scripts/r41/mutate-s13-app.last.log", 14);
  });
});

describe("S13 public-repo rules", () => {
  const files = [
    "src/lib/payments/timberland-obligations-core.ts",
    "src/lib/payments/ach-reversal-sheet-core.ts",
    "src/app/admin/settings/banking/files/[id]/reversal-sheet/route.ts",
    "supabase/migrations/0287_ach_timberland_comms_notices.sql",
    "supabase/rollbacks/0287_ach_timberland_comms_notices.rollback.sql",
    "scripts/recon/ach-timberland-comms-0287-pg-check.sql",
  ];
  it("one phone only, no emails, no long digit runs", () => {
    for (const f of files) {
      const s = read(f);
      const phones = s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? [];
      expect(phones.filter((p) => !p.endsWith("562-8761")), f).toEqual([]);
      expect(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)?.filter((e) => !e.endsWith("@x.test")) ?? [], f).toEqual([]);
      // the pg-check's deliberate fake ("acct 123456789", refused by the summary rule) is the only allowed run
      expect(s.replace(/acct 123456789/g, ""), f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
});

/**
 * R41 S8: docs, help, concierge, test plan, the yearly Timberland tasks, the
 * agreement entries in the Legal library, the Q14 constant and the Nacha 3 vs
 * Timberland 6 source (82 FR 42597).
 *
 * Plan (R41-TIMBERLAND-SLICE-PLAN v4, S8): T-359+, the deep-link test,
 * docs/roadmap/R41-TIMBERLAND.md; calendar tasks (yearly re-read, limits,
 * name/ID, Schedule F self-check); library additions (sections 25, 11, 18, 21,
 * 23, 17 and the Schedule F notice), verbatim, each with "how we protect you".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACH_CAL_TASKS, evaluateAchCalendar } from "@/lib/payments/ach-calendar-core";
import { ACH_LEGAL_LIBRARY } from "@/lib/payments/ach-legal-library";
import { OPEN_QUESTIONS } from "@/lib/payments/timberland-profile-core";
import { buildNachaFile, PAYROLL_BATCH_DISCRETIONARY_DATA } from "@/lib/payments/nacha-core";
import { greenwayTestOriginator } from "@/lib/payments/timberland-originator-core";

const ROOT = join(__dirname, "..", "..");
const AUTH = join(ROOT, "docs", "authorities");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const TIMBERLAND_MIRROR = "ach/timberland-ach-agreement-2026-10-14.redacted.txt";
const FR_MIRROR = "docs/authorities/ach/fr-2017-19135-prenote-three-banking-days.txt";

const S8_TASKS = ["timberland_agreement_reread", "timberland_limits_reconfirm", "timberland_name_id_reconfirm", "timberland_schedule_f_selfcheck"] as const;
const S8_LAWS = [
  "timberland-s25-liability",
  "timberland-s11-indemnity",
  "timberland-s18-no-cancel",
  "timberland-s21-reversals",
  "timberland-s23-account-number",
  "timberland-s17-thirty-days",
  "timberland-schedule-f-notice",
] as const;

/** Page file + anchor literal for an in-app link (anchor must be rendered by the page folder). */
function linkLands(link: string): { page: boolean; anchor: boolean } {
  const [pathAndQuery, anchor] = link.split("#");
  const path = pathAndQuery.split("?")[0].replace(/\/$/, "");
  const file = join(ROOT, "src", "app", ...path.split("/").filter(Boolean), "page.tsx");
  if (!existsSync(file)) return { page: false, anchor: false };
  return { page: true, anchor: anchor ? readFileSync(file, "utf8").includes(`id="${anchor}"`) : true };
}

// ---------------------------------------------------------------- Q14 ----
describe("Q14: PAYROLL batch discretionary data stays blank until Brenda answers", () => {
  const entries = [{ name: "PAT WORKER", routing: "021000021", accountNumber: "0012345678", accountType: "checking" as const, amountCents: 1000, idNumber: "E1" }];
  const base = { entries, originator: greenwayTestOriginator(), effectiveDate: new Date("2026-10-06T19:00:00Z"), createdAt: new Date("2026-10-05T17:00:00Z") };
  const batchHeader = (file: string) => file.split(/\r?\n/).find((l) => l.startsWith("5"))!;

  it("the constant is blank (strict default)", () => {
    expect(PAYROLL_BATCH_DISCRETIONARY_DATA).toBe("");
  });
  it("a real PPD PAYROLL file has spaces in batch positions 21-40 and PAYROLL in 54-63", () => {
    const r = buildNachaFile({ ...base, secCode: "PPD", companyEntryDescription: "PAYROLL" });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const h5 = batchHeader((r as { file: string }).file);
    expect(h5.length).toBe(94);
    expect(h5.slice(20, 40)).toBe(" ".repeat(20));
    expect(h5.slice(53, 63)).toBe("PAYROLL   ");
  });
  it("a vendor (CCD) file never gets the payroll discretionary data", () => {
    const r = buildNachaFile({ ...base, secCode: "CCD", companyEntryDescription: "VENDOR PAY" });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(batchHeader((r as { file: string }).file).slice(20, 40)).toBe(" ".repeat(20));
  });
  it("the builder reads the constant only for PPD + PAYROLL (one line to change if Brenda says yes)", () => {
    expect(read("src/lib/payments/nacha-core.ts")).toContain(
      'alpha(secCode === "PPD" && companyEntryDescription === "PAYROLL" ? PAYROLL_BATCH_DISCRETIONARY_DATA : "", 20)',
    );
  });
});

// ------------------------------------------------------- open questions ----
describe("questions for Brenda (answered in Email 3, R41 S12)", () => {
  it("ids are Q1, Q3..Q15, Q18, Q20, Q21..Q26 (Q2 removed by the owner, round 5; Q16, Q17, Q19 answered by Email 2)", () => {
    expect(OPEN_QUESTIONS.map((q) => q.id)).toEqual(["Q1", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "Q18", "Q20", "Q21", "Q22", "Q23", "Q24", "Q25", "Q26"]);
  });
  it("Q18: test credits COUNT toward the limits (her answer)", () => {
    const q = OPEN_QUESTIONS.find((x) => x.id === "Q18")!;
    expect(q.answers[0]!.quote).toMatch(/it would count in the calculation/);
    expect(q.appDoes).toMatch(/COUNT/);
    expect(q.affects).toEqual(["prenotesCount"]);
  });
  it("Q20 cites 82 FR 42597 and keeps Timberland's 6 (owner decision D-1)", () => {
    const q = OPEN_QUESTIONS.find((x) => x.id === "Q20")!;
    expect(q.label).toContain("82 FR 42597");
    expect(q.appDoes).toMatch(/\b6\b/);
    expect(q.decision).toBe("D-1");
    expect(q.affects).toEqual(["prenoteWaitBankingDays"]);
  });
});

// ------------------------------------------------- 82 FR 42597 mirror ----
describe("Nacha 3 vs Timberland 6: the federal source", () => {
  const m = read(FR_MIRROR);
  it("header names the official govinfo URL, the citation page and both fingerprints", () => {
    const head = m.slice(0, 2000);
    expect(head).toContain("https://www.govinfo.gov/content/pkg/FR-2017-09-11/html/2017-19135.htm");
    expect(head).toContain("https://www.federalregister.gov/citation/82-FR-42597");
    expect(head).toMatch(/sha256 of the fetched HTML: [0-9a-f]{64}/);
    expect(head).toContain("2e85e0069b95b34e885852aef92d38df1427399155f5b30631b622ae451643fa");
    expect(head).toContain('"A. 2014 NACHA Operating Rules & Guidelines Book Changes"');
  });
  it("amendment 9 is quoted: six banking days reduced; third Banking Day after settlement", () => {
    const f = flat(m);
    expect(f).toContain("This amendment reduced the six banking-day waiting period between initiation of a Prenotification and ``live'' Entries");
    expect(f).toContain("as soon as the third Banking Day following the Settlement Date of the Prenotification Entry, provided that the ODFI has not received a return or NOC related to the Prenotification.");
  });
  it("no contact block (public repo): no phone numbers or e-mail addresses", () => {
    const body = m.split("----- verbatim excerpt -----")[1];
    expect(body).not.toMatch(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/);
    expect(body).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(body).not.toContain("FOR FURTHER INFORMATION CONTACT");
  });
  it("the app still waits Timberland's 6 (Q20 strict) and keeps Nacha's 3 only as the floor", () => {
    expect(read("src/lib/payments/ach-authorization-core.ts")).toContain("export const NACHA_MIN_PRENOTE_WAIT_BANKING_DAYS = 3;");
    expect(read("src/lib/payments/timberland-profile-core.ts")).toMatch(/prenoteWaitBankingDays: \{[\s\S]{0,80}value: 6,/);
  });
});

// ------------------------------------------------------ calendar tasks ----
describe("four yearly Timberland tasks", () => {
  for (const id of S8_TASKS) {
    it(`${id}: yearly, verbatim quote in its mirror, link lands on a real page and anchor`, () => {
      const t = ACH_CAL_TASKS.find((x) => x.id === id)!;
      expect(t, id).toBeDefined();
      expect(t.cadence).toBe("annual");
      expect(t.title.startsWith("Year-end:")).toBe(true);
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.quote, `${id} has a quote`).toBeDefined();
      expect(flat(readFileSync(join(AUTH, t.quote!.file), "utf8")).includes(flat(t.quote!.text))).toBe(true);
      const land = linkLands(t.href!);
      expect(land.page, `${t.href} page`).toBe(true);
      expect(land.anchor, `${t.href} anchor`).toBe(true);
      for (const law of t.lawIds ?? []) expect(ACH_LEGAL_LIBRARY.some((e) => e.id === law), law).toBe(true);
    });
  }
  it("the agreement re-read quotes section 28 (amendment by notice)", () => {
    const t = ACH_CAL_TASKS.find((x) => x.id === "timberland_agreement_reread")!;
    expect(t.quote!.text).toContain("Such amendments shall become effective upon receipt of notice by Company");
    expect(t.quote!.file).toBe(TIMBERLAND_MIRROR);
  });
  it("the Schedule F self-check repeats the published phone and the 1-calendar-day rule", () => {
    const t = ACH_CAL_TASKS.find((x) => x.id === "timberland_schedule_f_selfcheck")!;
    const all = [t.why, ...t.steps].join(" ");
    expect(all).toContain("1-800-562-8761");
    expect(all).toContain("within 1 calendar day");
    expect(flat(read(`docs/authorities/${TIMBERLAND_MIRROR}`))).toContain("followed by written confirmation within 1 calendar day of verbal notice");
  });
  it("upcoming on 11-15, due soon on 11-16 (45-day annual window), overdue in January if not done", () => {
    const st = (d: string) => evaluateAchCalendar(d, {}, { llamaParseConfigured: false });
    for (const id of S8_TASKS) {
      expect(st("2026-11-15").find((e) => e.task.id === id)?.status).toBe("upcoming");
      expect(st("2026-11-16").find((e) => e.task.id === id)?.status).toBe("due_soon");
    }
  });
});

// -------------------------------------------------- library agreement ----
describe("Legal library: the Timberland agreement entries", () => {
  const byId = Object.fromEntries(ACH_LEGAL_LIBRARY.map((e) => [e.id, e]));
  it("exactly the seven planned entries, all kind agreement, all from the redacted mirror", () => {
    const got = ACH_LEGAL_LIBRARY.filter((e) => e.kind === "agreement").map((e) => e.id);
    expect(got).toEqual([...S8_LAWS]);
    for (const id of S8_LAWS) {
      expect(byId[id].sourceFile).toBe(TIMBERLAND_MIRROR);
      expect(byId[id].source.startsWith("private:")).toBe(true);
    }
  });
  it("each quote starts at its section heading / sentence (cut mechanically, not retyped)", () => {
    expect(byId["timberland-s25-liability"].quote.startsWith("25. Liability. Financial Institution shall be responsible only")).toBe(true);
    expect(byId["timberland-s18-no-cancel"].quote.startsWith("18. Cancellation or Amendment of Entries.")).toBe(true);
    expect(byId["timberland-s21-reversals"].quote.startsWith("21. Reversals.")).toBe(true);
    expect(byId["timberland-s23-account-number"].quote.startsWith("23. Name and Account Number Inconsistency.")).toBe(true);
    expect(byId["timberland-s17-thirty-days"].quote.startsWith("17. Settlement Discrepancies.")).toBe(true);
    expect(byId["timberland-s17-thirty-days"].quote).toContain("not to exceed 30 calendar days");
    expect(byId["timberland-schedule-f-notice"].quote).toContain("within 1 calendar day of verbal notice");
  });
  it("no long digit runs (account numbers) leak into any agreement quote", () => {
    for (const id of S8_LAWS) expect(byId[id].quote, id).not.toMatch(/\d{7,}/);
  });
  it("'how we protect you' is honest: section 18 says a file at the bank cannot be pulled back by the app", () => {
    const t = byId["timberland-s18-no-cancel"].howWeProtectYou;
    expect(t).toContain("cannot pull back a file already uploaded");
    expect(t).toContain("1-800-562-8761");
    // 0273 really does allow voiding after upload (the reason the wording says so)
    expect(read("supabase/migrations/0273_ach_files.sql")).toContain("(old.status = 'uploaded' and new.status in ('bank_approved', 'voided'))");
  });
  it("'how we protect you' is honest: vendors are verified by a call-back, not a prenote", () => {
    expect(byId["timberland-s23-account-number"].howWeProtectYou).toContain("vendor records by a call-back at a number on file");
    expect(read("src/lib/payments/vendor-ach-enrollment-core.ts")).toContain("then verify it by calling a number you already have");
  });
  it("every appLink lands on a real page and anchor", () => {
    for (const id of S8_LAWS) {
      const land = linkLands(byId[id].appLink);
      expect(land.page && land.anchor, `${id} -> ${byId[id].appLink}`).toBe(true);
    }
  });
  it("the library page has the #timberland section and never renders a private source as a link", () => {
    const p = read("src/app/admin/settings/banking/library/page.tsx");
    expect(p).toContain('<section id="timberland"');
    expect(p).toContain('agreement: { word: "Timberland agreement"');
    expect(p).toMatch(/e\.kind === "agreement" \? \(\s*\/\/[^\n]*\n\s*<span data-private-source>/);
    expect(p).toContain('const laws = ACH_LEGAL_LIBRARY.filter((e) => e.kind !== "case" && e.kind !== "agreement");');
  });
});

// ---------------------------------------------------- help, docs, plan ----
describe("help, concierge, test plan, roadmap", () => {
  it("help FAQ and concierge mention the agreement section and the yearly tasks", () => {
    const h = read("src/lib/admin/help-content.ts");
    expect(h).toContain("'Your Timberland agreement'");
    expect(h).toContain("the Schedule F security self-check");
    const k = read("src/lib/admin/concierge-kb.ts");
    expect(k).toContain("/admin/settings/banking/library#timberland");
    expect(k).toContain("Yearly Calendar tasks added in R41 S8");
  });
  it("TEST-PLAN has T-359, T-360, T-361 and the manual lists them", () => {
    const tp = read("docs/audit/TEST-PLAN.md");
    for (const t of ["T-359", "T-360", "T-361"]) expect(tp).toContain(`- **${t} (`);
    const man = read("docs/audit/test-manual/index.html");
    for (const t of ["T-359", "T-360", "T-361"]) expect(man).toContain(t);
  });
  it("roadmap doc exists and lists S0..S8 with their PRs", () => {
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    for (const pr of ["#1372", "#1373", "#1374", "#1375", "#1377", "#1378", "#1380", "#1381", "#1382", "#1383", "#1384"]) expect(r).toContain(pr);
    expect(r).toContain("82 FR 42597");
  });
});

// ------------------------------------------------------ mutation run ----
describe("S8 mutation run (test the tests)", () => {
  it("scripts/r41/mutate-s8-docs.last.log: every mutant killed, controls pass", () => {
    const script = read("scripts/r41/mutate-s8-docs.py");
    const log = read("scripts/r41/mutate-s8-docs.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(12);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR|control .* FAIL/);
  });
});

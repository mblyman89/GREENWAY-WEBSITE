/**
 * R41 S2: originator validation + "what Timberland sees" + the confirmation stamp.
 *
 * Source of the rules: Brenda (Timberland Cash Management),
 * docs/authorities/ach/timberland-brenda-2026-10.txt, EMAIL 1: "There are 3
 * parameters I need to have match my side." (Company Name, Company ID, an
 * unbalanced batch; each quote pinned below.) Plan: R41-TIMBERLAND-SLICE-PLAN.md v4, slice S2.
 *
 * This file pins the WIRING: that the pure validator is the one gate every
 * builder, page and save path goes through, and that migration 0272 does what
 * its header says. The behaviour itself is proven by the pure self-tests
 * (timberland-originator-core 68, nacha-core 76, timberland-preview-core 19),
 * run here and in scripts/compliance/run-pure-selftests.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runTimberlandOriginatorCoreTests, greenwayTestOriginator, originatorReadiness, validateOriginator, checkSecCode, TEST_EIN } from "@/lib/payments/timberland-originator-core";
import { __runNachaCoreTests, buildNachaFile } from "@/lib/payments/nacha-core";
import { __runTimberlandPreviewCoreTests, timberlandPreview, THREE_NAMES } from "@/lib/payments/timberland-preview-core";

const ROOT = join(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Code without comments, so a comment cannot satisfy a wiring check. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sqlStrip = (s: string) => s.replace(/--.*$/gm, "");

describe("pure cores: self-tests pass with their floors", () => {
  it("timberland-originator-core >= 68", () => {
    const r = __runTimberlandOriginatorCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(68);
  });
  it("nacha-core >= 76", () => {
    const r = __runNachaCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(76);
  });
  it("timberland-preview-core >= 19", () => {
    const r = __runTimberlandPreviewCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(19);
  });
  it("all three are registered in run-pure-selftests with those floors", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toMatch(/assertRan\("timberland-originator-core", __runTimberlandOriginatorCoreTests\(\), 68\)/);
    expect(src).toMatch(/assertRan\("nacha-core", __runNachaCoreTests\(\), 76\)/);
    expect(src).toMatch(/assertRan\("timberland-preview-core", __runTimberlandPreviewCoreTests\(\), 19\)/);
  });
});

describe("import graph: no cycle, the leaf has no imports", () => {
  it("nacha-fields-core imports nothing", () => {
    expect(strip(read("src/lib/payments/nacha-fields-core.ts"))).not.toMatch(/^\s*import\s/m);
  });
  it("timberland-originator-core takes only a TYPE from nacha-core (erased at runtime: no cycle)", () => {
    const s = strip(read("src/lib/payments/timberland-originator-core.ts"));
    const fromNacha = [...s.matchAll(/^import[^;]*from\s+"(?:\.\/|@\/lib\/payments\/)nacha-core";/gm)].map((m) => m[0]);
    expect(fromNacha).toEqual(['import type { AchOriginator } from "./nacha-core";']);
    expect(strip(read("src/lib/payments/nacha-core.ts"))).toMatch(/from "\.\/timberland-originator-core"/);
  });
});

describe("the builder refuses before and checks after", () => {
  const src = strip(read("src/lib/payments/nacha-core.ts"));
  const body = src.slice(src.indexOf("export function buildNachaFile("));
  it("checkSecCode, then checkOriginatorForFile, then (after the records) checkBuiltFileShape", () => {
    const a = body.indexOf("checkSecCode(");
    const b = body.indexOf("checkOriginatorForFile(");
    const c = body.indexOf("checkBuiltFileShape(");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
  it("the shape problems stop the file: refused before the return of the file text", () => {
    // A correct builder cannot produce a bad shape, so this net is proven two
    // ways: nacha-core's self-test tampers ONE field of a real file per case
    // (14 cases), and this pin proves the builder acts on the answer.
    const i = body.indexOf("const shape = checkBuiltFileShape(file, originator);");
    expect(i).toBeGreaterThan(0);
    const next = body.slice(i, body.indexOf("return { ok: true, file", i));
    expect(next).toMatch(/\n\s*if \(shape\.length\) return \{ ok: false, error: `The ACH file failed its own check, so it was not released: \$\{shape\.join\("; "\)\}\.` \};\n/);
  });
  it("behaviour: a wrong-bank originator gets no file; the Timberland one does", () => {
    const entries = [{ name: "PAT WORKER", routing: "021000021", accountNumber: "0012345678", accountType: "checking" as const, amountCents: 1000, idNumber: "E1" }];
    const base = { entries, secCode: "PPD" as const, companyEntryDescription: "PAYROLL", effectiveDate: new Date("2026-10-06T19:00:00Z"), createdAt: new Date("2026-10-05T17:00:00Z") };
    const good = buildNachaFile({ ...base, originator: greenwayTestOriginator() });
    expect(good.ok, good.ok ? "" : good.error).toBe(true);
    const bad = buildNachaFile({ ...base, originator: greenwayTestOriginator({ destinationRouting: "021000021" }) });
    expect(bad.ok).toBe(false);
    const ctx = buildNachaFile({ ...base, secCode: "CTX" as never, originator: greenwayTestOriginator() });
    expect(ctx.ok).toBe(false);
  });
  it("Brenda answer 4 (the agreement's restricted SEC list): CTX, IAT refused; PPD, CCD allowed", () => {
    expect(checkSecCode("CTX")).not.toBeNull();
    expect(checkSecCode("IAT")).not.toBeNull();
    expect(checkSecCode("PPD")).toBeNull();
    expect(checkSecCode("CCD")).toBeNull();
  });
});

describe("one readiness answer: every page and builder uses it", () => {
  const PAGES = ["src/app/admin/payroll/page.tsx", "src/app/admin/payroll/[id]/page.tsx", "src/app/admin/vendor-payments/page.tsx"];
  for (const f of PAGES) {
    it(`${f}: originatorReady = readiness.ready; the old field-presence check is gone`, () => {
      const s = strip(read(f));
      expect(s).toMatch(/getOriginatorReadiness\(\)/);
      expect(s).toMatch(/const originatorReady = readiness\.ready;/);
      expect(s).not.toMatch(/const settingsComplete\s*=/);
      expect(s).toMatch(/<OriginatorNotReady problems=\{readiness\.problems\}/);
    });
  }
  it("banking page: achComplete comes from originatorReadiness, the card is rendered", () => {
    const s = strip(read("src/app/admin/settings/banking/page.tsx"));
    expect(s).toMatch(/originatorReadiness\(/);
    expect(s).toMatch(/const achComplete = readiness\.complete;/);
    expect(s).toMatch(/<WhatTimberlandSeesCard/);
  });
  it("payroll file, vendor file and check file all take readiness.originator", () => {
    expect(strip(read("src/lib/payroll/payroll-store.ts"))).toMatch(/readiness\.originator/);
    expect(strip(read("src/app/admin/vendor-payments/actions.ts"))).toMatch(/readiness\.originator/);
    expect(strip(read("src/lib/payments/ach-ops-store.ts"))).toMatch(/getOriginatorReadiness\(\)[\s\S]{0,200}readiness\.originator/);
  });
  it("ach guide: company problems are the readiness problems, the old field list is gone", () => {
    const s = strip(read("src/lib/payments/ach-guide-store.ts"));
    expect(s).toMatch(/originatorReadiness\(settings, ein\)\.problems/);
    expect(s).not.toMatch(/COMPANY_FIELDS/);
  });
  it("behaviour: the old presence check would call this ready; readiness does not", () => {
    const wrong = { destination_routing: "021000021", destination_name: "X", immediate_origin: "1234567890", company_name: "GREENWAY", company_id: "1234567890", originating_dfi: "02100002", company_account_number: "0000006048" };
    expect(Boolean(wrong.destination_routing && wrong.immediate_origin && wrong.company_name && wrong.company_id && wrong.originating_dfi)).toBe(true);
    const r = originatorReadiness(wrong as never, TEST_EIN);
    expect(r.ready).toBe(false);
    expect(r.originator).toBeNull();
    expect(r.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the save path refuses a mismatch (except the EIN, which lives on Company information)", () => {
  const s = strip(read("src/app/admin/settings/banking/actions.ts"));
  it("validateOriginator runs on the input before the save", () => {
    const body = s.slice(s.indexOf("async function saveBankingSettingsBody"));
    const v = body.indexOf("validateOriginator(originatorFromSettings(input, await getCompanyEin()))");
    const save = body.indexOf("saveAchCompanySettings(");
    expect(v).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(v);
    expect(body).toMatch(/\.filter\(\(p\) => p\.field !== "companyEin"\)/);
    // the problems actually stop the save: a redirect (which throws) sits
    // between the check and the write, guarded by the problems list only
    const between = body.slice(v, save);
    expect(between).toMatch(/\n\s*if \(problems\.length\) \{\s*\n\s*redirect\(`\$\{ROOT\}\?tab=company&error=\$\{encodeURIComponent\(`Not saved\. /);
  });
  it("behaviour: a non-Timberland routing is a problem on the routing field", () => {
    const p = validateOriginator(greenwayTestOriginator({ destinationRouting: "021000021" }));
    expect(p.some((x) => x.field === "destinationRouting")).toBe(true);
  });
});

describe("the confirmation is gated, checked and audited", () => {
  const s = strip(read("src/app/admin/settings/banking/actions.ts"));
  it("goes through achGate(\"timberland_setup.confirm\")", () => {
    expect(s).toMatch(/achGate\(\s*"timberland_setup\.confirm",/);
  });
  it("the body checks confirmStampProblem before saving, and audits", () => {
    const body = s.slice(s.indexOf("async function confirmTimberlandSetupBody"));
    const a = body.indexOf("confirmStampProblem(");
    const b = body.indexOf("saveTimberlandStamp(");
    const c = body.indexOf('action: "banking.timberland.confirm"');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // the problem stops the write: redirect (throws) on any problem, before saveTimberlandStamp
    expect(body.slice(a, b)).toMatch(/\n\s*if \(problem\) redirect\(`\$\{ROOT\}\?tab=company&error=\$\{encodeURIComponent\(`Not recorded\. \$\{problem\}`\)\}`\);/);
  });
  it("the kind is registered in ACH_ACTIONS, KIND_SPECS and REPLAY", () => {
    expect(read("src/lib/auth/ach-authority-core.ts")).toContain('"timberland_setup.confirm"');
    expect(read("src/lib/payments/ach-gate-core.ts")).toContain('"timberland_setup.confirm"');
    expect(strip(read("src/app/admin/settings/banking/approvals/actions.ts"))).toMatch(/"timberland_setup\.confirm":\s*\(?[^\n]*confirmTimberlandSetupAction/);
  });
});

describe("what Timberland sees: built from the builder's own records", () => {
  it("the preview imports fileHeaderRecord and batchHeaderRecord from nacha-core", () => {
    const s = strip(read("src/lib/payments/timberland-preview-core.ts"));
    expect(s).toMatch(/fileHeaderRecord/);
    expect(s).toMatch(/batchHeaderRecord/);
    expect(s).toMatch(/from "\.\/nacha-core"/);
  });
  it("the builder uses the same two functions", () => {
    const s = strip(read("src/lib/payments/nacha-core.ts"));
    const body = s.slice(s.indexOf("export function buildNachaFile("));
    expect(body).toMatch(/fileHeaderRecord\(/);
    expect(body).toMatch(/batchHeaderRecord\(/);
  });
  it("behaviour: the batch shows GREENWAY MARIJUA at 5-20 and 1+EIN at 41-50", () => {
    const p = timberlandPreview(greenwayTestOriginator(), new Date("2026-10-05T17:00:00Z"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.batchHeader.slice(4, 20)).toBe("GREENWAY MARIJUA");
    expect(p.batchHeader.slice(40, 50)).toBe(`1${TEST_EIN}`);
  });
  it("three names table has the IRS name, the contract name and the batch name", () => {
    const values = THREE_NAMES.map((n) => n.value);
    expect(values).toContain("LYMAN'S MARIJUANA L.L.C.");
    expect(values).toContain("Lymans Marijuana LLC");
    expect(values).toContain("GREENWAY MARIJUA");
  });
});

describe("migration 0272: the stamp", () => {
  const raw = read("supabase/migrations/0272_ach_company_timberland_confirmed.sql");
  const sql = sqlStrip(raw);
  it("order guards on 0057 and 0271", () => {
    expect(sql).toMatch(/to_regclass\('public\.ach_company_settings'\) is null/);
    expect(sql).toMatch(/to_regprocedure\('public\.ach_company_settings_owner_guard\(\)'\) is null/);
  });
  it("four add-only columns", () => {
    for (const c of ["timberland_confirmed_at", "timberland_confirmed_by", "timberland_confirm_note", "timberland_confirm_cleared_at"]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    }
    expect(sql).not.toMatch(/drop column|drop table|delete from|truncate/i);
  });
  it("each of the five matched fields clears the stamp", () => {
    for (const c of ["destination_routing", "immediate_origin", "company_name", "company_id", "originating_dfi"]) {
      expect(sql).toMatch(new RegExp(`new\\.${c} is distinct from old\\.${c}`));
    }
    expect(sql).toMatch(/new\.timberland_confirmed_at := null;/);
  });
  it("self and future checks raise named errors", () => {
    expect(sql).toMatch(/TIMBERLAND_STAMP_SELF/);
    expect(sql).toMatch(/new\.timberland_confirmed_by is distinct from new\.updated_by/);
    expect(sql).toMatch(/TIMBERLAND_STAMP_FUTURE/);
  });
  it("trigger name sorts after the 0271 owner guard (Postgres fires same-event triggers by name)", () => {
    const name = "trg_ach_company_settings_timberland_stamp";
    expect(sql).toContain(`create trigger ${name}`);
    expect("trg_ach_company_settings_owner_guard" < name).toBe(true);
  });
  it("rollback, pg-check, verify-migrations hook and docs exist", () => {
    expect(read("supabase/rollbacks/0272_ach_company_timberland_confirmed.rollback.sql")).toMatch(/drop trigger if exists trg_ach_company_settings_timberland_stamp/);
    expect(read("scripts/recon/ach-timberland-confirm-0272-pg-check.sql")).toContain("ACH 0272 CHECK PASSED");
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("ach-timberland-confirm-0272-pg-check.sql");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0272_ach_company_timberland_confirmed\.sql/);
  });
});

describe("the public repo carries no full account number", () => {
  it("none of the S2 files contain a 6048-ending number longer than the test pad", () => {
    for (const f of [
      "src/lib/payments/timberland-originator-core.ts",
      "src/lib/payments/timberland-preview-core.ts",
      "src/app/admin/settings/banking/WhatTimberlandSeesCard.tsx",
      "supabase/migrations/0272_ach_company_timberland_confirmed.sql",
    ]) {
      expect(read(f), f).not.toMatch(/[1-9]\d{3,}6048\b/);
    }
  });
});

describe("never put words in Brenda's mouth: every S2 quote is verbatim in the mirror", () => {
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  const mirror = flat(read("docs/authorities/ach/timberland-brenda-2026-10.txt"));
  const QUOTES: [string, string][] = [
    ["src/lib/payments/timberland-originator-core.ts", "There are 3 parameters I need to have match my side."],
    ["src/lib/payments/timberland-originator-core.ts", "Make sure that it\u2019s an unbalanced batch"],
    ["src/lib/payments/timberland-originator-core.ts", "1. GREENWAY MARIJUA (that is all that will fit in this section)"],
    ["src/lib/payments/timberland-originator-core.ts", "2. 1 + EIN"],
    ["src/lib/payments/timberland-originator-core.ts", "3. Routing number \u2013 325170754"],
    ["src/lib/payments/timberland-preview-core.ts", "that is all that will fit in this section"],
    ["docs/MIGRATIONS_TO_RUN.md", "There are 3 parameters I need to have match my side."],
    ["docs/MIGRATIONS_TO_RUN.md", "Make sure that it\u2019s an unbalanced batch"],
  ];
  for (const [f, q] of QUOTES) {
    it(`${f}: "${q.slice(0, 40)}..."`, () => {
      expect(flat(read(f)), "the file quotes it").toContain(q);
      expect(mirror, "the mirror has it word for word").toContain(q);
    });
  }
  it("the mirror says \"fit\" (the owner's re-paste in round 7 said \"fix\"; the mirror is the source)", () => {
    expect(mirror).toContain("that is all that will fit in this section");
    expect(mirror).not.toContain("that is all that will fix");
  });
});


/**
 * R41 S19: the bank-side checklist for the meeting with Timberland Cash
 * Management and the sourced ACH glossary.
 *
 *   1. every quote is verbatim in its mirror (whitespace flattened);
 *   2. nothing is assumed: an item is Confirmed only with Brenda's or the
 *      agreement's words; the ACH debit block and filter are questions;
 *   3. the pure core: counts, meeting order, glossary, hint, sheet;
 *   4. wiring: page gate, reads/writes nothing, sheet route, tab, hover help
 *      on Operations/Approvals, help FAQ, concierge, nav-gate;
 *   5. docs, mutation log, public-repo rules.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as b from "@/lib/payments/ach-bank-setup-core";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CORE = "src/lib/payments/ach-bank-setup-core.ts";
const PAGE = "src/app/admin/settings/banking/bank-setup/page.tsx";
const SHEET = "src/app/admin/settings/banking/bank-setup/sheet/route.ts";
const OPS = "src/app/admin/settings/banking/operations/page.tsx";
const APPROVALS = "src/app/admin/settings/banking/approvals/page.tsx";

describe("S19 quotes", () => {
  it("every quote is verbatim in its mirror", () => {
    for (const [k, q] of Object.entries(b.SETUP_QUOTES)) {
      const mirror = flat(read(`docs/authorities/${q.file}`));
      expect(mirror.includes(flat(q.text)), k).toBe(true);
      expect(q.where.length, k).toBeGreaterThan(3);
    }
  });
  it("quotes come only from the listed mirrors, and every mirror exists", () => {
    for (const f of b.SOURCE_FILES) expect(existsSync(join(ROOT, "docs/authorities", f)), f).toBe(true);
    for (const q of Object.values(b.SETUP_QUOTES)) expect(b.SOURCE_FILES as readonly string[]).toContain(q.file);
  });
  it("Brenda's words are labelled as hers; the owner's note is labelled as not hers", () => {
    for (const q of Object.values(b.SETUP_QUOTES)) {
      if (q.file === b.BRENDA_FILE || q.file === b.BRENDA3_FILE) expect(q.where).toMatch(/^(Brenda|Owner's note)/);
    }
    expect(b.SETUP_QUOTES.brTesting.where).toContain("not Brenda's words");
  });
  it("BAI2 is not claimed anywhere (no mirror mentions it)", () => {
    expect(read(CORE)).not.toMatch(/BAI/);
  });
});

describe("S19 nothing assumed", () => {
  const byId = (id: string) => b.BANK_CHECKLIST.find((i) => i.id === id)!;
  it("confirmed items carry Brenda's or the agreement's words and nothing left to ask", () => {
    for (const i of b.BANK_CHECKLIST.filter((x) => x.status === "confirmed")) {
      expect(i.said.length, i.id).toBeGreaterThan(0);
      expect(i.ask, i.id).toEqual([]);
      for (const q of i.said) expect([b.BRENDA_FILE, b.BRENDA3_FILE, b.TIMBERLAND_FILE], `${i.id} ${q}`).toContain(b.SETUP_QUOTES[q].file);
    }
  });
  it("the debit block and the filter are questions with no 'said' (not on record)", () => {
    for (const id of ["debit-block", "filter"]) {
      expect(byId(id).status).toBe("ask");
      expect(byId(id).said).toEqual([]);
      expect(byId(id).onRecord).toMatch(/^Nothing on record/);
      expect(byId(id).ask.some((a) => a.includes("fee"))).toBe(true);
    }
  });
  it("dual approval is the owner's decision, quoting off today and Timberland's preference", () => {
    expect(byId("dual").status).toBe("decide");
    expect(byId("dual").said).toEqual(expect.arrayContaining(["brDualOff", "brDualPrefer", "tbDualBox"]));
  });
  it("testing is first and quotes Brenda's yes to a test file", () => {
    expect(b.meetingOrder()[0].id).toBe("testing");
    expect(byId("testing").said).toContain("brTestFile");
  });
  it("every ask item has questions; every id resolves", () => {
    for (const i of b.BANK_CHECKLIST) {
      if (i.status === "ask") expect(i.ask.length, i.id).toBeGreaterThan(0);
      for (const q of [...i.said, ...i.why]) expect(Object.keys(b.SETUP_QUOTES), `${i.id} ${q}`).toContain(q);
    }
  });
});

describe("S19 pure core", () => {
  it("self-test passes (44)", () => {
    expect(b.__runAchBankSetupCoreTests()).toEqual({ passed: 44, failed: 0 });
  });
  it("counts", () => {
    expect(b.checklistCounts()).toEqual({ ask: 5, decide: 1, confirmed: 5 });
  });
  it("meeting order: ask, decide, confirmed, stable within a status", () => {
    const ids = b.meetingOrder().map((i) => i.id);
    expect(ids).toEqual(["testing", "portal", "debit-block", "filter", "notices", "dual", "limits", "credits-only", "same-day", "reversal", "ofac"]);
  });
  it("glossary: 20 unique terms, sourced, plain words short, links are real banking pages", () => {
    expect(b.ACH_GLOSSARY).toHaveLength(20);
    expect(new Set(b.ACH_GLOSSARY.map((g) => g.id)).size).toBe(20);
    for (const g of b.ACH_GLOSSARY) {
      expect(Object.keys(b.SETUP_QUOTES)).toContain(g.source);
      expect(g.plain.length, g.id).toBeLessThan(200);
      if (g.href) {
        const path = g.href.split("#")[0].replace("/admin/", "src/app/admin/");
        expect(existsSync(join(ROOT, path, "page.tsx")), g.href).toBe(true);
      }
    }
  });
  it("glossaryHint: known term, unknown empty", () => {
    expect(b.glossaryHint("odfi")).toBe(`ODFI: ${b.glossaryTerm("odfi")!.plain}`);
    expect(b.glossaryHint("zzz")).toBe("");
  });
  it("sheet: header, counts, every question as a tick box, glossary, no long digits", () => {
    const s = b.meetingSheet("2026-10-22");
    expect(s).toContain("Printed 2026-10-22 (Pacific). 5 to ask, 1 for the owner to decide, 5 already confirmed.");
    for (const i of b.BANK_CHECKLIST) for (const a of i.ask) expect(s).toContain(`[ ] ASK: ${a}`);
    for (const g of b.ACH_GLOSSARY) expect(s).toContain(`  ${g.term}: ${g.plain}`);
    expect(b.hasLongDigitRun(s)).toBe(false);
    expect(s.indexOf("[ASK BRENDA]")).toBeLessThan(s.indexOf("[OWNER DECIDES]"));
    expect(s.indexOf("[OWNER DECIDES]")).toBeLessThan(s.indexOf("[CONFIRMED]"));
  });
});

describe("S19 wiring", () => {
  it("page: settings.manage gate, no database, no writes, badge for questions", () => {
    const pg = read(PAGE);
    expect(pg).toContain('await requirePermission("settings.manage")');
    expect(pg).not.toMatch(/supabase|createSupabase|"use server"|<form/i);
    expect(pg).toContain('<BankingSubnav active="banksetup" badge={counts.ask ? { banksetup: String(counts.ask) } : undefined} />');
    expect(pg).toContain("/admin/settings/banking/bank-setup/sheet");
    expect((pg.match(/<InfoHint /g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it("sheet route: settings.manage, no-store, audit only, no database read", () => {
    const r = read(SHEET);
    expect(r).toContain('await requirePermission("settings.manage")');
    expect(r).toContain('"Cache-Control": "no-store"');
    expect(r).toContain('action: "ach.bank_setup.sheet"');
    expect(r).not.toMatch(/\.from\(|createSupabase/);
  });
  it("tab after Policies", () => {
    const keys = BANKING_HELP_TABS.map((t) => t.key);
    expect(keys[keys.length - 1]).toBe("banksetup");
    expect(keys[keys.length - 2]).toBe("policies");
    expect(BANKING_HELP_TABS.find((t) => t.key === "banksetup")!.href).toBe("/admin/settings/banking/bank-setup");
  });
  it("every section heading on Operations and Approvals has a hover hint", () => {
    for (const f of [OPS, APPROVALS]) {
      const src = read(f);
      const heads = src.match(/<h2 className=\{h2\}>[\s\S]*?<\/h2>/g) ?? [];
      expect(heads.length, f).toBeGreaterThan(2);
      for (const h of heads) expect(h, `${f}: ${h.slice(0, 60)}`).toContain("<InfoHint ");
    }
    const ops = read(OPS);
    for (const id of ["return", "noc", "prenote", "file"]) expect(ops).toContain(`glossaryHint("${id}")`);
  });
  it("help FAQ, concierge, nav-gate, self-test", () => {
    expect(read("src/lib/admin/help-content.ts")).toContain('href: "/admin/settings/banking/bank-setup"');
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Bank setup & glossary is /admin/settings/banking/bank-setup");
    expect(kb).toContain("Bank setup & glossary (R41 S19, /admin/settings/banking/bank-setup)");
    expect(read("tests/compliance/nav-gate-core.test.ts")).toContain('"/admin/settings/banking/bank-setup",');
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ach-bank-setup-core", __runAchBankSetupCoreTests(), 44)');
  });
});

describe("S19 docs and rules", () => {
  it("test plan, manual, roadmap", () => {
    expect(read("docs/audit/TEST-PLAN.md")).toContain("**T-378 (Bank setup checklist and ACH glossary (R41 S19, no migration)):**");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-378"');
    expect(man).toContain('"T-377", "T-378"]');
    const rm = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(rm).toContain("## S19 in detail");
    expect(rm).toContain("| S18 | Written ACH policies");
    expect(rm).toMatch(/\| S18 \|[^\n]*\| #1450 \| 0291 \|/);
  });
  it("mutation log: every mutant killed", () => {
    const log = read("scripts/r41/mutate-s19-app.last.log");
    expect(log.trim()).toMatch(/total (\d+) killed \1 survivors \[\]$/);
  });
  it("public-repo rules: no long digit runs, no emails, only the published phone", () => {
    for (const f of [CORE, PAGE, SHEET]) {
      const s = read(f);
      expect(/[0-9]{9,}/.test(s), f).toBe(false);
      expect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(s), f).toBe(false);
      const phones = s.match(/\b\d{1}-\d{3}-\d{3}-\d{4}\b|\(\d{3}\)\s*\d{3}-\d{4}/g) ?? [];
      for (const p of phones) expect(p, f).toBe(b.TIMBERLAND_PHONE);
    }
  });
});

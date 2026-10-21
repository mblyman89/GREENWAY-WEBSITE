/**
 * R41 S16: the bank watch on the Timberland Main account (Plaid).
 *
 *   1. every quote is verbatim in its mirror (whitespace flattened);
 *   2. the pure core: explanation order, pending lines, known payees and
 *      limits, possible returns, fee/notice gaps, feed health, the email,
 *      the funding balance hint (a hint only);
 *   3. wiring: page gate finances.view (as Bank Feeds), rules owner-only
 *      (ach.act), reviews only on Main lines, the tab, help + concierge,
 *      the daily cron syncs only the Main connection and claims its email;
 *   4. 0289 content pins, rollback, CI post-apply check, factory reset KEEP;
 *   5. docs, mutation logs (test the tests), public-repo rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as w from "@/lib/payments/ach-bank-watch-core";
import { BANKING_HELP_TABS } from "@/app/admin/settings/banking/BankingHelpTabs";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CORE = "src/lib/payments/ach-bank-watch-core.ts";
const STORE = "src/lib/payments/ach-bank-watch-store.ts";
const ACTION = "src/app/admin/settings/banking/bank-watch-actions.ts";
const PAGE = "src/app/admin/settings/banking/bank-watch/page.tsx";
const CRON = "src/app/api/cron/ach-bank-watch/route.ts";
const OPS = "src/app/admin/settings/banking/operations/page.tsx";

const FEES = { perReturnOrNoc: 500, serviceMonthly: 2500 };
const MAIN: w.MainAccount = {
  accountId: "acc_main",
  name: "Timberland Main",
  mask: "1234",
  itemStatus: "healthy",
  itemErrorCode: null,
  lastSuccessfulSync: "2026-10-20T14:00:00Z",
  availableCents: 500_000,
  balancesUpdatedAt: "2026-10-20T14:00:00Z",
};

function txn(id: string, amountCents: number, date: string, description: string, extra: Partial<w.WatchTxn> = {}): w.WatchTxn {
  return { transactionId: id, accountId: "acc_main", amountCents, date, description, pending: false, inBooks: false, ...extra };
}

function input(over: Partial<w.WatchInput> = {}): w.WatchInput {
  return {
    todayIso: "2026-10-21",
    mainAccounts: [MAIN],
    agreementLast4: "1234",
    connectionsNow: 3,
    txns: [],
    achMatchedIds: new Set<string>(),
    sent: [],
    notices: [],
    rules: [],
    reviews: [],
    fees: FEES,
    ...over,
  };
}

describe("S16 quotes", () => {
  it("every quote is verbatim in its mirror", () => {
    const files: Record<string, string> = {
      trialCap: w.TRIAL_PLAN_FILE,
      trialRemove: w.TRIAL_PLAN_FILE,
      trialCalls: w.TRIAL_PLAN_FILE,
      saoFilter: w.SAO_FILE,
      saoList: w.SAO_FILE,
      agreementReturnNotice: w.AGREEMENT_FILE,
      agreementStatement: w.AGREEMENT_FILE,
    };
    expect(Object.keys(w.WATCH_QUOTES).sort()).toEqual(Object.keys(files).sort());
    for (const [k, q] of Object.entries(w.WATCH_QUOTES)) {
      const mirror = flat(read(`docs/authorities/${files[k]}`));
      expect(mirror.includes(flat(q)), k).toBe(true);
    }
  });
  it("the Trial plan mirror is listed in the authorities README", () => {
    expect(read("docs/authorities/ach/README.md")).toContain("plaid-trial-plan.txt");
  });
  it("the page shows every quote from the right file", () => {
    const p = read(PAGE);
    expect(p).toContain('<Quote id="agreementStatement" file={AGREEMENT_FILE} />');
    expect(p).toContain('<Quote id="agreementReturnNotice" file={AGREEMENT_FILE} />');
    expect(p).toContain('<Quote id="saoFilter" file={SAO_FILE} />');
    expect(p).toContain('<Quote id="trialCap" file={TRIAL_PLAN_FILE} />');
  });
});

describe("S16 core", () => {
  it("explains in order: ACH file, review, books, fee, known payee", () => {
    const r = w.buildBankWatch(
      input({
        txns: [
          txn("t_ach01", 120_000, "2026-10-10", "ACH BATCH"),
          txn("t_book1", 9_900, "2026-10-11", "INSURANCE", { inBooks: true }),
          txn("t_fee01", 500, "2026-10-12", "FEE"),
          txn("t_svc01", 2_500, "2026-10-12", "SERVICE FEE"),
          txn("t_rule1", 4_000, "2026-10-13", "PSE ELECTRIC AUTOPAY"),
          txn("t_rev01", 7_700, "2026-10-14", "ODD DEBIT"),
          txn("t_none1", 3_300, "2026-10-15", "UNKNOWN CO"),
        ],
        achMatchedIds: new Set(["t_ach01"]),
        rules: [{ id: "r1", matchText: "pse electric", maxCents: null, note: "power bill", retired: false }],
        reviews: [{ transactionId: "t_rev01", verdict: "known", note: "called them", createdAt: "2026-10-15T10:00:00Z", by: "Owner" }],
      }),
    );
    const by = Object.fromEntries(r.outLines.map((l) => [l.transactionId, l.explanation?.by ?? null]));
    expect(by).toEqual({ t_ach01: "ach_file", t_book1: "books", t_fee01: "fee", t_svc01: "fee", t_rule1: "rule", t_rev01: "review", t_none1: null });
    expect(r.unexplained.map((l) => l.transactionId)).toEqual(["t_none1"]);
    expect(r.counts.unexplainedCents).toBe(3_300);
  });
  it("pending lines are listed but never unexplained; money in and other accounts are not money out", () => {
    const r = w.buildBankWatch(
      input({ txns: [txn("t_pend1", 5_000, "2026-10-20", "X", { pending: true }), txn("t_in001", -5_000, "2026-10-20", "DEPOSIT"), txn("t_oth01", 5_000, "2026-10-20", "X", { accountId: "acc_other" })] }),
    );
    expect(r.outLines.map((l) => l.transactionId)).toEqual(["t_pend1"]);
    expect(r.unexplained).toEqual([]);
  });
  it("lines outside the 60-day window are ignored", () => {
    const r = w.buildBankWatch(input({ txns: [txn("t_old01", 1_000, w.addDaysIso("2026-10-21", -61), "OLD"), txn("t_edge1", 1_000, w.addDaysIso("2026-10-21", -60), "EDGE")] }));
    expect(r.outLines.map((l) => l.transactionId)).toEqual(["t_edge1"]);
  });
  it("a known payee over its limit is not explained and is flagged; a retired payee explains nothing", () => {
    const rules: w.WatchRule[] = [
      { id: "r1", matchText: "acme", maxCents: 1_000, note: "small", retired: false },
      { id: "r2", matchText: "zeta", maxCents: null, note: "gone", retired: true },
    ];
    const r = w.buildBankWatch(input({ rules, txns: [txn("t_over1", 1_001, "2026-10-20", "ACME LLC"), txn("t_ok001", 1_000, "2026-10-19", "ACME LLC"), txn("t_ret01", 50, "2026-10-19", "ZETA")] }));
    const over = r.outLines.find((l) => l.transactionId === "t_over1")!;
    expect(over.explanation).toBeNull();
    expect(over.ruleOverLimit).toEqual({ ruleId: "r1", maxCents: 1_000 });
    expect(r.outLines.find((l) => l.transactionId === "t_ok001")!.explanation?.by).toBe("rule");
    expect(r.outLines.find((l) => l.transactionId === "t_ret01")!.explanation).toBeNull();
  });
  it("the newest review stands", () => {
    const r = w.buildBankWatch(
      input({
        txns: [txn("t_rev01", 7_700, "2026-10-14", "ODD")],
        reviews: [
          { transactionId: "t_rev01", verdict: "not_ours", note: "second look", createdAt: "2026-10-16T10:00:00Z", by: "Owner" },
          { transactionId: "t_rev01", verdict: "known", note: "first look", createdAt: "2026-10-15T10:00:00Z", by: "Owner" },
        ],
      }),
    );
    const e = r.outLines[0].explanation!;
    expect(e.by === "review" && e.verdict).toBe("not_ours");
  });
  it("possible returns: exact amount of a payment sent on or before; each payment used once; a logged return closes it", () => {
    const sent: w.SentPayment[] = [
      { date: "2026-10-01", payee: "Vendor A", amountCents: 12_345, detail: "file 1" },
      { date: "2026-10-25", payee: "Vendor B", amountCents: 9_999, detail: "future" },
    ];
    const r = w.buildBankWatch(input({ sent, txns: [txn("t_back1", -12_345, "2026-10-05", "RETURN"), txn("t_back2", -12_345, "2026-10-06", "RETURN"), txn("t_back3", -9_999, "2026-10-06", "X")] }));
    expect(r.possibleReturns.map((p) => p.transactionId)).toEqual(["t_back1"]);
    expect(r.counts.possibleReturns).toBe(1);
    const logged = w.buildBankWatch(input({ sent, notices: [{ kind: "return", receivedOn: "2026-10-05", amountCents: 12_345 }], txns: [txn("t_back1", -12_345, "2026-10-05", "RETURN")] }));
    expect(logged.possibleReturns[0].logged).toBe(true);
    expect(logged.counts.possibleReturns).toBe(0);
  });
  it("fee gaps: more fee-sized debits than notices in a month", () => {
    const r = w.buildBankWatch(input({ txns: [txn("t_fee01", 500, "2026-10-02", "FEE"), txn("t_fee02", 500, "2026-10-09", "FEE")], notices: [{ kind: "noc", receivedOn: "2026-10-03", amountCents: null }] }));
    expect(r.feeMonths).toEqual([{ month: "2026-10", returnFeeDebits: 2, noticesLogged: 1, serviceFeeDebits: 0, gap: 1 }]);
    expect(r.counts.feeGaps).toBe(1);
  });
  it("health: no Main, stale sync, wrong last four, connection error, slots", () => {
    const none = w.buildBankWatch(input({ mainAccounts: [] }));
    expect(none.health.some((h) => h.level === "bad" && /No bank account is tagged/.test(h.text))).toBe(true);
    const stale = w.buildBankWatch(input({ mainAccounts: [{ ...MAIN, lastSuccessfulSync: "2026-10-18T00:00:00Z" }] }));
    expect(stale.health.some((h) => h.level === "warn" && /3 days ago/.test(h.text))).toBe(true);
    const fresh = w.buildBankWatch(input({ mainAccounts: [{ ...MAIN, lastSuccessfulSync: "2026-10-19T00:00:00Z" }] }));
    expect(fresh.health.some((h) => /days ago/.test(h.text))).toBe(false);
    const wrong = w.buildBankWatch(input({ mainAccounts: [{ ...MAIN, mask: "9999" }] }));
    expect(wrong.health.some((h) => h.level === "bad" && /ends in 9999/.test(h.text))).toBe(true);
    const broken = w.buildBankWatch(input({ mainAccounts: [{ ...MAIN, itemStatus: "login_required" }] }));
    expect(broken.health.some((h) => h.level === "bad" && /login required/.test(h.text))).toBe(true);
    const nine = w.buildBankWatch(input({ connectionsNow: 9 }));
    expect(nine.health.find((h) => /connections in use/.test(h.text))!.level).toBe("warn");
    expect(w.buildBankWatch(input({ connectionsNow: 8 })).health.find((h) => /connections in use/.test(h.text))!.level).toBe("ok");
  });
  it("the findings key changes with the findings and not otherwise", () => {
    const a = w.buildBankWatch(input({ txns: [txn("t_none1", 3_300, "2026-10-15", "UNKNOWN")] }));
    const b = w.buildBankWatch(input({ txns: [txn("t_none1", 3_300, "2026-10-15", "UNKNOWN"), txn("t_book1", 1_200, "2026-10-15", "B", { inBooks: true })] }));
    const c = w.buildBankWatch(input({ txns: [txn("t_none2", 3_300, "2026-10-15", "UNKNOWN")] }));
    expect(a.findingsKey).toBe(b.findingsKey);
    expect(a.findingsKey).not.toBe(c.findingsKey);
  });
  it("the email: null when all clear; names the 1-800 number; never claims to block", () => {
    expect(w.watchEmail(w.buildBankWatch(input()), "https://x.test/p")).toBeNull();
    const m = w.watchEmail(w.buildBankWatch(input({ txns: [txn("t_none1", 3_300, "2026-10-15", "UNKNOWN")] })), "https://x.test/p")!;
    expect(m.subject).toBe("Bank watch: 1 thing(s) to check on the Timberland account");
    expect(m.text).toContain("1-800-562-8761");
    expect(m.text).toContain("This watch never blocks a payment.");
  });
  it("forms: rule and review refuse digit runs and short notes; limits are integer cents", () => {
    const f = (o: Record<string, string>) => (k: string) => o[k];
    expect(w.checkRuleForm(f({ match_text: "acme", max_dollars: "250.5", note: "the alarm company" }))).toEqual({ ok: true, rule: { matchText: "acme", maxCents: 25_050, note: "the alarm company" } });
    expect(w.checkRuleForm(f({ match_text: "acme", max_dollars: "0", note: "the alarm company" })).ok).toBe(false);
    expect(w.checkRuleForm(f({ match_text: "ac", note: "the alarm company" })).ok).toBe(false);
    expect(w.checkRuleForm(f({ match_text: "acme 1234567", note: "the alarm company" })).ok).toBe(false);
    expect(w.checkReviewForm(f({ transaction_id: "abc_123", verdict: "known", note: "called them today" })).ok).toBe(true);
    expect(w.checkReviewForm(f({ transaction_id: "abc_123", verdict: "maybe", note: "called them today" })).ok).toBe(false);
    expect(w.checkReviewForm(f({ transaction_id: "abc_123", verdict: "known", note: "short" })).ok).toBe(false);
    expect(w.checkReviewForm(f({ transaction_id: "abc_123", verdict: "known", note: "account 1234567 here" })).ok).toBe(false);
    expect(w.checkReviewForm(f({ transaction_id: "abc_123", verdict: "known", note: "called 1-800-562-8761 ok" })).ok).toBe(true);
  });
  it("the funding hint is a hint: stale after 24 hours or unknown time, short when under", () => {
    expect(w.fundingBalanceHint([], 100, "2026-10-21T00:00:00Z")).toBeNull();
    expect(w.fundingBalanceHint([MAIN], 100_000, "2026-10-20T20:00:00Z")!.tone).toBe("ok");
    expect(w.fundingBalanceHint([MAIN], 600_000, "2026-10-20T20:00:00Z")!.tone).toBe("short");
    expect(w.fundingBalanceHint([MAIN], 100_000, "2026-10-21T15:00:00Z")!.tone).toBe("stale");
    expect(w.fundingBalanceHint([{ ...MAIN, balancesUpdatedAt: null }], 100_000, "2026-10-20T20:00:00Z")!.tone).toBe("stale");
    expect(w.fundingBalanceHint([MAIN], 100_000, "2026-10-20T20:00:00Z")!.text).toContain("Still look at the account yourself");
  });
  it("database errors in plain words", () => {
    expect(w.watchDbErrorMessage("ACH_OWNER_ONLY")).toBe("Only the owner can add or retire a known-payee rule.");
    expect(w.watchDbErrorMessage("ACH_WATCH_APPEND_ONLY")).toMatch(/never changed or deleted/);
    expect(w.watchDbErrorMessage('relation "ach_bank_watch_rules" does not exist')).toMatch(/Apply migration 0289/);
  });
  it("the pure self-test is registered with at least 54 checks", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ach-bank-watch-core", __runAchBankWatchCoreTests(), 54)');
    expect(w.__runAchBankWatchCoreTests()).toEqual({ passed: 54, failed: 0 });
  });
});

describe("S16 wiring", () => {
  it("page: same gate as Bank Feeds; owner-only rule forms; the Bank watch tab", () => {
    const p = read(PAGE);
    expect(p).toContain('const session = await requirePermission("finances.view");');
    expect(p).toContain('const isOwner = can(session.profile.role, "ach.act");');
    expect(p).toContain('active="bankwatch"');
    expect(BANKING_HELP_TABS).toContainEqual({ key: "bankwatch", href: "/admin/settings/banking/bank-watch", label: "Bank watch" });
  });
  it("actions: rules need ach.act (owner); reviews need finances.view; each is audited", () => {
    const a = read(ACTION);
    expect(a.match(/requirePermission\("ach\.act"\)/g)?.length).toBe(2);
    expect(a.match(/requirePermission\("finances\.view"\)/g)?.length).toBe(1);
    for (const k of ["ach.bank_watch.rule_added", "ach.bank_watch.rule_retired", "ach.bank_watch.reviewed"]) expect(a).toContain(k);
  });
  it("store: only Main lines are reviewed; the transaction read is capped and checked", () => {
    const s = read(STORE);
    expect(s).toContain('if (a.error || (a.data as { role?: string } | null)?.role !== "main") return { ok: false, error: "Only lines on the Main account are reviewed here." };');
    expect(s).toContain("export const WATCH_TXN_CAP = 3000;");
    expect(s).toContain(".limit(WATCH_TXN_CAP + 1);");
    expect(s).toContain('if (!tablesReady) problems.push("Migration 0289 is not applied yet');
  });
  it("cron: daily, syncs only the Main connection, a failed read is never an all clear, the email is claimed once a week per finding set", () => {
    const c = read(CRON);
    expect(c).toContain('.from("plaid_accounts").select("item_id, role, active").eq("role", "main")');
    expect(c).toContain("await runPlaidSyncForItem(id)");
    expect(c).toContain("Nothing was checked, so this is NOT an all clear.");
    expect(c).toContain("dedupeKey: `ach-bank-watch:${report.findingsKey.slice(0, 24)}:${weekKeyOf(day)}`");
    expect(c).toContain('await db.from("compliance_reminder_log").delete().eq("dedupe_key", planned.dedupeKey);');
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons).toContainEqual({ path: "/api/cron/ach-bank-watch", schedule: "15 14 * * *" });
  });
  it("operations: the Plaid balance is shown only to finances.view, and the box still needs typing", () => {
    const o = read(OPS);
    expect(o).toContain('can(session.profile.role, "finances.view") ? readMainBalances() : Promise.resolve([]),');
    expect(o).toContain("You look at the account, then type what you saw.");
  });
  it("help and concierge know the page", () => {
    expect(read("src/lib/admin/help-content.ts")).toContain("/admin/settings/banking/bank-watch");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Bank watch");
  });
});

describe("0289 content pins", () => {
  const m = read("supabase/migrations/0289_ach_bank_watch.sql");
  it("CI runs the 0289 check after every migration", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ach-bank-watch-0289-pg-check.sql", mustPrint: "ACH 0289 CHECK PASSED" });
  });
  it("owner-only rules, retire-only, append-only reviews, no digits, no truncate, not security definer", () => {
    expect(m).toContain("ach_write_by_owner(");
    for (const k of ["ACH_WATCH_RETIRE", "ACH_WATCH_APPEND_ONLY", "ACH_WATCH_STAFF_ONLY"]) expect(m).toContain(k);
    expect(m).toContain("'[0-9]{7,}'");
    expect(m).toMatch(/before truncate on public\.ach_bank_watch_rules/i);
    expect(m).toMatch(/before truncate on public\.ach_bank_watch_reviews/i);
    expect(m.replace(/--[^\n]*/g, "")).not.toMatch(/security definer/i);
  });
  it("the rollback refuses while a row exists", () => {
    expect(read("supabase/rollbacks/0289_ach_bank_watch.rollback.sql")).toContain("ROLLBACK REFUSED");
  });
  it("factory reset keeps both tables", () => {
    const f = read("src/lib/accounting/factory-reset-core.ts");
    expect(f).toContain('{ table: "ach_bank_watch_rules", disposition: "KEEP"');
    expect(f).toContain('{ table: "ach_bank_watch_reviews", disposition: "KEEP"');
  });
});

describe("S16 docs", () => {
  it("MIGRATIONS_TO_RUN, TEST-PLAN T-375, the manual, the roadmap", () => {
    const d = read("docs/MIGRATIONS_TO_RUN.md");
    expect(d).toContain("## R41 \u2014 0289 \u2014 Bank watch");
    expect(d).toContain("Apply it **after 0288**.");
    expect(d).toContain("ACH 0289 CHECK PASSED");
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-375 (");
    const man = read("docs/audit/test-manual/index.html");
    expect(man).toContain('data-test="T-375"');
    expect(man).toContain('"T-375": "part-b--the-results-log"');
    const r = read("docs/roadmap/R41-TIMBERLAND.md");
    expect(r).toContain("| S16 | Bank watch");
    expect(r).toContain("## S16 in detail");
  });
});

describe("S16 mutation runs (test the tests)", () => {
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
  it("scripts/r41/mutate-0289-sql.last.log: 35 SQL mutants killed, plus the rolled-back and rollback-refuses probes", () => {
    pin("scripts/r41/mutate-0289-sql.py", "scripts/r41/mutate-0289-sql.last.log", 35);
    const log = read("scripts/r41/mutate-0289-sql.last.log");
    expect(log).toMatch(/killed {3}rolled-back/);
    expect(log).toMatch(/killed {3}rollback-refuses/);
  });
  it("scripts/r41/mutate-s16-app.last.log: every app mutant killed, controls pass", () => {
    pin("scripts/r41/mutate-s16-app.py", "scripts/r41/mutate-s16-app.last.log", 20);
  });
});

describe("S16 public-repo rules", () => {
  const files = [
    CORE,
    STORE,
    ACTION,
    PAGE,
    CRON,
    "docs/authorities/ach/plaid-trial-plan.txt",
    "supabase/migrations/0289_ach_bank_watch.sql",
    "supabase/rollbacks/0289_ach_bank_watch.rollback.sql",
    "scripts/recon/ach-bank-watch-0289-pg-check.sql",
  ];
  it("one phone only, no real emails, no long digit runs", () => {
    for (const f of files) {
      const s = read(f);
      const phones = s.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) ?? [];
      expect(phones.filter((p) => !p.endsWith("562-8761")), f).toEqual([]);
      expect(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)?.filter((e) => !e.endsWith("@x.test")) ?? [], f).toEqual([]);
      expect(s.replace(/[0-9a-f]{64}/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "").replace(/account 123456789/gi, "").replace(/https:\/\/\S+/g, ""), f).not.toMatch(/(?<![0-9a-f])[0-9]{9,}(?![0-9a-f])/);
    }
  });
});

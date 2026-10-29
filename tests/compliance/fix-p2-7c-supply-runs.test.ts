/**
 * tests/compliance/fix-p2-7c-supply-runs.test.ts
 *
 * Fix Phase 2.7c (G-11; finding F-02-11).
 *
 * Owner, verbatim:
 *   D17      "Q-02-4- id like the supply run screen built"
 *            (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md L63)
 *   books-98 "Sometimes my employees need to run to the store and buy some
 *            supplies, so they take cash from the master, and replace it with
 *            a receipt. How do we account for this and replace the receipt
 *            with cash again?" (register-cash-journal-core.ts L474-476)
 *
 * What this file proves:
 *   1. The pure rules: cash out needs an amount, a reason (why not the shop
 *      card), a manager or lead approver who is not the taker; settle needs
 *      receipt + change = the cash taken exactly, an expense account from the
 *      list when something was bought, a receiver who is not the taker.
 *   2. The poster: the cash out posts DR 12100 / CR 10100 dated on the run's
 *      business day under supply-advance:<id>; the settle refuses before the
 *      advance is in the books, puts the 280E cost class on the expense line
 *      only, posts under supply-settle:<id>; journal ids are filled once.
 *   3. The actions: any login, PINs throttled on their own scope, nothing
 *      saved on a refusal, every step audited.
 *   4. The store reads every page and reports a failure as a failure.
 *   5. Migration 0318, the page, the buttons, the safe notice, factory reset,
 *      and the living SOP and ledgers (D41).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── fake database ──────────────────────────────────────────────────────────
type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };
const QUEUE: Record<string, Res[]> = {};
const CALLS: { table: string; ops: string[]; insert?: Record<string, unknown>; update?: Record<string, unknown> }[] = [];
function builder(table: string) {
  const call: { table: string; ops: string[]; insert?: Record<string, unknown>; update?: Record<string, unknown> } = { table, ops: [] };
  CALLS.push(call);
  const b: Record<string, unknown> = {};
  const next = (): Res => {
    const q = QUEUE[table] ?? [];
    return q.length > 0 ? (q.shift() as Res) : { data: [], error: null };
  };
  for (const m of ["select", "eq", "is", "or", "order", "range", "gte", "lte"]) {
    b[m] = (...args: unknown[]) => {
      call.ops.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return b;
    };
  }
  b.insert = (row: Record<string, unknown>) => {
    call.insert = row;
    call.ops.push("insert");
    return b;
  };
  b.update = (row: Record<string, unknown>) => {
    call.update = row;
    call.ops.push("update");
    return b;
  };
  b.maybeSingle = async () => next();
  b.single = async () => next();
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, ko);
  return b;
}
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));

type SubmitInput = {
  entityCode: string;
  journalDate: string;
  sourceKind: string;
  sourceRef: string;
  memo: string;
  lines: { accountCode: string; amountCents: number; costClass: string; description?: string }[];
  autoPost?: boolean;
};
let SUBMIT_RESULT: Record<string, unknown> = { ok: true, journalId: "j-1", journalNo: 41, outcome: "created" };
const SUBMITS: SubmitInput[] = [];
vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: async (input: SubmitInput) => {
    SUBMITS.push(input);
    return SUBMIT_RESULT;
  },
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const PERMS: string[] = [];
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    PERMS.push(p);
    return { userId: "u1", email: "staff@example.com", profile: { role: "staff" } };
  },
}));
const AUDITS: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }[] = [];
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }) => {
    AUDITS.push(a);
  },
}));
type Emp = { id: string; full_name: string; job_role: string };
const PINS: Record<string, Emp> = {};
vi.mock("@/lib/staffing/store", () => ({
  getEmployeeByPin: async (pin: string) => PINS[pin] ?? null,
}));
const THROTTLE: string[] = [];
let LOCKED: string | null = null;
vi.mock("@/lib/security/pin-throttle-store", () => ({
  pinPadBlocked: async (s: string) => {
    THROTTLE.push(`blocked?${s}`);
    return LOCKED;
  },
  notePinFailure: async (s: string) => {
    THROTTLE.push(`fail:${s}`);
  },
  notePinSuccess: async (s: string) => {
    THROTTLE.push(`ok:${s}`);
  },
}));
vi.mock("@/lib/reports/timezone", () => ({ pacificToday: () => "2026-11-03" }));

import {
  SUPPLY_RUN_PIN_SCOPE,
  SUPPLY_APPROVER_ROLES,
  MAX_SUPPLY_RUN_MINOR,
  SUPPLY_EXPENSE_ACCOUNTS,
  supplyExpenseAccount,
  advanceSourceRef,
  settleSourceRef,
  parseCashMinor,
  checkCashOut,
  checkSettle,
  settleLinesWithCostClass,
  openAdvanceMinor,
  daysOpen,
  notPosted,
  openRunsNotice,
  __runSupplyRunTests,
  type SupplyRunRow,
} from "@/lib/registers/supply-run-core";
import { listSupplyRuns, listOpenSupplyRuns, insertCashOut, saveSettle } from "@/lib/registers/supply-run-store";
import { postAdvanceForRun, postSettleForRun, describeSupplyPost } from "@/lib/accounting/supply-run-posting-service";
import { cashOutAction, settleAction, retrySupplyPostAction } from "@/app/admin/registers/supply-runs/actions";
import { SAFE_TARGET_MINOR } from "@/lib/registers/safe-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "");
const MIG = "supabase/migrations/0318_supply_runs.sql";
const PAGE = "src/app/admin/registers/supply-runs/page.tsx";
const ACTIONS = "src/app/admin/registers/supply-runs/actions.ts";
const POSTER = "src/lib/accounting/supply-run-posting-service.ts";
const STORE = "src/lib/registers/supply-run-store.ts";

const ANN: Emp = { id: "emp-ann", full_name: "Ann Lee", job_role: "sales" };
const BO: Emp = { id: "emp-bo", full_name: "Bo Kim", job_role: "manager" };
const CY: Emp = { id: "emp-cy", full_name: "Cy Ortiz", job_role: "lead" };
const P = (e: Emp) => ({ id: e.id, name: e.full_name, role: e.job_role });

function dbRun(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "run-1",
    business_day: "2026-11-02",
    taken_by: ANN.id,
    approved_by: BO.id,
    amount_minor: 4000,
    reason: "card at the bank",
    taken_at: "2026-11-02T18:00:00Z",
    advance_journal_id: null,
    settled_by: null,
    settled_at: null,
    settled_day: null,
    receipt_minor: null,
    change_minor: null,
    expense_account: null,
    receipt_note: null,
    settle_journal_id: null,
    ...over,
  };
}
const SETTLED = {
  advance_journal_id: "j-adv",
  settled_by: CY.id,
  settled_at: "2026-11-03T17:00:00Z",
  settled_day: "2026-11-03",
  receipt_minor: 1500,
  change_minor: 2500,
  expense_account: "76020",
};

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.url);
    throw e;
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  for (const k of Object.keys(QUEUE)) delete QUEUE[k];
  for (const k of Object.keys(PINS)) delete PINS[k];
  CALLS.length = 0;
  SUBMITS.length = 0;
  PERMS.length = 0;
  AUDITS.length = 0;
  THROTTLE.length = 0;
  LOCKED = null;
  SUBMIT_RESULT = { ok: true, journalId: "j-1", journalNo: 41, outcome: "created" };
  PINS["1111"] = ANN;
  PINS["2222"] = BO;
  PINS["3333"] = CY;
});

// ── 1. Pure rules ──────────────────────────────────────────────────────────
describe("supply-run-core (G-11 / F-02-11)", () => {
  it("its own self-tests run and pass", () => {
    const r = __runSupplyRunTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(45);
  });

  it("constants: own PIN scope, manager/lead approvers, the cap is the whole master till", () => {
    expect(SUPPLY_RUN_PIN_SCOPE).toBe("backoffice-supply-run");
    expect([...SUPPLY_APPROVER_ROLES]).toEqual(["manager", "lead"]);
    expect(MAX_SUPPLY_RUN_MINOR).toBe(SAFE_TARGET_MINOR);
    expect(MAX_SUPPLY_RUN_MINOR).toBe(100000);
  });

  it("the expense list is the six chart accounts, every one 280E, each pinned to 0173", () => {
    expect(SUPPLY_EXPENSE_ACCOUNTS.map((a) => a.code)).toEqual(["76020", "76010", "70060", "70030", "77010", "76030"]);
    for (const a of SUPPLY_EXPENSE_ACCOUNTS) {
      expect(a.costClass).toBe("nondeductible_280e");
      expect(a.pin).toMatch(/^0173_chart_of_accounts\.sql L\d+/);
    }
    const chart = read("supabase/migrations/0173_chart_of_accounts.sql").split("\n");
    for (const a of SUPPLY_EXPENSE_ACCOUNTS) {
      const line = Number(/L(\d+)/.exec(a.pin)![1]);
      expect(chart[line - 1], `${a.code} at ${a.pin}`).toContain(`'${a.code}'`);
      expect(chart[line - 1]).toContain("nondeductible_280e");
    }
    expect(supplyExpenseAccount("76020")?.name).toBe("Packaging & Store Supplies");
    expect(supplyExpenseAccount("60800")).toBeNull();
    expect(supplyExpenseAccount("")).toBeNull();
  });

  it("source refs are per run, one per leg", () => {
    expect(advanceSourceRef("abc")).toBe("supply-advance:abc");
    expect(settleSourceRef("abc")).toBe("supply-settle:abc");
  });

  it("parseCashMinor reads dollars, refuses junk, never rounds", () => {
    expect(parseCashMinor("12.5")).toBe(1250);
    expect(parseCashMinor("$1,000.00")).toBe(100000);
    expect(parseCashMinor("0")).toBe(0);
    expect(parseCashMinor("")).toBeNull();
    expect(parseCashMinor("-3")).toBeNull();
    expect(parseCashMinor("1.234")).toBeNull();
    expect(parseCashMinor("abc")).toBeNull();
  });

  it("cash out: amount, cap, reason, manager/lead approver, never self-approved", () => {
    const base = { amountRaw: "40", reason: "card at the bank", taker: P(ANN), approver: P(BO) };
    const good = checkCashOut(base);
    expect(good).toEqual({ ok: true, run: { amountMinor: 4000, reason: "card at the bank", takerId: ANN.id, approverId: BO.id } });
    expect(checkCashOut({ ...base, approver: P(CY) }).ok).toBe(true);
    const bad = (o: Partial<typeof base>) => {
      const r = checkCashOut({ ...base, ...o });
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(bad({ amountRaw: "0" })).toMatch(/more than \$0\.00/);
    expect(bad({ amountRaw: "x" })).toMatch(/dollars and cents/);
    expect(bad({ amountRaw: "1000.01" })).toMatch(/more than the whole master till/);
    expect(checkCashOut({ ...base, amountRaw: "1000" }).ok).toBe(true);
    expect(bad({ reason: "  " })).toMatch(/shop card/);
    expect(bad({ reason: "x".repeat(501) })).toMatch(/500 characters/);
    expect(checkCashOut({ ...base, reason: "x".repeat(500) }).ok).toBe(true);
    expect(bad({ approver: P({ ...ANN, id: "emp-z" }) })).toMatch(/not a manager or lead/);
    expect(bad({ taker: P(BO), approver: P(BO) })).toMatch(/cannot approve their own/);
    for (const e of [bad({ amountRaw: "0" }), bad({ reason: "" }), bad({ taker: P(BO) })]) expect(e).toMatch(/Nothing was saved\.$/);
  });

  it("settle: receipt + change must equal the cash taken; account when bought; receiver is not the taker", () => {
    const base = { amountMinor: 4000, takerId: ANN.id, alreadySettled: false, receiptRaw: "15", changeRaw: "25", expenseAccount: "76020", note: "", receiver: P(CY) };
    expect(checkSettle(base)).toEqual({ ok: true, settle: { receiptMinor: 1500, changeMinor: 2500, expenseAccount: "76020", note: null, receiverId: CY.id } });
    const nothingBought = checkSettle({ ...base, receiptRaw: "0", changeRaw: "40", expenseAccount: "" });
    expect(nothingBought).toEqual({ ok: true, settle: { receiptMinor: 0, changeMinor: 4000, expenseAccount: null, note: null, receiverId: CY.id } });
    const bad = (o: Partial<typeof base>) => {
      const r = checkSettle({ ...base, ...o });
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(bad({ alreadySettled: true })).toMatch(/already settled/);
    expect(bad({ receiptRaw: "" })).toMatch(/receipt total/);
    expect(bad({ changeRaw: "" })).toMatch(/change handed back/);
    expect(bad({ receiptRaw: "45", changeRaw: "0" })).toMatch(/reimbursement owed TO the employee/);
    expect(bad({ changeRaw: "24" })).toMatch(/\$1\.00 is missing/);
    expect(bad({ changeRaw: "26" })).toMatch(/\$1\.00 too much/);
    expect(bad({ expenseAccount: "" })).toMatch(/expense account/);
    expect(bad({ expenseAccount: "60800" })).toMatch(/expense account/);
    expect(bad({ receiver: P(ANN) })).toMatch(/cannot also receive/);
    expect(bad({ note: "n".repeat(501) })).toMatch(/500 characters/);
    // A taker whose employee row was deleted (FK set null) can be settled by anyone.
    expect(checkSettle({ ...base, takerId: null, receiver: P(ANN) }).ok).toBe(true);
  });

  it("settleLinesWithCostClass: the class goes on the expense line only; an unlisted account is refused", () => {
    const lines = [
      { accountCode: "76020", amountCents: 1500, costClass: "none" },
      { accountCode: "10100", amountCents: 2500, costClass: "none" },
      { accountCode: "12100", amountCents: -4000, costClass: "none" },
    ];
    const out = settleLinesWithCostClass(lines, "76020")!;
    expect(out.map((l) => l.costClass)).toEqual(["nondeductible_280e", "none", "none"]);
    expect(lines[0].costClass).toBe("none"); // not mutated
    expect(settleLinesWithCostClass(lines, null)!.map((l) => l.costClass)).toEqual(["none", "none", "none"]);
    expect(settleLinesWithCostClass(lines, "60800")).toBeNull();
  });

  it("open runs: total out, days open, not-posted flags, the safe notice", () => {
    const row = (o: Partial<SupplyRunRow>): SupplyRunRow => ({
      id: "r",
      businessDay: "2026-11-01",
      takenBy: ANN.id,
      approvedBy: BO.id,
      amountMinor: 4000,
      reason: "x",
      takenAt: "",
      advanceJournalId: "j",
      settledBy: null,
      settledAt: null,
      settledDay: null,
      receiptMinor: null,
      changeMinor: null,
      expenseAccount: null,
      receiptNote: null,
      settleJournalId: null,
      ...o,
    });
    const rows = [row({}), row({ amountMinor: 1000 }), row({ settledAt: "t", amountMinor: 9999 })];
    expect(openAdvanceMinor(rows)).toBe(5000);
    expect(daysOpen("2026-11-01", "2026-11-03")).toBe(2);
    expect(daysOpen("2026-11-03", "2026-11-01")).toBe(0);
    expect(notPosted(row({ advanceJournalId: null }))).toEqual({ advance: true, settle: false });
    expect(notPosted(row({ settledAt: "t", settleJournalId: null }))).toEqual({ advance: false, settle: true });
    expect(openRunsNotice([])).toBeNull();
    expect(openRunsNotice(rows)).toMatch(/^2 supply runs are open: \$50\.00 is out of the master till with employees\./);
    expect(openRunsNotice([row({})])).toMatch(/^1 supply run is open: \$40\.00 .* with an employee\./);
  });
});

// ── 2. The poster ──────────────────────────────────────────────────────────
describe("supply-run-posting-service: the books door", () => {
  it("cash out posts DR 12100 / CR 10100 on the run's business day under supply-advance:<id>, autoPost, then fills the id once", async () => {
    QUEUE.supply_runs = [{ data: dbRun(), error: null }, { data: null, error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const o = await postAdvanceForRun("run-1");
    expect(o).toMatchObject({ kind: "posted", sourceRef: "supply-advance:run-1", journalId: "j-1", journalNo: 41, duplicate: false, linkError: null });
    expect(SUBMITS).toHaveLength(1);
    const s = SUBMITS[0];
    expect(s.sourceRef).toBe(advanceSourceRef("run-1"));
    expect(s.journalDate).toBe("2026-11-02");
    expect(s.sourceKind).toBe("bank");
    expect(s.autoPost).toBe(true);
    expect(s.lines.map((l) => [l.accountCode, l.amountCents])).toEqual([
      ["12100", 4000],
      ["10100", -4000],
    ]);
    expect(s.memo).toContain("Ann Lee");
    const upd = CALLS.find((c) => c.table === "supply_runs" && c.update);
    expect(upd?.update).toEqual({ advance_journal_id: "j-1" });
    expect(upd?.ops).toContain('eq("id","run-1")');
    expect(upd?.ops).toContain('is("advance_journal_id",null)');
  });

  it("a duplicate is reported as already in the books, and an already-linked run is not re-linked", async () => {
    SUBMIT_RESULT = { ok: true, journalId: "j-adv", journalNo: 7, outcome: "duplicate" };
    QUEUE.supply_runs = [{ data: dbRun({ advance_journal_id: "j-adv" }), error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const o = await postAdvanceForRun("run-1");
    expect(o).toMatchObject({ kind: "posted", duplicate: true });
    expect(CALLS.some((c) => c.update)).toBe(false);
    expect(describeSupplyPost(o, "advance")).toBe("Already in the books, not booked twice.");
  });

  it("a taker with no name is refused by the builder (an unnamed advance is meaningless); nothing posts", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ taken_by: null }), error: null }];
    const o = await postAdvanceForRun("run-1");
    expect(o).toMatchObject({ kind: "refused", code: "ADVANCE_NO_EMPLOYEE" });
    expect(SUBMITS).toHaveLength(0);
  });

  it("a failed read and a failed submit are failures, shown NOT POSTED with a retry", async () => {
    QUEUE.supply_runs = [{ data: null, error: { message: "boom" } }];
    const r1 = await postAdvanceForRun("run-1");
    expect(r1).toMatchObject({ kind: "failed", code: "READ_FAILED" });
    SUBMIT_RESULT = { ok: false, code: "GL_PERIOD_CLOSED", message: "period closed" };
    QUEUE.supply_runs = [{ data: dbRun(), error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const r2 = await postAdvanceForRun("run-1");
    expect(r2).toMatchObject({ kind: "failed", code: "GL_PERIOD_CLOSED" });
    expect(describeSupplyPost(r2, "advance")).toMatch(/^NOT POSTED: period closed .*Post to the books/);
  });

  it("the settle is refused until the run is settled, and until the cash out is in the books", async () => {
    QUEUE.supply_runs = [{ data: dbRun(), error: null }];
    expect(await postSettleForRun("run-1")).toMatchObject({ kind: "refused", code: "RUN_NOT_SETTLED" });
    QUEUE.supply_runs = [{ data: dbRun({ ...SETTLED, advance_journal_id: null }), error: null }];
    expect(await postSettleForRun("run-1")).toMatchObject({ kind: "refused", code: "ADVANCE_NOT_POSTED" });
    expect(SUBMITS).toHaveLength(0);
  });

  it("the settle posts the expense with its 280E class, the change to 10100, clears 12100, on the settle day under supply-settle:<id>", async () => {
    QUEUE.supply_runs = [{ data: dbRun(SETTLED), error: null }, { data: null, error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const o = await postSettleForRun("run-1");
    expect(o).toMatchObject({ kind: "posted", sourceRef: "supply-settle:run-1", duplicate: false });
    const s = SUBMITS[0];
    expect(s.sourceRef).toBe(settleSourceRef("run-1"));
    expect(s.journalDate).toBe("2026-11-03");
    expect(s.autoPost).toBe(true);
    expect(s.lines.map((l) => [l.accountCode, l.amountCents, l.costClass])).toEqual([
      ["76020", 1500, "nondeductible_280e"],
      ["10100", 2500, "none"],
      ["12100", -4000, "none"],
    ]);
    const upd = CALLS.find((c) => c.table === "supply_runs" && c.update);
    expect(upd?.update).toEqual({ settle_journal_id: "j-1" });
    expect(upd?.ops).toContain('is("settle_journal_id",null)');
  });

  it("nothing bought: the change comes back whole and no expense line is written", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ ...SETTLED, receipt_minor: 0, change_minor: 4000, expense_account: null }), error: null }, { data: null, error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    await postSettleForRun("run-1");
    expect(SUBMITS[0].lines.map((l) => [l.accountCode, l.amountCents, l.costClass])).toEqual([
      ["10100", 4000, "none"],
      ["12100", -4000, "none"],
    ]);
  });

  it("an expense account not on the list is refused before the books", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ ...SETTLED, expense_account: "60800" }), error: null }];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    expect(await postSettleForRun("run-1")).toMatchObject({ kind: "refused", code: "EXPENSE_ACCOUNT_NOT_ALLOWED" });
    expect(SUBMITS).toHaveLength(0);
  });

  it("source: the poster calls the builders and submitJournal with these arguments", () => {
    const src = stripComments(read(POSTER));
    expect(src).toContain("buildSupplyAdvanceJournal({ journalDate: run.businessDay, employeeName: who, amountMinor: run.amountMinor, sourceRef })");
    expect(src).toContain("const sourceRef = advanceSourceRef(run.id);");
    expect(src).toContain("const sourceRef = settleSourceRef(run.id);");
    expect(src).toContain("journalDate: run.settledDay,");
    expect(src).toContain("settleLinesWithCostClass(built.journal.lines, run.receiptMinor > 0 ? run.expenseAccount : null)");
    expect(src).toContain('code: "ADVANCE_NOT_POSTED"');
    expect(src.match(/autoPost: true/g)).toHaveLength(2);
  });
});

// ── 3. The actions ─────────────────────────────────────────────────────────
describe("supply-run actions: any login, PINs, audit", () => {
  const cashOut = (o: Record<string, string> = {}) => fd({ taker_pin: "1111", approver_pin: "2222", amount: "40", reason: "card at the bank", ...o });

  it("cash out: orders.manage, both PINs on the supply-run scope, saves the run on today's business day, posts, audits", async () => {
    QUEUE.supply_runs = [
      { data: { id: "run-9" }, error: null }, // insert
      { data: dbRun({ id: "run-9", business_day: "2026-11-03" }), error: null }, // poster read
      { data: null, error: null }, // link
    ];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const url = await redirectOf(cashOutAction(cashOut()));
    expect(url).toMatch(/done=\$40\.00 out of the master till with Ann Lee, approved by Bo Kim\./);
    expect(url).toContain("Posted to the books as entry #41");
    expect(PERMS).toEqual(["orders.manage"]);
    expect(THROTTLE).toEqual([`blocked?${SUPPLY_RUN_PIN_SCOPE}`, `ok:${SUPPLY_RUN_PIN_SCOPE}`, `blocked?${SUPPLY_RUN_PIN_SCOPE}`, `ok:${SUPPLY_RUN_PIN_SCOPE}`]);
    const ins = CALLS.find((c) => c.insert);
    expect(ins?.insert).toEqual({ business_day: "2026-11-03", taken_by: ANN.id, approved_by: BO.id, amount_minor: 4000, reason: "card at the bank" });
    expect(SUBMITS[0].sourceRef).toBe("supply-advance:run-9");
    const a = AUDITS.find((x) => x.action === "supply_run.cash_out")!;
    expect(a.entityId).toBe("run-9");
    expect(a.after).toMatchObject({ amountMinor: 4000, takenBy: ANN.id, takenByName: "Ann Lee", approvedBy: BO.id, approvedByName: "Bo Kim", books: "posted", journalId: "j-1" });
  });

  it("a sales approver, or the taker approving, saves nothing and is audited as refused", async () => {
    PINS["4444"] = { id: "emp-dee", full_name: "Dee", job_role: "sales" };
    const u1 = await redirectOf(cashOutAction(cashOut({ approver_pin: "4444" })));
    expect(u1).toMatch(/error=Dee is not a manager or lead/);
    const u2 = await redirectOf(cashOutAction(cashOut({ taker_pin: "2222" })));
    expect(u2).toMatch(/cannot approve their own/);
    expect(CALLS.some((c) => c.insert)).toBe(false);
    expect(SUBMITS).toHaveLength(0);
    expect(AUDITS.map((a) => a.action)).toEqual(["supply_run.cash_out_refused", "supply_run.cash_out_refused"]);
    expect(AUDITS[0].after).toMatchObject({ approverId: "emp-dee", approverRole: "sales" });
  });

  it("no PIN, a malformed PIN, an unknown PIN or a locked pad saves nothing", async () => {
    expect(await redirectOf(cashOutAction(cashOut({ taker_pin: "" })))).toMatch(/Enter the PIN of the employee taking the cash/);
    expect(await redirectOf(cashOutAction(cashOut({ taker_pin: "12" })))).toMatch(/4.6 digits/);
    expect(await redirectOf(cashOutAction(cashOut({ approver_pin: "9999" })))).toMatch(/No active employee has that PIN/);
    expect(THROTTLE).toContain(`fail:${SUPPLY_RUN_PIN_SCOPE}`);
    LOCKED = "Too many wrong PINs. Wait 5 minutes.";
    expect(await redirectOf(cashOutAction(cashOut()))).toMatch(/Too many wrong PINs/);
    expect(CALLS.some((c) => c.insert)).toBe(false);
  });

  it("before 0318 the cash out says apply the migration and use form 8.4", async () => {
    QUEUE.supply_runs = [{ data: null, error: { code: "42P01", message: 'relation "public.supply_runs" does not exist' } }];
    const url = await redirectOf(cashOutAction(cashOut()));
    expect(url).toMatch(/apply migration 0318_supply_runs\.sql\. Use paper form 8\.4 until then/);
    expect(SUBMITS).toHaveLength(0);
  });

  it("settle: a different employee's PIN, a conditional update on settled_at, then the books, audited", async () => {
    QUEUE.supply_runs = [
      { data: dbRun({ advance_journal_id: "j-adv" }), error: null }, // getSupplyRun
      { data: [{ id: "run-1" }], error: null }, // saveSettle
      { data: dbRun({ ...SETTLED, settled_by: CY.id }), error: null }, // poster read
      { data: null, error: null }, // link
    ];
    QUEUE.employees = [{ data: { full_name: "Ann Lee" }, error: null }];
    const url = await redirectOf(settleAction(fd({ run_id: "run-1", receiver_pin: "3333", receipt: "15", change: "25", expense_account: "76020", note: "" })));
    expect(url).toMatch(/done=Settled: receipt \$15\.00 \(76020 Packaging & Store Supplies\), change \$25\.00 back in the master till, received by Cy Ortiz\./);
    const upd = CALLS.find((c) => c.update && "settled_by" in (c.update ?? {}))!;
    expect(upd.update).toMatchObject({ settled_by: CY.id, settled_day: "2026-11-03", receipt_minor: 1500, change_minor: 2500, expense_account: "76020", receipt_note: null });
    expect(upd.ops).toContain('is("settled_at",null)');
    expect(SUBMITS[0].sourceRef).toBe("supply-settle:run-1");
    expect(AUDITS.find((a) => a.action === "supply_run.settled")?.after).toMatchObject({ receiptMinor: 1500, changeMinor: 2500, receivedBy: CY.id, books: "posted" });
  });

  it("settle: the taker cannot receive, a gap saves nothing, a lost race says already settled", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ advance_journal_id: "j-adv" }), error: null }];
    expect(await redirectOf(settleAction(fd({ run_id: "run-1", receiver_pin: "1111", receipt: "15", change: "25", expense_account: "76020" })))).toMatch(/cannot also receive/);
    QUEUE.supply_runs = [{ data: dbRun({ advance_journal_id: "j-adv" }), error: null }];
    expect(await redirectOf(settleAction(fd({ run_id: "run-1", receiver_pin: "3333", receipt: "15", change: "20", expense_account: "76020" })))).toMatch(/\$5\.00 is missing/);
    expect(CALLS.some((c) => c.update)).toBe(false);
    QUEUE.supply_runs = [{ data: dbRun({ advance_journal_id: "j-adv" }), error: null }, { data: [], error: null }];
    expect(await redirectOf(settleAction(fd({ run_id: "run-1", receiver_pin: "3333", receipt: "15", change: "25", expense_account: "76020" })))).toMatch(/already settled \(someone else may have just done it\)/);
    expect(SUBMITS).toHaveLength(0);
  });

  it("settle: a run the screen already reads as settled is refused before any write", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ ...SETTLED, advance_journal_id: "j-adv" }), error: null }];
    const url = await redirectOf(settleAction(fd({ run_id: "run-1", receiver_pin: "3333", receipt: "15", change: "25", expense_account: "76020" })));
    expect(url).toMatch(/This supply run is already settled\. Nothing was saved\./);
    expect(CALLS.some((c) => c.update)).toBe(false);
    expect(SUBMITS).toHaveLength(0);
  });

  it("retry: posts the named leg, audited; a refusal is shown as an error", async () => {
    QUEUE.supply_runs = [{ data: dbRun({ ...SETTLED, advance_journal_id: null }), error: null }];
    const url = await redirectOf(retrySupplyPostAction(fd({ run_id: "run-1", leg: "settle" })));
    expect(url).toMatch(/error=NOT POSTED: The cash out for this run is not in the books yet/);
    expect(AUDITS[0]).toMatchObject({ action: "supply_run.post_retried", entityId: "run-1" });
    expect(AUDITS[0].after).toMatchObject({ leg: "settle", books: "refused", code: "ADVANCE_NOT_POSTED" });
  });
});

// ── 4. The store ───────────────────────────────────────────────────────────
describe("supply-run-store", () => {
  it("lists open runs plus recent ones, every page, with a unique tiebreak", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => dbRun({ id: `r${i}` }));
    QUEUE.supply_runs = [{ data: page, error: null }, { data: [dbRun({ id: "last" })], error: null }];
    const r = await listSupplyRuns("2026-10-01");
    expect(r.ok && r.runs.length).toBe(1001);
    const c = CALLS.filter((x) => x.table === "supply_runs");
    expect(c[0].ops).toContain('or("settled_at.is.null,business_day.gte.2026-10-01")');
    expect(c[0].ops).toContain('order("id",{"ascending":true})');
    expect(c[0].ops).toContain("range(0,999)");
    expect(c[1].ops).toContain("range(1000,1999)");
  });

  it("a failed page is a failure, never a shorter list; a missing table is reported as not set up", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => dbRun({ id: `r${i}` }));
    QUEUE.supply_runs = [{ data: page, error: null }, { data: null, error: { message: "timeout" } }];
    expect(await listOpenSupplyRuns()).toEqual({ ok: false, missingSchema: false, error: "timeout" });
    QUEUE.supply_runs = [{ data: null, error: { code: "42P01", message: "relation does not exist" } }];
    const r = await listOpenSupplyRuns();
    expect(r).toMatchObject({ ok: false, missingSchema: true });
  });

  it("insertCashOut and saveSettle write exactly the form's fields", async () => {
    QUEUE.supply_runs = [{ data: { id: "n1" }, error: null }];
    expect(await insertCashOut({ businessDay: "2026-11-03", takerId: "a", approverId: "b", amountMinor: 100, reason: "r" })).toEqual({ ok: true, id: "n1" });
    QUEUE.supply_runs = [{ data: [{ id: "n1" }], error: null }];
    expect(await saveSettle({ runId: "n1", settledDay: "2026-11-03", receiverId: "c", receiptMinor: 0, changeMinor: 100, expenseAccount: null, note: null })).toEqual({ ok: true });
  });
});

// ── 5. Migration, screens, factory reset ───────────────────────────────────
describe("migration 0318 and the screens (source)", () => {
  const mig = read(MIG);
  const sql = stripComments(mig);

  it("0318: prechecks the tables and functions it uses", () => {
    expect(sql).toMatch(/0318 depends on employees/);
    expect(sql).toMatch(/is_manager\(\)/);
    expect(sql).toMatch(/gl_factory_reset_active\(\)/);
    expect(sql).toMatch(/apply 0317_little_safe_exchanges\.sql before 0318/);
  });

  it("0318: the amount cap, two people, settle whole, the expense list", () => {
    expect(sql).toMatch(/check \(amount_minor > 0 and amount_minor <= 100000\)/);
    expect(sql).toMatch(/taken_by <> approved_by/);
    expect(sql).toMatch(/receipt_minor \+ change_minor = amount_minor/);
    for (const a of SUPPLY_EXPENSE_ACCOUNTS) expect(sql).toContain(`'${a.code}'`);
  });

  it("0318: no delete, the cash out is fixed, settle and journal ids once; the factory reset may pass", () => {
    expect(sql).toMatch(/if tg_op = 'DELETE' then\s+raise exception 'SUPPLY_RUN_PERMANENT/);
    expect(sql).toMatch(/SUPPLY_RUN_CASH_OUT_FIXED/);
    expect(sql).toMatch(/SUPPLY_RUN_SETTLED/);
    expect(sql).toMatch(/if public\.gl_factory_reset_active\(\) then/i);
    expect(sql).toMatch(/create trigger trg_supply_runs_guard/i);
  });

  it("0318: manager read only, no write policy for people", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/create policy supply_runs_mgr_read[\s\S]{0,120}for select[\s\S]{0,80}is_manager\(\)/i);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
  });

  it("the page: help panel, the cash-out form with two PINs, settle forms, the printable log, not-set-up said plainly", () => {
    const p = read(PAGE);
    expect(p).toContain('"registers-supply-runs"');
    expect(p).toMatch(/name="taker_pin"/);
    expect(p).toMatch(/name="approver_pin"/);
    expect(p).toMatch(/name="receiver_pin"/);
    expect(p).toMatch(/name="expense_account"/);
    expect(p).toMatch(/SUPPLY_EXPENSE_ACCOUNTS/);
    expect(p).toMatch(/action=\{cashOutAction\}/);
    expect(p).toMatch(/action=\{settleAction\}/);
    expect(p).toMatch(/action=\{retrySupplyPostAction\}/);
    expect(p).toMatch(/NOT POSTED/);
    expect(p).toMatch(/<PrintButton \/>/);
    expect(p).toMatch(/Checked by \(owner\): _+ Date: _+/);
    expect(p).toMatch(/0318_supply_runs\.sql/);
  });

  it("the actions: orders.manage on every action, PINs before any write", () => {
    const a = stripComments(read(ACTIONS));
    expect(a.match(/requirePermission\("orders\.manage"\)/g)).toHaveLength(3);
    const co = a.slice(a.indexOf("export async function cashOutAction"), a.indexOf("export async function settleAction"));
    expect(co.indexOf("personFromPin(")).toBeLessThan(co.indexOf("insertCashOut("));
    expect(co.indexOf("checkCashOut(")).toBeLessThan(co.indexOf("insertCashOut("));
    expect(co.indexOf("insertCashOut(")).toBeLessThan(co.indexOf("postAdvanceForRun(saved.id)"));
    const st = a.slice(a.indexOf("export async function settleAction"), a.indexOf("export async function retrySupplyPostAction"));
    expect(st.indexOf("checkSettle(")).toBeLessThan(st.indexOf("saveSettle("));
    expect(st.indexOf("saveSettle(")).toBeLessThan(st.indexOf("postSettleForRun(run.id)"));
  });

  it("the store never posts; the poster lives in src/lib/accounting (census positive control)", () => {
    expect(stripComments(read(STORE))).not.toMatch(/submitJournal/);
    expect(existsSync(join(ROOT, "src/lib/registers/supply-run-posting-service.ts"))).toBe(false);
  });

  it("Register Activity links to the screen with the open count; the safe page shows the open-runs notice", () => {
    const reg = read("src/app/admin/registers/page.tsx");
    expect(reg).toContain("href={`${BASE}/supply-runs`}");
    expect(reg).toMatch(/listOpenSupplyRuns\(\)/);
    expect(reg).toMatch(/\(\$\{openRuns\.length\} open\)/);
    const safe = read("src/app/admin/registers/safe/page.tsx");
    expect(safe).toMatch(/openRunsNotice\(/);
    expect(safe).toMatch(/\/admin\/registers\/supply-runs/);
  });

  it("factory reset: supply_runs is KEEP; schema-tables lists it", () => {
    const fr = read("src/lib/accounting/factory-reset-core.ts");
    expect(fr).toMatch(/table: "supply_runs"[\s\S]{0,80}KEEP/);
    expect(read("src/lib/admin/schema-tables.ts")).toContain('"supply_runs",');
  });

  it("the census row: poster named, reachable, idempotent, fully proven", () => {
    const c = read("src/lib/accounting/ledger-census-data.ts");
    const row = c.slice(c.indexOf('key: "cash_and_banking.employee_supply_advance"'), c.indexOf('key: "cash_and_banking.till_over_short"'));
    expect(row).toContain('poster: "src/lib/accounting/supply-run-posting-service.ts#postAdvanceForRun"');
    expect(row).toMatch(/reachable: \{\s*status: "PRESENT"/);
    expect(row).toMatch(/idempotent: \{\s*status: "PRESENT"/);
    expect(row).toMatch(/accepted: \{\s*status: "NOT_APPLICABLE"/);
  });
});

// ── 6. Living SOP and ledgers (D41) ────────────────────────────────────────
describe("Fix Phase 2.7c: living SOP and ledgers (D41)", () => {
  const sop = read("docs/sop/SOP-02-master-till-safe.md");
  it("SOP-02 is v1.8 or later and describes the built screen", () => {
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.([8-9]|\d\d) /);
    expect(sop).toMatch(/\| 1\.8 draft \| Fix phase \| Phase 2\.7c/);
    expect(sop).toMatch(/\/admin\/registers\/supply-runs/);
    expect(sop).toMatch(/0318_supply_runs\.sql/);
    expect(sop).toMatch(/Record cash out/);
  });

  it("ledgers mark G-11 BUILT and F-02-11 FIXED; the KB knows the screen", () => {
    const gaps = read("docs/sop-program/05-GAP-REGISTER.md");
    expect(gaps).toMatch(/\| G-11 \|[^\n]*\*\*BUILT\*\* \(Phase 2\.7c/);
    const find = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(find).toMatch(/F-02-11[\s\S]{0,3000}FIXED[\s\S]{0,200}Fix Phase 2\.7c/);
    const plan = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
    expect(plan).toMatch(/\| 2\.7c \|[^\n]*G-11/);
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toMatch(/supply-runs/);
    expect(kb).toMatch(/0318/);
  });
});

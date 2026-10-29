/**
 * tests/compliance/fix-p2-8-returns-books.test.ts
 *
 * Fix Phase 2.8 (G-48; findings F-15-14, F-15-15).
 *
 * G-48 requirement, verbatim (docs/sop-program/05-GAP-REGISTER.md):
 *   "a daily draft journal for customer refunds (debit 50910 Returns & Refunds
 *   and the tax liabilities as applicable, credit cash) awaiting owner
 *   approval"
 * Owner basis, books-23: "Anything accounting, bookkeeping, taxes, finance,
 * should be hard gated to me only."
 *
 * What this file proves:
 *   1. The pure builder: one entry per day, DR 50910 / 32000 / 32100, CR 10110
 *      (drawer) and 10100 (safe), the sale's own divisors, per category; an
 *      untied refund, an unknown category or a mismatch refuses the whole day.
 *   2. Excise Box 1 is net of returns (by return date), never below zero.
 *   3. The poster drafts (never autoPost) under refunds:<day>; duplicate and
 *      conflict are said plainly; today is refused; a failed read writes nothing.
 *   4. The action gates on the owner BEFORE reading, audits every press.
 *   5. The drafts page renders the panel; the excise page shows the sum.
 *   6. The census row, and the living SOP and ledgers (D41).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── fake database ──────────────────────────────────────────────────────────
type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };
const QUEUE: Record<string, Res[]> = {};
const CALLS: { table: string; ops: string[] }[] = [];
function builder(table: string) {
  const call: { table: string; ops: string[] } = { table, ops: [] };
  CALLS.push(call);
  const b: Record<string, unknown> = {};
  const next = (): Res => {
    const q = QUEUE[table] ?? [];
    return q.length > 0 ? (q.shift() as Res) : { data: null, error: null };
  };
  for (const m of ["select", "eq", "is", "order", "range", "gte", "lt", "lte", "in", "like"]) {
    b[m] = (...args: unknown[]) => {
      call.ops.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return b;
    };
  }
  b.maybeSingle = async () => next();
  b.single = async () => next();
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, ko);
  return b;
}
const FAKE = { from: (t: string) => builder(t) };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => FAKE }));

type SubmitInput = {
  entityCode: string;
  journalDate: string;
  sourceKind: string;
  sourceRef: string;
  memo: string;
  lines: { accountCode: string; amountCents: number; costClass: string; description?: string }[];
  autoPost?: boolean;
};
let SUBMIT_RESULT: Record<string, unknown> = { ok: true, journalId: "j-9", status: "draft", outcome: "created" };
const SUBMITS: SubmitInput[] = [];
vi.mock("@/lib/accounting/posting-service", () => ({
  submitJournal: async (input: SubmitInput) => {
    SUBMITS.push(input);
    return SUBMIT_RESULT;
  },
}));

type FakeRefund = {
  source: "return" | "void";
  sourceId: string;
  refundMinor: number;
  paidFrom: "drawer" | "safe" | null;
  drawerSessionId: string | null;
  label: string | null;
  atIso: string;
};
let DAY_READ: { refunds: FakeRefund[]; complete: boolean; problem: string | null; returnsAttributable: boolean } = {
  refunds: [],
  complete: true,
  problem: null,
  returnsAttributable: true,
};
const DAY_READS: string[] = [];
vi.mock("@/lib/registers/drawer-figure-store", () => ({
  readDayRefunds: async (day: string) => {
    DAY_READS.push(day);
    return DAY_READ;
  },
}));
vi.mock("@/lib/reports/timezone", () => ({
  pacificToday: () => "2026-11-03",
  addPacificDays: (d: string, n: number) => (d === "2026-11-03" && n === -1 ? "2026-11-02" : d),
}));

const ORDER: string[] = [];
let GATE_DENIES = false;
vi.mock("@/lib/accounting/books-access", () => ({
  requireBooksAccess: async () => {
    ORDER.push("gate");
    if (GATE_DENIES) throw new Error("REDIRECT /admin?denied=books");
    return { userId: "owner-1", email: "owner@example.com", profile: { role: "owner" } };
  },
}));
const AUDITS: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }[] = [];
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }) => {
    ORDER.push("audit");
    AUDITS.push(a);
  },
}));
const REVALIDATED: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => REVALIDATED.push(p) }));
vi.mock("@/lib/accounting/approval-service", () => ({
  approveAndPostJournal: async () => ({ ok: true }),
  listDraftJournals: async () => ({ ok: true, drafts: [], message: "" }),
}));

import {
  RETURNS_ACCOUNT,
  VAULT_ACCOUNT,
  REFUND_DAY_SOURCE_PREFIX,
  refundDaySourceRef,
  refundCategoryIsCannabis,
  splitRefund,
  buildRefundDayJournal,
  __runRefundJournalCoreTests,
  type RefundInput,
} from "@/lib/accounting/refund-journal-core";
import { aggregateBox1Returns, netBox1 } from "@/lib/compliance/excise-return-core";
import { draftRefundsForDay } from "@/lib/accounting/refund-posting-service";
import { draftRefundsAction } from "@/app/admin/books/drafts/actions";

const read = (p: string) => readFileSync(p, "utf8");

const ret = (over: Partial<RefundInput> = {}): RefundInput => ({
  source: "return",
  sourceId: "r1",
  label: "Counter return",
  refundCents: 1463,
  paidFrom: "drawer",
  lines: [{ categorySlug: "flower", paidCents: 1463 }],
  ...over,
});
const lineOf = (j: { lines: { accountCode: string; amountCents: number }[] }, code: string) =>
  j.lines.find((l) => l.accountCode === code)?.amountCents;

beforeEach(() => {
  for (const k of Object.keys(QUEUE)) delete QUEUE[k];
  CALLS.length = 0;
  SUBMITS.length = 0;
  DAY_READS.length = 0;
  ORDER.length = 0;
  AUDITS.length = 0;
  REVALIDATED.length = 0;
  GATE_DENIES = false;
  SUBMIT_RESULT = { ok: true, journalId: "j-9", status: "draft", outcome: "created" };
  DAY_READ = { refunds: [], complete: true, problem: null, returnsAttributable: true };
});

// ── 1. The pure builder ────────────────────────────────────────────────────
describe("Fix Phase 2.8: the refund builder (G-48)", () => {
  it("its own self-tests run and pass", () => {
    expect(__runRefundJournalCoreTests().passed).toBeGreaterThanOrEqual(20);
  });

  it("constants: 50910 Returns & Refunds, 10100 the safe, one ref per day", () => {
    expect(RETURNS_ACCOUNT).toBe("50910");
    expect(VAULT_ACCOUNT).toBe("10100");
    expect(REFUND_DAY_SOURCE_PREFIX).toBe("refunds");
    expect(refundDaySourceRef("2026-11-02")).toBe("refunds:2026-11-02");
  });

  it("50910 and 10100 are in the seeded chart", () => {
    const chart = read("supabase/migrations/0173_chart_of_accounts.sql");
    expect(chart).toMatch(/'50910'/);
    expect(chart).toMatch(/'10100'/);
  });

  it("cannabis is read from the chart's own list; an unknown slug is null, never a guess", () => {
    expect(refundCategoryIsCannabis("flower")).toBe(true);
    expect(refundCategoryIsCannabis("accessories")).toBe(false);
    expect(refundCategoryIsCannabis("nope")).toBeNull();
  });

  it("a $14.63 flower return: DR 50910 10.00, DR 32000 3.70, DR 32100 0.93, CR 10110 14.63", () => {
    const out = buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret()] });
    expect(out.kind).toBe("journal");
    if (out.kind !== "journal") return;
    const j = out.journal;
    expect(j.sourceKind).toBe("pos_sale");
    expect(j.sourceRef).toBe("refunds:2026-11-02");
    expect(j.journalDate).toBe("2026-11-02");
    expect(lineOf(j, "50910")).toBe(1000);
    expect(lineOf(j, "32000")).toBe(370);
    expect(lineOf(j, "32100")).toBe(93);
    expect(lineOf(j, "10110")).toBe(-1463);
    expect(lineOf(j, "10100")).toBeUndefined();
    expect(j.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    expect(j.lines.every((l) => l.costClass === "none")).toBe(true);
  });

  it("a non-cannabis return reverses no excise; the safe is credited for a safe refund", () => {
    const out = buildRefundDayJournal({
      businessDay: "2026-11-02",
      refunds: [ret({ paidFrom: "safe", refundCents: 1093, lines: [{ categorySlug: "accessories", paidCents: 1093 }] })],
    });
    expect(out.kind).toBe("journal");
    if (out.kind !== "journal") return;
    expect(lineOf(out.journal, "50910")).toBe(1000);
    expect(lineOf(out.journal, "32000")).toBeUndefined();
    expect(lineOf(out.journal, "32100")).toBe(93);
    expect(lineOf(out.journal, "10100")).toBe(-1093);
    expect(lineOf(out.journal, "10110")).toBeUndefined();
    expect(out.totals.fromSafeCents).toBe(1093);
  });

  it("a day with drawer and safe refunds and a void: totals and counts add up", () => {
    const out = buildRefundDayJournal({
      businessDay: "2026-11-02",
      refunds: [
        ret(),
        ret({ sourceId: "r2", paidFrom: "safe" }),
        ret({ source: "void", sourceId: "o1", label: "Void", refundCents: 2926, lines: [{ categorySlug: "flower", paidCents: 2926 }] }),
      ],
    });
    expect(out.kind).toBe("journal");
    if (out.kind !== "journal") return;
    expect(out.totals.refundCents).toBe(1463 * 4);
    expect(out.totals.fromDrawerCents).toBe(1463 * 3);
    expect(out.totals.fromSafeCents).toBe(1463);
    expect(out.totals.returnCount).toBe(2);
    expect(out.totals.voidCount).toBe(1);
    expect(out.journal.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
  });

  it("splitRefund groups per category before extracting, like the sale builder", () => {
    const one = splitRefund([{ categorySlug: "flower", paidCents: 2926 }]);
    const two = splitRefund([
      { categorySlug: "flower", paidCents: 1463 },
      { categorySlug: "flower", paidCents: 1463 },
    ]);
    expect(two).toEqual(one);
  });

  it("refuses: bad day, before the books, nothing, untied, unknown category, no lines, mismatch, negative", () => {
    const code = (o: ReturnType<typeof buildRefundDayJournal>) => (o.kind === "refused" ? o.code : "journal");
    expect(code(buildRefundDayJournal({ businessDay: "nope", refunds: [ret()] }))).toBe("REFUND_BAD_DAY");
    expect(code(buildRefundDayJournal({ businessDay: "2025-12-31", refunds: [ret()] }))).toBe("REFUND_BEFORE_LINE_IN_THE_SAND");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [] }))).toBe("REFUND_NONE");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret({ refundCents: 0 })] }))).toBe("REFUND_NONE");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret(), ret({ paidFrom: null })] }))).toBe("REFUND_UNTIED");
    expect(
      code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret({ lines: [{ categorySlug: "unrecognised:x", paidCents: 1463 }] })] })),
    ).toBe("REFUND_UNKNOWN_CATEGORY");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret({ lines: [] })] }))).toBe("REFUND_NO_LINES");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret({ refundCents: 1000 })] }))).toBe("REFUND_LINES_DISAGREE");
    expect(code(buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret({ refundCents: -5 })] }))).toBe("REFUND_BAD_AMOUNT");
  });

  it("an untied refund refuses the WHOLE day and says how to tie it", () => {
    const out = buildRefundDayJournal({ businessDay: "2026-11-02", refunds: [ret(), ret({ sourceId: "r2", paidFrom: null })] });
    expect(out.kind).toBe("refused");
    if (out.kind === "refused") expect(out.explanation).toMatch(/Tie refund/);
  });
});

// ── 2. Excise Box 1 ────────────────────────────────────────────────────────
describe("Fix Phase 2.8: excise Box 1 is net of returns (F-15-15)", () => {
  const rates = { combinedSalesRateBps: 930, exciseRateBps: 3700 };
  it("a cannabis return comes off pre-tax; medical-exempt and non-cannabis do not", () => {
    const agg = aggregateBox1Returns(
      [
        { refundMinor: 1463, exciseMinor: 370, saleType: "RecreationalRetail" },
        { refundMinor: 1093, exciseMinor: 0, saleType: "RecreationalMedical" },
        { refundMinor: 1093, exciseMinor: 0, saleType: "RecreationalRetail" },
      ],
      rates,
    );
    expect(agg.returnsMinor).toBe(1000);
    expect(agg.returnCount).toBe(1);
    expect(agg.medicalExemptSkipped).toBe(1);
    expect(agg.nonCannabisSkipped).toBe(1);
  });

  it("netBox1 subtracts and never goes below zero", () => {
    expect(netBox1(10000, 684)).toEqual({ netMinor: 9316, clamped: false });
    expect(netBox1(500, 684)).toEqual({ netMinor: 0, clamped: true });
  });

  it("the service reads customer_returns by return date and uses the NET figure unless overridden", () => {
    const src = read("src/lib/compliance/excise-return.ts");
    expect(src).toMatch(/from\("customer_returns"\)[\s\S]{0,200}\.gte\("created_at", fromISO\)[\s\S]{0,40}\.lt\("created_at", toISO\)/);
    expect(src).toMatch(/netBox1\(cannabisSalesMinor, returnsMinor\)/);
    expect(src).toMatch(/cannabisSalesMinorOverride : net\.netMinor/);
    expect(src).toMatch(/NOT net of returns - do not file until this loads/);
  });

  it("the excise page shows how Box 1 is made", () => {
    const page = read("src/app/admin/reports/excise/page.tsx");
    expect(page).toMatch(/How Box 1 is made/);
    expect(page).toMatch(/box1ReturnsMinor/);
    expect(page).toMatch(/box1SalesMinor/);
  });
});

// ── 3. The poster ──────────────────────────────────────────────────────────
describe("Fix Phase 2.8: the refund poster drafts, never posts", () => {
  const drawerReturn: FakeRefund = {
    source: "return",
    sourceId: "r1",
    refundMinor: 1463,
    paidFrom: "drawer",
    drawerSessionId: "s1",
    label: "Counter return",
    atIso: "2026-11-02T20:00:00Z",
  };

  it("drafts DR 50910/32000/32100 CR 10110 under refunds:<day>, with NO autoPost", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(DAY_READS).toEqual(["2026-11-02"]);
    expect(SUBMITS).toHaveLength(1);
    const s = SUBMITS[0];
    expect(s.autoPost).toBeUndefined();
    expect(s.sourceKind).toBe("pos_sale");
    expect(s.sourceRef).toBe("refunds:2026-11-02");
    expect(s.journalDate).toBe("2026-11-02");
    expect(s.lines.map((l) => [l.accountCode, l.amountCents])).toEqual([
      ["50910", 1000],
      ["32000", 370],
      ["32100", 93],
      ["10110", -1463],
    ]);
    if (out.kind === "drafted") {
      expect(out.duplicate).toBe(false);
      expect(out.message).toMatch(/It is a draft/);
    }
  });

  it("a void reads every line of the order", async () => {
    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, source: "void", sourceId: "o1", refundMinor: 2926, label: "Void" }] };
    QUEUE.order_lines = [
      {
        data: [
          { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "a" },
          { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "b" },
        ],
        error: null,
      },
    ];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(CALLS.find((c) => c.table === "order_lines")?.ops).toContain('eq("order_id","o1")');
    expect(SUBMITS[0].lines.find((l) => l.accountCode === "10110")?.amountCents).toBe(-2926);
  });

  it("pressing twice: the duplicate says already drafted and does not claim a new entry", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    SUBMIT_RESULT = { ok: true, journalId: "j-9", status: "draft", outcome: "duplicate" };
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    if (out.kind === "drafted") {
      expect(out.duplicate).toBe(true);
      expect(out.message).toMatch(/already drafted/);
    }
  });

  it("a conflict (a refund added after the draft) is a failure that explains itself", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    SUBMIT_RESULT = { ok: false, code: "GL_POST_CONFLICT", message: "conflict" };
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") {
      expect(out.code).toBe("GL_POST_CONFLICT");
      expect(out.message).toMatch(/added or changed after it was drafted/);
    }
  });

  it("today, a future day and a bad day are refused before anything is read", async () => {
    for (const d of ["2026-11-03", "2026-11-04", "bad"]) {
      const out = await draftRefundsForDay(d);
      expect(out.kind).toBe("refused");
    }
    expect(DAY_READS).toEqual([]);
    expect(SUBMITS).toEqual([]);
  });

  it("an incomplete read, a failed line read, an untied refund or an unknown category writes nothing", async () => {
    // A partial read that still holds a perfectly good refund: drafting it
    // would book a short day, so the incomplete flag alone must refuse.
    DAY_READ = { ...DAY_READ, complete: false, problem: "boom", refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    const partial = await draftRefundsForDay("2026-11-02");
    expect(partial.kind === "refused" && partial.code).toBe("REFUND_READ_INCOMPLETE");
    for (const k of Object.keys(QUEUE)) delete QUEUE[k];

    DAY_READ = { ...DAY_READ, complete: true, problem: null, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: null, error: { message: "down" } }];
    expect((await draftRefundsForDay("2026-11-02")).kind).toBe("failed");

    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, paidFrom: null }] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    const untied = await draftRefundsForDay("2026-11-02");
    expect(untied.kind === "refused" && untied.code).toBe("REFUND_UNTIED");

    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Mystery", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    const unknown = await draftRefundsForDay("2026-11-02");
    expect(unknown.kind === "refused" && unknown.code).toBe("REFUND_UNKNOWN_CATEGORY");

    expect(SUBMITS).toEqual([]);
  });

  it("source: no autoPost anywhere in the poster; it uses the reconcile's own refund read", () => {
    const src = read("src/lib/accounting/refund-posting-service.ts");
    expect(src).not.toMatch(/autoPost:\s*true/);
    expect(src).toMatch(/import "server-only"/);
    expect(src).toMatch(/readDayRefunds\(day\)/);
    expect(src).toMatch(/buildRefundDayJournal\(/);
    expect(src).toMatch(/submitJournal\(/);
  });
});

// ── 4. The action ──────────────────────────────────────────────────────────
describe("Fix Phase 2.8: the owner-only action", () => {
  it("gates on the owner first, then drafts, audits, and refreshes the page", async () => {
    DAY_READ = { ...DAY_READ, refunds: [] };
    const out = await draftRefundsAction("2026-11-02");
    expect(ORDER[0]).toBe("gate");
    expect(out.kind).toBe("refused");
    expect(AUDITS).toHaveLength(1);
    expect(AUDITS[0].action).toBe("books.refunds.drafted");
    expect(AUDITS[0].entityType).toBe("business_day");
    expect(AUDITS[0].entityId).toBe("2026-11-02");
    expect(AUDITS[0].after.code).toBe("REFUND_NONE");
    expect(REVALIDATED).toEqual([]);
  });

  it("a non-owner is stopped before anything is read or audited", async () => {
    GATE_DENIES = true;
    await expect(draftRefundsAction("2026-11-02")).rejects.toThrow(/denied=books/);
    expect(DAY_READS).toEqual([]);
    expect(AUDITS).toEqual([]);
  });

  it("a new draft refreshes /admin/books/drafts and the audit names the journal", async () => {
    DAY_READ = {
      ...DAY_READ,
      refunds: [{ source: "return", sourceId: "r1", refundMinor: 1463, paidFrom: "drawer", drawerSessionId: "s1", label: null, atIso: "" }],
    };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    const out = await draftRefundsAction("2026-11-02");
    expect(out.kind).toBe("drafted");
    // Fix Phase 2.8b: the audit also carries the cost entry's result (no disposition -> 0115 default destroy -> nothing).
    expect(AUDITS[0].after).toEqual({
      kind: "drafted",
      code: "DRAFTED",
      journalId: "j-9",
      refundCents: 1463,
      cogsKind: "nothing",
      cogsCode: null,
      cogsCostCents: 0,
    });
    expect(REVALIDATED).toEqual(["/admin/books/drafts"]);
  });
});

// ── 5. The page ────────────────────────────────────────────────────────────
describe("Fix Phase 2.8: the drafts page has the button", () => {
  it("the page renders the panel, defaulting to yesterday", () => {
    const page = read("src/app/admin/books/drafts/page.tsx");
    expect(page).toMatch(/<DraftRefundsPanel defaultDay=\{addPacificDays\(pacificToday\(\), -1\)\} \/>/);
  });
  it("the panel calls the action and shows totals and refusals", () => {
    const p = read("src/app/admin/books/drafts/DraftRefundsPanel.tsx");
    expect(p).toMatch(/"use client"/);
    expect(p).toMatch(/draftRefundsAction\(day\)/);
    expect(p).toMatch(/Draft refunds/);
    expect(p).toMatch(/Nothing was written/);
    expect(p).toMatch(/From the safe \(10100\)/);
  });
});

// ── 6. Census, SOP and ledgers ─────────────────────────────────────────────
describe("Fix Phase 2.8: census, living SOP and ledgers (D41)", () => {
  it("the census row: builder and poster named, reachable, idempotent, accepted PARTIAL (a draft)", () => {
    const c = read("src/lib/accounting/ledger-census-data.ts");
    const row = c.slice(
      c.indexOf('key: "revenue_and_tax_collected.refund_or_return"'),
      c.indexOf("FAMILY 2: INVENTORY AND COST OF GOODS SOLD"),
    );
    expect(row).toContain('builder: "src/lib/accounting/refund-journal-core.ts#buildRefundDayJournal"');
    expect(row).toContain('poster: "src/lib/accounting/refund-posting-service.ts#draftRefundsForDay"');
    expect(row).toMatch(/reachable: \{\s*status: "PRESENT"/);
    expect(row).toMatch(/idempotent: \{\s*status: "PRESENT"/);
    expect(row).toMatch(/accepted: \{\s*status: "PARTIAL"/);
    expect(row).toContain('"10100"');
  });

  it("SOP-15 is v1.11 or later and describes the refund draft and Box 1", () => {
    const sop = read("docs/sop/SOP-15-returns-vendor-destruction.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.(1[1-9]|[2-9]\d) /);
    expect(sop).toMatch(/\| 1\.11 draft \| Fix phase \| Phase 2\.8/);
    expect(sop).toMatch(/Draft refunds/);
    expect(sop).toMatch(/How Box 1 is made/);
  });

  it("ledgers mark G-48 BUILT, F-15-14 and F-15-15 FIXED, the plan has 2.8, the KB knows", () => {
    const gaps = read("docs/sop-program/05-GAP-REGISTER.md");
    expect(gaps).toMatch(/\| G-48 \|[^\n]*\*\*BUILT\*\* \(Phase 2\.8/);
    const find = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(find).toMatch(/F-15-14[\s\S]{0,3000}FIXED[\s\S]{0,200}Fix Phase 2\.8/);
    expect(find).toMatch(/F-15-15[\s\S]{0,3000}FIXED[\s\S]{0,200}Fix Phase 2\.8/);
    const plan = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
    expect(plan).toMatch(/\| 2\.8 \| G-48 returns in the books[^\n]*\*\*BUILT\*\*/);
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toMatch(/Draft refunds/);
    expect(kb).toMatch(/How Box 1 is made/);
  });
});

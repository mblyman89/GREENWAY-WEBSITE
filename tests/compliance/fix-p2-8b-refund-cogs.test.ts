/**
 * tests/compliance/fix-p2-8b-refund-cogs.test.ts
 *
 * Fix Phase 2.8b (G-48 follow-up; F-15-14). Owner, message 6, verbatim:
 *   "Please completely finish the refund entry, so it puts back the cost of
 *   returned items. Please make sure this is of enterprise grade quality."
 *
 * What this file proves:
 *   1. The pure core: DR 2xxxx / CR 6xxxx per category under refunds:<day>#cogs;
 *      destroyed returns stay in COGS; unknown cost refuses, never guesses.
 *   2. The poster: restock cost from the lot; void cost from the sale's own
 *      order:<id>#cogs entry; the cost entry and the money entry stand apart.
 *   3. The audit and the panel.
 *   4. Census, SOP-15 v1.12, KB and ledgers (D41).
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
  refundCogsSourceRef,
  costLinesFromSaleCogs,
  returnCost,
  buildRefundCogsJournal,
  __runRefundCogsCoreTests,
  type RefundCostItem,
} from "@/lib/accounting/refund-cogs-core";
import { draftRefundsForDay } from "@/lib/accounting/refund-posting-service";
import { draftRefundsAction } from "@/app/admin/books/drafts/actions";

const read = (p: string) => readFileSync(p, "utf8");

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

const item = (over: Partial<RefundCostItem> = {}): RefundCostItem => ({
  source: "return",
  sourceId: "r1",
  label: "Counter return",
  disposition: "restock",
  costLines: [{ categorySlug: "flower", costCents: 412 }],
  ...over,
});
const codeOf = (o: ReturnType<typeof buildRefundCogsJournal>) => (o.kind === "refused" ? o.code : o.kind);

// ── 1. The pure core ─────────────────────────────────────────────────────
describe("Fix Phase 2.8b: the cost-back core", () => {
  it("its own self-tests run and pass (30+)", () => {
    const r = __runRefundCogsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("one ref per day, separate from the money entry", () => {
    expect(refundCogsSourceRef("2026-11-02")).toBe("refunds:2026-11-02#cogs");
  });

  it("a restocked flower return: DR 20010 / CR 60010, balanced, never autoPost", () => {
    const out = buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item()] });
    expect(out.kind).toBe("journal");
    if (out.kind !== "journal") return;
    const j = out.journal;
    expect(j.sourceRef).toBe("refunds:2026-11-02#cogs");
    expect(j.sourceKind).toBe("pos_sale");
    expect(j.journalDate).toBe("2026-11-02");
    expect(j.lines.map((l) => [l.accountCode, l.amountCents, l.costClass])).toEqual([
      ["20010", 412, "none"],
      ["60010", -412, "cogs_direct"],
    ]);
    expect(j.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(0);
    expect(out.totals).toEqual({ costCents: 412, restockedCount: 1, destroyedCount: 0, noCostCount: 0 });
  });

  it("two categories are summed per category; total balances", () => {
    const out = buildRefundCogsJournal({
      businessDay: "2026-11-02",
      items: [
        item(),
        item({ sourceId: "r2", costLines: [{ categorySlug: "flower", costCents: 100 }] }),
        item({ source: "void", sourceId: "o1", label: "Void", costLines: [{ categorySlug: "preroll", costCents: 250 }] }),
      ],
    });
    expect(out.kind).toBe("journal");
    if (out.kind !== "journal") return;
    const m = new Map(out.journal.lines.map((l) => [l.accountCode, l.amountCents]));
    expect(m.get("20010")).toBe(512);
    expect(m.get("60010")).toBe(-512);
    expect(m.get("20050")).toBe(250);
    expect(m.get("60050")).toBe(-250);
    expect(out.totals.costCents).toBe(762);
  });

  it("a destroyed return keeps its cost in COGS: nothing to draft, and it says why", () => {
    const out = buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ disposition: "destroy", costLines: null })] });
    expect(out.kind).toBe("nothing");
    if (out.kind === "nothing") {
      expect(out.totals.destroyedCount).toBe(1);
      expect(out.explanation).toMatch(/destruction posts no entry/);
    }
  });

  it("refuses: bad day, before the books, unknown cost, unknown category, bad amount", () => {
    expect(codeOf(buildRefundCogsJournal({ businessDay: "nope", items: [item()] }))).toBe("REFUND_COGS_BAD_DAY");
    expect(codeOf(buildRefundCogsJournal({ businessDay: "2025-12-31", items: [item()] }))).toBe("REFUND_COGS_BEFORE_LINE_IN_THE_SAND");
    expect(codeOf(buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ costLines: null, costNote: "x" })] }))).toBe(
      "REFUND_COGS_UNKNOWN_COST",
    );
    expect(
      codeOf(buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ costLines: [{ categorySlug: "mystery", costCents: 1 }] })] })),
    ).toBe("REFUND_COGS_UNKNOWN_CATEGORY");
    expect(
      codeOf(buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ costLines: [{ categorySlug: "flower", costCents: 1.5 }] })] })),
    ).toBe("REFUND_COGS_BAD_AMOUNT");
    expect(
      codeOf(buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ costLines: [{ categorySlug: "flower", costCents: -1 }] })] })),
    ).toBe("REFUND_COGS_BAD_AMOUNT");
  });

  it("the unknown-cost refusal names the item and the reason", () => {
    const out = buildRefundCogsJournal({ businessDay: "2026-11-02", items: [item({ label: "Return #7", costLines: null, costNote: "the lot has no unit cost" })] });
    expect(out.kind).toBe("refused");
    if (out.kind === "refused") {
      expect(out.explanation).toMatch(/Return #7/);
      expect(out.explanation).toMatch(/the lot has no unit cost/);
    }
  });

  it("returnCost: unit cost x quantity in whole cents; unknown or fractional is refused", () => {
    expect(returnCost(412, 2)).toEqual({ ok: true, costCents: 824 });
    expect(returnCost(null, 1).ok).toBe(false);
    expect(returnCost(undefined, 1).ok).toBe(false);
    expect(returnCost(-1, 1).ok).toBe(false);
    expect(returnCost(412, 0).ok).toBe(false);
    expect(returnCost(333, 0.5).ok).toBe(false);
    expect(returnCost(400, 0.5)).toEqual({ ok: true, costCents: 200 });
  });

  it("costLinesFromSaleCogs: reads the sale's DR 6xxxx / CR 2xxxx per category and checks they match", () => {
    expect(
      costLinesFromSaleCogs([
        { accountCode: "60010", amountCents: 412 },
        { accountCode: "20010", amountCents: -412 },
      ]),
    ).toEqual({ ok: true, lines: [{ categorySlug: "flower", costCents: 412 }] });
    expect(costLinesFromSaleCogs([{ accountCode: "60010", amountCents: 412 }, { accountCode: "20010", amountCents: -400 }]).ok).toBe(false);
    expect(costLinesFromSaleCogs([{ accountCode: "10110", amountCents: 412 }]).ok).toBe(false);
    expect(costLinesFromSaleCogs([{ accountCode: "60010", amountCents: 0 }]).ok).toBe(false);
  });
});

// ── 2. The poster ────────────────────────────────────────────────────────
describe("Fix Phase 2.8b: the poster drafts the cost entry beside the money entry", () => {
  const drawerReturn: FakeRefund = {
    source: "return",
    sourceId: "r1",
    refundMinor: 1463,
    paidFrom: "drawer",
    drawerSessionId: "s1",
    label: "Counter return",
    atIso: "2026-11-02T20:00:00Z",
  };
  const flowerLine = { data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null };

  it("a restocked return: cost from the lot (2 x 412) -> DR 20010 824 / CR 60010 -824, refunds:<day>#cogs, no autoPost", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 2, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    QUEUE.inventory_lots = [{ data: { id: "lot-1", unit_cost_minor_units: 412 }, error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(SUBMITS).toHaveLength(2);
    const cogs = SUBMITS.find((s) => s.sourceRef === "refunds:2026-11-02#cogs");
    const money = SUBMITS.find((s) => s.sourceRef === "refunds:2026-11-02");
    expect(cogs).toBeDefined();
    expect(money).toBeDefined();
    expect(cogs?.autoPost).toBeUndefined();
    expect(cogs?.lines.map((l) => [l.accountCode, l.amountCents])).toEqual([
      ["20010", 824],
      ["60010", -824],
    ]);
    expect(CALLS.find((c) => c.table === "inventory_lots")?.ops).toContain('eq("id","lot-1")');
    expect(out.cogs?.kind).toBe("drafted");
    if (out.cogs?.kind === "drafted") {
      expect(out.cogs.totals.costCents).toBe(824);
      expect(out.cogs.duplicate).toBe(false);
    }
  });

  it("a void: the cost comes from the sale's own order:<id>#cogs entry, line for line", async () => {
    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, source: "void", sourceId: "o1", label: "Void" }] };
    QUEUE.order_lines = [{ data: [{ category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "a" }], error: null }];
    QUEUE.gl_journals = [{ data: [{ id: "jc-1", status: "posted" }], error: null }];
    QUEUE.gl_journal_lines = [
      {
        data: [
          { amount_cents: 412, gl_accounts: { code: "60010" } },
          { amount_cents: -412, gl_accounts: { code: "20010" } },
        ],
        error: null,
      },
    ];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    const j = CALLS.find((c) => c.table === "gl_journals");
    expect(j?.ops).toContain('eq("source_ref","order:o1#cogs")');
    expect(j?.ops).toContain('in("status",["draft","posted"])');
    expect(CALLS.find((c) => c.table === "gl_journal_lines")?.ops).toContain('eq("journal_id","jc-1")');
    const cogs = SUBMITS.find((s) => s.sourceRef === "refunds:2026-11-02#cogs");
    expect(cogs?.lines.map((l) => [l.accountCode, l.amountCents])).toEqual([
      ["20010", 412],
      ["60010", -412],
    ]);
  });

  it("a void whose sale booked no cost entry: nothing to put back, never a guess", async () => {
    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, source: "void", sourceId: "o2", label: "Void" }] };
    QUEUE.order_lines = [{ data: [{ category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "a" }], error: null }];
    QUEUE.gl_journals = [{ data: [], error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(out.cogs?.kind).toBe("nothing");
    expect(SUBMITS.map((s) => s.sourceRef)).toEqual(["refunds:2026-11-02"]);
  });

  it("a destroyed return: the lot is not read, no cost entry, the money entry still drafts", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "destroy" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(out.cogs?.kind).toBe("nothing");
    expect(CALLS.some((c) => c.table === "inventory_lots")).toBe(false);
    expect(SUBMITS.map((s) => s.sourceRef)).toEqual(["refunds:2026-11-02"]);
  });

  it("an unknown lot cost refuses ONLY the cost entry; the money entry is still drafted", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    QUEUE.inventory_lots = [{ data: { id: "lot-1", unit_cost_minor_units: null }, error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind).toBe("drafted");
    expect(out.cogs?.kind).toBe("refused");
    if (out.cogs?.kind === "refused") {
      expect(out.cogs.code).toBe("REFUND_COGS_UNKNOWN_COST");
      expect(out.cogs.message).toMatch(/no unit cost/);
    }
    expect(SUBMITS.map((s) => s.sourceRef)).toEqual(["refunds:2026-11-02"]);
  });

  it("a lot read failure is unknown, never zero", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    QUEUE.inventory_lots = [{ data: null, error: { message: "down" } }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.cogs?.kind).toBe("refused");
    expect(SUBMITS.some((s) => s.sourceRef.endsWith("#cogs"))).toBe(false);
  });

  it("a return with no lot recorded is an unknown cost, never zero", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: null, quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.cogs?.kind === "refused" && out.cogs.code).toBe("REFUND_COGS_UNKNOWN_COST");
    expect(SUBMITS.some((s) => s.sourceRef.endsWith("#cogs"))).toBe(false);
  });

  it("a void whose sale has two cost entries is refused, never summed", async () => {
    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, source: "void", sourceId: "o3", label: "Void" }] };
    QUEUE.order_lines = [{ data: [{ category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "a" }], error: null }];
    QUEUE.gl_journals = [{ data: [{ id: "a", status: "posted" }, { id: "b", status: "draft" }], error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.cogs?.kind === "refused" && out.cogs.code).toBe("REFUND_COGS_UNKNOWN_COST");
    if (out.cogs?.kind === "refused") expect(out.cogs.message).toMatch(/2 cost entries/);
  });

  it("the cost entry is drafted even when the money entry is refused (untied refund)", async () => {
    DAY_READ = { ...DAY_READ, refunds: [{ ...drawerReturn, paidFrom: null }] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    QUEUE.inventory_lots = [{ data: { id: "lot-1", unit_cost_minor_units: 412 }, error: null }];
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.kind === "refused" && out.code).toBe("REFUND_UNTIED");
    expect(out.cogs?.kind).toBe("drafted");
    expect(SUBMITS.map((s) => s.sourceRef)).toEqual(["refunds:2026-11-02#cogs"]);
  });

  it("a cost-entry conflict explains itself and does not stop the money entry", async () => {
    DAY_READ = { ...DAY_READ, refunds: [drawerReturn] };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [flowerLine];
    QUEUE.inventory_lots = [{ data: { id: "lot-1", unit_cost_minor_units: 412 }, error: null }];
    SUBMIT_RESULT = { ok: false, code: "GL_POST_CONFLICT", message: "conflict" };
    const out = await draftRefundsForDay("2026-11-02");
    expect(out.cogs?.kind).toBe("failed");
    if (out.cogs?.kind === "failed") expect(out.cogs.message).toMatch(/already exists with different figures/);
    expect(SUBMITS).toHaveLength(2);
  });

  it("source: no autoPost, the cost entry is built before the money entry", () => {
    const src = read("src/lib/accounting/refund-posting-service.ts");
    expect(src).not.toMatch(/autoPost:\s*true/);
    expect(src.indexOf("draftCogsForDay(admin, day, costItems)")).toBeGreaterThan(0);
    expect(src.indexOf("draftCogsForDay(admin, day, costItems)")).toBeLessThan(src.indexOf("buildRefundDayJournal({ businessDay: day, refunds })"));
  });
});

// ── 3. The action and the panel ──────────────────────────────────────────
describe("Fix Phase 2.8b: the audit and the panel", () => {
  it("the audit carries the cost entry's result and a new cost draft refreshes the page", async () => {
    DAY_READ = {
      ...DAY_READ,
      refunds: [{ source: "return", sourceId: "r1", refundMinor: 1463, paidFrom: "drawer", drawerSessionId: "s1", label: null, atIso: "" }],
    };
    QUEUE.customer_returns = [{ data: { id: "r1", order_line_id: "l1", lot_id: "lot-1", quantity: 1, disposition: "restock" }, error: null }];
    QUEUE.order_lines = [{ data: { category: "Flower", quantity: 1, price_minor_units: 1463, product_name: "x" }, error: null }];
    QUEUE.inventory_lots = [{ data: { id: "lot-1", unit_cost_minor_units: 412 }, error: null }];
    await draftRefundsAction("2026-11-02");
    expect(ORDER[0]).toBe("gate");
    expect(AUDITS[0].after).toMatchObject({ cogsKind: "drafted", cogsCode: "DRAFTED", cogsCostCents: 412 });
    expect(REVALIDATED).toEqual(["/admin/books/drafts"]);
  });

  it("the panel shows the cost of returned units", () => {
    const p = read("src/app/admin/books/drafts/DraftRefundsPanel.tsx");
    expect(p).toMatch(/Cost of returned units/);
  });
});

// ── 4. Census, SOP, KB and ledgers ───────────────────────────────────────
describe("Fix Phase 2.8b: census, living SOP, KB and ledgers (D41)", () => {
  it("census row names the cost entry", () => {
    const c = read("src/lib/accounting/ledger-census-data.ts");
    expect(c).toMatch(/Fix Phase 2\.8b: the same press drafts a second entry, refunds:<day>#cogs/);
  });
  it("SOP-15 is v1.12 or later and supersedes the v1.11 limit", () => {
    const sop = read("docs/sop/SOP-15-returns-vendor-destruction.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.(1[2-9]|[2-9]\d) /);
    expect(sop).toMatch(/\| 1\.12 draft \| Fix phase \| Phase 2\.8b/);
    expect(sop).toMatch(/refunds:<day>#cogs/);
  });
  it("the KB no longer says the cost is not put back", () => {
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).not.toMatch(/The entry does not put the cost of returned units back/);
    expect(kb).toMatch(/Cost of returned units \(Phase 2\.8b\)/);
  });
  it("ledgers quote and supersede the limit; the plan has 2.8b", () => {
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toMatch(/Phase 2\.8b[^\n]*is superseded/);
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toMatch(/\| G-48 \|[^\n]*Phase 2\.8b/);
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 2\.8b \| Cost of returned units[^\n]*\*\*BUILT\*\*/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toMatch(/Phase 2\.8b \(cost of returned units\) answers/);
  });
});

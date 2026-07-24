/**
 * src/lib/discounts/special-discount-report-core.ts  (SLICE 29)
 *
 * PURE summarizer for the special-discount use ledger (migration 0133).
 * Turns raw `special_discount_uses` rows into the owner's three questions:
 *
 *   WHO gives them      — per-cashier counts + cents given away (and, for the
 *                         employee program, per-APPROVER counts, because the
 *                         second PIN is accountability too).
 *   TO WHOM             — per-employee-beneficiary and per-company rollups
 *                         (company names grouped case-insensitively so
 *                         "Acme Farms" and "acme farms" are ONE vendor, with
 *                         the first-seen casing kept for display).
 *   HOW OFTEN           — total + per-program counts, and a per-Pacific-day
 *                         trend (Greenway operates in WA, so days bucket in
 *                         America/Los_Angeles, never UTC).
 *
 * All money in MINOR UNITS (cents). PURE: no I/O, no server-only — the same
 * math runs in the report page, the export route, and the tests. Self-tests
 * embedded (__runSpecialDiscountReportTests) — wired into the compliance pure
 * runner and mirrored in vitest.
 */
import { pacificDayKey } from "@/lib/reports/timezone";
import { isSpecialDiscountKind, type SpecialDiscountKind } from "./special-discount-core";

// ---------------------------------------------------------------------------
// Input — the ledger row shape the summarizer needs (a subset of the store's
// SpecialDiscountUseRow, so both the server fetch and tests can feed it).
// ---------------------------------------------------------------------------

export type SpecialDiscountUseLike = {
  kind: SpecialDiscountKind;
  /** Employee who RANG the sale (who GAVE the discount). */
  cashierEmployeeId: string;
  registerId: string;
  /** employee program: which staff member was buying. */
  beneficiaryEmployeeId: string | null;
  /** employee program: the OTHER employee who approved by PIN. */
  approvedByEmployeeId: string | null;
  /** industry program: the visitor's company. */
  companyName: string | null;
  /** veteran program: cashier confirmed a physical military ID. */
  militaryIdChecked: boolean;
  /** Pre-discount subtotal snapshot, cents. */
  subtotalMinor: number;
  /** Cents taken off. */
  discountMinor: number;
  /** ISO timestamp of the use. */
  occurredAt: string;
};

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export type SpecialDiscountKindSummary = {
  kind: SpecialDiscountKind;
  uses: number;
  discountMinor: number;
  subtotalMinor: number;
};

/** A per-person rollup (cashier / beneficiary / approver), keyed by id. */
export type SpecialDiscountPersonSummary = {
  id: string;
  uses: number;
  discountMinor: number;
  /** ISO timestamp of this person's most recent use. */
  lastUsedAt: string;
};

/** A per-company rollup (industry program), grouped case-insensitively. */
export type SpecialDiscountCompanySummary = {
  /** Case-insensitive grouping key (lowercased, trimmed). */
  key: string;
  /** Display name — the first-seen casing. */
  name: string;
  uses: number;
  discountMinor: number;
  lastUsedAt: string;
};

export type SpecialDiscountDaySummary = {
  /** Pacific calendar day, YYYY-MM-DD. */
  date: string;
  uses: number;
  discountMinor: number;
};

export type SpecialDiscountReportSummary = {
  totalUses: number;
  totalDiscountMinor: number;
  totalSubtotalMinor: number;
  /** Whole-sale average cents saved per use (0 when no uses). */
  avgDiscountMinor: number;
  /** All three programs, canonical order, zero-filled when unused. */
  byKind: SpecialDiscountKindSummary[];
  /** WHO gives them — cashiers, most cents given first. */
  byCashier: SpecialDiscountPersonSummary[];
  /** TO WHOM (employee program) — buying employees, most cents first. */
  byBeneficiary: SpecialDiscountPersonSummary[];
  /** WHO approves them (employee program) — witnesses, most uses first. */
  byApprover: SpecialDiscountPersonSummary[];
  /** TO WHOM (industry program) — companies, most cents first. */
  byCompany: SpecialDiscountCompanySummary[];
  /** HOW OFTEN — per-Pacific-day trend, oldest day first. */
  byDay: SpecialDiscountDaySummary[];
};

// ---------------------------------------------------------------------------
// The summarizer
// ---------------------------------------------------------------------------

const KIND_ORDER: SpecialDiscountKind[] = ["employee", "industry", "veteran"];

function cleanMinor(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function bumpPerson(
  map: Map<string, SpecialDiscountPersonSummary>,
  id: string | null,
  discountMinor: number,
  occurredAt: string,
): void {
  if (!id) return;
  const prev = map.get(id);
  if (prev) {
    prev.uses += 1;
    prev.discountMinor += discountMinor;
    if (occurredAt > prev.lastUsedAt) prev.lastUsedAt = occurredAt;
  } else {
    map.set(id, { id, uses: 1, discountMinor, lastUsedAt: occurredAt });
  }
}

/**
 * Roll a window of ledger rows up into the report summary. Rows with an
 * unknown kind are skipped defensively (the store already filters, but the
 * summarizer never trusts its input). Deterministic ordering everywhere so
 * the page, the export, and the tests always agree.
 */
export function summarizeSpecialDiscountUses(
  rows: SpecialDiscountUseLike[],
): SpecialDiscountReportSummary {
  const byKind = new Map<SpecialDiscountKind, SpecialDiscountKindSummary>(
    KIND_ORDER.map((kind) => [kind, { kind, uses: 0, discountMinor: 0, subtotalMinor: 0 }]),
  );
  const byCashier = new Map<string, SpecialDiscountPersonSummary>();
  const byBeneficiary = new Map<string, SpecialDiscountPersonSummary>();
  const byApprover = new Map<string, SpecialDiscountPersonSummary>();
  const byCompany = new Map<string, SpecialDiscountCompanySummary>();
  const byDay = new Map<string, SpecialDiscountDaySummary>();

  let totalUses = 0;
  let totalDiscountMinor = 0;
  let totalSubtotalMinor = 0;

  for (const row of rows) {
    if (!isSpecialDiscountKind(row.kind)) continue;
    const discount = cleanMinor(row.discountMinor);
    const subtotal = cleanMinor(row.subtotalMinor);
    const at = row.occurredAt || "";

    totalUses += 1;
    totalDiscountMinor += discount;
    totalSubtotalMinor += subtotal;

    const k = byKind.get(row.kind)!;
    k.uses += 1;
    k.discountMinor += discount;
    k.subtotalMinor += subtotal;

    bumpPerson(byCashier, row.cashierEmployeeId, discount, at);
    if (row.kind === "employee") {
      bumpPerson(byBeneficiary, row.beneficiaryEmployeeId, discount, at);
      bumpPerson(byApprover, row.approvedByEmployeeId, discount, at);
    }
    if (row.kind === "industry") {
      const display = (row.companyName ?? "").trim();
      const key = display.toLowerCase();
      if (key) {
        const prev = byCompany.get(key);
        if (prev) {
          prev.uses += 1;
          prev.discountMinor += discount;
          if (at > prev.lastUsedAt) prev.lastUsedAt = at;
        } else {
          byCompany.set(key, { key, name: display, uses: 1, discountMinor: discount, lastUsedAt: at });
        }
      }
    }

    // Pacific-day trend. A blank/garbage timestamp would throw inside Date —
    // guard so one bad row can't take the whole report down.
    if (at && Number.isFinite(Date.parse(at))) {
      const day = pacificDayKey(at);
      const prev = byDay.get(day);
      if (prev) {
        prev.uses += 1;
        prev.discountMinor += discount;
      } else {
        byDay.set(day, { date: day, uses: 1, discountMinor: discount });
      }
    }
  }

  const personSort = (a: SpecialDiscountPersonSummary, b: SpecialDiscountPersonSummary) =>
    b.discountMinor - a.discountMinor || b.uses - a.uses || a.id.localeCompare(b.id);

  return {
    totalUses,
    totalDiscountMinor,
    totalSubtotalMinor,
    avgDiscountMinor: totalUses > 0 ? Math.round(totalDiscountMinor / totalUses) : 0,
    byKind: KIND_ORDER.map((kind) => byKind.get(kind)!),
    byCashier: [...byCashier.values()].sort(personSort),
    byBeneficiary: [...byBeneficiary.values()].sort(personSort),
    byApprover: [...byApprover.values()].sort(
      (a, b) => b.uses - a.uses || b.discountMinor - a.discountMinor || a.id.localeCompare(b.id),
    ),
    byCompany: [...byCompany.values()].sort(
      (a, b) => b.discountMinor - a.discountMinor || b.uses - a.uses || a.key.localeCompare(b.key),
    ),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ── Embedded self-tests ───────────────────────────────────────────────────── */

export function __runSpecialDiscountReportTests(): void {
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`special-discount-report-core: FAIL ${what}`);
  };
  const mkUse = (over: Partial<SpecialDiscountUseLike>): SpecialDiscountUseLike => ({
    kind: "veteran",
    cashierEmployeeId: "cash-1",
    registerId: "reg-1",
    beneficiaryEmployeeId: null,
    approvedByEmployeeId: null,
    companyName: null,
    militaryIdChecked: true,
    subtotalMinor: 10_000,
    discountMinor: 1_500,
    occurredAt: "2026-02-10T20:00:00.000Z", // 12:00 Pacific (PST)
    ...over,
  });

  // Empty window: zero-filled, all three kinds present in canonical order.
  const empty = summarizeSpecialDiscountUses([]);
  ok(empty.totalUses === 0 && empty.totalDiscountMinor === 0, "empty totals are zero");
  ok(empty.avgDiscountMinor === 0, "empty avg is zero (no divide-by-zero)");
  ok(
    empty.byKind.length === 3 &&
      empty.byKind[0].kind === "employee" &&
      empty.byKind[1].kind === "industry" &&
      empty.byKind[2].kind === "veteran",
    "byKind always has the three programs in canonical order",
  );
  ok(empty.byCashier.length === 0 && empty.byCompany.length === 0 && empty.byDay.length === 0, "empty rollups are empty");

  // A realistic mixed window.
  const rows: SpecialDiscountUseLike[] = [
    // Employee purchase: Bob buys, Carol approves, Alice rings it.
    mkUse({
      kind: "employee",
      cashierEmployeeId: "alice",
      beneficiaryEmployeeId: "bob",
      approvedByEmployeeId: "carol",
      subtotalMinor: 10_000,
      discountMinor: 3_500,
      occurredAt: "2026-02-10T20:00:00.000Z",
    }),
    // Same day: Bob buys again, Dave approves, Alice rings it.
    mkUse({
      kind: "employee",
      cashierEmployeeId: "alice",
      beneficiaryEmployeeId: "bob",
      approvedByEmployeeId: "dave",
      subtotalMinor: 2_000,
      discountMinor: 700,
      occurredAt: "2026-02-10T21:00:00.000Z",
    }),
    // Industry: two casings of the same company, different cashiers/days.
    mkUse({
      kind: "industry",
      cashierEmployeeId: "alice",
      companyName: "Acme Farms",
      subtotalMinor: 5_000,
      discountMinor: 500,
      occurredAt: "2026-02-10T22:00:00.000Z",
    }),
    mkUse({
      kind: "industry",
      cashierEmployeeId: "erin",
      companyName: "  acme farms ",
      subtotalMinor: 3_000,
      discountMinor: 300,
      occurredAt: "2026-02-11T20:00:00.000Z",
    }),
    // Veteran: Erin rings it the next Pacific day.
    mkUse({
      kind: "veteran",
      cashierEmployeeId: "erin",
      subtotalMinor: 4_000,
      discountMinor: 600,
      occurredAt: "2026-02-11T21:00:00.000Z",
    }),
  ];
  const s = summarizeSpecialDiscountUses(rows);

  // HOW OFTEN — totals.
  ok(s.totalUses === 5, "total uses counted");
  ok(s.totalDiscountMinor === 3_500 + 700 + 500 + 300 + 600, "total cents saved summed");
  ok(s.totalSubtotalMinor === 10_000 + 2_000 + 5_000 + 3_000 + 4_000, "total subtotal summed");
  ok(s.avgDiscountMinor === Math.round(5_600 / 5), "avg cents per use");

  // Per-program split.
  const emp = s.byKind.find((k) => k.kind === "employee")!;
  const ind = s.byKind.find((k) => k.kind === "industry")!;
  const vet = s.byKind.find((k) => k.kind === "veteran")!;
  ok(emp.uses === 2 && emp.discountMinor === 4_200, "employee program split");
  ok(ind.uses === 2 && ind.discountMinor === 800, "industry program split");
  ok(vet.uses === 1 && vet.discountMinor === 600, "veteran program split");

  // WHO gives them — cashiers, most cents first (Alice 4700 > Erin 900).
  ok(s.byCashier.length === 2, "two distinct cashiers");
  ok(s.byCashier[0].id === "alice" && s.byCashier[0].uses === 3 && s.byCashier[0].discountMinor === 4_700, "Alice leads the cashier rollup");
  ok(s.byCashier[1].id === "erin" && s.byCashier[1].uses === 2 && s.byCashier[1].discountMinor === 900, "Erin second with her two uses");
  ok(s.byCashier[0].lastUsedAt === "2026-02-10T22:00:00.000Z", "cashier lastUsedAt tracks the newest use");

  // TO WHOM — employee beneficiaries (only the employee program counts here).
  ok(s.byBeneficiary.length === 1 && s.byBeneficiary[0].id === "bob", "Bob is the only beneficiary");
  ok(s.byBeneficiary[0].uses === 2 && s.byBeneficiary[0].discountMinor === 4_200, "Bob's two buys rolled up");

  // WHO approves — Carol and Dave once each (uses tie → cents breaks it).
  ok(s.byApprover.length === 2, "two distinct approvers");
  ok(s.byApprover[0].id === "carol" && s.byApprover[0].discountMinor === 3_500, "Carol first (bigger approval)");

  // TO WHOM — companies, case-insensitive grouping, first casing displayed.
  ok(s.byCompany.length === 1, "Acme Farms grouped case-insensitively into one vendor");
  ok(s.byCompany[0].name === "Acme Farms" && s.byCompany[0].key === "acme farms", "display keeps first-seen casing");
  ok(s.byCompany[0].uses === 2 && s.byCompany[0].discountMinor === 800, "company uses + cents rolled up");
  ok(s.byCompany[0].lastUsedAt === "2026-02-11T20:00:00.000Z", "company lastUsedAt tracks the newest use");

  // HOW OFTEN — Pacific-day trend, oldest first.
  ok(s.byDay.length === 2, "two Pacific days in the window");
  ok(s.byDay[0].date === "2026-02-10" && s.byDay[0].uses === 3 && s.byDay[0].discountMinor === 4_700, "day one bucketed in Pacific time");
  ok(s.byDay[1].date === "2026-02-11" && s.byDay[1].uses === 2 && s.byDay[1].discountMinor === 900, "day two bucketed in Pacific time");

  // Pacific vs UTC: 2026-02-11T05:00Z is still Feb 10 in Washington.
  const late = summarizeSpecialDiscountUses([mkUse({ occurredAt: "2026-02-11T05:00:00.000Z" })]);
  ok(late.byDay.length === 1 && late.byDay[0].date === "2026-02-10", "a late-night sale lands on the Pacific day, not the UTC day");

  // Defensive hygiene: unknown kind skipped; garbage money cleaned; blank
  // company and blank timestamp never crash or pollute the rollups.
  const dirty = summarizeSpecialDiscountUses([
    mkUse({ kind: "mystery" as SpecialDiscountKind }),
    mkUse({ discountMinor: Number.NaN, subtotalMinor: -50, occurredAt: "" }),
    mkUse({ kind: "industry", companyName: "   " }),
  ]);
  ok(dirty.totalUses === 2, "unknown kind skipped, dirty rows still counted");
  ok(dirty.totalDiscountMinor === 1_500 && dirty.totalSubtotalMinor === 10_000, "NaN/negative money cleaned to zero");
  ok(dirty.byCompany.length === 0, "blank company name never becomes a vendor row");
  ok(dirty.byDay.length === 1, "blank timestamp skips the day trend without crashing");

  console.log("special-discount-report: 31 self-tests passed");
}

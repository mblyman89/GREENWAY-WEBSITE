/**
 * src/lib/payments/vendor-reconcile-core.ts — PURE vendor payment ↔ bank
 * reconciliation (P7-a).
 *
 * WHAT THIS ANSWERS (Michael's ask)
 * Every time a vendor invoice (an ACCEPTED inbound manifest) gets paid, the app
 * records a row in vendor_manifest_payments — the real "what we actually paid"
 * ledger (amount in CENTS, how it was paid, when, which vendor/manifest). When
 * that payment goes out by ACH or WIRE, the money leaves the Main (Timberland)
 * operating account and shows up as a withdrawal in the Plaid bank feed. This
 * engine marries each RECORDED bank-clearing payment to that real withdrawal —
 * line-item, in plain English — so Michael can prove every invoice he marked
 * paid actually cleared the bank for the right amount, and instantly spot any
 * that DIDN'T.
 *
 * WHY THIS IS BUILDABLE NOW (no live ACH license needed)
 * Recording a payment and reconciling it against the bank are read/verify steps.
 * Only ORIGINATING a payment (transmitting a NACHA file to the bank) needs the
 * live license — that is P7-b, deliberately kept separate. This slice touches
 * nothing that moves money.
 *
 * HOW THIS DIFFERS FROM PAYROLL RECONCILIATION (P6b) — verified, not guessed
 *   • Payroll: ONE lump-sum ACH debit per run (the NACHA file is credit-only, so
 *     the bank posts a single offsetting debit = the batch total). We matched one
 *     run → one withdrawal.
 *   • Vendor payments: each vendor_manifest_payments ROW is its OWN payment
 *     against one manifest. So we match one PAYMENT → one withdrawal.
 *   • Payment METHOD matters here. Only 'ach' and 'wire' pull money from the bank
 *     account and therefore appear in the Plaid feed. A 'cash' payment leaves the
 *     VAULT, not the bank; a 'check' clears the bank but on the check's own
 *     timing (not the record date), and 'other' is unknown. We reconcile only the
 *     BANK-CLEARING methods (ach/wire) against the feed, and surface the rest in a
 *     separate, honest "paid another way — not expected in the bank feed" bucket
 *     so nothing hangs or looks broken.
 *
 * WHY A PURE CORE
 * All the judgment (which withdrawal matches which payment, is it on time, does
 * the amount tie out, which method is even bank-clearing) lives here with ZERO
 * I/O so it is exhaustively self-tested and deterministic. The store hands it
 * plain arrays; the page renders the result. Mirrors P6a/P6b exactly.
 *
 * VERIFIED FACTS THIS IS BUILT ON (audited, not guessed):
 *   • vendor_manifest_payments carries amount_minor_units (> 0 CENTS),
 *     payment_method ('ach'|'check'|'cash'|'wire'|'other'), created_at (pay
 *     timestamp), vendor_name, manifest_number — migrations 0067/0068.
 *   • Main bank account = Plaid account role==="main" — plaid-core AccountRole.
 *   • Plaid sign convention (load-bearing): POSITIVE amount_cents = money OUT
 *     (a withdrawal/debit). A vendor payment is an OUTFLOW, so we keep positive
 *     rows and use their magnitude directly (same as payroll's toBankWithdrawals).
 *   • bankPostingWindow(iso, lo, hi) gives the inclusive business-day ISO window
 *     a debit can post in — reused from atm-core.ts (returns null on bad date).
 *   • Money is integer CENTS everywhere.
 *
 * STATUS MODEL (per bank-clearing payment) — plain English:
 *   • matched   — a bank withdrawal of the exact amount posted in-window.
 *   • mismatch  — a withdrawal posted in-window but the amount is off (we show by
 *                 how many cents, signed).
 *   • awaiting  — no withdrawal yet, but we're still inside the posting window
 *                 (NORMAL — the ACH just hasn't settled/posted yet).
 *   • unmatched — the window has fully passed and no withdrawal ever arrived
 *                 (THIS is the one to chase — did the payment actually go out?).
 *
 * GREEDY, DETERMINISTIC MATCHING: bank-clearing payments are processed
 * oldest-first. Each bank withdrawal can be consumed by at most ONE payment (so
 * two payments never claim the same debit). Within a payment's window we prefer
 * an EXACT amount match; otherwise the closest in-window debit becomes a mismatch
 * ONLY within a sensible tolerance band (so a $9,000 invoice never "matches" a
 * $40 bank fee); if the window is still open we mark awaiting and consume
 * nothing. Classic bank-rec worksheet, made honest.
 */

import { bankPostingWindow } from "@/lib/atm/atm-core";

// ---------------------------------------------------------------------------
// Inputs (plain data the store hands us)
// ---------------------------------------------------------------------------

/** How a vendor payment was made (mirrors vendor-payables-store PaymentMethod). */
export type VendorPaymentMethod = "ach" | "check" | "cash" | "wire" | "other";

/** A recorded vendor payment to reconcile (one vendor_manifest_payments row). */
export type VendorPaymentRecord = {
  paymentId: string;
  vendorName: string;
  manifestNumber: string;
  /** Amount applied to this manifest in this payment, CENTS (> 0). */
  amountCents: number;
  /** yyyy-mm-dd the payment was recorded (from created_at, Pacific day). */
  paidDate: string;
  method: VendorPaymentMethod;
  /** NACHA draft grouping (ACH) or human reference (check #, wire conf). */
  reference: string | null;
};

/** A single bank withdrawal (money OUT) from the Main operating account. */
export type BankWithdrawal = {
  transactionId: string;
  amountCents: number; // POSITIVE magnitude of money that LEFT the account
  date: string; // yyyy-mm-dd posted date
  description: string | null;
  pending: boolean;
};

/** The Plaid transaction shape we down-convert from (subset we actually use). */
export type WithdrawalSourceTxn = {
  transactionId: string;
  amountCents: number; // Plaid sign: POSITIVE = money out (a debit)
  date: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type VendorReconcileStatus = "matched" | "mismatch" | "awaiting" | "unmatched";

/** One reconciled bank-clearing payment row (what the view renders). */
export type PaymentMatch = {
  paymentId: string;
  vendorName: string;
  manifestNumber: string;
  paidDate: string;
  method: VendorPaymentMethod;
  reference: string | null;
  status: VendorReconcileStatus;
  expectedCents: number;
  /** The matched withdrawal's magnitude, or null when nothing matched. */
  matchedCents: number | null;
  /** matched − expected (signed), or null when nothing matched. */
  differenceCents: number | null;
  /** The bank withdrawal we tied to, if any. */
  matchedTransactionId: string | null;
  matchedDate: string | null;
  matchedDescription: string | null;
  /** Inclusive business-day window this debit was expected to post in. */
  windowEarliest: string;
  windowLatest: string;
};

/** A payment paid by a NON-bank-clearing method (cash/check/other) — shown
 *  separately so it never hangs as "unmatched" against the bank feed. */
export type OtherMethodPayment = {
  paymentId: string;
  vendorName: string;
  manifestNumber: string;
  paidDate: string;
  method: VendorPaymentMethod;
  amountCents: number;
  reference: string | null;
};

export type VendorReconcileSummary = {
  /** Count of BANK-CLEARING payments reconciled (ach/wire). */
  paymentCount: number;
  matched: number;
  mismatch: number;
  awaiting: number;
  unmatched: number;
  totalExpectedCents: number;
  totalMatchedCents: number;
  /** totalMatched − totalExpected (signed). */
  netDifferenceCents: number;
  /** True when nothing needs attention (no mismatch, no unmatched). */
  allClear: boolean;
  unexplainedDebitCount: number;
  unexplainedDebitCents: number;
  /** Count/total of payments paid another way (not expected in the bank feed). */
  otherMethodCount: number;
  otherMethodCents: number;
};

export type VendorReconcileResult = {
  payments: PaymentMatch[];
  summary: VendorReconcileSummary;
  /** Bank debits from the Main account that no payment claimed (informational). */
  unexplainedDebits: BankWithdrawal[];
  /** Cash/check/other payments — recorded, but not expected in the bank feed. */
  otherMethodPayments: OtherMethodPayment[];
};

export type VendorReconcileOptions = {
  /** Today's ISO date (yyyy-mm-dd) — used to decide awaiting vs unmatched. */
  todayIso: string;
  /** Posting-window business days. ACH/wire debits post the same day or a couple
   *  business days after they were sent, so default T+0..T+3 (a touch wider than
   *  payroll, since vendor payment timing is more variable). */
  minBusinessDays?: number;
  maxBusinessDays?: number;
  /** Mismatch tolerance floor in cents (default $5). */
  toleranceFloorCents?: number;
  /** Mismatch tolerance percent of expected (default 2%). */
  tolerancePercent?: number;
};

// ---------------------------------------------------------------------------
// Method classification
// ---------------------------------------------------------------------------

/** Which payment methods actually pull money from the BANK account (and so
 *  should appear in the Plaid feed). 'cash' leaves the vault; 'check' clears on
 *  its own timing; 'other' is unknown — none are reconciled against the feed. */
export const BANK_CLEARING_METHODS: ReadonlySet<VendorPaymentMethod> = new Set<VendorPaymentMethod>([
  "ach",
  "wire",
]);

/** True when a payment method draws from the bank account (ach/wire). */
export function isBankClearingMethod(method: VendorPaymentMethod): boolean {
  return BANK_CLEARING_METHODS.has(method);
}

// ---------------------------------------------------------------------------
// Pure helpers (shared philosophy with the ATM + payroll engines)
// ---------------------------------------------------------------------------

/**
 * Convert Main-account Plaid transactions into bank withdrawals. Keeps ONLY
 * money-OUT rows (Plaid positive amount) — inflows (negative) are dropped. The
 * amount is already positive, so it becomes the debit magnitude directly.
 */
export function toBankWithdrawals(txns: WithdrawalSourceTxn[]): BankWithdrawal[] {
  const out: BankWithdrawal[] = [];
  for (const t of txns) {
    if (t.amountCents <= 0) continue; // not money leaving the account
    out.push({
      transactionId: t.transactionId,
      amountCents: t.amountCents,
      date: t.date,
      description: t.merchantName ?? t.name,
      pending: t.pending,
    });
  }
  return out;
}

/** ISO date compare: is `d` within [lo, hi] inclusive? Lexical works for yyyy-mm-dd. */
export function isoWithin(d: string, lo: string, hi: string): boolean {
  return d >= lo && d <= hi;
}

/** Format signed cents difference, e.g. +$0.50 / −$2.00 / $0.00. */
export function formatDiff(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${dollars}`;
}

/** Default mismatch tolerance: max($5 flat, 2% of expected). */
export const DEFAULT_TOLERANCE_FLOOR_CENTS = 500;
export const DEFAULT_TOLERANCE_PERCENT = 2;

/** The mismatch tolerance (in cents) for an expected amount, given the knobs. */
export function toleranceCentsFor(
  expectedCents: number,
  floorCents = DEFAULT_TOLERANCE_FLOOR_CENTS,
  percent = DEFAULT_TOLERANCE_PERCENT,
): number {
  const pctBand = Math.round((Math.abs(expectedCents) * percent) / 100);
  return Math.max(floorCents, pctBand);
}

type WorkingWithdrawal = BankWithdrawal & { consumed: boolean };

/**
 * Pick the best in-window debit for an expected amount from the not-yet-consumed
 * pool. Preference order:
 *   1) EXACT amount match (earliest date wins on ties),
 *   2) otherwise the closest amount WITHIN the tolerance band — becomes a
 *      mismatch. A candidate further off than the tolerance is ignored (it is
 *      not a plausible restatement of the same payment).
 */
function pickBestWithdrawal(
  pool: WorkingWithdrawal[],
  expectedCents: number,
  lo: string,
  hi: string,
  toleranceCents: number,
): { withdrawal: WorkingWithdrawal; exact: boolean } | null {
  let bestExact: WorkingWithdrawal | null = null;
  let bestApprox: WorkingWithdrawal | null = null;
  let bestApproxDelta = Number.POSITIVE_INFINITY;

  for (const w of pool) {
    if (w.consumed) continue;
    if (!isoWithin(w.date, lo, hi)) continue;
    if (w.amountCents === expectedCents) {
      if (bestExact === null || w.date < bestExact.date) bestExact = w;
      continue;
    }
    const delta = Math.abs(w.amountCents - expectedCents);
    if (delta > toleranceCents) continue; // too far off to be the same debit
    if (
      delta < bestApproxDelta ||
      (delta === bestApproxDelta && bestApprox !== null && w.date < bestApprox.date)
    ) {
      bestApprox = w;
      bestApproxDelta = delta;
    }
  }

  if (bestExact) return { withdrawal: bestExact, exact: true };
  if (bestApprox) return { withdrawal: bestApprox, exact: false };
  return null;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Reconcile every recorded BANK-CLEARING vendor payment against the Main
 * account's withdrawals. PURE and deterministic. Never throws on bad data —
 * payments with a null/zero amount are skipped (they can't be reconciled and
 * aren't counted). Bank-clearing payments are returned newest-first for the
 * view; cash/check/other payments are split off into otherMethodPayments.
 */
export function reconcileVendorPayments(
  records: VendorPaymentRecord[],
  withdrawals: BankWithdrawal[],
  opts: VendorReconcileOptions,
): VendorReconcileResult {
  const minD = opts.minBusinessDays ?? 0;
  const maxD = opts.maxBusinessDays ?? 3;

  // Split by method: only ach/wire reconcile against the bank feed.
  const bankClearing: VendorPaymentRecord[] = [];
  const otherMethodPayments: OtherMethodPayment[] = [];
  for (const p of records) {
    if (!Number.isFinite(p.amountCents) || p.amountCents <= 0) continue; // unreconcilable
    if (isBankClearingMethod(p.method)) {
      bankClearing.push(p);
    } else {
      otherMethodPayments.push({
        paymentId: p.paymentId,
        vendorName: p.vendorName,
        manifestNumber: p.manifestNumber,
        paidDate: p.paidDate,
        method: p.method,
        amountCents: p.amountCents,
        reference: p.reference,
      });
    }
  }
  // View order for the "paid another way" bucket: newest first.
  otherMethodPayments.sort((a, b) =>
    a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0,
  );

  // Work on a mutable copy so we can mark debits consumed as payments claim them.
  const pool: WorkingWithdrawal[] = withdrawals.map((w) => ({ ...w, consumed: false }));

  // Deterministic order: oldest paid date first (then paymentId) so greedy
  // consumption is stable + reproducible.
  const ordered = [...bankClearing].sort((a, b) => {
    if (a.paidDate !== b.paidDate) return a.paidDate < b.paidDate ? -1 : 1;
    return a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0;
  });

  const matches: PaymentMatch[] = [];

  for (const p of ordered) {
    const expected = p.amountCents;
    // bankPostingWindow returns null on an unparseable date; degrade to a
    // same-day window so a bad row can never crash the engine.
    const win = bankPostingWindow(p.paidDate, minD, maxD) ?? {
      earliest: p.paidDate,
      latest: p.paidDate,
    };
    const base: PaymentMatch = {
      paymentId: p.paymentId,
      vendorName: p.vendorName,
      manifestNumber: p.manifestNumber,
      paidDate: p.paidDate,
      method: p.method,
      reference: p.reference,
      status: "unmatched",
      expectedCents: expected,
      matchedCents: null,
      differenceCents: null,
      matchedTransactionId: null,
      matchedDate: null,
      matchedDescription: null,
      windowEarliest: win.earliest,
      windowLatest: win.latest,
    };

    const tol = toleranceCentsFor(expected, opts.toleranceFloorCents, opts.tolerancePercent);
    const pick = pickBestWithdrawal(pool, expected, win.earliest, win.latest, tol);

    if (pick) {
      pick.withdrawal.consumed = true;
      base.matchedCents = pick.withdrawal.amountCents;
      base.differenceCents = pick.withdrawal.amountCents - expected;
      base.matchedTransactionId = pick.withdrawal.transactionId;
      base.matchedDate = pick.withdrawal.date;
      base.matchedDescription = pick.withdrawal.description;
      base.status = pick.exact ? "matched" : "mismatch";
    } else {
      const stillOpen = opts.todayIso <= win.latest;
      base.status = stillOpen ? "awaiting" : "unmatched";
    }

    matches.push(base);
  }

  // View order: newest paid date first (most recent payment on top).
  matches.sort((a, b) => (a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0));

  // Summary.
  let matched = 0;
  let mismatch = 0;
  let awaiting = 0;
  let unmatched = 0;
  let totalExpectedCents = 0;
  let totalMatchedCents = 0;
  for (const m of matches) {
    totalExpectedCents += m.expectedCents;
    if (m.matchedCents !== null) totalMatchedCents += m.matchedCents;
    if (m.status === "matched") matched += 1;
    else if (m.status === "mismatch") mismatch += 1;
    else if (m.status === "awaiting") awaiting += 1;
    else unmatched += 1;
  }

  const unexplainedDebits: BankWithdrawal[] = pool
    .filter((w) => !w.consumed)
    .map((w) => ({
      transactionId: w.transactionId,
      amountCents: w.amountCents,
      date: w.date,
      description: w.description,
      pending: w.pending,
    }));
  const unexplainedDebitCents = unexplainedDebits.reduce((s, w) => s + w.amountCents, 0);
  const otherMethodCents = otherMethodPayments.reduce((s, p) => s + p.amountCents, 0);

  const summary: VendorReconcileSummary = {
    paymentCount: matches.length,
    matched,
    mismatch,
    awaiting,
    unmatched,
    totalExpectedCents,
    totalMatchedCents,
    netDifferenceCents: totalMatchedCents - totalExpectedCents,
    allClear: mismatch === 0 && unmatched === 0,
    unexplainedDebitCount: unexplainedDebits.length,
    unexplainedDebitCents,
    otherMethodCount: otherMethodPayments.length,
    otherMethodCents,
  };

  return { payments: matches, summary, unexplainedDebits, otherMethodPayments };
}

// ---------------------------------------------------------------------------
// Self-tests (pure, deterministic) — mirrored in the vitest suite.
// ---------------------------------------------------------------------------

export function __runVendorReconcileCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`vendor-reconcile-core self-test FAILED: ${msg}`);
  };

  // isBankClearingMethod / BANK_CLEARING_METHODS ---------------------------
  {
    ok(isBankClearingMethod("ach"), "method: ach is bank-clearing");
    ok(isBankClearingMethod("wire"), "method: wire is bank-clearing");
    ok(!isBankClearingMethod("cash"), "method: cash is NOT bank-clearing");
    ok(!isBankClearingMethod("check"), "method: check is NOT bank-clearing (own timing)");
    ok(!isBankClearingMethod("other"), "method: other is NOT bank-clearing");
  }

  // toBankWithdrawals: keep only outflows, prefer merchant name -------------
  {
    const ws = toBankWithdrawals([
      { transactionId: "out1", amountCents: 900000, date: "2026-07-06", name: "ACH DEBIT", merchantName: "GROW CO ACH", pending: false },
      { transactionId: "in1", amountCents: -50000, date: "2026-07-06", name: "DEPOSIT", merchantName: null, pending: false },
      { transactionId: "out2", amountCents: 4000, date: "2026-07-07", name: "MONTHLY FEE", merchantName: null, pending: true },
    ]);
    ok(ws.length === 2, "toBankWithdrawals: keeps only outflows (drops the deposit)");
    ok(ws[0].transactionId === "out1" && ws[0].amountCents === 900000, "toBankWithdrawals: positive magnitude preserved");
    ok(ws[0].description === "GROW CO ACH", "toBankWithdrawals: merchant name preferred for description");
    ok(ws[1].description === "MONTHLY FEE" && ws[1].pending === true, "toBankWithdrawals: name fallback + pending preserved");
  }

  // isoWithin / formatDiff --------------------------------------------------
  {
    ok(isoWithin("2026-07-07", "2026-07-06", "2026-07-08"), "isoWithin: inside");
    ok(!isoWithin("2026-07-09", "2026-07-06", "2026-07-08"), "isoWithin: outside");
    ok(formatDiff(0) === "$0.00", "formatDiff: zero");
    ok(formatDiff(50) === "+$0.50", "formatDiff: positive");
    ok(formatDiff(-200) === "−$2.00", "formatDiff: negative uses unicode minus");
    ok(formatDiff(123456) === "+$1,234.56", "formatDiff: thousands separator");
  }

  // toleranceCentsFor -------------------------------------------------------
  {
    ok(toleranceCentsFor(10000) === 500, "tolerance: floor $5 wins for small amounts");
    ok(toleranceCentsFor(900000) === 18000, "tolerance: 2% wins for large amounts ($180 on $9k)");
    ok(toleranceCentsFor(30000, 500, 2) === 600, "tolerance: 2% of $300 = $6 beats floor");
  }

  // Case 1: exact ACH match on the paid date -------------------------------
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: "BATCH-1" },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 900000, date: "2026-07-06", description: "GROW CO ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    ok(res.payments.length === 1, "case1: one bank-clearing payment");
    ok(res.payments[0].status === "matched", "case1: matched on paid date (T+0)");
    ok(res.payments[0].matchedCents === 900000 && res.payments[0].differenceCents === 0, "case1: amounts tie out");
    ok(res.summary.allClear === true, "case1: all clear");
    ok(res.unexplainedDebits.length === 0, "case1: no leftover debits");
    ok(res.otherMethodPayments.length === 0, "case1: no other-method payments");
  }

  // Case 2: mismatch (amount off, within tolerance) ------------------------
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "wire", reference: "WIRE-77" },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 900050, date: "2026-07-07", description: "WIRE OUT", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    ok(res.payments[0].status === "mismatch", "case2: mismatch when amount is off");
    ok(res.payments[0].differenceCents === 50, "case2: +$0.50 difference");
    ok(res.summary.allClear === false, "case2: not all clear");
  }

  // Case 3: awaiting (in window, nothing posted yet) -----------------------
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const res = reconcileVendorPayments(records, [], { todayIso: "2026-07-06" });
    ok(res.payments[0].status === "awaiting", "case3: awaiting while inside the window");
    ok(res.summary.allClear === true, "case3: awaiting does NOT block all-clear");
  }

  // Case 4: unmatched (window passed, no debit) ----------------------------
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const res = reconcileVendorPayments(records, [], { todayIso: "2026-07-20" });
    ok(res.payments[0].status === "unmatched", "case4: unmatched once the window has fully passed");
    ok(res.summary.allClear === false, "case4: unmatched blocks all-clear");
  }

  // Case 5: a far-off debit is NOT a mismatch; payment stays unmatched, debit unexplained
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 900000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "fee", amountCents: 4000, date: "2026-07-07", description: "MONTHLY FEE", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    ok(res.payments[0].status === "unmatched", "case5: $9k payment never 'matches' a $40 fee");
    ok(res.unexplainedDebits.length === 1 && res.unexplainedDebits[0].transactionId === "fee", "case5: the fee surfaces as unexplained");
  }

  // Case 6: two ACH payments, each consumes its own debit (no double-claim) -
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p1", vendorName: "Grow Co", manifestNumber: "M-100", amountCents: 500000, paidDate: "2026-07-06", method: "ach", reference: null },
      { paymentId: "p2", vendorName: "Grow Co", manifestNumber: "M-101", amountCents: 500000, paidDate: "2026-07-20", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
      { transactionId: "wB", amountCents: 500000, date: "2026-07-20", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-31" });
    ok(res.summary.matched === 2, "case6: both payments matched");
    ok(res.payments[0].paymentId === "p2" && res.payments[1].paymentId === "p1", "case6: view is newest paid date first");
    ok(res.payments[0].matchedTransactionId === "wB" && res.payments[1].matchedTransactionId === "wA", "case6: each payment tied to its own debit");
    ok(res.unexplainedDebits.length === 0, "case6: no leftover debits");
  }

  // Case 7: zero/invalid amount is skipped entirely ------------------------
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "p0", vendorName: "Empty", manifestNumber: "M-000", amountCents: 0, paidDate: "2026-07-06", method: "ach", reference: null },
      { paymentId: "p1", vendorName: "Real", manifestNumber: "M-100", amountCents: 500000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "w1", amountCents: 500000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    ok(res.summary.paymentCount === 1, "case7: zero-amount payment is not counted");
    ok(res.payments[0].paymentId === "p1" && res.payments[0].status === "matched", "case7: only the real payment reconciles");
    ok(res.summary.otherMethodCount === 0, "case7: zero-amount is dropped, not shown as other-method");
  }

  // Case 8: cash/check/other are split into otherMethodPayments, not reconciled
  {
    const records: VendorPaymentRecord[] = [
      { paymentId: "pc", vendorName: "Cash Vendor", manifestNumber: "M-CASH", amountCents: 120000, paidDate: "2026-07-06", method: "cash", reference: "vault" },
      { paymentId: "pk", vendorName: "Check Vendor", manifestNumber: "M-CHK", amountCents: 250000, paidDate: "2026-07-04", method: "check", reference: "#1042" },
      { paymentId: "po", vendorName: "Other Vendor", manifestNumber: "M-OTH", amountCents: 33000, paidDate: "2026-07-05", method: "other", reference: null },
      { paymentId: "pa", vendorName: "ACH Vendor", manifestNumber: "M-ACH", amountCents: 700000, paidDate: "2026-07-06", method: "ach", reference: null },
    ];
    const withdrawals: BankWithdrawal[] = [
      { transactionId: "wA", amountCents: 700000, date: "2026-07-06", description: "ACH", pending: false },
    ];
    const res = reconcileVendorPayments(records, withdrawals, { todayIso: "2026-07-20" });
    ok(res.summary.paymentCount === 1, "case8: only the ACH payment is reconciled against the bank");
    ok(res.payments[0].paymentId === "pa" && res.payments[0].status === "matched", "case8: ACH payment matched");
    ok(res.summary.otherMethodCount === 3, "case8: cash+check+other counted separately");
    ok(res.summary.otherMethodCents === 403000, "case8: other-method total = 120000+250000+33000");
    ok(res.otherMethodPayments[0].paidDate === "2026-07-06" && res.otherMethodPayments[0].method === "cash", "case8: other-method sorted newest first (cash 7/6 on top)");
    ok(res.summary.allClear === true, "case8: cash/check/other do NOT block all-clear");
    ok(res.unexplainedDebits.length === 0, "case8: no leftover debits");
  }
}

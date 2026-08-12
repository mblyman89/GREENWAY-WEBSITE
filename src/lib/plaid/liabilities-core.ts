/**
 * src/lib/plaid/liabilities-core.ts — Plaid Liabilities pure core (mortgage).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx and
 * mirrored in vitest. This is the "mortgage brain": it turns a Plaid
 * `/liabilities/get` mortgage object (dollars as floats, rates as percentages)
 * into an integer-safe record we can store, plus a plain-English view for the
 * Plaid page.
 *
 * MONEY RULE (standing): every dollar amount is stored as INTEGER CENTS. We
 * reuse the exact same dollars→cents rounding as plaid-core so a mortgage
 * balance and a transaction round identically.
 *
 * RATE RULE: interest rates arrive as a percentage (e.g. 3.99 = 3.99%). We
 * store them as INTEGER BASIS POINTS (399 = 3.99%) to stay off floats, and the
 * view renders them back to "3.99%".
 *
 * Sound Credit Union's mortgage is a SEPARATE login from Michael's checking /
 * savings, so it comes in as its own Plaid Item once he links it with the
 * Liabilities product enabled. Liabilities data refreshes ~once/day, which
 * matches Michael's "monthly / manual refresh is fine".
 */

import { plaidDollarsToCents } from "./plaid-core";
import { formatCentsUsd } from "./plaid-ui-core";

// ---------------------------------------------------------------------------
// 1) Input shape — the subset of Plaid's mortgage object we consume.
//    Everything is optional/nullable because Plaid marks nearly every mortgage
//    field nullable and coverage varies by servicer.
// ---------------------------------------------------------------------------

export type PlaidMortgageInput = {
  account_id?: string | null;
  account_number?: string | null;
  current_late_fee?: number | null;
  escrow_balance?: number | null;
  has_pmi?: boolean | null;
  has_prepayment_penalty?: boolean | null;
  interest_rate?: { percentage?: number | null; type?: string | null } | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
  loan_term?: string | null;
  loan_type_description?: string | null;
  maturity_date?: string | null;
  next_monthly_payment?: number | null;
  next_payment_due_date?: string | null;
  origination_date?: string | null;
  origination_principal_amount?: number | null;
  past_due_amount?: number | null;
  ytd_interest_paid?: number | null;
  ytd_principal_paid?: number | null;
  property_address?: {
    city?: string | null;
    region?: string | null;
    street?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
};

// ---------------------------------------------------------------------------
// 2) Normalized record — integer cents / basis points, ready for the DB.
//    principalCents (remaining balance) is NOT here: it lives on the account's
//    current_balance_cents (Plaid returns the mortgage principal as the account
//    balance). This record holds only the extra liabilities detail.
// ---------------------------------------------------------------------------

export type MortgageRecord = {
  accountId: string;
  /** Last-4 (or masked) loan number from the servicer; may be null. */
  accountNumberMask: string | null;
  interestRateBps: number | null; // 399 = 3.99%
  interestRateType: string | null; // "fixed" | "variable" | servicer text
  nextMonthlyPaymentCents: number | null;
  nextPaymentDueDate: string | null; // ISO YYYY-MM-DD
  lastPaymentAmountCents: number | null;
  lastPaymentDate: string | null;
  escrowBalanceCents: number | null;
  currentLateFeeCents: number | null;
  pastDueAmountCents: number | null;
  originationPrincipalCents: number | null;
  originationDate: string | null;
  maturityDate: string | null;
  loanTerm: string | null; // e.g. "30 year"
  loanTypeDescription: string | null; // e.g. "conventional"
  hasPmi: boolean | null;
  hasPrepaymentPenalty: boolean | null;
  ytdInterestPaidCents: number | null;
  ytdPrincipalPaidCents: number | null;
  propertyAddress: string | null; // one-line, human-readable
};

/**
 * Convert an interest-rate percentage to integer basis points, sign preserved,
 * float-artifact-safe. 3.99 → 399, 0 → 0, null/garbage → null.
 */
export function ratePercentToBps(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const n = typeof input === "number" ? input : Number(String(input).trim());
  if (!Number.isFinite(n)) return null;
  const scaled = n * 100;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + 1e-9);
}

/** Trim to a non-empty string or null (so blank servicer fields store as null). */
function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Build a one-line property address from Plaid's address object, skipping blank
 * parts. Returns null when there's nothing usable.
 *   { street:"2992 Cameron Road", city:"Malakoff", region:"NY", postal_code:"14236" }
 *     → "2992 Cameron Road, Malakoff, NY 14236"
 */
export function formatPropertyAddress(
  addr: PlaidMortgageInput["property_address"],
): string | null {
  if (!addr) return null;
  const street = cleanStr(addr.street);
  const city = cleanStr(addr.city);
  const region = cleanStr(addr.region);
  const postal = cleanStr(addr.postal_code);
  const cityRegion = [city, region].filter(Boolean).join(", ");
  const cityRegionPostal = [cityRegion, postal].filter(Boolean).join(" ").trim();
  const parts = [street, cityRegionPostal].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Map a Plaid mortgage object into our normalized record. Returns null when
 * there's no account_id (nothing to key on). Every money field goes through the
 * shared dollars→cents converter; the rate goes through ratePercentToBps.
 */
export function mapMortgage(m: PlaidMortgageInput): MortgageRecord | null {
  const accountId = cleanStr(m.account_id);
  if (!accountId) return null;
  return {
    accountId,
    accountNumberMask: cleanStr(m.account_number),
    interestRateBps: ratePercentToBps(m.interest_rate?.percentage ?? null),
    interestRateType: cleanStr(m.interest_rate?.type),
    nextMonthlyPaymentCents: plaidDollarsToCents(m.next_monthly_payment ?? null),
    nextPaymentDueDate: cleanStr(m.next_payment_due_date),
    lastPaymentAmountCents: plaidDollarsToCents(m.last_payment_amount ?? null),
    lastPaymentDate: cleanStr(m.last_payment_date),
    escrowBalanceCents: plaidDollarsToCents(m.escrow_balance ?? null),
    currentLateFeeCents: plaidDollarsToCents(m.current_late_fee ?? null),
    pastDueAmountCents: plaidDollarsToCents(m.past_due_amount ?? null),
    originationPrincipalCents: plaidDollarsToCents(m.origination_principal_amount ?? null),
    originationDate: cleanStr(m.origination_date),
    maturityDate: cleanStr(m.maturity_date),
    loanTerm: cleanStr(m.loan_term),
    loanTypeDescription: cleanStr(m.loan_type_description),
    hasPmi: typeof m.has_pmi === "boolean" ? m.has_pmi : null,
    hasPrepaymentPenalty: typeof m.has_prepayment_penalty === "boolean" ? m.has_prepayment_penalty : null,
    ytdInterestPaidCents: plaidDollarsToCents(m.ytd_interest_paid ?? null),
    ytdPrincipalPaidCents: plaidDollarsToCents(m.ytd_principal_paid ?? null),
    propertyAddress: formatPropertyAddress(m.property_address ?? null),
  };
}

/** Map the `liabilities.mortgage[]` array; drops entries with no account_id. */
export function mapMortgages(list: PlaidMortgageInput[] | null | undefined): MortgageRecord[] {
  if (!Array.isArray(list)) return [];
  const out: MortgageRecord[] = [];
  for (const m of list) {
    const rec = mapMortgage(m);
    if (rec) out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3) Plain-English view — what the Plaid page renders. Every money value is
//    formatted from integer cents; the rate from basis points.
// ---------------------------------------------------------------------------

export type MortgageViewInput = MortgageRecord & {
  /** Remaining principal — comes from the account balance, not the record. */
  principalCents: number | null;
};

export type MortgageView = {
  accountId: string;
  balanceText: string; // remaining principal
  rateText: string; // "3.99% fixed" / "3.99%" / "—"
  nextPaymentText: string; // "$3,141.54 due 2019-11-15" / "—"
  escrowText: string;
  originationText: string; // "$425,000.00 on 2015-08-01" / "—"
  termText: string; // "30 year · conventional" / "—"
  maturityText: string;
  ytdText: string; // "Interest $12,300.40 · Principal $12,340.50" / "—"
  pmiText: string; // "Yes" / "No" / "—"
  addressText: string;
};

/** Format basis points back to a percent string: 399 → "3.99%". */
export function formatRateBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  const neg = bps < 0;
  const abs = Math.abs(bps);
  const whole = Math.trunc(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}%`;
}

function yesNo(v: boolean | null | undefined): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return "—";
}

/** "$3,141.54 due 2019-11-15", or just the amount, or just the date, or "—". */
function amountDue(amountCents: number | null, date: string | null): string {
  const amt = amountCents === null ? null : formatCentsUsd(amountCents);
  if (amt && date) return `${amt} due ${date}`;
  if (amt) return amt;
  if (date) return `Due ${date}`;
  return "—";
}

export function buildMortgageView(m: MortgageViewInput): MortgageView {
  const rate = formatRateBps(m.interestRateBps);
  const rateText = rate === "—" ? "—" : m.interestRateType ? `${rate} ${m.interestRateType}` : rate;

  const originationText =
    m.originationPrincipalCents !== null || m.originationDate
      ? amountDue(m.originationPrincipalCents, m.originationDate).replace(/^Due /, "on ").replace(" due ", " on ")
      : "—";

  const termParts = [m.loanTerm, m.loanTypeDescription].map((s) => (s ?? "").trim()).filter(Boolean);
  const termText = termParts.length ? termParts.join(" · ") : "—";

  const ytdParts: string[] = [];
  if (m.ytdInterestPaidCents !== null) ytdParts.push(`Interest ${formatCentsUsd(m.ytdInterestPaidCents)}`);
  if (m.ytdPrincipalPaidCents !== null) ytdParts.push(`Principal ${formatCentsUsd(m.ytdPrincipalPaidCents)}`);
  const ytdText = ytdParts.length ? ytdParts.join(" · ") : "—";

  return {
    accountId: m.accountId,
    balanceText: m.principalCents === null ? "—" : formatCentsUsd(m.principalCents),
    rateText,
    nextPaymentText: amountDue(m.nextMonthlyPaymentCents, m.nextPaymentDueDate),
    escrowText: m.escrowBalanceCents === null ? "—" : formatCentsUsd(m.escrowBalanceCents),
    originationText,
    termText,
    maturityText: m.maturityDate ?? "—",
    ytdText,
    pmiText: yesNo(m.hasPmi),
    addressText: m.propertyAddress ?? "—",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlaidLiabilitiesCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (!cond) failures.push(label);
  };

  // ratePercentToBps ---------------------------------------------------------
  ok(ratePercentToBps(3.99) === 399, "3.99% → 399 bps");
  ok(ratePercentToBps(0) === 0, "0% → 0 bps");
  ok(ratePercentToBps(6) === 600, "6% → 600 bps");
  ok(ratePercentToBps(2.875) === 288, "2.875% → 288 bps (rounds)");
  ok(ratePercentToBps("4.25") === 425, "string '4.25' → 425 bps");
  ok(ratePercentToBps(null) === null, "null rate → null");
  ok(ratePercentToBps("abc") === null, "garbage rate → null");

  // formatRateBps ------------------------------------------------------------
  ok(formatRateBps(399) === "3.99%", "399 → 3.99%");
  ok(formatRateBps(600) === "6.00%", "600 → 6.00%");
  ok(formatRateBps(425) === "4.25%", "425 → 4.25%");
  ok(formatRateBps(null) === "—", "null bps → em dash");

  // formatPropertyAddress ----------------------------------------------------
  ok(
    formatPropertyAddress({ street: "2992 Cameron Road", city: "Malakoff", region: "NY", postal_code: "14236" }) ===
      "2992 Cameron Road, Malakoff, NY 14236",
    "full address one-line",
  );
  ok(formatPropertyAddress({ city: "Port Orchard", region: "WA" }) === "Port Orchard, WA", "partial address");
  ok(formatPropertyAddress(null) === null, "null address → null");
  ok(formatPropertyAddress({}) === null, "empty address → null");

  // mapMortgage --------------------------------------------------------------
  const rec = mapMortgage({
    account_id: "acc_m1",
    account_number: "3120194154",
    current_late_fee: 25,
    escrow_balance: 3141.54,
    has_pmi: true,
    has_prepayment_penalty: false,
    interest_rate: { percentage: 3.99, type: "fixed" },
    last_payment_amount: 3141.54,
    last_payment_date: "2019-08-01",
    loan_term: "30 year",
    loan_type_description: "conventional",
    maturity_date: "2045-07-31",
    next_monthly_payment: 3141.54,
    next_payment_due_date: "2019-11-15",
    origination_date: "2015-08-01",
    origination_principal_amount: 425000,
    past_due_amount: 2304,
    ytd_interest_paid: 12300.4,
    ytd_principal_paid: 12340.5,
    property_address: { street: "2992 Cameron Road", city: "Malakoff", region: "NY", postal_code: "14236" },
  });
  ok(rec !== null, "mapMortgage returns a record");
  if (rec) {
    ok(rec.interestRateBps === 399, "map: rate → 399 bps");
    ok(rec.interestRateType === "fixed", "map: rate type fixed");
    ok(rec.escrowBalanceCents === 314154, "map: escrow → 314154 cents");
    ok(rec.nextMonthlyPaymentCents === 314154, "map: next payment → 314154 cents");
    ok(rec.currentLateFeeCents === 2500, "map: late fee → 2500 cents");
    ok(rec.pastDueAmountCents === 230400, "map: past due → 230400 cents");
    ok(rec.originationPrincipalCents === 42500000, "map: origination → 42,500,000 cents");
    ok(rec.ytdInterestPaidCents === 1230040, "map: ytd interest → 1230040 cents");
    ok(rec.ytdPrincipalPaidCents === 1234050, "map: ytd principal → 1234050 cents");
    ok(rec.hasPmi === true, "map: has_pmi true");
    ok(rec.hasPrepaymentPenalty === false, "map: prepayment penalty false");
    ok(rec.loanTerm === "30 year", "map: loan term");
    ok(rec.propertyAddress === "2992 Cameron Road, Malakoff, NY 14236", "map: address");
  }

  ok(mapMortgage({ account_id: null }) === null, "no account_id → null");
  ok(mapMortgage({ account_id: "  " }) === null, "blank account_id → null");

  // mapMortgages -------------------------------------------------------------
  ok(mapMortgages(null).length === 0, "null list → empty");
  ok(mapMortgages([{ account_id: "a" }, { account_id: null }]).length === 1, "drops entries with no id");

  // buildMortgageView --------------------------------------------------------
  if (rec) {
    const view = buildMortgageView({ ...rec, principalCents: 5630206 });
    ok(view.balanceText === "$56,302.06", "view: balance");
    ok(view.rateText === "3.99% fixed", "view: rate + type");
    ok(view.nextPaymentText === "$3,141.54 due 2019-11-15", "view: next payment");
    ok(view.escrowText === "$3,141.54", "view: escrow");
    ok(view.termText === "30 year · conventional", "view: term");
    ok(view.maturityText === "2045-07-31", "view: maturity");
    ok(view.pmiText === "Yes", "view: pmi");
    ok(view.ytdText === "Interest $12,300.40 · Principal $12,340.50", "view: ytd");
    ok(view.addressText === "2992 Cameron Road, Malakoff, NY 14236", "view: address");
    ok(view.originationText.includes("$425,000.00") && view.originationText.includes("2015-08-01"), "view: origination");
  }

  // Missing-data view (everything null) → all em dashes -----------------------
  const empty = buildMortgageView({
    accountId: "acc_x",
    accountNumberMask: null,
    interestRateBps: null,
    interestRateType: null,
    nextMonthlyPaymentCents: null,
    nextPaymentDueDate: null,
    lastPaymentAmountCents: null,
    lastPaymentDate: null,
    escrowBalanceCents: null,
    currentLateFeeCents: null,
    pastDueAmountCents: null,
    originationPrincipalCents: null,
    originationDate: null,
    maturityDate: null,
    loanTerm: null,
    loanTypeDescription: null,
    hasPmi: null,
    hasPrepaymentPenalty: null,
    ytdInterestPaidCents: null,
    ytdPrincipalPaidCents: null,
    propertyAddress: null,
    principalCents: null,
  });
  ok(empty.rateText === "—" && empty.nextPaymentText === "—" && empty.pmiText === "—", "empty view → em dashes");

  if (failures.length) {
    throw new Error(`plaid-liabilities-core self-tests FAILED:\n  - ${failures.join("\n  - ")}`);
  }
  console.log("plaid-liabilities-core self-tests: all passed");
}

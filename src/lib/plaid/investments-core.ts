/**
 * src/lib/plaid/investments-core.ts — Plaid Investments pure core (holdings).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx and
 * mirrored in vitest. This is the "holdings brain": it turns Plaid
 * `/investments/holdings/get` holdings (+ their securities) into integer-safe
 * per-position records we can store, plus a plain-English view for the Plaid
 * page (Fidelity is Michael's first investment account).
 *
 * MONEY RULE (standing): every dollar amount is stored as INTEGER CENTS. We
 * reuse the exact same dollars→cents rounding as plaid-core so a holding value
 * and a transaction round identically.
 *
 * QUANTITY RULE: share quantities arrive as decimals (e.g. 12.5 shares, or
 * fractional shares like 0.317). To stay OFF floats in storage we scale the
 * quantity to INTEGER MICRO-UNITS (quantity × 1,000,000 = "micros"), and the
 * view renders it back to a trimmed decimal string ("12.5", "0.317").
 *
 * Fidelity is a SEPARATE login/Item; holdings come in once Michael links it
 * with the Investments product consented (already in the link token). Holdings
 * refresh ~once/day, which matches his "monthly / manual refresh is fine".
 */

import { plaidDollarsToCents } from "./plaid-core";
import { formatCentsUsd } from "./plaid-ui-core";

// ---------------------------------------------------------------------------
// 0) Quantity scaling — decimal shares → integer micro-units and back.
// ---------------------------------------------------------------------------

/** Scale factor for share quantities stored as integers (6 decimal places). */
export const QUANTITY_SCALE = 1000000;

/**
 * Convert a decimal share quantity into integer micro-units (× 1,000,000),
 * float-error-safe. Returns null for non-finite / missing input.
 */
export function quantityToMicros(input: number | string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else {
    const s = input.trim();
    if (s === "") return null;
    n = Number(s);
  }
  if (!Number.isFinite(n)) return null;
  const scaled = n * QUANTITY_SCALE;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + 1e-6);
}

/**
 * Render integer micro-units back to a trimmed decimal string ("12.5", "3",
 * "0.317"). Returns "—" for null. Never uses floats in the trailing math —
 * we split into whole + fractional integer parts and drop trailing zeros.
 */
export function formatQuantityMicros(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return "—";
  const neg = micros < 0;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / QUANTITY_SCALE);
  const frac = abs - whole * QUANTITY_SCALE;
  let out: string;
  if (frac === 0) {
    out = String(whole);
  } else {
    // zero-pad the fractional micros to 6 digits, then strip trailing zeros
    const fracStr = String(frac).padStart(6, "0").replace(/0+$/, "");
    out = `${whole}.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

// ---------------------------------------------------------------------------
// 1) Input shapes — the subset of Plaid's holding + security we consume.
//    Everything nullable/optional because Plaid marks most fields nullable and
//    coverage varies by institution.
// ---------------------------------------------------------------------------

export type PlaidHoldingInput = {
  account_id?: string | null;
  security_id?: string | null;
  institution_price?: number | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  quantity?: number | null;
  iso_currency_code?: string | null;
};

export type PlaidSecurityInput = {
  security_id?: string | null;
  name?: string | null;
  ticker_symbol?: string | null;
  type?: string | null;
  close_price?: number | null;
};

// ---------------------------------------------------------------------------
// 2) Stored record — integer-safe per-position holding, joined to its security.
// ---------------------------------------------------------------------------

export type HoldingRecord = {
  accountId: string;
  securityId: string;
  securityName: string | null;
  tickerSymbol: string | null;
  securityType: string | null;
  /** Share quantity in integer micro-units (× 1,000,000). */
  quantityMicros: number | null;
  /** Per-share price reported by the institution, in cents. */
  institutionPriceCents: number | null;
  /** Total market value of the position, in cents. */
  institutionValueCents: number | null;
  /** Total cost basis of the position, in cents. */
  costBasisCents: number | null;
  isoCurrencyCode: string | null;
};

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Map one Plaid holding (+ a lookup of securities by id) into a HoldingRecord,
 * or null if it has no account_id / security_id (can't key the row).
 */
export function mapHolding(
  h: PlaidHoldingInput,
  securitiesById: Map<string, PlaidSecurityInput>,
): HoldingRecord | null {
  const accountId = cleanStr(h.account_id);
  const securityId = cleanStr(h.security_id);
  if (accountId === null || securityId === null) return null;

  const sec = securitiesById.get(securityId);
  return {
    accountId,
    securityId,
    securityName: cleanStr(sec?.name),
    tickerSymbol: cleanStr(sec?.ticker_symbol),
    securityType: cleanStr(sec?.type),
    quantityMicros: quantityToMicros(h.quantity ?? null),
    institutionPriceCents: plaidDollarsToCents(h.institution_price ?? null),
    institutionValueCents: plaidDollarsToCents(h.institution_value ?? null),
    costBasisCents: plaidDollarsToCents(h.cost_basis ?? null),
    isoCurrencyCode: cleanStr(h.iso_currency_code) ?? "USD",
  };
}

/**
 * Map a full holdings response (holdings[] + securities[]) into records. Builds
 * the security lookup once, drops holdings that can't be keyed.
 */
export function mapHoldings(
  holdings: readonly PlaidHoldingInput[] | null | undefined,
  securities: readonly PlaidSecurityInput[] | null | undefined,
): HoldingRecord[] {
  const byId = new Map<string, PlaidSecurityInput>();
  for (const s of securities ?? []) {
    const id = cleanStr(s.security_id);
    if (id !== null) byId.set(id, s);
  }
  const out: HoldingRecord[] = [];
  for (const h of holdings ?? []) {
    const rec = mapHolding(h, byId);
    if (rec !== null) out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3) View — one holding row for the Plaid page, plus an account roll-up.
// ---------------------------------------------------------------------------

export type HoldingRowView = {
  securityId: string;
  /** Best display label: name → ticker → security_id. */
  displayName: string;
  tickerText: string;
  typeText: string;
  quantityText: string;
  priceText: string;
  valueText: string;
  costBasisText: string;
  /** Gain/loss = value − cost basis, in cents (null if either is missing). */
  gainLossCents: number | null;
  gainLossText: string;
};

export function buildHoldingRow(rec: HoldingRecord): HoldingRowView {
  const displayName =
    cleanStr(rec.securityName) ?? cleanStr(rec.tickerSymbol) ?? rec.securityId;
  const gainLossCents =
    rec.institutionValueCents !== null && rec.costBasisCents !== null
      ? rec.institutionValueCents - rec.costBasisCents
      : null;
  const gainLossText =
    gainLossCents === null
      ? "—"
      : `${gainLossCents >= 0 ? "+" : "-"}${formatCentsUsd(Math.abs(gainLossCents))}`;
  return {
    securityId: rec.securityId,
    displayName,
    tickerText: cleanStr(rec.tickerSymbol) ?? "—",
    typeText: cleanStr(rec.securityType) ?? "—",
    quantityText: formatQuantityMicros(rec.quantityMicros),
    priceText: rec.institutionPriceCents === null ? "—" : formatCentsUsd(rec.institutionPriceCents),
    valueText: rec.institutionValueCents === null ? "—" : formatCentsUsd(rec.institutionValueCents),
    costBasisText: rec.costBasisCents === null ? "—" : formatCentsUsd(rec.costBasisCents),
    gainLossCents,
    gainLossText,
  };
}

export type HoldingsAccountView = {
  rows: HoldingRowView[];
  /** Sum of position values (cents) across rows that have a value. */
  totalValueCents: number;
  totalValueText: string;
  positionCount: number;
};

/**
 * Build the per-account holdings view: sort positions by value (largest first),
 * total the market value. Records are assumed already filtered to one account.
 */
export function buildHoldingsAccountView(records: readonly HoldingRecord[]): HoldingsAccountView {
  const rows = records.map(buildHoldingRow);
  // Sort by value desc (nulls last), stable on displayName for ties.
  rows.sort((a, b) => {
    const av = a.valueText === "—" ? -1 : 0;
    const bv = b.valueText === "—" ? -1 : 0;
    if (av !== bv) return bv - av;
    return a.displayName.localeCompare(b.displayName);
  });
  let totalValueCents = 0;
  for (const r of records) {
    if (r.institutionValueCents !== null) totalValueCents += r.institutionValueCents;
  }
  // Re-sort by actual value using the records (rows text can't be compared).
  const withVal = records
    .map((r) => ({ id: r.securityId, val: r.institutionValueCents ?? -1 }))
    .sort((a, b) => b.val - a.val);
  const order = new Map(withVal.map((x, i) => [x.id, i]));
  rows.sort((a, b) => (order.get(a.securityId) ?? 0) - (order.get(b.securityId) ?? 0));
  return {
    rows,
    totalValueCents,
    totalValueText: formatCentsUsd(totalValueCents),
    positionCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlaidInvestmentsCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // quantityToMicros ---------------------------------------------------------
  ok(quantityToMicros(12.5) === 12500000, "12.5 shares → 12,500,000 micros");
  ok(quantityToMicros(0.317) === 317000, "0.317 shares → 317,000 micros");
  ok(quantityToMicros(3) === 3000000, "3 shares → 3,000,000 micros");
  ok(quantityToMicros("10") === 10000000, "string quantity parses");
  ok(quantityToMicros(null) === null, "null quantity → null");
  ok(quantityToMicros("") === null, "empty string → null");
  ok(quantityToMicros(Number.NaN) === null, "NaN → null");
  ok(quantityToMicros(-2.25) === -2250000, "negative quantity scales with sign");

  // formatQuantityMicros -----------------------------------------------------
  ok(formatQuantityMicros(12500000) === "12.5", "12,500,000 → 12.5");
  ok(formatQuantityMicros(3000000) === "3", "whole share drops decimals");
  ok(formatQuantityMicros(317000) === "0.317", "fractional share renders");
  ok(formatQuantityMicros(-2250000) === "-2.25", "negative renders with sign");
  ok(formatQuantityMicros(null) === "—", "null quantity → em dash");
  ok(formatQuantityMicros(1000001) === "1.000001", "6-dp precision preserved");

  // mapHoldings + security join ---------------------------------------------
  const secs: PlaidSecurityInput[] = [
    { security_id: "sec_aapl", name: "Apple Inc.", ticker_symbol: "AAPL", type: "equity", close_price: 190.12 },
    { security_id: "sec_vti", name: "Vanguard Total Stock Market ETF", ticker_symbol: "VTI", type: "etf", close_price: 245.5 },
  ];
  const holds: PlaidHoldingInput[] = [
    { account_id: "acc_fid", security_id: "sec_aapl", institution_price: 190.12, institution_value: 1901.2, cost_basis: 1500, quantity: 10, iso_currency_code: "USD" },
    { account_id: "acc_fid", security_id: "sec_vti", institution_price: 245.5, institution_value: 2455, cost_basis: 2600, quantity: 10, iso_currency_code: "USD" },
    { account_id: null, security_id: "sec_x", quantity: 1 }, // dropped: no account
    { account_id: "acc_fid", security_id: null, quantity: 1 }, // dropped: no security
  ];
  const recs = mapHoldings(holds, secs);
  ok(recs.length === 2, "two keyable holdings mapped (bad ones dropped)");
  const aapl = recs.find((r) => r.securityId === "sec_aapl");
  ok(!!aapl && aapl.securityName === "Apple Inc." && aapl.tickerSymbol === "AAPL", "security join fills name/ticker");
  ok(!!aapl && aapl.institutionValueCents === 190120, "value in cents");
  ok(!!aapl && aapl.costBasisCents === 150000, "cost basis in cents");
  ok(!!aapl && aapl.quantityMicros === 10000000, "quantity in micros");

  // missing security → record still present with null name
  const orphan = mapHoldings([{ account_id: "a", security_id: "unknown", quantity: 1 }], secs);
  ok(orphan.length === 1 && orphan[0].securityName === null && orphan[0].tickerSymbol === null, "orphan holding keeps null security fields");

  // buildHoldingRow gain/loss -----------------------------------------------
  const rowAapl = buildHoldingRow(aapl!);
  ok(rowAapl.displayName === "Apple Inc.", "row uses name as display");
  ok(rowAapl.gainLossCents === 40120, "gain = value − cost (190120 − 150000)");
  ok(rowAapl.gainLossText === "+$401.20", "positive gain formatted");
  ok(rowAapl.quantityText === "10", "row quantity trimmed");
  const vti = recs.find((r) => r.securityId === "sec_vti")!;
  const rowVti = buildHoldingRow(vti);
  ok(rowVti.gainLossCents === -14500, "loss = 245500 − 260000");
  ok(rowVti.gainLossText === "-$145.00", "negative loss formatted");

  // display fallback: no name → ticker → id
  const noName = buildHoldingRow({
    accountId: "a", securityId: "sec_z", securityName: null, tickerSymbol: "ZZZ",
    securityType: null, quantityMicros: null, institutionPriceCents: null,
    institutionValueCents: null, costBasisCents: null, isoCurrencyCode: "USD",
  });
  ok(noName.displayName === "ZZZ", "falls back to ticker when no name");
  ok(noName.gainLossCents === null && noName.gainLossText === "—", "no value/cost → no gain/loss");

  // buildHoldingsAccountView roll-up + sort ----------------------------------
  const view = buildHoldingsAccountView(recs);
  ok(view.positionCount === 2, "two positions");
  ok(view.totalValueCents === 190120 + 245500, "total value summed in cents");
  ok(view.totalValueText === "$4,356.20", "total value formatted");
  ok(view.rows[0].securityId === "sec_vti", "sorted by value desc (VTI $2,455 first)");

  const emptyView = buildHoldingsAccountView([]);
  ok(emptyView.positionCount === 0 && emptyView.totalValueCents === 0, "empty account view → zeros");
  ok(emptyView.totalValueText === "$0.00", "empty total formatted");

  if (failures.length) {
    throw new Error(`plaid-investments-core self-tests FAILED:\n  - ${failures.join("\n  - ")}`);
  }
  console.log("plaid-investments-core self-tests: all passed");
}

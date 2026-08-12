/**
 * src/lib/plaid/plaid-money-core.ts — Plaid Slice P5: the money-view brain.
 *
 * PURE (no I/O, no imports of server modules). This is the calculator behind the
 * master–detail Bank Feeds screen: it groups accounts for the left sidebar and
 * computes the four money views for the selected account on the right:
 *
 *   1) Activity    — the running statement (rows, newest first) with an
 *                    inflow/outflow direction + display strings.
 *   2) Money flow  — total IN, total OUT, and NET for a date range. NET is the
 *                    building block that will later roll up into net income.
 *   3) Categories  — spend grouped by Plaid's personal-finance category, biggest
 *                    first, so the owner can see where the money goes.
 *   4) Pending     — the not-yet-cleared subset.
 *
 * MONEY IS ALWAYS INTEGER CENTS. We never introduce floats here.
 *
 * PLAID SIGN CONVENTION (load-bearing, matches plaid-core.ts):
 *   POSITIVE amount_cents = money LEFT the account (a debit / OUTFLOW).
 *   NEGATIVE amount_cents = money CAME IN (a credit / INFLOW).
 * The UI thinks in "in vs out", so this module translates the sign into a
 * direction and reports magnitudes as positive cents. Removed (soft-deleted)
 * transactions are the caller's responsibility to exclude BEFORE calling in —
 * but computeMoneyFlow/etc. also defensively skip anything flagged removed.
 *
 * Slices ahead: the 2nd-Plaid-API slice adds an owner tag (Michael/Wife) — the
 * grouping here is written so an owner level drops in above institution with no
 * rework. Fidelity investment accounts will add a balance/holdings story to the
 * detail panel; this module stays cash-flow focused and leaves that room.
 */

import { formatCentsUsd } from "./plaid-ui-core";

// ---------------------------------------------------------------------------
// Types — the transaction shape this module reasons over (a lean projection of
// the plaid_transactions row; the reader in store.ts maps DB → this).
// ---------------------------------------------------------------------------

export type MoneyTxn = {
  transactionId: string;
  accountId: string;
  /** Integer cents, Plaid sign preserved (positive = out, negative = in). */
  amountCents: number;
  /** ISO date string, "YYYY-MM-DD". */
  date: string;
  name: string | null;
  merchantName: string | null;
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  pending: boolean;
  paymentChannel: string | null;
  /** Soft-delete flag; defensively skipped by the aggregates. */
  removed?: boolean;
};

export type FlowDirection = "in" | "out";

// ---------------------------------------------------------------------------
// 1) Sidebar grouping — accounts grouped by institution (owner level later).
// ---------------------------------------------------------------------------

export type GroupableAccount = {
  accountId: string;
  institutionName: string | null;
  /** Owner label (e.g. "Michael", "Wife") from the item's credential set. */
  owner?: string | null;
  /** Display name already resolved (nickname → bank name) by buildAccountSummary. */
  displayName: string;
  maskText: string;
  currentText: string;
  /** Raw balance in cents for group subtotal math (null = unknown). */
  currentBalanceCents: number | null;
  /** Canonical role value OR a custom (typed) role key; null = unassigned. */
  role: string | null;
};

export type AccountGroup = {
  /** Stable key for the group (institution name, normalized). */
  key: string;
  institutionName: string;
  accounts: GroupableAccount[];
  /** Sum of known currentBalanceCents in the group (nulls skipped). */
  subtotalCents: number;
  subtotalText: string;
};

/** Normalize an institution label; blanks fall back to a friendly placeholder. */
export function institutionLabel(name: string | null | undefined): string {
  const v = (name ?? "").replace(/\s+/g, " ").trim();
  return v === "" ? "Other accounts" : v;
}

/**
 * Group accounts by institution for the left sidebar. Groups are sorted by
 * institution name (A→Z, case-insensitive); accounts inside a group by display
 * name (A→Z). Deterministic so the sidebar never jumps around between renders.
 */
export function groupAccountsByInstitution(accounts: GroupableAccount[]): AccountGroup[] {
  const byKey = new Map<string, AccountGroup>();
  for (const a of accounts) {
    const label = institutionLabel(a.institutionName);
    const key = label.toLowerCase();
    let g = byKey.get(key);
    if (!g) {
      g = { key, institutionName: label, accounts: [], subtotalCents: 0, subtotalText: formatCentsUsd(0) };
      byKey.set(key, g);
    }
    g.accounts.push(a);
    if (typeof a.currentBalanceCents === "number" && Number.isFinite(a.currentBalanceCents)) {
      g.subtotalCents += a.currentBalanceCents;
    }
  }
  const groups = Array.from(byKey.values());
  for (const g of groups) {
    g.accounts.sort((x, y) =>
      x.displayName.localeCompare(y.displayName, "en", { sensitivity: "base" }),
    );
    g.subtotalText = formatCentsUsd(g.subtotalCents);
  }
  groups.sort((x, y) =>
    x.institutionName.localeCompare(y.institutionName, "en", { sensitivity: "base" }),
  );
  return groups;
}

/** Normalize an owner label; blanks fall back to a friendly placeholder. */
export function ownerGroupLabel(name: string | null | undefined): string {
  const v = (name ?? "").replace(/\s+/g, " ").trim();
  return v === "" ? "Unassigned owner" : v;
}

export type OwnerGroup = {
  /** Stable key for the owner (label, lowercased). */
  key: string;
  owner: string;
  institutions: AccountGroup[];
  /** Sum of known currentBalanceCents across the owner's accounts. */
  subtotalCents: number;
  subtotalText: string;
};

/**
 * How many DISTINCT owners are present among the accounts. The UI uses this to
 * decide whether to show the owner level at all (1 owner → skip it, just show
 * banks, exactly as before the 2nd-Plaid-API slice).
 */
export function distinctOwnerCount(accounts: GroupableAccount[]): number {
  const seen = new Set<string>();
  for (const a of accounts) seen.add(ownerGroupLabel(a.owner).toLowerCase());
  return seen.size;
}

/**
 * Group accounts by OWNER first, then institution within each owner. Owners are
 * sorted A→Z; institutions inside each owner reuse groupAccountsByInstitution
 * (so accounts stay A→Z and per-bank subtotals are consistent). Deterministic.
 * When there's only one owner this still works — the UI can choose to render
 * just the single owner's institution groups.
 */
export function groupAccountsByOwnerAndInstitution(accounts: GroupableAccount[]): OwnerGroup[] {
  const byOwner = new Map<string, GroupableAccount[]>();
  for (const a of accounts) {
    const label = ownerGroupLabel(a.owner);
    const key = label.toLowerCase();
    const list = byOwner.get(key) ?? [];
    list.push(a);
    byOwner.set(key, list);
  }
  const owners: OwnerGroup[] = Array.from(byOwner.entries()).map(([key, list]) => {
    const institutions = groupAccountsByInstitution(list);
    const subtotalCents = institutions.reduce((sum, g) => sum + g.subtotalCents, 0);
    return {
      key,
      owner: ownerGroupLabel(list[0].owner),
      institutions,
      subtotalCents,
      subtotalText: formatCentsUsd(subtotalCents),
    };
  });
  owners.sort((x, y) => x.owner.localeCompare(y.owner, "en", { sensitivity: "base" }));
  return owners;
}

/**
 * Pick which account the detail panel should show, given the URL's ?account=
 * param and the (already grouped) list. Returns the requested account id when
 * it exists, else the first account of the first group, else null (no accounts).
 * PURE — the page uses this so a stale/typo'd id never blanks the screen.
 */
export function resolveSelectedAccountId(
  requested: string | null | undefined,
  groups: AccountGroup[],
): string | null {
  const all = groups.flatMap((g) => g.accounts.map((a) => a.accountId));
  if (all.length === 0) return null;
  const want = (requested ?? "").trim();
  if (want !== "" && all.includes(want)) return want;
  return all[0];
}

// ---------------------------------------------------------------------------
// 2) Date ranges — the money-flow view's period picker (all math in UTC dates).
// ---------------------------------------------------------------------------

export type MoneyRangeKey = "this_month" | "last_month" | "this_year" | "all";

const MONEY_RANGE_KEYS: readonly MoneyRangeKey[] = ["this_month", "last_month", "this_year", "all"];

export function resolveMoneyRange(param: string | null | undefined): MoneyRangeKey {
  const v = (param ?? "").trim().toLowerCase();
  return (MONEY_RANGE_KEYS as readonly string[]).includes(v) ? (v as MoneyRangeKey) : "this_month";
}

export function moneyRangeLabel(key: MoneyRangeKey): string {
  switch (key) {
    case "this_month":
      return "This month";
    case "last_month":
      return "Last month";
    case "this_year":
      return "This year";
    case "all":
      return "All time";
  }
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/**
 * Compute the inclusive [start, end] ISO-date bounds for a range key, relative
 * to a reference "today" (ISO date). "all" returns nulls (no bounds). PURE &
 * timezone-stable: we parse Y/M/D as plain integers, never Date-with-TZ.
 */
export function moneyRangeBounds(
  key: MoneyRangeKey,
  today: string,
): { start: string | null; end: string | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((today ?? "").trim());
  // Defensive: if today is malformed, treat as no bounds rather than throwing.
  if (!m) return { start: null, end: null };
  const y = Number(m[1]);
  const mo = Number(m[2]); // 1..12

  if (key === "all") return { start: null, end: null };

  if (key === "this_year") {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  if (key === "this_month") {
    const last = daysInMonth(y, mo);
    return { start: `${y}-${pad2(mo)}-01`, end: `${y}-${pad2(mo)}-${pad2(last)}` };
  }

  // last_month
  const lmYear = mo === 1 ? y - 1 : y;
  const lmMonth = mo === 1 ? 12 : mo - 1;
  const last = daysInMonth(lmYear, lmMonth);
  return { start: `${lmYear}-${pad2(lmMonth)}-01`, end: `${lmYear}-${pad2(lmMonth)}-${pad2(last)}` };
}

function daysInMonth(year: number, month1to12: number): number {
  // month1to12: 1..12. new Date(y, m, 0) gives last day of month m (1-based).
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** True when an ISO date falls within inclusive bounds (null bound = open). */
export function dateInRange(date: string, start: string | null, end: string | null): boolean {
  const d = (date ?? "").trim();
  if (d === "") return false;
  if (start !== null && d < start) return false;
  if (end !== null && d > end) return false;
  return true;
}

/** Keep only live (not removed) transactions within the range. */
export function filterTxnsInRange(
  txns: MoneyTxn[],
  start: string | null,
  end: string | null,
): MoneyTxn[] {
  return txns.filter((t) => !t.removed && dateInRange(t.date, start, end));
}

// ---------------------------------------------------------------------------
// 3) Money flow — total IN, total OUT, NET (all positive-magnitude cents).
// ---------------------------------------------------------------------------

export type MoneyFlow = {
  /** Money that came IN (sum of |amount| for negative-signed txns). */
  inflowCents: number;
  /** Money that went OUT (sum of |amount| for positive-signed txns). */
  outflowCents: number;
  /** inflow − outflow. Positive = net gain, negative = net spend. */
  netCents: number;
  /** Count of live txns considered. */
  count: number;
  inflowText: string;
  outflowText: string;
  /** NET rendered with sign (e.g. "+$1,200.00" / "-$340.00"). */
  netText: string;
};

/** Format a signed net amount: gains get a leading "+", losses keep the "-". */
export function formatNetCentsUsd(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  if (cents > 0) return "+" + formatCentsUsd(cents);
  return formatCentsUsd(cents); // 0 → "$0.00"; negatives already carry "-".
}

/**
 * Compute money-in / money-out / net over the given (already range-filtered or
 * full) transaction list. Removed txns are skipped defensively. Amounts are
 * summed as magnitudes by direction so the UI shows friendly positive totals.
 */
export function computeMoneyFlow(txns: MoneyTxn[]): MoneyFlow {
  let inflowCents = 0;
  let outflowCents = 0;
  let count = 0;
  for (const t of txns) {
    if (t.removed) continue;
    const amt = t.amountCents;
    if (!Number.isFinite(amt)) continue;
    count += 1;
    if (amt < 0) {
      inflowCents += -amt; // negative = money in
    } else {
      outflowCents += amt; // positive (incl. 0) = money out
    }
  }
  const netCents = inflowCents - outflowCents;
  return {
    inflowCents,
    outflowCents,
    netCents,
    count,
    inflowText: formatCentsUsd(inflowCents),
    outflowText: formatCentsUsd(outflowCents),
    netText: formatNetCentsUsd(netCents),
  };
}

// ---------------------------------------------------------------------------
// 4) Category breakdown — where the money goes (OUTFLOWS by category).
// ---------------------------------------------------------------------------

export type CategorySlice = {
  category: string;
  amountCents: number; // positive magnitude of outflow
  count: number;
  amountText: string;
  /** Share of total outflow, 0..100, rounded to a whole percent. */
  percent: number;
};

/** Human-friendly label for Plaid's UPPER_SNAKE primary categories. */
export function categoryLabel(primary: string | null | undefined): string {
  const raw = (primary ?? "").replace(/\s+/g, " ").trim();
  if (raw === "") return "Uncategorized";
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Group OUTFLOWS (money out) by primary category, biggest first. We only count
 * outflows here because "where the money goes" is a spending question; inflows
 * (deposits, refunds) are shown in the money-flow view. Percent is share of
 * total outflow. Ties broken by category name (A→Z) for stable ordering.
 */
export function computeCategoryBreakdown(txns: MoneyTxn[]): CategorySlice[] {
  const byLabel = new Map<string, { amountCents: number; count: number }>();
  let totalOut = 0;
  for (const t of txns) {
    if (t.removed) continue;
    const amt = t.amountCents;
    if (!Number.isFinite(amt) || amt <= 0) continue; // outflows only
    totalOut += amt;
    const label = categoryLabel(t.categoryPrimary);
    const cur = byLabel.get(label) ?? { amountCents: 0, count: 0 };
    cur.amountCents += amt;
    cur.count += 1;
    byLabel.set(label, cur);
  }
  const slices: CategorySlice[] = Array.from(byLabel.entries()).map(([category, v]) => ({
    category,
    amountCents: v.amountCents,
    count: v.count,
    amountText: formatCentsUsd(v.amountCents),
    percent: totalOut > 0 ? Math.round((v.amountCents / totalOut) * 100) : 0,
  }));
  slices.sort((a, b) => (b.amountCents - a.amountCents) || a.category.localeCompare(b.category, "en", { sensitivity: "base" }));
  return slices;
}

// ---------------------------------------------------------------------------
// 5) Activity rows + pending — the statement view and its uncleared subset.
// ---------------------------------------------------------------------------

export type ActivityRow = {
  transactionId: string;
  date: string;
  /** merchant → name → "—", cleaned. */
  description: string;
  categoryText: string;
  direction: FlowDirection;
  /** Magnitude in cents (always positive). */
  magnitudeCents: number;
  /** Signed for the ledger: inflow "+$..", outflow "-$..". */
  amountText: string;
  pending: boolean;
};

function cleanDescription(t: MoneyTxn): string {
  const merchant = (t.merchantName ?? "").replace(/\s+/g, " ").trim();
  if (merchant !== "") return merchant;
  const name = (t.name ?? "").replace(/\s+/g, " ").trim();
  return name !== "" ? name : "—";
}

/**
 * Build display rows for the Activity (statement) view. Input order is
 * preserved (the reader already sorts date desc); removed txns are skipped.
 * amountText shows the ledger sign: money in as "+$..", money out as "-$..".
 */
export function buildActivityRows(txns: MoneyTxn[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const t of txns) {
    if (t.removed) continue;
    const amt = Number.isFinite(t.amountCents) ? t.amountCents : 0;
    const direction: FlowDirection = amt < 0 ? "in" : "out";
    const magnitude = Math.abs(amt);
    const amountText = direction === "in" ? "+" + formatCentsUsd(magnitude) : "-" + formatCentsUsd(magnitude);
    rows.push({
      transactionId: t.transactionId,
      date: t.date,
      description: cleanDescription(t),
      categoryText: categoryLabel(t.categoryPrimary),
      direction,
      magnitudeCents: magnitude,
      amountText,
      pending: !!t.pending,
    });
  }
  return rows;
}

/** The pending (not-yet-cleared) subset, as activity rows. */
export function buildPendingRows(txns: MoneyTxn[]): ActivityRow[] {
  return buildActivityRows(txns.filter((t) => !t.removed && t.pending));
}

// ---------------------------------------------------------------------------
// 6) Money-view tab resolver — the four sub-views of the detail panel.
// ---------------------------------------------------------------------------

export type MoneyView = "activity" | "flow" | "categories" | "pending";

const MONEY_VIEWS: readonly MoneyView[] = ["activity", "flow", "categories", "pending"];

export function resolveMoneyView(param: string | null | undefined): MoneyView {
  const v = (param ?? "").trim().toLowerCase();
  return (MONEY_VIEWS as readonly string[]).includes(v) ? (v as MoneyView) : "activity";
}

export function moneyViewLabel(view: MoneyView): string {
  switch (view) {
    case "activity":
      return "Activity";
    case "flow":
      return "Money in & out";
    case "categories":
      return "Where it goes";
    case "pending":
      return "Pending";
  }
}

// ---------------------------------------------------------------------------
// Self-tests (harness parity with the other Plaid cores).
// ---------------------------------------------------------------------------

export function __runPlaidMoneyCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // institutionLabel --------------------------------------------------------
  ok(institutionLabel("Timberland") === "Timberland", "institution passes through");
  ok(institutionLabel("  Citi  Bank ") === "Citi Bank", "institution whitespace collapsed");
  ok(institutionLabel(null) === "Other accounts", "null institution → Other accounts");
  ok(institutionLabel("   ") === "Other accounts", "blank institution → Other accounts");

  // groupAccountsByInstitution ----------------------------------------------
  const accts: GroupableAccount[] = [
    { accountId: "a1", institutionName: "Timberland", displayName: "Business Checking", maskText: "•••• 1111", currentText: "$1,000.00", currentBalanceCents: 100000, role: "main" },
    { accountId: "a2", institutionName: "Citi", displayName: "Costco Visa", maskText: "•••• 2222", currentText: "-$500.00", currentBalanceCents: -50000, role: "credit" },
    { accountId: "a3", institutionName: "Timberland", displayName: "ATM Deposits", maskText: "•••• 3333", currentText: "$250.00", currentBalanceCents: 25000, role: "atm" },
    { accountId: "a4", institutionName: null, displayName: "Cash", maskText: "—", currentText: "—", currentBalanceCents: null, role: null },
  ];
  const groups = groupAccountsByInstitution(accts);
  ok(groups.length === 3, "3 institution groups (Citi, Other, Timberland)");
  ok(groups[0].institutionName === "Citi", "groups sorted A→Z (Citi first)");
  ok(groups[1].institutionName === "Other accounts", "Other accounts sorts by label");
  ok(groups[2].institutionName === "Timberland", "Timberland last");
  const tb = groups[2];
  ok(tb.accounts.length === 2, "Timberland has 2 accounts");
  ok(tb.accounts[0].displayName === "ATM Deposits", "accounts sorted A→Z inside group");
  ok(tb.subtotalCents === 125000, "Timberland subtotal = 100000 + 25000");
  ok(tb.subtotalText === "$1,250.00", "subtotal formatted");
  ok(groups[1].subtotalCents === 0, "null-balance account contributes 0 to subtotal");

  // resolveSelectedAccountId ------------------------------------------------
  ok(resolveSelectedAccountId("a3", groups) === "a3", "existing id selected");
  ok(resolveSelectedAccountId("nope", groups) === "a2", "unknown id → first account of first group (Citi a2)");
  ok(resolveSelectedAccountId(null, groups) === "a2", "null → first account");
  ok(resolveSelectedAccountId("a1", []) === null, "no accounts → null");

  // ownerGroupLabel ---------------------------------------------------------
  ok(ownerGroupLabel("Michael") === "Michael", "owner label passthrough");
  ok(ownerGroupLabel("  Michael   B  ") === "Michael B", "owner label whitespace collapsed");
  ok(ownerGroupLabel("") === "Unassigned owner", "blank owner → placeholder");
  ok(ownerGroupLabel(null) === "Unassigned owner", "null owner → placeholder");
  ok(ownerGroupLabel("   ") === "Unassigned owner", "whitespace owner → placeholder");

  // distinctOwnerCount ------------------------------------------------------
  const ownedAccts: GroupableAccount[] = [
    { accountId: "b1", institutionName: "Timberland", displayName: "Biz Checking", maskText: "•••• 1111", currentText: "$1,000.00", currentBalanceCents: 100000, role: "main", owner: "Michael" },
    { accountId: "b2", institutionName: "Citi", displayName: "Costco Visa", maskText: "•••• 2222", currentText: "-$500.00", currentBalanceCents: -50000, role: "credit", owner: "Michael" },
    { accountId: "b3", institutionName: "Chase", displayName: "Personal Checking", maskText: "•••• 3333", currentText: "$300.00", currentBalanceCents: 30000, role: "main", owner: "Wife" },
    { accountId: "b4", institutionName: "Chase", displayName: "Savings", maskText: "•••• 4444", currentText: "$500.00", currentBalanceCents: 50000, role: "main", owner: "Wife" },
  ];
  ok(distinctOwnerCount(ownedAccts) === 2, "two distinct owners (Michael, Wife)");
  ok(distinctOwnerCount([ownedAccts[0], ownedAccts[1]]) === 1, "single owner → count 1");
  ok(distinctOwnerCount([]) === 0, "no accounts → 0 owners");
  ok(distinctOwnerCount([{ ...ownedAccts[0], owner: "Michael" }, { ...ownedAccts[1], owner: "michael" }]) === 1, "owner distinctness is case-insensitive");
  ok(distinctOwnerCount([{ ...ownedAccts[0], owner: null }]) === 1, "null owner still counts as one (Unassigned)");

  // groupAccountsByOwnerAndInstitution --------------------------------------
  const owners = groupAccountsByOwnerAndInstitution(ownedAccts);
  ok(owners.length === 2, "two owner groups");
  ok(owners[0].owner === "Michael", "owners sorted A→Z (Michael first)");
  ok(owners[1].owner === "Wife", "Wife second");
  ok(owners[0].key === "michael", "owner key is lowercased label");
  ok(owners[0].institutions.length === 2, "Michael has 2 institutions (Citi, Timberland)");
  ok(owners[0].institutions[0].institutionName === "Citi", "Michael institutions sorted A→Z");
  ok(owners[0].subtotalCents === 50000, "Michael subtotal = 100000 + (-50000)");
  ok(owners[0].subtotalText === "$500.00", "Michael subtotal formatted");
  ok(owners[1].institutions.length === 1, "Wife has 1 institution (Chase)");
  ok(owners[1].institutions[0].accounts.length === 2, "Wife's Chase has 2 accounts");
  ok(owners[1].subtotalCents === 80000, "Wife subtotal = 30000 + 50000");
  ok(groupAccountsByOwnerAndInstitution([]).length === 0, "no accounts → no owner groups");
  const oneOwner = groupAccountsByOwnerAndInstitution([ownedAccts[0], ownedAccts[1]]);
  ok(oneOwner.length === 1 && oneOwner[0].owner === "Michael", "single-owner grouping still works");

  // resolveMoneyRange / label -----------------------------------------------
  ok(resolveMoneyRange(undefined) === "this_month", "no range → this_month");
  ok(resolveMoneyRange("ALL") === "all", "case-insensitive all");
  ok(resolveMoneyRange("garbage") === "this_month", "unknown range → this_month");
  ok(moneyRangeLabel("last_month") === "Last month", "range label");

  // moneyRangeBounds --------------------------------------------------------
  const tm = moneyRangeBounds("this_month", "2025-03-15");
  ok(tm.start === "2025-03-01" && tm.end === "2025-03-31", "this_month bounds (Mar → 31 days)");
  const feb = moneyRangeBounds("this_month", "2024-02-10");
  ok(feb.start === "2024-02-01" && feb.end === "2024-02-29", "this_month leap-year Feb → 29");
  const lm = moneyRangeBounds("last_month", "2025-01-05");
  ok(lm.start === "2024-12-01" && lm.end === "2024-12-31", "last_month across year boundary → Dec prior year");
  const ty = moneyRangeBounds("this_year", "2025-07-04");
  ok(ty.start === "2025-01-01" && ty.end === "2025-12-31", "this_year bounds");
  const all = moneyRangeBounds("all", "2025-07-04");
  ok(all.start === null && all.end === null, "all → no bounds");
  const bad = moneyRangeBounds("this_month", "not-a-date");
  ok(bad.start === null && bad.end === null, "malformed today → no bounds (defensive)");

  // dateInRange / filterTxnsInRange -----------------------------------------
  ok(dateInRange("2025-03-15", "2025-03-01", "2025-03-31"), "date inside range");
  ok(!dateInRange("2025-04-01", "2025-03-01", "2025-03-31"), "date after range");
  ok(!dateInRange("2025-02-28", "2025-03-01", "2025-03-31"), "date before range");
  ok(dateInRange("2025-03-15", null, null), "open bounds accept anything");

  const sample: MoneyTxn[] = [
    { transactionId: "t1", accountId: "a1", amountCents: 5000, date: "2025-03-02", name: "Rent", merchantName: null, categoryPrimary: "RENT_AND_UTILITIES", categoryDetailed: null, pending: false, paymentChannel: "other" },
    { transactionId: "t2", accountId: "a1", amountCents: -120000, date: "2025-03-05", name: "Deposit", merchantName: null, categoryPrimary: "INCOME", categoryDetailed: null, pending: false, paymentChannel: "other" },
    { transactionId: "t3", accountId: "a1", amountCents: 2599, date: "2025-03-10", name: "Coffee", merchantName: "Starbucks", categoryPrimary: "FOOD_AND_DRINK", categoryDetailed: null, pending: true, paymentChannel: "in store" },
    { transactionId: "t4", accountId: "a1", amountCents: 8000, date: "2025-02-20", name: "OldBill", merchantName: null, categoryPrimary: "RENT_AND_UTILITIES", categoryDetailed: null, pending: false, paymentChannel: "other" },
    { transactionId: "t5", accountId: "a1", amountCents: 9999, date: "2025-03-11", name: "Removed", merchantName: null, categoryPrimary: "FOOD_AND_DRINK", categoryDetailed: null, pending: false, paymentChannel: "other", removed: true },
  ];
  const inMar = filterTxnsInRange(sample, "2025-03-01", "2025-03-31");
  ok(inMar.length === 3, "March filter keeps t1,t2,t3 (excludes Feb t4 + removed t5)");

  // computeMoneyFlow --------------------------------------------------------
  const flow = computeMoneyFlow(inMar);
  ok(flow.inflowCents === 120000, "inflow = 120000 (t2 negative → in)");
  ok(flow.outflowCents === 7599, "outflow = 5000 + 2599");
  ok(flow.netCents === 112401, "net = 120000 - 7599");
  ok(flow.count === 3, "flow counts 3 live txns");
  ok(flow.inflowText === "$1,200.00", "inflow formatted");
  ok(flow.outflowText === "$75.99", "outflow formatted");
  ok(flow.netText === "+$1,124.01", "positive net gets leading +");
  const spendFlow = computeMoneyFlow([sample[0]]);
  ok(spendFlow.netText === "-$50.00", "negative net keeps -");
  ok(formatNetCentsUsd(0) === "$0.00", "zero net → $0.00 (no sign)");
  const emptyFlow = computeMoneyFlow([]);
  ok(emptyFlow.inflowCents === 0 && emptyFlow.outflowCents === 0 && emptyFlow.netCents === 0, "empty flow all zero");

  // computeCategoryBreakdown (outflows only) --------------------------------
  const cats = computeCategoryBreakdown(inMar);
  ok(cats.length === 2, "2 outflow categories (Rent, Food) — inflow t2 excluded");
  ok(cats[0].category === "Rent And Utilities", "biggest category first (Rent 5000)");
  ok(cats[0].amountCents === 5000 && cats[0].count === 1, "rent slice amount/count");
  ok(cats[1].category === "Food And Drink" && cats[1].amountCents === 2599, "food slice");
  ok(cats[0].percent + cats[1].percent === 100, "percents sum to 100 over outflow total");
  ok(cats[0].percent === 66, "rent ≈ 66% of 7599 outflow");
  ok(categoryLabel(null) === "Uncategorized", "null category → Uncategorized");
  ok(categoryLabel("GENERAL_MERCHANDISE") === "General Merchandise", "snake → Title Case");
  const noOut = computeCategoryBreakdown([sample[1]]); // only the inflow
  ok(noOut.length === 0, "pure-inflow set → no spend categories");

  // buildActivityRows -------------------------------------------------------
  const rows = buildActivityRows(inMar);
  ok(rows.length === 3, "activity rows exclude removed");
  const inRow = rows.find((r) => r.transactionId === "t2")!;
  ok(inRow.direction === "in" && inRow.amountText === "+$1,200.00", "inflow row signed +");
  const outRow = rows.find((r) => r.transactionId === "t1")!;
  ok(outRow.direction === "out" && outRow.amountText === "-$50.00", "outflow row signed -");
  const merchRow = rows.find((r) => r.transactionId === "t3")!;
  ok(merchRow.description === "Starbucks", "merchant name wins over name");
  ok(merchRow.categoryText === "Food And Drink", "row category labeled");
  ok(merchRow.pending === true, "pending flag carried through");
  ok(inRow.description === "Deposit", "falls back to name when no merchant");

  // buildPendingRows --------------------------------------------------------
  const pend = buildPendingRows(sample);
  ok(pend.length === 1 && pend[0].transactionId === "t3", "only pending txn (t3), removed skipped");

  // resolveMoneyView / label ------------------------------------------------
  ok(resolveMoneyView(undefined) === "activity", "no view → activity");
  ok(resolveMoneyView("CATEGORIES") === "categories", "case-insensitive view");
  ok(resolveMoneyView("nope") === "activity", "unknown view → activity");
  ok(moneyViewLabel("flow") === "Money in & out", "flow view label");
  ok(moneyViewLabel("categories") === "Where it goes", "categories view label");

  if (failures.length > 0) {
    throw new Error("plaid-money-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("plaid-money-core: all self-tests passed");
}

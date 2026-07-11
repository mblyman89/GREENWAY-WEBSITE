/**
 * src/lib/discovery/supplier-switching-core.ts
 *
 * PURE month-over-month supplier-switching detection (Task H, S9 — logged
 * suggestion #1). Compares two monthly transformer drops' per-competitor
 * supplier rollups (`discovery_competitor_stats.top_suppliers`, migration
 * 0107) and surfaces:
 *
 *  - per COMPETITOR: which suppliers ENTERED / EXITED their top-supplier list
 *    and how spend moved for suppliers present in both months, and
 *  - per SUPPLIER: tracked-buyer momentum — how many tracked competitors they
 *    supplied this month vs last, naming the stores gained/lost.
 *
 * HONESTY (NEVER GUESS): the persisted list is each competitor's TOP
 * suppliers by spend (capped at TOP_SUPPLIERS_PER_COMPETITOR = 10). A
 * supplier leaving the list means "no longer among the store's top
 * suppliers", NOT "the store stopped buying from them" — the copy in every
 * consumer must say so. Rows persisted before migration 0107 (or before the
 * month's zip was re-uploaded) have empty supplier lists; those competitors
 * are reported with hasPrevData/hasCurrData=false instead of fabricating a
 * "everything changed" diff.
 *
 * Join key: supplier LICENSE NUMBER when present (stable public identifier),
 * falling back to the CCRS surrogate LicenseeId. Real-file check (May 2026):
 * 367/367 persisted supplier rows carry a license number.
 *
 * Standing rules: money in MINOR UNITS; pure module (no I/O) — covered by
 * tests/compliance/supplier-switching-core.test.ts.
 */

// ---------------------------------------------------------------------------
// Inputs — structurally match DiscoveryCompetitorStatRow / DiscoveryCompetitor.
// ---------------------------------------------------------------------------

export type SwitchSupplierLike = {
  licenseeId: string;
  licenseNumber: string | null;
  name: string | null;
  dba: string | null;
  lineCount: number;
  spendMinor: number;
};

export type SwitchCompetitorStatLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  wholesale_line_count?: number;
  wholesale_spend_minor?: number;
  top_suppliers?: SwitchSupplierLike[];
};

export type SwitchRosterLike = {
  license_number: string;
  tradename: string;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type SupplierChange = {
  /** Stable join key: license number when known, else `id:<licenseeId>`. */
  supplierKey: string;
  displayName: string;
  licenseNumber: string | null;
  licenseeId: string;
  /** Null when the supplier wasn't on that month's top list (unknown, not 0). */
  prevSpendMinor: number | null;
  currSpendMinor: number | null;
  prevLineCount: number | null;
  currLineCount: number | null;
  /** curr − prev; only when the supplier is on BOTH months' lists. */
  deltaSpendMinor: number | null;
};

export type CompetitorSwitchReport = {
  licenseNumber: string;
  competitorName: string;
  /** False when that month's row is missing or has no supplier data (pre-0107). */
  hasPrevData: boolean;
  hasCurrData: boolean;
  /** On the current top list but not last month's. */
  entered: SupplierChange[];
  /** On last month's top list but not the current one. */
  exited: SupplierChange[];
  /** On both lists, biggest spend movement first. */
  continued: SupplierChange[];
};

export type SupplierMomentum = {
  supplierKey: string;
  displayName: string;
  licenseNumber: string | null;
  licenseeId: string;
  prevBuyerCount: number;
  currBuyerCount: number;
  /** curr − prev tracked buyers. */
  buyerDelta: number;
  /** Tracked-competitor display names gained/lost this month. */
  gainedBuyers: string[];
  lostBuyers: string[];
  currSpendMinor: number;
  prevSpendMinor: number;
};

export type SupplierSwitchReport = {
  /** Competitors with supplier data in BOTH months and at least one change. */
  competitors: CompetitorSwitchReport[];
  /** Suppliers whose tracked-buyer count moved, biggest |delta| first. */
  momentum: SupplierMomentum[];
  /** Competitors present but lacking supplier data in one of the months. */
  missingPrevData: string[];
  missingCurrData: string[];
};

/** Caps so the UI/AI surfaces stay bounded. */
export const MAX_SWITCH_COMPETITORS = 40;
export const MAX_SUPPLIER_MOMENTUM = 20;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function money(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function supplierKey(s: SwitchSupplierLike): string | null {
  const lic = (s.licenseNumber ?? "").trim();
  if (lic) return lic;
  const id = (s.licenseeId ?? "").trim();
  return id ? `id:${id}` : null; // id-less rows are dropped (consistent with S7)
}

function supplierDisplayName(s: SwitchSupplierLike): string {
  return s.dba?.trim() || s.name?.trim() || `Licensee ${s.licenseeId}`;
}

function competitorDisplayName(
  stat: SwitchCompetitorStatLike,
  rosterNames: Map<string, string>,
): string {
  return (
    rosterNames.get(stat.license_number) ||
    stat.dba?.trim() ||
    stat.name?.trim() ||
    `License ${stat.license_number}`
  );
}

function indexSuppliers(stat: SwitchCompetitorStatLike): Map<string, SwitchSupplierLike> {
  const out = new Map<string, SwitchSupplierLike>();
  for (const s of stat.top_suppliers ?? []) {
    const key = supplierKey(s);
    if (!key) continue;
    const prev = out.get(key);
    if (prev) {
      // Same supplier listed twice (shouldn't happen; fold honestly).
      prev.lineCount = count(prev.lineCount) + count(s.lineCount);
      prev.spendMinor = money(prev.spendMinor) + money(s.spendMinor);
    } else {
      out.set(key, { ...s, lineCount: count(s.lineCount), spendMinor: money(s.spendMinor) });
    }
  }
  return out;
}

/**
 * Diff the current month's competitor supplier lists against the previous
 * month's. Only competitors with supplier data in BOTH months produce a diff;
 * everything else is reported in missing*Data so the UI can say exactly why.
 */
export function buildSupplierSwitchReport(
  current: SwitchCompetitorStatLike[],
  previous: SwitchCompetitorStatLike[],
  roster: SwitchRosterLike[],
  opts?: { maxCompetitors?: number; maxMomentum?: number },
): SupplierSwitchReport {
  const maxCompetitors = opts?.maxCompetitors ?? MAX_SWITCH_COMPETITORS;
  const maxMomentum = opts?.maxMomentum ?? MAX_SUPPLIER_MOMENTUM;
  const rosterNames = new Map(roster.map((r) => [r.license_number, r.tradename]));
  const prevByLicense = new Map(previous.map((s) => [s.license_number, s]));

  const competitors: CompetitorSwitchReport[] = [];
  const missingPrevData: string[] = [];
  const missingCurrData: string[] = [];

  // supplierKey → per-month tracked-buyer sets + identity + spend totals.
  type MomentumAcc = {
    identity: SwitchSupplierLike;
    prevBuyers: Set<string>;
    currBuyers: Set<string>;
    prevSpendMinor: number;
    currSpendMinor: number;
  };
  const momentumAcc = new Map<string, MomentumAcc>();
  const buyerNames = new Map<string, string>(); // competitor license → display name

  const touch = (key: string, identity: SwitchSupplierLike): MomentumAcc => {
    let acc = momentumAcc.get(key);
    if (!acc) {
      acc = {
        identity,
        prevBuyers: new Set(),
        currBuyers: new Set(),
        prevSpendMinor: 0,
        currSpendMinor: 0,
      };
      momentumAcc.set(key, acc);
    }
    return acc;
  };

  // Momentum needs BOTH months' full pictures, including competitors that only
  // have data in one month — but comparing buyer sets is only honest for
  // competitors with data in both. Restrict momentum to those.
  const comparable = new Set<string>();
  for (const curr of current) {
    const prev = prevByLicense.get(curr.license_number);
    const currHas = (curr.top_suppliers ?? []).length > 0;
    const prevHas = ((prev?.top_suppliers ?? []) as SwitchSupplierLike[]).length > 0;
    if (currHas && prevHas) comparable.add(curr.license_number);
  }

  for (const curr of current) {
    const name = competitorDisplayName(curr, rosterNames);
    buyerNames.set(curr.license_number, name);
    const prev = prevByLicense.get(curr.license_number);
    const currMap = indexSuppliers(curr);
    const prevMap = prev ? indexSuppliers(prev) : new Map<string, SwitchSupplierLike>();
    const hasCurrData = currMap.size > 0;
    const hasPrevData = prevMap.size > 0;

    if (!hasPrevData) missingPrevData.push(name);
    if (!hasCurrData) missingCurrData.push(name);

    if (comparable.has(curr.license_number)) {
      for (const [key, s] of currMap) touch(key, s).currBuyers.add(curr.license_number);
      for (const [key, s] of prevMap) touch(key, s).prevBuyers.add(curr.license_number);
      for (const [key, s] of currMap) touch(key, s).currSpendMinor += money(s.spendMinor);
      for (const [key, s] of prevMap) touch(key, s).prevSpendMinor += money(s.spendMinor);
    }

    if (!hasCurrData || !hasPrevData) continue;

    const entered: SupplierChange[] = [];
    const exited: SupplierChange[] = [];
    const continued: SupplierChange[] = [];

    for (const [key, s] of currMap) {
      const before = prevMap.get(key);
      if (!before) {
        entered.push({
          supplierKey: key,
          displayName: supplierDisplayName(s),
          licenseNumber: s.licenseNumber,
          licenseeId: s.licenseeId,
          prevSpendMinor: null,
          currSpendMinor: money(s.spendMinor),
          prevLineCount: null,
          currLineCount: count(s.lineCount),
          deltaSpendMinor: null,
        });
      } else {
        continued.push({
          supplierKey: key,
          displayName: supplierDisplayName(s),
          licenseNumber: s.licenseNumber,
          licenseeId: s.licenseeId,
          prevSpendMinor: money(before.spendMinor),
          currSpendMinor: money(s.spendMinor),
          prevLineCount: count(before.lineCount),
          currLineCount: count(s.lineCount),
          deltaSpendMinor: money(s.spendMinor) - money(before.spendMinor),
        });
      }
    }
    for (const [key, s] of prevMap) {
      if (currMap.has(key)) continue;
      exited.push({
        supplierKey: key,
        displayName: supplierDisplayName(s),
        licenseNumber: s.licenseNumber,
        licenseeId: s.licenseeId,
        prevSpendMinor: money(s.spendMinor),
        currSpendMinor: null,
        prevLineCount: count(s.lineCount),
        currLineCount: null,
        deltaSpendMinor: null,
      });
    }

    if (entered.length === 0 && exited.length === 0) continue; // steady roster — nothing to flag

    entered.sort((a, b) => (b.currSpendMinor ?? 0) - (a.currSpendMinor ?? 0));
    exited.sort((a, b) => (b.prevSpendMinor ?? 0) - (a.prevSpendMinor ?? 0));
    continued.sort(
      (a, b) => Math.abs(b.deltaSpendMinor ?? 0) - Math.abs(a.deltaSpendMinor ?? 0),
    );

    competitors.push({
      licenseNumber: curr.license_number,
      competitorName: name,
      hasPrevData,
      hasCurrData,
      entered,
      exited,
      continued,
    });
  }

  // Most movement first: change count desc → current wholesale spend desc.
  const currSpendByLicense = new Map(
    current.map((c) => [c.license_number, money(c.wholesale_spend_minor)]),
  );
  competitors.sort((a, b) => {
    const moves = b.entered.length + b.exited.length - (a.entered.length + a.exited.length);
    if (moves !== 0) return moves;
    return (
      (currSpendByLicense.get(b.licenseNumber) ?? 0) -
      (currSpendByLicense.get(a.licenseNumber) ?? 0)
    );
  });

  const momentum: SupplierMomentum[] = [];
  for (const [key, acc] of momentumAcc) {
    const buyerDelta = acc.currBuyers.size - acc.prevBuyers.size;
    const gainedBuyers = [...acc.currBuyers]
      .filter((b) => !acc.prevBuyers.has(b))
      .map((b) => buyerNames.get(b) ?? `License ${b}`)
      .sort();
    const lostBuyers = [...acc.prevBuyers]
      .filter((b) => !acc.currBuyers.has(b))
      .map((b) => buyerNames.get(b) ?? `License ${b}`)
      .sort();
    if (buyerDelta === 0 && gainedBuyers.length === 0 && lostBuyers.length === 0) continue;
    momentum.push({
      supplierKey: key,
      displayName: supplierDisplayName(acc.identity),
      licenseNumber: acc.identity.licenseNumber,
      licenseeId: acc.identity.licenseeId,
      prevBuyerCount: acc.prevBuyers.size,
      currBuyerCount: acc.currBuyers.size,
      buyerDelta,
      gainedBuyers,
      lostBuyers,
      currSpendMinor: acc.currSpendMinor,
      prevSpendMinor: acc.prevSpendMinor,
    });
  }
  momentum.sort((a, b) => {
    const d = Math.abs(b.buyerDelta) - Math.abs(a.buyerDelta);
    if (d !== 0) return d;
    return b.currSpendMinor - a.currSpendMinor;
  });

  return {
    competitors: competitors.slice(0, maxCompetitors),
    momentum: momentum.slice(0, maxMomentum),
    missingPrevData,
    missingCurrData,
  };
}

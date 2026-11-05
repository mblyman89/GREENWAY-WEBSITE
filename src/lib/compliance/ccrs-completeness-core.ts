/**
 * src/lib/compliance/ccrs-completeness-core.ts   (D183, round slice S6)
 *
 * PURE. No I/O, no server-only imports: the compliance harness runs the
 * self-test directly.
 *
 * Owner (2026-11-04): "The numbers and data need to make it to CCRS and I need
 * to pay the correct amount in taxes." Strategy section 5: "Sales in system =
 * sales in file = money collected. It won't let a file go out short." and, for
 * lots that show zero but keep selling, "fix the record, not hide the sale".
 *
 * 1. Weekly completeness. Every completed cannabis sale line of a CCRS week
 *    (Sun-Sat, Pacific) is exactly one of: FILED (a Sale row in a file that
 *    was not abandoned), HELD (an open ccrs_held_sync row that says why), or
 *    MISSING (in neither: it must go in the next file). The money the filed
 *    rows carry (qty x UnitPrice - Discount + sales tax + excise) is compared
 *    with the money the register took for the same lines, to the cent, with
 *    one cent of rounding allowed per line (each line's taxes are rounded on
 *    their own).
 *
 * 2. Lot shortfalls. A lot's record is received + adjustments - sold. Below
 *    zero means the record says more was sold than the lot ever had. The cause
 *    is worked out and a repair is offered ONLY when it changes no stock:
 *      wrong lot     the register drew the units from a sibling lot (same
 *                    product key, or the same product name) whose on-hand is
 *                    already lower than its record by at least the line's
 *                    quantity. Moving that line's CCRS lot fixes BOTH records
 *                    and changes nobody's on-hand.
 *      count         a cycle count took units away that the sales show were
 *                    really sold. A count correction of exactly the shortfall
 *                    brings the record back to the shelf (0). On-hand stays.
 *      split         the units came from two lots inside ONE sale line. That
 *                    needs a Sale correction by hand; nothing is automatic.
 *      unknown       nothing explains it: count the shelf.
 *    Never: invent stock, back-date, or change a sale's amount. A line CCRS
 *    already holds in Production is never moved here (that needs a Sale
 *    Update through the correction download).
 *
 * Money is integer cents throughout.
 */

// ---------------------------------------------------------------------------
// 1. Weekly completeness
// ---------------------------------------------------------------------------

export type SaleLineFact = {
  /** SaleDetailExternalIdentifier this line is filed under. */
  detailId: string;
  orderNumber: string;
  /** Pacific day the sale completed (YYYY-MM-DD). */
  day: string;
  quantity: number;
  /** What the register took for the line: price_minor_units x quantity (tax-inclusive). */
  moneyMinor: number;
  /** Other Inventory (non-cannabis) or zero quantity: never on Sale.csv. */
  excluded: boolean;
};

export type FiledRowFact = {
  detailId: string;
  fileName: string;
  fileState: string;
  /** qty x UnitPrice - Discount + RetailSalesTax + CannabisExciseTax, in cents (null when unreadable). */
  moneyMinor: number | null;
};

export type HeldFact = { detailId: string; code: string; reason: string };

export type CompletenessStatus = "complete" | "pending" | "held" | "missing" | "money" | "unknown";

export type Completeness = {
  status: CompletenessStatus;
  lines: number;
  excluded: number;
  filed: number;
  held: number;
  missing: number;
  /** Money the register took for every cannabis line in the week. */
  takenMinor: number;
  /** Money the register took for the lines that are filed. */
  takenFiledMinor: number;
  /** Money the filed rows carry. */
  filedMinor: number;
  /** filedMinor - takenFiledMinor. */
  moneyDiffMinor: number;
  /** One cent per filed line. */
  toleranceMinor: number;
  /** Filed rows whose money could not be read. */
  unreadableRows: number;
  missingLines: SaleLineFact[];
  heldLines: (SaleLineFact & { code: string; reason: string })[];
  /** Detail ids filed more than once in files that were not abandoned. */
  filedTwice: string[];
  headline: string;
  readErrors: string[];
};

/** The SaleDetailExternalIdentifier ccrs-sales.ts writes for a line. */
export function saleDetailId(orderNumber: string | null | undefined, orderId: string, lineId: string): string {
  const sale = (orderNumber ?? "").trim() || orderId;
  return `${sale}-${lineId.slice(0, 8)}`;
}

/** "27.34" -> 2734; "-1.5" -> -150; "" / junk -> null. Exact, no floats. */
export function dollarsToCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v !== "string") return null;
  const t = v.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,}))?$/.exec(t);
  if (!m) return null;
  const neg = m[1] === "-";
  const whole = Number(m[2]);
  const fracRaw = (m[3] ?? "").padEnd(3, "0");
  // round half up on the third decimal
  let cents = whole * 100 + Number(fracRaw.slice(0, 2));
  if (Number(fracRaw[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

/** "3" -> 3, "1.5" -> 1.5; junk -> null. */
function qtyOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Money a Sale row carries, in cents: qty x UnitPrice - Discount + taxes. */
export function filedRowMoneyMinor(payload: Record<string, unknown> | null | undefined): number | null {
  if (!payload) return null;
  const qty = qtyOf(payload.Quantity);
  const unit = dollarsToCents(payload.UnitPrice);
  const disc = dollarsToCents(payload.Discount ?? "0") ?? 0;
  const sales = dollarsToCents(payload.RetailSalesTax ?? payload.SalesTax ?? "0") ?? 0;
  const excise = dollarsToCents(payload.CannabisExciseTax ?? payload.OtherTax ?? "0") ?? 0;
  if (qty === null || unit === null) return null;
  return Math.round(qty * unit) - disc + sales + excise;
}

export function buildCompleteness(input: {
  lines: readonly SaleLineFact[];
  filed: readonly FiledRowFact[];
  held: readonly HeldFact[];
  readErrors?: readonly string[];
  weekLabel: string;
  /** False while the week is still running: unfiled lines are "pending", not missing. Default true. */
  weekEnded?: boolean;
}): Completeness {
  const weekEnded = input.weekEnded !== false;
  const readErrors = [...(input.readErrors ?? [])];
  const filedBy = new Map<string, FiledRowFact[]>();
  for (const f of input.filed) {
    const a = filedBy.get(f.detailId) ?? [];
    a.push(f);
    filedBy.set(f.detailId, a);
  }
  const heldBy = new Map<string, HeldFact>();
  for (const h of input.held) if (!heldBy.has(h.detailId)) heldBy.set(h.detailId, h);

  let excluded = 0;
  let takenMinor = 0;
  let takenFiledMinor = 0;
  let filedMinor = 0;
  let filedCount = 0;
  let unreadableRows = 0;
  const missingLines: SaleLineFact[] = [];
  const heldLines: Completeness["heldLines"] = [];
  const filedTwice: string[] = [];

  for (const l of input.lines) {
    if (l.excluded) {
      excluded++;
      continue;
    }
    takenMinor += l.moneyMinor;
    const rows = filedBy.get(l.detailId);
    if (rows && rows.length > 0) {
      filedCount++;
      if (rows.length > 1) filedTwice.push(l.detailId);
      const money = rows[0]!.moneyMinor;
      if (money === null) {
        unreadableRows++;
      } else {
        takenFiledMinor += l.moneyMinor;
        filedMinor += money;
      }
      continue;
    }
    const h = heldBy.get(l.detailId);
    if (h) {
      heldLines.push({ ...l, code: h.code, reason: h.reason });
      continue;
    }
    missingLines.push(l);
  }

  const lines = input.lines.length - excluded;
  const moneyDiffMinor = filedMinor - takenFiledMinor;
  const toleranceMinor = Math.max(0, filedCount - unreadableRows);
  const moneyOff = Math.abs(moneyDiffMinor) > toleranceMinor || unreadableRows > 0 || filedTwice.length > 0;

  let status: CompletenessStatus;
  if (readErrors.length > 0) status = "unknown";
  else if (moneyOff) status = "money";
  else if (missingLines.length > 0) status = weekEnded ? "missing" : "pending";
  else if (heldLines.length > 0) status = "held";
  else status = "complete";

  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  let headline: string;
  switch (status) {
    case "unknown":
      headline = `${input.weekLabel}: could not check every record (${readErrors[0]}). This is not an all clear.`;
      break;
    case "missing":
      headline = `${input.weekLabel}: ${missingLines.length} sale line${missingLines.length === 1 ? " is" : "s are"} in neither a CCRS file nor the held list. They must go in the next Sale file.`;
      break;
    case "pending":
      headline = `${input.weekLabel} is still running: ${missingLines.length} sale line${missingLines.length === 1 ? "" : "s"} not filed yet go in this week's Sale file. Nothing is late.`;
      break;
    case "money":
      headline =
        filedTwice.length > 0
          ? `${input.weekLabel}: ${filedTwice.length} sale line${filedTwice.length === 1 ? " is" : "s are"} in two live files. CCRS will refuse the second one.`
          : unreadableRows > 0
            ? `${input.weekLabel}: ${unreadableRows} filed row${unreadableRows === 1 ? "" : "s"} could not be read back. Check the file.`
            : `${input.weekLabel}: the filed money is ${money(Math.abs(moneyDiffMinor))} ${moneyDiffMinor > 0 ? "more" : "less"} than the register took for the same lines.`;
      break;
    case "held":
      headline = `${input.weekLabel}: every sale is filed or held for a reason; ${heldLines.length} held line${heldLines.length === 1 ? "" : "s"} still owe CCRS.`;
      break;
    default:
      headline = lines === 0 ? `${input.weekLabel}: no cannabis sales to report.` : `${input.weekLabel}: complete. ${lines} sale line${lines === 1 ? "" : "s"} filed and the money matches (${money(takenMinor)}).`;
  }

  return {
    status,
    lines,
    excluded,
    filed: filedCount,
    held: heldLines.length,
    missing: missingLines.length,
    takenMinor,
    takenFiledMinor,
    filedMinor,
    moneyDiffMinor,
    toleranceMinor,
    unreadableRows,
    missingLines,
    heldLines,
    filedTwice,
    headline,
    readErrors,
  };
}

// ---------------------------------------------------------------------------
// 2. Lot shortfalls
// ---------------------------------------------------------------------------

export type LotFact = {
  id: string;
  lotCode: string | null;
  /** ccrs_inventory_external_id (the id sales name). */
  ext: string | null;
  productKey: string | null;
  productName: string | null;
  status: string | null;
  received: number;
  onHand: number;
  /** Sum of every adjustment that is not "receive". */
  adjustments: number;
  /** Sum of NEGATIVE "count" adjustments (<= 0). */
  countRemoved: number;
};

export type LotSaleLine = {
  lineId: string;
  detailId: string;
  /** The CCRS lot the line names now. */
  ext: string;
  quantity: number;
  completedAt: string;
  /** CCRS Production already holds this line (a live prod Sale file has it). */
  filedInProd: boolean;
};

export type LotRecord = LotFact & { sold: number; record: number };

export type ShortfallCause = "wrong_lot" | "count" | "split" | "unknown";

export type MoveRepair = {
  kind: "move";
  lineId: string;
  detailId: string;
  quantity: number;
  fromLotId: string;
  fromExt: string;
  toLotId: string;
  toExt: string;
  toLotCode: string | null;
  sameProductKey: boolean;
};

export type CountRepair = { kind: "count"; lotId: string; ext: string; quantity: number };

export type Shortfall = {
  lot: LotRecord;
  /** Units sold beyond the record (positive). */
  short: number;
  cause: ShortfallCause;
  repair: MoveRepair | CountRepair | null;
  /** Lines on this lot that CCRS Production already holds (cannot be moved here). */
  lockedLines: number;
  sentence: string;
  fix: string;
};

const EPS = 1e-9;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** received + adjustments - sold, per lot (sold matched by the CCRS lot id). */
export function lotRecords(lots: readonly LotFact[], sales: readonly LotSaleLine[]): LotRecord[] {
  const soldBy = new Map<string, number>();
  for (const s of sales) soldBy.set(s.ext, (soldBy.get(s.ext) ?? 0) + s.quantity);
  return lots.map((l) => {
    const sold = l.ext ? (soldBy.get(l.ext) ?? 0) : 0;
    return { ...l, sold, record: l.received + l.adjustments - sold };
  });
}

/** Units the register already took from this lot without the record knowing (record - onHand, floored at 0). */
export function drawnUnrecorded(l: LotRecord): number {
  return Math.max(0, l.record - l.onHand);
}

/**
 * A move is clean (changes no stock) when the line fits inside BOTH gaps:
 * the source's shortfall and the target's units-already-drawn.
 */
export function cleanMoveFits(quantity: number, short: number, targetDrawn: number): boolean {
  return quantity > 0 && quantity <= short + EPS && quantity <= targetDrawn + EPS;
}

export function diagnoseShortfalls(lots: readonly LotFact[], sales: readonly LotSaleLine[]): Shortfall[] {
  const recs = lotRecords(lots, sales);
  const byKey = new Map<string, LotRecord[]>();
  const byName = new Map<string, LotRecord[]>();
  for (const r of recs) {
    if (r.productKey) byKey.set(r.productKey, [...(byKey.get(r.productKey) ?? []), r]);
    const n = norm(r.productName);
    if (n) byName.set(n, [...(byName.get(n) ?? []), r]);
  }
  const linesBy = new Map<string, LotSaleLine[]>();
  for (const s of sales) linesBy.set(s.ext, [...(linesBy.get(s.ext) ?? []), s]);

  const out: Shortfall[] = [];
  for (const lot of recs) {
    if (lot.record >= -EPS || !lot.ext) continue;
    const short = -lot.record;
    const lines = [...(linesBy.get(lot.ext) ?? [])].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const movable = lines.filter((x) => !x.filedInProd);
    const lockedLines = lines.length - movable.length;

    // Candidate targets: same product key first, then same product name.
    const sameKey = (lot.productKey ? byKey.get(lot.productKey) ?? [] : []).filter((x) => x.id !== lot.id);
    const sameName = (byName.get(norm(lot.productName)) ?? []).filter((x) => x.id !== lot.id && !sameKey.includes(x));
    const targets = [...sameKey, ...sameName].filter((t) => t.ext && t.status !== "quarantine" && drawnUnrecorded(t) > EPS);

    let repair: MoveRepair | CountRepair | null = null;
    // wrong lot: newest line that fits a target cleanly.
    outer: for (const line of movable) {
      for (const t of targets) {
        if (cleanMoveFits(line.quantity, short, drawnUnrecorded(t))) {
          repair = {
            kind: "move",
            lineId: line.lineId,
            detailId: line.detailId,
            quantity: line.quantity,
            fromLotId: lot.id,
            fromExt: lot.ext,
            toLotId: t.id,
            toExt: t.ext as string,
            toLotCode: t.lotCode,
            sameProductKey: sameKey.includes(t),
          };
          break outer;
        }
      }
    }
    const name = lot.productName ?? lot.lotCode ?? lot.ext;
    const u = (n: number) => `${n} unit${n === 1 ? "" : "s"}`;
    if (repair && repair.kind === "move") {
      out.push({
        lot,
        short,
        cause: "wrong_lot",
        repair,
        lockedLines,
        sentence: `${name} (lot ${lot.lotCode ?? lot.ext}) sold ${u(short)} more than it ever had. Sibling lot ${repair.toLotCode ?? repair.toExt} is short by the same units on its shelf, so the register drew them from there.`,
        fix: `Move sale line ${repair.detailId} (${u(repair.quantity)}) to lot ${repair.toLotCode ?? repair.toExt}. No stock changes; both records then match their shelves.`,
      });
      continue;
    }
    // count: a count removed at least the shortfall and the shelf is empty.
    if (-lot.countRemoved + EPS >= short && lot.onHand <= EPS) {
      repair = { kind: "count", lotId: lot.id, ext: lot.ext, quantity: short };
      out.push({
        lot,
        short,
        cause: "count",
        repair,
        lockedLines,
        sentence: `${name} (lot ${lot.lotCode ?? lot.ext}): a cycle count took away ${u(-lot.countRemoved)}, but the sales show ${u(short)} of those were really sold.`,
        fix: `Correct the count by +${u(short)}. The shelf stays at 0; the record goes from -${short} to 0 and CCRS gets the matching Reconciliation.`,
      });
      continue;
    }
    // split: siblings drew enough in total, but no single line fits.
    const totalDrawn = targets.reduce((s, t) => s + drawnUnrecorded(t), 0);
    if (totalDrawn + EPS >= short && lines.length > 0) {
      out.push({
        lot,
        short,
        cause: "split",
        repair: null,
        lockedLines,
        sentence: `${name} (lot ${lot.lotCode ?? lot.ext}): one sale line took units from two lots. CCRS needs one lot per line.`,
        fix: `Split the line with a Sale correction (one line per lot). This one is done by hand; nothing automatic changes a sale.`,
      });
      continue;
    }
    out.push({
      lot,
      short,
      cause: "unknown",
      repair: null,
      lockedLines,
      sentence: `${name} (lot ${lot.lotCode ?? lot.ext}) sold ${u(short)} more than it ever had, and no count or sibling lot explains it.`,
      fix: `Count the shelf and look for stock received under a different product. Then record what you find; never add stock that is not there.`,
    });
  }
  return out.sort((a, b) => b.short - a.short);
}

/** Lots whose on-hand is above what was received (CCRS refuses on-hand above initial). */
export function aboveReceived(lots: readonly LotFact[]): LotFact[] {
  return lots.filter((l) => l.onHand > l.received + EPS);
}

/**
 * Re-check a move against fresh facts right before it is written (the page's
 * numbers may be minutes old). Returns null when safe, else the reason.
 */
export function checkMove(r: MoveRepair, lots: readonly LotFact[], sales: readonly LotSaleLine[]): string | null {
  const fresh = diagnoseShortfalls(lots, sales).find((s) => s.lot.id === r.fromLotId);
  if (!fresh) return "That lot is no longer short. Nothing to repair.";
  const line = sales.find((s) => s.lineId === r.lineId);
  if (!line) return "That sale line was not found.";
  if (line.ext !== r.fromExt) return "That sale line already names a different lot.";
  if (line.filedInProd) return "CCRS Production already holds this sale line. Use the Sale correction download instead.";
  const recs = lotRecords(lots, sales);
  const to = recs.find((x) => x.id === r.toLotId);
  if (!to || !to.ext || to.ext !== r.toExt) return "The target lot was not found.";
  if (to.status === "quarantine") return "The target lot is on quarantine hold.";
  if (!cleanMoveFits(line.quantity, fresh.short, drawnUnrecorded(to))) return "The move no longer fits without changing stock. Reload the page.";
  return null;
}

export function checkCount(r: CountRepair, lots: readonly LotFact[], sales: readonly LotSaleLine[]): string | null {
  const fresh = diagnoseShortfalls(lots, sales).find((s) => s.lot.id === r.lotId);
  if (!fresh) return "That lot is no longer short. Nothing to repair.";
  if (fresh.cause !== "count" || fresh.repair?.kind !== "count") return "A count correction is no longer the right fix for this lot. Reload the page.";
  if (Math.abs(fresh.short - r.quantity) > EPS) return "The shortfall changed. Reload the page.";
  return null;
}

/** The note written on a count correction (no commas: CCRS splits on them). */
export function countRepairNote(quantity: number, ext: string): string {
  return `D183 lot repair: sales show ${quantity} unit(s) of ${ext} were sold after the count took them away; this corrects the count. Shelf unchanged.`;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runCcrsCompletenessTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: unknown, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("ccrs-completeness-core FAIL:", m);
    }
  };

  // ids + money parsing
  ok(saleDetailId("GWY-9RJT52", "o1", "0010cafe-aaaa") === "GWY-9RJT52-0010cafe", "detail id from order number");
  ok(saleDetailId("", "order-uuid", "abcdef123456") === "order-uuid-abcdef12", "detail id falls back to order id");
  ok(dollarsToCents("27.34") === 2734, "27.34");
  ok(dollarsToCents("0") === 0 && dollarsToCents("5") === 500, "whole dollars");
  ok(dollarsToCents("1.5") === 150, "one decimal");
  ok(dollarsToCents("-2.10") === -210, "negative");
  ok(dollarsToCents("1.005") === 101, "third decimal rounds half up");
  ok(dollarsToCents("abc") === null && dollarsToCents("") === null && dollarsToCents(null) === null, "junk is null");
  const payload = { Quantity: "1", UnitPrice: "27.34", Discount: "9.11", RetailSalesTax: "1.70", CannabisExciseTax: "6.75" };
  ok(filedRowMoneyMinor(payload) === 2734 - 911 + 170 + 675, "row money = qty x unit - discount + taxes");
  ok(filedRowMoneyMinor({ Quantity: "2", UnitPrice: "8.20", Discount: "4.24", RetailSalesTax: "1.14", CannabisExciseTax: "4.50" }) === 1640 - 424 + 114 + 450, "row money qty 2");
  ok(filedRowMoneyMinor({ Quantity: "x", UnitPrice: "1" }) === null, "unreadable qty is null");
  ok(filedRowMoneyMinor(null) === null, "no payload is null");

  // completeness
  const L = (id: string, money: number, extra: Partial<SaleLineFact> = {}): SaleLineFact => ({
    detailId: id,
    orderNumber: id.split("-").slice(0, 2).join("-"),
    day: "2026-11-01",
    quantity: 1,
    moneyMinor: money,
    excluded: false,
    ...extra,
  });
  const F = (id: string, money: number | null, file = "Sale_1.csv"): FiledRowFact => ({ detailId: id, fileName: file, fileState: "emitted", moneyMinor: money });
  const wk = "Week of Nov 1";
  const all = buildCompleteness({ lines: [L("A-1", 1000), L("A-2", 2000)], filed: [F("A-1", 1001), F("A-2", 1999)], held: [], weekLabel: wk });
  ok(all.status === "complete", "all filed, money within a cent per line = complete");
  ok(all.filed === 2 && all.missing === 0 && all.takenMinor === 3000, "counts and money");
  ok(/complete/.test(all.headline), "complete headline");
  const off = buildCompleteness({ lines: [L("A-1", 1000), L("A-2", 2000)], filed: [F("A-1", 1000), F("A-2", 1500)], held: [], weekLabel: wk });
  ok(off.status === "money" && off.moneyDiffMinor === -500, "money short is flagged");
  ok(/less than the register took/.test(off.headline), "money headline says less");
  const miss = buildCompleteness({ lines: [L("A-1", 1000), L("A-2", 2000), L("A-3", 500)], filed: [F("A-1", 1000)], held: [{ detailId: "A-2", code: "E56", reason: "product not in menu" }], weekLabel: wk });
  ok(miss.status === "missing" && miss.missing === 1 && miss.held === 1 && miss.filed === 1, "filed / held / missing are split");
  ok(miss.missingLines[0]!.detailId === "A-3", "the missing line is named");
  ok(miss.heldLines[0]!.reason === "product not in menu", "held line keeps its reason");
  const pend = buildCompleteness({ lines: [L("A-1", 1000), L("A-3", 500)], filed: [F("A-1", 1000)], held: [], weekLabel: wk, weekEnded: false });
  ok(pend.status === "pending" && /Nothing is late/.test(pend.headline), "unfiled lines in a running week are pending, not missing");
  const pendMoney = buildCompleteness({ lines: [L("A-1", 1000), L("A-3", 500)], filed: [F("A-1", 700)], held: [], weekLabel: wk, weekEnded: false });
  ok(pendMoney.status === "money", "a money gap shows even while the week runs");
  const held = buildCompleteness({ lines: [L("A-1", 1000), L("A-2", 2000)], filed: [F("A-1", 1000)], held: [{ detailId: "A-2", code: "E56", reason: "r" }], weekLabel: wk });
  ok(held.status === "held", "nothing missing but some held = held (not complete)");
  const ex = buildCompleteness({ lines: [L("A-1", 1000), L("N-1", 900, { excluded: true })], filed: [F("A-1", 1000)], held: [], weekLabel: wk });
  ok(ex.status === "complete" && ex.excluded === 1 && ex.lines === 1 && ex.takenMinor === 1000, "non-cannabis lines are excluded, not missing");
  const twice = buildCompleteness({ lines: [L("A-1", 1000)], filed: [F("A-1", 1000, "a.csv"), F("A-1", 1000, "b.csv")], held: [], weekLabel: wk });
  ok(twice.status === "money" && twice.filedTwice.length === 1, "a line in two live files is flagged");
  const unread = buildCompleteness({ lines: [L("A-1", 1000)], filed: [F("A-1", null)], held: [], weekLabel: wk });
  ok(unread.status === "money" && unread.unreadableRows === 1, "unreadable filed row is flagged");
  const err = buildCompleteness({ lines: [], filed: [], held: [], readErrors: ["orders: timeout"], weekLabel: wk });
  ok(err.status === "unknown" && /not an all clear/.test(err.headline), "a read error is never complete");
  const none = buildCompleteness({ lines: [], filed: [], held: [], weekLabel: wk });
  ok(none.status === "complete" && /no cannabis sales/.test(none.headline), "empty week says so");

  // lot shortfalls
  const lot = (id: string, o: Partial<LotFact>): LotFact => ({
    id,
    lotCode: id,
    ext: `X${id}`,
    productKey: "pk",
    productName: "Thing",
    status: "active",
    received: 0,
    onHand: 0,
    adjustments: 0,
    countRemoved: 0,
    ...o,
  });
  const sale = (lineId: string, ext: string, q: number, o: Partial<LotSaleLine> = {}): LotSaleLine => ({
    lineId,
    detailId: `D-${lineId}`,
    ext,
    quantity: q,
    completedAt: `2026-11-01T1${lineId.length}:00:00Z`,
    filedInProd: false,
    ...o,
  });
  // wrong lot: A received 3, count -1, sold 1+2 -> record -1; B received 16 adj -3 sold 3, onHand 9 -> drawn 1.
  const lotsW = [lot("A", { received: 3, adjustments: -1, countRemoved: -1 }), lot("B", { received: 16, adjustments: -3, countRemoved: -3, onHand: 9 })];
  const salesW = [sale("a1", "XA", 1), sale("a22", "XA", 2), sale("b1", "XB", 3)];
  const recs = lotRecords(lotsW, salesW);
  ok(recs.find((r) => r.id === "A")!.record === -1 && recs.find((r) => r.id === "B")!.record === 10, "records = received + adj - sold");
  const sW = diagnoseShortfalls(lotsW, salesW);
  ok(sW.length === 1 && sW[0]!.cause === "wrong_lot", "sibling drawn below record = wrong lot (beats the count)");
  const mv = sW[0]!.repair as MoveRepair;
  ok(mv.kind === "move" && mv.lineId === "a1" && mv.toLotId === "B" && mv.quantity === 1, "moves the line that fits (qty 1), not the qty-2 line");
  ok(mv.sameProductKey === true, "same product key flagged");
  ok(checkMove(mv, lotsW, salesW) === null, "fresh check passes");
  // after the move both records match their shelves
  const moved = salesW.map((s) => (s.lineId === "a1" ? { ...s, ext: "XB" } : s));
  const after = lotRecords(lotsW, moved);
  ok(after.find((r) => r.id === "A")!.record === 0 && after.find((r) => r.id === "B")!.record === 9, "after the move: A 0 = shelf 0, B 9 = shelf 9");
  ok(diagnoseShortfalls(lotsW, moved).length === 0, "no shortfall after the move");
  ok(checkMove(mv, lotsW, moved) !== null, "a second press is refused (no longer short)");
  ok(checkMove(mv, lotsW, salesW.map((s) => (s.lineId === "a1" ? { ...s, filedInProd: true } : s))) !== null, "a line CCRS Production holds is never moved");
  ok(checkMove(mv, [lotsW[0]!, { ...lotsW[1]!, status: "quarantine" }], salesW) !== null, "never moves onto a quarantined lot");
  // locked line is skipped for the move
  const sLocked = diagnoseShortfalls(lotsW, salesW.map((s) => (s.lineId === "a1" ? { ...s, filedInProd: true } : s)));
  ok(sLocked[0]!.cause !== "wrong_lot" && sLocked[0]!.lockedLines === 1, "a prod-filed line is not offered for a move");
  ok(sLocked[0]!.cause === "count", "falls back to the count fix when the count explains it and the shelf is empty");

  // count: received 4, count -1, sold 4, no sibling
  const lotsC = [lot("C", { productKey: "pc", productName: "Vape", received: 4, adjustments: -1, countRemoved: -1 })];
  const salesC = [sale("c1", "XC", 2), sale("c22", "XC", 2)];
  const sC = diagnoseShortfalls(lotsC, salesC);
  ok(sC.length === 1 && sC[0]!.cause === "count" && (sC[0]!.repair as CountRepair).quantity === 1, "count fix of exactly the shortfall");
  ok(checkCount(sC[0]!.repair as CountRepair, lotsC, salesC) === null, "count check passes");
  const lotsC2 = [{ ...lotsC[0]!, adjustments: 0 }];
  ok(checkCount(sC[0]!.repair as CountRepair, lotsC2, salesC) !== null, "count fix refused once the record is whole");
  ok(diagnoseShortfalls([{ ...lotsC[0]!, onHand: 2 }], salesC)[0]!.cause !== "count", "no count fix when the shelf is not empty");
  ok(!countRepairNote(1, "X1").includes(","), "count note has no commas");

  // split: A received 1 sold 6 in one line; B received 5 onHand 0 -> drawn 5.
  const lotsS = [lot("S1", { productKey: "ps", received: 1 }), lot("S2", { productKey: "ps", received: 5 })];
  const salesS = [sale("s6", "XS1", 6)];
  const sS = diagnoseShortfalls(lotsS, salesS);
  ok(sS.length === 1 && sS[0]!.cause === "split" && sS[0]!.repair === null, "one line drawn from two lots = split, by hand");

  // unknown
  const sU = diagnoseShortfalls([lot("U", { productKey: "pu", productName: "Lonely", received: 1 })], [sale("u1", "XU", 3)]);
  ok(sU.length === 1 && sU[0]!.cause === "unknown" && sU[0]!.repair === null, "nothing explains it = unknown, count the shelf");
  ok(/never add stock/.test(sU[0]!.fix), "unknown fix never invents stock");

  // same product name, different key
  const lotsN = [lot("N1", { productKey: "k1", productName: "Gummy  Bears", received: 1 }), lot("N2", { productKey: "k2", productName: "gummy bears", received: 4, onHand: 2 })];
  const sN = diagnoseShortfalls(lotsN, [sale("n1", "XN1", 1), sale("n22", "XN1", 1), sale("n333", "XN2", 1)]);
  ok(sN[0]!.cause === "wrong_lot" && (sN[0]!.repair as MoveRepair).sameProductKey === false, "same product name under another key is a candidate");

  // clean-move rule
  ok(cleanMoveFits(1, 1, 1) && !cleanMoveFits(2, 1, 5) && !cleanMoveFits(1, 1, 0) && !cleanMoveFits(0, 1, 1), "clean move fits both gaps");
  // above received
  ok(aboveReceived([lot("E", { received: 1, onHand: 9 }), lot("F", { received: 5, onHand: 5 })]).map((l) => l.id).join() === "E", "on-hand above received is listed");
  // healthy lots are quiet
  ok(diagnoseShortfalls([lot("H", { received: 5, onHand: 3 })], [sale("h1", "XH", 2)]).length === 0, "a healthy lot is not a shortfall");

  return { passed, failed };
}

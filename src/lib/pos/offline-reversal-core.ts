/**
 * src/lib/pos/offline-reversal-core.ts — D170 O2 (voids) + O3 (returns)
 * offline. Owner 2026-11-04: "finish all remaining offline mode tasks ... I
 * want to make sure we are fully hardened and prepared for any situation."
 *
 * PURE. With no server, the register can still void a same-day sale or take
 * a return, as long as the sale was rung on THIS iPad (it keeps a small,
 * encrypted SALE BOOK of its own recent sales, fed by its own event queue).
 *
 *   - The iPad applies the same gates the server would (same Pacific day for
 *     a void; the owner's return window, product types, loyalty toggle and
 *     remaining quantity for a return) against the saved copy, and a manager
 *     or lead PIN checked on the iPad (D161 vault) approves.
 *   - The reversal is queued as ONE `reversal` event (migration 0341). At
 *     sync the server re-runs the REAL void / return machinery, judged at the
 *     time the cash actually moved, re-checks the approver against who is a
 *     manager or lead NOW, and anything doubtful becomes a manager exception
 *     (the cash already went back, so nothing is ever silently dropped).
 *   - A void of a sale the server never accepted cancels cleanly: no order,
 *     no stock and no points ever moved, so nothing needs reversing.
 *
 * The refund is always the stored price paid (never typed). A sale rung on
 * another register is not in this book and stays online-only.
 */
import { pacificDayKey } from "@/lib/reports/timezone";
import { lineNotReturnableReason, lookupWindowDays, type PosReturnPolicyConfig } from "./return-policy-core";
import { returnWindowVerdict } from "./returns-core";

export const SALE_BOOK_VERSION = 1;
/** A busy week is a few thousand sales; the copy is bounded well above. */
export const SALE_BOOK_MAX_SALES = 6000;

export type SaleBookLine = {
  productId: string;
  variantId?: string;
  productName: string;
  category: string | null;
  quantity: number;
  /** FINAL per-unit price paid, cents (what order_lines.price_minor_units stores). */
  unitPriceMinor: number;
  /** Units already reversed on this iPad (void = all, return = some). */
  reversed: number;
};

export type SaleBookEntry = {
  /** clientUuid of the sale event = the receipt (last 8, upper). */
  id: string;
  at: string;
  totalMinor: number;
  memberLabel: string | null;
  hasMember: boolean;
  lines: SaleBookLine[];
  voided?: true;
};

export type SaleBook = { v: number; registerId: string; sales: SaleBookEntry[] };

function int(v: unknown): number | null {
  return Number.isInteger(v) ? (v as number) : null;
}

/** The receipt number the customer holds (mirrors receiptNumber()). */
export function bookReceipt(id: string): string {
  return id.replace(/-/g, "").slice(-8).toUpperCase();
}

/** One sale's book entry from the queued sale payload (or null if unusable). */
export function entryFromSalePayload(clientUuid: string, atIso: string, payload: Record<string, unknown>): SaleBookEntry | null {
  const total = int(payload.totalMinor);
  if (!Array.isArray(payload.lines) || total === null || total < 0) return null;
  const lines: SaleBookLine[] = [];
  for (const raw of payload.lines as unknown[]) {
    if (!raw || typeof raw !== "object") return null;
    const l = raw as Record<string, unknown>;
    const qty = int(l.quantity);
    const price = int(l.unitPriceMinor);
    if (typeof l.productId !== "string" || typeof l.productName !== "string" || qty === null || qty < 1 || price === null || price < 0) return null;
    lines.push({
      productId: l.productId,
      ...(typeof l.variantId === "string" && l.variantId ? { variantId: l.variantId } : {}),
      productName: l.productName.slice(0, 200),
      category: typeof l.category === "string" ? l.category : null,
      quantity: qty,
      unitPriceMinor: price,
      reversed: 0,
    });
  }
  if (lines.length === 0) return null;
  const loyalty = payload.loyalty && typeof payload.loyalty === "object" ? (payload.loyalty as Record<string, unknown>) : null;
  const memberLabel = loyalty && typeof loyalty.memberLabel === "string" ? loyalty.memberLabel.slice(0, 80) : null;
  return { id: clientUuid, at: atIso, totalMinor: total, memberLabel, hasMember: !!(loyalty && typeof loyalty.customerId === "string"), lines };
}

/** Add a sale; drop sales older than the return look-back; dedupe; bound. */
export function addSaleToBook(
  book: SaleBook | null,
  registerId: string,
  entry: SaleBookEntry,
  policy: PosReturnPolicyConfig,
  nowMs: number,
): SaleBook {
  const base = book && book.registerId === registerId ? book : { v: SALE_BOOK_VERSION, registerId, sales: [] };
  const cutoff = nowMs - (lookupWindowDays(policy) + 1) * 86_400_000;
  const kept = base.sales.filter((s) => Date.parse(s.at) >= cutoff && s.id !== entry.id);
  const sales = [...kept, entry];
  return { v: SALE_BOOK_VERSION, registerId, sales: sales.slice(Math.max(0, sales.length - SALE_BOOK_MAX_SALES)) };
}

export function parseSaleBook(raw: string | null | undefined): SaleBook | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o?.v !== SALE_BOOK_VERSION || typeof o.registerId !== "string" || !Array.isArray(o.sales)) return null;
    const sales: SaleBookEntry[] = [];
    for (const s of o.sales as unknown[]) {
      if (!s || typeof s !== "object") continue;
      const e = s as Record<string, unknown>;
      if (typeof e.id !== "string" || typeof e.at !== "string" || !Array.isArray(e.lines)) continue;
      const rebuilt = entryFromSalePayload(e.id, e.at, { totalMinor: e.totalMinor, lines: e.lines, loyalty: e.hasMember ? { customerId: "x", memberLabel: e.memberLabel ?? undefined } : undefined });
      if (!rebuilt) continue;
      rebuilt.memberLabel = typeof e.memberLabel === "string" ? e.memberLabel : null;
      (e.lines as Record<string, unknown>[]).forEach((l, i) => {
        const r = int(l?.reversed);
        if (rebuilt.lines[i] && r !== null && r > 0) rebuilt.lines[i].reversed = Math.min(r, rebuilt.lines[i].quantity);
      });
      if (e.voided === true) rebuilt.voided = true;
      sales.push(rebuilt);
      if (sales.length >= SALE_BOOK_MAX_SALES) break;
    }
    return { v: SALE_BOOK_VERSION, registerId: o.registerId, sales };
  } catch {
    return null;
  }
}

/** Find a sale by the printed receipt number (case-insensitive). */
export function findBookSale(book: SaleBook | null, receipt: string): SaleBookEntry | null {
  const want = receipt.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (want.length !== 8 || !book) return null;
  for (let i = book.sales.length - 1; i >= 0; i--) if (bookReceipt(book.sales[i].id) === want) return book.sales[i];
  return null;
}

/** Same gates as evaluateVoidEligibility, against the saved copy. */
export function offlineVoidCheck(sale: SaleBookEntry, nowIso: string): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (sale.voided) errors.push("This sale has already been voided on this iPad.");
  if (sale.lines.some((l) => l.reversed > 0) && !sale.voided) {
    errors.push("Part of this sale was already returned \u2014 voiding now would refund the same items twice. Process the rest as a return instead.");
  }
  if (pacificDayKey(sale.at) !== pacificDayKey(nowIso)) {
    errors.push("Voids are same-day only (Pacific business day). For an earlier sale, use Return an item.");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Same sale-level gates as evaluateReturnEligibility, against the saved copy. */
export function offlineReturnCheck(
  sale: SaleBookEntry,
  policy: PosReturnPolicyConfig,
  nowIso: string,
): { ok: true; daysRemaining: number } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (sale.voided) errors.push("This sale was voided, so there is nothing to return.");
  if (policy.loyaltyRequired && !sale.hasMember) {
    errors.push("This sale has no loyalty member on it, and our store policy only allows returns on loyalty purchases. Please politely refuse the return.");
  }
  const w = returnWindowVerdict(sale.at, nowIso, policy.windowDays);
  if (!w.ok) errors.push(w.error);
  if (errors.length) return { ok: false, errors };
  return { ok: true, daysRemaining: (w as { daysRemaining: number }).daysRemaining };
}

/** Why one line cannot come back, or null (product type, nothing left). */
export function offlineLineBlock(policy: PosReturnPolicyConfig, line: SaleBookLine, quantity: number): string | null {
  const type = lineNotReturnableReason(policy, line.category);
  if (type) return type;
  const left = line.quantity - line.reversed;
  if (left < 1) return "Everything on this line has already been returned.";
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > left) return `Only ${left} of this item can still be returned.`;
  return null;
}

export function markVoided(book: SaleBook, id: string): SaleBook {
  return { ...book, sales: book.sales.map((s) => (s.id === id ? { ...s, voided: true, lines: s.lines.map((l) => ({ ...l, reversed: l.quantity })) } : s)) };
}

export function markReturned(book: SaleBook, id: string, lineIndex: number, quantity: number): SaleBook {
  return {
    ...book,
    sales: book.sales.map((s) =>
      s.id === id ? { ...s, lines: s.lines.map((l, i) => (i === lineIndex ? { ...l, reversed: Math.min(l.quantity, l.reversed + quantity) } : l)) } : s,
    ),
  };
}

// ---------------------------------------------------------------------------
// The queued event
// ---------------------------------------------------------------------------

export const REVERSAL_RETURN_REASONS = ["defective", "wrong_item", "adverse_reaction", "quality", "mislabeled", "other"] as const;
const REASONS = new Set(["offline", "timeout", "network", "server_error"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PosReversalPayload = {
  kind: "void" | "return";
  /** clientUuid of the sale being reversed. */
  saleClientUuid: string;
  offlineReason: "offline" | "timeout" | "network" | "server_error";
  /** The manager/lead whose PIN was checked on the iPad (re-judged at sync). */
  approver: { employeeId: string; fullName: string };
  processedByName: string;
  /** Cash handed back, cents (the stored price paid). */
  refundMinor: number;
  /** The drawer the cash came out of on this iPad (null = none known). */
  drawerSessionId: string | null;
  /** void: the written reason. */
  reason?: string;
  /** return only. */
  line?: { index: number; productId: string; variantId?: string; productName: string; unitPriceMinor: number; quantity: number };
  returnReason?: (typeof REVERSAL_RETURN_REASONS)[number];
  detail?: string;
  disposition?: "restock" | "destroy";
  originalPackaging?: boolean;
  lotIdLegible?: boolean;
};

/** Validate a queued reversal (both sides run this). */
export function validateReversalPayload(raw: unknown): { ok: true; payload: PosReversalPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["Payload must be an object."] };
  const p = raw as Record<string, unknown>;
  if (p.kind !== "void" && p.kind !== "return") errors.push("kind must be void or return.");
  if (typeof p.saleClientUuid !== "string" || !UUID_RE.test(p.saleClientUuid)) errors.push("saleClientUuid must be a UUID.");
  if (typeof p.offlineReason !== "string" || !REASONS.has(p.offlineReason)) errors.push("offlineReason is not valid.");
  const a = p.approver as Record<string, unknown> | undefined;
  if (!a || typeof a.employeeId !== "string" || !UUID_RE.test(a.employeeId) || typeof a.fullName !== "string") errors.push("approver is required.");
  if (typeof p.processedByName !== "string") errors.push("processedByName is required.");
  if (!Number.isInteger(p.refundMinor) || (p.refundMinor as number) < 0) errors.push("refundMinor must be whole cents.");
  if (p.drawerSessionId !== null && (typeof p.drawerSessionId !== "string" || !UUID_RE.test(p.drawerSessionId))) errors.push("drawerSessionId must be a UUID or null.");
  if (p.kind === "void") {
    const r = typeof p.reason === "string" ? p.reason.trim() : "";
    if (r.length < 3 || r.length > 500) errors.push("A void needs a reason (3\u2013500 characters).");
  }
  if (p.kind === "return") {
    const l = p.line as Record<string, unknown> | undefined;
    if (
      !l || !Number.isInteger(l.index) || (l.index as number) < 0 || typeof l.productId !== "string" || typeof l.productName !== "string" ||
      !Number.isInteger(l.unitPriceMinor) || (l.unitPriceMinor as number) < 0 || !Number.isInteger(l.quantity) || (l.quantity as number) < 1
    ) {
      errors.push("A return needs the line (index, product, price, quantity).");
    } else if (Number.isInteger(p.refundMinor) && (l.unitPriceMinor as number) * (l.quantity as number) !== p.refundMinor) {
      errors.push("The refund must equal the price paid times the quantity.");
    }
    if (!REVERSAL_RETURN_REASONS.includes(p.returnReason as (typeof REVERSAL_RETURN_REASONS)[number])) errors.push("Pick a valid return reason.");
    if (p.disposition !== "restock" && p.disposition !== "destroy") errors.push("Pick restock or destroy.");
    if (p.originalPackaging !== true || p.lotIdLegible !== true) errors.push("Both state-law attestations (original packaging, legible lot ID) are required.");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: p as unknown as PosReversalPayload };
}

/** The tag stamped on the server rows a reversal writes (replay guard). */
export function reversalTag(clientUuid: string): string {
  return `[offline ${clientUuid}]`;
}

/**
 * Pick the order line an offline return names. The iPad knows the line by
 * position, product and price; order_lines rows are written in one insert,
 * so match product + price (+ variant) and prefer one with units left.
 */
export function matchOrderLine<T extends { id: string; product_id: string | null; variant_id?: string | null; price_minor_units: number; remaining: number }>(
  rows: T[],
  line: NonNullable<PosReversalPayload["line"]>,
): T | null {
  const same = rows.filter(
    (r) => r.product_id === line.productId && r.price_minor_units === line.unitPriceMinor && (!line.variantId || !r.variant_id || r.variant_id === line.variantId),
  );
  return same.find((r) => r.remaining >= line.quantity) ?? same[0] ?? null;
}

/** The plain message the manager reads on any reversal exception. */
export function reversalExceptionReason(p: PosReversalPayload, why: string): string {
  const what = p.kind === "void" ? "void" : "return";
  return `Offline ${what} of receipt ${bookReceipt(p.saleClientUuid)}: ${why} The cash ($${(p.refundMinor / 100).toFixed(2)}) was already handed back at the counter, approved by ${p.approver.fullName}. Review it.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runOfflineReversalCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("offline-reversal-core FAIL:", m);
    }
  };
  const policy: PosReturnPolicyConfig = { loyaltyRequired: false, windowDays: 7, excludedCategories: ["edibles"] };
  const sid = "11111111-2222-4333-8444-555566667777";
  const at = "2026-11-04T19:00:00.000Z";
  const now = Date.parse(at) + 3_600_000;
  const pay = {
    totalMinor: 3000,
    lines: [
      { productId: "p1", productName: "Flower", category: "flower", quantity: 2, unitPriceMinor: 1000 },
      { productId: "p2", productName: "Gummy", category: "edibles", quantity: 1, unitPriceMinor: 1000 },
    ],
    loyalty: { customerId: "c1", memberLabel: "Sam K." },
  };
  const e = entryFromSalePayload(sid, at, pay)!;
  ok(!!e && e.lines.length === 2 && e.hasMember && e.memberLabel === "Sam K.", "entry from a sale payload");
  ok(entryFromSalePayload(sid, at, { totalMinor: 1, lines: [] }) === null, "no lines is unusable");
  ok(bookReceipt(sid) === "66667777", "receipt is the last 8");
  let book = addSaleToBook(null, "r1", e, policy, now);
  book = addSaleToBook(book, "r1", e, policy, now);
  ok(book.sales.length === 1, "a sale is kept once");
  const old = entryFromSalePayload("aaaaaaaa-2222-4333-8444-000000000001", "2026-10-01T19:00:00.000Z", pay)!;
  ok(addSaleToBook(addSaleToBook(null, "r1", old, policy, now), "r1", e, policy, now).sales.length === 1, "sales past the look-back drop off");
  ok(addSaleToBook(book, "r2", e, policy, now).registerId === "r2", "re-paired register starts fresh");
  ok(findBookSale(book, "6666-7777")?.id === sid && findBookSale(book, "00000000") === null, "find by receipt");
  ok(offlineVoidCheck(e, new Date(now).toISOString()).ok, "same-day void allowed");
  ok(!offlineVoidCheck(e, "2026-11-06T19:00:00.000Z").ok, "next-day void refused");
  const voided = markVoided(book, sid);
  ok(!offlineVoidCheck(voided.sales[0], new Date(now).toISOString()).ok, "double void refused");
  ok(offlineReturnCheck(e, policy, "2026-11-08T19:00:00.000Z").ok, "return inside the window");
  ok(!offlineReturnCheck(e, policy, "2026-11-20T19:00:00.000Z").ok, "return past the window refused");
  ok(!offlineReturnCheck({ ...e, hasMember: false }, { ...policy, loyaltyRequired: true }, at).ok, "loyalty-only policy enforced");
  ok(offlineLineBlock(policy, e.lines[1], 1) !== null, "excluded product type refused");
  ok(offlineLineBlock(policy, e.lines[0], 2) === null && offlineLineBlock(policy, e.lines[0], 3) !== null, "quantity bound");
  const ret = markReturned(book, sid, 0, 1);
  ok(ret.sales[0].lines[0].reversed === 1 && offlineLineBlock(policy, ret.sales[0].lines[0], 2) !== null, "partial return reduces what is left");
  ok(!offlineVoidCheck(ret.sales[0], new Date(now).toISOString()).ok, "void after a partial return refused");
  const round = parseSaleBook(JSON.stringify(ret))!;
  ok(round.sales[0].lines[0].reversed === 1 && round.sales[0].memberLabel === "Sam K." && round.sales[0].hasMember, "round trip keeps state");
  ok(parseSaleBook("{x") === null && parseSaleBook(JSON.stringify({ v: 9, registerId: "r", sales: [] })) === null, "corrupt book is none");
  const appr = { employeeId: "99999999-2222-4333-8444-555566667777", fullName: "Pat Manager" };
  const v = validateReversalPayload({ kind: "void", saleClientUuid: sid, offlineReason: "offline", approver: appr, processedByName: "Al", refundMinor: 3000, drawerSessionId: null, reason: "Rang wrong" });
  ok(v.ok, "a void payload validates");
  ok(!validateReversalPayload({ kind: "void", saleClientUuid: sid, offlineReason: "offline", approver: appr, processedByName: "Al", refundMinor: 3000, drawerSessionId: null, reason: "x" }).ok, "a void needs a reason");
  const rp = { kind: "return", saleClientUuid: sid, offlineReason: "network", approver: appr, processedByName: "Al", refundMinor: 2000, drawerSessionId: null, line: { index: 0, productId: "p1", productName: "Flower", unitPriceMinor: 1000, quantity: 2 }, returnReason: "defective", disposition: "restock", originalPackaging: true, lotIdLegible: true };
  ok(validateReversalPayload(rp).ok, "a return payload validates");
  ok(!validateReversalPayload({ ...rp, refundMinor: 1999 }).ok, "the refund must be price times quantity");
  ok(!validateReversalPayload({ ...rp, lotIdLegible: false }).ok, "attestations required");
  ok(!validateReversalPayload({ ...rp, approver: { employeeId: "nope", fullName: "x" } }).ok, "approver id must be a uuid");
  const rows = [
    { id: "a", product_id: "p1", variant_id: null, price_minor_units: 1000, remaining: 0 },
    { id: "b", product_id: "p1", variant_id: null, price_minor_units: 1000, remaining: 2 },
    { id: "c", product_id: "p2", variant_id: null, price_minor_units: 1000, remaining: 1 },
  ];
  ok(matchOrderLine(rows, rp.line)?.id === "b", "matches product + price with units left");
  ok(matchOrderLine(rows, { ...rp.line, productId: "zz" }) === null, "no match is null");
  ok(reversalTag("u") === "[offline u]" && /already handed back/.test(reversalExceptionReason(v.ok ? v.payload : (null as never), "x.")), "tag and exception text");
  return { passed, failed };
}

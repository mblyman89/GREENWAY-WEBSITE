/**
 * src/lib/pos/day-tally-core.ts — D170 O6 (owner 2026-11-04: "finish all
 * remaining offline mode tasks ... I want to make sure we are fully hardened
 * and prepared for any situation.")
 *
 * PURE. A provisional X report with no internet.
 *
 * The real X/Z report is built by the server from the ledger, so with no
 * internet it could not print at all. The register is queue-first: every
 * sale and no-sale this iPad rings passes through its event queue, so the
 * register also keeps a small DAY TALLY for the current Pacific business
 * day: one compact row per sale / no-sale, carrying exactly the payload
 * fields the server's own summarizeDayEvents reads (totals, tax, medical,
 * rounding, employee tab). Offline, a manager or lead PIN checked on this
 * iPad prints a PROVISIONAL X from that tally with the SAME summarizer, so
 * the two can only differ by what the server later rejects.
 *
 * What it can never show: other registers, refunds, and drawer cash (the
 * expected-cash figures need the back office, and counts stay blind). The
 * slip says so. The final X/Z stays server-side.
 */
import { summarizeDayEvents, type DayEventRow, type DaySummary } from "./day-report-core";

export const DAY_TALLY_VERSION = 1;
/** A busy day is ~600 sales; this bounds the copy far above that. */
export const DAY_TALLY_MAX_ROWS = 4000;

export type DayTallyRow = {
  /** clientUuid of the queued event (dedupe). */
  id: string;
  t: "sale" | "no_sale";
  p?: {
    totalMinor?: number;
    subtotalMinor?: number;
    taxMinor?: number;
    paymentMethod?: string;
    medical?: { medicalSavingsMinor?: number };
    rounding?: { adjustmentMinor?: number };
  };
};

export type DayTally = { v: number; day: string; registerId: string; rows: DayTallyRow[] };

function int(v: unknown): number | undefined {
  return Number.isInteger(v) ? (v as number) : undefined;
}

/** The compact copy of a sale payload (only what summarizeDayEvents reads). */
export function compactSalePayload(payload: Record<string, unknown>): NonNullable<DayTallyRow["p"]> {
  const out: NonNullable<DayTallyRow["p"]> = {};
  const total = int(payload.totalMinor);
  const sub = int(payload.subtotalMinor);
  const tax = int(payload.taxMinor);
  if (total !== undefined) out.totalMinor = total;
  if (sub !== undefined) out.subtotalMinor = sub;
  if (tax !== undefined) out.taxMinor = tax;
  if (typeof payload.paymentMethod === "string") out.paymentMethod = payload.paymentMethod.slice(0, 40);
  const med = payload.medical && typeof payload.medical === "object" ? (payload.medical as Record<string, unknown>) : null;
  if (med) out.medical = { medicalSavingsMinor: int(med.medicalSavingsMinor) ?? 0 };
  const r = payload.rounding && typeof payload.rounding === "object" ? (payload.rounding as Record<string, unknown>) : null;
  if (r) out.rounding = { adjustmentMinor: int(r.adjustmentMinor) ?? 0 };
  return out;
}

/**
 * Record one queued event. Only sales and no-sales count; a new business
 * day (or another register's pairing) starts a fresh tally; a repeated
 * clientUuid is ignored.
 */
export function tallyEvent(
  tally: DayTally | null,
  input: { day: string; registerId: string; eventType: string; clientUuid: string; payload: Record<string, unknown> },
): DayTally {
  const base: DayTally =
    tally && tally.day === input.day && tally.registerId === input.registerId
      ? tally
      : { v: DAY_TALLY_VERSION, day: input.day, registerId: input.registerId, rows: [] };
  if (input.eventType !== "sale" && input.eventType !== "no_sale") return base;
  if (base.rows.length >= DAY_TALLY_MAX_ROWS) return base;
  if (base.rows.some((r) => r.id === input.clientUuid)) return base;
  const row: DayTallyRow =
    input.eventType === "sale"
      ? { id: input.clientUuid, t: "sale", p: compactSalePayload(input.payload) }
      : { id: input.clientUuid, t: "no_sale" };
  return { ...base, rows: [...base.rows, row] };
}

export function parseDayTally(raw: string | null | undefined): DayTally | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o?.v !== DAY_TALLY_VERSION || typeof o.day !== "string" || typeof o.registerId !== "string" || !Array.isArray(o.rows)) {
      return null;
    }
    const rows: DayTallyRow[] = [];
    for (const r of o.rows as unknown[]) {
      if (!r || typeof r !== "object") continue;
      const x = r as Record<string, unknown>;
      if (typeof x.id !== "string" || (x.t !== "sale" && x.t !== "no_sale")) continue;
      rows.push(
        x.t === "sale"
          ? { id: x.id, t: "sale", p: compactSalePayload((x.p && typeof x.p === "object" ? x.p : {}) as Record<string, unknown>) }
          : { id: x.id, t: "no_sale" },
      );
      if (rows.length >= DAY_TALLY_MAX_ROWS) break;
    }
    return { v: DAY_TALLY_VERSION, day: o.day, registerId: o.registerId, rows };
  } catch {
    return null;
  }
}

/**
 * The provisional summary for `day`, through the server's own summarizer.
 * `unsentCount` (events still in this iPad's queue) is shown as "still
 * processing", so the manager sees how much has not reached the server.
 */
export function provisionalDaySummary(
  tally: DayTally | null,
  day: string,
  registerId: string,
  unsentCount: number,
): DaySummary {
  const rows: DayEventRow[] =
    tally && tally.day === day && tally.registerId === registerId
      ? tally.rows.map((r) => ({ eventType: r.t, status: "processed", payload: r.p ?? {} }))
      : [];
  const s = summarizeDayEvents(rows);
  return { ...s, pendingCount: Math.max(0, Math.floor(unsentCount)) };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runDayTallyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("day-tally-core FAIL:", m);
    }
  };
  const day = "2026-11-04";
  const reg = "r1";
  let t = tallyEvent(null, { day, registerId: reg, eventType: "sale", clientUuid: "a", payload: { totalMinor: 5000, subtotalMinor: 4000, taxMinor: 1000, paymentMethod: "cash", cart: [{ big: true }] } });
  ok(t.rows.length === 1 && t.rows[0].p?.totalMinor === 5000, "a sale is tallied");
  ok(!("cart" in (t.rows[0].p ?? {})), "only the summarizer's fields are kept");
  t = tallyEvent(t, { day, registerId: reg, eventType: "sale", clientUuid: "a", payload: { totalMinor: 5000 } });
  ok(t.rows.length === 1, "a repeated clientUuid is ignored");
  t = tallyEvent(t, { day, registerId: reg, eventType: "sale", clientUuid: "b", payload: { totalMinor: 3000, subtotalMinor: 3000, taxMinor: 0, medical: { medicalSavingsMinor: 555 }, rounding: { adjustmentMinor: -2 } } });
  t = tallyEvent(t, { day, registerId: reg, eventType: "sale", clientUuid: "c", payload: { totalMinor: 1200, subtotalMinor: 1000, taxMinor: 200, paymentMethod: "employee_tab" } });
  t = tallyEvent(t, { day, registerId: reg, eventType: "no_sale", clientUuid: "d", payload: { reason: "change" } });
  t = tallyEvent(t, { day, registerId: reg, eventType: "offline_auth", clientUuid: "e", payload: {} });
  ok(t.rows.length === 4, "only sales and no-sales count");
  const s = provisionalDaySummary(t, day, reg, 3);
  ok(s.saleCount === 3 && s.grossMinor === 9200 && s.taxMinor === 1200, "sales, gross and tax through the server summarizer");
  ok(s.medicalSaleCount === 1 && s.medicalSavingsMinor === 555, "medical counted");
  ok(s.roundedSaleCount === 1 && s.roundingMinor === -2, "rounding counted");
  ok(s.employeeTabCount === 1 && s.employeeTabMinor === 1200, "employee tab counted");
  ok(s.noSaleCount === 1 && s.pendingCount === 3, "no-sales and unsent count");
  const next = tallyEvent(t, { day: "2026-11-05", registerId: reg, eventType: "sale", clientUuid: "z", payload: { totalMinor: 100 } });
  ok(next.day === "2026-11-05" && next.rows.length === 1, "a new business day starts fresh");
  ok(provisionalDaySummary(t, "2026-11-05", reg, 0).saleCount === 0, "yesterday's tally never prints as today");
  ok(provisionalDaySummary(t, day, "r2", 0).saleCount === 0, "another register's tally never prints");
  const other = tallyEvent(t, { day, registerId: "r2", eventType: "sale", clientUuid: "y", payload: {} });
  ok(other.registerId === "r2" && other.rows.length === 1, "re-paired to another register starts fresh");
  const round = parseDayTally(JSON.stringify(t));
  ok(!!round && round.rows.length === 4 && provisionalDaySummary(round, day, reg, 0).grossMinor === 9200, "round trip");
  ok(parseDayTally("{x") === null && parseDayTally(JSON.stringify({ v: 2, day, registerId: reg, rows: [] })) === null, "corrupt or other version is none");
  ok(parseDayTally(JSON.stringify({ v: 1, day, registerId: reg, rows: [{ id: 1 }, { id: "q", t: "bogus" }] }))!.rows.length === 0, "junk rows dropped");
  ok(provisionalDaySummary(null, day, reg, -4).pendingCount === 0, "no tally prints zeros, never negative");
  return { passed, failed };
}

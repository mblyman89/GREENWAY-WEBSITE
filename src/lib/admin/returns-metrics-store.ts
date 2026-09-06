/**
 * returns-metrics-store.ts (Slice 21) — server. Returns and voids, for the
 * back office, over a RANGE.
 *
 * Michael, verbatim: "nowhere in the back office can I find anything related
 * to returns or voids ... It should be in reports and in the main cockpit."
 *
 * `refunds-store.ts:33` already answers this for exactly ONE Pacific business
 * day, and is called by the register's X/Z slip route and by register
 * oversight — never by the cockpit or any /admin/reports page. Rather than
 * calling it in a loop (28 days on the cockpit's trailing basis would be 56
 * round trips), this module asks the same two tables for the whole range once
 * and buckets the rows by Pacific business day in memory.
 *
 * The two sources, and why there are two — they are different events:
 *
 *   VOID   — a sale unwound, usually same-day, because it should not have
 *            happened. `void-store.ts:62` sets VOID_MARKER = "sale_voided",
 *            written to order_events.event_type (:426) and mirrored into
 *            audit_logs with action "register.sale_voided" whose after_json
 *            carries refundMinor (parsed by `auditRefundMinor`,
 *            day-report-core.ts:184).
 *   RETURN — a customer bringing product back under WAC 314-55-079(12).
 *            `customer_returns` (migration 0115:38) carries
 *            refund_minor_units, quantity, disposition (restock|destroy),
 *            reason and created_at.
 *
 * Neither record carries register attribution — `refunds-store.ts` says so in
 * its own header, and the schema bears it out: customer_returns has no
 * register column and void audits only name the device in actor_email. So
 * every number here is STORE-WIDE and is labelled as such. It is not broken
 * down per register, because the data to do that honestly does not exist.
 *
 * Best-effort throughout: a read failure returns zeros rather than throwing,
 * matching `refunds-store.ts`, because a cockpit missing one panel beats a
 * cockpit that 500s.
 *
 * MONEY IS MINOR UNITS (cents).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificWallTimeToUtcISO, pacificDayKey } from "@/lib/reports/timezone";
import {
  toRefundFacts,
  sumRefundFacts,
  breakdownBy,
  totalReturnedUnits,
  restockShare,
  EMPTY_REFUND_FACTS,
  type RefundFacts,
  type ReturnRowFacts,
  type BreakdownRow,
} from "@/lib/admin/refund-metrics-core";

/** Refund facts for one Pacific business day. */
export type DayRefunds = RefundFacts & { day: string };

export type ReturnsVoidsRange = {
  /** True when Supabase is configured AND both reads succeeded. */
  ok: boolean;
  /** Per-day facts, oldest first, for every day in the requested range. */
  byDay: DayRefunds[];
  /** Range totals. */
  totals: RefundFacts;
  /** Return value grouped by reason, biggest first. */
  byReason: BreakdownRow[];
  /** Return value grouped by restock vs destroy. */
  byDisposition: BreakdownRow[];
  /** Units (grams/each) handed back across the range. */
  returnedUnits: number;
  /** Share of returned VALUE that went back on the shelf, or null. */
  restockShare: number | null;
};

export function emptyReturnsVoidsRange(days: string[] = []): ReturnsVoidsRange {
  return {
    ok: false,
    byDay: days.map((day) => ({ day, ...EMPTY_REFUND_FACTS })),
    totals: { ...EMPTY_REFUND_FACTS },
    byReason: [],
    byDisposition: [],
    returnedUnits: 0,
    restockShare: null,
  };
}

/** Inclusive list of day keys from start to end. Guards against a huge span. */
function dayRange(startYmd: string, endYmd: string, maxDays = 400): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  let t = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (t <= end && out.length < maxDays) {
    const dt = new Date(t);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate(),
      ).padStart(2, "0")}`,
    );
    t += 86_400_000;
  }
  return out;
}

/**
 * Returns and voids across an inclusive Pacific business-day range.
 *
 * Both reads are bounded by the range's UTC instants, and rows are bucketed
 * back to Pacific day keys with `pacificDayKey` — the same helper the sales
 * report uses (`sales.ts:32`), so a refund and the sale it reverses land on
 * the same business day rather than drifting apart at the 00:00 boundary.
 */
export async function returnsVoidsForRange(
  startYmd: string,
  endYmd: string,
): Promise<ReturnsVoidsRange> {
  const days = dayRange(startYmd, endYmd);
  if (!isSupabaseServiceConfigured || days.length === 0) {
    return emptyReturnsVoidsRange(days);
  }

  const admin = createSupabaseAdminClient();
  const startISO = pacificWallTimeToUtcISO(days[0], "start");
  const endISO = pacificWallTimeToUtcISO(days[days.length - 1], "end");

  let voidRows: { after_json: unknown; created_at: string }[] = [];
  let returnRows: {
    refund_minor_units: number;
    quantity: number;
    reason: string | null;
    disposition: string | null;
    created_at: string;
  }[] = [];
  let ok = true;

  try {
    const [voidsRes, returnsRes] = await Promise.all([
      admin
        .from("audit_logs")
        .select("after_json, created_at")
        .eq("action", "register.sale_voided")
        .gte("created_at", startISO)
        .lte("created_at", endISO),
      admin
        .from("customer_returns")
        .select("refund_minor_units, quantity, reason, disposition, created_at")
        .gte("created_at", startISO)
        .lte("created_at", endISO),
    ]);
    if (voidsRes.error || returnsRes.error) ok = false;
    voidRows = (voidsRes.data as typeof voidRows | null) ?? [];
    returnRows = (returnsRes.data as typeof returnRows | null) ?? [];
  } catch {
    // Best-effort: an unreachable database yields an honest empty panel.
    return emptyReturnsVoidsRange(days);
  }

  // Seed every requested day so a quiet day renders as a real 0 rather than
  // vanishing from the chart and making the range look shorter than it was.
  const buckets = new Map<string, RefundFacts>();
  for (const d of days) buckets.set(d, { ...EMPTY_REFUND_FACTS });

  const bump = (day: string, patch: Partial<RefundFacts>) => {
    const b = buckets.get(day);
    if (!b) return; // A row outside the requested range is ignored, not forced in.
    b.voidCount += patch.voidCount ?? 0;
    b.voidRefundMinor += patch.voidRefundMinor ?? 0;
    b.returnCount += patch.returnCount ?? 0;
    b.returnRefundMinor += patch.returnRefundMinor ?? 0;
    b.refundTotalMinor = b.voidRefundMinor + b.returnRefundMinor;
  };

  for (const v of voidRows) {
    const a = v.after_json && typeof v.after_json === "object"
      ? (v.after_json as Record<string, unknown>)
      : {};
    const raw = typeof a.refundMinor === "number" ? a.refundMinor : Number(a.refundMinor);
    const refund = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    bump(pacificDayKey(v.created_at), { voidCount: 1, voidRefundMinor: refund });
  }

  const returnFacts: ReturnRowFacts[] = [];
  for (const r of returnRows) {
    const raw = typeof r.refund_minor_units === "number"
      ? r.refund_minor_units
      : Number(r.refund_minor_units);
    const refund = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    bump(pacificDayKey(r.created_at), { returnCount: 1, returnRefundMinor: refund });
    returnFacts.push({
      reason: r.reason,
      disposition: r.disposition,
      refundMinorUnits: refund,
      quantity: typeof r.quantity === "number" ? r.quantity : Number(r.quantity),
    });
  }

  const byDay: DayRefunds[] = days.map((day) => ({
    day,
    ...toRefundFacts(buckets.get(day)),
  }));

  return {
    ok,
    byDay,
    totals: sumRefundFacts(byDay),
    byReason: breakdownBy(returnFacts, "reason"),
    byDisposition: breakdownBy(returnFacts, "disposition"),
    returnedUnits: totalReturnedUnits(returnFacts),
    restockShare: restockShare(returnFacts),
  };
}

/** Convenience: refund facts for a single Pacific business day. */
export async function returnsVoidsForDay(ymd: string): Promise<ReturnsVoidsRange> {
  return returnsVoidsForRange(ymd, ymd);
}

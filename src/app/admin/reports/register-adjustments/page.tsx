/**
 * Reports → Register Adjustments (Register round S3).
 *
 * Owner request (verbatim): "a tracker on when, who and how often it gets
 * used would be great, in addition to tracking on voids, who and when and how
 * often." Minus (−), line remove (✕) and cancelled sales come from
 * pos_cart_adjustments (0301); voids from audit register.sale_voided.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { DateRangePicker } from "@/components/admin/reports/DateRangePicker";
import { resolveRange } from "@/lib/reports/range";
import { pacificDayKey } from "@/lib/reports/timezone";
import { CART_ADJUST_LABELS } from "@/lib/pos/cart-adjust-core";
import { getRegisterAdjustmentsReport } from "@/lib/reports/register-adjustments";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const EMP_COLS: ReportColumn<Row>[] = [
  { key: "name", header: "Employee", align: "left" },
  { key: "minus", header: "Minus (−)", align: "right" },
  { key: "remove", header: "Removed (✕)", align: "right" },
  { key: "cancel", header: "Cancelled sales", align: "right" },
  { key: "units", header: "Units taken off", align: "right" },
  { key: "value", header: "Shelf value", align: "right", emphasis: true },
  { key: "last", header: "Last (PT)", align: "right" },
];
const VOID_COLS: ReportColumn<Row>[] = [
  { key: "name", header: "Approved by", align: "left" },
  { key: "voids", header: "Voids", align: "right" },
  { key: "refund", header: "Cash returned", align: "right", emphasis: true },
  { key: "last", header: "Last (PT)", align: "right" },
];
const DAY_COLS: ReportColumn<Row>[] = [
  { key: "day", header: "Day (PT)", align: "left" },
  { key: "adjustments", header: "Cart reductions", align: "right" },
  { key: "voids", header: "Voids", align: "right" },
  { key: "value", header: "Shelf value reduced", align: "right", emphasis: true },
];
const RECENT_COLS: ReportColumn<Row>[] = [
  { key: "when", header: "When (PT)", align: "left" },
  { key: "who", header: "Employee", align: "left" },
  { key: "what", header: "Action", align: "left" },
  { key: "item", header: "Item", align: "left" },
  { key: "units", header: "Units", align: "right" },
  { key: "value", header: "Value", align: "right", emphasis: true },
];

const ptTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
      {subtitle ? <p className="mb-4 mt-0.5 text-xs text-white/45">{subtitle}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

export default async function RegisterAdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string; year?: string }>;
}) {
  await requirePermission("reports.view");
  const range = resolveRange(await searchParams);
  if (!isSupabaseServiceConfigured) {
    return <p className="text-sm text-white/50">Connect Supabase to view register adjustments.</p>;
  }
  const r = await getRegisterAdjustmentsReport(range.fromISO, range.toISO);
  const s = r.summary;
  const nm = (id: string) => r.names[id] ?? "Employee";

  return (
    <div className="space-y-5">
      <DateRangePicker />
      {r.migrationMissing ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          Minus / remove tracking needs migration <code>0301_pos_cart_adjustments.sql</code> applied in Supabase. Voids
          are shown below regardless.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cart reductions" value={s.totals.adjustments.toLocaleString("en-US")} hint={range.label} accent="orange" />
        <StatCard label="Shelf value taken off carts" value={formatMinorCurrency(s.totals.valueMinor)} hint={`${s.totals.units} units`} accent="gold" />
        <StatCard label="Voids" value={s.totals.voids.toLocaleString("en-US")} hint={range.label} accent="green" />
        <StatCard label="Cash returned on voids" value={formatMinorCurrency(s.totals.voidMinor)} accent="muted" />
      </div>
      <Section title="Who reduces carts" subtitle="Minus, line removes, and cancelled sales per employee — heaviest first. A high count against low sales is the pattern to question.">
        <ReportTable
          columns={EMP_COLS}
          rows={s.byEmployee.map((e) => ({
            name: nm(e.employeeId),
            minus: e.qtyDecrease,
            remove: e.lineRemove,
            cancel: e.cartCancel,
            units: e.units,
            value: formatMinorCurrency(e.valueMinor),
            last: ptTime(e.lastAt),
          }))}
          emptyLabel="No cart reductions in this range."
        />
      </Section>
      <Section title="Voids" subtitle="Completed sales voided at the register, by the manager who approved with their PIN.">
        <ReportTable
          columns={VOID_COLS}
          rows={s.voidsByApprover.map((v) => ({
            name: nm(v.employeeId),
            voids: v.voids,
            refund: formatMinorCurrency(v.refundMinor),
            last: ptTime(v.lastAt),
          }))}
          emptyLabel="No voids in this range."
        />
      </Section>
      <Section title="By day">
        <ReportTable
          columns={DAY_COLS}
          rows={s.byDay.map((d) => ({ day: d.day, adjustments: d.adjustments, voids: d.voids, value: formatMinorCurrency(d.valueMinor) }))}
          emptyLabel="Nothing in this range."
        />
      </Section>
      <Section title="Latest 100 cart reductions">
        <ReportTable
          columns={RECENT_COLS}
          rows={r.recent.map((x) => ({
            when: ptTime(x.occurredAt),
            who: nm(x.employeeId ?? "unknown"),
            what: CART_ADJUST_LABELS[x.action],
            item: x.productName ?? (x.action === "cart_cancel" ? "Whole cart" : "—"),
            units: x.unitsRemoved,
            value: formatMinorCurrency(x.valueMinor),
          }))}
          emptyLabel="Nothing yet."
        />
      </Section>
      <p className="text-xs text-white/40">Days are Pacific time ({pacificDayKey(new Date().toISOString())} today).</p>
    </div>
  );
}

/**
 * src/app/admin/reports/cultivera-benchmark/weekday/page.tsx - Cultivera Benchmark -> Average day (D260). OWNER ONLY.
 *
 * Michael, 2026-11-20: "I want to be able to see what an average Thursday looked like on Cultivera, compared with
 * what an average Thursday looks like on ours ... I want to see if our discount management system is paying off.
 * If we are making higher margins now, if we are selling more or less now."
 *
 * Cultivera = the archived sales_lines (their own figures, every day before the cut-over, or the same calendar
 * days one year before our window). Ours = completed orders from the cut-over to today. Averages are over the
 * days that had sales. Pre-tax, cents, Pacific days.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { StatCard } from "@/components/admin/StatCard";
import { formatCents } from "@/lib/reports/cultivera-benchmark-core";
import { cutoverDate } from "@/lib/reports/cultivera-benchmark-report-store";
import { pacificToday } from "@/lib/reports/timezone";
import { cultiveraDays, ourDays, type CultiveraDays } from "@/lib/reports/cultivera-weekday-store";
import {
  GROUPS,
  WEEKDAYS,
  discountRateOf,
  marginOf,
  profitOf,
  weekdayAverages,
  type DayFacts,
  type Fig,
  type WeekdayAvg,
} from "@/lib/reports/cultivera-weekday-core";

export const dynamic = "force-dynamic";
// The first view after an archive reads the 15 sales_lines parts once (then cached).
export const maxDuration = 300;

const money = (c: number | null) => (c === null ? "—" : formatCents(Math.round(c)));
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
const minusYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;

type Row = { label: string; cv: number | null; us: number | null; kind: "money" | "pct" | "num"; higherIsBetter: boolean | null };
function rows(cv: Fig, us: Fig): Row[] {
  const tax = (f: Fig) => f.excise + f.salesTax;
  return [
    { label: "Orders", cv: cv.orders, us: us.orders, kind: "num", higherIsBetter: true },
    { label: "Units sold", cv: cv.units, us: us.units, kind: "num", higherIsBetter: true },
    { label: "Gross sales (before discounts)", cv: cv.gross, us: us.gross, kind: "money", higherIsBetter: true },
    { label: "Total discounts", cv: cv.disc, us: us.disc, kind: "money", higherIsBetter: false },
    { label: "Discount rate", cv: discountRateOf(cv), us: discountRateOf(us), kind: "pct", higherIsBetter: false },
    { label: "Sales before tax", cv: cv.net, us: us.net, kind: "money", higherIsBetter: true },
    { label: "Excise tax (37%)", cv: cv.excise, us: us.excise, kind: "money", higherIsBetter: null },
    { label: "Sales tax", cv: cv.salesTax, us: us.salesTax, kind: "money", higherIsBetter: null },
    { label: "Total with tax", cv: cv.net + tax(cv), us: us.net + tax(us), kind: "money", higherIsBetter: true },
    { label: "Average ticket (before tax)", cv: cv.orders ? cv.net / cv.orders : null, us: us.orders ? us.net / us.orders : null, kind: "money", higherIsBetter: true },
    { label: "Cost", cv: cv.cost, us: us.cost, kind: "money", higherIsBetter: null },
    { label: "Gross profit", cv: profitOf(cv), us: profitOf(us), kind: "money", higherIsBetter: true },
    { label: "Margin", cv: marginOf(cv), us: marginOf(us), kind: "pct", higherIsBetter: true },
  ];
}
const fmt = (v: number | null, k: Row["kind"]) => (v === null ? "—" : k === "money" ? money(v) : k === "pct" ? pct(v) : num(v));
function Delta({ r }: { r: Row }) {
  if (r.cv === null || r.us === null) return <span className="text-white/30">—</span>;
  const d = r.us - r.cv;
  const good = r.higherIsBetter === null || Math.abs(d) < 1e-9 ? null : r.higherIsBetter ? d > 0 : d < 0;
  const tone = good === null ? "text-white/60" : good ? "text-[var(--admin-accent)]" : "text-red-300";
  const txt = r.kind === "pct" ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pts` : `${d >= 0 ? "+" : "−"}${r.kind === "money" ? money(Math.abs(d)) : num(Math.abs(d))}`;
  const rel = r.kind !== "pct" && r.cv ? ` (${d >= 0 ? "+" : ""}${((d / Math.abs(r.cv)) * 100).toFixed(1)}%)` : "";
  return <span className={tone}>{txt}{rel}</span>;
}

export default async function CultiveraWeekdayPage({ searchParams }: { searchParams: Promise<{ d?: string; cv?: string }> }) {
  await requirePermission("cultivera.benchmark");
  const sp = await searchParams;
  const sel = /^[0-7]$/.test(sp.d ?? "") ? Number(sp.d) : 7;
  const mode = sp.cv === "ly" ? "ly" : "all";
  const today = pacificToday();

  let err: string | null = null;
  let cv: CultiveraDays | null = null;
  let us: DayFacts[] = [];
  let cut: string | null = null;
  try {
    cut = await cutoverDate();
    [cv, us] = await Promise.all([cultiveraDays(), cut ? ourDays(cut, today) : Promise.resolve([])]);
  } catch (e) {
    err = e instanceof Error ? e.message : "Could not load the comparison.";
  }
  const usFrom = cut ?? today;
  const cvFrom = mode === "ly" ? minusYear(usFrom) : "0000-01-01";
  const cvTo = mode === "ly" ? minusYear(today) : cut ? minusOne(cut) : "9999-12-31";
  const C: WeekdayAvg[] = weekdayAverages(cv?.days ?? [], cvFrom, cvTo);
  const U: WeekdayAvg[] = weekdayAverages(us, usFrom, today);
  const c = C[sel];
  const u = U[sel];
  const name = sel === 7 ? "day (all days)" : WEEKDAYS[sel];
  const coverage = u.avg.net > 0 ? u.avg.costedNet / u.avg.net : null;
  const pUs = profitOf(u.avg);
  const pCv = profitOf(c.avg);
  const q = (d: number, m = mode) => `?d=${d}&cv=${m}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/reports/cultivera-benchmark" className="text-white/50 hover:text-white">← Cultivera Benchmark</Link>
        <span className="text-white/20">|</span>
        {[...WEEKDAYS.map((w, i) => [i, w.slice(0, 3)] as const), [7, "All days"] as const].map(([i, l]) => (
          <Link key={i} href={q(i)} className={`rounded-lg px-3 py-1 ${i === sel ? "bg-[var(--admin-accent)] text-black font-bold" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>{l}</Link>
        ))}
        <span className="text-white/20">|</span>
        <Link href={q(sel, "all")} className={`rounded-lg px-3 py-1 ${mode === "all" ? "bg-white/20 text-white" : "bg-white/5 text-white/60"}`}>All Cultivera history</Link>
        <Link href={q(sel, "ly")} className={`rounded-lg px-3 py-1 ${mode === "ly" ? "bg-white/20 text-white" : "bg-white/5 text-white/60"}`}>Same dates last year</Link>
      </div>

      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}
      {!cut && !err && <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">The cut-over date is not set (Books settings), so our side is not shown.</div>}

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">The average {name}: Cultivera vs us</h2>
        <p className="mt-0.5 text-xs text-white/45">
          Cultivera {mode === "ly" ? `${cvFrom} to ${cvTo} (same dates one year before ours)` : `all history before ${cut ?? "the cut-over"}`}: {c.days} days.
          Us {usFrom} to {today}: {u.days} days. Averages over days with sales; pre-tax; Pacific days. Cultivera figures are their own
          (per sale line, summed exactly as their daily report). Their single tax figure is split 37% excise : 9.3% sales on cannabis lines.
          {coverage !== null && coverage < 0.9995 && ` Our cost is recorded on ${pct(coverage)} of our sales; our margin and profit are measured on those sales.`}
          {u.days < 4 * (sel === 7 ? 7 : 1) && " We have few days so far, so our average will still move."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Profit per day (us)" value={money(pUs)} hint={pCv !== null && pUs !== null ? `Cultivera ${money(pCv)} · ${pUs >= pCv ? "+" : "−"}${money(Math.abs(pUs - pCv))}` : undefined} accent={pUs !== null && pCv !== null && pUs >= pCv ? "green" : "orange"} />
          <StatCard label="Sales before tax (us)" value={money(u.avg.net)} hint={`Cultivera ${money(c.avg.net)}`} accent={u.avg.net >= c.avg.net ? "green" : "orange"} />
          <StatCard label="Margin (us)" value={pct(marginOf(u.avg))} hint={`Cultivera ${pct(marginOf(c.avg))}`} accent={(marginOf(u.avg) ?? 0) >= (marginOf(c.avg) ?? 0) ? "green" : "orange"} />
          <StatCard label="Discount rate (us)" value={pct(discountRateOf(u.avg))} hint={`Cultivera ${pct(discountRateOf(c.avg))}`} accent={(discountRateOf(u.avg) ?? 0) <= (discountRateOf(c.avg) ?? 0) ? "green" : "orange"} />
        </div>
        <Table head={["Average per day", "Cultivera", "Us", "Difference"]}>
          {rows(c.avg, u.avg).map((r) => (
            <tr key={r.label} className="border-t border-white/5">
              <td className="py-1.5 pr-4 text-white/70">{r.label}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(r.cv, r.kind)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums font-semibold">{fmt(r.us, r.kind)}</td>
              <td className="py-1.5 text-right tabular-nums"><Delta r={r} /></td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">What made up the average {name}</h2>
        <p className="mt-0.5 text-xs text-white/45">Per category group, average per day. Cultivera&apos;s category names and ours are grouped the same way.</p>
        <Table head={["Category", "Cultivera sales", "Us sales", "Cultivera disc.", "Us disc.", "Cultivera margin", "Us margin", "Cultivera profit", "Us profit"]}>
          {GROUPS.map((g) => {
            const a = c.groups[g.key];
            const b = u.groups[g.key];
            if (!a && !b) return null;
            return (
              <tr key={g.key} className="border-t border-white/5">
                <td className="py-1.5 pr-4 text-white/70">{g.label}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{money(a?.net ?? 0)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-semibold">{money(b?.net ?? 0)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{pct(a ? discountRateOf(a) : null)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{pct(b ? discountRateOf(b) : null)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{pct(a ? marginOf(a) : null)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{pct(b ? marginOf(b) : null)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{money(a ? profitOf(a) : null)}</td>
                <td className="py-1.5 text-right tabular-nums">{money(b ? profitOf(b) : null)}</td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-2 text-xs text-white/35">Our category cost comes from each sale&apos;s cost entry in the books; our category margin is that cost against the category&apos;s costed sales.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Every weekday at a glance</h2>
        <Table head={["Weekday", "Days (C / us)", "Cultivera sales", "Us sales", "Cultivera profit", "Us profit", "Profit difference", "Cultivera disc.", "Us disc."]}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const pc = profitOf(C[i].avg);
            const pu = profitOf(U[i].avg);
            return (
              <tr key={i} className={`border-t border-white/5 ${i === sel ? "bg-white/[0.04]" : ""}`}>
                <td className="py-1.5 pr-4"><Link href={q(i)} className="text-white/80 hover:underline">{i === 7 ? "All days" : WEEKDAYS[i]}</Link></td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-white/50">{C[i].days} / {U[i].days}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{money(C[i].avg.net)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-semibold">{U[i].days ? money(U[i].avg.net) : "—"}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{money(pc)}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-semibold">{U[i].days ? money(pu) : "—"}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{U[i].days ? <Delta r={{ label: "", cv: pc, us: pu, kind: "money", higherIsBetter: true }} /> : "—"}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{pct(discountRateOf(C[i].avg))}</td>
                <td className="py-1.5 text-right tabular-nums">{U[i].days ? pct(discountRateOf(U[i].avg)) : "—"}</td>
              </tr>
            );
          })}
        </Table>
        {cv && <p className="mt-2 text-xs text-white/35">Cultivera source: archived run {cv.runId}, {cv.files} sales-line files, {cv.rows.toLocaleString("en-US")} lines{cv.skipped ? `, ${cv.skipped} unreadable lines left out` : ""}.</p>}
      </section>
    </div>
  );
}

function minusOne(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-white/45">
            {head.map((h, i) => <th key={h} className={`py-2 pr-4 ${i ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

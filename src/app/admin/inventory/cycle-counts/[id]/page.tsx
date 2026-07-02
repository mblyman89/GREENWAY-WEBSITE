import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Badge } from "@/components/admin/ui";
import {
  getCycleCount,
  getCycleCountLines,
  getCycleCountScanLines,
  type CycleCountLineWithLot,
} from "@/lib/inventory/cycle-counts";
import { CycleCountScanner } from "@/components/admin/inventory/CycleCountScanner";
import {
  recordLineCountAction,
  applyCycleCountAction,
  cancelCycleCountAction,
} from "../actions";

export const dynamic = "force-dynamic";

function fmtQty(qty: number | null, unit: string | null): string {
  if (qty == null) return "—";
  const n = Number.isInteger(qty) ? qty.toString() : qty.toFixed(2);
  return `${n}${unit ? ` ${unit}` : ""}`;
}

function VarianceBadge({ v }: { v: number | null }) {
  if (v == null) return <span className="text-white/30">—</span>;
  if (v === 0) return <Badge tone="green">match</Badge>;
  return <Badge tone={v > 0 ? "gold" : "danger"}>{v > 0 ? `+${v}` : v}</Badge>;
}

export default async function CycleCountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;

  const session = await getCycleCount(id);
  if (!session) notFound();
  const lines = await getCycleCountLines(id);
  const scanLines = session.status === "open" ? await getCycleCountScanLines(id) : [];

  const isOpen = session.status === "open";
  const counted = lines.filter((l) => l.counted_qty != null).length;
  const variances = lines.filter((l) => (l.variance_qty ?? 0) !== 0).length;
  // Blind: only reveal system_qty + variance once a session is applied OR the
  // line has been counted (so the employee doesn't see the target up front).
  const reveal = !isOpen;

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Cycle Counts", href: "/admin/inventory/cycle-counts" },
          { label: session.label },
        ]}
      />
      <AdminPageHeader
        title={session.label}
        subtitle={session.scope_note ?? "Blind physical count"}
        action={
          isOpen ? (
            <div className="flex gap-2">
              <form action={applyCycleCountAction.bind(null, id)}>
                <Button type="submit" disabled={counted === 0}>
                  Apply variances
                </Button>
              </form>
              <form action={cancelCycleCountAction.bind(null, id)}>
                <Button type="submit" variant="neutral">
                  Cancel
                </Button>
              </form>
            </div>
          ) : undefined
        }
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.ok === "applied"
            ? "Variances applied — on-hand corrected and adjustments posted."
            : "Count recorded."}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Status" value={session.status} accent={isOpen ? "gold" : "green"} />
        <StatCard label="Lots" value={lines.length.toLocaleString()} accent="muted" />
        <StatCard label="Counted" value={`${counted}/${lines.length}`} accent="muted" />
        <StatCard label="Variances" value={variances.toLocaleString()} accent={variances > 0 ? "orange" : "green"} />
      </div>

      {isOpen ? (
        <HelpPanel
          id="cycle-count-blind"
          title="Blind count"
          steps={[
            "Count the physical quantity of each lot and enter it. The system figure is hidden until you apply.",
            "Once every lot is counted, click Apply variances to post corrections.",
            "Cancelling discards the session without changing on-hand.",
          ]}
        />
      ) : null}

      {isOpen ? <CycleCountScanner countId={id} lines={scanLines} /> : null}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
              <th className="px-4 py-3">Lot</th>
              {reveal ? <th className="px-4 py-3 text-right">System</th> : null}
              <th className="px-4 py-3 text-right">Counted</th>
              {reveal ? <th className="px-4 py-3 text-right">Variance</th> : null}
              {isOpen ? <th className="px-4 py-3 text-right">Enter count</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {lines.map((line: CycleCountLineWithLot) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-white/85">{line.product_name ?? "—"}</div>
                  <div className="font-mono text-[11px] text-white/40">{line.lot_code ?? line.lot_id.slice(0, 8)}</div>
                </td>
                {reveal ? (
                  <td className="px-4 py-3 text-right text-white/70">{fmtQty(line.system_qty, line.unit)}</td>
                ) : null}
                <td className="px-4 py-3 text-right text-white/85">{fmtQty(line.counted_qty, line.unit)}</td>
                {reveal ? (
                  <td className="px-4 py-3 text-right">
                    <VarianceBadge v={line.variance_qty} />
                  </td>
                ) : null}
                {isOpen ? (
                  <td className="px-4 py-3">
                    <form
                      action={recordLineCountAction.bind(null, id, line.id)}
                      className="flex items-center justify-end gap-2"
                    >
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        name="counted_qty"
                        defaultValue={line.counted_qty ?? undefined}
                        className="w-24 text-right"
                        placeholder={line.counted_qty != null ? undefined : "qty"}
                      />
                      <Button type="submit" variant="neutral">
                        {line.counted_qty != null ? "Update" : "Save"}
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-white/40">
        Variance corrections post as <code className="text-white/60">count</code> inventory adjustments, which export to
        the{" "}
        <Link href="/admin/reports/compliance" className="text-[var(--admin-accent)] hover:underline">
          CCRS InventoryAdjustment.csv
        </Link>
        .
      </p>
    </div>
  );
}

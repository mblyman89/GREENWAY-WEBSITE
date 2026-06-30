import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Field, Badge } from "@/components/admin/ui";
import { listCycleCounts, cycleCountSummary } from "@/lib/inventory/cycle-counts";
import { createCycleCountAction } from "./actions";

export const dynamic = "force-dynamic";

function statusTone(status: string): "neutral" | "green" | "gold" | "orange" {
  if (status === "applied") return "green";
  if (status === "open") return "gold";
  return "neutral";
}

export default async function CycleCountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const [sessions, summary] = await Promise.all([listCycleCounts(50), cycleCountSummary()]);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Cycle Counts" },
        ]}
      />
      <AdminPageHeader
        title="Cycle Counts"
        subtitle="Periodic blind physical counts. Variances post as audited 'count' adjustments."
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.ok === "cancelled" ? "Session cancelled." : "Saved."}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Open sessions" value={summary.open.toLocaleString()} accent="gold" />
        <StatCard label="Applied (30d)" value={summary.appliedLast30.toLocaleString()} accent="green" />
        <StatCard
          label="Count adjustments (30d)"
          value={summary.totalAdjustmentsLast30.toLocaleString()}
          accent="muted"
        />
      </div>

      <HelpPanel
        id="cycle-counts-help"
        title="How cycle counts work"
        steps={[
          "Start a session — it snapshots the system on-hand for all active lots (the blind baseline).",
          "An employee physically counts each lot and enters the number. They never see the system figure while counting.",
          "Review variances (counted − system), then Apply. Each non-zero variance posts a 'count' inventory adjustment and corrects on-hand.",
          "Applied count adjustments flow into the CCRS InventoryAdjustment.csv (AdjustmentReason = Reconciliation) on the Compliance tab.",
        ]}
      />

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Start a new count</h2>
        <form action={createCycleCountAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Label" required>
            <Input name="label" placeholder="e.g. March end-of-month count" required />
          </Field>
          <Field label="Scope note" help="Optional — which area / category">
            <Input name="scope_note" placeholder="e.g. Flower aisle" />
          </Field>
          <Button type="submit">Start count</Button>
        </form>
        <p className="mt-2 text-xs text-white/40">
          Snapshots every <span className="font-semibold text-white/60">active</span> lot. Counting is blind.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.14em] text-white/80">Sessions</h2>
        {sessions.length === 0 ? (
          <EmptyState title="No cycle counts yet" description="Start your first count above." />
        ) : (
          <ul className="divide-y divide-white/5">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/inventory/cycle-counts/${s.id}`}
                    className="block truncate text-sm font-semibold text-white/90 hover:text-[var(--admin-accent)]"
                  >
                    {s.label}
                  </Link>
                  <p className="mt-0.5 text-xs text-white/40">
                    {s.line_count} lots · {s.variance_count} variance
                    {s.variance_count === 1 ? "" : "s"} · {new Date(s.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge } from "@/components/admin/ui";
import { recentSessions } from "@/lib/registers/store";
import { formatCents, overShortLabel } from "@/lib/registers/cash";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

const STATUS_TONE: Record<string, "neutral" | "green" | "gold" | "orange" | "danger" | "outline"> = {
  open: "outline",
  closed: "gold",
  reconciled: "green",
  verified: "green",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed (blind)",
  reconciled: "Reconciled",
  verified: "Verified",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function RegisterHistoryPage() {
  await requirePermission("inventory.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Operations" }, { label: "Registers", href: BASE }, { label: "History" }]} />
        <AdminPageHeader title="Drawer history" subtitle="Closed, reconciled, and verified drawer sessions." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to view drawer history." />
      </div>
    );
  }

  const sessions = await recentSessions(80);

  const reconciledCount = sessions.filter((s) => s.status === "reconciled" || s.status === "verified").length;
  const awaiting = sessions.filter((s) => s.status === "closed").length;
  const totalOverShort = sessions
    .filter((s) => s.over_short_minor != null)
    .reduce((acc, s) => acc + (s.over_short_minor ?? 0), 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Operations" }, { label: "Registers", href: BASE }, { label: "History" }]} />
      <AdminPageHeader
        title="Drawer history"
        subtitle="Closed, reconciled, and verified drawer sessions across all registers."
        action={
          <Link href={BASE}>
            <Button variant="subtle">Back to registers</Button>
          </Link>
        }
        help={
          <HelpPanel id="registers-history" title="About drawer history">
            <p>
              Every drawer session is recorded here once it has been counted out. Blind closes show as
              <strong> Closed</strong> until a manager reconciles them with the day&apos;s cash sales, which reveals the
              over/short variance. The shared manager till adds a next-morning <strong>Verify</strong> step.
            </p>
            <p className="mt-2">
              Over/short totals are informational. Investigate any single session that exceeds your store&apos;s
              tolerance, and review patterns by employee over time.
            </p>
          </HelpPanel>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sessions shown" value={String(sessions.length)} hint="Most recent 80" accent="muted" />
        <StatCard label="Awaiting reconcile" value={String(awaiting)} hint="Blind-closed" accent={awaiting > 0 ? "orange" : "muted"} />
        <StatCard
          label="Net over / short"
          value={overShortLabel(totalOverShort)}
          hint={`${reconciledCount} reconciled`}
          accent={totalOverShort === 0 ? "green" : totalOverShort > 0 ? "gold" : "orange"}
        />
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No drawer sessions yet"
          description="Once employees count in and close drawers, the history will appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-white/40">
                <th className="px-4 py-3 font-medium">Register</th>
                <th className="px-4 py-3 font-medium">Business day</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Opening</th>
                <th className="px-4 py-3 text-right font-medium">Counted close</th>
                <th className="px-4 py-3 text-right font-medium">Expected</th>
                <th className="px-4 py-3 text-right font-medium">Over / short</th>
                <th className="px-4 py-3 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-[var(--admin-border)]/50 last:border-0">
                  <td className="px-4 py-3 font-medium text-white">{s.register_name}</td>
                  <td className="px-4 py-3 text-white/70">{s.business_day}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">
                    {s.opening_count_minor != null ? formatCents(s.opening_count_minor) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">
                    {s.closing_count_minor != null ? formatCents(s.closing_count_minor) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/50">
                    {s.expected_close_minor != null ? formatCents(s.expected_close_minor) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.over_short_minor != null ? (
                      <span
                        className={
                          s.over_short_minor === 0
                            ? "text-[var(--admin-green)]"
                            : s.over_short_minor > 0
                              ? "text-[var(--admin-gold)]"
                              : "text-orange-400"
                        }
                      >
                        {overShortLabel(s.over_short_minor)}
                      </span>
                    ) : (
                      <span className="text-white/30">hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/50">{fmtTime(s.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge, Select, Input } from "@/components/admin/ui";
import { CountGrid } from "@/components/admin/registers/CountGrid";
import { formatCents } from "@/lib/registers/cash";
import { SAFE_TARGET_MINOR } from "@/lib/registers/safe-core";
import { listSafeCounts, listSwaps, safeStatus } from "@/lib/registers/safe-store";
import { listEmployees } from "@/lib/staffing/store";
import { backHref } from "@/lib/admin/back-link-core";
import { recordSafeCountAction } from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

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

function varianceLabel(minor: number): string {
  if (minor === 0) return "Balanced";
  return minor > 0 ? `Over ${formatCents(minor)}` : `Short ${formatCents(Math.abs(minor))}`;
}

const WINDOW_LABEL: Record<string, string> = { am: "AM", pm: "PM", other: "Extra" };

export default async function SafePage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; error?: string; counted?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Safe" }]} />
        <AdminPageHeader title="Store safe" subtitle="The $1,000 change fund behind the registers." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to manage the safe." />
      </div>
    );
  }

  const [status, countsRes, swapsRes, allEmployees] = await Promise.all([
    safeStatus(),
    listSafeCounts(30),
    listSwaps(30),
    listEmployees({ includeInactive: true }),
  ]);

  // Employee id → full name resolver (counted_by / performed_by / approved_by are FKs).
  const empName = new Map(allEmployees.map((e) => [e.id, e.full_name]));
  const nameFor = (id: string | null): string => (id ? (empName.get(id) ?? "—") : "—");
  const activeEmployees = allEmployees.filter((e) => e.active);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Safe" }]} />
      <AdminPageHeader
        title="Store safe"
        subtitle={`The change fund behind the registers — target ${formatCents(SAFE_TARGET_MINOR)}, counted twice a day.`}
        action={
          <Button href={backHref(BASE, sp.back)} variant="neutral">
            ← Register Activity
          </Button>
        }
        help={
          <HelpPanel id="registers-safe" title="How the safe works">
            <p>
              The safe holds the store&apos;s change fund — {formatCents(SAFE_TARGET_MINOR)} in small
              bills and coins so registers never run out of change. Store policy is a manager count
              twice a day: once in the morning (AM) before open, once in the evening (PM). Counts
              are open, not blind — the target is known policy, so the grid shows your variance
              live while you count.
            </p>
            <p>
              Change swaps happen at the register: a cashier trades big bills for equal change with
              the safe. The same value goes each way, so neither the drawer&apos;s expected cash nor
              the safe total moves — but every trip into the safe is recorded here, with the
              cashier who did it and the manager or lead who approved it by PIN on the register.
            </p>
            <p>
              Cash drops are different: drops move money one way (drawer → safe) and appear on the
              drawer session, not here. If the safe drifts off target, drops waiting to be banked
              are the usual reason — note it and bank the overage.
            </p>
          </HelpPanel>
        }
      />

      {sp.error ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          {sp.error}
        </div>
      ) : sp.counted ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.counted}
        </div>
      ) : null}

      {!status.ready ? (
        <EmptyState
          title="Safe tracking not set up yet"
          description="Run migration 0135_safe_counts_swaps.sql in the Supabase SQL editor, then reload this page. Until then, register change swaps will refuse to record (nothing is silently skipped)."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Target float" value={formatCents(status.targetMinor)} hint="Store policy" />
            <StatCard
              label="Last count"
              value={status.latest ? formatCents(status.latest.total_minor) : "—"}
              hint={
                status.latest
                  ? `${varianceLabel(status.latest.variance_minor)} · ${fmtTime(status.latest.counted_at)}`
                  : "No counts yet"
              }
            />
            <StatCard
              label="Today's AM count"
              value={status.todayAmDone ? "Done" : "Not yet"}
              hint="Before open"
            />
            <StatCard
              label="Today's PM count"
              value={status.todayPmDone ? "Done" : "Not yet"}
              hint="Evening"
            />
          </div>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">Count the safe</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Count every denomination in the safe. The variance against the {formatCents(SAFE_TARGET_MINOR)} target
              updates live as you type.
            </p>
            <form action={recordSafeCountAction} className="mt-3 space-y-3">
              <CountGrid expectedMinor={SAFE_TARGET_MINOR} expectedLabel="Target" totalLabel="Safe total" />
              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  Count window
                  <Select name="count_window" defaultValue="am" required>
                    <option value="am">AM (before open)</option>
                    <option value="pm">PM (evening)</option>
                    <option value="other">Extra count</option>
                  </Select>
                </label>
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  Counted by
                  <Select name="counted_by" defaultValue="">
                    <option value="">— none —</option>
                    {activeEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                        {e.job_role !== "sales" ? ` (${e.job_role})` : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block grow text-xs text-[var(--admin-text-muted)]">
                  Notes (optional)
                  <Input name="notes" maxLength={500} placeholder="e.g. two drops waiting to be banked" />
                </label>
                <Button type="submit" variant="primary" size="sm">
                  Record safe count
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">Recent counts</h2>
            {countsRes.counts.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No safe counts recorded yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Window</th>
                      <th className="py-2 pr-3">Counted by</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">Target</th>
                      <th className="py-2 pr-3">Variance</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countsRes.counts.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)]">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(c.counted_at)}</td>
                        <td className="py-2 pr-3">
                          <Badge tone={c.count_window === "other" ? "neutral" : "outline"}>
                            {WINDOW_LABEL[c.count_window] ?? c.count_window}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{nameFor(c.counted_by)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCents(c.total_minor)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCents(c.expected_minor)}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={
                              c.variance_minor === 0
                                ? "text-[var(--admin-text-muted)]"
                                : c.variance_minor > 0
                                  ? "text-[var(--admin-gold)]"
                                  : "text-[var(--admin-danger)]"
                            }
                          >
                            {varianceLabel(c.variance_minor)}
                          </span>
                        </td>
                        <td className="py-2 text-[var(--admin-text-muted)]">{c.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">Recent change swaps</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Value-neutral trades between a register drawer and the safe — recorded at the register
              with a manager or lead approval PIN.
            </p>
            {swapsRes.swaps.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No change swaps recorded yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3 text-right">Amount</th>
                      <th className="py-2 pr-3">Performed by</th>
                      <th className="py-2 pr-3">Approved by</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {swapsRes.swaps.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)]">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(s.occurred_at)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCents(s.amount_minor)}</td>
                        <td className="py-2 pr-3">{nameFor(s.performed_by)}</td>
                        <td className="py-2 pr-3">{nameFor(s.approved_by)}</td>
                        <td className="py-2 text-[var(--admin-text-muted)]">{s.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

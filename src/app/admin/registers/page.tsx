import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button, Badge, Card, Section } from "@/components/admin/ui";
import { DenomFields } from "@/components/admin/registers/DenomFields";
import { liveRegisters, cashDrawerSummary, recentSessions } from "@/lib/registers/store";
import { listEmployees } from "@/lib/staffing/store";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import {
  openDrawerAction,
  closeDrawerAction,
  recordDropAction,
  reconcileDrawerAction,
  verifyTillAction,
} from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

export default async function CashManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    opened?: string;
    closed?: string;
    dropped?: string;
    reconciled?: string;
    verified?: string;
  }>;
}) {
  const session = await requirePermission("orders.manage");
  const canManage = can(session.profile.role, "inventory.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Cash Management"
          subtitle="Open, drop, count, and reconcile cash drawers."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Cash drawers will appear here once setup is
            complete.
          </div>
        </div>
      </div>
    );
  }

  const [live, employees, summary] = await Promise.all([
    liveRegisters(),
    listEmployees(),
    cashDrawerSummary(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Cash Management"
        subtitle="Count drawers in and out (blind), record cash drops to the safe, and reconcile over/short. The shared manager till adds a next-morning verify step."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Sell" }, { label: "Cash Management" }]} />
        }
        help={
          <HelpPanel
            id="cash-management"
            title="The daily cash drawer cycle"
            steps={[
              "Start of shift: pick your register and count your starting cash (count-in).",
              "During the day: record cash drops to the safe (afternoon and night).",
              "End of shift: count your drawer out — you won't see the expected amount (blind count).",
              "A manager enters the day's cash sales to reconcile and reveal the over/short (overage/shortage).",
              "The shared manager till is independently re-counted and verified the next morning.",
            ]}
          >
            <p>
              All amounts are counted by denomination, to the penny. The closing employee never sees
              the expected total — blind counts keep balancing honest. This mirrors the cash-drawer
              workflow used by Square, Toast, and Lightspeed.
            </p>
          </HelpPanel>
        }
        action={
          canManage ? (
            <Button href={`${BASE}/history`} variant="neutral" size="sm">
              Cash drawer reports
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.opened && <Flash>Drawer opened (counted in).</Flash>}
        {sp.closed && <Flash>Drawer closed — count recorded. A manager will reconcile it.</Flash>}
        {sp.dropped && <Flash>Cash drop recorded.</Flash>}
        {sp.reconciled !== undefined && <Flash>Reconciled — {overShortLabel(Number(sp.reconciled))}.</Flash>}
        {sp.verified !== undefined && <Flash>Till verified — variance {formatCents(Number(sp.verified))}.</Flash>}

        {/* Today at a glance */}
        <Section title="Today at a glance">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Open drawers"
              value={summary.openCount}
              hint={`${summary.registerCount} registers`}
              accent={summary.openCount > 0 ? "green" : "muted"}
            />
            <StatCard
              label="Starting cash (open)"
              value={formatCents(summary.startingCashOpenMinor)}
              accent="muted"
            />
            <StatCard
              label="Dropped to safe"
              value={formatCents(summary.droppedOpenMinor)}
              hint="open drawers"
              accent="gold"
            />
            <StatCard
              label="Awaiting reconcile"
              value={summary.awaitingReconcile}
              accent={summary.awaitingReconcile > 0 ? "orange" : "muted"}
            />
            <StatCard
              label="Net over / short today"
              value={overShortLabel(summary.netOverShortTodayMinor)}
              hint={`${summary.reconciledToday} reconciled`}
              accent={
                summary.netOverShortTodayMinor === 0
                  ? "green"
                  : summary.netOverShortTodayMinor > 0
                    ? "gold"
                    : "orange"
              }
            />
          </div>
        </Section>

        {/* Needs attention — manager reconcile / verify (only when non-empty) */}
        {canManage && <ManagerActions employees={employees} />}

        {/* Cash drawers — live grid */}
        <Section
          title="Cash drawers"
          description="Each register's current drawer. Count in to open; drop and blind-close during the day."
        >
          {live.length === 0 ? (
            <EmptyState
              title="No registers configured"
              description="Registers are seeded by the database. Once present, they'll appear here."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {live.map(({ register, openSession, dropsMinor }) => (
                <Card key={register.id} padding="md">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="flex-1 text-sm font-semibold text-[var(--admin-text)]">
                      {register.name}
                    </h3>
                    {register.kind === "manager_till" ? (
                      <Badge tone="gold">manager till</Badge>
                    ) : (
                      <Badge tone="outline">sales</Badge>
                    )}
                    {openSession ? <Badge tone="green">open</Badge> : <Badge tone="neutral">closed</Badge>}
                  </div>

                  {!openSession ? (
                    /* COUNT IN */
                    <form action={openDrawerAction} className="space-y-3">
                      <input type="hidden" name="register_id" value={register.id} />
                      <p className="text-xs text-[var(--admin-text-faint)]">
                        Count your starting cash:
                      </p>
                      <EmployeePicker
                        employees={employees}
                        name="employee_id"
                        defaultRole={register.kind === "manager_till" ? "manager" : "sales"}
                      />
                      <DenomFields />
                      <Button type="submit">Count in &amp; open</Button>
                    </form>
                  ) : (
                    /* OPEN: drop + close */
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <Stat label="Starting cash" value={formatCents(openSession.opening_count_minor)} />
                        <Stat label="Dropped so far" value={formatCents(dropsMinor)} />
                      </div>

                      {/* Cash drop */}
                      <details className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-muted)]">
                          Record a cash drop
                        </summary>
                        <form action={recordDropAction} className="mt-3 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="session_id" value={openSession.id} />
                          <div className="w-28">
                            <Input name="amount" placeholder="$ amount" inputMode="decimal" />
                          </div>
                          <Select name="drop_window" defaultValue="afternoon" className="w-32">
                            <option value="afternoon">Afternoon</option>
                            <option value="night">Night</option>
                            <option value="other">Other</option>
                          </Select>
                          <EmployeePicker employees={employees} name="dropped_by" compact />
                          <Button type="submit" variant="neutral">Drop</Button>
                        </form>
                      </details>

                      {/* Blind close */}
                      <details className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-muted)]">
                          Count out (blind close)
                        </summary>
                        <form action={closeDrawerAction} className="mt-3 space-y-3">
                          <input type="hidden" name="session_id" value={openSession.id} />
                          <p className="text-[11px] text-[var(--admin-text-faint)]">
                            You won&apos;t see the expected total — count honestly.
                          </p>
                          <EmployeePicker employees={employees} name="employee_id" />
                          <DenomFields />
                          <Button type="submit">Count out &amp; close</Button>
                        </form>
                      </details>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Flash({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
      <p className="text-[10px] uppercase text-[var(--admin-text-faint)]">{label}</p>
      <p className="text-sm font-semibold text-[var(--admin-text)]">{value}</p>
    </div>
  );
}

function EmployeePicker({
  employees,
  name,
  defaultRole,
  compact,
}: {
  employees: Awaited<ReturnType<typeof listEmployees>>;
  name: string;
  defaultRole?: string;
  compact?: boolean;
}) {
  const preferred = defaultRole ? employees.find((e) => e.job_role === defaultRole)?.id : undefined;
  return (
    <Select name={name} defaultValue={preferred ?? ""} className={compact ? "w-40" : ""}>
      <option value="">Select employee…</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>{e.full_name}</option>
      ))}
    </Select>
  );
}

async function ManagerActions({
  employees,
}: {
  employees: Awaited<ReturnType<typeof listEmployees>>;
}) {
  const sessions = await recentSessions(30);
  const closed = sessions.filter((s) => s.status === "closed");
  if (closed.length === 0) return null;

  return (
    <Section
      title="Needs attention"
      description="Blind-closed drawers awaiting a manager reconcile (and manager-till verify)"
    >
      <Card accent="orange" padding="md">
        <div className="space-y-3">
          {closed.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
            >
              <p className="mb-2 text-sm font-semibold text-[var(--admin-text)]">
                {s.register_name}{" "}
                <span className="text-xs font-normal text-[var(--admin-text-faint)]">
                  · {s.business_day}
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Reconcile */}
                <form
                  action={reconcileDrawerAction}
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--admin-border)] p-2"
                >
                  <input type="hidden" name="session_id" value={s.id} />
                  <div className="w-32">
                    <Input name="cash_sales" placeholder="$ cash sales" inputMode="decimal" />
                  </div>
                  <EmployeePicker employees={employees} name="reconciled_by" compact />
                  <Button type="submit" variant="neutral">Reconcile</Button>
                </form>
                {/* Verify (manager till) */}
                <details className="rounded-lg border border-[var(--admin-border)] p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--admin-text-muted)]">
                    Verify (manager till)
                  </summary>
                  <form action={verifyTillAction} className="mt-2 space-y-2">
                    <input type="hidden" name="session_id" value={s.id} />
                    <EmployeePicker employees={employees} name="verified_by" compact />
                    <DenomFields />
                    <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
                      <input type="checkbox" name="agrees" defaultChecked className="h-4 w-4" />
                      Counts agree
                    </label>
                    <Button type="submit" variant="neutral">Verify &amp; validate</Button>
                  </form>
                </details>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Badge } from "@/components/admin/ui";
import { listEmployees, onTheClock, listRecentShifts } from "@/lib/staffing/store";
import { formatMinutes, punchMinutes } from "@/lib/staffing/time";
import { pacificParts } from "@/lib/reports/timezone";
import { can } from "@/lib/auth/roles";
import { clockToggleAction, clockByPinAction } from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/staffing";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const p = pacificParts(iso);
  const h12 = ((p.hour + 11) % 12) + 1;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return `${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

export default async function StaffingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; clocked?: string; who?: string; saved?: string }>;
}) {
  const session = await requirePermission("loyalty.view");
  const canManage = can(session.profile.role, "staffing.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Time Clock" subtitle="Clock in and out and track shifts." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. The time clock will appear
            here once setup is complete.
          </div>
        </div>
      </div>
    );
  }

  const [employees, clockedIn, recentShifts] = await Promise.all([
    listEmployees(),
    onTheClock(),
    canManage ? listRecentShifts(40) : Promise.resolve([]),
  ]);

  const clockedIds = new Set(clockedIn.map((c) => c.employee.id));
  const nowISO = new Date().toISOString();

  return (
    <div>
      <AdminPageHeader
        title="Time Clock"
        subtitle="Employees clock in and out here. Each clock-in opens a shift for the day; Slice 26 ties drawer counts to these shifts."
        breadcrumbs={<Breadcrumbs items={[{ label: "Operations" }, { label: "Time Clock" }]} />}
        help={
          <HelpPanel
            id="timeclock"
            title="How the time clock works"
            steps={[
              "Tap your name to clock in. Tap it again to clock out.",
              "Or use the PIN pad — handy for a shared back-office station.",
              "Clocking in automatically opens your shift for the day.",
              "Managers can add employees, set PINs, and correct punches.",
            ]}
          >
            <p>All times are shown in Pacific. A clock-in with no matching clock-out stays “on the clock” until closed.</p>
          </HelpPanel>
        }
        action={
          canManage ? (
            <Link href={`${BASE}/employees`}>
              <Button variant="subtle">Manage employees</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {sp.clocked && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            {sp.who ? `${decodeURIComponent(sp.who)} ` : ""}clocked {sp.clocked === "in" ? "IN" : "OUT"}.
          </div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">Saved.</div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="On the clock" value={clockedIn.length} accent={clockedIn.length > 0 ? "green" : "muted"} />
          <StatCard label="Active employees" value={employees.length} accent="muted" />
          <StatCard label="Now (Pacific)" value={fmtTime(nowISO)} accent="gold" />
        </div>

        {/* Currently on the clock */}
        {clockedIn.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[#7ed957]/30 bg-[#7ed957]/5 p-5">
            <h3 className="mb-3 text-sm font-semibold text-[#7ed957]">On the clock now</h3>
            <ul className="space-y-2">
              {clockedIn.map(({ employee, punch }) => (
                <li key={punch.id} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 font-semibold text-white">{employee.full_name}</span>
                  <Badge tone="outline">{employee.job_role}</Badge>
                  <span className="text-white/50">since {fmtTime(punch.clock_in_at)}</span>
                  <span className="text-white/40">({formatMinutes(punchMinutes(punch.clock_in_at, nowISO))})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* PIN pad */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Clock in/out by PIN</h3>
          <form action={clockByPinAction} className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="4–6 digit PIN" autoComplete="off" />
            </div>
            <Button type="submit">Clock in / out</Button>
          </form>
        </div>

        {/* Tap-to-clock grid */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-white">Tap your name</h3>
          {employees.length === 0 ? (
            <EmptyState icon="🧑‍🤝‍🧑" title="No employees yet" description={canManage ? "Add your team under Manage employees." : "Ask a manager to add you."} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {employees.map((e) => {
                const isIn = clockedIds.has(e.id);
                return (
                  <form key={e.id} action={clockToggleAction}>
                    <input type="hidden" name="employee_id" value={e.id} />
                    <button
                      type="submit"
                      className={`admin-card-interactive flex w-full items-center justify-between rounded-[var(--admin-radius-lg)] border px-4 py-3 text-left ${
                        isIn
                          ? "border-[#7ed957]/40 bg-[#7ed957]/10"
                          : "border-[var(--admin-border)] bg-[var(--admin-surface)]"
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-white">{e.full_name}</span>
                        <span className="text-xs text-white/40">{e.job_role}</span>
                      </span>
                      <span className={`text-xs font-semibold ${isIn ? "text-[#7ed957]" : "text-white/50"}`}>
                        {isIn ? "Clock OUT" : "Clock IN"}
                      </span>
                    </button>
                  </form>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent shifts (managers) */}
        {canManage && recentShifts.length > 0 && (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Recent shifts</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-white/40">
                    <th className="py-2 pr-4">Day</th>
                    <th className="py-2 pr-4">Employee</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Started</th>
                    <th className="py-2 pr-4">Ended</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShifts.map((s) => (
                    <tr key={s.id} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-4 text-white/70">{s.business_day}</td>
                      <td className="py-2 pr-4 text-white">{s.employee_name}</td>
                      <td className="py-2 pr-4 text-white/60">{s.shift_role}</td>
                      <td className="py-2 pr-4 text-white/60">{fmtTime(s.started_at)}</td>
                      <td className="py-2 pr-4 text-white/60">{fmtTime(s.ended_at)}</td>
                      <td className="py-2">
                        {s.status === "open" ? (
                          <Badge tone="green">open</Badge>
                        ) : s.status === "closed" ? (
                          <Badge tone="neutral">closed</Badge>
                        ) : (
                          <Badge tone="gold">scheduled</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

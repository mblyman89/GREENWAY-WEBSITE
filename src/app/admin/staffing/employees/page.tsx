import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Field, Input, Select, Button, Badge } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { listEmployeeFiles, rosterOverview } from "@/lib/staffing/employee-lifecycle-store";
import { currentVersionAckMap } from "@/lib/staffing/handbook-ack-store";
import { HANDBOOK_VERSION } from "@/lib/staffing/handbook-content";
import {
  STATUS_LABELS,
  type EmploymentStatus,
  minutesLabel,
} from "@/lib/staffing/employee-lifecycle-core";
import { HrAdvisorPanel } from "@/components/admin/staffing/HrAdvisorPanel";
import { isAiConfigured } from "@/lib/ai/provider";
import { createEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/staffing";
const ROLES = ["sales", "manager", "lead", "other"] as const;

const STATUS_TONE: Record<EmploymentStatus, "green" | "gold" | "orange" | "neutral"> = {
  active: "green",
  onboarding: "gold",
  candidate: "neutral",
  terminated: "orange",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requirePermission("staffing.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Employees" subtitle="Manage your workforce roster." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet.
          </div>
        </div>
      </div>
    );
  }

  const [{ rows: employees, migrationApplied }, overview, handbookAcks] = await Promise.all([
    listEmployeeFiles(),
    rosterOverview(),
    currentVersionAckMap(),
  ]);

  const working = employees.filter(
    (e) => (e.employment_status ?? (e.active ? "active" : "terminated")) !== "terminated",
  );
  const terminated = employees.filter(
    (e) => (e.employment_status ?? (e.active ? "active" : "terminated")) === "terminated",
  );

  return (
    <div>
      <AdminPageHeader
        title="Employee command center"
        subtitle="Hiring, onboarding, documents, training, schedules, time, and offboarding — everything a professional operation tracks, sized for a small team."
        breadcrumbs={<Breadcrumbs items={[{ label: "Employees" }, { label: "Roster" }]} />}
        action={
          <div className="flex gap-2">
            <Link href={`${BASE}/schedule`}>
              <Button variant="neutral" size="sm">Schedule</Button>
            </Link>
            <Link href={`${BASE}/hours`}>
              <Button variant="neutral" size="sm">Hours</Button>
            </Link>
            <Link href={`${BASE}/handbook`}>
              <Button variant="neutral" size="sm">Handbook</Button>
            </Link>
            <Link href={BASE}>
              <Button variant="neutral" size="sm">Time clock</Button>
            </Link>
          </div>
        }
        help={
          <HelpPanel
            id="employee-command-center"
            title="Running your team from here"
            steps={[
              "Hiring someone? Add them below as a CANDIDATE, then open their file and click Start onboarding.",
              "The file walks you through the legal order: qualify → conditional offer → background check (RCW 49.94), then I-9 / W-4 / handbook / training / badge.",
              "The Activate button unlocks only when the required compliance steps are done.",
              "Documents (W-4, I-9, signed handbook) are tracked per employee — the cards above flag anything missing.",
              "Letting someone go? Open their file and use the Terminate box; it clears their PIN and opens the offboarding checklist.",
              "Employee files are never deleted — the LCB requires 5 years of records (WAC 314-55-087).",
            ]}
          >
            <p>
              Time clock, schedule builder, hours, payroll, and the printable handbook are one click
              away in the header.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        )}
        {!migrationApplied && employees.length > 0 && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Migration 0117 hasn&apos;t been applied yet — apply{" "}
            <code>0117_employee_command_center.sql</code> in the Supabase SQL editor to unlock
            onboarding checklists, document tracking, and the training log.
          </div>
        )}
        {!handbookAcks.migrationApplied && employees.length > 0 && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Migration 0136 hasn&apos;t been applied yet — apply{" "}
            <code>0136_handbook_acknowledgments.sql</code> in the Supabase SQL editor to turn on the
            digital handbook acknowledgment gate (until then, the back office and registers stay
            open to everyone on the roster).
          </div>
        )}

        {/* Health cards */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Team"
            value={overview.counts.active}
            hint={`${overview.counts.onboarding} onboarding · ${overview.counts.candidate} candidates`}
            accent="green"
            icon="🧑‍🤝‍🧑"
          />
          <StatCard
            label="Missing critical docs"
            value={overview.missingDocs.length}
            hint={
              overview.missingDocs.length === 0
                ? "W-4, I-9, signed handbook all on file"
                : overview.missingDocs
                    .slice(0, 2)
                    .map((m) => `${m.name.split(" ")[0]}: ${m.missing.join("+")}`)
                    .join(" · ")
            }
            accent={overview.missingDocs.length === 0 ? "green" : "orange"}
            icon="📄"
          />
          <StatCard
            label="Expiring credentials"
            value={overview.expiringCredentials.length}
            hint={
              overview.expiringCredentials.length === 0
                ? "Nothing lapsing within 60 days"
                : overview.expiringCredentials
                    .slice(0, 2)
                    .map((c) => `${c.name.split(" ")[0]} ${c.expiresOn}`)
                    .join(" · ")
            }
            accent={overview.expiringCredentials.length === 0 ? "green" : "gold"}
            icon="⏳"
          />
          <StatCard
            label="Sick leave accrued"
            value={minutesLabel(overview.totalSickLeaveMinutes)}
            hint="Team total, 1 hr per 40 worked (RCW 49.46.210)"
            accent="muted"
            icon="🩺"
          />
        </div>

        {/* AI HR helper */}
        <HrAdvisorPanel aiEnabled={isAiConfigured} />

        {/* Add */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h3 className="mb-1 text-sm font-semibold text-white">Add a person</h3>
          <p className="mb-4 text-xs text-white/50">
            New hires start as a roster row — open their file afterwards to run onboarding. Set the
            PIN later, once they&apos;re cleared to work.
          </p>
          <form action={createEmployeeAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name" required className="lg:col-span-2">
              <Input name="full_name" placeholder="e.g. Jordan Smith" required />
            </Field>
            <Field label="Job role">
              <Select name="job_role" defaultValue="sales">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Clock PIN" help="4–6 digits (optional).">
              <Input name="clock_pin" inputMode="numeric" pattern="\d{4,6}" placeholder="e.g. 1234" autoComplete="off" />
            </Field>
            <div className="flex items-end lg:col-span-4">
              <Button type="submit">Add to roster</Button>
            </div>
          </form>
        </div>

        {/* Roster */}
        {employees.length === 0 ? (
          <EmptyState icon="🧑‍🤝‍🧑" title="No employees yet" description="Add your first team member above." />
        ) : (
          <div className="space-y-3">
            {working.map((e) => {
              const status = (e.employment_status ?? (e.active ? "active" : "terminated")) as EmploymentStatus;
              return (
                <Link
                  key={e.id}
                  href={`${BASE}/employees/${e.id}`}
                  className="flex items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 transition hover:border-white/25"
                >
                  <span className="flex-1 text-sm font-semibold text-white">{e.full_name}</span>
                  <Badge tone="outline">{e.job_role}</Badge>
                  {e.hire_date && <span className="hidden text-xs text-white/40 sm:inline">hired {e.hire_date}</span>}
                  {e.staff_id && <Badge tone="neutral">login</Badge>}
                  {e.staff_id &&
                    handbookAcks.migrationApplied &&
                    (handbookAcks.ackedAtByStaffId.has(e.staff_id) ? (
                      <Badge tone="green">handbook v{HANDBOOK_VERSION} ✓</Badge>
                    ) : (
                      <Badge tone="gold">handbook pending</Badge>
                    ))}
                  {e.clock_pin && <Badge tone="neutral">PIN set</Badge>}
                  <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                  <span className="text-white/30">→</span>
                </Link>
              );
            })}
            {terminated.length > 0 && (
              <details className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm text-white/50">
                  Former employees ({terminated.length}) — records kept 5 years (WAC 314-55-087)
                </summary>
                <div className="space-y-2 border-t border-[var(--admin-border)] px-4 py-3">
                  {terminated.map((e) => (
                    <Link
                      key={e.id}
                      href={`${BASE}/employees/${e.id}`}
                      className="flex items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-black/20 px-3 py-2 text-sm hover:border-white/25"
                    >
                      <span className="flex-1 text-white/70">{e.full_name}</span>
                      {e.termination_date && (
                        <span className="text-xs text-white/40">left {e.termination_date}</span>
                      )}
                      <Badge tone="orange">Terminated</Badge>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

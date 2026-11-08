import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { listEmployees, listPunchesForDayAll } from "@/lib/staffing/store";
import { pacificParts, pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { can } from "@/lib/auth/roles";
import { backHref } from "@/lib/admin/back-link-core";
import { BREAK_FLAG_TEXT, dayBreakFlags } from "@/lib/staffing/break-clock-core";
import {
  HoursManager,
  type HoursPunchRow,
  type HoursEmployeeOption,
} from "@/components/admin/staffing/HoursManager";

export const dynamic = "force-dynamic";

const BASE = "/admin/staffing";

/** UTC ISO → Pacific datetime-local string "YYYY-MM-DDTHH:mm". */
function toPacificLocal(iso: string | null): string {
  if (!iso) return "";
  const p = pacificParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; back?: string }>;
}) {
  const session = await requirePermission("staffing.manage");
  can(session.profile.role, "staffing.manage");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Adjust Hours" subtitle="Time clock is unavailable — the database is not configured." />
      </div>
    );
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : pacificToday();
  const prevDay = addPacificDays(day, -1);
  const nextDay = addPacificDays(day, 1);

  const [employees, punches] = await Promise.all([
    listEmployees(),
    listPunchesForDayAll(day),
  ]);

  const rows: HoursPunchRow[] = punches.map((p) => ({
    id: p.id,
    employeeName: p.employee_name,
    jobRole: p.job_role,
    source: p.source,
    minutes: p.minutes,
    inLocal: toPacificLocal(p.clock_in_at),
    outLocal: toPacificLocal(p.clock_out_at),
    note: p.notes,
    kind: p.punch_kind === "break" ? "break" : "work",
    breakReason: p.break_reason ?? null,
    breakNote: p.break_note ?? null,
  }));
  // D211 — meal-break checks for the day (WAC 296-126-092): flags, not blocks.
  const flags = dayBreakFlags(
    punches.map((p) => ({
      employeeId: p.employee_id,
      kind: p.punch_kind === "break" ? ("break" as const) : ("work" as const),
      reason: p.break_reason ?? null,
      clockInIso: p.clock_in_at,
      clockOutIso: p.clock_out_at,
    })),
  );
  const nameById = new Map(punches.map((p) => [p.employee_id, p.employee_name]));

  const empOptions: HoursEmployeeOption[] = employees.map((e) => ({ id: e.id, name: e.full_name }));
  const defaultInLocal = `${day}T09:00`;

  return (
    <div>
      <AdminPageHeader
        title="Adjust Hours"
        subtitle="Correct missed clock-outs, fix punch times, or add a punch someone forgot. Every change requires a reason and is logged."
        breadcrumbs={<Breadcrumbs items={[{ label: "Operations" }, { label: "Time Clock", href: BASE }, { label: "Adjust Hours" }]} />}
        help={
          <HelpPanel
            id="adjust-hours"
            title="How to adjust hours"
            steps={[
              "Pick the business day with the date arrows.",
              "Tap Adjust on a punch to change the clock-in or clock-out time.",
              "Use “Add missing punch” when someone forgot to clock in entirely.",
              "A reason is required on every change and is saved to the audit log.",
              "Lunch and Other breaks show as gold “break (unpaid)” rows. Use Add missing punch → Punch type to record a break someone forgot to clock (D211).",
              "Meal-break checks below are reminders of WAC 296-126-092, not blocks.",
            ]}
          >
            <p>All times are Pacific. Editing a punch recomputes worked minutes automatically.</p>
          </HelpPanel>
        }
        action={
          <Button href={backHref(BASE, sp.back)} variant="neutral">
            Back to time clock
          </Button>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="flex items-center justify-between rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
          <Link href={`?day=${prevDay}`}>
            <Button variant="neutral" size="sm">← Prev day</Button>
          </Link>
          <span className="text-sm font-semibold text-white">{dayLabel(day)}</span>
          <Link href={`?day=${nextDay}`}>
            <Button variant="neutral" size="sm">Next day →</Button>
          </Link>
        </div>

        {flags.length > 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-4 text-sm">
            <h3 className="mb-2 font-semibold text-[var(--admin-gold)]">Meal-break checks for this day</h3>
            <ul className="space-y-1">
              {flags.map((f, i) => (
                <li key={`${f.employeeId}-${f.code}-${i}`} className="text-white/80">
                  <span className="font-semibold text-white">{nameById.get(f.employeeId) ?? "Employee"}</span>: {BREAK_FLAG_TEXT[f.code].label} ({f.detail}).{" "}
                  <span className="text-white/50">{BREAK_FLAG_TEXT[f.code].rule}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <HoursManager
          punches={rows}
          employees={empOptions}
          dayLabel={dayLabel(day)}
          defaultInLocal={defaultInLocal}
        />
      </div>
    </div>
  );
}

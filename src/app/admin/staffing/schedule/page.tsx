import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { listEmployees, listScheduledShiftsForWeek } from "@/lib/staffing/store";
import { mondayOf, weekDays, addDaysYmd } from "@/lib/staffing/schedule-core";
import { pacificParts, pacificDayKey } from "@/lib/reports/timezone";
import { ScheduleBuilder } from "@/components/admin/staffing/ScheduleBuilder";

export const dynamic = "force-dynamic";

function hmFromISO(iso: string | null): { h: number; m: number } | null {
  if (!iso) return null;
  const p = pacificParts(iso);
  return { h: p.hour, m: p.minute };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requirePermission("staffing.manage");
  const sp = await searchParams;

  // Default to the current Pacific week.
  const todayYmd = pacificDayKey(new Date());
  const requested = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : todayYmd;
  const monday = mondayOf(requested);
  const days = weekDays(monday);
  const weekEnd = days[6];

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Schedule builder" subtitle="Plan the week's shifts." breadcrumbs={<Breadcrumbs items={[{ label: "Operations" }, { label: "Time Clock", href: "/admin/staffing" }, { label: "Schedule" }]} />} />
        <div className="px-5 py-6 sm:px-8">
          <EmptyState title="Supabase not configured" description="Connect the service role key to build schedules." />
        </div>
      </div>
    );
  }

  const [employees, shifts] = await Promise.all([
    listEmployees(),
    listScheduledShiftsForWeek(monday, weekEnd),
  ]);

  const activeEmployees = employees
    .filter((e) => e.active)
    .map((e) => ({ id: e.id, full_name: e.full_name, job_role: e.job_role }));

  const shiftLites = shifts.map((s) => ({
    id: s.id,
    employee_id: s.employee_id,
    business_day: s.business_day,
    shift_role: s.shift_role,
    status: s.status,
    start_hm: hmFromISO(s.scheduled_start),
    end_hm: hmFromISO(s.scheduled_end),
    notes: s.notes,
  }));

  return (
    <div>
      <AdminPageHeader
        title="Schedule builder"
        subtitle="Plan the week's shifts on a grid. Scheduled shifts appear on the time clock; employees clock into them."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Operations" }, { label: "Time Clock", href: "/admin/staffing" }, { label: "Schedule" }]} />
        }
        help={
          <HelpPanel
            id="schedule-builder"
            title="Building the schedule"
            steps={[
              "Use Prev / Next week to move around. Today's week loads first.",
              "Click “+ shift” in any employee/day cell to add a shift; pick start, end, and role.",
              "Edit or remove a scheduled shift with the small edit / × buttons on its chip.",
              "“Copy to next week” duplicates every scheduled shift onto the following week.",
            ]}
          >
            <p>Times are Pacific. Coverage totals per day show at the top of each column.</p>
          </HelpPanel>
        }
        action={
          <Link href="/admin/staffing">
            <Button variant="neutral">Back to time clock</Button>
          </Link>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <ScheduleBuilder
          mondayYmd={monday}
          employees={activeEmployees}
          shifts={shiftLites}
          prevMonday={addDaysYmd(monday, -7)}
          nextMonday={addDaysYmd(monday, 7)}
        />
      </div>
    </div>
  );
}

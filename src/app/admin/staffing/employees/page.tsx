import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Field, Input, Select, Textarea, Button, Badge } from "@/components/admin/ui";
import { listEmployees } from "@/lib/staffing/store";
import { createEmployeeAction, updateEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/staffing";
const ROLES = ["sales", "manager", "lead", "other"] as const;

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

  const employees = await listEmployees({ includeInactive: true });

  return (
    <div>
      <AdminPageHeader
        title="Employees"
        subtitle="Your workforce roster. Set a clock-in PIN so floor staff can punch in at a shared station, and a job role that drives drawer assignment."
        breadcrumbs={<Breadcrumbs items={[{ label: "Operations" }, { label: "Time Clock", href: BASE }, { label: "Employees" }]} />}
        action={<Link href={BASE}><Button variant="subtle">← Back to clock</Button></Link>}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{decodeURIComponent(sp.error)}</div>
        )}
        {sp.saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">Saved.</div>
        )}

        {/* Add */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Add an employee</h3>
          <form action={createEmployeeAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name" required className="lg:col-span-2">
              <Input name="full_name" placeholder="e.g. Jordan Smith" required />
            </Field>
            <Field label="Job role">
              <Select name="job_role" defaultValue="sales">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Clock PIN" help="4–6 digits (optional).">
              <Input name="clock_pin" inputMode="numeric" pattern="\d{4,6}" placeholder="e.g. 1234" autoComplete="off" />
            </Field>
            <div className="flex items-end lg:col-span-4">
              <Button type="submit">Add employee</Button>
            </div>
          </form>
        </div>

        {/* List */}
        {employees.length === 0 ? (
          <EmptyState icon="🧑‍🤝‍🧑" title="No employees yet" description="Add your first team member above." />
        ) : (
          <div className="space-y-3">
            {employees.map((e) => (
              <details key={e.id} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm font-semibold text-white">{e.full_name}</span>
                  <Badge tone="outline">{e.job_role}</Badge>
                  {e.staff_id && <Badge tone="neutral">login</Badge>}
                  {e.clock_pin && <Badge tone="neutral">PIN set</Badge>}
                  {e.active ? <Badge tone="green">active</Badge> : <Badge tone="gold">inactive</Badge>}
                </summary>
                <div className="border-t border-[var(--admin-border)] px-4 py-4">
                  <form action={updateEmployeeAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <input type="hidden" name="id" value={e.id} />
                    <Field label="Full name" required className="lg:col-span-2">
                      <Input name="full_name" defaultValue={e.full_name} required />
                    </Field>
                    <Field label="Job role">
                      <Select name="job_role" defaultValue={e.job_role}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    </Field>
                    <Field label="Clock PIN" help="4–6 digits.">
                      <Input name="clock_pin" defaultValue={e.clock_pin ?? ""} inputMode="numeric" pattern="\d{4,6}" autoComplete="off" />
                    </Field>
                    <Field label="Notes" className="lg:col-span-3">
                      <Textarea name="notes" defaultValue={e.notes ?? ""} />
                    </Field>
                    <label className="flex items-end gap-2 text-sm text-white/70">
                      <input type="checkbox" name="active" defaultChecked={e.active} className="mb-2 h-4 w-4" />
                      Active
                    </label>
                    <div className="flex items-end lg:col-span-4">
                      <Button type="submit">Save</Button>
                    </div>
                  </form>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

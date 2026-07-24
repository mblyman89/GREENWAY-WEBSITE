import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState, StickyActionBar } from "@/components/admin/ux";
import { Button, Badge, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { getEmployeeFile, taskStateOf } from "@/lib/staffing/employee-lifecycle-store";
import {
  ONBOARDING_TASKS,
  OFFBOARDING_TASKS,
  PHASE_LABELS,
  STATUS_LABELS,
  EMPLOYEE_DOCUMENTS,
  DOCUMENT_STATUS_LABELS,
  REQUIRED_TRAINING_TOPICS,
  type OnboardingPhase,
  type EmploymentStatus,
  complianceDeadlines,
  activationBlockers,
  onboardingProgress,
  offboardingProgress,
  taskOrderViolation,
  minutesLabel,
} from "@/lib/staffing/employee-lifecycle-core";
import {
  toggleTaskAction,
  setDocumentAction,
  addTrainingAction,
  updateHireInfoAction,
  setStatusAction,
} from "./actions";
import { updateEmployeeAction } from "../../actions";
import { backHref } from "@/lib/admin/back-link-core";

export const dynamic = "force-dynamic";

const BASE = "/admin/staffing/employees";

const STATUS_TONE: Record<EmploymentStatus, "green" | "gold" | "orange" | "neutral"> = {
  active: "green",
  onboarding: "gold",
  candidate: "neutral",
  terminated: "orange",
};

export default async function EmployeeFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; back?: string }>;
}) {
  await requirePermission("staffing.manage");
  const { id } = await params;
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Employee file" />
        <div className="px-5 py-6 sm:px-8">
          <EmptyState title="Supabase not configured" description="Connect the service role key first." />
        </div>
      </div>
    );
  }

  const file = await getEmployeeFile(id);
  if (!file) notFound();
  const { employee, migrationApplied } = file;

  const status = (employee.employment_status ?? (employee.active ? "active" : "terminated")) as EmploymentStatus;
  const taskState = taskStateOf(file.tasks);
  const blockers = activationBlockers(taskState);
  const progress = onboardingProgress(taskState);
  const offProgress = offboardingProgress(taskState);
  const docByKey = new Map(file.documents.map((d) => [d.doc_key, d]));
  const deadlines = employee.hire_date ? complianceDeadlines(employee.hire_date) : [];
  const todayYmd = new Date().toISOString().slice(0, 10);

  const phases: OnboardingPhase[] = ["hiring", "paperwork", "compliance", "ready"];

  return (
    <div>
      <AdminPageHeader
        title={employee.full_name}
        subtitle="The complete employee file: hiring checklist, documents, training, and offboarding — records are kept 5 years (WAC 314-55-087)."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Employees" },
              { label: "Roster", href: BASE },
              { label: employee.full_name },
            ]}
          />
        }
        action={
          <Button href={backHref(BASE, sp.back)} variant="neutral">
            ← Back to roster
          </Button>
        }
        help={
          <HelpPanel
            id="employee-file"
            title="How to use the employee file"
            steps={[
              "New hire? Set the status to Onboarding, then work the checklist top to bottom — the order matters legally (offer BEFORE background check).",
              "Enter the hire date first so the paperwork deadlines (I-9, DSHS report, sick-leave date) compute for you.",
              "Track each paper document in the tracker: mark the W-4 and I-9 'On file', and the handbook 'Read & signed'.",
              "Log every training session — the LCB requires 5-year training records.",
              "Activate the employee when the checklist allows it (the button unlocks when the required steps are done).",
              "Letting someone go? Use the Terminate box — it clears their PIN and opens the offboarding checklist.",
            ]}
          >
            <p>
              Never delete an employee — terminated files stay on the roster because the LCB requires
              five years of employee records on premises.
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
        {sp.ok && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {decodeURIComponent(sp.ok)}
          </div>
        )}
        {!migrationApplied && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Migration 0117 hasn&apos;t been applied yet — apply{" "}
            <code>0117_employee_command_center.sql</code> in the Supabase SQL editor to unlock the
            checklist, document tracker, and training log.
          </div>
        )}

        {/* Status + lifecycle */}
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
              <span className="text-sm text-white/60">
                {status === "onboarding" || status === "candidate"
                  ? `Onboarding ${progress}% complete`
                  : status === "terminated"
                    ? `Offboarding ${offProgress}% complete${employee.termination_date ? ` · left ${employee.termination_date}` : ""}`
                    : employee.hire_date
                      ? `Hired ${employee.hire_date}`
                      : "Hire date not set"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {status === "candidate" && migrationApplied && (
                <form action={setStatusAction}>
                  <input type="hidden" name="employee_id" value={employee.id} />
                  <input type="hidden" name="to" value="onboarding" />
                  <Button type="submit" size="sm">
                    Start onboarding
                  </Button>
                </form>
              )}
              {status === "onboarding" && migrationApplied && (
                <form action={setStatusAction}>
                  <input type="hidden" name="employee_id" value={employee.id} />
                  <input type="hidden" name="to" value="active" />
                  <Button type="submit" size="sm" disabled={blockers.length > 0}>
                    {blockers.length > 0 ? `Activate (${blockers.length} required steps left)` : "Activate employee"}
                  </Button>
                </form>
              )}
              {status === "terminated" && migrationApplied && (
                <form action={setStatusAction}>
                  <input type="hidden" name="employee_id" value={employee.id} />
                  <input type="hidden" name="to" value="onboarding" />
                  <Button type="submit" size="sm" variant="neutral">
                    Rehire (restart onboarding)
                  </Button>
                </form>
              )}
            </div>
          </div>
          {status === "onboarding" && blockers.length > 0 && (
            <p className="mt-3 text-xs text-white/50">
              Required before activation: {blockers.join("; ")}.
            </p>
          )}
          {status === "terminated" && (
            <p className="mt-3 text-xs text-white/50">
              Reason on file: {employee.termination_reason ?? "—"} · Rehired within 12 months? Their
              unused sick-leave balance is reinstated (RCW 49.46.210).
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left 2/3: checklist + documents + training */}
          <div className="space-y-6 lg:col-span-2">
            {/* Onboarding checklist */}
            {migrationApplied && status !== "terminated" && (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">Onboarding checklist</h3>
                <p className="mt-1 text-xs text-white/50">
                  Work top to bottom. The hiring order is a legal requirement: the conditional offer
                  comes BEFORE the background check (WA Fair Chance Act, RCW 49.94.010).
                </p>
                <div className="mt-4 space-y-5">
                  {phases.map((phase) => (
                    <div key={phase}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                        {PHASE_LABELS[phase]}
                      </div>
                      <ul className="mt-2 space-y-2">
                        {ONBOARDING_TASKS.filter((t) => t.phase === phase).map((t) => {
                          const done = Boolean(taskState[t.key]);
                          const blocked = !done && taskOrderViolation(t.key, taskState) !== null;
                          const row = file.tasks.find((x) => x.task_key === t.key);
                          return (
                            <li
                              key={t.key}
                              className="flex items-start gap-3 rounded-lg border border-[var(--admin-border)] bg-black/20 px-3 py-2.5"
                            >
                              <form action={toggleTaskAction} className="mt-0.5">
                                <input type="hidden" name="employee_id" value={employee.id} />
                                <input type="hidden" name="task_key" value={t.key} />
                                <input type="hidden" name="done" value={done ? "false" : "true"} />
                                <button
                                  type="submit"
                                  aria-label={done ? `Uncheck ${t.label}` : `Check ${t.label}`}
                                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                                    done
                                      ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                                      : blocked
                                        ? "border-white/15 text-white/20"
                                        : "border-white/30 text-transparent hover:border-[var(--admin-accent)]"
                                  }`}
                                >
                                  ✓
                                </button>
                              </form>
                              <div className="min-w-0 flex-1">
                                <div className={`text-sm ${done ? "text-white/50 line-through" : "text-white/90"}`}>
                                  {t.label}
                                  {t.critical && !done && (
                                    <span className="ml-2 rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-gold)]">
                                      required
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-white/45">{t.help}</p>
                                {done && row?.done_at && (
                                  <p className="mt-0.5 text-[11px] text-white/30">
                                    Done {row.done_at.slice(0, 10)}
                                    {row.done_by ? ` by ${row.done_by}` : ""}
                                  </p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Offboarding checklist */}
            {migrationApplied && status === "terminated" && (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">Offboarding checklist</h3>
                <p className="mt-1 text-xs text-white/50">
                  Everything a professional operation does when someone leaves — final pay follows
                  RCW 49.48.010; records are kept 5 years.
                </p>
                <ul className="mt-4 space-y-2">
                  {OFFBOARDING_TASKS.map((t) => {
                    const done = Boolean(taskState[t.key]);
                    return (
                      <li
                        key={t.key}
                        className="flex items-start gap-3 rounded-lg border border-[var(--admin-border)] bg-black/20 px-3 py-2.5"
                      >
                        <form action={toggleTaskAction} className="mt-0.5">
                          <input type="hidden" name="employee_id" value={employee.id} />
                          <input type="hidden" name="task_key" value={t.key} />
                          <input type="hidden" name="done" value={done ? "false" : "true"} />
                          <button
                            type="submit"
                            aria-label={done ? `Uncheck ${t.label}` : `Check ${t.label}`}
                            className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                              done
                                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                                : "border-white/30 text-transparent hover:border-[var(--admin-accent)]"
                            }`}
                          >
                            ✓
                          </button>
                        </form>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm ${done ? "text-white/50 line-through" : "text-white/90"}`}>
                            {t.label}
                          </div>
                          <p className="mt-0.5 text-xs text-white/45">{t.help}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Document tracker */}
            {migrationApplied && (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">Document tracker</h3>
                <p className="mt-1 text-xs text-white/50">
                  The store keeps the paper (or scanned) documents; this tracker answers &ldquo;is it
                  on file?&rdquo; at a glance. Handbook must be READ &amp; SIGNED, not just on file.
                </p>
                <div className="mt-4 space-y-3">
                  {EMPLOYEE_DOCUMENTS.map((d) => {
                    const row = docByKey.get(d.key);
                    const st = row?.status ?? "missing";
                    return (
                      <details
                        key={d.key}
                        className="rounded-lg border border-[var(--admin-border)] bg-black/20"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                          <span className="flex-1 text-sm text-white/90">
                            {d.label}
                            {d.medicalOnly && (
                              <span className="ml-2 text-[10px] uppercase text-white/30">medical stores only</span>
                            )}
                          </span>
                          {row?.expires_on && (
                            <span
                              className={`text-[11px] ${row.expires_on <= todayYmd ? "text-red-300" : "text-white/40"}`}
                            >
                              expires {row.expires_on}
                            </span>
                          )}
                          <Badge tone={st === "signed" ? "green" : st === "on_file" ? "gold" : "neutral"}>
                            {DOCUMENT_STATUS_LABELS[st]}
                          </Badge>
                        </summary>
                        <div className="border-t border-[var(--admin-border)] px-3 py-3">
                          <p className="text-xs text-white/45">{d.help}</p>
                          <form action={setDocumentAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <input type="hidden" name="employee_id" value={employee.id} />
                            <input type="hidden" name="doc_key" value={d.key} />
                            <Field label="Status">
                              <Select name="status" defaultValue={st}>
                                <option value="missing">Missing</option>
                                <option value="on_file">On file</option>
                                {d.signable && <option value="signed">Read &amp; signed</option>}
                              </Select>
                            </Field>
                            <Field label={d.signable ? "Signed on" : "Received on"}>
                              <Input type="date" name="received_on" defaultValue={row?.received_on ?? ""} />
                            </Field>
                            {d.expires && (
                              <Field label="Expires on" help="Renews annually by the consultant's birthday.">
                                <Input type="date" name="expires_on" defaultValue={row?.expires_on ?? ""} />
                              </Field>
                            )}
                            <Field label="Notes" className={d.expires ? "" : "lg:col-span-2"}>
                              <Input name="notes" defaultValue={row?.notes ?? ""} placeholder="Optional" />
                            </Field>
                            <div className="flex items-end">
                              <Button type="submit" size="sm">
                                Save
                              </Button>
                            </div>
                          </form>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Training log */}
            {migrationApplied && (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">Training log</h3>
                <p className="mt-1 text-xs text-white/50">
                  RCW 69.50.357 requires training on store rules and under-21 ID checks; the record is
                  kept 5 years (WAC 314-55-087). Log every session here.
                </p>
                <form action={addTrainingAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <input type="hidden" name="employee_id" value={employee.id} />
                  <Field label="Topic" required className="lg:col-span-2">
                    <Input
                      name="topic"
                      required
                      list={`training-topics-${employee.id}`}
                      placeholder="e.g. Checking ID / identifying under-21"
                    />
                    <datalist id={`training-topics-${employee.id}`}>
                      {REQUIRED_TRAINING_TOPICS.map((t) => (
                        <option key={t.topic} value={t.topic} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Date" required>
                    <Input type="date" name="trained_on" required defaultValue={todayYmd} />
                  </Field>
                  <Field label="Trainer">
                    <Input name="trainer" placeholder="Who ran it" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="submit" size="sm">
                      Log training
                    </Button>
                  </div>
                </form>
                {file.training.length > 0 ? (
                  <ul className="mt-4 divide-y divide-white/5">
                    {file.training.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-24 shrink-0 text-white/40">{t.trained_on}</span>
                        <span className="flex-1 text-white/85">{t.topic}</span>
                        {t.trainer && <span className="text-xs text-white/40">by {t.trainer}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-xs text-white/40">No training logged yet.</p>
                )}
              </div>
            )}
          </div>

          {/* Right rail: basics, hire info, deadlines, sick leave, terminate */}
          <div className="space-y-6">
            {/* Basics */}
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="text-sm font-semibold text-white">Basics</h3>
              <p className="mt-1 text-xs text-white/50">
                Name, role, and time-clock PIN. Whether they can clock in is driven by the
                status above — activate or terminate there, not here.
              </p>
              <form action={updateEmployeeAction} className="mt-4 space-y-3">
                <input type="hidden" name="id" value={employee.id} />
                <input type="hidden" name="return_to" value="file" />
                <Field label="Full name" required>
                  <Input name="full_name" required defaultValue={employee.full_name} />
                </Field>
                <Field label="Job role">
                  <Select name="job_role" defaultValue={employee.job_role ?? "sales"}>
                    {["sales", "manager", "lead", "other"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="SAW username (for medical DOH check)"
                  help="Their SecureAccess Washington username ONLY — never a password. Shown at the register's medical card-verification step so they know which login to use. Leave blank if they don't verify medical cards."
                >
                  <Input
                    name="saw_username"
                    defaultValue={employee.saw_username ?? ""}
                    placeholder="e.g. jsmith (username only)"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="New clock PIN"
                  help="4–6 digits. Leave blank to keep the current PIN."
                >
                  <Input
                    name="clock_pin"
                    inputMode="numeric"
                    pattern="\d{4,6}"
                    placeholder="unchanged"
                    autoComplete="off"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" name="clear_pin" className="h-4 w-4" />
                  Remove their PIN (they can’t clock in until you set a new one)
                </label>
                <Field label="Notes">
                  <Textarea
                    name="notes"
                    rows={2}
                    defaultValue={employee.notes ?? ""}
                    placeholder="Anything worth remembering (kept on file)."
                  />
                </Field>
                {/* GW-035: pinned save — the basics form is the long one on
                    this file; keep its Save reachable without scrolling. */}
                <StickyActionBar status="Edits are not saved until you press Save basics" statusTone="warning">
                  <Button type="submit" size="sm">
                    Save basics
                  </Button>
                </StickyActionBar>
              </form>
            </div>

            {/* Hire info */}
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="text-sm font-semibold text-white">Hire info</h3>
              <p className="mt-1 text-xs text-white/50">
                The hire date is a required 5-year record (WAC 314-55-087) and drives the deadlines
                below.
              </p>
              <form action={updateHireInfoAction} className="mt-4 space-y-3">
                <input type="hidden" name="employee_id" value={employee.id} />
                <Field label="Hire date (first day of work)">
                  <Input type="date" name="hire_date" defaultValue={employee.hire_date ?? ""} disabled={!migrationApplied} />
                </Field>
                <Field label="Badge number" help="The WAC 314-55-083 photo badge you issued.">
                  <Input name="badge_number" defaultValue={employee.badge_number ?? ""} disabled={!migrationApplied} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input
                    type="checkbox"
                    name="age_21_verified"
                    defaultChecked={Boolean(employee.age_21_verified)}
                    disabled={!migrationApplied}
                    className="h-4 w-4"
                  />
                  I checked their photo ID — they are 21 or older
                </label>
                <Button type="submit" size="sm" disabled={!migrationApplied}>
                  Save hire info
                </Button>
              </form>
            </div>

            {/* Deadlines */}
            {deadlines.length > 0 && (
              <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">Deadlines from the hire date</h3>
                <ul className="mt-3 space-y-2.5">
                  {deadlines.map((d) => {
                    const overdue = d.dueYmd < todayYmd && d.key !== "sick_leave_usable";
                    return (
                      <li key={d.key} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/85">{d.label}</span>
                          <span className={overdue ? "font-semibold text-red-300" : "text-white/60"}>{d.dueYmd}</span>
                        </div>
                        <p className="text-xs text-white/40">{d.help}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Sick leave */}
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
              <h3 className="text-sm font-semibold text-white">Paid sick leave (WA)</h3>
              <p className="mt-2 text-2xl font-bold text-[var(--admin-accent)]">
                {minutesLabel(file.sickLeaveAccruedMinutes)}
              </p>
              <p className="mt-1 text-xs text-white/50">
                accrued from {minutesLabel(file.workedMinutes)} worked on the time clock (1 hr per 40
                worked, RCW 49.46.210). Usable from day 90; up to 40 hrs carries over each year. Show
                the balance at least monthly — it&apos;s on the payroll stub.
              </p>
            </div>

            {/* Terminate */}
            {migrationApplied && status !== "terminated" && (
              <div className="rounded-[var(--admin-radius-lg)] border border-red-500/30 bg-red-500/5 p-5">
                <h3 className="text-sm font-semibold text-red-300">Terminate employment</h3>
                <p className="mt-1 text-xs text-white/50">
                  Clears their time-clock PIN immediately and opens the offboarding checklist. Their
                  file is kept 5 years — nothing is deleted. Also deactivate any back-office login on{" "}
                  <Link href="/admin/users" className="underline">
                    Admin → Users
                  </Link>
                  .
                </p>
                <form action={setStatusAction} className="mt-3 space-y-3">
                  <input type="hidden" name="employee_id" value={employee.id} />
                  <input type="hidden" name="to" value="terminated" />
                  <Field label="Last day" required>
                    <Input type="date" name="termination_date" required defaultValue={todayYmd} />
                  </Field>
                  <Field label="Reason (kept on file)" required>
                    <Textarea name="termination_reason" required placeholder="e.g. Resigned with two weeks' notice" />
                  </Field>
                  <Button type="submit" size="sm" variant="danger">
                    Terminate
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

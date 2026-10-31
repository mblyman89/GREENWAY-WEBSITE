/**
 * src/app/admin/inventory/checklists/page.tsx  (Fix Phase 4.4b · G-38 · F-06-12)
 *
 * DAILY CHECKLISTS. The paper forms 8.5-8.8 of SOP-06, on screen.
 *
 * The owner, verbatim: "Checklists for daily tasks like cycle counts I
 * initiate via the inventory audit feature." and "the cycle counts and daily
 * checklists are for all employees, admin, manger, sales." (D51). So the page
 * is inventory.count (owner, admin, manager, staff), the same door as Cycle
 * Counts.
 *
 * What it does:
 *   - six lists (Opening, During the shift, Closing, Weekly, Monthly, Year end),
 *     each today's sheet (the Pacific day, the week's Monday, the month's 1st,
 *     1 January);
 *   - every task links to its SOP section or its screen;
 *   - each task is initialled with initials and the time (who is recorded from
 *     the sign-in);
 *   - the Cycle Counts line shows the live queue;
 *   - a manager signs the sheet off (a note when tasks are open);
 *   - the owner edits the catalog (D57) under "Edit the tasks";
 *   - recent sheets are listed (kept five years, WAC 314-55-087; 0327 refuses
 *     a delete).
 * Before migration 0327 is applied it says so and saves nothing.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/pos/format";
import { pacificToday } from "@/lib/reports/timezone";
import { listAuditSessions, COUNT_QUEUE_STATUSES } from "@/lib/inventory/audit-hub-store";
import { listSops } from "@/lib/sop-library/load.server";
import {
  CHECKLIST_KINDS,
  CHECKLIST_KIND_FORM,
  CHECKLIST_KIND_LABELS,
  canEditCatalog,
  canInitial,
  canSignOff,
  checklistPeriodKey,
  describeCountsLine,
  describePeriod,
  isChecklistKind,
  referenceLinks,
  suggestInitials,
  type ChecklistKind,
  type SopIndex,
} from "@/lib/inventory/daily-checklist-core";
import {
  CHECKLIST_MIGRATION_PENDING,
  getChecklistRun,
  listChecklistTasks,
  listChecklistTicks,
  listRecentRuns,
  type ChecklistTask,
} from "@/lib/inventory/daily-checklist-store";
import { addTaskAction, initialTaskAction, saveTaskAction, signOffAction } from "./actions";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const H2 = "mb-3 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]";
const INPUT = "rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-sm text-[var(--admin-text)]";
const BTN = "rounded-lg bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-white";
const BASE = "/admin/inventory/checklists";

export default async function DailyChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; error?: string; ok?: string; edit?: string }>;
}) {
  const session = await requirePermission("inventory.count");
  const role = session.profile.role;
  const sp = await searchParams;
  const kind: ChecklistKind = isChecklistKind(sp.list) ? sp.list : "opening";
  const today = pacificToday();
  const periodKey = checklistPeriodKey(kind, today);
  const editing = sp.edit === "1" && canEditCatalog(role);

  const [tasksRes, runRes, recentRes, sops] = await Promise.all([
    listChecklistTasks(kind),
    getChecklistRun(kind, periodKey),
    listRecentRuns(),
    listSops(),
  ]);
  const run = runRes.ok ? runRes.data : null;
  const ticksRes = run ? await listChecklistTicks(run.id) : null;
  const hasLive = tasksRes.ok && tasksRes.data.some((t) => t.active && t.liveLine === "cycle_counts");
  const queue = hasLive ? await listAuditSessions({ statuses: COUNT_QUEUE_STATUSES, limit: 50 }) : null;

  const missing =
    (!tasksRes.ok && tasksRes.missingSchema) || (!runRes.ok && runRes.missingSchema) || (!recentRes.ok && recentRes.missingSchema);
  const readError = !missing
    ? [tasksRes, runRes, recentRes, ticksRes].find((r) => r && !r.ok)
    : undefined;

  const sopIndex: SopIndex = Object.fromEntries(
    sops.map((d) => [d.slug, d.sections.map((s) => ({ id: s.id, text: s.text }))]),
  );
  const tasks = tasksRes.ok ? tasksRes.data : [];
  const active = tasks.filter((t) => t.active);
  const ticks = ticksRes && ticksRes.ok ? ticksRes.data : [];
  const tickByTask = new Map(ticks.map((t) => [t.taskId, t]));
  const openCount = active.filter((t) => !tickByTask.has(t.id)).length;
  const sections = [...new Set(active.map((t) => t.section))];
  const mayInitial = canInitial(role, kind);
  const signedOff = !!run?.signedOffAt;
  const myInitials = suggestInitials(session.profile.full_name ?? session.email);
  const countsLine = describeCountsLine(queue === null ? [] : queue.ok ? queue.data : null);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Daily Checklists" }]} />
      <AdminPageHeader
        title="Daily Checklists"
        subtitle="Opening, during the shift, closing, weekly, monthly and year end. Initial each task as you do it; a manager signs the sheet off."
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {sp.error}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {sp.ok}
        </div>
      ) : null}
      {missing ? (
        <div data-testid="checklist-migration-pending" className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          {CHECKLIST_MIGRATION_PENDING}
        </div>
      ) : null}
      {readError && !readError.ok ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          Could not read the checklist: {readError.error}. Use the paper form for now.
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="Checklists">
        {CHECKLIST_KINDS.map((k) => (
          <Link
            key={k}
            href={`${BASE}?list=${k}`}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              k === kind ? "bg-[var(--admin-accent)] text-white" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
            }`}
          >
            {CHECKLIST_KIND_LABELS[k]}
          </Link>
        ))}
      </nav>

      <section className={CARD} data-testid="checklist-sheet">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={H2}>
              {CHECKLIST_KIND_LABELS[kind]} · {describePeriod(kind, periodKey)}
            </h2>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Replaces paper form {CHECKLIST_KIND_FORM[kind]} (SOP-06 §8). {active.length - openCount} of {active.length} done.
              {!mayInitial ? " A manager, admin or the owner initials this list." : ""}
            </p>
          </div>
          {signedOff ? (
            <Badge tone="green">Signed off by {run!.signedOffName} · {formatDateTime(run!.signedOffAt)}</Badge>
          ) : (
            <Badge tone="gold">{openCount === 0 && active.length > 0 ? "Ready for sign-off" : "Open"}</Badge>
          )}
        </div>

        {sections.map((section) => (
          <div key={section} className="mb-4">
            <h3 className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--admin-text-faint)]">{section}</h3>
            <ul className="divide-y divide-[var(--admin-border)]">
              {active
                .filter((t) => t.section === section)
                .map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    kind={kind}
                    tick={tickByTask.get(t.id) ?? null}
                    links={referenceLinks(t.label, t.sopRef, sopIndex)}
                    countsLine={t.liveLine === "cycle_counts" ? countsLine : null}
                    canAct={mayInitial && !signedOff && !missing}
                    myInitials={myInitials}
                  />
                ))}
            </ul>
          </div>
        ))}
        {active.length === 0 && !missing ? <p className="text-sm text-[var(--admin-text-muted)]">No tasks on this list.</p> : null}

        {run?.signedOffAt && run.signoffNote ? (
          <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
            Sign-off note ({run.openTasksAtSignoff} not done): {run.signoffNote}
          </p>
        ) : null}

        {canSignOff(role) && run && !signedOff ? (
          <form action={signOffAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--admin-border)] pt-4" data-testid="checklist-signoff">
            <input type="hidden" name="run_id" value={run.id} />
            <input type="hidden" name="kind" value={kind} />
            <label className="flex-1 text-xs text-[var(--admin-text-muted)]">
              Manager sign-off{openCount > 0 ? ` — ${openCount} task${openCount === 1 ? " is" : "s are"} not initialled; write why` : ""}
              <input name="note" className={`${INPUT} mt-1 w-full`} placeholder={openCount > 0 ? "Why tasks were left (required)" : "Note (optional)"} />
            </label>
            <button className={BTN}>Sign off this sheet</button>
          </form>
        ) : null}
        {canSignOff(role) && !run && !missing ? (
          <p className="mt-3 text-xs text-[var(--admin-text-faint)]">Sign-off appears once the first task is initialled.</p>
        ) : null}
      </section>

      {canEditCatalog(role) ? (
        <section className={CARD} data-testid="checklist-catalog">
          <div className="mb-3 flex items-center justify-between">
            <h2 className={H2}>Edit the tasks (owner)</h2>
            <Link href={editing ? `${BASE}?list=${kind}` : `${BASE}?list=${kind}&edit=1`} className="text-xs font-bold text-[var(--admin-accent)]">
              {editing ? "Done editing" : "Edit the tasks"}
            </Link>
          </div>
          {editing ? (
            <>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Change the wording, section, SOP reference (for example <code>SOP-05a §4.16</code>, <code>§4.24</code>, a screen name, or
                &quot;owner-directed D57&quot;) or order. Untick Active to retire a task; it is never deleted and old sheets still show it.
              </p>
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <form action={saveTaskAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="task_id" value={t.id} />
                      <input name="sort_order" defaultValue={t.sortOrder} className={`${INPUT} w-16`} aria-label="Order" />
                      <input name="section" defaultValue={t.section} className={`${INPUT} w-40`} aria-label="Section" />
                      <input name="label" defaultValue={t.label} className={`${INPUT} min-w-[18rem] flex-1`} aria-label="Task" />
                      <input name="sop_ref" defaultValue={t.sopRef ?? ""} className={`${INPUT} w-48`} aria-label="SOP reference" />
                      <label className="flex items-center gap-1 text-xs text-[var(--admin-text-muted)]">
                        <input type="checkbox" name="active" defaultChecked={t.active} /> Active
                      </label>
                      <button className={BTN}>Save</button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addTaskAction} className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] pt-4">
                <input type="hidden" name="kind" value={kind} />
                <input name="sort_order" placeholder="Order" className={`${INPUT} w-16`} />
                <input name="section" placeholder="Section" className={`${INPUT} w-40`} />
                <input name="label" placeholder="New task" className={`${INPUT} min-w-[18rem] flex-1`} required />
                <input name="sop_ref" placeholder="SOP reference" className={`${INPUT} w-48`} />
                <button className={BTN}>Add task to {CHECKLIST_KIND_LABELS[kind]}</button>
              </form>
            </>
          ) : (
            <p className="text-xs text-[var(--admin-text-muted)]">Add, reword or retire tasks on any list (D57).</p>
          )}
        </section>
      ) : null}

      <section className={CARD}>
        <h2 className={H2}>Recent sheets</h2>
        <p className="mb-2 text-xs text-[var(--admin-text-muted)]">Kept five years (WAC 314-55-087). A sheet cannot be deleted.</p>
        {recentRes.ok && recentRes.data.length > 0 ? (
          <ul className="divide-y divide-[var(--admin-border)] text-sm">
            {recentRes.data.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-[var(--admin-text)]">
                  {CHECKLIST_KIND_LABELS[r.kind]} · {describePeriod(r.kind, r.periodKey)}
                </span>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  {r.signedOffAt
                    ? `Signed off by ${r.signedOffName}, ${formatDateTime(r.signedOffAt)}${r.openTasksAtSignoff ? ` (${r.openTasksAtSignoff} not done)` : ""}`
                    : "Not signed off"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--admin-text-muted)]">{recentRes.ok ? "No sheets yet." : "—"}</p>
        )}
      </section>
    </div>
  );
}

function TaskRow({
  task,
  kind,
  tick,
  links,
  countsLine,
  canAct,
  myInitials,
}: {
  task: ChecklistTask;
  kind: ChecklistKind;
  tick: { initials: string; doneAt: string; doneByName: string; note: string | null } | null;
  links: { text: string; href: string | null; note?: string }[];
  countsLine: string | null;
  canAct: boolean;
  myInitials: string;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2" data-testid="checklist-task">
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${tick ? "text-[var(--admin-text-muted)] line-through" : "text-[var(--admin-text)]"}`}>{task.label}</p>
        {links.length > 0 ? (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-[var(--admin-text-faint)]">
            {links.map((l, i) =>
              l.href ? (
                <Link key={i} href={l.href} className="text-[var(--admin-accent)] underline">
                  {l.text}
                </Link>
              ) : (
                <span key={i}>
                  {l.text}
                  {l.note ? ` (${l.note})` : ""}
                </span>
              ),
            )}
          </p>
        ) : null}
        {countsLine ? (
          <p className="mt-1 text-xs font-semibold text-[var(--admin-gold)]" data-testid="checklist-counts-line">
            {countsLine}{" "}
            <Link href="/admin/inventory/cycle-counts" className="underline">
              Open Cycle Counts
            </Link>
          </p>
        ) : null}
      </div>
      {tick ? (
        <span className="text-xs text-[var(--admin-text-muted)]" title={tick.doneByName}>
          <strong className="text-[var(--admin-text)]">{tick.initials}</strong> · {formatDateTime(tick.doneAt)}
          {tick.note ? ` · ${tick.note}` : ""}
        </span>
      ) : canAct ? (
        <form action={initialTaskAction} className="flex items-center gap-1">
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="kind" value={kind} />
          <input name="initials" defaultValue={myInitials} className={`${INPUT} w-14 uppercase`} aria-label="Initials" maxLength={4} />
          <input name="note" placeholder="Note" className={`${INPUT} w-32`} aria-label="Note" />
          <button className={BTN}>Initial</button>
        </form>
      ) : (
        <span className="text-xs text-[var(--admin-text-faint)]">—</span>
      )}
    </li>
  );
}

/**
 * src/app/admin/inventory/cycle-counts/page.tsx   (rewritten in slice books-23)
 *
 * THE COUNTING QUEUE. What an employee opens when they are told to go count.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE USED TO BE, AND WHY IT CHANGED
 * ---------------------------------------------------------------------------
 * It used to be a self-contained counting system: a "Start count" form, a list
 * of sessions, and an "Apply variances" button that moved inventory on the spot
 * and never wrote anything to the general ledger. See `applyCycleCount()` in
 * src/lib/inventory/cycle-counts.ts for the full account of why that was the
 * most damaging defect in the system.
 *
 * The owner's instruction, verbatim:
 *
 *   "I approve the scope and push it to the cycle counts page. The employees
 *    then open the cycle count and record the counts. I think all we need to do
 *    is remove the create cycle count button in the employee page and have the
 *    created and opened cycle counts be listed in the table below."
 *
 * So it is now a QUEUE, not a system: it shows work the owner has already
 * approved, and it is the door to the blind count sheet. It creates nothing,
 * approves nothing, and posts nothing.
 *
 * ---------------------------------------------------------------------------
 * WHY THE URL DID NOT MOVE
 * ---------------------------------------------------------------------------
 * Staff already know this address and it is presumably on a laminated card
 * somewhere. Redirecting them to a new URL to do the same job they did
 * yesterday buys nothing. What changed is what the page is ALLOWED to do.
 *
 * ---------------------------------------------------------------------------
 * WHY THE QUEUE IS SAFE BY QUERY AND NOT BY FILTER
 * ---------------------------------------------------------------------------
 * `COUNT_QUEUE_STATUSES` is passed into the database query. Sessions the owner
 * has not scoped, and sessions that have finished counting and are under his
 * review, are NEVER FETCHED -- not fetched and hidden. That is the difference
 * between a queue and a list with a filter on it, and it is what makes the
 * owner's "when they finish the count, it should disappear from the cycle counts
 * page" true by construction rather than by remembering to write a condition.
 *
 * ---------------------------------------------------------------------------
 * WHY inventory.count AND WHY THAT IS NOT A LOOSENING
 * ---------------------------------------------------------------------------
 * This page was `requirePermission("inventory.manage")` = owner, admin, manager.
 * A budtender could not open it, which made the owner's stated workflow --
 * "any employee can count" -- physically impossible.
 *
 * It is now `requirePermission("inventory.count")` = owner, admin, manager and
 * staff. That is a WIDENING of who may see a list of jobs,
 * at the same moment as a NARROWING of what anyone can do from here: the create
 * form is gone, the apply button is gone, and the page shows no cost, no
 * variance and no system quantity. Migration 0191 already grants staff write on
 * `inventory_audit_lines` and owner-only write on `inventory_audit_sessions`,
 * with the reasoning recorded there: "A counter can record what they see. A
 * counter cannot approve what it costs."
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import {
  listAuditSessions,
  COUNT_QUEUE_STATUSES,
} from "@/lib/inventory/audit-hub-store";
import { LABELS } from "@/lib/inventory/inventory-audit-post-core";
import { listCycleCounts } from "@/lib/inventory/cycle-counts";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const H2 = "mb-4 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]";

export default async function CycleCountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  // Anyone who works the floor. Deliberately NOT requireStaff(): that only
  // proves somebody is logged in, which includes the "readonly" analyst role and
  // the content editor, neither of whom should be writing counts onto the shelf
  // record. See the header for why this is a widening and a narrowing at once.
  await requirePermission("inventory.count");
  const sp = await searchParams;

  const [queue, legacy] = await Promise.all([
    listAuditSessions({ statuses: COUNT_QUEUE_STATUSES, limit: 50 }),
    // The old sessions, for history only. Read with the same helper as before;
    // nothing here can apply, cancel or edit them.
    listCycleCounts(25),
  ]);

  const jobs = queue.ok ? queue.data : [];

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Cycle Counts" }]}
      />
      <AdminPageHeader
        title="Cycle Counts"
        subtitle="Counts the owner has approved and asked for. Open one and enter what you actually find on the shelf."
      />

      {sp.error ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {decodeURIComponent(sp.error)}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          Saved.
        </div>
      ) : null}

      {/* ── A refusal from the queue query is shown, never swallowed ────────── */}
      {!queue.ok ? (
        <div className="rounded-xl border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/[0.06] px-4 py-3 text-sm text-[var(--admin-danger)]">
          {queue.refusal.message}
        </div>
      ) : null}

      <HelpPanel
        id="cycle-counts-help"
        title="How counting works"
        steps={[
          "The owner decides what gets counted and why. You will only ever see counts he has already approved, so anything in the list below is real work.",
          "Open a count and enter what you physically find, lot by lot. You will not be shown what the system expects — that is deliberate. A count that knows the answer is not a count.",
          "If a number needs a second look the sheet will ask you to count that lot again. It still will not show you the first number.",
          "When every lot has a number, the count leaves this page and goes to the owner to review. You are done at that point — you are never asked to explain a difference or to approve anything.",
        ]}
      />

      {/* ── THE QUEUE ──────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className={H2}>Counts waiting for you</h2>
        {jobs.length === 0 ? (
          <EmptyState
            title="Nothing to count right now"
            description="When the owner approves a count it will appear here. There is nothing to start from this page — counts are planned and approved on the Inventory Auditing screen."
          />
        ) : (
          <ul className="divide-y divide-[var(--admin-border)]">
            {jobs.map((s) => {
              const remaining = Math.max(s.plannedLotCount - s.countedLotCount, 0);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    {/* Straight to the count sheet -- the sheet is the job. */}
                    <Link
                      href={`/admin/inventory/audits/${s.id}/count`}
                      className="block truncate text-sm font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {s.label}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
                      {s.plannedLotCount} lot{s.plannedLotCount === 1 ? "" : "s"} to count
                      {s.countedLotCount > 0
                        ? ` · ${s.countedLotCount} done, ${remaining} to go`
                        : ""}
                    </p>
                    {/* The owner's reason for the count, shown to the counter.
                        Somebody who knows WHY they are counting a shelf counts
                        it better than somebody handed a list. It carries no
                        quantities and no money. */}
                    {s.scopeRationale ? (
                      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                        {s.scopeRationale}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={s.status === "counting" ? "gold" : "neutral"}>
                    {LABELS[s.status]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
          Counting is blind: you will not see the expected quantity, any cost, or any
          difference. That is what makes your count worth having.
        </p>
      </section>

      {/* ── LEGACY HISTORY ────────────────────────────────────────────────── */}
      {legacy.length > 0 ? (
        <section className={CARD}>
          <h2 className={H2}>Older counts (read only)</h2>
          <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
            Counts recorded under the previous process, kept as a permanent record. They can
            be read but not changed, and nothing here can move inventory. State law requires
            these be keepable for years, so they stay.
          </p>
          <ul className="divide-y divide-[var(--admin-border)]">
            {legacy.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/inventory/cycle-counts/${s.id}`}
                    className="block truncate text-sm text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
                  >
                    {s.label}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
                    {s.line_count} lots · {new Date(s.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge tone="neutral">{s.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * src/app/admin/inventory/audits/page.tsx   (slice books-12)
 *
 * THE AUDITING HUB -- the face for the engine books-10 and books-11 built.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS
 * ---------------------------------------------------------------------------
 * `grep -rn "inventory-audit" src/app src/components -l` returned NOTHING
 * before this slice. books-10 built the risk/planning/assessment engine and
 * books-11 built the posting path -- roughly 207KB of tested logic -- with zero
 * user-facing consumers. A brain with no face.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT AT /admin/audit
 * ---------------------------------------------------------------------------
 * `/admin/audit` already exists and means something else entirely: the security
 * and activity log over `audit_logs`. Two different meanings of "audit" sharing
 * a URL would be a trap for whoever reads it next, so the inventory auditor
 * lives under the thing it audits: /admin/inventory/audits.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS FOR
 * ---------------------------------------------------------------------------
 * Two jobs, in this order:
 *
 *   1. TEACH. The method panel is above the list, not buried behind a help
 *      link. Michael asked to shadow an expert; you cannot shadow someone who
 *      only appears when you click "help".
 *   2. SHOW STATE. Which audits are open, what stage each is at, and what the
 *      counting programme as a whole looks like against the annual standard.
 *
 * The coverage verdict is deliberately prominent. A cycle-count programme is
 * only a legitimate substitute for a full annual count while it actually covers
 * everything within the year -- and that is a claim that quietly stops being
 * true without anyone noticing. Here it is stated on the front page.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button } from "@/components/admin/ui";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { formatCents } from "@/lib/accounting/books-view-core";
import {
  LABELS,
  type AuditSessionStatus,
} from "@/lib/inventory/inventory-audit-post-core";
import {
  listAuditSessions,
  proposeScope,
} from "@/lib/inventory/audit-hub-store";
import { AuditHubExplainer } from "./AuditHubExplainer";
import { HubRefusal } from "./HubRefusal";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Status colour. `cancelled` is muted, never red -- it is a normal outcome. */
function statusTone(s: AuditSessionStatus): "neutral" | "green" | "gold" | "orange" {
  if (s === "approved") return "green";
  if (s === "review") return "orange";
  if (s === "counting" || s === "scope_approved") return "gold";
  return "neutral";
}

export default async function AuditHubPage() {
  // books-23: owner only. This is the audit hub -- scope, variances at cost, and
  // the posting controls. inventory.manage would have shown it to a manager.
  await requirePermission("inventory.audit");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/50">
        Supabase isn&apos;t configured in this environment, so the auditor is unavailable.
      </div>
    );
  }

  // Both reads are refusal-returning, never throwing. A failure to read the
  // coverage picture must not take the whole page down -- the lesson and the
  // session list are still worth showing.
  const [sessionsResult, scopeResult] = await Promise.all([
    listAuditSessions({ limit: 50 }),
    proposeScope({ maxLots: 40 }),
  ]);

  const sessions = sessionsResult.ok ? sessionsResult.data : [];
  const coverage = scopeResult.ok ? scopeResult.data.coverage : null;

  const open = sessions.filter(
    (s) => s.status !== "approved" && s.status !== "cancelled",
  );

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Inventory audits" },
        ]}
      />

      <AdminPageHeader
        title="Inventory audits"
        subtitle="Count the shelf, explain every difference, and post the correction with the reasoning attached."
        action={
          <Button href="/admin/inventory/audits/new" variant="primary">
            Plan a new audit
          </Button>
        }
      />

      {/* ---- REFUSALS FIRST. Never a blank page with no explanation. ---- */}
      {!sessionsResult.ok ? (
        <HubRefusal refusal={sessionsResult.refusal} context="the list of audits" />
      ) : null}
      {!scopeResult.ok ? (
        <HubRefusal
          refusal={scopeResult.refusal}
          context="the coverage picture and the proposed scope"
        />
      ) : null}

      {/* ---- THE PROGRAMME AT A GLANCE ---- */}
      {coverage ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Audits in progress"
              value={open.length}
              hint={open.length === 0 ? "Nothing open right now" : "Started but not yet approved"}
              accent={open.length > 0 ? "gold" : "muted"}
            />
            <StatCard
              label="Lots never counted"
              value={coverage.neverCounted}
              hint="No count on record, ever"
              accent={coverage.neverCounted > 0 ? "orange" : "green"}
            />
            <StatCard
              label="Past their count date"
              value={coverage.overdue}
              hint="Due under the ABC cadence"
              accent={coverage.overdue > 0 ? "gold" : "green"}
            />
            <StatCard
              label="Not counted in a year"
              value={coverage.beyondOneYear}
              hint="The number that breaks the annual standard"
              accent={coverage.beyondOneYear > 0 ? "orange" : "green"}
            />
          </div>

          {/*
            THE VERDICT. Rendered from the engine's own sentence, and coloured
            by its own boolean -- never re-derived here, because two places
            deciding the same thing is how a screen starts contradicting the
            rule it is reporting on.
          */}
          <section
            className={
              coverage.meetsAnnualStandard
                ? "rounded-2xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.05] p-5"
                : "rounded-2xl border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-5"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-white">
                Does your counting programme stand in for an annual count?
              </h2>
              <Badge tone={coverage.meetsAnnualStandard ? "green" : "gold"}>
                {coverage.meetsAnnualStandard ? "Yes, currently" : "Not yet"}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/70">{coverage.verdict}</p>
            {coverage.oldestDaysSinceCount !== null ? (
              <p className="mt-2 text-xs leading-relaxed text-white/45">
                The longest any single batch has gone without being counted is{" "}
                <span className="font-semibold text-white/70">
                  {coverage.oldestDaysSinceCount} days
                </span>
                . That figure, not the average, is what decides this &mdash; an average hides the
                one shelf nobody has touched since last spring.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ---- THE SESSIONS ---- */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/85">Audits</h2>

        {sessions.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.015] p-6 text-center">
            <p className="text-sm text-white/70">No audits yet.</p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-white/45">
              Start with a small one. A first audit that covers ten batches and finishes is worth
              more than a perfect plan to count everything that never gets done &mdash; and the
              method is identical either way.
            </p>
            <div className="mt-4">
              <Button href="/admin/inventory/audits/new" variant="primary" size="sm">
                Plan your first audit
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[0.65rem] uppercase tracking-wider text-white/40">
                  <th className="py-2 pr-3 font-semibold">Audit</th>
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 text-right font-semibold">Counted</th>
                  <th className="py-2 pr-3 text-right font-semibold">Difference</th>
                  <th className="py-2 pr-3 font-semibold">Started</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/admin/inventory/audits/${s.id}`}
                        className="font-semibold text-white hover:text-[var(--admin-accent)] hover:underline"
                      >
                        {s.label}
                      </Link>
                      {s.postedAt ? (
                        <span className="ml-2 text-[0.65rem] uppercase tracking-wider text-[var(--admin-accent)]">
                          posted
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={statusTone(s.status)}>{LABELS[s.status]}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-white/70">
                      {s.countedLotCount} / {s.plannedLotCount}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {/*
                        GROSS, not net, and labelled as the total difference.
                        Net lets a shortage on one lot cancel an overage on
                        another and report zero -- which is exactly the reading
                        that hides two real errors behind one clean number.
                      */}
                      <span
                        className={
                          s.grossVarianceCents === 0 ? "text-white/40" : "text-[var(--admin-gold)]"
                        }
                      >
                        {formatCents(s.grossVarianceCents)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-white/50">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/admin/inventory/audits/${s.id}`}
                        className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs leading-relaxed text-white/45">
              &ldquo;Difference&rdquo; is the total size of every difference added up ignoring
              direction, not the net. A shortage of $400 and an overage of $400 is two problems, not
              zero.
            </p>
          </div>
        )}
      </section>

      {/* ---- THE MENTOR. Below the state, above the fold on a second screen. ---- */}
      <AuditHubExplainer />
    </div>
  );
}

/**
 * src/app/admin/inventory/audits/[id]/page.tsx   (slice books-12)
 *
 * THE AUDIT DETAIL AND REVIEW SCREEN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS ACTUALLY FOR
 * ---------------------------------------------------------------------------
 * It is where a pile of counted numbers becomes either evidence or a refusal.
 * Three things happen here and nowhere else:
 *
 *   1. The readiness verdict is stated, WITH its remedies, before anything else.
 *   2. Every line is shown with the engine's own assessment of it.
 *   3. The status moves forward -- and only forward through legal moves.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUTTONS ARE HIDDEN RATHER THAN DISABLED
 * ---------------------------------------------------------------------------
 * A disabled button is an invitation to hunt for the trick that enables it. A
 * button that is absent, with a paragraph explaining what is missing, is an
 * instruction. Everything blocking progress is stated as prose with steps
 * attached, which is what Michael asked for: not just blocked, but told why and
 * how.
 *
 * The buttons being hidden is NOT the control. `moveSessionStatus` re-asks
 * `canMoveStatus`, and migration 0191's constraints re-ask it again at write
 * time. The UI is the third line of defence, not the first.
 *
 * ---------------------------------------------------------------------------
 * WHY APPROVING AND POSTING ARE TWO DIFFERENT DECISIONS
 * ---------------------------------------------------------------------------
 * Approving says "I believe this count". Posting says "move my inventory and
 * my ledger". Inventory is on the never-post-automatically list deliberately,
 * so those two are never merged into one button. A single click that did both
 * would mean a machine decided that product left the building.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { getAuditReview } from "@/lib/inventory/audit-hub-store";
import {
  LABELS,
  type AuditSessionStatus,
} from "@/lib/inventory/inventory-audit-post-core";
import { AuditVarianceReview } from "../AuditVarianceReview";
import { WhyBlockedPanel } from "../WhyBlockedPanel";
import { HubRefusal } from "../HubRefusal";
import { MaterialityPanel, ProvesPanel } from "../AuditHubExplainer";
import { moveStatusAction } from "../actions";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";

/**
 * Status colour.
 *
 * NOTE THERE IS NO "posted" STATUS, and the type checker is what said so.
 * An earlier draft of this page branched on `status === "posted"`, which
 * compiles to a comparison that can never be true. Posting is recorded by
 * `postedAt` being non-null, NOT by the status word — deliberately, because a
 * session stays "approved" forever and the posting is a separate, dated event
 * against it. Had this shipped, a posted audit would have rendered as though it
 * were still awaiting action.
 */
function statusTone(s: AuditSessionStatus): "neutral" | "green" | "gold" | "orange" {
  if (s === "approved") return "gold";
  if (s === "cancelled") return "neutral";
  return "orange";
}

export default async function AuditDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ refusal?: string; refusalCode?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;

  const review = await getAuditReview(id);

  if (!review.ok) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: "Inventory", href: "/admin/inventory" },
            { label: "Auditing", href: "/admin/inventory/audits" },
            { label: "Audit" },
          ]}
        />
        <AdminPageHeader title="Audit" subtitle="This audit could not be opened." />
        <HubRefusal refusal={review.refusal} context="this audit" />
      </div>
    );
  }

  const { session, lines, readiness } = review.data;
  const isCounting = session.status === "counting";
  const isReview = session.status === "review";
  const isApproved = session.status === "approved";
  // Posting is a dated event, not a status word. See statusTone above.
  const isPosted = session.postedAt !== null;
  const isFinished = isPosted || session.status === "cancelled";

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/admin/inventory" },
          { label: "Auditing", href: "/admin/inventory/audits" },
          { label: session.label },
        ]}
      />

      <AdminPageHeader
        title={session.label}
        subtitle={readiness.summary}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isPosted ? "green" : statusTone(session.status)}>
              {isPosted ? "posted" : LABELS[session.status]}
            </Badge>
            {!isFinished ? (
              <Button href={`/admin/inventory/audits/${id}/count`} variant="primary" size="sm">
                {isCounting ? "Open the count sheet" : "View the count sheet"}
              </Button>
            ) : null}
            <Button href={`/admin/inventory/audits/${id}/export`} variant="neutral" size="sm">
              Work paper
            </Button>
          </div>
        }
      />

      {sp.refusal ? (
        <WhyBlockedPanel blockers={[sp.refusal]} title="That could not be done" />
      ) : null}

      {/* ── THE NUMBERS ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Lots in scope"
          value={String(readiness.totalLines)}
          hint={`${readiness.counted} counted, ${readiness.uncounted} still blank`}
          accent={readiness.uncounted > 0 ? "gold" : "green"}
        />
        <StatCard
          label="Exactly right"
          value={String(readiness.clean)}
          hint="Evidence your controls work"
          accent="green"
        />
        <StatCard
          label="Total error found"
          value={readiness.grossVarianceCents === null ? "Not calculable" : formatCents(readiness.grossVarianceCents)}
          hint="GROSS — sizes added, directions ignored"
          accent={readiness.grossVarianceCents ? "orange" : "muted"}
        />
        <StatCard
          label="Net effect on the books"
          value={readiness.netVarianceCents === null ? "Not calculable" : formatCents(readiness.netVarianceCents)}
          hint="What would reach the ledger"
          accent="muted"
        />
      </div>

      {/* GROSS vs NET, spelled out. This is the single most useful accounting
          idea on the page and it is stated whenever the two disagree. */}
      {readiness.grossVarianceCents !== null &&
      readiness.netVarianceCents !== null &&
      Math.abs(readiness.netVarianceCents) < readiness.grossVarianceCents ? (
        <section className={CARD}>
          <h2 className="text-sm font-bold text-white">Read the gross number, not the net one</h2>
          <p className={`mt-1 ${P}`}>
            This count found {formatCents(readiness.grossVarianceCents)} of error in total, but the
            overages and shortages partly cancel out, so the effect on the books is only{" "}
            {formatCents(readiness.netVarianceCents)}. A report that led with the net figure would
            describe this count as almost clean. It is not. Offsetting differences are the classic
            signature of two batches of one product being counted as a single pile.
          </p>
        </section>
      ) : null}

      {/* ── BLOCKERS, WITH REMEDIES ───────────────────────────────────── */}
      {readiness.blockers.length > 0 ? (
        <WhyBlockedPanel blockers={readiness.blockers} />
      ) : (
        <section className="rounded-2xl border border-[var(--admin-accent)]/35 bg-[var(--admin-accent)]/[0.05] p-5">
          <h2 className="text-sm font-bold text-white">Nothing is blocking this audit</h2>
          <p className={`mt-1 ${P}`}>{readiness.summary}</p>
        </section>
      )}

      {/* ── WHAT HAPPENS NEXT ─────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">What happens next</h2>

        {isCounting ? (
          <>
            <p className={`mt-1 ${P}`}>
              Counting is still open. When every lot has a number against it, close the counting
              stage and the differences become reviewable. Nothing you do here touches the shelf or
              the ledger.
            </p>
            <form action={moveStatusAction} className="mt-4">
              <input type="hidden" name="sessionId" value={id} />
              <input type="hidden" name="to" value="review" />
              <Button type="submit" variant="save" size="md">
                Finish counting and review the differences
              </Button>
            </form>
          </>
        ) : isReview ? (
          readiness.canPost ? (
            <>
              <p className={`mt-1 ${P}`}>
                Everything the system checks for is satisfied. Approving records YOUR NAME and the
                time against this result &mdash; it is a signature, not a formality. It does not
                move any inventory by itself.
              </p>
              <form action={moveStatusAction} className="mt-4">
                <input type="hidden" name="sessionId" value={id} />
                <input type="hidden" name="to" value="approved" />
                <Button type="submit" variant="confirm" size="md">
                  Approve this result
                </Button>
              </form>
            </>
          ) : (
            <p className={`mt-1 ${P}`}>
              There is no approve button on this page yet, and that is deliberate rather than a
              fault. The items above have to be cleared first. Each one lists the exact steps.
            </p>
          )
        ) : isApproved ? (
          <p className={`mt-1 ${P}`}>
            This result is approved and signed. The shelf correction and the journal entry are
            handled through the posting path, which reviews the entry with you before anything
            reaches the ledger &mdash; inventory never posts itself.
          </p>
        ) : (
          <p className={`mt-1 ${P}`}>
            {isPosted
              ? "This audit has been posted, so the shelf and the ledger already reflect it. It cannot be posted a second time — doing so would subtract the same missing product twice and invent a shortage that never happened."
              : `This audit is ${LABELS[session.status].toLowerCase()}.`}{" "}
            It is kept as a permanent record; if the result was wrong, the correction goes in as a
            NEW count so the trail shows both.
          </p>
        )}

        {session.scopeRationale ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Why these products were chosen &mdash; written before the numbers were known
            </p>
            <p className="mt-1 text-xs text-white/85">{session.scopeRationale}</p>
          </div>
        ) : null}
      </section>

      {/* ── THE LINES ─────────────────────────────────────────────────── */}
      <AuditVarianceReview sessionId={id} lines={lines} editable={isReview} />

      {/* Teaching, below the work. */}
      <MaterialityPanel />
      <ProvesPanel />
    </div>
  );
}

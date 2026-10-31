/**
 * src/app/admin/inventory/audits/full-count/[id]/page.tsx   (Fix Phase 4.4d · G-41 · D58, D56, D54)
 *
 * ONE FULL COUNT: its sections, who is counting each, the combined progress
 * and money, and the owner's four batch buttons: Release all sections,
 * Approve every ready section, Post every approved section, Cancel. A section
 * that is not ready is listed with its reason, never forced; each section
 * still opens as an ordinary audit for recounts, reasons and send-back.
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { formatDateTime } from "@/lib/pos/format";
import { FULL_COUNT_STAGE_LABEL } from "@/lib/inventory/full-count-core";
import { getFullCountReview } from "@/lib/inventory/full-count-store";
import { LABELS, isAuditSessionStatus } from "@/lib/inventory/inventory-audit-post-core";
import { WhyBlockedPanel } from "../../WhyBlockedPanel";
import {
  approveFullCountAction,
  cancelFullCountAction,
  postFullCountAction,
  releaseFullCountAction,
} from "../actions";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-xs leading-relaxed text-[var(--admin-text-muted)]";

export default async function FullCountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ refusal?: string; notice?: string }>;
}) {
  await requirePermission("inventory.audit");
  const { id } = await params;
  const sp = await searchParams;
  const r = await getFullCountReview(id);

  const crumbs = [
    { label: "Inventory", href: "/admin/inventory" },
    { label: "Inventory audits", href: "/admin/inventory/audits" },
    { label: "Year-end full count", href: "/admin/inventory/audits/full-count" },
  ];

  if (!r.ok) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[...crumbs, { label: "Full count" }]} />
        <WhyBlockedPanel blockers={[r.refusal.message]} title="This full count could not be opened" />
      </div>
    );
  }

  const { fullCount: fc, totals, blockers } = r.data;
  const ru = fc.rollup;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[...crumbs, { label: String(fc.year) }]} />
      <AdminPageHeader
        title={`Year-end full count ${fc.year}`}
        subtitle={ru.next}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ru.stage === "posted" ? "green" : ru.stage === "cancelled" ? "neutral" : "gold"}>
              {FULL_COUNT_STAGE_LABEL[ru.stage]}
            </Badge>
            <Button href={`/admin/inventory/audits/full-count/${id}/export`} variant="neutral" size="sm">
              Combined work paper
            </Button>
          </div>
        }
      />

      {sp.refusal ? <WhyBlockedPanel blockers={[sp.refusal]} title="That could not be done" /> : null}
      {sp.notice ? (
        <div className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.06] px-4 py-3 text-sm text-white">
          {sp.notice}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sections" value={ru.live} hint={ru.cancelled ? `${ru.cancelled} cancelled` : "One person each"} accent="muted" />
        <StatCard
          label="Lots counted"
          value={`${totals.counted} / ${totals.totalLines}`}
          hint={`${totals.uncounted} still blank`}
          accent={totals.uncounted > 0 ? "gold" : "green"}
        />
        <StatCard
          label="Total error (gross)"
          value={totals.grossVarianceCents === null ? "Not calculable" : formatCents(totals.grossVarianceCents)}
          hint="Sizes of every difference, all sections"
          accent={totals.grossVarianceCents ? "orange" : "muted"}
        />
        <StatCard
          label="Net effect on books"
          value={totals.netVarianceCents === null ? "Not calculable" : formatCents(totals.netVarianceCents)}
          hint="Overages offset shortages"
          accent="muted"
        />
      </div>

      {/* ── The owner's buttons ── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">What happens next</h2>
        <p className={`mt-1 ${P}`}>{ru.next}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {ru.toRelease > 0 ? (
            <form action={releaseFullCountAction}>
              <input type="hidden" name="fullCountId" value={id} />
              <Button type="submit" variant="confirm" size="md">
                Release all sections ({ru.toRelease}) to Cycle Counts
              </Button>
            </form>
          ) : null}
          {ru.inReview > 0 ? (
            <form action={approveFullCountAction}>
              <input type="hidden" name="fullCountId" value={id} />
              <Button type="submit" variant="confirm" size="md">
                Approve every ready section ({ru.inReview} in review)
              </Button>
            </form>
          ) : null}
          {ru.toPost > 0 ? (
            <form action={postFullCountAction}>
              <input type="hidden" name="fullCountId" value={id} />
              <Button type="submit" variant="confirm" size="md">
                Post every approved section ({ru.toPost}) &mdash; correct the shelf and draft the entries
              </Button>
            </form>
          ) : null}
        </div>
        <p className={`mt-3 ${P}`}>
          Approving records your name against each section, the same as the Approve button on one audit, and only for
          sections with nothing outstanding. Posting corrects the shelf once and drafts one journal entry per section
          for you to approve in the books; a second press is refused.
        </p>
        {blockers.length > 0 ? <WhyBlockedPanel blockers={blockers.slice(0, 30)} title="Outstanding in the sections" /> : null}

        {ru.stage !== "posted" && ru.stage !== "cancelled" ? (
          <form action={cancelFullCountAction} className="mt-5 flex flex-wrap items-center gap-2">
            <input type="hidden" name="fullCountId" value={id} />
            <input
              name="reason"
              required
              minLength={5}
              placeholder="Why is this full count being cancelled?"
              aria-label="Why is this full count being cancelled"
              className="min-w-[18rem] flex-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white"
            />
            <Button type="submit" variant="danger" size="sm">
              Cancel the open sections
            </Button>
          </form>
        ) : null}
      </section>

      {/* ── Sections ── */}
      <section className={CARD}>
        <h2 className="text-sm font-bold text-white">Sections</h2>
        <p className={`mt-1 ${P}`}>
          Each section is an ordinary count on Cycle Counts: one person presses Start counting and only they enter
          numbers (you can reassign on the section). Open a section to recount, add reasons or send it back.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[var(--admin-text-muted)]">
              <th className="py-1.5 pr-3">Section</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5 pr-3">Counter</th>
              <th className="py-1.5 pr-3 text-right">Lots</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {fc.sections.map((s) => (
              <tr key={s.id} className="border-b border-white/5">
                <td className="py-2 pr-3 text-white">
                  {s.sectionNo} of {s.sectionCount}
                </td>
                <td className="py-2 pr-3">
                  {s.postedAt ? "posted" : isAuditSessionStatus(String(s.status)) ? LABELS[s.status as keyof typeof LABELS] : s.status}
                </td>
                <td className="py-2 pr-3 text-white/80">
                  {s.claimedByName ?? "nobody yet"}
                  {s.submittedAt ? ` \u00b7 done ${formatDateTime(s.submittedAt)}` : ""}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {s.countedLotCount} / {s.plannedLotCount}
                </td>
                <td className="py-2 text-right">
                  <Button href={`/admin/inventory/audits/${s.id}`} variant="neutral" size="sm">
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

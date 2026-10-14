/**
 * R41 S0: Banking approvals (/admin/settings/banking/approvals).
 *
 * The owner's words (D-6, recorded verbatim in R41-TIMBERLAND-SLICE-PLAN.md):
 *   "I trust Stephen, he can make and and approve all actions, it should send
 *    me alerts and let me know in the back office to review them and check
 *    them off the list." ... "I think I like option b better now that I
 *    think of it. Please build it that way."
 *
 * Two lists:
 *   1. Waiting for Michael: Stephen's live ACH changes. Michael approves or
 *      rejects each one; Stephen can withdraw his own. Requests never expire
 *      (D-7); one whose record changed since it was sent is refused on approve.
 *   2. To check off: Stephen's stop actions (hold, return/NOC notice) that
 *      already took effect. Michael checks each one off.
 *
 * Gate: ach.request (owner + admin). Only masked summaries are shown; the
 * encrypted payload never leaves the server.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { achActionLabel, achAuthority } from "@/lib/auth/ach-authority-core";
import { pacificWhen, summaryObject } from "@/lib/payments/ach-gate-core";
import { listChangeRequests, listOwnerReviews, staffNames, type OwnerReview, type RequestListRow } from "@/lib/payments/ach-requests-store";
import { approveAchRequestAction, checkOffReviewAction, rejectAchRequestAction, withdrawAchRequestAction } from "./actions";
import { DecisionForm } from "./ApprovalButtons";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius-lg)] border border-white/10 bg-white/[0.03] p-4";
const h2 = "mb-3 text-sm font-black uppercase tracking-[0.1em] text-white/70";

function when(iso: string | null): string {
  return iso ? pacificWhen(new Date(iso)) : "";
}

function Summary({ summary }: { summary: unknown }) {
  const s = summaryObject(summary);
  const keys = Object.keys(s);
  if (keys.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {keys.map((k) => (
        <div key={k} className="flex gap-2">
          <dt className="text-white/40">{k}</dt>
          <dd className="break-all text-white/80">{s[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS_WORDS: Record<RequestListRow["status"], string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
  superseded: "Replaced by Michael's own change",
};

export default async function BankingApprovalsPage() {
  const session = await requirePermission("ach.request");
  const isOwner = achAuthority(session.profile.role) === "act";
  const [reqs, reviews] = await Promise.all([listChangeRequests(), listOwnerReviews()]);
  const names = await staffNames([
    ...reqs.pending.map((r) => r.requested_by),
    ...reqs.recent.flatMap((r) => [r.requested_by, r.decided_by ?? ""]),
    ...reviews.open.map((r) => r.done_by),
    ...reviews.done.flatMap((r) => [r.done_by, r.checked_off_by ?? ""]),
  ]);
  const who = (id: string | null) => (id ? (names.get(id) ?? "someone") : "");

  return (
    <div>
      <AdminPageHeader
        title="Banking approvals"
        subtitle={
          isOwner
            ? "Stephen's ACH changes wait here for you. His holds already took effect; check each one off once you have looked at it."
            : "Your ACH changes wait here until Michael approves them. Your holds take effect at once and go on his review list."
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Settings", href: "/admin/settings" },
              { label: "Banking", href: "/admin/settings/banking" },
              { label: "Approvals" },
            ]}
          />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {!reqs.ready || !reviews.ready ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200">
            The approvals lists could not be read. If migration 0271 has not been run yet, run it (docs/MIGRATIONS_TO_RUN.md); otherwise reload the page.
          </div>
        ) : null}

        <section>
          <h2 className={h2}>Waiting for Michael ({reqs.pending.length})</h2>
          {reqs.pending.length === 0 ? (
            <p className="text-sm text-white/50">Nothing is waiting.</p>
          ) : (
            <ul className="space-y-3">
              {reqs.pending.map((r) => (
                <li key={r.id} className={card}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {achActionLabel(r.kind)} <span className="text-white/60">for {r.target_label || "(no record name)"}</span>
                    </p>
                    <p className="text-xs text-white/50">
                      Sent by {who(r.requested_by)} on {when(r.requested_at)} (Pacific)
                    </p>
                  </div>
                  {r.reason ? <p className="mt-1 text-xs text-white/70">Note: {r.reason}</p> : null}
                  <Summary summary={r.summary} />
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {isOwner ? (
                      <>
                        <DecisionForm
                          action={approveAchRequestAction}
                          idName="request_id"
                          id={r.id}
                          label="Approve"
                          pendingLabel="Approving…"
                          tone="confirm"
                          notePlaceholder="Note to Stephen (optional)"
                          confirmText={`Approve: ${achActionLabel(r.kind)} for ${r.target_label}? This makes the change now.`}
                        />
                        <DecisionForm
                          action={rejectAchRequestAction}
                          idName="request_id"
                          id={r.id}
                          label="Don't approve"
                          pendingLabel="Saving…"
                          tone="danger"
                          notePlaceholder="Why not (optional, Stephen sees it)"
                        />
                      </>
                    ) : r.requested_by === session.profile.id ? (
                      <DecisionForm
                        action={withdrawAchRequestAction}
                        idName="request_id"
                        id={r.id}
                        label="Withdraw"
                        pendingLabel="Withdrawing…"
                        tone="neutral"
                        notePlaceholder="Why (optional)"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className={h2}>Stephen&apos;s stop actions to check off ({reviews.open.length})</h2>
          {reviews.open.length === 0 ? (
            <p className="text-sm text-white/50">Nothing to check off.</p>
          ) : (
            <ul className="space-y-3">
              {reviews.open.map((r: OwnerReview) => (
                <li key={r.id} className={card}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {achActionLabel(r.kind)} <span className="text-white/60">for {r.target_label}</span>
                    </p>
                    <p className="text-xs text-white/50">
                      Done by {who(r.done_by)} on {when(r.done_at)} (Pacific)
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-white/70">{r.outcome}</p>
                  <Summary summary={r.summary} />
                  {isOwner ? (
                    <div className="mt-3">
                      <DecisionForm
                        action={checkOffReviewAction}
                        idName="review_id"
                        id={r.id}
                        label="Check off"
                        pendingLabel="Saving…"
                        tone="confirm"
                        notePlaceholder="Note (optional)"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className={h2}>Recently decided</h2>
          {reqs.recent.length === 0 && reviews.done.length === 0 ? (
            <p className="text-sm text-white/50">Nothing yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {reqs.recent.map((r) => (
                <li key={r.id} className="rounded-[var(--admin-radius)] border border-white/5 px-3 py-2 text-white/70">
                  <span className="font-semibold text-white">{STATUS_WORDS[r.status]}</span>: {achActionLabel(r.kind)} for {r.target_label}. Sent by{" "}
                  {who(r.requested_by)}; decided by {who(r.decided_by)} on {when(r.decided_at)}.
                  {r.decision_note ? ` Note: ${r.decision_note}` : ""}
                  {r.applied_ref ? ` Result: ${r.applied_ref}` : ""}
                  {r.apply_error ? <span className="text-red-300"> Did not go through: {r.apply_error}</span> : null}
                </li>
              ))}
              {reviews.done.map((r) => (
                <li key={r.id} className="rounded-[var(--admin-radius)] border border-white/5 px-3 py-2 text-white/70">
                  <span className="font-semibold text-white">Checked off</span>: {achActionLabel(r.kind)} for {r.target_label}. Done by{" "}
                  {who(r.done_by)}; checked off by {who(r.checked_off_by)} on {when(r.checked_off_at)}.
                  {r.check_note ? ` Note: ${r.check_note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-white/40">
          <Link href="/admin/settings/banking" className="underline">
            Back to Banking
          </Link>
        </p>
      </div>
    </div>
  );
}

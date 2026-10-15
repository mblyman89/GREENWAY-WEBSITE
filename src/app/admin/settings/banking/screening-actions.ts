"use server";

/**
 * R41 S11 (0278): OFAC sanctions screening.
 *
 * Screen now: owner or admin (settings.manage). It changes nothing about
 * money or bank details; it downloads OFAC's lists, screens every payee and
 * adds a record. So it is not an ACH kind and needs no approval.
 *
 * Record a review: the owner's decision on one possible match (OFAC FAQ 5
 * steps 3 and 6). Through achGate kind ofac_review.record: Michael at once,
 * Stephen's review becomes a request for Michael. The 0278 trigger checks the
 * owner again, once per result, and the note again.
 *
 * NEITHER blocks a payment: payroll and vendor files never read screening.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, type StaffSession } from "@/lib/auth/session";
import { achGate } from "@/lib/payments/ach-gate";
import type { RedirectOutcome } from "@/lib/payments/ach-gate-core";
import { recordAudit } from "@/lib/auth/audit";
import { checkReviewForm } from "@/lib/payments/ofac-screening-core";
import { recordOfacReview, runOfacScreening } from "@/lib/payments/ofac-screening-store";

const PAGE = "/admin/settings/banking/screening";

function back(qs: { msg?: string; error?: string }, anchor = "matches"): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(PAGE);
  redirect(`${PAGE}?${p.toString()}#${anchor}`);
}

const reply = (r: RedirectOutcome): never => back(r.ok ? { msg: r.message } : { error: r.message });

export async function screenNowAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const r = await runOfacScreening({ trigger: "manual", actorId: session.profile.id });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.ofac_screening.run",
    entityType: "ofac_screening_runs",
    entityId: r.ok ? r.runId : null,
    after: r.ok ? { payees: r.payees, possible_matches: r.possibleMatches, needs_review: r.needsReview } : { failed: true },
  }).catch(() => {});
  if (!r.ok) back({ error: `${r.error}${r.recorded ? " (This failed run is in the history.)" : ""}` }, "runs");
  const msg =
    r.needsReview + r.trueMatches === 0
      ? `Screened ${r.payees} payee(s): nothing needs review.`
      : `Screened ${r.payees} payee(s): ${r.needsReview} possible match(es) to review${r.trueMatches ? `, ${r.trueMatches} marked as a true match` : ""}. Payments are not blocked.`;
  back({ msg });
}

export async function recordOfacReviewAction(fd: FormData): Promise<void> {
  return achGate("ofac_review.record", fd, { reply }, (session) => reviewBody(session, fd));
}

async function reviewBody(session: StaffSession, fd: FormData): Promise<void> {
  const form = checkReviewForm((k) => fd.get(k) as string | null);
  if (!form.ok) back({ error: form.error });
  const r = await recordOfacReview({ resultId: form.resultId, decision: form.decision, note: form.note, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.ofac_review.recorded",
    entityType: "ofac_match_reviews",
    entityId: r.id,
    after: { result_id: form.resultId, decision: form.decision },
  }).catch(() => {});
  back({
    msg:
      form.decision === "not_a_match"
        ? `Recorded: ${r.label} is not a match. The note is kept. A later screen with a new list entry or a new name will ask again.`
        : `Recorded: ${r.label} is a TRUE match. Read the steps on this page (OFAC FAQ 5, steps 4 and 5) and call your attorney and Timberland before paying them.`,
  });
}

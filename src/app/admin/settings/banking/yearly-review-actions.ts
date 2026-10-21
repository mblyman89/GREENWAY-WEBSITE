"use server";

/**
 * R41 S14 (0288): record the yearly review of the ACH fraud procedure.
 *
 * OWNER ONLY (ach.act). The review is the owner's sign-off that the
 * procedure, the risk assessment and the who-did-what report were read, so
 * it is not an ACH request an admin can send for approval: an admin sees the
 * page and the packet but cannot record the review. The 0288 trigger checks
 * the owner again (ach_write_by_owner), refuses backdating and never lets a
 * row change; a mistake is fixed with a correction row.
 *
 * Recording this year's review also marks the calendar task
 * fraud_procedure_review done for the year (the reminder emails stop).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { checkYearlyReviewForm, OUTCOME_WORD } from "@/lib/payments/ach-yearly-review-core";
import { recordAnnualReview } from "@/lib/payments/ach-yearly-review-store";
import { setAchTaskDone } from "@/lib/payments/ach-guide-store";

const PAGE = "/admin/settings/banking/yearly-review";

function back(qs: { msg?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(PAGE);
  revalidatePath("/admin/settings/banking/calendar");
  redirect(`${PAGE}?${p.toString()}#record`);
}

export async function recordYearlyReviewAction(fd: FormData): Promise<void> {
  const session = await requirePermission("ach.act");
  const today = pacificToday();
  const form = checkYearlyReviewForm((k) => fd.get(k) as string | null, today);
  if (!form.ok) back({ error: form.error });
  const r = await recordAnnualReview({ row: form.row, actorId: session.profile.id, todayIso: today });
  if (!r.ok) back({ error: r.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: form.row.correctsId ? "ach.yearly_review.corrected" : "ach.yearly_review.recorded",
    entityType: "ach_annual_reviews",
    entityId: r.id,
    after: { review_year: form.row.reviewYear, outcome: form.row.outcome, corrects_id: form.row.correctsId },
  }).catch(() => {});

  // The calendar task covers the current year only (checkMarkDone refuses another period).
  let calendarNote = "";
  if (form.row.reviewYear === Number(today.slice(0, 4))) {
    const cal = await setAchTaskDone({
      taskId: "fraud_procedure_review",
      periodKey: String(form.row.reviewYear),
      todayIso: today,
      done: true,
      note: `Yearly review recorded (${OUTCOME_WORD[form.row.outcome]}).`,
      byEmail: session.email,
    });
    calendarNote = cal.ok ? " The calendar task is marked done for the year." : ` The calendar task could NOT be marked done (${cal.error}); mark it on the Calendar page.`;
  }
  back({ msg: `${form.row.correctsId ? "Correction" : "Yearly review"} for ${form.row.reviewYear} recorded: ${OUTCOME_WORD[form.row.outcome]}.${calendarNote}` });
}

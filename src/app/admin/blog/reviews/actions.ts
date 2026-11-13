"use server";

/**
 * D239 N-9 (SOP-22 G-119; Q-22-2 (a)): add, edit and remove curated reviews.
 * blog.manage only; every change is audited.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { cleanReview, newReviewId, removeReview, reviewProblems, upsertReview } from "@/lib/cms/curated-reviews-core";
import { loadCuratedReviews, saveCuratedReviews } from "@/lib/cms/curated-reviews-server";

const BACK = "/admin/blog/reviews";

export async function saveCuratedReviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const rawId = String(formData.get("id") ?? "").trim();
  const review = cleanReview({
    id: rawId || newReviewId(),
    quote: formData.get("quote"),
    firstName: formData.get("first_name"),
    googleUrl: formData.get("google_url"),
    permission: formData.get("permission") === "on",
    permissionNote: formData.get("permission_note"),
  });
  if (!review) redirect(`${BACK}?error=${encodeURIComponent("Paste the review words first.")}`);
  const typedUrl = String(formData.get("google_url") ?? "").trim();
  if (typedUrl && !review.googleUrl) redirect(`${BACK}?error=${encodeURIComponent("The review link must be an https link on Google (google.com, g.page or goo.gl).")}`);
  const list = await loadCuratedReviews();
  const res = await saveCuratedReviews(upsertReview(list, review), session.userId);
  if (!res.ok) redirect(`${BACK}?error=${encodeURIComponent(res.error)}`);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: rawId ? "blog.review.update" : "blog.review.add",
    entityType: "curated_review",
    entityId: review.id,
    after: { firstName: review.firstName, permission: review.permission, googleUrl: review.googleUrl, usable: reviewProblems(review).length === 0 },
  });
  revalidatePath(BACK);
  const problems = reviewProblems(review);
  redirect(`${BACK}?saved=1${problems.length ? `&error=${encodeURIComponent(`Saved, but it cannot be used yet: ${problems.join(" ")}`)}` : ""}`);
}

export async function deleteCuratedReviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("blog.manage");
  const id = String(formData.get("id") ?? "").trim();
  const list = await loadCuratedReviews();
  if (!list.some((r) => r.id === id)) redirect(BACK);
  const res = await saveCuratedReviews(removeReview(list, id), session.userId);
  if (!res.ok) redirect(`${BACK}?error=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "blog.review.remove", entityType: "curated_review", entityId: id, after: { removed: true } });
  revalidatePath(BACK);
  redirect(`${BACK}?removed=1`);
}

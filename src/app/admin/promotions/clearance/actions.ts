"use server";
/**
 * src/app/admin/promotions/clearance/actions.ts   (Fix Phase 4.5b · F-06-17)
 *
 * Create a DRAFT clearance markdown from the ticked products. The candidates
 * are re-read and re-ranked on the server (a crafted post cannot add a blocked,
 * never-discount or unknown product), the draft is built by the pure
 * buildClearanceDraft, saved through the normal createPromotion, and audited.
 * It is NOT published: the owner opens it and presses Publish, which runs the
 * below-cost guard like every other promotion.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { createPromotion } from "@/lib/promotions/promotions-store";
import { loadClearanceInputs } from "@/lib/promotions/clearance-store";
import { buildClearanceDraft, clampPercent, clampSittingDays, findClearanceCandidates } from "@/lib/promotions/clearance-core";

function back(params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`/admin/promotions/clearance${q ? `?${q}` : ""}`);
}

export async function createClearanceDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const percent = clampPercent(formData.get("percent"));
  const sittingDays = clampSittingDays(formData.get("sittingDays"));
  const keep = { percent: String(percent), sitting: String(sittingDays) };
  const today = pacificToday();

  const read = await loadClearanceInputs();
  if (!read.ok) back({ ...keep, error: `Nothing was created: ${read.error}` });
  const candidates = findClearanceCandidates({ ...read.data, today, settings: { percent, sittingDays } });
  const keys = formData.getAll("key").map((k) => String(k));
  const built = buildClearanceDraft({ keys, candidates, percent, title: String(formData.get("title") ?? ""), today });
  if (!built.ok) back({ ...keep, error: built.error });

  const { targets, ...input } = built.draft;
  const id = await createPromotion({ ...input, starts_at: null, ends_at: null }, targets, [], session.userId);
  if (!id) back({ ...keep, error: "Nothing was created: the promotion could not be saved. Try again." });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "promotion.clearance_draft",
    entityType: "promotion",
    entityId: id,
    after: { ...input, targets, source: "clearance_screen", sittingDays, finding: "F-06-17" },
  });
  revalidatePath("/admin/promotions");
  revalidatePath("/admin/promotions/clearance");
  redirect(`/admin/promotions/${id}?saved=1`);
}

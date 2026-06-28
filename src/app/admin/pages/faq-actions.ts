"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createFaqItem,
  saveFaqDraft,
  publishFaqItem,
  deleteFaqItem,
  moveFaqItem,
  ensureFaqSeeded,
} from "@/lib/cms/faq-store";

const FAQ_ADMIN = "/admin/pages/faq?tab=qanda";

function revalidateFaq(): void {
  revalidatePath("/admin/pages/faq");
  revalidatePath("/faq");
}

export async function seedFaqAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const inserted = await ensureFaqSeeded();
  if (inserted > 0) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "faq.seed",
      entityType: "faq_item",
      entityId: "all",
      after: { inserted },
    });
  }
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&seeded=${inserted}`);
}

export async function addFaqAction(): Promise<void> {
  const session = await requirePermission("content.edit");
  const result = await createFaqItem(session.userId);
  if ("error" in result) {
    redirect(`${FAQ_ADMIN}&error=${encodeURIComponent(result.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "faq.create",
    entityType: "faq_item",
    entityId: result.id,
  });
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&added=1#faq-${result.id}`);
}

export async function saveFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("item_id") ?? "");
  if (!id) redirect(FAQ_ADMIN);
  const res = await saveFaqDraft(
    id,
    {
      question: String(formData.get("question") ?? "").trim(),
      answer: String(formData.get("answer") ?? "").trim(),
      draft_enabled: formData.get("draft_enabled") === "on",
    },
    session.userId,
  );
  if (res.error) {
    redirect(`${FAQ_ADMIN}&error=${encodeURIComponent(res.error)}#faq-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "faq.draft",
    entityType: "faq_item",
    entityId: id,
  });
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&saved=1#faq-${id}`);
}

export async function publishFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("item_id") ?? "");
  if (!id) redirect(FAQ_ADMIN);
  const res = await publishFaqItem(id, session.userId);
  if (res.error) {
    redirect(`${FAQ_ADMIN}&error=${encodeURIComponent(res.error)}#faq-${id}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "faq.publish",
    entityType: "faq_item",
    entityId: id,
  });
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&published=1#faq-${id}`);
}

export async function deleteFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("item_id") ?? "");
  if (!id) redirect(FAQ_ADMIN);
  const res = await deleteFaqItem(id);
  if (res.error) {
    redirect(`${FAQ_ADMIN}&error=${encodeURIComponent(res.error)}`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "faq.delete",
    entityType: "faq_item",
    entityId: id,
  });
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&deleted=1`);
}

export async function moveFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("item_id") ?? "");
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  if (!id) redirect(FAQ_ADMIN);
  await moveFaqItem(id, direction);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "faq.reorder",
    entityType: "faq_item",
    entityId: id,
    after: { direction },
  });
  revalidateFaq();
  redirect(`${FAQ_ADMIN}&moved=1#faq-${id}`);
}

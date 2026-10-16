"use server";

/**
 * R64 — save / publish the Vendors page CENTER section (one richjson block).
 * Scope-guarded to vendors.center.layout; the draft is re-normalized
 * server-side (unsafe links / emails dropped) before it is stored. "Reset"
 * stores a BLANK draft, which (once published) returns the page to the older
 * per-field blocks.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getContentBlock, saveContentDraft, publishContentBlock } from "@/lib/cms/content-store";
import { parseVendorCenter, serializeVendorCenter, VENDOR_CENTER_BLOCK } from "@/lib/vendors/vendor-center-core";

const BACK = "/admin/pages/vendors?tab=center";

async function centerAction(formData: FormData, mode: "save" | "publish" | "reset"): Promise<void> {
  const session = await requirePermission("content.edit");
  if (String(formData.get("block_key") ?? "") !== VENDOR_CENTER_BLOCK) redirect("/admin/pages/vendors");
  const block = await getContentBlock(VENDOR_CENTER_BLOCK);
  if (!block) redirect(`${BACK}&error=${encodeURIComponent("The center block isn't set up yet — reload the page.")}`);
  if (mode === "publish") {
    await publishContentBlock(VENDOR_CENTER_BLOCK, session.userId, { actorEmail: session.email });
  } else {
    const parsed = mode === "reset" ? null : parseVendorCenter(String(formData.get("draft_value") ?? ""));
    await saveContentDraft(VENDOR_CENTER_BLOCK, parsed ? serializeVendorCenter(parsed) : "", session.userId);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: mode === "publish" ? "content.publish" : "content.draft",
    entityType: "content_block",
    entityId: VENDOR_CENTER_BLOCK,
    before: mode === "publish" ? { published_value: block.published_value } : { draft_value: block.draft_value },
  });
  revalidatePath("/admin/pages/vendors");
  if (mode === "publish") revalidatePath("/vendor-delivery");
  redirect(`${BACK}&${mode === "publish" ? "published" : "saved"}=1`);
}

export async function saveVendorCenterDraftAction(formData: FormData): Promise<void> {
  await centerAction(formData, "save");
}
export async function publishVendorCenterAction(formData: FormData): Promise<void> {
  await centerAction(formData, "publish");
}
export async function resetVendorCenterAction(formData: FormData): Promise<void> {
  await centerAction(formData, "reset");
}

"use server";
/**
 * src/app/admin/media/organize-actions.ts — R65 S4. Bulk "organise" for the
 * Media Library's multi-select: set the purpose, add/remove labels (tags),
 * change the status, or ✨ auto-file (rule-based classify-core, no AI cost) —
 * on every selected asset at once. Metadata only: no file is moved, nothing is
 * deleted, every change is audited.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getMedia, updateMediaMeta, setMediaStatus } from "@/lib/media/store";
import { isValidPurpose, normalizeTags } from "@/lib/media/taxonomy";
import { safeAdminPath, appendQuery } from "@/lib/media/return-state-core";
import { classifyMediaAsset, suggestTags } from "@/lib/media/classify-core";

/** Auto-file only applies a guess this sure (classify-core confidence 0.35–0.95). */
const AUTO_FILE_MIN_CONFIDENCE = 0.6;

export async function bulkOrganizeMediaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const returnTo = safeAdminPath(String(formData.get("returnTo") ?? ""), "/admin/media");
  const ids = Array.from(new Set(formData.getAll("ids").map((v) => String(v).trim()).filter(Boolean))).slice(0, 1000);
  if (ids.length === 0) redirect(appendQuery(returnTo, { error: "Select at least one item first." }));

  const mode = String(formData.get("mode") ?? "apply");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const addTags = normalizeTags(String(formData.get("add_tags") ?? ""));
  const removeTags = new Set(normalizeTags(String(formData.get("remove_tags") ?? "")));
  const rawStatus = String(formData.get("status") ?? "");
  const status = rawStatus === "published" || rawStatus === "draft" || rawStatus === "archived" ? rawStatus : "";
  if (mode === "apply" && !purpose && addTags.length === 0 && removeTags.size === 0 && !status) {
    redirect(appendQuery(returnTo, { error: "Choose a purpose, labels or a status to apply." }));
  }
  if (purpose && !isValidPurpose(purpose)) redirect(appendQuery(returnTo, { error: "Unknown purpose." }));

  let changed = 0;
  let skipped = 0;
  for (const id of ids) {
    const asset = await getMedia(id);
    if (!asset) continue;
    const before = { usage_type: asset.usage_type, tags: asset.tags, status: asset.status };
    const meta: { usage_type?: string; tags?: string[] } = {};
    if (mode === "auto") {
      const cls = classifyMediaAsset({
        filename: asset.filename,
        source: asset.source,
        title: asset.title,
        tags: asset.tags,
        mimeType: asset.mime_type,
        width: asset.width,
        height: asset.height,
        currentUsageType: asset.usage_type,
      });
      if (cls.confidence < AUTO_FILE_MIN_CONFIDENCE || cls.usageType === asset.usage_type) {
        skipped += 1;
        continue;
      }
      meta.usage_type = cls.usageType;
      const extra = suggestTags(cls, { filename: asset.filename, source: asset.source, title: asset.title, tags: asset.tags });
      meta.tags = normalizeTags([...(asset.tags ?? []), ...extra].join(","));
    } else {
      if (purpose) meta.usage_type = purpose;
      if (addTags.length || removeTags.size) {
        meta.tags = normalizeTags([...(asset.tags ?? []).filter((t) => !removeTags.has(t)), ...addTags].join(","));
      }
    }
    try {
      if (Object.keys(meta).length) await updateMediaMeta(id, meta);
      if (mode !== "auto" && status && status !== asset.status) await setMediaStatus(id, status);
      changed += 1;
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: mode === "auto" ? "media.auto_filed" : "media.bulk_organized",
        entityType: "media_asset",
        entityId: id,
        before,
        after: { ...meta, ...(status ? { status } : {}) },
      }).catch(() => {});
    } catch {
      skipped += 1;
    }
  }
  revalidatePath("/admin/media");
  const note =
    mode === "auto"
      ? `Auto-filed ${changed} file(s).${skipped ? ` ${skipped} left as they were (not sure enough, or already right).` : ""}`
      : `Organised ${changed} file(s).${skipped ? ` ${skipped} couldn't be updated.` : ""}`;
  redirect(appendQuery(returnTo, { deleted: "1", note }));
}

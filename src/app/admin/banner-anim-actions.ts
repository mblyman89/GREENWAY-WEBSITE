"use server";
/**
 * R60-S2 — the Banner Studio's 🎞️ Animations tab asks for the Lottie / Rive
 * files in the Media Library. Read-only. Picture pickers keep their own
 * image/video-only lists, so animation files never show up as "pictures".
 */
import { requirePermission } from "@/lib/auth/session";
import { listMedia } from "@/lib/media/store";
import { kindOfMime } from "@/lib/media/upload-policy-core";
import { animEngineFor, safeAnimSrc } from "@/lib/cms/banner-anim-core";

export type AnimChoice = { id: string; url: string; title: string; engine: "lottie" | "rive"; size: number | null };

export async function listBannerAnimationsAction(): Promise<AnimChoice[]> {
  await requirePermission("content.edit");
  const rows = await listMedia({ limit: 500 }).catch(() => []);
  const out: AnimChoice[] = [];
  for (const m of rows) {
    if (kindOfMime(m.mime_type) !== "animation" || m.status === "archived") continue;
    const url = safeAnimSrc(m.public_url);
    const engine = url ? animEngineFor(url) : null;
    if (!url || !engine) continue;
    out.push({ id: m.id, url, title: m.title || m.filename || "Animation", engine, size: typeof m.size_bytes === "number" ? m.size_bytes : null });
  }
  return out;
}

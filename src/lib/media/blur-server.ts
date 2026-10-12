import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  BLUR_MAX_DIM,
  blurLookupUrls,
  cleanBlurDataUrl,
  wantsBlur,
} from "./blur-placeholder-core";

/**
 * R45-S2: the server half of banner blur previews.
 *
 * makeBlurDataUrl(): at upload time, shrink the image to a ≤10px WebP (Next 16
 * next/image docs: "a very small image (10px or less) is recommended") and
 * return it as a base64 data URL, validated by cleanBlurDataUrl().
 *
 * getBlurMap(): at render time, look the previews up by public URL in ONE
 * query. Every failure (column not migrated yet, table missing, network) just
 * returns an empty map, so banners render exactly as before — a preview is a
 * nice-to-have and must never break a page.
 */

/** Largest source we will decode for a preview (bigger photos simply skip it). */
export const BLUR_SOURCE_MAX_BYTES = 15 * 1024 * 1024;

export async function makeBlurDataUrl(buffer: Uint8Array, mime: string): Promise<string | null> {
  if (!wantsBlur(mime) || buffer.length === 0 || buffer.length > BLUR_SOURCE_MAX_BYTES) return null;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(buffer, { failOn: "error" })
      .rotate() // respect EXIF orientation so the preview matches the photo
      .resize(BLUR_MAX_DIM, BLUR_MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 50 })
      .toBuffer();
    return cleanBlurDataUrl(`data:image/webp;base64,${out.toString("base64")}`);
  } catch {
    return null;
  }
}

/** Is this Supabase error "the blur_data_url column isn't there yet" (migration 0266 not applied)? */
export function isMissingBlurColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = String(err.message ?? "");
  if (!/blur_data_url/.test(msg)) return false;
  return err.code === "42703" || err.code === "PGRST204" || /column|schema cache/i.test(msg);
}

/** URL -> preview for the given banner srcs. Never throws; empty map on any problem. */
export async function getBlurMap(srcs: ReadonlyArray<unknown>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const urls = blurLookupUrls(srcs);
  if (urls.length === 0 || !isSupabaseServiceConfigured) return map;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("media_assets")
      .select("public_url, blur_data_url")
      .in("public_url", urls)
      .not("blur_data_url", "is", null);
    if (error || !data) return map;
    for (const row of data as { public_url: string | null; blur_data_url: string | null }[]) {
      const clean = cleanBlurDataUrl(row.blur_data_url);
      if (row.public_url && clean) map.set(row.public_url, clean);
    }
  } catch {
    /* preview is optional */
  }
  return map;
}

/** Best-effort: store a preview on an existing media row. Returns true when saved. */
export async function saveBlurForAsset(assetId: string, blur: string | null): Promise<boolean> {
  const clean = cleanBlurDataUrl(blur);
  if (!clean || !isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("media_assets").update({ blur_data_url: clean }).eq("id", assetId);
    return !error;
  } catch {
    return false;
  }
}

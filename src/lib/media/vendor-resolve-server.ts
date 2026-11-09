/**
 * D221 M1: which vendor card a menu's seller name belongs to, for media
 * provenance. Calls public.media_resolve_vendor (0352): license first, then the
 * normalised display / legal name / slug, then a long-enough name prefix.
 * Merged-away vendors are never returned.
 *
 * Best-effort by design: null when unknown or when 0352 is not applied yet -
 * the image is still saved, it just stays a draft until a person (or the
 * provenance backfill) knows its vendor.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; id: string | null }>();

export async function resolveMediaVendorId(label: string | null | undefined, license?: string | null): Promise<string | null> {
  const l = (label ?? "").trim();
  const lic = (license ?? "").trim();
  if (!l && !lic) return null;
  const key = `${l.toLowerCase()}|${lic}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("media_resolve_vendor", { p_label: l || null, p_license: lic || null });
    const id = !error && typeof data === "string" && data ? data : null;
    cache.set(key, { at: Date.now(), id });
    return id;
  } catch {
    return null;
  }
}

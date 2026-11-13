/**
 * src/lib/cms/newsletter-frame-server.ts
 *
 * D243 E-1 (SOP-22 G-121): load and save the locked brand frame
 * (site_settings `newsletter_brand_frame`, KEEP table, no migration) and
 * work out each newsletter's issue number and date.
 *
 * Issue number = how many newsletters were created up to and including this
 * one (plus the owner's "issues before the app" offset, applied in the core).
 * Date = the post's publish date, else the day it was created (Pacific).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { FRAME_SETTING_KEY, defaultFrame, normalizeFrame, type BrandFrame, type FrameIssue } from "./newsletter-frame-core";

export async function loadBrandFrame(): Promise<BrandFrame> {
  if (!isSupabaseServiceConfigured) return defaultFrame();
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", FRAME_SETTING_KEY).maybeSingle();
    const v = (data as { value_json: unknown } | null)?.value_json;
    return v ? normalizeFrame(v) : defaultFrame();
  } catch {
    return defaultFrame();
  }
}

export async function saveBrandFrame(raw: unknown, updatedBy: string | null): Promise<{ ok: true; frame: BrandFrame } | { ok: false; error: string }> {
  const frame = normalizeFrame(raw);
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: FRAME_SETTING_KEY,
        label: "Newsletter brand frame (D243 E-1)",
        value_json: frame as unknown as Record<string, unknown>,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, frame };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

function pacificDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/** Issue number and date for one newsletter (null number when unknown). */
export async function issueFor(postId: string | null | undefined): Promise<FrameIssue> {
  const today = pacificDay(new Date().toISOString());
  if (!isSupabaseServiceConfigured || !postId) return { number: null, date: today };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("blog_posts").select("id, created_at, publish_date").eq("id", postId).maybeSingle();
    const row = data as { id: string; created_at: string | null; publish_date: string | null } | null;
    if (!row?.created_at) return { number: null, date: today };
    const { count } = await admin.from("blog_posts").select("id", { count: "exact", head: true }).eq("kind", "newsletter").lte("created_at", row.created_at);
    const date = row.publish_date ? (/^\d{4}-\d{2}-\d{2}$/.test(row.publish_date) ? row.publish_date : pacificDay(row.publish_date)) : pacificDay(row.created_at);
    return { number: typeof count === "number" && count > 0 ? count : null, date: date || today };
  } catch {
    return { number: null, date: today };
  }
}

/** Frame + issue in one go (what every send-side render needs). */
export async function frameContextFor(postId: string | null | undefined): Promise<{ frame: BrandFrame; issue: FrameIssue }> {
  const [frame, issue] = await Promise.all([loadBrandFrame(), issueFor(postId)]);
  return { frame, issue };
}

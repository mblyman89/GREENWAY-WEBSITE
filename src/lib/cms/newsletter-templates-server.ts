/**
 * src/lib/cms/newsletter-templates-server.ts
 *
 * D243 E-3 (SOP-22 G-123): load and store the saved sections of the
 * full-page newsletter editor (site_settings `newsletter_saved_sections`,
 * KEEP table, no migration). Cleaning lives in the pure core.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeSavedSections, SAVED_SECTIONS_KEY, type SavedSection } from "./newsletter-templates-core";

export async function loadSavedSections(): Promise<SavedSection[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("site_settings").select("value_json").eq("key", SAVED_SECTIONS_KEY).maybeSingle();
    return normalizeSavedSections((data as { value_json: unknown } | null)?.value_json ?? []);
  } catch {
    return [];
  }
}

export async function storeSavedSections(list: SavedSection[], updatedBy: string | null): Promise<{ ok: true; list: SavedSection[] } | { ok: false; error: string }> {
  const clean = normalizeSavedSections(list);
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("site_settings").upsert(
      {
        key: SAVED_SECTIONS_KEY,
        label: "Newsletter saved sections (D243 E-3)",
        value_json: { items: clean } as unknown as Record<string, unknown>,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message.slice(0, 200) };
    return { ok: true, list: clean };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Could not save the sections." };
  }
}

/**
 * src/lib/media/library-picker-server.ts — Round 21 (C).
 *
 * Reads the media library for the enrichment editor's "Choose from your media
 * library" picker. Named columns only, archived rows excluded in the query,
 * newest first, bounded by LIBRARY_READ_LIMIT. A failed read is reported as
 * `ok: false` so the page can say so instead of showing an empty library that
 * isn't really empty. Thumbnails use the same public-bucket URL every other
 * admin grid uses (publicUrlForKey, falling back to the stored public_url).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { publicUrlForKey } from "./store";
import { LIBRARY_READ_LIMIT, type LibraryPickerAsset, type LibraryScope } from "./library-picker-core";

export const LIBRARY_PICKER_COLUMNS =
  "id, storage_key, public_url, filename, title, alt_text, tags, usage_type, status, mime_type, license_status, created_at";

type Row = {
  id: string;
  storage_key: string | null;
  public_url: string | null;
  filename: string | null;
  title: string | null;
  alt_text: string | null;
  tags: string[] | null;
  usage_type: string | null;
  status: string | null;
  mime_type: string | null;
  license_status: string | null;
  created_at: string | null;
};

export type LibraryPickerRead = { ok: true; assets: LibraryPickerAsset[] } | { ok: false; assets: [] };

export async function readLibraryPickerAssets(scope: LibraryScope): Promise<LibraryPickerRead> {
  if (!isSupabaseServiceConfigured) return { ok: true, assets: [] };
  try {
    const admin = createSupabaseAdminClient();
    let q = admin
      .from("media_assets")
      .select(LIBRARY_PICKER_COLUMNS)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(LIBRARY_READ_LIMIT);
    if (scope === "product") q = q.eq("usage_type", "product");
    const { data, error } = await q;
    if (error) return { ok: false, assets: [] };
    const rows = (data as Row[] | null) ?? [];
    return {
      ok: true,
      assets: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        title: r.title,
        alt_text: r.alt_text,
        tags: r.tags,
        usage_type: r.usage_type,
        status: r.status,
        mime_type: r.mime_type,
        license_status: r.license_status,
        created_at: r.created_at,
        url: (r.storage_key ? publicUrlForKey(r.storage_key) : null) ?? r.public_url ?? null,
      })),
    };
  } catch {
    return { ok: false, assets: [] };
  }
}

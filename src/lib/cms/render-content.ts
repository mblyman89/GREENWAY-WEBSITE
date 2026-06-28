/**
 * render-content — draft-aware content reading for PUBLIC pages.
 *
 * When the visitor is a staff member previewing the site (Next.js Draft Mode
 * is enabled via the admin preview routes), public pages should show the
 * *draft* value of a content block so the editor sees their unpublished change
 * live. Everyone else sees the published value.
 *
 * Use `<SiteText blockKey="home.hero.title" />` in public pages instead of
 * hardcoding copy; it handles draft-vs-published and tags the element for the
 * click-to-edit overlay automatically.
 */
import "server-only";
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { CONTENT_BLOCK_SEEDS } from "./content-blocks-seed";
import type { PostStatus } from "./types";

const SEED_DEFAULTS = new Map(
  CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s.defaultValue]),
);

/**
 * Resolve a content block's value for rendering on the PUBLIC site.
 * - In Draft Mode (staff preview): prefer draft_value, else published_value, else seed.
 * - Normally: published_value (only if status published), else seed default.
 */
export async function getContentForRender(
  blockKey: string,
): Promise<string> {
  const fallback = SEED_DEFAULTS.get(blockKey) ?? "";

  let isPreview = false;
  try {
    const dm = await draftMode();
    isPreview = dm.isEnabled;
  } catch {
    isPreview = false;
  }

  if (!isSupabaseServiceConfigured) return fallback;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("content_blocks")
      .select("published_value, draft_value, status")
      .eq("block_key", blockKey)
      .maybeSingle();
    const row = data as {
      published_value: string | null;
      draft_value: string | null;
      status: PostStatus;
    } | null;

    if (!row) return fallback;

    if (isPreview) {
      return row.draft_value ?? row.published_value ?? fallback;
    }
    if (row.status === "published" && row.published_value != null) {
      return row.published_value;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve several content blocks at once for a server page that needs to pass
 * the values down to a CLIENT component (e.g. the homepage Hero carousel, the
 * loyalty signup form). Returns a record keyed by block_key. Uses one round
 * trip to the DB and honours Draft Mode exactly like `getContentForRender`.
 *
 * Usage (server component):
 *   const copy = await getContentValues(["home.hero.title", "home.hero.subtitle"]);
 *   return <Hero title={copy["home.hero.title"]} subtitle={copy["home.hero.subtitle"]} />
 */
export async function getContentValues(
  blockKeys: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of blockKeys) {
    result[key] = SEED_DEFAULTS.get(key) ?? "";
  }

  let isPreview = false;
  try {
    const dm = await draftMode();
    isPreview = dm.isEnabled;
  } catch {
    isPreview = false;
  }

  if (!isSupabaseServiceConfigured) return result;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("content_blocks")
      .select("block_key, published_value, draft_value, status")
      .in("block_key", blockKeys);

    const rows = (data ?? []) as Array<{
      block_key: string;
      published_value: string | null;
      draft_value: string | null;
      status: PostStatus;
    }>;

    for (const row of rows) {
      const fallback = result[row.block_key] ?? "";
      if (isPreview) {
        result[row.block_key] =
          row.draft_value ?? row.published_value ?? fallback;
      } else if (row.status === "published" && row.published_value != null) {
        result[row.block_key] = row.published_value;
      }
    }
    return result;
  } catch {
    return result;
  }
}

/** Is the current request a staff preview (Draft Mode on)? */
export async function isPreviewActive(): Promise<boolean> {
  try {
    const dm = await draftMode();
    return dm.isEnabled;
  } catch {
    return false;
  }
}

/**
 * src/lib/inventory/cultivera-category-gate.ts   (R74 S15, store)
 *
 * Reads which LIVE cards (published menu version) are held until somebody
 * picks their category: menu_items.hidden_reason = "needs_category", written
 * by the transform's holdForCategory (R74 S1). Read-only. Every read error is
 * returned as { ok: false } so callers fail closed: an approval is refused,
 * a manifest is never shown as Done.
 *
 * The rules live in cultivera-category-gate-core.ts (pure).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { NEEDS_CATEGORY_REASON, categoryHoldKeys } from "@/lib/inventory/cultivera-category-gate-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type HoldRow = { source_item_id: string | null; hidden_reason: string | null };
export type CategoryHoldKeys = { ok: true; held: Set<string> } | { ok: false; error: string };

const CHUNK = 150;
const PAGE = 1000;
/** Safety stop, far above the live menu's size. */
const MAX_ROWS = 50_000;

/**
 * The published menu version's id, read strictly: getPublishedVersion()
 * returns null on a read ERROR as well as when nothing is published, and a
 * gate cannot tell those apart. Here an error is { ok: false }; "nothing
 * published" is { ok: true, id: null } (no live card exists, so none is held).
 */
export async function readPublishedVersionId(admin: Admin): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const { data, error } = await admin.from("menu_versions").select("id").eq("status", "published").limit(1).maybeSingle();
  if (error) return { ok: false, error: error.message };
  const id = (data as { id?: unknown } | null)?.id;
  return { ok: true, id: typeof id === "string" && id ? id : null };
}

/** Of these keys, the ones whose live card is held for a category (strict version read included). */
export async function loadPublishedCategoryHoldKeys(admin: Admin, keys: readonly string[]): Promise<CategoryHoldKeys> {
  const unique = keys.filter(Boolean);
  if (unique.length === 0) return { ok: true, held: new Set() };
  const v = await readPublishedVersionId(admin);
  if (!v.ok) return { ok: false, error: v.error };
  if (!v.id) return { ok: true, held: new Set() };
  return loadCategoryHoldKeys(admin, v.id, unique);
}

/** Every live card held for a category, in the published version (strict). */
export async function loadAllPublishedCategoryHoldKeys(admin: Admin): Promise<CategoryHoldKeys> {
  const v = await readPublishedVersionId(admin);
  if (!v.ok) return { ok: false, error: v.error };
  if (!v.id) return { ok: true, held: new Set() };
  return loadAllCategoryHoldKeys(admin, v.id);
}

/** Of these keys, the ones whose live card is held for a category. */
export async function loadCategoryHoldKeys(admin: Admin, publishedVersionId: string, keys: readonly string[]): Promise<CategoryHoldKeys> {
  const rows: HoldRow[] = [];
  const unique = Array.from(new Set(keys.filter(Boolean)));
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await admin
      .from("menu_items")
      .select("source_item_id, hidden_reason")
      .eq("menu_version_id", publishedVersionId)
      .in("source_item_id", unique.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message };
    rows.push(...((data as HoldRow[] | null) ?? []));
  }
  return { ok: true, held: categoryHoldKeys(rows) };
}

/** Every live card held for a category (paged; a truncated read is an error, never a short list). */
export async function loadAllCategoryHoldKeys(admin: Admin, publishedVersionId: string): Promise<CategoryHoldKeys> {
  const rows: HoldRow[] = [];
  for (let off = 0; ; off += PAGE) {
    if (off >= MAX_ROWS) return { ok: false, error: "too many held cards to read" };
    const { data, error } = await admin
      .from("menu_items")
      .select("source_item_id, hidden_reason")
      .eq("menu_version_id", publishedVersionId)
      .eq("hidden_reason", NEEDS_CATEGORY_REASON)
      .order("id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const got = (data as HoldRow[] | null) ?? [];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { ok: true, held: categoryHoldKeys(rows) };
}

/**
 * For the onboarding page: which of these drafts' keys are held for a
 * category. null = could not tell (the page then shows a notice; the server
 * gate re-reads at approval and refuses on the same failure).
 */
export async function loadHeldKeysForPage(keys: readonly (string | null)[]): Promise<Set<string> | null> {
  const unique = Array.from(new Set(keys.filter((k): k is string => Boolean(k))));
  if (unique.length === 0 || !isSupabaseServiceConfigured) return new Set();
  const read = await loadPublishedCategoryHoldKeys(createSupabaseAdminClient(), unique);
  return read.ok ? read.held : null;
}

"use server";
/**
 * D278 - save / load / remove "My garments" (Merch Studio Garments tab).
 * site_settings `merch_saved_garments` (KEEP table, no migration). Rules:
 * saved-garments-core.ts. Permission content.edit (same as the studio).
 */
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getBlank } from "@/lib/merch-studio/garment-catalog-core";
import {
  SAVED_GARMENTS_KEY, cleanSavedGarment, normalizeSavedGarments, removeSavedGarment, upsertSavedGarment, type SavedGarment,
} from "@/lib/merch-studio/saved-garments-core";

export type SavedGarmentsResult = { ok: true; list: SavedGarment[] } | { ok: false; error: string };
const known = (id: string) => !!getBlank(id);

async function read(): Promise<SavedGarment[]> {
  const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", SAVED_GARMENTS_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeSavedGarments((data as { value_json: unknown } | null)?.value_json ?? [], known);
}

async function write(list: SavedGarment[], by: string | null): Promise<SavedGarment[]> {
  const clean = normalizeSavedGarments(list, known);
  const { error } = await createSupabaseAdminClient().from("site_settings").upsert(
    { key: SAVED_GARMENTS_KEY, label: "Merch Studio saved garments (D278)", value_json: { items: clean } as unknown as Record<string, unknown>, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  return clean;
}

const fail = (e: unknown): SavedGarmentsResult => ({ ok: false, error: `Couldn't reach the saved garments: ${(e instanceof Error ? e.message : "unknown error").slice(0, 160)}` });

export async function listSavedGarmentsAction(): Promise<SavedGarmentsResult> {
  await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try { return { ok: true, list: await read() }; } catch (e) { return fail(e); }
}

export async function saveGarmentAction(input: unknown): Promise<SavedGarmentsResult> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const g = cleanSavedGarment({ ...(input && typeof input === "object" ? input : {}), savedAt: new Date().toISOString() }, known);
  if (!g) return { ok: false, error: "Give the garment a name (and pick a garment) before saving." };
  try { return { ok: true, list: await write(upsertSavedGarment(await read(), g), session.userId ?? null) }; } catch (e) { return fail(e); }
}

export async function removeSavedGarmentAction(input: { id: string }): Promise<SavedGarmentsResult> {
  const session = await requirePermission("content.edit");
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try { return { ok: true, list: await write(removeSavedGarment(await read(), String(input?.id ?? "")), session.userId ?? null) }; } catch (e) { return fail(e); }
}

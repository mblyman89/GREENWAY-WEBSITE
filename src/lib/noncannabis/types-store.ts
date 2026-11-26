import "server-only";
/**
 * OI-ACC S3 - read / write public.noncannabis_types (0371). Every call reads
 * its error (rule 15). A missing table (migration not applied) falls back to
 * the built-in list with `fromRegistry: false` so pages still work and say so.
 */
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { NC_TYPE_COLUMNS, builtinTypeRows, planNewType, cleanCardFields, type NcTypeRow } from "@/lib/noncannabis/types-core";

export type NcTypesRead = { rows: NcTypeRow[]; fromRegistry: boolean; error: string | null };

function explain(code: string | undefined, message: string): string {
  if (code === "42P01" || code === "PGRST205") return "The type list table is missing - apply migration 0371_noncannabis_types.sql in the Supabase SQL editor.";
  if (code === "42501") return "The server is not allowed to read the type list (missing grant) - re-run migration 0371.";
  return message;
}

/** Every type row, archived included (the list is small: tens of rows). */
export const readNcTypes = cache(async (): Promise<NcTypesRead> => {
  if (!isSupabaseServiceConfigured) return { rows: builtinTypeRows(), fromRegistry: false, error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("noncannabis_types").select(NC_TYPE_COLUMNS).order("sort").order("value").limit(500);
  if (error) return { rows: builtinTypeRows(), fromRegistry: false, error: explain(error.code, error.message) };
  return { rows: (data ?? []) as NcTypeRow[], fromRegistry: true, error: null };
});

type WriteResult = { ok: true; value: string } | { ok: false; error: string };

export async function addNcType(label: unknown, actorId: string | null): Promise<WriteResult> {
  const read = await readNcTypes();
  if (!read.fromRegistry) return { ok: false, error: read.error ?? "The type list table is not available yet." };
  const plan = planNewType(label, read.rows);
  if (!plan.ok) return plan;
  const admin = createSupabaseAdminClient();
  const r = plan.row;
  const { error } = await admin.from("noncannabis_types").insert({
    value: r.value,
    label: r.label,
    sku_prefix: r.sku_prefix,
    menu_group: r.menu_group,
    sort: r.sort,
    draft_label: r.label,
    draft_text: "",
    draft_image: "",
    card_label: r.label,
    card_text: "",
    card_image: "",
    card_published_at: null,
    updated_by: actorId,
  });
  if (error) return { ok: false, error: error.code === "23505" ? `"${r.label}" already exists.` : explain(error.code, error.message) };
  return { ok: true, value: r.value };
}

/** Archive (true) or restore (false). Never deletes; products keep their type. */
export async function setNcTypeArchived(value: string, archived: boolean, actorId: string | null): Promise<WriteResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("noncannabis_types")
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString(), updated_by: actorId })
    .eq("value", value)
    .select("value");
  if (error) return { ok: false, error: explain(error.code, error.message) };
  if (!data?.length) return { ok: false, error: "That type was not found." };
  return { ok: true, value };
}

export async function renameNcType(value: string, label: unknown, actorId: string | null): Promise<WriteResult> {
  const read = await readNcTypes();
  if (!read.fromRegistry) return { ok: false, error: read.error ?? "The type list table is not available yet." };
  const clean = String(label ?? "").trim();
  const plan = planNewType(clean, read.rows.filter((r) => r.value !== value));
  if (!plan.ok) return plan;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("noncannabis_types")
    .update({ label: plan.row.label, updated_at: new Date().toISOString(), updated_by: actorId })
    .eq("value", value)
    .select("value");
  if (error) return { ok: false, error: explain(error.code, error.message) };
  if (!data?.length) return { ok: false, error: "That type was not found." };
  return { ok: true, value };
}

/** Save card drafts (and optionally publish them) for many types at once. */
export async function saveNcTypeCards(
  cards: { value: string; label: unknown; text: unknown; image: unknown; sort: number }[],
  publish: boolean,
  actorId: string | null,
): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let saved = 0;
  // One small update per type: the list is tens of rows, each row has its own
  // values, and PostgREST has no multi-row update with different values.
  for (const c of cards) {
    const f = cleanCardFields(c);
    const patch: Record<string, unknown> = {
      draft_label: f.label,
      draft_text: f.text,
      draft_image: f.image,
      sort: Math.max(0, Math.min(100000, Math.round(c.sort))),
      updated_at: now,
      updated_by: actorId,
    };
    if (publish) Object.assign(patch, { card_label: f.label, card_text: f.text, card_image: f.image, card_published_at: now });
    const { error } = await admin.from("noncannabis_types").update(patch).eq("value", c.value);
    if (error) return { ok: false, error: explain(error.code, error.message) };
    saved++;
  }
  return { ok: true, saved };
}

/**
 * src/lib/marketing/ideas-store.ts
 *
 * E1 (Marketing & Advertising). Data access for the private "idea notebook" of
 * WA-compliant AI marketing strategy DRAFTS (table: public.marketing_ideas,
 * migration 0065). Drafts-only — nothing here is published or sent.
 *
 * Server-only. Uses the Supabase admin client (RLS still applies at the DB via
 * is_staff()), mirroring the payroll/vendors stores.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type MarketingIdeaStatus = "idea" | "planned" | "done" | "archived";

export type MarketingIdea = {
  id: string;
  goal: string;
  channel: string;
  title: string;
  body: string;
  status: MarketingIdeaStatus;
  ai_model: string | null;
  compliance_ok: boolean;
  compliance_flags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  "id,goal,channel,title,body,status,ai_model,compliance_ok,compliance_flags,notes,created_at,updated_at";

/** List saved marketing ideas, newest first. Read-only; safe when DB absent. */
export async function listMarketingIdeas(limit = 100): Promise<MarketingIdea[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_ideas")
      .select(COLS)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as MarketingIdea[];
  } catch {
    return [];
  }
}

export type SaveMarketingIdeaInput = {
  goal: string;
  channel: string;
  title: string;
  body: string;
  aiModel: string | null;
  complianceOk: boolean;
  complianceFlags: string[];
};

/** Insert a new idea draft. Returns the new id on success. */
export async function saveMarketingIdea(
  input: SaveMarketingIdeaInput,
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("marketing_ideas")
      .insert({
        goal: input.goal,
        channel: input.channel || "general",
        title: input.title || input.goal.slice(0, 80) || "Untitled idea",
        body: input.body,
        status: "idea" as MarketingIdeaStatus,
        ai_model: input.aiModel,
        compliance_ok: input.complianceOk,
        compliance_flags: input.complianceFlags,
        created_by: actorId,
        updated_by: actorId,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Failed to save idea." };
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save idea." };
  }
}

/** Update an idea's status (triage the notebook) or notes. */
export async function updateMarketingIdea(
  id: string,
  patch: { status?: MarketingIdeaStatus; notes?: string; title?: string },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (!id) return { ok: false, error: "Missing id." };
  try {
    const admin = createSupabaseAdminClient();
    const record: Record<string, unknown> = { updated_by: actorId, updated_at: new Date().toISOString() };
    if (patch.status !== undefined) record.status = patch.status;
    if (patch.notes !== undefined) record.notes = patch.notes;
    if (patch.title !== undefined) record.title = patch.title;
    const { error } = await admin.from("marketing_ideas").update(record).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update idea." };
  }
}

/** Delete an idea from the notebook. */
export async function deleteMarketingIdea(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (!id) return { ok: false, error: "Missing id." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("marketing_ideas").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete idea." };
  }
}

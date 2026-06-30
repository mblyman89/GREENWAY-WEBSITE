/**
 * src/lib/syndication/store.ts
 *
 * Server-side store for syndication_logs (migration 0049). Records every Leafly /
 * WeedMaps preview or live push attempt with the payload, response, and outcome so
 * staff have a full audit trail of what was sent off-platform.
 *
 * Best-effort: returns []/no-op when the Supabase service role is not configured.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type SyndicationChannel = "leafly" | "weedmaps";
export type SyndicationMode = "preview" | "live";
export type SyndicationStatus = "ok" | "error" | "skipped";

export type SyndicationLog = {
  id: string;
  channel: SyndicationChannel;
  mode: SyndicationMode;
  status: SyndicationStatus;
  item_count: number;
  payload: unknown;
  response: unknown;
  message: string | null;
  created_by: string | null;
  created_at: string;
};

export type RecordSyndicationInput = {
  channel: SyndicationChannel;
  mode: SyndicationMode;
  status?: SyndicationStatus;
  itemCount: number;
  payload?: unknown;
  response?: unknown;
  message?: string | null;
  createdBy?: string | null;
};

export async function recordSyndicationLog(input: RecordSyndicationInput): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("syndication_logs").insert({
    channel: input.channel,
    mode: input.mode,
    status: input.status ?? "ok",
    item_count: input.itemCount,
    payload: input.payload ?? null,
    response: input.response ?? null,
    message: input.message ?? null,
    created_by: input.createdBy ?? null,
  });
  if (error) {
    console.error("[syndication] recordSyndicationLog error:", error.message);
  }
}

export async function listSyndicationLogs(
  channel: SyndicationChannel,
  limit = 25,
): Promise<SyndicationLog[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("syndication_logs")
    .select("*")
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[syndication] listSyndicationLogs error:", error.message);
    return [];
  }
  return (data ?? []) as SyndicationLog[];
}

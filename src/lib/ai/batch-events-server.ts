/**
 * R74 S41 - the Batch Mission Control message log (ai_batch_events, 0299).
 * Every call to / reply from the Gemini Batch API is written here with its
 * plain-English explanation. Best effort: a missing table never stops the
 * engine (the page then says migration 0299 is needed).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createBackoffMin, type Severity } from "@/lib/ai/gemini-batch-explain-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type BatchEventKind = "create" | "poll" | "cancel" | "delete" | "list" | "console" | "ingest" | "control" | "error";

export type BatchEventIn = {
  kind: BatchEventKind;
  title: string;
  plain?: string | null;
  fix?: string | null;
  severity?: Severity;
  batchId?: string | null;
  batchName?: string | null;
  httpStatus?: number | null;
  googleState?: string | null;
  command?: string | null;
  raw?: string | null;
  actorEmail?: string | null;
};

export type BatchEvent = {
  id: string;
  at: string;
  batch_id: string | null;
  batch_name: string | null;
  kind: BatchEventKind;
  http_status: number | null;
  google_state: string | null;
  severity: Severity;
  title: string;
  plain: string | null;
  fix: string | null;
  command: string | null;
  raw: string | null;
  actor_email: string | null;
};

export async function logBatchEvent(admin: Admin, e: BatchEventIn): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("ai_batch_events")
      .insert({
        kind: e.kind,
        title: e.title.slice(0, 300),
        plain: e.plain?.slice(0, 2000) ?? null,
        fix: e.fix?.slice(0, 1000) ?? null,
        severity: e.severity ?? "info",
        batch_id: e.batchId ?? null,
        batch_name: e.batchName ?? null,
        http_status: e.httpStatus ?? null,
        google_state: e.googleState ?? null,
        command: e.command?.slice(0, 1000) ?? null,
        raw: e.raw?.slice(0, 40000) ?? null,
        actor_email: e.actorEmail ?? null,
      })
      .select("id")
      .single();
    if (error) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

const COLS = "id, at, batch_id, batch_name, kind, http_status, google_state, severity, title, plain, fix, command, raw, actor_email";

export async function recentBatchEvents(admin: Admin, limit = 80): Promise<{ ok: boolean; events: BatchEvent[] }> {
  const { data, error } = await admin.from("ai_batch_events").select(COLS).order("at", { ascending: false }).limit(Math.min(200, limit));
  if (error) return { ok: false, events: [] };
  return { ok: true, events: (data as BatchEvent[] | null) ?? [] };
}

export async function batchEventById(admin: Admin, id: string): Promise<BatchEvent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("ai_batch_events").select(COLS).eq("id", id).maybeSingle();
  return (data as BatchEvent | null) ?? null;
}

/**
 * Back-off after Google refused batch creates: the refusals in a row since
 * the last accepted create decide the wait (5, 10, 20, 40, 60 min).
 */
export async function createBackoffUntil(admin: Admin): Promise<{ until: string | null; streak: number; last: BatchEvent | null }> {
  const { data, error } = await admin.from("ai_batch_events").select(COLS).eq("kind", "create").order("at", { ascending: false }).limit(6);
  if (error) return { until: null, streak: 0, last: null };
  const rows = (data as BatchEvent[] | null) ?? [];
  let streak = 0;
  for (const r of rows) {
    if (r.severity === "ok") break;
    streak += 1;
  }
  if (streak === 0) return { until: null, streak: 0, last: rows[0] ?? null };
  const until = new Date(Date.parse(rows[0].at) + createBackoffMin(streak) * 60_000).toISOString();
  return { until, streak, last: rows[0] };
}

/**
 * src/lib/admin/audit-anomaly.ts
 *
 * Server-side glue for the audit-log anomaly analysis (Slice 62). Loads a recent
 * window of audit_logs, runs the deterministic detector (audit-anomaly-core),
 * and — when an AI key is configured — asks the shared provider to summarize and
 * prioritize the ALREADY-COMPUTED findings in plain language (drafts-only,
 * strictly grounded; the AI cannot invent events).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generate, isAiConfigured } from "@/lib/ai/provider";
import {
  buildAnomalyReport,
  buildAnomalySystemPrompt,
  type AnomalyReport,
  type AuditRow,
} from "./audit-anomaly-core";

/** Load the most recent window of audit rows (PII-light projection). */
export async function loadRecentAuditRows(limit = 500): Promise<AuditRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("id, actor_email, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    actorEmail: (r.actor_email as string | null) ?? null,
    action: String(r.action ?? ""),
    entityType: (r.entity_type as string | null) ?? null,
    entityId: r.entity_id != null ? String(r.entity_id) : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

/** Deterministic anomaly report over the recent window. */
export async function getAuditAnomalyReport(limit = 500): Promise<AnomalyReport> {
  const rows = await loadRecentAuditRows(limit);
  return buildAnomalyReport(rows);
}

export type AuditAssistantResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

/**
 * Ask the grounded audit-security analyst a question about the recent log.
 * The AI is fed ONLY the deterministic report (no raw PII rows) and forbidden
 * from inventing events. Mirrors the Sage/printer assistant pattern.
 */
export async function askAuditAssistant(
  question: string,
  actor: { actorId?: string | null; actorEmail?: string | null },
): Promise<AuditAssistantResult> {
  const q = (question ?? "").trim();
  if (!q) return { ok: false, error: "Please enter a question." };
  if (!isAiConfigured) {
    return {
      ok: false,
      error: "The AI assistant isn't configured. The deterministic findings above are still available.",
    };
  }
  try {
    const report = await getAuditAnomalyReport();
    const answer = await generate({
      system: buildAnomalySystemPrompt(report),
      user: q,
      temperature: 0.2,
      maxTokens: 700,
      context: {
        feature: "audit.anomaly.assistant",
        actorId: actor.actorId ?? null,
        actorEmail: actor.actorEmail ?? null,
      },
    });
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The assistant could not respond." };
  }
}

/** A one-shot AI summary of the current findings (used for the default view). */
export async function summarizeAuditAnomalies(
  actor: { actorId?: string | null; actorEmail?: string | null },
): Promise<AuditAssistantResult> {
  return askAuditAssistant(
    "Summarize the most important anomalies or risks in the recent audit log and what I should verify first.",
    actor,
  );
}

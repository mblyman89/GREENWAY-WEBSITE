// Append-only audit logging. Uses the service-role client so inserts always
// succeed regardless of RLS, while reads remain staff-gated.
import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AUDIT_WRITE_TIMEOUT_MS, queryDeadline } from "@/lib/supabase/query-deadline";

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const hdrs = await headers();
    const ip =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      hdrs.get("x-real-ip") ??
      null;
    const userAgent = hdrs.get("user-agent");

    const admin = createSupabaseAdminClient();
    await admin
      .from("audit_logs")
      .insert({
        actor_id: entry.actorId ?? null,
        actor_email: entry.actorEmail ?? null,
        action: entry.action,
        entity_type: entry.entityType ?? null,
        entity_id: entry.entityId ?? null,
        before_json: entry.before ?? null,
        after_json: entry.after ?? null,
        ip,
        user_agent: userAgent,
      })
      // SLICE L-25. Bounded, so that the catch below can actually do its
      // job. Without a deadline an insert that never settles blocks this
      // `await` forever and nothing is ever thrown — the "never let audit
      // failures break a user action" promise is silently broken by the one
      // failure mode it cannot see. `.abortSignal()` must follow
      // `.insert()`; it lives on the transform builder.
      .abortSignal(queryDeadline(AUDIT_WRITE_TIMEOUT_MS));
  } catch {
    // never let audit failures break a user action
  }
}

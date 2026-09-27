/**
 * src/lib/catalog/fact-attach-policy-server.ts  (S10, shadow ring)
 *
 * Server half of the fact-attach policy. It does two things, and it WRITES
 * nothing:
 *   1. currentAttachPolicyRing() reads ATTACH_POLICY_RING. There is no
 *      database read.
 *   2. loadShadowSummary() builds the /admin/inventory/drafts footer
 *      counters. It is ONE bounded read of recent catalog_draft.ai_lookup
 *      audit rows. It selects only the `after_json->policy` JSON path, so
 *      each row is a few bytes. It filters on the (action, created_at desc)
 *      index from 0231, is capped at SHADOW_MAX_ROWS, and adds no new table,
 *      poll or cron.
 *
 * A failed read returns null ("counts are unavailable"). It never returns a
 * confident zero.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  ATTACH_POLICY_RING_ENV,
  SHADOW_MAX_ROWS,
  SHADOW_WINDOW_DAYS,
  parseAttachPolicyRing,
  summarizeShadowAudit,
  type AttachPolicyRing,
  type ShadowSummary,
} from "@/lib/catalog/fact-attach-policy-core";

/** The audit action the lookup already writes (ai-lookup-actions.ts). */
export const LOOKUP_AUDIT_ACTION = "catalog_draft.ai_lookup";

export function currentAttachPolicyRing(): AttachPolicyRing {
  return parseAttachPolicyRing(process.env[ATTACH_POLICY_RING_ENV]);
}

export async function loadShadowSummary(now: Date = new Date()): Promise<ShadowSummary | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const since = new Date(now.getTime() - SHADOW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("audit_logs")
      .select("policy:after_json->policy")
      .eq("action", LOOKUP_AUDIT_ACTION)
      .gte("created_at", since)
      .not("after_json->policy", "is", null)
      .order("created_at", { ascending: false })
      .limit(SHADOW_MAX_ROWS);
    if (error) {
      console.error("[fact-attach-policy] shadow summary read failed:", error.message);
      return null;
    }
    return summarizeShadowAudit((data as { policy?: unknown }[] | null) ?? []);
  } catch (err) {
    console.error("[fact-attach-policy] shadow summary read threw:", err);
    return null;
  }
}

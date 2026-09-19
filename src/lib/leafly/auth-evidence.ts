/**
 * src/lib/leafly/auth-evidence.ts
 *
 * Read back the calls we have already made to Leafly that required an access
 * token, so the certification gate can answer "have we ever successfully
 * authenticated?" from recorded fact rather than from a proxy.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The certification page used to infer authentication from live MENU PUSHES
 * only. During onboarding that is precisely backwards: the owner is told, by
 * the panel's own remedy text, to press "Check integration status" first
 * because it is read-only and proves auth. He did. Leafly replied HTTP 200
 * with menuIntegrationEnabled:true and integratedItemCount:1876. The panel went
 * on reporting authentication as UNTESTED, because no menu had been pushed.
 *
 * Following a system's advice and watching nothing change is how an owner
 * learns to stop trusting the system.
 *
 * `fetchLeaflyStatusAction` has always recorded that call to `audit_logs` under
 * the action "leafly.status.fetch", with the HTTP status in `after_json`. The
 * evidence was on disk the whole time and nothing read it. This module reads
 * it. No migration is required, and no new write path is introduced - which
 * matters, because a fix that needs Michael to run SQL by hand is a fix that
 * does not land tonight.
 *
 * Judgement lives in certification-core's pure `deriveAuthSucceeded`; this file
 * only fetches and shapes. Best-effort by design: with no service role
 * configured it returns [], which `deriveAuthSucceeded` maps to null
 * ("untested"), never to a false failure.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import type { AuthenticatedAttempt } from "./certification-core";

/** The audit action written by fetchLeaflyStatusAction. */
export const LEAFLY_STATUS_AUDIT_ACTION = "leafly.status.fetch";

/**
 * Pull an HTTP status out of a recorded audit row's after_json.
 *
 * Exported and pure so it can be tested against real row shapes. Returns null
 * rather than guessing when the column is missing or malformed: an unreadable
 * record must leave the verdict untested, not invent a failure.
 */
export function readHttpStatus(afterJson: unknown): number | null {
  if (!afterJson || typeof afterJson !== "object") return null;
  const raw = (afterJson as Record<string, unknown>).httpStatus;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  // Some drivers hand back numerics as strings. Accept that, but only when the
  // whole string is a number - "200 OK" is not a status we can be sure of.
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/**
 * Every recorded token-bearing call to Leafly, OLDEST FIRST.
 *
 * Oldest-first matters: `deriveAuthSucceeded` and `latestSuccessfulAttempt`
 * both treat the end of the array as "most recent", matching the ordering
 * convention `recentPushStatuses` already uses on the same page.
 */
export async function loadLeaflyAuthAttempts(limit = 25): Promise<AuthenticatedAttempt[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("action, after_json, created_at")
    .eq("action", LEAFLY_STATUS_AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Record<string, unknown>[])
    .map((row): AuthenticatedAttempt | null => {
      const httpStatus = readHttpStatus(row.after_json);
      if (httpStatus === null) return null;
      return {
        kind: "status check",
        httpStatus,
        at: row.created_at != null ? String(row.created_at) : null,
      };
    })
    .filter((a): a is AuthenticatedAttempt => a !== null)
    .reverse(); // newest-first from the query -> oldest-first for the caller
}

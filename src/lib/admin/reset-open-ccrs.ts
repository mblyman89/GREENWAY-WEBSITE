/**
 * src/lib/admin/reset-open-ccrs.ts — Round 5 / Slice R5-2. SERVER-ONLY.
 *
 * Kept apart from reset-service.ts on purpose: the reset itself MUST run on
 * the owner's session (is_owner(); factory-reset-core.test.ts forbids the
 * service-role client there). This read is of the CCRS ledger, which is
 * service-role only, and changes nothing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { summariseOpenCcrsFiles, type OpenCcrsFileRow, type OpenCcrsSummary } from "@/lib/accounting/reset-proof-core";

/**
 * R5-2: CCRS files the State has not answered yet (any state but closed /
 * abandoned), both envs. The reset KEEPS ccrs_files, so these stay open after
 * it; the reset screen names them. Read with the service-role client (the CCRS
 * ledger is service-role only); the page itself is settings.manage gated.
 * Returns { ok: false } on any read error (0247 not applied, etc.) so the screen says
 * it could not check, rather than claiming nothing is open.
 */
export async function loadOpenCcrsFiles(): Promise<
  { ok: true; summary: OpenCcrsSummary | null } | { ok: false; error: string }
> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ccrs_files")
    .select("env, state, file_name, file_type")
    .not("state", "in", "(closed,abandoned)")
    .order("file_name", { ascending: true })
    .limit(500);
  if (error) return { ok: false, error: error.message };
  return { ok: true, summary: summariseOpenCcrsFiles((data as OpenCcrsFileRow[] | null) ?? []) };
}

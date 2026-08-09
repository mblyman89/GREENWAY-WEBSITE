/**
 * src/lib/atm/store.ts — ATM/PAI Slice A-2a (server-only)
 *
 * Read/write access to the single PAI Reports connection row (atm_connection,
 * migration 0156). Mirrors the enterprise pattern in src/lib/payroll/
 * payroll-store.ts::getAchCompanySettings / saveAchCompanySettings:
 *   - guarded by isSupabaseServiceConfigured (graceful "unconfigured" when the
 *     DB isn't wired, so the page renders instead of crashing),
 *   - createSupabaseAdminClient() for service-role access,
 *   - credentials envelope-encrypted at rest via encryptSecret (no-op until
 *     DATA_ENCRYPTION_KEY is set; already-encrypted values pass through),
 *   - the decrypted password NEVER leaves the server: the read shape exposes
 *     only `hasPassword`/`hasUsername` booleans + a masked username hint.
 *
 * A-2a is config-only. The live PAI login/download (pai-client.ts) and the
 * settlement/load sync (sync-server.ts) arrive in A-2b — deliberately deferred
 * so we never guess PAI's CSV headers before Michael sends real exports.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { encryptSecret, decryptSecret, maskAccountTail } from "@/lib/security/at-rest-crypto";

export type AtmConnectionStatus = "unconfigured" | "ok" | "error";

/**
 * The SAFE, client-shippable view of the connection. NO decrypted secrets.
 * `usernameHint` is a masked tail only; `hasPassword` tells the form whether a
 * secret is on file without ever revealing it.
 */
export type AtmConnectionView = {
  id: string | null;
  portalBaseUrl: string;
  terminalId: string;
  companyLabel: string;
  status: AtmConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  hasUsername: boolean;
  hasPassword: boolean;
  /** Masked username tail (e.g. ••••• com) — never the full value. */
  usernameHint: string;
  reportConfig: Record<string, unknown>;
};

const EMPTY_VIEW: AtmConnectionView = {
  id: null,
  portalBaseUrl: "https://paireports.com/myreports/",
  terminalId: "",
  companyLabel: "",
  status: "unconfigured",
  lastSyncAt: null,
  lastError: null,
  hasUsername: false,
  hasPassword: false,
  usernameHint: "",
  reportConfig: {},
};

type Row = {
  id: string;
  pai_username_enc: string | null;
  pai_password_enc: string | null;
  portal_base_url: string | null;
  terminal_id: string | null;
  company_label: string | null;
  report_config: Record<string, unknown> | null;
  status: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

const COLS =
  "id,pai_username_enc,pai_password_enc,portal_base_url,terminal_id,company_label,report_config,status,last_sync_at,last_error";

function normalizeStatus(s: string | null | undefined): AtmConnectionStatus {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "ok") return "ok";
  if (v === "error") return "error";
  return "unconfigured";
}

/**
 * Read the single connection row (best-effort). There is normally exactly one
 * row; if somehow more exist we take the most recently created. The decrypted
 * password is NOT returned — only booleans + a masked username hint.
 */
export async function getAtmConnection(): Promise<AtmConnectionView> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_VIEW };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_connection")
      .select(COLS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ...EMPTY_VIEW };
    const row = data as Row;

    const username = row.pai_username_enc ? decryptSecret(row.pai_username_enc) : "";
    const hasUsername = username.trim().length > 0;
    const hasPassword = (row.pai_password_enc ?? "").trim().length > 0;

    return {
      id: row.id,
      portalBaseUrl: (row.portal_base_url ?? EMPTY_VIEW.portalBaseUrl).trim() || EMPTY_VIEW.portalBaseUrl,
      terminalId: (row.terminal_id ?? "").trim(),
      companyLabel: (row.company_label ?? "").trim(),
      status: normalizeStatus(row.status),
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      hasUsername,
      hasPassword,
      usernameHint: hasUsername ? maskAccountTail(username) : "",
      reportConfig: row.report_config ?? {},
    };
  } catch {
    return { ...EMPTY_VIEW };
  }
}

export type SaveAtmConnectionInput = {
  portalBaseUrl: string;
  terminalId: string;
  companyLabel: string;
  username: string;
  /** New password, or empty to KEEP the existing one. */
  password: string;
};

/**
 * Create-or-update the single connection row. Username & password are
 * encrypted at rest (no-op until DATA_ENCRYPTION_KEY is set). An empty
 * password means "keep the existing secret" — the form uses this so re-saving
 * other fields does not wipe the stored password.
 *
 * Saving credentials never flips status to "ok" — that only happens after a
 * successful Test/Sync in A-2b. When creds change we reset to "unconfigured"
 * so the health chip honestly says "saved but not yet tested".
 */
export async function saveAtmConnection(
  input: SaveAtmConnectionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();

  const portalBaseUrl = (input.portalBaseUrl ?? "").trim() || EMPTY_VIEW.portalBaseUrl;
  const terminalId = (input.terminalId ?? "").trim();
  const companyLabel = (input.companyLabel ?? "").trim();
  const username = (input.username ?? "").trim();
  const newPassword = input.password ?? ""; // do NOT trim — a space could be meaningful

  try {
    // Find the existing singleton (if any).
    const { data: existing } = await admin
      .from("atm_connection")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const base: Record<string, unknown> = {
      portal_base_url: portalBaseUrl,
      terminal_id: terminalId || null,
      company_label: companyLabel || null,
      pai_username_enc: username ? encryptSecret(username) : null,
      status: "unconfigured",
      last_error: null,
    };
    // Only overwrite the password when a new one was typed.
    if (newPassword.length > 0) {
      base.pai_password_enc = encryptSecret(newPassword);
    }

    if (existing?.id) {
      const { error } = await admin.from("atm_connection").update(base).eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      // First save must include a password column even if empty (nullable).
      if (!("pai_password_enc" in base)) base.pai_password_enc = null;
      const { error } = await admin.from("atm_connection").insert(base);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error saving connection." };
  }
}

/** Clear the stored credentials (keeps the row + identity, wipes secrets). */
export async function clearAtmCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  try {
    const { data: existing } = await admin
      .from("atm_connection")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing?.id) return { ok: true };
    const { error } = await admin
      .from("atm_connection")
      .update({ pai_username_enc: null, pai_password_enc: null, status: "unconfigured", last_error: null })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error clearing credentials." };
  }
}

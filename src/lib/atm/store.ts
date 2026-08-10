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

/**
 * SERVER-ONLY, INTERNAL: read the connection with the DECRYPTED credentials.
 *
 * This is the ONLY reader that returns the plaintext username/password, and it
 * exists solely so pai-client.ts can log into PAI during a sync. The result
 * MUST NEVER be sent to the browser or logged. The public getAtmConnection()
 * (above) is the safe, client-shippable view (booleans + masked hint only).
 *
 * Returns null when the DB is unconfigured or there is no row / no credentials
 * yet, so callers degrade gracefully instead of throwing.
 */
export type AtmConnectionSecrets = {
  id: string;
  portalBaseUrl: string;
  terminalId: string;
  companyLabel: string;
  username: string; // decrypted
  password: string; // decrypted
  reportConfig: Record<string, unknown>;
};

export async function getAtmConnectionSecrets(): Promise<AtmConnectionSecrets | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_connection")
      .select(COLS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Row;

    const username = row.pai_username_enc ? decryptSecret(row.pai_username_enc) : "";
    const password = row.pai_password_enc ? decryptSecret(row.pai_password_enc) : "";
    if (username.trim() === "" || password.trim() === "") return null;

    return {
      id: row.id,
      portalBaseUrl: (row.portal_base_url ?? EMPTY_VIEW.portalBaseUrl).trim() || EMPTY_VIEW.portalBaseUrl,
      terminalId: (row.terminal_id ?? "").trim(),
      companyLabel: (row.company_label ?? "").trim(),
      username,
      password,
      reportConfig: row.report_config ?? {},
    };
  } catch {
    return null;
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

/**
 * MERGE a partial report_config patch onto the single connection row (does NOT
 * overwrite the whole jsonb — other keys like historyStart/customCmdList are
 * preserved). Used by the "Discover report fields" flow to store the confident
 * per-report `dateFieldName` override so the backfill uses PAI's REAL date
 * columns. Never throws; returns the merged config on success.
 */
export async function mergeAtmReportConfig(
  patch: Record<string, unknown>,
): Promise<{ ok: true; reportConfig: Record<string, unknown> } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  try {
    const { data: existing } = await admin
      .from("atm_connection")
      .select("id,report_config")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing?.id) return { ok: false, error: "No PAI connection is saved yet." };
    const current = (existing.report_config as Record<string, unknown> | null) ?? {};
    const merged = { ...current, ...patch };
    const { error } = await admin.from("atm_connection").update({ report_config: merged }).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, reportConfig: merged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error saving report settings." };
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

// ---------------------------------------------------------------------------
// Slice A-2b-ui — read settlements & cash loads for the two data tabs, plus the
// owner manual cash-load fallback insert. All money stays in CENTS. These read
// tables are populated by the A-2c PAI sync (and/or manual entry); until then
// they return empty arrays so the tabs render an honest empty state.
// ---------------------------------------------------------------------------

export type AtmSettlementRow = {
  id: string;
  settlementDate: string; // ISO yyyy-mm-dd
  terminalId: string;
  totalTrx: number | null;
  withdrawalTrx: number | null;
  surchargedWdTrx: number | null;
  terminalTransactionCents: number | null;
  surchargeCents: number | null;
  settlementTotalCents: number | null;
};

const SETTLEMENT_COLS =
  "id,settlement_date,terminal_id,total_trx,withdrawal_trx,surcharged_wd_trx,terminal_transaction_cents,surcharge_cents,settlement_total_cents";

/** List settlements, newest settlement_date first. Empty when DB unconfigured. */
export async function listAtmSettlements(limit = 400): Promise<AtmSettlementRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_settlements")
      .select(SETTLEMENT_COLS)
      .order("settlement_date", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      settlementDate: String(r.settlement_date ?? ""),
      terminalId: String(r.terminal_id ?? ""),
      totalTrx: numOrNull(r.total_trx),
      withdrawalTrx: numOrNull(r.withdrawal_trx),
      surchargedWdTrx: numOrNull(r.surcharged_wd_trx),
      terminalTransactionCents: numOrNull(r.terminal_transaction_cents),
      surchargeCents: numOrNull(r.surcharge_cents),
      settlementTotalCents: numOrNull(r.settlement_total_cents),
    }));
  } catch {
    return [];
  }
}

export type AtmCashLoadRow = {
  id: string;
  terminalId: string;
  loadedAtRaw: string | null;
  loadDate: string | null;
  cashLoadCents: number;
  balanceAfterCents: number | null;
  source: "pai" | "manual";
};

const CASH_LOAD_COLS =
  "id,terminal_id,loaded_at,load_date,cash_load_cents,balance_after_cents,source,raw";

/** List cash loads, newest loaded_at first. Empty when DB unconfigured. */
export async function listAtmCashLoads(limit = 400): Promise<AtmCashLoadRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_cash_loads")
      .select(CASH_LOAD_COLS)
      .order("loaded_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r) => {
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      // Prefer the verbatim report "Trx Time" captured in raw; fall back to loaded_at.
      const rawTrxTime =
        typeof raw["Trx Time"] === "string"
          ? (raw["Trx Time"] as string)
          : typeof raw.loaded_at_raw === "string"
            ? (raw.loaded_at_raw as string)
            : null;
      return {
        id: String(r.id),
        terminalId: String(r.terminal_id ?? ""),
        loadedAtRaw: rawTrxTime ?? (r.loaded_at ? String(r.loaded_at) : null),
        loadDate: r.load_date ? String(r.load_date) : null,
        cashLoadCents: Number(r.cash_load_cents ?? 0),
        balanceAfterCents: numOrNull(r.balance_after_cents),
        source: r.source === "manual" ? "manual" : "pai",
      };
    });
  } catch {
    return [];
  }
}

export type InsertManualCashLoadInput = {
  terminalId: string;
  loadedAtIso: string; // ISO yyyy-mm-dd (from the validated form)
  cents: number; // integer cents (already validated)
  note: string;
};

/**
 * Insert a hand-entered cash load (source='manual'). The load time is set to
 * noon UTC on the chosen date so it sorts sensibly and does not collide with a
 * PAI auto-pulled load at a real instant. The note is kept in `raw` for audit.
 */
export async function insertManualCashLoad(
  input: InsertManualCashLoadInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const terminalId = (input.terminalId ?? "").trim();
  if (!terminalId) return { ok: false, error: "A terminal number is required to record a cash load." };
  if (!Number.isInteger(input.cents) || input.cents <= 0) {
    return { ok: false, error: "Cash-load amount must be a positive whole number of cents." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.loadedAtIso)) {
    return { ok: false, error: "Load date must be a valid yyyy-mm-dd." };
  }
  const admin = createSupabaseAdminClient();
  const note = (input.note ?? "").trim();
  try {
    const { error } = await admin.from("atm_cash_loads").insert({
      terminal_id: terminalId,
      loaded_at: `${input.loadedAtIso}T12:00:00Z`,
      load_date: input.loadedAtIso,
      cash_load_cents: input.cents,
      balance_after_cents: null, // unknown for a manual entry — never guessed
      source: "manual",
      raw: note ? { note, loaded_at_raw: input.loadedAtIso } : { loaded_at_raw: input.loadedAtIso },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error recording cash load." };
  }
}

/** Coerce a DB numeric/text/null into number|null without inventing a value. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Slice A-2c \u2014 idempotent UPSERT writers used by the ingestion engine
// (sync-server.ts). The plan shapes come from atm-sync-core (pure). We upsert
// on the tables' unique indexes so re-importing the same report is a no-op:
//   \u2022 atm_settlements  \u2192 conflict on (settlement_date, terminal_id)
//   \u2022 atm_cash_loads   \u2192 conflict on (terminal_id, loaded_at)
// All money stays in CENTS. Errors are RETURNED, never thrown, so a bad import
// surfaces as an honest message instead of a 500.
// ---------------------------------------------------------------------------

/** A settlement row ready to write (matches atm_settlements columns). */
export type UpsertAtmSettlementRow = {
  settlement_date: string;
  terminal_id: string;
  total_trx: number | null;
  withdrawal_trx: number | null;
  surcharged_wd_trx: number | null;
  terminal_transaction_cents: number | null;
  surcharge_cents: number | null;
  settlement_total_cents: number | null;
  raw: Record<string, unknown>;
};

/**
 * Upsert settlement rows on (settlement_date, terminal_id). Idempotent: a
 * re-import overwrites the same row instead of duplicating it. Returns the
 * count written, or an error string.
 */
export async function upsertAtmSettlements(
  rows: UpsertAtmSettlementRow[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (rows.length === 0) return { ok: true, count: 0 };
  const admin = createSupabaseAdminClient();
  try {
    const { error } = await admin
      .from("atm_settlements")
      .upsert(rows, { onConflict: "settlement_date,terminal_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: rows.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error writing settlements." };
  }
}

/** A cash-load row ready to write (matches atm_cash_loads columns). */
export type UpsertAtmCashLoadRow = {
  terminal_id: string;
  loaded_at: string;
  load_date: string | null;
  cash_load_cents: number;
  balance_after_cents: number | null;
  source: "pai" | "manual";
  raw: Record<string, unknown>;
};

/**
 * Upsert cash-load rows on (terminal_id, loaded_at). Idempotent: re-importing
 * the same load event overwrites rather than duplicates. Returns count or error.
 */
export async function upsertAtmCashLoads(
  rows: UpsertAtmCashLoadRow[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (rows.length === 0) return { ok: true, count: 0 };
  const admin = createSupabaseAdminClient();
  try {
    const { error } = await admin
      .from("atm_cash_loads")
      .upsert(rows, { onConflict: "terminal_id,loaded_at" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: rows.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error writing cash loads." };
  }
}

/**
 * Record the outcome of a sync/import on the single connection row so the
 * Health chip honestly reflects the last run: 'ok' on success (clears
 * last_error), 'error' otherwise (keeps the reason). Best-effort \u2014 never throws.
 */
export async function setAtmSyncResult(
  result: { ok: boolean; error?: string | null; at?: string },
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const at = result.at ?? new Date().toISOString();
  try {
    const { data: existing } = await admin
      .from("atm_connection")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing?.id) return;
    await admin
      .from("atm_connection")
      .update({
        status: result.ok ? "ok" : "error",
        last_sync_at: at,
        last_error: result.ok ? null : (result.error ?? "Unknown error").slice(0, 500),
      })
      .eq("id", existing.id);
  } catch {
    // best-effort health write; the ingest result itself is the source of truth.
  }
}

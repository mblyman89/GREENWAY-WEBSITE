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
import { optionalBigint, requiredBigint } from "@/lib/supabase/pg-bigint";
import { encryptSecret, decryptSecret, maskAccountTail } from "@/lib/security/at-rest-crypto";
import { listPlaidAccounts, listPlaidTransactions } from "@/lib/plaid/store";
import { toBankDeposits, type BankDeposit, type ReconcileSettlement } from "@/lib/atm/atm-reconcile-core";

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

/* ═══════════════════════════════════════════════════════════════════════════
 * THE DATABASE ROW SHAPES, AND WHY THEY ARRIVE THE WAY THEY DO
 *
 * Every read below used to say `data as Array<Record<string, unknown>>`. That
 * cast does not establish a shape, it ASSERTS one, and an assertion is not a
 * check: it tells the compiler to stop asking. The consequence was recorded in
 * this file's own `numOrNull` docstring before it was fixed - "no column in
 * this file has ever been type-checked at all" - and it was true. Five sites
 * carried it. (The books-69 recon counted four; it missed the one inside
 * `getLatestAtmTerminalStatus`. The number is stated here rather than quietly
 * corrected, per standing rule 89.)
 *
 * WHY THE `number | string` UNIONS ARE NOT SLOPPINESS. PostgREST serialises a
 * Postgres `bigint` as a JSON STRING and an `integer` as a JSON NUMBER, because
 * 64 bits do not fit in JavaScript's 53 bits of exact integer. So the union is
 * not "we are unsure what this is" - it is the wire format, written down. The
 * migration is the source of truth for which is which, and each field below is
 * annotated with the declared Postgres type it was MEASURED from:
 *
 *   0156_atm_pai_foundation.sql   atm_settlements, atm_cash_loads
 *   0183_atm_terminal_status.sql  atm_terminal_status
 *
 * `bigint` columns are typed `number | string` and must go through
 * `pg-bigint`. `integer` columns are typed `number | string` too, because a
 * view or a computed column can still hand back text, and `pg-bigint` refuses
 * that safely rather than coercing it.
 *
 * NULLABILITY IS COPIED FROM THE MIGRATION, NOT CHOSEN. A column the schema
 * declares `not null` is typed without `| null` here, which is what makes
 * `requiredBigint` the correct reader for it and `optionalBigint` the wrong
 * one. That distinction is load-bearing: see D-22 on `cash_load_cents`.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A row of `public.atm_settlements` as PostgREST returns it (migration 0156).
 * Every measurement column is nullable in the schema; null means PAI did not
 * report the figure, and never zero.
 */
type AtmSettlementDbRow = {
  readonly id: string; // uuid  not null
  readonly settlement_date: string; // date  not null
  readonly terminal_id: string; // text  not null
  readonly total_trx: number | string | null; // integer
  readonly withdrawal_trx: number | string | null; // integer
  readonly surcharged_wd_trx: number | string | null; // integer
  readonly terminal_transaction_cents: number | string | null; // bigint
  readonly surcharge_cents: number | string | null; // bigint
  readonly settlement_total_cents: number | string | null; // bigint
};

/**
 * The `select` list, DERIVED from the row type rather than written beside it.
 *
 * A hand-written select string and a hand-written row type are two lists that
 * must agree, and nothing was making them. Ask for a column and forget it in
 * the type and it is invisible; name it in the type and forget it in the select
 * and PostgREST simply omits it, so the field reads `undefined` at runtime
 * while the compiler believes it is a string. `Record<keyof T, true>` closes
 * both directions at once: a missing key fails to satisfy the Record, and an
 * extra key is not in `keyof T`. The select string is then generated from the
 * same object, so drift is a compile error instead of an empty column.
 */
const SETTLEMENT_COL_MAP = {
  id: true,
  settlement_date: true,
  terminal_id: true,
  total_trx: true,
  withdrawal_trx: true,
  surcharged_wd_trx: true,
  terminal_transaction_cents: true,
  surcharge_cents: true,
  settlement_total_cents: true,
} as const satisfies Record<keyof AtmSettlementDbRow, true>;

/** Join a checked column map into a PostgREST `select` list. */
function colsOf(map: Record<string, true>): string {
  return Object.keys(map).join(",");
}

/**
 * THE ONE PLACE THE UNTYPED WIRE BECOMES A TYPED ROW.
 *
 * The admin client is created by `createSupabaseAdminClient()` with no
 * generated `Database` generic, so supabase-js cannot know what
 * `.from("atm_settlements")` contains. Its declared return in that situation is
 * a union that includes `GenericStringError` - literally `{ error: true } &
 * String` - and that is not a pessimistic guess by the library, it is the
 * honest type of "I have no schema, this might be an error payload".
 *
 * The old `as Array<Record<string, unknown>>` cast compiled precisely BECAUSE
 * it was so loose that it overlapped that error sentinel. Narrowing to a real
 * row shape made TypeScript object, which is the type system doing its job:
 * asked to convert an error object into a settlement, it correctly refused.
 *
 * So the conversion is routed through `unknown` deliberately, and it is done
 * ONCE, here, instead of at four call sites. What this function does and does
 * not buy is worth stating plainly rather than leaving to be assumed:
 *
 *   IT DOES catch the error sentinel at runtime. `{ error: true }` is a real
 *   thing PostgREST can hand back, the declared type says so, and turning it
 *   into a row would produce an "ATM settlement" whose every column is
 *   undefined. That is refused here with a message naming the table.
 *
 *   IT DOES NOT verify each column's type. Proving `surcharge_cents` really is
 *   a bigint string would mean a validator per table, and the money columns
 *   already get exactly that from `pg-bigint` one layer down, which is where a
 *   bad figure actually needs to be stopped.
 *
 *   WHAT PROTECTS THE NON-MONEY COLUMNS is not this function but the
 *   `Record<keyof Row, true>` column maps above. The old code wrote
 *   `String(r.settlement_date ?? "")` because a column missing from the select
 *   list arrives as `undefined`, and that defensive `?? ""` then turned the
 *   omission into an empty date. The maps make that omission a COMPILE error,
 *   so the defensive coalesce is no longer papering over a real hazard and the
 *   field can simply be read.
 */
function rowsOf<T>(data: unknown, table: string): readonly T[] {
  if (!Array.isArray(data)) return [];
  for (const row of data) {
    if (row === null || typeof row !== "object" || (row as { error?: unknown }).error === true) {
      throw new Error(
        `A read of ${table} returned something that is not a row. PostgREST can answer a ` +
          `select with an error payload instead of data, and the declared type of this query ` +
          `includes exactly that case. Reading it as a row would produce a record whose every ` +
          `column is undefined - a settlement with no date and no amount, which downstream code ` +
          `would treat as real. Nothing was assumed and no row was invented; the read stopped here.`,
      );
    }
  }
  return data as readonly T[];
}

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

const SETTLEMENT_COLS = colsOf(SETTLEMENT_COL_MAP);

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
    return rowsOf<AtmSettlementDbRow>(data, "atm_settlements").map((r) => ({
      id: r.id,
      settlementDate: r.settlement_date,
      terminalId: r.terminal_id,
      totalTrx: numOrNull(r.total_trx, "atm_settlements", "total_trx"),
      withdrawalTrx: numOrNull(r.withdrawal_trx, "atm_settlements", "withdrawal_trx"),
      surchargedWdTrx: numOrNull(r.surcharged_wd_trx, "atm_settlements", "surcharged_wd_trx"),
      terminalTransactionCents: numOrNull(r.terminal_transaction_cents, "atm_settlements", "terminal_transaction_cents"),
      surchargeCents: numOrNull(r.surcharge_cents, "atm_settlements", "surcharge_cents"),
      settlementTotalCents: numOrNull(r.settlement_total_cents, "atm_settlements", "settlement_total_cents"),
    }));
  } catch {
    return [];
  }
}

/**
 * A row of `public.atm_cash_loads` as PostgREST returns it (migration 0156).
 *
 * `cash_load_cents` is declared `bigint NOT NULL`, and it is typed here without
 * `| null` for that reason. That is the whole of D-22: see the reader below.
 */
type AtmCashLoadDbRow = {
  readonly id: string; // uuid    not null
  readonly terminal_id: string; // text    not null
  readonly loaded_at: string | null; // timestamptz
  readonly load_date: string | null; // date
  readonly cash_load_cents: number | string; // bigint  NOT NULL
  readonly balance_after_cents: number | string | null; // bigint
  readonly source: string; // text    not null, check in ('pai','manual')
  readonly raw: Record<string, unknown> | null; // jsonb   not null default '{}'
};

const CASH_LOAD_COL_MAP = {
  id: true,
  terminal_id: true,
  loaded_at: true,
  load_date: true,
  cash_load_cents: true,
  balance_after_cents: true,
  source: true,
  raw: true,
} as const satisfies Record<keyof AtmCashLoadDbRow, true>;

export type AtmCashLoadRow = {
  id: string;
  terminalId: string;
  loadedAtRaw: string | null;
  loadDate: string | null;
  cashLoadCents: number;
  balanceAfterCents: number | null;
  source: "pai" | "manual";
};

const CASH_LOAD_COLS = colsOf(CASH_LOAD_COL_MAP);

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
    return rowsOf<AtmCashLoadDbRow>(data, "atm_cash_loads").map((r) => {
      const raw = r.raw ?? {};
      // Prefer the verbatim report "Trx Time" captured in raw; fall back to loaded_at.
      const rawTrxTime =
        typeof raw["Trx Time"] === "string"
          ? raw["Trx Time"]
          : typeof raw.loaded_at_raw === "string"
            ? raw.loaded_at_raw
            : null;
      return {
        id: r.id,
        terminalId: r.terminal_id,
        loadedAtRaw: rawTrxTime ?? r.loaded_at,
        loadDate: r.load_date,
        // D-22. This line used to read `Number(r.cash_load_cents ?? 0)`, and
        // that is the exact defect `pg-bigint.ts` was written to end - it even
        // names this file in its header as one of the callers still doing it.
        // The column is `bigint NOT NULL`, so PostgREST sends it as a STRING,
        // and `Number("")` is 0, not NaN. An unreadable or blank cash load
        // therefore became a confident "no cash was loaded", which is the most
        // dangerous possible wrong answer here because it is entirely
        // plausible - an ATM that was not filled that day looks identical. It
        // then flowed into `atm-ui-core.ts` `totalLoaded`, understating cash
        // put into the machine. `?? 0` also silently covered for a column the
        // schema says cannot be null, hiding a broken row instead of reporting
        // it. `requiredBigint` refuses all of it and says which column failed.
        cashLoadCents: requiredBigint(r.cash_load_cents, {
          table: "atm_cash_loads",
          column: "cash_load_cents",
          context: `cash load ${r.id}`,
        }),
        balanceAfterCents: numOrNull(r.balance_after_cents, "atm_cash_loads", "balance_after_cents"),
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

/**
 * Read a nullable numeric column from one of the three `atm_*` tables.
 *
 * Its docstring used to say "without inventing a value", and the body did not
 * deliver that. It took `unknown`, handed anything non-numeric to `Number()`,
 * and kept the result if it was finite - so an empty string became 0. A zero
 * `settlement_total_cents` or a zero `balance_cents` is not a refusal, it is a
 * reading: it says the terminal settled nothing, or holds no cash. That is a
 * value invented out of a blank, in the function whose contract was not to.
 * `Number.isFinite` also let `"9007199254740993"` through as an off-by-one
 * integer, on `bigint` columns.
 *
 * The conversion now comes from `@/lib/supabase/pg-bigint`, which validates the
 * text before converting and refuses anything outside JavaScript's exact
 * integer range. All eleven columns behind this reader are nullable in the
 * schema, so `optionalBigint` is the right half: a terminal with no reported
 * balance keeps its null, while an unreadable balance now says so instead of
 * quietly resembling one.
 *
 * IT USED TO TAKE `unknown`, AND THAT WAS A FINDING, NOT A PREFERENCE. The
 * previous note here read: "Narrowing the parameter to `number | string | null`
 * was tried first and the compiler refused it in eleven places, which is how
 * the real problem surfaced: every caller reads rows cast
 * `as Array<Record<string, unknown>>`, so no column in this file has ever been
 * type-checked at all." It then deferred the fix to the roadmap, because giving
 * the `atm_*` rows real shapes did not belong in a commit about W-2s.
 *
 * books-69 is that commit. The rows above now have declared shapes measured
 * from migrations 0156 and 0183, so the parameter is narrowed and the eleven
 * call sites type-check against the columns they actually name. The runtime
 * guard for "this is not a number or a string" is GONE ON PURPOSE, because it
 * is now unreachable: the only way to reach this function is through a typed
 * row field, and every one of those fields is declared `number | string | null`
 * after being read off the migration. A runtime check for a case the type
 * system has excluded is not extra safety, it is an untestable branch that
 * would fail standing rule 39 - an assertion nothing can make fire proves
 * nothing.
 *
 * What remains is the part that always mattered, and it now lives entirely in
 * `pg-bigint`: a blank is not a zero, hex and exponent notation are refused
 * rather than coerced, and anything outside JavaScript's exact integer range
 * stops here instead of arriving silently wrong.
 */
function numOrNull(
  v: number | string | null | undefined,
  table: string,
  column: string,
): number | null {
  return optionalBigint(v, { table, column, context: `an ${table} row` });
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

// ---------------------------------------------------------------------------
// Slice A-2e — Terminal Status (PAI Realtime) snapshots  (migration 0183)
// ---------------------------------------------------------------------------

/** A terminal-status snapshot ready to write (matches atm_terminal_status). */
export type UpsertAtmTerminalStatusRow = {
  terminal_id: string;
  captured_at: string; // ISO timestamptz
  status: string | null;
  location: string | null;
  group_name: string | null;
  days_until_cash_out: number | null;
  trxs_since_settlement: number | null;
  last_trx_raw: string | null;
  last_wd_trx_raw: string | null;
  last_rev_trx_raw: string | null;
  balance_prev_eod_cents: number | null;
  balance_cents: number | null;
  raw: Record<string, unknown>;
};

/**
 * Upsert terminal-status snapshots on (terminal_id, captured_at). Idempotent:
 * re-running a sync at the same instant overwrites instead of duplicating.
 */
export async function upsertAtmTerminalStatus(
  rows: UpsertAtmTerminalStatusRow[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (rows.length === 0) return { ok: true, count: 0 };
  const admin = createSupabaseAdminClient();
  try {
    const { error } = await admin
      .from("atm_terminal_status")
      .upsert(rows, { onConflict: "terminal_id,captured_at" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: rows.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error writing terminal status." };
  }
}

/** The read shape for a stored snapshot. Money in CENTS; null = not reported. */
export type AtmTerminalStatusRecord = {
  id: string;
  terminalId: string;
  capturedAt: string;
  status: string | null;
  location: string | null;
  groupName: string | null;
  daysUntilCashOut: number | null;
  trxsSinceSettlement: number | null;
  lastTrxRaw: string | null;
  lastWdTrxRaw: string | null;
  lastRevTrxRaw: string | null;
  balancePrevEodCents: number | null;
  balanceCents: number | null;
};

/**
 * A row of `public.atm_terminal_status` as PostgREST returns it (0183).
 *
 * The migration is explicit that "every measurement column is NULLABLE on
 * purpose: PAI omits columns depending on how the report is configured, and
 * NULL means 'not reported' -- never zero." The nullability below is copied
 * from it rather than decided here.
 */
type AtmTerminalStatusDbRow = {
  readonly id: string; // uuid        not null
  readonly terminal_id: string; // text        not null
  readonly captured_at: string; // timestamptz not null
  readonly status: string | null; // text
  readonly location: string | null; // text
  readonly group_name: string | null; // text
  readonly days_until_cash_out: number | string | null; // integer
  readonly trxs_since_settlement: number | string | null; // integer
  readonly last_trx_raw: string | null; // text
  readonly last_wd_trx_raw: string | null; // text
  readonly last_rev_trx_raw: string | null; // text
  readonly balance_prev_eod_cents: number | string | null; // bigint
  readonly balance_cents: number | string | null; // bigint
};

const TERMINAL_STATUS_COL_MAP = {
  id: true,
  terminal_id: true,
  captured_at: true,
  status: true,
  location: true,
  group_name: true,
  days_until_cash_out: true,
  trxs_since_settlement: true,
  last_trx_raw: true,
  last_wd_trx_raw: true,
  last_rev_trx_raw: true,
  balance_prev_eod_cents: true,
  balance_cents: true,
} as const satisfies Record<keyof AtmTerminalStatusDbRow, true>;

const TERMINAL_STATUS_COLS = colsOf(TERMINAL_STATUS_COL_MAP);

function mapTerminalStatusRecord(r: AtmTerminalStatusDbRow): AtmTerminalStatusRecord {
  return {
    id: r.id,
    terminalId: r.terminal_id.trim(),
    capturedAt: r.captured_at,
    status: textOrNullDb(r.status),
    location: textOrNullDb(r.location),
    groupName: textOrNullDb(r.group_name),
    daysUntilCashOut: numOrNull(r.days_until_cash_out, "atm_terminal_status", "days_until_cash_out"),
    trxsSinceSettlement: numOrNull(r.trxs_since_settlement, "atm_terminal_status", "trxs_since_settlement"),
    lastTrxRaw: textOrNullDb(r.last_trx_raw),
    lastWdTrxRaw: textOrNullDb(r.last_wd_trx_raw),
    lastRevTrxRaw: textOrNullDb(r.last_rev_trx_raw),
    balancePrevEodCents: numOrNull(r.balance_prev_eod_cents, "atm_terminal_status", "balance_prev_eod_cents"),
    balanceCents: numOrNull(r.balance_cents, "atm_terminal_status", "balance_cents"),
  };
}

function textOrNullDb(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * The MOST RECENT snapshot for a terminal (or for the only machine on the
 * account when no terminal is configured). Returns null when nothing has been
 * captured yet — the caller must then fall back to the derived estimate rather
 * than pretending a live reading exists.
 */
export async function getLatestAtmTerminalStatus(
  terminalId?: string | null,
): Promise<AtmTerminalStatusRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    let q = admin
      .from("atm_terminal_status")
      .select(TERMINAL_STATUS_COLS)
      .order("captured_at", { ascending: false })
      .limit(1);
    const want = (terminalId ?? "").trim();
    if (want !== "") q = q.eq("terminal_id", want);
    const { data, error } = await q;
    if (error || !data || data.length === 0) return null;
    const [first] = rowsOf<AtmTerminalStatusDbRow>(data, "atm_terminal_status");
    if (!first) return null;
    return mapTerminalStatusRecord(first);
  } catch {
    return null;
  }
}

/** Snapshot history, newest first (for trending the balance). */
export async function listAtmTerminalStatus(limit = 200): Promise<AtmTerminalStatusRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atm_terminal_status")
      .select(TERMINAL_STATUS_COLS)
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return rowsOf<AtmTerminalStatusDbRow>(data, "atm_terminal_status").map(mapTerminalStatusRecord);
  } catch {
    return [];
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

// ===========================================================================
// P6a — Reconciliation inputs
// Assemble the two plain arrays the PURE atm-reconcile-core needs:
//   • settlements: each PAI settlement's two expected legs (from atm_settlements)
//   • deposits: the money-IN transactions on the bank account(s) tagged
//     role="atm" in Bank Feeds (Plaid), converted to positive magnitudes.
// The engine (reconcileSettlements) does ALL the matching; this is just I/O.
// ===========================================================================

export type AtmReconcileInputs = {
  settlements: ReconcileSettlement[];
  deposits: BankDeposit[];
  /** True when at least one bank account is tagged as the ATM-deposits account. */
  hasAtmAccount: boolean;
  /** Display names of the ATM-role account(s), for the UI header. */
  atmAccountNames: string[];
};

/**
 * Gather everything the reconciliation engine needs. Deposits come from EVERY
 * account tagged role="atm" (Michael has one dedicated ATM account, but we
 * support more than one defensively). Returns empty/flagged inputs when the DB
 * isn't configured or no ATM account is tagged, so the page shows guidance
 * instead of crashing.
 */
export async function getAtmReconcileInputs(
  settlementLimit = 400,
): Promise<AtmReconcileInputs> {
  if (!isSupabaseServiceConfigured) {
    return { settlements: [], deposits: [], hasAtmAccount: false, atmAccountNames: [] };
  }

  const settlementRows = await listAtmSettlements(settlementLimit);
  const settlements: ReconcileSettlement[] = settlementRows.map((r) => ({
    settlementId: r.id,
    settlementDate: r.settlementDate,
    terminalId: r.terminalId,
    terminalTransactionCents: r.terminalTransactionCents,
    surchargeCents: r.surchargeCents,
  }));

  const accounts = await listPlaidAccounts();
  const atmAccounts = accounts.filter((a) => a.role === "atm" && a.active);
  const atmAccountNames = atmAccounts.map((a) => a.customName ?? a.officialName ?? a.name ?? "ATM account");

  const deposits: BankDeposit[] = [];
  for (const acct of atmAccounts) {
    const txns = await listPlaidTransactions(acct.accountId);
    const asDeposits = toBankDeposits(
      txns.map((t) => ({
        transactionId: t.transactionId,
        amountCents: t.amountCents,
        date: t.date,
        name: t.name,
        merchantName: t.merchantName,
        pending: t.pending,
      })),
    );
    deposits.push(...asDeposits);
  }

  return {
    settlements,
    deposits,
    hasAtmAccount: atmAccounts.length > 0,
    atmAccountNames,
  };
}

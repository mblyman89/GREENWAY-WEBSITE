/**
 * R41 S3: the ACH file ledger (migration 0273, table ach_files).
 *
 * An ACH file is RELEASED ONCE. Releasing:
 *   1. refuses unless DATA_ENCRYPTION_KEY is set (encryptSecret would pass the
 *      bytes through in the clear without it, and the bytes hold account
 *      numbers; the keyed duplicate hash needs it too),
 *   2. reads today's used File ID Modifiers (Pacific day, voided rows
 *      included) and asks ach-file-ledger-core for the next one,
 *   3. builds the file with that modifier (the caller's builder),
 *   4. turns it into the exact bytes Timberland gets (CRLF), re-reads the
 *      File Header and Batch Header and refuses if they do not say what the
 *      row will say, encrypts, decrypts again and compares,
 *   5. writes ONE ach_files row (payroll: through ach_file_release_payroll,
 *      which also stamps the run in the same transaction). If another file
 *      took the same letter at the same moment, it starts again from 2.
 *
 * A download (readAchFile*) decrypts, re-checks the SHA-256 and returns the
 * stored bytes. It WRITES NOTHING and builds nothing.
 *
 * Who may release or void is decided twice: by achGate (owner at once, an
 * admin's attempt becomes a request) and by the 0273 trigger
 * (ach_actor_is_owner on released_by and voided_by).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret, encryptSecret, isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { keyedHasher } from "@/lib/security/keyed-hash";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  checkFileMatchesRow,
  checkStoredBody,
  checkVoidReason,
  countsTowardLimit,
  entrySetKey,
  ledgerDbErrorMessage,
  MODIFIER_TAKEN_CONSTRAINT,
  nextFileIdModifier,
  sha256Hex,
  toCrlf,
  type AchFileKind,
  type AchFileStatus,
} from "@/lib/payments/ach-file-ledger-core";
import {
  entryAmountsFromFile,
  evaluateTimberlandLimits,
  limitRefusalMessage,
  ledgerWindowStart,
  roomLeft,
  type LedgerFileForLimits,
} from "@/lib/payments/timberland-limits-core";

type Fail = { ok: false; error: string };

export const LEDGER_NO_KEY =
  "ACH files are stored encrypted, and DATA_ENCRYPTION_KEY is not set on this server. No file was released. Set the key (the same one the banking vault uses), then try again.";
const NOT_CONFIGURED = "Database not connected. No file was released.";

/** How many times a release starts again when another file took the same letter at the same moment. */
export const MODIFIER_RETRIES = 3;

/** What a builder returns for one File ID Modifier. */
export type BuiltForLedger = { ok: true; file: string; entryCount: number; totalCents: number } | Fail;

export type AchFileRow = {
  id: string;
  kind: AchFileKind;
  source_id: string;
  file_date: string;
  file_id_modifier: string;
  filename: string;
  effective_date: string;
  entry_count: number;
  total_cents: number;
  sha256: string;
  status: AchFileStatus;
  released_by: string;
  released_at: string;
  voided_by: string | null;
  voided_at: string | null;
  voided_reason: string | null;
};

const ROW_COLS =
  "id, kind, source_id, file_date, file_id_modifier, filename, effective_date, entry_count, total_cents, sha256, status, released_by, released_at, voided_by, voided_at, voided_reason";

export type Sealed = {
  body: string;
  sha256: string;
  entrySetHmac: string;
  bodyEnc: string;
  fileDate: string;
  modifier: string;
  effectiveDate: string;
  entryCount: number;
  totalCents: number;
};

/**
 * The bytes, their fingerprint, the keyed duplicate hash and the encrypted
 * copy, after checking the file says what the row will say. Pure apart from
 * the key in the environment.
 */
export function sealFile(
  file: string,
  expect: { fileDate: string; modifier: string; effectiveDate: string; entryCount: number; totalCents: number },
): { ok: true; sealed: Sealed } | Fail {
  if (!isAtRestEncryptionConfigured()) return { ok: false, error: LEDGER_NO_KEY };
  const hmac = keyedHasher("achFileEntrySet");
  if (!hmac) return { ok: false, error: LEDGER_NO_KEY };
  const body = toCrlf(file);
  const problems = checkFileMatchesRow(body, expect);
  if (problems.length) return { ok: false, error: `The built file does not match what would be recorded: ${problems.join("; ")}. No file was released.` };
  const bodyEnc = encryptSecret(body);
  if (!bodyEnc.startsWith("encv1:") || decryptSecret(bodyEnc) !== body) return { ok: false, error: LEDGER_NO_KEY };
  return {
    ok: true,
    sealed: { body, sha256: sha256Hex(body), entrySetHmac: hmac(entrySetKey(body)), bodyEnc, ...expect },
  };
}

/** Every modifier on a Pacific day's rows, voided ones included. */
async function usedModifiers(fileDate: string): Promise<{ ok: true; used: string[] } | Fail> {
  const { data, error } = await createSupabaseAdminClient().from("ach_files").select("file_id_modifier").eq("file_date", fileDate);
  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };
  return { ok: true, used: ((data ?? []) as { file_id_modifier: string }[]).map((r) => r.file_id_modifier) };
}

/** Most ledger rows one limit check will read; more than this and the check refuses (never a partial total). */
export const LIMITS_READ_CAP = 2000;
export const LIMITS_READ_FAILED =
  "Timberland limit check: the list of files already released could not be read, so this file was NOT released (the limits are never skipped). Try again in a minute.";

/**
 * Every non-voided ach_files row that can count toward a limit for a file
 * released on `fileDate`: anything uploaded, effective or settling on or
 * after ledgerWindowStart(fileDate). Fails closed.
 */
export async function readLedgerForLimits(fileDate: string): Promise<{ ok: true; ledger: LedgerFileForLimits[] } | Fail> {
  const start = ledgerWindowStart(fileDate);
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_files")
    .select("id, kind, status, file_date, effective_date, settlement_date, total_cents")
    .neq("status", "voided")
    .or(`file_date.gte.${start},effective_date.gte.${start},settlement_date.gte.${start}`)
    .limit(LIMITS_READ_CAP + 1);
  if (error || !Array.isArray(data)) return { ok: false, error: LIMITS_READ_FAILED };
  if (data.length > LIMITS_READ_CAP) return { ok: false, error: LIMITS_READ_FAILED };
  const ledger: LedgerFileForLimits[] = [];
  for (const r of data as Record<string, unknown>[]) {
    const cents = Number(r.total_cents);
    if (!Number.isSafeInteger(cents) || cents < 0 || typeof r.file_date !== "string" || typeof r.effective_date !== "string") {
      return { ok: false, error: LIMITS_READ_FAILED };
    }
    ledger.push({
      id: String(r.id),
      kind: r.kind as LedgerFileForLimits["kind"],
      status: r.status as LedgerFileForLimits["status"],
      fileDate: r.file_date,
      effectiveDate: r.effective_date,
      settlementDate: typeof r.settlement_date === "string" ? r.settlement_date : null,
      totalCents: cents,
    });
  }
  return { ok: true, ledger };
}

/** The "Timberland room left" bar: today's in-process total and this month's, from the same read the release check uses. */
export async function loadTimberlandRoomLeft(today: string): Promise<{ ok: true; room: ReturnType<typeof roomLeft> } | Fail> {
  const r = await readLedgerForLimits(today);
  if (!r.ok) return { ok: false, error: "Timberland room left could not be read (never shown as all clear). Releases are still checked and refused if over a limit." };
  return { ok: true, room: roomLeft(r.ledger, today) };
}

type ReleaseInput = {
  kind: AchFileKind;
  actorId: string;
  now: Date;
  /** The effective date the builder was asked for (YYYY-MM-DD). */
  effectiveDate: string;
  filename: string;
  /** Build the file with exactly this File ID Modifier and createdAt = now. */
  build: (modifier: string) => BuiltForLedger;
};

/**
 * The shared loop: next letter, read the ledger, build, check Timberland's
 * limits (R41 S4, a hard block), seal, write. `write` returns the new row id,
 * or the database error message.
 *
 * Why the limit check is race-safe without a lock: the ledger is read AFTER
 * the day's used letters, in the same attempt. Two releases on the same
 * Pacific day either (a) see each other's row, or (b) read the same used
 * letters, pick the same letter, and the loser hits
 * ach_files_day_modifier_key, starts again, and re-reads the ledger with the
 * winner's row in it.
 */
async function releaseLoop(
  input: ReleaseInput,
  write: (s: Sealed) => Promise<{ ok: true; id: string } | { ok: false; message: string }>,
): Promise<{ ok: true; id: string; sealed: Sealed; limitWarnings: string[] } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (!isAtRestEncryptionConfigured()) return { ok: false, error: LEDGER_NO_KEY };
  const fileDate = pacificDayKey(input.now);
  for (let attempt = 0; attempt < MODIFIER_RETRIES; attempt++) {
    const used = await usedModifiers(fileDate);
    if (!used.ok) return used;
    const next = nextFileIdModifier(used.used);
    if (!next.ok) return next;
    const ledger = await readLedgerForLimits(fileDate);
    if (!ledger.ok) return ledger;
    const built = input.build(next.modifier);
    if (!built.ok) return built;
    const limits = evaluateTimberlandLimits(
      { kind: input.kind, fileDate, effectiveDate: input.effectiveDate, totalCents: built.totalCents, entryAmountsCents: entryAmountsFromFile(built.file) },
      ledger.ledger,
    );
    if (!limits.ok) return { ok: false, error: limitRefusalMessage(limits) };
    const sealed = sealFile(built.file, {
      fileDate,
      modifier: next.modifier,
      effectiveDate: input.effectiveDate,
      entryCount: built.entryCount,
      totalCents: built.totalCents,
    });
    if (!sealed.ok) return sealed;
    const w = await write(sealed.sealed);
    if (w.ok) return { ok: true, id: w.id, sealed: sealed.sealed, limitWarnings: limits.warnings.map((x) => x.message) };
    if (!w.message.includes(MODIFIER_TAKEN_CONSTRAINT)) return { ok: false, error: ledgerDbErrorMessage(w.message) };
  }
  return { ok: false, error: ledgerDbErrorMessage(MODIFIER_TAKEN_CONSTRAINT) };
}

/** What a release hands back: the exact stored bytes and the facts read from them. */
export type Released = {
  ok: true;
  id: string;
  body: string;
  filename: string;
  modifier: string;
  fileDate: string;
  entryCount: number;
  totalCents: number;
  /** Gold 80% notes from the Timberland limit check (the file was released). */
  limitWarnings: string[];
};

function released(id: string, s: Sealed, filename: string, limitWarnings: string[]): Released {
  return { ok: true, id, body: s.body, filename, modifier: s.modifier, fileDate: s.fileDate, entryCount: s.entryCount, totalCents: s.totalCents, limitWarnings };
}

/** Vendor, prenote and test-credit files: one ach_files row. */
export async function releaseAchFile(input: ReleaseInput & { sourceId: string }): Promise<Released | Fail> {
  if (input.kind === "payroll") return { ok: false, error: "Payroll files are released with releasePayrollAchFile." };
  const r = await releaseLoop(input, async (s) => {
    const { data, error } = await createSupabaseAdminClient()
      .from("ach_files")
      .insert({
        kind: input.kind,
        source_id: input.sourceId,
        file_date: s.fileDate,
        file_id_modifier: s.modifier,
        filename: input.filename,
        effective_date: s.effectiveDate,
        entry_count: s.entryCount,
        total_cents: s.totalCents,
        counts_toward_limit: countsTowardLimit(input.kind),
        sha256: s.sha256,
        entry_set_hmac: s.entrySetHmac,
        body_enc: s.bodyEnc,
        released_by: input.actorId,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: error.message ?? "" };
    return { ok: true, id: String((data as { id: string }).id) };
  });
  if (!r.ok) return r;
  return released(r.id, r.sealed, input.filename, r.limitWarnings);
}

/** Payroll: the ledger row and the run stamp in ONE database call (0273). */
export async function releasePayrollAchFile(
  input: Omit<ReleaseInput, "kind"> & { runId: string; overrideWarnings: boolean; overrideReason: string | null },
): Promise<Released | Fail> {
  const r = await releaseLoop({ ...input, kind: "payroll" }, async (s) => {
    const { data, error } = await createSupabaseAdminClient().rpc("ach_file_release_payroll", {
      p_run_id: input.runId,
      p_actor: input.actorId,
      p_file_date: s.fileDate,
      p_modifier: s.modifier,
      p_filename: input.filename,
      p_effective: s.effectiveDate,
      p_entry_count: s.entryCount,
      p_total_cents: s.totalCents,
      p_sha256: s.sha256,
      p_entry_set_hmac: s.entrySetHmac,
      p_body_enc: s.bodyEnc,
      p_override: input.overrideWarnings,
      p_override_reason: input.overrideWarnings ? input.overrideReason : null,
    });
    if (error) return { ok: false, message: error.message ?? "" };
    if (typeof data !== "string" || !/^[0-9a-f-]{36}$/.test(data)) return { ok: false, message: "ACH_FILE_NOT_FOUND: the database did not return the new file id." };
    return { ok: true, id: data };
  });
  if (!r.ok) return r;
  return released(r.id, r.sealed, input.filename, r.limitWarnings);
}

// ------------------------------------------------------------- reading -----

async function bytesOf(row: AchFileRow & { body_enc: string }): Promise<{ ok: true; body: string; row: AchFileRow } | Fail> {
  const body = decryptSecret(row.body_enc);
  const c = checkStoredBody(body, row.sha256);
  if (!c.ok) return c;
  // The fields the trigger keeps fixed are re-checked against the bytes too.
  const problems = checkFileMatchesRow(body, {
    fileDate: row.file_date,
    modifier: row.file_id_modifier,
    effectiveDate: row.effective_date,
    entryCount: row.entry_count,
    totalCents: Number(row.total_cents),
  });
  if (problems.length) return { ok: false, error: `The stored ACH file does not match its record: ${problems.join("; ")}. It was not served.` };
  const { body_enc: _drop, ...plain } = row;
  void _drop;
  return { ok: true, body, row: plain };
}

/**
 * The stored bytes of one file, for a download. Writes nothing. A voided file
 * is refused: it must never be uploaded.
 */
export async function readAchFileForDownload(id: string): Promise<{ ok: true; body: string; row: AchFileRow } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: ledgerDbErrorMessage("ACH_FILE_NOT_FOUND") };
  const { data, error } = await createSupabaseAdminClient().from("ach_files").select(`${ROW_COLS}, body_enc`).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };
  if (!data) return { ok: false, error: ledgerDbErrorMessage("ACH_FILE_NOT_FOUND") };
  const row = data as AchFileRow & { body_enc: string };
  if (row.status === "voided") return { ok: false, error: `This file was voided (${row.voided_reason ?? "no reason"}). Never upload it. Release a new one.` };
  return bytesOf(row);
}

/** The live (not voided) file for one source: a payroll run, a vendor batch, a check list. */
export async function readLiveFileForSource(kind: AchFileKind, sourceId: string): Promise<{ ok: true; body: string; row: AchFileRow } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_files")
    .select(`${ROW_COLS}, body_enc`)
    .eq("kind", kind)
    .eq("source_id", sourceId)
    .neq("status", "voided")
    .maybeSingle();
  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };
  if (!data) return { ok: false, error: "No released ACH file for this yet. Release it first (owner)." };
  return bytesOf(data as AchFileRow & { body_enc: string });
}

/** The live row for one source, without the bytes (for pages). null when none. */
export async function findLiveFile(kind: AchFileKind, sourceId: string): Promise<AchFileRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_files")
    .select(ROW_COLS)
    .eq("kind", kind)
    .eq("source_id", sourceId)
    .neq("status", "voided")
    .maybeSingle();
  if (error || !data) return null;
  return data as AchFileRow;
}

/** The newest files first, without the bytes. tableReady false before 0273. */
export async function listAchFiles(limit = 50): Promise<{ tableReady: boolean; rows: AchFileRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { tableReady: false, rows: [], error: null };
  const { data, error } = await createSupabaseAdminClient()
    .from("ach_files")
    .select(ROW_COLS)
    .order("released_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) {
    const missing = /ach_files/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? "");
    return { tableReady: !missing, rows: [], error: missing ? null : ledgerDbErrorMessage(error.message) };
  }
  return { tableReady: true, rows: (data ?? []) as AchFileRow[], error: null };
}

// ---------------------------------------------------------------- void -----

/** Void a file (owner, with a reason). The row and its bytes stay. A payroll run goes back to draft. */
export async function voidAchFile(input: { fileId: string; actorId: string; reason: string | null | undefined }): Promise<{ ok: true; kind: AchFileKind; reason: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const c = checkVoidReason(input.reason);
  if (!c.ok) return c;
  if (!/^[0-9a-f-]{36}$/i.test(input.fileId)) return { ok: false, error: ledgerDbErrorMessage("ACH_FILE_NOT_FOUND") };
  const { data, error } = await createSupabaseAdminClient().rpc("ach_file_void", { p_file_id: input.fileId, p_actor: input.actorId, p_reason: c.reason });
  if (error) return { ok: false, error: ledgerDbErrorMessage(error.message) };
  const kind = String(data ?? "") as AchFileKind;
  if (!["payroll", "vendor", "prenote", "micro_entry"].includes(kind)) return { ok: false, error: "The database did not confirm the void. Reload the page." };
  return { ok: true, kind, reason: c.reason };
}

import "server-only";

/**
 * src/lib/crypto/crypto-transfer-store.ts — R1-F2 confirmed-transfer layer
 * (server-only).
 *
 * Read/write accessors over the crypto_transfer_matches table (migration 0164).
 *
 * The PURE shape + logic (record type, row shape, mapper, the validated
 * upsert-row builder, and the relocation bridge) live in
 * ./crypto-transfer-store-core so the pure self-test battery (which runs under
 * tsx, where `server-only` throws) exercises them. This module adds only the
 * async Supabase calls and re-exports the public types.
 *
 * Graceful, mirroring crypto-classification-store.ts:
 *   - isSupabaseServiceConfigured guard -> "not configured" (reads return [] /
 *     null, writes no-op success) so pages render BEFORE the DB is wired;
 *   - try/catch around every query; a MISSING table (pre-0164) is treated like
 *     "not configured", never a crash;
 *   - writes never delete; re-confirming an OUT leg UPSERTS the single row.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  toTransferMatchRecord,
  buildTransferMatchUpsertRow,
  type TransferMatchRow,
  type BuildTransferMatchInput,
  type CryptoTransferMatchRecord,
} from "./crypto-transfer-store-core";

export type {
  CryptoTransferMatchRecord,
  TransferMatchStatus,
  TransferMatchSource,
} from "./crypto-transfer-store-core";

export type WriteResult = { ok: true; count: number } | { ok: false; error: string };

const TRANSFER_COLS =
  "id, out_tx_id, in_tx_id, source_wallet_id, dest_wallet_id, asset_id, moved_amount, gas_amount, status, confidence, source, note, confirmed_by, confirmed_at";

const READ_LIMIT = 5000;

function cleanId(v: string | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** All confirmed/rejected transfer matches (optionally filtered by wallet). */
export async function listCryptoTransferMatches(
  walletId?: string,
): Promise<CryptoTransferMatchRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    let q = admin.from("crypto_transfer_matches").select(TRANSFER_COLS).limit(READ_LIMIT);
    const wid = cleanId(walletId);
    if (wid !== "") {
      q = q.or(`source_wallet_id.eq.${wid},dest_wallet_id.eq.${wid}`);
    }
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as TransferMatchRow[]).map(toTransferMatchRecord);
  } catch {
    return [];
  }
}

/** The confirmed/rejected match for a single OUT leg, or null. */
export async function getCryptoTransferMatchByOut(
  outTxId: string,
): Promise<CryptoTransferMatchRecord | null> {
  if (!isSupabaseServiceConfigured) return null;
  const oid = cleanId(outTxId);
  if (oid === "") return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_transfer_matches")
      .select(TRANSFER_COLS)
      .eq("out_tx_id", oid)
      .maybeSingle();
    if (error || !data) return null;
    return toTransferMatchRecord(data as TransferMatchRow);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write (upsert one decision per OUT leg).
// ---------------------------------------------------------------------------

/**
 * Confirm (or reject) an own-wallet transfer. Validates the input via the pure
 * builder, then upserts on out_tx_id (re-confirming replaces the prior decision
 * for that OUT leg — never deletes). Returns a plain result the action layer can
 * surface in plain English.
 */
export async function upsertCryptoTransferMatch(
  input: BuildTransferMatchInput,
): Promise<WriteResult> {
  const built = buildTransferMatchUpsertRow(input);
  if (!built.ok) return { ok: false, error: built.error };

  if (!isSupabaseServiceConfigured) {
    // Pre-config: behave like a successful no-op so the UI flow still works.
    return { ok: true, count: 0 };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("crypto_transfer_matches")
      .upsert(built.row, { onConflict: "out_tx_id" });
    if (error) {
      // Missing table (pre-0164) or any DB error -> treated as not-yet-wired.
      return { ok: false, error: "Couldn't save the transfer yet. Is the crypto-transfers migration applied?" };
    }
    return { ok: true, count: 1 };
  } catch {
    return { ok: false, error: "Couldn't save the transfer (unexpected error)." };
  }
}

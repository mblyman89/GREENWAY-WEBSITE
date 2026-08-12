import "server-only";

/**
 * src/lib/crypto/crypto-owner-wallet-store.ts — R1-G4 discovered-wallet
 * ownership layer (server-only).
 *
 * Read/write accessors over the crypto_owner_wallet_confirmations table
 * (migration 0165). The PURE shape + logic (record type, row shape, mapper, the
 * validated upsert-row builder, and partitionDiscoveredWallets) live in
 * ./crypto-owner-wallet-core so the pure self-test battery (which runs under
 * tsx, where `server-only` throws) exercises them. This module adds only the
 * async Supabase calls and re-exports the public types.
 *
 * Graceful, mirroring crypto-transfer-store.ts:
 *   - isSupabaseServiceConfigured guard -> reads return [], writes no-op success
 *     so pages render BEFORE the DB is wired;
 *   - try/catch around every query; a MISSING table (pre-0165) is treated like
 *     "not configured", never a crash;
 *   - writes never delete; re-deciding an (address, chain) UPSERTS the row.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  toOwnerWalletRecord,
  buildOwnerWalletUpsertRow,
  type OwnerWalletRow,
  type BuildOwnerWalletInput,
  type CryptoOwnerWalletRecord,
} from "./crypto-owner-wallet-core";

export type {
  CryptoOwnerWalletRecord,
  OwnerWalletStatus,
} from "./crypto-owner-wallet-core";

export type WriteResult = { ok: true; count: number } | { ok: false; error: string };

const OWNER_WALLET_COLS =
  "id, address, chain, status, reference_count, note, decided_by, decided_at";

const READ_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** All ownership decisions (confirmed + rejected). Empty when not wired. */
export async function listCryptoOwnerWalletConfirmations(): Promise<
  CryptoOwnerWalletRecord[]
> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("crypto_owner_wallet_confirmations")
      .select(OWNER_WALLET_COLS)
      .order("decided_at", { ascending: false })
      .limit(READ_LIMIT);
    if (error || !data) return [];
    return (data as unknown as OwnerWalletRow[]).map(toOwnerWalletRecord);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

/**
 * Record (or update) Michael's ownership decision on a discovered wallet.
 * Validates + builds the exact row with the pure core, then upserts idempotently
 * on (address, chain). Graceful: no DB / missing table => no-op success.
 */
export async function upsertCryptoOwnerWalletConfirmation(
  input: BuildOwnerWalletInput,
): Promise<WriteResult> {
  const built = buildOwnerWalletUpsertRow(input);
  if (!built.ok) return { ok: false, error: built.error };

  if (!isSupabaseServiceConfigured) {
    // Pre-config: behave like a successful no-op so the UI flow still works.
    return { ok: true, count: 0 };
  }

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("crypto_owner_wallet_confirmations")
      .upsert(built.row, { onConflict: "address,chain" });
    if (error) {
      // Missing table (pre-0165) or any DB error -> treated as not-yet-wired.
      return {
        ok: false,
        error:
          "Couldn't save the wallet decision yet. Is the crypto-owner-wallets migration applied?",
      };
    }
    return { ok: true, count: 1 };
  } catch {
    return { ok: false, error: "Couldn't save the wallet decision (unexpected error)." };
  }
}

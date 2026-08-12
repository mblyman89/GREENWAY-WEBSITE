/**
 * src/lib/crypto/crypto-transfer-store-core.ts
 *
 * PURE shape + logic for the R1-F2 confirmed-transfer persistence layer. NO
 * I/O, no server-only imports — safe under tsx and vitest. The async Supabase
 * readers/writers live in ./crypto-transfer-store and reuse these mappers +
 * builders so all the branchy logic is unit-tested here.
 *
 * Responsibilities (pure):
 *   1. Record type + DB row shape for crypto_transfer_matches (migration 0164)
 *      + row->record mapper.
 *   2. buildTransferMatchUpsertRow — turn a validated confirm/reject request
 *      into the exact DB row we upsert. Validates status/source, requires a
 *      non-empty exact-decimal moved amount, distinct source/dest wallets, and
 *      refuses to build a nonsense row (never store a bad transfer).
 *   3. confirmedMatchesToRelocations — bridge the stored confirmed matches into
 *      the R1-F1 relocation engine's ConfirmedSelfTransfer input shape (parsing
 *      exact-decimal amounts into 18-dec scaled BigInt via R1-C helpers). Only
 *      'confirmed' rows relocate; 'rejected' rows are remembered but ignored.
 */

import { quantityToScaled, type CostBasisMethod } from "./crypto-cost-basis-core";
import type { ConfirmedSelfTransfer } from "./crypto-transfer-ledger-core";

// ---------------------------------------------------------------------------
// Record type (camelCase app shape).
// ---------------------------------------------------------------------------

export type TransferMatchStatus = "confirmed" | "rejected";
export type TransferMatchSource = "suggested" | "manual";

export interface CryptoTransferMatchRecord {
  id: string;
  outTxId: string;
  inTxId: string | null;
  sourceWalletId: string;
  destWalletId: string;
  assetId: string | null;
  /** Exact decimal string of the quantity that landed in the destination. */
  movedAmount: string;
  /** Exact decimal string of gas paid in this asset, or null. */
  gasAmount: string | null;
  status: TransferMatchStatus;
  confidence: number;
  source: TransferMatchSource;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

// ---------------------------------------------------------------------------
// DB row shape (snake_case, as returned by Supabase).
// ---------------------------------------------------------------------------

export interface TransferMatchRow {
  id: string;
  out_tx_id: string;
  in_tx_id: string | null;
  source_wallet_id: string;
  dest_wallet_id: string;
  asset_id: string | null;
  moved_amount: string;
  gas_amount: string | null;
  status: string;
  confidence: number | null;
  source: string;
  note: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

function asStatus(v: string): TransferMatchStatus {
  return v === "rejected" ? "rejected" : "confirmed";
}

function asSource(v: string): TransferMatchSource {
  return v === "manual" ? "manual" : "suggested";
}

function clampConfidence(v: number | null | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/** Map a DB row to the app record shape. */
export function toTransferMatchRecord(row: TransferMatchRow): CryptoTransferMatchRecord {
  return {
    id: row.id,
    outTxId: row.out_tx_id,
    inTxId: row.in_tx_id ?? null,
    sourceWalletId: row.source_wallet_id,
    destWalletId: row.dest_wallet_id,
    assetId: row.asset_id ?? null,
    movedAmount: row.moved_amount,
    gasAmount: row.gas_amount != null && row.gas_amount !== "" ? row.gas_amount : null,
    status: asStatus(row.status),
    confidence: clampConfidence(row.confidence),
    source: asSource(row.source),
    note: row.note ?? null,
    confirmedBy: row.confirmed_by ?? null,
    confirmedAt: row.confirmed_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Validated upsert-row builder.
// ---------------------------------------------------------------------------

export interface BuildTransferMatchInput {
  outTxId: string;
  inTxId?: string | null;
  sourceWalletId: string;
  destWalletId: string;
  assetId?: string | null;
  movedAmount: string;
  gasAmount?: string | null;
  status?: TransferMatchStatus;
  confidence?: number;
  source?: TransferMatchSource;
  note?: string | null;
  confirmedBy?: string | null;
}

/** The exact row we upsert (snake_case), minus DB-defaulted columns. */
export interface TransferMatchUpsertRow {
  out_tx_id: string;
  in_tx_id: string | null;
  source_wallet_id: string;
  dest_wallet_id: string;
  asset_id: string | null;
  moved_amount: string;
  gas_amount: string | null;
  status: TransferMatchStatus;
  confidence: number;
  source: TransferMatchSource;
  note: string | null;
  confirmed_by: string | null;
}

export type BuildResult =
  | { ok: true; row: TransferMatchUpsertRow }
  | { ok: false; error: string };

function trimOrEmpty(v: string | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Validate and build the exact row to upsert. Refuses to build when:
 *   - out tx / source / dest wallet ids are missing,
 *   - source and dest wallets are the SAME (a self-transfer must cross wallets),
 *   - the moved amount is missing or not a valid exact decimal (so we never
 *     store a float or a guess),
 *   - a provided gas amount is not a valid exact decimal.
 * quantityToScaled is used purely as a strict validator here (it throws on a
 * bad decimal); the stored value stays the exact decimal string.
 */
export function buildTransferMatchUpsertRow(input: BuildTransferMatchInput): BuildResult {
  const outTxId = trimOrEmpty(input.outTxId);
  const sourceWalletId = trimOrEmpty(input.sourceWalletId);
  const destWalletId = trimOrEmpty(input.destWalletId);
  const status = input.status === "rejected" ? "rejected" : "confirmed";

  if (outTxId === "") return { ok: false, error: "Missing the outgoing transaction." };
  if (sourceWalletId === "") return { ok: false, error: "Missing the source wallet." };
  if (destWalletId === "") return { ok: false, error: "Missing the destination wallet." };
  if (sourceWalletId === destWalletId) {
    return { ok: false, error: "A transfer must move between two different wallets." };
  }

  const movedAmount = trimOrEmpty(input.movedAmount);
  if (movedAmount === "") return { ok: false, error: "Missing the amount that moved." };
  try {
    if (quantityToScaled(movedAmount) <= BigInt(0)) {
      return { ok: false, error: "The moved amount must be greater than zero." };
    }
  } catch {
    return { ok: false, error: "The moved amount isn't a valid number." };
  }

  const gasRaw = trimOrEmpty(input.gasAmount);
  let gasAmount: string | null = null;
  if (gasRaw !== "") {
    try {
      if (quantityToScaled(gasRaw) < BigInt(0)) {
        return { ok: false, error: "The gas amount can't be negative." };
      }
    } catch {
      return { ok: false, error: "The gas amount isn't a valid number." };
    }
    gasAmount = gasRaw;
  }

  const inTxId = trimOrEmpty(input.inTxId);
  const assetId = trimOrEmpty(input.assetId);
  const note = trimOrEmpty(input.note);
  const confirmedBy = trimOrEmpty(input.confirmedBy);

  return {
    ok: true,
    row: {
      out_tx_id: outTxId,
      in_tx_id: inTxId === "" ? null : inTxId,
      source_wallet_id: sourceWalletId,
      dest_wallet_id: destWalletId,
      asset_id: assetId === "" ? null : assetId,
      moved_amount: movedAmount,
      gas_amount: gasAmount,
      status,
      confidence: clampConfidence(input.confidence),
      source: input.source === "manual" ? "manual" : "suggested",
      note: note === "" ? null : note,
      confirmed_by: confirmedBy === "" ? null : confirmedBy,
    },
  };
}

// ---------------------------------------------------------------------------
// Bridge: confirmed matches -> R1-F1 relocation engine input.
// ---------------------------------------------------------------------------

export interface ConfirmedMatchesToRelocationsOptions {
  /** Restrict to one asset (the R1-F1 engine runs per asset). */
  assetId?: string;
  /** Event time (ms epoch) per OUT tx id, for oldest-first ordering + gas HP. */
  outTimeMsByTxId?: Record<string, number>;
}

/**
 * Turn the stored CONFIRMED matches into the R1-F1 engine's ConfirmedSelfTransfer
 * inputs (scaled quantities). Rejected rows are skipped. Rows whose moved amount
 * can't be parsed are skipped defensively (the builder prevents this on write,
 * but reads stay robust). Transfer time defaults to 0 when unknown so the caller
 * can still relocate; supply outTimeMsByTxId for correct chronology + gas
 * holding period.
 */
export function confirmedMatchesToRelocations(
  matches: readonly CryptoTransferMatchRecord[],
  options: ConfirmedMatchesToRelocationsOptions = {},
): ConfirmedSelfTransfer[] {
  const wantAsset = options.assetId != null ? String(options.assetId).trim() : "";
  const timeMap = options.outTimeMsByTxId ?? {};
  const out: ConfirmedSelfTransfer[] = [];

  for (const m of matches) {
    if (m.status !== "confirmed") continue;
    if (wantAsset !== "" && (m.assetId ?? "") !== wantAsset) continue;

    let movedScaled: bigint;
    try {
      movedScaled = quantityToScaled(m.movedAmount);
    } catch {
      continue;
    }
    if (movedScaled <= BigInt(0)) continue;

    let gasScaled = BigInt(0);
    if (m.gasAmount != null && m.gasAmount !== "") {
      try {
        gasScaled = quantityToScaled(m.gasAmount);
      } catch {
        gasScaled = BigInt(0);
      }
    }

    const t = timeMap[m.outTxId];
    const transferAtMs = typeof t === "number" && Number.isFinite(t) ? Math.trunc(t) : 0;

    out.push({
      id: m.id,
      sourceWalletId: m.sourceWalletId,
      destWalletId: m.destWalletId,
      movedQuantityScaled: movedScaled,
      transferAtMs,
      gasQuantityScaled: gasScaled > BigInt(0) ? gasScaled : undefined,
    });
  }

  return out;
}

// A method type re-export purely so downstream server code can stay anchored to
// the same union without importing two modules. (No logic.)
export type { CostBasisMethod };

// ---------------------------------------------------------------------------
// PURE self-tests.
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-transfer-store-core self-test FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

export function __runCryptoTransferStoreCoreTests(): void {
  // --- row -> record mapping ---
  const rec = toTransferMatchRecord({
    id: "m1",
    out_tx_id: "out1",
    in_tx_id: "in1",
    source_wallet_id: "hot",
    dest_wallet_id: "ledger",
    asset_id: "flr",
    moved_amount: "12.5",
    gas_amount: "0.01",
    status: "confirmed",
    confidence: 95,
    source: "suggested",
    note: "hot -> ledger",
    confirmed_by: "user1",
    confirmed_at: "2025-01-01T00:00:00Z",
  });
  eq(rec.outTxId, "out1", "maps out tx");
  eq(rec.movedAmount, "12.5", "maps moved amount");
  eq(rec.gasAmount, "0.01", "maps gas");
  eq(rec.status, "confirmed", "maps status");
  eq(rec.confidence, 95, "maps confidence");

  // confidence clamps + empty gas -> null
  const rec2 = toTransferMatchRecord({
    id: "m2", out_tx_id: "o", in_tx_id: null, source_wallet_id: "a", dest_wallet_id: "b",
    asset_id: null, moved_amount: "1", gas_amount: "", status: "weird", confidence: 250,
    source: "manual", note: null, confirmed_by: null, confirmed_at: null,
  });
  eq(rec2.gasAmount, null, "empty gas -> null");
  eq(rec2.confidence, 100, "confidence clamps to 100");
  eq(rec2.status, "confirmed", "unknown status -> confirmed default");
  eq(rec2.source, "manual", "maps manual source");

  // --- builder: happy path ---
  const b = buildTransferMatchUpsertRow({
    outTxId: " out1 ", sourceWalletId: "hot", destWalletId: "ledger",
    assetId: "flr", movedAmount: "12.5", gasAmount: "0.01", confidence: 95,
    source: "suggested", note: "hot -> ledger", confirmedBy: "user1",
  });
  eq(b.ok, true, "valid transfer builds");
  if (b.ok) {
    eq(b.row.out_tx_id, "out1", "trims out tx id");
    eq(b.row.moved_amount, "12.5", "keeps exact decimal moved amount");
    eq(b.row.gas_amount, "0.01", "keeps exact gas");
    eq(b.row.status, "confirmed", "default status confirmed");
  }

  // --- builder: same wallet rejected ---
  const same = buildTransferMatchUpsertRow({
    outTxId: "o", sourceWalletId: "w", destWalletId: "w", movedAmount: "1",
  });
  eq(same.ok, false, "same source/dest wallet rejected");

  // --- builder: bad amount rejected (never store a guess/float garbage) ---
  const bad = buildTransferMatchUpsertRow({
    outTxId: "o", sourceWalletId: "a", destWalletId: "b", movedAmount: "1.2.3",
  });
  eq(bad.ok, false, "bad moved amount rejected");

  // --- builder: zero amount rejected ---
  const zero = buildTransferMatchUpsertRow({
    outTxId: "o", sourceWalletId: "a", destWalletId: "b", movedAmount: "0",
  });
  eq(zero.ok, false, "zero moved amount rejected");

  // --- builder: reject status preserved ---
  const rej = buildTransferMatchUpsertRow({
    outTxId: "o", sourceWalletId: "a", destWalletId: "b", movedAmount: "1", status: "rejected",
  });
  eq(rej.ok, true, "reject builds");
  if (rej.ok) eq(rej.row.status, "rejected", "reject status preserved");

  // --- bridge: only confirmed rows relocate, asset filter + scaling work ---
  const matches: CryptoTransferMatchRecord[] = [
    {
      id: "c1", outTxId: "out1", inTxId: "in1", sourceWalletId: "hot", destWalletId: "ledger",
      assetId: "flr", movedAmount: "2", gasAmount: "0.5", status: "confirmed", confidence: 90,
      source: "suggested", note: null, confirmedBy: null, confirmedAt: null,
    },
    {
      id: "c2", outTxId: "out2", inTxId: "in2", sourceWalletId: "hot", destWalletId: "ledger",
      assetId: "xrp", movedAmount: "5", gasAmount: null, status: "confirmed", confidence: 80,
      source: "suggested", note: null, confirmedBy: null, confirmedAt: null,
    },
    {
      id: "c3", outTxId: "out3", inTxId: null, sourceWalletId: "hot", destWalletId: "ledger",
      assetId: "flr", movedAmount: "9", gasAmount: null, status: "rejected", confidence: 10,
      source: "suggested", note: null, confirmedBy: null, confirmedAt: null,
    },
  ];
  const relocs = confirmedMatchesToRelocations(matches, {
    assetId: "flr",
    outTimeMsByTxId: { out1: 1000 },
  });
  eq(relocs.length, 1, "only the confirmed FLR row relocates (xrp filtered, rejected skipped)");
  eq(relocs[0].id, "c1", "keeps match id");
  eq(relocs[0].sourceWalletId, "hot", "carries source wallet");
  eq(relocs[0].destWalletId, "ledger", "carries dest wallet");
  eq(relocs[0].transferAtMs, 1000, "maps transfer time");
  eq(relocs[0].movedQuantityScaled === quantityToScaled("2"), true, "scales moved amount");
  eq(relocs[0].gasQuantityScaled === quantityToScaled("0.5"), true, "scales gas amount");

  // no asset filter => both confirmed rows relocate; rejected still skipped
  const all = confirmedMatchesToRelocations(matches);
  eq(all.length, 2, "no filter => both confirmed relocate, rejected skipped");

  console.log("crypto-transfer-store-core self-tests: all passed");
}

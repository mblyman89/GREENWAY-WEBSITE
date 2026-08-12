"use server";

/**
 * /admin/crypto server actions — Crypto Portfolio.
 *
 * Gate: requirePermission("settings.manage") (owner + admin only — same as
 * Banking / Bank Feeds / ATM / Payroll). Mirrors src/app/admin/plaid/actions.ts:
 * gate → validate in the pure core → write via the server-only store → audit
 * with NO secret (public address only) → revalidate + redirect with a friendly
 * message.
 *
 * WATCH-ONLY: the only thing this stores is a PUBLIC on-chain address. There are
 * no keys, no secrets, and nothing here can move funds. The address is validated
 * for its chain's shape BEFORE it touches the database (defense in depth: the
 * store re-validates too).
 *
 * Slice C6c adds `runCryptoSyncNowAction` — the "Sync now" trigger that calls
 * runAllCryptoSync() (the top-level orchestrator) to pull balances + history
 * for every connected wallet. Mirrors Plaid's runPlaidSyncNowAction exactly.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseAddWallet } from "@/lib/crypto/crypto-ui-core";
import { addWatchOnlyWallet, setCryptoAssetHidden } from "@/lib/crypto/crypto-store";
import { runAllCryptoSync } from "@/lib/crypto/crypto-sync-orchestrator";
import {
  TX_PRIMITIVES,
  isKnownTag,
  isTagValidOnPrimitive,
  getTagDefinition,
  type TxPrimitive,
} from "@/lib/crypto/crypto-classification-core";
import { upsertCryptoClassification } from "@/lib/crypto/crypto-classification-store";

const ROOT = "/admin/crypto";

function back(qs: { tab?: string; msg?: string; error?: string }): never {
  const p = new URLSearchParams({ tab: qs.tab ?? "wallets" });
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  redirect(`${ROOT}?${p.toString()}`);
}

/**
 * Add (or re-label) a watch-only wallet. Validates + normalizes the submission
 * with the pure core, then upserts idempotently via the store. Reports "added"
 * vs. "already watching (label updated)" so re-adding the same address is safe.
 *
 * After adding, the message guides Michael to the Health tab's "Sync now" button
 * to pull the wallet's balances + history. (We don't auto-run the full backfill
 * here because it can take a while for wallets with long histories — the "Sync
 * now" button gives Michael control and a clear progress message, exactly like
 * Plaid's "Connected! Accounts will appear on the next sync.")
 */
export async function addCryptoWalletAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const parsed = parseAddWallet({
    chain: String(formData.get("chain") ?? ""),
    address: String(formData.get("address") ?? ""),
    label: String(formData.get("label") ?? ""),
  });
  if (!parsed.ok) back({ tab: "wallets", error: parsed.error });

  const result = await addWatchOnlyWallet({
    chain: parsed.chain,
    address: parsed.address,
    label: parsed.label,
  });
  if (!result.ok) back({ tab: "wallets", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "crypto.wallet.connected",
    entityType: "crypto_wallet",
    entityId: `${parsed.chain}:${parsed.address}`,
    after: {
      chain: parsed.chain,
      address: parsed.address, // public address — safe to record
      label: parsed.label,
      created: result.created,
    },
  });

  back({
    tab: "wallets",
    msg: result.created
      ? "Wallet added — now watching this address. Use \u201cSync now\u201d on the Health tab to pull its balances and history."
      : "Already watching this address — label updated. Use \u201cSync now\u201d on the Health tab to refresh.",
  });
}

/**
 * "Sync now" — manually pull balances + transaction history for every connected
 * crypto wallet (Slice C6c). Delegates to the server-only orchestrator
 * runAllCryptoSync(), which dispatches each wallet to its per-chain driver
 * (XRPL → syncXrplWallet, EVM → syncEvmWallet, Cosmos → friendly skip) and
 * NEVER throws: it returns a plain-English summary or a friendly problem message
 * per wallet. We surface that summary on the Health tab and record an audit entry.
 *
 * The drivers already persist each wallet's resume point (cursor) and any error
 * status in the store, so a partial failure still saves whatever synced and the
 * next "Sync now" resumes from where it left off.
 */
export async function runCryptoSyncNowAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const result = await runAllCryptoSync();

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "crypto.sync.manual",
    entityType: "crypto_sync",
    entityId: "manual",
    after: {
      ok: result.ok,
      wallets_synced: result.wallets.length,
      wallets: result.wallets.map((w) => ({
        wallet_id: w.walletId,
        chain: w.chain,
        address: w.address,
        ok: w.ok,
        balances: w.balancesUpserted,
        transactions: w.transactionsUpserted,
        error: w.error,
      })),
    },
  });

  if (result.ok) back({ tab: "health", msg: result.message });
  back({ tab: "health", error: result.message });
}

/**
 * AREA 4 — hide or unhide one token from the Portfolio view (scam/airdrop
 * control Michael asked for). The form carries the asset id and a `hidden`
 * flag ("1" to hide, "0" to unhide). NOTHING is deleted — this only flips the
 * `hidden` flag in the store; the asset and all its history stay in the database
 * for provability, and unhiding is one click. Owner/admin only; audited with the
 * public asset id (no secrets). Returns to the Portfolio tab with a friendly
 * message.
 */
export async function setCryptoAssetHiddenAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const assetId = String(formData.get("assetId") ?? "").trim();
  const hidden = String(formData.get("hidden") ?? "") === "1";
  if (assetId === "") back({ tab: "portfolio", error: "Missing token id." });

  const result = await setCryptoAssetHidden(assetId, hidden);
  if (!result.ok) back({ tab: "portfolio", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: hidden ? "crypto.asset.hidden" : "crypto.asset.unhidden",
    entityType: "crypto_asset",
    entityId: assetId, // public asset id — safe to record
    after: { asset_id: assetId, hidden },
  });

  back({
    tab: "portfolio",
    msg: hidden
      ? "Token hidden from your portfolio. It's still saved in your records \u2014 you can unhide it anytime."
      : "Token is back in your portfolio.",
  });
}

/**
 * R1-E \u2014 classify one transaction. Michael picks a tag from the row's dropdown
 * (the dropdown only ever offers tags that are valid for that row's primitive,
 * enforced in the pure view-model). This action re-validates everything server
 * side before writing:
 *
 *   1. the primitive must be one of the four canonical primitives,
 *   2. the tag must be a known tag in the R1-A vocabulary,
 *   3. the tag must be valid ON that primitive (no nonsense pairings).
 *
 * If all three hold, it upserts the single classification row for that
 * transaction (source = "owner", so Michael's choice always wins over any
 * auto-suggestion), records an audit entry with the public tx id + tag (no
 * secrets), and returns to the Classify tab with a plain-English confirmation
 * that includes what the tag means for taxes. Graceful: if the classification
 * table isn't migrated yet the store no-ops and we still report success.
 */
export async function classifyTransactionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const txId = String(formData.get("txId") ?? "").trim();
  const primitiveRaw = String(formData.get("primitive") ?? "").trim();
  const tagKey = String(formData.get("tagKey") ?? "").trim();

  if (txId === "") back({ tab: "classify", error: "Missing transaction id." });
  if (!(TX_PRIMITIVES as readonly string[]).includes(primitiveRaw)) {
    back({ tab: "classify", error: "That transaction type isn't recognized." });
  }
  const primitive = primitiveRaw as TxPrimitive;

  if (!isKnownTag(tagKey)) {
    back({ tab: "classify", error: "That category isn't recognized." });
  }
  if (!isTagValidOnPrimitive(tagKey, primitive)) {
    back({ tab: "classify", error: "That category can't be used for this kind of transaction." });
  }

  const result = await upsertCryptoClassification({
    transactionId: txId,
    primitive,
    tagKey,
    source: "owner",
    classifiedBy: session.profile.id,
  });
  if (!result.ok) back({ tab: "classify", error: result.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.profile.email,
    action: "crypto.tx.classified",
    entityType: "crypto_transaction",
    entityId: txId, // public tx id \u2014 safe to record
    after: { transaction_id: txId, primitive, tag_key: tagKey },
  });

  const def = getTagDefinition(tagKey);
  const label = def ? def.label : tagKey;
  back({
    tab: "classify",
    msg: `Saved \u2014 marked as \u201c${label}.\u201d ${def ? def.plainNote : ""}`.trim(),
  });
}

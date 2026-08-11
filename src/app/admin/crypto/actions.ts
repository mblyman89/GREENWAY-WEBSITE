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
import { addWatchOnlyWallet } from "@/lib/crypto/crypto-store";
import { runAllCryptoSync } from "@/lib/crypto/crypto-sync-orchestrator";

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

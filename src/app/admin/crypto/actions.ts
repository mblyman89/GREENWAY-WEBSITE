"use server";

/**
 * /admin/crypto server actions — Crypto Portfolio Slice C3 (connect a wallet).
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
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseAddWallet } from "@/lib/crypto/crypto-ui-core";
import { addWatchOnlyWallet } from "@/lib/crypto/crypto-store";

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
      ? "Wallet added — now watching this address."
      : "Already watching this address — label updated.",
  });
}

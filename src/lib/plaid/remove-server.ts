import "server-only";

/**
 * src/lib/plaid/remove-server.ts — remove (disconnect) a Plaid Item.
 *
 * Two steps, in order:
 *   1) Best-effort: call Plaid /item/remove to REVOKE the access_token at Plaid,
 *      so the connection stops (and stops any billing). If this fails (token
 *      already invalid, network, etc.) we do NOT block the local delete — the
 *      owner asked to remove it, and a stale token isn't worth keeping a row.
 *   2) Delete the local item row, which CASCADES to its accounts → their
 *      transactions, mortgage detail, and investment holdings (FKs in
 *      migrations 0157/0168/0170).
 *
 * SECURITY: the access_token is passed straight to Plaid and never logged.
 */
import { getPlaidClient } from "./client";
import { normalizeSetKey } from "./plaid-credentials-core";
import { extractPlaidError } from "./plaid-core";
import { getPlaidItem, deletePlaidItem } from "./store";

export type RemoveItemResult =
  | { ok: true; revoked: boolean }
  | { ok: false; error: string };

/**
 * Disconnect one Item by its item_id. Revokes at Plaid (best-effort), then
 * deletes the local rows. `revoked` reports whether the Plaid revoke succeeded
 * (false just means we couldn't reach Plaid — the local data is still removed).
 */
export async function removePlaidItem(itemId: string): Promise<RemoveItemResult> {
  const id = (itemId ?? "").trim();
  if (id === "") return { ok: false, error: "Missing connection id." };

  const item = await getPlaidItem(id);
  // If it's already gone locally, treat as success (idempotent remove).
  if (!item) {
    const del = await deletePlaidItem(id);
    return del.ok ? { ok: true, revoked: false } : del;
  }

  // 1) Best-effort revoke at Plaid.
  let revoked = false;
  const plaid = getPlaidClient(normalizeSetKey(item.credentialSet));
  if (plaid && item.accessToken) {
    try {
      await plaid.itemRemove({ access_token: item.accessToken });
      revoked = true;
    } catch (err) {
      // Swallow: a failed revoke must not block the local delete. Log the code
      // server-side only (never the token / raw context).
      const code = extractPlaidError(err).code;
      console.error(`[plaid] itemRemove failed for item — code=${code ?? "(none)"}; deleting local rows anyway`);
    }
  }

  // 2) Delete local rows (cascades to accounts/txns/mortgage/holdings).
  const del = await deletePlaidItem(id);
  if (!del.ok) return del;
  return { ok: true, revoked };
}

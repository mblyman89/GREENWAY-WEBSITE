import "server-only";

/**
 * src/lib/plaid/liabilities-server.ts — the SERVER-ONLY /liabilities/get driver.
 *
 * Fetches an Item's liabilities (we consume the MORTGAGE detail for Michael's
 * Sound Credit Union home loan), maps each mortgage to integer cents / basis
 * points via the pure core (liabilities-core.mapMortgages), and upserts the
 * rows. Best-effort and NEVER throws: if the Item isn't enabled for Liabilities
 * (e.g. an older Transactions-only connection) or the servicer has no mortgage,
 * we simply record nothing and move on — this must never break a sync or a page.
 *
 * Plaid's Liabilities data refreshes ~once/day, which matches Michael's
 * "monthly / manual refresh is fine". We call this on link + on every manual
 * "Sync now", so a manual refresh always pulls the latest mortgage figures.
 *
 * SECURITY: the access_token is passed straight to Plaid and never logged.
 */
import { getPlaidClient } from "./client";
import { normalizeSetKey } from "./plaid-credentials-core";
import { extractPlaidError } from "./plaid-core";
import { mapMortgages, type PlaidMortgageInput } from "./liabilities-core";
import { upsertPlaidMortgage } from "./store";

export type LiabilitiesSyncResult = {
  ok: boolean;
  /** How many mortgage rows we stored (0 is normal for non-mortgage items). */
  mortgages: number;
  /** Present only when Plaid returned an error we chose to swallow. */
  errorCode?: string | null;
};

/**
 * The only Item fields /liabilities/get needs: the decrypted access token and
 * the credential set the Item was linked under (so we use the right client).
 */
export type LiabilitiesSyncItem = {
  accessToken: string | null;
  credentialSet: string;
};

/**
 * Pull /liabilities/get for one Item and store any mortgage detail. Best-effort.
 * `accessToken` is read from the item by the caller (already decrypted).
 */
export async function syncItemLiabilities(item: LiabilitiesSyncItem): Promise<LiabilitiesSyncResult> {
  const plaid = getPlaidClient(normalizeSetKey(item.credentialSet));
  if (!plaid || !item.accessToken) return { ok: false, mortgages: 0 };

  try {
    const resp = await plaid.liabilitiesGet({ access_token: item.accessToken });
    const mortgageList = (resp.data.liabilities?.mortgage ?? []) as PlaidMortgageInput[];
    const mapped = mapMortgages(mortgageList);

    let stored = 0;
    for (const rec of mapped) {
      const res = await upsertPlaidMortgage(rec);
      if (res.ok) stored += 1;
    }
    return { ok: true, mortgages: stored };
  } catch (err) {
    // Common + expected: PRODUCTS_NOT_SUPPORTED / NO_LIABILITY_ACCOUNTS /
    // NO_ACCOUNTS when the Item has no mortgage or wasn't linked with the
    // Liabilities product. Swallow it — this is a best-effort enrichment.
    const code = extractPlaidError(err).code;
    return { ok: false, mortgages: 0, errorCode: code };
  }
}

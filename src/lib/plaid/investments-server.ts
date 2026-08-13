import "server-only";

/**
 * src/lib/plaid/investments-server.ts — the SERVER-ONLY /investments/holdings/get
 * driver.
 *
 * Fetches an Item's investment holdings (Fidelity is Michael's first brokerage),
 * maps each position to integer cents / micro-share quantities via the pure core
 * (investments-core.mapHoldings), and upserts the rows. Best-effort and NEVER
 * throws: if the Item isn't enabled for Investments (e.g. a Transactions-only
 * bank connection) or has no holdings, we record nothing and move on — this must
 * never break a sync or a page.
 *
 * Plaid's Investments data refreshes ~once/day, which matches Michael's
 * "monthly / manual refresh is fine". We call this on link + on every manual
 * "Sync now", so a manual refresh always pulls the latest positions.
 *
 * SECURITY: the access_token is passed straight to Plaid and never logged.
 */
import { getPlaidClient } from "./client";
import { normalizeSetKey } from "./plaid-credentials-core";
import { extractPlaidError } from "./plaid-core";
import { mapHoldings, type PlaidHoldingInput, type PlaidSecurityInput } from "./investments-core";
import { replacePlaidHoldingsForAccounts } from "./store";

export type InvestmentsSyncResult = {
  ok: boolean;
  /** How many holding rows we stored (0 is normal for non-brokerage items). */
  holdings: number;
  /** Present only when Plaid returned an error we chose to swallow. */
  errorCode?: string | null;
};

/**
 * The only Item fields /investments/holdings/get needs: the decrypted access
 * token and the credential set the Item was linked under (so we use the right
 * client).
 */
export type InvestmentsSyncItem = {
  accessToken: string | null;
  credentialSet: string;
};

/**
 * Pull /investments/holdings/get for one Item and store its positions.
 * Best-effort. `accessToken` is read from the item by the caller (decrypted).
 *
 * We REPLACE the stored holdings for each investment account in this response
 * (delete-then-insert), so a position the owner sold no longer lingers. Only
 * accounts that appear in this response are touched — bank accounts on other
 * Items are never affected.
 */
export async function syncItemInvestments(item: InvestmentsSyncItem): Promise<InvestmentsSyncResult> {
  const plaid = getPlaidClient(normalizeSetKey(item.credentialSet));
  if (!plaid || !item.accessToken) return { ok: false, holdings: 0 };

  try {
    const resp = await plaid.investmentsHoldingsGet({ access_token: item.accessToken });
    const holdings = (resp.data.holdings ?? []) as PlaidHoldingInput[];
    const securities = (resp.data.securities ?? []) as PlaidSecurityInput[];
    const mapped = mapHoldings(holdings, securities);

    // The set of investment account ids this response covers (so we only clear
    // holdings for accounts we actually got fresh data for).
    const accountIds = Array.from(new Set(mapped.map((r) => r.accountId)));
    const stored = await replacePlaidHoldingsForAccounts(accountIds, mapped);
    return { ok: true, holdings: stored };
  } catch (err) {
    // Common + expected: PRODUCTS_NOT_SUPPORTED / NO_INVESTMENT_ACCOUNTS /
    // NO_ACCOUNTS when the Item has no brokerage or wasn't linked with the
    // Investments product. Swallow it — this is a best-effort enrichment.
    const code = extractPlaidError(err).code;
    return { ok: false, holdings: 0, errorCode: code };
  }
}

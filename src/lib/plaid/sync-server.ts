import "server-only";

/**
 * src/lib/plaid/sync-server.ts — the SERVER-ONLY /transactions/sync driver
 * (Slice P3). It turns the pure cursor state machine (sync-core.ts) into real
 * network calls + database writes, and it NEVER throws to the UI: any failure
 * is recorded on the item (status + error_code) and returned as a friendly
 * result, so one bad connection can't break the page or a scheduled run.
 *
 * Per item:
 *   1) init the cursor state from the item's saved cursor (null = full backfill).
 *   2) loop: call plaid.transactionsSync({ access_token, cursor }) →
 *      • plan the delta (plaid-core.planTransactionMerge) and APPLY it per page
 *        (store.applyTransactionMerge) — idempotent (keyed on transaction_id),
 *        so a mid-run restart never double-counts.
 *      • refresh account balances from the page's `accounts` (free data).
 *      • advance the cursor via reduceSyncPage; stop when has_more=false.
 *   3) on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION → restart from the run's
 *      start cursor (Plaid's required recovery), up to a small budget.
 *   4) persist the FINAL cursor (store.savePlaidCursor also marks healthy +
 *      last_successful_sync). On other errors → map to a status via
 *      plaid-core.mapItemStatus and record it (store.setPlaidItemStatus).
 *
 * SECURITY: the access_token comes decrypted from the store ONLY here (server),
 * is passed straight to Plaid, and is never logged or returned to the caller.
 */
import { getPlaidClient } from "./client";
import { plaidDollarsToCents, planTransactionMerge, mapItemStatus, extractPlaidError, type PlaidTxnInput } from "./plaid-core";
import {
  listPlaidItems,
  getPlaidItem,
  savePlaidCursor,
  setPlaidItemStatus,
  applyTransactionMerge,
  upsertPlaidAccount,
  type PlaidItemRecord,
} from "./store";
import {
  initSyncState,
  reduceSyncPage,
  onMutationDuringPagination,
  shouldContinue,
  exceededRestartBudget,
  isMutationDuringPagination,
  emptyCounts,
  addPageCounts,
  summarizeSync,
  type SyncCounts,
} from "./sync-core";

/** Per-item sync outcome. Never throws — the error is here as a friendly string. */
export type ItemSyncResult = {
  itemId: string;
  institutionName: string | null;
  ok: boolean;
  message: string;
  counts: SyncCounts;
  errorCode?: string | null;
};

export type AllSyncResult = {
  ok: boolean;
  message: string;
  items: ItemSyncResult[];
};

/** Refresh the balances we got back on a sync page (free — no extra call). */
async function refreshBalancesFromPage(
  itemId: string,
  accounts: Array<{
    account_id: string;
    name?: string | null;
    official_name?: string | null;
    mask?: string | null;
    type?: unknown;
    subtype?: unknown;
    balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null };
  }>,
): Promise<void> {
  for (const a of accounts) {
    try {
      await upsertPlaidAccount({
        accountId: a.account_id,
        itemId,
        name: a.name ?? null,
        officialName: a.official_name ?? null,
        mask: a.mask ?? null,
        type: a.type ? String(a.type) : null,
        subtype: a.subtype ? String(a.subtype) : null,
        currentBalanceCents: plaidDollarsToCents(a.balances?.current ?? null),
        availableBalanceCents: plaidDollarsToCents(a.balances?.available ?? null),
        isoCurrencyCode: a.balances?.iso_currency_code ?? "USD",
      });
    } catch {
      /* best-effort: a balance write failing must not abort the sync */
    }
  }
}

/**
 * Sync ONE item end-to-end. Best-effort: returns a result rather than throwing.
 */
export async function runItemSync(item: PlaidItemRecord): Promise<ItemSyncResult> {
  const base: ItemSyncResult = {
    itemId: item.itemId,
    institutionName: item.institutionName,
    ok: false,
    message: "",
    counts: emptyCounts(),
  };

  const plaid = getPlaidClient();
  if (!plaid) return { ...base, message: "Plaid isn't configured." };
  if (!item.accessToken) {
    await setPlaidItemStatus(item.itemId, "error", "MISSING_ACCESS_TOKEN");
    return { ...base, message: "This connection is missing its access token. Please re-link it.", errorCode: "MISSING_ACCESS_TOKEN" };
  }

  let state = initSyncState(item.transactionsCursor);
  let counts = emptyCounts();

  while (shouldContinue(state)) {
    if (exceededRestartBudget(state)) {
      await setPlaidItemStatus(item.itemId, "error", "TRANSACTIONS_SYNC_RETRY_EXHAUSTED");
      return {
        ...base,
        counts,
        message: "Your bank kept changing data while we synced. We'll try again on the next scheduled run.",
        errorCode: "TRANSACTIONS_SYNC_RETRY_EXHAUSTED",
      };
    }

    let data: {
      added: PlaidTxnInput[];
      modified: PlaidTxnInput[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
      accounts: Parameters<typeof refreshBalancesFromPage>[1];
    };
    try {
      const resp = await plaid.transactionsSync({
        access_token: item.accessToken,
        // cursor is omitted on the first call (null) → full history backfill.
        ...(state.cursor ? { cursor: state.cursor } : {}),
      });
      data = resp.data as typeof data;
    } catch (err) {
      const code = extractPlaidError(err).code;
      if (isMutationDuringPagination(code)) {
        // Restart the whole loop from the run's start cursor (Plaid's rule).
        state = onMutationDuringPagination(state);
        counts = { ...counts, restarts: state.restarts };
        continue;
      }
      // Any other error: map to a status + friendly message, record, and stop.
      const view = mapItemStatus(code);
      await setPlaidItemStatus(item.itemId, view.status, code);
      return { ...base, counts, message: view.message, errorCode: code };
    }

    // Apply this page's delta idempotently (keyed on transaction_id).
    const plan = planTransactionMerge({
      added: data.added ?? [],
      modified: data.modified ?? [],
      removed: data.removed ?? [],
    });
    const applied = await applyTransactionMerge({ upserts: plan.upserts, removals: plan.removals });
    if (!applied.ok) {
      // DB write failed — record on the item so it's visible, then stop.
      await setPlaidItemStatus(item.itemId, "error", "DB_WRITE_FAILED");
      return { ...base, counts, message: `Couldn't save transactions: ${applied.error}`, errorCode: "DB_WRITE_FAILED" };
    }

    // Refresh balances from the accounts on this page (free).
    await refreshBalancesFromPage(item.itemId, data.accounts ?? []);

    counts = addPageCounts(counts, {
      added: data.added?.length ?? 0,
      modified: data.modified?.length ?? 0,
      removed: plan.removals.length,
      skipped: plan.skipped.length,
    });

    state = reduceSyncPage(state, { next_cursor: data.next_cursor, has_more: data.has_more });
  }

  // Persist the final cursor (also marks healthy + last_successful_sync).
  if (state.cursor) {
    const saved = await savePlaidCursor(item.itemId, state.cursor);
    if (!saved.ok) {
      return { ...base, counts, message: `Synced, but couldn't save the resume point: ${saved.error}` };
    }
  } else {
    // No cursor came back (no data yet) — mark healthy without a cursor.
    await setPlaidItemStatus(item.itemId, "healthy", null);
  }

  return { itemId: item.itemId, institutionName: item.institutionName, ok: true, message: summarizeSync(counts), counts };
}

/** Sync a single item by id (used by the "Sync now" button). */
export async function runPlaidSyncForItem(itemId: string): Promise<ItemSyncResult> {
  const item = await getPlaidItem(itemId);
  if (!item) {
    return {
      itemId,
      institutionName: null,
      ok: false,
      message: "That connection was not found.",
      counts: emptyCounts(),
    };
  }
  return runItemSync(item);
}

/** Sync ALL items (used by "Sync now" with no id, and by the scheduled run in P4). */
export async function runAllPlaidSync(): Promise<AllSyncResult> {
  const plaid = getPlaidClient();
  if (!plaid) return { ok: false, message: "Plaid isn't configured yet.", items: [] };

  const items = await listPlaidItems();
  if (items.length === 0) return { ok: true, message: "No bank connections to sync yet.", items: [] };

  const results: ItemSyncResult[] = [];
  for (const item of items) {
    results.push(await runItemSync(item));
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const message =
    failCount === 0
      ? `Synced ${okCount} connection${okCount === 1 ? "" : "s"}.`
      : `Synced ${okCount} of ${results.length} connections; ${failCount} need attention (see Health).`;

  return { ok: failCount === 0, message, items: results };
}

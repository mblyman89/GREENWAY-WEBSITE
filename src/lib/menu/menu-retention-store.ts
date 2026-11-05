/**
 * src/lib/menu/menu-retention-store.ts  (PERF round P1/P2)
 *
 * After every publish, clear a few old menu copies (prune_menu_version_items, 0344) so the
 * menu tables never pile up again. Runs after the response (runAfterResponse), bounded
 * (MENU_COPIES_PRUNED_PER_PUBLISH per call), never throws, never blocks or undoes a publish.
 * Before 0344 is applied it logs "not applied yet" and does nothing (rule 135: the error is
 * read and named, never treated as "nothing to do").
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  MENU_COPIES_KEPT,
  MENU_COPIES_PRUNED_PER_PUBLISH,
  PRUNE_MENU_RPC,
  describePrune,
  readPruneResult,
  type PruneOutcome,
} from "@/lib/menu/menu-retention-core";

export async function pruneOldMenuCopies(): Promise<PruneOutcome> {
  if (!isSupabaseServiceConfigured) return { kind: "error", message: "database not configured" };
  let outcome: PruneOutcome;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PRUNE_MENU_RPC, {
      p_keep_archived: MENU_COPIES_KEPT,
      p_max_versions: MENU_COPIES_PRUNED_PER_PUBLISH,
    });
    outcome = readPruneResult(data, error);
  } catch (err) {
    outcome = { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const line = `[menu-retention] ${describePrune(outcome)}`;
  if (outcome.kind === "error") console.error(line);
  else console.info(line);
  return outcome;
}

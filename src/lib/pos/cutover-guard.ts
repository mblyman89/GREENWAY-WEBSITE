/**
 * src/lib/pos/cutover-guard.ts
 *
 * S18 - the Cultivera cutover guard, database side. Every decision is made by
 * the pure core (src/lib/inventory/cutover-guard-core.ts); this file only
 * reads and writes. No new egress, no poll, no cron: every function runs
 * inside an action the owner already takes (an approval, a Publish click, an
 * upload), and each read is bounded, uses named columns, and is skipped
 * entirely when the flag INTAKE_CUTOVER_GUARD is off.
 *
 * Fail-open everywhere: a failed read returns "unknown", and "unknown" never
 * holds, never refuses, never blocks an upload - the pre-S18 behaviour. The
 * guard can make publishing safer; it can never lock the owner out.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/auth/audit";
import {
  CUTOVER_BLOCKER_READ_MAX,
  CUTOVER_GUARD_ENV,
  CUTOVER_RELEASE_MAX,
  HELD_READ_MAX,
  HELD_ROW_SELECT,
  TARGET_SELECT,
  blockingCultivera,
  cutoverDone,
  cutoverGuardEnabled,
  decidePublish,
  manifestsToRelease,
  pendingRebuilds,
  releaseNote,
  retiredSummary,
  retireStatuses,
  shouldRetireHeld,
  type CutoverBlocking,
  type HeldRow,
  type PublishDecision,
} from "@/lib/inventory/cutover-guard-core";

/** Is the guard on? (Read once per call; the literal env read the ledger test pins.) */
export function cutoverGuardOn(): boolean {
  return cutoverGuardEnabled(process.env[CUTOVER_GUARD_ENV]);
}

/**
 * The staged REAL Cultivera uploads right now (is_test = false; test-mode
 * rehearsals never block, bible S18.8). One bounded read, named columns.
 * null = none; "unknown" = the read failed (never hold on a guess).
 */
export async function readCultiveraBlocker(): Promise<CutoverBlocking | null | "unknown"> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("id, import_id, status, is_test")
      .not("import_id", "is", null)
      .eq("status", "staged")
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(CUTOVER_BLOCKER_READ_MAX);
    if (error) {
      console.error("[cutover-guard] blocker read error:", error.message);
      return "unknown";
    }
    return blockingCultivera((data as HeldRow[] | null) ?? []);
  } catch (err) {
    console.error("[cutover-guard] blocker read exception:", err);
    return "unknown";
  }
}

/**
 * Should a NEW receiving update be held for cutover? Only when the flag is on
 * and a real Cultivera upload is provably staged.
 */
export async function shouldHoldForCutover(): Promise<boolean> {
  if (!cutoverGuardOn()) return false;
  const b = await readCultiveraBlocker();
  return b !== null && b !== "unknown";
}

/** The target version's shape for decidePublish ("unknown" on failure). */
async function readTarget(versionId: string): Promise<HeldRow | null | "unknown"> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("menu_versions").select(TARGET_SELECT).eq("id", versionId).maybeSingle();
    if (error) {
      console.error("[cutover-guard] target read error:", error.message);
      return "unknown";
    }
    return (data as HeldRow | null) ?? null;
  } catch (err) {
    console.error("[cutover-guard] target read exception:", err);
    return "unknown";
  }
}

/**
 * The one verdict for a hand publish (flag off -> always the pre-S18 allow).
 * Two bounded reads: the blockers and the target row.
 */
export async function decideHandPublish(versionId: string): Promise<PublishDecision> {
  if (!cutoverGuardOn()) return { kind: "allow", release: false };
  const [blocking, target] = await Promise.all([readCultiveraBlocker(), readTarget(versionId)]);
  return decidePublish(versionId, blocking, target);
}

/**
 * Retire an old held row after its delivery was rebuilt (only when the new
 * snapshot did not already archive it through the RPC; shouldRetireHeld).
 * Guarded to the statuses retireStatuses allows and to never-published rows,
 * so a concurrent publish always wins and a live menu is never touched.
 */
async function retireHeld(heldId: string, replacedBy: string | null, statuses: string[]): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: row, error: rErr } = await admin
      .from("menu_versions")
      .select("id, summary_json")
      .eq("id", heldId)
      .in("status", statuses)
      .is("published_at", null)
      .maybeSingle();
    if (rErr || !row) return;
    const nowIso = new Date().toISOString();
    const { error: uErr } = await admin
      .from("menu_versions")
      .update({
        status: "archived",
        updated_at: nowIso,
        summary_json: retiredSummary((row as { summary_json: unknown }).summary_json, replacedBy, nowIso),
      })
      .eq("id", heldId)
      .in("status", statuses)
      .is("published_at", null);
    if (uErr) console.error("[cutover-guard] retire write error:", uErr.message);
  } catch (err) {
    console.error("[cutover-guard] retire exception:", err);
  }
}

export type RebuildOutcome = { staged: boolean; published: boolean; versionId: string | null; reason?: string };

/**
 * Rebuild ONE delivery's receiving update on top of the live menu (the fresh
 * snapshot publishes itself by the normal rules), then retire the stale held
 * row(s) that the publish RPC did not already archive. Never throws.
 */
export async function rebuildDelivery(
  manifestId: string,
  heldIds: readonly string[],
  actorId: string | null,
): Promise<RebuildOutcome> {
  let outcome: RebuildOutcome;
  try {
    // Dynamic import: intake-menu-staging imports this module (the hold).
    const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
    outcome = await stageIntakeMenuVersionForManifest(manifestId, actorId);
  } catch (err) {
    console.error("[cutover-guard] rebuild exception:", err);
    return { staged: false, published: false, versionId: null, reason: "exception" };
  }
  if (shouldRetireHeld(outcome)) {
    const statuses = retireStatuses(outcome);
    for (const id of heldIds) await retireHeld(id, outcome.versionId, statuses);
  }
  return outcome;
}

/**
 * RELEASE, part 1 (call BEFORE publishing the Cultivera upload): which
 * deliveries have a receiving update staged right now. They were all built
 * on the pre-Cultivera menu, so each one is rebuilt after the publish. Read
 * first because the publish RPC archives the ones created before the upload.
 */
export async function readHeldBeforeRelease(): Promise<ReturnType<typeof manifestsToRelease>> {
  const empty = { manifests: [], heldIds: {}, overflow: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select(HELD_ROW_SELECT)
      .is("import_id", null)
      .eq("status", "staged")
      .order("created_at", { ascending: true })
      .limit(HELD_READ_MAX);
    if (error) {
      console.error("[cutover-guard] held read error:", error.message);
      return empty;
    }
    return manifestsToRelease((data as HeldRow[] | null) ?? [], CUTOVER_RELEASE_MAX);
  } catch (err) {
    console.error("[cutover-guard] held read exception:", err);
    return empty;
  }
}

/**
 * RELEASE, part 2 (call AFTER the Cultivera upload is live): rebuild each
 * delivery in order, then write one audit line with the plain summary.
 * Returns the note shown to the owner.
 */
export async function releaseHeldAfterCutover(
  plan: ReturnType<typeof manifestsToRelease>,
  actorId: string | null,
  actorEmail: string | null,
  cultiveraVersionId: string,
): Promise<string> {
  let restaged = 0;
  let published = 0;
  for (const m of plan.manifests) {
    const o = await rebuildDelivery(m, plan.heldIds[m] ?? [], actorId);
    if (o.staged) restaged += 1;
    if (o.published) published += 1;
  }
  const note = releaseNote(restaged, published, plan.overflow);
  await recordAudit({
    actorId,
    actorEmail,
    action: "menu_version.cutover_released",
    entityType: "menu_version",
    entityId: cultiveraVersionId,
    after: { deliveries: plan.manifests.length, restaged, published, overflow: plan.overflow },
  });
  return note;
}

/**
 * ONE-TIME: has cutover already happened? (A real Cultivera menu went live
 * and a receiving update was published after it.) Two bounded reads, count
 * only for the second. false on any failure (a refusal must be certain).
 */
export async function readCutoverDone(): Promise<boolean> {
  if (!cutoverGuardOn()) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: cv, error: cErr } = await admin
      .from("menu_versions")
      .select("id, published_at")
      .not("import_id", "is", null)
      .eq("is_test", false)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cErr || !cv) return false;
    const at = (cv as { published_at: string | null }).published_at;
    const { count, error: nErr } = await admin
      .from("menu_versions")
      .select("id", { count: "exact", head: true })
      .is("import_id", null)
      .eq("is_test", false)
      .gt("published_at", at);
    if (nErr) return false;
    return cutoverDone(at, count ?? null);
  } catch (err) {
    console.error("[cutover-guard] cutover-done read exception:", err);
    return false;
  }
}

/**
 * The cutover page's status: the staged real uploads, whether cutover is
 * done, and the deliveries still to rebuild (bounded reads, named columns).
 */
export async function readCutoverStatus(): Promise<{
  enabled: boolean;
  blocking: CutoverBlocking | null | "unknown";
  done: boolean;
  pending: ReturnType<typeof pendingRebuilds>;
}> {
  const enabled = cutoverGuardOn();
  if (!enabled) return { enabled, blocking: null, done: false, pending: [] };
  const [blocking, done, pending] = await Promise.all([readCultiveraBlocker(), readCutoverDone(), readPending()]);
  return { enabled, blocking, done, pending };
}

async function readPending(): Promise<ReturnType<typeof pendingRebuilds>> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select(HELD_ROW_SELECT)
      .is("import_id", null)
      .order("created_at", { ascending: false })
      .limit(HELD_READ_MAX);
    if (error) {
      console.error("[cutover-guard] pending read error:", error.message);
      return [];
    }
    return pendingRebuilds((data as HeldRow[] | null) ?? []);
  } catch (err) {
    console.error("[cutover-guard] pending read exception:", err);
    return [];
  }
}

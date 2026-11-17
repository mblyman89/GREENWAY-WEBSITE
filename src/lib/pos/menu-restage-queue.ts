/**
 * src/lib/pos/menu-restage-queue.ts   (D247)
 *
 * Server half of "Approve returns at once; the menu updates in the background". Decisions live in
 * the pure menu-restage-queue-core.ts. This file:
 *
 *   queueMenuRestage(manifestId, actorId)  called by an Approve: put the delivery on the queue
 *                                          (one CAS write) and start a worker AFTER the response
 *   runMenuRestageQueue({ budgetMs })       one worker run: take the lease, rebuild each waiting
 *                                          delivery ONCE with the SAME stageIntakeMenuVersionForManifest
 *                                          the click used to await, release the lease
 *   loadMenuRestageStatus()                 the status line on Product Onboarding
 *
 * WHO RUNS IT. runAfterResponse right after the click (Next after(): the browser already has its
 * answer), and the existing every-minute worker /api/cron/lookup-jobs (no new cron), which finishes
 * anything a cut-off run left behind.
 *
 * SAFETY. One site_settings row; every write is a compare-and-swap on updated_at; one run at a time
 * (lease). A delivery leaves the queue only when a rebuild that started after its LAST approval has
 * finished, so an approval is never lost to a rebuild that read the drafts before it was saved.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { runAfterResponse } from "@/lib/after-response";
import {
  MENU_RESTAGE_AFTER_BUDGET_MS,
  MENU_RESTAGE_KEY,
  MENU_RESTAGE_LABEL,
  emptyRestage,
  enqueueRestage,
  finishRestage,
  nextRestage,
  ownsRestage,
  parseRestage,
  releaseRestageLease,
  restageDecision,
  restageRunNote,
  restageStatus,
  takeRestageLease,
  type RestageDecision,
  type RestageState,
  type RestageTone,
} from "@/lib/pos/menu-restage-queue-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Snapshot = { state: RestageState; updatedAt: string | null };

const CAS_TRIES = 6;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 200);

export async function readMenuRestage(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", MENU_RESTAGE_KEY).maybeSingle();
  if (error) throw new Error(`The background menu update queue could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseRestage(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

async function casWrite(admin: Admin, snap: Snapshot, next: RestageState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: MENU_RESTAGE_KEY, label: MENU_RESTAGE_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The background menu update queue could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin
    .from("site_settings")
    .update({ value_json: next, updated_by: actorId })
    .eq("key", MENU_RESTAGE_KEY)
    .eq("updated_at", snap.updatedAt)
    .select("key");
  if (error) throw new Error(`The background menu update queue could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

async function mutate(admin: Admin, actorId: string | null, change: (s: RestageState) => RestageState | null): Promise<RestageState | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readMenuRestage(admin);
    const next = change(snap.state);
    if (!next) return null;
    if (await casWrite(admin, snap, next, actorId)) return next;
  }
  throw new Error("The background menu update queue kept changing while it was being saved.");
}

/**
 * An Approve on a delivery: queue its menu update and start a worker after the response.
 * Returns false when it could not be queued - the caller then rebuilds inline (as before D247), so
 * an approval never silently misses the menu.
 */
export async function queueMenuRestage(manifestId: string, actorId: string | null, deps: { admin?: Admin; kick?: boolean } = {}): Promise<boolean> {
  if (!deps.admin && !isSupabaseServiceConfigured) return false;
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const s = await mutate(admin, actorId, (cur) => enqueueRestage(cur, manifestId, actorId, nowIso));
    if (!s || !s.entries.some((e) => e.manifestId.toLowerCase() === manifestId.toLowerCase())) return false;
  } catch (err) {
    console.error("[menu-restage] queue failed, rebuilding inline:", err);
    return false;
  }
  if (deps.kick !== false) {
    runAfterResponse("menu-restage", () => runMenuRestageQueue({ budgetMs: MENU_RESTAGE_AFTER_BUDGET_MS, trigger: "click" }));
  }
  return true;
}

export type MenuRestageRunResult =
  | { ok: true; skipped: RestageDecision | "not_configured"; rebuilt: 0; failed: 0; note: string }
  | { ok: true; skipped?: undefined; rebuilt: number; failed: number; note: string }
  | { ok: false; error: string };

type StageFn = (manifestId: string, actorId: string | null) => Promise<{ staged?: boolean; reason?: string | null } | unknown>;

/** One worker run. Never throws. */
export async function runMenuRestageQueue(
  opts: { budgetMs?: number; trigger?: "click" | "worker"; admin?: Admin; now?: () => number; token?: string; stage?: StageFn } = {},
): Promise<MenuRestageRunResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", rebuilt: 0, failed: 0, note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? MENU_RESTAGE_AFTER_BUDGET_MS;
  const token = opts.token ?? crypto.randomUUID();
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 1. Decide, then take the lease (CAS).
  try {
    const snap = await readMenuRestage(admin);
    const d = restageDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, rebuilt: 0, failed: 0, note: d === "leased" ? "Another run is updating the menu." : "Nothing waiting." };
    if (!(await casWrite(admin, snap, takeRestageLease(snap.state, token, t0, budget), null))) {
      return { ok: true, skipped: "leased", rebuilt: 0, failed: 0, note: "Another run is updating the menu." };
    }
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  const stage: StageFn =
    opts.stage ??
    (async (manifestId, actorId) => {
      const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
      return stageIntakeMenuVersionForManifest(manifestId, actorId);
    });

  // 2. Rebuild each waiting delivery once (re-reading the queue each time, so approvals that land
  //    meanwhile are picked up and a lost lease stops the run).
  let rebuilt = 0;
  let failed = 0;
  const tried = new Map<string, number>();
  let left = 0;
  try {
    while (now() - t0 < budget) {
      const snap = await readMenuRestage(admin);
      if (!ownsRestage(snap.state, token)) break;
      const entry = nextRestage(snap.state);
      if (!entry) break;
      const key = entry.manifestId.toLowerCase();
      // The same delivery at the same seq twice in one run = it just failed; leave it for the next run.
      if (tried.get(key) === entry.seq) break;
      tried.set(key, entry.seq);
      let okRun = true;
      let err: string | null = null;
      try {
        await stage(entry.manifestId, entry.actorId);
      } catch (e) {
        okRun = false;
        err = short(e);
      }
      if (okRun) rebuilt += 1;
      else failed += 1;
      await mutate(admin, null, (s) => (ownsRestage(s, token) ? finishRestage(s, entry.manifestId, entry.seq, okRun, err) : null));
    }
  } catch (err) {
    failed += 1;
    console.error("[menu-restage] run failed:", err);
  }

  // 3. Release the lease, note the run.
  try {
    const after = await mutate(admin, null, (s) => {
      if (!ownsRestage(s, token)) return null;
      left = s.entries.length;
      return { ...releaseRestageLease(s, token), runs: s.runs + 1, lastRunAt: new Date(now()).toISOString(), lastNote: restageRunNote(rebuilt, failed, s.entries.length) };
    });
    if (after) left = after.entries.length;
  } catch (err) {
    return { ok: false, error: `Rebuilt ${rebuilt}, but the queue could not be saved: ${short(err)}` };
  }
  const note = restageRunNote(rebuilt, failed, left);
  if (rebuilt > 0 || failed > 0) {
    await recordAudit({ actorId: null, action: "menu.restage_background_ran", entityType: "site_setting", entityId: null, after: { trigger: opts.trigger ?? "click", rebuilt, failed, left } }).catch(() => {});
  }
  return { ok: true, rebuilt, failed, note };
}

export type MenuRestageStatusView = { ok: true; tone: RestageTone; text: string; waiting: number; held: number; manifestIds: string[] } | { ok: false; error: string };

/** The status line (read-only, one row). */
export async function loadMenuRestageStatus(deps: { admin?: Admin; nowMs?: number } = {}): Promise<MenuRestageStatusView> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const snap = await readMenuRestage(admin);
    return { ok: true, ...restageStatus(snap.state, deps.nowMs ?? Date.now()), manifestIds: snap.state.entries.map((e) => e.manifestId) };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}

export { emptyRestage };

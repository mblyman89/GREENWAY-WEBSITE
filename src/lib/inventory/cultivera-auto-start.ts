/**
 * src/lib/inventory/cultivera-auto-start.ts   (R74 S13, round 8)
 *
 * Owner (round 1): "the new manifests we recreate from the originals need to
 * move automatically into onboarding, every manifest should be seen and
 * workable on the onboarding page."
 *
 * Server half of the automatic Start. Decisions live in
 * cultivera-auto-start-core.ts (pure, self-tested). This file:
 *
 *   armCultiveraAutoStart(importId)   called by Apply rebuild and Apply the
 *                                     email step when they succeed: queue a
 *                                     pass over that import's rebuilt
 *                                     manifests
 *   pauseCultiveraAutoStart()         the Pause button
 *   runCultiveraAutoStart({budgetMs}) one run: take the lease, list the armed
 *                                     imports' rebuilt manifests with no
 *                                     onboarding row, and run the SAME
 *                                     per-manifest Start on each (id order)
 *                                     until the budget is spent; the cursor
 *                                     is saved after every manifest
 *   loadAutoStartStatus(importId)     the status line on the rebuild and
 *                                     coverage pages
 *
 * WHO RUNS IT. A button press on those pages (200 s budget) and the existing
 * every-minute lookup worker (/api/cron/lookup-jobs) on a tick where it had no
 * lookup to do. No new cron (still 15 in vercel.json).
 *
 * SAFETY. One site_settings row holds the state; every write is a
 * compare-and-swap on its updated_at, and a run holds a lease (token +
 * expiry) so two runs never work the same pass. A run re-reads the state
 * before each manifest and stops when it was paused or re-armed. Start itself
 * is re-runnable (an open draft per product key is unique in the database),
 * and it never changes stock, prices or the live menu.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { startCultiveraManifestOnboarding } from "@/lib/inventory/cultivera-onboarding";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import { vendorStartCanContinue } from "@/lib/inventory/cultivera-vendor-core";
import {
  AUTO_START_AUDIT,
  AUTO_START_KEY,
  AUTO_START_LABEL,
  AUTO_START_PRESS_BUDGET_MS,
  armAutoStart,
  autoStartDecision,
  autoStartRunNote,
  autoStartStatus,
  finishAutoStartPass,
  ownsPass,
  parseAutoStartState,
  pauseAutoStart,
  pickAutoStartTargets,
  recordAutoStartOutcome,
  releaseAutoStartLease,
  takeAutoStartLease,
  type AutoStartDecision,
  type AutoStartOutcome,
  type AutoStartRun,
  type AutoStartState,
  type AutoStartTone,
} from "@/lib/inventory/cultivera-auto-start-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const PAGE = 1000;
const ID_CHUNK = 100;
const CAS_TRIES = 4;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

type Snapshot = { state: AutoStartState; updatedAt: string | null };

/** The saved state (a missing row = the empty state). A failed read throws: never "nothing to do". */
export async function readAutoStart(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", AUTO_START_KEY).maybeSingle();
  if (error) throw new Error(`The automatic start state could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseAutoStartState(row?.value_json ?? null), updatedAt: row ? row.updated_at ?? null : null };
}

/** Compare-and-swap: true = written; false = someone wrote first (re-read and decide again). */
async function casWrite(admin: Admin, snap: Snapshot, next: AutoStartState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: AUTO_START_KEY, label: AUTO_START_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The automatic start state could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin
    .from("site_settings")
    .update({ value_json: next, updated_by: actorId })
    .eq("key", AUTO_START_KEY)
    .eq("updated_at", snap.updatedAt)
    .select("key");
  if (error) throw new Error(`The automatic start state could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** read -> change -> CAS write, retried a few times; `change` returning null = do not write. */
async function mutate(admin: Admin, actorId: string | null, change: (s: AutoStartState) => AutoStartState | null): Promise<AutoStartState | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readAutoStart(admin);
    const next = change(snap.state);
    if (!next) return null;
    if (await casWrite(admin, snap, next, actorId)) return next;
  }
  throw new Error("The automatic start state kept changing while it was being saved. Try again.");
}

export async function armCultiveraAutoStart(importId: string, actorId: string | null, deps: { admin?: Admin; nowIso?: string } = {}): Promise<AutoStartState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const s = await mutate(admin, actorId, (cur) => armAutoStart(cur, importId, actorId, nowIso));
  await recordAudit({ actorId, action: AUTO_START_AUDIT.armed, entityType: "pos_import", entityId: importId, after: { generation: s?.generation ?? null, imports: s?.importIds ?? [] } }).catch(() => {});
  return s as AutoStartState;
}

export async function pauseCultiveraAutoStart(actorId: string | null, deps: { admin?: Admin } = {}): Promise<AutoStartState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const s = await mutate(admin, actorId, (cur) => pauseAutoStart(cur));
  await recordAudit({ actorId, action: AUTO_START_AUDIT.paused, entityType: "site_setting", entityId: null, after: { generation: s?.generation ?? null, started: s?.started ?? 0, failed: s?.failed ?? 0 } }).catch(() => {});
  return s as AutoStartState;
}

type TargetRow = { id: string; number: string; importId: string; drafts: number };

/**
 * Every rebuilt manifest of the given imports with its onboarding-row count.
 * Throws on any failed read: a pass never runs on a half-read list.
 */
export async function loadAutoStartRows(admin: Admin, importIds: readonly string[]): Promise<TargetRow[]> {
  if (importIds.length === 0) return [];
  const rows: TargetRow[] = [];
  for (let off = 0; off < 200_000; off += PAGE) {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, import_id:raw_payload->>import_id")
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .in("raw_payload->>import_id", [...importIds])
      .order("id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(`The rebuilt manifests could not be read: ${short(error)}`);
    const got = (data as { id: string; manifest_number: string | null; import_id: string | null }[] | null) ?? [];
    for (const m of got) rows.push({ id: m.id, number: (m.manifest_number ?? "").trim() || m.id.slice(0, 8), importId: (m.import_id ?? "").toLowerCase(), drafts: 0 });
    if (got.length < PAGE) break;
  }
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const ids = rows.slice(i, i + ID_CHUNK).map((r) => r.id);
    for (let off = 0; off < 500_000; off += PAGE) {
      const { data, error } = await admin.from("catalog_product_drafts").select("id, manifest_id").in("manifest_id", ids).order("id", { ascending: true }).range(off, off + PAGE - 1);
      if (error) throw new Error(`The onboarding rows could not be counted: ${short(error)}`);
      const got = (data as { manifest_id: string | null }[] | null) ?? [];
      for (const d of got) {
        const r = d.manifest_id ? byId.get(d.manifest_id) : undefined;
        if (r) r.drafts += 1;
      }
      if (got.length < PAGE) break;
    }
  }
  return rows;
}

export type AutoStartRunResult =
  | { ok: true; skipped: AutoStartDecision | "not_configured"; run?: undefined; note: string }
  | { ok: true; skipped?: undefined; run: AutoStartRun; note: string }
  | { ok: false; error: string };

/**
 * One run. Never throws: a broken run returns { ok: false } with the reason
 * (and the reason is saved as the pass's last note, so the page shows it).
 */
export async function runCultiveraAutoStart(
  opts: {
    budgetMs?: number;
    actorId?: string | null;
    trigger?: "press" | "worker";
    admin?: Admin;
    now?: () => number;
    token?: string;
    startOne?: (manifestId: string, actorId: string | null) => Promise<AutoStartOutcome>;
  } = {},
): Promise<AutoStartRunResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? AUTO_START_PRESS_BUDGET_MS;
  const actorId = opts.actorId ?? null;
  const token = opts.token ?? crypto.randomUUID();
  const startOne =
    opts.startOne ??
    (async (id: string, actor: string | null): Promise<AutoStartOutcome> => {
      const r = await startCultiveraManifestOnboarding(id, actor);
      return r.ok ? { ok: true, seeded: r.seeded } : { ok: false, error: r.error };
    });
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 1. Decide, then take the lease (CAS).
  let generation = 0;
  let importIds: string[] = [];
  let cursor: string | null = null;
  try {
    const snap = await readAutoStart(admin);
    const d = autoStartDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "leased" ? "Another run is starting manifests right now." : "Nothing is queued." };
    const leased = takeAutoStartLease(snap.state, token, t0, budget);
    if (!(await casWrite(admin, snap, leased, actorId))) return { ok: true, skipped: "leased", note: "Another run is starting manifests right now." };
    generation = leased.generation;
    importIds = leased.importIds;
    cursor = leased.cursor;
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  const run: AutoStartRun = { ran: 0, started: 0, seeded: 0, failed: 0, remaining: 0, stoppedBy: null };
  let targets: string[] = [];
  const label = new Map<string, string>();
  try {
    // 2. The pass's targets (failing read = stop loudly, nothing is started blind).
    const rows = await loadAutoStartRows(admin, importIds);
    for (const r of rows) label.set(r.id.toLowerCase(), r.number);
    targets = pickAutoStartTargets(rows, cursor);

    // 3. One manifest after another while the budget allows.
    let i = 0;
    for (; i < targets.length; i += 1) {
      if (!vendorStartCanContinue(now() - t0, budget)) {
        run.stoppedBy = "budget";
        break;
      }
      const cur = await readAutoStart(admin);
      if (!ownsPass(cur.state, token, generation)) {
        run.stoppedBy = cur.state.leaseToken === token ? "paused_or_rearmed" : "lost_lease";
        break;
      }
      const id = targets[i];
      let outcome: AutoStartOutcome;
      try {
        outcome = await startOne(id, actorId);
      } catch (err) {
        outcome = { ok: false, error: short(err) };
      }
      run.ran += 1;
      if (outcome.ok) {
        run.started += 1;
        run.seeded += Math.max(0, outcome.seeded);
      } else run.failed += 1;
      const saved = await mutate(admin, actorId, (s) => (ownsPass(s, token, generation) ? recordAutoStartOutcome(s, id, outcome, label.get(id) ?? id.slice(0, 8)) : null));
      if (!saved) {
        run.stoppedBy = "paused_or_rearmed";
        i += 1;
        break;
      }
    }
    run.remaining = Math.max(0, targets.length - i);
    if (run.stoppedBy === null) run.stoppedBy = "done";
    if (run.stoppedBy === "done") run.remaining = 0;
  } catch (err) {
    const msg = short(err);
    await mutate(admin, actorId, (s) => (s.leaseToken === token ? releaseAutoStartLease({ ...s, lastRunAt: new Date(now()).toISOString(), lastNote: `Stopped: ${msg}` }, token) : null)).catch(() => null);
    await recordAudit({ actorId, action: AUTO_START_AUDIT.ran, entityType: "site_setting", entityId: null, after: { trigger: opts.trigger ?? "press", error: msg, ...run } }).catch(() => {});
    return { ok: false, error: msg };
  }

  // 4. Finish (only the pass this run owns), release the lease, audit.
  const note = autoStartRunNote(run);
  const finished = run.stoppedBy === "done" || run.stoppedBy === "budget";
  try {
    await mutate(admin, actorId, (s) => {
      if (s.leaseToken !== token) return null;
      const base = finished && s.generation === generation ? finishAutoStartPass(s, run.remaining, new Date(now()).toISOString(), note) : s;
      return releaseAutoStartLease(base, token);
    });
  } catch (err) {
    return { ok: false, error: `${note} But the result could not be saved: ${short(err)}` };
  }
  await recordAudit({
    actorId,
    action: AUTO_START_AUDIT.ran,
    entityType: "site_setting",
    entityId: null,
    after: { trigger: opts.trigger ?? "press", imports: importIds, generation, ...run, live_menu_changed: false },
  }).catch(() => {});
  return { ok: true, run, note };
}

export type AutoStartStatusView =
  | { ok: true; tone: AutoStartTone; text: string; armed: boolean; running: boolean; paused: boolean; remaining: number | null; errors: string[]; lastNote: string | null; lastRunAt: string | null }
  | { ok: false; error: string };

/** The status line for one import (read-only). An unreadable count is said so, never 0. */
export async function loadAutoStartStatus(importId: string, deps: { admin?: Admin; nowMs?: number } = {}): Promise<AutoStartStatusView> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const snap = await readAutoStart(admin);
    let remaining: number | null = null;
    try {
      remaining = pickAutoStartTargets(await loadAutoStartRows(admin, [importId.toLowerCase()]), null).length;
    } catch {
      remaining = null;
    }
    const v = autoStartStatus(snap.state, importId, remaining, deps.nowMs ?? Date.now());
    const mine = v.armed;
    return { ok: true, ...v, paused: mine && snap.state.paused, remaining, errors: mine ? snap.state.errors : [], lastNote: mine ? snap.state.lastNote : null, lastRunAt: mine ? snap.state.lastRunAt : null };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}

/**
 * src/lib/inventory/coa-trust-all-store.ts   (D206)
 *
 * The overnight "Re-read every COA and trust it" job. The button only writes
 * the run (site_settings `coa_trust_all_run`); the cron route
 * /api/cron/coa-trust-all does the work every 5 minutes, on the server, so it
 * keeps going after the tab is closed ("I will push the button before bed and
 * hopefully when I wake up it will be finished").
 *
 * A tick is a request to consider working, never a lock:
 *   - the lease is taken with a compare-and-set on value_json->>leaseToken;
 *   - TRUST_LEASE_MS outlives the route's maxDuration, so a live tick is never
 *     overtaken; a killed tick's lease simply expires;
 *   - the cursor (last lab id handled) is saved after every batch under the
 *     same compare-and-set, so a lost lease writes nothing and a killed tick
 *     loses at most one batch (which is read again: reading is idempotent).
 *
 * Rule 15: every {error} is read, explicit selects, pages of TRUST_PAGE.
 * An idle tick is one site_settings read and writes nothing.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import {
  FREE_LEASE,
  TRUST_AUDIT_DONE,
  TRUST_AUDIT_START,
  TRUST_AUDIT_STOP,
  TRUST_BATCH_RESERVE_MS,
  TRUST_CONCURRENCY,
  TRUST_LEASE_MS,
  TRUST_PAGE,
  TRUST_RUN_KEY,
  TRUST_RUN_LABEL,
  addOutcome,
  hasCertificateSource,
  leaseVerdict,
  needsTrustRead,
  newTrustRun,
  parseTrustRun,
  type TrustRun,
} from "@/lib/inventory/coa-trust-all-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const short = (e: { message?: string } | null | undefined) => (e?.message ?? "unknown error").slice(0, 200);

/** Wall clock for one tick: the cron route's maxDuration is 300 s. */
export const TRUST_TICK_MS = 280_000;

async function readRun(admin: Admin): Promise<{ ok: true; run: TrustRun | null } | { ok: false; error: string }> {
  const { data, error } = await admin.from("site_settings").select("value_json").eq("key", TRUST_RUN_KEY).maybeSingle();
  if (error) return { ok: false, error: short(error) };
  return { ok: true, run: parseTrustRun((data as { value_json?: unknown } | null)?.value_json) };
}

/** Compare-and-set on the lease token. False = someone else holds the run now. */
async function casRun(admin: Admin, next: TrustRun, expectedToken: string): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await admin
    .from("site_settings")
    .update({ value_json: next })
    .eq("key", TRUST_RUN_KEY)
    .eq("value_json->>leaseToken", expectedToken)
    .select("key");
  if (error) return { ok: false, error: short(error) };
  return { ok: ((data as unknown[] | null) ?? []).length === 1, error: null };
}

/** How many certificates are not read-and-accepted yet (unread + failed + partial). */
async function countTarget(admin: Admin): Promise<{ n: number; error: string | null }> {
  const a = await admin.from("lab_results").select("id", { count: "exact", head: true }).is("coa_extract_status", null);
  if (a.error) return { n: 0, error: short(a.error) };
  const b = await admin.from("lab_results").select("id", { count: "exact", head: true }).neq("coa_extract_status", "ok");
  if (b.error) return { n: 0, error: short(b.error) };
  return { n: (a.count ?? 0) + (b.count ?? 0), error: null };
}

export type TrustPanel = { ok: boolean; error: string | null; run: TrustRun | null };

export async function readTrustPanel(): Promise<TrustPanel> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured.", run: null };
  const r = await readRun(createSupabaseAdminClient());
  return r.ok ? { ok: true, error: null, run: r.run } : { ok: false, error: r.error, run: null };
}

/** The button. Refuses while a run is going; a done or stopped run starts again from the beginning. */
export async function startTrustAll(actorId: string | null): Promise<{ ok: true; target: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const cur = await readRun(admin);
  if (!cur.ok) return { ok: false, error: cur.error };
  if (cur.run?.status === "running") return { ok: false, error: "it is already running - see the progress line" };
  const t = await countTarget(admin);
  if (t.error) return { ok: false, error: t.error };
  const run = newTrustRun(new Date().toISOString(), actorId, t.n);
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: TRUST_RUN_KEY, label: TRUST_RUN_LABEL, value_json: run, updated_by: actorId }, { onConflict: "key" });
  if (error) return { ok: false, error: short(error) };
  await recordAudit({ actorId, action: TRUST_AUDIT_START, entityType: "site_settings", entityId: TRUST_RUN_KEY, after: { target: t.n } });
  return { ok: true, target: t.n };
}

/** Stop. The tick holding the lease notices at its next save (the CAS fails) and stops writing. */
export async function stopTrustAll(actorId: string | null): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const cur = await readRun(admin);
  if (!cur.ok) return { ok: false, error: cur.error };
  if (!cur.run || cur.run.status !== "running") return { ok: false, error: "it is not running" };
  const next: TrustRun = { ...cur.run, status: "stopped", leaseToken: `stopped-${randomUUID()}`, leaseUntil: null, finishedAt: new Date().toISOString() };
  const { error } = await admin.from("site_settings").update({ value_json: next }).eq("key", TRUST_RUN_KEY);
  if (error) return { ok: false, error: short(error) };
  await recordAudit({ actorId, action: TRUST_AUDIT_STOP, entityType: "site_settings", entityId: TRUST_RUN_KEY, after: { totals: next.totals } });
  return { ok: true, error: null };
}

type LabPageRow = { id: string; coa_url: string | null; wcia_json_url: string | null; coa_storage_path: string | null; coa_extract_status: string | null };

export type TrustTickResult = { ok: boolean; skipped?: "idle" | "leased" | "lost_lease"; handled: number; done: boolean; error: string | null };

/**
 * One cron tick. `reader` is the certificate reader (coa-extract
 * trustReadLabs); injectable for tests.
 */
export async function tickTrustAll(
  deps: {
    reader?: (ids: string[], actorId: string | null) => Promise<{ ok: number; partial: number; failed: number; read: number; errors: string[] }>;
    now?: () => number;
    tickMs?: number;
  } = {},
): Promise<TrustTickResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, skipped: "idle", handled: 0, done: false, error: null };
  const now = deps.now ?? Date.now;
  const started = now();
  const tickMs = deps.tickMs ?? TRUST_TICK_MS;
  const admin = createSupabaseAdminClient();
  const cur = await readRun(admin);
  if (!cur.ok) return { ok: false, handled: 0, done: false, error: cur.error };
  const verdict = leaseVerdict(cur.run, started);
  if (verdict !== "take") return { ok: true, skipped: verdict, handled: 0, done: false, error: null };
  const token = randomUUID();
  let run: TrustRun = { ...cur.run!, leaseToken: token, leaseUntil: new Date(started + TRUST_LEASE_MS).toISOString(), lastTickAt: new Date(started).toISOString() };
  const took = await casRun(admin, run, cur.run!.leaseToken);
  if (took.error) return { ok: false, handled: 0, done: false, error: took.error };
  if (!took.ok) return { ok: true, skipped: "leased", handled: 0, done: false, error: null };

  const reader = deps.reader ?? (async (ids: string[], actorId: string | null) => (await import("@/lib/inventory/coa-extract")).trustReadLabs(ids, actorId));
  let handled = 0;
  const save = async (next: TrustRun): Promise<boolean> => {
    const r = await casRun(admin, next, token);
    if (r.error) run.recentErrors = [r.error, ...run.recentErrors].slice(0, 10);
    return r.ok;
  };

  while (now() - started < tickMs - TRUST_BATCH_RESERVE_MS) {
    let q = admin
      .from("lab_results")
      .select("id, coa_url, wcia_json_url, coa_storage_path, coa_extract_status")
      .order("id", { ascending: true })
      .limit(TRUST_PAGE);
    if (run.cursor) q = q.gt("id", run.cursor);
    const { data, error } = await q;
    if (error) {
      run = { ...run, recentErrors: [`lab results: ${short(error)}`, ...run.recentErrors].slice(0, 10) };
      break;
    }
    const page = (data as LabPageRow[] | null) ?? [];
    if (page.length === 0) {
      const at = new Date(now()).toISOString();
      const fin: TrustRun = { ...run, status: "done", finishedAt: at, leaseToken: FREE_LEASE, leaseUntil: null };
      if (await save(fin)) {
        await recordAudit({ actorId: run.startedBy, action: TRUST_AUDIT_DONE, entityType: "site_settings", entityId: TRUST_RUN_KEY, after: { totals: fin.totals, target: fin.target } });
        return { ok: true, handled, done: true, error: null };
      }
      return { ok: true, skipped: "lost_lease", handled, done: false, error: null };
    }
    // Walk the page in batches; the cursor moves only past rows that were handled.
    const work = page.filter(needsTrustRead);
    let lastHandled = run.cursor;
    let stopForTime = false;
    let i = 0;
    for (const r of page) {
      if (!needsTrustRead(r)) lastHandled = r.id;
      else break;
    }
    while (i < work.length) {
      if (now() - started >= tickMs - TRUST_BATCH_RESERVE_MS) {
        stopForTime = true;
        break;
      }
      const batch = work.slice(i, i + TRUST_CONCURRENCY * 2);
      i += batch.length;
      let totals = run.totals;
      const readable = batch.filter(hasCertificateSource);
      for (const b of batch) if (!hasCertificateSource(b)) totals = addOutcome(totals, "nothing");
      const errs: string[] = [];
      if (readable.length > 0) {
        try {
          const res = await reader(readable.map((b) => b.id), run.startedBy);
          totals = { ...totals, read: totals.read + res.read, trusted: totals.trusted + res.ok, stillFailed: totals.stillFailed + res.partial + res.failed };
          const missed = readable.length - res.read;
          if (missed > 0) totals = { ...totals, errors: totals.errors + missed };
          errs.push(...res.errors);
        } catch (err) {
          totals = { ...totals, errors: totals.errors + readable.length };
          errs.push(err instanceof Error ? err.message : String(err));
        }
      }
      handled += batch.length;
      // Rows after this batch that need nothing are passed too.
      const lastId = batch[batch.length - 1].id;
      const at = page.findIndex((p) => p.id === lastId);
      lastHandled = lastId;
      for (let k = at + 1; k < page.length && !needsTrustRead(page[k]); k++) lastHandled = page[k].id;
      run = { ...run, totals, cursor: lastHandled, recentErrors: [...errs.map((e) => e.slice(0, 200)), ...run.recentErrors].slice(0, 10), lastTickAt: new Date(now()).toISOString() };
      if (!(await save(run))) return { ok: true, skipped: "lost_lease", handled, done: false, error: null };
    }
    if (stopForTime) break;
    if (work.length === 0) {
      run = { ...run, cursor: page[page.length - 1].id };
      if (!(await save(run))) return { ok: true, skipped: "lost_lease", handled, done: false, error: null };
    }
  }
  // Out of time: free the lease so the next tick continues at once.
  const rel: TrustRun = { ...run, leaseToken: FREE_LEASE, leaseUntil: null };
  if (!(await save(rel))) return { ok: true, skipped: "lost_lease", handled, done: false, error: null };
  return { ok: true, handled, done: false, error: null };
}

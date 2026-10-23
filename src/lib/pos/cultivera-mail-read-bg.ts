/**
 * src/lib/pos/cultivera-mail-read-bg.ts   (R74 S20, owner round 10)
 *
 * Owner: "is there a way to click it, and it just runs in the background until all are done?"
 *
 * Server half of "Read everything in the background". Decisions live in the pure
 * cultivera-mail-read-bg-core.ts. This file:
 *
 *   armMailReadBg(actorId)      the button: queue reading every kept document
 *   pauseMailReadBgNow(actorId) the Pause button (a run stops starting documents at once;
 *                               the ones in flight are finished and written)
 *   runMailReadBg({budgetMs})   one run: take the lease, run the SAME reader as the press
 *                               (runReadBatch, S19: five at a time, newest email first) until the
 *                               budget is spent, add the counts, release the lease
 *   loadMailReadBgStatus()      the status line on Menu Imports
 *
 * WHO RUNS IT. The button press (READ_BATCH_TIME_BUDGET_MS, so the person sees it start) and the
 * existing every-minute worker /api/cron/lookup-jobs on a tick where it had no lookup and no
 * automatic onboarding start to do (MAIL_READ_BG_BUDGET_MS). No new cron.
 *
 * SAFETY. One site_settings row holds the state; every write is a compare-and-swap on its
 * updated_at; a run holds a lease (token + expiry = the route's 800 s) so two runs never read at
 * the same time; before each document the run re-reads the state and stops starting documents when
 * it was paused or restarted. Each document is still claimed by the guarded update (S9), so even a
 * press of the ordinary Read button at the same time reads each document once.
 *
 * Unattended, so a LlamaParse SERVICE outage (key, credits, rate limit, down) never falls back to
 * the text layer for the whole mailbox: the document stays "stored", the run stops and says so,
 * and after MAIL_READ_BG_MAX_FAILED_RUNS failed runs in a row the reader pauses itself with the
 * reason on the page (never retried all night).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { readPdfLayer } from "@/lib/inventory/pdf-extract";
import { parsePdfWithFallback } from "@/lib/inbound-email/llamaparse-provider";
import { harvestMailConfigFromEnv } from "@/lib/pos/cultivera-mail-harvest-core";
import { loadXlsxWorkbook, runReadBatch, supabaseReadIo, type ReadIo } from "@/lib/pos/cultivera-mail-read-store";
import { READ_BATCH_TIME_BUDGET_MS, type ReadBatchResult } from "@/lib/pos/cultivera-mail-read-core";
import {
  MAIL_READ_BG_AUDIT,
  MAIL_READ_BG_KEY,
  MAIL_READ_BG_LABEL,
  MAIL_READ_BG_MAX_DOCS,
  armMailReadBg as armState,
  mailReadBgDecision,
  mailReadBgRunNote,
  mailReadBgStatus,
  ownsMailReadBg,
  parseMailReadBg,
  pauseMailReadBg,
  recordMailReadBgRun,
  releaseMailReadBgLease,
  takeMailReadBgLease,
  type MailReadBgDecision,
  type MailReadBgState,
  type MailReadBgTone,
} from "@/lib/pos/cultivera-mail-read-bg-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const CAS_TRIES = 4;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 200);

type Snapshot = { state: MailReadBgState; updatedAt: string | null };

/** The saved state (a missing row = not armed). A failed read throws: never "nothing to do". */
export async function readMailReadBg(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", MAIL_READ_BG_KEY).maybeSingle();
  if (error) throw new Error(`The background reading state could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseMailReadBg(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

/** Compare-and-swap: true = written; false = someone wrote first (re-read and decide again). */
async function casWrite(admin: Admin, snap: Snapshot, next: MailReadBgState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: MAIL_READ_BG_KEY, label: MAIL_READ_BG_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The background reading state could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin
    .from("site_settings")
    .update({ value_json: next, updated_by: actorId })
    .eq("key", MAIL_READ_BG_KEY)
    .eq("updated_at", snap.updatedAt)
    .select("key");
  if (error) throw new Error(`The background reading state could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** read -> change -> CAS write, retried a few times; `change` returning null = do not write. */
async function mutate(admin: Admin, actorId: string | null, change: (s: MailReadBgState) => MailReadBgState | null): Promise<MailReadBgState | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readMailReadBg(admin);
    const next = change(snap.state);
    if (!next) return null;
    if (await casWrite(admin, snap, next, actorId)) return next;
  }
  throw new Error("The background reading state kept changing while it was being saved. Try again.");
}

export async function armMailReadBg(actorId: string | null, deps: { admin?: Admin; nowIso?: string } = {}): Promise<MailReadBgState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const s = await mutate(admin, actorId, (cur) => armState(cur, actorId, deps.nowIso ?? new Date().toISOString()));
  await recordAudit({ actorId, action: MAIL_READ_BG_AUDIT.armed, entityType: "site_setting", entityId: null, after: { generation: s?.generation ?? null } }).catch(() => {});
  return s as MailReadBgState;
}

export async function pauseMailReadBgNow(actorId: string | null, deps: { admin?: Admin } = {}): Promise<MailReadBgState> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const s = await mutate(admin, actorId, (cur) => pauseMailReadBg(cur));
  await recordAudit({ actorId, action: MAIL_READ_BG_AUDIT.paused, entityType: "site_setting", entityId: null, after: { generation: s?.generation ?? null, read: s?.read ?? 0 } }).catch(() => {});
  return s as MailReadBgState;
}

export type MailReadBgRunResult =
  | { ok: true; skipped: MailReadBgDecision | "not_configured"; note: string; result?: undefined }
  | { ok: true; skipped?: undefined; result: ReadBatchResult; note: string }
  | { ok: false; error: string };

/** The real reader for the background: LlamaParse outages hold the document (never the text layer unattended). */
function backgroundIo(admin: Admin, actorId: string | null): ReadIo {
  const cfg = harvestMailConfigFromEnv(process.env);
  return supabaseReadIo(admin, cfg.mailbox, {
    readPdfLayer,
    parsePdfWithFallback,
    loadWorkbook: loadXlsxWorkbook,
    actor: { id: actorId, email: null },
    holdOnLlamaOutage: true,
  });
}

/**
 * One run. Never throws: a broken run returns { ok: false } with the reason (and the reason is
 * saved as the pass's last error, counted toward the self-pause, so the page shows it).
 */
export async function runMailReadBg(
  opts: {
    budgetMs?: number;
    actorId?: string | null;
    trigger?: "press" | "worker";
    admin?: Admin;
    now?: () => number;
    token?: string;
    io?: ReadIo;
    concurrency?: number;
  } = {},
): Promise<MailReadBgRunResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? READ_BATCH_TIME_BUDGET_MS;
  const actorId = opts.actorId ?? null;
  const token = opts.token ?? crypto.randomUUID();
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 1. Decide, then take the lease (CAS).
  let generation = 0;
  try {
    const snap = await readMailReadBg(admin);
    const d = mailReadBgDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "leased" ? "Another run is reading right now." : "Background reading is not queued." };
    const leased = takeMailReadBgLease(snap.state, token, t0, budget);
    if (!(await casWrite(admin, snap, leased, actorId))) return { ok: true, skipped: "leased", note: "Another run is reading right now." };
    generation = leased.generation;
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 2. Read with the SAME runner as the press; stop starting documents once paused / re-armed.
  let result: ReadBatchResult;
  try {
    const io = opts.io ?? backgroundIo(admin, actorId);
    result = await runReadBatch(io, {
      budgetMs: budget,
      maxDocs: MAIL_READ_BG_MAX_DOCS,
      concurrency: opts.concurrency,
      keepGoing: async () => ownsMailReadBg((await readMailReadBg(admin)).state, token, generation),
    });
  } catch (err) {
    // A failed count / list (database down, table missing): a failed run, counted and named.
    result = { ok: false, waiting: 0, read: 0, parsed: 0, unreadable: 0, failed: 0, llamaparse: 0, unpdf: 0, left: 0, stoppedBecause: short(err) };
    try {
      result.left = (await readMailReadBg(admin)).state.left ?? 0;
    } catch {
      /* the note below still names the failure */
    }
    if (result.left === 0) result.left = 1; // never "finished" on a run that could not read
  }

  // 3. Save the run (only the pass this run owns), release the lease, audit.
  const run = { ok: result.ok, waiting: result.waiting, read: result.read, parsed: result.parsed, unreadable: result.unreadable, llamaparse: result.llamaparse, unpdf: result.unpdf, left: result.left, stoppedBecause: result.stoppedBecause };
  const note = mailReadBgRunNote(run);
  try {
    await mutate(admin, actorId, (s) => {
      if (s.leaseToken !== token) return null;
      const base = s.generation === generation && !s.paused ? recordMailReadBgRun(s, run, new Date(now()).toISOString(), note) : { ...s, lastNote: note }; // paused / re-armed meanwhile: the new pass's counts stay clean
      return releaseMailReadBgLease(base, token);
    });
  } catch (err) {
    return { ok: false, error: `${note} But the result could not be saved: ${short(err)}` };
  }
  await recordAudit({ actorId, action: MAIL_READ_BG_AUDIT.ran, entityType: "site_setting", entityId: null, after: { trigger: opts.trigger ?? "press", generation, ...run } }).catch(() => {});
  return { ok: true, result, note };
}

export type MailReadBgStatusView =
  | { ok: true; tone: MailReadBgTone; text: string; running: boolean; canPause: boolean; canStart: boolean; lastNote: string | null; lastRunAt: string | null }
  | { ok: false; error: string };

/** The status line (read-only). `stored` = the page's own count of documents waiting (null = unknown). */
export async function loadMailReadBgStatus(stored: number | null, deps: { admin?: Admin; nowMs?: number } = {}): Promise<MailReadBgStatusView> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const snap = await readMailReadBg(admin);
    const v = mailReadBgStatus(snap.state, stored, deps.nowMs ?? Date.now());
    return { ok: true, ...v, lastNote: snap.state.armed ? snap.state.lastNote : null, lastRunAt: snap.state.armed ? snap.state.lastRunAt : null };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}

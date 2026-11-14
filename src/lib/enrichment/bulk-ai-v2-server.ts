/**
 * src/lib/enrichment/bulk-ai-v2-server.ts  (D244 E-5 - Bulk AI v2)
 *
 * The I/O side of bulk-ai-v2-core.ts. "Draft with AI" on the Bulk AI page
 * only QUEUES product keys (one site_settings row); the every-minute worker
 * (/api/cron/lookup-jobs, on a tick with nothing else to do - no new cron)
 * calls runBulkAiV2, which drafts each product with the SAME call as the
 * product page's "Enrich this product (all fields)" (draftAllFieldsForProduct,
 * D244 E-4). One code path; a fix to one fixes both.
 *
 * SAFETY (the cultivera-mail-read-bg pattern). Every write is a
 * compare-and-swap on the row's updated_at; a run holds a lease (token +
 * expiry = budget + slack = the route's 800 s) so two ticks never draft the
 * same product; each product is claimed (CAS) before it is drafted; a run
 * killed mid-product leaves it "running" and the next lease re-queues it
 * once, then fails it with a plain reason. A failed draft keeps its reason
 * (friendlyAiError) so the page can say WHY.
 *
 * Nothing is accepted or published here: drafts are pending suggestions a
 * person reviews (owner Q4: best guesses never auto-accept).
 * Owner Q6 (Batch API) is OPEN: live calls only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { isAiConfigured } from "@/lib/ai/provider";
import { friendlyAiError } from "@/lib/ai/chat-payload-core";
import { getItemBySourceKey, getPublishedVersion } from "@/lib/pos/menu-version";
import { draftAllFieldsForProduct, type DraftItem } from "@/lib/enrichment/ai-draft-v2-server";
import {
  BULK_AI_V2_AUDIT,
  BULK_AI_V2_BUDGET_MS,
  BULK_AI_V2_KEY,
  BULK_AI_V2_LABEL,
  bulkCounts,
  bulkDecision,
  bulkRunNote,
  canStartAnother,
  cancelBulk,
  claimBulkItem,
  enqueueBulk,
  finishBulkItem,
  nextBulkItem,
  parseBulkAiV2,
  releaseBulkLease,
  takeBulkLease,
  type BulkAiV2State,
  type BulkDecision,
  type QueueRequest,
} from "@/lib/enrichment/bulk-ai-v2-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const CAS_TRIES = 4;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 200);

type Snapshot = { state: BulkAiV2State; updatedAt: string | null };

/** The saved queue (a missing row = empty). A failed read throws: never "nothing to do". */
export async function readBulkAiV2(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", BULK_AI_V2_KEY).maybeSingle();
  if (error) throw new Error(`The background AI queue could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseBulkAiV2(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

/** Compare-and-swap: true = written; false = someone wrote first (re-read and decide again). */
async function casWrite(admin: Admin, snap: Snapshot, next: BulkAiV2State, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: BULK_AI_V2_KEY, label: BULK_AI_V2_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The background AI queue could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin
    .from("site_settings")
    .update({ value_json: next, updated_by: actorId })
    .eq("key", BULK_AI_V2_KEY)
    .eq("updated_at", snap.updatedAt)
    .select("key");
  if (error) throw new Error(`The background AI queue could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

/** read -> change -> CAS write, retried; `change` returning null = do not write. */
async function mutate<R>(
  admin: Admin,
  actorId: string | null,
  change: (s: BulkAiV2State) => { next: BulkAiV2State; out: R } | null,
): Promise<R | null> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readBulkAiV2(admin);
    const r = change(snap.state);
    if (!r) return null;
    if (await casWrite(admin, snap, r.next, actorId)) return r.out;
  }
  throw new Error("The background AI queue kept changing while it was being saved. Try again.");
}

export type QueueOutcome = { added: number; already: number; capped: boolean };

/** Queue products for a background all-fields draft. Throws with a plain reason. */
export async function queueBulkAiV2(reqs: QueueRequest[], actorId: string | null, deps: { admin?: Admin; nowIso?: string } = {}): Promise<QueueOutcome> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const out = await mutate(admin, actorId, (cur) => {
    const r = enqueueBulk(cur, reqs, actorId, nowIso);
    return r.added === 0 ? { next: cur, out: { added: 0, already: r.already, capped: r.capped } } : { next: r.state, out: { added: r.added, already: r.already, capped: r.capped } };
  });
  const res = out ?? { added: 0, already: 0, capped: false };
  await recordAudit({ actorId, action: BULK_AI_V2_AUDIT.queued, entityType: "product", entityId: null, after: { ...res, requested: reqs.length, keys: reqs.slice(0, 300).map((r) => r.key) } }).catch(() => {});
  return res;
}

/** Cancel every queued product (one already drafting finishes). */
export async function cancelBulkAiV2(actorId: string | null, deps: { admin?: Admin } = {}): Promise<number> {
  const admin = deps.admin ?? createSupabaseAdminClient();
  const n = (await mutate(admin, actorId, (cur) => {
    const r = cancelBulk(cur);
    return { next: r.state, out: r.canceled };
  })) ?? 0;
  await recordAudit({ actorId, action: BULK_AI_V2_AUDIT.canceled, entityType: "product", entityId: null, after: { canceled: n } }).catch(() => {});
  return n;
}

export type BulkAiV2Status = { ok: true; state: BulkAiV2State } | { ok: false; error: string };

/** For the page. Never throws: a failed read says so. */
export async function loadBulkAiV2Status(deps: { admin?: Admin } = {}): Promise<BulkAiV2Status> {
  if (!deps.admin && !isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    return { ok: true, state: (await readBulkAiV2(admin)).state };
  } catch (err) {
    return { ok: false, error: short(err) };
  }
}

export type DraftOne = (key: string, actorId: string | null) => Promise<{ saved: number }>;

/** The real per-product draft: the live menu row, then E-4's all-fields call. */
async function draftFromMenu(key: string, actorId: string | null): Promise<{ saved: number }> {
  const published = await getPublishedVersion();
  if (!published) throw new Error("There is no live menu, so this product's facts could not be read.");
  const row = await getItemBySourceKey(published.id, key);
  if (!row) throw new Error("This product is not on the live menu any more.");
  const item: DraftItem = {
    name: row.name,
    product_name: row.product_name,
    brand_name: row.brand_name,
    vendor_name: row.vendor_name,
    category: row.category,
    strain_type: row.strain_type,
    strain_name: row.strain_name,
    thc: row.thc,
    cbd: row.cbd,
  };
  const out = await draftAllFieldsForProduct(key, item, actorId);
  if (out.saved.length === 0) throw new Error("The AI reply had nothing usable for any field.");
  return { saved: out.saved.length };
}

export type BulkAiV2RunResult =
  | { ok: true; skipped: BulkDecision | "not_configured"; note: string; drafted?: undefined }
  | { ok: true; skipped?: undefined; drafted: number; failed: number; left: number; note: string }
  | { ok: false; error: string };

/**
 * One worker run. Never throws: a broken run returns { ok: false } with the
 * reason; a product that fails keeps its own reason on its row.
 */
export async function runBulkAiV2(
  opts: {
    budgetMs?: number;
    actorId?: string | null;
    trigger?: "worker" | "press";
    admin?: Admin;
    now?: () => number;
    token?: string;
    draftOne?: DraftOne;
  } = {},
): Promise<BulkAiV2RunResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? BULK_AI_V2_BUDGET_MS;
  const actorId = opts.actorId ?? null;
  const token = opts.token ?? crypto.randomUUID();
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 1. Decide, then take the lease (CAS). An idle queue costs one read.
  try {
    const snap = await readBulkAiV2(admin);
    const d = bulkDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "leased" ? "Another run is drafting right now." : "Nothing is queued." };
    if (!opts.draftOne && !isAiConfigured) return { ok: true, skipped: "not_configured", note: "AI is not configured (AI_API_KEY)." };
    if (!(await casWrite(admin, snap, takeBulkLease(snap.state, token, t0, budget), actorId))) {
      return { ok: true, skipped: "leased", note: "Another run is drafting right now." };
    }
  } catch (err) {
    return { ok: false, error: short(err) };
  }

  // 2. Draft one product at a time while the budget allows.
  const draftOne = opts.draftOne ?? draftFromMenu;
  let drafted = 0;
  let failed = 0;
  let ran = 0;
  let stoppedBecause: string | null = null;
  const tried = new Set<string>();
  try {
    while (canStartAnother(t0, now(), ran, budget)) {
      const key = await mutate(admin, actorId, (cur) => {
        const it = nextBulkItem(cur, tried);
        if (!it) return null;
        const next = claimBulkItem(cur, it.key, token);
        return next ? { next, out: it.key } : null;
      });
      if (!key) break; // queue empty, canceled, or the lease was lost
      ran += 1;
      tried.add(key);
      let outcome: { ok: true; saved: number } | { ok: false; error: string };
      try {
        const r = await draftOne(key, actorId);
        outcome = { ok: true, saved: r.saved };
        drafted += 1;
      } catch (err) {
        outcome = { ok: false, error: friendlyAiError(err) };
        failed += 1;
      }
      await mutate(admin, actorId, (cur) => ({ next: finishBulkItem(cur, key, outcome), out: true }));
    }
  } catch (err) {
    stoppedBecause = short(err);
  }

  // 3. Release the lease with a note for the page; audit the run.
  let left = 0;
  try {
    const snap = await readBulkAiV2(admin);
    const c = bulkCounts(snap.state);
    left = c.queued + c.running;
    const note = bulkRunNote({ drafted, failed, left, stoppedBecause });
    await mutate(admin, actorId, (cur) => ({ next: releaseBulkLease(cur, token, new Date(now()).toISOString(), note), out: true }));
  } catch (err) {
    stoppedBecause = stoppedBecause ?? short(err);
  }
  const note = bulkRunNote({ drafted, failed, left, stoppedBecause });
  if (ran > 0) {
    await recordAudit({ actorId, action: BULK_AI_V2_AUDIT.ran, entityType: "product", entityId: null, after: { trigger: opts.trigger ?? "worker", drafted, failed, left, stoppedBecause } }).catch(() => {});
  }
  if (stoppedBecause && ran === 0) return { ok: false, error: stoppedBecause };
  return { ok: true, drafted, failed, left, note };
}

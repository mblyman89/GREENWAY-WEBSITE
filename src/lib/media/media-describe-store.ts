/**
 * src/lib/media/media-describe-store.ts   (D221 M4)
 *
 * The server side of the "closer look" describe + SEO pass. The owner presses
 * Start on /admin/media (with a dollar budget); that only writes a row in
 * media_ai_runs (0352 + 0353 lease columns). The cron route
 * /api/cron/media-describe does the work every 10 minutes, on the server, so it
 * keeps going after the tab is closed.
 *
 * A tick is a request to consider working, never a lock:
 *   - an idle tick (no running run) is ONE indexed read and writes nothing;
 *   - the lease is taken by compare-and-set on lease_token (free or expired);
 *     DESCRIBE_LEASE_MS outlives the route's maxDuration, so a live tick is
 *     never overtaken and a killed tick's lease simply expires;
 *   - counters, cost and the cursor are saved after every page under the same
 *     compare-and-set, so a lost lease writes nothing more;
 *   - only rows still ai_status = 'pending' are picked, so a re-run never
 *     re-bills a described picture (idempotent);
 *   - the run stops BEFORE the call that could cross its budget, and pauses
 *     when the monthly AI budget (router.ts) is reached;
 *   - "follow new" keeps the run open after the backlog, so every picture
 *     saved from a menu is described within one tick of its save.
 *
 * Rule 15: every {error} is read, explicit selects, pages of DESCRIBE_PAGE.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generateVisionJson, isAiConfigured, AiNotConfiguredError } from "@/lib/ai/provider";
import { getBudgetStatus } from "@/lib/ai/router";
import { lintCopy } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import {
  DESCRIBE_CALL_RESERVE_MS,
  DESCRIBE_CONCURRENCY,
  DESCRIBE_LEASE_MS,
  DESCRIBE_PAGE,
  DESCRIBE_SYSTEM,
  DESCRIBE_TICK_MS,
  MEDIA_AI_DEFAULT_DETAIL,
  MEDIA_AI_DEFAULT_MODEL,
  budgetVerdict,
  buildDescribePrompt,
  callCostUsd,
  describeEligibility,
  describeLeaseVerdict,
  describePatch,
  factsFor,
  parseDescribeResponse,
  type DescribeRow,
  type LintFn,
} from "./media-describe-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const short = (e: { message?: string } | null | undefined) => (e?.message ?? "unknown error").slice(0, 300);

export function mediaAiModel(): string {
  return (process.env.MEDIA_AI_MODEL ?? "").trim() || MEDIA_AI_DEFAULT_MODEL;
}
export function mediaAiDetail(): "low" | "high" | "auto" {
  const d = (process.env.MEDIA_AI_DETAIL ?? "").trim().toLowerCase();
  return d === "low" || d === "auto" ? d : MEDIA_AI_DEFAULT_DETAIL;
}

export type DescribeRun = {
  id: string;
  kind: string;
  status: "queued" | "running" | "paused" | "done" | "failed" | "cancelled";
  model: string | null;
  detail: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  cost_usd: number;
  budget_usd: number | null;
  cursor_id: string | null;
  last_error: string | null;
  started_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  lease_token: string | null;
  lease_until: string | null;
  follow_new: boolean;
  input_tokens: number;
  output_tokens: number;
  last_tick_at: string | null;
  created_at: string;
};

const RUN_COLS =
  "id,kind,status,model,detail,total,done,failed,skipped,cost_usd,budget_usd,cursor_id,last_error,started_by,started_at,finished_at,lease_token,lease_until,follow_new,input_tokens,output_tokens,last_tick_at,created_at";

const ROW_COLS =
  "id,mime_type,status,public_url,title,filename,alt_text,tags,usage_type,platform,role,category,product_name,strain_name,pack_size,vendor_id,brand_id,review_state,review_note,ai_description,ai_caption,visible_text,ai_tags,colors,background,orientation,quality_score,seo_title,seo_alt,seo_description,seo_slug,seo_keywords,width,height,field_provenance";

function normRun(r: Record<string, unknown>): DescribeRun {
  return {
    ...(r as unknown as DescribeRun),
    cost_usd: Number(r.cost_usd ?? 0),
    budget_usd: r.budget_usd === null || r.budget_usd === undefined ? null : Number(r.budget_usd),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
  };
}

/** The newest run that is queued / running / paused, or null. */
export async function readOpenRun(admin: Admin): Promise<{ ok: true; run: DescribeRun | null } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("media_ai_runs")
    .select(RUN_COLS)
    .in("status", ["queued", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, error: short(error) };
  const r = (data as Record<string, unknown>[] | null)?.[0];
  return { ok: true, run: r ? normRun(r) : null };
}

export async function readLastRun(admin: Admin): Promise<DescribeRun | null> {
  const { data, error } = await admin.from("media_ai_runs").select(RUN_COLS).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  const r = (data as Record<string, unknown>[] | null)?.[0];
  return r ? normRun(r) : null;
}

async function countPending(admin: Admin): Promise<{ n: number; error: string | null }> {
  const { count, error } = await admin
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("ai_status", "pending")
    .neq("status", "archived");
  if (error) return { n: 0, error: short(error) };
  return { n: count ?? 0, error: null };
}

export type StartResult = { ok: boolean; error: string | null; run: DescribeRun | null };

/** Start a run (the button). Refuses when one is already open. */
export async function startDescribeRun(input: { budgetUsd: number | null; followNew: boolean; startedBy: string | null }): Promise<StartResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured on this deployment.", run: null };
  if (!isAiConfigured) return { ok: false, error: "AI is not configured (set OPENAI_API_KEY on Vercel).", run: null };
  const admin = createSupabaseAdminClient();
  const open = await readOpenRun(admin);
  if (!open.ok) return { ok: false, error: open.error, run: null };
  if (open.run) return { ok: false, error: "A run is already open - resume or stop it first.", run: open.run };
  const pending = await countPending(admin);
  if (pending.error) return { ok: false, error: pending.error, run: null };
  const { data, error } = await admin
    .from("media_ai_runs")
    .insert({
      kind: "full",
      status: "running",
      model: mediaAiModel(),
      detail: mediaAiDetail(),
      total: pending.n,
      budget_usd: input.budgetUsd,
      follow_new: input.followNew,
      started_by: input.startedBy,
      started_at: new Date().toISOString(),
      scope: { ai_status: "pending" },
    })
    .select(RUN_COLS)
    .single();
  if (error || !data) return { ok: false, error: short(error), run: null };
  return { ok: true, error: null, run: normRun(data as Record<string, unknown>) };
}

/** Pause / resume / stop. Clears the lease so the next tick starts clean. */
export async function setDescribeRunStatus(id: string, status: "running" | "paused" | "cancelled", patch: { budgetUsd?: number | null } = {}): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured on this deployment." };
  const admin = createSupabaseAdminClient();
  const row: Record<string, unknown> = { status, lease_token: null, lease_until: null };
  if (status === "cancelled") row.finished_at = new Date().toISOString();
  if (status === "running") row.last_error = null;
  if (patch.budgetUsd !== undefined) row.budget_usd = patch.budgetUsd;
  const { data, error } = await admin
    .from("media_ai_runs")
    .update(row)
    .eq("id", id)
    .in("status", ["queued", "running", "paused"])
    .select("id");
  if (error) return { ok: false, error: short(error) };
  if (((data as unknown[] | null) ?? []).length !== 1) return { ok: false, error: "That run is already finished." };
  return { ok: true, error: null };
}

/** Put failed pictures back in the queue (the "Retry failed" button). */
export async function retryFailedDescribes(): Promise<{ ok: boolean; error: string | null; n: number }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured on this deployment.", n: 0 };
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("media_assets")
    .update({ ai_status: "pending", ai_error: null }, { count: "exact" })
    .eq("ai_status", "failed")
    .neq("status", "archived");
  if (error) return { ok: false, error: short(error), n: 0 };
  return { ok: true, error: null, n: count ?? 0 };
}

/** Compare-and-set write on the run while we hold the lease. */
async function casRun(admin: Admin, id: string, token: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await admin.from("media_ai_runs").update(patch).eq("id", id).eq("lease_token", token).select("id");
  if (error) return { ok: false, error: short(error) };
  return { ok: ((data as unknown[] | null) ?? []).length === 1, error: null };
}

type Ctx = {
  admin: Admin;
  model: string;
  detail: "low" | "high" | "auto";
  lint: LintFn;
  vendorNames: Map<string, { name: string | null; brands: string[] }>;
};

async function vendorFacts(ctx: Ctx, vendorId: string | null | undefined): Promise<{ name: string | null; brands: string[] }> {
  if (!vendorId) return { name: null, brands: [] };
  const hit = ctx.vendorNames.get(vendorId);
  if (hit) return hit;
  const [v, b] = await Promise.all([
    ctx.admin.from("vendors").select("display_name").eq("id", vendorId).maybeSingle(),
    ctx.admin.from("brands").select("display_name").eq("vendor_id", vendorId).order("display_name").range(0, 49),
  ]);
  const facts = {
    name: v.error ? null : ((v.data as { display_name?: string } | null)?.display_name ?? null),
    brands: b.error ? [] : ((b.data as { display_name: string }[] | null) ?? []).map((x) => x.display_name),
  };
  ctx.vendorNames.set(vendorId, facts);
  return facts;
}

export type DescribeOneOutcome =
  | { kind: "done"; costUsd: number; inTok: number; outTok: number; review: boolean }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string; costUsd: number }
  | { kind: "transient"; error: string }
  | { kind: "fatal"; error: string };

/** Transient = try the same picture again later (rate limit, outage, timeout). */
function isTransient(msg: string): boolean {
  return /HTTP (408|409|429|5\d\d)\b|abort|timed? ?out|ECONNRESET|fetch failed/i.test(msg);
}

/** Describe ONE row and write the result. Never throws. */
async function describeOne(ctx: Ctx, row: DescribeRow & { brand_id?: string | null }): Promise<DescribeOneOutcome> {
  const elig = describeEligibility(row);
  if (elig !== "describe") {
    const reason = elig === "skip-type" ? `Not a picture the AI reads (${row.mime_type ?? "unknown type"}).` : elig === "skip-no-url" ? "No public address for the file." : "Archived copy.";
    const { error } = await ctx.admin.from("media_assets").update({ ai_status: "skipped", ai_error: reason }).eq("id", row.id).eq("ai_status", "pending");
    if (error) return { kind: "failed", error: short(error), costUsd: 0 };
    return { kind: "skipped", reason };
  }
  const vf = await vendorFacts(ctx, row.vendor_id);
  const facts = factsFor(row, vf.name, vf.brands);
  let content = "";
  let costUsd = 0;
  let inTok = 0;
  let outTok = 0;
  try {
    const res = await generateVisionJson({
      system: DESCRIBE_SYSTEM,
      user: buildDescribePrompt(facts),
      imageUrl: String(row.public_url),
      model: ctx.model,
      detail: ctx.detail,
      maxTokens: 1600,
      context: { feature: "media.describe", entityType: "media_asset", entityId: row.id },
    });
    content = res.content;
    inTok = res.usage.promptTokens;
    outTok = res.usage.completionTokens;
    costUsd = callCostUsd(res.usage);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof AiNotConfiguredError) return { kind: "fatal", error: msg };
    if (/HTTP (401|403)\b|model.*(not found|does not exist)|HTTP 404/i.test(msg)) return { kind: "fatal", error: msg.slice(0, 300) };
    if (isTransient(msg)) return { kind: "transient", error: msg.slice(0, 300) };
    const { error } = await ctx.admin.from("media_assets").update({ ai_status: "failed", ai_error: msg.slice(0, 300) }).eq("id", row.id);
    if (error) console.warn(`[media/describe] could not mark ${row.id} failed: ${short(error)}`);
    return { kind: "failed", error: msg.slice(0, 300), costUsd: 0 };
  }
  const parsed = parseDescribeResponse(content);
  if (!parsed.ok) {
    const { error } = await ctx.admin.from("media_assets").update({ ai_status: "failed", ai_error: parsed.error }).eq("id", row.id);
    if (error) console.warn(`[media/describe] could not mark ${row.id} failed: ${short(error)}`);
    return { kind: "failed", error: parsed.error, costUsd };
  }
  const result = describePatch(row, parsed.out, { model: ctx.model, nowIso: new Date().toISOString(), lint: ctx.lint, vendorKnown: Boolean(row.vendor_id) });
  const { error } = await ctx.admin.from("media_assets").update(result.patch).eq("id", row.id);
  if (error) {
    console.warn(`[media/describe] result not written for ${row.id}: ${short(error)}`);
    return { kind: "failed", error: short(error), costUsd };
  }
  return { kind: "done", costUsd, inTok, outTok, review: Boolean(result.reviewNote) };
}

async function makeCtx(admin: Admin, model: string, detail: "low" | "high" | "auto"): Promise<Ctx> {
  const extra = await loadBannedPhrases();
  return {
    admin,
    model,
    detail,
    lint: (t: string) => lintCopy(t, extra).disposition,
    vendorNames: new Map(),
  };
}

/** The per-picture button: describe one asset now, outside any run. */
export async function describeAssetNow(id: string): Promise<{ ok: boolean; error: string | null; review: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured on this deployment.", review: false };
  if (!isAiConfigured) return { ok: false, error: "AI is not configured (set OPENAI_API_KEY on Vercel).", review: false };
  const budget = await getBudgetStatus();
  if (budget.blocked) return { ok: false, error: budget.reason ?? "The monthly AI budget is used up.", review: false };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("media_assets").select(ROW_COLS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: short(error), review: false };
  if (!data) return { ok: false, error: "That picture no longer exists.", review: false };
  // A person asked for it: describe even if it was done before (AI values may be refreshed; human ones never).
  const row = data as unknown as DescribeRow;
  const { error: e2 } = await admin.from("media_assets").update({ ai_status: "pending" }).eq("id", id);
  if (e2) return { ok: false, error: short(e2), review: false };
  const out = await describeOne(await makeCtx(admin, mediaAiModel(), mediaAiDetail()), { ...row, status: row.status });
  if (out.kind === "done") return { ok: true, error: null, review: out.review };
  if (out.kind === "skipped") return { ok: false, error: out.reason, review: false };
  if (out.kind === "transient") {
    await admin.from("media_assets").update({ ai_status: "pending" }).eq("id", id);
  }
  return { ok: false, error: out.error, review: false };
}

export type TickResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  runId?: string;
  described?: number;
  failed?: number;
  skippedRows?: number;
  costUsd?: number;
  error?: string;
};

/** One cron tick. An idle tick is ONE read. */
export async function tickDescribe(nowMs: number = Date.now()): Promise<TickResult> {
  if (!isSupabaseServiceConfigured) return { ok: true, skipped: true, reason: "database not configured" };
  const admin = createSupabaseAdminClient();
  const { data: openRows, error: openErr } = await admin
    .from("media_ai_runs")
    .select(RUN_COLS)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1);
  if (openErr) return { ok: false, skipped: true, error: short(openErr) };
  const raw = (openRows as Record<string, unknown>[] | null)?.[0];
  const run = raw ? normRun(raw) : null;
  const verdict = describeLeaseVerdict(run, nowMs);
  if (verdict !== "take" || !run) return { ok: true, skipped: true, reason: verdict };

  // Take the lease: free or expired, by compare-and-set.
  const token = randomUUID();
  const leaseUntil = new Date(nowMs + DESCRIBE_LEASE_MS).toISOString();
  const take = await admin
    .from("media_ai_runs")
    .update({ lease_token: token, lease_until: leaseUntil, last_tick_at: new Date(nowMs).toISOString() })
    .eq("id", run.id)
    .eq("status", "running")
    .or(`lease_token.is.null,lease_until.lt.${new Date(nowMs).toISOString()}`)
    .select("id");
  if (take.error) return { ok: false, skipped: true, runId: run.id, error: short(take.error) };
  if (((take.data as unknown[] | null) ?? []).length !== 1) return { ok: true, skipped: true, reason: "leased", runId: run.id };

  if (!isAiConfigured) {
    await casRun(admin, run.id, token, { status: "paused", lease_token: null, lease_until: null, last_error: "AI is not configured (set OPENAI_API_KEY on Vercel)." });
    return { ok: false, skipped: false, runId: run.id, error: "AI not configured" };
  }

  const model = run.model || mediaAiModel();
  const detail = run.detail === "low" || run.detail === "auto" ? run.detail : "high";
  const ctx = await makeCtx(admin, model, detail);
  const deadline = nowMs + DESCRIBE_TICK_MS;

  let cost = run.cost_usd;
  let done = run.done;
  let failed = run.failed;
  let skipped = run.skipped;
  let inTok = run.input_tokens;
  let outTok = run.output_tokens;
  let cursor = run.cursor_id;
  let tickDescribed = 0;
  let tickFailed = 0;
  let tickSkipped = 0;
  let stopWith: { status: "paused" | "done"; note: string | null } | null = null;
  let transientInARow = 0;

  outer: while (Date.now() + DESCRIBE_CALL_RESERVE_MS < deadline) {
    const budget = await getBudgetStatus();
    if (budget.blocked) {
      stopWith = { status: "paused", note: budget.reason ?? "The monthly AI budget is used up." };
      break;
    }
    let q = admin.from("media_assets").select(ROW_COLS).eq("ai_status", "pending").neq("status", "archived").order("id", { ascending: true });
    if (cursor) q = q.gt("id", cursor);
    const { data: page, error: pageErr } = await q.range(0, DESCRIBE_PAGE - 1);
    if (pageErr) {
      await casRun(admin, run.id, token, { last_error: short(pageErr), lease_token: null, lease_until: null });
      return { ok: false, skipped: false, runId: run.id, error: short(pageErr) };
    }
    const rows = (page as unknown as DescribeRow[] | null) ?? [];
    if (rows.length === 0) {
      if (cursor) {
        // End of a pass; anything left pending (a transient miss, a new save) is picked up next pass.
        cursor = null;
        break;
      }
      if (!run.follow_new) stopWith = { status: "done", note: null };
      break;
    }

    for (let i = 0; i < rows.length; i += DESCRIBE_CONCURRENCY) {
      if (Date.now() + DESCRIBE_CALL_RESERVE_MS >= deadline) break outer;
      const batch = rows.slice(i, i + DESCRIBE_CONCURRENCY);
      if (budgetVerdict(cost, run.budget_usd, 0.005 * batch.length) === "stop") {
        stopWith = { status: "paused", note: `Budget of $${(run.budget_usd ?? 0).toFixed(2)} reached - raise it and press Resume to keep going.` };
        break outer;
      }
      const outs = await Promise.all(batch.map((r) => describeOne(ctx, r)));
      let fatal: string | null = null;
      for (const o of outs) {
        if (o.kind === "done") {
          done += 1;
          tickDescribed += 1;
          cost += o.costUsd;
          inTok += o.inTok;
          outTok += o.outTok;
          transientInARow = 0;
        } else if (o.kind === "skipped") {
          skipped += 1;
          tickSkipped += 1;
        } else if (o.kind === "failed") {
          failed += 1;
          tickFailed += 1;
          cost += o.costUsd;
        } else if (o.kind === "transient") {
          transientInARow += 1;
        } else {
          fatal = o.error;
        }
      }
      cursor = batch[batch.length - 1].id;
      const saved = await casRun(admin, run.id, token, {
        done, failed, skipped, cost_usd: Math.round(cost * 10000) / 10000, input_tokens: inTok, output_tokens: outTok, cursor_id: cursor,
        last_tick_at: new Date().toISOString(),
      });
      if (!saved.ok) return { ok: !saved.error, skipped: false, runId: run.id, error: saved.error ?? "lease lost" };
      if (fatal) {
        stopWith = { status: "paused", note: `Stopped: ${fatal}` };
        break outer;
      }
      if (transientInARow >= 6) {
        // The AI service is struggling; leave the rest pending and try next tick.
        await casRun(admin, run.id, token, { last_error: "The AI service is busy or down - trying again in 10 minutes." });
        break outer;
      }
    }
  }

  const end: Record<string, unknown> = { lease_token: null, lease_until: null, cursor_id: cursor, last_tick_at: new Date().toISOString() };
  if (stopWith) {
    end.status = stopWith.status;
    if (stopWith.note) end.last_error = stopWith.note;
    if (stopWith.status === "done") end.finished_at = new Date().toISOString();
  }
  const fin = await casRun(admin, run.id, token, end);
  return {
    ok: fin.ok,
    skipped: false,
    runId: run.id,
    described: tickDescribed,
    failed: tickFailed,
    skippedRows: tickSkipped,
    costUsd: Math.round((cost - run.cost_usd) * 10000) / 10000,
    error: fin.error ?? undefined,
  };
}

export type DescribePanel = {
  ok: boolean;
  error: string | null;
  health: Record<string, number> | null;
  open: DescribeRun | null;
  last: DescribeRun | null;
  model: string;
  detail: string;
  aiConfigured: boolean;
};

/** Everything the /admin/media AI panel shows. */
export async function loadDescribePanel(): Promise<DescribePanel> {
  const base: DescribePanel = { ok: false, error: null, health: null, open: null, last: null, model: mediaAiModel(), detail: mediaAiDetail(), aiConfigured: isAiConfigured };
  if (!isSupabaseServiceConfigured) return { ...base, error: "The database isn't configured on this deployment." };
  const admin = createSupabaseAdminClient();
  const [h, open, last] = await Promise.all([admin.rpc("media_library_health"), readOpenRun(admin), readLastRun(admin)]);
  if (h.error) return { ...base, error: short(h.error) };
  return {
    ...base,
    ok: true,
    health: (h.data as Record<string, number> | null) ?? null,
    open: open.ok ? open.run : null,
    last,
    error: open.ok ? null : open.error,
  };
}

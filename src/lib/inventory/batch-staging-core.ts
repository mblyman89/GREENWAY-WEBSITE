/**
 * src/lib/inventory/batch-staging-core.ts  (S17 - one menu version per approve batch)
 *
 * PURE. No Supabase, no fs, no network, no clock (callers pass the time).
 *
 * WHY (bible S17, findings F-039, F-062)
 *   Every Approve click re-read every approved draft of the delivery and
 *   inserted a NEW full-snapshot menu_versions row. Approving a 30-line
 *   delivery one row at a time made 30 versions, and whenever the snapshot
 *   was held (fact review) or the publish failed, the held copies piled up on
 *   the Publish page (F-062).
 *
 * WHAT THIS SLICE DOES (bible S17.2, three bullets, in order)
 *   1. "Approve all priced": one server action approves every priced draft of
 *      one delivery (each still passes EVERY server gate) and stages ONCE.
 *      Rows a gate refuses are skipped and reported, never forced.
 *   2. Single approves keep immediate staging (the owner's "live now"), but
 *      coalesce: when this delivery already has an UNPUBLISHED receiving
 *      update created less than BATCH_DEBOUNCE_MS earlier, the new snapshot
 *      REPLACES it (the older row is archived with a reason) instead of
 *      piling up next to it.
 *   3. Version notes count the batch.
 *
 * DEBOUNCE WITHOUT A TIMER (the S17.8 risk: "Debounce window must not swallow
 * an approve - always ensure the last approve triggers a staging.")
 *   A classic debounce waits for quiet and then runs once with the LAST call's
 *   arguments (lodash: "delays invoking func until after wait milliseconds
 *   have elapsed since the last time the debounced function was invoked").
 *   A serverless request cannot wait, and the standing rules forbid new
 *   crons/polls, so the same trailing-edge outcome is reached the other way
 *   round: EVERY approve stages (nothing is ever skipped), and the newest
 *   snapshot retires the recent unpublished one it supersedes. The survivor
 *   is always the last call's version, exactly the trailing-edge semantics,
 *   and no approve can be lost because the old row is only archived AFTER the
 *   new one (items included) is safely written.
 *
 * Why the replacement is safe: both rows are built by the same planner from
 * (live menu + every approved draft of the delivery). The newer row is built
 * from a live menu at least as new and a superset of approved drafts, so it
 * contains everything the older unpublished one would have published.
 */
import { mergeArchivedSummary } from "@/lib/pos/publish-archive-rule-core";

// ---------------------------------------------------------------------------
// 1. Rollback switch (bible S17.7 "Flag.")
// ---------------------------------------------------------------------------

/** Environment variable for the S17 rollback plan. */
export const BATCH_STAGING_ENV = "INTAKE_BATCH_STAGING";

/**
 * ON by default. Only an explicit off-word turns it off (same rule as the
 * S05 switch): off, 0, false, no, disabled - case and space insensitive.
 * Off = pre-S17 behaviour: no batch button, no replacement.
 */
export function batchStagingEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// ---------------------------------------------------------------------------
// 2. Coalescing (single approves)
// ---------------------------------------------------------------------------

/** bible S17.2: "if a staging for the same manifest ran < 20s ago". */
export const BATCH_DEBOUNCE_MS = 20_000;

/** summary_json.archived_reason prefix for a replaced (never-published) row. */
export const REPLACED_REASON_PREFIX = "replaced_by_restage:";

export type RestageCandidate = {
  id: string;
  status: string | null;
  created_at: string | null;
  import_id?: string | null;
  summary_json?: unknown;
};

function manifestOf(summary: unknown): string | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const s = summary as Record<string, unknown>;
  if (s.origin !== "intake") return null;
  return typeof s.manifest_id === "string" ? s.manifest_id.toLowerCase() : null;
}

/**
 * summary_json.approved_draft_ids as recorded at insert (S17), or null when
 * the row predates S17 / the value is malformed (never guessed).
 */
export function recordedDraftIds(summary: unknown): string[] | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const ids = (summary as Record<string, unknown>).approved_draft_ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string" && x.length > 0)) return null;
  return ids as string[];
}

/** Sorted, de-duplicated draft ids for summary_json.approved_draft_ids. */
export function draftIdList(ids: readonly (string | null | undefined)[] | null | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))).sort();
}

/**
 * Which recent unpublished receiving updates the fresh snapshot replaces.
 * A candidate is replaced only when ALL hold:
 *   - it is not the fresh row, is still status "staged", has no import_id
 *     (a Cultivera upload is NEVER coalesced away);
 *   - it is an intake row of the SAME delivery (summary_json.origin +
 *     manifest_id, re-checked here even though the query filters on it);
 *   - it was created strictly BEFORE the fresh row and less than windowMs
 *     earlier (both timestamps must parse; an unparseable one is kept);
 *   - PROOF OF SUPERSET: every approved draft it recorded is also in the
 *     fresh row. Two approves racing each other can build the "newer" row
 *     from a read that missed the other click; this check keeps that row
 *     instead of archiving the only copy of a product. A row with no
 *     recorded list (pre-S17) is kept.
 */
export function planRestageReplace(
  fresh: { id: string; created_at: string | null; manifest_id: string; draft_ids: readonly string[] },
  candidates: readonly RestageCandidate[] | null | undefined,
  windowMs: number = BATCH_DEBOUNCE_MS,
): string[] {
  const freshAt = Date.parse(String(fresh.created_at ?? ""));
  // No separate guards: a NaN fresh time, a NaN candidate time or a
  // non-positive/NaN window all make `age > 0 && age < windowMs` false, so the
  // single age check below rejects every row (NaN comparisons are false).
  const manifest = fresh.manifest_id.toLowerCase();
  const freshIds = new Set(fresh.draft_ids);
  const out: string[] = [];
  for (const c of candidates ?? []) {
    if (!c || c.id === fresh.id || c.status !== "staged") continue;
    if (c.import_id !== null && c.import_id !== undefined) continue;
    if (manifestOf(c.summary_json) !== manifest) continue;
    const age = freshAt - Date.parse(String(c.created_at ?? ""));
    if (!(age > 0 && age < windowMs)) continue;
    const ids = recordedDraftIds(c.summary_json);
    if (ids === null || !ids.every((id) => freshIds.has(id))) continue;
    out.push(c.id);
  }
  return out;
}

/** The ISO lower bound for the candidate read (fresh.created_at - window). */
export function restageWindowStartIso(freshCreatedAt: string | null, windowMs: number = BATCH_DEBOUNCE_MS): string | null {
  const t = Date.parse(String(freshCreatedAt ?? ""));
  if (Number.isNaN(t)) return null;
  return new Date(t - windowMs).toISOString();
}

/** A replaced row's summary: the S15 archive shape with the replacement reason. */
export function replacedSummary(summary: unknown, freshId: string, archivedAtIso: string): Record<string, unknown> {
  return { ...mergeArchivedSummary(summary, freshId, archivedAtIso), archived_reason: REPLACED_REASON_PREFIX + freshId };
}

// ---------------------------------------------------------------------------
// 3. "Approve all priced" (batch)
// ---------------------------------------------------------------------------

/**
 * Most drafts one click approves. Each approval re-runs every server gate
 * (several reads), and the drafts page allows 300 s (maxDuration). At the
 * owner's 15-20 deliveries a week a delivery is far below this; a larger one
 * is approved in two clicks and says so (never silently truncated).
 */
export const BATCH_APPROVE_MAX = 100;

export type BatchDraftRow = { id?: unknown; status?: unknown; suggested_price_minor_units?: unknown };

/**
 * "Priced" = still in review AND the system has an automatic price
 * (suggested_price_minor_units, a positive whole number of cents). The
 * onboarding list uses the same test for its "Needs a price" chip
 * (onboarding-list-core rowAttention). Rows without one need a human price.
 */
export function isPricedDraft(r: BatchDraftRow | null | undefined): boolean {
  const p = r?.suggested_price_minor_units;
  return (
    r?.status === "draft" &&
    typeof r?.id === "string" &&
    r.id.length > 0 &&
    typeof p === "number" &&
    Number.isInteger(p) &&
    p > 0
  );
}

export type BatchPlan = {
  /** Up to `max` priced drafts, in input order, each with its price. */
  approve: { id: string; priceMinor: number }[];
  /** Priced drafts left for another click because of the cap. */
  overflow: number;
};

export function planBatchApprove(rows: readonly BatchDraftRow[] | null | undefined, max: number = BATCH_APPROVE_MAX): BatchPlan {
  const priced = (rows ?? []).filter(isPricedDraft);
  const cap = Math.max(0, Math.floor(max));
  return {
    approve: priced.slice(0, cap).map((r) => ({ id: r.id as string, priceMinor: r.suggested_price_minor_units as number })),
    overflow: Math.max(0, priced.length - cap),
  };
}

/** Priced-in-review count from the picker counts; null when counts are unknown (never guess). */
export function pricedInReview(counts: { inReview: number; needsPrice: number } | null | undefined): number | null {
  if (!counts) return null;
  const n = counts.inReview - counts.needsPrice;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** bible S17.4: "Approve all 9 priced". */
export function batchButtonLabel(n: number): string {
  return `Approve all ${n} priced`;
}

/** Plain help line under the button (what it will and will not do). */
export const BATCH_BUTTON_HELP =
  "Approves every product in this delivery that already has a price, at that price, then updates the menu once. Each one still passes every check; anything that needs your pick is left here for you.";

/** bible S17.2 "Version notes count the batch." Empty for a single approve. */
export function batchNotesSuffix(batchCount: number | null | undefined): string {
  const n = typeof batchCount === "number" && Number.isInteger(batchCount) ? batchCount : 0;
  return n > 1 ? ` Approved together as one batch of ${n} products.` : "";
}

/**
 * The batch loop, with its two side effects injected (the server passes
 * approveDraftWithPrice with skipStaging + stageIntakeMenuVersionForManifest).
 * Approvals run one after another (never in parallel: each one writes the
 * draft and reads the gates); the menu is staged exactly ONCE, afterwards,
 * and only when at least one approval succeeded. A thrown approval counts as
 * skipped; a thrown staging leaves versionId null (the approvals stand, and
 * the next approve or finalize stages them - nothing is lost).
 */
export async function runBatchApprove(
  plan: BatchPlan & { refused?: number },
  approve: (id: string, priceMinor: number) => Promise<{ ok: boolean; error?: string }>,
  stage: (batchCount: number) => Promise<{ versionId: string | null }>,
): Promise<{ result: BatchResult; versionId: string | null; stagedCalls: number }> {
  let approved = 0;
  let skipped = Math.max(0, plan.refused ?? 0);
  let why: string | null = null;
  for (const d of plan.approve) {
    let r: { ok: boolean; error?: string };
    try {
      r = await approve(d.id, d.priceMinor);
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (r.ok) approved += 1;
    else {
      skipped += 1;
      why = why ?? (r.error || null);
    }
  }
  let versionId: string | null = null;
  let stagedCalls = 0;
  if (approved > 0) {
    stagedCalls = 1;
    try {
      versionId = (await stage(approved)).versionId ?? null;
    } catch {
      versionId = null;
    }
  }
  return { result: { approved, skipped, overflow: plan.overflow, why }, versionId, stagedCalls };
}

// ---------------------------------------------------------------------------
// 4. Result feedback (NN/g bulk actions: "give users clear feedback")
// ---------------------------------------------------------------------------

export type BatchResult = { approved: number; skipped: number; overflow: number; why: string | null };

/** Longest first-refusal message carried in the redirect URL. */
export const BATCH_WHY_MAX = 160;

function count(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,4}$/.test(v)) return null;
  return Number(v);
}

/** The redirect params for a finished batch. */
export function batchResultParams(r: BatchResult): Record<string, string> {
  const out: Record<string, string> = {
    batch_ok: String(Math.max(0, r.approved)),
    batch_skip: String(Math.max(0, r.skipped)),
  };
  if (r.overflow > 0) out.batch_more = String(r.overflow);
  const why = (r.why ?? "").replace(/\s+/g, " ").trim();
  if (why) out.batch_why = why.slice(0, BATCH_WHY_MAX);
  return out;
}

/** Parse the redirect params back; null when this was not a batch redirect. */
export function parseBatchResult(sp: { batch_ok?: unknown; batch_skip?: unknown; batch_more?: unknown; batch_why?: unknown }): BatchResult | null {
  const approved = count(sp.batch_ok);
  const skipped = count(sp.batch_skip);
  if (approved === null || skipped === null) return null;
  const why = typeof sp.batch_why === "string" ? sp.batch_why.replace(/\s+/g, " ").trim().slice(0, BATCH_WHY_MAX) : "";
  return { approved, skipped, overflow: count(sp.batch_more) ?? 0, why: why || null };
}

function products(n: number): string {
  return `${n} product${n === 1 ? "" : "s"}`;
}

/** The banner after a batch. */
export function batchResultCopy(r: BatchResult): string {
  const parts: string[] = [];
  if (r.approved > 0) {
    parts.push(`Approved ${products(r.approved)} together - the menu was updated once for all of them.`);
  } else {
    parts.push("Nothing was approved.");
  }
  if (r.skipped > 0) {
    parts.push(
      `${products(r.skipped)} still need${r.skipped === 1 ? "s" : ""} you and ${r.skipped === 1 ? "is" : "are"} still listed below${r.why ? ` (first reason: ${r.why})` : ""}.`,
    );
  }
  if (r.overflow > 0) {
    parts.push(`${r.overflow} more ${r.overflow === 1 ? "product is" : "products are"} priced - press the button again for the rest.`);
  }
  return parts.join(" ");
}

/** Timeline/audit copy when a delivery's batch finished. */
export function batchAuditAfter(manifestId: string, r: BatchResult, versionId: string | null): Record<string, unknown> {
  return { manifest_id: manifestId, approved: r.approved, skipped: r.skipped, overflow: r.overflow, version_id: versionId };
}

// ---------------------------------------------------------------------------
// Self-tests (pure runner + vitest pin the exact count)
// ---------------------------------------------------------------------------

export function __runBatchStagingTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: unknown, label: string) => {
    if (!cond) throw new Error(`batch-staging-core self-test failed: ${label}`);
    passed += 1;
  };
  const M = "11111111-1111-4111-8111-111111111111";
  const intake = (m = M) => ({ origin: "intake", manifest_id: m, approved_draft_ids: ["d1"] });
  const T0 = "2026-01-01T00:00:30.000Z";
  const fresh = { id: "new", created_at: T0, manifest_id: M, draft_ids: ["d1", "d2"] };

  // Flag.
  ok(batchStagingEnabled(undefined) && batchStagingEnabled("") && batchStagingEnabled("on"), "default on");
  for (const w of ["off", "0", "false", "no", "disabled", " OFF "]) ok(!batchStagingEnabled(w), `off-word ${w}`);
  ok(batchStagingEnabled("offf"), "typo keeps it on");

  // Planner.
  ok(BATCH_DEBOUNCE_MS === 20_000, "20 s window (bible S17.2)");
  const recent = { id: "a", status: "staged", created_at: "2026-01-01T00:00:15.000Z", import_id: null, summary_json: intake() };
  ok(planRestageReplace(fresh, [recent]).join() === "a", "recent unpublished same delivery replaced");
  ok(planRestageReplace(fresh, [{ ...recent, created_at: "2026-01-01T00:00:10.000Z" }]).length === 0, "exactly 20 s old kept (strict <)");
  ok(planRestageReplace(fresh, [{ ...recent, created_at: "2026-01-01T00:00:10.001Z" }]).length === 1, "19.999 s old replaced");
  ok(planRestageReplace(fresh, [{ ...recent, created_at: T0 }]).length === 0, "same instant kept (not older)");
  ok(planRestageReplace(fresh, [{ ...recent, created_at: "2026-01-01T00:00:31.000Z" }]).length === 0, "newer kept");
  ok(planRestageReplace(fresh, [{ ...recent, status: "published" }]).length === 0, "published never replaced");
  ok(planRestageReplace(fresh, [{ ...recent, import_id: "imp" }]).length === 0, "Cultivera upload never replaced");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: intake("22222222-2222-4222-8222-222222222222") }]).length === 0, "other delivery kept");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: { manifest_id: M, approved_draft_ids: ["d1"] } }]).length === 0, "non-intake origin kept");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: { ...intake(), approved_draft_ids: ["d1", "d3"] } }]).length === 0, "race: older row has a draft the fresh one lacks -> kept");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: { origin: "intake", manifest_id: M } }]).length === 0, "pre-S17 row (no list) kept");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: { ...intake(), approved_draft_ids: [] } }]).length === 1, "empty recorded list is a subset");
  ok(recordedDraftIds({ approved_draft_ids: ["a", 3] }) === null && recordedDraftIds([]) === null && recordedDraftIds(null) === null, "malformed list unknown");
  ok(draftIdList(["b", "a", "b", null, ""]).join() === "a,b" && draftIdList(null).length === 0, "id list sorted + deduped");
  ok(planRestageReplace(fresh, [{ ...recent, summary_json: intake(M.toUpperCase()) }]).length === 1, "manifest compared case-insensitively");
  ok(planRestageReplace(fresh, [{ ...recent, id: "new" }]).length === 0, "the fresh row is never replaced");
  ok(planRestageReplace(fresh, [{ ...recent, created_at: "junk" }]).length === 0, "unparseable candidate kept");
  ok(planRestageReplace({ ...fresh, created_at: null }, [recent]).length === 0, "unknown fresh time: replace nothing");
  ok(planRestageReplace(fresh, [recent], 0).length === 0, "zero window replaces nothing");
  ok(planRestageReplace(fresh, null).length === 0, "null candidates safe");
  ok(restageWindowStartIso(T0) === "2026-01-01T00:00:10.000Z", "window start");
  ok(restageWindowStartIso("x") === null, "window start unknown");
  const rs = replacedSummary({ origin: "intake", k: 1 }, "new", T0);
  ok(rs.archived_reason === "replaced_by_restage:new" && rs.archived_at === T0 && rs.k === 1, "replaced summary");

  // Batch.
  ok(isPricedDraft({ id: "d", status: "draft", suggested_price_minor_units: 1500 }), "priced");
  ok(!isPricedDraft({ id: "d", status: "draft", suggested_price_minor_units: null }), "no price");
  ok(!isPricedDraft({ id: "d", status: "draft", suggested_price_minor_units: 0 }), "zero price");
  ok(!isPricedDraft({ id: "d", status: "draft", suggested_price_minor_units: 12.5 }), "fractional cents");
  ok(!isPricedDraft({ id: "d", status: "approved", suggested_price_minor_units: 1500 }), "already approved");
  ok(!isPricedDraft({ id: "", status: "draft", suggested_price_minor_units: 1500 }), "no id");
  const plan = planBatchApprove(
    [
      { id: "a", status: "draft", suggested_price_minor_units: 100 },
      { id: "b", status: "draft", suggested_price_minor_units: null },
      { id: "c", status: "draft", suggested_price_minor_units: 300 },
      { id: "d", status: "draft", suggested_price_minor_units: 400 },
    ],
    2,
  );
  ok(plan.approve.map((x) => `${x.id}:${x.priceMinor}`).join() === "a:100,c:300", "order + price kept, cap applied");
  ok(plan.overflow === 1, "overflow counted");
  ok(planBatchApprove(null).approve.length === 0 && planBatchApprove([], -1).overflow === 0, "empty/negative safe");
  ok(pricedInReview({ inReview: 9, needsPrice: 2 }) === 7 && pricedInReview(null) === null, "priced count");
  ok(pricedInReview({ inReview: 1, needsPrice: 2 }) === null, "impossible counts are unknown");
  ok(batchButtonLabel(9) === "Approve all 9 priced", "button copy (bible S17.4)");
  ok(batchNotesSuffix(9) === " Approved together as one batch of 9 products." && batchNotesSuffix(1) === "" && batchNotesSuffix(undefined) === "", "notes suffix");

  // Feedback.
  const p = batchResultParams({ approved: 7, skipped: 2, overflow: 0, why: "  Pick a   category " });
  ok(p.batch_ok === "7" && p.batch_skip === "2" && p.batch_why === "Pick a category" && !("batch_more" in p), "params");
  const back = parseBatchResult(p);
  ok(back?.approved === 7 && back.skipped === 2 && back.overflow === 0 && back.why === "Pick a category", "round trip");
  ok(parseBatchResult({}) === null && parseBatchResult({ batch_ok: "x", batch_skip: "1" }) === null, "not a batch");
  ok(batchResultParams({ approved: 0, skipped: 0, overflow: 0, why: "w".repeat(500) }).batch_why.length === BATCH_WHY_MAX, "why capped");
  ok(batchResultCopy({ approved: 1, skipped: 0, overflow: 0, why: null }) === "Approved 1 product together - the menu was updated once for all of them.", "single copy");
  ok(
    batchResultCopy({ approved: 0, skipped: 2, overflow: 3, why: "x" }) ===
      "Nothing was approved. 2 products still need you and are still listed below (first reason: x). 3 more products are priced - press the button again for the rest.",
    "full copy",
  );
  ok(batchAuditAfter(M, { approved: 1, skipped: 0, overflow: 0, why: null }, "v").version_id === "v", "audit shape");
  return { passed, failed: 0 };
}

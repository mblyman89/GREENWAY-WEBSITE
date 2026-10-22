/**
 * src/lib/inventory/cultivera-vendor.ts  (R74 S11)
 *
 * Owner (round 7): "i want to see the manifests in onboarding, grouped or
 * groupable by vendor. i want to see gemini telling me it can lookup all
 * products from a vendor ... i want to see the onboard page showing me all
 * the mastering it is doing to the products. i want to see the coas being
 * attached and the facts from them getting attached to the products."
 *
 * Server half of the by-vendor onboarding. Everything here REUSES the
 * existing chains; nothing new writes to stock, prices or the live menu:
 *
 *   loadCultiveraVendors()          - every rebuilt manifest (the Receiving
 *                                     loader), rolled up per vendor.
 *   startCultiveraVendorOnboarding  - the SAME per-manifest Start
 *                                     (startCultiveraManifestOnboarding), one
 *                                     manifest after another inside a time
 *                                     budget, resumable from a cursor.
 *   enqueueVendorLookup             - the SAME per-manifest batch lookup
 *                                     (enqueueManifestLookup), once per
 *                                     manifest of the vendor; idempotent (an
 *                                     active job is returned, never doubled).
 *   loadVendorMastering             - read-only: what onboarding has attached
 *                                     to the vendor's products (facts by
 *                                     source, KB links, lab/COA coverage,
 *                                     Gemini progress, timeline).
 *
 * Fail loud, never guess: an unreadable part is reported as unreadable, never
 * as zero.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { loadReceivingCultiveraRows } from "@/lib/inventory/receiving-cultivera-store";
import { startCultiveraManifestOnboarding } from "@/lib/inventory/cultivera-onboarding";
import { enqueueManifestLookup } from "@/lib/catalog/lookup-job-server";
import { ACTIVE_JOB_STATUSES, LOOKUP_JOBS_TABLE } from "@/lib/catalog/lookup-job-core";
import type { CultiveraTableRow } from "@/lib/inventory/receiving-table-core";
import {
  MASTERING_EVENT_TYPES,
  VENDOR_LOOKUP_AUDIT,
  VENDOR_START_AUDIT,
  VENDOR_START_BUDGET_MS,
  groupByVendor,
  masteringSummary,
  pickVendorStartTargets,
  rowsForVendor,
  tallyVendorLookup,
  vendorStartCanContinue,
  type LabCoverage,
  type MasteringDraft,
  type MasteringSummary,
  type VendorLookupOutcome,
  type VendorLookupRun,
  type VendorRollup,
  type VendorStartRun,
} from "@/lib/inventory/cultivera-vendor-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const ID_CHUNK = 100;
const PAGE = 1000;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

export type CultiveraVendorsLoad =
  | { ok: true; rows: CultiveraTableRow[]; vendors: VendorRollup[]; tallyRead: boolean }
  | { ok: false; error: string };

/** Every rebuilt manifest, rolled up per vendor (open work first). */
export async function loadCultiveraVendors(): Promise<CultiveraVendorsLoad> {
  const load = await loadReceivingCultiveraRows();
  if (!load.ok) return load;
  return { ok: true, rows: load.rows, vendors: groupByVendor(load.rows, load.tallyRead), tallyRead: load.tallyRead };
}

/**
 * "Start every manifest from <vendor>". Runs the per-manifest Start on the
 * vendor's not-done manifests (id order, after `cursor`), stopping while at
 * least VENDOR_START_MIN_LEFT_MS of the budget is left; the result's `next`
 * resumes the walk ("Continue"). `now` is injectable for tests.
 */
export async function startCultiveraVendorOnboarding(
  vendor: string,
  cursor: string | null,
  actorId: string | null,
  opts: { budgetMs?: number; now?: () => number; includeDone?: boolean } = {},
): Promise<{ ok: true; run: VendorStartRun } | { ok: false; error: string }> {
  const now = opts.now ?? Date.now;
  const t0 = now();
  const budget = opts.budgetMs ?? VENDOR_START_BUDGET_MS;
  if (!vendor.trim()) return { ok: false, error: "No vendor was chosen." };
  const load = await loadReceivingCultiveraRows();
  if (!load.ok) return { ok: false, error: `The Cultivera manifests could not be read: ${load.error}` };
  const mine = rowsForVendor(load.rows, vendor);
  if (mine.length === 0) return { ok: false, error: `No Cultivera manifests from "${vendor}".` };
  const targets = pickVendorStartTargets(
    mine.map((r) => ({ id: r.id, state: r.state, known: load.tallyRead && r.completion !== "unknown" })),
    cursor,
    opts.includeDone === true,
  );
  // The whole plan (from the beginning) so "N of M" is stable across Continue presses.
  const planned = cursor
    ? pickVendorStartTargets(mine.map((r) => ({ id: r.id, state: r.state, known: load.tallyRead && r.completion !== "unknown" })), null, opts.includeDone === true).length
    : targets.length;
  const run: VendorStartRun = { vendor: mine[0].vendor, planned, started: planned - targets.length, seeded: 0, failed: 0, errors: [], next: cursor, done: targets.length === 0 };
  // `started` counts what earlier presses finished; this press adds to it.
  for (let i = 0; i < targets.length; i += 1) {
    if (!vendorStartCanContinue(now() - t0, budget)) break;
    const id = targets[i];
    try {
      const res = await startCultiveraManifestOnboarding(id, actorId);
      if (res.ok) {
        run.started += 1;
        run.seeded += res.seeded;
      } else {
        run.failed += 1;
        run.errors.push(res.error.slice(0, 160));
      }
    } catch (err) {
      run.failed += 1;
      run.errors.push(short(err));
    }
    run.next = id;
    if (i === targets.length - 1) run.done = true;
  }
  await recordAudit({
    actorId,
    action: VENDOR_START_AUDIT,
    entityType: "vendor",
    entityId: null,
    after: {
      vendor: run.vendor,
      planned: run.planned,
      started: run.started,
      seeded: run.seeded,
      failed: run.failed,
      errors: run.errors.slice(0, 5),
      next: run.next,
      done: run.done,
      live_menu_changed: false,
    },
  }).catch(() => {});
  return { ok: true, run };
}

/**
 * "Look up all products from <vendor> with Gemini": one batch lookup per
 * manifest of the vendor (the same job the per-manifest button creates; the
 * every-minute worker runs up to LOOKUP_PARALLEL_JOBS of them at once). Each
 * answer is saved to the knowledge base by the worker, as on any lookup.
 */
export async function enqueueVendorLookup(
  vendor: string,
  actor: { userId: string | null; email: string | null },
): Promise<{ ok: true; run: VendorLookupRun } | { ok: false; error: string; migration?: boolean }> {
  if (!vendor.trim()) return { ok: false, error: "No vendor was chosen." };
  const load = await loadReceivingCultiveraRows();
  if (!load.ok) return { ok: false, error: `The Cultivera manifests could not be read: ${load.error}` };
  const mine = rowsForVendor(load.rows, vendor);
  if (mine.length === 0) return { ok: false, error: `No Cultivera manifests from "${vendor}".` };
  // Only manifests with products in review can have anything to look up; a
  // not-started manifest has no onboarding rows yet (Start it first).
  const candidates = mine.filter((r) => r.state === "in_review" || r.completion === "unknown");
  const outcomes: VendorLookupOutcome[] = [];
  for (const r of candidates) {
    const res = await enqueueManifestLookup(r.id, actor);
    if (res.ok) {
      outcomes.push(res.kind === "created" ? { kind: "created", total: res.total ?? 0, truncated: res.truncated ?? 0 } : { kind: "exists" });
    } else if (res.code === "migration") {
      return { ok: false, error: "The batch lookup tables are not set up (migration missing).", migration: true };
    } else if (res.code === "nothing") {
      outcomes.push({ kind: "nothing" });
    } else {
      outcomes.push({ kind: "error", message: `${r.number}: ${res.message}`.slice(0, 160) });
    }
  }
  const run = tallyVendorLookup(mine[0].vendor, outcomes);
  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email,
    action: VENDOR_LOOKUP_AUDIT,
    entityType: "vendor",
    entityId: null,
    after: {
      vendor: run.vendor,
      manifests: mine.length,
      tried: run.manifests,
      created: run.created,
      queued_products: run.queuedProducts,
      already_running: run.alreadyRunning,
      nothing: run.nothing,
      truncated: run.truncated,
      errors: run.errors.slice(0, 5),
    },
  }).catch(() => {});
  return { ok: true, run };
}

export type MasteringEvent = { manifestId: string; type: string; note: string; at: string };

export type VendorMastering = {
  vendor: string;
  manifestIds: string[];
  /** null = the onboarding rows could not be read. */
  summary: MasteringSummary | null;
  /** null = the lots / lab results could not be read. */
  lab: LabCoverage | null;
  /** Gemini batch lookups still working on this vendor's manifests; null = unreadable. */
  lookup: { jobs: number; total: number; done: number } | null;
  events: MasteringEvent[] | null;
  errors: string[];
};

async function readDrafts(admin: Admin, ids: readonly string[]): Promise<MasteringDraft[] | string> {
  const out: MasteringDraft[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let off = 0; off < 200_000; off += PAGE) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select("id, status, kb_product_id, attached_facts")
        .in("manifest_id", chunk)
        .order("id", { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) return short(error);
      const got = (data as MasteringDraft[] | null) ?? [];
      out.push(...got);
      if (got.length < PAGE) break;
    }
  }
  return out;
}

async function readLab(admin: Admin, ids: readonly string[]): Promise<LabCoverage | string> {
  // lab_result_id per lot (one pass), then which lab results keep the certificate file.
  const lotLab: (string | null)[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let off = 0; off < 200_000; off += PAGE) {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, lab_result_id")
        .in("manifest_id", chunk)
        .order("id", { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) return short(error);
      const got = (data as { id: string; lab_result_id: string | null }[] | null) ?? [];
      for (const l of got) lotLab.push(l.lab_result_id ?? null);
      if (got.length < PAGE) break;
    }
  }
  const labIds = [...new Set(lotLab.filter((x): x is string => Boolean(x)))];
  const kept = new Set<string>();
  for (let i = 0; i < labIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from("lab_results").select("id, coa_storage_path").in("id", labIds.slice(i, i + ID_CHUNK));
    if (error) return short(error);
    for (const r of (data as { id: string; coa_storage_path: string | null }[] | null) ?? []) {
      if (r.coa_storage_path) kept.add(r.id);
    }
  }
  return {
    lots: lotLab.length,
    withLab: lotLab.filter(Boolean).length,
    withCertificate: lotLab.filter((x) => x !== null && kept.has(x)).length,
  };
}

async function readLookup(admin: Admin, ids: readonly string[]): Promise<{ jobs: number; total: number; done: number } | string> {
  const r = { jobs: 0, total: 0, done: 0 };
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from(LOOKUP_JOBS_TABLE)
      .select("id, total, done")
      .in("manifest_id", ids.slice(i, i + ID_CHUNK))
      .in("status", ACTIVE_JOB_STATUSES as string[]);
    if (error) return short(error);
    for (const j of (data as { total: number | null; done: number | null }[] | null) ?? []) {
      r.jobs += 1;
      r.total += Math.max(0, Number(j.total) || 0);
      r.done += Math.max(0, Number(j.done) || 0);
    }
  }
  return r;
}

async function readEvents(admin: Admin, ids: readonly string[], limit: number): Promise<MasteringEvent[] | string> {
  const out: MasteringEvent[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from("manifest_events")
      .select("manifest_id, event_type, note, created_at")
      .in("manifest_id", ids.slice(i, i + ID_CHUNK))
      .in("event_type", MASTERING_EVENT_TYPES as string[])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return short(error);
    for (const e of (data as { manifest_id: string; event_type: string; note: string | null; created_at: string }[] | null) ?? []) {
      out.push({ manifestId: e.manifest_id, type: e.event_type, note: (e.note ?? "").slice(0, 400), at: e.created_at });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** What onboarding has done to one vendor's products, read-only. */
export async function loadVendorMastering(vendor: string, rows: readonly CultiveraTableRow[], eventLimit = 25): Promise<VendorMastering> {
  const mine = rowsForVendor(rows, vendor);
  const ids = mine.map((r) => r.id);
  const out: VendorMastering = { vendor: mine[0]?.vendor ?? vendor, manifestIds: ids, summary: null, lab: null, lookup: null, events: null, errors: [] };
  if (ids.length === 0 || !isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const [d, l, j, e] = await Promise.all([
    readDrafts(admin, ids).catch((x: unknown) => short(x)),
    readLab(admin, ids).catch((x: unknown) => short(x)),
    readLookup(admin, ids).catch((x: unknown) => short(x)),
    readEvents(admin, ids, eventLimit).catch((x: unknown) => short(x)),
  ]);
  if (typeof d === "string") out.errors.push(`onboarding rows: ${d}`);
  else out.summary = masteringSummary(d);
  if (typeof l === "string") out.errors.push(`lab links: ${l}`);
  else out.lab = l;
  if (typeof j === "string") out.errors.push(`Gemini lookups: ${j}`);
  else out.lookup = j;
  if (typeof e === "string") out.errors.push(`timeline: ${e}`);
  else out.events = e;
  return out;
}

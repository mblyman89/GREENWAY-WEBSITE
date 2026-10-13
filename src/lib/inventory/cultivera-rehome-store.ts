/**
 * R50 S2c — server side of cultivera-rehome-core.ts.
 *
 * Reads (all fail-closed: a short read THROWS, never a silent partial):
 *   - the import's POS-IMPORT manifest (exactly one, by number + kind/lineage);
 *   - every lot on any manifest of this import (import-lineage-store);
 *   - this import's rebuilt manifests (by raw_payload lineage, for resume).
 * Writes (only after the pure plan says ok):
 *   1. INSERT the missing manifests (dedupe_key unique index = idempotency;
 *      a key held by anything else fails the insert and stops the run);
 *   2. one manifest_events "accepted" row per new manifest;
 *   3. UPDATE inventory_lots SET manifest_id = target WHERE id IN (batch)
 *      AND manifest_id = <POS-IMPORT id> — a lot someone else moved meanwhile
 *      is never touched;
 *   4. re-read and verify (control totals identical, every lot home).
 * Only manifest_id changes on a lot. Rollback moves lots back (guarded by
 * their current rebuilt manifest) and deletes only empty rebuilt manifests
 * of this import.
 *
 * recordAudit needs request headers, so the server action audits the result.
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import {
  LINEAGE_MANIFEST_SELECT,
  isPosImportRow,
  isSafeImportId,
  posImportManifestNumber,
  type LineageManifestRow,
} from "@/lib/inventory/import-lineage-core";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import type { TransferIndexEntry } from "@/lib/inventory/cultivera-transfer-match-core";
import {
  REHOME_EVENT_TYPE,
  REHOME_EXISTING_SELECT,
  REHOME_LOT_SELECT,
  REHOME_MOVE_BATCH,
  planFromSources,
  planRehome,
  plannedDedupeKeys,
  verifyRehome,
  type ControlTotals,
  type ExistingManifest,
  type PlanLotSource,
  type RehomeLot,
  type RehomePlan,
} from "@/lib/inventory/cultivera-rehome-core";
import type { ManifestPlanGate } from "@/lib/inventory/cultivera-transfer-match-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Manifests per INSERT (each row carries its barcodes in raw_payload; keep bodies modest). */
export const REHOME_INSERT_CHUNK = 50;

export type RehomeSources = {
  lotSources: readonly PlanLotSource[];
  transfers: readonly TransferIndexEntry[];
  links: ReadonlyMap<string, readonly number[]>;
  pacificToday: string;
  indexSkipped?: number;
};

export type RehomeState = {
  importId: string;
  source: { id: string; manifestNumber: string };
  lots: RehomeLot[];
  existing: ExistingManifest[];
};

/** The import's original POS-IMPORT manifest. Throws unless exactly one exists. */
export async function findSourceManifest(admin: Admin, importId: string): Promise<{ id: string; manifestNumber: string }> {
  if (!isSafeImportId(importId)) throw new Error("That import id is not valid.");
  const number = posImportManifestNumber(importId);
  const { data, error } = await admin
    .from("inbound_manifests")
    .select(LINEAGE_MANIFEST_SELECT)
    .eq("manifest_number", number)
    .order("id", { ascending: true })
    .limit(5);
  if (error) throw new Error(`Could not read the import manifest (${error.message}).`);
  const rows = ((data as unknown as LineageManifestRow[] | null) ?? []).filter(
    (r) => isPosImportRow(r) && (!r.payload_import_id || r.payload_import_id === importId),
  );
  if (rows.length !== 1) throw new Error(`Expected exactly one ${number} manifest for this import, found ${rows.length}.`);
  return { id: rows[0].id, manifestNumber: number };
}

/** This import's rebuilt manifests (resume). */
export async function readRebuiltManifests(admin: Admin, importId: string): Promise<ExistingManifest[]> {
  if (!isSafeImportId(importId)) throw new Error("That import id is not valid.");
  const read = await pagedAllChecked<ExistingManifest>(async (from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select(REHOME_EXISTING_SELECT)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as unknown as ExistingManifest[] | null) ?? [] };
  });
  if (!read.verdict.complete) throw new Error(`Could not read this import's rebuilt manifests. ${read.verdict.message}`);
  return read.rows;
}

/** Dedupe keys per `.in()` read (keys are ~60 chars; 100 keep the URL ≈ 7 KB). */
export const REHOME_KEY_CHUNK = 100;

/**
 * ANY manifest already holding one of these dedupe keys, whoever made it. A key
 * held by something that is not this import's rebuilt manifest must refuse the
 * plan in the PREVIEW, not fail half-way through the inserts.
 */
export async function readManifestsByKeys(admin: Admin, keys: readonly string[]): Promise<ExistingManifest[]> {
  const out: ExistingManifest[] = [];
  const uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += REHOME_KEY_CHUNK) {
    const chunk = uniq.slice(i, i + REHOME_KEY_CHUNK);
    const { data, error } = await admin.from("inbound_manifests").select(REHOME_EXISTING_SELECT).in("dedupe_key", chunk).order("id", { ascending: true });
    if (error) throw new Error(`Could not check existing manifests (${error.message}).`);
    out.push(...((data as unknown as ExistingManifest[] | null) ?? []));
  }
  return out;
}

export async function loadRehomeState(admin: Admin, importId: string, plannedKeys: readonly string[] = []): Promise<RehomeState> {
  const source = await findSourceManifest(admin, importId);
  const ids = await importManifestIds(admin, importId);
  const lots = await readLotsOnManifests<RehomeLot>(admin, ids, REHOME_LOT_SELECT);
  const byId = new Map<string, ExistingManifest>();
  for (const m of await readRebuiltManifests(admin, importId)) byId.set(m.id, m);
  for (const m of await readManifestsByKeys(admin, plannedKeys)) byId.set(m.id, m);
  return { importId, source, lots, existing: [...byId.values()] };
}

export type RehomePreview = { plan: RehomePlan; gate: ManifestPlanGate; state: RehomeState };

/** Read-only: what Apply would do right now. */
export async function previewRehome(
  admin: Admin,
  importId: string,
  sources: RehomeSources,
  opts: { actorId?: string | null } = {},
): Promise<RehomePreview> {
  const { plan: tplan, gate } = planFromSources(sources.lotSources, sources.transfers, sources.links, sources.pacificToday, sources.indexSkipped ?? 0);
  const state = await loadRehomeState(admin, importId, plannedDedupeKeys(importId, tplan));
  const plan = planRehome({
    importId,
    source: state.source,
    plan: tplan,
    lots: state.lots,
    existing: state.existing,
    gatePass: gate.pass,
    gateProblems: gate.problems,
    actorId: opts.actorId ?? null,
  });
  return { plan, gate, state };
}

export type RehomeApplyResult = {
  ok: boolean;
  before: ControlTotals;
  created: number;
  reused: number;
  moved: number;
  /** Lots a guarded UPDATE did not move (someone changed them meanwhile). */
  skippedByGuard: number;
  eventsLogged: number;
  /** Timeline rows that could not be written (moves are unaffected; shown, never hidden). */
  warnings: string[];
  problems: string[];
  plan: RehomePlan;
  manifestIdByKey: Map<string, string>;
};

/**
 * Apply the plan. Refuses (throws) when the plan is not ok. Safe to re-run
 * after any interruption: created manifests are found again by lineage and
 * moved lots are already home.
 */
export async function applyRehome(
  admin: Admin,
  importId: string,
  sources: RehomeSources,
  opts: { actorId?: string | null } = {},
): Promise<RehomeApplyResult> {
  const { plan, state } = await previewRehome(admin, importId, sources, opts);
  if (!plan.ok) throw new Error(`Re-home refused: ${plan.refusals.join("; ")}`);
  const actorId = opts.actorId ?? null;

  const manifestIdByKey = new Map<string, string>();
  for (const m of plan.manifests) if (m.existingId) manifestIdByKey.set(m.dedupeKey, m.existingId);

  // 1. Create missing manifests.
  const toCreate = plan.manifests.filter((m) => !m.existingId);
  const createdIds: string[] = [];
  for (let i = 0; i < toCreate.length; i += REHOME_INSERT_CHUNK) {
    const chunk = toCreate.slice(i, i + REHOME_INSERT_CHUNK);
    const { data, error } = await admin
      .from("inbound_manifests")
      .insert(chunk.map((m) => m.row))
      .select("id, dedupe_key");
    if (error) throw new Error(`Could not create rebuilt manifests (${error.message}). Nothing was moved; run Apply again to resume.`);
    const rows = (data as { id: string; dedupe_key: string }[] | null) ?? [];
    if (rows.length !== chunk.length) throw new Error(`Created ${rows.length} of ${chunk.length} manifests in one batch; run Apply again to resume.`);
    for (const r of rows) {
      manifestIdByKey.set(r.dedupe_key, r.id);
      createdIds.push(r.id);
    }
  }

  // 2. Timeline events for the new manifests (same lifecycle fingerprint as a native accept).
  let eventsLogged = 0;
  const warnings: string[] = [];
  const byId = new Map(toCreate.map((m) => [manifestIdByKey.get(m.dedupeKey)!, m]));
  for (let i = 0; i < createdIds.length; i += 200) {
    const rows = createdIds.slice(i, i + 200).map((id) => {
      const m = byId.get(id)!;
      return {
        manifest_id: id,
        event_type: REHOME_EVENT_TYPE,
        note: `Cultivera migration: rebuilt from ${m.source === "transfer" ? "the real Cultivera transfer" : `the export's Received dates (${m.source})`}; ${m.lotIds.length} lot(s) re-homed from ${state.source.manifestNumber}.`,
        actor_id: actorId,
      };
    });
    const { error } = await admin.from("manifest_events").insert(rows);
    if (error) warnings.push(`${rows.length} timeline event(s) could not be written (${error.message}); the manifests and moves are unaffected.`);
    else eventsLogged += rows.length;
  }

  // 3. Guarded moves.
  let moved = 0;
  let skippedByGuard = 0;
  for (const b of plan.moves) {
    const target = manifestIdByKey.get(b.targetDedupeKey);
    if (!target) throw new Error(`No manifest id for ${b.targetDedupeKey}; run Apply again to resume.`);
    const { data, error } = await admin
      .from("inventory_lots")
      .update({ manifest_id: target })
      .in("id", b.lotIds)
      .eq("manifest_id", state.source.id)
      .select("id");
    if (error) throw new Error(`Moving lots stopped (${error.message}) after ${moved} lots; run Apply again to resume.`);
    const n = ((data as { id: string }[] | null) ?? []).length;
    moved += n;
    skippedByGuard += b.lotIds.length - n;
  }

  // 4. Verify from the database, not from memory.
  const ids = await importManifestIds(admin, importId);
  const afterLots = await readLotsOnManifests<RehomeLot>(admin, ids, REHOME_LOT_SELECT);
  const problems = verifyRehome({ before: plan.totals, afterLots, manifestIdByKey, plan, sourceId: state.source.id });
  if (skippedByGuard > 0) problems.push(`${skippedByGuard} lots changed manifest during Apply and were left alone`);

  return {
    ok: problems.length === 0,
    before: plan.totals,
    created: createdIds.length,
    reused: plan.summary.manifestsAlreadyCreated,
    moved,
    skippedByGuard,
    eventsLogged,
    warnings,
    problems,
    plan,
    manifestIdByKey,
  };
}

export type RehomeRollbackResult = { movedBack: number; deleted: number; keptNonEmpty: number; keptWithWork: number };

/**
 * Tables whose rows hang off a manifest and would be lost (CASCADE) or orphaned
 * (SET NULL) by a delete — measured from pg_constraint on all 269 migrations.
 * vendor_manifest_payments is RESTRICT (the delete itself would fail).
 */
export const REHOME_ROLLBACK_WORK_TABLES = ["catalog_product_drafts", "pos_fact_reviews", "manifest_documents", "vendor_manifest_payments"] as const;

/**
 * Undo: every lot on this import's rebuilt manifests WHOSE BARCODE IS IN THAT
 * MANIFEST'S LINEAGE goes back to the POS-IMPORT manifest (guarded by its
 * current manifest; a lot placed there by hand stays), then rebuilt
 * manifests left empty are deleted. A rebuilt manifest that still holds a
 * lot (moved there by hand) or any enrichment work (drafts, fact reviews,
 * documents, payments) is kept and counted — never destroy work.
 */
/** The barcodes a rebuilt manifest's lineage says it holds (rollback moves back only these). */
async function lineageBarcodes(admin: Admin, manifestId: string): Promise<Set<string>> {
  const { data, error } = await admin.from("inbound_manifests").select("barcodes:raw_payload->barcodes").eq("id", manifestId).limit(1);
  if (error) throw new Error(`Rollback could not read the lineage of ${manifestId} (${error.message}).`);
  const raw = ((data as { barcodes: unknown }[] | null) ?? [])[0]?.barcodes;
  if (!Array.isArray(raw)) throw new Error(`Rebuilt manifest ${manifestId} has no barcode lineage; rollback refuses to guess which lots are ours.`);
  return new Set(raw.filter((b): b is string => typeof b === "string"));
}

export async function rollbackRehome(admin: Admin, importId: string): Promise<RehomeRollbackResult> {
  const source = await findSourceManifest(admin, importId);
  const rebuilt = await readRebuiltManifests(admin, importId);
  let movedBack = 0;
  for (const m of rebuilt) {
    const ours = await lineageBarcodes(admin, m.id);
    // Read every lot on this manifest (paged, fail-closed), keep only lineage barcodes;
    // a lot placed here by hand is never moved.
    const read = await pagedAllChecked<{ id: string; ccrs_inventory_external_id: string | null }>(async (from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, ccrs_inventory_external_id")
        .eq("manifest_id", m.id)
        .order("id", { ascending: true })
        .range(from, to);
      return { ok: !error, rows: (data as { id: string; ccrs_inventory_external_id: string | null }[] | null) ?? [] };
    });
    if (!read.verdict.complete) throw new Error(`Rollback could not read the lots on ${m.id}. ${read.verdict.message} Run it again.`);
    const ids = read.rows.filter((l) => l.ccrs_inventory_external_id != null && ours.has(l.ccrs_inventory_external_id)).map((l) => l.id);
    let movedHere = 0;
    for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) {
      const batch = ids.slice(i, i + REHOME_MOVE_BATCH);
      const { data, error } = await admin
        .from("inventory_lots")
        .update({ manifest_id: source.id })
        .in("id", batch)
        .eq("manifest_id", m.id)
        .select("id");
      if (error) throw new Error(`Rollback stopped moving lots (${error.message}); run it again.`);
      movedHere += ((data as { id: string }[] | null) ?? []).length;
    }
    movedBack += movedHere;
    // Progress check: a reported move that did not land (or a concurrent writer) stops loudly.
    for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) {
      const { count, error } = await admin
        .from("inventory_lots")
        .select("id", { count: "exact", head: true })
        .eq("manifest_id", m.id)
        .in("id", ids.slice(i, i + REHOME_MOVE_BATCH));
      if (error) throw new Error(`Rollback could not re-check ${m.id} (${error.message}); run it again.`);
      if ((count ?? 0) > 0) throw new Error(`Rollback is not making progress on ${m.id} (lots still there after being moved back); stopped. Run it again.`);
    }
  }
  let deleted = 0;
  let keptNonEmpty = 0;
  let keptWithWork = 0;
  for (const m of rebuilt) {
    const { count, error: cErr } = await admin.from("inventory_lots").select("id", { count: "exact", head: true }).eq("manifest_id", m.id);
    if (cErr) throw new Error(`Rollback could not count lots on ${m.id} (${cErr.message}).`);
    if ((count ?? 0) > 0) {
      keptNonEmpty += 1;
      continue;
    }
    let work = 0;
    for (const t of REHOME_ROLLBACK_WORK_TABLES) {
      const { count: wc, error: wErr } = await admin.from(t).select("id", { count: "exact", head: true }).eq("manifest_id", m.id);
      if (wErr) throw new Error(`Rollback could not check ${t} on ${m.id} (${wErr.message}).`);
      work += wc ?? 0;
    }
    if (work > 0) {
      keptWithWork += 1;
      continue;
    }
    const { data, error } = await admin
      .from("inbound_manifests")
      .delete()
      .eq("id", m.id)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .select("id");
    if (error) throw new Error(`Rollback could not delete ${m.id} (${error.message}).`);
    deleted += ((data as { id: string }[] | null) ?? []).length;
  }
  return { movedBack, deleted, keptNonEmpty, keptWithWork };
}

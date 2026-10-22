/**
 * R74 S10 — server side of cultivera-mail-apply-core.ts (the email step's executor).
 *
 * Reads (fail closed: a short read THROWS, never a silent partial):
 *   - the SAME transfer plan the rebuild page, the coverage report and the re-home use
 *     (loadRehomeSources + planFromSources), and S6's email match over the lots it leaves open
 *     (readDocsForBarcodes + mailDocsFromRows + planMailMatch), exactly as the coverage report;
 *   - every lot on any manifest of this import, and this import's rebuilt manifests with their
 *     lineage barcodes (plus anything already holding a planned dedupe key);
 *   - how many kept PDFs / spreadsheets are still unread (S9), as a warning.
 * Writes (only after the pure plan says ok and the digest matches the preview):
 *   1. grow the lineage of an existing emailed manifest BEFORE lots move onto it (so a rollback can
 *      always prove which lots are ours);
 *   2. INSERT the missing manifests (dedupe_key unique index = idempotency) + one "accepted"
 *      manifest_events row each;
 *   3. UPDATE inventory_lots SET manifest_id = target WHERE id IN (batch) AND manifest_id = <the
 *      manifest the plan saw it on>: a lot someone moved meanwhile is never touched;
 *   4. delete the rebuilt-from-dates manifests the lots left, when empty and carrying no work;
 *   5. re-read and verify (control totals identical, every planned lot home).
 * Rollback moves the lineage lots of this import's emailed + unmatched manifests back to the
 * POS-IMPORT manifest (the re-home re-plans them) and deletes those manifests when empty and
 * carrying no work. recordAudit needs request headers, so the server action audits.
 */
import "server-only";
import crypto from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { importManifestIds, readLotsOnManifests } from "@/lib/inventory/import-lineage-store";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import { FALLBACK_GROUP_KINDS, REHOME_EVENT_TYPE, REHOME_LOT_SELECT, REHOME_MOVE_BATCH, planFromSources, type ControlTotals, type RehomeLot } from "@/lib/inventory/cultivera-rehome-core";
import { REHOME_INSERT_CHUNK, REHOME_KEY_CHUNK, REHOME_ROLLBACK_WORK_TABLES, findSourceManifest, loadRehomeSources, type RehomeSources } from "@/lib/inventory/cultivera-rehome-store";
import type { ManifestPlanGate } from "@/lib/inventory/cultivera-transfer-match-core";
import { openLotsFromTransferPlan, planMailMatch, type MailMatchPlan } from "@/lib/pos/cultivera-mail-match-core";
import { HARVEST_DOCS_TABLE, mailDocsFromRows } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { isMissingTable } from "@/lib/pos/cultivera-mail-harvest-store";
import { readDocsForBarcodes } from "@/lib/pos/cultivera-coverage-store";
import {
  EMAIL_GROUP_KIND,
  UNMATCHED_GROUP_KIND,
  emailDedupeKey,
  planMailApply,
  unmatchedDedupeKey,
  verifyMailApply,
  type ApplyManifestInfo,
  type MailApplyPlan,
} from "@/lib/pos/cultivera-mail-apply-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Flat projection + the lineage barcodes (never the rest of raw_payload). */
export const MAIL_APPLY_MANIFEST_SELECT =
  "id, dedupe_key, payload_kind:raw_payload->>kind, payload_import_id:raw_payload->>import_id, payload_group_kind:raw_payload->>group_kind, barcodes:raw_payload->barcodes";

type RawInfo = Omit<ApplyManifestInfo, "barcodes"> & { barcodes: unknown };
const toInfo = (r: RawInfo): ApplyManifestInfo => ({
  ...r,
  barcodes: Array.isArray(r.barcodes) ? r.barcodes.filter((b): b is string => typeof b === "string") : null,
});

/** This import's rebuilt manifests with lineage barcodes (paged, fail closed). */
export async function readImportRebuiltInfo(admin: Admin, importId: string): Promise<ApplyManifestInfo[]> {
  if (!isSafeImportId(importId)) throw new Error("That import id is not valid.");
  const read = await pagedAllChecked<RawInfo>(async (from, to) => {
    const { data, error } = await admin
      .from("inbound_manifests")
      .select(MAIL_APPLY_MANIFEST_SELECT)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .order("id", { ascending: true })
      .range(from, to);
    return { ok: !error, rows: (data as unknown as RawInfo[] | null) ?? [] };
  });
  if (!read.verdict.complete) throw new Error(`Could not read this import's rebuilt manifests. ${read.verdict.message}`);
  return read.rows.map(toInfo);
}

/** ANY manifest already holding one of these keys (a foreign holder must refuse in the PREVIEW). */
async function readInfoByKeys(admin: Admin, keys: readonly string[]): Promise<ApplyManifestInfo[]> {
  const out: ApplyManifestInfo[] = [];
  const uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += REHOME_KEY_CHUNK) {
    const { data, error } = await admin.from("inbound_manifests").select(MAIL_APPLY_MANIFEST_SELECT).in("dedupe_key", uniq.slice(i, i + REHOME_KEY_CHUNK)).order("id", { ascending: true });
    if (error) throw new Error(`Could not check existing manifests (${error.message}).`);
    out.push(...((data as unknown as RawInfo[] | null) ?? []).map(toInfo));
  }
  return out;
}

/** Kept PDFs / spreadsheets not read yet (S9). 0 when the table is not there. */
async function countUnreadDocs(admin: Admin): Promise<number> {
  const { count, error } = await admin.from(HARVEST_DOCS_TABLE).select("id", { count: "exact", head: true }).eq("status", "stored");
  if (error) {
    if (isMissingTable(error)) return 0;
    throw new Error(`Could not count the unread kept files (${error.message}).`);
  }
  return count ?? 0;
}

/** S6's email plan over the lots the transfer plan leaves open: exactly the coverage report's. */
export async function buildMailPlan(admin: Admin, sources: RehomeSources): Promise<{ mail: MailMatchPlan | null; gate: ManifestPlanGate; vendorOf: Map<string, string> }> {
  const { plan, gate } = planFromSources(sources.lotSources, sources.transfers, sources.links, sources.pacificToday, sources.indexSkipped ?? 0);
  const rows = sources.lotSources.map((s) => ({ barcode: s.barcode, vendor: s.vendor, receivedDateRaw: s.receivedDateRaw, units: s.units, productName: s.productName }));
  const open = openLotsFromTransferPlan(rows, plan.decisions);
  const docRows = await readDocsForBarcodes(admin, open.map((l) => l.barcode));
  const mail = docRows === null ? null : planMailMatch(open, mailDocsFromRows(docRows));
  const vendorOf = new Map<string, string>();
  for (const l of open) vendorOf.set(l.barcode, l.vendorLabel);
  return { mail, gate, vendorOf };
}

export type MailApplyPreview = { plan: MailApplyPlan; mail: MailMatchPlan | null; gate: ManifestPlanGate; source: { id: string; manifestNumber: string }; digest: string };

/** Fingerprint of exactly what Apply would write (created_by / updated_by excluded: who presses is not what is written). */
export function mailApplyDigest(plan: MailApplyPlan): string {
  const body = JSON.stringify({
    ok: plan.ok,
    refusals: plan.refusals,
    totals: plan.totals,
    manifests: plan.manifests.map((m) => {
      const { created_by: _c, updated_by: _u, ...row } = m.row;
      void _c;
      void _u;
      return [m.dedupeKey, m.existingId, m.lineageGrows, row, [...m.lotIds].sort()];
    }),
    moves: plan.moves.map((b) => [b.targetDedupeKey, b.fromManifestId, [...b.lotIds].sort()]),
    fallbackSources: plan.fallbackSources,
  });
  return crypto.createHash("sha256").update(body).digest("hex");
}

/** Read-only: what Apply would do right now. */
export async function previewMailApply(admin: Admin, importId: string, sources: RehomeSources, opts: { actorId?: string | null } = {}): Promise<MailApplyPreview> {
  const source = await findSourceManifest(admin, importId);
  const { mail, gate, vendorOf } = await buildMailPlan(admin, sources);
  const ids = await importManifestIds(admin, importId);
  const lots = await readLotsOnManifests<RehomeLot>(admin, ids, REHOME_LOT_SELECT);
  const keys = mail ? [...mail.groups.map((g) => emailDedupeKey(importId, g)), unmatchedDedupeKey(importId)] : [];
  const byId = new Map<string, ApplyManifestInfo>();
  for (const m of await readImportRebuiltInfo(admin, importId)) byId.set(m.id, m);
  for (const m of await readInfoByKeys(admin, keys)) byId.set(m.id, m);
  const unreadDocs = mail ? await countUnreadDocs(admin) : 0;
  const plan = planMailApply({
    importId,
    source,
    mail,
    gatePass: gate.pass,
    gateProblems: gate.problems,
    lots,
    manifests: [...byId.values()],
    unreadDocs,
    cultiveraVendorOf: vendorOf,
    actorId: opts.actorId ?? null,
  });
  return { plan, mail, gate, source, digest: mailApplyDigest(plan) };
}

export type MailApplyResult = {
  ok: boolean;
  before: ControlTotals;
  created: number;
  reused: number;
  lineageUpdated: number;
  moved: number;
  skippedByGuard: number;
  removedEmpty: number;
  eventsLogged: number;
  warnings: string[];
  problems: string[];
  plan: MailApplyPlan;
  manifestIdByKey: Map<string, string>;
};

async function countOn(admin: Admin, table: string, manifestId: string): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("manifest_id", manifestId);
  if (error) throw new Error(`could not check ${table} on ${manifestId} (${error.message})`);
  return count ?? 0;
}

/** Empty (no lots) and no enrichment work (drafts, fact reviews, documents, payments). */
async function emptyWithoutWork(admin: Admin, manifestId: string): Promise<"empty" | "lots" | "work"> {
  if ((await countOn(admin, "inventory_lots", manifestId)) > 0) return "lots";
  for (const t of REHOME_ROLLBACK_WORK_TABLES) if ((await countOn(admin, t, manifestId)) > 0) return "work";
  return "empty";
}

/**
 * Apply the plan. Refuses (throws) when the plan is not ok or not the previewed one. Safe to re-run
 * after any interruption: created manifests are found again by key and moved lots are home.
 */
export async function applyMailPlan(admin: Admin, importId: string, sources: RehomeSources, opts: { actorId?: string | null; expectedDigest?: string } = {}): Promise<MailApplyResult> {
  const { plan, digest } = await previewMailApply(admin, importId, sources, opts);
  if (!plan.ok) throw new Error(`Email step refused: ${plan.refusals.join("; ")}`);
  if (opts.expectedDigest !== undefined && opts.expectedDigest !== digest) {
    throw new Error("The plan changed since you previewed it (new harvested files, moved lots or new manifests). Nothing was written; review the new preview and apply again.");
  }
  const actorId = opts.actorId ?? null;
  const warnings = [...plan.warnings];
  const manifestIdByKey = new Map<string, string>();
  for (const m of plan.manifests) if (m.existingId) manifestIdByKey.set(m.dedupeKey, m.existingId);

  // 1. Grow lineage first (rollback must always be able to prove which lots are ours).
  let lineageUpdated = 0;
  for (const m of plan.manifests.filter((x) => x.existingId && x.lineageGrows)) {
    const { data, error } = await admin
      .from("inbound_manifests")
      .update({ raw_payload: m.row.raw_payload, accepted_lot_count: m.row.accepted_lot_count, updated_by: actorId })
      .eq("id", m.existingId as string)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .select("id");
    if (error) throw new Error(`Could not update the lineage of ${m.row.manifest_number} (${error.message}). Nothing was moved; run Apply again.`);
    if (((data as { id: string }[] | null) ?? []).length !== 1) throw new Error(`Manifest ${m.existingId} changed hands before its lineage could grow; nothing was moved onto it. Preview again.`);
    lineageUpdated += 1;
  }

  // 2. Create the missing manifests.
  const toCreate = plan.manifests.filter((m) => !m.existingId);
  const createdIds: string[] = [];
  for (let i = 0; i < toCreate.length; i += REHOME_INSERT_CHUNK) {
    const chunk = toCreate.slice(i, i + REHOME_INSERT_CHUNK);
    const { data, error } = await admin.from("inbound_manifests").insert(chunk.map((m) => m.row)).select("id, dedupe_key");
    if (error) throw new Error(`Could not create the emailed manifests (${error.message}). Nothing was moved; run Apply again to resume.`);
    const rows = (data as { id: string; dedupe_key: string }[] | null) ?? [];
    if (rows.length !== chunk.length) throw new Error(`Created ${rows.length} of ${chunk.length} manifests in one batch; run Apply again to resume.`);
    for (const r of rows) {
      manifestIdByKey.set(r.dedupe_key, r.id);
      createdIds.push(r.id);
    }
  }
  let eventsLogged = 0;
  if (createdIds.length > 0) {
    const byKey = new Map(toCreate.map((m) => [m.dedupeKey, m]));
    const rows = toCreate.map((m) => ({
      manifest_id: manifestIdByKey.get(m.dedupeKey)!,
      event_type: REHOME_EVENT_TYPE,
      note:
        byKey.get(m.dedupeKey)!.kind === EMAIL_GROUP_KIND
          ? `Cultivera migration: rebuilt from the vendor's emailed manifest (stephen@ harvest); ${m.lotIds.length} lot(s).`
          : `Cultivera migration: stock neither Cultivera nor email could place; ${m.lotIds.length} lot(s) for the CCRS clean-up.`,
      actor_id: actorId,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const { error } = await admin.from("manifest_events").insert(part);
      if (error) warnings.push(`${part.length} timeline event(s) could not be written (${error.message}); the manifests and moves are unaffected.`);
      else eventsLogged += part.length;
    }
  }

  // 3. Guarded moves (each batch only from the manifest the plan saw its lots on).
  let moved = 0;
  let skippedByGuard = 0;
  for (const b of plan.moves) {
    const target = manifestIdByKey.get(b.targetDedupeKey);
    if (!target) throw new Error(`No manifest id for ${b.targetDedupeKey}; run Apply again to resume.`);
    const { data, error } = await admin.from("inventory_lots").update({ manifest_id: target }).in("id", b.lotIds).eq("manifest_id", b.fromManifestId).select("id");
    if (error) throw new Error(`Moving lots stopped (${error.message}) after ${moved} lots; run Apply again to resume.`);
    const n = ((data as { id: string }[] | null) ?? []).length;
    moved += n;
    skippedByGuard += b.lotIds.length - n;
  }

  // 4. Rebuilt-from-dates manifests the lots left: delete when empty and carrying no work.
  let removedEmpty = 0;
  for (const id of plan.fallbackSources) {
    let state: "empty" | "lots" | "work";
    try {
      state = await emptyWithoutWork(admin, id);
    } catch (e) {
      warnings.push(`Kept rebuilt manifest ${id}: ${e instanceof Error ? e.message : String(e)}.`);
      continue;
    }
    if (state === "work") warnings.push(`Kept rebuilt manifest ${id}: it is empty but carries onboarding work.`);
    if (state !== "empty") continue;
    const { data, error } = await admin
      .from("inbound_manifests")
      .delete()
      .eq("id", id)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .in("raw_payload->>group_kind", [...FALLBACK_GROUP_KINDS])
      .select("id");
    if (error) warnings.push(`Could not remove the empty rebuilt manifest ${id} (${error.message}).`);
    else removedEmpty += ((data as { id: string }[] | null) ?? []).length;
  }

  // 5. Verify from the database, not from memory.
  const ids = await importManifestIds(admin, importId);
  const afterLots = await readLotsOnManifests<RehomeLot>(admin, ids, REHOME_LOT_SELECT);
  const problems = verifyMailApply({ before: plan.totals, afterLots, manifestIdByKey, plan });
  if (skippedByGuard > 0) problems.push(`${skippedByGuard} lots changed manifest during Apply and were left alone`);

  return {
    ok: problems.length === 0,
    before: plan.totals,
    created: createdIds.length,
    reused: plan.summary.manifestsAlreadyCreated,
    lineageUpdated,
    moved,
    skippedByGuard,
    removedEmpty,
    eventsLogged,
    warnings,
    problems,
    plan,
    manifestIdByKey,
  };
}

export type MailRollbackResult = { movedBack: number; deleted: number; keptNonEmpty: number; keptWithWork: number };

/**
 * Undo the email step only: lots on this import's emailed / unmatched manifests WHOSE BARCODE IS IN
 * THAT MANIFEST'S LINEAGE go back to the POS-IMPORT manifest (guarded by their current manifest; a
 * lot placed there by hand stays), then those manifests are deleted when empty and carrying no work.
 * The re-home then re-plans the lots (its Apply rebuilds their Received-date manifests).
 */
export async function rollbackMailPlan(admin: Admin, importId: string): Promise<MailRollbackResult> {
  const source = await findSourceManifest(admin, importId);
  const mine = (await readImportRebuiltInfo(admin, importId)).filter((m) => m.payload_group_kind === EMAIL_GROUP_KIND || m.payload_group_kind === UNMATCHED_GROUP_KIND);
  let movedBack = 0;
  for (const m of mine) {
    if (!m.barcodes) throw new Error(`Manifest ${m.id} has no barcode lineage; rollback refuses to guess which lots are ours.`);
    const ours = new Set(m.barcodes);
    const read = await pagedAllChecked<{ id: string; ccrs_inventory_external_id: string | null }>(async (from, to) => {
      const { data, error } = await admin.from("inventory_lots").select("id, ccrs_inventory_external_id").eq("manifest_id", m.id).order("id", { ascending: true }).range(from, to);
      return { ok: !error, rows: (data as { id: string; ccrs_inventory_external_id: string | null }[] | null) ?? [] };
    });
    if (!read.verdict.complete) throw new Error(`Rollback could not read the lots on ${m.id}. ${read.verdict.message} Run it again.`);
    const ids = read.rows.filter((l) => l.ccrs_inventory_external_id != null && ours.has(l.ccrs_inventory_external_id.trim())).map((l) => l.id);
    for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) {
      const { data, error } = await admin.from("inventory_lots").update({ manifest_id: source.id }).in("id", ids.slice(i, i + REHOME_MOVE_BATCH)).eq("manifest_id", m.id).select("id");
      if (error) throw new Error(`Rollback stopped moving lots (${error.message}); run it again.`);
      movedBack += ((data as { id: string }[] | null) ?? []).length;
    }
    for (let i = 0; i < ids.length; i += REHOME_MOVE_BATCH) {
      const { count, error } = await admin.from("inventory_lots").select("id", { count: "exact", head: true }).eq("manifest_id", m.id).in("id", ids.slice(i, i + REHOME_MOVE_BATCH));
      if (error) throw new Error(`Rollback could not re-check ${m.id} (${error.message}); run it again.`);
      if ((count ?? 0) > 0) throw new Error(`Rollback is not making progress on ${m.id} (lots still there after being moved back); stopped. Run it again.`);
    }
  }
  let deleted = 0;
  let keptNonEmpty = 0;
  let keptWithWork = 0;
  for (const m of mine) {
    let state: "empty" | "lots" | "work";
    try {
      state = await emptyWithoutWork(admin, m.id);
    } catch (e) {
      throw new Error(`Rollback ${e instanceof Error ? e.message : String(e)}.`);
    }
    if (state === "lots") keptNonEmpty += 1;
    if (state === "work") keptWithWork += 1;
    if (state !== "empty") continue;
    const { data, error } = await admin
      .from("inbound_manifests")
      .delete()
      .eq("id", m.id)
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .eq("raw_payload->>import_id", importId)
      .in("raw_payload->>group_kind", [EMAIL_GROUP_KIND, UNMATCHED_GROUP_KIND])
      .select("id");
    if (error) throw new Error(`Rollback could not delete ${m.id} (${error.message}).`);
    deleted += ((data as { id: string }[] | null) ?? []).length;
  }
  return { movedBack, deleted, keptNonEmpty, keptWithWork };
}

export { loadRehomeSources };

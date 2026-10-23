/**
 * src/lib/inventory/cultivera-survivorship.ts   (R74 S14, store)
 *
 * Owner, round 2 answer 3: "Manifest wins on name, type, cost; Cultivera wins
 * on category, quantity." Runs inside Start on a rebuilt manifest (by hand or
 * by the S13 automatic Start), after the onboarding rows are seeded:
 *
 *   1. the manifest's line source:
 *        group_kind "email"  -> raw_payload.line_facts (written by R74 S10)
 *        a transfer          -> the kept Cultivera transfer file (R50 S3b),
 *                               parsed by the native vendor parser
 *        anything else       -> no line source: nothing changes
 *   2. each OPEN onboarding row (status "draft") is matched to its lot's line
 *      by barcode (lot_code or CCRS barcode; disagreeing lines = not guessed);
 *   3. planSurvivorship: name / type / cost land as attached facts with
 *      source "manifest" and on the row's own columns; a person's value is
 *      kept; category and quantity are never written.
 *
 * WHAT IT NEVER DOES: write a lot (stock, quantity, cost accounting and CCRS
 * stay Cultivera's), touch an approved row, or change a live card. Every
 * failure lands in the run's errors; nothing throws to the caller.
 */
import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DRAFT_FACT_COLUMNS,
  DRAFT_FACT_SELECT,
  PROVENANCE_TABLE,
  buildProvenanceRow,
  isMissingAttachedFactsError,
} from "@/lib/catalog/attach-facts-core";
import { identityForDraft } from "@/lib/catalog/product-identity-core";
import { parseVendorJson } from "@/lib/inventory/intake-parser";
import { loadWciaText } from "@/lib/inventory/cultivera-wcia-store";
import { parseTransferId, wciaStorageKey } from "@/lib/inventory/cultivera-wcia-core";
import { EMAIL_GROUP_KIND } from "@/lib/pos/cultivera-mail-apply-core";
import {
  emptySurvivorshipRun,
  landedFromLine,
  lineForLot,
  lineIndexFromEmailPayload,
  lineIndexFromParsedLines,
  planSurvivorship,
  type LineIndex,
  type LineSource,
  type SurvivorshipRun,
} from "@/lib/inventory/cultivera-survivorship-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const short = (e: unknown) =>
  (e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e)
  ).slice(0, 160);

/** Lot ids per `.in()` read (URL length). */
export const SURVIVORSHIP_LOT_CHUNK = 150;

export type SurvivorshipLineage = { group_kind?: unknown; import_id?: unknown; cultivera_transfer_id?: unknown };

type Loaded = { kind: "index"; source: LineSource; index: LineIndex } | { kind: "none" } | { kind: "error"; source: LineSource; error: string };

async function loadLineIndex(admin: Admin, manifestId: string, lineage: SurvivorshipLineage): Promise<Loaded> {
  if (lineage.group_kind === EMAIL_GROUP_KIND) {
    const { data, error } = await admin.from("inbound_manifests").select("id, raw_payload").eq("id", manifestId).maybeSingle();
    if (error) return { kind: "error", source: "emailed_manifest", error: `the emailed manifest's lines could not be read: ${short(error)}` };
    const payload = (data as { raw_payload?: unknown } | null)?.raw_payload;
    const lineFacts = payload && typeof payload === "object" ? (payload as Record<string, unknown>).line_facts : undefined;
    if (lineFacts === undefined || lineFacts === null) return { kind: "error", source: "emailed_manifest", error: "the emailed manifest has no line facts on file" };
    return { kind: "index", source: "emailed_manifest", index: lineIndexFromEmailPayload(lineFacts) };
  }
  const transferId = parseTransferId(lineage.cultivera_transfer_id);
  if (transferId === null) return { kind: "none" };
  const key = wciaStorageKey(lineage.import_id, transferId);
  if (!key) return { kind: "none" };
  const loaded = await loadWciaText(admin, key);
  if (loaded.kind === "missing") return { kind: "none" };
  if (loaded.kind === "unreadable") return { kind: "error", source: "transfer_file", error: `vendor transfer file: ${loaded.error}` };
  const parsed = parseVendorJson(loaded.text);
  if (!parsed.ok) return { kind: "error", source: "transfer_file", error: `vendor transfer file: ${parsed.error}` };
  return { kind: "index", source: "transfer_file", index: lineIndexFromParsedLines(parsed.manifest.lines) };
}

type DraftRow = {
  id: string;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  chosen_website_category: string | null;
  strain_name: string | null;
  lot_id: string | null;
  pos_product_key: string | null;
  inventory_type: string | null;
  unit_cost_minor_units: number | null;
} & Record<string, unknown>;

export async function applyManifestSurvivorship(
  admin: Admin,
  manifestId: string,
  lineage: SurvivorshipLineage,
  actorId: string | null,
): Promise<SurvivorshipRun> {
  let loaded: Loaded;
  try {
    loaded = await loadLineIndex(admin, manifestId, lineage);
  } catch (e) {
    return { ...emptySurvivorshipRun(null), errors: [short(e)] };
  }
  if (loaded.kind === "none") return emptySurvivorshipRun(null);
  if (loaded.kind === "error") return { ...emptySurvivorshipRun(loaded.source), errors: [loaded.error] };
  const run = emptySurvivorshipRun(loaded.source);
  const index = loaded.index;

  const [FACTS, PROV] = DRAFT_FACT_COLUMNS;
  const dr = await admin
    .from("catalog_product_drafts")
    .select(
      `id, name, brand_name, vendor_name, category, chosen_website_category, strain_name, lot_id, pos_product_key, inventory_type, unit_cost_minor_units, ${DRAFT_FACT_SELECT}`,
    )
    .eq("manifest_id", manifestId)
    .eq("status", "draft");
  if (dr.error) {
    run.errors.push(
      isMissingAttachedFactsError(dr.error)
        ? "manifest values not applied: migration 0235 (attached facts) is not applied"
        : `manifest values not applied: onboarding rows could not be read: ${short(dr.error)}`,
    );
    return run;
  }
  const drafts = ((dr.data as unknown as DraftRow[] | null) ?? []).filter((d) => d.lot_id);
  if (drafts.length === 0) return run;

  const lotIds = Array.from(new Set(drafts.map((d) => d.lot_id as string)));
  const lots = new Map<string, { lot_code: unknown; ccrs_inventory_external_id: unknown }>();
  for (let i = 0; i < lotIds.length; i += SURVIVORSHIP_LOT_CHUNK) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, ccrs_inventory_external_id")
      .in("id", lotIds.slice(i, i + SURVIVORSHIP_LOT_CHUNK));
    if (error) {
      // A short read would leave some rows on Cultivera's values without saying so: apply nothing.
      run.errors.push(`manifest values not applied: the lots' barcodes could not be read: ${short(error)}`);
      return run;
    }
    for (const l of (data as { id: string; lot_code: unknown; ccrs_inventory_external_id: unknown }[] | null) ?? []) lots.set(l.id, l);
  }

  const at = new Date().toISOString();
  const provRows: unknown[] = [];
  for (const d of drafts) {
    const lot = lots.get(d.lot_id as string);
    const hit = lot ? lineForLot(index, lot) : ({ kind: "none" } as const);
    if (hit.kind === "none") {
      run.noLine += 1;
      continue;
    }
    if (hit.kind === "ambiguous") {
      run.ambiguous += 1;
      continue;
    }
    const plan = planSurvivorship(
      { name: d.name, inventory_type: d.inventory_type, unit_cost_minor_units: d.unit_cost_minor_units, facts: d[FACTS], provenance: d[PROV] },
      hit.facts,
      at,
      actorId,
    );
    run.keptHuman += plan.keptHuman.length;
    if (!plan.patch) {
      run.unchanged += 1;
      continue;
    }
    const up = await admin.from("catalog_product_drafts").update(plan.patch).eq("id", d.id).eq("status", "draft").select("id");
    if (up.error) {
      run.errors.push(`${(d.name ?? "a row").slice(0, 60)}: ${short(up.error)}`);
      continue;
    }
    // Approved (or dismissed) since the read: nothing was written, so nothing is counted or recorded.
    if (((up.data as unknown[] | null) ?? []).length === 0) continue;
    run.updated += 1;
    for (const c of plan.changed) run.changedByField[c.field] += 1;
    const after = { ...d, ...plan.patch } as DraftRow;
    const landed = landedFromLine(hit.facts);
    for (const f of plan.written) {
      const l = landed.find((x) => x.field === f);
      if (!l) continue;
      const built = buildProvenanceRow({
        identityKey: identityForDraft(after).identityKey,
        field: f,
        value: l.value,
        source: "manifest",
        confidence: null,
        draftId: d.id,
        lotId: d.lot_id,
        posProductKey: d.pos_product_key,
        actorId,
      });
      if (built.ok) provRows.push(built.row);
    }
  }
  if (provRows.length > 0) {
    try {
      const { error } = await admin.from(PROVENANCE_TABLE).insert(provRows as never);
      if (error && !isMissingAttachedFactsError(error)) run.errors.push(`fact history not recorded: ${short(error)}`);
    } catch (err) {
      run.errors.push(`fact history not recorded: ${short(err)}`);
    }
  }
  return run;
}

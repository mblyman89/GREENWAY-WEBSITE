/**
 * src/lib/catalog/lab-facts-attach.ts  (R30)
 *
 * The server half of the FIRST-PASS lab attach. Owner (R30): "I want all of
 * this attachment process to happen at onboarding the first pass through" /
 * "should also update the strain library with the newly learned terpenes".
 *
 * For every onboarding draft of ONE manifest (status draft or approved):
 *
 *   drafts -> inventory_lots.lab_result_id -> lab_results.coa_extract_json
 *          -> lab-facts-attach-core planLabFactsAttach (pure, self-tested)
 *          -> catalog_product_drafts.attached_facts (mergeDraftAttachedFacts:
 *             a person's value is never replaced)
 *          -> product_fact_provenance (one row per fact written, source "coa")
 *          -> kb_strains.terpenes (fill-only union, plain flower only,
 *             existing row only, never archived) + sources tag
 *          -> one audit row per run
 *
 * Called from the finalize (intake-store, AFTER the draft seed and the
 * certificate read have both settled) and from Re-read lab certificate.
 *
 * Never throws. A database without 0235 (attached facts) returns
 * { unmigrated: true } and writes nothing; without 0252 (stored read) there is
 * simply nothing to attach. Bounded: one manifest, chunked IN reads.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { recordAudit } from "@/lib/auth/audit";
import { identityForDraft, strainSlug } from "@/lib/catalog/product-identity-core";
import {
  DRAFT_FACT_COLUMNS,
  DRAFT_FACT_SELECT,
  PROVENANCE_TABLE,
  buildProvenanceRow,
  isMissingAttachedFactsError,
  mergeDraftAttachedFacts,
  type ProductFactProvenanceInsert,
} from "@/lib/catalog/attach-facts-core";
import {
  changedLabFacts,
  emptyLabFactsRun,
  labRowInputs,
  planLabFactsAttach,
  planStrainTerpeneWrite,
  type LabFactsAttachRun,
  type LabFactsPlan,
  type StrainTerpeneRow,
} from "@/lib/catalog/lab-facts-attach-core";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import { readStoredCoaExtract } from "@/lib/inventory/coa-facts-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const LAB_FACTS_ATTACH_AUDIT_ACTION = "catalog.lab_facts_attach";

const DRAFT_COLS =
  "id, name, brand_name, vendor_name, category, chosen_website_category, strain_name, lot_id, pos_product_key, inventory_type";

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
} & Record<string, unknown>;

type LabRow = {
  id: string;
  coa_extract_json: unknown;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  cbd_pct: number | null;
};

const short = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 140);

/**
 * Attach every stored lab-certificate fact to the manifest's onboarding
 * drafts, and teach the strain library the flower terpenes.
 */
export async function attachLabFactsToManifestDrafts(
  manifestId: string,
  actorId: string | null,
): Promise<LabFactsAttachRun> {
  const run = emptyLabFactsRun();
  if (!isSupabaseServiceConfigured || !manifestId) return run;
  try {
    const admin = createSupabaseAdminClient();

    // 1. Drafts (with their fact columns: survivorship needs the current value).
    const dr = await admin
      .from("catalog_product_drafts")
      .select(`${DRAFT_COLS}, ${DRAFT_FACT_SELECT}`)
      .eq("manifest_id", manifestId)
      .in("status", ["draft", "approved"]);
    if (dr.error) {
      if (isMissingAttachedFactsError(dr.error)) return { ...run, unmigrated: true };
      run.errors.push(`onboarding rows could not be read: ${short(dr.error)}`);
      return run;
    }
    const drafts = ((dr.data as unknown as DraftRow[] | null) ?? []).filter((d) => d.lot_id);
    run.drafts = drafts.length;
    if (drafts.length === 0) return run;

    // 2. Lots -> lab results.
    const labs = await loadLabsForLots(admin, Array.from(new Set(drafts.map((d) => d.lot_id as string))));
    if (labs === null) return run; // 0252 not applied: nothing has been read, nothing to attach.

    const at = new Date().toISOString();
    const provRows: ProductFactProvenanceInsert[] = [];
    /** strain slug -> learned KB terpene slugs (strongest first, deduped across lots). */
    const learnedBySlug = new Map<string, string[]>();
    const perDraft: { id: string; written: string[] }[] = [];

    // 3. Plan + merge + write each draft.
    for (const d of drafts) {
      const lab = labs.get(d.lot_id as string);
      if (!lab) continue;
      const plan = planLabFactsAttach({
        extract: readStoredCoaExtract(lab.coa_extract_json),
        product: { name: d.name, inventoryType: d.inventory_type, strainName: d.strain_name },
        lab: { totalThcPct: lab.total_thc_pct, totalCbdPct: lab.total_cbd_pct ?? lab.cbd_pct },
      });
      if (plan.noTerpenePanel && plan.facts.length > 0) run.noPanel += 1;
      if (plan.strainTerpenes.length > 0) {
        const slug = strainSlug(d.strain_name);
        if (slug) {
          const cur = learnedBySlug.get(slug) ?? [];
          for (const t of plan.strainTerpenes) if (!cur.includes(t)) cur.push(t);
          learnedBySlug.set(slug, cur);
        }
      }
      // No-op suppression (MDM change detection): a value already stored from
      // this same lab read is not re-written, re-stamped or re-audited.
      const landed = changedLabFacts(d[DRAFT_FACT_COLUMNS[0]], plan.facts);
      if (landed.length === 0) continue;
      const merged = mergeDraftAttachedFacts({
        existingFacts: d[DRAFT_FACT_COLUMNS[0]],
        existingProvenance: d[DRAFT_FACT_COLUMNS[1]],
        landed,
        at,
        by: actorId,
        urls: [],
      });
      run.kept += merged.keptHuman.length;
      if (!merged.patch) continue;
      const up = await admin.from("catalog_product_drafts").update(merged.patch).eq("id", d.id);
      if (up.error) {
        if (isMissingAttachedFactsError(up.error)) return { ...run, unmigrated: true };
        run.errors.push(`${(d.name ?? "a row").slice(0, 60)}: ${short(up.error)}`);
        continue;
      }
      run.attached += 1;
      run.facts += merged.written.length;
      perDraft.push({ id: d.id, written: merged.written });
      const identityKey = identityForDraft(d).identityKey;
      for (const f of landed) {
        if (!merged.written.includes(f.field)) continue;
        const built = buildProvenanceRow({
          identityKey,
          field: f.field,
          value: f.value,
          source: "coa",
          confidence: null,
          draftId: d.id,
          lotId: d.lot_id,
          posProductKey: d.pos_product_key,
          actorId,
        });
        if (built.ok) provRows.push(built.row);
      }
    }

    // 4. Provenance (one insert; a missing table is a note, not a failure).
    if (provRows.length > 0) {
      try {
        const { error } = await admin.from(PROVENANCE_TABLE).insert(provRows);
        if (error && !isMissingAttachedFactsError(error)) run.errors.push(`fact history not recorded: ${short(error)}`);
      } catch (err) {
        run.errors.push(`fact history not recorded: ${short(err)}`);
      }
    }

    // 5. Strain library (fill-only).
    const strainChanges: { slug: string; added: string[] }[] = [];
    for (const [slug, learned] of learnedBySlug) {
      const r = await readStrainTerpenes(admin, slug);
      if (!r.ok) {
        run.errors.push(`strain ${slug} could not be read: ${r.error}`);
        continue;
      }
      const w = planStrainTerpeneWrite(r.row, learned, { withSources: r.withSources });
      if (w.action !== "update") continue;
      const { error } = await admin.from("kb_strains").update(w.patch).eq("id", w.id);
      if (error) {
        run.errors.push(`strain ${slug} could not be updated: ${short(error)}`);
        continue;
      }
      run.strainsUpdated += 1;
      run.strainTerpenesAdded += w.added.length;
      strainChanges.push({ slug, added: w.added });
    }

    // 6. Audit (one row per run that changed something).
    if (run.attached > 0 || run.strainsUpdated > 0) {
      await recordAudit({
        actorId,
        action: LAB_FACTS_ATTACH_AUDIT_ACTION,
        entityType: "manifest",
        entityId: manifestId,
        after: {
          drafts: run.drafts,
          attached: run.attached,
          facts: run.facts,
          kept: run.kept,
          perDraft,
          strains: strainChanges,
          provenanceRows: provRows.length,
        },
      });
    }
    return run;
  } catch (err) {
    run.errors.push(short(err));
    return run;
  }
}

/** lotId -> its lab result row. null when 0252 (coa_extract_json) is not applied. */
async function loadLabsForLots(admin: Admin, lotIds: readonly string[]): Promise<Map<string, LabRow> | null> {
  const out = new Map<string, LabRow>();
  try {
    const lots = await chunkedIn<string, { id: string; lab_result_id: string | null }>(lotIds, async (chunk, from, to) => {
      const { data, error } = await admin.from("inventory_lots").select("id, lab_result_id").in("id", chunk).order("id", { ascending: true }).range(from, to);
      if (error) throw error;
      return (data as { id: string; lab_result_id: string | null }[] | null) ?? [];
    });
    const labIdByLot = new Map<string, string>();
    for (const l of lots) if (l.lab_result_id) labIdByLot.set(l.id, l.lab_result_id);
    const labIds = Array.from(new Set(labIdByLot.values()));
    if (labIds.length === 0) return out;
    const labs = await chunkedIn<string, LabRow>(labIds, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("lab_results")
        .select("id, coa_extract_json, total_thc_pct, total_cbd_pct, cbd_pct")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data as LabRow[] | null) ?? [];
    });
    const byId = new Map(labs.map((l) => [l.id, l] as const));
    for (const [lot, labId] of labIdByLot) {
      const l = byId.get(labId);
      if (l) out.set(lot, l);
    }
    return out;
  } catch (err) {
    if (isMissingColumnError(err as { code?: string; message?: string })) return null;
    throw err;
  }
}

/**
 * The strain row's terpenes (+ status / sources when those columns exist:
 * 0085 status, 0020 sources). Each optional group is probed on its own so a
 * missing column never hides the row.
 */
async function readStrainTerpenes(
  admin: Admin,
  slug: string,
): Promise<{ ok: true; row: StrainTerpeneRow | null; withSources: boolean } | { ok: false; error: string }> {
  const base = await admin.from("kb_strains").select("id, terpenes").eq("slug", slug).maybeSingle();
  if (base.error) return { ok: false, error: short(base.error) };
  if (!base.data) return { ok: true, row: null, withSources: false };
  const row: StrainTerpeneRow = { ...(base.data as { id: string; terpenes: string[] | null }) };
  const st = await admin.from("kb_strains").select("status").eq("slug", slug).maybeSingle();
  if (!st.error && st.data) row.status = (st.data as { status: string | null }).status;
  else if (st.error && !isMissingColumnError(st.error)) return { ok: false, error: short(st.error) };
  const so = await admin.from("kb_strains").select("sources").eq("slug", slug).maybeSingle();
  let withSources = false;
  if (!so.error && so.data) {
    withSources = true;
    row.sources = (so.data as { sources: string[] | null }).sources;
  } else if (so.error && !isMissingColumnError(so.error)) return { ok: false, error: short(so.error) };
  return { ok: true, row, withSources };
}

// --- Page loader (Product Onboarding) -----------------------------------------

export type DraftLabView = {
  plan: LabFactsPlan;
  coaTerpenes: { name: string; ppm: number }[];
  coaRead: boolean;
};

/**
 * One bounded read for the onboarding page: each shown draft's stored
 * certificate read (by the draft's own lab_result_id), planned with the SAME
 * pure planner the attach uses, plus the strain library's terpenes for the
 * shown strains. Never throws: any failure returns empty maps and the page
 * renders exactly as before.
 */
export async function loadLabViewsForDrafts(
  drafts: readonly { id: string; name: string | null; inventory_type: string | null; strain_name: string | null; lab_result_id: string | null }[],
): Promise<{ byDraft: Map<string, DraftLabView>; strainTerpenes: Map<string, string[]> }> {
  const byDraft = new Map<string, DraftLabView>();
  const strainTerpenes = new Map<string, string[]>();
  if (!isSupabaseServiceConfigured || drafts.length === 0) return { byDraft, strainTerpenes };
  const admin = createSupabaseAdminClient();
  try {
    const labIds = Array.from(new Set(drafts.map((d) => d.lab_result_id).filter((v): v is string => Boolean(v))));
    if (labIds.length > 0) {
      const labs = await chunkedIn<string, LabRow>(labIds, async (chunk, from, to) => {
        const { data, error } = await admin
          .from("lab_results")
          .select("id, coa_extract_json, total_thc_pct, total_cbd_pct, cbd_pct")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return (data as LabRow[] | null) ?? [];
      });
      const byId = new Map(labs.map((l) => [l.id, l] as const));
      for (const d of drafts) {
        const lab = d.lab_result_id ? byId.get(d.lab_result_id) : undefined;
        if (!lab) continue;
        const extract = readStoredCoaExtract(lab.coa_extract_json);
        if (!extract) continue;
        const plan = planLabFactsAttach({
          extract,
          product: { name: d.name, inventoryType: d.inventory_type, strainName: d.strain_name },
          lab: { totalThcPct: lab.total_thc_pct, totalCbdPct: lab.total_cbd_pct ?? lab.cbd_pct },
        });
        byDraft.set(d.id, { plan, ...labRowInputs(extract) });
      }
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (!isMissingColumnError(e)) console.error("[lab-facts] onboarding lab read failed:", e?.message ?? String(err));
    byDraft.clear();
  }
  try {
    const slugs = Array.from(new Set(drafts.map((d) => strainSlug(d.strain_name)).filter(Boolean)));
    if (slugs.length > 0) {
      const rows = await chunkedIn<string, { slug: string; terpenes: string[] | null }>(slugs, async (chunk, from, to) => {
        const { data, error } = await admin.from("kb_strains").select("slug, terpenes").in("slug", chunk).order("slug", { ascending: true }).range(from, to);
        if (error) throw error;
        return (data as { slug: string; terpenes: string[] | null }[] | null) ?? [];
      });
      for (const r of rows) if (Array.isArray(r.terpenes) && r.terpenes.length > 0) strainTerpenes.set(r.slug, r.terpenes);
    }
  } catch (err) {
    console.error("[lab-facts] strain terpene read failed:", err instanceof Error ? err.message : String(err));
    strainTerpenes.clear();
  }
  return { byDraft, strainTerpenes };
}

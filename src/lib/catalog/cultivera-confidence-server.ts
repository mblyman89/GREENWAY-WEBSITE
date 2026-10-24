/**
 * src/lib/catalog/cultivera-confidence-server.ts  (R74 S38)
 *
 * Server half of the Cultivera vendor confidence scorecard (pure rules in
 * cultivera-confidence-core.ts). Cultivera only: every read starts from the
 * vendor's REBUILT manifests (loadCultiveraVendors) and the attach re-checks
 * the manifest kind (loadRebuiltManifestIds) - any other draft is refused.
 *
 * No new write path. Facts land through the single door attachProductFacts()
 * (as the person's confirmed answer - the person pressed the button), and
 * approval goes through approveDraftWithPrice() with every gate (category,
 * type, compliance, category hold). The menu is staged ONCE per manifest.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { postProcessLookup, type RawProductLookup } from "@/lib/inventory/product-lookup-core";
import { attachProductFacts } from "@/lib/catalog/attach-facts";
import { attachedFactsOf } from "@/lib/catalog/fact-chips-core";
import { loadCultiveraVendors } from "@/lib/inventory/cultivera-vendor";
import { loadRebuiltManifestIds } from "@/lib/inventory/cultivera-onboarding";
import { rowsForVendor, type VendorRollup } from "@/lib/inventory/cultivera-vendor-core";
import { approveDraftWithPrice, loadStrainTypeSignals } from "@/lib/inventory/catalog-drafts";
import {
  CONFIDENCE_AUDIT_ACTION,
  CONFIDENCE_BUDGET_MS,
  planProduct,
  runSentence,
  scoreProduct,
  vendorScorecard,
  type AttachMode,
  type ProductScore,
  type RunTally,
  type ScoredValue,
  type VendorScorecard,
} from "@/lib/catalog/cultivera-confidence-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const PAGE = 500;
const CHUNK = 100;

type DraftRow = { id: string; name: string; manifest_id: string; chosen_strain_type: string | null; strain_name: string | null; lot_id: string | null; attached_facts?: unknown };

export type VendorConfidence = {
  vendor: string;
  scorecard: VendorScorecard;
  products: ProductScore[];
  attachedFields: Map<string, Set<string>>;
};

export type ConfidenceOverview =
  | { ok: true; vendors: VendorRollup[]; selected: VendorConfidence | null }
  | { ok: false; error: string };

async function readDrafts(admin: Admin, manifestIds: string[]): Promise<DraftRow[]> {
  const out: DraftRow[] = [];
  for (let i = 0; i < manifestIds.length; i += CHUNK) {
    const ids = manifestIds.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select("id, name, manifest_id, chosen_strain_type, strain_name, lot_id, attached_facts")
        .in("manifest_id", ids)
        .eq("status", "draft")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`onboarding rows: ${error.message}`);
      const rows = (data as DraftRow[] | null) ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** The newest finished lookup per draft: its compact v2 facts (snapshot.facts.f). */
async function readFacts(admin: Admin, draftIds: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for (let i = 0; i < draftIds.length; i += CHUNK) {
    const ids = draftIds.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("lookup_job_items")
        .select("draft_id, finished_at, f:result_json->snapshot->facts->f")
        .in("draft_id", ids)
        .eq("status", "done")
        .order("finished_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`lookup results: ${error.message}`);
      const rows = (data as { draft_id: string; f: unknown }[] | null) ?? [];
      for (const r of rows) {
        const k = String(r.draft_id).toLowerCase();
        if (!out.has(k) && r.f) out.set(k, r.f);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Score every in-review product of one Cultivera vendor. */
export async function loadVendorConfidence(vendor: string, rows?: Awaited<ReturnType<typeof loadCultiveraVendors>>): Promise<VendorConfidence | { error: string }> {
  if (!isSupabaseServiceConfigured) return { error: "The database is not configured." };
  const load = rows ?? (await loadCultiveraVendors());
  if (!load.ok) return { error: load.error };
  const mine = rowsForVendor(load.rows, vendor);
  if (mine.length === 0) return { error: "That vendor has no Cultivera manifests." };
  const admin = createSupabaseAdminClient();
  try {
    const drafts = await readDrafts(admin, mine.map((r) => r.id));
    const facts = await readFacts(admin, drafts.map((d) => d.id));
    const evidence = new Map<string, { kb: string | null; manifest: string | null }>();
    for (let i = 0; i < drafts.length; i += CHUNK) {
      const sig = await loadStrainTypeSignals(drafts.slice(i, i + CHUNK).map((d) => ({ id: d.id, name: d.name, strain_name: d.strain_name, lot_id: d.lot_id })));
      for (const [k, v] of sig.evidence) evidence.set(k, v);
    }
    const attachedFields = new Map<string, Set<string>>();
    const products = drafts.map((d) => {
      const ev = evidence.get(d.id) ?? { kb: null, manifest: null };
      attachedFields.set(d.id, new Set(Object.keys(attachedFactsOf(d as unknown as Record<string, unknown>) ?? {})));
      return scoreProduct({
        draftId: d.id,
        name: d.name,
        manifestId: d.manifest_id,
        compactFacts: facts.get(d.id.toLowerCase()) ?? null,
        chosenStrain: d.chosen_strain_type,
        kbStrain: ev.kb,
        manifestStrain: ev.manifest,
      });
    });
    products.sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || a.name.localeCompare(b.name));
    return { vendor: mine[0].vendor, scorecard: vendorScorecard(products), products, attachedFields };
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

export async function loadConfidenceOverview(vendor: string): Promise<ConfidenceOverview> {
  const load = await loadCultiveraVendors();
  if (!load.ok) return { ok: false, error: load.error };
  if (!vendor) return { ok: true, vendors: load.vendors, selected: null };
  const sel = await loadVendorConfidence(vendor, load);
  if ("error" in sel) return { ok: false, error: sel.error };
  return { ok: true, vendors: load.vendors, selected: sel };
}

function rawFor(attach: readonly ScoredValue[]): RawProductLookup {
  const get = (f: string) => attach.find((a) => a.field === f)?.value;
  const list = (f: string) => (Array.isArray(get(f)) ? (get(f) as string[]) : []);
  const text = (f: string) => (typeof get(f) === "string" ? (get(f) as string) : "");
  return {
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: list("effects"),
    aroma_notes: list("aroma"),
    flavor_notes: list("flavor"),
    lineage: "",
    found: true,
    description: text("description"),
    short_description: text("short_description"),
    category: "",
    potency_ratio: "",
    size: "",
    image_candidates: [],
  };
}

/**
 * The button: attach (and, with a strain type, approve) a Cultivera vendor's
 * products. Resumable: products already carrying every planned fact and not
 * approvable are skipped, approved ones leave the review list.
 */
export async function runVendorConfidenceAttach(input: {
  vendor: string;
  mode: AttachMode;
  draftIds?: readonly string[];
  actor: { userId: string | null; email: string | null };
  now?: () => number;
}): Promise<{ ok: boolean; sentence: string; tally?: RunTally }> {
  const now = input.now ?? (() => Date.now());
  const t0 = now();
  const vc = await loadVendorConfidence(input.vendor);
  if ("error" in vc) return { ok: false, sentence: vc.error };
  // Cultivera gate (fail closed): only rebuilt manifests.
  const rebuilt = await loadRebuiltManifestIds(vc.products.map((p) => p.manifestId));
  if (!rebuilt) return { ok: false, sentence: "Could not confirm these are Cultivera manifests, so nothing was attached. Try again." };
  const want = input.mode === "selected" ? new Set((input.draftIds ?? []).map((x) => x.toLowerCase())) : null;
  if (want && want.size === 0) return { ok: false, sentence: "Tick at least one product first." };
  const todo = vc.products.filter((p) => rebuilt.has(p.manifestId) && (!want || want.has(p.draftId.toLowerCase())));
  const banned = await loadBannedPhrases();
  const t: RunTally = { products: 0, attached: 0, approved: 0, waitingStrain: 0, refused: 0, skipped: 0, left: 0, errors: [] };
  const stage = new Set<string>();
  for (let i = 0; i < todo.length; i += 1) {
    if (now() - t0 > CONFIDENCE_BUDGET_MS) {
      t.left = todo.length - i;
      break;
    }
    const p = todo[i];
    const plan = planProduct(p, input.mode);
    if (plan.attach.length === 0 && !plan.approve) {
      t.skipped += 1;
      continue;
    }
    const have = vc.attachedFields.get(p.draftId) ?? new Set<string>();
    const pending = plan.attach.filter((a) => !have.has(a.field));
    t.products += 1;
    try {
      if (pending.length > 0) {
        const res = await attachProductFacts({
          context: { kind: "draft", draftId: p.draftId },
          safe: postProcessLookup(rawFor(pending), banned),
          sources: [],
          factConfidence: {},
          suggestionConfidence: {},
          suggestionSource: "human:cultivera-confidence",
          actor: input.actor,
          confirmedBy: "human",
        });
        if (!res.ok) {
          t.errors.push(`${p.name}: ${res.error}`.slice(0, 160));
          continue;
        }
        t.attached += res.receipt.attached.length;
      }
      if (!plan.approve) {
        if (p.strain === null) t.waitingStrain += 1;
        else t.skipped += 1;
        continue;
      }
      const ap = await approveDraftWithPrice(p.draftId, 0, input.actor.userId, { chosenStrainType: p.strain }, { skipStaging: true });
      if (ap.ok) {
        t.approved += 1;
        stage.add(p.manifestId);
      } else t.refused += 1;
    } catch (err) {
      t.errors.push(`${p.name}: ${String(err instanceof Error ? err.message : err)}`.slice(0, 160));
    }
  }
  if (stage.size > 0) {
    const { stageIntakeMenuVersionForManifest } = await import("@/lib/pos/intake-menu-staging");
    for (const m of stage) {
      try {
        await stageIntakeMenuVersionForManifest(m, input.actor.userId, { batchCount: t.approved });
      } catch (err) {
        t.errors.push(`menu refresh: ${String(err).slice(0, 120)}`);
      }
    }
  }
  const sentence = runSentence(t);
  await recordAudit({
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
    action: CONFIDENCE_AUDIT_ACTION,
    entityType: "vendor",
    entityId: vc.vendor,
    after: { mode: input.mode, scorecard: vc.scorecard, tally: t, manifestsStaged: [...stage] },
  });
  return { ok: t.errors.length === 0, sentence, tally: t };
}

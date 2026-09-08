/**
 * Does a sizeless LIQUID EDIBLE (a type covered by BOTH the original
 * MG_FACT_TYPES block and the new bucket pass) get warned about twice?
 */
import { buildDraftInjectionPlan } from "@/lib/pos/draft-injection-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

function inject(name: string, inventoryType: string, websiteCategory: string) {
  const draft = {
    id: "d1",
    pos_product_key: "KEY-1",
    name,
    brand_name: "Brand",
    vendor_name: "Vendor",
    strain_name: null,
    thc_pct: null,
    cbd_pct: null,
    total_thc_pct: null,
    potency_json: null,
    price_minor_units: 1000,
    updated_at: "2026-01-01T00:00:00Z",
    inventory_type: inventoryType,
  } as unknown as ApprovedDraftForInjection;
  const enrichment = new Map<string, DraftEnrichment>([
    ["d1", { websiteCategory, strainType: null, onHandQty: 5, packageLabel: "each" } as DraftEnrichment],
  ]);
  const plan = buildDraftInjectionPlan({
    drafts: [draft],
    existingKeys: new Set<string>(),
    enrichmentByDraftId: enrichment,
    baseSortOrder: 100,
  });
  const missing = plan.diagnostics.filter((d) => d.code === "net_volume_missing");
  return { count: missing.length, messages: missing.map((m) => m.message) };
}

for (const [name, t, c] of [
  ["Mystery Tonic", "Liquid Edible", "edible-liquid"],
  ["Mystery Tincture", "Tincture", "edible-liquid"],
  ["Mystery Soda", "Soda", "edible-liquid"],
  ["Mystery Balm", "Topical", "topical"],
] as Array<[string, string, string]>) {
  const r = inject(name, t, c);
  console.log(`${t.padEnd(16)} "${name}" -> ${r.count} warning(s)`);
  for (const m of r.messages) console.log(`     ${m}`);
}

// R50 S3: the REAL Cultivera onboarding chain against the PG15 + PostgREST harness.
// Copy to the repo root to run (imports @/), then delete. Seed: seed.sql; undo: undo.sql.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { startCultiveraManifestOnboarding, loadCultiveraManifestSection } from "@/lib/inventory/cultivera-onboarding";
import { approveDraftWithPrice } from "@/lib/inventory/catalog-drafts";
import { stageIntakeMenuVersionForManifest } from "@/lib/pos/intake-menu-staging";
const M = "5c3a0000-0000-4000-8000-000000000001";
(async () => {
  const admin = createSupabaseAdminClient();
  const t0 = Date.now();
  const r1 = await startCultiveraManifestOnboarding(M, null);
  console.log("START#1", JSON.stringify({ ...r1, ms: Date.now() - t0 }));
  const r2 = await startCultiveraManifestOnboarding(M, null);
  console.log("START#2", JSON.stringify(r2));
  const { data: drafts } = await admin
    .from("catalog_product_drafts")
    .select("id, pos_product_key, status, suggested_price_minor_units, price_floor_minor_units, price_rationale, identity_key, kb_product_id, attached_facts, lot_id")
    .eq("manifest_id", M)
    .order("pos_product_key");
  console.log("DRAFTS", JSON.stringify(drafts));
  const wrongKind = await startCultiveraManifestOnboarding("5c2c1000-0000-4000-8000-000000000002", null);
  console.log("START-NATIVE", JSON.stringify(wrongKind));
  for (const d of (drafts ?? []) as { id: string; pos_product_key: string }[]) {
    const a = await approveDraftWithPrice(d.id, 1, null);
    console.log("APPROVE", d.pos_product_key, JSON.stringify(a));
  }
  const { data: after } = await admin.from("catalog_product_drafts").select("pos_product_key, status, price_minor_units, kb_product_id").eq("manifest_id", M).order("pos_product_key");
  console.log("AFTER", JSON.stringify(after));
  console.log("STAGE", JSON.stringify(await stageIntakeMenuVersionForManifest(M, null)));
  const sec = await loadCultiveraManifestSection(1);
  console.log("SECTION", JSON.stringify(sec));
  const { data: ev } = await admin.from("manifest_events").select("event_type, note").eq("manifest_id", M);
  console.log("EVENTS", JSON.stringify(ev));
  const { count } = await admin.from("product_fact_provenance").select("id", { count: "exact", head: true }).eq("source", "cultivera");
  console.log("PROV", count);
})().catch((e) => { console.log("THREW", e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });

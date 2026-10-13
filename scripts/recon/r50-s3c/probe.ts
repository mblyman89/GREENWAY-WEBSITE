// R50 S3c/S3d: REAL refresh staging against the PG15 + PostgREST harness.
// Copy to the repo root as _probe.ts (imports @/), run, delete. Seed: seed.sql; undo: undo.sql.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { startCultiveraManifestOnboarding } from "@/lib/inventory/cultivera-onboarding";
import { approveDraftWithPrice } from "@/lib/inventory/catalog-drafts";
import { loadCultiveraManifestIds } from "@/lib/inventory/cultivera-received-flag-server";
import { lotFlaggedCultivera } from "@/lib/inventory/cultivera-received-flag-core";

const M = "5c3a0000-0000-4000-8000-000000000001";
const NATIVE = "5c2c1000-0000-4000-8000-000000000002";
const CARD = "source_item_id, name, product_name, brand_name, category, filter_categories, pos_inventory_type, pos_inventory_category, strain_type, strain_name, thc, cbd, description, price_label, price_minor_units, hidden, inventory_status, sort_order, fact_provenance";

(async () => {
  const admin = createSupabaseAdminClient();
  const live = async (tag: string) => {
    const { data: v } = await admin.from("menu_versions").select("id, status, notes").eq("status", "published").maybeSingle();
    const { data: items } = await admin.from("menu_items").select(`id, ${CARD}`).eq("menu_version_id", (v as { id: string }).id).order("source_item_id");
    const ids = ((items ?? []) as { id: string }[]).map((i) => i.id);
    const { data: vars } = await admin.from("menu_variants").select("menu_item_id, source_variant_id, label, price_minor_units").in("menu_item_id", ids).order("source_variant_id");
    const byItem = new Map<string, unknown[]>();
    for (const x of (vars ?? []) as { menu_item_id: string }[]) {
      const { menu_item_id, ...rest } = x;
      byItem.set(menu_item_id, [...(byItem.get(menu_item_id) ?? []), rest]);
    }
    const cards = ((items ?? []) as { id: string }[]).map(({ id, ...c }) => ({ ...c, variants: byItem.get(id) ?? [] }));
    console.log(tag, JSON.stringify({ version: (v as { id: string }).id, notes: (v as { notes: string | null }).notes, cards }));
    return cards as Record<string, unknown>[];
  };

  const before = await live("LIVE-BEFORE");
  const r1 = await startCultiveraManifestOnboarding(M, null);
  console.log("START", JSON.stringify({ ok: r1.ok }));
  const { data: drafts } = await admin.from("catalog_product_drafts").select("id, pos_product_key, status").eq("manifest_id", M).order("pos_product_key");
  for (const d of (drafts ?? []) as { id: string; pos_product_key: string }[]) {
    const a = await approveDraftWithPrice(d.id, 1, null);
    console.log("APPROVE", d.pos_product_key, JSON.stringify(a));
  }
  const after = await live("LIVE-AFTER");

  // Sellable stays sellable: these must be byte-identical per card.
  const PROTECTED = ["source_item_id", "price_label", "price_minor_units", "hidden", "inventory_status", "sort_order", "variants"];
  const pick = (c: Record<string, unknown>) => JSON.stringify(PROTECTED.map((k) => c[k]));
  console.log("PROTECTED-EQUAL", before.length === after.length && before.every((b, i) => pick(b) === pick(after[i])));
  const CHANGED = ["name", "brand_name", "pos_inventory_category", "description", "strain_type", "thc", "cbd"];
  for (let i = 0; i < after.length; i++) {
    const diff = CHANGED.filter((k) => JSON.stringify(before[i][k]) !== JSON.stringify(after[i][k])).map((k) => `${k}: ${JSON.stringify(before[i][k])} -> ${JSON.stringify(after[i][k])}`);
    console.log("CARD", after[i].source_item_id, JSON.stringify(diff));
  }

  const { data: versions } = await admin.from("menu_versions").select("status, notes, summary_json").order("created_at");
  for (const v of (versions ?? []) as { status: string; notes: string | null; summary_json: Record<string, unknown> | null }[]) {
    console.log("VERSION", v.status, JSON.stringify(v.notes), JSON.stringify(v.summary_json?.cultivera_refresh ?? null));
  }
  const { data: ev } = await admin.from("manifest_events").select("event_type, note").eq("manifest_id", M).order("created_at");
  console.log("EVENTS", JSON.stringify(ev));
  const { data: lots } = await admin.from("inventory_lots").select("id, manifest_id, notes, status, on_hand_qty, unit_cost_minor_units, fact_provenance").eq("manifest_id", M).order("id");
  console.log("LOTS", JSON.stringify((lots ?? []).map((l) => ({ ...l, notes: undefined }))));

  // S3d flag on the real rows: rebuilt manifest flagged, native manifest not.
  const { data: nativeLots } = await admin.from("inventory_lots").select("id, manifest_id, notes").eq("manifest_id", NATIVE).limit(3);
  const all = [...((lots ?? []) as { manifest_id: string; notes: string | null }[]), ...((nativeLots ?? []) as { manifest_id: string; notes: string | null }[])];
  const set = await loadCultiveraManifestIds(all);
  console.log("FLAG-SET", JSON.stringify([...set].sort()));
  console.log("FLAG", JSON.stringify(all.map((l) => `${l.manifest_id.slice(0, 8)}:${lotFlaggedCultivera(l, set)}`)));
})().catch((e) => {
  console.log("THREW", e instanceof Error ? e.stack : String(e));
  process.exitCode = 1;
});

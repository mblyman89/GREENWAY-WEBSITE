/**
 * src/lib/pos/cultivera-strain-fix-store.ts — R15b server side of
 * cultivera-strain-fix-core.ts (the KB strain-type fixer for one import).
 *
 * Writes, all FILL-ONLY (a strain type someone already set is never
 * overwritten here):
 *   - menu_items.strain_type on this import's versions PLUS the live/staged
 *     intake-origin versions that carry its cards (mirrorTargetVersionIds, the
 *     same widening recordFactReview uses), only where it is still unknown,
 *     with fact_provenance.strain_type = "kb" | "reviewer";
 *   - inventory_lots.strain_type for those cards' lots
 *     (pos_product_key = source_item_id), only where null/unknown;
 *   - kb_strains (optional, human-pressed only): gap-fill / create through
 *     decideKbStrainTypeWrite, and a confirmed non-exact match adds the
 *     Cultivera spelling as an alias so the next import matches exactly.
 * The live menu also overlays the KB type by strain name at render time
 * (strain-terpenes-server.ts buildMenuIndexes), so the website follows.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { mirrorTargetVersionIds, type MirrorVersionRow } from "@/lib/pos/publish-now-core";
import { getVersionItems } from "@/lib/pos/menu-version";
import { loadActiveStrains } from "@/lib/ai/kb/intake-strain-match-server";
import { planStrainFix, kbSlugForStrainName, type StrainFixPlan } from "@/lib/pos/cultivera-strain-fix-core";
import { decideKbStrainTypeWrite } from "@/lib/inventory/strain-type-intel-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The import's own staged/published version (the one the import page reads). */
async function ownVersionId(admin: Admin, importId: string): Promise<string | null> {
  const { data } = await admin
    .from("menu_versions")
    .select("id, created_at")
    .eq("import_id", importId)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
}

export async function loadStrainFixPlan(importId: string): Promise<{ plan: StrainFixPlan; versionFound: boolean }> {
  const admin = createSupabaseAdminClient();
  const vid = await ownVersionId(admin, importId);
  if (!vid) return { plan: planStrainFix([], []), versionFound: false };
  const [items, strains] = await Promise.all([getVersionItems(vid), loadActiveStrains()]);
  const plan = planStrainFix(
    items.map((i) => ({
      sourceItemId: i.source_item_id,
      name: i.name,
      productName: i.product_name,
      strainName: i.strain_name,
      strainType: i.strain_type,
    })),
    strains,
  );
  return { plan, versionFound: true };
}

async function targetVersionIds(admin: Admin, importId: string): Promise<string[]> {
  const [own, carried] = await Promise.all([
    admin.from("menu_versions").select("id, import_id, status").eq("import_id", importId),
    admin.from("menu_versions").select("id, import_id, status").is("import_id", null).in("status", ["published", "staged"]),
  ]);
  if (own.error) throw new Error(`Could not read this import's menu versions: ${own.error.message}`);
  if (carried.error) throw new Error(`Could not read the live menu versions: ${carried.error.message}`);
  return mirrorTargetVersionIds(
    [...((own.data ?? []) as MirrorVersionRow[]), ...((carried.data ?? []) as MirrorVersionRow[])],
    importId,
  );
}

export type StrainApplyResult = { cards: number; lots: number };

/**
 * Apply one type to a set of cards (fill-only). Provenance is merged by
 * grouping rows that share the same existing provenance blob, so a strain
 * with hundreds of cards costs a handful of writes, not one per row.
 */
export async function applyStrainTypeToCards(
  importId: string,
  assignments: ReadonlyArray<{ sourceItemIds: readonly string[]; type: GreenwayStrainType; provenance: "kb" | "reviewer" | "name" }>,
  actorId: string | null,
): Promise<StrainApplyResult> {
  const admin = createSupabaseAdminClient();
  const versionIds = await targetVersionIds(admin, importId);
  let cards = 0;
  let lots = 0;
  for (const a of assignments) {
    if (a.sourceItemIds.length === 0) continue;
    // 1. Menu cards still unknown (the column is NOT NULL default 'unknown').
    if (versionIds.length > 0) {
      const rows = await chunkedIn<string, { id: string; fact_provenance: unknown }>(a.sourceItemIds, async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select("id, fact_provenance")
          .in("menu_version_id", versionIds)
          .in("source_item_id", chunk)
          .eq("strain_type", "unknown")
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(`Could not read the cards to fix: ${error.message}`);
        return (data ?? []) as { id: string; fact_provenance: unknown }[];
      });
      const byProv = new Map<string, { prov: Record<string, string>; ids: string[] }>();
      for (const r of rows) {
        const prov =
          r.fact_provenance && typeof r.fact_provenance === "object" && !Array.isArray(r.fact_provenance)
            ? (r.fact_provenance as Record<string, string>)
            : {};
        const k = JSON.stringify(prov);
        const e = byProv.get(k) ?? { prov, ids: [] };
        e.ids.push(r.id);
        byProv.set(k, e);
      }
      for (const { prov, ids } of byProv.values()) {
        for (let i = 0; i < ids.length; i += 200) {
          const slice = ids.slice(i, i + 200);
          const { error } = await admin
            .from("menu_items")
            .update({ strain_type: a.type, fact_provenance: { ...prov, strain_type: a.provenance } })
            .in("id", slice)
            .eq("strain_type", "unknown");
          if (error) throw new Error(`Could not update the cards: ${error.message}`);
          cards += slice.length;
        }
      }
    }
    // 2. The cards' lots, only where no type is set yet.
    for (let i = 0; i < a.sourceItemIds.length; i += 200) {
      const chunk = a.sourceItemIds.slice(i, i + 200);
      const { data, error } = await admin
        .from("inventory_lots")
        .update({ strain_type: a.type, updated_by: actorId })
        .in("pos_product_key", chunk)
        .or("strain_type.is.null,strain_type.eq.unknown")
        .select("id");
      if (error) throw new Error(`Cards updated, but their lots could not be: ${error.message}`);
      lots += (data ?? []).length;
    }
  }
  return { cards, lots };
}

export type KbWriteOutcome = { action: "create" | "set" | "flip" | "skip" | "alias"; slug: string; reason: string };

/** Human-pressed KB write: gap-fill/create the strain's type, or add the Cultivera spelling as an alias. */
export async function saveStrainChoiceToKb(input: {
  strainName: string;
  kbSlug: string | null;
  type: GreenwayStrainType;
  addAlias: boolean;
  actorId: string | null;
}): Promise<KbWriteOutcome> {
  const admin = createSupabaseAdminClient();
  const slug = input.kbSlug ?? kbSlugForStrainName(input.strainName);
  const { data, error } = await admin.from("kb_strains").select("id, strain_type, aliases").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Could not read the strain library: ${error.message}`);
  const existing = data as { id: string; strain_type: string | null; aliases: string[] | null } | null;

  if (input.addAlias && existing) {
    const alias = input.strainName.trim();
    const aliases = existing.aliases ?? [];
    if (!aliases.some((x) => x.toLowerCase() === alias.toLowerCase())) {
      const { error: aErr } = await admin
        .from("kb_strains")
        .update({ aliases: [...aliases, alias], updated_by: input.actorId })
        .eq("id", existing.id);
      if (aErr) throw new Error(`Could not add the alias: ${aErr.message}`);
    }
  }
  const decision = decideKbStrainTypeWrite({
    exists: Boolean(existing),
    existingType: existing?.strain_type ?? null,
    verdict: input.type,
    // The owner pressed it, but a curated KB type is NOT flipped from this
    // bulk-cleanup screen: gap-fill/create only (the Strain library edits a curated value).
    source: "auto",
  });
  if (decision.action === "create") {
    const { error: cErr } = await admin.from("kb_strains").insert({
      slug,
      name: input.strainName.trim(),
      strain_type: input.type,
      active: true,
      created_by: input.actorId,
      updated_by: input.actorId,
    });
    if (cErr) throw new Error(`Could not add the strain to the library: ${cErr.message}`);
  } else if (decision.action === "set") {
    const { error: sErr } = await admin
      .from("kb_strains")
      .update({ strain_type: input.type, updated_by: input.actorId })
      .eq("id", existing!.id);
    if (sErr) throw new Error(`Could not save the type to the library: ${sErr.message}`);
  }
  return { action: input.addAlias && decision.action === "skip" ? "alias" : decision.action, slug, reason: decision.reason };
}

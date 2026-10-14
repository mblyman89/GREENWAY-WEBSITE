/**
 * src/lib/pos/card-alias-server.ts  (R50 A1)
 *
 * Server-only: re-computes, for ONE Product Onboarding row, exactly what the
 * page showed - the restock verdict, the row's identity and the S4
 * suggestions - so "Yes, same product" can only ever save a card the scorer
 * suggests for that row right now (card-alias-core acceptCheck). The posted
 * card key is never trusted on its own.
 *
 * Same inputs as the page (src/app/admin/inventory/drafts/page.tsx): the
 * delivery's review rows, category = chosen ?? resolved, the lot's size
 * label, and the same loadRestockPreview.
 */
import "server-only";
import { listCatalogDrafts, loadStrainTypeSignals } from "@/lib/inventory/catalog-drafts";
import { resolveWebsiteCategoriesWithLiveKeys } from "@/lib/inventory/website-category-resolver-server";
import { loadRestockPreview } from "@/lib/inventory/restock-preview-server";
import type { AcceptEvidence } from "@/lib/pos/card-alias-core";

export async function loadAcceptEvidence(manifestId: string, draftId: string): Promise<AcceptEvidence | null> {
  try {
    const drafts = (await listCatalogDrafts("draft", { manifestId })).filter((d) => d.status === "draft");
    if (!drafts.some((d) => d.id === draftId)) {
      return { verdictKind: null, identity: null, suggested: [] };
    }
    const [{ resolutions }, signals] = await Promise.all([
      resolveWebsiteCategoriesWithLiveKeys(
        drafts.map((d) => ({
          posProductKey: d.pos_product_key,
          productName: d.name,
          inventoryType: d.inventory_type,
          category: d.category,
        })),
      ),
      loadStrainTypeSignals(drafts),
    ]);
    const preview = await loadRestockPreview(
      drafts.map((d, i) => ({
        id: d.id,
        pos_product_key: d.pos_product_key,
        name: d.name,
        brand_name: d.brand_name,
        vendor_name: d.vendor_name,
        strain_name: d.strain_name,
        category: d.chosen_website_category?.trim() || resolutions[i]?.websiteCategory || null,
        size_label: signals.sizeLabels.get(d.id) ?? null,
      })),
    );
    if (!preview.ok) return null;
    const group = preview.groups.find((g) => g.draftIds.includes(draftId)) ?? null;
    const s = preview.suggestions?.get(draftId) ?? null;
    return {
      verdictKind: preview.verdicts.get(draftId)?.kind ?? null,
      identity: group?.identity ?? null,
      suggested: s ? [s.best, ...s.others].map((c) => ({ cardKey: c.cardKey, cardName: c.cardName })) : [],
    };
  } catch (err) {
    console.error("[card-alias-server] evidence failed:", err);
    return null;
  }
}

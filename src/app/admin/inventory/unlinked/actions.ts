"use server";
/**
 * /admin/inventory/unlinked: the owner's "Link to this card" press (D195 step 2).
 *
 * Order of checks (each refuses with a plain-English reason, nothing half-done):
 *   1. inventory.manage permission;
 *   2. fresh reads of the published menu and the lot (fail closed);
 *   3. the pure re-check (checkRelink): the lot still carries the key the
 *      owner saw, is not rejected/destroyed, is still on no card, and the
 *      confirmed card is still one of its best matches;
 *   4. the compare-and-set write on the OLD key (unlinked-stock-store);
 *   5. the size link (when the size is known), the audit row, and the
 *      revalidation of Inventory and every Promotions page.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePromotionSurfaces } from "@/lib/promotions/revalidate-promotions";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { checkRelink, UNLINKED_STOCK_HREF } from "@/lib/inventory/unlinked-stock-core";
import { loadLotForRelink, loadUnlinkedCards, relinkLotToCard } from "@/lib/inventory/unlinked-stock-store";
import { setLotSizeLink } from "@/lib/inventory/lot-size-link-store";

function back(msg: string, tone: "ok" | "error"): never {
  redirect(`${UNLINKED_STOCK_HREF}?msg=${encodeURIComponent(msg)}&tone=${tone}`);
}

export async function relinkUnlinkedLotAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const lotId = String(formData.get("lot_id") ?? "").trim();
  const expectedOldKey = String(formData.get("old_key") ?? "").trim();
  const cardKey = String(formData.get("card_key") ?? "").trim();
  const sizeId = String(formData.get("size_id") ?? "").trim() || null;
  if (!lotId || !expectedOldKey || !cardKey) back("Missing lot or card. Reload and try again.", "error");

  const [cards, lotRead] = await Promise.all([loadUnlinkedCards(), loadLotForRelink(lotId)]);
  if (!cards.ok) back(cards.error, "error");
  if (!lotRead.ok) back(lotRead.error, "error");

  const check = checkRelink(lotRead.lot, cards.cards, { expectedOldKey, cardKey, sizeId });
  if (!check.ok) back(check.error, "error");
  const s = check.suggestion;

  const write = await relinkLotToCard(lotId, expectedOldKey, s.cardKey, session.userId);
  if (!write.ok) back(`Linking failed: ${write.error}`, "error");
  if (!write.relinked) back("This lot changed since the page loaded (another save got there first). Nothing was changed.", "error");

  // The size is a separate, optional link (migration 0294). A failure here
  // leaves the lot correctly on its card; the owner sets the size on the lot.
  let sizeNote = "";
  if (s.sizeId) {
    const size = await setLotSizeLink(lotId, s.sizeId);
    sizeNote = size.ok ? ` as ${s.sizeLabel ?? "its size"}` : `. The size could not be saved (${size.error}); set it on the lot page`;
  } else {
    sizeNote = ". Pick its size on the lot page";
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.relinked_to_card",
    entityType: "inventory_lot",
    entityId: lotId,
    before: { pos_product_key: expectedOldKey },
    after: {
      pos_product_key: s.cardKey,
      pos_product_key_source: "owner_entered",
      menu_source_variant_id: s.sizeId,
      size_label: s.sizeLabel,
      card_name: s.cardName,
      match: s.tier,
      reasons: s.reasons,
      ccrs_identity_unchanged: true,
      changes: [`Linked to menu card ${s.cardName} (${s.cardKey}) from barcode key ${expectedOldKey}`],
    },
  });

  revalidatePath(UNLINKED_STOCK_HREF);
  revalidatePath(`/admin/inventory/${lotId}`);
  revalidatePath("/admin/inventory");
  revalidatePromotionSurfaces();
  revalidatePublicMenuSurfaces();
  back(`Linked ${lotRead.lot?.productName ?? "the lot"} to ${s.cardName}${sizeNote}.`, "ok");
}

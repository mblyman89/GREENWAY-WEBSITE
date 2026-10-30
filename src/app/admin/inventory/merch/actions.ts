"use server";
/**
 * R73 S7 - Merch inventory actions (permission inventory.manage, audited).
 *   setMerchStatusAction  hide a product from greenwaymerch.com / put it back
 *   removeMerchAction     remove it from the catalog (and its print PNGs)
 *   syncMerchStockAction  copy Printful's US stock onto every variant, so the
 *                         merch site hides colours/sizes Printful can't make
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl } from "@/lib/supabase/env";
import { applyStock, printKeyFromUrl, removeItem, setItemStatus, type MerchItemStatus } from "@/lib/merch/merch-inventory-core";
import { readMerchCatalog, updateMerchCatalog } from "@/lib/merch/merch-inventory-store";
import { loadPrintfulStock } from "@/lib/merch/merch-inventory-server";

const PAGE = "/admin/inventory/merch";
const back = (q: string): never => redirect(`${PAGE}?${q}`);

export async function setMerchStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const handle = String(formData.get("handle") ?? "");
  const status: MerchItemStatus = formData.get("status") === "hidden" ? "hidden" : "live";
  const res = await updateMerchCatalog((c) => setItemStatus(c, handle, status, new Date().toISOString()) ?? "That product isn't in the catalog any more.");
  if (!res.ok) back(`error=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: status === "hidden" ? "merch.product_hidden" : "merch.product_shown", entityType: "merch_product", entityId: handle });
  revalidatePath(PAGE);
  back(`done=${encodeURIComponent(status === "hidden" ? `${handle} is hidden from greenwaymerch.com (within about a minute).` : `${handle} is live on greenwaymerch.com again (within about a minute).`)}`);
}

export async function removeMerchAction(formData: FormData): Promise<void> {
  // Phase 4 (G-30A; D47 "Q05b-3- owner and admin."): removal is owner/admin.
  const session = await requirePermission("merch.remove");
  const handle = String(formData.get("handle") ?? "");
  if (String(formData.get("confirm") ?? "") !== handle) back(`error=${encodeURIComponent("Type the product's web name exactly to confirm removal.")}`);
  const cur = await readMerchCatalog();
  const item = cur.catalog.items.find((i) => i.handle === handle);
  const res = await updateMerchCatalog((c) => removeItem(c, handle) ?? "That product isn't in the catalog any more.");
  if (!res.ok) back(`error=${encodeURIComponent(res.error)}`);
  // Print PNGs we uploaded for it (public media bucket, merch-print/ prefix only). Best effort.
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/media`;
  const keys = (item?.pkg.printFiles ?? []).map((f) => printKeyFromUrl(f.url, prefix)).filter((k): k is string => !!k);
  if (keys.length) await createSupabaseAdminClient().storage.from("media").remove(keys).catch(() => null);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "merch.product_removed", entityType: "merch_product", entityId: handle, before: item ? { title: item.pkg.product.title, variants: item.pkg.variants.length } : null });
  revalidatePath(PAGE);
  back(`done=${encodeURIComponent(`${handle} was removed. Past orders in Printful are not affected.`)}`);
}

export async function syncMerchStockAction(): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const cur = await readMerchCatalog();
  if (cur.readError) back(`error=${encodeURIComponent(cur.readError)}`);
  const ids = [...new Set(cur.catalog.items.map((i) => i.pkg.product.blank.printfulProductId))];
  const stock = await loadPrintfulStock(ids);
  if (stock.problem && stock.map.size === 0) back(`error=${encodeURIComponent(stock.problem)}`);
  let changed = 0; let checked = 0;
  const res = await updateMerchCatalog((c) => { const r = applyStock(c, stock.map, new Date().toISOString()); changed = r.changed; checked = r.checked; return r.catalog; });
  if (!res.ok) back(`error=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "merch.stock_synced", entityType: "merch_catalog", entityId: "merch_catalog", after: { checked, changed } });
  revalidatePath(PAGE);
  back(`done=${encodeURIComponent(`Checked ${checked} variant${checked === 1 ? "" : "s"} at Printful; ${changed} changed on greenwaymerch.com.${stock.problem ? ` Note: ${stock.problem}` : ""}`)}`);
}

/**
 * GET /admin/inventory/merch/export - R73 S7: every merch variant as CSV
 * (status, stock, price, cost, profit, units sold, revenue).
 */
import { requirePermission } from "@/lib/auth/session";
import { inventoryCsv, inventoryView, salesByVariant } from "@/lib/merch/merch-inventory-core";
import { readMerchCatalog } from "@/lib/merch/merch-inventory-store";
import { loadPrintfulStock } from "@/lib/merch/merch-inventory-server";
import { loadMerchOrderBoard } from "@/lib/orders/merch-orders-server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await requirePermission("inventory.manage");
  const { catalog, readError } = await readMerchCatalog();
  if (readError) return new Response(`Couldn't read the merch catalog: ${readError}`, { status: 503 });
  const [stock, board] = await Promise.all([loadPrintfulStock(catalog.items.map((i) => i.pkg.product.blank.printfulProductId)), loadMerchOrderBoard()]);
  const csv = inventoryCsv(inventoryView(catalog, stock.map, salesByVariant(board.orders)));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="merch-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * POST /api/merch-stock  (D232 slice M-6, SOP-11 G-83)
 *
 * The shop (greenwaymerch.com) relays Printful's stock_updated event here so
 * a colour Printful runs out of disappears from the shop within a minute,
 * not at the next 6-hourly cron. Server-to-server only, the same shared
 * secret as the catalog feed: `Authorization: Bearer <MERCH_CATALOG_TOKEN>`
 * (compared in constant time). No token configured or a wrong one -> 404.
 *
 * Body: { productId: number }. The event only names the garment; we re-read
 * that garment's stock from Printful (never trust the relayed body) and
 * apply it with the same compare-and-set write as the button and the cron.
 * Audited as merch.stock_synced, actor "printful:stock_updated".
 */
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import { runMerchStockCopy } from "@/lib/merch/merch-stock-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const token = (process.env.MERCH_CATALOG_TOKEN ?? "").trim();
  if (token.length < 32) return notFound();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeEqualStr(provided, token)) return notFound();
  const body = (await req.json().catch(() => null)) as { productId?: unknown } | null;
  const id = Number(body?.productId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, error: "productId must be a positive whole number." }, { status: 400, headers: HEADERS });
  const r = await runMerchStockCopy({ source: "printful:stock_updated", onlyProductIds: [id] });
  return Response.json(r, { status: r.ok ? 200 : 502, headers: HEADERS });
}

/**
 * R73 S7 - GET /api/merch-catalog: the LIVE products published from Merch
 * Studio, for the separate greenwaymerch.com server only.
 *
 * Owner rule (R71): "No product details can reach the main site." So this is
 * NOT public: it answers only a request carrying
 * `Authorization: Bearer <MERCH_CATALOG_TOKEN>` (the same long random secret
 * set in BOTH Vercel projects; compared in constant time). No token
 * configured -> 404, wrong token -> 404 (nothing to discover). Never cached
 * by a CDN, never indexed. Only live items, via merchFeed (no Printful
 * sync-product body, no notes, no drafts, no hidden items).
 */
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import { merchFeed } from "@/lib/merch/merch-inventory-core";
import { readMerchCatalog } from "@/lib/merch/merch-inventory-store";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function GET(req: Request): Promise<Response> {
  const token = (process.env.MERCH_CATALOG_TOKEN ?? "").trim();
  if (token.length < 32) return notFound();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeEqualStr(provided, token)) return notFound();
  const { catalog, readError } = await readMerchCatalog();
  // A read failure must not look like "everything was unpublished": 503 lets
  // the merch site keep its last good copy.
  if (readError) return Response.json({ error: "catalog unavailable" }, { status: 503, headers: HEADERS });
  return Response.json({ v: 1, products: merchFeed(catalog) }, { headers: HEADERS });
}

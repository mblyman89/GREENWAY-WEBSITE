/**
 * GET /api/health  (back office -> greenwaymerch.com), D232 M-2 (G-80).
 *
 * The back office's Merch Health page and daily check ask the shop how it
 * is doing: is checkout open, is the Stripe key live, is the Stripe webhook
 * registered and enabled, are card holds waiting, did the catalog feed work,
 * is email set up. Read-only. Never returns a secret value.
 *
 * Auth: `Authorization: Bearer <MERCH_HEALTH_TOKEN>`, its own token (owner
 * decision D232, Q-11-3: "Q3: yes."). Missing / short token or a wrong one ->
 * 404, the same as the catalog feed, so the route does not advertise itself.
 */
import { secretMatches } from "@/lib/orders-core";
import { gatherShopHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(req: Request): Promise<Response> {
  const expected = (process.env.MERCH_HEALTH_TOKEN ?? "").trim();
  if (expected.length < 32) return notFound();
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!secretMatches(given, expected)) return notFound();
  const health = await gatherShopHealth();
  return Response.json(health, { headers: { "Cache-Control": "no-store" } });
}

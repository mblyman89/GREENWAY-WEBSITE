/**
 * POST /api/merch-alerts  (D232 slice M-7, SOP-11 G-85)
 *
 * greenwaymerch.com posts each owner alert here (lib/fulfillment.ts
 * alertOwner) so it shows in the back office (Merch Health and Orders), with
 * Acknowledge. Email stays a second channel. Server-to-server only, the same
 * shared secret as the catalog feed and the stock relay:
 * `Authorization: Bearer <MERCH_CATALOG_TOKEN>` (constant-time compare).
 * No token configured or a wrong one -> 404.
 *
 * Body: { subject: string, lines?: string[] }. Cleaned and size-capped
 * (merch-alerts-core.ts); one row per distinct alert (0361 merch_alerts).
 * Table missing -> 503 (the shop just logs it; the email still went).
 */
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import { readAlertPost } from "@/lib/merch/merch-alerts-core";
import { recordMerchAlert } from "@/lib/merch/merch-alerts-server";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function POST(req: Request): Promise<Response> {
  const token = (process.env.MERCH_CATALOG_TOKEN ?? "").trim();
  if (token.length < 32) return notFound();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!timingSafeEqualStr(provided, token)) return notFound();
  const parsed = readAlertPost(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400, headers: HEADERS });
  const r = await recordMerchAlert(parsed.alert);
  return Response.json(r, { status: r.ok ? 200 : 503, headers: HEADERS });
}

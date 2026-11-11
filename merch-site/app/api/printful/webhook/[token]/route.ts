/**
 * POST /api/printful/webhook/<PRINTFUL_WEBHOOK_TOKEN>  (Printful -> us)
 *
 * Printful v1 webhooks are unsigned, so the URL carries a long random secret
 * (compared in constant time). Register it once (see merch-site/README.md):
 *   POST https://api.printful.com/webhooks
 *   {"url":"https://greenwaymerch.com/api/printful/webhook/<token>",
 *    "types":["package_shipped","order_failed","order_canceled","order_put_hold"]}
 *
 * D232 M-6 (G-89): register it from the back office instead - Merch Health
 * -> "Register / repair the Printful webhook" sends all 5 types below.
 *
 * package_shipped -> branded "your order shipped" email with tracking link.
 * order_failed / order_canceled / order_put_hold -> owner alert email.
 * stock_updated (M-6, G-83) -> relayed to the back office's /api/merch-stock
 *   (Bearer MERCH_CATALOG_TOKEN, no redirect follow), which re-reads that
 *   garment's stock from Printful and updates the catalog; the shop sees it
 *   within a minute. The 6-hourly cron is the safety net if this fails.
 * Always 200 once authenticated, so Printful never storms retries.
 */
import { getMerchContent } from "@/lib/site-content";
import { alertOwner, sendEmail } from "@/lib/fulfillment";
import { isOrderRef } from "@/lib/catalog-core";
import { readPrintfulEvent, readStockEvent, secretMatches, shippedEmail } from "@/lib/orders-core";
import { catalogSourceUrl } from "@/lib/catalog";
import { contact, siteUrl, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!secretMatches(token, process.env.PRINTFUL_WEBHOOK_TOKEN)) return new Response("Not found", { status: 404 });

  const raw = await req.json().catch(() => null);
  const stockProduct = readStockEvent(raw);
  if (stockProduct) {
    const token = (process.env.MERCH_CATALOG_TOKEN ?? "").trim();
    let note = "stock relay skipped (MERCH_CATALOG_TOKEN not set)";
    if (token.length >= 32) {
      const url = new URL("/api/merch-stock", catalogSourceUrl()).toString();
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ productId: stockProduct }), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
      note = res ? `stock relay ${res.status}` : "stock relay failed (network)";
      if (!res || res.status !== 200) console.error(`[merch-stock] ${note} for Printful product ${stockProduct}; the 6-hourly copy will catch it.`);
    }
    return Response.json({ ok: true, note });
  }
  const a = readPrintfulEvent(raw);
  // Only act on orders this site created (gm- refs); other store orders are ignored.
  if (a.kind === "ignore" || !isOrderRef(a.orderRef)) return Response.json({ ok: true, note: "ignored" });

  if (a.kind === "problem") {
    await alertOwner(`Printful: ${a.type.replace(/_/g, " ")} - ${a.orderRef}`, [
      `Order ${a.orderRef} (${a.name || "?"}, ${a.email || "no email"})`,
      `Reason: ${a.reason || "(none given)"}`,
      `Open Printful > Orders and search ${a.orderRef}. Refund in Stripe if it can't be fixed.`,
    ]);
    return Response.json({ ok: true });
  }

  const c = contact();
  const w = await getMerchContent();
  const mail = shippedEmail(a, { name: SITE_NAME, url: siteUrl(), contactEmail: c.email }, { subject: w["merch.email.shipped.subject"], note: w["merch.email.shipped.note"], signoff: w["merch.email.signoff"] });
  const sent = a.email ? await sendEmail({ to: a.email, ...mail, replyTo: c.email || undefined }) : { ok: false, error: "no customer email" };
  if (!sent.ok) {
    await alertOwner(`Shipped email NOT sent for ${a.orderRef}`, [`Reason: ${sent.error}`, `Tracking: ${a.trackingNumber || "?"} ${a.trackingUrl || ""}`, "Printful's own shipment email (if enabled in Printful settings) still goes out."]);
  }
  return Response.json({ ok: true });
}

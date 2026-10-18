/**
 * POST /api/printful/webhook/<PRINTFUL_WEBHOOK_TOKEN>  (Printful -> us)
 *
 * Printful v1 webhooks are unsigned, so the URL carries a long random secret
 * (compared in constant time). Register it once (see merch-site/README.md):
 *   POST https://api.printful.com/webhooks
 *   {"url":"https://greenwaymerch.com/api/printful/webhook/<token>",
 *    "types":["package_shipped","order_failed","order_canceled","order_put_hold"]}
 *
 * package_shipped -> branded "your order shipped" email with tracking link.
 * order_failed / order_canceled / order_put_hold -> owner alert email.
 * Always 200 once authenticated, so Printful never storms retries.
 */
import { getMerchContent } from "@/lib/site-content";
import { alertOwner, sendEmail } from "@/lib/fulfillment";
import { isOrderRef } from "@/lib/catalog-core";
import { readPrintfulEvent, secretMatches, shippedEmail } from "@/lib/orders-core";
import { contact, siteUrl, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!secretMatches(token, process.env.PRINTFUL_WEBHOOK_TOKEN)) return new Response("Not found", { status: 404 });

  const raw = await req.json().catch(() => null);
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

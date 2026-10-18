/**
 * POST /api/cart-preview {lines} -> server prices + display data for the cart
 * page (so the cart always shows what checkout will actually charge).
 */
import { freshProducts } from "@/lib/catalog";
import { cleanCart, priceCart } from "@/lib/catalog-core";
import { parseShippingConfig, shippingCents } from "@/lib/checkout-core";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const priced = priceCart(cleanCart((body as { lines?: unknown })?.lines), await freshProducts());
  const ship = parseShippingConfig(process.env).config;
  const units = priced.lines.reduce((s, l) => s + l.qty, 0);
  return Response.json(
    {
      lines: priced.lines.map((l) => ({
        handle: l.product.handle, variantId: l.variant.id, qty: l.qty,
        title: l.product.title, category: l.product.category, image: l.product.images[0],
        color: l.variant.color, size: l.variant.size, unitCents: l.unitCents, lineCents: l.lineCents,
      })),
      subtotalCents: priced.subtotalCents,
      shippingCents: ship && units ? shippingCents(ship, priced.subtotalCents, units) : null,
      freeOverCents: ship?.freeOverCents ?? 0,
      problems: priced.problems,
      checkoutOpen: Boolean(ship) && /^(sk|rk)_(live|test)_/.test((process.env.STRIPE_SECRET_KEY ?? "").trim()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

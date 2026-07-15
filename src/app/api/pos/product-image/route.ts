/**
 * GET /api/pos/product-image?productId=...  (POS Slice B42)
 *
 * The ONE image the register ever shows: the info card's photo, resolved
 * ONLINE-ONLY when the card opens. Per the owner-approved B42 design the
 * grid stays text-first — no per-product images ride the bundle or the
 * device cache; an offline register still shows every fact on the card,
 * just no photo.
 *
 * Device-authenticated like every /api/pos/* endpoint. Resolution uses the
 * DF-3 ladder (own approved photo → brand/vendor → category/type → global)
 * against the PUBLISHED menu item, so the register can never show an image
 * the back office didn't approve. Best-effort: any failure returns
 * { image: null } with 200 — the card renders factless-photo, never errors.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getLiveMenuItemById } from "@/lib/pos/live-menu";
import { resolveProductImage } from "@/lib/enrichment/image-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const productId = req.nextUrl.searchParams.get("productId")?.trim() ?? "";
  if (!productId) {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }

  try {
    const item = await getLiveMenuItemById(productId);
    if (!item) return NextResponse.json({ image: null });
    const resolved = await resolveProductImage({
      posKey: item.id,
      brandSlug: item.brand ?? null,
      vendorSlug: item.vendor ?? null,
      category: item.posInventoryCategory ?? item.category ?? null,
      inventoryType: item.posInventoryType ?? null,
    });
    return NextResponse.json({
      image: resolved ? { url: resolved.url, isFallback: resolved.isFallback } : null,
    });
  } catch {
    // Best-effort: the card shows facts without a photo, never an error.
    return NextResponse.json({ image: null });
  }
}

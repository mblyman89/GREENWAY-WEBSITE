/**
 * /admin/inventory/noncannabis/[id]/label — print-ready SKU label for a
 * non-cannabis product, sized 2.25in × 1.25in (a common shelf/price label) and
 * printable from the browser dialog to the same label printer configured on the
 * equipment page. Barcode is Code128 (SVG) via the dependency-free encoder.
 *
 * Non-cannabis items are NOT reported to CCRS — this is purely an internal
 * price/SKU label so staff can scan them at the register.
 */
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { BackLink } from "@/components/admin/ux";
import { getNonCannabisProduct } from "@/lib/noncannabis/store";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { code128Svg } from "@/lib/printing/code128-core";
import { nonCannabisTypeLabel } from "@/lib/naming/noncannabis-core";
import { LabelPrintControls } from "./LabelControls";

export const dynamic = "force-dynamic";

export default async function NonCannabisLabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const { back } = await searchParams;
  const [product, profile] = await Promise.all([
    getNonCannabisProduct(id),
    getStoreProfile(),
  ]);
  if (!product) notFound();

  const bc = code128Svg(product.sku.toUpperCase(), {
    moduleWidth: 2,
    height: 60,
    quietModules: 8,
  });
  const storeName = profile.storeName || profile.legalEntity || "Greenway";
  const price = `$${(Math.max(0, product.price_minor_units) / 100).toFixed(2)}`;

  return (
    <div className="label-print-root">
      <style>{`
        @page { size: 2.25in 1.25in; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          body * { visibility: hidden; }
          .label-sku, .label-sku * { visibility: visible; }
          .label-sku { position: absolute; left: 0; top: 0; box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-[520px] px-4 py-6">
        <LabelPrintControls />
        <p className="mt-3 text-xs text-[var(--admin-text-faint)]">
          2.25in × 1.25in SKU label. Press Print and choose your label printer.
        </p>
        <BackLink
          fallback="/admin/inventory/noncannabis"
          back={back}
          className="mt-2 inline-block text-xs text-[var(--admin-accent)] underline"
        >
          ← Back to non-cannabis inventory
        </BackLink>
      </div>

      <div
        className="label-sku mx-auto bg-white text-black"
        style={{
          width: "2.25in",
          height: "1.25in",
          padding: "0.08in",
          boxSizing: "border-box",
          border: "1px solid #ddd",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontFamily: "Arial, Helvetica, sans-serif",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: "6pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {storeName}
          </div>
          <div style={{ fontSize: "12pt", fontWeight: 800 }}>{price}</div>
        </div>
        <div style={{ fontSize: "8pt", fontWeight: 700, lineHeight: 1.05, overflow: "hidden" }}>
          {product.name}
        </div>
        <div style={{ fontSize: "6pt", color: "#444" }}>{nonCannabisTypeLabel(product.type)}</div>
        <div style={{ textAlign: "center" }}>
          {bc.ok ? (
            <div
              style={{ width: "100%", height: "0.42in" }}
              dangerouslySetInnerHTML={{
                __html: bc.svg.replace(/width="[^"]*"/, 'width="100%"'),
              }}
            />
          ) : (
            <div style={{ fontSize: "6pt", color: "#a00" }}>Barcode error</div>
          )}
          <div style={{ fontSize: "7pt", fontFamily: "monospace", letterSpacing: "0.04em" }}>
            {product.sku}
          </div>
        </div>
      </div>
    </div>
  );
}

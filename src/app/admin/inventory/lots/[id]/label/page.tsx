/**
 * /admin/inventory/lots/[id]/label — a print-ready 4×6 product/lot label for a
 * single inventory lot, sized for the Rollo Wireless (203 DPI, 4×6). Slice 83.
 *
 * Grounded in docs/rollo-label-printing.md: the Rollo has no cloud API, so we
 * render a pixel-accurate 4×6 page and let staff print it from the browser's
 * print dialog (the Rollo shows up as a normal AirPrint / Wi-Fi printer). This
 * is a REPRINT view — the lot already exists; nothing here touches CCRS or
 * inventory counts.
 *
 * Barcode is Code 128 (SVG) from our dependency-free encoder.
 */
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getLotById } from "@/lib/inventory/store";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { code128Svg } from "@/lib/printing/code128-core";
import { LabelPrintControls } from "@/components/admin/inventory/LabelPrintControls";

export const dynamic = "force-dynamic";

function fmt(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default async function LotLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const [lot, profile] = await Promise.all([getLotById(id), getStoreProfile()]);
  if (!lot) notFound();

  // What we encode in the barcode: prefer the lot_code, then the POS product
  // key, then the row id — always something scannable.
  const barcodeValue = (lot.lot_code || lot.pos_product_key || lot.id).toUpperCase();
  const bc = code128Svg(barcodeValue, { moduleWidth: 2, height: 90, quietModules: 10 });

  const storeName = profile.storeName || profile.legalEntity || "Greenway";

  return (
    <div className="label-print-root">
      {/* Print styles: a true 4×6 page with no margins so the Rollo does not
          scale or clip. Screen shows a card preview + controls. */}
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          .label-4x6 { box-shadow: none !important; border: none !important; }
          /* Hide the admin chrome around this route when printing. */
          body * { visibility: hidden; }
          .label-4x6, .label-4x6 * { visibility: visible; }
          .label-4x6 { position: absolute; left: 0; top: 0; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-[520px] px-4 py-6">
        <LabelPrintControls lotId={lot.id} manifestId={lot.manifest_id} />
      </div>

      {/* The label itself: 4in × 6in. All positions in inches so it is crisp on
          the 203-DPI head regardless of screen zoom. */}
      <div
        className="label-4x6 mx-auto bg-white text-black"
        style={{
          width: "4in",
          height: "6in",
          padding: "0.18in",
          boxSizing: "border-box",
          border: "1px solid #ddd",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          fontFamily: "Arial, Helvetica, sans-serif",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: "13pt", fontWeight: 700, letterSpacing: "0.02em" }}>
          {storeName}
        </div>
        <div style={{ fontSize: "8pt", color: "#333", marginBottom: "0.08in" }}>
          Product / lot label
        </div>

        <div style={{ borderTop: "2px solid #000", margin: "0.04in 0 0.12in" }} />

        <div style={{ fontSize: "15pt", fontWeight: 700, lineHeight: 1.15 }}>
          {fmt(lot.product_name)}
        </div>
        {lot.strain_name ? (
          <div style={{ fontSize: "11pt", color: "#111" }}>{lot.strain_name}</div>
        ) : null}

        <table style={{ width: "100%", marginTop: "0.1in", fontSize: "9.5pt" }}>
          <tbody>
            <tr>
              <td style={{ color: "#444", paddingRight: "0.1in" }}>Lot code</td>
              <td style={{ fontWeight: 700 }}>{fmt(lot.lot_code)}</td>
            </tr>
            <tr>
              <td style={{ color: "#444" }}>Received</td>
              <td style={{ fontWeight: 700 }}>
                {fmt(lot.received_qty)} {fmt(lot.unit)}
              </td>
            </tr>
            <tr>
              <td style={{ color: "#444" }}>On hand</td>
              <td style={{ fontWeight: 700 }}>
                {fmt(lot.on_hand_qty)} {fmt(lot.unit)}
              </td>
            </tr>
            {lot.expires_on ? (
              <tr>
                <td style={{ color: "#444" }}>Expires</td>
                <td style={{ fontWeight: 700 }}>{lot.expires_on}</td>
              </tr>
            ) : null}
            {lot.vendor_name ? (
              <tr>
                <td style={{ color: "#444" }}>Vendor</td>
                <td>{lot.vendor_name}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ flex: 1 }} />

        {/* Barcode block, bottom-anchored. */}
        <div style={{ textAlign: "center" }}>
          {bc.ok ? (
            <div
              style={{ width: "100%", height: "0.9in" }}
              dangerouslySetInnerHTML={{ __html: bc.svg.replace(/width="[^"]*"/, 'width="100%"') }}
            />
          ) : (
            <div style={{ fontSize: "8pt", color: "#a00" }}>Barcode error: {bc.error}</div>
          )}
          <div style={{ fontSize: "10pt", fontFamily: "monospace", letterSpacing: "0.05em" }}>
            {barcodeValue}
          </div>
        </div>
      </div>
    </div>
  );
}

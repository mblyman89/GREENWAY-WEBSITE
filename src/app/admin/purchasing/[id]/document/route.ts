/**
 * GET /admin/purchasing/[id]/document
 *
 * SLICE 81 — the professional Greenway-branded purchase-order document.
 * Staff-gated (inventory.manage). Returns the STANDALONE print-ready HTML
 * (letter-size @page CSS, dark-green/gold branding, both WSLCB license
 * numbers, I-502 compliance footer) rendered by the PURE po-document-core.
 *
 *   - default: inline preview (opens in a tab; the built-in button prints /
 *     saves as PDF)
 *   - ?download=1: Content-Disposition attachment + `purchase_order.document_download`
 *     audit entry — the owner's paper-trail record of who exported the document.
 *
 * The preview and the downloaded file are the SAME bytes — what you verify is
 * exactly what the vendor receives.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { buildPoDocumentModel } from "@/lib/purchasing/po-document-store";
import { renderPoDocumentHtml, poDocumentFilename } from "@/lib/purchasing/po-document-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.manage");
  const { id } = await ctx.params;

  const model = await buildPoDocumentModel(id);
  if (!model) {
    return new Response("Purchase order not found.", { status: 404 });
  }

  const html = renderPoDocumentHtml(model.params);
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${poDocumentFilename(model.po.po_number)}"`;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "purchase_order.document_download",
      entityType: "purchase_orders",
      entityId: id,
      after: { poNumber: model.po.po_number, codename: model.codename },
    });
  }

  return new Response(html, { status: 200, headers });
}

/**
 * GET /admin/crypto/audit-binder
 *
 * R1-F6 — the printable, self-contained Crypto Tax Audit Binder.
 *
 * OWNER-gated (finances.view — same gate as the Crypto Portfolio page,
 * Banking, and Bank Feeds). Returns a STANDALONE print-ready HTML document
 * (page-break CSS, Form 8949 box I/L citations, per-year lots, disposals,
 * ordinary-income summary, and every open readiness item flagged in plain
 * English) rendered by the PURE crypto-tax-center-core. Nothing here does tax
 * math — the assembler gathers DB data, the pure cores compute, this route just
 * hands back the bytes.
 *
 *   - default (no ?year): every tax year that has activity, oldest first.
 *   - ?year=2024: just that single year's binder.
 *
 * Opens inline in a browser tab; the reader uses the browser's Print → "Save as
 * PDF" to hand a clean, defensible paper trail to their accountant or the IRS.
 */
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { getAuditBinderYears } from "@/lib/crypto/crypto-tax-center-data";
import { buildAuditBinderHtml } from "@/lib/crypto/crypto-tax-center-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  await requirePermission("finances.view");

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  let onlyYear: number | undefined;
  if (yearParam !== null && yearParam.trim() !== "") {
    const parsed = Number.parseInt(yearParam, 10);
    if (Number.isFinite(parsed)) onlyYear = parsed;
  }

  const years = await getAuditBinderYears(onlyYear);

  const html = buildAuditBinderHtml({
    ownerName: "Michael",
    businessName: "Greenway Marijuana",
    generatedAtIso: new Date().toISOString(),
    years,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

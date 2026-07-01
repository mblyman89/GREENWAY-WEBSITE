/**
 * GET /admin/payroll/[id]/download
 *
 * Regenerate + serve the NACHA .ach file for a payroll run as a download.
 * Admin-gated (settings.manage). The file is rebuilt from the saved lines so
 * it always reflects the latest entries + company settings.
 */
import { requirePermission } from "@/lib/auth/session";
import { generatePayrollNacha } from "@/lib/payroll/payroll-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("settings.manage");
  const { id } = await params;
  const res = await generatePayrollNacha(id, session.profile.id);
  if (!res.ok) {
    return new Response(`Could not generate ACH file: ${res.error}`, { status: 400 });
  }
  // NACHA files use CRLF line endings by convention for bank upload.
  const body = res.file.replace(/\n/g, "\r\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=us-ascii",
      "Content-Disposition": `attachment; filename="${res.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /admin/reports/compliance/excise-export?month=&year=&extra=&penalty=&credits=
 *
 * Generates and downloads the filled LIQ-1295 .xlsx for a reporting month.
 * Admin-gated (settings.manage). Logs an excise_return_batches record.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildLiq1295Xlsx,
  makeLiq1295FileName,
  logExciseReturnBatch,
} from "@/lib/compliance/excise-return";
import { resolveExciseReturn } from "@/lib/compliance/excise-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("settings.manage");
  const url = new URL(request.url);
  const now = new Date();
  const month = Number(url.searchParams.get("month")) || now.getUTCMonth() + 1;
  const year = Number(url.searchParams.get("year")) || now.getUTCFullYear();

  // The download reflects the employee's saved draft (header/flags/box overrides
  // + payment reconciliation), merged over the live computed figures.
  const { data } = await resolveExciseReturn(month, year);

  const fileName = makeLiq1295FileName(data.identity.licenseNumber, month, year);
  const buffer = await buildLiq1295Xlsx(data);

  await logExciseReturnBatch(data, fileName, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "excise.return_generated",
    entityType: "excise_return_batches",
    entityId: fileName,
    after: { month, year, amount_to_pay: data.boxes.box10_amountToPay },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

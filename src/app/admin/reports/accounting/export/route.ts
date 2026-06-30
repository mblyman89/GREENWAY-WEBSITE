/**
 * GET /admin/reports/accounting/export?from=&to=
 *
 * Generates and downloads the Sage 50 General Journal CSV for the range.
 * Admin-gated (settings.manage).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveRange } from "@/lib/reports/range";
import { buildSage50Journal } from "@/lib/accounting/sage50";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("settings.manage");
  const url = new URL(request.url);
  const range = resolveRange({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
  });

  const built = await buildSage50Journal(range.fromISO, range.toISO);

  await recordAudit({
    actorId: session.profile.id,
    action: "sage50.export",
    entityType: "accounting",
    entityId: built.fileName,
    after: { lines: built.lineCount, days: built.days },
  });

  return new Response(built.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
    },
  });
}

/**
 * GET /admin/integrations/leafly/evidence-export?format=csv|xlsx
 *
 * SLICE L-8. Downloads the Leafly webhook evidence bundle.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * Two audiences, one file:
 *
 *  1. LEAFLY, at order certification. Their process is "validated by review of
 *     logged activity", and migration 0225 built `leafly_webhook_events`
 *     specifically to be that record. This route is how it leaves the building.
 *  2. ME, when the owner is testing in the sandbox and something looks wrong.
 *     "Send me the export" is a far better instruction than asking a shop owner
 *     to describe a signature failure.
 *
 * ── WHY IT IS SAFE TO EMAIL ─────────────────────────────────────────────────
 * The bundle carries no customer data. Enforced in three independent places, so
 * no single mistake exposes anyone:
 *
 *   1. `evidence-server.ts` selects an explicit column list and NEVER
 *      `select("*")`, so `leafly_orders.raw_order` -- which per Leafly's own
 *      schema must contain `firstName`, `lastName`, `emailAddress` and
 *      `phoneNumber`, and may contain `dateOfBirth` and `medicalCardNumber` --
 *      is never even fetched.
 *   2. `evidence-core.buildEvidenceBundle` audits every emitted column key
 *      against `EVIDENCE_FORBIDDEN_KEYS` and RETURNS the violations.
 *   3. This route refuses to serve a bundle whose `privacyViolations` list is
 *      non-empty. A 500 that tells the owner to report a bug is the correct
 *      outcome; quietly shipping a customer's phone number to Leafly is not.
 *
 * Point 3 is the one that matters. Layers 1 and 2 prevent the mistake; layer 3
 * makes the mistake impossible to ACT on even if both earlier layers are edited
 * wrongly in future.
 *
 * ── WHY `settings.manage` ───────────────────────────────────────────────────
 * The same permission that guards the Leafly integration page this file is
 * reached from, and the same one the sibling compliance and accounting exports
 * use. The file contains no customer data but it does describe our security
 * posture -- how many signatures failed and when -- so it is not public.
 */

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { buildLeaflyEvidenceExport } from "@/lib/leafly/evidence-server";
import { exportResponse, parseFormat, type WorkbookSpec } from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requirePermission("settings.manage");
  const url = new URL(request.url);
  // rule 11: `parseFormat` already owns "csv unless xlsx was asked for", and is
  // shared with ten other admin exports. No second parser here.
  const format = parseFormat(url.searchParams.get("format"));

  const built = await buildLeaflyEvidenceExport();

  if (!built.bundle) {
    return new Response(
      built.problem ??
        "Could not build the Leafly evidence export. Nothing was written, so nothing is missing.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // FAIL CLOSED on the privacy audit. See the header comment, layer 3.
  if (built.bundle.privacyViolations.length > 0) {
    return new Response(
      "Refusing to build this export: it would have contained column(s) flagged as customer " +
        `data (${built.bundle.privacyViolations.join(", ")}). Nothing was downloaded. This is a ` +
        "bug in the export definition, not a problem with your Leafly integration -- please " +
        "report it.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const spec: WorkbookSpec = {
    filename: built.bundle.filename,
    title: built.bundle.title,
    sheets: built.bundle.sheets.map((s) => ({
      name: s.name,
      caption: s.caption,
      columns: s.columns,
      rows: s.rows,
    })),
  };

  // Audit the download, not the contents. Who exported the certification
  // evidence and when is itself worth knowing; re-recording the rows would
  // duplicate an append-only log into the audit trail for no benefit.
  await recordAudit({
    actorId: session.profile.id,
    action: "leafly.evidence.export",
    entityType: "leafly_webhook_events",
    entityId: built.bundle.filename,
    after: {
      format,
      truncated: built.truncated,
      sheets: built.bundle.sheets.length,
      delivery_rows: built.bundle.sheets.find((s) => s.name === "Deliveries")?.rows.length ?? 0,
      order_rows: built.bundle.sheets.find((s) => s.name === "Orders")?.rows.length ?? 0,
    },
  });

  return exportResponse(spec, format);
}

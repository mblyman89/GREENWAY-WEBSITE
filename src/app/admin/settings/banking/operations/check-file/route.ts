/**
 * GET /admin/settings/banking/operations/check-file?method=prenote|micro_entry&effective=YYYY-MM-DD&fp=<16 hex>
 *
 * R39 S7 part 2, R41 S3. Serves the RELEASED prenote or test-credit file:
 * the exact bytes stored in ach_files when the owner released this list of
 * checks (fp = the list fingerprint shown on the page). The SHA-256 is
 * re-checked first. A GET records NOTHING and BUILDS NOTHING: releasing is
 * releaseCheckFileAction, and the checks are marked sent only when the
 * person confirms the upload (markCheckFileSentAction). Owner/admin only
 * (settings.manage). Never cached. The download is audited (who pulled bank
 * numbers, when, which file; no numbers).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { readLiveFileForSource } from "@/lib/payments/ach-file-ledger-store";
import { checkFileSourceId } from "@/lib/payments/ach-ops-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await requirePermission("settings.manage");
  const q = new URL(req.url).searchParams;
  const method = q.get("method") ?? "";
  if (method !== "prenote" && method !== "micro_entry") {
    return new Response("Choose the prenote or the test credit file.", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const fp = q.get("fp") ?? "";
  if (!/^[0-9a-f]{16}$/.test(fp)) {
    return new Response("Open the Operations page and use its download button.", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const res = await readLiveFileForSource(method, checkFileSourceId(method, q.get("effective") ?? "", fp));
  if (!res.ok) {
    return new Response(`Could not serve the file: ${res.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.verification.file_downloaded",
    entityType: "ach_files",
    entityId: res.row.id,
    after: { method, effective: res.row.effective_date, filename: res.row.filename, file_id_modifier: res.row.file_id_modifier, entry_count: res.row.entry_count, total_cents: res.row.total_cents, sha256: res.row.sha256 },
  }).catch(() => {});
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=us-ascii",
      "Content-Disposition": `attachment; filename="${res.row.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

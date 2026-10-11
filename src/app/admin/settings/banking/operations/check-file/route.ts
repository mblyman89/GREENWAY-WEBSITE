/**
 * GET /admin/settings/banking/operations/check-file?method=prenote|micro_entry&effective=YYYY-MM-DD&fp=<16 hex>
 *
 * R39 S7 part 2. Serves the prenote or test-credit NACHA file for upload to
 * Timberland. Owner/admin only (settings.manage). A GET records NOTHING: the
 * checks are marked sent only when the person confirms the upload on the page
 * (markCheckFileSentAction), and only if the list is still exactly the one in
 * this file (fp = fingerprint shown on the page). CRLF line endings for bank
 * upload; never cached. The download itself is audited (who pulled bank
 * numbers, when, which checks; no numbers).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { buildCheckFile } from "@/lib/payments/ach-ops-store";
import { pacificToday } from "@/lib/reports/timezone";

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
  const res = await buildCheckFile({ method, effective: q.get("effective") ?? "", todayIso: pacificToday(), now: new Date(), expect: fp });
  if (!res.ok) {
    return new Response(`Could not build the file: ${res.error}`, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.verification.file_downloaded",
    entityType: "ach_verifications",
    entityId: res.plan.ids[0] ?? null,
    after: { method, ids: res.plan.ids, effective: res.plan.effective, filename: res.plan.filename, entry_count: res.plan.entryCount, total_cents: res.plan.totalCents },
  }).catch(() => {});
  const body = res.plan.file.replace(/\r?\n/g, "\r\n");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=us-ascii",
      "Content-Disposition": `attachment; filename="${res.plan.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

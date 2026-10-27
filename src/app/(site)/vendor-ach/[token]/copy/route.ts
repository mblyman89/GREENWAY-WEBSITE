/**
 * GET /vendor-ach/<token>/copy
 *
 * R39 S7: the vendor's own copy of what they just signed (disclosure B.iv
 * "download the signed agreement on the last screen"; RCW 1.80.070 a record
 * the recipient can store and print).
 *
 * The link alone is NOT enough: the PDF carries the full bank numbers (as the
 * paper form does), so it is served only to the browser that confirmed the
 * code and signed (the httpOnly gw_vesign cookie, 24 h). A forwarded email
 * link gets 404. The bytes are re-hashed against the SHA-256 stored at
 * signing. no-store + no-referrer: nothing stays in a cache or leaks the
 * token onward.
 */
import { cookies } from "next/headers";
import { recordAudit } from "@/lib/auth/audit";
import { isTokenShape } from "@/lib/payments/vendor-esign-core";
import { isCookieShape } from "@/lib/payments/vendor-esign-app-core";
import { getVendorInviteByToken, vendorSignedCopy } from "@/lib/payments/vendor-esign-store";
import { VENDOR_COOKIE } from "../paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } };

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isTokenShape(token)) return new Response("Not found.", NOT_FOUND);
  const raw = (await cookies()).get(VENDOR_COOKIE)?.value ?? null;
  const cookie = isCookieShape(raw) ? raw : null;
  if (!cookie) return new Response("Not found.", NOT_FOUND);
  const copy = await vendorSignedCopy(token, cookie);
  if (!copy.ok) return new Response("Not found.", NOT_FOUND);
  const inv = await getVendorInviteByToken(token);
  await recordAudit({ actorId: null, actorEmail: null, action: "vendor_esign.vendor_copy", entityType: "vendor_esign_invite", entityId: inv?.id ?? null, before: null, after: { sha256: copy.sha256 } });
  return new Response(Buffer.from(copy.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="GW-ACH-V-signed-${inv?.signed_at ? inv.signed_at.slice(0, 10) : "copy"}.pdf"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

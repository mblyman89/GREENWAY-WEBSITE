/**
 * /api/cloudprnt — Star CloudPRNT endpoint for the single TSP143IV receipt
 * printer (Slice 37).
 *
 * The printer is configured (in its web UI / Star Quick Setup Utility) to poll
 * this single URL. It speaks the classic CloudPRNT HTTP protocol:
 *
 *   POST   → the printer polls with its status JSON. We reply with
 *            { "jobReady": bool, "mediaTypes": ["text/plain"], "jobToken": ... }.
 *   GET     → when jobReady was true, the printer fetches the job body. We serve
 *            the receipt as text/plain (the printer prints + auto-cuts).
 *   DELETE  → the printer confirms the job printed; we mark it done.
 *
 * Auth: the printer sends our shared `poll_token` (configured in admin settings)
 * either as the HTTP Basic-auth password or as a `?token=` query parameter. If
 * a token is configured and the request doesn't match, we 401. This route is
 * NOT behind the admin middleware (matcher is /admin/:path*), so the printer can
 * reach it without a Supabase session.
 *
 * D-68: the GET/DELETE steps reuse the SAME `?token=` parameter to carry the
 * per-receipt JOB token, so the poll token and the job token would collide.
 * Token precedence is therefore resolved by cloudprnt-auth-core: "auth" prefers
 * the Basic-auth password, "job" prefers the query parameter.
 *
 * Protocol reference: Star CloudPRNT Protocol Guide 2.5.2.
 */
import { NextResponse, type NextRequest } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import {
  extractCloudPrntToken,
  type CloudPrntTokenUse,
} from "@/lib/printing/cloudprnt-auth-core";
import {
  getPrinterSettings,
  claimNextJob,
  getJobByToken,
  confirmJob,
  recordHeartbeat,
} from "@/lib/printing/printer-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull the requested secret out of the request.
 *
 * D-68: this endpoint carries TWO different secrets on the SAME `?token=`
 * parameter -- the shared poll token (authentication) and the per-receipt job
 * token (addressing). Callers MUST say which one they want; the precedence
 * rules live in cloudprnt-auth-core so no call site can re-guess them.
 */
function extractToken(req: NextRequest, use: CloudPrntTokenUse): string | null {
  const url = new URL(req.url);
  return extractCloudPrntToken(use, {
    authorizationHeader: req.headers.get("authorization"),
    queryToken: url.searchParams.get("token"),
  });
}

/**
 * Returns a refusal response when the request is not authorized, or null when
 * it may proceed.
 *
 * S-9 (fail closed): receipt bodies contain customer name/phone, so in
 * PRODUCTION an empty poll token refuses with 503 until the owner sets one in
 * the printer settings. In development only, an empty token allows requests so
 * initial printer setup is painless.
 */
async function authFail(req: NextRequest): Promise<NextResponse | null> {
  const settings = await getPrinterSettings();
  const expected = settings?.poll_token ?? "";
  if (!expected) {
    if (shouldRefuseWhenSecretMissing(expected)) {
      return NextResponse.json(
        { error: "printer poll token not configured (set it in Admin → Equipment → Receipt printer)" },
        { status: 503 },
      );
    }
    return null; // dev only: no token configured yet — allow (initial setup)
  }
  const provided = extractToken(req, "auth");
  // GW-022: constant-time compare so response timing can't leak token prefixes.
  if (timingSafeEqualStr(provided, expected)) return null;
  return NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Basic realm="cloudprnt"' } },
  );
}

/**
 * POST — printer poll. Body is the printer's status JSON. We record a
 * heartbeat and tell the printer whether a job is ready.
 */
export async function POST(req: NextRequest) {
  const denied = await authFail(req);
  if (denied) return denied;

  let printerMac: string | null = null;
  let statusCode: string | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.printerMAC === "string") printerMac = body.printerMAC;
    if (typeof body.statusCode === "string") statusCode = body.statusCode;
  } catch {
    // Some firmware posts an empty body; ignore parse errors.
  }

  await recordHeartbeat({ printerMac, statusCode });

  const job = await claimNextJob();
  if (!job) {
    return NextResponse.json({ jobReady: false });
  }

  return NextResponse.json({
    jobReady: true,
    mediaTypes: ["text/plain"],
    jobToken: job.job_token ?? `job-${job.id}`,
    deleteMethod: "DELETE",
  });
}

/**
 * GET — printer fetches the job body for the token it was given. We serve the
 * receipt as text/plain. (If no token/job is found we return 404 so the printer
 * skips it gracefully.)
 */
export async function GET(req: NextRequest) {
  const denied = await authFail(req);
  if (denied) return denied;

  const token = extractToken(req, "job");
  if (!token) {
    return new NextResponse("", { status: 404 });
  }
  const job = await getJobByToken(token);
  if (!job) {
    return new NextResponse("", { status: 404 });
  }
  return new NextResponse(job.body_text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * DELETE — printer confirms it printed the job for this token, and we mark it
 * printed. Our POST reply sets `deleteMethod: "DELETE"`, so this is the path
 * Star firmware uses. Firmware that instead re-GETs the job simply receives a
 * 404 once the job is no longer claimable, which it skips gracefully.
 */
export async function DELETE(req: NextRequest) {
  const denied = await authFail(req);
  if (denied) return denied;

  const token = extractToken(req, "job");
  if (token) {
    await confirmJob(token);
  }
  return new NextResponse("", { status: 200 });
}

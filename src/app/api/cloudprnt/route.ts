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
 * Protocol reference: Star CloudPRNT Protocol Guide 2.5.2.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  getPrinterSettings,
  claimNextJob,
  getJobByToken,
  confirmJob,
  recordHeartbeat,
} from "@/lib/printing/printer-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pull the poll token from Basic auth or ?token=. */
function extractToken(req: NextRequest): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  if (q) return q;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch {
      return null;
    }
  }
  return null;
}

/** Returns a 401 response if a token is configured and the request fails it. */
async function authFail(req: NextRequest): Promise<NextResponse | null> {
  const settings = await getPrinterSettings();
  const expected = settings?.poll_token ?? "";
  if (!expected) return null; // no token configured yet — allow (initial setup)
  const provided = extractToken(req);
  if (provided === expected) return null;
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

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || extractToken(req);
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
 * DELETE — printer confirms it printed the job for this token. We mark it
 * printed. Some firmware sends a GET-style confirmation; that is handled by the
 * GET branch returning 404 once the job is gone, but we also accept GET with
 * ?delete=... below via the same confirmJob path is unnecessary because the
 * printer defaults to DELETE (deleteMethod: "DELETE").
 */
export async function DELETE(req: NextRequest) {
  const denied = await authFail(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || extractToken(req);
  if (token) {
    await confirmJob(token);
  }
  return new NextResponse("", { status: 200 });
}

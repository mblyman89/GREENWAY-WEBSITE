/**
 * GET /api/newsletter/countdown?e=<end epoch seconds>&th=d|l
 *
 * D238 N-8c (SOP-22 G-118): the live countdown picture in canvas newsletters.
 * Drawn when the email is opened, so it always shows the real time left
 * (one minute of ticking, then it stops on the last frame). Public, no data
 * read; the end time is validated (at most a year ahead).
 */
import { parseCountdownQuery } from "@/lib/cms/newsletter-motion-core";
import { countdownGif } from "@/lib/cms/newsletter-motion-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const now = Math.floor(Date.now() / 1000);
  const q = parseCountdownQuery({ e: url.searchParams.get("e"), th: url.searchParams.get("th") }, now);
  if (!q) return new Response("Bad countdown", { status: 400 });
  try {
    const gif = await countdownGif(q.endSec, q.theme, now);
    return new Response(new Uint8Array(gif), {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        // Never cache: every open must show the time left at that moment.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Expires: "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Countdown unavailable", { status: 500 });
  }
}

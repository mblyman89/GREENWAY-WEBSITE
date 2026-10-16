/**
 * R59-S4 — POST /api/vitals: one page load's Core Web Vitals from the public
 * site (VitalsReporter). Same rules as /api/clicks: sendBeacon text/plain
 * JSON, always 204 with no body, no cookie / IP / user id stored; drops
 * oversized bodies, other-site Origins, invalid fields, admin pages and
 * browsers sending Global Privacy Control.
 */
import { normalizeVitalsBeacon } from "@/lib/analytics/web-vitals-core";
import { insertVitals } from "@/lib/analytics/web-vitals-store";

export const dynamic = "force-dynamic";

const MAX_BODY = 2048;

function done(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin beacons may omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("sec-gpc") === "1") return done();
  if (!sameSite(request)) return done();
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return done();
  let text = "";
  try {
    text = await request.text();
  } catch {
    return done();
  }
  if (!text || text.length > MAX_BODY) return done();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }
  await insertVitals(normalizeVitalsBeacon(body));
  return done();
}

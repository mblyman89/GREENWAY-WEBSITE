/**
 * R47-S2 — POST /api/clicks: one banner / button click from the public site.
 *
 * Sent with navigator.sendBeacon as text/plain JSON (a CORS-safe type, so no
 * pre-flight). Always answers 204 with no body: the visitor's page never
 * waits on it and never sees an error. Stores no cookie, IP or user id.
 * Drops: oversized bodies, other-site Origins, invalid fields, admin and
 * no-track pages, and requests from browsers sending Global Privacy Control.
 */
import { normalizeClickEvent } from "@/lib/analytics/click-events-core";
import { insertClickEvent } from "@/lib/analytics/click-events-store";

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
  const row = normalizeClickEvent(body);
  if (row) await insertClickEvent(row);
  return done();
}

/**
 * pos/cors — the thin SERVER adapter that applies the pure policy in
 * pos/cors-core.ts to real Next.js requests and responses.
 *
 * All decisions live in cors-core (pure + fully self-tested). This file only
 * does the two impure things: read NEXT_PUBLIC_SITE_URL from the environment,
 * and copy the resulting headers onto a NextResponse.
 *
 * Usage in any /api/pos/* route:
 *
 *   export async function OPTIONS(req: NextRequest) {
 *     return posPreflightResponse(req);
 *   }
 *
 *   export async function POST(req: NextRequest) {
 *     ...
 *     return withPosCors(req, NextResponse.json(payload));
 *   }
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  buildPosAllowedOrigins,
  posCorsHeaders,
  posPreflightHeaders,
  posPreflightStatus,
} from "./cors-core";

/**
 * The live allowlist for this deployment. Read at call time (not import time)
 * so tests and previews always observe the current environment.
 */
export function posAllowedOrigins(): string[] {
  return buildPosAllowedOrigins(process.env.NEXT_PUBLIC_SITE_URL);
}

/**
 * Copy the correct CORS headers onto an existing response and return it.
 * If the request's Origin is not on the allowlist, only `Vary: Origin` is
 * added, so the browser blocks the caller.
 */
export function withPosCors<T extends NextResponse>(req: NextRequest, res: T): T {
  const headers = posCorsHeaders(req.headers.get("origin"), posAllowedOrigins());
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

/**
 * Answer a CORS preflight (OPTIONS). 204 with the policy headers for an
 * allowed origin; 403 with no CORS headers for anything else.
 */
export function posPreflightResponse(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");
  const allowed = posAllowedOrigins();
  return new NextResponse(null, {
    status: posPreflightStatus(origin, allowed),
    headers: posPreflightHeaders(origin, allowed),
  });
}

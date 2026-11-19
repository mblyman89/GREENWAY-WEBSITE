/**
 * src/lib/compliance/ccrs-auto-upload-http.ts - D253. The shared preamble of
 * the three /api/ccrs-uploader routes the Greenway Chrome extension calls.
 *
 * The extension's service worker calls these (host_permissions, so no CORS is
 * needed and none is granted: no Access-Control-* header is ever sent). Each
 * call carries "Authorization: Bearer <key>"; only sha256(key) is stored
 * (0369). Every answer is no-store. A switched-off uploader or an unpaired /
 * revoked browser gets nothing.
 */
import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { authenticateDevice, type UploaderDevice } from "./ccrs-auto-upload-store";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } as const;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export type DeviceContext = { admin: ReturnType<typeof createSupabaseAdminClient>; device: UploaderDevice };

/** The paired device behind the request, or the response to send instead. */
export async function deviceOr401(req: Request): Promise<DeviceContext | NextResponse> {
  if (!isSupabaseServiceConfigured) return json({ error: "not configured" }, 503);
  const admin = createSupabaseAdminClient();
  const device = await authenticateDevice(admin, req.headers.get("authorization")).catch(() => null);
  if (!device) return json({ error: "This browser is not paired (or was revoked). Pair it again in the CCRS hub." }, 401);
  return { admin, device };
}

/** A small JSON body (the extension never sends more than a CCRS page's text). */
export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("body too large");
  return text ? JSON.parse(text) : {};
}

export const RUN_FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

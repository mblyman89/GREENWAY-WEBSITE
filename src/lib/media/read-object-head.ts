import "server-only";

/**
 * R45-S2: read ONLY the first `maxBytes` of a Storage object, so the server can
 * check its real file signature without loading a 200 MB video into memory.
 *
 * Whether Supabase Storage honours HTTP Range requests is not clearly
 * documented (see supabase/storage issue #322 and discussion #4115), so this
 * does NOT rely on it. It sends `Range: bytes=0-N` as a hint, then reads the
 * body stream and STOPS (cancels the stream) once it has enough bytes. That
 * works whether the response is a 206 partial or a full 200.
 *
 * It uses the authenticated object endpoint with the service-role key, so it
 * works even if the bucket is ever made private.
 */
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/env";

export async function readObjectHead(
  bucket: string,
  key: string,
  maxBytes: number,
  timeoutMs = 15000,
): Promise<Uint8Array | null> {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  const path = key.split("/").map(encodeURIComponent).join("/");
  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        // New-style `sb_secret_…` keys are not JWTs: the API gateway takes them
        // ONLY in `apikey` (it swaps in a service_role JWT itself) and rejects a
        // non-JWT Bearer token. Legacy JWT keys keep sending both headers.
        ...(supabaseServiceRoleKey.startsWith("sb_")
          ? {}
          : { Authorization: `Bearer ${supabaseServiceRoleKey}` }),
        apikey: supabaseServiceRoleKey,
        Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
      },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(total, maxBytes));
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, out.length - off);
      out.set(c.subarray(0, take), off);
      off += take;
      if (off >= out.length) break;
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

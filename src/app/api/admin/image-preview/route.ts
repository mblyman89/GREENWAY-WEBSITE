/**
 * src/app/api/admin/image-preview/route.ts — Slice R2 ("never a black box").
 *
 * Owner: "deep research how to fetch any image type, and/or better methods and
 * techniques and logic to prevent the image from loading in the back office as
 * an empty solid black box."
 *
 * WHY a proxy: crawler-discovered thumbnails render as plain <img> tags
 * pointing at the vendor's CDN. Two things break that into a black/blank box:
 *   1. Hotlink protection — the CDN sees OUR page as the Referer and returns
 *      403. The browser can't retry differently, so the box stays empty.
 *   2. Format gaps — TIFF renders in no browser; AVIF/HEIC only in some.
 *
 * This route lets the admin UI fall back to a server-side fetch that
 *   • requires the same `vendors.manage` permission as every harvest surface,
 *   • enforces the exact SSRF guard the import path uses (http/https only,
 *     loopback/private/link-local hosts refused),
 *   • retries with the image's OWN site origin as Referer on 403/401 (what the
 *     vendor's own pages send — never a fabricated value),
 *   • sniffs magic bytes and CONVERTS AVIF/TIFF to PNG via sharp so the
 *     browser always gets something it can paint,
 *   • fails with 415/502 + a plain-English `x-preview-reason` header so the
 *     client can show an honest "preview blocked" chip instead of a black box.
 *
 * Nothing is stored — this is a stateless preview relay with a short cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isForbiddenHost, sniffImageMime } from "@/lib/media/harvest";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** Types a browser can paint directly — relayed as-is. */
const BROWSER_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif", // modern browsers paint AVIF; converted only when sniffed via magic bytes below
]);

/** Types sharp (verified installed, 0.34.x) can convert to PNG. */
const CONVERT_TO_PNG = new Set(["image/tiff", "image/avif"]);

function refuse(status: number, reason: string): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { "x-preview-reason": reason, "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("vendors.manage");
  } catch {
    return refuse(401, "unauthorized");
  }

  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return refuse(400, "invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return refuse(400, "only http(s) urls");
  }
  if (isForbiddenHost(parsed.hostname)) {
    return refuse(400, "host not allowed");
  }

  const fetchOnce = async (withReferer: boolean): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { Accept: "image/*" };
      if (withReferer) headers.Referer = `${parsed.protocol}//${parsed.host}/`;
      return await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let res: Response;
  try {
    res = await fetchOnce(false);
    if (res.status === 403 || res.status === 401) {
      // Hotlink protection: retry as the vendor's own site would.
      res = await fetchOnce(true);
    }
  } catch {
    return refuse(502, "network error or timeout");
  }
  if (!res.ok) {
    return refuse(502, `upstream HTTP ${res.status}`);
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(await res.arrayBuffer());
  } catch {
    return refuse(502, "could not read image bytes");
  }
  if (raw.length === 0) return refuse(502, "empty image");
  if (raw.length > MAX_PREVIEW_BYTES) return refuse(413, "image too large to preview");

  const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // Trust magic bytes over the declared header (CDNs lie; pages masquerade).
  const sniffed = sniffImageMime(raw);
  let mime = sniffed ?? (BROWSER_SAFE.has(declared) ? declared : "");

  if (!mime) return refuse(415, `not an image (${declared || "unknown type"})`);

  if (CONVERT_TO_PNG.has(mime) && sniffed) {
    // TIFF paints nowhere; sniffed AVIF may hide a HEIC-adjacent brand some
    // browsers refuse — converting to PNG guarantees a paintable preview.
    try {
      const sharp = (await import("sharp")).default;
      raw = Buffer.from(await sharp(raw).png().toBuffer());
      mime = "image/png";
    } catch {
      return refuse(415, `cannot convert ${mime} for preview`);
    }
  }

  if (mime === "image/heic" || mime === "image/bmp") {
    return refuse(415, mime === "image/heic" ? "HEIC preview not supported" : "BMP preview not supported");
  }
  if (!BROWSER_SAFE.has(mime)) {
    return refuse(415, `unsupported image type (${mime})`);
  }

  return new NextResponse(new Uint8Array(raw), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(raw.length),
      // Private, short-lived: previews are per-admin and the source may change.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

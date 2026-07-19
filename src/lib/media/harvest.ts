/**
 * src/lib/media/harvest.ts — Slice H3 (logo & image pipeline).
 *
 * Turn a crawler-discovered image URL (from a `research_logos` /
 * `research_images` reference draft) into a Media Library asset with ONE
 * click, safely:
 *
 *   • http(s)-only fetch with a size cap, timeout, and an image-MIME check;
 *     obvious private/loopback hosts are refused (defence-in-depth — this is
 *     an admin-only action behind `vendors.manage`).
 *   • sha256 content-hash dedupe: if the SAME bytes were already imported,
 *     the existing `media_assets` row is reused — re-clicking or two vendors
 *     sharing a CDN asset can't pile up duplicates.
 *   • provenance kept: `source = crawl:<imageUrl>`, `license_status =
 *     'pending-review'` (harvested art needs a rights check before wide use).
 *   • drafts-only: saved assets land as `status='draft'`. Assigning as a
 *     vendor/brand logo is the human's explicit publish decision (same as the
 *     manual logo upload path, which publishes immediately).
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaAsset } from "@/lib/supabase/types";
import { uploadMedia } from "./store";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // matches the manual logo upload cap
const FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

/** Hosts we refuse to fetch from (loopback / link-local / RFC-1918). */
function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // Literal IPv4 checks (private + loopback + link-local + metadata).
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 loopback / unique-local.
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

export class HarvestImageError extends Error {}

/**
 * Sniff an image MIME from the first bytes (magic numbers). Some CDNs — notably
 * GrowFlow's Azure blob storage (growflowweb.blob.core.windows.net) — serve
 * valid images with a missing or generic content-type header
 * (application/octet-stream / binary/octet-stream). When the declared type is
 * absent or generic we fall back to this content sniff so a genuine PNG/JPEG/
 * WEBP/GIF isn't wrongly rejected. Never widens what we accept — the sniffed
 * type must still be in ALLOWED_MIME. Returns null when the bytes don't match a
 * known image signature.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) {
    return "image/gif";
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** A declared content-type is "generic" when it carries no real image info. */
function isGenericContentType(mime: string): boolean {
  return (
    mime === "" ||
    mime === "application/octet-stream" ||
    mime === "binary/octet-stream" ||
    mime === "application/binary" ||
    mime === "text/plain"
  );
}

export type ImportImageInput = {
  /** The image URL from the crawler's reference draft. */
  imageUrl: string;
  /** "vendor-logo" | "brand-logo" | "product" | ... (taxonomy purpose id). */
  usageType: string;
  /** For title/alt, e.g. "Fairwinds logo (harvested)". */
  title: string;
  altText: string;
  uploadedBy: string | null;
  /** Extra tags beside "harvested". */
  tags?: string[];
};

export type ImportImageResult = {
  asset: MediaAsset;
  /** true when the exact same bytes already existed and were reused. */
  deduped: boolean;
};

/**
 * Find an existing media asset holding the exact same bytes. `uploadMedia`
 * embeds the first 16 hex chars of the sha256 in the storage key
 * (`<folder>/<hash16>-<name>`), so the hash prefix is queryable.
 */
async function findExistingByHash(hash16: string): Promise<MediaAsset | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("media_assets")
    .select("*")
    .like("storage_key", `%/${hash16}-%`)
    .limit(1)
    .maybeSingle();
  return (data as MediaAsset | null) ?? null;
}

function filenameFromUrl(u: URL, mime: string): string {
  const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const clean = last.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
  if (clean && /\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
  const ext: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
  };
  return (clean || "harvested-image") + (ext[mime] ?? "");
}

/**
 * Download a crawler-discovered image and store it as a Media Library DRAFT
 * with provenance + pending license review. Content-hash deduped.
 * Throws `HarvestImageError` with a human-readable message on any refusal.
 */
export async function importImageFromUrl(input: ImportImageInput): Promise<ImportImageResult> {
  let parsed: URL;
  try {
    parsed = new URL(input.imageUrl);
  } catch {
    throw new HarvestImageError("That image URL isn't valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HarvestImageError("Only http(s) image URLs can be imported.");
  }
  if (isForbiddenHost(parsed.hostname)) {
    throw new HarvestImageError("That host can't be fetched.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
  } catch {
    throw new HarvestImageError("Couldn't download the image (network error or timeout).");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new HarvestImageError(`Couldn't download the image (HTTP ${res.status}).`);
  }

  const declaredMime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // Reject an EXPLICIT non-image type early (e.g. text/html, application/pdf)
  // to avoid downloading a page. A generic/absent type is tolerated here and
  // resolved by a magic-byte sniff after the bytes arrive (some CDNs — e.g.
  // GrowFlow's Azure blob — serve real images as application/octet-stream).
  if (declaredMime && !ALLOWED_MIME.has(declaredMime) && !isGenericContentType(declaredMime)) {
    throw new HarvestImageError(`Not a supported image type (${declaredMime}).`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length === 0) throw new HarvestImageError("The image was empty.");
  if (raw.length > MAX_IMAGE_BYTES) {
    throw new HarvestImageError("Image exceeds the 5 MB import limit.");
  }

  // Resolve the final MIME: trust an allowed declared type, otherwise sniff the
  // magic bytes. Never widens ALLOWED_MIME — a sniff that isn't a known image
  // signature still fails closed.
  let mime = declaredMime;
  if (!ALLOWED_MIME.has(mime)) {
    const sniffed = sniffImageMime(raw);
    if (sniffed && ALLOWED_MIME.has(sniffed)) {
      mime = sniffed;
    } else {
      throw new HarvestImageError(`Not a supported image type (${declaredMime || "unknown"}).`);
    }
  }

  // Content-hash dedupe: same bytes → reuse the existing asset.
  const hash16 = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const existing = await findExistingByHash(hash16);
  if (existing) return { asset: existing, deduped: true };

  const asset = await uploadMedia({
    buffer: raw,
    filename: filenameFromUrl(parsed, mime),
    mimeType: mime,
    title: input.title,
    altText: input.altText,
    usageType: input.usageType,
    tags: Array.from(new Set(["harvested", ...(input.tags ?? [])])),
    uploadedBy: input.uploadedBy,
    status: "draft", // drafts-only; assigning is the human's publish decision
    source: `crawl:${parsed.toString()}`.slice(0, 500),
    licenseStatus: "pending-review",
  });
  return { asset, deduped: false };
}

// ---------------------------------------------------------------------------
// CV-5: document (PDF) harvesting — same safety rails as images, for COAs.
// ---------------------------------------------------------------------------

/** Document types we'll pull from a URL (COAs are PDFs). */
const ALLOWED_DOC_MIME = new Set(["application/pdf"]);

/** Matches the media library's manual-upload ceiling (media/actions.ts). */
const MAX_DOC_BYTES = 10 * 1024 * 1024;

/**
 * Download a linked document (e.g. a Cultivera COA PDF) and store it as a
 * Media Library DRAFT with provenance — the same http(s)-only + host-check +
 * sha256-dedupe pipeline as importImageFromUrl, but for PDFs.
 * Throws `HarvestImageError` with a human-readable message on any refusal.
 */
export async function importDocumentFromUrl(input: ImportImageInput): Promise<ImportImageResult> {
  let parsed: URL;
  try {
    parsed = new URL(input.imageUrl);
  } catch {
    throw new HarvestImageError("That document URL isn't valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HarvestImageError("Only http(s) document URLs can be imported.");
  }
  if (isForbiddenHost(parsed.hostname)) {
    throw new HarvestImageError("That host can't be fetched.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/pdf,*/*" },
    });
  } catch {
    throw new HarvestImageError("Couldn't download the document (network error or timeout).");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new HarvestImageError(`Couldn't download the document (HTTP ${res.status}).`);
  }

  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_DOC_MIME.has(mime)) {
    throw new HarvestImageError(`Not a supported document type (${mime || "unknown"}).`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length === 0) throw new HarvestImageError("The document was empty.");
  if (raw.length > MAX_DOC_BYTES) {
    throw new HarvestImageError("Document exceeds the 10 MB import limit.");
  }

  const hash16 = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const existing = await findExistingByHash(hash16);
  if (existing) return { asset: existing, deduped: true };

  const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  const clean = last.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
  const filename = clean && /\.pdf$/i.test(clean) ? clean : (clean || "harvested-document") + ".pdf";

  const asset = await uploadMedia({
    buffer: raw,
    filename,
    mimeType: mime,
    title: input.title,
    altText: input.altText,
    usageType: input.usageType,
    tags: Array.from(new Set(["harvested", ...(input.tags ?? [])])),
    uploadedBy: input.uploadedBy,
    status: "draft",
    source: `crawl:${parsed.toString()}`.slice(0, 500),
    licenseStatus: "pending-review",
  });
  return { asset, deduped: false };
}

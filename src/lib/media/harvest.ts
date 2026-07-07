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

  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new HarvestImageError(`Not a supported image type (${mime || "unknown"}).`);
  }

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length === 0) throw new HarvestImageError("The image was empty.");
  if (raw.length > MAX_IMAGE_BYTES) {
    throw new HarvestImageError("Image exceeds the 5 MB import limit.");
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

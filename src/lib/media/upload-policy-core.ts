/**
 * upload-policy-core — R44. Pure, import-free rules for the Media Library's
 * DIRECT-TO-STORAGE uploads and for VIDEO banners.
 *
 * WHY THIS EXISTS (verified, not assumed — see docs/roadmap/R44-VIDEO-BANNERS-LARGE-UPLOADS.md):
 *  - Vercel Functions cap the request body at 4.5 MB on EVERY plan, Pro
 *    included (vercel.com/docs/functions/limitations). A Server Action is a
 *    Function, so a file sent through one can never exceed that. Upgrading to
 *    Vercel Pro does not lift it.
 *  - Supabase Pro lets the project's global file size limit go up to 500 GB
 *    (supabase.com/docs/guides/storage/uploads/file-limits). So the fix is to
 *    send the bytes STRAIGHT FROM THE BROWSER TO SUPABASE STORAGE, and only use
 *    our server for the two tiny steps around it:
 *      1. "start": check the staff member's permission + the file's type/size,
 *         then mint a one-time signed upload token for a fresh path
 *         (storage-js createSignedUploadUrl; valid 2 hours, one path only).
 *      2. "finish": confirm the object really landed (size + type read back
 *         from Storage), then add the Media Library row.
 *  - Supabase recommends resumable (TUS) uploads above 6 MB, with 6 MB chunks
 *    (supabase.com/docs/guides/storage/uploads/resumable-uploads), and the
 *    signed-token variant uses the `/upload/resumable/sign` endpoint with the
 *    token in an `x-signature` header (supabase/storage src/http/routes/tus).
 *
 * Everything here is deterministic and dependency-free so it runs under the
 * pure self-test runner (scripts/compliance/run-pure-selftests.ts).
 */

// ── Size rules ─────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

/** Supabase's own line: at or under this, a plain (single request) upload is fine. */
export const RESUMABLE_THRESHOLD_BYTES = 6 * MB;
/** TUS chunk size. Supabase: "it must be set to 6MB (for now) do not change it". */
export const RESUMABLE_CHUNK_BYTES = 6 * MB;

export type UploadKind = "image" | "video" | "document" | "animation";

/** Per-kind ceilings for ONE file. Video is the largest; the bucket cap (migration 0265) equals it. */
export const UPLOAD_MAX_BYTES: Record<UploadKind, number> = {
  image: 50 * MB,
  document: 50 * MB,
  video: 200 * MB,
  // R60: banner animations are vector files; real ones are KBs to a few MB.
  animation: 20 * MB,
};
export const UPLOAD_MAX_LABEL: Record<UploadKind, string> = {
  image: "50 MB",
  document: "50 MB",
  video: "200 MB",
  animation: "20 MB",
};
/** The `media` bucket's file_size_limit set by migration 0265 (= the largest per-kind cap). */
export const MEDIA_BUCKET_FILE_SIZE_LIMIT_BYTES = 200 * MB;

/**
 * Advisory "this will be slow for customers" lines — NOT hard limits. Uploading
 * is allowed above these; the uploader just says so in plain English, because
 * every byte of a banner is downloaded by every shopper who sees it.
 *  - 8 MB video ≈ 6.4 s at 10 Mbit/s (8 × 8 / 10), roughly a mid-range phone
 *    connection; a banner video is decoration, so we nudge toward ≤ 8 MB.
 *  - 2 MB still image: web images above ~2 MB are almost always un-exported
 *    originals; next/image will resize JPG/PNG/WebP, but GIFs pass through.
 */
export const VIDEO_ADVISORY_BYTES = 8 * MB;
export const IMAGE_ADVISORY_BYTES = 2 * MB;
/** R60: a banner animation over this is usually carrying embedded photos. Advisory only. */
export const ANIMATION_ADVISORY_BYTES = 1 * MB;
/** Videos longer than this (seconds) are usually not "banner loops". Advisory only. */
export const VIDEO_ADVISORY_SECONDS = 20;

// ── Types (mime) ───────────────────────────────────────────────────────────

/** Exactly what the Media Library accepts, by kind. */
export const UPLOAD_MIME: Record<UploadKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  video: ["video/mp4", "video/webm"],
  document: ["application/pdf"],
  /**
   * R60 Lottie + Rive. Browsers report "" (or a generic type) for .riv and
   * .lottie, so the type is taken from the extension (ANIMATION_EXT_MIME) and
   * the server then proves it from the bytes (file-signature-core: "RIVE"
   * fingerprint, dotLottie ZIP entries, Lottie JSON keys).
   *  - .riv: Rive's own CDN serves it as application/octet-stream.
   *  - .lottie: dotLottie spec media type application/zip+dotlottie.
   *  - .json: Lottie JSON (application/json).
   */
  animation: ["application/octet-stream", "application/zip+dotlottie", "application/json"],
};
/** R60: animation extension → the one type we store it as. */
export const ANIMATION_EXT_MIME: Record<string, string> = {
  ".riv": "application/octet-stream",
  ".lottie": "application/zip+dotlottie",
  ".json": "application/json",
};

const EXT_FOR_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "application/octet-stream": ".riv",
  "application/zip+dotlottie": ".lottie",
  "application/json": ".json",
};

/** Extensions a file of each mime may legitimately carry. */
const EXTS_FOR_MIME: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/svg+xml": [".svg"],
  "video/mp4": [".mp4", ".m4v"],
  "video/webm": [".webm"],
  "application/pdf": [".pdf"],
  "application/octet-stream": [".riv"],
  "application/zip+dotlottie": [".lottie"],
  "application/json": [".json"],
};

/** The `accept` attribute for the upload <input>. */
export const UPLOAD_ACCEPT_ATTR = [...UPLOAD_MIME.image, ...UPLOAD_MIME.video, ...UPLOAD_MIME.document, ".mp4", ".webm", ".riv", ".lottie", ".json"].join(",");

/** Some browsers report "" for a file's type; fall back to its extension. */
export function mimeFromFilename(filename: string): string {
  const ext = extOf(filename);
  for (const [mime, exts] of Object.entries(EXTS_FOR_MIME)) if (exts.includes(ext)) return mime;
  return "";
}

/** Which kind a mime belongs to (null = not accepted). */
export function kindOfMime(mime: unknown): UploadKind | null {
  if (typeof mime !== "string") return null;
  const m = mime.trim().toLowerCase();
  for (const kind of ["image", "video", "document", "animation"] as const) if (UPLOAD_MIME[kind].includes(m)) return kind;
  return null;
}

function extOf(filename: string): string {
  const m = /(\.[a-z0-9]+)$/i.exec(String(filename ?? "").trim());
  return m ? m[1]!.toLowerCase() : "";
}

// ── Validation ─────────────────────────────────────────────────────────────

export type UploadCheck =
  | { ok: true; kind: UploadKind; mime: string; resumable: boolean; advisory: string | null }
  | { ok: false; error: string };

/** Friendly size text, e.g. 4404019 -> "4.2 MB"; under 1 MB -> "640 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes >= 1024 * MB) return `${(Math.round((bytes / (1024 * MB)) * 10) / 10).toString()} GB`;
  return `${(Math.round((bytes / MB) * 10) / 10).toString()} MB`;
}

/**
 * Decide whether ONE file may be uploaded. `rawMime` is what the browser
 * reported (may be ""). Never throws. Messages are plain English for staff.
 */
export function checkUpload(input: { filename: unknown; mime: unknown; size: unknown }): UploadCheck {
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  const size = typeof input.size === "number" && Number.isFinite(input.size) ? input.size : -1;
  if (!filename) return { ok: false, error: "That file has no name — rename it and try again." };
  if (filename.length > 200) return { ok: false, error: "That file name is too long — shorten it to under 200 characters." };
  if (size <= 0) return { ok: false, error: `${filename} is empty (0 bytes) — export it again and retry.` };

  const reported = typeof input.mime === "string" ? input.mime.trim().toLowerCase() : "";
  // R60: animation files are typed by extension (browsers say "" / zip / octet-stream).
  const animMime = ANIMATION_EXT_MIME[extOf(filename)];
  const mime = animMime && (!reported || ["application/octet-stream", "application/zip", "application/x-zip-compressed", "application/json", "text/plain", animMime].includes(reported)) ? animMime : reported || mimeFromFilename(filename);
  const kind = kindOfMime(mime);
  if (!kind) {
    const ext = extOf(filename);
    if (mime === "video/quicktime" || ext === ".mov") {
      return {
        ok: false,
        error: `${filename} is a .MOV video, which many browsers can't play. Export it as MP4 (H.264) — in Canva choose "MP4 Video"; on iPhone set Camera → Formats → "Most Compatible".`,
      };
    }
    if (mime === "image/heic" || mime === "image/heif" || ext === ".heic" || ext === ".heif") {
      return { ok: false, error: `${filename} is an iPhone HEIC photo. Export it as JPG or WebP and upload that.` };
    }
    return {
      ok: false,
      error: `${filename}: unsupported type${mime ? ` (${mime})` : ""}. Allowed: PNG, JPG, WEBP, GIF, SVG, MP4, WEBM video, PDF, or a Lottie (.lottie / .json) or Rive (.riv) animation.`,
    };
  }
  // The extension must agree with the type (stops "photo.png" that is really a video, etc.).
  const ext = extOf(filename);
  if (ext && !EXTS_FOR_MIME[mime]!.includes(ext)) {
    return { ok: false, error: `${filename}: the file name ends in ${ext} but the file is ${mime}. Re-export it with the right extension.` };
  }
  if (size > UPLOAD_MAX_BYTES[kind]) {
    const tip =
      kind === "video"
        ? " Trim it to a short loop (5–15 seconds) or export at 1080p or lower."
        : kind === "image"
          ? " Export it smaller (WebP or JPG at 2–3× the banner size is plenty)."
          : kind === "animation"
            ? " Remove embedded photos from the animation (or export dotLottie, which is compressed) and try again."
            : " Compress the PDF and try again.";
    return { ok: false, error: `${filename} is ${formatBytes(size)} — the limit for ${kind}s is ${UPLOAD_MAX_LABEL[kind]}.${tip}` };
  }
  let advisory: string | null = null;
  if (kind === "video" && size > VIDEO_ADVISORY_BYTES) {
    advisory = `${filename} is ${formatBytes(size)}. It will upload, but every shopper downloads it — aim for under ${formatBytes(VIDEO_ADVISORY_BYTES)} (a 5–15 second loop at 1080p usually is).`;
  } else if (kind === "animation" && size > ANIMATION_ADVISORY_BYTES) {
    advisory = `${filename} is ${formatBytes(size)}. It will upload, but banner animations are usually under ${formatBytes(ANIMATION_ADVISORY_BYTES)} — big ones usually carry embedded photos. dotLottie (.lottie) is compressed and smaller than JSON.`;
  } else if (kind === "image" && mime !== "image/svg+xml" && size > IMAGE_ADVISORY_BYTES) {
    advisory =
      mime === "image/gif"
        ? `${filename} is a ${formatBytes(size)} GIF. GIFs are sent to shoppers as-is — an MP4 of the same animation is usually 5–10× smaller.`
        : `${filename} is ${formatBytes(size)}. It will upload and the site resizes it automatically, but exporting smaller makes the editor faster.`;
  }
  return { ok: true, kind, mime, resumable: size > RESUMABLE_THRESHOLD_BYTES, advisory };
}

// ── Storage keys ───────────────────────────────────────────────────────────

/** A key folder from the media purpose ("banner", "product", ...) or "uploads". */
export function uploadFolder(usageType: unknown): string {
  if (typeof usageType !== "string") return "uploads";
  const f = usageType.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return f || "uploads";
}

/** Safe filename stem: Supabase-allowed characters only, no extension, ≤ 60 chars. */
export function safeStem(filename: string): string {
  const stem = String(filename ?? "").replace(/\.[^.]+$/, "");
  const s = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  return s || "asset";
}

/**
 * Build a FRESH, never-reused storage key for a direct upload:
 *   `<folder>/<16 hex nonce>[p]-<stem><ext>`
 * The nonce makes every upload a new path, so the year-long CDN cache on the
 * object is safe (Supabase: overwriting a path serves stale CDN copies — use a
 * new path instead). The optional `p` marks "a poster image was uploaded
 * beside this video" so renderers can point at it without a lookup.
 */
export function buildUploadKey(input: { folder: string; filename: string; mime: string; nonce: string; withPoster?: boolean }): string | null {
  const nonce = String(input.nonce ?? "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(nonce)) return null;
  const ext = EXT_FOR_MIME[input.mime];
  if (!ext) return null;
  const folder = uploadFolder(input.folder);
  const ownExt = extOf(input.filename);
  const finalExt = ownExt && EXTS_FOR_MIME[input.mime]!.includes(ownExt) ? ownExt : ext;
  const marker = input.withPoster && kindOfMime(input.mime) === "video" ? "p" : "";
  return `${folder}/${nonce}${marker}-${safeStem(input.filename)}${finalExt}`;
}

const DIRECT_KEY_RE = /^[a-z0-9-]{1,40}\/[0-9a-f]{16}p?-[A-Za-z0-9._-]{1,60}\.(png|jpg|jpeg|webp|gif|svg|mp4|m4v|webm|pdf)$/;

/** True only for keys this module would have produced (finish refuses anything else). */
export function isDirectUploadKey(key: unknown): boolean {
  return typeof key === "string" && key.length <= 140 && DIRECT_KEY_RE.test(key) && !key.includes("..");
}

/** The poster image key for a video key, or null when the key isn't a video. */
export function posterKeyFor(videoKey: string): string | null {
  if (typeof videoKey !== "string" || !/\.(mp4|m4v|webm)$/i.test(videoKey)) return null;
  return videoKey.replace(/\.(mp4|m4v|webm)$/i, ".poster.jpg");
}

// ── Video sources (renderers) ──────────────────────────────────────────────

function pathOf(src: string): string {
  return (src.split(/[?#]/, 1)[0] ?? "").toLowerCase();
}

/** True when a banner `src` is a video (by extension). Never throws. */
export function isVideoSrc(src: unknown): boolean {
  if (typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("data:")) return false; // never inline video
  return /\.(mp4|m4v|webm)$/.test(pathOf(s));
}

/** The `type` for a video <source>. */
export function videoMimeForSrc(src: string): string {
  return /\.webm$/.test(pathOf(src)) ? "video/webm" : "video/mp4";
}

/**
 * The poster for a video banner, or "" when none is known. Only OUR direct
 * uploads with the `p` marker have a sibling poster; for anything else we
 * return "" rather than guess a URL that would 404 on every page view.
 */
export function posterForVideoSrc(src: unknown): string {
  if (!isVideoSrc(src)) return "";
  const path = (src as string).trim().split(/[?#]/, 1)[0] ?? "";
  if (!/\/[0-9a-f]{16}p-[^/]+\.(mp4|m4v|webm)$/i.test(path)) return "";
  return path.replace(/\.(mp4|m4v|webm)$/i, ".poster.jpg");
}

/** Mime types a banner picker may offer (images always; videos only where the slot can play them). */
export function isPickableBannerMime(mime: unknown, allowVideo: boolean): boolean {
  const kind = kindOfMime(mime);
  if (kind === "image") return String(mime).toLowerCase() !== "image/svg+xml";
  return allowVideo && kind === "video";
}

/**
 * Content-block image slots whose PUBLIC renderer can play a video (they all
 * render through BannerMedia / SectionBanner / the loyalty hero). Every other
 * image block (locations, price match, footer hours, ...) is drawn by a plain
 * image element, so its picker must NOT offer videos.
 */
export const VIDEO_CAPABLE_BLOCK_KEYS: readonly string[] = [
  "home.category.image",
  "home.brand.image",
  "loyalty.hero.image",
  "loyalty.hero.image_mobile",
];

/** True when the editor for `blockKey` may offer videos. */
export function blockAcceptsVideo(blockKey: unknown): boolean {
  return typeof blockKey === "string" && VIDEO_CAPABLE_BLOCK_KEYS.includes(blockKey);
}

/** A picker choice's kind, from its stored mime (preferred) or its URL. */
export function choiceIsVideo(choice: { mimeType?: string | null; url: string }): boolean {
  if (choice.mimeType) return kindOfMime(choice.mimeType) === "video";
  return isVideoSrc(choice.url);
}

// ── TUS endpoint ───────────────────────────────────────────────────────────

/**
 * Signed resumable endpoint. Supabase: "for optimal performance when
 * uploading large files you should always use the direct storage hostname" —
 * `<ref>.supabase.co` → `<ref>.storage.supabase.co`. A custom domain (not
 * *.supabase.co) is used as-is. Returns "" for a missing/invalid URL.
 */
export function resumableSignedEndpoint(supabaseUrl: unknown): string {
  if (typeof supabaseUrl !== "string" || !supabaseUrl.trim()) return "";
  try {
    const u = new URL(supabaseUrl.trim());
    if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return "";
    const m = /^([a-z0-9-]+)\.supabase\.co$/i.exec(u.hostname);
    const host = m ? `${m[1]}.storage.supabase.co` : u.host;
    return `${u.protocol}//${host}/storage/v1/upload/resumable/sign`;
  } catch {
    return "";
  }
}

/** Sanitize a browser-measured dimension (pixels) — integers 1..16384 or null. */
export function cleanDimension(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 16384 ? n : null;
}

/**
 * Translate a raw Storage/TUS error into plain English. The 413 case is the
 * one the owner can fix himself (Supabase dashboard global file size limit).
 */
export function friendlyStorageError(raw: unknown, size: number): string {
  const msg = String((raw as { message?: unknown })?.message ?? raw ?? "").toLowerCase();
  if (/413|payload too large|entity too large|maximum allowed size|exceeded the maximum/.test(msg)) {
    return `Supabase refused the file as too large (${formatBytes(size)}). In Supabase → Storage → Settings, set the Global file size limit to at least 200 MB (Pro allows up to 500 GB), then retry.`;
  }
  if (/invalid signature|jwt|expired|401|403/.test(msg)) {
    return "The upload permission expired or was refused. Reload the page and try again.";
  }
  if (/409|already exists|duplicate/.test(msg)) {
    return "A file already exists at that spot. Try the upload again (it will get a new name).";
  }
  if (/network|failed to fetch|timeout|offline/.test(msg)) {
    return "The connection dropped during the upload. Check the internet connection and try again — large files resume where they stopped.";
  }
  return `The upload didn't finish${msg ? ` (${msg.slice(0, 160)})` : ""}. Try again; if it keeps failing, send this message to support.`;
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runUploadPolicyCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("upload-policy-core FAIL:", m);
    }
  };

  // Sizes / thresholds (Supabase: 6 MB line, 6 MB chunks).
  ok(RESUMABLE_THRESHOLD_BYTES === 6291456, "6 MB threshold");
  ok(RESUMABLE_CHUNK_BYTES === 6291456, "6 MB chunk");
  ok(MEDIA_BUCKET_FILE_SIZE_LIMIT_BYTES === 209715200, "bucket cap 200 MB");
  ok(MEDIA_BUCKET_FILE_SIZE_LIMIT_BYTES === Math.max(...Object.values(UPLOAD_MAX_BYTES)), "bucket cap = largest kind cap");
  ok(UPLOAD_MAX_BYTES.image > 4.5 * MB, "images can exceed Vercel's 4.5 MB now");

  // formatBytes
  ok(formatBytes(4404019) === "4.2 MB", "4.2 MB");
  ok(formatBytes(655360) === "640 KB", "640 KB");
  ok(formatBytes(10) === "1 KB", "tiny -> 1 KB");
  ok(formatBytes(-1) === "0 KB", "negative");
  ok(formatBytes(NaN) === "0 KB", "NaN");
  ok(formatBytes(3 * 1024 * MB) === "3 GB", "GB");

  // kindOfMime / mimeFromFilename
  ok(kindOfMime("video/mp4") === "video", "mp4 video");
  ok(kindOfMime("VIDEO/WEBM") === "video", "webm upper");
  ok(kindOfMime("image/gif") === "image", "gif image");
  ok(kindOfMime("application/pdf") === "document", "pdf doc");
  ok(kindOfMime("video/quicktime") === null, "mov refused");
  ok(kindOfMime(42) === null, "non-string");
  ok(mimeFromFilename("a.MP4") === "video/mp4", "ext mp4");
  ok(mimeFromFilename("a.jpeg") === "image/jpeg", "ext jpeg");
  ok(mimeFromFilename("a.m4v") === "video/mp4", "ext m4v");
  ok(mimeFromFilename("a.exe") === "", "ext unknown");

  // checkUpload — accepts
  const big = checkUpload({ filename: "hero.mp4", mime: "video/mp4", size: 30 * MB });
  ok(big.ok && big.kind === "video" && big.resumable, "30 MB mp4 ok + resumable");
  ok(big.ok && typeof big.advisory === "string" && big.advisory.includes("aim for under"), "30 MB video advisory");
  const small = checkUpload({ filename: "loop.webm", mime: "video/webm", size: 3 * MB });
  ok(small.ok && !small.resumable && small.advisory === null, "3 MB webm plain, no advisory");
  const img = checkUpload({ filename: "banner.webp", mime: "image/webp", size: 12 * MB });
  ok(img.ok && img.kind === "image" && img.resumable, "12 MB webp now allowed (was 4 MB)");
  ok(img.ok && (img.advisory ?? "").includes("resizes it automatically"), "big image advisory");
  const gif = checkUpload({ filename: "anim.gif", mime: "image/gif", size: 5 * MB });
  ok(gif.ok && (gif.advisory ?? "").includes("MP4"), "big gif suggests mp4");
  const svg = checkUpload({ filename: "logo.svg", mime: "image/svg+xml", size: 3 * MB });
  ok(svg.ok && svg.advisory === null, "svg no advisory");
  const noMime = checkUpload({ filename: "clip.mp4", mime: "", size: MB });
  ok(noMime.ok && noMime.mime === "video/mp4", "empty browser mime -> from extension");
  const exact = checkUpload({ filename: "e.mp4", mime: "video/mp4", size: 200 * MB });
  ok(exact.ok, "exactly 200 MB ok");
  const atLine = checkUpload({ filename: "x.png", mime: "image/png", size: 6 * MB });
  ok(atLine.ok && !atLine.resumable, "exactly 6 MB -> plain");
  const overLine = checkUpload({ filename: "x.png", mime: "image/png", size: 6 * MB + 1 });
  ok(overLine.ok && overLine.resumable, "6 MB + 1 -> resumable");

  // checkUpload — refusals
  const tooBig = checkUpload({ filename: "e.mp4", mime: "video/mp4", size: 200 * MB + 1 });
  ok(!tooBig.ok && tooBig.error.includes("200 MB"), "over 200 MB refused");
  const imgBig = checkUpload({ filename: "e.png", mime: "image/png", size: 51 * MB });
  ok(!imgBig.ok && imgBig.error.includes("50 MB"), "image over 50 MB refused");
  const mov = checkUpload({ filename: "IMG_1.MOV", mime: "video/quicktime", size: MB });
  ok(!mov.ok && mov.error.includes("MP4"), "mov explained");
  const heic = checkUpload({ filename: "IMG_2.HEIC", mime: "image/heic", size: MB });
  ok(!heic.ok && heic.error.includes("HEIC"), "heic explained");
  const exe = checkUpload({ filename: "x.exe", mime: "application/x-msdownload", size: MB });
  ok(!exe.ok && exe.error.includes("unsupported"), "exe refused");
  const lie = checkUpload({ filename: "photo.png", mime: "video/mp4", size: MB });
  ok(!lie.ok && lie.error.includes("ends in .png"), "ext/mime mismatch refused");
  ok(!checkUpload({ filename: "", mime: "image/png", size: 1 }).ok, "no name");
  ok(!checkUpload({ filename: "a.png", mime: "image/png", size: 0 }).ok, "empty file");
  ok(!checkUpload({ filename: "a.png", mime: "image/png", size: NaN }).ok, "NaN size");
  ok(!checkUpload({ filename: "a".repeat(201) + ".png", mime: "image/png", size: 1 }).ok, "long name");
  ok(!checkUpload({ filename: 7, mime: "image/png", size: 1 }).ok, "non-string name");

  // Keys
  ok(uploadFolder("Banner Hero") === "banner-hero", "folder slug");
  ok(uploadFolder("") === "uploads" && uploadFolder(null) === "uploads", "folder default");
  ok(uploadFolder("../../etc") === "etc", "folder traversal stripped");
  ok(safeStem("My Promo (final).mp4") === "My-Promo-final", "stem");
  ok(safeStem(".mp4") === "asset" && safeStem("") === "asset", "stem default");
  const k = buildUploadKey({ folder: "banner", filename: "Spring Sale.mp4", mime: "video/mp4", nonce: "0123456789abcdef", withPoster: true });
  ok(k === "banner/0123456789abcdefp-Spring-Sale.mp4", "video key with poster marker");
  const k2 = buildUploadKey({ folder: "", filename: "x.JPEG", mime: "image/jpeg", nonce: "0123456789ABCDEF", withPoster: true });
  ok(k2 === "uploads/0123456789abcdef-x.jpeg", "image key: no marker, own ext kept, nonce lower");
  const k3 = buildUploadKey({ folder: "logo", filename: "noext", mime: "image/png", nonce: "0123456789abcdef" });
  ok(k3 === "logo/0123456789abcdef-noext.png", "missing ext appended");
  ok(buildUploadKey({ folder: "a", filename: "x.png", mime: "image/png", nonce: "short" }) === null, "bad nonce");
  ok(buildUploadKey({ folder: "a", filename: "x.mov", mime: "video/quicktime", nonce: "0123456789abcdef" }) === null, "bad mime");
  ok(isDirectUploadKey(k) && isDirectUploadKey(k2) && isDirectUploadKey(k3), "own keys accepted");
  ok(!isDirectUploadKey("banner/abc.mp4"), "foreign key refused");
  ok(!isDirectUploadKey("../banner/0123456789abcdef-x.png"), "traversal refused");
  ok(!isDirectUploadKey("banner/0123456789abcdef-x.exe"), "bad ext refused");
  ok(!isDirectUploadKey("Banner/0123456789abcdef-x.png"), "upper folder refused");
  ok(!isDirectUploadKey(null), "null refused");
  ok(posterKeyFor("banner/0123456789abcdefp-a.mp4") === "banner/0123456789abcdefp-a.poster.jpg", "poster key");
  ok(posterKeyFor("banner/x.png") === null, "poster key only for video");

  // Video src detection
  ok(isVideoSrc("https://x.supabase.co/storage/v1/object/public/media/banner/a.mp4"), "mp4 url");
  ok(isVideoSrc("/home/loop.WEBM"), "site webm upper");
  ok(isVideoSrc("https://x/y.mp4?v=2#t=1"), "query/hash");
  ok(isVideoSrc("https://x/y.m4v"), "m4v");
  ok(!isVideoSrc("https://x/y.gif"), "gif not video");
  ok(!isVideoSrc("https://x/mp4/y.png"), "folder named mp4 not video");
  ok(!isVideoSrc("data:video/mp4;base64,AAAA"), "data: video refused");
  ok(!isVideoSrc("") && !isVideoSrc(undefined) && !isVideoSrc(5), "non-strings");
  ok(videoMimeForSrc("/a.webm?x") === "video/webm" && videoMimeForSrc("/a.mp4") === "video/mp4", "source type");
  const pv = "https://x.supabase.co/storage/v1/object/public/media/banner/0123456789abcdefp-a.mp4";
  ok(posterForVideoSrc(pv) === pv.replace(/\.mp4$/, ".poster.jpg"), "poster for marked video");
  ok(posterForVideoSrc(pv + "?v=1") === pv.replace(/\.mp4$/, ".poster.jpg"), "poster ignores query");
  ok(posterForVideoSrc("https://x/media/banner/0123456789abcdef-a.mp4") === "", "no marker -> no poster guess");
  ok(posterForVideoSrc("/home/loop.mp4") === "", "site video -> no poster guess");
  ok(posterForVideoSrc("/a.png") === "", "image -> no poster");

  // Picker mimes
  ok(isPickableBannerMime("image/webp", false) && isPickableBannerMime("image/gif", true), "images pickable");
  ok(!isPickableBannerMime("image/svg+xml", true), "svg not a banner");
  ok(isPickableBannerMime("video/mp4", true) && !isPickableBannerMime("video/mp4", false), "video only when allowed");
  ok(!isPickableBannerMime("application/pdf", true), "pdf never");

  // TUS endpoint
  ok(resumableSignedEndpoint("https://abcd1234.supabase.co") === "https://abcd1234.storage.supabase.co/storage/v1/upload/resumable/sign", "direct storage host");
  ok(resumableSignedEndpoint("https://abcd1234.supabase.co/") === "https://abcd1234.storage.supabase.co/storage/v1/upload/resumable/sign", "trailing slash");
  ok(resumableSignedEndpoint("https://db.example.com") === "https://db.example.com/storage/v1/upload/resumable/sign", "custom domain kept");
  ok(resumableSignedEndpoint("http://evil.com") === "", "plain http refused");
  ok(resumableSignedEndpoint("") === "" && resumableSignedEndpoint("nope") === "", "invalid");

  // Dimensions
  ok(cleanDimension(1920) === 1920 && cleanDimension(1079.6) === 1080, "dims");
  ok(cleanDimension(0) === null && cleanDimension(20000) === null && cleanDimension("9") === null, "bad dims");

  // Friendly errors
  ok(friendlyStorageError({ message: "Payload too large" }, 60 * MB).includes("Global file size limit"), "413 -> dashboard tip");
  ok(friendlyStorageError(new Error("tus: unexpected response, 413"), MB).includes("200 MB"), "tus 413");
  ok(friendlyStorageError("invalid signature", MB).includes("Reload"), "signature");
  ok(friendlyStorageError("Failed to fetch", MB).includes("connection"), "network");
  ok(friendlyStorageError("The resource already exists (409)", MB).includes("new name"), "409");
  ok(friendlyStorageError(null, MB).startsWith("The upload didn't finish"), "null");

  // Accept attr covers everything checkUpload accepts.
  for (const kind of ["image", "video", "document"] as const)
    for (const m of UPLOAD_MIME[kind]) ok(UPLOAD_ACCEPT_ATTR.includes(m), `accept has ${m}`);

    // R44 video-capable slots
  ok(blockAcceptsVideo("home.category.image"), "home category banner takes video");
  ok(blockAcceptsVideo("loyalty.hero.image_mobile"), "loyalty phone hero takes video");
  ok(!blockAcceptsVideo("footer.hours.image"), "footer hours image stays image-only");
  ok(!blockAcceptsVideo("locations.hero.image"), "locations hero stays image-only");
  ok(!blockAcceptsVideo(undefined), "no key -> no video");
  ok(choiceIsVideo({ mimeType: "video/mp4", url: "https://x/a.jpg" }), "mime wins over url");
  ok(!choiceIsVideo({ mimeType: "image/png", url: "https://x/a.mp4" }), "image mime wins");
  ok(choiceIsVideo({ url: "https://x/a.webm?v=1" }), "url fallback");
  ok(!choiceIsVideo({ mimeType: null, url: "/a.png" }), "png url not video");

  // R60: Lottie + Rive animations (typed by extension; bytes proven server-side).
  const riv = checkUpload({ filename: "truck.riv", mime: "", size: 58792 });
  ok(riv.ok && riv.kind === "animation" && riv.mime === "application/octet-stream", ".riv with no browser type");
  const lot = checkUpload({ filename: "leaf.lottie", mime: "application/zip", size: 3148 });
  ok(lot.ok && lot.mime === "application/zip+dotlottie", ".lottie reported as zip");
  const lj = checkUpload({ filename: "leaf.json", mime: "application/json", size: 31539 });
  ok(lj.ok && lj.kind === "animation" && lj.mime === "application/json", "lottie json");
  ok(!checkUpload({ filename: "x.riv", mime: "image/png", size: 10 }).ok, "riv claiming png refused");
  ok(!checkUpload({ filename: "x.zip", mime: "application/zip", size: 10 }).ok, "plain zip still refused");
  ok(!checkUpload({ filename: "x.exe", mime: "application/octet-stream", size: 10 }).ok, "octet-stream without .riv refused");
  ok(!checkUpload({ filename: "big.lottie", mime: "", size: 21 * MB }).ok, "animation size cap");
  const adv = checkUpload({ filename: "heavy.json", mime: "application/json", size: 2 * MB });
  ok(adv.ok && !!adv.advisory, "heavy animation advisory");
  ok(UPLOAD_ACCEPT_ATTR.includes(".riv") && UPLOAD_ACCEPT_ATTR.includes(".lottie"), "accept has animation extensions");
  ok(buildUploadKey({ folder: "banner", filename: "My Truck.riv", mime: "application/octet-stream", nonce: "0123456789abcdef" })?.endsWith(".riv") === true, "key keeps .riv");
  return { passed, failed };
}

/**
 * src/lib/inventory/destruction-evidence-core.ts  (Fix Phase 1.7a · G-43 req 7)
 *
 * PURE rules for the optional photo and video evidence of a destruction. No
 * I/O, so the server actions, the uploader, the per-event print and the tests
 * share one source.
 *
 * Owner basis (verbatim, owner message 4): "please build the photo upload
 * (G-43), as well as a video upload just in case." G-43 requirement 7:
 * "Optional photo upload of the rendered mixture." The destruction record is
 * kept five years (WAC 314-55-097), so the evidence is kept with it in a
 * PRIVATE bucket (never the public `media` bucket).
 *
 * What it decides
 *   1. Accepted types. Photo: JPEG, PNG, WebP and iPhone HEIC. Video: MP4,
 *      WebM and iPhone QuickTime (.MOV). Unlike the public Media Library
 *      (which refuses HEIC and MOV because shoppers' browsers cannot show
 *      them), evidence is private and only staff open it, so a phone's own
 *      format is kept as recorded rather than refused.
 *   2. Size. Photo up to 50 MB, video up to 200 MB (the Media Library's own
 *      limits, upload-policy-core UPLOAD_MAX_BYTES; the bucket cap in
 *      migration 0312 is 200 MB). Over 6 MB goes resumable (TUS).
 *   3. Which events. Any event that is not Cancelled (a cancelled destruction
 *      destroyed nothing).
 *   4. Storage key. `events/<event id>/<16 hex>-<safe name><ext>`, never
 *      reused, and the finish step only accepts a key under the same event.
 *   5. Proof from the bytes. After the upload the server reads the stored
 *      size and type and the file's first bytes; the type sniffed from the
 *      bytes (file-signature-core sniffMime) must equal the declared type,
 *      and the stored size must equal what the browser sent.
 */

import { sniffMime } from "@/lib/media/file-signature-core";

export const EVIDENCE_BUCKET = "destruction-evidence";
export const EVIDENCE_PENDING_MIGRATION =
  "Photo and video evidence needs migration 0312_destruction_evidence.sql. Apply it in the Supabase SQL editor (after 0311), then reload.";
export const EVIDENCE_UPLOAD_AUDIT_ACTION = "destruction.evidence_uploaded";
export const EVIDENCE_REFUSED_AUDIT_ACTION = "destruction.evidence_refused";
export const EVIDENCE_NOTE_MAX = 500;
export const EVIDENCE_FILENAME_MAX = 200;
/** How long a viewing link lasts (seconds). Short: the bucket is private. */
export const EVIDENCE_VIEW_SECONDS = 600;

const MB = 1024 * 1024;
export const EVIDENCE_RESUMABLE_THRESHOLD_BYTES = 6 * MB;

export type EvidenceKind = "photo" | "video";

export const EVIDENCE_MIME: Record<EvidenceKind, readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};
export const EVIDENCE_MAX_BYTES: Record<EvidenceKind, number> = { photo: 50 * MB, video: 200 * MB };
export const EVIDENCE_MAX_LABEL: Record<EvidenceKind, string> = { photo: "50 MB", video: "200 MB" };

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};
const MIME_FOR_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heic",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
const LABEL: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/heic": "iPhone HEIC",
  "video/mp4": "MP4",
  "video/webm": "WebM",
  "video/quicktime": "iPhone .MOV",
};
export const EVIDENCE_ACCEPT_ATTR = [
  ...EVIDENCE_MIME.photo,
  ...EVIDENCE_MIME.video,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
].join(",");

export function evidenceLabel(mime: string): string {
  return LABEL[mime] ?? mime;
}

export function formatEvidenceBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function extOf(filename: string): string {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(String(filename ?? "").trim());
  return m ? m[0].toLowerCase() : "";
}

/** Normalise a declared type; browsers often send "" (or heif) for iPhone files, so fall back to the extension. */
export function evidenceMime(declared: unknown, filename: unknown): string {
  const d = typeof declared === "string" ? declared.toLowerCase().split(";")[0]!.trim() : "";
  if (d === "image/heif") return "image/heic";
  if (d === "image/jpg") return "image/jpeg";
  if (d && EXT_FOR_MIME[d]) return d;
  return MIME_FOR_EXT[extOf(String(filename ?? ""))] ?? d;
}

export function evidenceKindOfMime(mime: unknown): EvidenceKind | null {
  if (typeof mime !== "string") return null;
  if (EVIDENCE_MIME.photo.includes(mime)) return "photo";
  if (EVIDENCE_MIME.video.includes(mime)) return "video";
  return null;
}

/** Can a browser show it inline? HEIC (Safari only) and MOV are offered as downloads too. */
export function evidenceInline(mime: string): "image" | "video" | null {
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return "image";
  if (mime === "video/mp4" || mime === "video/webm" || mime === "video/quicktime") return "video";
  return null;
}

export type EvidenceRefusal = { ok: false; code: string; error: string };
export type EvidenceStartOk = { ok: true; kind: EvidenceKind; mime: string; resumable: boolean; filename: string; note: string | null };

/** Step 1 (before any byte is sent): is this file and this event acceptable? */
export function evaluateEvidenceStart(input: {
  filename: unknown;
  mime: unknown;
  size: unknown;
  note: unknown;
  eventStatus: string | null;
}): EvidenceStartOk | EvidenceRefusal {
  if (!input.eventStatus) return { ok: false, code: "event_missing", error: "That destruction event was not found." };
  if (input.eventStatus === "cancelled") {
    return { ok: false, code: "event_cancelled", error: "That destruction was cancelled, so nothing was destroyed and there is nothing to record." };
  }
  const filename = String(input.filename ?? "").trim().slice(0, EVIDENCE_FILENAME_MAX);
  if (!filename) return { ok: false, code: "no_name", error: "The file has no name. Rename it and try again." };
  const mime = evidenceMime(input.mime, filename);
  const kind = evidenceKindOfMime(mime);
  if (!kind) {
    return {
      ok: false,
      code: "type",
      error: `${filename} is not a photo or video this page keeps. Use a JPG, PNG, WebP or iPhone HEIC photo, or an MP4, WebM or iPhone .MOV video.`,
    };
  }
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, code: "empty", error: `${filename} is empty (0 bytes). Take or export it again.` };
  if (size > EVIDENCE_MAX_BYTES[kind]) {
    return {
      ok: false,
      code: "too_big",
      error: `${filename} is ${formatEvidenceBytes(size)}; a ${kind} may be up to ${EVIDENCE_MAX_LABEL[kind]}.${kind === "video" ? " Trim the clip to the destruction itself, or record at 1080p." : ""}`,
    };
  }
  const noteRaw = typeof input.note === "string" ? input.note.trim() : "";
  if (noteRaw.length > EVIDENCE_NOTE_MAX) return { ok: false, code: "note_long", error: `The note is over ${EVIDENCE_NOTE_MAX} characters.` };
  return { ok: true, kind, mime, resumable: size > EVIDENCE_RESUMABLE_THRESHOLD_BYTES, filename, note: noteRaw || null };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.toLowerCase());
}

function safeStem(filename: string): string {
  const stem = String(filename ?? "").replace(/\.[^.]+$/, "");
  const s = stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  return s || "evidence";
}

/** A fresh, never-reused key under the event: events/<event>/<nonce>-<stem><ext>. */
export function buildEvidenceKey(input: { eventId: string; nonce: string; filename: string; mime: string }): string | null {
  if (!isUuid(input.eventId)) return null;
  const nonce = String(input.nonce ?? "").toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(nonce)) return null;
  const ext = EXT_FOR_MIME[input.mime];
  if (!ext) return null;
  return `events/${input.eventId.toLowerCase()}/${nonce}-${safeStem(input.filename)}${ext}`;
}

const KEY_RE = /^events\/([0-9a-f-]{36})\/[0-9a-f]{16}-[A-Za-z0-9._-]{1,60}\.(jpg|png|webp|heic|mp4|webm|mov)$/;

/** The finish step only accepts a key this module built, under the SAME event. */
export function isEvidenceKeyFor(key: unknown, eventId: unknown): boolean {
  if (typeof key !== "string" || !isUuid(eventId)) return false;
  const m = KEY_RE.exec(key);
  return !!m && m[1] === String(eventId).toLowerCase();
}

/** The type the key's extension stands for. */
export function mimeOfEvidenceKey(key: string): string {
  return MIME_FOR_EXT[extOf(key)] ?? "";
}

export type StoredEvidenceOk = { ok: true; kind: EvidenceKind; mime: string; size: number };

/**
 * Step 2 (after the upload): the size and type Storage recorded, and the
 * first bytes of the stored file, must all agree with what was started.
 */
export function evaluateStoredEvidence(input: {
  key: string;
  declaredSize: unknown;
  storedSize: unknown;
  storedMime: unknown;
  head: Uint8Array | null;
  filename: string;
}): StoredEvidenceOk | EvidenceRefusal {
  const name = input.filename || "That file";
  const keyMime = mimeOfEvidenceKey(input.key);
  const kind = evidenceKindOfMime(keyMime);
  if (!kind) return { ok: false, code: "key", error: "That upload reference is invalid." };
  const storedSize = Number(input.storedSize);
  if (!Number.isFinite(storedSize) || storedSize <= 0) return { ok: false, code: "missing", error: `${name} did not arrive in storage. Upload it again.` };
  if (storedSize !== Number(input.declaredSize)) return { ok: false, code: "size", error: `${name} arrived incomplete (size mismatch). Upload it again.` };
  if (storedSize > EVIDENCE_MAX_BYTES[kind]) return { ok: false, code: "too_big", error: `${name} is over the ${EVIDENCE_MAX_LABEL[kind]} ${kind} limit.` };
  const stored = evidenceMime(input.storedMime, input.key);
  if (stored !== keyMime) return { ok: false, code: "stored_type", error: `Storage recorded ${name} as ${stored || "an unknown type"}, not ${evidenceLabel(keyMime)}. Upload it again.` };
  if (!(input.head instanceof Uint8Array) || input.head.length === 0) {
    return { ok: false, code: "unread", error: `${name} could not be safety-checked (storage did not answer). Upload it again.` };
  }
  const sniffed = sniffMime(input.head);
  if (sniffed !== keyMime) {
    return {
      ok: false,
      code: "signature",
      error: `${name} says it is ${evidenceLabel(keyMime)} but its contents are ${sniffed ? evidenceLabel(sniffed) : "not a recognisable photo or video"}. It was refused and removed.`,
    };
  }
  return { ok: true, kind, mime: keyMime, size: storedSize };
}

/** One line per item for the log and print: "2 photos, 1 video". */
export function evidenceSummary(rows: readonly { kind: string }[]): string {
  const p = rows.filter((r) => r.kind === "photo").length;
  const v = rows.filter((r) => r.kind === "video").length;
  const parts: string[] = [];
  if (p) parts.push(`${p} photo${p === 1 ? "" : "s"}`);
  if (v) parts.push(`${v} video${v === 1 ? "" : "s"}`);
  return parts.join(", ") || "none";
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runDestructionEvidenceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`destruction-evidence-core FAIL: ${msg}`);
    }
  };
  const EV = "0b5a3c1e-1111-4222-8333-444455556666";
  const start = (o: Partial<Parameters<typeof evaluateEvidenceStart>[0]>) =>
    evaluateEvidenceStart({ filename: "mix.jpg", mime: "image/jpeg", size: 1000, note: "", eventStatus: "completed", ...o });

  // 1 types
  ok(start({}).ok === true, "jpeg photo accepted");
  const heic = start({ filename: "IMG_1.HEIC", mime: "" });
  ok(heic.ok && heic.mime === "image/heic" && heic.kind === "photo", "HEIC from extension");
  const mov = start({ filename: "IMG_2.MOV", mime: "video/quicktime", size: 30 * MB });
  ok(mov.ok && mov.kind === "video" && mov.resumable, "MOV video, resumable over 6 MB");
  ok(start({ filename: "a.gif", mime: "image/gif" }).ok === false, "gif refused");
  ok(start({ filename: "a.pdf", mime: "application/pdf" }).ok === false, "pdf refused");
  ok(evidenceMime("image/heif", "x") === "image/heic", "heif normalised");
  ok(evidenceMime("image/jpg", "x") === "image/jpeg", "image/jpg normalised");
  // 2 size
  ok(start({ size: 0 }).ok === false, "empty refused");
  ok(start({ size: 50 * MB }).ok === true, "photo at 50 MB accepted");
  ok(start({ size: 50 * MB + 1 }).ok === false, "photo over 50 MB refused");
  ok(start({ filename: "v.mp4", mime: "video/mp4", size: 200 * MB }).ok === true, "video at 200 MB accepted");
  ok(start({ filename: "v.mp4", mime: "video/mp4", size: 200 * MB + 1 }).ok === false, "video over 200 MB refused");
  const small = start({ size: 6 * MB });
  ok(small.ok && !small.resumable, "6 MB is a single upload");
  // 3 events
  ok(start({ eventStatus: "cancelled" }).ok === false, "cancelled event refused");
  ok(start({ eventStatus: null }).ok === false, "missing event refused");
  ok(start({ eventStatus: "ready" }).ok === true, "open event accepted");
  ok(start({ note: "x".repeat(501) }).ok === false, "long note refused");
  const n = start({ note: "  after grinding  " });
  ok(n.ok && n.note === "after grinding", "note trimmed");
  // 4 keys
  const key = buildEvidenceKey({ eventId: EV, nonce: "0123456789abcdef", filename: "My Photo!.jpeg", mime: "image/jpeg" });
  ok(key === `events/${EV}/0123456789abcdef-My-Photo.jpg`, `key shape ${key}`);
  ok(isEvidenceKeyFor(key, EV), "key belongs to its event");
  ok(!isEvidenceKeyFor(key, "0b5a3c1e-1111-4222-8333-444455550000"), "key refused for another event");
  ok(!isEvidenceKeyFor("../media/x.jpg", EV), "traversal refused");
  ok(buildEvidenceKey({ eventId: "nope", nonce: "0123456789abcdef", filename: "a", mime: "image/jpeg" }) === null, "bad event id");
  ok(buildEvidenceKey({ eventId: EV, nonce: "xyz", filename: "a", mime: "image/jpeg" }) === null, "bad nonce");
  // 5 bytes
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ftyp = (brand: string) => {
    const b = new Uint8Array(24);
    b.set([0, 0, 0, 24], 0);
    b.set([...("ftyp" + brand + "\0\0\0\0" + brand)].map((c) => c.charCodeAt(0)), 4);
    return b;
  };
  const stored = (o: Partial<Parameters<typeof evaluateStoredEvidence>[0]>) =>
    evaluateStoredEvidence({ key: key!, declaredSize: 1000, storedSize: 1000, storedMime: "image/jpeg", head: jpg, filename: "mix.jpg", ...o });
  ok(stored({}).ok === true, "real jpeg verified");
  ok(stored({ head: png }).ok === false, "png bytes in a .jpg refused");
  ok(stored({ storedSize: 999 }).ok === false, "size mismatch refused");
  ok(stored({ storedMime: "image/png" }).ok === false, "stored type mismatch refused");
  ok(stored({ head: null }).ok === false, "unreadable refused");
  const movKey = `events/${EV}/0123456789abcdef-IMG.mov`;
  ok(evaluateStoredEvidence({ key: movKey, declaredSize: 10, storedSize: 10, storedMime: "video/quicktime", head: ftyp("qt  "), filename: "IMG.mov" }).ok, "MOV verified from qt brand");
  const heicKey = `events/${EV}/0123456789abcdef-IMG.heic`;
  ok(evaluateStoredEvidence({ key: heicKey, declaredSize: 10, storedSize: 10, storedMime: "image/heic", head: ftyp("heic"), filename: "IMG.heic" }).ok, "HEIC verified from heic brand");
  const mp4Key = `events/${EV}/0123456789abcdef-clip.mp4`;
  ok(evaluateStoredEvidence({ key: mp4Key, declaredSize: 10, storedSize: 10, storedMime: "video/mp4", head: ftyp("isom"), filename: "clip.mp4" }).ok, "MP4 verified");
  ok(!evaluateStoredEvidence({ key: mp4Key, declaredSize: 10, storedSize: 10, storedMime: "video/mp4", head: ftyp("qt  "), filename: "clip.mp4" }).ok, "MOV bytes named .mp4 refused");
  // summary + inline
  ok(evidenceSummary([{ kind: "photo" }, { kind: "photo" }, { kind: "video" }]) === "2 photos, 1 video", "summary");
  ok(evidenceSummary([]) === "none", "summary none");
  ok(evidenceInline("image/heic") === null && evidenceInline("image/png") === "image", "inline rules");
  return { passed, failed };
}

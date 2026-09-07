/**
 * ANNOUNCER SOUND LIBRARY — pure logic (SLICE 31)
 *
 * Everything here is a pure function so it can be proved without a database,
 * a network, or a file. The rules encoded here answer one question:
 *
 *     "Is this file safe to accept, and will a Raspberry Pi actually play it?"
 *
 * The second half of that question is the one that matters in the shop. A file
 * that uploads perfectly but cannot be decoded by aplay or mpg123 produces a
 * SILENT speaker, and a silent speaker is indistinguishable from a broken one
 * to the person standing next to it. So the accepted formats here are
 * deliberately narrow: WAV and MP3 only, because those are the two the agent
 * can play with tools that are on every Raspberry Pi OS image.
 *
 * NOTE ON SIZE: the cap is small on purpose. This is a doorbell, not a music
 * player. A 25MB file would be cached on every Pi's SD card, re-downloaded
 * after every cache clear, and would delay the announcement it exists to make.
 */

/** What a Pi can play without extra software. Keep this in step with play_file() in the agent. */
export const ALLOWED_SOUND_EXTENSIONS = ["wav", "mp3"] as const;
export type AllowedSoundExtension = (typeof ALLOWED_SOUND_EXTENSIONS)[number];

/**
 * 5MB. A two second chime is ~200KB as WAV. Anything approaching this cap is
 * a song, not a notification, and would slow the announcement down.
 */
export const MAX_SOUND_BYTES = 5 * 1024 * 1024;

/** Below this a file is certainly not audio — it is an error page or a stub. */
export const MIN_SOUND_BYTES = 256;

/** Storage prefix inside the private `announcer-sounds` bucket. */
export const SOUND_STORAGE_PREFIX = "custom";

export type SoundValidationOk = {
  ok: true;
  extension: AllowedSoundExtension;
  /** Cleaned label safe to show in the back office. */
  label: string;
};

export type SoundValidationError = {
  ok: false;
  /** Plain English, written for the owner, always with the fix attached. */
  error: string;
};

export type SoundValidation = SoundValidationOk | SoundValidationError;

/**
 * Pull a lowercase extension from a filename.
 * Returns null when there is no usable extension at all.
 */
export function extensionOf(fileName: unknown): string | null {
  if (typeof fileName !== "string") return null;
  const trimmed = fileName.trim();
  if (trimmed === "") return null;
  const dot = trimmed.lastIndexOf(".");
  // A leading dot (".wav") is a hidden file with no name, not an extension.
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return trimmed.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(ext: unknown): ext is AllowedSoundExtension {
  return (
    typeof ext === "string" &&
    (ALLOWED_SOUND_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
  );
}

/**
 * Turn any filename into a friendly display label.
 *
 * "AIRHORN_final(2).WAV" becomes "AIRHORN final 2". The owner named the file;
 * we keep their name recognisable rather than replacing it with an id.
 */
export function labelFromFileName(fileName: unknown, fallback = "Custom sound"): string {
  if (typeof fileName !== "string") return fallback;
  let base = fileName.trim();
  if (base === "") return fallback;

  // Drop any directory part a browser might include.
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (slash >= 0) base = base.slice(slash + 1);

  const dot = base.lastIndexOf(".");
  if (dot > 0) base = base.slice(0, dot);

  const cleaned = base
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\p{L}\p{N} ()]+/gu, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "") return fallback;
  return cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
}

/**
 * Build the storage path for an upload.
 *
 * The path is generated, never taken from the user's filename, so two people
 * uploading "chime.wav" cannot collide and a strange filename cannot produce a
 * strange path. The extension is preserved because the Pi chooses its player
 * from the extension.
 */
export function buildStoragePath(id: string, extension: AllowedSoundExtension): string {
  const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, "");
  return `${SOUND_STORAGE_PREFIX}/${safeId}.${extension}`;
}

/**
 * Is this a storage path this system produced?
 *
 * Used by the download route. The Pi is trusted, but a typo in a device row
 * must not turn into a request for an arbitrary object in the bucket, so the
 * route only serves paths that match the shape we generate.
 */
export function isValidStoragePath(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (trimmed === "" || trimmed.length > 200) return false;
  // Exactly: custom/<id>.<ext> with no traversal and no nesting.
  return /^custom\/[a-zA-Z0-9-]{1,64}\.(wav|mp3)$/.test(trimmed);
}

/** Content type to serve a cached sound with. */
export function contentTypeFor(path: string): string {
  return path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
}

/** Human-friendly size, for the back office table. */
export function formatBytes(bytes: unknown): string {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  if (n <= 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The gate every upload passes through.
 *
 * Every rejection says what to do next. "Invalid file" tells the owner
 * nothing; "MP3 or WAV only — export it as a WAV and try again" tells them
 * exactly how to succeed.
 */
export function validateUpload(input: {
  fileName: unknown;
  bytes: unknown;
  label?: unknown;
}): SoundValidation {
  const ext = extensionOf(input.fileName);
  if (ext === null) {
    return {
      ok: false,
      error:
        "That file has no file type on the end of its name. " +
        "Rename it so it ends in .wav or .mp3, then upload it again.",
    };
  }
  if (!isAllowedExtension(ext)) {
    return {
      ok: false,
      error:
        `A .${ext} file will not play on the speakers. ` +
        "Use a .wav or .mp3 file — most sound editors can save as either.",
    };
  }

  const bytes = typeof input.bytes === "number" && Number.isFinite(input.bytes) ? input.bytes : -1;
  if (bytes < 0) {
    return {
      ok: false,
      error: "That file could not be read. Try uploading it again.",
    };
  }
  if (bytes < MIN_SOUND_BYTES) {
    return {
      ok: false,
      error:
        "That file is too small to be a real sound — it may be empty or damaged. " +
        "Check it plays on your computer first, then upload it again.",
    };
  }
  if (bytes > MAX_SOUND_BYTES) {
    return {
      ok: false,
      error:
        `That file is ${formatBytes(bytes)}, and the limit is 5 MB. ` +
        "An announcement should be a short chime, not a song. " +
        "Trim it to a few seconds and upload it again.",
    };
  }

  // An explicit label wins; otherwise derive one from the filename.
  const explicit =
    typeof input.label === "string" && input.label.trim() !== ""
      ? input.label.trim().slice(0, 60)
      : null;

  return {
    ok: true,
    extension: ext,
    label: explicit ?? labelFromFileName(input.fileName),
  };
}

// ============================================================================
// SELF-TEST
// ============================================================================

export function __runAnnouncerSoundsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL: ${label}`);
    }
  };
  const eq = (label: string, got: unknown, want: unknown): void => {
    const same = JSON.stringify(got) === JSON.stringify(want);
    if (same) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL: ${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
    }
  };

  // -- extensionOf ---------------------------------------------------------
  eq("ext: simple wav", extensionOf("chime.wav"), "wav");
  eq("ext: uppercase is normalised", extensionOf("CHIME.WAV"), "wav");
  eq("ext: multiple dots take the last", extensionOf("my.chime.final.mp3"), "mp3");
  eq("ext: no extension", extensionOf("chime"), null);
  eq("ext: trailing dot is not an extension", extensionOf("chime."), null);
  eq("ext: hidden file is not an extension", extensionOf(".wav"), null);
  eq("ext: empty string", extensionOf(""), null);
  eq("ext: whitespace only", extensionOf("   "), null);
  eq("ext: null", extensionOf(null), null);
  eq("ext: number", extensionOf(42), null);

  // -- isAllowedExtension --------------------------------------------------
  check("allowed: wav", isAllowedExtension("wav"));
  check("allowed: mp3", isAllowedExtension("mp3"));
  check("allowed: uppercase WAV", isAllowedExtension("WAV"));
  check("rejected: ogg (Pi cannot play it out of the box)", !isAllowedExtension("ogg"));
  check("rejected: flac", !isAllowedExtension("flac"));
  check("rejected: m4a", !isAllowedExtension("m4a"));
  check("rejected: exe", !isAllowedExtension("exe"));
  check("rejected: null", !isAllowedExtension(null));

  // -- labelFromFileName ---------------------------------------------------
  eq("label: basic", labelFromFileName("chime.wav"), "chime");
  eq("label: underscores become spaces", labelFromFileName("new_order_bell.wav"), "new order bell");
  eq("label: dashes become spaces", labelFromFileName("air-horn.mp3"), "air horn");
  eq("label: parentheses are cleaned", labelFromFileName("AIRHORN_final(2).WAV"), "AIRHORN final 2");
  eq("label: directory part is dropped", labelFromFileName("C:\\sounds\\bell.wav"), "bell");
  eq("label: unix path is dropped", labelFromFileName("/home/mike/bell.wav"), "bell");
  eq("label: empty falls back", labelFromFileName(""), "Custom sound");
  eq("label: null falls back", labelFromFileName(null), "Custom sound");
  eq("label: symbols only falls back", labelFromFileName("!!!.wav"), "Custom sound");
  check("label: very long name is trimmed to 60", labelFromFileName(`${"a".repeat(200)}.wav`).length <= 60);
  eq("label: custom fallback honoured", labelFromFileName(null, "Untitled"), "Untitled");

  // -- buildStoragePath ----------------------------------------------------
  eq("path: built from id", buildStoragePath("abc-123", "wav"), "custom/abc-123.wav");
  eq("path: mp3", buildStoragePath("abc-123", "mp3"), "custom/abc-123.mp3");
  eq("path: traversal in the id is stripped", buildStoragePath("../../etc/passwd", "wav"), "custom/etcpasswd.wav");
  eq("path: slashes in the id are stripped", buildStoragePath("a/b/c", "wav"), "custom/abc.wav");

  // -- isValidStoragePath --------------------------------------------------
  check("valid path: generated wav", isValidStoragePath("custom/abc-123.wav"));
  check("valid path: generated mp3", isValidStoragePath("custom/abc-123.mp3"));
  check("invalid: traversal", !isValidStoragePath("custom/../../secret.wav"));
  check("invalid: absolute", !isValidStoragePath("/etc/passwd"));
  check("invalid: nested folder", !isValidStoragePath("custom/sub/a.wav"));
  check("invalid: wrong prefix", !isValidStoragePath("other/a.wav"));
  check("invalid: no extension", !isValidStoragePath("custom/abc"));
  check("invalid: disallowed extension", !isValidStoragePath("custom/abc.exe"));
  check("invalid: empty", !isValidStoragePath(""));
  check("invalid: null", !isValidStoragePath(null));
  check("invalid: absurdly long", !isValidStoragePath(`custom/${"a".repeat(300)}.wav`));
  check("invalid: built-in id is not a storage path", !isValidStoragePath("chime"));

  // -- contentTypeFor ------------------------------------------------------
  eq("mime: wav", contentTypeFor("custom/a.wav"), "audio/wav");
  eq("mime: mp3", contentTypeFor("custom/a.mp3"), "audio/mpeg");
  eq("mime: uppercase mp3", contentTypeFor("custom/A.MP3"), "audio/mpeg");

  // -- formatBytes ---------------------------------------------------------
  eq("bytes: zero", formatBytes(0), "—");
  eq("bytes: negative", formatBytes(-5), "—");
  eq("bytes: small", formatBytes(512), "512 B");
  eq("bytes: kb", formatBytes(2048), "2 KB");
  eq("bytes: mb", formatBytes(1024 * 1024 * 2), "2.0 MB");
  eq("bytes: junk", formatBytes("lots"), "—");
  eq("bytes: NaN", formatBytes(NaN), "—");

  // -- validateUpload ------------------------------------------------------
  const good = validateUpload({ fileName: "door_chime.wav", bytes: 50_000 });
  check("upload: a normal wav is accepted", good.ok);
  check("upload: extension captured", good.ok && good.extension === "wav");
  eq("upload: label derived", good.ok ? good.label : null, "door chime");

  const goodMp3 = validateUpload({ fileName: "bell.mp3", bytes: 100_000 });
  check("upload: a normal mp3 is accepted", goodMp3.ok);

  const labelled = validateUpload({ fileName: "x.wav", bytes: 50_000, label: "Front Door" });
  eq("upload: explicit label wins", labelled.ok ? labelled.label : null, "Front Door");

  const blankLabel = validateUpload({ fileName: "bell.wav", bytes: 50_000, label: "   " });
  eq("upload: blank label falls back to the filename", blankLabel.ok ? blankLabel.label : null, "bell");

  const noExt = validateUpload({ fileName: "chime", bytes: 50_000 });
  check("upload: no extension is rejected", !noExt.ok);
  check("upload: that rejection says what to do", !noExt.ok && noExt.error.includes(".wav"));

  const wrongType = validateUpload({ fileName: "song.flac", bytes: 50_000 });
  check("upload: flac is rejected", !wrongType.ok);
  check("upload: rejection names the file type", !wrongType.ok && wrongType.error.includes("flac"));
  check("upload: rejection offers the fix", !wrongType.ok && wrongType.error.includes(".mp3"));

  const tooBig = validateUpload({ fileName: "song.mp3", bytes: 9 * 1024 * 1024 });
  check("upload: oversized is rejected", !tooBig.ok);
  check("upload: rejection states the actual size", !tooBig.ok && tooBig.error.includes("9.0 MB"));
  check("upload: rejection states the limit", !tooBig.ok && tooBig.error.includes("5 MB"));

  const tooSmall = validateUpload({ fileName: "empty.wav", bytes: 10 });
  check("upload: a near-empty file is rejected", !tooSmall.ok);

  const zero = validateUpload({ fileName: "empty.wav", bytes: 0 });
  check("upload: a zero-byte file is rejected", !zero.ok);

  const unreadable = validateUpload({ fileName: "x.wav", bytes: "big" });
  check("upload: unreadable size is rejected, not defaulted", !unreadable.ok);

  const nullName = validateUpload({ fileName: null, bytes: 50_000 });
  check("upload: null filename is rejected", !nullName.ok);

  // Boundaries, exactly.
  check(
    "upload: exactly at the size limit is allowed",
    validateUpload({ fileName: "a.wav", bytes: MAX_SOUND_BYTES }).ok,
  );
  check(
    "upload: one byte over the limit is rejected",
    !validateUpload({ fileName: "a.wav", bytes: MAX_SOUND_BYTES + 1 }).ok,
  );
  check(
    "upload: exactly at the minimum is allowed",
    validateUpload({ fileName: "a.wav", bytes: MIN_SOUND_BYTES }).ok,
  );
  check(
    "upload: one byte under the minimum is rejected",
    !validateUpload({ fileName: "a.wav", bytes: MIN_SOUND_BYTES - 1 }).ok,
  );

  // Every rejection must be actionable — no bare "invalid" messages anywhere.
  const rejections = [noExt, wrongType, tooBig, tooSmall, zero, unreadable, nullName];
  check(
    "upload: every rejection is a full sentence with guidance",
    rejections.every((r) => !r.ok && r.error.length > 40 && r.error.trim().endsWith(".")),
  );

  return { passed, failed };
}

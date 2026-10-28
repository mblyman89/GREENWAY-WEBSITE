"use client";

// R44 — browser half of the direct-to-Storage upload (bypasses Vercel's
// 4.5 MB Function body limit). Server half: src/app/admin/media/direct-upload-actions.ts
//
//  • ≤ 6 MB  → one signed PUT, the same request storage-js `uploadToSignedUrl`
//              makes (multipart body with `cacheControl` + the file), sent with
//              XMLHttpRequest so we get real upload progress.
//  • > 6 MB  → Supabase TUS resumable upload on the signed endpoint
//              (`/storage/v1/upload/resumable/sign`, header `x-signature`),
//              6 MB chunks exactly as Supabase documents; automatic retries
//              resume from the last chunk after a dropped connection.
//  • video   → captures one frame as a JPEG poster (shown instantly on the
//              site while the video loads, and as the still image for
//              shoppers who prefer reduced motion).

import * as tus from "tus-js-client";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/env";
import { RESUMABLE_CHUNK_BYTES, friendlyStorageError } from "@/lib/media/upload-policy-core";

const BUCKET = "media";
const CACHE_SECONDS = "31536000"; // keys are never reused, so a year is safe

export type Progress = (sent: number, total: number) => void;

/** Single signed PUT with progress. Mirrors storage-js uploadToSignedUrl. */
// Fix Phase 1.7a (G-43 req 7): `bucket` lets the private destruction-evidence
// uploader reuse this; every existing caller keeps the public media bucket.
export function putSigned(key: string, token: string, file: Blob, contentType: string, onProgress?: Progress, bucket: string = BUCKET): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encoded}?token=${encodeURIComponent(token)}`;
    const body = new FormData();
    body.append("cacheControl", CACHE_SECONDS);
    // A typed Blob so Storage records the right content type.
    body.append("", file instanceof File ? file : new File([file], key.split("/").pop() || "file", { type: contentType }));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", supabaseAnonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`${xhr.status} ${xhr.responseText || xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(body);
  });
}

/** Resumable TUS upload to a signed endpoint. */
export function tusSigned(opts: {
  endpoint: string;
  anonKey: string;
  key: string;
  token: string;
  file: File;
  contentType: string;
  onProgress?: Progress;
  signal?: AbortSignal;
  /** Fix Phase 1.7a: defaults to the public media bucket. */
  bucket?: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: opts.endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: { "x-signature": opts.token, apikey: opts.anonKey, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      // Each upload gets a fresh key + token, so cross-session resume would aim
      // at an old key; in-session retries still resume from the last chunk.
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: opts.bucket ?? BUCKET,
        objectName: opts.key,
        contentType: opts.contentType,
        cacheControl: CACHE_SECONDS,
      },
      chunkSize: RESUMABLE_CHUNK_BYTES, // Supabase: must be exactly 6 MB
      onProgress: (sent, total) => opts.onProgress?.(sent, total),
      onSuccess: () => resolve(),
      onError: (err) => {
        const res = (err as tus.DetailedError).originalResponse;
        const status = res?.getStatus?.();
        const text = res?.getBody?.() ?? "";
        reject(new Error(`${status ?? ""} ${text || err.message}`.trim()));
      },
    });
    opts.signal?.addEventListener("abort", () => {
      void upload.abort(true);
      reject(new Error("cancelled"));
    });
    upload.start();
  });
}

/** Pixel size of an image file (null when the browser can't decode it). */
export function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (file.type === "image/svg+xml" || !file.type.startsWith("image/")) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export type VideoProbe = { width: number; height: number; duration: number; poster: Blob | null };

/**
 * Read a video's size/duration and grab a frame (~0.5 s in, or the first
 * frame for very short clips) as a JPEG poster. Never throws; resolves null
 * when the browser can't decode the video (e.g. an unsupported codec — which
 * also means shoppers' browsers likely can't play it).
 */
export function probeVideo(file: File, timeoutMs = 15000): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (r: VideoProbe | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = () => {
      const t = Number.isFinite(v.duration) && v.duration > 1 ? 0.5 : 0;
      try {
        v.currentTime = t;
      } catch {
        /* seeked may still fire */
      }
    };
    v.onseeked = () => {
      const width = v.videoWidth;
      const height = v.videoHeight;
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      if (!width || !height) {
        clearTimeout(timer);
        return finish(null);
      }
      try {
        // Poster capped at 1920 px wide — it only needs to cover the banner.
        const scale = Math.min(1, 1920 / width);
        const c = document.createElement("canvas");
        c.width = Math.round(width * scale);
        c.height = Math.round(height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(
          (blob) => {
            clearTimeout(timer);
            finish({ width, height, duration, poster: blob });
          },
          "image/jpeg",
          0.82,
        );
      } catch {
        clearTimeout(timer);
        finish({ width, height, duration, poster: null });
      }
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    v.src = url;
  });
}

export { friendlyStorageError };

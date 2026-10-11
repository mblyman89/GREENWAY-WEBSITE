/**
 * R39 S7 — PURE plan for shrinking a bank-proof photo in the vendor's
 * browser before upload.
 *
 * Why: Vercel Functions refuse request bodies over 4.5 MB (documented limit,
 * "413 FUNCTION_PAYLOAD_TOO_LARGE"), and the server caps the proof at 4 MB
 * (VENDOR_PROOF_MAX_BYTES). A phone photo is often 3-8 MB. A voided check is
 * fully readable at 2000 px on the long side, which as JPEG is typically
 * 300 KB to 1.5 MB.
 *
 * Rules:
 *  - PDFs are never touched (re-rendering a PDF would destroy it).
 *  - Images already small enough (<= target bytes AND long side <= max) are
 *    kept byte-for-byte, so a clean scan is not recompressed.
 *  - Otherwise scale so the long side is at most PROOF_MAX_EDGE_PX (never
 *    upscale) and try JPEG qualities from high to low until one fits.
 *  - width/height 0 means "not decoded yet": the caller decodes only when
 *    the first answer is not "keep".
 */
export const PROOF_MAX_EDGE_PX = 2000;
/** Leaves room under the 4 MB server cap for the rest of the form. */
export const PROOF_UPLOAD_TARGET_BYTES = Math.floor(3.5 * 1024 * 1024);
export const PROOF_JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.5] as const;

export type ShrinkPlan = { kind: "keep" } | { kind: "shrink"; width: number; height: number; qualities: readonly number[] };

const IMAGE = /^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/i;

export function planShrink(i: { mime: string; bytes: number; width: number; height: number }): ShrinkPlan {
  const mime = String(i.mime ?? "").toLowerCase();
  if (!IMAGE.test(mime)) return { kind: "keep" };
  const w = Math.max(0, Math.floor(i.width));
  const h = Math.max(0, Math.floor(i.height));
  const long = Math.max(w, h);
  const smallBytes = i.bytes <= PROOF_UPLOAD_TARGET_BYTES;
  // Supported upload formats on the server are JPEG/PNG/HEIC/PDF; webp/gif/bmp
  // must be converted to JPEG even when small.
  const serverAccepts = /^image\/(jpeg|png|heic|heif)$/.test(mime);
  if (w === 0 || h === 0) {
    return smallBytes && serverAccepts ? { kind: "keep" } : { kind: "shrink", width: 0, height: 0, qualities: PROOF_JPEG_QUALITIES };
  }
  if (smallBytes && serverAccepts && long <= PROOF_MAX_EDGE_PX) return { kind: "keep" };
  const scale = long > PROOF_MAX_EDGE_PX ? PROOF_MAX_EDGE_PX / long : 1;
  return {
    kind: "shrink",
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    qualities: PROOF_JPEG_QUALITIES,
  };
}

export function __runVendorProofShrinkTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("vendor-proof-shrink FAIL:", label);
    }
  };
  const MB = 1024 * 1024;
  ok(planShrink({ mime: "application/pdf", bytes: 9 * MB, width: 0, height: 0 }).kind === "keep", "pdf never touched, even big");
  ok(planShrink({ mime: "image/jpeg", bytes: 1 * MB, width: 0, height: 0 }).kind === "keep", "small jpeg kept before decoding");
  ok(planShrink({ mime: "image/jpeg", bytes: 6 * MB, width: 0, height: 0 }).kind === "shrink", "big jpeg needs decoding");
  ok(planShrink({ mime: "image/webp", bytes: 100_000, width: 0, height: 0 }).kind === "shrink", "webp converted even when small");
  ok(planShrink({ mime: "image/jpeg", bytes: 1 * MB, width: 1600, height: 1200 }).kind === "keep", "small, modest size: kept byte-for-byte");
  const big = planShrink({ mime: "image/jpeg", bytes: 6 * MB, width: 4032, height: 3024 });
  ok(big.kind === "shrink" && big.width === 2000 && big.height === 1500, "12MP landscape -> 2000x1500");
  const tall = planShrink({ mime: "image/heic", bytes: 2 * MB, width: 3024, height: 4032 });
  ok(tall.kind === "shrink" && tall.height === 2000 && tall.width === 1500, "portrait: long side is height");
  const smallPixBigBytes = planShrink({ mime: "image/png", bytes: 5 * MB, width: 1800, height: 1000 });
  ok(smallPixBigBytes.kind === "shrink" && smallPixBigBytes.width === 1800 && smallPixBigBytes.height === 1000, "never upscale; recompress only");
  ok(planShrink({ mime: "image/jpeg", bytes: PROOF_UPLOAD_TARGET_BYTES, width: 2000, height: 10 }).kind === "keep", "exact target and edge -> keep (boundary)");
  ok(planShrink({ mime: "image/jpeg", bytes: PROOF_UPLOAD_TARGET_BYTES + 1, width: 2000, height: 10 }).kind === "shrink", "one byte over -> shrink (boundary)");
  ok(planShrink({ mime: "image/jpeg", bytes: 100, width: 2001, height: 10 }).kind === "shrink", "one pixel over -> shrink (boundary)");
  ok(planShrink({ mime: "text/html", bytes: 10, width: 0, height: 0 }).kind === "keep", "non-image passed through to the server's refusal");
  ok(PROOF_UPLOAD_TARGET_BYTES < 4 * MB && PROOF_UPLOAD_TARGET_BYTES > 3 * MB, "target below the 4 MB server cap");
  ok(PROOF_JPEG_QUALITIES.every((q, i, a) => q > 0 && q <= 1 && (i === 0 || q < a[i - 1])), "qualities high -> low, in (0,1]");
  return { passed, failed };
}

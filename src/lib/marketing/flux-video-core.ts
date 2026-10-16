/**
 * flux-video-core — PURE request builders for FLUX 3 video (R62).
 *
 * Every field below is taken from BFL's live OpenAPI (api.bfl.ai/openapi.json)
 * — schemas are `additionalProperties: false`, so nothing extra is ever sent:
 *
 *   POST /v1/flux-3-video  (discriminator `mode`)
 *     t2v   prompt, aspect_ratio, duration 5–20|"auto", resolution hd|fhd|qhd|uhd
 *           (default hd), generate_audio (default true), safety_tolerance 0–7
 *           (default 2), draft (default false)
 *     i2v   + keyframes: 1–10 images (1 = start, 2 = start+end, 3+ evenly
 *           spaced and need a set duration) OR [seconds, image] pairs
 *     v2v   + start_video (mp4 URL/base64); duration 5–15|"auto"
 *     draft_enhance  draft_cache, resolution (default fhd), safety_tolerance
 *   POST /v1/flux-tools/video-edit-v1     video, prompt (1–4096), safety_tolerance
 *   POST /v1/flux-tools/video-upscale-v1  input_video, prompt (optional),
 *           creativity 0|1 (default 1), upscale_factor 1.5–3 (default 2),
 *           safety_tolerance. Source ≤ 2560×1440, first 20 s.
 *
 * Output is 24 fps mp4; result.sample links last about 2 hours (we copy the
 * file into the media library as soon as it's ready).
 */
import { FLUX_SAFETY_DEFAULT, FLUX_SAFETY_MAX } from "./flux-core";

export type FluxVideoMode = "t2v" | "i2v" | "v2v" | "edit" | "upscale";

export const FLUX_VIDEO_MODES: { id: FluxVideoMode; label: string; note: string }[] = [
  { id: "t2v", label: "Text → video", note: "Describe the shot and FLUX 3 films it." },
  { id: "i2v", label: "Image → video", note: "Your images become frames: start, start + end, or a keyframe sequence." },
  { id: "v2v", label: "Continue a video", note: "The new clip carries on from your video's final frames." },
  { id: "edit", label: "Edit a video", note: "Transform an existing clip with an instruction. Length, size and audio follow the source." },
  { id: "upscale", label: "Upscale a video", note: "1.5×–3× super-resolution of a clip (≤ 2560×1440, first 20 s)." },
];

export const FLUX_VIDEO_ASPECTS = ["auto", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "2:1", "9:21"] as const;
export type FluxVideoAspect = (typeof FLUX_VIDEO_ASPECTS)[number];

export const FLUX_VIDEO_RESOLUTIONS: { value: "hd" | "fhd" | "qhd" | "uhd"; label: string; note: string }[] = [
  { value: "hd", label: "HD", note: "Native render (720p class)" },
  { value: "fhd", label: "Full HD", note: "Finished by the video upsampler (1080p class)" },
  { value: "qhd", label: "QHD", note: "Upsampled (1440p class)" },
  { value: "uhd", label: "4K", note: "Upsampled (2160p class)" },
];
export type FluxVideoResolution = (typeof FLUX_VIDEO_RESOLUTIONS)[number]["value"];

export const FLUX_VIDEO_MIN_SECONDS = 5;
export const FLUX_VIDEO_MAX_SECONDS = 20;
export const FLUX_V2V_MAX_SECONDS = 15;
export const FLUX_MAX_KEYFRAMES = 10;
export const FLUX_EDIT_PROMPT_MAX = 4096;

export type FluxKeyframe = { url: string; at?: number | null };

export type FluxVideoSettings = {
  mode: FluxVideoMode;
  prompt: string;
  aspect: string;
  /** "auto" or whole seconds */
  duration: "auto" | number;
  resolution: string;
  audio: boolean;
  draft: boolean;
  safetyTolerance: number;
  keyframes?: FluxKeyframe[];
  /** i2v: send [seconds, image] pairs using each keyframe's `at` */
  timedKeyframes?: boolean;
  /** v2v start_video / edit video / upscale input_video */
  sourceVideo?: string;
  creativity?: 0 | 1;
  upscaleFactor?: number;
};

export type FluxVideoRequest =
  | { ok: true; endpoint: string; body: Record<string, unknown>; warnings: string[] }
  | { ok: false; error: string };

export const FLUX_VIDEO_ENDPOINT = "flux-3-video";
export const FLUX_VIDEO_EDIT_ENDPOINT = "flux-tools/video-edit-v1";
export const FLUX_VIDEO_UPSCALE_ENDPOINT = "flux-tools/video-upscale-v1";

function clampSafety(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return FLUX_SAFETY_DEFAULT;
  return Math.max(0, Math.min(FLUX_SAFETY_MAX, v));
}

function isHttps(u: unknown): u is string {
  return typeof u === "string" && /^https:\/\/\S+$/i.test(u.trim());
}

/** Build the exact body for one video task. Pure; never throws. */
export function buildFluxVideoRequest(s: FluxVideoSettings): FluxVideoRequest {
  const warnings: string[] = [];
  const prompt = typeof s.prompt === "string" ? s.prompt : "";
  const safety_tolerance = clampSafety(s.safetyTolerance);

  if (s.mode === "edit") {
    if (!isHttps(s.sourceVideo)) return { ok: false, error: "Pick the video to edit." };
    const p = prompt.trim();
    if (!p) return { ok: false, error: "Write the edit instruction." };
    if (p.length > FLUX_EDIT_PROMPT_MAX) return { ok: false, error: `Edit instructions are limited to ${FLUX_EDIT_PROMPT_MAX} characters.` };
    return { ok: true, endpoint: FLUX_VIDEO_EDIT_ENDPOINT, body: { video: s.sourceVideo.trim(), prompt: p, safety_tolerance }, warnings };
  }

  if (s.mode === "upscale") {
    if (!isHttps(s.sourceVideo)) return { ok: false, error: "Pick the video to upscale." };
    const f = Number(s.upscaleFactor ?? 2);
    const upscale_factor = Number.isFinite(f) ? Math.max(1.5, Math.min(3, Math.round(f * 4) / 4)) : 2;
    const body: Record<string, unknown> = {
      input_video: s.sourceVideo.trim(),
      creativity: s.creativity === 0 ? 0 : 1,
      upscale_factor,
      safety_tolerance,
    };
    if (prompt.trim()) body.prompt = prompt.trim();
    return { ok: true, endpoint: FLUX_VIDEO_UPSCALE_ENDPOINT, body, warnings };
  }

  if (!prompt.trim()) return { ok: false, error: "Write a prompt first." };
  const body: Record<string, unknown> = { mode: s.mode, prompt };

  const aspect = (FLUX_VIDEO_ASPECTS as readonly string[]).includes(s.aspect) ? s.aspect : "auto";
  if (aspect !== "auto") body.aspect_ratio = aspect;

  const maxSec = s.mode === "v2v" ? FLUX_V2V_MAX_SECONDS : FLUX_VIDEO_MAX_SECONDS;
  let duration: "auto" | number = "auto";
  if (s.duration !== "auto") {
    const d = Math.round(Number(s.duration));
    if (Number.isFinite(d)) {
      duration = Math.max(FLUX_VIDEO_MIN_SECONDS, Math.min(maxSec, d));
      if (duration !== d) warnings.push(`Duration adjusted to ${duration}s (this mode allows ${FLUX_VIDEO_MIN_SECONDS}–${maxSec}s).`);
    }
  }
  if (duration !== "auto") body.duration = duration;

  const res = FLUX_VIDEO_RESOLUTIONS.some((r) => r.value === s.resolution) ? s.resolution : "hd";
  if (s.draft) {
    body.draft = true;
    if (res !== "hd") warnings.push("Drafts render at HD; pick the final resolution when you enhance the draft.");
  } else if (res !== "hd") body.resolution = res;
  if (s.audio === false) body.generate_audio = false;
  if (safety_tolerance !== FLUX_SAFETY_DEFAULT) body.safety_tolerance = safety_tolerance;

  if (s.mode === "i2v") {
    const frames = (s.keyframes ?? []).filter((k) => isHttps(k.url));
    if (frames.length === 0) return { ok: false, error: "Add at least one image (it becomes the first frame)." };
    if (frames.length > FLUX_MAX_KEYFRAMES) return { ok: false, error: `Up to ${FLUX_MAX_KEYFRAMES} keyframe images.` };
    if (s.timedKeyframes) {
      const pairs: [number, string][] = [];
      let last = -1;
      for (const k of frames) {
        const at = Number(k.at);
        if (!Number.isFinite(at) || at < 0) return { ok: false, error: "Give every keyframe a time in seconds (0 or more)." };
        if (at <= last) return { ok: false, error: "Keyframe times must increase from first to last." };
        if (at > maxSec) return { ok: false, error: `Keyframe times can't pass ${maxSec}s.` };
        if (duration !== "auto" && at > duration) return { ok: false, error: `A keyframe at ${at}s is past the ${duration}s duration.` };
        last = at;
        pairs.push([at, k.url.trim()]);
      }
      body.keyframes = pairs;
    } else {
      if (frames.length >= 3 && duration === "auto") return { ok: false, error: "With 3 or more keyframes, set a duration (FLUX spaces them evenly across it)." };
      body.keyframes = frames.length === 1 ? frames[0].url.trim() : frames.map((k) => k.url.trim());
    }
  }

  if (s.mode === "v2v") {
    if (!isHttps(s.sourceVideo)) return { ok: false, error: "Pick the video to continue." };
    body.start_video = s.sourceVideo.trim();
  }

  return { ok: true, endpoint: FLUX_VIDEO_ENDPOINT, body, warnings };
}

/** Full-quality render of a previous draft (only resolution is selectable). */
export function buildDraftEnhanceRequest(draftCache: string, resolution: string, safetyTolerance: number): FluxVideoRequest {
  if (!isHttps(draftCache)) return { ok: false, error: "This draft has no draft-cache link (or it expired). Generate the draft again." };
  const res = FLUX_VIDEO_RESOLUTIONS.some((r) => r.value === resolution) ? resolution : "fhd";
  const body: Record<string, unknown> = { mode: "draft_enhance", draft_cache: draftCache.trim(), resolution: res };
  const st = clampSafety(safetyTolerance);
  if (st !== FLUX_SAFETY_DEFAULT) body.safety_tolerance = st;
  return { ok: true, endpoint: FLUX_VIDEO_ENDPOINT, body, warnings: [] };
}

/** Endpoints the video submit action may call (allow-list). */
export const FLUX_VIDEO_ENDPOINTS = [FLUX_VIDEO_ENDPOINT, FLUX_VIDEO_EDIT_ENDPOINT, FLUX_VIDEO_UPSCALE_ENDPOINT] as const;

export function __runFluxVideoTests(): string {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL flux-video-core: " + m);
    n++;
  };
  const base: FluxVideoSettings = { mode: "t2v", prompt: "A drone shot over a coastline", aspect: "16:9", duration: "auto", resolution: "hd", audio: true, draft: false, safetyTolerance: 2 };

  const t = buildFluxVideoRequest(base);
  ok(t.ok && t.endpoint === "flux-3-video", "t2v endpoint");
  ok(t.ok && JSON.stringify(t.body) === JSON.stringify({ mode: "t2v", prompt: "A drone shot over a coastline", aspect_ratio: "16:9" }), "t2v minimal body (defaults omitted)");
  const t2 = buildFluxVideoRequest({ ...base, aspect: "auto", duration: 8, resolution: "uhd", audio: false, safetyTolerance: 4 });
  ok(t2.ok && t2.body.duration === 8 && t2.body.resolution === "uhd" && t2.body.generate_audio === false && t2.body.safety_tolerance === 4 && !("aspect_ratio" in t2.body), "t2v full body");
  const t3 = buildFluxVideoRequest({ ...base, duration: 40 });
  ok(t3.ok && t3.body.duration === 20 && t3.warnings.length === 1, "duration clamp 20");
  ok(!buildFluxVideoRequest({ ...base, prompt: "  " }).ok, "empty prompt");
  const tSafe = buildFluxVideoRequest({ ...base, safetyTolerance: 9 });
  ok(tSafe.ok && tSafe.body.safety_tolerance === 5, "safety clamped to 5");
  const bad = buildFluxVideoRequest({ ...base, aspect: "5:4" });
  ok(bad.ok && !("aspect_ratio" in bad.body), "unsupported aspect -> auto");

  const d = buildFluxVideoRequest({ ...base, draft: true, resolution: "fhd" });
  ok(d.ok && d.body.draft === true && !("resolution" in d.body) && d.warnings.length === 1, "draft drops resolution");

  const i1 = buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: [{ url: "https://x/a.jpg" }] });
  ok(i1.ok && i1.body.keyframes === "https://x/a.jpg" && i1.body.mode === "i2v", "i2v single string");
  const i2 = buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: [{ url: "https://x/a.jpg" }, { url: "https://x/b.jpg" }] });
  ok(i2.ok && Array.isArray(i2.body.keyframes) && (i2.body.keyframes as string[]).length === 2, "i2v start+end");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: [{ url: "https://x/a" }, { url: "https://x/b" }, { url: "https://x/c" }] }).ok, "3 frames need duration");
  ok(buildFluxVideoRequest({ ...base, mode: "i2v", duration: 9, keyframes: [{ url: "https://x/a" }, { url: "https://x/b" }, { url: "https://x/c" }] }).ok, "3 frames with duration");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: [] }).ok, "i2v needs image");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: [{ url: "http://x/a.jpg" }] }).ok, "i2v https only");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", keyframes: Array.from({ length: 11 }, (_, i) => ({ url: `https://x/${i}` })) }).ok, "max 10 keyframes");
  const it = buildFluxVideoRequest({ ...base, mode: "i2v", timedKeyframes: true, keyframes: [{ url: "https://x/a", at: 0 }, { url: "https://x/b", at: 3.5 }] });
  ok(it.ok && JSON.stringify(it.body.keyframes) === JSON.stringify([[0, "https://x/a"], [3.5, "https://x/b"]]), "timed pairs");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", timedKeyframes: true, keyframes: [{ url: "https://x/a", at: 3 }, { url: "https://x/b", at: 1 }] }).ok, "timed must increase");
  ok(!buildFluxVideoRequest({ ...base, mode: "i2v", duration: 5, timedKeyframes: true, keyframes: [{ url: "https://x/a", at: 0 }, { url: "https://x/b", at: 7 }] }).ok, "timed past duration");

  const v = buildFluxVideoRequest({ ...base, mode: "v2v", duration: 20, sourceVideo: "https://x/v.mp4" });
  ok(v.ok && v.body.start_video === "https://x/v.mp4" && v.body.duration === 15, "v2v clamps to 15");
  ok(!buildFluxVideoRequest({ ...base, mode: "v2v" }).ok, "v2v needs video");

  const e = buildFluxVideoRequest({ ...base, mode: "edit", sourceVideo: "https://x/v.mp4", prompt: " make it snow " });
  ok(e.ok && e.endpoint === "flux-tools/video-edit-v1" && JSON.stringify(e.body) === JSON.stringify({ video: "https://x/v.mp4", prompt: "make it snow", safety_tolerance: 2 }), "edit body");
  ok(!buildFluxVideoRequest({ ...base, mode: "edit", sourceVideo: "https://x/v.mp4", prompt: "x".repeat(4097) }).ok, "edit prompt cap");

  const u = buildFluxVideoRequest({ ...base, mode: "upscale", sourceVideo: "https://x/v.mp4", prompt: "", creativity: 0, upscaleFactor: 5 });
  ok(u.ok && u.endpoint === "flux-tools/video-upscale-v1" && u.body.upscale_factor === 3 && u.body.creativity === 0 && !("prompt" in u.body), "upscale body");
  ok(!buildFluxVideoRequest({ ...base, mode: "upscale" }).ok, "upscale needs video");

  const de = buildDraftEnhanceRequest("https://d/c.bin", "qhd", 2);
  ok(de.ok && JSON.stringify(de.body) === JSON.stringify({ mode: "draft_enhance", draft_cache: "https://d/c.bin", resolution: "qhd" }), "draft enhance");
  ok(!buildDraftEnhanceRequest("", "fhd", 2).ok, "draft enhance needs cache");
  ok(FLUX_VIDEO_ENDPOINTS.length === 3, "endpoint allow-list");
  return `OK flux-video-core: ${n} assertions passed`;
}

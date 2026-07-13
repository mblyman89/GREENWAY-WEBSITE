/**
 * src/lib/marketing/flux-core.ts
 *
 * PURE, dependency-free logic for the FLUX 2 image-generation pipeline.
 * No server-only imports so it is unit-testable with tsx.
 *
 * The owner is pivoting from Midjourney (paste-a-prompt) to Black Forest Labs
 * FLUX 2 [max] as a fully integrated API pipeline on the SAME builder page. We
 * reuse the exact same CreativeBrief / assemblePrompt from midjourney-core so
 * the transition is seamless: the marketer builds one brief; "Copy" gives the
 * Midjourney string, "Generate with FLUX" runs the API.
 *
 * KEY DIFFERENCE vs Midjourney:
 *   Midjourney encodes composition into "--ar / --v / --stylize" flags appended
 *   to the prompt text. FLUX 2 takes a NATURAL-LANGUAGE prompt plus explicit
 *   width/height (and other JSON fields). So for FLUX we:
 *     - use the CONCEPT text (subject-first comma groups) as the prompt,
 *     - translate the aspect ratio into concrete pixel dimensions (or take an
 *       exact placement size, e.g. 1080×1080 for an Instagram post),
 *     - drop the "--" flags (they are Midjourney-only syntax),
 *     - keep "exclude" as an explicit "Avoid: ..." clause in the prompt, since
 *       FLUX has no separate negative-prompt field.
 *
 * VERIFIED FLUX API contracts (docs.bfl.ai, per-endpoint):
 *   POST {base}/v1/{endpoint}   header x-key: <key>
 *     -> 200 { id, polling_url, cost, input_mp, output_mp }   (async submit)
 *   GET  polling_url            header x-key: <key>
 *     -> { status, result }     (poll; "Ready" => result.sample is a signed
 *                                image URL, ~10 min TTL)
 *   Statuses: "Pending" | "Ready" | "Error" | "Content Moderated" |
 *             "Request Moderated" | "Task not found".
 *   Rate limit: 429 (too many active tasks). Credits: 402.
 *
 *   flux-2-max / flux-2-pro:
 *     - width/height integers >= 64 (multiples of 16 preferred, <= ~4 MP)
 *     - `disable_pup` (default false): prompt upsampling is ON BY DEFAULT;
 *       set true to use the prompt exactly as written
 *     - safety_tolerance 0..5 (default 2)
 *     - output_format: jpeg (default) | png | webp
 *     - input_image .. input_image_8 (up to 8 references)
 *   flux-2-flex:
 *     - same, but `prompt_upsampling` (boolean, default TRUE) instead of
 *       disable_pup; plus guidance/steps knobs (not exposed here)
 *   flux-kontext-max (LEGACY per docs — kept for compatibility):
 *     - `aspect_ratio` string (21:9 .. 9:21) instead of width/height
 *     - `prompt_upsampling` (default false), safety_tolerance 0..6
 *     - output_format defaults png; only 4 input images
 *
 * This module does NO network I/O. flux-client.ts does that using these helpers.
 */

import type { AspectRatio, CreativeBrief } from "./midjourney-core";
import { assemblePrompt } from "./midjourney-core";

// ---------------------------------------------------------------------------
// Endpoints & defaults
// ---------------------------------------------------------------------------

/** Default API base (global). Owner may pin api.us.bfl.ai / api.eu.bfl.ai. */
export const FLUX_DEFAULT_BASE_URL = "https://api.bfl.ai";

/** Default model endpoint (owner's choice: highest fidelity). */
export const FLUX_DEFAULT_ENDPOINT = "flux-2-max";

/**
 * Model endpoints the owner can choose from (all under {base}/v1/<endpoint>).
 */
export const FLUX_ENDPOINTS: { value: string; label: string; note: string }[] = [
  { value: "flux-2-max", label: "FLUX 2 [max]", note: "Highest fidelity — best for hero/product marketing." },
  { value: "flux-2-pro", label: "FLUX 2 [pro]", note: "Strong quality, faster/cheaper than max." },
  { value: "flux-2-flex", label: "FLUX 2 [flex]", note: "Specialized for typography and exact text rendering." },
  { value: "flux-kontext-max", label: "FLUX Kontext [max] (legacy)", note: "Older editing model — prefer FLUX 2 for new work." },
];

/** Endpoint families with different request-body contracts (verified docs). */
export type FluxEndpointFamily = "flux2-pup" | "flux2-upsampling" | "kontext";

/** Classify an endpoint into its request-contract family. */
export function endpointFamily(endpoint: string | null | undefined): FluxEndpointFamily {
  const ep = (endpoint ?? "").trim().toLowerCase();
  if (ep.includes("kontext")) return "kontext";
  if (ep.includes("flex")) return "flux2-upsampling";
  return "flux2-pup"; // flux-2-max / flux-2-pro and default
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

/** ~4 MP output ceiling on FLUX.2 endpoints (verified prompting guide). */
export const FLUX_MAX_PIXELS = 4_194_304;

/** Minimum edge per the API schema (width/height >= 64). */
export const FLUX_MIN_EDGE = 64;

/**
 * Aspect-ratio fallback sizes (used when no exact placement size is chosen).
 * All are multiples of 16 (the docs' preferred granularity) and <= 4 MP,
 * targeting ~1.5–2 MP for crisp marketing assets.
 */
const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1440, height: 1440 }, // ~2.07MP square (social, product tile)
  "3:2": { width: 1728, height: 1152 }, // landscape photo
  "2:3": { width: 1152, height: 1728 }, // portrait photo
  "16:9": { width: 1792, height: 1024 }, // wide banner / hero
  "9:16": { width: 1024, height: 1792 }, // vertical story / reel
  "4:5": { width: 1152, height: 1440 }, // instagram portrait
};

export function dimensionsForAspect(ar: AspectRatio | undefined | null): { width: number; height: number } {
  if (ar && DIMENSIONS[ar]) return DIMENSIONS[ar];
  return DIMENSIONS["1:1"];
}

// ---------------------------------------------------------------------------
// Prompt building (natural language, no Midjourney flags)
// ---------------------------------------------------------------------------

/** Collapse whitespace / strip control chars for a clean prompt line. */
function tidy(s: string | undefined | null): string {
  return (s ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Build the natural-language FLUX prompt from the SAME CreativeBrief the
 * Midjourney builder uses. We take the assembled CONCEPT text (subject-first
 * comma groups — already sanitized by the shared core) and drop the "--"
 * parameter flags, which are Midjourney-only. "exclude" becomes an explicit
 * "Avoid:" clause because FLUX has no separate negative field.
 *
 * `compositionHint` (optional) appends destination-specific art direction —
 * e.g. a placement's "leave the left third calm for overlaid text".
 */
export function buildFluxPrompt(brief: CreativeBrief, compositionHint?: string): string {
  const assembled = assemblePrompt(brief);
  let prompt = tidy(assembled.conceptText);
  const hint = tidy(compositionHint);
  if (hint) prompt = prompt ? `${prompt}. Composition: ${hint}.` : `Composition: ${hint}.`;
  const exclude = tidy(brief.exclude);
  if (exclude) prompt = prompt ? `${prompt} Avoid: ${exclude}.` : `Avoid: ${exclude}.`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

/**
 * FLUX.2 supports up to 8 reference images via the API (verified against
 * docs.bfl.ai — input_image, input_image_2 … input_image_8, URL or base64).
 * The legacy Kontext endpoint supports only 4.
 */
export const MAX_REFERENCE_IMAGES = 8;
export const KONTEXT_MAX_REFERENCE_IMAGES = 4;

export type FluxOutputFormat = "jpeg" | "png" | "webp";

export type FluxRequest = {
  prompt: string;
  /** flux-2-* endpoints: explicit pixel size (>= 64 per edge, <= ~4 MP). */
  width?: number;
  height?: number;
  /** Kontext (legacy) endpoint: ratio string instead of width/height. */
  aspect_ratio?: string;
  /** Reproducibility (optional; carried from the brief seed). */
  seed?: number;
  /**
   * flux-2-max / flux-2-pro: upsampling is ON by default; this turns it OFF
   * so the model uses the prompt exactly as written.
   */
  disable_pup?: boolean;
  /** flux-2-flex (default true) and kontext (default false). */
  prompt_upsampling?: boolean;
  /** Moderation tolerance: 0..5 on FLUX 2 endpoints (0..6 on legacy Kontext). */
  safety_tolerance: number;
  /** Output container (FLUX 2 default jpeg; webp supported). */
  output_format: FluxOutputFormat;
  /** Reference images (URL or base64 data URI). */
  input_image?: string;
  input_image_2?: string;
  input_image_3?: string;
  input_image_4?: string;
  input_image_5?: string;
  input_image_6?: string;
  input_image_7?: string;
  input_image_8?: string;
};

export type BuildFluxRequestResult =
  | { ok: true; request: FluxRequest; warnings: string[] }
  | { ok: false; error: string };

function clampInt(n: number | undefined | null, lo: number, hi: number, dflt: number): number {
  if (n === undefined || n === null || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export type BuildFluxRequestOptions = {
  /** Which model endpoint the request targets (drives the field contract). */
  endpoint?: string;
  /**
   * Exact output size (e.g. a placement like 1080×1080). Takes priority over
   * the brief's aspect ratio. Ignored on the legacy Kontext endpoint (which
   * only accepts a ratio string).
   */
  width?: number;
  height?: number;
  /** Destination-specific art direction appended to the prompt. */
  compositionHint?: string;
  safetyTolerance?: number;
  outputFormat?: FluxOutputFormat;
  /** Up to 8 reference-image URLs / data URIs (4 on Kontext). */
  referenceImages?: string[];
  /**
   * Prompt upsampling — FLUX rewrites/expands the prompt for richer results.
   * undefined = follow the endpoint's own default (ON for flux-2-max/pro and
   * flex, OFF for Kontext). Explicit true/false emits the right field for the
   * endpoint family (disable_pup vs prompt_upsampling — verified docs).
   */
  promptUpsampling?: boolean;
};

/**
 * Turn a CreativeBrief into a validated FLUX request body for the target
 * endpoint. Grounded in the verified per-endpoint BFL field sets; unknown /
 * extra fields are intentionally omitted.
 */
export function buildFluxRequest(
  brief: CreativeBrief,
  opts?: BuildFluxRequestOptions,
): BuildFluxRequestResult {
  const prompt = buildFluxPrompt(brief, opts?.compositionHint);
  if (prompt.length < 3) return { ok: false, error: "Add at least a subject before generating." };
  if (prompt.length > 4000) return { ok: false, error: "Prompt is too long (max 4000 chars)." };

  const warnings: string[] = [];
  const family = endpointFamily(opts?.endpoint);

  // FLUX ignores Midjourney-only knobs; warn so the marketer isn't surprised.
  if (brief.stylize || brief.chaos || brief.weird || brief.niji || brief.raw) {
    warnings.push("Midjourney-only settings (stylize, chaos, weird, niji, raw) do not apply to FLUX and were ignored.");
  }

  const request: FluxRequest = {
    prompt,
    // Verified ranges: 0..5 on FLUX 2 endpoints, 0..6 on legacy Kontext.
    safety_tolerance: clampInt(opts?.safetyTolerance, 0, family === "kontext" ? 6 : 5, 2),
    output_format:
      opts?.outputFormat === "jpeg" || opts?.outputFormat === "webp" ? opts.outputFormat : "png",
  };

  // Size: exact pixels for FLUX 2 endpoints; ratio string for legacy Kontext.
  if (family === "kontext") {
    request.aspect_ratio = brief.aspectRatio ?? "1:1";
    if (opts?.width || opts?.height) {
      warnings.push("FLUX Kontext takes an aspect ratio, not exact pixels — the ratio closest to your placement was used.");
    }
  } else {
    let width: number;
    let height: number;
    if (opts?.width && opts?.height) {
      width = Math.round(opts.width);
      height = Math.round(opts.height);
      if (width < FLUX_MIN_EDGE || height < FLUX_MIN_EDGE) {
        return { ok: false, error: `Image size must be at least ${FLUX_MIN_EDGE}px per side.` };
      }
      if (width * height > FLUX_MAX_PIXELS) {
        return { ok: false, error: "Requested size exceeds FLUX's ~4 MP output limit. Pick a smaller size and upscale for print." };
      }
    } else {
      ({ width, height } = dimensionsForAspect(brief.aspectRatio));
    }
    request.width = width;
    request.height = height;
  }

  // Prompt upsampling — the field name AND default differ per endpoint family.
  if (family === "flux2-pup") {
    // Upsampling is ON by default; only emit disable_pup when turning it off.
    if (opts?.promptUpsampling === false) request.disable_pup = true;
  } else if (family === "flux2-upsampling") {
    // flex: prompt_upsampling defaults TRUE; emit only an explicit choice.
    if (opts?.promptUpsampling !== undefined) request.prompt_upsampling = opts.promptUpsampling;
  } else {
    // kontext: defaults FALSE; emit only when turning it on.
    if (opts?.promptUpsampling === true) request.prompt_upsampling = true;
  }

  if (brief.seed !== undefined && brief.seed !== null && Number.isFinite(brief.seed)) {
    request.seed = clampInt(brief.seed, 0, 4294967295, 0);
  }

  // Reference images -> input_image, input_image_2 … (per-endpoint cap).
  const cap = family === "kontext" ? KONTEXT_MAX_REFERENCE_IMAGES : MAX_REFERENCE_IMAGES;
  const refs = (opts?.referenceImages ?? [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter(Boolean)
    .slice(0, cap);
  if ((opts?.referenceImages ?? []).length > cap) {
    warnings.push(`Only the first ${cap} reference images are used (${family === "kontext" ? "Kontext" : "FLUX.2"} API limit).`);
  }
  const refKeys: (keyof FluxRequest)[] = [
    "input_image",
    "input_image_2",
    "input_image_3",
    "input_image_4",
    "input_image_5",
    "input_image_6",
    "input_image_7",
    "input_image_8",
  ];
  refs.forEach((url, i) => {
    (request as Record<string, unknown>)[refKeys[i] as string] = url;
  });

  return { ok: true, request, warnings };
}

// ---------------------------------------------------------------------------
// Response parsing (submit + poll)
// ---------------------------------------------------------------------------

export type FluxSubmitParse =
  | {
      ok: true;
      id: string;
      pollingUrl: string;
      /** Credits charged for this request (verified response field). */
      cost?: number;
      /** Input/output megapixels (2 decimal places, verified response fields). */
      inputMp?: number;
      outputMp?: number;
    }
  | { ok: false; error: string };

/** Parse the POST submit response: { id, polling_url, cost?, input_mp?, output_mp? }. */
export function parseSubmitResponse(body: unknown): FluxSubmitParse {
  if (!body || typeof body !== "object") return { ok: false, error: "Empty response from FLUX submit." };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  const pollingUrl = typeof b.polling_url === "string" ? b.polling_url : "";
  if (!id || !pollingUrl) return { ok: false, error: "FLUX submit did not return an id/polling_url." };
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    ok: true,
    id,
    pollingUrl,
    cost: num(b.cost),
    inputMp: num(b.input_mp),
    outputMp: num(b.output_mp),
  };
}

export type FluxPollStatus = "pending" | "ready" | "error" | "moderated" | "unknown";

export type FluxPollParse = {
  status: FluxPollStatus;
  /** Signed image URL when status === "ready". */
  sampleUrl?: string;
  /** Human-readable detail when error/moderated. */
  detail?: string;
  /** Whether polling should stop (terminal state). */
  terminal: boolean;
};

/**
 * Parse a GET poll response. BFL statuses (verified):
 *   "Pending" -> keep polling
 *   "Ready"   -> result.sample is the signed image URL
 *   "Error" | "Content Moderated" | "Request Moderated" | "Task not found" -> terminal failure
 */
export function parsePollResponse(body: unknown): FluxPollParse {
  if (!body || typeof body !== "object") return { status: "unknown", terminal: false };
  const b = body as Record<string, unknown>;
  const raw = typeof b.status === "string" ? b.status : "";
  const norm = raw.trim().toLowerCase();

  if (norm === "ready") {
    const result = (b.result ?? null) as Record<string, unknown> | null;
    const sample = result && typeof result.sample === "string" ? result.sample : "";
    if (!sample) return { status: "error", terminal: true, detail: "Ready but no image URL was returned." };
    return { status: "ready", sampleUrl: sample, terminal: true };
  }
  if (norm === "pending" || norm === "processing" || norm === "queued" || norm === "in progress") {
    return { status: "pending", terminal: false };
  }
  if (norm.includes("moderat")) {
    return { status: "moderated", terminal: true, detail: raw || "Content was moderated." };
  }
  if (norm === "error" || norm.includes("not found") || norm.includes("failed")) {
    return { status: "error", terminal: true, detail: raw || "FLUX reported an error." };
  }
  return { status: "unknown", terminal: false, detail: raw };
}

// ---------------------------------------------------------------------------
// URL / filename helpers
// ---------------------------------------------------------------------------

/** Normalize the base URL + endpoint into the submit URL. */
export function buildSubmitUrl(baseUrl: string, endpoint: string): string {
  const base = (baseUrl || FLUX_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const ep = (endpoint || FLUX_DEFAULT_ENDPOINT).replace(/^\/+/, "").replace(/^v1\//, "");
  return `${base}/v1/${ep}`;
}

/** A stable, human-friendly filename for the saved asset. */
export function fluxFilename(subject: string | undefined, format: FluxOutputFormat): string {
  const slug = (subject || "flux-image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "flux-image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = format === "jpeg" ? "jpg" : format;
  return `${slug}-${stamp}.${ext}`;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx)
// ---------------------------------------------------------------------------

export function __runFluxCoreTests(): string {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert(c, m);
    n++;
  };

  // endpoint families
  ok(endpointFamily("flux-2-max") === "flux2-pup", "max is pup family");
  ok(endpointFamily("flux-2-pro") === "flux2-pup", "pro is pup family");
  ok(endpointFamily("flux-2-flex") === "flux2-upsampling", "flex is upsampling family");
  ok(endpointFamily("flux-kontext-max") === "kontext", "kontext family");
  ok(endpointFamily(undefined) === "flux2-pup", "default family");

  // dimensions
  ok(dimensionsForAspect("16:9").width === 1792, "16:9 width");
  ok(dimensionsForAspect("9:16").height === 1792, "9:16 height");
  ok(dimensionsForAspect(undefined).width === 1440, "default square width");
  for (const ar of ["1:1", "3:2", "2:3", "16:9", "9:16", "4:5"] as AspectRatio[]) {
    const d = dimensionsForAspect(ar);
    ok(d.width % 16 === 0 && d.height % 16 === 0, `dims multiple of 16 for ${ar}`);
    ok(d.width * d.height <= FLUX_MAX_PIXELS, `dims within 4MP for ${ar}`);
  }

  // prompt building: concept only, no --flags, exclude -> Avoid, hint appended
  const brief: CreativeBrief = {
    subject: "premium cannabis pre-roll",
    environment: "on a marble countertop",
    style: "editorial product photography",
    exclude: "text, watermark",
    aspectRatio: "3:2",
    stylize: 200,
    version: 7,
    seed: 42,
  };
  const p = buildFluxPrompt(brief);
  ok(!p.includes("--"), "no midjourney flags in flux prompt");
  ok(p.startsWith("premium cannabis pre-roll"), "subject leads");
  ok(p.includes("Avoid: text, watermark"), "exclude becomes Avoid clause");
  const pHint = buildFluxPrompt(brief, "keep the left third calm for overlaid text");
  ok(pHint.includes("Composition: keep the left third calm"), "composition hint appended");
  ok(pHint.indexOf("Composition:") < pHint.indexOf("Avoid:"), "hint before avoid clause");

  // request build + warnings for MJ-only knobs (default endpoint = max)
  const built = buildFluxRequest(brief);
  ok(built.ok === true, "request builds");
  if (built.ok) {
    ok(built.request.width === 1728 && built.request.height === 1152, "3:2 dims applied");
    ok(built.request.seed === 42, "seed carried");
    ok(built.request.output_format === "png", "default png");
    ok(built.request.safety_tolerance === 2, "default safety tolerance");
    ok(built.request.disable_pup === undefined, "upsampling default (on) emits no field");
    ok(built.request.prompt_upsampling === undefined, "no prompt_upsampling on max");
    ok(built.warnings.some((w) => w.includes("stylize")), "warns about MJ-only knobs");
  }

  // upsampling semantics per family (verified: max/pro use disable_pup)
  const noPup = buildFluxRequest(brief, { endpoint: "flux-2-max", promptUpsampling: false });
  ok(noPup.ok && noPup.request.disable_pup === true, "max: upsampling off -> disable_pup true");
  const yesPup = buildFluxRequest(brief, { endpoint: "flux-2-pro", promptUpsampling: true });
  ok(yesPup.ok && yesPup.request.disable_pup === undefined, "pro: upsampling on -> no field (API default)");
  const flexOff = buildFluxRequest(brief, { endpoint: "flux-2-flex", promptUpsampling: false });
  ok(flexOff.ok && flexOff.request.prompt_upsampling === false && flexOff.request.disable_pup === undefined, "flex: explicit false emits prompt_upsampling");
  const kontextOn = buildFluxRequest(brief, { endpoint: "flux-kontext-max", promptUpsampling: true });
  ok(kontextOn.ok && kontextOn.request.prompt_upsampling === true, "kontext: explicit true emits prompt_upsampling");

  // safety clamps: 0..5 on FLUX 2, 0..6 on kontext (verified)
  const s6 = buildFluxRequest(brief, { endpoint: "flux-2-max", safetyTolerance: 6 });
  ok(s6.ok && s6.request.safety_tolerance === 5, "flux2 safety clamped to 5");
  const s6k = buildFluxRequest(brief, { endpoint: "flux-kontext-max", safetyTolerance: 6 });
  ok(s6k.ok && s6k.request.safety_tolerance === 6, "kontext safety allows 6");

  // webp output (verified supported on FLUX 2)
  const webp = buildFluxRequest(brief, { outputFormat: "webp" });
  ok(webp.ok && webp.request.output_format === "webp", "webp output supported");

  // exact placement size override
  const sized = buildFluxRequest(brief, { width: 1080, height: 1080 });
  ok(sized.ok && sized.request.width === 1080 && sized.request.height === 1080, "exact size override");
  const tooBig = buildFluxRequest(brief, { width: 2550, height: 3300 });
  ok(tooBig.ok === false, "over-4MP size rejected with guidance");
  const tooSmall = buildFluxRequest(brief, { width: 32, height: 100 });
  ok(tooSmall.ok === false, "sub-64px size rejected");

  // kontext: ratio string, no width/height, warns on exact-size request
  const k = buildFluxRequest(brief, { endpoint: "flux-kontext-max", width: 1080, height: 1080 });
  ok(k.ok === true, "kontext builds");
  if (k.ok) {
    ok(k.request.aspect_ratio === "3:2", "kontext uses brief ratio");
    ok(k.request.width === undefined && k.request.height === undefined, "kontext has no pixel dims");
    ok(k.warnings.some((w) => w.includes("aspect ratio")), "kontext warns about exact size");
  }

  const empty = buildFluxRequest({ subject: "" });
  ok(empty.ok === false, "empty subject rejected");

  // reference images -> input_image, input_image_2 … (cap 8 on FLUX 2, 4 on kontext)
  const withRefs = buildFluxRequest(
    { subject: "product hero" },
    { referenceImages: ["https://a/1.png", "https://a/2.png"] },
  );
  ok(withRefs.ok === true, "request with refs builds");
  if (withRefs.ok) {
    ok(withRefs.request.input_image === "https://a/1.png", "input_image mapped");
    ok(withRefs.request.input_image_2 === "https://a/2.png", "input_image_2 mapped");
    ok(withRefs.request.input_image_3 === undefined, "input_image_3 unset");
  }
  const nineRefs = buildFluxRequest(
    { subject: "product hero shot" },
    { referenceImages: Array.from({ length: 9 }, (_, i) => `https://a/${i}.png`) },
  );
  ok(
    nineRefs.ok === true && nineRefs.warnings.some((w) => w.includes("first 8")),
    "warns + caps at 8 references",
  );
  const fiveKontext = buildFluxRequest(
    { subject: "product hero shot" },
    { endpoint: "flux-kontext-max", referenceImages: Array.from({ length: 5 }, (_, i) => `https://a/${i}.png`) },
  );
  ok(
    fiveKontext.ok === true &&
      fiveKontext.warnings.some((w) => w.includes("first 4")) &&
      (fiveKontext.request as Record<string, unknown>).input_image_5 === undefined,
    "kontext caps at 4 references",
  );

  // submit parse (incl. verified cost / mp fields)
  const s1 = parseSubmitResponse({ id: "abc", polling_url: "https://x/poll", cost: 0.08, input_mp: 0, output_mp: 2.07 });
  ok(s1.ok === true && s1.id === "abc" && s1.pollingUrl === "https://x/poll", "submit parse ok");
  ok(s1.ok === true && s1.cost === 0.08 && s1.outputMp === 2.07, "submit captures cost + output mp");
  const s2 = parseSubmitResponse({ id: "abc", polling_url: "https://x/poll" });
  ok(s2.ok === true && s2.cost === undefined, "submit tolerates missing cost");
  ok(parseSubmitResponse({ id: "abc" }).ok === false, "submit missing polling_url");
  ok(parseSubmitResponse(null).ok === false, "submit null");

  // poll parse
  ok(parsePollResponse({ status: "Pending" }).status === "pending", "poll pending");
  const pr = parsePollResponse({ status: "Ready", result: { sample: "https://img/x.png" } });
  ok(pr.status === "ready" && pr.terminal && pr.sampleUrl === "https://img/x.png", "poll ready");
  ok(parsePollResponse({ status: "Ready", result: {} }).status === "error", "ready without sample -> error");
  ok(parsePollResponse({ status: "Content Moderated" }).status === "moderated", "poll moderated");
  ok(parsePollResponse({ status: "Error" }).status === "error", "poll error");
  ok(parsePollResponse({ status: "Task not found" }).terminal === true, "poll not found terminal");

  // url + filename
  ok(buildSubmitUrl("https://api.bfl.ai/", "flux-2-max") === "https://api.bfl.ai/v1/flux-2-max", "submit url");
  ok(buildSubmitUrl("", "") === "https://api.bfl.ai/v1/flux-2-max", "submit url defaults");
  ok(buildSubmitUrl("https://api.us.bfl.ai", "v1/flux-2-pro") === "https://api.us.bfl.ai/v1/flux-2-pro", "submit url strips v1");
  ok(/\.png$/.test(fluxFilename("Product Hero!", "png")), "filename png ext");
  ok(/\.jpg$/.test(fluxFilename("x", "jpeg")), "filename jpg ext");
  ok(/\.webp$/.test(fluxFilename("x", "webp")), "filename webp ext");
  ok(fluxFilename("Product Hero!", "png").startsWith("product-hero-"), "filename slug");

  return `OK flux-core: ${n} assertions passed`;
}

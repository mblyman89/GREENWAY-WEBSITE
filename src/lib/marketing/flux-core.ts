/**
 * src/lib/marketing/flux-core.ts
 *
 * PURE, dependency-free logic for the FLUX 2 image-generation pipeline
 * (Slice A / item 19). No server-only imports so it is unit-testable with tsx.
 *
 * The owner is pivoting from Midjourney (paste-a-prompt) to Black Forest Labs
 * FLUX 2 [max] as a fully integrated API pipeline on the SAME builder page. We
 * reuse the exact same CreativeBrief / assemblePrompt from midjourney-core so
 * the transition is seamless: the marketer builds one brief; "Copy" gives the
 * Midjourney string, "Generate with FLUX 2 Max" runs the API.
 *
 * KEY DIFFERENCE vs Midjourney:
 *   Midjourney encodes composition into "--ar / --v / --stylize" flags appended
 *   to the prompt text. FLUX 2 takes a NATURAL-LANGUAGE prompt plus explicit
 *   width/height (and other JSON fields). So for FLUX we:
 *     - use the CONCEPT text (subject-first comma groups) as the prompt,
 *     - translate the aspect ratio into concrete pixel dimensions,
 *     - drop the "--" flags (they are Midjourney-only syntax),
 *     - keep "exclude" as an explicit "Avoid: ..." clause in the prompt, since
 *       FLUX has no separate negative-prompt field on this endpoint.
 *
 * VERIFIED FLUX 2 API contract (docs.bfl.ai):
 *   POST {base}/v1/{endpoint}   header x-key: <key>   body { prompt, width, height, ... }
 *     -> 200 { id, polling_url }        (async submit)
 *   GET  polling_url            header x-key: <key>
 *     -> { status, result }             (poll; status "Ready" => result.sample is a signed image URL, ~10 min TTL)
 *   Statuses seen: "Pending" | "Ready" | "Error" | "Content Moderated" | "Request Moderated" | "Task not found".
 *   Rate limit: 429 (too many active tasks). Credits: 402.
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
 * Non-"preview" endpoints are the reproducible/pinned ones.
 */
export const FLUX_ENDPOINTS: { value: string; label: string; note: string }[] = [
  { value: "flux-2-max", label: "FLUX 2 [max]", note: "Highest fidelity — best for hero/product marketing." },
  { value: "flux-2-pro", label: "FLUX 2 [pro]", note: "Strong quality, faster/cheaper than max." },
  { value: "flux-2-flex", label: "FLUX 2 [flex]", note: "Flexible quality/speed trade-off." },
  { value: "flux-kontext-max", label: "FLUX Kontext [max]", note: "Editing / reference-driven generation." },
];

// ---------------------------------------------------------------------------
// Aspect ratio -> pixel dimensions
// ---------------------------------------------------------------------------

/**
 * FLUX 2 accepts explicit width/height (multiples of 32 recommended; up to
 * ~4MP). We target roughly 1.5–2MP for crisp marketing assets while keeping
 * each aspect ratio's proportions. All values are multiples of 32.
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
 * "Avoid:" clause because this FLUX endpoint has no separate negative field.
 */
export function buildFluxPrompt(brief: CreativeBrief): string {
  const assembled = assemblePrompt(brief);
  let prompt = tidy(assembled.conceptText);
  const exclude = tidy(brief.exclude);
  if (exclude) prompt = prompt ? `${prompt}. Avoid: ${exclude}.` : `Avoid: ${exclude}.`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export type FluxRequest = {
  prompt: string;
  width: number;
  height: number;
  /** Reproducibility (optional; carried from the brief seed). */
  seed?: number;
  /** BFL upsampling of the prompt (default off so the marketer stays in control). */
  prompt_upsampling: boolean;
  /** BFL content-moderation tolerance 0 (strict) .. 6 (lax). Default 2. */
  safety_tolerance: number;
  /** Output container. */
  output_format: "png" | "jpeg";
};

export type BuildFluxRequestResult =
  | { ok: true; request: FluxRequest; warnings: string[] }
  | { ok: false; error: string };

function clampInt(n: number | undefined | null, lo: number, hi: number, dflt: number): number {
  if (n === undefined || n === null || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Turn a CreativeBrief into a validated FLUX 2 request body. Grounded in the
 * verified BFL field set; unknown/extra fields are intentionally omitted.
 */
export function buildFluxRequest(
  brief: CreativeBrief,
  opts?: { safetyTolerance?: number; outputFormat?: "png" | "jpeg" },
): BuildFluxRequestResult {
  const prompt = buildFluxPrompt(brief);
  if (prompt.length < 3) return { ok: false, error: "Add at least a subject before generating." };
  if (prompt.length > 4000) return { ok: false, error: "Prompt is too long (max 4000 chars)." };

  const warnings: string[] = [];
  const { width, height } = dimensionsForAspect(brief.aspectRatio);

  // FLUX ignores Midjourney-only knobs; warn so the marketer isn't surprised.
  if (brief.stylize || brief.chaos || brief.weird || brief.niji || brief.raw) {
    warnings.push("Midjourney-only settings (stylize, chaos, weird, niji, raw) do not apply to FLUX and were ignored.");
  }
  if (brief.srefUrl || brief.orefUrl) {
    warnings.push("Reference images are not sent to FLUX in this pipeline; describe the desired look in the brief instead.");
  }

  const request: FluxRequest = {
    prompt,
    width,
    height,
    prompt_upsampling: false,
    safety_tolerance: clampInt(opts?.safetyTolerance, 0, 6, 2),
    output_format: opts?.outputFormat === "jpeg" ? "jpeg" : "png",
  };
  if (brief.seed !== undefined && brief.seed !== null && Number.isFinite(brief.seed)) {
    request.seed = clampInt(brief.seed, 0, 4294967295, 0);
  }
  return { ok: true, request, warnings };
}

// ---------------------------------------------------------------------------
// Response parsing (submit + poll)
// ---------------------------------------------------------------------------

export type FluxSubmitParse =
  | { ok: true; id: string; pollingUrl: string }
  | { ok: false; error: string };

/** Parse the POST submit response: expects { id, polling_url }. */
export function parseSubmitResponse(body: unknown): FluxSubmitParse {
  if (!body || typeof body !== "object") return { ok: false, error: "Empty response from FLUX submit." };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  const pollingUrl = typeof b.polling_url === "string" ? b.polling_url : "";
  if (!id || !pollingUrl) return { ok: false, error: "FLUX submit did not return an id/polling_url." };
  return { ok: true, id, pollingUrl };
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
export function fluxFilename(subject: string | undefined, format: "png" | "jpeg"): string {
  const slug = (subject || "flux-image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "flux-image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = format === "jpeg" ? "jpg" : "png";
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

  // dimensions
  ok(dimensionsForAspect("16:9").width === 1792, "16:9 width");
  ok(dimensionsForAspect("9:16").height === 1792, "9:16 height");
  ok(dimensionsForAspect(undefined).width === 1440, "default square width");
  for (const ar of ["1:1", "3:2", "2:3", "16:9", "9:16", "4:5"] as AspectRatio[]) {
    const d = dimensionsForAspect(ar);
    ok(d.width % 32 === 0 && d.height % 32 === 0, `dims multiple of 32 for ${ar}`);
  }

  // prompt building: concept only, no --flags, exclude -> Avoid
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

  // request build + warnings for MJ-only knobs
  const built = buildFluxRequest(brief);
  ok(built.ok === true, "request builds");
  if (built.ok) {
    ok(built.request.width === 1728 && built.request.height === 1152, "3:2 dims applied");
    ok(built.request.seed === 42, "seed carried");
    ok(built.request.output_format === "png", "default png");
    ok(built.request.safety_tolerance === 2, "default safety tolerance");
    ok(built.warnings.some((w) => w.includes("stylize")), "warns about MJ-only knobs");
  }

  const empty = buildFluxRequest({ subject: "" });
  ok(empty.ok === false, "empty subject rejected");

  // submit parse
  const s1 = parseSubmitResponse({ id: "abc", polling_url: "https://x/poll" });
  ok(s1.ok === true && s1.id === "abc" && s1.pollingUrl === "https://x/poll", "submit parse ok");
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
  ok(fluxFilename("Product Hero!", "png").startsWith("product-hero-"), "filename slug");

  return `OK flux-core: ${n} assertions passed`;
}

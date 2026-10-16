/**
 * src/lib/marketing/flux-core.ts
 *
 * PURE, dependency-free logic for the FLUX image pipeline (R62 rewrite).
 * No server-only imports so it is unit-testable with tsx.
 *
 * R62 ROOT-CAUSE FIX: the old builder never sent the user's prompt. It rebuilt
 * one from Midjourney brief fields (comma-joined, newlines stripped), appended a
 * placement hint ("key subject centered") and an "Avoid: …" clause. FLUX.2 has
 * no negative prompts — naming a thing pulls it IN — so results collapsed into
 * centered product portraits. Now the prompt is sent EXACTLY as typed, like the
 * BFL Playground, and every request field is a verified schema field.
 *
 * VERIFIED against the live OpenAPI (https://api.bfl.ai/openapi.json) + docs.bfl.ml:
 *   POST {base}/v1/{endpoint}  header x-key -> { id, polling_url, cost, input_mp, output_mp }
 *   GET  polling_url           header x-key -> { id, status, result, progress, details }
 *     status ∈ Task not found | Pending | Reasoning | Generating | Request Moderated |
 *              Content Moderated | No Card Generated | Ready | Error
 *   GET  {base}/v1/credits                  -> { credits }  (1 credit = $0.01)
 *
 *   flux-2-max / flux-2-pro (Flux2Inputs): prompt, disable_pup (default false =
 *     upsampling ON), input_image … input_image_8, seed, width/height (>= 64,
 *     default 0 = auto), safety_tolerance 0..7 (default 2; org-approved max),
 *     output_format jpeg|png|webp (default jpeg).
 *   flux-2-flex (Flux2FlexInputs): same, but prompt_upsampling (default true)
 *     instead of disable_pup, plus guidance 1.5..10 (5) and steps 1..50 (50).
 *   flux-3-image (Flux3ImageInputs, additionalProperties:false): prompt,
 *     images (1..10), aspect_ratio auto|21:9…9:21 (auto follows image 1),
 *     resolution 768sq|1k|1.5k|2k|4k (1k), safety_tolerance, grounding (true).
 *     NO seed, NO output_format, NO width/height.
 *   Docs: FLUX.2 dims are multiples of 16, max 4 MP (<= 2 MP recommended).
 */

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Default API base (global). Owner may pin api.us.bfl.ai / api.eu.bfl.ai. */
export const FLUX_DEFAULT_BASE_URL = "https://api.bfl.ai";

/** Default model endpoint (owner's choice: highest fidelity). */
export const FLUX_DEFAULT_ENDPOINT = "flux-2-max";

export type FluxModelId = "flux-2-max" | "flux-2-pro" | "flux-2-flex" | "flux-3-image";
export type FluxOutputFormat = "jpeg" | "png" | "webp";

export type FluxModelSpec = {
  id: FluxModelId;
  label: string;
  note: string;
  /** Request contract. */
  family: "flux2" | "flux2-flex" | "flux3";
  maxRefs: number;
  /** "pixels" = width/height; "tier" = aspect_ratio + resolution tier. */
  sizing: "pixels" | "tier";
  formats: FluxOutputFormat[];
  seed: boolean;
};

export const FLUX_MODELS: FluxModelSpec[] = [
  { id: "flux-2-max", label: "FLUX.2 [max]", note: "Highest quality; grounded in web search for current products, places and people.", family: "flux2", maxRefs: 8, sizing: "pixels", formats: ["jpeg", "png", "webp"], seed: true },
  { id: "flux-2-pro", label: "FLUX.2 [pro]", note: "Production quality, faster and cheaper than [max].", family: "flux2", maxRefs: 8, sizing: "pixels", formats: ["jpeg", "png", "webp"], seed: true },
  { id: "flux-2-flex", label: "FLUX.2 [flex]", note: "Best for typography and exact text; adds guidance + steps controls.", family: "flux2-flex", maxRefs: 8, sizing: "pixels", formats: ["jpeg", "png", "webp"], seed: true },
  { id: "flux-3-image", label: "FLUX 3 Image", note: "Newest model: up to 10 references, resolution tiers to 4K, grounding.", family: "flux3", maxRefs: 10, sizing: "tier", formats: [], seed: false },
];

/** Kept for the Integrations page (default-model picker). */
export const FLUX_ENDPOINTS: { value: string; label: string; note: string }[] = FLUX_MODELS.map((m) => ({
  value: m.id,
  label: m.label,
  note: m.note,
}));

/** Resolve a stored/requested endpoint to a supported model (legacy -> max). */
export function fluxModel(id: string | null | undefined): FluxModelSpec {
  const clean = String(id ?? "").trim().replace(/^\/+/, "").replace(/^v1\//, "");
  return FLUX_MODELS.find((m) => m.id === clean) ?? FLUX_MODELS[0];
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

export const FLUX_MAX_PIXELS = 4_194_304; // 4 MP (docs)
export const FLUX_MIN_EDGE = 64; // schema minimum
const MP = 1_048_576;

/** Aspect presets (FLUX.2 computes pixels; FLUX 3 sends the string). */
export const FLUX_ASPECTS = ["21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"] as const;
export type FluxAspect = (typeof FLUX_ASPECTS)[number];

/** FLUX.2 output size targets (docs: max 4 MP, <= 2 MP recommended). */
export const FLUX_MEGAPIXELS = [
  { value: 1, label: "1 MP" },
  { value: 2, label: "2 MP (recommended max)" },
  { value: 4, label: "4 MP (maximum)" },
] as const;

/** FLUX 3 resolution tiers (verified enum + pricing table output sizes). */
export const FLUX3_RESOLUTIONS = [
  { value: "768sq", label: "768 × 768 (fast drafts)" },
  { value: "1k", label: "1K (~1 MP)" },
  { value: "1.5k", label: "1.5K (~2 MP)" },
  { value: "2k", label: "2K (~4 MP)" },
  { value: "4k", label: "4K (~16 MP)" },
] as const;
export type Flux3Resolution = (typeof FLUX3_RESOLUTIONS)[number]["value"];

/** Parse "W:H" (or "WxH") into a positive ratio, else null. */
export function parseRatio(input: string | null | undefined): { w: number; h: number } | null {
  const m = String(input ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  const r = w / h;
  if (r > 8 || r < 1 / 8) return null; // keep within a sane, renderable range
  return { w, h };
}

const floor16 = (n: number) => Math.max(FLUX_MIN_EDGE, Math.floor(n / 16) * 16);

/** Pixel size for a ratio at a megapixel target: multiples of 16, <= 4 MP. */
export function dimensionsForRatio(ratio: string, megapixels = 1): { width: number; height: number } | null {
  const r = parseRatio(ratio);
  if (!r) return null;
  const target = Math.min(Math.max(megapixels, 0.25), 4) * MP;
  const k = r.w / r.h;
  let width = floor16(Math.sqrt(target * k));
  let height = floor16(Math.sqrt(target / k));
  while (width * height > FLUX_MAX_PIXELS) {
    if (width >= height) width -= 16;
    else height -= 16;
  }
  return { width, height };
}

/** Closest preset aspect for a pixel size (FLUX 3 / video have fixed ratios). */
export function closestFluxAspect(width: number, height: number, allowed: readonly string[] = FLUX_ASPECTS): string {
  if (!(width > 0) || !(height > 0)) return "1:1";
  const target = Math.log(width / height);
  let best = allowed[0];
  let bestD = Infinity;
  for (const a of allowed) {
    const r = parseRatio(a);
    if (!r) continue;
    const d = Math.abs(Math.log(r.w / r.h) - target);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export const FLUX_COUNTS = [1, 2, 3, 4, 8] as const;
/** The user asked for the Playground's 0–5 range; BFL default is 2. */
export const FLUX_SAFETY_MAX = 5;
export const FLUX_SAFETY_DEFAULT = 2;

export type FluxImageSettings = {
  model: string;
  prompt: string;
  /** "auto" = API default (FLUX.2 omits width/height; FLUX 3 follows image 1). */
  aspect?: string;
  /** FLUX.2 only: megapixel target for the aspect. */
  megapixels?: number;
  /** FLUX.2 only: exact size (custom / destination preset). Beats aspect. */
  width?: number;
  height?: number;
  resolution?: string;
  safetyTolerance?: number;
  outputFormat?: FluxOutputFormat;
  promptUpsampling?: boolean;
  seed?: number | null;
  grounding?: boolean;
  guidance?: number;
  steps?: number;
  referenceImages?: string[];
  count?: number;
};

export type FluxBody = Record<string, string | number | boolean | string[]>;

export type BuildFluxResult =
  | { ok: true; model: FluxModelSpec; bodies: FluxBody[]; warnings: string[]; width?: number; height?: number; format?: FluxOutputFormat }
  | { ok: false; error: string };

const clampInt = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
};

/** Nearest allowed image count (1, 2, 3, 4, 8). */
export function normalizeCount(n: unknown): number {
  const v = clampInt(n, 1, 8, 1);
  return v >= 6 ? 8 : Math.min(v, 4);
}

/**
 * Build one request body per image. The prompt is sent VERBATIM (trimmed only).
 * With a seed and count > 1, images use seed, seed+1, … so they differ yet
 * stay reproducible.
 */
export function buildFluxImageRequests(s: FluxImageSettings): BuildFluxResult {
  const model = fluxModel(s.model);
  const prompt = String(s.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "Write a prompt first." };
  const warnings: string[] = [];
  const base: FluxBody = { prompt, safety_tolerance: clampInt(s.safetyTolerance, 0, FLUX_SAFETY_MAX, FLUX_SAFETY_DEFAULT) };

  const rawRefs = (s.referenceImages ?? []).map((r) => (typeof r === "string" ? r.trim() : "")).filter(Boolean);
  const refs = rawRefs.slice(0, model.maxRefs);
  if (rawRefs.length > model.maxRefs) warnings.push(`Only the first ${model.maxRefs} reference images are used (${model.label} limit).`);

  const aspect = String(s.aspect ?? "auto").trim() || "auto";
  let width: number | undefined;
  let height: number | undefined;
  let format: FluxOutputFormat | undefined;

  if (model.sizing === "tier") {
    if (aspect !== "auto") {
      if (!(FLUX_ASPECTS as readonly string[]).includes(aspect)) {
        return { ok: false, error: `${model.label} supports these aspect ratios: auto, ${FLUX_ASPECTS.join(", ")}.` };
      }
      base.aspect_ratio = aspect;
    }
    const res = FLUX3_RESOLUTIONS.find((r) => r.value === s.resolution)?.value;
    if (res) base.resolution = res;
    if (s.grounding === false) base.grounding = false;
    if (refs.length) base.images = refs;
  } else {
    if (s.width || s.height) {
      const w = clampInt(s.width, 0, 100_000, 0);
      const h = clampInt(s.height, 0, 100_000, 0);
      if (w < FLUX_MIN_EDGE || h < FLUX_MIN_EDGE) return { ok: false, error: `Width and height must each be at least ${FLUX_MIN_EDGE}px.` };
      if (w * h > FLUX_MAX_PIXELS) return { ok: false, error: `${w}×${h} is over FLUX's 4 MP limit. Pick a smaller size or upscale afterwards.` };
      width = w;
      height = h;
      if (w % 16 || h % 16) warnings.push("BFL recommends sizes in multiples of 16 px.");
    } else if (aspect !== "auto") {
      const d = dimensionsForRatio(aspect, s.megapixels ?? 1);
      if (!d) return { ok: false, error: `"${aspect}" isn't a valid aspect ratio. Use W:H, for example 5:4.` };
      width = d.width;
      height = d.height;
    }
    if (width && height) {
      base.width = width;
      base.height = height;
    }
    format = model.formats.includes(s.outputFormat as FluxOutputFormat) ? (s.outputFormat as FluxOutputFormat) : "jpeg";
    base.output_format = format;
    if (model.family === "flux2") {
      if (s.promptUpsampling === false) base.disable_pup = true;
    } else {
      if (s.promptUpsampling === false) base.prompt_upsampling = false;
      if (s.guidance !== undefined && Number.isFinite(Number(s.guidance))) {
        base.guidance = Math.min(10, Math.max(1.5, Math.round(Number(s.guidance) * 10) / 10));
      }
      if (s.steps !== undefined && Number.isFinite(Number(s.steps))) base.steps = clampInt(s.steps, 1, 50, 50);
    }
    const keys = ["input_image", "input_image_2", "input_image_3", "input_image_4", "input_image_5", "input_image_6", "input_image_7", "input_image_8"];
    refs.forEach((url, i) => {
      base[keys[i]] = url;
    });
  }

  const count = normalizeCount(s.count);
  const hasSeed = s.seed !== undefined && s.seed !== null && String(s.seed) !== "" && Number.isFinite(Number(s.seed));
  if (hasSeed && !model.seed) warnings.push(`${model.label} has no seed setting; the seed was ignored.`);
  const seed0 = hasSeed ? clampInt(s.seed, 0, 4294967295, 0) : null;
  const bodies: FluxBody[] = Array.from({ length: count }, (_, i) => {
    const b: FluxBody = { ...base };
    if (seed0 !== null && model.seed) b.seed = (seed0 + i) % 4294967296;
    return b;
  });
  return { ok: true, model, bodies, warnings, width, height, format };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export type FluxSubmitParse =
  | { ok: true; id: string; pollingUrl: string; cost?: number; inputMp?: number; outputMp?: number }
  | { ok: false; error: string };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Parse the POST submit response: { id, polling_url, cost?, input_mp?, output_mp? }. */
export function parseSubmitResponse(body: unknown): FluxSubmitParse {
  if (!body || typeof body !== "object") return { ok: false, error: "Empty response from FLUX submit." };
  const b = body as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  const pollingUrl = typeof b.polling_url === "string" ? b.polling_url : "";
  if (!id || !pollingUrl) return { ok: false, error: "FLUX submit did not return an id/polling_url." };
  return { ok: true, id, pollingUrl, cost: num(b.cost), inputMp: num(b.input_mp), outputMp: num(b.output_mp) };
}

export type FluxPollStatus = "pending" | "ready" | "error" | "moderated" | "unknown";

export type FluxPollParse = {
  status: FluxPollStatus;
  /** BFL's own status label (e.g. "Reasoning", "Generating"). */
  label?: string;
  sampleUrl?: string;
  /** Raw result object (video results carry draft_cache etc.). */
  result?: Record<string, unknown>;
  progress?: number;
  detail?: string;
  terminal: boolean;
};

/** Parse a GET poll response (statuses from the verified StatusResponse enum). */
export function parsePollResponse(body: unknown): FluxPollParse {
  if (!body || typeof body !== "object") return { status: "unknown", terminal: false };
  const b = body as Record<string, unknown>;
  const raw = typeof b.status === "string" ? b.status.trim() : "";
  const norm = raw.toLowerCase();
  const progress = num(b.progress);
  const detailObj = b.details && typeof b.details === "object" ? JSON.stringify(b.details).slice(0, 300) : undefined;

  if (norm === "ready") {
    const result = b.result && typeof b.result === "object" ? (b.result as Record<string, unknown>) : null;
    const sample = result && typeof result.sample === "string" ? result.sample : "";
    if (!sample) return { status: "error", label: raw, terminal: true, detail: "Ready but no file URL was returned." };
    return { status: "ready", label: raw, sampleUrl: sample, result: result ?? undefined, terminal: true };
  }
  if (norm === "pending" || norm === "reasoning" || norm === "generating" || norm === "queued" || norm === "processing") {
    return { status: "pending", label: raw, progress, terminal: false };
  }
  if (norm.includes("moderat")) {
    return { status: "moderated", label: raw, terminal: true, detail: `${raw}. Try rewording, or raise the safety tolerance.` };
  }
  if (norm === "no card generated") {
    return { status: "error", label: raw, terminal: true, detail: "FLUX could not plan this request (No Card Generated). Try rewording the prompt." };
  }
  if (norm === "error" || norm.includes("not found") || norm.includes("failed")) {
    return { status: "error", label: raw, terminal: true, detail: detailObj ? `${raw}: ${detailObj}` : raw || "FLUX reported an error." };
  }
  return { status: "unknown", label: raw, terminal: false, detail: raw };
}

/** Parse GET /v1/credits -> { credits }. */
export function parseCredits(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  return num((body as Record<string, unknown>).credits) ?? null;
}

/** A readable error for a non-2xx submit (FastAPI 422 detail arrays included). */
export function describeFluxError(status: number, body: unknown, text = ""): string {
  if (status === 429) return "FLUX is busy (too many active tasks — the limit is 24). Wait a moment and try again.";
  if (status === 402) return "The BFL account is out of credits. Add credits at dashboard.bfl.ai and try again.";
  if (status === 401 || status === 403) return "BFL rejected the API key. Check it in Settings → Integrations.";
  const detail = body && typeof body === "object" ? (body as Record<string, unknown>).detail : undefined;
  let msg = "";
  if (Array.isArray(detail)) {
    msg = detail
      .map((d) => {
        if (!d || typeof d !== "object") return String(d);
        const o = d as Record<string, unknown>;
        const loc = Array.isArray(o.loc) ? o.loc.filter((x) => x !== "body").join(".") : "";
        return `${loc ? loc + ": " : ""}${String(o.msg ?? "")}`.trim();
      })
      .filter(Boolean)
      .join("; ");
  } else if (typeof detail === "string") msg = detail;
  else if (detail) msg = JSON.stringify(detail);
  if (!msg) msg = text.slice(0, 300) || "no details";
  const hint = status === 422 && /safety|tolerance/i.test(msg) ? " Lower the safety tolerance to a level your BFL organisation has approved." : "";
  return `FLUX rejected the request (${status}): ${msg.slice(0, 400)}${hint}`;
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

/**
 * SSRF / key-leak guard: we send the x-key header to polling URLs, so only
 * https URLs on bfl.ai (or the configured base host) are allowed.
 */
export function isTrustedPollingUrl(url: string, baseUrl?: string | null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "bfl.ai" || host.endsWith(".bfl.ai")) return true;
  try {
    return Boolean(baseUrl) && new URL(String(baseUrl)).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** A stable, human-friendly filename for the saved asset. */
export function fluxFilename(subject: string | undefined, ext: string): string {
  const slug =
    (subject || "flux-image")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "flux-image";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const clean = ext === "jpeg" ? "jpg" : ext.replace(/^\./, "");
  return `${slug}-${stamp}.${clean}`;
}

/** File extension for a downloaded mime type. */
export function extForMime(mime: string, fallback = "jpg"): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("mp4")) return "mp4";
  return fallback;
}

/** A short media title from the first words of a prompt. */
export function titleFromPrompt(prompt: string): string {
  const t = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "FLUX image";
  return t.length > 80 ? `${t.slice(0, 77).replace(/\s+\S*$/, "")}…` : t;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx)
// ---------------------------------------------------------------------------

export function __runFluxCoreTests(): string {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL flux-core: " + m);
    n++;
  };

  // models
  ok(fluxModel("flux-2-max").family === "flux2", "max family");
  ok(fluxModel("flux-2-flex").family === "flux2-flex", "flex family");
  ok(fluxModel("flux-3-image").sizing === "tier", "flux3 tier sizing");
  ok(fluxModel("flux-kontext-max").id === "flux-2-max", "legacy endpoint -> max");
  ok(fluxModel("v1/flux-2-pro").id === "flux-2-pro", "strips v1/");

  // ratio maths
  ok(parseRatio("5:4")?.w === 5 && parseRatio("1920x1080")?.h === 1080, "parse ratios");
  ok(parseRatio("abc") === null && parseRatio("0:1") === null && parseRatio("20:1") === null, "bad ratios rejected");
  for (const ar of FLUX_ASPECTS) {
    for (const mp of [1, 2, 4]) {
      const d = dimensionsForRatio(ar, mp)!;
      ok(d.width % 16 === 0 && d.height % 16 === 0, `x16 ${ar}@${mp}`);
      ok(d.width * d.height <= FLUX_MAX_PIXELS, `<=4MP ${ar}@${mp}`);
    }
  }
  const sq = dimensionsForRatio("1:1", 1)!;
  ok(sq.width === 1024 && sq.height === 1024, "1:1 @1MP = 1024²");

  // prompt is VERBATIM (the R62 root-cause fix)
  const prompt = "Line one, image 1 is the subject.\nLine two keeps its newline.";
  const r = buildFluxImageRequests({ model: "flux-2-max", prompt, aspect: "16:9" });
  ok(r.ok, "builds");
  if (r.ok) {
    const b = r.bodies[0];
    ok(b.prompt === prompt, "prompt sent verbatim incl. newline");
    ok(!String(b.prompt).includes("Avoid:") && !String(b.prompt).includes("centered"), "nothing appended");
    ok(b.safety_tolerance === 2, "BFL default safety 2");
    ok(b.output_format === "jpeg", "BFL default jpeg");
    ok(b.disable_pup === undefined && b.prompt_upsampling === undefined, "upsampling default emits nothing");
    ok(typeof b.width === "number" && (b.width as number) > (b.height as number), "16:9 landscape dims");
    ok(r.bodies.length === 1, "count default 1");
  }
  ok(!buildFluxImageRequests({ model: "flux-2-max", prompt: "   " }).ok, "blank prompt rejected");

  // auto = omit width/height (API default 0 = auto)
  const auto = buildFluxImageRequests({ model: "flux-2-pro", prompt: "x", aspect: "auto" });
  ok(auto.ok && auto.bodies[0].width === undefined, "auto omits dims");

  // safety 0..5 clamp, upsampling per family, flex knobs
  const s = buildFluxImageRequests({ model: "flux-2-max", prompt: "x", safetyTolerance: 9, promptUpsampling: false });
  ok(s.ok && s.bodies[0].safety_tolerance === 5 && s.bodies[0].disable_pup === true, "safety clamp + disable_pup");
  const fx = buildFluxImageRequests({ model: "flux-2-flex", prompt: "x", promptUpsampling: false, guidance: 20, steps: 0 });
  ok(fx.ok && fx.bodies[0].prompt_upsampling === false && fx.bodies[0].disable_pup === undefined, "flex prompt_upsampling");
  ok(fx.ok && fx.bodies[0].guidance === 10 && fx.bodies[0].steps === 1, "flex guidance/steps clamped");
  const mx = buildFluxImageRequests({ model: "flux-2-max", prompt: "x", guidance: 3 });
  ok(mx.ok && mx.bodies[0].guidance === undefined, "no flex knobs on max");

  // exact size
  ok(!buildFluxImageRequests({ model: "flux-2-max", prompt: "x", width: 2550, height: 3300 }).ok, "over 4MP rejected");
  ok(!buildFluxImageRequests({ model: "flux-2-max", prompt: "x", width: 32, height: 100 }).ok, "under 64 rejected");
  const ex = buildFluxImageRequests({ model: "flux-2-max", prompt: "x", width: 1080, height: 1350, aspect: "1:1" });
  ok(ex.ok && ex.bodies[0].width === 1080 && ex.bodies[0].height === 1350, "exact size beats aspect");

  // references
  const refs = Array.from({ length: 12 }, (_, i) => `https://a/${i}.png`);
  const r2 = buildFluxImageRequests({ model: "flux-2-max", prompt: "x", referenceImages: refs });
  ok(r2.ok && r2.bodies[0].input_image === refs[0] && r2.bodies[0].input_image_8 === refs[7], "refs 1..8 mapped");
  ok(r2.ok && r2.warnings.some((w) => w.includes("first 8")), "warns over 8");
  const r3 = buildFluxImageRequests({ model: "flux-3-image", prompt: "x", referenceImages: refs, aspect: "4:5", resolution: "2k", grounding: false, outputFormat: "png", seed: 4 });
  ok(r3.ok && Array.isArray(r3.bodies[0].images) && (r3.bodies[0].images as string[]).length === 10, "flux3 images[] cap 10");
  ok(r3.ok && r3.bodies[0].aspect_ratio === "4:5" && r3.bodies[0].resolution === "2k" && r3.bodies[0].grounding === false, "flux3 fields");
  ok(r3.ok && r3.bodies[0].output_format === undefined && r3.bodies[0].seed === undefined && r3.bodies[0].width === undefined, "flux3 strict: no format/seed/width");
  ok(r3.ok && r3.warnings.some((w) => w.includes("seed")), "flux3 warns seed ignored");
  ok(!buildFluxImageRequests({ model: "flux-3-image", prompt: "x", aspect: "5:3" }).ok, "flux3 rejects custom ratio");

  // count + seeds
  ok(normalizeCount(5) === 4 && normalizeCount(7) === 8 && normalizeCount(0) === 1 && normalizeCount(3) === 3, "count normalise");
  const c8 = buildFluxImageRequests({ model: "flux-2-max", prompt: "x", count: 8, seed: 10 });
  ok(c8.ok && c8.bodies.length === 8 && c8.bodies[0].seed === 10 && c8.bodies[7].seed === 17, "8 bodies, seeds step");

  // parsing
  const sub = parseSubmitResponse({ id: "a", polling_url: "https://api.bfl.ai/v1/get_result?id=a", cost: 7, output_mp: 1.05 });
  ok(sub.ok && sub.cost === 7 && sub.outputMp === 1.05, "submit parse");
  ok(!parseSubmitResponse({ id: "a" }).ok && !parseSubmitResponse(null).ok, "submit bad");
  ok(parsePollResponse({ status: "Reasoning" }).status === "pending", "reasoning pending");
  ok(parsePollResponse({ status: "Generating", progress: 0.4 }).progress === 0.4, "generating progress");
  const pr = parsePollResponse({ status: "Ready", result: { sample: "https://d/x.jpg", draft_cache: "https://d/c.bin" } });
  ok(pr.status === "ready" && pr.sampleUrl === "https://d/x.jpg" && pr.result?.draft_cache === "https://d/c.bin", "ready + raw result");
  ok(parsePollResponse({ status: "Ready", result: {} }).status === "error", "ready w/o sample");
  ok(parsePollResponse({ status: "Content Moderated" }).status === "moderated", "moderated");
  ok(parsePollResponse({ status: "No Card Generated" }).terminal, "no card terminal");
  ok(parsePollResponse({ status: "Task not found" }).status === "error", "not found");
  ok(parseCredits({ credits: 123.5 }) === 123.5 && parseCredits({}) === null, "credits");
  ok(describeFluxError(422, { detail: [{ loc: ["body", "safety_tolerance"], msg: "not approved" }] }).includes("safety_tolerance: not approved"), "422 detail");
  ok(describeFluxError(402, null).includes("credits"), "402");

  // urls / names
  ok(buildSubmitUrl("https://api.bfl.ai/", "flux-3-image") === "https://api.bfl.ai/v1/flux-3-image", "submit url");
  ok(buildSubmitUrl("", "") === "https://api.bfl.ai/v1/flux-2-max", "submit url default");
  ok(isTrustedPollingUrl("https://api.us1.bfl.ai/v1/get_result?id=1"), "bfl poll trusted");
  ok(!isTrustedPollingUrl("https://evil.example/bfl.ai") && !isTrustedPollingUrl("http://api.bfl.ai/x"), "untrusted poll");
  ok(isTrustedPollingUrl("https://proxy.example.com/r", "https://proxy.example.com"), "configured base host trusted");
  ok(/\.jpg$/.test(fluxFilename("Hello World", "jpeg")) && fluxFilename("Hello World", "png").startsWith("hello-world-"), "filename");
  ok(extForMime("image/png") === "png" && extForMime("video/mp4") === "mp4", "ext for mime");
  ok(titleFromPrompt("a\n b") === "a b" && titleFromPrompt("x".repeat(200)).length <= 80, "title");

  return `OK flux-core: ${n} assertions passed`;
}

/**
 * src/lib/marketing/flux-client.ts
 *
 * Server-side FLUX pipeline (R62). Network + storage only; all request shaping
 * lives in the pure flux-core.ts.
 *
 * VERIFIED (live OpenAPI + docs.bfl.ml):
 *   POST {base}/v1/{endpoint}  x-key  -> { id, polling_url, cost, input_mp, output_mp }
 *   GET  polling_url           x-key  -> { status, result, progress, details }
 *   GET  {base}/v1/credits     x-key  -> { credits }
 *   Image result.sample URLs expire after ~10 minutes and have no CORS, so we
 *   download and re-serve them from our media library. Video URLs last ~2 h.
 *   429 = too many active tasks (24), 402 = out of credits.
 */
import "server-only";

import { getFluxOverrides } from "@/lib/integrations/integration-credentials-store";
import { uploadMedia } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import {
  FLUX_DEFAULT_BASE_URL,
  buildFluxImageRequests,
  buildSubmitUrl,
  describeFluxError,
  extForMime,
  fluxFilename,
  isTrustedPollingUrl,
  parseCredits,
  parsePollResponse,
  parseSubmitResponse,
  titleFromPrompt,
  type FluxBody,
  type FluxImageSettings,
  type FluxPollParse,
} from "./flux-core";

/** Thrown when FLUX credentials are not configured. */
export class FluxNotConfiguredError extends Error {
  constructor() {
    super("FLUX is not configured. Add your Black Forest Labs API key in Settings → Integrations.");
    this.name = "FluxNotConfiguredError";
  }
}

type FluxCtx = { apiKey: string; baseUrl: string; defaultModel: string };

async function fluxContext(): Promise<FluxCtx | null> {
  const o = await getFluxOverrides();
  const apiKey = (o.apiKey ?? "").trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: (o.baseUrl ?? "").trim() || FLUX_DEFAULT_BASE_URL, defaultModel: o.endpoint || "flux-2-max" };
}

const headersFor = (apiKey: string) => ({ "Content-Type": "application/json", accept: "application/json", "x-key": apiKey });

/** Whether the FLUX pipeline currently has an API key (DB over env). */
export async function isFluxConfigured(): Promise<boolean> {
  return (await fluxContext()) !== null;
}

/** The model chosen on the Integrations page (used as the studio default). */
export async function getFluxDefaultModel(): Promise<string> {
  const o = await getFluxOverrides();
  return o.endpoint || "flux-2-max";
}

/** Current BFL credit balance (null when unavailable). 1 credit = $0.01. */
export async function getFluxCredits(): Promise<number | null> {
  const ctx = await fluxContext();
  if (!ctx) return null;
  try {
    const res = await fetch(`${ctx.baseUrl.replace(/\/+$/, "")}/v1/credits`, { headers: headersFor(ctx.apiKey), cache: "no-store" });
    if (!res.ok) return null;
    return parseCredits(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

export type FluxSubmitted = { ok: true; id: string; pollingUrl: string; cost?: number; outputMp?: number } | { ok: false; error: string };

/** Submit one task. Never throws. */
export async function submitFluxTask(endpoint: string, body: FluxBody | Record<string, unknown>): Promise<FluxSubmitted> {
  const ctx = await fluxContext();
  if (!ctx) return { ok: false, error: new FluxNotConfiguredError().message };
  try {
    const res = await fetch(buildSubmitUrl(ctx.baseUrl, endpoint), {
      method: "POST",
      headers: headersFor(ctx.apiKey),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) return { ok: false, error: describeFluxError(res.status, json, text) };
    const sub = parseSubmitResponse(json);
    if (!sub.ok) return sub;
    if (!isTrustedPollingUrl(sub.pollingUrl, ctx.baseUrl)) return { ok: false, error: "FLUX returned an unexpected polling URL." };
    return { ok: true, id: sub.id, pollingUrl: sub.pollingUrl, cost: sub.cost, outputMp: sub.outputMp };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `FLUX request error: ${err.message}` : "FLUX request error." };
  }
}

/** Poll a task once. Never throws (network hiccups come back as "unknown"). */
export async function pollFluxTask(pollingUrl: string): Promise<FluxPollParse> {
  const ctx = await fluxContext();
  if (!ctx) return { status: "error", terminal: true, detail: new FluxNotConfiguredError().message };
  if (!isTrustedPollingUrl(pollingUrl, ctx.baseUrl)) return { status: "error", terminal: true, detail: "Untrusted polling URL." };
  try {
    const res = await fetch(pollingUrl, { headers: headersFor(ctx.apiKey), cache: "no-store" });
    const json = await res.json().catch(() => null);
    return parsePollResponse(json);
  } catch {
    return { status: "unknown", terminal: false };
  }
}

export type FluxCheckResult =
  | { state: "pending"; label?: string; progress?: number }
  | { state: "ready"; asset: MediaAsset; result?: Record<string, unknown> }
  | { state: "failed"; error: string };

/**
 * Poll a task ONCE (the browser drives the loop, so no function timeout) and,
 * when Ready, save the file. The polling URL is re-validated against bfl.ai
 * hosts and the download URL always comes from BFL's own response, never from
 * the browser (SSRF-safe; the x-key only ever goes to BFL).
 */
export async function checkFluxTask(input: {
  pollingUrl: string;
  kind: "image" | "video";
  prompt: string;
  uploadedBy: string | null;
  tags?: string[];
}): Promise<FluxCheckResult> {
  const p = await pollFluxTask(input.pollingUrl);
  if (p.status === "ready" && p.sampleUrl) {
    try {
      const asset = await saveFluxResult({ url: p.sampleUrl, kind: input.kind, prompt: input.prompt, uploadedBy: input.uploadedBy, tags: input.tags });
      return { state: "ready", asset, result: p.result };
    } catch (err) {
      return { state: "failed", error: err instanceof Error ? err.message : "Saving to the media library failed." };
    }
  }
  if (p.terminal) return { state: "failed", error: p.detail ?? "FLUX reported an error." };
  return { state: "pending", label: p.label, progress: p.progress };
}

/** Download a finished FLUX file and save it into the media library as a DRAFT. */
export async function saveFluxResult(input: {
  url: string;
  kind: "image" | "video";
  prompt: string;
  uploadedBy: string | null;
  tags?: string[];
  description?: string;
}): Promise<MediaAsset> {
  const res = await fetch(input.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Downloading the result failed (${res.status}). Result links expire — generate again.`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const fallback = input.kind === "video" ? "video/mp4" : "image/jpeg";
  let mimeType = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (!mimeType.startsWith(input.kind === "video" ? "video/" : "image/")) mimeType = fallback;
  const title = titleFromPrompt(input.prompt);
  return uploadMedia({
    buffer,
    filename: fluxFilename(title, extForMime(mimeType, input.kind === "video" ? "mp4" : "jpg")),
    mimeType,
    title,
    description: input.description ?? input.prompt.slice(0, 2000),
    usageType: "marketing",
    tags: Array.from(new Set([...(input.tags ?? []), "flux", "ai-generated", input.kind === "video" ? "flux-video" : "flux-image"])),
    uploadedBy: input.uploadedBy,
    status: "draft",
    optimize: false, // keep the exact format/quality the user chose
  });
}

export type FluxSubmittedTask = { ok: true; id: string; pollingUrl: string; seed?: number; cost?: number; outputMp?: number } | { ok: false; error: string };

export type SubmitFluxImagesResult =
  | { ok: true; model: string; width?: number; height?: number; warnings: string[]; prompt: string; tasks: FluxSubmittedTask[] }
  | { ok: false; error: string };

/**
 * Submit 1–8 image tasks in parallel (one task per image — how the Playground
 * runs batches). The browser then polls each task; see pollFluxTask + save.
 */
export async function submitFluxImages(settings: FluxImageSettings): Promise<SubmitFluxImagesResult> {
  const ctx = await fluxContext();
  if (!ctx) return { ok: false, error: new FluxNotConfiguredError().message };
  const built = buildFluxImageRequests({ ...settings, model: settings.model || ctx.defaultModel });
  if (!built.ok) return built;
  const tasks = await Promise.all(
    built.bodies.map(async (body): Promise<FluxSubmittedTask> => {
      const sub = await submitFluxTask(built.model.id, body);
      if (!sub.ok) return sub;
      return { ...sub, seed: typeof body.seed === "number" ? body.seed : undefined };
    }),
  );
  return { ok: true, model: built.model.id, width: built.width, height: built.height, warnings: built.warnings, prompt: String(built.bodies[0].prompt), tasks };
}

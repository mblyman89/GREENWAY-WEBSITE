/**
 * src/lib/marketing/flux-client.ts
 *
 * Server-side FLUX 2 image pipeline (Slice A / item 19). Submits a prompt to
 * the Black Forest Labs API, polls until the image is ready, downloads it, and
 * saves it straight into the media library (as a DRAFT — AI output is
 * employee-validated before publish). No-op / clear error when unconfigured.
 *
 * VERIFIED against docs.bfl.ai:
 *   POST {base}/v1/{endpoint}  header x-key   body {prompt,width,height,...}  -> {id, polling_url}
 *   GET  polling_url           header x-key                                   -> {status, result}
 *   result.sample is a signed URL valid ~10 minutes; BFL recommends downloading
 *   and re-serving (delivery URLs have no CORS), which is exactly what saving
 *   into our media library does. Rate limit 429 (24 active tasks); credits 402.
 *
 * PURE logic (request/response shaping, dimensions, filenames) lives in
 * flux-core.ts and is unit-tested; this module only does the network + storage.
 */
import "server-only";

import { getFluxOverrides } from "@/lib/integrations/integration-credentials-store";
import { uploadMedia } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import type { CreativeBrief } from "./midjourney-core";
import {
  buildFluxRequest,
  buildSubmitUrl,
  fluxFilename,
  parsePollResponse,
  parseSubmitResponse,
  type FluxRequest,
} from "./flux-core";

/** Thrown when FLUX credentials are not configured. */
export class FluxNotConfiguredError extends Error {
  constructor() {
    super("FLUX is not configured. Add your Black Forest Labs API key in Settings → Integrations.");
    this.name = "FluxNotConfiguredError";
  }
}

/** Whether the FLUX pipeline currently has an API key (DB over env). */
export async function isFluxConfigured(): Promise<boolean> {
  const o = await getFluxOverrides();
  return Boolean(o.apiKey && o.apiKey.trim());
}

export type GenerateFluxInput = {
  brief: CreativeBrief;
  /** Media metadata for the saved asset. */
  usageType?: string;
  title?: string;
  altText?: string;
  tags?: string[];
  uploadedBy: string | null;
  outputFormat?: "png" | "jpeg";
  safetyTolerance?: number;
};

export type GenerateFluxResult =
  | {
      ok: true;
      asset: MediaAsset;
      request: FluxRequest;
      endpoint: string;
      warnings: string[];
    }
  | { ok: false; error: string; code?: "unconfigured" | "moderated" | "rate_limit" | "credits" | "timeout" | "api" };

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 120_000; // 2 minutes — well within the 10-min signed-URL TTL.

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate one image with FLUX 2 and save it to the media library.
 * Returns a clear, non-throwing result the server action can surface.
 */
export async function generateFluxImage(input: GenerateFluxInput): Promise<GenerateFluxResult> {
  const overrides = await getFluxOverrides();
  const apiKey = (overrides.apiKey ?? "").trim();
  if (!apiKey) return { ok: false, error: new FluxNotConfiguredError().message, code: "unconfigured" };

  const built = buildFluxRequest(input.brief, {
    outputFormat: input.outputFormat,
    safetyTolerance: input.safetyTolerance,
  });
  if (!built.ok) return { ok: false, error: built.error, code: "api" };

  const submitUrl = buildSubmitUrl(overrides.baseUrl ?? "", overrides.endpoint);
  const headers = { "Content-Type": "application/json", accept: "application/json", "x-key": apiKey };

  // 1) Submit ---------------------------------------------------------------
  let submitBody: unknown;
  try {
    const res = await fetch(submitUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(built.request),
      cache: "no-store",
    });
    if (res.status === 429) return { ok: false, error: "FLUX is busy (too many active tasks). Try again shortly.", code: "rate_limit" };
    if (res.status === 402) return { ok: false, error: "FLUX account is out of credits. Add funds and try again.", code: "credits" };
    const text = await res.text();
    try {
      submitBody = text ? JSON.parse(text) : null;
    } catch {
      submitBody = null;
    }
    if (!res.ok) {
      const detail = typeof submitBody === "object" && submitBody
        ? JSON.stringify((submitBody as Record<string, unknown>).detail ?? submitBody)
        : text.slice(0, 300);
      return { ok: false, error: `FLUX submit failed (${res.status}): ${detail}`, code: "api" };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `FLUX request error: ${err.message}` : "FLUX request error.", code: "api" };
  }

  const submit = parseSubmitResponse(submitBody);
  if (!submit.ok) return { ok: false, error: submit.error, code: "api" };

  // 2) Poll -----------------------------------------------------------------
  const started = Date.now();
  let sampleUrl = "";
  while (Date.now() - started < MAX_POLL_MS) {
    await sleep(POLL_INTERVAL_MS);
    let pollBody: unknown;
    try {
      const res = await fetch(submit.pollingUrl, { method: "GET", headers, cache: "no-store" });
      const text = await res.text();
      try {
        pollBody = text ? JSON.parse(text) : null;
      } catch {
        pollBody = null;
      }
    } catch {
      continue; // transient network hiccup — keep polling within the budget
    }
    const parsed = parsePollResponse(pollBody);
    if (parsed.status === "ready" && parsed.sampleUrl) {
      sampleUrl = parsed.sampleUrl;
      break;
    }
    if (parsed.status === "moderated") return { ok: false, error: `Image was moderated by FLUX: ${parsed.detail ?? "content not allowed"}.`, code: "moderated" };
    if (parsed.status === "error" && parsed.terminal) return { ok: false, error: parsed.detail ?? "FLUX reported an error.", code: "api" };
    // pending / unknown -> keep polling
  }
  if (!sampleUrl) return { ok: false, error: "FLUX timed out before the image was ready. Try again.", code: "timeout" };

  // 3) Download the signed image (BFL recommends re-serving it) --------------
  let buffer: Buffer;
  let mimeType: string;
  try {
    const imgRes = await fetch(sampleUrl, { cache: "no-store" });
    if (!imgRes.ok) return { ok: false, error: `Failed to download the generated image (${imgRes.status}).`, code: "api" };
    const arrayBuf = await imgRes.arrayBuffer();
    buffer = Buffer.from(arrayBuf);
    mimeType = imgRes.headers.get("content-type") || (built.request.output_format === "jpeg" ? "image/jpeg" : "image/png");
    if (!mimeType.startsWith("image/")) {
      mimeType = built.request.output_format === "jpeg" ? "image/jpeg" : "image/png";
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Image download error: ${err.message}` : "Image download error.", code: "api" };
  }

  // 4) Save to media library as a DRAFT (AI output validated before publish) -
  try {
    const filename = fluxFilename(input.title || input.brief.subject, built.request.output_format);
    const asset = await uploadMedia({
      buffer,
      filename,
      mimeType,
      title: input.title || input.brief.subject || "FLUX image",
      altText: input.altText,
      usageType: input.usageType,
      tags: Array.from(new Set([...(input.tags ?? []), "flux", "ai-generated"])),
      uploadedBy: input.uploadedBy,
      status: "draft",
    });
    return { ok: true, asset, request: built.request, endpoint: overrides.endpoint, warnings: built.warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Saving to media library failed: ${err.message}` : "Saving to media library failed.", code: "api" };
  }
}

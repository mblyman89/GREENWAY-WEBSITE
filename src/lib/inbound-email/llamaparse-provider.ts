/**
 * src/lib/inbound-email/llamaparse-provider.ts  (LlamaParse PR-1)
 *
 * SERVER-ONLY wiring to LlamaCloud's LlamaParse document-parsing API. This is
 * the ONLY file in the initiative that touches the network / env / ledger; the
 * request/response SHAPING logic lives in the pure `llamaparse-core.ts` so it
 * can be unit-tested without any I/O.
 *
 * DESIGN (matches the house AI provider in src/lib/ai/provider.ts):
 *  - a THIN fetch to the REST endpoint (no extra npm dependency, no OOM-build
 *    risk) — same pattern as provider.ts calling chat/completions;
 *  - reads a single server env var `LLAMA_CLOUD_API_KEY` (the value Michael
 *    pastes into Vercel). US region needs NO url var; EU users may set the
 *    optional `LLAMA_CLOUD_BASE_URL`;
 *  - GRACEFULLY NO-OPS when the key is unset: `isLlamaParseConfigured` is
 *    false and `parsePdf()` returns a clear, non-throwing result so the intake
 *    never hard-fails just because the key has not been added yet;
 *  - logs one best-effort row to the `ai_usage` ledger per parse for cost
 *    visibility (feature "llamaparse"), never throws from logging;
 *  - PRIMARY path is LlamaParse. `parsePdfWithFallback()` keeps the old
 *    text-only unpdf reader as a SILENT LAST RESORT only when LlamaCloud is
 *    unreachable (an outage / missing key), so the pipeline degrades instead
 *    of dying. This is the "always use LlamaParse, unpdf only on outage"
 *    decision Michael approved.
 *
 * IMPORTANT: PR-1 only WIRES the provider. It is NOT yet called from the live
 * intake flow — that is PR-2 (inbound-store.ts). Shipping the provider alone
 * changes no live behavior, so it is a safe foundation.
 *
 * Never import this into a client component.
 */
import "server-only";
import { logAiUsage } from "@/lib/ai/usage";
import { extractPdfText } from "@/lib/inventory/pdf-extract";
import {
  buildParseRequest,
  normalizeParseResult,
  gateConfidence,
  estimateCredits,
  type BuildParseOptions,
  type NormalizedParse,
  type ConfidenceGate,
} from "@/lib/inbound-email/llamaparse-core";

// BUG-1 FIX (call-time env read): read LLAMA_CLOUD_API_KEY / LLAMA_CLOUD_BASE_URL
// at CALL TIME, not at module load. Vercel injects env vars per running
// instance; a module-load `const` froze the key at cold-start, so re-entering
// the key in the dashboard WITHOUT a fresh deploy left the warm function using
// the stale/empty value (the exact "worked, then went dark" symptom). Reading
// process.env inside these helpers means a key change takes effect immediately.
function llamaApiKey(): string {
  return process.env.LLAMA_CLOUD_API_KEY ?? "";
}
// US region default; EU users set LLAMA_CLOUD_BASE_URL=https://api.cloud.eu.llamaindex.ai
function llamaBaseUrl(): string {
  return (process.env.LLAMA_CLOUD_BASE_URL ?? "https://api.cloud.llamaindex.ai").replace(
    /\/+$/,
    "",
  );
}

/** True when the LlamaCloud key is configured. Evaluated at CALL TIME so a
 * Vercel key change is picked up without a redeploy. Callers soft-disable when
 * this returns false. */
export function isLlamaParseConfigured(): boolean {
  return Boolean(llamaApiKey());
}

/** Provenance for the usage ledger. */
export type LlamaParseContext = {
  feature?: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
};

/** The outcome of a parse attempt. `via` says which engine produced it. */
export type LlamaParseOutcome = NormalizedParse & {
  /** "llamaparse" (primary), "unpdf" (outage fallback), or "none". */
  via: "llamaparse" | "unpdf" | "none";
  /** Never-guess confidence gate result. */
  gate: ConfidenceGate;
  /** Set when the parse could not run (e.g. key missing, outage). */
  error: string | null;
};

/** Decode a base64 string to bytes (server runtime has Buffer). */
function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** An empty, safe outcome for the no-op / error paths. */
function emptyOutcome(
  via: LlamaParseOutcome["via"],
  error: string | null,
  note: string | null,
): LlamaParseOutcome {
  return {
    ok: false,
    text: "",
    pages: [],
    confidence: null,
    pageCount: 0,
    note,
    via,
    gate: { trusted: false, reason: error ?? "no text" },
    error,
  };
}

/**
 * Poll a LlamaCloud parse job until it finishes. LlamaParse is asynchronous:
 * upload returns a job id, then we poll status, then fetch the markdown result.
 * Bounded by `maxWaitMs` so a stuck job never hangs the intake.
 */
async function pollJob(
  jobId: string,
  headers: Record<string, string>,
  maxWaitMs = 90_000,
): Promise<unknown> {
  const started = Date.now();
  const base = llamaBaseUrl();
  const statusUrl = `${base}/api/v1/parsing/job/${jobId}`;
  const resultUrl = `${base}/api/v1/parsing/job/${jobId}/result/markdown`;
  // Small backoff loop.
  while (Date.now() - started < maxWaitMs) {
    const s = await fetch(statusUrl, { headers });
    if (!s.ok) throw new Error(`LlamaParse status ${s.status}`);
    const body = (await s.json()) as { status?: string };
    const status = String(body.status ?? "").toUpperCase();
    if (status === "SUCCESS") {
      const r = await fetch(resultUrl, { headers });
      if (!r.ok) throw new Error(`LlamaParse result ${r.status}`);
      return await r.json();
    }
    if (status === "ERROR" || status === "FAILED" || status === "CANCELLED") {
      throw new Error(`LlamaParse job ${status.toLowerCase()}`);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("LlamaParse job timed out");
}

/**
 * Parse a PDF via LlamaParse ONLY. Returns a NormalizedParse-shaped outcome.
 * - No key → graceful no-op (ok:false, via:"none", error set) — never throws.
 * - HTTP 402 (credits exhausted) or any network error → ok:false with error;
 *   the caller can then decide to fall back (see parsePdfWithFallback).
 * Logs one ai_usage row (best-effort).
 */
export async function parsePdf(
  bytes: Uint8Array,
  opts: BuildParseOptions = {},
  ctx: LlamaParseContext = {},
): Promise<LlamaParseOutcome> {
  const apiKey = llamaApiKey();
  if (!apiKey) {
    return emptyOutcome("none", "LLAMA_CLOUD_API_KEY not set", "provider not configured");
  }
  const base = llamaBaseUrl();

  const plan = buildParseRequest(opts);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  try {
    // 1) Upload the file + parse options as multipart/form-data.
    const form = new FormData();
    const blob = new Blob([bytes.slice()], { type: "application/pdf" });
    form.append("file", blob, plan.filename);
    for (const [k, v] of Object.entries(plan.fields)) form.append(k, v);

    const up = await fetch(`${base}/api/v1/parsing/upload`, {
      method: "POST",
      headers, // do NOT set Content-Type; fetch sets the multipart boundary
      body: form,
    });
    if (up.status === 402) {
      await logAiUsage({
        feature: ctx.feature ?? "llamaparse",
        entityType: ctx.entityType ?? null,
        entityId: ctx.entityId ?? null,
        model: `llamaparse-${plan.tier}`,
        ok: false,
        errorNote: "402 credits exhausted",
        actorId: ctx.actorId ?? null,
        actorEmail: ctx.actorEmail ?? null,
      });
      return emptyOutcome("llamaparse", "credits exhausted (HTTP 402)", "402");
    }
    if (!up.ok) throw new Error(`LlamaParse upload ${up.status}`);
    const upBody = (await up.json()) as { id?: string };
    const jobId = String(upBody.id ?? "");
    if (!jobId) throw new Error("LlamaParse upload returned no job id");

    // 2) Poll to completion, then normalize the markdown result.
    const raw = await pollJob(jobId, headers);
    const norm = normalizeParseResult(raw);
    const gate = gateConfidence(norm);

    // 3) Best-effort usage ledger (credits estimate as "tokens" for visibility).
    await logAiUsage({
      feature: ctx.feature ?? "llamaparse",
      entityType: ctx.entityType ?? null,
      entityId: ctx.entityId ?? null,
      model: `llamaparse-${plan.tier}`,
      totalTokens: estimateCredits(norm.pageCount, plan.tier),
      estimated: true,
      ok: norm.ok,
      errorNote: norm.ok ? null : (norm.note ?? "empty parse"),
      actorId: ctx.actorId ?? null,
      actorEmail: ctx.actorEmail ?? null,
    });

    return { ...norm, via: "llamaparse", gate, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAiUsage({
      feature: ctx.feature ?? "llamaparse",
      entityType: ctx.entityType ?? null,
      entityId: ctx.entityId ?? null,
      model: `llamaparse-${plan.tier}`,
      ok: false,
      errorNote: msg,
      actorId: ctx.actorId ?? null,
      actorEmail: ctx.actorEmail ?? null,
    });
    return emptyOutcome("llamaparse", msg, "parse failed");
  }
}

/** Convenience: parse from a base64 attachment string. */
export async function parsePdfFromBase64(
  base64: string,
  opts: BuildParseOptions = {},
  ctx: LlamaParseContext = {},
): Promise<LlamaParseOutcome> {
  return parsePdf(base64ToBytes(base64), opts, ctx);
}

/**
 * PRIMARY-LlamaParse with SILENT unpdf LAST-RESORT.
 *
 * Michael's decision: ALWAYS use LlamaParse (our free credits vastly exceed our
 * volume). Only if LlamaParse could not run at all — key missing, outage, or
 * credits exhausted — do we fall back to the old text-only unpdf reader so the
 * intake degrades gracefully instead of hard-failing. If LlamaParse ran and
 * simply found no text, we do NOT fall back (a scanned image has no text layer
 * for unpdf either) — we report ok:false honestly so nothing is false-flagged.
 */
export async function parsePdfWithFallback(
  bytes: Uint8Array,
  opts: BuildParseOptions = {},
  ctx: LlamaParseContext = {},
): Promise<LlamaParseOutcome> {
  const primary = await parsePdf(bytes, opts, ctx);
  // Fall back ONLY when LlamaParse could not run (not when it ran and was empty).
  const couldNotRun = primary.via === "none" || primary.error != null;
  if (primary.ok || !couldNotRun) return primary;

  try {
    const text = (await extractPdfText(bytes)).trim();
    if (!text) {
      return { ...primary, note: `${primary.note ?? primary.error}; unpdf fallback also empty` };
    }
    const norm = normalizeParseResult({ pages: [{ page: 1, md: text }] });
    return {
      ...norm,
      via: "unpdf",
      gate: gateConfidence(norm),
      error: null,
      note: `LlamaParse unavailable (${primary.error}); used unpdf text-only fallback`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...primary, note: `${primary.error}; unpdf fallback failed: ${msg}` };
  }
}

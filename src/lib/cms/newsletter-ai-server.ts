/**
 * src/lib/cms/newsletter-ai-server.ts
 *
 * D238 N-8b (SOP-22 G-118): the canvas AI studio, server side.
 *   - Build with AI / Improve this section / Subject ideas: the configured
 *     text AI (GPT or Gemini through the OpenAI-compatible endpoint), from
 *     this week's facts only, checked by the pure copy check AND the shared
 *     compliance check before anything is returned to the editor.
 *   - Pictures: edit or create with GPT Image (OpenAI /images/edits and
 *     /images/generations; transparent background for "Remove background"),
 *     Gemini Nano Banana (Interactions API) or FLUX (Black Forest Labs; the
 *     browser polls, like the FLUX studio). Results are saved to Media as new
 *     files; originals are never changed.
 *
 * Every call checks the monthly AI budget first and is logged to the AI usage
 * ledger. Keys stay on the server.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId, geminiApiKey } from "@/lib/ai/provider";
import { getBudgetStatus } from "@/lib/ai/router";
import { logAiUsage } from "@/lib/ai/usage";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { greenwayBusiness } from "@/content/business";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { isFluxConfigured, submitFluxImages, checkFluxTask } from "@/lib/marketing/flux-client";
import { getThisWeekFeed } from "./this-week-feed-server";
import { fetchCapped, recentPostLinks } from "./newsletter-canvas-server";
import { isProbeableUrl, type CanvasBlock, type CanvasDoc } from "./newsletter-canvas-core";
import {
  AI_IMAGE_INPUT_MAX_EDGE,
  applyImproved,
  applyLayout,
  aspectOf,
  availableEngines,
  buildImprovePrompt,
  buildLayoutPrompt,
  buildSubjectPrompt,
  canvasFacts,
  checkAiCopy,
  checkImageAsk,
  fullImagePrompt,
  geminiImageBody,
  gptEditBody,
  gptGenerateBody,
  layoutText,
  normalizeIdeas,
  normalizeLayout,
  parseGeminiImage,
  parseGptImage,
  type AiIssue,
  type ImageAspectKey,
  type ImageEngine,
} from "./newsletter-ai-core";

const SITE = greenwayBusiness.website.replace(/\/$/, "");
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY ?? "";
const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
/** GPT Image model for edits and new pictures (override with AI_IMAGE_MODEL). */
export const GPT_IMAGE_MODEL = process.env.AI_IMAGE_MODEL ?? "gpt-image-2";
/** Gemini picture model (override with AI_GEMINI_IMAGE_MODEL). */
export const GEMINI_IMAGE_MODEL = process.env.AI_GEMINI_IMAGE_MODEL ?? "gemini-nano-banana-2.1";
const GEMINI_URL = process.env.AI_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/interactions";
const IMAGE_TIMEOUT_MS = 150_000;

type Actor = { actorId: string | null; actorEmail: string | null };
type Fail = { ok: false; error: string };

async function budgetBlock(): Promise<Fail | null> {
  const b = await getBudgetStatus();
  return b.blocked ? { ok: false, error: b.reason ?? "The monthly AI budget is used up." } : null;
}

const NOT_CONFIGURED = "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) on the deployment.";

async function weekFacts(postId: string | null): Promise<{ facts: string[]; partial: boolean }> {
  const [{ feed, partial }, posts] = await Promise.all([getThisWeekFeed({ withBelowCost: true }), recentPostLinks(postId)]);
  return { facts: canvasFacts(feed, posts, SITE), partial };
}

/** Pure copy check + the shared compliance check (block-level flags are must-fix). */
function fullCopyCheck(text: string, facts: string): AiIssue[] {
  const issues = checkAiCopy(text, facts);
  const c = checkCompliance(text);
  for (const f of c.blockingFlags) issues.push({ level: "must-fix", text: `Compliance: ${f}.` });
  for (const f of c.flags.filter((x) => x.endsWith("(heads-up)"))) issues.push({ level: "heads-up", text: `Compliance: ${f}` });
  return issues;
}

// ── Words ──────────────────────────────────────────────────────────────────

export type BuildOut = { ok: true; doc: CanvasDoc; issues: AiIssue[]; partial: boolean; model: string } | Fail;

export async function aiBuildCanvas(doc: CanvasDoc, postId: string, ask: string, actor: Actor): Promise<BuildOut> {
  if (!isAiConfigured) return { ok: false, error: NOT_CONFIGURED };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const { facts, partial } = await weekFacts(postId);
  const headline = (doc.blocks.find((b) => b.type === "headline") as { text?: string } | undefined)?.text ?? "";
  const raw = await generateJSON<unknown>({
    system: COMPLIANCE_SYSTEM,
    user: buildLayoutPrompt(facts, ask, { subject: doc.subject, headline }),
    temperature: 0.6,
    maxTokens: 1400,
    context: { feature: "newsletter.ai.build", entityType: "blog_post", entityId: postId, ...actor },
  });
  const layout = normalizeLayout(raw);
  if (!layout.headline && !layout.intro && !layout.subject) return { ok: false, error: "The AI answer was empty. Try again." };
  const issues = fullCopyCheck(layoutText(layout), facts.join("\n"));
  if (issues.some((i) => i.level === "must-fix")) return { ok: false, error: `The AI draft broke the rules and was not applied: ${issues.filter((i) => i.level === "must-fix").map((i) => i.text).join(" ")} Try again.` };
  return { ok: true, doc: applyLayout(doc, layout, SITE), issues, partial, model: aiModelId };
}

export type ImproveOut = { ok: true; block: CanvasBlock; changed: string[]; issues: AiIssue[] } | Fail;

export async function aiImproveBlock(block: CanvasBlock, postId: string, ask: string, actor: Actor): Promise<ImproveOut> {
  if (!isAiConfigured) return { ok: false, error: NOT_CONFIGURED };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const { facts } = await weekFacts(postId);
  const prompt = buildImprovePrompt(block, ask, facts);
  if (!prompt) return { ok: false, error: "This section has no words the AI can change (review quotes are the customer's own words)." };
  const raw = await generateJSON<unknown>({
    system: COMPLIANCE_SYSTEM,
    user: prompt,
    temperature: 0.5,
    maxTokens: 1200,
    context: { feature: "newsletter.ai.improve", entityType: "blog_post", entityId: postId, ...actor },
  });
  const r = applyImproved(block, raw);
  if (!r.changed.length) return { ok: false, error: "The AI did not change anything. Ask differently." };
  // Amounts and links may come from the facts OR from the section itself.
  const issues = fullCopyCheck(r.text, `${facts.join("\n")}\n${JSON.stringify(block)}`);
  if (issues.some((i) => i.level === "must-fix")) return { ok: false, error: `The AI rewrite broke the rules and was not applied: ${issues.filter((i) => i.level === "must-fix").map((i) => i.text).join(" ")}` };
  return { ok: true, block: r.block, changed: r.changed, issues };
}

export type IdeasOut = { ok: true; ideas: { subject: string; preheader: string; issues: AiIssue[] }[] } | Fail;

export async function aiSubjectIdeas(doc: CanvasDoc, postId: string, actor: Actor): Promise<IdeasOut> {
  if (!isAiConfigured) return { ok: false, error: NOT_CONFIGURED };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const { facts } = await weekFacts(postId);
  const raw = await generateJSON<unknown>({
    system: COMPLIANCE_SYSTEM,
    user: buildSubjectPrompt(facts, doc.subject),
    temperature: 0.8,
    maxTokens: 700,
    context: { feature: "newsletter.ai.subjects", entityType: "blog_post", entityId: postId, ...actor },
  });
  const factText = facts.join("\n");
  const ideas = normalizeIdeas(raw)
    .map((i) => ({ ...i, issues: fullCopyCheck(`${i.subject}\n${i.preheader}`, factText) }))
    .filter((i) => !i.issues.some((x) => x.level === "must-fix"));
  if (!ideas.length) return { ok: false, error: "No usable ideas came back. Try again." };
  return { ok: true, ideas };
}

// ── Pictures ───────────────────────────────────────────────────────────────

export async function imageEngines(): Promise<ImageEngine[]> {
  const gem = /^AIza|.{20,}/.test(geminiApiKey()) && Boolean(process.env.AI_GEMINI_API_KEY || /^gemini/i.test(process.env.AI_MODEL_HEAVY ?? ""));
  return availableEngines({ openaiImage: Boolean(OPENAI_KEY) && !/generativelanguage/.test(OPENAI_BASE), gemini: gem, flux: await isFluxConfigured() });
}

/** Load a canvas picture and shrink it for the AI (PNG keeps transparency). */
async function loadInput(url: string): Promise<{ buf: Buffer; mime: string } | Fail> {
  if (!isProbeableUrl(url)) return { ok: false, error: "Pick a picture with a public https link first." };
  const r = await fetchCapped(url);
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(r.buf, { limitInputPixels: 8192 * 8192 }).rotate().resize({ width: AI_IMAGE_INPUT_MAX_EDGE, height: AI_IMAGE_INPUT_MAX_EDGE, fit: "inside", withoutEnlargement: true });
    const meta = await sharp(r.buf).metadata();
    if (meta.hasAlpha) return { buf: await img.png().toBuffer(), mime: "image/png" };
    return { buf: await img.jpeg({ quality: 90 }).toBuffer(), mime: "image/jpeg" };
  } catch {
    return { ok: false, error: "That file is not a picture the AI can read." };
  }
}

async function saveResult(b64: string, mime: string, title: string, engine: ImageEngine, uploadedBy: string | null): Promise<{ ok: true; url: string; mediaId: string } | Fail> {
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length < 100) return { ok: false, error: "The AI returned an empty picture." };
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const asset = await uploadMedia({
    buffer,
    filename: `newsletter-ai-${engine}-${Date.now().toString(36)}.${ext}`,
    mimeType: mime,
    usageType: "newsletter",
    tags: ["newsletter", "ai-generated", `ai-${engine}`],
    title: title.slice(0, 120),
    altText: "",
    uploadedBy,
    status: "published",
    optimize: false,
  });
  const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
  return url ? { ok: true, url, mediaId: asset.id } : { ok: false, error: "Saved, but the picture has no public link." };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), cache: "no-store" });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export type ImageOut =
  | { ok: true; kind: "done"; url: string; mediaId: string; engine: ImageEngine; transparent: boolean }
  | { ok: true; kind: "flux"; pollingUrl: string; prompt: string }
  | Fail;

/**
 * Edit the picture at `sourceUrl` (or make a new one when it is null) with
 * the chosen engine. "Remove background" on GPT asks for a transparent PNG.
 */
export async function aiImage(p: {
  engine: ImageEngine;
  ask: string;
  sourceUrl: string | null;
  aspect: ImageAspectKey;
  removeBackground: boolean;
  postId: string;
} & Actor): Promise<ImageOut> {
  const issues = checkImageAsk(p.ask);
  const must = issues.filter((i) => i.level === "must-fix");
  if (must.length) return { ok: false, error: must.map((i) => i.text).join(" ") };
  const engines = await imageEngines();
  if (!engines.includes(p.engine)) return { ok: false, error: `${p.engine === "flux" ? "FLUX is not set up (Settings > Integrations)." : p.engine === "gemini" ? "Gemini is not set up (AI_GEMINI_API_KEY)." : "GPT Image needs an OpenAI key (OPENAI_API_KEY)."}` };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const prompt = fullImagePrompt(p.ask);
  const ctx = { feature: `newsletter.ai.image.${p.engine}`, entityType: "blog_post", entityId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail };

  if (p.engine === "flux") {
    if (p.removeBackground) return { ok: false, error: "FLUX cannot make a see-through background. Use GPT Image for Remove background." };
    const refs = p.sourceUrl && isProbeableUrl(p.sourceUrl) ? [p.sourceUrl] : [];
    const sub = await submitFluxImages({ model: "", prompt, aspect: aspectOf(p.aspect).flux, count: 1, outputFormat: "jpeg", referenceImages: refs });
    if (!sub.ok) return sub;
    const t = sub.tasks[0];
    if (!t || !t.ok) return { ok: false, error: t && !t.ok ? t.error : "FLUX did not accept the task." };
    await logAiUsage({ ...ctx, model: sub.model, ok: true, estimated: true, errorNote: t.cost ? `credits ${t.cost}` : null });
    return { ok: true, kind: "flux", pollingUrl: t.pollingUrl, prompt };
  }

  const input = p.sourceUrl ? await loadInput(p.sourceUrl) : null;
  if (input && "ok" in input) return input;

  if (p.engine === "gpt") {
    const transparent = p.removeBackground;
    const body = input
      ? gptEditBody({ model: GPT_IMAGE_MODEL, prompt, imageDataUrl: `data:${input.mime};base64,${input.buf.toString("base64")}`, transparent })
      : gptGenerateBody({ model: GPT_IMAGE_MODEL, prompt, aspect: p.aspect });
    if (!input && transparent) body.background = "transparent";
    if (!input && transparent) {
      body.output_format = "png";
      delete body.output_compression;
    }
    const r = await postJson(`${OPENAI_BASE}/images/${input ? "edits" : "generations"}`, { Authorization: `Bearer ${OPENAI_KEY}` }, body).catch((e) => ({ status: 0, json: { error: { message: e instanceof Error ? e.message : "network error" } } }));
    const parsed = parseGptImage(r.json);
    const usage = (r.json as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    await logAiUsage({ ...ctx, model: GPT_IMAGE_MODEL, promptTokens: usage?.input_tokens ?? 0, completionTokens: usage?.output_tokens ?? 0, estimated: !usage, ok: parsed.ok, errorNote: parsed.ok ? null : `HTTP ${r.status}` });
    if (!parsed.ok) return { ok: false, error: `GPT Image: ${parsed.error}` };
    const saved = await saveResult(parsed.b64, parsed.mime, `AI ${transparent ? "cut-out" : "picture"}: ${p.ask}`, "gpt", p.actorId);
    return saved.ok ? { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, engine: "gpt", transparent } : saved;
  }

  // Gemini (Nano Banana). It cannot make a true see-through PNG, so Remove
  // background asks for a pure white backdrop.
  const gPrompt = p.removeBackground ? `${prompt}\nPut the subject on a plain pure white (#FFFFFF) background.` : prompt;
  const body = geminiImageBody({ model: GEMINI_IMAGE_MODEL, prompt: gPrompt, image: input ? { mime: input.mime, b64: input.buf.toString("base64") } : null, aspect: input ? null : p.aspect });
  const r = await postJson(GEMINI_URL, { "x-goog-api-key": geminiApiKey(), "Api-Revision": "2026-05-20" }, body).catch((e) => ({ status: 0, json: { error: { message: e instanceof Error ? e.message : "network error" } } }));
  const parsed = parseGeminiImage(r.json);
  await logAiUsage({ ...ctx, model: GEMINI_IMAGE_MODEL, estimated: true, ok: parsed.ok, errorNote: parsed.ok ? null : `HTTP ${r.status}` });
  if (!parsed.ok) return { ok: false, error: `Gemini: ${parsed.error}` };
  const saved = await saveResult(parsed.b64, parsed.mime, `AI picture: ${p.ask}`, "gemini", p.actorId);
  return saved.ok ? { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, engine: "gemini", transparent: false } : saved;
}

export type FluxPollOut = { state: "pending"; progress?: number } | { state: "ready"; url: string; mediaId: string } | { state: "failed"; error: string };

/** Poll a FLUX task once (the browser repeats); the result is saved to Media. */
export async function pollFluxForCanvas(pollingUrl: string, prompt: string, uploadedBy: string | null): Promise<FluxPollOut> {
  const r = await checkFluxTask({ pollingUrl, kind: "image", prompt, uploadedBy, tags: ["newsletter"] });
  if (r.state === "pending") return { state: "pending", progress: r.progress };
  if (r.state === "failed") return r;
  const url = r.asset.public_url ?? publicUrlForKey(r.asset.storage_key) ?? "";
  return url ? { state: "ready", url, mediaId: r.asset.id } : { state: "failed", error: "Saved, but the picture has no public link." };
}

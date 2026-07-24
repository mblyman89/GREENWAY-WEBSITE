/**
 * src/lib/regulatory/regulatory-ingest.ts  (SLICE 37)
 *
 * The ingestion service for Regulatory Watch — shared by the daily cron
 * (/api/cron/regulatory-watch), the manual "fetch this URL" action on the
 * page, and the inbound-email funnel.
 *
 * What it does:
 *   1. pollGovDeliveryFeed() — fetch the GovDelivery widget JSON (verified
 *      live: content.govdelivery.com/accounts/WALCB/widgets/WALCB_WIDGET_1/
 *      0.json returns JSONP with {subject, pub_date, href} for the most
 *      recent LCB bulletins), ingest anything new, fetch each new bulletin's
 *      page for full text, and run the AI analysis for cannabis-relevant
 *      items (keyword gate — the AI budget is not spent on alcohol/tobacco or
 *      job-posting bulletins).
 *   2. ingestFromUrl() — fetch one bulletin/notice URL pasted by the owner.
 *   3. ingestFromText() — plain pasted text (works with zero network setup).
 *   4. analyzeItem() — run/refresh the AI briefing for one ingested item.
 *
 * ADVISORY ONLY (standing DRAFTS-ONLY rule): nothing here changes store
 * behavior — rows land on the Regulatory Watch page for a human to review.
 * Server-only.
 */
import "server-only";
import {
  parseGovDeliveryWidget,
  extractAll,
  type Extraction,
} from "./regulatory-core";
import {
  ingestRegulatoryItem,
  updateItemBody,
  saveAnalysis,
  proposeRoadmapItems,
  touchSource,
  type IngestResult,
} from "./regulatory-store";
import { analyzeRegulatoryItem, isAiConfigured } from "./regulatory-analyst";

const WIDGET_FEED_URL =
  "https://content.govdelivery.com/accounts/WALCB/widgets/WALCB_WIDGET_1/0.json";

const FETCH_TIMEOUT_MS = 15000;

// ── HTML → text (bulletins are simple HTML pages) ────────────────────────────

/** Strip a bulletin page down to readable text. Exported for tests. */
export function htmlToText(html: string): string {
  return (html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "GreenwayRegulatoryWatch/1.0 (compliance monitoring)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── AI analysis for one item ─────────────────────────────────────────────────

export type AnalyzeOutcome =
  | { ok: true; analysisId: string | null; proposed: number }
  | { ok: false; reason: string };

/**
 * Run the AI briefing for an ingested item and persist it (plus proposed
 * roadmap tasks). No-ops cleanly when AI is unconfigured.
 */
export async function analyzeItem(input: {
  itemId: string;
  title: string;
  bodyText: string;
  extraction: Extraction;
  publishedAt?: string | null;
}): Promise<AnalyzeOutcome> {
  if (!isAiConfigured) return { ok: false, reason: "AI is not configured." };
  try {
    const briefing = await analyzeRegulatoryItem({
      title: input.title,
      bodyText: input.bodyText,
      extraction: input.extraction,
      publishedAt: input.publishedAt,
    });
    const analysisId = await saveAnalysis({
      itemId: input.itemId,
      summary: briefing.summary,
      stage: briefing.stage,
      impact: briefing.impact,
      areas: briefing.areas,
      deadlines: briefing.deadlines,
      strategy: briefing.strategy,
      roadmap: briefing.roadmap,
      modelId: briefing.modelId,
    });
    // Effective date (if the analyst confirmed one) becomes the tasks' due date.
    const effective = briefing.deadlines.find((d) => d.kind === "effective")?.date ?? null;
    const proposed = await proposeRoadmapItems(
      input.itemId,
      briefing.roadmap,
      effective ? `${effective}T00:00:00Z` : null,
    );
    return { ok: true, analysisId, proposed };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "analysis failed" };
  }
}

// ── 1. GovDelivery feed poll (the cron's main job) ──────────────────────────

export type PollSummary = {
  feedItems: number;
  ingested: number;
  analyzed: number;
  skippedIrrelevant: number;
  errors: string[];
};

export async function pollGovDeliveryFeed(): Promise<PollSummary> {
  const summary: PollSummary = {
    feedItems: 0,
    ingested: 0,
    analyzed: 0,
    skippedIrrelevant: 0,
    errors: [],
  };

  const raw = await fetchText(WIDGET_FEED_URL);
  if (!raw) {
    summary.errors.push("GovDelivery widget feed fetch failed.");
    return summary;
  }
  const items = parseGovDeliveryWidget(raw);
  summary.feedItems = items.length;

  for (const item of items) {
    const res = await ingestRegulatoryItem({
      sourceKey: "govdelivery-widget",
      externalId: item.externalId,
      title: item.subject,
      url: item.href,
      ingestedVia: "cron",
      publishedAt: item.publishedAt,
      bodyText: null,
    });
    if (!res.ok) {
      if (res.migrationMissing) {
        summary.errors.push("Migration 0137 not applied — poll skipped.");
        return summary;
      }
      summary.errors.push(`Ingest failed for ${item.externalId}: ${res.error}`);
      continue;
    }
    if (!res.created) continue; // already have it — dedupe by design

    summary.ingested++;

    // Fetch the bulletin page for the full text + real extraction.
    const html = item.href ? await fetchText(item.href) : null;
    const bodyText = html ? htmlToText(html).slice(0, 60000) : "";
    let extraction = res.extraction;
    if (bodyText) {
      await updateItemBody(res.itemId, item.subject, bodyText);
      extraction = extractAll(item.subject, bodyText);
    }

    // AI budget gate: only analyze cannabis-relevant items.
    if (!extraction.cannabisRelevant) {
      summary.skippedIrrelevant++;
      continue;
    }
    const analyzed = await analyzeItem({
      itemId: res.itemId,
      title: item.subject,
      bodyText,
      extraction,
      publishedAt: item.publishedAt,
    });
    if (analyzed.ok) summary.analyzed++;
    else if (analyzed.reason !== "AI is not configured.") {
      summary.errors.push(`Analysis failed for ${item.externalId}: ${analyzed.reason}`);
    }
  }

  await touchSource("govdelivery-widget");
  return summary;
}

// ── 2. Manual: ingest from a URL ─────────────────────────────────────────────

export async function ingestFromUrl(url: string): Promise<IngestResult & { analyzed?: boolean }> {
  const trimmed = (url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "That does not look like a valid URL." };
  }
  // SSRF guard: only fetch from the official sources we watch.
  const allowed = ["lcb.wa.gov", "content.govdelivery.com", "app.leg.wa.gov", "lawfilesext.leg.wa.gov", "apps.leg.wa.gov"];
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !allowed.some((d) => host === d || host.endsWith(`.${d}`))) {
    return {
      ok: false,
      error: "Only official sources can be fetched (lcb.wa.gov, content.govdelivery.com, leg.wa.gov).",
    };
  }

  const html = await fetchText(parsed.toString());
  if (!html) return { ok: false, error: "Could not fetch that page (it may be down or blocked)." };
  const text = htmlToText(html).slice(0, 60000);
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = (titleMatch?.[1] ?? "").trim() || parsed.pathname.split("/").filter(Boolean).pop() || trimmed;

  const res = await ingestRegulatoryItem({
    sourceKey: "manual",
    externalId: parsed.toString(),
    title: title.slice(0, 300),
    url: parsed.toString(),
    ingestedVia: "manual",
    publishedAt: null,
    bodyText: text,
  });
  if (!res.ok) return res;

  let analyzed = false;
  if (res.extraction.cannabisRelevant) {
    const out = await analyzeItem({
      itemId: res.itemId,
      title,
      bodyText: text,
      extraction: res.extraction,
    });
    analyzed = out.ok;
  }
  return { ...res, analyzed };
}

// ── 3. Manual: ingest pasted text ────────────────────────────────────────────

export async function ingestFromText(
  title: string,
  bodyText: string,
): Promise<IngestResult & { analyzed?: boolean }> {
  const t = (title ?? "").trim();
  const body = (bodyText ?? "").trim();
  if (!t || body.length < 40) {
    return { ok: false, error: "Provide a title and at least a few sentences of the bulletin text." };
  }
  // Content-hash id so pasting the same bulletin twice dedupes.
  const hash = await sha256Hex(`${t}\n${body}`);
  const res = await ingestRegulatoryItem({
    sourceKey: "manual",
    externalId: `paste-${hash.slice(0, 24)}`,
    title: t.slice(0, 300),
    url: null,
    ingestedVia: "manual",
    publishedAt: null,
    bodyText: body.slice(0, 60000),
  });
  if (!res.ok) return res;

  let analyzed = false;
  if (res.extraction.cannabisRelevant) {
    const out = await analyzeItem({
      itemId: res.itemId,
      title: t,
      bodyText: body,
      extraction: res.extraction,
    });
    analyzed = out.ok;
  }
  return { ...res, analyzed };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

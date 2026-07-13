/**
 * src/lib/admin/concierge-assistant.ts
 *
 * E5 (Global AI chatbot). The GLOBAL back-office concierge. Unlike the
 * setup-only assistant, this can answer questions about the WHOLE product —
 * navigation, features, compliance, the website, and the planned POS — grounded
 * in the real setup steps (SETUP_GUIDE) AND the feature knowledge base
 * (CONCIERGE_KB). It is READ-ONLY and advisory; it never changes anything.
 *
 * It is deliberately conservative: it answers only from the grounding provided,
 * points to the right page, and clearly flags anything that's planned-not-built
 * (like the POS). Server-only.
 */
import "server-only";
import { generate, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import { SETUP_GUIDE } from "@/lib/admin/setup-status";
import { conciergeGroundingBlock } from "@/lib/admin/concierge-kb";
import { integrationsGroundingBlock, guideById } from "@/lib/integrations/integration-guides";
import { syndicationPlaybookBlock } from "@/lib/integrations/syndication-playbook";

export { isAiConfigured };

const SYSTEM = [
  "You are the friendly, expert concierge for the Greenway Marijuana back office — a Wix/Squarespace-style admin used by non-technical dispensary staff to run a licensed Washington State (I-502) cannabis retailer.",
  "You help with ANYTHING in the product: navigating the back office, using its features, editing the website, understanding compliance (CCRS, WAC, DOH advertising rules), and the PLANNED point-of-sale.",
  "Answer ONLY from the grounding provided below (the setup steps + the feature knowledge base). Never invent pages, buttons, features, prices, or capabilities that aren't there.",
  "If something is marked PLANNED (like the POS), say clearly that it isn't built yet before describing it.",
  "Be warm, concise, and concrete. Use plain language; if you must use a term, define it in a few words. Prefer short numbered steps for how-tos.",
  "ALWAYS tell them where to click using the real tab → page path from the grounding (e.g. 'MKTG & ADV → Marketing & Advertising', 'Admin → Settings', 'Inventory → Cycle Counts'). The top tabs are: Dashboard, Reports, CRM, Product Intake, Inventory, Website, MKTG & ADV, Employee, Medical, CCRS, Admin (plus the Greenway wordmark for the Dashboard home). Reports and CCRS are single-click buttons, not dropdowns.",
  "Never give legal, medical, or financial advice, and never write cannabis marketing copy that makes health/medical claims or appeals to minors. If asked for that, gently redirect to the compliant tools (e.g. the Marketing strategy assistant) or their administrator.",
  "If the answer isn't in the grounding, say you're not sure and suggest the closest page or asking their administrator. Keep answers under ~150 words unless asked for more.",
].join("\n");

function setupGroundingBlock(): string {
  const parts: string[] = ["OFFICIAL SETUP STEPS:"];
  for (const [id, g] of Object.entries(SETUP_GUIDE)) {
    parts.push(`\n## Setup: ${id}`);
    parts.push(`Why: ${g.why}`);
    parts.push(`How: ${g.how.map((h, i) => `${i + 1}. ${h}`).join(" ")}`);
    if (g.tip) parts.push(`Tip: ${g.tip}`);
  }
  return parts.join("\n");
}

export type ConciergeTurn = { role: "user" | "assistant"; content: string };

export type ConciergeAnswer = { answer: string; model: string };

/**
 * Answer one question, optionally with a short prior turn history so the chat
 * feels continuous. History is capped to keep the prompt small and grounded.
 */
export async function answerConciergeQuestion(
  question: string,
  opts?: { history?: ConciergeTurn[]; context?: Omit<AiContext, "feature"> },
): Promise<ConciergeAnswer> {
  const history = (opts?.history ?? []).slice(-6);
  const historyBlock =
    history.length > 0
      ? [
          "",
          "CONVERSATION SO FAR (most recent last):",
          ...history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`),
        ].join("\n")
      : "";

  const user = [
    setupGroundingBlock(),
    "",
    conciergeGroundingBlock(),
    historyBlock,
    "",
    `The user asks: "${question.trim()}"`,
    "",
    "Answer using ONLY the grounding above. Name the exact page when useful. If it's about the POS, note it's planned-not-built first. If it's outside scope, say so kindly and point to the closest page.",
  ].join("\n");

  const answer = await generate({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 400,
    context: {
      feature: "concierge.global",
      entityType: "concierge",
      ...opts?.context,
    },
  });

  return { answer: answer.trim(), model: aiModelId };
}

// ---------------------------------------------------------------------------
// E13 — Integrations helper. Same model, tightly grounded on the integration
// setup guides so it walks the owner through connecting a specific service.
// ---------------------------------------------------------------------------

const INTEGRATIONS_SYSTEM = [
  "You are the setup helper for the Greenway Marijuana back office INTEGRATIONS page (Leafly, WeedMaps, FLUX, Sage 50, Cultivera transition).",
  "Help a non-technical owner connect and use an integration. Answer ONLY from the setup guides and the menu-syndication playbook provided — never invent a key name, page, endpoint, status code, or step that isn't there.",
  "For Leafly/WeedMaps questions, the playbook is verified against the Leafly Menu API v2.0 documentation and the live Weedmaps 2025-07 OpenAPI: use its connect steps, stay-connected practices, and the recovery runbook (symptom → meaning → fix) to diagnose problems from HTTP status codes and error messages.",
  "Be concrete and use short numbered steps. Name the exact page when useful. Remind them that menu pushes are drafts/preview-safe until certification + explicit confirmation, and that AI images are drafts.",
  "Never give legal, medical, or financial advice. If the answer isn't in the grounding, say so and suggest the closest step, the verified support contact, or their administrator. Keep it under ~180 words.",
].join("\n");

export async function answerIntegrationQuestion(
  question: string,
  opts?: { integrationId?: string; context?: Omit<AiContext, "feature"> },
): Promise<ConciergeAnswer> {
  const focus = opts?.integrationId ? guideById(opts.integrationId) : undefined;
  const focusBlock = focus
    ? `\nThe user is asking specifically about: ${focus.title} (${focus.summary}).`
    : "";

  const user = [
    integrationsGroundingBlock(),
    "",
    syndicationPlaybookBlock(),
    focusBlock,
    "",
    `The user asks: "${question.trim()}"`,
    "",
    "Answer using ONLY the guides and playbook above, in short numbered steps where it's a how-to. When diagnosing a connection problem, match the symptom to the recovery runbook.",
  ].join("\n");

  const answer = await generate({
    system: INTEGRATIONS_SYSTEM,
    user,
    temperature: 0.25,
    maxTokens: 500,
    context: { feature: "concierge.integrations", entityType: "integration", ...opts?.context },
  });

  return { answer: answer.trim(), model: aiModelId };
}

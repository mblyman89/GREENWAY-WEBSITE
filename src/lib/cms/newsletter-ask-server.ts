/**
 * src/lib/cms/newsletter-ask-server.ts
 *
 * D243 E-5 (SOP-22 G-125): Ask the canvas, server side.
 *
 * The browser sends a screenshot of the email preview (JPEG data URL) and the
 * current canvas. A vision model (ASK_CANVAS_MODEL, else MEDIA_AI_MODEL, else
 * the media describer's default; "high" detail) reads both and answers with a
 * reply plus a list of steps. The steps are parsed strictly (parseAskOps), the
 * words in them go through the same copy and compliance checks as Improve,
 * and the plan goes back to the browser to show as a proposal. Nothing is
 * changed here: the owner presses Apply (decision 4) and can Undo.
 *
 * Budget: refused when the monthly AI budget is used up (budgetBlock). The
 * call is logged in the AI usage ledger by generateVisionJson.
 */
import "server-only";
import { generateVisionJson, isAiConfigured, looseJsonParse } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { greenwayBusiness } from "@/content/business";
import { MEDIA_AI_DEFAULT_MODEL } from "@/lib/media/media-describe-core";
import { canvasFacts, checkAiCopy, type AiIssue } from "./newsletter-ai-core";
import { normalizeCanvas, type CanvasDoc } from "./newsletter-canvas-core";
import { getThisWeekFeed } from "./this-week-feed-server";
import { recentPostLinks } from "./newsletter-canvas-server";
import { budgetBlock } from "./newsletter-ai-server";
import { askOpWords, askShotOk, buildAskPrompt, describeAskOp, parseAskOps, type AskOp } from "./newsletter-ask-core";

const SITE = greenwayBusiness.website.replace(/\/$/, "");

export function askCanvasModel(): string {
  return (process.env.ASK_CANVAS_MODEL ?? "").trim() || (process.env.MEDIA_AI_MODEL ?? "").trim() || MEDIA_AI_DEFAULT_MODEL;
}

export type AskOut =
  | { ok: true; reply: string; ops: AskOp[]; lines: string[]; dropped: string[]; issues: AiIssue[]; model: string }
  | { ok: false; error: string };

export async function askCanvas(p: { postId: string; ask: string; doc: unknown; shot: unknown; actorId: string | null; actorEmail: string | null }): Promise<AskOut> {
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) on the deployment." };
  const ask = String(p.ask ?? "").trim();
  if (!ask) return { ok: false, error: "Type what you want done (or a question about the email)." };
  if (!askShotOk(p.shot)) return { ok: false, error: "The preview picture could not be read. Try again." };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const doc: CanvasDoc = normalizeCanvas(p.doc);
  const [{ feed }, posts] = await Promise.all([getThisWeekFeed({ withBelowCost: true }), recentPostLinks(p.postId)]);
  const facts = canvasFacts(feed, posts, SITE);
  const model = askCanvasModel();
  const res = await generateVisionJson({
    system: COMPLIANCE_SYSTEM,
    user: buildAskPrompt(ask, doc, facts),
    imageUrl: p.shot,
    model,
    detail: "high",
    maxTokens: 2400,
    reasoningEffort: "medium",
    timeoutMs: 120_000,
    context: { feature: "newsletter.ai.ask", entityType: "blog_post", entityId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail },
  });
  let raw: unknown = null;
  try {
    raw = looseJsonParse<unknown>(res.content);
  } catch {
    return { ok: false, error: "The AI answer could not be read. Try asking again." };
  }
  const plan = parseAskOps(raw, doc);
  if (!plan.reply && !plan.ops.length) return { ok: false, error: "The AI had nothing to suggest. Ask differently." };
  // Words may only repeat amounts and links from this week's facts or the email itself.
  const text = askOpWords(plan.ops);
  const issues: AiIssue[] = text ? checkAiCopy(text, `${facts.join("\n")}\n${JSON.stringify(doc)}`) : [];
  if (text) {
    const c = checkCompliance(text);
    for (const f of c.blockingFlags) issues.push({ level: "must-fix", text: `Compliance: ${f}.` });
    for (const f of c.flags.filter((x) => x.endsWith("(heads-up)"))) issues.push({ level: "heads-up", text: `Compliance: ${f}` });
  }
  if (issues.some((i) => i.level === "must-fix")) {
    return { ok: false, error: `The AI suggestion broke the rules and was not shown: ${issues.filter((i) => i.level === "must-fix").map((i) => i.text).join(" ")}` };
  }
  return { ok: true, reply: plan.reply, ops: plan.ops, lines: plan.ops.map((o) => describeAskOp(o, doc)), dropped: plan.dropped, issues, model: res.model };
}

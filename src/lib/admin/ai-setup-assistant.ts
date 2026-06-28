/**
 * src/lib/admin/ai-setup-assistant.ts
 *
 * AI concierge for the Getting Started wizard (PR D). A non-technical owner can
 * type a plain-language question about setting up the back office ("how do I
 * connect Supabase?", "what's a migration?", "how do I invite my manager?")
 * and get a short, friendly, accurate answer grounded in the real setup steps.
 *
 * It is read-only and advisory — it never changes settings. Answers are
 * grounded with the SETUP_GUIDE content so the model stays on-script and
 * doesn't invent UI that doesn't exist.
 *
 * Server-only.
 */
import "server-only";
import { generate, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import { SETUP_GUIDE } from "@/lib/admin/setup-status";

export { isAiConfigured };

const SYSTEM = [
  "You are the friendly setup concierge for the Greenway Marijuana back office — a Wix/Squarespace-style admin used by non-technical dispensary employees.",
  "Answer ONLY questions about getting the back office set up and running. Be warm, concise, and concrete. Use plain language; avoid jargon, and if you must use a term, define it in a few words.",
  "Ground every answer in the official setup steps provided below. Do not invent menu items, buttons, or pages that aren't mentioned. If something is outside setup (e.g. a coding question, legal advice, or medical claims), gently say it's out of scope and point them to the relevant setup step or their administrator.",
  "Prefer short numbered steps when explaining a how-to. Keep answers under ~120 words unless the user asks for more.",
].join("\n");

function groundingBlock(): string {
  const parts: string[] = ["OFFICIAL SETUP STEPS (the source of truth):"];
  for (const [id, g] of Object.entries(SETUP_GUIDE)) {
    parts.push(`\n## ${id}`);
    parts.push(`Why: ${g.why}`);
    parts.push(`How: ${g.how.map((h, i) => `${i + 1}. ${h}`).join(" ")}`);
    if (g.tip) parts.push(`Tip: ${g.tip}`);
  }
  return parts.join("\n");
}

export type SetupAnswer = {
  answer: string;
  model: string;
};

/**
 * Answer one plain-language setup question. Throws AiNotConfiguredError when no
 * key is set so the caller can show a friendly "AI not set up" message.
 */
export async function answerSetupQuestion(
  question: string,
  context?: Omit<AiContext, "feature">,
): Promise<SetupAnswer> {
  const user = [
    groundingBlock(),
    "",
    `The user asks: "${question.trim()}"`,
    "",
    "Answer using ONLY the setup steps above. If the question isn't about setup, say so kindly and suggest the closest setup step.",
  ].join("\n");

  const answer = await generate({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 320,
    context: {
      feature: "setup.assistant",
      entityType: "setup",
      ...context,
    },
  });

  return { answer: answer.trim(), model: aiModelId };
}

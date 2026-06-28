/**
 * src/lib/ai/ai-vendor.ts
 *
 * AI DRAFT assist for vendor / brand profiles (UX-5). Given a vendor's name
 * and whatever context staff already typed, it drafts a short, compliant
 * mission statement + an "about" paragraph. Output is a SUGGESTION only — it
 * is shown for staff Accept / Edit / Reject and is never written to the vendor
 * record or published automatically (same drafts-only gate as the rest of the
 * back office).
 *
 * Reuses the shared provider + the WA-cannabis compliance system prompt +
 * scanner. Server-only.
 *
 * NOTE (honesty): the text model does not browse the web. It writes a tasteful,
 * generic-but-plausible starting draft from the name + any hints the staff
 * member provides. It is explicitly a *starting point the human verifies and
 * edits*, not researched fact. A future enhancement could wire a real research
 * tool / web fetch (tracked in the roadmap).
 */
import "server-only";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "@/lib/ai/compliance";

export { isAiConfigured };

export type VendorBrief = {
  /** "vendor" or "brand" — tweaks the wording. */
  kind: "vendor" | "brand";
  displayName: string;
  /** Existing mission, so AI can refine rather than overwrite blindly. */
  currentMission?: string | null;
  /** Existing about, same idea. */
  currentAbout?: string | null;
  /** Brand-only: existing product-philosophy draft, so AI can refine it. */
  currentPhilosophy?: string | null;
  /** Website, if known, helps anchor the tone. */
  website?: string | null;
  /** Optional plain-language instruction from staff. */
  instruction?: string | null;
};

export type VendorProfileSuggestion = {
  mission: string;
  about: string;
  /**
   * Brand-only: a short product-philosophy paragraph. Empty string for vendors
   * (vendors don't have this field). Brands DO.
   */
  philosophy: string;
  /** Compliance flags found across all generated fields (empty = clean). */
  complianceFlags: string[];
  model: string;
  promptVersion: string;
};

function buildPrompt(brief: VendorBrief): string {
  const isBrand = brief.kind === "brand";
  const noun = isBrand ? "cannabis product brand" : "cannabis vendor/supplier";
  const pieces = isBrand ? "three short pieces" : "two short pieces";
  const lines = [
    `You are writing ${pieces} of website copy about a ${noun} carried by a licensed Washington State cannabis retailer.`,
    `Name: "${brief.displayName}".`,
    brief.website ? `Website: ${brief.website}` : null,
    brief.currentMission ? `Current mission draft: "${brief.currentMission}"` : null,
    brief.currentAbout ? `Current about draft: "${brief.currentAbout}"` : null,
    brief.currentPhilosophy ? `Current product-philosophy draft: "${brief.currentPhilosophy}"` : null,
    brief.instruction ? `Staff instruction: ${brief.instruction}` : null,
    ``,
    `Return EXACTLY this format with no extra text:`,
    `MISSION: <one inviting sentence, max ~20 words, no period required>`,
    `ABOUT: <one short paragraph, 2-4 sentences, warm and professional>`,
  ];
  if (isBrand) {
    lines.push(
      `PHILOSOPHY: <one short paragraph, 2-3 sentences, about their craft / approach to making product (cultivation, sourcing, process) without medical or effect claims>`,
    );
  }
  lines.push(
    ``,
    `Rules: confident, welcoming, adult-oriented, premium-but-approachable. No emojis. No quotes. Do NOT invent specific awards, exact founding years, dollar figures, or medical claims. Do not target minors. Keep it honest and general enough that a human can verify and edit it. If you are unsure of facts, stay descriptive rather than specific.`,
  );
  return lines.filter((l) => l !== null).join("\n");
}

function parseOutput(raw: string): { mission: string; about: string; philosophy: string } {
  const text = raw.trim();
  const missionMatch = text.match(/MISSION:\s*([\s\S]*?)(?:\n\s*ABOUT:|$)/i);
  const aboutMatch = text.match(/ABOUT:\s*([\s\S]*?)(?:\n\s*PHILOSOPHY:|$)/i);
  const philMatch = text.match(/PHILOSOPHY:\s*([\s\S]*)$/i);
  let mission = (missionMatch?.[1] ?? "").trim();
  let about = (aboutMatch?.[1] ?? "").trim();
  let philosophy = (philMatch?.[1] ?? "").trim();

  // If the model ignored the format, fall back: first line = mission, rest = about.
  if (!mission && !about) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    mission = lines[0] ?? "";
    about = lines.slice(1).join(" ").trim();
  }

  const strip = (s: string) =>
    s.replace(/^["']|["']$/g, "").replace(/^(mission|about|philosophy)\s*:\s*/i, "").trim();
  return { mission: strip(mission), about: strip(about), philosophy: strip(philosophy) };
}

/**
 * Draft a compliant mission + about (+ product-philosophy for brands) for a
 * vendor or brand. Throws AiNotConfiguredError when no key is set so the caller
 * can show a friendly "AI not set up" message.
 */
export async function generateVendorProfile(brief: VendorBrief): Promise<VendorProfileSuggestion> {
  const raw = await generate({
    system: COMPLIANCE_SYSTEM,
    user: buildPrompt(brief),
    temperature: 0.7,
    maxTokens: brief.kind === "brand" ? 420 : 320,
  });
  const { mission, about, philosophy } = parseOutput(raw);
  const { flags } = checkCompliance(`${mission}\n${about}\n${philosophy}`);
  return {
    mission,
    about,
    philosophy,
    complianceFlags: flags,
    model: aiModelId,
    promptVersion: PROMPT_VERSION,
  };
}

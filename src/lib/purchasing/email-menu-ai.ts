/**
 * src/lib/purchasing/email-menu-ai.ts
 *
 * SLICE 83 — AI-assisted extraction for emailed vendor menus, built on the
 * EXISTING AI infrastructure (generateStructured + the schema system).
 *
 * STANDING RULES honored:
 *   - DRAFTS ONLY: AI output becomes snapshot rows the buyer reviews; nothing
 *     auto-commits stock, orders, or money.
 *   - NEVER TRUST THE MODEL WITH NUMBERS: the model returns a TSV STRING; the
 *     pure deterministic parser (parseAiTsv in email-menu-core.ts) re-parses
 *     and VALIDATES every price (moneyToMinor cents rule), quantity, and
 *     potency before anything can be stored. A malformed row is skipped, not
 *     guessed at.
 *   - BUDGET-GUARDED: generateStructured refuses past the owner's monthly cap
 *     (AiBudgetExceededError) and no-ops when AI_API_KEY is unset
 *     (AiNotConfiguredError) — both are caught here so the webhook path
 *     degrades gracefully to deterministic-only parsing.
 *
 * Only invoked when the deterministic pass finds FEW items from a text source
 * that looks menu-like — most vendor emails parse without spending a cent.
 */
import "server-only";

import { generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import { parseAiTsv, type EmailMenuItem } from "./email-menu-core";

/** Cap what we send to the model — menu emails are small; PDFs can be huge. */
const MAX_SOURCE_CHARS = 12_000;

const tsvSchema = defineSchema<{ tsv: string }>("email_menu_tsv", {
  tsv: {
    kind: "string",
    description:
      "Tab-separated menu rows, one product per line, columns exactly: " +
      "name<TAB>brand<TAB>category<TAB>size<TAB>price<TAB>qty<TAB>thc<TAB>description. " +
      "Leave a column empty when unknown. Copy prices exactly as written (e.g. $12.50). " +
      "NEVER invent a product or a price that is not in the source text. " +
      "Return an empty string if the text contains no product menu.",
    maxLength: 20_000,
  },
});

export type AiMenuExtraction = {
  items: EmailMenuItem[];
  /** "ai" when the model contributed; null when AI was unavailable/failed. */
  used: boolean;
  note: string;
};

/**
 * Ask the model to transcribe menu rows out of unstructured email/PDF text.
 * The result is ALWAYS re-validated by the deterministic TSV parser — the
 * model is a transcriber, never a source of truth. Returns used=false (empty
 * items) whenever AI is unconfigured, over budget, or errors out.
 */
export async function extractMenuItemsWithAi(sourceText: string): Promise<AiMenuExtraction> {
  const text = (sourceText || "").trim();
  if (!text) return { items: [], used: false, note: "no source text" };
  if (!isAiConfigured) return { items: [], used: false, note: "AI not configured" };

  const system =
    "You transcribe cannabis wholesale menu text into TSV rows. You only copy what is " +
    "explicitly present in the source — you never invent products, prices, or quantities. " +
    "If the text is not a product menu, return an empty tsv string.";
  const user = `Source text from a vendor email:\n\n${text.slice(0, MAX_SOURCE_CHARS)}`;

  try {
    const result = await generateStructured<{ tsv: string }>({
      system,
      user,
      schema: tsvSchema,
      tier: "light",
      temperature: 0,
    });
    const items = parseAiTsv(result.tsv ?? "");
    return {
      items,
      used: items.length > 0,
      note: items.length > 0 ? `AI transcribed ${items.length} row(s), validated deterministically` : "AI found no menu rows",
    };
  } catch (err) {
    // Budget exceeded / not configured / provider error — degrade gracefully.
    const msg = err instanceof Error ? err.message : String(err);
    return { items: [], used: false, note: `AI unavailable: ${msg}` };
  }
}

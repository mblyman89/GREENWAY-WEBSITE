/**
 * src/lib/enrichment/accept-drafts-server.ts  (D244 E-5)
 *
 * The ONE place an accepted AI draft is written to a product. Shared by the
 * product page (Accept, "Accept all >= 85%", D244 E-4) and the Bulk AI review
 * grid (per-product "Accept all >= 85%" and "Accept all >= 85% & publish",
 * D244 E-5), so a fix to one fixes both. Moved here unchanged from
 * src/app/admin/products/actions.ts (a "use server" file may only export
 * actions, and the grid needs the same writer).
 *
 * Every accept still goes through acceptWithComplianceGate first; best
 * guesses never count (owner Q4 open); the bar is ACCEPT_ALL_THRESHOLD (owner
 * Q3, 85 vs 90, open).
 */
import "server-only";
import { ensureEnrichment, updateEnrichment } from "@/lib/enrichment/store";
import { listSuggestions, reviewSuggestion } from "@/lib/ai/suggestions";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { ALLOWED_PRODUCT_TAGS } from "@/lib/ai/schemas/product";
import { SEO_FIELD_KEY, parseSeoSuggestion } from "@/lib/enrichment/seo-draft-core";
import { ACCEPT_ALL_THRESHOLD, acceptAllEligible, type SuggestionLite } from "@/lib/enrichment/ai-draft-v2-core";

const TAGS = new Set<string>(ALLOWED_PRODUCT_TAGS);

/**
 * Write an accepted suggestion's value to the enrichment. Returns an error
 * sentence (nothing written) or null. Shared by Accept and "Accept all".
 */
export async function applyAcceptedValue(
  key: string,
  sugg: { field_key: string; suggested_value: string | null },
  userId: string,
): Promise<string | null> {
  if (sugg.field_key === SEO_FIELD_KEY) {
    // R23 (fix 4): one "seo" suggestion carries both parts; re-cleaned here
    // so a row edited in the database can never exceed the length rules.
    const seo = parseSeoSuggestion(sugg.suggested_value);
    if (!seo) return "That SEO draft could not be read. Draft it again.";
    await ensureEnrichment(key, {}, userId);
    await updateEnrichment(key, { seo_title: seo.title, seo_description: seo.description }, userId);
    return null;
  }
  await ensureEnrichment(key, {}, userId);
  if (sugg.field_key === "description") {
    await updateEnrichment(key, { description: sugg.suggested_value }, userId);
  } else if (sugg.field_key === "display_name" || sugg.field_key === "short_description") {
    // D244 E-4: the all-fields draft also proposes these two.
    const v = String(sugg.suggested_value ?? "").trim();
    if (!v) return "That draft is empty. Draft it again.";
    await updateEnrichment(key, { [sugg.field_key]: v } as Parameters<typeof updateEnrichment>[1], userId);
  } else if (sugg.field_key === "tags") {
    const tags = (sugg.suggested_value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => TAGS.has(t));
    await updateEnrichment(key, { tags }, userId);
  }
  // sensory + effects have no enrichment column; they are validated facts that
  // live on the accepted suggestion and are promoted to the KB (on accept here
  // and again on publish via writeBackOnPublish). No enrichment write needed.
  return null;
}

export type AcceptAllOutcome =
  | { ok: false; error: string }
  | { ok: true; eligible: number; accepted: string[]; blocked: string[]; writeback: Awaited<ReturnType<typeof writeBackOnPublish>> };

/**
 * Accept every eligible draft (newest per field, >= ACCEPT_ALL_THRESHOLD, not
 * a best guess) for ONE product, each through the compliance gate. Never
 * throws for a single field: a blocked or unreadable one is named in blocked.
 */
export async function acceptHighConfidenceForKey(key: string, userId: string): Promise<AcceptAllOutcome> {
  const pending = await listSuggestions("product", key, "pending").catch(() => null);
  if (!pending) return { ok: false, error: "The drafts could not be read just now. Nothing was accepted." };
  const ids = acceptAllEligible(pending as SuggestionLite[], ACCEPT_ALL_THRESHOLD);
  const byId = new Map(pending.map((p) => [p.id, p] as const));
  const accepted: string[] = [];
  const blocked: string[] = [];
  for (const id of ids) {
    const sugg = byId.get(id)!;
    const gate = await acceptWithComplianceGate(sugg);
    if (!gate.ok) {
      blocked.push(sugg.field_key);
      continue;
    }
    const err = await applyAcceptedValue(key, sugg, userId);
    if (err) {
      blocked.push(sugg.field_key);
      continue;
    }
    await reviewSuggestion(id, "accepted", userId);
    accepted.push(sugg.field_key);
  }
  const writeback = accepted.length ? await writeBackOnPublish(key, userId) : null;
  return { ok: true, eligible: ids.length, accepted, blocked, writeback };
}

export function acceptAllMessage(accepted: string[], blocked: string[]): string {
  return `Accepted ${accepted.length} draft${accepted.length === 1 ? "" : "s"} at or above ${ACCEPT_ALL_THRESHOLD}%${accepted.length ? ` (${accepted.join(", ")})` : ""}.${blocked.length ? ` Skipped ${blocked.join(", ")} - review those by hand.` : ""}`;
}

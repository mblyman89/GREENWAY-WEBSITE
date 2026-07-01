"use server";

/**
 * src/app/admin/marketing/actions.ts
 *
 * E1 (Marketing & Advertising). Server actions for the marketing page:
 *  - suggestStrategyAction: run the GPT-4o compliant-strategy assistant on a
 *    plain-language goal. Grounded + WA-compliance-scanned. Drafts-only.
 *  - saveIdeaAction: save a reviewed strategy draft to the private notebook.
 *  - updateIdeaAction / deleteIdeaAction: triage the notebook.
 *
 * All gated on content.edit and audit-logged.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { revalidatePath } from "next/cache";
import {
  suggestStrategy,
  type MarketingChannel,
  type MarketingStrategy,
} from "@/lib/marketing/strategy-ai";
import {
  saveMarketingIdea,
  updateMarketingIdea,
  deleteMarketingIdea,
  type MarketingIdeaStatus,
} from "@/lib/marketing/ideas-store";

// --- Strategy assistant ------------------------------------------------------

export type StrategyActionResult =
  | { ok: true; strategy: MarketingStrategy; model: string; warnings: string[]; goal: string; channel: string }
  | { ok: false; error: string; blockingFlags: string[] };

export async function suggestStrategyAction(
  _prev: StrategyActionResult | null,
  formData: FormData,
): Promise<StrategyActionResult> {
  const session = await requirePermission("content.edit");
  const goal = String(formData.get("goal") ?? "").trim();
  const channel = String(formData.get("channel") ?? "general") as MarketingChannel;

  const result = await suggestStrategy({ goal, channel });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "marketing_strategy.suggest",
    entityType: "marketing_ideas",
    after: { goal, channel, ok: result.ok },
  }).catch(() => {});

  if (!result.ok) {
    return { ok: false, error: result.error, blockingFlags: result.blockingFlags };
  }
  return {
    ok: true,
    strategy: result.strategy,
    model: result.model,
    warnings: result.warnings,
    goal,
    channel,
  };
}

// --- Save / triage the notebook ---------------------------------------------

export type SaveIdeaResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveIdeaAction(formData: FormData): Promise<SaveIdeaResult> {
  const session = await requirePermission("content.edit");
  const goal = String(formData.get("goal") ?? "").trim();
  const channel = String(formData.get("channel") ?? "general").trim() || "general";
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const aiModel = String(formData.get("ai_model") ?? "").trim() || null;
  const flagsRaw = String(formData.get("compliance_flags") ?? "");
  const complianceFlags = flagsRaw ? flagsRaw.split("\n").map((s) => s.trim()).filter(Boolean) : [];

  if (!body) return { ok: false, error: "Nothing to save — generate a plan first." };

  const res = await saveMarketingIdea(
    { goal, channel, title, body, aiModel, complianceOk: true, complianceFlags },
    session.userId,
  );

  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "marketing_idea.save",
      entityType: "marketing_ideas",
      entityId: res.id,
      after: { goal, channel, title },
    }).catch(() => {});
    revalidatePath("/admin/marketing");
  }
  return res;
}

export async function updateIdeaAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as MarketingIdeaStatus;
  const notes = formData.get("notes") != null ? String(formData.get("notes")) : undefined;
  const res = await updateMarketingIdea(id, { status: status || undefined, notes }, session.userId);
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "marketing_idea.update",
      entityType: "marketing_ideas",
      entityId: id,
      after: { status, hasNotes: notes != null },
    }).catch(() => {});
    revalidatePath("/admin/marketing");
  }
  return res;
}

export async function deleteIdeaAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requirePermission("content.edit");
  const id = String(formData.get("id") ?? "");
  const res = await deleteMarketingIdea(id);
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "marketing_idea.delete",
      entityType: "marketing_ideas",
      entityId: id,
    }).catch(() => {});
    revalidatePath("/admin/marketing");
  }
  return res;
}

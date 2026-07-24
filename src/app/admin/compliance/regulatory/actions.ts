"use server";

/**
 * Server actions for Regulatory Watch (SLICE 37). Everything is
 * permission-gated (reports.view to look, settings.manage to change state)
 * and audited. ADVISORY ONLY — none of these change store behavior; they
 * manage the watch registry, the intake inbox, and the roadmap task list.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  ingestFromText,
  ingestFromUrl,
  pollGovDeliveryFeed,
  analyzeItem,
} from "@/lib/regulatory/regulatory-ingest";
import {
  setItemStatus,
  setRoadmapStatus,
  type RegulatoryItem,
  type RoadmapItem,
} from "@/lib/regulatory/regulatory-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { extractAll } from "@/lib/regulatory/regulatory-core";

const BASE = "/admin/compliance/regulatory";

function done(params?: Record<string, string>): never {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  revalidatePath(BASE);
  redirect(`${BASE}${qs}`);
}

/** Paste a bulletin's text into the funnel. */
export async function ingestTextAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const res = await ingestFromText(title, body);
  if (!res.ok) done({ error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.ingested",
    entityType: "regulatory_item",
    entityId: res.itemId,
    after: { via: "paste", title: title.slice(0, 120), created: res.created },
  });
  done({
    saved: res.created
      ? res.analyzed
        ? "Ingested and analyzed."
        : "Ingested — analysis will appear when AI is configured."
      : "Already in the inbox (duplicate).",
  });
}

/** Fetch one official URL into the funnel. */
export async function ingestUrlAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const url = String(formData.get("url") ?? "").trim();

  const res = await ingestFromUrl(url);
  if (!res.ok) done({ error: res.error });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.ingested",
    entityType: "regulatory_item",
    entityId: res.itemId,
    after: { via: "url", url: url.slice(0, 300), created: res.created },
  });
  done({
    saved: res.created
      ? res.analyzed
        ? "Fetched and analyzed."
        : "Fetched — analysis will appear when AI is configured."
      : "Already in the inbox (duplicate).",
  });
}

/** Run the GovDelivery feed poll right now (same job as the daily cron). */
export async function checkNowAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const summary = await pollGovDeliveryFeed();

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.checked",
    entityType: "regulatory_source",
    entityId: "govdelivery-widget",
    after: {
      feedItems: summary.feedItems,
      ingested: summary.ingested,
      analyzed: summary.analyzed,
      errors: summary.errors.slice(0, 3),
    },
  });

  if (summary.errors.length > 0) done({ error: summary.errors[0] });
  done({
    saved:
      summary.ingested === 0
        ? `Checked ${summary.feedItems} bulletins — nothing new.`
        : `Ingested ${summary.ingested} new bulletin(s), analyzed ${summary.analyzed}.`,
  });
}

/** Re-run (or first-run) the AI analysis for one inbox item. */
export async function analyzeItemAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const itemId = String(formData.get("item_id") ?? "").trim();
  if (!itemId || !isSupabaseServiceConfigured) done({ error: "Item not found." });

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("regulatory_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  const item = data as RegulatoryItem | null;
  if (!item) done({ error: "Item not found." });

  const extraction = extractAll(item.title, item.body_text ?? "");
  const out = await analyzeItem({
    itemId: item.id,
    title: item.title,
    bodyText: item.body_text ?? "",
    extraction,
    publishedAt: item.published_at,
  });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.analyzed",
    entityType: "regulatory_item",
    entityId: item.id,
    after: { ok: out.ok, note: out.ok ? `proposed ${out.proposed} task(s)` : out.reason },
  });

  if (!out.ok) done({ error: out.reason });
  done({ saved: "Analysis updated." });
}

/** Triage an inbox item (reviewed / archived / back to new). */
export async function setItemStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const itemId = String(formData.get("item_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const allowed = new Set(["new", "analyzed", "reviewed", "archived"]);
  if (!itemId || !allowed.has(status)) done({ error: "Invalid request." });

  const ok = await setItemStatus(itemId, status as RegulatoryItem["status"]);
  if (!ok) done({ error: "Could not update the item." });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.item_status",
    entityType: "regulatory_item",
    entityId: itemId,
    after: { status },
  });
  done({ saved: status === "archived" ? "Archived." : "Updated." });
}

/** Flip a roadmap task's status (accept / start / done / dismiss). */
export async function setRoadmapStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const allowed = new Set(["proposed", "accepted", "in_progress", "done", "dismissed"]);
  if (!id || !allowed.has(status)) done({ error: "Invalid request." });

  const ok = await setRoadmapStatus(id, status as RoadmapItem["status"]);
  if (!ok) done({ error: "Could not update the task." });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "regulatory.roadmap_status",
    entityType: "regulatory_roadmap_item",
    entityId: id,
    after: { status },
  });
  done({ saved: "Task updated." });
}

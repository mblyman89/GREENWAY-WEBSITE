"use server";

/**
 * src/app/admin/knowledge-base/harvest/review/actions.ts — Slice H5.
 *
 * Server actions for the vendor-grouped harvest review inbox:
 *  • acceptDraftAction        — accept ONE draft into its profile field.
 *  • rejectDraftAction        — reject ONE draft (no write).
 *  • batchAcceptVendorAction  — accept every FAST-lane draft for one vendor in
 *                               one click ("accept all 14 clean drafts for
 *                               Fairwinds"). Each draft is INDIVIDUALLY
 *                               re-verified server-side: writable field, lane
 *                               bars, and the S-4 compliance re-scan gate —
 *                               client-side lane labels are never trusted.
 *  • closeSupersededAction    — reject older pending duplicates that a newer
 *                               re-harvest draft superseded (zombie cleanup).
 *
 * Drafts-only lifecycle preserved: a human clicked, the gate re-scanned, the
 * audit trail records everything. Prospect drafts (entity_id "lead:<id>") are
 * NEVER writable here — there's no row to write to until the lead is promoted.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSuggestion, reviewSuggestion, listPendingByType } from "@/lib/ai/suggestions";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import type { AiSuggestion } from "@/lib/enrichment/types";
import {
  ACCEPTABLE_FIELDS,
  FAST_LANE_MIN_CHARS,
  FAST_LANE_MIN_CONFIDENCE,
  isProspectTarget,
  newestPerField,
} from "@/lib/kb/review-lanes-core";

const REVIEW_PATH = "/admin/knowledge-base/harvest/review";

function back(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`${REVIEW_PATH}${qs ? `?${qs}` : ""}`);
}

/** Table + audit prefix for a writable entity type. */
function targetTable(entityType: string): "vendors" | "brands" | null {
  if (entityType === "vendor") return "vendors";
  if (entityType === "brand") return "brands";
  return null;
}

/**
 * Verify + apply ONE draft: writable field, prospect guard, S-4 gate, write,
 * lifecycle update, audit. Returns a failure reason string or null on success.
 * Shared by single-accept and batch-accept so the rules can't drift.
 */
async function applyDraft(
  s: AiSuggestion,
  session: { userId: string; email: string | null },
): Promise<string | null> {
  if (s.status !== "pending") return "already reviewed";
  if (isProspectTarget(s.entity_id)) return "prospect drafts unlock when the lead is promoted";
  const table = targetTable(s.entity_type);
  if (!table) return "unsupported entity";
  if (!ACCEPTABLE_FIELDS[s.entity_type]?.has(s.field_key)) return "field is reference-only";

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(s);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `${s.entity_type}.ai_accept_blocked`,
      entityType: s.entity_type,
      entityId: s.entity_id,
      after: { field: s.field_key, via: "harvest-review", ...gate.audit },
    });
    return gate.message;
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(table)
    .update({ [s.field_key]: s.suggested_value, updated_by: session.userId })
    .eq("id", s.entity_id);
  if (error) return error.message;

  await reviewSuggestion(s.id, "accepted", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `${s.entity_type}.ai_accepted`,
    entityType: s.entity_type,
    entityId: s.entity_id,
    after: { field: s.field_key, via: "harvest-review", ...gate.audit },
  });
  return null;
}

/** Accept ONE draft into its profile field (any lane except reference/prospect). */
export async function acceptDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("suggestionId") ?? "");
  if (!id) back({ error: "Missing draft." });

  const s = await getSuggestion(id);
  if (!s) back({ error: "Draft not found." });

  const failure = await applyDraft(s!, session);
  revalidatePath(REVIEW_PATH);
  if (failure) back({ error: `Not accepted: ${failure}` });
  back({ msg: "Draft accepted and saved." });
}

/** Reject ONE draft (works for reference drafts too — it's a dismiss). */
export async function rejectDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("suggestionId") ?? "");
  if (!id) back({ error: "Missing draft." });

  const s = await getSuggestion(id);
  if (!s) back({ error: "Draft not found." });

  await reviewSuggestion(id, "rejected", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `${s!.entity_type}.ai_rejected`,
    entityType: s!.entity_type,
    entityId: s!.entity_id,
    after: { field: s!.field_key, via: "harvest-review" },
  });
  revalidatePath(REVIEW_PATH);
  back({ msg: "Draft rejected." });
}

/** Per-batch cap so one click stays responsive and bounded. */
const BATCH_ACCEPT_CAP = 50;

/**
 * Batch-accept every submitted FAST-lane draft for one vendor. Every id is
 * re-verified server-side (pending, writable, fast-lane bars, S-4 gate) — a
 * draft that fails any bar is skipped and reported, never force-accepted.
 */
export async function batchAcceptVendorAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const vendorLabel = String(formData.get("vendorLabel") ?? "vendor");
  const ids = formData
    .getAll("suggestionIds")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, BATCH_ACCEPT_CAP);
  if (ids.length === 0) back({ error: "No drafts selected." });

  let accepted = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const s = await getSuggestion(id);
    if (!s) {
      skipped.push(`${id.slice(0, 8)}: not found`);
      continue;
    }
    // Server-side fast-lane re-check — never trust the client's lane label.
    const conf = typeof s.confidence === "number" ? s.confidence : 0;
    const len = String(s.suggested_value ?? "").trim().length;
    if (conf < FAST_LANE_MIN_CONFIDENCE || len < FAST_LANE_MIN_CHARS) {
      skipped.push(`${s.field_key}: not fast-lane eligible`);
      continue;
    }
    const failure = await applyDraft(s, session);
    if (failure) skipped.push(`${s.field_key}: ${failure}`);
    else accepted += 1;
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "kb.harvest_batch_accepted",
    entityType: "vendor",
    after: { vendorLabel, requested: ids.length, accepted, skipped },
  });

  revalidatePath(REVIEW_PATH);
  if (skipped.length > 0) {
    back({
      msg: `Accepted ${accepted} draft${accepted === 1 ? "" : "s"} for ${vendorLabel}.`,
      error: `Skipped ${skipped.length}: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}`,
    });
  }
  back({ msg: `Accepted ${accepted} draft${accepted === 1 ? "" : "s"} for ${vendorLabel}.` });
}

/**
 * Close out older pending duplicates superseded by a newer re-harvest draft
 * for the same (entity, field). Recomputed server-side from the live pending
 * set — no ids are trusted from the client.
 */
export async function closeSupersededAction(): Promise<void> {
  const session = await requirePermission("vendors.manage");

  const [vendorDrafts, brandDrafts] = await Promise.all([
    listPendingByType("vendor", 1000),
    listPendingByType("brand", 1000),
  ]);
  const { superseded } = newestPerField([...vendorDrafts, ...brandDrafts]);

  let closed = 0;
  for (const s of superseded.slice(0, 200)) {
    await reviewSuggestion(s.id, "rejected", session.userId);
    closed += 1;
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "kb.harvest_superseded_closed",
    entityType: "vendor",
    after: { closed },
  });

  revalidatePath(REVIEW_PATH);
  back({ msg: `Closed ${closed} superseded duplicate${closed === 1 ? "" : "s"}.` });
}

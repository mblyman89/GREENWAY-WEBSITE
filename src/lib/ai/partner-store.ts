/**
 * src/lib/ai/partner-store.ts   (D184, round slice S7)
 *
 * SERVER-ONLY. Greenway Partner: gathers live facts (read-only), builds the
 * deterministic repair proposals (partner-core), answers questions with the
 * AI grounded on those facts, and applies ONE proposal by id through its
 * approved, audited tool.
 *
 * The AI never writes and never sees a write path. applyProposal rebuilds the
 * proposals from fresh data and runs the tool only if the same id is still
 * proposed and the person may press it at the saved level.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { addPacificDays, pacificToday } from "@/lib/reports/timezone";
import { classifyExceptionReason } from "@/lib/pos/exception-retry-core";
import { retryPosException } from "@/lib/pos/sync-store";
import { morningReportNow } from "@/lib/registers/night-watch-store";
import { checkLots, checkWeek, correctCount, moveSaleLine } from "@/lib/compliance/ccrs-completeness-store";
import { weekContaining } from "@/lib/compliance/ccrs-week-core";
import {
  buildProposals,
  citedProposals,
  factsBlock,
  findProposal,
  mayApply,
  parsePartnerLevel,
  PARTNER_LEVEL_KEY,
  PARTNER_SYSTEM,
  type ExceptionFact,
  type PartnerFacts,
  type PartnerLevel,
  type PartnerTurn,
  type Proposal,
  type WeekFact,
} from "@/lib/ai/partner-core";

export { isAiConfigured };
export type { PartnerTurn };
export const PARTNER_PAGE = "/admin/partner";

// ---------------------------------------------------------------------------
// Level setting
// ---------------------------------------------------------------------------

export async function getPartnerLevel(): Promise<PartnerLevel> {
  if (!isSupabaseServiceConfigured) return parsePartnerLevel(null);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", PARTNER_LEVEL_KEY).maybeSingle();
    if (error) return parsePartnerLevel(null);
    return parsePartnerLevel((data as { value_json: unknown } | null)?.value_json ?? null);
  } catch {
    return parsePartnerLevel(null);
  }
}

export async function savePartnerLevel(level: PartnerLevel, byId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("site_settings")
    .upsert({ key: PARTNER_LEVEL_KEY, label: "Greenway Partner AI level (D184)", value_json: { level }, updated_by: byId }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Facts (read-only)
// ---------------------------------------------------------------------------

async function readExceptions(errors: string[]): Promise<ExceptionFact[]> {
  if (!isSupabaseServiceConfigured) {
    errors.push("register exceptions: database not configured");
    return [];
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pos_sale_events")
    .select("id, event_type, occurred_at, exception_reason, order_id")
    .eq("status", "exception")
    .is("resolved_at", null)
    .order("occurred_at", { ascending: true })
    .limit(100);
  if (error) {
    errors.push(`register exceptions: ${error.message}`);
    return [];
  }
  type Row = { id: string; event_type: string; occurred_at: string; exception_reason: string | null; order_id: string | null };
  return ((data as Row[] | null) ?? []).map((r) => {
    const cls = classifyExceptionReason(r.exception_reason, { eventType: r.event_type, orderId: r.order_id });
    return {
      id: r.id,
      eventType: r.event_type,
      occurredAt: r.occurred_at,
      reason: r.exception_reason ?? "",
      kind: cls.kind,
      plain: cls.plain,
      managerRetry: cls.managerRetry,
      ownerRecordAsRung: cls.ownerRecordAsRung,
      hasOrder: Boolean(r.order_id),
    };
  });
}

export async function gatherPartnerFacts(): Promise<PartnerFacts> {
  const todayIso = pacificToday();
  const readErrors: string[] = [];
  const thisWeek = weekContaining(todayIso);
  const lastWeek = weekContaining(addPacificDays(thisWeek.start, -1));
  const [exceptions, lots, wNow, wLast, morning] = await Promise.all([
    readExceptions(readErrors),
    checkLots().catch((e: unknown) => ({ shortfalls: [], aboveReceived: [], lots: 0, errors: [`lots: ${e instanceof Error ? e.message : "failed"}`] })),
    checkWeek("prod", thisWeek).catch(() => null),
    checkWeek("prod", lastWeek).catch(() => null),
    morningReportNow().catch(() => null),
  ]);
  readErrors.push(...lots.errors);
  const weeks: WeekFact[] = [];
  for (const [w, label] of [
    [wNow, "This week"],
    [wLast, "Last week"],
  ] as const) {
    if (!w) {
      readErrors.push(`${label} CCRS check failed`);
      continue;
    }
    weeks.push({ label: `${label} (${w.week.start} to ${w.week.end})`, env: w.env, status: w.result.status, headline: w.result.headline });
    readErrors.push(...w.result.readErrors);
  }
  if (!morning) readErrors.push("morning report: failed");
  return {
    todayIso,
    exceptions,
    shortfalls: lots.shortfalls,
    weeks,
    morning: morning ? { headline: morning.headline, items: morning.items } : null,
    readErrors,
  };
}

export async function partnerNow(): Promise<{ level: PartnerLevel; facts: PartnerFacts; proposals: Proposal[] }> {
  const [level, facts] = await Promise.all([getPartnerLevel(), gatherPartnerFacts()]);
  return { level, facts, proposals: buildProposals(facts, level) };
}

// ---------------------------------------------------------------------------
// Ask (the AI explains; it cannot write)
// ---------------------------------------------------------------------------

export type PartnerAnswer = { ok: true; answer: string; model: string; cited: Proposal[] } | { ok: false; error: string };

export async function askPartner(question: string, history: PartnerTurn[], actor: { id: string; email: string | null }): Promise<PartnerAnswer> {
  const q = question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 1200) return { ok: false, error: "That question is long. Try a shorter one." };
  if (!isAiConfigured) return { ok: false, error: "AI is not set up yet (AI_API_KEY missing). The fixes below still work without it." };
  const { level, facts, proposals } = await partnerNow();
  const hist = history.slice(-6).map((t) => `${t.role === "user" ? "Owner/staff" : "Partner"}: ${t.content.slice(0, 1200)}`);
  const user = [
    "LIVE FACTS (read just now from the database):",
    factsBlock(facts, proposals, level),
    "",
    hist.length ? `CONVERSATION SO FAR:\n${hist.join("\n")}\n` : "",
    `Question: "${q}"`,
    "",
    "Answer from the facts only. Cite any fix by its id.",
  ].join("\n");
  try {
    const answer = (
      await generate({
        system: PARTNER_SYSTEM,
        user,
        temperature: 0.2,
        maxTokens: 600,
        context: { feature: "partner.ask", entityType: "partner", actorId: actor.id, actorEmail: actor.email },
      })
    ).trim();
    await recordAudit({ actorId: actor.id, actorEmail: actor.email, action: "partner.ask", entityType: "partner", after: { model: aiModelId, level, proposals: proposals.length } });
    return { ok: true, answer, model: aiModelId, cited: citedProposals(answer, proposals) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The AI request failed. Try again." };
  }
}

// ---------------------------------------------------------------------------
// Apply ONE proposal (by id, re-derived from fresh data)
// ---------------------------------------------------------------------------

export type ApplyOutcome = { ok: true; message: string } | { ok: false; error: string };

export async function applyProposal(
  proposalId: string,
  actor: { id: string; email: string | null; label: string; isOwner: boolean },
): Promise<ApplyOutcome> {
  const id = proposalId.trim();
  if (!/^P-[0-9a-f]{8}$/.test(id)) return { ok: false, error: "That is not a fix id." };
  const { level, facts, proposals } = await partnerNow();
  if (facts.readErrors.length) {
    // A partial picture could hide why the fix is wrong now. Refuse, say why.
    return { ok: false, error: `Could not re-check everything before fixing (${facts.readErrors[0]}). Nothing was changed.` };
  }
  const p = findProposal(proposals, id);
  if (!p) return { ok: false, error: "That fix is no longer needed or the facts changed. Reload the page; nothing was changed." };
  if (!mayApply(p.gate, actor.isOwner)) {
    return {
      ok: false,
      error: p.gate === "explain_only" ? "The partner is on Level 1 (explain only). Michael can switch it to Level 2." : "This fix changes money, counts or CCRS, so only Michael can approve it.",
    };
  }

  let out: ApplyOutcome;
  switch (p.payload.tool) {
    case "retry_sale": {
      const r = await retryPosException(p.payload.exceptionId, { mode: "retry", actor: actor.isOwner ? "owner" : "manager", actorId: actor.id, actorLabel: actor.label });
      out = r.ok ? { ok: true, message: "The sale is recorded." } : { ok: false, error: r.error };
      break;
    }
    case "record_as_rung": {
      const r = await retryPosException(p.payload.exceptionId, { mode: "record_as_rung", actor: "owner", actorId: actor.id, actorLabel: actor.label });
      out = r.ok ? { ok: true, message: "The sale is recorded as rung." } : { ok: false, error: r.error };
      break;
    }
    case "move_sale_line":
      out = await moveSaleLine(p.payload.repair, { id: actor.id, email: actor.email });
      break;
    case "correct_count":
      out = await correctCount(p.payload.repair, { id: actor.id, email: actor.email });
      break;
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: out.ok ? "partner.fix_applied" : "partner.fix_refused",
    entityType: "partner_proposal",
    entityId: p.id,
    after: { tool: p.tool, gate: p.gate, level, title: p.title, payload: p.payload, result: out.ok ? out.message : out.error },
  });
  return out;
}

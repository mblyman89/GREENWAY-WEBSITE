"use server";

/**
 * /admin/partner: server actions (D184, round slice S7).
 *
 *   askPartnerAction      any manager type: the AI explains from live facts.
 *   applyProposalAction   any manager type may run an [auto] fix; only the
 *                         owner may run an [owner_approves] fix. The store
 *                         re-derives the proposal from fresh data by id.
 *   savePartnerLevelAction  owner only (requireBooksAccess).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { canReadBooks } from "@/lib/accounting/books-view-core";
import { recordAudit } from "@/lib/auth/audit";
import { SELECTABLE_LEVELS, parsePartnerLevel } from "@/lib/ai/partner-core";
import { applyProposal, askPartner, PARTNER_PAGE, savePartnerLevel, type PartnerAnswer, type PartnerTurn } from "@/lib/ai/partner-store";

export async function askPartnerAction(input: { question: string; history?: PartnerTurn[] }): Promise<PartnerAnswer> {
  const session = await requirePermission("staffing.manage");
  return askPartner(String(input.question ?? ""), Array.isArray(input.history) ? input.history : [], { id: session.profile.id, email: session.email });
}

export async function applyProposalAction(fd: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const id = String(fd.get("proposalId") ?? "");
  const out = await applyProposal(id, {
    id: session.profile.id,
    email: session.email,
    label: session.profile.full_name || session.email || "a manager",
    isOwner: canReadBooks(session.profile.role),
  });
  revalidatePath(PARTNER_PAGE);
  redirect(`${PARTNER_PAGE}?${out.ok ? `saved=${encodeURIComponent(out.message)}` : `error=${encodeURIComponent(out.error)}`}`);
}

export async function savePartnerLevelAction(fd: FormData): Promise<void> {
  const session = await requireBooksAccess();
  const level = parsePartnerLevel(String(fd.get("level") ?? ""));
  if (!SELECTABLE_LEVELS.includes(level)) redirect(`${PARTNER_PAGE}?error=${encodeURIComponent("That level is not open yet.")}`);
  const r = await savePartnerLevel(level, session.profile.id);
  if (!r.ok) redirect(`${PARTNER_PAGE}?error=${encodeURIComponent(r.error)}`);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "partner.level_set", entityType: "site_settings", entityId: "partner_ai_level", after: { level } });
  revalidatePath(PARTNER_PAGE);
  redirect(`${PARTNER_PAGE}?saved=${encodeURIComponent(`Partner is on Level ${level}.`)}`);
}

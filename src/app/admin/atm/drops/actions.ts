"use server";

/**
 * /admin/atm/drops server actions (D198 S5) - OWNER ONLY (finances.view).
 *
 * 1. reviewAtmDropAction: the owner's sign-off on a drop / load / day. Append-only
 *    (atm_drop_reviews, 0346), always with a written reason, and every one also lands in the
 *    Security Log (audit_logs "atm.drop_review") so the two records corroborate each other.
 * 2. saveAtmDropSettingsAction: the register's ATM-drop rules (on/off, terminal, witness policy,
 *    max $20s, match window). Audited with before/after. The daily fill amount is NOT edited here:
 *    it lives on /admin/atm/settings (D198i) and is carried through unchanged.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { validateAtmDropReview } from "@/lib/atm/atm-drop-match-core";
import { insertAtmDropReview } from "@/lib/atm/atm-drop-match-store";
import { getAtmDropSettings, saveAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";

const ROOT = "/admin/atm/drops";

function back(qs: Record<string, string | undefined>): never {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) if (v) p.set(k, v);
  revalidatePath(ROOT);
  redirect(`${ROOT}${p.toString() ? `?${p.toString()}` : ""}`);
}

export async function reviewAtmDropAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const keep = { from: String(formData.get("from") ?? "") || undefined, to: String(formData.get("to") ?? "") || undefined };
  const v = validateAtmDropReview({
    subjectKind: formData.get("subject_kind"),
    subjectId: formData.get("subject_id"),
    decision: formData.get("decision"),
    linkLoadId: formData.get("link_load_id"),
    note: formData.get("note"),
  });
  if (!v.ok) back({ ...keep, error: v.error });
  const signalCodes = String(formData.get("signal_codes") ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Z_]{3,40}$/.test(s));
  const res = await insertAtmDropReview({
    subjectKind: v.subjectKind,
    subjectId: v.subjectId,
    decision: v.decision,
    linkLoadId: v.linkLoadId,
    note: v.note,
    signalCodes,
    reviewedBy: session.profile.id,
    reviewedByEmail: session.email,
  });
  if (!res.ok) back({ ...keep, error: res.error });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "atm.drop_review",
    entityType: `atm_${v.subjectKind}`,
    entityId: v.subjectId,
    before: null,
    after: { reviewId: res.id, decision: v.decision, linkLoadId: v.linkLoadId, note: v.note, signalCodes },
  });
  back({ ...keep, msg: `Saved: ${v.decision}. It is permanent and in the Security Log.` });
}

export async function saveAtmDropSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const before = await getAtmDropSettings();
  const res = await saveAtmDropSettings(
    {
      enabled: formData.get("enabled") === "on",
      terminalId: String(formData.get("terminal_id") ?? ""),
      witness: String(formData.get("witness") ?? ""),
      maxTwentiesPerDrop: Number(formData.get("max_twenties") ?? NaN),
      matchWindowMinutes: Number(formData.get("match_window") ?? NaN),
      // D198i: the daily fill amount is owned by /admin/atm/settings (its own audit trail); kept as is here.
      fillToCents: before.fillToCents,
    },
    session.profile.id,
  );
  if (!res.ok) back({ tab: "settings", error: res.error ?? "Save failed." });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "atm.drop_settings",
    entityType: "site_settings",
    entityId: "pos_atm_drop",
    before,
    after: res.settings,
  });
  back({ tab: "settings", msg: "ATM drop settings saved. The registers pick them up on their next menu refresh." });
}

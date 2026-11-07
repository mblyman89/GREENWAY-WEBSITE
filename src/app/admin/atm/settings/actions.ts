"use server";

/**
 * /admin/atm/settings server actions (D198i) - OWNER ONLY (finances.view).
 *
 * saveAtmDailyFillAction: the ATM's daily fill amount. Owner (verbatim): "from there I should be
 * able to set a daily fill amount so it always starts the day off with the same amount."
 *
 * Controls:
 *   - owner only (finances.view), re-checked here, not just by the page;
 *   - whole $20s, $20..$100,000, typed in dollars, never rounded (parseDailyFillDollars);
 *   - stale-save guard: the form carries the amount it was opened with; if someone changed it in
 *     the meantime the save is refused, so two tabs cannot silently overwrite each other;
 *   - only this one field is written; the other ATM rules in the same settings row are kept as
 *     they are (read, merge, write);
 *   - every change is in the Security Log ("atm.daily_fill_set", before and after), which is also
 *     the page's change history. An unchanged save writes nothing.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getAtmDropSettings, saveAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";
import { fillChangeSentence, parseDailyFillDollars } from "@/lib/registers/atm-daily-fill-core";
import { DAILY_FILL_AUDIT_ACTION } from "@/lib/registers/atm-daily-fill-store";

const ROOT = "/admin/atm/settings";
const NOTE_MAX = 300;

function back(qs: { msg?: string; error?: string }): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg);
  if (qs.error) p.set("error", qs.error);
  revalidatePath(ROOT);
  revalidatePath("/admin/atm/drops");
  revalidatePath("/admin/registers/deposit-bags");
  redirect(`${ROOT}${p.toString() ? `?${p.toString()}` : ""}`);
}

export async function saveAtmDailyFillAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const parsed = parseDailyFillDollars(formData.get("daily_fill"));
  if (!parsed.ok) back({ error: parsed.error });
  const after = parsed.cents;

  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) || null;
  const before = await getAtmDropSettings();

  // Stale-save guard: "" = the page showed "not set".
  const seenRaw = String(formData.get("seen_cents") ?? "").trim();
  const seen = seenRaw === "" ? null : Number(seenRaw);
  if (seen !== before.fillToCents) {
    back({ error: "Someone changed the daily fill amount after this page was opened. Check the amount now shown, then save again. Nothing was saved." });
  }
  if (after === before.fillToCents) back({ msg: "No change: the daily fill amount was already that." });

  const res = await saveAtmDropSettings({ ...before, fillToCents: after }, session.profile.id);
  if (!res.ok) back({ error: `Not saved: ${res.error ?? "the settings could not be written"}.` });
  if (res.settings.fillToCents !== after) back({ error: "The amount was not accepted by the settings check. Nothing was changed." });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: DAILY_FILL_AUDIT_ACTION,
    entityType: "site_settings",
    entityId: "pos_atm_drop",
    before: { fillToCents: before.fillToCents, terminalId: before.terminalId },
    after: { fillToCents: after, terminalId: res.settings.terminalId, note },
  });
  back({ msg: `${fillChangeSentence(before.fillToCents, after)} The deposit bag page uses it from now on.` });
}

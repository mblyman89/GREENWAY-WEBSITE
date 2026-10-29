"use server";

/**
 * Fix Phase 2.1c — the one write on the tip tracker: a manager corrects one
 * closed drawer session's tip figure (drawer_sessions.tips_minor, 0134).
 * Managers and up (staffing.manage). A reason is required; before, after and
 * reason are audited (drawer.tips_corrected). Compare-and-swap on the old
 * value so two managers cannot overwrite each other unseen.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { getSession } from "@/lib/registers/store";
import { validateTipCorrection } from "@/lib/staffing/tips-core";
import { correctSessionTips } from "@/lib/staffing/tips-store";

const HERE = "/admin/staffing/tips";

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

export async function correctTipsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("staffing.manage");
  const sessionId = str(formData, "session_id");
  const back = str(formData, "back_query");
  const go = (k: "error" | "done", m: string) => redirect(`${HERE}?${back ? `${back}&` : ""}${k}=${encodeURIComponent(m)}`);
  if (!sessionId) go("error", "Missing drawer session.");
  const drawer = await getSession(sessionId);
  if (!drawer) go("error", "That drawer session was not found.");
  const d = drawer as NonNullable<typeof drawer>;
  const v = validateTipCorrection({ amountRaw: str(formData, "tips"), reason: str(formData, "reason"), status: d.status });
  if (!v.ok) go("error", v.error);
  const valid = v as Extract<typeof v, { ok: true }>;
  const expectedOld = Number.isSafeInteger(d.tips_minor) ? (d.tips_minor as number) : null;
  const res = await correctSessionTips({
    sessionId,
    expectedOld,
    tipsMinor: valid.tipsMinor,
    reason: valid.reason,
    actor: { id: session.userId, email: session.email },
  });
  if (!res.ok) go("error", res.error);
  revalidatePath(HERE);
  go("done", "Tip figure corrected and logged.");
}

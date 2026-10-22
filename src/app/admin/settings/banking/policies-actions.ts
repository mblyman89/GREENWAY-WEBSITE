"use server";

/**
 * R41 S18 (0291): the owner records a policy adoption, a quarterly ACH access
 * review or a yearly key check.
 *
 * OWNER ONLY (ach.act): each is the owner's own sign-off, so it is not an ACH
 * request an admin can send for approval. The 0291 trigger checks the owner
 * again, refuses backdating and never lets a row change.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { checkControlForm } from "@/lib/payments/ach-policies-core";
import { fingerprintFor, readStaffLite, recordControl } from "@/lib/payments/ach-policies-store";

const PAGE = "/admin/settings/banking/policies";
const WORD = { policy_adoption: "Policy adoption", access_review: "Access review", key_check: "Key check" } as const;
const ANCHOR = { policy_adoption: "adopt", access_review: "access", key_check: "keys" } as const;

function back(qs: { msg?: string; error?: string }, anchor: string): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(PAGE);
  redirect(`${PAGE}?${p.toString()}#${anchor}`);
}

export async function recordControlAction(fd: FormData): Promise<void> {
  const session = await requirePermission("ach.act");
  const today = pacificToday();
  const form = checkControlForm((k) => fd.get(k) as string | null, today);
  if (!form.ok) back({ error: form.error }, "top");
  const anchor = ANCHOR[form.row.kind];
  // The access-review fingerprint is of the list as the server sees it now.
  const staff = await readStaffLite();
  if (!staff.ok && form.row.kind === "access_review") back({ error: staff.error }, anchor);
  const fp = fingerprintFor(form.row, staff.ok ? staff.rows : [], today);
  const r = await recordControl({ row: form.row, textSha256: fp, actorId: session.profile.id, todayIso: today });
  if (!r.ok) back({ error: r.error }, anchor);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: `ach.control.${form.row.kind}`,
    entityType: "ach_control_records",
    entityId: r.id,
    after: { kind: form.row.kind, period_key: form.row.periodKey, item: form.row.item, item_set_on: form.row.itemSetOn },
  }).catch(() => {});
  back({ msg: `${WORD[form.row.kind]} recorded for ${form.row.periodKey}${form.row.item ? ` (${form.row.item.replace(/_/g, " ")})` : ""}.` }, anchor);
}

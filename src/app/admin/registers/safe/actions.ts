"use server";

/**
 * /admin/registers/safe — server actions (Feature slice 31).
 *
 * One action: record a count of the master till ($1,000 change fund).
 * Counts are OPEN (the $1,000 target is known policy), so the live variance
 * shows while counting — unlike drawer closes, which stay blind.
 *
 * Permission (Fix Phase 2.7a, G-13, owner D15: "anyone can count and record
 * the master count"): orders.manage, which every back-office login has
 * (owner/admin/manager/staff). Who counted is the employee whose PIN is
 * entered (F-02-4): the login only opens the page (D8: the login's StaffRole
 * for the screen, the employee for the counter).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseDenoms, formatCents } from "@/lib/registers/cash";
import { recordSafeCount } from "@/lib/registers/safe-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess } from "@/lib/security/pin-throttle-store";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { SAFE_COUNT_PIN_SCOPE, countResultWords, mixSentence } from "@/lib/registers/master-till-core";

const BASE = "/admin/registers/safe";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function fail(message: string): never {
  redirect(`${BASE}?error=` + encodeURIComponent(message));
}

/**
 * Fix Phase 2.7a (G-13, F-02-4 PIN part): the counter is the active employee
 * whose PIN this is. Same checks and throttle as the deposit bag PINs, on its
 * own scope so a lock here does not lock the register pad.
 */
async function counterFromPin(pin: string): Promise<{ id: string; full_name: string }> {
  if (!pin) fail("Enter your PIN (the employee who counted the master till). Nothing was saved.");
  if (!isValidPin(pin)) fail("A PIN is 4–6 digits. Nothing was saved.");
  const locked = await pinPadBlocked(SAFE_COUNT_PIN_SCOPE);
  if (locked) fail(locked);
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(SAFE_COUNT_PIN_SCOPE);
    // getEmployeeByPin matches active employees only (staffing/store.ts).
    fail("No active employee has that PIN. Counted by must be an active employee. Nothing was saved.");
  }
  await notePinSuccess(SAFE_COUNT_PIN_SCOPE);
  const e = emp as NonNullable<typeof emp>;
  return { id: e.id, full_name: e.full_name };
}

/** Record a master till count (AM, PM, or an extra "other" count). */
export async function recordSafeCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const window = str(formData, "count_window");
  const notes = str(formData, "notes") || null;
  const varianceReason = str(formData, "variance_reason");
  const denoms = parseDenoms((k) => formData.get(k) as string | null);

  // Fix Phase 2.3 (G-03, owner D7 "Who") made Counted by required; Fix
  // Phase 2.7a (G-13, D15) proves it: the counter enters their own PIN.
  const counter = await counterFromPin(str(formData, "counter_pin"));
  const countedBy = counter.id;

  const result = await recordSafeCount({ window, denoms, countedBy, notes, varianceReason });
  if (!result.ok) {
    if (result.varianceMinor != null && isOverShortWarning(result.varianceMinor)) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "safe.count_refused",
        entityType: "safe_count",
        entityId: null,
        after: { window, counted_by: countedBy, counted_by_name: counter.full_name, counter_verified: "pin", varianceMinor: result.varianceMinor, reason_required: true },
      });
    }
    redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "safe.counted",
    entityType: "safe_count",
    // F-02-4: the audit entry now names the count row it belongs to.
    entityId: result.id,
    after: {
      window,
      counted_by: countedBy,
      counted_by_name: counter.full_name,
      counter_verified: "pin",
      mix: countResultWords(denoms),
      varianceMinor: result.varianceMinor,
      over_short_warning: result.warning,
      variance_reason: result.reason,
      variance_reason_saved: result.reasonSaved,
    },
  });
  if (result.warning) {
    // D7 / D16: "Just warnings for now", and it applies to the master till too.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "safe.over_short_warning",
      entityType: "safe_count",
      entityId: result.id,
      after: { window, counted_by: countedBy, counted_by_name: counter.full_name, varianceMinor: result.varianceMinor, reason: result.reason },
    });
  }
  revalidatePath(BASE);
  revalidatePath("/admin/registers/over-short");
  const base =
    (result.varianceMinor === 0
      ? "Safe counted — balanced on the $1,000 target."
      : result.varianceMinor > 0
        ? `Safe counted — over the target by ${formatCents(result.varianceMinor)}.`
        : `Safe counted — short of the target by ${formatCents(Math.abs(result.varianceMinor))}.`) +
    // G-08 requirement 3: the mix is reported apart from the total.
    ` Counted by ${counter.full_name}. ${mixSentence(denoms)}`;
  const extra =
    (result.warning ? " Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings." : "") +
    (result.reason && !result.reasonSaved
      ? " The reason is in the Security Log only: migration 0315 is not applied yet."
      : "");
  redirect(`${BASE}?counted=` + encodeURIComponent(base + extra));
}

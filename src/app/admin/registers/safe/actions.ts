"use server";

/**
 * /admin/registers/safe — server actions (Feature slice 31).
 *
 * Two actions: record a count of the master till ($1,000 change fund), and
 * (Fix Phase 2.7b, G-02) record a master till <-> little safe exchange.
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
import { recordLittleSafeExchange, recordSafeCount } from "@/lib/registers/safe-store";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess } from "@/lib/security/pin-throttle-store";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";
import { SAFE_COUNT_PIN_SCOPE, countResultWords, mixSentence } from "@/lib/registers/master-till-core";
import {
  IN_PREFIX,
  LITTLE_SAFE_PIN_SCOPE,
  OUT_PREFIX,
  compactDenoms,
  denomWords,
  readDenoms,
  validateExchange,
} from "@/lib/registers/little-safe-core";

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

/**
 * Fix Phase 2.7b (G-02, owner D3): record one master till <-> little safe
 * exchange. Any employee (the owner: "Either morning or night employee can
 * balance the master till"), proved by their PIN on its own throttle scope.
 * Both sides by denomination; the server refuses unequal sides
 * (little-safe-core#validateExchange) and so does the database (0317).
 */
export async function recordLittleSafeExchangeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const outRead = readDenoms((k) => formData.get(OUT_PREFIX + k));
  if (!outRead.ok) fail(`OUT of the master till: ${outRead.error} Nothing was saved.`);
  const inRead = readDenoms((k) => formData.get(IN_PREFIX + k));
  if (!inRead.ok) fail(`IN from the little safe: ${inRead.error} Nothing was saved.`);
  const outDenoms = (outRead as Extract<typeof outRead, { ok: true }>).denoms;
  const inDenoms = (inRead as Extract<typeof inRead, { ok: true }>).denoms;
  const v = validateExchange({ outDenoms, inDenoms, notes: str(formData, "exchange_notes") });
  if (!v.ok) fail(v.error);
  const ex = (v as Extract<typeof v, { ok: true }>).exchange;

  const pin = str(formData, "exchange_pin");
  if (!pin) fail("Enter your PIN (the employee who did the exchange). Nothing was saved.");
  if (!isValidPin(pin)) fail("A PIN is 4\u20136 digits. Nothing was saved.");
  const locked = await pinPadBlocked(LITTLE_SAFE_PIN_SCOPE);
  if (locked) fail(locked);
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(LITTLE_SAFE_PIN_SCOPE);
    fail("No active employee has that PIN. The exchange must be recorded by an active employee. Nothing was saved.");
  }
  await notePinSuccess(LITTLE_SAFE_PIN_SCOPE);
  const who = emp as NonNullable<typeof emp>;

  const result = await recordLittleSafeExchange({
    outDenoms: compactDenoms(ex.outDenoms),
    inDenoms: compactDenoms(ex.inDenoms),
    valueMinor: ex.valueMinor,
    recordedBy: who.id,
    notes: ex.notes,
  });
  if (!result.ok) fail(result.error);
  const saved = result as Extract<typeof result, { ok: true }>;

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "safe.little_safe_exchange",
    entityType: "little_safe_exchange",
    entityId: saved.id,
    after: {
      recorded_by: who.id,
      recorded_by_name: who.full_name,
      recorder_verified: "pin",
      value_minor: ex.valueMinor,
      out_of_master_till: denomWords(ex.outDenoms),
      in_from_little_safe: denomWords(ex.inDenoms),
      notes: ex.notes,
    },
  });
  revalidatePath(BASE);
  redirect(
    `${BASE}?counted=` +
      encodeURIComponent(
        `Little safe exchange recorded by ${who.full_name}: OUT of the master till ${denomWords(ex.outDenoms)}; ` +
          `IN from the little safe ${denomWords(ex.inDenoms)}; ${formatCents(ex.valueMinor)} each side.`,
      ),
  );
}

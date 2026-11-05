import "server-only";
/**
 * src/lib/registers/drawer-correction-store.ts  (owner D127)
 *
 * Correct the counted cash on a RECONCILED drawer. The rules live in
 * drawer-correction-core.ts#checkCorrection; this file only reads what the
 * rules need (sealed bag? ledger entry?) and writes the change with a
 * compare-and-set, so two people correcting at once cannot both land.
 *
 * D180 (S3, migration 0343): the corrected figure goes in
 * reconciled_count_minor, NEVER closing_count_minor (the closer's own blind
 * count is kept exactly as typed; a 0343 trigger enforces it). Before 0343 is
 * applied the old path (closing_count_minor) is the fallback. over_short_minor
 * / over_short_reason change too, and the old and new figures are appended
 * to the drawer's notes, and the full before/after goes in the audit log
 * (the caller records it). The books are not touched: a drawer with a ledger
 * entry is refused.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getSession } from "@/lib/registers/store";
import { tillCloseSourceRef } from "@/lib/registers/drawer-posting-service";
import { countedCashMinor } from "@/lib/registers/count-integrity-core";
import { checkCorrection, correctionNote, appendNote, correctedReason } from "@/lib/registers/drawer-correction-core";

export type CorrectionResult =
  | {
      ok: true;
      oldCountMinor: number;
      newCountMinor: number;
      oldOverShortMinor: number;
      newOverShortMinor: number;
      expectedMinor: number;
      oldReason: string | null;
      newReason: string;
      reason: string;
      note: string;
    }
  | { ok: false; error: string };

/** True when any sealed deposit bag carries this drawer. Unknown (read error) is reported as an error. */
async function inSealedBag(sessionId: string): Promise<{ ok: true; sealed: boolean } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const links = await admin.from("deposit_bag_sessions").select("bag_id").eq("session_id", sessionId);
  if (links.error) return { ok: false, error: `Deposit bags could not be read: ${links.error.message}` };
  const bagIds = ((links.data as { bag_id: string }[] | null) ?? []).map((l) => l.bag_id);
  if (bagIds.length === 0) return { ok: true, sealed: false };
  const bags = await admin.from("deposit_bags").select("id").in("id", bagIds).not("sealed_at", "is", null).limit(1);
  if (bags.error) return { ok: false, error: `Deposit bags could not be read: ${bags.error.message}` };
  return { ok: true, sealed: ((bags.data as unknown[] | null) ?? []).length > 0 };
}

/** True when a draft or posted ledger entry stands for this drawer's close. */
async function hasJournal(sessionId: string): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("gl_journals")
    .select("id")
    .eq("source_ref", tillCloseSourceRef(sessionId))
    .in("status", ["draft", "posted"])
    .limit(1);
  if (error) return { ok: false, error: `The books could not be read: ${error.message}` };
  return { ok: true, exists: ((data as unknown[] | null) ?? []).length > 0 };
}

export async function correctReconciledDrawer(opts: {
  sessionId: string;
  basis: string;
  typedRaw: string;
  reason: string;
  /** Who, for the note (the signed-in login's email). */
  who: string;
  /** The signed-in person's employee record, for over_short_reason_by (may be null). */
  correctedBy: string | null;
  whenLabel: string;
}): Promise<CorrectionResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const session = await getSession(opts.sessionId);
  if (!session) return { ok: false, error: "Drawer not found." };
  const [sealed, journal] = await Promise.all([inSealedBag(opts.sessionId), hasJournal(opts.sessionId)]);
  // A read we could not make is not "no": refuse rather than guess.
  if (!sealed.ok) return { ok: false, error: `${sealed.error} Nothing was changed.` };
  if (!journal.ok) return { ok: false, error: `${journal.error} Nothing was changed.` };

  const check = checkCorrection({
    status: session.status,
    currentCountMinor: countedCashMinor(session),
    expectedMinor: session.expected_close_minor,
    secondMinor: session.second_count_minor ?? null,
    basis: opts.basis,
    typedRaw: opts.typedRaw,
    reason: opts.reason,
    sealed: sealed.sealed,
    journalExists: journal.exists,
  });
  if (!check.ok) return check;

  const oldCount = countedCashMinor(session) as number;
  const hasReconciledCol = typeof session.reconciled_count_minor === "number";
  const note = correctionNote({
    whenLabel: opts.whenLabel,
    who: opts.who,
    oldCountMinor: oldCount,
    newCountMinor: check.newCountMinor,
    oldOverShortMinor: check.oldOverShortMinor,
    newOverShortMinor: check.newOverShortMinor,
    reason: check.reason,
  });
  const oldReason = session.over_short_reason ?? null;
  const newReason = correctedReason(oldReason, check.reason);

  const admin = createSupabaseAdminClient();
  const missingCol = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
  const update = (with0343: boolean, withReason: boolean) => {
    let q = admin
      .from("drawer_sessions")
      .update({
        ...(with0343 ? { reconciled_count_minor: check.newCountMinor } : { closing_count_minor: check.newCountMinor }),
        over_short_minor: check.newOverShortMinor,
        notes: appendNote(session.notes, note),
        ...(withReason ? { over_short_reason: newReason, over_short_reason_by: opts.correctedBy } : {}),
      })
      .eq("id", opts.sessionId)
      .eq("status", "reconciled");
    // Compare-and-set on the figure the person was looking at.
    if (!with0343) q = q.eq("closing_count_minor", oldCount);
    else if (hasReconciledCol) q = q.eq("reconciled_count_minor", oldCount);
    else q = q.is("reconciled_count_minor", null).eq("closing_count_minor", oldCount);
    return q.select("id");
  };
  let { data, error } = await update(true, true);
  if (missingCol(error)) ({ data, error } = await update(false, true));
  if (missingCol(error)) ({ data, error } = await update(false, false));
  if (error) return { ok: false, error: `${error.message} Nothing was changed.` };
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: "Someone changed this drawer a moment ago. Reload the page. Nothing was changed." };
  }
  return {
    ok: true,
    oldCountMinor: oldCount,
    newCountMinor: check.newCountMinor,
    oldOverShortMinor: check.oldOverShortMinor,
    newOverShortMinor: check.newOverShortMinor,
    expectedMinor: session.expected_close_minor as number,
    oldReason,
    newReason,
    reason: check.reason,
    note,
  };
}

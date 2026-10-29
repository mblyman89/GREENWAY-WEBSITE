import "server-only";

/**
 * src/lib/accounting/seal-bag-posting-service.ts  (Fix Phase 2.6 · G-14)
 *
 * THE WIRE that books a sealed deposit bag. The judgement lives in
 * register-cash-journal-core.ts#buildSealBagJournal (books-98); this file
 * reads the bag, asks the builder, posts, and records which books entry it
 * made. Before Phase 2.6 nothing called the builder: the census row
 * cash_and_banking.seal_deposit_bag said "poster: null, reachable: MISSING",
 * and the Phase 2.5 bank door refused every deposit because no bag was ever
 * sealed into 10400 Undeposited Funds.
 *
 * THE CHAIN, LINK BY LINK (rule 133b)
 *   an employee seals the bag on /admin/registers/deposit-bags
 *     -> sealBagAction (permission, PIN, checkSeal)
 *     -> deposit-bag-store.ts#saveSeal (status deposited, sealed_at, once)
 *     -> postSealForBag(bagId)                      <- this file
 *     -> buildSealBagJournal (pure) decides or refuses
 *     -> submitJournal, autoPost, sourceRef `seal-bag:<bag id>`
 *     -> DEBIT 10400 Undeposited Funds / CREDIT 10100 Vault
 *     -> deposit-bag-store.ts#saveSealJournalId (filled once; 0316 trigger)
 *
 * WHY THE JOURNAL DATE IS THE BAG'S BUSINESS DAY
 * The bank door (deposit-clearing-service#undepositedBalanceMinor) folds
 * 10400 debits under their journal date, and clears the OLDEST day first.
 * The bag carries one business day's takings (owner: "The end of the day, the
 * safe money goes into the deposit bag with an id", 0212 L6-10), so dating the
 * entry on that business day is what lets the bank credit retire that day.
 *
 * WHY A FAILED POST DOES NOT UNDO THE SEAL
 * The seal is a physical fact: the tamper-evident bag (D26) is closed and
 * cannot be reopened. Unsealing the record because the ledger was down would
 * make the screen disagree with the bag in the safe. The bag keeps no
 * seal_journal_id instead, the bag screen and its log say "NOT POSTED", and
 * pressing "Post to the books" retries. The source ref makes a retry safe:
 * submitJournal returns "duplicate" rather than writing twice.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { buildSealBagJournal } from "@/lib/accounting/register-cash-journal-core";
import { sealSourceRef } from "@/lib/registers/deposit-bag-flow-core";

export type SealPostOutcome =
  | { kind: "posted"; bagId: string; sourceRef: string; journalId: string | null; journalNo: number | null; duplicate: boolean; message: string; linkError: string | null }
  | { kind: "refused"; bagId: string; code: string; message: string }
  | { kind: "failed"; bagId: string; sourceRef: string | null; code: string; message: string };

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Post the seal entry for one SEALED bag. Safe to call again: the source ref
 * is the bag id, so a second call is answered "duplicate".
 */
export async function postSealForBag(bagId: string, client?: Admin): Promise<SealPostOutcome> {
  if (!client && !isSupabaseServiceConfigured) {
    return { kind: "failed", bagId, sourceRef: null, code: "NOT_CONFIGURED", message: "Supabase is not configured, so nothing was posted." };
  }
  const admin = client ?? createSupabaseAdminClient();
  const { data, error } = await admin
    .from("deposit_bags")
    .select("id, bag_no, business_day, status, amount_minor, sealed_at, seal_journal_id")
    .eq("id", bagId)
    .maybeSingle();
  if (error) return { kind: "failed", bagId, sourceRef: null, code: "READ_FAILED", message: `The bag could not be read: ${error.message}` };
  const bag = data as {
    id: string;
    bag_no: string;
    business_day: string;
    status: string;
    amount_minor: number | null;
    sealed_at: string | null;
    seal_journal_id: string | null;
  } | null;
  if (!bag) return { kind: "refused", bagId, code: "BAG_NOT_FOUND", message: "That bag was not found. Nothing was posted." };
  // Only a sealed bag moves money out of the safe (D23: unsealed overnight).
  if (!bag.sealed_at || bag.status !== "deposited") {
    return { kind: "refused", bagId, code: "BAG_NOT_SEALED", message: `Bag ${bag.bag_no} is not sealed yet, so nothing was posted. The money is still in the safe.` };
  }
  if (bag.amount_minor == null) {
    return { kind: "refused", bagId, code: "BAG_NO_AMOUNT", message: `Bag ${bag.bag_no} has no counted amount, so nothing was posted.` };
  }

  const built = buildSealBagJournal({
    journalDate: bag.business_day,
    bagNo: bag.bag_no,
    amountMinor: bag.amount_minor,
    sourceRef: sealSourceRef(bag.id),
  });
  if (built.kind === "refused") return { kind: "refused", bagId, code: built.code, message: built.explanation };
  if (built.kind !== "journal") {
    return { kind: "refused", bagId, code: built.code, message: built.explanation };
  }

  const sourceRef = sealSourceRef(bag.id);
  const result = await submitJournal(
    {
      entityCode: built.journal.entityCode,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: built.journal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
      // 'bank' is approval-exempt (as for the drawer close): sealing the bag
      // in front of the camera IS the human act.
      autoPost: true,
    },
    admin,
  );
  if (!result.ok) {
    return { kind: "failed", bagId, sourceRef, code: result.code, message: result.message };
  }

  // Record which entry the seal made. The 0316 trigger lets this column be
  // filled once and never changed.
  let linkError: string | null = null;
  const journalId = result.journalId ?? null;
  if (journalId && !bag.seal_journal_id) {
    const { error: upErr } = await admin.from("deposit_bags").update({ seal_journal_id: journalId }).eq("id", bag.id).is("seal_journal_id", null);
    if (upErr) linkError = upErr.message;
  }
  const duplicate = result.outcome === "duplicate";
  return {
    kind: "posted",
    bagId,
    sourceRef,
    journalId,
    journalNo: result.journalNo ?? null,
    duplicate,
    message: duplicate ? `Bag ${bag.bag_no} was already in the books. Nothing was written twice.` : built.explanation,
    linkError,
  };
}

/** One sentence for the redirect banner. A new kind fails to compile here. */
export function describeSealPost(o: SealPostOutcome): string {
  switch (o.kind) {
    case "posted":
      return o.duplicate
        ? "Already in the books, not booked twice."
        : `Posted to the books${o.journalNo != null ? ` as entry #${o.journalNo}` : ""}: 10400 Undeposited Funds up, 10100 Vault down.`;
    case "refused":
      return `NOT POSTED: ${o.message}`;
    case "failed":
      return `NOT POSTED: ${o.message} The bag stays sealed; press "Post to the books" to try again.`;
  }
}

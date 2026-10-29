"use server";

/**
 * /admin/registers/deposit-bags — server actions (Fix Phase 2.6 · G-04, G-14).
 *
 * The owner's flow (original request): night count -> morning recount -> seal
 * the bag -> safe -> bank. The owner's rules (00-OWNER-REQUEST-VERBATIM.md
 * L87–93):
 *   D23 counted cash sits UNSEALED in the store safe overnight;
 *   D24 "no second count at night, just the recount in the morning by any
 *       employee" — one person at night, a DIFFERENT person in the morning;
 *   D25 "anyone can seal the bag, I am the only one to take cash to the bank";
 *   D26 tamper-evident pre-numbered bags;
 *   D27 "warning only please" — an undeclared bag warns, never blocks;
 *   D21 a reason is required only over $5.
 *
 * Who may press what:
 *   night count, morning recount, seal  -> orders.manage (any staff login)
 *     plus the PIN of the employee who did the count/seal, so the record
 *     names the PERSON, not the shared back-office login.
 *   bank run                            -> requireBooksAccess (owner only, D25)
 *
 * Every write goes through deposit-bag-store.ts (service role). Migration
 * 0316 removed the staff write policy and made a sealed bag permanent
 * (F-03-9). Every action writes an audit row, refusals included where they
 * matter (a same-person recount, a counts-differ recount without a reason).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { recordAudit } from "@/lib/auth/audit";
import { parseDenoms, denomTotalMinor, formatCents } from "@/lib/registers/cash";
import { getEmployeeByPin } from "@/lib/staffing/store";
import { isValidPin } from "@/lib/staffing/time";
import { pinPadBlocked, notePinFailure, notePinSuccess } from "@/lib/security/pin-throttle-store";
import { pacificToday } from "@/lib/reports/timezone";
import {
  DEPOSIT_BAG_PIN_SCOPE,
  parseBusinessDay,
  checkNightCount,
  nightVsExpected,
  checkMorningRecount,
  compareNightMorning,
  checkRecountReason,
  statusAfterRecount,
  checkSeal,
  depositCashInSafeMinor,
  depositShapeNotice,
  checkBankRecord,
  sealedLeftBehind,
  RECOUNT_SAME_PERSON_ERROR,
} from "@/lib/registers/deposit-bag-flow-core";
import {
  bagForDay,
  drawersForDay,
  getBag,
  insertNightCount,
  listBags,
  saveBanked,
  saveMorningRecount,
  saveSeal,
} from "@/lib/registers/deposit-bag-store";
import { postSealForBag, describeSealPost } from "@/lib/accounting/seal-bag-posting-service";

const BASE = "/admin/registers/deposit-bags";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function fail(msg: string): never {
  redirect(`${BASE}?error=` + encodeURIComponent(msg));
}

function done(msg: string): never {
  revalidatePath(BASE);
  revalidatePath("/admin/registers");
  revalidatePath("/admin/registers/eod");
  redirect(`${BASE}?done=` + encodeURIComponent(msg));
}

/** The employee behind a PIN, throttled like the till pad. */
async function employeeFromPin(pin: string, who: string): Promise<{ id: string; full_name: string }> {
  if (!pin) fail(`Enter the PIN of ${who}. Nothing was saved.`);
  if (!isValidPin(pin)) fail("A PIN is 4–6 digits. Nothing was saved.");
  const locked = await pinPadBlocked(DEPOSIT_BAG_PIN_SCOPE);
  if (locked) fail(locked);
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await notePinFailure(DEPOSIT_BAG_PIN_SCOPE);
    fail("No active employee has that PIN. Nothing was saved.");
  }
  await notePinSuccess(DEPOSIT_BAG_PIN_SCOPE);
  const e = emp as NonNullable<typeof emp>;
  return { id: e.id, full_name: e.full_name };
}

/* ── 1. Night count (SOP-03 §4.5–4.6): one person, bag left UNSEALED ─────── */

export async function nightCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const dayRes = parseBusinessDay(str(formData, "business_day"), pacificToday());
  if (!dayRes.ok) fail(dayRes.error);
  const day = dayRes.day;
  const denoms = parseDenoms((k) => formData.get(`night_${k}`) as string | null);
  const countMinor = denomTotalMinor(denoms);
  const closer = await employeeFromPin(str(formData, "night_pin"), "the employee who counted the deposit");

  const existing = await bagForDay(day);
  if (!existing.ok) fail(`The bags for ${day} could not be read: ${existing.error}. Nothing was saved.`);
  const drawers = await drawersForDay(day);
  if (!drawers.ok) fail(`${drawers.error} Nothing was saved.`);

  const chk = checkNightCount({
    bagNo: str(formData, "bag_no"),
    countMinor,
    closerId: closer.id,
    existingBagNoForDay: existing.bagNo,
    note: str(formData, "night_note"),
  });
  if (!chk.ok) fail(chk.error);
  const vs = nightVsExpected(countMinor, drawers.expected.expectedMinor);

  const saved = await insertNightCount({
    bagNo: chk.bagNo,
    businessDay: day,
    countMinor,
    denoms,
    closerId: closer.id,
    expected: drawers.expected,
    note: chk.note,
  });
  if (!saved.ok) fail(saved.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "deposit_bag.night_counted",
    entityType: "deposit_bag",
    entityId: saved.id,
    after: {
      bagNo: chk.bagNo,
      businessDay: day,
      nightCountMinor: countMinor,
      nightCountedBy: closer.id,
      nightCountedByName: closer.full_name,
      expectedMinor: drawers.expected.expectedMinor,
      diffFromExpectedMinor: vs.diffMinor,
      expectedProblems: drawers.expected.problems,
      note: chk.note,
      ...(saved.linkError ? { drawerLinkError: saved.linkError } : {}),
    },
  });
  done(
    `Bag ${chk.bagNo} counted at ${formatCents(countMinor)} by ${closer.full_name} for ${day}. ${vs.sentence} ` +
      "Put it in the store safe UNSEALED, with the night sheet; a different employee recounts it in the morning (D23, D24)." +
      (saved.linkError ? ` The drawers could not be linked to the bag (${saved.linkError}); the bag itself is saved.` : ""),
  );
}

/* ── 2. Morning recount (SOP-03 §4.10): a DIFFERENT employee ─────────────── */

export async function morningRecountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const bagId = str(formData, "bag_id");
  if (!bagId) fail("Missing bag.");
  const got = await getBag(bagId);
  if (!got.ok) fail(`The bag could not be read: ${got.error}. Nothing was saved.`);
  if (!got.bag) fail("That bag was not found. Nothing was saved.");
  const bag = got.bag;
  const denoms = parseDenoms((k) => formData.get(`morning_${k}`) as string | null);
  const countMinor = denomTotalMinor(denoms);
  const recounter = await employeeFromPin(str(formData, "morning_pin"), "the employee doing the morning recount");

  const chk = checkMorningRecount({
    status: bag.status,
    sealed: bag.sealedAt !== null,
    nightCounterId: bag.nightCountedBy,
    recounterId: recounter.id,
    countMinor,
  });
  if (!chk.ok) {
    if (chk.error === RECOUNT_SAME_PERSON_ERROR) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "deposit_bag.recount_refused",
        entityType: "deposit_bag",
        entityId: bag.id,
        after: { bagNo: bag.bagNo, reason: "same_person_as_night_count", employeeId: recounter.id, employeeName: recounter.full_name },
      });
    }
    fail(chk.error);
  }

  const night = bag.nightCountMinor ?? countMinor;
  const cmp = compareNightMorning(night, countMinor);
  const reason = checkRecountReason(cmp.diffMinor, str(formData, "variance_reason"));
  if (!reason.ok) {
    // D21: over $5 needs a reason before the bag can be declared. Keep the
    // refused count in the Security Log so a second try cannot hide it.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "deposit_bag.recount_refused",
      entityType: "deposit_bag",
      entityId: bag.id,
      after: { bagNo: bag.bagNo, reason: "difference_over_5_without_reason", nightCountMinor: night, morningCountMinor: countMinor, diffMinor: cmp.diffMinor, employeeId: recounter.id },
    });
    fail(`${cmp.sentence} ${reason.error} Do not seal the bag; recount with the manager (SOP-03 §4.10).`);
  }
  const status = statusAfterRecount(cmp, reason.reason);
  const saved = await saveMorningRecount({ bagId: bag.id, countMinor, denoms, recounterId: recounter.id, reason: reason.reason, status });
  if (!saved.ok) fail(saved.error);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "deposit_bag.recounted",
    entityType: "deposit_bag",
    entityId: bag.id,
    after: {
      bagNo: bag.bagNo,
      businessDay: bag.businessDay,
      nightCountMinor: bag.nightCountMinor,
      morningCountMinor: countMinor,
      diffMinor: cmp.diffMinor,
      overFiveDollars: cmp.needsReason,
      reason: reason.reason,
      recountedBy: recounter.id,
      recountedByName: recounter.full_name,
      status,
    },
  });
  done(
    `${cmp.sentence} Recounted by ${recounter.full_name}. ` +
      (status === "counted" ? `Bag ${bag.bagNo} is ready to seal.` : `Bag ${bag.bagNo} is NOT ready to seal.`),
  );
}

/* ── 3. Seal (SOP-03 §4.11): anyone (D25); posts 10400 <- 10100 ─────────── */

export async function sealBagAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const bagId = str(formData, "bag_id");
  if (!bagId) fail("Missing bag.");
  const got = await getBag(bagId);
  if (!got.ok) fail(`The bag could not be read: ${got.error}. Nothing was saved.`);
  if (!got.bag) fail("That bag was not found. Nothing was saved.");
  const bag = got.bag;
  const sealer = await employeeFromPin(str(formData, "seal_pin"), "the employee sealing the bag");

  const chk = checkSeal(bag, { bagNo: str(formData, "seal_bag_no") || bag.bagNo, sealerId: sealer.id });
  if (!chk.ok) fail(chk.error);

  const saved = await saveSeal({ bagId: bag.id, bagNo: chk.bagNo, amountMinor: chk.amountMinor, sealerId: sealer.id });
  if (!saved.ok) fail(saved.error);

  // The bag is sealed (a physical fact). Now the books.
  const post = await postSealForBag(bag.id);

  // F-03-10: the $10,000 shape mirror, at seal time. Never a block.
  const all = await listBags({ sinceDay: bag.businessDay });
  const leftInSafe = all.ok ? depositCashInSafeMinor(all.bags, [bag.id]) : null;
  const shape = leftInSafe === null ? null : depositShapeNotice(chk.amountMinor, leftInSafe);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "deposit_bag.sealed",
    entityType: "deposit_bag",
    entityId: bag.id,
    after: {
      bagNo: chk.bagNo,
      originalBagNo: bag.bagNo !== chk.bagNo ? bag.bagNo : undefined,
      businessDay: bag.businessDay,
      amountMinor: chk.amountMinor,
      sealedBy: sealer.id,
      sealedByName: sealer.full_name,
      books: post.kind,
      ...(post.kind === "posted" ? { journalId: post.journalId, journalNo: post.journalNo, duplicate: post.duplicate, sourceRef: post.sourceRef } : { code: post.code, message: post.message }),
      ...(shape ? { depositShapeNotice: shape.code } : {}),
    },
  });
  done(
    `Bag ${chk.bagNo} sealed at ${formatCents(chk.amountMinor)} by ${sealer.full_name}. Put it in the "SEALED — TO BANK" slot of the store safe. ` +
      describeSealPost(post) +
      (shape ? ` ${shape.message}` : ""),
  );
}

/** Retry the books entry for a sealed bag whose post failed. Idempotent by bag id. */
export async function retrySealPostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const bagId = str(formData, "bag_id");
  if (!bagId) fail("Missing bag.");
  const post = await postSealForBag(bagId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "deposit_bag.seal_post_retried",
    entityType: "deposit_bag",
    entityId: bagId,
    after: { books: post.kind, ...(post.kind === "posted" ? { journalId: post.journalId, duplicate: post.duplicate } : { code: post.code, message: post.message }) },
  });
  if (post.kind !== "posted") fail(describeSealPost(post));
  done(describeSealPost(post));
}

/* ── 4. Bank run (SOP-03 §4.13): the owner only (D25) ───────────────────── */

export async function bankRunAction(formData: FormData): Promise<void> {
  const session = await requireBooksAccess();
  const ids = formData.getAll("bag_ids").map((v) => String(v)).filter(Boolean);
  const bankedOn = str(formData, "banked_on");
  const all = await listBags({ sinceDay: pacificToday() });
  if (!all.ok) fail(`The bags could not be read: ${all.error}. Nothing was saved.`);
  const chk = checkBankRecord(all.bags, ids, bankedOn, str(formData, "bank_note"));
  if (!chk.ok) fail(chk.error);
  const left = sealedLeftBehind(all.bags, ids);
  // SOP-03 §4.14: take ALL sealed bags; if any stay behind, write why AT THE TIME.
  if (left.length > 0 && !chk.note) {
    fail(
      `${left.length === 1 ? "Bag" : "Bags"} ${left.map((b) => b.bagNo).join(", ")} ${left.length === 1 ? "is" : "are"} sealed and not ticked. ` +
        "Take every sealed bag (SOP-03 §4.14), or write in the note why it stays behind. Nothing was saved.",
    );
  }
  const shape = depositShapeNotice(chk.totalMinor, depositCashInSafeMinor(all.bags, ids));
  const saved = await saveBanked({ bagIds: chk.bags.map((b) => b.id), bankedOn: bankedOn, ownerStaffId: session.userId, note: chk.note });
  if (!saved.ok) fail(saved.error);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "deposit_bag.banked",
    entityType: "deposit_bag",
    entityId: saved.saved.join(","),
    after: {
      bankedOn,
      bags: chk.bags.map((b) => ({ id: b.id, bagNo: b.bagNo, businessDay: b.businessDay })),
      totalMinor: chk.totalMinor,
      note: chk.note,
      leftBehind: left.map((b) => b.bagNo),
      ...(shape ? { depositShapeNotice: shape.code } : {}),
      savedCount: saved.saved.length,
    },
  });
  const skipped = chk.bags.length - saved.saved.length;
  done(
    `${saved.saved.length} ${saved.saved.length === 1 ? "bag" : "bags"} (${formatCents(chk.totalMinor)}) recorded as taken to the bank on ${bankedOn}. ` +
      (skipped > 0 ? `${skipped} were already recorded and were not written twice. ` : "") +
      "When the bank deposit shows on Books → Bank, press Clear against bags on that line. " +
      (shape ? shape.message : ""),
  );
}

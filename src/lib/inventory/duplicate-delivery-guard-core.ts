/**
 * src/lib/inventory/duplicate-delivery-guard-core.ts  (D215, PURE)
 *
 * Owner, verbatim (D215): "It's a duplicate, please remove it. Then build 1-3"
 * - item 2: a "This looks like a duplicate of [delivery]" warning on the
 * delivery page and before lots are made Active.
 *
 * WHY. On 2026-11-08 the ten lots of the Green Revolution COPY (delivery
 * 156b8d15, the same email read a second time) were switched from quarantine
 * to Active one by one ("should be active"). Each was a lot that was already
 * on the shelf through the real delivery (1de6e4f4), so Inventory showed 150
 * phantom units with no cost. Nothing on the lot page said "this delivery is a
 * copy of another one".
 *
 * THE RULE. Making a lot Active - or finalizing its delivery - is refused
 * while its delivery is a suspected duplicate of another live delivery. The
 * way forward is the Dismiss duplicate button on the delivery page. If the
 * owner has checked and the two really are separate deliveries, ticking "I
 * checked: this is NOT a duplicate" lets it through and the audit row says so.
 */

export type DuplicateSuspect = { keepId: string; why: string } | null;

export type DuplicateGuardDecision =
  | { ok: true; overridden: boolean }
  | { ok: false; code: "suspected_duplicate_delivery"; message: string };

/** Short, readable delivery reference for messages. PURE. */
export function shortDeliveryRef(id: string): string {
  return String(id ?? "").slice(0, 8);
}

/**
 * May this step go ahead? `step` "activate" = a lot set to Active; "finalize"
 * = the delivery finalized. Any other status change (quarantine, hold,
 * rejected ...) is never blocked - taking stock OFF the shelf is always
 * allowed. PURE.
 */
export function duplicateDeliveryGuard(input: {
  step: "activate" | "finalize" | "other";
  suspect: DuplicateSuspect;
  /** The "I checked: this is NOT a duplicate" tick. */
  confirmedNotDuplicate: boolean;
}): DuplicateGuardDecision {
  if (input.step === "other" || !input.suspect) return { ok: true, overridden: false };
  if (input.confirmedNotDuplicate) return { ok: true, overridden: true };
  const ref = shortDeliveryRef(input.suspect.keepId);
  const what = input.step === "activate" ? "This lot cannot be made Active" : "This delivery cannot be finalized";
  return {
    ok: false,
    code: "suspected_duplicate_delivery",
    message: `${what}: its delivery looks like a DUPLICATE of delivery ${ref} (${input.suspect.why}). Activating it would count the same product twice. Open the delivery and use Dismiss duplicate - or, if you have checked and they really are two separate deliveries, tick "I checked: this is NOT a duplicate" and try again.`,
  };
}

/** The lot status-change step for a target status. PURE. */
export function guardStepForStatus(toStatus: string | null | undefined): "activate" | "other" {
  return String(toStatus ?? "").trim().toLowerCase() === "active" ? "activate" : "other";
}

export function __runDuplicateDeliveryGuardTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL duplicate-delivery-guard: ${m}`);
    }
  };
  const suspect = { keepId: "1de6e4f4-a8b5-4226-bcab-76a1aeabbbcc", why: "same manifest # 11025403383270277 from the same vendor" };
  const r = duplicateDeliveryGuard({ step: "activate", suspect, confirmedNotDuplicate: false });
  ok(!r.ok && r.code === "suspected_duplicate_delivery", "the owner's case: Active refused on a copy's lot");
  ok(!r.ok && r.message.includes("1de6e4f4") && r.message.includes("Dismiss duplicate"), "message names the other delivery and the way forward");
  ok(!duplicateDeliveryGuard({ step: "finalize", suspect, confirmedNotDuplicate: false }).ok, "finalize refused on a copy");
  const o = duplicateDeliveryGuard({ step: "activate", suspect, confirmedNotDuplicate: true });
  ok(o.ok && o.overridden, "the checked-not-a-duplicate tick lets it through (audited as overridden)");
  ok(duplicateDeliveryGuard({ step: "other", suspect, confirmedNotDuplicate: false }).ok, "quarantine / hold / reject are never blocked");
  const clean = duplicateDeliveryGuard({ step: "activate", suspect: null, confirmedNotDuplicate: false });
  ok(clean.ok && !clean.overridden, "no suspicion -> unchanged behaviour");
  ok(guardStepForStatus(" Active ") === "activate" && guardStepForStatus("quarantine") === "other" && guardStepForStatus(null) === "other", "step from status");
  ok(shortDeliveryRef("156b8d15-ea4e") === "156b8d15", "short ref");
  return { passed, failed };
}

/**
 * src/lib/orders/backoffice-complete-core.ts  (D204)
 *
 * Owner (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D204):
 *   "if a sale is marked completed from the back office and not the register,
 *    the system treats them as a sale even if the customer didn't come in and
 *    buy the product."
 *
 * An online order is completed AT THE REGISTER, where it is paid. Completing
 * it from the back office posts a sale, takes the stock and awards loyalty
 * points with no payment and no drawer. So the back-office "Mark Completed"
 * is locked. An owner/admin/manager may still complete it with a written
 * reason (logged), for example a register outage where the sale was rung
 * on paper.
 *
 * PURE: no I/O.
 */

/** Roles that may complete an order outside the register (logged). */
export const OFF_REGISTER_COMPLETE_ROLES = ["owner", "admin", "manager"] as const;

/** Shortest accepted written reason. */
export const OFF_REGISTER_REASON_MIN = 5;

export const OFF_REGISTER_COMPLETE_REFUSAL =
  "Online orders are completed at the register, where the customer pays. " +
  "Marking it completed here would record a sale with no payment and no drawer. " +
  "Ring it up on the register (Pickups). An owner or manager can complete it here only with a written reason.";

export const OFF_REGISTER_COMPLETE_WARNING =
  "This records a sale with NO payment and NO drawer, takes the stock and gives loyalty points. " +
  "Use it only when the sale really happened outside the register (for example, rung on paper during an outage).";

export function mayCompleteOffRegister(role: string | null | undefined): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return (OFF_REGISTER_COMPLETE_ROLES as readonly string[]).includes(r);
}

export function cleanOffRegisterReason(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return s.length >= OFF_REGISTER_REASON_MIN ? s : null;
}

export type OffRegisterVerdict =
  | { ok: true; offRegister: false }
  | { ok: true; offRegister: true; reason: string }
  | { ok: false; error: string };

/**
 * May a back-office status change to `toStatus` go ahead?
 * Only a move TO "completed" is gated; every other move is untouched.
 */
export function backofficeCompleteVerdict(input: {
  toStatus: string;
  role: string | null | undefined;
  reason: unknown;
}): OffRegisterVerdict {
  if (input.toStatus !== "completed") return { ok: true, offRegister: false };
  if (!mayCompleteOffRegister(input.role)) return { ok: false, error: OFF_REGISTER_COMPLETE_REFUSAL };
  const reason = cleanOffRegisterReason(input.reason);
  if (!reason) return { ok: false, error: OFF_REGISTER_COMPLETE_REFUSAL };
  return { ok: true, offRegister: true, reason };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runBackofficeCompleteTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };

  ok("owner may", mayCompleteOffRegister("owner"));
  ok("admin may", mayCompleteOffRegister("admin"));
  ok("manager may", mayCompleteOffRegister(" Manager "));
  ok("budtender may not", !mayCompleteOffRegister("budtender"));
  ok("null role may not", !mayCompleteOffRegister(null));
  ok("reason too short", cleanOffRegisterReason("abc") === null);
  ok("reason collapsed", cleanOffRegisterReason("  rung   on paper ") === "rung on paper");
  ok("reason clamped", (cleanOffRegisterReason("x".repeat(900)) ?? "").length === 500);

  const nonComplete = backofficeCompleteVerdict({ toStatus: "cancelled", role: "budtender", reason: "" });
  ok("cancel not gated", nonComplete.ok && !nonComplete.offRegister);
  const ready = backofficeCompleteVerdict({ toStatus: "ready", role: null, reason: null });
  ok("ready not gated", ready.ok);
  const noReason = backofficeCompleteVerdict({ toStatus: "completed", role: "owner", reason: "" });
  ok("owner without reason refused", !noReason.ok);
  const staff = backofficeCompleteVerdict({ toStatus: "completed", role: "budtender", reason: "rung on paper" });
  ok("staff with reason refused", !staff.ok);
  const good = backofficeCompleteVerdict({ toStatus: "completed", role: "manager", reason: "register down, rung on paper" });
  ok("manager with reason allowed", good.ok && good.offRegister && good.reason === "register down, rung on paper");
  ok("refusal points to the register", OFF_REGISTER_COMPLETE_REFUSAL.includes("register"));
  ok("warning says no payment", OFF_REGISTER_COMPLETE_WARNING.includes("NO payment"));

  return { passed, failed };
}

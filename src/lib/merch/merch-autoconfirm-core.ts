/**
 * src/lib/merch/merch-autoconfirm-core.ts  (D232 slice M-7, SOP-11 Q-11-7)
 *
 * Owner (D232, verbatim): "Q7: I agree with you. Build the auto confirm too
 * and all that goes along with it so it's ready." The agreed recommendation:
 * "Not until 20+ clean orders; Merch Health shows it amber".
 *
 * PURE rules for the back-office auto-confirm switch (site_settings key
 * merch_auto_confirm). When on, the shop's Stripe webhook sends each paid,
 * clean order straight to Printful production (POST /orders?confirm=true)
 * instead of leaving a draft for Confirm. It is read by the shop through the
 * catalog feed (fresh read inside the webhook), so the switch takes effect on
 * the next order with no redeploy.
 *   - Turn ON: owner only, a typed reason (5+ characters), and at least
 *     MIN_CLEAN_ORDERS greenwaymerch.com orders Printful has fulfilled.
 *   - Turn OFF: owner or admin, any time, no gate (the safe direction).
 */

export const AUTO_CONFIRM_KEY = "merch_auto_confirm";
export const MIN_CLEAN_ORDERS = 20;
export const MIN_REASON = 5;

export type AutoConfirmSetting = { on: boolean; reason: string; byEmail: string; at: string; cleanOrdersAtSwitch: number | null };

export const AUTO_CONFIRM_OFF: AutoConfirmSetting = { on: false, reason: "", byEmail: "", at: "", cleanOrdersAtSwitch: null };

export function normalizeAutoConfirm(raw: unknown): AutoConfirmSetting {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = o.cleanOrdersAtSwitch;
  return {
    on: o.on === true,
    reason: str(o.reason, 500),
    byEmail: str(o.byEmail, 200),
    at: str(o.at, 40),
    cleanOrdersAtSwitch: typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null,
  };
}

/** Clean = placed by greenwaymerch.com (gm- ref) and fulfilled (shipped) by Printful. */
export function countCleanOrders(orders: readonly { ours: boolean; printfulStatus: string }[]): number {
  return orders.filter((o) => o.ours && o.printfulStatus === "fulfilled").length;
}

export type SwitchCheck = { ok: true } | { ok: false; problem: string };

export function checkSwitch(i: { turnOn: boolean; role: string; reason: string; cleanOrders: number | null; ordersProblem: string }): SwitchCheck {
  if (!i.turnOn) return i.role === "owner" || i.role === "admin" ? { ok: true } : { ok: false, problem: "Only the owner or an admin can change auto-confirm." };
  if (i.role !== "owner") return { ok: false, problem: "Only the owner can turn auto-confirm on." };
  if (i.reason.trim().length < MIN_REASON) return { ok: false, problem: `Type a reason (at least ${MIN_REASON} characters) for turning auto-confirm on.` };
  if (i.cleanOrders === null) return { ok: false, problem: `Could not count fulfilled orders at Printful, so auto-confirm stays off. ${i.ordersProblem}`.trim() };
  if (i.cleanOrders < MIN_CLEAN_ORDERS) return { ok: false, problem: `Printful has fulfilled ${i.cleanOrders} greenwaymerch.com order(s); auto-confirm unlocks at ${MIN_CLEAN_ORDERS} clean orders (SOP-11 Q-11-7).` };
  return { ok: true };
}

/** H-19 words for the two ways auto-confirm can be on (the back-office switch, or the old env variable). */
export function autoConfirmSourceWords(src: string | undefined, envOn: boolean): string {
  if (src === "back-office") return "on from the back-office switch (Merch Health → H-19)";
  if (src === "env" || envOn) return "on from MERCH_PRINTFUL_AUTO_CONFIRM in the merch project";
  return "off";
}

export function __runAutoConfirmTests(): { passed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, c: boolean) => (c ? (passed += 1) : failures.push(name));
  ok("default off", !normalizeAutoConfirm(null).on && normalizeAutoConfirm({ on: "true" }).on === false);
  ok("normalised", normalizeAutoConfirm({ on: true, reason: " r ", cleanOrdersAtSwitch: 21 }).reason === "r" && normalizeAutoConfirm({ cleanOrdersAtSwitch: -1 }).cleanOrdersAtSwitch === null);
  ok("clean count", countCleanOrders([{ ours: true, printfulStatus: "fulfilled" }, { ours: false, printfulStatus: "fulfilled" }, { ours: true, printfulStatus: "draft" }]) === 1);
  ok("off: owner and admin", checkSwitch({ turnOn: false, role: "admin", reason: "", cleanOrders: null, ordersProblem: "" }).ok);
  ok("off: manager refused", !checkSwitch({ turnOn: false, role: "manager", reason: "", cleanOrders: null, ordersProblem: "" }).ok);
  ok("on: admin refused", !checkSwitch({ turnOn: true, role: "admin", reason: "ready now", cleanOrders: 50, ordersProblem: "" }).ok);
  ok("on: needs reason", !checkSwitch({ turnOn: true, role: "owner", reason: "ok", cleanOrders: 50, ordersProblem: "" }).ok);
  ok("on: needs 20", !checkSwitch({ turnOn: true, role: "owner", reason: "ready now", cleanOrders: 19, ordersProblem: "" }).ok);
  ok("on: unknown count refused", !checkSwitch({ turnOn: true, role: "owner", reason: "ready now", cleanOrders: null, ordersProblem: "x" }).ok);
  ok("on: owner, reason, 20", checkSwitch({ turnOn: true, role: "owner", reason: "ready now", cleanOrders: 20, ordersProblem: "" }).ok);
  ok("source words", autoConfirmSourceWords("back-office", false).includes("switch") && autoConfirmSourceWords(undefined, true).includes("MERCH_PRINTFUL") && autoConfirmSourceWords("off", false) === "off");
  return { passed, failures };
}

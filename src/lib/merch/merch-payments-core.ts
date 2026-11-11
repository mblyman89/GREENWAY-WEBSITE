/**
 * src/lib/merch/merch-payments-core.ts  (D232 slice M-7, SOP-11 G-84 / G-86)
 *
 * PURE rules for the Stripe half of a merch order, as the back office sees it:
 *   - shopPaymentView: the shop's GET /api/payments answer -> what the order
 *     page shows ("Card on hold", "Charged", "Refunded") and which button.
 *   - stripeDashboardUrl: the deep link for the guidance path (Q4 "guidance
 *     first"). Test-mode payments live under /test/.
 *   - heldReminders: which card holds get the day-3 / day-5 email (each one
 *     is claimed once in compliance_reminder_log, so it is sent once).
 *   - bothHalves: one sentence for the order page, Printful half + Stripe half.
 * Money is integer cents.
 */

export type ShopPayment = {
  found: boolean;
  id: string;
  status: string;
  amountCents: number;
  capturedCents: number;
  refundedCents: number;
  currency: string;
  createdSec: number;
  livemode: boolean | null;
  canRelease: boolean;
  canRefund: boolean;
};

export type PaymentRead =
  | { ok: true; payment: ShopPayment; buttons: boolean }
  | { ok: false; problem: string };

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** The shop's JSON `payment` -> a safe ShopPayment (anything odd -> not found). */
export function readShopPayment(raw: unknown): ShopPayment {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" && /^pi_[A-Za-z0-9]+$/.test(p.id) ? p.id : "";
  return {
    found: p.found === true && id !== "",
    id,
    status: typeof p.status === "string" ? p.status.slice(0, 40) : "",
    amountCents: int(p.amountCents),
    capturedCents: int(p.capturedCents),
    refundedCents: int(p.refundedCents),
    currency: typeof p.currency === "string" ? p.currency.slice(0, 3) : "usd",
    createdSec: int(p.createdSec),
    livemode: typeof p.livemode === "boolean" ? p.livemode : null,
    canRelease: p.canRelease === true && p.status === "requires_capture",
    canRefund: p.canRefund === true && p.status === "succeeded",
  };
}

export function stripeDashboardUrl(id: string, livemode: boolean | null): string {
  const base = livemode === false ? "https://dashboard.stripe.com/test/payments" : "https://dashboard.stripe.com/payments";
  return /^pi_[A-Za-z0-9]+$/.test(id) ? `${base}/${id}` : base;
}

export type PaymentWord = { label: string; tone: "ok" | "warn" | "fail" | "muted"; say: string };

export function shopPaymentView(p: ShopPayment, nowSec: number): PaymentWord {
  if (!p.found) return { label: "No Stripe payment found", tone: "muted", say: "Stripe has no payment with this order reference (the shopper may not have finished checkout)." };
  const days = p.createdSec ? Math.floor(Math.max(0, nowSec - p.createdSec) / 86400) : 0;
  if (p.status === "requires_capture") {
    return {
      label: "Card on hold (not charged)",
      tone: days >= 3 ? "fail" : "warn",
      say: `The card is only authorized, ${days} day(s) ago. Stripe drops the hold after about 7 days. Capture it in Stripe if you will fill this order, or release it (free).`,
    };
  }
  if (p.status === "canceled") return { label: "Hold released (never charged)", tone: "muted", say: "The card hold was dropped. The customer was not charged." };
  if (p.status === "succeeded") {
    if (p.refundedCents >= p.capturedCents && p.capturedCents > 0) return { label: "Refunded in full", tone: "muted", say: "Stripe refunded the whole charge. The customer sees it in 5 to 10 business days." };
    if (p.refundedCents > 0) return { label: "Partly refunded", tone: "warn", say: "Part of the charge was refunded in Stripe. The rest is still charged." };
    return { label: "Charged", tone: "ok", say: "The customer's card was charged." };
  }
  return { label: `Stripe: ${p.status || "unknown"}`, tone: "warn", say: "Open it in Stripe to see what it is waiting for." };
}

/** One line covering both halves (Printful + Stripe), for the order page. */
export function bothHalves(printfulStatus: string, p: ShopPayment | null): { tone: "ok" | "warn"; text: string } {
  const pfDone = printfulStatus === "canceled";
  if (!p) return { tone: "warn", text: "The Stripe half could not be read; check Stripe by hand." };
  const charged = p.status === "succeeded" && p.capturedCents > p.refundedCents;
  const held = p.status === "requires_capture";
  if (pfDone && charged) return { tone: "warn", text: "Cancelled at Printful, but the customer is still charged in Stripe. Refund them." };
  if (pfDone && held) return { tone: "warn", text: "Cancelled at Printful, but the card is still on hold. Release the hold." };
  if (pfDone) return { tone: "ok", text: "Both halves are done: cancelled at Printful and nothing is charged in Stripe." };
  if (charged || !p.found) return { tone: "ok", text: "" };
  if (held) return { tone: "warn", text: "Printful has the order, but the card is still only on hold (not charged). Capture it in Stripe or cancel the order." };
  if (p.status === "succeeded" || p.status === "canceled") return { tone: "warn", text: "The customer is refunded or was never charged, but the order is still open at Printful. Cancel it at Printful if it should not be made." };
  return { tone: "ok", text: "" };
}

export type HeldItem = { ref: string; id: string; days: number; amountCents: number; livemode: boolean | null };
export type HeldReminder = HeldItem & { stage: "day3" | "day5"; key: string };

/** Card holds at 3+ days get a day-3 email, 5+ days a day-5 email; each key is claimed once. */
export function heldReminders(list: readonly HeldItem[]): HeldReminder[] {
  const out: HeldReminder[] = [];
  for (const h of list) {
    if (!/^pi_[A-Za-z0-9]+$/.test(h.id) || !(h.days >= 3)) continue;
    const stage = h.days >= 5 ? "day5" : "day3";
    out.push({ ...h, stage, key: `merch-held:${h.id}:${stage}` });
  }
  return out;
}

/** Normalise the shop's held list (it may be missing on a shop not redeployed since M-7). */
export function readHeldList(raw: unknown): HeldItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      ref: typeof h.ref === "string" && /^gm-[a-z0-9-]{3,30}$/.test(h.ref) ? h.ref : "",
      id: typeof h.id === "string" && /^pi_[A-Za-z0-9]+$/.test(h.id) ? h.id : "",
      days: typeof h.days === "number" && Number.isFinite(h.days) ? Math.max(0, h.days) : 0,
      amountCents: int(h.amountCents),
      livemode: typeof h.livemode === "boolean" ? h.livemode : null,
    }))
    .filter((h) => h.id !== "")
    .slice(0, 25);
}

export function __runMerchPaymentsTests(): { passed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, c: boolean) => (c ? (passed += 1) : failures.push(name));
  const held = readShopPayment({ found: true, id: "pi_1", status: "requires_capture", amountCents: 2599, createdSec: 1000, canRelease: true, canRefund: true, livemode: true });
  ok("hold: release yes, refund no (status wins)", held.canRelease && !held.canRefund);
  ok("bad id -> not found", !readShopPayment({ found: true, id: "ch_1", status: "succeeded" }).found);
  ok("garbage -> not found", !readShopPayment(null).found);
  ok("hold 4 days red", shopPaymentView(held, 1000 + 4 * 86400).tone === "fail");
  ok("hold 1 day amber", shopPaymentView(held, 1000 + 86400).tone === "warn");
  const paid = readShopPayment({ found: true, id: "pi_2", status: "succeeded", amountCents: 3000, capturedCents: 3000, refundedCents: 0, canRefund: true });
  ok("charged ok", shopPaymentView(paid, 0).label === "Charged" && paid.canRefund);
  ok("refunded in full", shopPaymentView({ ...paid, refundedCents: 3000 }, 0).label === "Refunded in full");
  ok("partial", shopPaymentView({ ...paid, refundedCents: 100 }, 0).label === "Partly refunded");
  ok("dashboard live link", stripeDashboardUrl("pi_2", true) === "https://dashboard.stripe.com/payments/pi_2");
  ok("dashboard test link", stripeDashboardUrl("pi_2", false) === "https://dashboard.stripe.com/test/payments/pi_2");
  ok("dashboard bad id -> list", stripeDashboardUrl("x", null) === "https://dashboard.stripe.com/payments");
  ok("cancelled + charged -> refund them", bothHalves("canceled", paid).text.includes("Refund them"));
  ok("cancelled + hold -> release", bothHalves("canceled", held).text.includes("Release the hold"));
  ok("cancelled + refunded -> both done", bothHalves("canceled", { ...paid, refundedCents: 3000 }).tone === "ok");
  ok("open + charged -> nothing to say", bothHalves("draft", paid).text === "");
  ok("open + refunded -> cancel at Printful", bothHalves("draft", { ...paid, refundedCents: 3000 }).text.includes("Cancel it at Printful"));
  ok("unknown stripe -> warn", bothHalves("draft", null).tone === "warn");
  const r = heldReminders([{ ref: "gm-a", id: "pi_a", days: 2.9, amountCents: 1, livemode: null }, { ref: "gm-b", id: "pi_b", days: 3.1, amountCents: 1, livemode: null }, { ref: "gm-c", id: "pi_c", days: 5.5, amountCents: 1, livemode: null }, { ref: "", id: "bad", days: 6, amountCents: 1, livemode: null }]);
  ok("reminders: day3 + day5, under 3 and bad ids skipped", r.length === 2 && r[0].stage === "day3" && r[1].stage === "day5" && r[1].key === "merch-held:pi_c:day5");
  ok("held list normalised", readHeldList([{ id: "pi_x", days: 4, ref: "gm-abc123-xy", amountCents: 10 }, { id: "nope" }, null]).length === 1 && readHeldList("x").length === 0);
  return { passed, failures };
}

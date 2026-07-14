"use client";

/**
 * SaleFlow (POS Slice B6) — the guided sale: ID gate → cart → cash tender.
 *
 * Compliance-first sequencing (owner decision, research §14): NOTHING enters
 * the cart until the ID gate passes. The gate accepts either a PDF417 scan
 * (keyboard-wedge scanners type the barcode text and press Enter) or an
 * audited manual verification (WAC 314-55-150 list; reason required; the
 * manual_id_verification event is enqueued BEFORE the sale and the sale
 * payload references its UUID).
 *
 * Pricing runs the SAME pure engine the website checkout and the server-side
 * completion gate use (sale-flow-core → discount-engine-core +
 * order-pricing-core), so an offline sale prices identically and the server's
 * money recompute (S-2b) can never disagree. The WAC 314-55-095 limit meter
 * updates live; a hard block disables checkout on-device AND would be
 * re-refused server-side if it somehow synced.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseAamvaPdf417,
  evaluateScannedId,
  evaluateManualId,
  ACCEPTABLE_ID_TYPES,
  type IdGateVerdict,
} from "@/lib/pos/id-scan-core";
import {
  addToCart,
  setCartQuantity,
  searchProducts,
  priceCart,
  judgeLimits,
  limitLinesFor,
  buildSalePayload,
  type PosMenuBundle,
  type PosCartEntry,
  type PricedSaleLine,
  type PosMenuProduct,
} from "@/lib/pos/sale-flow-core";
import { resolveScan } from "@/lib/pos/scan-to-cart-core";
import {
  applyPriceOverrides,
  overrideFloorMinor,
  validateOverrideRequest,
  type PosLineOverride,
} from "@/lib/pos/price-override-core";
import { dollarsToMinor } from "@/lib/pos/till-core";
import { changeBreakdown, smartTenderSuggestions } from "@/lib/pos/change-calc-core";
import { stockSignal, cartStockWarnings } from "@/lib/pos/low-stock-core";
import {
  validateCardCapture,
  medicalAgeAllowed,
  applyMedicalPricing,
  type PosCardCapture,
  type MedicalPricingResult,
} from "@/lib/pos/medical-pos-core";
import { computeOrderTotals, type OrderTotals } from "@/lib/orders/order-pricing-core";
import { evaluateSalesHours } from "@/lib/compliance/sales-hours-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  buildPosReceiptHtml,
  buildPassPrntUrl,
  type PosReceiptInput,
} from "@/lib/pos/receipt-core";
import {
  normalizePosReceiptConfig,
  receiptAddressLines,
} from "@/lib/pos/receipt-config-core";
import type { MemberHistory } from "@/lib/pos/member-history-core";

type Step = "idgate" | "cart" | "tender" | "done";

/** A loyalty member hit from the server lookup (B14). */
export type PosMemberHit = {
  customerId: string;
  label: string;
  points: number;
  tierName: string | null;
};

export type SaleFlowProps = {
  bundle: PosMenuBundle;
  drawerSessionId: string;
  /** Register/device display name — printed on the receipt (B10). */
  registerName?: string;
  /** Unlocked employee's display name — "Served by" line when enabled (B13). */
  employeeName?: string;
  /**
   * B17 — resume a held sale: cart lines rebuilt by the SHELL against the
   * CURRENT bundle (fresh prices; vanished/out-of-stock lines already
   * dropped). The ID gate still runs first — a held cart never inherits the
   * previous customer's age verification.
   */
  initialCart?: PosCartEntry[];
  /**
   * B17 — park this cart and exit the sale ("customer forgot their wallet").
   * The shell persists a MINIMAL snapshot (variant ids + counts). Omitted
   * when a hold already exists — one parked sale at a time keeps the drawer
   * story simple.
   */
  onHold?: (cart: PosCartEntry[]) => void;
  /**
   * B17 — the frozen receipt snapshot, fired the moment the sale is
   * enqueued. The shell persists it so "reprint last receipt" survives the
   * post-sale auto-lock.
   */
  onReceiptFrozen?: (receipt: PosReceiptInput) => void;
  /**
   * Loyalty member lookup (B14) — ONLINE-ONLY by design (no customer book is
   * ever cached on the iPad). Returns matches or an error message.
   */
  onMemberLookup?: (q: string) => Promise<{ ok: true; members: PosMemberHit[] } | { ok: false; error: string }>;
  /**
   * B29 — privacy-budgeted purchase history for an ATTACHED member ("the
   * usual?"): last few completed purchases + favorites, nothing else.
   * ONLINE-ONLY like the lookup; nothing is cached beyond the open panel.
   */
  onMemberHistory?: (customerId: string) => Promise<{ ok: true; history: MemberHistory } | { ok: false; error: string }>;
  /**
   * B30 — email the frozen receipt snapshot (opt-in digital receipt). Only
   * provided when the shell has confirmed the email provider is configured
   * (undefined hides the option entirely). ONLINE-ONLY; the address is used
   * once server-side and never stored.
   */
  onEmailReceipt?: (
    email: string,
    receipt: PosReceiptInput,
  ) => Promise<{ ok: true; receiptNumber: string } | { ok: false; error: string }>;
  /**
   * B24 — manager PIN approval for a price override. ONLINE-ONLY (a PIN
   * can't be verified offline). The shell implements it with the SAME
   * /api/pos/approve endpoint the no-sale flow uses (scrypt + throttle +
   * manager/lead role gate); the PIN never leaves that call.
   */
  onApprove?: (pin: string) => Promise<{ ok: true; approver: { id: string; fullName: string } } | { ok: false; error: string }>;
  /** Enqueue an event; returns the clientUuid assigned to it. */
  onEnqueue: (
    eventType: "sale" | "manual_id_verification" | "medical_card_capture",
    payload: Record<string, unknown>,
  ) => string;
  /** Sale finished (change given). The shell locks the register. */
  onComplete: () => void;
  onCancel: () => void;
};

/**
 * Price the cart for the buyer in front of the register: the shared
 * promotions engine first (identical to the website + server gate), then —
 * when the bundle carries the DOH medical config — the B7 exemption
 * pass-through. Repriced lines feed computeOrderTotals, the SAME totals
 * function the server recomputes with at sync, so device and server can
 * never disagree. Non-medical carts return the priceCart result untouched.
 */
function priceForBuyer(
  cart: PosCartEntry[],
  bundle: PosMenuBundle,
  carded: boolean,
  overrides: Record<string, PosLineOverride>,
): {
  lines: PricedSaleLine[];
  totals: OrderTotals;
  problems: string[];
  med: MedicalPricingResult | null;
  /** B24 — the RAW engine lines (pre-override, pre-medical): what a manager
   * approves an override against, keyed by variantId in the override modal. */
  engineLines: PricedSaleLine[];
  /** B24 — overrides dropped because the engine repriced the line. */
  staleVariantIds: string[];
} {
  const priced = priceCart(cart, bundle.rules);
  // B24 — manager overrides apply to the ENGINE price (that is what the
  // manager approved against); the medical exemption pass then reprices
  // FROM the overridden price, so a carded patient gets both. A stale
  // override (engine repriced the line since approval) never applies.
  const withOverrides = applyPriceOverrides(priced.lines, overrides);
  if (!bundle.medical) {
    return {
      lines: withOverrides.lines,
      totals: withOverrides.totals,
      problems: priced.problems,
      med: null,
      engineLines: priced.lines,
      staleVariantIds: withOverrides.staleVariantIds,
    };
  }
  const med = applyMedicalPricing(withOverrides.lines, bundle.medical, {
    cardedValid: carded,
    saleDateYmd: pacificDayKey(new Date()),
  });
  const totals = carded
    ? computeOrderTotals(
        med.lines.map((l) => ({
          category: l.category,
          quantity: l.quantity,
          unitPriceMinorUnits: l.unitPriceMinor,
          regularPriceMinorUnits: l.regularPriceMinor,
        })),
      )
    : withOverrides.totals;
  return {
    lines: carded ? med.lines : withOverrides.lines,
    totals,
    problems: priced.problems,
    med,
    engineLines: priced.lines,
    staleVariantIds: withOverrides.staleVariantIds,
  };
}

export function SaleFlow({ bundle, drawerSessionId, registerName, employeeName, initialCart, onHold, onReceiptFrozen, onMemberLookup, onMemberHistory, onEmailReceipt, onApprove, onEnqueue, onComplete, onCancel }: SaleFlowProps) {
  const [step, setStep] = useState<Step>("idgate");
  const [verdict, setVerdict] = useState<Extract<IdGateVerdict, { allowed: true }> | null>(null);
  const [manualEventUuid, setManualEventUuid] = useState<string | null>(null);
  // POS B9 — set ONLY by the ID gate's medical path (card captured + its
  // audit event enqueued). The card, not a toggle, is what makes the sale
  // medical: it drives pricing, the 3× limits, and the payload block.
  const [medicalCard, setMedicalCard] = useState<PosCardCapture | null>(null);
  const [cardEventUuid, setCardEventUuid] = useState<string | null>(null);
  // B17 — a resumed hold seeds the cart, but ONLY the cart: the ID gate,
  // medical path, and member attach all start fresh for the returning buyer.
  const [cart, setCart] = useState<PosCartEntry[]>(initialCart ?? []);
  // POS B14 — the loyalty member attached to this sale (server lookup only).
  const [member, setMember] = useState<PosMemberHit | null>(null);
  // POS B24 — manager-approved price overrides for THIS sale, keyed by
  // variantId. Cleared with the sale; never persisted (a hold resumes at
  // fresh engine prices, and the next customer never inherits a markdown).
  const [overrides, setOverrides] = useState<Record<string, PosLineOverride>>({});
  const [changeMinor, setChangeMinor] = useState<number | null>(null);
  // POS B10 — snapshot of the finished sale for printing/reprint. Captured at
  // the moment the sale is enqueued so the receipt always matches the payload.
  const [receipt, setReceipt] = useState<PosReceiptInput | null>(null);

  // Sales hours (WAC 314-55-147) checked on-device with the owner's window;
  // the server completion gate re-checks with ITS clock at sync time.
  const hours = evaluateSalesHours(new Date(), bundle.hours);
  if (!hours.allowed && step !== "done") {
    return (
      <Frame title="Sales hours" onCancel={onCancel}>
        <p className="max-w-md rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{hours.reason}</p>
      </Frame>
    );
  }

  if (step === "idgate") {
    return (
      <IdGateScreen
        medicalAvailable={!!bundle.medical}
        onCancel={onCancel}
        onPassed={(v, manualUuid, card, cardUuid) => {
          setVerdict(v);
          setManualEventUuid(manualUuid);
          setMedicalCard(card);
          setCardEventUuid(cardUuid);
          setStep("cart");
        }}
        onEnqueueManual={(payload) => onEnqueue("manual_id_verification", payload)}
        onEnqueueCardCapture={(payload) => onEnqueue("medical_card_capture", payload)}
      />
    );
  }

  if (step === "cart" && verdict) {
    return (
      <CartScreen
        bundle={bundle}
        cart={cart}
        setCart={setCart}
        medicalCard={medicalCard}
        verdict={verdict}
        member={member}
        setMember={setMember}
        onMemberLookup={onMemberLookup}
        onMemberHistory={onMemberHistory}
        onApprove={onApprove}
        overrides={overrides}
        setOverrides={setOverrides}
        onCancel={onCancel}
        onHold={onHold}
        onTender={() => setStep("tender")}
      />
    );
  }

  if (step === "tender" && verdict) {
    return (
      <TenderScreen
        bundle={bundle}
        cart={cart}
        medicalCard={medicalCard}
        overrides={overrides}
        onBack={() => setStep("cart")}
        onCancel={onCancel}
        onPaid={(tenderedMinor) => {
          const priced = priceForBuyer(cart, bundle, !!medicalCard, overrides);
          const built = buildSalePayload({
            lines: priced.lines,
            totals: priced.totals,
            tenderedMinor,
            drawerSessionId,
            idVerification:
              verdict.method === "manual" && manualEventUuid
                ? { method: "manual", manualEventUuid }
                : { method: "scan" },
            ...(medicalCard && cardEventUuid
              ? {
                  medical: {
                    card: medicalCard,
                    cardEventUuid,
                    medicalSavingsMinor: priced.med?.medicalSavingsMinor ?? 0,
                  },
                }
              : {}),
            ...(member ? { loyalty: { customerId: member.customerId, memberLabel: member.label } } : {}),
          });
          if (!built.ok) return built.errors.join(" ");
          const saleUuid = onEnqueue("sale", built.payload as unknown as Record<string, unknown>);
          setChangeMinor(built.changeMinor);
          // B10 — freeze the receipt from EXACTLY what was enqueued.
          // B13 — apply the owner's customization from the bundle (normalize
          // defends against a pre-B13 cached bundle carrying no config).
          const isMedical = !!(medicalCard && cardEventUuid);
          const rc = normalizePosReceiptConfig(bundle.receipt);
          const frozen: PosReceiptInput = {
            saleClientUuid: saleUuid || crypto.randomUUID(),
            soldAtIso: new Date().toISOString(),
            registerLabel: registerName ?? "Register",
            headerText: rc.headerText,
            footerText: rc.footerText,
            addressLines: receiptAddressLines(rc),
            servedBy: rc.showEmployee ? (employeeName ?? null) : null,
            hideSavings: !rc.showSavings,
            lines: priced.lines.map((l, i) => ({
              productName: l.productName,
              quantity: l.quantity,
              unitPriceMinor: l.unitPriceMinor,
              regularPriceMinor: l.regularPriceMinor,
              medicalTaxOff: (priced.med?.lines[i]?.medicalSavingsMinor ?? 0) > 0,
            })),
            subtotalMinor: priced.totals.subtotalMinorUnits,
            taxMinor: priced.totals.estimatedTaxMinorUnits,
            totalMinor: priced.totals.totalMinorUnits,
            savingsMinor: priced.totals.savingsMinorUnits,
            medicalSavingsMinor: isMedical ? (priced.med?.medicalSavingsMinor ?? 0) : 0,
            medicalSale: isMedical,
            tenderedMinor,
            changeMinor: built.changeMinor,
            // B14 — member block: points ESTIMATE from the bundle's earn rate
            // (floor of pre-tax dollars × rate; authoritative accrual runs
            // server-side at completion). Hidden by the owner's toggle.
            loyalty:
              member && rc.showLoyalty
                ? {
                    memberLabel: member.label,
                    pointsEarned: bundle.loyalty
                      ? Math.floor((priced.totals.subtotalMinorUnits / 100) * bundle.loyalty.pointsPerDollar)
                      : null,
                  }
                : null,
          };
          setReceipt(frozen);
          // B17 — hand the frozen snapshot to the shell so "reprint last
          // receipt" survives the post-sale auto-lock.
          onReceiptFrozen?.(frozen);
          setStep("done");
          return null;
        }}
      />
    );
  }

  // done
  return (
    <Frame title="Sale complete" onCancel={onComplete} cancelLabel="Lock register">
      <p className="text-5xl font-bold text-emerald-300">{money(changeMinor ?? 0)} change</p>
      {changeMinor != null && changeMinor > 0 ? <ChangePlan changeMinor={changeMinor} /> : null}
      <p className="mt-4 max-w-md text-sm text-neutral-400">
        Count the change back to the customer. The sale is queued and will sync to the back office —
        the register locks when you tap below.
      </p>
      {receipt ? <ReceiptButtons receipt={receipt} /> : null}
      {receipt && onEmailReceipt ? <EmailReceiptPanel receipt={receipt} onEmailReceipt={onEmailReceipt} /> : null}
      <button
        type="button"
        onClick={onComplete}
        className="mt-8 rounded-2xl bg-emerald-600 px-10 py-5 text-xl font-bold text-white"
      >
        Done — lock register
      </button>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// POS B30 — opt-in email receipt (digital copy of the SAME frozen snapshot)
// ---------------------------------------------------------------------------

/**
 * "Email this receipt?" panel on the Sale-complete screen. Opt-in only: the
 * customer asks, the budtender types the address, one tap sends. The server
 * emails a restyled copy of the SAME frozen snapshot the paper prints from
 * and never stores the address (masked in the audit trail only). The input
 * is cleared after send — nothing lingers for the next customer.
 */
function EmailReceiptPanel({
  receipt,
  onEmailReceipt,
}: {
  receipt: PosReceiptInput;
  onEmailReceipt: NonNullable<SaleFlowProps["onEmailReceipt"]>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className="mt-4 rounded-xl bg-emerald-950/60 px-4 py-3 text-sm text-emerald-300">
        Receipt emailed. The address was used once and not saved.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded-2xl border border-neutral-600 px-8 py-4 text-lg font-semibold text-neutral-200"
      >
        Email receipt
      </button>
    );
  }

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setNote("Type the customer's email address first.");
      return;
    }
    setBusy(true);
    setNote(null);
    const result = await onEmailReceipt(trimmed, receipt);
    setBusy(false);
    if (result.ok) {
      setEmail("");
      setSent(true);
    } else {
      setNote(result.error);
    }
  };

  return (
    <div className="mt-4 w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900/70 p-4 text-left">
      <p className="text-sm font-semibold text-neutral-200">Email this receipt (customer&apos;s request)</p>
      <p className="mt-1 text-xs text-neutral-500">
        The address is used once to send this receipt and is not saved. Transactional copy only — no marketing.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="customer@example.com"
          className="min-w-0 flex-1 rounded-xl border border-neutral-600 bg-neutral-950 px-4 py-3 text-base text-neutral-100 placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="rounded-xl bg-neutral-100 px-5 py-3 text-base font-bold text-neutral-900 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {note ? <p className="mt-2 text-sm text-amber-300">{note}</p> : null}
      <button type="button" onClick={() => { setOpen(false); setEmail(""); setNote(null); }} className="mt-3 text-xs text-neutral-500 underline">
        Never mind
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS B10 — receipt printing (Star PassPRNT + browser fallback)
// ---------------------------------------------------------------------------

/**
 * Print via the Star PassPRNT iOS app (App Store) on the paired TSP100IIIBi:
 * navigating to the `starpassprnt://` URL opens PassPRNT, which prints the
 * HTML at 576 dots, kicks the drawer, then returns to this page via `back=`.
 * The browser fallback opens the SAME HTML in a new window and calls
 * window.print() — receipts can never differ between the two paths.
 * Reprint is just tapping again: the snapshot is immutable.
 */
function ReceiptButtons({ receipt }: { receipt: PosReceiptInput }) {
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const printStar = () => {
    const html = buildPosReceiptHtml(receipt);
    // Return to the register page itself; PassPRNT appends its result codes.
    const backUrl = window.location.origin + window.location.pathname;
    window.location.href = buildPassPrntUrl(html, { backUrl, openDrawer: true });
  };

  const printBrowser = () => {
    const html = buildPosReceiptHtml(receipt);
    const w = window.open("", "_blank", "width=400,height=640");
    if (!w) {
      setFallbackNote("Pop-up blocked — allow pop-ups for this site to use browser printing.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={printStar}
          className="rounded-2xl bg-neutral-100 px-8 py-4 text-lg font-bold text-neutral-900"
        >
          Print receipt
        </button>
        <button
          type="button"
          onClick={printBrowser}
          className="rounded-2xl border border-neutral-600 px-8 py-4 text-lg font-semibold text-neutral-200"
        >
          Browser print
        </button>
      </div>
      <p className="max-w-md text-center text-xs text-neutral-500">
        “Print receipt” opens the Star PassPRNT app (paired Bluetooth printer) and pops the drawer.
        Tap again to reprint. Use “Browser print” if PassPRNT isn’t installed on this device.
      </p>
      {fallbackNote ? <p className="text-xs text-amber-300">{fallbackNote}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — ID gate
// ---------------------------------------------------------------------------

function IdGateScreen({
  medicalAvailable,
  onPassed,
  onCancel,
  onEnqueueManual,
  onEnqueueCardCapture,
}: {
  /** True when the menu bundle carries the DOH medical config (B8). */
  medicalAvailable: boolean;
  onPassed: (
    v: Extract<IdGateVerdict, { allowed: true }>,
    manualEventUuid: string | null,
    medicalCard: PosCardCapture | null,
    cardEventUuid: string | null,
  ) => void;
  onCancel: () => void;
  onEnqueueManual: (payload: Record<string, unknown>) => string;
  onEnqueueCardCapture: (payload: Record<string, unknown>) => string;
}) {
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [scanBuffer, setScanBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef<HTMLTextAreaElement | null>(null);

  // Manual form state
  const [idType, setIdType] = useState<string>("");
  const [dob, setDob] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [photoMatch, setPhotoMatch] = useState(false);

  // POS B9 — medical path: the recognition card is captured AT the gate,
  // because it changes the gate itself (18–20 patients may buy — RCW
  // 69.50.357(1)) and everything after it (pricing, limits, payload).
  const [medical, setMedical] = useState(false);
  const [upid, setUpid] = useState("");
  const [cardEffective, setCardEffective] = useState("");
  const [cardExpires, setCardExpires] = useState("");
  const [holderType, setHolderType] = useState<"patient" | "designated_provider">("patient");
  const [mcrVerified, setMcrVerified] = useState(false);

  const todayYmd = pacificDayKey(new Date());

  /**
   * Validate the card capture WITHOUT enqueueing (pure). The audit event is
   * enqueued only after the WHOLE gate passes, so a failed scan retry never
   * litters the queue with orphaned capture events.
   */
  const validateCard = (): PosCardCapture | null => {
    const check = validateCardCapture(
      {
        upid: upid.trim(),
        effectiveOn: cardEffective.trim(),
        expiresOn: cardExpires.trim(),
        holderType,
        mcrVerified,
      },
      todayYmd,
    );
    if (!check.ok) {
      setError(check.errors.join(" "));
      return null;
    }
    return check.card;
  };

  const submitScan = () => {
    setError(null);
    const card = medical ? validateCard() : null;
    if (medical && !card) return;
    const parsed = parseAamvaPdf417(scanBuffer);
    if (!parsed.ok) {
      setError(`${parsed.error} If the barcode won't read, use manual verification.`);
      setScanBuffer("");
      return;
    }
    // Carded patients may be 18–20 (RCW 69.50.357(1)); recreational is 21+.
    const v = evaluateScannedId(parsed.license, todayYmd, card ? 18 : 21);
    if (!v.allowed) {
      setError(v.reason);
      setScanBuffer("");
      return;
    }
    const ageCheck = medicalAgeAllowed(v.age, !!card);
    if (!ageCheck.allowed) {
      setError(ageCheck.reason ?? "Age check failed.");
      return;
    }
    // Gate fully passed — NOW enqueue the card-capture audit event (the sale
    // references its UUID; queue flush order guarantees it syncs first).
    const cardUuid = card ? onEnqueueCardCapture(card as unknown as Record<string, unknown>) : null;
    onPassed(v, null, card, cardUuid);
  };

  const submitManual = () => {
    setError(null);
    const card = medical ? validateCard() : null;
    if (medical && !card) return;
    const v = evaluateManualId(
      { idType, dateOfBirth: dob.trim(), expirationDate: expiry.trim(), reason, photoMatchConfirmed: photoMatch },
      todayYmd,
      card ? 18 : 21,
    );
    if (!v.allowed) {
      setError(v.reason);
      return;
    }
    const ageCheck = medicalAgeAllowed(v.age, !!card);
    if (!ageCheck.allowed) {
      setError(ageCheck.reason ?? "Age check failed.");
      return;
    }
    // Audit events FIRST (WAC 314-55-150 trail); the sale references both UUIDs.
    const cardUuid = card ? onEnqueueCardCapture(card as unknown as Record<string, unknown>) : null;
    const uuid = onEnqueueManual({
      idType,
      dateOfBirth: dob.trim(),
      expirationDate: expiry.trim(),
      reason: reason.trim(),
    });
    onPassed(v, uuid, card, cardUuid);
  };

  return (
    <Frame title="Check ID — required before anything enters the cart" onCancel={onCancel}>
      {error ? (
        <p className="mb-4 w-full max-w-lg rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{error}</p>
      ) : null}

      {/* POS B9 — medical recognition card (RCW 69.51A.230). Captured AT the
          gate: it changes the age floor (18–20 patients), unlocks High-THC
          products, and passes the tax exemptions through to the price. */}
      <div className="mb-4 w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={medical}
            disabled={!medicalAvailable}
            onChange={(e) => {
              setMedical(e.target.checked);
              setError(null);
            }}
            className="h-5 w-5"
          />
          Medical patient (DOH recognition card)
        </label>
        {!medicalAvailable ? (
          <p className="mt-2 text-xs text-amber-300">
            Medical config not in the cached menu — refresh the menu while online to enable medical sales.
          </p>
        ) : null}
        {medical ? (
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="pos-upid" className="text-sm text-neutral-400">
                Unique patient identifier (UPID) — exactly as printed on the card
              </label>
              <input
                id="pos-upid"
                value={upid}
                onChange={(e) => setUpid(e.target.value)}
                autoCapitalize="characters"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 font-mono text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pos-card-eff" className="text-sm text-neutral-400">Card effective (YYYY-MM-DD)</label>
                <input
                  id="pos-card-eff"
                  value={cardEffective}
                  onChange={(e) => setCardEffective(e.target.value)}
                  inputMode="numeric"
                  placeholder="2026-01-01"
                  className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="pos-card-exp" className="text-sm text-neutral-400">Card expires (YYYY-MM-DD)</label>
                <input
                  id="pos-card-exp"
                  value={cardExpires}
                  onChange={(e) => setCardExpires(e.target.value)}
                  inputMode="numeric"
                  placeholder="2027-01-01"
                  className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <ToggleChip active={holderType === "patient"} onClick={() => setHolderType("patient")} label="Patient" />
              <ToggleChip
                active={holderType === "designated_provider"}
                onClick={() => setHolderType("designated_provider")}
                label="Designated provider"
              />
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={mcrVerified}
                onChange={(e) => setMcrVerified(e.target.checked)}
                className="mt-0.5 h-5 w-5"
              />
              <span>
                I verified this card is ACTIVE in the DOH Medical Cannabis Database (required — no
                verification, no exemption).
              </span>
            </label>
          </div>
        ) : null}
      </div>

      {mode === "scan" ? (
        <div className="w-full max-w-lg">
          <label htmlFor="pos-scan" className="text-sm text-neutral-400">
            Scan the barcode on the back of the license/ID. The scanner types into the box below —
            keep it focused. Scanner sends Enter when done.
          </label>
          <textarea
            id="pos-scan"
            ref={scanRef}
            value={scanBuffer}
            onChange={(e) => setScanBuffer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && scanBuffer.trim().length > 0) {
                e.preventDefault();
                submitScan();
              }
            }}
            autoFocus
            rows={4}
            className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs text-neutral-200"
            placeholder="@ … ANSI 636045 …"
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={submitScan}
              disabled={scanBuffer.trim().length === 0}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
            >
              Check scan
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("manual");
                setError(null);
              }}
              className="rounded-xl bg-neutral-800 px-6 py-3 font-semibold"
            >
              Manual verification instead
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-4">
          <p className="text-sm text-amber-300">
            Manual verifications are audited. Only use when the barcode will not scan or the document
            has no barcode (passport, tribal, armed forces…).
          </p>
          <div>
            <label htmlFor="pos-idtype" className="text-sm text-neutral-400">Document type (WAC 314-55-150)</label>
            <select
              id="pos-idtype"
              value={idType}
              onChange={(e) => setIdType(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
            >
              <option value="">— select —</option>
              {ACCEPTABLE_ID_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pos-dob" className="text-sm text-neutral-400">Date of birth (YYYY-MM-DD)</label>
              <input
                id="pos-dob"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                inputMode="numeric"
                placeholder="1990-07-13"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="pos-exp" className="text-sm text-neutral-400">Expiration date (YYYY-MM-DD)</label>
              <input
                id="pos-exp"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                inputMode="numeric"
                placeholder="2028-01-31"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="pos-reason" className="text-sm text-neutral-400">Why manual? (audited, 3–500 chars)</label>
            <input
              id="pos-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Barcode scratched — visual check of WA DL"
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm"
            />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={photoMatch}
              onChange={(e) => setPhotoMatch(e.target.checked)}
              className="h-5 w-5"
            />
            The photo matches the customer in front of me.
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={submitManual}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white"
            >
              Verify manually
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("scan");
                setError(null);
              }}
              className="rounded-xl bg-neutral-800 px-6 py-3 font-semibold"
            >
              Back to scanning
            </button>
          </div>
        </div>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — cart with live limit meter
// ---------------------------------------------------------------------------

function CartScreen({
  bundle,
  cart,
  setCart,
  medicalCard,
  verdict,
  member,
  setMember,
  onMemberLookup,
  onMemberHistory,
  onApprove,
  overrides,
  setOverrides,
  onCancel,
  onHold,
  onTender,
}: {
  bundle: PosMenuBundle;
  cart: PosCartEntry[];
  setCart: (c: PosCartEntry[]) => void;
  /** Non-null = medical sale (card captured at the gate). */
  medicalCard: PosCardCapture | null;
  verdict: Extract<IdGateVerdict, { allowed: true }>;
  member: PosMemberHit | null;
  setMember: (m: PosMemberHit | null) => void;
  onMemberLookup?: (q: string) => Promise<{ ok: true; members: PosMemberHit[] } | { ok: false; error: string }>;
  /** B29 — history for the ATTACHED member (ONLINE-ONLY via the shell). */
  onMemberHistory?: (customerId: string) => Promise<{ ok: true; history: MemberHistory } | { ok: false; error: string }>;
  /** B24 — manager PIN verify (ONLINE-ONLY; /api/pos/approve via the shell). */
  onApprove?: (pin: string) => Promise<{ ok: true; approver: { id: string; fullName: string } } | { ok: false; error: string }>;
  /** B24 — this sale's manager price overrides, keyed by variantId. */
  overrides: Record<string, PosLineOverride>;
  setOverrides: (o: Record<string, PosLineOverride>) => void;
  onCancel: () => void;
  /** B17 — park the cart (undefined = a hold already exists; button hidden). */
  onHold?: (cart: PosCartEntry[]) => void;
  onTender: () => void;
}) {
  const [query, setQuery] = useState("");
  // B24 — the line the manager is overriding (engine-priced snapshot).
  const [overrideTarget, setOverrideTarget] = useState<{ product: PosMenuProduct; engineLine: PricedSaleLine } | null>(null);
  // B23 — a scan that matched a MULTI-variant product: the cashier picks the
  // size (we never guess which variant left the shelf).
  const [scanPick, setScanPick] = useState<PosMenuProduct[] | null>(null);
  const [scanFlash, setScanFlash] = useState<string | null>(null);
  const carded = !!medicalCard;

  const results = useMemo(
    () => searchProducts(bundle.products, query).slice(0, 30),
    [bundle.products, query],
  );

  /**
   * B23 — Enter in the search box tries the text as a package barcode first
   * (keyboard-wedge scanners type the code and press Enter). A hit adds to
   * cart (or opens the size pick); a miss leaves the text as a search query.
   */
  const tryScan = () => {
    const resolved = resolveScan(bundle.products, bundle.barcodes, query);
    if (resolved.status === "add") {
      setCart(addToCart(cart, resolved.product));
      setScanFlash(`Scanned: ${resolved.product.name}${resolved.product.variantLabel ? ` · ${resolved.product.variantLabel}` : ""}`);
      setQuery("");
      return;
    }
    if (resolved.status === "pick") {
      setScanPick(resolved.candidates);
      setScanFlash(null);
      setQuery("");
    }
    // none: keep the text — it's a search query, not a barcode.
  };
  const priced = useMemo(() => priceForBuyer(cart, bundle, carded, overrides), [cart, bundle, carded, overrides]);

  // B24 — an override approved against a price the engine no longer charges
  // (promo tier moved with a quantity change) is dropped LOUDLY: clear it
  // from state so the cashier sees the fresh engine price, never a silent
  // apply of a markdown the manager did not look at.
  const staleKey = priced.staleVariantIds.join(",");
  useEffect(() => {
    if (!staleKey) return;
    const next = { ...overrides };
    for (const id of staleKey.split(",")) delete next[id];
    setOverrides(next);
    // overrides/setOverrides intentionally omitted: this effect reacts to the
    // PRICING result; including the map would loop the cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleKey]);
  const limits = useMemo(
    () => judgeLimits(limitLinesFor(priced.lines), carded ? "medical" : "recreational", bundle.limits),
    [priced.lines, carded, bundle.limits],
  );

  // B32 — cart lines whose quantity meets/exceeds the cached count. Advisory
  // only; the sale is never blocked on a cached number.
  const stockWarnings = useMemo(
    () =>
      cartStockWarnings(
        cart.map((e) => ({
          productName: e.product.name,
          variantLabel: e.product.variantLabel,
          quantity: e.quantity,
          inventoryStatus: e.product.inventoryStatus,
          unitsLeft: e.product.unitsLeft,
        })),
      ),
    [cart],
  );

  // High-THC statutory lock (chapter 246-70 WAC): applyMedicalPricing flags
  // any cart line a NON-carded buyer cannot receive; no override exists.
  const highThcViolations = priced.med?.highThcViolations ?? [];

  const canTender =
    cart.length > 0 && priced.problems.length === 0 && !limits.blocked && highThcViolations.length === 0;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 p-4 text-neutral-100 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            Sale — ID verified ({verdict.method}, age {verdict.age})
            {carded ? (
              <span className="ml-2 rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white align-middle">
                MEDICAL · {medicalCard?.upid}
              </span>
            ) : null}
          </h1>
          <p className="text-xs text-neutral-500">
            Menu as of {new Date(bundle.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            {carded ? " · tax exemptions applied per line (RCW 82.08.9998 / WAC 314-55-090)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">
            Cancel sale
          </button>
        </div>
      </header>

      <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-2">
        {/* Product search */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (scanFlash) setScanFlash(null);
            }}
            onKeyDown={(e) => {
              // B23 — wedge scanners type the code then press Enter.
              if (e.key === "Enter" && query.trim().length > 0) {
                e.preventDefault();
                tryScan();
              }
            }}
            placeholder="Scan a package barcode or search name, brand, category, size…"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
          />
          {scanFlash ? (
            <p className="mt-2 rounded-lg bg-emerald-950/60 px-3 py-2 text-xs font-semibold text-emerald-300">
              {scanFlash} — added to cart
            </p>
          ) : null}
          {scanPick ? (
            <div className="mt-2 rounded-xl border border-sky-900/60 bg-sky-950/30 p-3">
              <p className="text-xs font-semibold text-sky-200">
                Barcode matched {scanPick[0]?.name} — pick the size that left the shelf:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {scanPick.map((p) => (
                  <button
                    key={p.variantId}
                    type="button"
                    onClick={() => {
                      setCart(addToCart(cart, p));
                      setScanFlash(`Scanned: ${p.name}${p.variantLabel ? ` · ${p.variantLabel}` : ""}`);
                      setScanPick(null);
                    }}
                    className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    {p.variantLabel ?? "each"} · {money(p.regularPriceMinor)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setScanPick(null)}
                  className="rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <ul className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto">
            {results.map((p) => (
              <li key={p.variantId}>
                <button
                  type="button"
                  onClick={() => setCart(addToCart(cart, p))}
                  className="flex w-full items-center justify-between rounded-xl bg-neutral-800 px-4 py-3 text-left active:bg-neutral-700"
                >
                  <span>
                    <span className="block text-sm font-semibold">
                      {p.name}
                      {p.variantLabel ? <span className="text-neutral-400"> · {p.variantLabel}</span> : null}
                      <StockBadge product={p} />
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {p.brand ? `${p.brand} · ` : ""}
                      {p.category}
                    </span>
                  </span>
                  <span className="text-sm font-bold">{money(p.regularPriceMinor)}</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-neutral-500">No products match.</li>
            ) : null}
          </ul>
        </section>

        {/* Cart + limits + totals */}
        <section className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Cart</h2>
          <ul className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {priced.lines.map((l, i) => {
              const medLine = carded ? priced.med?.lines[i] : null;
              const exempt = !!medLine && (medLine.salesExempt || medLine.exciseExempt);
              // B24 — the raw engine line (pre-override, pre-medical) this
              // line derives from; applyPriceOverrides and applyMedicalPricing
              // both map 1:1 in order, so index i lines up exactly.
              const engineLine = priced.engineLines[i];
              const activeOverride = l.variantId ? overrides[l.variantId] : undefined;
              const cartEntry = cart.find((e) => e.product.variantId === l.variantId);
              return (
              <li key={`${l.productId}-${l.variantLabel ?? ""}`} className="rounded-xl bg-neutral-800 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {l.productName}
                    {exempt ? (
                      <span className="ml-2 rounded bg-sky-900/80 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                        MED · TAX OFF
                      </span>
                    ) : null}
                    {activeOverride ? (
                      <span className="ml-2 rounded bg-amber-900/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                        OVERRIDE · {activeOverride.approvedByName}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-bold">{money(l.unitPriceMinor * l.quantity)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
                  <span>
                    {money(l.unitPriceMinor)} each
                    {l.appliedLabel ? <span className="text-emerald-300"> · {l.appliedLabel}</span> : null}
                    {activeOverride ? (
                      <span className="text-amber-300"> · was {money(activeOverride.originalUnitPriceMinor)}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {onApprove && cartEntry && engineLine ? (
                      activeOverride ? (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...overrides };
                            delete next[l.variantId ?? ""];
                            setOverrides(next);
                          }}
                          className="rounded-lg bg-neutral-700 px-2 py-1 text-[11px] font-semibold text-amber-300"
                          title="Remove the manager override — the line returns to the engine price."
                        >
                          Undo override
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOverrideTarget({ product: cartEntry.product, engineLine })}
                          className="rounded-lg bg-neutral-700 px-2 py-1 text-[11px] font-semibold text-neutral-300"
                          title="Manager price override (markdown only; PIN + reason required)."
                        >
                          Override
                        </button>
                      )
                    ) : null}
                    <QtyButton label="−" onClick={() => setCart(setCartQuantity(cart, cartVariantId(cart, l.productId, l.variantLabel), l.quantity - 1))} />
                    <span className="w-6 text-center text-sm font-semibold text-neutral-200">{l.quantity}</span>
                    <QtyButton label="+" onClick={() => setCart(setCartQuantity(cart, cartVariantId(cart, l.productId, l.variantLabel), l.quantity + 1))} />
                  </span>
                </div>
              </li>
              );
            })}
            {cart.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-neutral-500">Tap products to add them.</li>
            ) : null}
          </ul>

          {highThcViolations.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs font-semibold text-red-300">
              {highThcViolations.map((n) => `"${n}"`).join(", ")}{" "}
              {highThcViolations.length === 1 ? "is a DOH High-THC product" : "are DOH High-THC products"} and may
              ONLY be sold to a patient with a valid recognition card (chapter 246-70 WAC). Remove{" "}
              {highThcViolations.length === 1 ? "it" : "them"}, or restart the sale on the medical path. No override
              exists.
            </p>
          ) : null}

          {priced.problems.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{priced.problems.join(" ")}</p>
          ) : null}

          {/* WAC 314-55-095 limit meter */}
          <div className="mt-3 space-y-1">
            {limits.evaluation.buckets
              .filter((b) => b.usedGrams > 0)
              .map((b) => (
                <div key={b.bucket} className="text-xs">
                  <div className="flex justify-between text-neutral-400">
                    <span>{b.label}</span>
                    <span className={b.exceeded ? "font-bold text-red-400" : ""}>
                      {b.usedGrams}g / {b.maxGrams}g
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full rounded bg-neutral-800">
                    <div
                      className={`h-1.5 rounded ${b.exceeded ? "bg-red-500" : b.ratio > 0.8 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, Math.round(b.ratio * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
          {limits.blocked ? (
            <p className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs font-semibold text-red-300">
              Over the WAC 314-55-095 single-transaction limit — remove items. {limits.evaluation.reasons.join(" ")}
            </p>
          ) : limits.softWarning ? (
            <p className="mt-2 rounded-lg bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-300">
              Over the configured limit (soft warning). {limits.evaluation.reasons.join(" ")}
            </p>
          ) : null}

          {/* B32 — cart-level stock awareness. Warnings only, NEVER blocks:
              the cached menu can lag the shelf; the B19 decrement + server
              completion gate are the authority at sync. */}
          {stockWarnings.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
              {stockWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {/* POS B14 — loyalty member attach (online lookup only) */}
          <MemberPanel member={member} setMember={setMember} onMemberLookup={onMemberLookup} onMemberHistory={onMemberHistory} />

          <div className="mt-4 border-t border-neutral-800 pt-3 text-sm">
            <Row label="Subtotal (pre-tax)" value={money(priced.totals.subtotalMinorUnits)} />
            <Row label="Tax (excise + sales)" value={money(priced.totals.estimatedTaxMinorUnits)} />
            {priced.totals.savingsMinorUnits > 0 ? (
              <Row label="You saved" value={`−${money(priced.totals.savingsMinorUnits)}`} accent />
            ) : null}
            {carded && (priced.med?.medicalSavingsMinor ?? 0) > 0 ? (
              <Row
                label="Medical savings (tax off)"
                value={`−${money(priced.med?.medicalSavingsMinor ?? 0)}`}
                accent
              />
            ) : null}
            <div className="mt-1 flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{money(priced.totals.totalMinorUnits)}</span>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            {onHold ? (
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => onHold(cart)}
                title="Park this cart (customer stepped away). Items + counts are kept; the ID check re-runs on resume."
                className="rounded-2xl border border-neutral-600 px-5 py-4 text-lg font-semibold text-neutral-200 disabled:opacity-40"
              >
                Hold
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canTender}
              onClick={onTender}
              className="flex-1 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white disabled:opacity-40"
            >
              Cash tender →
            </button>
          </div>
        </section>
      </div>

      {overrideTarget && onApprove ? (
        <PriceOverrideModal
          product={overrideTarget.product}
          engineLine={overrideTarget.engineLine}
          onApprove={onApprove}
          onClose={() => setOverrideTarget(null)}
          onApplied={(o) => {
            setOverrides({ ...overrides, [overrideTarget.product.variantId]: o });
            setOverrideTarget(null);
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * POS B24 — manager price override (markdown only). The cashier asks; a
 * manager or lead approves with THEIR PIN — verified server-side by
 * /api/pos/approve (same scrypt + throttle + role gate as the no-sale flow).
 * The floor is enforced BEFORE the PIN is spent: the statutory cannabis
 * minimum (RCW 69.50.357) and the CCRS acquisition-cost floor — no PIN can
 * take cannabis below either. ONLINE-ONLY: a PIN can't be verified offline.
 * The override is approved against the CURRENT engine price; if the engine
 * reprices the line later (quantity changes a promo tier), the override is
 * dropped loudly, never silently reapplied.
 */
function PriceOverrideModal({
  product,
  engineLine,
  onApprove,
  onClose,
  onApplied,
}: {
  product: PosMenuProduct;
  engineLine: PricedSaleLine;
  onApprove: (pin: string) => Promise<{ ok: true; approver: { id: string; fullName: string } } | { ok: false; error: string }>;
  onClose: () => void;
  onApplied: (o: PosLineOverride) => void;
}) {
  const PRESETS = [
    "Damaged packaging",
    "Price match (posted price discrepancy)",
    "Last unit — short expiry",
    "Customer recovery (manager decision)",
  ];
  const [priceText, setPriceText] = useState("");
  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const floorMinor = overrideFloorMinor(product);
  const newUnitMinor = dollarsToMinor(priceText);
  const reason = (preset ?? custom).trim();
  const request =
    newUnitMinor !== null
      ? validateOverrideRequest({
          engineUnitMinor: engineLine.unitPriceMinor,
          floorMinor,
          newUnitMinor,
          reason,
        })
      : null;
  const ready = request?.ok === true && pin.length >= 4 && !busy;

  const approve = async () => {
    if (!ready || newUnitMinor === null) return;
    if (!navigator.onLine) {
      setError("Offline — manager approval needs a connection to verify the PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await onApprove(pin);
      if (!res.ok) {
        setError(res.error);
        setPin("");
        return;
      }
      onApplied({
        unitPriceMinor: newUnitMinor,
        originalUnitPriceMinor: engineLine.unitPriceMinor,
        reason,
        approvedByEmployeeId: res.approver.id,
        approvedByName: res.approver.fullName,
      });
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-neutral-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Price override</h2>
          <button type="button" onClick={onClose} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-sm">
          {engineLine.productName} — currently {money(engineLine.unitPriceMinor)} each
          {engineLine.appliedLabel ? ` (${engineLine.appliedLabel})` : ""}.
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          Markdowns only — raise prices in the back office menu. Floor for this item:{" "}
          <span className="font-semibold text-neutral-200">{money(Math.max(1, floorMinor))}</span> (statutory minimum /
          acquisition cost). A manager or lead approves with their PIN; the override is audited at sync.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          New price per unit
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-lg font-semibold"
          inputMode="decimal"
          placeholder="0.00"
          value={priceText}
          onChange={(e) => {
            setPriceText(e.target.value);
            setError(null);
          }}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPreset(preset === p ? null : p);
                setCustom("");
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                preset === p ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm"
          placeholder="Or type another reason (3–500 characters)…"
          value={custom}
          maxLength={500}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value) setPreset(null);
          }}
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setError(null);
          }}
        />

        {request && !request.ok ? (
          <p className="mt-3 rounded-lg bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-300">{request.error}</p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={!ready}
          onClick={approve}
          className="mt-4 w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Approve override"}
        </button>
      </div>
    </div>
  );
}

/**
 * POS B14 — loyalty member panel: search (online only), pick, or detach. The
 * privacy budget is deliberately tiny — first name + last initial, points,
 * tier — and nothing is cached beyond the current sale.
 */
function MemberPanel({
  member,
  setMember,
  onMemberLookup,
  onMemberHistory,
}: {
  member: PosMemberHit | null;
  setMember: (m: PosMemberHit | null) => void;
  onMemberLookup?: (q: string) => Promise<{ ok: true; members: PosMemberHit[] } | { ok: false; error: string }>;
  onMemberHistory?: (customerId: string) => Promise<{ ok: true; history: MemberHistory } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<PosMemberHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // B29 — "the usual?": history for the attached member, fetched on demand,
  // held only while the panel shows it (nothing cached beyond this sale).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<MemberHistory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const toggleHistory = async () => {
    if (!member || !onMemberHistory) return;
    if (historyOpen) {
      setHistoryOpen(false);
      setHistory(null); // privacy budget: drop it the moment it's hidden
      setHistoryError(null);
      return;
    }
    setHistoryOpen(true);
    setHistoryBusy(true);
    setHistoryError(null);
    const res = await onMemberHistory(member.customerId);
    setHistoryBusy(false);
    if (res.ok) setHistory(res.history);
    else setHistoryError(res.error);
  };

  if (member) {
    return (
      <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <span className="font-semibold text-amber-300">★ {member.label}</span>
            <span className="ml-2 text-xs text-neutral-400">
              {member.points.toLocaleString()} pts{member.tierName ? ` · ${member.tierName}` : ""}
            </span>
          </span>
          <span className="flex gap-2">
            {onMemberHistory ? (
              <button
                type="button"
                onClick={() => void toggleHistory()}
                className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold"
              >
                {historyOpen ? "Hide history" : "History"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMember(null);
                setHistoryOpen(false);
                setHistory(null);
                setHistoryError(null);
              }}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold"
            >
              Remove
            </button>
          </span>
        </div>
        {historyOpen ? (
          <div className="mt-2 border-t border-amber-900/40 pt-2">
            {historyBusy ? (
              <p className="text-xs text-neutral-400">Loading…</p>
            ) : historyError ? (
              <p className="text-xs text-amber-300">{historyError}</p>
            ) : history ? (
              history.purchases.length === 0 ? (
                <p className="text-xs text-neutral-400">First visit on record — make it a good one.</p>
              ) : (
                <>
                  {history.favorites.length > 0 ? (
                    <p className="text-xs text-neutral-300">
                      <span className="font-semibold text-amber-300/90">Usually buys:</span>{" "}
                      {history.favorites.map((f) => f.productName).join(" · ")}
                    </p>
                  ) : null}
                  <ul className="mt-1.5 space-y-1">
                    {history.purchases.map((p) => (
                      <li key={p.orderId} className="text-xs text-neutral-400">
                        <span className="font-semibold text-neutral-300">{p.dateLabel}</span> · {money(p.totalMinor)} ·{" "}
                        {p.items.join(", ")}
                        {p.moreCount > 0 ? ` + ${p.moreCount} more` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-xl border border-dashed border-neutral-700 px-4 py-2.5 text-left text-sm text-neutral-400 active:bg-neutral-800"
      >
        ★ Add loyalty member (optional)
      </button>
    );
  }

  const search = async () => {
    const term = q.trim();
    if (term.length < 2 || !onMemberLookup) return;
    setBusy(true);
    setError(null);
    const res = await onMemberLookup(term);
    setBusy(false);
    if (res.ok) {
      setHits(res.members);
      if (res.members.length === 0) setError("No members match — sign them up in the back office.");
    } else {
      setHits(null);
      setError(res.error);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 p-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Member name, phone, or email…"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy || q.trim().length < 2}
          className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "…" : "Find"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setHits(null);
            setError(null);
            setQ("");
          }}
          className="rounded-lg bg-neutral-800 px-3 py-2.5 text-sm"
        >
          ✕
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-amber-300">{error}</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {hits.map((h) => (
            <li key={h.customerId}>
              <button
                type="button"
                onClick={() => {
                  setMember(h);
                  setOpen(false);
                  setHits(null);
                  setQ("");
                  setError(null);
                }}
                className="flex w-full items-center justify-between rounded-lg bg-neutral-800 px-3 py-2.5 text-left active:bg-neutral-700"
              >
                <span className="text-sm font-semibold">{h.label}</span>
                <span className="text-xs text-neutral-400">
                  {h.points.toLocaleString()} pts{h.tierName ? ` · ${h.tierName}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Resolve the cart's variantId for a priced line (product + variant label). */
function cartVariantId(cart: PosCartEntry[], productId: string, variantLabel: string | null): string {
  const entry = cart.find(
    (e) => e.product.productId === productId && (e.product.variantLabel ?? null) === variantLabel,
  );
  return entry?.product.variantId ?? "";
}

// ---------------------------------------------------------------------------
// Step 3 — cash tender
// ---------------------------------------------------------------------------

/**
 * B31 — the count-back panel: the exact bills and coins to hand back,
 * fewest pieces first (greedy — optimal for US denominations; $50/$100
 * are never planned as change). Rendered live on the tender screen and
 * again on the Sale-complete screen so the budtender counts back with
 * confidence instead of doing mental math on a line.
 */
function ChangePlan({ changeMinor, compact }: { changeMinor: number; compact?: boolean }) {
  const parts = changeBreakdown(changeMinor);
  if (!parts || parts.length === 0) return null;
  return (
    <div className={`flex flex-wrap justify-center gap-2 ${compact ? "mt-2" : "mt-3"}`}>
      {parts.map((p) => (
        <span
          key={p.label}
          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold ${
            p.kind === "bill"
              ? "bg-emerald-900/60 text-emerald-200"
              : "bg-neutral-800 text-neutral-300"
          } ${compact ? "text-sm" : "text-base"}`}
        >
          {p.count}&times;{p.label}
        </span>
      ))}
    </div>
  );
}

function TenderScreen({
  bundle,
  cart,
  medicalCard,
  overrides,
  onBack,
  onCancel,
  onPaid,
}: {
  bundle: PosMenuBundle;
  cart: PosCartEntry[];
  medicalCard: PosCardCapture | null;
  /** B24 — this sale's manager price overrides (same map the cart used). */
  overrides: Record<string, PosLineOverride>;
  onBack: () => void;
  onCancel: () => void;
  /** Returns an error string, or null when the sale was enqueued. */
  onPaid: (tenderedMinor: number) => string | null;
}) {
  const priced = useMemo(
    () => priceForBuyer(cart, bundle, medicalCard !== null, overrides),
    [cart, bundle, medicalCard, overrides],
  );
  const total = priced.totals.totalMinorUnits;
  const [tendered, setTendered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // B31 — the amounts customers actually hand over: exact, next whole
  // dollar, then $5/$10/$20 steps plus the $50/$100 bills, deduplicated.
  const suggestions = useMemo(() => smartTenderSuggestions(total), [total]);
  const change = tendered - total;

  const pay = () => {
    const err = onPaid(tendered);
    if (err) setError(err);
  };

  return (
    <Frame title="Cash tender" onCancel={onCancel}>
      <p className="text-4xl font-bold">{money(total)}</p>
      <p className="mt-1 text-sm text-neutral-400">Total due — cash only at this store.</p>
      {medicalCard && (priced.med?.medicalSavingsMinor ?? 0) > 0 ? (
        <p className="mt-1 text-sm font-semibold text-emerald-300">
          Medical savings −{money(priced.med?.medicalSavingsMinor ?? 0)} (tax exempt)
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 w-full max-w-md rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-300">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {suggestions.map((amt, i) => (
          <TenderChip
            key={amt}
            label={i === 0 ? `Exact ${money(amt)}` : money(amt)}
            onClick={() => setTendered(amt)}
            active={tendered === amt}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="pos-tender" className="text-sm text-neutral-400">Custom $</label>
        <input
          id="pos-tender"
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => {
            const v = Math.round(parseFloat(e.target.value || "0") * 100);
            setTendered(Number.isFinite(v) && v > 0 ? v : 0);
          }}
          className="w-32 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-right text-lg font-semibold"
        />
      </div>

      <p className={`mt-6 text-2xl font-bold ${change >= 0 ? "text-emerald-300" : "text-neutral-600"}`}>
        {change >= 0 ? `${money(change)} change` : `${money(-change)} more needed`}
      </p>
      {tendered >= total && change > 0 ? <ChangePlan changeMinor={change} compact /> : null}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={pay}
          disabled={tendered < total}
          className="rounded-2xl bg-emerald-600 px-10 py-4 text-lg font-bold text-white disabled:opacity-40"
        >
          Complete sale
        </button>
        <button type="button" onClick={onBack} className="rounded-2xl bg-neutral-800 px-6 py-4 text-lg font-semibold">
          Back to cart
        </button>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Frame({
  title,
  children,
  onCancel,
  cancelLabel = "Cancel sale",
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <button type="button" onClick={onCancel} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm">
          {cancelLabel}
        </button>
      </div>
      <div className="flex w-full max-w-lg flex-col items-center">{children}</div>
    </main>
  );
}

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"}`}
    >
      {label}
    </button>
  );
}

/**
 * B32 — stock badge on a product row: exact variant counts ("2 LEFT",
 * "LAST ONE") beat the item-level "LOW STOCK"; healthy counts render
 * nothing. Amber = low, red = last units. Informational only.
 */
function StockBadge({ product }: { product: PosMenuProduct }) {
  const signal = stockSignal(product.inventoryStatus, product.unitsLeft);
  if (!signal) return null;
  return (
    <span
      className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide ${
        signal.severity === "last-units" ? "bg-red-900/70 text-red-200" : "bg-amber-900/70 text-amber-200"
      }`}
    >
      {signal.badge}
    </span>
  );
}

function TenderChip({ label, onClick, active }: { label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-3 text-sm font-bold ${active ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-200"}`}
    >
      {label}
    </button>
  );
}

function QtyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 w-8 rounded-lg bg-neutral-700 text-lg font-bold text-neutral-100 active:bg-neutral-600"
    >
      {label}
    </button>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${accent ? "text-emerald-300" : "text-neutral-400"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
